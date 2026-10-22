import { CasualArt, Color, Mathf, Pal, Sprite } from "../../kit";

/**
 * Procedural art for Hole Hungry: a bright toy-town seen from a slightly tilted top-down camera. Every city object is
 * baked once as one sprite that already contains its soft drop shadow and an oblique "front face" (height is drawn
 * upward on screen), so the whole city costs one sprite per object. Also the ground tiles (blocks, roads), the hole
 * (interior, skinned rims) and a few UI icons.
 */

// ------------------------------------------------------------------ painting helpers (numeric, no V2s)

/** Screen-up offset per unit of height (oblique projection). */
export const K = 0.6;
/** Shadow offset per unit of height (light from the upper left). */
const SX = 0.42, SY = -0.28, ShadowCap = 5;
const ShadowCol = new Color(0.06, 0.08, 0.18, 1);

const clamp01 = Mathf.clamp01;
const fill = (d: number, px: number) => clamp01(0.5 - d / px);
const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const sdBox = (x: number, y: number, hw: number, hh: number, r: number) => {
  const qx = Math.abs(x) - hw + r, qy = Math.abs(y) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdCirc = (x: number, y: number, r: number) => Math.hypot(x, y) - r;
const sdEll = (x: number, y: number, a: number, b: number) => (Math.hypot(x / a, y / b) - 1) * Math.min(a, b);
const sdSeg = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = clamp01((pax * bax + pay * bay) / Math.max(1e-9, bax * bax + bay * bay));
  return Math.hypot(pax - bax * h, pay - bay * h);
};
const hex = (v: number) => Pal.hex(v);
const mix = (a: Color, b: Color, t: number) => Color.lerp(a, b, clamp01(t));
const lighten = (c: Color, t: number) => CasualArt.lighten(c, t);
const darken = (c: Color, t: number) => CasualArt.darken(c, t);
/** Cheap deterministic hash noise in 0..1. */
const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const noise = (x: number, y: number) => Mathf.perlinNoise(x, y);

/** Accumulating "over" compositor (one per bake, reused for every texel). */
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

/** Sprite plus where its centre sits relative to the object's footprint centre (world units). */
export interface Pic { sprite: Sprite; ox: number; oy: number }

type Paint = (x: number, y: number, px: number) => Color;

function pic(key: string, x0: number, y0: number, x1: number, y1: number, ppu: number, paint: Paint): Pic {
  const W = x1 - x0, H = y1 - y0;
  const w = Math.max(8, Math.round(W * ppu)), h = Math.max(8, Math.round(H * ppu));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, half = W / 2, px = W / w;
  const sprite = CasualArt.make("hh-" + key, w, h, (p) => paint(cx + p.x * half, cy + p.y * half, px), 0, w / W);
  return { sprite, ox: cx, oy: cy };
}

/** Bounds (x0, y0, x1, y1) of an object with visual half extents hw/hh and height h. */
function bounds(hw: number, hh: number, h: number, pad = 0.08): [number, number, number, number] {
  const hs = Math.min(h, ShadowCap);
  return [-hw - pad, -hh + SY * hs - pad, hw + SX * hs + pad, hh + h * K + pad];
}

/** Soft swept-box shadow alpha. */
function shadowBox(x: number, y: number, hw: number, hh: number, r: number, h: number, px: number, strength = 0.32) {
  const hs = Math.min(h, ShadowCap), dx = SX * hs, dy = SY * hs;
  const n = Math.min(28, Math.max(4, Math.ceil((Math.hypot(dx, dy) / Math.max(0.04, Math.min(hw, hh))) * 1.6)));
  let d = 1e9;
  for (let i = 0; i <= n; i++) { const t = i / n; d = Math.min(d, sdBox(x - dx * t, y - dy * t, hw, hh, r)); }
  return fill(d, px * 3) * strength;
}
function shadowRound(x: number, y: number, r: number, h: number, px: number, strength = 0.32) {
  const hs = Math.min(h, ShadowCap);
  return fill(sdSeg(x, y, 0, 0, SX * hs, SY * hs) - r, px * 3) * strength;
}

/** An extruded rounded box: returns 0 outside, 1 on the top face, 2 on the front face; d = silhouette distance. */
let faceD = 0, faceT = 0;
function extrude(x: number, y: number, hw: number, hh: number, r: number, h: number) {
  const top = sdBox(x, y - h * K, hw, hh, r);
  const sil = Math.min(top, sdBox(x, y - h * K * 0.5, hw, hh + h * K * 0.5, Math.min(r, hw * 0.9)));
  faceD = sil;
  if (top <= 0) { faceT = top; return 1; }
  // front face: vertical position 0 (ground) .. 1 (roof edge)
  faceT = clamp01((y + hh) / Math.max(1e-6, h * K));
  return sil <= 0 ? 2 : 0;
}

// ------------------------------------------------------------------ palette

export const Ink = hex(0x1d2033);
const Skin = [hex(0xf2c7a5), hex(0xd99f78), hex(0x9c6a4a), hex(0xffd9bd)];
const Shirts = [hex(0xff5c6c), hex(0x3f8cff), hex(0xffc93c), hex(0x4cc85c), hex(0xa56bff), hex(0xff8a30), hex(0x2fc9c2), hex(0xf06bd0)];
const CarCols = [hex(0xff4d5e), hex(0x3f8cff), hex(0xffc93c), hex(0xf4f4f6), hex(0x4cc85c), hex(0x2f3347), hex(0xff8a30), hex(0x9a6bff)];
const Leaf = [hex(0x5cc45a), hex(0x3fae5a), hex(0xffa53d), hex(0xff9cc8)];

// ------------------------------------------------------------------ city objects

export enum Kind {
  Person, Cone, Hydrant, Trash, Mailbox, Bush, Bench, Lamp, Tree, Pine, Car, Kiosk, Fountain, Bus, House, Shop, Tower,
}

export interface KindDef {
  kind: Kind;
  /** Diameter a hole needs to swallow it. */
  size: number;
  /** Points. */
  value: number;
  /** Collision footprint half extents (horizontal variant). */
  hw: number; hh: number;
  /** Visual variants (horizontal), and vertical variants for vehicles. */
  pics: Pic[]; picsV: Pic[];
  /** Particle colour when it is swallowed. */
  color: Color;
}

