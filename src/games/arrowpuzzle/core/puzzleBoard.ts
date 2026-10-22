import { Difficulty, LevelData, cellCount, cellX, cellY, dirX, dirY, head, inBounds } from "./level";

export interface Analysis {
  solvable: boolean;
  /** Number of "waves" needed when removing every free arrow at once. */
  depth: number;
  initiallyFree: number;
}

/**
 * Runtime rules of the puzzle. An arrow can leave the board when every cell on the straight
 * ray in front of its head (up to the board edge) is free. Removing arrows only frees cells,
 * so a level is solvable exactly when repeatedly removing free arrows empties the board.
 */
export class PuzzleBoard {
  readonly level: LevelData;
  private readonly occupancy: Int32Array;
  private readonly removed: boolean[];
  remaining: number;

  constructor(level: LevelData) {
    this.level = level;
    this.occupancy = new Int32Array(cellCount(level)).fill(-1);
    this.removed = level.arrows.map(() => false);
    level.arrows.forEach((a, i) => a.cells.forEach((c) => (this.occupancy[c] = i)));
    this.remaining = level.arrows.length;
  }

  get arrowCount() { return this.level.arrows.length; }
  isRemoved(arrow: number) { return this.removed[arrow]; }

  arrowAtCell(x: number, y: number): number {
    return inBounds(this.level, x, y) ? this.occupancy[y * this.level.width + x] : -1;
  }

  /** Number of cells between the head and the board edge. */
  rayLength(arrow: number): number {
    const a = this.level.arrows[arrow];
    const dx = dirX(a.dir), dy = dirY(a.dir);
    let x = cellX(this.level, head(a)) + dx, y = cellY(this.level, head(a)) + dy, n = 0;
    while (inBounds(this.level, x, y)) { n++; x += dx; y += dy; }
    return n;
  }

  /** Whether the arrow can fly out; otherwise how far it gets (`freeSteps`) before hitting `blocker`. */
  canExit(arrow: number): { ok: boolean; freeSteps: number; blocker: number } {
    const l = this.level, a = l.arrows[arrow];
    const dx = dirX(a.dir), dy = dirY(a.dir);
    let x = cellX(l, head(a)) + dx, y = cellY(l, head(a)) + dy, freeSteps = 0;
    while (inBounds(l, x, y)) {
      const o = this.occupancy[y * l.width + x];
      if (o >= 0) return { ok: false, freeSteps, blocker: o };
      freeSteps++;
      x += dx;
      y += dy;
    }
    return { ok: true, freeSteps, blocker: -1 };
  }

  remove(arrow: number) {
    if (this.removed[arrow]) return;
    this.removed[arrow] = true;
    for (const c of this.level.arrows[arrow].cells) if (this.occupancy[c] === arrow) this.occupancy[c] = -1;
    this.remaining--;
  }

  /** All arrows that can leave right now. */
  freeArrows(): number[] {
    const list: number[] = [];
    for (let i = 0; i < this.removed.length; i++) if (!this.removed[i] && this.canExit(i).ok) list.push(i);
    return list;
  }

  static analyze(level: LevelData): Analysis {
    const board = new PuzzleBoard(level);
    let wave = 0, initiallyFree = 0;
    while (board.remaining > 0) {
      const free = board.freeArrows();
      if (free.length === 0) break;
      if (wave === 0) initiallyFree = free.length;
      for (const a of free) board.remove(a);
      wave++;
    }
    return { depth: wave, initiallyFree, solvable: board.remaining === 0 && !PuzzleBoard.hasSelfBlockingArrow(level) };
  }

  /** An arrow whose ray crosses its own body can never be animated out cleanly. */
  static hasSelfBlockingArrow(level: LevelData): boolean {
    for (const a of level.arrows) {
      const dx = dirX(a.dir), dy = dirY(a.dir);
      let x = cellX(level, head(a)) + dx, y = cellY(level, head(a)) + dy;
      while (inBounds(level, x, y)) {
        if (a.cells.includes(y * level.width + x)) return true;
        x += dx;
        y += dy;
      }
    }
    return false;
  }

  static rate(arrowCount: number, depth: number): Difficulty {
    const score = depth * 4 + arrowCount * 0.35;
    if (score < 25) return Difficulty.Easy;
    if (score < 60) return Difficulty.Normal;
    if (score < 110) return Difficulty.Hard;
    return Difficulty.Expert;
  }
}
