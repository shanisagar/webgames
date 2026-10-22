import { SysRandom } from "../../kit";

/**
 * Procedural track for DASH RUSH. The track is a grid of rows (ROW world units long) × 3 lanes. Hand-made patterns
 * (grouped in difficulty tiers) are mirrored at random and appended with free rows in between. Every pattern is
 * validated before it is accepted: from EVERY state a surviving player can be in when the pattern starts, there must
 * be a path through it (lane switches need room, jumps and drops need landing space, ramps lead onto trains).
 * Coins follow one of those paths, so the coin trail always shows a safe line.
 */

export const ROW = 4;
export const LANES = 3;

export const enum Cell { Empty = 0, Jump = 1, Roll = 2, Block = 3, Train = 4, Ramp = 5, Moving = 6 }

/** How much faster than the player (relative) an oncoming train moves: its front is at meet·(1+r) − r·playerZ. */
export const MovingRatio = 0.6;

export const enum Kind { Barrier, Bar, Block, Train, Ramp, Coin, Power }
export const enum Power { Magnet, Double, Boost, Shield }

/** A spawned track object (plain data; the game attaches pooled visuals). */
export interface Spawn {
  kind: Kind;
  lane: number;
  /** Start / end along the track (world units). For moving trains z0 is the meeting point. */
  z0: number;
  z1: number;
  y: number;
  /** Power type, train livery. */
  sub: number;
  moving: boolean;
  /** Moving trains: physical length. */
  len: number;
  /** Train has a ramp in front (the ramp spawn is separate). */
  ramp: boolean;
}

interface Pattern { rows: string[]; tier: number; weight: number; name: string }

// Rows are listed in the order the runner meets them. Lanes: left, centre, right.
// . free   j low barrier (jump)   r high bar (roll)   b blocker (switch lanes)
// T train (switch lanes, or arrive on top via a ramp)   ^ ramp up onto a train   M/m oncoming train (meets you here)
const PATTERNS: Pattern[] = [
  // ---- tier 0: single obstacles, lots of room
  { name: "hurdle-l", tier: 0, weight: 3, rows: ["j..", "...", "...", ".j.", "...", "...", "..j"] },
  { name: "bar-l", tier: 0, weight: 3, rows: ["r..", "...", "...", "...", "..r"] },
  { name: "block-pair", tier: 0, weight: 3, rows: ["bb.", "...", "...", "...", ".bb"] },
  { name: "jump-all", tier: 0, weight: 2, rows: ["jjj"] },
  { name: "roll-all", tier: 0, weight: 2, rows: ["rrr"] },
  { name: "gate", tier: 0, weight: 2, rows: ["b.b", "...", "...", "jj."] },
  { name: "mixed", tier: 0, weight: 2, rows: [".b.", "...", "...", "r.j"] },
  { name: "short-train", tier: 0, weight: 2, rows: ["T..", "T..", "T..", "...", "...", "..b"] },
  // ---- tier 1: trains, ramps, combos
  { name: "train-side", tier: 1, weight: 3, rows: ["T..", "T..", "T..", "T.j", "T..", "T..", "..."] },
  { name: "corridor", tier: 1, weight: 3, rows: ["T.T", "T.T", "TjT", "T.T", "T.T", "TrT", "T.T", "..."] },
  { name: "ramp-over", tier: 1, weight: 3, rows: [".^.", ".^.", "TTT", "TTT", "TTT", "TTT", "TTT", "...", "...", "...", "..."] },
  { name: "ramp-side", tier: 1, weight: 3, rows: ["^T.", "^T.", "TT.", "TT.", "TT.", "TT.", "T..", "..."] },
  { name: "zigzag", tier: 1, weight: 2, rows: ["b..", "...", "...", "..b", "...", "...", "b.."] },
  { name: "rolls", tier: 1, weight: 2, rows: ["r.b", "...", "...", "b.r", "...", "...", "rr."] },
  { name: "train-pair", tier: 1, weight: 2, rows: ["TT.", "TT.", "TT.", "TT.", "...", "...", ".TT", ".TT", ".TT", ".TT"] },
  { name: "jump-roll", tier: 1, weight: 2, rows: ["jjr", "...", "...", "...", "rjj"] },
  // ---- tier 2: oncoming trains, tighter combos
  { name: "oncoming", tier: 2, weight: 3, rows: ["...", "...", "M..", "m..", "...", ".j.", "...", "...", "..."] },
  { name: "oncoming-c", tier: 2, weight: 2, rows: ["...", "...", ".M.", ".m.", "...", "j.j", "...", "...", "..."] },
  { name: "train-onc", tier: 2, weight: 3, rows: ["T..", "T..", "T.M", "T.m", "T..", "T..", "...", "...", "...", "..."] },
  { name: "ramp-run", tier: 2, weight: 3, rows: ["^..", "^..", "TT.", "TTT", "TTT", "TTT", ".TT", "..T", "..T", "...", "..."] },
  { name: "slalom", tier: 2, weight: 2, rows: ["b.r", "...", "...", "rb.", "...", "...", ".jb"] },
  { name: "tunnel", tier: 2, weight: 2, rows: ["TrT", "T.T", "T.T", "TjT", "T.T", "T.T", "TrT", "..."] },
  // ---- tier 3: dense
  { name: "double-onc", tier: 3, weight: 2, rows: ["...", "...", "M..", "m.M", "..m", "...", ".r.", "...", "...", "..."] },
  { name: "rooftops", tier: 3, weight: 3, rows: [".^.", ".^.", "TTT", "TTT", "T.T", "T.T", "TTT", "TTT", "...", "...", "..."] },
  { name: "gauntlet", tier: 3, weight: 2, rows: ["j.b", "...", "...", "b.r", "...", "...", "rjb", "...", "...", "..."] },
  { name: "split", tier: 3, weight: 2, rows: ["T.T", "T.T", "TbT", "...", "...", "...", ".TT", ".TT", "jTT", "...", "..."] },
];

