import { CasualArt, Color, Mathf, Pal, Render, Sprite, V2 } from "../../kit";
import { H, W } from "./MazeSim";

/** Procedural art for Maze Muncher: hero, chasers, dots, fruit and the canvas-drawn neon maze. */

const sm = CasualArt.smooth, fill = CasualArt.fill;
const hex = (c: Color) => {
  const h = (v: number) => Math.round(Mathf.clamp01(v) * 255).toString(16).padStart(2, "0");
  return h(c.r) + h(c.g) + h(c.b);
};
const css = (c: Color, a = 1) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

// ------------------------------------------------------------------ canvas sprites (kit gap: no public canvas → Sprite)

const canvases = new Map<string, Sprite>();
/** A Sprite from a canvas drawn with the 2D API (re-registered with the current renderer on every use). */
export function canvasSprite(key: string, w: number, h: number, ppu: number, draw: (ctx: CanvasRenderingContext2D) => void): Sprite {
  let s = canvases.get(key);
  if (!s) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!);
    s = new Sprite(key, w, h, ppu, [0, 0, 0, 0], c);
    canvases.set(key, s);
  }
  if (s.canvas) Render.addCanvasTexture(key, s.canvas);
  return s;
}

// ------------------------------------------------------------------ hero

export const MouthFrames = 4;

/** The muncher: a round critter with a big eye and a chomping mouth (open toward +x). */
export function HeroSprite(body: Color, frame: number) {
  const open = [0.08, 0.32, 0.56, 0.78][frame];
  return CasualArt.make(`mm-hero-${hex(body)}-${frame}`, 128, 128, (p) => {
    const px = 2 / 128, R = 0.9;
    const r = p.magnitude;
    const a = fill(r - R, px);
    if (a <= 0) return Color.clear;
    let c = CasualArt.ballPixel(p, body, px, R);
    // mouth: a dark wedge with a tongue and two teeth
    const ang = Math.abs(Math.atan2(p.y + 0.06, p.x));
    const inWedge = fill((ang - open) * Math.max(0.15, r) * 1.0, px) * sm(0.06, 0.16, r);
    if (inWedge > 0) {
      let m = Pal.hex(0x3a0b22);
      m = Color.lerp(m, Pal.hex(0x6a1736), sm(0.8, 0.2, r) * 0.6);
      const tongue = fill(CasualArt.sdCircle(p, new V2(0.62, -0.28), 0.27), px);
      m = Color.lerp(m, Pal.hex(0xff6f91), tongue * 0.95);
      const tooth = Math.max(
        fill(CasualArt.sdCircle(p, new V2(0.62, Math.tan(open) * 0.62 - 0.06 - 0.02), 0.075), px),
        fill(CasualArt.sdCircle(p, new V2(0.42, Math.tan(open) * 0.42 - 0.06 - 0.02), 0.06), px),
      ) * (open > 0.2 ? 1 : 0);
      m = Color.lerp(m, Color.white, tooth);
      c = Color.lerp(c, m, inWedge);
      // lip highlight along the wedge edge
      const lip = 1 - Math.min(1, Math.abs(ang - open) * r / 0.05);
      c = Color.lerp(c, CasualArt.darken(body, 0.45), Math.max(0, lip) * sm(0.15, 0.3, r) * 0.7);
    }
    // eye
    const eyeC = new V2(0.08, 0.46);
    const eye = fill(new V2((p.x - eyeC.x) / 0.26, (p.y - eyeC.y) / 0.3).magnitude - 1, px * 4);
    if (eye > 0) {
      let e = Color.lerp(Pal.hex(0xdfe6ff), Color.white, sm(-0.2, 0.3, p.y - eyeC.y));
      const pup = fill(CasualArt.sdCircle(p, eyeC.add(new V2(0.1, -0.02)), 0.14), px);
      e = Color.lerp(e, Pal.hex(0x1b1530), pup);
      const glint = fill(CasualArt.sdCircle(p, eyeC.add(new V2(0.14, 0.05)), 0.05), px);
      e = Color.lerp(e, Color.white, glint);
      c = Color.lerp(c, e, eye);
    }
    // cheek blush
    const blush = sm(0.16, 0, CasualArt.sdCircle(p, new V2(-0.32, 0.12), 0.0)) * 0.35;
    c = Color.lerp(c, Pal.hex(0xff7aa8), blush);
    return c.withAlpha(a);
  });
}