function person(shirt: Color, skin: Color, hair: Color): Paint {
  return (x, y, px) => {
    P.reset();
    P.over(ShadowCol, fill(sdEll(x - 0.12, y + 0.03, 0.2, 0.09), px * 2) * 0.3);
    // legs
    P.over(Ink, fill(sdBox(x, y + 0.02, 0.09, 0.06, 0.04), px));
    // torso
    const t = sdBox(x, y - 0.17, 0.12, 0.13, 0.08);
    P.over(darken(shirt, 0.35), fill(t, px));
    P.over(mix(shirt, lighten(shirt, 0.3), smooth(0.05, 0.3, y)), fill(t + px, px));
    // head
    const hd = sdCirc(x, y - 0.38, 0.11);
    P.over(darken(skin, 0.3), fill(hd, px));
    P.over(skin, fill(hd + px, px));
    P.over(hair, fill(Math.max(hd + px, -(y - 0.4 - x * 0.2)), px));
    P.over(Color.white, fill(sdCirc(x + 0.04, y - 0.43, 0.025), px) * 0.6);
    return P.color;
  };
}

function cone(x: number, y: number, px: number) {
  P.reset();
  P.over(ShadowCol, shadowRound(x, y, 0.13, 0.3, px));
  const orange = hex(0xff7a2a);
  P.over(darken(orange, 0.25), fill(sdBox(x, y, 0.15, 0.06, 0.03), px));
  // tapered body from y=0.02 to tip y=0.3
  const yy = (y - 0.02) / 0.3, half = Mathf.lerp(0.12, 0.025, yy);
  const body = Math.max(Math.abs(x) - half, Math.max(-(y - 0.02), y - 0.32));
  const shade = x < 0 ? lighten(orange, 0.15) : darken(orange, 0.08);
  P.over(shade, fill(body, px));
  P.over(Color.white, fill(Math.max(body, Math.abs(yy - 0.45) - 0.12), px));
  return P.color;
}

function hydrant(x: number, y: number, px: number) {
  P.reset();
  P.over(ShadowCol, shadowRound(x, y, 0.13, 0.35, px));
  const red = hex(0xe8323f);
  const body = sdBox(x, y - 0.12, 0.1, 0.12, 0.04);
  P.over(darken(red, 0.35), fill(Math.min(body, sdBox(x, y - 0.14, 0.16, 0.035, 0.03)), px));
  P.over(x < -0.02 ? lighten(red, 0.2) : red, fill(Math.min(body, sdBox(x, y - 0.14, 0.16, 0.035, 0.03)) + px, px));
  const top = sdEll(x, y - 0.25, 0.11, 0.07);
  P.over(darken(red, 0.2), fill(top, px));
  P.over(lighten(red, 0.35), fill(top + px * 1.5, px));
  P.over(hex(0xffd84a), fill(sdCirc(x, y - 0.29, 0.03), px));
  return P.color;
}

function trash(x: number, y: number, px: number) {
  P.reset();
  P.over(ShadowCol, shadowRound(x, y, 0.18, 0.45, px));
  const g = hex(0x3b9a6c);
  const body = sdBox(x, y - 0.13, 0.17, 0.14, 0.05);
  P.over(darken(g, 0.4), fill(body, px));
  const stripe = Math.abs(((x + 0.2) * 14) % 2 - 1) > 0.7 ? 0.08 : 0;
  P.over(darken(mix(g, lighten(g, 0.25), smooth(0.15, -0.15, x)), stripe), fill(body + px, px));
  const lid = sdEll(x, y - 0.27, 0.19, 0.09);
  P.over(darken(g, 0.45), fill(lid, px));
  P.over(lighten(g, 0.1), fill(lid + px, px));
  P.over(Ink, fill(sdEll(x, y - 0.27, 0.08, 0.035), px) * 0.6);
  return P.color;
}

function mailbox(x: number, y: number, px: number) {
  P.reset();
  P.over(ShadowCol, shadowRound(x, y, 0.15, 0.5, px));
  const b = hex(0x3a6dde);
  P.over(Ink, fill(sdBox(x, y - 0.06, 0.03, 0.08, 0.01), px));
  const body = sdBox(x, y - 0.24, 0.16, 0.12, 0.07);
  P.over(darken(b, 0.4), fill(body, px));
  P.over(mix(lighten(b, 0.25), b, smooth(-0.1, 0.1, x)), fill(body + px, px));
  P.over(Color.white, fill(sdBox(x, y - 0.27, 0.08, 0.015, 0.01), px) * 0.9);
  return P.color;
}

function bush(c: Color, flowers: boolean): Paint {
  return (x, y, px) => {
    P.reset();
    P.over(ShadowCol, fill(sdEll(x - 0.16, y + 0.02, 0.48, 0.3), px * 3) * 0.32);
    // three overlapping balls
    const balls: [number, number, number][] = [[-0.18, 0.2, 0.28], [0.18, 0.2, 0.28], [0, 0.32, 0.3]];
    for (const [bx, by, br] of balls) {
      const d = sdCirc(x - bx, y - by, br);
      if (d > px) continue;
      const qx = (x - bx) / br, qy = (y - by) / br;
      const lit = clamp01(0.55 + 0.45 * (-qx * 0.6 + qy * 0.8));
      let col = mix(darken(c, 0.35), lighten(c, 0.2), lit);
      col = mix(col, darken(c, 0.25), noise(x * 9, y * 9) * 0.35);
      P.over(darken(c, 0.45), fill(d, px));
      P.over(col, fill(d + px, px));
    }
    if (flowers) for (let i = 0; i < 6; i++) {
      const fx = Math.cos(i * 2.4) * 0.22, fy = 0.26 + Math.sin(i * 2.4) * 0.14;
      P.over(i % 2 ? hex(0xff6fa8) : hex(0xfff1a8), fill(sdCirc(x - fx, y - fy, 0.045), px));
    }
    return P.color;
  };
}

function bench(x: number, y: number, px: number) {
  P.reset();
  const hw = 0.55, hh = 0.17, h = 0.35;
  P.over(ShadowCol, shadowBox(x, y, hw, hh, 0.04, h, px, 0.28));
  const wood = hex(0xc0804a), metal = hex(0x3c4152);
  // legs
  for (const lx of [-0.45, 0.45]) P.over(metal, fill(sdBox(x - lx, y - 0.08, 0.04, 0.1, 0.01), px));
  // seat (top face) and backrest at the back
  const seat = sdBox(x, y - h * K + 0.02, hw, hh * 0.7, 0.03);
  P.over(darken(wood, 0.4), fill(seat, px));
  const slat = Math.abs(((y - h * K) * 18) % 2) < 1.6 ? 0 : 0.18;
  P.over(darken(mix(lighten(wood, 0.15), wood, smooth(-0.4, 0.4, x)), slat), fill(seat + px, px));
  const back = sdBox(x, y - h * K - 0.2, hw, 0.07, 0.03);
  P.over(darken(wood, 0.45), fill(back, px));
  P.over(lighten(wood, 0.1), fill(back + px, px));
  return P.color;
}

