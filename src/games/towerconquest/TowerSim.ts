import { SysRandom, V2 } from "../../kit/math";

/**
 * Tower Conquest rules (no rendering): towers that make troops, troop streams that march between towers, combat at
 * the walls, head-on clashes between streams, elimination and the computer empires. Pure logic so it can be run
 * headless (bot vs bot, solvability of the campaign maps).
 */

export interface KindSpec { name: string; neutral: number; rate: number; cap: number; radius: number; value: number }

/** Troops needed to take a neutral tower = its garrison (outpost 20, keep 50, fortress 100). */
export const Kinds: KindSpec[] = [
  { name: "OUTPOST", neutral: 20, rate: 1.0, cap: 40, radius: 0.44, value: 1 },
  { name: "KEEP", neutral: 50, rate: 1.7, cap: 80, radius: 0.56, value: 1.7 },
  { name: "FORTRESS", neutral: 100, rate: 2.6, cap: 150, radius: 0.7, value: 2.6 },
];

export const UnitSpeed = 2.0;
export const StartTroops = 30;
const LaneOffsets = [0, -0.14, 0.14];
const WaveInterval = 0.075;
const ClashDist = 0.2;
const MaxDotsPerOrder = 60;

export class Tower {
  owner = -1;
  troops = 0;
  /** Time of the last hostile hit / capture (for visuals). */
  hitAt = -9;
  capturedAt = -9;
  prevOwner = -1;
  constructor(readonly id: number, readonly pos: V2, readonly kind: number) {}
  get spec() { return Kinds[this.kind]; }
  get radius() { return Kinds[this.kind].radius; }
}

export class Unit {
  alive = true;
  pos = V2.zero;
  s = 0;
  len = 0;
  dir = V2.zero;
  perp = V2.zero;
  start = V2.zero;
  phase = 0;
  constructor(public owner: number, public from: Tower, public to: Tower, public value: number, public offset: number) {}
}

export interface Order { owner: number; from: Tower; to: Tower; left: number; unit: number; acc: number }

export interface SimEvents {
  capture?(t: Tower, prev: number, by: number): void;
  hit?(t: Tower, owner: number, value: number): void;
  reinforce?(t: Tower, value: number): void;
  clash?(pos: V2, a: number, b: number): void;
  send?(from: Tower, to: Tower, owner: number, amount: number): void;
  eliminated?(p: number): void;
}

export class Sim {
  readonly towers: Tower[] = [];
  units: Unit[] = [];
  readonly orders: Order[] = [];
  time = 0;
  /** Players 0..n-1 (owners). -1 = neutral. */
  readonly alive: boolean[];
  readonly sent: number[];
  readonly captured: number[];
  readonly lost: number[];
  events: SimEvents = {};
  private grid = new Map<number, Unit[]>();

  constructor(readonly players: number) {
    this.alive = new Array(players).fill(true);
    this.sent = new Array(players).fill(0);
    this.captured = new Array(players).fill(0);
    this.lost = new Array(players).fill(0);
  }

  addTower(pos: V2, kind: number, owner: number, troops: number) {
    const t = new Tower(this.towers.length, pos, kind);
    t.owner = owner;
    t.troops = troops;
    this.towers.push(t);
    return t;
  }

  towersOf(p: number) { let n = 0; for (const t of this.towers) if (t.owner === p) n++; return n; }

  troopsOf(p: number) {
    let n = 0;
    for (const t of this.towers) if (t.owner === p) n += t.troops;
    for (const u of this.units) if (u.alive && u.owner === p) n += u.value;
    for (const o of this.orders) if (o.owner === p) n += o.left;
    return n;
  }

  /** Units (and queued units) of `owner` heading to tower t; hostile = from anybody else. */
  incoming(t: Tower, owner: number): [number, number] {
    let mine = 0, hostile = 0;
    for (const u of this.units) if (u.alive && u.to === t) { if (u.owner === owner) mine += u.value; else hostile += u.value; }
    for (const o of this.orders) if (o.to === t) { if (o.owner === owner) mine += o.left; else hostile += o.left; }
    return [mine, hostile];
  }

  /** Sends `amount` troops (whole numbers) from a tower to another. Returns the amount sent. */
  send(from: Tower, to: Tower, amount: number) {
    if (from === to || from.owner < 0) return 0;
    amount = Math.min(Math.floor(amount), Math.floor(from.troops));
    if (amount <= 0) return 0;
    from.troops -= amount;
    const unit = Math.max(1, Math.ceil(amount / MaxDotsPerOrder));
    this.orders.push({ owner: from.owner, from, to, left: amount, unit, acc: WaveInterval });
    this.sent[from.owner] += amount;
    this.events.send?.(from, to, from.owner, amount);
    return amount;
  }

