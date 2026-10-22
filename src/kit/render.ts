import Phaser from "phaser";
import { Color, Mathf, V2, V3 } from "./math";
import { Component, GameObject, Mat } from "./scene";

/**
 * Bridge from the Unity-style scene graph to Phaser. Every renderer owns one flat Phaser object in a single display
 * list, ordered by `sortingOrder` like Unity (not by hierarchy). Each frame `Render.sync()` pushes world transforms
 * through the camera into screen pixels.
 */

/** A texture plus how it maps to world units (UnityEngine.Sprite). */
export class Sprite {
  constructor(
    readonly key: string,
    readonly width: number,
    readonly height: number,
    /** Pixels per world unit. */
    readonly ppu: number,
    /** 9-slice border in pixels (left, bottom, right, top) for UI. */
    readonly border: [number, number, number, number] = [0, 0, 0, 0],
    /** Source pixels (also used for DOM images). */
    readonly canvas: HTMLCanvasElement | null = null,
    /** Texture pixels per sprite pixel (procedural art is baked above its nominal size so stretched backgrounds stay smooth). */
    readonly texScale = 1,
  ) {}
  private _url = "";
  /** data: URL for DOM use (UI images), made on first use. */
  get url() {
    if (!this._url && this.canvas) this._url = this.canvas.toDataURL();
    return this._url;
  }
  get rect() { return { width: this.width, height: this.height }; }
  get bounds() { return { size: new V2(this.width / this.ppu, this.height / this.ppu) }; }
  get sliced() { return this.border.some((b) => b > 0); }
}

/** Blend + glow behaviour of a Unity material. */
export class Material {
  constructor(readonly name: string, readonly additive: boolean, readonly intensity = 1, readonly lineTexture: "soft" | "hard" | "none" = "none") {}
}

/** The orthographic camera. */
export const Camera = {
  orthographicSize: 5,
  position: new V2(0, 0),
  /** Roll in degrees (screen shake). */
  roll: 0,
  backgroundColor: Color.black,
  /** Screen size in device pixels (set by the host). */
  pixelWidth: 1,
  pixelHeight: 1,
  /** CSS pixels → device pixels. */
  dpr: 1,
  get aspect() { return this.pixelWidth / Math.max(1, this.pixelHeight); },
  /** Device pixels per world unit. */
  get ppu() { return this.pixelHeight / (2 * this.orthographicSize); },
  /** World → screen matrix (device pixels, y down). */
  view: new Mat(),
  updateView() {
    // screen = flipY(k · R(-roll) · (p - cam)) + centre; R(θ) = [cos −sin; sin cos]
    const k = this.ppu, th = -this.roll * Mathf.Deg2Rad, c = Math.cos(th), s = Math.sin(th);
    const m = this.view;
    m.a = k * c; m.c = -k * s;
    m.b = -k * s; m.d = -k * c;
    const px = this.position.x, py = this.position.y;
    m.tx = this.pixelWidth / 2 - (m.a * px + m.c * py);
    m.ty = this.pixelHeight / 2 - (m.b * px + m.d * py);
  },
  /** Screen point in device pixels (y down, like DOM ×dpr) → world. */
  screenToWorld(sx: number, sy: number) { return this.view.invert().apply(sx, sy); },
  worldToScreen(p: V2 | V3) { return this.view.apply(p.x, p.y); },
};

/** Screen-space post effects (drawn by the host): bloom strength 0..~2 and vignette 0..1. */
export const PostFX = { bloom: 0.9, vignette: 0.3 };

type Obj = Phaser.GameObjects.Image | Phaser.GameObjects.Graphics | Phaser.GameObjects.Text | Phaser.GameObjects.Container;

/** Shared state for every renderer. */
export const Render = {
  scene: null as Phaser.Scene | null,
  renderers: new Set<Renderer>(),
  textures: new Map<string, Sprite>(),

  /** Registers a canvas as a texture (idempotent). */
  addCanvasTexture(key: string, canvas: HTMLCanvasElement) {
    const t = this.scene!.textures;
    if (!t.exists(key)) t.addCanvas(key, canvas);
  },

  sync() {
    Camera.updateView();
    for (const r of this.renderers) r.sync();
  },
};

const tmp = new Mat();

export abstract class Renderer extends Component {
  private _order = 0;
  private _enabled = true;
  protected obj: Obj | null = null;
  protected shown = false;

  get sortingOrder() { return this._order; }
  set sortingOrder(v: number) { this._order = v; if (this.obj) this.obj.setDepth(v); }
  get enabled() { return this._enabled; }
  set enabled(v: boolean) { this._enabled = v; }
  get isVisible() { return this.shown; }

