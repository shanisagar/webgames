import { Behaviour, Color, Ease, GameObject, Material, Mathf, Quaternion, Random, Rect, SpriteRenderer, V2, V3 } from "../../kit";
import { EntityKind, Palette, Rules } from "./Core";
import { Geo } from "./Geo";
import { Juice } from "./Juice";
import { Art } from "./LumiArt";
import { Cue, Synth } from "./Synth";

/** One pooled world object: a spark, hunter, cutter or prism. */
export class Entity {
  Kind = EntityKind.Mote;
  Pos = V2.zero;
  Vel = V2.zero;
  Knock = V2.zero;
  Heading = 0; Age = 0; Radius = 0; Seed = 0; Life = 0; BodySize = 0; HaloSize = 0; HaloAlpha = 0;
  Captured = false;
  CaptureT = 0;
  CaptureFrom = V2.zero;
  CaptureTo = V2.zero;

  readonly Go: GameObject;
  readonly Tr: GameObject;
  readonly Body: SpriteRenderer;
  readonly Halo: SpriteRenderer;

  constructor(parent: GameObject) {
    this.Go = new GameObject("Entity", parent);
    this.Tr = this.Go;
    this.Halo = this.Part("Halo", Art.Additive, 10);
    this.Body = this.Part("Body", Art.Solid, 11);
  }

  private Part(name: string, mat: Material, order: number) {
    const sr = new GameObject(name, this.Tr).addComponent(new SpriteRenderer());
    sr.material = mat;
    sr.sortingOrder = order;
    return sr;
  }

  /** Hunters hurt on contact once their spawn animation has finished. */
  get Harmful() { return this.Kind === EntityKind.Hunter && !this.Captured && this.Age > 0.45; }
}

interface Warning { Kind: EntityKind; Pos: V2; T: number; Duration: number; Sr: SpriteRenderer }

/** Owns, pools, moves and spawns every entity, including the warning markers that precede spawns (Swarm.cs). */
export class Swarm extends Behaviour {
  HunterSpeed = 2.7;
  HunterTurn = 2.1;
  CutterSpeed = 2.2;

  private readonly live: Entity[] = [];
  private readonly pool: Entity[] = [];
  private readonly warnings: Warning[] = [];
  private readonly warningPool: Warning[] = [];
  private bounds = new Rect(-8, -12, 16, 24);
  private player = V2.zero;

  get Live() { return this.live; }

  SetBounds(r: Rect) { this.bounds = r; }

  CountOf(kind: EntityKind, includePending = true) {
    let c = 0;
    for (const e of this.live) if (e.Kind === kind && !e.Captured) c++;
    if (includePending) for (const w of this.warnings) if (w.Kind === kind) c++;
    return c;
  }

  Clear() {
    for (let i = this.live.length - 1; i >= 0; i--) this.Despawn(i);
    for (const w of this.warnings) {
      w.Sr.gameObject.setActive(false);
      this.warningPool.push(w);
    }
    this.warnings.length = 0;
  }

  // ------------------------------------------------------------------ spawning

  Spawn(kind: EntityKind, pos: V2) {
    const e = this.pool.pop() ?? new Entity(this.gameObject);
    e.Go.setActive(true);
    e.Kind = kind;
    e.Pos = this.ClampInside(pos, 0.6);
    e.Knock = V2.zero;
    e.Age = 0;
    e.Seed = Random.value;
    e.Captured = false;
    e.CaptureT = 0;
    e.Life = Number.POSITIVE_INFINITY;
    e.Body.transform.localRotation = Quaternion.identity;
    e.Halo.sprite = Art.Glow;

    switch (kind) {
      case EntityKind.Mote:
        e.Body.sprite = Art.Disc;
        e.BodySize = 0.3; e.HaloSize = 1.3; e.HaloAlpha = 0.45; e.Radius = 0.2;
        e.Vel = Random.insideUnitCircle.normalized.mul(Random.range(0.2, 0.7));
        break;
      case EntityKind.Hunter: {
        e.Body.sprite = Art.Dart;
        e.BodySize = 0.8; e.HaloSize = 1.9; e.HaloAlpha = 0.4; e.Radius = 0.34;
        const to = this.player.sub(e.Pos);
        e.Heading = Math.atan2(to.y, to.x);
        e.Vel = V2.zero;
        break;
      }
      case EntityKind.Cutter:
        e.Body.sprite = Art.Shuriken;
        e.BodySize = 0.85; e.HaloSize = 1.9; e.HaloAlpha = 0.4; e.Radius = 0.38;
        e.Heading = Random.range(0, Math.PI * 2);
        break;
      case EntityKind.Prism:
        e.Body.sprite = Art.Gem;
        e.BodySize = 1; e.HaloSize = 2.8; e.HaloAlpha = 0.5; e.Radius = 0.5;
        e.Vel = Random.insideUnitCircle.normalized.mul(0.6);
        e.Life = 14;
        break;
    }
    this.live.push(e);
    this.ApplyVisual(e, 1, 0);
    return e;
  }

