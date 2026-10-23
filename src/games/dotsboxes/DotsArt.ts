import { CasualArt, Color, Pal, V2 } from "../../kit";

/** Procedural art for DOTS & BOXES: paper, ink dots, pen strokes, hatching and doodles. */

const { fill, smooth, sdBox, sdCircle, sdSegment, over, darken } = CasualArt;

export const Gold = Pal.hex(0xffc93c);

export interface PaperStyle {
  name: string; cost: number; paper: Color; paper2: Color; rule: Color; margin: Color; dot: Color; pencil: Color; pens: [Color, Color];
  ui: Color; ink: Color; grid?: boolean; chalk?: boolean;
}
export const Papers: PaperStyle[] = [
  { name: "NOTEBOOK", cost: 0, paper: Pal.hex(0xfffaf0), paper2: Pal.hex(0xf3ead6), rule: Pal.hex(0x9cc4f0), margin: Pal.hex(0xf08a8a), dot: Pal.hex(0x2a2a3a),
    pencil: Pal.hex(0x9a9aa8), pens: [Pal.hex(0x2a6cff), Pal.hex(0xf0402a)], ui: Pal.hex(0x2a3050), ink: Pal.hex(0x1a2040) },
  { name: "GRAPH PAPER", cost: 300, paper: Pal.hex(0xfbfdff), paper2: Pal.hex(0xe6f0f8), rule: Pal.hex(0xa8d8c8), margin: Pal.hex(0x6ac0a0), dot: Pal.hex(0x203040),
    pencil: Pal.hex(0x8aa0a8), pens: [Pal.hex(0x1a8a5a), Pal.hex(0xc03aa0)], ui: Pal.hex(0x1a3a3a), ink: Pal.hex(0x102828), grid: true },
  { name: "KRAFT PAPER", cost: 700, paper: Pal.hex(0xd8b48a), paper2: Pal.hex(0xc49a6c), rule: Pal.hex(0xb08860), margin: Pal.hex(0x8a5a3a), dot: Pal.hex(0x2a1a10),
    pencil: Pal.hex(0x7a6048), pens: [Pal.hex(0x1a3ab0), Pal.hex(0xb01a1a)], ui: Pal.hex(0x3a2414), ink: Pal.hex(0x2a1a0a) },
  { name: "CHALKBOARD", cost: 1200, paper: Pal.hex(0x2a5a46), paper2: Pal.hex(0x1e4636), rule: Pal.hex(0x3a6a56), margin: Pal.hex(0x6a4a2a), dot: Pal.hex(0xf4f4ec),
    pencil: Pal.hex(0x8aa898), pens: [Pal.hex(0x7ae0ff), Pal.hex(0xff9ac8)], ui: Pal.hex(0x0e2a1e), ink: Pal.hex(0xf4f4ec), chalk: true },
];

const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

/** Full-screen paper: ruled lines (or a grid), a margin line, punched holes and a little coffee ring. */
export function PaperSprite(i: number) {
  const st = Papers[i];
  return CasualArt.make("db-paper" + i, 128, 256, (p) => {
    const px = 2 / 128;
    let c = Color.lerp(st.paper, st.paper2, smooth(-1, 2.4, Math.hypot(p.x, p.y * 0.5)));
    const fib = hash(Math.floor(p.x * 90), Math.floor(p.y * 90));
    c = Color.lerp(c, darken(c, 0.06), fib * (st.chalk ? 0.5 : 0.25));
    if (st.grid) {
      const gx = Math.abs(((p.x * 8) % 1 + 1) % 1 - 0.5), gy = Math.abs(((p.y * 8) % 1 + 1) % 1 - 0.5);
      c = Color.lerp(c, st.rule, (fill(0.5 - gx - 0.03, px * 4) + fill(0.5 - gy - 0.03, px * 4)) * 0.0);
      if (gx > 0.47 || gy > 0.47) c = Color.lerp(c, st.rule, 0.45);
    } else if (!st.chalk) {
      const ly = Math.abs(((p.y * 7) % 1 + 1) % 1 - 0.5);
      if (ly > 0.47) c = Color.lerp(c, st.rule, 0.6);
      if (Math.abs(p.x + 0.7) < 0.012) c = Color.lerp(c, st.margin, 0.75);
      for (const hy of [-1.3, 0, 1.3]) { const d = Math.hypot(p.x + 0.86, p.y - hy); if (d < 0.07) c = Color.lerp(c, darken(st.paper2, 0.25), fill(d - 0.06, px)); }
    } else {
      // chalk smudges
      const sm = Math.sin(p.x * 3 + Math.sin(p.y * 2) * 2) * 0.5 + 0.5;
      c = Color.lerp(c, Color.lerp(st.paper, Color.white, 0.12), smooth(0.7, 1, sm) * 0.25);
    }
    // coffee ring
    const r = Math.hypot(p.x - 0.62, p.y + 1.55);
    c = Color.lerp(c, Pal.hex(0x8a5a2a), (fill(Math.abs(r - 0.28) - 0.012, px) * 0.22 + fill(r - 0.28, px) * 0.04) * (st.chalk ? 0 : 1));
    return c.withAlpha(1);
  });
}

