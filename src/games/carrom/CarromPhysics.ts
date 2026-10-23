/**
 * CARROM FLICK physics: deterministic fixed-step 2D carrom (no kit dependencies, so it also runs headless in node).
 *
 * Units: board units (playing surface 20 × 20, about 3.7 cm each), seconds, y up. Player 0's baseline is at the bottom.
 * Coins and the striker slide on a powdered board: a constant kinetic friction plus a little speed-proportional drag.
 * Disc–disc contacts are mass-weighted impulses with restitution (the striker is ~2.7× heavier than a coin, so it
 * follows through); the frame is four walls with restitution and a little tangential grip. A disc drops when its
 * centre passes over one of the four corner pockets. Every fixed step (1/240 s) is split into substeps so nothing
 * moves more than a quarter of a coin radius per substep: no tunnelling even at maximum power.
 */

export const H = 10;
export const RC = 0.43, RS = 0.56, RP = 0.62;
export const MC = 1, MS = 2.7;
/** Striker centre line distance from the board centre (|y|) and half the baseline length. */
export const BaseY = 6.83, BaseHalf = 6.35;
export const CentreR = 2.3;
export const MaxSpeed = 58;
export const Step = 1 / 240;
export const N = 20;
export const Striker = 0, Queen = 19;
/** Pocket centres (capture circle radius RP − CaptureIn). */
export const Pockets: [number, number][] = [[-(H - RP), -(H - RP)], [H - RP, -(H - RP)], [-(H - RP), H - RP], [H - RP, H - RP]];
export const CaptureIn = 0.1;

const Friction = 15; // u/s²
const Drag = 0.22; // 1/s
const CoinE = 0.9, StrikerE = 0.86, WallE = 0.66, WallGrip = 0.93;
const Rest = 0.03;

export const isWhite = (i: number) => i >= 1 && i <= 9;
export const isBlack = (i: number) => i >= 10 && i <= 18;
/** 0 = white, 1 = black, 2 = queen, -1 striker. */
export const colourOf = (i: number) => (i === Striker ? -1 : i === Queen ? 2 : isWhite(i) ? 0 : 1);

export const Ev = { Hit: 1, Wall: 2, Pocket: 3 } as const;
export interface CarromEvent { type: number; a: number; b: number; speed: number; x: number; y: number }

export class StrikeRecord {
  firstContact = -1;
  potted: number[] = [];
  pocketOf: number[] = [];
  strikerPotted = false;
  walls = 0;
  reset() { this.firstContact = -1; this.potted = []; this.pocketOf = []; this.strikerPotted = false; this.walls = 0; }
}

