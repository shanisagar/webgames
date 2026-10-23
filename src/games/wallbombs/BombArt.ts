import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";

/** Procedural cartoon sprites for BOMB DEFUSE: glossy bombs, fuse cap, BOOM burst, soot, scissors, brick wall. */

export const P1Color = Pal.hex(0x3aa8ff);
export const P2Color = Pal.hex(0xff7a2f);
export const Gold = Pal.hex(0xffcf3a);
export const Ink = Pal.hex(0x1c1430);
export const FuseColor = Pal.hex(0xc9a36b);

export const BombArt = {
  /** Round cartoon bomb body (white, tinted), with a bold dark outline and a shine. */
  get Body() {
    return CasualArt.make("bd2-body", 160, 160, (p) => {
      const px = 2 / 160;
      const r = p.magnitude;
      const outer = CasualArt.fill(r - 0.94, px);
      if (outer <= 0) return Color.clear;
      const inner = CasualArt.fill(r - 0.84, px);
      const shade = CasualArt.ballPixel(p, Color.white, px, 0.84);
      let c = Color.lerp(new Color(0.08, 0.06, 0.12, 1), shade.withAlpha(1), inner);
      const shine = CasualArt.fill(CasualArt.sdCircle(new V2(p.x * 0.8, p.y * 1.25), new V2(-0.28, 0.45), 0.16), px * 2);
      c = Color.lerp(c, new Color(1, 1, 1, 1), shine * 0.9);
      return c.withAlpha(outer);
    });
  },

  /** Metal bands for two-hit bombs. */
  get Bands() {
    return CasualArt.make("bd2-bands", 160, 160, (p) => {
      const px = 2 / 160;
      const r = p.magnitude;
      if (r > 0.86) return Color.clear;
      const band = Math.min(Math.abs(p.y - 0.18) - 0.07, Math.abs(p.y + 0.3) - 0.07);
      const a = CasualArt.fill(band, px) * CasualArt.fill(r - 0.85, px);
      const rivet = Math.min(CasualArt.sdCircle(p, new V2(-0.45, 0.18), 0.05), CasualArt.sdCircle(p, new V2(0.45, 0.18), 0.05), CasualArt.sdCircle(p, new V2(0, -0.3), 0.05));
      const v = Mathf.lerp(0.55, 0.85, CasualArt.smooth(-0.3, 0.3, p.y + p.x * 0.3));
      const c = Color.lerp(new Color(v, v, v * 1.05, 1), new Color(0.3, 0.3, 0.35, 1), CasualArt.fill(rivet, px));
      return c.withAlpha(Math.max(a, CasualArt.fill(rivet, px) * CasualArt.fill(r - 0.85, px)));
    });
  },

  /** The fuse cap (a little dark cylinder seen from the side). */
  get Cap() {
    return CasualArt.make("bd2-cap", 64, 64, (p) => {
      const px = 2 / 64;
      const d = CasualArt.sdBox(p, new V2(0.62, 0.48), 0.12);
      const a = CasualArt.fill(d, px);
      const inner = CasualArt.fill(d + 0.14, px);
      const v = Mathf.lerp(0.22, 0.45, CasualArt.smooth(-0.5, 0.5, p.x * -0.6 + p.y));
      return Color.lerp(new Color(0.06, 0.05, 0.08, 1), new Color(v, v, v * 1.1, 1), inner).withAlpha(a);
    });
  },

  /** Comic BOOM burst (jagged star). */
  get Burst() {
    return CasualArt.make("bd2-burst", 256, 256, (p) => {
      const px = 2 / 256;
      const a = Math.atan2(p.y, p.x), r = p.magnitude;
      const spikes = 0.72 + 0.22 * Math.pow(Math.abs(Math.sin(a * 6 + 0.3)), 0.6) + 0.04 * Math.sin(a * 17);
      const d = r - spikes;
      const fill = CasualArt.fill(d, px);
      if (fill <= 0) return Color.clear;
      const edge = CasualArt.fill(d + 0.07, px);
      const core = CasualArt.smooth(0.75, 0.1, r / spikes);
      const body = Color.lerp(Pal.hex(0xff8a1f), Pal.hex(0xfff06a), core);
      return Color.lerp(Pal.hex(0xc8102e), body, edge).withAlpha(fill);
    });
  },

  /** Soot splat left on the wall by an explosion. */
  get Soot() {
    return CasualArt.make("bd2-soot", 160, 160, (p) => {
      const a = Math.atan2(p.y, p.x), r = p.magnitude;
      const edge = 0.6 + 0.16 * Math.sin(a * 7 + 1) + 0.08 * Math.sin(a * 15 + 2);
      let d = r - edge;
      for (let i = 0; i < 10; i++) {
        const da = i * 0.63 + 0.3, dr = 0.8 + (i % 3) * 0.06;
        d = Math.min(d, CasualArt.sdCircle(p, new V2(Math.cos(da) * dr, Math.sin(da) * dr), 0.04 + (i % 2) * 0.04));
      }
      const soft = CasualArt.smooth(0.04, -0.3, d);
      return new Color(1, 1, 1, soft * (0.75 + 0.25 * CasualArt.smooth(0.6, 0, r)));
    });
  },

  /** Scissors icon (how-to and the snip pop). */
  get Snip() {
    return CasualArt.make("bd2-snip", 96, 96, (p) => {
      const px = 3 / 96;
      const b1 = CasualArt.sdSegment(p, new V2(-0.15, -0.05), new V2(0.75, 0.6)) - 0.09;
      const b2 = CasualArt.sdSegment(p, new V2(-0.15, 0.05), new V2(0.75, -0.6)) - 0.09;
      const r1 = Math.abs(CasualArt.sdCircle(p, new V2(-0.5, 0.35), 0.22)) - 0.07;
      const r2 = Math.abs(CasualArt.sdCircle(p, new V2(-0.5, -0.35), 0.22)) - 0.07;
      return new Color(1, 1, 1, CasualArt.fill(Math.min(b1, b2, r1, r2), px));
    });
  },

  /** Brick wall backdrop (16:9 cover). */
  get Wall() {
    return CasualArt.make("bd2-wall", 256, 144, (p) => {
      const x = (p.x + 1) * 8, y = (p.y + 0.5625) * 8;
      const row = Math.floor(y);
      const bx = x + (row % 2) * 0.5;
      const fx = bx - Math.floor(bx), fy = y - row;
      const mortar = Math.min(fx, 1 - fx) * 2 < 0.06 || Math.min(fy, 1 - fy) < 0.05;
      const hsh = Math.sin(Math.floor(bx) * 12.9 + row * 78.2) * 43758.5;
      const tone = hsh - Math.floor(hsh);
      let c = mortar ? Pal.hex(0x2b2140) : Color.lerp(Pal.hex(0x5a2f52), Pal.hex(0x7a3b5e), tone);
      const vign = Math.hypot(p.x * 0.9, p.y * 1.5);
      c = Color.lerp(c, Pal.hex(0x140a22), CasualArt.smooth(0.4, 1.1, vign) * 0.75);
      return c.withAlpha(1);
    });
  },
};