// ------------------------------------------------------------------ chasers

/** Jelly blob with two little horns and wavy feet: white, shaded, tinted per chaser. */
export function ChaserBody() {
  return CasualArt.make("mm-chaser", 128, 128, (p) => {
    const px = 2 / 128;
    const dome = CasualArt.sdCircle(p, new V2(0, 0.08), 0.8);
    const box = CasualArt.sdBox(p.sub(new V2(0, -0.28)), new V2(0.8, 0.36), 0.02);
    let d = Math.min(dome, box);
    for (const fx of [-0.54, 0, 0.54]) d = Math.min(d, CasualArt.sdCircle(p, new V2(fx, -0.62), 0.27));
    // notches between the feet
    for (const nx of [-0.27, 0.27]) d = Math.max(d, -CasualArt.sdCircle(p, new V2(nx, -0.9), 0.17));
    // horns
    for (const s of [-1, 1]) d = Math.min(d, CasualArt.sdSegment(p, new V2(0.42 * s, 0.68), new V2(0.62 * s, 0.94)) - 0.08);
    const a = fill(d, px);
    if (a <= 0) return Color.clear;
    let v = Mathf.lerp(0.68, 1.0, sm(-0.9, 0.7, p.y));
    v *= Mathf.lerp(1, 0.78, sm(-0.25, 0, d)); // darker rim
    const hl = new V2((p.x + 0.35) / 0.28, (p.y - 0.42) / 0.16).magnitude - 1;
    v = Mathf.lerp(v, 1.35, fill(hl * 0.2, px * 2) * 0.55);
    v = Math.min(1, v);
    return new Color(v, v, v, a);
  });
}

export function EyeWhite() {
  return CasualArt.make("mm-eye", 64, 64, (p) => {
    const px = 2 / 64, d = p.magnitude - 0.92;
    const v = Mathf.lerp(0.82, 1, sm(-0.8, 0.5, p.y));
    const ring = fill(Math.abs(d + 0.06) - 0.06, px) * 0.25;
    const c = new Color(v - ring, v - ring, v - ring * 0.5, 1);
    return c.withAlpha(fill(d, px));
  });
}

export function Pupil() {
  return CasualArt.make("mm-pupil", 64, 64, (p) => {
    const px = 2 / 64;
    let c = Color.lerp(Pal.hex(0x2a1e5c), Pal.hex(0x120c24), sm(0.2, 0.9, p.magnitude));
    c = Color.lerp(c, Color.white, fill(CasualArt.sdCircle(p, new V2(0.28, 0.3), 0.22), px));
    return c.withAlpha(fill(p.magnitude - 0.92, px));
  });
}

/** Frightened face: two dot eyes and a zigzag mouth. */
export function ScaredFace() {
  return CasualArt.make("mm-scared", 96, 96, (p) => {
    const px = 2 / 96;
    let a = 0;
    for (const s of [-1, 1]) a = Math.max(a, fill(CasualArt.sdCircle(p, new V2(0.32 * s, 0.25), 0.15), px));
    let zig = 1e3;
    const pts = [-0.6, -0.36, -0.12, 0.12, 0.36, 0.6];
    for (let i = 0; i < pts.length - 1; i++) {
      const y0 = i % 2 === 0 ? -0.32 : -0.16, y1 = i % 2 === 0 ? -0.16 : -0.32;
      zig = Math.min(zig, CasualArt.sdSegment(p, new V2(pts[i], y0), new V2(pts[i + 1], y1)));
    }
    a = Math.max(a, fill(zig - 0.06, px));
    return new Color(1, 1, 1, a);
  });
}

// ------------------------------------------------------------------ pickups

