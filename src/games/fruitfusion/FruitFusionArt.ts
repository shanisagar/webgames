import { CasualArt, Color, Mathf, Pal, Sprite, V2, V3 } from "../../kit";

/**
 * Procedural art for Fruit Fusion: eleven cute fruits (each with its own skin texture, leaves and a face), the
 * glass jar, the wooden counter and the pastel kitchen background. Rasterized once and cached by CasualArt.
 * Fruit sprites keep the round body at 0.8 of the sprite's half size so stems and crowns fit inside.
 * (Port of FruitFusionArt.cs.)
 */

const Tiers = 11;
const BodyFrac = 0.8; // body radius in sprite p-units

const Names = [
  "CHERRY", "STRAWBERRY", "GRAPE", "LIME", "ORANGE", "APPLE", "PEACH", "PINEAPPLE", "MELON", "PUMPKIN", "WATERMELON",
];

const Skin = [
  Pal.hex(0xe8263b), Pal.hex(0xf2384f), Pal.hex(0x9147d1), Pal.hex(0x7bd650), Pal.hex(0xff9a1f),
  Pal.hex(0xe53935), Pal.hex(0xffa08c), Pal.hex(0xf7c533), Pal.hex(0xb9e27c), Pal.hex(0xff8a1e), Pal.hex(0x3daa48),
];

/** Juice colour for splashes. */
const Juice = [
  Pal.hex(0xff4060), Pal.hex(0xff5a6e), Pal.hex(0xb46af0), Pal.hex(0xb2f07a), Pal.hex(0xffb84a),
  Pal.hex(0xffe08a), Pal.hex(0xffc2a8), Pal.hex(0xffe36a), Pal.hex(0xe2ffb0), Pal.hex(0xffb060), Pal.hex(0xff4f6a),
];

const Leaf = Pal.hex(0x3db54a), LeafDark = Pal.hex(0x23843a), Stem = Pal.hex(0x7a4a28), Ink = Pal.hex(0x2b1b17);

const fract = (v: number) => v - Math.floor(v);
const LightDir = new V3(-0.45, 0.6, 0.66).normalized;

function Fruit(tier: number, silhouette = false): Sprite {
  const res = tier <= 3 ? 128 : tier <= 7 ? 192 : 256;
  return CasualArt.make((silhouette ? "ff-sil-" : "ff-fruit-") + tier, res, res, (p) => FruitPixel(tier, p, 2 / res, silhouette));
}

function FruitPixel(tier: number, p: V2, px: number, silhouette: boolean): Color {
  let outC = new Color(0, 0, 0, 0);
  const R = BodyFrac;
  let dBody = p.magnitude - R;
  if (tier === 5) dBody = Math.max(dBody, -CasualArt.sdCircle(p, new V2(0, R + 0.06), 0.16)); // apple dent

  // --- behind body: stems that tuck behind
  outC = Behind(tier, p, px, outC);

  const a = CasualArt.fill(dBody, px);
  if (a > 0) {
    const q = p.mul(1 / R);
    const z = Math.sqrt(Math.max(0, 1 - q.sqrMagnitude));
    const baseC = Pattern(tier, q, z);
    const n = new V3(q.x, q.y, z);
    const diff = Math.max(0, V3.dot(n, LightDir));
    let col = baseC.mul(0.62 + 0.48 * diff);
    col = Color.lerp(col, CasualArt.darken(baseC, 0.42), CasualArt.smooth(0.72, 1, q.magnitude) * 0.55);
    const h = q.sub(new V2(-0.38, 0.44));
    const spec = CasualArt.smooth(0.3, 0.0, new V2(h.x * 1.1, h.y * 1.6).magnitude);
    col = Color.lerp(col, Color.white, spec * 0.75);
    // cartoon outline
    const rim = CasualArt.fill(dBody + 0.035, px);
    col = Color.lerp(CasualArt.darken(Skin[tier], 0.55), col, rim);
    col = Face(tier, q, px / R, col);
    col = col.withAlpha(1);
    outC = CasualArt.over(outC, col, a);
  }

  // --- in front of body: leaves, crowns
  outC = Front(tier, p, px, outC);

  if (silhouette) return new Color(1, 1, 1, outC.a);
  return outC;
}

