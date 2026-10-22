/**
 * AIR HOCKEY physics (no kit dependencies, runs headless): a rounded-corner rink with a goal slot in each end wall,
 * a puck on an air cushion (almost no friction), two kinematic mallets that chase their targets with a speed limit and
 * hand their velocity to the puck on contact, plus optional moving blocker bars (solo challenge).
 *
 * Units: rink units, y up, the rink is 10 wide (x) and 18 long (y). Player 0 defends the bottom goal (y = -9).
 * Continuous collision: every step is split into substeps so that neither the puck nor a mallet moves more than a
 * quarter of the puck's radius per substep, relative to each other, so the puck never tunnels through a mallet,
 * a wall or a post even at full speed.
 */

export const HW = 5, HL = 9, RP = 0.42, RM = 0.78, GoalHalf = 1.75, CornerR = 1.5, PostR = 0.12;
export const MaxPuck = 62, MalletMax = 90;
const WallE = 0.86, MalletE = 0.82, BlockE = 0.95;
const Air = 0.18; // velocity loss per second
const WallGrip = 0.98;

export const Ev = { Mallet: 1, Wall: 2, Post: 3, Goal: 4, Block: 5 } as const;
export interface HockeyEvent { type: number; a: number; speed: number; x: number; y: number }

export interface Mallet { x: number; y: number; vx: number; vy: number; tx: number; ty: number; max: number; px: number; py: number }
export interface Blocker { x: number; y: number; half: number; r: number; vx: number; minX: number; maxX: number }

export class Rink {
  px = 0; py = 0; vx = 0; vy = 0;
  m: Mallet[] = [0, 1].map((i) => ({ x: 0, y: i === 0 ? -6.5 : 6.5, vx: 0, vy: 0, tx: 0, ty: i === 0 ? -6.5 : 6.5, max: MalletMax, px: 0, py: i === 0 ? -6.5 : 6.5 }));
  blockers: Blocker[] = [];
  /** goal scored this step: 0 = into the bottom goal (player 1 scores), 1 = into the top goal, -1 none */
  goal = -1;
  puckOn = true;
  lastTouch = -1;
  events: HockeyEvent[] | null = null;
  /** solo: the top end wall is a full wall except the goal; both goals are open in every mode */
  time = 0;

  resetMallets() {
    for (let i = 0; i < 2; i++) { const m = this.m[i]; m.x = m.tx = m.px = 0; m.y = m.ty = m.py = i === 0 ? -6.5 : 6.5; m.vx = m.vy = 0; }
  }

  placePuck(x: number, y: number, vx = 0, vy = 0) { this.px = x; this.py = y; this.vx = vx; this.vy = vy; this.puckOn = true; this.goal = -1; this.lastTouch = -1; }

  /** Clamps a target to a mallet's half. */
  static clampTarget(i: number, x: number, y: number) {
    const lx = HW - RM, ly = HL - RM;
    x = Math.max(-lx, Math.min(lx, x));
    y = i === 0 ? Math.max(-ly, Math.min(-RM * 0.98, y)) : Math.min(ly, Math.max(RM * 0.98, y));
    // keep out of the rounded corners
    const cx = HW - CornerR, cy = HL - CornerR;
    const ax = Math.abs(x), ay = Math.abs(y);
    if (ax > cx && ay > cy) {
      const dx = ax - cx, dy = ay - cy, d = Math.hypot(dx, dy), lim = CornerR - RM;
      if (d > lim) { x = Math.sign(x) * (cx + (dx / d) * lim); y = Math.sign(y) * (cy + (dy / d) * lim); }
    }
    return [x, y];
  }

