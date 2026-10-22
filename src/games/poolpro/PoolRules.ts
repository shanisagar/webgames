import { castCue, D, HeadX, MaxSpeed, MuSlide, PoolSim, RollC0, RollC2, BreakBoost, R, Rng, segDist, ShotRecord, Table, TH, TW } from "./PoolPhysics";

/**
 * POOL PRO rules (8-ball, simplified WPA) and the CPU opponent. No kit dependencies (runs headless in node).
 *
 * Rules: open table after the break; the first legal pot after the break assigns solids / stripes. A legal shot must
 * hit one of your own balls first (any but the 8 on an open table, the 8 once your group is cleared) and then pot a
 * ball or drive any ball to a cushion. Fouls (scratch, no contact, wrong ball first, no rail) give the opponent ball
 * in hand anywhere. Potting the 8 early, or on a foul, loses; potting it legally after your group wins. The 8 on the
 * break is re-spotted. No called pockets.
 */

export const Open = 0, Solids = 1, Stripes = 2;
export const groupOf = (n: number) => (n >= 1 && n <= 7 ? Solids : n >= 9 && n <= 15 ? Stripes : Open);
export const GroupName = ["OPEN", "SOLIDS", "STRIPES"];

export interface Outcome {
  foul: boolean;
  foulReason: string;
  continues: boolean;
  /** group assigned to the shooter on this shot (0 = none) */
  assigned: number;
  win: boolean;
  lose: boolean;
  reason: string;
  respot8: boolean;
  ownPotted: number;
}

export class Frame {
  groups = [Open, Open];
  turn = 0;
  breakShot = true;
  ballInHand = true;
  /** ball in hand restricted behind the head string (the break) */
  kitchen = true;
  over = false;
  winner = -1;
  reason = "";

  constructor(breaker = 0) { this.turn = breaker; }

  clone() {
    const f = new Frame(this.turn);
    f.groups = [...this.groups]; f.breakShot = this.breakShot; f.ballInHand = this.ballInHand; f.kitchen = this.kitchen;
    f.over = this.over; f.winner = this.winner; f.reason = this.reason;
    return f;
  }

  remaining(player: number, sim: PoolSim) {
    const g = this.groups[player];
    if (g === Open) return 7;
    let n = 0;
    for (let i = 1; i < 16; i++) if (sim.on[i] && groupOf(i) === g) n++;
    return n;
  }

  onEight(player: number, sim: PoolSim) { return this.groups[player] !== Open && this.remaining(player, sim) === 0; }

  /** Balls the player may legally hit first. */
  targets(player: number, sim: PoolSim): number[] {
    const out: number[] = [];
    const g = this.groups[player];
    const eight = this.onEight(player, sim);
    for (let i = 1; i < 16; i++) {
      if (!sim.on[i]) continue;
      if (eight ? i === 8 : this.breakShot ? true : g === Open ? i !== 8 : groupOf(i) === g) out.push(i);
    }
    return out;
  }

  /** Judges a finished shot. `eightBefore`: the shooter was on the 8 when the shot began. */
  judge(_sim: PoolSim, rec: ShotRecord, eightBefore: boolean): Outcome {
    const me = this.turn;
    const g = this.groups[me];
    const o: Outcome = { foul: false, foulReason: "", continues: false, assigned: Open, win: false, lose: false, reason: "", respot8: false, ownPotted: 0 };
    const potted = rec.potted;
    const eight = potted.includes(8);
    if (rec.cuePotted) { o.foul = true; o.foulReason = "SCRATCH"; }
    else if (rec.firstContact < 0) { o.foul = true; o.foulReason = "NO BALL HIT"; }
    else if (!this.breakShot) {
      const fc = rec.firstContact;
      if (eightBefore) { if (fc !== 8) { o.foul = true; o.foulReason = "HIT THE 8 FIRST!"; } }
      else if (g === Open) { if (fc === 8) { o.foul = true; o.foulReason = "8 BALL HIT FIRST"; } }
      else if (groupOf(fc) !== g) { o.foul = true; o.foulReason = "WRONG BALL FIRST"; }
      if (!o.foul && potted.length === 0 && !rec.railAfterContact) { o.foul = true; o.foulReason = "NO RAIL AFTER CONTACT"; }
    }
    if (eight) {
      if (this.breakShot) o.respot8 = true;
      else if (eightBefore && !o.foul) { o.win = true; o.reason = "8 BALL POTTED"; return o; }
      else { o.lose = true; o.reason = o.foul ? (rec.cuePotted ? "SCRATCHED ON THE 8" : "FOUL ON THE 8") : "8 BALL POTTED EARLY"; return o; }
    }
    const objects = potted.filter((n) => n !== 8);
    if (!o.foul && !this.breakShot && g === Open && objects.length > 0) o.assigned = groupOf(objects[0]);
    const mine = g !== Open ? g : o.assigned;
    o.ownPotted = mine === Open ? 0 : objects.filter((n) => groupOf(n) === mine).length;
    if (!o.foul) o.continues = this.breakShot ? objects.length > 0 : o.ownPotted > 0;
    return o;
  }

