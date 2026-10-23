import { CasualArt, Color, Mathf, Pal, SysRandom, V2 } from "../../kit";

/** Procedural sprites for KITE CLASH: golden-hour sky, rooftops, people, fighter kites, birds and charms. */

export interface KiteDesign { name: string; cost: number; a: Color; b: Color; c: Color; pattern: number }
export interface StringStyle { name: string; cost: number; color: Color; glint: boolean }

export const Designs: KiteDesign[] = [
  { name: "CLASSIC RED", cost: 0, a: Pal.hex(0xe8303a), b: Pal.hex(0xfff2d8), c: Pal.hex(0xffc93c), pattern: 0 },
  { name: "MOON EYE", cost: 60, a: Pal.hex(0x2b3fa0), b: Pal.hex(0xffe066), c: Pal.hex(0x14163a), pattern: 1 },
  { name: "TIGER", cost: 90, a: Pal.hex(0xff8a1a), b: Pal.hex(0x2a1608), c: Pal.hex(0xfff2d8), pattern: 2 },
  { name: "PEACOCK", cost: 120, a: Pal.hex(0x13a8a0), b: Pal.hex(0x1d4fd6), c: Pal.hex(0xffd23f), pattern: 3 },
  { name: "CHEQUER", cost: 160, a: Pal.hex(0x22b85c), b: Pal.hex(0xfff8ec), c: Pal.hex(0xe8303a), pattern: 4 },
  { name: "SUNBURST", cost: 200, a: Pal.hex(0xffcf1f), b: Pal.hex(0xff5a1f), c: Pal.hex(0xfff8ec), pattern: 5 },
  { name: "LOTUS", cost: 260, a: Pal.hex(0xff5fa2), b: Pal.hex(0xfff3f8), c: Pal.hex(0xffc93c), pattern: 6 },
  { name: "RAINBOW", cost: 320, a: Pal.hex(0xffffff), b: Pal.hex(0xffffff), c: Pal.hex(0xffffff), pattern: 7 },
  { name: "NIGHT STAR", cost: 400, a: Pal.hex(0x1d1646), b: Pal.hex(0x6a4cff), c: Pal.hex(0xffd23f), pattern: 8 },
];

export const Strings: StringStyle[] = [
  { name: "COTTON", cost: 0, color: Pal.hex(0xfffaf0), glint: false },
  { name: "SAFFRON", cost: 40, color: Pal.hex(0xff9a2e), glint: false },
  { name: "MINT", cost: 40, color: Pal.hex(0x3fe0b0), glint: false },
  { name: "ROYAL BLUE", cost: 70, color: Pal.hex(0x3d6bff), glint: false },
  { name: "RUBY", cost: 90, color: Pal.hex(0xff2d55), glint: false },
  { name: "GOLD THREAD", cost: 180, color: Pal.hex(0xffd34d), glint: true },
];

export const HouseCols = [0xe07a5f, 0xf2c14e, 0x4fb3a9, 0xef8fb3, 0x7fb7e6, 0xf3e3c3, 0xb39ddb, 0x8fd6a6].map((h) => Pal.hex(h));
export const ClothCols = [0xe8303a, 0x2b6cff, 0xffc93c, 0x22b85c, 0xff5fa2, 0x8a4dff, 0xff8a1a].map((h) => Pal.hex(h));
export const Confetti = [0xff3d6e, 0xffc93c, 0x3fe0b0, 0x3d8bff, 0xff8a1a, 0xffffff, 0xb46bff].map((h) => Pal.hex(h));

const fill = CasualArt.fill, smooth = CasualArt.smooth;
const over = CasualArt.over;
const dark = (c: Color, k: number) => CasualArt.darken(c, k);
const light = (c: Color, k: number) => CasualArt.lighten(c, k);

/** Signed distance to a convex polygon (counter-clockwise points). */
function sdPoly(p: V2, pts: V2[]) {
  let d = Infinity, inside = true;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j], b = pts[i];
    d = Math.min(d, CasualArt.sdSegment(p, a, b));
    const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cr < 0) inside = false;
  }
  return inside ? -d : d;
}

