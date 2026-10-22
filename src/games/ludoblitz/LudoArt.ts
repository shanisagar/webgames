import { Art, CasualArt, Color, GameObject, Mathf, Sprite, V2, V3 } from "../../kit";

/**
 * Royal board art for Ludo Blitz: shaded RGBA sprites rasterized once in code and cached (no texture assets).
 * "Tintable" sprites are greyscale (white = full colour), so SpriteRenderer.color gives them their hue while
 * keeping the lighting. World sprites are one unit wide, like NeonArcade.Art. (Port of LudoArt.cs.)
 */

// Light comes from the top-left, slightly in front.
const LightDir = new V3(-0.45, 0.62, 0.64).normalized;

const Gold = new Color(0.91, 0.72, 0.33);
const GoldLight = new Color(1.00, 0.90, 0.58);
const GoldDeep = new Color(0.55, 0.37, 0.10);

/** LudoArt.Make: square sprite, p in [-1,1]² (same mapping as CasualArt.make). */
const make = (key: string, size: number, fn: (p: V2) => Color): Sprite => CasualArt.make(key, size, size, fn);

function bevelOf(key: string, radius: number, bevel: number) {
  return make(key, 128, (p) => {
    const sd = Art.roundBox(p, 0.95, radius);
    const a = Art.edge(-sd);
    if (a <= 0) return Color.clear;
    const depth = -sd; // distance inside the edge
    // Approximate outward normal of the rounded box from the SDF gradient.
    const e = 0.01;
    let grad = new V2(
      Art.roundBox(p.add(new V2(e, 0)), 0.95, radius) - Art.roundBox(p.sub(new V2(e, 0)), 0.95, radius),
      Art.roundBox(p.add(new V2(0, e)), 0.95, radius) - Art.roundBox(p.sub(new V2(0, e)), 0.95, radius));
    if (grad.sqrMagnitude > 1e-8) grad = grad.normalized;
    const edgeK = 1 - Mathf.clamp01(depth / bevel); // 1 at the edge, 0 on the flat top
    const facing = V2.dot(grad, new V2(LightDir.x, LightDir.y).normalized);
    let shade = 0.90 + 0.04 * p.y + facing * 0.32 * edgeK * edgeK;
    shade *= 1 - 0.06 * edgeK; // slight darkening into the groove
    shade = Mathf.clamp01(shade);
    return new Color(shade, shade, shade, a);
  });
}

