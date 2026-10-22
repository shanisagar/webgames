import { CasualArt, Color, Mathf, Pal, Render, Sprite, V2 } from "../../kit";
import { Sim, Tile } from "./EmberRippleSim";

/**
 * EMBER & RIPPLE procedural art. Small sprites are CasualArt signed-distance recipes (cached by key); the level's
 * stone (back wall + solid blocks with moss) and the sliding stones are painted with canvas 2D into one texture each.
 */

const C = (hex: number, a = 1) => Pal.hex(hex).withAlpha(a);
const fill = CasualArt.fill, smooth = CasualArt.smooth;

export const Palette = {
  Ember: C(0xff7a1f), EmberDeep: C(0xd8261b), EmberHot: C(0xffd84a),
  Ripple: C(0x2fc6ff), RippleDeep: C(0x1d5fe0), RippleLight: C(0xb8f4ff),
  Goo: C(0x7ce03a), Lava: C(0xff7b1c), Water: C(0x34a9ff),
  Gold: C(0xffc93c), Ink: C(0x1b1420),
  StoneLight: C(0xb7a68a), Stone: C(0x8a7a63), StoneDark: C(0x5b4e40),
  Moss: C(0x6fae3f), MossDark: C(0x3f7a2a),
  /** Channel colours for buttons, levers and their stones (by trigger letter). */
  channel(letter: string) {
    const list = [0xb16cff, 0xffd23f, 0x3fe0b5, 0xff6fae, 0xf2f2f2, 0x5fa8ff, 0xff9a3c, 0x9cff5a];
    const i = Math.max(0, "acdfhijkmnpqstuvwxyz".indexOf(letter)) % list.length;
    return Pal.hex(list[i]);
  },
};

/** Registers a canvas as a texture + Sprite (kit gap: no public "sprite from canvas" helper). */
function canvasSprite(key: string, canvas: HTMLCanvasElement, ppu: number) {
  Render.addCanvasTexture(key, canvas);
  return new Sprite(key, canvas.width, canvas.height, ppu, [0, 0, 0, 0], canvas, 1);
}

