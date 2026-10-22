import { CasualArt, Color, Mathf, Pal, Render, Sprite, V2 } from "../../kit";
import {
  ArcCenter, ArcR, Bumpers, BumperR, DropTargets, FlipperLen, LaneGuides, OrbitWallX, PlungerY, RampCenter, Spinner, Table,
  TableBottom, TableLeft, TableRight, TableTop, TopLanes,
} from "./PinballSim";

/** Procedural art for Nebula Pinball: canvas-painted playfield, ramp plastic, side art and baked sprites. */

const sm = CasualArt.smooth, fill = CasualArt.fill;

export const Neon = {
  cyan: Pal.hex(0x3ee8ff), pink: Pal.hex(0xff4fb8), violet: Pal.hex(0x9b6bff), gold: Pal.hex(0xffc93c),
  lime: Pal.hex(0x9be84a), orange: Pal.hex(0xff8a3c), red: Pal.hex(0xff3b5c), amber: Pal.hex(0xffa53c),
};
const css = (c: Color, a = 1) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

const canvases = new Map<string, Sprite>();
/** A Sprite painted with the canvas 2D API (kit gap: CasualArt only rasterizes per-pixel functions). */
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

// playfield texture frame (world units)
export const PF = { x0: TableLeft - 0.35, x1: TableRight + 0.35, y0: TableBottom - 0.2, y1: TableTop + 0.4, ppu: 72 };
export const PFCenter = new V2((PF.x0 + PF.x1) / 2, (PF.y0 + PF.y1) / 2);

/** Deterministic hash noise. */
const hn = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

function tableOutline(ctx: CanvasRenderingContext2D, X: (x: number) => number, Y: (y: number) => number) {
  ctx.beginPath();
  ctx.moveTo(X(TableLeft), Y(TableBottom));
  ctx.lineTo(X(TableLeft), Y(ArcCenter[1]));
  for (let i = 0; i <= 48; i++) {
    const a = Math.PI - (Math.PI * i) / 48;
    ctx.lineTo(X(ArcCenter[0] + Math.cos(a) * ArcR), Y(ArcCenter[1] + Math.sin(a) * ArcR));
  }
  ctx.lineTo(X(TableRight), Y(TableBottom));
  ctx.closePath();
}

function neonPath(ctx: CanvasRenderingContext2D, pts: [number, number][], X: (x: number) => number, Y: (y: number) => number) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
}

