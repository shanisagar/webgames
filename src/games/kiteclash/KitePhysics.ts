import { Mathf, SysRandom, V2 } from "../../kit/math";

/**
 * KITE CLASH sky simulation (no rendering, so it also runs headless for bot tests).
 * A fighter kite spins slowly while its string is slack; while the string is pulled the kite darts the way its nose
 * points. Strings are verlet ropes from the flyer's hand to the kite. When two strings cross, the kite that pulls
 * harder (holding and moving away from the crossing faster) saws through the other string.
 */

export const SpinRate = 205;       // deg/s while the string is slack
export const PullSpeed = 8.2;      // world units/s along the nose while pulling
export const KiteHit = 0.7;        // pickup / bird radius around a kite
export const RopeN = 13;
/** Tunables (an object so the headless tests can sweep them). */
export const Tune = { sawRate: 3, slackGive: 0.7, lever: 1 };
const Step = 1 / 60;

export interface Arena { xMin: number; xMax: number; yMin: number; yMax: number }

export enum KState { Launch, Fly, Cut, Gone }


/** A rope of verlet points. Ends can be pinned (hand, kite) or free (a cut end). */
export class Rope {
  pts: V2[] = [];
  prev: V2[] = [];
  len = 1;
  constructor(a: V2, b: V2, n = RopeN) {
    for (let i = 0; i < n; i++) { const p = V2.lerpUnclamped(a, b, i / (n - 1)); this.pts.push(p); this.prev.push(p); }
    this.len = Math.max(0.1, V2.distance(a, b));
  }

  step(dt: number, a: V2 | null, b: V2 | null, wind: V2, gravity = 3.2) {
    const n = this.pts.length;
    if (n < 2) return;
    const seg = this.len / (n - 1);
    const gx = wind.x * 0.35 * dt * dt, gy = (-gravity + wind.y * 0.2) * dt * dt;
    for (let i = 0; i < n; i++) {
      if ((i === 0 && a) || (i === n - 1 && b)) continue;
      const p = this.pts[i], q = this.prev[i];
      this.prev[i] = p;
      this.pts[i] = new V2(p.x + (p.x - q.x) * 0.982 + gx, p.y + (p.y - q.y) * 0.982 + gy);
    }
    for (let it = 0; it < 6; it++) {
      if (a) this.pts[0] = a;
      if (b) this.pts[n - 1] = b;
      for (let i = 0; i < n - 1; i++) {
        const p = this.pts[i], q = this.pts[i + 1];
        const dx = q.x - p.x, dy = q.y - p.y, m = Math.hypot(dx, dy);
        if (m <= seg || m < 1e-6) continue; // a string only resists stretching
        const pinA = i === 0 && !!a, pinB = i + 1 === n - 1 && !!b;
        if (pinA && pinB) continue;
        const wa = pinA ? 0 : pinB ? 1 : 0.5, wb = pinB ? 0 : pinA ? 1 : 0.5;
        const k = (m - seg) / m;
        this.pts[i] = new V2(p.x + dx * k * wa, p.y + dy * k * wa);
        this.pts[i + 1] = new V2(q.x - dx * k * wb, q.y - dy * k * wb);
      }
    }
    if (a) this.pts[0] = a;
    if (b) this.pts[n - 1] = b;
  }

  /** Point at segment i, fraction t. */
  at(i: number, t: number) { return V2.lerpUnclamped(this.pts[i], this.pts[Math.min(i + 1, this.pts.length - 1)], t); }

  /** Splits at segment i / fraction t: returns [hand side, kite side] with free ends at the cut. */
  split(i: number, t: number): [Rope, Rope] {
    const c = this.at(i, t), n = this.pts.length;
    const first = new Rope(V2.zero, V2.zero, 2), second = new Rope(V2.zero, V2.zero, 2);
    const take = (r: Rope, src: V2[], prev: V2[]) => {
      // resample to a few even points so both halves keep simulating nicely
      const m = Math.max(4, Math.min(9, src.length + 1));
      let total = 0;
      for (let k = 0; k < src.length - 1; k++) total += V2.distance(src[k], src[k + 1]);
      r.pts = []; r.prev = [];
      for (let k = 0; k < m; k++) {
        const d = (total * k) / (m - 1);
        let acc = 0, p = src[src.length - 1], pv = prev[prev.length - 1];
        for (let s = 0; s < src.length - 1; s++) {
          const l = V2.distance(src[s], src[s + 1]);
          if (acc + l >= d || s === src.length - 2) { const f = l > 1e-6 ? Mathf.clamp01((d - acc) / l) : 0; p = V2.lerp(src[s], src[s + 1], f); pv = V2.lerp(prev[s], prev[s + 1], f); break; }
          acc += l;
        }
        r.pts.push(p); r.prev.push(pv);
      }
      r.len = Math.max(0.2, total);
    };
    const aPts = this.pts.slice(0, i + 1).concat([c]), aPrev = this.prev.slice(0, i + 1).concat([c]);
    const bPts = [c].concat(this.pts.slice(i + 1, n)), bPrev = [c].concat(this.prev.slice(i + 1, n));
    take(first, aPts, aPrev);
    take(second, bPts, bPrev);
    return [first, second];
  }
}

