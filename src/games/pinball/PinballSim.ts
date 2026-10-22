/**
 * Pinball simulation (pure logic, no kit imports): table geometry, sub-stepped ball physics against capsules, circles
 * and moving flippers, plus the rules (scoring, missions, multiball, ball save). Units: the table is about 10 wide and
 * 21 tall, y up, origin at the playfield centre.
 */

export interface Seg {
  ax: number; ay: number; bx: number; by: number;
  r: number; e: number; kick: number; mask: number; tag: string;
  active: boolean;
  /** One-way: only blocks a ball moving against this direction. */
  ow?: [number, number];
}
export interface Circ { x: number; y: number; r: number; e: number; kick: number; mask: number; tag: string; id: number }
export interface Trig { ax: number; ay: number; bx: number; by: number; tag: string; id: number; mask: number }

export class Flipper {
  angle: number; omega = 0; pressed = false;
  constructor(readonly px: number, readonly py: number, readonly len: number, readonly r0: number, readonly r1: number,
    readonly rest: number, readonly up: number, readonly side: number) { this.angle = rest; }
  get tipX() { return this.px + Math.cos(this.angle) * this.len; }
  get tipY() { return this.py + Math.sin(this.angle) * this.len; }
  /** 0 at rest, 1 fully up. */
  get lift() { return (this.angle - this.rest) / (this.up - this.rest); }
}

export class Ball {
  x = 0; y = 0; vx = 0; vy = 0;
  layer = 1; // bit mask: 1 = playfield, 2 = ramp
  alive = true;
  stuck = 0;
  lastSpinnerY = 0;
  id = 0;
  saved = false;
}

export const BallR = 0.25;
export const Gravity = 30;
export const TableLeft = -4.6, TableRight = 5.4, TableTop = 10.05, TableBottom = -10.8;
export const ShooterX = 5.0, PlungerY = -9.5;
export const FlipperLen = 1.7;

// ------------------------------------------------------------------ geometry helpers

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return pts;
}

/** Catmull-Rom through control points. */
export function spline(ctrl: [number, number][], per: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

/** Offsets a polyline sideways by d (positive = left of travel). */
export function offset(pts: [number, number][], d: number): [number, number][] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    return [p[0] - ty * d, p[1] + tx * d] as [number, number];
  });
}

// ------------------------------------------------------------------ table

export const RampCenter = spline([[2.72, -0.7], [3.3, 2.4], [3.4, 5.3], [2.85, 6.85], [1.2, 7.15], [-1.3, 6.75], [-2.95, 5.75], [-3.47, 3.4], [-3.47, -3.6]], 8);
export const RampHalf = 0.4;
export const Bumpers: [number, number][] = [[-1.3, 4.75], [1.3, 4.75], [0, 3.15]];
export const BumperR = 0.62;
export const DropTargets: [number, number][] = [[-0.95, 0.95], [0, 0.95], [0.95, 0.95]];
export const TopLanes = [-1.3, 0, 1.3];
export const LaneGuides = [-1.95, -0.65, 0.65, 1.95];
export const Spinner = { x0: -4.6, x1: -3.7, y: 1.9 };
export const OrbitWallX = -3.7;
export const ArcCenter: [number, number] = [0.4, 5.0];
export const ArcR = 5.0;

export interface Table {
  segs: Seg[]; circs: Circ[]; trigs: Trig[];
  rampL: [number, number][]; rampR: [number, number][];
  walls: [number, number][][]; // polylines for drawing
  slings: [number, number][][];
}