  step(dt: number) {
    this.goal = -1;
    this.time += dt;
    // where the mallets want to be this frame
    const from: [number, number][] = [], to: [number, number][] = [];
    let maxDisp = Math.hypot(this.vx, this.vy) * dt;
    for (let i = 0; i < 2; i++) {
      const m = this.m[i];
      const [tx, ty] = Rink.clampTarget(i, m.tx, m.ty);
      let dx = tx - m.x, dy = ty - m.y;
      const d = Math.hypot(dx, dy), lim = m.max * dt;
      if (d > lim) { dx *= lim / d; dy *= lim / d; }
      from.push([m.x, m.y]);
      to.push([m.x + dx, m.y + dy]);
      m.vx = dt > 0 ? dx / dt : 0; m.vy = dt > 0 ? dy / dt : 0;
      maxDisp = Math.max(maxDisp, Math.hypot(dx, dy) + Math.hypot(this.vx, this.vy) * dt);
    }
    for (const b of this.blockers) maxDisp = Math.max(maxDisp, Math.abs(b.vx) * dt + Math.hypot(this.vx, this.vy) * dt);
    const n = Math.min(60, Math.max(1, Math.ceil(maxDisp / (RP * 0.25))));
    const h = dt / n;
    for (let s = 1; s <= n; s++) {
      const k = s / n;
      for (let i = 0; i < 2; i++) { this.m[i].x = from[i][0] + (to[i][0] - from[i][0]) * k; this.m[i].y = from[i][1] + (to[i][1] - from[i][1]) * k; }
      for (const b of this.blockers) {
        b.x += b.vx * h;
        if (b.x > b.maxX) { b.x = b.maxX; b.vx = -Math.abs(b.vx); }
        if (b.x < b.minX) { b.x = b.minX; b.vx = Math.abs(b.vx); }
      }
      if (this.puckOn) this.sub(h);
      if (this.goal >= 0) break;
    }
    for (let i = 0; i < 2; i++) { this.m[i].px = from[i][0]; this.m[i].py = from[i][1]; }
  }

