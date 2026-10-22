import { CasualArt, Color, Mathf, Pal, Render, Sprite, V2 } from "../../kit";

/**
 * Procedural art for Mahjong Calm. Tile faces are drawn with Canvas 2D paths (crisp strokes, circles and gradients)
 * and registered as kit Sprites at a resolution matched to the tile's size on screen, so faces stay sharp from a
 * small phone to a large desktop without mipmaps. Backgrounds use CasualArt like the other casual games.
 */

/** Tile face height / width, and the visible depth of a tile (also the shift between layers), in tile widths. */
export const TH = 1.3;
export const Depth = 0.12;

const Ivory0 = "#fffdf7", Ivory1 = "#f1e7d2";
const RedC = "#c9302c", GreenC = "#1d8b4f", BlueC = "#1f5ca8", InkC = "#1b2440", GoldC = "#e0a321";

type Ctx = CanvasRenderingContext2D;
interface Box { x: number; y: number; w: number; h: number }

// ------------------------------------------------------------------ canvas sprites (kit gap: CasualArt only rasterizes per pixel)

const cache = new Map<string, Sprite>();

function canvasSprite(key: string, w: number, h: number, ppu: number, draw: (ctx: Ctx) => void): Sprite {
  let s = cache.get(key);
  if (!s) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const ctx = c.getContext("2d")!;
    draw(ctx);
    s = new Sprite("mj:" + key, c.width, c.height, ppu, [0, 0, 0, 0], c, 1);
    cache.set(key, s);
  }
  // textures die with the Phaser instance (the game was reopened): register again, idempotent
  if (Render.scene && s.canvas) Render.addCanvasTexture(s.key, s.canvas);
  return s;
}

/** Frees the GPU textures of a tile resolution that is no longer used. */
function dropSize(size: number) {
  const suffix = "@" + size;
  for (const [k, s] of [...cache]) {
    if (!k.endsWith(suffix)) continue;
    cache.delete(k);
    const tm = Render.scene?.textures;
    if (tm && tm.exists(s.key)) tm.remove(s.key);
  }
}

// ------------------------------------------------------------------ geometry

export interface TileGeom { W: number; H: number; fw: number; fh: number; ml: number; mt: number; side: number; offset: V2 }

/** Canvas layout of a tile drawn `size` px wide: face at (ml, mt), depth to the lower right, then a soft shadow. */
export function Geom(size: number): TileGeom {
  const fw = size, fh = Math.round(size * TH), side = Math.max(2, Math.round(size * Depth));
  const sh = Math.max(2, Math.round(size * 0.1)), ml = Math.max(2, Math.round(size * 0.06)), mt = ml;
  const W = ml + fw + side + sh, H = mt + fh + side + sh;
  // face centre relative to the canvas centre, in tile widths (y up)
  const offset = new V2((ml + fw / 2 - W / 2) / size, -(mt + fh / 2 - H / 2) / size);
  return { W, H, fw, fh, ml, mt, side, offset };
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// ------------------------------------------------------------------ tile body

function drawBody(ctx: Ctx, g: TileGeom, size: number) {
  const r = size * 0.12, { ml, mt, fw, fh, side } = g;
  // soft shadow under the whole block
  ctx.save();
  ctx.shadowColor = "rgba(0, 18, 14, 0.55)";
  ctx.shadowBlur = size * 0.09;
  ctx.shadowOffsetX = size * 0.035;
  ctx.shadowOffsetY = size * 0.045;
  roundRect(ctx, ml + side, mt + side, fw, fh, r);
  ctx.fillStyle = "#14503f";
  ctx.fill();
  ctx.restore();
  // depth: jade back layer, then a bone layer just under the face
  const steps = Math.max(2, Math.ceil(side * 2));
  for (let i = steps; i >= 1; i--) {
    const k = (i / steps) * side, t = i / steps;
    const col = t > 0.48 ? mix("#2f9b78", "#17614b", (t - 0.48) / 0.52) : mix("#e9dcc0", "#cbb994", t / 0.48);
    roundRect(ctx, ml + k, mt + k, fw, fh, r);
    ctx.fillStyle = col;
    ctx.fill();
  }
  // seam between the bone and jade layers
  ctx.strokeStyle = "rgba(20, 70, 55, 0.35)";
  ctx.lineWidth = Math.max(1, size * 0.01);
  roundRect(ctx, ml + side * 0.5, mt + side * 0.5, fw, fh, r);
  ctx.stroke();
  // face
  const gr = ctx.createLinearGradient(ml, mt, ml + fw * 0.6, mt + fh);
  gr.addColorStop(0, Ivory0);
  gr.addColorStop(1, Ivory1);
  roundRect(ctx, ml, mt, fw, fh, r);
  ctx.fillStyle = gr;
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.016);
  ctx.strokeStyle = "rgba(140, 118, 80, 0.55)";
  ctx.stroke();
  // inner bevel: light top-left, warm shade bottom-right
  const inset = size * 0.035;
  ctx.lineWidth = Math.max(1, size * 0.022);
  roundRect(ctx, ml + inset, mt + inset, fw - inset * 2, fh - inset * 2, r * 0.75);
  const bev = ctx.createLinearGradient(ml, mt, ml + fw, mt + fh);
  bev.addColorStop(0, "rgba(255,255,255,0.9)");
  bev.addColorStop(0.5, "rgba(255,255,255,0)");
  bev.addColorStop(1, "rgba(150,120,70,0.18)");
  ctx.strokeStyle = bev;
  ctx.stroke();
}

