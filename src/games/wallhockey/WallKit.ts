import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, currentClient, Ease, GameObject, Keyboard, Mathf,
  Mouse, Pal, Phase, Random, Result, Sfx, Snd, SpriteRenderer, Text, TextAnchor, Time, Touchscreen, UI, UIKit, UINode,
  V2, V3, WallBoard, WallHit, WallHits,
} from "../../kit";

/**
 * Shared LiDAR-wall layer for this game (activation mode): ball impact markers, drawn computer throws, venue sounds
 * (whistle, horn, crowd), the event leaderboard panel, the attract loop, the 3-2-1 countdown / TIME! calls and the
 * operator keys. Kept inside the game folder (games do not import from each other).
 */

const KEY = "wh";
export const Gold = Pal.hex(0xffc93c), Ink = Pal.hex(0x070814), Red = Pal.hex(0xff4a5a), White = Pal.hex(0xf4f7ff);
export const ModeNames = ["SOLO", "VS COMPUTER", "2 PLAYERS"];
export const DiffNames = ["EASY", "MEDIUM", "HARD"];
const AttractAfter = 40;

/** Client brand word for "BRAND" spots (the portal's client name), else the game's own word. */
export function brandWord(fallback: string) {
  const n = currentClient()?.name?.trim();
  return n ? n.toUpperCase().slice(0, 18) : fallback;
}

/** Client accent colour (portal theme) or the game's accent. */
export function brandColor(accent: Color) {
  const hex = currentClient()?.theme?.accent;
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? Pal.hex(parseInt(hex.slice(1), 16)) : accent;
}

// ------------------------------------------------------------------ sprites

const splatSprite = () => CasualArt.make(KEY + "-splat", 96, 96, (p) => {
  const a = Math.atan2(p.y, p.x), r = p.magnitude;
  const edge = 0.62 + 0.13 * Math.sin(a * 7 + 1.3) + 0.08 * Math.sin(a * 11 + 0.4);
  let al = CasualArt.fill(r - edge, 2 / 96);
  for (let k = 0; k < 6; k++) {
    const ka = k * 1.047 + 0.4, d = 0.84 + 0.06 * (k % 2);
    al = Math.max(al, CasualArt.fill(Math.hypot(p.x - Math.cos(ka) * d, p.y - Math.sin(ka) * d) - 0.09, 2 / 96));
  }
  return new Color(1, 1, 1, al * (0.75 + 0.25 * CasualArt.smooth(0.7, 0, r)));
});
const ringSprite = () => CasualArt.make(KEY + "-ring", 128, 128, (p) => new Color(1, 1, 1, CasualArt.fill(Math.abs(p.magnitude - 0.86) - 0.08, 2 / 128)));
/** Soft foam throwing ball (the venue's balls) for drawn computer throws. */
export const foamBall = (col: Color, key: string) => CasualArt.make(KEY + "-foam-" + key, 96, 96, (p) => {
  let c = CasualArt.ballPixel(p, col, 2 / 96, 0.92);
  if (c.a <= 0) return c;
  const seam = Math.abs(Math.sin(p.x * 2.2 + 0.4) * 0.5 - p.y) - 0.035;
  c = Color.lerp(c, CasualArt.lighten(col, 0.55), CasualArt.fill(seam, 2 / 96) * 0.6);
  return c;
});

// ------------------------------------------------------------------ impact markers

interface Mark { ring: SpriteRenderer; splat: SpriteRenderer; dot: SpriteRenderer; t: number; strong: boolean; col: Color; size: number }

