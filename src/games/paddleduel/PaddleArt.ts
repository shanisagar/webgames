import { CasualArt, Color, Pal, Sprite, V2 } from "../../kit";
import { HL, HW } from "./PaddleSim";

/**
 * PADDLE DUEL procedural art: a neon-retro court (glowing side rails, dashed centre net, faint pixel grid), pixel
 * digits for the giant scores, paddle skins, ball skins and CRT scanlines. Rasterized once by CasualArt and cached.
 */

const sm = CasualArt.smooth;
const mix = (a: Color, b: Color, t: number) => Color.lerp(a, b, t);

export const P1Col = Pal.hex(0x2ef2ff), P2Col = Pal.hex(0xff3fa8), Gold = Pal.hex(0xffd23f), Ink = Pal.hex(0x060414);
export const CourtMargin = 0.9;
export const CourtW = (HW + CourtMargin) * 2, CourtH = (HL + CourtMargin) * 2;

export const CourtSprite = () => CasualArt.make("pd-court", 400, 654, (p) => {
  const k = CourtW / 2, x = p.x * k, y = p.y * k, px = CourtW / 400;
  const half = y < 0 ? P1Col : P2Col;
  // outside the rails: a soft glow only
  const dx = Math.abs(x) - HW;
  if (dx > 0) {
    const g = Math.exp(-dx * 3.2) * 0.55 * sm(HL + 0.6, HL - 1, Math.abs(y));
    const rail = CasualArt.fill(dx - 0.09, px);
    return mix(half.withAlpha(g * 0.5), CasualArt.lighten(half, 0.45), rail);
  }
  // floor: deep violet with a faint pixel grid and vignette toward the ends
  let c = mix(Pal.hex(0x120a30), Pal.hex(0x070418), sm(0, HL + 1, Math.abs(y)));
  const gx = Math.abs(x / 0.5 - Math.round(x / 0.5)), gy = Math.abs(y / 0.5 - Math.round(y / 0.5));
  if (gx < 0.06 || gy < 0.06) c = mix(c, half, 0.07);
  c = mix(c, half, 0.05 * sm(HL, 2, Math.abs(y)));
  // inner glow along the rails
  c = mix(c, half, Math.exp(-(HW - Math.abs(x)) * 2.2) * 0.35);
  // dashed centre net (pixel blocks)
  const seg = 0.9, dash = Math.abs(x / seg - Math.round(x / seg)) < 0.28;
  if (dash && Math.abs(y) < 0.16) c = mix(c, Pal.hex(0xf4ecff), 0.9);
  c = mix(c, Pal.hex(0xb79cff), Math.exp(-Math.abs(y) * 5) * 0.12);
  // goal lines: thin dotted strips in each player's colour
  const ey = Math.abs(Math.abs(y) - HL);
  if (ey < 0.07 && Math.abs(x / 0.4 - Math.round(x / 0.4)) < 0.3) c = mix(c, half, 0.75);
  c = mix(c, half, Math.exp(-ey * 6) * 0.15 * (Math.abs(y) < HL ? 1 : 0.4));
  // centre circle
  const r = Math.hypot(x, y);
  c = mix(c, Pal.hex(0xb79cff), CasualArt.fill(Math.abs(r - 2.1) - 0.04, px) * 0.35);
  const fadeEnds = Math.abs(y) > HL ? sm(HL + CourtMargin, HL, Math.abs(y)) : 1;
  return c.withAlpha(0.94 * fadeEnds);
});

/** 3×5 pixel digits for the scores (one world unit wide). */
const Glyphs: Record<string, string> = {
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
  "5": "111100111001111", "6": "111100111101111", "7": "111001001001001", "8": "111101111101111", "9": "111101111001111",
};
export const DigitSprite = (d: string) => CasualArt.make("pd-digit-" + d, 96, 160, (p) => {
  const g = Glyphs[d] ?? Glyphs["0"];
  const H = 160 / 96;
  const col = Math.floor((p.x + 1) / 2 * 3), row = Math.floor((H - p.y) / (2 * H) * 5);
  if (col < 0 || col > 2 || row < 0 || row > 4) return Color.clear;
  if (g[row * 3 + col] !== "1") return Color.clear;
  const cx = -1 + (col + 0.5) * (2 / 3), cy = H - (row + 0.5) * (2 * H / 5);
  const d2 = CasualArt.sdBox(new V2(p.x - cx, p.y - cy), new V2(0.3, 0.3), 0.06);
  const a = CasualArt.fill(d2, 2 / 96);
  const inner = sm(0.3, 0.05, Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy)));
  return new Color(1, 1, 1, a * (0.82 + 0.18 * inner));
});

// ------------------------------------------------------------------ skins

export interface PaddleSkin { name: string; cost: number; a: Color; b: Color; style: number }
export const PaddleSkins: PaddleSkin[] = [
  { name: "NEON CYAN", cost: 0, a: P1Col, b: Pal.hex(0x1a7dff), style: 0 },
  { name: "LIME LASER", cost: 150, a: Pal.hex(0x8dff3a), b: Pal.hex(0x1fbf6a), style: 0 },
  { name: "SUNSET", cost: 300, a: Pal.hex(0xffb03a), b: Pal.hex(0xff3f7a), style: 1 },
  { name: "ICE STRIPE", cost: 450, a: Pal.hex(0xe8fbff), b: Pal.hex(0x5ab8ff), style: 2 },
  { name: "GOLD BAR", cost: 700, a: Pal.hex(0xfff09a), b: Pal.hex(0xd99a1a), style: 3 },
  { name: "RAINBOW", cost: 1000, a: Pal.hex(0xff4a6a), b: Pal.hex(0x4a9aff), style: 4 },
];
export const RivalSkin: PaddleSkin = { name: "RIVAL", cost: 0, a: P2Col, b: Pal.hex(0x9a2aff), style: 0 };

