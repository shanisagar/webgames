import { CasualArt, Color, Mathf, Pal, Sprite, V2 } from "../../kit";

/**
 * Procedural art for FRUIT SLICE: glossy whole fruits, cut-face halves (flesh, seeds, rind), juice splats, the bomb,
 * blade swatches and the unlockable backgrounds. Every sprite is baked once from signed distances and cached.
 */

export enum Kind { Apple, Orange, Lemon, Melon, Kiwi, Plum, Peach, Frost, Star, Dragon, Bomb }
export const NormalKinds = [Kind.Apple, Kind.Orange, Kind.Lemon, Kind.Melon, Kind.Kiwi, Kind.Plum, Kind.Peach];
export const isSpecial = (k: Kind) => k === Kind.Frost || k === Kind.Star || k === Kind.Dragon;

interface FruitLook { skin: Color; skin2: Color; flesh: Color; flesh2: Color; juice: Color; radius: number; stretch: number; name: string }

const C = (h: number) => Pal.hex(h);

export const Looks: Record<Kind, FruitLook> = {
  [Kind.Apple]: { skin: C(0xe8323c), skin2: C(0xff8a5c), flesh: C(0xfff3c9), flesh2: C(0x6b3a1e), juice: C(0xfff0a8), radius: 0.56, stretch: 1, name: "APPLE" },
  [Kind.Orange]: { skin: C(0xff8c1a), skin2: C(0xffb347), flesh: C(0xffa51f), flesh2: C(0xfff1c2), juice: C(0xffa020), radius: 0.56, stretch: 1, name: "ORANGE" },
  [Kind.Lemon]: { skin: C(0xffe03a), skin2: C(0xfff59a), flesh: C(0xfff27a), flesh2: C(0xfffbe0), juice: C(0xfff04a), radius: 0.5, stretch: 0.78, name: "LEMON" },
  [Kind.Melon]: { skin: C(0x2f9e44), skin2: C(0x1b6b2a), flesh: C(0xff3d5a), flesh2: C(0x1a1a1a), juice: C(0xff3352), radius: 0.8, stretch: 0.86, name: "MELON" },
  [Kind.Kiwi]: { skin: C(0x8a5a32), skin2: C(0xa8774a), flesh: C(0x8ad334), flesh2: C(0x1f2a10), juice: C(0x9ee04a), radius: 0.46, stretch: 0.84, name: "KIWI" },
  [Kind.Plum]: { skin: C(0x7a2a8c), skin2: C(0xb05cc4), flesh: C(0xffc845), flesh2: C(0x8a4a1c), juice: C(0xc04ad6), radius: 0.46, stretch: 1, name: "PLUM" },
  [Kind.Peach]: { skin: C(0xffa26b), skin2: C(0xff5e6c), flesh: C(0xffc34a), flesh2: C(0x9b3b22), juice: C(0xffb35c), radius: 0.54, stretch: 1, name: "PEACH" },
  [Kind.Frost]: { skin: C(0x59d8ff), skin2: C(0xe8fbff), flesh: C(0xcff4ff), flesh2: C(0x59c8ff), juice: C(0x8fe8ff), radius: 0.52, stretch: 1, name: "FROSTBERRY" },
  [Kind.Star]: { skin: C(0xffc21a), skin2: C(0xfff07a), flesh: C(0xfff07a), flesh2: C(0xffb000), juice: C(0xffe14a), radius: 0.58, stretch: 1, name: "STARFRUIT" },
  [Kind.Dragon]: { skin: C(0xff2e8a), skin2: C(0x6fdc4a), flesh: C(0xfffaf4), flesh2: C(0x1a1a1a), juice: C(0xff5aa8), radius: 0.56, stretch: 0.92, name: "DRAGONFRUIT" },
  [Kind.Bomb]: { skin: C(0x22252e), skin2: C(0x50586a), flesh: C(0x222222), flesh2: C(0x111111), juice: C(0xff4a2a), radius: 0.5, stretch: 1, name: "BOMB" },
};

// ------------------------------------------------------------------ noise

