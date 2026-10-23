import { Art } from "./art";
import { Color, Mathf, Pal, V2, V3 } from "./math";
import { Sprite } from "./render";
import { Quaternion, Time } from "./scene";
import { Sfx, Snd } from "./sfx";
import { Screen } from "./input";
import { Fx } from "./fx";

/**
 * uGUI rebuilt on the DOM. Every node has Unity RectTransform semantics (anchors, pivot, anchoredPosition, sizeDelta,
 * offsets) in canvas units: the canvas is 1080 units along the screen's short side (CanvasScaler: 1080×1920 portrait
 * matching width, 1920×1080 landscape matching height), y up.
 */

/** Per-frame UI callbacks (button squash, pulsing halos...). */
export const UITicks = new Set<() => void>();

export enum TextAnchor { UpperLeft, UpperCenter, UpperRight, MiddleLeft, MiddleCenter, MiddleRight, LowerLeft, LowerCenter, LowerRight }
export enum FontStyle { Normal, Bold, Italic, BoldAndItalic }
export enum ImageType { Simple, Sliced, Filled }

export const FONT = `"Arial Rounded MT Bold", "Arial", "Helvetica Neue", Helvetica, sans-serif`;

/** A UI node: GameObject + RectTransform. `.rectTransform`, `.transform` and `.gameObject` all return the node. */
export class UINode {
  readonly el: HTMLDivElement;
  name: string;
  parent: UINode | null = null;
  readonly children: UINode[] = [];
  private _anchorMin = new V2(0.5, 0.5);
  private _anchorMax = new V2(0.5, 0.5);
  private _pivot = new V2(0.5, 0.5);
  private _pos = V2.zero;
  private _size = new V2(100, 100);
  private _scale = V3.one;
  private _rot = 0;
  private _active = true;
  /** Computed rect in parent space (canvas units, y up): min corner + size. */
  private rx = 0;
  private ry = 0;
  private rw = 0;
  private rh = 0;
  image: Image | null = null;
  textC: Text | null = null;
  button: ArcadeButton | null = null;
  group: CanvasGroup | null = null;
  private extras: unknown[] = [];

  constructor(name: string, parent: UINode | null, el?: HTMLDivElement) {
    this.name = name;
    this.el = el ?? document.createElement("div");
    this.el.className = this.el.className || "na-n";
    this.el.dataset.n = name;
    if (parent) parent.addChild(this);
  }

  get rectTransform() { return this; }
  get transform() { return this; }
  get gameObject() { return this; }

  addChild(c: UINode) {
    c.parent = this;
    this.children.push(c);
    this.el.appendChild(c.el);
    c.layout();
  }

  // ------------------------------------------------------------------ RectTransform

  get anchorMin() { return this._anchorMin; }
  set anchorMin(v: V2) { this._anchorMin = v; this.layout(); }
  get anchorMax() { return this._anchorMax; }
  set anchorMax(v: V2) { this._anchorMax = v; this.layout(); }
  get pivot() { return this._pivot; }
  set pivot(v: V2) { this._pivot = v; this.layout(); }
  get anchoredPosition() { return this._pos; }
  set anchoredPosition(v: V2) { if (v.x === this._pos.x && v.y === this._pos.y) return; this._pos = v; this.layout(); }
  get sizeDelta() { return this._size; }
  set sizeDelta(v: V2) { if (v.x === this._size.x && v.y === this._size.y) return; this._size = v; this.layout(); }
  get localScale() { return this._scale; }
  set localScale(v: V3 | V2) {
    const s = v instanceof V3 ? v : new V3(v.x, v.y, 1);
    if (s.x === this._scale.x && s.y === this._scale.y) return;
    this._scale = s;
    this.applyTransform();
  }
  get localRotation() { return new Quaternion(this._rot); }
  set localRotation(q: Quaternion) { this._rot = q.z; this.applyTransform(); }
  get localEulerAngles() { return new V3(0, 0, this._rot); }
  set localEulerAngles(v: V3) { this._rot = v.z; this.applyTransform(); }
  /** Unity UI code sometimes moves nodes with localPosition (relative to the parent's pivot). */
  get localPosition() {
    const p = this.parent;
    const pw = p ? p.rw : 0, ph = p ? p.rh : 0, pp = p ? p._pivot : V2.zero;
    return new V3(this.rx + this._pivot.x * this.rw - pp.x * pw, this.ry + this._pivot.y * this.rh - pp.y * ph, 0);
  }
  set localPosition(v: V3 | V2) {
    const cur = this.localPosition;
    this.anchoredPosition = this._pos.add(new V2(v.x - cur.x, v.y - cur.y));
  }