/** Small deterministic RNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(n: number) { return Math.floor(this.next() * n); }
  gauss() { let u = 0; while (u === 0) u = this.next(); const v = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
}

export const radiusOf = (i: number) => (i === Striker ? RS : RC);
const massOf = (i: number) => (i === Striker ? MS : MC);

export class CarromSim {
  x = new Float64Array(N); y = new Float64Array(N);
  vx = new Float64Array(N); vy = new Float64Array(N);
  /** visual spin (rad/s) and angle */
  w = new Float64Array(N); ang = new Float64Array(N);
  on = new Uint8Array(N);
  pocket = new Int8Array(N).fill(-1);
  moving = false;
  time = 0;
  record = new StrikeRecord();
  events: CarromEvent[] | null = null;
  private acc = 0;

  clone(): CarromSim {
    const s = new CarromSim();
    s.x.set(this.x); s.y.set(this.y); s.vx.set(this.vx); s.vy.set(this.vy); s.w.set(this.w); s.ang.set(this.ang);
    s.on.set(this.on); s.pocket.set(this.pocket);
    s.moving = this.moving;
    return s;
  }

  copyFrom(o: CarromSim) {
    this.x.set(o.x); this.y.set(o.y); this.vx.set(o.vx); this.vy.set(o.vy); this.w.set(o.w); this.ang.set(o.ang);
    this.on.set(o.on); this.pocket.set(o.pocket); this.moving = o.moving;
  }

  /** The standard opening: queen in the centre, a ring of six and a ring of twelve, whites forming a "Y". */
  rack(seed: number) {
    const rng = new Rng(seed);
    this.on.fill(0); this.pocket.fill(-1);
    this.vx.fill(0); this.vy.fill(0); this.w.fill(0);
    const d = RC * 2 + 0.004;
    const rot = Math.PI / 2;
    let wi = 1, bi = 10;
    const put = (white: boolean, a: number, r: number) => {
      const n = white ? wi++ : bi++;
      this.place(n, Math.cos(a + rot) * r, Math.sin(a + rot) * r);
      this.ang[n] = rng.range(0, Math.PI * 2);
    };
    this.place(Queen, 0, 0);
    for (let k = 0; k < 6; k++) put(k % 2 === 0, (k * Math.PI) / 3, d);
    for (let k = 0; k < 6; k++) put(k % 2 === 0, (k * Math.PI) / 3, d * 2);
    for (let k = 0; k < 6; k++) put(k % 2 === 1, (k * Math.PI) / 3 + Math.PI / 6, d * Math.sqrt(3));
    this.place(Striker, 0, -BaseY);
    this.on[Striker] = 1;
    this.moving = false;
  }

  place(n: number, x: number, y: number) {
    this.x[n] = x; this.y[n] = y; this.vx[n] = this.vy[n] = this.w[n] = 0;
    this.on[n] = 1; this.pocket[n] = -1;
  }

  /** True when disc n fits at (x, y) without touching another disc. */
  fits(n: number, x: number, y: number) {
    const r = radiusOf(n);
    if (Math.abs(x) > H - r || Math.abs(y) > H - r) return false;
    for (let i = 0; i < N; i++) {
      if (i === n || !this.on[i]) continue;
      const rr = r + radiusOf(i) + 0.01;
      if ((this.x[i] - x) ** 2 + (this.y[i] - y) ** 2 < rr * rr) return false;
    }
    return true;
  }

  /** Puts a returned coin back on the centre spot (or the nearest free point around it). */
  spot(n: number) {
    for (let ring = 0; ring < 40; ring++) {
      const r = ring * 0.18;
      const steps = Math.max(1, Math.round((2 * Math.PI * r) / 0.3));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (this.fits(n, x, y)) { this.place(n, x, y); return; }
      }
    }
    this.place(n, 0, 0);
  }

  /** Where the striker may sit on a baseline (player 0 bottom, 1 top): the closest free x to `want`. */
  freeBaseX(player: number, want: number) {
    const y = player === 0 ? -BaseY : BaseY;
    want = Math.max(-BaseHalf, Math.min(BaseHalf, want));
    if (this.fits(Striker, want, y)) return want;
    for (let k = 1; k < 200; k++) {
      for (const s of [1, -1]) {
        const x = want + s * k * 0.05;
        if (Math.abs(x) <= BaseHalf && this.fits(Striker, x, y)) return x;
      }
    }
    return want;
  }

  shoot(dirX: number, dirY: number, speed: number) {
    const l = Math.hypot(dirX, dirY) || 1;
    speed = Math.min(MaxSpeed, Math.max(0, speed));
    this.vx[Striker] = (dirX / l) * speed; this.vy[Striker] = (dirY / l) * speed;
    this.w[Striker] = (Math.random() - 0.5) * 6;
    this.moving = true;
    this.time = 0;
    this.acc = 0;
    this.record.reset();
  }

  advance(dt: number) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= Step && this.moving) { this.acc -= Step; this.fixedStep(); n++; }
    if (!this.moving) this.acc = 0;
    return n;
  }

  runToRest(limit = 20) {
    while (this.moving && this.time < limit) this.fixedStep();
    if (this.moving) this.stopAll();
  }

  stopAll() { this.vx.fill(0); this.vy.fill(0); this.w.fill(0); this.moving = false; }

  fixedStep() {
    const h = Step;
    let maxV = 0;
    for (let i = 0; i < N; i++) if (this.on[i]) maxV = Math.max(maxV, Math.abs(this.vx[i]) + Math.abs(this.vy[i]));
    const n = Math.min(16, Math.max(1, Math.ceil((maxV * h) / (RC * 0.25))));
    const sub = h / n;
    for (let s = 0; s < n; s++) this.subStep(sub);
    this.time += h;
    let any = false;
    for (let i = 0; i < N; i++) if (this.on[i] && Math.abs(this.vx[i]) + Math.abs(this.vy[i]) > Rest) { any = true; break; }
    if (!any) this.stopAll();
  }

  private subStep(h: number) {
    const { x, y, vx, vy, w, ang, on } = this;
    for (let i = 0; i < N; i++) {
      if (!on[i]) continue;
      const sp = Math.hypot(vx[i], vy[i]);
      if (sp > 0) {
        const dec = Friction * h + Drag * sp * h;
        if (sp <= dec) { vx[i] = vy[i] = 0; }
        else { const k = (sp - dec) / sp; vx[i] *= k; vy[i] *= k; }
        x[i] += vx[i] * h; y[i] += vy[i] * h;
      }
      if (w[i] !== 0) { ang[i] += w[i] * h; w[i] *= Math.max(0, 1 - 2.5 * h); }
    }
    // disc–disc
    for (let i = 0; i < N; i++) {
      if (!on[i]) continue;
      const ri = radiusOf(i), mi = massOf(i);
      for (let j = i + 1; j < N; j++) {
        if (!on[j]) continue;
        const rr = ri + radiusOf(j);
        const dx = x[j] - x[i], dy = y[j] - y[i];
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        let d = Math.sqrt(d2), nx = 1, ny = 0;
        if (d > 1e-9) { nx = dx / d; ny = dy / d; } else d = 0;
        const mj = massOf(j), im = 1 / mi, jm = 1 / mj;
        const rel = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
        if (rel > 0) {
          const e = i === Striker ? StrikerE : CoinE;
          const J = ((1 + e) * rel) / (im + jm);
          vx[i] -= J * im * nx; vy[i] -= J * im * ny; vx[j] += J * jm * nx; vy[j] += J * jm * ny;
          // a glancing contact sets the coins spinning (visual only)
          const tv = (vx[i] - vx[j]) * -ny + (vy[i] - vy[j]) * nx;
          w[i] += tv * 0.6; w[j] -= tv * 0.6;
          this.hit(i, j, rel, x[i] + nx * ri, y[i] + ny * ri);
        }
        const push = (rr - d) + 1e-6, si = im / (im + jm), sj = jm / (im + jm);
        x[i] -= nx * push * si; y[i] -= ny * push * si; x[j] += nx * push * sj; y[j] += ny * push * sj;
      }
    }
    // frame walls
    for (let i = 0; i < N; i++) {
      if (!on[i]) continue;
      const r = radiusOf(i), lim = H - r;
      if (x[i] > lim || x[i] < -lim) {
        const s = Math.sign(x[i]);
        x[i] = s * lim;
        if (vx[i] * s > 0) { const v = Math.abs(vx[i]); vx[i] = -vx[i] * WallE; vy[i] *= WallGrip; w[i] += vy[i] * s * 0.4; this.wall(i, v, s * H, y[i]); }
      }
      if (y[i] > lim || y[i] < -lim) {
        const s = Math.sign(y[i]);
        y[i] = s * lim;
        if (vy[i] * s > 0) { const v = Math.abs(vy[i]); vy[i] = -vy[i] * WallE; vx[i] *= WallGrip; w[i] -= vx[i] * s * 0.4; this.wall(i, v, x[i], s * H); }
      }
    }
    // pockets
    const cr = RP - CaptureIn;
    for (let i = 0; i < N; i++) {
      if (!on[i]) continue;
      if (Math.abs(x[i]) < H - 1.5 || Math.abs(y[i]) < H - 1.5) continue;
      for (let p = 0; p < 4; p++) {
        const [px, py] = Pockets[p];
        if ((x[i] - px) ** 2 + (y[i] - py) ** 2 < cr * cr) { this.drop(i, p); break; }
      }
    }
  }

  private hit(i: number, j: number, speed: number, px: number, py: number) {
    if (i === Striker && this.record.firstContact < 0) this.record.firstContact = j;
    if (this.events && speed > 0.1) this.events.push({ type: Ev.Hit, a: i, b: j, speed, x: px, y: py });
  }

  private wall(i: number, speed: number, px: number, py: number) {
    if (i === Striker) this.record.walls++;
    if (this.events && speed > 0.3) this.events.push({ type: Ev.Wall, a: i, b: -1, speed, x: px, y: py });
  }

  private drop(i: number, p: number) {
    const speed = Math.hypot(this.vx[i], this.vy[i]);
    this.on[i] = 0;
    this.pocket[i] = p;
    if (this.events) this.events.push({ type: Ev.Pocket, a: i, b: p, speed, x: this.x[i], y: this.y[i] });
    this.vx[i] = this.vy[i] = 0;
    if (i === Striker) this.record.strikerPotted = true;
    else { this.record.potted.push(i); this.record.pocketOf.push(p); }
  }
}

