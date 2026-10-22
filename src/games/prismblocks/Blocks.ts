import { SysRandom } from "../../kit";

/** A block piece: cells relative to its bottom-left, plus how often and how early it appears. (Port of Blocks.cs.) */
export class Shape {
  readonly Cells: [number, number][];
  readonly W: number = 0;
  readonly H: number;
  readonly Weight: number;
  readonly Stage: number;

  constructor(rows: string, weight: number, stage: number) {
    const lines = rows.split("|");
    this.H = lines.length;
    const cells: [number, number][] = [];
    let w = 0;
    for (let r = 0; r < this.H; r++) {
      w = Math.max(w, lines[r].length);
      for (let c = 0; c < lines[r].length; c++) if (lines[r][c] === "X") cells.push([c, this.H - 1 - r]);
    }
    this.W = w;
    this.Cells = cells;
    this.Weight = weight;
    this.Stage = stage;
  }

  static readonly All: Shape[] = [
    new Shape("X", 3, 0),
    new Shape("XX", 6, 0), new Shape("X|X", 6, 0),
    new Shape("XXX", 6, 0), new Shape("X|X|X", 6, 0),
    new Shape("XXXX", 4, 0), new Shape("X|X|X|X", 4, 0),
    new Shape("XXXXX", 2, 1), new Shape("X|X|X|X|X", 2, 1),
    new Shape("XX|XX", 7, 0),
    new Shape("XX|XX|XX", 2, 1), new Shape("XXX|XXX", 2, 1),
    new Shape("XXX|XXX|XXX", 2, 2),
    new Shape("X.|XX", 4, 0), new Shape(".X|XX", 4, 0), new Shape("XX|X.", 4, 0), new Shape("XX|.X", 4, 0),
    new Shape("X.|X.|XX", 2, 0), new Shape(".X|.X|XX", 2, 0), new Shape("XX|X.|X.", 2, 0), new Shape("XX|.X|.X", 2, 0),
    new Shape("XXX|X..", 2, 0), new Shape("XXX|..X", 2, 0), new Shape("X..|XXX", 2, 0), new Shape("..X|XXX", 2, 0),
    new Shape("XXX|.X.", 3, 1), new Shape(".X.|XXX", 3, 1), new Shape("X.|XX|X.", 3, 1), new Shape(".X|XX|.X", 3, 1),
    new Shape("XX.|.XX", 2, 1), new Shape(".XX|XX.", 2, 1), new Shape("X.|XX|.X", 2, 1), new Shape(".X|XX|X.", 2, 1),
    new Shape("X..|X..|XXX", 1, 2), new Shape("..X|..X|XXX", 1, 2), new Shape("XXX|X..|X..", 1, 2), new Shape("XXX|..X|..X", 1, 2),
  ];
}

/** What a placement did, for scoring feedback and animation. */
export interface PlaceResult {
  Points: number; Lines: number; Streak: number;
  AllClear: boolean;
  Rows: number[]; Cols: number[];
  Cleared: number[]; // cell indices emptied by the clear
  ClearedColors: number[];
}

/**
 * The 8x8 board and scoring (pure logic). Placing a piece scores its cells; filling a row or column clears it.
 * Clears in consecutive turns build a streak that multiplies line points; the streak survives up to two
 * placements without a clear. Emptying the whole board earns a big bonus.
 */
export class Board {
  static readonly Size = 8;
  static readonly AllClearBonus = 300;

  readonly C = new Uint8Array(Board.Size * Board.Size);
  Score = 0; Streak = 0; Misses = 0; Lines = 0;

  static Index(x: number, y: number) { return y * Board.Size + x; }

  Clone() {
    const b = new Board();
    b.Score = this.Score; b.Streak = this.Streak; b.Misses = this.Misses; b.Lines = this.Lines;
    b.C.set(this.C);
    return b;
  }

  CanPlace(s: Shape, x: number, y: number) {
    if (x < 0 || y < 0 || x + s.W > Board.Size || y + s.H > Board.Size) return false;
    for (const [cx, cy] of s.Cells) if (this.C[Board.Index(x + cx, y + cy)] !== 0) return false;
    return true;
  }

  Fits(s: Shape) {
    for (let y = 0; y + s.H <= Board.Size; y++)
      for (let x = 0; x + s.W <= Board.Size; x++) if (this.CanPlace(s, x, y)) return true;
    return false;
  }

  get Filled() {
    let n = 0;
    for (const c of this.C) if (c !== 0) n++;
    return n;
  }

