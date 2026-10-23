import { CasualArt, Color, Pal, V2 } from "../../kit";

/**
 * CASH-OUT ROCKET procedural art: a cartoon space sky (twilight gradient, stars, ringed planet, cloud bank), rocket
 * skins, the flame, the shield bubble, flags, coins and HUD icons. Bright and toy-like, never casino-like.
 */

const sm = CasualArt.smooth;
const mix = (a: Color, b: Color, t: number) => Color.lerp(a, b, t);

export const P1Col = Pal.hex(0x3ee0ff), P2Col = Pal.hex(0xff7ad1), Gold = Pal.hex(0xffd23f), Ink = Pal.hex(0x1a0f3a);
export const Mint = Pal.hex(0x5cf2a6), Flame = Pal.hex(0xff8a2a), Danger = Pal.hex(0xff4d5e), Sky = Pal.hex(0x8fd8ff);

function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }

export const SkySprite = () => CasualArt.make("cr-sky", 256, 512, (p) => {
  const h = 2; // p.y in [-2, 2]
  const t = (p.y + h) / (2 * h);
  let c = mix(Pal.hex(0xff9ab8), Pal.hex(0x6a3cc8), sm(0.0, 0.35, t));
  c = mix(c, Pal.hex(0x2a1670), sm(0.3, 0.7, t));
  c = mix(c, Pal.hex(0x120a3c), sm(0.65, 1, t));
  return c;
});

/** A square star field (kept square so stars stay round on any screen). */
export const StarsSprite = () => CasualArt.make("cr-stars", 512, 512, (p) => {
  const n = 46, gx = Math.floor((p.x + 1) * n / 2), gy = Math.floor((p.y + 1) * n / 2);
  const r = hash(gx, gy);
  if (r < 0.62) return Color.clear;
  const ox = hash(gx + 3, gy + 9) * 0.6 + 0.2, oy = hash(gx + 11, gy + 5) * 0.6 + 0.2;
  const cx = (gx + ox) / n * 2 - 1, cy = (gy + oy) / n * 2 - 1;
  const d = Math.hypot(p.x - cx, p.y - cy) * 256;
  const size = 0.8 + 1.4 * hash(gx + 1, gy + 2);
  const a = CasualArt.smooth(size + 0.8, size * 0.3, d) * (0.35 + 0.65 * hash(gx + 7, gy + 3)) * CasualArt.smooth(-0.85, -0.1, p.y);
  return new Color(1, 1, 1, a);
});

export const PlanetSprite = () => CasualArt.make("cr-planet", 192, 128, (p) => {
  const px = 2 / 192;
  const r = Math.hypot(p.x, p.y);
  // ring behind/in front
  const ry = (p.y + p.x * 0.18) / 0.28, rr = Math.hypot(p.x / 0.95, ry);
  const ringA = CasualArt.fill(Math.abs(rr - 0.86) - 0.1, px * 3) * 0.9;
  const bodyA = CasualArt.fill(r - 0.42, px);
  let c = mix(Pal.hex(0xffb36b), Pal.hex(0xff6f91), sm(-0.4, 0.4, p.y - p.x * 0.4));
  c = mix(c, Pal.hex(0xffe0a8), CasualArt.fill(Math.abs(p.y + 0.08 + p.x * 0.1) - 0.05, px * 2) * 0.6);
  c = mix(c, Color.white, sm(0.25, 0, Math.hypot(p.x + 0.16, p.y - 0.18)) * 0.5);
  const ringCol = Pal.hex(0xfff0c8).withAlpha(ringA);
  const front = ry < 0;
  let out = CasualArt.over(Color.clear, ringCol.withAlpha(front ? 0 : ringA));
  out = CasualArt.over(out, c.withAlpha(1), bodyA);
  if (front) out = CasualArt.over(out, ringCol);
  return out;
});

export const CloudSprite = () => CasualArt.make("cr-clouds", 512, 128, (p) => {
  // p.y in [-0.25, 0.25]
  let top = -0.1;
  for (let k = 0; k < 7; k++) {
    const cx = -1 + k * 0.33 + (k % 2) * 0.08, rad = 0.12 + 0.05 * ((k * 37) % 3);
    const dx = p.x - cx;
    if (Math.abs(dx) < rad) top = Math.max(top, -0.1 + Math.sqrt(rad * rad - dx * dx) * 0.9);
  }
  const d = p.y - top;
  const a = CasualArt.fill(d, 2 / 512 * 2);
  const c = mix(Pal.hex(0xffc6dc), Pal.hex(0xfff2f7), sm(-0.25, top, p.y));
  return c.withAlpha(a);
});

