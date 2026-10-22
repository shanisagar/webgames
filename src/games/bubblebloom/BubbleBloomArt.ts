import { CasualArt, Color, Mathf, Pal, Sprite, V2 } from "../../kit";

/**
 * Procedural art for Bubble Bloom: glossy bubbles with a colour-blind-friendly symbol in each colour, the bud
 * overlay, blooming flowers, the flower-pot launcher, the leafy ceiling vine and the garden backdrop.
 * (Port of BubbleBloomArt.cs.)
 */

const Colors = 6;

const Tint = [
  Pal.hex(0xff4d6d), Pal.hex(0xff9f1c), Pal.hex(0xffe04a), Pal.hex(0x54cf5a), Pal.hex(0x3fa2f5), Pal.hex(0xa66cff),
];

const Names = ["RED", "ORANGE", "YELLOW", "GREEN", "BLUE", "PURPLE"];

const Clear = new Color(1, 1, 1, 0);

function BubblePixel(p: V2, color: number, px: number) {
  const baseC = Tint[color];
  let c = CasualArt.ballPixel(p, baseC, px, 0.93);
  if (c.a <= 0) return c;
  // dark rim for separation
  const d = p.magnitude - 0.93;
  c = Color.lerp(CasualArt.darken(baseC, 0.45), c, CasualArt.fill(d + 0.06, px));
  // symbol
  const s = Symbol(color, p.mul(1.0));
  const sym = CasualArt.lighten(baseC, 0.75);
  c = Color.lerp(c, sym, CasualArt.fill(s, px) * 0.85);
  return c;
}

/** Signed distance of each colour's symbol (heart, star, sun, leaf, drop, moon). */
function Symbol(color: number, p: V2): number {
  switch (color) {
    case 0: { // heart
      const q = new V2(Math.abs(p.x), p.y + 0.36).div(0.72);
      let d: number;
      if (q.y + q.x > 1) d = q.sub(new V2(0.25, 0.75)).magnitude - 0.35355;
      else {
        const m = 0.5 * Math.max(q.x + q.y, 0);
        const d1 = q.sub(new V2(0, 1)).sqrMagnitude, d2 = q.sub(new V2(m, m)).sqrMagnitude;
        d = Math.sqrt(Math.min(d1, d2)) * Mathf.sign(q.x - q.y);
      }
      return d * 0.72;
    }
    case 1: return CasualArt.sdStar(p, 0.42, 0.5);
    case 2: { // sun: disc + eight short rays
      let d = p.magnitude - 0.2;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const dir = new V2(Math.cos(a), Math.sin(a));
        d = Math.min(d, CasualArt.sdSegment(p, dir.mul(0.29), dir.mul(0.4)) - 0.045);
      }
      return d;
    }
    case 3: { // leaf
      const q = new V2((p.x + p.y) * 0.7071, (p.y - p.x) * 0.7071);
      const half = 0.17 * Math.sqrt(Math.max(0, 1 - (q.x / 0.42) * (q.x / 0.42)));
      return Math.max(Math.abs(q.y) - half, Math.abs(q.x) - 0.42);
    }
    case 4: { // drop
      const circle = CasualArt.sdCircle(p, new V2(0, -0.1), 0.24);
      const tip = Math.max(Math.abs(p.x) - (0.4 - (p.y + 0.1)) * 0.55, Math.max(-(p.y + 0.1), p.y - 0.38));
      return Math.min(circle, tip);
    }
    default: { // moon
      const a = CasualArt.sdCircle(p, V2.zero, 0.34);
      const b = CasualArt.sdCircle(p, new V2(0.17, 0.12), 0.3);
      return Math.max(a, -b);
    }
  }
}

