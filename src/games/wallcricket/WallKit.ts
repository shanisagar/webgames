import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, currentClient, Fmt, Fx, GameObject, Image, Keyboard,
  Mathf, Outline, Pal, Phase, Result, Screen, Sfx, Snd, Sprite, SpriteRenderer, Text, TextAnchor, Time, UIKit, UINode, V2, V3,
  WallBoard, WallHits,
} from "../../kit";

/**
 * Shared frame for the LiDAR wall games (local copy per game folder; kit gap: the kit has WallHits/WallBoard but no wall
 * game shell). A 32 × 18 world-unit wall (16:9, y up) is always fully visible; split-wall games give the left half to
 * player 1 and the right half to player 2. It runs the 3-2-1 countdown, the round clock, "TIME!", the impact markers,
 * virtual throwers' flying balls, the title-screen mode picker and today's top 5, the result-screen rank badge and the
 * computer-vs-computer attract loop. Games implement the targets and scoring.
 */

export const WallW = 32, WallH = 18;
export enum Mode { Solo = 0, Cpu = 1, Duo = 2 }
export enum Step { Idle, Count, Play, End }
export const ModeNames = ["SOLO", "VS COMPUTER", "2 PLAYERS"];
export const DiffNames = ["EASY", "MEDIUM", "HARD"];
export const P1 = Pal.hex(0x2fc8ff), P2 = Pal.hex(0xff4f8b), Gold = Pal.hex(0xffc93c), Ink = Pal.hex(0x070818), Grey = Pal.hex(0xb8c0d8);
/** HUD canvas units per world unit when the wall fills a 16:9 screen (1080 / 18). */
const U = 60;
const C = new V2(0.5, 0.5);