  /** Applies a judged shot: groups, turn, ball in hand, frame over. Re-spots the 8 if needed. */
  apply(o: Outcome, sim: PoolSim) {
    const me = this.turn;
    if (o.win || o.lose) {
      this.over = true;
      this.winner = o.win ? me : 1 - me;
      this.reason = o.reason;
      return;
    }
    if (o.assigned !== Open) { this.groups[me] = o.assigned; this.groups[1 - me] = o.assigned === Solids ? Stripes : Solids; }
    if (o.respot8) sim.spot(8);
    this.breakShot = false;
    this.kitchen = false;
    this.ballInHand = o.foul;
    if (o.foul && !sim.on[0]) sim.place(0, HeadX, 0);
    if (!o.continues) this.turn = 1 - me;
  }
}

// ------------------------------------------------------------------ distance model (for shot speeds)

/** Distance a ball struck with no spin travels on open cloth before stopping (same friction as PoolSim). */
const distTable: number[] = [];
const SpeedStep = 0.5;
(function buildDistTable() {
  for (let v0 = 0; v0 <= MaxSpeed + 1; v0 += SpeedStep) {
    let vx = v0, rx = 0, dist = 0;
    const h = 1 / 480;
    for (let t = 0; t < 40 && (vx > 0.005 || Math.abs(rx) > 0.005); t += h) {
      const u = vx - rx;
      if (Math.abs(u) > 1e-4) {
        const dv = MuSlide * h;
        if (Math.abs(u) <= 3.5 * dv) { vx -= u / 3.5; rx = vx; }
        else { const su = Math.sign(u); vx -= dv * su; rx += 2.5 * dv * su; }
        const k = Math.max(0, 1 - RollC2 * vx * h);
        vx *= k; rx *= k;
      } else {
        const dec = (RollC0 + RollC2 * vx * vx) * h;
        vx = vx <= dec ? 0 : vx - dec;
        rx = vx;
      }
      dist += vx * h;
    }
    distTable.push(dist);
  }
})();

export function travel(v: number) {
  const f = Math.max(0, v) / SpeedStep, i = Math.min(distTable.length - 2, Math.floor(f));
  return distTable[i] + (distTable[i + 1] - distTable[i]) * Math.min(1, f - i);
}

export function speedFor(dist: number) {
  for (let i = 1; i < distTable.length; i++) if (distTable[i] >= dist) return (i - 1 + (dist - distTable[i - 1]) / (distTable[i] - distTable[i - 1])) * SpeedStep;
  return MaxSpeed;
}

// ------------------------------------------------------------------ CPU

export interface AiLevel {
  /** aim error, degrees (1 sigma) */
  noiseDeg: number;
  /** relative power error (1 sigma) */
  powerNoise: number;
  /** pot candidates rolled out */
  candidates: number;
  /** uses spin and plays for position */
  position: boolean;
  /** perturbed rollouts per finalist to estimate pot probability */
  samples: number;
}

export interface ShotPlan {
  dx: number; dy: number; speed: number; top: number; side: number;
  target: number; pocket: number; score: number; kind: "pot" | "safety" | "break" | "kick";
}

interface Cand { ball: number; pocket: number; dx: number; dy: number; geo: number; cut: number; dCue: number; dObj: number }

