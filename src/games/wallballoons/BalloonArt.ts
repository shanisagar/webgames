import { CasualArt, Color, Mathf, Pal, Sprite, V2 } from "../../kit";

/**
 * Procedural art for BALLOON BURST: glossy balloons (five solo colours, the two player colours, the BRAND balloon,
 * the ICE and BOMB specials), rubber shreds, the striped stall, the prize counter with plush toys, the valance and
 * the string-light bulbs. Baked once and cached.
 */

const C = (h: number) => Pal.hex(h);
const fill = CasualArt.fill, smooth = CasualArt.smooth;

export interface Hue { name: string; color: Color }
export const SoloHues: Hue[] = [
  { name: "RED", color: C(0xff3b4e) },
  { name: "BLUE", color: C(0x3a7bff) },
  { name: "GREEN", color: C(0x34d26a) },
  { name: "YELLOW", color: C(0xffd21f) },
  { name: "PURPLE", color: C(0xb04cff) },
];
export const DuoHues: Hue[] = [
  { name: "CYAN", color: C(0x22d8ff) },
  { name: "ORANGE", color: C(0xff8a1f) },
];
export enum Special { None, Brand, Ice, Bomb }

/** Balloon body: unit-ish teardrop. Sprite is 1 wide, 1.4 tall; body centre at y = +0.18. */
function balloonPixel(p: V2, base: Color, px: number, kind: Special): Color {
  const q = new V2(p.x / 0.86, (p.y - 0.18) / 1.0);
  const taper = q.y < 0 ? 1 + 0.28 * -q.y : 1; // narrower towards the knot
  const r = Math.hypot(q.x * taper, q.y);
  let c = Color.clear;
  const knot = Math.max(Math.abs(p.x) - (0.02 + (p.y + 0.95) * 0.5), Math.max(p.y + 1.0, -(p.y + 0.84)));
  const ka = fill(knot, px);
  if (ka > 0) c = CasualArt.over(c, CasualArt.darken(base, 0.2), ka);
  const a = fill((r - 1) * 0.86, px);
  if (a <= 0) return c;
  const z = Math.sqrt(Math.max(0, 1 - r * r));
  const diff = Math.max(0, (q.x * -0.45 + q.y * 0.55 + z * 0.7) / 1.0);
  let col = base.mul(0.55 + 0.6 * diff).withAlpha(1);
  col = Color.lerp(col, CasualArt.darken(base, 0.45), smooth(0.75, 1, r) * 0.5);
  // rim light
  col = Color.lerp(col, CasualArt.lighten(base, 0.4), smooth(0.85, 1, r) * smooth(-0.1, -0.9, q.y) * 0.4);
  if (kind === Special.Ice) {
    const ang = Math.atan2(q.y, q.x);
    const flake = Math.min(...[0, 1, 2].map((k) => Math.abs(Math.sin(ang - (k * Math.PI) / 3)) * r)) - 0.035;
    if (r < 0.55 && flake < 0) col = Color.lerp(col, Color.white, 0.85);
    if (r < 0.55 && Math.abs(r - 0.42) < 0.03 && Math.abs(Math.sin(ang * 3)) > 0.9) col = Color.white;
  }
  if (kind === Special.Bomb) {
    // a cartoon bomb printed on the balloon
    const b = CasualArt.sdCircle(q, new V2(0, -0.1), 0.42);
    if (b < 0.06) col = C(0xffd21f);
    if (b < 0) col = Color.lerp(C(0x2a2a3a), C(0x5a5a7a), smooth(-0.4, 0.3, q.y + q.x * 0.3));
    const fuse = CasualArt.sdSegment(q, new V2(0.18, 0.28), new V2(0.36, 0.5)) - 0.05;
    if (fuse < 0) col = C(0xc8a060);
    const spark = CasualArt.sdStar(q.sub(new V2(0.42, 0.58)), 0.18, 0.45);
    if (spark < 0) col = C(0xffe24a);
  }
  // specular
  const spec = smooth(0.32, 0, Math.hypot((q.x + 0.38) * 1.1, (q.y - 0.4) * 1.4));
  col = Color.lerp(col, Color.white, spec * 0.85);
  const spec2 = smooth(0.1, 0, Math.hypot((q.x + 0.15) * 1.0, (q.y - 0.68) * 1.6));
  col = Color.lerp(col, Color.white, spec2 * 0.7);
  return CasualArt.over(c, col.withAlpha(kind === Special.Ice ? 0.92 : 1), a);
}