/** Every ball shows where it landed: an expanding ring, a splash and a fading print. */
export class ImpactMarks {
  private pool: Mark[] = [];
  private i = 0;
  private fx: CasualFx;
  constructor(parent: GameObject, order = 70) {
    for (let k = 0; k < 24; k++) {
      const splat = Art.spr(parent, "Splat", splatSprite(), Color.clear, 1, order, Art.Flat);
      const dot = Art.spr(parent, "Print", Art.Disc, Color.clear, 1, order + 1, Art.Flat);
      const ring = Art.spr(parent, "Ring", ringSprite(), Color.clear, 1, order + 2, Art.Flat);
      this.pool.push({ ring, splat, dot, t: 9, strong: false, col: Color.white, size: 1 });
    }
    this.fx = CasualFx.create(parent, order + 3, 160);
  }
  /** size: world units of the ball print (about a ball's diameter). */
  mark(p: V2, col: Color, strong = false, size = 1.1) {
    const m = this.pool[this.i];
    this.i = (this.i + 1) % this.pool.length;
    m.t = 0; m.strong = strong; m.col = col; m.size = size;
    for (const s of [m.ring, m.splat, m.dot]) { s.transform.localPosition = new V3(p.x, p.y, 0); s.transform.localEulerZ = Random.range(0, 360); }
    this.fx.pop(p, Color.lerp(col, Color.white, 0.35), strong ? 16 : 9, strong ? 9 : 6, size * 0.22, 0.45);
    this.place(m);
  }
  update(dt: number) { for (const m of this.pool) if (m.t < 2) { m.t += dt; this.place(m); } }
  clear() { for (const m of this.pool) { m.t = 9; this.place(m); } this.fx.clear(); }
  private place(m: Mark) {
    const t = m.t, s = m.size;
    const rk = Mathf.clamp01(t / 0.55);
    m.ring.transform.localScale = new V3(s * Mathf.lerp(0.6, m.strong ? 3.6 : 2.6, Ease.outCubic(rk)), s * Mathf.lerp(0.6, m.strong ? 3.6 : 2.6, Ease.outCubic(rk)), 1);
    m.ring.color = (t < 0.55 ? Color.lerp(Color.white, m.col, rk) : m.col).withAlpha(t < 0.55 ? (1 - rk) * 0.95 : 0);
    const sk = Mathf.clamp01(t / 0.12);
    const ss = s * (0.6 + 1.0 * Ease.outBack(sk));
    m.splat.transform.localScale = new V3(ss * 1.25, ss * 1.25, 1);
    m.splat.color = m.col.withAlpha(t < 1.2 ? 0.85 * (1 - Mathf.clamp01((t - 0.5) / 0.7)) : 0);
    m.dot.transform.localScale = new V3(s * 0.55, s * 0.55, 1);
    m.dot.color = Color.white.withAlpha(t < 0.9 ? 0.9 * (1 - t / 0.9) : 0);
  }
}

// ------------------------------------------------------------------ drawn computer throws

interface Flight { sr: SpriteRenderer; shadow: SpriteRenderer; from: V2; to: V2; t: number; dur: number; arc: number; land: ((p: V2) => void) | null; spin: number; size: number }

/**
 * A virtual player's ball: it flies in from off-screen (from the thrower in front of the wall, so it starts big and
 * shrinks as it travels away) and lands at its target, where the game shows the same marker as a real ball.
 */
export class DrawnThrows {
  private pool: Flight[] = [];
  constructor(private parent: GameObject, private order = 80) {}
  throwAt(from: V2, to: V2, col: Color, colKey: string, dur: number, land: (p: V2) => void, size = 1.1) {
    let f = this.pool.find((x) => !x.sr.gameObject.activeSelf);
    if (!f) {
      const shadow = Art.spr(this.parent, "ThrowShadow", Art.Glow, new Color(0, 0, 0, 0.35), 1, this.order - 1, Art.Flat);
      const sr = Art.spr(this.parent, "Throw", foamBall(col, colKey), Color.white, 1, this.order, Art.Flat);
      f = { sr, shadow, from, to, t: 0, dur, arc: 0, land: null, spin: 0, size };
      this.pool.push(f);
    }
    f.sr.sprite = foamBall(col, colKey);
    Object.assign(f, { from, to, t: 0, dur, arc: Random.range(1.5, 3), land, spin: Random.range(-700, 700), size });
    f.sr.gameObject.setActive(true);
    f.shadow.gameObject.setActive(true);
    this.place(f);
  }
  update(dt: number) {
    for (const f of this.pool) {
      if (!f.sr.gameObject.activeSelf) continue;
      f.t += dt;
      if (f.t >= f.dur) {
        f.sr.gameObject.setActive(false); f.shadow.gameObject.setActive(false);
        const cb = f.land; f.land = null; cb?.(f.to);
        continue;
      }
      this.place(f);
    }
  }
  clear() { for (const f of this.pool) { f.land = null; f.sr.gameObject.setActive(false); f.shadow.gameObject.setActive(false); } }
  get busy() { return this.pool.some((f) => f.sr.gameObject.activeSelf); }
  private place(f: Flight) {
    const k = Mathf.clamp01(f.t / f.dur);
    const p = V2.lerp(f.from, f.to, k).add(new V2(0, f.arc * 4 * k * (1 - k)));
    const s = f.size * Mathf.lerp(3.4, 1, Math.pow(k, 0.7));
    f.sr.transform.localPosition = new V3(p.x, p.y, 0);
    f.sr.transform.localScale = new V3(s, s, 1);
    f.sr.transform.localEulerZ = f.spin * f.t;
    const sp = V2.lerp(f.from, f.to, k);
    f.shadow.transform.localPosition = new V3(sp.x + 0.3, sp.y - 0.4, 0);
    f.shadow.transform.localScale = new V3(s * 1.3, s * 1.3, 1);
    f.shadow.color = new Color(0, 0, 0, 0.3 * k);
  }
}

