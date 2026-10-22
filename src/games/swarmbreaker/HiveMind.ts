import { Mathf, Random } from "../../kit";

export enum Foe { Drone, Flanker, Sniper, Warden, Hive }

export enum Tactic { Hunt, Surround, Pincer, ShieldWall }

/**
 * The enemy commander. It profiles the player during every wave (range kept, accuracy, how still they stand,
 * how often they dash, what hurts them) and composes the next wave to counter that style. During a wave it
 * switches squad tactics based on which units are alive. (Port of HiveMind.cs.)
 */
export class HiveMind {
  static readonly FoeCount = 5;

  private distanceSum = 0; private distanceSamples = 0; private stillTime = 0; private moveTime = 0;
  Shots = 0; Hits = 0; Dashes = 0;
  readonly DamageBy: number[] = new Array(HiveMind.FoeCount).fill(0);

  private _current = Tactic.Hunt;
  get Current() { return this._current; }
  private _tacticAge = 0;
  get TacticAge() { return this._tacticAge; }
  private tacticTimer = 0;

  static readonly Cost = [1, 2, 3, 4, 0];
  static readonly Plural = ["DRONES", "FLANKERS", "SNIPERS", "WARDENS", "HIVES"];

  BeginWave() {
    this.distanceSum = this.distanceSamples = this.stillTime = this.moveTime = 0;
    this.Shots = this.Hits = this.Dashes = 0;
    for (let i = 0; i < HiveMind.FoeCount; i++) this.DamageBy[i] = 0;
    this._current = Tactic.Hunt;
    this.tacticTimer = 4;
    this._tacticAge = 0;
  }

  /** Called every frame with the player's state. */
  Observe(dt: number, nearestEnemyDistance: number, playerSpeed: number) {
    if (nearestEnemyDistance < 50) {
      this.distanceSum += nearestEnemyDistance * dt;
      this.distanceSamples += dt;
    }
    if (playerSpeed < 1.2) this.stillTime += dt;
    else this.moveTime += dt;
  }

  /** Re-evaluates the squad tactic. Returns true when it changed. */
  Command(dt: number, alive: number[]) {
    this._tacticAge += dt;
    this.tacticTimer -= dt;
    if (this.tacticTimer > 0) return false;
    this.tacticTimer = Random.range(5, 7);

    const options: Tactic[] = [Tactic.Hunt];
    if (alive[Foe.Drone] >= 5) { options.push(Tactic.Surround); options.push(Tactic.Surround); }
    if (alive[Foe.Flanker] >= 2) options.push(Tactic.Pincer);
    if (alive[Foe.Warden] >= 1 && alive[Foe.Sniper] >= 1) options.push(Tactic.ShieldWall);
    const next = options[Random.rangeInt(0, options.length)];
    if (next === this._current) return false;
    this._current = next;
    this._tacticAge = 0;
    return true;
  }

  /** Builds the next wave's roster and explains the adaptation (null when nothing stood out). */
  Plan(wave: number, areaScale: number): [Foe[], string | null] {
    const w = [
      1,
      wave >= 2 ? 0.7 : 0,
      wave >= 3 ? 0.55 : 0,
      wave >= 4 ? 0.45 : 0,
    ];
    let why0: string | null = null;
    let strongest = 1.3;

    const Boost = (f: Foe, k: number, why: string) => {
      if (w[f] <= 0) return;
      w[f] *= k;
      if (k > strongest) {
        strongest = k;
        why0 = why + ": MORE " + HiveMind.Plural[f];
      }
    };

    if (wave > 1) {
      const avgDistance = this.distanceSamples > 1 ? this.distanceSum / this.distanceSamples : 5;
      const accuracy = this.Shots > 25 ? this.Hits / this.Shots : 0.3;
      const stillness = this.stillTime / Math.max(1, this.stillTime + this.moveTime);

      if (avgDistance > 6.5) Boost(Foe.Flanker, 1.8, "YOU KEEP YOUR DISTANCE");
      if (avgDistance < 3.2) Boost(Foe.Warden, 1.6, "YOU FIGHT UP CLOSE");
      if (accuracy > 0.45) Boost(Foe.Warden, 1.75, "YOUR AIM IS SHARP");
      if (stillness > 0.35) Boost(Foe.Sniper, 1.9, "YOU HOLD STILL");
      if (this.Dashes >= 10) Boost(Foe.Drone, 1.5, "YOU DASH A LOT");

      let worst = -1;
      for (let i = 0; i < 4; i++) if (this.DamageBy[i] >= 2 && (worst < 0 || this.DamageBy[i] > this.DamageBy[worst])) worst = i;
      if (worst >= 0) Boost(worst as Foe, 1.45, HiveMind.Plural[worst] + " HURT YOU MOST");
    }

    const insight = why0;
    let budget = Mathf.roundToInt((6 + wave * 3) * areaScale);
    const roster: Foe[] = [];
    const total = w[0] + w[1] + w[2] + w[3];
    let guard = 0;
    while (budget > 0 && guard++ < 200) {
      let r = Random.value * total;
      let pick = 0;
      for (let i = 0; i < 4; i++) {
        r -= w[i];
        if (r <= 0) { pick = i; break; }
      }
      if (HiveMind.Cost[pick] > budget) pick = 0;
      roster.push(pick as Foe);
      budget -= HiveMind.Cost[pick];
    }
    if (wave % 5 === 0) roster.unshift(Foe.Hive);

    // Shuffle so squads arrive mixed.
    for (let i = roster.length - 1; i > 0; i--) {
      const j = Random.rangeInt(0, i + 1);
      [roster[i], roster[j]] = [roster[j], roster[i]];
    }
    return [roster, insight];
  }

  static Describe(t: Tactic) {
    switch (t) {
      case Tactic.Surround: return "SURROUND";
      case Tactic.Pincer: return "PINCER";
      case Tactic.ShieldWall: return "SHIELD WALL";
      default: return "HUNT";
    }
  }
}
