import { SysRandom } from "../../kit";

/** One pour: `Amount` layers of `Color` moved from flask From to flask To. (Port of Brew.cs.) */
export interface Pour {
  From: number;
  To: number;
  Amount: number;
  Color: number;
  /** the pour uncovered a hidden layer in the source flask */
  RevealedBelow: boolean;
}

/**
 * The rules of the liquid-sort puzzle. Flasks hold up to `Cap` layers listed bottom → top. A pour moves the contiguous
 * run of the top colour onto an empty flask or a flask whose top matches, as far as there is room. The lab is solved
 * when every flask is either empty or full of a single colour.
 */
export class Lab {
  static readonly Cap = 4;

  readonly F: number[][] = [];
  /** Parallel to F: true while a layer is still a mystery (only buried layers can be hidden). */
  readonly Hidden: boolean[][] = [];
  Colors = 0;

  get Count() { return this.F.length; }

  Clone() {
    const c = new Lab();
    c.Colors = this.Colors;
    for (let i = 0; i < this.F.length; i++) {
      c.F.push([...this.F[i]]);
      c.Hidden.push([...this.Hidden[i]]);
    }
    return c;
  }

  AddFlask() {
    this.F.push([]);
    this.Hidden.push([]);
  }

  Top(i: number) { const f = this.F[i]; return f.length === 0 ? 0 : f[f.length - 1]; }

  /** Length of the same-colour run at the top of flask i. */
  TopRun(i: number) {
    const f = this.F[i];
    if (f.length === 0) return 0;
    const c = f[f.length - 1];
    let n = 0;
    for (let k = f.length - 1; k >= 0 && f[k] === c && !this.Hidden[i][k]; k--) n++;
    return n;
  }

  IsComplete(i: number) {
    const f = this.F[i];
    if (f.length !== Lab.Cap) return false;
    for (let k = 0; k < Lab.Cap; k++) if (f[k] !== f[0] || this.Hidden[i][k]) return false;
    return true;
  }

  /** True when the flask holds a single colour (any amount) with nothing hidden. */
  IsUniform(i: number) {
    const f = this.F[i];
    for (let k = 0; k < f.length; k++) if (f[k] !== f[0] || this.Hidden[i][k]) return false;
    return true;
  }

  CanPour(a: number, b: number) {
    if (a === b || a < 0 || b < 0 || a >= this.F.length || b >= this.F.length) return false;
    if (this.F[a].length === 0 || this.F[b].length >= Lab.Cap || this.IsComplete(a)) return false;
    return this.F[b].length === 0 || this.Top(b) === this.Top(a);
  }

  Amount(a: number, b: number) { return Math.min(this.TopRun(a), Lab.Cap - this.F[b].length); }

  Apply(a: number, b: number): Pour {
    const p: Pour = { From: a, To: b, Color: this.Top(a), Amount: this.Amount(a, b), RevealedBelow: false };
    for (let k = 0; k < p.Amount; k++) {
      this.F[a].pop();
      this.Hidden[a].pop();
      this.F[b].push(p.Color);
      this.Hidden[b].push(false);
    }
    const top = this.F[a].length - 1;
    if (top >= 0 && this.Hidden[a][top]) {
      this.Hidden[a][top] = false;
      p.RevealedBelow = true;
    }
    return p;
  }

  /** Reverses p. A layer it revealed stays revealed (knowledge can't be un-learned). */
  Undo(p: Pour) {
    for (let k = 0; k < p.Amount; k++) {
      this.F[p.To].pop();
      this.Hidden[p.To].pop();
      this.F[p.From].push(p.Color);
      this.Hidden[p.From].push(false);
    }
  }

  Solved() {
    for (let i = 0; i < this.F.length; i++) if (this.F[i].length !== 0 && !this.IsComplete(i)) return false;
    return true;
  }

  HasMove() {
    for (let a = 0; a < this.F.length; a++)
      for (let b = 0; b < this.F.length; b++) if (this.CanPour(a, b)) return true;
    return false;
  }

  CompleteCount() {
    let n = 0;
    for (let i = 0; i < this.F.length; i++) if (this.IsComplete(i)) n++;
    return n;
  }

  /** Order-independent key of the lab's contents (flask order does not matter to the solver). */
  Key() {
    const parts = new Array<string>(this.F.length);
    for (let i = 0; i < this.F.length; i++) {
      let s = "";
      for (const c of this.F[i]) s += String.fromCharCode(97 + c);
      parts[i] = s;
    }
    parts.sort(); // UTF-16 code unit order = StringComparer.Ordinal
    return parts.join("|");
  }
}

