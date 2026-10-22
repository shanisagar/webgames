import Phaser from "phaser";
import { Art, CasualArt } from "./art";
import { Color, Ease, Mathf, Random, V2 } from "./math";
import { Settings } from "./prefs";
import { Camera, PostFX, Render, Sprite, SpriteRenderer } from "./render";
import { Behaviour, GameObject, Time } from "./scene";

/**
 * Game feel shared by all games (Fx.cs): bloom/vignette post-processing, trauma-based camera shake around a
 * followable camera target, pooled particle bursts, shockwave rings and haptics.
 */
export class Fx extends Behaviour {
  static I: Fx | null = null;
  static readonly BaseBloom = 1.1;

  /** Where the camera should be. Shake is applied on top. */
  CameraTarget = V2.zero;
  private trauma = 0;
  private bloomKick = 0;
  private chromaKick = 0;
  /** Calm look (light casual games): softer bloom, no colour fringing. */
  calm = false;
  private baseBloomStrength = 0.9;
  private particles: P[] = [];
  private rings: { sr: SpriteRenderer; t: number; duration: number; from: number; to: number; color: Color }[] = [];

  init() {
    Fx.I = this;
    PostFX.bloom = this.baseBloomStrength;
    PostFX.vignette = 0.3;
  }

  /** CasualLook.Calm: bloom only on the brightest pixels, lighter vignette. */
  setCalm(bloomThreshold = 1.15, vignette = 0.18) {
    this.calm = true;
    // A higher Unity bloom threshold means less bloom overall.
    this.baseBloomStrength = Mathf.clamp(0.9 - (bloomThreshold - 0.85) * 2.2, 0, 0.9);
    PostFX.vignette = vignette;
  }

  onDestroy() { if (Fx.I === this) Fx.I = null; for (const p of this.particles) p.img.destroy(); }

  // ------------------------------------------------------------------ API

  shake(amount: number) { this.trauma = Mathf.clamp01(this.trauma + amount); }

  kick(bloomAmount: number, chromaAmount = 0) {
    this.bloomKick = Math.max(this.bloomKick, bloomAmount);
    this.chromaKick = Math.max(this.chromaKick, chromaAmount);
  }

  burst(p: V2, c: Color, count: number, speed = 5, size = 0.22, life = 0.55) {
    for (let i = 0; i < count; i++) {
      const a = Random.range(0, Math.PI * 2);
      this.emit(p, V2.fromAngle(a, speed * Random.range(0.35, 1)), c, size * Random.range(0.6, 1.3), life * Random.range(0.6, 1.2));
    }
  }