function hash(x: number, y: number, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise(x: number, y: number, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return Mathf.lerp(Mathf.lerp(a, b, u), Mathf.lerp(c, d, u), v);
}

const fill = CasualArt.fill, smooth = CasualArt.smooth;

/** Lit sphere colour for unit-sphere coordinates q (|q| ≤ 1). */
function shade(base: Color, qx: number, qy: number, gloss = 0.8) {
  const z = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy));
  const diff = Math.max(0, (qx * -0.45 + qy * 0.6 + z * 0.66) / 1.0);
  let c = base.mul(0.5 + 0.62 * diff).withAlpha(1);
  c = Color.lerp(c, CasualArt.darken(base, 0.5), smooth(0.75, 1, Math.hypot(qx, qy)) * 0.55);
  const spec = smooth(0.32, 0, Math.hypot((qx + 0.38) * 1.1, (qy - 0.45) * 1.5));
  c = Color.lerp(c, Color.white, spec * gloss);
  // soft rim light from below
  c = Color.lerp(c, CasualArt.lighten(base, 0.35), smooth(0.8, 1, Math.hypot(qx, qy)) * smooth(-0.2, -0.9, qy) * 0.35);
  return c;
}

// ------------------------------------------------------------------ fruits

const R = 0.9; // fruit radius inside the sprite

