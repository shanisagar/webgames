import { Sprite } from "../../kit";
import { BallSprite, BumperCap, FlipperSprite, PF, PlayfieldSprite, RampSprite } from "./PinballArt";
import { buildTable } from "./PinballSim";

/** Dev-only: paints the store icon (256²) and feature graphic (1024×500) from the game's own art. */

const img = (s: Sprite) => s.canvas!;

function glowDisc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function flipper(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, ang: number, flip: boolean) {
  const f = img(FlipperSprite());
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  if (flip) ctx.scale(1, -1);
  const w = len, h = len / 4;
  ctx.drawImage(f, -w * (0.24 / 2.07), -h / 2, w, h);
  ctx.restore();
}

export function renderPinPromo(kind: "icon" | "feature") {
  const W = kind === "icon" ? 256 : 1024, H = kind === "icon" ? 256 : 500;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const t = buildTable();
  const pf = img(PlayfieldSprite(t)), ramp = img(RampSprite(t));
  const ppu = PF.ppu;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1d0e52");
  bg.addColorStop(1, "#05051a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // source rect helper in table units
  const src = (x0: number, y1: number, w: number, h: number) => [(x0 - PF.x0) * ppu, (PF.y1 - y1) * ppu, w * ppu, h * ppu] as const;
  if (kind === "icon") {
    const x0 = -2.35, y1 = -4.3, size = 4.7;
    const [sx, sy, sw, sh] = src(x0, y1, size, size);
    ctx.drawImage(pf, sx, sy, sw, sh, 0, 0, 256, 256);
    const k = 256 / size, X = (x: number) => (x - x0) * k, Y = (y: number) => (y1 - y) * k;
    glowDisc(ctx, X(0.35), Y(-6.0), 130, "rgba(62,232,255,0.45)");
    glowDisc(ctx, X(0), Y(-7.2), 40, "rgba(255,80,110,0.9)");
    for (const x of [-1.35, -0.45]) glowDisc(ctx, X(x), Y(-5.2), 34, "rgba(255,201,60,0.85)");
    // flippers at their pivots, the right one raised
    flipper(ctx, X(-1.95), Y(-8.2), 2.07 * k, 0.52, false);
    flipper(ctx, X(1.95), Y(-8.2), 2.07 * k, Math.PI + 0.47, true);
    ctx.drawImage(img(BallSprite()), X(0.35) - 0.5 * k, Y(-6.0) - 0.5 * k, 1.0 * k, 1.0 * k);
  } else {
    glowDisc(ctx, 760, 250, 420, "rgba(155,107,255,0.35)");
    const [sx, sy, sw, sh] = src(-4.95, 9.8, 10.7, 10.4);
    const k = 500 / 10.4, dw = 10.7 * k;
    ctx.save();
    ctx.translate(1024 - dw + 40, 0);
    ctx.drawImage(pf, sx, sy, sw, sh, 0, 0, dw, 500);
    ctx.drawImage(ramp, sx, sy, sw, sh, 0, 0, dw, 500);
    const X = (x: number) => (x + 4.95) * k, Y = (y: number) => (9.8 - y) * k;
    for (const [bx, by] of [[-1.3, 4.75], [1.3, 4.75], [0, 3.15]]) {
      glowDisc(ctx, X(bx), Y(by), 70, "rgba(255,79,184,0.5)");
      ctx.drawImage(img(BumperCap()), X(bx) - 0.62 * k, Y(by) - 0.62 * k, 1.24 * k, 1.24 * k);
    }
    ctx.fillStyle = "#ff8a3c";
    for (const x of [-0.95, 0, 0.95]) ctx.fillRect(X(x - 0.36), Y(0.95) - 0.1 * k, 0.72 * k, 0.2 * k);
    glowDisc(ctx, X(-0.4), Y(2.0), 60, "rgba(62,232,255,0.6)");
    ctx.drawImage(img(BallSprite()), X(-0.4) - 0.3 * k, Y(2.0) - 0.3 * k, 0.6 * k, 0.6 * k);
    ctx.drawImage(img(BallSprite()), X(2.3) - 0.3 * k, Y(6.2) - 0.3 * k, 0.6 * k, 0.6 * k);
    ctx.restore();
    const fade = ctx.createLinearGradient(420, 0, 620, 0);
    fade.addColorStop(0, "rgba(14,8,44,1)");
    fade.addColorStop(1, "rgba(14,8,44,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 620, H);
    ctx.fillStyle = "rgba(14,8,44,1)";
    ctx.fillRect(0, 0, 420, H);
    ctx.save();
    ctx.font = '900 80px "Arial Rounded MT Bold", Arial, sans-serif';
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(62,232,255,0.85)";
    ctx.shadowBlur = 22;
    ctx.fillStyle = "#eefcff";
    ctx.fillText("NEBULA", 60, 180);
    ctx.fillText("PINBALL", 60, 266);
    ctx.shadowBlur = 0;
    ctx.font = '700 21px "Arial Rounded MT Bold", Arial, sans-serif';
    ctx.fillStyle = "rgba(220,225,255,0.75)";
    ctx.fillText("TAP LEFT AND RIGHT TO WORK THE FLIPPERS.", 62, 332);
    ctx.fillStyle = "#ff4fb8";
    ctx.fillRect(62, 366, 180, 6);
    ctx.restore();
  }
  return c.toDataURL("image/png");
}
