import { SysRandom } from "../../kit/math";

/**
 * Snakes & Ladders Dash rules (no rendering): the 100-square board with its numbering, five themed layouts of snakes
 * and ladders (generated from a seed, checked for fairness), the Dash power cards and the computer players' card play.
 */

export interface Link { from: number; to: number }
export interface Layout { ladders: Link[]; snakes: Link[]; cards: number[] }

/** Square (1..100) → column / row (0..9), boustrophedon from the bottom-left. */
export function cellOf(sq: number): [number, number] {
  const i = sq - 1, row = Math.floor(i / 10), k = i % 10;
  return [row % 2 === 0 ? k : 9 - k, row];
}

export const rowOf = (sq: number) => Math.floor((sq - 1) / 10);

export enum Card { Shield, Double, Swap }
export const CardNames = ["SHIELD", "DOUBLE", "SWAP"];
export const CardInfo = ["Blocks the next snake bite.", "Roll two dice this turn.", "Swap places with the leader."];

/** A fair-ish themed layout: 8 ladders and 8–9 snakes with unique endpoints, plus Dash card squares. */
export function makeLayout(theme: number): Layout {
  for (let attempt = 0; attempt < 400; attempt++) {
    const rng = new SysRandom(7331 + theme * 977 + attempt * 13);
    const used = new Set<number>([1, 100]);
    const ladders: Link[] = [], snakes: Link[] = [];
    const take = (a: number, b: number) => { used.add(a); used.add(b); };
    const free = (a: number) => !used.has(a) && a > 1 && a < 100;
    let tries = 0;
    while (ladders.length < 8 && tries++ < 500) {
      const from = 2 + rng.next(78), len = 12 + rng.next(30), to = from + len;
      if (to > 98 || !free(from) || !free(to) || rowOf(to) === rowOf(from)) continue;
      if (Math.abs(cellOf(from)[0] - cellOf(to)[0]) > 3 || ladders.some((l) => cross(l, { from, to }))) continue;
      ladders.push({ from, to });
      take(from, to);
    }
    const nSnakes = 8 + (theme % 2);
    tries = 0;
    while (snakes.length < nSnakes && tries++ < 500) {
      const from = 16 + rng.next(83), len = 8 + rng.next(24), to = from - len;
      if (to < 2 || !free(from) || !free(to) || rowOf(to) === rowOf(from)) continue;
      if (Math.abs(cellOf(from)[0] - cellOf(to)[0]) > 4 || snakes.some((s) => Math.abs(s.from - from) < 3 || cross(s, { from, to }))) continue;
      snakes.push({ from, to });
      take(from, to);
    }
    if (ladders.length < 8 || snakes.length < nSnakes) continue;
    const up = ladders.reduce((a, l) => a + l.to - l.from, 0), down = snakes.reduce((a, s) => a + s.from - s.to, 0);
    // balanced: a little more down than up, at least one snake in the nineties and one ladder in the first two rows
    if (down < up * 0.45 || down > up * 0.95) continue;
    if (!snakes.some((s) => s.from >= 90) || !ladders.some((l) => l.from <= 20)) continue;
    // quick Monte Carlo: games should take about 15-23 rolls per player
    const avg = simulate({ ladders, snakes, cards: [] }, rng, 300);
    if (avg < 15 || avg > 23) continue;
    const cards: number[] = [];
    tries = 0;
    while (cards.length < 9 && tries++ < 300) {
      const c = 4 + rng.next(92);
      if (!free(c) || cards.some((o) => Math.abs(o - c) < 6)) continue;
      cards.push(c);
      used.add(c);
    }
    return { ladders, snakes, cards: cards.sort((a, b) => a - b) };
  }
  // fallback: a classic layout
  return {
    ladders: [{ from: 4, to: 14 }, { from: 9, to: 31 }, { from: 21, to: 42 }, { from: 28, to: 84 }, { from: 36, to: 44 }, { from: 51, to: 67 }, { from: 71, to: 91 }, { from: 80, to: 99 }],
    snakes: [{ from: 16, to: 6 }, { from: 47, to: 26 }, { from: 49, to: 11 }, { from: 56, to: 53 }, { from: 62, to: 19 }, { from: 64, to: 60 }, { from: 87, to: 24 }, { from: 93, to: 73 }, { from: 98, to: 78 }],
    cards: [12, 23, 33, 45, 58, 69, 77, 89],
  };
}

/** Average rolls one player needs to finish a layout. */
export function simulate(l: Layout, rng: SysRandom, games: number) {
  const up = new Map<number, number>();
  for (const x of l.ladders) up.set(x.from, x.to);
  for (const x of l.snakes) up.set(x.from, x.to);
  let tot = 0;
  for (let g = 0; g < games; g++) {
    let p = 0, n = 0;
    while (p < 100 && n < 400) { n++; p = Math.min(100, p + 1 + rng.next(6)); p = up.get(p) ?? p; }
    tot += n;
  }
  return tot / games;
}

function center(sq: number): [number, number] { const [c, r] = cellOf(sq); return [c, r]; }
/** Do two ladders' straight segments cross (or nearly touch)? */
function cross(a: Link, b: Link) {
  const [ax, ay] = center(a.from), [bx, by] = center(a.to), [cx, cy] = center(b.from), [dx, dy] = center(b.to);
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  if (o(ax, ay, bx, by, cx, cy) !== o(ax, ay, bx, by, dx, dy) && o(cx, cy, dx, dy, ax, ay) !== o(cx, cy, dx, dy, bx, by)) return true;
  // too close in parallel
  const mx = (ax + bx) / 2, my = (ay + by) / 2, nx = (cx + dx) / 2, ny = (cy + dy) / 2;
  return Math.hypot(mx - nx, my - ny) < 1.2;
}

export class Player {
  pos = 0;
  cards: Card[] = [];
  rolls = 0;
  bites = 0;
  climbs = 0;
  finished = false;
  constructor(readonly seat: number, readonly human: boolean) {}
}

export class Rules {
  constructor(readonly layout: Layout) {}
  ladderAt(sq: number) { return this.layout.ladders.find((l) => l.from === sq) ?? null; }
  snakeAt(sq: number) { return this.layout.snakes.find((s) => s.from === sq) ?? null; }
  isCard(sq: number) { return this.layout.cards.includes(sq); }

  /** The squares a token visits for a roll (no exact roll needed: it stops on 100). */
  path(from: number, roll: number): number[] {
    const out: number[] = [];
    for (let p = from + 1; p <= Math.min(100, from + roll); p++) out.push(p);
    return out;
  }

  /** CPU card choice before rolling (index into the hand, or -1). */
  cpuCard(me: Player, all: Player[]): number {
    const lead = all.filter((o) => o !== me && !o.finished).reduce((a: Player | null, o) => (!a || o.pos > a.pos ? o : a), null);
    const iSwap = me.cards.indexOf(Card.Swap);
    if (iSwap >= 0 && lead && lead.pos - me.pos >= 12) return iSwap;
    const iDouble = me.cards.indexOf(Card.Double);
    if (iDouble >= 0 && 100 - me.pos > 14) return iDouble;
    return -1;
  }
}
