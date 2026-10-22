import { CasualArt, Color, Mathf, Pal, Sprite, V2 } from "../../kit";

/**
 * Procedural art for DASH RUSH (no texture assets): the runner in parts (so it can be animated like a rig), track
 * obstacles, train faces, coins, power-up badges, the friendly security drone and scenery props. Everything is baked
 * once with CasualArt and cached.
 */

export const Ink = Pal.hex(0x1d1630);
export const Gold = Pal.hex(0xffc93c);
export const Coral = Pal.hex(0xff5a3c);
export const Sky = Pal.hex(0x3fa8ff);

const fill = CasualArt.fill;
const sdBox = CasualArt.sdBox;
const sdCircle = CasualArt.sdCircle;
const sdSeg = CasualArt.sdSegment;
const smooth = CasualArt.smooth;
const over = CasualArt.over;
const v = (x: number, y: number) => new V2(x, y);

/** Composites a filled shape with an ink outline of width `ow` (p units) over `dst`. */
function layer(dst: Color, d: number, col: Color, px: number, ow = 0, a = 1) {
  const cov = fill(d, px) * a;
  if (cov <= 0) return dst;
  const c = ow > 0 ? Color.lerp(Ink, col, fill(d + ow, px)) : col;
  return over(dst, c.withAlpha(c.a), cov);
}

const ellipse = (p: V2, c: V2, r: V2) => (Math.hypot((p.x - c.x) / r.x, (p.y - c.y) / r.y) - 1) * Math.min(r.x, r.y);

// ------------------------------------------------------------------ runners

export interface SkinDef {
  name: string; cost: number; tag: string;
  top: number; trim: number; pants: number; shoe: number; skin: number; hair: number; pack: number;
  style: "spiky" | "pony" | "cap" | "robot";
}

export const Skins: SkinDef[] = [
  { name: "DASH", cost: 0, tag: "The original rail-yard rusher", top: 0xff5a3c, trim: 0xffd23f, pants: 0x2f4b8a, shoe: 0xffffff, skin: 0xf2c29b, hair: 0x3a2618, pack: 0x2bb5a8, style: "spiky" },
  { name: "NOVA", cost: 750, tag: "Neon hoodie, pink ponytail", top: 0x8c5cff, trim: 0x55f2ff, pants: 0x26213d, shoe: 0x55f2ff, skin: 0xe8b48f, hair: 0xff6fb5, pack: 0xffc93c, style: "pony" },
  { name: "BOLT", cost: 2000, tag: "Backwards cap, zero brakes", top: 0xffc21a, trim: 0x2a2a35, pants: 0x3a3a46, shoe: 0xff4d4d, skin: 0x9c6644, hair: 0xe23b3b, pack: 0x3d7bff, style: "cap" },
  { name: "ROBO-K", cost: 4000, tag: "Chrome courier bot", top: 0xc9d3e0, trim: 0x55f2ff, pants: 0x5b6578, shoe: 0x2a2f45, skin: 0xaab6c8, hair: 0x8996ab, pack: 0xff7a1a, style: "robot" },
];

const H = (rgb: number) => Pal.hex(rgb);

