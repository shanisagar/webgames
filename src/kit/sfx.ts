import { Mathf, SysRandom } from "./math";
import { Settings } from "./prefs";
import { Time } from "./scene";

export enum Snd {
  Click, Tick, Confirm, Deny, Shoot, Laser, Hit, Hurt, Explode, Boom, Pickup, PowerUp, Warn, Alarm,
  Win, Lose, NewBest, Start, Whoosh, Beep, BeepHigh, Coin, Build, Zap, Charge, Step,
}

/** A game's soundtrack: tempo, key and a four-chord progression (scale degrees, 0-based). */
export interface MusicStyle {
  bpm: number;
  rootHz: number;
  degrees: number[];
  major?: boolean;
  seed?: number;
  /** 0..1: how busy the drive layer's arpeggio and drums are. */
  energy?: number;
}

export const DefaultMusic: MusicStyle = { bpm: 112, rootHz: 82.41, degrees: [0, 5, 2, 6], seed: 1, energy: 0.7 };

const RATE = 44100;
const MUSIC_RATE = 22050;
const MUSIC_VOLUME = 0.4;
const TWO_PI = Math.PI * 2;

/** A synthesized clip (AudioClip). Samples are made immediately; the Web Audio buffer once audio is unlocked. */
export class AudioClip {
  private buffer: AudioBuffer | null = null;
  constructor(readonly name: string, readonly data: Float32Array, readonly rate: number) {}
  get length() { return this.data.length / this.rate; }
  bufferFor(ctx: AudioContext) {
    if (!this.buffer) {
      this.buffer = ctx.createBuffer(1, this.data.length, this.rate);
      this.buffer.getChannelData(0).set(this.data);
    }
    return this.buffer;
  }
}

/** A looping voice the game drives every frame (engines, hums): AudioSource with volume and pitch. */
export class LoopSource {
  volume = 0;
  pitch = 1;
  node: AudioBufferSourceNode | null = null;
  gain: GainNode | null = null;
  constructor(readonly clip: AudioClip) {}
}

// synthesis helpers (phase in cycles)
const sinP = (phase: number) => Math.sin(TWO_PI * phase);
const sawP = (phase: number) => (phase - Math.floor(phase)) * 2 - 1;
const sqrP = (phase: number) => (phase - Math.floor(phase) < 0.5 ? 1 : -1);
const triP = (phase: number) => Math.abs((phase - Math.floor(phase)) * 4 - 2) - 1;
function glide(t: number, f0: number, f1: number, d: number) {
  if (t <= d) return f0 * t + ((f1 - f0) * t * t) / (2 * d);
  return f0 * d + (f1 - f0) * d * 0.5 + f1 * (t - d);
}
function env(t: number, attack: number, decay: number) {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp((-(t - attack) / Math.max(0.0001, decay)) * 4);
}

function make(name: string, seconds: number, fn: (t: number) => number, fade = true) {
  const n = Math.ceil(seconds * RATE);
  const data = new Float32Array(n);
  const fadeSamples = RATE * 0.01;
  for (let i = 0; i < n; i++) {
    const f = fade ? Mathf.clamp01((n - i) / fadeSamples) : 1;
    data[i] = Mathf.clamp(fn(i / RATE) * f, -1, 1);
  }
  return new AudioClip("na-" + name, data, RATE);
}

function arp(t: number, notes: number[], spacing: number, decay: number, triangle = false) {
  let v = 0;
  for (let i = 0; i < notes.length; i++) {
    const st = t - i * spacing;
    if (st <= 0) continue;
    const tone = triangle ? triP(notes[i] * st) * 0.7 + sinP(notes[i] * 0.5 * st) * 0.4 : sinP(notes[i] * st) + 0.35 * sinP(notes[i] * 2.01 * st);
    v += tone * env(st, 0.004, decay);
  }
  return v;
}

/**
 * Procedural audio shared by every game (Sfx.cs): a bank of synthesized effects and a two-layer adaptive
 * soundtrack (calm pad + drive layer that fades in with intensity).
 */
