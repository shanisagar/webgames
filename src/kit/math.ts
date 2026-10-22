/**
 * Unity-style math for ported games: immutable vectors and colours (C# structs have value semantics, so the TypeScript
 * versions are read-only: `v = v.withX(3)` instead of `v.x = 3`, which the compiler then catches), Mathf, Random,
 * Ease and Fmt with the same names and behaviour as the C# originals.
 */

export class V2 {
  constructor(readonly x = 0, readonly y = 0) {}

  static readonly zero = new V2(0, 0);
  static readonly one = new V2(1, 1);
  static readonly up = new V2(0, 1);
  static readonly down = new V2(0, -1);
  static readonly left = new V2(-1, 0);
  static readonly right = new V2(1, 0);

  add(o: V2) { return new V2(this.x + o.x, this.y + o.y); }
  sub(o: V2) { return new V2(this.x - o.x, this.y - o.y); }
  mul(k: number) { return new V2(this.x * k, this.y * k); }
  div(k: number) { return new V2(this.x / k, this.y / k); }
  /** Component-wise product (Vector2.Scale). */
  scale(o: V2) { return new V2(this.x * o.x, this.y * o.y); }
  neg() { return new V2(-this.x, -this.y); }
  withX(x: number) { return new V2(x, this.y); }
  withY(y: number) { return new V2(this.x, y); }
  get magnitude() { return Math.hypot(this.x, this.y); }
  get sqrMagnitude() { return this.x * this.x + this.y * this.y; }
  get normalized() { const m = this.magnitude; return m > 1e-5 ? new V2(this.x / m, this.y / m) : V2.zero; }
  equals(o: V2) { return Math.abs(this.x - o.x) < 1e-5 && Math.abs(this.y - o.y) < 1e-5; }
  toV3(z = 0) { return new V3(this.x, this.y, z); }
  toString() { return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`; }

  static dot(a: V2, b: V2) { return a.x * b.x + a.y * b.y; }
  static distance(a: V2, b: V2) { return Math.hypot(a.x - b.x, a.y - b.y); }
  static lerp(a: V2, b: V2, t: number) { t = Mathf.clamp01(t); return new V2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
  static lerpUnclamped(a: V2, b: V2, t: number) { return new V2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
  static moveTowards(a: V2, b: V2, maxDelta: number) {
    const d = b.sub(a), m = d.magnitude;
    return m <= maxDelta || m === 0 ? b : a.add(d.mul(maxDelta / m));
  }
  static clampMagnitude(v: V2, max: number) { const m = v.magnitude; return m > max ? v.mul(max / m) : v; }
  static min(a: V2, b: V2) { return new V2(Math.min(a.x, b.x), Math.min(a.y, b.y)); }
  static max(a: V2, b: V2) { return new V2(Math.max(a.x, b.x), Math.max(a.y, b.y)); }
  /** Signed angle in degrees from a to b (Vector2.SignedAngle). */
  static signedAngle(a: V2, b: V2) { return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y) * Mathf.Rad2Deg; }
  static angle(a: V2, b: V2) { return Math.abs(V2.signedAngle(a, b)); }
  static perpendicular(v: V2) { return new V2(-v.y, v.x); }
  static reflect(v: V2, n: V2) { const d = 2 * V2.dot(v, n); return new V2(v.x - d * n.x, v.y - d * n.y); }
  static fromAngle(rad: number, len = 1) { return new V2(Math.cos(rad) * len, Math.sin(rad) * len); }
}

export class V3 {
  constructor(readonly x = 0, readonly y = 0, readonly z = 0) {}
  static readonly zero = new V3(0, 0, 0);
  static readonly one = new V3(1, 1, 1);
  add(o: V3) { return new V3(this.x + o.x, this.y + o.y, this.z + o.z); }
  sub(o: V3) { return new V3(this.x - o.x, this.y - o.y, this.z - o.z); }
  mul(k: number) { return new V3(this.x * k, this.y * k, this.z * k); }
  withX(x: number) { return new V3(x, this.y, this.z); }
  withY(y: number) { return new V3(this.x, y, this.z); }
  withZ(z: number) { return new V3(this.x, this.y, z); }
  get xy() { return new V2(this.x, this.y); }
  get magnitude() { return Math.hypot(this.x, this.y, this.z); }
  get normalized() { const m = this.magnitude; return m > 1e-5 ? this.mul(1 / m) : V3.zero; }
  static lerp(a: V3, b: V3, t: number) { t = Mathf.clamp01(t); return new V3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
  static dot(a: V3, b: V3) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  static cross(a: V3, b: V3) { return new V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
}

/** Integer cell coordinate (Vector2Int). */
export class V2i {
  constructor(readonly x = 0, readonly y = 0) {}
  static readonly zero = new V2i(0, 0);
  static readonly up = new V2i(0, 1);
  static readonly down = new V2i(0, -1);
  static readonly left = new V2i(-1, 0);
  static readonly right = new V2i(1, 0);
  add(o: V2i) { return new V2i(this.x + o.x, this.y + o.y); }
  sub(o: V2i) { return new V2i(this.x - o.x, this.y - o.y); }
  mul(k: number) { return new V2i(this.x * k, this.y * k); }
  equals(o: V2i) { return this.x === o.x && this.y === o.y; }
  toV2() { return new V2(this.x, this.y); }
  get key() { return this.x * 100003 + this.y; }
  toString() { return `(${this.x}, ${this.y})`; }
}

export class Color {
  constructor(readonly r = 0, readonly g = 0, readonly b = 0, readonly a = 1) {}

  static readonly white = new Color(1, 1, 1, 1);
  static readonly black = new Color(0, 0, 0, 1);
  static readonly clear = new Color(0, 0, 0, 0);
  static readonly red = new Color(1, 0, 0, 1);
  static readonly green = new Color(0, 1, 0, 1);
  static readonly blue = new Color(0, 0, 1, 1);
  static readonly yellow = new Color(1, 0.92, 0.016, 1);
  static readonly gray = new Color(0.5, 0.5, 0.5, 1);
  static readonly grey = Color.gray;
  static readonly cyan = new Color(0, 1, 1, 1);
  static readonly magenta = new Color(1, 0, 1, 1);

  withAlpha(a: number) { return new Color(this.r, this.g, this.b, a); }
  /** Scales rgb (Pal.Scale). */
  scale(k: number) { return new Color(this.r * k, this.g * k, this.b * k, this.a); }
  /** Component-wise multiply including alpha (Color * Color, or Color * float when given a number). */
  mul(o: Color | number) {
    return typeof o === "number"
      ? new Color(this.r * o, this.g * o, this.b * o, this.a * o)
      : new Color(this.r * o.r, this.g * o.g, this.b * o.b, this.a * o.a);
  }
  add(o: Color) { return new Color(this.r + o.r, this.g + o.g, this.b + o.b, this.a + o.a); }
  withR(r: number) { return new Color(r, this.g, this.b, this.a); }
  withG(g: number) { return new Color(this.r, g, this.b, this.a); }
  withB(b: number) { return new Color(this.r, this.g, b, this.a); }
  get grayscale() { return 0.299 * this.r + 0.587 * this.g + 0.114 * this.b; }

  /** 0xRRGGBB for Phaser tints (clamped to 0..1). */
  get rgbInt() {
    const c = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);
    return (c(this.r) << 16) | (c(this.g) << 8) | c(this.b);
  }
  get css() {
    const c = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);
    return `rgba(${c(this.r)},${c(this.g)},${c(this.b)},${+Math.min(Math.max(this.a, 0), 1).toFixed(3)})`;
  }
  equals(o: Color) { return this.r === o.r && this.g === o.g && this.b === o.b && this.a === o.a; }

  static lerp(a: Color, b: Color, t: number) {
    t = Mathf.clamp01(t);
    return new Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t);
  }
  static lerpUnclamped(a: Color, b: Color, t: number) {
    return new Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t);
  }

  static HSVToRGB(h: number, s: number, v: number) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6), f = h * 6 - i;
    const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
    return new Color(r, g, b, 1);
  }

  static RGBToHSV(c: Color): [number, number, number] {
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b), d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === c.r) h = ((c.g - c.b) / d) % 6;
      else if (max === c.g) h = (c.b - c.r) / d + 2;
      else h = (c.r - c.g) / d + 4;
      h /= 6;
      if (h < 0) h += 1;
    }
    return [h, max === 0 ? 0 : d / max, max];
  }
}

const hex = (rgb: number, a = 1) => new Color(((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, a);

/** Shared neon palette and colour helpers (Core.cs Pal): Pal.hex(0xRRGGBB), Pal.rainbow(t) and the named colours. */
export const Pal = {
  hex,
  rainbow: (t: number) => Color.HSVToRGB(Mathf.repeat(t, 1), 0.5, 1),
  Text: hex(0xeaf6ff),
  TextDim: new Color(0.72, 0.8, 0.95, 0.7),
  Panel: new Color(0.05, 0.04, 0.12, 0.94),
  Danger: hex(0xff4d6a),
  Good: hex(0x5cffa0),
  Warn: hex(0xffc84a),
  Cyan: hex(0x55f2ff),
  Magenta: hex(0xe45cff),
  Orange: hex(0xff8a3d),
  Violet: hex(0x8c6cff),
  Dark: hex(0x03050f),
};

export const Mathf = {
  PI: Math.PI,
  Deg2Rad: Math.PI / 180,
  Rad2Deg: 180 / Math.PI,
  Infinity: Infinity,
  Epsilon: 1.401298e-45,
  clamp: (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v),
  clamp01: (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v),
  lerp: (a: number, b: number, t: number) => a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t),
  lerpUnclamped: (a: number, b: number, t: number) => a + (b - a) * t,
  inverseLerp: (a: number, b: number, v: number) => (a !== b ? Mathf.clamp01((v - a) / (b - a)) : 0),
  moveTowards: (cur: number, target: number, maxDelta: number) =>
    Math.abs(target - cur) <= maxDelta ? target : cur + Math.sign(target - cur) * maxDelta,
  /** Unity's SmoothStep interpolates from→to with smoothing (not shader smoothstep). */
  smoothStep: (from: number, to: number, t: number) => {
    t = Mathf.clamp01(t);
    t = -2 * t * t * t + 3 * t * t;
    return to * t + from * (1 - t);
  },
  repeat: (t: number, length: number) => Mathf.clamp(t - Math.floor(t / length) * length, 0, length),
  pingPong: (t: number, length: number) => { t = Mathf.repeat(t, length * 2); return length - Math.abs(t - length); },
  deltaAngle: (a: number, b: number) => { let d = Mathf.repeat(b - a, 360); if (d > 180) d -= 360; return d; },
  moveTowardsAngle: (cur: number, target: number, maxDelta: number) => {
    const d = Mathf.deltaAngle(cur, target);
    if (-maxDelta < d && d < maxDelta) return target;
    return Mathf.moveTowards(cur, cur + d, maxDelta);
  },
  lerpAngle: (a: number, b: number, t: number) => a + Mathf.deltaAngle(a, b) * Mathf.clamp01(t),
  approximately: (a: number, b: number) => Math.abs(b - a) < Math.max(1e-6 * Math.max(Math.abs(a), Math.abs(b)), 1e-6),
  sign: (v: number) => (v >= 0 ? 1 : -1),
  roundToInt: (v: number) => roundHalfEven(v),
  floorToInt: (v: number) => Math.floor(v),
  ceilToInt: (v: number) => Math.ceil(v),
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  exp: Math.exp,
  log: (v: number, base?: number) => (base === undefined ? Math.log(v) : Math.log(v) / Math.log(base)),
  log10: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  floor: Math.floor,
  ceil: Math.ceil,
  round: (v: number) => roundHalfEven(v),
  isPowerOfTwo: (v: number) => v > 0 && (v & (v - 1)) === 0,
  /** 2D Perlin-style smooth noise in 0..1 (Mathf.PerlinNoise). */
  perlinNoise: (x: number, y: number) => perlin2(x, y) * 0.5 + 0.5,
  smoothDamp(current: number, target: number, vel: { v: number }, smoothTime: number, dt: number, maxSpeed = Infinity) {
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime, x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = current - target;
    const maxChange = maxSpeed * smoothTime;
    change = Mathf.clamp(change, -maxChange, maxChange);
    const t = current - change;
    const temp = (vel.v + omega * change) * dt;
    vel.v = (vel.v - omega * temp) * exp;
    let out = t + (change + temp) * exp;
    if (target - current > 0 === out > target) { out = target; vel.v = (out - target) / dt; }
    return out;
  },
};

/** C#'s Math.Round / Mathf.RoundToInt use banker's rounding (0.5 → 0, 1.5 → 2, 2.5 → 2). */
function roundHalfEven(v: number) {
  const f = Math.floor(v), d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// Classic improved-Perlin gradient noise, deterministic.
const perm = (() => {
  const p: number[] = [];
  let s = 1337;
  for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p.concat(p);
})();
function grad(h: number, x: number, y: number) {
  switch (h & 3) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    default: return -x - y;
  }
}
function perlin2(x: number, y: number) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  x -= Math.floor(x); y -= Math.floor(y);
  const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10);
  const a = perm[X] + Y, b = perm[X + 1] + Y;
  const l1 = grad(perm[a], x, y) + u * (grad(perm[b], x - 1, y) - grad(perm[a], x, y));
  const l2 = grad(perm[a + 1], x, y - 1) + u * (grad(perm[b + 1], x - 1, y - 1) - grad(perm[a + 1], x, y - 1));
  return Math.max(-1, Math.min(1, (l1 + v * (l2 - l1)) * 0.7071));
}

/** UnityEngine.Random: Range(float, float) is inclusive, Range(int, int) excludes max. */
export const Random = {
  get value() { return Math.random(); },
  /** Float range (inclusive). */
  range(min: number, max: number) { return min + Math.random() * (max - min); },
  /** Integer range: min inclusive, max exclusive (Random.Range(int, int)). */
  rangeInt(min: number, max: number) { return max <= min ? min : min + Math.floor(Math.random() * (max - min)); },
  get insideUnitCircle() {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
    return new V2(Math.cos(a) * r, Math.sin(a) * r);
  },
  get onUnitCircle() { const a = Math.random() * Math.PI * 2; return new V2(Math.cos(a), Math.sin(a)); },
  colorHSV(hMin = 0, hMax = 1, sMin = 0, sMax = 1, vMin = 0, vMax = 1) {
    return Color.HSVToRGB(Random.range(hMin, hMax), Random.range(sMin, sMax), Random.range(vMin, vMax));
  },
};

/**
 * Seeded generator with System.Random's API (Next, Next(max), Next(min, max), NextDouble). Not the same sequence
 * as .NET, but deterministic for a given seed, which is what the games rely on (repeatable levels).
 */
export class SysRandom {
  private s: number;
  constructor(seed?: number) {
    this.s = (seed === undefined ? (Math.random() * 2 ** 31) | 0 : seed) ^ 0x9e3779b9;
    this.s >>>= 0;
  }
  nextDouble(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** next() → [0, 2^31); next(max) → [0, max); next(min, max) → [min, max). */
  next(a?: number, b?: number): number {
    if (a === undefined) return Math.floor(this.nextDouble() * 2147483647);
    if (b === undefined) return Math.floor(this.nextDouble() * a);
    return b <= a ? a : a + Math.floor(this.nextDouble() * (b - a));
  }
}

export const Ease = {
  outCubic: (t: number) => { t = 1 - t; return 1 - t * t * t; },
  inQuad: (t: number) => t * t,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) * 0.5,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) * 0.5),
  outBack: (t: number) => { const c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; },
  linear: (t: number) => t,
};

export const Fmt = {
  /** Thousands separators (N0). */
  n: (v: number) => Math.round(v).toLocaleString("en-US"),
  clock(seconds: number) { const s = Math.max(0, Math.floor(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; },
  lap(seconds: number) {
    if (seconds <= 0 || !isFinite(seconds)) return "--:--.---";
    const ms = Math.round(seconds * 1000);
    return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
  },
};

/** UnityEngine.Rect (y up). */
export class Rect {
  constructor(readonly x = 0, readonly y = 0, readonly width = 0, readonly height = 0) {}
  static minMaxRect(xMin: number, yMin: number, xMax: number, yMax: number) { return new Rect(xMin, yMin, xMax - xMin, yMax - yMin); }
  get xMin() { return this.x; }
  get yMin() { return this.y; }
  get xMax() { return this.x + this.width; }
  get yMax() { return this.y + this.height; }
  get center() { return new V2(this.x + this.width / 2, this.y + this.height / 2); }
  get size() { return new V2(this.width, this.height); }
  get min() { return new V2(this.x, this.y); }
  get max() { return new V2(this.xMax, this.yMax); }
  contains(p: V2) { return p.x >= this.x && p.x < this.xMax && p.y >= this.y && p.y < this.yMax; }
  overlaps(o: Rect) { return o.xMax > this.x && o.x < this.xMax && o.yMax > this.y && o.y < this.yMax; }
}