  get offsetMin() { const pw = this.parent?.rw ?? 0, ph = this.parent?.rh ?? 0; return new V2(this.rx - this._anchorMin.x * pw, this.ry - this._anchorMin.y * ph); }
  set offsetMin(v: V2) {
    const om = this.offsetMin, dx = v.x - om.x, dy = v.y - om.y;
    this._size = new V2(this._size.x - dx, this._size.y - dy);
    this._pos = new V2(this._pos.x + dx * (1 - this._pivot.x), this._pos.y + dy * (1 - this._pivot.y));
    this.layout();
  }
  get offsetMax() { const pw = this.parent?.rw ?? 0, ph = this.parent?.rh ?? 0; return new V2(this.rx + this.rw - this._anchorMax.x * pw, this.ry + this.rh - this._anchorMax.y * ph); }
  set offsetMax(v: V2) {
    const om = this.offsetMax, dx = v.x - om.x, dy = v.y - om.y;
    this._size = new V2(this._size.x + dx, this._size.y + dy);
    this._pos = new V2(this._pos.x + dx * this._pivot.x, this._pos.y + dy * this._pivot.y);
    this.layout();
  }

  /** Local rect relative to the pivot (RectTransform.rect). */
  get rect() {
    const w = this.rw, h = this.rh, x = -this._pivot.x * w, y = -this._pivot.y * h;
    return { x, y, width: w, height: h, size: new V2(w, h), center: new V2(x + w / 2, y + h / 2), xMin: x, yMin: y, xMax: x + w, yMax: y + h };
  }

  /** Recomputes this node's rect from its parent, writes CSS, then lays out the children. */
  layout() {
    const p = this.parent;
    const pw = p ? p.rw : this.rw, ph = p ? p.rh : this.rh;
    if (p) {
      const ax0 = this._anchorMin.x * pw, ay0 = this._anchorMin.y * ph, ax1 = this._anchorMax.x * pw, ay1 = this._anchorMax.y * ph;
      const w = ax1 - ax0 + this._size.x, h = ay1 - ay0 + this._size.y;
      const px = ax0 + (ax1 - ax0) * this._pivot.x + this._pos.x, py = ay0 + (ay1 - ay0) * this._pivot.y + this._pos.y;
      this.rx = px - this._pivot.x * w;
      this.ry = py - this._pivot.y * h;
      this.rw = w;
      this.rh = h;
      const s = this.el.style;
      s.left = this.rx + "px";
      s.top = ph - (this.ry + h) + "px";
      s.width = Math.max(0, w) + "px";
      s.height = Math.max(0, h) + "px";
      s.transformOrigin = `${this._pivot.x * 100}% ${(1 - this._pivot.y) * 100}%`;
    }
    this.textC?.relayout();
    this.image?.onRect(this.rw, this.rh);
    for (const c of this.children) c.layout();
  }

  /** Root only: sets its size directly. */
  setRootSize(w: number, h: number) { this.rw = w; this.rh = h; for (const c of this.children) c.layout(); }

  private applyTransform() {
    const sc = this._scale, r = this._rot;
    this.el.style.transform = sc.x === 1 && sc.y === 1 && r === 0 ? "" : `rotate(${-r}deg) scale(${sc.x}, ${sc.y})`;
  }

  // ------------------------------------------------------------------ hierarchy / activity

  get activeSelf() { return this._active; }
  get activeInHierarchy(): boolean { return this._active && (!this.parent || this.parent.activeInHierarchy); }
  setActive(on: boolean) {
    if (on === this._active) return;
    this._active = on;
    this.el.style.display = on ? "" : "none";
    if (on) this.layout();
    this.button?.onActiveChanged(on);
  }
  get childCount() { return this.children.length; }
  getChild(i: number) { return this.children[i]; }
  find(name: string): UINode | null {
    for (const c of this.children) if (c.name === name) return c;
    const parts = name.split("/");
    if (parts.length > 1) { let n: UINode | null = this; for (const part of parts) n = n?.find(part) ?? null; return n; }
    return null;
  }
  getSiblingIndex() { return this.parent ? this.parent.children.indexOf(this) : 0; }
  setAsFirstSibling() { this.setSiblingIndex(0); }
  setAsLastSibling() { this.setSiblingIndex(Infinity); }
  setSiblingIndex(i: number) {
    const p = this.parent;
    if (!p) return;
    const list = p.children;
    list.splice(list.indexOf(this), 1);
    i = Math.min(i, list.length);
    list.splice(i, 0, this);
    const after = list[i + 1];
    p.el.insertBefore(this.el, after ? after.el : null);
  }
  setParent(p: UINode, _worldPositionStays = false) {
    if (this.parent) { const l = this.parent.children; l.splice(l.indexOf(this), 1); }
    p.addChild(this);
  }
  destroy() {
    for (const c of [...this.children]) c.destroy();
    this.button?.dispose();
    if (this.parent) { const l = this.parent.children; l.splice(l.indexOf(this), 1); }
    this.el.remove();
  }

