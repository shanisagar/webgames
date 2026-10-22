import { Art, CasualArt, Color, GameObject, Mathf, Sprite, V2, V3 } from "../../kit";

/**
 * "Sweet candy land" art for Candy Nova: shaded RGBA sprites rasterized once in code and cached (no texture assets).
 * Tintable sprites are greyscale (white = full colour), so SpriteRenderer.color gives the hue while the lighting stays
 * baked in. World sprites are one unit wide, like NeonArcade.Art. (Port of CandyArt.cs.)
 */

const cache = new Map<string, Sprite>();

// Light from the top-left, slightly in front.
const LightDir = new V3(-0.45, 0.62, 0.64).normalized;
const HalfDir = LightDir.add(new V3(0, 0, 1)).normalized;

const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;

// ------------------------------------------------------------------ palette

export const Plum = new Color(0.33, 0.13, 0.36);
export const PlumSoft = new Color(0.5, 0.25, 0.53);
export const Cream = new Color(1.0, 0.97, 0.93);
export const Blush = new Color(1.0, 0.9, 0.95);
export const Berry = new Color(1.0, 0.31, 0.64);
export const Mint = new Color(0.2, 0.8, 0.62);
export const Honey = new Color(1.0, 0.76, 0.26);
export const Sky = new Color(0.25, 0.68, 1.0);
export const Leaf = new Color(0.12, 0.62, 0.36);

export const SprinkleColors = [
  new Color(1.0, 0.36, 0.62), new Color(0.32, 0.78, 1.0), new Color(1.0, 0.84, 0.25),
  new Color(0.36, 0.9, 0.55), new Color(0.74, 0.48, 1.0), new Color(1.0, 0.56, 0.3),
  Color.white,
];

// ------------------------------------------------------------------ candy masks (same silhouettes as before)

function HeartMask(p: V2) {
  const q = new V2(Math.abs(p.x), -p.y + 0.14);
  const lobe = q.sub(new V2(0.34, -0.22)).magnitude - 0.48;
  const tip = (q.x * 0.88 + q.y * 0.72) - 0.56;
  const roundBottom = p.sub(new V2(0, -0.22)).magnitude - 0.72;
  return Art.edge(-Math.min(lobe, Math.max(tip, roundBottom)));
}

function HexMask(p: V2) {
  const q = new V2(Math.abs(p.x), Math.abs(p.y));
  const hex = Math.max(q.x * 0.866025 + q.y * 0.5, q.y) - 0.84;
  const rounded = V2.max(q.sub(new V2(0.45, 0.45)), V2.zero).magnitude - 0.42;
  return Art.edge(-Mathf.lerp(hex, rounded, 0.25));
}

function CloverMask(p: V2) {
  const a = Math.atan2(p.y, p.x);
  return Art.edge(0.74 + 0.14 * Math.cos(a * 5) - p.magnitude);
}

function SunMask(p: V2) {
  const a = Math.atan2(p.y, p.x);
  return Art.edge(0.82 + 0.055 * Math.cos(a * 8) - p.magnitude);
}

function OctMask(p: V2) {
  const q = new V2(Math.abs(p.x), Math.abs(p.y));
  return Art.edge(-(Math.max(Math.max(q.x, q.y), (q.x + q.y) * 0.7071) - 0.85));
}

function TriMask(p: V2) {
  const q = new V2(Math.abs(p.x), p.y + 0.12);
  const side = q.x * 0.866 + q.y * 0.5 - 0.52;
  const baseLine = -q.y - 0.56;
  const circle = p.magnitude - 0.86;
  return Art.edge(-Math.max(circle, Math.max(side, baseLine)));
}

function MaskFor(colorIndex: number): (p: V2) => number {
  switch (colorIndex) {
    case 1: return HeartMask;
    case 2: return HexMask;
    case 3: return CloverMask;
    case 4: return SunMask;
    case 5: return OctMask;
    default: return TriMask;
  }
}