/** Back of the head. 0.5 world units wide. */
export const Head = (s: number) => CasualArt.make("dr-head-" + s, 96, 104, (p) => {
  const k = Skins[s], px = 2 / 96;
  let c = Color.clear;
  const hair = H(k.hair), skin = H(k.skin);
  if (k.style === "robot") {
    c = layer(c, sdSeg(p, v(0.1, 0.6), v(0.25, 1.0)) - 0.04, H(0x5b6578), px, 0.03);
    c = layer(c, sdCircle(p, v(0.25, 1.0), 0.08), Pal.hex(0xff4d6a), px, 0.03);
    const d = sdCircle(p, v(0, 0.0), 0.86);
    const sh = CasualArt.ballPixel(p.mul(1 / 0.9), H(k.top), px, 0.95);
    c = layer(c, d, sh.withAlpha(1), px, 0.07);
    c = layer(c, sdBox(p.sub(v(0, -0.12)), v(0.7, 0.07), 0.07), H(k.trim), px);
    return c;
  }
  // ears
  c = layer(c, ellipse(p, v(-0.8, -0.1), v(0.16, 0.22)), skin, px, 0.06);
  c = layer(c, ellipse(p, v(0.8, -0.1), v(0.16, 0.22)), skin, px, 0.06);
  // neck
  c = layer(c, sdBox(p.sub(v(0, -0.78)), v(0.32, 0.25), 0.12), CasualArt.darken(skin, 0.12), px, 0.06);
  if (k.style === "cap") {
    c = layer(c, sdCircle(p, v(0, 0.02), 0.8), hair, px, 0.07);
    // cap worn backwards: brim faces us
    const brim = ellipse(p, v(0, -0.25), v(0.62, 0.2));
    c = layer(c, Math.max(brim, -(p.y + 0.25)), CasualArt.darken(hair, 0.25), px, 0.06);
    c = layer(c, sdBox(p.sub(v(0, 0.05)), v(0.2, 0.13), 0.06), H(k.skin), px, 0.05); // strap gap
    c = layer(c, sdBox(p.sub(v(0, 0.05)), v(0.26, 0.03), 0.02), CasualArt.darken(hair, 0.35), px);
    c = Color.lerp(c, CasualArt.lighten(c, 0.35), smooth(0.4, 0, Math.hypot(p.x + 0.3, p.y - 0.45)) * 0.5 * c.a);
    return c;
  }
  let d = sdCircle(p, v(0, 0.05), 0.8);
  if (k.style === "spiky") {
    for (let i = 0; i < 4; i++) {
      const a = 1.1 + i * 0.32, tip = v(Math.cos(a) * 1.0, Math.sin(a) * 0.98 + 0.05);
      d = Math.min(d, sdSeg(p, tip.mul(0.62), tip) - 0.1 * (1 - Math.min(1, Math.hypot(p.x - tip.x, p.y - tip.y) * 1.4)) - 0.02);
    }
  }
  if (k.style === "pony") {
    // ponytail hanging down the back, with a tie
    c = layer(c, ellipse(p, v(0.05, -0.62), v(0.24, 0.42)), hair, px, 0.06);
  }
  let hc = Color.lerp(CasualArt.lighten(hair, 0.18), CasualArt.darken(hair, 0.2), smooth(0.6, -0.8, p.y));
  const strands = Math.sin(p.x * 22 + p.y * 3);
  hc = Color.lerp(hc, CasualArt.darken(hair, 0.3), smooth(0.7, 1, strands) * 0.35);
  c = layer(c, d, hc, px, 0.07);
  c = Color.lerp(c, CasualArt.lighten(c, 0.4), smooth(0.35, 0, Math.hypot(p.x + 0.28, p.y - 0.45)) * 0.45 * c.a);
  if (k.style === "pony") c = layer(c, sdBox(p.sub(v(0.03, -0.28)), v(0.2, 0.06), 0.05), H(k.trim), px, 0.04);
  return c;
});

/** Hoodie back. 0.74 world units wide. */
export const Torso = (s: number) => CasualArt.make("dr-torso-" + s, 144, 140, (p) => {
  const k = Skins[s], px = 2 / 144;
  const top = H(k.top), trim = H(k.trim);
  let c = Color.clear;
  const w = 0.74 + 0.16 * smooth(-0.8, 0.6, p.y);
  const d = sdBox(v(p.x * (0.9 / w), p.y + 0.02), v(0.9, 0.9), 0.32);
  let body = Color.lerp(CasualArt.lighten(top, 0.12), CasualArt.darken(top, 0.22), smooth(-0.2, 0.9, Math.abs(p.x + 0.12)));
  if (k.style === "robot") {
    const panel = Math.abs(sdBox(p.sub(v(0, 0.05)), v(0.5, 0.55), 0.15)) - 0.02;
    body = Color.lerp(body, CasualArt.darken(top, 0.35), fill(panel, px));
  }
  c = layer(c, d, body, px, 0.07);
  // waistband
  c = layer(c, Math.max(d, p.y + 0.66), trim, px, 0.0);
  c = layer(c, Math.max(d + 0.06, Math.abs(p.y + 0.66) - 0.012), Ink.withAlpha(0.6), px);
  // hood resting on the back
  c = layer(c, ellipse(p, v(0, 0.55), v(0.46, 0.34)), CasualArt.darken(top, 0.14), px, 0.06);
  c = layer(c, ellipse(p, v(0, 0.66), v(0.3, 0.17)), CasualArt.darken(top, 0.38), px, 0.04);
  // logo stripe
  c = layer(c, Math.max(d + 0.1, Math.abs(p.x + p.y * 0.35 - 0.05) - 0.06), CasualArt.lighten(trim, 0.1), px, 0, 0.9);
  return c;
});