/** Depth-first solver with duplicate-state pruning. Not optimal, but fast and always correct. */
export const Solver = {
  /** Returns a list of [from, to] pours that solves start, or null within the node budget. */
  Solve(start: Lab, nodeLimit = 60000): [number, number][] | null {
    const lab = start.Clone();
    // The solver reasons with full knowledge of hidden layers (it is the "hint" brain).
    for (let i = 0; i < lab.Count; i++)
      for (let k = 0; k < lab.Hidden[i].length; k++) lab.Hidden[i][k] = false;
    const visited = new Set<string>();
    const path: [number, number][] = [];
    const nodes = { n: 0 };
    return Solver.Dfs(lab, visited, path, nodes, nodeLimit) ? path : null;
  },

  Dfs(lab: Lab, visited: Set<string>, path: [number, number][], nodes: { n: number }, limit: number): boolean {
    if (lab.Solved()) return true;
    if (++nodes.n > limit) return false;
    const key = lab.Key();
    if (visited.has(key)) return false;
    visited.add(key);

    const moves = Solver.Moves(lab);
    for (const [a, b] of moves) {
      const p = lab.Apply(a, b);
      path.push([a, b]);
      if (Solver.Dfs(lab, visited, path, nodes, limit)) return true;
      path.pop();
      lab.Undo(p);
      if (nodes.n > limit) return false;
    }
    return false;
  },

  Moves(lab: Lab): [number, number, number][] {
    const list: [number, number, number][] = [];
    let firstEmpty = -1;
    for (let i = 0; i < lab.Count; i++)
      if (lab.F[i].length === 0) { firstEmpty = i; break; }

    for (let a = 0; a < lab.Count; a++) {
      if (lab.F[a].length === 0 || lab.IsComplete(a)) continue;
      const uniform = lab.IsUniform(a);
      const run = lab.TopRun(a);
      for (let b = 0; b < lab.Count; b++) {
        if (!lab.CanPour(a, b)) continue;
        if (lab.F[b].length === 0) {
          if (b !== firstEmpty || uniform) continue; // empties are interchangeable; moving a pure flask is pointless
          list.push([a, b, 1]);
          continue;
        }
        const amount = lab.Amount(a, b);
        let score = 4;
        if (amount === run) score += 3; // moves the whole run: uncovers something
        if (lab.IsUniform(b)) score += 2; // builds towards a complete flask
        if (uniform && lab.F[a].length === amount) score += 1;
        list.push([a, b, score]);
      }
    }
    list.sort((x, y) => y[2] - x[2]);
    return list;
  },
};

export interface Spec { Colors: number; Empties: number; Mystery: boolean }

/** Deterministic, solvable level generation. */
export const Generator = {
  ForLevel(level: number): Spec {
    let colors = Math.min(12, 2 + Math.trunc((level + 1) / 3));
    if (level === 1) colors = 2;
    return { Colors: colors, Empties: 2, Mystery: level >= 12 && level % 3 === 0 };
  },

  /** Builds level `level` (always the same for everyone) and a known solution. */
  Build(level: number): { lab: Lab; solution: [number, number][] } {
    const spec = Generator.ForLevel(level);
    const rng = new SysRandom(level * 7919 + 1234);
    for (let attempt = 0; ; attempt++) {
      const lab = Generator.Shuffled(spec, rng);
      if (!Generator.Interesting(lab, spec) && attempt < 400) continue;
      const solution = Solver.Solve(lab, 40000);
      if (!solution) continue;
      if (solution.length < spec.Colors + 1 && attempt < 400) continue; // too trivial
      if (spec.Mystery)
        for (let i = 0; i < lab.Count; i++)
          for (let k = 0; k < lab.F[i].length - 1; k++) lab.Hidden[i][k] = true;
      return { lab, solution };
    }
  },

  Shuffled(spec: Spec, rng: SysRandom) {
    const pool: number[] = [];
    for (let c = 1; c <= spec.Colors; c++)
      for (let k = 0; k < Lab.Cap; k++) pool.push(c);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.next(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const lab = new Lab();
    lab.Colors = spec.Colors;
    for (let f = 0; f < spec.Colors; f++) {
      lab.AddFlask();
      for (let k = 0; k < Lab.Cap; k++) {
        lab.F[f].push(pool[f * Lab.Cap + k]);
        lab.Hidden[f].push(false);
      }
    }
    for (let e = 0; e < spec.Empties; e++) lab.AddFlask();
    return lab;
  },

  /** Rejects starts with long single-colour runs (they make levels feel half-solved). */
  Interesting(lab: Lab, _spec: Spec) {
    for (let i = 0; i < lab.Count; i++) {
      const f = lab.F[i];
      let run = 1;
      for (let k = 1; k < f.length; k++) {
        run = f[k] === f[k - 1] ? run + 1 : 1;
        if (run >= 3) return false;
      }
    }
    return true;
  },
};
