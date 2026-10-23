import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";
import { R } from "./TopPhysics";

/**
 * TOP RUMBLE procedural art: painted wooden spinning tops seen from above (plus a radial motion-blur version, a
 * fixed shine overlay and a toppled side view with the metal tip), the four arenas (sunny courtyard with a chalk
 * ring on stone tiles, a wooden table, a sandpit, a tin tray on a picnic cloth), sneakers and bits around the edge,
 * chalk start marks, sparks, wood chips and scuffs. Everything is rasterized once by CasualArt and cached.
 */

const sm = CasualArt.smooth;
const mix = (a: Color, b: Color, t: number) => Color.lerp(a, b, Mathf.clamp01(t));
const hx = Pal.hex;

// ------------------------------------------------------------------ noise

function hash(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, oct = 3) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, y * f) * a; f *= 2.03; a *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
}

// ------------------------------------------------------------------ paints

export interface Paint { name: string; main: Color; accent: Color; trim: Color; cost: number; rainbow?: boolean }
export const Paints: Paint[] = [
  { name: "CHERRY", main: hx(0xe23a3f), accent: hx(0xfff1d6), trim: hx(0xf2b632), cost: 0 },
  { name: "SKY", main: hx(0x2f86e0), accent: hx(0xffffff), trim: hx(0xffd23f), cost: 150 },
  { name: "LIME", main: hx(0x58c43a), accent: hx(0xfff6c2), trim: hx(0x2a6f2b), cost: 150 },
  { name: "SUNNY", main: hx(0xffc21a), accent: hx(0xff6a2a), trim: hx(0x7a3a12), cost: 250 },
  { name: "GRAPE", main: hx(0x8a4bd8), accent: hx(0xffd6f5), trim: hx(0x3a1f6a), cost: 250 },
  { name: "CANDY", main: hx(0xff6fb1), accent: hx(0xffffff), trim: hx(0x2fc8c0), cost: 400 },
  { name: "TIGER", main: hx(0xff8a1f), accent: hx(0x231812), trim: hx(0xfff0d0), cost: 400 },
  { name: "RAINBOW", main: hx(0xff4a4a), accent: hx(0xffffff), trim: hx(0x2b2b40), cost: 900, rainbow: true },
];

const Wood = hx(0xe0b277), WoodDark = hx(0xa8743f), Steel = hx(0xc9d2dc), Gold = hx(0xffc93c);

function woodAt(r: number, th: number) {
  const g = Math.sin(r * 70 + Math.sin(th * 3) * 0.6) * 0.5 + 0.5;
  return mix(Wood, WoodDark, g * 0.28 + 0.06);
}

function hue(h: number) {
  const k = (n: number) => (n + h * 6) % 6;
  const f = (n: number) => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return new Color(f(5) * 0.85 + 0.12, f(3) * 0.8 + 0.15, f(1) * 0.85 + 0.12, 1);
}

/** The top's outline radius at angle th (0..1 units of the sprite half-width). */
function edgeR(design: number, th: number) {
  switch (design) {
    case 1: { const k = (((th / (Math.PI * 2)) * 8) % 1 + 1) % 1; return 0.9 + 0.07 * (1 - Math.abs(k * 2 - 1) * 2) ; }
    case 4: return 0.95 + 0.02 * Math.cos(th * 10);
    default: return 0.95;
  }
}