function stroke3(ctx: CanvasRenderingContext2D, path: () => void, col: Color, width: number) {
  ctx.save();
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.shadowColor = css(col, 0.9);
  ctx.shadowBlur = 14;
  ctx.strokeStyle = css(col);
  ctx.lineWidth = width;
  path(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = css(CasualArt.darken(col, 0.55));
  ctx.lineWidth = width * 0.55;
  path(); ctx.stroke();
  ctx.strokeStyle = css(CasualArt.lighten(col, 0.6), 0.8);
  ctx.lineWidth = Math.max(1.5, width * 0.14);
  path(); ctx.stroke();
  ctx.restore();
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, col: string, rot = 0, glow = "") {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `900 ${size}px "Arial Rounded MT Bold", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = size * 0.4; }
  ctx.fillStyle = col;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

/** Insert (light) positions shared by the art and the game. */
export const Inserts = {
  lanes: TopLanes.map((x) => new V2(x, 7.0)),
  mult: [-1.35, -0.45, 0.45, 1.35].map((x) => new V2(x, -5.2)),
  shootAgain: new V2(0, -7.2),
  ramp: new V2(2.45, -1.75),
  orbit: new V2(-4.15, -0.2),
  drops: new V2(0, 0.0),
  bumpers: new V2(0, 2.0),
  lanesArrow: new V2(0, 6.2),
  spinner: new V2(-4.15, 0.75),
  missions: [-2.1, -1.26, -0.42, 0.42, 1.26, 2.1].map((x) => new V2(x, -3.75)),
};
export const MissionInsert = ["bumpers", "drops", "ramp", "lanesArrow", "spinner", "orbit"] as const;

export function PlayfieldSprite(t: Table) {
  const { x0, x1, y0, y1, ppu } = PF;
  const w = Math.round((x1 - x0) * ppu), h = Math.round((y1 - y0) * ppu);
  return canvasSprite("pb-playfield", w, h, ppu, (ctx) => {
    const X = (x: number) => (x - x0) * ppu, Y = (y: number) => (y1 - y) * ppu, S = (v: number) => v * ppu;
    // cabinet rim
    ctx.save();
    tableOutline(ctx, X, Y);
    ctx.lineWidth = S(0.5);
    ctx.strokeStyle = "#1a1036";
    ctx.stroke();
    ctx.clip();
    // space
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1b0f4a");
    g.addColorStop(0.5, "#0d0b33");
    g.addColorStop(1, "#06061a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const neb = (cx: number, cy: number, r: number, col: string) => {
      const rg = ctx.createRadialGradient(X(cx), Y(cy), 0, X(cx), Y(cy), S(r));
      rg.addColorStop(0, col);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    };
    neb(-2.5, 6, 5, "rgba(255,79,184,0.28)");
    neb(3, 1, 5, "rgba(62,232,255,0.18)");
    neb(-1, -4, 6, "rgba(155,107,255,0.25)");
    neb(2.5, -8, 4, "rgba(255,138,60,0.12)");
    for (let i = 0; i < 260; i++) {
      const sx = hn(i) * w, sy = hn(i + 999) * h, r = hn(i + 77) < 0.9 ? 1.2 : 2.4;
      ctx.fillStyle = `rgba(255,255,255,${0.25 + hn(i + 5) * 0.6})`;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    }
    // ringed planet behind the drop targets
    ctx.save();
    const px = X(0.2), py = Y(-1.6), pr = S(2.0);
    const pg = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
    pg.addColorStop(0, "rgba(255,170,120,0.55)");
    pg.addColorStop(0.7, "rgba(200,70,160,0.35)");
    pg.addColorStop(1, "rgba(60,20,90,0.2)");
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,210,150,0.35)";
    ctx.lineWidth = S(0.12);
    ctx.beginPath(); ctx.ellipse(px, py, pr * 1.7, pr * 0.42, -0.25, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    text(ctx, "NEBULA", X(0), Y(-2.55), S(1.05), "rgba(255,255,255,0.13)");

    // shooter lane
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(X(4.6), Y(4.3), S(0.8), S(4.3 - TableBottom));
    for (let i = 0; i < 4; i++) {
      const yy = -6 + i * 1.6;
      ctx.fillStyle = css(Neon.orange, 0.35);
      ctx.beginPath(); ctx.moveTo(X(5.0), Y(yy + 0.5)); ctx.lineTo(X(5.25), Y(yy)); ctx.lineTo(X(4.75), Y(yy)); ctx.closePath(); ctx.fill();
    }
    // drain apron
    const dg = ctx.createLinearGradient(0, Y(-8), 0, Y(TableBottom));
    dg.addColorStop(0, "rgba(0,0,0,0)");
    dg.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = dg;
    ctx.fillRect(0, Y(-8), w, h);

    // inserts (unlit)
    const insert = (p: V2, r: number, col: Color, label = "") => {
      ctx.fillStyle = css(CasualArt.darken(col, 0.6), 0.85);
      ctx.strokeStyle = css(col, 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), S(r), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (label) text(ctx, label, X(p.x), Y(p.y), S(r * 1.05), css(CasualArt.lighten(col, 0.3), 0.75));
    };
    const arrow = (p: V2, ang: number, col: Color, len = 0.75) => {
      ctx.save();
      ctx.translate(X(p.x), Y(p.y));
      ctx.rotate(-ang);
      ctx.fillStyle = css(CasualArt.darken(col, 0.6), 0.85);
      ctx.strokeStyle = css(col, 0.6);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(S(len * 0.6), 0); ctx.lineTo(S(-len * 0.4), S(len * 0.32)); ctx.lineTo(S(-len * 0.2), 0); ctx.lineTo(S(-len * 0.4), S(-len * 0.32));
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    ["O", "R", "B"].forEach((l, i) => insert(Inserts.lanes[i], 0.3, Neon.cyan, l));
    ["2X", "3X", "4X", "5X"].forEach((l, i) => insert(Inserts.mult[i], 0.34, Neon.gold, l));
    Inserts.missions.forEach((p) => insert(p, 0.18, Neon.pink));
    insert(Inserts.shootAgain, 0.42, Neon.red);
    text(ctx, "SHOOT", X(0), Y(-6.62), S(0.24), "rgba(255,120,140,0.6)");
    text(ctx, "AGAIN", X(0), Y(-7.78), S(0.24), "rgba(255,120,140,0.6)");
    arrow(Inserts.ramp, Math.atan2(RampCenter[2][1] - RampCenter[0][1], RampCenter[2][0] - RampCenter[0][0]), Neon.lime, 0.9);
    arrow(Inserts.orbit, Math.PI / 2, Neon.violet, 0.8);
    arrow(Inserts.drops, Math.PI / 2, Neon.orange, 0.8);
    arrow(Inserts.bumpers, Math.PI / 2, Neon.pink, 0.8);
    arrow(Inserts.lanesArrow, Math.PI / 2, Neon.cyan, 0.7);
    arrow(Inserts.spinner, Math.PI / 2, Neon.violet, 0.55);
    text(ctx, "RAMP", X(2.3), Y(-2.55), S(0.26), "rgba(155,232,74,0.65)", 1.1);
    text(ctx, "ORBIT", X(-4.15), Y(-0.95), S(0.22), "rgba(155,107,255,0.7)");
    ctx.restore();

    // walls
    for (const pts of t.walls) stroke3(ctx, () => neonPath(ctx, pts, X, Y), Neon.cyan, S(0.16));
    // slingshots: glowing plastic with a white rubber kicker
    t.slings.forEach((tri) => {
      ctx.save();
      ctx.beginPath();
      tri.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
      ctx.closePath();
      ctx.fillStyle = css(Neon.pink, 0.35);
      ctx.shadowColor = css(Neon.pink);
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.restore();
      stroke3(ctx, () => { ctx.beginPath(); ctx.moveTo(X(tri[0][0]), Y(tri[0][1])); ctx.lineTo(X(tri[1][0]), Y(tri[1][1])); ctx.lineTo(X(tri[2][0]), Y(tri[2][1])); }, Neon.pink, S(0.18));
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = "#f4f4ff";
      ctx.lineWidth = S(0.17);
      ctx.beginPath(); ctx.moveTo(X(tri[0][0]), Y(tri[0][1])); ctx.lineTo(X(tri[2][0]), Y(tri[2][1])); ctx.stroke();
      ctx.restore();
    });
    // posts
    for (const x of LaneGuides) for (const y of [7.45, 8.45]) post(ctx, X(x), Y(y), S(0.13));
    for (const x of [-1.42, 1.42]) post(ctx, X(x), Y(0.95), S(0.13));
    post(ctx, X(OrbitWallX), Y(-0.7), S(0.12));
    // bumper bases (caps are sprites)
    for (const [bx, by] of Bumpers) {
      ctx.save();
      ctx.shadowColor = css(Neon.pink);
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#2a0f3a";
      ctx.beginPath(); ctx.arc(X(bx), Y(by), S(BumperR + 0.08), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // drop target slots
    for (const [dx, dy] of DropTargets) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(X(dx - 0.38), Y(dy + 0.12), S(0.76), S(0.24));
    }
    // spinner bracket
    ctx.strokeStyle = "rgba(220,220,255,0.6)";
    ctx.lineWidth = S(0.05);
    ctx.beginPath(); ctx.moveTo(X(Spinner.x0), Y(Spinner.y)); ctx.lineTo(X(Spinner.x1), Y(Spinner.y)); ctx.stroke();
    // flipper pivot plates
    for (const s of [-1, 1]) post(ctx, X(1.95 * s), Y(-8.2), S(0.1));
    // plunger housing
    ctx.fillStyle = "#14102e";
    ctx.fillRect(X(4.62), Y(PlungerY - 0.75), S(0.76), S(TableBottom - (PlungerY - 0.75)) * -1);
  });
}

function post(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.shadowColor = "rgba(62,232,255,0.9)";
  ctx.shadowBlur = 8;
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#7fa8d8");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Translucent ramp plastic drawn over the playfield (balls on the ramp are drawn above it). */
export function RampSprite(t: Table) {
  const { x0, x1, y0, y1, ppu } = PF;
  const w = Math.round((x1 - x0) * ppu), h = Math.round((y1 - y0) * ppu);
  return canvasSprite("pb-ramp", w, h, ppu, (ctx) => {
    const X = (x: number) => (x - x0) * ppu, Y = (y: number) => (y1 - y) * ppu;
    ctx.beginPath();
    t.rampL.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
    for (let i = t.rampR.length - 1; i >= 0; i--) ctx.lineTo(X(t.rampR[i][0]), Y(t.rampR[i][1]));
    ctx.closePath();
    ctx.fillStyle = "rgba(120,255,170,0.16)";
    ctx.fill();
    for (const side of [t.rampL, t.rampR]) stroke3(ctx, () => neonPath(ctx, side, X, Y), Neon.lime, 0.12 * ppu);
    // chevrons along the ramp
    for (let i = 4; i < RampCenter.length - 4; i += 5) {
      const a = RampCenter[i], b = RampCenter[i + 1];
      const ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      ctx.save();
      ctx.translate(X(a[0]), Y(a[1]));
      ctx.rotate(ang);
      ctx.strokeStyle = "rgba(200,255,150,0.55)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(4, 0); ctx.lineTo(-8, 10); ctx.stroke();
      ctx.restore();
    }
  });
}

/** Landscape side panel art (a = left / right variant). */
export function SideSprite(right: boolean) {
  const w = 512, h = 1024;
  return canvasSprite("pb-side" + (right ? "R" : "L"), w, h, 1024 / 21.4, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#211058");
    g.addColorStop(1, "#070718");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + hn(i + (right ? 300 : 0)) * 0.6})`;
      ctx.beginPath(); ctx.arc(hn(i * 3 + 1 + (right ? 50 : 0)) * w, hn(i * 7 + 2) * h, hn(i + 9) < 0.9 ? 1.3 : 2.6, 0, Math.PI * 2); ctx.fill();
    }
    const px = right ? w * 0.42 : w * 0.58, py = right ? h * 0.3 : h * 0.62, pr = w * (right ? 0.3 : 0.36);
    const pg = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
    pg.addColorStop(0, right ? "#7af5ff" : "#ffb38a");
    pg.addColorStop(0.6, right ? "#2a7ad8" : "#d8457a");
    pg.addColorStop(1, right ? "#10204a" : "#3a1050");
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = right ? "rgba(122,245,255,0.6)" : "rgba(255,210,150,0.6)";
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(px, py, pr * 1.6, pr * 0.38, right ? 0.3 : -0.3, 0, Math.PI * 2); ctx.stroke();
    // little rocket with a flame
    ctx.save();
    ctx.translate(right ? w * 0.62 : w * 0.36, right ? h * 0.74 : h * 0.22);
    ctx.rotate(right ? -0.5 : 0.5);
    const fl = ctx.createLinearGradient(0, 40, 0, 140);
    fl.addColorStop(0, "rgba(255,200,80,0.95)");
    fl.addColorStop(1, "rgba(255,60,90,0)");
    ctx.fillStyle = fl;
    ctx.beginPath(); ctx.moveTo(-18, 40); ctx.quadraticCurveTo(0, 150, 18, 40); ctx.fill();
    ctx.fillStyle = "#eef2ff";
    ctx.beginPath(); ctx.moveTo(0, -70); ctx.quadraticCurveTo(30, -30, 24, 40); ctx.lineTo(-24, 40); ctx.quadraticCurveTo(-30, -30, 0, -70); ctx.fill();
    ctx.fillStyle = "#ff4fb8";
    ctx.beginPath(); ctx.moveTo(-24, 10); ctx.lineTo(-44, 50); ctx.lineTo(-22, 40); ctx.fill();
    ctx.beginPath(); ctx.moveTo(24, 10); ctx.lineTo(44, 50); ctx.lineTo(22, 40); ctx.fill();
    ctx.fillStyle = "#3ee8ff";
    ctx.beginPath(); ctx.arc(0, -18, 11, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // neon frame edge toward the table
    ctx.fillStyle = "rgba(62,232,255,0.8)";
    ctx.fillRect(right ? 0 : w - 6, 0, 6, h);
  });
}

