import { CasualArt, Color, Pal, V2 } from "../../kit";

/** Procedural art for ROCK PAPER SCISSORS: cartoon hands, pick buttons, power cards and the arena backdrop. */

const { fill, smooth, sdBox, sdCircle, sdSegment, over, lighten, darken } = CasualArt;

export const Cyan = Pal.hex(0x2ec8ff), Orange = Pal.hex(0xff7a2a), Gold = Pal.hex(0xffc93c), Red = Pal.hex(0xff4a5a), Green = Pal.hex(0x5ce07a);
export const Ink = Pal.hex(0x1a1030), White = Pal.hex(0xfff8ee);

export enum Pick { Rock, Paper, Scissors }
export const PickNames = ["ROCK", "PAPER", "SCISSORS"];

export interface HandStyle { name: string; skin: Color; line: Color; cost: number; nails?: boolean; glove?: boolean; metal?: boolean; shiny?: boolean }
export const Hands: HandStyle[] = [
  { name: "CLASSIC", skin: Pal.hex(0xf6c39a), line: Pal.hex(0x8a4a2a), cost: 0, nails: true },
  { name: "CARTOON GLOVE", skin: Pal.hex(0xffffff), line: Pal.hex(0x3a3a5a), cost: 250, glove: true },
  { name: "ROBOT", skin: Pal.hex(0xb8c4d4), line: Pal.hex(0x3a4458), cost: 500, metal: true },
  { name: "SWAMP MONSTER", skin: Pal.hex(0x7ad05a), line: Pal.hex(0x2a5a1a), cost: 900, nails: true },
  { name: "GOLDEN", skin: Pal.hex(0xffc93c), line: Pal.hex(0x8a5a10), cost: 1500, shiny: true },
];

const ellipse = (p: V2, c: V2, r: V2) => (Math.hypot((p.x - c.x) / r.x, (p.y - c.y) / r.y) - 1) * Math.min(r.x, r.y);
const capsule = (p: V2, a: V2, b: V2, r: number) => sdSegment(p, a, b) - r;

/** Parts of a hand: each is a signed distance; drawn back to front so outlines separate the fingers. */
type Part = { d: (p: V2) => number; shade?: number };

function handParts(pick: Pick): Part[] {
  const parts: Part[] = [];
  // wrist (the sleeve covers the rest)
  parts.push({ d: (p) => sdBox(p.sub(new V2(0, -0.78)), new V2(0.36, 0.35), 0.12) });
  if (pick === Pick.Paper) {
    parts.push({ d: (p) => sdBox(p.sub(new V2(0, -0.12)), new V2(0.5, 0.46), 0.24) });
    const fingers: [number, number, number][] = [[-0.39, 0.66, -0.1], [-0.13, 0.86, -0.03], [0.13, 0.8, 0.03], [0.38, 0.58, 0.1]];
    for (const [x, len, lean] of fingers) parts.push({ d: (p) => capsule(p, new V2(x, 0.2), new V2(x + lean * 2.4, 0.2 + len), 0.12) });
    parts.push({ d: (p) => capsule(p, new V2(-0.42, -0.25), new V2(-0.82, 0.22), 0.13), shade: 0.05 });
  } else {
    // fist: palm block + knuckles
    const top = pick === Pick.Rock ? 0.38 : 0.28;
    parts.push({ d: (p) => sdBox(p.sub(new V2(0, -0.05)), new V2(0.52, 0.48), 0.26) });
    if (pick === Pick.Scissors) {
      parts.push({ d: (p) => capsule(p, new V2(-0.15, 0.2), new V2(-0.5, 1.12), 0.125) });
      parts.push({ d: (p) => capsule(p, new V2(0.12, 0.2), new V2(0.42, 1.18), 0.125) });
    }
    const knuckles = pick === Pick.Rock ? [-0.36, -0.12, 0.12, 0.36] : [0.18, 0.4];
    for (const x of knuckles) parts.push({ d: (p) => ellipse(p, new V2(x, top), new V2(0.15, 0.16)), shade: 0.06 });
    // curled finger segments across the front
    const rows = pick === Pick.Rock ? [-0.36, -0.12, 0.12, 0.36] : [0.18, 0.4];
    for (const x of rows) parts.push({ d: (p) => sdBox(p.sub(new V2(x, top - 0.2)), new V2(0.11, 0.16), 0.09), shade: -0.04 });
    // thumb across the curled fingers
    parts.push({ d: (p) => capsule(p, new V2(-0.5, -0.2), new V2(0.08, pick === Pick.Rock ? 0.04 : -0.02), 0.15), shade: 0.08 });
  }
  return parts;
}

