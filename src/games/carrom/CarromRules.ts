import {
  BaseHalf, BaseY, CarromSim, castDisc, colourOf, H, MaxSpeed, N, Pockets, Queen, RC, RP, Rng, RS, segDist, speedFor,
  StrikeRecord, Striker, strikerSpeedForCoin,
} from "./CarromPhysics";

/**
 * CARROM FLICK rules (pure logic, no kit): CLASSIC (player 0 white, player 1 black; pocket your colour, cover the
 * queen, fouls return coins) and FREESTYLE (every coin scores: white 20, black 10, queen 50; a pocketed striker costs
 * 10), for one or two sides. Solo boards use colour -1 (any coin is yours). Plus the CPU: it lines the striker up
 * along its baseline for every (coin, pocket) pair, direct and (on hard) off the side walls, simulates the best
 * candidates and keeps the one with the best outcome.
 */

export const Classic = 0, Freestyle = 1;
export const Points = [20, 10, 50];

export interface Outcome {
  foul: boolean; foulReason: string;
  continues: boolean;
  own: number; opp: number; queen: boolean;
  queenCovered: boolean; queenReturned: boolean;
  returned: number[];
  points: number[];
  over: boolean;
  text: string;
}

export class Board {
  turn = 0;
  /** queen: 0 on board / 1 pocketed, waiting for a cover by queenBy / 2 covered by queenBy */
  queenState = 0; queenBy = -1;
  due = [0, 0];
  score = [0, 0];
  pots = [0, 0];
  fouls = [0, 0];
  strikes = 0;
  over = false; winner = -1; reason = "";
  breakShot = true;

  constructor(public rules: number, public players: number) {}

  clone() {
    const b = new Board(this.rules, this.players);
    b.turn = this.turn; b.queenState = this.queenState; b.queenBy = this.queenBy;
    b.due = [...this.due]; b.score = [...this.score]; b.pots = [...this.pots]; b.fouls = [...this.fouls];
    b.strikes = this.strikes; b.over = this.over; b.winner = this.winner; b.reason = this.reason; b.breakShot = this.breakShot;
    return b;
  }

  /** Colour a player pockets (-1 = any coin, solo). */
  colourOf(p: number) { return this.players === 1 || this.rules === Freestyle ? -1 : p; }

  /** Coins of colour c still on the board. */
  static left(sim: CarromSim, c: number) {
    let n = 0;
    for (let i = 1; i < N; i++) if (sim.on[i] && colourOf(i) === c) n++;
    return n;
  }

  static coinsLeft(sim: CarromSim) { let n = 0; for (let i = 1; i < N; i++) if (sim.on[i]) n++; return n; }

  /** Coins the player should aim at. */
  targets(p: number, sim: CarromSim) {
    const c = this.colourOf(p), out: number[] = [];
    for (let i = 1; i < N; i++) {
      if (!sim.on[i]) continue;
      const ci = colourOf(i);
      if (c < 0 || ci === c || (ci === 2 && this.queenState === 0)) out.push(i);
    }
    return out;
  }

