import {
  ArcadeGame, Art, AudioClip, CasualFx, CasualLook, Color, Ease, Fmt, GameInfo, GameObject, howTo, Image, ImageType, Keyboard, Mathf,
  Pal, Phase, Result, Sfx, Snd, SpriteRenderer, SysRandom, Text, TextAnchor, Time, TouchScheme, UIKit, UINode, V2, V3, WallBoard, WallHit,
  WallHits,
} from "../../kit";
import { Activity, BigBanner, DiffNames, gauss, Impacts, makeWallSounds, ModeBar, setText, Throws, TodayBoard, WallSounds, WallTime } from "./WallCommon";
import { choose, full, winLine } from "./TicBrain";
import { ChalkWhite, Gold, OColor, Slate, TicArt, Wood, XColor } from "./TicArt";

/**
 * BALL TIC-TAC-TOE: the notebook game on a chalkboard wall, played with a real ball. A giant 3 × 3 grid fills the
 * wall; players take turns throwing, and a hit claims that square in their colour (a chalky X or O). A ball on a
 * taken square or off the grid wastes the throw. Three in a row wins the round; best of three wins the match.
 * SOLO: beat the computer's O's against a 2:00 clock in as few throws as you can. VS COMPUTER: a virtual player
 * throws its own ball (minimax with skill-based slips and aim). 2 PLAYERS: alternate throws on the shared wall.
 */

enum Mode { Solo, Vs, Two }
enum Step { Count, Banner, Turn, Resolve, RoundEnd, End }

const GameId = "walltictac";
const SoloTime = 120;
const TurnTime = 10;
const WinRounds = 2;
const MaxRounds = 5;
const CpuAim = [0.26, 0.15, 0.07];
const Flight = 0.75;
const Colors = [XColor, OColor];

interface Mark { dust: SpriteRenderer; sym: SpriteRenderer; t: number; on: boolean; fade: number }
interface Panel { node: UINode; plate: Image; sym: Image; ring: Image; ringBg: Image; name: Text; pips: Image[]; status: Text; info: Text }

export class WallTicTacGame extends ArcadeGame {
  private world!: GameObject;
  private bg!: SpriteRenderer;
  private veil!: SpriteRenderer; private veilA = 0;
  private gridLines: SpriteRenderer[] = [];
  private frame: SpriteRenderer[] = [];
  private marks: Mark[] = [];
  private winStroke!: SpriteRenderer; private winT = 0; private winFrom = V2.zero; private winTo = V2.zero;
  private cellGlow!: SpriteRenderer;
  private fx!: CasualFx;
  private impacts!: Impacts;
  private throws!: Throws;
  private snd!: WallSounds;
  private clips: Record<string, AudioClip> = {};

  private board = new Array<number>(9).fill(0);
  private mode = Mode.Solo;
  private diff = 1;
  private step = Step.Count;
  private stepT = 0;
  private lastCount = 0;
  private turn = 0;
  private first = 0;
  private turnT = TurnTime;
  private round = 1;
  private roundWins = [0, 0];
  private points = [0, 0];
  private throwsN = [0, 0];
  private wasted = [0, 0];
  private clock = SoloTime;
  private cpuT = 0;
  private cpuFlying = false;
  private roundWinner = -1;
  private attract = false; private attractAt = 0; private ambient = false;
  private rng = new SysRandom(1);
  private gridC = V2.zero; private cs = 4;
  private lastTick = 0;

  private panels: Panel[] = [];
  private banner!: BigBanner;
  private clockText!: Text; private roundText!: Text;
  private attractNode!: Text; private attractSub!: Text;
  private modeBar: ModeBar | null = null;
  private boardUi: TodayBoard | null = null;

  static set TestTimeScale(v: number) { WallTime.scale = v; }
  TestAttractAfter(s: number) { WallTime.attractAfter = s; }

  protected Describe() {
    return new GameInfo({
      Id: GameId,
      Title: "BALL TIC-TAC-TOE",
      Tagline: "THROW TO CLAIM A SQUARE. THREE IN A ROW WINS!",
      PlayLabel: "PLAY",
      Accent: XColor,
      Accent2: Gold,
      BgTop: Pal.hex(0x2a4d43),
      BgBottom: Pal.hex(0x10211c),
      ShortSide: 18,
      Touch: TouchScheme.None,
      PauseButton: false,
      Music: { bpm: 100, rootHz: 130.8, degrees: [0, 4, 5, 3], seed: 17, energy: 0.5, major: true },
      HowTo: [
        howTo(TicArt.X, XColor, "Take turns throwing at the giant grid. A hit claims that square in your colour."),
        howTo(TicArt.O, OColor, "A ball on a TAKEN square or off the grid WASTES your throw."),
        howTo(Art.Star, Gold, "Three in a row (across, down or diagonal) wins the round. Best of three wins the match."),
        howTo(Art.Ring, Color.white, "Watch the TIMER ring: throw before it runs out or you lose your turn."),
        howTo(TicArt.Plate, Gold, "SOLO: beat the computer's O's before the 2:00 clock runs out, in as few throws as you can."),
        howTo(TicArt.Plate, OColor, "VS COMPUTER: the computer throws its own ball. 2 PLAYERS: X and O alternate throws."),
      ],
      Tips: ["Take the middle square first.", "Corners make two lines at once.", "Block their two-in-a-row!"],
    });
  }