export class Kite {
  id = 0;
  team = 0;
  pos = V2.zero; vel = V2.zero;
  ang = 90; spinDir = 1; spin = 1;
  hold = false; holdT = 0; slackT = 0; pulls = 0; private wasHold = false;
  anchor = V2.zero;
  state = KState.Gone;
  launchT = 0; launchFrom = V2.zero; launchTo = V2.zero; launchDur = 1.4;
  rope: Rope;
  strength = 1; speedMul = 1;
  glassT = 0; boostT = 0; wobbleT = 0; safeT = 0;
  // after a cut
  loose: Rope | null = null; tail: Rope | null = null; cutT = 0; tumble = 0;
  /** Where the string was cut (for effects). */
  cutAt = V2.zero;
  design = 0; stringColor = 0;
  /** Seconds since the last bird hit / pickup etc. for visuals. */
  flash = 0;

  constructor(id: number) { this.id = id; this.rope = new Rope(V2.zero, V2.up, RopeN); }

  get dir() { return V2.fromAngle(this.ang * Mathf.Deg2Rad); }
  get flying() { return this.state === KState.Fly; }
  get tethered() { return this.state === KState.Fly || this.state === KState.Launch; }

  launch(anchor: V2, to: V2, dur = 1.4) {
    this.anchor = anchor;
    this.state = KState.Launch;
    this.launchT = 0; this.launchDur = dur;
    this.launchFrom = anchor.add(new V2(0, 0.4));
    this.launchTo = to;
    this.pos = this.launchFrom; this.vel = V2.zero;
    this.ang = 90; this.spin = 0; this.hold = false; this.holdT = 0; this.slackT = 0; this.wasHold = false;
    this.glassT = this.boostT = this.wobbleT = 0;
    this.loose = this.tail = null; this.cutT = 0;
    this.rope = new Rope(anchor, this.pos, RopeN);
  }