  /** Sends a share (0..1) of every source's garrison to the target. */
  sendShare(sources: Tower[], to: Tower, share: number) {
    let total = 0;
    for (const s of sources) {
      if (s === to) continue;
      const n = share >= 0.99 ? Math.floor(s.troops) : Math.floor(s.troops * share);
      total += this.send(s, to, n);
    }
    return total;
  }

  step(dt: number) {
    this.time += dt;
    // production (owned towers grow to their cap; overfull towers drain slowly)
    for (const t of this.towers) {
      if (t.owner < 0) continue;
      const sp = t.spec;
      if (t.troops < sp.cap) t.troops = Math.min(sp.cap, t.troops + sp.rate * dt);
      else if (t.troops > sp.cap) t.troops = Math.max(sp.cap, t.troops - dt * 1.5);
    }
    // emission: waves of up to three dots side by side
    for (let i = this.orders.length - 1; i >= 0; i--) {
      const o = this.orders[i];
      o.acc += dt;
      while (o.acc >= WaveInterval && o.left > 0) {
        o.acc -= WaveInterval;
        for (let l = 0; l < LaneOffsets.length && o.left > 0; l++) {
          const v = Math.min(o.unit, o.left);
          o.left -= v;
          this.spawn(o, v, LaneOffsets[l]);
        }
      }
      if (o.left <= 0) this.orders.splice(i, 1);
    }
    // marching
    for (const u of this.units) {
      if (!u.alive) continue;
      u.s += UnitSpeed * dt;
      u.phase += dt;
      if (u.s >= u.len) { this.arrive(u); continue; }
      const taper = Math.min(1, Math.min(u.s, u.len - u.s) / 0.6);
      u.pos = u.start.add(u.dir.mul(u.s)).add(u.perp.mul(u.offset * taper));
    }
    this.clashes();
    if (this.units.length > 64 && this.units.some((u) => !u.alive)) this.units = this.units.filter((u) => u.alive);
    // elimination
    for (let p = 0; p < this.players; p++) {
      if (!this.alive[p]) continue;
      if (this.towersOf(p) === 0 && !this.units.some((u) => u.alive && u.owner === p) && !this.orders.some((o) => o.owner === p)) {
        this.alive[p] = false;
        this.events.eliminated?.(p);
      }
    }
  }

  private spawn(o: Order, value: number, offset: number) {
    const a = o.from.pos, b = o.to.pos;
    const d = b.sub(a), dist = d.magnitude;
    if (dist < 0.01) { this.land(o.owner, o.to, value); return; }
    const dir = d.div(dist);
    const u = new Unit(o.owner, o.from, o.to, value, offset);
    u.dir = dir;
    u.perp = new V2(-dir.y, dir.x);
    u.start = a.add(dir.mul(o.from.radius * 0.8));
    u.len = Math.max(0.05, dist - o.from.radius * 0.8 - o.to.radius * 0.7);
    u.pos = u.start;
    u.phase = Math.random() * 6;
    this.units.push(u);
  }

  private arrive(u: Unit) {
    u.alive = false;
    this.land(u.owner, u.to, u.value);
  }

  private land(owner: number, t: Tower, value: number) {
    if (t.owner === owner) {
      t.troops += value;
      this.events.reinforce?.(t, value);
      return;
    }
    t.troops -= value;
    t.hitAt = this.time;
    if (t.troops < 0) {
      const prev = t.owner;
      t.prevOwner = prev;
      t.owner = owner;
      t.troops = -t.troops;
      t.capturedAt = this.time;
      this.captured[owner]++;
      if (prev >= 0) this.lost[prev]++;
      this.events.capture?.(t, prev, owner);
    } else this.events.hit?.(t, owner, value);
  }

