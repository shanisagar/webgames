import Phaser from "phaser";
import { Art as KitArt, Behaviour, Camera, Color, Material, Mathf, Render, Renderer, Time, V2, V3, type Mat } from "../../kit";

/**
 * Procedurally generated sprites and materials (Art.cs). The game ships with no texture assets: every shape is
 * rasterized from a signed-distance function the first time it is requested. Shapes that the kit already bakes with
 * the very same functions (glow, disc, ring, the UI shapes, the shuriken = kit star) are shared with it.
 */
export const Art = {
  // ------------------------------------------------------------------ world sprites (1 unit wide)
  get Glow() { return KitArt.Glow; },
  get Disc() { return KitArt.Disc; },
  get Ring() { return KitArt.Ring; },

  /** Hunter: an aggressive dart pointing along +X. */
  get Dart() {
    return KitArt.shape("lumi-dart", (p) => KitArt.poly(p, new V2(0.95, 0), new V2(-0.75, 0.72), new V2(-0.36, 0), new V2(-0.75, -0.72)));
  },

  /** Cutter: a four-bladed shuriken. */
  get Shuriken() {
    return KitArt.shape("lumi-shuriken", (p) => {
      const pts: V2[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + (i % 2 === 1 ? 0.28 : 0);
        const r = i % 2 === 0 ? 0.96 : 0.3;
        pts.push(new V2(Math.cos(a), Math.sin(a)).mul(r));
      }
      const body = KitArt.poly(p, ...pts);
      const hole = KitArt.edge(0.12 - p.magnitude, 128);
      return body * (1 - hole);
    });
  },

  /** Prism: a faceted hexagonal gem. */
  get Gem() {
    return KitArt.shape("lumi-gem", (p) => {
      const outer: V2[] = [], inner: V2[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + Math.PI / 6;
        outer.push(new V2(Math.cos(a), Math.sin(a)).mul(0.92));
        inner.push(new V2(Math.cos(a), Math.sin(a)).mul(0.5));
      }
      return KitArt.poly(p, ...outer) * (1 - 0.5 * KitArt.poly(p, ...inner));
    });
  },

  // ------------------------------------------------------------------ UI sprites
  get UiRound() { return KitArt.UiRound; },
  get UiOutline() { return KitArt.UiOutline; },
  get UiRing() { return KitArt.UiRing; },
  get UiCircle() { return KitArt.UiCircle; },

  // ------------------------------------------------------------------ materials (Glow.shader: texture * colour * intensity)

  /** Additive glow (halos, rings). */
  Additive: new Material("Lumiloop Additive", true, 1.8),
  /** Alpha-blended, slightly over-bright bodies so they read on the backdrop and still bloom. */
  Solid: new Material("Lumiloop Solid", false, 1.6),
  /** Soft cross-section profile (the kit's line texture is the same pow(1 - v, 1.6) profile). */
  Trail: new Material("Lumiloop Trail", true, 2.6, "soft"),
  Fill: new Material("Lumiloop Fill", true, 1, "hard"),
  Particles: new Material("Lumiloop Particles", true, 2.2),
};

// ------------------------------------------------------------------ Gradient + line renderer

/**
 * The line texture's soft profile pow(1 - v, 1.6) with the Glow shader's HDR intensity folded in (the kit's tints clamp
 * at 1): min(1, intensity * profile). Gives the trail the same bright core and width it has in Unity.
 */
function hotLineTexture(scene: Phaser.Scene, intensity: number, cap: boolean) {
  const key = `lumi-line-${cap ? "cap" : "seg"}-${intensity}`;
  if (scene.textures.exists(key)) return key;
  const c = document.createElement("canvas");
  const n = 64;
  c.width = cap ? n : 4;
  c.height = n;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const v = cap ? Math.min(1, Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1)) : Math.abs(((y + 0.5) / n) * 2 - 1);
      const o = (y * c.width + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(Mathf.clamp01(intensity * Math.pow(1 - v, 1.6)) * 255);
    }
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(key, c);
  return key;
}

/** UnityEngine.Gradient (blend mode: linear). Keys are (value, time). */
export class Gradient {
  constructor(public colorKeys: [Color, number][] = [[Color.white, 0], [Color.white, 1]], public alphaKeys: [number, number][] = [[1, 0], [1, 1]]) {}