/** First-run tutorial: one of each move, in order (hint keys say what to show). */
const TUTORIAL: { rows: string[]; hint: string }[] = [
  { rows: [".b.", "...", "...", "...", "..."], hint: "lane" },
  { rows: ["jjj", "...", "...", "...", "..."], hint: "jump" },
  { rows: ["rrr", "...", "...", "...", "..."], hint: "roll" },
  { rows: [".^.", ".^.", "TTT", "TTT", "TTT", "...", "...", "...", "..."], hint: "ramp" },
];

const charCell = (ch: string): Cell => {
  switch (ch) {
    case "j": return Cell.Jump;
    case "r": return Cell.Roll;
    case "b": return Cell.Block;
    case "T": return Cell.Train;
    case "^": return Cell.Ramp;
    case "M": case "m": return Cell.Moving;
    default: return Cell.Empty;
  }
};

// ------------------------------------------------------------------ validation

/** Player state at a row: lane, on top of trains, rows of airtime left, rows of landing (fall from a train) left. */
const enc = (lane: number, elev: number, air: number, land: number) => lane | (elev << 2) | (air << 3) | (land << 5);
const laneOf = (s: number) => s & 3;
const elevOf = (s: number) => (s >> 2) & 1;
const airOf = (s: number) => (s >> 3) & 3;
const landOf = (s: number) => (s >> 5) & 3;

/** Successor states when moving from row `cur` (state s) into row `next`. */
export function successors(s: number, cur: Cell[], next: Cell[], out: number[]) {
  out.length = 0;
  const lane = laneOf(s), elev = elevOf(s), air = airOf(s), land = landOf(s);
  for (let dl = -1; dl <= 1; dl++) {
    const nl = lane + dl;
    if (nl < 0 || nl >= LANES) continue;
    const c1 = next[nl];
    let nElev = elev, nAir = Math.max(0, air - 1), nLand = Math.max(0, land - 1);
    if (dl !== 0) {
      // Switching lanes takes about one row: the target lane must be clear in both rows.
      if (cur[lane] === Cell.Ramp) continue;
      const c0 = cur[nl];
      if (elev) {
        if (c0 === Cell.Train && (c1 === Cell.Train || c1 === Cell.Empty)) { /* hop across roofs (or off the end) */ }
        else if (c0 === Cell.Empty && c1 === Cell.Empty) { nElev = 0; nLand = 2; }
        else continue;
      } else if (!(c0 === Cell.Empty && c1 === Cell.Empty)) continue;
    }
    if (nElev) {
      if (c1 === Cell.Train) { nAir = 0; }
      else if (c1 === Cell.Ramp && dl === 0) { nAir = 0; }
      else if (c1 === Cell.Empty) { nElev = 0; nLand = 2; }
      else continue;
    } else {
      if (nLand > 0 || land > 0) {
        if (c1 !== Cell.Empty) continue;
      } else if (air > 0) {
        // one jump also clears a hurdle in the very next row; the row after that is for landing
        if (c1 === Cell.Jump && air === 2) nAir = 1;
        else if (c1 !== Cell.Empty) continue;
      } else {
        switch (c1) {
          case Cell.Empty: break;
          case Cell.Jump: nAir = 2; break;
          case Cell.Roll: break;
          case Cell.Ramp: if (dl !== 0) continue; nElev = 1; break;
          default: continue;
        }
      }
    }
    out.push(enc(nl, nElev, nAir, nLand));
  }
}