// ------------------------------------------------------------------ venue sounds

const noiseAt = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };

export class WallSounds {
  whistle!: AudioClip; whistleLong!: AudioClip; horn!: AudioClip; thud!: AudioClip; cheer!: AudioClip; groan!: AudioClip; count!: AudioClip;
  build() {
    const R = 44100;
    const trill = (t: number) => 1 + 0.35 * Math.sin(t * Math.PI * 2 * 28);
    this.whistle = Sfx.make(KEY + "-whistle", 0.55, (t) => (Sfx.sinP(2900 * t + 0.0009 * Math.sin(t * 176)) * 0.6 + Sfx.sinP(5800 * t) * 0.12 + noiseAt(Math.trunc(t * R)) * 0.08) * trill(t) * Sfx.env(t, 0.01, 0.6) * Mathf.clamp01((0.55 - t) / 0.06) * 0.5);
    this.whistleLong = Sfx.make(KEY + "-whistle3", 1.5, (t) => {
      const seg = t < 0.28 ? t : t < 0.56 ? t - 0.3 : t - 0.6;
      const on = t < 0.26 || (t > 0.3 && t < 0.54) || t > 0.6 ? 1 : 0;
      return (Sfx.sinP(2850 * t) * 0.6 + Sfx.sinP(5700 * t) * 0.1 + noiseAt(Math.trunc(t * R)) * 0.08) * trill(t) * on * Mathf.clamp01(seg / 0.01) * Mathf.clamp01((1.5 - t) / 0.2) * 0.5;
    });
    this.horn = Sfx.make(KEY + "-horn", 1.2, (t) => {
      const e = Mathf.clamp01(t / 0.03) * Mathf.clamp01((1.2 - t) / 0.25);
      return (Sfx.sawP(233 * t) * 0.3 + Sfx.sawP(293.7 * t) * 0.25 + Sfx.sawP(349.2 * t) * 0.22 + Sfx.sqrP(116.5 * t) * 0.16) * e * 0.5;
    });
    this.thud = Sfx.make(KEY + "-thud", 0.2, (t) => (Sfx.sinP(Sfx.glide(t, 190, 55, 0.12)) * 0.8 + noiseAt(Math.trunc(t * R) + 9) * 0.6 * Sfx.env(t, 0, 0.02)) * Sfx.env(t, 0.001, 0.08) * 0.75);
    let lp = 0, lp2 = 0;
    this.cheer = Sfx.make(KEY + "-cheer", 2.2, (t) => {
      const n = noiseAt(Math.trunc(t * R) + 333);
      lp += (n - lp) * 0.22; lp2 += (lp - lp2) * 0.5;
      const swell = Mathf.clamp01(t / 0.25) * Math.exp(-Math.max(0, t - 0.5) * 1.7);
      const voices = 0.6 + 0.4 * Math.sin(t * 23) * Math.sin(t * 7.3 + 1) ;
      const whoo = Sfx.sinP(Sfx.glide(t, 520, 900, 0.6)) * 0.08 * Sfx.env(t - 0.05, 0.05, 0.6) + Sfx.sinP(Sfx.glide(t, 640, 1100, 0.7)) * 0.06 * Sfx.env(t - 0.15, 0.05, 0.6);
      return (lp2 * 1.4 * voices + whoo) * swell * 0.8;
    });
    let g = 0;
    this.groan = Sfx.make(KEY + "-groan", 1.3, (t) => {
      const n = noiseAt(Math.trunc(t * R) + 777);
      g += (n - g) * 0.08;
      const e = Mathf.clamp01(t / 0.15) * Math.exp(-Math.max(0, t - 0.3) * 2.2);
      return (g * 1.6 + Sfx.sawP(Sfx.glide(t, 210, 120, 1.1)) * 0.12 + Sfx.sawP(Sfx.glide(t, 262, 150, 1.1)) * 0.08) * e * 0.7;
    });
    this.count = Sfx.make(KEY + "-count", 0.3, (t) => (Sfx.sqrP(660 * t) * 0.3 + Sfx.sinP(1320 * t) * 0.4) * Sfx.env(t, 0.004, 0.18) * 0.5);
  }
}

