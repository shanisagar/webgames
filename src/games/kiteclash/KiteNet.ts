import { Mathf, V2 } from "../../kit/math";
import { Arena, Kite, KState, Rope } from "./KitePhysics";

/**
 * KITE CLASH online (private tables): message formats and helpers for the real-time duel.
 *
 * The host runs the only match simulation in a fixed CANONICAL sky (same size on every device) and streams compact
 * state ~15 times a second. The guest sends its hold state and its locally predicted kite ~25 times a second; the
 * host accepts the predicted kite within a tolerance (so steering feels instant on the guest) and decides
 * everything else: wind, birds, pickups, crossings, saws, cuts, crashes, rounds and the match. Each device maps the
 * canonical sky onto its own screen; the guest's view is mirrored so it flies from the left rooftop.
 *
 * Messages (on the OnlineRoom next to OnlineLink's start/state/react/rematch/leave; field `t`):
 *   ks  host → guest  state: { m, T, st, sT, rT, w, r, wd, k:[k0,k1], b, p, c, d, ev, pz }
 *   kg  guest → host  input: { m, s, h, x, y, vx, vy, a, sp } (hold + predicted kite, canonical units)
 *   kp  both          pause: { p } (a pause on either device freezes the match for both)
 */

export const Canon: Arena = { xMin: -9, xMax: 9, yMin: -6, yMax: 8 };
export const CanonAnchor = (seat: number) => new V2((seat === 0 ? -1 : 1) * 5.4, Canon.yMin - 1.3);
export const CanonLaunch = (seat: number) => new V2((seat === 0 ? -1 : 1) * 4.0, Canon.yMin + 4.6);

export const StateHz = 15, InputHz = 25;

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
const flat = (pts: V2[] | undefined, r = r2) => { if (!pts) return 0; const o: number[] = []; for (const p of pts) o.push(r(p.x), r(p.y)); return o; };
export const unflat = (a: number[] | 0 | undefined) => { const o: V2[] = []; if (!a) return o; for (let i = 0; i + 1 < a.length; i += 2) o.push(new V2(a[i], a[i + 1])); return o; };

/** A kite on the wire. */
export interface KSnap {
  x: number; y: number; a: number; vx: number; vy: number; st: number; h: number;
  gt: number; bt: number; sf: number; fl: number; lt: number; ct: number;
  r: number[]; lo: number[] | 0; ta: number[] | 0;
}

export function snapKite(k: Kite): KSnap {
  return {
    x: r2(k.pos.x), y: r2(k.pos.y), a: r1(k.ang), vx: r1(k.vel.x), vy: r1(k.vel.y), st: k.state, h: k.hold ? 1 : 0,
    gt: r1(k.glassT), bt: r1(k.boostT), sf: k.safeT > 0 ? 1 : 0, fl: r1(k.flash), lt: r1(k.lowT), ct: r1(k.cutT),
    r: k.tethered ? flat(k.rope.pts) as number[] : [], lo: k.state === KState.Cut ? flat(k.loose?.pts, r1) : 0, ta: k.state === KState.Cut ? flat(k.tail?.pts, r1) : 0,
  };
}

/** Linear blend of two kite snapshots (angles the short way round). */
export function lerpSnap(a: KSnap, b: KSnap, t: number): KSnap {
  if (a.st !== b.st || a.r.length !== b.r.length) return t < 0.5 ? a : b;
  const L = (x: number, y: number) => x + (y - x) * t;
  const la = (x: number[] | 0, y: number[] | 0) => (x && y && x.length === y.length ? x.map((v, i) => L(v, y[i])) : y);
  return {
    ...b, x: L(a.x, b.x), y: L(a.y, b.y), a: a.a + Mathf.deltaAngle(a.a, b.a) * t, vx: L(a.vx, b.vx), vy: L(a.vy, b.vy),
    r: a.r.map((v, i) => L(v, b.r[i])), lo: la(a.lo, b.lo), ta: la(a.ta, b.ta),
  };
}

/** Writes a wire kite into a (canonical) Kite, e.g. the guest's own predicted kite after a launch or a cut. */
export function applySnap(k: Kite, s: KSnap) {
  k.pos = new V2(s.x, s.y); k.vel = new V2(s.vx, s.vy); k.ang = s.a; k.state = s.st as KState;
  k.glassT = s.gt; k.boostT = s.bt; k.safeT = s.sf ? 0.5 : 0; k.flash = s.fl; k.lowT = s.lt; k.cutT = s.ct;
  const pts = unflat(s.r);
  if (pts.length >= 2) { k.rope.pts = pts; k.rope.prev = pts.slice(); let L = 0; for (let i = 0; i < pts.length - 1; i++) L += V2.distance(pts[i], pts[i + 1]); k.rope.len = Math.max(0.1, L); }
  if (s.lo) { const r = new Rope(V2.zero, V2.up, 2); r.pts = unflat(s.lo); r.prev = r.pts.slice(); k.loose = r; } else k.loose = null;
  if (s.ta) { const r = new Rope(V2.zero, V2.up, 2); r.pts = unflat(s.ta); r.prev = r.pts.slice(); k.tail = r; } else k.tail = null;
}

export interface NetEvent { i: number; e: "cut" | "crash" | "bird" | "pick" | "gust" | "round" | "end"; k?: number; w?: number; x?: number; y?: number; g?: number; sc?: number[]; tu?: number }

export interface StateMsg {
  t: "ks"; m: number; T: number; st: number; sT: number; rT: number; w: number[]; r: number;
  wd: number[]; k: KSnap[]; b: number[][]; p: number[][]; c: number[][]; d: number[]; ev: NetEvent[]; pz: number;
}
export interface InputMsg { t: "kg"; m: number; s: number; h: number; x: number; y: number; vx: number; vy: number; a: number; sp: number }
export interface PauseMsg { t: "kp"; p: number }

/** Canonical → device mapping (the guest's view is mirrored left-right). */
export class ViewMap {
  sx = 1; sy = 1; mx = 1;
  constructor(private dev: Arena = Canon) { this.set(dev, false); }
  set(dev: Arena, mirror: boolean) {
    this.dev = dev; this.mx = mirror ? -1 : 1;
    this.sx = (dev.xMax - dev.xMin) / (Canon.xMax - Canon.xMin);
    this.sy = (dev.yMax - dev.yMin) / (Canon.yMax - Canon.yMin);
  }
  p(c: V2) { return new V2(this.dev.xMin + (this.mx * c.x - Canon.xMin) * this.sx, this.dev.yMin + (c.y - Canon.yMin) * this.sy); }
  xy(x: number, y: number) { return this.p(new V2(x, y)); }
  v(c: V2) { return new V2(this.mx * c.x * this.sx, c.y * this.sy); }
  ang(a: number) { const r = a * Mathf.Deg2Rad; return Math.atan2(Math.sin(r) * this.sy, Math.cos(r) * this.sx * this.mx) * Mathf.Rad2Deg; }
  pts(a: V2[]) { return a.map((q) => this.p(q)); }
}
