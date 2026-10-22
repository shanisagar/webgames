import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";

/**
 * Procedural art for Car Escape: glossy top-down cars (sedans, sports cars, box trucks and buses) with windows,
 * headlights and tail lights, traffic cones and bollards, the parking-lot asphalt, the road around it and some trees.
 * Cars are drawn facing +x; one sprite is `len` cells long and one cell tall (scale = len × cell size).
 */

const Clear = new Color(1, 1, 1, 0);
const CellPx = 96;

const Glass = Pal.hex(0x223049), GlassHi = Pal.hex(0x6f8fbf);
const Head = Pal.hex(0xfff4c2), Tail = Pal.hex(0xff2e4a);

function bodyShade(base: Color, u: V2, hw: number) {
  // rounded sides: darker towards the edges, a soft highlight on the upper flank
  let c = Color.lerp(base, CasualArt.darken(base, 0.28), CasualArt.smooth(hw * 0.55, hw, Math.abs(u.y)));
  c = Color.lerp(c, CasualArt.lighten(base, 0.35), CasualArt.smooth(hw * 0.2, hw * 0.75, u.y) * (1 - CasualArt.smooth(hw * 0.75, hw, u.y)) * 0.35);
  return c;
}

function glass(c: Color, d: number, u: V2, px: number) {
  const a = CasualArt.fill(d, px);
  if (a <= 0) return c;
  let g = Color.lerp(Glass, GlassHi, CasualArt.smooth(-0.3, 0.35, u.y + u.x * 0.25) * 0.55);
  // diagonal reflection streak
  const streak = Math.abs(((u.x * 1.4 + u.y) % 0.5 + 0.5) % 0.5 - 0.25);
  g = Color.lerp(g, Color.white, CasualArt.smooth(0.05, 0.0, streak) * 0.25);
  return Color.lerp(c, g, a);
}

function lights(c: Color, u: V2, hl: number, px: number, wide = 0.26) {
  for (const s of [-1, 1]) {
    const hd = new V2((u.x - (hl - 0.05)) / 0.06, (u.y - s * wide) / 0.085).magnitude - 1;
    c = Color.lerp(c, Head, CasualArt.fill(hd * 0.06, px));
    const td = new V2((u.x + hl - 0.035) / 0.04, (u.y - s * (wide + 0.01)) / 0.08).magnitude - 1;
    c = Color.lerp(c, Tail, CasualArt.fill(td * 0.04, px));
  }
  return c;
}

function mirrors(u: V2, x: number, hw: number, base: Color, px: number): Color | null {
  for (const s of [-1, 1]) {
    const d = CasualArt.sdBox(u.sub(new V2(x, s * (hw + 0.035))), new V2(0.045, 0.05), 0.03);
    const a = CasualArt.fill(d, px);
    if (a > 0) return CasualArt.darken(base, 0.2).withAlpha(a);
  }
  return null;
}

function roofArrow(c: Color, u: V2, center: V2, px: number, k = 1, ink = Color.white) {
  const q = u.sub(center).mul(1 / k);
  const tip = new V2(0.08, 0);
  const d = Math.min(CasualArt.sdSegment(q, new V2(-0.07, 0.13), tip), CasualArt.sdSegment(q, new V2(-0.07, -0.13), tip)) - 0.038;
  const sh = Math.min(CasualArt.sdSegment(q.add(new V2(0.012, 0.015)), new V2(-0.07, 0.13), tip), CasualArt.sdSegment(q.add(new V2(0.012, 0.015)), new V2(-0.07, -0.13), tip)) - 0.038;
  c = Color.lerp(c, CasualArt.darken(c, 0.35), CasualArt.fill(sh * k, px) * 0.6);
  return Color.lerp(c, ink, CasualArt.fill(d * k, px) * 0.95);
}

