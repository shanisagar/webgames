/**
 * POOL PRO physics: deterministic fixed-step 2D billiards (no kit dependencies, so it also runs headless in node).
 *
 * Units: table units (playing surface 20 × 10, ball radius 0.3), seconds. The table's long axis is x.
 * Each ball has a velocity v and a "roll" vector r (the surface speed from its spin, ω × R): sliding friction pulls v
 * and r together (stun, follow and draw emerge naturally), rolling friction slows a rolling ball, a side-spin scalar
 * bends cushion rebounds. Ball–ball contacts are near-elastic normal impulses; cushions and pocket jaws are segments
 * with restitution; a ball drops when its centre enters a pocket's capture circle behind the jaws. Every fixed step
 * (1/240 s) is split into substeps so no ball moves more than a fifth of its radius per substep: no tunnelling even
 * at maximum power.
 */

export const TW = 20, TH = 10, R = 0.3, D = R * 2;
export const MaxSpeed = 42;
export const Step = 1 / 240;
export const HeadX = -TW / 4, FootX = TW / 4;

export const MuSlide = 16; // sliding friction deceleration (u/s²)
export const RollC0 = 1.3, RollC2 = 0.014; // rolling resistance: a = c0 + c2·v²
/** A power break may go faster than a normal shot. */
export const BreakBoost = 1.45;
const SpinDecay = 5; // side spin (surface speed) decay, u/s²
const BallE = 0.97, CushionE = 0.76, JawE = 0.6;
const Rest = 0.012;

export interface Seg { ax: number; ay: number; bx: number; by: number; jaw: boolean }
export interface Pocket {
  /** capture centre + radius */
  x: number; y: number; r: number;
  /** mouth centre and the inward axis (unit) */
  mx: number; my: number; dx: number; dy: number;
  /** where a shot should send the object ball */
  ax: number; ay: number;
  side: boolean;
  /** mouth half width (between the knuckles) */
  half: number;
}

const CornerMouth = 1.38, SideMouth = 1.44, JawAngle = 7 * Math.PI / 180;

function buildTable() {
  const segs: Seg[] = [];
  const pockets: Pocket[] = [];
  const a = CornerMouth / Math.SQRT2;
  const hx = TW / 2, hy = TH / 2;
  const seg = (ax: number, ay: number, bx: number, by: number, jaw = false) => segs.push({ ax, ay, bx, by, jaw });
  // cushion noses
  seg(-hx + a, hy, -SideMouth / 2, hy); seg(SideMouth / 2, hy, hx - a, hy);
  seg(-hx + a, -hy, -SideMouth / 2, -hy); seg(SideMouth / 2, -hy, hx - a, -hy);
  seg(-hx, -hy + a, -hx, hy - a); seg(hx, -hy + a, hx, hy - a);
  // corner pockets: jaws converge slightly towards the pocket axis
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const k1x = sx * (hx - a), k1y = sy * hy, k2x = sx * hx, k2y = sy * (hy - a);
      const dx = sx / Math.SQRT2, dy = sy / Math.SQRT2;
      const mx = (k1x + k2x) / 2, my = (k1y + k2y) / 2;
      for (const [kx, ky] of [[k1x, k1y], [k2x, k2y]]) {
        let tx = mx - kx, ty = my - ky;
        const tl = Math.hypot(tx, ty); tx /= tl; ty /= tl;
        const jx = dx * Math.cos(JawAngle) + tx * Math.sin(JawAngle), jy = dy * Math.cos(JawAngle) + ty * Math.sin(JawAngle);
        seg(kx, ky, kx + jx * 0.8, ky + jy * 0.8, true);
      }
      pockets.push({ x: mx + dx * 0.42, y: my + dy * 0.42, r: 0.5, mx, my, dx, dy, ax: mx + dx * 0.12, ay: my + dy * 0.12, side: false, half: CornerMouth / 2 });
    }
  // side pockets
  for (const sy of [-1, 1]) {
    const y = sy * hy;
    seg(-SideMouth / 2, y, -SideMouth / 2, y + sy * 0.65, true);
    seg(SideMouth / 2, y, SideMouth / 2, y + sy * 0.65, true);
    pockets.push({ x: 0, y: y + sy * 0.36, r: 0.47, mx: 0, my: y, dx: 0, dy: sy, ax: 0, ay: y + sy * 0.05, side: true, half: SideMouth / 2 });
  }
  return { segs, pockets };
}

