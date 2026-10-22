import { Behaviour, Color, GameObject, Material, Mathf, Quaternion, Random, Rect, Sprite, SpriteRenderer, V2 } from "../../kit";
import { Art } from "./LumiArt";
import type { Juice } from "./Juice";

/** The player: a comet that never stops moving. Input only bends its heading (Comet.cs). */
export class Comet extends Behaviour {
  static readonly Radius = 0.3;

  Speed = 7.2;
  TurnRate = 7.5; // radians per second

  Position = V2.zero;
  Heading = 0;
  get Direction() { return new V2(Math.cos(this.Heading), Math.sin(this.Heading)); }
  get Invulnerable() { return this.invulnerable > 0; }

  private core!: SpriteRenderer;
  private halo!: SpriteRenderer;
  private tail!: SpriteRenderer;
  private invulnerable = 0;
  private clock = 0;
  private emberTimer = 0;

  Build() {
    this.halo = this.Part("Halo", Art.Glow, Art.Additive, 2.4, 20);
    this.tail = this.Part("Tail", Art.Glow, Art.Additive, 1, 20);
    this.core = this.Part("Core", Art.Disc, Art.Solid, 0.5, 22);
  }

  private Part(name: string, sprite: Sprite, mat: Material, size: number, order: number) {
    const go = new GameObject(name, this.gameObject);
    go.localScale = new V2(size, size);
    const sr = go.addComponent(new SpriteRenderer());
    sr.sprite = sprite;
    sr.material = mat;
    sr.sortingOrder = order;
    return sr;
  }

  Place(position: V2, heading: number) {
    this.Position = position;
    this.Heading = heading;
    this.invulnerable = 0;
    this.transform.position = position;
  }

  /** Rotates the heading toward `desired`, limited by the turn rate. */
  Steer(desired: V2, dt: number) {
    if (desired.sqrMagnitude < 1e-6) return;
    const target = Math.atan2(desired.y, desired.x) * Mathf.Rad2Deg;
    const diff = Mathf.deltaAngle(this.Heading * Mathf.Rad2Deg, target) * Mathf.Deg2Rad;
    const step = this.TurnRate * dt;
    this.Heading += Mathf.clamp(diff, -step, step);
  }

  Turn(radiansPerSecond: number, dt: number) {
    this.Heading += Mathf.clamp(radiansPerSecond, -this.TurnRate, this.TurnRate) * dt;
  }

  /** Advances the comet; reflects off the bounds. Returns true when it bounced. */
  Move(dt: number, b: Rect) {
    let d = this.Direction;
    let px = this.Position.x + d.x * this.Speed * dt, py = this.Position.y + d.y * this.Speed * dt;
    let dx = d.x, dy = d.y;
    let bounced = false;
    const R = Comet.Radius;
    if (px < b.xMin + R) { px = b.xMin + R; dx = Math.abs(dx); bounced = true; }
    else if (px > b.xMax - R) { px = b.xMax - R; dx = -Math.abs(dx); bounced = true; }
    if (py < b.yMin + R) { py = b.yMin + R; dy = Math.abs(dy); bounced = true; }
    else if (py > b.yMax - R) { py = b.yMax - R; dy = -Math.abs(dy); bounced = true; }
    d = new V2(dx, dy);
    if (bounced) this.Heading = Math.atan2(d.y, d.x);
    this.Position = new V2(px, py);
    this.transform.position = this.Position;
    return bounced;
  }

  MakeInvulnerable(seconds: number) { this.invulnerable = Math.max(this.invulnerable, seconds); }

  /** Updates visuals and sheds embers. */
  Animate(dt: number, color: Color, juice: Juice | null) {
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.clock += dt;
    const blink = this.invulnerable > 0 && Mathf.repeat(this.clock * 12, 1) < 0.5;

    this.core.color = blink ? color.withAlpha(0.3) : Color.lerp(color, Color.white, 0.55);
    this.halo.color = color.withAlpha(blink ? 0.2 : 0.5 + 0.1 * Math.sin(this.clock * 6));
    this.tail.color = color.withAlpha(0.45);

    const dir = this.Direction;
    const tt = this.tail.transform;
    tt.localPosition = new V2(-dir.x * 0.45, -dir.y * 0.45);
    tt.localRotation = Quaternion.euler(0, 0, this.Heading * Mathf.Rad2Deg);
    tt.localScale = new V2(1.7, 0.55);

    this.emberTimer -= dt;
    if (juice && this.emberTimer <= 0) {
      this.emberTimer = 0.035;
      const side = new V2(-dir.y, dir.x).mul(Random.range(-0.6, 0.6));
      juice.Ember(this.Position.sub(dir.mul(0.2)), dir.mul(-1.2).add(side), color);
    }
  }
}