// ------------------------------------------------------------------ helpers

/** Shader-style smoothstep: 0 at e0, 1 at e1 (works with e0 > e1 too). */
function Smooth(e0: number, e1: number, x: number) {
  const t = Mathf.clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function Capsule(p: V2, halfLen: number, radius: number) {
  const x = Math.max(0, Math.abs(p.x) - halfLen);
  return Math.hypot(x, p.y) - radius;
}

/** Integer hash in [0, 1) with C#'s unchecked uint wrap-around. */
function Hash(x: number, y: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffffff) / 16777216;
}

const PixelToP = (x: number, y: number, n: number) => new V2(((x + 0.5) / n) * 2 - 1, ((y + 0.5) / n) * 2 - 1);

/** Approximate distance (pixels) from each inside pixel to the shape edge (two-pass chamfer). */
function InsideDistance(cov: Float32Array, n: number) {
  const big = 1e6, d1 = 1, d2 = 1.4142;
  const d = new Float32Array(n * n);
  for (let i = 0; i < d.length; i++) d[i] = cov[i] >= 0.5 ? big : 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (d[i] === 0) continue;
      let v = d[i];
      v = Math.min(v, (x > 0 ? d[i - 1] : 0) + d1);
      v = Math.min(v, (y > 0 ? d[i - n] : 0) + d1);
      v = Math.min(v, (x > 0 && y > 0 ? d[i - n - 1] : 0) + d2);
      v = Math.min(v, (x < n - 1 && y > 0 ? d[i - n + 1] : 0) + d2);
      d[i] = v;
    }
  for (let y = n - 1; y >= 0; y--)
    for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x;
      if (d[i] === 0) continue;
      let v = d[i];
      v = Math.min(v, (x < n - 1 ? d[i + 1] : 0) + d1);
      v = Math.min(v, (y < n - 1 ? d[i + n] : 0) + d1);
      v = Math.min(v, (x < n - 1 && y < n - 1 ? d[i + n + 1] : 0) + d2);
      v = Math.min(v, (x > 0 && y < n - 1 ? d[i + n - 1] : 0) + d2);
      d[i] = v;
    }
  // Sub-pixel edge from coverage so the bevel starts exactly at the anti-aliased rim.
  for (let i = 0; i < d.length; i++) d[i] = d[i] > 0 ? d[i] - 0.5 + cov[i] * 0.5 : cov[i] * 0.5;
  return d;
}

function Blur3(src: Float32Array, n: number) {
  const dst = new Float32Array(src.length);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let sum = 0, cnt = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const xx = x + ox, yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          sum += src[yy * n + xx]; cnt++;
        }
      dst[y * n + x] = sum / cnt;
    }
  return dst;
}

function NormalAt(h: Float32Array, n: number, x: number, y: number, step: number) {
  const xl = Math.max(0, x - 1), xr = Math.min(n - 1, x + 1);
  const yd = Math.max(0, y - 1), yu = Math.min(n - 1, y + 1);
  const dx = (h[y * n + xr] - h[y * n + xl]) / ((xr - xl) * step);
  const dy = (h[yu * n + x] - h[yd * n + x]) / ((yu - yd) * step);
  return new V3(-dx, -dy, 1).normalized;
}

/**
 * CandyArt.Make: fn gets p in [-1, 1] on both axes (y over the height), one unit wide. Baked through CasualArt.make,
 * whose p.y spans [-h/w, h/w] instead, so y is rescaled.
 */
function Make(key: string, w: number, h: number, fn: (p: V2) => Color): Sprite {
  const s = cache.get(key);
  if (s) return s;
  const k = w / h;
  const made = CasualArt.make(key, w, h, (p) => fn(new V2(p.x, p.y * k)));
  cache.set(key, made);
  return made;
}