export const BalloonArt = {
  Balloon(key: string, base: Color, kind = Special.None): Sprite {
    return CasualArt.make("bb-balloon-" + key, 160, 224, (p) => balloonPixel(p, base, 2 / 160, kind));
  },
  Hue(c: Color, i: number) { return BalloonArt.Balloon("h" + i + "-" + c.css, c); },
  Brand(c: Color) { return BalloonArt.Balloon("brand-" + c.css, c); },
  Ice() { return BalloonArt.Balloon("ice", C(0x9fe8ff), Special.Ice); },
  Bomb() { return BalloonArt.Balloon("bomb", C(0x2c2a3c), Special.Bomb); },

  Shred(): Sprite {
    return CasualArt.make("bb-shred", 48, 48, (p) => {
      const d = CasualArt.sdSegment(p, new V2(-0.7, -0.3), new V2(0.6, 0.4)) - 0.22 - 0.1 * Math.sin(p.x * 9);
      return new Color(1, 1, 1, fill(d, 0.06));
    });
  },

  /** Back wall of the stall: vertical tent stripes with a soft centre light. Tiles horizontally. */
  Stripes(): Sprite {
    return CasualArt.make("bb-stripes", 256, 256, (p) => {
      const s = Mathf.repeat(p.x * 3, 1) < 0.5;
      let c = s ? C(0x5a2a8a) : C(0x7a3aa8);
      const fold = Math.abs(Mathf.repeat(p.x * 3, 0.5) * 2 - 0.5);
      c = Color.lerp(c, CasualArt.darken(c, 0.3), smooth(0.3, 0.5, fold) * 0.4);
      c = Color.lerp(c, CasualArt.darken(c, 0.35), smooth(0.2, 1, p.y) * 0.5);
      return c.withAlpha(1);
    });
  },

  /** Top valance: yellow/pink scallops with fringe. Tiles horizontally. */
  Valance(): Sprite {
    return CasualArt.make("bb-valance", 256, 96, (p) => {
      const H = 0.375;
      const sc = Mathf.repeat(p.x * 3, 1) * 2 - 1;
      const bottom = -H + 0.16 - Math.sqrt(Mathf.clamp01(1 - sc * sc)) * 0.15;
      if (p.y < bottom) return Color.clear;
      const k = Math.floor(Mathf.repeat(p.x * 1.5 + 10, 2));
      let c = k === 0 ? C(0xffc93c) : C(0xff5aa8);
      c = Color.lerp(c, CasualArt.darken(c, 0.3), smooth(bottom + 0.06, bottom, p.y));
      if (p.y > H - 0.08) c = C(0x3a1a5a);
      if (Math.abs(p.y - (H - 0.12)) < 0.02) c = C(0xfff2c0);
      return c.withAlpha(fill(bottom - p.y, 0.01));
    });
  },

  /** The prize counter front (stripes + gold trim). Tiles horizontally. */
  Counter(): Sprite {
    return CasualArt.make("bb-counter", 256, 128, (p) => {
      const H = 0.5;
      let c = Mathf.repeat(p.x * 4 + p.y * 0.0, 1) < 0.5 ? C(0xe8303c) : C(0xfff2e0);
      c = Color.lerp(c, CasualArt.darken(c, 0.25), smooth(-0.2, -0.5, p.y));
      if (p.y > H - 0.12) c = Color.lerp(C(0x8a5a2a), C(0xc8884a), smooth(H - 0.12, H, p.y));
      if (Math.abs(p.y - (H - 0.15)) < 0.03) c = C(0xffc93c);
      return c.withAlpha(1);
    });
  },

  /** Plush prize: 0 bear, 1 bunny, 2 cat. */
  Plush(kind: number, v: number): Sprite {
    const cols = [C(0xc88a5a), C(0xff9ac8), C(0x8ac8ff), C(0xffe080), C(0xb8f0a0)];
    const fur = cols[(kind * 2 + v) % cols.length];
    return CasualArt.make(`bb-plush-${kind}-${v}`, 128, 160, (p) => {
      const px = 2 / 128;
      let c = Color.clear;
      const put = (d: number, col: Color) => { const a = fill(d, px); if (a > 0) c = CasualArt.over(c, col, a); };
      const ink = C(0x2a1a2e);
      const body = CasualArt.sdCircle(new V2(p.x, (p.y + 0.55) * 1.1), V2.zero, 0.62);
      const head = CasualArt.sdCircle(p, new V2(0, 0.42), 0.5);
      let ears: number;
      if (kind === 1) ears = Math.min(CasualArt.sdSegment(p, new V2(-0.2, 0.8), new V2(-0.3, 1.18)) - 0.12, CasualArt.sdSegment(p, new V2(0.2, 0.8), new V2(0.3, 1.18)) - 0.12);
      else if (kind === 2) ears = Math.min(Math.max(Math.abs(p.x + 0.32) * 1.4 + (p.y - 1.02), -(p.y - 0.62)), Math.max(Math.abs(p.x - 0.32) * 1.4 + (p.y - 1.02), -(p.y - 0.62)));
      else ears = Math.min(CasualArt.sdCircle(p, new V2(-0.38, 0.82), 0.17), CasualArt.sdCircle(p, new V2(0.38, 0.82), 0.17));
      put(Math.min(body, head, ears) - 0.05, ink);
      put(Math.min(body, ears), Color.lerp(CasualArt.darken(fur, 0.15), fur, smooth(-1, 0.2, p.y)));
      put(head, Color.lerp(CasualArt.darken(fur, 0.1), CasualArt.lighten(fur, 0.1), smooth(0, 0.9, p.y)));
      put(CasualArt.sdCircle(new V2(p.x, (p.y + 0.55) * 1.2), V2.zero, 0.36), CasualArt.lighten(fur, 0.45));
      put(CasualArt.sdCircle(p, new V2(0, 0.3), 0.18), CasualArt.lighten(fur, 0.5));
      put(CasualArt.sdCircle(p, new V2(0, 0.35), 0.06), ink);
      put(CasualArt.sdCircle(p, new V2(-0.18, 0.5), 0.055), ink);
      put(CasualArt.sdCircle(p, new V2(0.18, 0.5), 0.055), ink);
      put(Math.max(Math.abs(CasualArt.sdCircle(p, new V2(0, 0.26), 0.08)) - 0.015, p.y - 0.25), ink);
      // bow tie
      const bow = Math.min(Math.max(Math.abs(p.x) - 0.2, Math.abs(p.y + 0.02) - 0.08 - Math.abs(p.x) * 0.3), CasualArt.sdCircle(p, new V2(0, -0.02), 0.05));
      put(bow, [C(0xff3b4e), C(0x3a7bff), C(0x34d26a)][v % 3]);
      return c;
    });
  },

  /** Frost overlay for the ICE slow-down (transparent centre). */
  Frost(): Sprite {
    return CasualArt.make("bb-frost", 128, 72, (p) => {
      const q = new V2(Math.abs(p.x), Math.abs(p.y) / 0.5625);
      const e = Math.max(q.x, q.y);
      const crystals = 0.5 + 0.5 * Math.sin(p.x * 40 + Math.sin(p.y * 30) * 3) * Math.sin(p.y * 37 + p.x * 11);
      const a = smooth(0.72, 1, e) * (0.6 + 0.4 * crystals);
      return new Color(0.85, 0.96, 1, a * 0.85);
    });
  },
};
