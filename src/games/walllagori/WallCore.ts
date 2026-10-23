import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, Camera, CasualArt, CasualFx, CasualLook, Color, currentClient, Ease, Fmt,
  GameObject, Image, Keyboard, Mathf, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, Text, TextAnchor, Time, UI, UIKit,
  UINode, V2, V3, WallBoard, WallHits,
} from "../../kit";

/**
 * Shared frame for the LiDAR wall (activation) games: mode picker and today's leaderboard on the title, a 3-2-1
 * countdown, the big round timer, per-player score panels, ball-impact markers for every hit, drawn throws for
 * virtual players, the "TIME!" end, result screens with today's rank, the attract demo after 40 s of no hits and
 * the operator keys (Space/Enter start, Escape pause, R back to title). Each game extends WallGame and implements
 * the world, the targets and the computer player.
 *
 * (Kept per game folder on purpose: games may only add files to their own folders. A candidate for the kit.)
 */

export enum WMode { Solo, Vs, Duo }
export const ModeNames = ["SOLO", "VS COMPUTER", "2 PLAYERS"];
export const DiffNames = ["EASY", "MEDIUM", "HARD"];
export const P1Col = Pal.hex(0x22d8ff), P2Col = Pal.hex(0xff8a1f), SoloCol = Pal.hex(0x3fe0ff);
export const Ink = Pal.hex(0x120a24), Gold = Pal.hex(0xffc93c), Good = Pal.hex(0x5cf29a), Bad = Pal.hex(0xff4a5a);

/** One ball on the wall: a real hit (LiDAR, mouse, touch) or a drawn throw by a virtual player. */
export interface Ball { world: V2; who: number; cpu: boolean; side: 0 | 1 }

export type Step = "idle" | "count" | "play" | "end";

const IdleForDemo = 40;
const CountTime = 3.4;
const FlightTime = 0.55;

class Marker { ring!: SpriteRenderer; splat!: SpriteRenderer; dot!: SpriteRenderer; t = 9; life = 1.3; }
class Flight { sr!: SpriteRenderer; glow!: SpriteRenderer; from = V2.zero; to = V2.zero; t = 0; who = 0; active = false; }
class Panel { node!: UINode; bg!: UINode; name!: Text; value!: Text; sub!: Text; }
class SideCard { node!: UINode; title!: Text; value!: Text; sub!: Text; crown!: Text; edge!: Image; }

function set(t: Text | null | undefined, s: string) { if (t && t.text !== s) t.text = s; }

export abstract class WallGame extends ArcadeGame {
  /** Test hook: scales simulated time (the headless test machine runs at a low frame rate). */
  static TestTimeScale = 1;

  protected mode = WMode.Solo;
  protected diff = 1;
  /** The attract demo (computer vs computer) is running behind the "THROW A BALL TO PLAY" banner. */
  protected demo = false;
  protected step: Step = "idle";
  protected stepT = 0;
  protected timeLeft = 90;
  protected scores = [0, 0];
  protected root!: GameObject;
  protected fx!: CasualFx;
  /** The 16:9 design field (world units) every game lays its targets in; the view may be larger. */
  protected readonly FW = 32;
  protected readonly FH = 18;
  protected portrait = false;

  private wmarkers: Marker[] = [];
  private wflights: Flight[] = [];
  private wcpuT = [1, 1];
  private wcountN = -1;
  private wlastInput = performance.now();
  private wtenWarned = -1;
  private wlastRank = 0;

  // HUD
  private wtop!: UINode;
  private wtimerText!: Text;
  private wtimerNode!: UINode;
  private wpanels: Panel[] = [];
  private wbigText!: Text;
  private wbigT = 0;
  private wbigDur = 1;
  private wbannerNode!: UINode;
  private wbannerText!: Text;
  private wdemoTag!: Text;
  // title
  private wmodeButtons: ArcadeButton[] = [];
  private wdiffButton!: ArcadeButton;
  private wboardNode!: UINode;
  private wboardRows: Text[] = [];
  private wrulesNode!: UINode;
  // result
  private wresultRoot!: UINode;
  private wcards: SideCard[] = [];

  // sounds
  protected whistleClip!: AudioClip;
  protected hornClip!: AudioClip;
  protected thudClip!: AudioClip;
  protected cheerClip!: AudioClip;

  // ------------------------------------------------------------------ hooks for the games

  protected abstract RoundLength(mode: WMode): number;
  /** Background, targets and pools (called once from Build). */
  protected abstract BuildWorld(): void;
  /** Re-fit the world to this.ViewSize (field stays 32 × 18, centred). */
  protected abstract LayoutWorld(): void;
  /** Reset the world for this.mode / this.demo / this.step ("idle" on the title, "count" before a round). */
  protected abstract SetupRound(): void;
  /** Simulate and draw one frame (always called; read this.step and this.demo). */
  protected abstract TickWorld(dt: number): void;
  /** A ball landed during play (a real hit, or a drawn throw of a virtual player). */
  protected abstract OnBall(b: Ball): void;
  /** Virtual player `who` may throw now (use this.CpuReady / this.Throw). */
  protected abstract TickCpu(dt: number, who: number, level: number): void;
  protected abstract SoloStars(score: number): number;
  protected abstract ResultStats(): [string, string][];
  /** Three short lines for the title's "how to throw" card. */
  protected abstract QuickRules(): string[];
  /** Short description of a mode for the title's option button. */
  protected abstract ModeLine(mode: WMode): string;
  /** The word on BRAND targets when no client portal is active. */
  protected BrandWord = "BONUS";
  protected PanelValue(i: number) { return Fmt.n(this.scores[i]); }
  protected PanelSub(_i: number) { return ""; }
  /** Line under the score on a result side card. */
  protected CardSub(i: number) { return this.PanelSub(i); }
  /** Winner of a two-player / vs round (-1 = draw). */
  protected Winner() { return this.scores[0] === this.scores[1] ? -1 : this.scores[0] > this.scores[1] ? 0 : 1; }
  /** What goes on today's leaderboard for player i. */
  protected BoardScore(i: number) { return this.scores[i]; }
  /** "12 – 9" on a two-player result. */
  protected ResultValue() { return `${this.scores[0]} – ${this.scores[1]}`; }
  protected ScoreCaption() { return "SCORE"; }