/** A sprite from precomputed pixels (rows bottom → top), sampled at pixel centres by CasualArt.make. */
function FromPixels(key: string, px: Color[], n: number) {
  return CasualArt.make(key, n, n, (p) => {
    const x = Mathf.clamp(Math.round(((p.x + 1) / 2) * n - 0.5), 0, n - 1);
    const y = Mathf.clamp(Math.round(((p.y + 1) / 2) * n - 0.5), 0, n - 1);
    return px[y * n + x];
  });
}

// ------------------------------------------------------------------ candies

const CandyRes = 160;

function BuildCandy(colorIndex: number) {
  const n = CandyRes;
  const mask = MaskFor(colorIndex);
  const cov = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) cov[y * n + x] = Mathf.clamp01(mask(PixelToP(x, y, n)));

  const dist = InsideDistance(cov, n); // in pixels
  const px2p = 2 / n;
  const bevel = 0.46;
  let height = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const d = dist[i] * px2p;
      const t = Mathf.clamp01(d / bevel);
      const u = 1 - t;
      let h = bevel * Math.sqrt(Math.max(0, 1 - u * u));
      const p = PixelToP(x, y, n);
      h += 0.1 * Math.max(0, 1 - p.sqrMagnitude); // gentle overall dome
      height[i] = cov[i] > 0 ? h : 0;
    }
  // Smooth away the chamfer distance facets so the bevel reads as one soft, rounded surface.
  for (let pass = 0; pass < 4; pass++) height = Blur3(height, n);

  const body: Color[] = new Array(n * n);
  const shine: Color[] = new Array(n * n);
  const clearW = new Color(1, 1, 1, 0);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const a = cov[i];
      if (a <= 0) { body[i] = clearW; shine[i] = clearW; continue; }
      const nrm = NormalAt(height, n, x, y, px2p);
      const p = PixelToP(x, y, n);
      const t = Mathf.clamp01((dist[i] * px2p) / bevel);

      const lambert = Math.max(0, dot3(nrm, LightDir));
      let shade = 0.6 + 0.62 * lambert;
      // Translucent "jelly" glow: light leaking out near the lower inner edge.
      shade += 0.2 * Smooth(0.15, 0.85, t) * (1 - t) * Mathf.clamp01(-p.y * 1.2 + 0.2);
      // Thin darker outline makes candies read clearly on light tiles.
      shade *= Mathf.lerp(0.62, 1, Smooth(0.0, 0.16, t));
      shade = Mathf.clamp01(shade);
      body[i] = new Color(shade, shade, shade, a);

      const spec = Math.pow(Math.max(0, dot3(nrm, HalfDir)), 22);
      // Big glossy "sugar glass" highlight on the upper-left, kept inside the bevel.
      const q = p.sub(new V2(-0.24, 0.3));
      const qr = new V2(q.x * 0.82 + q.y * 0.57, (-q.x * 0.57 + q.y * 0.82) * 1.9);
      const blob = Smooth(0.3, 0.1, qr.magnitude) * Smooth(0.25, 0.55, t);
      const rim = Smooth(0.5, 0, t) * Mathf.clamp01(-p.y * 0.9 + p.x * 0.3) * 0.22; // bounce light
      const sa = Mathf.clamp01(spec * 0.85 + blob * 0.78 + rim) * a;
      shine[i] = new Color(1, 1, 1, sa);
    }

  cache.set("cn2-body-" + colorIndex, FromPixels("cn2-body-" + colorIndex, body, n));
  cache.set("cn2-shine-" + colorIndex, FromPixels("cn2-shine-" + colorIndex, shine, n));
}

/** Juicy, lit candy body for colour 1..6. Tintable. */
export function CandyBody(colorIndex: number) {
  colorIndex = Mathf.clamp(colorIndex, 1, 6);
  const key = "cn2-body-" + colorIndex;
  if (!cache.has(key)) BuildCandy(colorIndex);
  return cache.get(key)!;
}