const KT = new V2(0, 1.17), KR = new V2(0.95, 0.32), KB = new V2(0, -0.9), KL = new V2(-0.95, 0.32);
const KC = new V2(0, 0.32);
const Kite4 = [KB, KR, KT, KL];
const Stick = Pal.hex(0x6b4426);

function patternColor(d: KiteDesign, p: V2): Color {
  const q = p.sub(KC);
  switch (d.pattern) {
    case 0: {
      let c = p.y > 0.32 + Math.abs(p.x) * 0.05 ? d.a : d.b;
      if (q.magnitude < 0.22) c = d.c;
      if (p.y < -0.35 && Math.abs(p.x) < 0.42 + p.y * 0.5 + 0.16) c = d.a;
      return c;
    }
    case 1: {
      let c = d.a;
      const r = new V2(q.x, q.y - 0.05).magnitude;
      if (r < 0.46) c = d.b;
      if (new V2(q.x - 0.14, q.y - 0.12).magnitude < 0.4 && r < 0.46) c = d.a; // crescent
      if (new V2(q.x, q.y + 0.42).magnitude < 0.13) c = d.b;
      return c;
    }
    case 2: {
      const s = Math.sin((p.x * 1.1 + p.y) * 9.5 + Math.sin(p.y * 7) * 0.6);
      let c = s > 0.45 ? d.b : d.a;
      if (q.magnitude < 0.17) c = d.c;
      return c;
    }
    case 3: {
      const l = Math.abs(q.x) / 0.95 + (q.y > 0 ? q.y / 0.85 : -q.y / 1.22);
      const band = Math.floor(l * 4.2);
      let c = band % 2 === 0 ? d.a : d.b;
      if (l < 0.22) c = d.c;
      return c;
    }
    case 4: {
      let c = (p.x > 0) !== (p.y > 0.32) ? d.a : d.b;
      if (q.magnitude < 0.2) c = d.c;
      return c;
    }
    case 5: {
      const ang = Math.atan2(q.y, q.x);
      let c = Math.sin(ang * 8) > 0 ? d.a : d.b;
      if (q.magnitude < 0.27) c = d.c;
      if (q.magnitude < 0.19) c = d.a;
      return c;
    }
    case 6: {
      let c = d.a;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.26;
        const dir = V2.fromAngle(a), loc = new V2(V2.dot(q, dir) - 0.3, V2.dot(q, V2.perpendicular(dir)));
        if ((loc.x / 0.28) ** 2 + (loc.y / 0.13) ** 2 < 1) c = d.b;
      }
      if (q.magnitude < 0.15) c = d.c;
      return c;
    }
    case 7: {
      const cols = [0xff3d55, 0xff9a2e, 0xffd23f, 0x3fd06a, 0x3d8bff, 0x8a4dff];
      const k = Mathf.clamp(Math.floor((1.17 - p.y) / 2.07 * 6), 0, 5);
      return Pal.hex(cols[k]);
    }
    default: {
      let c = Color.lerp(d.a, d.b, smooth(-0.9, 1.2, p.y) * 0.6);
      const st = CasualArt.sdStar(new V2(q.x, q.y - 0.02).mul(1 / 0.42), 0.92, 0.45);
      if (st < 0) c = d.c;
      for (const s of [new V2(-0.42, 0.62), new V2(0.38, -0.25), new V2(0.5, 0.5), new V2(-0.3, -0.3)]) if (V2.distance(p, s) < 0.05) c = d.c;
      return c;
    }
  }
}