function lamp(x: number, y: number, px: number) {
  P.reset();
  const h = 2.2;
  P.over(ShadowCol, shadowBox(x, y, 0.06, 0.06, 0.03, h, px, 0.26));
  P.over(ShadowCol, fill(sdCirc(x - SX * 2.2, y - SY * 2.2, 0.18), px * 3) * 0.2);
  const pole = hex(0x3a4052);
  P.over(darken(pole, 0.3), fill(sdBox(x, y, 0.09, 0.05, 0.03), px));
  const p = sdBox(x, y - h * K * 0.5, 0.045, h * K * 0.5, 0.02);
  P.over(pole, fill(p, px));
  P.over(lighten(pole, 0.35), fill(Math.max(p, x + 0.005), px) * 0.6);
  // arm and head
  const hy = h * K;
  P.over(pole, fill(sdSeg(x, y, 0, hy - 0.05, 0.18, hy + 0.02) - 0.03, px));
  const head = sdEll(x - 0.22, y - hy, 0.14, 0.08);
  P.over(darken(pole, 0.2), fill(head, px));
  P.over(hex(0xfff2b0), fill(sdEll(x - 0.22, y - hy + 0.035, 0.09, 0.035), px));
  return P.color;
}

function tree(leaf: Color): Paint {
  return (x, y, px) => {
    P.reset();
    const cy = 0.85, r = 0.78;
    P.over(ShadowCol, fill(sdEll(x - 0.55, y + 0.1, 0.8, 0.42), px * 4) * 0.3);
    const bark = hex(0x8a5a34);
    const trunk = sdBox(x, y - 0.18, 0.1, 0.2, 0.05);
    P.over(darken(bark, 0.25), fill(trunk, px));
    P.over(x < 0 ? lighten(bark, 0.1) : bark, fill(trunk + px, px));
    // canopy: a big lumpy ball
    const a = Math.atan2(y - cy, x), lump = 0.05 * Math.sin(a * 7) + 0.03 * Math.sin(a * 3 + 1);
    const d = Math.hypot(x, y - cy) - (r + lump);
    if (d < px) {
      const qx = x / r, qy = (y - cy) / r;
      const z = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy));
      const lit = clamp01(0.35 + 0.65 * (-qx * 0.45 + qy * 0.55 + z * 0.7) * 0.9);
      let col = mix(darken(leaf, 0.42), lighten(leaf, 0.22), lit);
      const n = noise(x * 6 + 3, y * 6);
      col = mix(col, darken(leaf, 0.3), smooth(0.55, 0.75, n) * 0.5);
      col = mix(col, lighten(leaf, 0.35), smooth(0.7, 0.85, noise(x * 9, y * 9 + 5)) * lit * 0.6);
      P.over(darken(leaf, 0.55), fill(d, px));
      P.over(col, fill(d + px * 1.2, px));
    }
    return P.color;
  };
}

function pine(x: number, y: number, px: number) {
  P.reset();
  P.over(ShadowCol, fill(sdEll(x - 0.55, y + 0.12, 0.7, 0.32), px * 4) * 0.3);
  const leaf = hex(0x2f9a5a), bark = hex(0x7a4e2c);
  P.over(bark, fill(sdBox(x, y - 0.12, 0.08, 0.14, 0.03), px));
  for (let i = 0; i < 3; i++) {
    const by = 0.2 + i * 0.42, w = 0.62 - i * 0.15, top = by + 0.65;
    const t = clamp01((y - by) / (top - by)), half = w * (1 - t);
    const d = Math.max(Math.abs(x) - half, Math.max(by - y, y - top));
    const col = x < 0 ? mix(leaf, lighten(leaf, 0.25), 0.6 - t * 0.3) : darken(leaf, 0.12 + t * 0.1);
    P.over(darken(leaf, 0.45), fill(d - px * 0.5, px));
    P.over(col, fill(d + px * 0.7, px));
  }
  return P.color;
}

function car(col: Color, vertical: boolean): Paint {
  const hw = vertical ? 0.42 : 0.9, hh = vertical ? 0.88 : 0.42, bodyH = 0.38, roofH = 0.62;
  return (x, y, px) => {
    P.reset();
    P.over(ShadowCol, shadowBox(x, y, hw, hh, 0.25, 0.55, px, 0.34));
    // wheels peek out under the body
    const wy = -hh + 0.06;
    if (!vertical) for (const wx of [-0.55, 0.55]) P.over(Ink, fill(sdBox(x - wx, y - wy, 0.17, 0.09, 0.06), px));
    else for (const wx of [-0.4, 0.4]) P.over(Ink, fill(sdBox(x - wx, y - wy, 0.07, 0.08, 0.03), px));
    const f = extrude(x, y, hw, hh, 0.26, bodyH);
    if (f === 0 && faceD > px) return P.color;
    P.over(darken(col, 0.5), fill(faceD, px));
    if (f === 2) P.over(mix(darken(col, 0.3), darken(col, 0.15), faceT), fill(faceD + px, px));
    if (f === 1) {
      P.over(mix(col, lighten(col, 0.12), smooth(0.2, -0.4, x)), fill(faceD + px, px));
      // cabin: glass then roof
      const rx = x, ry = y - roofH * K * 0.55 - (vertical ? -0.05 : 0);
      const ghw = vertical ? 0.34 : 0.52, ghh = vertical ? 0.5 : 0.36;
      const glass = sdBox(rx, ry, ghw, ghh, 0.14);
      P.over(darken(hex(0x2a3f66), 0.2), fill(glass, px));
      P.over(mix(hex(0x5f86c4), hex(0x2a3f66), smooth(-0.3, 0.3, rx + ry)), fill(glass + px, px));
      const roof = sdBox(rx, ry - 0.04, ghw - 0.08, ghh - 0.12, 0.1);
      P.over(darken(col, 0.25), fill(roof, px));
      P.over(lighten(col, 0.15), fill(roof + px, px));
    }
    if (f === 2 && vertical) {
      P.over(hex(0xff4d4d), fill(sdBox(Math.abs(x) - 0.28, y + hh - 0.12, 0.07, 0.035, 0.02), px));
    }
    return P.color;
  };
}