// ------------------------------------------------------------------ big countdown / calls

/** Huge centred call for the wall: 3-2-1, GO!, TIME!, SAVE!... (readable from the back of the crowd). */
export class BigCall {
  private node: UINode; private text: Text; private t = 9; private dur = 1;
  constructor(parent: UINode) {
    this.node = UIKit.node("BigCall", parent).place(UIKit.Center, new V2(0, 40), new V2(1600, 420));
    this.text = UIKit.label(this.node, "", 300, Color.white);
    this.text.rectTransform.stretch();
    this.text.raycastTarget = false;
    UIKit.glow(this.text, Ink, 8);
    this.node.setActive(false);
  }
  show(s: string, col: Color, dur = 0.9, size = 300) {
    this.text.text = s; this.text.color = col; this.text.fontSize = size;
    this.t = 0; this.dur = dur; this.node.setActive(true);
  }
  hide() { this.t = 9; this.node.setActive(false); }
  update() {
    if (!this.node.activeSelf) return;
    this.t += Time.unscaledDeltaTime;
    if (this.t >= this.dur) { this.node.setActive(false); return; }
    const k = this.t / this.dur;
    const s = Mathf.lerp(1.7, 1, Ease.outBack(Mathf.clamp01(this.t / 0.28)));
    this.node.localScale = new V3(s, s, 1);
    this.text.color = this.text.color.withAlpha(k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1);
  }
}

// ------------------------------------------------------------------ event leaderboard panel