  /** Judges a finished strike and updates the board (and the sim: returned coins go back on the centre). */
  resolve(sim: CarromSim, rec: StrikeRecord): Outcome {
    const me = this.turn, op = 1 - me;
    const o: Outcome = { foul: false, foulReason: "", continues: false, own: 0, opp: 0, queen: false, queenCovered: false, queenReturned: false, returned: [], points: [0, 0], over: false, text: "" };
    this.strikes++;
    this.breakShot = false;
    const back = (n: number) => { sim.spot(n); o.returned.push(n); };
    if (this.rules === Freestyle || this.players === 1) {
      for (const n of rec.potted) {
        const pts = Points[colourOf(n)];
        o.points[me] += pts;
        if (n === Queen) o.queen = true; else o.own++;
      }
      if (rec.strikerPotted) { o.foul = true; o.foulReason = "STRIKER POCKETED"; o.points[me] -= this.rules === Freestyle ? 10 : 0; this.fouls[me]++; }
      this.score[me] = Math.max(0, this.score[me] + o.points[me]);
      this.pots[me] += rec.potted.length;
      o.continues = this.players === 1 || (!o.foul && rec.potted.length > 0);
      if (Board.coinsLeft(sim) === 0) { this.finish(sim); o.over = true; }
      else if (!o.continues) this.turn = op;
      return o;
    }
    // ---- classic, two sides
    const mine = this.colourOf(me), theirs = this.colourOf(op);
    const ownNow: number[] = [];
    for (const n of rec.potted) {
      const c = colourOf(n);
      if (c === 2) o.queen = true;
      else if (c === mine) { o.own++; ownNow.push(n); }
      else o.opp++;
    }
    this.pots[me] += o.own;
    const queenWasPending = this.queenState === 1 && this.queenBy === me;
    if (rec.strikerPotted) {
      o.foul = true; o.foulReason = "STRIKER POCKETED";
      this.fouls[me]++;
      // own coins from this strike come back, plus one penalty coin (or a due)
      for (const n of ownNow) back(n);
      this.pots[me] -= ownNow.length;
      const pen = this.pottedOf(sim, mine);
      if (pen >= 0) { back(pen); this.pots[me]--; } else this.due[me]++;
      if (o.queen || queenWasPending) { back(Queen); this.queenState = 0; this.queenBy = -1; o.queenReturned = true; }
      this.turn = op;
      o.text = "FOUL";
      this.checkEnd(sim, o);
      return o;
    }
    // dues are paid with the first coins you pocket
    let paid = 0;
    while (this.due[me] > 0 && paid < ownNow.length) { back(ownNow[paid]); paid++; this.due[me]--; this.pots[me]--; }
    if (o.queen) {
      this.queenState = 1; this.queenBy = me;
      if (o.own > 0) { this.queenState = 2; o.queenCovered = true; }
    } else if (queenWasPending) {
      if (o.own > 0) { this.queenState = 2; o.queenCovered = true; }
      else { back(Queen); this.queenState = 0; this.queenBy = -1; o.queenReturned = true; }
    }
    // the queen must be pocketed and covered before anyone's last coin
    const queenOpen = this.queenState !== 2;
    if (queenOpen) {
      for (const c of [mine, theirs]) {
        if (Board.left(sim, c) === 0) {
          // put the last one back
          for (let i = rec.potted.length - 1; i >= 0; i--) { const n = rec.potted[i]; if (colourOf(n) === c && !sim.on[n]) { back(n); if (c === mine) { o.own--; this.pots[me]--; } break; } }
          o.text = "COVER THE QUEEN FIRST";
        }
      }
    }
    o.continues = o.own > 0 || o.queen;
    if (!o.continues) this.turn = op;
    this.checkEnd(sim, o);
    return o;
  }

  /** A coin of colour c that is off the board (a penalty coin to return), -1 if none. */
  private pottedOf(sim: CarromSim, c: number) {
    for (let i = 1; i < N; i++) if (!sim.on[i] && colourOf(i) === c) return i;
    return -1;
  }

  private checkEnd(sim: CarromSim, o: Outcome) {
    if (this.queenState !== 2) return;
    for (const p of [this.turn, 1 - this.turn]) {
      const c = this.colourOf(p);
      if (Board.left(sim, c) === 0 && this.due[p] === 0) {
        this.over = true; this.winner = p; o.over = true;
        // board points: the loser's coins left, +3 for the queen if the winner covered it
        this.score[p] = Board.left(sim, 1 - c) + (this.queenBy === p ? 3 : 0);
        this.reason = "BOARD CLEARED";
        return;
      }
    }
  }

  private finish(sim: CarromSim) {
    void sim;
    this.over = true;
    this.winner = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
    this.reason = "BOARD CLEARED";
  }

  /** Freestyle timer ran out. */
  timeUp() {
    this.over = true;
    this.winner = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
    this.reason = "TIME UP";
  }
}

// ------------------------------------------------------------------ CPU

export interface AiLevel { noiseDeg: number; powerNoise: number; candidates: number; banks: boolean; samples: number }
export const AiLevels: AiLevel[] = [
  { noiseDeg: 3.2, powerNoise: 0.12, candidates: 4, banks: false, samples: 0 },
  { noiseDeg: 1.5, powerNoise: 0.07, candidates: 7, banks: false, samples: 0 },
  { noiseDeg: 0.55, powerNoise: 0.04, candidates: 10, banks: true, samples: 4 },
];

export interface ShotPlan { x: number; dx: number; dy: number; speed: number; score: number; kind: string; target: number }

interface Cand { x: number; dx: number; dy: number; speed: number; geo: number; target: number; kind: string }

const Contact = RC + RS;

function pathClear(sim: CarromSim, ax: number, ay: number, bx: number, by: number, clearance: number, skipA: number, skipB: number) {
  for (let k = 1; k < N; k++) {
    if (k === skipA || k === skipB || !sim.on[k]) continue;
    if (segDist(sim.x[k], sim.y[k], ax, ay, bx, by) < clearance) return false;
  }
  return true;
}