export function DotSprite() {
  return CasualArt.make("mm-dot", 32, 32, (p) => {
    const r = p.magnitude;
    const core = fill(r - 0.36, 2 / 32);
    const glow = Math.pow(Mathf.clamp01(1 - r), 2) * 0.45;
    const v = Mathf.lerp(1, 0.8, sm(0, 0.36, r));
    return new Color(v, v, v, Math.max(core, glow));
  });
}

export function PelletSprite() {
  return CasualArt.make("mm-pellet", 64, 64, (p) => {
    const r = p.magnitude, px = 2 / 64;
    const core = fill(r - 0.52, px);
    const glow = Math.pow(Mathf.clamp01(1 - r), 1.6) * 0.6;
    let c = CasualArt.ballPixel(p.mul(1 / 0.56), Color.white, px / 0.56, 0.94);
    if (core <= 0) c = Color.white;
    return new Color(c.r, c.g, c.b, Math.max(core, glow));
  });
}

const Fr = (key: string, fn: (p: V2, px: number) => Color) => CasualArt.make("mm-fruit-" + key, 96, 96, (p) => fn(p, 2 / 96));

const leaf = (p: V2, c: V2, ang: number, len: number, px: number) => {
  const q = p.sub(c), ca = Math.cos(-ang), sa = Math.sin(-ang);
  const lx = q.x * ca - q.y * sa, ly = q.x * sa + q.y * ca;
  const d = new V2((lx - len * 0.5) / (len * 0.5), ly / (len * 0.22)).magnitude - 1;
  return fill(d * len * 0.3, px);
};

