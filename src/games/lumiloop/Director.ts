import { Mathf, Random, V2 } from "../../kit";
import { EntityKind } from "./Core";
import type { Swarm } from "./Swarm";

export enum GameEvent { None, Surge, SparkBloom }

/**
 * Pacing (Director.cs). Ramps hunters, cutters and speed over the run clock, drops prisms as rare rewards, and
 * alternates two set-piece events (a hunter surge, then a spark bloom) so a run has peaks and breathers.
 */
export class Director {
  Hunters = false;
  Cutters = false;
  Prisms = false;
  Events = false;

  /** Seconds of real play (the tutorial does not advance it). */
  Clock = 0;

  private moteTimer = 0;
  private hunterTimer = 0;
  private cutterTimer = 0;
  private prismTimer = 0;
  private nextEvent = 0;
  private eventCount = 0;

  Reset(enemies: boolean) {
    this.Hunters = this.Cutters = this.Prisms = this.Events = enemies;
    this.Clock = 0;
    this.moteTimer = 0;
    this.hunterTimer = 2.5;
    this.cutterTimer = 0;
    this.prismTimer = 22;
    this.nextEvent = 50;
    this.eventCount = 0;
  }

  Tick(dt: number, swarm: Swarm, player: V2, areaScale: number, advanceClock: boolean): GameEvent {
    if (advanceClock) this.Clock += dt;
    const t = this.Clock;

    swarm.HunterSpeed = Mathf.lerp(2.7, 5.3, t / 240);
    swarm.HunterTurn = Mathf.lerp(2.1, 3.3, t / 240);
    swarm.CutterSpeed = Mathf.lerp(2.2, 3.6, t / 240);

    this.moteTimer -= dt;
    if (this.moteTimer <= 0 && swarm.CountOf(EntityKind.Mote) < Mathf.roundToInt(10 * areaScale)) {
      swarm.SpawnMoteCluster(player);
      this.moteTimer = 0.9;
    }

    if (this.Hunters) {
      const target = Math.max(1, Mathf.roundToInt(Math.min(1 + t / 15, 11) * areaScale));
      this.hunterTimer -= dt;
      if (this.hunterTimer <= 0 && swarm.CountOf(EntityKind.Hunter) < target) {
        swarm.Telegraph(EntityKind.Hunter, swarm.RandomSpawnPoint(player, 6.5), 1);
        this.hunterTimer = Mathf.lerp(2.6, 1, t / 200);
      }
    }

    if (this.Cutters && t > 30) {
      const target = Math.min(1 + Math.trunc((t - 30) / 50), 4);
      this.cutterTimer -= dt;
      if (this.cutterTimer <= 0 && swarm.CountOf(EntityKind.Cutter) < target) {
        swarm.Telegraph(EntityKind.Cutter, swarm.RandomSpawnPoint(player, 5), 1.1);
        this.cutterTimer = 6;
      }
    }

    if (this.Prisms && t > 20) {
      this.prismTimer -= dt;
      if (this.prismTimer <= 0) {
        if (swarm.CountOf(EntityKind.Prism) === 0) swarm.Telegraph(EntityKind.Prism, swarm.RandomSpawnPoint(player, 4), 0.8);
        this.prismTimer = Random.range(18, 26);
      }
    }

    if (this.Events && t >= this.nextEvent) {
      this.eventCount++;
      this.nextEvent += 40;
      if (this.eventCount % 2 === 1) {
        swarm.Surge(player, Math.min(3 + Math.trunc(this.eventCount / 2), 8));
        return GameEvent.Surge;
      }
      swarm.SparkBloom(player, Mathf.roundToInt(16 * areaScale));
      return GameEvent.SparkBloom;
    }
    return GameEvent.None;
  }
}