/** Shape-following specular shine for colour 1..6 (white with alpha). */
export function CandyShine(colorIndex: number) {
  colorIndex = Mathf.clamp(colorIndex, 1, 6);
  const key = "cn2-shine-" + colorIndex;
  if (!cache.has(key)) BuildCandy(colorIndex);
  return cache.get(key)!;
}

/** Chocolate truffle covered in rainbow sprinkles: the Nova colour bomb (RGBA, not tinted). */
export const ChocoBomb = () => Make("cn2-choco", CandyRes, CandyRes, (p) => {
  const r = p.magnitude / 0.86;
  const a = Art.edge(0.86 - p.magnitude, CandyRes);
  if (a <= 0) return Color.clear;
  const z = Math.sqrt(Math.max(0, 1 - Math.min(1, r * r)));
  const n = new V3(p.x / 0.86, p.y / 0.86, z).normalized;
  const lambert = Math.max(0, dot3(n, LightDir));
  const dark = new Color(0.2, 0.09, 0.05);
  const light = new Color(0.55, 0.29, 0.16);
  let c = Color.lerp(dark, light, lambert);

  // Sprinkles: short rotated capsules on a jittered grid.
  const cell = 0.24;
  const gx = Math.floor((p.x + 1) / cell), gy = Math.floor((p.y + 1) / cell);
  for (let oy = -1; oy <= 1; oy++)
    for (let ox = -1; ox <= 1; ox++) {
      const cx = gx + ox, cy = gy + oy;
      const h1 = Hash(cx, cy), h2 = Hash(cx + 17, cy - 9), h3 = Hash(cx - 31, cy + 5);
      const centre = new V2((cx + 0.2 + 0.6 * h1) * cell - 1, (cy + 0.2 + 0.6 * h2) * cell - 1);
      if (centre.magnitude > 0.8) continue;
      const ang = h3 * Math.PI;
      const d = p.sub(centre);
      const local = new V2(d.x * Math.cos(ang) + d.y * Math.sin(ang), -d.x * Math.sin(ang) + d.y * Math.cos(ang));
      const sd = Capsule(local, 0.055, 0.026);
      if (sd < 0) {
        const sc = SprinkleColors[Math.trunc(Hash(cx + 3, cy + 11) * 6.999)];
        const lit = 0.62 + 0.45 * lambert;
        c = Color.lerp(c, sc.mul(lit), Mathf.clamp01(-sd * CandyRes * 0.5 + 0.5));
      }
    }
  c = c.mul(Mathf.lerp(0.75, 1, Smooth(0.86, 0.7, r * 0.86))); // darker silhouette edge
  return c.withAlpha(a);
});

// ------------------------------------------------------------------ board

function CloudBand(p: V2, yCentre: number, thickness: number, seed: number) {
  let k = 0;
  for (let b = 0; b < 9; b++) {
    const bx = -1.15 + b * 0.29 + (Hash(b, Math.trunc(seed)) - 0.5) * 0.12;
    const r = thickness * (1.0 + 1.1 * Hash(b + 5, Math.trunc(seed)));
    const by = yCentre + r * 0.35;
    const d = Math.hypot((p.x - bx) * 0.6, p.y - by);
    k = Math.max(k, Smooth(r, r - 0.05, d));
  }
  // Flat cloud bottoms.
  k *= Smooth(yCentre - 0.02, yCentre + 0.03, p.y);
  return Mathf.clamp01(k);
}