  /** Absolute rect of this node in canvas units (ignores scale/rotation). */
  canvasRect() {
    let x = this.rx, y = this.ry;
    for (let p = this.parent; p; p = p.parent) { x += p.rx; y += p.ry; }
    return { x, y, w: this.rw, h: this.rh };
  }

  /** Screen point (Unity device px, y up) → local point relative to this node's pivot. */
  screenToLocal(screen: V2) {
    const c = UI.screenToCanvas(screen), r = this.canvasRect();
    return new V2(c.x - (r.x + this._pivot.x * r.w), c.y - (r.y + this._pivot.y * r.h));
  }

  // ------------------------------------------------------------------ helpers (UIKit extension methods)

  place(anchor: V2, position: V2, size: V2) {
    this._anchorMin = this._anchorMax = anchor;
    this._pivot = new V2(0.5, 0.5);
    this._pos = position;
    this._size = size;
    this.layout();
    return this;
  }

  stretch(inset = 0) {
    this._anchorMin = V2.zero;
    this._anchorMax = V2.one;
    this._pivot = new V2(0.5, 0.5);
    this._pos = V2.zero;
    this._size = new V2(-inset * 2, -inset * 2);
    this.layout();
    return this;
  }

  /** Extra per-node data (games' own fields). */
  addComponent<T>(c: T): T { this.extras.push(c); return c; }
  getComponent<T>(type: abstract new (...args: never[]) => T): T | null {
    if (type === (Image as unknown)) return this.image as T | null;
    if (type === (Text as unknown)) return this.textC as T | null;
    if (type === (ArcadeButton as unknown)) return this.button as T | null;
    if (type === (CanvasGroup as unknown)) return this.group as T | null;
    for (const e of this.extras) if (e instanceof type) return e;
    return null;
  }
  getComponentInChildren<T>(type: abstract new (...args: never[]) => T): T | null {
    const own = this.getComponent(type);
    if (own) return own;
    for (const c of this.children) { const f = c.getComponentInChildren(type); if (f) return f; }
    return null;
  }
}

// ------------------------------------------------------------------ CanvasGroup

export class CanvasGroup {
  private _alpha = 1;
  private _blocks = true;
  interactable = true;
  constructor(readonly node: UINode) { node.group = this; }
  get gameObject() { return this.node; }
  get transform() { return this.node; }
  get rectTransform() { return this.node; }
  get alpha() { return this._alpha; }
  set alpha(v: number) { if (v === this._alpha) return; this._alpha = v; this.node.el.style.opacity = v >= 0.999 ? "" : String(Math.max(0, v)); }
  get blocksRaycasts() { return this._blocks; }
  set blocksRaycasts(v: boolean) { this._blocks = v; this.node.el.classList.toggle("na-noray", !v); }
}

// ------------------------------------------------------------------ Image

const tintCache = new Map<string, string>();
const q = (v: number) => Math.round(Mathf.clamp01(v) * 255);

/** A sprite tinted by rgb (multiply), as a data URL. Cached; colours are quantized to bound the cache. */
function tinted(s: Sprite, c: Color) {
  const k = `${s.key}|${q(c.r) >> 2}|${q(c.g) >> 2}|${q(c.b) >> 2}`;
  let url = tintCache.get(k);
  if (url) return url;
  const src = s.canvas!;
  const cv = document.createElement("canvas");
  cv.width = src.width;
  cv.height = src.height;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = `rgb(${q(c.r)},${q(c.g)},${q(c.b)})`;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(src, 0, 0);
  url = cv.toDataURL();
  if (tintCache.size > 600) tintCache.clear();
  tintCache.set(k, url);
  return url;
}

let scratch: HTMLCanvasElement | null = null;
function sliceScratch(w: number, h: number) {
  scratch ??= document.createElement("canvas");
  if (scratch.width < w) scratch.width = w;
  if (scratch.height < h) scratch.height = h;
  return scratch;
}

/** Is a sprite a plain white mask (Art shapes)? Then CSS masks tint it cheaply. */
const maskCache = new WeakMap<Sprite, boolean>();
function isWhiteMask(s: Sprite) {
  let m = maskCache.get(s);
  if (m !== undefined) return m;
  m = true;
  const ctx = s.canvas?.getContext("2d");
  if (ctx) {
    const d = ctx.getImageData(0, 0, s.canvas!.width, s.canvas!.height).data;
    for (let i = 0; i < d.length; i += 4 * 7) if (d[i + 3] > 8 && (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250)) { m = false; break; }
  }
  maskCache.set(s, m);
  return m;
}

