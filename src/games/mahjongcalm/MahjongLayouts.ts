import { SysRandom } from "../../kit/math";

/**
 * Board logic for Mahjong Calm: classic layouts, the tile set, the "free tile" rule and the always-solvable deal.
 * Positions are in half-tile units (x right, y down, z up), like the classic layout files: a tile covers 2×2 half
 * cells, so x = 2·column and y = 2·row, and odd values sit half a tile over.
 * No rendering here (the solver tests run it in Node).
 */

export interface Pos { x: number; y: number; z: number }

export interface Layout { Name: string; Positions: Pos[] }

// ------------------------------------------------------------------ tile set

/** Faces: 0-8 dots, 9-17 bamboo, 18-26 characters, 27-30 winds (E S W N), 31-33 dragons (red, green, white),
 * 34-37 flowers, 38-41 seasons. */
export const Faces = 42;
export const FlowerKey = 100, SeasonKey = 101;

/** Tiles match when their keys are equal: any flower matches any flower, any season any season. */
export function MatchKey(face: number) { return face < 34 ? face : face < 38 ? FlowerKey : SeasonKey; }

export function FaceName(face: number) {
  if (face < 9) return `${face + 1} DOTS`;
  if (face < 18) return `${face - 8} BAMBOO`;
  if (face < 27) return `${face - 17} CHARACTERS`;
  if (face < 31) return ["EAST", "SOUTH", "WEST", "NORTH"][face - 27] + " WIND";
  if (face < 34) return ["RED", "GREEN", "WHITE"][face - 31] + " DRAGON";
  if (face < 38) return "FLOWER";
  return "SEASON";
}

// ------------------------------------------------------------------ layouts

/** One layer drawn as text: '#' = a tile at that column/row, shifted by (dx, dy) half units. */
function grid(z: number, rows: string[], dx = 0, dy = 0): Pos[] {
  const out: Pos[] = [];
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === "#") out.push({ x: dx + i * 2, y: dy + j * 2, z }); });
  return out;
}