export class BoardPanel {
  private node: UINode; private rows: { rank: Text; label: Text; score: Text; bg: UINode }[] = []; private empty: Text;
  constructor(parent: UINode, private game: string, accent: Color, private fmt: (n: number) => string) {
    this.node = UIKit.node("TodayBoard", parent).place(new V2(1, 0.5), new V2(-240, -20), new V2(400, 560));
    UIKit.img(this.node, "Bg", Art.UiRound, new Color(0.03, 0.03, 0.09, 0.86)).rectTransform.stretch();
    UIKit.img(this.node, "Edge", Art.UiOutline, accent.withAlpha(0.6)).rectTransform.stretch();
    UIKit.at(UIKit.label(this.node, "TODAY'S TOP 5", 38, Gold), new V2(0.5, 1), new V2(0, -52), new V2(380, 60));
    for (let i = 0; i < 5; i++) {
      const y = -130 - i * 84;
      const bg = UIKit.node("Row", this.node).place(new V2(0.5, 1), new V2(0, y), new V2(360, 72));
      UIKit.img(bg, "Bg", Art.UiRound, new Color(1, 1, 1, i === 0 ? 0.14 : 0.06)).rectTransform.stretch();
      const rank = UIKit.at(UIKit.label(bg, String(i + 1), 40, i === 0 ? Gold : White), new V2(0, 0.5), new V2(38, 0), new V2(60, 60));
      const label = UIKit.at(UIKit.label(bg, "", 30, Pal.TextDim, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(150, 0), new V2(150, 50));
      const score = UIKit.at(UIKit.label(bg, "", 42, White, TextAnchor.MiddleRight), new V2(1, 0.5), new V2(-80, 0), new V2(150, 60));
      this.rows.push({ rank, label, score, bg });
    }
    this.empty = UIKit.at(UIKit.wrap(UIKit.label(this.node, "NO SCORES YET TODAY.\nBE THE FIRST!", 32, Pal.TextDim)), UIKit.Center, new V2(0, -30), new V2(340, 200));
  }
  refresh() {
    const list = WallBoard.list(this.game, 5);
    this.empty.gameObject.setActive(list.length === 0);
    for (let i = 0; i < 5; i++) {
      const r = this.rows[i], e = list[i];
      r.bg.setActive(!!e);
      if (!e) continue;
      r.label.text = e.label;
      r.score.text = this.fmt(e.score);
    }
  }
  /** Side panel on wide screens, under the menu on tall ones, hidden when there is no room. Returns whether shown. */
  layout(w: number, h: number) {
    const side = (w - 1000) / 2 - 40;
    if (side >= 300) {
      const pw = Math.min(400, side), s = pw / 400;
      this.node.place(new V2(1, 0.5), new V2(-((w - 1000) / 4), -20), new V2(400, 560));
      this.node.localScale = new V3(s, s, 1);
      this.node.setActive(true);
      return true;
    }
    if (h >= 1650) {
      this.node.place(new V2(0.5, 0.5), new V2(0, -500 - Math.min(380, (h - 1080) / 2) + 40), new V2(400, 560));
      this.node.localScale = new V3(1.15, 1.15, 1);
      this.node.setActive(true);
      return true;
    }
    this.node.setActive(false);
    return false;
  }
}

// ------------------------------------------------------------------ result sticker

export class RankSticker {
  private node: UINode | null = null; private text!: Text; private t = 9;
  constructor() {
    const c = UI.root?.find("Safe/Result/Center");
    if (!c) return;
    this.node = UIKit.node("RankSticker", c).place(UIKit.Center, new V2(370, 330), new V2(270, 120));
    UIKit.img(this.node, "Glow", Art.Glow, Gold.withAlpha(0.35)).rectTransform.stretch(-60);
    UIKit.img(this.node, "Bg", Art.UiRound, Gold).rectTransform.stretch();
    UIKit.img(this.node, "Edge", Art.UiOutline, Color.white.withAlpha(0.8)).rectTransform.stretch();
    this.text = UIKit.label(this.node, "", 46, Ink);
    this.text.rectTransform.stretch(6);
    this.node.localEulerAngles = new V3(0, 0, -8);
    this.node.setActive(false);
  }
  show(rank: number) {
    if (!this.node) return;
    this.node.setActive(rank > 0);
    if (rank <= 0) return;
    this.text.text = `#${rank} TODAY`;
    this.t = -0.45;
  }
  update() {
    if (!this.node || !this.node.activeSelf) return;
    this.t += Time.unscaledDeltaTime;
    const k = Mathf.clamp01(this.t / 0.35);
    const s = this.t < 0 ? 0 : Ease.outBack(k) * (1 + 0.04 * Math.sin(this.t * 5));
    this.node.localScale = new V3(s, s, 1);
  }
}

// ------------------------------------------------------------------ the wall game base

export enum RoundStep { Idle, Count, Play, End }

/**
 * Base for a wall game: title options (mode + computer level), today's board, operator keys (Space/Enter start,
 * Escape pause, R title), the 3-2-1 countdown, the TIME! call, the attract loop (computer vs computer demo behind
 * "THROW A BALL TO PLAY" after 40 s without a hit) and the "#N TODAY" result sticker.
 */
export abstract class WallGame extends ArcadeGame {
  protected mode = 1;
  protected diff = 1;
  /** The attract demo is running (state stays Title). */
  protected demo = false;
  protected step = RoundStep.Idle;
  protected stepT = 0;
  protected marks!: ImpactMarks;
  protected throws!: DrawnThrows;
  protected snd = new WallSounds();
  protected call!: BigCall;
  protected boardPanel!: BoardPanel;
  private sticker!: RankSticker;
  private banner!: UINode; private bannerText!: Text; private bannerSub!: Text;
  private modeBtn!: ArcadeButton; private diffBtn!: ArcadeButton; private modeText!: Text;
  private idleRef = 0;
  private countShown = 0;
  private gen = 0;
  private boardShown = true;
  private dimmer!: SpriteRenderer;