/** States reachable at the last row of `rows` from `start` (rows[0] is the row the start state is in). */
function reachFrom(start: number, rows: Cell[][]): Set<number> {
  let cur = new Set<number>([start]);
  const tmp: number[] = [];
  for (let r = 0; r + 1 < rows.length; r++) {
    const next = new Set<number>();
    for (const s of cur) {
      successors(s, rows[r], rows[r + 1], tmp);
      for (const t of tmp) next.add(t);
    }
    cur = next;
    if (cur.size === 0) break;
  }
  return cur;
}

/** Entering row 0 of a block from a state that is in `prevRow`. */
function enterStates(start: number, prevRow: Cell[], row0: Cell[]) {
  const tmp: number[] = [];
  successors(start, prevRow, row0, tmp);
  return tmp;
}

// ------------------------------------------------------------------ generator

export class TrackGen {
  /** Cells by absolute row index (rows behind the player are dropped). */
  private readonly grid = new Map<number, Cell[]>();
  /** Per lane: first row index where static objects are allowed again (oncoming train sweep). */
  private readonly reserved = [0, 0, 0];
  /** Next row to generate. */
  frontier = 0;
  /** States the player may be in at row frontier-1. */
  private reach = new Set<number>([enc(1, 0, 0, 0)]);
  private rng = new SysRandom(1);
  private lastPattern = "";
  tutorial = -1;
  /** Rows that hold the tutorial hint trigger: row index → hint key. */
  readonly hints = new Map<number, string>();
  /** Coins on the last generated stretch, to space power-ups. */
  private sincePower = 0;
  coinRuns = 0.75;

  reset(seed: number, startRow: number, tutorial: boolean) {
    this.grid.clear();
    this.hints.clear();
    this.rng = new SysRandom(seed);
    this.frontier = startRow;
    this.reserved[0] = this.reserved[1] = this.reserved[2] = startRow;
    this.reach = new Set<number>([enc(0, 0, 0, 0), enc(1, 0, 0, 0), enc(2, 0, 0, 0)]);
    this.tutorial = tutorial ? 0 : -1;
    this.lastPattern = "";
    this.sincePower = 0;
  }

  /** Forgets every row from `row` on and restarts with free lanes (continue after a crash, landing after a boost). */
  restartAt(row: number) {
    for (const k of [...this.grid.keys()]) if (k >= row) this.grid.delete(k);
    for (const k of [...this.hints.keys()]) if (k >= row) this.hints.delete(k);
    this.frontier = row;
    this.reserved[0] = this.reserved[1] = this.reserved[2] = row;
    this.reach = new Set<number>([enc(0, 0, 0, 0), enc(1, 0, 0, 0), enc(2, 0, 0, 0)]);
  }

  cellsAt(row: number): Cell[] | undefined { return this.grid.get(row); }

  /** Drops rows behind `row`. */
  trim(row: number) { for (const k of this.grid.keys()) if (k < row) this.grid.delete(k); }

  /** Appends free rows (no objects). */
  emitEmpty(count: number) {
    for (let i = 0; i < count; i++) this.pushRow([Cell.Empty, Cell.Empty, Cell.Empty]);
  }

  private pushRow(cells: Cell[]) {
    const prev = this.grid.get(this.frontier - 1) ?? [Cell.Empty, Cell.Empty, Cell.Empty];
    const next = new Set<number>();
    const tmp: number[] = [];
    for (const s of this.reach) {
      successors(s, prev, cells, tmp);
      for (const t of tmp) next.add(t);
    }
    this.grid.set(this.frontier, cells);
    this.frontier++;
    // A free row is always enterable from any ground state, so this is never empty for free rows.
    this.reach = next.size > 0 ? next : new Set<number>([enc(0, 0, 0, 0), enc(1, 0, 0, 0), enc(2, 0, 0, 0)]);
  }