// ------------------------------------------------------------------ symbol helpers

function strokes(ctx: Ctx, b: Box, list: number[][], color: string, width: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of list) {
    ctx.beginPath();
    for (let i = 0; i < s.length; i += 2) {
      const x = b.x + s[i] * b.w, y = b.y + s[i + 1] * b.h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function circle(ctx: Ctx, x: number, y: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function dot(ctx: Ctx, x: number, y: number, r: number, color: string) {
  circle(ctx, x, y, r, mix(color, "#000000", 0.18));
  circle(ctx, x, y, r * 0.9, color);
  circle(ctx, x, y, r * 0.66, Ivory0);
  circle(ctx, x, y, r * 0.48, color);
  circle(ctx, x, y, r * 0.17, Ivory0);
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.42, y - r * 0.5, r * 0.22, r * 0.11, -0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function corner(ctx: Ctx, g: TileGeom, size: number, text: string, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.round(size * 0.21)}px "Arial Rounded MT Bold", Arial, Helvetica, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, g.ml + size * 0.09, g.mt + size * 0.07);
  ctx.restore();
}

function stick(ctx: Ctx, cx: number, cy: number, len: number, wid: number, color: string, angle = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const dark = mix(color, "#000000", 0.35), light = mix(color, "#ffffff", 0.35);
  const gr = ctx.createLinearGradient(-wid / 2, 0, wid / 2, 0);
  gr.addColorStop(0, dark);
  gr.addColorStop(0.45, light);
  gr.addColorStop(1, color);
  roundRect(ctx, -wid / 2, -len / 2, wid, len, wid * 0.45);
  ctx.fillStyle = gr;
  ctx.fill();
  // nodes: a little bulge and a light ring at both ends and the middle
  for (const ny of [-len / 2 + wid * 0.55, 0, len / 2 - wid * 0.55]) {
    roundRect(ctx, -wid * 0.62, ny - wid * 0.16, wid * 1.24, wid * 0.32, wid * 0.16);
    ctx.fillStyle = dark;
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(-wid * 0.4, ny - wid * 0.05, wid * 0.8, wid * 0.1);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ glyphs (unit box, y down)

const Numerals: number[][][] = [
  [[0.06, 0.52, 0.94, 0.48]],
  [[0.2, 0.28, 0.8, 0.28], [0.06, 0.74, 0.94, 0.74]],
  [[0.2, 0.16, 0.8, 0.16], [0.26, 0.48, 0.74, 0.48], [0.06, 0.84, 0.94, 0.84]],
  [[0.12, 0.14, 0.12, 0.9], [0.12, 0.14, 0.88, 0.14, 0.88, 0.9], [0.12, 0.86, 0.88, 0.86], [0.4, 0.16, 0.38, 0.48, 0.24, 0.66], [0.6, 0.16, 0.6, 0.56, 0.68, 0.62, 0.88, 0.62]],
  [[0.16, 0.12, 0.84, 0.12], [0.46, 0.12, 0.36, 0.88], [0.22, 0.48, 0.74, 0.48, 0.7, 0.88], [0.06, 0.88, 0.94, 0.88]],
  [[0.48, 0.02, 0.56, 0.16], [0.08, 0.32, 0.92, 0.32], [0.36, 0.5, 0.16, 0.88], [0.62, 0.5, 0.88, 0.84]],
  [[0.06, 0.5, 0.94, 0.38], [0.4, 0.06, 0.4, 0.8, 0.5, 0.9, 0.9, 0.9, 0.92, 0.72]],
  [[0.4, 0.14, 0.36, 0.5, 0.08, 0.86], [0.58, 0.1, 0.66, 0.5, 0.92, 0.84]],
  [[0.42, 0.04, 0.4, 0.5, 0.1, 0.92], [0.1, 0.34, 0.66, 0.34, 0.64, 0.82, 0.74, 0.92, 0.94, 0.9, 0.95, 0.72]],
];

const Wan: number[][] = [
  [0.06, 0.12, 0.94, 0.12], [0.32, 0.0, 0.32, 0.24], [0.68, 0.0, 0.68, 0.24],
  [0.22, 0.31, 0.22, 0.56], [0.22, 0.31, 0.78, 0.31, 0.78, 0.56], [0.22, 0.44, 0.78, 0.44], [0.22, 0.56, 0.78, 0.56],
  [0.5, 0.31, 0.5, 0.98],
  [0.1, 0.68, 0.1, 0.99], [0.1, 0.68, 0.9, 0.68, 0.9, 0.94, 0.8, 0.99],
  [0.38, 0.74, 0.26, 0.9, 0.68, 0.88], [0.62, 0.8, 0.72, 0.92],
];

const Winds: number[][][] = [
  // 東
  [[0.08, 0.18, 0.92, 0.18], [0.24, 0.3, 0.24, 0.66], [0.24, 0.3, 0.76, 0.3, 0.76, 0.66], [0.24, 0.48, 0.76, 0.48], [0.24, 0.66, 0.76, 0.66],
    [0.5, 0.02, 0.5, 0.98], [0.44, 0.7, 0.1, 0.94], [0.56, 0.7, 0.92, 0.94]],
  // 南
  [[0.1, 0.13, 0.9, 0.13], [0.5, 0.0, 0.5, 0.26], [0.14, 0.3, 0.14, 0.99], [0.14, 0.3, 0.86, 0.3, 0.86, 0.94, 0.76, 0.99],
    [0.36, 0.4, 0.42, 0.5], [0.64, 0.4, 0.58, 0.5], [0.28, 0.58, 0.72, 0.58], [0.3, 0.75, 0.7, 0.75], [0.5, 0.58, 0.5, 0.97]],
  // 西
  [[0.06, 0.1, 0.94, 0.1], [0.14, 0.32, 0.14, 0.96], [0.14, 0.32, 0.86, 0.32, 0.86, 0.96], [0.14, 0.9, 0.86, 0.9],
    [0.4, 0.1, 0.4, 0.5, 0.28, 0.68], [0.6, 0.1, 0.6, 0.62, 0.68, 0.68, 0.86, 0.68]],
  // 北
  [[0.36, 0.06, 0.36, 0.94], [0.08, 0.4, 0.36, 0.4], [0.04, 0.84, 0.36, 0.68], [0.64, 0.06, 0.64, 0.86, 0.72, 0.93, 0.95, 0.91, 0.96, 0.75], [0.93, 0.3, 0.64, 0.48]],
];

const Zhong: number[][] = [[0.16, 0.28, 0.16, 0.7], [0.16, 0.28, 0.84, 0.28, 0.84, 0.7], [0.16, 0.68, 0.84, 0.68], [0.5, 0.02, 0.5, 0.98]];
const Fa: number[][] = [
  [0.24, 0.06, 0.32, 0.2], [0.08, 0.32, 0.9, 0.32], [0.64, 0.04, 0.76, 0.18],
  [0.44, 0.08, 0.38, 0.48, 0.1, 0.94], [0.36, 0.52, 0.78, 0.52, 0.56, 0.78, 0.22, 0.96], [0.42, 0.62, 0.92, 0.94],
];

function inner(g: TileGeom, size: number, padX = 0.12, padY = 0.12): Box {
  return { x: g.ml + size * padX, y: g.mt + size * padY, w: g.fw - size * padX * 2, h: g.fh - size * padY * 2 };
}

function sub(b: Box, x: number, y: number, w: number, h: number): Box { return { x: b.x + x * b.w, y: b.y + y * b.h, w: w * b.w, h: h * b.h }; }

// ------------------------------------------------------------------ suits

function drawDots(ctx: Ctx, n: number, b: Box) {
  const P = (x: number, y: number, c: string, r = 0.15) => dot(ctx, b.x + x * b.w, b.y + y * b.h, r * b.w, c);
  switch (n) {
    case 1: {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = b.w * 0.47;
      circle(ctx, cx, cy, r, GreenC);
      circle(ctx, cx, cy, r * 0.88, Ivory0);
      ctx.save();
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8;
        circle(ctx, cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78, r * 0.075, k % 2 ? RedC : GreenC);
      }
      ctx.restore();
      circle(ctx, cx, cy, r * 0.62, BlueC);
      circle(ctx, cx, cy, r * 0.5, Ivory0);
      ctx.save();
      ctx.fillStyle = RedC;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3, r * 0.15, r * 0.07, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      circle(ctx, cx, cy, r * 0.13, BlueC);
      break;
    }
    case 2: P(0.5, 0.25, GreenC, 0.28); P(0.5, 0.75, BlueC, 0.28); break;
    case 3: P(0.21, 0.17, BlueC, 0.21); P(0.5, 0.5, RedC, 0.21); P(0.79, 0.83, GreenC, 0.21); break;
    case 4: P(0.26, 0.24, BlueC, 0.235); P(0.74, 0.24, GreenC, 0.235); P(0.26, 0.76, GreenC, 0.235); P(0.74, 0.76, BlueC, 0.235); break;
    case 5: P(0.21, 0.18, BlueC, 0.2); P(0.79, 0.18, GreenC, 0.2); P(0.5, 0.5, RedC, 0.2); P(0.21, 0.82, GreenC, 0.2); P(0.79, 0.82, BlueC, 0.2); break;
    case 6: for (const y of [0.15, 0.53, 0.85]) for (const x of [0.27, 0.73]) P(x, y, y < 0.3 ? GreenC : RedC, 0.2); break;
    case 7:
      P(0.18, 0.1, GreenC, 0.16); P(0.5, 0.22, GreenC, 0.16); P(0.82, 0.34, GreenC, 0.16);
      for (const y of [0.6, 0.87]) for (const x of [0.28, 0.72]) P(x, y, RedC, 0.17);
      break;
    case 8: for (let j = 0; j < 4; j++) for (const x of [0.28, 0.72]) P(x, 0.115 + j * 0.257, BlueC, 0.18); break;
    default: for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) P(0.17 + i * 0.33, 0.15 + j * 0.35, [BlueC, RedC, GreenC][j], 0.165); break;
  }
}

function drawBird(ctx: Ctx, b: Box) {
  const X = (v: number) => b.x + v * b.w, Y = (v: number) => b.y + v * b.h, S = b.w;
  // tail feathers
  ctx.save();
  ctx.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    const ex = 0.06 + k * 0.1, ey = 0.88 - k * 0.04;
    ctx.strokeStyle = GreenC;
    ctx.lineWidth = S * 0.07;
    ctx.beginPath();
    ctx.moveTo(X(0.36), Y(0.6));
    ctx.quadraticCurveTo(X(0.2 + k * 0.05), Y(0.7), X(ex), Y(ey));
    ctx.stroke();
    circle(ctx, X(ex), Y(ey), S * 0.07, BlueC);
    circle(ctx, X(ex), Y(ey), S * 0.03, Ivory0);
  }
  ctx.restore();
  // body and wing
  ctx.beginPath();
  ctx.ellipse(X(0.52), Y(0.56), S * 0.27, S * 0.2, -0.45, 0, Math.PI * 2);
  ctx.fillStyle = GreenC;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(X(0.5), Y(0.56), S * 0.17, S * 0.1, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = BlueC;
  ctx.fill();
  // breast
  ctx.beginPath();
  ctx.ellipse(X(0.66), Y(0.48), S * 0.11, S * 0.13, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = RedC;
  ctx.fill();
  // head, crest, beak, eye
  circle(ctx, X(0.74), Y(0.27), S * 0.13, RedC);
  strokes(ctx, b, [[0.72, 0.16, 0.66, 0.04], [0.76, 0.15, 0.78, 0.03]], GreenC, S * 0.04);
  ctx.beginPath();
  ctx.moveTo(X(0.84), Y(0.24));
  ctx.lineTo(X(0.99), Y(0.29));
  ctx.lineTo(X(0.84), Y(0.32));
  ctx.closePath();
  ctx.fillStyle = GoldC;
  ctx.fill();
  circle(ctx, X(0.76), Y(0.25), S * 0.04, Ivory0);
  circle(ctx, X(0.765), Y(0.25), S * 0.022, "#111");
  // legs and perch
  strokes(ctx, b, [[0.52, 0.74, 0.5, 0.9], [0.6, 0.72, 0.62, 0.9], [0.3, 0.92, 0.84, 0.92]], "#8a5a2b", S * 0.035);
}

function drawBamboo(ctx: Ctx, n: number, b: Box) {
  const W = b.w, H = b.h;
  const S = (x: number, y: number, len: number, c = GreenC, wid = 0.13, ang = 0) => stick(ctx, b.x + x * W, b.y + y * H, len * H, wid * W * 1.5, c, ang);
  switch (n) {
    case 1: drawBird(ctx, b); break;
    case 2: S(0.5, 0.25, 0.42, BlueC, 0.16); S(0.5, 0.75, 0.42, GreenC, 0.16); break;
    case 3: S(0.5, 0.25, 0.42, BlueC, 0.15); S(0.28, 0.75, 0.42, GreenC, 0.15); S(0.72, 0.75, 0.42, GreenC, 0.15); break;
    case 4: S(0.28, 0.25, 0.42, BlueC, 0.15); S(0.72, 0.25, 0.42, GreenC, 0.15); S(0.28, 0.75, 0.42, GreenC, 0.15); S(0.72, 0.75, 0.42, BlueC, 0.15); break;
    case 5:
      S(0.18, 0.25, 0.42, GreenC, 0.14); S(0.82, 0.25, 0.42, BlueC, 0.14); S(0.5, 0.5, 0.42, RedC, 0.14);
      S(0.18, 0.75, 0.42, BlueC, 0.14); S(0.82, 0.75, 0.42, GreenC, 0.14);
      break;
    case 6: for (const y of [0.25, 0.75]) for (const x of [0.18, 0.5, 0.82]) S(x, y, 0.42, y < 0.5 ? GreenC : BlueC, 0.14); break;
    case 7:
      S(0.5, 0.15, 0.28, RedC, 0.13);
      for (const y of [0.5, 0.84]) for (const x of [0.18, 0.5, 0.82]) S(x, y, 0.28, GreenC, 0.13);
      break;
    case 8:
      S(0.12, 0.25, 0.42, GreenC, 0.12); S(0.88, 0.25, 0.42, GreenC, 0.12);
      S(0.36, 0.25, 0.42, BlueC, 0.12, 0.42); S(0.64, 0.25, 0.42, BlueC, 0.12, -0.42);
      S(0.12, 0.75, 0.42, GreenC, 0.12); S(0.88, 0.75, 0.42, GreenC, 0.12);
      S(0.36, 0.75, 0.42, BlueC, 0.12, -0.42); S(0.64, 0.75, 0.42, BlueC, 0.12, 0.42);
      break;
    default: for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) S(0.17 + i * 0.33, 0.16 + j * 0.34, 0.28, i === 1 ? RedC : j === 1 ? BlueC : GreenC, 0.13); break;
  }
}

function drawCharacter(ctx: Ctx, n: number, g: TileGeom, size: number) {
  const b = inner(g, size, 0.13, 0.1);
  strokes(ctx, sub(b, 0.12, 0.03, 0.76, 0.36), Numerals[n - 1], InkC, size * 0.085);
  strokes(ctx, sub(b, 0.06, 0.47, 0.88, 0.53), Wan, RedC, size * 0.06);
  corner(ctx, g, size, String(n), RedC);
}

// ------------------------------------------------------------------ flowers and seasons

function petals(ctx: Ctx, cx: number, cy: number, count: number, r: number, len: number, wid: number, color: string, rot = 0) {
  ctx.save();
  ctx.fillStyle = color;
  for (let k = 0; k < count; k++) {
    const a = rot + (k * Math.PI * 2) / count;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, len, wid, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function leaf(ctx: Ctx, x: number, y: number, len: number, wid: number, angle: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -wid, len, 0);
  ctx.quadraticCurveTo(len * 0.5, wid, 0, 0);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = Math.max(1, wid * 0.18);
  ctx.beginPath();
  ctx.moveTo(len * 0.1, 0);
  ctx.lineTo(len * 0.85, 0);
  ctx.stroke();
  ctx.restore();
}

function drawFlower(ctx: Ctx, k: number, g: TileGeom, size: number) {
  const b = inner(g, size, 0.12, 0.16);
  const X = (v: number) => b.x + v * b.w, Y = (v: number) => b.y + v * b.h, S = b.w;
  // stem and leaves
  ctx.save();
  ctx.strokeStyle = "#3e7a3a";
  ctx.lineWidth = S * 0.06;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(X(0.5), Y(0.45));
  ctx.quadraticCurveTo(X(0.42), Y(0.75), X(0.5), Y(1.0));
  ctx.stroke();
  ctx.restore();
  leaf(ctx, X(0.47), Y(0.78), S * 0.34, S * 0.11, -2.6, GreenC);
  leaf(ctx, X(0.48), Y(0.88), S * 0.34, S * 0.11, -0.45, GreenC);
  const cx = X(0.5), cy = Y(0.33);
  switch (k) {
    case 0: // plum
      petals(ctx, cx, cy, 5, S * 0.17, S * 0.16, S * 0.15, "#e35d86", -Math.PI / 2);
      petals(ctx, cx, cy, 5, S * 0.17, S * 0.09, S * 0.08, "#f4a3bd", -Math.PI / 2);
      circle(ctx, cx, cy, S * 0.09, GoldC);
      break;
    case 1: // orchid
      petals(ctx, cx, cy, 3, S * 0.2, S * 0.21, S * 0.1, "#8f5bd1", -Math.PI / 2);
      petals(ctx, cx, cy, 2, S * 0.16, S * 0.17, S * 0.08, "#b88ae6", 0.35);
      circle(ctx, cx, cy + S * 0.04, S * 0.08, "#f6d55c");
      break;
    case 2: // chrysanthemum
      petals(ctx, cx, cy, 16, S * 0.2, S * 0.16, S * 0.045, "#e39b1a");
      petals(ctx, cx, cy, 12, S * 0.12, S * 0.11, S * 0.045, "#f5c242", 0.2);
      circle(ctx, cx, cy, S * 0.08, "#b8650f");
      break;
    default: // lotus
      petals(ctx, cx, cy + S * 0.05, 7, S * 0.12, S * 0.2, S * 0.08, "#d94f8f", Math.PI);
      petals(ctx, cx, cy + S * 0.05, 5, S * 0.08, S * 0.15, S * 0.06, "#f39cc4", Math.PI);
      circle(ctx, cx, cy + S * 0.06, S * 0.07, GoldC);
      break;
  }
  corner(ctx, g, size, String(k + 1), RedC);
}

function drawSeason(ctx: Ctx, k: number, g: TileGeom, size: number) {
  const b = inner(g, size, 0.12, 0.16);
  const cx = b.x + b.w / 2, cy = b.y + b.h * 0.5, S = b.w;
  switch (k) {
    case 0: { // spring: sprout with a bud
      ctx.save();
      ctx.strokeStyle = "#3e7a3a";
      ctx.lineWidth = S * 0.07;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, cy + S * 0.55);
      ctx.quadraticCurveTo(cx + S * 0.1, cy, cx - S * 0.02, cy - S * 0.36);
      ctx.stroke();
      ctx.restore();
      leaf(ctx, cx + S * 0.02, cy + S * 0.15, S * 0.42, S * 0.14, -0.5, "#43b05a");
      leaf(ctx, cx + S * 0.04, cy + S * 0.3, S * 0.42, S * 0.14, -2.7, GreenC);
      petals(ctx, cx - S * 0.02, cy - S * 0.42, 5, S * 0.08, S * 0.09, S * 0.08, "#f28fb0", -Math.PI / 2);
      circle(ctx, cx - S * 0.02, cy - S * 0.42, S * 0.05, GoldC);
      ctx.fillStyle = "#7b5a35";
      ctx.fillRect(cx - S * 0.36, cy + S * 0.55, S * 0.72, S * 0.06);
      break;
    }
    case 1: { // summer: sun
      ctx.save();
      ctx.strokeStyle = "#f08a24";
      ctx.lineCap = "round";
      ctx.lineWidth = S * 0.075;
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * S * 0.34, cy + Math.sin(a) * S * 0.34);
        ctx.lineTo(cx + Math.cos(a) * S * (i % 2 ? 0.44 : 0.5), cy + Math.sin(a) * S * (i % 2 ? 0.44 : 0.5));
        ctx.stroke();
      }
      ctx.restore();
      const gr = ctx.createRadialGradient(cx - S * 0.08, cy - S * 0.08, S * 0.02, cx, cy, S * 0.27);
      gr.addColorStop(0, "#ffe27a");
      gr.addColorStop(1, "#f29a1f");
      circle(ctx, cx, cy, S * 0.27, "#e07b18");
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.24, 0, Math.PI * 2);
      ctx.fillStyle = gr;
      ctx.fill();
      break;
    }
    case 2: { // autumn: maple leaf
      ctx.save();
      ctx.translate(cx, cy - S * 0.05);
      ctx.beginPath();
      const pts = 11;
      for (let i = 0; i <= pts * 2; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / pts;
        const lobe = [1, 0.5, 0.86, 0.45, 0.74, 0.32, 0.46, 0.2, 0.46, 0.32, 0.74, 0.45, 0.86, 0.5, 1][Math.min(14, Math.round(((i % (pts * 2)) / (pts * 2)) * 14))] ?? 1;
        const r = S * 0.62 * lobe;
        const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.95;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const gr = ctx.createLinearGradient(0, -S * 0.4, 0, S * 0.4);
      gr.addColorStop(0, "#f2662c");
      gr.addColorStop(1, "#b8261f");
      ctx.fillStyle = gr;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,230,180,0.7)";
      ctx.lineWidth = S * 0.025;
      ctx.lineCap = "round";
      for (const a of [-Math.PI / 2, -Math.PI / 2 - 1.0, -Math.PI / 2 + 1.0]) {
        ctx.beginPath();
        ctx.moveTo(0, S * 0.08);
        ctx.lineTo(Math.cos(a) * S * 0.34, Math.sin(a) * S * 0.34);
        ctx.stroke();
      }
      ctx.strokeStyle = "#7b3a1c";
      ctx.lineWidth = S * 0.04;
      ctx.beginPath();
      ctx.moveTo(0, S * 0.1);
      ctx.lineTo(S * 0.06, S * 0.62);
      ctx.stroke();
      ctx.restore();
      break;
    }
    default: { // winter: snowflake
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = "#2f7fd0";
      ctx.lineCap = "round";
      ctx.lineWidth = S * 0.07;
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI) / 3);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -S * 0.46);
        ctx.moveTo(0, -S * 0.26);
        ctx.lineTo(-S * 0.12, -S * 0.38);
        ctx.moveTo(0, -S * 0.26);
        ctx.lineTo(S * 0.12, -S * 0.38);
        ctx.stroke();
        ctx.restore();
      }
      circle(ctx, 0, 0, S * 0.09, "#8cc6f5");
      ctx.restore();
      break;
    }
  }
  corner(ctx, g, size, String(k + 1), BlueC);
}