  // ------------------------------------------------------------------ shared helpers

  protected PlayerColor(who: number) { return this.mode === WMode.Solo ? SoloCol : who === 0 ? P1Col : P2Col; }
  protected PlayerName(who: number) {
    if (this.demo) return who === 0 ? "CPU 1" : "CPU 2";
    if (this.mode === WMode.Solo) return "YOU";
    if (this.mode === WMode.Vs) return who === 0 ? "YOU" : "COMPUTER";
    return who === 0 ? "PLAYER 1" : "PLAYER 2";
  }
  protected IsCpu(who: number) { return this.demo || (this.mode === WMode.Vs && who === 1); }
  protected get Playing() { return this.step === "play"; }
  protected get BrandName() { const n = currentClient()?.name?.trim(); return (n && n.length ? n : this.BrandWord).toUpperCase(); }
  protected get BrandColor() {
    const hex = currentClient()?.theme?.accent;
    return hex && /^#[0-9a-f]{6}$/i.test(hex) ? Pal.hex(parseInt(hex.slice(1), 16)) : this.Info.Accent;
  }
  /** Field rect (world): left, right, bottom, top. */
  protected get FL() { return -this.FW / 2; }
  protected get FR() { return this.FW / 2; }
  protected get FB() { return -this.FH / 2; }
  protected get FT() { return this.FH / 2; }

  protected get ShortSide() {
    const a = Screen.width / Math.max(1, Screen.height);
    return a >= 16 / 9 ? this.FH : a >= 1 ? this.FW / a : this.FW;
  }

  private get wSelMode(): WMode { return Mathf.clamp(this.Data.get("mode"), 0, 2) as WMode; }
  private get wSelDiff() { return Mathf.clamp(this.Data.get("diff", 1), 0, 2); }

  /** Cooldown per virtual player: true when it may throw again (then waits `interval` × 0.8–1.25). */
  protected CpuReady(who: number, dt: number, interval: number) {
    this.wcpuT[who] -= dt;
    if (this.wcpuT[who] > 0) return false;
    this.wcpuT[who] = interval * (0.8 + Math.random() * 0.45);
    return true;
  }
  protected DelayCpu(who: number, s: number) { this.wcpuT[who] = Math.max(this.wcpuT[who], s); }

  /** Where to throw at a target at p moving with vel, with aiming error by level (0..2). */
  protected Aim(p: V2, vel: V2, level: number, spread = 1) {
    const err = [1.5, 0.85, 0.4][Mathf.clamp(level, 0, 2)] * spread;
    const a = Math.random() * Math.PI * 2, r = err * Math.sqrt(Math.random()) * (Math.random() < 0.5 ? 0.6 : 1.2);
    const lead = p.add(vel.mul(FlightTime * (0.85 + level * 0.075)));
    return new V2(Mathf.clamp(lead.x + Math.cos(a) * r, this.FL + 0.8, this.FR - 0.8), Mathf.clamp(lead.y + Math.sin(a) * r, this.FB + 0.8, this.FT - 1.5));
  }

  /** A virtual player's ball flies in from the crowd and lands at `target`. */
  protected Throw(who: number, target: V2) {
    let f = this.wflights.find((x) => !x.active);
    if (!f) {
      f = new Flight();
      f.glow = Art.spr(this.root, "BallGlow", Art.Glow, Color.white, 2, 590, Art.Additive);
      f.sr = Art.spr(this.root, "Ball", CasualArt.ball(Color.white), Color.white, 1, 591, Art.Flat);
      this.wflights.push(f);
    }
    f.active = true;
    f.who = who;
    f.t = 0;
    f.to = target;
    const side = who === 0 ? -1 : 1;
    f.from = new V2(target.x * 0.4 + side * (3 + Math.random() * 5), this.ViewSize.y * -0.5 - 3);
    f.sr.sprite = CasualArt.ball(Color.lerp(this.PlayerColor(who), Color.white, 0.25));
    f.sr.gameObject.setActive(true);
    f.glow.gameObject.setActive(true);
    f.glow.color = this.PlayerColor(who).withAlpha(0.45);
    this.WPlaceFlight(f);
  }

  private WPlaceFlight(f: Flight) {
    const k = Mathf.clamp01(f.t / FlightTime), e = Ease.outCubic(k);
    const p = V2.lerp(f.from, f.to, e).add(new V2(0, Math.sin(k * Math.PI) * 2.6));
    const s = Mathf.lerp(3.2, 0.95, e);
    f.sr.transform.localPosition = new V3(p.x, p.y, 0);
    f.sr.transform.localScale = new V3(s, s, 1);
    f.sr.transform.localEulerZ = k * 540;
    f.glow.transform.localPosition = new V3(p.x, p.y, 0);
    f.glow.transform.localScale = new V3(s * 2, s * 2, 1);
  }