export class Image {
  readonly vis: HTMLElement;
  private _sprite: Sprite | null = null;
  private _color = Color.white;
  private _raycast = false;
  private _enabled = true;
  type = ImageType.Simple;
  preserveAspect = false;
  /** UI sliced sprites: scale of the 9-slice borders (Image.pixelsPerUnitMultiplier). */
  private _ppuMul = 1;
  private _fill = 1;
  fillMethod: "Horizontal" | "Vertical" | "Radial360" = "Horizontal";
  fillOrigin = 0;

  constructor(readonly node: UINode) {
    node.image = this;
    this.vis = document.createElement("i");
    this.vis.className = "na-img";
    node.el.insertBefore(this.vis, node.el.firstChild);
  }
  get rectTransform() { return this.node; }
  get gameObject() { return this.node; }
  get transform() { return this.node; }

  get sprite() { return this._sprite; }
  set sprite(s: Sprite | null) { if (s === this._sprite) return; this._sprite = s; this.type = s?.sliced ? ImageType.Sliced : this.type === ImageType.Filled ? ImageType.Filled : ImageType.Simple; this.paint(); }
  get color() { return this._color; }
  set color(c: Color) { if (c.equals(this._color)) return; const rgbChanged = c.r !== this._color.r || c.g !== this._color.g || c.b !== this._color.b; this._color = c; if (rgbChanged) this.paint(); else this.vis.style.opacity = String(Mathf.clamp01(c.a)); }
  get raycastTarget() { return this._raycast; }
  set raycastTarget(v: boolean) { this._raycast = v; this.vis.classList.toggle("na-hit", v); this.node.el.classList.toggle("na-hitbox", v); }
  get enabled() { return this._enabled; }
  set enabled(v: boolean) { this._enabled = v; this.vis.style.display = v ? "" : "none"; this.vis.classList.toggle("na-hit", v && this._raycast); }
  get pixelsPerUnitMultiplier() { return this._ppuMul; }
  set pixelsPerUnitMultiplier(v: number) { this._ppuMul = v; this.paint(); }
  get fillAmount() { return this._fill; }
  set fillAmount(v: number) { this._fill = Mathf.clamp01(v); this.applyFill(); }

  private applyFill() {
    if (this.type !== ImageType.Filled) { this.vis.style.clipPath = ""; return; }
    const f = this._fill * 100;
    if (this.fillMethod === "Horizontal") this.vis.style.clipPath = this.fillOrigin === 0 ? `inset(0 ${100 - f}% 0 0)` : `inset(0 0 0 ${100 - f}%)`;
    else if (this.fillMethod === "Vertical") this.vis.style.clipPath = this.fillOrigin === 0 ? `inset(${100 - f}% 0 0 0)` : `inset(0 0 ${100 - f}% 0)`;
    else {
      // radial from top, clockwise
      const pts = ["50% 50%", "50% 0%"];
      const steps = Math.ceil(this._fill * 32);
      for (let i = 1; i <= steps; i++) {
        const a = Math.min(i / 32, this._fill) * Math.PI * 2;
        pts.push(`${50 + Math.sin(a) * 75}% ${50 - Math.cos(a) * 75}%`);
      }
      this.vis.style.clipPath = `polygon(${pts.join(",")})`;
    }
  }

  private paint() {
    const st = this.vis.style, s = this._sprite, c = this._color;
    st.opacity = String(Mathf.clamp01(c.a));
    st.backgroundColor = st.backgroundImage = st.borderImage = st.borderStyle = st.borderWidth = "";
    st.webkitMaskImage = st.maskImage = "";
    if (!s) { st.backgroundColor = `rgb(${q(c.r)},${q(c.g)},${q(c.b)})`; return; }
    if (s.sliced) { this.drawSliced(); return; }
    this.sliceCanvas?.remove();
    this.sliceCanvas = null;
    if (isWhiteMask(s)) {
      st.backgroundColor = `rgb(${q(c.r)},${q(c.g)},${q(c.b)})`;
      st.webkitMaskImage = st.maskImage = `url(${s.url})`;
      return;
    }
    st.backgroundImage = `url(${c.r === 1 && c.g === 1 && c.b === 1 ? s.url : tinted(s, c)})`;
    this.applyFill();
  }

  private lastW = 0;
  private lastH = 0;
  private sliceCanvas: HTMLCanvasElement | null = null;
  private drawnKey = "";

  /** Rect changed: sliced images are redrawn at the new size. */
  onRect(w: number, h: number) {
    this.lastW = w;
    this.lastH = h;
    if (this._sprite?.sliced) this.drawSliced();
  }