/** Geometric pot candidates from a cue position: clear paths, makeable cut, pocket approach. */
export function potCandidates(sim: PoolSim, cx: number, cy: number, targets: number[]): Cand[] {
  const out: Cand[] = [];
  for (const b of targets) {
    const bx = sim.x[b], by = sim.y[b];
    for (let p = 0; p < Table.pockets.length; p++) {
      const pk = Table.pockets[p];
      let ox = pk.ax - bx, oy = pk.ay - by;
      const dObj = Math.hypot(ox, oy);
      if (dObj < 1e-6) continue;
      ox /= dObj; oy /= dObj;
      const approach = ox * pk.dx + oy * pk.dy;
      if (approach < (pk.side ? 0.62 : 0.5)) continue;
      const gx = bx - ox * D, gy = by - oy * D;
      if (Math.abs(gx) > TW / 2 - R + 0.02 || Math.abs(gy) > TH / 2 - R + 0.02) continue;
      let ax = gx - cx, ay = gy - cy;
      const dCue = Math.hypot(ax, ay);
      if (dCue < 1e-6) continue;
      ax /= dCue; ay /= dCue;
      const cut = ax * ox + ay * oy;
      if (cut < 0.2) continue;
      let blocked = false;
      for (let k = 0; k < 16 && !blocked; k++) {
        if (k === 0 || k === b || !sim.on[k]) continue;
        if (segDist(sim.x[k], sim.y[k], cx, cy, gx, gy) < D - 0.01) blocked = true;
        else if (segDist(sim.x[k], sim.y[k], bx, by, pk.ax, pk.ay) < D + 0.02) blocked = true;
      }
      if (blocked) continue;
      // the cue ball path itself must reach this ball first
      const hit = castCue(sim, cx, cy, ax, ay);
      if (hit.ball !== b) continue;
      const tol = Math.atan((pk.half - R * 0.7) * (pk.side ? approach : 1) / Math.max(0.5, dObj));
      const geo = Math.pow(cut, 1.4) * Math.min(1, tol / 0.12) * Math.exp(-dCue / 40) * (pk.side ? 0.85 : 1);
      out.push({ ball: b, pocket: p, dx: ax, dy: ay, geo, cut, dCue, dObj });
    }
  }
  out.sort((a, b) => b.geo - a.geo);
  return out;
}

/** How good the table is for `player` with the cue ball where it lies (0 = no shot). */
export function leaveScore(sim: PoolSim, frame: Frame, player: number) {
  if (!sim.on[0]) return 0;
  const c = potCandidates(sim, sim.x[0], sim.y[0], frame.targets(player, sim));
  if (c.length === 0) return 0;
  return c[0].geo + 0.15 * Math.min(4, c.length - 1);
}

export class PoolAI {
  constructor(public level: AiLevel, public rng: Rng) {}

  /** Break: from the head string at the apex, hard. */
  planBreak(sim: PoolSim): { x: number; y: number; plan: ShotPlan } {
    const y = this.rng.range(-1.2, 1.2);
    const x = HeadX;
    let tx = sim.x[1], ty = sim.y[1];
    if (!sim.on[1]) { tx = sim.x[8]; ty = sim.y[8]; }
    return { x, y, plan: { dx: tx - x, dy: ty - y + this.rng.range(-0.04, 0.04), speed: MaxSpeed * BreakBoost * this.rng.range(0.85, 0.97), top: -0.1, side: 0, target: 1, pocket: -1, score: 0, kind: "break" } };
  }

  /** Where to put the cue ball with ball in hand. */
  placeCue(sim: PoolSim, frame: Frame, player: number): { x: number; y: number } {
    const targets = frame.targets(player, sim);
    let best = { x: HeadX, y: 0 }, bestS = -1;
    const tryAt = (x: number, y: number) => {
      if (!sim.fits(x, y, 0, frame.kitchen)) return;
      const c = potCandidates(sim, x, y, targets);
      const s = c.length ? c[0].geo + 0.05 * Math.min(3, c.length - 1) : 0;
      if (s > bestS) { bestS = s; best = { x, y }; }
    };
    for (const b of targets)
      for (const pk of Table.pockets) {
        let ox = pk.ax - sim.x[b], oy = pk.ay - sim.y[b];
        const l = Math.hypot(ox, oy); ox /= l; oy /= l;
        for (const k of [1.6, 2.6, 4]) for (const a of [0, 0.3, -0.3]) {
          const c = Math.cos(a), s = Math.sin(a);
          const dx = ox * c - oy * s, dy = ox * s + oy * c;
          tryAt(sim.x[b] - ox * D - dx * k, sim.y[b] - oy * D - dy * k);
        }
      }
    if (bestS < 0) {
      for (let i = 0; i < 60; i++) { const x = this.rng.range(-TW / 2 + 1, frame.kitchen ? HeadX : TW / 2 - 1), y = this.rng.range(-TH / 2 + 1, TH / 2 - 1); if (sim.fits(x, y)) return { x, y }; }
    }
    return best;
  }

  private rollout(sim: PoolSim, frame: Frame, player: number, dx: number, dy: number, speed: number, top: number, side: number) {
    const s = sim.clone();
    s.events = null;
    const eightBefore = frame.onEight(player, sim);
    s.shoot(dx, dy, speed, top, side);
    s.runToRest(25);
    const f = frame.clone();
    f.turn = player;
    const o = f.judge(s, s.record, eightBefore);
    f.apply(o, s);
    let score: number;
    if (o.win) score = 1000;
    else if (o.lose) score = -1000;
    else if (o.foul) score = -300 - leaveScore(s, f, 1 - player) * 50;
    else if (o.continues) score = 200 + (this.level.position ? leaveScore(s, f, player) * 60 : 0);
    else score = -leaveScore(s, f, 1 - player) * 60;
    return { score, o, potted: o.continues || o.win };
  }