function bus(vertical: boolean): Paint {
  const hw = vertical ? 0.6 : 1.85, hh = vertical ? 1.8 : 0.58, h = 1.25;
  const yellow = hex(0xffc22e), red = hex(0xff5045);
  return (x, y, px) => {
    P.reset();
    P.over(ShadowCol, shadowBox(x, y, hw, hh, 0.2, h, px, 0.34));
    if (!vertical) for (const wx of [-1.2, 1.15]) P.over(Ink, fill(sdBox(x - wx, y + hh - 0.08, 0.24, 0.12, 0.08), px));
    const f = extrude(x, y, hw, hh, 0.22, h);
    if (f === 0 && faceD > px) return P.color;
    P.over(darken(yellow, 0.5), fill(faceD, px));
    if (f === 2) {
      let c = mix(darken(yellow, 0.2), yellow, faceT);
      if (faceT > 0.45 && faceT < 0.8) {
        const win = vertical ? Math.abs(x) < hw - 0.12 : (Math.abs(((x + 4) * 2.2) % 2 - 1) < 0.78 && Math.abs(x) < hw - 0.2);
        if (win) c = mix(hex(0x34507f), hex(0x6f9ad6), faceT - 0.45);
      }
      if (faceT < 0.18) c = darken(red, 0.1);
      P.over(c, fill(faceD + px, px));
    }
    if (f === 1) {
      P.over(mix(lighten(yellow, 0.18), yellow, smooth(-1, 1, x + y)), fill(faceD + px, px));
      const tx = x, ty = y - h * K;
      // roof stripe and vents
      const stripe = vertical ? sdBox(tx, ty, 0.12, hh - 0.2, 0.05) : sdBox(tx, ty, hw - 0.2, 0.1, 0.05);
      P.over(red, fill(stripe, px) * 0.9);
      const vent = vertical ? sdBox(tx, ty - 0.6, 0.32, 0.3, 0.06) : sdBox(tx - 0.7, ty, 0.3, 0.3, 0.06);
      P.over(hex(0xe9edf3), fill(vent, px));
      P.over(hex(0xc5ccd6), fill(vent + 0.08, px));
    }
    return P.color;
  };
}

function kiosk(x: number, y: number, px: number) {
  P.reset();
  const hw = 0.8, hh = 0.6, h = 1.3;
  P.over(ShadowCol, shadowBox(x, y, hw, hh, 0.08, h, px, 0.32));
  const f = extrude(x, y, hw, hh, 0.08, h);
  if (f === 0 && faceD > px) return P.color;
  const wall = hex(0xf6efe0), red = hex(0xff4f5e);
  P.over(darken(red, 0.45), fill(faceD, px));
  if (f === 2) {
    let c = mix(darken(wall, 0.15), wall, faceT);
    if (faceT > 0.35 && faceT < 0.72 && Math.abs(x) < hw - 0.12) c = mix(hex(0x6a3f2a), hex(0x8c5a3c), faceT);
    if (faceT > 0.78) c = (Math.floor((x + 2) * 5) % 2 === 0) ? red : Color.white; // awning
    P.over(c, fill(faceD + px, px));
  }
  if (f === 1) {
    const s = Math.floor((x + 2) * 5) % 2 === 0;
    P.over(s ? red : hex(0xfff6ec), fill(faceD + px, px));
    P.over(Color.black, fill(faceD + px, px) * smooth(0.0, 0.6, y - h * K) * 0.15);
  }
  return P.color;
}

function fountain(x: number, y: number, px: number) {
  P.reset();
  const r = 1.55, h = 0.35;
  P.over(ShadowCol, fill(sdEll(x - 0.25, y + 0.05, r + 0.15, r * 0.95), px * 4) * 0.28);
  const stone = hex(0xd9d2c4);
  const outer = sdEll(x, y - h * K * 0.5, r, r * 0.92 + h * K * 0.5);
  const top = sdEll(x, y - h * K, r, r * 0.92);
  P.over(darken(stone, 0.4), fill(outer, px));
  P.over(darken(stone, 0.18), fill(outer + px, px));
  P.over(stone, fill(top + px, px));
  const water = sdEll(x, y - h * K, r - 0.25, r * 0.92 - 0.25);
  const w = hex(0x4ab8f0);
  const ripple = 0.5 + 0.5 * Math.sin(Math.hypot(x, (y - h * K) / 0.92) * 14);
  P.over(mix(darken(w, 0.15), lighten(w, 0.25), ripple * 0.5 + smooth(0.6, -0.6, x + y) * 0.4), fill(water, px));
  // centre spout
  const sp = sdEll(x, y - h * K - 0.15, 0.32, 0.22);
  P.over(darken(stone, 0.25), fill(sp, px));
  P.over(stone, fill(sp + px, px));
  P.over(hex(0xdff6ff), fill(sdEll(x, y - h * K - 0.45, 0.16, 0.3), px) * 0.85);
  return P.color;
}

function house(wall: Color, roof: Color): Paint {
  const hw = 1.65, hh = 1.4, h = 1.3, roofH = 1.2;
  return (x, y, px) => {
    P.reset();
    P.over(ShadowCol, shadowBox(x, y, hw, hh, 0.05, h + roofH * 0.6, px, 0.32));
    const f = extrude(x, y, hw, hh, 0.04, h);
    // roof (gable along x): rises over the top face; drawn as a slightly larger box shifted further up
    const ry = y - h * K - roofH * K * 0.35;
    const roofD = sdBox(x, ry, hw + 0.12, hh + 0.05, 0.06);
    if (f === 0 && faceD > px && roofD > px) return P.color;
    P.over(darken(wall, 0.45), fill(faceD, px));
    if (f === 2) {
      let c = mix(darken(wall, 0.2), wall, faceT);
      // door + windows
      if (Math.abs(x + 0.75) < 0.26 && faceT < 0.7) c = hex(0x8a5a34);
      for (const wx of [0.25, 1.05]) if (Math.abs(x - wx) < 0.26 && faceT > 0.3 && faceT < 0.75) c = mix(hex(0x7fb5e8), hex(0xcde6ff), faceT);
      P.over(c, fill(faceD + px, px));
    }
    if (roofD < px) {
      const front = ry + (hh + 0.05) < 0.18; // roof eave strip (front)
      const ridge = ry; // y position relative to ridge line
      let c = ridge > 0 ? lighten(roof, 0.12) : darken(roof, 0.12);
      if (front) c = darken(roof, 0.3);
      const tiles = Math.abs(((ry + 4) * 6) % 2 - 1) > 0.85 ? 0.12 : 0;
      c = darken(c, tiles);
      P.over(darken(roof, 0.5), fill(roofD, px));
      P.over(c, fill(roofD + px, px));
      P.over(lighten(roof, 0.35), fill(Math.abs(ridge) - 0.05, px) * fill(roofD + px * 2, px));
      // chimney
      const ch = sdBox(x - 0.9, ry - 0.55, 0.16, 0.22, 0.03);
      P.over(darken(hex(0xb5523b), 0.3), fill(ch, px));
      P.over(hex(0xb5523b), fill(ch + px, px));
    }
    return P.color;
  };
}