function block(z: number, x0: number, y0: number, cols: number, rows: number): Pos[] {
  const out: Pos[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({ x: x0 + i * 2, y: y0 + j * 2, z });
  return out;
}

const P = (x: number, y: number, z: number): Pos => ({ x, y, z });

function make(name: string, ...parts: Pos[][]): Layout {
  const all = ([] as Pos[]).concat(...parts);
  // normalise so the smallest x / y is 0
  let mx = Infinity, my = Infinity;
  for (const p of all) { mx = Math.min(mx, p.x); my = Math.min(my, p.y); }
  return { Name: name, Positions: all.map((p) => P(p.x - mx, p.y - my, p.z)) };
}

export const Layouts: Layout[] = [
  // 0 · 36
  make("PYRAMID",
    block(0, 0, 0, 6, 4), [P(-2, 3, 0), P(12, 3, 0)],
    block(1, 2, 2, 4, 2),
    [P(4, 3, 2), P(6, 3, 2)]),
  // 1 · 48
  make("LOTUS CROSS",
    grid(0, ["...##...", "...##...", "########", "########", "...##...", "...##..."]),
    grid(1, ["........", "...##...", ".######.", ".######.", "...##..."]),
    grid(2, ["........", "........", "..####..", "..####.."])),
  // 2 · 64
  make("BUTTERFLY",
    grid(0, ["##....##", "###..###", "########", "########", "###..###", "##....##"]),
    grid(1, [".#....#.", ".##..##.", ".######.", ".######.", ".##..##.", ".#....#."]),
    grid(2, ["........", "........", "...##...", "...##..."])),
  // 3 · 72
  make("FORTRESS",
    block(0, 0, 0, 8, 6),
    grid(1, ["##....##", "##....##", "...##...", "...##...", "##....##", "##....##"]),
    [P(1, 1, 2), P(13, 1, 2), P(1, 9, 2), P(13, 9, 2)]),
  // 4 · 80
  make("PEONY",
    grid(0, ["..####..", ".######.", "########", "########", "########", ".######.", "..####.."]),
    grid(1, ["........", "..####..", ".######.", ".######.", ".######.", "..####.."]),
    grid(2, ["........", "........", "...##...", "..####..", "...##..."]),
    [P(6, 6, 3), P(8, 6, 3)]),
  // 5 · 88
  make("ARENA",
    block(0, 0, 0, 10, 5),
    grid(1, ["##########", "#..####..#", "#..####..#", "#..####..#", "##########"])),
  // 6 · 108
  make("PAGODA",
    block(0, 0, 0, 8, 8),
    block(1, 2, 2, 6, 6),
    block(2, 6, 4, 2, 4)),
  // 7 · 124
  make("CASTLE",
    block(0, 0, 0, 10, 7),
    grid(1, ["##########", "#........#", "#..####..#", "#..####..#", "#..####..#", "#........#", "##########"]),
    [P(0, 0, 2), P(18, 0, 2), P(0, 12, 2), P(18, 12, 2)],
    block(2, 8, 4, 2, 3),
    [P(9, 5, 3), P(9, 7, 3)]),
  // 8 · 144
  make("TURTLE",
    grid(0, [
      ".############.",
      "...########...",
      "..##########..",
      ".############.",
      ".############.",
      "..##########..",
      "...########...",
      ".############.",
    ]),
    [P(0, 7, 0), P(26, 7, 0), P(28, 7, 0)],
    block(1, 8, 2, 6, 6),
    block(2, 10, 4, 4, 4),
    block(3, 12, 6, 2, 2),
    [P(13, 7, 4)]),
  // 9 · 144
  make("TOWER",
    block(0, 0, 0, 8, 9),
    block(1, 2, 2, 6, 7),
    block(2, 4, 4, 4, 5),
    block(3, 6, 6, 2, 3),
    [P(7, 7, 4), P(7, 9, 4), P(-2, 8, 0), P(16, 8, 0)]),
  // 10 · 144
  make("TWIN PEAKS",
    block(0, 0, 0, 12, 6),
    [P(-2, 4, 0), P(-2, 6, 0), P(24, 4, 0), P(24, 6, 0)],
    block(0, 6, 12, 6, 1),
    block(1, 2, 2, 4, 4), block(1, 14, 2, 4, 4), block(1, 10, 4, 2, 2),
    block(2, 4, 2, 2, 4), block(2, 16, 2, 2, 4),
    block(3, 4, 4, 2, 2), block(3, 16, 4, 2, 2),
    [P(5, 5, 4), P(17, 5, 4)]),
  // 11 · 120
  make("DRAGON GATE",
    grid(0, ["##.######.##", "############", "############", "############", "##.######.##"]),
    grid(1, ["#..........#", "#..######..#", "#..######..#", "#..######..#", "#..........#"]),
    grid(2, ["............", "....####....", "....####....", "....####...."]),
    grid(3, ["............", "............", ".....##.....", "............"])),
];

/** Fixed order for the first ten levels, then a calm rotation of the medium and large boards. */
const Intro = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const Cycle = [3, 6, 8, 4, 11, 9, 5, 7, 10, 2];

export function LayoutFor(level: number): Layout {
  const i = level <= Intro.length ? Intro[level - 1] : Cycle[(level - Intro.length - 1) % Cycle.length];
  return Layouts[Math.max(0, i)];
}

// ------------------------------------------------------------------ neighbours / free rule

/** Precomputed blockers for every position of a board. */
export class Board {
  readonly n: number;
  readonly above: number[][] = [];
  readonly left: number[][] = [];
  readonly right: number[][] = [];

  constructor(readonly pos: Pos[]) {
    this.n = pos.length;
    for (let i = 0; i < this.n; i++) { this.above.push([]); this.left.push([]); this.right.push([]); }
    for (let i = 0; i < this.n; i++) {
      const a = pos[i];
      for (let j = 0; j < this.n; j++) {
        if (i === j) continue;
        const b = pos[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dy) >= 2) continue;
        if (b.z > a.z && Math.abs(dx) < 2) this.above[i].push(j);
        else if (b.z === a.z && dx === -2) this.left[i].push(j);
        else if (b.z === a.z && dx === 2) this.right[i].push(j);
      }
    }
  }

  /** A tile is free when nothing lies on it and its left or right side is open. */
  isFree(i: number, on: ArrayLike<boolean>) {
    for (const j of this.above[i]) if (on[j]) return false;
    let l = true, r = true;
    for (const j of this.left[i]) if (on[j]) { l = false; break; }
    for (const j of this.right[i]) if (on[j]) { r = false; break; }
    return l || r;
  }

  freeList(on: ArrayLike<boolean>) {
    const out: number[] = [];
    for (let i = 0; i < this.n; i++) if (on[i] && this.isFree(i, on)) out.push(i);
    return out;
  }

  /** Pick weight for the dealing walk: higher tiles are taken first more often (fewer dead ends). */
  weight(i: number) { return this.pos[i].z * 3 + 1; }
}

// ------------------------------------------------------------------ dealing

/** A pair of faces that will be placed together (the two faces always match). */
type PairUnit = [number, number];

/** The full 144-tile set as 72 pair units, flowers and seasons paired within their group. */
function allPairUnits(): PairUnit[] {
  const out: PairUnit[] = [];
  for (let f = 0; f < 34; f++) { out.push([f, f]); out.push([f, f]); }
  out.push([34, 35], [36, 37], [38, 39], [40, 41]);
  return out;
}

