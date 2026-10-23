import {
  ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Fmt, GameInfo, GameObject, howTo, Keyboard, Mathf, Pal, Phase,
  Result, Sfx, Snd, SpriteRenderer, Text, Time, TouchScheme, UIKit, V2, V3, WallBoard, WallHit, WallHits,
} from "../../kit";
import { Activity, BigBanner, DiffNames, Impacts, makeWallSounds, ModeBar, setText, gauss, Throws, TodayBoard, WallSounds, WallTime } from "./WallCommon";
import { ConsoleView } from "./ConsoleView";
import { aimFor, classify, HitAction, Kind, Rng, Well } from "./Stack";
import { Stacker } from "./Stacker";
import { Gold, Ink, P1Color, P2Color, WallBlocksArt } from "./WallBlocksArt";

/**
 * BLOCK DROP WALL: the pocket brick game, played by throwing balls at a projected wall. Each player has a brick
 * console on their half of the wall. Hit the SIDE of the falling piece to nudge it one column away from the hit,
 * its TOP to rotate it, and the empty well UNDER it to slam it down. Full rows clear; clearing two or more at once
 * pushes junk rows into the rival's well. SOLO: clear as many lines as you can in 2:00 before the stack reaches the
 * top. VS COMPUTER: a virtual stacker throws at its own console (easy / medium / hard). 2 PLAYERS: split wall.
 */

enum Mode { Solo, Vs, Two }
enum Step { Count, Play, End }

const RoundTime = 120;
const GameId = "wallblocks";
const SoloStars = [3, 8, 14];
/** Seconds per row from the start to the end of a round (slow enough to throw at). */
const GravityStart = 1.0, GravityEnd = 0.55;
const BotGap = [1.1, 0.9, 0.6];
const BotAim = [0.55, 0.38, 0.2];
const Flight = 0.6;
const ClearWords = ["", "LINE!", "DOUBLE!", "TRIPLE!", "QUAD!"];

interface Seat { well: Well; view: ConsoleView; bot: Stacker | null; botT: number; inFlight: number; color: Color; tag: string; human: boolean }

export class WallBlocksGame extends ArcadeGame {
  private world!: GameObject;
  private bg!: SpriteRenderer;
  private veil!: SpriteRenderer;
  private veilA = 0;
  private floaters: { sr: SpriteRenderer; x: number; y: number; s: number; v: number; r: number }[] = [];
  private fx!: CasualFx;
  private impacts!: Impacts;
  private throws!: Throws;
  private seats: Seat[] = [];
  private snd!: WallSounds;
  private clips: Record<string, AudioClip> = {};

  private mode = Mode.Solo;
  private diff = 1;
  private step = Step.Count;
  private stepT = 0;
  private timeLeft = RoundTime;
  private lastCount = 0;
  private endReason = "";
  private loser = -1;
  private attract = false;
  private attractAt = 0;
  private ambient = false;
  private rng = new Rng(1);

  private timerText!: Text; private timerSub!: Text; private banner!: BigBanner;
  private attractNode!: Text; private attractSub!: Text;
  private soloSide!: Text; private soloSideSub!: Text;
  private modeBar: ModeBar | null = null;
  private board: TodayBoard | null = null;

  /** Test hook: slows game time on the slow headless machine (the game itself always runs at 1). */
  static set TestTimeScale(v: number) { WallTime.scale = v; }
  /** Test hook: seconds without hits before the attract demo (40 at events). */
  TestAttractAfter(s: number) { WallTime.attractAfter = s; }