  step(dt: number, wind: V2, arena: Arena, time: number) {
    this.glassT = Math.max(0, this.glassT - dt);
    this.boostT = Math.max(0, this.boostT - dt);
    this.safeT = Math.max(0, this.safeT - dt);
    this.flash = Math.max(0, this.flash - dt);
    if (this.state === KState.Launch) {
      this.launchT += dt;
      const k = Mathf.clamp01(this.launchT / this.launchDur), e = 1 - (1 - k) * (1 - k);
      const prev = this.pos;
      this.pos = V2.lerpUnclamped(this.launchFrom, this.launchTo, e).add(new V2(Math.sin(k * 9) * 0.25 * (1 - k), 0));
      this.vel = this.pos.sub(prev).mul(1 / Math.max(dt, 1e-4));
      this.ang = 90 + Math.sin(time * 5 + this.id) * 12 * (1 - k);
      if (k >= 1) { this.state = KState.Fly; this.vel = new V2(0, 1.5); this.slackT = 0.2; }
      this.stepRope(dt, wind, true);
      return;
    }
    if (this.state === KState.Cut) { this.stepCut(dt, wind, arena, time); return; }
    if (this.state !== KState.Fly) return;

    const hold = this.hold;
    if (hold && !this.wasHold) this.pulls++;
    this.wasHold = hold;
    if (hold) { this.holdT += dt; this.slackT = 0; this.spin = Mathf.moveTowards(this.spin, 0, dt * 9); }
    else { this.slackT += dt; this.holdT = 0; this.spin = Mathf.moveTowards(this.spin, 1, dt * 5); }
    this.ang += this.spinDir * SpinRate * this.spin * dt;
    if (this.wobbleT > 0) {
      this.wobbleT -= dt;
      this.ang += Math.sin(time * 27 + this.id * 3) * 420 * dt * Mathf.clamp01(this.wobbleT);
    }
    this.ang = Mathf.repeat(this.ang, 360);
    const boost = this.boostT > 0 ? 1.45 : 1;
    let target: V2, rate: number;
    if (hold) {
      // pulling into the edge of the sky: the kite skims along it instead of stalling
      let dir = this.dir;
      const m = 0.25;
      if ((this.pos.x <= arena.xMin + m && dir.x < 0) || (this.pos.x >= arena.xMax - m && dir.x > 0)) dir = new V2(dir.x * 0.15, (Math.sign(dir.y) || 1) * Math.max(0.75, Math.abs(dir.y)));
      if ((this.pos.y <= arena.yMin + m && dir.y < 0) || (this.pos.y >= arena.yMax - m && dir.y > 0)) dir = new V2((Math.sign(dir.x) || -Math.sign(this.pos.x) || 1) * Math.max(0.75, Math.abs(dir.x)), dir.y * 0.15);
      target = dir.mul(PullSpeed * this.speedMul * boost).add(wind.mul(0.25));
      rate = 7;
    } else {
      const sink = Mathf.clamp01((this.slackT - 0.45) / 1.4) * 2.1;
      target = wind.mul(0.85).add(new V2(0, 0.25 - sink));
      rate = 2.0;
    }
    this.vel = V2.lerpUnclamped(this.vel, target, 1 - Math.exp(-dt * rate));
    this.pos = this.pos.add(this.vel.mul(dt));
    // soft sky bounds
    let { x, y } = this.pos, vx = this.vel.x, vy = this.vel.y;
    if (x < arena.xMin) { x = arena.xMin; if (vx < 0) vx = -vx * 0.3; }
    if (x > arena.xMax) { x = arena.xMax; if (vx > 0) vx = -vx * 0.3; }
    if (y < arena.yMin) { y = arena.yMin; if (vy < 0) vy = -vy * 0.3 + 1.2; }
    if (y > arena.yMax) { y = arena.yMax; if (vy > 0) vy = -vy * 0.3; }
    this.pos = new V2(x, y); this.vel = new V2(vx, vy);
    this.stepRope(dt, wind, hold);
  }

  private stepRope(dt: number, wind: V2, taut: boolean) {
    const d = V2.distance(this.anchor, this.pos);
    const want = taut ? d * 1.005 : d * (1 + 0.1 * Mathf.clamp01(this.slackT / 0.8));
    this.rope.len = Math.max(d, Mathf.lerp(this.rope.len, want, 1 - Math.exp(-dt * 4)));
    this.rope.step(dt, this.anchor, this.pos, wind);
  }

  /** Snaps this kite's string at the crossing (segment i, fraction t). */
  cut(i: number, t: number, rng: SysRandom) {
    const [hand, kite] = this.rope.split(i, t);
    this.cutAt = this.rope.at(i, t);
    this.loose = hand; this.tail = kite;
    this.state = KState.Cut; this.cutT = 0;
    this.tumble = (rng.nextDouble() < 0.5 ? -1 : 1) * (260 + rng.nextDouble() * 260);
    this.hold = false;
  }

  private stepCut(dt: number, wind: V2, arena: Arena, time: number) {
    this.cutT += dt;
    this.ang += this.tumble * dt;
    this.tumble *= Math.exp(-dt * 0.4);
    const flutter = new V2(Math.sin(this.cutT * 3.1 + this.id) * 1.6, Math.cos(this.cutT * 4.3) * 0.6);
    const target = wind.mul(1.15).add(new V2(0, -1.1)).add(flutter);
    this.vel = V2.lerpUnclamped(this.vel, target, 1 - Math.exp(-dt * 1.6));
    this.pos = this.pos.add(this.vel.mul(dt));
    if (this.tail) this.tail.step(dt, null, this.pos, wind, 2.6);
    if (this.loose) {
      // the flyer reels the limp end back in
      this.loose.len = Math.max(0.3, this.loose.len - dt * (this.cutT > 0.8 ? 6 : 1));
      this.loose.step(dt, this.anchor, null, wind, 6);
      if (this.loose.len <= 0.31 && this.cutT > 2) this.loose = null;
    }
    const W = arena.xMax - arena.xMin;
    const far = this.pos.x < arena.xMin - W * 0.25 || this.pos.x > arena.xMax + W * 0.25 || this.pos.y < arena.yMin - 8 || this.pos.y > arena.yMax + 6;
    if (this.cutT > 7 || (far && this.cutT > 1.5)) { this.state = KState.Gone; this.loose = this.tail = null; }
    void time;
  }
}