function Pattern(tier: number, q: V2, _z: number): Color {
  let c = Skin[tier];
  switch (tier) {
    case 1: { // strawberry seeds
      const s = new V2(q.x * 4.2 + (Math.floor(q.y * 4.2) % 2 === 0 ? 0.5 : 0), q.y * 4.2);
      const f = new V2(fract(s.x) - 0.5, fract(s.y) - 0.5);
      const seed = CasualArt.smooth(0.16, 0.1, new V2(f.x * 1.4, f.y).magnitude);
      c = Color.lerp(c, Pal.hex(0xffe27a), seed * (q.y < 0.55 ? 1 : 0));
      c = Color.lerp(c, Pal.hex(0xc81e3a), CasualArt.smooth(0.2, -0.9, q.y) * 0.4);
      break;
    }
    case 2: { // grape: soft lighter bubbles
      let b = 0;
      b += CasualArt.smooth(0.32, 0.1, q.sub(new V2(0.35, -0.3)).magnitude);
      b += CasualArt.smooth(0.26, 0.08, q.sub(new V2(-0.4, -0.45)).magnitude);
      c = Color.lerp(c, Pal.hex(0xb57ae8), Mathf.clamp01(b) * 0.5);
      break;
    }
    case 3: // lime pores
    case 4: { // orange pores
      const s = q.mul(9);
      const n = Mathf.perlinNoise(s.x + 11, s.y + 7);
      c = Color.lerp(c, CasualArt.lighten(c, 0.35), CasualArt.smooth(0.62, 0.8, n) * 0.6);
      c = Color.lerp(c, CasualArt.darken(c, 0.2), CasualArt.smooth(0.38, 0.2, n) * 0.5);
      break;
    }
    case 5: // apple: yellow blush low on one side
      c = Color.lerp(c, Pal.hex(0xffb03a), CasualArt.smooth(0.2, 0.9, q.x - q.y * 0.5) * 0.35);
      break;
    case 6: { // peach: redder on one side + crease
      c = Color.lerp(c, Pal.hex(0xff6f7a), CasualArt.smooth(-0.2, 0.9, q.x + q.y * 0.3) * 0.75);
      const crease = Math.abs(q.x - 0.22 * Math.sin(q.y * 2.2) - 0.12);
      c = Color.lerp(c, Pal.hex(0xe5596a), CasualArt.smooth(0.07, 0.0, crease) * 0.7);
      break;
    }
    case 7: { // pineapple diamonds
      const u = fract((q.x + q.y) * 3.2), v = fract((q.x - q.y) * 3.2);
      const line = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
      c = Color.lerp(Pal.hex(0xc98a12), c, CasualArt.smooth(0.03, 0.12, line));
      const cx = fract((q.x + q.y) * 3.2 + 0.5) - 0.5, cy = fract((q.x - q.y) * 3.2 + 0.5) - 0.5;
      c = Color.lerp(c, Pal.hex(0x9a6410), CasualArt.smooth(0.12, 0.05, new V2(cx, cy).magnitude) * 0.8);
      break;
    }
    case 8: { // melon net
      const w1 = Math.abs(Math.sin(q.x * 7 + Math.sin(q.y * 5) * 1.3));
      const w2 = Math.abs(Math.sin(q.y * 7.5 + Math.sin(q.x * 4.5) * 1.4));
      const net = Math.min(w1, w2);
      c = Color.lerp(c, Pal.hex(0xf4f7de), CasualArt.smooth(0.16, 0.04, net) * 0.85);
      break;
    }
    case 9: { // pumpkin ribs
      const ang = Math.asin(Mathf.clamp(q.x / Math.max(0.2, Math.sqrt(Math.max(0.01, 1 - q.y * q.y))), -1, 1));
      const rib = Math.abs(Math.cos(ang * 3.0));
      c = Color.lerp(CasualArt.darken(c, 0.25), c, CasualArt.smooth(0.0, 0.5, rib));
      break;
    }
    case 10: { // watermelon stripes
      const s = Math.sin(q.x * 8.5 + Math.sin(q.y * 7) * 0.7 + Math.sin(q.y * 15) * 0.18);
      c = Color.lerp(c, Pal.hex(0x1c6a2b), CasualArt.smooth(0.15, 0.45, s));
      break;
    }
  }
  return c;
}