class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private fxGain: GainNode | null = null;
  private clips = new Map<Snd, AudioClip>();
  private lastPlayed = new Map<Snd, number>();
  private calm: GainNode | null = null;
  private drive: GainNode | null = null;
  private music: [Float32Array, Float32Array] | null = null;
  private musicStarted = false;
  private intensity = 0;
  private targetIntensity = 0;
  private duck = 1;
  private targetDuck = 1;
  private musicFade = 0;
  /** Silences the soundtrack (AudioSource.mute on the music loops), e.g. while a music game plays its own notes. */
  musicMuted = false;
  private loops: LoopSource[] = [];
  private style: MusicStyle = DefaultMusic;
  /** Mutes everything while a full-screen ad plays. */
  paused = false;
  effectsVolume = 1;

  init(style: MusicStyle | undefined) {
    this.style = style && style.degrees?.length ? style : DefaultMusic;
    if (!this.clips.size) this.buildEffects();
    this.music = null;
    this.musicStarted = false;
    this.intensity = this.targetIntensity = 0;
    this.duck = this.targetDuck = 1;
    this.musicFade = 0;
    this.loops = [];
  }

  /** Browsers allow audio only after a user gesture; the host calls this on the first tap/click/key. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.fxGain = this.ctx.createGain();
      this.fxGain.connect(this.master);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (!this.musicStarted) this.startMusic();
    for (const l of this.loops) this.startLoop(l);
  }

  setHidden(hidden: boolean) {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private startMusic() {
    if (!this.ctx || !this.master) return;
    if (!this.music) this.music = buildMusic(this.style);
    this.musicStarted = true;
    const start = this.ctx.currentTime + 0.1;
    const layers = this.music.map((data) => {
      const buf = this.ctx!.createBuffer(1, data.length, MUSIC_RATE);
      buf.getChannelData(0).set(data);
      const src = this.ctx!.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx!.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.master!);
      src.start(start);
      return g;
    });
    [this.calm, this.drive] = layers;
  }

  /** Per-frame volume work (called by the host loop). */
  update() {
    const dt = Time.unscaledDeltaTime;
    this.intensity = Mathf.moveTowards(this.intensity, this.targetIntensity, dt * 0.35);
    this.duck = Mathf.moveTowards(this.duck, this.targetDuck, dt * 1.5);
    this.musicFade = Mathf.moveTowards(this.musicFade, Settings.Music ? 1 : 0, dt * 0.8);
    const muted = this.paused ? 0 : 1;
    const master = MUSIC_VOLUME * this.duck * this.musicFade * muted * (this.musicMuted ? 0 : 1);
    if (this.calm && this.ctx) {
      this.calm.gain.setTargetAtTime(master, this.ctx.currentTime, 0.03);
      this.drive!.gain.setTargetAtTime(master * this.intensity, this.ctx.currentTime, 0.03);
    }
    if (this.fxGain && this.ctx) this.fxGain.gain.setTargetAtTime(muted, this.ctx.currentTime, 0.02);
    for (const l of this.loops) {
      if (!l.gain || !l.node || !this.ctx) continue;
      l.gain.gain.setTargetAtTime(Settings.Sound ? Math.max(0, l.volume) * muted : 0, this.ctx.currentTime, 0.03);
      l.node.playbackRate.setTargetAtTime(Math.max(0.05, l.pitch), this.ctx.currentTime, 0.03);
    }
  }

  // ------------------------------------------------------------------ API

  play(id: Snd, volume = 1, pitch = 1) {
    if (!Settings.Sound) return;
    const now = Time.unscaledTime;
    const last = this.lastPlayed.get(id);
    if (last !== undefined && now - last < 0.03) return;
    this.lastPlayed.set(id, now);
    const clip = this.clips.get(id);
    if (clip) this.playClip(clip, volume, pitch);
  }

  /** Plays a game-specific clip (made with Sfx.make) through the shared output. */
  playClip(clip: AudioClip | null | undefined, volume = 1, pitch = 1) {
    if (!clip || !Settings.Sound || !this.ctx || !this.fxGain || this.paused) return;
    const src = this.ctx.createBufferSource();
    src.buffer = clip.bufferFor(this.ctx);
    src.playbackRate.value = Math.max(0.05, pitch);
    const g = this.ctx.createGain();
    g.gain.value = volume * this.effectsVolume;
    src.connect(g).connect(this.fxGain);
    src.start();
  }

  setIntensity(v: number) { this.targetIntensity = Mathf.clamp01(v); }
  duckMusic(on: boolean) { this.targetDuck = on ? 0.45 : 1; }

  /** Creates a looping source (engines, hums). The caller drives volume and pitch every frame. */
  createLoop(clip: AudioClip) {
    const l = new LoopSource(clip);
    this.loops.push(l);
    this.startLoop(l);
    return l;
  }

  private startLoop(l: LoopSource) {
    if (!this.ctx || !this.master || l.node) return;
    const src = this.ctx.createBufferSource();
    src.buffer = l.clip.bufferFor(this.ctx);
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.master);
    src.start();
    l.node = src;
    l.gain = g;
  }

  stopLoops() {
    for (const l of this.loops) { try { l.node?.stop(); } catch { /* already stopped */ } }
    this.loops = [];
  }

  /** Stops the soundtrack (when a game unmounts). */
  shutdown() {
    this.stopLoops();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = this.fxGain = this.calm = this.drive = null;
    this.musicStarted = false;
  }

  // ------------------------------------------------------------------ effects bank

  private buildEffects() {
    const rng = new SysRandom(5);
    const noise = () => rng.nextDouble() * 2 - 1;
    const c = this.clips;
    c.set(Snd.Click, make("click", 0.06, (t) => sinP(1250 * t) * env(t, 0.002, 0.04) * 0.3));
    c.set(Snd.Tick, make("tick", 0.04, (t) => sinP(2200 * t) * env(t, 0.001, 0.02) * 0.18));
    c.set(Snd.Confirm, make("confirm", 0.22, (t) => sinP((t < 0.08 ? 660 : 990) * t) * env(t % 0.08, 0.003, 0.12) * 0.22));
    c.set(Snd.Deny, make("deny", 0.22, (t) => sqrP(170 * t) * env(t, 0.003, 0.18) * 0.13));
    c.set(Snd.Shoot, make("shoot", 0.09, (t) => (sqrP(glide(t, 1400, 500, 0.08)) * 0.5 + noise() * 0.2) * env(t, 0.001, 0.06) * 0.16));
    c.set(Snd.Laser, make("laser", 0.28, (t) => sawP(glide(t, 2400, 300, 0.25)) * env(t, 0.002, 0.22) * 0.17));
    c.set(Snd.Hit, make("hit", 0.08, (t) => (noise() * 0.6 + sinP(320 * t)) * env(t, 0.001, 0.05) * 0.22));
    c.set(Snd.Hurt, make("hurt", 0.45, (t) =>
      (sawP(glide(t, 300, 80, 0.4)) * 0.5 + sqrP(glide(t, 151, 41, 0.4)) * 0.3) * env(t, 0.003, 0.35) * 0.33 + noise() * env(t, 0.001, 0.07) * 0.3));
    let exLp = 0;
    c.set(Snd.Explode, make("explode", 0.55, (t) => {
      exLp += (noise() - exLp) * Mathf.lerp(0.5, 0.05, t / 0.55);
      return exLp * env(t, 0.002, 0.4) * 0.55 + sinP(glide(t, 120, 40, 0.4)) * env(t, 0.002, 0.3) * 0.4;
    }));
    let boomLp = 0;
    c.set(Snd.Boom, make("boom", 1.2, (t) => {
      boomLp += (noise() - boomLp) * Mathf.lerp(0.35, 0.02, t / 1.2);
      return boomLp * env(t, 0.003, 0.9) * 0.7 + sinP(glide(t, 90, 30, 0.9)) * env(t, 0.004, 0.8) * 0.5;
    }));
    c.set(Snd.Pickup, make("pickup", 0.14, (t) => sinP(glide(t, 900, 1800, 0.12)) * env(t, 0.002, 0.1) * 0.22));
    c.set(Snd.PowerUp, make("powerup", 0.6, (t) => arp(t, [523.25, 659.25, 783.99, 1046.5, 1318.5], 0.07, 0.35) * 0.13));
    c.set(Snd.Warn, make("warn", 0.32, (t) => sinP((t < 0.16 ? 660 : 880) * t) * env(t % 0.16, 0.005, 0.12) * 0.1));
    c.set(Snd.Alarm, make("alarm", 0.9, (t) => {
      const f = 600 + 300 * Math.abs(Math.sin(t * Math.PI * 2.2));
      return (sqrP(f * t) * 0.3 + sinP(f * t)) * env(t, 0.01, 0.8) * 0.1;
    }));
    c.set(Snd.Win, make("win", 1.3, (t) => arp(t, [523.25, 659.25, 783.99, 1046.5, 1318.5], 0.1, 0.9) * 0.16));
    c.set(Snd.Lose, make("lose", 1.5, (t) => arp(t, [659.25, 523.25, 440, 329.63], 0.2, 0.9, true) * 0.16));
    c.set(Snd.NewBest, make("newbest", 1.4, (t) => arp(t, [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98], 0.08, 0.8) * 0.12));
    c.set(Snd.Start, make("start", 0.6, (t) => (sinP(glide(t, 220, 880, 0.45)) * 0.7 + triP(glide(t, 440, 1760, 0.45)) * 0.2) * env(t, 0.01, 0.5) * 0.22));
    let whLp = 0;
    c.set(Snd.Whoosh, make("whoosh", 0.35, (t) => {
      whLp += (noise() - whLp) * Mathf.lerp(0.05, 0.4, Math.sin((Math.PI * t) / 0.35));
      return whLp * Math.sin((Math.PI * t) / 0.35) * 0.4;
    }));
    c.set(Snd.Beep, make("beep", 0.14, (t) => sqrP(880 * t) * env(t, 0.003, 0.12) * 0.1));
    c.set(Snd.BeepHigh, make("beephigh", 0.35, (t) => sqrP(1760 * t) * env(t, 0.003, 0.3) * 0.1));
    c.set(Snd.Coin, make("coin", 0.25, (t) => sinP((t < 0.07 ? 1318.5 : 1760) * t) * env(t < 0.07 ? t : t - 0.07, 0.002, 0.15) * 0.2));
    c.set(Snd.Build, make("build", 0.25, (t) => sinP(glide(t, 240, 110, 0.2)) * env(t, 0.002, 0.18) * 0.4 + noise() * env(t, 0.001, 0.02) * 0.2));
    let zapHp = 0;
    c.set(Snd.Zap, make("zap", 0.2, (t) => {
      const n = noise();
      zapHp += (n - zapHp) * 0.3;
      return ((n - zapHp) * 0.4 + sawP(glide(t, 1800, 600, 0.18)) * 0.2) * env(t, 0.001, 0.15) * 0.35;
    }));
    c.set(Snd.Charge, make("charge", 0.9, (t) => (sinP(glide(t, 200, 1200, 0.9)) * 0.6 + sqrP(glide(t, 100, 600, 0.9)) * 0.1) * Mathf.clamp01(t / 0.1) * 0.14));
    c.set(Snd.Step, make("step", 0.05, (t) => noise() * env(t, 0.001, 0.02) * 0.1));
  }
}

