/**
 * WORD GRID rules and the computer solver. Pure logic (no kit imports) so it can be tested headlessly.
 * Feedback per letter: 2 = right spot (green), 1 = in the word elsewhere (yellow), 0 = not in the word (grey);
 * repeated letters are only marked as often as they occur in the answer.
 */

export const LEN = 5;
export const ROWS = 6;

/** Feedback for a guess against an answer, as five digits 0/1/2. */
export function score(guess: string, answer: string): number[] {
  const res = [0, 0, 0, 0, 0];
  const left: Record<string, number> = {};
  for (let i = 0; i < LEN; i++) {
    if (guess[i] === answer[i]) res[i] = 2;
    else left[answer[i]] = (left[answer[i]] ?? 0) + 1;
  }
  for (let i = 0; i < LEN; i++) {
    if (res[i] === 2) continue;
    const c = guess[i];
    if ((left[c] ?? 0) > 0) { res[i] = 1; left[c]--; }
  }
  return res;
}

/** Feedback packed as a base-3 number 0..242 (fast path for the solver). */
export function pattern(guess: string, answer: string) {
  const r = score(guess, answer);
  return r[0] + r[1] * 3 + r[2] * 9 + r[3] * 27 + r[4] * 81;
}

const cnt = new Int8Array(26);
const pw = [1, 3, 9, 27, 81];
/** Allocation-free pattern for words given as letter codes 0..25 (the solver's inner loop). */
export function patternCodes(g: Uint8Array, a: Uint8Array) {
  cnt.fill(0);
  let res = 0;
  for (let i = 0; i < LEN; i++) { if (g[i] === a[i]) res += 2 * pw[i]; else cnt[a[i]]++; }
  for (let i = 0; i < LEN; i++) {
    if (g[i] === a[i]) continue;
    if (cnt[g[i]] > 0) { res += pw[i]; cnt[g[i]]--; }
  }
  return res;
}
export const codes = (w: string) => Uint8Array.from(w, (c) => c.charCodeAt(0) - 65);

export function packed(r: number[]) { return r[0] + r[1] * 3 + r[2] * 9 + r[3] * 27 + r[4] * 81; }

export class Dictionary {
  readonly answers: string[];
  readonly valid: Set<string>;
  readonly guessPool: string[];
  constructor(answersPacked: string, extraPacked: string) {
    this.answers = split(answersPacked);
    const extra = split(extraPacked);
    this.valid = new Set([...this.answers, ...extra]);
    this.guessPool = [...this.answers, ...extra];
  }
  isWord(w: string) { return this.valid.has(w); }

  /** Days since 1 Jan 2026 for a local date. */
  static dayNumber(d: Date) {
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 86400000);
  }
  static dateKey(d: Date) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }

  private order: number[] | null = null;
  /** The daily answer: the same for everyone on a date (fixed shuffle of the answer list). */
  daily(day: number) {
    if (!this.order) {
      const idx = this.answers.map((_, i) => i);
      let s = 20260101 >>> 0;
      const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      this.order = idx;
    }
    const n = this.answers.length;
    return this.answers[this.order[((day % n) + n) % n]];
  }

  random(rnd: () => number) { return this.answers[Math.floor(rnd() * this.answers.length)]; }
}

function split(s: string) {
  const out: string[] = [];
  for (let i = 0; i + LEN <= s.length; i += LEN) out.push(s.slice(i, i + LEN));
  return out;
}

/** Hard mode: every revealed hint must be used. Returns an error message or null. */
export function hardModeError(guess: string, history: { word: string; marks: number[] }[]): string | null {
  for (const h of history) {
    for (let i = 0; i < LEN; i++)
      if (h.marks[i] === 2 && guess[i] !== h.word[i]) return `${ordinal(i + 1)} letter must be ${h.word[i]}`;
    const need: Record<string, number> = {};
    for (let i = 0; i < LEN; i++) if (h.marks[i] > 0) need[h.word[i]] = (need[h.word[i]] ?? 0) + 1;
    for (const [c, n] of Object.entries(need)) {
      let have = 0;
      for (const g of guess) if (g === c) have++;
      if (have < n) return `Guess must contain ${c}`;
    }
  }
  return null;
}

function ordinal(n: number) { return n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"); }

/**
 * The computer's guesser. EASY guesses words that fit some of what it knows (it sometimes forgets yellows), MEDIUM
 * guesses any word consistent with all feedback, HARD picks the guess that splits the remaining answers best
 * (maximum expected information), then finishes with a consistent word.
 */
export class Solver {
  private cands: string[];
  private history: { word: string; marks: number[] }[] = [];
  static Opener = "RAISE";

  constructor(private dict: Dictionary, readonly level: number, private rnd: () => number) {
    this.cands = dict.answers.slice();
  }

  get remaining() { return this.cands.length; }

  feed(word: string, marks: number[]) {
    this.history.push({ word, marks });
    const p = packed(marks);
    this.cands = this.cands.filter((c) => pattern(word, c) === p);
  }

  next(): string {
    const turn = this.history.length;
    if (this.cands.length === 0) return this.dict.random(this.rnd);
    if (this.level === 0) {
      if (turn === 0) return this.dict.random(this.rnd);
      // forgets the yellows (and sometimes the greys) of older rows
      const loose = this.dict.answers.filter((c) => this.history.every((h, k) => {
        const strict = k === this.history.length - 1 || this.rnd() < 0.5;
        for (let i = 0; i < LEN; i++) {
          if (h.marks[i] === 2 && c[i] !== h.word[i]) return false;
          if (strict && h.marks[i] === 0 && !h.word.slice(0, i).includes(h.word[i]) && !h.word.slice(i + 1).includes(h.word[i]) && c.includes(h.word[i])) return false;
        }
        return true;
      }));
      const used = new Set(this.history.map((h) => h.word));
      const pool = (this.rnd() < 0.6 ? this.cands : loose).filter((w) => !used.has(w));
      return pool.length > 0 ? pool[Math.floor(this.rnd() * pool.length)] : this.cands[0];
    }
    if (this.level === 1) {
      if (turn === 0) return ["SLATE", "CRANE", "STARE", "RAISE", "ROAST", "CLOUD", "HEART"][Math.floor(this.rnd() * 7)];
      return this.cands[Math.floor(this.rnd() * this.cands.length)];
    }
    if (turn === 0) return Solver.Opener;
    if (this.cands.length <= 2) return this.cands[0];
    return this.bestSplit();
  }

  /** Guess with the highest entropy over the remaining answers (candidates first on ties). */
  bestSplit() {
    const cands = this.cands;
    // keep the work bounded (~250k pattern checks) so a phone never stalls
    const budget = Math.max(200, Math.floor(120000 / cands.length) - cands.length);
    const pool = this.sample(Math.min(budget, 2600)).concat(cands);
    const candSet = new Set(cands);
    const cc = cands.map(codes);
    const counts = new Int32Array(243);
    let best = cands[0], bestH = -1;
    for (const g of pool) {
      const gc = codes(g);
      counts.fill(0);
      for (const c of cc) counts[patternCodes(gc, c)]++;
      let h = 0;
      for (let k = 0; k < 243; k++) if (counts[k] > 0) { const p = counts[k] / cands.length; h -= p * Math.log2(p); }
      if (candSet.has(g)) h += 0.15;
      if (h > bestH) { bestH = h; best = g; }
    }
    return best;
  }

  private sample(n: number) {
    const p = this.dict.guessPool, out: string[] = [];
    for (let i = 0; i < n; i++) out.push(p[Math.floor(this.rnd() * p.length)]);
    return out;
  }
}