export const Table = buildTable();

export const Ev = { Ball: 1, Cushion: 2, Pocket: 3 } as const;
export interface PoolEvent { type: number; a: number; b: number; speed: number; x: number; y: number }

/** What happened during a shot (for the rules). */
export class ShotRecord {
  firstContact = -1;
  railAfterContact = false;
  potted: number[] = [];
  pocketOf: number[] = [];
  cuePotted = false;
  cushionsBeforeContact = 0;
  reset() { this.firstContact = -1; this.railAfterContact = false; this.potted = []; this.pocketOf = []; this.cuePotted = false; this.cushionsBeforeContact = 0; }
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
  gauss() { let u = 0, v = 0; while (u === 0) u = this.next(); v = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
}

export class PoolSim {
  static readonly N = 16;
  x = new Float64Array(16); y = new Float64Array(16);
  vx = new Float64Array(16); vy = new Float64Array(16);
  rx = new Float64Array(16); ry = new Float64Array(16);
  sz = new Float64Array(16);
  on = new Uint8Array(16);
  /** pocket index a ball dropped into (-1 on table) */
  pocket = new Int8Array(16).fill(-1);
  moving = false;
  time = 0;
  record = new ShotRecord();
  /** collect events for sound/fx (off for AI rollouts) */
  events: PoolEvent[] | null = null;
  private acc = 0;

  clone(): PoolSim {
    const s = new PoolSim();
    s.x.set(this.x); s.y.set(this.y); s.vx.set(this.vx); s.vy.set(this.vy); s.rx.set(this.rx); s.ry.set(this.ry); s.sz.set(this.sz);
    s.on.set(this.on); s.pocket.set(this.pocket);
    s.moving = this.moving;
    return s;
  }

  /** Standard 8-ball rack (apex on the foot spot, 8 in the middle, one of each group in the back corners). */
  rack(seed: number) {
    const rng = new Rng(seed);
    this.on.fill(0); this.pocket.fill(-1);
    this.vx.fill(0); this.vy.fill(0); this.rx.fill(0); this.ry.fill(0); this.sz.fill(0);
    const solids = [2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15];
    const shuffle = (a: number[]) => { for (let i = a.length - 1; i > 0; i--) { const j = rng.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; } };
    shuffle(solids); shuffle(stripes);
    // apex: the 1 ball; back corners: one solid, one stripe
    const slots: number[] = new Array(15).fill(0);
    slots[0] = 1;
    slots[4] = 8; // row 2, middle
    const flip = rng.next() < 0.5;
    slots[10] = flip ? solids.pop()! : stripes.pop()!;
    slots[14] = flip ? stripes.pop()! : solids.pop()!;
    const rest = [...solids, ...stripes];
    shuffle(rest);
    for (let i = 0; i < 15; i++) if (slots[i] === 0) slots[i] = rest.pop()!;
    const gap = 0.004, dx = (D + gap) * Math.cos(Math.PI / 6), dy = D + gap;
    let k = 0;
    for (let row = 0; row < 5; row++)
      for (let j = 0; j <= row; j++) {
        const n = slots[k++];
        this.place(n, FootX + row * dx, (j - row / 2) * dy);
      }
    this.place(0, HeadX, 0);
    this.moving = false;
  }

  place(n: number, x: number, y: number) {
    this.x[n] = x; this.y[n] = y; this.vx[n] = this.vy[n] = this.rx[n] = this.ry[n] = this.sz[n] = 0;
    this.on[n] = 1; this.pocket[n] = -1;
  }

  /** True when a ball of radius R fits at (x, y) on the cloth without touching another ball. */
  fits(x: number, y: number, ignore = 0, kitchen = false) {
    if (Math.abs(x) > TW / 2 - R - 0.01 || Math.abs(y) > TH / 2 - R - 0.01) return false;
    if (kitchen && x > HeadX) return false;
    for (let i = 0; i < 16; i++) {
      if (i === ignore || !this.on[i]) continue;
      if ((this.x[i] - x) ** 2 + (this.y[i] - y) ** 2 < (D + 0.01) ** 2) return false;
    }
    return true;
  }