/** Two layers: calm (pad, sub, bell) and drive (kick, hats, clap, arpeggio, bass pulse). Pure math. */
function buildMusic(style: MusicStyle): [Float32Array, Float32Array] {
  const beat = 60 / Math.max(60, style.bpm);
  const barLen = beat * 4;
  const bars = 8;
  const n = Math.floor(barLen * bars * MUSIC_RATE);
  const calm = new Float32Array(n), drive = new Float32Array(n);
  const scale = style.major ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const chords: number[][] = [], bass: number[] = [];
  for (let c = 0; c < 4; c++) {
    const d = style.degrees[c % style.degrees.length];
    chords.push([0, 1, 2, 3].map((k) => {
      const deg = d + k * 2;
      const semis = scale[deg % 7] + 12 * Math.floor(deg / 7);
      return style.rootHz * 2 * Math.pow(2, semis / 12);
    }));
    bass.push(style.rootHz * Math.pow(2, scale[d % 7] / 12));
  }
  const rng = new SysRandom((style.seed ?? 1) * 7919 + 11);
  const arpPattern = Array.from({ length: 8 }, () => rng.next(4));
  const energy = Mathf.clamp01(style.energy ?? 0.7);
  let hatLp = 0, clapLp = 0;
  const chordLen = barLen * 2;
  for (let i = 0; i < n; i++) {
    const t = i / MUSIC_RATE;
    const ci = Math.min(Math.floor(t / chordLen), 3);
    const chordT = t - ci * chordLen;
    const edge = Mathf.clamp01(chordT / 0.25) * Mathf.clamp01((chordLen - chordT) / 0.4);
    const beatT = t % beat;
    const beatIndex = Math.floor(t / beat);
    const chord = chords[ci];
    let pad = 0;
    for (let k = 0; k < 3; k++) {
      const f = chord[k];
      pad += sinP(f * t) * 0.5 + sinP(f * 1.004 * t) * 0.4 + sinP(f * 0.5 * t) * 0.2;
    }
    pad *= edge * (0.8 + 0.2 * Math.sin(TWO_PI * t * 0.25));
    const sub = sinP(bass[ci] * t) * (0.6 + 0.4 * Math.exp(-beatT * 3)) * edge;
    const bellF = chord[beatIndex % 4] * 2;
    const bell = (sinP(bellF * t) + 0.3 * sinP(bellF * 2.01 * t)) * Math.exp(-beatT * 5) * edge;
    calm[i] = Mathf.clamp(pad * 0.045 + sub * 0.22 + bell * 0.045, -1, 1);

    const kick = Math.sin(TWO_PI * (45 * beatT + (110 * (1 - Math.exp(-beatT * 25))) / 25)) * Math.exp(-beatT * 7);
    const noise = rng.nextDouble() * 2 - 1;
    const hp = noise - hatLp;
    hatLp += (noise - hatLp) * 0.25;
    const hat = hp * Math.exp(-((t + beat * 0.5) % beat) * 45);
    clapLp += (noise - clapLp) * 0.35;
    const inBar = beatIndex % 4;
    const clap = inBar === 1 || inBar === 3 ? clapLp * Math.exp(-beatT * 16) : 0;
    const stepLen = energy > 0.5 ? beat / 4 : beat / 2;
    const step = Math.floor(t / stepLen);
    const arpV = triP(chord[arpPattern[step % 8]] * 2 * t) * Math.exp(-(t % stepLen) * 20);
    const bassPulse = sawP(bass[ci] * 2 * t) * Math.exp(-((t + beat * 0.5) % (beat * 0.5)) * 12) * energy;
    drive[i] = Mathf.clamp(kick * 0.34 + hat * 0.06 + clap * 0.1 + arpV * 0.05 + bassPulse * 0.06, -1, 1);
  }
  return [calm, drive];
}

