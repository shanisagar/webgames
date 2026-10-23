import {
  ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Ease, Fmt, GameInfo, GameObject, howTo, Image, Keyboard, LineRenderer,
  Mathf, Pal, Phase, Result, Sfx, Snd, SpriteRenderer, SysRandom, Text, TextMesh, Time, TouchScheme, UIKit, UINode, V2, V3,
  WallBoard, WallHit, WallHits,
} from "../../kit";
import { Activity, BigBanner, DiffNames, gauss, Impacts, makeWallSounds, ModeBar, setText, Throws, TodayBoard, WallSounds, WallTime } from "./WallCommon";
import { BombArt, FuseColor, Gold, Ink, P1Color, P2Color } from "./BombArt";

/**
 * BOMB DEFUSE: cartoon bombs with lit, burning fuses pop up all over the wall. Hit a bomb of YOUR colour with a ball
 * to snip its fuse (DEFUSED!). Let the spark reach the bomb and it goes BOOM: points lost, the screen shakes and the
 * wall is left sooty. Big banded bombs need two hits; rare golden bombs are worth more. SOLO: defuse everything for
 * 1:30 with three lives. VS COMPUTER: a virtual defuser throws at the orange bombs. 2 PLAYERS: blue vs orange on a
 * shared wall, most bombs defused wins.
 */

enum Mode { Solo, Vs, Two }
enum Step { Count, Play, End }
enum Kind { Normal, Big, Gold }

const GameId = "wallbombs";
const RoundTime = 90;
const Lives = 3;
const Points = [100, 250, 500];
const BoomCost = 100;
const SoloStars = [1500, 3000, 4500];
const CpuGap = [1.35, 0.85, 0.55];
const CpuAim = [0.85, 0.5, 0.28];
const CpuReact = [1.6, 0.9, 0.45];
const Flight = 0.6;
const Colors = [P1Color, P2Color];
const Radius = [1.15, 1.6, 1.0];
const MaxViews = 16;

class Bomb {
  owner = 0; kind = Kind.Normal; pos = V2.zero; r = 1; hits = 1; fuse = 6; left = 6; t = 0; alive = true; born = 0;
  curl = 1; targeted = 0; wobble = 0; flash = 0;
}

interface BombView {
  root: GameObject; glow: SpriteRenderer; body: SpriteRenderer; bands: SpriteRenderer; cap: SpriteRenderer; fuse: LineRenderer;
  spark: SpriteRenderer; sparkCore: SpriteRenderer; pips: TextMesh; bomb: Bomb | null;
}

interface Boom { burst: SpriteRenderer; text: TextMesh; soot: SpriteRenderer; t: number; on: boolean; pos: V2; size: number }

export class WallBombsGame extends ArcadeGame {
  private world!: GameObject;
  private bg!: SpriteRenderer;
  private veil!: SpriteRenderer; private veilA = 0;
  private views: BombView[] = [];
  private booms: Boom[] = [];
  private bombs: Bomb[] = [];
  private fx!: CasualFx;
  private impacts!: Impacts;
  private throws!: Throws;
  private snd!: WallSounds;
  private clips: Record<string, AudioClip> = {};

  private mode = Mode.Solo;
  private diff = 1;
  private step = Step.Count;
  private stepT = 0;
  private lastCount = 0;
  private timeLeft = RoundTime;
  private lives = Lives;
  private score = [0, 0];
  private defused = [0, 0];
  private exploded = [0, 0];
  private hitsN = [0, 0];
  private spawnT = 0;
  private tickT = 0;
  private cpuT = [0, 0];
  private cpuBusy = [false, false];
  private attract = false; private attractAt = 0; private ambient = false;
  private rng = new SysRandom(1);
  private endReason = "";
  private area = { x0: -14, x1: 14, y0: -7, y1: 5.6 };

  private scoreText: Text[] = []; private scoreCap: Text[] = []; private scoreNode: UINode[] = [];
  private timerText!: Text; private lifeIcons: Image[] = [];
  private banner!: BigBanner;
  private attractNode!: Text; private attractSub!: Text;
  private modeBar: ModeBar | null = null;
  private boardUi: TodayBoard | null = null;

  static set TestTimeScale(v: number) { WallTime.scale = v; }
  TestAttractAfter(s: number) { WallTime.attractAfter = s; }

  protected Describe() {
    return new GameInfo({
      Id: GameId,
      Title: "BOMB DEFUSE",
      Tagline: "HIT THE BOMBS BEFORE THE FUSE BURNS DOWN!",
      PlayLabel: "PLAY",
      Accent: P2Color,
      Accent2: Gold,
      BgTop: Pal.hex(0x3a1c4a),
      BgBottom: Pal.hex(0x140a22),
      ShortSide: 18,
      Touch: TouchScheme.None,
      PauseButton: false,
      Music: { bpm: 138, rootHz: 98, degrees: [0, 3, 5, 4], seed: 77, energy: 0.9, major: false },
      HowTo: [
        howTo(BombArt.Body, P1Color, "Bombs with burning fuses pop up all over the wall. Hit one with a ball to DEFUSE it."),
        howTo(BombArt.Snip, Color.white, "Hit bombs of YOUR colour. Too slow and the spark reaches the bomb: BOOM!"),
        howTo(BombArt.Bands, Color.white, "Big banded bombs need TWO hits."),
        howTo(BombArt.Body, Gold, "Rare GOLDEN bombs are worth 500!"),
        howTo(BombArt.Burst, Color.white, "SOLO: 1:30 and three lives. VS COMPUTER and 2 PLAYERS: blue vs orange, most bombs defused wins."),
      ],
      Tips: ["Go for the shortest fuse first.", "Golden bombs burn fast!", "Big bombs: hit twice, quickly."],
    });
  }

