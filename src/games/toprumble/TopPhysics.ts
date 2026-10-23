/**
 * TOP RUMBLE physics, bots and stage generator. Pure TypeScript (no kit imports) so the same code runs in the game
 * and in headless node tests. Units: the ring has radius R = 10, positions are relative to its centre, y up.
 *
 * A top glides with little friction while it spins fast, curls slightly with its spin direction, rolls back towards
 * the middle of the (very shallow) dish, loses spin over time and on hits, wobbles when spin runs low and topples at
 * zero. Leaving the ring is a ring-out. Collisions are circle vs circle with mass; the faster-spinning, harder-hitting
 * top adds extra knockback and drains the other's spin. Fixed 1/240 s sub-steps so nothing tunnels.
 */

export const R = 10;
export const Step = 1 / 240;
export const MaxLaunch = 14;
export const MinLaunch = 4.5;

// ------------------------------------------------------------------ random

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = (Math.floor(seed) >>> 0) || 0x9e3779b9; }
  next() {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(n: number) { return Math.floor(this.next() * n); }
  pick<T>(a: T[]) { return a[this.int(a.length)]; }
  gauss() { return (this.next() + this.next() + this.next() - 1.5) * 1.15; }
}

// ------------------------------------------------------------------ catalogue

export interface Design { name: string; atk: number; def: number; sta: number; cost: number; blurb: string }
export const Designs: Design[] = [
  { name: "CLASSIC", atk: 3, def: 3, sta: 3, cost: 0, blurb: "The school-yard all-rounder." },
  { name: "STINGER", atk: 5, def: 2, sta: 2, cost: 300, blurb: "Hits hard, burns out fast." },
  { name: "BULWARK", atk: 2, def: 5, sta: 3, cost: 450, blurb: "Heavy rim. Hard to knock out." },
  { name: "WHIRL", atk: 2, def: 2, sta: 5, cost: 450, blurb: "Spins forever. Outlast them." },
  { name: "THUNDER", atk: 4, def: 4, sta: 2, cost: 800, blurb: "Big, heavy and angry." },
  { name: "ROYAL", atk: 4, def: 3, sta: 4, cost: 1400, blurb: "The champion's top." },
];

export interface ArenaDef { name: string; fric: number; slope: number; decay: number; unlock: number }
/** unlock: the solo stage you must reach to use the arena in VS / 2-player matches. */
export const Arenas: ArenaDef[] = [
  { name: "COURTYARD", fric: 0.95, slope: 1.3, decay: 1, unlock: 0 },
  { name: "WOOD TABLE", fric: 0.7, slope: 1.0, decay: 0.95, unlock: 4 },
  { name: "SANDPIT", fric: 1.35, slope: 2.0, decay: 1.15, unlock: 8 },
  { name: "TIN TRAY", fric: 0.6, slope: 1.7, decay: 0.9, unlock: 12 },
];

export interface BotLevel { aimErr: number; powErr: number; think: number; edge: number; ram: number; strength: number; plan: number }
export const BotEasy: BotLevel = { aimErr: 24, powErr: 0.2, think: 0.6, edge: 0.9, ram: 0.3, strength: 0.5, plan: 0.25 };
export const BotMedium: BotLevel = { aimErr: 11, powErr: 0.1, think: 0.28, edge: 0.76, ram: 0.6, strength: 0.8, plan: 0.7 };
export const BotHard: BotLevel = { aimErr: 3, powErr: 0.035, think: 0.09, edge: 0.64, ram: 0.85, strength: 1, plan: 1 };
export const BotLevels = [BotEasy, BotMedium, BotHard];
export function lerpBot(a: BotLevel, b: BotLevel, t: number): BotLevel {
  const l = (x: number, y: number) => x + (y - x) * Math.max(0, Math.min(1, t));
  return { aimErr: l(a.aimErr, b.aimErr), powErr: l(a.powErr, b.powErr), think: l(a.think, b.think), edge: l(a.edge, b.edge), ram: l(a.ram, b.ram), strength: l(a.strength, b.strength), plan: l(a.plan, b.plan) };
}

