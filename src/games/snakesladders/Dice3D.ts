import { Art, Color, Ease, Mathf, Mesh, GameObject, V3 } from "../../kit";

/**
 * A real 3-D die drawn as one mesh: a rounded ivory cube (dark edges, bevelled face plates, Lambert shading) with
 * pips, rotated by a 3 × 3 matrix and projected orthographically. A roll tumbles it through several turns on two
 * axes and eases out exactly onto the face that was rolled, shown in a three-quarter view.
 */

type M3 = number[];
const mul = (a: M3, b: M3): M3 => {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};
const rx = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const ry = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rz = (a: number): M3 => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const ap = (m: M3, x: number, y: number, z: number): [number, number, number] => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
const D = Mathf.Deg2Rad;

/** Faces: normal, two in-plane axes and the value on it (opposite faces sum to 7). */
const Faces: { n: [number, number, number]; u: [number, number, number]; v: [number, number, number]; val: number }[] = [
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], val: 1 },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], val: 6 },
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], val: 3 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], val: 4 },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], val: 2 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], val: 5 },
];
const Pips: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, 1], [1, -1]],
  3: [[-1, 1], [0, 0], [1, -1]],
  4: [[-1, 1], [1, 1], [-1, -1], [1, -1]],
  5: [[-1, 1], [1, 1], [0, 0], [-1, -1], [1, -1]],
  6: [[-1, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]],
};
/** Rotation that brings each value's face to the front (+z). */
const FaceToFront: Record<number, M3> = { 1: rx(0), 6: ry(Math.PI), 3: ry(-Math.PI / 2), 4: ry(Math.PI / 2), 2: rx(Math.PI / 2), 5: rx(-Math.PI / 2) };
const Tilt = mul(rx(-24 * D), ry(28 * D));

export class Dice3D {
  readonly root: GameObject;
  private readonly mesh = new Mesh();
  private rot: M3 = mul(Tilt, FaceToFront[1]);
  value = 1;
  rolling = false;
  private t = 0;
  private dur = 0.9;
  private spinA = 0; private spinB = 0; private spinC = 0;
  /** Body / edge / pip colours. */
  body = Color.white;
  edge = new Color(0.62, 0.6, 0.66, 1);
  pip = new Color(0.12, 0.13, 0.2, 1);
  one = new Color(0.86, 0.15, 0.2, 1);

  constructor(parent: GameObject, order: number, readonly size = 1) {
    this.root = new GameObject("Dice3D", parent);
    Art.meshObject(this.root, "Die", this.mesh, Art.Flat, order);
    this.build();
  }

  /** Starts a tumble that lands on `value`. */
  roll(value: number, duration = 0.9) {
    this.value = value;
    this.rolling = true;
    this.t = 0;
    this.dur = duration;
    this.spinA = (2 + Math.floor(Math.random() * 2)) * Math.PI * 2 * (Math.random() < 0.5 ? -1 : 1);
    this.spinB = (1 + Math.floor(Math.random() * 2)) * Math.PI * 2 * (Math.random() < 0.5 ? -1 : 1);
    this.spinC = (Math.random() - 0.5) * Math.PI * 2;
  }

  /** Shows a face at rest (no animation). */
  show(value: number) { this.value = value; this.rolling = false; this.rot = mul(Tilt, FaceToFront[value]); this.build(); }

  /** Advances the tumble; returns 0..1 progress (1 = landed). */
  update(dt: number, idleWobble = 0) {
    if (this.rolling) {
      this.t += dt;
      const k = Mathf.clamp01(this.t / this.dur), e = 1 - Ease.outCubic(k);
      this.rot = mul(Tilt, mul(rz(this.spinC * e), mul(rx(this.spinA * e), mul(ry(this.spinB * e), FaceToFront[this.value]))));
      if (k >= 1) this.rolling = false;
      this.build();
      return k;
    }
    if (idleWobble > 0) {
      const w = idleWobble;
      this.rot = mul(Tilt, mul(rz(Math.sin(performance.now() * 0.004) * 0.08 * w), mul(ry(Math.sin(performance.now() * 0.003) * 0.12 * w), FaceToFront[this.value])));
      this.build();
    }
    return 1;
  }

  private build() {
    const m = this.mesh, s = this.size * 0.5;
    const verts: V3[] = [], cols: Color[] = [], tris: number[] = [];
    const light = [-0.35, 0.55, 0.76];
    const poly = (pts: [number, number, number][], c: Color) => {
      const b = verts.length;
      for (const p of pts) { verts.push(new V3(p[0], p[1], 0)); cols.push(c); }
      for (let i = 1; i + 1 < pts.length; i++) tris.push(b, b + i, b + i + 1);
    };
    const faces = Faces.map((f) => ({ f, n: ap(this.rot, ...f.n) })).filter((x) => x.n[2] > 0.02).sort((a, b) => a.n[2] - b.n[2]);
    // dark silhouette (edges) first, then each face's rounded plate and pips
    for (const { f } of faces) {
      const pts: [number, number, number][] = [];
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p: [number, number, number] = [f.n[0] * s + (f.u[0] * a + f.v[0] * b) * s, f.n[1] * s + (f.u[1] * a + f.v[1] * b) * s, f.n[2] * s + (f.u[2] * a + f.v[2] * b) * s];
        pts.push(ap(this.rot, ...p));
      }
      poly(pts, this.edge);
    }
    for (const { f, n } of faces) {
      const lam = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
      const shade = 0.62 + 0.42 * lam;
      const c = new Color(this.body.r * shade, this.body.g * shade, this.body.b * shade, 1);
      const plate: [number, number, number][] = [];
      const inner = 0.86, rr = 0.22;
      for (let i = 0; i < 20; i++) {
        const q = Math.floor(i / 5), a = (q * 90 + (i % 5) * 22.5) * D;
        const cx = (q === 0 || q === 3 ? 1 : -1) * (inner - rr), cy = (q < 2 ? 1 : -1) * (inner - rr);
        const lx = cx + Math.cos(a) * rr, ly = cy + Math.sin(a) * rr;
        plate.push(ap(this.rot, f.n[0] * s + (f.u[0] * lx + f.v[0] * ly) * s, f.n[1] * s + (f.u[1] * lx + f.v[1] * ly) * s, f.n[2] * s + (f.u[2] * lx + f.v[2] * ly) * s));
      }
      poly(plate, c);
      const pipC = f.val === 1 ? this.one : this.pip;
      const pr = f.val === 1 ? 0.24 : 0.17;
      for (const [px, py] of Pips[f.val]) {
        const pts: [number, number, number][] = [];
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2, lx = px * 0.5 + Math.cos(a) * pr, ly = py * 0.5 + Math.sin(a) * pr;
          pts.push(ap(this.rot, f.n[0] * s + (f.u[0] * lx + f.v[0] * ly) * s, f.n[1] * s + (f.u[1] * lx + f.v[1] * ly) * s, f.n[2] * s + (f.u[2] * lx + f.v[2] * ly) * s));
        }
        poly(pts, new Color(pipC.r * (0.7 + 0.3 * shade), pipC.g * (0.7 + 0.3 * shade), pipC.b * (0.7 + 0.3 * shade), 1));
      }
    }
    m.vertices = verts;
    m.colors = cols;
    m.triangles = tris;
    m.markDirty();
  }
}