/** Pastel sky with fluffy clouds; stretched to fill the view (RGBA). */
export const SkyBackdrop = () => Make("cn2-sky", 256, 256, (p) => {
  const y = p.y * 0.5 + 0.5; // 0 bottom .. 1 top
  const top = new Color(1.0, 0.8, 0.9);
  const mid = new Color(0.9, 0.84, 1.0);
  const bottom = new Color(0.78, 0.95, 0.93);
  let c = y > 0.5 ? Color.lerp(mid, top, (y - 0.5) * 2) : Color.lerp(bottom, mid, y * 2);

  let cloud = 0;
  cloud = Math.max(cloud, CloudBand(p, 0.66, 0.1, 3.1));
  cloud = Math.max(cloud, CloudBand(p, -0.7, 0.13, 7.7) * 0.9);
  cloud = Math.max(cloud, CloudBand(p, 0.05, 0.05, 12.3) * 0.35);
  c = Color.lerp(c, Color.white, cloud * 0.85);

  const vign = Smooth(0.6, 1.45, Math.hypot(p.x, p.y * 0.9));
  c = Color.lerp(c, new Color(0.93, 0.7, 0.86), vign * 0.45);
  return c.withAlpha(1);
});

/** Candy-cane striped frame band around the board (RGBA). Inner edge at 90% of the half size. */
export const CandyCaneFrame = () => Make("cn2-cane", 512, 512, (p) => {
  const outer = Art.roundBox(p, 0.995, 0.1);
  const inner = Art.roundBox(p, 0.9, 0.05);
  const a = Math.min(Art.edge(-outer, 512), Art.edge(inner, 512));
  if (a <= 0) return Color.clear;
  const band = Mathf.clamp01(-outer / Math.max(0.001, -outer + inner)); // 0 outer .. 1 inner
  const stripe = Mathf.repeat((p.x + p.y) * 8.5, 1);
  const sEdge = Mathf.clamp01(Math.min(Math.abs(stripe - 0.25), Math.abs(stripe - 0.75)) * 40);
  const pink = stripe > 0.25 && stripe < 0.75;
  const baseCol = pink ? new Color(1.0, 0.36, 0.6) : new Color(1.0, 0.97, 0.98);
  const otherCol = pink ? new Color(1.0, 0.97, 0.98) : new Color(1.0, 0.36, 0.6);
  let c = Color.lerp(Color.lerp(baseCol, otherCol, 0.5), baseCol, sEdge);
  // Tube shading across the band, lit from the top-left.
  const tube = Math.sin(band * Math.PI);
  const facing = (p.y - p.x) * 0.5;
  const shade = 0.7 + 0.3 * tube + 0.1 * facing;
  c = c.mul(Mathf.clamp(shade, 0.55, 1.08));
  const hi = Math.pow(Mathf.clamp01(1 - Math.abs(band - 0.32) * 7), 2) * 0.35;
  c = Color.lerp(c, Color.white, hi);
  return c.withAlpha(a);
});

/** Cream tray inside the frame, with a soft inner shadow under the top-left lip. Tintable. */
export const Tray = () => Make("cn2-tray", 256, 256, (p) => {
  const sd = Art.roundBox(p, 0.995, 0.04);
  const a = Art.edge(-sd, 256);
  if (a <= 0) return Color.clear;
  const inside = -sd;
  const shadowTop = Smooth(0.07, 0, inside) * (0.6 + 0.4 * Mathf.clamp01(p.y - p.x * 0.3));
  const shade = 1 - 0.22 * shadowTop;
  return new Color(shade, shade, shade, a);
});

/** Soft rounded tile with a sugary bevel. Tintable. */
export const Tile = () => Make("cn2-tile", 96, 96, (p) => {
  const sd = Art.roundBox(p, 0.95, 0.3);
  const a = Art.edge(-sd, 96);
  if (a <= 0) return Color.clear;
  const depth = -sd;
  const e = 0.01;
  let grad = new V2(
    Art.roundBox(p.add(new V2(e, 0)), 0.95, 0.3) - Art.roundBox(p.sub(new V2(e, 0)), 0.95, 0.3),
    Art.roundBox(p.add(new V2(0, e)), 0.95, 0.3) - Art.roundBox(p.sub(new V2(0, e)), 0.95, 0.3));
  if (grad.sqrMagnitude > 1e-8) grad = grad.normalized;
  const edgeK = 1 - Mathf.clamp01(depth / 0.16);
  const facing = V2.dot(grad, new V2(LightDir.x, LightDir.y).normalized);
  let shade = 0.95 + 0.03 * p.y + facing * 0.12 * edgeK;
  shade -= 0.06 * edgeK * edgeK;
  return new Color(Mathf.clamp01(shade), Mathf.clamp01(shade), Mathf.clamp01(shade), a);
});

