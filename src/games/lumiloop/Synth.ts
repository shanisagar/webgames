import { AudioClip, Behaviour, LoopSource, Mathf, Sfx, SysRandom, Time } from "../../kit";
import { Save } from "./Core";

export enum Cue { Click, Spark, Loop, HunterDown, Hurt, Cut, Warn, Nova, Bounce, GameOver, NewBest, Start, Heartbeat, Whiff, Surge, Tick }

const MusicRate = 22050;
const MusicVolume = 0.42;
const TwoPi = Math.PI * 2;

// synthesis helpers (phase is in cycles) — the kit's, which are the same functions as Synth.cs
const SinP = Sfx.sinP, SawP = Sfx.sawP, SqrP = Sfx.sqrP, TriP = Sfx.triP, Glide = Sfx.glide, Env = Sfx.env;
/** Synth.Make: 44.1 kHz mono with a 10 ms fade-out (Sfx.make does exactly this). */
const Make = (name: string, seconds: number, fn: (t: number) => number) => Sfx.make("lumiloop-" + name, seconds, fn);

/**
 * Procedural audio (Synth.cs). Every effect and the two-layer adaptive soundtrack are synthesized at startup, so the
 * game needs no audio assets. The "drive" layer (drums + arpeggio) fades in as a run heats up. Clips play through the
 * kit's Web Audio output (Sfx.playClip / Sfx.createLoop); the kit's own generic soundtrack is muted meanwhile.
 */
export class Synth extends Behaviour {
  static Instance: Synth | null = null;

  private readonly clips = new Map<Cue, AudioClip>();
  private readonly lastPlayed = new Map<Cue, number>();
  private calm: LoopSource | null = null;
  private drive: LoopSource | null = null;
  private intensity = 0;
  private targetIntensity = 0;
  private duck = 1;
  private targetDuck = 1;
  private musicFade = 0;
  private musicBuilt = false;
  private startFrame = 0;

  /** Scales every effect; the title screen's attract mode plays quieter. */
  EffectsVolume = 1;

  awake() {
    Synth.Instance = this;
    Sfx.setMusicMuted(true);
    Sfx.effectsVolume = 1;
    this.startFrame = Time.frameCount;
    this.BuildEffects();
  }

  onDestroy() {
    if (Synth.Instance === this) Synth.Instance = null;
    Sfx.setMusicMuted(false);
  }

  update() {
    // ~17 s of audio: synthesize a couple of frames after boot so the first frame isn't held up
    if (!this.musicBuilt && Time.frameCount > this.startFrame + 2) {
      this.musicBuilt = true;
      this.StartMusic(BuildMusic());
    }

    const dt = Time.unscaledDeltaTime;
    this.intensity = Mathf.moveTowards(this.intensity, this.targetIntensity, dt * 0.35);
    this.duck = Mathf.moveTowards(this.duck, this.targetDuck, dt * 1.5);
    this.musicFade = Mathf.moveTowards(this.musicFade, Save.Music ? 1 : 0, dt * 0.8);
    const master = MusicVolume * this.duck * this.musicFade;
    if (this.calm) this.calm.volume = master;
    if (this.drive) this.drive.volume = master * this.intensity;
  }

  private StartMusic(layers: [Float32Array, Float32Array]) {
    // same length + started together = layers stay locked together
    this.calm = Sfx.createLoop(new AudioClip("lumiloop-calm", layers[0], MusicRate));
    this.drive = Sfx.createLoop(new AudioClip("lumiloop-drive", layers[1], MusicRate));
  }

  // ------------------------------------------------------------------ public API

  static Play(cue: Cue, volume = 1, pitch = 1) {
    const s = Synth.Instance;
    if (!s || !Save.Sound) return;
    const now = Time.unscaledTime;
    const last = s.lastPlayed.get(cue);
    if (last !== undefined && now - last < 0.035) return;
    s.lastPlayed.set(cue, now);
    const clip = s.clips.get(cue);
    if (!clip) return;
    Sfx.playClip(clip, volume * s.EffectsVolume, pitch);
  }

  /** 0 = calm pad only, 1 = full drums and arpeggio. */
  static SetIntensity(value: number) { if (Synth.Instance) Synth.Instance.targetIntensity = Mathf.clamp01(value); }

  /** Lowers the soundtrack behind menus. */
  static Duck(on: boolean) { if (Synth.Instance) Synth.Instance.targetDuck = on ? 0.45 : 1; }

  // ------------------------------------------------------------------ effects

