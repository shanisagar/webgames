/**
 * Dots & Boxes rules, bots and puzzle generator. Pure logic (no kit imports) so the bots can be tested headlessly.
 *
 * Board: n×n boxes, (n+1)² dots. Edge ids: horizontal edges first (row r = 0..n from the top, column c = 0..n-1:
 * id = r·n + c), then vertical edges (row r = 0..n-1, column c = 0..n: id = n(n+1) + r(n+1) + c).
 */

export type Rng = () => number;
export const Tuning = { budget: 12000, safe: 14, term: 1200 };
const PB = () => Tuning.budget, PS = () => Tuning.safe;

export class Board {
  readonly n: number;
  readonly E: number;
  readonly drawn: Uint8Array;
  readonly owner: Int8Array;
  readonly sides: Uint8Array;
  /** For every edge, the boxes on either side (-1 = outside). */
  readonly edgeBoxes: Int16Array;
  /** For every box, its four edges (top, bottom, left, right). */
  readonly boxEdges: Int16Array;
  moves: { e: number; p: number; got: number[] }[] = [];
  score = [0, 0];

  constructor(n: number) {
    this.n = n;
    this.E = 2 * n * (n + 1);
    this.drawn = new Uint8Array(this.E);
    this.owner = new Int8Array(n * n).fill(-1);
    this.sides = new Uint8Array(n * n);
    this.edgeBoxes = new Int16Array(this.E * 2).fill(-1);
    this.boxEdges = new Int16Array(n * n * 4);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const b = r * n + c;
        const es = [this.H(r, c), this.H(r + 1, c), this.V(r, c), this.V(r, c + 1)];
        for (let k = 0; k < 4; k++) {
          this.boxEdges[b * 4 + k] = es[k];
          const e = es[k];
          if (this.edgeBoxes[e * 2] < 0) this.edgeBoxes[e * 2] = b; else this.edgeBoxes[e * 2 + 1] = b;
        }
      }
  }

  H(r: number, c: number) { return r * this.n + c; }
  V(r: number, c: number) { return this.n * (this.n + 1) + r * (this.n + 1) + c; }
  isH(e: number) { return e < this.n * (this.n + 1); }
  /** Dot endpoints of an edge as (row, col) of dots. */
  ends(e: number): [number, number, number, number] {
    const n = this.n;
    if (this.isH(e)) { const r = Math.floor(e / n), c = e % n; return [r, c, r, c + 1]; }
    const k = e - n * (n + 1), r = Math.floor(k / (n + 1)), c = k % (n + 1);
    return [r, c, r + 1, c];
  }

  clone() {
    const b = new Board(this.n);
    b.drawn.set(this.drawn); b.owner.set(this.owner); b.sides.set(this.sides); b.score = this.score.slice();
    return b;
  }

  get full() { return this.moves.length >= this.E || this.score[0] + this.score[1] >= this.n * this.n && this.drawnCount() >= this.E; }
  drawnCount() { let k = 0; for (let i = 0; i < this.E; i++) k += this.drawn[i]; return k; }
  get over() { return this.score[0] + this.score[1] + this.preOwned >= this.n * this.n; }
  /** Boxes that were already owned when a puzzle started (owner 2). */
  preOwned = 0;

  /** Draws an edge for player p. Returns the boxes it completed (the player then moves again). */
  play(e: number, p: number): number[] {
    if (this.drawn[e]) return [];
    this.drawn[e] = 1;
    const got: number[] = [];
    for (let k = 0; k < 2; k++) {
      const b = this.edgeBoxes[e * 2 + k];
      if (b < 0) continue;
      this.sides[b]++;
      if (this.sides[b] === 4) { this.owner[b] = p; got.push(b); if (p < 2) this.score[p]++; }
    }
    this.moves.push({ e, p, got });
    return got;
  }

  undo() {
    const m = this.moves.pop();
    if (!m) return null;
    this.drawn[m.e] = 0;
    for (let k = 0; k < 2; k++) { const b = this.edgeBoxes[m.e * 2 + k]; if (b >= 0) this.sides[b]--; }
    for (const b of m.got) { this.owner[b] = -1; if (m.p < 2) this.score[m.p]--; }
    return m;
  }

  free(): number[] { const out: number[] = []; for (let e = 0; e < this.E; e++) if (!this.drawn[e]) out.push(e); return out; }

  /** Edges that complete at least one box right now. */
  captures(): number[] {
    const out: number[] = [];
    for (let e = 0; e < this.E; e++) {
      if (this.drawn[e]) continue;
      for (let k = 0; k < 2; k++) { const b = this.edgeBoxes[e * 2 + k]; if (b >= 0 && this.sides[b] === 3) { out.push(e); break; } }
    }
    return out;
  }

  /** Edges that neither complete a box nor give the opponent a third side. */
  safe(): number[] {
    const out: number[] = [];
    for (let e = 0; e < this.E; e++) if (!this.drawn[e] && this.isSafe(e)) out.push(e);
    return out;
  }
  isSafe(e: number) {
    for (let k = 0; k < 2; k++) { const b = this.edgeBoxes[e * 2 + k]; if (b >= 0 && this.sides[b] >= 2) return false; }
    return true;
  }
  completes(e: number) {
    for (let k = 0; k < 2; k++) { const b = this.edgeBoxes[e * 2 + k]; if (b >= 0 && this.sides[b] === 3) return true; }
    return false;
  }

  /** Takes every capture there is (greedy cascade) for player p; returns how many boxes. */
  cascade(p: number) {
    let total = 0;
    for (;;) {
      const c = this.captures();
      if (!c.length) return total;
      total += this.play(c[0], p).length;
    }
  }

  missingEdges(b: number) { const out: number[] = []; for (let k = 0; k < 4; k++) { const e = this.boxEdges[b * 4 + k]; if (!this.drawn[e]) out.push(e); } return out; }
  other(e: number, b: number) { const a = this.edgeBoxes[e * 2], c = this.edgeBoxes[e * 2 + 1]; return a === b ? c : a; }
}

