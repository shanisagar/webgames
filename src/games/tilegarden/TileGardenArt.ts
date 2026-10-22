import { CasualArt, Color, Mathf, Pal, Sprite, V2 } from "../../kit";

/**
 * Procedural art for Tile Garden: ivory tiles with a jade base, twelve garden icons (each with its own shape and
 * colour), the bamboo tray and the paper backdrop with falling blossom petals. (Port of TileGardenArt.cs.)
 */

const Clear = new Color(1, 1, 1, 0);

function bodyPixel(p: V2, mask: boolean): Color {
  const px = 2 / 128;
  // p.y spans -1.125..1.125. Face sits higher, base lip below it.
  const face = p.sub(new V2(0, 0.1));
  const dFace = CasualArt.sdBox(face, new V2(0.9, 0.95), 0.2);
  const lip = p.sub(new V2(0, -0.02));
  const dLip = CasualArt.sdBox(lip, new V2(0.92, 1.05), 0.24);
  const dAll = Math.min(dFace, dLip);
  const a = CasualArt.fill(dAll, px);
  if (mask) return new Color(1, 1, 1, a);
  if (a <= 0) return Clear;
  const jade = Pal.hex(0x3faf8a), jadeDark = Pal.hex(0x23775c);
  let c = Color.lerp(jadeDark, jade, CasualArt.smooth(-1.1, -0.75, p.y));
  c = Color.lerp(jadeDark, c, CasualArt.fill(dLip + 0.04, px));
  // face: ivory with a soft top light
  const fa = CasualArt.fill(dFace, px);
  let ivory = Color.lerp(Pal.hex(0xf3e9d6), Pal.hex(0xfffbf2), CasualArt.smooth(-0.8, 0.9, face.y + face.x * 0.2));
  ivory = Color.lerp(Pal.hex(0xd8c8ac), ivory, CasualArt.fill(dFace + 0.05, px));
  c = Color.lerp(c, ivory, fa);
  return c.withAlpha(a);
}

/** Paints a shape with a darker outline, soft vertical shading and a little highlight. */
function shape(dst: Color, d: number, tint: Color, px: number, p: V2): Color {
  const a = CasualArt.fill(d, px);
  if (a <= 0) return dst;
  const fill = Color.lerp(CasualArt.darken(tint, 0.12), CasualArt.lighten(tint, 0.18), CasualArt.smooth(-0.8, 0.8, p.y - p.x * 0.3));
  let col = Color.lerp(CasualArt.darken(tint, 0.5), fill, CasualArt.fill(d + 0.06, px));
  const hl = CasualArt.smooth(0.25, 0, p.sub(new V2(-0.25, 0.3)).magnitude) * CasualArt.fill(d + 0.12, px);
  col = Color.lerp(col, Color.white, hl * 0.35);
  col = col.withAlpha(1);
  return CasualArt.over(dst, col, a);
}