// ------------------------------------------------------------------ tops

export enum Out { None = 0, Ring = 1, Topple = 2 }

export class Top {
  x = 0; y = 0; vx = 0; vy = 0;
  /** Spin, 0..1 (1 = a perfect full-power launch). */
  s = 0;
  r = 1.1; m = 1;
  atk = 3; def = 3; sta = 3;
  /** +1 counter-clockwise, -1 clockwise. */
  dir = 1;
  alive = true;
  out = Out.None;
  outT = 0;
  launched = false;
  /** Nudge input (-1..1 each axis) set by the player or bot every frame. */
  nx = 0; ny = 0;
  /** Nudge energy 0..1: drains while nudging, refills slowly. */
  energy = 1;
  /** Start mark. */
  sx = 0; sy = 0;
  wobbleT = 0;
  hits = 0; dealt = 0; maxHit = 0;
  bonus = 0; // power-launch bonus (rewarded rematch)
  /** Seconds left in the air after the throw (no collisions, no friction). */
  air = 0;
  airTotal = 0;
  constructor(readonly id: number) {}

  setDesign(d: Design, statBoost = 0) {
    this.atk = d.atk + statBoost; this.def = d.def + statBoost; this.sta = d.sta + statBoost;
    this.r = 1.1 + 0.04 * (this.def - 3);
    this.m = 1 + 0.16 * (this.def - 3) + 0.05 * (this.atk - 3);
  }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get dist() { return Math.hypot(this.x, this.y); }
}

export enum Ev { Hit, RingOut, Topple, Launch, Land }
export interface TopEvent { type: Ev; a: number; b: number; x: number; y: number; impact: number }

const Nudge = 7.5, NudgeDrain = 0.55, NudgeRefill = 0.12, NudgeSpin = 0.03;

export class Sim {
  tops: Top[] = [];
  arena: ArenaDef = Arenas[0];
  events: TopEvent[] | null = null;
  time = 0;
  acc = 0;
  /** Index of the winner once the round is decided (-1 while running). */
  winner = -1;
  wanderSeed = 1;
  private bumpT = 0;
  private rng = new Rng(1);
  /** Seeds the ground bumps (pebbles and cracks nudge the tops a little, so no two rounds play the same). */
  seed(n: number) { this.wanderSeed = n; this.rng = new Rng(n); }