  /**
   * Generates the next pattern (with its lead-in gap) and returns the spawned objects.
   * `tier` 0..3 sets which patterns may appear and how much room there is between them.
   */
  next(tier: number, out: Spawn[], coins: boolean) {
    const rng = this.rng;
    let rows: Cell[][] | null = null;
    let gap = tier <= 0 ? 3 : tier === 1 ? 2 + rng.next(2) : tier === 2 ? 2 : 1 + rng.next(2);
    let hint = "";
    if (this.tutorial >= 0 && this.tutorial < TUTORIAL.length) {
      const t = TUTORIAL[this.tutorial++];
      rows = t.rows.map((r) => [...r].map(charCell));
      hint = t.hint;
      gap = 4;
      if (!this.validate(rows, gap)) rows = null;
      if (this.tutorial >= TUTORIAL.length) this.tutorial = -1;
    }
    let tries = 0;
    while (!rows && tries++ < 16) {
      const p = this.pick(tier);
      if (p.name === this.lastPattern && tries < 8) continue;
      const mirror = rng.next(2) === 1;
      const cand = p.rows.map((r) => [...(mirror ? [...r].reverse().join("") : r)].map(charCell));
      if (!this.validate(cand, gap)) continue;
      rows = cand;
      this.lastPattern = p.name;
    }
    if (!rows) { this.emitEmpty(2); return; }

    this.emitEmpty(gap);
    const base = this.frontier;
    // Coin path through the pattern (from a random reachable state), computed before the rows are committed.
    const path = coins ? this.findPath(rows) : null;
    if (hint) this.hints.set(base, hint);
    for (const r of rows) this.pushRow(r);
    this.spawnObjects(rows, base, out);
    if (path) this.spawnCoins(rows, base, path, out);
  }

  private pick(tier: number): Pattern {
    let total = 0;
    for (const p of PATTERNS) if (p.tier <= tier) total += p.weight * (p.tier === tier ? 2 : 1);
    let x = this.rng.nextDouble() * total;
    for (const p of PATTERNS) {
      if (p.tier > tier) continue;
      x -= p.weight * (p.tier === tier ? 2 : 1);
      if (x <= 0) return p;
    }
    return PATTERNS[0];
  }