/** Unlit paint of a top at polar (r, th). Stripes make the spin visible. */
function topPaint(design: number, paint: Paint, r: number, th: number): Color {
  const main = paint.rainbow ? hue(((th / (Math.PI * 2)) + 1) % 1) : paint.main;
  const acc = paint.accent, trim = paint.trim;
  const stripes = (n: number, twist = 0) => Math.sin(th * n + r * twist) > 0;
  const groove = (rr: number, w = 0.012) => sm(w * 2, w * 0.5, Math.abs(r - rr));
  let c: Color;
  switch (design) {
    case 1: // STINGER: blades
      if (r > 0.62) c = stripes(8, 5) ? main : CasualArt.darken(main, 0.35);
      else if (r > 0.4) c = mix(woodAt(r, th), trim, 0.85);
      else if (r > 0.18) c = stripes(4, -6) ? acc : main;
      else c = woodAt(r, th);
      c = mix(c, hx(0x2a1a10), groove(0.62) + groove(0.4));
      break;
    case 2: // BULWARK: steel rim with rivets
      if (r > 0.76) {
        c = mix(Steel, hx(0x7c8794), 0.25 + 0.25 * Math.sin(th * 2));
        const rv = th * 12 / (Math.PI * 2), d = Math.hypot((rv - Math.round(rv)) * (Math.PI * 2 / 12) * r, r - 0.86);
        c = mix(c, hx(0x4c5560), sm(0.05, 0.03, d));
      } else if (r > 0.52) c = stripes(6) ? main : acc;
      else if (r > 0.2) c = mix(woodAt(r, th), main, Math.abs(r - 0.36) < 0.03 ? 0.9 : 0);
      else c = woodAt(r, th);
      c = mix(c, hx(0x22160e), groove(0.76) + groove(0.52));
      break;
    case 3: // WHIRL: spiral
      if (r > 0.86) c = trim;
      else if (r > 0.24) c = Math.sin(th * 3 - r * 11) > 0 ? main : acc;
      else c = woodAt(r, th);
      c = mix(c, hx(0x2a1a10), groove(0.86) + groove(0.24));
      break;
    case 4: { // THUNDER: zigzag band
      const zz = 0.58 + 0.09 * (Math.abs(((th * 10 / (Math.PI * 2)) % 1 + 1) % 1 * 2 - 1) - 0.5);
      if (r > 0.86) c = CasualArt.darken(main, 0.45);
      else if (r > zz) c = main;
      else if (r > 0.26) c = mix(acc, trim, stripes(10) ? 0 : 0.15);
      else c = woodAt(r, th);
      c = mix(c, hx(0x1a120c), groove(0.86) + sm(0.024, 0.006, Math.abs(r - zz)) + groove(0.26));
      break;
    }
    case 5: { // ROYAL: star emblem and gold trim
      if (r > 0.84) c = Gold;
      else if (r > 0.3) {
        c = main;
        const p = new V2(Math.cos(th) * r, Math.sin(th) * r);
        const star = CasualArt.sdStar(p, 0.72, 0.5);
        if (star < 0) c = acc;
        if (Math.abs(star) < 0.025) c = Gold;
      } else if (r > 0.2) c = Gold;
      else c = woodAt(r, th);
      c = mix(c, hx(0x5a3a10), groove(0.84) + groove(0.3));
      if (r > 0.84) { const dt = th * 16 / (Math.PI * 2); c = mix(c, hx(0xfff2b0), sm(0.06, 0.03, Math.hypot((dt - Math.round(dt)) * 0.33, r - 0.9))); }
      break;
    }
    default: // CLASSIC
      if (r > 0.86) c = trim;
      else if (r > 0.6) c = stripes(6) ? main : acc;
      else if (r > 0.42) { c = woodAt(r, th); if (Math.abs(r - 0.51) < 0.025) c = main; }
      else if (r > 0.2) c = stripes(3, 0) ? main : CasualArt.darken(main, 0.2);
      else c = woodAt(r, th);
      c = mix(c, hx(0x2a1a10), groove(0.86) + groove(0.6) + groove(0.42) + groove(0.2));
  }
  // knob: a small turned dome with a darker ring
  if (r < 0.2) c = mix(c, hx(0x6a4120), groove(0.13, 0.01));
  return c;
}

/** Painted top seen from above (unlit; a fixed shine overlay adds the light). */
export const TopSprite = (design: number, paint: number) => CasualArt.make(`tr-top-${design}-${paint}`, 160, 160, (p) => {
  const r = p.magnitude, th = Math.atan2(p.y, p.x), px = 2 / 160;
  const e = edgeR(design, th);
  const a = CasualArt.fill(r - e, px);
  if (a <= 0) return Color.clear;
  let c = topPaint(design, Paints[paint], r / e * 0.95, th);
  c = CasualArt.darken(c, sm(e - 0.12, e, r) * 0.35);
  return c.withAlpha(a);
});