// ------------------------------------------------------------------ chains and the loony endgame

export interface Comp { len: number; loop: boolean; boxes: number[] }

/** Chains and loops made of 2-sided boxes (junction boxes end a chain). */
export function components(bd: Board): Comp[] {
  const n2 = bd.n * bd.n, seen = new Uint8Array(n2), out: Comp[] = [];
  for (let s = 0; s < n2; s++) {
    if (seen[s] || bd.owner[s] >= 0 || bd.sides[s] !== 2) continue;
    // walk both ways from s
    const boxes = [s];
    seen[s] = 1;
    let loop = false;
    for (const start of bd.missingEdges(s)) {
      let prev = s, e = start;
      for (;;) {
        const nb = bd.other(e, prev);
        if (nb < 0 || bd.sides[nb] !== 2 || bd.owner[nb] >= 0) break;
        if (nb === s) { loop = true; break; }
        if (seen[nb]) break;
        seen[nb] = 1; boxes.push(nb);
        const nx = bd.missingEdges(nb).find((x) => x !== e);
        if (nx === undefined) break;
        prev = nb; e = nx;
      }
      if (loop) break;
    }
    out.push({ len: boxes.length, loop, boxes });
  }
  return out;
}

const fMemo = new Map<string, number>();

/** Net score for the player who must open the next component in a simple loony endgame (both sides play perfectly). */
export function endgameValue(comps: { len: number; loop: boolean }[]): number {
  if (!comps.length) return 0;
  const key = comps.map((c) => (c.loop ? "L" : "C") + c.len).sort().join(",");
  const m = fMemo.get(key);
  if (m !== undefined) return m;
  let best = -1e9;
  const tried = new Set<string>();
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i], tk = (c.loop ? "L" : "C") + c.len;
    if (tried.has(tk)) continue;
    tried.add(tk);
    const rest = comps.slice(0, i).concat(comps.slice(i + 1));
    const fr = endgameValue(rest);
    const takeAll = -c.len - fr;
    let v = takeAll;
    if (c.loop && c.len >= 4) v = Math.min(takeAll, 8 - c.len + fr);
    else if (!c.loop && c.len >= 3) v = Math.min(takeAll, 4 - c.len + fr);
    best = Math.max(best, v);
  }
  fMemo.set(key, best);
  return best;
}


// ------------------------------------------------------------------ exact endgame search