// ------------------------------------------------------------------ faces

function drawFace(ctx: Ctx, face: number, g: TileGeom, size: number) {
  if (face < 9) drawDots(ctx, face + 1, inner(g, size, 0.1, 0.1));
  else if (face < 18) drawBamboo(ctx, face - 8, inner(g, size, 0.11, 0.1));
  else if (face < 27) drawCharacter(ctx, face - 17, g, size);
  else if (face < 31) {
    strokes(ctx, inner(g, size, 0.17, 0.24), Winds[face - 27], InkC, size * 0.085);
    corner(ctx, g, size, "ESWN"[face - 27], RedC);
  } else if (face === 31) strokes(ctx, inner(g, size, 0.16, 0.2), Zhong, RedC, size * 0.12);
  else if (face === 32) strokes(ctx, inner(g, size, 0.14, 0.2), Fa, GreenC, size * 0.095);
  else if (face === 33) {
    const b = inner(g, size, 0.13, 0.13);
    ctx.save();
    ctx.strokeStyle = BlueC;
    ctx.lineWidth = size * 0.07;
    roundRect(ctx, b.x, b.y, b.w, b.h, size * 0.06);
    ctx.stroke();
    ctx.lineWidth = size * 0.03;
    roundRect(ctx, b.x + size * 0.11, b.y + size * 0.11, b.w - size * 0.22, b.h - size * 0.22, size * 0.03);
    ctx.stroke();
    ctx.restore();
  } else if (face < 38) drawFlower(ctx, face - 34, g, size);
  else drawSeason(ctx, face - 38, g, size);
}

