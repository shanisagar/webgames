/**
 * PADDLE DUEL simulation in court space (pure logic, no rendering): x runs across the court (paddle axis), y runs
 * from player 1's end (-) to player 2's end (+). Side walls at x = ±HW bounce the ball; the ends are open goals (or,
 * in solo WALL mode, the top end is a wall). Each paddle hit speeds the ball up; where the ball meets the paddle sets
 * the outgoing angle and the paddle's sideways speed adds angle and spin (a curving ball).
 */

export const HW = 7, HL = 12;
/** Paddle line distance from the centre, half length, half thickness; ball half size. */
export const PY = 10.8, PL = 1.6, PT = 0.26, BR = 0.3;
export const BaseSpeed = 12, SpeedStep = 0.55, MaxSpeed = 31;
const MaxAngle = 58 * Math.PI / 180;
const SpinCurve = 0.3;

export enum Ev { Paddle, Wall, EndWall, Score }
export interface PEvent { type: Ev; who: number; x: number; y: number; speed: number; edge: number }

export class Paddle {
  x = 0; tx = 0; vx = 0; len = PL;
  /** Max travel speed (units / s): fingers are near-instant, bots are limited. */
  max = 140;
  hitFlash = 0;
}

export class Court {
  bx = 0; by = 0; vx = 0; vy = 0; spin = 0;
  live = false;
  speed = BaseSpeed;
  rally = 0;
  /** Solo: the far end is a wall instead of a goal. */
  wallTop = false;
  paddles = [new Paddle(), new Paddle()];
  events: PEvent[] = [];
  lastHitter = -1;

  reset() {
    this.bx = this.by = this.vx = this.vy = this.spin = 0;
    this.live = false; this.rally = 0; this.speed = BaseSpeed; this.lastHitter = -1;
    for (const p of this.paddles) { p.x = p.tx = p.vx = 0; }
  }

  /** Ball from the centre toward player `toward` (0 = down, 1 = up) at a random angle. */
  serve(toward: number, speed = BaseSpeed, rand = Math.random) {
    this.bx = 0; this.by = 0; this.spin = 0;
    this.speed = speed;
    const a = (rand() * 2 - 1) * 26 * Math.PI / 180;
    const dir = toward === 0 ? -1 : 1;
    this.vx = Math.sin(a) * speed; this.vy = Math.cos(a) * speed * dir;
    this.live = true;
    this.lastHitter = -1;
  }

  step(dt: number) {
    for (const p of this.paddles) {
      const lim = p.len - HW + 0.05;
      const target = Math.max(lim, Math.min(-lim, p.tx));
      const old = p.x, d = target - p.x, m = p.max * dt;
      p.x = Math.abs(d) <= m ? target : p.x + Math.sign(d) * m;
      const v = dt > 0 ? (p.x - old) / dt : 0;
      p.vx += (v - p.vx) * Math.min(1, dt * 18);
      p.hitFlash = Math.max(0, p.hitFlash - dt * 3);
    }
    if (!this.live) return;
    const n = Math.max(1, Math.ceil(dt * Math.max(this.speed, 10) / 0.08));
    const h = dt / n;
    for (let i = 0; i < n && this.live; i++) this.sub(h);
  }

  private sub(h: number) {
    // spin curves the ball sideways, then fades; speed magnitude stays fixed
    if (this.spin !== 0) {
      this.vx += this.spin * this.speed * SpinCurve * h * Math.sign(this.vy || 1);
      this.spin *= Math.exp(-1.1 * h);
      if (Math.abs(this.spin) < 0.01) this.spin = 0;
    }
    this.normalize();
    const py = this.by;
    this.bx += this.vx * h; this.by += this.vy * h;
    if (Math.abs(this.bx) > HW - BR) {
      this.bx = Math.sign(this.bx) * (HW - BR) * 2 - this.bx;
      this.vx = -this.vx;
      this.spin *= 0.55;
      this.events.push({ type: Ev.Wall, who: -1, x: Math.sign(this.bx) * HW, y: this.by, speed: this.speed, edge: 0 });
    }
    // paddles
    for (let k = 0; k < 2; k++) {
      const dir = k === 0 ? -1 : 1;
      if (k === 1 && this.wallTop) continue;
      if (Math.sign(this.vy) !== dir) continue;
      const face = dir * (PY - PT - BR);
      const crossed = dir < 0 ? py >= face - 0.0001 && this.by <= face : py <= face + 0.0001 && this.by >= face;
      if (!crossed) continue;
      const p = this.paddles[k];
      const off = this.bx - p.x;
      if (Math.abs(off) > p.len + BR) continue;
      this.hit(k, off / (p.len + BR));
    }
    if (this.wallTop && this.vy > 0 && this.by > HL - BR) {
      this.by = (HL - BR) * 2 - this.by;
      this.vy = -this.vy;
      this.events.push({ type: Ev.EndWall, who: -1, x: this.bx, y: HL, speed: this.speed, edge: 0 });
    }
    if (this.by < -HL - 0.6) this.score(1);
    else if (this.by > HL + 0.6) this.score(0);
  }