  /** Shows a pulsing marker for `delay` seconds before the entity appears — no cheap spawns. */
  Telegraph(kind: EntityKind, pos: V2, delay = 1) {
    let w = this.warningPool.pop();
    if (!w) {
      const sr = new GameObject("Warning", this.gameObject).addComponent(new SpriteRenderer());
      sr.sprite = Art.Ring;
      sr.material = Art.Additive;
      sr.sortingOrder = 9;
      w = { Kind: kind, Pos: pos, T: 0, Duration: delay, Sr: sr };
    }
    w.Kind = kind;
    w.Pos = this.ClampInside(pos, 0.8);
    w.T = 0;
    w.Duration = delay;
    w.Sr.gameObject.setActive(true);
    w.Sr.transform.position = w.Pos;
    this.warnings.push(w);
    if (kind !== EntityKind.Mote) Synth.Play(Cue.Warn, 0.5);
  }

  RandomSpawnPoint(avoid: V2, minDistance: number) {
    const b = this.bounds;
    let best = b.center;
    let bestD = -1;
    for (let i = 0; i < 30; i++) {
      const p = new V2(Random.range(b.xMin + 1, b.xMax - 1), Random.range(b.yMin + 1, b.yMax - 1));
      const d = p.sub(avoid).sqrMagnitude;
      if (d >= minDistance * minDistance) return p;
      if (d > bestD) { bestD = d; best = p; }
    }
    return best;
  }

  SpawnMoteCluster(avoid: V2) {
    const c = this.RandomSpawnPoint(avoid, 3);
    const n = Random.rangeInt(3, 6);
    for (let i = 0; i < n; i++) this.Spawn(EntityKind.Mote, c.add(Random.insideUnitCircle.mul(1.3)));
  }

  /** Event: hunters arrive from the edges all at once. */
  Surge(avoid: V2, count: number) {
    for (let i = 0; i < count; i++) {
      let p = this.EdgePoint();
      if (p.sub(avoid).sqrMagnitude < 25) p = this.RandomSpawnPoint(avoid, 6);
      this.Telegraph(EntityKind.Hunter, p, 1.4);
    }
  }

  /** Event: a burst of sparks blooms across the arena. */
  SparkBloom(avoid: V2, count: number) {
    for (let i = 0; i < count; i++) this.Telegraph(EntityKind.Mote, this.RandomSpawnPoint(avoid, 2), Random.range(0.2, 0.9));
  }

  private EdgePoint() {
    const b = this.bounds;
    const x = Random.range(b.xMin + 0.8, b.xMax - 0.8);
    const y = Random.range(b.yMin + 0.8, b.yMax - 0.8);
    switch (Random.rangeInt(0, 4)) {
      case 0: return new V2(b.xMin + 0.8, y);
      case 1: return new V2(b.xMax - 0.8, y);
      case 2: return new V2(x, b.yMin + 0.8);
      default: return new V2(x, b.yMax - 0.8);
    }
  }

  private Despawn(index: number) {
    const e = this.live[index];
    this.live.splice(index, 1);
    e.Go.setActive(false);
    this.pool.push(e);
  }

  // ------------------------------------------------------------------ simulation