  /** 9-slice drawn into a canvas at the element's device-pixel size (no seams), then tinted. */
  private drawSliced() {
    const s = this._sprite!, c = this._color;
    const w = this.lastW, h = this.lastH;
    if (w <= 0 || h <= 0) return;
    const res = UI.cssScale * Screen.dpr; // device px per canvas unit
    const pw = Math.max(1, Math.round(w * res)), ph = Math.max(1, Math.round(h * res));
    const key = `${s.key}|${pw}x${ph}|${q(c.r)},${q(c.g)},${q(c.b)}|${this._ppuMul}`;
    this.vis.style.opacity = String(Mathf.clamp01(c.a));
    if (key === this.drawnKey && this.sliceCanvas) return;
    this.drawnKey = key;
    if (!this.sliceCanvas) {
      this.sliceCanvas = document.createElement("canvas");
      this.sliceCanvas.className = "na-slice";
      this.vis.appendChild(this.sliceCanvas);
    }
    const cv = this.sliceCanvas;
    cv.width = pw;
    cv.height = ph;
    const ctx = cv.getContext("2d")!;
    const src = s.canvas!;
    const [l, b, r, t] = s.border;
    // border size in device px (sprite px → canvas units via ppu 100 → device px), shrunk like Unity when too big
    let k = (1 / this._ppuMul) * (100 / s.ppu) * res;
    k *= Math.min(1, pw / Math.max(1e-3, (l + r) * k), ph / Math.max(1e-3, (t + b) * k));
    const sw = src.width, sh = src.height;
    const sx = [0, l, sw - r, sw], sy = [0, t, sh - b, sh];
    // whole-pixel edges: overlapping pieces would draw translucent pixels twice and show seams
    const dx = [0, Math.round(l * k), Math.round(pw - r * k), pw], dy = [0, Math.round(t * k), Math.round(ph - b * k), ph];
    // assemble the nine pieces on a scratch canvas, then tint in one pass
    const buf = sliceScratch(pw, ph);
    const bctx = buf.getContext("2d")!;
    bctx.globalCompositeOperation = "source-over";
    bctx.clearRect(0, 0, pw, ph);
    bctx.imageSmoothingQuality = "high";
    for (let iy = 0; iy < 3; iy++)
      for (let ix = 0; ix < 3; ix++) {
        const sW = sx[ix + 1] - sx[ix], sH = sy[iy + 1] - sy[iy], dW = dx[ix + 1] - dx[ix], dH = dy[iy + 1] - dy[iy];
        if (sW > 0 && sH > 0 && dW > 0 && dH > 0) bctx.drawImage(src, sx[ix], sy[iy], sW, sH, dx[ix], dy[iy], dW, dH);
      }
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(buf, 0, 0, pw, ph, 0, 0, pw, ph);
    if (!(c.r === 1 && c.g === 1 && c.b === 1)) {
      const white = isWhiteMask(s);
      ctx.globalCompositeOperation = white ? "source-in" : "multiply";
      ctx.fillStyle = `rgb(${q(c.r)},${q(c.g)},${q(c.b)})`;
      ctx.fillRect(0, 0, pw, ph);
      if (!white) {
        ctx.globalCompositeOperation = "destination-in"; // restore the sprite's alpha after multiply
        ctx.drawImage(buf, 0, 0, pw, ph, 0, 0, pw, ph);
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  setNativeSize() { if (this._sprite) this.node.sizeDelta = new V2(this._sprite.width, this._sprite.height); }
}

// ------------------------------------------------------------------ Text

export enum WrapMode { Wrap, Overflow }

/** Escapes HTML and converts Unity rich text (<color>, <b>, <i>, <size>) to spans. */
function richText(s: string) {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  return esc
    .replace(/&lt;color=(#[0-9a-fA-F]{3,8}|[a-z]+)&gt;/g, '<span style="color:$1">')
    .replace(/&lt;\/color&gt;/g, "</span>")
    .replace(/&lt;size=(\d+)&gt;/g, '<span style="font-size:$1px">')
    .replace(/&lt;\/size&gt;/g, "</span>")
    .replace(/&lt;b&gt;/g, "<b>").replace(/&lt;\/b&gt;/g, "</b>")
    .replace(/&lt;i&gt;/g, "<i>").replace(/&lt;\/i&gt;/g, "</i>");
}

export class Text {
  readonly span: HTMLElement;
  private _text = "";
  private _size = 14;
  private _color = Color.white;
  private _align = TextAnchor.MiddleCenter;
  private _style = FontStyle.Bold;
  private _hWrap = WrapMode.Overflow;
  private _enabled = true;
  private _outline: Outline | null = null;
  /** Best fit (CasualLook.Fit): shrink to fit between these sizes. */
  resizeTextForBestFit = false;
  resizeTextMinSize = 10;
  resizeTextMaxSize = 40;
  verticalOverflow = WrapMode.Overflow;
  lineSpacing = 1;
  raycastTarget = false;
  supportRichText = true;

  constructor(readonly node: UINode) {
    node.textC = this;
    node.el.classList.add("na-txt");
    this.span = document.createElement("span");
    node.el.appendChild(this.span);
    this.applyAlign();
    this.applyStyle();
  }
  get rectTransform() { return this.node; }
  get gameObject() { return this.node; }
  get transform() { return this.node; }

  get text() { return this._text; }
  set text(v: string) {
    v = v ?? "";
    if (v === this._text) return;
    this._text = v;
    if (/<(color|size|b|i)[=>]/.test(v) || v.includes("\n")) this.span.innerHTML = richText(v);
    else this.span.textContent = v;
    if (this.resizeTextForBestFit) this.relayout();
  }
  get fontSize() { return this._size; }
  set fontSize(v: number) { if (v === this._size) return; this._size = v; this.span.style.fontSize = v + "px"; this.relayout(); }
  get color() { return this._color; }
  set color(c: Color) { if (c.equals(this._color)) return; this._color = c; this.span.style.color = c.css; }
  get alignment() { return this._align; }
  set alignment(a: TextAnchor) { this._align = a; this.applyAlign(); }
  get fontStyle() { return this._style; }
  set fontStyle(f: FontStyle) { this._style = f; this.applyStyle(); }
  get horizontalOverflow() { return this._hWrap; }
  set horizontalOverflow(w: WrapMode) { this._hWrap = w; this.span.style.whiteSpace = w === WrapMode.Wrap ? "normal" : "pre"; }
  get enabled() { return this._enabled; }
  set enabled(v: boolean) { this._enabled = v; this.span.style.display = v ? "" : "none"; }
  get preferredWidth() { return this.span.offsetWidth; }
  get preferredHeight() { return this.span.offsetHeight; }

  /** Outline/shadow effect (UIKit Glow → Outline). */
  setOutline(o: Outline | null) { this._outline = o; this.applyOutline(); }
  applyOutline() {
    const o = this._outline;
    if (!o || o.effectColor.a <= 0) { this.span.style.textShadow = ""; return; }
    const d = Math.abs(o.effectDistance.x), c = o.effectColor.css;
    this.span.style.textShadow = `${d}px ${d}px 0 ${c}, ${-d}px ${d}px 0 ${c}, ${d}px ${-d}px 0 ${c}, ${-d}px ${-d}px 0 ${c}, 0 0 ${d * 3}px ${c}`;
  }

  private applyAlign() {
    const a = this._align, st = this.node.el.style;
    const h = a % 3, v = Math.floor(a / 3);
    st.justifyContent = h === 0 ? "flex-start" : h === 1 ? "center" : "flex-end";
    st.alignItems = v === 0 ? "flex-start" : v === 1 ? "center" : "flex-end";
    this.span.style.textAlign = h === 0 ? "left" : h === 1 ? "center" : "right";
  }

  private applyStyle() {
    const f = this._style, st = this.span.style;
    st.fontWeight = f === FontStyle.Bold || f === FontStyle.BoldAndItalic ? "700" : "400";
    st.fontStyle = f === FontStyle.Italic || f === FontStyle.BoldAndItalic ? "italic" : "normal";
    st.fontSize = this._size + "px";
  }

  /** Best-fit sizing after the rect or text changes. */
  relayout() {
    if (!this.resizeTextForBestFit || !this.node.activeInHierarchy) return;
    const r = this.node.rect;
    let size = this.resizeTextMaxSize;
    this.span.style.fontSize = size + "px";
    while (size > this.resizeTextMinSize && (this.span.scrollWidth > r.width + 1 || this.span.scrollHeight > r.height + 1)) {
      size -= 2;
      this.span.style.fontSize = size + "px";
    }
  }
}

export class Outline {
  private _c: Color;
  private _d: V2;
  constructor(private text: Text, color: Color, distance: number) { this._c = color; this._d = new V2(distance, -distance); text.setOutline(this); }
  get effectColor() { return this._c; }
  set effectColor(c: Color) { this._c = c; this.text.applyOutline(); }
  get effectDistance() { return this._d; }
  set effectDistance(v: V2) { this._d = v; this.text.applyOutline(); }
  get enabled() { return true; }
}

// ------------------------------------------------------------------ ArcadeButton

/** Neon button with squash feedback, click sound and haptics. Also usable as a hold button. */
export class ArcadeButton {
  onClick: (() => void) | null = null;
  background!: Image;
  edge!: Image;
  halo!: Image;
  icon: Image | null = null;
  label: Text | null = null;
  primary = false;
  silent = false;
  /** True while a pointer is held down on the button. */
  held = false;
  private target = 1;
  private scale = 1;
  private clock = 0;
  private _interactable = true;
  /** The press started on this button. A tap that began on the game (say, holding a kite) and ends after a result
   *  screen pops up under the finger is otherwise reported by mobile browsers as a click on the new button. */
  private armed = false;
  private accent = Pal.Cyan;
  private readonly tick = () => this.update();

  constructor(readonly node: UINode) {
    node.button = this;
    const el = node.el;
    el.classList.add("na-button");
    el.addEventListener("pointerdown", (e) => { this.held = true; this.armed = true; if (this._interactable) this.target = 0.93; e.stopPropagation(); });
    el.addEventListener("pointerup", () => { this.held = false; this.target = 1; });
    el.addEventListener("pointerleave", () => { this.held = false; this.target = 1; });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      // detail 0 = a keyboard or programmatic click, which has no pointer press.
      if (!this.armed && e.detail !== 0) return;
      this.armed = false;
      this.press();
    });
    UITicks.add(this.tick);
  }
  get gameObject() { return this.node; }
  get transform() { return this.node; }
  get rectTransform() { return this.node; }
  /** Unity names. */
  get Label() { return this.label; }
  get Background() { return this.background; }

  get interactable() { return this._interactable; }
  set interactable(v: boolean) {
    this._interactable = v;
    const cg = this.node.group ?? new CanvasGroup(this.node);
    cg.alpha = v ? 1 : 0.4;
  }

  press() {
    if (!this._interactable) { Sfx.play(Snd.Deny, 0.6); return; }
    if (!this.silent) Sfx.play(Snd.Click);
    Fx.haptic();
    this.scale = 1.08;
    this.onClick?.();
  }

  onActiveChanged(on: boolean) {
    if (!on) { this.held = false; this.target = this.scale = 1; this.node.localScale = V3.one; }
  }
  dispose() { UITicks.delete(this.tick); }

  private update() {
    if (!this.node.activeInHierarchy) return;
    const dt = Time.unscaledDeltaTime;
    this.clock += dt;
    this.scale = Mathf.lerp(this.scale, this.target, 1 - Math.exp(-dt * 20));
    const s = Math.abs(this.scale - 1) < 0.002 ? 1 : this.scale;
    this.node.localScale = new V3(s, s, 1);
    if (this.primary) this.halo.color = this.accent.withAlpha(0.3 + 0.15 * Math.sin(this.clock * 3));
  }

  setAccent(c: Color) {
    this.accent = c;
    if (this.primary) {
      this.background.color = c;
      this.edge.color = Color.lerp(c, Color.white, 0.5);
      if (this.label) this.label.color = Pal.Dark;
      if (this.icon) this.icon.color = Pal.Dark;
    } else {
      this.background.color = Pal.Panel;
      this.edge.color = c.withAlpha(0.85);
      if (this.label) this.label.color = c;
      if (this.icon) this.icon.color = c;
    }
    this.halo.color = c.withAlpha(this.primary ? 0.35 : 0.12);
  }
}

/** A polyline in UI space (minimaps, graphs). */
export class UILine {
  thickness = 4;
  loop = false;
  private svg: SVGSVGElement;
  private poly: SVGPolylineElement;
  private _color = Color.white;
  constructor(readonly node: UINode) {
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "na-svg");
    this.poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    this.poly.setAttribute("fill", "none");
    this.poly.setAttribute("stroke-linecap", "round");
    this.poly.setAttribute("stroke-linejoin", "round");
    this.svg.appendChild(this.poly);
    node.el.appendChild(this.svg);
  }
  get color() { return this._color; }
  set color(c: Color) { this._color = c; this.poly.setAttribute("stroke", c.css); }
  /** Points in the node's local space (pivot-relative, y up). */
  setPoints(pts: V2[]) {
    const r = this.node.rect;
    const all = this.loop && pts.length ? [...pts, pts[0]] : pts;
    this.poly.setAttribute("points", all.map((p) => `${p.x - r.x},${r.height - (p.y - r.y)}`).join(" "));
    this.poly.setAttribute("stroke-width", String(this.thickness));
  }
}

// ------------------------------------------------------------------ UI root + UIKit helpers

export const UI = {
  root: null as UINode | null,
  /** Canvas units per device pixel → device pixels per canvas unit. */
  scale: 1,
  /** Unity screen point (device px, y up) → canvas point (units, y up, origin bottom-left). */
  screenToCanvas(p: V2) { return new V2(p.x / Screen.dpr / UI.cssScale, p.y / Screen.dpr / UI.cssScale); },
  /** CSS px per canvas unit. */
  cssScale: 1,
};

export const UIKit = {
  Center: new V2(0.5, 0.5),

  node(name: string, parent: UINode) { return new UINode(name, parent); },

  img(parent: UINode, name: string, sprite: Sprite | null, color: Color, raycast = false) {
    const n = new UINode(name, parent);
    const img = new Image(n);
    img.sprite = sprite;
    img.color = color;
    img.raycastTarget = raycast;
    return img;
  },

  label(parent: UINode, content: string, size: number, color: Color, anchor = TextAnchor.MiddleCenter, style = FontStyle.Bold) {
    const n = new UINode("Text", parent);
    const t = new Text(n);
    t.fontSize = size;
    t.fontStyle = style;
    t.color = color;
    t.alignment = anchor;
    t.horizontalOverflow = WrapMode.Overflow;
    t.text = content;
    return t;
  },

  wrap(t: Text) { t.horizontalOverflow = WrapMode.Wrap; return t; },

  at(t: Text, anchor: V2, position: V2, size: V2) { t.rectTransform.place(anchor, position, size); return t; },

  glow(t: Text, color: Color, distance = 3) { return new Outline(t, color, distance); },

  button(parent: UINode, label: string, size: V2, primary: boolean, onClick: (() => void) | null, fontSize = 46, icon: Sprite | null = null) {
    const rt = new UINode(label.length > 0 ? label : "Button", parent);
    rt.sizeDelta = size;
    const b = new ArcadeButton(rt);
    b.primary = primary;
    b.onClick = onClick;
    b.halo = UIKit.img(rt, "Halo", Art.Glow, Color.clear);
    b.halo.rectTransform.stretch(-Math.min(size.x, size.y) * 0.35);
    b.background = UIKit.img(rt, "Background", Art.UiRound, Color.white, true);
    b.background.rectTransform.stretch();
    b.edge = UIKit.img(rt, "Edge", Art.UiOutline, Color.white);
    b.edge.rectTransform.stretch();
    if (icon) {
      const s = Math.min(size.x, size.y) * 0.5;
      b.icon = UIKit.img(rt, "Icon", icon, Color.white);
      b.icon.rectTransform.place(UIKit.Center, label.length > 0 ? new V2(0, size.y * 0.12) : V2.zero, new V2(s, s));
    }
    if (label.length > 0) {
      b.label = UIKit.label(rt, label, fontSize, Color.white);
      if (icon) b.label.rectTransform.place(new V2(0.5, 0), new V2(0, size.y * 0.2), new V2(size.x, fontSize * 1.2));
      else b.label.rectTransform.stretch();
    }
    b.setAccent(Pal.Cyan);
    return b;
  },

  buttonAt(parent: UINode, label: string, anchor: V2, position: V2, size: V2, primary: boolean, onClick: (() => void) | null, fontSize = 46, icon: Sprite | null = null) {
    const b = UIKit.button(parent, label, size, primary, onClick, fontSize, icon);
    b.node.place(anchor, position, size);
    return b;
  },

  layer(name: string, parent: UINode) {
    const rt = new UINode(name, parent).stretch();
    const cg = new CanvasGroup(rt);
    cg.alpha = 0;
    cg.blocksRaycasts = false;
    cg.interactable = false;
    rt.setActive(false);
    return cg;
  },

  dim(parent: UINode, alpha: number) {
    const img = UIKit.img(parent, "Dim", null, new Color(0.01, 0.01, 0.04, alpha), true);
    img.rectTransform.stretch(-800);
    return img;
  },

  card(parent: UINode, size: V2, accent: Color, position = V2.zero) {
    const rt = new UINode("Card", parent).place(UIKit.Center, position, size);
    UIKit.img(rt, "Glow", Art.Glow, accent.withAlpha(0.12)).rectTransform.stretch(-160);
    UIKit.img(rt, "Background", Art.UiRound, Pal.Panel, true).rectTransform.stretch();
    UIKit.img(rt, "Edge", Art.UiOutline, accent.withAlpha(0.45)).rectTransform.stretch();
    return rt;
  },

  /** A horizontal meter (background + fill). Set the fill with setMeter. Returns [meter, fill]. */
  meter(parent: UINode, anchor: V2, position: V2, size: V2, color: Color): [UINode, Image] {
    const bg = UIKit.img(parent, "Meter", Art.UiRound, new Color(1, 1, 1, 0.08));
    bg.rectTransform.place(anchor, position, size);
    const fill = UIKit.img(bg.rectTransform, "Fill", Art.UiRound, color);
    const f = fill.rectTransform;
    f.anchorMin = V2.zero;
    f.anchorMax = V2.one;
    f.pivot = new V2(0, 0.5);
    f.offsetMin = new V2(3, 3);
    f.offsetMax = new V2(-3, -3);
    return [bg.rectTransform, fill];
  },

  setMeter(fill: Image, value: number) {
    value = Mathf.clamp01(value);
    fill.enabled = value > 0.01;
    fill.rectTransform.anchorMax = new V2(Math.max(0.015, value), 1);
  },
};