/**
 * Picks `pairs` pair units for a board. Smaller boards use fewer kinds (each kind twice = all four tiles), which
 * keeps early levels friendly; the full board uses the whole set.
 */
function choosePairs(pairs: number, rng: SysRandom): PairUnit[] {
  const units = allPairUnits();
  if (pairs >= units.length) return units.slice(0, pairs);
  // group by kind: 34 suits/honours + flowers + seasons
  const kinds: PairUnit[][] = [];
  for (let f = 0; f < 34; f++) kinds.push([[f, f], [f, f]]);
  kinds.push([[34, 35], [36, 37]], [[38, 39], [40, 41]]);
  shuffle(kinds, rng);
  const out: PairUnit[] = [];
  for (const k of kinds) {
    for (const u of k) if (out.length < pairs) out.push(u);
    if (out.length >= pairs) break;
  }
  return out;
}

export function shuffle<T>(a: T[], rng: SysRandom) {
  for (let i = a.length - 1; i > 0; i--) { const k = rng.next(i + 1); const t = a[i]; a[i] = a[k]; a[k] = t; }
  return a;
}

/**
 * Removal order that empties the given positions two free tiles at a time (null when the random walk got stuck).
 * Playing a deal forward in this order is always legal, so giving each removed pair matching faces makes the deal
 * solvable: this is the classic "reverse placement" construction, run as removal from the full board.
 */
function removalOrder(board: Board, alive: boolean[], rng: SysRandom): [number, number][] | null {
  const on = alive.slice();
  let left = on.filter((x) => x).length;
  const order: [number, number][] = [];
  while (left > 0) {
    const free = board.freeList(on);
    if (free.length < 2) return null;
    // prefer high tiles and tiles in long rows (they unlock the most), with plenty of randomness
    const a = weightedPick(free, board, rng, -1);
    const b = weightedPick(free, board, rng, a);
    on[a] = on[b] = false;
    left -= 2;
    order.push([a, b]);
  }
  return order;
}

function weightedPick(free: number[], board: Board, rng: SysRandom, not: number) {
  let total = 0;
  for (const i of free) if (i !== not) total += board.weight(i);
  let r = rng.nextDouble() * total;
  for (const i of free) {
    if (i === not) continue;
    r -= board.weight(i);
    if (r <= 0) return i;
  }
  for (let k = free.length - 1; k >= 0; k--) if (free[k] !== not) return free[k];
  return free[0];
}

export interface Deal {
  /** Face per position. */
  faces: number[];
  /** A known solution (pairs of position indices, in play order). */
  solution: [number, number][];
}

/** Deterministic solvable deal for a layout (same seed → same deal). */
export function DealLayout(board: Board, seed: number): Deal {
  const rng = new SysRandom(seed);
  const alive = new Array<boolean>(board.n).fill(true);
  const units = choosePairs(board.n >> 1, rng);
  for (let attempt = 0; attempt < 400; attempt++) {
    const order = removalOrder(board, alive, rng);
    if (!order) continue;
    return { faces: assign(board.n, order, shuffle(units.slice(), rng), rng), solution: order };
  }
  throw new Error("could not deal layout");
}

function assign(n: number, order: [number, number][], units: PairUnit[], rng: SysRandom) {
  const faces = new Array<number>(n).fill(-1);
  order.forEach(([a, b], k) => {
    const u = units[k];
    const flip = rng.nextDouble() < 0.5;
    faces[a] = flip ? u[1] : u[0];
    faces[b] = flip ? u[0] : u[1];
  });
  return faces;
}

/**
 * Re-deals the faces of the tiles still on the board into a solvable arrangement of the same positions. Returns the
 * new faces (indexed like the board) plus a solution, or null when these positions can't be emptied at all
 * (e.g. two tiles stacked on each other), in which case the caller moves tiles too.
 */
export function Redeal(board: Board, alive: boolean[], faces: number[], rng: SysRandom): Deal | null {
  const units = pairUp(alive, faces, rng);
  for (let attempt = 0; attempt < 300; attempt++) {
    const order = removalOrder(board, alive, rng);
    if (!order) continue;
    const out = faces.slice();
    const placed = assign(board.n, order, shuffle(units.slice(), rng), rng);
    for (let i = 0; i < board.n; i++) if (alive[i]) out[i] = placed[i];
    return { faces: out, solution: order };
  }
  return null;
}

/** Groups the remaining faces into matching pairs (their keys always come in even counts). */
function pairUp(alive: boolean[], faces: number[], rng: SysRandom): PairUnit[] {
  const byKey = new Map<number, number[]>();
  for (let i = 0; i < faces.length; i++) {
    if (!alive[i]) continue;
    const k = MatchKey(faces[i]);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(faces[i]);
  }
  const units: PairUnit[] = [];
  for (const list of byKey.values()) {
    shuffle(list, rng);
    for (let i = 0; i + 1 < list.length; i += 2) units.push([list[i], list[i + 1]]);
  }
  return units;
}

