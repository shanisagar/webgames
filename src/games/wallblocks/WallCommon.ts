import {
  ArcadeButton, Art, AudioClip, CasualArt, CasualFx, Color, Ease, GameObject, Mathf, Pal, Screen, Sfx, SpriteRenderer, SysRandom,
  Text, TextAnchor, Time, UIKit, UINode, V2, V3, WallBoard, currentClient,
} from "../../kit";

/**
 * Shared pieces for LiDAR wall (activation) games: ball impact markers, the virtual player's thrown balls, a giant
 * HUD banner for 3-2-1 / GO / TIME, venue sounds (whistle, air horn, ball thump, crowd), the title screen's mode bar
 * and today's top-5 board, and an activity clock for the attract loop. Copied per game folder (games never import
 * each other); `prefix` keeps sprite and clip cache keys apart.
 */

export const ModeNames = ["SOLO", "VS COMPUTER", "2 PLAYERS"];
export const DiffNames = ["EASY", "MEDIUM", "HARD"];
export const AttractAfter = 40;

/** The client's name for BRAND targets (event portals), else the game's own word. */
export function brandWord(fallback: string) { return (currentClient()?.name ?? fallback).toUpperCase(); }

/** Normal random number (Box–Muller). */
export function gauss(rng: () => number) {
  const u = Math.max(1e-6, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function setText(t: Text | null | undefined, s: string) { if (t && t.text !== s) t.text = s; }

// ------------------------------------------------------------------ sprites

export const WallArt = {
  /** Paint splat left by a ball (blobby disc with droplets). */
  Splat(prefix: string) {
    return CasualArt.make(prefix + "-splat", 128, 128, (p) => {
      const a = Math.atan2(p.y, p.x), r = p.magnitude;
      const edge = 0.56 + 0.1 * Math.sin(a * 5 + 0.7) + 0.06 * Math.sin(a * 11 + 2.1) + 0.04 * Math.sin(a * 17);
      let d = r - edge;
      for (let i = 0; i < 6; i++) {
        const da = i * 1.07 + 0.4, dr = 0.78 + (i % 3) * 0.06;
        d = Math.min(d, CasualArt.sdCircle(p, new V2(Math.cos(da) * dr, Math.sin(da) * dr), 0.07 + (i % 2) * 0.03));
      }
      return new Color(1, 1, 1, CasualArt.fill(d, 2 / 128));
    });
  },
  /** Fat cross shown where a throw was wasted. */
  Cross(prefix: string) {
    return CasualArt.make(prefix + "-cross", 96, 96, (p) => {
      const d = Math.min(CasualArt.sdSegment(p, new V2(-0.6, -0.6), new V2(0.6, 0.6)), CasualArt.sdSegment(p, new V2(-0.6, 0.6), new V2(0.6, -0.6))) - 0.17;
      const o = d - 0.1;
      const inner = CasualArt.fill(d, 2 / 96), outer = CasualArt.fill(o, 2 / 96);
      const c = Color.lerp(new Color(0.1, 0.05, 0.1, 1), Color.white, inner);
      return c.withAlpha(outer);
    });
  },
  /** Thick impact ring. */
  Ring(prefix: string) {
    return CasualArt.make(prefix + "-ring", 128, 128, (p) => new Color(1, 1, 1, CasualArt.fill(Math.abs(p.magnitude - 0.8) - 0.11, 2 / 128)));
  },
  /** Soft round shadow. */
  get Shadow() { return CasualArt.Soft; },
};

// ------------------------------------------------------------------ impact markers

interface Mark { ring: SpriteRenderer; splat: SpriteRenderer; cross: SpriteRenderer; t: number; color: Color; wasted: boolean; size: number; pos: V2 }

/** Every ball shows a marker at the exact spot it landed (ring + splash), hit or miss, so throwers learn their aim. */
export class Impacts {
  private marks: Mark[] = [];
  private cursor = 0;
  constructor(parent: GameObject, private fx: CasualFx, prefix: string, order = 90, count = 24) {
    for (let i = 0; i < count; i++) {
      const splat = Art.spr(parent, "Splat", WallArt.Splat(prefix), Color.white, 1, order, Art.Flat);
      const ring = Art.spr(parent, "Ring", WallArt.Ring(prefix), Color.white, 1, order + 1, Art.Flat);
      const cross = Art.spr(parent, "Cross", WallArt.Cross(prefix), Color.white, 1, order + 2, Art.Flat);
      for (const s of [splat, ring, cross]) s.gameObject.setActive(false);
      this.marks.push({ ring, splat, cross, t: 99, color: Color.white, wasted: false, size: 1, pos: V2.zero });
    }
  }

  /** A ball landed at p. wasted: show a cross (missed / not allowed). */
  hit(p: V2, color: Color, wasted: boolean, size = 1) {
    const m = this.marks[this.cursor];
    this.cursor = (this.cursor + 1) % this.marks.length;
    Object.assign(m, { t: 0, color, wasted, size, pos: p });
    for (const s of [m.ring, m.splat]) { s.gameObject.setActive(true); s.transform.localPosition = new V3(p.x, p.y, 0); }
    m.cross.gameObject.setActive(wasted);
    m.cross.transform.localPosition = new V3(p.x, p.y, 0);
    m.splat.transform.localEulerZ = Math.random() * 360;
    const n = wasted ? 8 : 14;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (wasted ? 3 : 5.5) * size * (0.4 + Math.random() * 0.6);
      this.fx.emit(p, V2.fromAngle(a, s), Color.lerp(color, Color.white, Math.random() * 0.4), 0.22 * size * (0.6 + Math.random() * 0.6), 0.35 + Math.random() * 0.25, null, 6, 0, true, 3);
    }
    this.update(0);
  }

  clear() { for (const m of this.marks) { m.t = 99; for (const s of [m.ring, m.splat, m.cross]) s.gameObject.setActive(false); } }

  update(dt: number) {
    for (const m of this.marks) {
      if (m.t > 50) continue;
      m.t += dt;
      const life = m.wasted ? 1.3 : 1.0;
      if (m.t >= life) { m.t = 99; for (const s of [m.ring, m.splat, m.cross]) s.gameObject.setActive(false); continue; }
      const k = m.t / life;
      const rk = Mathf.clamp01(m.t / 0.4);
      const rs = Mathf.lerp(0.5, 2.3, Ease.outCubic(rk)) * m.size;
      m.ring.transform.localScale = new V3(rs, rs, 1);
      m.ring.color = Color.lerp(Color.white, m.color, rk * 0.6).withAlpha((1 - rk) * 0.95);
      const ss = (m.t < 0.08 ? Mathf.lerp(0.3, 1.25, m.t / 0.08) : Mathf.lerp(1.25, 1.05, Mathf.clamp01((m.t - 0.08) / 0.2))) * m.size * 1.1;
      m.splat.transform.localScale = new V3(ss, ss, 1);
      m.splat.color = (m.wasted ? new Color(0.85, 0.85, 0.9, 1) : m.color).withAlpha(0.8 * (1 - (k * k * k)));
      if (m.wasted) {
        const cs = (m.t < 0.12 ? Mathf.lerp(1.8, 0.9, m.t / 0.12) : 0.9) * m.size;
        m.cross.transform.localScale = new V3(cs, cs, 1);
        m.cross.color = new Color(1, 0.35, 0.4, 1 - (k * k * k));
      }
    }
  }
}

// ------------------------------------------------------------------ the virtual player's balls

interface Flight { ball: SpriteRenderer; shadow: SpriteRenderer; from: V2; to: V2; t: number; dur: number; on: boolean; land: ((p: V2) => void) | null; arc: number }

/** The computer's throws are drawn: a ball flies in from the crowd (off-screen bottom) and lands on the wall. */
export class Throws {
  private flights: Flight[] = [];
  constructor(private parent: GameObject, _prefix: string, private order = 95) {}

  private get(color: Color) {
    let f = this.flights.find((x) => !x.on);
    if (!f) {
      f = {
        ball: Art.spr(this.parent, "Ball", CasualArt.ball(Color.white, 96), Color.white, 1, this.order + 1, Art.Flat),
        shadow: Art.spr(this.parent, "BallShadow", WallArt.Shadow, new Color(0, 0, 0, 0.3), 1, this.order, Art.Flat),
        from: V2.zero, to: V2.zero, t: 0, dur: 1, on: false, land: null, arc: 0,
      };
      this.flights.push(f);
    }
    f.ball.color = Color.lerp(color, Color.white, 0.15);
    return f;
  }

  /** Throws a ball from `from` (usually below the screen) to `to`; calls land(to) on impact. */
  throwAt(from: V2, to: V2, color: Color, dur: number, land: (p: V2) => void) {
    const f = this.get(color);
    Object.assign(f, { from, to, t: 0, dur, on: true, land, arc: 2 + Math.random() * 1.5 });
    f.ball.gameObject.setActive(true);
    f.shadow.gameObject.setActive(true);
    this.place(f);
  }

  get busy() { return this.flights.some((f) => f.on); }

  clear() { for (const f of this.flights) { f.on = false; f.ball.gameObject.setActive(false); f.shadow.gameObject.setActive(false); } }

  update(dt: number) {
    for (const f of this.flights) {
      if (!f.on) continue;
      f.t += dt;
      if (f.t >= f.dur) {
        f.on = false;
        f.ball.gameObject.setActive(false);
        f.shadow.gameObject.setActive(false);
        f.land?.(f.to);
        continue;
      }
      this.place(f);
    }
  }

  private place(f: Flight) {
    const k = Mathf.clamp01(f.t / f.dur);
    const e = 1 - (1 - k) * (1 - k) * 0.6 - 0.4 * (1 - k);
    const p = V2.lerp(f.from, f.to, e).add(new V2(0, Math.sin(k * Math.PI) * f.arc));
    // coming at the wall: big near the crowd, ball-sized when it lands
    const s = Mathf.lerp(3.2, 0.75, Ease.outCubic(k));
    f.ball.transform.localPosition = new V3(p.x, p.y, 0);
    f.ball.transform.localScale = new V3(s, s, 1);
    f.ball.transform.localEulerZ = k * 720;
    const sp = V2.lerp(f.to.add(new V2(0.6, -0.9)), f.to.add(new V2(0.15, -0.2)), k);
    f.shadow.transform.localPosition = new V3(sp.x, sp.y, 0);
    const ss = Mathf.lerp(0.4, 1.1, k);
    f.shadow.transform.localScale = new V3(ss, ss * 0.8, 1);
    f.shadow.color = new Color(0, 0, 0, 0.35 * k);
  }
}

// ------------------------------------------------------------------ giant banner (3-2-1, GO!, TIME!)

export class BigBanner {
  private text: Text;
  private sub: Text;
  private t = 99; private dur = 1; private color = Color.white;
  constructor(hud: UINode) {
    this.text = UIKit.at(UIKit.label(hud, "", 300, Color.white), UIKit.Center, new V2(0, 40), new V2(1800, 340));
    UIKit.glow(this.text, Color.black.withAlpha(0.55), 10);
    this.sub = UIKit.at(UIKit.label(hud, "", 70, Color.white), UIKit.Center, new V2(0, -170), new V2(1800, 100));
    UIKit.glow(this.sub, Color.black.withAlpha(0.6), 5);
    this.text.raycastTarget = false;
    this.hide();
  }
  show(text: string, color: Color, dur = 0.9, sub = "") {
    this.text.text = text;
    this.text.fontSize = text.length > 6 ? 210 : 300;
    this.sub.text = sub;
    this.color = color;
    this.t = 0; this.dur = dur;
    this.text.gameObject.setActive(true);
    this.sub.gameObject.setActive(sub.length > 0);
    this.update(0);
  }
  hide() { this.t = 99; this.text.gameObject.setActive(false); this.sub.gameObject.setActive(false); }
  get showing() { return this.t < this.dur; }
  update(dt: number) {
    if (this.t >= 50) return;
    this.t += dt;
    if (this.t >= this.dur) { this.hide(); return; }
    const k = this.t / this.dur;
    const s = this.t < 0.18 ? Mathf.lerp(2.2, 0.95, Ease.outBack(this.t / 0.18)) : Mathf.lerp(0.95, 1.05, k);
    this.text.rectTransform.localScale = new V3(s, s, 1);
    const a = k > 0.8 ? (1 - k) / 0.2 : 1;
    this.text.color = Color.lerp(Color.white, this.color, 0.55).withAlpha(a);
    this.sub.color = Color.white.withAlpha(a);
  }
}

// ------------------------------------------------------------------ sounds

function noise(seed: number) { const r = new SysRandom(seed); return () => r.nextDouble() * 2 - 1; }

export interface WallSounds { whistle: AudioClip; horn: AudioClip; thump: AudioClip; beep: AudioClip; go: AudioClip; cheer: AudioClip; miss: AudioClip; tick: AudioClip }

export function makeWallSounds(prefix: string): WallSounds {
  const whistle = Sfx.make(prefix + "-whistle", 0.75, (t) => {
    const trill = 0.55 + 0.45 * Math.sign(Math.sin(t * 2 * Math.PI * 28));
    const f = 2650 + 120 * Math.sin(t * 2 * Math.PI * 28);
    return (Sfx.sinP(f * t) * 0.5 + Sfx.sinP(f * 2 * t) * 0.08) * trill * Sfx.env(t, 0.01, 0.72) * 0.5;
  });
  const horn = Sfx.make(prefix + "-horn", 1.3, (t) => {
    const a = Math.min(1, t * 25) * (t > 1.05 ? Math.max(0, 1 - (t - 1.05) / 0.25) : 1);
    let v = 0;
    for (const f of [233, 294, 349]) v += Sfx.sawP(f * t * (1 + 0.004 * Math.sin(t * 31))) * 0.18 + Sfx.sqrP(f * 0.5 * t) * 0.05;
    return v * a * 0.75;
  });
  const n1 = noise(5);
  const thump = Sfx.make(prefix + "-thump", 0.28, (t) => (Sfx.sinP(Sfx.glide(t, 170, 55, 0.2)) * 0.8 + n1() * 0.5 * Sfx.env(t, 0.0005, 0.04)) * Sfx.env(t, 0.002, 0.26) * 0.8);
  const beep = Sfx.make(prefix + "-beep", 0.22, (t) => (Sfx.sqrP(880 * t) * 0.25 + Sfx.sinP(880 * t) * 0.3) * Sfx.env(t, 0.004, 0.2) * 0.6);
  const go = Sfx.make(prefix + "-go", 0.5, (t) => (Sfx.sqrP(1320 * t) * 0.22 + Sfx.sinP(1320 * t) * 0.3 + Sfx.sinP(660 * t) * 0.2) * Sfx.env(t, 0.004, 0.48) * 0.65);
  const n2 = noise(7);
  let lp = 0, bp = 0;
  const voices = [310, 362, 415, 455, 520, 280, 390];
  const cheer = Sfx.make(prefix + "-cheer", 2.0, (t) => {
    const raw = n2();
    lp += (raw - lp) * 0.32; bp += (lp - bp) * 0.06;
    let v = 0;
    for (let i = 0; i < voices.length; i++) {
      const tt = t - i * 0.06;
      if (tt <= 0) continue;
      const f = voices[i] * (1 + 0.25 * Math.min(1, tt * 2.5)) * (1 + 0.02 * Math.sin(tt * 30 + i));
      v += (Sfx.sawP(f * tt) * 0.5 + Sfx.sinP(f * 2 * tt) * 0.3) * Sfx.env(tt, 0.08, 1.3) * 0.05;
    }
    const clap = (Math.sin(t * 47) > 0.96 || Math.sin(t * 61 + 1) > 0.97) ? n2() * 0.25 : 0;
    const swell = Math.min(1, t * 3) * Math.max(0, 1 - (t - 0.7) / 1.3);
    return ((lp - bp) * 0.7 + v + clap) * swell;
  });
  const miss = Sfx.make(prefix + "-miss", 0.3, (t) => (Sfx.triP(Sfx.glide(t, 330, 160, 0.25)) * 0.4) * Sfx.env(t, 0.005, 0.28) * 0.6);
  const tick = Sfx.make(prefix + "-tick", 0.06, (t) => Sfx.sqrP(2200 * t) * Sfx.env(t, 0.001, 0.05) * 0.25);
  return { whistle, horn, thump, beep, go, cheer, miss, tick };
}

// ------------------------------------------------------------------ title: mode bar + today's board

/** SOLO / VS COMPUTER / 2 PLAYERS and the computer's level, on the title screen's extra row. */
export class ModeBar {
  private buttons: ArcadeButton[] = [];
  private diffButton: ArcadeButton;
  private note: Text;
  constructor(extra: UINode, private colors: Color[], private get: () => [number, number], private set: (mode: number, diff: number) => void, private notes: string[]) {
    for (let i = 0; i < 3; i++) {
      const idx = i;
      this.buttons.push(UIKit.buttonAt(extra, ModeNames[i], UIKit.Center, new V2((i - 1) * 330, 0), new V2(310, 96), false, () => { const [, d] = this.get(); this.set(idx, d); this.refresh(); }, 32));
    }
    this.diffButton = UIKit.buttonAt(extra, "MEDIUM", UIKit.Center, new V2(-150, -108), new V2(300, 80), false, () => { const [m, d] = this.get(); this.set(m, (d + 1) % 3); this.refresh(); }, 28);
    this.note = UIKit.at(UIKit.label(extra, "", 28, new Color(1, 1, 1, 0.85), TextAnchor.MiddleLeft), UIKit.Center, new V2(200, -108), new V2(420, 80));
    this.refresh();
  }
  refresh() {
    const [m, d] = this.get();
    this.buttons.forEach((b, i) => b.setAccent(i === m ? this.colors[i] : new Color(1, 1, 1, 0.4)));
    setText(this.diffButton.label, m === 1 ? "CPU: " + DiffNames[d] : m === 0 ? "SOLO" : "P1 VS P2");
    this.diffButton.setAccent(m === 1 ? this.colors[1] : new Color(1, 1, 1, 0.35));
    this.diffButton.interactable = m === 1;
    setText(this.note, this.notes[m] ?? "");
  }
}

/** Today's top scores on this machine (WallBoard), shown beside the title (landscape) or under it (portrait). */
export class TodayBoard {
  readonly node: UINode;
  private rows: { rank: Text; label: Text; score: Text }[] = [];
  private empty: Text;
  constructor(parent: UINode, accent: Color, private game: string, private fmt: (score: number) => string = (s) => String(s)) {
    this.node = UIKit.node("TodayBoard", parent);
    UIKit.img(this.node, "Bg", Art.UiRound, new Color(0.04, 0.03, 0.1, 0.92)).rectTransform.stretch();
    UIKit.img(this.node, "Edge", Art.UiOutline, accent.withAlpha(0.6)).rectTransform.stretch();
    const head = UIKit.at(UIKit.label(this.node, "TODAY'S TOP 5", 38, Pal.Warn), new V2(0.5, 1), new V2(0, -44), new V2(380, 50));
    UIKit.glow(head, Color.black.withAlpha(0.5), 3);
    for (let i = 0; i < 5; i++) {
      const y = -110 - i * 66;
      this.rows.push({
        rank: UIKit.at(UIKit.label(this.node, `${i + 1}`, 38, Color.white, TextAnchor.MiddleLeft), new V2(0, 1), new V2(52, y), new V2(60, 60)),
        label: UIKit.at(UIKit.label(this.node, "", 30, new Color(1, 1, 1, 0.8), TextAnchor.MiddleLeft), new V2(0, 1), new V2(150, y), new V2(150, 60)),
        score: UIKit.at(UIKit.label(this.node, "", 40, Color.white, TextAnchor.MiddleRight), new V2(1, 1), new V2(-110, y), new V2(180, 60)),
      });
    }
    this.empty = UIKit.at(UIKit.wrap(UIKit.label(this.node, "NO SCORES YET TODAY.\nBE THE FIRST!", 30, new Color(1, 1, 1, 0.7))), UIKit.Center, new V2(0, -30), new V2(340, 200));
    this.layout();
    this.refresh();
  }
  refresh() {
    const list = WallBoard.list(this.game, 5);
    this.rows.forEach((r, i) => {
      const e = list[i];
      for (const t of [r.rank, r.label, r.score]) t.gameObject.setActive(!!e);
      if (!e) return;
      setText(r.label, e.label);
      setText(r.score, this.fmt(e.score));
      r.rank.color = i === 0 ? Pal.Warn : Color.white;
    });
    this.empty.gameObject.setActive(list.length === 0);
  }
  layout() {
    const aspect = Screen.width / Math.max(1, Screen.height);
    const canvasW = 1080 * Math.max(1, aspect);
    const side = (canvasW - 1000) / 2;
    if (aspect >= 1 && side >= 330) {
      const w = Math.min(420, side - 30);
      this.node.place(UIKit.Center, new V2(500 + side / 2, 20), new V2(w, 470));
      this.node.localScale = new V3(w / 420, w / 420, 1);
      this.node.sizeDelta = new V2(420, 470);
    } else if (aspect < 1) {
      this.node.place(UIKit.Center, new V2(0, -760), new V2(420, 470));
      this.node.localScale = new V3(1.25, 1.25, 1);
    } else {
      // squarish landscape: tuck it into the corner, smaller
      this.node.place(UIKit.Center, new V2(500 + Math.max(160, side / 2), 230), new V2(420, 470));
      this.node.localScale = new V3(0.62, 0.62, 1);
    }
  }
}

/** Seconds since anyone touched, clicked, threw or pressed a key (hits on UI count too). */
export const Activity = {
  last: performance.now(),
  installed: false,
  install() {
    if (Activity.installed) return;
    Activity.installed = true;
    const poke = () => { Activity.last = performance.now(); };
    window.addEventListener("pointerdown", poke, { capture: true });
    window.addEventListener("keydown", poke, { capture: true });
  },
  get idle() { Activity.install(); return (performance.now() - Activity.last) / 1000; },
  poke() { Activity.last = performance.now(); },
};

/** Game time for wall games (tests may slow it down; the game itself always runs at 1). */
export const WallTime = { scale: 1, attractAfter: AttractAfter, get dt() { return Time.deltaTime * WallTime.scale; } };
