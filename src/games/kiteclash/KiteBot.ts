import { Mathf, SysRandom, V2 } from "../../kit/math";
import { Kite, KState, SpinRate, Sky } from "./KitePhysics";

/**
 * A CPU flyer. It steers with exactly the same hold / release control as a player: it waits until the spinning nose
 * points (roughly) where it wants to go, then holds. It plans crossings over the rival's string, saws away from the
 * crossing point when it is winning and slackens (a slack string gives way) when it can't pull away.
 * Difficulty = reaction time (it sees its own kite late), aim error, aggression and how well it defends.
 */
export interface BotLevel {
  react: number;     // perception lag in seconds
  aimErr: number;    // degrees of random error per plan
  tol: number;       // nose tolerance (deg) before it starts pulling
  aggr: number;      // chance a plan is an attack
  defend: number;    // chance it turns picky (slackens) while losing a saw
  predict: boolean;  // leads the spinning nose to make up for its lag
  greed: number;     // chance it detours for a pickup
  sawTol: number;    // while crossed: pull when the nose is within this many degrees of 'away'
  sawOut: number;    // ...and keep pulling until it drops below this
}

export const BotLevels: BotLevel[] = [
  { react: 0.45, aimErr: 45, tol: 34, aggr: 0.45, defend: 0.0, predict: false, greed: 0.1, sawTol: 40, sawOut: 0.35 },
  { react: 0.2, aimErr: 14, tol: 20, aggr: 0.6, defend: 0.5, predict: false, greed: 0.35, sawTol: 50, sawOut: -0.45 },
  { react: 0.03, aimErr: 4, tol: 12, aggr: 0.7, defend: 0.9, predict: true, greed: 0.6, sawTol: 45, sawOut: -0.45 },
];

export enum Plan { Wander, Attack, Climb, Pickup }

export class KiteBot {
  hold = false;
  private planT = 0;
  plan = Plan.Wander;
  private goal = V2.zero;
  private err = 0;
  private defending = false;
  private holdT = 0;
  private hist: { t: number; ang: number; spin: number }[] = [];
  private clock = 0;
  private decideT = 0;
  /** Practice rivals never attack. */
  passive = false;

  constructor(readonly kite: Kite, public lv: BotLevel, private rng: SysRandom) {}

  tick(dt: number, sky: Sky, foe: Kite | null) {
    const k = this.kite;
    this.clock += dt;
    this.hist.push({ t: this.clock, ang: k.ang, spin: k.spin });
    while (this.hist.length > 2 && this.hist[1].t <= this.clock - this.lv.react) this.hist.shift();
    if (k.state !== KState.Fly) { this.hold = false; this.planT = 0; this.holdT = 0; return false; }
    this.planT -= dt;
    if (this.hold) this.holdT += dt;
    this.decideT -= dt;
    if (this.decideT > 0) return this.hold;
    this.decideT = 1 / 30;
    const h = this.decide(sky, foe);
    if (h !== this.hold) {
      if (this.hold && this.holdT < 0.14) return this.hold; // no flicker
      this.hold = h;
      this.holdT = 0;
    }
    return this.hold;
  }

  /** The nose angle as this bot perceives it (late, unless it leads the spin). */
  private seenAng() {
    const k = this.kite, h = this.hist[0];
    let a = h ? h.ang : k.ang;
    if (this.lv.predict && !this.hold) a += k.spinDir * SpinRate * Math.max(h ? h.spin : 1, 0.6) * this.lv.react;
    return a;
  }