export function buildTable(): Table {
  const segs: Seg[] = [], circs: Circ[] = [], trigs: Trig[] = [], walls: [number, number][][] = [], slings: [number, number][][] = [];
  const seg = (ax: number, ay: number, bx: number, by: number, o: Partial<Seg> = {}) => {
    const s: Seg = { ax, ay, bx, by, r: 0.06, e: 0.45, kick: 0, mask: 1, tag: "wall", active: true, ...o };
    segs.push(s);
    return s;
  };
  const poly = (pts: [number, number][], o: Partial<Seg> = {}, draw = true) => {
    for (let i = 0; i < pts.length - 1; i++) seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], o);
    if (draw) walls.push(pts);
  };
  // outer shell: left wall, top arc, shooter lane outer wall
  const arc = arcPts(ArcCenter[0], ArcCenter[1], ArcR, Math.PI, 0, 36);
  poly([[TableLeft, TableBottom - 0.5], [TableLeft, ArcCenter[1]], ...arc.slice(1), [TableRight, PlungerY - 0.6]]);
  // shooter lane separator, gate (one-way, ball may only go up through it)
  poly([[4.6, TableBottom - 0.5], [4.6, 4.15]], { r: 0.08 });
  seg(4.62, 4.2, 5.38, 4.85, { ow: [0, 1], tag: "gate", r: 0.04, e: 0.2 });
  // plunger floor
  seg(4.6, PlungerY, 5.4, PlungerY, { tag: "plunger", r: 0.05, e: 0.1 });
  // left orbit lane inner wall and its exit deflector
  poly([[OrbitWallX, -0.7], [OrbitWallX, 4.3], [-3.45, 4.75]], { r: 0.09 });
  poly([[TableLeft, -1.3], [-3.92, -2.2]], { r: 0.08 });
  poly([[4.6, -1.55], [3.7, -2.65]], { r: 0.08 });
  // inlane / outlane guides
  for (const s of [-1, 1]) {
    poly([[3.85 * s, -4.55], [3.85 * s, -6.5], [2.12 * s, -7.88]], { r: 0.09 });
    // slingshots: kicker face plus two plain sides
    const T: [number, number] = [3.05 * s, -4.7], B: [number, number] = [3.05 * s, -6.15], C: [number, number] = [2.3 * s, -6.6];
    seg(T[0], T[1], C[0], C[1], { kick: 5.5, e: 0.5, tag: s < 0 ? "slingL" : "slingR", r: 0.1 });
    seg(T[0], T[1], B[0], B[1], { r: 0.1 });
    seg(B[0], B[1], C[0], C[1], { r: 0.1 });
    slings.push([T, B, C]);
    // flipper side guard below the inlane guide end
    // inlane rollovers
    trigs.push({ ax: 3.85 * s, ay: -5.4, bx: 3.1 * s, by: -5.4, tag: "inlane", id: s < 0 ? 0 : 1, mask: 1 });
    trigs.push({ ax: 4.6 * s, ay: -5.4, bx: 3.85 * s, by: -5.4, tag: "outlane", id: s < 0 ? 0 : 1, mask: 1 });
  }
  // top lane guides and rollovers
  for (const x of LaneGuides) poly([[x, 7.45], [x, 8.45]], { r: 0.1 });
  TopLanes.forEach((x, i) => trigs.push({ ax: x - 0.5, ay: 7.95, bx: x + 0.5, by: 7.95, tag: "lane", id: i, mask: 1 }));
  // bumpers
  Bumpers.forEach(([x, y], i) => circs.push({ x, y, r: BumperR, e: 0.5, kick: 13, mask: 1, tag: "bumper", id: i }));
  // drop targets (with a backstop so the bank reads as a wall face)
  DropTargets.forEach(([x, y], i) => seg(x - 0.36, y, x + 0.36, y, { tag: "drop" + i, r: 0.1, e: 0.35 }));
  // posts between targets
  for (const x of [-1.42, 1.42]) circs.push({ x, y: 0.95, r: 0.12, e: 0.5, kick: 0, mask: 1, tag: "post", id: -1 });
  // spinner and orbit switch
  trigs.push({ ax: Spinner.x0, ay: Spinner.y, bx: Spinner.x1, by: Spinner.y, tag: "spinner", id: 0, mask: 1 });
  // ramp: entrance walls exist on both layers, the rest only for balls on the ramp
  const rampL = offset(RampCenter, RampHalf), rampR = offset(RampCenter, -RampHalf);
  for (let i = 0; i < RampCenter.length - 1; i++) {
    const m = i < 6 ? 3 : 2;
    seg(rampL[i][0], rampL[i][1], rampL[i + 1][0], rampL[i + 1][1], { mask: m, r: 0.06, e: 0.3, tag: "ramp" });
    seg(rampR[i][0], rampR[i][1], rampR[i + 1][0], rampR[i + 1][1], { mask: m, r: 0.06, e: 0.3, tag: "ramp" });
  }
  // mouth flare so near misses bounce off the ramp's base instead of slipping under it
  seg(rampR[0][0], rampR[0][1], rampR[0][0] + 0.35, rampR[0][1] - 0.15, { mask: 1, r: 0.08 });
  const e0 = 3, eL = rampL[e0], eR = rampR[e0];
  trigs.push({ ax: eL[0], ay: eL[1], bx: eR[0], by: eR[1], tag: "rampIn", id: 0, mask: 3 });
  const n = RampCenter.length - 2, xL = rampL[n], xR = rampR[n];
  trigs.push({ ax: xL[0], ay: xL[1], bx: xR[0], by: xR[1], tag: "rampOut", id: 0, mask: 2 });
  // flipper bottom aprons (keep the ball from rolling under the flippers' pivots)
  for (const s of [-1, 1]) seg(2.12 * s, -7.88, 2.12 * s, -8.6, { r: 0.12 });
  return { segs, circs, trigs, rampL, rampR, walls, slings };
}

