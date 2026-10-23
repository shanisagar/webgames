import { CasualArt, Color, Mathf, Pal, Sprite, V2 } from "../../kit";
import { BaseHalf, BaseY, CentreR, H, Pockets, RC, RP } from "./CarromPhysics";

/**
 * CARROM FLICK procedural art: the board (rosewood frame, maple playing surface with baselines, corner arrows,
 * centre rosette and pockets), coins with turned grooves, the striker, slider rails, the room and the HUD icons.
 * Everything is rasterized once by CasualArt and cached.
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
const mix = (a: Color, b: Color, t: number) => Color.lerp(a, b, t);

/** Frame width outside the playing surface (board units). */
export const Frame = 1.5;
export const BoardHalf = H + Frame;

export interface Theme { name: string; surface: Color; surface2: Color; frame: Color; frame2: Color; ink: Color; red: Color; roomTop: Color; roomBottom: Color }
export const Themes: Theme[] = [
  { name: "MAPLE", surface: Pal.hex(0xf3d9a4), surface2: Pal.hex(0xe2bd7c), frame: Pal.hex(0x6b2a17), frame2: Pal.hex(0x3a130a), ink: Pal.hex(0x2a1608), red: Pal.hex(0xc8231f), roomTop: Pal.hex(0x3a2016), roomBottom: Pal.hex(0x120806) },
  { name: "ROSEWOOD", surface: Pal.hex(0xf1cf98), surface2: Pal.hex(0xd8a868), frame: Pal.hex(0x2e2a26), frame2: Pal.hex(0x121010), ink: Pal.hex(0x1b120a), red: Pal.hex(0x1f6f5c), roomTop: Pal.hex(0x14322e), roomBottom: Pal.hex(0x061210) },
  { name: "ROYAL", surface: Pal.hex(0xf6e2b8), surface2: Pal.hex(0xe4c48a), frame: Pal.hex(0x2a3c8c), frame2: Pal.hex(0x101a48), ink: Pal.hex(0x1a1430), red: Pal.hex(0xd2a21e), roomTop: Pal.hex(0x1c1c48), roomBottom: Pal.hex(0x08081a) },
];

/** Distance to the baseline graphics of one side, in the side's local frame (baseline along x, at y = -BaseY). */
function baselineInk(lx: number, ly: number) {
  // two long lines at the striker line ± RC, joined by the end circles
  const y0 = -BaseY;
  let d = 1e9;
  const ax = Math.abs(lx);
  if (ax <= BaseHalf) { d = Math.min(d, Math.abs(ly - (y0 - RC)), Math.abs(ly - (y0 + RC))); }
  const cd = Math.hypot(ax - BaseHalf, ly - y0);
  d = Math.min(d, Math.abs(cd - RC));
  return { line: d, dot: cd };
}