/** Candidate pots for a striker on baseline `side` (y = by): every (target, pocket) pair, best x along the line. */
export function potCandidates(sim: CarromSim, by: number, targets: number[], banks: boolean, rng: Rng | null): Cand[] {
  const out: Cand[] = [];
  const xs: number[] = [];
  for (let i = 0; i <= 20; i++) xs.push(-BaseHalf + (2 * BaseHalf * i) / 20);
  for (const t of targets) {
    const cx = sim.x[t], cy = sim.y[t];
    for (let p = 0; p < 4; p++) {
      const [px0, py0] = Pockets[p];
      // aim slightly inside the pocket mouth
      const px = px0 - Math.sign(px0) * 0.12, py = py0 - Math.sign(py0) * 0.12;
      let ux = px - cx, uy = py - cy;
      const dObj = Math.hypot(ux, uy);
      if (dObj < 0.05) continue;
      ux /= dObj; uy /= dObj;
      const gx = cx - ux * Contact, gy = cy - uy * Contact;
      if (Math.abs(gx) > H - RS || Math.abs(gy) > H - RS) continue;
      if (!pathClear(sim, cx, cy, px, py, RC * 2 + 0.02, t, -1)) continue;
      // direct
      let best: Cand | null = null;
      for (const x of xs) {
        if (!sim.fits(Striker, x, by)) continue;
        let ax = gx - x, ay = gy - by;
        const dCue = Math.hypot(ax, ay);
        if (dCue < 0.3) continue;
        ax /= dCue; ay /= dCue;
        const cut = ax * ux + ay * uy;
        if (cut < 0.3) continue;
        if (!pathClear(sim, x, by, gx, gy, Contact + 0.02, t, -1)) continue;
        const hit = castDisc(sim, x, by, ax, ay);
        if (hit.coin !== t) continue;
        const geo = Math.pow(cut, 1.6) * Math.exp(-(dCue + dObj) / 45);
        if (!best || geo > best.geo) {
          const vc = speedFor(dObj + 0.6, 1.2);
          const vs = strikerSpeedForCoin(vc, cut);
          best = { x, dx: ax, dy: ay, speed: speedFor(dCue, vs), geo, target: t, kind: "pot" };
        }
      }
      if (best) out.push(best);
      // bank off a side wall: aim at the ghost mirrored in the wall
      if (banks) {
        for (const wx of [H - RS, -(H - RS)]) {
          const mgx = 2 * wx - gx;
          let bestB: Cand | null = null;
          for (const x of xs) {
            if (!sim.fits(Striker, x, by)) continue;
            const t1 = (wx - x) / (mgx - x);
            if (t1 <= 0 || t1 >= 1) continue;
            const hy = by + (gy - by) * t1;
            if (Math.abs(hy) > H - 1.6) continue;
            let bx = gx - wx, byy = gy - hy;
            const l2 = Math.hypot(bx, byy);
            bx /= l2; byy /= l2;
            const cut = bx * ux + byy * uy;
            if (cut < 0.45) continue;
            if (!pathClear(sim, x, by, wx, hy, Contact + 0.04, t, -1) || !pathClear(sim, wx, hy, gx, gy, Contact + 0.04, t, -1)) continue;
            const dCue = Math.hypot(wx - x, hy - by) + l2;
            const geo = 0.55 * Math.pow(cut, 1.6) * Math.exp(-(dCue + dObj) / 45);
            if (!bestB || geo > bestB.geo) {
              const vc = speedFor(dObj + 0.6, 1.2);
              const vs = strikerSpeedForCoin(vc, cut) / 0.66;
              bestB = { x, dx: wx - x, dy: hy - by, speed: speedFor(dCue, vs) * 1.08, geo, target: t, kind: "bank" };
            }
          }
          if (bestB) out.push(bestB);
        }
      }
    }
  }
  if (rng) for (const c of out) c.geo *= 1 + rng.range(-0.05, 0.05);
  out.sort((a, b) => b.geo - a.geo);
  return out;
}

export class CarromAI {
  constructor(public level: AiLevel, public rng: Rng) {}

  private rollout(sim: CarromSim, board: Board, player: number, x: number, dx: number, dy: number, speed: number) {
    const s = sim.clone();
    s.events = null;
    const by = player === 0 ? -BaseY : BaseY;
    s.place(Striker, x, by);
    s.shoot(dx, dy, speed);
    s.runToRest(14);
    const b = board.clone();
    b.turn = player;
    const o = b.resolve(s, s.record);
    let score = 0;
    if (b.rules === Freestyle || b.players === 1) score = o.points[player] * 10 + (o.foul ? -120 : 0);
    else {
      score = o.own * 220 + (o.queenCovered ? 300 : o.queen ? 120 : 0) - o.opp * 120 - (o.foul ? 400 : 0) - (o.queenReturned ? 60 : 0);
      if (b.over) score += b.winner === player ? 5000 : -5000;
    }
    // leave: how many easy pots the next strike would have
    if (o.continues && !o.foul && !b.over) {
      const next = potCandidates(s, by, b.targets(player, s), false, null);
      score += Math.min(3, next.length) * 15 + (next.length ? next[0].geo * 60 : 0);
    }
    return { score, potted: o.own > 0 || o.queen || (b.rules === Freestyle && s.record.potted.length > 0) };
  }