/** Backpack. 0.48 world units wide. */
export const Pack = (s: number) => CasualArt.make("dr-pack-" + s, 96, 88, (p) => {
  const k = Skins[s], px = 2 / 96, col = H(k.pack);
  let c = Color.clear;
  const d = sdBox(p, v(0.85, 0.82), 0.32);
  c = layer(c, d, Color.lerp(CasualArt.lighten(col, 0.15), CasualArt.darken(col, 0.2), smooth(-0.6, 0.8, -p.y + Math.abs(p.x) * 0.5)), px, 0.09);
  c = layer(c, Math.max(d, -(p.y - 0.25)), CasualArt.darken(col, 0.18), px);
  c = layer(c, Math.abs(p.y - 0.25) - 0.03 + 0 * d, Ink.withAlpha(0.7), px, 0, d < 0 ? 1 : 0);
  c = layer(c, sdBox(p.sub(v(0, -0.32)), v(0.45, 0.28), 0.12), CasualArt.lighten(col, 0.12), px, 0.06);
  c = layer(c, sdCircle(p, v(0, 0.12), 0.07), H(k.trim), px, 0.04);
  return c;
});

/** Sleeve + hand, hanging down from the shoulder. 0.2 x 0.6 world units. */
export const Arm = (s: number) => CasualArt.make("dr-arm-" + s, 40, 120, (p) => {
  const k = Skins[s], px = 2 / 40;
  let c = Color.clear;
  const sleeve = sdSeg(p, v(0, 2.3), v(0, -1.6)) - 0.72;
  c = layer(c, sleeve, Color.lerp(CasualArt.lighten(H(k.top), 0.08), CasualArt.darken(H(k.top), 0.25), smooth(-0.4, 0.8, p.x)), px, 0.22);
  c = layer(c, Math.max(sleeve, Math.abs(p.y + 1.7) - 0.18), H(k.trim), px);
  c = layer(c, sdCircle(p, v(0, -2.35), 0.72), H(k.skin), px, 0.22);
  return c;
});

/** Thigh. 0.24 x 0.42 world units. */
export const Thigh = (s: number) => CasualArt.make("dr-thigh-" + s, 48, 84, (p) => {
  const k = Skins[s], px = 2 / 48;
  const d = sdSeg(p, v(0, 1.3), v(0, -1.3)) - 0.78;
  return layer(Color.clear, d, Color.lerp(CasualArt.lighten(H(k.pants), 0.1), CasualArt.darken(H(k.pants), 0.25), smooth(-0.5, 0.9, p.x)), px, 0.18);
});

/** Lower leg with the shoe seen from behind (heel) or lifted (sole). 0.26 x 0.52 world units. */
export const Shin = (s: number, sole: boolean) => CasualArt.make("dr-shin-" + s + (sole ? "s" : "h"), 52, 104, (p) => {
  const k = Skins[s], px = 2 / 52;
  let c = Color.clear;
  const pants = H(k.pants), shoe = H(k.shoe);
  c = layer(c, sdSeg(p, v(0, 1.6), v(0, -0.4)) - 0.62, Color.lerp(pants, CasualArt.darken(pants, 0.25), smooth(-0.4, 0.9, p.x)), px, 0.17);
  if (!sole) {
    const d = sdBox(p.sub(v(0, -1.38)), v(0.78, 0.55), 0.4);
    c = layer(c, d, Color.lerp(shoe, CasualArt.darken(shoe, 0.18), smooth(-0.6, 0.6, p.y + 1.38)), px, 0.17);
    c = layer(c, Math.max(d, -(p.y + 1.66)), H(0xe9eef7), px);
    c = layer(c, sdBox(p.sub(v(0, -1.18)), v(0.32, 0.16), 0.1), H(k.top), px, 0.1);
  } else {
    const d = ellipse(p, v(0, -1.2), v(0.82, 0.72));
    c = layer(c, d, H(0xe9eef7), px, 0.17);
    const tread = Math.sin(p.y * 18);
    c = layer(c, Math.max(d + 0.18, -tread * 0.08), H(0xb9c2d4), px);
    c = layer(c, ellipse(p, v(0, -0.68), v(0.75, 0.22)), shoe, px, 0.12);
  }
  return c;
});

/** The runner curled into a ball for rolls. 1 world unit. */
export const RollBall = (s: number) => CasualArt.make("dr-roll-" + s, 112, 112, (p) => {
  const k = Skins[s], px = 2 / 112;
  let c = CasualArt.ballPixel(p, H(k.top), px, 0.9);
  if (c.a <= 0) return c;
  const band = Math.abs(p.x * 0.8 + p.y * 0.6) - 0.16;
  c = Color.lerp(c, H(k.trim), fill(band, px) * 0.95);
  c = layer(c, ellipse(p, v(-0.25, 0.32), v(0.32, 0.26)), H(k.pack), px, 0.06);
  c = layer(c, ellipse(p, v(0.35, -0.35), v(0.22, 0.18)), H(k.hair), px, 0.06);
  c = Color.lerp(Ink, c, fill(Math.hypot(p.x, p.y) - 0.84, px));
  return c.withAlpha(fill(Math.hypot(p.x, p.y) - 0.9, px));
});

// ------------------------------------------------------------------ pickups