  private WTickFlights(dt: number) {
    for (const f of this.wflights) {
      if (!f.active) continue;
      f.t += dt;
      if (f.t >= FlightTime) {
        f.active = false;
        f.sr.gameObject.setActive(false);
        f.glow.gameObject.setActive(false);
        this.WLand(f.to, f.who, true);
      } else this.WPlaceFlight(f);
    }
  }

  private WClearFlights() { for (const f of this.wflights) { f.active = false; f.sr.gameObject.setActive(false); f.glow.gameObject.setActive(false); } }

  /** Impact marker at a world point (every ball, hit or miss). */
  protected Mark(p: V2, col: Color) {
    let m = this.wmarkers.find((x) => x.t >= x.life) ?? null;
    if (!m) {
      if (this.wmarkers.length >= 24) m = this.wmarkers.reduce((a, b) => (a.t > b.t ? a : b));
      else {
        m = new Marker();
        m.splat = Art.spr(this.root, "Splat", WallArt.Splat(), Color.white, 1.8, 580, Art.Flat);
        m.ring = Art.spr(this.root, "ImpactRing", Art.Ring, Color.white, 1, 582, Art.Flat);
        m.dot = Art.spr(this.root, "ImpactDot", Art.Disc, Color.white, 0.32, 583, Art.Flat);
        this.wmarkers.push(m);
      }
    }
    m.t = 0;
    for (const s of [m.ring, m.splat, m.dot]) { s.gameObject.setActive(true); s.transform.localPosition = new V3(p.x, p.y, 0); s.color = col; }
    m.splat.transform.localEulerZ = Math.random() * 360;
    this.fx.pop(p, Color.lerp(col, Color.white, 0.4), 10, 5, 0.22, 0.45);
    Sfx.playClip(this.thudClip, 0.55, 0.9 + Math.random() * 0.2);
  }

  private WTickMarkers(dt: number) {
    for (const m of this.wmarkers) {
      if (m.t >= m.life) continue;
      m.t += dt;
      if (m.t >= m.life) { for (const s of [m.ring, m.splat, m.dot]) s.gameObject.setActive(false); continue; }
      const k = m.t / m.life, r = Mathf.lerp(0.6, 2.6, Ease.outCubic(Mathf.clamp01(k * 2.2)));
      m.ring.transform.localScale = new V3(r, r, 1);
      m.ring.color = m.ring.color.withAlpha(Mathf.clamp01(1 - k * 1.8));
      const ss = 1.8 * Mathf.lerp(0.5, 1, Ease.outBack(Mathf.clamp01(k * 6)));
      m.splat.transform.localScale = new V3(ss, ss, 1);
      m.splat.color = m.splat.color.withAlpha(0.75 * Mathf.clamp01((1 - k) * 2));
      m.dot.color = Color.white.withAlpha(Mathf.clamp01((1 - k) * 2.5));
    }
  }

  private WLand(p: V2, who: number, cpu: boolean) {
    const side: 0 | 1 = p.x < 0 ? 0 : 1;
    this.Mark(p, this.PlayerColor(who));
    if (this.step === "play") this.OnBall({ world: p, who, cpu, side });
  }

  /** Big centre text (countdown, GO!, TIME!, round banners). */
  protected Big(text: string, color: Color, seconds = 1, size = 220) {
    this.wbigText.text = text;
    this.wbigText.fontSize = size;
    this.wbigText.color = color;
    this.wbigT = 0;
    this.wbigDur = seconds;
    this.wbigText.gameObject.setActive(true);
  }

