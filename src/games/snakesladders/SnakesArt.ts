import { CasualArt, Color, Mathf, Mesh, Pal, Sprite, V2, V3 } from "../../kit";

/**
 * Procedural art for Snakes & Ladders Dash: five board themes, bevelled tiles, the board frame, glossy pawns, snake
 * heads (tinted) with eyes and tongue, card icons, and mesh builders for the snakes' banded bodies and the ladders.
 */

const clamp01 = Mathf.clamp01;
const fill = (d: number, px: number) => clamp01(0.5 - d / px);
const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const sdBox = (x: number, y: number, hw: number, hh: number, r: number) => {
  const qx = Math.abs(x) - hw + r, qy = Math.abs(y) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdSeg = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = clamp01((pax * bax + pay * bay) / Math.max(1e-9, bax * bax + bay * bay));
  return Math.hypot(pax - bax * h, pay - bay * h);
};
const hex = (v: number) => Pal.hex(v);

class Px {
  r = 0; g = 0; b = 0; a = 0;
  reset() { this.r = this.g = this.b = this.a = 0; return this; }
  over(c: Color, a = 1) {
    const sa = c.a * clamp01(a);
    if (sa <= 0) return this;
    const oa = sa + this.a * (1 - sa);
    this.r = (c.r * sa + this.r * this.a * (1 - sa)) / oa;
    this.g = (c.g * sa + this.g * this.a * (1 - sa)) / oa;
    this.b = (c.b * sa + this.b * this.a * (1 - sa)) / oa;
    this.a = oa;
    return this;
  }
  get color() { return new Color(this.r, this.g, this.b, this.a); }
}
const P = new Px();
const grey = (v: number, a = 1) => new Color(v, v, v, a);

export interface Theme {
  name: string; tileA: Color; tileB: Color; frame: Color; ink: Color; bgTop: Color; bgBottom: Color; glow: Color;
  ladder: Color; accent: Color; snakes: [Color, Color][]; stars: number; coins: number;
}

export const Themes: Theme[] = [
  { name: "MEADOW", tileA: hex(0xfff4cf), tileB: hex(0xc4e9a0), frame: hex(0xa06c3c), ink: hex(0x5a4026), bgTop: hex(0x9fe07a), bgBottom: hex(0x2c8a58), glow: new Color(1, 1, 0.85, 0.45), ladder: hex(0xd4924e), accent: hex(0x46b06a), snakes: [[hex(0x58bf46), hex(0xd8f25c)], [hex(0xff5a5a), hex(0xffb34a)], [hex(0x8d5cff), hex(0xff9ae0)], [hex(0x3f8cff), hex(0x8ef0ff)]], stars: 0, coins: 0 },
  { name: "JUNGLE", tileA: hex(0xe6f5b4), tileB: hex(0x8bd27a), frame: hex(0x6b4a2a), ink: hex(0x2f4a1e), bgTop: hex(0x4fb071), bgBottom: hex(0x0e4630), glow: new Color(0.8, 1, 0.6, 0.35), ladder: hex(0xb47c40), accent: hex(0x2fbf71), snakes: [[hex(0xff8a2e), hex(0x2a2a2a)], [hex(0x3fa34a), hex(0xf2e05a)], [hex(0xd94a8a), hex(0xffd0e6)], [hex(0x2e7dd1), hex(0xffe34a)]], stars: 2, coins: 300 },
  { name: "CANDY", tileA: hex(0xffe6f2), tileB: hex(0xcdeaff), frame: hex(0xff7eb9), ink: hex(0x8a3a6a), bgTop: hex(0xffa9d4), bgBottom: hex(0x8c6cff), glow: new Color(1, 1, 1, 0.4), ladder: hex(0xffc94a), accent: hex(0xff5fa8), snakes: [[hex(0xff5fa8), hex(0xffffff)], [hex(0x5cc8ff), hex(0xfff06a)], [hex(0x9a6cff), hex(0x9ff0c8)], [hex(0xff8a4a), hex(0xffe0f0)]], stars: 5, coins: 600 },
  { name: "DESERT", tileA: hex(0xfff0c8), tileB: hex(0xf5c98c), frame: hex(0xb06a2e), ink: hex(0x6b3d17), bgTop: hex(0xffc46b), bgBottom: hex(0xd0532e), glow: new Color(1, 0.95, 0.7, 0.45), ladder: hex(0x8e5a2b), accent: hex(0xff8c2e), snakes: [[hex(0xc9842e), hex(0x5a3a1a)], [hex(0x2fa58a), hex(0xf4e2a0)], [hex(0xd4473a), hex(0x2b2b2b)], [hex(0x7a5cc4), hex(0xffd36b)]], stars: 8, coins: 900 },
  { name: "STARRY NIGHT", tileA: hex(0x5257b3), tileB: hex(0x363a8c), frame: hex(0xa596ff), ink: hex(0xeceaff), bgTop: hex(0x3a2f8c), bgBottom: hex(0x0b0a26), glow: new Color(0.6, 0.6, 1, 0.35), ladder: hex(0xffd36b), accent: hex(0x9d8cff), snakes: [[hex(0x47e6a0), hex(0x1d6b5a)], [hex(0xff6ab0), hex(0xfff1a0)], [hex(0x5cc8ff), hex(0x24307a)], [hex(0xffa64a), hex(0xff4a6a)]], stars: 11, coins: 1200 },
];

