import Phaser from "phaser";
import { ArrowData, LevelData, cellCount, cellX, cellY, dirX, dirY, isActive } from "../core/level";
import { PuzzleBoard } from "../core/puzzleBoard";
import { Background } from "./background";
import type { BoardViewApi, GameController } from "./controller";
import { Sfx } from "./sfx";
import { ui } from "./store";
import { Theme, arrowColor, hexToInt, lerpColor } from "./theme";

/** Pixels per board cell in world space (the camera zoom maps this to the screen). */
const U = 64;
const CORE_WIDTH = 0.14;
const GLOW_WIDTH = 0.62;
const HEAD_LENGTH = 0.4;
const HEAD_WIDTH = 0.46;
const DOT_SIZE = 0.17;
const WHITE = 0xffffff;

interface V { x: number; y: number }

const outCubic = (t: number) => 1 - (1 - t) ** 3;
function outBack(t: number) {
  const c1 = 1.70158, c3 = c1 + 1, u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
/** Board units (y up, like Unity) → world pixels (y down). */
const px = (p: V) => ({ x: p.x * U, y: -p.y * U });

type Mode = "idle" | "intro" | "exiting" | "bouncing" | "done";

/**
 * One arrow: a neon polyline body plus a triangular head. Movement is a single scalar `travel` along a path
 * made of the body followed by the exit ray, so the body follows the head around corners like a snake.
 */
class ArrowView {
  state: Mode = "idle";
  color: number;
  readonly dir: V;
  private readonly path: V[] = [];
  private readonly bodySegments: number;
  private readonly sprites: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private travel = 0;
  private reveal = 1;
  private alpha = 1;
  private flash = 0;
  private flashColor = WHITE;
  private hinted = false;
  private introDelay = 0;
  private introTime = 0;
  private speed = 0;
  private exitSteps = 0;
  private crossedEdge = false;
  private bounceTarget = 0;
  private returning = false;
  private returnTime = 0;
  private onImpact: (() => void) | null = null;

  constructor(private board: BoardScene, readonly id: number, readonly data: ArrowData, color: number, rayLength: number) {
    this.color = color;
    this.dir = { x: dirX(data.dir), y: dirY(data.dir) };
    this.bodySegments = Math.max(0, data.cells.length - 1);
    for (const c of data.cells) this.path.push(board.cellPosition(c));
    const head = this.path[this.path.length - 1];
    const extra = rayLength + data.cells.length + 8;
    for (let k = 1; k <= extra; k++) this.path.push({ x: head.x + this.dir.x * k, y: head.y + this.dir.y * k });
    this.render();
  }

  get isBusy() { return this.state === "bouncing" || this.state === "exiting" || this.state === "done"; }
  get needsTick() { return this.state !== "idle" || this.hinted || this.flash > 0; }
  get headPosition() { return this.sample(this.travel + this.bodySegments * this.reveal); }

  playIntro(delay: number) {
    this.state = "intro";
    this.introDelay = delay;
    this.introTime = 0;
    this.reveal = 0;
    this.render();
  }

  launch(stepsToEdge: number) {
    this.finishIntro();
    this.state = "exiting";
    this.exitSteps = stepsToEdge;
    this.speed = 7;
    this.crossedEdge = false;
    this.hinted = false;
    this.flash = 0.8;
    this.flashColor = WHITE;
  }

  bounce(freeSteps: number, impact: () => void) {
    this.finishIntro();
    this.state = "bouncing";
    // Stop with the tip touching the blocking line in the next cell.
    this.bounceTarget = Math.max(0.12, freeSteps + 1 - HEAD_LENGTH - CORE_WIDTH * 0.5 - 0.02);
    this.speed = 12;
    this.returning = false;
    this.returnTime = 0;
    this.onImpact = impact;
  }

  doFlash(color: number, amount = 1) {
    this.flashColor = color;
    this.flash = Math.max(this.flash, amount);
  }

  setHint(on: boolean) {
    this.hinted = on;
    if (!on) this.render();
  }

  destroy() {
    this.state = "done";
    for (const sp of this.sprites) sp.destroy();
    this.sprites.length = 0;
  }

  private finishIntro() {
    if (this.state === "intro") { this.reveal = 1; this.state = "idle"; }
  }

  tick(dt: number) {
    switch (this.state) {
      case "intro": {
        this.introTime += dt;
        const k = clamp01((this.introTime - this.introDelay) / 0.38);
        this.reveal = outCubic(k);
        if (k >= 1) this.state = "idle";
        break;
      }
      case "exiting": {
        this.speed = Math.min(this.speed + 90 * dt, 42);
        this.travel += this.speed * dt;
        if (!this.crossedEdge && this.travel >= this.exitSteps + 0.5) {
          this.crossedEdge = true;
          this.board.onArrowCrossedEdge(this);
        }
        const tailOut = this.travel - (this.exitSteps + this.bodySegments + 0.5);
        this.alpha = 1 - clamp01(tailOut / 4);
        if (tailOut > 4) { this.destroy(); return; }
        break;
      }
      case "bouncing":
        if (!this.returning) {
          this.speed = Math.min(this.speed + 60 * dt, 30);
          this.travel += this.speed * dt;
          if (this.travel >= this.bounceTarget) {
            this.travel = this.bounceTarget;
            this.returning = true;
            this.doFlash(hexToInt(this.board.theme.danger), 1.4);
            this.onImpact?.();
          }
        } else {
          this.returnTime += dt;
          const r = clamp01(this.returnTime / 0.34);
          this.travel = this.bounceTarget * (1 - outBack(r));
          if (r >= 1) { this.travel = 0; this.state = "idle"; }
        }
        break;
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.2);
    this.render();
  }

  private sample(t: number): V {
    const p = this.path;
    if (t <= 0) return p[0];
    const i = Math.floor(t);
    if (i >= p.length - 1) { const last = p[p.length - 1], k = t - (p.length - 1); return { x: last.x + this.dir.x * k, y: last.y + this.dir.y * k }; }
    const f = t - i;
    return { x: p[i].x + (p[i + 1].x - p[i].x) * f, y: p[i].y + (p[i + 1].y - p[i].y) * f };
  }

  render() {
    if (this.state === "done") return;
    const a = this.travel, b = this.travel + this.bodySegments * this.reveal;

    const pts: V[] = [this.sample(a)];
    for (let i = Math.floor(a) + 1; i < b && i < this.path.length; i++) pts.push(this.path[i]);
    const headPos = this.sample(b);
    const last = pts[pts.length - 1];
    if ((headPos.x - last.x) ** 2 + (headPos.y - last.y) ** 2 > 1e-6 || pts.length === 1) pts.push(headPos);

    let c = this.color;
    if (this.hinted) {
      const pulse = 0.5 + 0.5 * Math.sin(this.board.time.now / 1000 * 9);
      c = lerpColor(c, WHITE, 0.25 + 0.45 * pulse);
    }
    if (this.flash > 0) c = lerpColor(c, this.flashColor, clamp01(this.flash));

    const vis = this.alpha * clamp01(this.reveal * 1.5);
    const glow = vis * (this.hinted ? 1 : 0.7); // a touch stronger than Unity's 0.5, which also had bloom on top
    const headScale = 0.2 + 0.8 * this.reveal;
    const d = this.dir;

    // Collapse straight runs so each straight piece is one quad and only real corners get a round joint.
    const P: V[] = [px(pts[0])];
    for (let i = 1; i < pts.length; i++) {
      const q = px(pts[i]), prev = P[P.length - 1];
      if (P.length >= 2) {
        const pp = P[P.length - 2];
        if (Math.abs((prev.x - pp.x) * (q.y - prev.y) - (prev.y - pp.y) * (q.x - prev.x)) < 1e-3) { P[P.length - 1] = q; continue; }
      }
      if ((q.x - prev.x) ** 2 + (q.y - prev.y) ** 2 > 1e-6) P.push(q);
    }

    this.used = 0;
    const hot = lerpColor(c, WHITE, 0.55); // hot centre of the neon tube

    // Soft glow: straight pieces stop half a width short of every joint; caps and corners fill those squares exactly.
    if (glow > 0.002) {
      const w = GLOW_WIDTH * U;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y) - w;
        if (len > 0) this.quad("glowSeg", (a.x + b.x) / 2, (a.y + b.y) / 2, len, w, Math.atan2(b.y - a.y, b.x - a.x), c, glow, 2);
      }
      for (let i = 0; i < P.length; i++) {
        const j = P[i];
        const toward = (q: V) => Math.atan2(q.y - j.y, q.x - j.x);
        if (i === 0 || i === P.length - 1) {
          this.quad("glowCap", j.x, j.y, w, w, toward(P[i === 0 ? 1 : i - 1]), c, glow, 2);
        } else {
          // Rotate arm +x onto the previous piece; flip so arm +y lands on the next one.
          const a1 = toward(P[i - 1]), a2 = toward(P[i + 1]);
          const turn = Math.sin(a2 - a1) > 0;
          this.quad("glowCorner", j.x, j.y, w, w, a1, c, glow, 2, !turn);
        }
      }
    }

    // Solid core and hot centre: overlaps don't show at full opacity, so round discs cover every joint.
    for (const [width, color, alpha, depth] of [[CORE_WIDTH, c, vis, 2.1], [CORE_WIDTH * 0.38, hot, vis, 2.2]] as const) {
      if (alpha <= 0.002) continue;
      const w = width * U;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1];
        this.quad("solid", (a.x + b.x) / 2, (a.y + b.y) / 2, Math.hypot(b.x - a.x, b.y - a.y), w, Math.atan2(b.y - a.y, b.x - a.x), color, alpha, depth);
      }
      for (const j of P) this.quad("disc", j.x, j.y, w, w, 0, color, alpha, depth);
    }

    // Head: a soft glow triangle under a solid one, pointing along the exit direction.
    const angle = Math.atan2(-d.y, d.x);
    const tri = (tex: string, back: number, len: number, width: number, alpha: number, depth: number) => {
      if (alpha <= 0.002) return;
      const base = px({ x: headPos.x - d.x * back, y: headPos.y - d.y * back });
      const full = (back + len) * U;
      this.quad(tex, base.x + Math.cos(angle) * full * 0.5, base.y + Math.sin(angle) * full * 0.5, full, width * U, angle, c, alpha, depth);
    };
    tri("triGlow", 0.25, (HEAD_LENGTH + 0.2) * headScale, HEAD_WIDTH * 1.9 * headScale, glow, 2);
    tri("tri", 0.05, HEAD_LENGTH * headScale, HEAD_WIDTH * headScale, vis, 2.3);

    for (let i = this.used; i < this.sprites.length; i++) this.sprites[i].setVisible(false);
  }

  /** Places the next pooled sprite: centred at (x, y), `len` long along `angle`, `width` across. */
  private quad(tex: string, x: number, y: number, len: number, width: number, angle: number, color: number, alpha: number, depth: number, flipY = false) {
    let sp = this.sprites[this.used];
    if (!sp) {
      sp = this.board.add.image(0, 0, tex);
      this.sprites.push(sp);
    }
    this.used++;
    if (sp.texture.key !== tex) sp.setTexture(tex);
    sp.setPosition(x, y).setDisplaySize(Math.max(len, 0.01), width).setRotation(angle).setFlipY(flipY).setTint(color).setAlpha(alpha).setDepth(depth)
      .setBlendMode(tex.startsWith("glow") || tex === "triGlow" ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
      .setVisible(true);
  }
}

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; size: number }