function Face(tier: number, q: V2, px: number, col: Color): Color {
  const ey = tier === 7 ? 0.02 : 0.04, ex = 0.3;
  for (let s = -1; s <= 1; s += 2) {
    const e = q.sub(new V2(ex * s, ey));
    const d = new V2(e.x / 0.095, e.y / 0.13).magnitude - 1;
    col = Color.lerp(col, Ink, CasualArt.fill(d * 0.1, px));
    const g = CasualArt.sdCircle(q, new V2(ex * s - 0.03, ey + 0.045), 0.035);
    col = Color.lerp(col, Color.white, CasualArt.fill(g, px));
    // blush
    const bl = new V2((q.x - 0.5 * s) / 0.13, (q.y + 0.12) / 0.07).magnitude;
    col = Color.lerp(col, Pal.hex(0xff6f8e), CasualArt.smooth(1, 0.2, bl) * 0.45);
  }
  // smile
  const m = q.sub(new V2(0, -0.06));
  const ring = Math.abs(m.magnitude - 0.11) - 0.022;
  if (m.y < -0.02) col = Color.lerp(col, Ink, CasualArt.fill(ring, px));
  return col;
}

function Behind(tier: number, p: V2, px: number, c: Color): Color {
  const R = BodyFrac;
  switch (tier) {
    case 0: { // cherry: long curved stem
      let best = 9;
      let prev = new V2(0, R - 0.2);
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const cur = new V2(0.28 * t * t + 0.05 * t, R - 0.2 + 0.36 * t);
        best = Math.min(best, CasualArt.sdSegment(p, prev, cur));
        prev = cur;
      }
      c = CasualArt.over(c, Stem, CasualArt.fill(best - 0.045, px));
      break;
    }
    case 2: case 3: case 4: case 5: case 6: case 8: {
      const d = CasualArt.sdSegment(p, new V2(0, R - 0.1), new V2(0.06, R + 0.16)) - 0.05;
      c = CasualArt.over(c, Stem, CasualArt.fill(d, px));
      break;
    }
    case 9: {
      const d = CasualArt.sdBox(p.sub(new V2(0.02, R + 0.08)), new V2(0.08, 0.14), 0.05);
      c = CasualArt.over(c, Pal.hex(0x6b8e23), CasualArt.fill(d, px));
      break;
    }
  }
  return c;
}

function LeafSd(p: V2, at: V2, angleDeg: number, len: number, width: number) {
  const a = angleDeg * Mathf.Deg2Rad;
  const d = p.sub(at);
  const r = new V2(d.x * Math.cos(-a) - d.y * Math.sin(-a), d.x * Math.sin(-a) + d.y * Math.cos(-a));
  // vesica-like leaf along +x
  const t = Mathf.clamp01(r.x / len);
  const half = width * Math.sin(t * Math.PI);
  const dy = Math.abs(r.y) - half;
  const dx = Math.max(-r.x, r.x - len);
  return Math.max(dy, dx) * 0.8;
}