  /** Spots a ball on the foot spot (or the nearest free point behind it on the long axis). */
  spot(n: number) {
    for (let i = 0; i < 200; i++) {
      const x = FootX + i * 0.05;
      if (this.fits(x, 0, n)) { this.place(n, x, 0); return; }
      const x2 = FootX - i * 0.05;
      if (this.fits(x2, 0, n)) { this.place(n, x2, 0); return; }
    }
    this.place(n, FootX, 0);
  }

  /**
   * Strikes the cue ball. top/side in [-1, 1] are the cue tip offsets (1 = half a radius from centre):
   * top spin follows, back spin draws, side spin (english) bends cushion rebounds.
   */
  shoot(dirX: number, dirY: number, speed: number, top = 0, side = 0) {
    const l = Math.hypot(dirX, dirY) || 1;
    dirX /= l; dirY /= l;
    speed = Math.min(MaxSpeed * BreakBoost, Math.max(0, speed));
    this.vx[0] = dirX * speed; this.vy[0] = dirY * speed;
    this.rx[0] = dirX * speed * 1.25 * top; this.ry[0] = dirY * speed * 1.25 * top;
    this.sz[0] = side * speed * 0.55;
    this.moving = true;
    this.time = 0;
    this.acc = 0;
    this.record.reset();
  }

