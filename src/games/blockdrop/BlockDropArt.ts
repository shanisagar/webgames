import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";

/** Procedural sprites for BLOCK DROP: glossy candy-jelly blocks, the well, the ghost and touch-button icons. */

/** Candy colours by piece kind (index 0 unused, 8 = garbage). */
export const KindColors = [
  Color.clear,
  Pal.hex(0xff4f6b), // I cherry
  Pal.hex(0xffd23f), // O lemon
  Pal.hex(0x9a5cff), // T grape
  Pal.hex(0x8be04e), // S lime
  Pal.hex(0xff8a3d), // Z tangerine
  Pal.hex(0x3d6bff), // J blueberry
  Pal.hex(0x31e6c4), // L mint
  Pal.hex(0x5d5a80), // garbage
];

export const P1Color = Pal.hex(0x4cc3ff);
export const P2Color = Pal.hex(0xff5fa8);
export const Gold = Pal.hex(0xffd23f);
export const Ink = Pal.hex(0x1a0f3d);

export const BlockDropArt = {
  /** A glossy rounded candy block (white, tinted by kind). */
  get Block() {
    return CasualArt.make("bd-block", 96, 96, (p) => {
      const px = 2 / 96;
      const d = CasualArt.sdBox(p, new V2(0.94, 0.94), 0.3);
      const a = CasualArt.fill(d, px);
      if (a <= 0) return Color.clear;
      // body: lighter top, darker bottom
      let v = Mathf.lerp(0.7, 0.93, CasualArt.smooth(-1, 0.9, p.y));
      // bevel rim
      const rim = CasualArt.smooth(-0.2, -0.02, d);
      const lightDir = (p.y - p.x) * 0.5;
      v = Mathf.lerp(v, lightDir > 0 ? 1.0 : 0.62, rim * Math.min(1, Math.abs(lightDir) * 2.2));
      // inner gloss pill near the top
      const g = CasualArt.sdBox(p.sub(new V2(-0.08, 0.5)), new V2(0.55, 0.16), 0.16);
      const gloss = CasualArt.fill(g, px * 3) * CasualArt.smooth(0.2, 0.62, p.y) * 0.85;
      // sparkle dot
      const dot = CasualArt.fill(CasualArt.sdCircle(p, new V2(0.55, 0.52), 0.09), px);
      let c = new Color(v, v, v, 1);
      c = Color.lerp(c, Color.white, gloss * 0.75);
      c = Color.lerp(c, new Color(2, 2, 2, 1), dot * 0.9);
      return new Color(Math.min(1, c.r), Math.min(1, c.g), Math.min(1, c.b), a);
    });
  },

  /** White overlay used to flash cells (line clears, locks). */
  get Flash() {
    return CasualArt.make("bd-flash", 64, 64, (p) => new Color(1, 1, 1, CasualArt.fill(CasualArt.sdBox(p, new V2(0.94, 0.94), 0.3), 2 / 64)));
  },

  /** Ghost: rounded outline with a faint fill. */
  get Ghost() {
    return CasualArt.make("bd-ghost", 96, 96, (p) => {
      const px = 2 / 96;
      const d = CasualArt.sdBox(p, new V2(0.9, 0.9), 0.3);
      const edge = CasualArt.fill(Math.abs(d + 0.07) - 0.07, px);
      const inside = CasualArt.fill(d, px) * 0.18;
      return new Color(1, 1, 1, Math.max(edge, inside));
    });
  },

  /** Empty cell in the well: a soft rounded dimple. */
  get Cell() {
    return CasualArt.make("bd-cell", 64, 64, (p) => {
      const d = CasualArt.sdBox(p, new V2(0.86, 0.86), 0.32);
      const a = CasualArt.fill(d, 2 / 64);
      const v = Mathf.lerp(0.75, 1, CasualArt.smooth(1, -1, p.y));
      return new Color(v, v, v, a);
    });
  },

  /** The well panel for a 10.8 × 20.8 frame (aspect baked in so corners stay round). */
  get Well() {
    const w = 108, h = 208;
    return CasualArt.make("bd-well", w, h, (p) => {
      const hy = h / w;
      const d = CasualArt.sdBox(p, new V2(0.99, hy - 0.01), 0.07);
      const a = CasualArt.fill(d, 2 / w);
      const v = Mathf.lerp(0.85, 1, CasualArt.smooth(-hy, hy, p.y));
      return new Color(v, v, v, a);
    });
  },

  /** Neon frame outline for the well (same aspect as Well). */
  get WellEdge() {
    const w = 108, h = 208;
    return CasualArt.make("bd-welledge", w, h, (p) => {
      const hy = h / w;
      const d = CasualArt.sdBox(p, new V2(0.99, hy - 0.01), 0.07);
      return new Color(1, 1, 1, CasualArt.fill(Math.abs(d + 0.015) - 0.012, 2 / w));
    });
  },

  /** Rounded panel for hold / next boxes. */
  get Box() {
    return CasualArt.make("bd-box", 96, 96, (p) => {
      const d = CasualArt.sdBox(p, new V2(0.97, 0.97), 0.28);
      const a = CasualArt.fill(d, 2 / 96);
      const edge = CasualArt.fill(Math.abs(d + 0.03) - 0.025, 2 / 96);
      const v = Mathf.lerp(0.55, 0.7, CasualArt.smooth(-1, 1, p.y));
      const c = Color.lerp(new Color(v, v, v, 1), Color.white, edge);
      return c.withAlpha(a);
    });
  },

  /** Background: candy-night gradient. */
  get Backdrop() { return CasualArt.gradient(Pal.hex(0x3a1c78), Pal.hex(0x120a30), new Color(1, 0.45, 0.8, 0.35)); },

  /** Soft bokeh ball. */
  get Bokeh() {
    return CasualArt.make("bd-bokeh", 64, 64, (p) => {
      const r = p.magnitude;
      const a = CasualArt.smooth(0.95, 0.75, r) * (0.55 + 0.45 * CasualArt.smooth(0.9, 0.3, r));
      return new Color(1, 1, 1, a);
    });
  },

  /** Vertical streak for hard drops. */
  get Streak() {
    return CasualArt.make("bd-streak", 16, 128, (p) => {
      const h = 8;
      const t = (h - p.y) / (2 * h);
      const a = CasualArt.smooth(1, 0.6, Math.abs(p.x)) * t * t;
      return new Color(1, 1, 1, a);
    });
  },

  /** Garbage meter bar (rounded, tall). */
  get Bar() {
    return CasualArt.make("bd-bar", 16, 64, (p) => new Color(1, 1, 1, CasualArt.fill(CasualArt.sdBox(p, new V2(0.9, 3.9), 0.8), 2 / 16)));
  },

  // ------------------------------------------------------------------ touch button icons

  get IconLeft() { return arrowIcon("bd-i-left", Math.PI); },
  get IconRight() { return arrowIcon("bd-i-right", 0); },
  get IconDown() { return arrowIcon("bd-i-down", -Math.PI / 2); },
  get IconDrop() {
    return CasualArt.make("bd-i-drop", 64, 64, (p) => {
      const c1 = chevron(new V2(p.x, p.y - 0.3));
      const c2 = chevron(new V2(p.x, p.y + 0.18));
      const bar = CasualArt.sdBox(p.sub(new V2(0, -0.72)), new V2(0.62, 0.09), 0.08);
      return new Color(1, 1, 1, CasualArt.fill(Math.min(c1, c2, bar), 3 / 64));
    });
  },
  get IconCW() { return rotIcon("bd-i-cw2", -1); },
  get IconCCW() { return rotIcon("bd-i-ccw2", 1); },
  get IconHold() {
    return CasualArt.make("bd-i-hold", 64, 64, (p) => {
      const outer = CasualArt.sdBox(p, new V2(0.8, 0.8), 0.25);
      const ring = Math.abs(outer) - 0.08;
      const inner = CasualArt.sdBox(p, new V2(0.32, 0.32), 0.08);
      return new Color(1, 1, 1, CasualArt.fill(Math.min(ring, inner), 3 / 64));
    });
  },
};

