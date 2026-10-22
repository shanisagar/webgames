import { Art, CasualArt, Color, Mathf, Pal, Sprite, V2 } from "../../kit";
import { R, Table, TH, TW } from "./PoolPhysics";

/**
 * POOL PRO procedural art: cloth (grey, tinted per venue), wood rails with diamonds and brass pocket plates, ball
 * layers (flat colour disc + stripe band at 24 tilts + numbered spots + a light-fixed shading overlay), a cue stick,
 * HUD ball icons and the store icon. Everything is rasterized once by CasualArt and cached.
 */

const sm = CasualArt.smooth;
const clamp01 = Mathf.clamp01;
const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const grey = (v: number, a = 1) => new Color(v, v, v, a);
const mix = (a: Color, b: Color, t: number) => Color.lerp(a, b, t);

export const BallColors = [
  Pal.hex(0xf8f6ee), // cue
  Pal.hex(0xf6c21c), Pal.hex(0x1d4fc4), Pal.hex(0xd92b2b), Pal.hex(0x5b2a91), Pal.hex(0xf2741c), Pal.hex(0x13854a), Pal.hex(0x8a1f2a),
  Pal.hex(0x141418),
  Pal.hex(0xf6c21c), Pal.hex(0x1d4fc4), Pal.hex(0xd92b2b), Pal.hex(0x5b2a91), Pal.hex(0xf2741c), Pal.hex(0x13854a), Pal.hex(0x8a1f2a),
];

// ------------------------------------------------------------------ digits (stroke font as signed distance)

type Poly = [number, number][];
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 14): Poly => {
  const out: Poly = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return out;
};
const D2R = Math.PI / 180;
const Glyphs: Poly[][] = [
  [arc(0, 0, 0.4, 0.66, 0, Math.PI * 2, 28)],
  [[[-0.24, 0.42], [0.06, 0.7], [0.06, -0.7]]],
  [[...arc(0, 0.3, 0.38, 0.38, 160 * D2R, -40 * D2R), [-0.4, -0.7], [0.44, -0.7]]],
  [arc(-0.02, 0.36, 0.34, 0.33, 155 * D2R, -90 * D2R), arc(-0.02, -0.33, 0.39, 0.37, 90 * D2R, -155 * D2R)],
  [[[0.2, -0.72], [0.2, 0.7], [-0.44, -0.3], [0.48, -0.3]]],
  [[[0.4, 0.68], [-0.3, 0.68], [-0.36, 0.06], ...arc(0.0, -0.27, 0.41, 0.41, 120 * D2R, -150 * D2R)]],
  [arc(0, -0.28, 0.4, 0.4, 0, Math.PI * 2, 24), arc(0.44, -0.28, 0.84, 0.98, 180 * D2R, 112 * D2R, 12)],
  [[[-0.42, 0.68], [0.42, 0.68], [-0.08, -0.72]]],
  [arc(0, 0.37, 0.3, 0.3, 0, Math.PI * 2, 24), arc(0, -0.31, 0.38, 0.38, 0, Math.PI * 2, 24)],
  [arc(0, 0.28, 0.4, 0.4, 0, Math.PI * 2, 24), arc(-0.44, 0.28, 0.84, 0.98, 0, -68 * D2R, 12)],
];

function sdPoly(px: number, py: number, poly: Poly) {
  let d = 1e9;
  for (let i = 0; i + 1 < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[i + 1];
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
    const t = l2 > 0 ? clamp01(((px - ax) * ex + (py - ay) * ey) / l2) : 0;
    d = Math.min(d, Math.hypot(px - ax - ex * t, py - ay - ey * t));
  }
  return d;
}