export const Shadow = () => CasualArt.make("dr-shadow", 96, 48, (p) => new Color(0.1, 0.06, 0.14, 0.42 * smooth(1, 0.35, Math.hypot(p.x, p.y * 2))));

export const CoinSprite = () => CasualArt.make("dr-coin", 72, 72, (p) => {
  const px = 2 / 72, r = Math.hypot(p.x, p.y);
  let c = Color.clear;
  c = layer(c, r - 0.92, Pal.hex(0xd9881a), px, 0.07);
  c = layer(c, r - 0.74, Color.lerp(Pal.hex(0xffe066), Pal.hex(0xffa81e), smooth(0.7, -0.7, p.y - p.x * 0.3)), px);
  // lightning emblem
  const bolt = Math.min(sdSeg(p, v(0.18, 0.5), v(-0.16, 0.0)), Math.min(sdSeg(p, v(-0.16, 0.0), v(0.16, 0.0)), sdSeg(p, v(0.16, 0.0), v(-0.18, -0.5)))) - 0.09;
  c = layer(c, bolt, Pal.hex(0xc56f12), px);
  c = layer(c, bolt + 0.035, Pal.hex(0xfff2b0), px);
  c = Color.lerp(c, Color.white, smooth(0.3, 0, Math.hypot(p.x + 0.35, p.y - 0.42)) * 0.8 * c.a);
  return c;
});

const glyph2 = (p: V2) => {
  // "2"
  let d = 9;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI * (1.05 - (i / n) * 1.25), a1 = Math.PI * (1.05 - ((i + 1) / n) * 1.25);
    d = Math.min(d, sdSeg(p, v(Math.cos(a0) * 0.28, Math.sin(a0) * 0.26 + 0.2), v(Math.cos(a1) * 0.28, Math.sin(a1) * 0.26 + 0.2)));
  }
  d = Math.min(d, sdSeg(p, v(0.21, 0.03), v(-0.28, -0.42)));
  d = Math.min(d, sdSeg(p, v(-0.28, -0.42), v(0.3, -0.42)));
  return d;
};

export const PowerColors = [Pal.hex(0xff4d6a), Pal.hex(0xffb320), Pal.hex(0x3dd6ff), Pal.hex(0x5cf08e)];
export const PowerNames = ["MAGNET", "2X SCORE", "SKY BOOST", "SHIELD"];

/** Round badge with an icon: 0 magnet, 1 double score, 2 sky boost (jetpack), 3 shield. */
export const PowerIcon = (kind: number) => CasualArt.make("dr-power-" + kind, 112, 112, (p) => {
  const px = 2 / 112, r = Math.hypot(p.x, p.y), base = PowerColors[kind];
  let c = Color.clear;
  c = layer(c, r - 0.94, Color.white, px, 0.08);
  c = layer(c, r - 0.8, Color.lerp(CasualArt.lighten(base, 0.25), CasualArt.darken(base, 0.25), smooth(0.8, -0.8, p.y)), px);
  const q = p.mul(1.15);
  if (kind === 0) {
    const ring = Math.abs(Math.hypot(q.x, q.y - 0.02) - 0.36) - 0.13;
    const u = Math.max(ring, q.y - 0.05);
    const legs = Math.min(sdBox(q.sub(v(-0.36, 0.2)), v(0.13, 0.2), 0.02), sdBox(q.sub(v(0.36, 0.2)), v(0.13, 0.2), 0.02));
    c = layer(c, Math.min(u, legs) * 0.87, Pal.hex(0xe8304a), px, 0.05);
    c = layer(c, Math.min(sdBox(q.sub(v(-0.36, 0.37)), v(0.13, 0.07), 0.02), sdBox(q.sub(v(0.36, 0.37)), v(0.13, 0.07), 0.02)) * 0.87, Pal.hex(0xeef2fa), px, 0.05);
  } else if (kind === 1) {
    const two = glyph2(q.sub(v(-0.2, 0))) - 0.1;
    const x = Math.min(sdSeg(q, v(0.15, 0.12), v(0.5, -0.4)), sdSeg(q, v(0.5, 0.12), v(0.15, -0.4))) - 0.08;
    c = layer(c, two * 0.87, Color.white, px, 0.05);
    c = layer(c, x * 0.87, Color.white, px, 0.05);
  } else if (kind === 2) {
    // jetpack: two canisters with flames
    for (const sx of [-0.2, 0.2]) {
      const fl = ellipse(q, v(sx, -0.42), v(0.11, 0.2));
      c = layer(c, fl * 0.87, Pal.hex(0xffd23f), px, 0.0);
      c = layer(c, ellipse(q, v(sx, -0.38), v(0.06, 0.11)) * 0.87, Color.white, px);
      const can = sdBox(q.sub(v(sx, 0.08)), v(0.15, 0.36), 0.14);
      c = layer(c, can * 0.87, Color.lerp(Pal.hex(0xff7a1a), Pal.hex(0xc84a10), smooth(-0.2, 0.2, q.x - sx)), px, 0.05);
      c = layer(c, sdBox(q.sub(v(sx, 0.28)), v(0.15, 0.04), 0.02) * 0.87, Color.white, px);
    }
  } else {
    const top = sdBox(q.sub(v(0, 0.16)), v(0.36, 0.26), 0.1);
    const vee = Math.max(Math.abs(q.x) - 0.36, Math.abs(q.x) * 0.8 - q.y * 0.6 - 0.29);
    const shield = Math.min(top, Math.max(vee, q.y - 0.2));
    c = layer(c, shield * 0.87, Color.white, px, 0.05);
    c = layer(c, Math.max(Math.abs(q.x) - 0.07, shield + 0.1) * 0.87, Pal.hex(0x2fbf69), px);
  }
  c = Color.lerp(c, Color.white, smooth(0.32, 0, Math.hypot(p.x + 0.38, p.y - 0.45)) * 0.55 * c.a);
  return c;
});

