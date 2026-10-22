import { Art, CasualArt, Color, GameObject, Mathf, Sprite, SpriteRenderer, V2, V3 } from "../../kit";

/**
 * Procedural art for Skyfire: top-down WWII-style planes, terrain tiles and decor, bullets, explosions and
 * pickups. Everything is rasterized once in code (no texture assets) and cached. Planes point UP (+Y).
 * World sprites are one unit wide (pixels-per-unit = texture width), like NeonArcade.Art. (Port of SkyfireArt.cs.)
 */

// ------------------------------------------------------------------ planes

export enum PlaneStyle { Fighter, EnemyFighter, Interceptor, Bomber, Fortress }
export enum Pickup { Power, Bomb, Health, Support, Coin }
export enum Theme { Ocean, Desert, Arctic }

const resFor = (s: PlaneStyle) => (s === PlaneStyle.Fortress ? 512 : s === PlaneStyle.Bomber ? 320 : 224);

function colorKey(c: Color) {
  const h = (v: number) => Math.trunc(v * 255).toString(16).toUpperCase().padStart(2, "0");
  return h(c.r) + h(c.g) + h(c.b);
}

/** The visible part at one pixel, with an approximate surface normal for lighting. */
interface Part {
  D: number;  // union signed distance (negative inside), for the outline
  Id: number; // 0 none, 1 wing, 2 tail, 3 fuselage, 4 engine, 5 canopy, 6 nose, 7 turret
  PD: number; // signed distance inside the visible part (for bevels)
  Nx: number; Ny: number; // surface normal xy (z is derived)
  U: number;  // part-local coordinate (chord position, cylinder offset...)
}

function take(best: Part, d: number, id: number, nx: number, ny: number, u: number) {
  // Later parts draw on top when inside them; the union distance is kept for the outline.
  if (d < 0) { best.Id = id; best.PD = d; best.Nx = nx; best.Ny = ny; best.U = u; }
  best.D = Math.min(best.D, d);
}

/** Airfoil-like wing normal: rises from the trailing edge to a crest near the leading edge. */
function wingNy(lead: number, trail: number, y: number) {
  const t = Mathf.clamp01((y - trail) / Math.max(0.001, lead - trail)); // 0 trailing .. 1 leading
  return t > 0.72 ? ((t - 0.72) / 0.28) * 0.75 : (-(0.72 - t) / 0.72) * 0.32;
}