export const PlayerColors = [hex(0xff4f5e), hex(0x3d8bff), hex(0x37c96b), hex(0xffbf26)];
export const PlayerNames = ["RED", "BLUE", "GREEN", "YELLOW"];

export const SnakesArt = {
  /** Bevelled tile (white, tint per square). */
  get Tile() {
    return CasualArt.make("sl-tile", 96, 96, (p) => {
      const px = 2 / 96, d = sdBox(p.x, p.y, 0.96, 0.96, 0.2);
      P.reset();
      P.over(grey(0.8), fill(d, px));
      const top = smooth(-0.6, 0.9, p.y - p.x * 0.3);
      P.over(grey(0.93 + 0.07 * top), fill(d + 0.1, px));
      P.over(grey(1, 0.5), fill(sdBox(p.x + 0.1, p.y - 0.62, 0.62, 0.12, 0.1), px) * 0.6);
      return P.color;
    });
  },

  /** Board frame (white, tinted per theme): rounded slab with an inner lip. */
  get Frame() {
    return CasualArt.make("sl-frame", 256, 256, (p) => {
      const px = 2 / 256, d = sdBox(p.x, p.y, 0.98, 0.98, 0.09);
      P.reset();
      P.over(grey(0.55), fill(d, px));
      P.over(grey(0.85 + 0.15 * smooth(-1, 1, p.y)), fill(d + 0.018, px));
      P.over(grey(0.62), fill(sdBox(p.x, p.y, 0.935, 0.935, 0.04), px));
      return P.color;
    });
  },

  /** Glossy pawn (grey shading, tinted per player). */
  get Pawn() {
    return CasualArt.make("sl-pawn", 96, 120, (p) => {
      const px = 2 / 96, x = p.x, y = p.y;
      P.reset();
      P.over(new Color(0, 0, 0, 0.3), smooth(1, 0.55, Math.hypot(x / 0.72, (y + 1.02) / 0.17)));
      const base = sdBox(x, y + 0.86, 0.62, 0.13, 0.12);
      const body = Math.max(sdSeg(x * 1.0, y, 0, -0.75, 0, 0.1) - (0.18 + 0.32 * smooth(0.1, -0.75, y)), -1);
      const head = Math.hypot(x, y - 0.42) - 0.36;
      const neck = sdBox(x, y - 0.06, 0.3, 0.06, 0.05);
      const d = Math.min(base, body, head, neck);
      P.over(grey(0.28), fill(d, px));
      const shade = 0.66 + 0.34 * smooth(0.5, -0.5, x) + 0.06 * smooth(-1, 1, y);
      P.over(grey(Math.min(1, shade)), fill(d + 0.06, px));
      P.over(grey(1, 0.85), fill(Math.hypot(x + 0.14, y - 0.55) - 0.11, px));
      P.over(grey(1, 0.45), fill(sdSeg(x, y, -0.2, -0.65, -0.12, -0.1) - 0.05, px));
      return P.color;
    });
  },

  /** Snake head pointing +x (grey, tinted with the snake's colour). */
  get Head() {
    return CasualArt.make("sl-head", 96, 96, (p) => {
      const px = 2 / 96, x = p.x, y = p.y;
      P.reset();
      const d = Math.hypot((x + 0.05) / 0.86, y / 0.62) - 1;
      const dd = d * 0.6;
      P.over(grey(0.3), fill(dd, px));
      P.over(grey(0.85 + 0.15 * smooth(-0.5, 0.6, y)), fill(dd + 0.06, px));
      for (const s of [1, -1]) P.over(grey(0.35), fill(Math.hypot(x - 0.62, y - 0.12 * s) - 0.04, px));
      P.over(grey(1, 0.4), fill(Math.hypot((x + 0.1) / 0.5, (y - 0.3) / 0.15) - 1, px * 3));
      return P.color;
    });
  },

  /** Eyes for the snake head (not tinted). */
  get Eyes() {
    return CasualArt.make("sl-eyes", 96, 96, (p) => {
      const px = 2 / 96, x = p.x, y = p.y;
      P.reset();
      for (const s of [1, -1]) {
        const ex = 0.15, ey = 0.36 * s;
        P.over(grey(0.2), fill(Math.hypot(x - ex, y - ey) - 0.27, px));
        P.over(Color.white, fill(Math.hypot(x - ex, y - ey) - 0.22, px));
        P.over(grey(0.08), fill(Math.hypot(x - ex - 0.07, y - ey * 0.9) - 0.12, px));
        P.over(Color.white, fill(Math.hypot(x - ex - 0.02, y - ey - 0.06) - 0.045, px));
      }
      return P.color;
    });
  },

  get Tongue() {
    return CasualArt.make("sl-tongue", 64, 32, (p) => {
      const px = 2 / 64, x = p.x, y = p.y;
      const d = Math.min(sdSeg(x, y, -0.9, 0, 0.3, 0), sdSeg(x, y, 0.3, 0, 0.85, 0.3), sdSeg(x, y, 0.3, 0, 0.85, -0.3)) - 0.09;
      return new Color(0.92, 0.18, 0.3, fill(d, px));
    });
  },

  /** Card icons: 0 shield, 1 double dice, 2 swap arrows (white). */
  Icon(card: number): Sprite {
    return CasualArt.make("sl-icon" + card, 80, 80, (p) => {
      const px = 2 / 80, x = p.x, y = p.y;
      let d = 1;
      if (card === 0) {
        const top = sdBox(x, y - 0.25, 0.72, 0.55, 0.15);
        const tip = Math.max(Math.abs(x) * 1.25 + (y + 0.05) * 0.95 - 0.0, -(y + 0.85)) - 0.72;
        d = Math.min(top, Math.max(tip, y - 0.3));
        d = Math.max(d, -(Math.max(sdBox(x, y - 0.1, 0.1, 0.42, 0.05), -1) < 0 ? 1 : -1) * 0);
      } else if (card === 1) {
        d = Math.min(sdBox(x + 0.28, y - 0.28, 0.42, 0.42, 0.12), sdBox(x - 0.3, y + 0.3, 0.42, 0.42, 0.12));
        const pips = Math.min(Math.hypot(x + 0.28, y - 0.28) - 0.1, Math.hypot(x - 0.3 - 0.18, y + 0.3 - 0.18) - 0.09, Math.hypot(x - 0.3 + 0.18, y + 0.3 + 0.18) - 0.09);
        d = Math.max(d, -pips);
      } else {
        const a1 = Math.min(sdSeg(x, y, -0.7, 0.3, 0.5, 0.3) - 0.11, Math.max(Math.abs(y - 0.3) * 1.1 + (x - 0.85) * 1.0, -(x - 0.35)) - 0.0);
        const a2 = Math.min(sdSeg(x, y, 0.7, -0.3, -0.5, -0.3) - 0.11, Math.max(Math.abs(y + 0.3) * 1.1 - (x + 0.85) * 1.0, (x + 0.35)) - 0.0);
        d = Math.min(a1, a2);
      }
      return new Color(1, 1, 1, fill(d, px));
    });
  },

  /** Star badge for Dash card squares. */
  get CardBadge() {
    return CasualArt.make("sl-badge", 64, 64, (p) => {
      const px = 2 / 64;
      P.reset();
      P.over(new Color(0.35, 0.18, 0.5, 1), fill(p.magnitude - 0.95, px));
      P.over(Color.lerp(hex(0x9b6cff), hex(0xd6b8ff), smooth(-0.8, 0.8, p.y)), fill(p.magnitude - 0.82, px));
      P.over(Color.white, fill(CasualArt.sdStar(p.add(new V2(0, 0.05)), 0.55, 0.45), px));
      return P.color;
    });
  },

  /** Themed backdrop (cover sprite): gradient, soft glow and a light pattern. */
  Back(theme: number): Sprite {
    const t = Themes[theme];
    return CasualArt.make("sl-back" + theme, 128, 230, (p) => {
      let c = Color.lerp(t.bgBottom, t.bgTop, smooth(-1.6, 1.6, p.y));
      const g = Math.exp(-(p.x * p.x * 0.9 + (p.y - 0.9) * (p.y - 0.9) * 0.6));
      c = Color.lerp(c, new Color(t.glow.r, t.glow.g, t.glow.b, 1), g * t.glow.a);
      const cx = Math.round(p.x * 4) / 4, cy = Math.round(p.y * 4) / 4;
      const h = Math.sin(cx * 91.7 + cy * 37.3) * 4375.85, r = h - Math.floor(h);
      const dot = Math.hypot(p.x - cx, p.y - cy) - (theme === 4 ? 0.012 : 0.05 + r * 0.03);
      c = Color.lerp(c, Color.white, fill(dot, 2 / 128) * (theme === 4 ? 0.8 * r : 0.08));
      return c.withAlpha(1);
    });
  },
};

