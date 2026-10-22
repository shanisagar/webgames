import { Behaviour, Color, V2 } from "../../kit";
import { Palette } from "./Core";
import { Geo } from "./Geo";
import { Art, GlowLine, Gradient } from "./LumiArt";

export const Spacing = 0.16;
export const MinLoopArea = 0.8;

interface Point { P: V2; T: number }

/**
 * The comet's fading light trail (LightTrail.cs). When the head crosses an older part of the trail, the enclosed
 * polygon is returned as a closed loop — the core mechanic of the game.
 */
export class LightTrail extends Behaviour {
  /** Seconds each trail point survives. Combos stretch this. */
  Lifetime = 1.5;

  private readonly points: Point[] = [];
  private readonly buffer: V2[] = [];
  private line!: GlowLine;
  private head = V2.zero;
  private lastTime = 0;
  private color = Color.clear;
  private visible = false;

  get Count() { return this.points.length; }

  Build() {
    this.line = this.gameObject.addComponent(new GlowLine());
    this.line.material = Art.Trail;
    this.line.useWorldSpace = true;
    this.line.sortingOrder = 15;
    this.line.widthStart = 0.15;
    this.line.widthEnd = 1;
    this.line.widthMultiplier = 0.22;
    this.line.positionCount = 0;
    this.SetColor(Palette.Comet);
  }

  SetColor(c: Color) {
    if (c.equals(this.color)) return;
    this.color = c;
    this.line.colorGradient = new Gradient(
      [[c, 0], [Color.lerp(c, Color.white, 0.35), 1]],
      [[0, 0], [0.7, 0.35], [1, 1]]);
  }

  Restart(at: V2, now: number) {
    this.points.length = 0;
    this.points.push({ P: at, T: now });
    this.head = at;
    this.lastTime = now;
    this.visible = true;
  }

  Hide() {
    this.points.length = 0;
    this.visible = false;
    this.line.positionCount = 0;
  }

  /**
   * Moves the trail head. Returns true when a loop closed; `loop` then holds the enclosed polygon and the trail
   * restarts from the head.
   */
  Advance(newHead: V2, now: number, loop: V2[]) {
    const points = this.points;
    this.head = newHead;
    this.lastTime = now;
    this.visible = true;

    let expired = 0;
    while (expired < points.length && now - points[expired].T > this.Lifetime) expired++;
    if (expired > 0) points.splice(0, expired);

    if (points.length === 0) {
      points.push({ P: newHead, T: now });
      return false;
    }

    const last = points[points.length - 1].P;
    if (newHead.sub(last).sqrMagnitude < Spacing * Spacing) return false;

    // New segment last->head against every non-adjacent older segment, newest first.
    const n = points.length;
    for (let j = n - 3; j >= 0; j--) {
      const hit = Geo.SegmentIntersect(last, newHead, points[j].P, points[j + 1].P);
      if (!hit) continue;

      loop.length = 0;
      loop.push(hit);
      for (let k = j + 1; k < n; k++) loop.push(points[k].P);

      if (Math.abs(Geo.SignedArea(loop)) >= MinLoopArea) {
        points.length = 0;
        points.push({ P: newHead, T: now });
        return true;
      }
      loop.length = 0;
      break; // a tiny kink, not a real loop
    }

    points.push({ P: newHead, T: now });
    return false;
  }

  /** A cutter at `center` severs the trail; everything older than the cut vanishes. Returns the cut point or null. */
  TryCut(center: V2, radius: number): V2 | null {
    const points = this.points;
    const n = points.length;
    if (n === 0) return null;
    const r2 = radius * radius;

    let q = Geo.ClosestOnSegment(center, points[n - 1].P, this.head);
    if (q.sub(center).sqrMagnitude < r2 && n > 1) {
      points.length = 0;
      points.push({ P: this.head, T: this.lastTime });
      return q;
    }

    for (let j = n - 2; j >= 0; j--) {
      q = Geo.ClosestOnSegment(center, points[j].P, points[j + 1].P);
      if (q.sub(center).sqrMagnitude >= r2) continue;
      points.splice(0, j + 1);
      return q;
    }
    return null;
  }

  lateUpdate() {
    if (!this.visible) return;
    const count = this.points.length + 1;
    if (count < 2) {
      this.line.positionCount = 0;
      return;
    }
    const buffer = this.buffer;
    buffer.length = count;
    for (let i = 0; i < this.points.length; i++) buffer[i] = this.points[i].P;
    buffer[count - 1] = this.head;
    this.line.setPositions(buffer, count);
  }
}
