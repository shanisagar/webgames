import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";

/** Procedural sprites for Cricket Bowling: gully cricket against a painted street wall. */

export const Chalk = Pal.hex(0xf7f3e8), Skin = Pal.hex(0xc98a5a), Wood = Pal.hex(0xe2b878), Ball = Pal.hex(0x9fe03a);

const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x: number, y: number) => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return Mathf.lerp(Mathf.lerp(a, b, ux), Mathf.lerp(c, d, ux), uy);
};

/** Tennis ball (fluoro yellow-green with the seam). */
export const BallSprite = () => CasualArt.make("wc-ball", 96, 96, (p) => {
  const px = 2 / 96;
  let c = CasualArt.ballPixel(p, Ball, px);
  if (c.a <= 0) return c;
  const seam = Math.min(Math.abs(new V2(p.x + 1.05, p.y).magnitude - 0.8), Math.abs(new V2(p.x - 1.05, p.y).magnitude - 0.8));
  c = Color.lerp(c, new Color(1, 1, 1, c.a), CasualArt.fill(seam - 0.045, px) * 0.85);
  return c;
});

/** Evening street sky behind the wall (only seen around a letterboxed wall). */
export const Backdrop = () => CasualArt.make("wc-bg", 64, 128, (p) => {
  const t = (p.y + 2) / 4;
  return Color.lerp(Pal.hex(0x3a2a40), Pal.hex(0xf2a65a), CasualArt.smooth(0, 1, t)).withAlpha(1);
});

/** The painted street wall: 32 × 18 world units. Ground line at y = -6.2 (sprite y = -0.3875 · 2 ...). */
export const WallSprite = () => CasualArt.make("wc-wall", 640, 360, (p) => {
  // world coordinates (x -16..16, y -9..9)
  const wx = p.x * 16, wy = p.y * 16;
  const ground = -6.2;
  if (wy < ground) {
    // pavement slabs + kerb
    const t = (ground - wy) / 2.8;
    let c = Color.lerp(Pal.hex(0x8d8a86), Pal.hex(0x5d5a58), t);
    const slab = Math.min(Mathf.repeat(wx / 2.6 + (Math.floor(wy / 1.2) % 2) * 0.5, 1), Mathf.repeat(wy / 1.2, 1));
    c = Color.lerp(c, Pal.hex(0x4a4746), CasualArt.smooth(0.03, 0.0, slab) * 0.6);
    c = Color.lerp(c, Pal.hex(0x3b3836), CasualArt.smooth(0.25, 0, ground - wy) * 0.7);
    c = Color.lerp(c, Color.black, (vnoise(wx * 3, wy * 3) - 0.5) * 0.15);
    return c.withAlpha(1);
  }
  // plaster wall with warm sun gradient
  const sun = CasualArt.smooth(-8, 9, wy + wx * 0.25);
  let c = Color.lerp(Pal.hex(0xd9824a), Pal.hex(0xf4c46e), sun);
  const n = vnoise(wx * 0.9, wy * 0.9) * 0.6 + vnoise(wx * 3.1, wy * 3.1) * 0.4;
  c = Color.lerp(c, CasualArt.darken(c, 0.2), (n - 0.5) * 0.5);
  // patches of exposed brick
  const patch = vnoise(wx * 0.45 + 7, wy * 0.55 + 3) * 0.75 + vnoise(wx * 1.3, wy * 1.3) * 0.25;
  if (patch > 0.71) {
    const row = Math.floor(wy / 0.55);
    const bx = Mathf.repeat(wx / 1.2 + (row % 2) * 0.5, 1), by = Mathf.repeat(wy / 0.55, 1);
    const mortar = Math.min(Math.min(bx, 1 - bx) * 1.2, Math.min(by, 1 - by) * 0.55);
    let brick = Color.lerp(Pal.hex(0xa8452c), Pal.hex(0xc25a36), hash(Math.floor(wx / 1.2 + (row % 2) * 0.5), row));
    brick = Color.lerp(Pal.hex(0xd8c0a0), brick, CasualArt.smooth(0.02, 0.06, mortar));
    c = Color.lerp(c, brick, CasualArt.smooth(0.71, 0.74, patch));
  }
  // painted dado band near the ground
  if (wy < -4.6) c = Color.lerp(c, Pal.hex(0x2f6f73), 0.85 * CasualArt.smooth(-4.55, -4.75, wy));
  c = Color.lerp(c, Pal.hex(0x234f52), CasualArt.smooth(-4.6, -4.55, wy) * CasualArt.smooth(-4.45, -4.5, wy) * 0.9);
  // drip stains and a shadow at the foot of the wall
  const drip = CasualArt.smooth(0.94, 1, vnoise(wx * 2.4, 0.5)) * CasualArt.smooth(9, 3, wy);
  c = Color.lerp(c, CasualArt.darken(c, 0.25), drip * 0.5);
  c = Color.lerp(c, Color.black, CasualArt.smooth(-5.4, -6.2, wy) * 0.25);
  return c.withAlpha(1);
});