/** Bonus items: cherries, berry, lemon, apple, melon, gem, cake, crown. */
export function FruitSprite(kind: number) {
  switch (kind) {
    case 0: return Fr("cherry", (p, px) => {
      let c = Color.clear;
      const stem = Math.min(CasualArt.sdSegment(p, new V2(-0.35, -0.2), new V2(0.25, 0.75)), CasualArt.sdSegment(p, new V2(0.38, -0.3), new V2(0.25, 0.75))) - 0.045;
      c = CasualArt.over(c, Pal.hex(0x4f8a2b), fill(stem, px));
      c = CasualArt.over(c, Pal.hex(0x5fbf3a), leaf(p, new V2(0.25, 0.72), 0.3, 0.45, px));
      for (const [x, y] of [[-0.36, -0.36], [0.36, -0.46]]) {
        const q = p.sub(new V2(x, y)).mul(1 / 0.36);
        c = CasualArt.over(c, CasualArt.ballPixel(q, Pal.hex(0xe8233f), px / 0.36), 1);
      }
      return c;
    });
    case 1: return Fr("berry", (p, px) => {
      const q = new V2(p.x, p.y + 0.08);
      const d = Math.max(new V2(q.x / 0.72, (q.y - 0.05) / 0.7).magnitude - 1, -(q.y + 0.85 - Math.abs(q.x) * 0.9));
      let c = Color.clear;
      if (d < 0.05) {
        c = CasualArt.ballPixel(new V2(q.x / 0.8, q.y / 0.85), Pal.hex(0xf0304a), px).withAlpha(fill(d * 0.7, px));
        const sx = Mathf.repeat(q.x * 4.5 + (Math.floor(q.y * 4.5) % 2) * 0.5, 1) - 0.5, sy = Mathf.repeat(q.y * 4.5, 1) - 0.5;
        c = Color.lerp(c, Pal.hex(0xffe27a), fill(new V2(sx, sy * 1.6).magnitude - 0.13, 0.08) * c.a * (q.y < 0.45 ? 1 : 0));
      }
      for (const a of [-0.9, -0.3, 0.3, 0.9]) c = CasualArt.over(c, Pal.hex(0x3fae49), leaf(p, new V2(0, 0.58), Math.PI / 2 + a, 0.42, px));
      return c;
    });
    case 2: return Fr("lemon", (p, px) => {
      const d = new V2(p.x / 0.82, p.y / 0.62).magnitude - 1;
      const tips = Math.min(CasualArt.sdCircle(p, new V2(-0.84, 0.05), 0.1), CasualArt.sdCircle(p, new V2(0.84, -0.05), 0.1));
      let c = CasualArt.ballPixel(new V2(p.x / 0.86, p.y / 0.66), Pal.hex(0xffd23f), px).withAlpha(fill(Math.min(d * 0.6, tips), px));
      c = CasualArt.over(c, Pal.hex(0x5fbf3a), leaf(p, new V2(0.05, 0.55), 0.6, 0.4, px));
      return c;
    });
    case 3: return Fr("apple", (p, px) => {
      const d = Math.min(CasualArt.sdCircle(p, new V2(-0.24, -0.06), 0.6), CasualArt.sdCircle(p, new V2(0.24, -0.06), 0.6));
      const dent = CasualArt.sdCircle(p, new V2(0, 0.62), 0.16);
      let c = CasualArt.ballPixel(new V2(p.x / 0.86, (p.y + 0.06) / 0.72), Pal.hex(0x3fcf4f), px).withAlpha(fill(Math.max(d, -dent), px));
      c = CasualArt.over(c, Pal.hex(0x6b4423), fill(CasualArt.sdSegment(p, new V2(0, 0.45), new V2(0.08, 0.86)) - 0.05, px));
      c = CasualArt.over(c, Pal.hex(0x2f9e3a), leaf(p, new V2(0.08, 0.72), 0.5, 0.4, px));
      return c;
    });
    case 4: return Fr("melon", (p, px) => {
      const q = p.sub(new V2(0, 0.35));
      const r = q.magnitude, inHalf = q.y < 0 ? 1 : 0;
      const d = r - 0.88;
      let c = Color.clear;
      if (inHalf) {
        const a = fill(d, px);
        c = Pal.hex(0x2f9e3a);
        c = Color.lerp(c, Pal.hex(0xd8f5b0), fill(r - 0.78, px));
        c = Color.lerp(c, Pal.hex(0xff4d6d), fill(r - 0.7, px));
        const seeds = [[-0.35, -0.3], [0, -0.42], [0.35, -0.3], [-0.18, -0.14], [0.18, -0.14]];
        for (const [sx, sy] of seeds) c = Color.lerp(c, Pal.hex(0x2a1a14), fill(new V2((q.x - sx) / 0.05, (q.y - sy) / 0.08).magnitude - 1, 0.6));
        c = c.withAlpha(a);
      }
      return c;
    });
    case 5: return Fr("gem", (p, px) => {
      const pts = [new V2(0, -0.86), new V2(0.82, 0.18), new V2(0.5, 0.62), new V2(-0.5, 0.62), new V2(-0.82, 0.18)];
      let inside = false, md = 1e3;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        md = Math.min(md, CasualArt.sdSegment(p, a, b));
      }
      const d = inside ? -md : md;
      let c = Pal.hex(0x4fd8ff);
      if (p.y > 0.18) c = Pal.hex(0xa8f0ff);
      else if (p.x < 0) c = Pal.hex(0x2fa8e8);
      if (p.y <= 0.18 && Math.abs(p.x) < 0.42 - (0.18 - p.y) * 0.4) c = Pal.hex(0x6fe2ff);
      c = Color.lerp(c, Color.white, fill(Math.abs(md) - 0.02, px) * 0.4);
      return c.withAlpha(fill(d, px));
    });
    case 6: return Fr("cake", (p, px) => {
      let c = Color.clear;
      const base = CasualArt.sdBox(p.sub(new V2(0, -0.38)), new V2(0.72, 0.36), 0.08);
      c = CasualArt.over(c, Pal.hex(0xf5c38a), fill(base, px));
      c = CasualArt.over(c, Pal.hex(0xc77b4a), fill(Math.abs(p.y + 0.38) - 0.05, px) * fill(base, px));
      const icing = CasualArt.sdBox(p.sub(new V2(0, 0.02)), new V2(0.78, 0.14), 0.12);
      const drip = Math.min(icing, CasualArt.sdCircle(p, new V2(-0.4, -0.15), 0.1), CasualArt.sdCircle(p, new V2(0.25, -0.2), 0.12));
      c = CasualArt.over(c, Pal.hex(0xff8fc0), fill(drip, px));
      c = CasualArt.over(c, Pal.hex(0xe8233f), fill(CasualArt.sdCircle(p, new V2(0, 0.38), 0.2), px));
      c = CasualArt.over(c, Color.white, fill(CasualArt.sdCircle(p, new V2(-0.06, 0.44), 0.05), px) * 0.8);
      return c;
    });
    default: return Fr("crown", (p, px) => {
      const band = CasualArt.sdBox(p.sub(new V2(0, -0.48)), new V2(0.78, 0.2), 0.06);
      let top = 1e3;
      for (const x of [-0.62, 0, 0.62]) top = Math.min(top, CasualArt.sdSegment(p, new V2(x * 1.15, -0.3), new V2(x, 0.5)) - 0.18);
      const body = Math.min(band, top, CasualArt.sdBox(p.sub(new V2(0, -0.15)), new V2(0.74, 0.25), 0.04));
      let c = CasualArt.ballPixel(new V2(p.x / 0.95, p.y / 0.95), Pal.hex(0xffc93c), px).withAlpha(fill(body, px));
      for (const x of [-0.62, 0, 0.62]) c = CasualArt.over(c, CasualArt.ballPixel(p.sub(new V2(x, 0.56)).mul(1 / 0.16), Pal.hex(0xff4d6d), px / 0.16), 1);
      c = CasualArt.over(c, Pal.hex(0x4fd8ff), fill(CasualArt.sdCircle(p, new V2(0, -0.48), 0.11), px));
      return c;
    });
  }
}