// ------------------------------------------------------------------ baked sprites

export function BallSprite() {
  return CasualArt.make("pb-ball", 96, 96, (p) => {
    const px = 2 / 96, r = p.magnitude;
    const a = fill(r - 0.94, px);
    if (a <= 0) return Color.clear;
    const z = Math.sqrt(Math.max(0, 1 - Math.min(1, r * r)));
    // chrome: sky above, dark ground band, bright rim
    let v = Mathf.lerp(0.35, 0.95, sm(-0.3, 0.6, p.y + z * 0.2));
    v = Mathf.lerp(v, 0.25, Math.exp(-((p.y + 0.15) ** 2) * 40) * 0.7);
    v = Mathf.lerp(v, 1, sm(0.75, 0.95, r) * 0.35);
    let c = new Color(v * 0.92, v * 0.95, v, 1);
    c = Color.lerp(c, Pal.hex(0xff9ad0), sm(0.2, 0.9, -p.y) * sm(0.5, 0.9, r) * 0.35);
    const spec = sm(0.3, 0, new V2(p.x + 0.35, p.y - 0.4).magnitude);
    c = Color.lerp(c, Color.white, spec);
    return c.withAlpha(a);
  });
}

/** Flipper: tapered capsule from the pivot (left end) to the tip, glossy with a coloured rubber edge. */
export const FlipperSpriteW = 0.24 + FlipperLen + 0.13;
export function FlipperSprite() {
  return CasualArt.make("pb-flipper", 256, 64, (p) => {
    const W = FlipperSpriteW, wx = ((p.x + 1) / 2) * W - 0.24, wy = p.y * (W / 2);
    const px = (2 / 256) * (W / 2);
    const t = Mathf.clamp01(wx / FlipperLen), r = 0.24 + (0.12 - 0.24) * t;
    const d = Math.hypot(wx - t * FlipperLen, wy) - r;
    const a = fill(d, px);
    if (a <= 0) return Color.clear;
    let c = Color.lerp(Pal.hex(0xf4f6ff), Pal.hex(0xb8c2e8), sm(0.05, -0.2, wy));
    c = Color.lerp(c, Neon.pink, sm(-0.07, -0.02, d));
    c = Color.lerp(c, Color.white, sm(0.08, 0.02, Math.abs(wy - r * 0.45)) * 0.5 * sm(-0.04, -0.1, d));
    const hub = fill(Math.hypot(wx, wy) - 0.09, px);
    c = Color.lerp(c, Pal.hex(0x6a6f90), hub);
    return c.withAlpha(a);
  });
}