class OutOfBudget extends Error {}
const egMemo = new Map<string, number>();
let egNodes = 0, egBudget = 0;
/** Wall-clock limit for one bot decision (keeps the game responsive on slow phones). */
let deadline = Infinity;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Finds a chain end the taker could decline: A (3 sides) –e1– B (2 sides) –e2– outside / a box with < 2 sides. */
function findDomino(t: Board, caps: number[]): { e1: number; e2: number } | null {
  for (const e1 of caps)
    for (let k = 0; k < 2; k++) {
      const A = t.edgeBoxes[e1 * 2 + k];
      if (A < 0 || t.sides[A] !== 3) continue;
      const B = t.other(e1, A);
      if (B < 0 || t.sides[B] !== 2) continue;
      const e2 = t.missingEdges(B).find((x) => x !== e1);
      if (e2 === undefined) continue;
      const C = t.other(e2, B);
      if (C >= 0 && t.sides[C] >= 2) continue;
      return { e1, e2 };
    }
  return null;
}

/** p takes every box, keeping a final declinable domino (if any) untouched. */
function eatAll(t: Board, p: number): { got: number; dd: { e1: number; e2: number } | null } {
  let got = 0;
  for (;;) {
    const caps = t.captures();
    if (!caps.length) return { got, dd: null };
    const dom = findDomino(t, caps);
    if (dom && caps.length === 1) return { got, dd: dom };
    const e = caps.find((x) => !dom || x !== dom.e1) ?? caps[0];
    got += t.play(e, p).length;
  }
}

function remaining(t: Board) { let k = 0; for (let b = 0; b < t.n * t.n; b++) if (t.owner[b] < 0) k++; return k; }

/** Net boxes for the player who must open something now (no safe moves left, nothing to capture). */
function openVal(bd: Board): number {
  if (remaining(bd) === 0) return 0;
  const key = String.fromCharCode(...bd.drawn);
  const m = egMemo.get(key);
  if (m !== undefined) return m;
  let best = -1e9;
  const seen = new Set<string>();
  for (const e of bd.free()) {
    if (++egNodes > egBudget || ((egNodes & 63) === 0 && now() > deadline)) throw new OutOfBudget();
    const t = bd.clone();
    t.play(e, 0);
    const r = eatAll(t, 1);
    const sig = String.fromCharCode(...t.drawn) + (r.dd ? "d" + r.dd.e1 : "") + "|" + r.got;
    if (seen.has(sig)) continue;
    seen.add(sig);
    let v: number;
    if (r.dd) {
      const tA = t.clone();
      tA.play(r.dd.e1, 1); tA.play(r.dd.e2, 1);
      const gA = r.got + 2 + tA.cascade(1);
      const vA = -(gA + openVal(tA));
      const tB = t.clone();
      tB.play(r.dd.e2, 1);
      const g2 = tB.cascade(0);
      const vB = g2 - r.got + openVal(tB);
      v = Math.min(vA, vB);
    } else v = -(r.got + openVal(t));
    if (v > best) best = v;
  }
  if (egMemo.size > 300000) egMemo.clear();
  egMemo.set(key, best);
  return best;
}

/** openVal with a node budget; null when the position is too big to search. */
export function exactOpen(bd: Board, budget: number): number | null {
  egNodes = 0; egBudget = budget;
  try { return openVal(bd); } catch (e) { if (e instanceof OutOfBudget) return null; throw e; }
}

// ------------------------------------------------------------------ bots

export class DotsBot {
  nodes = 0;
  constructor(public level: number, private rnd: Rng = Math.random) {}

  private pick<T>(a: T[]): T { return a[Math.floor(this.rnd() * a.length)]; }

  /** The bot's next edge for player p. */
  move(bd: Board, p: number): number {
    deadline = now() + 1100;
    if (this.level === 0) return this.easy(bd);
    if (this.level === 1) return this.medium(bd);
    return this.hard(bd, p);
  }

  private easy(bd: Board) {
    const cap = bd.captures();
    if (cap.length && this.rnd() < 0.8) return this.pick(cap);
    const safe = bd.safe();
    if (safe.length && this.rnd() < 0.55) return this.pick(safe);
    return this.pick(bd.free());
  }

  private medium(bd: Board) {
    const cap = bd.captures();
    if (cap.length) return this.pick(cap);
    const safe = bd.safe();
    if (safe.length) return this.pick(safe);
    return this.cheapestSacrifice(bd, false);
  }

  /** The move that hands the opponent the fewest boxes (they take everything). */
  private cheapestSacrifice(bd: Board, hardHearted: boolean) {
    let best = -1, bv = 1e9;
    for (const e of bd.free()) {
      const t = bd.clone();
      t.play(e, 0);
      let v = t.cascade(1);
      // a 2-chain opened in the middle can't be double-dealt: slightly prefer it
      if (hardHearted && v === 2 && this.isMiddleOfTwo(bd, e)) v -= 0.5;
      if (v < bv || (v === bv && this.rnd() < 0.3)) { bv = v; best = e; }
    }
    return best;
  }