export const FruitArt = {
  Whole(k: Kind): Sprite {
    const L = Looks[k];
    return CasualArt.make("fs-whole-" + k, 160, 160, (p) => {
      const px = 2 / 160;
      if (k === Kind.Bomb) return bombPixel(p, px);
      if (k === Kind.Star) return starPixel(p, px);
      const sx = 1, sy = L.stretch;
      let q = new V2(p.x / (R * sx), p.y / (R * sy));
      if (k === Kind.Lemon) q = new V2(q.x * (1 + 0.12 * Math.max(0, Math.abs(q.x) - 0.5)), q.y * (1 + 0.5 * q.x * q.x));
      if (k === Kind.Apple) q = new V2(q.x, q.y + 0.12 * Math.exp(-q.x * q.x * 30) * smooth(0.2, 1, q.y));
      if (k === Kind.Peach) q = new V2(q.x * 1.02, q.y);
      const r = q.magnitude;
      const a = fill((r - 1) * R, px);
      let col = Color.clear;
      if (a > 0) {
        let base = L.skin;
        switch (k) {
          case Kind.Apple: base = Color.lerp(L.skin, L.skin2, smooth(0.2, 0.9, -q.y + q.x * 0.3) * 0.45); break;
          case Kind.Orange: base = L.skin.mul(0.94 + 0.12 * noise(p.x * 22, p.y * 22, 2)).withAlpha(1); break;
          case Kind.Melon: {
            const stripe = Math.sin(Math.atan2(q.y, q.x * 0.6) * 9 + noise(p.x * 6, p.y * 6, 5) * 2.4);
            base = Color.lerp(L.skin, L.skin2, smooth(0.2, 0.6, stripe));
            break;
          }
          case Kind.Kiwi: base = L.skin.mul(0.85 + 0.3 * noise(p.x * 40, p.y * 40, 7)).withAlpha(1); break;
          case Kind.Plum: base = Color.lerp(L.skin, L.skin2, smooth(0.3, 1, q.x * 0.5 + q.y * 0.5) * 0.3); break;
          case Kind.Peach: {
            base = Color.lerp(L.skin, L.skin2, smooth(-0.2, 0.8, q.x - q.y * 0.4) * 0.65);
            const crease = Math.abs(q.x - 0.25 * Math.sin(q.y * 2)) - 0.03;
            base = Color.lerp(base, CasualArt.darken(base, 0.25), fill(crease, 0.06) * smooth(1, 0.2, r));
            break;
          }
          case Kind.Frost: {
            const facet = Math.abs(Math.sin(Math.atan2(q.y, q.x) * 3 + r * 4));
            base = Color.lerp(L.skin, L.skin2, facet * 0.35 + 0.2 * noise(p.x * 9, p.y * 9, 3));
            break;
          }
          case Kind.Dragon: {
            // scales: green-tipped flames over magenta
            const ang = Math.atan2(q.y, q.x), sc = Math.sin(ang * 7 + r * 7) * Math.sin(r * 9);
            base = Color.lerp(L.skin, CasualArt.lighten(L.skin, 0.3), smooth(0.4, 0.9, sc) * 0.6);
            break;
          }
        }
        col = shade(base, q.x, q.y, k === Kind.Melon || k === Kind.Kiwi ? 0.35 : 0.85);
        if (k === Kind.Frost) col = Color.lerp(col, Color.white, smooth(0.25, 0, Math.abs(Math.abs(q.x) - Math.abs(q.y)) + r * 0.4) * 0.5);
        col = col.withAlpha(a);
      }
      // dragonfruit leaf tips around the rim
      if (k === Kind.Dragon) {
        for (let i = 0; i < 7; i++) {
          const ang = (i / 7) * Math.PI * 2 + 0.3, dir = new V2(Math.cos(ang), Math.sin(ang) * L.stretch);
          const tip = dir.mul(R * 1.02), d = CasualArt.sdSegment(p, dir.mul(R * 0.75), tip) - 0.07 * smooth(R * 1.05, R * 0.7, p.magnitude);
          const la = fill(d, px);
          if (la > 0) col = CasualArt.over(col, Color.lerp(L.skin2, CasualArt.lighten(L.skin2, 0.4), smooth(0.7, 1, p.magnitude)), la);
        }
      }
      // stems and leaves
      if (k === Kind.Apple || k === Kind.Peach || k === Kind.Plum || k === Kind.Orange) {
        const top = new V2(0, R * L.stretch * 0.86);
        const stem = CasualArt.sdSegment(p, top, top.add(new V2(0.06, 0.16))) - 0.035;
        if (k !== Kind.Orange) col = CasualArt.over(col, C(0x5a3a1c), fill(stem, px));
        const lc = top.add(new V2(0.2, 0.13));
        const lq = new V2((p.x - lc.x) * 0.8 + (p.y - lc.y) * 0.6, (-(p.x - lc.x) * 0.6 + (p.y - lc.y) * 0.8) * 2.3);
        const leaf = lq.magnitude - 0.17;
        const leafCol = Color.lerp(C(0x3fae49), C(0x8be05a), smooth(-0.1, 0.1, lq.y));
        col = CasualArt.over(col, leafCol, fill(leaf, px) * (k === Kind.Orange ? 0.9 : 1));
      }
      return col;
    });
  },

  /** Cut half: the flesh face lies in y ≥ 0, cut edge on y = 0 through the sprite centre. */
  Half(k: Kind): Sprite {
    const L = Looks[k];
    return CasualArt.make("fs-half-" + k, 160, 160, (p) => {
      const px = 2 / 160;
      const sy = k === Kind.Star ? 1 : L.stretch;
      const q = new V2(p.x / R, p.y / (R * sy * 0.92));
      const r = q.magnitude;
      if (p.y < -0.02) return Color.clear;
      const a = fill((r - 1) * R, px) * fill(-p.y, px);
      if (a <= 0) return Color.clear;
      const rindW = k === Kind.Melon ? 0.2 : k === Kind.Orange || k === Kind.Lemon ? 0.12 : k === Kind.Dragon ? 0.1 : 0.07;
      let col = L.flesh;
      const ang = Math.atan2(q.y, q.x);
      switch (k) {
        case Kind.Apple: {
          col = Color.lerp(L.flesh, C(0xfff9e6), smooth(0.9, 0.2, r) * 0.6);
          const core = new V2(q.x * 1.3, q.y * 1.1).magnitude - 0.33;
          col = Color.lerp(col, C(0xf3dfa0), fill(core, 0.08) * 0.8);
          for (const sx of [-0.12, 0.12]) col = Color.lerp(col, L.flesh2, fill(new V2((q.x - sx) * 2.2, (q.y - 0.18) * 1.2).magnitude - 0.18, 0.04));
          break;
        }
        case Kind.Orange: case Kind.Lemon: {
          const seg = Math.abs(Math.sin(ang * 5)) * r;
          col = Color.lerp(L.flesh, L.flesh2, fill(seg - 0.035, 0.03) * 0.9);
          col = Color.lerp(col, L.flesh2, fill(r - 0.1, 0.05));
          col = Color.lerp(col, CasualArt.lighten(col, 0.3), noise(p.x * 30, p.y * 30, 4) * 0.3);
          break;
        }
        case Kind.Melon: {
          col = Color.lerp(L.flesh, CasualArt.lighten(L.flesh, 0.2), smooth(0.7, 0, r) * 0.4);
          for (let i = 0; i < 7; i++) {
            const sa = 0.3 + i * 0.4, sr = 0.5 + 0.12 * (i % 2);
            const s = new V2(Math.cos(sa) * sr, Math.sin(sa) * sr);
            const d = new V2((q.x - s.x) * 3, (q.y - s.y) * 1.8).magnitude - 0.14;
            col = Color.lerp(col, L.flesh2, fill(d, 0.06));
          }
          break;
        }
        case Kind.Kiwi: {
          col = Color.lerp(L.flesh, CasualArt.lighten(L.flesh, 0.35), smooth(0.6, 0.1, r));
          col = Color.lerp(col, C(0xf4f7d8), fill(r - 0.22, 0.06));
          const ring = Math.abs(r - 0.36) - 0.07;
          const seeds = smooth(0.55, 0.85, Math.sin(ang * 24));
          col = Color.lerp(col, L.flesh2, fill(ring, 0.04) * seeds);
          // fine rays
          col = Color.lerp(col, CasualArt.lighten(L.flesh, 0.25), smooth(0.8, 1, Math.sin(ang * 40)) * smooth(0.25, 0.5, r) * 0.4);
          break;
        }
        case Kind.Plum: case Kind.Peach: {
          col = Color.lerp(L.flesh, CasualArt.lighten(L.flesh, 0.3), smooth(0.9, 0.3, r) * 0.5);
          col = Color.lerp(col, C(0xff6a3d), smooth(0.6, 0.95, r) * 0.35);
          const pit = new V2(q.x * 1.6, q.y * 1.1).magnitude - 0.3;
          col = Color.lerp(col, L.flesh2.mul(0.9 + 0.2 * noise(p.x * 25, p.y * 25, 9)).withAlpha(1), fill(pit, 0.05));
          break;
        }
        case Kind.Frost: {
          col = Color.lerp(L.flesh, Color.white, smooth(0.8, 0, r) * 0.6);
          const flake = Math.min(Math.abs(Math.sin(ang * 3)) * r, Math.abs(r - 0.5) + 0.02);
          col = Color.lerp(col, L.flesh2, fill(flake - 0.03, 0.03) * 0.7);
          break;
        }
        case Kind.Star: {
          const st = CasualArt.sdStar(new V2(q.x, q.y - 0.05), 0.65, 0.5);
          col = Color.lerp(L.flesh, L.flesh2, fill(-st - 0.08, 0.04) * 0.5);
          col = Color.lerp(col, C(0xffffff), fill(r - 0.12, 0.04) * 0.6);
          break;
        }
        case Kind.Dragon: {
          col = L.flesh;
          const sp = hash(Math.floor(p.x * 26), Math.floor(p.y * 26), 3);
          const cell = new V2(p.x * 26 - Math.floor(p.x * 26) - 0.5, p.y * 26 - Math.floor(p.y * 26) - 0.5).magnitude;
          if (sp > 0.7) col = Color.lerp(col, L.flesh2, fill(cell - 0.18, 0.15));
          break;
        }
        case Kind.Bomb: col = C(0x222222); break;
      }
      // rind / skin ring
      const rind = smooth(1 - rindW - 0.02, 1 - rindW + 0.02, r);
      let skin = k === Kind.Melon ? Color.lerp(C(0xd8f5c2), L.skin, smooth(1 - rindW * 0.6, 1 - rindW * 0.2, r)) : L.skin;
      if (k === Kind.Orange || k === Kind.Lemon) skin = Color.lerp(C(0xfff6e0), L.skin, smooth(1 - rindW * 0.5, 1 - rindW * 0.2, r));
      col = Color.lerp(col, skin, rind);
      // wet shine and darker cut edge
      col = Color.lerp(col, Color.white, smooth(0.25, 0, Math.hypot((q.x + 0.35) * 0.9, (q.y - 0.55) * 2.2)) * 0.35);
      col = Color.lerp(col, CasualArt.darken(col, 0.3), smooth(0.07, 0, p.y));
      return col.withAlpha(a);
    });
  },

  /** Blobby juice splash (white, tint it). */
  Splat(v: number): Sprite {
    return CasualArt.make("fs-splat-" + v, 128, 128, (p) => {
      const px = 2 / 128;
      const ang = Math.atan2(p.y, p.x);
      let d = p.magnitude - (0.42 + 0.12 * Math.sin(ang * 5 + v * 2) + 0.06 * Math.sin(ang * 11 + v));
      for (let i = 0; i < 9; i++) {
        const a = hash(i, v, 1) * Math.PI * 2, rr = 0.55 + hash(i, v, 2) * 0.38, s = 0.05 + hash(i, v, 3) * 0.08;
        d = Math.min(d, CasualArt.sdCircle(p, new V2(Math.cos(a) * rr, Math.sin(a) * rr), s));
        const streak = CasualArt.sdSegment(p, new V2(Math.cos(a) * 0.3, Math.sin(a) * 0.3), new V2(Math.cos(a) * rr * 0.9, Math.sin(a) * rr * 0.9)) - s * 0.45;
        d = Math.min(d, streak);
      }
      const a = fill(d, px);
      const inner = smooth(0.1, -0.25, d);
      return new Color(1, 1, 1, a * (0.75 + 0.25 * inner));
    });
  },

  /** Little teardrop for flying juice. */
  get Drop() {
    return CasualArt.make("fs-drop", 48, 48, (p) => {
      const d = Math.min(p.magnitude - 0.55, CasualArt.sdSegment(p, V2.zero, new V2(-0.85, 0)) - 0.55 * smooth(-0.9, 0, p.x));
      const hl = smooth(0.3, 0, Math.hypot(p.x - 0.15, p.y - 0.2));
      const c = Color.lerp(new Color(0.92, 0.92, 0.92, 1), Color.white, hl);
      return c.withAlpha(fill(d, 2 / 48));
    });
  },

  get BombGlow() {
    return CasualArt.make("fs-bombglow", 64, 64, (p) => {
      const r = p.magnitude;
      return new Color(1, 1, 1, Math.pow(Mathf.clamp01(1 - r), 1.6) * 0.9);
    });
  },

  /** A white X for the lives display. */
  get Cross() {
    return CasualArt.make("fs-cross", 64, 64, (p) => {
      const d = Math.min(CasualArt.sdSegment(p, new V2(-0.62, -0.62), new V2(0.62, 0.62)), CasualArt.sdSegment(p, new V2(-0.62, 0.62), new V2(0.62, -0.62))) - 0.2;
      return new Color(1, 1, 1, fill(d, 2 / 64));
    });
  },

  /** Hexagonal ice crystal overlay for the freeze effect. */
  get Frost() {
    return CasualArt.make("fs-frostfx", 128, 128, (p) => {
      const r = p.magnitude, ang = Math.atan2(p.y, p.x);
      const arm = Math.abs(Math.sin(ang * 3)) * r;
      const d = Math.min(arm - 0.03, Math.abs(r - 0.6) - 0.02);
      return new Color(1, 1, 1, fill(d, 0.03) * smooth(0.95, 0.5, r));
    });
  },
};