/** One chalk stump: rough white stroke, 1 × 10 sprite (scale it by height). */
export const StumpSprite = () => CasualArt.make("wc-stump", 24, 240, (p) => {
  const w = 0.62 + (vnoise(0.3, p.y * 3) - 0.5) * 0.12;
  const a = CasualArt.smooth(w, w - 0.12, Math.abs(p.x)) * CasualArt.smooth(9.9, 9.6, Math.abs(p.y));
  const grain = 0.65 + 0.35 * vnoise(p.x * 6, p.y * 14);
  return Chalk.withAlpha(a * grain);
});

/** A chalk bail, 1 × 0.3. */
export const BailSprite = () => CasualArt.make("wc-bail", 64, 20, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.92, 0.17), 0.12);
  const grain = 0.7 + 0.3 * vnoise(p.x * 9, p.y * 9);
  return Chalk.withAlpha(CasualArt.fill(d, 0.06) * grain);
});

/** Chalk rectangle outline (scaled to any size). */
export const ChalkBox = () => CasualArt.make("wc-box", 160, 96, (p) => {
  const d = Math.abs(CasualArt.sdBox(p, new V2(0.94, 0.54), 0.04)) - 0.022 - (vnoise(p.x * 8, p.y * 8) - 0.5) * 0.012;
  const grain = 0.6 + 0.4 * vnoise(p.x * 20, p.y * 20);
  return Chalk.withAlpha(CasualArt.fill(d, 0.02) * grain);
});

/** Sponsor hoarding (tinted with the brand colour), 1 × 0.55. */
export const Hoarding = () => CasualArt.make("wc-hoard", 160, 88, (p) => {
  const px = 2 / 160;
  const d = CasualArt.sdBox(p, new V2(0.96, 0.5), 0.06);
  let c = Color.white;
  c = Color.lerp(c, new Color(0.82, 0.82, 0.82, 1), CasualArt.smooth(0.5, -0.5, p.y) * 0.4);
  const edge = Math.abs(d + 0.03) - 0.03;
  c = Color.lerp(c, new Color(0.25, 0.25, 0.3, 1), CasualArt.fill(edge, px));
  return c.withAlpha(CasualArt.fill(d, px));
});