/** Distance to the strokes of number n, centred, about 1.4 tall (x scaled for two digits). */
function sdNumber(px: number, py: number, n: number) {
  const s = String(n);
  if (s.length === 1) { let d = 1e9; for (const p of Glyphs[n]) d = Math.min(d, sdPoly(px, py, p)); return d; }
  let d = 1e9;
  const k = 0.78; // narrower glyphs side by side
  for (let c = 0; c < s.length; c++) {
    const ox = (c - 0.5) * 0.86;
    const g = Glyphs[Number(s[c])];
    for (const p of g) d = Math.min(d, sdPoly((px - ox) / k, py, p) * k);
  }
  return d;
}

// ------------------------------------------------------------------ table

const ClothHalfX = TW / 2 + 0.5;
const CushionW = 0.34;
const RailHalfX = TW / 2 + 1.3, RailHalfY = TH / 2 + 1.3;

interface HoleInfo { x: number; y: number; r: number; mx: number; my: number; dx: number; dy: number; half: number; side: boolean }
const Holes: HoleInfo[] = Table.pockets.map((p) => {
  const k = p.side ? 0.5 : 0.62;
  return { x: p.mx + p.dx * k, y: p.my + p.dy * k, r: p.side ? 0.6 : 0.68, mx: p.mx, my: p.my, dx: p.dx, dy: p.dy, half: p.half, side: p.side };
});

/** Pocket test for cloth: 0 = outside, else depth 0..1 (throat → hole). */
function pocketDepth(ux: number, uy: number) {
  let best = 0;
  for (const h of Holes) {
    const rx = ux - h.mx, ry = uy - h.my;
    const along = rx * h.dx + ry * h.dy, across = Math.abs(-rx * h.dy + ry * h.dx);
    const halfW = h.half - Math.max(0, along) * (h.side ? 0 : Math.tan(7 * D2R));
    if (along > -0.02 && across < halfW) best = Math.max(best, 0.35 + 0.3 * clamp01(along / 0.6));
    const dh = Math.hypot(ux - h.x, uy - h.y);
    if (dh < h.r) best = Math.max(best, 0.7 + 0.3 * sm(h.r, h.r * 0.4, dh));
  }
  return best;
}

/** Grey cloth + cushion noses + pocket throats; tint it with the venue colour. 21 × 11 table units. */
export const ClothSprite = () => CasualArt.make("pool-cloth", 700, 366, (p) => {
  const ux = p.x * ClothHalfX, uy = p.y * ClothHalfX;
  const ox = Math.abs(ux) - TW / 2, oy = Math.abs(uy) - TH / 2;
  const outside = Math.max(ox, oy);
  const pd = pocketDepth(ux, uy);
  if (outside <= 0) {
    // felt: lamp-lit centre, fibre noise, cushion shadow
    const r2 = (ux / (TW * 0.62)) ** 2 + (uy / (TH * 0.75)) ** 2;
    let v = 0.86 - 0.16 * r2;
    v += (vnoise(ux * 3.1, uy * 3.1) - 0.5) * 0.035 + (vnoise(ux * 13, uy * 13) - 0.5) * 0.03 + (hash(Math.floor(ux * 40), Math.floor(uy * 40)) - 0.5) * 0.025;
    v -= sm(-0.3, 0, outside) * 0.1;
    // head string and spots
    if (Math.abs(ux + TW / 4) < 0.025) v += 0.05;
    const spot = Math.min(Math.hypot(ux - TW / 4, uy), Math.hypot(ux + TW / 4, uy));
    if (spot < 0.09) v += 0.12;
    if (pd > 0) v = Math.min(v, 0.86 - pd * 0.5);
    return grey(clamp01(v));
  }
  if (pd > 0) {
    if (pd >= 0.7) return grey(0.03 + (1 - pd) * 0.2);
    return grey(0.62 - (pd - 0.35) * 1.2);
  }
  if (outside < CushionW) {
    // cushion rubber under cloth: bright nose, shading to the back
    const t = outside / CushionW;
    let v = 0.98 - 0.32 * t;
    v -= sm(0.08, 0, outside) * 0.08;
    v += (vnoise(ux * 12, uy * 12) - 0.5) * 0.03;
    return grey(v);
  }
  return grey(0.45);
});