function LeafColor(p: V2, at: V2, angleDeg: number, c: Color) {
  // central vein
  const a = angleDeg * Mathf.Deg2Rad;
  const d = p.sub(at);
  const ry = d.x * Math.sin(-a) + d.y * Math.cos(-a);
  return Color.lerp(LeafDark, c, CasualArt.smooth(0.0, 0.02, Math.abs(ry)));
}

function Front(tier: number, p: V2, px: number, c: Color): Color {
  const R = BodyFrac;
  switch (tier) {
    case 0: {
      const at = new V2(0.2, R + 0.16);
      const d = LeafSd(p, at, 20, 0.32, 0.1);
      c = CasualArt.over(c, LeafColor(p, at, 20, Leaf), CasualArt.fill(d, px));
      break;
    }
    case 1: { // strawberry crown: leaves drooping over the top, a little stem
      const at = new V2(0, R - 0.04);
      const angs = [195, 232, 270, 308, 345];
      for (let i = 0; i < angs.length; i++) {
        const d = LeafSd(p, at, angs[i], i === 2 ? 0.3 : 0.36, 0.11);
        c = CasualArt.over(c, LeafColor(p, at, angs[i], i % 2 === 0 ? Leaf : Pal.hex(0x4cc85c)), CasualArt.fill(d, px));
      }
      const st = CasualArt.sdSegment(p, at, at.add(new V2(0.04, 0.2))) - 0.04;
      c = CasualArt.over(c, LeafDark, CasualArt.fill(st, px));
      break;
    }
    case 3: case 4: case 5: case 6: {
      const at = new V2(0.07, R + 0.06);
      const ang = tier === 5 ? 25 : 15;
      const d = LeafSd(p, at, ang, tier >= 5 ? 0.42 : 0.36, 0.12);
      c = CasualArt.over(c, LeafColor(p, at, ang, Leaf), CasualArt.fill(d, px));
      break;
    }
    case 7: { // pineapple crown
      const angs = [60, 75, 90, 105, 120];
      const lens = [0.26, 0.32, 0.38, 0.32, 0.26];
      for (let i = 0; i < angs.length; i++) {
        const at = new V2(0, R - 0.2);
        const d = LeafSd(p, at, angs[i], lens[i], 0.085);
        const lc = i % 2 === 0 ? Pal.hex(0x2e9e45) : Pal.hex(0x47c25a);
        c = CasualArt.over(c, LeafColor(p, at, angs[i], lc), CasualArt.fill(d, px));
      }
      break;
    }
    case 8: {
      const at = new V2(0.06, R + 0.12);
      const d = LeafSd(p, at, 160, 0.3, 0.1);
      c = CasualArt.over(c, LeafColor(p, at, 160, Leaf), CasualArt.fill(d, px));
      break;
    }
    case 9: {
      const at = new V2(0.06, R + 0.12);
      const d = LeafSd(p, at, 20, 0.34, 0.12);
      c = CasualArt.over(c, LeafColor(p, at, 20, Leaf), CasualArt.fill(d, px));
      break;
    }
  }
  return c;
}

// ------------------------------------------------------------------ scene