function shop(wall: Color, awning: Color): Paint {
  const hw = 2.05, hh = 1.7, h = 3.6;
  return (x, y, px) => {
    P.reset();
    P.over(ShadowCol, shadowBox(x, y, hw, hh, 0.05, h, px, 0.33));
    const f = extrude(x, y, hw, hh, 0.05, h);
    if (f === 0 && faceD > px) return P.color;
    P.over(darken(wall, 0.5), fill(faceD, px));
    if (f === 2) {
      let c = mix(darken(wall, 0.22), wall, faceT);
      const fy = faceT * h; // metres up the wall
      if (fy < 0.9 && Math.abs(x) < hw - 0.2) c = mix(hex(0x5b8fc9), hex(0xa9d2f5), fy / 0.9);
      if (fy > 0.9 && fy < 1.15) c = Math.floor((x + 5) * 3) % 2 === 0 ? awning : Color.white;
      if (fy > 1.5) {
        const wx = Math.abs(((x + 5) * 1.4) % 2 - 1), wy = Math.abs(((fy - 1.5) * 1.25) % 2 - 1);
        if (wx < 0.55 && wy < 0.5 && fy < h - 0.25) c = mix(hex(0x6f9ad6), hex(0xcfe5fb), wy);
      }
      P.over(c, fill(faceD + px, px));
    }
    if (f === 1) {
      const ty = y - h * K;
      P.over(mix(hex(0xb9bfca), hex(0xd6dbe3), smooth(-1, 1, x + ty)), fill(faceD + px, px));
      P.over(darken(wall, 0.2), fill(-faceD - 0.12, px) * fill(faceD + px, px));
      const ac = sdBox(x - 0.8, ty - 0.3, 0.45, 0.35, 0.06);
      P.over(hex(0x8f97a5), fill(ac, px));
      P.over(hex(0xe2e6ec), fill(ac + 0.07, px));
      P.over(Ink, fill(sdCirc(x - 0.8, ty - 0.3, 0.16), px) * 0.5);
    }
    return P.color;
  };
}

function tower(glass: Color, frame: Color, helipad: boolean): Paint {
  const hw = 2.5, hh = 2.25, h = 8;
  return (x, y, px) => {
    P.reset();
    P.over(ShadowCol, shadowBox(x, y, hw, hh, 0.05, h, px, 0.36));
    const f = extrude(x, y, hw, hh, 0.05, h);
    if (f === 0 && faceD > px) return P.color;
    P.over(darken(frame, 0.5), fill(faceD, px));
    if (f === 2) {
      const fy = faceT * h;
      let c = darken(frame, 0.1);
      const wx = Math.abs(((x + 9) * 1.6) % 2 - 1), wy = Math.abs(((fy + 0.2) * 1.4) % 2 - 1);
      if (wx < 0.72 && wy < 0.62 && fy > 0.5 && fy < h - 0.3) {
        c = mix(darken(glass, 0.25), lighten(glass, 0.35), faceT * 0.7 + smooth(-2.5, 2.5, -x) * 0.3);
        if (hash(Math.floor((x + 9) * 0.8), Math.floor(fy * 0.7)) > 0.82) c = mix(c, hex(0xfff0b8), 0.55);
      }
      if (fy < 0.5) c = darken(frame, 0.3);
      P.over(c, fill(faceD + px, px));
    }
    if (f === 1) {
      const ty = y - h * K;
      P.over(mix(lighten(frame, 0.2), frame, smooth(-2, 2, x - ty)), fill(faceD + px, px));
      P.over(darken(frame, 0.25), fill(-faceD - 0.18, px) * fill(faceD + px, px));
      if (helipad) {
        const pad = sdCirc(x, ty, 1.15);
        P.over(hex(0x4a505e), fill(pad, px));
        P.over(hex(0xffd23f), fill(Math.abs(pad + 0.12) - 0.05, px));
        const bars = Math.max(Math.abs(Math.abs(x) - 0.33) - 0.08, Math.abs(ty) - 0.5);
        const bar = Math.max(Math.abs(x) - 0.33, Math.abs(ty) - 0.08);
        P.over(Color.white, fill(Math.min(bars, bar), px));
      } else {
        const box = sdBox(x + 0.6, ty - 0.4, 0.9, 0.7, 0.06);
        P.over(darken(frame, 0.35), fill(box, px));
        P.over(lighten(frame, 0.1), fill(box + 0.08, px));
        P.over(hex(0xff4d4d), fill(sdCirc(x - 1.6, ty + 1.2, 0.12), px));
      }
    }
    return P.color;
  };
}

let defs: KindDef[] | null = null;

