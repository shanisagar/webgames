/**
 * AIR HOCKEY WALL physics (no kit dependencies, runs headless): a long rink across the wall with a goal slot in each
 * end, a puck on an air cushion, ball impacts that kick the puck away from the impact point (the closer the hit, the
 * faster), and for solo a goalie paddle plus sliding blockers. Adapted from the studio's air hockey table (split into
 * substeps so the puck never tunnels through a wall, post or paddle).
 *
 * Units: rink units, y up. The rink is 26.4 long (x) and 13.2 high (y). Player 1 defends the left goal (x = -HW).
 */

export const HW = 13.2, HH = 6.6, RP = 0.85, GoalHalf = 3.3, CornerR = 2.2, PostR = 0.2;
export const MaxPuck = 44, HitReach = 4.6;
const Air = 0.3, WallE = 0.88, PaddleE = 1.0, WallGrip = 0.985;

export const Ev = { Wall: 1, Post: 2, Paddle: 3, Hit: 4, Goal: 5 } as const;
export interface RinkEvent { type: number; speed: number; x: number; y: number; a: number }

/** A vertical capsule (goalie or blocker) moving up and down. */
export interface Paddle { x: number; y: number; half: number; r: number; vy: number; minY: number; maxY: number; track: number }

export class Rink {
  px = 0; py = 0; vx = 0; vy = 0;
  puckOn = true;
  /** goal this step: 0 = into the left goal (player 2 scores), 1 = into the right goal (player 1 scores), -1 none */
  goal = -1;
  /** solo: the left end is a solid wall */
  leftOpen = true;
  paddles: Paddle[] = [];
  events: RinkEvent[] = [];
  lastHit = -1;

  place(x: number, y: number, vx = 0, vy = 0) { this.px = x; this.py = y; this.vx = vx; this.vy = vy; this.puckOn = true; this.goal = -1; this.lastHit = -1; }

  get speed() { return Math.hypot(this.vx, this.vy); }

  /**
   * A ball lands at (x, y). Within reach it shoves the puck straight away from the impact point: full power for a hit
   * on the puck, fading to a nudge at the edge of the reach. A dead-centre hit drives it toward `toward` (+1 = right).
   * Returns the new speed (0 = out of reach).
   */
  hit(x: number, y: number, owner: number, toward: number) {
    if (!this.puckOn) return 0;
    const dx = this.px - x, dy = this.py - y, d = Math.hypot(dx, dy);
    if (d > HitReach) return 0;
    const k = 1 - d / HitReach;
    const speed = 9 + 35 * Math.pow(k, 0.8);
    let nx: number, ny: number;
    if (d < RP * 0.55) { nx = toward; ny = dy * 0.6; const l = Math.hypot(nx, ny); nx /= l; ny /= l; }
    else { nx = dx / d; ny = dy / d; }
    this.vx = nx * speed + this.vx * 0.15;
    this.vy = ny * speed + this.vy * 0.15;
    this.cap();
    this.lastHit = owner;
    this.events.push({ type: Ev.Hit, speed, x, y, a: owner });
    return speed;
  }