export const LudoArt = {
  // ------------------------------------------------------------------ palette

  Ivory: new Color(0.98, 0.94, 0.86),
  GoldLight,
  Gold,
  GoldDeep,

  // ------------------------------------------------------------------ sprites

  /** Glossy dome (pawn head / medallion). Tintable. */
  get Dome() {
    return make("lb2-dome", 128, (p) => {
      const r = p.magnitude / 0.92;
      const a = Art.edge(0.92 - p.magnitude);
      if (a <= 0) return Color.clear;
      const z = Math.sqrt(Math.max(0, 1 - Math.min(1, r * r)));
      const n = new V3(p.x / 0.92, p.y / 0.92, z).normalized;
      const lambert = Math.max(0, V3.dot(n, LightDir));
      let shade = 0.50 + 0.55 * lambert;
      shade *= Mathf.lerp(1, 0.78, Mathf.smoothStep(0.80, 1, r)); // darker rim
      shade = Mathf.clamp01(shade);
      return new Color(shade, shade, shade, a);
    });
  },

  /** Soft white specular highlight for domes and dice. */
  get Gloss() {
    return make("lb2-gloss", 96, (p) => {
      const q = new V2((p.x + 0.28) * 1.35, (p.y - 0.34) * 2.0);
      let a = Mathf.clamp01(1 - q.magnitude);
      a = a * a * 0.85;
      return new Color(1, 1, 1, a);
    });
  },

  /** Concave pip / slot: darker at the top, lighter at the bottom. Tintable. */
  get Pit() {
    return make("lb2-pit", 64, (p) => {
      const a = Art.edge(0.9 - p.magnitude, 64);
      const shade = Mathf.clamp01(0.62 - 0.30 * p.y);
      return new Color(shade, shade, shade, a);
    });
  },

  /** Bevelled rounded tile (board squares, yards, dice faces). Tintable. */
  get Bevel() { return bevelOf("lb2-bevel", 0.22, 0.15); },

  /** Rounder bevel used for the die. */
  get DiceBevel() { return bevelOf("lb2-dice", 0.34, 0.2); },

  /** Polished walnut board with rounded corners (RGBA, not tinted). */
  get Wood() {
    return make("lb2-wood", 512, (p) => {
      const a = Art.edge(-Art.roundBox(p, 0.985, 0.06), 512);
      if (a <= 0) return Color.clear;
      const warp = Mathf.perlinNoise(p.x * 1.6 + 3.1, p.y * 9 + 7.7) * 2.2;
      const grain = 0.5 + 0.5 * Math.sin((p.x * 5.5 + warp) * 6.2832 * 1.6);
      const fine = Mathf.perlinNoise(p.x * 40, p.y * 3) * 0.18;
      const light = new Color(0.47, 0.27, 0.13);
      const dark = new Color(0.25, 0.12, 0.05);
      let c = Color.lerp(dark, light, Mathf.clamp01(grain * 0.75 + fine));
      const vign = 1 - 0.35 * Mathf.smoothStep(0.55, 1.05, Math.max(Math.abs(p.x), Math.abs(p.y)));
      const sheen = 1 + 0.10 * (p.y - p.x) * 0.5; // varnish catching the light
      c = c.mul(vign * sheen);
      return c.withAlpha(a);
    });
  },

  /** Gold picture-frame band around the board (RGBA). */
  get GoldFrame() {
    return make("lb2-goldframe", 512, (p) => {
      const outer = Art.roundBox(p, 0.995, 0.07);
      const inner = Art.roundBox(p, 0.93, 0.05);
      const a = Math.min(Art.edge(-outer, 512), Art.edge(inner, 512));
      if (a <= 0) return Color.clear;
      const band = Mathf.clamp01(-outer / Math.max(0.001, -outer + inner)); // 0 outer edge .. 1 inner edge
      const metal = 0.5 + 0.5 * Math.cos((band - 0.35) * 6.2832 * 0.9);
      const facing = 0.5 + 0.5 * (p.y - p.x) * 0.7;
      const k = Mathf.clamp01(metal * 0.8 + (facing - 0.5) * 0.5);
      let c = k < 0.7 ? Color.lerp(GoldDeep, Gold, k / 0.7) : Color.lerp(Gold, GoldLight, (k - 0.7) / 0.3);
      if (band > 0.82 || band < 0.06) c = c.mul(0.72); // fine engraved lines
      return c.withAlpha(a);
    });
  },

  /** Deep velvet backdrop with a soft spotlight and vignette (RGBA). */
  get Velvet() {
    return make("lb2-velvet", 256, (p) => {
      const d = new V2(p.x * 0.85, p.y - 0.15).magnitude;
      const centre = new Color(0.42, 0.07, 0.16);
      const edge = new Color(0.07, 0.015, 0.04);
      const c = Color.lerp(centre, edge, Mathf.smoothStep(0.05, 1.25, d));
      const nap = (Mathf.perlinNoise(p.x * 30, p.y * 30) - 0.5) * 0.035; // velvet texture
      return new Color(c.r + nap, c.g + nap * 0.4, c.b + nap * 0.6, 1);
    });
  },

  /** Soft round shadow / glow falloff (white with alpha; tint it). */
  get Soft() {
    return make("lb2-soft", 64, (p) => {
      const d = p.magnitude;
      const a = Mathf.clamp01(1 - d);
      return new Color(1, 1, 1, a * a);
    });
  },

  // ------------------------------------------------------------------ helpers

  get Mat() { return Art.Flat; },

  Spr: (parent: GameObject | null, name: string, sprite: Sprite, color: Color, size: number, order: number) =>
    Art.spr(parent, name, sprite, color, size, order, Art.Flat),
};