  reset(n: number, arena: ArenaDef) {
    this.arena = arena;
    this.tops = [];
    this.time = 0; this.acc = 0; this.winner = -1;
    for (let i = 0; i < n; i++) this.tops.push(new Top(i));
    // start marks around the ring: player 0 at the bottom
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const t = this.tops[i];
      t.sx = Math.cos(a) * R * 0.72; t.sy = Math.sin(a) * R * 0.72;
      t.x = t.sx; t.y = t.sy;
      t.dir = i % 2 === 0 ? -1 : 1;
    }
  }

  clone() {
    const s = new Sim();
    s.arena = this.arena; s.time = this.time; s.winner = this.winner; s.wanderSeed = this.wanderSeed;
    s.tops = this.tops.map((t) => Object.assign(new Top(t.id), t));
    s.rng = new Rng(this.wanderSeed + Math.floor(this.time * 240));
    return s;
  }

  get aliveCount() { let n = 0; for (const t of this.tops) if (t.alive) n++; return n; }

  /** Launch speed and spin for a pull power 0..1. */
  static launchSpeed(power: number) { return MinLaunch + (MaxLaunch - MinLaunch) * power; }
  static launchSpin(power: number) { return 0.55 + 0.45 * power; }
  static airTime(power: number) { return 0.22 + 0.2 * power; }
  /** Speed kept when the thrown top lands. */
  static readonly LandKeep = 0.6;

  launch(i: number, ax: number, ay: number, power: number) {
    const t = this.tops[i];
    const l = Math.hypot(ax, ay) || 1;
    const sp = Sim.launchSpeed(power) * (1 + 0.08 * t.bonus);
    t.vx = (ax / l) * sp; t.vy = (ay / l) * sp;
    t.s = Math.min(1.15, Sim.launchSpin(power) + 0.25 * t.bonus);
    t.launched = true;
    t.air = t.airTotal = Sim.airTime(power);
    this.events?.push({ type: Ev.Launch, a: i, b: -1, x: t.x, y: t.y, impact: power });
  }

  advance(dt: number) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= Step) { this.acc -= Step; this.step(Step); }
  }

  step(dt: number) {
    this.time += dt;
    const ar = this.arena;
    const tops = this.tops;
    this.bumpT -= dt;
    const bump = this.bumpT <= 0;
    if (bump) this.bumpT = 0.2;
    for (const t of tops) {
      if (!t.launched) continue;
      if (t.air > 0) {
        t.x += t.vx * dt; t.y += t.vy * dt;
        t.air -= dt;
        if (t.air <= 0) {
          t.air = 0; t.vx *= Sim.LandKeep; t.vy *= Sim.LandKeep;
          this.events?.push({ type: Ev.Land, a: t.id, b: -1, x: t.x, y: t.y, impact: t.speed });
        }
        continue;
      }
      if (bump && t.alive) { const a = this.rng.next() * Math.PI * 2, k = 0.12 * this.rng.next(); t.vx += Math.cos(a) * k; t.vy += Math.sin(a) * k; }
      if (!t.alive) {
        t.outT += dt;
        if (t.out === Out.Ring) { t.x += t.vx * dt; t.y += t.vy * dt; const k = Math.exp(-2.5 * dt); t.vx *= k; t.vy *= k; }
        else { const k = Math.exp(-6 * dt); t.vx *= k; t.vy *= k; t.x += t.vx * dt; t.y += t.vy * dt; }
        continue;
      }
      // nudge
      const nm = Math.hypot(t.nx, t.ny);
      if (nm > 0.05 && t.energy > 0) {
        const k = Math.min(1, nm);
        t.vx += (t.nx / Math.max(1, nm)) * Nudge * dt;
        t.vy += (t.ny / Math.max(1, nm)) * Nudge * dt;
        t.energy = Math.max(0, t.energy - NudgeDrain * k * dt);
        t.s -= NudgeSpin * k * dt;
      } else t.energy = Math.min(1, t.energy + NudgeRefill * dt);
      // dish slope, friction, curl
      const d = t.dist;
      t.vx -= (t.x / R) * ar.slope * dt * 2;
      t.vy -= (t.y / R) * ar.slope * dt * 2;
      const fr = Math.exp(-ar.fric * (0.75 + 0.6 * (1 - Math.min(1, t.s))) * dt);
      t.vx *= fr; t.vy *= fr;
      const curl = 0.32 * t.dir * Math.min(1, t.s) * dt;
      const c = Math.cos(curl), sn = Math.sin(curl);
      const vx = t.vx * c - t.vy * sn, vy = t.vx * sn + t.vy * c;
      t.vx = vx; t.vy = vy;
      // low spin: the wobble makes it wander
      if (t.s < 0.3) {
        t.wobbleT += dt * (4 + 6 * (0.3 - t.s));
        const w = (0.3 - t.s) / 0.3 * 2.2;
        t.vx += Math.cos(t.wobbleT * t.dir) * w * dt;
        t.vy += Math.sin(t.wobbleT * t.dir) * w * dt;
      }
      t.x += t.vx * dt; t.y += t.vy * dt;
      // spin decay (stamina)
      t.s -= dt * ar.decay * (1.15 - 0.05 * t.sta) / 32 * (1 + 0.25 * Math.max(0, t.s - 1));
      void d;
    }
    // collisions
    for (let i = 0; i < tops.length; i++) {
      const a = tops[i];
      if (!a.alive || !a.launched || a.air > 0) continue;
      for (let j = i + 1; j < tops.length; j++) {
        const b = tops[j];
        if (!b.alive || !b.launched || b.air > 0) continue;
        this.collide(a, b);
      }
    }
    // eliminations
    let before = 0;
    for (const t of tops) if (t.alive) before++;
    const dying: Top[] = [];
    for (const t of tops) {
      if (!t.alive || !t.launched || t.air > 0) continue;
      if (t.dist > R + 0.15) { t.out = Out.Ring; dying.push(t); }
      else if (t.s <= 0) { t.s = 0; t.out = Out.Topple; dying.push(t); }
    }
    if (dying.length > 0) {
      // never a draw: if everyone left goes at once, the one with most spin stays in
      if (dying.length === before && before > 0 && this.winner < 0) {
        let best = dying[0];
        for (const t of dying) if (t.s > best.s) best = t;
        best.out = Out.None;
        if (best.s <= 0) best.s = 0.02;
        if (best.dist > R + 0.15) { const k = (R - 0.2) / best.dist; best.x *= k; best.y *= k; best.vx *= -0.3; best.vy *= -0.3; }
        dying.splice(dying.indexOf(best), 1);
      }
      for (const t of dying) {
        t.alive = false; t.outT = 0;
        this.events?.push({ type: t.out === Out.Ring ? Ev.RingOut : Ev.Topple, a: t.id, b: -1, x: t.x, y: t.y, impact: t.speed });
      }
    }
    if (this.winner < 0) {
      let alive = 0, last = -1;
      for (const t of tops) if (t.alive) { alive++; last = t.id; }
      if (alive <= 1 && tops.length > 1) this.winner = last;
    }
  }

  private collide(a: Top, b: Top) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const rr = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 < 1e-9) return;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    // separate by mass
    const pen = rr - d, im = 1 / a.m, jm = 1 / b.m, sum = im + jm;
    a.x -= nx * pen * (im / sum); a.y -= ny * pen * (im / sum);
    b.x += nx * pen * (jm / sum); b.y += ny * pen * (jm / sum);
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn > 0) return; // separating
    const impact = -vn;
    // who is doing the hitting: approach speeds along the contact normal
    const ua = Math.max(0, a.vx * nx + a.vy * ny), ub = Math.max(0, -(b.vx * nx + b.vy * ny));
    const shareA = ua + ub > 0.01 ? ua / (ua + ub) : 0.5, shareB = 1 - shareA;
    const e = 0.6;
    const j = (-(1 + e) * vn) / sum;
    a.vx -= j * nx * im; a.vy -= j * ny * im;
    b.vx += j * nx * jm; b.vy += j * ny * jm;
    // spin power: the faster, harder top shoves the other away and eats its spin
    const pa = Math.min(1.1, a.s) * (0.55 + 0.15 * a.atk), pb = Math.min(1.1, b.s) * (0.55 + 0.15 * b.atk);
    const hit = Math.min(18, impact + 1);
    const kb = 0.6 * hit;
    const toB = kb * pa * (0.3 + 1.4 * shareA) * (1 + Math.max(0, a.s - b.s)) * (1.15 - 0.07 * b.def);
    const toA = kb * pb * (0.3 + 1.4 * shareB) * (1 + Math.max(0, b.s - a.s)) * (1.15 - 0.07 * a.def);
    b.vx += nx * toB * jm; b.vy += ny * toB * jm;
    a.vx -= nx * toA * im; a.vy -= ny * toA * im;
    // grind: spinning surfaces kick each other sideways
    const tx = -ny, ty = nx;
    const g = 0.12 * hit;
    a.vx += tx * g * b.dir * Math.min(1, b.s) * im; a.vy += ty * g * b.dir * Math.min(1, b.s) * im;
    b.vx -= tx * g * a.dir * Math.min(1, a.s) * jm; b.vy -= ty * g * a.dir * Math.min(1, a.s) * jm;
    // spin drain
    const base = 0.008 + 0.0075 * hit;
    const drainB = base * (0.55 + pa) * (0.3 + 1.4 * shareA) * (1 + Math.max(0, a.s - b.s)) * (1.25 - 0.09 * b.def);
    const drainA = base * (0.55 + pb) * (0.3 + 1.4 * shareB) * (1 + Math.max(0, b.s - a.s)) * (1.25 - 0.09 * a.def);
    a.s -= drainA; b.s -= drainB;
    a.hits++; b.hits++;
    a.dealt += drainB; b.dealt += drainA;
    a.maxHit = Math.max(a.maxHit, impact); b.maxHit = Math.max(b.maxHit, impact);
    this.events?.push({ type: Ev.Hit, a: a.id, b: b.id, x: a.x + nx * a.r, y: a.y + ny * a.r, impact });
  }
}