  /** Advances real time dt using fixed steps. Returns the number of steps taken. */
  advance(dt: number) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= Step && this.moving) { this.acc -= Step; this.fixedStep(); n++; }
    if (!this.moving) this.acc = 0;
    return n;
  }

  /** Runs until every ball stops (or the time limit). */
  runToRest(limit = 30) {
    while (this.moving && this.time < limit) this.fixedStep();
    if (this.moving) this.stopAll();
  }

  stopAll() {
    this.vx.fill(0); this.vy.fill(0); this.rx.fill(0); this.ry.fill(0); this.sz.fill(0);
    this.moving = false;
  }

  energy() {
    let e = 0;
    for (let i = 0; i < 16; i++) if (this.on[i]) e += 0.5 * (this.vx[i] ** 2 + this.vy[i] ** 2) + 0.2 * (this.rx[i] ** 2 + this.ry[i] ** 2 + this.sz[i] ** 2);
    return e;
  }

  fixedStep() {
    const h = Step;
    let maxV = 0;
    for (let i = 0; i < 16; i++) if (this.on[i]) maxV = Math.max(maxV, Math.hypot(this.vx[i], this.vy[i]));
    const n = Math.min(24, Math.max(1, Math.ceil((maxV * h) / (R * 0.2))));
    const sub = h / n;
    for (let s = 0; s < n; s++) this.subStep(sub);
    this.time += h;
    let any = false;
    for (let i = 0; i < 16; i++) {
      if (!this.on[i]) continue;
      if (Math.abs(this.vx[i]) + Math.abs(this.vy[i]) + Math.abs(this.rx[i]) + Math.abs(this.ry[i]) > Rest) { any = true; break; }
    }
    if (!any) this.stopAll();
  }

  private subStep(h: number) {
    const { x, y, vx, vy, rx, ry, sz, on } = this;
    // friction
    for (let i = 0; i < 16; i++) {
      if (!on[i]) continue;
      let ux = vx[i] - rx[i], uy = vy[i] - ry[i];
      const us = Math.hypot(ux, uy);
      if (us > 1e-4) {
        const dv = MuSlide * h;
        if (us <= 3.5 * dv) {
          vx[i] -= ux / 3.5; vy[i] -= uy / 3.5;
          rx[i] = vx[i]; ry[i] = vy[i];
        } else {
          ux /= us; uy /= us;
          vx[i] -= dv * ux; vy[i] -= dv * uy;
          rx[i] += 2.5 * dv * ux; ry[i] += 2.5 * dv * uy;
        }
        const k = Math.max(0, 1 - RollC2 * Math.hypot(vx[i], vy[i]) * h);
        vx[i] *= k; vy[i] *= k; rx[i] *= k; ry[i] *= k;
      } else {
        const sp = Math.hypot(vx[i], vy[i]);
        const dec = (RollC0 + RollC2 * sp * sp) * h;
        if (sp <= dec) { vx[i] = vy[i] = 0; }
        else { const k = (sp - dec) / sp; vx[i] *= k; vy[i] *= k; }
        rx[i] = vx[i]; ry[i] = vy[i];
      }
      if (sz[i] !== 0) {
        const d = SpinDecay * h;
        sz[i] = Math.abs(sz[i]) <= d ? 0 : sz[i] - Math.sign(sz[i]) * d;
      }
      x[i] += vx[i] * h; y[i] += vy[i] * h;
    }
    // ball–ball
    for (let i = 0; i < 16; i++) {
      if (!on[i]) continue;
      for (let j = i + 1; j < 16; j++) {
        if (!on[j]) continue;
        const dx = x[j] - x[i], dy = y[j] - y[i];
        const d2 = dx * dx + dy * dy;
        if (d2 >= D * D) continue;
        let d = Math.sqrt(d2), nx = 1, ny = 0;
        if (d > 1e-9) { nx = dx / d; ny = dy / d; } else d = 0;
        const rel = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
        if (rel > 0) {
          const J = ((1 + BallE) / 2) * rel;
          vx[i] -= J * nx; vy[i] -= J * ny; vx[j] += J * nx; vy[j] += J * ny;
          // a little cloth/ball friction: cut shots throw slightly, spin bleeds
          this.hit(i, j, rel, x[i] + nx * R, y[i] + ny * R);
        }
        const push = (D - d) * 0.5 + 1e-6;
        x[i] -= nx * push; y[i] -= ny * push; x[j] += nx * push; y[j] += ny * push;
      }
    }
    // cushions + jaws
    const segs = Table.segs;
    for (let i = 0; i < 16; i++) {
      if (!on[i]) continue;
      // fast reject: far from every rail
      if (Math.abs(x[i]) < TW / 2 - R - 0.05 && Math.abs(y[i]) < TH / 2 - R - 0.05) continue;
      for (const s of segs) {
        const ex = s.bx - s.ax, ey = s.by - s.ay;
        let t = ((x[i] - s.ax) * ex + (y[i] - s.ay) * ey) / (ex * ex + ey * ey);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = s.ax + ex * t, cy = s.ay + ey * t;
        let nx = x[i] - cx, ny = y[i] - cy;
        const d = Math.hypot(nx, ny);
        if (d >= R) continue;
        if (d < 1e-9) continue;
        nx /= d; ny /= d;
        x[i] = cx + nx * R; y[i] = cy + ny * R;
        const vn = vx[i] * nx + vy[i] * ny;
        if (vn >= 0) continue;
        const e = s.jaw ? JawE : CushionE;
        const tx = -ny, ty = nx;
        let vt = vx[i] * tx + vy[i] * ty;
        // english: side spin grips the cushion and is partly used up
        const eng = sz[i] * 0.35 * Math.min(1, -vn / 6);
        const released = 0.2 * sz[i] * sz[i] * (1 - 0.55 * 0.55);
        const base = vt * 0.96;
        vt = base + eng;
        // the extra tangential speed can't exceed the spin energy given up
        const cap = base * base + 2 * 0.8 * released;
        if (vt * vt > cap) vt = Math.sign(vt) * Math.sqrt(cap);
        sz[i] *= 0.55;
        const vn2 = -vn * e;
        vx[i] = nx * vn2 + tx * vt; vy[i] = ny * vn2 + ty * vt;
        // the cushion nose is above centre: most of the roll into the rail is cancelled
        const rn = rx[i] * nx + ry[i] * ny, rt = rx[i] * tx + ry[i] * ty;
        const rn2 = -rn * 0.25;
        rx[i] = nx * rn2 + tx * rt; ry[i] = ny * rn2 + ty * rt;
        this.rail(i, -vn, cx, cy);
      }
    }
    // pockets (and a safety net for anything that escaped the rails)
    const pk = Table.pockets;
    for (let i = 0; i < 16; i++) {
      if (!on[i]) continue;
      if (Math.abs(x[i]) < TW / 2 - 0.4 && Math.abs(y[i]) < TH / 2 - 0.4) continue;
      let drop = -1;
      for (let p = 0; p < pk.length; p++) if ((x[i] - pk[p].x) ** 2 + (y[i] - pk[p].y) ** 2 < pk[p].r * pk[p].r) { drop = p; break; }
      if (drop < 0 && (Math.abs(x[i]) > TW / 2 + 0.6 || Math.abs(y[i]) > TH / 2 + 0.6)) {
        let best = 1e9;
        for (let p = 0; p < pk.length; p++) { const d = (x[i] - pk[p].x) ** 2 + (y[i] - pk[p].y) ** 2; if (d < best) { best = d; drop = p; } }
      }
      if (drop >= 0) this.drop(i, drop);
    }
  }

  private hit(i: number, j: number, speed: number, px: number, py: number) {
    const rec = this.record;
    if (i === 0 && rec.firstContact < 0) rec.firstContact = j;
    else if (j === 0 && rec.firstContact < 0) rec.firstContact = i;
    if (this.events && speed > 0.05) this.events.push({ type: Ev.Ball, a: i, b: j, speed, x: px, y: py });
  }

  private rail(i: number, speed: number, px: number, py: number) {
    const rec = this.record;
    if (rec.firstContact >= 0) rec.railAfterContact = true;
    else if (i === 0) rec.cushionsBeforeContact++;
    if (this.events && speed > 0.05) this.events.push({ type: Ev.Cushion, a: i, b: -1, speed, x: px, y: py });
  }

  private drop(i: number, p: number) {
    const speed = Math.hypot(this.vx[i], this.vy[i]);
    this.on[i] = 0;
    this.pocket[i] = p;
    if (this.events) this.events.push({ type: Ev.Pocket, a: i, b: p, speed, x: this.x[i], y: this.y[i] });
    this.vx[i] = this.vy[i] = this.rx[i] = this.ry[i] = this.sz[i] = 0;
    if (i === 0) this.record.cuePotted = true;
    else { this.record.potted.push(i); this.record.pocketOf.push(p); }
  }
}