/** The same top averaged around its axis: the motion-blurred look at high spin. */
export const BlurSprite = (design: number, paint: number) => CasualArt.make(`tr-blur-${design}-${paint}`, 128, 128, (p) => {
  const r = p.magnitude, px = 2 / 128;
  const e = 0.95;
  const a = CasualArt.fill(r - e, px);
  if (a <= 0) return Color.clear;
  let rr = 0, gg = 0, bb = 0;
  const n = 24;
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const c = topPaint(design, Paints[paint], (r / edgeR(design, th)) * 0.95, th);
    rr += c.r; gg += c.g; bb += c.b;
  }
  let c = new Color(rr / n, gg / n, bb / n, 1);
  c = CasualArt.darken(c, sm(e - 0.12, e, r) * 0.35);
  return c.withAlpha(a);
});

/** Fixed light on the top: bright upper-left sheen, shaded lower-right rim. */
export const ShineSprite = () => CasualArt.make("tr-shine", 160, 160, (p) => {
  const r = p.magnitude, px = 2 / 160;
  const a = CasualArt.fill(r - 0.95, px);
  if (a <= 0) return Color.clear;
  const l = (-p.x * 0.6 + p.y * 0.8);
  // dome: the crown curves away at the rim (darker), lit from the upper left
  let dark = sm(0.55, 0.95, r) * (0.28 + 0.3 * sm(0.3, -0.9, l));
  dark += sm(0.9, 0.95, r) * 0.25; // outline
  // the raised knob throws a little shadow down-right
  const kd = Math.hypot(p.x - 0.06, p.y + 0.07);
  if (r > 0.2) dark += sm(0.3, 0.19, kd) * 0.35;
  let light = sm(0.1, 0.9, l) * sm(0.95, 0.5, r) * 0.22;
  light += sm(0.07, 0.0, Math.abs(Math.hypot(p.x + 0.05, p.y - 0.05) - 0.62) ) * sm(0.2, 0.9, l) * 0.35; // specular arc
  light += sm(0.12, 0, Math.hypot(p.x + 0.07, p.y - 0.08)) * 0.75; // knob glint
  light += sm(0.2, 0, Math.hypot(p.x + 0.42, p.y - 0.5)) * 0.35;
  if (dark > light) return new Color(0.08, 0.04, 0.02, Math.min(0.75, dark - light * 0.5) * a);
  return new Color(1, 0.98, 0.92, Math.min(0.9, light - dark * 0.5) * a);
});

/** A toppled top lying on its side: crown on the left, the metal tip on the right. */
export const FallenSprite = (design: number, paint: number) => CasualArt.make(`tr-fallen-${design}-${paint}`, 192, 112, (p) => {
  const pt = Paints[paint];
  const x = p.x, y = p.y, px = 2 / 192;
  // profile half-height along the axis
  let h: number;
  if (x < -0.8) h = 0.13 * sm(-0.98, -0.9, x);
  else if (x < -0.62) h = Mathf.lerp(0.13, 0.5, sm(-0.8, -0.62, x));
  else if (x < 0.15) h = 0.5 - 0.06 * Math.pow((x + 0.25) / 0.4, 2) * 0.3;
  else if (x < 0.72) h = Mathf.lerp(0.47, 0.06, Math.pow((x - 0.15) / 0.57, 0.8));
  else h = 0.045;
  const tipEnd = 0.96;
  if (x > tipEnd || x < -0.98) return Color.clear;
  const a = CasualArt.fill(Math.abs(y) - h, px);
  if (a <= 0) return Color.clear;
  let c: Color;
  if (x > 0.7) c = mix(Steel, Color.white, sm(0.03, 0, Math.abs(y + 0.015)) * 0.7);
  else if (x < -0.62) c = woodAt(Math.abs(x) * 0.3, y * 4);
  else {
    const band = Math.floor((x + 0.62) / 0.18);
    const main = pt.rainbow ? hue((band * 0.17) % 1) : pt.main;
    c = band % 3 === 0 ? main : band % 3 === 1 ? pt.accent : design === 2 ? Steel : pt.trim;
    if (x > 0.3) c = mix(woodAt(x, y * 3), c, 0.25);
  }
  // cylinder shading
  const ny = y / Math.max(0.01, h);
  c = mix(c, Color.white, sm(0.2, 0.7, ny) * sm(1, 0.75, ny) * 0.4);
  c = CasualArt.darken(c, sm(0.1, -1, ny) * 0.45);
  return c.withAlpha(a);
});

