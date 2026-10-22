import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject, howTo,
  Image, Keyboard, Mathf, Mouse, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer, Text, Time, Touchscreen,
  TouchScheme, UIKit, UINode, V2, V3, overUI, wait,
} from "../../kit";
import {
  ArrowLight, BackSprite, BallSprite, BumperCap, DropTargetSprite, FlipperSprite, FlipperSpriteW, Inserts, LightSprite,
  MissionInsert, Neon, PF, PFCenter, PlayfieldSprite, PlungerSprite, RampSprite, SideSprite, SpinnerSprite,
} from "./PinballArt";
import {
  BallR, Bumpers, BumperR, DropTargets, Missions, PinBot, PinBotLevels, PinEvent, PinSim, PlungerY, RampCenter, ShooterX,
  Spinner,
} from "./PinballSim";

/**
 * NEBULA PINBALL: a full-height neon space table. Tap the left / right half of the screen (or Z / X, arrows, Shift)
 * to work the flippers; hold anywhere (or Space) to pull the plunger and let go to launch. Pop bumpers, slingshots,
 * a drop-target bank, a spinner on the left orbit, three O-R-B top lanes (flippers rotate the lit lanes) and a long
 * ramp. Missions on the display pay big and every second one starts 3-ball MULTIBALL with ramp jackpots. SOLO plays
 * three balls for a high score, VS CPU alternates balls with a computer player, 2 PLAYERS alternate on one device.
 */

const Amber = Neon.amber, Gold = Neon.gold;
const ModeNames = ["SOLO", "VS CPU", "2 PLAYERS"];
const DiffNames = ["EASY", "NORMAL", "HARD"];
const BallsPerGame = 3;
const MaxBalls = 4;
const TableW = PF.x1 - PF.x0, TableH = PF.y1 - PF.y0;

interface BallView { root: GameObject; ball: SpriteRenderer; shadow: SpriteRenderer; glow: SpriteRenderer; trail: SpriteRenderer[]; hist: V2[] }
interface Light { sr: SpriteRenderer; on: number; color: Color }

export class PinballGame extends ArcadeGame {
  private world!: GameObject; private table!: GameObject;
  private bgCover!: SpriteRenderer; private sideL!: SpriteRenderer; private sideR!: SpriteRenderer;
  private flippers: GameObject[] = [];
  private flipperSr: SpriteRenderer[] = [];
  private bumperCaps: SpriteRenderer[] = []; private bumperGlow: SpriteRenderer[] = [];
  private drops: SpriteRenderer[] = [];
  private spinner!: SpriteRenderer;
  private plunger!: SpriteRenderer;
  private slingGlow: SpriteRenderer[] = [];
  private views: BallView[] = [];
  private lights = new Map<string, Light>();
  private fx!: CasualFx;

  private sims: PinSim[] = [];
  private cur = 0;
  private players = 1;
  private mode = 0; private diff = 1;
  private ballNo: number[] = [];
  private extraBalls: number[] = [];
  private bot: PinBot | null = null;
  private phase: "play" | "bonus" | "between" | "done" = "play";
  private phaseT = 0;
  private revives = 0;
  private attract!: PinSim; private attractBot!: PinBot;
  private keyL = false; private keyR = false; private keyP = false;

  // display
  private dmd!: UINode; private dmdScore!: Text; private dmdLine!: Text; private dmdMsg!: Text; private dmdMission!: Text;
  private dmdBg!: Image;
  private msgQueue: { text: string; t: number; color: Color }[] = [];
  private msgT = 0;
  private ffButton!: ArcadeButton;
  private modeButtons: ArcadeButton[] = [];
  private diffButtons: ArcadeButton[] = [];
  private portrait = true;

