import { CasualArt, Color, Mathf, Pal, Sprite, V2 } from "../../kit";

/**
 * Procedural art for Sunny Solitaire: card face and back (UI sprites, 9-sliced), the four suit symbols, an empty
 * pile outline and the sunny felt table. (Port of SunnySolitaireArt.cs.)
 */

const Clear = new Color(1, 1, 1, 0);

function heart(p: V2) {
  const q = new V2(Math.abs(p.x), p.y);
  if (q.y + q.x > 1) return q.sub(new V2(0.25, 0.75)).magnitude - 0.35355;
  const m = 0.5 * Math.max(q.x + q.y, 0);
  return Math.sqrt(Math.min(q.sub(new V2(0, 1)).sqrMagnitude, q.sub(new V2(m, m)).sqrMagnitude)) * Mathf.sign(q.x - q.y);
}

function suitSd(suit: number, p: V2) {
  switch (suit) {
    case 1: return heart(p.add(new V2(0, 0.85)).div(1.5)) * 1.5;
    case 2: return (Math.abs(p.x) / 0.7 + Math.abs(p.y) / 0.92 - 1) * 0.55;
    case 3: { // club
      const d = Math.min(CasualArt.sdCircle(p, new V2(0, 0.4), 0.36), Math.min(CasualArt.sdCircle(p, new V2(-0.4, -0.12), 0.36), CasualArt.sdCircle(p, new V2(0.4, -0.12), 0.36)));
      const stem = Math.max(Math.abs(p.x) - (0.06 + (-p.y - 0.1) * 0.35), Math.max(-0.88 - p.y, p.y + 0.1));
      return Math.min(d, Math.min(stem, CasualArt.sdCircle(p, new V2(0, 0.02), 0.2)));
    }
    default: { // spade: upside-down heart + stem
      const h = heart(new V2(p.x, -p.y).add(new V2(0, 0.7)).div(1.3)) * 1.3;
      const stem = Math.max(Math.abs(p.x) - (0.05 + (-p.y - 0.4) * 0.45), Math.max(-0.95 - p.y, p.y + 0.4));
      return Math.min(h, stem);
    }
  }
}

export const SunnySolitaireArt = {
  Red: Pal.hex(0xe0303e),
  Black: Pal.hex(0x1f2433),

  get Face(): Sprite {
    return CasualArt.make("ss-face", 128, 128, (p) => {
      const px = 2 / 128;
      const d = CasualArt.sdBox(p, new V2(0.97, 0.97), 0.36);
      const a = CasualArt.fill(d, px);
      let c = Color.lerp(Pal.hex(0xfffdf7), Pal.hex(0xf4efe4), CasualArt.smooth(1, -1, p.y));
      c = Color.lerp(Pal.hex(0xb9b2a3), c, CasualArt.fill(d + 0.04, px));
      return c.withAlpha(a);
    }, 46, 128);
  },

  get Back(): Sprite {
    return CasualArt.make("ss-back", 128, 180, (p) => {
      const px = 2 / 128;
      const d = CasualArt.sdBox(p, new V2(0.97, 1.38), 0.36);
      const a = CasualArt.fill(d, px);
      if (a <= 0) return Clear;
      let c = Color.white;
      const inner = CasualArt.sdBox(p, new V2(0.82, 1.23), 0.24);
      let fill = Color.lerp(Pal.hex(0xff8a3d), Pal.hex(0xffb627), CasualArt.smooth(-1.2, 1.2, p.y));
      // diagonal sun-ray stripes
      const stripes = Math.sin((p.x + p.y) * 14);
      fill = Color.lerp(fill, Pal.hex(0xffd166), CasualArt.smooth(0.6, 0.9, stripes) * 0.35);
      // sun emblem
      const sun = p.magnitude - 0.32;
      let rays = 9;
      for (let i = 0; i < 12; i++) {
        const ang = (i * Math.PI) / 6;
        const dir = new V2(Math.cos(ang), Math.sin(ang));
        rays = Math.min(rays, CasualArt.sdSegment(p, dir.mul(0.42), dir.mul(0.6)) - 0.045);
      }
      fill = Color.lerp(fill, Color.white, CasualArt.fill(Math.min(sun, rays), px) * 0.9);
      fill = Color.lerp(fill, Pal.hex(0xffc93c), CasualArt.fill(sun + 0.08, px));
      c = Color.lerp(c, fill, CasualArt.fill(inner, px));
      c = Color.lerp(Pal.hex(0xc4692a), c, CasualArt.fill(d + 0.035, px));
      return c.withAlpha(a);
    });
  },

  get Slot(): Sprite {
    return CasualArt.make("ss-slot", 128, 128, (p) => {
      const px = 2 / 128;
      const d = CasualArt.sdBox(p, new V2(0.95, 0.95), 0.36);
      const ring = Math.abs(d + 0.03) - 0.025;
      return new Color(1, 1, 1, CasualArt.fill(ring, px) * 0.6 + CasualArt.fill(d, px) * 0.12);
    }, 46, 128);
  },

  get Glow(): Sprite {
    return CasualArt.make("ss-glow", 128, 128, (p) => {
      const d = CasualArt.sdBox(p, new V2(0.8, 0.8), 0.36);
      const a = CasualArt.smooth(0.2, -0.1, d);
      return new Color(1, 1, 1, a * a);
    }, 50, 128);
  },

  Suit(suit: number): Sprite {
    return CasualArt.make("ss-suit-" + suit, 96, 96, (p) => {
      const px = 2 / 96;
      const d = suitSd(suit, p);
      const col = suit === 1 || suit === 2 ? SunnySolitaireArt.Red : SunnySolitaireArt.Black;
      const c = Color.lerp(CasualArt.lighten(col, 0.15), col, CasualArt.smooth(0.8, -0.8, p.y));
      return c.withAlpha(CasualArt.fill(d, px));
    });
  },

  /** Sunny felt table: warm teal with a soft sun glow at the top. */
  get Felt(): Sprite {
    return CasualArt.make("ss-felt", 128, 256, (p) => {
      let c = Color.lerp(Pal.hex(0x0e7c74), Pal.hex(0x19a391), CasualArt.smooth(-2, 1.6, p.y));
      const glow = CasualArt.smooth(1.3, 0, p.sub(new V2(0, 2.1)).magnitude);
      c = Color.lerp(c, Pal.hex(0xffe08a), glow * 0.35);
      const n = Mathf.perlinNoise(p.x * 40, p.y * 40);
      c = Color.lerp(c, CasualArt.darken(c, 0.15), n * 0.25);
      const vig = CasualArt.smooth(0.6, 1.6, new V2(p.x, p.y * 0.5).magnitude);
      c = Color.lerp(c, Pal.hex(0x075450), vig * 0.5);
      return c.withAlpha(1);
    });
  },
};