  private sub(h: number) {
    const k = Math.exp(-Air * h);
    this.vx *= k; this.vy *= k;
    this.px += this.vx * h; this.py += this.vy * h;
    // mallets (kinematic: infinite mass)
    for (let i = 0; i < 2; i++) {
      const m = this.m[i];
      let nx = this.px - m.x, ny = this.py - m.y;
      const d = Math.hypot(nx, ny), rr = RP + RM;
      if (d >= rr) continue;
      if (d < 1e-6) { nx = 0; ny = i === 0 ? 1 : -1; } else { nx /= d; ny /= d; }
      this.px = m.x + nx * rr; this.py = m.y + ny * rr;
      const rvx = this.vx - m.vx, rvy = this.vy - m.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        this.vx -= (1 + MalletE) * vn * nx; this.vy -= (1 + MalletE) * vn * ny;
        this.lastTouch = i;
        this.cap();
        if (this.events) this.events.push({ type: Ev.Mallet, a: i, speed: -vn, x: m.x + nx * RM, y: m.y + ny * RM });
      }
    }
    // blockers (kinematic capsules)
    for (const b of this.blockers) {
      const cx = Math.max(b.x - b.half, Math.min(b.x + b.half, this.px));
      let nx = this.px - cx, ny = this.py - b.y;
      const d = Math.hypot(nx, ny), rr = RP + b.r;
      if (d >= rr) continue;
      if (d < 1e-6) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
      this.px = cx + nx * rr; this.py = b.y + ny * rr;
      const vn = (this.vx - b.vx) * nx + this.vy * ny;
      if (vn < 0) {
        this.vx -= (1 + BlockE) * vn * nx; this.vy -= (1 + BlockE) * vn * ny;
        this.cap();
        if (this.events) this.events.push({ type: Ev.Block, a: -1, speed: -vn, x: cx + nx * b.r, y: b.y + ny * b.r });
      }
    }
    this.walls();
    // a mallet must never be left overlapping the puck after the walls pushed it back: slide the mallet away
    for (let i = 0; i < 2; i++) {
      const m = this.m[i];
      const dx = m.x - this.px, dy = m.y - this.py, d = Math.hypot(dx, dy), rr = RP + RM;
      if (d < rr && d > 1e-6) { m.x = this.px + (dx / d) * rr; m.y = this.py + (dy / d) * rr; }
    }
    // goal: the puck's centre is past the end line inside the slot
    if (Math.abs(this.px) < GoalHalf && Math.abs(this.py) > HL + RP * 0.6) {
      this.goal = this.py < 0 ? 0 : 1;
      this.puckOn = false;
      if (this.events) this.events.push({ type: Ev.Goal, a: this.goal, speed: Math.hypot(this.vx, this.vy), x: this.px, y: this.py });
    }
  }

  private cap() {
    const s = Math.hypot(this.vx, this.vy);
    if (s > MaxPuck) { this.vx *= MaxPuck / s; this.vy *= MaxPuck / s; }
  }

  private bounce(nx: number, ny: number, e: number, type: number, x: number, y: number) {
    const vn = this.vx * nx + this.vy * ny;
    if (vn >= 0) return;
    const tx = -ny, ty = nx;
    const vt = (this.vx * tx + this.vy * ty) * WallGrip;
    this.vx = -vn * e * nx + vt * tx; this.vy = -vn * e * ny + vt * ty;
    if (this.events && -vn > 0.4) this.events.push({ type, a: -1, speed: -vn, x, y });
  }

  private walls() {
    const lx = HW - RP, ly = HL - RP;
    const ax = Math.abs(this.px), ay = Math.abs(this.py);
    const sx = Math.sign(this.px) || 1, sy = Math.sign(this.py) || 1;
    const cx = HW - CornerR, cy = HL - CornerR;
    const inMouth = ax < GoalHalf;
    if (ax > cx && ay > cy && !inMouth) {
      const dx = ax - cx, dy = ay - cy, d = Math.hypot(dx, dy), lim = CornerR - RP;
      if (d > lim) {
        const nx = (-dx / d) * sx, ny = (-dy / d) * sy;
        this.px = sx * (cx + (dx / d) * lim); this.py = sy * (cy + (dy / d) * lim);
        this.bounce(nx, ny, WallE, Ev.Wall, sx * (cx + (dx / d) * CornerR), sy * (cy + (dy / d) * CornerR));
      }
      return;
    }
    if (ax > lx) { this.px = sx * lx; this.bounce(-sx, 0, WallE, Ev.Wall, sx * HW, this.py); }
    if (ay > ly && !inMouth) {
      // end wall, except across the goal slot
      if (ax >= GoalHalf + RP * 0.0 || ay < HL) { this.py = sy * ly; this.bounce(0, -sy, WallE, Ev.Wall, this.px, sy * HL); }
    }
    // goal posts (the slot's edges)
    for (const gx of [-GoalHalf, GoalHalf]) {
      const dx = this.px - gx, dy = this.py - sy * HL, d = Math.hypot(dx, dy), rr = RP + PostR;
      if (d < rr && d > 1e-6) {
        const nx = dx / d, ny = dy / d;
        this.px = gx + nx * rr; this.py = sy * HL + ny * rr;
        this.bounce(nx, ny, WallE, Ev.Post, gx, sy * HL);
      }
    }
    // inside the slot the puck can't leave sideways (slot walls)
    if (ay > HL - 0.02 && ax > GoalHalf - RP && ax < GoalHalf + 0.3) {
      this.px = sx * (GoalHalf - RP);
      this.bounce(-sx, 0, WallE, Ev.Post, sx * GoalHalf, this.py);
    }
  }
}

// ------------------------------------------------------------------ CPU

export interface HockeyLevel { speed: number; react: number; aimErr: number; predict: number; banks: boolean; attack: number }
export const HockeyLevels: HockeyLevel[] = [
  { speed: 24, react: 0.28, aimErr: 1.4, predict: 0.45, banks: false, attack: 0.5 },
  { speed: 36, react: 0.14, aimErr: 0.7, predict: 0.9, banks: false, attack: 0.8 },
  { speed: 52, react: 0.05, aimErr: 0.25, predict: 1.4, banks: true, attack: 1 },
];

/** Straight-line puck prediction with wall reflections (no mallets): positions every `step` seconds. */
export function predict(px: number, py: number, vx: number, vy: number, seconds: number, step = 1 / 120) {
  const out: [number, number, number][] = [];
  const lx = HW - RP, ly = HL - RP;
  let t = 0;
  while (t < seconds) {
    const k = Math.exp(-Air * step);
    vx *= k; vy *= k;
    px += vx * step; py += vy * step;
    if (px > lx) { px = 2 * lx - px; vx = -vx * WallE; }
    if (px < -lx) { px = -2 * lx - px; vx = -vx * WallE; }
    if (Math.abs(py) > ly && Math.abs(px) >= GoalHalf) { py = Math.sign(py) * (2 * ly - Math.abs(py)); vy = -vy * WallE; }
    t += step;
    out.push([px, py, t]);
    if (Math.abs(py) > HL) break;
  }
  return out;
}

