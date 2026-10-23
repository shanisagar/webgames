import { HitAction, HT, Kind, SHAPES, W, Well } from "./Stack";

/**
 * The virtual stacker: scores every rotation and column the falling piece can still reach (stack height, holes,
 * bumpiness, wells, lines) and picks the best (EASY often settles for a worse spot). It then steers by THROWING:
 * the game turns the next wanted action into a ball aimed at the piece's side, top or the well under it.
 */

export interface Plan { rot: number; x: number; score: number }

export class Stacker {
  plan: Plan | null = null;
  constructor(public level: number, private rand: () => number) {}

  /** Plans for the current piece. fresh: a new piece (only then may it pick a worse spot, so it doesn't dither). */
  think(w: Well, fresh = true) {
    const p = w.active;
    if (!p) { this.plan = null; return; }
    const options: Plan[] = [];
    const rots = p.kind === Kind.O ? 1 : 4;
    for (let rot = 0; rot < rots; rot++)
      for (let x = -3; x < W; x++) {
        const res = Stacker.drop(w, p.kind, rot, x, p.y);
        if (!res) continue;
        // steps needed (the slower the throwers, the more a far target costs)
        const steps = Math.abs(x - p.x) + ((rot - p.rot + 4) % 4);
        options.push({ rot, x, score: Stacker.evaluate(res.grid, res.lines, res.land, res.eroded) - steps * [0.6, 0.35, 0.15][this.level] });
      }
    if (options.length === 0) { this.plan = null; return; }
    options.sort((a, b) => b.score - a.score);
    let pick = options[0];
    if (!fresh && this.plan) {
      // keep the chosen spot while it is still reachable
      const same = options.find((o) => o.rot === this.plan!.rot && o.x === this.plan!.x);
      if (same && same.score > options[0].score - 25) pick = same;
    } else if (this.level === 0 && this.rand() < 0.35) {
      const ok = options.filter((o) => o.score > options[0].score - 9);
      pick = ok[Math.floor(this.rand() * ok.length)];
    } else if (this.level === 1 && this.rand() < 0.2) {
      const ok = options.filter((o) => o.score > options[0].score - 10);
      pick = ok[Math.floor(this.rand() * ok.length)];
    }
    this.plan = { ...pick };
  }

  /** The next action toward the plan. */
  next(w: Well): HitAction {
    const p = w.active;
    if (!p || !this.plan) return HitAction.Miss;
    if (p.rot !== this.plan.rot && p.kind !== Kind.O) return HitAction.Rotate;
    if (p.x < this.plan.x) return HitAction.Right;
    if (p.x > this.plan.x) return HitAction.Left;
    return HitAction.Slam;
  }

  /** Drops a piece at (rot, x) from row y (if it fits there) to the floor; null when it can't be placed. */
  static drop(w: Well, kind: Kind, rot: number, x: number, fromY: number) {
    const shape = SHAPES[kind][rot];
    const g = w.grid;
    const fits = (y: number) => {
      for (const [dx, dy] of shape) {
        const cx = x + dx, cy = y + dy;
        if (cx < 0 || cx >= W || cy < 0) return false;
        if (cy < HT && g[cy * W + cx] !== 0) return false;
      }
      return true;
    };
    let y = fromY;
    if (!fits(y)) { y++; if (!fits(y)) return null; }
    while (fits(y - 1)) y--;
    const grid = g.slice();
    let land = 0, eroded = 0;
    for (const [dx, dy] of shape) { grid[(y + dy) * W + x + dx] = kind; land += y + dy; }
    land /= 4;
    let lines = 0, write = 0;
    for (let row = 0; row < HT; row++) {
      let full = true;
      for (let c = 0; c < W; c++) if (grid[row * W + c] === 0) { full = false; break; }
      if (full) { lines++; for (const [, dy] of shape) if (y + dy === row) eroded++; continue; }
      if (write !== row) grid.copyWithin(write * W, row * W, row * W + W);
      write++;
    }
    if (lines > 0) grid.fill(0, write * W);
    return { grid, lines: lines, land, eroded: lines * eroded };
  }

  /** Dellacherie-style evaluation (landing height, eroded cells, row/column transitions, holes, wells). */
  static evaluate(g: Uint8Array, lines: number, land: number, eroded = lines * 2) {
    const filled = (x: number, y: number) => x < 0 || x >= W || y < 0 || g[y * W + x] !== 0;
    let rowT = 0, colT = 0, holes = 0, wells = 0, maxH = 0;
    for (let y = 0; y < HT; y++) {
      let any = false;
      for (let x = 0; x <= W; x++) if (filled(x - 1, y) !== filled(x, y)) rowT++;
      for (let x = 0; x < W; x++) if (g[y * W + x] !== 0) any = true;
      if (!any) { rowT -= 2; } else maxH = y + 1;
    }
    for (let x = 0; x < W; x++) {
      let covered = false, depth = 0;
      for (let y = HT - 1; y >= -1; y--) {
        const f = filled(x, y);
        if (y >= 0 && f !== filled(x, y + 1) && y + 1 < HT) colT++;
        if (y < 0) { if (!filled(x, 0)) colT++; break; }
        if (f) covered = true; else if (covered) holes++;
        if (!f && filled(x - 1, y) && filled(x + 1, y)) { depth++; wells += depth; } else depth = 0;
      }
    }
    const danger = Math.max(0, maxH - 10);
    return -4.5 * land + 3.42 * eroded - 3.22 * rowT - 9.35 * colT - 7.9 * holes - 3.39 * wells - 6 * danger * danger;
  }
}