/** Phaser scene that draws and animates the board (port of BoardView, ArrowView, CameraRig and Fx). */
export class BoardScene extends Phaser.Scene implements BoardViewApi {
  theme!: Theme;
  private level: LevelData | null = null;
  private arrows: ArrowView[] = [];
  private ticking = new Set<ArrowView>();
  private bounds = { x: -4, y: -5, w: 8, h: 10 };
  private dots: Phaser.GameObjects.Image[] = [];
  private dotOfCell: Int32Array = new Int32Array(0);
  private dotAlpha: number[] = [];
  private dotTarget: number[] = [];
  private dotsDirty = false;
  private frameG!: Phaser.GameObjects.Graphics;
  private hintG!: Phaser.GameObjects.Graphics;
  private sparkG!: Phaser.GameObjects.Graphics;
  private sparks: Spark[] = [];
  private hint = -1;
  private hintRay = 0;
  private waveTime = -1;
  private waveRadius = 0;

  // Camera rig (board units, y up)
  private topInset = 0.05;
  private bottomInset = 0.05;
  private readonly margin = 0.9;
  private fitSize = 6;
  private fitPos = { x: 0, y: 0 };
  private size = 6;
  private targetSize = 6;
  private pos = { x: 0, y: 0 };
  private targetPos = { x: 0, y: 0 };
  private shakeAmount = 0;
  private lastW = 0;
  private lastH = 0;
  private zoomedIn = false;