// ------------------------------------------------------------------ rockets

export interface RocketSkin { name: string; cost: number; body: Color; accent: Color; trim: Color; stars: boolean }
export const RocketSkins: RocketSkin[] = [
  { name: "CLASSIC", cost: 0, body: Pal.hex(0xf4f4ff), accent: Pal.hex(0xff4d5e), trim: Pal.hex(0x3ec8ff), stars: false },
  { name: "BLUEBIRD", cost: 150, body: Pal.hex(0x4aa8ff), accent: Pal.hex(0xffd23f), trim: Pal.hex(0xffffff), stars: false },
  { name: "BUBBLEGUM", cost: 300, body: Pal.hex(0xff9ad5), accent: Pal.hex(0x5cf2c6), trim: Pal.hex(0xffffff), stars: false },
  { name: "JUNGLE", cost: 450, body: Pal.hex(0x5cd65c), accent: Pal.hex(0xff9a3a), trim: Pal.hex(0xfff3a0), stars: false },
  { name: "GOLDEN", cost: 700, body: Pal.hex(0xffd84a), accent: Pal.hex(0xff7a2a), trim: Pal.hex(0xfffbe0), stars: false },
  { name: "STARLIGHT", cost: 1000, body: Pal.hex(0x2a2a7a), accent: Pal.hex(0xb98cff), trim: Pal.hex(0xffe26a), stars: true },
];

/** Rocket pointing right (+x), one world unit long, half as tall. */
export const RocketSprite = (s: RocketSkin, key: string) => CasualArt.make("cr-rocket-" + key, 192, 96, (p) => {
  const px = 2 / 192;
  // body: capsule with a pointed nose
  const bx = p.x;
  let half = 0;
  if (bx > -0.62 && bx < 0.92) {
    half = 0.2;
    if (bx > 0.42) half = 0.2 * Math.pow(Math.max(0, 1 - (bx - 0.42) / 0.5), 0.75);
    if (bx < -0.5) half = 0.2 * Math.sqrt(Math.max(0, 1 - Math.pow((bx + 0.5) / 0.12, 2)));
  }
  const dBody = half > 0 ? Math.abs(p.y) - half : 1;
  // fins (back, top and bottom)
  const fx = bx + 0.38;
  const inFin = bx < -0.28 && bx > -0.76 && Math.abs(p.y) < 0.2 + Math.min(0.24, (-0.28 - bx) * 0.75) && Math.abs(p.y) > 0.05;
  const dFin = inFin ? -1 : 1;
  const outline = 0.035;
  const aBody = CasualArt.fill(dBody, px), aFin = inFin ? 1 : 0;
  const aOut = Math.max(CasualArt.fill(dBody - outline, px), inFin ? 1 : CasualArt.fill(Math.abs(p.y) - (0.2 + Math.min(0.26, (-0.26 - bx) * 0.75)), px) * (bx < -0.25 && bx > -0.8 ? 1 : 0));
  if (aOut <= 0) return Color.clear;
  void fx; void dFin;
  let c = Ink;
  if (aFin > 0) c = mix(CasualArt.darken(s.accent, 0.15), s.accent, sm(-0.4, 0.4, p.y));
  if (aBody > 0) {
    let b = s.body;
    if (s.stars && hash(Math.floor(bx * 30), Math.floor(p.y * 30)) > 0.9) b = mix(b, s.trim, 0.9);
    if (bx > 0.5) b = s.accent; // nose cone
    if (bx > -0.44 && bx < -0.34) b = s.trim; // band
    if (bx < -0.5) b = CasualArt.darken(s.accent, 0.2); // nozzle
    b = mix(CasualArt.darken(b, 0.25), CasualArt.lighten(b, 0.25), sm(-0.2, 0.18, p.y));
    b = mix(b, Color.white, CasualArt.fill(Math.abs(p.y - 0.11) - 0.025, px) * 0.55 * sm(0.5, 0.2, Math.abs(bx - 0.0)));
    // porthole
    const w = Math.hypot(bx - 0.14, p.y);
    if (w < 0.13) {
      let g = mix(Pal.hex(0x1a5ab0), Sky, sm(0.11, -0.05, Math.hypot(bx - 0.1, p.y - 0.05)));
      g = mix(g, Color.white, sm(0.04, 0, Math.hypot(bx - 0.1, p.y - 0.05)));
      b = mix(s.trim, g, CasualArt.fill(w - 0.095, px));
    }
    c = mix(c, b, aBody);
  }
  return c.withAlpha(aOut);
});