function layout(style: PlaneStyle, p: V2): Part {
  const part: Part = { D: 9, Id: 0, PD: 0, Nx: 0, Ny: 0, U: 0 };
  const ax = Math.abs(p.x), sx = p.x < 0 ? -1 : 1;
  switch (style) {
    case PlaneStyle.Fighter:
    case PlaneStyle.EnemyFighter:
    case PlaneStyle.Interceptor: {
      const enemy = style !== PlaneStyle.Fighter;
      const inter = style === PlaneStyle.Interceptor;
      const span = inter ? 0.84 : 0.92;
      const wy0 = inter ? -0.05 : 0.02, wy1 = inter ? 0.30 : 0.34;
      const lead = wy1 - ((enemy ? 0.10 : 0.07) * ax) / span;
      const trail = wy0 + ((inter ? 0.22 : 0.10) * ax) / span;
      let dw = Math.max(Math.max(trail - p.y, p.y - lead), ax - span);
      const tipR = new V2(Math.max(0, ax - (span - 0.08)), Math.max(0, Math.abs(p.y - (lead + trail) * 0.5) - (lead - trail) * 0.5 + 0.06)).magnitude - 0.08;
      if (ax > span - 0.08) dw = Math.max(dw, tipR);
      const tipN = Mathf.clamp01((ax - (span - 0.14)) / 0.14);
      take(part, dw, 1, sx * tipN * 0.6, wingNy(lead, trail, p.y), (p.y - trail) / Math.max(0.001, lead - trail));

      const tl = -0.62, tt = -0.80, ts = inter ? 0.30 : 0.36;
      const dt = Math.max(Math.max(tt - p.y, p.y - tl), ax - ts);
      take(part, dt, 2, sx * Mathf.clamp01((ax - ts + 0.08) / 0.08) * 0.5, wingNy(tl, tt, p.y), 0);

      let halfW = Mathf.lerp(0.05, 0.14, Mathf.clamp01((p.y + 0.9) / 1.2));
      if (p.y > 0.3) halfW = Mathf.lerp(0.14, 0.10, Mathf.clamp01((p.y - 0.3) / 0.55));
      const df = Math.max(ax - halfW, Math.max(-0.9 - p.y, p.y - 0.86));
      const c = Mathf.clamp(p.x / halfW, -1, 1);
      take(part, df, 3, c * 0.92, p.y > 0.6 ? (p.y - 0.6) * 1.2 : 0, c);

      const dn = Math.max(ax - 0.11, Math.max(0.66 - p.y, p.y - 0.86));
      const cn = Mathf.clamp(p.x / 0.11, -1, 1);
      take(part, dn, 6, cn * 0.9, (p.y - 0.66) * 2.2, cn);

      const q = new V2(p.x / 0.065, (p.y - 0.16) / 0.15);
      take(part, (q.magnitude - 1) * 0.06, 5, Mathf.clamp(q.x, -1, 1) * 0.8, Mathf.clamp(q.y, -1, 1) * 0.6, 0);
      break;
    }
    case PlaneStyle.Bomber: {
      const lead = 0.30 - 0.06 * ax, trail = 0.05 + 0.07 * ax;
      const dw = Math.max(Math.max(trail - p.y, p.y - lead), ax - 0.97);
      take(part, dw, 1, sx * Mathf.clamp01((ax - 0.86) / 0.11) * 0.6, wingNy(lead, trail, p.y), (p.y - trail) / Math.max(0.001, lead - trail));
      const dt = Math.max(Math.max(-0.86 - p.y, p.y + 0.66), ax - 0.42);
      take(part, dt, 2, 0, wingNy(-0.66, -0.86, p.y), 0);
      const halfW = Mathf.lerp(0.07, 0.15, Mathf.clamp01((p.y + 0.9) / 1.0));
      const df = Math.max(ax - halfW, Math.max(-0.92 - p.y, p.y - 0.84));
      const c = Mathf.clamp(p.x / halfW, -1, 1);
      take(part, df, 3, c * 0.92, p.y > 0.62 ? (p.y - 0.62) * 1.6 : 0, c);
      for (let i = 0; i < 2; i++) {
        const ex = i === 0 ? 0.34 : 0.64;
        const q = new V2((ax - ex) / 0.075, (p.y - 0.30) / 0.2);
        take(part, (q.magnitude - 1) * 0.075, 4, Mathf.clamp(q.x, -1, 1) * sx * 0.9, Mathf.clamp(q.y, -1, 1) * 0.5, q.y);
      }
      const cq = new V2(p.x / 0.07, (p.y - 0.58) / 0.12);
      take(part, (cq.magnitude - 1) * 0.06, 5, Mathf.clamp(cq.x, -1, 1) * 0.8, Mathf.clamp(cq.y, -1, 1) * 0.6, 0);
      break;
    }
    case PlaneStyle.Fortress: {
      const lead = 0.34 - 0.08 * ax, trail = 0.0 + 0.10 * ax;
      const dw = Math.max(Math.max(trail - p.y, p.y - lead), ax - 0.98);
      take(part, dw, 1, sx * Mathf.clamp01((ax - 0.88) / 0.1) * 0.6, wingNy(lead, trail, p.y), (p.y - trail) / Math.max(0.001, lead - trail));
      const dt = Math.max(Math.max(-0.92 - p.y, p.y + 0.70), ax - 0.50);
      take(part, dt, 2, 0, wingNy(-0.70, -0.92, p.y), 0);
      const halfW = Mathf.lerp(0.09, 0.20, Mathf.clamp01((p.y + 0.95) / 1.05));
      const df = Math.max(ax - halfW, Math.max(-0.95 - p.y, p.y - 0.86));
      const c = Mathf.clamp(p.x / halfW, -1, 1);
      take(part, df, 3, c * 0.92, p.y > 0.66 ? (p.y - 0.66) * 1.6 : 0, c);
      for (let i = 0; i < 3; i++) {
        const ex = 0.30 + i * 0.24;
        const q = new V2((ax - ex) / 0.07, (p.y - 0.34 + i * 0.02) / 0.2);
        take(part, (q.magnitude - 1) * 0.07, 4, Mathf.clamp(q.x, -1, 1) * sx * 0.9, Mathf.clamp(q.y, -1, 1) * 0.5, q.y);
      }
      for (let i = 0; i < 3; i++) {
        const ty = 0.52 - i * 0.42;
        const q = new V2(p.x, p.y - ty).div(0.075);
        take(part, (q.magnitude - 1) * 0.075, 7, Mathf.clamp(q.x, -1, 1) * 0.85, Mathf.clamp(q.y, -1, 1) * 0.85, 0);
      }
      const cq = new V2(p.x / 0.08, (p.y - 0.70) / 0.10);
      take(part, (cq.magnitude - 1) * 0.06, 5, Mathf.clamp(cq.x, -1, 1) * 0.8, Mathf.clamp(cq.y, -1, 1) * 0.6, 0);
      break;
    }
  }
  return part;
}

