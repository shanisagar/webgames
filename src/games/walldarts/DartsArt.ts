import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";

/** Procedural sprites for Darts Wall (the pub board on the wall). */

/** Segment numbers clockwise from the top. */
export const Order = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
/**
 * Ring radii as a share of the playing radius (simplified for soft balls thrown from 5 m: real boards have 8 mm rings,
 * here the trebles and doubles are ~16 % and ~14 % of the radius and the bulls are twice the real size).
 */
export const Bull = 0.11, OuterBull = 0.25, TrebleIn = 0.54, TrebleOut = 0.70, DoubleIn = 0.86;
/** Playing radius as a share of the whole board (the rest is the number ring). */
export const PlayShare = 0.83;

const Black = Pal.hex(0x1d1b1a), Cream = Pal.hex(0xf1dfb8), Red = Pal.hex(0xd8262e), Green = Pal.hex(0x1a8f4a), Wire = Pal.hex(0xc9ccd2);

const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

export const BoardSprite = () => CasualArt.make("wd-board", 512, 512, (p) => {
  const px = 2 / 512;
  const r = p.magnitude;
  if (r > 1) return new Color(0, 0, 0, 0);
  const edge = CasualArt.fill(r - 0.995, px);
  const q = r / PlayShare;
  const ang = (Math.atan2(p.x, p.y) * 180) / Math.PI;
  const seg = Math.floor(Mathf.repeat(ang + 9, 360) / 18);
  const segEdge = Math.abs(Mathf.repeat(ang + 9, 18) - 9) ; // 9 at the boundary
  let c: Color;
  if (q > 1) {
    c = Black;
    // outer chrome band
    c = Color.lerp(c, Pal.hex(0x3a3634), CasualArt.smooth(0.96, 0.99, r) * 0.6);
  } else if (q < Bull) c = Red;
  else if (q < OuterBull) c = Green;
  else {
    const even = seg % 2 === 0;
    const ring = (q > TrebleIn && q < TrebleOut) || q > DoubleIn;
    c = ring ? (even ? Red : Green) : even ? Black : Cream;
    // sisal fibre
    c = Color.lerp(c, CasualArt.darken(c, 0.25), (hash(Math.floor(p.x * 300), Math.floor(p.y * 300)) - 0.5) * 0.35);
    // spider wires
    const arc = (r * Math.PI * (9 - segEdge)) / 180;
    const wire = Math.min(arc, ...[OuterBull, TrebleIn, TrebleOut, DoubleIn, 1].map((k) => Math.abs(q - k) * PlayShare));
    c = Color.lerp(c, Wire, CasualArt.fill(wire - 0.0035, px) * 0.95);
  }
  if (q < OuterBull) {
    const wire = Math.min(Math.abs(q - Bull), Math.abs(q - OuterBull)) * PlayShare;
    c = Color.lerp(c, Wire, CasualArt.fill(wire - 0.0035, px) * 0.95);
  }
  // soft light from the top-left
  c = Color.lerp(c, Color.white, CasualArt.smooth(0.6, -1, p.x - p.y) * 0.08);
  return c.withAlpha(edge);
});

/** Wooden cabinet behind a board (1 × 1). */
export const CabinetSprite = () => CasualArt.make("wd-cab", 160, 160, (p) => {
  const px = 2 / 160;
  const d = CasualArt.sdBox(p, new V2(0.97, 0.97), 0.08);
  let c = Color.lerp(Pal.hex(0x4a2614), Pal.hex(0x7a4426), CasualArt.smooth(-1, 1, p.y * 0.3 + Math.sin(p.x * 30 + Math.sin(p.y * 4) * 3) * 0.15 + 0.2));
  const frame = Math.abs(d + 0.06) - 0.06;
  c = Color.lerp(c, Pal.hex(0x2e170b), CasualArt.fill(frame, px) * 0.7);
  c = Color.lerp(c, Color.black, CasualArt.smooth(0.2, 0.9, 1 - Math.abs(d) * 4) * 0);
  return c.withAlpha(CasualArt.fill(d, px));
});