// ------------------------------------------------------------------ arenas

export const ArenaColors = [hx(0xffe9a8), hx(0xffd08a), hx(0xffe1a0), hx(0xd8ecff)];
/** World size covered by the near (detailed) arena sprite and by the far ground. */
export const NearSize = 30, FarSize = 90;

function courtyard(x: number, y: number, detail: boolean): Color {
  // square flagstones, every other row shifted by half a stone
  const tw = 2.3;
  const row = Math.floor(y / tw);
  const ox = row % 2 === 0 ? 0 : tw * 0.5;
  const col = Math.floor((x + ox) / tw);
  const lx = (x + ox) - col * tw, ly = y - row * tw;
  const id = hash(col, row), id2 = hash(col + 17, row - 5);
  let c = mix(hx(0xeadcc2), hx(0xd2bf9f), id);
  c = mix(c, hx(0xc9b9a6), id2 > 0.8 ? 0.5 : 0);
  c = mix(c, hx(0xf3e9d6), (fbm(x * 0.7 + col, y * 0.7, 2) - 0.5) * 0.8 + 0.1);
  if (detail) c = CasualArt.darken(c, (vnoise(x * 11, y * 11) - 0.5) * 0.07 + (vnoise(x * 3.1, y * 3.1) - 0.5) * 0.05);
  const dEdge = Math.min(lx, tw - lx, ly, tw - ly);
  const mortar = sm(0.08, 0.035, dEdge);
  const grass = fbm(x * 1.7 + 7, y * 1.7, 2);
  let m = mix(hx(0xa89a84), hx(0x7fae46), sm(0.55, 0.68, grass));
  if (detail) m = mix(m, hx(0x9bd65a), sm(0.66, 0.74, grass) * (vnoise(x * 14, y * 14) > 0.5 ? 1 : 0.4));
  c = mix(c, m, mortar);
  // bevel: lighter top-left edge, darker bottom-right edge of each stone
  c = mix(c, Color.white, sm(0.16, 0.06, Math.min(lx, tw - ly)) * 0.18 * (1 - mortar));
  c = CasualArt.darken(c, sm(0.16, 0.06, Math.min(tw - lx, ly)) * 0.1 * (1 - mortar));
  // soft leafy shade, warm sun elsewhere
  const leaf = fbm(x * 0.16 + 31, y * 0.16 - 5, 3);
  c = mix(c, hx(0x9a8a78), sm(0.52, 0.66, leaf) * 0.22);
  c = mix(c, hx(0xfff2c8), sm(0.45, 0.3, leaf) * 0.12);
  return c;
}

function chalkRing(c: Color, x: number, y: number) {
  const d = Math.hypot(x, y);
  const w = 0.21 + 0.05 * vnoise(Math.atan2(y, x) * 9, 1);
  const k = sm(w, w * 0.5, Math.abs(d - R)) * (0.75 + 0.25 * vnoise(x * 6, y * 6)) * (vnoise(x * 2.5, y * 2.5) > 0.12 ? 1 : 0.35);
  c = mix(c, hx(0xfbfbf4), k * 0.92);
  // a second, sketchier line
  const k2 = sm(0.07, 0.02, Math.abs(d - R - 0.32 - 0.06 * Math.sin(Math.atan2(y, x) * 5))) * (vnoise(x * 3 + 4, y * 3) > 0.45 ? 0.5 : 0);
  return mix(c, hx(0xf4f4ec), k2);
}

