/**
 * Car Escape level logic (no rendering): the parking-lot grid, path checks, a solver and a deterministic level
 * generator. Levels are built by reverse play from an empty lot: each new car is only placed where its forward path
 * to the edge is clear of everything placed before it, so driving the cars out in the reverse order always works.
 * Removing a car never blocks another one, so any state reached from a generated level stays solvable.
 */

export interface CarSpec {
  id: number;
  /** Tail-most cell (lowest x for horizontal, lowest y for vertical cars). */
  x: number;
  y: number;
  len: number;
  horiz: boolean;
  /** Facing along the axis: +1 = towards +x / +y, -1 = towards -x / -y. */
  dir: 1 | -1;
  color: number;
  style: number;
}

export interface ConeSpec { x: number; y: number; kind: number }

export interface LevelSpec {
  n: number;
  w: number;
  h: number;
  cars: CarSpec[];
  cones: ConeSpec[];
  /** Move limit (0 = unlimited). */
  limit: number;
  /** Moves for three stars (one per car, no bumps). */
  par: number;
  /** Rounds of "drive out every free car at once" needed to clear the lot (difficulty measure). */
  depth: number;
  /** Cars free at the start. */
  free: number;
}

export const Empty = -1, Obstacle = -2;
export const CarColors = 8;

/** Small deterministic generator (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number) { return Math.floor(this.next() * n); }
}

/** The occupancy grid: -1 empty, -2 obstacle, otherwise a car id. */
export class Lot {
  readonly cells: Int16Array;
  constructor(readonly w: number, readonly h: number) { this.cells = new Int16Array(w * h).fill(Empty); }
  inside(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  at(x: number, y: number) { return this.cells[y * this.w + x]; }
  set(x: number, y: number, v: number) { this.cells[y * this.w + x] = v; }
  put(c: CarSpec) { for (const [x, y] of cellsOf(c)) this.set(x, y, c.id); }
  take(c: CarSpec) { for (const [x, y] of cellsOf(c)) if (this.at(x, y) === c.id) this.set(x, y, Empty); }
  clone() { const l = new Lot(this.w, this.h); l.cells.set(this.cells); return l; }
}

export function cellsOf(c: { x: number; y: number; len: number; horiz: boolean }): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < c.len; i++) out.push(c.horiz ? [c.x + i, c.y] : [c.x, c.y + i]);
  return out;
}

/** Cells from the car's end in direction `d` out to the lot edge. */
export function pathOf(lot: Lot, c: CarSpec, d: 1 | -1): [number, number][] {
  const out: [number, number][] = [];
  if (c.horiz) {
    if (d > 0) for (let x = c.x + c.len; x < lot.w; x++) out.push([x, c.y]);
    else for (let x = c.x - 1; x >= 0; x--) out.push([x, c.y]);
  } else {
    if (d > 0) for (let y = c.y + c.len; y < lot.h; y++) out.push([c.x, y]);
    else for (let y = c.y - 1; y >= 0; y--) out.push([c.x, y]);
  }
  return out;
}

/** First thing in the way when driving `c` in direction `d`: null when the way out is clear. */
export function blockerOf(lot: Lot, c: CarSpec, d: 1 | -1): { value: number; gap: number; x: number; y: number } | null {
  const p = pathOf(lot, c, d);
  for (let i = 0; i < p.length; i++) {
    const v = lot.at(p[i][0], p[i][1]);
    if (v !== Empty) return { value: v, gap: i, x: p[i][0], y: p[i][1] };
  }
  return null;
}

/**
 * Greedy solver (removal never hurts, so greedy is complete). Returns the rounds of simultaneously free cars, or
 * null when some cars can never leave. `reverse` also lets cars back out.
 */
export function solveRounds(lot: Lot, cars: CarSpec[], reverse = false): number[][] | null {
  const l = lot.clone();
  let left = cars.slice();
  const rounds: number[][] = [];
  while (left.length > 0) {
    const free = left.filter((c) => !blockerOf(l, c, c.dir) || (reverse && !blockerOf(l, c, c.dir > 0 ? -1 : 1)));
    if (free.length === 0) return null;
    for (const c of free) l.take(c);
    rounds.push(free.map((c) => c.id));
    left = left.filter((c) => !free.includes(c));
  }
  return rounds;
}