// ------------------------------------------------------------------ meshes

class MeshBuilder {
  v: V3[] = []; c: Color[] = []; t: number[] = [];
  quad(a: V2, b: V2, w: number, col: Color, col2 = col) {
    const d = b.sub(a), len = d.magnitude;
    if (len < 1e-4) return;
    const n = new V2(-d.y / len, d.x / len).mul(w / 2);
    const i = this.v.length;
    this.v.push(a.add(n).toV3(), a.sub(n).toV3(), b.add(n).toV3(), b.sub(n).toV3());
    this.c.push(col, col2, col, col2);
    this.t.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }
  disc(p: V2, r: number, col: Color, n = 10) {
    const i = this.v.length;
    this.v.push(p.toV3());
    this.c.push(col);
    for (let k = 0; k < n; k++) { this.v.push(p.add(V2.fromAngle((k / n) * Math.PI * 2, r)).toV3()); this.c.push(col); }
    for (let k = 0; k < n; k++) this.t.push(i, i + 1 + k, i + 1 + ((k + 1) % n));
  }
  mesh() { const m = new Mesh(); m.vertices = this.v; m.colors = this.c; m.triangles = this.t; return m; }
}

/** Points along a snake from head to tail (wavy, endpoints exact). */
export function snakePath(head: V2, tail: V2, seed: number, n = 64): V2[] {
  const d = tail.sub(head), len = d.magnitude, dir = d.div(Math.max(1e-4, len)), nrm = new V2(-dir.y, dir.x);
  const waves = Math.max(1.5, Math.min(3.5, len / 2.2)) + (seed % 3) * 0.25, amp = 0.28 + (seed % 5) * 0.05;
  const phase = (seed % 2) * Math.PI;
  const pts: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, env = Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.7);
    pts.push(head.add(d.mul(s)).add(nrm.mul(Math.sin(s * Math.PI * waves + phase) * amp * env)));
  }
  return pts;
}