/** A hand pointing up (fingers at the top, sleeve at the bottom). 1 unit wide, 1.5 tall. */
export function HandSprite(pick: Pick, style: number, sleeve: Color, key: string) {
  const st = Hands[style];
  return CasualArt.make(`rps-hand${pick}-${style}-${key}`, 150, 225, (p) => {
    const px = 2 / 150;
    p = new V2(p.x * 1.25, (p.y + 0.12) * 1.25);
    let c = Color.clear;
    // sleeve with a cuff
    const sl = sdBox(p.sub(new V2(0, -1.55)), new V2(0.52, 0.5), 0.1);
    c = over(c, darken(sleeve, 0.5), fill(sl, px));
    c = over(c, Color.lerp(darken(sleeve, 0.15), lighten(sleeve, 0.15), smooth(0.4, -0.4, p.x)), fill(sl + 0.04, px));
    for (const k of [-0.25, 0, 0.25]) c = over(c, darken(sleeve, 0.3).withAlpha(0.5), fill(Math.abs(p.x - k + (p.y + 1.6) * 0.05) - 0.01, px) * fill(sl + 0.06, px));
    for (const part of handParts(pick)) {
      const d = part.d(p);
      if (d > px * 3) continue;
      const lit = smooth(-0.9, 0.9, p.y * 0.4 - p.x * 0.7);
      let s = Color.lerp(darken(st.skin, 0.2), lighten(st.skin, 0.12), lit);
      if (part.shade) s = part.shade > 0 ? lighten(s, part.shade) : darken(s, -part.shade);
      s = Color.lerp(s, darken(st.skin, 0.28), smooth(-0.1, 0, d) * 0.7);
      if (st.metal) s = Color.lerp(s, Color.white, smooth(0.9, 1, Math.sin(p.x * 9 + p.y * 3) * 0.5 + 0.5) * 0.4);
      if (st.shiny) s = Color.lerp(s, Color.white, smooth(0.86, 1, Math.sin((p.x + p.y) * 8) * 0.5 + 0.5) * 0.45);
      c = over(c, st.line, fill(d, px));
      c = over(c, s, fill(d + 0.045, px));
    }
    // nails on the visible fingertips
    if (st.nails && pick !== Pick.Rock) {
      const tips: V2[] = pick === Pick.Paper ? [new V2(-0.63, 0.83), new V2(-0.2, 1.03), new V2(0.2, 0.96), new V2(0.62, 0.74)] : [new V2(-0.48, 1.06), new V2(0.4, 1.12)];
      for (const t of tips) c = over(c, Color.lerp(st.skin, Color.white, 0.5).withAlpha(0.9), fill(ellipse(p, t, new V2(0.06, 0.07)), px));
    }
    if (st.glove) {
      // stitching on the back of the glove
      for (const x of [-0.18, 0, 0.18]) c = over(c, st.line.withAlpha(0.35), fill(Math.abs(p.x - x) - 0.012, px) * fill(Math.abs(p.y + 0.35) - 0.16, px));
      const cuff = sdBox(p.sub(new V2(0, -0.98)), new V2(0.48, 0.13), 0.1);
      c = over(c, st.line, fill(cuff, px));
      c = over(c, Color.white, fill(cuff + 0.04, px));
    }
    if (st.metal) for (const y of [-0.55, -0.85]) c = over(c, st.line.withAlpha(0.6), fill(sdCircle(p, new V2(0.24, y), 0.035), px));
    return c;
  });
}

/** Glossy round pick button (tinted). */
export const ButtonSprite = () => CasualArt.make("rps-btn", 128, 128, (p) => {
  const px = 2 / 128;
  const r = p.magnitude;
  let c = Color.clear;
  c = over(c, new Color(0, 0, 0, 0.35), fill(Math.hypot(p.x, p.y + 0.06) - 0.94, px * 4));
  const v = 0.72 + 0.28 * smooth(-0.9, 0.9, p.y);
  c = over(c, new Color(v * 0.55, v * 0.55, v * 0.55, 1), fill(r - 0.9, px));
  c = over(c, new Color(v, v, v, 1), fill(r - 0.82, px));
  c = over(c, Color.white.withAlpha(0.35), fill(ellipse(p, new V2(0, 0.42), new V2(0.55, 0.26)), px * 2));
  return c;
});

export const RingSprite = () => CasualArt.make("rps-ring", 128, 128, (p) => new Color(1, 1, 1, fill(Math.abs(p.magnitude - 0.9) - 0.06, 2 / 128)));

