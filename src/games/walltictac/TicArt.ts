import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";

/** Procedural chalkboard sprites for BALL TIC-TAC-TOE: board, chalk strokes, chalky X and O, dust splats. */

export const XColor = Pal.hex(0x5ad1ff);
export const OColor = Pal.hex(0xff6fae);
export const ChalkWhite = Pal.hex(0xf4f1e6);
export const Gold = Pal.hex(0xffd24a);
export const Slate = Pal.hex(0x1f3b33);
export const Wood = Pal.hex(0x8a5a32);

/** Cheap value noise for chalk grain. */
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return Mathf.lerp(Mathf.lerp(a, b, ux), Mathf.lerp(c, d, ux), uy);
}
/** Chalk coverage: solid stroke broken up by grain. */
function chalk(inside: number, p: V2, scale = 18) {
  if (inside <= 0) return 0;
  const g = vnoise(p.x * scale, p.y * scale) * 0.6 + hash(p.x * 97, p.y * 89) * 0.4;
  return inside * Mathf.clamp01(0.35 + g * 1.1);
}

export const TicArt = {
  /** Slate chalkboard with smudges (16:9 cover). */
  get Board() {
    return CasualArt.make("tt-board", 256, 144, (p) => {
      const n = vnoise(p.x * 3 + 10, p.y * 3) * 0.6 + vnoise(p.x * 9, p.y * 9 + 4) * 0.4;
      const smudge = vnoise(p.x * 1.4 + 3, p.y * 2.2) ;
      let c = Color.lerp(Pal.hex(0x17302a), Pal.hex(0x2a4d43), n * 0.7 + smudge * 0.3);
      const vign = Math.min(1, Math.hypot(p.x * 0.9, p.y * 1.4));
      c = Color.lerp(c, Pal.hex(0x0c1a16), CasualArt.smooth(0.55, 1.1, vign) * 0.7);
      return c.withAlpha(1);
    });
  },

  /** A long chalk stroke (8:1), drawn horizontally. */
  get Stroke() {
    return CasualArt.make("tt-stroke", 512, 64, (p) => {
      const hy = 64 / 512;
      const wob = Math.sin(p.x * 5.3) * 0.012 + Math.sin(p.x * 13 + 1) * 0.006;
      const half = 0.07 * hy * 8 * (0.85 + 0.15 * Math.sin(p.x * 3 + 2));
      const ends = CasualArt.smooth(1, 0.94, Math.abs(p.x));
      const d = Math.abs(p.y - wob) - half;
      return new Color(1, 1, 1, chalk(CasualArt.fill(d, 2 / 512) * ends, p, 40));
    });
  },

  /** Chalky X (white, tinted). */
  get X() {
    return CasualArt.make("tt-x", 256, 256, (p) => {
      const w = 0.15;
      const a = CasualArt.sdSegment(p, new V2(-0.62, 0.66), new V2(0.64, -0.6)) - w * (0.9 + 0.1 * Math.sin(p.x * 9));
      const b = CasualArt.sdSegment(p, new V2(0.6, 0.64), new V2(-0.66, -0.62)) - w * (0.9 + 0.1 * Math.cos(p.y * 8));
      return new Color(1, 1, 1, chalk(CasualArt.fill(Math.min(a, b), 2 / 256), p, 22));
    });
  },

  /** Chalky O. */
  get O() {
    return CasualArt.make("tt-o", 256, 256, (p) => {
      const ang = Math.atan2(p.y, p.x);
      const r = 0.6 + 0.03 * Math.sin(ang * 3 + 1);
      const d = Math.abs(p.magnitude - r) - 0.14 * (0.9 + 0.1 * Math.sin(ang * 5));
      return new Color(1, 1, 1, chalk(CasualArt.fill(d, 2 / 256), p, 22));
    });
  },

  /** Chalk dust splat behind a claimed mark. */
  get Dust() {
    return CasualArt.make("tt-dust", 128, 128, (p) => {
      const a = Math.atan2(p.y, p.x), r = p.magnitude;
      const edge = 0.62 + 0.14 * Math.sin(a * 7 + 0.4) + 0.08 * Math.sin(a * 13);
      let d = r - edge;
      for (let i = 0; i < 9; i++) {
        const da = i * 0.71 + 0.2, dr = 0.82 + (i % 3) * 0.05;
        d = Math.min(d, CasualArt.sdCircle(p, new V2(Math.cos(da) * dr, Math.sin(da) * dr), 0.05 + (i % 2) * 0.03));
      }
      const soft = CasualArt.smooth(0.05, -0.25, d);
      return new Color(1, 1, 1, chalk(soft, p, 14) * 0.7);
    });
  },

  /** Wooden frame bar (horizontal, 16:1). */
  get Frame() {
    return CasualArt.make("tt-frame", 512, 32, (p) => {
      const hy = 32 / 512;
      const grain = Math.sin(p.x * 40 + Math.sin(p.x * 7) * 3) * 0.5 + 0.5;
      const v = Mathf.lerp(0.75, 1, CasualArt.smooth(-hy, hy, p.y)) * (0.88 + 0.12 * grain);
      const bevel = CasualArt.smooth(hy * 0.6, hy, Math.abs(p.y));
      const c = Color.lerp(new Color(v, v, v, 1), new Color(0.5, 0.5, 0.5, 1), bevel * 0.6);
      return c.withAlpha(1);
    });
  },

  /** Round avatar plate for the side panels. */
  get Plate() {
    return CasualArt.make("tt-plate", 128, 128, (p) => CasualArt.ballPixel(p, Color.white, 2 / 128, 0.95));
  },
};
