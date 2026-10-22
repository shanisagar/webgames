import Phaser from "phaser";
import {
  Behaviour, Camera, Color, Ease, GameObject, Mathf, Mesh, MeshRenderer, PostFX, Random, Render, SpriteRenderer, Time, V2, V3,
} from "../../kit";
import { Save } from "./Core";
import { Geo } from "./Geo";
import { Art, GlowLine } from "./LumiArt";

const BaseBloom = 1.15;
/** Kit PostFX bloom strength that corresponds to the Unity volume's base bloom intensity. */
const BloomStrength = 0.9;

interface RingFx { Sr: SpriteRenderer; T: number; Duration: number; From: number; To: number; Color: Color }
interface LoopFx { Tr: GameObject; Fill: MeshRenderer; Outline: GlowLine; Mesh: Mesh; T: number; Color: Color; Strong: boolean }
interface Particle { img: Phaser.GameObjects.Image; pos: V2; vel: V2; color: Color; size: number; life: number; max: number }

/**
 * Game feel (Juice.cs): post-processing, camera shake, particles, shockwave rings, loop flashes and haptics.
 * Bloom and vignette drive the kit's PostFX pass; the particle system is a pool of additive glow sprites.
 */
export class Juice extends Behaviour {
  static Instance: Juice | null = null;

  private cameraHome = V2.zero;
  private trauma = 0;
  private bloomKick = 0;
  private chromaKick = 0;
  private readonly particles: Particle[] = [];
  private readonly rings: RingFx[] = [];
  private readonly loops: LoopFx[] = [];
  private readonly simplified: V2[] = [];
  private readonly triangles: number[] = [];

  Init() {
    Juice.Instance = this;
    this.cameraHome = Camera.position;
    // Volume: bloom (threshold 0.85, scatter 0.72), vignette 0.3, chromatic aberration, no tonemapping.
    PostFX.bloom = BloomStrength;
    PostFX.vignette = 0.3;
  }

  onDestroy() {
    if (Juice.Instance === this) Juice.Instance = null;
    for (const p of this.particles) p.img.destroy();
  }

  // ------------------------------------------------------------------ API

  Shake(amount: number) { this.trauma = Mathf.clamp01(this.trauma + amount); }

  Kick(bloomAmount: number, chromaAmount: number) {
    this.bloomKick = Math.max(this.bloomKick, bloomAmount);
    this.chromaKick = Math.max(this.chromaKick, chromaAmount);
  }

  Burst(p: V2, c: Color, count: number, speed = 5, size = 0.22, life = 0.55) {
    for (let i = 0; i < count; i++) {
      const a = Random.range(0, Math.PI * 2);
      this.Emit(p, new V2(Math.cos(a), Math.sin(a)).mul(speed * Random.range(0.35, 1)), c, size * Random.range(0.6, 1.3), life * Random.range(0.6, 1.2));
    }
  }

  Ember(p: V2, velocity: V2, c: Color) {
    this.Emit(p, velocity, c, Random.range(0.12, 0.22), Random.range(0.25, 0.45));
  }

  Ring(p: V2, c: Color, from: number, to: number, duration: number) {
    let r = this.rings.find((x) => !x.Sr.gameObject.activeSelf) ?? null;
    if (!r) {
      const go = new GameObject("Ring", this.gameObject);
      const sr = go.addComponent(new SpriteRenderer());
      sr.sprite = Art.Ring;
      sr.material = Art.Additive;
      sr.sortingOrder = 35;
      r = { Sr: sr, T: 0, Duration: duration, From: from, To: to, Color: c };
      this.rings.push(r);
    }
    r.Sr.gameObject.setActive(true);
    r.Sr.transform.position = p;
    r.T = 0;
    r.Duration = duration;
    r.From = from;
    r.To = to;
    r.Color = c;
    Juice.UpdateRing(r);
  }

  /** Flashes the filled loop polygon and its outline. */
  Loop(poly: V2[], center: V2, c: Color, strong: boolean) {
    Geo.Simplify(poly, this.simplified, 0.22);
    const simplified = this.simplified;
    if (simplified.length < 3) return;

    let fx = this.loops.find((x) => !x.Tr.activeSelf) ?? null;
    if (!fx) fx = this.CreateLoopFx();

    fx.Tr.setActive(true);
    fx.Tr.position = center;
    fx.Tr.localScale = V3.one;
    fx.T = 0;
    fx.Color = c;
    fx.Strong = strong;

    const vertices = simplified.map((p) => new V3(p.x - center.x, p.y - center.y, 0));

    fx.Mesh.clear();
    fx.Fill.enabled = Geo.Triangulate(simplified, this.triangles);
    if (fx.Fill.enabled) {
      fx.Mesh.setVertices(vertices);
      fx.Mesh.setTriangles([...this.triangles]);
    }

    fx.Outline.setPositions(vertices);
    this.UpdateLoop(fx);
  }