  // Input
  private pressed = false;
  private dragging = false;
  private multiTouch = false;
  private pressStart = { x: 0, y: 0 };
  private lastPos = { x: 0, y: 0 };
  private lastPinchDistance = -1;
  private lastPinchMid = { x: 0, y: 0 };

  constructor(private game_: GameController, private background: Background, private onMistakePulse: () => void) {
    super("board");
  }

  create() {
    const tex = this.textures.createCanvas("dot", 32, 32)!;
    const ctx = tex.getContext();
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    tex.refresh();
    this.makeArrowTextures();

    this.frameG = this.add.graphics().setDepth(-1);
    this.hintG = this.add.graphics().setDepth(4);
    this.sparkG = this.add.graphics().setDepth(20).setBlendMode(Phaser.BlendModes.ADD);

    this.input.addPointer(1);
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("pointerupoutside", this.onPointerUp, this);
    this.input.on("wheel", (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (Math.abs(dy) < 0.01 || !this.game_.inputEnabled) return;
      this.zoom(dy < 0 ? 0.88 : 1.12, p.x, p.y);
    });

    if (import.meta.env.DEV) (window as unknown as { __apScene: BoardScene }).__apScene = this; // handle for browser tests
    this.game_.attach(this);
  }

  /** White textures for the arrow sprites (tinted per arrow), drawn once on canvases. */
  private makeArrowTextures() {
    const make = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      const t = this.textures.createCanvas(key, w, h)!;
      draw(t.getContext());
      t.refresh();
    };
    // Soft glow across the line width (Gaussian falloff), stretched along each straight piece.
    make("glowSeg", 3, 63, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 63);
      for (let i = 0; i <= 10; i++) { const x = i / 10, k = Math.exp(-(((x - 0.5) / 0.22) ** 2)); g.addColorStop(x, `rgba(255,255,255,${k.toFixed(3)})`); }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 3, 63);
    });
    // Glow end cap and 90° corner, computed from the exact distance to the line so they join the straight pieces seamlessly.
    // Texture space: centre = the joint, arms run along +x (and +y for the corner), 1 texture width = the glow width.
    // 63 px (not a power of two) so WebGL clamps at the edges instead of wrapping the bright arm onto the far side.
    const N = 63;
    const field = (key: string, dist: (u: number, v: number) => number) =>
      make(key, N, N, (ctx) => {
        const img = ctx.createImageData(N, N);
        for (let y = 0; y < N; y++)
          for (let x = 0; x < N; x++) {
            const u = (x + 0.5) / N - 0.5, v = (y + 0.5) / N - 0.5;
            const k = Math.exp(-((dist(u, v) / 0.22) ** 2));
            const o = (y * N + x) * 4;
            img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
            img.data[o + 3] = Math.round(k * 255);
          }
        ctx.putImageData(img, 0, 0);
      });
    const ray = (u: number, v: number) => (u >= 0 ? Math.abs(v) : Math.hypot(u, v));
    field("glowCap", ray);
    field("glowCorner", (u, v) => Math.min(ray(u, v), ray(v, u)));
    make("solid", 3, 3, (ctx) => { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 3, 3); });
    make("disc", 63, 63, (ctx) => { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(31.5, 31.5, 31, 0, Math.PI * 2); ctx.fill(); });
    // Head triangles point right: base on the left edge, tip on the right.
    make("tri", 127, 127, (ctx) => {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.moveTo(1, 1); ctx.lineTo(126, 63.5); ctx.lineTo(1, 126); ctx.closePath(); ctx.fill();
    });
    make("triGlow", 127, 127, (ctx) => {
      ctx.filter = "blur(10px)";
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.moveTo(18, 22); ctx.lineTo(112, 64); ctx.lineTo(18, 106); ctx.closePath(); ctx.fill();
    });
  }

  // ------------------------------------------------------------------ build

  cellPosition(index: number): V {
    const l = this.level!;
    return { x: cellX(l, index) - (l.width - 1) * 0.5, y: cellY(l, index) - (l.height - 1) * 0.5 };
  }

  build(level: LevelData, theme: Theme, intro: boolean) {
    this.clearBoard();
    this.level = level;
    this.theme = theme;

    // Bounds of the active cells, in board units.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < cellCount(level); i++) {
      if (!isActive(level, i)) continue;
      const x = cellX(level, i), y = cellY(level, i);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (minX === Infinity) { minX = minY = 0; maxX = level.width - 1; maxY = level.height - 1; }
    const lo = this.cellPosition(minY * level.width + minX), hi = this.cellPosition(maxY * level.width + maxX);
    this.bounds = { x: lo.x - 0.5, y: lo.y - 0.5, w: hi.x - lo.x + 1, h: hi.y - lo.y + 1 };

    // Dots
    this.dotOfCell = new Int32Array(cellCount(level)).fill(-1);
    for (let i = 0; i < cellCount(level); i++) {
      if (!isActive(level, i)) continue;
      this.dotOfCell[i] = this.dots.length;
      const p = px(this.cellPosition(i));
      this.dots.push(this.add.image(p.x, p.y, "dot").setDisplaySize(DOT_SIZE * U * 1.4, DOT_SIZE * U * 1.4).setDepth(-1));
      this.dotAlpha.push(1);
      this.dotTarget.push(1);
    }

    this.drawFrame();

    const logic = new PuzzleBoard(level);
    const cx = this.bounds.x + this.bounds.w / 2, cy = this.bounds.y + this.bounds.h / 2;
    let maxDist = 0.01;
    level.arrows.forEach((a, i) => {
      const view = new ArrowView(this, i, a, hexToInt(arrowColor(theme, i, level.seed)), logic.rayLength(i));
      this.arrows.push(view);
      for (const c of a.cells) this.setDotTarget(c, 0, true);
      const h = view.headPosition;
      maxDist = Math.max(maxDist, Math.hypot(h.x - cx, h.y - cy));
    });

    if (intro) {
      // Arrows boot up in a ripple from the centre outward.
      for (const a of this.arrows) {
        const h = a.headPosition;
        a.playIntro((Math.hypot(h.x - cx, h.y - cy) / maxDist) * 0.55 + Math.random() * 0.08);
        this.ticking.add(a);
      }
    }
    this.updateDots();
    this.computeFit();
    this.targetSize = this.size = this.fitSize;
    this.targetPos = { ...this.fitPos };
    this.pos = { ...this.fitPos };
  }

  private clearBoard() {
    for (const a of this.arrows) a.destroy();
    this.arrows = [];
    this.ticking.clear();
    for (const d of this.dots) d.destroy();
    this.dots = [];
    this.dotAlpha = [];
    this.dotTarget = [];
    this.hint = -1;
    this.hintG?.clear();
    this.waveTime = -1;
  }

  private drawFrame() {
    const r = this.bounds, pad = 0.35;
    const arm = Math.min(Math.max(Math.min(r.w, r.h) * 0.18, 0.8), 2.2);
    const corners = [
      { x: r.x - pad, y: r.y - pad, sx: 1, sy: 1 }, { x: r.x + r.w + pad, y: r.y - pad, sx: -1, sy: 1 },
      { x: r.x + r.w + pad, y: r.y + r.h + pad, sx: -1, sy: -1 }, { x: r.x - pad, y: r.y + r.h + pad, sx: 1, sy: -1 },
    ];
    const g = this.frameG;
    g.clear();
    g.lineStyle(0.06 * U, hexToInt(this.theme.accent), 0.55);
    for (const c of corners) {
      const a = px({ x: c.x + c.sx * arm, y: c.y }), m = px(c), b = px({ x: c.x, y: c.y + c.sy * arm });
      g.strokePoints([a, m, b], false, false);
    }
  }

  applyTheme(theme: Theme) {
    this.theme = theme;
    this.background.applyTheme(theme);
    if (!this.level) return;
    this.arrows.forEach((a, i) => { a.color = hexToInt(arrowColor(theme, i, this.level!.seed)); if (a.state !== "done") a.render(); });
    this.drawFrame();
    this.dotsDirty = true;
  }

  // ------------------------------------------------------------------ queries

  /** Arrow under a game-pixel point, with a little tolerance for fat fingers. */
  pick(screenX: number, screenY: number, logic: PuzzleBoard): number {
    const l = this.level;
    if (!l) return -1;
    const w = this.screenToBoard(screenX, screenY, this.pos, this.size);
    const fx = w.x + (l.width - 1) * 0.5, fy = w.y + (l.height - 1) * 0.5;
    const cx = Math.round(fx), cy = Math.round(fy);
    const direct = logic.arrowAtCell(cx, cy);
    if (direct >= 0) return direct;
    let best = -1, bestDist = 0.8 * 0.8;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const id = logic.arrowAtCell(cx + dx, cy + dy);
        if (id < 0) continue;
        const d = (cx + dx - fx) ** 2 + (cy + dy - fy) ** 2;
        if (d < bestDist) { bestDist = d; best = id; }
      }
    return best;
  }

  isBusy(id: number) { return this.arrows[id]?.isBusy ?? true; }
  get hintArrow() { return this.hint; }
  get anyAnimating() { return this.arrows.some((a) => a.state === "exiting" || a.state === "bouncing"); }

  distanceToView(id: number) {
    const h = this.arrows[id].headPosition;
    return (h.x - this.pos.x) ** 2 + (h.y - this.pos.y) ** 2;
  }

  // ------------------------------------------------------------------ actions

  launch(id: number, stepsToEdge: number) {
    const a = this.arrows[id];
    if (this.hint === id) this.clearHint();
    a.launch(stepsToEdge);
    this.ticking.add(a);
    this.spray(a.headPosition, a.dir, a.color, 10, 7);
    let delay = 0;
    for (let i = a.data.cells.length - 1; i >= 0; i--) {
      this.setDotTarget(a.data.cells[i], 1, false, delay);
      delay += 0.02;
    }
  }

  bounce(id: number, freeSteps: number, blocker: number) {
    const a = this.arrows[id];
    a.bounce(freeSteps, () => {
      const h = a.headPosition;
      this.burst({ x: h.x + a.dir.x * HEAD_LENGTH, y: h.y + a.dir.y * HEAD_LENGTH }, hexToInt(this.theme.danger), 18, 5, 0.12);
      const b = this.arrows[blocker];
      if (b && b.state !== "done") { b.doFlash(hexToInt(this.theme.danger), 1); this.ticking.add(b); }
    });
    this.ticking.add(a);
  }

  showHint(id: number, rayLength: number) {
    this.clearHint();
    const a = this.arrows[id];
    if (!a) return;
    this.hint = id;
    this.hintRay = rayLength;
    a.setHint(true);
    this.ticking.add(a);
  }

  clearHint() {
    if (this.hint >= 0) this.arrows[this.hint]?.setHint(false);
    this.hint = -1;
    this.hintG?.clear();
  }

  playWinWave() {
    this.waveTime = 0;
    this.waveRadius = Math.max(this.bounds.w, this.bounds.h) * 0.75 + 2;
  }

  winPulse() { this.background.doPulse(); }
  mistakePulse() { this.onMistakePulse(); }
  shake(amount: number) { this.shakeAmount = Math.max(this.shakeAmount, amount); }

  onArrowCrossedEdge(a: ArrowView) {
    this.spray(a.headPosition, a.dir, a.color, 16, 11);
    Sfx.play("exit", 0.5, 0.9 + Math.random() * 0.25);
  }

  // ------------------------------------------------------------------ dots

  private setDotTarget(cell: number, target: number, instant: boolean, delay = 0) {
    const d = this.dotOfCell[cell];
    if (d === undefined || d < 0) return;
    this.dotTarget[d] = target;
    if (instant) this.dotAlpha[d] = target;
    else if (delay > 0) this.dotAlpha[d] = Math.min(this.dotAlpha[d], -delay * 4); // negative alpha = wait
    this.dotsDirty = true;
  }

  private updateDots() {
    const [r, g, b, baseA] = this.theme.dot;
    const base = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    const accent = hexToInt(this.theme.accent);
    const wavePos = this.waveTime >= 0 ? this.waveTime * 14 : -100;
    const cx = this.bounds.x + this.bounds.w / 2, cy = this.bounds.y + this.bounds.h / 2;
    this.dots.forEach((dot, i) => {
      let color = base, alpha = baseA * clamp01(this.dotAlpha[i]);
      if (this.waveTime >= 0) {
        const p = dot;
        const dist = Math.hypot(p.x / U - cx, -p.y / U - cy);
        const w = Math.exp(-((dist - wavePos) ** 2) * 0.6);
        color = lerpColor(color, accent, w);
        alpha = alpha + (1 - alpha) * w;
      }
      dot.setTint(color).setAlpha(alpha);
    });
  }

  // ------------------------------------------------------------------ sparks

  private emit(pos: V, vx: number, vy: number, color: number, size: number, life: number) {
    if (this.sparks.length > 1500) return;
    this.sparks.push({ x: pos.x, y: pos.y, vx, vy, color, size, life, max: life });
  }

  /** Radial burst. */
  private burst(pos: V, color: number, count: number, speed = 6, size = 0.14) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.35 + Math.random() * 0.65);
      this.emit(pos, Math.cos(a) * s, Math.sin(a) * s, lerpColor(color, WHITE, Math.random() * 0.4), size * (0.6 + Math.random() * 0.7), 0.25 + Math.random() * 0.35);
    }
  }

  /** Cone of sparks thrown in a direction (an arrow leaving the board). */
  private spray(pos: V, dir: V, color: number, count: number, speed = 9) {
    const base = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < count; i++) {
      const a = base + ((Math.random() * 70 - 35) * Math.PI) / 180, s = speed * (0.4 + Math.random() * 0.6);
      this.emit(pos, Math.cos(a) * s, Math.sin(a) * s, lerpColor(color, WHITE, Math.random() * 0.5), 0.08 + Math.random() * 0.1, 0.2 + Math.random() * 0.3);
    }
  }

  private updateSparks(dt: number) {
    const g = this.sparkG;
    g.clear();
    const drag = Math.exp(-3 * dt);
    this.sparks = this.sparks.filter((s) => (s.life -= dt) > 0);
    for (const s of this.sparks) {
      s.vx *= drag; s.vy *= drag;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const k = s.life / s.max; // 1 → 0
      const alpha = k > 0.6 ? 1 : k > 0 ? 0.8 * (k / 0.6) + 0.2 * k : 0;
      const width = s.size * (0.1 + 0.9 * k) * U;
      // Stretched along velocity, like Unity's stretched-billboard particles.
      const len = 0.06 * 1.5, tail = { x: s.x - s.vx * len, y: s.y - s.vy * len };
      const a = px(s), b = px(tail);
      g.lineStyle(width, s.color, alpha);
      g.lineBetween(b.x, b.y, a.x, a.y);
    }
  }

  // ------------------------------------------------------------------ camera rig

  setInsets(top: number, bottom: number) {
    const wasFit = !this.zoomedIn;
    this.topInset = top;
    this.bottomInset = bottom;
    this.computeFit();
    if (wasFit) { this.targetSize = this.fitSize; this.targetPos = { ...this.fitPos }; }
  }

  resetView() {
    this.targetSize = this.fitSize;
    this.targetPos = { ...this.fitPos };
  }

  private get screenW() { return this.scale.width; }
  private get screenH() { return this.scale.height; }

  private computeFit() {
    this.lastW = this.screenW;
    this.lastH = this.screenH;
    const aspect = Math.max(0.1, this.screenW / Math.max(1, this.screenH));
    const usable = Math.min(Math.max(1 - this.topInset - this.bottomInset, 0.3), 1);
    const sizeV = ((this.bounds.h + this.margin * 2) * 0.5) / usable;
    const sizeH = ((this.bounds.w + this.margin * 2) * 0.5) / aspect;
    this.fitSize = Math.max(sizeV, sizeH, 3);
    // Put the board in the middle of the usable band, not the middle of the screen.
    const centerFraction = this.bottomInset + usable * 0.5;
    this.fitPos = { x: this.bounds.x + this.bounds.w / 2, y: this.bounds.y + this.bounds.h / 2 - (centerFraction - 0.5) * 2 * this.fitSize };
  }

  private get minSize() { return Math.min(this.fitSize, 3.2); }
  private get maxSize() { return this.fitSize * 1.08; }

  /** Game-pixel point → board units for a given camera. */
  private screenToBoard(sx: number, sy: number, camPos: V, camSize: number): V {
    const aspect = this.screenW / Math.max(1, this.screenH);
    const nx = sx / Math.max(1, this.screenW) - 0.5;
    const ny = 0.5 - sy / Math.max(1, this.screenH);
    return { x: camPos.x + nx * camSize * 2 * aspect, y: camPos.y + ny * camSize * 2 };
  }

  private pan(dx: number, dy: number) {
    const perPixel = (2 * this.targetSize) / Math.max(1, this.screenH);
    this.targetPos = this.clampPos({ x: this.targetPos.x - dx * perPixel, y: this.targetPos.y + dy * perPixel });
    this.pos = { ...this.targetPos };
  }

  private zoom(factor: number, sx: number, sy: number) {
    const newSize = Math.min(Math.max(this.targetSize * factor, this.minSize), this.maxSize);
    if (Math.abs(newSize - this.targetSize) < 1e-6) return;
    const pivot = this.screenToBoard(sx, sy, this.targetPos, this.targetSize);
    const k = newSize / this.targetSize;
    this.targetPos = { x: pivot.x - (pivot.x - this.targetPos.x) * k, y: pivot.y - (pivot.y - this.targetPos.y) * k };
    this.targetSize = newSize;
    this.targetPos = this.clampPos(this.targetPos);
  }

  private clampPos(p: V): V {
    if (this.targetSize >= this.fitSize * 0.97) return { ...this.fitPos };
    const b = this.bounds, dy = this.fitPos.y - (b.y + b.h / 2);
    return { x: Math.min(Math.max(p.x, b.x), b.x + b.w), y: Math.min(Math.max(p.y, b.y + dy), b.y + b.h + dy) };
  }

  private updateCamera(dt: number, t: number) {
    if (this.screenW !== this.lastW || this.screenH !== this.lastH) {
      const wasFit = !this.zoomedIn;
      this.computeFit();
      if (wasFit) { this.targetSize = this.fitSize; this.targetPos = { ...this.fitPos }; }
      this.targetSize = Math.min(Math.max(this.targetSize, this.minSize), this.maxSize);
    }
    const k = 1 - Math.exp(-dt * 12);
    this.size += (this.targetSize - this.size) * k;
    const zoomedIn = this.targetSize < this.fitSize * 0.97;
    if (!zoomedIn) this.targetPos = { ...this.fitPos };
    this.pos.x += (this.targetPos.x - this.pos.x) * k;
    this.pos.y += (this.targetPos.y - this.pos.y) * k;
    if (zoomedIn !== this.zoomedIn) { this.zoomedIn = zoomedIn; ui.set({ zoomedIn }); }

    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.5);
    let ox = 0, oy = 0;
    if (this.shakeAmount > 0) {
      const s = this.shakeAmount * this.shakeAmount * 0.35, n = t * 45;
      ox = (Math.sin(n * 1.7) * 0.6 + Math.sin(n * 3.1) * 0.4) * s;
      oy = (Math.sin(n * 2.3 + 1) * 0.6 + Math.sin(n * 2.9 + 2) * 0.4) * s;
    }
    const cam = this.cameras.main;
    cam.setZoom(this.screenH / (2 * this.size * U));
    cam.centerOn((this.pos.x + ox) * U, -(this.pos.y + oy) * U);
    this.background.setOffset(this.pos.x, this.pos.y);
  }

  // ------------------------------------------------------------------ input (tap = launch, drag = pan, pinch / wheel = zoom)

  private get dragThreshold() { return 14 * Math.min(window.devicePixelRatio || 1, 2); }

  private activePointers() {
    return this.input.manager.pointers.filter((p) => p.isDown);
  }

  private onPointerDown(p: Phaser.Input.Pointer) {
    Sfx.unlock();
    const down = this.activePointers();
    if (down.length >= 2) { this.multiTouch = true; this.lastPinchDistance = -1; return; }
    this.pressed = true;
    this.dragging = false;
    this.pressStart = { x: p.x, y: p.y };
    this.lastPos = { x: p.x, y: p.y };
  }

  private onPointerMove(p: Phaser.Input.Pointer) {
    const down = this.activePointers();
    if (down.length >= 2) {
      this.multiTouch = true;
      const [a, b] = down;
      const dist = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.lastPinchDistance > 0 && dist > 1 && this.game_.inputEnabled) {
        this.zoom(this.lastPinchDistance / dist, mid.x, mid.y);
        this.pan(mid.x - this.lastPinchMid.x, mid.y - this.lastPinchMid.y);
      }
      this.lastPinchDistance = dist;
      this.lastPinchMid = mid;
      return;
    }
    if (!this.pressed || this.multiTouch || !p.isDown) return;
    if (!this.dragging && Math.hypot(p.x - this.pressStart.x, p.y - this.pressStart.y) > this.dragThreshold) this.dragging = true; // a drag never counts as a tap
    if (this.dragging && this.game_.inputEnabled) this.pan(p.x - this.lastPos.x, p.y - this.lastPos.y);
    this.lastPos = { x: p.x, y: p.y };
  }

  private onPointerUp(p: Phaser.Input.Pointer) {
    if (this.pressed && !this.dragging && !this.multiTouch) this.game_.handleTap(p.x, p.y);
    if (this.activePointers().length === 0) { this.multiTouch = false; this.pressed = false; this.lastPinchDistance = -1; }
    this.dragging = false;
  }

  // ------------------------------------------------------------------ loop

  private lastFrame = 0;

  update(time: number) {
    // Real elapsed time (like Unity's unscaledDeltaTime): Phaser's smoothed delta slows animations when frames drop.
    const now = performance.now();
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : 1 / 60;
    this.lastFrame = now;
    for (const a of [...this.ticking]) {
      a.tick(dt);
      if (!a.needsTick || a.state === "done") this.ticking.delete(a);
    }

    this.hintG.clear();
    if (this.hint >= 0) this.drawHint(time / 1000);

    for (let i = 0; i < this.dotAlpha.length; i++) {
      if (this.dotAlpha[i] === this.dotTarget[i]) continue;
      const d = this.dotTarget[i] - this.dotAlpha[i], step = dt * 4;
      this.dotAlpha[i] = Math.abs(d) <= step ? this.dotTarget[i] : this.dotAlpha[i] + Math.sign(d) * step;
      this.dotsDirty = true;
    }
    if (this.waveTime >= 0) {
      this.waveTime += dt;
      this.dotsDirty = true;
      if (this.waveTime * 14 > this.waveRadius + 3) this.waveTime = -1;
    }
    if (this.dotsDirty) { this.dotsDirty = false; this.updateDots(); }

    this.updateSparks(dt);
    this.updateCamera(dt, time / 1000);
    this.background.render(time / 1000, dt);
  }

  /** Animated dashed path from the hinted arrow to the board edge. */
  private drawHint(t: number) {
    const a = this.arrows[this.hint];
    if (!a || a.state === "done") return;
    const h = a.headPosition, d = a.dir;
    const start = HEAD_LENGTH + 0.25, end = this.hintRay + 1.2;
    const c = lerpColor(a.color, WHITE, 0.3);
    const dash = 0.32, gap = 0.22, period = dash + gap;
    const offset = (t * 2.5 * 0.4) % period;
    const g = this.hintG;
    for (let s = start - period + offset; s < end; s += period) {
      const s0 = Math.max(s, start), s1 = Math.min(s + dash, end);
      if (s1 <= s0) continue;
      const alpha = 0.9 * (1 - (s0 - start) / Math.max(0.01, end - start));
      const p0 = px({ x: h.x + d.x * s0, y: h.y + d.y * s0 }), p1 = px({ x: h.x + d.x * s1, y: h.y + d.y * s1 });
      g.lineStyle(0.16 * U, c, alpha);
      g.lineBetween(p0.x, p0.y, p1.x, p1.y);
    }
  }
}