  /** Crowd cheer (big moments). */
  protected Cheer(vol = 0.6) { Sfx.playClip(this.cheerClip, vol, 0.95 + Math.random() * 0.1); }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Data.set("diff", 1); }
    CasualLook.calm(this, 1.3, 0.12);
    this.root = new GameObject("Wall", this.gameObject);
    this.BuildWorld();
    this.fx = CasualFx.create(this.root, 570, 420);
    this.WBuildSounds();
    this.WBuildHud();
    this.WBuildTitle();
    this.WBuildResult();
    const touch = () => { this.wlastInput = performance.now(); };
    window.addEventListener("pointerdown", touch, { capture: true });
    window.addEventListener("keydown", touch, { capture: true });
    this.WLayout();
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__wall = { game: this, WallHits, WallBoard };
  }

  private WBuildSounds() {
    const rnd = new SysRandom(5);
    const n = () => rnd.nextDouble() * 2 - 1;
    this.whistleClip = Sfx.make("wall-whistle", 0.75, (t) => {
      const trill = 1 + 0.06 * Sfx.sqrP(t * 26);
      const f = (t < 0.18 ? 2350 : 2650) * trill;
      return (Sfx.sinP(f * t) * 0.5 + Sfx.sinP(f * 2 * t) * 0.12 + n() * 0.08) * Sfx.env(t, 0.01, 0.55) * (t < 0.16 || t > 0.22 ? 1 : 0.2);
    });
    this.hornClip = Sfx.make("wall-horn", 1.3, (t) => {
      let v = 0;
      for (const f of [146.8, 185, 220]) v += Sfx.sawP(f * t) * 0.18 + Sfx.sqrP(f * 0.5 * t) * 0.06;
      return v * Sfx.env(t, 0.03, 1.1) * (0.85 + 0.15 * Sfx.sinP(t * 6));
    });
    let lp = 0;
    this.thudClip = Sfx.make("wall-thud", 0.28, (t) => {
      lp += (n() - lp) * 0.25;
      return (Sfx.sinP(Sfx.glide(t, 150, 55, 0.12)) * 0.75 + lp * 0.6) * Sfx.env(t, 0.002, 0.13);
    });
    let a = 0, b = 0;
    const voices = [300, 360, 410, 455, 520, 270, 390, 600];
    this.cheerClip = Sfx.make("wall-cheer", 2.2, (t) => {
      const raw = n();
      a += (raw - a) * 0.3; b += (a - b) * 0.06;
      let v = 0;
      for (let i = 0; i < voices.length; i++) {
        const tt = t - i * 0.05;
        if (tt <= 0) continue;
        const f = voices[i] * (1 + 0.22 * Math.min(1, tt * 2.5)) * (1 + 0.02 * Math.sin(tt * 30 + i));
        v += (Sfx.sawP(f * tt) * 0.5 + Sfx.sinP(f * 2 * tt) * 0.3) * Sfx.env(tt, 0.08, 1.4) * 0.05;
      }
      const clap = (Math.sin(t * 47) > 0.95 || Math.sin(t * 61 + 1) > 0.96) ? n() * 0.3 : 0;
      const swell = Math.min(1, t * 3) * Math.max(0, 1 - (t - 0.8) / 1.4);
      return ((a - b) * 0.8 + v + clap) * swell;
    });
  }

  private WBuildHud() {
    const hud = this.UI.Hud;
    this.wtop = UIKit.node("WallTop", hud).place(new V2(0.5, 1), new V2(0, -100), new V2(1500, 170));
    this.wtimerNode = UIKit.node("Timer", this.wtop).place(UIKit.Center, V2.zero, new V2(330, 150));
    UIKit.img(this.wtimerNode, "Bg", Art.UiRound, Ink.withAlpha(0.72)).rectTransform.stretch();
    UIKit.img(this.wtimerNode, "Edge", Art.UiOutline, Color.white.withAlpha(0.35)).rectTransform.stretch();
    this.wtimerText = UIKit.at(UIKit.label(this.wtimerNode, "1:30", 104, Color.white), UIKit.Center, new V2(0, 0), new V2(330, 140));
    UIKit.glow(this.wtimerText, Ink, 4);
    for (let i = 0; i < 2; i++) {
      const p = new Panel();
      p.node = UIKit.node("Panel" + i, this.wtop).place(UIKit.Center, new V2((i === 0 ? -1 : 1) * 445, 0), new V2(500, 150));
      p.bg = UIKit.img(p.node, "Bg", Art.UiRound, Ink.withAlpha(0.72)).rectTransform.stretch();
      UIKit.img(p.node, "Edge", Art.UiOutline, (i === 0 ? P1Col : P2Col).withAlpha(0.8)).rectTransform.stretch();
      p.name = UIKit.at(UIKit.label(p.node, "", 34, Color.white, i === 0 ? TextAnchor.MiddleLeft : TextAnchor.MiddleRight), UIKit.Center, new V2(i === 0 ? -10 : 10, 40), new V2(440, 44));
      p.value = UIKit.at(UIKit.label(p.node, "0", 92, Color.white, i === 0 ? TextAnchor.MiddleLeft : TextAnchor.MiddleRight), UIKit.Center, new V2(i === 0 ? -10 : 10, -22), new V2(440, 100));
      UIKit.glow(p.value, Ink, 4);
      p.sub = UIKit.at(UIKit.label(p.node, "", 34, Color.white, i === 0 ? TextAnchor.MiddleRight : TextAnchor.MiddleLeft), UIKit.Center, new V2(i === 0 ? 30 : -30, -26), new V2(400, 60));
      this.wpanels.push(p);
    }
    this.wbigText = UIKit.at(UIKit.label(hud, "", 220, Color.white), UIKit.Center, new V2(0, 40), new V2(1800, 320));
    UIKit.glow(this.wbigText, Ink, 7);
    this.wbigText.gameObject.setActive(false);
    this.wbannerNode = UIKit.node("Attract", hud).place(new V2(0.5, 0), new V2(0, 170), new V2(1300, 170));
    UIKit.img(this.wbannerNode, "Bg", Art.UiRound, Ink.withAlpha(0.82)).rectTransform.stretch();
    UIKit.img(this.wbannerNode, "Edge", Art.UiOutline, Gold.withAlpha(0.9)).rectTransform.stretch();
    this.wbannerText = UIKit.at(UIKit.label(this.wbannerNode, "THROW A BALL TO PLAY", 92, Gold), UIKit.Center, new V2(0, 0), new V2(1280, 150));
    UIKit.glow(this.wbannerText, Ink, 4);
    this.wdemoTag = UIKit.at(UIKit.label(hud, "DEMO", 40, Color.white.withAlpha(0.8)), new V2(0.5, 1), new V2(0, -215), new V2(300, 50));
    this.wbannerNode.setActive(false);
    this.wdemoTag.gameObject.setActive(false);
  }

  private WBuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex || !ex.parent) return;
    CasualLook.titleCard(this.UI, new Color(0.06, 0.03, 0.14, 0.62), new V2(1060, 1080), -10);
    for (let i = 0; i < 3; i++) {
      const idx = i;
      this.wmodeButtons.push(UIKit.buttonAt(ex, ModeNames[i], UIKit.Center, new V2((i - 1) * 330, 0), new V2(315, 96), false, () => this.WPickMode(idx), 32));
    }
    this.wdiffButton = UIKit.buttonAt(ex, " ", UIKit.Center, new V2(0, -110), new V2(660, 84), false, () => this.WCycleDiff(), 30);
    // today's top 5 (right) and how to throw (left)
    const c = ex.parent;
    this.wboardNode = UIKit.node("Board", c);
    UIKit.img(this.wboardNode, "Bg", Art.UiRound, new Color(0.06, 0.03, 0.14, 0.78)).rectTransform.stretch();
    UIKit.img(this.wboardNode, "Edge", Art.UiOutline, Gold.withAlpha(0.7)).rectTransform.stretch();
    UIKit.glow(UIKit.at(UIKit.label(this.wboardNode, "TODAY'S TOP 5", 44, Gold), new V2(0.5, 1), new V2(0, -55), new V2(420, 60)), Ink, 3);
    for (let i = 0; i < 5; i++) {
      const t = UIKit.at(UIKit.label(this.wboardNode, "", 40, Color.white, TextAnchor.MiddleLeft), new V2(0.5, 1), new V2(10, -140 - i * 82), new V2(380, 70));
      this.wboardRows.push(t);
    }
    this.wrulesNode = UIKit.node("Rules", c);
    UIKit.img(this.wrulesNode, "Bg", Art.UiRound, new Color(0.06, 0.03, 0.14, 0.78)).rectTransform.stretch();
    UIKit.img(this.wrulesNode, "Edge", Art.UiOutline, this.Info.Accent.withAlpha(0.7)).rectTransform.stretch();
    UIKit.glow(UIKit.at(UIKit.label(this.wrulesNode, "HOW TO PLAY", 44, this.Info.Accent), new V2(0.5, 1), new V2(0, -55), new V2(420, 60)), Ink, 3);
    this.QuickRules().slice(0, 3).forEach((line, i) => {
      const t = UIKit.wrap(UIKit.label(this.wrulesNode, line, 34, Color.white, TextAnchor.UpperLeft));
      UIKit.at(t, new V2(0.5, 1), new V2(0, -185 - i * 135), new V2(370, 130));
    });
    this.WRefreshTitle();
  }

  private WBuildResult() {
    const root = UI.root!;
    this.wresultRoot = UIKit.node("WallResult", root).stretch();
    for (let i = 0; i < 2; i++) {
      const s = new SideCard();
      s.node = UIKit.node("Card" + i, this.wresultRoot);
      UIKit.img(s.node, "Bg", Art.UiRound, new Color(0.06, 0.03, 0.14, 0.85)).rectTransform.stretch();
      s.edge = UIKit.img(s.node, "Edge", Art.UiOutline, Color.white);
      s.edge.rectTransform.stretch();
      s.crown = UIKit.at(UIKit.label(s.node, "", 56, Gold), new V2(0.5, 1), new V2(0, -60), new V2(400, 70));
      UIKit.glow(s.crown, Ink, 3);
      s.title = UIKit.at(UIKit.label(s.node, "", 46, Color.white), new V2(0.5, 1), new V2(0, -135), new V2(400, 60));
      s.value = UIKit.at(UIKit.label(s.node, "", 150, Color.white), new V2(0.5, 0.5), new V2(0, -10), new V2(420, 180));
      UIKit.glow(s.value, Ink, 5);
      s.sub = UIKit.wrap(UIKit.at(UIKit.label(s.node, "", 34, Color.white, TextAnchor.UpperCenter), new V2(0.5, 0), new V2(0, 130), new V2(380, 200)));
      this.wcards.push(s);
    }
    this.wresultRoot.setActive(false);
  }

  // ------------------------------------------------------------------ title

  protected BestLine() {
    const m = this.wSelMode;
    if (m === WMode.Solo) return `SOLO BEST ${Fmt.n(this.Data.get("best"))}`;
    if (m === WMode.Vs) { const d = this.wSelDiff; return `VS COMPUTER ${DiffNames[d]}:  ${this.Data.get("w" + d)} WON · ${this.Data.get("l" + d)} LOST`; }
    return `PLAYER 1  ${this.Data.get("p0")} – ${this.Data.get("p1")}  PLAYER 2`;
  }

  private WPickMode(i: number) {
    this.Data.set("mode", i);
    this.WRefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private WCycleDiff() {
    if (this.wSelMode !== WMode.Vs) return;
    this.Data.set("diff", (this.wSelDiff + 1) % 3);
    this.WRefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private WRefreshTitle() {
    if (!this.wmodeButtons.length) return;
    const m = this.wSelMode;
    const acc = [SoloCol, P2Col, P1Col];
    this.wmodeButtons.forEach((b, i) => b.setAccent(i === m ? acc[i] : new Color(1, 1, 1, 0.45)));
    if (this.wdiffButton.label) this.wdiffButton.label.text = m === WMode.Vs ? `COMPUTER: ${DiffNames[this.wSelDiff]}  (TAP TO CHANGE)` : this.ModeLine(m);
    this.wdiffButton.setAccent(m === WMode.Vs ? P2Col : new Color(1, 1, 1, 0.7));
    const list = WallBoard.list(this.Info.Id, 5);
    this.wboardRows.forEach((t, i) => {
      const e = list[i];
      t.text = e ? `${i + 1}.  ${Fmt.n(e.score)}  <size=28><color=#b9b2d8>${e.label}</color></size>` : `${i + 1}.  ---`;
      t.color = i === 0 && e ? Gold : Color.white;
    });
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.WLayout(); }

  private WLayout() {
    this.portrait = this.ViewSize.x < this.ViewSize.y;
    this.Fx.CameraTarget = V2.zero;
    this.LayoutWorld();
    this.WLayoutUi();
  }

  private WLayoutUi() {
    if (!this.wtop) return;
    const r = this.UI.Hud.rect, w = r.width, h = r.height;
    const s = Math.min(1, (w - 40) / 1500);
    this.wtop.localScale = new V3(s, s, 1);
    const bs = Math.min(1, (w - 40) / 1300);
    this.wbannerNode.localScale = new V3(bs, bs, 1);
    this.wbigText.rectTransform.localScale = new V3(Math.min(1, w / 1500), Math.min(1, w / 1500), 1);
    // title side cards
    const half = w / 2, room = half - 500;
    const side = room >= 330;
    if (this.wboardNode) {
      if (side) {
        const cw = Math.min(440, room - 30), x = 500 + room / 2;
        this.wboardNode.place(UIKit.Center, new V2(x, 40), new V2(cw, 560));
        this.wrulesNode.place(UIKit.Center, new V2(-x, 40), new V2(cw, 560));
        this.wrulesNode.setActive(true);
      } else {
        const tall = h > 1700;
        this.wboardNode.place(UIKit.Center, new V2(0, -780), new V2(460, 520));
        this.wboardNode.setActive(tall);
        this.wrulesNode.setActive(false);
      }
      if (side) this.wboardNode.setActive(true);
    }
    // result side cards
    const rr = UI.root!.rect, rhalf = rr.width / 2, rroom = rhalf - 520;
    this.wcards.forEach((c, i) => {
      if (rroom >= 300) { const cw = Math.min(430, rroom - 30); c.node.place(UIKit.Center, new V2((i === 0 ? -1 : 1) * (520 + rroom / 2), 20), new V2(cw, 640)); c.node.setActive(true); }
      else c.node.setActive(false);
    });
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.demo = false;
    this.step = "idle";
    this.mode = this.wSelMode;
    this.scores = [0, 0];
    this.wresultRoot.setActive(false);
    this.wbannerNode.setActive(false);
    this.wdemoTag.gameObject.setActive(false);
    this.wbigText.gameObject.setActive(false);
    this.WClearFlights();
    this.SetupRound();
    this.WRefreshTitle();
    this.wlastInput = performance.now();
  }

  protected BeginRun() {
    this.demo = false;
    this.mode = this.wSelMode;
    this.diff = this.wSelDiff;
    this.scores = [0, 0];
    this.timeLeft = this.RoundLength(this.mode);
    this.step = "count";
    this.stepT = CountTime;
    this.wcountN = -1;
    this.wtenWarned = -1;
    this.wcpuT = [1.2, 1.2];
    this.wresultRoot.setActive(false);
    this.wbannerNode.setActive(false);
    this.wdemoTag.gameObject.setActive(false);
    // No pause / home buttons on the wall during a round: a ball landing on them would pause the event. ESC pauses, R goes home.
    this.UI.SetPauseButton(false);
    this.WClearFlights();
    this.Data.add("games", 1);
    this.SetupRound();
    WallHits.clear();
    Sfx.setIntensity(0.6);
  }

  private WStartDemo() {
    this.demo = true;
    this.mode = WMode.Duo;
    this.diff = 1;
    this.scores = [0, 0];
    this.timeLeft = this.RoundLength(WMode.Duo);
    this.step = "play";
    this.wcpuT = [1, 1.4];
    this.UI.ShowHud();
    this.UI.SetPauseButton(false);
    this.wresultRoot.setActive(false);
    this.wbannerNode.setActive(true);
    this.wdemoTag.gameObject.setActive(true);
    this.WClearFlights();
    this.SetupRound();
    WallHits.clear();
  }

  private WStopDemo() {
    this.demo = false;
    WallHits.clear();
    this.UI.SetPauseButton(true);
    this.EnterTitle();
  }

  private get wIdle() { return Math.min(WallHits.idleSeconds, (performance.now() - this.wlastInput) / 1000); }

  // ------------------------------------------------------------------ frame

  update() {
    super.update();
    if (AdService.isShowing) return;
    const r = Keyboard.letter("r").wasPressedThisFrame;
    if (this.demo && (r || Keyboard.anyKeyPressed || Keyboard.space.wasPressedThisFrame || Keyboard.enter.wasPressedThisFrame || Keyboard.escape.wasPressedThisFrame)) { this.WStopDemo(); return; }
    if (r && this.State !== Phase.Title) this.EnterTitle();
  }

  protected TickBackground(dt0: number) {
    const dt = dt0 * WallGame.TestTimeScale;
    if (this.State === Phase.Title && this.demo) {
      if (WallHits.take().length > 0) { this.WStopDemo(); return; }
      this.WTickRound(dt, dt0);
      if (this.step === "end" && this.stepT <= 0) this.WStartDemo();
    } else {
      WallHits.take();
      if (this.State === Phase.Title && !this.UI.ModalOpen && this.wIdle >= IdleForDemo) this.WStartDemo();
      else if (this.State === Phase.Over && this.wIdle >= IdleForDemo) { this.EnterTitle(); this.WStartDemo(); }
      this.TickWorld(dt);
      this.WTickFlights(dt);
      this.WTickMarkers(dt0);
    }
    if (this.demo) {
      this.WUpdateHud(dt0);
      const k = 0.5 + 0.5 * Math.sin(Time.time * 4);
      this.wbannerText.color = Color.lerp(Gold, Color.white, k * 0.6);
    }
  }

  protected TickRun(dt0: number) {
    const dt = dt0 * WallGame.TestTimeScale;
    for (const h of WallHits.take()) {
      const who = this.mode === WMode.Duo ? h.side : 0;
      this.Mark(h.world, this.PlayerColor(who));
      if (this.step === "play") this.OnBall({ world: h.world, who, cpu: false, side: h.side });
    }
    this.WTickRound(dt, dt0);
    if (this.step === "end" && this.stepT <= 0 && this.State === Phase.Playing) this.WFinishRound();
    this.WUpdateHud(dt0);
  }

  private WTickRound(dt: number, dt0: number) {
    if (this.step === "count") {
      this.stepT -= dt;
      const n = Math.ceil(this.stepT / 1.0);
      if (n !== this.wcountN && this.stepT > 0) {
        this.wcountN = n;
        if (n >= 1 && n <= 3) { this.Big(String(n), Color.white, 0.9, 300); Sfx.play(Snd.Beep, 0.8); }
      }
      if (this.stepT <= 0) {
        this.step = "play";
        this.Big("GO!", Gold, 0.9, 280);
        Sfx.playClip(this.whistleClip, 0.9);
        WallHits.clear();
      }
    } else if (this.step === "play") {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      const sec = Math.ceil(this.timeLeft);
      if (sec <= 10 && sec !== this.wtenWarned && this.timeLeft > 0 && !this.demo) { this.wtenWarned = sec; Sfx.play(Snd.Tick, 0.8); }
      for (let who = 0; who < 2; who++) if (this.IsCpu(who)) this.TickCpu(dt, who, this.demo ? 1 : this.diff);
      if (this.timeLeft <= 0) this.EndRound();
    } else if (this.step === "end") this.stepT -= dt0;
    this.TickWorld(dt);
    this.WTickFlights(dt);
    this.WTickMarkers(dt0);
  }

  /** Ends the round now ("TIME!" or a game's own reason). */
  protected EndRound(text = "TIME!") {
    if (this.step !== "play") return;
    this.step = "end";
    this.stepT = 2.2;
    this.Big(text, Bad, 2, text.length > 8 ? 150 : 240);
    if (!this.demo) { Sfx.playClip(this.hornClip, 0.9); this.Cheer(0.5); }
  }

  private WUpdateHud(dt: number) {
    const solo = this.mode === WMode.Solo && !this.demo;
    set(this.wtimerText, Fmt.clock(Math.ceil(this.timeLeft)));
    const hot = this.step === "play" && this.timeLeft <= 10;
    this.wtimerText.color = hot ? Color.lerp(Color.white, Bad, 0.5 + 0.5 * Math.sin(Time.time * 12)) : Color.white;
    const ts = hot ? 1 + 0.06 * Math.max(0, Math.sin(Time.time * 12)) : 1;
    this.wtimerNode.localScale = new V3(ts, ts, 1);
    this.wpanels.forEach((p, i) => {
      const on = !solo || i === 0;
      p.node.setActive(on);
      if (!on) return;
      set(p.name, solo ? this.ScoreCaption() : this.PlayerName(i));
      p.name.color = solo ? SoloCol : i === 0 ? P1Col : P2Col;
      set(p.value, this.PanelValue(i));
      set(p.sub, this.PanelSub(i));
    });
    if (this.wbigText.gameObject.activeSelf) {
      this.wbigT += dt;
      const k = this.wbigT / this.wbigDur;
      if (k >= 1) this.wbigText.gameObject.setActive(false);
      else {
        const s = Mathf.lerp(1.7, 1, Ease.outBack(Mathf.clamp01(this.wbigT / 0.3)));
        this.wbigText.rectTransform.localScale = new V3(s * Math.min(1, this.UI.Hud.rect.width / 1500), s * Math.min(1, this.UI.Hud.rect.width / 1500), 1);
        this.wbigText.color = this.wbigText.color.withAlpha(k > 0.75 ? (1 - k) / 0.25 : 1);
      }
    }
  }

  // ------------------------------------------------------------------ results

  private WFinishRound() {
    const id = this.Info.Id;
    this.wresultRoot.setActive(true);
    let r: Result;
    if (this.mode === WMode.Solo) {
      const score = this.scores[0];
      const stars = this.SoloStars(score);
      const newBest = score > 0 && this.Data.max("best", score);
      const rank = score > 0 ? WallBoard.add(id, score, "SOLO") : 0;
      this.wlastRank = rank;
      r = new Result({
        Headline: `${Fmt.n(score)} POINTS`, HeadlineColor: Gold, Stars: stars, NewBest: newBest,
        BestLine: (rank > 0 ? `#${rank} TODAY  ·  ` : "") + `BEST ${Fmt.n(this.Data.get("best"))}`,
        Stats: this.ResultStats(), Primary: "PLAY AGAIN", Victory: stars > 0,
      });
      this.WFillCard(0, rank > 0 ? `#${rank} TODAY` : "TIME!", "YOUR SCORE", Fmt.n(score), SoloCol, `BEST ${Fmt.n(this.Data.get("best"))}`, true);
      this.WFillBoardCard(1, rank);
    } else {
      const w = this.Winner();
      const vs = this.mode === WMode.Vs;
      let rank = 0;
      if (vs) {
        const d = this.diff;
        if (w === 0) { this.Data.add("w" + d, 1); } else if (w === 1) this.Data.add("l" + d, 1);
        if (this.BoardScore(0) > 0) rank = WallBoard.add(id, this.BoardScore(0), "VS CPU");
      } else if (w >= 0) {
        this.Data.add("p" + w, 1);
        if (this.BoardScore(w) > 0) rank = WallBoard.add(id, this.BoardScore(w), w === 0 ? "P1" : "P2");
      }
      this.wlastRank = rank;
      const head = w < 0 ? "IT'S A DRAW!" : vs ? (w === 0 ? "YOU WIN!" : "COMPUTER WINS") : `PLAYER ${w + 1} WINS!`;
      const col = w < 0 ? Gold : w === 0 ? P1Col : P2Col;
      const margin = Math.abs(this.scores[0] - this.scores[1]) / Math.max(1, Math.max(this.scores[0], this.scores[1]));
      const stars = vs ? (w === 0 ? (margin > 0.4 ? 3 : margin > 0.15 ? 2 : 1) : 0) : -1;
      const tail = vs ? `VS COMPUTER ${DiffNames[this.diff]}  ·  ${this.Data.get("w" + this.diff)} WON · ${this.Data.get("l" + this.diff)} LOST`
        : `MATCHES  P1 ${this.Data.get("p0")} – ${this.Data.get("p1")} P2`;
      r = new Result({
        Headline: head, HeadlineColor: col, Value: this.ResultValue(), Stars: stars,
        BestLine: (rank > 0 ? `#${rank} TODAY  ·  ` : "") + tail,
        Stats: this.ResultStats(), Primary: vs ? (w === 0 ? "PLAY AGAIN" : "REMATCH") : "REMATCH", Victory: w === 0 || (!vs && w >= 0),
      });
      for (let i = 0; i < 2; i++) {
        const won = w === i;
        this.WFillCard(i, won ? "WINNER!" : w < 0 ? "DRAW" : "", this.PlayerName(i), this.PanelValue(i), i === 0 ? P1Col : P2Col, this.CardSub(i), won || w < 0);
      }
    }
    if (this.wlastRank > 0) this.Cheer(0.7);
    this.Finish(r);
  }

  private WFillCard(i: number, crown: string, title: string, value: string, col: Color, sub: string, glow: boolean) {
    const c = this.wcards[i];
    c.crown.text = crown;
    c.title.text = title;
    c.title.color = col;
    c.value.text = value;
    c.value.color = Color.white;
    c.sub.text = sub;
    c.sub.fontSize = 34;
    c.value.fontSize = value.length > 5 ? 110 : 150;
    c.value.rectTransform.place(new V2(0.5, 0.5), new V2(0, -10), new V2(420, 180));
    c.edge.color = glow ? col : col.withAlpha(0.35);
  }

  private WFillBoardCard(i: number, rank: number) {
    const c = this.wcards[i];
    const list = WallBoard.list(this.Info.Id, 5);
    c.crown.text = "";
    c.title.text = "TODAY'S TOP 5";
    c.title.color = Gold;
    c.value.text = list.map((e, k) => (k + 1 === rank ? `<color=#ffc93c>${k + 1}. ${Fmt.n(e.score)} ${e.label}</color>` : `${k + 1}. ${Fmt.n(e.score)} ${e.label}`)).join("\n") || "---";
    c.value.fontSize = 40;
    c.value.rectTransform.place(new V2(0.5, 0.5), new V2(0, -60), new V2(400, 420));
    c.sub.text = "";
    c.edge.color = Gold;
  }

  // ------------------------------------------------------------------ test hooks

  /** World point → CSS pixels (for scripted tests). */
  protected Css(p: V2) { const sp = Camera.worldToScreen(p); return { x: sp.x / Screen.dpr, y: sp.y / Screen.dpr }; }
}

/** Shared procedural sprites of the wall frame. */
export const WallArt = {
  /** Soft paint splash left by a ball (tinted per player). */
  Splat() {
    return CasualArt.make("wall-splat", 128, 128, (p) => {
      const a = Math.atan2(p.y, p.x), r = p.magnitude;
      const edge = 0.55 + 0.12 * Math.sin(a * 7) + 0.07 * Math.sin(a * 13 + 1) + 0.05 * Math.sin(a * 3 + 2);
      let al = CasualArt.fill(r - edge, 0.03);
      for (let i = 0; i < 6; i++) {
        const ang = i * 1.05 + 0.4, c = new V2(Math.cos(ang), Math.sin(ang)).mul(0.78 + 0.08 * (i % 3));
        al = Math.max(al, CasualArt.fill(CasualArt.sdCircle(p, c, 0.07 + 0.03 * (i % 2)), 0.03));
      }
      return new Color(1, 1, 1, al * (0.65 + 0.35 * CasualArt.smooth(edge, 0, r)));
    });
  },
};