  private isMiddleOfTwo(bd: Board, e: number) {
    const a = bd.edgeBoxes[e * 2], b = bd.edgeBoxes[e * 2 + 1];
    return a >= 0 && b >= 0 && bd.sides[a] === 2 && bd.sides[b] === 2;
  }

  private hard(bd: Board, p: number) {
    const cap = bd.captures();
    if (cap.length) return this.hardCapture(bd, p, cap);
    const safe = bd.safe();
    if (safe.length) {
      if (safe.length <= PS()) {
        const r = this.parity(bd, safe);
        if (r >= 0) return r;
      }
      return this.pick(safe);
    }
    // loony endgame: search it exactly when it's small enough
    const ex = this.exactOpening(bd);
    if (ex >= 0) return ex;
    // otherwise open the component that's best for us (smallest net loss), hard-hearted for 2-chains
    const comps = components(bd);
    if (!comps.length) return this.cheapestSacrifice(bd, true);
    let bestC = comps[0], bv = -1e9;
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i], rest = comps.slice(0, i).concat(comps.slice(i + 1)), fr = endgameValue(rest);
      const takeAll = -c.len - fr;
      let v = takeAll;
      if (c.loop && c.len >= 4) v = Math.min(takeAll, 8 - c.len + fr);
      else if (!c.loop && c.len >= 3) v = Math.min(takeAll, 4 - c.len + fr);
      if (v > bv) { bv = v; bestC = c; }
    }
    // an edge inside that component: for a 2-chain, the shared middle edge
    const set = new Set(bestC.boxes);
    let fallback = -1;
    for (const b of bestC.boxes)
      for (const e of bd.missingEdges(b)) {
        const o = bd.other(e, b);
        if (bestC.len === 2 && !bestC.loop && o >= 0 && set.has(o)) return e;
        if (fallback < 0) fallback = e;
      }
    return fallback >= 0 ? fallback : this.cheapestSacrifice(bd, true);
  }

  private exactOpening(bd: Board): number {
    egNodes = 0; egBudget = 60000;
    try {
      let best = -1, bv = -1e9;
      for (const e of bd.free()) {
        const t = bd.clone();
        t.play(e, 0);
        const r = eatAll(t, 1);
        let v: number;
        if (r.dd) {
          const tA = t.clone(); tA.play(r.dd.e1, 1); tA.play(r.dd.e2, 1);
          const vA = -(r.got + 2 + tA.cascade(1) + openVal(tA));
          const tB = t.clone(); tB.play(r.dd.e2, 1);
          const vB = tB.cascade(0) - r.got + openVal(tB);
          v = Math.min(vA, vB);
        } else v = -(r.got + openVal(t));
        if (v > bv || (v === bv && this.rnd() < 0.3)) { bv = v; best = e; }
      }
      return best;
    } catch (e) { if (e instanceof OutOfBudget) return -1; throw e; }
  }

  /**
   * Taking boxes. Normally take them all, but when the opponent has just opened a long chain in the endgame,
   * keeping control by declining the last two boxes (a double-cross) can win the rest of the board.
   */
  private hardCapture(bd: Board, p: number, cap: number[]) {
    // look for the end of a chain: a 3-sided box A whose missing edge leads to a 2-sided box B
    for (const e1 of cap) {
      for (let k = 0; k < 2; k++) {
        const A = bd.edgeBoxes[e1 * 2 + k];
        if (A < 0 || bd.sides[A] !== 3) continue;
        const B = bd.other(e1, A);
        if (B < 0 || bd.sides[B] !== 2) continue;
        const e2 = bd.missingEdges(B).find((x) => x !== e1);
        if (e2 === undefined) continue;
        const C = bd.other(e2, B);
        if (C >= 0 && bd.sides[C] >= 2) continue; // more chain beyond: keep eating first
        // only decide once every other capture has been taken
        const others = cap.filter((x) => x !== e1);
        if (others.length) return others[0];
        const after = bd.clone();
        after.play(e1, p); after.play(e2, p); after.cascade(p);
        if (after.safe().length > 0 || after.over) return e1;
        const fr = exactOpen(after, 60000) ?? endgameValue(components(after));
        const takeAll = 2 + fr;      // we take A and B, then we must open the next one
        const decline = -2 - fr;     // they take A and B, then they must open
        return decline > takeAll ? e2 : e1;
      }
    }
    return cap[0];
  }

  /** Searches the remaining safe moves so that the opponent is the one who must open the first chain. */
  private parity(bd: Board, safe: number[]) {
    this.nodes = 0;
    const memo = new Map<string, number>();
    const self = this;
    const val = (b: Board): number => {
      if (++self.nodes > PB() || ((self.nodes & 63) === 0 && now() > deadline)) throw new Error("budget");
      const key = String.fromCharCode(...b.drawn);
      const m = memo.get(key);
      if (m !== undefined) return m;
      const s = b.safe();
      let v: number;
      if (!s.length) {
        const saved = egNodes, sb = egBudget;
        const ex = exactOpen(b, Tuning.term);
        egNodes = saved; egBudget = sb;
        v = ex ?? endgameValue(components(b));
      }
      else {
        v = -1e9;
        for (const e of s) { b.drawn[e] = 1; bumpSides(b, e, 1); const x = -val(b); bumpSides(b, e, -1); b.drawn[e] = 0; if (x > v) v = x; }
      }
      memo.set(key, v);
      return v;
    };
    try {
      const t = bd.clone();
      let best: number[] = [], bv = -1e9;
      for (const e of safe) {
        t.drawn[e] = 1; bumpSides(t, e, 1);
        const v = -val(t);
        bumpSides(t, e, -1); t.drawn[e] = 0;
        if (v > bv) { bv = v; best = [e]; } else if (v === bv) best.push(e);
      }
      return this.pick(best);
    } catch {
      return -1;
    }
  }
}