const PlaneLight = new V3(-0.5, 0.55, 0.67).normalized;
const PlaneHalf = new V3(-0.5, 0.55, 0.67).normalized.add(new V3(0, 0, 1)).normalized;

function planePixel(style: PlaneStyle, p: V2, body: Color, wing: Color, accent: Color, silhouette: boolean, res: number): Color {
  const part = layout(style, p);
  const px = 2 / res;
  const a = Mathf.clamp01(-part.D / px + 0.5);
  if (a <= 0) return Color.clear;
  if (silhouette) return new Color(1, 1, 1, a);

  const ax = Math.abs(p.x);
  const small = style !== PlaneStyle.Bomber && style !== PlaneStyle.Fortress;
  let baseC: Color;
  let gloss = 0.35; // specular strength (painted metal)
  switch (part.Id) {
    case 1: {
      baseC = wing;
      const tip = style === PlaneStyle.Fighter ? 0.80 : style === PlaneStyle.Bomber ? 0.86 : 0.78;
      if (ax > tip && style !== PlaneStyle.Fortress) baseC = accent;
      if (style !== PlaneStyle.Fortress) {
        const mx = style === PlaneStyle.Bomber ? 0.5 : 0.55;
        const md = new V2(ax - mx, p.y - 0.18).magnitude;
        if (md < 0.10) baseC = md < 0.055 ? Color.lerp(accent, Color.white, 0.2) : new Color(0.96, 0.95, 0.9);
      }
      break;
    }
    case 2: baseC = ax > 0.24 && style === PlaneStyle.Fighter ? accent : wing; break;
    case 3:
      baseC = body;
      if (Math.abs(p.y + 0.48) < 0.04) baseC = accent;
      break;
    case 4: baseC = body.mul(0.8); break;
    case 5: baseC = new Color(0.12, 0.20, 0.30); gloss = 1.2; break;
    case 6: baseC = accent; break;
    case 7: baseC = new Color(0.22, 0.22, 0.26); gloss = 0.8; break;
    default: baseC = body; break;
  }

  // Lighting from the top-left: diffuse + specular, with slight weathering
  const nz = Math.sqrt(Math.max(0.05, 1 - part.Nx * part.Nx - part.Ny * part.Ny));
  const n = new V3(part.Nx, part.Ny, nz).normalized;
  const diff = Math.max(0, V3.dot(n, PlaneLight));
  const spec = Math.pow(Math.max(0, V3.dot(n, PlaneHalf)), part.Id === 5 ? 40 : 18) * gloss;
  let shade = 0.42 + 0.72 * diff;

  // Ambient occlusion: wings and tail darken where they meet the fuselage
  if (part.Id === 1 || part.Id === 2) {
    const body0 = style === PlaneStyle.Fortress ? 0.20 : style === PlaneStyle.Bomber ? 0.15 : 0.14;
    shade *= Mathf.lerp(0.72, 1, Mathf.clamp01((ax - body0) / 0.12));
  }
  // Panel lines and rivets on wings and fuselage
  if (part.Id === 1) {
    const rib = Math.abs(Mathf.repeat(ax * (small ? 6 : 9), 1) - 0.5);
    if (rib > 0.47) shade *= 0.86;
    if (part.U > 0.35 && part.U < 0.42) shade *= 0.9; // flap line
  }
  if (part.Id === 3) {
    const seg = Math.abs(Mathf.repeat(p.y * (small ? 5 : 7), 1) - 0.5);
    if (seg > 0.475) shade *= 0.85;
  }
  if (part.Id === 4 && part.U > 0.75) { baseC = new Color(0.12, 0.12, 0.14); gloss = 0.2; } // engine intake
  const wear = (Mathf.perlinNoise(p.x * 9 + 3, p.y * 9 + 7) - 0.5) * 0.12;
  shade = Math.max(0, shade + wear);

  // Bevel: a thin bright rim on the lit side and dark rim on the shadow side of each part
  const rim = Mathf.clamp01(1 + part.PD / (2.5 * px));
  if (rim > 0) shade *= 1 - 0.25 * rim;

  let c = baseC.mul(shade).add(new Color(1, 1, 1).mul(spec));
  if (part.Id === 5) // canopy frame bar
    if (Math.abs(p.y - (style === PlaneStyle.Fortress ? 0.70 : style === PlaneStyle.Bomber ? 0.58 : 0.16)) < px * 1.5) c = c.mul(0.5);
  // Dark outline so planes read clearly over any terrain
  if (part.D > -1.6 * px) c = c.mul(0.35);
  return c.withAlpha(a);
}