  private sFlip!: AudioClip; private sBumper!: AudioClip; private sSling!: AudioClip; private sDrop!: AudioClip;
  private sSpin!: AudioClip; private sRamp!: AudioClip; private sLane!: AudioClip; private sDrain!: AudioClip;
  private sLaunch!: AudioClip; private sMulti!: AudioClip; private sMission!: AudioClip; private sHit!: AudioClip; private sBonus!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "pinball",
      Title: "NEBULA PINBALL",
      Tagline: "TAP LEFT AND RIGHT TO WORK THE FLIPPERS.",
      PlayLabel: "PLAY",
      Accent: Neon.cyan,
      Accent2: Gold,
      BgTop: Pal.hex(0x1d0e52),
      BgBottom: Pal.hex(0x05051a),
      ShortSide: 12,
      Touch: TouchScheme.None,
      Music: { bpm: 118, rootHz: 110, degrees: [0, 3, 4, 5], seed: 77, energy: 0.55, major: false },
      Reminders: [
        "The table is lit|Can you start MULTIBALL?",
        "Beat your high score|Ramps and orbits chain into combos.",
        "Challenge the CPU|Alternate balls, highest score wins.",
      ],
      HowTo: [
        howTo(Art.Chevron, Neon.cyan, "TAP the LEFT or RIGHT half of the screen to flip (Z / X, arrows or Shift on a keyboard)."),
        howTo(Art.Square, Neon.red, "HOLD anywhere (or Space) to pull the plunger, let go to launch the ball."),
        howTo(Art.Star, Neon.pink, "Pop bumpers, slingshots, drop targets, the spinner, the RAMP and the left ORBIT all score."),
        howTo(Art.Ring, Gold, "Light O-R-B lanes to raise the bonus multiplier. Flippers rotate the lit lanes."),
        howTo(Art.Diamond, Neon.lime, "Finish MISSIONS on the display. Every second mission starts 3-ball MULTIBALL!"),
        howTo(Art.Disc, Neon.violet, "Chain ramp and orbit shots within 4 seconds for COMBOS."),
      ],
      Tips: [
        "Hold a flipper up to catch the ball, then aim your shot.",
        "Hit the ball near the flipper tip for shots across the table.",
        "During MULTIBALL every ramp is a 25,000 JACKPOT.",
        "Ball save is lit for the first seconds of every ball.",
        "Lane change: flip to move the lit O-R-B lanes under the ball.",
      ],
    });
  }

  protected get ShortSide() { return 12; }
  protected BestLine() {
    const m = this.Data.get("mode");
    if (m === 1) { const d = this.Data.get("diff", 1); return `VS CPU ${DiffNames[d]}:  ${this.Data.get("w" + d)} WON  ·  ${this.Data.get("l" + d)} LOST`; }
    if (m === 2) return `PLAYER 1  ${this.Data.get("p1")}  –  ${this.Data.get("p2")}  PLAYER 2`;
    return `HIGH SCORE ${Fmt.n(this.Data.get("best"))}`;
  }
  protected StatsLine() { return `${this.Data.get("games")} GAMES  ·  ${this.Data.get("multis")} MULTIBALLS  ·  BEST BALL ${Fmt.n(this.Data.get("bestBall"))}`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__pinball = this;
      void import("./PinballPromo").then((m) => { w.__pinballPromo = m.renderPinPromo; });
    }
    CasualLook.calm(this, 1.05, 0.3);
    this.world = new GameObject("PinWorld", this.gameObject);
    this.bgCover = CasualLook.cover(this.world, BackSprite(), -910);
    this.sideL = Art.spr(this.world, "SideL", SideSprite(false), Color.white, 1, -800, Art.Flat);
    this.sideR = Art.spr(this.world, "SideR", SideSprite(true), Color.white, 1, -800, Art.Flat);
    this.table = new GameObject("Table", this.world);
    this.attract = new PinSim(7);
    this.attractBot = new PinBot(PinBotLevels[2], 3);
    this.attract.newBall();
    const t = this.table, tab = this.attract.t;
    const pf = Art.spr(t, "Playfield", PlayfieldSprite(tab), Color.white, 1, 0, Art.Flat);
    pf.transform.localPosition = PFCenter.toV3();
    const ramp = Art.spr(t, "Ramp", RampSprite(tab), Color.white, 1, 20, Art.Flat);
    ramp.transform.localPosition = PFCenter.toV3();
    this.fx = CasualFx.create(t, 40, 200);

    // inserts
    const light = (key: string, p: V2, size: number, c: Color, arrow = false, ang = 0) => {
      const sr = Art.spr(t, "Light-" + key, arrow ? ArrowLight() : LightSprite(), c.withAlpha(0), size, 2, Art.Additive);
      sr.transform.localPosition = p.toV3();
      sr.transform.localEulerZ = ang;
      this.lights.set(key, { sr, on: 0, color: c });
    };
    Inserts.lanes.forEach((p, i) => light("lane" + i, p, 0.95, Neon.cyan));
    Inserts.mult.forEach((p, i) => light("mult" + i, p, 1.05, Gold));
    Inserts.missions.forEach((p, i) => light("mis" + i, p, 0.6, Neon.pink));
    light("shootAgain", Inserts.shootAgain, 1.3, Neon.red);
    const rampAng = Math.atan2(RampCenter[2][1] - RampCenter[0][1], RampCenter[2][0] - RampCenter[0][0]) * Mathf.Rad2Deg;
    light("ramp", Inserts.ramp, 1.1, Neon.lime, true, rampAng);
    light("orbit", Inserts.orbit, 1.0, Neon.violet, true, 90);
    light("drops", Inserts.drops, 1.0, Neon.orange, true, 90);
    light("bumpers", Inserts.bumpers, 1.0, Neon.pink, true, 90);
    light("lanesArrow", Inserts.lanesArrow, 0.9, Neon.cyan, true, 90);
    light("spinner", Inserts.spinner, 0.7, Neon.violet, true, 90);

    // bumpers
    Bumpers.forEach(([x, y]) => {
      const g = Art.spr(t, "BumperGlow", LightSprite(), Neon.pink.withAlpha(0), BumperR * 4, 4, Art.Additive);
      g.transform.localPosition = new V3(x, y, 0);
      this.bumperGlow.push(g);
      const c = Art.spr(t, "Bumper", BumperCap(), Color.white, BumperR * 2, 6, Art.Flat);
      c.transform.localPosition = new V3(x, y, 0);
      this.bumperCaps.push(c);
    });
    DropTargets.forEach(([x, y]) => {
      const d = Art.spr(t, "Drop", DropTargetSprite(), Neon.orange, 0.78, 6, Art.Flat);
      d.transform.localPosition = new V3(x, y, 0);
      this.drops.push(d);
    });
    this.spinner = Art.spr(t, "Spinner", SpinnerSprite(), Color.white, Spinner.x1 - Spinner.x0, 7, Art.Flat);
    this.spinner.transform.localPosition = new V3((Spinner.x0 + Spinner.x1) / 2, Spinner.y, 0);
    for (const tri of tab.slings) {
      const g = Art.spr(t, "SlingGlow", LightSprite(), Neon.pink.withAlpha(0), 2.2, 3, Art.Additive);
      g.transform.localPosition = new V3((tri[0][0] + tri[2][0]) / 2, (tri[0][1] + tri[2][1]) / 2, 0);
      this.slingGlow.push(g);
    }
    this.plunger = Art.spr(t, "Plunger", PlungerSprite(), Color.white, 0.5, 8, Art.Flat);

    // flippers: pivot objects with the sprite offset so its left end sits on the pivot
    for (const f of this.attract.flippers) {
      const pivot = new GameObject("Flipper", t);
      pivot.localPosition = new V3(f.px, f.py, 0);
      const sr = Art.spr(pivot, "Sprite", FlipperSprite(), Color.white, FlipperSpriteW, 9, Art.Flat);
      sr.transform.localPosition = new V3(FlipperSpriteW / 2 - 0.24, 0, 0);
      if (f.side < 0) sr.flipY = true;
      this.flippers.push(pivot);
      this.flipperSr.push(sr);
    }
    for (let i = 0; i < MaxBalls; i++) {
      const root = new GameObject("Ball", t);
      const shadow = Art.spr(root, "Shadow", CasualArt.Soft, new Color(0, 0, 0, 0.45), BallR * 2.6, 11, Art.Flat);
      shadow.transform.localPosition = new V3(0.07, -0.1, 0);
      const trail: SpriteRenderer[] = [];
      for (let k = 0; k < 5; k++) trail.push(Art.spr(t, "Trail", LightSprite(), Neon.cyan.withAlpha(0), BallR * 2.2, 11, Art.Additive));
      const glow = Art.spr(root, "Glow", LightSprite(), Neon.cyan.withAlpha(0.25), BallR * 4, 11, Art.Additive);
      const ball = Art.spr(root, "Ball", BallSprite(), Color.white, BallR * 2, 12, Art.Flat);
      root.setActive(false);
      this.views.push({ root, ball, shadow, glow, trail, hist: [] });
    }
    this.BuildHud();
    this.BuildTitle();
    this.BuildSounds();
    this.Layout();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.dmd = UIKit.node("DMD", hud).place(new V2(0.5, 1), new V2(-40, -110), new V2(820, 190));
    this.dmdBg = UIKit.img(this.dmd, "Bg", Art.UiRound, new Color(0.05, 0.02, 0.02, 0.88));
    this.dmdBg.rectTransform.stretch();
    UIKit.img(this.dmd, "Edge", Art.UiOutline, Amber.withAlpha(0.55)).rectTransform.stretch();
    this.dmdScore = UIKit.at(UIKit.label(this.dmd, "0", 70, Amber), UIKit.Center, new V2(0, 30), new V2(800, 90));
    UIKit.glow(this.dmdScore, Pal.hex(0x6a2a00), 3);
    this.dmdLine = UIKit.at(UIKit.label(this.dmd, "", 26, Amber.withAlpha(0.85)), UIKit.Center, new V2(0, -36), new V2(800, 36));
    this.dmdMission = UIKit.at(UIKit.label(this.dmd, "", 24, Pal.hex(0xffd8a0)), UIKit.Center, new V2(0, -70), new V2(800, 34));
    this.dmdMsg = UIKit.at(UIKit.label(this.dmd, "", 60, Gold), UIKit.Center, new V2(0, 0), new V2(800, 150));
    UIKit.wrap(this.dmdMsg);
    UIKit.glow(this.dmdMsg, Pal.hex(0x6a2a00), 4);
    this.ffButton = UIKit.buttonAt(hud, "FAST ▶▶", new V2(0.5, 0), new V2(0, 90), new V2(300, 96), false, () => this.ToggleFast(), 30);
    this.ffButton.setAccent(Neon.violet);
    this.ffButton.node.setActive(false);
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    for (let i = 0; i < 3; i++) this.modeButtons.push(UIKit.buttonAt(ex, ModeNames[i], UIKit.Center, new V2((i - 1) * 325, 18), new V2(305, 96), false, () => this.PickMode(i), 32));
    for (let i = 0; i < 3; i++) this.diffButtons.push(UIKit.buttonAt(ex, DiffNames[i], UIKit.Center, new V2((i - 1) * 190, -66), new V2(176, 58), false, () => this.PickDiff(i), 22));
    CasualLook.titleCard(this.UI, new Color(0.03, 0.02, 0.1, 0.74), new V2(1060, 1080), -20);
    this.RefreshTitle();
  }

  private PickMode(i: number) { this.Data.set("mode", i); Sfx.play(Snd.Click, 0.6); this.RefreshTitle(); }
  private PickDiff(i: number) { this.Data.set("diff", i); Sfx.play(Snd.Click, 0.6); this.RefreshTitle(); }

  private RefreshTitle() {
    const m = this.Data.get("mode"), d = this.Data.get("diff", 1);
    const dim = new Color(0.55, 0.55, 0.75, 1);
    this.modeButtons.forEach((b, i) => {
      b.setAccent(i === m ? Neon.cyan : dim);
      b.node.localScale = i === m ? new V3(1.05, 1.05, 1) : V3.one;
      if (b.label) b.label.color = i === m ? Color.white : new Color(1, 1, 1, 0.6);
    });
    this.diffButtons.forEach((b, i) => {
      b.node.setActive(m === 1);
      b.setAccent(i === d ? Gold : dim);
      if (b.label) b.label.color = i === d ? Color.white : new Color(1, 1, 1, 0.55);
    });
    if (this.State === Phase.Title) this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private BuildSounds() {
    const nz = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    this.sFlip = Sfx.make("pb-flip", 0.09, (t) => (nz(Math.trunc(t * 44100)) * 0.5 * Sfx.env(t, 0.0005, 0.02) + Sfx.sinP(Sfx.glide(t, 180, 90, 0.05)) * 0.6) * Sfx.env(t, 0.001, 0.07) * 0.6);
    this.sBumper = Sfx.make("pb-bumper", 0.3, (t) => (Sfx.sinP(Sfx.glide(t, 220, 80, 0.08)) * 0.7 * Sfx.env(t, 0.001, 0.1) + Sfx.sqrP(1046 * t) * 0.12 * Sfx.env(t - 0.01, 0.002, 0.2) + Sfx.sinP(1568 * t) * 0.15 * Sfx.env(t - 0.01, 0.002, 0.22)) * 0.8);
    this.sSling = Sfx.make("pb-sling", 0.14, (t) => (nz(Math.trunc(t * 44100) + 9) * 0.5 * Sfx.env(t, 0.0005, 0.03) + Sfx.sqrP(Sfx.glide(t, 520, 260, 0.08)) * 0.25) * Sfx.env(t, 0.001, 0.12) * 0.6);
    this.sDrop = Sfx.make("pb-drop", 0.2, (t) => (Sfx.sinP(Sfx.glide(t, 300, 120, 0.12)) * 0.6 + nz(Math.trunc(t * 44100) + 3) * 0.3 * Sfx.env(t, 0.0005, 0.03)) * Sfx.env(t, 0.001, 0.18) * 0.7);
    this.sSpin = Sfx.make("pb-spin", 0.04, (t) => Sfx.sqrP(1900 * t) * Sfx.env(t, 0.0005, 0.03) * 0.12);
    this.sRamp = Sfx.make("pb-ramp", 0.7, (t) => {
      const notes = [523, 659, 784, 1047, 1319];
      let v = 0;
      for (let i = 0; i < notes.length; i++) { const d = i * 0.07; v += (Sfx.sqrP(notes[i] * (t - d)) * 0.1 + Sfx.sinP(notes[i] * (t - d)) * 0.22) * Sfx.env(t - d, 0.002, i === 4 ? 0.4 : 0.09); }
      return v * 0.8;
    });
    this.sLane = Sfx.make("pb-lane", 0.3, (t) => (Sfx.sinP(1760 * t) * 0.3 + Sfx.sinP(2637 * t) * 0.15) * Sfx.env(t, 0.002, 0.28));
    this.sDrain = Sfx.make("pb-drain", 0.9, (t) => (Sfx.triP(Sfx.glide(t, 440, 110, 0.8)) * 0.45 + Sfx.sqrP(Sfx.glide(t, 220, 55, 0.8)) * 0.08) * Sfx.env(t, 0.01, 0.85) * 0.7);
    this.sLaunch = Sfx.make("pb-launch", 0.35, (t) => (nz(Math.trunc(t * 44100) + 1) * 0.4 * Sfx.env(t, 0.001, 0.08) + Sfx.sinP(Sfx.glide(t, 120, 520, 0.25)) * 0.4) * Sfx.env(t, 0.002, 0.3) * 0.6);
    this.sMulti = Sfx.make("pb-multi", 1.2, (t) => {
      const f = 600 + 300 * Math.sin(t * Math.PI * 8);
      return (Sfx.sqrP(f * t) * 0.12 + Sfx.sinP(f * 2 * t) * 0.15) * Sfx.env(t, 0.01, 1.15) * 0.9;
    });
    this.sMission = Sfx.make("pb-mission", 1.0, (t) => {
      const notes = [392, 523, 659, 784, 659, 784, 1047];
      let v = 0;
      for (let i = 0; i < notes.length; i++) { const d = i * 0.1; v += (Sfx.sqrP(notes[i] * (t - d)) * 0.12 + Sfx.sinP(notes[i] * 2 * (t - d)) * 0.12) * Sfx.env(t - d, 0.003, i === 6 ? 0.35 : 0.09); }
      return v * 0.8;
    });
    this.sHit = Sfx.make("pb-hit", 0.05, (t) => (Sfx.sinP(2600 * t) * 0.3 + nz(Math.trunc(t * 44100) + 4) * 0.3) * Sfx.env(t, 0.0003, 0.03) * 0.5);
    this.sBonus = Sfx.make("pb-bonus", 0.06, (t) => Sfx.sqrP(1320 * t) * Sfx.env(t, 0.001, 0.05) * 0.15);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    if (!this.table) return;
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    this.portrait = Screen.height >= Screen.width * 1.05;
    const upu = Math.min(this.ViewSize.x, this.ViewSize.y) / 1080;
    if (this.portrait) {
      const r = this.PlayRect(250, 8, 0.04);
      const s = Math.min(r.width / TableW, r.height / TableH);
      this.table.localScale = new V3(s, s, 1);
      this.table.localPosition = new V3(r.center.x - PFCenter.x * s, r.yMin + TableH * s / 2 - PFCenter.y * s + (r.height - TableH * s) / 2, 0);
      this.sideL.enabled = this.sideR.enabled = false;
      this.dmd.place(new V2(0.5, 1), new V2(-30, -112), new V2(Math.min(820, 1080 * Screen.width / Math.max(1, Math.min(Screen.width, Screen.height)) - 260), 190));
    } else {
      const r = this.PlayRect(6, 6, 0.04);
      const s = Math.min(r.width / TableW, r.height / TableH);
      this.table.localScale = new V3(s, s, 1);
      this.table.localPosition = new V3(-PFCenter.x * s, r.center.y - PFCenter.y * s, 0);
      const tw = TableW * s, sideW = (this.ViewSize.x - tw) / 2;
      this.sideL.enabled = this.sideR.enabled = sideW > 0.5;
      const sh = this.ViewSize.y * 1.02, sw = sh * 0.5;
      const scale = sh / 21.4;
      for (const [sr, sx] of [[this.sideL, -tw / 2 - sw / 2], [this.sideR, tw / 2 + sw / 2]] as [SpriteRenderer, number][]) {
        sr.transform.localScale = new V3(scale, scale, 1);
        sr.transform.localPosition = new V3(sx, 0, 0);
      }
      // the display sits on the left side panel
      const left = this.UI.WorldToHud(new V2(-tw / 2, 0));
      const hudW = this.UI.Hud.rect.width;
      const avail = Math.max(300, (hudW / 2 + left.x) - 40);
      const w = Math.min(560, avail);
      this.dmd.place(new V2(0.5, 0.5), new V2(left.x - w / 2 - 20, 150), new V2(w, 230));
    }
    void upu;
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.RefreshTitle();
    this.attract = new PinSim((Math.random() * 1e6) | 0);
    this.attract.newBall();
    this.SpeedMultiplier = 1;
    Sfx.setIntensity(0.1);
    this.Layout();
  }

  protected TickBackground(dt: number) {
    if (this.State === Phase.Over) { this.Render(this.sims[this.cur] ?? this.attract, dt, false); return; }
    const a = this.attract;
    dt = Math.min(dt, 0.05);
    this.attractBot.think(a, dt);
    a.step(dt);
    a.events.length = 0;
    if (a.drained) a.newBall();
    this.Render(a, dt, false);
  }

  protected BeginRun() {
    this.mode = Mathf.clamp(this.Data.get("mode"), 0, 2);
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.players = this.mode === 0 ? 1 : 2;
    this.sims = [];
    for (let p = 0; p < this.players; p++) this.sims.push(new PinSim(((Math.random() * 1e6) | 0) + p));
    this.ballNo = this.sims.map(() => 1);
    this.extraBalls = this.sims.map(() => 0);
    this.bot = this.mode === 1 ? new PinBot(PinBotLevels[this.diff], (Math.random() * 1e6) | 0) : null;
    this.cur = 0;
    this.revives = 0;
    this.msgQueue = [];
    this.msgT = 0;
    this.SpeedMultiplier = 1;
    this.Data.add("games", 1);
    this.StartTurn();
    Sfx.setIntensity(0.4);
    this.Layout();
    if (this.Data.get("games") <= 2) this.UI.Hint("HOLD to pull the plunger, let go to launch. Tap left / right to flip!");
  }

  private get Sim() { return this.sims[this.cur]; }
  private get BotTurn() { return this.mode === 1 && this.cur === 1; }
  private PlayerName(p: number) { return this.mode === 0 ? "" : this.mode === 1 ? (p === 0 ? "YOU" : "CPU") : `PLAYER ${p + 1}`; }

  private StartTurn() {
    const sim = this.Sim;
    sim.newBall();
    this.phase = "play";
    this.keyL = this.keyR = this.keyP = false;
    const who = this.PlayerName(this.cur);
    this.Message(who ? `${who} · BALL ${this.ballNo[this.cur]}` : `BALL ${this.ballNo[this.cur]}`, 1.6, Amber);
    this.ffButton.node.setActive(this.BotTurn);
    if (!this.BotTurn) this.SpeedMultiplier = 1;
  }

  private ToggleFast() {
    this.SpeedMultiplier = this.SpeedMultiplier > 1 ? 1 : 2.5;
    if (this.ffButton.label) this.ffButton.label.text = this.SpeedMultiplier > 1 ? "NORMAL ▶" : "FAST ▶▶";
  }

  // ------------------------------------------------------------------ frame

  protected TickRun(dt: number) {
    dt = Math.min(dt, 0.05);
    const sim = this.Sim;
    if (this.phase === "play") {
      if (this.BotTurn) this.bot!.think(sim, dt);
      else this.ReadInput(sim);
      sim.step(dt);
      for (const e of sim.events) this.OnEvent(sim, e);
      sim.events.length = 0;
      if (sim.drained) this.EndBall();
    } else {
      sim.setFlipper(0, false);
      sim.setFlipper(1, false);
      sim.step(dt);
      sim.events.length = 0;
      this.phaseT -= dt;
      if (this.phase === "bonus" && this.phaseT <= 0) this.AfterBonus();
      else if (this.phase === "between" && this.phaseT <= 0) this.StartTurn();
    }
    this.Render(sim, dt, true);
    this.TickDisplay(dt);
  }

  private ReadInput(sim: PinSim) {
    const K = Keyboard;
    let left = K.letter("z").isPressed || K.left.isPressed || K.leftShift.isPressed || K.letter("a").isPressed;
    let right = K.letter("x").isPressed || K.right.isPressed || K.rightShift.isPressed || K.key("Slash").isPressed || K.letter("m").isPressed || K.letter("d").isPressed;
    let plunge = K.space.isPressed || K.down.isPressed || K.enter.isPressed || K.letter("s").isPressed;
    const lane = sim.needLaunch && sim.ballInLane;
    // multi-touch: every finger counts; while the ball waits on the plunger any hold pulls it
    for (const t of Touchscreen.touches) {
      const held = t.press.isPressed && !t.press.wasReleasedThisFrame;
      if (!held) continue;
      const start = t.startPosition;
      if (start.y > Screen.height * 0.9 || overUI(start)) continue;
      if (lane) plunge = true;
      else if (t.position.x < Screen.width / 2) left = true;
      else right = true;
    }
    if (Mouse.present && Mouse.leftButton.isPressed && !(Touchscreen.present && Touchscreen.touches.length)) {
      const p = Mouse.position;
      if (!overUI(p) && p.y < Screen.height * 0.9) {
        if (lane) plunge = true;
        else if (p.x < Screen.width / 2) left = true;
        else right = true;
      }
    }
    if (left !== this.keyL) { sim.setFlipper(0, left); this.keyL = left; }
    if (right !== this.keyR) { sim.setFlipper(1, right); this.keyR = right; }
    if (plunge !== this.keyP) { sim.setPlunger(plunge); this.keyP = plunge; }
  }

  private Render(sim: PinSim, dt: number, live: boolean) {
    const t = Time.time;
    // flippers
    sim.flippers.forEach((f, i) => { this.flippers[i].localEulerZ = f.angle * Mathf.Rad2Deg; });
    // balls
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i], b = sim.balls[i];
      v.root.setActive(!!b);
      if (!b) { v.hist = []; for (const tr of v.trail) tr.color = Neon.cyan.withAlpha(0); continue; }
      v.root.localPosition = new V3(b.x, b.y, 0);
      const onRamp = b.layer === 2;
      v.ball.sortingOrder = onRamp ? 26 : 12;
      v.glow.sortingOrder = onRamp ? 25 : 11;
      v.shadow.sortingOrder = onRamp ? 24 : 11;
      v.shadow.transform.localPosition = new V3(onRamp ? 0.22 : 0.07, onRamp ? -0.28 : -0.1, 0);
      const s = onRamp ? 1.12 : 1;
      v.ball.transform.localScale = new V3(BallR * 2 * s, BallR * 2 * s, 1);
      const sp = Math.hypot(b.vx, b.vy);
      v.glow.color = (sim.multiball ? Gold : Neon.cyan).withAlpha(0.15 + Math.min(0.35, sp / 80));
      v.hist.unshift(new V2(b.x, b.y));
      if (v.hist.length > 12) v.hist.length = 12;
      v.trail.forEach((tr, k) => {
        const p = v.hist[Math.min(v.hist.length - 1, (k + 1) * 2)];
        tr.transform.localPosition = p.toV3();
        tr.sortingOrder = onRamp ? 25 : 11;
        tr.color = (sim.multiball ? Gold : Neon.cyan).withAlpha(Math.min(0.28, sp / 140) * (1 - k / 5));
      });
    }
    // bumpers, slings, drops, spinner, plunger
    for (let i = 0; i < 3; i++) {
      const f = sim.bumperFlash[i];
      this.bumperGlow[i].color = Neon.pink.withAlpha(0.18 + f * 0.8);
      const sc = BumperR * 2 * (1 - f * 0.12);
      this.bumperCaps[i].transform.localScale = new V3(sc, sc, 1);
    }
    for (let i = 0; i < 2; i++) this.slingGlow[i].color = Neon.pink.withAlpha(sim.slingFlash[i] * 0.9);
    for (let i = 0; i < 3; i++) {
      const down = sim.drops[i];
      const d = this.drops[i];
      const target = down ? 0.15 : 1;
      const cur = d.transform.localScale.y / 0.78;
      const ny = Mathf.moveTowards(cur, target, dt * 8);
      d.transform.localScale = new V3(0.78, 0.78 * ny, 1);
      d.color = down ? Neon.orange.withAlpha(0.35) : Color.lerp(Neon.orange, Color.white, sim.dropReset > 0 ? 0.5 + 0.5 * Math.sin(t * 20) : 0);
    }
    this.spinner.transform.localScale = new V3(Spinner.x1 - Spinner.x0, (Spinner.x1 - Spinner.x0) * Math.max(0.12, Math.abs(Math.cos(sim.spinAngle))), 1);
    this.plunger.transform.localPosition = new V3(ShooterX, PlungerY - 1.85 - sim.plungerPull * 0.7, 0);
    this.plunger.transform.localScale = new V3(0.5, 0.5, 1);
    // lights
    const blink = (hz: number) => (Math.sin(t * Math.PI * 2 * hz) > 0 ? 1 : 0.15);
    const setL = (key: string, v: number) => { const l = this.lights.get(key); if (l) l.on = v; };
    for (let i = 0; i < 3; i++) setL("lane" + i, sim.lanes[i] ? 1 : 0);
    for (let i = 0; i < 4; i++) setL("mult" + i, sim.mult >= i + 2 ? 1 : 0);
    for (let i = 0; i < 6; i++) setL("mis" + i, i < sim.missionsDone % 6 || (sim.missionsDone >= 6 && i < 6) ? 1 : i === sim.mission ? blink(2) * 0.6 : 0);
    setL("shootAgain", sim.saveT > 0 ? (sim.saveT < 3 ? blink(4) : 1) : 0);
    for (const k of MissionInsert) setL(k, 0);
    setL(MissionInsert[sim.mission], blink(2.5));
    if (sim.multiball) setL("ramp", blink(6));
    if (sim.comboT > 0) { setL("ramp", Math.max(this.lights.get("ramp")!.on, blink(4))); setL("orbit", Math.max(this.lights.get("orbit")!.on, blink(4))); }
    for (const l of this.lights.values()) {
      const cur = l.sr.color.a;
      const a = Mathf.moveTowards(cur, l.on * 0.95, dt * 8);
      l.sr.color = l.color.withAlpha(a);
    }
    if (!live) return;
  }

  // ------------------------------------------------------------------ events

  private OnEvent(sim: PinSim, e: PinEvent) {
    const bot = this.BotTurn, v = bot ? 0.6 : 1;
    switch (e.k) {
      case "flip": Sfx.playClip(this.sFlip, 0.55 * v, 0.95 + Math.random() * 0.1); break;
      case "flipHit": Sfx.playClip(this.sHit, Math.min(1, e.speed / 20) * 0.6 * v); break;
      case "hit": Sfx.playClip(this.sHit, Math.min(1, e.speed / 25) * 0.4 * v, 0.7); break;
      case "bumper": {
        Sfx.playClip(this.sBumper, 0.8 * v, 0.95 + e.id * 0.06);
        const [x, y] = Bumpers[e.id];
        this.fx.pop(new V2(x, y), Neon.pink, 10, 4, 0.14, 0.35);
        this.Float(new V2(x, y + 0.8), "500", Neon.pink);
        if (!bot) Fx.haptic(false);
        break;
      }
      case "sling": {
        Sfx.playClip(this.sSling, 0.7 * v);
        const tri = sim.t.slings[e.side];
        this.fx.pop(new V2((tri[0][0] + tri[2][0]) / 2, (tri[0][1] + tri[2][1]) / 2), Color.white, 6, 3, 0.1, 0.25);
        break;
      }
      case "drop": {
        Sfx.playClip(this.sDrop, 0.8 * v);
        const [x, y] = DropTargets[e.id];
        this.fx.pop(new V2(x, y), Neon.orange, 10, 3, 0.14, 0.4);
        break;
      }
      case "bank":
        Sfx.playClip(this.sMission, 0.6 * v);
        this.Message("TARGETS DOWN\n10,000", 1.4, Neon.orange);
        break;
      case "lane": {
        Sfx.playClip(this.sLane, 0.7 * v, 1 + e.id * 0.12);
        if (e.all) { this.Message(`ORB LANES!\nBONUS ${sim.mult}X`, 1.6, Neon.cyan); this.Fx.kick(0.4); }
        break;
      }
      case "spin": Sfx.playClip(this.sSpin, 0.6 * v, 0.9 + Math.random() * 0.2); break;
      case "ramp": {
        Sfx.playClip(this.sRamp, 0.9 * v);
        const p = new V2(-3.47, -2.6);
        this.fx.confetti(p, 14, 5, [Neon.lime, Gold, Color.white], 0.16);
        if (e.jackpot) { this.Message("JACKPOT!\n25,000", 1.8, Gold); this.Fx.shake(0.25); this.Back.Flash(Gold, 0.3); }
        else this.Message(e.combo > 1 ? `RAMP COMBO ${e.combo}X` : "RAMP 5,000", 1.2, Neon.lime);
        break;
      }
      case "orbit":
        Sfx.playClip(this.sRamp, 0.7 * v, 1.2);
        this.Message(e.combo > 1 ? `ORBIT COMBO ${e.combo}X` : "ORBIT 3,000", 1.2, Neon.violet);
        break;
      case "rampFail": break;
      case "inlane": Sfx.playClip(this.sLane, 0.35 * v, 0.8); break;
      case "outlane": Sfx.play(Snd.Warn, 0.4 * v); break;
      case "launch": Sfx.playClip(this.sLaunch, 0.8 * v); this.UI.Hint(null); break;
      case "mission":
        Sfx.playClip(this.sMission, 0.9 * v);
        this.Message(`${Missions[e.idx].name} DONE!\n${Fmt.n(e.pts)}`, 2.2, Gold);
        this.fx.confetti(new V2(0, 0), 40, 7, [Neon.pink, Neon.cyan, Gold, Neon.lime], 0.2);
        this.Back.Flash(Neon.pink, 0.25);
        break;
      case "multiball":
        Sfx.playClip(this.sMulti, 0.9 * v);
        this.Message("MULTIBALL!", 2.4, Gold);
        this.UI.Announce("MULTIBALL!", Gold, 1.6);
        this.Fx.shake(0.3);
        if (!bot) this.Data.add("multis", 1);
        break;
      case "drain":
        if (e.saved) { this.Message("BALL SAVED", 1.4, Neon.lime); Sfx.play(Snd.PowerUp, 0.6 * v); }
        else if (e.last) { Sfx.playClip(this.sDrain, 0.8 * v); if (!bot) { this.Fx.shake(0.2); Fx.haptic(true); } }
        else Sfx.play(Snd.Hurt, 0.4 * v);
        break;
    }
  }

  private Float(local: V2, text: string, c: Color) {
    const w = this.table.transformPoint(local);
    this.UI.Float(w.xy, text, c, 0.8);
  }

  // ------------------------------------------------------------------ turns

  private EndBall() {
    const sim = this.Sim;
    const bonus = sim.endBonus;
    this.Message(`BONUS ${Fmt.n(sim.bonus)} × ${sim.mult}\n${Fmt.n(bonus)}`, 2.0, Amber);
    if (bonus > 0) for (let i = 0; i < 8; i++) this.startCoroutine(this.Tick(i * 0.08));
    sim.collectBonus();
    if (!this.BotTurn) this.Data.max("bestBall", sim.score);
    this.phase = "bonus";
    this.phaseT = 2.0;
    this.ffButton.node.setActive(false);
  }

  private *Tick(d: number) { yield wait(d); Sfx.playClip(this.sBonus, 0.6, 1 + d); }

  private AfterBonus() {
    this.ballNo[this.cur]++;
    // next player who still has balls
    const left = (p: number) => this.ballNo[p] <= BallsPerGame + this.extraBalls[p];
    let next = -1;
    for (let k = 1; k <= this.players; k++) { const p = (this.cur + k) % this.players; if (left(p)) { next = p; break; } }
    if (next < 0) { this.phase = "done"; this.EndGame(); return; }
    this.cur = next;
    this.phase = "between";
    this.phaseT = 0.6;
    if (this.players > 1) this.UI.Announce(`${this.PlayerName(next)} UP`, next === 0 ? Neon.cyan : Neon.pink, 1.1);
    this.SpeedMultiplier = 1;
  }

  private EndGame() {
    this.ffButton.node.setActive(false);
    this.SpeedMultiplier = 1;
    if (this.mode === 0) {
      const sc = this.sims[0].score;
      const best = this.Data.max("best", sc);
      this.Finish(new Result({
        Headline: "GAME OVER",
        HeadlineColor: Pal.hex(0xffb0d0),
        Value: String(sc),
        CountTo: sc,
        NewBest: best,
        BestLine: `HIGH SCORE ${Fmt.n(this.Data.get("best"))}`,
        Stats: this.StatRows(this.sims[0]),
        Primary: "PLAY AGAIN",
        Reward: this.revives === 0 ? () => this.ExtraBall(0) : null,
        RewardLabel: "EXTRA BALL (WATCH AD)",
      }));
      return;
    }
    const a = this.sims[0].score, b = this.sims[1].score;
    const winner = a > b ? 0 : b > a ? 1 : -1;
    if (this.mode === 2) {
      if (winner >= 0) this.Data.add(winner === 0 ? "p1" : "p2", 1);
      this.Finish(new Result({
        Headline: winner < 0 ? "DRAW!" : `PLAYER ${winner + 1} WINS!`,
        HeadlineColor: winner === 1 ? Neon.pink : winner === 0 ? Neon.cyan : Color.white,
        Value: `${Fmt.n(a)} – ${Fmt.n(b)}`,
        BestLine: `MATCHES  P1 ${this.Data.get("p1")}  –  ${this.Data.get("p2")} P2`,
        Stats: [["P1 MISSIONS", String(this.sims[0].missionsDone)], ["P2 MISSIONS", String(this.sims[1].missionsDone)], ["P1 RAMPS", String(this.sims[0].rampsMade)], ["P2 RAMPS", String(this.sims[1].rampsMade)]],
        Primary: "REMATCH",
        Victory: winner >= 0,
      }));
      return;
    }
    const won = winner === 0, draw = winner < 0;
    if (won) this.Data.add("w" + this.diff, 1); else if (!draw) this.Data.add("l" + this.diff, 1);
    this.Data.max("best", a);
    this.Finish(new Result({
      Headline: won ? "YOU WIN!" : draw ? "DRAW!" : "CPU WINS",
      HeadlineColor: won ? Gold : draw ? Color.white : Pal.hex(0xffb0c0),
      Value: `${Fmt.n(a)} – ${Fmt.n(b)}`,
      Stars: won ? 1 + this.diff : 0,
      BestLine: `VS ${DiffNames[this.diff]}:  ${this.Data.get("w" + this.diff)} WON  ·  ${this.Data.get("l" + this.diff)} LOST`,
      Stats: [["CPU", DiffNames[this.diff]], ["MISSIONS", `${this.sims[0].missionsDone} – ${this.sims[1].missionsDone}`], ["RAMPS", `${this.sims[0].rampsMade} – ${this.sims[1].rampsMade}`], ["JACKPOTS", `${this.sims[0].jackpots} – ${this.sims[1].jackpots}`]],
      Primary: won ? "PLAY AGAIN" : "REMATCH",
      Victory: won,
      Reward: !won && this.revives === 0 ? () => this.ExtraBall(0) : null,
      RewardLabel: "EXTRA BALL (WATCH AD)",
    }));
  }

  private StatRows(s: PinSim): [string, string][] {
    return [["MISSIONS", String(s.missionsDone)], ["RAMPS", String(s.rampsMade)], ["BUMPERS", String(s.bumperHits)], ["JACKPOTS", String(s.jackpots)]];
  }

  /** Rewarded: one more ball for the player, then the game continues. */
  private ExtraBall(p: number) {
    this.revives++;
    this.extraBalls[p]++;
    this.cur = p;
    this.Revive();
    this.StartTurn();
    this.UI.Announce("EXTRA BALL!", Gold, 1.4);
    Sfx.play(Snd.PowerUp, 0.8);
  }

  // ------------------------------------------------------------------ test hooks (dev only)

  private testBot: PinBot | null = null;
  /** What a strong player would hold right now (Playwright turns it into real touches / keys). */
  TestAdvice() {
    if (this.State !== Phase.Playing || this.phase !== "play" || this.BotTurn) return null;
    this.testBot ??= new PinBot(PinBotLevels[2], 99);
    return this.testBot.decide(this.Sim, Time.deltaTime || 1 / 60);
  }
  TestInfo() {
    return { state: this.State, phase: this.phase, cur: this.cur, mode: this.mode, balls: this.ballNo, scores: this.sims.map((s) => s.score), needLaunch: this.Sim?.needLaunch, ballsOnTable: this.Sim?.balls.length, missions: this.Sim?.missionsDone, multiball: this.Sim?.multiball };
  }
  set TestSpeed(v: number) { this.SpeedMultiplier = v; }

  // ------------------------------------------------------------------ display

  private Message(text: string, t: number, color: Color) {
    this.msgQueue.push({ text, t, color });
    if (this.msgQueue.length > 4) this.msgQueue.shift();
  }

  private TickDisplay(dt: number) {
    const sim = this.Sim;
    if (this.msgT <= 0 && this.msgQueue.length) {
      const m = this.msgQueue.shift()!;
      this.msgT = m.t;
      this.dmdMsg.text = m.text;
      this.dmdMsg.color = m.color;
    }
    const showing = this.msgT > 0;
    if (showing) this.msgT -= Time.unscaledDeltaTime;
    this.dmdMsg.enabled = showing;
    this.dmdScore.enabled = this.dmdLine.enabled = this.dmdMission.enabled = !showing;
    if (showing) this.dmdMsg.rectTransform.localScale = V3.one.mul(1 + Math.sin(Time.unscaledTime * 10) * 0.02);
    this.dmdScore.text = Fmt.n(sim.score);
    const who = this.PlayerName(this.cur);
    const total = BallsPerGame + this.extraBalls[this.cur];
    const others = this.players > 1 ? `   ·   ${this.PlayerName(1 - this.cur)} ${Fmt.n(this.sims[1 - this.cur].score)}` : "";
    this.dmdLine.text = `${who ? who + "  " : ""}BALL ${Math.min(this.ballNo[this.cur], total)}/${total}${sim.mult > 1 ? `   ·   ${sim.mult}X` : ""}${others}`;
    const m = Missions[sim.mission];
    this.dmdMission.text = sim.multiball ? "MULTIBALL: SHOOT THE RAMP FOR JACKPOTS!" : sim.needLaunch ? "HOLD & RELEASE TO LAUNCH" : `MISSION: ${m.text}  ${sim.missionCount}/${m.goal}`;
    void dt;
  }
}