// ------------------------------------------------------------------ rules

export type PinEvent =
  | { k: "bumper"; id: number }
  | { k: "sling"; side: number }
  | { k: "drop"; id: number }
  | { k: "bank" }
  | { k: "lane"; id: number; all: boolean }
  | { k: "spin" }
  | { k: "ramp"; combo: number; jackpot: boolean }
  | { k: "orbit"; combo: number }
  | { k: "rampFail" }
  | { k: "inlane" }
  | { k: "outlane" }
  | { k: "drain"; last: boolean; saved: boolean }
  | { k: "launch" }
  | { k: "mission"; idx: number; pts: number }
  | { k: "multiball" }
  | { k: "flip"; side: number }
  | { k: "hit"; speed: number }
  | { k: "flipHit"; speed: number };

export const Missions = [
  { name: "BUMPER BLITZ", goal: 12, text: "HIT THE POP BUMPERS" },
  { name: "BREAK THE WALL", goal: 1, text: "DROP ALL 3 TARGETS" },
  { name: "RAMP RUNNER", goal: 2, text: "SHOOT THE RAMP" },
  { name: "ORB LIGHTS", goal: 1, text: "LIGHT ALL 3 TOP LANES" },
  { name: "SPIN CYCLE", goal: 15, text: "RIP THE SPINNER" },
  { name: "ORBIT RUN", goal: 2, text: "SHOOT THE LEFT ORBIT" },
];

/** Shot the current mission asks for (used for insert arrows and the bot's aim). */
export const MissionShot = ["bumper", "drop", "ramp", "lane", "spinner", "orbit"];

export class PinSim {
  readonly t: Table;
  readonly flippers: Flipper[];
  balls: Ball[] = [];
  events: PinEvent[] = [];
  score = 0;
  bonus = 0;
  mult = 1;
  lanes = [false, false, false];
  drops = [false, false, false];
  dropReset = 0;
  spinAngle = 0; spinSpeed = 0; private spinAcc = 0;
  mission = 0; missionCount = 0; missionsDone = 0;
  comboT = 0; combo = 0;
  saveT = 0;
  multiball = false; jackpots = 0;
  plungerPull = 0; plungerHeld = false;
  /** Waiting for a ball in the shooter lane. */
  needLaunch = true;
  bumperFlash = [0, 0, 0];
  slingFlash = [0, 0];
  time = 0;
  private nextId = 1;
  pendingMulti = 0;
  pendingTimer = 0;
  drained = false;
  bumperHits = 0; rampsMade = 0; spins = 0;

