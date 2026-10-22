import { Mathf, V2, V3 } from "./math";

/** UnityEngine.Time. Updated by the game loop (see host). */
export const Time = {
  deltaTime: 0,
  unscaledDeltaTime: 0,
  time: 0,
  unscaledTime: 0,
  realtimeSinceStartup: 0,
  timeScale: 1,
  frameCount: 0,
};

/** Rotation about z only (all the games are 2D). Quaternion.Euler(0, 0, deg) → Quaternion.euler(0, 0, deg). */
export class Quaternion {
  constructor(readonly z: number = 0) {}
  static readonly identity = new Quaternion(0);
  static euler(_x: number, _y: number, z: number) { return new Quaternion(z); }
  /** Rotation that turns `from` into `to` (2D vectors only). */
  static fromToRotation(from: V2 | V3, to: V2 | V3) {
    return new Quaternion((Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x)) * Mathf.Rad2Deg);
  }
  static angleAxis(deg: number, _axis?: unknown) { return new Quaternion(deg); }
  static lerp(a: Quaternion, b: Quaternion, t: number) { return new Quaternion(Mathf.lerpAngle(a.z, b.z, t)); }
  static slerp(a: Quaternion, b: Quaternion, t: number) { return Quaternion.lerp(a, b, t); }
  get eulerAngles() { return new V3(0, 0, Mathf.repeat(this.z, 360)); }
  /** q * v: rotates a vector. */
  rotate(v: V2): V2;
  rotate(v: V3): V3;
  rotate(v: V2 | V3): V2 | V3 {
    const r = this.z * Mathf.Deg2Rad, c = Math.cos(r), s = Math.sin(r);
    const x = v.x * c - v.y * s, y = v.x * s + v.y * c;
    return v instanceof V3 ? new V3(x, y, v.z) : new V2(x, y);
  }
  /** q1 * q2 */
  mul(o: Quaternion) { return new Quaternion(this.z + o.z); }
}

/** 2D affine matrix: x' = a·x + c·y + tx, y' = b·x + d·y + ty. */
export class Mat {
  constructor(public a = 1, public b = 0, public c = 0, public d = 1, public tx = 0, public ty = 0) {}
  static trs(px: number, py: number, deg: number, sx: number, sy: number, out = new Mat()) {
    const r = deg * Mathf.Deg2Rad, cos = Math.cos(r), sin = Math.sin(r);
    out.a = cos * sx; out.b = sin * sx; out.c = -sin * sy; out.d = cos * sy; out.tx = px; out.ty = py;
    return out;
  }
  /** this * m */
  mul(m: Mat, out = new Mat()) {
    const a = this.a * m.a + this.c * m.b, b = this.b * m.a + this.d * m.b;
    const c = this.a * m.c + this.c * m.d, d = this.b * m.c + this.d * m.d;
    const tx = this.a * m.tx + this.c * m.ty + this.tx, ty = this.b * m.tx + this.d * m.ty + this.ty;
    out.a = a; out.b = b; out.c = c; out.d = d; out.tx = tx; out.ty = ty;
    return out;
  }
  apply(x: number, y: number) { return new V2(this.a * x + this.c * y + this.tx, this.b * x + this.d * y + this.ty); }
  applyVector(x: number, y: number) { return new V2(this.a * x + this.c * y, this.b * x + this.d * y); }
  invert() {
    const det = this.a * this.d - this.b * this.c || 1e-9;
    return new Mat(this.d / det, -this.b / det, -this.c / det, this.a / det,
      (this.c * this.ty - this.d * this.tx) / det, (this.b * this.tx - this.a * this.ty) / det);
  }
  get rotationDeg() { return Math.atan2(this.b, this.a) * Mathf.Rad2Deg; }
  get scaleX() { return Math.hypot(this.a, this.b); }
  get scaleY() { const sx = this.scaleX || 1e-9; return (this.a * this.d - this.b * this.c) / sx; }
}

/** Something attached to a GameObject (renderers, behaviours). */
export abstract class Component {
  gameObject!: GameObject;
  get transform() { return this.gameObject; }
  get name() { return this.gameObject.name; }
  /** Called when the owner is destroyed. */
  onDestroy(): void {}
  /** Called when the owner's active-in-hierarchy state changes. */
  onActiveChanged(_active: boolean): void {}
}

/** A component with per-frame hooks (MonoBehaviour). Registered with the scene while its GameObject exists. */
export abstract class Behaviour extends Component {
  enabled = true;
  update?(): void;
  lateUpdate?(): void;
  private routines: Coroutine[] = [];

  /** Generator-based coroutine: `yield wait(0.2)` (scaled seconds), `yield waitReal(0.2)`, or `yield` for one frame. */
  startCoroutine(gen: Generator<YieldInstruction | undefined | void, void, unknown>): Coroutine {
    const c = new Coroutine(gen);
    this.routines.push(c);
    c.step(); // runs synchronously up to the first yield, like Unity
    return c;
  }
  stopCoroutine(c: Coroutine | null | undefined) { if (c) c.done = true; }
  stopAllCoroutines() { for (const c of this.routines) c.done = true; this.routines = []; }

