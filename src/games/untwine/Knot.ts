import { SysRandom } from "../../kit";

/**
 * The rules of UNTWINE (pure logic, no Unity types). (Port of Knot.cs.)
 * Rings sit on a triangular lattice; rings on neighbouring points overlap and are linked. Every ring has one
 * gap that points along one of the six lattice directions. A link between two rings is open when either ring's
 * gap faces the other. A ring whose links are all open slips free and leaves the knot, which can free others in
 * a chain. Tapping a ring turns it one step clockwise; a gold coupler makes two rings turn together; locked rings
 * never turn.
 */
export class Knot {
  /** Lattice steps for the six directions; direction d points at d × 60°. */
  static readonly Dirs: [number, number][] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

  N = 0;
  A: number[] = []; B: number[] = []; O: number[] = []; Partner: number[] = [];
  Locked: boolean[] = []; Gone: boolean[] = [];
  /** Neighbour ring index per direction (-1 = none). */
  Nb: number[][] = [];

  constructor(cells?: [number, number][]) {
    if (!cells) return;
    const N = (this.N = cells.length);
    this.A = new Array(N).fill(0);
    this.B = new Array(N).fill(0);
    this.O = new Array(N).fill(0);
    this.Partner = new Array(N).fill(-1);
    this.Locked = new Array(N).fill(false);
    this.Gone = new Array(N).fill(false);
    this.Nb = new Array(N);
    const index = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      this.A[i] = cells[i][0];
      this.B[i] = cells[i][1];
      index.set(this.A[i] + "," + this.B[i], i);
    }
    for (let i = 0; i < N; i++) {
      this.Nb[i] = new Array(6);
      for (let d = 0; d < 6; d++)
        this.Nb[i][d] = index.get(this.A[i] + Knot.Dirs[d][0] + "," + (this.B[i] + Knot.Dirs[d][1])) ?? -1;
    }
  }

  Clone(): Knot {
    const k = new Knot();
    k.N = this.N;
    k.A = this.A; k.B = this.B; k.Nb = this.Nb; // layout is immutable and shared
    k.O = this.O.slice();
    k.Partner = this.Partner.slice();
    k.Locked = this.Locked.slice();
    k.Gone = this.Gone.slice();
    return k;
  }

  CopyFrom(other: Knot) {
    for (let i = 0; i < this.N; i++) {
      this.O[i] = other.O[i];
      this.Partner[i] = other.Partner[i];
      this.Locked[i] = other.Locked[i];
      this.Gone[i] = other.Gone[i];
    }
  }

  get Remaining() {
    let n = 0;
    for (let i = 0; i < this.N; i++) if (!this.Gone[i]) n++;
    return n;
  }

  /** Direction index from ring i to its neighbour j, or -1 if they are not neighbours. */
  DirTo(i: number, j: number) {
    for (let d = 0; d < 6; d++) if (this.Nb[i][d] === j) return d;
    return -1;
  }

  LinkOpen(i: number, d: number) {
    const j = this.Nb[i][d];
    return j < 0 || this.Gone[j] || this.O[i] === d || this.O[j] === (d + 3) % 6;
  }

  IsFree(i: number) {
    if (this.Gone[i]) return false;
    for (let d = 0; d < 6; d++)
      if (!this.LinkOpen(i, d)) return false;
    return true;
  }

  CanTap(i: number) { return i >= 0 && i < this.N && !this.Gone[i] && !this.Locked[i]; }

  /**
   * Turns ring i (and its coupled partner) one step clockwise, then releases every ring that slipped free.
   * Returns the release waves (each wave is a list of rings that left together), or null if the ring can't turn.
   */
  Tap(i: number): number[][] | null {
    if (!this.CanTap(i)) return null;
    this.Turn(i);
    const p = this.Partner[i];
    if (p >= 0 && !this.Gone[p] && !this.Locked[p]) this.Turn(p);
    return this.Resolve();
  }

  private Turn(i: number) { this.O[i] = (this.O[i] + 5) % 6; } // clockwise

  Resolve(): number[][] {
    const waves: number[][] = [];
    for (;;) {
      let wave: number[] | null = null;
      for (let i = 0; i < this.N; i++)
        if (this.IsFree(i)) (wave ??= []).push(i);
      if (!wave) break;
      for (const i of wave) this.Gone[i] = true;
      waves.push(wave);
    }
    return waves;
  }

  FreeCount() {
    let n = 0;
    for (let i = 0; i < this.N; i++) if (this.IsFree(i)) n++;
    return n;
  }
}