  /** Directional spray (muzzle flashes, exhaust, sparks off walls). */
  spray(p: V2, dir: V2, c: Color, count: number, speed: number, spread: number, size = 0.16, life = 0.3) {
    const baseA = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < count; i++) {
      const a = baseA + Random.range(-spread, spread);
      this.emit(p, V2.fromAngle(a, speed * Random.range(0.5, 1)), c, size * Random.range(0.7, 1.2), life * Random.range(0.6, 1.2));
    }
  }

  ring(p: V2, c: Color, from: number, to: number, duration: number) {
    let r = this.rings.find((x) => !x.sr.gameObject.activeSelf);
    if (!r) {
      r = { sr: Art.spr(this.gameObject, "Ring", Art.Ring, Color.white, 1, 55, Art.Additive), t: 0, duration, from, to, color: c };
      this.rings.push(r);
    }
    r.sr.gameObject.setActive(true);
    r.sr.transform.position = p;
    Object.assign(r, { t: 0, duration, from, to, color: c });
    this.updateRing(r);
  }

  clearParticles() { for (const p of this.particles) { p.life = 0; p.img.setVisible(false); } }

  static haptic(strong = false) {
    if (!Settings.Haptics || !strong) return;
    try { navigator.vibrate?.(30); } catch { /* unsupported */ }
  }

  // ------------------------------------------------------------------ particles (glow sprites, additive)

  private emit(pos: V2, vel: V2, c: Color, size: number, life: number) {
    let p = this.particles.find((x) => x.life <= 0);
    if (!p) {
      if (this.particles.length >= 3000 || !Render.scene) return;
      const glow = Art.Glow;
      p = { img: Render.scene.add.image(0, 0, glow.key).setDepth(60).setBlendMode(Phaser.BlendModes.ADD), pos, vel, color: c, size, life: 0, max: 1 };
      this.particles.push(p);
    }
    Object.assign(p, { pos, vel, color: c, size, life, max: life });
    p.img.setVisible(true);
  }

  update() {
    const dt = Time.deltaTime;
    for (const r of this.rings) {
      if (!r.sr.gameObject.activeSelf) continue;
      r.t += dt;
      if (r.t >= r.duration) r.sr.gameObject.setActive(false);
      else this.updateRing(r);
    }
    // limitVelocityOverLifetime drag 2.5, colour fade, size 1 → 0.1
    const drag = Math.max(0, 1 - 2.5 * dt);
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.img.setVisible(false); continue; }
      p.vel = p.vel.mul(drag);
      p.pos = p.pos.add(p.vel.mul(dt));
    }
  }

  private updateRing(r: { sr: SpriteRenderer; t: number; duration: number; from: number; to: number; color: Color }) {
    const k = Mathf.clamp01(r.t / r.duration);
    const s = Mathf.lerp(r.from, r.to, Ease.outCubic(k));
    r.sr.transform.localScale = new V2(s, s);
    r.sr.color = r.color.withAlpha((1 - k) * (1 - k));
  }

  /** Camera + post-processing, and particle placement (runs after the game's update). */
  lateUpdate() {
    const udt = Time.unscaledDeltaTime;
    this.trauma = Math.max(0, this.trauma - udt * 1.6);
    const s = this.trauma * this.trauma;
    const t = Time.unscaledTime * 28;
    const off = new V2(Mathf.perlinNoise(1.3, t) - 0.5, Mathf.perlinNoise(7.9, t) - 0.5).mul(s * 1.2);
    Camera.position = this.CameraTarget.add(off);
    Camera.roll = (Mathf.perlinNoise(13.7, t) - 0.5) * s * 4;

    this.bloomKick = Mathf.moveTowards(this.bloomKick, 0, udt * 3);
    this.chromaKick = Mathf.moveTowards(this.chromaKick, 0, udt * 2);
    PostFX.bloom = this.baseBloomStrength * (1 + this.bloomKick / Fx.BaseBloom);

    Camera.updateView();
    const ppu = Camera.ppu, glow = Art.Glow;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      const k = 1 - p.life / p.max; // 0 → 1
      const a = k < 0.6 ? 1 - (0.2 * k) / 0.6 : 0.8 * (1 - (k - 0.6) / 0.4);
      const sc = p.size * (1 - 0.9 * k) * ppu;
      const sp = Camera.worldToScreen(p.pos);
      p.img.setPosition(sp.x, sp.y).setDisplaySize(sc, sc).setTint(p.color.scale(2.2).rgbInt).setAlpha(Mathf.clamp01(a * p.color.a));
      if (p.img.texture.key !== glow.key) p.img.setTexture(glow.key);
    }
  }
}

interface P { img: Phaser.GameObjects.Image; pos: V2; vel: V2; color: Color; size: number; life: number; max: number }

// ------------------------------------------------------------------ Backdrop