/** Wooden rails with pearl diamonds, brass pocket plates and leather pocket liners (transparent over the cloth). */
export const RailSprite = () => CasualArt.make("pool-rails", 1000, 556, (p) => {
  const ux = p.x * RailHalfX, uy = p.y * RailHalfX;
  const outer = CasualArt.sdBox(new V2(ux, uy), new V2(RailHalfX - 0.04, RailHalfY - 0.04), 0.6);
  if (outer > 0.03) return Color.clear;
  const ix = Math.abs(ux) - (TW / 2 + CushionW), iy = Math.abs(uy) - (TH / 2 + CushionW);
  const inner = Math.max(ix, iy); // > 0 = on the rail
  // pockets
  let hole = 1e9, plate = 1e9, holeR = 0.6, side = false;
  for (const h of Holes) {
    const d = Math.hypot(ux - h.x, uy - h.y) - h.r;
    if (d < hole) { hole = d; holeR = h.r; side = h.side; }
    plate = Math.min(plate, Math.hypot(ux - h.x, uy - h.y) - h.r - (h.side ? 0.28 : 0.42));
  }
  void holeR;
  if (inner <= 0 && hole > 0) return Color.clear;
  const aa = 2 / 1000 * RailHalfX;
  if (hole < 0) {
    // the pocket opening: dark net with a soft rim
    const v = 0.02 + 0.08 * sm(-0.25, 0, hole);
    return new Color(v, v * 0.9, v * 0.8, 1);
  }
  if (hole < 0.11) {
    // rubber liner
    const t = hole / 0.11;
    return mix(Pal.hex(0x0c0a0a), Pal.hex(0x3a2a22), Math.sin(t * Math.PI) * 0.8).withAlpha(1);
  }
  const edgeA = CasualArt.fill(outer, aa);
  if (plate < 0) {
    // brass plate: brushed metal with a bevel
    const t = clamp01(-plate / 0.3);
    let c = mix(Pal.hex(0xb98a3a), Pal.hex(0xf4d58a), 0.5 + 0.5 * Math.sin((ux + uy) * 3.2));
    c = mix(c, Pal.hex(0xfff2c8), sm(0.5, 0, Math.abs(plate + 0.06) / 0.06) * 0.6);
    c = mix(c, Pal.hex(0x6d4b18), sm(0.04, 0, -plate) * 0.7);
    c = mix(c, c.scale(0.8), 1 - t);
    if (side) c = mix(c, Pal.hex(0xd7b26a), 0.2);
    return c.withAlpha(edgeA);
  }
  // wood: grain runs along each rail
  const shortRail = ix > iy;
  const along = shortRail ? uy : ux, across = shortRail ? ux : uy;
  const w = vnoise(along * 0.55, across * 6.5) * 2 + Math.sin(across * 22 + vnoise(along * 0.9, across * 2) * 5) * 0.5;
  let c = mix(Pal.hex(0x5a2a14), Pal.hex(0x8e4a22), 0.5 + 0.25 * w);
  c = mix(c, Pal.hex(0x3a1a0c), sm(0.6, 1, Math.abs(Math.sin(across * 9 + w * 2))) * 0.25);
  // mitred corners
  if (Math.abs(ix - iy) < 0.025 && inner > 0) c = c.scale(0.7);
  // bevels: highlight near the cushion, rounded outer edge, lamp gloss
  const fromInner = inner, fromOuter = -outer;
  c = mix(c, Pal.hex(0x1d0c05), sm(0.06, 0, fromInner) * 0.8);
  c = mix(c, Pal.hex(0xd08a50), sm(0.06, 0.14, fromInner) * sm(0.26, 0.14, fromInner) * 0.45);
  c = mix(c, Pal.hex(0x24100a), sm(0.35, 0, fromOuter) * 0.55);
  c = mix(c, Pal.hex(0xf0b47a), sm(0.18, 0.3, fromOuter) * sm(0.42, 0.3, fromOuter) * 0.35);
  const gloss = Math.exp(-((ux / 9) ** 2 + ((uy - 3) / 6) ** 2));
  c = mix(c, Pal.hex(0xffd0a0), gloss * 0.12);
  // diamonds (sights)
  const sights: [number, number][] = [];
  for (let k = 1; k <= 7; k++) if (k !== 4) { sights.push([-TW / 2 + (k * TW) / 8, TH / 2 + 0.82]); sights.push([-TW / 2 + (k * TW) / 8, -TH / 2 - 0.82]); }
  for (let k = 1; k <= 3; k++) { sights.push([TW / 2 + 0.82, -TH / 2 + (k * TH) / 4]); sights.push([-TW / 2 - 0.82, -TH / 2 + (k * TH) / 4]); }
  for (const [sx, sy] of sights) {
    const horiz = Math.abs(sy) > TH / 2;
    const dx = Math.abs(ux - sx), dy = Math.abs(uy - sy);
    const a = horiz ? dx / 0.2 + dy / 0.11 : dx / 0.11 + dy / 0.2;
    if (a < 1.25) {
      const inside = CasualArt.fill((a - 1) * 0.12, aa);
      const pearl = mix(Pal.hex(0xfffaf0), Pal.hex(0xc9c2b0), clamp01(a));
      c = mix(c, Pal.hex(0x2a1208), sm(1.25, 1, a) * 0.6);
      c = mix(c, pearl, inside);
    }
  }
  return c.withAlpha(edgeA);
});