/** The whole board: frame + surface + markings. 2·BoardHalf units square. */
export const BoardSprite = (t: Theme) => CasualArt.make("cr-board-" + t.name, 760, 760, (p) => {
  const ux = p.x * BoardHalf, uy = p.y * BoardHalf;
  const px = (2 * BoardHalf) / 760;
  const ax = Math.abs(ux), ay = Math.abs(uy);
  const outer = CasualArt.sdBox(new V2(ux, uy), new V2(BoardHalf, BoardHalf), 0.7);
  if (outer > 0) return Color.clear;
  const edgeA = CasualArt.fill(outer, px);
  const inside = Math.max(ax, ay) - H;
  if (inside > 0) {
    // frame: wood grain running along each side, bevel at both edges
    const along = ax > ay ? uy : ux, across = ax > ay ? ax : ay;
    const g = vnoise(along * 0.6, across * 9) * 0.6 + vnoise(along * 2.5, across * 22) * 0.4;
    let c = mix(t.frame2, t.frame, 0.55 + 0.45 * g);
    const k = (across - H) / Frame; // 0 inner .. 1 outer
    c = mix(c, CasualArt.lighten(t.frame, 0.35), sm(0.18, 0.02, k) * 0.55);
    c = mix(c, CasualArt.darken(t.frame2, 0.4), sm(0.75, 1.0, k) * 0.6);
    // light from the top-left: brighter top/left rails
    const lit = (ay > ax ? (uy > 0 ? 0.12 : -0.1) : ux < 0 ? 0.06 : -0.06);
    c = CasualArt.lighten(c, Math.max(0, lit));
    c = CasualArt.darken(c, Math.max(0, -lit));
    // mitred corner seams
    if (Math.abs(ax - ay) < 0.04 && ax > H) c = CasualArt.darken(c, 0.35);
    // inner shadow line on the surface edge
    if (k < 0.04) c = CasualArt.darken(c, 0.5);
    return c.withAlpha(edgeA);
  }
  // playing surface: maple with soft grain and a lamp-lit centre
  const g = vnoise(ux * 0.35, uy * 4.2) * 0.65 + vnoise(ux * 1.7, uy * 14) * 0.35;
  let c = mix(t.surface2, t.surface, 0.35 + 0.65 * g);
  const r2 = (ux * ux + uy * uy) / (H * H * 2);
  c = CasualArt.darken(c, r2 * 0.22);
  c = CasualArt.darken(c, sm(-0.5, 0, inside) * 0.18);
  const ink = t.ink, red = t.red;
  const lineW = 0.055;
  // baselines on all four sides
  for (let s = 0; s < 4; s++) {
    const lx = s === 0 ? ux : s === 1 ? -ux : s === 2 ? uy : -uy;
    const ly = s === 0 ? uy : s === 1 ? -uy : s === 2 ? -ux : ux;
    if (ly > -BaseY + 1.2 || ly < -BaseY - 1.2) continue;
    const b = baselineInk(lx, ly);
    if (b.dot < RC * 0.72) c = mix(c, red, CasualArt.fill(b.dot - RC * 0.72, px));
    c = mix(c, ink, CasualArt.fill(b.line - lineW, px));
  }
  // corner arrows: a diagonal towards each pocket with an arrowhead and an arc at the inner end
  const dx = ax, dy = ay;
  const along = (dx + dy) / Math.SQRT2, across = (dx - dy) / Math.SQRT2;
  const a0 = 3.8 * Math.SQRT2, a1 = 8.15 * Math.SQRT2;
  if (along > a0 - 1 && along < a1 + 0.6) {
    let d = 1e9;
    if (along >= a0 && along <= a1 - 0.2) d = Math.abs(across);
    // head
    const hx = along - a1, hy = Math.abs(across);
    if (hx < 0 && hx > -0.75) d = Math.min(d, Math.abs(hy - (-hx) * 0.55) + Math.max(0, -0.75 - hx));
    d = Math.min(d, CasualArt.sdSegment(new V2(along, Math.abs(across)), new V2(a1, 0), new V2(a1 - 0.7, 0.4)));
    // the arc around the inner end
    const ad = Math.hypot(along - (a0 + 0.62), across);
    if (along < a0 + 0.62) d = Math.min(d, Math.abs(ad - 0.62));
    c = mix(c, ink, CasualArt.fill(d - lineW, px));
  }
  // centre: circle, inner rosette and red queen spot
  const rr = Math.hypot(ux, uy);
  c = mix(c, ink, CasualArt.fill(Math.abs(rr - CentreR) - lineW, px));
  c = mix(c, ink, CasualArt.fill(Math.abs(rr - CentreR + 0.18) - lineW * 0.6, px));
  const ang = Math.atan2(uy, ux);
  const petal = 1.55 * (0.55 + 0.45 * Math.abs(Math.cos(ang * 4)));
  if (rr < petal) {
    const inner = clamp01((petal - rr) / 0.12);
    c = mix(c, mix(red, ink, 0.15), 0.85 * inner * sm(0.5, 0.62, rr));
  }
  c = mix(c, ink, CasualArt.fill(Math.abs(rr - 0.55) - lineW, px));
  if (rr < 0.48) c = mix(c, red, CasualArt.fill(rr - 0.42, px));
  // pockets: dark holes with a brass-ish lip shadow
  for (const [qx, qy] of Pockets) {
    const pd = Math.hypot(ux - qx, uy - qy);
    if (pd < RP + 0.12) {
      c = mix(c, CasualArt.darken(t.surface2, 0.45), CasualArt.fill(pd - RP - 0.1, px) * 0.6);
      const depth = sm(RP, RP * 0.2, pd);
      const hole = mix(Pal.hex(0x2a1a10), Pal.hex(0x050302), depth);
      c = mix(c, hole, CasualArt.fill(pd - RP, px));
    }
  }
  return c.withAlpha(edgeA);
});