const BACKDROP_FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uTop, uBottom, uNebA, uNebB, uGrid;
uniform float uGridScale, uDanger, uFw;
uniform vec2 uSize, uOffset;
uniform vec4 uFlash;
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float t = uTime;
  vec2 w = (uv - 0.5) * uSize + uOffset;
  vec2 aspect = vec2(uSize.x / max(uSize.y, 0.001), 1.0);
  vec3 col = mix(uBottom, uTop, smoothstep(0.0, 1.0, uv.y));
  vec2 c1 = vec2(sin(t * 0.05) * 0.25 - 0.15, cos(t * 0.04) * 0.2 + 0.2);
  vec2 c2 = vec2(cos(t * 0.03) * 0.2 + 0.2, sin(t * 0.06) * 0.25 - 0.25);
  vec2 d1 = (uv - 0.5 - c1) * aspect;
  vec2 d2 = (uv - 0.5 - c2) * aspect;
  col += uNebA * exp(-dot(d1, d1) * 7.0) * 0.10;
  col += uNebB * exp(-dot(d2, d2) * 8.0) * 0.08;
  vec2 gw = w / max(uGridScale, 0.001);
  vec2 g = fract(gw + 0.5) - 0.5;
  float dotMask = 1.0 - smoothstep(0.035, 0.035 + uFw * 1.5, length(g));
  col += uGrid * dotMask * 0.09;
  vec2 sw = w * 0.45 + vec2(0.0, t * 0.05);
  vec2 cell = floor(sw);
  float h = hash21(cell);
  vec2 jitter = vec2(hash21(cell + 17.1), hash21(cell + 43.7)) - 0.5;
  vec2 sp = fract(sw) - 0.5 - jitter * 0.6;
  float twinkle = 0.55 + 0.45 * sin(t * (0.8 + h * 2.5) + h * 60.0);
  float star = step(0.9, h) * (1.0 - smoothstep(0.0, 0.06, length(sp))) * twinkle;
  col += star * 0.5;
  vec2 e = (uv - 0.5) * 2.0;
  float edge = smoothstep(0.55, 1.25, length(e * vec2(1.0, 0.9)));
  col += vec3(1.0, 0.15, 0.25) * uDanger * edge * (0.55 + 0.45 * sin(t * 7.0)) * 0.6;
  col = mix(col, uFlash.rgb, clamp(uFlash.a, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

/** Full-screen animated backdrop (Backdrop.shader): gradient, nebulae, world-anchored dot grid, stars, danger, flash. */
export class Backdrop extends Behaviour {
  private shader: Phaser.GameObjects.Shader | null = null;
  private fallback: Phaser.GameObjects.Graphics | null = null;
  private danger = 0;
  private targetDanger = 0;
  private flash = 0;
  private flashColor = Color.black;
  private colors = { top: Color.black, bottom: Color.black, a: Color.white, b: Color.white, grid: Color.white, spacing: 1 };

  init(top: Color, bottom: Color, accent: Color, accent2: Color, gridSpacing: number) {
    this.colors = { top, bottom, a: accent, b: accent2, grid: accent, spacing: gridSpacing };
    const scene = Render.scene!;
    if (scene.game.renderer.type === Phaser.WEBGL) {
      const v3 = (c: Color) => ({ type: "3f", value: { x: c.r, y: c.g, z: c.b } });
      const base = new Phaser.Display.BaseShader("na-backdrop", BACKDROP_FRAG, undefined, {
        uRes: { type: "2f", value: { x: 1, y: 1 } },
        uTime: { type: "1f", value: 0 },
        uTop: v3(top), uBottom: v3(bottom), uNebA: v3(accent), uNebB: v3(accent2), uGrid: v3(accent),
        uGridScale: { type: "1f", value: gridSpacing },
        uDanger: { type: "1f", value: 0 },
        uFw: { type: "1f", value: 0.01 },
        uSize: { type: "2f", value: { x: 16, y: 28 } },
        uOffset: { type: "2f", value: { x: 0, y: 0 } },
        uFlash: { type: "4f", value: { x: 0, y: 0, z: 0, w: 0 } },
      });
      this.shader = scene.add.shader(base, 0, 0, Camera.pixelWidth, Camera.pixelHeight).setOrigin(0, 0).setDepth(-100000);
    } else {
      this.fallback = scene.add.graphics().setDepth(-100000);
    }
  }

  setDanger(amount: number) { this.targetDanger = Mathf.clamp01(amount); }
  flashScreen(color: Color, amount: number) { this.flashColor = color; this.flash = Math.max(this.flash, amount); }
  /** Unity name. */
  Flash(color: Color, amount: number) { this.flashScreen(color, amount); }

  onDestroy() { this.shader?.destroy(); this.fallback?.destroy(); }

  lateUpdate() {
    const dt = Time.unscaledDeltaTime;
    this.danger = Mathf.moveTowards(this.danger, this.targetDanger, dt * 1.5);
    this.flash = Mathf.moveTowards(this.flash, 0, dt * 2.2);
    const W = Camera.pixelWidth, H = Camera.pixelHeight;
    const h = Camera.orthographicSize * 2, w = h * Camera.aspect;
    if (this.shader) {
      const s = this.shader;
      if (s.width !== W || s.height !== H) s.setSize(W, H);
      s.setUniform("uRes.value.x", W);
      s.setUniform("uRes.value.y", H);
      s.setUniform("uTime.value", Time.unscaledTime);
      s.setUniform("uSize.value.x", w);
      s.setUniform("uSize.value.y", h);
      s.setUniform("uOffset.value.x", Camera.position.x);
      s.setUniform("uOffset.value.y", Camera.position.y);
      s.setUniform("uDanger.value", this.danger);
      s.setUniform("uFw.value", (w / Math.max(1, W)) / Math.max(this.colors.spacing, 0.001));
      s.setUniform("uFlash.value.x", this.flashColor.r);
      s.setUniform("uFlash.value.y", this.flashColor.g);
      s.setUniform("uFlash.value.z", this.flashColor.b);
      s.setUniform("uFlash.value.w", this.flash);
    } else if (this.fallback) {
      const g = this.fallback;
      g.clear();
      g.fillGradientStyle(this.colors.top.rgbInt, this.colors.top.rgbInt, this.colors.bottom.rgbInt, this.colors.bottom.rgbInt, 1);
      g.fillRect(0, 0, W, H);
    }
  }
}

// ------------------------------------------------------------------ CasualFx

interface CP { sr: SpriteRenderer; pos: V2; vel: V2; t: number; life: number; size: number; spin: number; rot: number; gravity: number; drag: number; color: Color; active: boolean; shrink: boolean }

/**
 * Flat (alpha-blended, non-glowing) particles that stay visible on light backgrounds: pops, confetti, sparkles.
 * Uses scaled time, so they freeze while the game is paused (CasualKit.cs CasualFx).
 */
export class CasualFx extends Behaviour {
  private pool: CP[] = [];
  private cursor = 0;

  static create(parent: GameObject | null, order = 55, capacity = 260) {
    const go = new GameObject("CasualFx", parent);
    const fx = go.addComponent(new CasualFx());
    for (let i = 0; i < capacity; i++) {
      const sr = Art.spr(go, "P", CasualArt.Dot, Color.white, 0.2, order, Art.Flat);
      sr.gameObject.setActive(false);
      fx.pool.push({ sr, pos: V2.zero, vel: V2.zero, t: 0, life: 1, size: 0.2, spin: 0, rot: 0, gravity: 0, drag: 1.5, color: Color.white, active: false, shrink: true });
    }
    return fx;
  }

  emit(pos: V2, vel: V2, color: Color, size: number, life: number, sprite: Sprite | null = null, gravity = 0, spin = 0, shrink = true, drag = 1.5) {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    Object.assign(p, { pos, vel, color, size, life: Math.max(0.05, life), t: 0, gravity, spin, rot: Random.range(0, 360), shrink, drag, active: true });
    p.sr.sprite = sprite ?? CasualArt.Dot;
    p.sr.color = color;
    p.sr.gameObject.setActive(true);
    this.place(p);
  }

  /** Round burst of dots. */
  pop(pos: V2, color: Color, count = 12, speed = 4, size = 0.22, life = 0.5) {
    for (let i = 0; i < count; i++) {
      const a = Random.range(0, Math.PI * 2), s = speed * Random.range(0.35, 1);
      this.emit(pos, V2.fromAngle(a, s), color, size * Random.range(0.6, 1.2), life * Random.range(0.7, 1.2), null, 0, 0, true, 2.5);
    }
  }

  /** Falling, spinning paper confetti in mixed colours. */
  confetti(pos: V2, count: number, speed: number, colors: Color[], size = 0.22) {
    for (let i = 0; i < count; i++) {
      const a = Random.range(0.15 * Math.PI, 0.85 * Math.PI), s = speed * Random.range(0.4, 1.1);
      const c = colors[Random.rangeInt(0, colors.length)];
      this.emit(pos, V2.fromAngle(a, s), c, size, Random.range(1.2, 2.2), CasualFx.confetto, 9, Random.range(-540, 540), false, 1.2);
    }
  }

  /** Little twinkling stars. */
  sparkle(pos: V2, color: Color, count = 6, radius = 0.6, size = 0.3) {
    for (let i = 0; i < count; i++) {
      const o = Random.insideUnitCircle.mul(radius);
      this.emit(pos.add(o), o.mul(1.5).add(V2.up.mul(0.6)), color, size * Random.range(0.6, 1.2), Random.range(0.45, 0.8), CasualArt.StarShape, 0, Random.range(-200, 200), true, 2);
    }
  }

  clear() { for (const p of this.pool) { p.active = false; p.sr.gameObject.setActive(false); } }

  private static get confetto() {
    return CasualArt.make("confetto", 32, 16, (p) => new Color(1, 1, 1, CasualArt.fill(CasualArt.sdBox(p, new V2(0.9, 0.4), 0.15), 2 / 32)));
  }

  update() {
    const dt = Time.deltaTime;
    if (dt <= 0) return;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) { p.active = false; p.sr.gameObject.setActive(false); continue; }
      p.vel = new V2(p.vel.x, p.vel.y - p.gravity * dt).mul(Math.max(0, 1 - p.drag * dt));
      p.pos = p.pos.add(p.vel.mul(dt));
      p.rot += p.spin * dt;
      this.place(p);
    }
  }

  private place(p: CP) {
    const k = p.t / p.life;
    const s = p.shrink ? p.size * (1 - k * k) : p.size * (p.spin !== 0 ? Math.abs(Math.cos(p.rot * 0.02)) * 0.6 + 0.4 : 1);
    p.sr.transform.localPosition = p.pos;
    p.sr.transform.localScale = new V2(p.size, s);
    p.sr.transform.localEulerZ = p.rot;
    p.sr.color = p.color.withAlpha(p.color.a * (k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1));
  }
}