/** Cheap deterministic hash noise in [0, 1). */
export function hash(x: number, y: number, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ heroes

/** Ember: a round fire spirit, hot yellow core to deep red rim. 128x128, body centre slightly low. */
export const EmberBody = () => CasualArt.make("er-ember-body", 128, 128, (p) => {
  const px = 2 / 128;
  const q = new V2(p.x, p.y + 0.12);
  const d = new V2(q.x / 0.78, q.y / (q.y > 0 ? 0.86 : 0.74)).magnitude - 1;
  const a = fill(d * 0.75, px);
  if (a <= 0) return Color.clear;
  let c = Color.lerp(Palette.EmberHot, Palette.Ember, smooth(-0.6, 0.35, -q.y + Math.abs(q.x) * 0.4));
  c = Color.lerp(c, Palette.EmberDeep, smooth(-0.25, 0.05, d) * 0.85);
  const hl = new V2((q.x + 0.32) / 0.22, (q.y - 0.38) / 0.14).magnitude;
  c = Color.lerp(c, C(0xfff4c4), smooth(1, 0.3, hl) * 0.55);
  return c.withAlpha(a);
});

/** Three flame tongues on Ember's head (white-hot base, tinted at runtime). frame 0..2. */
export const EmberFlame = (frame: number) => CasualArt.make("er-ember-flame-" + frame, 128, 128, (p) => {
  const px = 2 / 128;
  let d = 9;
  const sway = [0, 0.07, -0.06][frame];
  const tongues = [[-0.42, 0.45, 0.24], [0.02, 0.92, 0.3], [0.44, 0.55, 0.22]];
  for (let i = 0; i < 3; i++) {
    const [x, h, w] = tongues[i];
    const ph = frame * 1.7 + i * 2.1;
    const hh = h * (1 + 0.12 * Math.sin(ph));
    const tipX = x + sway * (i - 1 + 1.5) + 0.06 * Math.sin(ph * 1.3);
    // teardrop: circle at the base, tapering to the tip
    const t = Mathf.clamp01((p.y + 0.6) / (hh + 0.6));
    const cx = Mathf.lerp(x, tipX, t * t);
    const r = w * (1 - t) * (1 - t * 0.2) + 0.01;
    d = Math.min(d, Math.abs(p.x - cx) - r + Math.max(0, -0.6 - p.y) + Math.max(0, p.y - hh));
  }
  const a = fill(d, px * 1.4);
  if (a <= 0) return Color.clear;
  const core = smooth(0.25, -0.5, p.y);
  const c = Color.lerp(Palette.Ember, Palette.EmberHot, core);
  return Color.lerp(c, C(0xff3b1a), smooth(0.3, 0.9, p.y) * 0.7).withAlpha(a);
});

/** Ripple: a water drop with a pointed crest. 128x128. */
export const RippleBody = () => CasualArt.make("er-ripple-body", 128, 128, (p) => {
  const px = 2 / 128;
  const q = new V2(p.x, p.y + 0.18);
  // circle bottom + cone top (classic drop)
  const circ = q.magnitude - 0.7;
  const tip = new V2(0, 0.98);
  const cone = Math.max(CasualArt.sdSegment(q, new V2(0, 0.0), tip) - (0.7 * (1 - Mathf.clamp01(q.y / 0.98))), -1);
  const d = q.y > 0 ? Math.min(circ, cone + 0.02) : circ;
  const a = fill(d, px);
  if (a <= 0) return Color.clear;
  let c = Color.lerp(Palette.RippleLight, Palette.Ripple, smooth(0.9, -0.2, q.y - q.x * 0.3));
  c = Color.lerp(c, Palette.RippleDeep, smooth(-0.12, 0.02, d) * 0.8 + smooth(0.1, -0.7, q.y) * 0.25);
  const hl = new V2((q.x + 0.3) / 0.13, (q.y - 0.32) / 0.22).magnitude;
  c = Color.lerp(c, Color.white, smooth(1, 0.2, hl) * 0.75);
  const rim = new V2((q.x - 0.28) / 0.32, (q.y + 0.42) / 0.12).magnitude;
  c = Color.lerp(c, C(0xdffaff), smooth(1, 0.4, rim) * 0.35);
  return c.withAlpha(a);
});

/** Ripple's wave curl on the crest, tinted at runtime. frame 0..2 */
export const RippleCurl = (frame: number) => CasualArt.make("er-ripple-curl-" + frame, 96, 64, (p) => {
  const px = 2 / 96;
  const ph = frame * 2.1;
  const y0 = 0.05 * Math.sin(p.x * 5 + ph);
  const d = Math.abs(p.y - y0 - 0.12 * Math.sin(p.x * 3 + ph * 0.7)) - 0.09 * (1 - Math.abs(p.x) * 0.6);
  const a = fill(d, px) * smooth(1, 0.7, Math.abs(p.x));
  return new Color(1, 1, 1, a);
});

/** Eye white (oval) and pupil. */
export const EyeWhite = () => CasualArt.make("er-eye", 48, 64, (p) => {
  const d = new V2(p.x / 0.92, p.y / 1.25).magnitude - 1;
  return Color.white.withAlpha(fill(d, 2 / 48));
});
export const Pupil = () => CasualArt.make("er-pupil", 48, 48, (p) => {
  const d = p.magnitude - 0.9;
  let c = Color.lerp(C(0x2a1636), Palette.Ink, smooth(0.2, 0.9, p.magnitude));
  c = Color.lerp(c, Color.white, fill(CasualArt.sdCircle(p, new V2(-0.3, 0.32), 0.26), 2 / 48));
  return c.withAlpha(fill(d, 2 / 48));
});
export const Mouth = () => CasualArt.make("er-mouth", 64, 32, (p) => {
  const y = -0.12 + p.x * p.x * 0.45;
  const d = Math.abs(p.y - y) - 0.11;
  return Palette.Ink.withAlpha(fill(d, 2 / 64) * smooth(0.95, 0.8, Math.abs(p.x)));
});

// ------------------------------------------------------------------ pickups and mechanisms

export const GemSprite = (kind: number) => CasualArt.make("er-gem-" + kind, 96, 96, (p) => {
  const px = 2 / 96;
  const base = kind === 0 ? C(0xff3b4e) : C(0x2f8dff);
  const light = kind === 0 ? C(0xffb0b8) : C(0xb2e6ff);
  const dark = kind === 0 ? C(0x9e1030) : C(0x1638a8);
  // cut diamond: top crown (trapezoid) + pavilion (triangle)
  const q = new V2(p.x, p.y - 0.08);
  const crown = Math.max(Math.abs(q.x) - (0.82 - (q.y - 0.05) * 0.9), Math.max(q.y - 0.42, -q.y + 0.05));
  const pav = Math.max(Math.abs(q.x) * 0.95 + (0.05 - q.y) * 0.98 - 0.82, q.y - 0.06);
  const d = Math.min(crown, pav);
  const a = fill(d, px);
  if (a <= 0) return Color.clear;
  let c = base;
  if (q.y > 0.05) c = Math.abs(q.x) < 0.38 - (q.y - 0.05) * 0.4 ? light : Color.lerp(base, light, 0.35);
  else {
    const facet = q.x < -0.28 * (1 + q.y) ? 0 : q.x > 0.28 * (1 + q.y) ? 2 : 1;
    c = [Color.lerp(base, light, 0.2), base, dark][facet];
  }
  c = Color.lerp(c, Color.white, smooth(0.22, 0, new V2(q.x + 0.3, (q.y - 0.25) * 1.6).magnitude) * 0.8);
  c = Color.lerp(c, dark, smooth(-0.07, 0, d) * 0.7);
  return c.withAlpha(a);
});

export const BlockSprite = () => CasualArt.make("er-block", 96, 96, (p) => {
  const px = 2 / 96;
  const d = CasualArt.sdBox(p, new V2(0.98, 0.98), 0.12);
  const a = fill(d, px);
  if (a <= 0) return Color.clear;
  let c = Color.lerp(C(0x9a8a70), C(0x7b6c55), smooth(-0.8, 0.9, -p.y + p.x * 0.3));
  const n = hash(Math.floor((p.x + 1) * 9), Math.floor((p.y + 1) * 9), 3);
  c = Color.lerp(c, C(0x5f523f), n * 0.18);
  const inner = CasualArt.sdBox(p, new V2(0.62, 0.62), 0.08);
  c = Color.lerp(c, C(0x6b5d48), smooth(0.04, -0.02, Math.abs(inner)) * 0.7);
  // carved spiral glyph
  const r = p.magnitude, ang = Math.atan2(p.y, p.x);
  const spiral = Math.abs(Mathf.repeat(r * 3.2 - ang / (Math.PI * 2) + 10, 1) - 0.5) - 0.32;
  if (r < 0.45) c = Color.lerp(c, C(0x584a37), fill(-spiral * 0.3, px) * 0.8);
  c = Color.lerp(c, C(0xd8c8a8), smooth(-0.1, -0.02, d) * smooth(0.6, 0.98, p.y) * 0.7);
  c = Color.lerp(c, C(0x3e3326), smooth(-0.1, -0.02, d) * smooth(-0.6, -0.98, p.y) * 0.8);
  return c.withAlpha(a);
});

export const ButtonBase = () => CasualArt.make("er-btn-base", 96, 32, (p) => {
  const px = 2 / 96;
  const d = CasualArt.sdBox(p.add(new V2(0, 0.12)), new V2(0.98, 0.2), 0.12);
  const c = Color.lerp(C(0x5a4d3e), C(0x8a7a63), smooth(-0.3, 0.1, p.y));
  return c.withAlpha(fill(d, px));
});
/** Plate on top of the button (white: tinted by channel). */
export const ButtonPlate = () => CasualArt.make("er-btn-plate", 96, 32, (p) => {
  const px = 2 / 96;
  const d = CasualArt.sdBox(p, new V2(0.72, 0.18), 0.1);
  const c = Color.lerp(new Color(0.7, 0.7, 0.7), Color.white, smooth(-0.2, 0.15, p.y));
  return c.withAlpha(fill(d, px));
});

export const LeverBase = () => CasualArt.make("er-lever-base", 96, 48, (p) => {
  const px = 2 / 96;
  const d = Math.max(new V2(p.x / 0.7, (p.y + 0.5) / 0.55).magnitude - 1, -p.y - 0.5);
  let c = Color.lerp(C(0x5d503f), C(0x9c8b6e), smooth(-0.5, 0.0, p.y));
  c = Color.lerp(c, C(0x3b3127), smooth(0.2, 0.0, Math.abs(p.x)) * smooth(-0.1, -0.2, p.y) * 0.3);
  return c.withAlpha(fill(d, px));
});
/** Lever stick, pivot at the bottom centre of the sprite (sprite is 1 wide, 2 tall). */
export const LeverStick = () => CasualArt.make("er-lever-stick", 32, 64, (p) => {
  const px = 2 / 32;
  const stick = Math.max(Math.abs(p.x) - 0.16, Math.abs(p.y - 0.1) - 1.6);
  const knob = CasualArt.sdCircle(p, new V2(0, 1.45), 0.5);
  const d = Math.min(stick, knob);
  let c = stick < knob ? Color.lerp(C(0x6b5a44), C(0xb59e7c), smooth(-0.2, 0.2, -p.x)) : Color.lerp(new Color(0.75, 0.75, 0.75), Color.white, smooth(1.2, 1.7, p.y + p.x * 0.3));
  if (knob < stick) c = Color.lerp(c, Color.white, smooth(0.25, 0, new V2(p.x + 0.18, p.y - 1.6).magnitude) * 0.8);
  return c.withAlpha(fill(d, px));
});

export const VentSprite = () => CasualArt.make("er-vent", 64, 32, (p) => {
  const px = 2 / 64;
  const d = CasualArt.sdBox(p, new V2(0.96, 0.44), 0.1);
  if (d > 0.02) return Color.clear;
  let c = C(0x2b2630);
  const slat = Math.abs(Mathf.repeat(p.x * 3.5 + 0.5, 1) - 0.5);
  c = Color.lerp(c, C(0x9aa7b0), smooth(0.2, 0.08, slat));
  c = Color.lerp(C(0x6a6e78), c, fill(d + 0.1, px));
  return c.withAlpha(fill(d, px));
});

/** Liquid surface strip for one pool tile, 8 animation frames (wave period = 1 tile, so tiles join seamlessly). */
export const LiquidSprite = (t: Tile, frame: number) => CasualArt.make("er-liquid-" + t + "-" + frame, 64, 48, (p) => {
  const px = 2 / 64;
  const ph = (frame / 8) * Math.PI * 2;
  // p.y in [-0.75, 0.75]: surface near the top
  const surf = 0.48 + 0.07 * Math.sin(p.x * Math.PI + ph) + 0.03 * Math.sin(p.x * Math.PI * 2 - ph * 2);
  const a = fill(p.y - surf, px);
  if (a <= 0) return Color.clear;
  const depth = Mathf.clamp01((surf - p.y) / 1.2);
  let top: Color, mid: Color, deep: Color;
  if (t === Tile.Lava) { top = C(0xffe36b); mid = C(0xff7b1c); deep = C(0xc8230e); }
  else if (t === Tile.Water) { top = C(0xbff3ff); mid = C(0x38a8ff); deep = C(0x1a4fc4); }
  else { top = C(0xe5ff8a); mid = C(0x6fd636); deep = C(0x2c8a24); }
  let c = depth < 0.18 ? Color.lerp(top, mid, depth / 0.18) : Color.lerp(mid, deep, smooth(0.18, 1, depth));
  // shimmer streaks
  const streak = Math.sin(p.x * 9 + ph * 2 + p.y * 4) * Math.sin(p.y * 13 - ph);
  c = Color.lerp(c, top, smooth(0.75, 1, streak) * 0.35 * (1 - depth));
  if (t === Tile.Goo) c = Color.lerp(c, C(0xd8ff7a), fill(CasualArt.sdCircle(new V2(Mathf.repeat(p.x + frame * 0.07, 0.8) - 0.4, p.y + 0.1), V2.zero, 0.08), px) * 0.5);
  return c.withAlpha(a * (t === Tile.Water ? 0.86 : 0.97));
});

export const SoftGlow = () => CasualArt.Soft;
export const Spark = () => CasualArt.make("er-spark", 32, 32, (p) => {
  const d = Math.min(Math.abs(p.x) + Math.abs(p.y) * 3, Math.abs(p.y) + Math.abs(p.x) * 3);
  return new Color(1, 1, 1, smooth(1, 0.2, d) * smooth(1, 0.5, p.magnitude));
});
export const Bubble = () => CasualArt.make("er-bubble", 48, 48, (p) => {
  const r = p.magnitude;
  let a = smooth(0.95, 0.85, r) * (0.35 + 0.65 * smooth(0.6, 0.9, r));
  a = Math.max(a, smooth(0.25, 0.1, new V2(p.x + 0.35, p.y - 0.35).magnitude));
  return new Color(1, 1, 1, a);
});
export const Wisp = () => CasualArt.make("er-wisp", 32, 96, (p) => {
  const a = smooth(1, 0, Math.abs(p.x) / (0.4 * (1 - Math.abs(p.y) / 3.2))) * smooth(3, 1, Math.abs(p.y) + 0.0);
  return new Color(1, 1, 1, Mathf.clamp01(a) * 0.9);
});

/** Light shaft: a soft vertical beam, tinted and slanted at runtime. */
export const Shaft = () => CasualArt.make("er-shaft", 64, 256, (p) => {
  const w = smooth(1, 0.15, Math.abs(p.x));
  const v = smooth(-4, 1.5, p.y) * smooth(4, 2.6, p.y);
  return new Color(1, 1, 1, w * w * v * 0.9);
});

export const TorchBracket = () => CasualArt.make("er-torch", 48, 96, (p) => {
  const px = 2 / 48;
  const cup = CasualArt.sdBox(p.add(new V2(0, -0.55)), new V2(0.62, 0.28), 0.12);
  const stem = CasualArt.sdBox(p.add(new V2(0, 0.35)), new V2(0.16, 0.75), 0.06);
  const plate = CasualArt.sdBox(p.add(new V2(0, 0.95)), new V2(0.5, 0.42), 0.12);
  const d = Math.min(cup, Math.min(stem, plate));
  const c = Color.lerp(C(0x3a2c22), C(0x8a6a44), smooth(-0.5, 0.6, -p.x + p.y * 0.1));
  return c.withAlpha(fill(d, px));
});
export const TorchFlame = (frame: number) => CasualArt.make("er-torch-flame-" + frame, 64, 96, (p) => {
  const px = 2 / 64;
  const ph = frame * 1.9;
  const t = Mathf.clamp01((p.y + 1.2) / 2.6);
  const cx = 0.12 * Math.sin(ph + t * 4) * t;
  const r = 0.72 * Math.sqrt(1 - t) * (1 - t * 0.35) * (1 + 0.08 * Math.sin(ph * 2 + t * 9));
  const d = Math.abs(p.x - cx) - r + Math.max(0, -1.2 - p.y);
  const a = fill(d, px * 1.5);
  if (a <= 0) return Color.clear;
  const c = Color.lerp(C(0xfff2b0), C(0xff8a1c), smooth(0.05, 0.6, t + Math.abs(p.x - cx) * 0.5));
  return Color.lerp(c, C(0xff3b10), smooth(0.55, 0.95, t)).withAlpha(a);
});

/** Door frame: a carved arch (1.5 wide, 2.2 tall) with the owner's emblem on the keystone. */
export const DoorFrame = (kind: number) => CasualArt.make("er-door-" + kind, 96, 140, (p) => {
  const px = 2 / 96;
  const q = new V2(p.x, p.y + 1.458); // origin at the bottom of the sprite
  const outer = Math.max(Math.abs(q.x) - 0.98, q.y - 2.0) ;
  const archOuter = q.y > 1.98 ? new V2(q.x, (q.y - 1.98) * 1.2).magnitude - 0.98 : -1;
  const o = Math.max(Math.max(outer, archOuter), -q.y);
  const innerArch = q.y > 1.62 ? new V2(q.x / 0.66, (q.y - 1.62) / 0.66).magnitude - 1 : Math.abs(q.x) - 0.66;
  const inner = Math.max(innerArch, -q.y + 0.04);
  if (o > 0.02) return Color.clear;
  let c = Color.lerp(C(0x8d7d63), C(0xc3b08e), smooth(-0.9, 0.9, q.y * 0.5 - q.x * 0.4));
  const brick = Math.abs(Mathf.repeat(q.y * 3.2, 1) - 0.5);
  c = Color.lerp(c, C(0x6e604b), smooth(0.44, 0.5, brick) * 0.55);
  // emblem disc on the keystone
  const em = new V2(q.x, q.y - 2.3);
  const disc = em.magnitude - 0.3;
  const tint = kind === 0 ? C(0xff6a1a) : C(0x2fa8ff);
  c = Color.lerp(c, C(0x4b3f31), fill(disc - 0.05, px));
  c = Color.lerp(c, tint, fill(disc, px));
  // emblem symbol: flame or drop (white)
  let sym: number;
  if (kind === 0) {
    const t = Mathf.clamp01((em.y + 0.18) / 0.4);
    sym = Math.abs(em.x) - 0.14 * (1 - t) * (1 + t) + Math.max(0, -0.18 - em.y) + Math.max(0, em.y - 0.22);
  } else {
    const dd = new V2(em.x, em.y + 0.06).magnitude - 0.13;
    const cone = Math.abs(em.x) - 0.13 * (1 - Mathf.clamp01((em.y + 0.06) / 0.28)) + Math.max(0, em.y - 0.22);
    sym = em.y > -0.06 ? Math.min(dd, cone) : dd;
  }
  c = Color.lerp(c, Color.white, fill(sym, px) * 0.95);
  if (inner < 0) c = Color.clear; // the panel/interior is drawn separately
  c = Color.lerp(c, C(0x3d3226), smooth(0.06, 0, Math.abs(inner)) * 0.6 * (inner >= 0 ? 1 : 0));
  return c.withAlpha(fill(o, px) * (inner < 0 ? 0 : 1));
});
/** Door interior glow (white, tinted) and sliding panel. Both 1.32 x 2.0 with an arched top. */
export const DoorInside = () => CasualArt.make("er-door-in", 64, 100, (p) => {
  const q = new V2(p.x, p.y + 1.5625);
  const arch = q.y > 2.12 ? new V2(q.x, q.y - 2.12).magnitude - 1 : Math.abs(q.x) - 1;
  const g = smooth(0.4, 3.2, q.y);
  return new Color(1, 1, 1, fill(arch, 2 / 64) * (0.55 + 0.45 * (1 - g)));
});
export const DoorPanel = (kind: number) => CasualArt.make("er-door-panel-" + kind, 64, 100, (p) => {
  const px = 2 / 64;
  const q = new V2(p.x, p.y + 1.5625);
  const arch = q.y > 2.12 ? new V2(q.x, q.y - 2.12).magnitude - 1 : Math.abs(q.x) - 1;
  if (arch > 0.02) return Color.clear;
  const base = kind === 0 ? C(0x5a2216) : C(0x16305a);
  let c = Color.lerp(base, CasualArt.darken(base, 0.4), smooth(0, 3, q.y));
  const plank = Math.abs(Mathf.repeat(q.x * 2.5 + 0.5, 1) - 0.5);
  c = Color.lerp(c, CasualArt.darken(base, 0.5), smooth(0.42, 0.5, plank) * 0.8);
  const band = Math.min(Math.abs(q.y - 0.7), Math.abs(q.y - 1.8)) - 0.07;
  c = Color.lerp(c, C(0x8a7350), fill(band, px) * 0.9);
  const glyph = kind === 0 ? C(0xff8a3a) : C(0x5ac8ff);
  const ring = Math.abs(new V2(q.x, q.y - 1.25).magnitude - 0.36) - 0.07;
  c = Color.lerp(c, glyph, fill(ring, px) * 0.9);
  return c.withAlpha(fill(arch, px));
});

/** A small arrow marker over the controlled hero. */
export const Marker = () => CasualArt.make("er-marker", 48, 48, (p) => {
  const d = Math.max(Math.abs(p.x) * 1.1 + p.y * 0.9 - 0.6, -p.y - 0.55);
  return new Color(1, 1, 1, fill(d, 2 / 48));
});

// ------------------------------------------------------------------ level stone (canvas 2D)

const TILE_PX = 48;

function rgba(c: Color, a = c.a) { return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a.toFixed(3)})`; }

/**
 * Paints the level into two textures: the back wall (everything, with bricks, pillars and arches) and the solid
 * stone in front (bevels, cracks, moss on top edges, pool basins). Both are W x H tiles at TILE_PX per unit, with a
 * one-tile margin of solid stone around the map so the camera never shows an empty edge.
 */
export function bakeLevel(sim: Sim, key: string): { back: Sprite; solid: Sprite; margin: number } {
  const M = 1, W = sim.W + M * 2, H = sim.H + M * 2, T = TILE_PX;
  const solidAt = (cx: number, cy: number) => {
    if (cx < 0 || cy < 0 || cx >= sim.W || cy >= sim.H) return true;
    const t = sim.tile(cx, cy);
    return t !== Tile.Air;
  };
  const plainSolid = (cx: number, cy: number) => {
    if (cx < 0 || cy < 0 || cx >= sim.W || cy >= sim.H) return true;
    return sim.tile(cx, cy) === Tile.Wall;
  };
  // ---- back wall
  const back = document.createElement("canvas");
  back.width = W * T; back.height = H * T;
  const b = back.getContext("2d")!;
  const g = b.createLinearGradient(0, 0, 0, H * T);
  g.addColorStop(0, "#2b2333");
  g.addColorStop(1, "#1a1520");
  b.fillStyle = g;
  b.fillRect(0, 0, W * T, H * T);
  // bricks (running bond, 2 per tile horizontally, 2 rows per tile)
  const bh = T / 2, bw = T;
  for (let row = 0; row < H * 2; row++) {
    const off = (row % 2) * (bw / 2);
    for (let x = -bw; x < W * T + bw; x += bw) {
      const n = hash(Math.floor((x + off) / bw), row, 7);
      const shade = 0.82 + n * 0.22;
      b.fillStyle = `rgba(${Math.round(64 * shade)},${Math.round(54 * shade)},${Math.round(72 * shade)},1)`;
      b.fillRect(x + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
      if (n > 0.86) { b.fillStyle = "rgba(20,14,24,0.35)"; b.fillRect(x + off + bw * 0.3, row * bh + bh * 0.45, bw * 0.25, 2); }
    }
  }
  // soft vertical vignette + carved pillars every ~7 tiles
  for (let cx = 3; cx < W - 2; cx += 7 + Math.floor(hash(cx, 1, 3) * 3)) {
    const x = cx * T;
    const pg = b.createLinearGradient(x, 0, x + T, 0);
    pg.addColorStop(0, "rgba(0,0,0,0.25)");
    pg.addColorStop(0.3, "rgba(120,100,120,0.10)");
    pg.addColorStop(1, "rgba(0,0,0,0.28)");
    b.fillStyle = pg;
    b.fillRect(x, 0, T, H * T);
  }
  // dark arches near the floor of open areas
  b.fillStyle = "rgba(8,6,12,0.32)";
  for (let cy = 0; cy < sim.H; cy++)
    for (let cx = 1; cx < sim.W - 3; cx++) {
      if (hash(cx, cy, 11) > 0.07) continue;
      let ok = true;
      for (let k = 0; k < 3 && ok; k++) for (let h = 0; h < 3 && ok; h++) if (solidAt(cx + k, cy + h)) ok = false;
      if (!ok || !solidAt(cx + 1, cy - 1)) continue;
      const x = (cx + M) * T, yb = (H - (cy + M)) * T;
      b.beginPath();
      b.moveTo(x + T * 0.2, yb);
      b.lineTo(x + T * 0.2, yb - T * 1.6);
      b.arc(x + T * 1.5, yb - T * 1.6, T * 1.3, Math.PI, 0);
      b.lineTo(x + T * 2.8, yb);
      b.closePath();
      b.fill();
    }
  const vg = b.createRadialGradient(W * T / 2, H * T / 2, Math.min(W, H) * T * 0.2, W * T / 2, H * T / 2, Math.max(W, H) * T * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.35)");
  b.fillStyle = vg;
  b.fillRect(0, 0, W * T, H * T);

  // ---- solid stone
  const solid = document.createElement("canvas");
  solid.width = W * T; solid.height = H * T;
  const s = solid.getContext("2d")!;
  const stone = Palette.Stone, light = Palette.StoneLight, dark = Palette.StoneDark;
  for (let cy = -M; cy < sim.H + M; cy++)
    for (let cx = -M; cx < sim.W + M; cx++) {
      if (!solidAt(cx, cy)) continue;
      const x = (cx + M) * T, y = (H - (cy + M) - 1) * T;
      const t = cx >= 0 && cy >= 0 && cx < sim.W && cy < sim.H ? sim.tile(cx, cy) : Tile.Wall;
      const up = solidAt(cx, cy + 1), dn = solidAt(cx, cy - 1), lf = solidAt(cx - 1, cy), rt = solidAt(cx + 1, cy);
      const n = hash(cx, cy, 5);
      const base = Color.lerp(stone, dark, 0.15 + n * 0.25 + (up ? 0.18 : 0));
      s.fillStyle = rgba(base);
      s.fillRect(x, y, T, T);
      // brick seams (two half-height rows, offset)
      s.fillStyle = rgba(Color.lerp(dark, Palette.Ink, 0.4), 0.55);
      s.fillRect(x, y + T / 2 - 1, T, 2);
      const sx = (cy & 1) === 0 ? T / 2 : 0;
      s.fillRect(x + sx - 1, y, 2, T / 2);
      s.fillRect(x + ((sx + T / 2) % T) - 1, y + T / 2, 2, T / 2);
      // speckles
      for (let k = 0; k < 4; k++) {
        const h1 = hash(cx * 7 + k, cy * 13, 9), h2 = hash(cx * 3, cy * 5 + k, 4);
        s.fillStyle = h1 > 0.5 ? rgba(light, 0.18) : rgba(Palette.Ink, 0.18);
        s.fillRect(x + h1 * (T - 4), y + h2 * (T - 4), 3, 3);
      }
      // bevel on exposed edges
      if (!up) { s.fillStyle = rgba(light, 0.85); s.fillRect(x, y, T, 4); s.fillStyle = rgba(light, 0.35); s.fillRect(x, y + 4, T, 3); }
      if (!lf) { s.fillStyle = rgba(light, 0.4); s.fillRect(x, y, 3, T); }
      if (!rt) { s.fillStyle = rgba(Palette.Ink, 0.35); s.fillRect(x + T - 4, y, 4, T); }
      if (!dn) { s.fillStyle = rgba(Palette.Ink, 0.5); s.fillRect(x, y + T - 5, T, 5); }
      // pool basins: dark inset where the liquid sits
      if (t === Tile.Lava || t === Tile.Water || t === Tile.Goo) {
        s.fillStyle = "rgba(10,6,10,0.85)";
        s.fillRect(x, y, T, T * 0.55);
      }
      if (t === Tile.Fan) {
        s.fillStyle = "rgba(15,12,20,0.9)";
        s.fillRect(x + 3, y, T - 6, T * 0.45);
      }
      // moss on top edges of plain stone
      if (!up && plainSolid(cx, cy) && cy < sim.H - 1) {
        const mossy = hash(cx, cy, 21);
        if (mossy > 0.25) {
          s.fillStyle = rgba(Palette.MossDark);
          s.fillRect(x, y - 2, T, 6);
          s.fillStyle = rgba(Palette.Moss);
          for (let k = 0; k < 6; k++) {
            const hx = hash(cx * 11 + k, cy, 13) * T, hl = 3 + hash(cx, cy * 3 + k, 17) * (mossy > 0.7 ? 14 : 7);
            s.fillRect(x + hx, y + 2, 3, hl);
            s.beginPath();
            s.arc(x + hx + 1.5, y + 2 + hl, 2, 0, Math.PI * 2);
            s.fill();
          }
          s.fillRect(x, y - 3, T, 4);
          s.fillStyle = "rgba(190,240,120,0.55)";
          for (let k = 0; k < 4; k++) s.fillRect(x + hash(cx + k, cy, 31) * T, y - 4, 4, 2);
        }
      }
      // occasional crack
      if (n > 0.9 && up) {
        s.strokeStyle = rgba(Palette.Ink, 0.45);
        s.lineWidth = 1.5;
        s.beginPath();
        s.moveTo(x + T * 0.2, y + T * 0.25);
        s.lineTo(x + T * 0.45, y + T * 0.5);
        s.lineTo(x + T * 0.4, y + T * 0.8);
        s.stroke();
      }
    }
  return {
    back: canvasSprite(key + "-back", back, T),
    solid: canvasSprite(key + "-solid", solid, T),
    margin: M,
  };
}

/** A sliding stone of w x h tiles with an inlay in its channel colour. */
export function moverSprite(w: number, h: number, color: Color, loop: boolean): Sprite {
  const key = `er-mover-${w}x${h}-${color.rgbInt}-${loop ? 1 : 0}`;
  const cached = moverCache.get(key);
  if (cached) { Render.addCanvasTexture(key, cached.canvas!); return cached; }
  const T = TILE_PX, cv = document.createElement("canvas");
  cv.width = w * T; cv.height = h * T;
  const c = cv.getContext("2d")!;
  const r = 7;
  const path = () => {
    c.beginPath();
    c.moveTo(r, 0); c.lineTo(w * T - r, 0); c.quadraticCurveTo(w * T, 0, w * T, r);
    c.lineTo(w * T, h * T - r); c.quadraticCurveTo(w * T, h * T, w * T - r, h * T);
    c.lineTo(r, h * T); c.quadraticCurveTo(0, h * T, 0, h * T - r);
    c.lineTo(0, r); c.quadraticCurveTo(0, 0, r, 0); c.closePath();
  };
  const g = c.createLinearGradient(0, 0, 0, h * T);
  g.addColorStop(0, "#b8a989");
  g.addColorStop(1, "#7a6b55");
  path();
  c.fillStyle = g;
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = "rgba(40,30,25,0.7)";
  c.stroke();
  c.fillStyle = "rgba(255,245,220,0.45)";
  c.fillRect(4, 3, w * T - 8, 3);
  // seams between tiles
  c.fillStyle = "rgba(50,40,30,0.4)";
  for (let i = 1; i < w; i++) c.fillRect(i * T - 1, 6, 2, h * T - 12);
  for (let j = 1; j < h; j++) c.fillRect(6, j * T - 1, w * T - 12, 2);
  // channel inlay: a glowing stripe (horizontal for wide stones, vertical for tall ones)
  const col = `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`;
  c.fillStyle = "rgba(25,18,20,0.75)";
  if (w >= h) { c.fillRect(T * 0.25, h * T / 2 - 7, w * T - T * 0.5, 14); c.fillStyle = col; c.fillRect(T * 0.25 + 3, h * T / 2 - 4, w * T - T * 0.5 - 6, 8); }
  else { c.fillRect(w * T / 2 - 7, T * 0.25, 14, h * T - T * 0.5); c.fillStyle = col; c.fillRect(w * T / 2 - 4, T * 0.25 + 3, 8, h * T - T * 0.5 - 6); }
  if (loop) {
    c.fillStyle = "rgba(255,255,255,0.7)";
    for (const sx of [0.5, w - 0.5]) { c.beginPath(); c.arc(sx * T, h * T / 2, 4, 0, Math.PI * 2); c.fill(); }
  }
  const sp = canvasSprite(key, cv, T);
  moverCache.set(key, sp);
  return sp;
}
const moverCache = new Map<string, Sprite>();

export const TilePx = TILE_PX;