// ------------------------------------------------------------------ obstacles

/** Low hurdle (jump it). 2.2 x 1.1 world units. */
export const Barrier = () => CasualArt.make("dr-barrier", 256, 128, (p) => {
  const px = 2 / 256;
  let c = Color.clear;
  for (const sx of [-0.78, 0.78]) {
    c = layer(c, sdBox(p.sub(v(sx, -0.12)), v(0.05, 0.36), 0.02), Pal.hex(0x6b7488), px, 0.025);
    c = layer(c, sdBox(p.sub(v(sx, -0.47)), v(0.14, 0.03), 0.02), Pal.hex(0x4a5266), px, 0.02);
  }
  const board = sdBox(p.sub(v(0, 0.12)), v(0.95, 0.2), 0.06);
  const stripe = Mathf.repeat(p.x * 3.2 - p.y * 3.2, 1) < 0.5;
  c = layer(c, board, stripe ? Pal.hex(0xf23b3b) : Pal.hex(0xfaf6ef), px, 0.03);
  c = Color.lerp(c, CasualArt.lighten(c, 0.3), smooth(0.05, 0.3, p.y) * 0.3 * (board < 0 ? 1 : 0));
  for (const sx of [-0.78, 0.78]) {
    c = layer(c, sdCircle(p, v(sx, 0.41), 0.07), Pal.hex(0xffb31a), px, 0.025);
    c = Color.lerp(c, Color.white, fill(sdCircle(p, v(sx - 0.02, 0.43), 0.025), px) * 0.9);
  }
  return c;
});

/** High bar on posts (roll under it). 2.2 x 2.6 world units; the sign spans 1.3..2.5 up. */
export const HighBar = () => CasualArt.make("dr-bar", 220, 260, (p) => {
  const px = 2 / 220;
  let c = Color.clear;
  // y range [-1.18, 1.18] ↔ height 0..2.6
  for (const sx of [-0.9, 0.9]) c = layer(c, sdBox(p.sub(v(sx, -0.1)), v(0.045, 1.06), 0.02), Pal.hex(0x5d6680), px, 0.025);
  const sign = sdBox(p.sub(v(0, 0.62)), v(0.95, 0.48), 0.08);
  const stripe = Mathf.repeat(p.x * 2.6 + p.y * 2.6, 1) < 0.5;
  let col = stripe ? Pal.hex(0xffc21a) : Pal.hex(0x2a2638);
  const inner = sdBox(p.sub(v(0, 0.62)), v(0.7, 0.3), 0.12);
  if (inner < 0) col = Pal.hex(0xfaf6ef);
  c = layer(c, sign, col, px, 0.03);
  // duck arrow (down)
  const arrow = Math.min(sdBox(p.sub(v(0, 0.72)), v(0.07, 0.14), 0.02), (Math.abs(p.x) * 0.9 + (p.y - 0.6) * 0.9 - 0.0) * (p.y < 0.6 && p.y > 0.4 ? 1 : 9));
  c = layer(c, Math.max(arrow, -(p.y - 0.38)), Pal.hex(0xf23b3b), px, 0.02);
  for (const sx of [-0.9, 0.9]) c = layer(c, sdCircle(p, v(sx, 1.12), 0.06), Pal.hex(0xff4d4d), px, 0.02);
  return c;
});