/** Snake body: soft shadow, dark outline, banded body with a light belly stripe. */
export function snakeMesh(pts: V2[], a: Color, b: Color, seed: number): Mesh {
  const mb = new MeshBuilder();
  const n = pts.length - 1;
  const width = (s: number) => (0.27 - 0.21 * Math.pow(s, 1.2)) * (s < 0.08 ? 0.85 + s * 2 : 1);
  const layers: [number, Color, V2][] = [[0.07, new Color(0, 0, 0, 0.22), new V2(0.09, -0.13)], [0.07, new Color(0.12, 0.1, 0.12, 1), V2.zero]];
  for (const [extra, col, off] of layers)
    for (let i = 0; i < n; i++) {
      const s = i / n;
      mb.quad(pts[i].add(off), pts[i + 1].add(off), width(s) + extra, col);
      mb.disc(pts[i + 1].add(off), (width(s) + extra) / 2, col, 8);
    }
  const bands = 9 + (seed % 4);
  for (let i = 0; i < n; i++) {
    const s = i / n, w = width(s);
    const band = Math.floor(s * bands * 2) % 2 === 0 ? a : b;
    const edge = Color.lerp(band, Color.black, 0.18), belly = Color.lerp(band, Color.white, 0.28);
    const p0 = pts[i], p1 = pts[i + 1];
    mb.quad(p0, p1, w, edge);
    mb.disc(p1, w / 2, edge, 8);
    mb.quad(p0, p1, w * 0.55, band);
    mb.quad(p0, p1, w * 0.18, belly);
  }
  return mb.mesh();
}

