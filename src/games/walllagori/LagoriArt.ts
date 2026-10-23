import { CasualArt, Color, Mathf, Pal, Sprite, V2 } from "../../kit";

/**
 * Procedural art for LAGORI: the seven painted stones, the street, the neighbourhood houses, the neighbours who watch
 * (and the tagger kid who defends the pile), the tag ball and the chalk home circle. Baked once and cached.
 */

const C = (h: number) => Pal.hex(h);
const fill = CasualArt.fill, smooth = CasualArt.smooth;

export const StoneCols = [C(0xe8413c), C(0xff8a1f), C(0xffd23a), C(0x4cc35a), C(0x22b8c8), C(0x3d7bff), C(0xa45cf0)];
/** Stone i (0 = largest, bottom of the pile): width in world units. */
export const StoneW = (i: number) => 4.4 - i * 0.36;
export const StoneT = 1.0;

function hash(x: number, y: number, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise(x: number, y: number, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return Mathf.lerp(Mathf.lerp(a, b, u), Mathf.lerp(c, d, u), v);
}

const Skins = [C(0x8a5a3c), C(0xc68a5e), C(0x6b4430), C(0xe0a97c), C(0xa86f4a)];
const Shirts = [C(0xff5a5f), C(0x3d8bff), C(0xffc93c), C(0x4ee08a), C(0xb45cff), C(0xff8a3d), C(0x22c8d8), C(0xf2f2f2)];
const Pants = [C(0x2a3a6a), C(0x3a2a2a), C(0x5a4a8a), C(0x2a5a4a), C(0x6a3a2a)];
const Hairs = [C(0x1a1012), C(0x2a1a14), C(0x3a2418)];

export const LagoriArt = {
  /** Painted flat stone seen from the side (slightly from above), one per size. */
  Stone(i: number): Sprite {
    const w = StoneW(i), hpx = Math.round(160 * (StoneT + 0.12) / w);
    const col = StoneCols[i];
    return CasualArt.make("lg-stone-" + i, 160, hpx, (p) => {
      const px = 2 / 160, hh = hpx / 160;
      // rounded slab: an ellipse-capped box
      const d = CasualArt.sdBox(p, new V2(0.97, hh * 0.86), hh * 0.8);
      const a = fill(d, px);
      if (a <= 0) return Color.clear;
      const ty = (p.y + hh) / (2 * hh); // 0 bottom .. 1 top
      const n = noise(p.x * 9 + i * 3, p.y * 9, i);
      // stone body: warm grey with a painted band
      let c = Color.lerp(C(0x8a8076), C(0xd8cfc2), 0.35 + 0.4 * ty + 0.15 * n);
      const band = Math.abs(ty - 0.52) < 0.3;
      if (band) {
        c = Color.lerp(col, CasualArt.lighten(col, 0.2), ty);
        // painted pattern: dots or zigzag alternating per stone
        if (i % 2 === 0) {
          const gx = Mathf.repeat(p.x * 4.5 + 0.5, 1) - 0.5, gy = (ty - 0.52) * 2.2;
          if (Math.hypot(gx * 0.9, gy * (hh * 4.5)) < 0.16) c = Color.white;
        } else {
          const z = Math.abs(Mathf.repeat(p.x * 3, 1) - 0.5) * 0.5 - (ty - 0.37);
          if (Math.abs(z * 2.4) < 0.07) c = C(0xfff4d6);
        }
        const edge = Math.min(Math.abs(ty - 0.22), Math.abs(ty - 0.82));
        if (edge < 0.035) c = CasualArt.darken(col, 0.35);
      }
      // top rim highlight, bottom shade
      c = Color.lerp(c, Color.white, smooth(0.86, 1, ty) * 0.35);
      c = Color.lerp(c, Color.black, smooth(0.25, 0, ty) * 0.35);
      c = Color.lerp(c, Color.black, smooth(-0.04, 0, d) * 0.45);
      return c.withAlpha(a);
    });
  },

  /** Number badge disc (white with dark edge). */
  Badge(): Sprite {
    return CasualArt.make("lg-badge", 96, 96, (p) => {
      const r = p.magnitude, a = fill(r - 0.94, 2 / 96);
      if (a <= 0) return Color.clear;
      const c = r > 0.78 ? C(0x1d1030) : Color.lerp(Color.white, C(0xffe7a8), smooth(0.2, -0.8, p.y));
      return c.withAlpha(a);
    });
  },

  /** Chalk circle the pile stands in (flat ellipse on the ground). */
  Chalk(): Sprite {
    return CasualArt.make("lg-chalk", 256, 72, (p) => {
      const q = new V2(p.x, p.y / (72 / 256) * 1.0);
      const r = Math.hypot(q.x, q.y * 0.95);
      const ring = Math.abs(r - 0.86) - 0.035 - 0.02 * noise(p.x * 30, p.y * 30, 4);
      const a = fill(ring, 0.02) * (0.65 + 0.35 * noise(p.x * 60, p.y * 60, 9));
      return new Color(1, 1, 1, a * 0.85);
    });
  },

  /** Dusty street ground (perspective handled by placement). */
  Street(): Sprite {
    return CasualArt.make("lg-street", 512, 192, (p) => {
      const ty = (p.y + 0.375) / 0.75; // 0 front .. 1 back
      const n = noise(p.x * 14, p.y * 22, 3) * 0.6 + noise(p.x * 50, p.y * 70, 5) * 0.4;
      let c = Color.lerp(C(0xe8b878), C(0xd49a5e), ty * 0.6 + n * 0.25);
      // pebbles
      const pb = noise(p.x * 120, p.y * 160, 11);
      if (pb > 0.82) c = Color.lerp(c, C(0xa87848), 0.5);
      // worn tyre tracks
      c = Color.lerp(c, C(0xc08850), smooth(0.08, 0, Math.abs(Math.abs(p.x * (1.2 - ty * 0.5)) - 0.55)) * 0.3);
      // kerb + drain at the back
      if (ty > 0.94) c = Color.lerp(C(0xb8b0a0), C(0x8a8478), smooth(0.97, 1, ty));
      c = Color.lerp(c, C(0x8a6040), smooth(0.86, 0.94, ty) * smooth(0.95, 0.94, ty) * 0.6);
      return c.withAlpha(1);
    });
  },

  /** A neighbourhood house front: style 0..7, colour variant v. */
  House(style: number, v: number): Sprite {
    const walls = [C(0xffb3a7), C(0xffd77a), C(0x9fd8f0), C(0xc7a8f0), C(0xa8e6b0), C(0xffc28a), C(0xf2a0c8), C(0xb8e0d8)];
    const wall = walls[(style + v * 3) % walls.length];
    const trim = [C(0x2e6fd8), C(0x2aa08a), C(0xd8452e), C(0x7a3ab8)][(style + v) % 4];
    return CasualArt.make("lg-house-" + style + "-" + v, 200, 260, (p) => {
      const px = 2 / 200, H = 1.3; // y in [-1.3, 1.3]
      const roofY = H - 0.34 - (style % 3) * 0.12;
      if (p.y > roofY + 0.08) {
        // parapet + water tank / sign on some roofs
        if (style % 4 === 1 && Math.abs(p.x - 0.4) < 0.18 && p.y < roofY + 0.36) return Color.lerp(C(0x2a2a2a), C(0x4a4a4a), (p.y - roofY) * 2).withAlpha(1);
        if (style % 4 === 3 && Math.abs(p.x + 0.35) < 0.02 && p.y < H - 0.02) return C(0x5a4a3a);
        return Color.clear;
      }
      let c = wall.mul(0.94 + 0.08 * noise(p.x * 12, p.y * 12, style)).withAlpha(1);
      if (p.y > roofY - 0.04) c = CasualArt.darken(wall, 0.18);
      if (p.y > roofY) c = Color.lerp(Color.white, wall, 0.4);
      // floors: ground floor door + window, upper floor arched windows + balcony
      const floor = p.y > -0.15 ? 1 : 0;
      const wx = [-0.5, 0.0, 0.5];
      for (let k = 0; k < 3; k++) {
        const cx = wx[k];
        if (floor === 1) {
          const top = 0.62 + (style % 2) * 0.05;
          const w = new V2(p.x - cx, p.y - 0.28);
          const dWin = Math.max(CasualArt.sdBox(w, new V2(0.14, 0.26), 0.02), -(top - p.y));
          const arch = CasualArt.sdCircle(new V2(p.x, p.y), new V2(cx, 0.54), 0.14);
          const d = Math.min(CasualArt.sdBox(w, new V2(0.14, 0.26), 0.02), arch);
          if (d < 0.035) c = CasualArt.darken(trim, 0.1);
          if (d < 0) c = Color.lerp(C(0x2b3a5a), C(0x5a7aa8), smooth(0.05, 0.5, p.y));
          void dWin;
          // shutters
          if (Math.abs(Math.abs(p.x - cx) - 0.2) < 0.045 && Math.abs(p.y - 0.3) < 0.25) c = trim;
        } else if (k !== 1 || style % 2 === 0) {
          const w = new V2(p.x - cx, p.y + 0.62);
          const d = CasualArt.sdBox(w, new V2(0.15, 0.18), 0.02);
          if (d < 0.035) c = CasualArt.darken(trim, 0.1);
          if (d < 0) c = Color.lerp(C(0x2b3a5a), C(0x6a8ab8), smooth(-0.8, -0.45, p.y));
          if (d < 0 && Math.abs(Mathf.repeat((p.x - cx) * 14, 1) - 0.5) < 0.12) c = C(0x2a2a3a);
        }
      }
      // door
      if (style % 2 === 1) {
        const d = CasualArt.sdBox(new V2(p.x, p.y + 0.85), new V2(0.17, 0.42), 0.04);
        if (d < 0.035) c = CasualArt.darken(trim, 0.3);
        if (d < 0) c = Color.lerp(trim, CasualArt.lighten(trim, 0.2), smooth(-1.2, -0.5, p.y));
      }
      // balcony rail on the first floor
      if (p.y > -0.12 && p.y < 0.06) {
        if (p.y > 0.02 || Math.abs(Mathf.repeat(p.x * 12, 1) - 0.5) < 0.1) c = CasualArt.darken(trim, 0.15);
      }
      // floor ledge
      if (Math.abs(p.y + 0.15) < 0.035) c = Color.lerp(Color.white, wall, 0.3);
      // plinth
      if (p.y < -1.2) c = CasualArt.darken(wall, 0.35);
      // side shade
      c = Color.lerp(c, Color.black, smooth(0.9, 1, Math.abs(p.x)) * 0.2);
      return c.withAlpha(fill(Math.abs(p.x) - 1, px));
    });
  },

  /**
   * A neighbour / the tagger. pose: 0 idle, 1 cheering (arms up), 2 wind-up (arm back), 3 throw (arm forward),
   * 4 clapping. Faces right; flip for left.
   */
  Person(pose: number, look: number): Sprite {
    const skin = Skins[look % Skins.length], shirt = Shirts[(look * 3 + 1) % Shirts.length], pants = Pants[look % Pants.length];
    const hair = Hairs[look % Hairs.length], longHair = look % 3 === 1 && look < 100, tagger = look >= 100;
    return CasualArt.make("lg-person-" + pose + "-" + look, 96, 192, (p) => {
      const px = 2 / 96;
      let c = Color.clear;
      const put = (d: number, col: Color) => { const a = fill(d, px); if (a > 0) c = CasualArt.over(c, col, a); };
      const out = (d: number) => put(d - 0.06, C(0x1d1030));
      // legs
      const legs = [CasualArt.sdSegment(p, new V2(-0.18, -0.55), new V2(-0.24, -1.78)) - 0.13, CasualArt.sdSegment(p, new V2(0.18, -0.55), new V2(0.26, -1.78)) - 0.13];
      const legD = Math.min(legs[0], legs[1]);
      // arms by pose
      const sh = [new V2(-0.36, 0.42), new V2(0.36, 0.42)];
      let hands: V2[];
      switch (pose) {
        case 1: hands = [new V2(-0.62, 1.38), new V2(0.62, 1.38)]; break;
        case 2: hands = [new V2(-0.6, -0.25), new V2(-0.25, 1.05)]; break;
        case 3: hands = [new V2(-0.6, -0.2), new V2(0.86, 0.75)]; break;
        case 4: hands = [new V2(0.05, 0.62), new V2(0.12, 0.7)]; break;
        default: hands = [new V2(-0.5, -0.35), new V2(0.5, -0.35)];
      }
      const arms = Math.min(CasualArt.sdSegment(p, sh[0], hands[0]) - 0.11, CasualArt.sdSegment(p, sh[1], hands[1]) - 0.11);
      const torso = CasualArt.sdBox(p.sub(new V2(0, -0.05)), new V2(0.4, 0.55), 0.18);
      const head = CasualArt.sdCircle(p, new V2(0, 1.05), 0.36);
      out(Math.min(legD, arms, torso, head));
      put(legD, pants);
      put(Math.min(legs[0], legs[1]) + 0.0 + (p.y < -1.62 ? -1 : 1) * 0, pants);
      if (p.y < -1.62) put(legD, C(0x2a1a1a));
      put(torso, shirt);
      put(torso + 0.02, Color.lerp(shirt, CasualArt.lighten(shirt, 0.25), smooth(-0.4, 0.5, p.y)));
      if (tagger) put(Math.max(torso + 0.02, Math.abs(Mathf.repeat(p.y * 3.2, 1) - 0.5) - 0.22), Color.white);
      put(arms, skin);
      for (const h of hands) put(CasualArt.sdCircle(p, h, 0.13), skin);
      put(head, skin);
      // hair
      const hairD = Math.max(CasualArt.sdCircle(p, new V2(0, 1.12), 0.38), -(p.y - 1.12 - (p.x > 0.1 ? 0.0 : -0.1)));
      put(hairD, hair);
      if (tagger) {
        put(Math.max(CasualArt.sdCircle(p, new V2(0, 1.14), 0.4), -(p.y - 1.16)), C(0xe8233c));
        put(CasualArt.sdBox(p.sub(new V2(0.3, 1.18)), new V2(0.3, 0.06), 0.04), C(0xb81830));
      }
      if (longHair) put(CasualArt.sdBox(p.sub(new V2(-0.12, 0.85)), new V2(0.28, 0.28), 0.14), hair);
      // face: eye + smile (facing right)
      put(CasualArt.sdCircle(p, new V2(0.16, 1.06), 0.05), C(0x1d1030));
      if (pose === 1 || pose === 4) put(Math.abs(CasualArt.sdCircle(p, new V2(0.14, 0.95), 0.1)) - 0.025 + (p.y > 0.93 ? 1 : 0), C(0x1d1030));
      return c;
    });
  },

  /** The tag ball (a worn rubber ball). */
  TagBall(): Sprite { return CasualArt.ball(C(0xff3d6e)); },

  Flag(): Sprite {
    return CasualArt.make("lg-flag", 48, 56, (p) => {
      const hh = 56 / 48;
      const a = fill(Math.max(Math.abs(p.x) - (p.y + hh) / (2 * hh) * 0.95, p.y - hh * 0.96), 2 / 48);
      return new Color(1, 1, 1, a);
    });
  },

  /** A string of lights' bulb / generic soft blob. */
  Blob(): Sprite { return CasualArt.Soft; },
};