  constructor(readonly seed = 1) {
    this.t = buildTable();
    const rest = -0.52, up = 0.47;
    this.flippers = [
      new Flipper(-1.95, -8.2, FlipperLen, 0.24, 0.12, rest, up, 1),
      new Flipper(1.95, -8.2, FlipperLen, 0.24, 0.12, Math.PI - rest, Math.PI - up, -1),
    ];
  }

  private rngS = 0x9e3779b9;
  rand() {
    let t = (this.rngS = (this.rngS + 0x6d2b79f5 + this.seed) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Puts a fresh ball on the plunger. */
  serve() {
    const b = new Ball();
    b.id = this.nextId++;
    b.x = ShooterX;
    b.y = PlungerY + BallR + 0.06;
    this.balls.push(b);
    this.needLaunch = true;
    this.drained = false;
    this.plungerPull = 0;
    return b;
  }

  /** New ball for a player turn: resets per-ball state (missions and lights carry on). */
  newBall() {
    this.balls = [];
    this.bonus = 0;
    this.mult = 1;
    this.multiball = false;
    this.comboT = 0;
    this.combo = 0;
    this.serve();
  }

  get ballInLane() { return this.balls.some((b) => b.x > 4.6 && b.y < -7.5); }

  setPlunger(held: boolean) {
    if (held) this.plungerHeld = true;
    else if (this.plungerHeld) { this.plungerHeld = false; this.release(); }
  }

  private release() {
    const pull = this.plungerPull;
    this.plungerPull = 0;
    let launched = false;
    for (const b of this.balls)
      if (b.x > 4.6 && b.y < PlungerY + 1.2) {
        b.y = Math.max(b.y, PlungerY + BallR + 0.07);
        b.vy = 14 + 30 * pull + this.rand() * 0.6;
        b.vx = 0;
        launched = true;
      }
    if (launched && pull > 0.15) {
      if (this.needLaunch) this.saveT = Math.max(this.saveT, 10);
      this.needLaunch = false;
      this.events.push({ k: "launch" });
    }
  }

  step(dt: number) {
    this.time += dt;
    // plunger
    if (this.plungerHeld) this.plungerPull = Math.min(1, this.plungerPull + dt * 1.1);
    if (this.saveT > 0 && !this.needLaunch) this.saveT -= dt;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    for (let i = 0; i < 3; i++) this.bumperFlash[i] = Math.max(0, this.bumperFlash[i] - dt * 5);
    for (let i = 0; i < 2; i++) this.slingFlash[i] = Math.max(0, this.slingFlash[i] - dt * 6);
    if (this.dropReset > 0) {
      this.dropReset -= dt;
      if (this.dropReset <= 0) { this.drops = [false, false, false]; this.syncDrops(); }
    }
    // spinner
    this.spinAngle += this.spinSpeed * dt;
    this.spinAcc += this.spinSpeed * dt;
    while (this.spinAcc > Math.PI) { this.spinAcc -= Math.PI; this.award(100, 10); this.spins++; this.progress(4, 1); this.events.push({ k: "spin" }); }
    this.spinSpeed = Math.max(0, this.spinSpeed - dt * (4 + this.spinSpeed * 0.9));
    // multiball feed
    if (this.pendingMulti > 0) {
      this.pendingTimer -= dt;
      if (this.pendingTimer <= 0) {
        this.pendingMulti--;
        this.pendingTimer = 1.0;
        const b = this.serve();
        b.vy = 40;
        this.needLaunch = false;
        this.events.push({ k: "launch" });
      }
    }

    const sub = Math.max(1, Math.ceil(dt / (1 / 480)));
    const h = dt / sub;
    for (let s = 0; s < sub; s++) this.substep(h);

    // drains
    for (const b of this.balls) {
      if (!b.alive || b.y > TableBottom) continue;
      b.alive = false;
      const others = this.balls.filter((o) => o.alive).length;
      const saved = this.saveT > 0 || (this.multiball && this.saveT > 0);
      if (saved) {
        this.events.push({ k: "drain", last: false, saved: true });
        const nb = this.serve();
        nb.vy = 36;
        this.needLaunch = false;
        nb.saved = true;
        this.events.push({ k: "launch" });
        continue;
      }
      if (others === 0 && this.pendingMulti === 0) {
        this.drained = true;
        this.events.push({ k: "drain", last: true, saved: false });
      } else this.events.push({ k: "drain", last: false, saved: false });
    }
    this.balls = this.balls.filter((b) => b.alive);
    if (this.multiball && this.balls.length + this.pendingMulti <= 1) this.multiball = false;
  }

  private substep(h: number) {
    for (const f of this.flippers) {
      const target = f.pressed ? f.up : f.rest;
      const speed = f.pressed ? 26 : 16;
      const d = target - f.angle;
      const maxStep = speed * h;
      const step = Math.abs(d) < maxStep ? d : Math.sign(d) * maxStep;
      f.angle += step;
      f.omega = step / h;
    }
    // plunger floor follows the pull
    const pl = this.t.segs.find((s) => s.tag === "plunger")!;
    pl.ay = pl.by = PlungerY - this.plungerPull * 0.7;

    for (const b of this.balls) {
      if (!b.alive) continue;
      b.vy -= Gravity * h;
      // a little rolling drag
      b.vx *= 1 - 0.08 * h;
      b.vy *= 1 - 0.08 * h;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 48) { b.vx *= 48 / sp; b.vy *= 48 / sp; }
      const ox = b.x, oy = b.y;
      b.x += b.vx * h;
      b.y += b.vy * h;
      this.collide(b);
      this.triggers(b, ox, oy);
      // stuck detection (ball search)
      if (Math.hypot(b.vx, b.vy) < 0.3 && !(b.x > 4.6 && b.y < -7)) {
        b.stuck += h;
        if (b.stuck > 3) { b.stuck = 0; b.vx += (this.rand() - 0.5) * 8; b.vy += 6; }
      } else b.stuck = 0;
    }
    // ball vs ball
    for (let i = 0; i < this.balls.length; i++)
      for (let j = i + 1; j < this.balls.length; j++) {
        const a = this.balls[i], c = this.balls[j];
        if (!(a.layer & c.layer)) continue;
        const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
        if (d >= BallR * 2 || d < 1e-6) continue;
        const nx = dx / d, ny = dy / d, pen = BallR * 2 - d;
        a.x -= nx * pen / 2; a.y -= ny * pen / 2; c.x += nx * pen / 2; c.y += ny * pen / 2;
        const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (rel < 0) {
          const j2 = -rel * 0.95;
          a.vx -= nx * j2; a.vy -= ny * j2; c.vx += nx * j2; c.vy += ny * j2;
        }
      }
  }

  private collide(b: Ball) {
    for (let iter = 0; iter < 2; iter++) {
      for (const s of this.t.segs) {
        if (!s.active || !(s.mask & b.layer)) continue;
        const abx = s.bx - s.ax, aby = s.by - s.ay;
        const l2 = abx * abx + aby * aby;
        let t = l2 > 0 ? ((b.x - s.ax) * abx + (b.y - s.ay) * aby) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = s.ax + abx * t, cy = s.ay + aby * t;
        let dx = b.x - cx, dy = b.y - cy;
        const d = Math.hypot(dx, dy), R = BallR + s.r;
        if (d >= R) continue;
        if (s.ow) {
          // one-way gate: passes balls moving along ow
          if (b.vx * s.ow[0] + b.vy * s.ow[1] > 0) continue;
        }
        if (d < 1e-6) { dx = -aby; dy = abx; } else { dx /= d; dy /= d; }
        const nx = d < 1e-6 ? dx / Math.hypot(dx, dy) : dx, ny = d < 1e-6 ? dy / Math.hypot(dx, dy) : dy;
        b.x = cx + nx * R;
        b.y = cy + ny * R;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= (1 + s.e) * vn * nx;
          b.vy -= (1 + s.e) * vn * ny;
          // light friction along the surface
          const tx = -ny, ty = nx, vt = b.vx * tx + b.vy * ty;
          b.vx -= tx * vt * 0.02;
          b.vy -= ty * vt * 0.02;
          if (s.kick > 0 && -vn > 1.2) {
            b.vx += nx * s.kick;
            b.vy += ny * s.kick;
            this.onKick(s);
          } else if (s.tag.startsWith("drop")) this.onDrop(Number(s.tag.slice(4)));
          else if (-vn > 4) this.events.push({ k: "hit", speed: -vn });
        }
      }
      for (const c of this.t.circs) {
        if (!(c.mask & b.layer)) continue;
        const dx = b.x - c.x, dy = b.y - c.y, d = Math.hypot(dx, dy), R = BallR + c.r;
        if (d >= R || d < 1e-6) continue;
        const nx = dx / d, ny = dy / d;
        b.x = c.x + nx * R;
        b.y = c.y + ny * R;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= (1 + c.e) * vn * nx;
          b.vy -= (1 + c.e) * vn * ny;
        }
        if (c.kick > 0) {
          b.vx += nx * c.kick * 0.75;
          b.vy += ny * c.kick * 0.75;
          if (c.tag === "bumper") this.onBumper(c.id);
        }
      }
      if (b.layer & 1) for (const f of this.flippers) this.collideFlipper(b, f);
    }
  }

  private collideFlipper(b: Ball, f: Flipper) {
    const ux = Math.cos(f.angle), uy = Math.sin(f.angle);
    let t = (b.x - f.px) * ux + (b.y - f.py) * uy;
    t = t < 0 ? 0 : t > f.len ? f.len : t;
    const cx = f.px + ux * t, cy = f.py + uy * t;
    const rad = f.r0 + (f.r1 - f.r0) * (t / f.len);
    const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy), R = BallR + rad;
    if (d >= R || d < 1e-6) return;
    const nx = dx / d, ny = dy / d;
    b.x = cx + nx * R;
    b.y = cy + ny * R;
    // surface velocity of the flipper at the contact point
    const qx = cx + nx * rad - f.px, qy = cy + ny * rad - f.py;
    const svx = -f.omega * qy, svy = f.omega * qx;
    const rvx = b.vx - svx, rvy = b.vy - svy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const e = Math.abs(f.omega) > 1 ? 0.45 : 0.25;
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
      const tx = -ny, ty = nx, vt = rvx * tx + rvy * ty;
      b.vx -= tx * vt * 0.03;
      b.vy -= ty * vt * 0.03;
      if (-vn > 6) this.events.push({ k: "flipHit", speed: -vn });
    }
  }

  private triggers(b: Ball, ox: number, oy: number) {
    for (const tr of this.t.trigs) {
      if (!(tr.mask & b.layer)) continue;
      const s1 = side(tr, ox, oy), s2 = side(tr, b.x, b.y);
      if (s1 === s2 || s1 === 0) continue;
      // crossing point within the segment?
      const ex = tr.bx - tr.ax, ey = tr.by - tr.ay, l2 = ex * ex + ey * ey;
      const tt = ((b.x - tr.ax) * ex + (b.y - tr.ay) * ey) / l2;
      if (tt < -0.05 || tt > 1.05) continue;
      this.onTrigger(b, tr, b.vy > 0);
    }
  }

  // ------------------------------------------------------------------ scoring

  private award(pts: number, bonus = 0) { this.score += pts * (this.multiball ? 2 : 1); this.bonus += bonus; }

  private progress(m: number, n: number) {
    if (this.mission !== m) return;
    this.missionCount += n;
    if (this.missionCount >= Missions[m].goal) {
      const pts = 20000 * (this.missionsDone + 1);
      this.award(pts, 1000);
      this.missionsDone++;
      this.events.push({ k: "mission", idx: m, pts });
      this.mission = (this.mission + 1) % Missions.length;
      this.missionCount = 0;
      if (this.missionsDone % 2 === 0) this.startMultiball();
    }
  }

  startMultiball() {
    if (this.multiball) return;
    this.multiball = true;
    this.pendingMulti = 2;
    this.pendingTimer = 0.6;
    this.saveT = Math.max(this.saveT, 12);
    this.events.push({ k: "multiball" });
  }

  private onKick(s: Seg) {
    const side = s.tag === "slingL" ? 0 : 1;
    this.slingFlash[side] = 1;
    this.award(100, 10);
    this.events.push({ k: "sling", side });
  }

  private onBumper(id: number) {
    this.bumperFlash[id] = 1;
    this.award(500, 25);
    this.bumperHits++;
    this.progress(0, 1);
    this.events.push({ k: "bumper", id });
  }

  private onDrop(i: number) {
    if (this.drops[i]) return;
    this.drops[i] = true;
    this.syncDrops();
    this.award(1000, 100);
    this.events.push({ k: "drop", id: i });
    if (this.drops.every((d) => d)) {
      this.award(10000, 500);
      this.dropReset = 2.5;
      this.progress(1, 1);
      this.events.push({ k: "bank" });
    }
  }

  private syncDrops() {
    for (const s of this.t.segs) if (s.tag.startsWith("drop")) s.active = !this.drops[Number(s.tag.slice(4))];
  }

  private onTrigger(b: Ball, tr: Trig, up: boolean) {
    switch (tr.tag) {
      case "lane":
        if (up) return;
        if (!this.lanes[tr.id]) {
          this.lanes[tr.id] = true;
          this.award(1000, 100);
          const all = this.lanes.every((l) => l);
          if (all) {
            this.mult = Math.min(5, this.mult + 1);
            this.award(10000, 500);
            this.lanes = [false, false, false];
            this.progress(3, 1);
          }
          this.events.push({ k: "lane", id: tr.id, all });
        } else this.award(250, 10);
        return;
      case "spinner":
        this.spinSpeed = Math.min(60, this.spinSpeed + Math.abs(b.vy) * 1.6);
        if (up) b.lastSpinnerY = this.time;
        else if (this.time - b.lastSpinnerY > 0.35 && this.time - b.lastSpinnerY < 4) {
          // came back down the orbit lane after going around: an orbit
          this.combo = this.comboT > 0 ? this.combo + 1 : 1;
          this.comboT = 4;
          this.award(3000 * this.combo, 200);
          this.progress(5, 1);
          this.events.push({ k: "orbit", combo: this.combo });
          b.lastSpinnerY = 0;
        }
        return;
      case "rampIn":
        if (up && b.layer === 1) b.layer = 2;
        else if (!up && b.layer === 2) { b.layer = 1; this.events.push({ k: "rampFail" }); }
        return;
      case "rampOut":
        if (!up && b.layer === 2) {
          b.layer = 1;
          this.rampsMade++;
          this.combo = this.comboT > 0 ? this.combo + 1 : 1;
          this.comboT = 4;
          const jackpot = this.multiball;
          if (jackpot) this.jackpots++;
          this.award((jackpot ? 25000 : 5000) * this.combo, 300);
          this.progress(2, 1);
          this.events.push({ k: "ramp", combo: this.combo, jackpot });
        }
        return;
      case "inlane":
        if (!up) { this.award(500, 50); this.events.push({ k: "inlane" }); }
        return;
      case "outlane":
        if (!up) { this.award(2000, 100); this.events.push({ k: "outlane" }); }
        return;
    }
  }

  /** Lane change: flipper buttons rotate the lit top lanes. */
  rotateLanes(dir: number) {
    const l = this.lanes;
    this.lanes = dir > 0 ? [l[2], l[0], l[1]] : [l[1], l[2], l[0]];
  }

  setFlipper(side: number, pressed: boolean) {
    const f = this.flippers[side];
    if (pressed && !f.pressed) { this.events.push({ k: "flip", side }); if (!this.needLaunch) this.rotateLanes(side === 0 ? -1 : 1); }
    f.pressed = pressed;
  }

  /** End-of-ball bonus (already multiplied). */
  get endBonus() { return this.bonus * this.mult; }
  collectBonus() { const b = this.endBonus; this.score += b; this.bonus = 0; return b; }
}