/** Soft dark shape under the whole table. */
export const TableShadow = () => CasualArt.make("pool-table-shadow", 256, 144, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.86, 0.43), 0.1);
  return new Color(0, 0, 0, sm(0.16, -0.06, d) * 0.75);
});

// ------------------------------------------------------------------ balls

const BallRes = 96;
const Disc = 0.94;

/** Flat white disc (tinted with the ball colour). The visible radius is 0.94 of the sprite half width. */
export const BallBase = () => CasualArt.make("pool-ball-base", BallRes, BallRes, (p) => new Color(1, 1, 1, CasualArt.fill(p.magnitude - Disc, 2 / BallRes)));

export const BandTilts = 24;
const BandW = 0.5;
/** White stripe-band mask for a band whose axis is tilted `i` steps from the table plane towards the camera. */
export const BallBand = (i: number) => CasualArt.make("pool-band-" + i, BallRes, BallRes, (p) => {
  const r = p.magnitude;
  const edge = CasualArt.fill(r - Disc, 2 / BallRes);
  if (edge <= 0) return Color.clear;
  const qx = p.x / Disc, qy = p.y / Disc;
  const z = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy));
  const t = (i / (BandTilts - 1)) * (Math.PI / 2);
  const az = Math.sin(t), ax = Math.cos(t);
  const d = Math.abs(qx * ax + z * az);
  // anti-alias in screen space: the band edge moves faster near the limb
  const k = 2.2 / BallRes / Math.max(0.15, Math.abs(ax * (1 - 0) + 0.0001));
  return new Color(1, 1, 1, CasualArt.smooth(BandW + k, BandW - k, d) * edge);
});

/** The numbered white spot (front-facing; squash and rotate it with the ball). */
export const BallSpot = (n: number) => CasualArt.make("pool-spot-" + n, 64, 64, (p) => {
  const px = 2 / 64;
  const r = p.magnitude;
  const a = CasualArt.fill(r - 0.96, px);
  if (a <= 0) return Color.clear;
  if (n === 0) {
    // cue ball: a small red dot so spin is visible
    const red = CasualArt.fill(r - 0.42, px);
    return mix(new Color(1, 1, 1, a), Pal.hex(0xd8262b).withAlpha(a), red);
  }
  const s = 0.62;
  const d = sdNumber(p.x / s, p.y / s + 0.02, n) * s;
  const ink = CasualArt.fill(d - 0.085, px);
  return mix(Pal.hex(0xfbf8ef).withAlpha(a), Pal.hex(0x161616).withAlpha(a), ink);
});