  private hit(k: number, o: number) {
    const p = this.paddles[k], dir = k === 0 ? 1 : -1;
    o = Math.max(-1, Math.min(1, o));
    this.rally++;
    this.speed = Math.min(MaxSpeed, this.speed + SpeedStep);
    // angle from the hit position plus a nudge in the paddle's travel direction
    let a = o * MaxAngle + Math.max(-0.26, Math.min(0.26, p.vx * 0.012)) * dir;
    a = Math.max(-MaxAngle - 0.1, Math.min(MaxAngle + 0.1, a));
    this.vx = Math.sin(a) * this.speed * dir;
    this.vy = Math.cos(a) * this.speed * dir;
    this.spin = Math.max(-1.2, Math.min(1.2, p.vx / 22)) * dir;
    this.by = (k === 0 ? -1 : 1) * (PY - PT - BR);
    p.hitFlash = 1;
    this.lastHitter = k;
    this.events.push({ type: Ev.Paddle, who: k, x: this.bx, y: this.by, speed: this.speed, edge: Math.abs(o) });
  }

  private normalize() {
    const s = Math.hypot(this.vx, this.vy) || 1;
    let vx = this.vx / s, vy = this.vy / s;
    // never let the ball crawl along the walls
    const minY = 0.42;
    if (Math.abs(vy) < minY) { vy = Math.sign(vy || 1) * minY; vx = Math.sign(vx) * Math.sqrt(1 - minY * minY); }
    this.vx = vx * this.speed; this.vy = vy * this.speed;
  }

  private score(who: number) {
    this.live = false;
    this.events.push({ type: Ev.Score, who, x: this.bx, y: this.by, speed: this.speed, edge: 0 });
  }
}

// ------------------------------------------------------------------ computer paddle

export interface BotLevel { name: string; react: number; err: number; whiff: number; max: number; aim: number; spinAware: boolean }
export const BotLevels: BotLevel[] = [
  { name: "EASY", react: 0.26, err: 0.95, whiff: 0.12, max: 13.5, aim: 0, spinAware: false },
  { name: "MEDIUM", react: 0.16, err: 0.65, whiff: 0.06, max: 17, aim: 0.45, spinAware: true },
  { name: "HARD", react: 0.07, err: 0.25, whiff: 0.015, max: 25, aim: 0.85, spinAware: true },
];

function gauss(rand: () => number) { return Math.sqrt(-2 * Math.log(1 - rand() * 0.999)) * Math.cos(2 * Math.PI * rand()); }

/** Predicts where the ball will cross a paddle line, folding wall bounces (and, on smarter levels, the spin curve). */
export function predictX(c: Court, side: number, spinAware: boolean) {
  const dir = side === 0 ? -1 : 1;
  const face = dir * (PY - PT - BR);
  let x = c.bx, y = c.by, vx = c.vx, vy = c.vy, spin = spinAware ? c.spin : 0;
  const sp = c.speed, h = 1 / 120;
  for (let i = 0; i < 600; i++) {
    if (spin !== 0) { vx += spin * sp * SpinCurve * h * Math.sign(vy || 1); spin *= Math.exp(-1.1 * h); }
    const s = Math.hypot(vx, vy) || 1; vx = vx / s * sp; vy = vy / s * sp;
    x += vx * h; y += vy * h;
    if (Math.abs(x) > HW - BR) { x = Math.sign(x) * (HW - BR) * 2 - x; vx = -vx; spin *= 0.55; }
    if (c.wallTop && side === 0 && vy > 0 && y > HL - BR) { y = (HL - BR) * 2 - y; vy = -vy; }
    if ((dir < 0 && y <= face && vy < 0) || (dir > 0 && y >= face && vy > 0)) return x;
  }
  return x;
}

export class PaddleBot {
  private planned = false;
  private delay = 0;
  private target = 0;
  constructor(public level: BotLevel, readonly side = 1, private rand: () => number = Math.random) {}

  update(c: Court, dt: number) {
    const p = c.paddles[this.side], opp = c.paddles[1 - this.side];
    const dir = this.side === 0 ? -1 : 1;
    p.max = this.level.max;
    const coming = c.live && Math.sign(c.vy) === dir;
    if (coming) {
      if (!this.planned) { this.planned = true; this.delay = this.level.react * (0.7 + this.rand() * 0.6); }
      if (this.delay > 0) { this.delay -= dt; if (this.delay <= 0) this.plan(c, opp.x); }
    } else {
      this.planned = false;
      // drift back toward the middle, shading toward the ball
      this.target = c.live ? c.bx * 0.35 : 0;
    }
    p.tx = this.target;
  }

  private plan(c: Court, oppX: number) {
    const L = this.level;
    let x = predictX(c, this.side, L.spinAware);
    const fast = 1 + c.speed / 30;
    x += gauss(this.rand) * L.err * fast * 0.5;
    if (this.rand() < L.whiff * fast) x += (this.rand() < 0.5 ? -1 : 1) * (PL + BR + 0.4 + this.rand() * 1.2);
    // aim: hit off-centre so the return angles away from the opponent
    const away = oppX > 0.5 ? -1 : oppX < -0.5 ? 1 : this.rand() < 0.5 ? -1 : 1;
    const o = away * L.aim * (0.4 + this.rand() * 0.5) * (this.side === 0 ? 1 : -1);
    this.target = x - o * PL * 0.85;
  }
}