  /** The opening break: from near the middle, hard into the pack. */
  planBreak(sim: CarromSim, player: number): ShotPlan {
    const by = player === 0 ? -BaseY : BaseY;
    const x = this.rng.range(-1.5, 1.5);
    const tx = this.rng.range(-0.3, 0.3);
    return { x: sim.freeBaseX(player, x), dx: tx - x, dy: -by, speed: MaxSpeed * this.rng.range(0.82, 0.97), score: 0, kind: "break", target: Queen };
  }

  *plan(sim: CarromSim, board: Board, player: number): Generator<void, ShotPlan, void> {
    const L = this.level;
    const by = player === 0 ? -BaseY : BaseY;
    const targets = board.targets(player, sim);
    const cands = potCandidates(sim, by, targets, L.banks, this.rng).slice(0, L.candidates);
    const options: ShotPlan[] = [];
    for (const c of cands) {
      for (const k of [1, 1.3, 1.75]) {
        const speed = Math.min(MaxSpeed * 0.95, Math.max(4, c.speed * k));
        const r = this.rollout(sim, board, player, c.x, c.dx, c.dy, speed);
        options.push({ x: c.x, dx: c.dx, dy: c.dy, speed, score: r.score + c.geo * 40, kind: c.kind, target: c.target });
        yield;
      }
    }
    options.sort((a, b) => b.score - a.score);
    if (L.samples > 0) {
      for (const o of options.filter((q) => q.score > 100).slice(0, 3)) {
        let total = 0, ok = 0;
        const sig = Math.max(0.3, L.noiseDeg) * Math.PI / 180;
        for (let i = 0; i < L.samples; i++) {
          const a = (i % 2 === 0 ? 1 : -1) * sig * (0.7 + Math.floor(i / 2) * 0.6);
          const c = Math.cos(a), s = Math.sin(a);
          const r = this.rollout(sim, board, player, o.x, o.dx * c - o.dy * s, o.dx * s + o.dy * c, o.speed);
          total += r.score; if (r.potted) ok++;
          yield;
        }
        o.score = o.score * (0.4 + 0.6 * ok / L.samples) + (total / L.samples) * 0.3;
      }
      options.sort((a, b) => b.score - a.score);
    }
    if (options.length && options[0].score > 150) return options[0];
    // nothing clean: sample shots at the coins (and a few blind ones) and keep the best simulated outcome
    const pool: ShotPlan[] = [...options];
    const xs = [-5, -2.5, 0, 2.5, 5];
    for (const t of targets.slice(0, 8)) {
      for (const x0 of xs) {
        const x = sim.freeBaseX(player, x0);
        const dx = sim.x[t] - x, dy = sim.y[t] - by;
        for (const sp of [18, 32]) {
          const r = this.rollout(sim, board, player, x, dx, dy, sp);
          pool.push({ x, dx, dy, speed: sp, score: r.score, kind: "nudge", target: t });
        }
        yield;
      }
    }
    for (let i = 0; i < 10; i++) {
      const x = sim.freeBaseX(player, this.rng.range(-BaseHalf, BaseHalf));
      const a = (by < 0 ? 1 : -1) * this.rng.range(0.25, Math.PI - 0.25);
      const dx = Math.cos(a) * (by < 0 ? 1 : 1), dy = Math.abs(Math.sin(a)) * (by < 0 ? 1 : -1);
      const sp = this.rng.range(20, 45);
      const r = this.rollout(sim, board, player, x, dx, dy, sp);
      pool.push({ x, dx, dy, speed: sp, score: r.score, kind: "blind", target: -1 });
      yield;
    }
    pool.sort((a, b) => b.score - a.score);
    return pool[0] ?? { x: 0, dx: 0, dy: -by, speed: 30, score: 0, kind: "blind", target: -1 };
  }

  noisy(p: ShotPlan): ShotPlan {
    const L = this.level;
    const k = p.kind === "break" ? 0.4 : 1;
    const a = this.rng.gauss() * L.noiseDeg * k * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const l = Math.hypot(p.dx, p.dy) || 1;
    const dx = p.dx / l, dy = p.dy / l;
    return { ...p, dx: dx * c - dy * s, dy: dx * s + dy * c, speed: Math.min(MaxSpeed, p.speed * (1 + this.rng.gauss() * L.powerNoise)) };
  }
}

export { RP };