/** Light-fixed shading over a ball: diffuse darkening, rim, specular and a soft cloth bounce. */
export const BallShade = () => CasualArt.make("pool-ball-shade", BallRes, BallRes, (p) => {
  const r = p.magnitude;
  const edge = CasualArt.fill(r - Disc, 2 / BallRes);
  if (edge <= 0) return Color.clear;
  const qx = p.x / Disc, qy = p.y / Disc;
  const z = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy));
  const L = [-0.42, 0.52, 0.74], ll = Math.hypot(L[0], L[1], L[2]);
  const diff = Math.max(0, (qx * L[0] + qy * L[1] + z * L[2]) / ll);
  const dark = clamp01((1 - diff) * 0.62 + sm(0.8, 1, Math.hypot(qx, qy)) * 0.25);
  let c = new Color(0, 0, 0, dark);
  // bounce light from the cloth on the lower right rim
  const bounce = sm(0.6, 1, Math.hypot(qx, qy)) * sm(0, 0.8, qx * 0.5 - qy * 0.8) * 0.18;
  c = CasualArt.over(c, new Color(1, 1, 1, 1), bounce);
  const hx = qx + 0.36, hy = qy - 0.42;
  const spec = sm(0.3, 0, Math.hypot(hx * 1.1, hy * 1.4));
  c = CasualArt.over(c, new Color(1, 1, 1, 1), spec * 0.9);
  const soft = sm(0.75, 0, Math.hypot(hx, hy)) * 0.12;
  c = CasualArt.over(c, new Color(1, 1, 1, 1), soft);
  return c.withAlpha(c.a * edge);
});

/** Composite ball for the HUD/title (n = 0..15). */
export const BallIcon = (n: number) => CasualArt.make("pool-icon-" + n, 64, 64, (p) => {
  const px = 2 / 64;
  const r = p.magnitude;
  const a = CasualArt.fill(r - Disc, px);
  if (a <= 0) return Color.clear;
  const qx = p.x / Disc, qy = p.y / Disc;
  const z = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy));
  const stripe = n >= 9;
  let c = stripe ? Pal.hex(0xf8f6ee) : BallColors[n];
  if (stripe && Math.abs(qy) < BandW + 0.02) c = mix(c, BallColors[n], CasualArt.smooth(BandW + 0.03, BandW - 0.03, Math.abs(qy)));
  // the spot facing the camera
  const sr = 0.5;
  if (r < sr * Disc + px) {
    const sa = CasualArt.fill(r - sr * Disc, px);
    if (n === 0) c = mix(c, Pal.hex(0xd8262b), CasualArt.fill(r - 0.2, px));
    else {
      const s = 0.62 * sr * Disc;
      const d = sdNumber(p.x / s, p.y / s + 0.02, n) * s;
      const spot = mix(Pal.hex(0xfbf8ef), Pal.hex(0x161616), CasualArt.fill(d - 0.085 * sr, px));
      c = mix(c, spot, sa);
    }
  }
  const L = [-0.42, 0.52, 0.74], ll = Math.hypot(L[0], L[1], L[2]);
  const diff = Math.max(0, (qx * L[0] + qy * L[1] + z * L[2]) / ll);
  c = c.scale(0.45 + 0.6 * diff);
  c = mix(c, Color.black, sm(0.8, 1, Math.hypot(qx, qy)) * 0.3);
  const spec = sm(0.3, 0, Math.hypot((qx + 0.36) * 1.1, (qy - 0.42) * 1.4));
  c = mix(c, Color.white, spec * 0.85);
  return c.withAlpha(a);
});

/** Empty slot in the HUD ball tray. */
export const SlotIcon = () => CasualArt.make("pool-slot", 64, 64, (p) => {
  const r = p.magnitude;
  return new Color(1, 1, 1, CasualArt.fill(r - 0.9, 2 / 64) * (0.16 + 0.5 * CasualArt.fill(0.07 - Math.abs(r - 0.84), 2 / 64)));
});