// ------------------------------------------------------------------ maze

export interface MazeTheme { wall: Color; glow: Color; floorTop: Color; floorBottom: Color; dot: Color }
export const Themes: MazeTheme[] = [
  { wall: Pal.hex(0x4d7cff), glow: Pal.hex(0x7aa2ff), floorTop: Pal.hex(0x101a44), floorBottom: Pal.hex(0x070b22), dot: Pal.hex(0xffd9a8) },
  { wall: Pal.hex(0xff4fa3), glow: Pal.hex(0xff8cc6), floorTop: Pal.hex(0x2a0f36), floorBottom: Pal.hex(0x12061a), dot: Pal.hex(0xfff0a8) },
  { wall: Pal.hex(0x1fd6c1), glow: Pal.hex(0x7af5e6), floorTop: Pal.hex(0x082a30), floorBottom: Pal.hex(0x03141a), dot: Pal.hex(0xffe9b8) },
  { wall: Pal.hex(0xff9a3c), glow: Pal.hex(0xffc27a), floorTop: Pal.hex(0x2e1608), floorBottom: Pal.hex(0x160902), dot: Pal.hex(0xd8f0ff) },
];

const CellPx = 40;

/** The maze floor and neon tube walls as one texture (one world unit per cell). */
export function MazeSprite(rows: string[], themeIdx: number, flash = false) {
  const th = Themes[themeIdx % Themes.length];
  const key = `mm-maze-${rows.join("").length}-${hashRows(rows)}-${themeIdx}${flash ? "-f" : ""}`;
  const pad = 1;
  const w = (W + pad * 2) * CellPx, h = (H + pad * 2) * CellPx;
  return canvasSprite(key, w, h, CellPx, (ctx) => {
    const ox = pad * CellPx, oy = pad * CellPx, c = CellPx;
    const isWall = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && rows[y][x] === "#";
    // floor
    const g = ctx.createLinearGradient(0, oy, 0, oy + H * c);
    g.addColorStop(0, css(th.floorTop));
    g.addColorStop(1, css(th.floorBottom));
    ctx.fillStyle = g;
    roundRect(ctx, ox - 6, oy - 6, W * c + 12, H * c + 12, 26);
    ctx.fill();
    // faint floor grid dots
    ctx.fillStyle = css(th.glow, 0.06);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!isWall(x, y)) ctx.fillRect(ox + x * c + c / 2 - 1, oy + y * c + c / 2 - 1, 2, 2);

    // wall mask
    const mask = document.createElement("canvas");
    mask.width = w; mask.height = h;
    const m = mask.getContext("2d")!;
    m.strokeStyle = m.fillStyle = "#fff";
    m.lineCap = m.lineJoin = "round";
    m.lineWidth = c * 0.56;
    m.beginPath();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!isWall(x, y)) continue;
        const cx = ox + (x + 0.5) * c, cy = oy + (y + 0.5) * c;
        let any = false;
        if (isWall(x + 1, y)) { m.moveTo(cx, cy); m.lineTo(cx + c, cy); any = true; }
        if (isWall(x, y + 1)) { m.moveTo(cx, cy); m.lineTo(cx, cy + c); any = true; }
        if (!any && !isWall(x - 1, y) && !isWall(x, y - 1)) { m.moveTo(cx, cy); m.lineTo(cx + 0.01, cy); }
      }
    m.stroke();
    for (let y = 0; y < H - 1; y++)
      for (let x = 0; x < W - 1; x++)
        if (isWall(x, y) && isWall(x + 1, y) && isWall(x, y + 1) && isWall(x + 1, y + 1)) m.fillRect(ox + (x + 0.5) * c, oy + (y + 0.5) * c, c, c);

    const tint = (col: string) => {
      const t = document.createElement("canvas");
      t.width = w; t.height = h;
      const tc = t.getContext("2d")!;
      tc.drawImage(mask, 0, 0);
      tc.globalCompositeOperation = "source-in";
      tc.fillStyle = col;
      tc.fillRect(0, 0, w, h);
      return t;
    };
    const wallCol = flash ? Color.white : th.wall;
    // glow
    ctx.save();
    ctx.shadowColor = css(flash ? Color.white : th.glow, 0.9);
    ctx.shadowBlur = 16;
    const neon = tint(css(wallCol));
    ctx.drawImage(neon, 0, 0);
    ctx.restore();
    // neon rim (dilated) then dark tube body
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.drawImage(neon, Math.cos(a) * 3, Math.sin(a) * 3);
    }
    ctx.drawImage(tint(css(CasualArt.darken(wallCol, flash ? 0.1 : 0.62))), 0, 0);
    // thin highlight along the top edges for a tube look
    const sheen = tint(css(CasualArt.lighten(wallCol, 0.3)));
    const inner = document.createElement("canvas");
    inner.width = w; inner.height = h;
    const ic = inner.getContext("2d")!;
    ic.drawImage(sheen, 0, 0);
    ic.globalCompositeOperation = "destination-out";
    ic.drawImage(mask, 0, 3);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(inner, 0, 0);
    ctx.globalAlpha = 1;

    // ghost door
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (rows[y][x] === "-") {
          ctx.save();
          ctx.shadowColor = "#ff9ad0";
          ctx.shadowBlur = 10;
          ctx.fillStyle = "#ffb6dc";
          roundRect(ctx, ox + x * c - c * 0.25, oy + (y + 0.5) * c - 4, c * 1.5, 8, 4);
          ctx.fill();
          ctx.restore();
        }
  });
}

function hashRows(rows: string[]) {
  let h = 2166136261;
  for (const r of rows) for (let i = 0; i < r.length; i++) h = Math.imul(h ^ r.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Full-screen backdrop: deep arcade night with soft neon haze. */
export function BackSprite() {
  return CasualArt.make("mm-back", 64, 256, (p) => {
    const t = (p.y + 4) / 8;
    let c = Color.lerp(Pal.hex(0x07081c), Pal.hex(0x1a1450), sm(0, 1, t));
    const g1 = Math.exp(-((p.x + 0.6) ** 2 * 1.5 + (p.y - 2.2) ** 2 * 0.5));
    const g2 = Math.exp(-((p.x - 0.7) ** 2 * 1.5 + (p.y + 1.8) ** 2 * 0.5));
    c = Color.lerp(c, Pal.hex(0x5a2a9e), g1 * 0.45);
    c = Color.lerp(c, Pal.hex(0x1f5aa8), g2 * 0.4);
    return c.withAlpha(1);
  });
}