/** Hash noise in [-1, 1] (deterministic, for synthesized sounds). */
export const noise = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
/** Standard normal sample. */
export function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const hexCol = (h: string | undefined) => (h && /^#[0-9a-f]{6}$/i.test(h) ? Pal.hex(parseInt(h.slice(1), 16)) : null);

interface Ring { sr: SpriteRenderer; t: number; life: number; from: number; to: number; color: Color; active: boolean }
interface Mark { sr: SpriteRenderer; t: number; life: number; active: boolean }
interface Flight { sr: SpriteRenderer; shadow: SpriteRenderer; from: V2; to: V2; t: number; dur: number; size: number; side: number; spin: number; land: ((p: V2) => void) | null; active: boolean }
export interface Loose { sr: SpriteRenderer; pos: V2; vel: V2; t: number; life: number; spin: number; gravity: number; size: number; shrink: number; active: boolean; floor: number; shape: V2 }

export abstract class WallGame extends ArcadeGame {
  protected mode = Mode.Cpu;
  protected diff = 1;
  /** Computer-vs-computer attract round. */
  protected demo = false;
  protected step = Step.Idle;
  protected stepT = 0;
  protected clock = 0;
  protected roundLen = 120;
  /** Seconds of idle wall before the attract loop starts (tests may lower it). */
  attractAfter = 40;
  protected wall!: GameObject;
  protected fxw!: CasualFx;
  protected readonly sideCol = [P1, P2];
  private rings: Ring[] = [];
  private marks: Mark[] = [];
  private flights: Flight[] = [];
  private loose: Loose[] = [];
  private screenT = 0;
  private lastTick = 0;
  private bg: SpriteRenderer | null = null;

  // HUD (laid out in a 1920 × 1080 "wall canvas" that is scaled onto the wall)
  protected hudRoot!: UINode;
  protected panels: UINode[] = [];
  protected scoreText: Text[] = [];
  protected nameText: Text[] = [];
  protected subText: Text[] = [];
  private panelPop = [0, 0];
  protected clockText!: Text;
  private clockPanel!: UINode;
  private bigText!: Text; private bigGlow!: Outline; private bigT = 0; private bigLife = 0; private bigFrom = 2;
  private banner!: UINode; private bannerText!: Text;
  private sideTag: Text[] = [];
  private sideTagT = [0, 0];

  // title + result extras
  private modeButtons: ArcadeButton[] = [];
  private diffButtons: ArcadeButton[] = [];
  private infoPanel!: UINode; private infoText!: Text; private infoHead!: Text;
  private boardPanel!: UINode; private boardRows: Text[] = []; private boardScores: Text[] = [];
  private resPanel: UINode | null = null; private resRows: Text[] = []; private resScores: Text[] = [];
  private resBadge: UINode | null = null; private resBadgeText!: Text;
  private resRank = 0;
  private starImgs: Image[] = []; private starCount = 0; private starT = 0; private starPlayed = 0;

  protected hornClip!: AudioClip; protected whistleClip!: AudioClip; protected thudClip!: AudioClip;
  protected cheerClip!: AudioClip; protected roarClip!: AudioClip; protected groanClip!: AudioClip;

  // ------------------------------------------------------------------ game hooks

  /** Sprite of a thrown ball (for virtual throwers). */
  protected abstract BallSprite(): Sprite;
  /** World size of a ball on the wall. */
  protected get BallSize() { return 1.0; }
  protected abstract Backdrop(): Sprite;
  protected abstract BuildWall(): void;
  /** Reset the targets for this.mode (also used for the title screen / demo). */
  protected abstract ResetRound(): void;
  protected abstract RoundSeconds(): number;
  /** Ambient motion: runs every frame on every screen. `live` = a round is being played. */
  protected abstract TickWall(dt: number, live: boolean): void;
  /** Bots and per-round logic during the PLAY step. */
  protected abstract TickPlay(dt: number): void;
  /** A ball landed on side `side` at wall point p (by a person or a virtual thrower). */
  protected abstract OnHit(side: number, p: V2, bot: boolean): void;
  /** Score panel texts for a side: [big number, small line]. */
  protected abstract PanelText(side: number): [string, string];
  /** The result of a finished round, the score for today's board and its label. */
  protected abstract MakeResult(): { result: Result; score: number; label: string; stars: number };
  protected abstract ModeInfo(mode: Mode): string;
  /** Round ends early (e.g. all darts thrown). */
  protected RoundDone() { return false; }
  /** Called once when the countdown says GO. */
  protected OnGo() {}
  /** Called when the clock hits zero, before "TIME!". */
  protected OnTime() {}

  // ------------------------------------------------------------------ helpers for games

  protected get Solo() { return this.mode === Mode.Solo && !this.demo; }
  protected IsBot(side: number) { return this.demo || (this.mode === Mode.Cpu && side === 1); }
  protected get Live() { return this.State === Phase.Playing && this.step === Step.Play; }
  protected get RoundProgress() { return Mathf.clamp01(1 - this.clock / Math.max(1, this.roundLen)); }
  protected Names(): [string, string] {
    if (this.demo) return ["CPU 1", "CPU 2"];
    if (this.mode === Mode.Solo) return ["SCORE", "TODAY'S BEST"];
    if (this.mode === Mode.Cpu) return ["PLAYER", `CPU · ${DiffNames[this.diff]}`];
    return ["PLAYER 1", "PLAYER 2"];
  }
  /** The client's name on BRAND targets when a portal is active, else the game's own word. */
  protected BrandWord(fallback: string) { const n = currentClient()?.name?.trim(); return n ? n.toUpperCase().slice(0, 12) : fallback; }
  /** BRAND colour: the client's accent through the kit theme, else the game's Accent2. */
  protected get BrandColor() { return hexCol(currentClient()?.theme?.accent) ?? this.Info.Accent2; }

  protected get ShortSide() {
    const a = Screen.width / Math.max(1, Screen.height);
    return a >= 1 ? Math.max(WallH, WallW / a) : WallW;
  }

  /** Big centre message (countdown numbers, "TIME!", "WICKET!"). */
  protected Big(text: string, color: Color, life = 0.9, from = 2) {
    this.bigText.text = text;
    this.bigText.color = color;
    this.bigText.fontSize = text.length > 9 ? 150 : text.length > 5 ? 210 : 300;
    this.bigGlow.effectColor = Color.lerp(color, Ink, 0.6).withAlpha(0.95);
    this.bigT = 0;
    this.bigLife = life;
    this.bigFrom = from;
  }

  /** A short label above a side's half (e.g. "CPU'S HALF!"). */
  protected SideTag(side: number, text: string, color: Color) {
    const t = this.sideTag[side];
    t.text = text;
    t.color = color;
    this.sideTagT[side] = 1.3;
  }

  protected PopPanel(side: number) { this.panelPop[side] = 1; }

  /** Ring + splash + smudge at the exact landing spot (hit or miss). */
  protected Impact(p: V2, color: Color, strong = false) {
    const r = this.rings.find((x) => !x.active) ?? this.rings[0];
    Object.assign(r, { t: 0, life: strong ? 0.6 : 0.45, from: 0.5, to: strong ? 3.4 : 2.2, color, active: true });
    r.sr.transform.localPosition = p;
    r.sr.gameObject.setActive(true);
    const m = this.marks.find((x) => !x.active) ?? this.marks.reduce((a, b) => (a.t > b.t ? a : b));
    Object.assign(m, { t: 0, life: 2.2, active: true });
    m.sr.transform.localPosition = p;
    m.sr.color = color.withAlpha(0.55);
    m.sr.gameObject.setActive(true);
    this.fxw.pop(p, Color.lerp(color, Color.white, 0.35), strong ? 18 : 10, strong ? 9 : 6, 0.32, 0.45);
    if (strong) this.fxw.pop(p, Color.white, 8, 4, 0.22, 0.35);
  }

  /** A ball (or bail, or stump) falling under gravity and fading. */
  protected Drop(sprite: Sprite, pos: V2, vel: V2, size: number, opts: { life?: number; gravity?: number; spin?: number; order?: number; color?: Color; shrink?: number; floor?: number; shape?: V2; angle?: number } = {}) {
    const l = this.loose.find((x) => !x.active) ?? this.loose[0];
    l.sr.sprite = sprite;
    l.sr.color = opts.color ?? Color.white;
    l.sr.sortingOrder = opts.order ?? 40;
    Object.assign(l, { pos, vel, t: 0, life: opts.life ?? 1.4, spin: opts.spin ?? Mathf.lerp(-300, 300, Math.random()), gravity: opts.gravity ?? 34, size, shrink: opts.shrink ?? 0, active: true, floor: opts.floor ?? -99, shape: opts.shape ?? V2.one });
    l.sr.transform.localEulerZ = opts.angle ?? 0;
    l.sr.gameObject.setActive(true);
    this.PlaceLoose(l);
    return l;
  }

  /** A virtual thrower's ball: flies in from the crowd and lands at `to` after `dur` seconds. */
  protected Throw(side: number, to: V2, dur = 0.8, land: ((p: V2) => void) | null = null) {
    const f = this.flights.find((x) => !x.active);
    if (!f) return;
    const sx = Mathf.clamp(to.x * 0.55 + (side === 0 ? -3 : 3), -WallW / 2, WallW / 2);
    Object.assign(f, { from: new V2(sx, -WallH / 2 - 3), to, t: 0, dur, size: this.BallSize, side, spin: Mathf.lerp(-500, 500, Math.random()), active: true, land: land ?? ((p: V2) => this.OnHit(side, p, true)) });
    f.sr.sprite = this.BallSprite();
    f.sr.gameObject.setActive(true);
    f.shadow.gameObject.setActive(true);
    this.PlaceFlight(f);
  }
  protected get FlightsInAir() { return this.flights.filter((f) => f.active).length; }
  protected FlightsFor(side: number) { return this.flights.filter((f) => f.active && f.side === side).length; }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Data.set("mode", 1); this.Data.set("diff", 1); }
    CasualLook.calm(this, 1.3, 0.12);
    this.bg = CasualLook.cover(this.gameObject, this.Backdrop(), -950);
    this.wall = new GameObject("Wall", this.gameObject);
    this.BuildWall();
    this.fxw = CasualFx.create(this.wall, 70, 260);
    for (let i = 0; i < 16; i++) {
      const sr = Art.spr(this.wall, "ImpactRing", Art.Ring, Color.white, 1, 72, Art.Flat);
      sr.gameObject.setActive(false);
      this.rings.push({ sr, t: 0, life: 1, from: 0, to: 1, color: Color.white, active: false });
      const m = Art.spr(this.wall, "ImpactMark", WallArt.Smudge(), Color.white, 1.3, 3, Art.Flat);
      m.gameObject.setActive(false);
      this.marks.push({ sr: m, t: 0, life: 1, active: false });
    }
    for (let i = 0; i < 10; i++) {
      const shadow = Art.spr(this.wall, "FlightShadow", CasualArt.Soft, new Color(0, 0, 0, 0.35), 1, 74, Art.Flat);
      const sr = Art.spr(this.wall, "Flight", this.BallSprite(), Color.white, 1, 75, Art.Flat);
      sr.gameObject.setActive(false); shadow.gameObject.setActive(false);
      this.flights.push({ sr, shadow, from: V2.zero, to: V2.zero, t: 0, dur: 1, size: 1, side: 0, spin: 0, land: null, active: false });
    }
    for (let i = 0; i < 24; i++) {
      const sr = Art.spr(this.wall, "Loose", this.BallSprite(), Color.white, 1, 40, Art.Flat);
      sr.gameObject.setActive(false);
      this.loose.push({ sr, pos: V2.zero, vel: V2.zero, t: 0, life: 1, spin: 0, gravity: 30, size: 1, shrink: 0, active: false, floor: -99, shape: V2.one });
    }
    this.BuildSounds();
    this.BuildHud();
    this.BuildTitle();
    this.BuildResultExtras();
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__wall = { game: this, WallHits, WallBoard };
    this.Layout();
  }

  private BuildSounds() {
    this.hornClip = Sfx.make("wall-horn", 1.1, (t) => {
      const vib = 1 + 0.01 * Math.sin(t * 34);
      const e = Mathf.clamp01(t / 0.04) * Mathf.clamp01((1.05 - t) / 0.25);
      return (Sfx.sawP(233 * vib * t) * 0.3 + Sfx.sawP(293.7 * vib * t) * 0.25 + Sfx.sawP(349.2 * vib * t) * 0.22 + Sfx.sqrP(116.5 * t) * 0.18) * e * 0.6;
    });
    this.whistleClip = Sfx.make("wall-whistle", 1.0, (t) => {
      const trill = 1 + 0.06 * Math.sign(Math.sin(t * 2 * Math.PI * 28));
      const e = Mathf.clamp01(t / 0.02) * Mathf.clamp01((0.95 - t) / 0.12) * (t > 0.32 && t < 0.42 ? 0.15 : 1);
      return (Sfx.sinP(2900 * trill * t) * 0.5 + noise(Math.trunc(t * 44100)) * 0.08) * e * 0.55;
    });
    let lp = 0;
    this.thudClip = Sfx.make("wall-thud", 0.22, (t) => {
      lp += (noise(Math.trunc(t * 44100) + 3) - lp) * 0.2;
      return (Sfx.sinP(Sfx.glide(t, 150, 55, 0.1)) * 0.8 + lp * 0.9) * Sfx.env(t, 0.001, 0.1) * 0.9;
    });
    const crowd = (name: string, secs: number, swell: number, gain: number) => {
      let a = 0, b = 0;
      return Sfx.make(name, secs, (t) => {
        const n = noise(Math.trunc(t * 44100) + 77);
        a += (n - a) * 0.08; b += (a - b) * 0.3;
        const voices = (Sfx.sawP(310 * t + Math.sin(t * 7) * 2) * 0.1 + Sfx.sawP(415 * t + Math.sin(t * 5) * 3) * 0.08 + Sfx.sawP(520 * t + Math.sin(t * 9) * 2) * 0.06) * (0.6 + 0.4 * Math.sin(t * 13));
        const e = Mathf.clamp01(t / swell) * Mathf.clamp01((secs - t) / (secs * 0.55));
        return ((a - b) * 2.2 + voices) * e * gain;
      });
    };
    this.cheerClip = crowd("wall-cheer", 1.4, 0.12, 0.7);
    this.roarClip = crowd("wall-roar", 2.4, 0.2, 0.9);
    this.groanClip = Sfx.make("wall-groan", 1.0, (t) => {
      const f = Sfx.glide(t, 260, 150, 0.9);
      return (Sfx.sawP(f) * 0.15 + Sfx.sawP(f * 1.26) * 0.1 + noise(Math.trunc(t * 22050)) * 0.12) * Sfx.env(t, 0.08, 0.7) * 0.6;
    });
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.hudRoot = UIKit.node("WallHud", hud).place(C, V2.zero, new V2(1920, 1080));
    const root = this.hudRoot;
    for (let i = 0; i < 2; i++) {
      const p = UIKit.node("Panel" + i, root).place(C, new V2(i === 0 ? -560 : 560, 405), new V2(520, 190));
      UIKit.img(p, "Bg", Art.UiRound, new Color(0.02, 0.02, 0.07, 0.82)).rectTransform.stretch();
      UIKit.img(p, "Edge", Art.UiOutline, this.sideCol[i].withAlpha(0.9)).rectTransform.stretch();
      this.nameText.push(UIKit.at(UIKit.label(p, "", 32, this.sideCol[i]), C, new V2(0, 66), new V2(480, 40)));
      const s = UIKit.at(UIKit.label(p, "0", 100, Color.white), C, new V2(0, 2), new V2(480, 100));
      UIKit.glow(s, this.sideCol[i].withAlpha(0.8), 5);
      this.scoreText.push(s);
      this.subText.push(UIKit.at(UIKit.label(p, "", 26, new Color(1, 1, 1, 0.8)), C, new V2(0, -66), new V2(500, 32)));
      this.panels.push(p);
      const tag = UIKit.at(UIKit.label(root, "", 54, Color.white), C, new V2(i === 0 ? -480 : 480, 230), new V2(760, 70));
      UIKit.glow(tag, Ink, 4);
      this.sideTag.push(tag);
    }
    this.clockPanel = UIKit.node("Clock", root).place(C, new V2(0, 420), new V2(300, 150));
    UIKit.img(this.clockPanel, "Bg", Art.UiRound, new Color(0.02, 0.02, 0.07, 0.86)).rectTransform.stretch();
    UIKit.img(this.clockPanel, "Edge", Art.UiOutline, new Color(1, 1, 1, 0.5)).rectTransform.stretch();
    this.clockText = UIKit.at(UIKit.label(this.clockPanel, "2:00", 96, Color.white), C, new V2(0, 0), new V2(300, 120));
    UIKit.glow(this.clockText, Ink, 4);
    this.bigText = UIKit.at(UIKit.label(root, "", 300, Color.white), C, new V2(0, 40), new V2(1800, 360));
    this.bigGlow = UIKit.glow(this.bigText, Ink, 8);
    this.banner = UIKit.node("Banner", root).place(C, new V2(0, -330), new V2(1300, 190));
    UIKit.img(this.banner, "Bg", Art.UiRound, new Color(0.02, 0.02, 0.07, 0.86)).rectTransform.stretch();
    UIKit.img(this.banner, "Edge", Art.UiOutline, Gold.withAlpha(0.9)).rectTransform.stretch();
    this.bannerText = UIKit.at(UIKit.label(this.banner, "THROW A BALL TO PLAY", 88, Gold), C, new V2(0, 18), new V2(1260, 110));
    UIKit.glow(this.bannerText, Ink, 5);
    UIKit.at(UIKit.label(this.banner, "DEMO ROUND · COMPUTER VS COMPUTER", 30, new Color(1, 1, 1, 0.8)), C, new V2(0, -58), new V2(1200, 40));
    this.banner.setActive(false);
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    const center = ex.parent!;
    CasualLook.titleCard(this.UI, new Color(0.02, 0.02, 0.07, 0.6), new V2(1060, 1060), -10);
    for (let i = 0; i < 3; i++) {
      const m = i as Mode;
      const b = UIKit.buttonAt(ex, ModeNames[i], C, new V2((i - 1) * 330, 18), new V2(315, 96), false, () => this.SetMode(m), 32);
      this.modeButtons.push(b);
    }
    for (let i = 0; i < 3; i++) {
      const d = i;
      const b = UIKit.buttonAt(ex, DiffNames[i], C, new V2((i - 1) * 230, -92), new V2(215, 76), false, () => this.SetDiff(d), 28);
      this.diffButtons.push(b);
    }
    // left: what this mode is; right: today's top 5
    this.infoPanel = UIKit.node("WallInfo", center).place(C, new V2(-725, -40), new V2(370, 560));
    UIKit.img(this.infoPanel, "Bg", Art.UiRound, new Color(0.02, 0.02, 0.07, 0.8)).rectTransform.stretch();
    UIKit.img(this.infoPanel, "Edge", Art.UiOutline, this.Info.Accent.withAlpha(0.7)).rectTransform.stretch();
    this.infoHead = UIKit.at(UIKit.label(this.infoPanel, "", 38, this.Info.Accent), C, new V2(0, 228), new V2(340, 50));
    this.infoText = UIKit.at(UIKit.wrap(UIKit.label(this.infoPanel, "", 30, Color.white, TextAnchor.UpperCenter)), C, new V2(0, -30), new V2(320, 440));
    this.boardPanel = this.MakeBoard(center, new V2(725, -40), this.boardRows, this.boardScores);
  }

  private MakeBoard(parent: UINode, pos: V2, rows: Text[], scores: Text[]) {
    const p = UIKit.node("TodayTop", parent).place(C, pos, new V2(370, 560));
    UIKit.img(p, "Bg", Art.UiRound, new Color(0.02, 0.02, 0.07, 0.82)).rectTransform.stretch();
    UIKit.img(p, "Edge", Art.UiOutline, Gold.withAlpha(0.8)).rectTransform.stretch();
    UIKit.glow(UIKit.at(UIKit.label(p, "TODAY'S TOP 5", 38, Gold), C, new V2(0, 228), new V2(340, 50)), Ink, 3);
    for (let i = 0; i < 5; i++) {
      const y = 140 - i * 86;
      UIKit.img(p, "Row", Art.UiRound, new Color(1, 1, 1, i % 2 === 0 ? 0.06 : 0.02)).rectTransform.place(C, new V2(0, y), new V2(340, 76));
      rows.push(CasualLook.fit(UIKit.at(UIKit.label(p, "", 30, Color.white, TextAnchor.MiddleLeft), C, new V2(-70, y), new V2(180, 60)), 18)!);
      scores.push(CasualLook.fit(UIKit.at(UIKit.label(p, "", 42, Color.white, TextAnchor.MiddleRight), C, new V2(90, y), new V2(150, 60)), 20)!);
    }
    return p;
  }

  private BuildResultExtras() {
    const safe = this.UI.Hud.parent?.parent;
    const center = safe?.find("Result")?.find("Center") ?? null;
    if (!center) return;
    this.resPanel = this.MakeBoard(center, new V2(725, 60), this.resRows, this.resScores);
    this.resBadge = UIKit.node("RankBadge", center).place(C, new V2(-725, 230), new V2(340, 150));
    UIKit.img(this.resBadge, "Glow", Art.Glow, Gold.withAlpha(0.45)).rectTransform.stretch(-90);
    UIKit.img(this.resBadge, "Bg", Art.UiRound, Gold).rectTransform.stretch();
    this.resBadgeText = UIKit.at(UIKit.label(this.resBadge, "#1 TODAY", 62, Ink), C, V2.zero, new V2(340, 120));
    this.resBadge.setActive(false);
    for (let i = 0; i < 3; i++) {
      const s = UIKit.img(center, "WallStar", CasualArt.StarShape, Color.white);
      s.rectTransform.place(C, new V2(-725 + (i - 1) * 120, i === 1 ? 10 : -10), new V2(i === 1 ? 130 : 110, i === 1 ? 130 : 110));
      this.starImgs.push(s);
    }
  }

  private RefreshBoard(rows: Text[], scores: Text[], highlight: number) {
    const list = WallBoard.list(this.Info.Id, 5);
    for (let i = 0; i < 5; i++) {
      const e = list[i];
      const hl = i === highlight - 1;
      rows[i].text = e ? `${i + 1}.  ${e.label}` : `${i + 1}.  ---`;
      scores[i].text = e ? this.BoardText(e.score) : "";
      const c = hl ? Gold : i === 0 && e ? Color.lerp(Gold, Color.white, 0.5) : Color.white;
      rows[i].color = e ? c : new Color(1, 1, 1, 0.35);
      scores[i].color = c;
    }
  }

  private SetMode(m: Mode) {
    this.Data.set("mode", m);
    this.RefreshTitle();
  }
  private SetDiff(d: number) {
    this.Data.set("diff", d);
    this.RefreshTitle();
  }

  private RefreshTitle() {
    const m = Mathf.clamp(this.Data.get("mode", 1), 0, 2) as Mode, d = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.mode = m; this.diff = d;
    this.modeButtons.forEach((b, i) => { b.primary = i === m; b.setAccent(i === m ? this.Info.Accent : Grey); });
    this.diffButtons.forEach((b, i) => { b.node.setActive(m === Mode.Cpu); b.primary = i === d; b.setAccent(i === d ? this.Info.Accent2 : Grey); });
    this.infoHead.text = ModeNames[m];
    this.infoText.text = this.ModeInfo(m);
    this.RefreshBoard(this.boardRows, this.boardScores, 0);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    if (!this.hudRoot) return;
    CasualLook.fitCover(this.bg, this.ViewSize);
    this.LayoutHud();
    const portrait = Screen.height > Screen.width;
    this.infoPanel.anchoredPosition = portrait ? new V2(0, 760) : new V2(-725, -40);
    this.infoPanel.localScale = portrait ? new V3(0.001, 0.001, 1) : V3.one;
    this.infoPanel.setActive(!portrait);
    this.boardPanel.anchoredPosition = portrait ? new V2(0, -790) : new V2(725, -40);
    if (this.resPanel) this.resPanel.anchoredPosition = portrait ? new V2(0, -820) : new V2(725, 60);
    if (this.resBadge) this.resBadge.anchoredPosition = portrait ? new V2(0, 600) : new V2(-725, 230);
    this.OnWallLayout();
  }
  protected OnWallLayout() {}

  /** The HUD canvas follows the wall (scaled down when the wall is letterboxed in portrait). Cheap: runs every frame. */
  private LayoutHud() {
    const o = this.UI.WorldToHud(V2.zero), r = this.UI.WorldToHud(new V2(1, 0));
    const k = Math.round(((r.x - o.x) / U) * 1000) / 1000;
    if (!(k > 0)) return;
    this.hudRoot.anchoredPosition = new V2(Math.round(o.x), Math.round(o.y));
    if (this.hudRoot.localScale.x !== k) this.hudRoot.localScale = new V3(k, k, 1);
  }

  // ------------------------------------------------------------------ flow

  protected BestLine() {
    const b = [this.Data.get("best0"), this.Data.get("best1"), this.Data.get("best2")];
    const top = WallBoard.list(this.Info.Id, 1)[0];
    return top ? `TODAY'S BEST ${this.BoardText(top.score)} (${top.label})   ·   YOUR SOLO BEST ${b[0]}` : `SOLO BEST ${b[0]}   ·   THROW TO SCORE!`;
  }
  protected StatsLine() { return ""; }
  /** How a board score reads (today's top 5). */
  protected BoardText(score: number) { return Fmt.n(score); }

  protected OnEnterTitle() {
    this.demo = false;
    this.step = Step.Idle;
    this.screenT = 0;
    this.mode = Mathf.clamp(this.Data.get("mode", 1), 0, 2) as Mode;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.ClearAir();
    this.banner.setActive(false);
    Sfx.effectsVolume = 0.5;
    this.ResetRound();
    this.RefreshTitle();
  }

  protected BeginRun() {
    if (!this.demo) {
      this.mode = Mathf.clamp(this.Data.get("mode", 1), 0, 2) as Mode;
      this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
      this.Data.add("games", 1);
    } else {
      this.mode = Mode.Duo;
      this.diff = 1;
      Sfx.effectsVolume = 0.35;
    }
    this.roundLen = this.demo ? Math.min(45, this.RoundSeconds()) : this.RoundSeconds();
    this.clock = this.roundLen;
    this.ClearAir();
    this.banner.setActive(this.demo);
    this.UI.SetPauseButton(!this.demo);
    this.ResetRound();
    const names = this.Names();
    for (let i = 0; i < 2; i++) { this.nameText[i].text = names[i]; this.panelPop[i] = 0; this.sideTagT[i] = 0; this.sideTag[i].text = ""; }
    this.panels[1].setActive(true);
    this.step = Step.Count;
    this.stepT = 3.6;
    this.lastTick = 4;
    WallHits.clear();
    Sfx.setIntensity(0.35);
    this.UpdateHud(0);
  }

  private StartDemo() {
    this.demo = true;
    this.StartRun();
  }

  private EndDemo() {
    this.demo = false;
    this.EnterTitle();
  }

  private ClearAir() {
    for (const f of this.flights) { f.active = false; f.sr.gameObject.setActive(false); f.shadow.gameObject.setActive(false); }
    for (const l of this.loose) { l.active = false; l.sr.gameObject.setActive(false); }
    for (const r of this.rings) { r.active = false; r.sr.gameObject.setActive(false); }
    for (const m of this.marks) { m.active = false; m.sr.gameObject.setActive(false); }
    this.fxw?.clear();
    this.bigLife = 0;
    if (this.bigText) this.bigText.text = "";
  }

  // ------------------------------------------------------------------ frame

  update() {
    if (this.hudRoot) this.LayoutHud();
    // operator keys: R = back to title; 1/2/3 = mode and D = difficulty on the title screen
    if (Keyboard.letter("r").wasPressedThisFrame && this.State !== Phase.Title) { this.demo = false; this.EnterTitle(); }
    if (this.State === Phase.Title && !this.UI.ModalOpen) {
      for (let i = 1; i <= 3; i++) if (Keyboard.digit(i).wasPressedThisFrame) { this.SetMode((i - 1) as Mode); Sfx.play(Snd.Click, 0.6); }
      if (Keyboard.letter("d").wasPressedThisFrame) { this.SetDiff((this.Data.get("diff", 1) + 1) % 3); Sfx.play(Snd.Click, 0.6); }
    }
    super.update();
  }

  protected TickBackground(dt: number) {
    this.screenT += dt;
    if (this.State === Phase.Over && this.starImgs.length) {
      this.starT += Time.unscaledDeltaTime;
      for (let i = 0; i < 3; i++) {
        const k = Mathf.clamp01((this.starT - 0.4 - i * 0.3) / 0.3), lit = i < this.starCount && k > 0;
        const s = lit ? Mathf.lerp(1.8, 1, k) : 1;
        this.starImgs[i].rectTransform.localScale = new V3(s, s, 1);
        this.starImgs[i].color = lit ? Color.lerp(Color.white, Gold, k) : new Color(1, 1, 1, 0.14);
        if (lit && i >= this.starPlayed) { this.starPlayed = i + 1; Sfx.play(Snd.Coin, 0.8, 1 + i * 0.18); }
      }
    }
    for (const h of WallHits.take()) this.Impact(h.world, Grey, false);
    const idle = Math.min(WallHits.idleSeconds, this.State === Phase.Over ? this.screenT : 1e9);
    if (!this.demo && !this.UI.ModalOpen && idle > this.attractAfter && this.screenT > 8) { this.StartDemo(); return; }
    this.TickWall(dt, false);
    this.TickAir(dt);
  }

  protected TickRun(dt: number) {
    if (this.demo && (Keyboard.space.wasPressedThisFrame || Keyboard.enter.wasPressedThisFrame)) { this.demo = false; this.StartRun(); return; }
    this.stepT -= dt;
    switch (this.step) {
      case Step.Count: {
        if (this.demo && WallHits.take().length > 0) { this.EndDemo(); return; }
        WallHits.clear();
        const n = Math.ceil(this.stepT - 0.6);
        if (n !== this.lastTick && n >= 1 && n <= 3) { this.lastTick = n; this.Big(String(n), Color.white, 0.8, 2.2); Sfx.play(Snd.Beep, 0.9); }
        if (this.stepT <= 0.6 && this.lastTick !== 0) {
          this.lastTick = 0;
          this.Big("GO!", Gold, 0.8, 2.6);
          Sfx.playClip(this.hornClip, 0.9);
          this.Fx.shake(0.2);
          this.step = Step.Play;
          this.OnGo();
        }
        break;
      }
      case Step.Play: {
        const hits = WallHits.take();
        if (this.demo && hits.length > 0) { this.EndDemo(); return; }
        for (const h of hits) {
          const side = this.mode === Mode.Solo ? 0 : h.side;
          if (this.IsBot(side)) {
            this.Impact(h.world, Grey, false);
            this.SideTag(side, "THAT'S THE CPU'S HALF!", Grey);
            continue;
          }
          this.OnHit(side, h.world, false);
        }
        this.clock -= dt;
        this.TickPlay(dt);
        if (this.clock <= 10.5 && this.clock > 0) {
          const s = Math.ceil(this.clock);
          if (s !== this.lastTick && s <= 10) { this.lastTick = s; Sfx.play(Snd.Tick, 0.9, 1.2 + (10 - s) * 0.03); }
        }
        if (this.clock <= 0 || this.RoundDone()) {
          this.clock = Math.max(0, this.clock);
          this.OnTime();
          this.step = Step.End;
          this.stepT = 2.0;
          this.Big(this.RoundDone() && this.clock > 0 ? "DONE!" : "TIME!", Pal.hex(0xff6a5a), 1.8, 2.4);
          Sfx.playClip(this.whistleClip, 1);
          this.Fx.shake(0.25);
        }
        break;
      }
      case Step.End: {
        if (this.demo && WallHits.take().length > 0) { this.EndDemo(); return; }
        WallHits.clear();
        if (this.stepT <= 0 && this.FlightsInAir === 0) {
          if (this.demo) { this.EndDemo(); return; }
          this.EndRound();
          return;
        }
        break;
      }
    }
    this.TickWall(dt, this.step === Step.Play);
    this.TickAir(dt);
    this.UpdateHud(dt);
  }

  private EndRound() {
    const { result, score, label, stars } = this.MakeResult();
    this.starCount = stars; this.starT = 0; this.starPlayed = 0;
    result.Stars = -1;
    this.resRank = score > 0 ? WallBoard.add(this.Info.Id, score, label) : 0;
    if (this.resRank > 0) {
      result.BestLine = `${result.BestLine}   ·   #${this.resRank} TODAY`;
    }
    this.Finish(result);
    this.screenT = 0;
    if (this.resRank > 0 && this.resRank <= 3) Sfx.playClip(this.roarClip, 0.7);
    this.RefreshBoard(this.resRows, this.resScores, this.resRank <= 5 ? this.resRank : 0);
    if (this.resBadge) {
      this.resBadge.setActive(this.resRank > 0);
      this.resBadgeText.text = `#${this.resRank} TODAY`;
    }
  }

  private TickAir(dt: number) {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { r.active = false; r.sr.gameObject.setActive(false); continue; }
      const s = Mathf.lerp(r.from, r.to, 1 - (1 - k) * (1 - k));
      r.sr.transform.localScale = new V3(s, s, 1);
      r.sr.color = r.color.withAlpha(1 - k);
    }
    for (const m of this.marks) {
      if (!m.active) continue;
      m.t += dt;
      const k = m.t / m.life;
      if (k >= 1) { m.active = false; m.sr.gameObject.setActive(false); continue; }
      m.sr.color = m.sr.color.withAlpha(0.55 * (1 - k * k));
    }
    for (const f of this.flights) {
      if (!f.active) continue;
      f.t += dt;
      if (f.t >= f.dur) {
        f.active = false;
        f.sr.gameObject.setActive(false);
        f.shadow.gameObject.setActive(false);
        f.land?.(f.to);
        continue;
      }
      this.PlaceFlight(f);
    }
    for (const l of this.loose) {
      if (!l.active) continue;
      l.t += dt;
      if (l.t >= l.life) { l.active = false; l.sr.gameObject.setActive(false); continue; }
      l.vel = new V2(l.vel.x * (1 - dt * 0.4), l.vel.y - l.gravity * dt);
      l.pos = l.pos.add(l.vel.mul(dt));
      if (l.pos.y < l.floor && l.vel.y < 0) { l.pos = l.pos.withY(l.floor); l.vel = new V2(l.vel.x * 0.7, -l.vel.y * 0.45); }
      this.PlaceLoose(l);
    }
    // the big centre message
    if (this.bigLife > 0) {
      this.bigT += Time.unscaledDeltaTime;
      const k = this.bigT / this.bigLife;
      if (k >= 1) { this.bigLife = 0; this.bigText.text = ""; }
      else {
        const s = Mathf.lerp(this.bigFrom, 1, 1 - Math.pow(1 - Mathf.clamp01(k / 0.25), 3));
        this.bigText.rectTransform.localScale = new V3(s, s, 1);
        this.bigText.color = this.bigText.color.withAlpha(k > 0.75 ? (1 - k) / 0.25 : 1);
      }
    }
  }

  private PlaceFlight(f: Flight) {
    const k = Mathf.clamp01(f.t / f.dur);
    const e = 1 - (1 - k) * (1 - k) * 0.6 - 0.4 * (1 - k);
    const p = V2.lerp(f.from, f.to, e).add(new V2(0, Math.sin(Math.PI * k) * 3.2));
    const s = f.size * Mathf.lerp(3.4, 1, Math.pow(k, 0.7));
    f.sr.transform.localPosition = p;
    f.sr.transform.localScale = new V3(s, s, 1);
    f.sr.transform.localEulerZ = f.spin * f.t;
    f.shadow.transform.localPosition = new V2(p.x, f.to.y - 0.1);
    const ss = f.size * Mathf.lerp(0.5, 1.4, k);
    f.shadow.transform.localScale = new V3(ss, ss * 0.5, 1);
    f.shadow.color = new Color(0, 0, 0, 0.35 * k * k);
  }

  private PlaceLoose(l: Loose) {
    const k = l.t / l.life;
    const s = l.size * (1 - l.shrink * k);
    l.sr.transform.localPosition = l.pos;
    l.sr.transform.localScale = new V3(s * l.shape.x, s * l.shape.y, 1);
    l.sr.transform.localEulerZ = l.sr.transform.localEulerZ + l.spin * Time.deltaTime;
    l.sr.color = l.sr.color.withAlpha(k > 0.7 ? (1 - k) / 0.3 : 1);
  }

  private UpdateHud(dt: number) {
    for (let i = 0; i < 2; i++) {
      const [big, sub] = this.PanelText(i);
      if (this.scoreText[i].text !== big) this.scoreText[i].text = big;
      if (this.subText[i].text !== sub) this.subText[i].text = sub;
      this.panelPop[i] = Mathf.moveTowards(this.panelPop[i], 0, dt * 2.5);
      const s = 1 + 0.18 * this.panelPop[i];
      this.scoreText[i].rectTransform.localScale = new V3(s, s, 1);
      if (this.sideTagT[i] > 0) {
        this.sideTagT[i] -= dt;
        this.sideTag[i].color = this.sideTag[i].color.withAlpha(Mathf.clamp01(this.sideTagT[i] * 2));
        if (this.sideTagT[i] <= 0) this.sideTag[i].text = "";
      }
    }
    const c = Math.ceil(Math.max(0, this.clock));
    this.clockText.text = Fmt.clock(c);
    this.clockText.color = this.clock <= 10 && this.step === Step.Play ? Color.lerp(Pal.hex(0xff4a4a), Color.white, 0.5 + 0.5 * Math.sin(Time.time * 12)) : Color.white;
    const cs = this.clock <= 10 && this.step === Step.Play ? 1 + 0.06 * Math.abs(Math.sin(Time.time * 6)) : 1;
    this.clockPanel.localScale = new V3(cs, cs, 1);
    if (this.demo) {
      const p = 1 + 0.04 * Math.sin(Time.time * 4);
      this.banner.localScale = new V3(p, p, 1);
    }
  }

  // ------------------------------------------------------------------ results helpers

  /** Stars for a score against three thresholds. */
  protected static Stars(score: number, t1: number, t2: number, t3: number) { return score >= t3 ? 3 : score >= t2 ? 2 : score >= t1 ? 1 : 0; }

  /** Records per-mode bests; returns true for a new best. */
  protected SaveBest(score: number) { return this.Data.max("best" + this.mode, score) && score > 0; }

  protected Celebrate(side: number) {
    const p = new V2(this.mode === Mode.Solo ? 0 : side === 0 ? -8 : 8, 2);
    this.fxw.confetti(p, 70, 10, [this.sideCol[side], Gold, Color.white]);
    Sfx.playClip(this.roarClip, 0.8);
    Fx.haptic(true);
  }
}

/** Shared procedural sprites for the wall frame. */
export const WallArt = {
  Smudge: () => CasualArt.make("wall-smudge", 64, 64, (p) => {
    const r = p.magnitude;
    const a = CasualArt.smooth(0.95, 0.3, r) * (0.75 + 0.25 * Math.sin(Math.atan2(p.y, p.x) * 7));
    return new Color(1, 1, 1, Mathf.clamp01(a));
  }),
};