// ------------------------------------------------------------------ bots

export interface LaunchPlan { ax: number; ay: number; power: number }

export const BotFlags = { dodge: true, side: true, lead: true };

export class Bot {
  private thinkT = 0;
  private tx = 0; private ty = 0;
  constructor(public lvl: BotLevel, private rng: Rng) {}

  /** Picks a launch by simulating candidates (others assumed to launch at the centre with medium power). */
  planLaunch(sim: Sim, me: number, known: Map<number, LaunchPlan> = new Map()): LaunchPlan {
    const t = sim.tops[me];
    const base = Math.atan2(-t.sy, -t.sx);
    let best: LaunchPlan = { ax: Math.cos(base), ay: Math.sin(base), power: 0.55 }, bestScore = -1e9;
    // opponents' launches are unknown: score every candidate against the same few guesses
    const guesses: [number, number][][] = [];
    for (let k = 0; k < 4; k++) guesses.push(sim.tops.map(() => [k === 0 ? 0 : this.rng.gauss() * 0.4, k === 0 ? 0.95 : this.rng.range(0.5, 1)] as [number, number]));
    const angs = [-36, -26, -18, -10, -4, 0, 4, 10, 18, 26, 36];
    const pows = [0.3, 0.45, 0.6, 0.75, 0.9, 1];
    const tries = Math.max(6, Math.round(angs.length * pows.length * this.lvl.plan));
    const cands: [number, number][] = [];
    for (const a of angs) for (const p of pows) cands.push([a, p]);
    // weaker bots consider fewer options
    for (let k = cands.length - 1; k > 0; k--) { const j = this.rng.int(k + 1); [cands[k], cands[j]] = [cands[j], cands[k]]; }
    for (let c = 0; c < Math.min(tries, cands.length); c++) {
      const [da, p] = cands[c];
      const ang = base + (da * Math.PI) / 180;
      let score = 0;
      for (const g of guesses) {
        const sim2 = sim.clone();
        sim2.events = null;
        for (const o of sim2.tops) {
          if (o.id === me || o.launched) continue;
          const kp = known.get(o.id);
          if (kp) sim2.launch(o.id, kp.ax, kp.ay, kp.power);
          else { const oa = Math.atan2(-o.sy, -o.sx) + g[o.id][0]; sim2.launch(o.id, Math.cos(oa), Math.sin(oa), g[o.id][1]); }
        }
        sim2.launch(me, Math.cos(ang), Math.sin(ang), p);
        for (let k = 0; k < 480; k++) sim2.step(1 / 120);
        const mt = sim2.tops[me];
        if (!mt.alive) { score -= 1000; continue; }
        score += mt.s * 150 - Math.max(0, mt.dist / R - 0.5) * 60;
        for (const o of sim2.tops) if (o.id !== me) score += o.alive ? -o.s * 100 / (sim2.tops.length - 1) : 250;
      }
      if (score > bestScore) { bestScore = score; best = { ax: Math.cos(ang), ay: Math.sin(ang), power: p }; }
    }
    // human error
    const err = (this.rng.gauss() * this.lvl.aimErr * Math.PI) / 180;
    const a0 = Math.atan2(best.ay, best.ax) + err;
    const pw = Math.max(0.2, Math.min(1, best.power + this.rng.gauss() * this.lvl.powErr));
    return { ax: Math.cos(a0), ay: Math.sin(a0), power: pw };
  }