function table(x: number, y: number, detail: boolean): Color {
  const pw = 2.6;
  const plank = Math.floor(y / pw), ly = y - plank * pw;
  const id = hash(plank, 3);
  const off = id * 40;
  let c = mix(hx(0xc98b4e), hx(0xa86a35), id);
  const grain = Math.sin((x + off) * 0.6 + fbm((x + off) * 0.15, y * 2.5, 2) * 9);
  c = mix(c, hx(0x8a5228), (grain * 0.5 + 0.5) * 0.35);
  if (detail) c = mix(c, hx(0xe0a86a), sm(0.75, 0.95, vnoise((x + off) * 0.5, y * 6)) * 0.3);
  // knots
  const kx = Math.round((x + off) / 9) * 9 - off + (hash(plank, Math.round((x + off) / 9)) - 0.5) * 4;
  const kd = Math.hypot((x - kx) * 0.7, ly - pw * 0.5);
  c = mix(c, hx(0x6d3d1b), sm(0.5, 0.15, kd) * 0.7 * (hash(plank, 9 + Math.round((x + off) / 9)) > 0.4 ? 1 : 0));
  // plank gaps
  c = mix(c, hx(0x3e2412), sm(0.08, 0.03, Math.min(ly, pw - ly)));
  // varnish shine
  c = mix(c, Color.white, sm(0.6, 1, fbm(x * 0.08, y * 0.08, 2)) * 0.12);
  return c;
}

function sandpit(x: number, y: number, detail: boolean): Color {
  const d = Math.hypot(x, y);
  let c = mix(hx(0xf1d595), hx(0xd9b571), fbm(x * 0.5, y * 0.5, 3));
  if (detail) c = mix(c, vnoise(x * 30, y * 30) > 0.5 ? hx(0xfbe6b4) : hx(0xc79f5e), 0.18);
  if (d < R) {
    // raked circles and a soft dish
    const rake = Math.sin(d * 5.2 + fbm(x, y, 2) * 1.5);
    c = mix(c, hx(0xc6a062), sm(0.6, 1, rake) * 0.3);
    c = mix(c, hx(0xfff0c8), sm(0.6, 1, -rake) * 0.15);
    c = CasualArt.darken(c, (1 - d / R) * 0.08);
  } else {
    c = mix(c, hx(0xe9cf8f), sm(0.55, 0.75, fbm(x * 0.2 + 3, y * 0.2, 2)) * 0.6);
  }
  // groove ring
  const g = Math.abs(d - R);
  c = mix(c, hx(0x9a7444), sm(0.28, 0.08, g) * 0.8);
  c = mix(c, hx(0xfff4d0), sm(0.15, 0.05, Math.abs(d - R - 0.3)) * 0.5);
  return c;
}

function cloth(x: number, y: number, detail: boolean): Color {
  const s = 1.6;
  const a = Math.floor(x / s) & 1, b = Math.floor(y / s) & 1;
  const red = hx(0xe14b4b), white = hx(0xfff4ea), pink = hx(0xf3a3a0);
  let c = a && b ? red : a || b ? pink : white;
  if (detail) {
    const w = (Math.sin(x * 40) * Math.sin(y * 40)) * 0.5 + 0.5;
    c = CasualArt.darken(c, w * 0.08);
  }
  c = CasualArt.darken(c, sm(0.55, 0.75, fbm(x * 0.15, y * 0.15, 2)) * 0.15);
  return c;
}