export const BubbleBloomArt = {
  Colors,
  Tint,
  Names,

  Bubble(color: number): Sprite { return CasualArt.make("bb-bubble-" + color, 128, 128, (p) => BubblePixel(p, color, 2 / 128)); },

  get Rainbow() {
    return CasualArt.make("bb-rainbow", 128, 128, (p) => {
      const ang = Math.atan2(p.y, p.x) / (Math.PI * 2) + 0.5;
      const c = Color.HSVToRGB(Mathf.repeat(ang + p.magnitude * 0.3, 1), 0.55, 1);
      return CasualArt.ballPixel(p, c, 2 / 128, 0.93);
    });
  },

  get Bomb() {
    return CasualArt.make("bb-bomb", 128, 128, (p) => {
      const px = 2 / 128;
      let c = CasualArt.ballPixel(p.add(new V2(0, 0.08)), Pal.hex(0x3a3f55), px, 0.8);
      const fuse = CasualArt.sdSegment(p, new V2(0.35, 0.55), new V2(0.55, 0.85)) - 0.07;
      c = CasualArt.over(c, Pal.hex(0xc9a26b), CasualArt.fill(fuse, px));
      const spark = Math.max(0, 1 - p.sub(new V2(0.6, 0.9)).magnitude / 0.18);
      c = CasualArt.over(c, Pal.hex(0xffe066), spark);
      return c;
    });
  },

  /** Overlay for a bubble with a trapped flower bud (drawn on top of the bubble). */
  get Bud() {
    return CasualArt.make("bb-bud", 128, 128, (p) => {
      const px = 2 / 128;
      let c = Clear;
      // white frosted window
      c = CasualArt.over(c, new Color(1, 1, 1, 0.78), CasualArt.fill(p.magnitude - 0.58, px));
      // stem + leaves
      const stem = CasualArt.sdSegment(p, new V2(0, -0.45), new V2(0, 0.0)) - 0.05;
      c = CasualArt.over(c, Pal.hex(0x3da84a), CasualArt.fill(stem, px));
      const leaf = CasualArt.sdCircle(new V2((p.x - 0.14) / 1.8, p.y + 0.28), V2.zero, 0.07);
      c = CasualArt.over(c, Pal.hex(0x4cc85c), CasualArt.fill(leaf, px));
      // closed bud
      const b = p.sub(new V2(0, 0.12));
      const bud = new V2(b.x / 0.22, b.y / 0.3).magnitude - 1;
      const tipCut = b.y - 0.28 + Math.abs(b.x) * 1.2;
      const bd = Math.max(bud * 0.22, tipCut);
      const petal = Color.lerp(Pal.hex(0xff5c9a), Pal.hex(0xffa0c8), CasualArt.smooth(-0.2, 0.3, b.y + b.x));
      c = CasualArt.over(c, petal, CasualArt.fill(bd, px));
      const crease = Math.abs(b.x + b.y * 0.15) - 0.015;
      if (bd < 0) c = CasualArt.over(c, Pal.hex(0xe03a7a), CasualArt.fill(crease, px) * 0.6);
      return c;
    });
  },

  /** A bloomed flower (petals around a yellow centre). */
  Flower(variant: number): Sprite {
    const petal = variant % 3 === 0 ? Pal.hex(0xff6fa8) : variant % 3 === 1 ? Pal.hex(0xffffff) : Pal.hex(0xffb347);
    return CasualArt.make("bb-flower-" + (variant % 3), 128, 128, (p) => {
      const px = 2 / 128;
      const ang = Math.atan2(p.y, p.x);
      const r = p.magnitude;
      const petals = r - (0.55 + 0.38 * Math.pow(Math.abs(Math.cos(ang * 2.5)), 0.8));
      let c = Clear;
      const pc = Color.lerp(CasualArt.darken(petal, 0.12), petal, CasualArt.smooth(0.2, 0.8, r));
      c = CasualArt.over(c, CasualArt.darken(petal, 0.35), CasualArt.fill(petals, px));
      c = CasualArt.over(c, pc, CasualArt.fill(petals + 0.04, px));
      const vein = Math.abs(Math.sin(ang * 2.5)) * r;
      c = Color.lerp(c, CasualArt.darken(petal, 0.15), CasualArt.smooth(0.03, 0, vein) * CasualArt.fill(petals, px) * 0.6);
      const centre = r - 0.3;
      const cc = Color.lerp(Pal.hex(0xffc21a), Pal.hex(0xffe680), CasualArt.smooth(0.2, -0.3, p.y - p.x));
      c = CasualArt.over(c, Pal.hex(0xd98c0a), CasualArt.fill(centre, px));
      c = CasualArt.over(c, cc, CasualArt.fill(centre + 0.04, px));
      const dots = Math.sin(p.x * 30) * Math.sin(p.y * 30);
      if (centre < -0.04) c = Color.lerp(c, Pal.hex(0xd98c0a), CasualArt.smooth(0.6, 0.9, dots) * 0.6);
      return c;
    });
  },

  /** Terracotta flower pot that holds the launcher bubble (bubble sits on top). */
  get Pot() {
    return CasualArt.make("bb-pot", 192, 160, (p) => {
      const px = 2 / 192;
      let c = Clear;
      // pot body: trapezoid
      const y0 = -0.8, y1 = 0.2;
      const halfW = Mathf.lerp(0.5, 0.68, Mathf.clamp01((p.y - y0) / (y1 - y0)));
      let body = Math.max(Math.abs(p.x) - halfW, Math.max(y0 - p.y, p.y - y1));
      body = Math.max(body, CasualArt.sdBox(p.sub(new V2(0, -0.3)), new V2(0.75, 0.55), 0.08));
      const terra = Pal.hex(0xe07a45);
      const shade = Color.lerp(CasualArt.lighten(terra, 0.12), CasualArt.darken(terra, 0.25), CasualArt.smooth(-0.5, 0.6, p.x));
      c = CasualArt.over(c, CasualArt.darken(terra, 0.45), CasualArt.fill(body, px));
      c = CasualArt.over(c, shade, CasualArt.fill(body + 0.03, px));
      // rim
      const rim = CasualArt.sdBox(p.sub(new V2(0, 0.28)), new V2(0.8, 0.14), 0.07);
      const rc = Color.lerp(CasualArt.lighten(terra, 0.2), CasualArt.darken(terra, 0.15), CasualArt.smooth(-0.6, 0.7, p.x));
      c = CasualArt.over(c, CasualArt.darken(terra, 0.45), CasualArt.fill(rim, px));
      c = CasualArt.over(c, rc, CasualArt.fill(rim + 0.03, px));
      // cute face
      for (let s = -1; s <= 1; s += 2) {
        const e = CasualArt.sdCircle(p, new V2(0.2 * s, -0.18), 0.06);
        c = CasualArt.over(c, Pal.hex(0x3a1e12), CasualArt.fill(e, px));
        const g = CasualArt.sdCircle(p, new V2(0.2 * s - 0.02, -0.16), 0.02);
        c = CasualArt.over(c, Color.white, CasualArt.fill(g, px));
        const bl = CasualArt.sdCircle(new V2((p.x - 0.34 * s) / 1.5, p.y + 0.3), V2.zero, 0.05);
        c = CasualArt.over(c, Pal.hex(0xff8aa0), CasualArt.fill(bl, px) * 0.6);
      }
      const m = p.sub(new V2(0, -0.28));
      const smile = Math.abs(m.magnitude - 0.08) - 0.018;
      if (m.y < 0) c = CasualArt.over(c, Pal.hex(0x3a1e12), CasualArt.fill(smile, px));
      return c;
    });
  },

  /** Leafy vine for the ceiling, 1 unit wide × 0.25 tall, tile it. */
  get Vine() {
    return CasualArt.make("bb-vine", 256, 64, (p) => {
      const px = 2 / 256;
      let c = Clear;
      const y = p.y; // -0.25..0.25
      const stem = Math.abs(y - 0.06 * Math.sin(p.x * Math.PI * 2)) - 0.025;
      c = CasualArt.over(c, Pal.hex(0x2f8a3e), CasualArt.fill(stem, px));
      for (let i = 0; i < 4; i++) {
        const lx = -0.75 + i * 0.5;
        const dir = i % 2 === 0 ? 1 : -1;
        const q = new V2(p.x - lx, (p.y - 0.06 * Math.sin(lx * Math.PI * 2)) * dir + 0.0);
        const r = new V2(q.x * 0.8 + q.y * 0.6, -q.x * 0.6 + q.y * 0.8).sub(new V2(0.12, 0.06));
        const leaf = new V2(r.x / 0.16, r.y / 0.07).magnitude - 1;
        const lc = i % 2 === 0 ? Pal.hex(0x4cc85c) : Pal.hex(0x3db54a);
        c = CasualArt.over(c, CasualArt.darken(lc, 0.3), CasualArt.fill(leaf * 0.07, px));
        c = CasualArt.over(c, lc, CasualArt.fill(leaf * 0.07 + 0.012, px));
      }
      return c;
    });
  },

  /** Garden backdrop: sky, clouds and rolling hills (portrait, stretch to cover). */
  get Garden() {
    return CasualArt.make("bb-garden", 256, 512, (p) => {
      const y = p.y; // -2..2
      const sky = Color.lerp(Pal.hex(0xbfe9ff), Pal.hex(0x7ccbf5), CasualArt.smooth(-0.5, 2, y));
      let c = sky;
      // soft clouds
      let cl = 0;
      cl += CasualArt.smooth(0.25, 0, new V2((p.x + 0.5) / 1.6, y - 1.35).magnitude);
      cl += CasualArt.smooth(0.22, 0, new V2((p.x - 0.55) / 1.8, y - 0.85).magnitude);
      cl += CasualArt.smooth(0.18, 0, new V2((p.x + 0.2) / 1.4, y - 0.3).magnitude);
      c = Color.lerp(c, Color.white, Mathf.clamp01(cl) * 0.55);
      // hills
      const h1 = -1.1 + 0.18 * Math.sin(p.x * 2.2 + 0.6);
      const h2 = -1.45 + 0.14 * Math.sin(p.x * 3.1 - 1.2);
      if (y < h1) c = Color.lerp(Pal.hex(0x9be07c), Pal.hex(0x7fcf66), CasualArt.smooth(h1, h1 - 0.6, y));
      if (y < h2) {
        c = Color.lerp(Pal.hex(0x6cc55a), Pal.hex(0x4fae4a), CasualArt.smooth(h2, -2, y));
        const dots = Math.sin(p.x * 40 + y * 7) * Math.sin(y * 45 - p.x * 3);
        if (dots > 0.93) c = Color.lerp(c, Math.sin(p.x * 13) > 0 ? Pal.hex(0xffe36a) : Pal.hex(0xff9ac0), 0.9);
      }
      return c.withAlpha(1);
    });
  },

  get AimDot() { return CasualArt.make("bb-aimdot", 32, 32, (p) => new Color(1, 1, 1, CasualArt.fill(p.magnitude - 0.8, 2 / 32))); },
};