function bombPixel(p: V2, px: number) {
  const L = Looks[Kind.Bomb];
  const q = p.div(R * 0.92);
  const r = q.magnitude;
  let col = Color.clear;
  const a = fill((r - 1) * R * 0.92, px);
  if (a > 0) {
    col = shade(L.skin, q.x, q.y, 0.9).withAlpha(a);
    // red warning band
    const band = Math.abs(q.y + 0.1 + 0.08 * q.x) - 0.1;
    col = Color.lerp(col, shade(C(0xe8323c), q.x, q.y, 0.4), fill(band, 0.05) * 0.85 * a);
  }
  // cap and fuse
  const cap = CasualArt.sdBox(p.sub(new V2(0.18, 0.72)), new V2(0.16, 0.1), 0.03);
  col = CasualArt.over(col, Color.lerp(C(0x8a93a6), C(0xd8dee9), smooth(0.65, 0.8, p.y)), fill(cap, px));
  let fuse = 1e9;
  for (let i = 0; i < 6; i++) {
    const t0 = i / 6, t1 = (i + 1) / 6;
    const f = (t: number) => new V2(0.22 + t * 0.32 + 0.06 * Math.sin(t * 7), 0.8 + t * 0.12 + 0.05 * Math.sin(t * 9));
    fuse = Math.min(fuse, CasualArt.sdSegment(p, f(t0), f(t1)));
  }
  col = CasualArt.over(col, C(0xc8a36a), fill(fuse - 0.03, px));
  return col;
}