  onActiveChanged(active: boolean) {
    if (active) Render.renderers.add(this);
    else { Render.renderers.delete(this); this.obj?.setVisible(false); this.shown = false; }
  }
  onDestroy() { Render.renderers.delete(this); this.obj?.destroy(); this.obj = null; }

  protected abstract create(scene: Phaser.Scene): Obj;
  protected abstract draw(screen: Mat): boolean;

  sync() {
    const scene = Render.scene;
    if (!scene) return;
    if (!this._enabled) { if (this.obj) this.obj.setVisible(false); this.shown = false; return; }
    if (!this.obj) { this.obj = this.create(scene); this.obj.setDepth(this._order); }
    Camera.view.mul(this.gameObject.worldMatrix, tmp);
    this.shown = this.draw(tmp);
    this.obj.setVisible(this.shown);
  }
}

// ------------------------------------------------------------------ SpriteRenderer

export class SpriteRenderer extends Renderer {
  sprite: Sprite | null = null;
  color = Color.white;
  material: Material | null = null;
  flipX = false;
  flipY = false;

  protected create(scene: Phaser.Scene) {
    return scene.add.image(0, 0, this.sprite?.key ?? "__WHITE");
  }

  protected draw(m: Mat) {
    const s = this.sprite;
    if (!s || this.color.a <= 0.002) return false;
    const img = this.obj as Phaser.GameObjects.Image;
    if (img.texture.key !== s.key) img.setTexture(s.key);
    const sx = m.scaleX, sy = m.scaleY;
    img.setPosition(m.tx, m.ty);
    img.setRotation(Math.atan2(m.b, m.a));
    // Sprite is width/ppu world units wide; m already includes world→pixels.
    const k = s.ppu * s.texScale;
    img.setScale((sx / k) * (this.flipX ? -1 : 1), (sy / k) * (this.flipY ? -1 : 1) * -1);
    // The Unity glow shader multiplies rgb by the material intensity (HDR neon); clamped here.
    img.setTint(this.color.scale(this.material?.intensity ?? 1).rgbInt);
    img.setAlpha(Mathf.clamp01(this.color.a));
    img.setBlendMode(this.material?.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    return true;
  }

  get bounds() {
    const s = this.sprite, p = this.gameObject.position, ls = this.gameObject.lossyScale;
    const w = s ? (s.width / s.ppu) * Math.abs(ls.x) : 0, h = s ? (s.height / s.ppu) * Math.abs(ls.y) : 0;
    return { center: p, size: new V2(w, h), extents: new V2(w / 2, h / 2) };
  }
}

// ------------------------------------------------------------------ LineRenderer

/** Line drawn as stretched quads with round joints, using the soft neon line texture or a hard edge. */
export class LineRenderer extends Renderer {
  private points: V3[] = [];
  startColor = Color.white;
  endColor = Color.white;
  widthMultiplier = 0.1;
  startWidth = 1;
  endWidth = 1;
  loop = false;
  useWorldSpace = true;
  material: Material | null = null;
  numCapVertices = 2;
  numCornerVertices = 2;
  private pool: Phaser.GameObjects.Image[] = [];