/** Power card: rounded card with an icon (0 = DOUBLE ×2, 1 = SHIELD). */
export function CardSprite(kind: number) {
  return CasualArt.make("rps-card" + kind, 96, 128, (p) => {
    const px = 2 / 96;
    let c = Color.clear;
    const card = sdBox(p, new V2(0.92, 1.25), 0.2);
    const base = kind === 0 ? Pal.hex(0xffb020) : Pal.hex(0x3aa8ff);
    c = over(c, darken(base, 0.5), fill(card, px));
    c = over(c, Color.lerp(darken(base, 0.1), lighten(base, 0.25), smooth(-1.2, 1.2, p.y)), fill(card + 0.06, px));
    c = over(c, Color.white.withAlpha(0.6), fill(Math.abs(sdBox(p, new V2(0.74, 1.07), 0.14)) - 0.025, px));
    if (kind === 0) {
      // ×2
      const x1 = capsule(p, new V2(-0.62, 0.32), new V2(-0.18, -0.22), 0.09), x2 = capsule(p, new V2(-0.62, -0.22), new V2(-0.18, 0.32), 0.09);
      const two = Math.min(
        sdSegment(p, new V2(0.08, 0.3), new V2(0.25, 0.42)) - 0.09,
        Math.abs(Math.hypot(p.x - 0.32, p.y - 0.24) - 0.2) - 0.09 + (p.y < 0.2 && p.x < 0.4 ? 0.3 : 0),
        capsule(p, new V2(0.48, 0.18), new V2(0.06, -0.24), 0.09),
        capsule(p, new V2(0.06, -0.24), new V2(0.6, -0.24), 0.09));
      c = over(c, Ink, fill(Math.min(x1, x2, two), px));
    } else {
      // shield
      const q = new V2(p.x, p.y - 0.05);
      const top = sdBox(q.sub(new V2(0, 0.25)), new V2(0.55, 0.32), 0.12);
      const tip = Math.max(Math.abs(q.x) * 1.3 + (q.y + 0.1) * 0.9 - 0.62, q.y - 0.3);
      const sh = Math.min(top, tip);
      c = over(c, Ink, fill(sh, px));
      c = over(c, Color.white, fill(sh + 0.08, px));
      c = over(c, base, fill(Math.max(sh + 0.08, -q.x), px));
    }
    return c;
  });
}

export const PipSprite = () => CasualArt.make("rps-pip", 96, 96, (p) => {
  const px = 2 / 96;
  let c = Color.clear;
  c = over(c, new Color(0, 0, 0, 0.45), fill(p.magnitude - 0.95, px));
  c = over(c, new Color(1, 1, 1, 0.16), fill(p.magnitude - 0.8, px));
  return c;
});

export const StarPip = () => CasualArt.make("rps-starpip", 96, 96, (p) => {
  const px = 2 / 96;
  let c = Color.clear;
  const d = CasualArt.sdStar(p.add(new V2(0, 0.06)), 0.95, 0.48);
  c = over(c, darken(Gold, 0.45), fill(d, px));
  c = over(c, Color.lerp(Gold, Pal.hex(0xfff0a0), smooth(-0.5, 0.8, p.y)), fill(d + 0.08, px));
  return c;
});

/** Arena backdrop: two-tone spotlights, light rays and sparkles. Upper half orange, lower cyan (flipped as needed). */
export const ArenaSprite = (vertical: boolean) => CasualArt.make("rps-arena" + (vertical ? "v" : "h"), 128, 256, (p) => {
  // p.x across, p.y along the long side (-2..2)
  const t = vertical ? p.y : p.y;
  const top = Pal.hex(0x6a1a4a), bottom = Pal.hex(0x0e2a6a), mid = Pal.hex(0x2a0f4a);
  let c = t > 0 ? Color.lerp(mid, top, smooth(0, 2, t)) : Color.lerp(mid, bottom, smooth(0, -2, t));
  const ang = Math.atan2(p.y, p.x);
  const rays = Math.pow(Math.abs(Math.sin(ang * 9)), 6) * smooth(2.2, 0.2, p.magnitude);
  c = Color.lerp(c, Color.white, rays * 0.06);
  c = Color.lerp(c, t > 0 ? Pal.hex(0xff7a3a) : Pal.hex(0x3ab8ff), smooth(1.4, 0, Math.hypot(p.x * 0.8, Math.abs(t) - 1.1)) * 0.28);
  c = Color.lerp(c, Pal.hex(0xd070ff), smooth(0.6, 0, Math.abs(t)) * 0.18);
  return c.withAlpha(1);
});

/** Lightning-bolt "VS" divider glow. */
export const VsBadge = () => CasualArt.make("rps-vs", 160, 160, (p) => {
  const px = 2 / 160;
  let c = Color.clear;
  const star = sdCircle(p, V2.zero, 0.62 + 0.18 * Math.pow(Math.abs(Math.cos(Math.atan2(p.y, p.x) * 5)), 4));
  c = over(c, darken(Gold, 0.5), fill(star, px));
  c = over(c, Color.lerp(Pal.hex(0xff9a2a), Gold, smooth(-0.6, 0.6, p.y)), fill(star + 0.06, px));
  return c;
});

export const ImpactSprite = () => CasualArt.make("rps-impact", 128, 128, (p) => {
  const a = Math.atan2(p.y, p.x), r = p.magnitude;
  const sp = 0.45 + 0.5 * Math.pow(Math.abs(Math.cos(a * 4)), 5);
  return new Color(1, 1, 1, fill(r - sp, 2 / 128) * smooth(1, 0.3, r));
});

export const CoinSprite = () => CasualArt.make("rps-coin", 64, 64, (p) => {
  const px = 2 / 64;
  let c = Color.clear;
  const r = p.magnitude;
  c = over(c, Pal.hex(0xb07a10), fill(r - 0.92, px));
  c = over(c, Color.lerp(Pal.hex(0xffb020), Pal.hex(0xffe58a), smooth(-0.8, 0.8, p.y - p.x * 0.3)), fill(r - 0.8, px));
  c = over(c, Pal.hex(0xd09018), fill(Math.abs(r - 0.55) - 0.05, px));
  return c;
});
