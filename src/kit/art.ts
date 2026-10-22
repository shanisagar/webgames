import { Color, Mathf, V2 } from "./math";
import { LineRenderer, Material, Mesh, MeshRenderer, Render, Sprite, SpriteRenderer } from "./render";
import { GameObject } from "./scene";

/**
 * Procedural sprites, materials and render helpers (Art.cs). No texture assets: every shape is rasterized from a
 * signed-distance function on first use and cached. World sprites are one unit wide.
 */

const sprites = new Map<string, Sprite>();
let rasterSize = 128;

function canvasOf(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Registers a canvas as both a Phaser texture and a Sprite. Unity rows go bottom→top; canvas rows top→bottom. */
function register(key: string, canvas: HTMLCanvasElement, ppu: number, border: number | [number, number, number, number]): Sprite {
  const b: [number, number, number, number] = typeof border === "number" ? [border, border, border, border] : border;
  const s = new Sprite(key, canvas.width, canvas.height, ppu, b, canvas);
  Render.addCanvasTexture(key, canvas);
  sprites.set(key, s);
  return s;
}

/** A new Phaser instance starts with no textures: register every cached sprite again. */
export function reRegisterTextures() {
  for (const s of sprites.values()) if (s.canvas) Render.addCanvasTexture(s.key, s.canvas);
}

export const Art = {
  // ------------------------------------------------------------------ shapes (white alpha masks, tint them)
  get Glow() { return Art.shape("glow", (p) => { const d = p.magnitude; return Mathf.clamp01(1 - d) * Math.exp(-d * d * 4); }); },
  get Disc() { return Art.shape("disc", (p) => Art.edge(0.92 - p.magnitude)); },
  get Ring() { return Art.shape("ring", (p) => Art.edge(0.09 - Math.abs(p.magnitude - 0.82))); },
  get ThinRing() { return Art.shape("thin-ring", (p) => Art.edge(0.035 - Math.abs(p.magnitude - 0.9))); },
  get Square() { return Art.shape("square", (p) => Art.edge(0.97 - Math.max(Math.abs(p.x), Math.abs(p.y)))); },
  get RoundSquare() { return Art.shape("round-square", (p) => Art.edge(-Art.roundBox(p, 0.92, 0.28))); },
  get Tri() { return Art.shape("tri", (p) => Art.poly(p, new V2(0.95, 0), new V2(-0.6, 0.82), new V2(-0.6, -0.82))); },
  get Chevron() { return Art.shape("chevron", (p) => Art.poly(p, new V2(0.95, 0), new V2(-0.75, 0.75), new V2(-0.4, 0), new V2(-0.75, -0.75))); },
  get Diamond() { return Art.shape("diamond", (p) => Art.poly(p, new V2(0.95, 0), new V2(0, 0.95), new V2(-0.95, 0), new V2(0, -0.95))); },
  get Hex() { return Art.shape("hex", (p) => Art.poly(p, ...Art.regular(6, 0.93, Math.PI / 6))); },
  get Octagon() { return Art.shape("octagon", (p) => Art.poly(p, ...Art.regular(8, 0.95, Math.PI / 8))); },
  get Star() {
    return Art.shape("star", (p) => {
      const pts: V2[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + (i % 2 === 1 ? 0.28 : 0);
        pts.push(new V2(Math.cos(a), Math.sin(a)).mul(i % 2 === 0 ? 0.96 : 0.3));
      }
      return Art.poly(p, ...pts) * (1 - Art.edge(0.12 - p.magnitude));
    });
  },
  get Plus() {
    return Art.shape("plus", (p) => Art.edge(Math.min(0.95 - Math.max(Math.abs(p.x), Math.abs(p.y)), 0.3 - Math.min(Math.abs(p.x), Math.abs(p.y)))));
  },
  get Car() {
    return Art.shape("car", (p) => Art.edge(-Art.roundBox(new V2(p.x, p.y * 1.7), 0.95, 0.35)) * (1 - 0.55 * Art.edge(-Art.roundBox(new V2(p.x - 0.15, p.y * 2.4), 0.35, 0.2))));
  },
  get Eye() { return Art.shape("eye", (p) => Art.edge(0.9 - new V2(p.x, p.y * 2.2).magnitude) * (1 - Art.edge(0.3 - p.magnitude) * 0.8)); },

  // UI shapes (pixels-per-unit 100 so sliced borders map 1:1 onto the canvas)
  get UiRound() { return Art.shape("ui-round", (p) => Art.edge(-Art.roundBox(p, 0.97, 0.8), 96), 96, 100, 44); },
  get UiOutline() {
    return Art.shape("ui-outline", (p) => {
      const thickness = 0.1, sd = Art.roundBox(p, 0.97, 0.8);
      return Art.edge(thickness * 0.5 - Math.abs(sd + thickness * 0.5), 96);
    }, 96, 100, 44);
  },
  get UiRing() { return Art.shape("ui-ring", (p) => Art.edge(0.07 - Math.abs(p.magnitude - 0.88)), 128, 100); },
  get UiCircle() { return Art.shape("ui-circle", (p) => Art.edge(0.95 - p.magnitude), 128, 100); },

  /** Returns (and caches) a white sprite rasterized from `alpha` over [-1,1]². */
  shape(key: string, alpha: (p: V2) => number, size = 128, ppu = 0, border = 0): Sprite {
    const cached = sprites.get(key);
    if (cached) return cached;
    const canvas = canvasOf(size, size);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const img = ctx.createImageData(size, size);
    rasterSize = size;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const p = new V2(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1);
        const a = Mathf.clamp01(alpha(p));
        const o = ((size - 1 - y) * size + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(a * 255);
      }
    rasterSize = 128;
    ctx.putImageData(img, 0, 0);
    return register(key, canvas, ppu > 0 ? ppu : size, border);
  },

  /** Anti-aliased coverage for a signed distance (positive = inside) in normalized units. */
  edge(insideDistance: number, size = 0) { return Mathf.clamp01(insideDistance * (size > 0 ? size : rasterSize) * 0.5 + 0.5); },

  roundBox(p: V2, half: number, radius: number) {
    const qx = Math.abs(p.x) - (half - radius), qy = Math.abs(p.y) - (half - radius);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  },

  regular(sides: number, radius: number, rotation: number): V2[] {
    const pts: V2[] = [];
    for (let i = 0; i < sides; i++) {
      const a = rotation + (i * Math.PI * 2) / sides;
      pts.push(new V2(Math.cos(a) * radius, Math.sin(a) * radius));
    }
    return pts;
  },

  poly(p: V2, ...poly: V2[]) {
    let minD = Infinity, inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      const abx = b.x - a.x, aby = b.y - a.y;
      const t = Mathf.clamp01(((p.x - a.x) * abx + (p.y - a.y) * aby) / Math.max(abx * abx + aby * aby, 1e-8));
      minD = Math.min(minD, Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t)));
    }
    return Art.edge(inside ? minD : -minD);
  },

  // ------------------------------------------------------------------ materials

  Additive: new Material("NA Additive", true, 1.8),
  Solid: new Material("NA Solid", false, 1.5),
  LineMat: new Material("NA Line", true, 2.4, "soft"),
  LineSoftMat: new Material("NA Line Soft", false, 1.2, "soft"),
  Particles: new Material("NA Particles", true, 2.2),
  FillAdd: new Material("NA Fill Add", true, 1, "hard"),
  /** Plain alpha-blended vertex colour (floors, walls, roads, vision cones). */
  Flat: new Material("NA Flat", false, 1, "hard"),

  // ------------------------------------------------------------------ object helpers

  spr(parent: GameObject | null, name: string, sprite: Sprite, color: Color, size: number, order: number, mat: Material | null = null) {
    const go = new GameObject(name, parent);
    go.localScale = new V2(size, size);
    const sr = go.addComponent(new SpriteRenderer());
    sr.sprite = sprite;
    sr.color = color;
    sr.material = mat ?? Art.Solid;
    sr.sortingOrder = order;
    return sr;
  },

  line(parent: GameObject | null, name: string, color: Color, width: number, order: number, loop = false, worldSpace = true, mat: Material | null = null) {
    const go = new GameObject(name, parent);
    const lr = go.addComponent(new LineRenderer());
    lr.material = mat ?? Art.LineMat;
    lr.startColor = lr.endColor = color;
    lr.widthMultiplier = width;
    lr.sortingOrder = order;
    lr.loop = loop;
    lr.useWorldSpace = worldSpace;
    lr.positionCount = 0;
    return lr;
  },

  meshObject(parent: GameObject | null, name: string, mesh: Mesh, mat: Material | null, order: number) {
    const go = new GameObject(name, parent);
    const mr = go.addComponent(new MeshRenderer());
    mr.mesh = mesh;
    mr.material = mat;
    mr.sortingOrder = order;
    return mr;
  },

  quad() {
    const m = new Mesh();
    m.vertices = [new V2(-0.5, -0.5), new V2(0.5, -0.5), new V2(-0.5, 0.5), new V2(0.5, 0.5)].map((v) => v.toV3());
    m.uv = [new V2(0, 0), new V2(1, 0), new V2(0, 1), new V2(1, 1)];
    m.triangles = [0, 2, 1, 2, 3, 1];
    return m;
  },

  /** Internal textures used by lines and UI (called once by the host). */
  makeBaseTextures() {
    const soft = canvasOf(4, 64), sc = soft.getContext("2d")!;
    const g = sc.createLinearGradient(0, 0, 0, 64);
    for (let i = 0; i <= 16; i++) { const v = Math.abs(i / 16 * 2 - 1); g.addColorStop(i / 16, `rgba(255,255,255,${Math.pow(1 - v, 1.6).toFixed(3)})`); }
    sc.fillStyle = g;
    sc.fillRect(0, 0, 4, 64);
    register("__line_soft", soft, 64, 0);
    const cap = canvasOf(63, 63), cc = cap.getContext("2d")!;
    const rg = cc.createRadialGradient(31.5, 31.5, 0, 31.5, 31.5, 31.5);
    for (let i = 0; i <= 16; i++) rg.addColorStop(i / 16, `rgba(255,255,255,${Math.pow(1 - i / 16, 1.6).toFixed(3)})`);
    cc.fillStyle = rg;
    cc.fillRect(0, 0, 63, 63);
    register("__line_cap", cap, 63, 0);
    const white = canvasOf(3, 3), wc = white.getContext("2d")!;
    wc.fillStyle = "#fff";
    wc.fillRect(0, 0, 3, 3);
    register("__white", white, 3, 0);
    const disc = canvasOf(63, 63), dc = disc.getContext("2d")!;
    dc.fillStyle = "#fff";
    dc.beginPath();
    dc.arc(31.5, 31.5, 31, 0, Math.PI * 2);
    dc.fill();
    register("__disc", disc, 63, 0);
  },
};