  /** True when every currently reachable state can get through `gap` free rows plus `rows`. */
  private validate(rows: Cell[][], gap: number) {
    const start = this.frontier + gap;
    // Oncoming trains need their lane clear of static objects behind and ahead (they sweep through it).
    for (let r = 0; r < rows.length; r++)
      for (let l = 0; l < LANES; l++) {
        const c = rows[r][l];
        if (c !== Cell.Empty && c !== Cell.Moving && start + r < this.reserved[l]) return false;
        if (c === Cell.Moving && (r === 0 || rows[r - 1][l] !== Cell.Moving)) {
          for (let k = r - 2; k < Math.min(rows.length, r + 14); k++) {
            if (k < 0) continue;
            const o = rows[k][l];
            if (o !== Cell.Empty && o !== Cell.Moving) return false;
          }
        }
      }
    const empty: Cell[] = [Cell.Empty, Cell.Empty, Cell.Empty];
    const block: Cell[][] = [];
    for (let i = 0; i < gap; i++) block.push(empty);
    for (const r of rows) block.push(r);
    const prev = this.grid.get(this.frontier - 1) ?? empty;
    for (const s of this.reach) {
      let ok = false;
      for (const e of enterStates(s, prev, block[0])) {
        if (reachFrom(e, block).size > 0) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  }

  /** A random valid path through `rows` (lane per row and whether on top of a train), from a reachable state. */
  private findPath(rows: Cell[][]): { lane: number; elev: number; air: number }[] | null {
    const empty: Cell[] = [Cell.Empty, Cell.Empty, Cell.Empty];
    const starts = [...this.reach];
    // Backward feasibility: which states at each row can still reach the end.
    const n = rows.length;
    const good: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    const all: number[] = [];
    for (let l = 0; l < LANES; l++) for (let e = 0; e < 2; e++) for (let a = 0; a < 4; a++) for (let d = 0; d < 3; d++) all.push(enc(l, e, a, d));
    for (const s of all) good[n - 1].add(s);
    const tmp: number[] = [];
    for (let r = n - 2; r >= 0; r--)
      for (const s of all) {
        successors(s, rows[r], rows[r + 1], tmp);
        if (tmp.some((t) => good[r + 1].has(t))) good[r].add(s);
      }
    for (let attempt = 0; attempt < 6; attempt++) {
      const s0 = starts[this.rng.next(starts.length)];
      // the gap rows before the pattern are free, so any lane can be the entry lane
      let lane = this.rng.next(3);
      if (attempt === 0) lane = laneOf(s0);
      const first = enterStates(enc(lane, 0, 0, 0), empty, rows[0]).filter((t) => good[0].has(t));
      if (first.length === 0) continue;
      const path: { lane: number; elev: number; air: number }[] = [];
      let s = first.find((t) => laneOf(t) === lane) ?? first[0];
      path.push({ lane: laneOf(s), elev: elevOf(s), air: airOf(s) });
      let ok = true;
      for (let r = 0; r + 1 < n; r++) {
        successors(s, rows[r], rows[r + 1], tmp);
        const cand = tmp.filter((t) => good[r + 1].has(t));
        if (cand.length === 0) { ok = false; break; }
        // Prefer staying in lane (coin lines), sometimes drift.
        const stay = cand.filter((t) => laneOf(t) === laneOf(s));
        s = stay.length > 0 && this.rng.nextDouble() < 0.85 ? stay[this.rng.next(stay.length)] : cand[this.rng.next(cand.length)];
        path.push({ lane: laneOf(s), elev: elevOf(s), air: airOf(s) });
      }
      if (ok) return path;
    }
    return null;
  }

  private spawnObjects(rows: Cell[][], base: number, out: Spawn[]) {
    const mk = (kind: Kind, lane: number, z0: number, z1: number, y = 0, sub = 0): Spawn =>
      ({ kind, lane, z0, z1, y, sub, moving: false, len: 0, ramp: false });
    const livery = this.rng.next(3);
    for (let l = 0; l < LANES; l++) {
      for (let r = 0; r < rows.length; r++) {
        const c = rows[r][l], z = (base + r) * ROW;
        switch (c) {
          case Cell.Jump: out.push(mk(Kind.Barrier, l, z + ROW * 0.5 - 0.2, z + ROW * 0.5 + 0.2)); break;
          case Cell.Roll: out.push(mk(Kind.Bar, l, z + ROW * 0.5 - 0.15, z + ROW * 0.5 + 0.15)); break;
          case Cell.Block: out.push(mk(Kind.Block, l, z + ROW * 0.5 - 0.5, z + ROW * 0.5 + 0.5)); break;
          case Cell.Ramp: {
            let e = r;
            while (e + 1 < rows.length && rows[e + 1][l] === Cell.Ramp) e++;
            out.push(mk(Kind.Ramp, l, z + 0.2, (base + e + 1) * ROW));
            r = e;
            break;
          }
          case Cell.Train: {
            let e = r;
            while (e + 1 < rows.length && rows[e + 1][l] === Cell.Train) e++;
            const t = mk(Kind.Train, l, z + (r > 0 && rows[r - 1][l] === Cell.Ramp ? 0 : 0.3), (base + e + 1) * ROW - 0.3, 0, (livery + l) % 3);
            t.ramp = r > 0 && rows[r - 1][l] === Cell.Ramp;
            out.push(t);
            r = e;
            break;
          }
          case Cell.Moving: {
            let e = r;
            while (e + 1 < rows.length && rows[e + 1][l] === Cell.Moving) e++;
            const t = mk(Kind.Train, l, z, z + (e - r + 1) * ROW, 0, 3);
            t.moving = true;
            t.len = (e - r + 1) * ROW * (1 + MovingRatio);
            out.push(t);
            this.reserved[l] = Math.max(this.reserved[l], base + e + 14);
            r = e;
            break;
          }
        }
      }
    }
  }

  private spawnCoins(rows: Cell[][], base: number, path: { lane: number; elev: number; air: number }[], out: Spawn[]) {
    const rng = this.rng;
    const n = rows.length;
    let r = 0;
    while (r < n) {
      // a run of rows on a straight stretch of the path
      if (rng.nextDouble() > this.coinRuns) { r += 1 + rng.next(2); continue; }
      const lane = path[r].lane;
      let e = r;
      while (e + 1 < n && path[e + 1].lane === lane && e - r < 7) e++;
      if (e - r >= 1) {
        for (let k = r; k <= e; k++) {
          const cell = rows[k][lane];
          if (cell === Cell.Moving || cell === Cell.Block) continue;
          const onTop = path[k].elev === 1 && cell === Cell.Train;
          const per = 3;
          for (let i = 0; i < per; i++) {
            const z = (base + k) * ROW + (i + 0.5) * (ROW / per);
            let y = onTop ? 3.3 + 0.75 : 0.75;
            if (cell === Cell.Ramp) {
              // follow the ramp surface
              let s = k;
              while (s > 0 && rows[s - 1][lane] === Cell.Ramp) s--;
              let t = k;
              while (t + 1 < n && rows[t + 1][lane] === Cell.Ramp) t++;
              const z0 = (base + s) * ROW, z1 = (base + t + 1) * ROW;
              y = 3.3 * Math.min(1, Math.max(0, (z - z0) / (z1 - z0))) + 0.75;
            }
            if (cell === Cell.Jump) {
              // arc over the barrier
              const zc = (base + k) * ROW + ROW * 0.5;
              const d = (z - zc) / (ROW * 0.9);
              y = 0.75 + 1.9 * Math.max(0, 1 - d * d);
            }
            out.push({ kind: Kind.Coin, lane, z0: z, z1: z, y, sub: 0, moving: false, len: 0, ramp: false });
          }
        }
      }
      r = e + 1;
    }
    // Power-ups: now and then on a free cell of the path.
    this.sincePower += n;
    if (this.sincePower > 22 && rng.nextDouble() < 0.5) {
      for (let tries = 0; tries < 6; tries++) {
        const k = rng.next(n);
        const lane = path[k].lane, cell = rows[k][lane];
        if (cell !== Cell.Empty && !(cell === Cell.Train && path[k].elev)) continue;
        const z = (base + k) * ROW + ROW * 0.5;
        // keep power-ups away from coins at the same spot
        for (let i = out.length - 1; i >= 0; i--) if (out[i].kind === Kind.Coin && out[i].lane === lane && Math.abs(out[i].z0 - z) < 1.6) out.splice(i, 1);
        const kind = [Power.Magnet, Power.Double, Power.Boost, Power.Shield][rng.next(4)];
        out.push({ kind: Kind.Power, lane, z0: z, z1: z, y: cell === Cell.Train ? 3.3 + 1 : 1, sub: kind, moving: false, len: 0, ramp: false });
        this.sincePower = 0;
        break;
      }
    }
  }
}

/** Shortest-risk autopilot: from the player's state, a lane plan over the next rows (used by attract mode and the test bot). */
export function planLanes(gen: TrackGen, row: number, state: { lane: number; elev: number }, horizon: number): number[] | null {
  const rows: Cell[][] = [];
  for (let r = row; r < row + horizon; r++) {
    const c = gen.cellsAt(r);
    if (!c) break;
    rows.push(c);
  }
  if (rows.length < 2) return null;
  const n = rows.length;
  const start = enc(state.lane, state.elev, 0, 0);
  // BFS keeping parents; prefer fewer lane changes.
  const parent: Map<number, number>[] = Array.from({ length: n }, () => new Map<number, number>());
  parent[0].set(start, -1);
  const tmp: number[] = [];
  let last = 0;
  for (let r = 0; r + 1 < n; r++) {
    const states = [...parent[r].keys()];
    // stable order: states in the same lane as their parent come first
    for (const s of states) {
      successors(s, rows[r], rows[r + 1], tmp);
      tmp.sort((a, b) => Math.abs(laneOf(a) - laneOf(s)) - Math.abs(laneOf(b) - laneOf(s)) || Math.abs(laneOf(a) - 1) - Math.abs(laneOf(b) - 1));
      for (const t of tmp) if (!parent[r + 1].has(t)) parent[r + 1].set(t, s);
    }
    if (parent[r + 1].size === 0) break;
    last = r + 1;
  }
  let s = [...parent[last].keys()].sort((a, b) => Math.abs(laneOf(a) - 1) - Math.abs(laneOf(b) - 1))[0];
  if (s === undefined) return null;
  const lanes: number[] = new Array(last + 1);
  for (let r = last; r >= 0; r--) {
    lanes[r] = laneOf(s);
    s = parent[r].get(s) ?? s;
  }
  return lanes;
}