function chevron(p: V2) {
  // downward chevron centred on the origin
  const a = CasualArt.sdSegment(p, new V2(-0.55, 0.2), new V2(0, -0.3));
  const b = CasualArt.sdSegment(p, new V2(0.55, 0.2), new V2(0, -0.3));
  return Math.min(a, b) - 0.12;
}

function arrowIcon(key: string, angle: number) {
  return CasualArt.make(key, 64, 64, (p) => {
    const c = Math.cos(-angle), s = Math.sin(-angle);
    const q = new V2(p.x * c - p.y * s, p.x * s + p.y * c); // rotate into "pointing right"
    const shaft = CasualArt.sdSegment(q, new V2(-0.6, 0), new V2(0.35, 0)) - 0.13;
    const h1 = CasualArt.sdSegment(q, new V2(0.62, 0), new V2(0.12, 0.48)) - 0.13;
    const h2 = CasualArt.sdSegment(q, new V2(0.62, 0), new V2(0.12, -0.48)) - 0.13;
    return new Color(1, 1, 1, CasualArt.fill(Math.min(shaft, h1, h2), 3 / 64));
  });
}

function rotIcon(key: string, dir: number) {
  // 270° arc with an arrow head; dir 1 = clockwise, -1 = counter-clockwise (mirrored)
  return CasualArt.make(key, 64, 64, (p) => {
    const q = new V2(p.x * dir, p.y);
    const r = q.magnitude, ang = Math.atan2(q.y, q.x);
    const a0 = 1.75; // the arc ends at the top; the gap spans a0..2.9 rad
    let d = 1;
    if (!(ang > a0 && ang < 2.9)) d = Math.abs(r - 0.52) - 0.13;
    // arrow head at the start of the gap, pointing clockwise (down the tangent)
    const tip = V2.fromAngle(a0, 0.52), t = new V2(Math.sin(a0), -Math.cos(a0)), n = new V2(Math.cos(a0), Math.sin(a0));
    const a = tip.add(n.mul(0.32)).sub(t.mul(0.12)), b = tip.sub(n.mul(0.32)).sub(t.mul(0.12)), c = tip.add(t.mul(0.36));
    const inTri = triSd(q, a, b, c);
    d = Math.min(d, inTri);
    return new Color(1, 1, 1, CasualArt.fill(d, 3 / 64));
  });
}

/** Signed distance-ish (negative inside) to a triangle. */
function triSd(p: V2, a: V2, b: V2, c: V2) {
  const e = (u: V2, v: V2) => { const ex = v.x - u.x, ey = v.y - u.y; return ((p.x - u.x) * ey - (p.y - u.y) * ex) / Math.hypot(ex, ey); };
  const s = Math.sign(e(a, b) + e(b, c) + e(c, a)) || 1;
  return Math.max(-e(a, b) * s, -e(b, c) * s, -e(c, a) * s);
}