  step(dt: number) {
    this.goal = -1;
    let maxDisp = this.speed * dt;
    for (const p of this.paddles) maxDisp = Math.max(maxDisp, Math.abs(p.vy) * dt + this.speed * dt);
    const n = Math.min(80, Math.max(1, Math.ceil(maxDisp / (RP * 0.25))));
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      for (const p of this.paddles) this.movePaddle(p, h);
      if (this.puckOn) this.sub(h);
      if (this.goal >= 0) break;
    }
  }

  private movePaddle(p: Paddle, h: number) {
    if (p.track > 0 && this.puckOn) {
      // the goalie leans toward the puck's height
      const want = Math.max(p.minY, Math.min(p.maxY, this.py));
      const dir = Math.sign(want - p.y);
      if (Math.abs(want - p.y) > 0.1) p.vy = dir * Math.abs(p.vy || 2) ;
    }
    p.y += p.vy * h;
    if (p.y > p.maxY) { p.y = p.maxY; p.vy = -Math.abs(p.vy); }
    if (p.y < p.minY) { p.y = p.minY; p.vy = Math.abs(p.vy); }
  }

  private sub(h: number) {
    const k = Math.exp(-Air * h);
    this.vx *= k; this.vy *= k;
    this.px += this.vx * h; this.py += this.vy * h;
    for (const p of this.paddles) {
      const cy = Math.max(p.y - p.half, Math.min(p.y + p.half, this.py));
      let nx = this.px - p.x, ny = this.py - cy;
      const d = Math.hypot(nx, ny), rr = RP + p.r;
      if (d >= rr) continue;
      if (d < 1e-6) { nx = this.px < p.x ? -1 : 1; ny = 0; } else { nx /= d; ny /= d; }
      this.px = p.x + nx * rr; this.py = cy + ny * rr;
      const vn = this.vx * nx + (this.vy - p.vy) * ny;
      if (vn < 0) {
        this.vx -= (1 + PaddleE) * vn * nx; this.vy -= (1 + PaddleE) * vn * ny;
        // a paddle hit always sends the puck back out with some pace
        if (Math.abs(this.vx) < 6) this.vx = (nx < 0 ? -1 : 1) * 6;
        this.cap();
        this.events.push({ type: Ev.Paddle, speed: -vn, x: p.x + nx * p.r, y: cy + ny * p.r, a: -1 });
      }
    }
    this.walls();
    // goal: the puck's centre is past the end line inside the slot
    if (Math.abs(this.py) < GoalHalf && Math.abs(this.px) > HW + RP * 0.6 && (this.px > 0 || this.leftOpen)) {
      this.goal = this.px < 0 ? 0 : 1;
      this.puckOn = false;
      this.events.push({ type: Ev.Goal, speed: this.speed, x: this.px, y: this.py, a: this.goal });
    }
  }

  private cap() {
    const s = this.speed;
    if (s > MaxPuck) { this.vx *= MaxPuck / s; this.vy *= MaxPuck / s; }
  }

  private bounce(nx: number, ny: number, e: number, type: number, x: number, y: number) {
    const vn = this.vx * nx + this.vy * ny;
    if (vn >= 0) return;
    const tx = -ny, ty = nx;
    const vt = (this.vx * tx + this.vy * ty) * WallGrip;
    this.vx = -vn * e * nx + vt * tx; this.vy = -vn * e * ny + vt * ty;
    if (-vn > 0.6) this.events.push({ type, speed: -vn, x, y, a: -1 });
  }

  private walls() {
    const lx = HW - RP, ly = HH - RP;
    const ax = Math.abs(this.px), ay = Math.abs(this.py);
    const sx = Math.sign(this.px) || 1, sy = Math.sign(this.py) || 1;
    const cx = HW - CornerR, cy = HH - CornerR;
    const open = sx > 0 || this.leftOpen;
    const inMouth = ay < GoalHalf && open;
    if (ax > cx && ay > cy) {
      const dx = ax - cx, dy = ay - cy, d = Math.hypot(dx, dy), lim = CornerR - RP;
      if (d > lim) {
        const nx = (-dx / d) * sx, ny = (-dy / d) * sy;
        this.px = sx * (cx + (dx / d) * lim); this.py = sy * (cy + (dy / d) * lim);
        this.bounce(nx, ny, WallE, Ev.Wall, sx * (cx + (dx / d) * CornerR), sy * (cy + (dy / d) * CornerR));
      }
      return;
    }
    if (ay > ly) { this.py = sy * ly; this.bounce(0, -sy, WallE, Ev.Wall, this.px, sy * HH); }
    if (ax > lx && !inMouth && ax < HW + 0.2) { this.px = sx * lx; this.bounce(-sx, 0, WallE, Ev.Wall, sx * HW, this.py); }
    if (!open) return;
    // goal posts (the slot's edges)
    for (const gy of [-GoalHalf, GoalHalf]) {
      const dx = this.px - sx * HW, dy = this.py - gy, d = Math.hypot(dx, dy), rr = RP + PostR;
      if (d < rr && d > 1e-6) {
        const nx = dx / d, ny = dy / d;
        this.px = sx * HW + nx * rr; this.py = gy + ny * rr;
        this.bounce(nx, ny, WallE, Ev.Post, sx * HW, gy);
      }
    }
    // inside the slot the puck can't leave up or down
    if (ax > HW - 0.02 && ay > GoalHalf - RP && ay < GoalHalf + 0.4) {
      this.py = sy * (GoalHalf - RP);
      this.bounce(0, -sy, WallE, Ev.Post, this.px, sy * GoalHalf);
    }
  }

  /** Where the puck will be in `t` seconds (walls and paddles included, no events). */
  predict(t: number): [number, number] {
    const r = new Rink();
    r.px = this.px; r.py = this.py; r.vx = this.vx; r.vy = this.vy; r.leftOpen = this.leftOpen; r.puckOn = this.puckOn;
    r.paddles = this.paddles.map((p) => ({ ...p }));
    const steps = Math.max(1, Math.ceil(t / 0.02));
    for (let i = 0; i < steps && r.goal < 0; i++) r.step(t / steps);
    return [r.px, r.py];
  }
}