  get positionCount() { return this.points.length; }
  set positionCount(n: number) {
    if (n < this.points.length) this.points.length = n;
    else while (this.points.length < n) this.points.push(V3.zero);
  }
  setPosition(i: number, p: V3 | V2) { this.points[i] = p instanceof V3 ? p : new V3(p.x, p.y, 0); }
  getPosition(i: number) { return this.points[i]; }
  setPositions(ps: (V3 | V2)[]) { this.points = ps.map((p) => (p instanceof V3 ? p : new V3(p.x, p.y, 0))); }
  set color(c: Color) { this.startColor = this.endColor = c; }

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
    const segTex = soft ? "__line_soft" : "__white";
    const capTex = soft ? "__line_cap" : "__disc";
    const add = this.material ? this.material.additive : true;
    const blend = add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL;
    // world width → pixels (soft lines fade out at the edge, so draw them a bit wider like Unity's texture)
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
      const t0 = i / segs, t1 = (i + 1) / segs, tm = (t0 + t1) / 2;
      const col = Color.lerp(this.startColor, this.endColor, tm);
      const w = this.widthMultiplier * Mathf.lerp(this.startWidth, this.endWidth, tm) * pxPerUnit;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.01) continue;
      const img = take(segTex);
      img.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2).setRotation(Math.atan2(b.y - a.y, b.x - a.x));
      img.setDisplaySize(len, w).setTint(col.rgbInt).setAlpha(Mathf.clamp01(col.a));
    }
    // round caps and joints
    for (let i = 0; i < pts.length; i++) {
      if (this.loop && i === pts.length - 1) break;
      const t = i / segs;
      const col = Color.lerp(this.startColor, this.endColor, t);
      const w = this.widthMultiplier * Mathf.lerp(this.startWidth, this.endWidth, t) * pxPerUnit;
      const img = take(capTex);
      img.setPosition(pts[i].x, pts[i].y).setRotation(0).setDisplaySize(w, w).setTint(col.rgbInt).setAlpha(Mathf.clamp01(col.a) * (soft ? 0.8 : 1));
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

// ------------------------------------------------------------------ Mesh

export class Mesh {
  name = "Mesh";
  vertices: V3[] = [];
  triangles: number[] = [];
  colors: Color[] = [];
  uv: V2[] = [];
  version = 0;
  clear() { this.vertices = []; this.triangles = []; this.colors = []; this.uv = []; this.version++; }
  /** Call after editing arrays in place. */
  markDirty() { this.version++; }
  setVertices(v: V3[]) { this.vertices = v; this.version++; }
  setTriangles(t: number[]) { this.triangles = t; this.version++; }
  setColors(c: Color[]) { this.colors = c; this.version++; }
  recalculateBounds() { /* not needed */ }
}

/** Draws a Mesh as flat-coloured triangles (vertex colour of the first corner, alpha averaged). */
export class MeshRenderer extends Renderer {
  mesh: Mesh | null = null;
  material: Material | null = null;
  /** Tint applied on top of vertex colours (material colour). */
  color = Color.white;
  private drawnVersion = -1;
  private drawnKey = "";

  protected create(scene: Phaser.Scene) { return scene.add.graphics(); }

  protected draw(m: Mat) {
    const mesh = this.mesh;
    if (!mesh || mesh.triangles.length === 0) return false;
    const g = this.obj as Phaser.GameObjects.Graphics;
    // Graphics holds local geometry; position it with the screen matrix so redraws only happen when the mesh changes.
    const key = `${this.color.rgbInt}|${this.color.a}`;
    if (mesh.version !== this.drawnVersion || key !== this.drawnKey) {
      g.clear();
      const v = mesh.vertices, cols = mesh.colors, t = mesh.triangles;
      for (let i = 0; i + 2 < t.length; i += 3) {
        const c = cols.length ? cols[t[i]] : Color.white;
        const a = cols.length ? (cols[t[i]].a + cols[t[i + 1]].a + cols[t[i + 2]].a) / 3 : 1;
        const tint = c.mul(this.color);
        g.fillStyle(tint.rgbInt, Mathf.clamp01(a * this.color.a));
        const p0 = v[t[i]], p1 = v[t[i + 1]], p2 = v[t[i + 2]];
        g.fillTriangle(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
      }
      this.drawnVersion = mesh.version;
      this.drawnKey = key;
    }
    g.setPosition(m.tx, m.ty);
    g.setRotation(Math.atan2(m.b, m.a));
    g.setScale(m.scaleX, m.scaleY);
    g.setBlendMode(this.material?.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    return true;
  }
}

// ------------------------------------------------------------------ TextMesh

/** World-space text (TextMesh). characterSize × fontSize ≈ height in world units / 10, like Unity. */
export class TextMesh extends Renderer {
  text = "";
  fontSize = 32;
  characterSize = 0.1;
  color = Color.white;
  anchor: "UpperLeft" | "UpperCenter" | "MiddleCenter" | "MiddleLeft" | "LowerCenter" = "MiddleCenter";
  fontStyle: "normal" | "bold" = "bold";

  protected create(scene: Phaser.Scene) {
    return scene.add.text(0, 0, "", { fontFamily: "Arial, Helvetica, sans-serif", fontStyle: "bold", fontSize: "64px", color: "#ffffff" });
  }

  protected draw(m: Mat) {
    const t = this.obj as Phaser.GameObjects.Text;
    if (!this.text) return false;
    if (t.text !== this.text) t.setText(this.text);
    const ox = this.anchor.endsWith("Left") ? 0 : 0.5;
    const oy = this.anchor.startsWith("Upper") ? 0 : this.anchor.startsWith("Lower") ? 1 : 0.5;
    t.setOrigin(ox, oy);
    t.setFontStyle(this.fontStyle);
    // Unity: one line ≈ fontSize · characterSize / 10 world units tall.
    const worldHeight = (this.fontSize * this.characterSize) / 10;
    const k = (worldHeight * Math.abs(m.scaleY)) / 64;
    t.setPosition(m.tx, m.ty).setRotation(Math.atan2(m.b, m.a)).setScale(k * Math.sign(m.scaleX || 1), k);
    t.setColor(this.color.css);
    return true;
  }
}

/** Convenience: attach a renderer to a new child object. */
export function child<T extends Renderer>(parent: GameObject | null, name: string, r: T): T {
  new GameObject(name, parent).addComponent(r);
  return r;
}