/** Frosting with drips that hangs over the top of the frame (RGBA). 1 unit wide, 0.1875 tall. */
export const Icing = () => Make("cn2-icing", 512, 96, (p) => {
  // p.x in [-1,1] across the width; p.y in [-1,1] over the 0.1875-tall strip.
  // Work in units of the frame width: wx in [-0.5,0.5], wy measured down from the strip top.
  const wx = p.x * 0.5;
  const wy = (1 - p.y) * 0.5 * 0.1875;
  const half = 0.5, corner = 0.045;
  const ax = Math.abs(wx);
  if (ax > half - 0.004) return Color.clear;
  const topEdge = 0.004 + 0.003 * Math.sin(wx * 37);
  if (ax > half - corner && wy < corner) {
    const dx = ax - (half - corner), dy = corner - wy;
    if (dx * dx + dy * dy > corner * corner) return Color.clear;
  }
  let bottom = 0.052 + 0.006 * Math.sin(wx * 23 + 1.3);
  for (let k = 0; k < 13; k++) {
    const xc = -0.46 + k * 0.0766 + (Hash(k, 3) - 0.5) * 0.03;
    const w = 0.012 + 0.012 * Hash(k, 7);
    const len = 0.015 + 0.075 * Hash(k, 11);
    const u = (wx - xc) / w;
    if (Math.abs(u) < 1) {
      const tongue = Math.sqrt(1 - u * u);
      bottom = Math.max(bottom, 0.05 + len * Math.pow(tongue, 0.6));
    }
  }
  const inside = Math.min(wy - topEdge, bottom - wy);
  const a = Mathf.clamp01(inside * 512 * 1.4 + 0.5);
  if (a <= 0) return Color.clear;
  let c = Color.lerp(new Color(1, 0.99, 1), new Color(1, 0.86, 0.93), Mathf.clamp01(wy / 0.12));
  const nearBottom = Smooth(0.01, 0, bottom - wy);
  c = Color.lerp(c, new Color(0.96, 0.7, 0.84), nearBottom * 0.55);
  const gloss = Smooth(0.012, 0.004, Math.abs(wy - 0.016)) * 0.5;
  c = Color.lerp(c, Color.white, gloss);

  // Sugar sprinkles baked into the frosting.
  const cell = 0.03;
  const gx = Math.floor((wx + 0.5) / cell);
  for (let o = -1; o <= 1; o++) {
    const cx = gx + o;
    const h1 = Hash(cx, 41), h2 = Hash(cx, 43), h3 = Hash(cx, 47);
    const centre = new V2(cx * cell - 0.5 + cell * (0.2 + 0.6 * h1), 0.016 + 0.026 * h2);
    const ang = h3 * Math.PI;
    const d = new V2(wx, wy).sub(centre);
    const local = new V2(d.x * Math.cos(ang) + d.y * Math.sin(ang), -d.x * Math.sin(ang) + d.y * Math.cos(ang));
    const sd = Capsule(local, 0.0045, 0.0018);
    if (sd < 0 && Hash(cx, 53) > 0.35)
      c = Color.lerp(c, SprinkleColors[Math.trunc(Hash(cx, 59) * 5.999)], Mathf.clamp01(-sd * 512 + 0.5));
  }
  return c.withAlpha(a);
});