/** Slightly irregular ink dot. */
export const DotSprite = () => CasualArt.make("db-dot", 64, 64, (p) => {
  const a = Math.atan2(p.y, p.x);
  const r = 0.78 + 0.06 * Math.sin(a * 3 + 1) + 0.04 * Math.sin(a * 5);
  const d = p.magnitude - r;
  const v = 1 - 0.25 * smooth(0.5, -0.4, p.y - p.x);
  return new Color(v, v, v, fill(d, 2 / 64));
});

/** A pen stroke: wobbly edges and slightly tapered ends. 1 unit long, thin. */
export const StrokeSprite = () => CasualArt.make("db-stroke", 256, 32, (p) => {
  const px = 2 / 256;
  const w = 0.085 * (1 - 0.35 * Math.pow(Math.abs(p.x), 6)) + 0.008 * Math.sin(p.x * 23) + 0.006 * Math.sin(p.x * 57 + 1);
  const y = p.y - 0.01 * Math.sin(p.x * 5);
  const d = Math.max(Math.abs(y) - w, Math.abs(p.x) - 0.985);
  const grain = 0.85 + 0.15 * hash(Math.floor(p.x * 120), Math.floor(p.y * 120));
  return new Color(1, 1, 1, fill(d, px) * grain);
});

/** Pencil hatching that fills a claimed box. */
export const HatchSprite = () => CasualArt.make("db-hatch", 128, 128, (p) => {
  const px = 2 / 128;
  const inside = sdBox(p, new V2(0.86, 0.86), 0.12);
  const k = (p.x + p.y) * 6.5;
  const line = Math.abs(((k % 1) + 1) % 1 - 0.5);
  const wob = 0.18 + 0.05 * Math.sin(p.x * 9 - p.y * 7);
  const a = fill(-(wob - line) * 0.15, px) * 0.0 + (line < wob ? 1 : 0) * 0.55 + 0.18;
  return new Color(1, 1, 1, a * fill(inside, px * 3));
});

