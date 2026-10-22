import { Mathf, SysRandom } from "../../kit";

/**
 * Sudoku generator and solver. Builds a random full grid by backtracking, then removes clues in random order while
 * the puzzle keeps exactly one solution. Runs on the main thread with a work budget so even Expert puzzles are made
 * in a fraction of a second. (Port of SudokuLogic.cs.)
 */
const Clues = [40, 33, 28, 24];

export const SudokuLogic = {
  Levels: ["EASY", "MEDIUM", "HARD", "EXPERT"],

  Generate(difficulty: number, rng: SysRandom, puzzle: number[], solution: number[]) {
    const grid = new Array<number>(81).fill(0);
    fillGrid(grid, 0, rng);
    for (let i = 0; i < 81; i++) { solution[i] = grid[i]; puzzle[i] = grid[i]; }

    const target = Clues[Mathf.clamp(difficulty, 0, 3)];
    const order: number[] = [];
    for (let i = 0; i < 81; i++) order.push(i);
    for (let i = 80; i > 0; i--) { const k = rng.next(i + 1); const t = order[i]; order[i] = order[k]; order[k] = t; }

    let clues = 81;
    let budget = 400000; // node budget for uniqueness checks
    for (const cell of order) {
      if (clues <= target) break;
      const keep = puzzle[cell];
      puzzle[cell] = 0;
      const work = puzzle.slice();
      const nodes = { n: 0 };
      const count = countSolutions(work, 2, nodes, budget);
      budget -= nodes.n;
      if (count !== 1) puzzle[cell] = keep;
      else clues--;
      if (budget <= 0) break;
    }
  },

  Allowed(g: number[], idx: number, v: number) {
    const r = Math.trunc(idx / 9), c = idx % 9;
    for (let i = 0; i < 9; i++) {
      if (g[r * 9 + i] === v && r * 9 + i !== idx) return false;
      if (g[i * 9 + c] === v && i * 9 + c !== idx) return false;
    }
    const br = Math.trunc(r / 3) * 3, bc = Math.trunc(c / 3) * 3;
    for (let y = br; y < br + 3; y++)
      for (let x = bc; x < bc + 3; x++)
        if (g[y * 9 + x] === v && y * 9 + x !== idx) return false;
    return true;
  },
};

function fillGrid(g: number[], idx: number, rng: SysRandom): boolean {
  if (idx === 81) return true;
  if (g[idx] !== 0) return fillGrid(g, idx + 1, rng);
  const start = rng.next(9);
  for (let k = 0; k < 9; k++) {
    const v = ((start + k) % 9) + 1;
    if (!SudokuLogic.Allowed(g, idx, v)) continue;
    g[idx] = v;
    if (fillGrid(g, idx + 1, rng)) return true;
    g[idx] = 0;
  }
  return false;
}

/** Counts solutions up to `limit` (most-constrained-cell backtracking). */
function countSolutions(g: number[], limit: number, nodes: { n: number }, budget: number): number {
  if (nodes.n++ > budget) return 2; // treat as "not unique" when out of budget
  let best = -1, bestCount = 10, bestMask = 0;
  for (let i = 0; i < 81; i++) {
    if (g[i] !== 0) continue;
    let mask = 0, count = 0;
    for (let v = 1; v <= 9; v++)
      if (SudokuLogic.Allowed(g, i, v)) { mask |= 1 << v; count++; }
    if (count === 0) return 0;
    if (count < bestCount) { bestCount = count; best = i; bestMask = mask; if (count === 1) break; }
  }
  if (best < 0) return 1;
  let total = 0;
  for (let v = 1; v <= 9; v++) {
    if ((bestMask & (1 << v)) === 0) continue;
    g[best] = v;
    total += countSolutions(g, limit - total, nodes, budget);
    g[best] = 0;
    if (total >= limit) break;
  }
  return total;
}
