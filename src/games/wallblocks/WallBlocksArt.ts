import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";

/** Procedural sprites for BLOCK DROP WALL: LCD-style bricks on a pocket brick-game console, ghost, hint icons. */

export const P1Color = Pal.hex(0x2fb8ff);
export const P2Color = Pal.hex(0xff4f8b);
export const Gold = Pal.hex(0xffd23f);
export const Ink = Pal.hex(0x1f2a1c);
export const LcdColor = Pal.hex(0xc9d99a);
export const JunkColor = Pal.hex(0x6b7466);
export const Night = Pal.hex(0x160b3a);

function triSd(p: V2, a: V2, b: V2, c: V2) {
  const e = (u: V2, v: V2) => { const ex = v.x - u.x, ey = v.y - u.y; return ((p.x - u.x) * ey - (p.y - u.y) * ex) / Math.hypot(ex, ey); };
  const s = Math.sign(e(a, b) + e(b, c) + e(c, a)) || 1;
  return Math.max(-e(a, b) * s, -e(b, c) * s, -e(c, a) * s);
}

export const WallBlocksArt = {
  /** The classic brick-game pixel: a square frame with a solid square inside. */
  get Brick() {
    return CasualArt.make("wb-brick", 96, 96, (p) => {
      const px = 2 / 96;
      const outer = CasualArt.sdBox(p, new V2(0.9, 0.9), 0.1);
      const frame = Math.max(outer, -CasualArt.sdBox(p, new V2(0.68, 0.68), 0.04));
      const inner = CasualArt.sdBox(p, new V2(0.46, 0.46), 0.04);
      const a = Math.max(CasualArt.fill(frame, px), CasualArt.fill(inner, px));
      // a light top-left sheen so lit bricks read as solid from far away
      const sheen = CasualArt.smooth(-0.2, 0.9, p.y - p.x * 0.3) * 0.18;
      const v = 1 - 0.12 * CasualArt.smooth(0.6, -0.9, p.y) + sheen;
      return new Color(Math.min(1, v), Math.min(1, v), Math.min(1, v), a);
    });
  },

  /** Lit brick for the falling piece: a solid block with a raised inner square (reads from the back of a crowd). */
  get Lit() {
    return CasualArt.make("wb-lit", 96, 96, (p) => {
      const px = 2 / 96;
      const outer = CasualArt.sdBox(p, new V2(0.94, 0.94), 0.12);
      const a = CasualArt.fill(outer, px);
      if (a <= 0) return Color.clear;
      let v = Mathf.lerp(0.78, 0.95, CasualArt.smooth(-1, 1, p.y));
      const rim = CasualArt.smooth(-0.14, -0.03, outer);
      v = Mathf.lerp(v, p.y - p.x > 0 ? 1.12 : 0.6, rim * 0.8);
      const groove = CasualArt.fill(Math.abs(CasualArt.sdBox(p, new V2(0.55, 0.55), 0.06)) - 0.05, px);
      v = Mathf.lerp(v, 0.55, groove * 0.7);
      const inner = CasualArt.fill(CasualArt.sdBox(p, new V2(0.48, 0.48), 0.05), px);
      v = Mathf.lerp(v, 1.08 - 0.12 * CasualArt.smooth(0.5, -0.5, p.y), inner * 0.9);
      v = Math.min(1, v);
      return new Color(v, v, v, a);
    });
  },

  /** Junk brick: frame with a diagonal hatch. */
  get JunkBrick() {
    return CasualArt.make("wb-junk", 96, 96, (p) => {
      const px = 2 / 96;
      const outer = CasualArt.sdBox(p, new V2(0.9, 0.9), 0.1);
      const frame = Math.max(outer, -CasualArt.sdBox(p, new V2(0.68, 0.68), 0.04));
      const inner = CasualArt.sdBox(p, new V2(0.5, 0.5), 0.04);
      const hatch = Math.abs(((p.x + p.y) * 2.2 + 100) % 1 - 0.5) - 0.22;
      const a = Math.max(CasualArt.fill(frame, px), CasualArt.fill(Math.max(inner, hatch / 2.2), px));
      return new Color(1, 1, 1, a);
    });
  },

  /** Unlit LCD pixel (the faint grid of the well). */
  get OffCell() {
    return CasualArt.make("wb-off", 64, 64, (p) => {
      const px = 2 / 64;
      const outer = CasualArt.sdBox(p, new V2(0.9, 0.9), 0.1);
      const frame = Math.max(outer, -CasualArt.sdBox(p, new V2(0.68, 0.68), 0.04));
      const inner = CasualArt.sdBox(p, new V2(0.46, 0.46), 0.04);
      return new Color(1, 1, 1, Math.max(CasualArt.fill(frame, px), CasualArt.fill(inner, px)));
    });
  },

  /** Chunky ghost: thick rounded outline. */
  get Ghost() {
    return CasualArt.make("wb-ghost", 96, 96, (p) => {
      const px = 2 / 96;
      const d = CasualArt.sdBox(p, new V2(0.86, 0.86), 0.18);
      const edge = CasualArt.fill(Math.abs(d + 0.13) - 0.13, px);
      return new Color(1, 1, 1, Math.max(edge, CasualArt.fill(d, px) * 0.22));
    });
  },

  /** Console shell (15 × 18.2 cells): glossy rounded plastic, white (tinted per player). */
  get Shell() {
    const w = 300, h = 364;
    return CasualArt.make("wb-shell", w, h, (p) => {
      const hy = h / w, px = 2 / w;
      const d = CasualArt.sdBox(p, new V2(0.99, hy - 0.01), 0.14);
      const a = CasualArt.fill(d, px);
      if (a <= 0) return Color.clear;
      let v = Mathf.lerp(0.78, 1, CasualArt.smooth(-hy, hy * 0.6, p.y));
      const rim = CasualArt.smooth(-0.06, -0.005, d);
      v = Mathf.lerp(v, 0.62, rim * 0.8);
      const lip = CasualArt.smooth(-0.1, -0.04, d) * (1 - rim);
      v = Mathf.lerp(v, 1.08, lip * CasualArt.smooth(0, 1, p.y / hy) * 0.6);
      // big soft gloss stripe across the top-left
      const g = CasualArt.smooth(0.12, 0, Math.abs(p.x * 0.5 + p.y - hy * 0.72)) * CasualArt.smooth(-0.2, 0.6, -p.x);
      v = Math.min(1.1, v + g * 0.12);
      return new Color(Math.min(1, v), Math.min(1, v), Math.min(1, v), a);
    });
  },

  /** LCD glass (13 × 15 cells) with an inner shadow. */
  get Lcd() {
    const w = 260, h = 300;
    return CasualArt.make("wb-lcd", w, h, (p) => {
      const hy = h / w, px = 2 / w;
      const d = CasualArt.sdBox(p, new V2(0.99, hy - 0.01), 0.05);
      const a = CasualArt.fill(d, px);
      let v = 1 - 0.07 * CasualArt.smooth(-hy, hy, p.y);
      v -= 0.22 * CasualArt.smooth(-0.07, 0, d);
      v -= 0.1 * CasualArt.smooth(-0.14, -0.02, d) * CasualArt.smooth(0, hy, p.y);
      return new Color(v, v, v, a);
    });
  },

  /** Dark bezel ring around the LCD. */
  get Bezel() {
    const w = 280, h = 320;
    return CasualArt.make("wb-bezel", w, h, (p) => {
      const hy = h / w, px = 2 / w;
      const d = CasualArt.sdBox(p, new V2(0.99, hy - 0.01), 0.1);
      const v = Mathf.lerp(0.2, 0.32, CasualArt.smooth(-hy, hy, p.y));
      return new Color(v, v, v * 1.15, CasualArt.fill(d, px));
    });
  },

  /** Chevron pointing right (hint: hit here to push the piece this way). */
  get Push() {
    return CasualArt.make("wb-push", 64, 64, (p) => {
      const d = Math.min(CasualArt.sdSegment(p, new V2(-0.35, 0.6), new V2(0.35, 0)), CasualArt.sdSegment(p, new V2(-0.35, -0.6), new V2(0.35, 0))) - 0.17;
      return new Color(1, 1, 1, CasualArt.fill(d, 3 / 64));
    });
  },

  /** Circular arrow (hint: hit the top to rotate). */
  get Turn() {
    return CasualArt.make("wb-turn", 64, 64, (p) => {
      const r = p.magnitude, ang = Math.atan2(p.y, p.x);
      let d = 1;
      if (!(ang > 1.2 && ang < 2.4)) d = Math.abs(r - 0.55) - 0.14;
      const a0 = 1.2;
      const tip = V2.fromAngle(a0, 0.55), t = new V2(Math.sin(a0), -Math.cos(a0)), n = new V2(Math.cos(a0), Math.sin(a0));
      const tri = triSd(p, tip.add(n.mul(0.34)).sub(t.mul(0.05)), tip.sub(n.mul(0.34)).sub(t.mul(0.05)), tip.sub(t.mul(-0.38)).add(t.mul(0)));
      d = Math.min(d, tri);
      return new Color(1, 1, 1, CasualArt.fill(d, 3 / 64));
    });
  },

  /** Double chevron down (hint: hit under the piece to slam it). */
  get Slam() {
    return CasualArt.make("wb-slam", 64, 64, (p) => {
      const c = (q: V2) => Math.min(CasualArt.sdSegment(q, new V2(-0.55, 0.25), new V2(0, -0.2)), CasualArt.sdSegment(q, new V2(0.55, 0.25), new V2(0, -0.2))) - 0.13;
      return new Color(1, 1, 1, CasualArt.fill(Math.min(c(p.sub(new V2(0, 0.32))), c(p.add(new V2(0, 0.25)))), 3 / 64));
    });
  },

  /** Round console button. */
  get Button() {
    return CasualArt.make("wb-button", 64, 64, (p) => CasualArt.ballPixel(p, Color.white, 2 / 64, 0.9));
  },

  /** Backdrop: violet arcade night. */
  get Backdrop() { return CasualArt.gradient(Pal.hex(0x3b1d8f), Pal.hex(0x12082e), new Color(1, 0.4, 0.75, 0.35)); },
};
