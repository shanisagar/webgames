import { Art, CasualArt, Color, GameObject, Mathf, Sprite, V2, V3 } from "../../kit";

/**
 * Bright, toy-like art for Untwine (a kids' puzzle look instead of neon): glossy plastic tube rings, chunky pegs,
 * a warm cream backdrop with soft stars. Sprites are rasterized once in code and cached; "tintable" sprites are
 * greyscale so SpriteRenderer.color gives the hue while the shading stays baked in.
 * The ring sprites are shaded symmetrically around the ring, so they look right at any rotation. (Port of UntwineArt.cs.)
 */

const LightDir = new V3(-0.45, 0.62, 0.64).normalized;

/** Shader-style smoothstep: 0 at e0, 1 at e1 (works with e0 > e1 too). */
function smooth(e0: number, e1: number, x: number) {
  const t = Mathf.clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function hash(x: number, y: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h & 0xffffff) / 16777216;
}

function starSd(p: V2, size: number) {
  const a = Math.atan2(p.y, p.x);
  const r = p.magnitude;
  const wave = 0.55 + 0.45 * Math.cos(a * 5);
  return r - size * (0.5 + 0.5 * wave);
}

/** C# "0.###" formatting for cache keys. */
const f3 = (v: number) => String(Number(v.toFixed(3)));

/** UntwineArt.Make: square sprites, p in [-1,1]², one unit wide (same mapping as CasualArt.make). */
const make = (key: string, w: number, h: number, fn: (p: V2) => Color): Sprite => CasualArt.make(key, w, h, fn);

function ringSprite(kind: string, radius: number, width: number, gapDeg: number, shine: boolean) {
  const key = `${kind}-${f3(radius)}-${f3(width)}-${Number(gapDeg.toFixed(1))}`;
  const half = UntwineArt.RingSpriteSize(radius, width) * 0.5;
  const hw = width * 0.5;
  const g = gapDeg * 0.5 * Mathf.Deg2Rad;
  const e1 = new V2(Math.cos(g), Math.sin(g)).mul(radius);
  const e2 = new V2(Math.cos(g), -Math.sin(g)).mul(radius);
  const res = 256;
  return make(key, res, res, (p) => {
    const w = p.mul(half); // world units, centred on the ring
    const ang = Math.abs(Math.atan2(w.y, w.x));
    let dist: number, along = 1;
    if (ang >= g) {
      dist = Math.abs(w.magnitude - radius);
      along = Mathf.clamp01((ang - g) / 0.35); // fade the shine into the caps
    } else {
      dist = Math.min(w.sub(e1).magnitude, w.sub(e2).magnitude);
      along = 0;
    }
    const a = Mathf.clamp01((hw - dist) / ((half * 2) / res) + 0.5);
    if (a <= 0) return Color.clear;
    const u = Mathf.clamp01(dist / hw); // 0 on the tube's centre line, 1 at its edge
    if (shine) {
      // A thin glossy stripe running along the outer side of the tube.
      const r = w.magnitude;
      const s = ang >= g ? (r - radius) / hw : -1;
      const stripe = smooth(0.42, 0.18, Math.abs(s - 0.28)) * along;
      return new Color(1, 1, 1, Mathf.clamp01(stripe * 0.72) * a);
    }
    const z = Math.sqrt(Math.max(0, 1 - u * u));
    let shade = 0.58 + 0.46 * z;
    shade *= Mathf.lerp(1, 0.7, smooth(0.72, 1, u)); // darker plastic rim, reads like an outline
    shade = Mathf.clamp01(shade);
    return new Color(shade, shade, shade, a);
  });
}

const Toy = [
  new Color(0.93, 0.22, 0.20), // red
  new Color(0.18, 0.53, 0.95), // blue
  new Color(1.00, 0.76, 0.10), // yellow
  new Color(0.20, 0.74, 0.33), // green
  new Color(1.00, 0.50, 0.12), // orange
  new Color(0.62, 0.33, 0.90), // purple
  new Color(1.00, 0.40, 0.66), // pink
];

