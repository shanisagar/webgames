/**
 * CASH-OUT ROCKET rules (pure logic, no rendering). A rocket climbs with a multiplier m(t) = e^(Rate·t) from 1.00×.
 * Each round's crash point is drawn from a fair distribution, P(crash ≥ x) = 1/x, so every cash-out target has the
 * same average value: the game is about nerve and reading the score gap, not about odds. Points only.
 */

export const Rate = 0.17;
export const Stake = 100;
export const Rounds = 5;
export const MaxCrash = 50;

export const multAt = (t: number) => Math.exp(Rate * t);
export const timeAt = (m: number) => Math.log(Math.max(1, m)) / Rate;

/** Fair crash point for a uniform u in [0, 1): 1 / (1 - u), floored to hundredths, capped. */
export function crashPoint(u: number) {
  const c = 1 / Math.max(1e-6, 1 - u);
  return Math.min(MaxCrash, Math.max(1, Math.floor(c * 100) / 100));
}

/** Small deterministic RNG (mulberry32) so a match's crash points are fixed when it starts. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Seat {
  total: number;
  /** Multiplier this seat cashed out at this round, or 0. */
  cashed: number;
  bank: number;
  shields: number;
  shieldOn: boolean;
  bot: boolean;
  roundsWon: number;
  best: number;
}
export const newSeat = (bot = false, shields = 1): Seat => ({ total: 0, cashed: 0, bank: 0, shields, shieldOn: false, bot, roundsWon: 0, best: 0 });

// ------------------------------------------------------------------ computer player

export interface BotLevel { name: string; lo: number; hi: number; adapt: number; late: number; shieldUse: number }
export const BotLevels: BotLevel[] = [
  { name: "EASY", lo: 1.3, hi: 3.2, adapt: 0, late: 0.35, shieldUse: 0.3 },
  { name: "MEDIUM", lo: 1.4, hi: 2.8, adapt: 0.55, late: 0.15, shieldUse: 0.6 },
  { name: "HARD", lo: 1.35, hi: 2.4, adapt: 1, late: 0.04, shieldUse: 1 },
];

/**
 * A bot cashes out at a hidden target. Smarter bots adapt it to the score gap: when behind with few rounds left they
 * reach higher, when ahead they lock points in early, and in the last round they cash the moment they're safe.
 */
export class RocketBot {
  target = 2;
  private wait = 0;
  constructor(readonly level: BotLevel, private rand: () => number = Math.random) {}

  /** Called at launch. */
  plan(me: Seat, opp: Seat, roundsLeft: number) {
    const L = this.level;
    let t = L.lo + (L.hi - L.lo) * Math.pow(this.rand(), 1.3);
    const gap = (opp.total - me.total) / Stake; // >0: behind
    if (L.adapt > 0) {
      const perRound = gap / Math.max(1, roundsLeft);
      if (gap > 0) t += L.adapt * Math.min(4, perRound * 1.1);
      else t = Math.max(1.15, t - L.adapt * Math.min(0.9, -perRound * 0.6));
    }
    this.target = Math.max(1.1, Math.min(MaxCrash - 1, t));
    this.wait = 0;
  }

  /** True when the bot cashes out this frame. */
  update(m: number, dt: number, me: Seat, opp: Seat, roundsLeft: number, oppDone: boolean) {
    if (me.cashed > 0) return false;
    const L = this.level;
    let target = this.target;
    if (L.adapt >= 1 && roundsLeft === 1) {
      // last round: hard bot does exact arithmetic once the rival has banked (or busted)
      const need = (opp.total + opp.bank - me.total) / Stake;
      if (oppDone) target = need < 1 ? 1.01 : need + 0.03;
      else if (me.total > opp.total) target = Math.min(target, 1.25);
    } else if (L.adapt > 0 && oppDone && roundsLeft === 1) {
      const need = (opp.total + opp.bank - me.total) / Stake;
      target = need < 1 ? Math.min(target, 1.3) : Math.max(target, need + 0.1);
    }
    if (m >= target) {
      this.wait += dt;
      if (this.wait >= L.late * (0.5 + this.rand())) return true;
    }
    return false;
  }

  wantsShield(): boolean { return this.target >= 1.8 && this.rand() < this.level.shieldUse; }
}