  private CreateLoopFx(): LoopFx {
    const go = new GameObject("LoopFlash", this.gameObject);
    const mesh = new Mesh();
    mesh.name = "Loop";
    const fill = go.addComponent(new MeshRenderer());
    fill.mesh = mesh;
    fill.material = Art.Fill;
    fill.sortingOrder = 5;

    const outline = new GameObject("Outline", go).addComponent(new GlowLine());
    outline.material = Art.Trail;
    outline.useWorldSpace = false;
    outline.loop = true;
    outline.sortingOrder = 16;
    const fx: LoopFx = { Tr: go, Fill: fill, Outline: outline, Mesh: mesh, T: 0, Color: Color.white, Strong: false };
    this.loops.push(fx);
    return fx;
  }

  static Haptic(strong = false) {
    if (!Save.Haptics) return;
    if (strong) try { navigator.vibrate?.(30); } catch { /* unsupported */ }
  }

  // ------------------------------------------------------------------ particles (ParticleSystem: world space, drag 2.5, fade + shrink)

  private Emit(pos: V2, vel: V2, color: Color, size: number, life: number) {
    let p = this.particles.find((x) => x.life <= 0);
    if (!p) {
      if (this.particles.length >= 2500 || !Render.scene) return;
      p = { img: Render.scene.add.image(0, 0, Art.Glow.key).setDepth(40).setBlendMode(Phaser.BlendModes.ADD), pos, vel, color, size, life: 0, max: 1 };
      this.particles.push(p);
    }
    Object.assign(p, { pos, vel, color, size, life, max: life });
    p.img.setVisible(true);
  }

  // ------------------------------------------------------------------ animation

  update() {
    const dt = Time.deltaTime;
    for (const r of this.rings) {
      if (!r.Sr.gameObject.activeSelf) continue;
      r.T += dt;
      if (r.T >= r.Duration) r.Sr.gameObject.setActive(false);
      else Juice.UpdateRing(r);
    }
    for (const fx of this.loops) {
      if (!fx.Tr.activeSelf) continue;
      fx.T += dt;
      if (fx.T >= 0.55) fx.Tr.setActive(false);
      else this.UpdateLoop(fx);
    }
    const drag = Math.max(0, 1 - 2.5 * dt);
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.img.setVisible(false); continue; }
      p.vel = p.vel.mul(drag);
      p.pos = p.pos.add(p.vel.mul(dt));
    }
  }

  private static UpdateRing(r: RingFx) {
    const k = Mathf.clamp01(r.T / r.Duration);
    const s = Mathf.lerp(r.From, r.To, Ease.outCubic(k));
    r.Sr.transform.localScale = new V2(s, s);
    r.Sr.color = r.Color.withAlpha((1 - k) * (1 - k));
  }

  private UpdateLoop(fx: LoopFx) {
    const k = Mathf.clamp01(fx.T / 0.55);
    const fade = (1 - k) * (1 - k);
    fx.Fill.color = fx.Color.withAlpha((fx.Strong ? 0.5 : 0.2) * fade);
    const lc = Color.lerp(fx.Color, Color.white, 0.3).withAlpha(fade);
    fx.Outline.startColor = lc;
    fx.Outline.endColor = lc;
    fx.Outline.widthMultiplier = Mathf.lerp(0.3, 0.05, k);
    const s = 1 + 0.08 * Ease.outCubic(k);
    fx.Tr.localScale = new V2(s, s);
  }

  lateUpdate() {
    const udt = Time.unscaledDeltaTime;
    this.trauma = Math.max(0, this.trauma - udt * 1.6);
    const s = this.trauma * this.trauma;
    const t = Time.unscaledTime * 28;
    const offset = new V2(Mathf.perlinNoise(1.3, t) - 0.5, Mathf.perlinNoise(7.9, t) - 0.5).mul(s * 1.2);
    const roll = (Mathf.perlinNoise(13.7, t) - 0.5) * s * 4;
    Camera.position = this.cameraHome.add(offset);
    Camera.roll = roll;

    this.bloomKick = Mathf.moveTowards(this.bloomKick, 0, udt * 3);
    this.chromaKick = Mathf.moveTowards(this.chromaKick, 0, udt * 2);
    PostFX.bloom = BloomStrength * (BaseBloom + this.bloomKick) / BaseBloom;

    // place the particles (colour over lifetime 1 → 0.8 @ 0.6 → 0, size over lifetime 1 → 0.1)
    Camera.updateView();
    const ppu = Camera.ppu, glow = Art.Glow;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      const k = 1 - p.life / p.max;
      const a = k < 0.6 ? 1 - (0.2 * k) / 0.6 : 0.8 * (1 - (k - 0.6) / 0.4);
      const sc = p.size * (1 - 0.9 * k) * ppu;
      const sp = Camera.worldToScreen(p.pos);
      p.img.setPosition(sp.x, sp.y).setDisplaySize(sc, sc).setTint(p.color.scale(Art.Particles.intensity).rgbInt).setAlpha(Mathf.clamp01(a * p.color.a));
      if (p.img.texture.key !== glow.key) p.img.setTexture(glow.key);
    }
  }
}