/** Ladder: shadow, outlined wooden rails and rungs with a highlight. */
export function ladderMesh(a: V2, b: V2, wood: Color): Mesh {
  const mb = new MeshBuilder();
  const d = b.sub(a), len = d.magnitude, dir = d.div(len), nrm = new V2(-dir.y, dir.x);
  const half = 0.24, railW = 0.1, rungW = 0.075;
  const a0 = a.sub(dir.mul(0.15)), b0 = b.add(dir.mul(0.15));
  const dark = Color.lerp(wood, Color.black, 0.55), hi = Color.lerp(wood, Color.white, 0.35);
  const rungs: number[] = [];
  for (let s = 0.32; s < len + 0.1; s += 0.34) rungs.push(s);
  for (const [w, col, off] of [[0.07, new Color(0, 0, 0, 0.22), new V2(0.1, -0.14)], [0.06, dark, V2.zero], [0, wood, V2.zero]] as [number, Color, V2][]) {
    for (const s of rungs) {
      const c = a0.add(dir.mul(s)).add(off);
      mb.quad(c.add(nrm.mul(half)), c.sub(nrm.mul(half)), rungW + w, col);
    }
    for (const side of [1, -1]) mb.quad(a0.add(nrm.mul(half * side)).add(off), b0.add(nrm.mul(half * side)).add(off), railW + w, col);
  }
  for (const side of [1, -1]) mb.quad(a0.add(nrm.mul(half * side + 0.02)), b0.add(nrm.mul(half * side + 0.02)), railW * 0.3, hi);
  return mb.mesh();
}