/**
 * Greedy planner: repeatedly picks the ring that is cheapest to release (turn every other neighbour to face it,
 * then turn it to face the last one), simulating couplers and chain releases exactly. Not optimal, but a solid
 * par and an honest hint.
 */
export const Planner = {
  Solve(start: Knot, rng: SysRandom, maxTaps = 400): number[] | null {
    let s = start.Clone();
    const taps: number[] = [];
    const nbs: number[] = [];
    while (s.Remaining > 0) {
      let bestSim: Knot | null = null;
      let bestSeq: number[] | null = null;
      let bestScore = Number.MAX_VALUE;
      for (let x = 0; x < s.N; x++) {
        if (s.Gone[x]) continue;
        nbs.length = 0;
        for (let d = 0; d < 6; d++) {
          const j = s.Nb[x][d];
          if (j >= 0 && !s.Gone[j]) nbs.push(j);
        }
        const targets = Math.max(1, nbs.length);
        for (let t = 0; t < targets; t++) {
          const y = nbs.length > 0 ? nbs[t] : -1;
          const sim = s.Clone();
          const seq: number[] = [];
          if (!Planner.Release(sim, x, y, nbs, seq) || seq.length === 0) continue;
          const score = seq.length + rng.nextDouble() * 0.9 - (s.Remaining - sim.Remaining) * 0.05;
          if (score < bestScore) {
            bestScore = score;
            bestSim = sim;
            bestSeq = seq;
          }
        }
      }
      if (!bestSim) return null;
      s = bestSim;
      taps.push(...bestSeq!);
      if (taps.length > maxTaps) return null;
    }
    return taps;
  },

  Release(sim: Knot, x: number, y: number, nbs: number[], seq: number[]) {
    for (const z of nbs) {
      if (z === y) continue;
      if (sim.Gone[x]) return true;
      if (sim.Gone[z]) continue;
      const dz = sim.DirTo(z, x);
      if (!Planner.Spin(sim, z, dz, x, seq)) return false;
    }
    if (sim.Gone[x]) return true;
    if (y >= 0 && !sim.Gone[y]) {
      const dy = sim.DirTo(x, y);
      if (!Planner.Spin(sim, x, dy, x, seq)) return false;
    }
    return sim.Gone[x];
  },

  /** Turns ring until it faces dir (or watch leaves). */
  Spin(sim: Knot, ring: number, dir: number, watch: number, seq: number[]) {
    for (let guard = 0; !sim.Gone[ring] && !sim.Gone[watch] && sim.O[ring] !== dir; guard++) {
      if (guard >= 6 || !sim.CanTap(ring)) return false;
      sim.Tap(ring);
      seq.push(ring);
    }
    return true;
  },

  /** Best of several randomized greedy runs. */
  Best(start: Knot, seed: number, runs: number): number[] | null {
    const rng = new SysRandom(seed);
    let best: number[] | null = null;
    for (let r = 0; r < runs; r++) {
      const plan = Planner.Solve(start, rng);
      if (plan && (!best || plan.length < best.length)) best = plan;
    }
    return best;
  },
};

export interface Spec { Rings: number; Couplers: number; Locked: number }