/** Soft shadow under the board (a rounded square). */
export const BoardShadow = () => CasualArt.make("cr-board-shadow", 128, 128, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.78, 0.78), 0.12);
  const a = sm(0.22, -0.05, d);
  return new Color(0, 0, 0, a * 0.65);
});

/** A coin seen from above: flat face with turned grooves, bevelled rim, lit from the top-left. */
function coinPixel(p: V2, base: Color, groove: Color, px: number, striker = false) {
  const r = p.magnitude;
  const a = CasualArt.fill(r - 0.95, px);
  if (a <= 0) return base.withAlpha(0);
  let c = base;
  // turned grooves
  const rings = striker ? [0.78, 0.58] : [0.74, 0.52, 0.3];
  for (const rg of rings) c = mix(c, groove, CasualArt.fill(Math.abs(r - rg) - 0.035, px) * 0.75);
  // subtle wood/ivory texture
  c = CasualArt.darken(c, (vnoise(p.x * 6 + 3, p.y * 6) - 0.5) * 0.08);
  // bevel: light top-left, dark bottom-right on the rim
  const rim = sm(0.8, 0.95, r);
  const lit = (-p.x * 0.6 + p.y * 0.8) / Math.max(0.001, r);
  c = mix(c, lit > 0 ? CasualArt.lighten(base, 0.5) : CasualArt.darken(base, 0.45), rim * Math.abs(lit) * 0.8);
  // face sheen
  const sh = sm(0.75, 0, Math.hypot(p.x + 0.32, p.y - 0.38));
  c = mix(c, Color.white, sh * 0.22);
  // dark outer edge line
  c = mix(c, CasualArt.darken(base, 0.55), sm(0.9, 0.95, r) * 0.7);
  return c.withAlpha(a);
}

export const CoinColors = [Pal.hex(0xf4ead2), Pal.hex(0x2b2220), Pal.hex(0xd6213e)];
const CoinGrooves = [Pal.hex(0xc8b38a), Pal.hex(0x6a5546), Pal.hex(0x8a0f22)];

export const CoinSprite = (colour: number) => CasualArt.make("cr-coin" + colour, 112, 112, (p) => coinPixel(p, CoinColors[colour], CoinGrooves[colour], 2 / 112));

/** The striker: ivory disc, coloured inlay star in the middle. Tint ring drawn separately. */
export const StrikerSprite = () => CasualArt.make("cr-striker", 144, 144, (p) => {
  let c = coinPixel(p, Pal.hex(0xfbf6ea), Pal.hex(0xc9bda4), 2 / 144, true);
  if (c.a <= 0) return c;
  const st = CasualArt.sdStar(p.mul(1 / 0.46), 0.95, 0.45) * 0.46;
  c = mix(c, Pal.hex(0x2c6fd6), CasualArt.fill(st, 2 / 144) * 0.9);
  const dot = p.magnitude;
  c = mix(c, Pal.hex(0xd6213e), CasualArt.fill(dot - 0.1, 2 / 144));
  return c;
});