  private decide(sky: Sky, foe: Kite | null): boolean {
    const k = this.kite, A = sky.arena;
    const nose = this.seenAng();
    const clash = this.passive ? null : sky.clashFor(k);
    if (clash) {
      const edge = clash.edgeFor(k);
      if (edge < -0.25 && !this.defending && this.rng.nextDouble() < this.lv.defend * 0.1) this.defending = true;
      if (edge > 0.05) this.defending = false;
      let away = k.pos.sub(clash.point).normalized;
      if (away.sqrMagnitude < 0.5) away = V2.up;
      // don't saw into the roofs or the walls
      if (k.pos.y < A.yMin + 2.2) away = V2.lerp(away, V2.up, 0.6).normalized;
      if (k.pos.x < A.xMin + 1.5) away = V2.lerp(away, V2.right, 0.5).normalized;
      if (k.pos.x > A.xMax - 1.5) away = V2.lerp(away, V2.left, 0.5).normalized;
      if (k.pos.y > A.yMax - 1.5) away = V2.lerp(away, V2.down, 0.5).normalized;
      const want = Math.atan2(away.y, away.x) * Mathf.Rad2Deg + this.err * 0.5;
      if (this.hold) {
        const dot = V2.dot(V2.fromAngle(nose * Mathf.Deg2Rad), V2.fromAngle(want * Mathf.Deg2Rad));
        return dot > this.lv.sawOut + (this.defending ? 0.25 : 0) && !this.nearWall(k, sky);
      }
      return this.aligned(nose, want, this.lv.sawTol * (this.defending ? 0.7 : 1));
    }
    this.defending = false;
    if (this.planT <= 0 || this.reached()) this.replan(sky, foe);
    if (this.plan === Plan.Attack && foe) this.goal = this.attackGoal(sky, foe);
    if (this.plan === Plan.Pickup && !sky.pickups.some((p) => p.active && V2.distance(p.pos, this.goal) < 2.5)) this.planT = 0;
    if (k.pos.y < A.yMin + 1.2 && k.slackT > 0.3) { this.plan = Plan.Climb; this.goal = new V2(k.pos.x, k.pos.y + 5); }
    const to = this.goal.sub(k.pos);
    const want = Math.atan2(to.y, to.x) * Mathf.Rad2Deg + this.err;
    if (this.hold) return Math.abs(Mathf.deltaAngle(nose, want)) < this.lv.tol + 40 && to.magnitude > 0.8 && !this.nearWall(k, sky);
    return to.magnitude > 1.2 && this.aligned(nose, want, this.lv.tol);
  }

  /** Press now? Bots that lead the spin press just before the nose arrives (it keeps turning a moment). */
  private aligned(nose: number, want: number, tol: number) {
    const ahead = Mathf.deltaAngle(nose, want) * this.kite.spinDir; // > 0: still turning towards it
    if (this.lv.predict) return ahead > -tol * 0.4 && ahead < tol * 0.6 + 10;
    return Math.abs(ahead) < tol;
  }

  private nearWall(k: Kite, sky: Sky) {
    const A = sky.arena, p = k.pos.add(k.dir.mul(1.0));
    return p.x < A.xMin || p.x > A.xMax || p.y < A.yMin || p.y > A.yMax;
  }

  private reached() { return V2.distance(this.kite.pos, this.goal) < 1.3; }

  private replan(sky: Sky, foe: Kite | null) {
    const k = this.kite, A = sky.arena, r = this.rng;
    this.planT = 1.2 + r.nextDouble() * 1.4;
    this.err = (r.nextDouble() * 2 - 1) * this.lv.aimErr;
    const pick = sky.pickups.find((p) => p.active && V2.distance(p.pos, k.pos) < 7);
    if (pick && r.nextDouble() < this.lv.greed) { this.plan = Plan.Pickup; this.goal = pick.pos; return; }
    if (!this.passive && foe && foe.state === KState.Fly && r.nextDouble() < this.lv.aggr) {
      this.plan = Plan.Attack;
      this.goal = this.attackGoal(sky, foe);
      return;
    }
    this.plan = Plan.Wander;
    // keep to the own side of the sky, up high
    const cx = (A.xMin + A.xMax) / 2, hw = (A.xMax - A.xMin) / 2;
    const side = Math.sign(k.anchor.x - cx) || (r.nextDouble() < 0.5 ? -1 : 1);
    const x = cx + side * hw * (0.15 + 0.65 * r.nextDouble());
    const y = Mathf.lerp(A.yMin + 2.5, A.yMax - 1, 0.35 + 0.6 * r.nextDouble());
    this.goal = new V2(x, y);
  }

  /** A point just past the rival's string, low enough that our own string must cross theirs. */
  private attackGoal(sky: Sky, foe: Kite) {
    const k = this.kite, A = sky.arena;
    const a = foe.anchor, b = foe.pos;
    const q = V2.lerp(a, b, 0.62);
    let n = V2.perpendicular(b.sub(a)).normalized;
    if (n.sqrMagnitude < 0.5) n = V2.right;
    const side = Math.sign(V2.dot(k.pos.sub(q), n)) || 1;
    const g = q.sub(n.mul(side * 2.6));
    const ix = (A.xMax - A.xMin) * 0.12;
    return new V2(Mathf.clamp(g.x, A.xMin + ix, A.xMax - ix), Mathf.clamp(g.y, A.yMin + 1.5, A.yMax - 1));
  }
}