/** Glass jar front (walls + floor). Inner width/height and wall thickness are in world units. */
function JarFront(innerW: number, innerH: number, wall: number) {
  const W = innerW + wall * 2, H = innerH + wall;
  const w = 512, h = Mathf.roundToInt((512 * H) / W);
  const k = W * 0.5; // world units per p-unit
  return CasualArt.make(`ff-jar-${innerW}-${innerH}-${wall}`, w, h, (p) => {
    const u = p.mul(k);
    const px = (2 / w) * k;
    const outer = CasualArt.sdBox(u, new V2(W * 0.5, H * 0.5), wall * 1.4);
    const inner = CasualArt.sdBox(u.sub(new V2(0, wall + 1)), new V2(innerW * 0.5, H * 0.5 + 1), wall * 0.6);
    const d = Math.max(outer, -inner);
    const a = CasualArt.fill(d, px);
    if (a <= 0) return new Color(1, 1, 1, 0);
    // glass: pale blue, brighter towards the edges of each wall, a long highlight streak on the left wall
    const depth = Mathf.clamp01(-d / wall);
    let col = Color.lerp(new Color(0.86, 0.96, 1, 0.95), new Color(0.62, 0.84, 0.96, 0.75), CasualArt.smooth(0, 0.6, depth));
    const streak = CasualArt.smooth(0.08, 0, Math.abs(u.x + W * 0.5 - wall * 0.45)) * CasualArt.smooth(-H * 0.45, -H * 0.2, u.y);
    col = Color.lerp(col, Color.white, streak * 0.9);
    const streak2 = CasualArt.smooth(0.05, 0, Math.abs(u.x - W * 0.5 + wall * 0.4)) * 0.6;
    col = Color.lerp(col, Color.white, streak2);
    const edge = CasualArt.fill(d + 0.05, px);
    col = Color.lerp(new Color(0.42, 0.62, 0.8, 1), col, edge);
    return col.withAlpha(col.a * a);
  });
}

export const FruitFusionArt = {
  Tiers,
  BodyFrac,
  Names,
  Skin,
  Juice,
  Fruit,
  JarFront,

  /** Faint glass back wall (behind the fruit). */
  get JarBack() {
    return CasualArt.make("ff-jarback", 64, 64, (p) => {
      const a = 0.22 + 0.1 * CasualArt.smooth(1, -1, p.y);
      const sheen = CasualArt.smooth(0.25, 0, Math.abs(p.x + 0.55)) * 0.25;
      return new Color(1, 1, 1, a + sheen);
    });
  },

  /** Wooden counter, 1 unit wide and 0.25 tall: tile it across the screen. */
  get Counter() {
    return CasualArt.make("ff-counter", 256, 64, (p) => {
      const y = p.y / 0.25; // -1..1
      const top = Pal.hex(0xe5a866), body = Pal.hex(0xc9834a), dark = Pal.hex(0x9a5c2e);
      let c = y > 0.55 ? Color.lerp(top, CasualArt.lighten(top, 0.3), CasualArt.smooth(0.55, 1, y)) : body;
      const grain = Math.sin(p.x * 18 + Math.sin(p.y * 40 + p.x * 3) * 1.5) * 0.5 + 0.5;
      c = Color.lerp(c, dark, grain * 0.12);
      const seam = CasualArt.smooth(0.03, 0, Math.abs(Mathf.repeat(p.x + 1, 1) - 0.5));
      if (y < 0.5) c = Color.lerp(c, dark, seam * 0.4);
      c = Color.lerp(c, dark, CasualArt.smooth(0.6, 0.45, y) * CasualArt.smooth(0.35, 0.45, y) * 0.6);
      c = Color.lerp(c, dark, CasualArt.smooth(-0.6, -1, y) * 0.5);
      return c.withAlpha(1);
    });
  },

  /** Kitchen wallpaper: soft gingham. */
  get Wallpaper() {
    return CasualArt.make("ff-wall", 128, 128, (p) => {
      const baseC = Pal.hex(0xfff1dc);
      const sx = Mathf.repeat(p.x * 2, 1) < 0.5 ? 1 : 0, sy = Mathf.repeat(p.y * 2, 1) < 0.5 ? 1 : 0;
      const stripes = (sx + sy) * 0.5;
      const c = Color.lerp(baseC, Pal.hex(0xffd9c2), stripes * 0.7);
      return c.withAlpha(1);
    });
  },

  /** Dashed danger line. */
  get Dash() {
    return CasualArt.make("ff-dash", 64, 16, (p) => {
      const on = Mathf.repeat(p.x * 2, 1) < 0.6 ? 1 : 0;
      return new Color(1, 1, 1, on * CasualArt.fill(Math.abs(p.y) - 0.1, 2 / 64));
    });
  },
};