export const KiteArt = {
  /** A diamond fighter kite, nose up, with spine, bow and a little tail flap. 1 unit wide. */
  Kite(i: number) {
    const d = Designs[Mathf.clamp(i, 0, Designs.length - 1)];
    return CasualArt.make("kc-kite-" + i, 128, 160, (p) => {
      const px = 2 / 128;
      const sd = sdPoly(p, Kite4);
      const flap = sdPoly(p, [new V2(0, -0.82), new V2(-0.24, -1.2), new V2(0.24, -1.2)]);
      let out = Color.clear;
      if (flap < px) {
        let fc = d.pattern === 7 ? Pal.hex(0xffd23f) : d.c;
        if (Math.abs(p.x) < 0.02) fc = dark(fc, 0.2);
        out = dark(fc, 0.05).withAlpha(fill(flap, px));
      }
      if (sd > px * 1.5) return out;
      let c = patternColor(d, p);
      // paper sheen, edge tape, sticks
      c = Color.lerp(c, light(c, 0.35), smooth(0.4, -0.6, p.x + (1 - p.y) * 0.5) * 0.22);
      c = Color.lerp(c, dark(c, 0.25), smooth(-0.2, 0.9, p.x - p.y * 0.3) * 0.25);
      c = c.mul(0.97 + 0.03 * Math.sin(p.x * 61 + p.y * 37));
      const bow = 0.32 + 0.3 * (1 - (p.x / 0.95) ** 2);
      if (Math.abs(p.x) < 0.028 && p.y < 1.12) c = Color.lerp(c, Stick, 0.85);
      if (Math.abs(p.y - bow) < 0.024 && Math.abs(p.x) < 0.9) c = Color.lerp(c, Stick, 0.8);
      const edgeCol = d.pattern === 7 ? Pal.hex(0xfff8ec) : d.pattern === 0 ? dark(d.a, 0.35) : dark(d.a, 0.4);
      c = Color.lerp(c, edgeCol, smooth(-0.07, -0.045, sd));
      return over(out, c.withAlpha(1), fill(sd, px));
    }, 0, 0);
  },

  /** Background sky gradient (stretched to the screen). */
  Sky() {
    const s0 = Pal.hex(0x3a68d2), s1 = Pal.hex(0x8f86de), s2 = Pal.hex(0xff9d84), s3 = Pal.hex(0xffd67c);
    return CasualArt.make("kc-sky", 32, 256, (p) => {
      const t = (p.y + 8) / 16; // 0 bottom .. 1 top
      let c: Color;
      if (t > 0.62) c = Color.lerp(s1, s0, smooth(0.62, 1, t));
      else if (t > 0.3) c = Color.lerp(s2, s1, smooth(0.3, 0.62, t));
      else c = Color.lerp(s3, s2, smooth(0.05, 0.3, t));
      return c.withAlpha(1);
    });
  },

  Cloud(v: number) {
    const rng = new SysRandom(30 + v);
    const puffs: [V2, number][] = [];
    const n = 6 + v;
    for (let i = 0; i < n; i++) {
      const x = -0.7 + (1.4 * i) / (n - 1) + (rng.nextDouble() - 0.5) * 0.15;
      const r = 0.2 + 0.18 * Math.sin((i / (n - 1)) * Math.PI) + rng.nextDouble() * 0.08;
      puffs.push([new V2(x, -0.2 + r * 0.55 + (rng.nextDouble() - 0.5) * 0.06), r]);
    }
    return CasualArt.make("kc-cloud-" + v, 256, 128, (p) => {
      let d = Math.max(-p.y - 0.28, -10);
      let u = Infinity;
      for (const [c, r] of puffs) u = Math.min(u, V2.distance(p, c) - r);
      d = Math.max(u, -p.y - 0.3);
      const a = smooth(0.03, -0.03, d);
      if (a <= 0) return Color.clear;
      const c = Color.lerp(Pal.hex(0xffc9b8), Pal.hex(0xfffaf2), smooth(-0.3, 0.35, p.y));
      return c.withAlpha(a);
    });
  },

  /** Hazy far skyline with domes and water tanks (tileable). */
  Skyline(v: number) {
    const rng = new SysRandom(70 + v);
    const blocks: { x0: number; x1: number; h: number; kind: number }[] = [];
    let x = -1;
    while (x < 1) {
      const w = 0.08 + rng.nextDouble() * 0.16;
      blocks.push({ x0: x, x1: Math.min(1, x + w), h: -0.15 + rng.nextDouble() * 0.38, kind: rng.next(6) });
      x += w;
    }
    const col = Pal.hex(0xc18bb5);
    return CasualArt.make("kc-skyline-" + v, 256, 128, (p) => {
      let inside = p.y < -0.4 ? 1 : 0;
      for (const b of blocks) {
        if (p.x < b.x0 - 0.05 || p.x > b.x1 + 0.05) continue;
        const cx = (b.x0 + b.x1) / 2, hw = (b.x1 - b.x0) / 2;
        let s = 0;
        if (Math.abs(p.x - cx) < hw && p.y < b.h) s = 1;
        if (b.kind === 0 && V2.distance(p, new V2(cx, b.h)) < hw * 0.75) s = 1; // dome
        if (b.kind === 1 && Math.abs(p.x - cx) < 0.012 && p.y < b.h + 0.22) s = 1; // spire
        if (b.kind === 1 && V2.distance(p, new V2(cx, b.h + 0.06)) < 0.035) s = 1;
        if (b.kind === 2 && Math.abs(p.x - cx - hw * 0.4) < hw * 0.3 && p.y < b.h + 0.07) s = 1; // tank
        inside = Math.max(inside, s);
      }
      if (!inside) return Color.clear;
      const c = Color.lerp(col, Pal.hex(0xf0b0a8), smooth(-0.5, 0.4, p.y) * 0.5);
      const win = (Math.sin(p.x * 160) > 0.7 && Math.sin(p.y * 120) > 0.6 && p.y < 0.1) ? 0.06 : 0;
      return light(c, win).withAlpha(0.95);
    });
  },

  /** A flat-roofed house: parapet roof line at 92.5% of the height, railing or water tank above. 1 x 2 units. */
  House(col: number, style: number) {
    const W = HouseCols[col % HouseCols.length];
    return CasualArt.make("kc-house-" + col + "-" + style, 128, 256, (p) => {
      const px = 2 / 128, roof = 1.7;
      // above the roof: railing / tank / nothing
      if (p.y > roof) {
        if (style === 0) {
          const post = Math.abs(((p.x + 1) % 0.25) - 0.125) < 0.018 && p.y < roof + 0.22;
          const bar = Math.abs(p.y - (roof + 0.2)) < 0.022 && Math.abs(p.x) < 0.98;
          if (post || bar) return Pal.hex(0xf4ece0).withAlpha(1);
        } else if (style === 1) {
          const t = CasualArt.sdBox(p.sub(new V2(0.58, roof + 0.17)), new V2(0.22, 0.17), 0.05);
          if (t < px) {
            let c = Pal.hex(0x5a6d85);
            c = Color.lerp(c, light(c, 0.3), smooth(0.7, 0.4, p.x));
            if (Math.abs(p.y - roof - 0.17) < 0.02) c = dark(c, 0.2);
            return c.withAlpha(fill(t, px));
          }
          const leg = Math.abs(Math.abs(p.x - 0.58) - 0.16) < 0.02;
          if (leg && p.y < roof + 0.05) return Pal.hex(0x3d4655).withAlpha(1);
        } else if (style === 2) {
          // a little stair hut
          const h = CasualArt.sdBox(p.sub(new V2(-0.55, roof + 0.13)), new V2(0.3, 0.13), 0.02);
          if (h < 0) return (Math.abs(p.x + 0.55) < 0.09 && p.y < roof + 0.2 ? dark(W, 0.45) : dark(W, 0.08)).withAlpha(1);
        }
        return Color.clear;
      }
      let c = W;
      c = Color.lerp(c, dark(W, 0.18), smooth(0.55, 1, p.x));    // side in shade (sun from the left)
      c = Color.lerp(c, light(W, 0.1), smooth(-0.4, -1, p.x) * 0.6);
      c = Color.lerp(c, dark(W, 0.22), smooth(0.8, -2, p.y) * 0.5); // darker towards the street
      // parapet
      if (p.y > roof - 0.1) c = light(W, 0.32);
      else if (p.y > roof - 0.17) c = dark(W, 0.25);
      // windows
      const rows = [1.05, 0.05, -0.95];
      for (let r = 0; r < rows.length; r++)
        for (const wx of [-0.45, 0.45]) {
          const q = p.sub(new V2(wx, rows[r]));
          const arch = style === 1 ? Math.max(0, q.y - 0.12) * 0 : 0;
          const wd = style === 1 ? Math.min(CasualArt.sdBox(q.add(new V2(0, 0.08)), new V2(0.2, 0.22), 0.02), V2.distance(q, new V2(0, 0.14)) - 0.2) : CasualArt.sdBox(q, new V2(0.2, 0.3), 0.03);
          void arch;
          if (wd < 0.06) {
            if (wd > 0) c = Pal.hex(0xfff3e2); // frame
            else {
              const lit = ((col * 7 + r * 3 + (wx > 0 ? 1 : 0) * 5 + style) % 4) === 0;
              let g = lit ? Pal.hex(0xffd47a) : Color.lerp(Pal.hex(0x2d4a63), Pal.hex(0x6aa0c4), smooth(-0.3, 0.3, q.x + q.y * 0.5));
              if (Math.abs(q.x) < 0.015) g = Pal.hex(0xfff3e2);
              c = g;
            }
          }
          // shutters
          const sh = Math.abs(Math.abs(q.x) - 0.3) < 0.08 && Math.abs(q.y) < 0.28;
          if (sh && style === 0) c = Color.lerp(dark(W, 0.35), Pal.hex(0x2f7a6a), 0.5);
        }
      return c.withAlpha(fill(Math.abs(p.x) - 1, px));
    });
  },

  /** A person on a roof: pose 0 flies a kite (arm up), 1 stands, 2 cheers. Feet at the bottom. */
  Person(pose: number, col: number) {
    const cloth = ClothCols[col % ClothCols.length];
    const skin = [Pal.hex(0xc98b5e), Pal.hex(0x9a6440), Pal.hex(0xe0a77c)][col % 3];
    return CasualArt.make("kc-person-" + pose + "-" + col, 64, 96, (p) => {
      const px = 2 / 64;
      const head = V2.distance(p, new V2(0, 1.08)) - 0.27;
      const body = CasualArt.sdBox(p.sub(new V2(0, 0.28)), new V2(0.3, 0.46), 0.14);
      const legs = Math.min(CasualArt.sdSegment(p, new V2(-0.13, -0.15), new V2(-0.15, -1.38)) - 0.1, CasualArt.sdSegment(p, new V2(0.13, -0.15), new V2(0.15, -1.38)) - 0.1);
      const sh = [new V2(-0.27, 0.6), new V2(0.27, 0.6)];
      const hands = pose === 0 ? [new V2(-0.42, -0.05), new V2(0.62, 1.32)] : pose === 1 ? [new V2(-0.36, -0.12), new V2(0.36, -0.12)] : [new V2(-0.62, 1.36), new V2(0.62, 1.36)];
      const arms = Math.min(CasualArt.sdSegment(p, sh[0], hands[0]), CasualArt.sdSegment(p, sh[1], hands[1])) - 0.09;
      const handD = Math.min(V2.distance(p, hands[0]), V2.distance(p, hands[1])) - 0.11;
      const all = Math.min(head, body, legs, arms, handD);
      if (all > 0.07) return Color.clear;
      const ink = Pal.hex(0x2a1c2c);
      if (all > 0) return ink.withAlpha(fill(all - 0.07, px));
      let c = cloth;
      if (legs < 0 && body > 0) c = Pal.hex(0x3b3552);
      if (arms < 0) c = dark(cloth, 0.12);
      if (handD < 0) c = skin;
      if (head < 0) { c = skin; if (p.y > 1.12 + p.x * 0.15) c = Pal.hex(0x2a1a12); }
      if (body < 0 && arms > 0) c = Color.lerp(c, light(cloth, 0.25), smooth(0.1, -0.3, p.x) * 0.5);
      return c.withAlpha(1);
    });
  },

  Bird(frame: number) {
    return CasualArt.make("kc-bird-" + frame, 64, 40, (p) => {
      const px = 2 / 64, wy = frame === 0 ? 0.42 : -0.18, mid = frame === 0 ? 0.05 : 0.1;
      const w1 = CasualArt.sdSegment(p, new V2(-0.88, wy), new V2(-0.12, mid)) - 0.07 * (1 - Math.abs(p.x) * 0.5);
      const w2 = CasualArt.sdSegment(p, new V2(0.88, wy), new V2(0.12, mid)) - 0.07 * (1 - Math.abs(p.x) * 0.5);
      const body = new V2(p.x / 1.6, (p.y - 0.02) / 1).magnitude - 0.13;
      const d = Math.min(w1, w2, body);
      return Pal.hex(0x2b2445).withAlpha(fill(d, px));
    });
  },

  Flag() {
    return CasualArt.make("kc-flag", 32, 32, (p) => new Color(1, 1, 1, fill(sdPoly(p, [new V2(0, -0.92), new V2(0.85, 0.85), new V2(-0.85, 0.85)]), 2 / 32)));
  },

  /** Glass-string charm: a glittering crystal. */
  Glass() {
    return CasualArt.make("kc-glass", 96, 96, (p) => {
      const px = 2 / 96;
      const d = sdPoly(p, [new V2(0, -0.9), new V2(0.62, 0.12), new V2(0.35, 0.6), new V2(-0.35, 0.6), new V2(-0.62, 0.12)]);
      if (d > px) return Color.clear;
      let c = Pal.hex(0x7ef0ff);
      if (p.y > 0.12) c = Pal.hex(0xc9fbff);
      if (p.x < -0.1 && p.y < 0.12) c = Pal.hex(0x3cc8f0);
      if (Math.abs(p.y - 0.12) < 0.03 || Math.abs(p.x * 0.7 + (p.y - 0.12) * 0.35) < 0.02) c = Color.white;
      c = Color.lerp(c, dark(Pal.hex(0x1a7fb0), 0.1), smooth(-0.06, -0.02, d));
      return c.withAlpha(fill(d, px));
    });
  },

  /** Wind-boost swirl. */
  Swirl() {
    return CasualArt.make("kc-swirl", 96, 96, (p) => {
      const r = p.magnitude, a = Math.atan2(p.y, p.x);
      let best = Infinity;
      for (let k = 0; k < 3; k++) {
        const rr = 0.12 + 0.12 * ((a + Math.PI) / (Math.PI * 2) + k);
        best = Math.min(best, Math.abs(r - rr));
      }
      const w = 0.05 * (0.5 + r);
      const al = fill(best - w, 2 / 96) * smooth(0.95, 0.75, r);
      return Color.lerp(Pal.hex(0xb8fff0), Color.white, smooth(0.6, 0.1, r)).withAlpha(al);
    });
  },

  Coin() {
    return CasualArt.make("kc-coin", 64, 64, (p) => {
      const px = 2 / 64, r = p.magnitude;
      if (r > 0.95) return Color.clear;
      let c = CasualArt.ballPixel(p, Pal.hex(0xffc93c), px, 0.92);
      if (Math.abs(r - 0.62) < 0.05) c = Color.lerp(c, Pal.hex(0xc98a10), 0.6);
      if (CasualArt.sdStar(p.mul(1 / 0.45), 0.92, 0.45) < 0) c = Color.lerp(c, Pal.hex(0xfff1b0), 0.7);
      return c;
    });
  },

  /** Soft round blob for the sun disc. */
  SunDisc() {
    return CasualArt.make("kc-sun", 128, 128, (p) => {
      const r = p.magnitude;
      const c = Color.lerp(Pal.hex(0xfff6d0), Pal.hex(0xffd36a), smooth(0, 0.9, r));
      return c.withAlpha(fill(r - 0.9, 2 / 128));
    });
  },

  /** A string colour swatch (shop). */
  Swatch() {
    return CasualArt.make("kc-swatch", 128, 32, (p) => {
      const y = Math.sin(p.x * 3) * 0.12;
      return new Color(1, 1, 1, fill(Math.abs(p.y - y) - 0.06, 2 / 32));
    });
  },
};