export function BumperCap() {
  return CasualArt.make("pb-bumper", 128, 128, (p) => {
    const px = 2 / 128, r = p.magnitude;
    const a = fill(r - 0.94, px);
    if (a <= 0) return Color.clear;
    let c = Color.lerp(Pal.hex(0xffffff), Pal.hex(0xd8d8f0), sm(0.3, 0.9, r));
    c = Color.lerp(c, Pal.hex(0x2a1650), fill(Math.abs(r - 0.82) - 0.06, px));
    const star = CasualArt.sdStar(p.mul(1.0), 0.55, 0.45);
    c = Color.lerp(c, Pal.hex(0xff4fb8), fill(star, px));
    c = Color.lerp(c, Color.white, sm(0.25, 0, new V2(p.x + 0.3, p.y - 0.35).magnitude) * 0.6);
    return c.withAlpha(a);
  });
}

export function DropTargetSprite() {
  return CasualArt.make("pb-drop", 96, 32, (p) => {
    const px = 2 / 96;
    const d = CasualArt.sdBox(p, new V2(0.94, 0.26), 0.1);
    const a = fill(d, px);
    let c = Color.lerp(Color.white, Pal.hex(0xc8c8e0), sm(0, -0.3, p.y));
    c = Color.lerp(c, Color.white, sm(-0.05, -0.02, d) * 0.4);
    return c.withAlpha(a);
  });
}