function side(t: Trig, x: number, y: number) {
  const v = (t.bx - t.ax) * (y - t.ay) - (t.by - t.ay) * (x - t.ax);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

// ------------------------------------------------------------------ bot

export interface PinBotLevel { delay: number; jitter: number; miss: number; aim: boolean }
export const PinBotLevels: PinBotLevel[] = [
  { delay: 0.07, jitter: 0.09, miss: 0.18, aim: false },
  { delay: 0.03, jitter: 0.05, miss: 0.06, aim: false },
  { delay: 0.0, jitter: 0.015, miss: 0.0, aim: true },
];

/** Computer player: flips when the ball is over a flipper's sweet spot and plunges with a strong pull. */
export class PinBot {
  private hold = [0, 0];
  private wait = [-1, -1];
  private plungeT = 0;
  private r: () => number;
  constructor(readonly lv: PinBotLevel, seed: number) {
    let s = seed >>> 0 || 7;
    this.r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  think(sim: PinSim, dt: number) {
    // plunger
    if (sim.needLaunch && sim.ballInLane) {
      this.plungeT += dt;
      sim.setPlunger(this.plungeT > 0.5 && this.plungeT < 0.5 + 0.75 + this.r() * 0.02);
      if (this.plungeT > 1.6) this.plungeT = 0;
    } else { this.plungeT = 0; if (sim.plungerHeld) sim.setPlunger(false); }

    for (let s = 0; s < 2; s++) {
      const f = sim.flippers[s];
      if (this.hold[s] > 0) {
        this.hold[s] -= dt;
        if (this.hold[s] <= 0) sim.setFlipper(s, false);
        continue;
      }
      if (this.wait[s] >= 0) {
        this.wait[s] -= dt;
        if (this.wait[s] < 0) { sim.setFlipper(s, true); this.hold[s] = 0.22; }
        continue;
      }
      for (const b of sim.balls) {
        if (b.layer !== 1 || b.y > -5.5) continue;
        // ball in flipper coordinates (rest pose)
        const ux = Math.cos(f.rest), uy = Math.sin(f.rest);
        // look a little ahead in time
        const la = 0.035;
        const bx = b.x + b.vx * la, by = b.y + b.vy * la;
        const t = ((bx - f.px) * ux + (by - f.py) * uy) / f.len;
        const dist = (bx - f.px) * -uy * f.side + (by - f.py) * ux * f.side; // above the flipper line > 0
        if (t < 0.12 || t > 1.05 || dist < -0.2 || dist > 0.75) continue;
        const sweet = this.lv.aim ? this.aimPoint(sim, s) : 0.62;
        const slow = Math.hypot(b.vx, b.vy) < 3;
        if (!slow && b.vy > 2) continue;
        if (Math.abs(t - sweet) > (slow ? 0.6 : 0.2) && t < 0.92) continue;
        if (this.r() < this.lv.miss * dt * 8) continue;
        this.wait[s] = Math.max(0, this.lv.delay + (this.r() - 0.5) * 2 * this.lv.jitter);
        break;
      }
    }
  }

  /** Where along the flipper to hit so the ball goes toward the mission shot. */
  private aimPoint(sim: PinSim, side: number) {
    const shot = MissionShot[sim.mission];
    if (shot === "ramp") return side === 0 ? 0.6 : 0.75;
    if (shot === "orbit" || shot === "spinner") return side === 1 ? 0.62 : 0.8;
    if (shot === "drop") return 0.5;
    return 0.66;
  }
}