/**
 * Fallback positions for a re-deal that can't keep the old ones: up to `perRow` tiles per row on the ground layer,
 * centred on the old board. Flat rows always have two free ends, so any even count can be emptied.
 */
export function FlatPositions(count: number, centre: { x: number; y: number }, perRow = 6): Pos[] {
  const rows = Math.ceil(count / perRow);
  const out: Pos[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(perRow, count - r * perRow);
    for (let i = 0; i < inRow; i++)
      out.push(P(Math.round(centre.x - (inRow - 1) + i * 2), Math.round(centre.y - (rows - 1) + r * 2), 0));
  }
  return out;
}

// ------------------------------------------------------------------ moves

/** All matching pairs of free tiles (indices into the board). */
export function FreePairs(board: Board, on: boolean[], faces: number[]) {
  const free = board.freeList(on);
  const pairs: [number, number][] = [];
  for (let i = 0; i < free.length; i++)
    for (let j = i + 1; j < free.length; j++)
      if (MatchKey(faces[free[i]]) === MatchKey(faces[free[j]])) pairs.push([free[i], free[j]]);
  return pairs;
}

/**
 * True if the remaining board can still be cleared. Exact search is too slow for 144 tiles, so this runs a handful
 * of randomized greedy playouts that prefer "safe" moves (all four of a kind free, or the last two of a kind).
 */
export function LikelySolvable(board: Board, on: boolean[], faces: number[], rng: SysRandom, tries = 12) {
  for (let t = 0; t < tries; t++) if (Playout(board, on, faces, rng)) return true;
  return false;
}

/** One greedy playout; returns the first move of a successful playout (or true when the board is empty). */
export function Playout(board: Board, on0: boolean[], faces: number[], rng: SysRandom): [number, number] | true | null {
  const on = on0.slice();
  let first: [number, number] | null = null;
  let left = on.filter((x) => x).length;
  while (left > 0) {
    const pairs = FreePairs(board, on, faces);
    if (pairs.length === 0) return null;
    const pick = BestPair(board, on, faces, pairs, rng);
    if (!first) first = pick;
    on[pick[0]] = on[pick[1]] = false;
    left -= 2;
  }
  return first ?? true;
}

/** Ranks candidate pairs: prefer safe matches, tiles that free others, and higher layers. */
export function BestPair(board: Board, on: boolean[], faces: number[], pairs: [number, number][], rng: SysRandom | null) {
  let best = pairs[0], bestScore = -Infinity;
  const remaining = new Map<number, number>(), freeKind = new Map<number, number>();
  const holds = new Array<number>(board.n).fill(0);
  for (let j = 0; j < board.n; j++) {
    if (!on[j]) continue;
    const k = MatchKey(faces[j]);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
    for (const i of board.above[j]) if (on[i]) holds[i]++;
  }
  for (const q of pairs) { const k = MatchKey(faces[q[0]]); freeKind.set(k, (freeKind.get(k) ?? 0) + 1); }
  for (const p of pairs) {
    const k = MatchKey(faces[p[0]]);
    let score = 0;
    const rem = remaining.get(k) ?? 0;
    if (rem === 2) score += 6; // last two of their kind: always safe
    else if (rem === 4 && (freeKind.get(k) ?? 0) >= 6) score += 6; // all four free: always safe
    for (const i of p) {
      score += board.pos[i].z * 1.5 + holds[i] * 1.2;
      for (const j of board.left[i]) if (on[j]) score += 0.5;
      for (const j of board.right[i]) if (on[j]) score += 0.5;
    }
    if (rng) score += rng.nextDouble() * 3;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/**
 * The hint: the best-ranked free pair whose removal still leaves a clearable board (checked with greedy playouts),
 * so following hints never walks into a dead end when a way out exists. Null when there is no free pair.
 */
export function HintPair(board: Board, on: boolean[], faces: number[], rng: SysRandom): [number, number] | null {
  let pairs = FreePairs(board, on, faces);
  if (pairs.length === 0) return null;
  const first = BestPair(board, on, faces, pairs, null);
  for (let c = 0; c < 5 && pairs.length > 0; c++) {
    const p = BestPair(board, on, faces, pairs, null);
    const after = on.slice();
    after[p[0]] = after[p[1]] = false;
    if (!after.some((x) => x) || LikelySolvable(board, after, faces, rng, 3)) return p;
    pairs = pairs.filter((q) => q !== p);
  }
  return first;
}