  private BuildEffects() {
    const rng = new SysRandom(5);
    const Noise = () => rng.nextDouble() * 2 - 1;
    const clips = this.clips;

    clips.set(Cue.Click, Make("click", 0.06, (t) => SinP(1250 * t) * Env(t, 0.002, 0.04) * 0.3));
    clips.set(Cue.Tick, Make("tick", 0.04, (t) => SinP(2200 * t) * Env(t, 0.001, 0.02) * 0.18));

    clips.set(Cue.Spark, Make("spark", 0.16, (t) =>
      SinP(Glide(t, 1500, 2600, 0.12)) * Env(t, 0.002, 0.1) * 0.22 +
      SinP(3200 * t) * Env(t, 0.001, 0.05) * 0.08));

    clips.set(Cue.Loop, Make("loop", 0.9, (t) => {
      const f = 523.25; // C5 bell, pitched per combo step at play time
      const bell = SinP(f * t) + 0.5 * SinP(2 * f * t) + 0.25 * SinP(3.01 * f * t) + 0.15 * SinP(4.2 * f * t);
      return bell * Env(t, 0.003, 0.7) * 0.2 + SinP(5.4 * f * t) * Env(t, 0.001, 0.2) * 0.05;
    }));

    clips.set(Cue.HunterDown, Make("hunter-down", 0.45, (t) =>
      SinP(Glide(t, 160, 40, 0.3)) * Env(t, 0.002, 0.3) * 0.5 +
      Noise() * Env(t, 0.001, 0.12) * 0.25 +
      SinP(1318.5 * t) * Env(t, 0.01, 0.3) * 0.08));

    clips.set(Cue.Hurt, Make("hurt", 0.5, (t) =>
      (SawP(Glide(t, 300, 80, 0.45)) * 0.5 + SqrP(Glide(t, 151, 41, 0.45)) * 0.3) * Env(t, 0.003, 0.4) * 0.35 +
      Noise() * Env(t, 0.001, 0.08) * 0.3));

    let cutLp = 0;
    clips.set(Cue.Cut, Make("cut", 0.18, (t) => {
      const n = Noise();
      cutLp += (n - cutLp) * 0.3;
      return (n - cutLp) * Env(t, 0.001, 0.05) * 0.45 + SinP(Glide(t, 2600, 1200, 0.15)) * Env(t, 0.001, 0.12) * 0.15;
    }));

    clips.set(Cue.Warn, Make("warn", 0.32, (t) => {
      const f = t < 0.16 ? 660 : 880;
      return SinP(f * t) * Env(Mathf.repeat(t, 0.16), 0.005, 0.12) * 0.1;
    }));

    let novaLp = 0;
    clips.set(Cue.Nova, Make("nova", 1.3, (t) => {
      const k = t / 1.3;
      novaLp += (Noise() - novaLp) * Mathf.lerp(0.05, 0.4, Math.sin(k * Math.PI));
      const whoosh = novaLp * Math.sin(Math.PI * Mathf.clamp01(k * 1.4)) * 0.5;
      const chord = (TriP(523.25 * t) + TriP(659.25 * t) + TriP(783.99 * t) + TriP(1046.5 * t)) * Env(t, 0.02, 1) * 0.08;
      const sub = SinP(Glide(t, 90, 38, 0.8)) * Env(t, 0.005, 0.8) * 0.45;
      return whoosh + chord + sub;
    }));

    clips.set(Cue.Bounce, Make("bounce", 0.07, (t) => SinP(420 * t) * Env(t, 0.001, 0.05) * 0.18));

    clips.set(Cue.GameOver, Make("game-over", 1.6, (t) => {
      const notes = [659.25, 523.25, 440, 329.63];
      let v = 0;
      for (let i = 0; i < notes.length; i++) {
        const st = t - i * 0.2;
        if (st > 0) v += (TriP(notes[i] * st) * 0.7 + SinP(notes[i] * 0.5 * st) * 0.4) * Env(st, 0.01, 0.9);
      }
      return v * 0.15;
    }));

    clips.set(Cue.NewBest, Make("new-best", 1.4, (t) => {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
      let v = 0;
      for (let i = 0; i < notes.length; i++) {
        const st = t - i * 0.08;
        if (st > 0) v += (SinP(notes[i] * st) + 0.35 * SinP(notes[i] * 2.01 * st)) * Env(st, 0.004, 0.8);
      }
      return v * 0.12;
    }));

    clips.set(Cue.Start, Make("start", 0.6, (t) =>
      (SinP(Glide(t, 220, 880, 0.45)) * 0.7 + TriP(Glide(t, 440, 1760, 0.45)) * 0.2) * Env(t, 0.01, 0.5) * 0.22));

    clips.set(Cue.Heartbeat, Make("heartbeat", 0.45, (t) => {
      let v = 0;
      for (let i = 0; i < 2; i++) {
        const st = t - i * 0.16;
        if (st > 0) v += SinP(Glide(st, 90, 45, 0.12)) * Env(st, 0.003, 0.12) * (i === 0 ? 1 : 0.7);
      }
      return v * 0.5;
    }));

    let whiffLp = 0;
    clips.set(Cue.Whiff, Make("whiff", 0.25, (t) => {
      whiffLp += (Noise() - whiffLp) * 0.08;
      return whiffLp * Math.sin((Math.PI * t) / 0.25) * 0.35;
    }));

    clips.set(Cue.Surge, Make("surge", 1, (t) => {
      const f = Math.trunc(t / 0.25) % 2 === 0 ? 440 : 330;
      const st = Mathf.repeat(t, 0.25);
      return (SqrP(f * t) * 0.5 + SinP(f * 0.5 * t)) * Env(st, 0.005, 0.2) * 0.09;
    }));
  }
}