  /**
   * Picks a shot. A generator so the game can spread the rollouts over frames (yields after each rollout).
   * Candidate cut shots for the CPU's group are scored by simulated outcome, pot probability (perturbed rollouts)
   * and the cue-ball leave; safeties and kick shots are the fallback.
   */
  *plan(sim: PoolSim, frame: Frame, player: number): Generator<void, ShotPlan, void> {
    const L = this.level;
    const cx = sim.x[0], cy = sim.y[0];
    const targets = frame.targets(player, sim);
    const cands = potCandidates(sim, cx, cy, targets).slice(0, L.candidates);
    const options: ShotPlan[] = [];
    for (const c of cands) {
      const vo = speedFor(c.dObj + 1.2) / Math.max(0.35, c.cut * 0.97);
      const base = speedFor(c.dCue + travel(vo));
      const speeds = L.position ? [1, 1.35, 1.9] : [1.25, 1.8];
      const spins = L.position ? [0, 0.6, -0.6] : [0];
      for (const k of speeds)
        for (const top of spins) {
          const speed = Math.min(MaxSpeed * 0.92, Math.max(3, base * k));
          const r = this.rollout(sim, frame, player, c.dx, c.dy, speed, top, 0);
          options.push({ dx: c.dx, dy: c.dy, speed, top, side: 0, target: c.ball, pocket: c.pocket, score: r.score + c.geo * 20, kind: "pot" });
          yield;
        }
    }
    options.sort((a, b) => b.score - a.score);
    // pot probability: perturb the best few by the CPU's own aim error
    if (L.samples > 0) {
      const fin = options.filter((o) => o.score > 100).slice(0, 3);
      for (const o of fin) {
        let ok = 0, total = 0;
        const sig = Math.max(0.15, L.noiseDeg) * Math.PI / 180;
        for (let i = 0; i < L.samples; i++) {
          const a = (i % 2 === 0 ? 1 : -1) * sig * (0.6 + Math.floor(i / 2) * 0.6);
          const c = Math.cos(a), s = Math.sin(a);
          const r = this.rollout(sim, frame, player, o.dx * c - o.dy * s, o.dx * s + o.dy * c, o.speed, o.top, o.side);
          total += r.score; if (r.potted) ok++;
          yield;
        }
        const p = ok / L.samples;
        o.score = o.score * (0.4 + 0.6 * p) + total / L.samples * 0.3;
      }
      options.sort((a, b) => b.score - a.score);
    }
    if (options.length && options[0].score > 150) return options[0];
    // safeties: direct hits on legal balls with modest speed
    const safe: ShotPlan[] = [...options];
    for (const b of targets) {
      let dx = sim.x[b] - cx, dy = sim.y[b] - cy;
      const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      for (const off of [0, 0.35, -0.35]) {
        const ox = -dy * off * D, oy = dx * off * D;
        const ex = sim.x[b] + ox - cx, ey = sim.y[b] + oy - cy;
        const hit = castCue(sim, cx, cy, ex, ey);
        if (hit.ball !== b) continue;
        for (const sp of [7, 12, 18]) {
          const r = this.rollout(sim, frame, player, ex, ey, sp, 0, 0);
          safe.push({ dx: ex, dy: ey, speed: sp, top: 0, side: 0, target: b, pocket: -1, score: r.score, kind: "safety" });
          yield;
        }
      }
    }
    safe.sort((a, b) => b.score - a.score);
    if (safe.length && safe[0].score > -250) return safe[0];
    // kicks: sample directions, keep the best legal one
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2 + this.rng.range(0, 0.1);
      for (const sp of [14, 24]) {
        const r = this.rollout(sim, frame, player, Math.cos(a), Math.sin(a), sp, 0, 0);
        safe.push({ dx: Math.cos(a), dy: Math.sin(a), speed: sp, top: 0, side: 0, target: -1, pocket: -1, score: r.score, kind: "kick" });
      }
      yield;
    }
    safe.sort((a, b) => b.score - a.score);
    return safe[0];
  }

  /** The CPU's hand isn't perfect: aim and power error by level. */
  noisy(p: ShotPlan): ShotPlan {
    const L = this.level;
    const k = p.kind === "break" ? 0.5 : 1;
    const a = this.rng.gauss() * L.noiseDeg * k * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const l = Math.hypot(p.dx, p.dy) || 1;
    const dx = p.dx / l, dy = p.dy / l;
    return { ...p, dx: dx * c - dy * s, dy: dx * s + dy * c, speed: Math.min(p.kind === "break" ? MaxSpeed * BreakBoost : MaxSpeed, p.speed * (1 + this.rng.gauss() * L.powerNoise)) };
  }
}