export class HockeyAI {
  private think = 0;
  private tx = 0; private ty = 6.5;
  private strikeT = 0; private aimX = 0; private aimY = -HL;
  private err = 0;
  constructor(public level: HockeyLevel, public side = 1, private rnd: () => number = Math.random) {}

  /** Updates mallet `side`'s target for this frame. */
  update(r: Rink, dt: number) {
    const L = this.level, m = r.m[this.side];
    const s = this.side === 1 ? 1 : -1; // +1: defends the top goal
    this.think -= dt;
    const homeY = s * (HL - 2.4);
    if (this.think <= 0) {
      this.think = L.react * (0.6 + this.rnd() * 0.8);
      this.err = (this.rnd() - 0.5) * 2 * L.aimErr;
      const inMyHalf = r.puckOn && r.py * s > 0;
      const towardMe = r.vy * s > 0.5;
      const sp = Math.hypot(r.vx, r.vy);
      if (!r.puckOn) { this.tx = 0; this.ty = homeY; this.strikeT = 0; }
      else if (inMyHalf && (sp < 14 || !towardMe) && this.rnd() < L.attack + 0.2) {
        // attack: line up behind the puck and drive through it towards a target in the far goal (or a bank)
        if (this.strikeT <= 0) {
          this.strikeT = 0.9;
          const bank = L.banks && this.rnd() < 0.4;
          this.aimX = bank ? (this.rnd() < 0.5 ? -1 : 1) * (2 * (HW - RP) - (this.rnd() - 0.5) * 1.6) : (this.rnd() - 0.5) * 2 * (GoalHalf - 0.5);
          this.aimY = -s * HL;
        }
      } else if (towardMe) {
        // defend: meet the puck where it will cross the defence line
        this.strikeT = 0;
        const defY = s * (HL - 1.6 - L.predict * 1.2);
        const path = predict(r.px, r.py, r.vx, r.vy, L.predict);
        let ix = r.px;
        for (const [x, y] of path) if (y * s >= defY * s) { ix = x; break; }
        if (path.length && path[path.length - 1][1] * s < defY * s) ix = path[path.length - 1][0];
        this.tx = Math.max(-GoalHalf - 0.6, Math.min(GoalHalf + 0.6, ix * 0.85 + this.err * 0.4));
        this.ty = defY;
      } else { this.strikeT = 0; this.tx = r.px * 0.35; this.ty = homeY; }
    }
    if (this.strikeT > 0 && r.puckOn) {
      this.strikeT -= dt;
      let dx = this.aimX - r.px, dy = this.aimY - r.py;
      const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const behindX = r.px - dx * (RP + RM + 0.25), behindY = r.py - dy * (RP + RM + 0.25);
      const bd = Math.hypot(m.x - behindX, m.y - behindY);
      // once lined up, drive through the puck
      if (bd < 0.45 || this.strikeT < 0.45) { this.tx = r.px + dx * 1.6 + this.err * 0.1; this.ty = r.py + dy * 1.6; }
      else {
        // go around the puck rather than through it
        const side = (m.x - r.px) * dy - (m.y - r.py) * dx;
        const around = Math.hypot(m.x - r.px, m.y - r.py) < RP + RM + 0.6 && ((m.x - r.px) * dx + (m.y - r.py) * dy) > -0.2;
        this.tx = around ? r.px + (side > 0 ? 1 : -1) * dy * 1.6 - dx * 0.9 : behindX;
        this.ty = around ? r.py - (side > 0 ? 1 : -1) * dx * 1.6 - dy * 0.9 : behindY;
      }
      if (r.py * s < 0) this.strikeT = 0;
    }
    m.tx = this.tx; m.ty = this.ty; m.max = L.speed;
  }
}