export function SpinnerSprite() {
  return CasualArt.make("pb-spinner", 96, 32, (p) => {
    const px = 2 / 96;
    const d = CasualArt.sdBox(p, new V2(0.95, 0.2), 0.05);
    let c = Color.lerp(Pal.hex(0xe8ecff), Pal.hex(0x9aa4d0), sm(0.2, -0.2, p.y));
    c = Color.lerp(c, Neon.violet, fill(Math.abs(p.x) - 0.5, px) * 0);
    const stripe = fill(Math.abs(p.y) - 0.05, px);
    c = Color.lerp(c, Neon.violet, stripe);
    return c.withAlpha(fill(d, px));
  });
}

export function PlungerSprite() {
  return CasualArt.make("pb-plunger", 32, 128, (p) => {
    const px = 2 / 32;
    const head = CasualArt.sdBox(p.sub(new V2(0, 3.3)), new V2(0.9, 0.35), 0.15);
    const rod = CasualArt.sdBox(p, new V2(0.28, 3.6), 0.1);
    let c = Pal.hex(0xc8cce0);
    let a = fill(rod, px);
    // spring coils
    const coil = Math.abs(Mathf.repeat(p.y * 2.2, 1) - 0.5) < 0.18 && Math.abs(p.x) < 0.75 && p.y < 2.8 ? 1 : 0;
    a = Math.max(a, coil);
    if (coil) c = Pal.hex(0x9aa0b8);
    const hd = fill(head, px);
    c = Color.lerp(c, Neon.red, hd);
    a = Math.max(a, hd);
    return c.withAlpha(a);
  });
}

/** Additive round light for inserts and flashes. */
export function LightSprite() {
  return CasualArt.make("pb-light", 64, 64, (p) => {
    const r = p.magnitude;
    const core = fill(r - 0.42, 2 / 64);
    const glow = Math.pow(Mathf.clamp01(1 - r), 2);
    return new Color(1, 1, 1, Math.max(core * 0.9, glow * 0.8));
  });
}

export function ArrowLight() {
  return CasualArt.make("pb-arrow", 64, 64, (p) => {
    const d = Math.max(Math.abs(p.y) * 1.25 - (0.55 - p.x * 0.5) + 0, p.x - 0.6, -p.x - 0.45);
    const core = fill(d, 2 / 64);
    return new Color(1, 1, 1, core);
  });
}

export function BackSprite() {
  return CasualArt.make("pb-back", 64, 256, (p) => {
    const t = (p.y + 4) / 8;
    let c = Color.lerp(Pal.hex(0x05051a), Pal.hex(0x1d0e52), sm(0, 1, t));
    c = Color.lerp(c, Pal.hex(0x4a1a7a), Math.exp(-(p.x * p.x * 2 + (p.y - 2) ** 2 * 0.4)) * 0.4);
    return c.withAlpha(1);
  });
}