/** Texture sizes tiles are drawn at (px across the face); the game picks the one matching the zoom. */
const Sizes = [40, 52, 64, 80, 100, 124, 156, 196, 240];

export const MahjongArt = {
  Sizes,

  /** Smallest drawing size that is at least as big as the tile on screen. */
  SizeFor(screenPx: number) {
    for (const s of Sizes) if (s >= screenPx * 0.96) return s;
    return Sizes[Sizes.length - 1];
  },

  /** A whole tile (shadow, depth and face) drawn `size` px wide. One world unit = the face width. */
  Tile(face: number, size: number): Sprite {
    const g = Geom(size);
    return canvasSprite(`t${face}@${size}`, g.W, g.H, size, (ctx) => { drawBody(ctx, g, size); drawFace(ctx, face, g, size); });
  },

  /** White glow ring around a tile face, same canvas layout as Tile (tinted for selection, hints and hover). */
  Glow(size: number): Sprite {
    const g = Geom(size);
    return canvasSprite(`glow@${size}`, g.W, g.H, size, (ctx) => {
      const r = size * 0.12, w = Math.max(2, size * 0.05);
      ctx.save();
      ctx.shadowColor = "#ffffff";
      ctx.shadowBlur = size * 0.08;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = w;
      roundRect(ctx, g.ml + w * 0.5, g.mt + w * 0.5, g.fw - w, g.fh - w, r);
      ctx.stroke();
      ctx.restore();
      roundRect(ctx, g.ml, g.mt, g.fw, g.fh, r);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fill();
    });
  },

  /** Drops every texture of one drawing size (after the board moved to another zoom). */
  Release(size: number) { dropSize(size); },

  // ------------------------------------------------------------------ UI icons (white, tinted by buttons)

  get UndoIcon(): Sprite {
    return canvasSprite("ui-undo", 96, 96, 96, (ctx) => {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 11;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(52, 54, 26, Math.PI * 1.05, Math.PI * 0.62, false);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(10, 46);
      ctx.lineTo(28, 22);
      ctx.lineTo(40, 50);
      ctx.closePath();
      ctx.fillStyle = "#fff";
      ctx.fill();
    });
  },

  get HintIcon(): Sprite {
    return canvasSprite("ui-hint", 96, 96, 96, (ctx) => {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(48, 38, 25, Math.PI * 0.8, Math.PI * 2.2);
      ctx.lineTo(60, 68);
      ctx.lineTo(36, 68);
      ctx.closePath();
      ctx.fill();
      roundRect(ctx, 35, 72, 26, 8, 4);
      ctx.fill();
      roundRect(ctx, 39, 83, 18, 7, 3.5);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      for (const [a, b, c, d] of [[12, 30, 4, 26], [84, 30, 92, 26], [48, 2, 48, 6]]) { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
    });
  },

  get ShuffleIcon(): Sprite {
    return canvasSprite("ui-shuffle", 96, 96, 96, (ctx) => {
      ctx.strokeStyle = "#fff";
      ctx.fillStyle = "#fff";
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(8, 26);
      ctx.bezierCurveTo(40, 26, 50, 70, 74, 70);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(8, 70);
      ctx.bezierCurveTo(40, 70, 50, 26, 74, 26);
      ctx.stroke();
      for (const y of [26, 70]) {
        ctx.beginPath();
        ctx.moveTo(92, y);
        ctx.lineTo(70, y - 16);
        ctx.lineTo(70, y + 16);
        ctx.closePath();
        ctx.fill();
      }
    });
  },

  ZoomIcon(zoomIn: boolean): Sprite {
    return canvasSprite(zoomIn ? "ui-zoom-in" : "ui-zoom-out", 96, 96, 96, (ctx) => {
      ctx.strokeStyle = "#fff";
      ctx.lineCap = "round";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(40, 40, 27, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 13;
      ctx.beginPath();
      ctx.moveTo(62, 62);
      ctx.lineTo(86, 86);
      ctx.stroke();
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(28, 40);
      ctx.lineTo(52, 40);
      if (zoomIn) { ctx.moveTo(40, 28); ctx.lineTo(40, 52); }
      ctx.stroke();
    });
  },

  // ------------------------------------------------------------------ backgrounds

  /** Deep jade felt with a soft lantern glow, misty ink mountains and faint cloud scrolls. */
  get Backdrop(): Sprite {
    return CasualArt.make("mj-backdrop", 128, 256, (p) => {
      let c = Color.lerp(Pal.hex(0x0b2b26), Pal.hex(0x155247), CasualArt.smooth(-2.2, 1.8, p.y));
      const glow = Math.exp(-(p.x * p.x * 1.4 + (p.y - 1.1) * (p.y - 1.1) * 0.9));
      c = Color.lerp(c, Pal.hex(0x2f8a72), glow * 0.45);
      const fibre = Mathf.perlinNoise(p.x * 22 + 3, p.y * 22);
      c = Color.lerp(c, Pal.hex(0x0a2420), CasualArt.smooth(0.55, 0.9, fibre) * 0.18);
      for (let layer = 0; layer < 3; layer++) {
        const base = -1.05 - layer * 0.32;
        const h = base + 0.32 * Math.exp(-Math.pow((p.x + 0.45 - layer * 0.5) * 2.4, 2)) + 0.22 * Math.exp(-Math.pow((p.x - 0.55 + layer * 0.25) * 2.8, 2))
          + 0.025 * Math.sin(p.x * 11 + layer * 2);
        const a = CasualArt.fill(p.y - h, 2 / 128);
        c = Color.lerp(c, layer === 0 ? Pal.hex(0x1b5d50) : layer === 1 ? Pal.hex(0x124a3f) : Pal.hex(0x0b3329), a * 0.8);
      }
      return c.withAlpha(1);
    });
  },

  /** Soft round mote for the drifting lantern lights. */
  get Mote(): Sprite { return CasualArt.make("mj-mote", 48, 48, (p) => { const a = CasualArt.smooth(1, 0, p.magnitude); return new Color(1, 1, 1, a * a); }); },

  /** Small blossom petal for the win shower. */
  get Petal(): Sprite {
    return CasualArt.make("mj-petal", 48, 48, (p) => {
      let d = new V2(p.x / 0.55, (p.y + Math.abs(p.x) * 0.25) / 0.85).magnitude - 1;
      d = Math.max(d * 0.55, -CasualArt.sdCircle(p, new V2(0, 0.95), 0.22));
      const c = Color.lerp(Pal.hex(0xffb7cf), Pal.hex(0xffe3ec), CasualArt.smooth(-0.8, 0.8, p.y));
      return c.withAlpha(CasualArt.fill(d, 2 / 48));
    });
  },
};