/** Ghost ball ring at the contact point. */
export const GhostSprite = () => CasualArt.make("pool-ghost", 96, 96, (p) => {
  const r = p.magnitude;
  const ring = CasualArt.fill(Math.abs(r - 0.9) - 0.05, 2 / 96);
  return new Color(1, 1, 1, Math.max(ring, CasualArt.fill(r - 0.9, 2 / 96) * 0.16));
});

/** Ball-in-hand marker: a ring with four arrows. */
export const MoveSprite = () => Art.shape("pool-move", (p) => {
  const r = p.magnitude;
  let a = Art.edge(0.045 - Math.abs(r - 0.62));
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2, c = Math.cos(ang), s = Math.sin(ang);
    const lx = p.x * c + p.y * s, ly = -p.x * s + p.y * c;
    a = Math.max(a, Art.poly(new V2(lx, ly), new V2(0.98, 0), new V2(0.76, 0.17), new V2(0.76, -0.17)));
  }
  return a;
});

/** "Illegal target" cross on the ghost ball. */
export const CrossSprite = () => Art.shape("pool-cross", (p) => {
  const d = Math.min(Math.abs(p.x - p.y), Math.abs(p.x + p.y)) / Math.SQRT2;
  return Art.edge(0.1 - d) * Art.edge(0.7 - p.magnitude);
});

// ------------------------------------------------------------------ cue

/** Cue stick profile: t = 0 at the butt, 1 at the tip; v = -1..1 across. Returns null outside. */
function cuePixel(t: number, v: number, px: number): Color {
  const half = Mathf.lerp(1, 0.42, sm(0.25, 1, t));
  const a = CasualArt.fill(Math.abs(v) - half, px);
  if (a <= 0) return Color.clear;
  const q = v / half;
  let c: Color;
  if (t > 0.993) c = Pal.hex(0x3d7bd8); // chalked tip
  else if (t > 0.978) c = Pal.hex(0xf4f0e6); // ferrule
  else if (t > 0.42) c = mix(Pal.hex(0xe8c690), Pal.hex(0xd9ae70), vnoise(t * 60, q * 2));
  else if (t > 0.405) c = Pal.hex(0xd8b25a); // joint ring
  else if (t > 0.17) {
    // ebony forearm with maple points
    c = Pal.hex(0x231410);
    const pt = (0.405 - t) / 0.235;
    if (Math.abs(q) < (1 - pt) * 0.9 && pt > 0.15 && Math.abs(q) > (1 - pt) * 0.9 - 0.25) c = Pal.hex(0xd9ae70);
    if (Math.abs(t - 0.3) < 0.004) c = Pal.hex(0xe2c070);
  } else if (t > 0.07) c = mix(Pal.hex(0x161616), Pal.hex(0x2a2a2a), Math.abs(Math.sin(t * 700 + q * 2)) > 0.7 ? 1 : 0); // wrap
  else if (t > 0.055) c = Pal.hex(0xd8b25a);
  else if (t > 0.012) c = Pal.hex(0x5c1218);
  else c = Pal.hex(0x0e0e0e);
  // cylinder shading with a highlight line
  c = c.scale(0.55 + 0.55 * Math.sqrt(Math.max(0, 1 - q * q)));
  c = mix(c, Color.white, sm(0.45, 0.05, Math.abs(q - 0.42)) * 0.35);
  return c.withAlpha(a);
}

/** Horizontal cue, tip at +x. 1 unit long (scale it to length); thickness ~3.6% of length at the butt. */
export const CueSprite = () => CasualArt.make("pool-cue", 1024, 40, (p) => {
  const t = (p.x + 1) / 2;
  return cuePixel(t, p.y / 0.035, 2 / 1024 / 0.035);
});

/** Vertical cue for the power slider (tip up). */
export const CueVSprite = () => CasualArt.make("pool-cue-v", 40, 640, (p) => {
  const t = (p.y / (640 / 40) + 1) / 2;
  return cuePixel(t, p.x / 0.7, 2 / 40 / 0.7);
});