/** A soft ring (striker selection glow / ghost). */
export const RingSprite = () => CasualArt.make("cr-ring", 128, 128, (p) => {
  const r = p.magnitude;
  return new Color(1, 1, 1, CasualArt.fill(Math.abs(r - 0.86) - 0.07, 2 / 128));
});
export const GlowRing = () => CasualArt.make("cr-glow-ring", 128, 128, (p) => {
  const r = p.magnitude;
  const a = Math.exp(-((r - 0.62) ** 2) / 0.02) * 0.9 + sm(1, 0.6, r) * 0.15;
  return new Color(1, 1, 1, clamp01(a) * sm(1, 0.92, r));
});

/** Slider rail under a baseline: a rounded groove with tick marks. Width 1 (stretched by the game). */
export const RailSprite = () => CasualArt.make("cr-rail", 512, 64, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.98, 0.11), 0.11);
  const a = CasualArt.fill(d, 2 / 512);
  if (a <= 0) return Color.clear;
  // polished wood bar with a dark centre groove and ivory ticks
  let c = mix(Pal.hex(0x5a2614), Pal.hex(0xa0532c), sm(-0.11, 0.09, p.y));
  c = mix(c, Pal.hex(0xd88a52), sm(0.06, 0.1, p.y) * 0.6);
  c = mix(c, Pal.hex(0x1a0a05), CasualArt.fill(Math.abs(p.y) - 0.022, 2 / 512) * 0.85);
  for (let k = -6; k <= 6; k++) {
    const x = k * 0.14;
    if (Math.abs(p.x - x) < 0.005 && Math.abs(p.y) > 0.035 && Math.abs(p.y) < 0.075) c = mix(c, Pal.hex(0xf3dfb8), 0.8);
  }
  c = mix(c, Pal.hex(0x2a0f06), sm(-0.06, 0, d) * 0.7);
  return c.withAlpha(a);
});

/** Background: warm room with a soft lamp pool. */
export const RoomSprite = (t: Theme) => CasualArt.make("cr-room-" + t.name, 128, 256, (p) => {
  const ty = (p.y + 2) / 4;
  let c = mix(t.roomBottom, t.roomTop, sm(0, 1, ty));
  const g = Math.exp(-(p.x * p.x * 1.4 + p.y * p.y * 0.45));
  c = mix(c, CasualArt.lighten(t.roomTop, 0.25), g * 0.55);
  // faint woven rug pattern
  const w = (Math.sin(p.x * 40) * Math.sin(p.y * 40)) * 0.5 + 0.5;
  c = CasualArt.darken(c, w * 0.04);
  return c.withAlpha(1);
});

/** Small HUD coin icons. */
export const CoinIcon = (colour: number) => CoinSprite(colour);
export const EmptySlot = () => CasualArt.make("cr-slot", 64, 64, (p) => {
  const r = p.magnitude;
  return new Color(1, 1, 1, CasualArt.fill(Math.abs(r - 0.78) - 0.06, 2 / 64) * 0.35 + CasualArt.fill(r - 0.78, 2 / 64) * 0.08);
});

/** Gold coin for the wallet. */
export const GoldSprite = () => CasualArt.make("cr-gold", 96, 96, (p) => {
  const c = CasualArt.ballPixel(p, Pal.hex(0xffc93c), 2 / 96, 0.92);
  if (c.a <= 0) return c;
  const st = CasualArt.sdStar(p.mul(1 / 0.5), 0.9, 0.45) * 0.5;
  return mix(c, Pal.hex(0xd08a10), CasualArt.fill(st, 2 / 96) * 0.7);
});

/** Aim+ booster icon (a crosshair). */
export const AimIcon = () => CasualArt.make("cr-aim", 96, 96, (p) => {
  const r = p.magnitude;
  let a = CasualArt.fill(Math.abs(r - 0.62) - 0.08, 2 / 96);
  if (r > 0.25 && r < 0.95) a = Math.max(a, CasualArt.fill(Math.min(Math.abs(p.x), Math.abs(p.y)) - 0.07, 2 / 96));
  a = Math.max(a, CasualArt.fill(r - 0.12, 2 / 96));
  return new Color(1, 1, 1, a);
});

export function hd(s: Sprite) { return CasualArt.hd(s); }