/** Pub wall: dark green damask with warm lamp pools and wood panelling below. 16:9. */
export const Backdrop = () => CasualArt.make("wd-bg", 256, 144, (p) => {
  const y = p.y / 0.5625;
  let c = Color.lerp(Pal.hex(0x0c2a20), Pal.hex(0x174a37), CasualArt.smooth(-1, 1, y));
  const dam = Math.sin(p.x * 40) * Math.sin(p.y * 40 + Math.sin(p.x * 20) * 1.5);
  c = Color.lerp(c, Pal.hex(0x1f5e45), CasualArt.smooth(0.5, 0.9, dam) * 0.35);
  for (const lx of [-0.5, 0.5]) {
    const g = Math.exp(-((p.x - lx) * (p.x - lx) * 8 + (y - 0.6) * (y - 0.6) * 2));
    c = Color.lerp(c, Pal.hex(0xffc878), g * 0.35);
  }
  if (y < -0.72) {
    let w = Color.lerp(Pal.hex(0x3a1e0e), Pal.hex(0x5a3218), Mathf.repeat(p.x * 6, 1) < 0.04 ? 0 : 0.7);
    w = Color.lerp(w, Pal.hex(0x8a5a30), CasualArt.smooth(-0.76, -0.72, y) * 0.8);
    c = w;
  }
  return c.withAlpha(1);
});

/** A soft throwing ball (white with a coloured band). */
export const BallSprite = () => CasualArt.make("wd-ball", 96, 96, (p) => {
  let c = CasualArt.ballPixel(p, Pal.hex(0xf4f4f0), 2 / 96);
  if (c.a <= 0) return c;
  c = Color.lerp(c, Pal.hex(0xffc93c), CasualArt.fill(Math.abs(p.y + p.x * 0.3) - 0.14, 2 / 96) * 0.9);
  return c;
});

/** A dart stuck in the board, seen from behind: tip into the board, barrel, and the flight's cross (tinted). 1 × 1. */
export const DartSprite = () => CasualArt.make("wd-dart", 96, 96, (p) => {
  const px = 2 / 96;
  let c = new Color(0, 0, 0, 0);
  // shadow
  c = CasualArt.over(c, new Color(0, 0, 0, 0.35), CasualArt.fill(CasualArt.sdSegment(p, new V2(0.12, -0.12), new V2(0.55, -0.45)) - 0.12, px * 4));
  // barrel from the board point (0,0) up to the flight
  const barrel = CasualArt.sdSegment(p, new V2(0, 0), new V2(0.3, 0.3)) - 0.07;
  c = CasualArt.over(c, Pal.hex(0xb8bcc6), CasualArt.fill(barrel, px));
  for (let k = 0; k < 3; k++) c = CasualArt.over(c, Pal.hex(0x6a6e78), CasualArt.fill(Math.abs((p.x + p.y) * 0.707 - (0.08 + k * 0.08)) - 0.012, px) * CasualArt.fill(barrel, px));
  c = CasualArt.over(c, Pal.hex(0x40434a), CasualArt.fill(CasualArt.sdCircle(p, V2.zero, 0.06), px));
  // flights: four vanes around the end of the shaft
  const f = new V2(0.42, 0.42);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    const tip = f.add(new V2(Math.cos(a), Math.sin(a)).mul(0.46));
    const vane = CasualArt.sdSegment(p, f, tip) - (0.13 - 0.1 * Mathf.clamp01(new V2(p.x - f.x, p.y - f.y).magnitude / 0.46));
    c = CasualArt.over(c, Color.white, CasualArt.fill(vane, px));
  }
  return c;
});

/** Only the flight vanes (to tint per player on top of the dart). */
export const FlightTint = () => CasualArt.make("wd-flight", 96, 96, (p) => {
  const px = 2 / 96;
  const f = new V2(0.42, 0.42);
  let a = 0;
  for (let k = 0; k < 4; k++) {
    const an = k * Math.PI / 2 + Math.PI / 4;
    const tip = f.add(new V2(Math.cos(an), Math.sin(an)).mul(0.46));
    const vane = CasualArt.sdSegment(p, f, tip) - (0.11 - 0.09 * Mathf.clamp01(new V2(p.x - f.x, p.y - f.y).magnitude / 0.46));
    a = Math.max(a, CasualArt.fill(vane, px));
  }
  return new Color(1, 1, 1, a);
});