  protected Describe() {
    return new GameInfo({
      Id: GameId,
      Title: "BLOCK DROP WALL",
      Tagline: "THROW TO STEER THE FALLING BRICKS!",
      PlayLabel: "PLAY",
      Accent: P1Color,
      Accent2: Gold,
      BgTop: Pal.hex(0x3b1d8f),
      BgBottom: Pal.hex(0x12082e),
      ShortSide: 18,
      Touch: TouchScheme.None,
      PauseButton: false,
      Music: { bpm: 128, rootHz: 110, degrees: [0, 5, 3, 4], seed: 41, energy: 0.8, major: false },
      HowTo: [
        howTo(WallBlocksArt.Push, Color.white, "Hit the SIDE of the falling piece: it moves one column AWAY from your ball."),
        howTo(WallBlocksArt.Turn, Color.white, "Hit the TOP of the piece to ROTATE it."),
        howTo(WallBlocksArt.Slam, Color.white, "Hit the empty well UNDER the piece to SLAM it down."),
        howTo(WallBlocksArt.Brick, Gold, "Fill a whole row to clear it. Two or more rows at once push JUNK rows into your rival's well."),
        howTo(Art.Star, Gold, "SOLO: clear as many lines as you can in 2:00 before the bricks reach the top."),
        howTo(Art.Ring, P2Color, "VS COMPUTER or 2 PLAYERS: player 1 throws at the LEFT console, player 2 at the RIGHT."),
      ],
      Tips: ["Aim beside the piece, not at it: the side you hit pushes it away.", "Slam when the ghost sits where you want it.", "Two lines at once sends junk to your rival!"],
    });
  }

  protected get ShortSide() { return ArcadeGame.FitShortSide(new V2(32, 18), 0, 0); }

  private get SelMode(): Mode { return Mathf.clamp(this.Data.get("mode"), 0, 2) as Mode; }
  private get SelDiff() { return Mathf.clamp(this.Data.get("diff", 1), 0, 2); }