// ------------------------------------------------------------------ geometry helpers (aiming, AI)

/** Distance from point p to segment ab. */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const ex = bx - ax, ey = by - ay;
  const l2 = ex * ex + ey * ey;
  let t = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
}

export interface AimHit {
  /** ghost ball centre (where the cue ball is at first contact) */
  gx: number; gy: number;
  /** ball hit (-1 = cushion / nothing) */
  ball: number;
  /** cushion normal when ball = -1 */
  nx: number; ny: number;
  dist: number;
}

/** Casts the cue ball (radius R) from (ox, oy) along (dx, dy): the first ball or cushion it touches. */
export function castCue(sim: PoolSim, ox: number, oy: number, dx: number, dy: number, from = 0): AimHit {
  const l = Math.hypot(dx, dy) || 1;
  dx /= l; dy /= l;
  let best = 1e9, ball = -1, nx = 0, ny = 0;
  for (let i = 0; i < 16; i++) {
    if (i === from || !sim.on[i]) continue;
    const fx = sim.x[i] - ox, fy = sim.y[i] - oy;
    const t = fx * dx + fy * dy;
    if (t <= 0) continue;
    const c2 = fx * fx + fy * fy - t * t;
    if (c2 >= D * D) continue;
    const s = t - Math.sqrt(D * D - c2);
    if (s < best && s > -0.01) { best = Math.max(0, s); ball = i; }
  }
  // cushions: the walls of the R-inset playing rectangle (pockets are ignored for the guide)
  const lim = [TW / 2 - R, TH / 2 - R];
  const tx = dx > 0 ? (lim[0] - ox) / dx : dx < 0 ? (-lim[0] - ox) / dx : 1e9;
  const ty = dy > 0 ? (lim[1] - oy) / dy : dy < 0 ? (-lim[1] - oy) / dy : 1e9;
  const tc = Math.max(0, Math.min(tx, ty));
  if (tc < best) {
    best = tc; ball = -1;
    if (tx < ty) { nx = -Math.sign(dx); ny = 0; } else { nx = 0; ny = -Math.sign(dy); }
  }
  return { gx: ox + dx * best, gy: oy + dy * best, ball, nx, ny, dist: best };
}