/** Batter body (cap, shirt, whites, pads, shoes); `shirt` tints the cap and shirt. 1 × 2 sprite (height 2 units per width). */
export const BatterSprite = (shirt: Color, key: string) => CasualArt.make("wc-batter-" + key, 128, 256, (p) => {
  const px = 2 / 128;
  let c = new Color(0, 0, 0, 0);
  const put = (d: number, col: Color) => { c = CasualArt.over(c, col, CasualArt.fill(d, px)); };
  // legs: white trousers with pads
  for (const s of [-1, 1]) {
    put(CasualArt.sdBox(p.sub(new V2(s * 0.27, -1.2)), new V2(0.2, 0.62), 0.08), Pal.hex(0xf2f2ee));
    const pad = CasualArt.sdBox(p.sub(new V2(s * 0.28, -1.38)), new V2(0.24, 0.42), 0.1);
    put(pad, Pal.hex(0xffffff));
    put(Math.abs(pad + 0.03) - 0.012, Pal.hex(0xc8ccd6));
    for (let k = 0; k < 3; k++) put(CasualArt.sdBox(p.sub(new V2(s * 0.28 + (k - 1) * 0.12, -1.38)), new V2(0.012, 0.36), 0), Pal.hex(0xd5d9e2));
    put(CasualArt.sdBox(p.sub(new V2(s * 0.32, -1.88)), new V2(0.25, 0.09), 0.07), Pal.hex(0x2a2a33));
  }
  // shirt
  const torso = CasualArt.sdBox(p.sub(new V2(0, 0.05)), new V2(0.5, 0.62), 0.22);
  put(torso, shirt);
  put(CasualArt.sdBox(p.sub(new V2(0, 0.05)), new V2(0.08, 0.6), 0.02), CasualArt.darken(shirt, 0.18));
  put(CasualArt.sdBox(p.sub(new V2(0, -0.58)), new V2(0.48, 0.08), 0.03), Pal.hex(0x2a2a33));
  // neck + head
  put(CasualArt.sdBox(p.sub(new V2(0, 0.72)), new V2(0.12, 0.12), 0.04), CasualArt.darken(Skin, 0.12));
  put(CasualArt.sdCircle(p, new V2(0, 1.08), 0.34), Skin);
  put(CasualArt.sdCircle(p, new V2(-0.12, 1.1), 0.04), Pal.hex(0x1a1010));
  put(CasualArt.sdCircle(p, new V2(0.12, 1.1), 0.04), Pal.hex(0x1a1010));
  put(CasualArt.sdSegment(p, new V2(-0.1, 0.96), new V2(0.1, 0.96)) - 0.02, CasualArt.darken(Skin, 0.4));
  // cap with brim
  const cap = Math.max(CasualArt.sdCircle(p, new V2(0, 1.15), 0.37), -(p.y - 1.2));
  put(cap, shirt);
  put(CasualArt.sdBox(p.sub(new V2(0, 1.2)), new V2(0.42, 0.05), 0.04), CasualArt.darken(shirt, 0.25));
  // shading
  if (c.a > 0) c = Color.lerp(c, CasualArt.darken(c, 0.2), CasualArt.smooth(-0.2, 1, p.x) * 0.35);
  return c;
});

/** Cricket bat, 1 × 5 sprite: grip on top, blade below. Pivot is the top of the handle. */
export const BatSprite = () => CasualArt.make("wc-bat", 40, 200, (p) => {
  const px = 2 / 40;
  let c = new Color(0, 0, 0, 0);
  const grip = CasualArt.sdBox(p.sub(new V2(0, 3.4)), new V2(0.22, 1.45), 0.18);
  c = CasualArt.over(c, Pal.hex(0x22252e), CasualArt.fill(grip, px));
  for (let k = 0; k < 7; k++) c = CasualArt.over(c, Pal.hex(0x3a3f4e), CasualArt.fill(Math.abs(p.y - (2.2 + k * 0.32)) - 0.04, px) * CasualArt.fill(grip, px));
  const blade = CasualArt.sdBox(p.sub(new V2(0, -1.0)), new V2(0.9, 3.0), 0.35);
  let w = Color.lerp(Pal.hex(0xc99a5a), Wood, CasualArt.smooth(-0.9, 0.6, p.x));
  w = Color.lerp(w, Pal.hex(0xb07a3a), (vnoise(p.x * 2, p.y * 9) - 0.5) * 0.3);
  c = CasualArt.over(c, w, CasualArt.fill(blade, px));
  c = CasualArt.over(c, Pal.hex(0x8a5a2a), CasualArt.fill(Math.abs(blade + 0.04) - 0.04, px));
  return c;
});

/** Chalk dust puff. */
export const Dust = () => CasualArt.make("wc-dust", 48, 48, (p) => new Color(1, 1, 1, CasualArt.smooth(1, 0.2, p.magnitude) * (0.6 + 0.4 * vnoise(p.x * 4, p.y * 4))));

/** Drainpipe down the middle of the wall (splits the halves), 1 × 20. */
export const PipeSprite = () => CasualArt.make("wc-pipe", 24, 480, (p) => {
  const px = 2 / 24;
  let c = Color.lerp(Pal.hex(0x3d5a5c), Pal.hex(0x8fb3b0), CasualArt.smooth(-0.8, 0.4, p.x));
  c = Color.lerp(c, Color.white, CasualArt.smooth(0.35, 0.2, Math.abs(p.x + 0.35)) * 0.35);
  const bracket = Mathf.repeat(p.y / 4, 1);
  const br = CasualArt.smooth(0.03, 0.0, Math.abs(bracket - 0.5) - 0.02);
  c = Color.lerp(c, Pal.hex(0x2a3a3c), br * 0.8);
  return c.withAlpha(CasualArt.fill(Math.abs(p.x) - (0.62 + br * 0.3), px));
});
