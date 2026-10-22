import { SysRandom } from "../../kit";

export class Move {
  constructor(readonly From: number, readonly To: number, readonly Jump: boolean) {}
  static readonly None = new Move(-1, -1, false);
  get IsNone() { return this.To < 0; }
}

const IntMin = -2147483648;

/**
 * 7x7 infection board. Cells: 0 empty, 1 player, 2 NEXUS, 3 blocked. A move either CLONES a node into an
 * adjacent empty cell or JUMPS a node two cells away; every enemy node touching the destination converts.
 */
export class Board {
  static readonly Size = 7;
  static readonly Cells = Board.Size * Board.Size;
  static readonly Empty = 0;
  static readonly Blocked = 3;

  readonly C = new Uint8Array(Board.Cells);

  static X(i: number) { return i % Board.Size; }
  static Y(i: number) { return Math.trunc(i / Board.Size); }
  static Index(x: number, y: number) { return y * Board.Size + x; }
  static Opponent(p: number) { return 3 - p; }

  Clone() {
    const b = new Board();
    b.C.set(this.C);
    return b;
  }

  static Standard(blockerPattern: number, rng: SysRandom) {
    const b = new Board(), I = Board.Index;
    b.C[I(0, 0)] = 1;
    b.C[I(6, 6)] = 1;
    b.C[I(0, 6)] = 2;
    b.C[I(6, 0)] = 2;
    // Symmetric blockers (4-fold) so neither side gets an advantage.
    const pairs = blockerPattern;
    for (let k = 0; k < pairs; k++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const x = rng.next(1, 4), y = rng.next(1, 6);
        if (x === 3 && y === 3 && k > 0) continue;
        const cells = [I(x, y), I(6 - x, 6 - y), I(6 - y, x), I(y, 6 - x)];
        let ok = true;
        for (const c of cells) if (b.C[c] !== Board.Empty) ok = false;
        if (!ok) continue;
        for (const c of cells) b.C[c] = Board.Blocked;
        break;
      }
    }
    return b;
  }

  Count(p: number) {
    let n = 0;
    for (let i = 0; i < Board.Cells; i++) if (this.C[i] === p) n++;
    return n;
  }

  EmptyCount() {
    let n = 0;
    for (let i = 0; i < Board.Cells; i++) if (this.C[i] === Board.Empty) n++;
    return n;
  }

  /** Legal moves; clones into the same cell are deduplicated (they are equivalent). */
  Moves(p: number, moves: Move[]) {
    moves.length = 0;
    const S = Board.Size;
    for (let to = 0; to < Board.Cells; to++) {
      if (this.C[to] !== Board.Empty) continue;
      const tx = Board.X(to), ty = Board.Y(to);
      let cloneFrom = -1;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = tx + dx, y = ty + dy;
          if ((dx === 0 && dy === 0) || x < 0 || y < 0 || x >= S || y >= S) continue;
          const from = Board.Index(x, y);
          if (this.C[from] !== p) continue;
          const near = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
          if (near) cloneFrom = from;
          else moves.push(new Move(from, to, true));
        }
      if (cloneFrom >= 0) moves.push(new Move(cloneFrom, to, false));
    }
  }

  HasMove(p: number) {
    const S = Board.Size;
    for (let to = 0; to < Board.Cells; to++) {
      if (this.C[to] !== Board.Empty) continue;
      const tx = Board.X(to), ty = Board.Y(to);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = tx + dx, y = ty + dy;
          if (x < 0 || y < 0 || x >= S || y >= S) continue;
          if (this.C[Board.Index(x, y)] === p) return true;
        }
    }
    return false;
  }

  /** Applies a move and returns the number of cells that converted (listed in `converted`). */
  Apply(m: Move, p: number, converted: number[] | null = null) {
    if (m.Jump) this.C[m.From] = Board.Empty;
    this.C[m.To] = p;
    const o = Board.Opponent(p), S = Board.Size;
    let n = 0;
    const tx = Board.X(m.To), ty = Board.Y(m.To);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        const i = Board.Index(x, y);
        if (this.C[i] !== o) continue;
        this.C[i] = p;
        n++;
        converted?.push(i);
      }
    return n;
  }

  /** Largest material swing (in Gain units) the side `p` could make with one move. */
  BestGain(p: number) {
    const o = Board.Opponent(p), S = Board.Size;
    let best = 0;
    for (let to = 0; to < Board.Cells; to++) {
      if (this.C[to] !== Board.Empty) continue;
      const tx = Board.X(to), ty = Board.Y(to);
      let clone = false, jump = false;
      let enemies = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = tx + dx, y = ty + dy;
          if ((dx === 0 && dy === 0) || x < 0 || y < 0 || x >= S || y >= S) continue;
          const v = this.C[Board.Index(x, y)];
          const near = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
          if (v === p) { if (near) clone = true; else jump = true; }
          else if (v === o && near) enemies++;
        }
      if (!clone && !jump) continue;
      const gain = enemies * 2 + (clone ? 1 : 0);
      if (gain > best) best = gain;
    }
    return best;
  }

  Gain(m: Move, p: number) {
    const o = Board.Opponent(p), S = Board.Size;
    let n = m.Jump ? 0 : 1;
    const tx = Board.X(m.To), ty = Board.Y(m.To);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        if (this.C[Board.Index(x, y)] === o) n += 2; // converting swings the difference by two
      }
    return n;
  }

  /** True when the game is over: board full, a side eliminated, or nobody can move. */
  Over() {
    if (this.Count(1) === 0 || this.Count(2) === 0 || this.EmptyCount() === 0) return true;
    return !this.HasMove(1) && !this.HasMove(2);
  }
}

