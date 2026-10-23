import { CasualArt, Color, Mathf, Pal, Sprite, V2 } from "../../kit";

/**
 * Procedural art for DUCK SHOOT: cartoon ducks (wings up / down / dazed), the golden duck, feathers, the marsh and
 * fairground backdrop (hills, Ferris wheel, tents), reeds, water, the striped booth awning and posts, and the
 * mascot: Ollie the otter in a straw boater. All original, baked once and cached.
 */

const C = (h: number) => Pal.hex(h);
const fill = CasualArt.fill, smooth = CasualArt.smooth;

function hash(x: number, y: number, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return Mathf.lerp(Mathf.lerp(a, b, u), Mathf.lerp(c, d, u), v);
}

interface DuckLook { body: Color; body2: Color; head: Color; wing: Color; bill: Color; ring: boolean }
/** 0..3 normal ducks, 4 = golden duck. */
export const DuckLooks: DuckLook[] = [
  { body: C(0xf2e6c8), body2: C(0xc8a878), head: C(0x1f9e5a), wing: C(0xa88058), bill: C(0xffb21f), ring: true },
  { body: C(0xfff6e0), body2: C(0xe8d8b8), head: C(0xfff6e0), wing: C(0xf0e4c8), bill: C(0xff9a1f), ring: false },
  { body: C(0x8a6a4a), body2: C(0x6a4a30), head: C(0x7a5a3a), wing: C(0x4a3424), bill: C(0xe8a02a), ring: false },
  { body: C(0xd8dce8), body2: C(0x9aa0b8), head: C(0x2a7ac8), wing: C(0x4a5a8a), bill: C(0xffc21f), ring: true },
  { body: C(0xffd23a), body2: C(0xf0a018), head: C(0xffe680), wing: C(0xffb81a), bill: C(0xff7a1a), ring: false },
];
export const GoldLook = 4;

/** Shaded colour helper: light from the top left. */
function lit(c: Color, ny: number, k = 0.25) { return Color.lerp(CasualArt.darken(c, k), CasualArt.lighten(c, k * 0.6), smooth(-1, 1, ny)); }