export const FlameSprite = () => CasualArt.make("cr-flame", 128, 64, (p) => {
  // teardrop pointing left, base at the right edge
  const x = (p.x + 1) / 2; // 0 tail .. 1 base
  const half = 0.42 * Math.pow(x, 0.6) * (1 - Math.pow(Math.max(0, x - 0.85) / 0.15, 2));
  const d = Math.abs(p.y) - half;
  const a = CasualArt.fill(d, 4 / 128) * sm(0, 0.25, x);
  const core = sm(half, half * 0.2, Math.abs(p.y)) * sm(0.3, 0.9, x);
  const c = mix(Pal.hex(0xff5a2a), Pal.hex(0xffe27a), core);
  return mix(c, Color.white, core * core * 0.6).withAlpha(a);
});

export const ShieldBubble = () => CasualArt.make("cr-shield", 128, 128, (p) => {
  const px = 2 / 128, r = p.magnitude;
  const ring = CasualArt.fill(Math.abs(r - 0.86) - 0.07, px);
  const fillA = CasualArt.fill(r - 0.86, px) * 0.35;
  let out = new Color(0.55, 0.95, 1, fillA);
  out = CasualArt.over(out, Pal.hex(0xc8f6ff).withAlpha(ring));
  // shield emblem
  const y = p.y, x = Math.abs(p.x);
  const inS = y > -0.05 ? (x < 0.36 && y < 0.42) : x < 0.36 * Math.max(0, 1 - (-0.05 - y) / 0.5);
  if (inS) {
    let c = mix(Pal.hex(0x2a9cff), Pal.hex(0x8ae6ff), sm(-0.4, 0.4, y));
    if (Math.abs(p.x) < 0.06 || (Math.abs(y - 0.12) < 0.05)) c = mix(c, Color.white, 0.8);
    out = CasualArt.over(out, c.withAlpha(1));
  }
  out = CasualArt.over(out, Color.white.withAlpha(sm(0.22, 0, Math.hypot(p.x + 0.42, p.y - 0.42)) * 0.8));
  return out;
});

export const FlagSprite = () => CasualArt.make("cr-flag", 64, 96, (p) => {
  // pole on the left, pennant to the right (y up 0..)
  const pole = Math.abs(p.x + 0.7) < 0.08 && p.y > -1.45 && p.y < 1.3;
  const flag = p.x > -0.65 && p.x < 0.85 && p.y > 0.3 && p.y < 1.3 && Math.abs(p.y - 0.8) < 0.5 * (1 - (p.x + 0.65) / 1.6 * 0.8);
  if (pole) return Color.white;
  if (flag) return new Color(1, 1, 1, 1);
  return Color.clear;
});

export const CoinSprite = () => CasualArt.make("cr-coin", 96, 96, (p) => {
  const c = CasualArt.ballPixel(p, Gold, 2 / 96, 0.92);
  if (c.a <= 0) return c;
  return mix(c, Pal.hex(0xc88a10), CasualArt.fill(Math.abs(p.magnitude - 0.6) - 0.06, 2 / 96) * 0.7);
});

export const PuffSprite = () => CasualArt.make("cr-puff", 64, 64, (p) => {
  const a = CasualArt.smooth(1, 0.35, p.magnitude);
  return new Color(1, 1, 1, a * 0.9);
});

/** Rounded button face (9-sliced): white, tinted per player. */
export const ButtonFace = () => CasualArt.make("cr-btn", 96, 96, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.94, 0.94), 0.55);
  const a = CasualArt.fill(d, 2 / 96);
  const shade = 1 - 0.2 * sm(0.2, -0.9, p.y);
  return new Color(shade, shade, shade, a);
}, 44, 100);