function hue(h: number) {
  const f = (n: number) => { const k = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(1, Math.min(k, 4 - k))); };
  return new Color(f(5), f(3), f(1), 1);
}

/** A paddle: rounded neon bar, one world unit long, 1/4 as tall (body is the middle third). */
export const PaddleSprite = (s: PaddleSkin, key: string) => CasualArt.make("pd-paddle-" + key, 256, 64, (p) => {
  const px = 2 / 256;
  const d = CasualArt.sdBox(p, new V2(0.95, 0.15), 0.14);
  const glow = Math.exp(-Math.max(0, d) * 22) * 0.55;
  if (d > 0.1) return Color.clear;
  const t = (p.x + 1) / 2;
  let c: Color;
  switch (s.style) {
    case 1: c = mix(s.a, s.b, t); break;
    case 2: c = (Math.floor((p.x + 2) * 7) % 2 === 0) ? s.a : s.b; break;
    case 3: c = mix(s.b, s.a, sm(-0.15, 0.12, p.y) * 0.8 + 0.2 * Math.sin(p.x * 9)); break;
    case 4: c = hue(t * 0.85); break;
    default: c = mix(s.b, s.a, sm(-0.2, 0.15, p.y)); break;
  }
  c = mix(c, Color.white, CasualArt.fill(Math.abs(p.y - 0.06) - 0.025, px) * 0.65 * sm(0.95, 0.7, Math.abs(p.x)));
  const edge = CasualArt.fill(d, px);
  const rim = mix(c, CasualArt.lighten(c, 0.6), CasualArt.fill(Math.abs(d + 0.02) - 0.015, px) * 0.7);
  const glowCol = (s.style === 4 ? hue(t * 0.85) : s.a).withAlpha(glow);
  return edge > 0 ? CasualArt.over(glowCol, rim.withAlpha(1), edge) : glowCol;
});

export interface BallSkin { name: string; cost: number; col: Color; shape: number }
export const BallSkins: BallSkin[] = [
  { name: "PIXEL", cost: 0, col: Pal.hex(0xfff6c8), shape: 0 },
  { name: "ORB", cost: 150, col: Pal.hex(0x6af0ff), shape: 1 },
  { name: "STAR", cost: 300, col: Gold, shape: 2 },
  { name: "COMET", cost: 450, col: Pal.hex(0xff8a3a), shape: 1 },
  { name: "DIAMOND", cost: 650, col: Pal.hex(0xff6ad5), shape: 3 },
  { name: "PLASMA", cost: 900, col: Pal.hex(0x9dff5a), shape: 4 },
];

function ballAlpha(shape: number, p: V2, px: number) {
  switch (shape) {
    case 1: return CasualArt.fill(p.magnitude - 0.62, px);
    case 2: return CasualArt.fill(CasualArt.sdStar(p.add(new V2(0, 0.05)), 0.78, 0.45), px);
    case 3: return CasualArt.fill(Math.abs(p.x) + Math.abs(p.y) - 0.72, px);
    case 4: return Math.max(CasualArt.fill(Math.abs(p.magnitude - 0.5) - 0.13, px), CasualArt.fill(p.magnitude - 0.18, px));
    default: return CasualArt.fill(CasualArt.sdBox(p, new V2(0.56, 0.56), 0.04), px);
  }
}

/** A ball skin with its own glow, one world unit wide (the body is ~0.6 wide). */
export const BallSprite = (b: BallSkin, key: string) => CasualArt.make("pd-ball-" + key, 96, 96, (p) => {
  const px = 2 / 96;
  const a = ballAlpha(b.shape, p, px);
  const glow = Math.exp(-p.sqrMagnitude * 3.2) * 0.5;
  let c = mix(b.col, Color.white, sm(0.5, 0, Math.hypot(p.x + 0.15, p.y - 0.18)) * 0.7);
  if (b.shape === 0) c = mix(b.col, Color.white, (p.x < -0.2 && p.y > 0.2) ? 0.6 : 0.15);
  return CasualArt.over(b.col.withAlpha(glow), c.withAlpha(1), a);
});

/** Pixel ghost square for the trail (tinted per skin). */
export const GhostSprite = () => CasualArt.make("pd-ghost", 32, 32, (p) => new Color(1, 1, 1, CasualArt.fill(CasualArt.sdBox(p, new V2(0.8, 0.8), 0.05), 2 / 32)));

/** CRT scanlines: many thin dark lines in a tall strip, stretched over the view. */
export const ScanSprite = () => CasualArt.make("pd-scan", 8, 600, (p) => {
  const yy = (p.y + 75) * 1.0;
  const f = yy - Math.floor(yy);
  return new Color(0, 0, 0, f < 0.45 ? 0.55 : 0);
});

export const CoinSprite = () => CasualArt.make("pd-coin", 96, 96, (p) => {
  const c = CasualArt.ballPixel(p, Gold, 2 / 96, 0.92);
  if (c.a <= 0) return c;
  return mix(c, Pal.hex(0xc88a10), CasualArt.fill(Math.abs(p.magnitude - 0.6) - 0.06, 2 / 96) * 0.7);
});

export const SkinPreview = (s: PaddleSkin): Sprite => PaddleSprite(s, s.name);