export const DuckArt = {
  /** Duck facing right. frame 0 wings up, 1 wings down, 2 dazed (hit). */
  Duck(look: number, frame: number): Sprite {
    const L = DuckLooks[look];
    return CasualArt.make(`dk-duck-${look}-${frame}`, 192, 160, (p) => {
      const px = 2 / 192;
      let c = Color.clear;
      const put = (d: number, col: Color) => { const a = fill(d, px); if (a > 0) c = CasualArt.over(c, col, a); };
      const ink = C(0x24142e);
      // shapes
      const body = CasualArt.sdCircle(new V2((p.x + 0.12) * 0.82, (p.y + 0.12) * 1.18), V2.zero, 0.5);
      const tail = Math.max(CasualArt.sdSegment(p, new V2(-0.55, -0.05), new V2(-0.88, 0.22)) - 0.13, -(p.y + 0.12));
      const neck = CasualArt.sdSegment(p, new V2(0.32, 0.0), new V2(0.48, 0.3)) - 0.17;
      const hc = new V2(0.52, 0.36);
      const head = CasualArt.sdCircle(p, hc, 0.27);
      const bill = CasualArt.sdBox(p.sub(new V2(0.86, 0.29)), new V2(0.16, 0.07), 0.06);
      let wing: number;
      if (frame === 0) wing = Math.max(CasualArt.sdSegment(p, new V2(-0.15, 0.05), new V2(-0.35, 0.72)) - 0.2, -(p.y - 0.0));
      else if (frame === 1) wing = Math.max(CasualArt.sdSegment(p, new V2(-0.1, -0.05), new V2(-0.25, -0.62)) - 0.18, p.y - 0.05);
      else wing = Math.min(CasualArt.sdSegment(p, new V2(-0.1, 0.05), new V2(-0.48, 0.55)) - 0.15, CasualArt.sdSegment(p, new V2(0.05, 0.0), new V2(0.25, 0.62)) - 0.13);
      const all = Math.min(body, tail, neck, head, bill, wing);
      put(all - 0.05, ink);
      put(Math.min(body, tail), lit(Color.lerp(L.body2, L.body, smooth(-0.5, 0.2, p.y)), p.y * 2));
      put(neck, L.head);
      if (L.ring) put(Math.max(neck, Math.abs(p.y - 0.06 - (p.x - 0.32) * 0.5) - 0.045), Color.white);
      put(head, lit(L.head, (p.y - hc.y) * 4, 0.2));
      put(bill, L.bill);
      put(Math.max(bill, -(p.y - 0.29) - 0.0), CasualArt.lighten(L.bill, 0.15));
      put(wing, lit(L.wing, p.y * 1.5 + 0.3));
      // feather lines on the wing
      const fl = Math.abs(Mathf.repeat((p.x + p.y * 0.4) * 9, 1) - 0.5);
      if (wing < -0.03 && fl < 0.1) put(wing + 0.02, CasualArt.darken(L.wing, 0.18));
      // eye
      if (frame === 2) {
        const e = p.sub(new V2(0.58, 0.42));
        put(Math.min(CasualArt.sdSegment(e, new V2(-0.08, -0.08), new V2(0.08, 0.08)), CasualArt.sdSegment(e, new V2(-0.08, 0.08), new V2(0.08, -0.08))) - 0.025, ink);
      } else {
        put(CasualArt.sdCircle(p, new V2(0.59, 0.42), 0.085), Color.white);
        put(CasualArt.sdCircle(p, new V2(0.62, 0.42), 0.045), ink);
        put(CasualArt.sdCircle(p, new V2(0.635, 0.445), 0.015), Color.white);
      }
      if (look === GoldLook) {
        // crown sparkle highlight
        const crown = Math.max(CasualArt.sdBox(p.sub(new V2(0.5, 0.66)), new V2(0.14, 0.06), 0.01), -(0.06 - Math.abs(Mathf.repeat((p.x - 0.5) * 7 + 0.5, 1) - 0.5) * 0.4 - (p.y - 0.7)));
        put(crown - 0.03, ink);
        put(crown, C(0xffe24a));
      }
      return c;
    });
  },

  Feather(): Sprite {
    return CasualArt.make("dk-feather", 48, 96, (p) => {
      const d = Math.abs(p.x) - 0.42 * Math.sqrt(Mathf.clamp01(1 - (p.y / 1.9) ** 2)) * (1 - 0.3 * p.y);
      const a = fill(d, 0.05) * fill(Math.abs(p.y) - 1.9, 0.05);
      const shaft = Math.abs(p.x) < 0.05 ? 0.75 : 1;
      return new Color(shaft, shaft, shaft, a);
    });
  },

  /** Distant hills with a few trees (wide strip, top transparent). */
  Hills(): Sprite {
    return CasualArt.make("dk-hills", 512, 128, (p) => {
      const h1 = -0.05 + 0.08 * Math.sin(p.x * 2.1 + 1) + 0.05 * Math.sin(p.x * 5.3);
      const h2 = -0.14 + 0.06 * Math.sin(p.x * 3.3 + 2.5) + 0.03 * Math.sin(p.x * 9);
      let c = Color.clear;
      if (p.y < -0.23) return c; // keep the bottom edge clear (the texture may wrap)
      if (p.y < h1) c = Color.lerp(C(0x8fcf8a), C(0x6db87a), smooth(h1, h1 - 0.1, p.y));
      if (p.y < h2) c = Color.lerp(C(0x5aae6a), C(0x48985a), smooth(h2, -0.25, p.y));
      return c;
    });
  },

  /** Ferris wheel: the rim and spokes (rotates) and the stand. */
  Wheel(): Sprite {
    return CasualArt.make("dk-wheel", 256, 256, (p) => {
      const r = p.magnitude, ang = Math.atan2(p.y, p.x);
      let a = fill(Math.abs(r - 0.86) - 0.03, 0.012) + fill(Math.abs(r - 0.78) - 0.015, 0.012);
      const sp = Math.abs(Math.sin(ang * 6)) * r;
      a = Math.max(a, fill(sp - 0.012, 0.012) * (r < 0.86 ? 1 : 0));
      a = Math.max(a, fill(r - 0.1, 0.012));
      for (let i = 0; i < 12; i++) { const t = (i / 12) * Math.PI * 2; a = Math.max(a, fill(CasualArt.sdCircle(p, new V2(Math.cos(t), Math.sin(t)).mul(0.86), 0.035), 0.012)); }
      return new Color(1, 1, 1, Mathf.clamp01(a));
    });
  },
  Cabin(): Sprite {
    return CasualArt.make("dk-cabin", 64, 64, (p) => {
      const d = CasualArt.sdBox(p.sub(new V2(0, -0.2)), new V2(0.62, 0.5), 0.25);
      const hang = Math.abs(p.x) < 0.06 && p.y > 0.2 ? 1 : 0;
      let c = Color.clear;
      if (hang) c = C(0x6a5a7a);
      const a = fill(d, 0.04);
      if (a > 0) c = CasualArt.over(c, Color.lerp(Color.white, Color.white.mul(0.85), smooth(0.3, -0.7, p.y)).withAlpha(1), a);
      if (Math.abs(p.y + 0.12) < 0.14 && Math.abs(p.x) < 0.45) c = C(0x3a4a6a).withAlpha(a);
      return c;
    });
  },
  Stand(): Sprite {
    return CasualArt.make("dk-stand", 128, 160, (p) => {
      const top = new V2(0, 1.1);
      const a = Math.max(fill(CasualArt.sdSegment(p, top, new V2(-0.75, -1.25)) - 0.05, 0.02), fill(CasualArt.sdSegment(p, top, new V2(0.75, -1.25)) - 0.05, 0.02));
      return new Color(0.42, 0.36, 0.52, a);
    });
  },

  /** Striped fair tent. */
  Tent(v: number): Sprite {
    const cols = [[C(0xff5a5f), C(0xfff2e0)], [C(0x3d8bff), C(0xfff2e0)], [C(0xffb21f), C(0xff5a5f)]][v % 3];
    return CasualArt.make("dk-tent-" + v, 160, 128, (p) => {
      const H = 0.8;
      const roofTop = new V2(0, H - 0.05);
      const roof = Math.max(Math.abs(p.x) * 0.55 + (p.y - roofTop.y), -(p.y - 0.2));
      const wall = CasualArt.sdBox(p.sub(new V2(0, -0.25)), new V2(0.82, 0.47), 0.02);
      let c = Color.clear;
      const stripe = Mathf.repeat(p.x * 4 + (p.y > 0.2 ? p.y * 0.5 * Math.sign(p.x) : 0), 1) < 0.5;
      const wa = fill(wall, 0.02);
      if (wa > 0) c = (stripe ? cols[0] : cols[1]).mul(0.88).withAlpha(wa);
      if (wa > 0 && Math.abs(p.x) < 0.2 && p.y < -0.05) c = C(0x3a2440).withAlpha(wa);
      const ra = fill(roof, 0.02);
      if (ra > 0) c = CasualArt.over(c, stripe ? cols[0] : cols[1], ra);
      const flag = CasualArt.sdBox(p.sub(new V2(0.09, H + 0.03)), new V2(0.08, 0.04), 0.0);
      if (fill(flag, 0.02) > 0) c = cols[0];
      if (Math.abs(p.x) < 0.012 && p.y > H - 0.08 && p.y < H + 0.08) c = C(0x3a2440);
      return c;
    });
  },

  /** Reed bed strip (tiles horizontally). layer 0 back (paler), 1 front. */
  Reeds(layer: number): Sprite {
    return CasualArt.make("dk-reeds-" + layer, 256, 96, (p) => {
      let c = Color.clear;
      const base = layer === 0 ? C(0x5aa060) : C(0x3f8a48);
      for (let i = 0; i < 26; i++) {
        const x0 = -1 + (i + 0.5) * (2 / 26) + (hash(i, layer, 3) - 0.5) * 0.05;
        const hgt = 0.1 + hash(i, layer, 5) * 0.22 + (layer === 0 ? 0.04 : 0);
        const lean = (hash(i, layer, 7) - 0.5) * 0.12;
        const top = new V2(x0 + lean, hgt), bot = new V2(x0, -0.4);
        const d = CasualArt.sdSegment(p, bot, top) - 0.018 * (1 - (p.y + 0.4) / (hgt + 0.4) * 0.6);
        const a = fill(d, 0.006);
        if (a > 0) c = CasualArt.over(c, Color.lerp(CasualArt.darken(base, 0.2), CasualArt.lighten(base, 0.15), hash(i, layer, 9)), a);
        // cattail heads on some
        if (hash(i, layer, 11) > 0.55) {
          const h = CasualArt.sdBox(p.sub(top.sub(new V2(lean * 0.25, 0.05))), new V2(0.014, 0.045), 0.012);
          const ha = fill(h, 0.006);
          if (ha > 0) c = CasualArt.over(c, C(0x7a4a2a), ha);
        }
      }
      // grass clump at the bottom
      const g = -0.3 + 0.05 * Math.sin(p.x * 60) * Math.sin(p.x * 23);
      if (p.y < g) c = Color.lerp(base, CasualArt.darken(base, 0.25), smooth(g, -0.375, p.y)).withAlpha(1);
      return c;
    });
  },

  /** Marsh water: gradient with ripple lines. */
  Water(): Sprite {
    return CasualArt.make("dk-water", 256, 64, (p) => {
      const t = (p.y + 0.25) / 0.5;
      let c = Color.lerp(C(0x2a7ab8), C(0x6cc8e8), t);
      const rip = Math.abs(Mathf.repeat(p.y * 16 + noise(p.x * 6, p.y * 3, 2) * 1.5, 1) - 0.5);
      if (rip < 0.06 && noise(p.x * 9, p.y * 20, 5) > 0.5) c = Color.lerp(c, Color.white, 0.45);
      return c.withAlpha(1);
    });
  },

  /** Booth awning: scalloped red/white stripes (tiles horizontally). */
  Awning(): Sprite {
    return CasualArt.make("dk-awning", 256, 96, (p) => {
      const H = 0.375;
      const stripe = Mathf.repeat(p.x * 4, 1) < 0.5;
      const sc = Mathf.repeat(p.x * 4, 0.5) * 4 - 1; // -1..1 within each scallop
      const bottom = -H + 0.12 - Math.sqrt(Mathf.clamp01(1 - sc * sc)) * 0.12;
      if (p.y < bottom) return Color.clear;
      let c = stripe ? C(0xe8303c) : C(0xfff4e6);
      c = Color.lerp(c, CasualArt.darken(c, 0.25), smooth(0.2, H, p.y));
      c = Color.lerp(c, CasualArt.darken(c, 0.3), smooth(bottom + 0.05, bottom, p.y));
      if (p.y > H - 0.07) c = C(0xffc93c);
      if (p.y > H - 0.07 && Math.abs(Mathf.repeat(p.x * 8, 1) - 0.5) < 0.12) c = C(0xff8a1f);
      return c.withAlpha(fill(bottom - p.y, 0.01));
    });
  },

  /** Striped booth post. */
  Post(): Sprite {
    return CasualArt.make("dk-post", 48, 384, (p) => {
      const d = Math.abs(p.x) - 0.82;
      const stripe = Mathf.repeat(p.y * 1.4 + p.x * 0.4, 1) < 0.5;
      let c = stripe ? C(0xe8303c) : C(0xfff4e6);
      c = Color.lerp(CasualArt.darken(c, 0.25), CasualArt.lighten(c, 0.1), smooth(-0.9, 0.4, -p.x));
      return c.withAlpha(fill(d, 0.08));
    });
  },

  /** Ollie the otter in a straw boater. pose 0 peeking, 1 cheering, 2 holding up a sign. */
  Otter(pose: number): Sprite {
    return CasualArt.make("dk-otter-" + pose, 160, 224, (p) => {
      const px = 2 / 160;
      let c = Color.clear;
      const put = (d: number, col: Color) => { const a = fill(d, px); if (a > 0) c = CasualArt.over(c, col, a); };
      const ink = C(0x2a1a24), fur = C(0x9a6440), fur2 = C(0xe8c8a0);
      const body = CasualArt.sdBox(p.sub(new V2(0, -0.75)), new V2(0.52, 0.75), 0.45);
      const head = CasualArt.sdCircle(p, new V2(0, 0.35), 0.5);
      const ears = Math.min(CasualArt.sdCircle(p, new V2(-0.42, 0.7), 0.13), CasualArt.sdCircle(p, new V2(0.42, 0.7), 0.13));
      let arms: number;
      if (pose === 1) arms = Math.min(CasualArt.sdSegment(p, new V2(-0.45, -0.35), new V2(-0.82, 0.55)) - 0.13, CasualArt.sdSegment(p, new V2(0.45, -0.35), new V2(0.82, 0.55)) - 0.13);
      else arms = Math.min(CasualArt.sdSegment(p, new V2(-0.45, -0.4), new V2(-0.25, -0.75)) - 0.13, CasualArt.sdSegment(p, new V2(0.45, -0.4), new V2(0.25, -0.75)) - 0.13);
      put(Math.min(body, head, ears, arms) - 0.05, ink);
      put(Math.min(body, ears), lit(fur, p.y));
      put(arms, CasualArt.darken(fur, 0.1));
      put(CasualArt.sdBox(p.sub(new V2(0, -0.85)), new V2(0.3, 0.5), 0.3), fur2);
      put(head, lit(fur, (p.y - 0.35) * 2));
      put(CasualArt.sdCircle(new V2(p.x * 0.8, p.y), new V2(0, 0.18), 0.27), fur2);
      put(CasualArt.sdCircle(p, new V2(0, 0.28), 0.08), ink); // nose
      put(CasualArt.sdCircle(p, new V2(-0.2, 0.44), 0.07), ink);
      put(CasualArt.sdCircle(p, new V2(0.2, 0.44), 0.07), ink);
      put(CasualArt.sdCircle(p, new V2(-0.18, 0.47), 0.025), Color.white);
      put(CasualArt.sdCircle(p, new V2(0.22, 0.47), 0.025), Color.white);
      // smile (big open mouth when cheering)
      if (pose === 1) put(Math.max(CasualArt.sdCircle(p, new V2(0, 0.14), 0.13), p.y - 0.14), C(0xc8304a));
      else put(Math.max(Math.abs(CasualArt.sdCircle(p, new V2(0, 0.2), 0.11)) - 0.02, p.y - 0.17), ink);
      // whiskers
      for (const s of [-1, 1]) for (const k of [0, 1]) put(CasualArt.sdSegment(p, new V2(s * 0.2, 0.22 - k * 0.05), new V2(s * 0.45, 0.25 - k * 0.1)) - 0.008, ink);
      // straw boater
      const brim = CasualArt.sdBox(p.sub(new V2(0, 0.78)), new V2(0.55, 0.05), 0.05);
      const crown = CasualArt.sdBox(p.sub(new V2(0, 0.92)), new V2(0.33, 0.14), 0.05);
      put(Math.min(brim, crown) - 0.04, ink);
      put(Math.min(brim, crown), Color.lerp(C(0xf0d070), C(0xd8b048), noise(p.x * 30, p.y * 30, 4)));
      put(CasualArt.sdBox(p.sub(new V2(0, 0.85)), new V2(0.33, 0.04), 0.0), C(0xe8303c));
      return c;
    });
  },

  /** Sign Ollie holds up. */
  Sign(): Sprite {
    return CasualArt.make("dk-sign", 192, 96, (p) => {
      const d = CasualArt.sdBox(p, new V2(0.95, 0.45), 0.1);
      const a = fill(d, 0.02);
      if (a <= 0) return Color.clear;
      return (d > -0.07 ? C(0x7a4a2a) : C(0xfff4dc)).withAlpha(a);
    });
  },
};