  protected get ShortSide() { return ArcadeGame.FitShortSide(new V2(32, 18), 0, 0); }
  private get SelMode(): Mode { return Mathf.clamp(this.Data.get("mode"), 0, 2) as Mode; }
  private get SelDiff() { return Mathf.clamp(this.Data.get("diff", 1), 0, 2); }

  protected BestLine() {
    switch (this.SelMode) {
      case Mode.Solo: return `SOLO BEST  ${Fmt.n(this.Data.get("best"))}  ·  FEWEST THROWS ${this.Data.get("fewest") || "—"}`;
      case Mode.Vs: { const d = this.SelDiff; return `VS ${DiffNames[d]}:  ${this.Data.get("w" + d)} WON · ${this.Data.get("l" + d)} LOST`; }
      default: return `X  ${this.Data.get("p0")} – ${this.Data.get("p1")}  O`;
    }
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Data.set("diff", 1); }
    Activity.install();
    (window as unknown as Record<string, unknown>)["__" + GameId] = this;
    CasualLook.calm(this, 1.4, 0.25);
    this.world = new GameObject("TicTac", this.gameObject);
    this.bg = CasualLook.cover(this.world, TicArt.Board, -900);
    for (let i = 0; i < 4; i++) this.frame.push(Art.spr(this.world, "Frame", TicArt.Frame, Wood, 1, -880, Art.Flat));
    this.cellGlow = Art.spr(this.world, "CellGlow", Art.RoundSquare, Color.white.withAlpha(0), 1, -850, Art.Flat);
    for (let i = 0; i < 4; i++) this.gridLines.push(Art.spr(this.world, "Line", TicArt.Stroke, ChalkWhite, 1, -800, Art.Flat));
    for (let i = 0; i < 9; i++) {
      const dust = Art.spr(this.world, "Dust", TicArt.Dust, Color.white, 1, -790, Art.Flat);
      const sym = Art.spr(this.world, "Sym", TicArt.X, Color.white, 1, -780, Art.Flat);
      dust.gameObject.setActive(false); sym.gameObject.setActive(false);
      this.marks.push({ dust, sym, t: 0, on: false, fade: 1 });
    }
    this.winStroke = Art.spr(this.world, "Win", TicArt.Stroke, Gold, 1, -770, Art.Flat);
    this.winStroke.gameObject.setActive(false);
    this.veil = Art.spr(this.world, "Veil", Art.Square, new Color(0.02, 0.05, 0.04, 0), 1, 400, Art.Flat);
    this.fx = CasualFx.create(this.world, 70, 360);
    this.impacts = new Impacts(this.world, this.fx, "tt");
    this.throws = new Throws(this.world, "tt");
    this.snd = makeWallSounds("tt");
    const n = new SysRandom(9);
    this.clips.chalk = Sfx.make("tt-chalk", 0.35, (t) => { const r = n.nextDouble() * 2 - 1; return r * (0.4 + 0.6 * Math.abs(Math.sin(t * 90))) * Sfx.env(t, 0.005, 0.32) * 0.45; });
    this.clips.claim = Sfx.make("tt-claim", 0.4, (t) => (Sfx.sinP(Sfx.glide(t, 520, 880, 0.08)) * 0.35 + Sfx.triP(1320 * t) * 0.12) * Sfx.env(t, 0.004, 0.36));
    this.clips.waste = Sfx.make("tt-waste", 0.5, (t) => (Sfx.sqrP(Sfx.glide(t, 200, 120, 0.4) * t) * 0.2 + Sfx.sawP(150 * t) * 0.1) * Sfx.env(t, 0.005, 0.45));
    this.clips.win = Sfx.make("tt-win", 1.0, (t) => {
      let v = 0;
      [523, 659, 784, 1047, 1319].forEach((f, i) => { const tt = t - i * 0.09; if (tt > 0) v += (Sfx.sinP(f * tt) * 0.22 + Sfx.triP(f * 2 * tt) * 0.06) * Sfx.env(tt, 0.004, 0.55); });
      return v;
    });
    this.clips.turn = Sfx.make("tt-turn", 0.3, (t) => (Sfx.sinP(Sfx.glide(t, 660, 990, 0.05)) * 0.3) * Sfx.env(t, 0.004, 0.25));
    this.BuildHud();
    this.BuildTitle();
    this.Layout();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    for (let i = 0; i < 2; i++) {
      const col = Colors[i];
      const node = UIKit.node("Panel" + i, hud);
      UIKit.img(node, "Bg", Art.UiRound, new Color(0.02, 0.06, 0.05, 0.6)).rectTransform.stretch();
      const edge = UIKit.img(node, "Edge", Art.UiOutline, col.withAlpha(0.7));
      edge.rectTransform.stretch();
      const ringBg = UIKit.img(node, "RingBg", Art.UiRing, Color.white.withAlpha(0.15));
      ringBg.rectTransform.place(new V2(0.5, 1), new V2(0, -190), new V2(270, 270));
      const ring = UIKit.img(node, "Ring", Art.UiRing, col);
      ring.rectTransform.place(new V2(0.5, 1), new V2(0, -190), new V2(270, 270));
      ring.type = ImageType.Filled;
      ring.fillMethod = "Radial360";
      const plate = UIKit.img(node, "Plate", TicArt.Plate, Slate);
      plate.rectTransform.place(new V2(0.5, 1), new V2(0, -190), new V2(210, 210));
      const sym = UIKit.img(node, "Sym", i === 0 ? TicArt.X : TicArt.O, col);
      sym.rectTransform.place(new V2(0.5, 1), new V2(0, -190), new V2(190, 190));
      const name = UIKit.at(UIKit.label(node, i === 0 ? "P1" : "P2", 76, col), new V2(0.5, 1), new V2(0, -375), new V2(420, 90));
      UIKit.glow(name, Color.black.withAlpha(0.5), 4);
      const pips: Image[] = [];
      for (let k = 0; k < WinRounds; k++) {
        const p = UIKit.img(node, "Pip", Art.Star, Color.white.withAlpha(0.2));
        p.rectTransform.place(new V2(0.5, 1), new V2((k - (WinRounds - 1) / 2) * 90, -460), new V2(80, 80));
        pips.push(p);
      }
      const status = UIKit.at(UIKit.label(node, "", 78, Color.white), new V2(0.5, 1), new V2(0, -560), new V2(420, 100));
      UIKit.glow(status, Color.black.withAlpha(0.6), 5);
      const info = UIKit.at(UIKit.label(node, "", 38, new Color(1, 1, 1, 0.85)), new V2(0.5, 1), new V2(0, -650), new V2(420, 60));
      this.panels.push({ node, plate, sym, ring, ringBg, name, pips, status, info });
    }
    this.clockText = UIKit.at(UIKit.label(hud, "", 84, Color.white), new V2(0.5, 0.5), V2.zero, new V2(400, 100));
    UIKit.glow(this.clockText, Color.black.withAlpha(0.6), 5);
    this.roundText = UIKit.at(UIKit.label(hud, "", 40, Gold, TextAnchor.MiddleCenter), new V2(0.5, 0.5), V2.zero, new V2(400, 60));
    UIKit.glow(this.roundText, Color.black.withAlpha(0.6), 4);
    this.banner = new BigBanner(hud);
    this.attractNode = UIKit.at(UIKit.label(hud, "THROW A BALL TO PLAY!", 120, Color.white), new V2(0.5, 0.5), new V2(0, 40), new V2(1900, 160));
    UIKit.glow(this.attractNode, OColor, 8);
    this.attractSub = UIKit.at(UIKit.label(hud, "BALL TIC-TAC-TOE  ·  DEMO", 50, Gold), new V2(0.5, 0.5), new V2(0, -70), new V2(1400, 70));
    UIKit.glow(this.attractSub, Color.black, 4);
    this.attractNode.gameObject.setActive(false);
    this.attractSub.gameObject.setActive(false);
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex || !ex.parent) return;
    CasualLook.titleCard(this.UI, new Color(0.03, 0.08, 0.07, 0.9), new V2(1060, 1080), -10);
    this.modeBar = new ModeBar(ex, [XColor, Gold, OColor], () => [this.SelMode, this.SelDiff], (m, d) => {
      this.Data.set("mode", m); this.Data.set("diff", d); this.Data.flush();
      Sfx.play(Snd.Click, 0.6);
      this.UI.ShowTitle(this.BestLine(), this.StatsLine());
      this.boardUi?.refresh();
    }, ["BEAT THE CPU · 2:00 CLOCK", "YOU: X · CPU: O", "X AND O TAKE TURNS"]);
    this.boardUi = new TodayBoard(ex.parent, XColor, GameId, (s) => Fmt.n(s));
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    const V = this.ViewSize;
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bg, V);
    const H = Math.min(V.y, 18), W = Math.min(V.x, 32);
    const size = Math.min(H - 1.5, W - 16.5);
    this.cs = size / 3;
    this.gridC = new V2(0, -0.1);
    const c = this.gridC;
    // chalk grid: two vertical, two horizontal strokes
    for (let i = 0; i < 4; i++) {
      const s = this.gridLines[i];
      const k = (i % 2 === 0 ? -1 : 1) * this.cs / 2;
      const vertical = i < 2;
      s.transform.localPosition = vertical ? new V3(c.x + k, c.y, 0) : new V3(c.x, c.y + k, 0);
      s.transform.localEulerZ = vertical ? 90 + (i === 0 ? 1.2 : -0.8) : (i === 2 ? -0.6 : 0.9);
      s.transform.localScale = new V3(size * 1.06, size * 1.06, 1);
    }
    // wooden frame around the whole wall area
    const fw = W - 0.5, fh = H - 0.3;
    this.frame.forEach((f, i) => {
      const horiz = i < 2;
      f.transform.localPosition = horiz ? new V3(0, (i === 0 ? 1 : -1) * fh / 2, 0) : new V3((i === 2 ? 1 : -1) * fw / 2, 0, 0);
      f.transform.localEulerZ = horiz ? 0 : 90;
      f.transform.localScale = new V3((horiz ? fw : fh) + 0.4, 9, 1);
    });
    for (let i = 0; i < 9; i++) this.PlaceMark(i);
    this.veil.transform.localScale = new V3(V.x + 4, V.y + 4, 1);
    this.boardUi?.layout();
    const center = this.UI.TitleExtra?.parent;
    if (center) { const k = V.x < V.y ? 0.86 : 1; center.localScale = new V3(k, k, 1); }
    // side panels beside the grid
    const side = (size / 2 + (W / 2 - size / 2) / 2);
    for (let i = 0; i < 2; i++) {
      const hp = this.UI.WorldToHud(new V2((i === 0 ? -1 : 1) * side, c.y));
      const unit = Math.abs(this.UI.WorldToHud(new V2(1, 0)).x - this.UI.WorldToHud(V2.zero).x);
      const w = Math.min(440, ((W / 2 - size / 2) - 0.8) * unit);
      const k = w / 440;
      this.panels[i].node.place(UIKit.Center, hp, new V2(440, 720));
      this.panels[i].node.localScale = new V3(k, k, 1);
    }
    const top = this.UI.WorldToHud(new V2(0, c.y + size / 2));
    this.clockText.rectTransform.anchoredPosition = this.UI.WorldToHud(new V2(-(size / 2 + (W / 2 - size / 2) / 2), c.y - 6.2));
    this.roundText.rectTransform.anchoredPosition = new V2(top.x, top.y + 6);
  }

  private CellCenter(i: number) {
    const col = i % 3, row = Math.floor(i / 3);
    return new V2(this.gridC.x + (col - 1) * this.cs, this.gridC.y + (1 - row) * this.cs);
  }

  /** Grid cell under a world point, or -1 off the grid. */
  private CellAt(p: V2) {
    const lx = p.x - (this.gridC.x - this.cs * 1.5), ly = (this.gridC.y + this.cs * 1.5) - p.y;
    if (lx < 0 || ly < 0 || lx >= this.cs * 3 || ly >= this.cs * 3) return -1;
    return Math.floor(ly / this.cs) * 3 + Math.floor(lx / this.cs);
  }

  private PlaceMark(i: number) {
    const m = this.marks[i], p = this.CellCenter(i);
    m.dust.transform.localPosition = new V3(p.x, p.y, 0);
    m.sym.transform.localPosition = new V3(p.x, p.y, 0);
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.StopAttract();
    this.ambient = true;
    this.SetupMatch(true);
    this.modeBar?.refresh();
    this.boardUi?.refresh();
  }

  protected BeginRun() {
    this.StopAttract();
    this.ambient = false;
    this.mode = this.SelMode;
    this.diff = this.mode === Mode.Solo ? 1 : this.SelDiff;
    this.Data.add("games", 1);
    this.UI.SetPauseButton(false);
    this.SetupMatch(false);
    Sfx.setIntensity(0.35);
  }

  private get CpuSeat() { return this.ambient ? [0, 1] : this.mode === Mode.Two ? [] : [1]; }
  private IsCpu(i: number) { return this.CpuSeat.includes(i); }
  private get Quiet() { return this.ambient && !this.attract; }

  private SetupMatch(demo: boolean) {
    this.rng = new SysRandom((Math.random() * 1e9) | 0);
    this.roundWins = [0, 0]; this.points = [0, 0]; this.throwsN = [0, 0]; this.wasted = [0, 0];
    this.round = 1;
    this.first = 0;
    this.clock = SoloTime;
    this.impacts.clear(); this.throws.clear(); this.fx.clear();
    this.ClearBoard(true);
    this.banner.hide();
    WallHits.clear();
    this.Layout();
    if (demo) { this.StartRound(); return; }
    this.step = Step.Count;
    this.stepT = 3.2;
    this.lastCount = 4;
    this.turn = 0;
    this.RefreshPanels();
  }

  private ClearBoard(instant: boolean) {
    this.board.fill(0);
    this.winStroke.gameObject.setActive(false);
    for (const m of this.marks) {
      if (instant) { m.on = false; m.dust.gameObject.setActive(false); m.sym.gameObject.setActive(false); }
      else if (m.on) m.fade = 0.999;
    }
    this.roundWinner = -1;
  }

  private StartRound() {
    this.ClearBoard(false);
    this.turn = this.first;
    this.step = Step.Banner;
    this.stepT = this.Quiet ? 0.3 : 1.3;
    if (!this.Quiet) {
      this.banner.show(this.round === 1 ? "ROUND 1" : `ROUND ${this.round}`, Gold, 1.2);
      Sfx.playClip(this.snd.whistle, 0.7);
    }
    this.RefreshPanels();
  }

  private BeginTurn() {
    this.step = Step.Turn;
    this.turnT = TurnTime;
    this.lastTick = TurnTime;
    WallHits.clear();
    if (this.IsCpu(this.turn)) this.cpuT = this.Quiet ? 0.5 : 0.7 + this.rng.nextDouble() * 0.7;
    this.cpuFlying = false;
    if (!this.Quiet) {
      this.banner.show(`${this.Name(this.turn)} THROW!`, Colors[this.turn], 0.85);
      Sfx.playClip(this.clips.turn, 0.8, this.turn === 0 ? 1 : 1.2);
    }
    this.RefreshPanels();
  }

  private Name(i: number) {
    if (this.ambient) return i === 0 ? "X" : "O";
    if (this.mode === Mode.Two) return `P${i + 1}`;
    return i === 0 ? "YOU" : "CPU";
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
    for (const h of hits) { this.impacts.hit(h.world, ChalkWhite, false); Sfx.playClip(this.snd.thump, 0.6); }
    if (this.State === Phase.Title) this.Simulate(dt, []);
    if (Math.min(WallHits.idleSeconds, Activity.idle) > WallTime.attractAfter) this.StartAttract();
  }

  private Common(dt: number) {
    this.banner.update(dt);
    this.impacts.update(dt);
    this.throws.update(dt);
    this.veilA = Mathf.moveTowards(this.veilA, this.State === Phase.Over && !this.attract ? 0.6 : 0, Time.unscaledDeltaTime * 2.5);
    this.veil.color = new Color(0.02, 0.05, 0.04, this.veilA);
    this.AnimateMarks(dt);
  }

  private StartAttract() {
    this.attract = true;
    this.attractAt = performance.now();
    this.ambient = true;
    this.UI.ShowHud();
    this.UI.SetPauseButton(false);
    this.SetupMatch(true);
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
    const solo = this.mode === Mode.Solo && !this.ambient;
    if (solo && this.step !== Step.Count && this.step !== Step.End) {
      this.clock -= dt;
      if (this.clock <= 10 && Math.ceil(this.clock) !== this.lastTick && this.step !== Step.RoundEnd) { this.lastTick = Math.ceil(this.clock); Sfx.playClip(this.snd.tick, 0.8, 1.4); }
      if (this.clock <= 0) { this.clock = 0; this.EndMatch("TIME!"); }
    }
    switch (this.step) {
      case Step.Count: {
        this.stepT -= dt;
        const n = Math.ceil(this.stepT - 0.2);
        if (n !== this.lastCount && n >= 1 && n <= 3) { this.lastCount = n; this.banner.show(String(n), n === 1 ? Gold : Color.white, 0.9); Sfx.playClip(this.snd.beep, 0.9); }
        for (const h of hits) { this.impacts.hit(h.world, ChalkWhite, false, 0.8); Sfx.playClip(this.snd.thump, 0.5); }
        if (this.stepT <= 0.2) { Sfx.playClip(this.snd.go, 0.8); this.StartRound(); }
        break;
      }
      case Step.Banner:
        this.stepT -= dt;
        for (const h of hits) this.impacts.hit(h.world, ChalkWhite, true, 0.8);
        if (this.stepT <= 0) this.BeginTurn();
        break;
      case Step.Turn: {
        if (this.IsCpu(this.turn)) {
          for (const h of hits) { this.impacts.hit(h.world, Color.white, true, 0.8); if (!this.Quiet) { this.UI.Float(h.world, "WAIT!", Color.white, 1.4); Sfx.playClip(this.snd.miss, 0.4); } }
          this.cpuT -= dt;
          if (this.cpuT <= 0 && !this.cpuFlying) this.CpuThrow();
        } else {
          const h = hits[0];
          for (const extra of hits.slice(1)) this.impacts.hit(extra.world, Color.white, true, 0.8);
          if (h) { this.Throw(this.turn, h.world); break; }
        }
        if (!this.cpuFlying) {
          this.turnT -= dt;
          if (!this.Quiet && this.turnT <= 3 && Math.ceil(this.turnT) !== this.lastTick && !solo) { this.lastTick = Math.ceil(this.turnT); Sfx.playClip(this.snd.tick, 0.8, 1.3); }
          if (this.turnT <= 0) {
            this.wasted[this.turn]++;
            if (!this.Quiet) { this.banner.show("TOO SLOW!", Pal.Danger, 1.0); Sfx.playClip(this.clips.waste, 0.8); }
            this.step = Step.Resolve;
            this.stepT = 1.0;
          }
        }
        break;
      }
      case Step.Resolve:
        this.stepT -= dt;
        for (const h of hits) this.impacts.hit(h.world, Color.white, true, 0.8);
        if (this.stepT <= 0) this.AfterThrow();
        break;
      case Step.RoundEnd:
        this.stepT -= dt;
        for (const h of hits) this.impacts.hit(h.world, ChalkWhite, false, 0.8);
        if (this.stepT <= 0) this.NextRound();
        break;
      case Step.End:
        this.stepT -= dt;
        for (const h of hits) this.impacts.hit(h.world, ChalkWhite, false, 0.8);
        if (this.stepT <= 0) {
          if (this.ambient) this.SetupMatch(true);
          else if (this.State === Phase.Playing) this.Result();
        }
        break;
    }
    this.RefreshPanels();
  }

  private CpuThrow() {
    const lvl = this.ambient ? 1 : this.diff;
    const mark = this.turn + 1;
    const target = choose(this.board, mark, lvl, () => this.rng.nextDouble());
    if (target < 0) return;
    const aim = CpuAim[lvl] * this.cs;
    const to = this.CellCenter(target).add(new V2(gauss(() => this.rng.nextDouble()) * aim, gauss(() => this.rng.nextDouble()) * aim));
    const V = this.ViewSize;
    const from = new V2((this.turn === 0 ? -1 : 1) * (V.x * 0.3) + (this.rng.nextDouble() - 0.5) * 4, -V.y / 2 - 2);
    this.cpuFlying = true;
    const who = this.turn;
    this.throws.throwAt(from, to, Colors[who], Flight, (p) => { this.cpuFlying = false; if (this.step === Step.Turn && this.turn === who) this.Throw(who, p); });
  }

  /** A ball (real or the computer's) for player i landed at p. */
  private Throw(i: number, p: V2) {
    this.throwsN[i]++;
    const cell = this.CellAt(p);
    if (!this.Quiet) Sfx.playClip(this.snd.thump, 0.8, 0.9 + Math.random() * 0.2);
    if (cell >= 0 && this.board[cell] === 0) {
      this.board[cell] = i + 1;
      this.impacts.hit(p, Colors[i], false, 1.3);
      const m = this.marks[cell];
      m.on = true; m.t = 0; m.fade = 1;
      m.sym.sprite = i === 0 ? TicArt.X : TicArt.O;
      m.sym.color = Colors[i];
      m.dust.color = Colors[i].withAlpha(0.35);
      m.dust.transform.localEulerZ = Math.random() * 360;
      m.sym.transform.localEulerZ = (Math.random() - 0.5) * 14;
      m.dust.gameObject.setActive(true); m.sym.gameObject.setActive(true);
      const c = this.CellCenter(cell);
      for (let k = 0; k < 26; k++) this.fx.emit(c.add(Ins(1.2)), V2.fromAngle(Math.random() * 6.283, 2 + Math.random() * 6), Color.lerp(Colors[i], ChalkWhite, Math.random() * 0.6), 0.35, 0.7, null, 3, 0, true, 2.5);
      if (!this.Quiet) {
        Sfx.playClip(this.clips.chalk, 0.9);
        Sfx.playClip(this.clips.claim, 0.7, i === 0 ? 1 : 0.85);
        this.Fx.shake(0.15);
      }
    } else {
      this.wasted[i]++;
      this.impacts.hit(p, Colors[i], true, 1.3);
      if (!this.Quiet) {
        this.UI.Float(p, cell >= 0 ? "TAKEN!" : "MISSED!", Pal.Danger, 2.2);
        this.banner.show("WASTED!", Pal.Danger, 0.9, cell >= 0 ? "THAT SQUARE IS TAKEN" : "OFF THE GRID");
        Sfx.playClip(this.clips.waste, 0.8);
      }
    }
    this.step = Step.Resolve;
    this.stepT = this.Quiet ? 0.5 : 1.0;
  }

  private AfterThrow() {
    const mark = this.turn + 1;
    const line = winLine(this.board, mark);
    if (line) { this.RoundWon(this.turn, line); return; }
    if (full(this.board)) { this.RoundDraw(); return; }
    this.turn = 1 - this.turn;
    this.BeginTurn();
  }

  private RoundWon(i: number, line: number[]) {
    this.roundWinner = i;
    this.roundWins[i]++;
    const empty = this.board.filter((c) => c === 0).length;
    this.points[i] += 500 + empty * 60;
    this.winFrom = this.CellCenter(line[0]); this.winTo = this.CellCenter(line[2]);
    this.winT = 0;
    this.winStroke.gameObject.setActive(true);
    this.step = Step.RoundEnd;
    this.stepT = this.Quiet ? 1.6 : 2.6;
    const mid = V2.lerp(this.winFrom, this.winTo, 0.5);
    this.fx.confetti(mid.add(new V2(0, 2)), this.Quiet ? 20 : 70, 10, [Colors[i], Gold, ChalkWhite]);
    if (!this.Quiet) {
      this.banner.show(`${this.Name(i)} WIN${this.Name(i) === "YOU" ? "" : "S"}!`, Colors[i], 2.0, this.roundWins[i] >= WinRounds ? "" : `ROUND ${this.round}`);
      Sfx.playClip(this.clips.win, 0.9);
      Sfx.playClip(this.snd.cheer, 0.8);
      this.Fx.shake(0.35);
    }
  }

  private RoundDraw() {
    this.roundWinner = -1;
    this.step = Step.RoundEnd;
    this.stepT = this.Quiet ? 1.2 : 2.0;
    if (!this.Quiet) { this.banner.show("DRAW!", ChalkWhite, 1.6, "NOBODY SCORES"); Sfx.playClip(this.clips.waste, 0.6, 1.3); }
  }

  private NextRound() {
    const done = this.roundWins[0] >= WinRounds || this.roundWins[1] >= WinRounds || this.round >= MaxRounds;
    if (done) { this.EndMatch(""); return; }
    this.round++;
    this.first = 1 - this.first;
    this.StartRound();
  }

  private EndMatch(reason: string) {
    if (this.step === Step.End) return;
    this.step = Step.End;
    this.stepT = this.Quiet ? 1.5 : 2.4;
    this.throws.clear();
    this.cpuFlying = false;
    if (this.Quiet) return;
    if (reason) this.banner.show(reason, Gold, 2.2);
    Sfx.playClip(this.snd.horn, 1);
  }

  // ------------------------------------------------------------------ visuals

  private AnimateMarks(dt: number) {
    for (const m of this.marks) {
      if (!m.on) continue;
      m.t += dt;
      if (m.fade < 1) {
        m.fade -= dt * 2.2;
        if (m.fade <= 0) { m.on = false; m.dust.gameObject.setActive(false); m.sym.gameObject.setActive(false); continue; }
      }
      const k = Mathf.clamp01(m.t / 0.35);
      const s = this.cs * Mathf.lerp(1.5, 0.82, Ease.outBack(k));
      m.sym.transform.localScale = new V3(s, s, 1);
      const ds = this.cs * Mathf.lerp(0.4, 1.05, Ease.outCubic(Mathf.clamp01(m.t / 0.25)));
      m.dust.transform.localScale = new V3(ds, ds, 1);
      const sc = m.sym.color;
      m.sym.color = sc.withAlpha(Mathf.clamp01(m.fade));
      m.dust.color = m.dust.color.withAlpha(0.35 * Mathf.clamp01(m.fade));
    }
    // winning chalk line
    if (this.winStroke.gameObject.activeSelf) {
      this.winT += dt;
      const k = Ease.outCubic(Mathf.clamp01(this.winT / 0.45));
      const d = this.winTo.sub(this.winFrom);
      const len = (d.magnitude + this.cs * 0.9) * k;
      const mid = this.winFrom.sub(d.normalized.mul(this.cs * 0.45)).add(d.normalized.mul(len / 2));
      this.winStroke.transform.localPosition = new V3(mid.x, mid.y, 0);
      this.winStroke.transform.localEulerZ = Math.atan2(d.y, d.x) * 180 / Math.PI;
      this.winStroke.transform.localScale = new V3(Math.max(0.01, len), this.cs * 1.4, 1);
      this.winStroke.color = Color.lerp(Gold, Color.white, 0.3 + 0.3 * Math.sin(Time.time * 10));
    }
    // highlight the square under nothing… pulse the board for the player to move
    const active = this.step === Step.Turn;
    const pulse = 0.5 + 0.5 * Math.sin(Time.time * 4);
    this.cellGlow.transform.localPosition = new V3(this.gridC.x, this.gridC.y, 0);
    this.cellGlow.transform.localScale = new V3(this.cs * 3.2, this.cs * 3.2, 1);
    this.cellGlow.color = Colors[this.turn].withAlpha(active ? 0.05 + 0.04 * pulse : 0);
  }

  private RefreshPanels() {
    const solo = this.mode === Mode.Solo && !this.ambient;
    for (let i = 0; i < 2; i++) {
      const p = this.panels[i];
      const mine = this.turn === i && (this.step === Step.Turn || this.step === Step.Banner);
      setText(p.name, this.Name(i));
      p.pips.forEach((im, k) => { im.color = k < this.roundWins[i] ? Gold : Color.white.withAlpha(0.18); });
      const pulse = 0.5 + 0.5 * Math.sin(Time.time * 8);
      const cpu = this.IsCpu(i);
      let status = "";
      if (mine) status = cpu ? (this.cpuFlying ? "THROWING…" : "AIMING…") : "THROW!";
      else if (this.step === Step.RoundEnd && this.roundWinner === i) status = "WINS!";
      setText(p.status, status);
      p.status.color = mine ? Color.lerp(Colors[i], Color.white, pulse * 0.6) : Gold;
      const frac = this.step === Step.Turn && this.turn === i ? Mathf.clamp01(this.turnT / TurnTime) : this.step === Step.Banner && mine ? 1 : 0;
      p.ring.fillAmount = frac;
      p.ring.color = frac < 0.3 ? Color.lerp(Pal.Danger, Color.white, pulse * 0.4) : Colors[i];
      const s = mine ? 1 + 0.05 * pulse : 0.92;
      p.sym.rectTransform.localScale = new V3(s, s, 1);
      p.plate.color = mine ? Color.lerp(Slate, Colors[i], 0.25) : Slate;
      setText(p.info, solo && i === 0 ? `THROWS ${this.throwsN[0]}  ·  WASTED ${this.wasted[0]}` : `THROWS ${this.throwsN[i]}`);
    }
    setText(this.clockText, solo ? Fmt.clock(Math.ceil(this.clock)) : "");
    this.clockText.color = solo && this.clock <= 10 ? Color.lerp(Pal.Danger, Color.white, 0.5 + 0.5 * Math.sin(Time.time * 12)) : Color.white;
    setText(this.roundText, this.step === Step.Count ? "BEST OF 3" : `ROUND ${this.round}  ·  BEST OF 3`);
  }

  // ------------------------------------------------------------------ results

  private Result() {
    this.Data.add("matches", 1);
    const [a, b] = this.roundWins;
    const winner = a > b ? 0 : b > a ? 1 : -1;
    const timeUp = this.mode === Mode.Solo && this.clock <= 0 && a < WinRounds;
    const score = (i: number) => Math.max(0, this.points[i] - this.wasted[i] * 25 + (this.mode === Mode.Solo && i === 0 && winner === 0 ? Math.round(this.clock) * 10 : 0));
    const stats: [string, string][] = [["ROUNDS", `${a} – ${b}`], [`${this.Name(0)} THROWS`, String(this.throwsN[0])], [`${this.Name(0)} WASTED`, String(this.wasted[0])], [`${this.Name(1)} THROWS`, String(this.throwsN[1])]];
    if (this.mode === Mode.Solo) {
      const won = winner === 0 && !timeUp;
      const sc = won ? score(0) : 0;
      const stars = !won ? 0 : this.wasted[0] === 0 && this.clock >= 60 ? 3 : this.clock >= 30 ? 2 : 1;
      const newBest = sc > this.Data.get("best");
      this.Data.max("best", sc);
      if (won && (this.Data.get("fewest") === 0 || this.throwsN[0] < this.Data.get("fewest"))) this.Data.set("fewest", this.throwsN[0]);
      const rank = won ? WallBoard.add(GameId, sc, "SOLO") : 0;
      this.Data.flush();
      this.Finish(new Result({
        Headline: won ? `YOU WIN IN ${this.throwsN[0]} THROWS!` : timeUp ? "TIME'S UP!" : "CPU WINS!",
        HeadlineColor: won ? Gold : OColor,
        Stars: stars,
        NewBest: newBest && sc > 0,
        BestLine: won ? `SCORE ${Fmt.n(sc)}${rank > 0 ? `   ·   #${rank} TODAY` : ""}` : `ROUNDS ${a} – ${b}   ·   TRY AGAIN!`,
        Stats: [["SCORE", Fmt.n(sc)], ["THROWS", String(this.throwsN[0])], ["TIME LEFT", Fmt.clock(Math.ceil(this.clock))], ["TODAY", rank > 0 ? `#${rank}` : "—"]],
        Primary: "PLAY AGAIN",
        Victory: won,
      }));
      return;
    }
    let head: string, color: Color, rank = 0;
    if (this.mode === Mode.Vs) {
      if (winner === 0) this.Data.add("w" + this.diff, 1); else if (winner === 1) this.Data.add("l" + this.diff, 1);
      head = winner < 0 ? "DRAW!" : winner === 0 ? "YOU WIN!" : "CPU WINS!";
      color = winner < 0 ? ChalkWhite : Colors[winner];
      if (winner === 0) rank = WallBoard.add(GameId, score(0), "VS CPU");
    } else {
      if (winner >= 0) this.Data.add("p" + winner, 1);
      head = winner < 0 ? "DRAW!" : `PLAYER ${winner + 1} (${winner === 0 ? "X" : "O"}) WINS!`;
      color = winner < 0 ? ChalkWhite : Colors[winner];
      if (winner >= 0) rank = WallBoard.add(GameId, score(winner), `P${winner + 1}`);
    }
    this.Data.flush();
    const loserRounds = winner < 0 ? 0 : this.roundWins[1 - winner];
    const stars = winner < 0 || (this.mode === Mode.Vs && winner !== 0) ? 0 : this.mode === Mode.Vs ? this.diff + 1 : loserRounds === 0 ? 3 : 2;
    this.Finish(new Result({
      Headline: head,
      HeadlineColor: color,
      Stars: stars,
      BestLine: `ROUNDS ${a} – ${b}${winner >= 0 ? `   ·   SCORE ${Fmt.n(score(winner))}` : ""}${rank > 0 ? `   ·   #${rank} TODAY` : ""}`,
      Stats: stats,
      Primary: this.mode === Mode.Vs ? "REMATCH" : "PLAY AGAIN",
      Victory: winner >= 0,
    }));
  }

  // ------------------------------------------------------------------ test hooks

  get TestState() {
    return { step: this.step, turn: this.turn, board: [...this.board], round: this.round, wins: [...this.roundWins], throws: [...this.throwsN], wasted: [...this.wasted], clock: this.clock, attract: this.attract, mode: this.mode };
  }
  /** Wall u, v (0..1) of a grid cell's centre. */
  TestCellUV(i: number) { const p = this.CellCenter(i), V = this.ViewSize; return [(p.x + V.x / 2) / V.x, (p.y + V.y / 2) / V.y]; }
  TestHit(u: number, v: number) { WallHits.simulate(u, v); }
  TestClock(s: number) { this.clock = Math.min(this.clock, s); }
}

function Ins(r: number) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r; return new V2(Math.cos(a) * d, Math.sin(a) * d); }
