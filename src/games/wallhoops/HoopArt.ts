import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";

/** Procedural sprites for Hoop Shootout (the fair-arcade basketball machine on the wall). */

export const Orange = Pal.hex(0xff7a1a), RimOrange = Pal.hex(0xff5a12), Purple = Pal.hex(0x2a1460);

export const BallSprite = () => CasualArt.make("wh-ball", 128, 128, (p) => {
  const px = 2 / 128;
  let c = CasualArt.ballPixel(p, Orange, px);
  if (c.a <= 0) return c;
  let line = 9;
  line = Math.min(line, Math.abs(p.x));
  line = Math.min(line, Math.abs(p.y));
  line = Math.min(line, Math.abs(new V2(p.x + 1.1, p.y).magnitude - 0.85));
  line = Math.min(line, Math.abs(new V2(p.x - 1.1, p.y).magnitude - 0.85));
  c = Color.lerp(c, new Color(0.22, 0.08, 0.04, c.a), CasualArt.fill(line - 0.04, px) * 0.9);
  return c;
});

/** Arcade hall: deep purple with bokeh lights and a warm floor glow. */
export const Backdrop = () => CasualArt.make("wh-bg", 192, 108, (p) => {
  const t = (p.y + 0.5625) / 1.125;
  let c = Color.lerp(Pal.hex(0x0b0620), Pal.hex(0x2a1460), CasualArt.smooth(0, 1, t));
  const lights = [[-0.85, 0.42, 0xff4f8b], [-0.45, 0.5, 0x2fc8ff], [0.05, 0.47, 0xffc93c], [0.5, 0.52, 0x8c6cff], [0.9, 0.4, 0x2fc8ff], [-0.65, 0.2, 0xffc93c], [0.7, 0.18, 0xff4f8b]];
  for (const [x, y, h] of lights) {
    const d = new V2(p.x - x, p.y - y).magnitude;
    c = Color.lerp(c, Pal.hex(h), CasualArt.smooth(0.12, 0.0, d) * 0.35);
  }
  c = Color.lerp(c, Pal.hex(0xff7a3a), Math.exp(-(p.y + 0.56) * (p.y + 0.56) * 30) * 0.25);
  return c.withAlpha(1);
});

/** Back panel of one machine: dark padded wall with diagonal stripes and a soft spotlight. 1 × 0.8. */
export const CabinetSprite = () => CasualArt.make("wh-cab", 160, 128, (p) => {
  const px = 2 / 160;
  const d = CasualArt.sdBox(p, new V2(0.98, 0.78), 0.06);
  let c = Color.lerp(Pal.hex(0x120a2e), Pal.hex(0x231552), CasualArt.smooth(-0.8, 0.8, p.y));
  const stripe = Mathf.repeat((p.x + p.y) * 7, 1);
  c = Color.lerp(c, Pal.hex(0x2d1d66), CasualArt.smooth(0.45, 0.5, stripe) * CasualArt.smooth(0.55, 0.5, stripe) * 0.6);
  c = Color.lerp(c, Pal.hex(0x5a3fb0), Math.exp(-(p.x * p.x * 2.5 + (p.y - 0.3) * (p.y - 0.3) * 3)) * 0.35);
  return c.withAlpha(CasualArt.fill(d, px) * 0.96);
}, 0, 0);

/** A rounded frame outline (tinted per side). Same shape as the cabinet. */
export const CabinetFrame = () => CasualArt.make("wh-cabf", 160, 128, (p) => {
  const px = 2 / 160;
  const d = CasualArt.sdBox(p, new V2(0.98, 0.78), 0.06);
  return new Color(1, 1, 1, CasualArt.fill(Math.abs(d + 0.012) - 0.012, px));
});

/** Light bulb (white core, tinted halo). */
export const Bulb = () => CasualArt.make("wh-bulb", 48, 48, (p) => {
  const r = p.magnitude;
  const core = CasualArt.fill(r - 0.42, 2 / 48);
  const halo = CasualArt.smooth(1, 0.3, r) * 0.45;
  return new Color(1, 1, 1, Math.max(core, halo));
});

/** Backboard glass, 1 × 0.667: white glass with the painted shooter's square. */
export const BoardSprite = () => CasualArt.make("wh-board", 210, 140, (p) => {
  const px = 2 / 210;
  const d = CasualArt.sdBox(p, new V2(0.97, 0.635), 0.07);
  let c = new Color(0.9, 0.95, 1, 0.94);
  c = Color.lerp(c, Color.white, CasualArt.smooth(0.1, 0.7, p.y + p.x * 0.4) * 0.35);
  // painted square (orange outline)
  const sq = Math.abs(CasualArt.sdBox(p.sub(new V2(0, -0.227)), new V2(0.394, 0.288), 0.01)) - 0.026;
  c = Color.lerp(c, Pal.hex(0xff5a2a), CasualArt.fill(sq, px));
  return c.withAlpha(c.a * CasualArt.fill(d, px));
});

/** Frame around the glass (tinted). */
export const BoardFrame = () => CasualArt.make("wh-boardf", 210, 140, (p) => {
  const px = 2 / 210;
  const d = CasualArt.sdBox(p, new V2(0.97, 0.635), 0.07);
  return new Color(1, 1, 1, CasualArt.fill(Math.abs(d + 0.03) - 0.03, px));
});

/** Half of the rim ellipse (front = lower half), 1 × 0.25 sprite: rx 0.917, ry 0.1875 in sprite units. */
export const RimHalf = (front: boolean) => CasualArt.make(front ? "wh-rimf" : "wh-rimb", 160, 40, (p) => {
  const px = 2 / 160;
  const q = new V2(p.x / 0.917, p.y / 0.1875), m = Math.max(1e-4, q.magnitude);
  const g = new V2(q.x / 0.917, q.y / 0.1875).magnitude / m;
  const ring = Math.abs(m - 1) / Math.max(1e-4, g) - 0.03;
  const half = front ? p.y <= 0.01 : p.y >= -0.01;
  const c = Color.lerp(Pal.hex(0xc93a08), Pal.hex(0xffa060), CasualArt.smooth(-0.2, 0.2, p.y + (front ? 0.08 : -0.08)));
  return c.withAlpha(half ? CasualArt.fill(ring, px) : 0);
});

/** Neon ring around a hoop zone (BRAND glow). */
export const Halo = () => CasualArt.make("wh-halo", 96, 96, (p) => {
  const r = p.magnitude;
  return new Color(1, 1, 1, CasualArt.smooth(1, 0.55, r) * CasualArt.smooth(0.2, 0.6, r) * 0.9);
});

/** Ball-return ramp at the bottom of a machine (1 × 0.18), perspective lanes. */
export const RampSprite = () => CasualArt.make("wh-ramp", 200, 36, (p) => {
  const px = 2 / 200;
  const t = (p.y + 0.18) / 0.36; // 0 bottom .. 1 top
  const half = Mathf.lerp(0.99, 0.86, t);
  const inside = CasualArt.fill(Math.abs(p.x) - half, px);
  let c = Color.lerp(Pal.hex(0x3a1d0c), Pal.hex(0x8a4a1c), t);
  const u = p.x / half;
  const lane = Mathf.repeat(u * 4, 1);
  c = Color.lerp(c, Pal.hex(0xffb36b), CasualArt.smooth(0.96, 1, lane) * 0.35);
  c = Color.lerp(c, Pal.hex(0xffd29a), CasualArt.smooth(0.85, 1, t) * 0.5);
  return c.withAlpha(inside);
});