  /** Rows and columns that would be complete if `s` were placed at (x, y). */
  PreviewLines(s: Shape, x: number, y: number, rows: number[], cols: number[]) {
    for (const [cx, cy] of s.Cells) this.C[Board.Index(x + cx, y + cy)] = 255;
    this.FullLines(rows, cols);
    for (const [cx, cy] of s.Cells) this.C[Board.Index(x + cx, y + cy)] = 0;
  }

  private FullLines(rows: number[], cols: number[]) {
    rows.length = 0;
    cols.length = 0;
    const N = Board.Size;
    for (let r = 0; r < N; r++) {
      let full = true;
      for (let c = 0; c < N && full; c++) full = this.C[Board.Index(c, r)] !== 0;
      if (full) rows.push(r);
    }
    for (let c = 0; c < N; c++) {
      let full = true;
      for (let r = 0; r < N && full; r++) full = this.C[Board.Index(c, r)] !== 0;
      if (full) cols.push(c);
    }
  }

  Place(s: Shape, x: number, y: number, color: number): PlaceResult {
    const res: PlaceResult = { Points: 0, Lines: 0, Streak: 0, AllClear: false, Rows: [], Cols: [], Cleared: [], ClearedColors: [] };
    for (const [cx, cy] of s.Cells) this.C[Board.Index(x + cx, y + cy)] = color;
    res.Points = s.Cells.length;

    this.FullLines(res.Rows, res.Cols);
    const lines = res.Rows.length + res.Cols.length;
    if (lines > 0) {
      const clear = new Set<number>();
      for (const r of res.Rows) for (let c = 0; c < Board.Size; c++) clear.add(Board.Index(c, r));
      for (const c of res.Cols) for (let r = 0; r < Board.Size; r++) clear.add(Board.Index(c, r));
      for (const i of clear) {
        res.Cleared.push(i);
        res.ClearedColors.push(this.C[i]);
        this.C[i] = 0;
      }
      this.Streak++;
      this.Misses = 0;
      this.Lines += lines;
      res.Points += ((lines * (lines + 1)) / 2) * 10 * this.Streak;
      if (this.Filled === 0) {
        res.AllClear = true;
        res.Points += Board.AllClearBonus;
      }
    } else if (++this.Misses >= 3) {
      this.Streak = 0;
      this.Misses = 0;
    }
    res.Lines = lines;
    res.Streak = this.Streak;
    this.Score += res.Points;
    return res;
  }

  /** Clears a square in the middle of the board (rescue after a rewarded ad). */
  ClearCentre(size: number) {
    const from = Math.trunc((Board.Size - size) / 2);
    for (let y = from; y < from + size; y++)
      for (let x = from; x < from + size; x++) this.C[Board.Index(x, y)] = 0;
  }
}

/** Deals trays of three pieces that are always playable and get tougher as the score climbs. */
export const Dealer = {
  Deal(b: Board, rng: SysRandom): Shape[] {
    const stage = b.Score < 400 ? 0 : b.Score < 1500 ? 1 : 2;
    const crowd = b.Filled / (Board.Size * Board.Size);
    const tray: Shape[] = new Array(3);
    for (let attempt = 0; attempt < 60; attempt++) {
      let anyFits = false;
      for (let k = 0; k < 3; k++) {
        tray[k] = Dealer.Pick(rng, stage, crowd, attempt > 30);
        anyFits ||= b.Fits(tray[k]);
      }
      if (anyFits) return tray;
    }
    // Board is nearly full: hand out singles so the player always has a chance.
    for (let k = 0; k < 3; k++) tray[k] = Shape.All[0];
    return tray;
  },

  Pick(rng: SysRandom, stage: number, crowd: number, small: boolean): Shape {
    let total = 0;
    for (const s of Shape.All) total += Dealer.WeightOf(s, stage, crowd, small);
    let r = rng.next(total);
    for (const s of Shape.All) {
      r -= Dealer.WeightOf(s, stage, crowd, small);
      if (r < 0) return s;
    }
    return Shape.All[0];
  },

  WeightOf(s: Shape, stage: number, crowd: number, small: boolean) {
    if (s.Stage > stage) return 0;
    let w = s.Weight * 4;
    const n = s.Cells.length;
    if (crowd > 0.55 || small) w = n <= 3 ? w * 3 : n >= 6 ? Math.trunc(w / 4) : w; // mercy on crowded boards
    return Math.max(n === 1 && !small ? 1 : 0, w);
  },

  /** True if at least one of the remaining pieces can still be placed. */
  AnyFits(b: Board, tray: (Shape | null)[]) {
    for (const s of tray) if (s && b.Fits(s)) return true;
    return false;
  },
};
