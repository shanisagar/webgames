import { ArrowData, Dir, LevelData, clockwise, counterClockwise, dirFromDelta, dirX, dirY, encodeMask, occupiedCellCount, opposite } from "./level";
import { PuzzleBoard } from "./puzzleBoard";
import { Rng } from "./rng";
import { ShapeType, buildMask, resolveShape } from "./shapeMask";

export interface GeneratorSettings {
  width: number;
  height: number;
  shape: ShapeType;
  minLength: number;
  maxLength: number;
  /** Chance the body turns at each step while growing. */
  turnChance: number;
  /** Stop once this fraction of active cells is covered. */
  fill: number;
  /** Grow existing arrows into leftover gaps for a denser board. */
  extendTails: boolean;
  /** 0 = random placement. Higher places arrows in the exit paths of recent ones: longer blocking chains. */
  chainBias: number;
}

interface Gen {
  body: number[]; // head first
  dir: Dir;
}

/**
 * Procedural level generator.
 *
 * Arrows are placed in reverse removal order: a new arrow is only accepted if the ray in front
 * of its head is completely empty at the moment it is placed. Because every arrow placed later
 * will be removed earlier, reversing the placement order is always a valid solution, so every
 * generated level is solvable by construction (and is verified again by the solver).
 */
export function generate(settings: GeneratorSettings, seed: number): LevelData {
  const s = { ...settings };
  s.width = Math.min(Math.max(s.width, 2), 64);
  s.height = Math.min(Math.max(s.height, 2), 64);
  s.minLength = Math.max(2, s.minLength);
  s.maxLength = Math.max(s.minLength, s.maxLength);

  const rng = new Rng(seed);
  const w = s.width, h = s.height, n = w * h;
  const shape = resolveShape(s.shape, seed);
  const active = buildMask(shape, w, h, seed);
  const activeCount = active.filter(Boolean).length;

  const occ = new Int32Array(n).fill(-1);
  const maxRayOwner = new Int32Array(n).fill(-1); // highest placement index whose ray crosses this cell
  const arrows: Gen[] = [];
  let occupied = 0;
  const scratch = new Int32Array(n); // stamp buffer for "cell belongs to candidate"
  let stamp = 0;

  const fillReached = () => occupied >= activeCount * s.fill;

  // Random-walk step preferring to go straight. Returns the next cell and updates the walker.
  const walker = { x: 0, y: 0, heading: Dir.Up as Dir };
  function tryStep(free: (c: number) => boolean): number {
    let b = clockwise(walker.heading), c = counterClockwise(walker.heading);
    const a = walker.heading;
    if (rng.next(2) === 0) [b, c] = [c, b];
    const turnFirst = rng.nextDouble() < s.turnChance;
    const options = turnFirst ? [b, c, a] : [a, b, c];
    for (const opt of options) {
      const nx = walker.x + dirX(opt), ny = walker.y + dirY(opt);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const cell = ny * w + nx;
      if (!active[cell] || !free(cell)) continue;
      walker.x = nx; walker.y = ny; walker.heading = opt;
      return cell;
    }
    return -1;
  }

  // One arrow placement attempt from head cell `head` pointing `dir`.
  function tryPlace(head: number, dir: Dir): boolean {
    const dx = dirX(dir), dy = dirY(dir);
    const hx = head % w, hy = Math.floor(head / w);

    // Ray must be clear up to the board edge.
    let rx = hx + dx, ry = hy + dy;
    stamp++;
    while (rx >= 0 && ry >= 0 && rx < w && ry < h) {
      const c = ry * w + rx;
      if (occ[c] >= 0) return false;
      scratch[c] = stamp; // mark ray cells: body may not use them
      rx += dx; ry += dy;
    }

    // Second cell sits straight behind the head so the arrow tip follows the line.
    const bx = hx - dx, by = hy - dy;
    if (bx < 0 || by < 0 || bx >= w || by >= h) return false;
    const behind = by * w + bx;
    if (!active[behind] || occ[behind] >= 0) return false;

    const g: Gen = { dir, body: [head, behind] };
    scratch[head] = stamp;
    scratch[behind] = stamp;

    const target = rng.next(s.minLength, s.maxLength + 1);
    walker.x = bx; walker.y = by; walker.heading = opposite(dir); // direction the body grows in
    while (g.body.length < target) {
      const next = tryStep((c) => scratch[c] !== stamp && occ[c] < 0);
      if (next < 0) break;
      g.body.push(next);
      scratch[next] = stamp;
    }
    if (g.body.length < s.minLength) return false;

    const id = arrows.length;
    arrows.push(g);
    for (const c of g.body) occ[c] = id;
    occupied += g.body.length;

    rx = hx + dx; ry = hy + dy;
    while (rx >= 0 && ry >= 0 && rx < w && ry < h) {
      const c = ry * w + rx;
      if (maxRayOwner[c] < id) maxRayOwner[c] = id;
      rx += dx; ry += dy;
    }
    return true;
  }

  const dirs: Dir[] = [Dir.Up, Dir.Right, Dir.Down, Dir.Left];
  const keys = new Float64Array(n);

  // Places one arrow, trying cells in chain-bias order: the next arrow prefers the exit path of the one
  // just placed, so it blocks that arrow, which builds longer dependency chains (deeper, harder puzzles).
  function placeOne(): boolean {
    const candidates: number[] = [];
    for (let i = 0; i < n; i++) if (active[i] && occ[i] < 0) candidates.push(i);
    rng.shuffle(candidates);
    if (s.chainBias > 0 && arrows.length > 0) {
      const noise = arrows.length * (1 - s.chainBias) + 0.001;
      for (const c of candidates) keys[c] = (maxRayOwner[c] + 1) * s.chainBias + rng.nextDouble() * noise;
      candidates.sort((x, y) => keys[y] - keys[x]);
    }
    for (const cell of candidates) {
      rng.shuffle(dirs);
      for (const dir of dirs) if (tryPlace(cell, dir)) return true;
    }
    return false;
  }

  function placementPass() {
    while (!fillReached() && placeOne()) { /* keep placing */ }
  }

  // Tail growth: arrow i may take cell e only if no arrow removed before it (index > i)
  // needs e for its exit, and e is not on its own ray.
  function extensionPass(lengthCap: number) {
    const order = arrows.map((_, i) => i);
    let changed = true, guard = 0;
    while (changed && !fillReached() && guard++ < 64) {
      changed = false;
      rng.shuffle(order);
      for (const i of order) {
        if (fillReached()) break;
        const g = arrows[i];
        if (g.body.length >= lengthCap) continue;
        const tail = g.body[g.body.length - 1], prev = g.body[g.body.length - 2];
        const heading = dirFromDelta((tail % w) - (prev % w), Math.floor(tail / w) - Math.floor(prev / w));
        if (heading === -1) continue;
        walker.x = tail % w; walker.y = Math.floor(tail / w); walker.heading = heading;
        const next = tryStep((c) => occ[c] < 0 && maxRayOwner[c] < i);
        if (next >= 0) {
          g.body.push(next);
          occ[next] = i;
          occupied++;
          changed = true;
        }
      }
    }
  }

  for (let round = 0; round < 4 && !fillReached(); round++) {
    placementPass();
    if (!s.extendTails) break;
    // The last round may stretch arrows a little past maxLength to plug leftover gaps.
    extensionPass(round < 3 ? s.maxLength : s.maxLength + Math.floor(s.maxLength / 2));
  }

  const shuffled = arrows.slice();
  rng.shuffle(shuffled); // don't leak the solution order
  const level: LevelData = {
    width: w,
    height: h,
    shape,
    seed,
    mask: encodeMask(active),
    arrows: shuffled.map((g): ArrowData => ({ dir: g.dir, cells: g.body.slice().reverse() })), // tail → head
    depth: 0,
    difficulty: 0,
  };

  const analysis = PuzzleBoard.analyze(level);
  level.depth = analysis.depth;
  level.difficulty = PuzzleBoard.rate(level.arrows.length, analysis.depth);
  if (!analysis.solvable) console.error(`[ArrowPuzzle] Generator produced an unsolvable level (seed ${seed}).`);
  return level;
}

/** Generates several candidates and keeps the one closest to the requested constraints. */
export function generateBest(settings: GeneratorSettings, seed: number, minDepth: number, minArrows: number, attempts = 12): LevelData {
  let best: LevelData | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < Math.max(1, attempts); i++) {
    const level = generate(settings, (seed + i * 7919) | 0);
    const ok = level.depth >= minDepth && level.arrows.length >= minArrows;
    // Keep the hardest candidate: deep blocking chains, many arrows, few arrows free right away.
    const initiallyFree = PuzzleBoard.analyze(level).initiallyFree;
    const score = level.depth * 4 + level.arrows.length * 0.3 + occupiedCellCount(level) * 0.05 - initiallyFree * 0.6 + (ok ? 1000 : 0);
    if (score > bestScore) { bestScore = score; best = level; }
  }
  return best!;
}
