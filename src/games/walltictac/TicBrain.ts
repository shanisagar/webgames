/**
 * Tic-tac-toe rules and the computer's brain: full minimax (the board is tiny), with skill-based mistakes.
 * Board cells 0..8, row-major from the top-left; 0 = empty, 1 = X (player 1), 2 = O (player 2). No kit imports.
 */

export const Lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

/** The winning line (cell indices) for a mark, or null. */
export function winLine(b: number[], mark: number) {
  for (const l of Lines) if (b[l[0]] === mark && b[l[1]] === mark && b[l[2]] === mark) return l;
  return null;
}

export const full = (b: number[]) => b.every((c) => c !== 0);

/** Minimax value for `mark` to move (+10 - depth = win, 0 draw, negative loss). */
function minimax(b: number[], mark: number, me: number, depth: number): number {
  const other = mark === 1 ? 2 : 1;
  if (winLine(b, other)) return other === me ? 10 - depth : depth - 10;
  if (full(b)) return 0;
  let best = mark === me ? -99 : 99;
  for (let i = 0; i < 9; i++) {
    if (b[i] !== 0) continue;
    b[i] = mark;
    const v = minimax(b, other, me, depth + 1);
    b[i] = 0;
    best = mark === me ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

/** Scores of every empty cell for `mark` to move. */
export function scoreMoves(b: number[], mark: number) {
  const other = mark === 1 ? 2 : 1;
  const out: { cell: number; score: number }[] = [];
  for (let i = 0; i < 9; i++) {
    if (b[i] !== 0) continue;
    b[i] = mark;
    out.push({ cell: i, score: minimax(b, other, mark, 1) });
    b[i] = 0;
  }
  return out;
}

/** Slip chance per level (easy / medium / hard): how often it plays a non-best square. */
export const Slip = [0.45, 0.2, 0];

/** The computer's chosen square. It never misses an immediate win; on easy it may miss a block. */
export function choose(b: number[], mark: number, level: number, rand: () => number) {
  const moves = scoreMoves(b, mark);
  if (moves.length === 0) return -1;
  const best = Math.max(...moves.map((m) => m.score));
  const top = moves.filter((m) => m.score === best);
  const wins = moves.filter((m) => m.score >= 9);
  if (wins.length > 0) return wins[Math.floor(rand() * wins.length)].cell;
  if (rand() < Slip[level]) {
    // a "human" slip: any square (medium only slips into squares that don't lose at once)
    const pool = level === 0 ? moves : moves.filter((m) => m.score > -9);
    const pick = pool.length ? pool : moves;
    return pick[Math.floor(rand() * pick.length)].cell;
  }
  // prefer the centre and corners among equals on an empty board
  return top[Math.floor(rand() * top.length)].cell;
}