function starPixel(p: V2, px: number) {
  const L = Looks[Kind.Star];
  const d = CasualArt.sdStar(new V2(p.x, p.y + 0.05), R * 0.98, 0.55) - 0.06;
  const a = fill(d, px);
  if (a <= 0) return Color.clear;
  const q = p.div(R);
  let col = shade(L.skin, q.x * 0.8, q.y * 0.8, 0.9);
  const ridge = Math.abs(Math.sin(Math.atan2(p.y + 0.05, p.x) * 5 - Math.PI / 2)) ;
  col = Color.lerp(col, CasualArt.lighten(L.skin, 0.4), smooth(0.9, 1, ridge) * 0.4);
  col = Color.lerp(col, CasualArt.darken(L.skin, 0.25), smooth(-0.02, -0.12, d) * 0);
  return col.withAlpha(a);
}

// ------------------------------------------------------------------ blades and backgrounds

export interface BladeStyle { name: string; core: Color; glow: Color; cost: number; rainbow?: boolean }
export const Blades: BladeStyle[] = [
  { name: "CLASSIC", core: Color.white, glow: C(0x5ad7ff), cost: 0 },
  { name: "EMBER", core: C(0xfff3a0), glow: C(0xff6a1a), cost: 4 },
  { name: "FROST", core: C(0xf2feff), glow: C(0x7ab8ff), cost: 10 },
  { name: "VENOM", core: C(0xeaffc4), glow: C(0x52e04a), cost: 16 },
  { name: "ROYAL", core: C(0xffe9a8), glow: C(0xa04aff), cost: 24 },
  { name: "PRISM", core: Color.white, glow: C(0xff5ad7), cost: 35, rainbow: true },
];