  protected BestLine() {
    switch (this.SelMode) {
      case Mode.Solo: return `SOLO BEST  ${Fmt.n(this.Data.get("best"))}  ·  ${this.Data.get("bestLines")} LINES`;
      case Mode.Vs: { const d = this.SelDiff; return `VS ${DiffNames[d]}:  ${this.Data.get("w" + d)} WON · ${this.Data.get("l" + d)} LOST`; }
      default: return `PLAYER 1  ${this.Data.get("p0")} – ${this.Data.get("p1")}  PLAYER 2`;
    }
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Data.set("diff", 1); }
    Activity.install();
    (window as unknown as Record<string, unknown>)["__" + GameId] = this;
    CasualLook.calm(this, 1.3, 0.2);
    this.world = new GameObject("WallBlocks", this.gameObject);
    this.bg = CasualLook.cover(this.world, WallBlocksArt.Backdrop, -900);
    for (let i = 0; i < 14; i++) {
      const sr = Art.spr(this.world, "Float", WallBlocksArt.Brick, Color.white.withAlpha(0.05 + (i % 3) * 0.02), 1, -880 + i, Art.Flat);
      this.floaters.push({ sr, x: ((i * 0.37) % 1) * 34 - 17, y: ((i * 0.61) % 1) * 20 - 10, s: 1.2 + (i % 4) * 0.9, v: 0.25 + (i % 5) * 0.12, r: (i * 37) % 360 });
    }
    this.veil = Art.spr(this.world, "Veil", Art.Square, new Color(0.03, 0.01, 0.08, 0), 1, 400, Art.Flat);
    this.fx = CasualFx.create(this.world, 70, 360);
    this.impacts = new Impacts(this.world, this.fx, "wb");
    this.throws = new Throws(this.world, "wb");
    const logo = "BRICK WALL";
    this.seats = [P1Color, P2Color].map((c, i) => ({
      well: new Well(1 + i), view: new ConsoleView(this.world, c, i === 0 ? "P1" : "P2", logo), bot: null, botT: 0, inFlight: 0, color: c, tag: i === 0 ? "P1" : "P2", human: true,
    }));
    this.seats.forEach((s, i) => this.Hook(s, i));
    this.snd = makeWallSounds("wb");
    this.clips.nudge = Sfx.make("wb-nudge", 0.12, (t) => Sfx.sqrP(Sfx.glide(t, 520, 760, 0.06) * t) * Sfx.env(t, 0.002, 0.1) * 0.22);
    this.clips.turn = Sfx.make("wb-turn", 0.16, (t) => Sfx.triP(Sfx.glide(t, 600, 1300, 0.14)) * Sfx.env(t, 0.003, 0.14) * 0.35);
    this.clips.slam = Sfx.make("wb-slam", 0.4, (t) => (Sfx.sinP(Sfx.glide(t, 120, 40, 0.3)) * 0.8 + Sfx.sqrP(Sfx.glide(t, 300, 80, 0.12)) * 0.15 * Sfx.env(t, 0.001, 0.1)) * Sfx.env(t, 0.002, 0.38) * 0.8);
    this.clips.lock = Sfx.make("wb-lock", 0.1, (t) => Sfx.sqrP(220 * t) * Sfx.env(t, 0.001, 0.08) * 0.18);
    this.clips.clear = Sfx.make("wb-clear", 0.7, (t) => {
      let v = 0;
      [523, 659, 784, 1047].forEach((f, i) => { const tt = t - i * 0.07; if (tt > 0) v += (Sfx.sqrP(f * tt) * 0.12 + Sfx.sinP(f * tt) * 0.2) * Sfx.env(tt, 0.003, 0.35); });
      return v;
    });
    this.clips.junk = Sfx.make("wb-junk", 0.5, (t) => (Sfx.sawP(Sfx.glide(t, 90, 60, 0.4) * t) * 0.3 + Sfx.sqrP(45 * t) * 0.15) * Sfx.env(t, 0.005, 0.45) * 0.7);
    this.clips.top = Sfx.make("wb-top", 1.1, (t) => (Sfx.sqrP(Sfx.glide(t, 440, 110, 1.0) * t) * 0.18 + Sfx.triP(Sfx.glide(t, 220, 55, 1.0)) * 0.3) * Sfx.env(t, 0.01, 1.05));
    this.BuildHud();
    this.BuildTitle();
    this.Layout();
  }

  private Hook(s: Seat, i: number) {
    const w = s.well;
    w.onLock = () => { s.view.kick(0.25); if (!this.Quiet) Sfx.playClip(this.clips.lock, 0.5); };
    w.onClear = (r) => {
      const other = this.seats[1 - i];
      const duel = this.mode !== Mode.Solo || this.ambient;
      const rowY = r.rows.reduce((a, b) => a + b, 0) / r.rows.length + 0.5;
      const wp = s.view.toWorld(4, Math.min(rowY, 13));
      for (let k = 0; k < 18 + r.lines * 8; k++) this.fx.emit(s.view.toWorld(Math.random() * 8, r.rows[k % r.rows.length] + 0.5), new V2((Math.random() - 0.5) * 12, Math.random() * 9), k % 3 === 0 ? Gold : k % 3 === 1 ? s.color : Color.white, 0.32, 0.9, CasualArt.Dot, 14);
      if (this.Quiet) return;
      Sfx.playClip(this.clips.clear, 0.8, 1 + (r.lines - 1) * 0.12);
      this.UI.Float(wp, `+${r.points}`, Gold, 2.2);
      if (r.lines >= 2) {
        this.UI.Float(wp.add(new V2(0, 2)), ClearWords[Math.min(4, r.lines)], s.color, 2.6);
        this.Fx.shake(0.25 + r.lines * 0.08);
        Sfx.playClip(this.snd.cheer, 0.55);
      }
      if (duel && r.junk > 0 && !other.well.over) {
        other.well.receive(r.junk);
        this.UI.Float(other.view.toWorld(4, 2), `JUNK +${r.junk}!`, Pal.Danger, 2.2);
        Sfx.playClip(this.clips.junk, 0.7);
      }
    };
    w.onJunk = () => { s.view.shake(0.4); if (!this.Quiet) { Sfx.playClip(this.clips.junk, 0.6, 0.8); this.Fx.shake(0.2); } };
    w.onSpawn = () => { s.bot?.think(w); };
    w.onOver = () => this.OnTopOut(i);
  }

  /** Title ambience plays silently. */
  private get Quiet() { return this.ambient && !this.attract; }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.timerText = UIKit.at(UIKit.label(hud, "2:00", 104, Color.white), new V2(0.5, 1), new V2(0, -95), new V2(320, 120));
    UIKit.glow(this.timerText, Ink, 6);
    this.timerSub = UIKit.at(UIKit.label(hud, "VS", 54, Gold), new V2(0.5, 1), new V2(0, -190), new V2(300, 70));
    UIKit.glow(this.timerSub, Ink, 5);
    this.soloSide = UIKit.at(UIKit.label(hud, "", 120, Color.white), new V2(0.5, 0.5), new V2(-720, 60), new V2(420, 150));
    UIKit.glow(this.soloSide, Ink, 6);
    this.soloSideSub = UIKit.at(UIKit.label(hud, "TIME LEFT", 44, Gold), new V2(0.5, 0.5), new V2(-720, -40), new V2(420, 60));
    UIKit.glow(this.soloSideSub, Ink, 4);
    this.banner = new BigBanner(hud);
    this.attractNode = UIKit.at(UIKit.label(hud, "THROW A BALL TO PLAY!", 120, Color.white), new V2(0.5, 0.5), new V2(0, 40), new V2(1900, 160));
    UIKit.glow(this.attractNode, P2Color, 8);
    this.attractSub = UIKit.at(UIKit.label(hud, "BLOCK DROP WALL  ·  DEMO", 50, Gold), new V2(0.5, 0.5), new V2(0, -70), new V2(1400, 70));
    UIKit.glow(this.attractSub, Ink, 4);
    this.attractNode.gameObject.setActive(false);
    this.attractSub.gameObject.setActive(false);
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex || !ex.parent) return;
    CasualLook.titleCard(this.UI, new Color(0.07, 0.03, 0.18, 0.9), new V2(1060, 1080), -10);
    this.modeBar = new ModeBar(ex, [P1Color, Pal.Warn, P2Color], () => [this.SelMode, this.SelDiff], (m, d) => {
      this.Data.set("mode", m); this.Data.set("diff", d); this.Data.flush();
      Sfx.play(Snd.Click, 0.6);
      this.UI.ShowTitle(this.BestLine(), this.StatsLine());
      this.board?.refresh();
    }, ["ONE WELL · 2:00", "LEFT: YOU · RIGHT: CPU", "LEFT: P1 · RIGHT: P2"]);
    this.board = new TodayBoard(ex.parent, P1Color, GameId);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    const V = this.ViewSize;
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bg, V);
    const duel = this.mode !== Mode.Solo || this.ambient;
    const size = ConsoleView.Size;
    const W2 = Math.min(V.x, 32) / 2, H2 = Math.min(V.y, 18) / 2;
    if (duel) {
      const gap = 2.3;
      const c = Math.min((W2 - gap - 0.55) / size.x, (H2 * 2 - 1.1) / size.y);
      const cx = gap + (size.x * c) / 2;
      this.seats[0].view.place(new V2(-cx, -ConsoleView.CenterOffset * c), c);
      this.seats[1].view.place(new V2(cx, -ConsoleView.CenterOffset * c), c);
    } else {
      const c = Math.min((H2 * 2 - 1.1) / size.y, (W2 * 2 - 1.2) / size.x);
      this.seats[0].view.place(new V2(0, -ConsoleView.CenterOffset * c), c);
    }
    this.seats[1].view.setVisible(duel);
    this.board?.layout();
    // portrait screens: the long title needs a little room
    const center = this.UI.TitleExtra?.parent;
    if (center) { const k = V.x < V.y ? 0.88 : 1; center.localScale = new V3(k, k, 1); }
    this.LayoutHud();
  }

  private LayoutHud() {
    const duel = this.mode !== Mode.Solo || this.attract;
    this.timerText.gameObject.setActive(duel);
    this.timerSub.gameObject.setActive(duel);
    this.soloSide.gameObject.setActive(!duel);
    this.soloSideSub.gameObject.setActive(!duel);
    // solo: the clock stands left of the console
    const c = this.seats[0].view.cell, left = this.seats[0].view.center.x - (ConsoleView.Size.x * c) / 2;
    const hudX = this.UI.WorldToHud(new V2((left - this.ViewSize.x / 2) / 2, 0)).x;
    this.soloSide.rectTransform.anchoredPosition = new V2(hudX, 60);
    this.soloSideSub.rectTransform.anchoredPosition = new V2(hudX, -45);
  }

  private get Duel() { return this.mode !== Mode.Solo; }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.StopAttract(false);
    this.ambient = true;
    this.SetupRound(true);
    this.modeBar?.refresh();
    this.board?.refresh();
  }

  protected BeginRun() {
    this.StopAttract(false);
    this.ambient = false;
    this.mode = this.SelMode;
    this.diff = this.SelDiff;
    this.Data.add("games", 1);
    this.UI.SetPauseButton(false);
    this.SetupRound(false);
    Sfx.setIntensity(0.5);
  }

  /** Resets the wells for a round (title ambience / attract demo when demo = true). */
  private SetupRound(demo: boolean) {
    const seed = (Math.random() * 1e9) | 0;
    this.rng = new Rng(seed);
    this.impacts.clear();
    this.throws.clear();
    this.fx.clear();
    this.Layout();
    const duel = this.mode !== Mode.Solo || demo;
    this.seats.forEach((s, i) => {
      s.well.gravity = GravityStart;
      s.well.reset(seed);
      s.view.resetCounters();
      s.view.setDead("");
      s.inFlight = 0;
      s.botT = 1 + i * 0.4;
      const bot = demo ? true : this.mode === Mode.Vs && i === 1;
      s.human = !bot;
      s.bot = bot ? new Stacker(demo ? 1 : this.diff, () => this.rng.next()) : null;
      s.bot?.think(s.well);
      s.view.setTag(demo ? (i === 0 ? "CPU" : "CPU") : bot ? "CPU" : i === 0 ? "P1" : "P2");
      s.view.hints = !demo || this.attract;
      if (i === 1 && !duel) s.well.over = true;
    });
    this.timeLeft = RoundTime;
    this.endReason = "";
    this.loser = -1;
    this.step = demo ? Step.Play : Step.Count;
    this.stepT = demo ? 0 : 3.2;
    this.lastCount = 4;
    this.banner.hide();
    WallHits.clear();
    this.LayoutHud();
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  update() {
    super.update();
    if (Keyboard.letter("r").wasPressedThisFrame && (this.State !== Phase.Title || this.attract)) this.EnterTitle();
  }

  protected TickRun(_dt: number) {
    const dt = WallTime.dt;
    const hits = WallHits.take();
    this.Ambient(dt);
    this.banner.update(dt);
    this.impacts.update(dt);
    this.throws.update(dt);
    this.Simulate(dt, hits, false);
  }

  protected TickBackground(_dt: number) {
    const dt = WallTime.dt;
    const hits = WallHits.take();
    this.Ambient(dt);
    this.banner.update(dt);
    this.impacts.update(dt);
    this.throws.update(dt);
    if (this.attract) {
      if (hits.length > 0 || Activity.last > this.attractAt) { for (const h of hits) this.impacts.hit(h.world, Color.white, false); this.EnterTitle(); return; }
      this.Simulate(dt, [], true);
      return;
    }
    // a ball on the title or result screen still shows where it landed
    for (const h of hits) { this.impacts.hit(h.world, h.side === 0 ? P1Color : P2Color, false); Sfx.playClip(this.snd.thump, 0.6); }
    if (this.State === Phase.Title) this.Simulate(dt * 0.8, [], true);
    if (Math.min(WallHits.idleSeconds, Activity.idle) > WallTime.attractAfter) this.StartAttract();
  }

  private Ambient(dt: number) {
    const V = this.ViewSize;
    // the result screen sits on a darkened wall so the numbers pop
    this.veilA = Mathf.moveTowards(this.veilA, this.State === Phase.Over && !this.attract ? 0.62 : 0, Time.unscaledDeltaTime * 2.5);
    this.veil.color = new Color(0.03, 0.01, 0.08, this.veilA);
    this.veil.transform.localScale = new V3(V.x + 4, V.y + 4, 1);
    for (const f of this.floaters) {
      f.y += f.v * dt;
      f.r += dt * 8 * f.v;
      if (f.y > V.y / 2 + 2) { f.y = -V.y / 2 - 2; f.x = (Math.random() - 0.5) * V.x; }
      f.sr.transform.localPosition = new V3(f.x, f.y, 0);
      f.sr.transform.localScale = new V3(f.s, f.s, 1);
      f.sr.transform.localEulerZ = f.r;
    }
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

  private StopAttract(show: boolean) {
    if (!this.attract) return;
    this.attract = false;
    this.attractNode.gameObject.setActive(false);
    this.attractSub.gameObject.setActive(false);
    if (show) this.EnterTitle();
  }

  /** One frame of a round: countdown, hits, bots, wells and the clock. demo: title ambience / attract. */
  private Simulate(dt: number, hits: WallHit[], demo: boolean) {
    const duel = this.mode !== Mode.Solo || demo;
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
      this.Render(dt);
      this.UpdateHud();
      return;
    }
    if (this.step === Step.End) {
      this.stepT -= dt;
      for (const h of hits) this.impacts.hit(h.world, Color.white, true, 0.8);
      this.Render(dt);
      if (this.stepT <= 0 && !demo) this.EndRound();
      if (this.stepT <= 0 && demo) this.SetupRound(true);
      return;
    }
    // play
    this.timeLeft -= dt;
    const k = 1 - Mathf.clamp01(this.timeLeft / RoundTime);
    for (const s of this.seats) s.well.gravity = Mathf.lerp(GravityStart, GravityEnd, k);
    for (const h of hits) this.OnWallHit(h);
    this.seats.forEach((s, i) => {
      if (i === 1 && !duel) return;
      if (s.bot) this.TickBot(s, i, dt);
      s.well.tick(dt);
    });
    if (!demo && this.timeLeft <= 10 && Math.ceil(this.timeLeft) !== this.lastCount) {
      this.lastCount = Math.ceil(this.timeLeft);
      if (this.lastCount > 0) Sfx.playClip(this.snd.tick, 0.9, this.lastCount <= 3 ? 1.5 : 1);
    }
    if (this.timeLeft <= 0) this.BeginEnd("TIME!", -1);
    this.Render(dt);
    this.UpdateHud();
  }

  private Render(dt: number) {
    const duel = this.mode !== Mode.Solo || this.ambient;
    this.seats.forEach((s, i) => { if (i === 0 || duel) s.view.render(s.well, dt); });
  }

  private OnWallHit(h: WallHit) {
    const owner = this.Duel ? h.side : 0;
    const s = this.seats[owner];
    if (!s.human) {
      // a ball on the computer's half: show it, nothing else
      this.impacts.hit(h.world, Color.white, true, 0.9);
      Sfx.playClip(this.snd.miss, 0.5);
      return;
    }
    this.ApplyHit(owner, h.world);
  }

  /** A ball (real or the computer's) landed at a world point on player i's console. */
  private ApplyHit(i: number, world: V2) {
    const s = this.seats[i];
    const w = s.well;
    Sfx.playClip(this.snd.thump, this.Quiet ? 0 : 0.8, 0.9 + Math.random() * 0.2);
    if (this.Quiet) { /* silent ambience */ }
    const p = w.active;
    if (!p || w.busy || this.step !== Step.Play) { this.impacts.hit(world, s.color, true); return; }
    const [fx, fy] = s.view.toCell(world);
    const a = classify(p, fx, fy);
    let ok = false;
    switch (a) {
      case HitAction.Left: ok = w.nudge(-1); if (ok && !this.Quiet) Sfx.playClip(this.clips.nudge, 0.8, 0.9); break;
      case HitAction.Right: ok = w.nudge(1); if (ok && !this.Quiet) Sfx.playClip(this.clips.nudge, 0.8, 1.1); break;
      case HitAction.Rotate: ok = w.rotate(); if (ok && !this.Quiet) Sfx.playClip(this.clips.turn, 0.8); break;
      case HitAction.Slam: {
        const n = w.slam();
        ok = n >= 0;
        if (ok) {
          s.view.kick(0.9);
          if (!this.Quiet) { Sfx.playClip(this.clips.slam, 0.9); this.Fx.shake(0.12); }
        }
        break;
      }
      default: break;
    }
    this.impacts.hit(world, s.color, !ok);
    if (ok) this.fx.pop(world, s.color, 10, 6, 0.3, 0.4);
    else if (!this.Quiet) Sfx.playClip(this.snd.miss, 0.4);
  }

  private TickBot(s: Seat, i: number, dt: number) {
    const w = s.well;
    s.botT -= dt;
    if (s.botT > 0 || s.inFlight > 0 || w.busy || !s.bot || !w.active) return;
    const lvl = s.bot.level;
    let a = s.bot.next(w);
    if (a === HitAction.Slam && lvl === 0 && this.rng.next() < 0.3) { s.botT = 0.6; return; }
    if (a === HitAction.Miss) { s.bot.think(w, false); a = s.bot.next(w); if (a === HitAction.Miss) return; }
    const p = w.active;
    let [fx, fy] = aimFor(p, a);
    // lead the falling piece by the flight time
    if (a !== HitAction.Slam) fy -= Flight / w.gravity;
    fx += gauss(() => this.rng.next()) * BotAim[lvl];
    fy += gauss(() => this.rng.next()) * BotAim[lvl];
    const to = s.view.toWorld(fx, fy);
    const V = this.ViewSize;
    const from = new V2(s.view.center.x + (i === 0 ? -3 : 3) + (this.rng.next() - 0.5) * 4, -V.y / 2 - 2);
    s.inFlight++;
    this.throws.throwAt(from, to, s.color, Flight, (pt) => {
      s.inFlight--;
      this.ApplyHit(i, pt);
      // re-plan after every landing (a blocked nudge or a stray ball changes things)
      if (w.active) s.bot?.think(w, false);
    });
    s.botT = BotGap[lvl] * (0.75 + this.rng.next() * 0.5);
  }

  private OnTopOut(i: number) {
    const s = this.seats[i];
    s.view.setDead("STACK\nFULL!");
    if (!this.Quiet) { Sfx.playClip(this.clips.top, 0.9); this.Fx.shake(0.4); }
    if (this.step !== Step.Play) return;
    if (this.ambient && !this.attract) { this.stepT = 1.5; this.step = Step.End; return; }
    this.BeginEnd(this.mode === Mode.Solo ? "STACK FULL!" : `${this.Name(i)} TOPPED OUT!`, i);
  }

  private BeginEnd(reason: string, loser: number) {
    if (this.step === Step.End) return;
    this.step = Step.End;
    this.stepT = 2.4;
    this.endReason = reason;
    this.loser = loser;
    this.throws.clear();
    if (this.Quiet) return;
    this.banner.show(loser < 0 ? "TIME!" : "TOP OUT!", loser < 0 ? Gold : Pal.Danger, 2.2, loser < 0 || this.mode === Mode.Solo ? "" : reason);
    Sfx.playClip(this.snd.horn, 1);
    Sfx.playClip(this.snd.cheer, 0.6);
  }

  private Name(i: number) { return this.mode === Mode.Vs ? (i === 0 ? "YOU" : "CPU") : `P${i + 1}`; }

  private UpdateHud() {
    const t = Fmt.clock(Math.ceil(Math.max(0, this.step === Step.Count ? RoundTime : this.timeLeft)));
    setText(this.timerText, t);
    setText(this.soloSide, t);
    const urgent = this.step === Step.Play && this.timeLeft <= 10;
    const col = urgent ? Color.lerp(Pal.Danger, Color.white, 0.5 + 0.5 * Math.sin(Time.time * 12)) : Color.white;
    this.timerText.color = col;
    this.soloSide.color = col;
    setText(this.timerSub, this.mode === Mode.Vs ? "VS CPU" : "VS");
  }

  // ------------------------------------------------------------------ results

  private EndRound() {
    const a = this.seats[0].well, b = this.seats[1].well;
    this.Data.add("rounds", 1);
    if (this.mode === Mode.Solo) {
      const score = a.score, lines = a.lines;
      const stars = lines >= SoloStars[2] ? 3 : lines >= SoloStars[1] ? 2 : lines >= SoloStars[0] ? 1 : 0;
      const newBest = score > this.Data.get("best");
      this.Data.max("best", score);
      this.Data.max("bestLines", lines);
      const rank = WallBoard.add(GameId, score, "SOLO");
      this.Data.flush();
      this.Finish(new Result({
        Headline: `${lines} LINE${lines === 1 ? "" : "S"} CLEARED!`,
        HeadlineColor: Gold,
        Stars: stars,
        NewBest: newBest && score > 0,
        BestLine: `SCORE ${Fmt.n(score)}${rank > 0 ? `   ·   #${rank} TODAY` : ""}`,
        Stats: [["SCORE", Fmt.n(score)], ["LINES", String(lines)], ["TODAY", rank > 0 ? `#${rank}` : "—"], ["BEST", Fmt.n(this.Data.get("best"))]],
        Primary: "PLAY AGAIN",
        Victory: stars > 0,
      }));
      return;
    }
    // duel: a top-out loses; otherwise the higher score wins
    let winner = -1;
    if (this.loser >= 0) winner = 1 - this.loser;
    else if (a.score !== b.score) winner = a.score > b.score ? 0 : 1;
    const ws = winner >= 0 ? this.seats[winner].well : a;
    const stars = winner < 0 ? 0 : ws.lines >= SoloStars[2] ? 3 : ws.lines >= SoloStars[1] ? 2 : 1;
    let head: string, color: Color, rank = 0;
    if (this.mode === Mode.Vs) {
      const won = winner === 0;
      if (winner === 0) { this.Data.add("w" + this.diff, 1); } else if (winner === 1) this.Data.add("l" + this.diff, 1);
      head = winner < 0 ? "DRAW!" : won ? "YOU WIN!" : "CPU WINS!";
      color = winner < 0 ? Color.white : won ? Gold : P2Color;
      rank = WallBoard.add(GameId, a.score, "VS CPU");
    } else {
      if (winner >= 0) this.Data.add("p" + winner, 1);
      head = winner < 0 ? "DRAW!" : `PLAYER ${winner + 1} WINS!`;
      color = winner < 0 ? Color.white : this.seats[winner].color;
      if (winner >= 0) rank = WallBoard.add(GameId, ws.score, `P${winner + 1}`);
    }
    this.Data.flush();
    const o = this.mode === Mode.Vs ? "CPU" : "P2";
    this.Finish(new Result({
      Headline: head,
      HeadlineColor: color,
      Stars: this.mode === Mode.Vs && winner !== 0 ? 0 : stars,
      BestLine: `${this.endReason === "TIME!" ? "TIME!" : this.endReason}   ·   ${Fmt.n(a.score)} – ${Fmt.n(b.score)}${rank > 0 ? `   ·   #${rank} TODAY` : ""}`,
      Stats: [[`${this.mode === Mode.Vs ? "YOUR" : "P1"} SCORE`, Fmt.n(a.score)], [`${o} SCORE`, Fmt.n(b.score)], [`${this.mode === Mode.Vs ? "YOUR" : "P1"} LINES`, String(a.lines)], [`${o} LINES`, String(b.lines)]],
      Primary: this.mode === Mode.Vs ? "REMATCH" : "PLAY AGAIN",
      Victory: winner >= 0,
    }));
  }

  // ------------------------------------------------------------------ test hooks

  /** Seat state for tests. */
  get TestState() {
    return { step: this.step, mode: this.mode, attract: this.attract, timeLeft: this.timeLeft, idleHits: WallHits.idleSeconds, idleAct: Activity.idle, seats: this.seats.map((s) => ({ score: s.well.score, lines: s.well.lines, over: s.well.over, active: s.well.active, next: s.well.next, pending: s.well.pendingJunk, pieces: s.well.pieces, ghostY: s.well.ghostY(), busy: s.well.busy })) };
  }

  /** World point → Unity screen point (for tests that click at a well cell). */
  TestCellToUV(i: number, fx: number, fy: number) {
    const wpt = this.seats[i].view.toWorld(fx, fy);
    const V = this.ViewSize;
    return [(wpt.x + V.x / 2) / V.x, (wpt.y + V.y / 2) / V.y];
  }

  /** Injects a ball like the LiDAR would (WallHits.simulate). */
  TestHit(u: number, v: number) { WallHits.simulate(u, v); }

  /** Fills rows 0..rows-1 with junk except where the active piece lands when slammed (a test line clear). */
  TestPrepClear(i: number, rows: number) {
    const w = this.seats[i].well, p = w.active;
    if (!p) return false;
    w.grid.fill(0);
    const gy = w.ghostY();
    const cells = Well.cells({ ...p, y: gy });
    const minY = Math.min(...cells.map(([, y]) => y));
    for (let y = 0; y < rows; y++) for (let x = 0; x < 8; x++) {
      const yy = y;
      w.grid[yy * 8 + x] = cells.some(([cx, cy]) => cx === x && cy - minY === yy) ? Kind.None : Kind.Junk;
    }
    // shift the piece's landing to the bottom: clear anything below its footprint
    return true;
  }

  TestSkip(seconds: number) { this.timeLeft = Math.min(this.timeLeft, seconds); }

  TestJunk(i: number, n: number) { this.seats[i].well.addJunk(n); }

  /** Fills the well up to a height (test: force a top-out / near-full lines). */
  TestFill(i: number, rows: number, hole = 0) {
    const w = this.seats[i].well;
    for (let y = 0; y < rows; y++) for (let x = 0; x < 8; x++) w.grid[y * 8 + x] = x === hole ? Kind.None : Kind.Junk;
  }
}