/** Glossy jelly slab under a candy. Tintable, slightly translucent. */
export const JellySlab = () => Make("cn2-jelly", 96, 96, (p) => {
  const wob = 0.012 * Math.sin(p.x * 9) + 0.012 * Math.sin(p.y * 7 + 1);
  const sd = Art.roundBox(p, 0.93 + wob, 0.34);
  const a = Art.edge(-sd, 96);
  if (a <= 0) return Color.clear;
  const depth = Mathf.clamp01(-sd / 0.3);
  let shade = 0.62 + 0.38 * depth + 0.1 * p.y;
  const streak = Smooth(0.1, 0, Math.abs((p.y - 0.52) + 0.25 * p.x)) * Smooth(0.8, 0.2, Math.abs(p.x + 0.15));
  shade = Mathf.clamp01(shade + streak * 0.35);
  return new Color(shade, shade, shade, a * 0.92);
});

/** Faceted ice cube with cracks and a frosty rim. Tintable. */
export const IceCube = () => Make("cn2-ice", 128, 128, (p) => {
  const sd = Art.roundBox(p, 0.94, 0.18);
  const a = Art.edge(-sd, 128);
  if (a <= 0) return Color.clear;
  const depth = -sd;
  const bevel = 1 - Mathf.clamp01(depth / 0.18);
  let shade = 0.8 + 0.12 * (p.y - p.x) * 0.5;
  // Bevel facets: top/left bright, bottom/right darker.
  if (bevel > 0) {
    const topLeft = p.y - p.x > 0;
    shade += (topLeft ? 0.18 : -0.16) * bevel;
  }
  // Cracks
  const c1 = Math.abs(p.y - 0.55 * p.x - 0.08) - 0.012;
  const c2 = Math.abs(p.y + 1.6 * p.x - 0.3) - 0.01;
  const crack = Math.max(Art.edge(-c1, 128) * Smooth(0.7, 0.3, p.magnitude), Art.edge(-c2, 128) * Smooth(0.55, 0.15, p.magnitude));
  shade = Mathf.lerp(shade, 1.0, crack * 0.8);
  // Frosty sparkle specks
  const speck = Hash(Math.floor(p.x * 24), Math.floor(p.y * 24)) > 0.94 ? 0.18 : 0;
  shade = Mathf.clamp01(shade + speck);
  return new Color(shade, shade, shade, a * 0.94);
});

// ------------------------------------------------------------------ small alpha shapes (tint them)

export const SelectFrame = () => Art.shape("cn2-select", (p) => Art.edge(0.075 - Math.abs(Art.roundBox(p, 0.9, 0.34))));
export const Twinkle = () => Art.shape("cn2-twinkle", (p) => {
  const ax = Math.abs(p.x), ay = Math.abs(p.y);
  const star = Math.exp(-ax * ay * 70) * Mathf.clamp01(1 - p.magnitude);
  const core = Mathf.clamp01(1 - p.magnitude * 3.2);
  return Mathf.clamp01(star * star + core);
});
export const Bubble = () => Art.shape("cn2-bubble", (p) => {
  const r = p.magnitude;
  const ring = Art.edge(0.07 - Math.abs(r - 0.84));
  const fill = Art.edge(0.84 - r) * 0.18;
  const hi = Art.edge(0.2 - p.sub(new V2(-0.34, 0.36)).magnitude) * 0.9;
  return Mathf.clamp01(Math.max(ring, Math.max(fill, hi)));
});
export const Sprinkle = () => Art.shape("cn2-sprinkle", (p) => Art.edge(-Capsule(p, 0.62, 0.32)), 64);

/** Soft round falloff (white with alpha) for shadows and glows on light backgrounds. */
export const Soft = () => Make("cn2-soft", 64, 64, (p) => {
  const a = Mathf.clamp01(1 - p.magnitude);
  return new Color(1, 1, 1, a * a);
});

export function Spr(parent: GameObject | null, name: string, sprite: Sprite, color: Color, size: number, order: number) {
  return Art.spr(parent, name, sprite, color, size, order, Art.Flat);
}