// ------------------------------------------------------------------ geometry helpers (aiming, AI)

export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const ex = bx - ax, ey = by - ay;
  const l2 = ex * ex + ey * ey;
  let t = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
}

export interface AimHit { gx: number; gy: number; coin: number; nx: number; ny: number; dist: number }

/** Casts disc `from` (its radius) from (ox, oy) along (dx, dy): the first coin or wall it touches. */
export function castDisc(sim: CarromSim, ox: number, oy: number, dx: number, dy: number, from = Striker): AimHit {
  const l = Math.hypot(dx, dy) || 1;
  dx /= l; dy /= l;
  const r0 = radiusOf(from);
  let best = 1e9, coin = -1, nx = 0, ny = 0;
  for (let i = 0; i < N; i++) {
    if (i === from || !sim.on[i]) continue;
    const rr = r0 + radiusOf(i);
    const fx = sim.x[i] - ox, fy = sim.y[i] - oy;
    const t = fx * dx + fy * dy;
    if (t <= 0) continue;
    const c2 = fx * fx + fy * fy - t * t;
    if (c2 >= rr * rr) continue;
    const s = t - Math.sqrt(rr * rr - c2);
    if (s < best && s > -0.02) { best = Math.max(0, s); coin = i; }
  }
  const lim = H - r0;
  const tx = dx > 0 ? (lim - ox) / dx : dx < 0 ? (-lim - ox) / dx : 1e9;
  const ty = dy > 0 ? (lim - oy) / dy : dy < 0 ? (-lim - oy) / dy : 1e9;
  const tc = Math.max(0, Math.min(tx, ty));
  if (tc < best) {
    best = tc; coin = -1;
    if (tx < ty) { nx = -Math.sign(dx); ny = 0; } else { nx = 0; ny = -Math.sign(dy); }
  }
  return { gx: ox + dx * best, gy: oy + dy * best, coin, nx, ny, dist: best };
}

/** Speed a disc needs to slide `dist` units and still have `vEnd` left. */
export function speedFor(dist: number, vEnd = 0) {
  // v' = −F − D·v  →  distance ≈ (v0 − v1)/D − F/D² · ln((F + D·v0)/(F + D·v1))  (solved numerically)
  let lo = vEnd, hi = MaxSpeed * 1.5;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const s = (mid - vEnd) / Drag - (Friction / (Drag * Drag)) * Math.log((Friction + Drag * mid) / (Friction + Drag * vEnd));
    if (s < dist) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Striker speed at contact that sends a coin straight off at speed vc for a cut factor (cos of the cut angle). */
export function strikerSpeedForCoin(vc: number, cut: number) {
  return (vc * (MS + MC)) / ((1 + StrikerE) * MS * Math.max(0.2, cut));
}