// ------------------------------------------------------------------ computer striker

export interface StrikerLevel { cool: number; err: number; react: number; power: number; aimY: number }
export const StrikerLevels: StrikerLevel[] = [
  { cool: 1.7, err: 1.7, react: 0.55, power: 0.35, aimY: 2.6 },
  { cool: 1.05, err: 1.0, react: 0.32, power: 0.6, aimY: 1.6 },
  { cool: 0.7, err: 0.55, react: 0.18, power: 0.85, aimY: 1.0 },
];
export const ThrowFlight = 0.45;

/**
 * A virtual thrower for one half (side 1 = right half: defends the right goal, attacks the left). It predicts where
 * the puck will be when its ball lands and throws at the side of the puck facing the target goal, so the impact
 * drives the puck toward the far goal. Accuracy, rate and power come from the level.
 */
export class StrikerAI {
  private cool = 0.6;
  private seen = 0;
  constructor(public lv: StrikerLevel, public side: number) {}

  /** Returns a landing point for a new throw, or null. */
  think(rink: Rink, dt: number, ballInAir: boolean, rand: () => number = Math.random): [number, number] | null {
    this.cool -= dt;
    if (!rink.puckOn) { this.seen = 0; return null; }
    const [qx, qy] = rink.predict(ThrowFlight);
    const mine = this.side === 1 ? qx > -0.6 : qx < 0.6;
    this.seen = mine ? this.seen + dt : 0;
    if (ballInAir || this.cool > 0 || this.seen < this.lv.react) return null;
    const dirX = this.side === 1 ? -1 : 1;
    const gx = dirX * (HW + 1), gy = (rand() * 2 - 1) * this.lv.aimY;
    let ax = gx - qx, ay = gy - qy;
    const l = Math.hypot(ax, ay) || 1; ax /= l; ay /= l;
    const off = RP * 0.4 + (1 - this.lv.power) * 2.2 + rand() * 0.6;
    const ea = rand() * Math.PI * 2, er = Math.sqrt(rand()) * this.lv.err;
    let hx = qx - ax * off + Math.cos(ea) * er, hy = qy - ay * off + Math.sin(ea) * er;
    // its balls land on its own half
    hx = this.side === 1 ? Math.max(0.3, hx) : Math.min(-0.3, hx);
    hy = Math.max(-HH + 0.3, Math.min(HH - 0.3, hy));
    this.cool = this.lv.cool * (0.8 + rand() * 0.4);
    return [hx, hy];
  }
}

/** Solo goalie setup for a level (1-based). */
export function SoloPaddles(level: number): Paddle[] {
  const l = level - 1;
  const half = Math.min(1.1, l * 0.16), speed = Math.min(6.5, 2.4 + l * 0.5);
  const out: Paddle[] = [{ x: HW - 1.25, y: 0, half, r: 0.55, vy: speed, minY: -GoalHalf + 0.2, maxY: GoalHalf - 0.2, track: l >= 5 ? 1 : 0 }];
  if (l >= 2) out.push({ x: 6.2, y: 3, half: 0.9, r: 0.32, vy: -Math.min(6, 2.4 + (l - 2) * 0.5), minY: -HH + 1.9, maxY: HH - 1.9, track: 0 });
  if (l >= 4) out.push({ x: 9.6, y: -2, half: 0.8, r: 0.3, vy: Math.min(7, 3 + (l - 4) * 0.5), minY: -HH + 1.6, maxY: HH - 1.6, track: 0 });
  return out;
}
