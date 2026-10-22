import { Color, Pal, Sprite } from "../../kit";
import { ChaserBody, DotSprite, EyeWhite, FruitSprite, HeroSprite, MazeSprite, PelletSprite, Pupil } from "./MazeArt";
import { mazeRows } from "./MazeSim";

/** Dev-only: paints the store icon (256²) and feature graphic (1024×500) from the game's own sprites. */

const HeroGreen = Pal.hex(0x8fe23c);
const Chasers = [Pal.hex(0xff3b5c), Pal.hex(0xb46bff), Pal.hex(0x2fe0c8), Pal.hex(0xffb02e)];

function img(s: Sprite) { return s.canvas!; }

function tinted(s: Sprite, c: Color) {
  const src = img(s), t = document.createElement("canvas");
  t.width = src.width; t.height = src.height;
  const x = t.getContext("2d")!;
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = "multiply";
  x.fillStyle = `rgb(${c.r * 255},${c.g * 255},${c.b * 255})`;
  x.fillRect(0, 0, t.width, t.height);
  x.globalCompositeOperation = "destination-in";
  x.drawImage(src, 0, 0);
  return t;
}

function chaser(ctx: CanvasRenderingContext2D, k: number, x: number, y: number, size: number, look: number) {
  ctx.drawImage(tinted(ChaserBody(), Chasers[k]), x - size / 2, y - size / 2, size, size);
  const e = size * 0.45;
  ctx.drawImage(img(EyeWhite()), x - e / 2, y - size * 0.12 - e / 2, e, e);
  const p = size * 0.22;
  ctx.drawImage(img(Pupil()), x - p / 2 + look * size * 0.09, y - size * 0.12 - p / 2, p, p);
}

function glowDisc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

export function renderMazePromo(kind: "icon" | "feature") {
  const W = kind === "icon" ? 256 : 1024, H = kind === "icon" ? 256 : 500;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1d1458");
  bg.addColorStop(1, "#07081c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const maze = img(MazeSprite(mazeRows(0), 0));
  const dot = tinted(DotSprite(), Pal.hex(0xffd9a8));
  if (kind === "icon") {
    // a slice of the neon maze, zoomed
    ctx.globalAlpha = 0.85;
    ctx.drawImage(maze, 40 * 1, 40 * 12, 40 * 9, 40 * 9, -20, -20, 296, 296);
    ctx.globalAlpha = 1;
    glowDisc(ctx, 128, 140, 140, "rgba(143,226,60,0.25)");
    for (let i = 0; i < 4; i++) ctx.drawImage(dot, 150 + i * 28, 150, 22, 22);
    ctx.drawImage(tinted(PelletSprite(), Pal.hex(0xc0d4ff)), 225, 138, 44, 44);
    chaser(ctx, 0, 52, 78, 78, 1);
    ctx.drawImage(img(HeroSprite(HeroGreen, 2)), 50, 92, 132, 132);
  } else {
    glowDisc(ctx, 760, 260, 420, "rgba(90,42,158,0.45)");
    ctx.save();
    ctx.globalAlpha = 0.95;
    const s = 22;
    ctx.drawImage(maze, 0, 0, maze.width, maze.height, 560, -60, 21 * s * 1.05, 23 * s * 1.05);
    ctx.restore();
    // a dark fade so the title reads
    const fade = ctx.createLinearGradient(380, 0, 640, 0);
    fade.addColorStop(0, "rgba(10,8,34,1)");
    fade.addColorStop(1, "rgba(10,8,34,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 640, H);
    ctx.fillStyle = "rgba(10,8,34,1)";
    ctx.fillRect(0, 0, 380, H);
    // big characters
    glowDisc(ctx, 700, 300, 170, "rgba(143,226,60,0.3)");
    for (let i = 0; i < 5; i++) ctx.drawImage(dot, 770 + i * 44, 292, 30, 30);
    ctx.drawImage(tinted(PelletSprite(), Pal.hex(0xc0d4ff)), 990, 280, 54, 54);
    ctx.drawImage(img(HeroSprite(HeroGreen, 2)), 600, 200, 200, 200);
    chaser(ctx, 0, 520, 160, 120, 1);
    chaser(ctx, 1, 900, 120, 100, -1);
    chaser(ctx, 2, 930, 430, 96, -1);
    ctx.drawImage(img(FruitSprite(0)), 840, 380, 80, 80);
    // title
    ctx.save();
    ctx.font = '900 84px "Arial Rounded MT Bold", Arial, sans-serif';
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(143,226,60,0.8)";
    ctx.shadowBlur = 22;
    ctx.fillStyle = "#f4ffe8";
    ctx.fillText("MAZE", 60, 180);
    ctx.fillText("MUNCHER", 60, 268);
    ctx.shadowBlur = 0;
    ctx.font = '700 26px "Arial Rounded MT Bold", Arial, sans-serif';
    ctx.fillStyle = "rgba(220,225,255,0.75)";
    ctx.fillText("EAT THE DOTS. DODGE THE GHOSTS.", 62, 336);
    ctx.fillStyle = "#9be84a";
    ctx.fillRect(62, 370, 180, 6);
    ctx.restore();
  }
  return c.toDataURL("image/png");
}