const engine = new SfxEngine();

/** Static-style API matching Sfx.cs: Sfx.play(Snd.Coin), Sfx.make(...), Sfx.sinP(...). */
export const Sfx = {
  engine,
  play: (id: Snd, volume = 1, pitch = 1) => engine.play(id, volume, pitch),
  playClip: (clip: AudioClip | null | undefined, volume = 1, pitch = 1) => engine.playClip(clip, volume, pitch),
  setIntensity: (v: number) => engine.setIntensity(v),
  duck: (on: boolean) => engine.duckMusic(on),
  /** Mutes or unmutes the soundtrack; effects keep playing. */
  setMusicMuted: (on: boolean) => { engine.musicMuted = on; },
  createLoop: (clip: AudioClip) => engine.createLoop(clip),
  make,
  sinP, sawP, sqrP, triP, glide, env,
  RATE,
  /** One-second seamless engine drone (integer cycles of every partial). */
  engineClip() {
    const rng = new SysRandom(3);
    let lp = 0;
    return make("engine", 1, (t) => {
      lp += (rng.nextDouble() * 2 - 1 - lp) * 0.1;
      return (sawP(55 * t) * 0.35 + sqrP(110 * t) * 0.12 + sinP(220 * t) * 0.1 + lp * 0.15) * 0.5;
    }, false);
  },
  get effectsVolume() { return engine.effectsVolume; },
  set effectsVolume(v: number) { engine.effectsVolume = v; },
};