export class Clash {
  meter = 0;          // > 0: a is winning (b's string frays); < 0: b is winning
  point = V2.zero;
  crossing = false;
  segA = 0; tA = 0; segB = 0; tB = 0;
  lostT = 0; t = 0; net = 0;
  constructor(readonly a: Kite, readonly b: Kite) {}
  /** Meter seen from kite k: +1 = k is about to cut. */
  edgeFor(k: Kite) { return k === this.a ? this.meter : -this.meter; }
  has(k: Kite) { return this.a === k || this.b === k; }
  other(k: Kite) { return this.a === k ? this.b : this.a; }
}

export function sawPower(k: Kite, p: V2) {
  if (!k.hold || k.state !== KState.Fly) return 0;
  // only motion away from the crossing saws (pulling towards it feeds your string to the other kite), and the string
  // moves faster at the crossing the closer it is to the kite: diving across a string near your kite cuts best
  const away = k.pos.sub(p).normalized;
  const reach = Mathf.clamp01(V2.distance(k.anchor, p) / Math.max(1, V2.distance(k.anchor, k.pos)));
  const m = Mathf.clamp(V2.dot(k.vel, away) / PullSpeed, -0.6, 1) * (0.35 + 0.65 * reach) * Tune.lever + Mathf.clamp(V2.dot(k.vel, away) / PullSpeed, -0.6, 1) * (1 - Tune.lever);
  return m > 0 ? (0.1 + 0.9 * m) * k.strength * (k.glassT > 0 ? 1.9 : 1) : m;
}