/** The best car to drive next: free forward, unblocking as many cars as possible. */
export function hintCar(lot: Lot, cars: CarSpec[]): CarSpec | null {
  let best: CarSpec | null = null, bestScore = -1;
  for (const c of cars) {
    if (blockerOf(lot, c, c.dir)) continue;
    let score = 0;
    const l = lot.clone();
    l.take(c);
    for (const o of cars) if (o !== c && blockerOf(lot, o, o.dir) && !blockerOf(l, o, o.dir)) score += 2;
    // prefer cars that sit in other cars' paths at all
    for (const o of cars) if (o !== c) for (const [x, y] of pathOf(lot, o, o.dir)) if (lot.at(x, y) === c.id) { score += 1; break; }
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

// ------------------------------------------------------------------ level ramp

interface Params { w: number; h: number; fill: number; truck: number; cones: number; picks: number; depth: number; limitSlack: number }

export function paramsFor(n: number): Params {
  const sizes: [number, number, number][] = [
    // up to level, w, h
    [2, 4, 5], [4, 5, 5], [7, 5, 6], [12, 6, 7], [20, 6, 8], [35, 7, 8], [60, 7, 9], [Infinity, 8, 9],
  ];
  let w = 8, h = 9;
  for (const [upTo, sw, sh] of sizes) if (n <= upTo) { w = sw; h = sh; break; }
  // fill: share of cells covered by cars; packed every 5th level, a breather every 7th
  let fill = Math.min(0.8, 0.42 + n * 0.014);
  if (n % 5 === 0) fill += 0.05;
  if (n % 7 === 3) fill -= 0.06;
  fill = Math.min(0.86, fill);
  const truck = n < 3 ? 0 : Math.min(0.36, 0.14 + n * 0.008);
  let cones = n < 5 ? 0 : Math.min(5, 1 + Math.floor((n - 5) / 6));
  if (n >= 10 && n % 10 === 0) cones++;
  const picks = Math.min(10, 2 + Math.floor(n / 3));
  const depth = Math.min(9, 2 + Math.floor(n / 5));
  const limitSlack = n < 8 ? -1 : Math.max(2, 6 - Math.floor((n - 8) / 10));
  return { w, h, fill, truck, cones, picks, depth, limitSlack };
}

function attempt(n: number, p: Params, seed: number): LevelSpec {
  const rng = new Rng(seed);
  const lot = new Lot(p.w, p.h);
  const cones: ConeSpec[] = [];
  // obstacles first, away from the outer ring on bigger lots so exit lanes stay interesting
  for (let i = 0; i < p.cones * 20 && cones.length < p.cones; i++) {
    const x = rng.int(p.w), y = rng.int(p.h);
    if (lot.at(x, y) !== Empty) continue;
    let near = false;
    for (const c of cones) if (Math.abs(c.x - x) + Math.abs(c.y - y) < 2) near = true;
    if (near) continue;
    lot.set(x, y, Obstacle);
    cones.push({ x, y, kind: rng.int(2) });
  }
  const cars: CarSpec[] = [];
  const target = Math.round(p.w * p.h * p.fill);
  let covered = 0, failures = 0;
  const colorBag: number[] = [];
  const nextColor = (avoid: number) => {
    if (colorBag.length === 0) { for (let i = 0; i < CarColors; i++) colorBag.push(i); }
    let k = rng.int(colorBag.length);
    if (colorBag[k] === avoid && colorBag.length > 1) k = (k + 1) % colorBag.length;
    return colorBag.splice(k, 1)[0];
  };
  while (covered < target && failures < 60) {
    let best: CarSpec | null = null, bestScore = -1e9;
    for (let k = 0, found = 0; k < 160 && found < p.picks; k++) {
      const len = rng.next() < p.truck ? 3 : 2;
      const horiz = rng.next() < 0.5;
      const x = rng.int(horiz ? p.w - len + 1 : p.w), y = rng.int(horiz ? p.h : p.h - len + 1);
      const c: CarSpec = { id: cars.length, x, y, len, horiz, dir: rng.next() < 0.5 ? 1 : -1, color: 0, style: 0 };
      let ok = true;
      for (const [cx, cy] of cellsOf(c)) if (lot.at(cx, cy) !== Empty) { ok = false; break; }
      if (!ok) continue;
      if (blockerOf(lot, c, c.dir)) {
        // try facing the other way before giving up on this spot
        c.dir = c.dir > 0 ? -1 : 1;
        if (blockerOf(lot, c, c.dir)) continue;
      }
      found++;
      // score: how many earlier cars this one will be in the way of, plus neighbours (packing)
      let score = rng.next() * 1.5;
      const mine = new Set(cellsOf(c).map(([a, b]) => a + b * 64));
      for (const o of cars) for (const [px, py] of pathOf(lot, o, o.dir)) if (mine.has(px + py * 64)) { score += 3; break; }
      for (const [cx, cy] of cellsOf(c))
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ax = cx + dx, ay = cy + dy;
          if (!lot.inside(ax, ay)) score += 0.15;
          else if (lot.at(ax, ay) !== Empty && lot.at(ax, ay) !== c.id) score += 0.35;
        }
      // a car facing straight out of the lot right at the edge is a giveaway: keep a few only
      if (pathOf(lot, c, c.dir).length === 0) score -= 1.2;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) { failures++; continue; }
    best.color = nextColor(cars.length > 0 ? cars[cars.length - 1].color : -1);
    best.style = rng.int(2);
    lot.put(best);
    cars.push(best);
    covered += best.len;
  }
  const rounds = solveRounds(lot, cars) ?? [];
  const slack = p.limitSlack;
  return {
    n, w: p.w, h: p.h, cars, cones,
    limit: slack < 0 ? 0 : cars.length + slack,
    par: cars.length,
    depth: rounds.length,
    free: rounds.length > 0 ? rounds[0].length : 0,
  };
}

const cache = new Map<number, LevelSpec>();

/** Level `n` (1-based): deterministic, always solvable. */
export function generateLevel(n: number): LevelSpec {
  n = Math.max(1, Math.floor(n));
  const hit = cache.get(n);
  if (hit) return clone(hit);
  const p = paramsFor(n);
  let best: LevelSpec | null = null, bestScore = -1e9;
  const tries = n <= 2 ? 3 : 6;
  for (let i = 0; i < tries; i++) {
    const l = attempt(n, p, n * 7919 + i * 104729 + 17);
    // aim for the target depth; prefer fuller lots and few cars free at the start
    const score = -Math.abs(l.depth - p.depth) * 3 + l.cars.reduce((s, c) => s + c.len, 0) * 0.2 - l.free * 0.5;
    if (score > bestScore) { bestScore = score; best = l; }
  }
  if (n === 1) best = tutorial();
  cache.set(n, best!);
  return clone(best!);
}

/** Level 1 is a hand-placed tutorial: one free car, then the cars it was blocking. */
function tutorial(): LevelSpec {
  const cars: CarSpec[] = [
    { id: 0, x: 1, y: 2, len: 2, horiz: true, dir: 1, color: 2, style: 1 },
    { id: 1, x: 3, y: 1, len: 2, horiz: false, dir: 1, color: 1, style: 0 },
    { id: 2, x: 0, y: 0, len: 2, horiz: false, dir: 1, color: 0, style: 0 },
    { id: 3, x: 1, y: 4, len: 3, horiz: true, dir: -1, color: 3, style: 0 },
  ];
  const lot = new Lot(4, 5);
  for (const c of cars) lot.put(c);
  const rounds = solveRounds(lot, cars) ?? [];
  return { n: 1, w: 4, h: 5, cars, cones: [], limit: 0, par: cars.length, depth: rounds.length, free: rounds[0]?.length ?? 0 };
}

function clone(l: LevelSpec): LevelSpec {
  return { ...l, cars: l.cars.map((c) => ({ ...c })), cones: l.cones.map((c) => ({ ...c })) };
}