function bumpSides(b: Board, e: number, d: number) {
  for (let k = 0; k < 2; k++) { const x = b.edgeBoxes[e * 2 + k]; if (x >= 0) b.sides[x] += d; }
}

// ------------------------------------------------------------------ puzzles

export interface Puzzle { n: number; pre: number[]; ink: number; goal: number; best: number[] }

function rngFrom(seed: number): Rng {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * A stage: a board with pencil lines already drawn (no box has three sides) and a few lines of ink. Drawing a line
 * that closes a box is free; the goal is the most boxes the solver found with that ink.
 */
export function makePuzzle(stage: number): Puzzle {
  const n = stage < 6 ? 4 : stage < 16 ? 5 : 6;
  const ink = Math.min(5, 2 + Math.floor(stage / 5));
  const rnd = rngFrom(stage * 7919 + 13);
  for (let attempt = 0; ; attempt++) {
    const bd = new Board(n);
    const order = bd.free().sort(() => rnd() - 0.5);
    const density = 0.72 + rnd() * 0.25;
    let target = Math.floor(order.length * density);
    for (const e of order) {
      if (target <= 0) break;
      if (bd.isSafe(e)) { bd.drawn[e] = 1; bumpSides(bd, e, 1); target--; }
    }
    const pre: number[] = [];
    for (let e = 0; e < bd.E; e++) if (bd.drawn[e]) pre.push(e);
    const [goal, best] = solvePuzzle(bd, ink);
    const total = n * n;
    // keep puzzles where the ink can't simply take everything and the goal is meaningful
    if ((goal >= Math.min(4 + stage, total * 0.35) && goal < total) || attempt > 30) return { n, pre, ink, goal, best };
  }
}

/** Best number of boxes with `ink` paid moves (free captures are always taken). Beam search over paid moves. */
export function solvePuzzle(start: Board, ink: number): [number, number[]] {
  let bestV = 0, bestSeq: number[] = [];
  const rec = (bd: Board, left: number, got: number, seq: number[]) => {
    if (got > bestV) { bestV = got; bestSeq = seq.slice(); }
    if (left <= 0) return;
    const cands: { e: number; v: number; b: Board }[] = [];
    for (const e of bd.free()) {
      const t = bd.clone();
      t.play(e, 0);
      const v = t.cascade(0);
      cands.push({ e, v, b: t });
    }
    cands.sort((a, b) => b.v - a.v);
    const width = left >= 4 ? 5 : 7;
    const seenV = new Set<string>();
    let k = 0;
    for (const c of cands) {
      if (k >= width) break;
      const key = String.fromCharCode(...c.b.drawn);
      if (seenV.has(key)) continue;
      seenV.add(key);
      k++;
      seq.push(c.e);
      rec(c.b, left - 1, got + c.v, seq);
      seq.pop();
    }
  };
  rec(start.clone(), ink, 0, []);
  return [bestV, bestSeq];
}