// ------------------------------------------------------------------ HUD widgets

/** Big cue ball for the spin selector, with crosshairs. */
export const SpinBall = () => CasualArt.make("pool-spin-ball", 160, 160, (p) => {
  const px = 2 / 160;
  const r = p.magnitude;
  const a = CasualArt.fill(r - 0.94, px);
  if (a <= 0) return Color.clear;
  const qx = p.x / 0.94, qy = p.y / 0.94;
  const z = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy));
  const diff = Math.max(0, (qx * -0.42 + qy * 0.52 + z * 0.74) / 1.04);
  let c = Pal.hex(0xf8f6ee).scale(0.62 + 0.42 * diff);
  const cross = Math.min(Math.abs(p.x), Math.abs(p.y));
  c = mix(c, Pal.hex(0x9aa4b0), CasualArt.fill(cross - 0.012, px) * 0.6);
  c = mix(c, Pal.hex(0x9aa4b0), CasualArt.fill(Math.abs(r - 0.47) - 0.01, px) * 0.45);
  c = mix(c, Color.black, sm(0.82, 0.97, r) * 0.25);
  return c.withAlpha(a);
});

/** Ridged wheel segment for fine aim. */
export const RidgeSprite = () => CasualArt.make("pool-ridge", 64, 16, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.92, 0.12), 0.1);
  const c = mix(Pal.hex(0x9aa0aa), Pal.hex(0xf2f4f8), sm(-0.12, 0.12, p.y));
  return c.withAlpha(CasualArt.fill(d, 2 / 64));
});

/** Coin icon. */
export const CoinSprite = () => CasualArt.make("pool-coin", 64, 64, (p) => {
  const px = 2 / 64, r = p.magnitude;
  const a = CasualArt.fill(r - 0.94, px);
  if (a <= 0) return Color.clear;
  let c = mix(Pal.hex(0xe8a317), Pal.hex(0xffe17a), sm(-0.8, 0.8, p.y - p.x * 0.3));
  c = mix(c, Pal.hex(0xb06d0a), CasualArt.fill(Math.abs(r - 0.74) - 0.05, px) * 0.8);
  const star = CasualArt.sdStar(new V2(p.x / 0.55, p.y / 0.55 + 0.05), 0.92, 0.45) * 0.55;
  c = mix(c, Pal.hex(0xfff3b8), CasualArt.fill(star, px) * 0.9);
  return c.withAlpha(a);
});

/** Venue background: deep room colour with a warm lamp glow. */
export const RoomSprite = (top: Color, bottom: Color) => CasualArt.gradient(top, bottom, Pal.hex(0xffc78a).withAlpha(0.18));