  protected get ShortSide() { return ArcadeGame.FitShortSide(new V2(32, 18), 0, 0); }
  private get SelMode(): Mode { return Mathf.clamp(this.Data.get("mode"), 0, 2) as Mode; }
  private get SelDiff() { return Mathf.clamp(this.Data.get("diff", 1), 0, 2); }

  protected BestLine() {
    switch (this.SelMode) {
      case Mode.Solo: return `SOLO BEST  ${Fmt.n(this.Data.get("best"))}  ·  ${this.Data.get("bestDefused")} DEFUSED`;
      case Mode.Vs: { const d = this.SelDiff; return `VS ${DiffNames[d]}:  ${this.Data.get("w" + d)} WON · ${this.Data.get("l" + d)} LOST`; }
      default: return `BLUE  ${this.Data.get("p0")} – ${this.Data.get("p1")}  ORANGE`;
    }
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Data.set("diff", 1); }
    Activity.install();
    (window as unknown as Record<string, unknown>)["__" + GameId] = this;
    CasualLook.calm(this, 1.25, 0.25);
    this.world = new GameObject("Bombs", this.gameObject);
    this.bg = CasualLook.cover(this.world, BombArt.Wall, -900);
    for (let i = 0; i < 10; i++) {
      const soot = Art.spr(this.world, "Soot", BombArt.Soot, new Color(0.05, 0.03, 0.05, 0), 1, -850, Art.Flat);
      const burst = Art.spr(this.world, "Burst", BombArt.Burst, Color.white, 1, 200, Art.Flat);
      const text = new GameObject("BoomText", this.world).addComponent(new TextMesh());
      text.text = ""; text.fontSize = 64; text.characterSize = 0.25; text.color = Ink; text.sortingOrder = 201;
      burst.gameObject.setActive(false); soot.gameObject.setActive(false);
      this.booms.push({ burst, text, soot, t: 99, on: false, pos: V2.zero, size: 1 });
    }
    for (let i = 0; i < MaxViews; i++) this.views.push(this.MakeView(i));
    this.veil = Art.spr(this.world, "Veil", Art.Square, new Color(0.03, 0.01, 0.06, 0), 1, 400, Art.Flat);
    this.fx = CasualFx.create(this.world, 150, 420);
    this.impacts = new Impacts(this.world, this.fx, "bd2");
    this.throws = new Throws(this.world, "bd2");
    this.snd = makeWallSounds("bd2");
    const n = new SysRandom(13);
    const noise = () => n.nextDouble() * 2 - 1;
    let lp = 0;
    this.clips.boom = Sfx.make("bd2-boom", 1.4, (t) => {
      lp += (noise() - lp) * (0.08 + 0.3 * Math.exp(-t * 6));
      return (lp * 2.2 * Math.exp(-t * 2.5) + Sfx.sinP(Sfx.glide(t, 90, 30, 0.8)) * 0.8 * Math.exp(-t * 3)) * Math.min(1, t * 400) * 0.9;
    });
    this.clips.snip = Sfx.make("bd2-snip", 0.22, (t) => { const c = (tt: number) => (tt > 0 && tt < 0.03 ? noise() * Math.exp(-tt * 120) + Sfx.sqrP(3200 * tt) * 0.3 * Math.exp(-tt * 90) : 0); return (c(t) + c(t - 0.09)) * 0.7; });
    this.clips.chime = Sfx.make("bd2-chime", 0.6, (t) => {
      let v = 0;
      [784, 1047, 1568].forEach((f, i) => { const tt = t - i * 0.05; if (tt > 0) v += (Sfx.sinP(f * tt) + 0.25 * Sfx.sinP(f * 2.7 * tt)) * Sfx.env(tt, 0.003, 0.4) * 0.18; });
      return v;
    });
    this.clips.gold = Sfx.make("bd2-gold", 1.0, (t) => {
      let v = 0;
      [1047, 1319, 1568, 2093, 2637].forEach((f, i) => { const tt = t - i * 0.06; if (tt > 0) v += (Sfx.sinP(f * tt) + 0.3 * Sfx.sinP(f * 3 * tt)) * Sfx.env(tt, 0.003, 0.6) * 0.14; });
      return v;
    });
    this.clips.clank = Sfx.make("bd2-clank", 0.3, (t) => (Sfx.sqrP(620 * t) * 0.15 + Sfx.sinP(1870 * t) * 0.2 + Sfx.sinP(2650 * t) * 0.12) * Sfx.env(t, 0.001, 0.28));
    this.clips.tick = Sfx.make("bd2-tick", 0.05, (t) => (Sfx.sqrP(1800 * t) * 0.3 + noise() * 0.2) * Sfx.env(t, 0.0005, 0.04));
    this.clips.pop = Sfx.make("bd2-pop", 0.18, (t) => Sfx.sinP(Sfx.glide(t, 300, 900, 0.1)) * Sfx.env(t, 0.003, 0.16) * 0.3);
    this.BuildHud();
    this.BuildTitle();
    this.Layout();
  }

  private MakeView(i: number): BombView {
    const root = new GameObject("Bomb" + i, this.world);
    const o = 10 + i * 6;
    const glow = Art.spr(root, "Glow", Art.Glow, Color.white, 3.4, o, Art.Additive);
    const fuse = Art.line(root, "Fuse", FuseColor, 0.2, o + 1, false, false, Art.Flat);
    const cap = Art.spr(root, "Cap", BombArt.Cap, Color.white, 0.62, o + 2, Art.Flat);
    const body = Art.spr(root, "Body", BombArt.Body, Color.white, 2, o + 3, Art.Flat);
    const bands = Art.spr(root, "Bands", BombArt.Bands, Color.white, 2, o + 4, Art.Flat);
    const spark = Art.spr(root, "Spark", Art.Glow, Pal.hex(0xffb02e), 1.6, o + 5, Art.Additive);
    const sparkCore = Art.spr(root, "SparkCore", Art.Star, Color.white, 0.55, o + 5, Art.Flat);
    const pips = new GameObject("Pips", root).addComponent(new TextMesh());
    pips.fontSize = 64; pips.characterSize = 0.12; pips.color = Color.white; pips.sortingOrder = o + 5; pips.text = "";
    root.setActive(false);
    return { root, glow, body, bands, cap, fuse, spark, sparkCore, pips, bomb: null };
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    for (let i = 0; i < 2; i++) {
      const node = UIKit.node("Score" + i, hud).place(new V2(i === 0 ? 0 : 1, 1), new V2(i === 0 ? 250 : -250, -95), new V2(400, 150));
      UIKit.img(node, "Bg", Art.UiRound, new Color(0.05, 0.02, 0.1, 0.7)).rectTransform.stretch();
      UIKit.img(node, "Edge", Art.UiOutline, Colors[i].withAlpha(0.9)).rectTransform.stretch();
      const cap = UIKit.at(UIKit.label(node, "", 32, Colors[i]), UIKit.Center, new V2(0, 46), new V2(380, 44));
      const t = UIKit.at(UIKit.label(node, "0", 84, Color.white), UIKit.Center, new V2(0, -16), new V2(380, 96));
      UIKit.glow(t, Ink, 4);
      this.scoreNode.push(node); this.scoreText.push(t); this.scoreCap.push(cap);
    }
    this.timerText = UIKit.at(UIKit.label(hud, "1:30", 110, Color.white), new V2(0.5, 1), new V2(0, -90), new V2(360, 130));
    UIKit.glow(this.timerText, Ink, 6);
    for (let i = 0; i < Lives; i++) {
      const im = UIKit.img(hud, "Life", BombArt.Body, Pal.hex(0xff4a5a));
      im.rectTransform.place(new V2(1, 1), new V2(-130 - i * 105, -95), new V2(92, 92));
      this.lifeIcons.push(im);
    }
    this.banner = new BigBanner(hud);
    this.attractNode = UIKit.at(UIKit.label(hud, "THROW A BALL TO PLAY!", 120, Color.white), new V2(0.5, 0.5), new V2(0, 40), new V2(1900, 160));
    UIKit.glow(this.attractNode, P2Color, 8);
    this.attractSub = UIKit.at(UIKit.label(hud, "BOMB DEFUSE  ·  DEMO", 50, Gold), new V2(0.5, 0.5), new V2(0, -70), new V2(1400, 70));
    UIKit.glow(this.attractSub, Ink, 4);
    this.attractNode.gameObject.setActive(false);
    this.attractSub.gameObject.setActive(false);
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex || !ex.parent) return;
    CasualLook.titleCard(this.UI, new Color(0.08, 0.03, 0.12, 0.9), new V2(1060, 1080), -10);
    this.modeBar = new ModeBar(ex, [P1Color, Gold, P2Color], () => [this.SelMode, this.SelDiff], (m, d) => {
      this.Data.set("mode", m); this.Data.set("diff", d); this.Data.flush();
      Sfx.play(Snd.Click, 0.6);
      this.UI.ShowTitle(this.BestLine(), this.StatsLine());
      this.boardUi?.refresh();
    }, ["1:30 · THREE LIVES", "YOU: BLUE · CPU: ORANGE", "BLUE VS ORANGE"]);
    this.boardUi = new TodayBoard(ex.parent, P2Color, GameId, (s) => Fmt.n(s));
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    const V = this.ViewSize;
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bg, V);
    const W2 = Math.min(V.x, 32) / 2, H2 = Math.min(V.y, 18) / 2;
    this.area = { x0: -W2 + 2.2, x1: W2 - 2.2, y0: -H2 + 1.8, y1: H2 - 3.4 };
    this.veil.transform.localScale = new V3(V.x + 4, V.y + 4, 1);
    this.boardUi?.layout();
    const center = this.UI.TitleExtra?.parent;
    if (center) { const k = V.x < V.y ? 0.9 : 1; center.localScale = new V3(k, k, 1); }
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.StopAttract();
    this.ambient = true;
    this.mode = Mode.Two;
    this.SetupRound(true);
    this.modeBar?.refresh();
    this.boardUi?.refresh();
  }

  protected BeginRun() {
    this.StopAttract();
    this.ambient = false;
    this.mode = this.SelMode;
    this.diff = this.SelDiff;
    this.Data.add("games", 1);
    this.UI.SetPauseButton(false);
    this.SetupRound(false);
    Sfx.setIntensity(0.6);
  }

  private get Duel() { return this.mode !== Mode.Solo; }
  private IsCpu(i: number) { return this.ambient || (this.mode === Mode.Vs && i === 1); }
  private get Quiet() { return this.ambient && !this.attract; }

  private SetupRound(demo: boolean) {
    this.rng = new SysRandom((Math.random() * 1e9) | 0);
    for (const b of this.bombs) b.alive = false;
    this.bombs = [];
    for (const v of this.views) { v.bomb = null; v.root.setActive(false); }
    for (const bm of this.booms) { bm.on = false; bm.t = 99; bm.burst.gameObject.setActive(false); bm.text.text = ""; bm.soot.gameObject.setActive(false); }
    this.impacts.clear(); this.throws.clear(); this.fx.clear();
    this.score = [0, 0]; this.defused = [0, 0]; this.exploded = [0, 0]; this.hitsN = [0, 0];
    this.lives = Lives;
    this.timeLeft = RoundTime;
    this.spawnT = demo ? 0.3 : 0.6;
    this.cpuT = [1, 1.3]; this.cpuBusy = [false, false];
    this.endReason = "";
    this.step = demo ? Step.Play : Step.Count;
    this.stepT = 3.2;
    this.lastCount = 4;
    this.banner.hide();
    WallHits.clear();
    this.Layout();
    this.RefreshHud();
  }

  // ------------------------------------------------------------------ frame

  update() {
    super.update();
    if (Keyboard.letter("r").wasPressedThisFrame && (this.State !== Phase.Title || this.attract)) this.EnterTitle();
  }

  protected TickRun(_dt: number) {
    const dt = WallTime.dt;
    const hits = WallHits.take();
    this.Common(dt);
    this.Simulate(dt, hits);
  }

  protected TickBackground(_dt: number) {
    const dt = WallTime.dt;
    const hits = WallHits.take();
    this.Common(dt);
    if (this.attract) {
      if (hits.length > 0 || Activity.last > this.attractAt) { this.EnterTitle(); return; }
      this.Simulate(dt, []);
      return;
    }
    for (const h of hits) { this.impacts.hit(h.world, Color.white, false); Sfx.playClip(this.snd.thump, 0.6); }
    if (this.State === Phase.Title) this.Simulate(dt * 0.7, []);
    if (Math.min(WallHits.idleSeconds, Activity.idle) > WallTime.attractAfter) this.StartAttract();
  }

  private Common(dt: number) {
    this.banner.update(dt);
    this.impacts.update(dt);
    this.throws.update(dt);
    this.veilA = Mathf.moveTowards(this.veilA, this.State === Phase.Over && !this.attract ? 0.62 : 0, Time.unscaledDeltaTime * 2.5);
    this.veil.color = new Color(0.03, 0.01, 0.06, this.veilA);
    this.AnimateBooms(dt);
    this.RenderBombs(dt);
  }

  private StartAttract() {
    this.attract = true;
    this.attractAt = performance.now();
    this.ambient = true;
    this.mode = Mode.Two;
    this.UI.ShowHud();
    this.UI.SetPauseButton(false);
    this.SetupRound(true);
    this.attractNode.gameObject.setActive(true);
    this.attractSub.gameObject.setActive(true);
    Sfx.playClip(this.snd.whistle, 0.5);
  }

  private StopAttract() {
    if (!this.attract) return;
    this.attract = false;
    this.attractNode.gameObject.setActive(false);
    this.attractSub.gameObject.setActive(false);
  }

  private Simulate(dt: number, hits: WallHit[]) {
    if (this.step === Step.Count) {
      this.stepT -= dt;
      const n = Math.ceil(this.stepT - 0.2);
      if (n !== this.lastCount && n >= 1 && n <= 3) { this.lastCount = n; this.banner.show(String(n), n === 1 ? Gold : Color.white, 0.9); Sfx.playClip(this.snd.beep, 0.9); }
      for (const h of hits) { this.impacts.hit(h.world, Color.white, false, 0.8); Sfx.playClip(this.snd.thump, 0.5); }
      if (this.stepT <= 0.2) {
        this.step = Step.Play;
        this.banner.show("GO!", Pal.Good, 0.9);
        Sfx.playClip(this.snd.whistle, 1);
        Sfx.playClip(this.snd.go, 0.8);
        WallHits.clear();
      }
      this.RefreshHud();
      return;
    }
    if (this.step === Step.End) {
      this.stepT -= dt;
      for (const h of hits) this.impacts.hit(h.world, Color.white, true, 0.8);
      if (this.stepT <= 0) {
        if (this.ambient) this.SetupRound(true);
        else if (this.State === Phase.Playing) this.Result();
      }
      return;
    }
    this.timeLeft -= dt;
    const k = 1 - Mathf.clamp01(this.timeLeft / RoundTime);
    // spawning: more bombs, shorter fuses as the clock runs down
    this.spawnT -= dt;
    const maxAlive = Math.round(Mathf.lerp(this.Duel ? 4 : 2, this.Duel ? 9 : 6, k));
    if (this.spawnT <= 0 && this.bombs.length < maxAlive && this.bombs.length < MaxViews) {
      this.Spawn(k);
      this.spawnT = Mathf.lerp(1.6, 0.65, k) * (this.Duel ? 0.6 : 1) * (0.7 + this.rng.nextDouble() * 0.6);
    }
    for (const h of hits) this.OnWallHit(h.world);
    for (let i = 0; i < 2; i++) if (this.IsCpu(i)) this.TickCpu(i, dt);
    // fuses
    let urgent = 1;
    for (const b of [...this.bombs]) {
      b.t += dt;
      b.left -= dt;
      b.flash = Math.max(0, b.flash - dt * 4);
      urgent = Math.min(urgent, b.left / b.fuse);
      if (b.left <= 0) this.Explode(b);
    }
    // the ticking speeds up as the shortest fuse burns down
    if (this.bombs.length > 0) {
      this.tickT -= dt;
      if (this.tickT <= 0) {
        this.tickT = Mathf.lerp(0.11, 0.55, urgent);
        if (!this.Quiet) Sfx.playClip(this.clips.tick, 0.45 + (1 - urgent) * 0.4, 1 + (1 - urgent) * 0.5);
      }
    }
    if (!this.ambient && this.timeLeft <= 10 && Math.ceil(this.timeLeft) !== this.lastCount) { this.lastCount = Math.ceil(this.timeLeft); if (this.lastCount > 0) Sfx.playClip(this.snd.tick, 0.8, 1.4); }
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.EndRound("TIME!"); }
    this.RefreshHud();
  }

  private Spawn(k: number) {
    const r = this.rng.nextDouble();
    const kind = r < 0.06 + k * 0.03 ? Kind.Gold : r < 0.22 ? Kind.Big : Kind.Normal;
    const rad = Radius[kind];
    const a = this.area;
    let pos: V2 | null = null;
    for (let tries = 0; tries < 30 && !pos; tries++) {
      const p = new V2(Mathf.lerp(a.x0 + rad, a.x1 - rad, this.rng.nextDouble()), Mathf.lerp(a.y0 + rad, a.y1 - rad, this.rng.nextDouble()));
      if (this.bombs.every((b) => V2.distance(b.pos, p) > b.r + rad + 1.4)) pos = p;
    }
    if (!pos) return;
    const b = new Bomb();
    b.kind = kind; b.r = rad; b.pos = pos;
    b.hits = kind === Kind.Big ? 2 : 1;
    // in duels the colours alternate; golden bombs go to either side
    b.owner = this.Duel ? (this.defused[0] + this.defused[1] + this.bombs.length + Math.floor(this.rng.nextDouble() * 2)) % 2 : 0;
    const base = Mathf.lerp(7.5, 4.6, k) * (kind === Kind.Gold ? 0.7 : kind === Kind.Big ? 1.25 : 1);
    b.fuse = b.left = base * (0.85 + this.rng.nextDouble() * 0.3);
    b.curl = this.rng.nextDouble() < 0.5 ? 1 : -1;
    this.bombs.push(b);
    const v = this.views.find((x) => !x.bomb);
    if (v) { v.bomb = b; v.root.setActive(true); }
    if (!this.Quiet) Sfx.playClip(this.clips.pop, 0.5, 0.9 + this.rng.nextDouble() * 0.3);
  }

  /** A ball landed at p: whoever owns the bomb under it gets the hit. */
  private OnWallHit(p: V2, thrower = -1) {
    if (!this.Quiet) Sfx.playClip(this.snd.thump, 0.7, 0.9 + Math.random() * 0.2);
    let best: Bomb | null = null, bd = 1e9;
    for (const b of this.bombs) {
      const d = V2.distance(b.pos, p);
      if (d < b.r * 1.15 && d < bd) { best = b; bd = d; }
    }
    if (!best) { this.impacts.hit(p, thrower >= 0 ? Colors[thrower] : Color.white, true, 1.1); if (!this.Quiet) Sfx.playClip(this.snd.miss, 0.35); return; }
    const b = best;
    // the computer only throws at its own bombs; on the shared wall a ball counts for the bomb's colour
    this.hitsN[b.owner]++;
    this.impacts.hit(p, Colors[b.owner], false, 1.2);
    b.hits--;
    b.flash = 1;
    b.wobble = 1;
    if (b.hits > 0) {
      if (!this.Quiet) { Sfx.playClip(this.clips.clank, 0.9); this.UI.Float(b.pos.add(new V2(0, b.r + 0.6)), "ONE MORE!", Gold, 1.8); }
      this.fx.pop(p, Color.white, 10, 6, 0.3, 0.4);
      return;
    }
    this.Defuse(b);
  }

  private Defuse(b: Bomb) {
    this.Remove(b);
    const pts = Points[b.kind];
    this.score[b.owner] += pts;
    this.defused[b.owner]++;
    const col = b.kind === Kind.Gold ? Gold : Colors[b.owner];
    this.fx.pop(b.pos, col, 24, 9, 0.4, 0.6);
    this.fx.sparkle(b.pos, Color.white, b.kind === Kind.Gold ? 16 : 7, b.r, 0.45);
    // smoke puff where the spark died
    for (let i = 0; i < 8; i++) this.fx.emit(b.pos.add(new V2(0.6, b.r + 0.4)), new V2((Math.random() - 0.5) * 2, 1.5 + Math.random() * 2), new Color(0.8, 0.8, 0.85, 0.6), 0.6, 0.9, CasualArt.Soft, -1, 0, true, 1);
    if (b.kind === Kind.Gold) this.fx.confetti(b.pos, 40, 9, [Gold, Color.white, Colors[b.owner]]);
    if (this.Quiet) return;
    Sfx.playClip(this.clips.snip, 1);
    Sfx.playClip(b.kind === Kind.Gold ? this.clips.gold : this.clips.chime, 0.8);
    this.UI.Float(b.pos.add(new V2(0, 0.6)), "DEFUSED!", col, b.kind === Kind.Gold ? 2.6 : 2.0);
    this.UI.Float(b.pos.add(new V2(0, -0.9)), `+${pts}`, Gold, 1.8);
    this.Fx.kick(0.3);
    if (b.kind === Kind.Gold) { Sfx.playClip(this.snd.cheer, 0.7); this.Fx.shake(0.15); }
  }

  private Explode(b: Bomb) {
    this.Remove(b);
    this.exploded[b.owner]++;
    const boom = this.booms.find((x) => !x.on) ?? this.booms[0];
    Object.assign(boom, { on: true, t: 0, pos: b.pos, size: b.r * 3.4 });
    boom.burst.gameObject.setActive(true);
    boom.soot.gameObject.setActive(true);
    boom.burst.transform.localPosition = new V3(b.pos.x, b.pos.y, 0);
    boom.soot.transform.localPosition = new V3(b.pos.x, b.pos.y, 0);
    boom.soot.transform.localEulerZ = Math.random() * 360;
    boom.text.transform.localPosition = new V3(b.pos.x, b.pos.y, 0);
    boom.text.text = "BOOM!";
    for (let i = 0; i < 40; i++) this.fx.emit(b.pos, V2.fromAngle(Math.random() * 6.283, 4 + Math.random() * 12), i % 3 === 0 ? Pal.hex(0xff4a1f) : i % 3 === 1 ? Gold : new Color(0.2, 0.2, 0.25, 1), 0.5, 0.8, null, 6, 0, true, 2);
    if (this.Duel) this.score[b.owner] = Math.max(0, this.score[b.owner] - BoomCost);
    else if (!this.ambient) this.lives--;
    if (this.Quiet) return;
    Sfx.playClip(this.clips.boom, 1, 0.9 + Math.random() * 0.2);
    this.Fx.shake(0.75);
    this.Fx.kick(0.8, 0.4);
    this.Back.Flash(Pal.hex(0xff7a2f), 0.4);
    this.Hitstop(0.06);
    if (this.Duel) this.UI.Float(b.pos.add(new V2(0, -b.r * 2.3)), `-${BoomCost}`, Pal.Danger, 2);
    if (!this.Duel && !this.ambient && this.lives <= 0) this.EndRound("OUT OF LIVES!");
  }

  private Remove(b: Bomb) {
    b.alive = false;
    this.bombs = this.bombs.filter((x) => x !== b);
    const v = this.views.find((x) => x.bomb === b);
    if (v) { v.bomb = null; v.root.setActive(false); }
  }

  private TickCpu(i: number, dt: number) {
    const lvl = this.ambient ? 1 : this.diff;
    this.cpuT[i] -= dt;
    if (this.cpuT[i] > 0 || this.cpuBusy[i]) return;
    // the most urgent of its own bombs that it has had time to notice
    const mine = this.bombs.filter((b) => b.owner === i && b.t > CpuReact[lvl] * (0.6 + Math.random() * 0.8)).sort((a, b) => a.left - b.left);
    const b = mine[0];
    if (!b) { this.cpuT[i] = 0.25; return; }
    const aim = CpuAim[lvl];
    const to = b.pos.add(new V2(gauss(() => this.rng.nextDouble()) * aim, gauss(() => this.rng.nextDouble()) * aim));
    const V = this.ViewSize;
    const from = new V2((i === 0 ? -1 : 1) * V.x * 0.3 + (this.rng.nextDouble() - 0.5) * 5, -V.y / 2 - 2);
    this.cpuBusy[i] = true;
    this.throws.throwAt(from, to, Colors[i], Flight, (p) => { this.cpuBusy[i] = false; if (this.step === Step.Play) this.OnWallHit(p, i); });
    this.cpuT[i] = CpuGap[lvl] * (0.7 + this.rng.nextDouble() * 0.6);
  }

  private EndRound(reason: string) {
    if (this.step === Step.End) return;
    this.step = Step.End;
    this.stepT = this.Quiet ? 1.2 : 2.4;
    this.endReason = reason;
    this.throws.clear();
    this.cpuBusy = [false, false];
    // the remaining bombs fizzle out
    for (const b of [...this.bombs]) { this.fx.pop(b.pos, new Color(0.7, 0.7, 0.75, 1), 8, 3, 0.4, 0.5); this.Remove(b); }
    if (this.Quiet) return;
    this.banner.show(reason, reason === "TIME!" ? Gold : Pal.Danger, 2.2);
    Sfx.playClip(this.snd.horn, 1);
    Sfx.playClip(this.snd.cheer, 0.6);
  }

  // ------------------------------------------------------------------ visuals

  private RenderBombs(_dt: number) {
    const time = Time.time;
    for (const v of this.views) {
      const b = v.bomb;
      if (!b) continue;
      const frac = Mathf.clamp01(b.left / b.fuse);
      const pop = Ease.outBack(Mathf.clamp01(b.t / 0.3));
      const panic = 1 - frac;
      b.wobble = Math.max(0, b.wobble - Time.deltaTime * 3);
      const shake = (panic > 0.7 ? Math.sin(time * 40 + b.pos.x) * 0.06 * (panic - 0.7) / 0.3 : 0) + Math.sin(time * 30) * 0.12 * b.wobble;
      const breathe = 1 + Math.sin(time * (4 + panic * 14)) * 0.03 * (0.4 + panic);
      const s = b.r * pop * breathe;
      v.root.localPosition = new V3(b.pos.x + shake, b.pos.y, 0);
      v.root.localScale = new V3(s, s, 1);
      v.root.localEulerZ = shake * 40;
      const col = b.kind === Kind.Gold ? Gold : Colors[b.owner];
      const red = panic > 0.65 ? (0.5 + 0.5 * Math.sin(time * 20)) * (panic - 0.65) / 0.35 : 0;
      v.body.color = Color.lerp(Color.lerp(col, Pal.hex(0xff2a3a), red * 0.5), Color.white, b.flash * 0.7);
      v.glow.color = (b.kind === Kind.Gold ? Gold : col).withAlpha(0.35 + 0.2 * Math.sin(time * 6) + red * 0.3);
      v.bands.gameObject.setActive(b.kind === Kind.Big);
      v.bands.color = b.hits < 2 ? new Color(1, 1, 1, 0.35) : Color.white;
      v.pips.text = b.kind === Kind.Big ? (b.hits >= 2 ? "×2" : "×1") : b.kind === Kind.Gold ? "500" : "";
      v.pips.transform.localPosition = new V3(0, -0.05, 0);
      v.pips.color = b.kind === Kind.Gold ? Ink : Color.white;
      // fuse: a curl from the cap at the top-right; the burnt part is gone, the spark rides the end
      const capPos = new V2(0.5, 0.72);
      v.cap.transform.localPosition = new V3(capPos.x, capPos.y, 0);
      v.cap.transform.localEulerZ = -40;
      const pts: V2[] = [];
      const n = 14;
      const curl = b.curl;
      const path = (t: number) => {
        const a = t * 2.2;
        return capPos.add(new V2(0.22, 0.2)).add(new V2(Math.sin(a) * 0.55 * curl + t * 0.35 * curl, (1 - Math.cos(a)) * 0.38 + t * 0.95));
      };
      const shown = 0.08 + 0.92 * frac;
      for (let i = 0; i <= n; i++) pts.push(path((i / n) * shown));
      v.fuse.positionCount = pts.length;
      v.fuse.setPositions(pts);
      v.fuse.widthMultiplier = 0.2 * s;
      const tip = pts[pts.length - 1];
      v.spark.transform.localPosition = new V3(tip.x, tip.y, 0);
      v.sparkCore.transform.localPosition = new V3(tip.x, tip.y, 0);
      const flick = 0.8 + 0.4 * Math.random();
      v.spark.transform.localScale = new V3(0.9 * flick, 0.9 * flick, 1);
      v.sparkCore.transform.localScale = new V3(0.42 * flick, 0.42 * flick, 1);
      v.sparkCore.transform.localEulerZ = time * 900;
      if (Math.random() < 0.5) {
        const wp = b.pos.add(tip.mul(s));
        this.fx.emit(wp, V2.fromAngle(Math.random() * 6.283, 2 + Math.random() * 3), Math.random() < 0.5 ? Gold : Color.white, 0.12, 0.3, null, 4, 0, true, 2);
      }
    }
  }

  private AnimateBooms(dt: number) {
    for (const bm of this.booms) {
      if (!bm.on) continue;
      bm.t += dt;
      const k = bm.t;
      if (k < 1.0) {
        const s = bm.size * (k < 0.12 ? Mathf.lerp(0.3, 1.25, k / 0.12) : Mathf.lerp(1.25, 1.1, (k - 0.12) / 0.88));
        bm.burst.transform.localScale = new V3(s, s, 1);
        bm.burst.transform.localEulerZ = k * 30;
        bm.burst.color = Color.white.withAlpha(k > 0.75 ? (1 - k) / 0.25 : 1);
        bm.text.characterSize = (bm.size * 0.4 * 10 / 64) * (k < 0.12 ? k / 0.12 : 1);
        bm.text.color = Ink.withAlpha(k > 0.75 ? (1 - k) / 0.25 : 1);
      } else {
        bm.burst.gameObject.setActive(false);
        bm.text.text = "";
      }
      const sa = k < 0.15 ? k / 0.15 : k > 3.5 ? Math.max(0, 1 - (k - 3.5) / 1.5) : 1;
      bm.soot.color = new Color(0.06, 0.03, 0.06, 0.85 * sa);
      const ss = bm.size * 1.15;
      bm.soot.transform.localScale = new V3(ss, ss, 1);
      if (k > 5) { bm.on = false; bm.soot.gameObject.setActive(false); }
    }
  }

  private Name(i: number) { return this.mode === Mode.Vs ? (i === 0 ? "YOU" : "CPU") : this.Duel ? (i === 0 ? "BLUE" : "ORANGE") : "SCORE"; }

  private Who(i: number) { const n = this.Name(i); return n === "YOU" ? "YOUR" : n; }

  private RefreshHud() {
    const duel = this.Duel;
    for (let i = 0; i < 2; i++) {
      this.scoreNode[i].setActive(i === 0 || duel);
      setText(this.scoreCap[i], duel ? `${this.Name(i)} · ${this.defused[i]} DEFUSED` : `SCORE · ${this.defused[0]} DEFUSED`);
      setText(this.scoreText[i], Fmt.n(this.score[i]));
    }
    this.lifeIcons.forEach((im, k) => { im.gameObject.setActive(!duel); im.color = k < this.lives ? Pal.hex(0xff4a5a) : new Color(1, 1, 1, 0.15); });
    setText(this.timerText, Fmt.clock(Math.ceil(this.step === Step.Count ? RoundTime : this.timeLeft)));
    this.timerText.color = this.step === Step.Play && this.timeLeft <= 10 ? Color.lerp(Pal.Danger, Color.white, 0.5 + 0.5 * Math.sin(Time.time * 12)) : Color.white;
  }

  // ------------------------------------------------------------------ results

  private Result() {
    this.Data.add("rounds", 1);
    if (this.mode === Mode.Solo) {
      const sc = this.score[0];
      const stars = sc >= SoloStars[2] ? 3 : sc >= SoloStars[1] ? 2 : sc >= SoloStars[0] ? 1 : 0;
      const newBest = sc > this.Data.get("best");
      this.Data.max("best", sc);
      this.Data.max("bestDefused", this.defused[0]);
      const rank = WallBoard.add(GameId, sc, "SOLO");
      this.Data.flush();
      this.Finish(new Result({
        Headline: `${this.defused[0]} BOMBS DEFUSED!`,
        HeadlineColor: Gold,
        Stars: stars,
        NewBest: newBest && sc > 0,
        BestLine: `${this.endReason}   ·   SCORE ${Fmt.n(sc)}${rank > 0 ? `   ·   #${rank} TODAY` : ""}`,
        Stats: [["SCORE", Fmt.n(sc)], ["DEFUSED", String(this.defused[0])], ["BOOMS", String(this.exploded[0])], ["TODAY", rank > 0 ? `#${rank}` : "—"]],
        Primary: "PLAY AGAIN",
        Victory: stars > 0,
      }));
      return;
    }
    const [a, b] = this.defused;
    const winner = a !== b ? (a > b ? 0 : 1) : this.score[0] !== this.score[1] ? (this.score[0] > this.score[1] ? 0 : 1) : -1;
    let head: string, rank = 0;
    if (this.mode === Mode.Vs) {
      if (winner === 0) this.Data.add("w" + this.diff, 1); else if (winner === 1) this.Data.add("l" + this.diff, 1);
      head = winner < 0 ? "DRAW!" : winner === 0 ? "YOU WIN!" : "CPU WINS!";
      rank = WallBoard.add(GameId, this.score[0], "VS CPU");
    } else {
      if (winner >= 0) this.Data.add("p" + winner, 1);
      head = winner < 0 ? "DRAW!" : `${winner === 0 ? "BLUE" : "ORANGE"} WINS!`;
      if (winner >= 0) rank = WallBoard.add(GameId, this.score[winner], `P${winner + 1}`);
    }
    this.Data.flush();
    const ws = winner >= 0 ? this.score[winner] : 0;
    const stars = winner < 0 || (this.mode === Mode.Vs && winner !== 0) ? 0 : this.mode === Mode.Vs ? this.diff + 1 : ws >= SoloStars[2] ? 3 : ws >= SoloStars[1] ? 2 : 1;
    this.Finish(new Result({
      Headline: head,
      HeadlineColor: winner < 0 ? Color.white : Colors[winner],
      Stars: stars,
      BestLine: `DEFUSED ${a} – ${b}${rank > 0 ? `   ·   #${rank} TODAY` : ""}`,
      Stats: [[`${this.Who(0)} DEFUSED`, String(a)], [`${this.Name(1)} DEFUSED`, String(b)], [`${this.Who(0)} SCORE`, Fmt.n(this.score[0])], [`${this.Name(1)} SCORE`, Fmt.n(this.score[1])]],
      Primary: this.mode === Mode.Vs ? "REMATCH" : "PLAY AGAIN",
      Victory: winner >= 0,
    }));
  }

  // ------------------------------------------------------------------ test hooks

  get TestState() {
    return {
      step: this.step, mode: this.mode, attract: this.attract, timeLeft: this.timeLeft, lives: this.lives, score: [...this.score], defused: [...this.defused], exploded: [...this.exploded],
      bombs: this.bombs.map((b) => { const V = this.ViewSize; return { owner: b.owner, kind: b.kind, hits: b.hits, left: b.left, u: (b.pos.x + V.x / 2) / V.x, v: (b.pos.y + V.y / 2) / V.y }; }),
    };
  }
  TestHit(u: number, v: number) { WallHits.simulate(u, v); }
  TestSkip(s: number) { this.timeLeft = Math.min(this.timeLeft, s); }
  /** Burns every fuse down to s seconds (test explosions). */
  TestBurn(s: number) { for (const b of this.bombs) b.left = Math.min(b.left, s); }
}