  protected abstract get GameId(): string;
  /** Short line per mode for the title screen. */
  protected abstract ModeLine(mode: number, diff: number): string;
  protected abstract FormatScore(n: number): string;
  /** Reset the world for a round (this.mode / this.diff / this.demo are set). */
  protected abstract SetupRound(): void;
  /** One frame of a round; hits are this frame's balls (empty in the countdown and the demo). */
  protected abstract TickRound(dt: number, hits: WallHit[], live: boolean): void;
  /** Ambient motion behind the title and result screens. */
  protected abstract TickIdle(dt: number): void;
  /** Builds the result once TIME! has been called; score/label go to today's board (label null = not recorded). */
  protected abstract RoundResult(): { result: Result; score: number; label: string | null };
  /** Countdown length (seconds) before a round. */
  protected get CountSeconds() { return 3; }
  /** Show a marker for balls that land outside play (countdown, TIME!). Off for floor-tracking games. */
  protected get MarkStrayHits() { return true; }

  // ------------------------------------------------------------------ build

  protected WallBuild(fx: GameObject) {
    this.marks = new ImpactMarks(fx, 70);
    this.dimmer = Art.spr(fx, "ResultDim", Art.Square, new Color(0.01, 0.01, 0.04, 0), 400, 400, Art.Flat);
    this.throws = new DrawnThrows(fx, 80);
    this.snd.build();
    this.call = new BigCall(this.UI.Hud);
    this.sticker = new RankSticker();
    this.mode = Mathf.clamp(this.Data.get("mode", 1), 0, 2);
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    const ex = this.UI.TitleExtra;
    this.modeBtn = UIKit.buttonAt(ex, "MODE", UIKit.Center, new V2(-255, 12), new V2(490, 104), false, () => this.Cycle("mode", 3), 34);
    this.diffBtn = UIKit.buttonAt(ex, "COMPUTER", UIKit.Center, new V2(255, 12), new V2(490, 104), false, () => this.Cycle("diff", 3), 34);
    this.modeBtn.setAccent(this.Info.Accent);
    this.diffBtn.setAccent(this.Info.Accent2);
    this.modeText = UIKit.at(UIKit.label(ex, "", 27, new Color(1, 1, 1, 0.9)), UIKit.Center, new V2(0, -70), new V2(1000, 40));
    CasualLook.titleCard(this.UI, new Color(0.02, 0.02, 0.08, 0.78), new V2(1120, 1060), -8);
    const titleLayer = ex.parent!.parent!;
    this.boardPanel = new BoardPanel(titleLayer, this.GameId, this.Info.Accent, (n) => this.FormatScore(n));
    this.banner = UIKit.node("Attract", this.UI.Hud).place(UIKit.Center, new V2(0, 60), new V2(1300, 230));
    UIKit.img(this.banner, "Bg", Art.UiRound, new Color(0.02, 0.02, 0.07, 0.82)).rectTransform.stretch();
    UIKit.img(this.banner, "Edge", Art.UiOutline, Gold.withAlpha(0.8)).rectTransform.stretch();
    this.bannerText = UIKit.at(UIKit.label(this.banner, "THROW A BALL TO PLAY", 92, Gold), UIKit.Center, new V2(0, 22), new V2(1280, 120));
    UIKit.glow(this.bannerText, Ink, 5);
    this.bannerSub = UIKit.at(UIKit.label(this.banner, "", 34, White), UIKit.Center, new V2(0, -64), new V2(1200, 50));
    this.banner.setActive(false);
  }

