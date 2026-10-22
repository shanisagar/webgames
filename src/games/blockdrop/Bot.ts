import { Engine, H, Kind, Piece, SHAPES, VISIBLE, W } from "./Engine";

/**
 * The computer player: scores every reachable drop (each rotation and column, with or without the held piece) with
 * a weighted board evaluation (stack height, holes, bumpiness, wells, lines) and, on HARD, looks one piece ahead.
 * It then steers the real piece there one input at a time, at a speed set by the difficulty.
 */

export interface Plan { hold: boolean; rot: number; x: number; score: number }

interface Weights { height: number; holes: number; bump: number; lines: number[]; well: number; covered: number; danger: number; rowTrans: number }

const Normal: Weights = { height: -0.51, holes: -3.6, bump: -0.18, lines: [0, 0.6, 1.4, 2.6, 6.5], well: -0.15, covered: -0.25, danger: -0.6, rowTrans: -0.12 };

export class BotBrain {
  private w = Normal;
  constructor(public level: number) {}

  /** Returns the best placement for the engine's current situation. */
  plan(e: Engine, rand: () => number): Plan | null {
    const p = e.active;
    if (!p) return null;
    const lookahead = this.level >= 2;
    const options: Plan[] = [];
    const nextKind = e.queue[0];
    this.addOptions(e.grid, p.kind, false, options, lookahead ? (this.level >= 2 ? nextKind : Kind.None) : Kind.None);
    if (this.level >= 1 && !e.holdUsed) {
      const hk = e.hold !== Kind.None ? e.hold : nextKind;
      const after = e.hold !== Kind.None ? nextKind : e.queue[1];
      if (hk !== p.kind) this.addOptions(e.grid, hk, true, options, lookahead ? after : Kind.None);
    }
    if (options.length === 0) return null;
    options.sort((a, b) => b.score - a.score);
    if (this.level === 0) {
      // EASY: often settles for a worse spot
      const r = rand();
      if (r < 0.3) return options[Math.min(options.length - 1, 1 + Math.floor(rand() * 4))];
    } else if (this.level === 1 && rand() < 0.08) return options[Math.min(options.length - 1, 1)];
    return options[0];
  }

  private addOptions(grid: Uint8Array, kind: Kind, hold: boolean, out: Plan[], next: Kind) {
    const rots = kind === Kind.O ? 1 : 4;
    const first: { plan: Plan; grid: Uint8Array }[] = [];
    for (let rot = 0; rot < rots; rot++) {
      for (let x = -3; x < W; x++) {
        const res = BotBrain.drop(grid, kind, rot, x);
        if (!res) continue;
        first.push({ plan: { hold, rot, x, score: this.evaluate(res.grid, res.lines, res.landY) }, grid: res.grid });
      }
    }
    if (next !== Kind.None) {
      // look one piece ahead from the most promising spots only
      first.sort((a, b) => b.plan.score - a.plan.score);
      for (let i = 0; i < Math.min(8, first.length); i++) {
        let best = -1e9;
        const nr = next === Kind.O ? 1 : 4;
        for (let r2 = 0; r2 < nr; r2++)
          for (let x2 = -3; x2 < W; x2++) {
            const r = BotBrain.drop(first[i].grid, next, r2, x2);
            if (!r) continue;
            const v = this.evaluate(r.grid, r.lines, r.landY);
            if (v > best) best = v;
          }
        first[i].plan.score = first[i].plan.score * 0.45 + best * 0.55 + 1000;
      }
    }
    for (const f of first) out.push(f.plan);
  }

  /** Drops a piece straight down from the top in a column; null when it can't be placed there. */
  static drop(grid: Uint8Array, kind: Kind, rot: number, x: number) {
    const shape = SHAPES[kind][rot];
    const fits = (y: number) => {
      for (const [dx, dy] of shape) {
        const cx = x + dx, cy = y + dy;
        if (cx < 0 || cx >= W || cy < 0) return false;
        if (cy < H && grid[cy * W + cx] !== 0) return false;
      }
      return true;
    };
    let y = VISIBLE + 1;
    if (!fits(y)) return null;
    while (fits(y - 1)) y--;
    const g = grid.slice();
    for (const [dx, dy] of shape) g[(y + dy) * W + x + dx] = kind;
    // clear lines
    let lines = 0;
    let write = 0;
    for (let row = 0; row < H; row++) {
      let full = true;
      for (let c = 0; c < W; c++) if (g[row * W + c] === 0) { full = false; break; }
      if (full) { lines++; continue; }
      if (write !== row) g.copyWithin(write * W, row * W, row * W + W);
      write++;
    }
    if (lines > 0) g.fill(0, write * W);
    return { grid: g, lines, landY: y };
  }