// ------------------------------------------------------------------ music (pure math)

function BuildMusic(): [Float32Array, Float32Array] {
  const bpm = 112;
  const beat = 60 / bpm;
  const barLen = beat * 4;
  const bars = 8;
  const n = Math.trunc(barLen * bars * MusicRate);
  const calm = new Float32Array(n);
  const drive = new Float32Array(n);

  // E minor: Em - C - G - D, two bars each.
  const chords = [
    [164.81, 196, 246.94, 329.63],
    [130.81, 164.81, 196, 261.63],
    [196, 246.94, 293.66, 392],
    [146.83, 185, 220, 293.66],
  ];
  const bass = [82.41, 65.41, 98, 73.42];
  const arpPattern = [0, 2, 1, 3, 2, 0, 3, 1];

  const rng = new SysRandom(11);
  let hatLp = 0, clapLp = 0;
  const chordLen = barLen * 2;

  for (let i = 0; i < n; i++) {
    const t = i / MusicRate;
    const ci = Math.min(Math.trunc(t / chordLen), chords.length - 1);
    const chordT = t - ci * chordLen;
    const edge = Mathf.clamp01(chordT / 0.25) * Mathf.clamp01((chordLen - chordT) / 0.4);
    const beatT = t % beat;
    const beatIndex = Math.trunc(t / beat);
    const chord = chords[ci];

    // --- calm layer: pad, sub bass, soft bell on quarter notes
    let pad = 0;
    for (const f of chord) pad += SinP(f * t) * 0.5 + SinP(f * 1.004 * t) * 0.4 + SinP(f * 0.5 * t) * 0.2;
    pad *= edge * (0.8 + 0.2 * Math.sin(TwoPi * t * 0.25));

    const sub = SinP(bass[ci] * t) * (0.6 + 0.4 * Math.exp(-beatT * 3)) * edge;

    const bellF = chord[beatIndex % 4] * 2;
    const bell = (SinP(bellF * t) + 0.3 * SinP(bellF * 2.01 * t)) * Math.exp(-beatT * 5) * edge;

    calm[i] = Mathf.clamp(pad * 0.045 + sub * 0.22 + bell * 0.05, -1, 1);

    // --- drive layer: kick, clap, hats, 16th arpeggio
    const kick = Math.sin(TwoPi * (45 * beatT + (110 * (1 - Math.exp(-beatT * 25))) / 25)) * Math.exp(-beatT * 7);

    const noise = rng.nextDouble() * 2 - 1;
    const hp = noise - hatLp;
    hatLp += (noise - hatLp) * 0.25;
    const offT = (t + beat * 0.5) % beat;
    const hat = hp * Math.exp(-offT * 45);

    clapLp += (noise - clapLp) * 0.35;
    const inBar = beatIndex % 4;
    const clap = inBar === 1 || inBar === 3 ? clapLp * Math.exp(-beatT * 16) : 0;

    const s16 = beat / 4;
    const step = Math.trunc(t / s16);
    const stepT = t % s16;
    const arpF = chord[arpPattern[step % arpPattern.length]] * 2;
    const arp = TriP(arpF * t) * Math.exp(-stepT * 20);

    drive[i] = Mathf.clamp(kick * 0.34 + hat * 0.06 + clap * 0.1 + arp * 0.05, -1, 1);
  }
  return [calm, drive];
}
