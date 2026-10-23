/**
 * The CPU's pattern spotter. It watches the opponent's throws and predicts the next one from a blend of
 * frequency, first-order Markov (what follows their last throw), second-order Markov (their last two throws) and a
 * "reaction" model (what they throw after the CPU's last throw). It then plays the counter. Easy is mostly random.
 * Pure logic (no kit imports) so it can be tested headlessly.
 */

export const beats = (a: number, b: number) => (a - b + 3) % 3 === 1;
export const counter = (m: number) => (m + 1) % 3;

export class RpsBot {
  private freq = [1, 1, 1];
  private m1: number[][] = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
  private m2: number[][] = Array.from({ length: 9 }, () => [1, 1, 1]);
  private react: number[][] = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
  private hist: number[] = [];
  private mine: number[] = [];
  /** Model scores: how often each model's prediction was right (it trusts the better ones more). */
  private hitsM = [1, 1, 1, 1];
  private lastPred = [-1, -1, -1, -1];
  lastConfidence = 0;

  constructor(public diff: number, private rnd: () => number = Math.random) {}

  /** Probability of the opponent's next throw. */
  predict(): number[] {
    const h = this.hist, n = h.length;
    const models: number[][] = [];
    const norm = (v: number[]) => { const s = v[0] + v[1] + v[2]; return v.map((x) => x / s); };
    models.push(norm(this.freq));
    models.push(n >= 1 ? norm(this.m1[h[n - 1]]) : [1 / 3, 1 / 3, 1 / 3]);
    models.push(n >= 2 ? norm(this.m2[h[n - 2] * 3 + h[n - 1]]) : [1 / 3, 1 / 3, 1 / 3]);
    const ml = this.mine.length;
    models.push(ml >= 1 ? norm(this.react[this.mine[ml - 1]]) : [1 / 3, 1 / 3, 1 / 3]);
    const use = this.diff === 0 ? [1, 0, 0, 0] : this.diff === 1 ? [1, 1, 0, 0] : [1, 1, 1, 1];
    const out = [0, 0, 0];
    let tw = 0;
    for (let k = 0; k < models.length; k++) {
      if (!use[k]) continue;
      // sharper models and models that have been right weigh more
      const w = Math.pow(this.hitsM[k], 1.5) * (0.4 + Math.max(...models[k]));
      for (let i = 0; i < 3; i++) out[i] += models[k][i] * w;
      tw += w;
      this.lastPred[k] = models[k].indexOf(Math.max(...models[k]));
    }
    return out.map((x) => x / tw);
  }

  /** The CPU's throw. */
  choose(): number {
    const p = this.predict();
    const best = p.indexOf(Math.max(...p));
    this.lastConfidence = p[best];
    const randomness = [0.72, 0.3, 0.08][this.diff];
    let m: number;
    if (this.hist.length < 2 || this.rnd() < randomness || p[best] < 0.36) m = Math.floor(this.rnd() * 3);
    else m = counter(best);
    return m;
  }

  /** Records a finished throw: the opponent's pick and the CPU's own. */
  observe(opp: number, mine: number) {
    const h = this.hist, n = h.length;
    for (let k = 0; k < 4; k++) if (this.lastPred[k] >= 0) this.hitsM[k] = this.hitsM[k] * 0.85 + (this.lastPred[k] === opp ? 1 : 0) * 0.6 + 0.05;
    for (let i = 0; i < 3; i++) this.freq[i] *= 0.92;
    this.freq[opp] += 1;
    if (n >= 1) this.m1[h[n - 1]][opp] += 1;
    if (n >= 2) this.m2[h[n - 2] * 3 + h[n - 1]][opp] += 1;
    if (this.mine.length >= 1) this.react[this.mine[this.mine.length - 1]][opp] += 1;
    h.push(opp);
    this.mine.push(mine);
  }
}