function iconPixel(type: number, p: V2, px: number): Color {
  let c = Clear;
  const t = TileGardenArt.IconTint[type];
  switch (type) {
    case 0: { // heart
      const q = new V2(Math.abs(p.x), p.y + 0.6).div(1.1);
      let d: number;
      if (q.y + q.x > 1) d = q.sub(new V2(0.25, 0.75)).magnitude - 0.35355;
      else {
        const m = 0.5 * Math.max(q.x + q.y, 0);
        d = Math.sqrt(Math.min(q.sub(new V2(0, 1)).sqrMagnitude, q.sub(new V2(m, m)).sqrMagnitude)) * Mathf.sign(q.x - q.y);
      }
      c = shape(c, d * 1.1, t, px, p);
      break;
    }
    case 1: c = shape(c, CasualArt.sdStar(p, 0.78, 0.48), t, px, p); break;
    case 2: { // drop
      const circle = CasualArt.sdCircle(p, new V2(0, -0.2), 0.48);
      const tip = Math.max(Math.abs(p.x) - (0.78 - (p.y + 0.2)) * 0.6, Math.max(-(p.y + 0.2), p.y - 0.78));
      c = shape(c, Math.min(circle, tip), t, px, p);
      break;
    }
    case 3: { // crescent moon
      const d = Math.max(p.magnitude - 0.68, -CasualArt.sdCircle(p, new V2(0.34, 0.22), 0.58));
      c = shape(c, d, t, px, p);
      break;
    }
    case 4: { // sun
      const d = p.magnitude - 0.42;
      let rays = 9;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const dir = new V2(Math.cos(a), Math.sin(a));
        rays = Math.min(rays, CasualArt.sdSegment(p, dir.mul(0.56), dir.mul(0.8)) - 0.08);
      }
      c = shape(c, Math.min(d, rays), t, px, p);
      break;
    }
    case 5: { // leaf with vein
      const q = new V2((p.x + p.y) * 0.7071, (p.y - p.x) * 0.7071);
      const half = 0.36 * Math.sqrt(Math.max(0, 1 - (q.x / 0.82) * (q.x / 0.82)));
      const d = Math.max(Math.abs(q.y) - half, Math.abs(q.x) - 0.82);
      c = shape(c, d, t, px, p);
      const vein = Math.abs(q.y) - 0.025;
      if (d < -0.02 && Math.abs(q.x) < 0.7) c = Color.lerp(c, CasualArt.darken(t, 0.35), CasualArt.fill(vein, px));
      break;
    }
    case 6: { // mushroom
      const cap = Math.max(CasualArt.sdCircle(p, new V2(0, -0.05), 0.75), -(p.y - 0));
      const stem = CasualArt.sdBox(p.sub(new V2(0, -0.35)), new V2(0.24, 0.36), 0.12);
      c = shape(c, stem, Pal.hex(0xf4e2c4), px, p);
      c = shape(c, cap, t, px, p);
      for (let i = 0; i < 3; i++) {
        const sp = new V2(-0.38 + i * 0.38, 0.32 + (i === 1 ? 0.18 : 0));
        const spot = CasualArt.sdCircle(p, sp, 0.11);
        if (cap < 0) c = Color.lerp(c, Color.white, CasualArt.fill(spot, px));
      }
      break;
    }
    case 7: { // cherries
      const s1 = CasualArt.sdSegment(p, new V2(-0.32, -0.2), new V2(0.15, 0.7)) - 0.045;
      const s2 = CasualArt.sdSegment(p, new V2(0.38, -0.25), new V2(0.15, 0.7)) - 0.045;
      c = shape(c, Math.min(s1, s2), Pal.hex(0x6b8e23), px, p);
      c = shape(c, CasualArt.sdCircle(p, new V2(-0.34, -0.42), 0.32), t, px, p);
      c = shape(c, CasualArt.sdCircle(p, new V2(0.38, -0.46), 0.32), t, px, p);
      break;
    }
    case 8: { // carrot
      const q = p.sub(new V2(0, 0.05));
      let body = Math.max(Math.abs(q.x) - (q.y + 0.85) * 0.3, Math.max(-(q.y + 0.85), q.y - 0.4));
      body = Math.max(body, CasualArt.sdBox(q.sub(new V2(0, -0.2)), new V2(0.5, 0.7), 0.2));
      const l1 = CasualArt.sdSegment(p, new V2(0, 0.42), new V2(-0.25, 0.85)) - 0.07;
      const l2 = CasualArt.sdSegment(p, new V2(0, 0.42), new V2(0.05, 0.9)) - 0.07;
      const l3 = CasualArt.sdSegment(p, new V2(0, 0.42), new V2(0.3, 0.82)) - 0.07;
      c = shape(c, Math.min(l1, Math.min(l2, l3)), Pal.hex(0x3db54a), px, p);
      c = shape(c, body, t, px, p);
      for (let i = 0; i < 3; i++) {
        const line = Math.abs(q.y + 0.1 - i * 0.2) - 0.02;
        if (body < -0.03 && q.x < 0.05) c = Color.lerp(c, CasualArt.darken(t, 0.3), CasualArt.fill(Math.max(line, q.x + 0.05 - i * 0.05), px));
      }
      break;
    }
    case 9: { // clover
      let d = 9;
      for (let i = 0; i < 3; i++) {
        const a = Math.PI * 0.5 + (i * Math.PI * 2) / 3;
        d = Math.min(d, CasualArt.sdCircle(p, new V2(Math.cos(a), Math.sin(a)).mul(0.34).add(new V2(0, 0.1)), 0.32));
      }
      const stem = CasualArt.sdSegment(p, new V2(0, 0), new V2(0.25, -0.82)) - 0.06;
      c = shape(c, Math.min(d, stem), t, px, p);
      break;
    }
    case 10: { // tulip
      const stem = CasualArt.sdSegment(p, new V2(0, -0.1), new V2(0, -0.85)) - 0.055;
      const leaf = new V2((p.x + 0.22) / 0.14, (p.y + 0.5) / 0.32).magnitude - 1;
      c = shape(c, Math.min(stem, leaf * 0.14), Pal.hex(0x3db54a), px, p);
      const q = p.sub(new V2(0, 0.25));
      const cup = Math.max(CasualArt.sdCircle(q, new V2(0, 0), 0.48), q.y - 0.32);
      let tips = 9;
      for (let i = -1; i <= 1; i++) tips = Math.min(tips, CasualArt.sdStar(q.sub(new V2(i * 0.3, 0.32)), 0.2, 0.9) + 0);
      void tips;
      const petals = Math.min(cup, Math.max(Math.abs(q.x) - 0.46, Math.max(q.y - 0.55 + Math.abs(Math.sin(q.x * 6.8)) * 0.22, -q.y)));
      c = shape(c, petals, t, px, p);
      break;
    }
    default: { // butterfly
      const q = new V2(Math.abs(p.x), p.y);
      const up = new V2((q.x - 0.38) / 0.36, (q.y - 0.22) / 0.42).magnitude - 1;
      const low = new V2((q.x - 0.3) / 0.26, (q.y + 0.35) / 0.28).magnitude - 1;
      const wings = Math.min(up * 0.36, low * 0.26);
      c = shape(c, wings, t, px, p);
      const spot = CasualArt.sdCircle(q, new V2(0.42, 0.26), 0.12);
      if (wings < 0) c = Color.lerp(c, Color.white, CasualArt.fill(spot, px) * 0.8);
      const body = CasualArt.sdBox(p, new V2(0.07, 0.5), 0.07);
      c = shape(c, body, Pal.hex(0x3a2a40), px, p);
      const ant = Math.min(CasualArt.sdSegment(q, new V2(0.02, 0.45), new V2(0.2, 0.78)) - 0.025, 9);
      c = shape(c, ant, Pal.hex(0x3a2a40), px, p);
      break;
    }
  }
  return c;
}