/** Tall barricade (change lanes). 2.2 x 2.35 world units. */
export const Blocker = () => CasualArt.make("dr-block", 220, 236, (p) => {
  const px = 2 / 220;
  let c = Color.clear;
  // y range [-1.07, 1.07]
  const frame = sdBox(p.sub(v(0, -0.02)), v(0.96, 1.0), 0.1);
  c = layer(c, frame, Pal.hex(0x3b4256), px, 0.03);
  for (let i = 0; i < 3; i++) {
    const y = 0.6 - i * 0.62;
    const board = sdBox(p.sub(v(0, y)), v(0.86, 0.22), 0.06);
    const chev = Mathf.repeat((p.x > 0 ? -p.x : p.x) * 2.2 + p.y * 1.4 + (p.x > 0 ? 0.5 : 0), 1) < 0.5;
    c = layer(c, board, chev ? Pal.hex(0xff6a1a) : Pal.hex(0xfaf6ef), px, 0.025);
  }
  c = layer(c, sdCircle(p, v(0, 0.98), 0.1), Pal.hex(0xff3b3b), px, 0.03);
  c = Color.lerp(c, Color.white, fill(sdCircle(p, v(-0.03, 1.01), 0.035), px) * 0.9);
  return c;
});

export const Liveries: { body: number; stripe: number; roof: number; dark: number }[] = [
  { body: 0xe8433f, stripe: 0xfaf3e6, roof: 0xd8dce6, dark: 0x8e2420 },
  { body: 0x2e7bff, stripe: 0xffd23f, roof: 0xd5dbe8, dark: 0x1a3f8a },
  { body: 0x2fb36b, stripe: 0xfaf3e6, roof: 0xd8e2dc, dark: 0x1b6a3e },
  { body: 0xff8a1e, stripe: 0x23233a, roof: 0x3a3a52, dark: 0x9a4a0a },
];

/** Locomotive face. 2.1 x 3.3 world units. */
export const TrainFront = (livery: number) => CasualArt.make("dr-train-" + livery, 160, 252, (p) => {
  const px = 2 / 160, L = Liveries[livery];
  const body = H(L.body), stripe = H(L.stripe), dark = H(L.dark);
  let c = Color.clear;
  // y range [-1.575, 1.575]
  const shell = sdBox(p.sub(v(0, 0.05)), v(0.97, 1.5), 0.32);
  c = layer(c, shell, Color.lerp(CasualArt.lighten(body, 0.12), CasualArt.darken(body, 0.15), smooth(-0.5, 1, Math.abs(p.x))), px, 0.035);
  // skirt + bogie
  c = layer(c, Math.max(shell, p.y + 1.2), H(0x2b2d3b), px);
  c = layer(c, sdBox(p.sub(v(0, -1.5)), v(0.7, 0.08), 0.03), H(0x1b1c26), px);
  // stripe band
  c = layer(c, Math.max(shell + 0.02, Math.abs(p.y + 0.18) - 0.09), stripe, px);
  // windshield
  const glass = sdBox(p.sub(v(0, 0.72)), v(0.8, 0.42), 0.18);
  let g = Color.lerp(H(0x2a4a7a), H(0x0f1a33), smooth(1.1, 0.3, p.y));
  const refl = Math.abs((p.x * 0.8 + p.y) - 0.95) - 0.1;
  g = Color.lerp(g, H(0x9fd2ff), fill(refl, px) * 0.45);
  c = layer(c, glass, g, px, 0.03);
  // destination board
  c = layer(c, sdBox(p.sub(v(0, 1.3)), v(0.5, 0.08), 0.03), H(0x15151f), px, 0.015);
  for (let i = 0; i < 7; i++) c = layer(c, sdCircle(p, v(-0.36 + i * 0.12, 1.3), 0.03), H(0xffa62a), px);
  // headlights
  for (const sx of [-0.62, 0.62]) {
    c = layer(c, sdCircle(p, v(sx, -0.6), 0.16), H(0x3a3d4d), px, 0.02);
    c = layer(c, sdCircle(p, v(sx, -0.6), 0.11), H(0xfff3c4), px);
    c = Color.lerp(c, Color.white, fill(sdCircle(p, v(sx - 0.03, -0.57), 0.045), px));
  }
  // emblem + coupler
  c = layer(c, sdBox(p.sub(v(0, -0.62)), v(0.22, 0.14), 0.06), dark, px, 0.02);
  c = layer(c, sdBox(p.sub(v(0, -0.62)), v(0.08, 0.05), 0.02), stripe, px);
  c = layer(c, sdBox(p.sub(v(0, -1.06)), v(0.2, 0.1), 0.03), H(0x4a4d5e), px, 0.02);
  // wipers
  c = layer(c, sdSeg(p, v(-0.55, 0.36), v(-0.2, 0.62)) - 0.018, H(0x15151f), px);
  c = layer(c, sdSeg(p, v(0.25, 0.36), v(0.6, 0.62)) - 0.018, H(0x15151f), px);
  return c;
});

