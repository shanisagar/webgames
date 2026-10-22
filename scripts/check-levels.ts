// Sanity check for the ported puzzle logic: every authored level and a run of generated ones must be solvable.
import { getLevel } from "../src/games/arrowpuzzle/core/levels";
import { PuzzleBoard } from "../src/games/arrowpuzzle/core/puzzleBoard";

let bad = 0;
const t0 = performance.now();
for (let n = 1; n <= 160; n++) {
  const t = performance.now();
  const level = getLevel(n);
  const a = PuzzleBoard.analyze(level);
  const ms = performance.now() - t;
  if (!a.solvable) { bad++; console.log(`level ${n}: UNSOLVABLE`); }
  if (n <= 3 || n === 100 || n > 100 && n % 10 === 1 || ms > 300)
    console.log(`level ${n}: ${level.width}x${level.height} arrows=${level.arrows.length} depth=${a.depth} stored=${level.depth} ${ms.toFixed(0)}ms`);
}
console.log(bad ? `${bad} unsolvable levels` : "all 160 levels solvable", `(${((performance.now() - t0) / 1000).toFixed(1)}s total)`);
process.exit(bad ? 1 : 0);