/**
 * NEXUS, the opponent: negamax with alpha-beta pruning, capture-first move ordering and iterative deepening
 * under a time budget. Lower tiers are made human by limiting depth and mixing in deliberate mistakes.
 * (The C# could search on a worker thread; its WebGL build ran it synchronously, as this port does.)
 */
export class Nexus {
  private readonly rng: SysRandom;
  private clockStart = 0;
  private budgetMs = 0;
  private outOfTime = false;
  private quiescence = false;
  private nodes = 0;

  LastDepth = 0;
  get LastNodes() { return this.nodes; }
  /** Evaluation of the chosen move from NEXUS's point of view (piece-difference units). */
  LastScore = 0;

  constructor(seed: number) { this.rng = new SysRandom(seed); }

  private get Elapsed() { return performance.now() - this.clockStart; }

  Think(board: Board, me: number, tier: number): Move {
    this.nodes = 0;
    const moves: Move[] = [];
    board.Moves(me, moves);
    if (moves.length === 0) return Move.None;

    // Low tiers: mostly greedy with a chance of a plausible mistake.
    if (tier <= 2) {
      const blunder = tier === 1 ? 0.35 : 0.15;
      Nexus.Order(board, me, moves);
      if (this.rng.nextDouble() < blunder) return moves[this.rng.next(Math.min(moves.length, 6))];
      this.LastDepth = 1;
      return moves[0];
    }

    this.Shuffle(moves); // variety between equally good moves comes from search order, not from tie-breaking
    this.quiescence = tier >= 4;
    const maxDepth = tier === 3 ? 2 : tier === 4 ? 2 : tier === 5 ? 3 : Math.min(3 + (tier - 5), 7);
    this.budgetMs = tier <= 5 ? 5000 : 350 + (tier - 6) * 180;
    this.clockStart = performance.now();

    let best = moves[0];
    let bestScore = IntMin;
    for (let depth = 1; depth <= maxDepth; depth++) {
      this.outOfTime = false;
      let iterBest = Move.None;
      let iterScore = IntMin;
      let alpha = -100000;
      const beta = 100000;
      Nexus.Order(board, me, moves);
      // Search the previous best first.
      const bi = moves.findIndex((m) => m.From === best.From && m.To === best.To && m.Jump === best.Jump);
      if (bi > 0) { const t = moves[bi]; moves.splice(bi, 1); moves.unshift(t); }

      for (const m of moves) {
        const b = board.Clone();
        b.Apply(m, me);
        const score = -this.Negamax(b, Board.Opponent(me), depth - 1, -beta, -alpha);
        if (this.outOfTime) break;
        // Strictly greater: with fail-soft alpha-beta a pruned move returns a bound equal to alpha, not its real score.
        if (score > iterScore) {
          iterScore = score;
          iterBest = m;
        }
        alpha = Math.max(alpha, score);
      }
      if (this.outOfTime && depth > 1) break;
      if (!iterBest.IsNone) {
        best = iterBest;
        bestScore = iterScore;
        this.LastDepth = depth;
      }
      if (this.Elapsed > this.budgetMs * 0.5) break;
    }
    this.LastScore = bestScore;
    return best;
  }

  private Shuffle(moves: Move[]) {
    for (let i = moves.length - 1; i > 0; i--) {
      const j = this.rng.next(i + 1);
      [moves[i], moves[j]] = [moves[j], moves[i]];
    }
  }

  private Negamax(b: Board, p: number, depth: number, alpha: number, beta: number): number {
    this.nodes++;
    if ((this.nodes & 1023) === 0 && this.Elapsed > this.budgetMs) this.outOfTime = true;
    if (this.outOfTime) return 0;

    const o = Board.Opponent(p);
    const mine = b.Count(p), theirs = b.Count(o);
    if (mine === 0) return -1000;
    if (theirs === 0) return 1000;
    if (depth <= 0 || b.EmptyCount() === 0) return this.Evaluate(b, p, mine, theirs);

    const moves: Move[] = [];
    b.Moves(p, moves);
    if (moves.length === 0) {
      if (!b.HasMove(o)) {
        // Game over: whoever has more nodes wins; empties would be claimed by the mobile side, none here.
        const d = mine - theirs;
        return d > 0 ? 1000 + d : d < 0 ? -1000 + d : 0;
      }
      return -this.Negamax(b, o, depth - 1, -beta, -alpha); // pass
    }

    Nexus.Order(b, p, moves);
    let best = IntMin;
    for (const m of moves) {
      const c = b.Clone();
      c.Apply(m, p);
      const score = -this.Negamax(c, o, depth - 1, -beta, -alpha);
      if (this.outOfTime) return 0;
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  /**
   * Material from the side to move's view. With quiescence enabled it also credits the best immediate capture
   * available to the side to move, so a leaf reached right after our own move still "sees" the recapture.
   */
  private Evaluate(b: Board, p: number, mine: number, theirs: number) {
    const score = (mine - theirs) * 10;
    if (!this.quiescence) return score;
    return score + b.BestGain(p) * 9;
  }

  private static Order(b: Board, p: number, moves: Move[]) {
    // Stable sort by gain so a prior shuffle still breaks ties.
    const keyed = moves.map((m, i) => ({ gain: b.Gain(m, p), order: i, move: m }));
    keyed.sort((a, c) => (a.gain !== c.gain ? c.gain - a.gain : a.order - c.order));
    for (let i = 0; i < moves.length; i++) moves[i] = keyed[i].move;
  }
}