export interface BgStyle { name: string; cost: number; tint: Color }
export const Backgrounds: BgStyle[] = [
  { name: "TIMBER", cost: 0, tint: C(0xffc98a) },
  { name: "LAGOON", cost: 6, tint: C(0x7ff0e6) },
  { name: "NIGHT MARKET", cost: 14, tint: C(0xffa0d0) },
  { name: "NEON GRID", cost: 22, tint: C(0x9ae6ff) },
];

export const BgArt = {
  Cover(i: number): Sprite { return CasualArt.make("fs-bg-" + i, 128, 256, (p) => bgPixel(i, p)); },
  /** Landscape thumbnail of the middle of a background (shop preview). */
  Thumb(i: number): Sprite { return CasualArt.make("fs-bgt-" + i, 160, 64, (p) => bgPixel(i, new V2(p.x, p.y * 2.6))); },
};

function bgPixel(i: number, p: V2): Color {
      const t = (p.y + 2) / 4; // 0 bottom → 1 top
      switch (i) {
        case 1: {
          let c = Color.lerp(C(0x0b4a6e), C(0x29b6c8), smooth(0, 1, t));
          const wave = Math.sin(p.x * 3 + p.y * 9 + Math.sin(p.x * 2) * 1.5) * 0.5 + 0.5;
          c = Color.lerp(c, C(0x6be3e0), smooth(0.85, 1, wave) * 0.18);
          const caustic = noise(p.x * 6, p.y * 6, 21) * noise(p.x * 9 + 3, p.y * 9, 22);
          c = Color.lerp(c, Color.white, smooth(0.35, 0.6, caustic) * 0.12 * t);
          const sun = Math.exp(-((p.x - 0.3) * (p.x - 0.3) * 3 + (p.y - 1.7) * (p.y - 1.7) * 2));
          return Color.lerp(c, C(0xd8fff6), sun * 0.35).withAlpha(1);
        }
        case 2: {
          let c = Color.lerp(C(0x1a0b2e), C(0x4a1f5e), smooth(0, 1, t));
          for (let k = 0; k < 14; k++) {
            const cx = hash(k, 1, 31) * 2 - 1, cy = hash(k, 2, 31) * 4 - 2, rr = 0.08 + hash(k, 3, 31) * 0.18;
            const g = Math.exp(-(((p.x - cx) ** 2 + (p.y - cy) ** 2) / (rr * rr)));
            const lc = k % 3 === 0 ? C(0xff8a3d) : k % 3 === 1 ? C(0xff4fa3) : C(0xffd25a);
            c = Color.lerp(c, lc, g * 0.32);
          }
          // string of lanterns
          const sy = 1.35 + 0.18 * Math.cos(p.x * 2.4);
          c = Color.lerp(c, C(0x0d0618), fill(Math.abs(p.y - sy) - 0.012, 0.01) * 0.8);
          for (let k = -2; k <= 2; k++) {
            const lx = k * 0.42, ly = 1.35 + 0.18 * Math.cos(lx * 2.4) - 0.12;
            const d = new V2((p.x - lx) * 1.2, (p.y - ly)).magnitude - 0.09;
            c = Color.lerp(c, C(0xff6a3d), fill(d, 0.02));
            c = Color.lerp(c, C(0xffb36a), Math.exp(-((p.x - lx) ** 2 + (p.y - ly) ** 2) * 30) * 0.5);
          }
          return c.withAlpha(1);
        }
        case 3: {
          let c = Color.lerp(C(0x0a0420), C(0x2a0b4a), smooth(0, 1, t));
          const hz = -0.2;
          if (p.y < hz) {
            const depth = 1 / Math.max(0.05, hz - p.y + 0.15);
            const gx = Math.abs(((p.x * depth * 0.5) % 0.5 + 0.75) % 0.5 - 0.25);
            const gy = Math.abs(((depth * 0.6) % 1 + 1) % 1 - 0.5);
            const line = Math.min(gx * 6 / depth, gy * 3);
            c = Color.lerp(c, C(0xff3df0), fill(line - 0.05, 0.06) * 0.6 * smooth(hz, hz - 1.4, p.y) + 0.0);
          } else {
            const sun = new V2(p.x, p.y - 0.6).magnitude;
            const bands = p.y < 0.6 && Math.sin(p.y * 40) > 0.3 ? 0.35 : 1;
            c = Color.lerp(c, Color.lerp(C(0xff3d8a), C(0xffd23d), smooth(0.2, 1.1, p.y)), fill(sun - 0.55, 0.02) * bands * 0.85);
            for (let k = 0; k < 40; k++) {
              const sx = hash(k, 7, 41) * 2 - 1, sy2 = hash(k, 8, 41) * 2;
              c = Color.lerp(c, Color.white, fill(new V2(p.x - sx, p.y - sy2).magnitude - 0.008, 0.01) * 0.8);
            }
          }
          c = Color.lerp(c, C(0x5ad7ff), Math.exp(-(p.y - hz) * (p.y - hz) * 120) * 0.5);
          return c.withAlpha(1);
        }
        default: {
          // warm wooden planks
          const plank = Math.floor((p.x + 1) * 2.5);
          const lx = (p.x + 1) * 2.5 - plank;
          const tone = 0.85 + 0.15 * hash(plank, 0, 11);
          const grain = noise(p.x * 3 + plank * 7, p.y * 28 + noise(p.x * 4, p.y * 2, 12) * 3, 13);
          let c = Color.lerp(C(0x8a4f22), C(0xc7843f), grain * 0.6 + 0.2).mul(tone).withAlpha(1);
          const knot = new V2((p.x - (hash(plank, 1, 11) * 0.3 - 0.15 + (plank / 2.5 - 1) + 0.2)) * 4, (p.y - (hash(plank, 2, 11) * 3 - 1.5)) * 1.5).magnitude;
          c = Color.lerp(c, C(0x5a2f12), smooth(0.35, 0.1, knot) * 0.6);
          c = Color.lerp(c, C(0x3a1c08), smooth(0.06, 0, Math.min(lx, 1 - lx)) * 0.85);
          c = Color.lerp(c, C(0xffd9a0), smooth(0.1, 0.02, Math.abs(lx - 0.12)) * 0.12);
          const vig = smooth(0.6, 2.4, Math.hypot(p.x * 1.4, p.y * 0.7));
          return CasualArt.darken(c, vig * 0.5).withAlpha(1);
        }
      }
}