function makeDefs(): KindDef[] {
  const d: KindDef[] = [];
  const add = (kind: Kind, size: number, value: number, hw: number, hh: number, color: Color, pics: Pic[], picsV: Pic[] = []) =>
    d[kind] = { kind, size, value, hw, hh, pics, picsV, color };
  const S = 56, M = 40, L = 26;

  const hairs = [hex(0x3b2a20), hex(0x1d1d24), hex(0xc98a3b), hex(0x8a4b2a)];
  add(Kind.Person, 0.42, 1, 0.12, 0.08, Shirts[0], Shirts.map((s, i) =>
    pic("person" + i, ...bounds(0.2, 0.12, 0.5, 0.06), S, person(s, Skin[i % Skin.length], hairs[(i * 3) % hairs.length]))));
  add(Kind.Cone, 0.36, 1, 0.12, 0.08, hex(0xff7a2a), [pic("cone", ...bounds(0.16, 0.08, 0.3), S, cone)]);
  add(Kind.Hydrant, 0.45, 2, 0.13, 0.1, hex(0xe8323f), [pic("hydrant", ...bounds(0.17, 0.1, 0.35), S, hydrant)]);
  add(Kind.Trash, 0.55, 2, 0.18, 0.12, hex(0x3b9a6c), [pic("trash", ...bounds(0.2, 0.12, 0.45), S, trash)]);
  add(Kind.Mailbox, 0.55, 2, 0.16, 0.1, hex(0x3a6dde), [pic("mailbox", ...bounds(0.17, 0.1, 0.5), S, mailbox)]);
  add(Kind.Bush, 0.95, 3, 0.4, 0.25, Leaf[0], [
    pic("bush0", ...bounds(0.5, 0.3, 0.6, 0.1), S, bush(Leaf[0], false)),
    pic("bush1", ...bounds(0.5, 0.3, 0.6, 0.1), S, bush(Leaf[1], true)),
  ]);
  add(Kind.Bench, 1.2, 4, 0.55, 0.2, hex(0xc0804a), [pic("bench", ...bounds(0.58, 0.3, 0.35), S, bench)]);
  add(Kind.Lamp, 1.55, 5, 0.1, 0.08, hex(0xfff2b0), [pic("lamp", -0.2, -0.75, 1.15, 1.48, S, lamp)]);
  add(Kind.Tree, 2.0, 8, 0.32, 0.26, Leaf[0], [
    pic("tree0", -0.95, -0.55, 1.45, 1.75, M, tree(Leaf[0])),
    pic("tree1", -0.95, -0.55, 1.45, 1.75, M, tree(Leaf[1])),
    pic("tree2", -0.95, -0.55, 1.45, 1.75, M, tree(Leaf[2])),
    pic("tree3", -0.95, -0.55, 1.45, 1.75, M, tree(Leaf[3])),
  ]);
  add(Kind.Pine, 2.0, 8, 0.3, 0.24, hex(0x2f9a5a), [pic("pine", -0.75, -0.5, 1.4, 1.95, M, pine)]);
  add(Kind.Car, 1.95, 10, 0.9, 0.42, CarCols[0],
    CarCols.map((c, i) => pic("carH" + i, ...bounds(0.95, 0.45, 0.6), M, car(c, false))),
    CarCols.map((c, i) => pic("carV" + i, ...bounds(0.45, 0.92, 0.6), M, car(c, true))));
  add(Kind.Kiosk, 2.5, 15, 0.8, 0.6, hex(0xff4f5e), [pic("kiosk", ...bounds(0.85, 0.62, 1.3), M, kiosk)]);
  add(Kind.Fountain, 3.3, 25, 1.4, 1.3, hex(0x4ab8f0), [pic("fountain", -1.7, -1.6, 1.85, 1.95, M, fountain)]);
  add(Kind.Bus, 3.7, 30, 1.85, 0.58, hex(0xffc22e), [pic("busH", ...bounds(1.9, 0.6, 1.25), M, bus(false))], [pic("busV", ...bounds(0.62, 1.85, 1.25), M, bus(true))]);
  add(Kind.House, 4.2, 60, 1.65, 1.4, hex(0xd9614c), [
    pic("house0", ...bounds(1.8, 1.45, 2.4, 0.1), L, house(hex(0xfff3dc), hex(0xd9614c))),
    pic("house1", ...bounds(1.8, 1.45, 2.4, 0.1), L, house(hex(0xe8f1ff), hex(0x4a78c9))),
    pic("house2", ...bounds(1.8, 1.45, 2.4, 0.1), L, house(hex(0xffe3d1), hex(0x4fa36a))),
  ]);
  add(Kind.Shop, 5.4, 110, 2.05, 1.7, hex(0xf2a65a), [
    pic("shop0", ...bounds(2.1, 1.75, 3.6), L, shop(hex(0xf2a65a), hex(0xff4f5e))),
    pic("shop1", ...bounds(2.1, 1.75, 3.6), L, shop(hex(0x9ad0c2), hex(0x3f8cff))),
  ]);
  add(Kind.Tower, 6.9, 200, 2.5, 2.25, hex(0x5aa0e6), [
    pic("tower0", ...bounds(2.55, 2.3, 8), L, tower(hex(0x5aa0e6), hex(0xdfe4ec), true)),
    pic("tower1", ...bounds(2.55, 2.3, 8), L, tower(hex(0x3fc6c0), hex(0x5a6175), false)),
    pic("tower2", ...bounds(2.55, 2.3, 8), L, tower(hex(0x8fb4e8), hex(0xc77d5a), false)),
  ]);
  return d;
}

// ------------------------------------------------------------------ ground

export const Ground = {
  Grass: hex(0x7cc35a), Asphalt: hex(0x4b505c), Sidewalk: hex(0xd3d6dd),
};

const sidewalkW = 1.3;

/** Block of `size` units with a sidewalk ring and an interior painter. */
function blockPaint(size: number, interior: (x: number, y: number, px: number) => Color): Paint {
  const half = size / 2;
  return (x, y, px) => {
    const edge = Math.max(Math.abs(x), Math.abs(y));
    const inner = half - sidewalkW;
    const dIn = sdBox(x, y, inner, inner, 0.6);
    const dOut = sdBox(x, y, half, half, 1.0);
    P.reset();
    P.over(Ground.Asphalt, 1);
    // sidewalk with tile seams and a curb
    let sw = Ground.Sidewalk;
    const sx = Math.abs(((x + 50) * 1.0) % 1 - 0.5), sy = Math.abs(((y + 50) * 1.0) % 1 - 0.5);
    if (sx > 0.47 || sy > 0.47) sw = darken(sw, 0.07);
    P.over(darken(sw, 0.25), fill(dOut, px));
    P.over(sw, fill(dOut + 0.12, px));
    if (dIn < px * 2) {
      P.over(darken(Ground.Sidewalk, 0.2), fill(dIn, px));
      const c = interior(x, y, px);
      P.over(c, fill(dIn + 0.1, px));
    }
    void edge;
    return P.color;
  };
}

const grassAt = (x: number, y: number) => {
  const n = noise(x * 0.35 + 7, y * 0.35), m = noise(x * 1.7, y * 1.7 + 3);
  let c = mix(Ground.Grass, darken(Ground.Grass, 0.12), n);
  c = mix(c, lighten(Ground.Grass, 0.08), smooth(0.6, 0.8, m) * 0.6);
  return c;
};

export enum BlockType { Park, Homes, Downtown, Plaza, Parking }