  /** Streams of different owners that meet cancel each other out, one troop for one troop. */
  private clashes() {
    const g = this.grid;
    g.clear();
    const cell = 0.4;
    const key = (x: number, y: number) => (Math.floor(x / cell) + 500) * 2000 + Math.floor(y / cell) + 500;
    let owners = -1, mixed = false;
    for (const u of this.units) {
      if (!u.alive) continue;
      if (owners === -1) owners = u.owner; else if (owners !== u.owner) mixed = true;
      const k = key(u.pos.x, u.pos.y);
      let l = g.get(k);
      if (!l) { l = []; g.set(k, l); }
      l.push(u);
    }
    if (!mixed) return;
    for (const u of this.units) {
      if (!u.alive) continue;
      const cx = Math.floor(u.pos.x / cell) + 500, cy = Math.floor(u.pos.y / cell) + 500;
      for (let dx = -1; dx <= 1 && u.alive; dx++)
        for (let dy = -1; dy <= 1 && u.alive; dy++) {
          const l = g.get((cx + dx) * 2000 + cy + dy);
          if (!l) continue;
          for (const o of l) {
            if (!o.alive || o.owner === u.owner) continue;
            const ddx = o.pos.x - u.pos.x, ddy = o.pos.y - u.pos.y;
            if (ddx * ddx + ddy * ddy > ClashDist * ClashDist) continue;
            const m = Math.min(u.value, o.value);
            u.value -= m;
            o.value -= m;
            if (o.value <= 0) o.alive = false;
            if (u.value <= 0) u.alive = false;
            this.events.clash?.(V2.lerp(u.pos, o.pos, 0.5), u.owner, o.owner);
            if (!u.alive) break;
          }
        }
    }
  }

  /** Owner with the most towers (ties: most troops). -1 if nobody. Second value: is it a tie on towers? */
  leader(): [number, boolean] {
    let best = -1, bestT = -1, bestTr = -1, tie = false;
    for (let p = 0; p < this.players; p++) {
      const n = this.towersOf(p), tr = this.troopsOf(p);
      if (n > bestT || (n === bestT && tr > bestTr)) { tie = n === bestT; best = p; bestT = n; bestTr = tr; }
      else if (n === bestT) tie = true;
    }
    return [best, tie];
  }
}

// ------------------------------------------------------------------ computer empires

export const BotNames = ["EASY", "MEDIUM", "HARD"];

export interface BotParams { think: number; first: number; margin: number; maxSources: number; defend: number; reserve: number; blunder: number; aggro: number; peace: number; guard: number }
export const Params: BotParams[] = [
  { think: 3.4, first: 3.5, margin: 2, maxSources: 1, defend: 0.25, reserve: 0.25, blunder: 0.25, aggro: 0.9, peace: 35, guard: 0.2 },
  { think: 2.1, first: 2.2, margin: 6, maxSources: 3, defend: 0.75, reserve: 0.12, blunder: 0.06, aggro: 1.15, peace: 22, guard: 0.45 },
  { think: 1.15, first: 1.2, margin: 10, maxSources: 6, defend: 1, reserve: 0.05, blunder: 0, aggro: 1.35, peace: 14, guard: 0.6 },
];

/**
 * A computer empire. It thinks every couple of seconds: first it saves towers that are about to fall, then it picks the
 * cheapest valuable target it can afford (neutral or enemy) and sends just enough troops from its nearest towers.
 * Easy bots attack from one tower, think slowly and misjudge; hard bots gang up from many towers, count production
 * during the march and punish towers that just emptied themselves. `soloTargetsOnly` restricts it to neutrals
 * (used to check that solo maps can be cleared).
 */
export class Bot {
  private timer: number;
  private readonly p: BotParams;
  constructor(private readonly sim: Sim, readonly me: number, readonly diff: number, private readonly rng = new SysRandom()) {
    this.p = Params[Math.max(0, Math.min(2, diff))];
    this.timer = this.p.first * (0.8 + rng.nextDouble() * 0.5);
  }

  update(dt: number) {
    if (!this.sim.alive[this.me]) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.p.think * (0.8 + this.rng.nextDouble() * 0.45);
    this.think();
  }