// ------------------------------------------------------------------ the chaser

/** Friendly security drone. 1.2 x 1.05 world units. */
export const Drone = () => CasualArt.make("dr-drone", 128, 112, (p) => {
  const px = 2 / 128;
  let c = Color.clear;
  // arms to the rotors
  c = layer(c, sdSeg(p, v(-0.35, 0.2), v(-0.82, 0.48)) - 0.05, H(0x5b6578), px, 0.03);
  c = layer(c, sdSeg(p, v(0.35, 0.2), v(0.82, 0.48)) - 0.05, H(0x5b6578), px, 0.03);
  for (const sx of [-0.82, 0.82]) c = layer(c, sdBox(p.sub(v(sx, 0.52)), v(0.1, 0.06), 0.03), H(0x3a4256), px, 0.03);
  // body
  const body = sdCircle(p, v(0, -0.05), 0.6);
  const shade = CasualArt.ballPixel(p.sub(v(0, -0.05)).mul(1 / 0.62), H(0xeef2fa), px, 0.97);
  c = layer(c, body, shade.withAlpha(1), px, 0.05);
  c = layer(c, Math.max(body, -(p.y + 0.3)), H(0x3dd6ff), px);
  // visor + eye
  c = layer(c, ellipse(p, v(0, 0.02), v(0.42, 0.28)), H(0x1d2440), px, 0.03);
  c = layer(c, sdCircle(p, v(0, 0.02), 0.17), H(0x55f2ff), px);
  c = layer(c, sdCircle(p, v(0.02, 0.0), 0.08), H(0x0d1a33), px);
  c = Color.lerp(c, Color.white, fill(sdCircle(p, v(-0.06, 0.09), 0.045), px));
  // siren cap
  c = layer(c, sdBox(p.sub(v(0, 0.62)), v(0.16, 0.08), 0.05), H(0x3a4256), px, 0.03);
  return c;
});

export const Rotor = () => CasualArt.make("dr-rotor", 96, 24, (p) => {
  const d = ellipse(p, v(0, 0), v(0.95, 0.18));
  return new Color(0.85, 0.9, 1, 0.55 * fill(d, 2 / 96) * (0.6 + 0.4 * smooth(0.95, 0.2, Math.abs(p.x))));
});

// ------------------------------------------------------------------ scenery

/** Lamp post with its arm reaching left (flipX for the other side). 1.6 x 6.4 world units. */
export const Lamp = () => CasualArt.make("dr-lamp", 48, 192, (p) => {
  const px = 2 / 48;
  let c = Color.clear;
  // y range [-4, 4]
  c = layer(c, sdBox(p.sub(v(0.72, -0.2)), v(0.07, 3.75), 0.04), H(0x44506a), px, 0.05);
  c = layer(c, sdBox(p.sub(v(0.72, -3.85)), v(0.18, 0.12), 0.05), H(0x34405a), px, 0.05);
  c = layer(c, sdSeg(p, v(0.72, 3.5), v(-0.5, 3.75)) - 0.06, H(0x44506a), px, 0.05);
  c = layer(c, sdBox(p.sub(v(-0.62, 3.6)), v(0.3, 0.1), 0.06), H(0x2c3448), px, 0.05);
  c = layer(c, sdBox(p.sub(v(-0.62, 3.5)), v(0.22, 0.04), 0.03), H(0xfff2c4), px);
  return c;
});

/** Overhead signal gantry spanning the three tracks. 10 x 7.4 world units. */
export const Gantry = () => CasualArt.make("dr-gantry", 300, 222, (p) => {
  const px = 2 / 300;
  let c = Color.clear;
  // y range [-0.74, 0.74] ↔ 0..7.4 high; x ±1 ↔ ±5
  const steel = H(0x56627e), dark = H(0x3a4560);
  for (const sx of [-0.93, 0.93]) {
    const post = sdBox(p.sub(v(sx, -0.02)), v(0.04, 0.72), 0.01);
    c = layer(c, post, steel, px, 0.008);
    const lattice = Math.abs(Mathf.repeat((p.y + 1) * 9 + (p.x - sx) * 9 * (Mathf.repeat((p.y + 1) * 4.5, 1) < 0.5 ? 1 : -1), 1) - 0.5) - 0.12;
    c = layer(c, Math.max(post + 0.012, lattice * 0.05), dark, px);
  }
  const beam = sdBox(p.sub(v(0, 0.6)), v(0.97, 0.07), 0.01);
  c = layer(c, beam, steel, px, 0.008);
  const latt = Math.abs(Mathf.repeat(p.x * 14 + (p.y - 0.6) * 14 * (Mathf.repeat(p.x * 7, 1) < 0.5 ? 1 : -1), 1) - 0.5) - 0.12;
  c = layer(c, Math.max(beam + 0.012, latt * 0.05), dark, px);
  // signal heads above each track
  for (let i = -1; i <= 1; i++) {
    const x = i * 0.48;
    c = layer(c, sdBox(p.sub(v(x, 0.44)), v(0.045, 0.1), 0.03), H(0x1d2030), px, 0.008);
    c = layer(c, sdCircle(p, v(x, 0.48), 0.025), H(0x5cff8a), px);
    c = layer(c, sdCircle(p, v(x, 0.4), 0.025), H(0x3a1b1b), px);
  }
  return c;
});