function planeSprite(style: PlaneStyle, body: Color, wing: Color, accent: Color, silhouette: boolean) {
  const key = silhouette ? "sf2-sil-" + PlaneStyle[style] : `sf2-plane-${PlaneStyle[style]}-${colorKey(body)}-${colorKey(wing)}-${colorKey(accent)}`;
  const res = resFor(style);
  return make(key, res, res, (p) => planePixel(style, p, body, wing, accent, silhouette, res));
}

// ------------------------------------------------------------------ bullets, fx, pickups

function capsule(p: V2, halfLen: number, radius: number) {
  const y = Math.max(0, Math.abs(p.y) - halfLen);
  return new V2(p.x, y).magnitude - radius;
}

function starSd(p: V2, size: number) {
  const a = Math.atan2(p.y, p.x) - Math.PI * 0.5;
  const wave = 0.5 + 0.5 * Math.cos(a * 5);
  return p.magnitude - size * (0.45 + 0.55 * wave);
}

/** Enemy round: white outer rim + dark ring + bright body + white core: readable on any ground. */
function orb(p: V2, body: Color, core: Color) {
  const r = p.magnitude;
  if (r > 0.96) return Color.clear;
  const a = Mathf.clamp01((0.96 - r) * 30);
  let c: Color;
  if (r > 0.84) c = new Color(1, 1, 1);
  else if (r > 0.66) c = new Color(0.22, 0.02, 0.08);
  else if (r > 0.30) c = Color.lerp(body, core, ((0.66 - r) / 0.36) * 0.5);
  else c = Color.lerp(core, Color.white, 1 - r / 0.30);
  return c.withAlpha(a);
}

function pickupPixel(kind: Pickup, p: V2): Color {
  const r = p.magnitude;
  if (kind === Pickup.Coin) {
    const ac = Mathf.clamp01((0.9 - r) * 30);
    if (ac <= 0) return Color.clear;
    let cc = r > 0.74 ? new Color(0.62, 0.38, 0.04) : new Color(1, 0.80, 0.20).mul(0.88 + 0.2 * p.y);
    if (r < 0.62 && starSd(p, 0.42) < 0) cc = new Color(1, 0.95, 0.6);
    return cc.withAlpha(ac);
  }
  const a = Mathf.clamp01((0.92 - r) * 30);
  if (a <= 0) return Color.clear;
  const fill = kind === Pickup.Power ? new Color(0.92, 0.16, 0.2)
    : kind === Pickup.Bomb ? new Color(0.16, 0.42, 0.95)
      : kind === Pickup.Health ? new Color(0.13, 0.72, 0.36)
        : new Color(0.98, 0.62, 0.10);
  let c = r > 0.78 ? Color.white : fill.mul(0.85 + 0.25 * p.y);
  if (r <= 0.78) {
    let icon = false;
    switch (kind) {
      case Pickup.Power: // double chevron up
        for (let i = 0; i < 2; i++) {
          const oy = -0.22 + i * 0.34;
          const d = Math.abs(p.y - oy - (0.32 - Math.abs(p.x) * 0.75)) - 0.075;
          if (d < 0 && Math.abs(p.x) < 0.42) icon = true;
        }
        break;
      case Pickup.Bomb:
        if (new V2(p.x, p.y + 0.08).magnitude < 0.34) icon = true;
        if (Math.abs(p.x - 0.18) < 0.06 && p.y > 0.12 && p.y < 0.46) icon = true;
        break;
      case Pickup.Health:
        if ((Math.abs(p.x) < 0.13 && Math.abs(p.y) < 0.44) || (Math.abs(p.y) < 0.13 && Math.abs(p.x) < 0.44)) icon = true;
        break;
      case Pickup.Support: // tiny plane
        if ((Math.abs(p.x) < 0.08 && Math.abs(p.y) < 0.44) || (Math.abs(p.y - 0.08) < 0.09 && Math.abs(p.x) < 0.44)
          || (Math.abs(p.y + 0.36) < 0.06 && Math.abs(p.x) < 0.2)) icon = true;
        break;
    }
    if (icon) c = Color.white;
    // gloss
    const gl = Mathf.clamp01(1 - new V2((p.x + 0.25) * 1.3, (p.y - 0.42) * 2.4).magnitude);
    c = Color.lerp(c, Color.white, gl * 0.45);
  }
  return c.withAlpha(a);
}