  think() {
    const sim = this.sim, me = this.me, p = this.p;
    const mine = sim.towers.filter((t) => t.owner === me);
    if (mine.length === 0) return;
    const spare = new Map<Tower, number>();
    const threatOf = new Map<Tower, number>();
    for (const t of mine) {
      const [friend, hostile] = sim.incoming(t, me);
      if (hostile > 0) this.attacked = true;
      const threat = Math.max(0, hostile - friend);
      threatOf.set(t, threat);
      // keep a guard against the nearest enemy tower's garrison
      let guard = 0;
      for (const o of sim.towers) if (o.owner >= 0 && o.owner !== me && V2.distance(o.pos, t.pos) < 6) guard = Math.max(guard, o.troops * p.guard);
      guard = Math.min(guard, t.troops * 0.5);
      spare.set(t, Math.max(0, Math.floor(t.troops - threat - Math.max(t.troops * p.reserve, guard) - 1)));
    }
    // expansion phase: empires leave each other alone at first, unless somebody attacks
    const peace = !this.attacked && sim.time < p.peace;
    // 1) defend a tower that is about to fall
    if (this.rng.nextDouble() < p.defend) {
      for (const t of mine) {
        const threat = threatOf.get(t) ?? 0;
        if (threat <= 0 || threat < t.troops * 0.9) continue;
        let need = threat - t.troops + 4;
        const helpers = mine.filter((h) => h !== t && (spare.get(h) ?? 0) > 4).sort((a, b) => V2.distance(a.pos, t.pos) - V2.distance(b.pos, t.pos));
        for (const h of helpers.slice(0, p.maxSources)) {
          const n = Math.min(spare.get(h) ?? 0, Math.ceil(need));
          if (n <= 0) continue;
          sim.send(h, t, n);
          spare.set(h, (spare.get(h) ?? 0) - n);
          need -= n;
          if (need <= 0) break;
        }
        break;
      }
    }
    // 2) attack the best affordable target
    const [leader] = sim.leader();
    let best: { t: Tower; srcs: [Tower, number][]; score: number } | null = null;
    for (const t of sim.towers) {
      if (t.owner === me) continue;
      if ((this.soloTargetsOnly || peace) && t.owner >= 0) continue;
      const srcs = mine.filter((s) => (spare.get(s) ?? 0) > 2).sort((a, b) => V2.distance(a.pos, t.pos) - V2.distance(b.pos, t.pos)).slice(0, p.maxSources);
      if (srcs.length === 0) continue;
      const [mineIn, hostileIn] = sim.incoming(t, me);
      const dist = V2.distance(srcs[0].pos, t.pos);
      const eta = dist / UnitSpeed;
      let req = t.troops + (t.owner >= 0 ? Math.min(t.spec.rate * eta, t.spec.cap - t.troops + 4) + t.troops * 0.1 : 0) + p.margin - mineIn;
      // other empires attacking a neutral make it cheaper, but only the hard bot counts on that
      if (this.diff >= 2 && t.owner < 0) req -= hostileIn * 0.5;
      // a defended tower: its neighbours can send help in time
      if (t.owner >= 0 && this.diff >= 1)
        for (const o of sim.towers) if (o !== t && o.owner === t.owner && V2.distance(o.pos, t.pos) < 4) req += o.troops * 0.5;
      if (this.rng.nextDouble() < p.blunder) req *= 0.75;
      if (req <= 0) continue;
      let have = 0;
      const use: [Tower, number][] = [];
      for (const s of srcs) {
        if (have >= req) break;
        const n = Math.min(spare.get(s) ?? 0, Math.ceil(req - have));
        use.push([s, n]);
        have += n;
      }
      if (have < req) continue;
      const avgDist = use.reduce((a, [s]) => a + V2.distance(s.pos, t.pos), 0) / use.length;
      let value = t.spec.value;
      if (t.owner >= 0) value *= p.aggro * (t.owner === leader && t.owner !== me ? 1.25 : 1);
      // a tower that just emptied itself is a gift
      if (t.owner >= 0 && t.troops < t.spec.neutral * 0.25) value *= 1.4;
      const score = value / (req + avgDist * 3.5) * (0.9 + this.rng.nextDouble() * 0.2);
      if (!best || score > best.score) best = { t, srcs: use, score };
    }
    if (best) {
      for (const [s, n] of best.srcs) sim.send(s, best.t, n);
      return;
    }
    // 3) nothing affordable: move troops from full rear towers to the front
    for (const t of mine) {
      if (t.troops < t.spec.cap * 0.95) continue;
      let front: Tower | null = null, fd = 1e9;
      for (const o of mine) {
        if (o === t) continue;
        const d = this.nearestEnemyDist(o);
        if (d < fd) { fd = d; front = o; }
      }
      if (front && this.nearestEnemyDist(t) > fd + 1) sim.send(t, front, Math.floor(t.troops * 0.5));
    }
  }

  soloTargetsOnly = false;
  /** Set once another empire has sent troops at this one (ends the expansion phase). */
  attacked = false;

  private nearestEnemyDist(t: Tower) {
    let d = 1e9;
    for (const o of this.sim.towers) if (o.owner !== this.me) d = Math.min(d, V2.distance(o.pos, t.pos));
    return d;
  }
}