/** Doodles drawn inside claimed boxes (white strokes, tinted with the pen colour). */
export function DoodleSprite(k: number) {
  return CasualArt.make("db-doodle" + k, 96, 96, (p) => {
    const px = 2 / 96, t = 0.075;
    let d = 1e9;
    switch (k) {
      case 0: d = Math.abs(CasualArt.sdStar(p.add(new V2(0, 0.06)), 0.78, 0.45)) - t * 0.6; break; // star
      case 1: { // heart
        const q = new V2(Math.abs(p.x), p.y + 0.15);
        const h = Math.min(sdCircle(q, new V2(0.3, 0.32), 0.34), Math.max(q.x * 0.9 + q.y * 0.75 - 0.42 + 0.36, -q.y - 0.62));
        d = Math.abs(Math.min(h, sdSegment(q, new V2(0, -0.6), new V2(0.56, 0.12)) < 0.02 ? h : h)) - t * 0.6;
        const tri = Math.max(Math.abs(p.x) * 1.1 + (p.y + 0.15) * -0.9 - 0.62, p.y + 0.15 - 0.3);
        d = Math.abs(Math.min(sdCircle(q, new V2(0.3, 0.32), 0.34), tri)) - t * 0.6;
        break;
      }
      case 2: { // smiley
        d = Math.abs(p.magnitude - 0.72) - t * 0.6;
        d = Math.min(d, sdCircle(p, new V2(-0.25, 0.2), 0.09), sdCircle(p, new V2(0.25, 0.2), 0.09));
        const ang = Math.atan2(p.y + 0.05, p.x);
        if (ang < -0.5 && ang > -2.64) d = Math.min(d, Math.abs(Math.hypot(p.x, p.y + 0.05) - 0.42) - t * 0.55);
        break;
      }
      case 3: { // flower
        for (let i = 0; i < 5; i++) { const a = i * Math.PI * 0.4; d = Math.min(d, Math.abs(sdCircle(p, new V2(Math.cos(a) * 0.42, Math.sin(a) * 0.42), 0.26)) - t * 0.5); }
        d = Math.min(d, sdCircle(p, V2.zero, 0.16));
        break;
      }
      case 4: { // lightning bolt
        const pts = [new V2(0.2, 0.8), new V2(-0.3, 0.05), new V2(0.1, 0.05), new V2(-0.2, -0.8)];
        for (let i = 0; i < 3; i++) d = Math.min(d, sdSegment(p, pts[i], pts[i + 1]) - t * 0.65);
        break;
      }
      case 5: { // spiral
        const r = p.magnitude, a = Math.atan2(p.y, p.x);
        const turn = (r / 0.75) * 2.5 - a / (Math.PI * 2);
        const f = Math.abs(turn - Math.round(turn));
        d = r > 0.8 ? 1 : (f * 0.75 / 2.5) - t * 0.5;
        break;
      }
      case 6: { // cat face
        d = Math.abs(sdCircle(p, new V2(0, -0.08), 0.6)) - t * 0.55;
        d = Math.min(d, sdSegment(p, new V2(-0.5, 0.25), new V2(-0.45, 0.78)) - t * 0.5, sdSegment(p, new V2(-0.45, 0.78), new V2(-0.15, 0.48)) - t * 0.5);
        d = Math.min(d, sdSegment(p, new V2(0.5, 0.25), new V2(0.45, 0.78)) - t * 0.5, sdSegment(p, new V2(0.45, 0.78), new V2(0.15, 0.48)) - t * 0.5);
        d = Math.min(d, sdCircle(p, new V2(-0.2, 0.0), 0.07), sdCircle(p, new V2(0.2, 0.0), 0.07), sdCircle(p, new V2(0, -0.2), 0.05));
        for (const sx of [-1, 1]) d = Math.min(d, sdSegment(p, new V2(sx * 0.18, -0.25), new V2(sx * 0.75, -0.18)) - t * 0.25);
        break;
      }
      default: { // sun
        d = Math.abs(p.magnitude - 0.36) - t * 0.55;
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; d = Math.min(d, sdSegment(p, V2.fromAngle(a, 0.52), V2.fromAngle(a, 0.8)) - t * 0.45); }
      }
    }
    return new Color(1, 1, 1, fill(d, px));
  });
}
export const DoodleCount = 8;

export const InkDrop = () => CasualArt.make("db-ink", 64, 64, (p) => {
  const px = 2 / 64;
  const q = new V2(p.x, p.y + 0.15);
  const drop = Math.min(sdCircle(q, V2.zero, 0.55), Math.max(Math.abs(q.x) * 1.4 + q.y * 0.7 - 0.62 * 1.0, -q.y));
  let c = Color.clear;
  c = over(c, Color.white, fill(drop, px));
  c = over(c, new Color(1, 1, 1, 0.0), 0);
  return c;
});

export const CoinSprite = () => CasualArt.make("db-coin", 64, 64, (p) => {
  const px = 2 / 64;
  let c = Color.clear;
  const r = p.magnitude;
  c = over(c, Pal.hex(0xb07a10), fill(r - 0.92, px));
  c = over(c, Color.lerp(Pal.hex(0xffb020), Pal.hex(0xffe58a), smooth(-0.8, 0.8, p.y - p.x * 0.3)), fill(r - 0.8, px));
  c = over(c, Pal.hex(0xd09018), fill(Math.abs(r - 0.55) - 0.05, px));
  return c;
});

/** Soft paper card behind the board (a sheet torn from a notebook). */
export const SheetShadow = () => CasualArt.make("db-sheet-shadow", 64, 64, (p) => new Color(0, 0, 0, smooth(1, 0.6, Math.max(Math.abs(p.x), Math.abs(p.y))) * 0.5));

export const Panel = () => CasualArt.make("db-panel", 96, 96, (p) => new Color(1, 1, 1, fill(sdBox(p, new V2(0.96, 0.96), 0.4), 2 / 96)), 36, 100);