function tray(c: Color, x: number, y: number) {
  const d = Math.hypot(x, y);
  const rim = R + 0.9;
  if (d > rim + 0.25) {
    // soft shadow of the tray on the cloth
    return CasualArt.darken(c, sm(rim + 1.4, rim + 0.2, d) * 0.35);
  }
  const th = Math.atan2(y, x);
  let m: Color;
  if (d > R) {
    // rolled rim
    const k = (d - R) / (rim - R);
    const ridge = Math.sin(k * Math.PI);
    m = mix(hx(0x8d9aa8), hx(0xf4f8fc), ridge * (0.55 + 0.45 * Math.cos(th - 2.2)));
  } else {
    m = mix(hx(0xc3ccd6), hx(0xa6b2bf), d / R * 0.6);
    // embossed rings and brushed metal
    const ring = Math.abs(((d / 2.5) % 1) - 0.5);
    m = mix(m, hx(0xe9eef4), sm(0.06, 0.0, Math.abs(ring - 0.47)) * 0.5);
    m = CasualArt.darken(m, sm(0.06, 0.0, Math.abs(ring - 0.43)) * 0.18);
    m = mix(m, hx(0xffffff), (Math.sin(th * 40 + d) * 0.5 + 0.5) * 0.04 + sm(0.4, 1, Math.cos(th - 2.2) * (d / R)) * 0.18);
    m = CasualArt.darken(m, sm(R - 0.8, R, d) * 0.25);
  }
  return mix(c, m, sm(rim + 0.25, rim, d));
}

function ground(arena: number, x: number, y: number, detail: boolean): Color {
  switch (arena) {
    case 1: {
      let c = table(x, y, detail);
      const d = Math.hypot(x, y);
      c = mix(c, hx(0xfff6e6), sm(0.2, 0.1, Math.abs(d - R)) * 0.92);
      c = mix(c, hx(0xe2403c), sm(0.09, 0.04, Math.abs(d - R - 0.45)) * 0.85);
      if (d < R) c = mix(c, Color.white, 0.04);
      return c;
    }
    case 2: return sandpit(x, y, detail);
    case 3: return tray(cloth(x, y, detail), x, y);
    default: return chalkRing(courtyard(x, y, detail), x, y);
  }
}

/** Detailed ring area (NearSize world units), fading out at its edge into the far ground. */
export const ArenaNear = (arena: number) => CasualArt.make(`tr-near-${arena}`, 1024, 1024, (p) => {
  const x = p.x * NearSize / 2, y = p.y * NearSize / 2;
  const d = Math.hypot(x, y);
  const a = sm(NearSize / 2, NearSize / 2 - 1.5, d);
  if (a <= 0) return Color.clear;
  return ground(arena, x, y, true).withAlpha(a);
});

/** Wide, softer ground under everything. */
export const ArenaFar = (arena: number) => CasualArt.make(`tr-far-${arena}`, 512, 512, (p) => {
  const x = p.x * FarSize / 2, y = p.y * FarSize / 2;
  let c = ground(arena, x, y, false);
  // sunny vignette: warm light in the middle
  const d = Math.hypot(x, y);
  c = CasualArt.darken(c, sm(16, 40, d) * 0.3);
  return c.withAlpha(1);
});

/** Small preview tile for the arena picker. */
export const ArenaThumb = (arena: number) => CasualArt.make(`tr-thumb-${arena}`, 160, 160, (p) => {
  const x = p.x * 13, y = p.y * 13;
  const a = CasualArt.fill(p.magnitude - 0.95, 2 / 160);
  if (a <= 0) return Color.clear;
  return ground(arena, x, y, true).withAlpha(a);
});

// ------------------------------------------------------------------ props