export const UntwineArt = {
  // ------------------------------------------------------------------ palette

  Ink: new Color(0.29, 0.18, 0.42), // deep plum text
  InkSoft: new Color(0.47, 0.34, 0.58),
  Card: new Color(1, 0.99, 0.96, 0.95),
  Orange: new Color(1, 0.52, 0.12),
  Sun: new Color(1, 0.76, 0.10),
  Locked: new Color(0.62, 0.58, 0.55),

  /** Seven bright toy colours. Neighbouring rings always get different ones (see UntwineGame.Load). */
  Toy,
  Confetti: [Toy[0], Toy[1], Toy[2], Toy[3], Toy[4], Toy[5], Toy[6], Color.white],

  // ------------------------------------------------------------------ rings

  /** World size of the ring sprite for a ring of this radius and tube width. */
  RingSpriteSize: (radius: number, width: number) => 2 * (radius + width * 0.5 + 0.04),

  /** Glossy plastic tube bent into a ring with a gap centred on +X. Tintable. */
  RingTube: (radius: number, width: number, gapDeg: number) => ringSprite("ut-tube", radius, width, gapDeg, false),

  /** White highlight stripe along the tube (same geometry as RingTube). */
  RingShine: (radius: number, width: number, gapDeg: number) => ringSprite("ut-shine", radius, width, gapDeg, true),

  // ------------------------------------------------------------------ pieces

  /** Glossy dome (pegs, bolts, lock badge). Tintable. */
  get Dome() {
    return make("ut-dome", 96, 96, (p) => {
      const r = p.magnitude / 0.92;
      const a = Art.edge(0.92 - p.magnitude, 96);
      if (a <= 0) return Color.clear;
      const z = Math.sqrt(Math.max(0, 1 - Math.min(1, r * r)));
      const n = new V3(p.x / 0.92, p.y / 0.92, z).normalized;
      const lambert = Math.max(0, V3.dot(n, LightDir));
      let shade = 0.55 + 0.55 * lambert;
      shade *= Mathf.lerp(1, 0.72, smooth(0.8, 1, r));
      const q = new V2((p.x + 0.3) * 1.4, (p.y - 0.34) * 2);
      const hi = smooth(0.5, 0.1, q.magnitude);
      shade = Mathf.lerp(Mathf.clamp01(shade), 1, hi * 0.85);
      return new Color(shade, shade, shade, a);
    });
  },

  /** Soft round falloff (white with alpha) for shadows, glows and hint halos. */
  get Soft() {
    return make("ut-soft", 64, 64, (p) => {
      const a = Mathf.clamp01(1 - p.magnitude);
      return new Color(1, 1, 1, a * a);
    });
  },

  /** Warm cream backdrop with a soft peach glow and faint stars (RGBA, stretched to the view). */
  get Backdrop() {
    return make("ut-backdrop", 256, 256, (p) => {
      const centre = new Color(1.00, 0.96, 0.86);
      const edge = new Color(0.99, 0.82, 0.62);
      const d = new V2(p.x * 0.85, p.y - 0.1).magnitude;
      let c = Color.lerp(centre, edge, smooth(0.15, 1.35, d));
      // Faint star pattern on a jittered grid.
      const cell = 0.36;
      const gx = Math.floor((p.x + 1.2) / cell), gy = Math.floor((p.y + 1.2) / cell);
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const cx = gx + ox, cy = gy + oy;
          if (hash(cx, cy) < 0.45) continue;
          const sc = new V2((cx + 0.2 + 0.6 * hash(cx + 7, cy)) * cell - 1.2, (cy + 0.2 + 0.6 * hash(cx, cy + 9)) * cell - 1.2);
          const size = 0.035 + 0.05 * hash(cx + 3, cy + 3);
          const rot = hash(cx - 5, cy + 1) * 6.28;
          const q = p.sub(sc);
          const st = starSd(new V2(q.x * Math.cos(rot) + q.y * Math.sin(rot), -q.x * Math.sin(rot) + q.y * Math.cos(rot)), size);
          const k = Mathf.clamp01(-st * 256 * 0.5 + 0.5);
          c = Color.lerp(c, new Color(1, 0.74, 0.45), k * 0.35);
        }
      return c.withAlpha(1);
    });
  },

  // ------------------------------------------------------------------ helpers

  Spr: (parent: GameObject | null, name: string, sprite: Sprite, color: Color, size: number, order: number) =>
    Art.spr(parent, name, sprite, color, size, order, Art.Flat),
};