export const CarEscapeArt = {
  Colors: [
    Pal.hex(0xff4757), Pal.hex(0x3d8bff), Pal.hex(0xffc531), Pal.hex(0x2ecc71),
    Pal.hex(0x9b6bff), Pal.hex(0xff8c2e), Pal.hex(0xff6fb5), Pal.hex(0x1fc8c8),
  ],

  /** A car `len` cells long (2 = car, 3 = truck/bus), facing +x. */
  Car(len: number, color: number, style: number) {
    const base = CarEscapeArt.Colors[color % CarEscapeArt.Colors.length];
    const w = CellPx * len, h = CellPx;
    return CasualArt.make(`ce-car-${len}-${color}-${style}`, w, h, (p) => {
      const u = p.mul(len * 0.5); // cell units, x along the car
      const px = len / w;
      const hl = len * 0.5 - 0.07;
      if (len >= 3 && style === 0) return CarEscapeArt.truckPixel(u, hl, base, px);
      if (len >= 3) return CarEscapeArt.busPixel(u, hl, base, px);
      const hw = 0.37;
      const d = CasualArt.sdBox(u, new V2(hl, hw), 0.18);
      const a = CasualArt.fill(d, px);
      if (a <= 0) return mirrors(u, hl - 0.78, hw, base, px) ?? Clear;
      let c = bodyShade(base, u, hw);
      // hood crease lines
      c = Color.lerp(c, CasualArt.darken(base, 0.12), CasualArt.fill(Math.abs(Math.abs(u.y) - 0.17) - 0.008, px) * CasualArt.smooth(hl - 0.5, hl - 0.4, u.x) * 0.5);
      // racing stripes (style 1)
      if (style === 1) c = Color.lerp(c, Color.white, CasualArt.fill(Math.abs(Math.abs(u.y) - 0.07) - 0.03, px) * 0.92);
      // cabin glass, then the roof on top of it
      const cabin = CasualArt.sdBox(u.sub(new V2(-0.12, 0)), new V2(0.52, 0.3), 0.14);
      c = glass(c, cabin, u, px);
      const roof = CasualArt.sdBox(u.sub(new V2(-0.16, 0)), new V2(0.3, 0.26), 0.1);
      let rc = Color.lerp(CasualArt.lighten(base, 0.12), base, CasualArt.smooth(0.0, 0.26, Math.abs(u.y)) * 0.6);
      rc = Color.lerp(rc, CasualArt.lighten(base, 0.45), CasualArt.smooth(0.06, 0.2, u.y) * (1 - CasualArt.smooth(0.2, 0.25, u.y)) * 0.5);
      if (style === 1) rc = Color.lerp(rc, Color.white, CasualArt.fill(Math.abs(Math.abs(u.y) - 0.07) - 0.03, px) * 0.92);
      c = Color.lerp(c, rc, CasualArt.fill(roof, px));
      c = roofArrow(c, u, new V2(-0.14, 0), px, 1, style === 1 ? Pal.hex(0x2b2f38) : Color.white);
      c = lights(c, u, hl, px);
      // dark rim
      c = Color.lerp(CasualArt.darken(base, 0.5), c, CasualArt.fill(d + 0.028, px));
      return c.withAlpha(a);
    });
  },

  truckPixel(u: V2, hl: number, base: Color, px: number) {
    const hw = 0.4;
    const cabX0 = hl - 0.86; // cab from cabX0 to hl
    const box = CasualArt.sdBox(u.sub(new V2((-hl + cabX0 - 0.06) * 0.5, 0)), new V2((cabX0 - 0.06 + hl) * 0.5, hw), 0.06);
    const cab = CasualArt.sdBox(u.sub(new V2((cabX0 + hl) * 0.5, 0)), new V2((hl - cabX0) * 0.5, hw - 0.04), 0.16);
    const hitch = CasualArt.sdBox(u.sub(new V2(cabX0 - 0.04, 0)), new V2(0.06, 0.12), 0.02);
    const d = Math.min(box, cab, hitch);
    const a = CasualArt.fill(d, px);
    if (a <= 0) return mirrors(u, hl - 0.5, hw - 0.04, base, px) ?? Clear;
    let c: Color;
    if (box <= cab && box <= hitch) {
      // white cargo box with roof ribs and a coloured stripe on each side
      c = Color.lerp(Pal.hex(0xf4f6fa), Pal.hex(0xc9d0dc), CasualArt.smooth(hw * 0.6, hw, Math.abs(u.y)));
      const rib = Math.abs(((u.x * 3.2) % 1 + 1) % 1 - 0.5);
      c = Color.lerp(c, Pal.hex(0xd5dbe5), CasualArt.smooth(0.06, 0.02, rib) * 0.7);
      c = Color.lerp(c, base, CasualArt.fill(Math.abs(Math.abs(u.y) - 0.31) - 0.035, px));
      c = roofArrow(c, u, new V2((-hl + cabX0) * 0.5, 0), px, 1.3, base);
      c = Color.lerp(Pal.hex(0x8a93a3), c, CasualArt.fill(box + 0.025, px));
      for (const s of [-1, 1]) {
        const td = new V2((u.x + hl - 0.03) / 0.035, (u.y - s * 0.32) / 0.06).magnitude - 1;
        c = Color.lerp(c, Tail, CasualArt.fill(td * 0.035, px));
      }
    } else if (cab <= hitch) {
      c = bodyShade(base, u, hw - 0.04);
      const ws = CasualArt.sdBox(u.sub(new V2(hl - 0.36, 0)), new V2(0.1, 0.29), 0.06);
      c = glass(c, ws, u, px);
      const roof = CasualArt.sdBox(u.sub(new V2(cabX0 + 0.26, 0)), new V2(0.22, 0.28), 0.08);
      c = Color.lerp(c, CasualArt.lighten(base, 0.18), CasualArt.fill(roof, px));
      c = lights(c, u, hl, px, 0.25);
      c = Color.lerp(CasualArt.darken(base, 0.5), c, CasualArt.fill(cab + 0.028, px));
    } else c = Pal.hex(0x3a3f4a);
    return c.withAlpha(a);
  },

  busPixel(u: V2, hl: number, base: Color, px: number) {
    const hw = 0.39;
    const d = CasualArt.sdBox(u, new V2(hl, hw), 0.14);
    const a = CasualArt.fill(d, px);
    if (a <= 0) return mirrors(u, hl - 0.2, hw, base, px) ?? Clear;
    let c = bodyShade(base, u, hw);
    // side window strips
    const strip = CasualArt.sdBox(u.sub(new V2(-0.12, 0)), new V2(hl - 0.3, 0.33), 0.06);
    c = glass(c, strip, u, px);
    // white roof with skylights and an AC unit
    const roof = CasualArt.sdBox(u.sub(new V2(-0.1, 0)), new V2(hl - 0.36, 0.25), 0.08);
    let rc = Color.lerp(Pal.hex(0xf7f8fb), Pal.hex(0xdde2ea), CasualArt.smooth(0.1, 0.25, Math.abs(u.y)));
    for (let i = -1; i <= 1; i += 2) {
      const sky = CasualArt.sdBox(u.sub(new V2(i * 0.62 - 0.1, 0)), new V2(0.16, 0.12), 0.04);
      rc = glass(rc, sky, u, px);
    }
    const ac = CasualArt.sdBox(u.sub(new V2(-0.1, 0)), new V2(0.2, 0.15), 0.05);
    rc = Color.lerp(rc, Color.lerp(Pal.hex(0xaab3c2), Pal.hex(0xc7cfdb), CasualArt.smooth(-0.15, 0.15, u.y)), CasualArt.fill(ac, px));
    rc = Color.lerp(rc, Pal.hex(0x8d97a8), CasualArt.fill(Math.abs(ac) - 0.012, px) * 0.6);
    rc = roofArrow(rc, u, new V2(0.23, 0), px, 0.9, base);
    c = Color.lerp(c, rc, CasualArt.fill(roof, px));
    // front windshield
    const ws = CasualArt.sdBox(u.sub(new V2(hl - 0.17, 0)), new V2(0.08, 0.31), 0.05);
    c = glass(c, ws, u, px);
    c = lights(c, u, hl, px, 0.27);
    c = Color.lerp(CasualArt.darken(base, 0.5), c, CasualArt.fill(d + 0.028, px));
    return c.withAlpha(a);
  },

  /** Soft drop shadow for a car (black, alpha in the sprite). */
  Shadow(len: number) {
    return CasualArt.make(`ce-shadow-${len}`, 48 * len, 48, (p) => {
      const u = p.mul(len * 0.5);
      const d = CasualArt.sdBox(u, new V2(len * 0.5 - 0.1, 0.36), 0.2);
      return new Color(0, 0, 0, CasualArt.smooth(0.1, -0.06, d) * 0.4);
    });
  },

  /** Traffic cone (kind 0) or a striped bollard (kind 1), seen from above. */
  Cone(kind: number) {
    return CasualArt.make(`ce-cone-${kind}`, 96, 96, (p) => {
      const px = 2 / 96;
      const r = p.magnitude;
      if (kind === 0) {
        const base = CasualArt.sdBox(p, new V2(0.72, 0.72), 0.2);
        let c = Clear;
        const ba = CasualArt.fill(base, px);
        if (ba > 0) c = Color.lerp(Pal.hex(0xc94d12), Pal.hex(0xe0601c), CasualArt.smooth(-0.7, 0.7, p.y)).withAlpha(ba);
        const cone = r - 0.56;
        const ca = CasualArt.fill(cone, px);
        if (ca > 0) {
          let k = Color.lerp(Pal.hex(0xff7a1f), Pal.hex(0xffa04d), CasualArt.smooth(0.5, -0.3, p.x - p.y * 0.6));
          k = Color.lerp(k, Color.white, CasualArt.fill(Math.abs(r - 0.33) - 0.07, px));
          k = Color.lerp(k, Pal.hex(0xd9530f), CasualArt.fill(r - 0.13, px));
          k = Color.lerp(k, Pal.hex(0xffc18a), CasualArt.fill(new V2(p.x + 0.04, p.y - 0.05).magnitude - 0.06, px));
          c = CasualArt.over(c, k.withAlpha(1), ca);
        }
        return c;
      }
      const a = CasualArt.fill(r - 0.62, px);
      if (a <= 0) return Clear;
      const ang = Math.atan2(p.y, p.x);
      let c = (Math.floor((ang / Math.PI) * 4 + 8) % 2 === 0) ? Pal.hex(0xffd23f) : Pal.hex(0x2b2f38);
      c = Color.lerp(c, Pal.hex(0xd8dde6), CasualArt.fill(r - 0.4, px));
      c = Color.lerp(c, Color.white, CasualArt.fill(new V2(p.x + 0.12, p.y - 0.14).magnitude - 0.12, px) * 0.7);
      c = Color.lerp(Pal.hex(0x1d2028), c, CasualArt.fill(r - 0.6, px));
      return c.withAlpha(a);
    });
  },

  /** One asphalt parking bay: subtle noise and painted corner marks. */
  get Bay() {
    return CasualArt.make("ce-bay", 96, 96, (p) => {
      const n = Mathf.perlinNoise(p.x * 3.1 + 7, p.y * 3.1 + 2) * 0.5 + Mathf.perlinNoise(p.x * 11, p.y * 11) * 0.5;
      let c = Color.lerp(Pal.hex(0x4a5263), Pal.hex(0x555e70), n);
      const e = Math.max(Math.abs(p.x), Math.abs(p.y));
      // thin painted lines along the bay edges, brighter at the corners
      const line = CasualArt.smooth(0.925, 0.965, e);
      const cx = Math.abs(p.x) > 0.62 && Math.abs(p.y) > 0.62 ? 1 : 0;
      const corner = cx * CasualArt.smooth(0.88, 0.94, e);
      c = Color.lerp(c, Color.white, line * 0.12 + corner * 0.28);
      return c.withAlpha(1);
    });
  },

  /** Road tile (1×1, along x): dark asphalt, white edge lines and a dashed centre line. */
  get Road() {
    return CasualArt.make("ce-road", 128, 128, (p) => {
      const n = Mathf.perlinNoise(p.x * 5 + 3, p.y * 5) * 0.5 + 0.5;
      let c = Color.lerp(Pal.hex(0x353b48), Pal.hex(0x3d4452), n);
      c = Color.lerp(c, Pal.hex(0xe8ecf2), CasualArt.fill(Math.abs(Math.abs(p.y) - 0.84) - 0.035, 2 / 128) * 0.85);
      const dash = Math.abs(p.x) < 0.5 ? 1 : 0;
      c = Color.lerp(c, Pal.hex(0xffd34d), dash * CasualArt.fill(Math.abs(p.y) - 0.04, 2 / 128));
      c = Color.lerp(c, Pal.hex(0x2a2f3a), CasualArt.smooth(0.94, 1, Math.abs(p.y)));
      return c.withAlpha(1);
    });
  },

  /** Plain asphalt square for crossings. */
  get Crossing() {
    return CasualArt.make("ce-cross", 64, 64, (p) => {
      const n = Mathf.perlinNoise(p.x * 3 + 9, p.y * 3) * 0.5 + 0.5;
      return Color.lerp(Pal.hex(0x353b48), Pal.hex(0x3d4452), n).withAlpha(1);
    });
  },

  /** Round tree canopy seen from above with a soft shadow baked in. */
  Tree(kind: number) {
    const tones = [[0x3fae4f, 0x7ad65a], [0x2f9a62, 0x63c98a], [0x5cb83a, 0xa6e05a]][kind % 3];
    return CasualArt.make(`ce-tree-${kind}`, 128, 128, (p) => {
      const px = 2 / 128;
      const sh = new V2(p.x - 0.1, p.y + 0.12).magnitude - 0.8;
      let c = new Color(0, 0, 0, CasualArt.smooth(0.12, -0.1, sh) * 0.28);
      // bumpy canopy: a few lobes
      let d = 9;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + kind;
        d = Math.min(d, CasualArt.sdCircle(p, new V2(Math.cos(a) * 0.38, Math.sin(a) * 0.38 + 0.04), 0.4));
      }
      d = Math.min(d, CasualArt.sdCircle(p, new V2(0, 0.04), 0.5));
      const a = CasualArt.fill(d, px);
      if (a <= 0) return c;
      const q = p.sub(new V2(0, 0.04));
      let g = Color.lerp(Pal.hex(tones[0]), Pal.hex(tones[1]), CasualArt.smooth(-0.6, 0.6, q.y - q.x * 0.5));
      g = Color.lerp(g, CasualArt.darken(Pal.hex(tones[0]), 0.3), CasualArt.smooth(-0.06, 0, d) * 0.6);
      for (let i = 0; i < 4; i++) {
        const b = CasualArt.sdCircle(p, new V2(-0.25 + (i % 2) * 0.32, 0.28 - Math.floor(i / 2) * 0.34), 0.13);
        g = Color.lerp(g, CasualArt.lighten(Pal.hex(tones[1]), 0.25), CasualArt.fill(b, px) * 0.35);
      }
      c = CasualArt.over(c, g.withAlpha(1), a);
      return c;
    });
  },

  /** Small round bush / flower bed. */
  get Bush() {
    return CasualArt.make("ce-bush", 64, 64, (p) => {
      const px = 2 / 64;
      let c = new Color(0, 0, 0, CasualArt.smooth(0.1, -0.1, new V2(p.x - 0.08, p.y + 0.1).magnitude - 0.75) * 0.25);
      const d = p.magnitude - 0.72;
      const a = CasualArt.fill(d, px);
      if (a <= 0) return c;
      let g = Color.lerp(Pal.hex(0x3d9c44), Pal.hex(0x6cc650), CasualArt.smooth(-0.6, 0.6, p.y - p.x * 0.4));
      for (let i = 0; i < 5; i++) {
        const an = i * 1.3 + 0.4;
        const f = CasualArt.sdCircle(p, new V2(Math.cos(an) * 0.4, Math.sin(an) * 0.4), 0.09);
        g = Color.lerp(g, [Pal.hex(0xff7fa8), Pal.hex(0xffe066), Color.white][i % 3], CasualArt.fill(f, px));
      }
      c = CasualArt.over(c, g.withAlpha(1), a);
      return c;
    });
  },

  /** Curb (concrete edge) tile, 1 unit square; stretch it. */
  get Curb() {
    return CasualArt.make("ce-curb", 32, 32, (p) => Color.lerp(Pal.hex(0xc9ced8), Pal.hex(0xeef1f6), CasualArt.smooth(-1, 1, p.y)).withAlpha(1));
  },

  /** Grass background (stretched by CasualLook.fitCover). */
  get Grass() {
    return CasualArt.make("ce-grass", 128, 256, (p) => {
      const t = (p.y + 2) / 4;
      let c = Color.lerp(Pal.hex(0x6cc35a), Pal.hex(0x8bd66a), CasualArt.smooth(0, 1, t));
      const n = Mathf.perlinNoise(p.x * 6 + 4, p.y * 6 + 1);
      c = Color.lerp(c, Pal.hex(0x5bb24c), n * 0.35);
      return c.withAlpha(1);
    });
  },

  /** Arrow (white, tint it) pointing +x for hints. */
  get Arrow() {
    return CasualArt.make("ce-arrow", 96, 96, (p) => {
      const px = 2 / 96;
      const head = Math.max(Math.abs(p.y) * 1.05 + (p.x - 0.75), -(p.x + 0.05));
      const shaft = CasualArt.sdBox(p.sub(new V2(-0.45, 0)), new V2(0.42, 0.2), 0.08);
      const d = Math.min(head, shaft);
      return new Color(1, 1, 1, CasualArt.fill(d, px));
    });
  },

  /** Ring for the hint / selection highlight around a car (stretch it). */
  get Halo() {
    return CasualArt.make("ce-halo", 192, 96, (p) => {
      const u = p.mul(2);
      const d = CasualArt.sdBox(u, new V2(1.84, 0.84), 0.4);
      const ring = Math.abs(d) - 0.07;
      return new Color(1, 1, 1, CasualArt.fill(ring, 4 / 192) + CasualArt.smooth(0.35, 0, d) * (d > 0 ? 0.4 : 0));
    });
  },

  /** Tow hook icon (white). */
  get Hook() {
    return CasualArt.make("ce-hook", 96, 96, (p) => {
      const px = 2 / 96;
      const shank = CasualArt.sdBox(p.sub(new V2(0, 0.35)), new V2(0.1, 0.45), 0.05);
      const ring = Math.abs(CasualArt.sdCircle(p, new V2(0, 0.85), 0.14)) - 0.06;
      const hookArc = Math.abs(CasualArt.sdCircle(p, new V2(-0.22, -0.18), 0.32)) - 0.1;
      const cut = p.y > -0.18 && p.x < -0.12 ? 1 : 0;
      const d = Math.min(shank, ring, cut ? 9 : hookArc);
      return new Color(1, 1, 1, CasualArt.fill(d, px));
    });
  },
};