/** A kid's sneaker seen from above (toe pointing up). */
export const SneakerSprite = (col: number) => CasualArt.make(`tr-sneaker-${col}`, 96, 192, (p) => {
  const cols = [hx(0xff4f5a), hx(0x3f8cff), hx(0x37c871), hx(0xffb020), hx(0x9b5cff), hx(0xff7ac0)];
  const main = cols[col % cols.length];
  const px = 2 / 96;
  // outline: rounded toe, narrower heel
  const y = p.y, x = p.x;
  const w = y > 0.9 ? 0.78 * Math.sqrt(Math.max(0, 1 - Math.pow((y - 0.9) / 0.95, 2))) : y > -0.9 ? 0.78 - 0.12 * sm(0.2, -0.9, y) : 0.66 * Math.sqrt(Math.max(0, 1 - Math.pow((y + 0.9) / 0.95, 2)));
  const d = Math.abs(x) - w;
  if (y > 1.85 || y < -1.85) return Color.clear;
  const a = CasualArt.fill(d, px);
  if (a <= 0) return Color.clear;
  let c = hx(0xf6f3ee); // sole
  const inner = d < -0.09;
  if (inner) {
    c = main;
    if (y > 1.05) c = hx(0xffffff); // toe cap
    // opening
    const od = Math.hypot(x / 0.5, (y + 0.95) / 0.62);
    if (od < 1) c = mix(hx(0x3a3036), hx(0x5a4a50), od);
    else if (od < 1.15) c = CasualArt.darken(main, 0.25);
    // tongue + laces
    if (y > -0.35 && y < 0.95 && Math.abs(x) < 0.3) {
      c = CasualArt.lighten(main, 0.2);
      const ly = ((y + 0.35) / 0.26) % 1;
      if (Math.abs(Math.abs(x) - (ly < 0.5 ? ly : 1 - ly) * 0.6) < 0.06) c = Color.white;
    }
    // side stripe
    if (Math.abs(Math.abs(x) - 0.55 - 0.1 * y) < 0.05 && y > -0.6 && y < 0.7) c = Color.white;
  }
  c = mix(c, Color.white, sm(0.2, 0.8, -x * 0.5 + y * 0.2) * 0.12);
  c = CasualArt.darken(c, sm(0.1, 0.9, x) * 0.15);
  return c.withAlpha(a);
});

/** A stub of chalk. */
export const ChalkSprite = (col: number) => CasualArt.make(`tr-chalk-${col}`, 128, 48, (p) => {
  const cols = [hx(0xffffff), hx(0xffd6e8), hx(0xc8f0ff), hx(0xfff3a8)];
  const d = CasualArt.sdBox(p, new V2(0.92, 0.26), 0.2);
  const a = CasualArt.fill(d, 2 / 128);
  if (a <= 0) return Color.clear;
  let c = cols[col % cols.length];
  c = CasualArt.darken(c, sm(0, -0.3, p.y) * 0.18 + vnoise(p.x * 12, p.y * 12) * 0.05);
  return c.withAlpha(a);
});

/** A glass marble. */
export const MarbleSprite = (col: number) => CasualArt.make(`tr-marble-${col}`, 64, 64, (p) => {
  const cols = [hx(0x40c0ff), hx(0xff5a7a), hx(0x60e090), hx(0xffcc40)];
  const r = p.magnitude;
  const a = CasualArt.fill(r - 0.92, 2 / 64);
  if (a <= 0) return Color.clear;
  let c = mix(hx(0xe8f6ff), cols[col % 4], 0.35);
  const swirl = Math.sin(Math.atan2(p.y, p.x) * 2 + r * 6);
  c = mix(c, cols[col % 4], sm(0.4, 0.9, swirl) * 0.9 * sm(0.9, 0.2, r));
  c = CasualArt.darken(c, sm(0.5, 0.95, r) * 0.3);
  c = mix(c, Color.white, sm(0.3, 0, Math.hypot(p.x + 0.35, p.y - 0.4)) * 0.9);
  return c.withAlpha(a * 0.97);
});

/** A pencil (point to the right). */
export const PencilSprite = (col: number) => CasualArt.make(`tr-pencil-${col}`, 256, 32, (p) => {
  const cols = [hx(0xffcc22), hx(0x3a8cff), hx(0xff5a4e), hx(0x40c060)];
  const x = p.x, y = p.y * 8; // y in -1..1 across
  const tipStart = 0.66;
  const half = x > tipStart ? 0.9 * (1 - (x - tipStart) / (0.98 - tipStart)) : 0.9;
  if (x > 0.98 || x < -0.98) return Color.clear;
  const a = CasualArt.fill(Math.abs(y) - half, 16 / 256);
  if (a <= 0) return Color.clear;
  let c: Color;
  if (x < -0.86) c = hx(0xff9aa8); // eraser
  else if (x < -0.78) c = Steel;
  else if (x > 0.9) c = hx(0x2a2a2a);
  else if (x > tipStart) c = hx(0xf0c890);
  else c = cols[col % 4];
  c = mix(c, Color.white, sm(0.2, 0.7, y) * 0.3);
  c = CasualArt.darken(c, sm(0, -0.9, y) * 0.3);
  return c.withAlpha(a);
});

