import { Save } from "./save";

export type Sound = "click" | "launch" | "exit" | "error" | "hint" | "win" | "lose" | "star" | "appear";

const RATE = 44100;
const MUSIC_RATE = 22050;
const TAU = Math.PI * 2;

const sine = (t: number, f: number) => Math.sin(TAU * f * t);
const frac = (x: number) => x - Math.floor(x);
const square = (t: number, f: number) => (frac(t * f) < 0.5 ? 1 : -1);
const saw = (t: number, f: number) => frac(t * f) * 2 - 1;
const triangle = (t: number, f: number) => Math.abs(frac(t * f) * 4 - 2) - 1;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const outCubic = (t: number) => 1 - (1 - t) ** 3;

function env(t: number, attack: number, decay: number) {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(((-(t - attack) / Math.max(0.0001, decay)) * 4));
}

/**
 * Synthesizes every sound effect and a looping ambient synth track in code (ported from the Unity Sfx.cs):
 * no audio files to download.
 */
class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private clips = new Map<Sound, AudioBuffer>();
  private music: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private lastLaunch = 0;
  private launchCombo = 0;

  /** Browsers only allow audio after a user gesture: call this from the first tap/click. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.build();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    this.applySettings();
  }

  /** Pause everything while the tab is hidden. */
  setSuspended(hidden: boolean) {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  applySettings() {
    if (!this.ctx || !this.master) return;
    if (Save.music) {
      if (!this.music) {
        const buffer = this.buildMusic();
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0;
        this.musicGain.connect(this.master);
        this.music = this.ctx.createBufferSource();
        this.music.buffer = buffer;
        this.music.loop = true;
        this.music.connect(this.musicGain);
        this.music.start();
      }
      const g = this.musicGain!.gain;
      g.cancelScheduledValues(this.ctx.currentTime);
      g.setValueAtTime(g.value, this.ctx.currentTime);
      g.linearRampToValueAtTime(0.32, this.ctx.currentTime + 1.5);
    } else if (this.music) {
      this.music.stop();
      this.music.disconnect();
      this.music = null;
    }
  }

  play(sound: Sound, volume = 1, pitch = 1) {
    if (!this.ctx || !this.master || !Save.sound) return;
    const clip = this.clips.get(sound);
    if (!clip) return;

    // Consecutive quick launches climb in pitch for a satisfying combo feel.
    if (sound === "launch") {
      const now = performance.now() / 1000;
      this.launchCombo = now - this.lastLaunch < 0.8 ? Math.min(this.launchCombo + 1, 12) : 0;
      this.lastLaunch = now;
      pitch *= 1 + this.launchCombo * 0.045;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = clip;
    src.playbackRate.value = pitch;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.master);
    src.start();
  }

  // ------------------------------------------------------------------ synthesis

  private make(seconds: number, fn: (t: number) => number): AudioBuffer {
    const n = Math.ceil(seconds * RATE);
    const buffer = this.ctx!.createBuffer(1, n, RATE);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const fadeOut = Math.min(1, (n - i) / (RATE * 0.01));
      data[i] = Math.max(-1, Math.min(1, fn(i / RATE) * fadeOut));
    }
    return buffer;
  }

  private build() {
    const c = this.clips;
    c.set("click", this.make(0.06, (t) => sine(t, 1400) * env(t, 0.002, 0.05) * 0.35));
    c.set("launch", this.make(0.22, (t) => {
      const f = lerp(380, 1500, outCubic(t / 0.22));
      return (sine((t * f) / 1000, 1000) * 0.7 + square(t, f * 0.5) * 0.12) * env(t, 0.003, 0.2) * 0.4;
    }));
    c.set("exit", this.makeNoise(0.4));
    c.set("error", this.make(0.4, (t) => {
      const f = lerp(190, 80, t / 0.4);
      const trem = 0.6 + 0.4 * Math.sin(t * TAU * 28);
      return (saw(t, f) * 0.5 + square(t, f * 1.01) * 0.3) * trem * env(t, 0.004, 0.38) * 0.4;
    }));
    c.set("hint", this.make(0.7, (t) => {
      let v = 0;
      [1318.5, 1760, 2637, 3520].forEach((f, n) => { const st = n * 0.07; if (t > st) v += sine(t - st, f) * env(t - st, 0.005, 0.45); });
      return v * 0.18;
    }));
    c.set("win", this.make(1.3, (t) => {
      let v = 0;
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, n) => {
        const st = n * 0.09;
        if (t > st) { const lt = t - st; v += (triangle(lt, f) * 0.6 + sine(lt, f * 2) * 0.2) * env(lt, 0.005, 0.9); }
      });
      return v * 0.22;
    }));
    c.set("lose", this.make(1.0, (t) => {
      let v = 0;
      [392, 329.6, 261.6, 196].forEach((f, n) => { const st = n * 0.16; if (t > st) v += saw(t - st, f) * env(t - st, 0.01, 0.5); });
      return v * 0.16;
    }));
    c.set("star", this.make(0.5, (t) => (sine(t, 1760) + sine(t, 2637) * 0.5) * env(t, 0.002, 0.45) * 0.25));
    c.set("appear", this.make(0.5, (t) => {
      const f = lerp(200, 600, t / 0.5);
      return sine((t * f) / 400, 400) * env(t, 0.1, 0.4) * 0.12;
    }));
  }

  /** One-pole low-pass sweeping down over white noise: a whoosh. */
  private makeNoise(seconds: number): AudioBuffer {
    const n = Math.ceil(seconds * RATE);
    const buffer = this.ctx!.createBuffer(1, n, RATE);
    const data = buffer.getChannelData(0);
    let lp = 0, seed = 7;
    for (let i = 0; i < n; i++) {
      const k = i / RATE / seconds;
      const cutoff = lerp(0.5, 0.03, k);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      lp += ((seed / 4294967296) * 2 - 1 - lp) * cutoff;
      const e = Math.sin(Math.PI * Math.min(1, k * 1.3)) * (1 - k);
      data[i] = lp * e * 0.55;
    }
    return buffer;
  }

  /** 16-second seamless ambient synthwave loop: pad chords, soft bass pulse, arpeggio, hats. */
  private buildMusic(): AudioBuffer {
    const bar = 4, bars = 4;
    const n = MUSIC_RATE * bar * bars;
    const buffer = this.ctx!.createBuffer(1, n, MUSIC_RATE);
    const data = buffer.getChannelData(0);
    // Am - F - C - G
    const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [130.81, 196, 261.63, 329.63], [196, 246.94, 293.66]];
    const bass = [55, 43.65, 65.41, 49];
    let lp = 0, hp = 0, seed = 3;
    for (let i = 0; i < n; i++) {
      const t = i / MUSIC_RATE;
      const ci = Math.min(Math.floor(t / bar), bars - 1);
      const lt = t - ci * bar;
      const edge = Math.min(1, lt / 0.6) * Math.min(1, (bar - lt) / 0.6);

      let pad = 0;
      for (const f of chords[ci]) pad += sine(t, f) * 0.5 + sine(t, f * 1.005) * 0.35 + sine(t, f * 2.002) * 0.08;
      pad *= edge * (0.75 + 0.25 * Math.sin(t * 0.8));

      const beat = t % 0.25;
      const b = sine(t, bass[ci]) * Math.exp(-beat * 9) * edge;

      const step = t % 0.125;
      const idx = Math.floor(t / 0.125) % chords[ci].length;
      const arp = triangle(t, chords[ci][idx] * 2) * Math.exp(-step * 30) * edge;

      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = (seed / 4294967296) * 2 - 1;
      hp = noise - lp;
      lp += (noise - lp) * 0.2;
      const hat = hp * Math.exp(-((t + 0.125) % 0.25) * 60);

      data[i] = Math.max(-1, Math.min(1, pad * 0.07 + b * 0.28 + arp * 0.05 + hat * 0.05));
    }
    return buffer;
  }
}

export const Sfx = new SfxEngine();

export function haptic(strong = false) {
  if (!Save.haptics || !strong) return;
  try { navigator.vibrate?.(40); } catch { /* not supported */ }
}