// ------------------------------------------------------------------ terrain

function groundPixel(theme: Theme, p: V2): Color {
  // Periodic in [-1,1]: only integer frequencies, so the tile repeats seamlessly.
  const u = (p.x + 1) * Math.PI, v = (p.y + 1) * Math.PI;
  switch (theme) {
    case Theme.Desert: {
      const dune = 0.5 + 0.5 * Math.sin(3 * u + 1.5 * Math.sin(2 * v) + 2 * v);
      const fine = 0.5 + 0.5 * Math.sin(9 * u + 7 * v + Math.sin(3 * u));
      return Color.lerp(new Color(0.80, 0.64, 0.40), new Color(0.90, 0.76, 0.52), dune * 0.8 + fine * 0.2).withAlpha(1);
    }
    case Theme.Arctic: {
      const w = 0.5 + 0.5 * Math.sin(4 * u + 1.3 * Math.sin(3 * v));
      const w2 = 0.5 + 0.5 * Math.sin(6 * v + 2 * u + Math.sin(2 * u));
      let c = Color.lerp(new Color(0.13, 0.30, 0.45), new Color(0.17, 0.36, 0.52), w * 0.55 + w2 * 0.45);
      if (Math.sin(10 * u + 8 * v + 3 * Math.sin(4 * v)) > 0.985) c = Color.lerp(c, Color.white, 0.25);
      return c.withAlpha(1);
    }
    default: {
      const w = 0.5 + 0.5 * Math.sin(4 * u + 1.3 * Math.sin(3 * v));
      const w2 = 0.5 + 0.5 * Math.sin(6 * v + 2 * u + Math.sin(2 * u));
      let c = Color.lerp(new Color(0.12, 0.45, 0.74), new Color(0.16, 0.53, 0.82), w * 0.55 + w2 * 0.45);
      if (Math.sin(10 * u + 8 * v + 3 * Math.sin(4 * v)) > 0.985) c = Color.lerp(c, Color.white, 0.25);
      return c.withAlpha(1);
    }
  }
}

