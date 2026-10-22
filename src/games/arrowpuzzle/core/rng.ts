/** Small seeded PRNG (mulberry32) with the System.Random-style calls the generator needs. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = (seed ^ 0x9e3779b9) >>> 0;
  }

  /** [0, 1) */
  nextDouble(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max), or [0, min) when called with one argument. */
  next(min: number, max?: number): number {
    if (max === undefined) { max = min; min = 0; }
    return min + Math.floor(this.nextDouble() * (max - min));
  }

  shuffle<T>(list: T[]): void {
    for (let i = list.length - 1; i > 0; i--) {
      const j = this.next(i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
}