  /** Internal: advance coroutines once per frame. */
  tickRoutines() {
    if (!this.routines.length) return;
    for (const c of this.routines) if (!c.done) c.tick();
    this.routines = this.routines.filter((c) => !c.done);
  }
}

export interface YieldInstruction { seconds: number; realtime: boolean }
export const wait = (seconds: number): YieldInstruction => ({ seconds, realtime: false });
export const waitReal = (seconds: number): YieldInstruction => ({ seconds, realtime: true });

export class Coroutine {
  done = false;
  private waitLeft = 0;
  private realtime = false;
  constructor(private gen: Generator<YieldInstruction | undefined | void, void, unknown>) {}
  step() {
    const r = this.gen.next();
    if (r.done) { this.done = true; return; }
    const y = r.value as YieldInstruction | undefined;
    this.waitLeft = y ? y.seconds : 0;
    this.realtime = y ? y.realtime : false;
  }
  tick() {
    if (this.waitLeft > 0) {
      this.waitLeft -= this.realtime ? Time.unscaledDeltaTime : Time.deltaTime;
      if (this.waitLeft > 0) return;
    }
    this.step();
  }
}

/** Scene-wide registry of live behaviours (the "Unity player loop"). */
export const Scene = {
  behaviours: new Set<Behaviour>(),
  roots: new Set<GameObject>(),
  /** Bumped whenever any transform changes; renderers re-sync world matrices when it moves. */
  version: 0,
};

/**
 * GameObject and Transform in one class (Unity code says `go.transform.x` and `t.gameObject.y`; both resolve to the
 * same object here). Positions are world units with y up, rotation is degrees counter-clockwise about z.
 */
export class GameObject {
  name: string;
  private _parent: GameObject | null = null;
  readonly children: GameObject[] = [];
  readonly components: Component[] = [];
  private _lp = V3.zero;
  private _ls = V3.one;
  private _lr = 0;
  private _active = true;
  private _destroyed = false;
  private _world = new Mat();
  private _worldDirty = true;
  layer = 0;
  tag = "";

  constructor(name = "GameObject", parent: GameObject | null = null) {
    this.name = name;
    if (parent) this.setParent(parent, false);
    else Scene.roots.add(this);
  }

  get transform() { return this; }
  get gameObject() { return this; }
  get destroyed() { return this._destroyed; }

  // ------------------------------------------------------------------ hierarchy

  get parent() { return this._parent; }
  set parent(p: GameObject | null) { this.setParent(p, true); }

  setParent(p: GameObject | null, worldPositionStays = true) {
    if (p === this._parent) return;
    const wasActive = this.activeInHierarchy;
    const worldPos = worldPositionStays ? this.position : null;
    const worldRot = worldPositionStays ? this.eulerZ : 0;
    if (this._parent) {
      const i = this._parent.children.indexOf(this);
      if (i >= 0) this._parent.children.splice(i, 1);
    } else Scene.roots.delete(this);
    this._parent = p;
    if (p) p.children.push(this);
    else Scene.roots.add(this);
    if (worldPos) { this.position = worldPos; this.eulerZ = worldRot; }
    this.markDirty();
    if (wasActive !== this.activeInHierarchy) this.notifyActive(this.activeInHierarchy);
  }

  get childCount() { return this.children.length; }
  getChild(i: number) { return this.children[i]; }
  getSiblingIndex() { return this._parent ? this._parent.children.indexOf(this) : 0; }
  setAsFirstSibling() { this.moveSibling(0); }
  setAsLastSibling() { this.moveSibling(Infinity); }
  setSiblingIndex(i: number) { this.moveSibling(i); }
  private moveSibling(i: number) {
    const list = this._parent?.children;
    if (!list) return;
    list.splice(list.indexOf(this), 1);
    list.splice(Math.min(i, list.length), 0, this);
  }
  find(name: string): GameObject | null { return this.children.find((c) => c.name === name) ?? null; }

  // ------------------------------------------------------------------ activity

  get activeSelf() { return this._active; }
  get activeInHierarchy(): boolean { return this._active && !this._destroyed && (!this._parent || this._parent.activeInHierarchy); }

  setActive(on: boolean) {
    if (on === this._active) return;
    const before = this.activeInHierarchy;
    this._active = on;
    const after = this.activeInHierarchy;
    if (before !== after) this.notifyActive(after);
  }

  private notifyActive(active: boolean) {
    for (const c of this.components) c.onActiveChanged(active);
    for (const ch of this.children) if (ch._active) ch.notifyActive(active);
  }

  // ------------------------------------------------------------------ components

  addComponent<T extends Component>(c: T): T {
    c.gameObject = this;
    this.components.push(c);
    if (c instanceof Behaviour) Scene.behaviours.add(c);
    c.onActiveChanged(this.activeInHierarchy);
    return c;
  }

  getComponent<T extends Component>(type: abstract new (...args: never[]) => T): T | null {
    for (const c of this.components) if (c instanceof type) return c as T;
    return null;
  }