// ------------------------------------------------------------------ CasualArt

/** Hex-ish key for a colour (for sprite cache keys). */
function key(c: Color) {
  const h = (v: number) => Math.floor(Mathf.clamp01(v) * 255).toString(16).padStart(2, "0");
  return h(c.r) + h(c.g) + h(c.b) + h(c.a);
}

/**
 * Procedural sprite cache with signed-distance helpers for bright, casual games (CasualKit.cs CasualArt).
 * `fn` gets p with x in [-1, 1] across the width and y in [-h/w, h/w] (same scale as x). One world unit wide.
 */
export const CasualArt = {
  make(k: string, w: number, h: number, fn: (p: V2) => Color, border: [number, number, number, number] | number = 0, ppu = 0): Sprite {
    const cached = sprites.get("c:" + k);
    if (cached) return cached;
    const canvas = canvasOf(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const img = ctx.createImageData(w, h);
    const s = 2 / w;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = fn(new V2((x + 0.5) * s - 1, (y + 0.5 - h * 0.5) * s));
        const o = ((h - 1 - y) * w + x) * 4;
        img.data[o] = Math.round(Mathf.clamp01(c.r) * 255);
        img.data[o + 1] = Math.round(Mathf.clamp01(c.g) * 255);
        img.data[o + 2] = Math.round(Mathf.clamp01(c.b) * 255);
        img.data[o + 3] = Math.round(Mathf.clamp01(c.a) * 255);
      }
    ctx.putImageData(img, 0, 0);
    // Unity's Vector4 border is (left, bottom, right, top).
    return register("c:" + k, canvas, ppu > 0 ? ppu : w, border);
  },

  /** Shader-style smoothstep. */
  smooth(e0: number, e1: number, x: number) { const t = Mathf.clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); },
  fill(d: number, px: number) { return Mathf.clamp01(0.5 - d / px); },
  sdBox(p: V2, half: V2, r: number) {
    const qx = Math.abs(p.x) - half.x + r, qy = Math.abs(p.y) - half.y + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  },
  sdCircle(p: V2, c: V2, r: number) { return Math.hypot(p.x - c.x, p.y - c.y) - r; },
  sdSegment(p: V2, a: V2, b: V2) {
    const pax = p.x - a.x, pay = p.y - a.y, bax = b.x - a.x, bay = b.y - a.y;
    const h = Mathf.clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay));
    return Math.hypot(pax - bax * h, pay - bay * h);
  },
  /** Alpha-composites src over dst (src alpha × a). */
  over(dst: Color, src: Color, a = 1) {
    const sa = src.a * a;
    const outA = sa + dst.a * (1 - sa);
    if (outA <= 1e-5) return Color.clear;
    return new Color((src.r * sa + dst.r * dst.a * (1 - sa)) / outA, (src.g * sa + dst.g * dst.a * (1 - sa)) / outA, (src.b * sa + dst.b * dst.a * (1 - sa)) / outA, outA);
  },
  lighten(c: Color, t: number) { return Color.lerp(c, new Color(1, 1, 1, c.a), t); },
  darken(c: Color, t: number) { return Color.lerp(c, new Color(0, 0, 0, c.a), t); },
  opaque(c: Color) { return new Color(c.r, c.g, c.b, 1); },

  /** Vertical gradient (top to bottom), 1 unit wide and 4 tall: stretch it with CasualLook.fitCover. */
  gradient(top: Color, bottom: Color, glow: Color = Color.clear) {
    return CasualArt.make("grad-" + key(top) + key(bottom) + key(glow), 64, 256, (p) => {
      const t = (p.y + 4) / 8;
      let c = Color.lerp(bottom, top, CasualArt.smooth(0, 1, t));
      if (glow.a > 0) {
        const g = Math.exp(-(p.x * p.x * 0.6 + (p.y - 1.6) * (p.y - 1.6) * 0.35));
        c = Color.lerp(c, CasualArt.opaque(glow), g * glow.a);
      }
      return c.withAlpha(1);
    });
  },

  /** Glossy ball with soft shading, rim and a specular highlight. */
  ball(c: Color, res = 128) { return CasualArt.make("ball-" + key(c) + res, res, res, (p) => CasualArt.ballPixel(p, c, 2 / res)); },

  ballPixel(p: V2, c: Color, px: number, radius = 0.94): Color {
    const r = p.magnitude;
    const a = CasualArt.fill(r - radius, px);
    if (a <= 0) return c.withAlpha(0);
    const qx = p.x / radius, qy = p.y / radius;
    const z = Math.sqrt(Math.max(0, 1 - (qx * qx + qy * qy)));
    const l = [-0.45, 0.6, 0.66], ll = Math.hypot(l[0], l[1], l[2]);
    const diff = Math.max(0, (qx * l[0] + qy * l[1] + z * l[2]) / ll);
    let col = c.mul(0.55 + 0.55 * diff).withAlpha(c.a);
    col = Color.lerp(col, CasualArt.lighten(c, 0.25), CasualArt.smooth(0.2, 1, -qy) * 0.25 * (1 - z));
    col = Color.lerp(col, CasualArt.darken(c, 0.45), CasualArt.smooth(0.78, 1, Math.hypot(qx, qy)) * 0.6);
    const hx = qx + 0.36, hy = qy - 0.42;
    const spec = CasualArt.smooth(0.34, 0, Math.hypot(hx * 1.1, hy * 1.5));
    col = Color.lerp(col, Color.white, spec * 0.85);
    return col.withAlpha(a * c.a);
  },

  get Soft() { return CasualArt.make("soft", 64, 64, (p) => { const a = CasualArt.smooth(1, 0.2, p.magnitude); return new Color(1, 1, 1, a * a); }); },
  get Dot() { return CasualArt.make("dot", 64, 64, (p) => new Color(1, 1, 1, CasualArt.fill(p.magnitude - 0.94, 2 / 64))); },
  get StarShape() { return CasualArt.make("star5", 96, 96, (p) => new Color(1, 1, 1, CasualArt.fill(CasualArt.sdStar(p.add(new V2(0, 0.06)), 0.92, 0.45), 3 / 96))); },

  /** Signed distance to a 5-point star pointing up (r = outer radius, rf = inner/outer ratio). */
  sdStar(p: V2, r: number, rf: number) {
    const k1x = 0.809016994, k1y = -0.587785252, k2x = -k1x, k2y = k1y;
    let px = Math.abs(p.x), py = p.y;
    let d = 2 * Math.max(k1x * px + k1y * py, 0); px -= d * k1x; py -= d * k1y;
    d = 2 * Math.max(k2x * px + k2y * py, 0); px -= d * k2x; py -= d * k2y;
    px = Math.abs(px);
    py -= r;
    const bax = rf * -k1y - 0, bay = rf * k1x - 1;
    const h = Mathf.clamp((px * bax + py * bay) / (bax * bax + bay * bay), 0, r);
    return Math.hypot(px - bax * h, py - bay * h) * Math.sign(py * bax - px * bay || 1);
  },

  /** Rounded rectangle for UI (9-sliced): fill, optional edge and a darker bottom lip. */
  panel(fill: Color, edge: Color, edgeWidth = 0.06, lip = 0) {
    const res = 128;
    return CasualArt.make("panel-" + key(fill) + key(edge) + edgeWidth + "-" + lip, res, res, (p) => {
      const px = 2 / res;
      const d = CasualArt.sdBox(p, new V2(0.98, 0.98), 0.5);
      const a = CasualArt.fill(d, px);
      let c = fill;
      if (lip > 0 && p.y < -0.98 + 0.5) c = Color.lerp(fill, CasualArt.darken(fill, 0.25), CasualArt.smooth(-0.98 + lip + 0.1, -0.98 + lip, p.y));
      if (edgeWidth > 0) c = Color.lerp(edge, c, CasualArt.fill(d + edgeWidth, px));
      return c.withAlpha(c.a * a);
    }, 48, 100);
  },
};