export const KnotGenerator = {
  ForLevel(level: number): Spec {
    const rings = level <= 4 ? level + 1 : Math.min(19, 4 + Math.trunc(level / 2));
    const couplers = level < 6 ? 0 : Math.min(Math.trunc(rings / 4), 1 + Math.trunc((level - 6) / 6));
    const locked = level < 12 ? 0 : Math.min(3, 1 + Math.trunc((level - 12) / 10));
    return { Rings: rings, Couplers: couplers, Locked: locked };
  },

  /** Builds level `level` (identical for everyone) and its par (planner's best tap count). */
  Build(level: number): [Knot, number] {
    const spec = KnotGenerator.ForLevel(level);
    const rng = new SysRandom(level * 104729 + 7);
    for (let attempt = 0; ; attempt++) {
      const knot = new Knot(KnotGenerator.Shape(spec.Rings, rng));
      KnotGenerator.AddCouplers(knot, spec.Couplers, rng);
      KnotGenerator.AddLocks(knot, spec.Locked, rng);
      if (!KnotGenerator.Scramble(knot, rng)) continue;
      const plan = Planner.Best(knot, rng.next(), 10);
      if (!plan) continue;
      if (plan.length < Math.max(1, knot.N - 1) && attempt < 300) continue; // too easy
      return [knot, plan.length];
    }
  },

  /** A compact, mirror-symmetric blob of lattice points. */
  Shape(n: number, rng: SysRandom): [number, number][] {
    const set = new Set<string>(["0,0"]);
    const order: [number, number][] = [[0, 0]];
    const mirror = n > 3;
    while (order.length < n) {
      let pick: [number, number] = [0, 0];
      let best = -Number.MAX_VALUE;
      for (const c of order)
        for (const [da, db] of Knot.Dirs) {
          const p: [number, number] = [c[0] + da, c[1] + db];
          if (set.has(p[0] + "," + p[1])) continue;
          let touching = 0;
          for (const [ea, eb] of Knot.Dirs)
            if (set.has(p[0] + ea + "," + (p[1] + eb))) touching++;
          const score = Math.min(touching, 3) * 1.4 + rng.nextDouble() * 2.2;
          if (score > best) {
            best = score;
            pick = p;
          }
        }
      set.add(pick[0] + "," + pick[1]);
      order.push(pick);
      const m: [number, number] = [-pick[0] - pick[1], pick[1]];
      const mk = m[0] + "," + m[1];
      if (mirror && order.length < n && !set.has(mk)) { set.add(mk); order.push(m); }
    }
    return order;
  },

  AddCouplers(k: Knot, count: number, rng: SysRandom) {
    for (let tries = 0; tries < 60 && count > 0; tries++) {
      const i = rng.next(k.N), d = rng.next(6), j = k.Nb[i][d];
      if (j < 0 || k.Partner[i] >= 0 || k.Partner[j] >= 0) continue;
      k.Partner[i] = j;
      k.Partner[j] = i;
      count--;
    }
  },

  AddLocks(k: Knot, count: number, rng: SysRandom) {
    for (let tries = 0; tries < 60 && count > 0; tries++) {
      const i = rng.next(k.N);
      if (k.Locked[i] || k.Partner[i] >= 0) continue;
      k.Locked[i] = true;
      count--;
    }
  },

  /** Random gap directions with no ring free at the start. */
  Scramble(k: Knot, rng: SysRandom) {
    for (let i = 0; i < k.N; i++) k.O[i] = rng.next(6);
    for (let pass = 0; pass < 40; pass++) {
      let any = false;
      for (let i = 0; i < k.N; i++) {
        if (!k.IsFree(i)) continue;
        any = true;
        // Re-roll this ring, or a neighbour if this one is locked.
        let target = i;
        if (k.Locked[i]) {
          for (let d = 0; d < 6; d++) {
            const j = k.Nb[i][d];
            if (j >= 0 && !k.Locked[j]) { target = j; break; }
          }
        }
        k.O[target] = rng.next(6);
      }
      if (!any) return true;
    }
    return false;
  },
};