  getComponentInChildren<T extends Component>(type: abstract new (...args: never[]) => T): T | null {
    const own = this.getComponent(type);
    if (own) return own;
    for (const ch of this.children) { const f = ch.getComponentInChildren(type); if (f) return f; }
    return null;
  }

  /** Destroys this object and its children (Object.Destroy). */
  destroy() {
    if (this._destroyed) return;
    for (const ch of [...this.children]) ch.destroy();
    this._destroyed = true;
    for (const c of this.components) {
      if (c instanceof Behaviour) { c.stopAllCoroutines(); Scene.behaviours.delete(c); }
      c.onDestroy();
    }
    if (this._parent) {
      const i = this._parent.children.indexOf(this);
      if (i >= 0) this._parent.children.splice(i, 1);
    } else Scene.roots.delete(this);
    this._parent = null;
  }

  // ------------------------------------------------------------------ transform

  get localPosition() { return this._lp; }
  set localPosition(v: V3 | V2) { this._lp = v instanceof V3 ? v : new V3(v.x, v.y, this._lp.z); this.markDirty(); }
  get localScale() { return this._ls; }
  set localScale(v: V3 | V2) { this._ls = v instanceof V3 ? v : new V3(v.x, v.y, 1); this.markDirty(); }
  /** Local rotation in degrees about z. */
  get localEulerZ() { return this._lr; }
  set localEulerZ(deg: number) { this._lr = deg; this.markDirty(); }
  get localRotation() { return new Quaternion(this._lr); }
  set localRotation(q: Quaternion) { this.localEulerZ = q.z; }
  get localEulerAngles() { return new V3(0, 0, Mathf.repeat(this._lr, 360)); }
  set localEulerAngles(v: V3) { this.localEulerZ = v.z; }

  /** World-space rotation in degrees. */
  get eulerZ(): number { return this._parent ? this._parent.eulerZ + this._lr : this._lr; }
  set eulerZ(deg: number) { this.localEulerZ = this._parent ? deg - this._parent.eulerZ : deg; }
  get rotation() { return new Quaternion(this.eulerZ); }
  set rotation(q: Quaternion) { this.eulerZ = q.z; }
  get eulerAngles() { return new V3(0, 0, Mathf.repeat(this.eulerZ, 360)); }
  set eulerAngles(v: V3) { this.eulerZ = v.z; }

  get position(): V3 {
    if (!this._parent) return this._lp;
    const w = this._parent.worldMatrix.apply(this._lp.x, this._lp.y);
    return new V3(w.x, w.y, this._lp.z);
  }
  set position(v: V3 | V2) {
    const z = v instanceof V3 ? v.z : this._lp.z;
    if (!this._parent) { this.localPosition = new V3(v.x, v.y, z); return; }
    const l = this._parent.worldMatrix.invert().apply(v.x, v.y);
    this.localPosition = new V3(l.x, l.y, z);
  }
  get lossyScale() { const m = this.worldMatrix; return new V3(m.scaleX, m.scaleY, this._ls.z); }

  get right() { const r = this.eulerZ * Mathf.Deg2Rad; return new V3(Math.cos(r), Math.sin(r), 0); }
  set right(v: V3 | V2) { this.eulerZ = Math.atan2(v.y, v.x) * Mathf.Rad2Deg; }
  get up() { const r = this.eulerZ * Mathf.Deg2Rad; return new V3(-Math.sin(r), Math.cos(r), 0); }
  set up(v: V3 | V2) { this.eulerZ = Math.atan2(v.y, v.x) * Mathf.Rad2Deg - 90; }

  setPositionAndRotation(p: V3 | V2, q: Quaternion) { this.position = p; this.rotation = q; }
  translate(v: V3 | V2) { this.localPosition = new V3(this._lp.x + v.x, this._lp.y + v.y, this._lp.z + (v instanceof V3 ? v.z : 0)); }
  rotate(_x: number, _y: number, z: number) { this.localEulerZ = this._lr + z; }

  transformPoint(p: V3 | V2) { const w = this.worldMatrix.apply(p.x, p.y); return new V3(w.x, w.y, 0); }
  inverseTransformPoint(p: V3 | V2) { const l = this.worldMatrix.invert().apply(p.x, p.y); return new V3(l.x, l.y, 0); }
  transformDirection(v: V3 | V2) { const r = this.eulerZ * Mathf.Deg2Rad, c = Math.cos(r), s = Math.sin(r); return new V3(v.x * c - v.y * s, v.x * s + v.y * c, 0); }

  get worldMatrix(): Mat {
    if (this._worldDirty) {
      const local = Mat.trs(this._lp.x, this._lp.y, this._lr, this._ls.x, this._ls.y);
      if (this._parent) this._parent.worldMatrix.mul(local, this._world);
      else Object.assign(this._world, local);
      this._worldDirty = false;
    }
    return this._world;
  }

  private markDirty() {
    if (this._worldDirty) return;
    this._worldDirty = true;
    Scene.version++;
    for (const c of this.children) c.markDirty();
  }
}

/** Object.Destroy for GameObjects or components' owners. */
export function destroy(o: GameObject | Component | null | undefined) {
  if (!o) return;
  (o instanceof GameObject ? o : o.gameObject).destroy();
}