  Tick(dt: number, playerPos: V2, time: number) {
    this.player = playerPos;
    this.TickWarnings(dt);

    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.Age += dt;

      if (e.Captured) {
        e.CaptureT += dt / 0.24;
        const k = Mathf.clamp01(e.CaptureT);
        e.Pos = V2.lerp(e.CaptureFrom, e.CaptureTo, Ease.inQuad(k));
        this.ApplyVisual(e, 1 - k * 0.8, time);
        if (k >= 1) {
          Juice.Instance?.Burst(e.Pos, Rules.ColorOf(e.Kind), 8, 3.5, 0.2, 0.45);
          this.Despawn(i);
        }
        continue;
      }

      switch (e.Kind) {
        case EntityKind.Mote:
          e.Vel = Swarm.Rotate(e.Vel, Math.sin(e.Age * 0.7 + e.Seed * 20) * 0.4 * dt);
          e.Pos = e.Pos.add(e.Vel.mul(dt));
          break;

        case EntityKind.Hunter: {
          const to = this.player.sub(e.Pos);
          const desired = Math.atan2(to.y, to.x) * Mathf.Rad2Deg;
          const diff = Mathf.deltaAngle(e.Heading * Mathf.Rad2Deg, desired) * Mathf.Deg2Rad;
          const step = this.HunterTurn * dt;
          e.Heading += Mathf.clamp(diff, -step, step);
          const warm = Mathf.clamp01(e.Age / 0.6); // ease in after spawning
          e.Vel = new V2(Math.cos(e.Heading), Math.sin(e.Heading)).mul(this.HunterSpeed * warm);
          e.Pos = e.Pos.add(e.Vel.add(this.Separation(e)).mul(dt));
          break;
        }

        case EntityKind.Cutter:
          e.Heading += (Mathf.perlinNoise(e.Seed * 50, e.Age * 0.35) - 0.5) * 3 * dt;
          e.Vel = new V2(Math.cos(e.Heading), Math.sin(e.Heading)).mul(this.CutterSpeed);
          e.Pos = e.Pos.add(e.Vel.mul(dt));
          break;

        case EntityKind.Prism:
          e.Pos = e.Pos.add(e.Vel.mul(dt));
          e.Life -= dt;
          break;
      }

      e.Pos = e.Pos.add(e.Knock.mul(dt));
      e.Knock = e.Knock.mul(Math.exp(-4 * dt));
      if (this.Bounce(e) && (e.Kind === EntityKind.Hunter || e.Kind === EntityKind.Cutter)) e.Heading = Math.atan2(e.Vel.y, e.Vel.x);

      if (e.Kind === EntityKind.Prism && e.Life <= 0) {
        Juice.Instance?.Burst(e.Pos, Palette.Prism, 14, 3, 0.25, 0.6);
        this.Despawn(i);
        continue;
      }

      this.ApplyVisual(e, 1, time);
    }
  }

  private TickWarnings(dt: number) {
    for (let i = this.warnings.length - 1; i >= 0; i--) {
      const w = this.warnings[i];
      w.T += dt;
      const k = Mathf.clamp01(w.T / w.Duration);
      const size = w.Kind === EntityKind.Mote ? 0.7 : 1.2;
      const s = Mathf.lerp(2.6, 0.9, Ease.outCubic(k)) * size;
      w.Sr.transform.localScale = new V3(s, s, 1);
      w.Sr.color = Rules.ColorOf(w.Kind).withAlpha(0.25 + 0.55 * Math.abs(Math.sin(w.T * 12)));
      if (k < 1) continue;

      this.Spawn(w.Kind, w.Pos);
      if (w.Kind !== EntityKind.Mote) Juice.Instance?.Ring(w.Pos, Rules.ColorOf(w.Kind), 0.4, 2.2, 0.35);
      w.Sr.gameObject.setActive(false);
      this.warningPool.push(w);
      this.warnings.splice(i, 1);
    }
  }

  private Separation(e: Entity) {
    let push = V2.zero;
    for (const o of this.live) {
      if (o === e || o.Kind !== EntityKind.Hunter || o.Captured) continue;
      const d = e.Pos.sub(o.Pos);
      const m = d.magnitude;
      if (m > 0.0001 && m < 0.95) push = push.add(d.div(m).mul((0.95 - m) * 6));
    }
    return push;
  }

  /** Reflects an entity off the bounds (C# Bounce(ref Pos, ref Vel, r)). */
  private Bounce(e: Entity) {
    const b = this.bounds, r = e.Radius;
    let px = e.Pos.x, py = e.Pos.y, vx = e.Vel.x, vy = e.Vel.y;
    let hit = false;
    if (px < b.xMin + r) { px = b.xMin + r; vx = Math.abs(vx); hit = true; }
    else if (px > b.xMax - r) { px = b.xMax - r; vx = -Math.abs(vx); hit = true; }
    if (py < b.yMin + r) { py = b.yMin + r; vy = Math.abs(vy); hit = true; }
    else if (py > b.yMax - r) { py = b.yMax - r; vy = -Math.abs(vy); hit = true; }
    if (hit) { e.Pos = new V2(px, py); e.Vel = new V2(vx, vy); }
    return hit;
  }

  private ClampInside(p: V2, margin: number) {
    const b = this.bounds;
    return new V2(
      Mathf.clamp(p.x, b.xMin + margin, Math.max(b.xMin + margin, b.xMax - margin)),
      Mathf.clamp(p.y, b.yMin + margin, Math.max(b.yMin + margin, b.yMax - margin)));
  }

  private static Rotate(v: V2, radians: number) {
    const c = Math.cos(radians), s = Math.sin(radians);
    return new V2(v.x * c - v.y * s, v.x * s + v.y * c);
  }

  private ApplyVisual(e: Entity, scale: number, time: number) {
    e.Tr.position = e.Pos;
    const pop = Ease.outBack(Mathf.clamp01(e.Age / 0.35)) * scale;
    let c: Color = Rules.ColorOf(e.Kind);
    let bodyScale = e.BodySize * pop;
    let haloAlpha = e.HaloAlpha;
    let bodyAlpha = 1;

    switch (e.Kind) {
      case EntityKind.Mote:
        bodyScale *= 1 + 0.15 * Math.sin(time * 5 + e.Seed * 10);
        haloAlpha *= 0.8 + 0.3 * Math.sin(time * 3 + e.Seed * 7);
        break;
      case EntityKind.Hunter:
        e.Body.transform.localRotation = Quaternion.euler(0, 0, e.Heading * Mathf.Rad2Deg);
        haloAlpha *= 0.8 + 0.4 * Math.sin(time * 8 + e.Seed * 10);
        break;
      case EntityKind.Cutter:
        e.Body.transform.localRotation = Quaternion.euler(0, 0, time * 400 + e.Seed * 360);
        break;
      case EntityKind.Prism:
        c = Color.lerp(Palette.Prism, Palette.Rainbow(time * 0.3 + e.Seed), 0.5);
        e.Body.transform.localRotation = Quaternion.euler(0, 0, time * 50);
        haloAlpha *= 0.8 + 0.3 * Math.sin(time * 4);
        if (e.Life < 3 && Mathf.repeat(e.Life * 6, 1) < 0.4) bodyAlpha = 0.25; // about to vanish
        break;
    }

    e.Body.color = c.withAlpha(bodyAlpha);
    e.Body.transform.localScale = new V2(bodyScale, bodyScale);
    e.Halo.color = c.withAlpha(Mathf.clamp01(haloAlpha) * bodyAlpha);
    const hs = e.HaloSize * pop;
    e.Halo.transform.localScale = new V2(hs, hs);
  }

  // ------------------------------------------------------------------ queries used by the game rules

  /** Marks every entity inside the loop as captured (they fly into its centre) and returns them. */
  CaptureInside(poly: V2[], center: V2, result: Entity[]) {
    result.length = 0;
    const [min, max] = Geo.Bounds(poly);
    for (const e of this.live) {
      if (e.Captured) continue;
      const p = e.Pos;
      if (p.x < min.x || p.x > max.x || p.y < min.y || p.y > max.y) continue;
      if (!Geo.Contains(poly, p)) continue;
      Swarm.MarkCaptured(e, center);
      result.push(e);
    }
  }

  /** Prism nova: captures every hunter and cutter within `radius`. */
  Nova(center: V2, radius: number, result: Entity[]) {
    result.length = 0;
    const r2 = radius * radius;
    for (const e of this.live) {
      if (e.Captured || e.Kind === EntityKind.Mote || e.Kind === EntityKind.Prism) continue;
      if (e.Pos.sub(center).sqrMagnitude > r2) continue;
      Swarm.MarkCaptured(e, center);
      result.push(e);
    }
  }

  private static MarkCaptured(e: Entity, center: V2) {
    e.Captured = true;
    e.CaptureT = 0;
    e.CaptureFrom = e.Pos;
    e.CaptureTo = center;
  }

  FirstHarmfulTouching(p: V2, radius: number) {
    for (const e of this.live) {
      if (!e.Harmful) continue;
      const r = radius + e.Radius * 0.85; // slightly forgiving hitbox
      if (e.Pos.sub(p).sqrMagnitude < r * r) return e;
    }
    return null;
  }

  Knockback(center: V2, radius: number, strength: number) {
    for (const e of this.live) {
      if (e.Captured || e.Kind !== EntityKind.Hunter) continue;
      const d = e.Pos.sub(center);
      const m = d.magnitude;
      if (m > radius) continue;
      const dir = m > 0.001 ? d.div(m) : Random.insideUnitCircle.normalized;
      e.Knock = e.Knock.add(dir.mul(strength * (1 - (m / radius) * 0.5)));
      e.Heading = Math.atan2(dir.y, dir.x);
    }
  }
}