export const TileGardenArt = {
  Types: 12,
  TileAspect: 1.12, // height / width of the tile sprite (incl. base lip)
  Ink: Pal.hex(0x3a2a20),

  IconTint: [
    Pal.hex(0xf2465e), Pal.hex(0xffb627), Pal.hex(0x3fa2f5), Pal.hex(0x9b6bff), Pal.hex(0xff7a2e), Pal.hex(0x3db54a),
    Pal.hex(0xe8404a), Pal.hex(0xb0123a), Pal.hex(0xff8a1e), Pal.hex(0x2e9e5a), Pal.hex(0xff6fa8), Pal.hex(0x2fb8c9),
  ],

  /** Tile body: rounded ivory face with a jade-green base (3D lip at the bottom). */
  get Body(): Sprite { return CasualArt.make("tg-body", 128, 144, (p) => bodyPixel(p, false)); },

  /** Same silhouette in white, for shading (blocked tiles) and hit flashes. */
  get Mask(): Sprite { return CasualArt.make("tg-mask", 128, 144, (p) => bodyPixel(p, true)); },

  Icon(type: number): Sprite { return CasualArt.make("tg-icon-" + type, 128, 128, (p) => iconPixel(type, p, 2 / 128)); },

  /** Bamboo tray, 1 unit wide (stretched to fit 7 slots). */
  get Tray(): Sprite {
    return CasualArt.make("tg-tray", 512, 96, (p) => {
      const px = 2 / 512;
      const d = CasualArt.sdBox(p, new V2(0.99, 0.17), 0.06);
      const a = CasualArt.fill(d, px);
      if (a <= 0) return Clear;
      let wood = Color.lerp(Pal.hex(0xb98552), Pal.hex(0xe0b57f), CasualArt.smooth(-0.17, 0.17, p.y));
      const node = Math.abs(Mathf.repeat(p.x * 3.5, 1) - 0.5);
      wood = Color.lerp(CasualArt.darken(wood, 0.25), wood, CasualArt.smooth(0, 0.03, node));
      let c = Color.lerp(Pal.hex(0x7a5230), wood, CasualArt.fill(d + 0.02, px));
      const inner = CasualArt.sdBox(p, new V2(0.965, 0.135), 0.045);
      c = Color.lerp(c, Pal.hex(0x8c6239), CasualArt.fill(inner, px) * 0.85);
      return c.withAlpha(a);
    });
  },

  /** Empty slot well inside the tray. */
  get Slot(): Sprite {
    return CasualArt.make("tg-slot", 64, 64, (p) => {
      const d = CasualArt.sdBox(p, new V2(0.9, 0.9), 0.25);
      return new Color(0.35, 0.22, 0.12, CasualArt.fill(d, 2 / 64) * 0.55);
    });
  },

  /** Washi-paper backdrop with soft clouds and a pale sun. */
  get Paper(): Sprite {
    return CasualArt.make("tg-paper", 128, 256, (p) => {
      let c = Color.lerp(Pal.hex(0xf7e7d0), Pal.hex(0xfcefe2), CasualArt.smooth(-2, 2, p.y));
      const sun = CasualArt.smooth(0.55, 0.35, p.sub(new V2(0.45, 1.35)).magnitude);
      c = Color.lerp(c, Pal.hex(0xffc8b4), sun * 0.6);
      const fibre = Mathf.perlinNoise(p.x * 18, p.y * 9);
      c = Color.lerp(c, Pal.hex(0xe9d6bc), CasualArt.smooth(0.6, 0.9, fibre) * 0.35);
      // distant hills
      const h = -1.35 + 0.12 * Math.sin(p.x * 2.6 + 1) + 0.06 * Math.sin(p.x * 7);
      if (p.y < h) c = Color.lerp(c, Pal.hex(0xb9d8c2), 0.75);
      const h2 = -1.65 + 0.1 * Math.sin(p.x * 3.4 - 0.5);
      if (p.y < h2) c = Color.lerp(c, Pal.hex(0x8fc2a4), 0.85);
      return c.withAlpha(1);
    });
  },

  get Petal(): Sprite {
    return CasualArt.make("tg-petal", 48, 48, (p) => {
      let d = new V2(p.x / 0.55, (p.y + Math.abs(p.x) * 0.25) / 0.85).magnitude - 1;
      const notch = CasualArt.sdCircle(p, new V2(0, 0.95), 0.22);
      d = Math.max(d * 0.55, -notch);
      const c = Color.lerp(Pal.hex(0xffb7cf), Pal.hex(0xffe3ec), CasualArt.smooth(-0.8, 0.8, p.y));
      return c.withAlpha(CasualArt.fill(d, 2 / 48));
    });
  },
};