  private Cycle(key: string, n: number) {
    this.Data.set(key, (this.Data.get(key, key === "mode" ? 1 : 1) + 1) % n);
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
  }

  protected RefreshTitle() {
    this.mode = Mathf.clamp(this.Data.get("mode", 1), 0, 2);
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    if (this.modeBtn.label) this.modeBtn.label.text = "MODE: " + ModeNames[this.mode];
    if (this.diffBtn.label) this.diffBtn.label.text = this.mode === 1 ? "COMPUTER: " + DiffNames[this.diff] : "COMPUTER: —";
    this.diffBtn.interactable = this.mode === 1;
    this.modeText.text = this.ModeLine(this.mode, this.diff);
    this.boardPanel.refresh();
    this.LayoutWall();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  /** Board placement for the current canvas; also feeds the title stats line when the panel has no room. */
  protected LayoutWall() {
    const r = this.UI.Hud.rect;
    this.boardShown = this.boardPanel.layout(r.width, r.height);
  }

  protected StatsLine() {
    if (this.boardShown) return this.ExtraStats();
    const list = WallBoard.list(this.GameId, 3);
    return list.length ? "TODAY: " + list.map((e, i) => `${i + 1}. ${this.FormatScore(e.score)} ${e.label}`).join("   ") : this.ExtraStats();
  }
  protected ExtraStats() { return ""; }

  // ------------------------------------------------------------------ state flow

  protected OnEnterTitle() {
    this.gen++;
    this.demo = false;
    this.step = RoundStep.Idle;
    this.banner.setActive(false);
    this.call.hide();
    this.throws.clear();
    this.idleRef = performance.now() / 1000;
    this.UI.SetPauseButton(true);
    this.OnTitle();
    this.RefreshTitle();
  }
  /** Reset the world for the title screen. */
  protected OnTitle() {}

  protected BeginRun() {
    this.gen++;
    this.demo = false;
    this.mode = Mathf.clamp(this.Data.get("mode", 1), 0, 2);
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.Data.add("rounds", 1);
    this.banner.setActive(false);
    this.UI.SetPauseButton(false);
    this.throws.clear();
    this.marks.clear();
    this.SetupRound();
    this.StartCountdown();
  }

  private StartCountdown() {
    this.step = RoundStep.Count;
    this.stepT = this.CountSeconds;
    this.countShown = 0;
    WallHits.clear();
  }

  private StartAttract() {
    if (this.State === Phase.Over) this.EnterTitle();
    this.demo = true;
    this.gen++;
    this.UI.ShowHud();
    this.UI.SetPauseButton(false);
    this.banner.setActive(true);
    const top = WallBoard.list(this.GameId, 1)[0];
    this.bannerSub.text = top ? `TODAY'S BEST: ${this.FormatScore(top.score)} (${top.label})   ·   BEAT IT!` : "BE TODAY'S FIRST HIGH SCORE!";
    this.mode = 1;
    this.throws.clear();
    this.marks.clear();
    this.SetupRound();
    this.StartCountdown();
  }

  private StopAttract() {
    this.demo = false;
    this.EnterTitle();
  }

  /** Call when the round's clock runs out: TIME! then the result (or the next demo). */
  protected EndRound(call = "TIME!") {
    if (this.step === RoundStep.End) return;
    this.step = RoundStep.End;
    this.stepT = 0;
    this.call.show(call, Gold, 1.6, 280);
    Sfx.playClip(this.snd.whistleLong, 0.9);
    Sfx.playClip(this.snd.horn, 0.55);
    this.startCoroutine(this.AfterEnd(this.gen));
  }

  private *AfterEnd(gen: number): Generator<{ seconds: number; realtime: boolean } | undefined, void, unknown> {
    yield { seconds: 2.2, realtime: true };
    if (gen !== this.gen) return;
    if (this.demo) { this.throws.clear(); this.SetupRound(); this.StartCountdown(); return; }
    if (this.State !== Phase.Playing) return;
    const r = this.RoundResult();
    const rank = r.label ? WallBoard.add(this.GameId, r.score, r.label) : 0;
    if (rank > 0) r.result.BestLine = (r.result.BestLine ? r.result.BestLine + "   ·   " : "") + `#${rank} TODAY`;
    this.Finish(r.result);
    this.sticker.show(rank);
    this.idleRef = performance.now() / 1000;
  }

  // ------------------------------------------------------------------ frame

  update() {
    if (this.demo && (Keyboard.anyKeyPressed || Keyboard.space.wasPressedThisFrame || Keyboard.enter.wasPressedThisFrame || Keyboard.escape.wasPressedThisFrame)) this.StopAttract();
    else if (Keyboard.letter("r").wasPressedThisFrame && (this.State !== Phase.Title)) this.EnterTitle();
    super.update();
    this.call.update();
    const dimTo = this.State === Phase.Over ? 0.5 : 0;
    this.dimmer.color = this.dimmer.color.withAlpha(Mathf.moveTowards(this.dimmer.color.a, dimTo, Time.unscaledDeltaTime * 1.5));
    this.sticker.update();
    if (this.banner.activeSelf) {
      const s = 1 + 0.035 * Math.sin(Time.unscaledTime * 4);
      this.banner.localScale = new V3(s, s, 1);
      this.bannerText.color = Color.lerp(Gold, Color.white, 0.5 + 0.5 * Math.sin(Time.unscaledTime * 6));
    }
  }

  /** Balls received per wall half this session (test hook). */
  readonly hitCount = [0, 0];

  protected TickRun(dt: number) {
    const hits = WallHits.take();
    for (const h of hits) this.hitCount[h.side]++;
    this.TickSteps(dt, hits);
    this.marks.update(dt);
    this.throws.update(dt);
  }

  protected TickBackground(dt: number) {
    const hits = WallHits.take();
    const poked = hits.length > 0 || Keyboard.anyKeyPressed || Mouse.leftButton.wasPressedThisFrame || Touchscreen.touches.some((t) => t.press.wasPressedThisFrame);
    if (poked) this.idleRef = performance.now() / 1000;
    if (this.demo) {
      if (hits.length > 0 || Mouse.leftButton.wasPressedThisFrame) { if (this.MarkStrayHits) for (const h of hits) this.marks.mark(h.world, White, true); this.StopAttract(); return; }
      this.TickSteps(dt, []);
    } else {
      this.TickIdle(dt);
      const idle = Math.min(WallHits.idleSeconds, performance.now() / 1000 - this.idleRef);
      if (idle > AttractAfter && !this.UI.ModalOpen) this.StartAttract();
    }
    this.marks.update(dt);
    this.throws.update(dt);
  }

  private TickSteps(dt: number, hits: WallHit[]) {
    switch (this.step) {
      case RoundStep.Count: {
        this.stepT -= dt;
        const n = Math.ceil(this.stepT);
        if (n !== this.countShown && n >= 1 && n <= 3) { this.countShown = n; this.call.show(String(n), White, 0.85, 380); Sfx.playClip(this.snd.count, 0.8); }
        if (this.MarkStrayHits) for (const h of hits) this.marks.mark(h.world, Pal.TextDim, false);
        this.TickRound(dt, [], false);
        if (this.stepT <= 0) {
          this.step = RoundStep.Play;
          this.call.show(this.GoWord, Gold, 0.8, 340);
          Sfx.playClip(this.snd.whistle, 1);
          WallHits.clear();
        }
        break;
      }
      case RoundStep.Play:
        this.TickRound(dt, this.demo ? [] : hits, true);
        break;
      case RoundStep.End:
        this.stepT += dt;
        if (this.MarkStrayHits) for (const h of hits) this.marks.mark(h.world, Pal.TextDim, false);
        this.TickRound(dt, [], false);
        break;
      default: break;
    }
  }
  protected get GoWord() { return "GO!"; }

  /** Test hook: a ball landing at a 0..1 wall position (WallHits.simulate). */
  TestSimulate(u: number, v: number) { WallHits.simulate(u, v); }

  /** Seconds since the attract reference (for tests). */
  get idleSeconds() { return Math.min(WallHits.idleSeconds, performance.now() / 1000 - this.idleRef); }
}