  evaluate(t: number) {
    const ck = this.colorKeys, ak = this.alphaKeys;
    let c = ck[0][0];
    if (t >= ck[ck.length - 1][1]) c = ck[ck.length - 1][0];
    else for (let i = 0; i < ck.length - 1; i++) if (t >= ck[i][1] && t <= ck[i + 1][1]) { c = Color.lerp(ck[i][0], ck[i + 1][0], (t - ck[i][1]) / Math.max(1e-6, ck[i + 1][1] - ck[i][1])); break; }
    let a = ak[0][0];
    if (t >= ak[ak.length - 1][1]) a = ak[ak.length - 1][0];
    else for (let i = 0; i < ak.length - 1; i++) if (t >= ak[i][1] && t <= ak[i + 1][1]) { a = Mathf.lerp(ak[i][0], ak[i + 1][0], (t - ak[i][1]) / Math.max(1e-6, ak[i + 1][1] - ak[i][1])); break; }
    return c.withAlpha(a);
  }
}

/**
 * LineRenderer with Unity's colorGradient and a linear widthCurve (kit gap: the kit LineRenderer only lerps start/end
 * colour and width). Drawn exactly like the kit's: soft-textured quads per segment plus round soft joints.
 */
export class GlowLine extends Renderer {
  private points: V3[] = [];
  colorGradient: Gradient | null = null;
  startColor = Color.white;
  endColor = Color.white;
  widthMultiplier = 0.1;
  /** widthCurve keyframes (0, start) → (1, end). */
  widthStart = 1;
  widthEnd = 1;
  loop = false;
  useWorldSpace = true;
  material: Material | null = Art.Trail;
  private pool: Phaser.GameObjects.Image[] = [];

  get positionCount() { return this.points.length; }
  set positionCount(n: number) {
    if (n < this.points.length) this.points.length = n;
    else while (this.points.length < n) this.points.push(V3.zero);
  }
  setPosition(i: number, p: V3 | V2) { this.points[i] = p instanceof V3 ? p : new V3(p.x, p.y, 0); }
  setPositions(ps: (V3 | V2)[], count = ps.length) {
    this.points.length = count;
    for (let i = 0; i < count; i++) { const p = ps[i]; this.points[i] = p instanceof V3 ? p : new V3(p.x, p.y, 0); }
  }

  private colorAt(t: number) { return this.colorGradient ? this.colorGradient.evaluate(t) : Color.lerp(this.startColor, this.endColor, t); }

  protected create(scene: Phaser.Scene) { return scene.add.container(0, 0); }

  onDestroy() { for (const p of this.pool) p.destroy(); this.pool = []; super.onDestroy(); }

  protected draw(m: Mat) {
    const n = this.points.length;
    if (n < 2) { this.pool.forEach((p) => p.setVisible(false)); return false; }
    const scene = Render.scene!;
    const toScreen = this.useWorldSpace ? Camera.view : m;
    const pts = this.points.map((p) => toScreen.apply(p.x, p.y));
    if (this.loop) pts.push(pts[0]);
    const soft = (this.material?.lineTexture ?? "soft") === "soft";
    const segTex = soft ? hotLineTexture(scene, this.material?.intensity ?? 1, false) : "__white";
    const capTex = soft ? hotLineTexture(scene, this.material?.intensity ?? 1, true) : "__disc";
    const blend = this.material?.additive ?? true ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL;
    const pxPerUnit = Camera.ppu;
    let used = 0;
    const segs = pts.length - 1;
    const take = (key: string) => {
      let img = this.pool[used];
      if (!img) { img = scene.add.image(0, 0, key); this.pool.push(img); }
      if (img.texture.key !== key) img.setTexture(key);
      img.setDepth(this.sortingOrder).setBlendMode(blend).setVisible(true);
      used++;
      return img;
    };
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[i + 1];
      const tm = (i + 0.5) / segs;
      const col = this.colorAt(tm);
      const w = this.widthMultiplier * Mathf.lerp(this.widthStart, this.widthEnd, tm) * pxPerUnit;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.01 || col.a <= 0.002) continue;
      const img = take(segTex);
      img.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2).setRotation(Math.atan2(b.y - a.y, b.x - a.x));
      img.setDisplaySize(len, w).setTint(col.rgbInt).setAlpha(Mathf.clamp01(col.a));
    }
    // round caps, and faint joints (additive: full-strength joints would bead up along the many short trail segments)
    for (let i = 0; i < pts.length; i++) {
      if (this.loop && i === pts.length - 1) break;
      const t = i / segs;
      const col = this.colorAt(t);
      if (col.a <= 0.002) continue;
      const w = this.widthMultiplier * Mathf.lerp(this.widthStart, this.widthEnd, t) * pxPerUnit;
      const img = take(capTex);
      img.setPosition(pts[i].x, pts[i].y).setRotation(0).setDisplaySize(w, w).setTint(col.rgbInt).setAlpha(Mathf.clamp01(col.a) * (!soft ? 1 : !this.loop && (i === 0 || i === pts.length - 1) ? 0.8 : 0.3));
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].setVisible(false);
    return true;
  }

  sync() {
    super.sync();
    if (!this.shown) for (const p of this.pool) p.setVisible(false);
  }
  onActiveChanged(active: boolean) { super.onActiveChanged(active); if (!active) for (const p of this.pool) p.setVisible(false); }
}