function decorPixel(theme: Theme, variant: number, p: V2): Color {
  const seed = variant * 17.3 + theme * 5.1;
  const ang = Math.atan2(p.y, p.x);
  const r = p.magnitude;
  const shape = 0.55 + 0.16 * Math.sin(ang * 3 + seed) + 0.09 * Math.sin(ang * 5 + seed * 1.7)
    + 0.08 * (Mathf.perlinNoise(Math.cos(ang) * 1.5 + seed, Math.sin(ang) * 1.5 + seed) - 0.5) * 2;
  const d = r - shape; // <0 inside
  switch (theme) {
    case Theme.Desert: {
      // Rock mesa with a dark rim and a shadow on one side, or an oasis for variant 3
      if (variant === 3) {
        const dd = r - shape * 0.75;
        if (dd > 0.10) return Color.clear;
        if (dd > 0.0) return new Color(0.42, 0.62, 0.25, Mathf.clamp01((0.10 - dd) * 12));
        const wa = 0.6 + 0.3 * Math.sin(r * 18);
        return new Color(0.12 * wa + 0.1, 0.55, 0.65, 1);
      }
      if (d > 0.08) return Color.clear;
      if (d > 0) return new Color(0.35, 0.24, 0.14, Mathf.clamp01((0.08 - d) * 12) * 0.5);
      const top = Mathf.clamp01(-d * 4);
      let c = Color.lerp(new Color(0.58, 0.38, 0.22), new Color(0.76, 0.54, 0.32), top);
      c = c.mul(0.85 + 0.25 * (p.y - p.x) * 0.5);
      if (Math.abs(Mathf.repeat(-d * 9, 1) - 0.5) > 0.46) c = c.mul(0.88); // strata lines
      return c.withAlpha(1);
    }
    case Theme.Arctic: {
      if (d > 0.06) return Color.clear;
      if (d > 0) return new Color(0.7, 0.86, 0.95, Mathf.clamp01((0.06 - d) * 16) * 0.6);
      const k = Mathf.clamp01(-d * 3);
      let c = Color.lerp(new Color(0.78, 0.88, 0.95), new Color(0.97, 0.99, 1), k);
      if (Math.abs(p.x * 0.7 + p.y * 0.3 - 0.1 * Math.sin(seed)) < 0.012 && k > 0.2) c = c.mul(0.85); // crack
      return c.withAlpha(1);
    }
    default: {
      // Island: shallow water halo, sand ring, grass, forest blotches
      if (d > 0.16) return Color.clear;
      if (d > 0.05) return new Color(0.45, 0.82, 0.86, Mathf.clamp01((0.16 - d) * 9) * 0.75);
      if (d > -0.03) return new Color(0.94, 0.86, 0.62, 1);
      const forest = Mathf.perlinNoise(p.x * 4 + seed, p.y * 4 - seed);
      let c = forest > 0.55 ? new Color(0.13, 0.45, 0.18) : new Color(0.33, 0.62, 0.25);
      c = c.mul(0.9 + 0.2 * Mathf.perlinNoise(p.x * 14, p.y * 14));
      // a few huts on bigger islands
      if (variant % 2 === 0 && Math.abs(p.x - 0.12) < 0.05 && Math.abs(p.y + 0.1) < 0.04) c = new Color(0.55, 0.3, 0.2);
      return c.withAlpha(1);
    }
  }
}

/**
 * SkyfireArt.Make: fn gets p in [-1,1] on both axes (y scaled by height, unlike CasualArt), one unit wide.
 * CasualArt.make passes y in [-h/w, h/w], so it is rescaled here.
 */
function make(key: string, w: number, h: number, fn: (p: V2) => Color): Sprite {
  const k = w / h;
  return CasualArt.make(key, w, h, (p) => fn(k === 1 ? p : new V2(p.x, p.y * k)));
}