  evaluate(g: Uint8Array, lines: number, landY: number) {
    const w = this.w;
    const hts = new Array<number>(W).fill(0);
    for (let x = 0; x < W; x++) {
      for (let y = H - 1; y >= 0; y--) if (g[y * W + x] !== 0) { hts[x] = y + 1; break; }
    }
    let agg = 0, maxH = 0, holes = 0, covered = 0, bump = 0, wells = 0, rowTrans = 0;
    for (let x = 0; x < W; x++) {
      agg += hts[x];
      maxH = Math.max(maxH, hts[x]);
      let blocks = 0;
      for (let y = hts[x] - 1; y >= 0; y--) {
        if (g[y * W + x] === 0) { holes++; covered += blocks; } else blocks++;
      }
      if (x < W - 1) bump += Math.abs(hts[x] - hts[x + 1]);
      const l = x === 0 ? 99 : hts[x - 1], r = x === W - 1 ? 99 : hts[x + 1];
      const d = Math.min(l, r) - hts[x];
      if (d > 2) wells += d * d * 0.25;
    }
    for (let y = 0; y < maxH; y++) {
      let prev = 1;
      for (let x = 0; x < W; x++) { const f = g[y * W + x] !== 0 ? 1 : 0; if (f !== prev) rowTrans++; prev = f; }
      if (prev === 0) rowTrans++;
    }
    const danger = Math.max(0, maxH - 12);
    // low stacks may build for big clears; high stacks take any line
    const lineScore = maxH < 9 ? w.lines[lines] : lines * 1.6;
    return w.height * agg / W * 2 + w.holes * holes + w.covered * Math.min(covered, 12) + w.bump * bump + w.well * wells
      + w.rowTrans * rowTrans + w.danger * danger * danger + lineScore * 3 - Math.max(0, landY - 14) * 0.3;
  }
}

/** Drives an engine's piece toward a plan with human-like pacing. */
export class BotDriver {
  brain: BotBrain;
  private plan: Plan | null = null;
  private think = 0;
  private act = 0;
  private planned = false;
  private rng: () => number;
  /** Seconds per input and thinking time per piece. */
  readonly actGap: number;
  readonly thinkTime: number;

  constructor(readonly level: number, rng: () => number) {
    this.brain = new BotBrain(level);
    this.rng = rng;
    this.actGap = [0.2, 0.12, 0.07][level];
    this.thinkTime = [0.7, 0.35, 0.18][level];
  }

  reset() { this.plan = null; this.planned = false; this.think = this.thinkTime; }

  /** Call when a new piece spawns. */
  newPiece() { this.planned = false; this.plan = null; this.think = this.thinkTime * (0.6 + this.rng() * 0.8); }

  /** Returns true when it acted this frame (for sounds). */
  tick(e: Engine, dt: number): string | null {
    if (e.busy) return null;
    if (!this.planned) {
      this.think -= dt;
      if (this.think > 0) return null;
      this.plan = this.brain.plan(e, this.rng);
      this.planned = true;
      this.act = 0;
    }
    this.act -= dt;
    if (this.act > 0) return null;
    this.act = this.actGap * (0.7 + this.rng() * 0.6);
    const p = this.plan;
    const a = e.active as Piece;
    if (!p) { e.hardDrop(); return "drop"; }
    if (p.hold && !e.holdUsed) {
      e.holdPiece();
      p.hold = false;
      return "hold";
    }
    if (a.rot !== p.rot) {
      const cw = (p.rot - a.rot + 4) % 4;
      if (!e.rotate(cw === 3 ? -1 : 1)) { p.rot = a.rot; }
      return "rotate";
    }
    if (a.x !== p.x) {
      if (!e.move(a.x < p.x ? 1 : -1)) p.x = a.x;
      return "move";
    }
    if (this.level === 0 && e.canMove(0, -1) && this.rng() < 0.5) { e.softStep(); return "soft"; }
    e.hardDrop();
    return "drop";
  }
}