// ------------------------------------------------------------------ Backdrop.shader

const BACKDROP_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uTop, uBottom, uNebulaA, uNebulaB, uGrid, uDangerColor;
uniform vec2 uSize, uView, uCam;
uniform float uRoll, uDanger, uFw;
uniform vec4 uFlash;

float hash21(vec2 p)
{
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main()
{
    // The quad sits at the arena centre, 1.12x the view: find this pixel's uv on it through the (shaking) camera.
    vec2 s = (gl_FragCoord.xy / uRes - 0.5) * uView;
    float cr = cos(uRoll), sr = sin(uRoll);
    vec2 world = uCam + vec2(s.x * cr - s.y * sr, s.x * sr + s.y * cr);
    vec2 uv = world / uSize + 0.5;

    float t = uTime;
    vec2 w = (uv - 0.5) * uSize;                 // world units from the centre
    vec2 aspect = vec2(uSize.x / max(uSize.y, 0.001), 1.0);

    vec3 col = mix(uBottom, uTop, smoothstep(0.0, 1.0, uv.y));

    // Two slow nebula clouds.
    vec2 c1 = vec2(sin(t * 0.05) * 0.25 - 0.15, cos(t * 0.04) * 0.2 + 0.2);
    vec2 c2 = vec2(cos(t * 0.03) * 0.2 + 0.2, sin(t * 0.06) * 0.25 - 0.25);
    vec2 d1 = (uv - 0.5 - c1) * aspect;
    vec2 d2 = (uv - 0.5 - c2) * aspect;
    col += uNebulaA * exp(-dot(d1, d1) * 7.0) * 0.10;
    col += uNebulaB * exp(-dot(d2, d2) * 8.0) * 0.08;

    // Dot grid, one dot per world unit.
    vec2 g = fract(w + 0.5) - 0.5;
    float fw = max(uFw, 0.0001);
    float dotMask = 1.0 - smoothstep(0.035, 0.035 + fw * 1.5, length(g));
    col += uGrid * dotMask * 0.09;

    // Twinkling star field drifting upward.
    vec2 sw = w * 0.9 + vec2(0.0, t * 0.05);
    vec2 cell = floor(sw);
    float h = hash21(cell);
    vec2 jitter = vec2(hash21(cell + 17.1), hash21(cell + 43.7)) - 0.5;
    vec2 sp = fract(sw) - 0.5 - jitter * 0.6;
    float twinkle = 0.55 + 0.45 * sin(t * (0.8 + h * 2.5) + h * 60.0);
    float star = step(0.9, h) * (1.0 - smoothstep(0.0, 0.06, length(sp))) * twinkle;
    col += star * 0.55;

    // Low-light warning glow around the edges.
    vec2 e = (uv - 0.5) * 2.0;
    float edge = smoothstep(0.55, 1.25, length(e * vec2(1.0, 0.9)));
    col += uDangerColor * uDanger * edge * (0.55 + 0.45 * sin(t * 7.0)) * 0.6;

    col = mix(col, uFlash.rgb, clamp(uFlash.a, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
}`;

/**
 * The Backdrop material on its quad: gradient, drifting nebulae, a faint dot grid, twinkling stars, a pulsing red edge
 * when the player's light runs low and a full-screen flash. Drawn as one full-screen Phaser shader behind everything.
 */
export class BackdropQuad extends Behaviour {
  private shader: Phaser.GameObjects.Shader | null = null;
  private fallback: Phaser.GameObjects.Graphics | null = null;
  /** Material properties (Backdrop.shader defaults). */
  Top = new Color(0.08, 0.04, 0.18, 1);
  Bottom = new Color(0.01, 0.015, 0.05, 1);
  NebulaA = new Color(0.2, 0.6, 1, 1);
  NebulaB = new Color(0.9, 0.2, 0.7, 1);
  Grid = new Color(0.45, 0.8, 1, 1);
  DangerColor = new Color(1, 0.15, 0.25, 1);
  Size = new V2(16, 28);
  Danger = 0;
  Flash = new Color(0, 0, 0, 0);

  init() {
    const scene = Render.scene!;
    if (scene.game.renderer.type === Phaser.WEBGL) {
      const v3 = (c: Color) => ({ type: "3f", value: { x: c.r, y: c.g, z: c.b } });
      const v2 = (x: number, y: number) => ({ type: "2f", value: { x, y } });
      const f1 = (v: number) => ({ type: "1f", value: v });
      const base = new Phaser.Display.BaseShader("lumiloop-backdrop", BACKDROP_FRAG, undefined, {
        uRes: v2(1, 1), uTime: f1(0),
        uTop: v3(this.Top), uBottom: v3(this.Bottom), uNebulaA: v3(this.NebulaA), uNebulaB: v3(this.NebulaB),
        uGrid: v3(this.Grid), uDangerColor: v3(this.DangerColor),
        uSize: v2(16, 28), uView: v2(16, 28), uCam: v2(0, 0),
        uRoll: f1(0), uDanger: f1(0), uFw: f1(0.01),
        uFlash: { type: "4f", value: { x: 0, y: 0, z: 0, w: 0 } },
      });
      this.shader = scene.add.shader(base, 0, 0, Camera.pixelWidth, Camera.pixelHeight).setOrigin(0, 0).setDepth(-100);
    } else {
      this.fallback = scene.add.graphics().setDepth(-100);
    }
  }

  onDestroy() { this.shader?.destroy(); this.fallback?.destroy(); }

  lateUpdate() {
    const W = Camera.pixelWidth, H = Camera.pixelHeight;
    const h = Camera.orthographicSize * 2, w = h * Camera.aspect;
    const s = this.shader;
    if (s) {
      if (s.width !== W || s.height !== H) s.setSize(W, H);
      const set = (k: string, v: number) => s.setUniform(k, v);
      const col3 = (k: string, c: Color) => { set(k + ".value.x", c.r); set(k + ".value.y", c.g); set(k + ".value.z", c.b); };
      set("uRes.value.x", W); set("uRes.value.y", H);
      set("uTime.value", Time.time);
      col3("uTop", this.Top); col3("uBottom", this.Bottom);
      set("uSize.value.x", this.Size.x); set("uSize.value.y", this.Size.y);
      set("uView.value.x", w); set("uView.value.y", h);
      set("uCam.value.x", Camera.position.x); set("uCam.value.y", Camera.position.y);
      set("uRoll.value", Camera.roll * Mathf.Deg2Rad);
      set("uDanger.value", this.Danger);
      set("uFw.value", h / Math.max(1, H));
      set("uFlash.value.x", this.Flash.r); set("uFlash.value.y", this.Flash.g); set("uFlash.value.z", this.Flash.b); set("uFlash.value.w", this.Flash.a);
    } else if (this.fallback) {
      const g = this.fallback;
      g.clear();
      const top = Color.lerp(this.Top, this.Flash, this.Flash.a), bottom = Color.lerp(this.Bottom, this.Flash, this.Flash.a);
      g.fillGradientStyle(top.rgbInt, top.rgbInt, bottom.rgbInt, bottom.rgbInt, 1);
      g.fillRect(0, 0, W, H);
    }
  }
}