export const SkyfireArt = {
  /** Full-colour plane sprite. */
  Plane: (style: PlaneStyle, body: Color, wing: Color, accent: Color) => planeSprite(style, body, wing, accent, false),
  /** White silhouette of the same plane (hit flash / shadow). */
  Silhouette: (style: PlaneStyle) => planeSprite(style, Color.white, Color.white, Color.white, true),

  /** Spinning propeller disc (blurred blades), tint-free. */
  get Prop() {
    return make("sf-prop", 64, 64, (p) => {
      const r = p.magnitude;
      if (r > 0.95) return Color.clear;
      const ang = Math.atan2(p.y, p.x);
      const blades = 0.5 + 0.5 * Math.cos(ang * 3);
      const a = (0.18 + 0.28 * blades * blades) * Mathf.clamp01((0.95 - r) * 12);
      const hub = Mathf.clamp01((0.18 - r) * 30);
      return Color.lerp(new Color(0.85, 0.85, 0.85, a), new Color(0.25, 0.25, 0.28, 1), hub);
    });
  },

  get PlayerBullet() {
    return make("sf2-pbullet", 48, 96, (p) => {
      // Tracer round: soft warm halo, dark outline, orange body, white-hot core
      const q = new V2(p.x * 1.25, p.y);
      const d = capsule(q, 0.5, 0.42);
      const halo = Mathf.clamp01(1 - (d + 0.0) / 0.42);
      if (d > 0) {
        const ha = halo * halo * 0.45;
        return ha <= 0.003 ? Color.clear : new Color(1, 0.75, 0.25, ha);
      }
      const k = Mathf.clamp01(-d / 0.42);
      let c: Color;
      if (k < 0.18) c = new Color(0.32, 0.10, 0.02);
      else c = Color.lerp(new Color(1, 0.48, 0.08), new Color(1, 1, 0.86), Mathf.smoothStep(0, 1, (k - 0.18) / 0.82));
      return c.withAlpha(1);
    });
  },

  get EnemyBullet() { return make("sf2-ebullet", 64, 64, (p) => orb(p, new Color(1, 0.16, 0.46), new Color(1, 0.78, 0.9))); },
  get EnemyBulletBig() { return make("sf2-ebullet2", 64, 64, (p) => orb(p, new Color(1, 0.46, 0.06), new Color(1, 0.95, 0.7))); },

  /** Soft fireball for explosions (tint toward orange/white as it burns out). */
  get Fireball() {
    return make("sf-fire", 96, 96, (p) => {
      const r = p.magnitude;
      const n = Mathf.perlinNoise(p.x * 3 + 7, p.y * 3 + 3) * 0.35;
      const edge = 0.78 + n * 0.4 - 0.15;
      const a = Mathf.clamp01((edge - r) * 8);
      if (a <= 0) return Color.clear;
      const k = Mathf.clamp01(r / edge);
      const c = k < 0.4 ? Color.lerp(Color.white, new Color(1, 0.85, 0.35), k / 0.4)
        : Color.lerp(new Color(1, 0.85, 0.35), new Color(0.95, 0.35, 0.08), (k - 0.4) / 0.6);
      return c.withAlpha(a);
    });
  },

  get Smoke() {
    return make("sf-smoke", 64, 64, (p) => {
      const r = p.magnitude;
      const n = Mathf.perlinNoise(p.x * 4 + 1, p.y * 4 + 9) * 0.3;
      const a = Mathf.clamp01((0.8 + n - 0.15 - r) * 5);
      if (a <= 0) return Color.clear;
      const g = 0.32 + 0.25 * (1 - r);
      return new Color(g, g, g * 1.04, a * 0.85);
    });
  },

  PickupSprite: (kind: Pickup) => make("sf-pick-" + Pickup[kind], 96, 96, (p) => pickupPixel(kind, p)),

  get Heart() {
    return make("sf-heart", 64, 64, (p) => {
      const q = new V2(Math.abs(p.x), -p.y + 0.14);
      const lobe = q.sub(new V2(0.34, -0.22)).magnitude - 0.48;
      const tip = (q.x * 0.88 + q.y * 0.72) - 0.56;
      const roundBottom = p.sub(new V2(0, -0.22)).magnitude - 0.72;
      const d = Math.min(lobe, Math.max(tip, roundBottom));
      const a = Mathf.clamp01(-d * 32 + 0.5);
      if (a <= 0) return Color.clear;
      const c = d > -0.09 ? new Color(0.45, 0.03, 0.08) : new Color(1, 0.26, 0.36).mul(0.85 + 0.25 * p.y);
      return c.withAlpha(a);
    });
  },

  /** Seamless base terrain tile for a theme (RGBA). */
  Ground: (theme: Theme) => make("sf-ground-" + Theme[theme], 256, 256, (p) => groundPixel(theme, p)),

  /** Island / dune rocks / ice floe that scrolls over the base tile (RGBA). */
  Decor: (theme: Theme, variant: number) => make(`sf-decor-${Theme[theme]}-${variant}`, 256, 256, (p) => decorPixel(theme, variant, p)),

  /** Soft white cloud puff cluster (RGBA, semi-transparent). */
  Cloud: (variant: number) => make("sf-cloud-" + variant, 192, 128, (p) => {
    let a = 0;
    for (let i = 0; i < 5; i++) {
      const cx = -0.6 + i * 0.3 + 0.08 * Math.sin(variant * 3.1 + i);
      const cy = 0.05 * Math.sin(variant + i * 2.3);
      const rr = 0.28 + 0.12 * Math.sin(variant * 1.7 + i * 1.3);
      const d = new V2((p.x - cx) * 1.0, (p.y - cy) * 1.5).magnitude;
      a = Math.max(a, Mathf.clamp01(((rr - d) / rr) * 1.6));
    }
    if (a <= 0) return Color.clear;
    const shade = 0.92 + 0.08 * p.y;
    return new Color(shade, shade, Math.min(1, shade + 0.03), Mathf.clamp01(a) * 0.85);
  }),

  get Soft() {
    return make("sf-soft", 64, 64, (p) => {
      const a = Mathf.clamp01(1 - p.magnitude);
      return new Color(1, 1, 1, a * a);
    });
  },

  // ------------------------------------------------------------------ helpers

  /** Art.Spr with the flat material; the sprite may be null and set later (like Unity). */
  Spr(parent: GameObject | null, name: string, sprite: Sprite | null, color: Color, size: number, order: number): SpriteRenderer {
    const sr = Art.spr(parent, name, sprite!, color, size, order, Art.Flat);
    sr.sprite = sprite;
    return sr;
  },
};