/** Store icon composition (256 px): a racked table corner with the 8 ball and cue. */
export const IconArt = () => CasualArt.make("pool-store-icon", 256, 256, (p) => {
  const px = 2 / 256;
  // background: deep green felt with a lamp spot, rounded wooden frame
  const lamp = Math.exp(-((p.x + 0.05) ** 2 + (p.y - 0.1) ** 2) * 1.4);
  let c = mix(Pal.hex(0x0a4a2a), Pal.hex(0x1fa060), lamp);
  c = c.scale(0.92 + (vnoise(p.x * 60, p.y * 60) - 0.5) * 0.08);
  // rails along the top and the left, with a corner pocket
  const rail = Math.max(p.y - 0.62, -p.x - 0.62);
  if (rail > 0) {
    let w = mix(Pal.hex(0x5a2a14), Pal.hex(0x9a5228), 0.5 + 0.4 * Math.sin((p.y > 0.62 && p.x > -0.62 ? p.y : p.x) * 70 + vnoise(p.x * 6, p.y * 6) * 4));
    w = mix(w, Pal.hex(0xe0a070), sm(0.05, 0.0, Math.abs(rail - 0.06)) * 0.4);
    c = mix(c, w, CasualArt.fill(-rail, px));
    // diamonds
    for (const k of [-0.2, 0.3, 0.8]) {
      const d1 = Math.abs(p.x - k) / 0.05 + Math.abs(p.y - 0.8) / 0.03;
      const d2 = Math.abs(p.y + k) / 0.05 + Math.abs(p.x + 0.8) / 0.03;
      if (Math.min(d1, d2) < 1) c = Pal.hex(0xfff6e0);
    }
  } else {
    const cush = Math.max(p.y - 0.54, -p.x - 0.54);
    if (cush > 0) c = mix(c, Pal.hex(0x0f6a3c), 0.6 + cush * 3);
  }
  const ph = Math.hypot(p.x + 0.7, p.y - 0.7);
  c = mix(c, Pal.hex(0xd4a84a), CasualArt.fill(ph - 0.3, px));
  c = mix(c, Pal.hex(0x050505), CasualArt.fill(ph - 0.22, px));
  // balls: rack fragment + the big 8
  const ballAt = (cx: number, cy: number, rad: number, n: number) => {
    const q = new V2((p.x - cx) / rad, (p.y - cy) / rad);
    const r = q.magnitude;
    // shadow
    const sh = Math.hypot(q.x - 0.18, q.y + 0.22);
    c = mix(c, Color.black, sm(1.15, 0.8, sh) * 0.45);
    if (r > 1) return;
    const a = CasualArt.fill(r - 0.94, px / rad);
    const qx = q.x / 0.94, qy = q.y / 0.94, z = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy));
    const stripe = n >= 9;
    let b = stripe ? Pal.hex(0xf8f6ee) : BallColors[n];
    if (stripe) b = mix(b, BallColors[n], sm(0.55, 0.49, Math.abs(qy * 0.9 + qx * 0.3)));
    if (n > 0 && r < 0.48) {
      const s = 0.62 * 0.46;
      const d = sdNumber(q.x / s, q.y / s + 0.02, n) * s;
      b = mix(b, mix(Pal.hex(0xfbf8ef), Pal.hex(0x161616), CasualArt.fill(d - 0.04, px / rad)), CasualArt.fill(r - 0.46, px / rad));
    }
    const diff = Math.max(0, (qx * -0.42 + qy * 0.52 + z * 0.74) / 1.04);
    b = b.scale(0.42 + 0.64 * diff);
    b = mix(b, Color.black, sm(0.8, 1, r) * 0.3);
    b = mix(b, Color.white, sm(0.3, 0, Math.hypot((qx + 0.36) * 1.1, (qy - 0.42) * 1.4)) * 0.9);
    c = mix(c, b, a);
  };
  ballAt(0.62, 0.2, 0.2, 9);
  ballAt(0.7, -0.22, 0.2, 3);
  ballAt(0.32, -0.55, 0.2, 11);
  ballAt(0.78, -0.62, 0.2, 2);
  ballAt(0.04, -0.04, 0.4, 8);
  // cue coming in from the bottom left, aimed at the 8
  const dir = new V2(1, 1.05).normalized;
  const rel = new V2(p.x + 0.36, p.y + 0.4);
  const along = rel.x * dir.x + rel.y * dir.y, across = -rel.x * dir.y + rel.y * dir.x;
  if (along < 0 && along > -1.6) {
    const t = 1 + along / 1.6 * 0.5; // tip region of the profile
    const sh = cuePixel(Mathf.clamp(t, 0, 1), (across + 0.05) / 0.11, px / 0.11);
    c = mix(c, Color.black, sh.a * 0.35);
    const cc = cuePixel(Mathf.clamp(t, 0, 1), across / 0.11, px / 0.11);
    c = CasualArt.over(c, cc);
  }
  // vignette
  c = mix(c, Color.black, sm(0.9, 1.5, Math.hypot(p.x, p.y)) * 0.45);
  return c.withAlpha(1);
});

export const BallSize = (R * 2) / Disc;
export type { Sprite };