function segHit(p1: V2, p2: V2, q1: V2, q2: V2): [number, number] | null {
  const rx = p2.x - p1.x, ry = p2.y - p1.y, sx = q2.x - q1.x, sy = q2.y - q1.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qpx = q1.x - p1.x, qpy = q1.y - p1.y;
  const t = (qpx * sy - qpy * sx) / den, u = (qpx * ry - qpy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}

/** First crossing between two strings (ignoring the stretch next to each hand). */
export function ropesCross(a: Rope, b: Rope, minY: number): { p: V2; ia: number; ta: number; ib: number; tb: number } | null {
  const A = a.pts, B = b.pts;
  let best: { p: V2; ia: number; ta: number; ib: number; tb: number } | null = null;
  for (let i = 1; i < A.length - 1; i++) {
    const a1 = A[i], a2 = A[i + 1];
    const axMin = Math.min(a1.x, a2.x), axMax = Math.max(a1.x, a2.x), ayMin = Math.min(a1.y, a2.y), ayMax = Math.max(a1.y, a2.y);
    for (let j = 1; j < B.length - 1; j++) {
      const b1 = B[j], b2 = B[j + 1];
      if (Math.max(b1.x, b2.x) < axMin || Math.min(b1.x, b2.x) > axMax || Math.max(b1.y, b2.y) < ayMin || Math.min(b1.y, b2.y) > ayMax) continue;
      const h = segHit(a1, a2, b1, b2);
      if (!h) continue;
      const p = V2.lerpUnclamped(a1, a2, h[0]);
      if (p.y < minY) continue;
      if (!best || p.y > best.p.y) best = { p, ia: i, ta: h[0], ib: j, tb: h[1] };
    }
  }
  return best;
}

export enum PickKind { Glass, Swirl }
export class Pickup { kind = PickKind.Glass; pos = V2.zero; base = V2.zero; t = 0; life = 10; active = false; }
export class Bird { pos = V2.zero; vel = V2.zero; flap = 0; active = false; scared = 0; seed = 0; }

export type SkyEvent =
  | { type: "cut"; winner: Kite; loser: Kite; at: V2 }
  | { type: "bird"; kite: Kite; bird: Bird }
  | { type: "pickup"; kite: Kite; pickup: Pickup }
  | { type: "gust"; wind: V2 }
  | { type: "cross"; clash: Clash };

/** The shared sky: wind, kites, crossings, birds and pickups. */
export class Sky {
  arena: Arena = { xMin: -6, xMax: 6, yMin: -8, yMax: 12 };
  kites: Kite[] = [];
  clashes: Clash[] = [];
  birds: Bird[] = [];
  pickups: Pickup[] = [];
  wind = new V2(1, 0); windTarget = new V2(1, 0); windT = 8;
  rng: SysRandom;
  time = 0;
  /** Saw-rate multiplier (sudden death heat). */
  heat = 1;
  birdEvery = 0; birdT = 6;
  pickEvery = 0; pickT = 9;
  windEvery = 13;
  events: SkyEvent[] = [];
  canClash: (a: Kite, b: Kite) => boolean = () => true;

  constructor(seed: number) {
    this.rng = new SysRandom(seed);
    for (let i = 0; i < 8; i++) this.birds.push(new Bird());
    for (let i = 0; i < 3; i++) this.pickups.push(new Pickup());
    this.windTarget = this.wind = this.newWind();
    this.windT = this.windEvery * (0.6 + 0.6 * this.rng.nextDouble());
  }

  private newWind() {
    const right = this.rng.nextDouble() < 0.5 ? 1 : -1;
    const a = (right > 0 ? 0 : 180) + (this.rng.nextDouble() - 0.5) * 70;
    const s = 0.7 + this.rng.nextDouble() * 1.0;
    return V2.fromAngle(a * Mathf.Deg2Rad, s);
  }

  get windStrength() { return this.wind.magnitude; }

  step(dt: number) {
    if (dt <= 0) return;
    const n = Math.max(1, Math.ceil(dt / Step - 0.01));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h);
  }

  private substep(dt: number) {
    this.time += dt;
    // wind shifts now and then
    this.windT -= dt;
    if (this.windT <= 0) {
      this.windT = this.windEvery * (0.7 + 0.6 * this.rng.nextDouble());
      this.windTarget = this.newWind();
      this.events.push({ type: "gust", wind: this.windTarget });
    }
    this.wind = V2.lerpUnclamped(this.wind, this.windTarget, 1 - Math.exp(-dt * 0.9));
    for (const k of this.kites) k.step(dt, this.wind, this.arena, this.time);
    this.stepBirds(dt);
    this.stepPickups(dt);
    this.stepClashes(dt);
  }

  private stepClashes(dt: number) {
    const ks = this.kites;
    for (let i = 0; i < ks.length; i++)
      for (let j = i + 1; j < ks.length; j++) {
        const a = ks[i], b = ks[j];
        let c = this.clashes.find((x) => x.has(a) && x.has(b)) ?? null;
        if (!a.flying || !b.flying || !this.canClash(a, b)) { if (c) this.clashes.splice(this.clashes.indexOf(c), 1); continue; }
        const hit = ropesCross(a.rope, b.rope, this.arena.yMin - 1.2);
        if (!hit) {
          if (c) {
            c.crossing = false; c.net = 0;
            c.lostT += dt;
            c.meter = Mathf.moveTowards(c.meter, 0, dt * 0.9);
            if (c.lostT > 0.6) this.clashes.splice(this.clashes.indexOf(c), 1);
          }
          continue;
        }
        if (!c) { c = new Clash(a, b); this.clashes.push(c); this.events.push({ type: "cross", clash: c }); }
        if (c.a !== a) continue; // created with this order
        c.crossing = true; c.lostT = 0; c.t += dt;
        c.point = hit.p; c.segA = hit.ia; c.tA = hit.ta; c.segB = hit.ib; c.tB = hit.tb;
        const pa = sawPower(a, hit.p), pb = sawPower(b, hit.p);
        const va = a.hold ? 1 : Tune.slackGive, vb = b.hold ? 1 : Tune.slackGive; // a slack string gives way
        c.net = pa * vb - pb * va;
        if (pa === 0 && pb === 0) c.meter = Mathf.moveTowards(c.meter, 0, dt * 0.12);
        else c.meter += c.net * Tune.sawRate * this.heat * (1 + c.t / 8) * dt; // long crossings heat up
        if (c.meter >= 1) {
          if (b.safeT > 0) c.meter = 0.98;
          else { this.cutKite(b, a, c.segB, c.tB, hit.p); continue; }
        }
        if (c.meter <= -1) {
          if (a.safeT > 0) c.meter = -0.98;
          else { this.cutKite(a, b, c.segA, c.tA, hit.p); continue; }
        }
      }
  }

  cutKite(loser: Kite, winner: Kite, seg: number, t: number, at: V2) {
    loser.cut(seg, t, this.rng);
    this.clashes = this.clashes.filter((c) => !c.has(loser));
    this.events.push({ type: "cut", winner, loser, at });
  }

  private stepBirds(dt: number) {
    if (this.birdEvery > 0) {
      this.birdT -= dt;
      if (this.birdT <= 0) {
        this.birdT = this.birdEvery * (0.7 + 0.6 * this.rng.nextDouble());
        this.spawnFlock();
      }
    }
    const A = this.arena;
    for (const b of this.birds) {
      if (!b.active) continue;
      b.flap += dt * (b.scared > 0 ? 16 : 9);
      b.scared = Math.max(0, b.scared - dt);
      b.pos = b.pos.add(b.vel.mul(dt)).add(new V2(0, Math.sin(b.flap * 0.5 + b.seed) * 0.4 * dt));
      if (b.pos.x < A.xMin - 4 || b.pos.x > A.xMax + 4 || b.pos.y > A.yMax + 5) { b.active = false; continue; }
      if (b.scared > 0) continue;
      for (const k of this.kites) {
        if (!k.flying) continue;
        if (V2.distance(k.pos, b.pos) < KiteHit + 0.25) {
          k.wobbleT = 1.3; k.flash = 0.4;
          b.scared = 3; b.vel = new V2(b.vel.x * 1.6, 3.5);
          this.events.push({ type: "bird", kite: k, bird: b });
        }
      }
    }
  }

  spawnFlock() {
    const A = this.arena, fromLeft = this.rng.nextDouble() < 0.5;
    const y = Mathf.lerp(A.yMin + 2, A.yMax - 1, 0.15 + 0.75 * this.rng.nextDouble());
    const count = 2 + this.rng.next(3);
    const sp = (2.2 + this.rng.nextDouble() * 1.4) * (fromLeft ? 1 : -1);
    let made = 0;
    for (const b of this.birds) {
      if (b.active || made >= count) continue;
      const row = made;
      b.active = true; b.scared = 0; b.seed = this.rng.nextDouble() * 10; b.flap = this.rng.nextDouble() * 6;
      b.pos = new V2((fromLeft ? A.xMin - 2.5 : A.xMax + 2.5) - Math.sign(sp) * row * 0.8, y + (row % 2 === 0 ? 1 : -1) * row * 0.35);
      b.vel = new V2(sp, (this.rng.nextDouble() - 0.5) * 0.4);
      made++;
    }
  }

  private stepPickups(dt: number) {
    if (this.pickEvery > 0) {
      this.pickT -= dt;
      if (this.pickT <= 0) {
        this.pickT = this.pickEvery * (0.75 + 0.5 * this.rng.nextDouble());
        this.spawnPickup(this.rng.nextDouble() < 0.55 ? PickKind.Glass : PickKind.Swirl);
      }
    }
    for (const p of this.pickups) {
      if (!p.active) continue;
      p.t += dt;
      p.pos = p.base.add(new V2(Math.sin(p.t * 0.9) * 0.6, Math.sin(p.t * 1.7) * 0.35));
      if (p.t > p.life) { p.active = false; continue; }
      for (const k of this.kites) {
        if (!k.flying || V2.distance(k.pos, p.pos) > KiteHit + 0.45) continue;
        if (p.kind === PickKind.Glass) k.glassT = 10; else k.boostT = 6;
        k.flash = 0.5;
        p.active = false;
        this.events.push({ type: "pickup", kite: k, pickup: p });
        break;
      }
    }
  }

  spawnPickup(kind: PickKind) {
    const p = this.pickups.find((x) => !x.active);
    if (!p) return;
    const A = this.arena;
    p.kind = kind; p.t = 0; p.life = 11; p.active = true;
    p.base = new V2(Mathf.lerp(A.xMin + 1.5, A.xMax - 1.5, this.rng.nextDouble()), Mathf.lerp(A.yMin + 3, A.yMax - 1.5, 0.2 + 0.7 * this.rng.nextDouble()));
    p.pos = p.base;
  }

  clashFor(k: Kite) { return this.clashes.find((c) => c.has(k) && c.crossing) ?? null; }

  drainEvents() { const e = this.events; this.events = []; return e; }

  reset(seed: number) {
    this.rng = new SysRandom(seed);
    this.kites = []; this.clashes = []; this.events = [];
    for (const b of this.birds) b.active = false;
    for (const p of this.pickups) p.active = false;
    this.windTarget = this.wind = this.newWind();
    this.windT = this.windEvery * (0.6 + 0.6 * this.rng.nextDouble());
    this.birdT = this.birdEvery * 0.6; this.pickT = this.pickEvery * 0.6;
    this.time = 0; this.heat = 1;
  }
}