/** Far skyline silhouette (white; tinted with haze). 4:1. */
export const Skyline = (seed: number) => CasualArt.make("dr-skyline-" + seed, 512, 128, (p) => {
  const px = 2 / 512;
  // p.y in [-0.25, 0.25]
  const n = 26, x = (p.x + 1) * 0.5 * n, i = Math.floor(x);
  const h = (k: number) => { const s = Math.sin((k + seed * 13.1) * 12.9898) * 43758.5453; return s - Math.floor(s); };
  let top = -0.2 + 0.08 + h(i) * 0.3 * (0.5 + 0.5 * Math.sin(i * 0.7 + seed));
  if (h(i + 50) > 0.85) top += 0.06 * smooth(0.5, 0, Math.abs(x - i - 0.5)); // spire
  const inside = p.y < top ? 1 : 0;
  const edge = fill(p.y - top, px) * smooth(0, 0.06, x - i) * smooth(0, 0.06, i + 1 - x) + (Math.abs(x - i - 0.5) < 0.45 ? 0 : 0);
  let a = Math.max(inside * (Math.abs(x - i - 0.5) < 0.47 ? 1 : 0.85), edge);
  a = Math.min(1, a);
  // lit windows
  const wx = Mathf.repeat(x * 5, 1), wy = Mathf.repeat(p.y * 60, 1);
  const lit = h(Math.floor(x * 5) + Math.floor(p.y * 60) * 7) > 0.8 && wx > 0.3 && wx < 0.7 && wy > 0.35 && wy < 0.75 && p.y < top - 0.02;
  return lit ? new Color(1, 0.92, 0.75, a) : new Color(0.82, 0.86, 0.94, a);
});

export const Cloud = () => CasualArt.make("dr-cloud", 160, 64, (p) => {
  let d = Math.min(sdCircle(p, v(-0.42, -0.06), 0.26), Math.min(sdCircle(p, v(0.0, 0.06), 0.34), sdCircle(p, v(0.42, -0.04), 0.24)));
  d = Math.min(d, sdBox(p.sub(v(0, -0.18)), v(0.7, 0.1), 0.1));
  const shade = Color.lerp(new Color(1, 1, 1, 1), new Color(0.93, 0.9, 0.96, 1), smooth(0.2, -0.25, p.y));
  return shade.withAlpha(fill(d, 2 / 160) * 0.95);
});

export const SpeedLine = () => CasualArt.make("dr-speedline", 128, 16, (p) => new Color(1, 1, 1, smooth(1, 0.1, Math.abs(p.x)) * smooth(0.125, 0, Math.abs(p.y))));

/** Hex badge for the HUD multiplier. */
export const Badge = () => CasualArt.make("dr-badge", 96, 96, (p) => {
  const px = 2 / 96;
  const d = sdBox(p, v(0.9, 0.9), 0.35);
  return layer(Color.clear, d, Color.lerp(Pal.hex(0xffd23f), Pal.hex(0xff9a1a), smooth(0.9, -0.9, p.y)), px, 0.1);
});

/** HUD pill background. */
export const Pill = (rgb: number, alpha = 0.55) => CasualArt.panel(H(rgb).withAlpha(alpha), Color.white.withAlpha(0.25), 0.05);

/** Arrow icon for how-to rows (points right; rotate with sprite variants). */
export const Arrow = (dir: number) => CasualArt.make("dr-arrow-" + dir, 96, 96, (p) => {
  const a = -dir * Math.PI / 2;
  const q = v(p.x * Math.cos(a) - p.y * Math.sin(a), p.x * Math.sin(a) + p.y * Math.cos(a));
  const shaft = sdBox(q.sub(v(-0.2, 0)), v(0.45, 0.16), 0.06);
  const head = Math.max(Math.abs(q.y) * 0.9 + (q.x - 0.85) * 0.9, -(q.x - 0.1));
  const d = Math.min(shaft, head);
  return layer(Color.clear, d, Color.white, 2 / 96, 0.0);
});

export const sprites = (): Sprite[] => [CoinSprite(), Shadow()];