  /** Sets the bot's nudge input for this frame. */
  drive(sim: Sim, me: number, dt: number) {
    const t = sim.tops[me];
    if (!t.alive) { t.nx = t.ny = 0; return; }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = this.lvl.think * (0.7 + 0.6 * this.rng.next());
      this.decide(sim, t);
    }
    t.nx = this.tx; t.ny = this.ty;
  }

  private ramming = 0;

  private decide(sim: Sim, t: Top) {
    const L = this.lvl;
    const look = 0.6;
    const px = t.x + t.vx * look, py = t.y + t.vy * look;
    const pd = Math.hypot(px, py);
    const outward = t.vx * t.x + t.vy * t.y > 0;
    this.tx = 0; this.ty = 0;
    // stay in the ring
    if (pd > R * L.edge && (outward || pd > R * 0.9)) {
      const k = Math.min(1, (pd - R * L.edge) / (R * 0.15) + 0.4) * L.strength;
      this.tx = (-px / pd) * k; this.ty = (-py / pd) * k;
      this.ramming = 0;
      return;
    }
    // pick a target: the nearest live rival (weaker bots sometimes pick at random)
    let target: Top | null = null, bd = 1e9;
    for (const o of sim.tops) {
      if (o === t || !o.alive || !o.launched || o.air > 0) continue;
      const d = Math.hypot(o.x - t.x, o.y - t.y) + (this.rng.next() < 1 - L.plan ? this.rng.next() * 6 : 0);
      if (d < bd) { bd = d; target = o; }
    }
    if (!target) return;
    bd = Math.hypot(target.x - t.x, target.y - t.y);
    const my = t.s * (0.7 + 0.1 * t.atk), their = target.s * (0.7 + 0.1 * target.atk);
    const strong = my >= their * 0.9;
    // start a ram burst when it pays off: we are stronger, or they sit near the edge
    const theirEdge = target.dist / R;
    let alive = 0;
    for (const o of sim.tops) if (o.alive) alive++;
    // in a crowd, clever tops let the others fight and only pounce on easy prey
    const crowd = alive >= 3 && L.plan > 0.5;
    const worth = crowd ? (theirEdge > 0.55 && strong) || my > their * 1.5 : strong || theirEdge > 0.6 || L.plan < 0.5;
    if (this.ramming <= 0 && t.energy > 0.45 && bd < 7.5 && worth && this.rng.next() < L.ram) this.ramming = 0.5 + 0.7 * L.plan;
    if (this.ramming > 0) {
      this.ramming -= L.think;
      const lead = BotFlags.lead ? Math.min(0.7, bd / 9) * L.plan : 0;
      const ox = target.x + target.vx * lead, oy = target.y + target.vy * lead;
      const od = Math.hypot(ox, oy) || 1;
      // come in from the centre side so the hit pushes them out
      const side = BotFlags.side ? Math.min(1, bd / 3) * L.plan : 0;
      const ax = ox - (ox / od) * 1.2 * side - t.x, ay = oy - (oy / od) * 1.2 * side - t.y;
      const al = Math.hypot(ax, ay) || 1;
      this.tx = (ax / al) * L.strength; this.ty = (ay / al) * L.strength;
      if (t.energy < 0.1) this.ramming = 0;
      return;
    }
    const incoming = (target.vx * (t.x - target.x) + target.vy * (t.y - target.y)) / Math.max(0.1, bd) > 2.5;
    if (BotFlags.dodge && (!strong || (crowd && incoming)) && L.plan > 0.5 && bd < 3.5 && t.energy > 0.2) {
      // dodge sideways, towards the middle
      const ax = t.x - target.x, ay = t.y - target.y;
      const al = Math.hypot(ax, ay) || 1;
      let dx = -ay / al, dy = ax / al;
      if (dx * -t.x + dy * -t.y < 0) { dx = -dx; dy = -dy; }
      this.tx = dx * L.strength * 0.8; this.ty = dy * L.strength * 0.8;
    } else if (L.plan < 0.5 && this.rng.next() < 0.3) {
      // restless beginners fidget
      const a = this.rng.next() * Math.PI * 2;
      this.tx = Math.cos(a) * 0.6; this.ty = Math.sin(a) * 0.6;
    }
  }
}