/** Chalk start mark: a rough circle with a cross. */
export const StartMark = () => CasualArt.make("tr-mark", 128, 128, (p) => {
  const r = p.magnitude;
  const ring = sm(0.09, 0.04, Math.abs(r - 0.82 - 0.04 * Math.sin(Math.atan2(p.y, p.x) * 3)));
  const cross = sm(0.08, 0.035, Math.min(Math.abs(p.x - p.y), Math.abs(p.x + p.y))) * (r < 0.45 ? 1 : 0);
  const k = Math.max(ring, cross) * (0.7 + 0.3 * vnoise(p.x * 10, p.y * 10));
  return new Color(1, 1, 1, k);
});

/** Owner ring painted on the ground under a top. */
export const OwnerRing = () => CasualArt.make("tr-owner", 128, 128, (p) => {
  const r = p.magnitude;
  const k = sm(0.1, 0.03, Math.abs(r - 0.86));
  const glow = sm(0.95, 0.6, r) * sm(0.45, 0.8, r) * 0.3;
  return new Color(1, 1, 1, Math.max(k, glow));
});

/** One dot of the guide arc. */
export const GuideDot = () => CasualArt.make("tr-dot", 48, 48, (p) => {
  const r = p.magnitude;
  return new Color(1, 1, 1, CasualArt.fill(r - 0.8, 2 / 48) * (0.75 + 0.25 * sm(0.8, 0, r)));
});

/** Arrow head for the guide. */
export const ArrowHead = () => CasualArt.make("tr-arrow", 64, 64, (p) => {
  const tri = Math.max(-p.x - 0.5, Math.abs(p.y) * 1.4 + p.x * 0.9 - 0.7);
  return new Color(1, 1, 1, CasualArt.fill(tri, 2 / 64));
});

/** A bright streak used for sparks. */
export const SparkSprite = () => CasualArt.make("tr-spark", 64, 16, (p) => {
  const k = sm(1, 0, Math.abs(p.x)) * sm(0.25, 0, Math.abs(p.y * 4));
  return new Color(1, 1, 1, k);
});

/** A wood chip. */
export const ChipSprite = () => CasualArt.make("tr-chip", 48, 48, (p) => {
  const d = Math.max(Math.abs(p.x * 0.8 + p.y * 0.3) - 0.7, Math.abs(p.y - p.x * 0.2) - 0.35);
  const a = CasualArt.fill(d, 2 / 48);
  if (a <= 0) return Color.clear;
  return mix(Wood, WoodDark, sm(0.3, -0.3, p.y)).withAlpha(a);
});

/** A dark scuff left on the ground. */
export const ScuffSprite = () => CasualArt.make("tr-scuff", 96, 48, (p) => {
  const d = Math.hypot(p.x, p.y * 2);
  const k = sm(1, 0.2, d) * (0.6 + 0.4 * vnoise(p.x * 8 + 3, p.y * 8));
  return new Color(0.18, 0.12, 0.08, k);
});

/** Little coin for the wallet. */
export const CoinIcon = () => CasualArt.make("tr-coin", 64, 64, (p) => {
  const r = p.magnitude;
  const a = CasualArt.fill(r - 0.92, 2 / 64);
  if (a <= 0) return Color.clear;
  let c = mix(hx(0xffdf5a), hx(0xe0a020), sm(-0.6, 0.8, p.x - p.y));
  c = mix(c, hx(0xb07a10), sm(0.1, 0.04, Math.abs(r - 0.7)));
  c = mix(c, hx(0xfff5c0), sm(0.25, 0, Math.hypot(p.x + 0.3, p.y - 0.35)) * 0.8);
  return c.withAlpha(a);
});

/** Icon of a spinning top for buttons and the how-to list. */
export const TopIcon = () => TopSprite(0, 0);

