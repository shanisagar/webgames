import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";

/**
 * Procedural art for Bolt Jam: wooden planks with drilled holes (white grain, tinted per plank), screw heads
 * with a cross slot (tinted per colour), little paint-tin boxes that take three screws, the pegboard wall and the
 * workbench. (Port of BoltJamArt.cs.)
 */

const Clear = new Color(1, 1, 1, 0);
const Thick = 0.82; // plank width in world units
const Lengths = [2.4, 3.2, 4.0, 4.8, 5.6];

export const BoltJamArt = {
  Colors: 6,
  Thick,
  Lengths,

  Tint: [Pal.hex(0xf24e5c), Pal.hex(0x3f8cff), Pal.hex(0xffc93c), Pal.hex(0x4cc86a), Pal.hex(0xa56bff), Pal.hex(0xff8a30)],

  PlankTint: [Pal.hex(0xf6b58c), Pal.hex(0x9cc9f7), Pal.hex(0xf7de8e), Pal.hex(0xa8e0a0), Pal.hex(0xd2b6f5), Pal.hex(0xf5c08a), Pal.hex(0xe9d2b0)],

  /** Hole offsets (along the plank, world units) for a plank length index. */
  Holes(lenIndex: number, middle: boolean): number[] {
    const half = Lengths[lenIndex] * 0.5 - 0.42;
    if (middle && lenIndex >= 2) return [-half, 0, half];
    return [-half, half];
  },

  /** Plank sprite: 1 world unit wide per (length) so set scale = length. Holes drawn for both patterns. */
  Plank(lenIndex: number, middle: boolean) {
    const L = Lengths[lenIndex];
    const w = Mathf.roundToInt(L * 110);
    const h = Mathf.roundToInt(Thick * 110);
    const holes = BoltJamArt.Holes(lenIndex, middle);
    return CasualArt.make(`bj-plank-${lenIndex}-${middle}`, w, h, (p) => {
      // p.x -1..1 = -L/2..L/2 ; convert to world units
      const k = L * 0.5;
      const u = p.mul(k);
      const px = (2 / w) * k;
      const d = CasualArt.sdBox(u, new V2(L * 0.5 - 0.02, Thick * 0.5 - 0.02), Thick * 0.38);
      const a = CasualArt.fill(d, px);
      if (a <= 0) return Clear;
      // grain
      const g = Math.sin(u.x * 3.1 + Math.sin(u.y * 9 + u.x * 0.7) * 1.6 + Mathf.perlinNoise(u.x * 1.3, u.y * 6) * 4);
      const grain = 0.88 + 0.08 * g;
      let c = new Color(grain, grain, grain, 1);
      // bevel: lighter top edge, darker bottom edge
      c = Color.lerp(c, Color.white, CasualArt.smooth(Thick * 0.25, Thick * 0.45, u.y) * CasualArt.fill(d + 0.02, px) * 0.5);
      c = Color.lerp(c, new Color(0.62, 0.62, 0.62, 1), CasualArt.smooth(-Thick * 0.25, -Thick * 0.48, u.y) * 0.6);
      c = Color.lerp(new Color(0.45, 0.45, 0.45, 1), c, CasualArt.fill(d + 0.035, px));
      for (const hx of holes) {
        const hd = u.sub(new V2(hx, 0)).magnitude - 0.2;
        c = Color.lerp(c, new Color(0.25, 0.22, 0.2, 1), CasualArt.fill(hd, px));
        const rim = Math.abs(hd - 0.02) - 0.02;
        c = Color.lerp(c, new Color(0.6, 0.6, 0.6, 1), CasualArt.fill(rim, px) * 0.6);
      }
      return c.withAlpha(a);
    });
  },

  /** Screw head (white-ish metal, tint it): cross slot and a bright rim. */
  get Screw() {
    return CasualArt.make("bj-screw", 96, 96, (p) => {
      const px = 2 / 96;
      let c = CasualArt.ballPixel(p, new Color(0.95, 0.95, 0.95, 1), px, 0.92);
      if (c.a <= 0) return c;
      const r = p.magnitude;
      c = Color.lerp(c, new Color(0.45, 0.45, 0.45, 1), CasualArt.smooth(0.78, 0.92, r) * 0.5);
      const q = new V2((p.x + p.y) * 0.7071, (p.y - p.x) * 0.7071);
      const slot = Math.min(CasualArt.sdBox(q, new V2(0.55, 0.09), 0.04), CasualArt.sdBox(q, new V2(0.09, 0.55), 0.04));
      c = Color.lerp(c, new Color(0.2, 0.2, 0.22, 1), CasualArt.fill(slot, px));
      const slotLight = Math.min(CasualArt.sdBox(q.sub(new V2(0.02, -0.06)), new V2(0.55, 0.03), 0.02), 9);
      c = Color.lerp(c, new Color(0.85, 0.85, 0.85, 1), CasualArt.fill(slotLight, px) * CasualArt.fill(-slot, px) * 0.4);
      return c;
    });
  },

  /** Screw thread (shown while the screw flies), pointing down. */
  get Thread() {
    return CasualArt.make("bj-thread", 48, 96, (p) => {
      const px = 2 / 48;
      let d = CasualArt.sdBox(p.sub(new V2(0, 0.1)), new V2(0.32, 1.6), 0.1);
      const tip = Math.max(Math.abs(p.x) - (p.y + 2) * 0.35, -(p.y + 1.95));
      d = Math.min(Math.max(d, -(p.y + 1.3)), Math.max(tip, p.y + 1.2));
      let c = Color.lerp(new Color(0.55, 0.57, 0.6, 1), new Color(0.9, 0.92, 0.95, 1), CasualArt.smooth(0.3, -0.2, p.x));
      const ridges = Math.sin((p.y + p.x * 0.4) * 18);
      c = Color.lerp(c, new Color(0.4, 0.42, 0.45, 1), CasualArt.smooth(0.4, 1, ridges) * 0.6);
      return c.withAlpha(CasualArt.fill(d, px));
    });
  },

  /** Paint-tin box that takes three screws (white, tint it): three sockets on top. */
  get Box() {
    return CasualArt.make("bj-box", 192, 112, (p) => {
      const px = 2 / 192;
      const d = CasualArt.sdBox(p, new V2(0.96, 0.54), 0.16);
      const a = CasualArt.fill(d, px);
      if (a <= 0) return Clear;
      let c = Color.lerp(new Color(0.78, 0.78, 0.78, 1), Color.white, CasualArt.smooth(-0.5, 0.5, p.y));
      c = Color.lerp(new Color(0.5, 0.5, 0.5, 1), c, CasualArt.fill(d + 0.04, px));
      const band = Math.abs(p.y + 0.3) - 0.05;
      c = Color.lerp(c, new Color(0.62, 0.62, 0.62, 1), CasualArt.fill(band, px) * 0.6);
      for (let i = -1; i <= 1; i++) {
        const s = CasualArt.sdCircle(p, new V2(i * 0.58, 0.08), 0.24);
        c = Color.lerp(c, new Color(0.3, 0.3, 0.32, 1), CasualArt.fill(s, px));
        const sr = Math.abs(s) - 0.025;
        c = Color.lerp(c, Color.white, CasualArt.fill(sr, px) * 0.5);
      }
      return c.withAlpha(a);
    });
  },

  /** A holding-tray socket. */
  get Socket() {
    return CasualArt.make("bj-socket", 64, 64, (p) => {
      const px = 2 / 64;
      const d = p.magnitude - 0.82;
      let c = Color.lerp(new Color(0.22, 0.2, 0.2, 0.75), new Color(0.35, 0.32, 0.3, 0.75), CasualArt.smooth(-0.8, 0.8, -p.y));
      const rim = Math.abs(d + 0.05) - 0.05;
      c = Color.lerp(c, new Color(1, 1, 1, 0.6), CasualArt.fill(rim, px));
      return c.withAlpha(c.a * CasualArt.fill(d, px));
    });
  },

  /** Pegboard wall: tan panel with a grid of holes. */
  get Pegboard() {
    return CasualArt.make("bj-peg", 128, 128, (p) => {
      const px = 2 / 128;
      let c = Color.lerp(Pal.hex(0xd9b98c), Pal.hex(0xe6c99e), Mathf.perlinNoise(p.x * 4 + 3, p.y * 4));
      const f = new V2(Mathf.repeat(p.x * 2, 1) - 0.5, Mathf.repeat(p.y * 2, 1) - 0.5);
      const hole = f.magnitude - 0.09;
      c = Color.lerp(c, Pal.hex(0x7a5a3a), CasualArt.fill(hole, px));
      const sh = f.sub(new V2(0.015, -0.015)).magnitude - 0.09;
      c = Color.lerp(c, Pal.hex(0xf3ddb8), CasualArt.fill(sh, px) * (1 - CasualArt.fill(hole, px)) * 0.6);
      return c.withAlpha(1);
    });
  },

  /** Darker wood for the workbench / frame (1 unit wide, 0.25 tall). */
  get Bench() {
    return CasualArt.make("bj-bench", 256, 64, (p) => {
      const y = p.y / 0.25;
      let c = Color.lerp(Pal.hex(0x8a5a34), Pal.hex(0xa8703f), CasualArt.smooth(-1, 1, y));
      const grain = Math.sin(p.x * 22 + Math.sin(p.y * 60 + p.x * 4) * 2) * 0.5 + 0.5;
      c = Color.lerp(c, Pal.hex(0x6e4527), grain * 0.18);
      c = Color.lerp(c, Pal.hex(0xc98e58), CasualArt.smooth(0.75, 1, y) * 0.6);
      return c.withAlpha(1);
    });
  },
};