function blockInterior(t: BlockType): (x: number, y: number, px: number) => Color {
  switch (t) {
    case BlockType.Park: return (x, y, px) => {
      let c = grassAt(x, y);
      const path = Math.min(sdSeg(x, y, -8, -8, 8, 8), sdSeg(x, y, -8, 8, 8, -8), Math.abs(Math.hypot(x, y) - 3.2)) - 0.55;
      const pc = hex(0xe8d8b0);
      c = mix(c, darken(pc, 0.15), fill(path, px));
      c = mix(c, pc, fill(path + 0.1, px));
      const pond = sdEll(x - 0.0, y - 0.0, 1.9, 1.6);
      void pond;
      return c;
    };
    case BlockType.Homes: return (x, y) => {
      let c = grassAt(x + 20, y);
      if (Math.abs(((x + 40) * 0.8) % 2 - 1) < 0.5) c = lighten(c, 0.04);
      // driveways from each lot to the street below/above
      const dv = Math.min(sdBox(x - 4.1 - 1.4, y + 6.2, 0.55, 1.6, 0.1), sdBox(x + 4.1 - 1.4, y + 6.2, 0.55, 1.6, 0.1));
      if (dv < 0) c = hex(0xc4c0b8);
      return c;
    };
    case BlockType.Downtown: return (x, y) => {
      let c = hex(0xc3c8d1);
      const tx = Math.abs(((x + 40) * 0.5) % 1 - 0.5), ty = Math.abs(((y + 40) * 0.5) % 1 - 0.5);
      if (tx > 0.47 || ty > 0.47) c = darken(c, 0.08);
      if (hash(Math.floor((x + 40) * 0.5), Math.floor((y + 40) * 0.5)) > 0.85) c = darken(c, 0.04);
      return c;
    };
    case BlockType.Plaza: return (x, y, px) => {
      const r = Math.hypot(x, y);
      let c = hex(0xeadfca);
      const ring = Math.abs(r % 1.6 - 0.8);
      if (ring < 0.08) c = hex(0xd2c3a6);
      const a = Math.atan2(y, x);
      if (r > 3 && Math.abs(((a / (Math.PI * 2)) * 24 + 48) % 1 - 0.5) < 0.04) c = hex(0xd2c3a6);
      if (r < 2.4) c = hex(0xd8c9ad);
      // planter corners
      const cx = Math.abs(x) - 6.2, cy = Math.abs(y) - 6.2;
      c = mix(c, darken(hex(0xd2c3a6), 0.1), fill(Math.hypot(cx, cy) - 1.22, px));
      c = mix(c, grassAt(x, y), fill(Math.hypot(cx, cy) - 1.1, px));
      return c;
    };
    case BlockType.Parking: return (x, y, px) => {
      let c = mix(hex(0x5a5f6b), hex(0x535864), noise(x * 0.8, y * 0.8));
      // two rows of stalls (cars park vertically), stall lines every 1.4 units
      for (const ry of [4.3, -4.3]) {
        if (Math.abs(y - ry) < 1.15) {
          const lx = Math.abs(((x + 7.7) / 1.4) % 1 - 0.5) * 1.4;
          if (Math.abs(lx - 0.7) < 0.05 && Math.abs(x) < 7.1) c = mix(c, Color.white, fill(Math.abs(lx - 0.7) - 0.04, px));
        }
      }
      if (Math.abs(Math.abs(y) - 3.1) < 0.05 && Math.abs(x) < 7.1) c = Color.white;
      // centre arrows lane
      if (Math.abs(y) < 0.05 && Math.abs(((x + 20) * 0.5) % 1 - 0.5) < 0.25) c = hex(0xf2c94c);
      return c;
    };
  }
}

export function blockSprite(t: BlockType, size: number) {
  return pic("block" + t + "-" + size, -size / 2, -size / 2, size / 2, size / 2, 22, blockPaint(size, blockInterior(t))).sprite;
}

/** Horizontal road segment `len` long and `w` wide (rotate 90° for vertical roads), crossings at both ends. */
export function roadSprite(len: number, w: number) {
  return pic("road" + len + "x" + w, -len / 2, -w / 2, len / 2, w / 2, 14, (x, y, px) => {
    let c = mix(Ground.Asphalt, darken(Ground.Asphalt, 0.08), noise(x * 1.3, y * 1.3));
    const lane = hex(0xf3efe2);
    // dashed centre line
    if (Math.abs(y) < 0.09 && Math.abs(((x + 50) / 1.6) % 1 - 0.5) < 0.28 && Math.abs(x) < len / 2 - 1.8) c = hex(0xf2c94c);
    // edge lines
    if (Math.abs(Math.abs(y) - (w / 2 - 0.35)) < 0.06 && Math.abs(x) < len / 2 - 1.6) c = mix(c, lane, 0.8);
    // zebra crossings near both ends
    const ex = len / 2 - Math.abs(x);
    if (ex > 0.25 && ex < 1.45 && Math.abs(y) < w / 2 - 0.2 && Math.abs(((y + 20) / 0.6) % 1 - 0.5) < 0.27) c = lane;
    return mix(c, darken(c, 0.15), fill(-(Math.abs(y) - w / 2 + 0.12), px) * 0);
  }).sprite;
}

export function crossingSprite(w: number) {
  return pic("cross" + w, -w / 2, -w / 2, w / 2, w / 2, 14, (x, y) => {
    let c = mix(Ground.Asphalt, darken(Ground.Asphalt, 0.08), noise(x * 1.3 + 9, y * 1.3));
    return c;
  }).sprite;
}

export function grassSprite() {
  return CasualArt.make("hh-grass", 128, 128, (p) => grassAt(p.x * 8, p.y * 8).withAlpha(1));
}

/** A tiny opaque white square (tint it). */
export function pixelSprite() { return CasualArt.make("hh-px", 4, 4, () => Color.white); }

// ------------------------------------------------------------------ holes

/** Black hole interior, radius 1 (sprite 2 units wide): the far wall shows as a gradient band. */
export function holeInterior() {
  return CasualArt.make("hh-hole", 256, 256, (p) => {
    const r = Math.hypot(p.x, p.y), px = 2 / 256;
    const a = fill(r - 0.93, px);
    if (a <= 0) return new Color(0, 0, 0, 0);
    // far wall: inside the rim but outside the same circle shifted down
    const wall = Math.hypot(p.x, p.y + 0.42) - 0.93;
    const t = clamp01(wall / 0.42);
    let c = mix(hex(0x07070d), hex(0x2c2f42), smooth(0, 1, t) * smooth(-0.4, 0.6, p.y));
    c = mix(c, hex(0x07070d), smooth(0.86, 0.93, r) * 0.4);
    return c.withAlpha(a);
  }, 0, 128);
}

export const SkinNames = ["CLASSIC", "BUBBLEGUM", "LIME", "OCEAN", "SUNSET", "CANDY", "ZEBRA", "TIGER", "LAVA", "GOLD", "RAINBOW", "GALAXY"];
export const SkinCosts = [0, 100, 100, 150, 250, 300, 350, 400, 500, 700, 900, 1200];
/** Main colour of each skin (UI accents, minimap). */
export const SkinColors = [hex(0xf2f4f8), hex(0xff6fb5), hex(0x9be15d), hex(0x3f8cff), hex(0xff8a4c), hex(0xff7aa8), hex(0xf4f4f4), hex(0xff9a2e), hex(0xff4a2a), hex(0xffc93c), hex(0xff5ce1), hex(0x7a5cff)];