// ------------------------------------------------------------------ stages

export const RivalNames = ["SPIKE", "LULU", "BUZZ", "MOE", "PIP", "ZARA", "DUSTY", "KIKO", "RUFUS", "TAMMY", "OLLIE", "NINA", "BEANS", "JOJO", "MAX", "IVY", "TEDDY", "SKIP", "ROSA", "GUS"];
export const PaintCount = 8;

export interface RivalSpec { name: string; design: number; paint: number; boost: number; bot: BotLevel }
export interface StageSpec { n: number; arena: number; rivals: RivalSpec[]; title: string }

export function arenasUnlocked(stageReached: number) { return Arenas.filter((a) => stageReached >= a.unlock).length; }

/** The endless School Yard Tour: stage n (1-based) is always the same line-up. */
export function makeStage(n: number): StageSpec {
  const rng = new Rng(n * 7919 + 13);
  const count = n <= 3 ? 1 : n % 5 === 0 ? 3 : n % 3 === 0 || n % 5 === 3 ? 2 : 1;
  const unlocked = arenasUnlocked(n);
  const arena = n < 4 ? 0 : n === Arenas[unlocked - 1].unlock ? unlocked - 1 : rng.int(unlocked);
  const t = Math.min(0.6, (n - 1) / 50);
  const boost = n > 40 ? Math.min(1, (n - 40) / 30) : 0;
  const rivals: RivalSpec[] = [];
  const names = RivalNames.slice();
  for (let i = 0; i < count; i++) {
    const nm = names.splice(rng.int(names.length), 1)[0];
    const maxD = Math.min(Designs.length - 1, Math.floor(n / 6));
    const tt = Math.max(0, t - (count - 1) * 0.22 + rng.range(-0.05, 0.05));
    const bot = tt < 0.5 ? lerpBot(BotEasy, BotMedium, tt * 2) : lerpBot(BotMedium, BotHard, (tt - 0.5) * 2);
    rivals.push({ name: nm, design: rng.int(maxD + 1), paint: rng.int(PaintCount), boost: boost - (count - 1) * 0.5 - (n <= 3 ? 1 : n <= 6 ? 0.5 : 0), bot });
  }
  const title = count === 1 ? "1 VS 1" : count === 2 ? "3-WAY RUMBLE" : "4-WAY RUMBLE";
  return { n, arena, rivals, title };
}

/** Today's daily challenge: a seeded line-up on any arena. */
export function makeDaily(day: number): StageSpec {
  const rng = new Rng(day * 104729 + 7);
  const count = 2 + rng.int(2);
  const arena = rng.int(Arenas.length);
  const rivals: RivalSpec[] = [];
  const names = RivalNames.slice();
  for (let i = 0; i < count; i++) {
    const nm = names.splice(rng.int(names.length), 1)[0];
    rivals.push({ name: nm, design: rng.int(Designs.length), paint: rng.int(PaintCount), boost: 0, bot: lerpBot(BotMedium, BotHard, rng.range(0.1, 0.5)) });
  }
  return { n: day, arena, rivals, title: count === 2 ? "3-WAY RUMBLE" : "4-WAY RUMBLE" };
}

export function dayNumber(now = Date.now()) {
  const d = new Date(now);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