function skinColor(skin: number, a: number, r: number): Color {
  const u = (a / (Math.PI * 2) + 1) % 1; // 0..1 around the ring
  switch (skin) {
    case 1: return hex(0xff6fb5);
    case 2: return hex(0x9be15d);
    case 3: return mix(hex(0x2f6bff), hex(0x3fe0ff), 0.5 + 0.5 * Math.sin(u * Math.PI * 4));
    case 4: return Color.HSVToRGB(Mathf.repeat(0.02 + 0.12 * (0.5 + 0.5 * Math.sin(u * Math.PI * 2)), 1), 0.75, 1);
    case 5: return Math.floor(u * 24) % 2 === 0 ? hex(0xff5c95) : hex(0xfff4f8);
    case 6: return Math.floor(u * 20 + Math.sin(u * 60) * 0.3) % 2 === 0 ? hex(0x1e1e24) : hex(0xf6f6f6);
    case 7: return (u * 16) % 1 < 0.3 ? hex(0x241a14) : hex(0xff9a2e);
    case 8: {
      const n = noise(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + r * 8);
      return mix(hex(0xc81e10), hex(0xffd23a), smooth(0.45, 0.8, n));
    }
    case 9: return mix(hex(0xc8901e), hex(0xfff0a0), 0.5 + 0.5 * Math.sin(u * Math.PI * 6));
    case 10: return Color.HSVToRGB(u, 0.7, 1);
    case 11: {
      let c = mix(hex(0x3a1c8c), hex(0xd04cff), 0.5 + 0.5 * Math.sin(u * Math.PI * 4 + 1));
      if (hash(Math.floor(u * 90), Math.floor(r * 60)) > 0.9) c = Color.white;
      return c;
    }
    default: return hex(0xf2f4f8);
  }
}

/** The rim ring for a skin (or -1: plain white, tinted per bot). Radius 1.15 including the soft ground shadow. */
export function rimSprite(skin: number) {
  return CasualArt.make("hh-rim" + skin, 256, 256, (p) => {
    const R = 1.15, x = p.x * R, y = p.y * R, r = Math.hypot(x, y), px = (2 * R) / 256;
    const a = Math.atan2(y, x);
    P.reset();
    // soft contact shadow just outside the ring
    P.over(ShadowCol, smooth(1.13, 0.98, r) * 0.35 * (r > 0.9 ? 1 : 0));
    const ring = Math.abs(r - 0.94) - 0.065;
    if (ring < px) {
      const base = skin < 0 ? Color.white : skinColor(skin, a, r);
      const t = clamp01((r - 0.875) / 0.13);
      const lightDir = 0.5 + 0.5 * Math.cos(a - (Math.PI * 3) / 4);
      let c = mix(darken(base, 0.35), base, smooth(0, 0.35, t) * smooth(1, 0.6, t) + 0.25);
      c = mix(c, lighten(base, 0.6), smooth(0.25, 0.5, t) * smooth(0.75, 0.5, t) * lightDir * 0.75);
      P.over(darken(base, 0.55), fill(ring, px));
      P.over(c, fill(ring + px, px));
    }
    return P.color;
  }, 0, 256 / (2 * 1.15));
}

/** Little gold crown (leader marker). */
export function crownSprite() {
  return CasualArt.make("hh-crown", 96, 72, (p) => {
    const px = 2 / 96, x = p.x, y = p.y;
    const gold = hex(0xffc93c);
    P.reset();
    const base = sdBox(x, y + 0.36, 0.72, 0.13, 0.05);
    let body = base;
    for (const [tx, ty] of [[-0.62, 0.32], [0, 0.48], [0.62, 0.32]] as [number, number][]) body = Math.min(body, sdSeg(x, y, tx * 0.9, -0.3, tx, ty) - 0.13);
    body = Math.min(body, sdBox(x, y + 0.12, 0.66, 0.2, 0.04));
    P.over(darken(gold, 0.45), fill(body - px * 1.5, px));
    P.over(mix(gold, lighten(gold, 0.35), smooth(-0.2, 0.4, y - x * 0.3)), fill(body + px * 0.5, px));
    for (const [tx, ty] of [[-0.62, 0.36], [0, 0.52], [0.62, 0.36]] as [number, number][]) P.over(hex(0xff4d6a), fill(sdCirc(x - tx, y - ty, 0.09), px));
    P.over(hex(0x3f8cff), fill(sdCirc(x, y + 0.36, 0.08), px));
    return P.color;
  });
}

export function coinSprite() {
  return CasualArt.make("hh-coin", 64, 64, (p) => {
    const px = 2 / 64, r = Math.hypot(p.x, p.y);
    const gold = hex(0xffc93c);
    P.reset();
    P.over(darken(gold, 0.45), fill(r - 0.94, px));
    P.over(mix(gold, lighten(gold, 0.35), smooth(-0.6, 0.6, p.y - p.x)), fill(r - 0.84, px));
    P.over(darken(gold, 0.2), fill(Math.abs(r - 0.58) - 0.06, px));
    P.over(lighten(gold, 0.5), fill(sdBox(p.x, p.y, 0.09, 0.3, 0.04), px) * 0.9);
    return P.color;
  });
}

/** Hole + rim in one icon (how-to, title). */
export function holeIcon(skin = 0) {
  return CasualArt.make("hh-holeicon" + skin, 128, 128, (p) => {
    const px = 2 / 128, x = p.x * 1.1, y = p.y * 1.1, r = Math.hypot(x, y);
    P.reset();
    P.over(ShadowCol, smooth(1.08, 0.95, r) * 0.3);
    const wall = clamp01((Math.hypot(x, y + 0.4) - 0.9) / 0.4);
    P.over(mix(hex(0x07070d), hex(0x2c2f42), wall), fill(r - 0.9, px));
    const ring = Math.abs(r - 0.92) - 0.07;
    const base = skinColor(skin, Math.atan2(y, x), r);
    P.over(darken(base, 0.4), fill(ring, px));
    P.over(mix(base, lighten(base, 0.5), smooth(0.2, 0.9, -x + y) * 0.6), fill(ring + px, px));
    return P.color;
  });
}

export function clockIcon() {
  return CasualArt.make("hh-clock", 64, 64, (p) => {
    const px = 2 / 64, r = Math.hypot(p.x, p.y);
    P.reset();
    P.over(Color.white, fill(r - 0.92, px));
    P.over(hex(0x2d3150), fill(r - 0.78, px));
    P.over(Color.white, fill(sdSeg(p.x, p.y, 0, 0, 0, 0.55) - 0.08, px));
    P.over(Color.white, fill(sdSeg(p.x, p.y, 0, 0, 0.4, -0.15) - 0.08, px));
    return P.color;
  });
}

export const HoleArt = {
  get Defs() { return defs ??= makeDefs(); },
  Shirts, CarCols,
};
