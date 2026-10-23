import {
  Art, Color, Fmt, Fx, GameInfo, Image, GameObject, howTo, LineRenderer, Mathf, Pal, Random, Result, Screen, Sfx, Snd,
  SpriteRenderer, SysRandom, Text, TextMesh, Time, TouchScheme, UIKit, UINode, V2, V3, WallHit,
} from "../../kit";
import {
  ArmSprite, BallSprite, BillboardSprite, CamH, CpuCol, D0, DotSprite, F, FrameSprite, GlovesSprite, HeadSprite,
  HorizonY, LegSprite, LineY, P1Col, P2Col, SceneSprite, ShadowSprite, TargetSprite, TorsoSprite,
} from "./KeeperArt";
import { brandColor, brandWord, DiffNames, Gold, Ink, Red, RoundStep, WallGame, White } from "./WallKit";

/**
 * GOALKEEPER SAVE (LiDAR wall): the street-football keeper who got dragged in when the team was short. Each player
 * defends a goal on their half of the wall. A striker runs up and shoots; a target marker shows where the shot will
 * cross the line a moment before the kick, and the ball flies along a visible path. Throw your ball at the shot
 * before it crosses the line: a hit near the ball deflects it. SAVE! Shots get trickier: curl, dips, two at once.
 * SOLO: as many saves as you can in 2:00 (three goals in a row = STREAK BREAK). VS COMPUTER: a virtual keeper
 * defends the other goal at a set skill. 2 PLAYERS: split wall. Most saves wins.
 */

const RoundTime = 120;
const BallR = 0.11 * 3.2;          // drawn ball radius in court metres (exaggerated for the wall)
const StrikerK = 1.75;              // striker drawn size
const ThrowFlight = 0.42;           // a computer keeper's ball in the air
const SaveReach = 1.35;             // extra world units around the ball that still count as a save
const CpuReact = [0.6, 0.38, 0.22], CpuErr = [3.1, 3.0, 2.7], CpuBlunder = [0.25, 0.14, 0.08], CpuRetry = [false, true, true];
const Shirts = [Pal.hex(0xff6b3d), Pal.hex(0x2ec4b6)];
const Skins = [Pal.hex(0xc98a5e), Pal.hex(0xf0c29a)];
const Hairs = [Pal.hex(0x1d1410), Pal.hex(0x6b3d1e)];

interface Striker {
  root: GameObject; legB: GameObject; legF: GameObject; armB: GameObject; armF: GameObject; torso: GameObject; shadow: SpriteRenderer;
  X: number; Z: number; fromX: number; fromZ: number; toX: number; toZ: number; moveT: number; moveDur: number;
  run: number; kick: number; kicking: boolean; on: boolean; dir: number;
}

enum ShotState { Aim, Fly, Saved, Goal, Gone }

interface Shot {
  state: ShotState; striker: Striker;
  t: number; kickIn: number; lead: number; dur: number; fly: number; rt: number;
  X0: number; Z0: number; TX: number; TY: number; curl: number; lift: number;
  ball: SpriteRenderer; shadow: SpriteRenderer; marker: SpriteRenderer; trail: LineRenderer; dots: SpriteRenderer[]; trailPts: V2[];
  pos: V2; vel: V2; scale: number; spin: number; cpuTries: number; cpuNext: number;
}

interface Lane {
  idx: number; cx: number; col: Color; colKey: string; name: string; cpu: number; // cpu level or -1
  root: GameObject; scene: SpriteRenderer; frame: SpriteRenderer; flash: SpriteRenderer; gloves: SpriteRenderer; glovesT: number;
  billboard: GameObject; brand: TextMesh;
  strikers: Striker[]; shots: Shot[];
  saves: number; faced: number; conceded: number; row: number; streak: number; bestStreak: number; netShake: number;
  // HUD
  panel: UINode; nameT: Text; scoreT: Text; capT: Text; pop: number;
}

interface Plan { X0: number; TX: number; TY: number; curl: number; lift: number; dur: number; lead: number }

export class KeeperGame extends WallGame {
  private lanes: Lane[] = [];
  private world!: GameObject;
  private divider!: SpriteRenderer;
  private soloScene!: SpriteRenderer;
  private clock = RoundTime;
  private heat = 0;
  private gap = 0;
  private rng = new SysRandom(1);
  private timerPanel!: UINode; private timerT!: Text;
  private streakPanel!: UINode; private streakT!: Text; private rowDots: Image[] = [];
  private split = true;
  private layoutFrames = 3;
  private lastTick = 0;

  protected get GameId() { return "wallkeeper"; }

  protected Describe() {
    return new GameInfo({
      Id: "wallkeeper",
      Title: "GOALKEEPER SAVE",
      Tagline: "HIT THE SHOT WITH YOUR BALL. MAKE THE SAVE!",
      PlayLabel: "PLAY",
      Accent: Pal.hex(0x6cff4a),
      Accent2: P1Col,
      BgTop: Pal.hex(0x2b2466),
      BgBottom: Pal.hex(0x0b0d1c),
      GridSpacing: 2,
      ShortSide: 18,
      Touch: TouchScheme.None,
      PauseButton: true,
      Music: { bpm: 118, rootHz: 110, degrees: [0, 5, 3, 4], seed: 21, energy: 0.75, major: true },
      HowTo: [
        howTo(Art.Disc, P1Col, "A striker runs up and shoots at your goal. The ring shows where the shot is going."),
        howTo(GlovesSprite(), Pal.hex(0x6cff4a), "Throw your ball at the flying shot before it crosses the line: a hit near the ball is a SAVE!"),
        howTo(Art.Chevron, Gold, "Shots get trickier: curlers, dipping lobs, then two strikers at once."),
        howTo(Art.Square, P2Col, "2 PLAYERS: left half is player 1's goal, right half player 2's. Most saves in 2:00 wins."),
        howTo(Art.Diamond, CpuCol, "VS COMPUTER: a virtual keeper defends the other goal. SOLO: three goals in a row is a STREAK BREAK."),
      ],
      Tips: ["Throw where the ball is going, not where it is.", "Watch the ring: it appears before the kick."],
    });
  }

  protected get ShortSide() {
    const aspect = Screen.width / Math.max(1, Screen.height);
    return aspect >= 1 ? Math.max(18, 32 / aspect) : 32;
  }
  protected BestLine() { return `BEST SOLO ${this.Data.get("best0")} SAVES   ·   WINS VS COMPUTER ${this.Data.get("cpuWins")}`; }
  protected ExtraStats() { return `${this.Data.get("rounds")} ROUNDS   ·   ${Fmt.n(this.Data.get("allSaves"))} SAVES`; }
  protected ModeLine(mode: number, diff: number) {
    return mode === 0 ? "ONE GOAL, 2 MINUTES: STOP AS MANY SHOTS AS YOU CAN"
      : mode === 1 ? `YOU (LEFT) VS A ${DiffNames[diff]} COMPUTER KEEPER (RIGHT): MOST SAVES WINS`
        : "SPLIT WALL: PLAYER 1 LEFT, PLAYER 2 RIGHT: MOST SAVES WINS";
  }
  protected FormatScore(n: number) { return String(n); }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("World", this.gameObject);
    this.soloScene = Art.spr(this.world, "SoloScene", Art.Square, Color.white, 1, -800, Art.Flat);
    this.soloScene.gameObject.setActive(false);
    for (let i = 0; i < 2; i++) this.lanes.push(this.MakeLane(i));
    this.divider = Art.spr(this.world, "Divider", Art.Square, new Color(0.03, 0.03, 0.08, 1), 1, 30, Art.Flat);
    this.divider.transform.localScale = new V3(0.35, 18.2, 1);
    const fx = new GameObject("WallFx", this.world);
    this.WallBuild(fx);
    this.BuildHud();
    this.SetView(this.Data.get("mode", 1) === 0 ? 0 : 2);
  }

  private MakeLane(i: number): Lane {
    const root = new GameObject("Lane" + i, this.world);
    const scene = Art.spr(root, "Scene", SceneSprite(8), Color.white, 16, -800, Art.Flat);
    const bb = new GameObject("Billboard", root);
    bb.localPosition = new V3(3.4, 3.4, 0);
    Art.spr(bb, "Board", BillboardSprite(), Color.white, 5.6, -790, Art.Flat);
    const brand = bb.addComponent(new TextMesh());
    brand.sortingOrder = -789; brand.fontSize = 64; brand.characterSize = 0.115;
    const strikers = [0, 1].map((k) => this.MakeStriker(root, k));
    const frame = Art.spr(root, "Frame", FrameSprite(), Color.white, 16, 10, Art.Flat);
    frame.transform.localPosition = new V3(0, -2, 0);
    const flash = Art.spr(root, "Flash", Art.Square, Red.withAlpha(0), 1, 40, Art.Flat);
    flash.transform.localScale = new V3(16, 18, 1);
    const gloves = Art.spr(root, "Gloves", GlovesSprite(), Color.white.withAlpha(0), 5, 60, Art.Flat);
    return {
      idx: i, cx: 0, col: P1Col, colKey: "p1", name: "", cpu: -1, root, scene, frame, flash, gloves, glovesT: 9, billboard: bb, brand,
      strikers, shots: [], saves: 0, faced: 0, conceded: 0, row: 0, streak: 0, bestStreak: 0, netShake: 0,
      panel: null!, nameT: null!, scoreT: null!, capT: null!, pop: 0,
    };
  }

  private MakeStriker(parent: GameObject, k: number): Striker {
    const root = new GameObject("Striker" + k, parent);
    const shadow = Art.spr(root, "Shadow", ShadowSprite(), Color.white, 1.0, 3, Art.Flat);
    shadow.transform.localScale = new V3(0.9, 0.45, 1);
    const limb = (name: string, sprite: ReturnType<typeof LegSprite>, x: number, y: number, size: number, order: number) => {
      const g = new GameObject(name, root);
      g.localPosition = new V3(x, y, 0);
      const s = Art.spr(g, "Spr", sprite, Color.white, size, order, Art.Flat);
      s.transform.localPosition = new V3(0, -size * 2 * 0.92, 0);
      return g;
    };
    const key = "s" + k;
    const armB = limb("ArmB", ArmSprite(CasualDark(Shirts[k]), CasualDark(Skins[k]), key + "b"), -0.24, 1.42, 0.15, 4);
    const legB = limb("LegB", LegSprite(CasualDark(Skins[k]), Pal.hex(0xdddddd), key + "b"), -0.09, 0.86, 0.22, 4);
    const torso = new GameObject("Torso", root);
    torso.localPosition = new V3(0, 1.1, 0);
    Art.spr(torso, "Body", TorsoSprite(Shirts[k], key), Color.white, 0.52, 5, Art.Flat);
    const head = Art.spr(torso, "Head", HeadSprite(Skins[k], Hairs[k], key), Color.white, 0.4, 7, Art.Flat);
    head.transform.localPosition = new V3(0, 0.53, 0);
    const legF = limb("LegF", LegSprite(Skins[k], Pal.hex(0xffffff), key), 0.09, 0.86, 0.22, 6);
    const armF = limb("ArmF", ArmSprite(Shirts[k], Skins[k], key), 0.24, 1.42, 0.15, 7);
    return { root, legB, legF, armB, armF, torso, shadow, X: 0, Z: 14, fromX: 0, fromZ: 14, toX: 0, toZ: 14, moveT: 1, moveDur: 1, run: 0, kick: 0, kicking: false, on: k === 0, dir: 1 };
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.timerPanel = UIKit.node("Timer", hud).place(new V2(0.5, 1), new V2(0, -95), new V2(300, 140));
    UIKit.img(this.timerPanel, "Bg", Art.UiRound, new Color(0.02, 0.02, 0.07, 0.88)).rectTransform.stretch();
    UIKit.img(this.timerPanel, "Edge", Art.UiOutline, Gold.withAlpha(0.6)).rectTransform.stretch();
    this.timerT = UIKit.at(UIKit.label(this.timerPanel, "2:00", 100, White), UIKit.Center, new V2(0, -2), new V2(300, 130));
    for (const l of this.lanes) {
      l.panel = UIKit.node("Lane" + l.idx, hud).place(UIKit.Center, V2.zero, new V2(430, 190));
      UIKit.img(l.panel, "Bg", Art.UiRound, new Color(0.02, 0.02, 0.07, 0.85)).rectTransform.stretch();
      UIKit.img(l.panel, "Edge", Art.UiOutline, Color.white.withAlpha(0.5)).rectTransform.stretch();
      l.nameT = UIKit.at(UIKit.label(l.panel, "", 36, White), new V2(0.5, 1), new V2(0, -32), new V2(420, 46));
      l.scoreT = UIKit.at(UIKit.label(l.panel, "0", 120, White), UIKit.Center, new V2(-50, -22), new V2(220, 130));
      UIKit.glow(l.scoreT, Ink, 5);
      l.capT = UIKit.at(UIKit.label(l.panel, "SAVES", 34, Pal.TextDim), UIKit.Center, new V2(110, -36), new V2(170, 50));
    }
    this.streakPanel = UIKit.node("Streak", hud).place(UIKit.Center, V2.zero, new V2(430, 190));
    UIKit.img(this.streakPanel, "Bg", Art.UiRound, new Color(0.02, 0.02, 0.07, 0.85)).rectTransform.stretch();
    UIKit.img(this.streakPanel, "Edge", Art.UiOutline, Gold.withAlpha(0.5)).rectTransform.stretch();
    UIKit.at(UIKit.label(this.streakPanel, "SAVE STREAK", 32, Gold), new V2(0.5, 1), new V2(0, -32), new V2(420, 44));
    this.streakT = UIKit.at(UIKit.label(this.streakPanel, "0", 96, White), UIKit.Center, new V2(-80, -26), new V2(200, 110));
    for (let k = 0; k < 3; k++) {
      const d = UIKit.img(this.streakPanel, "Row", Art.UiCircle, new Color(1, 1, 1, 0.2));
      d.rectTransform.place(UIKit.Center, new V2(60 + k * 56, -30), new V2(44, 44));
      this.rowDots.push(d);
    }
  }

  // ------------------------------------------------------------------ layout

  /** 0 = one centred goal (solo), 2 = split wall. */
  private SetView(mode: number) {
    this.split = mode !== 0;
    const brand = brandWord("STREET FC"), bcol = brandColor(this.Info.Accent);
    this.lanes.forEach((l, i) => {
      l.cx = this.split ? (i === 0 ? -8 : 8) : 0;
      l.root.localPosition = new V3(l.cx, 0, 0);
      l.root.setActive(this.split || i === 0);
      l.scene.gameObject.setActive(this.split);
      l.billboard.localPosition = new V3(this.split ? 3.3 : 7.5, 3.6, 0);
      l.brand.text = brand; l.brand.color = bcol;
      l.brand.characterSize = brand.length > 9 ? 0.115 * 9 / brand.length : 0.115;
    });
    this.soloScene.gameObject.setActive(!this.split);
    if (!this.split) {
      this.soloScene.sprite = SceneSprite(16);
      this.soloScene.transform.localScale = new V3(32, 32, 1);
    }
    this.divider.gameObject.setActive(this.split);
    this.Layout();
  }

  protected OnLayoutChanged() { this.Layout(); this.layoutFrames = 2; }

  private Layout() {
    if (!this.timerPanel) return;
    this.LayoutWall();
    const at = (x: number, y: number) => this.UI.WorldToHud(new V2(x, y));
    const top = 7.35;
    if (this.split) {
      for (const l of this.lanes) { l.panel.setActive(true); l.panel.anchoredPosition = at(l.cx, top); }
      this.streakPanel.setActive(false);
    } else {
      this.lanes[0].panel.setActive(true);
      this.lanes[0].panel.anchoredPosition = at(-10.6, top);
      this.lanes[1].panel.setActive(false);
      this.streakPanel.setActive(true);
      this.streakPanel.anchoredPosition = at(10.6, top);
    }
    const tp = at(0, top);
    this.timerPanel.place(UIKit.Center, tp, new V2(300, 140));
    // narrow screens (portrait phones): the wall picture is scaled down, so is its HUD
    const k = Math.min(1, (at(16, 0).x - at(-16, 0).x) / 1920);
    for (const n of [this.timerPanel, this.lanes[0].panel, this.lanes[1].panel, this.streakPanel]) n.localScale = new V3(k, k, 1);
  }

  // ------------------------------------------------------------------ rounds

  protected OnTitle() {
    this.ClearShots();
    this.SetView(this.Data.get("mode", 1) === 0 ? 0 : 2);
    this.PlaceStrikersIdle();
  }

  protected RefreshTitle() {
    super.RefreshTitle();
    const v = this.Data.get("mode", 1) === 0 ? 0 : 2;
    if ((v === 0) === this.split) { this.SetView(v); this.PlaceStrikersIdle(); }
  }

  protected SetupRound() {
    this.ClearShots();
    this.SetView(this.mode);
    this.clock = RoundTime;
    this.heat = 0;
    this.gap = 0.4;
    this.rng = new SysRandom(Math.floor(Math.random() * 1e9));
    const names = this.demo ? ["COMPUTER 1", "COMPUTER 2"] : this.mode === 0 ? ["YOU", ""] : this.mode === 1 ? ["YOU", `COMPUTER · ${DiffNames[this.diff]}`] : ["PLAYER 1", "PLAYER 2"];
    this.lanes.forEach((l, i) => {
      l.saves = l.faced = l.conceded = l.row = l.streak = l.bestStreak = 0;
      l.netShake = 0; l.glovesT = 9; l.pop = 0;
      l.col = this.demo ? (i === 0 ? P1Col : CpuCol) : i === 0 ? P1Col : this.mode === 1 ? CpuCol : P2Col;
      l.colKey = l.col === P1Col ? "p1" : l.col === P2Col ? "p2" : "cpu";
      l.cpu = this.demo ? 1 : (this.mode === 1 && i === 1 ? this.diff : -1);
      l.name = names[i];
      l.nameT.text = l.name; l.nameT.color = l.col;
      l.scoreT.text = "0";
    });
    this.PlaceStrikersIdle();
    this.UpdateHud();
  }

  private PlaceStrikersIdle() {
    for (const l of this.lanes) l.strikers.forEach((s, k) => {
      s.X = s.toX = s.fromX = k === 0 ? -1.4 : 1.8; s.Z = s.toZ = s.fromZ = k === 0 ? 13 : 15; s.moveT = s.moveDur = 1;
      s.on = k === 0; s.kicking = false; s.kick = 0;
      this.PoseStriker(l, s, 0);
    });
  }

  private ClearShots() {
    for (const l of this.lanes) {
      for (const s of l.shots) this.HideShot(s);
      l.flash.color = Red.withAlpha(0);
      l.gloves.color = Color.white.withAlpha(0);
    }
  }

  // ------------------------------------------------------------------ frame

  protected TickIdle(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    for (const l of this.lanes) {
      for (const s of l.strikers) this.PoseStriker(l, s, dt);
      this.AnimateShots(l, dt);
    }
  }

  protected TickRound(dt: number, hits: WallHit[], live: boolean) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    if (live && this.step === RoundStep.Play) {
      this.clock -= dt;
      this.heat += dt;
      if (this.clock <= 10 && this.clock > 0 && Math.ceil(this.clock) !== this.lastTick) { this.lastTick = Math.ceil(this.clock); Sfx.play(Snd.Tick, 0.8, 1.3); }
      // a new shot once the last ones are settled (both goals face the same shot at the same time)
      const busy = this.lanes.some((l) => l.shots.some((s) => s.state === ShotState.Aim || s.state === ShotState.Fly));
      if (!busy && this.clock > 1.2) { this.gap -= dt; if (this.gap <= 0) this.SpawnVolley(); }
      for (const h of hits) this.OnHit(h);
      if (this.clock <= 0 && !busy) { this.clock = 0; this.EndRound(); }
    }
    for (const l of this.lanes) {
      if (l.cpu >= 0 && this.step === RoundStep.Play) this.CpuThink(l);
      for (const s of l.strikers) this.PoseStriker(l, s, dt);
      this.AnimateShots(l, dt);
    }
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ shots

  private PlanShot(level: number, first: boolean): Plan {
    const r = () => this.rng.nextDouble();
    const k = Mathf.clamp01(level / 110);
    const side = r() < 0.5 ? -1 : 1;
    const plan: Plan = {
      X0: (r() - 0.5) * 2.6,
      TX: side * Mathf.lerp(0.2, Math.min(1.7, 0.9 + 0.8 * k), r()),
      TY: Mathf.lerp(0.35, Math.min(2.2, 0.9 + 1.3 * k), r()),
      curl: 0, lift: r() * 0.35, dur: Mathf.lerp(1.7, 1.0, k), lead: Mathf.lerp(1.2, 0.85, k),
    };
    if (first) { plan.TX *= 0.5; plan.TY = 0.9; }
    if (level > 22 && r() < 0.55) plan.curl = (r() < 0.5 ? -1 : 1) * Mathf.lerp(0.6, 1.6, r()) * (0.6 + 0.6 * k);
    if (level > 48 && r() < 0.45) { plan.lift = Mathf.lerp(0.9, 1.8, r()); plan.dur *= 1.08; }
    return plan;
  }

  private SpawnVolley() {
    const first = this.lanes[0].faced === 0;
    const a = this.PlanShot(this.heat, first);
    let b: Plan | null = null;
    if (this.heat > 78 && this.rng.nextDouble() < 0.35) {
      b = this.PlanShot(this.heat - 30, false);
      b.TX = -Math.sign(a.TX || 1) * Math.abs(b.TX);
      b.X0 = a.X0 > 0 ? a.X0 - 2.4 : a.X0 + 2.4;
      b.lead = a.lead + 0.3;
    }
    for (const l of this.lanes) {
      if (!l.root.activeSelf) continue;
      this.LaunchShot(l, l.strikers[0], a);
      if (b) this.LaunchShot(l, l.strikers[1], b);
      else l.strikers[1].on = false;
    }
    this.gap = Mathf.lerp(0.9, 0.5, Mathf.clamp01(this.heat / 110));
    if (b) this.UI.Toast("TWO STRIKERS!", 1.2);
  }

  private LaunchShot(l: Lane, st: Striker, p: Plan) {
    let s = l.shots.find((x) => x.state === ShotState.Gone);
    if (!s) {
      const ball = Art.spr(l.root, "Ball", BallSprite(), Color.white, 1, 20, Art.Flat);
      const shadow = Art.spr(l.root, "BallShadow", ShadowSprite(), Color.white, 1, 3, Art.Flat);
      const marker = Art.spr(l.root, "Target", TargetSprite(), Color.white, 1, 15, Art.Flat);
      const trail = Art.line(l.root, "Trail", Color.white, 0.5, 18, false, false, Art.LineSoftMat);
      const dots: SpriteRenderer[] = [];
      for (let k = 0; k < 9; k++) dots.push(Art.spr(l.root, "Dot", DotSprite(), Color.white, 0.25, 14, Art.Flat));
      s = { state: ShotState.Gone, striker: st, t: 0, kickIn: 0, lead: 1, dur: 1, fly: 0, rt: 0, X0: 0, Z0: 11, TX: 0, TY: 1, curl: 0, lift: 0, ball, shadow, marker, trail, dots, trailPts: [], pos: V2.zero, vel: V2.zero, scale: 1, spin: 0, cpuTries: 0, cpuNext: 0 };
      l.shots.push(s);
    }
    Object.assign(s, { state: ShotState.Aim, striker: st, t: 0, kickIn: p.lead, lead: p.lead, dur: p.dur, fly: 0, rt: 0, X0: p.X0, Z0: 10.5, TX: p.TX, TY: p.TY, curl: p.curl, lift: p.lift, trailPts: [], spin: 0, cpuTries: 0, cpuNext: 0 });
    for (const g of [s.ball, s.shadow, s.marker]) g.gameObject.setActive(true);
    for (const d of s.dots) d.gameObject.setActive(true);
    s.trail.gameObject.setActive(true);
    // the striker runs up to the ball
    st.on = true;
    st.dir = s.X0 > 0 ? 1 : -1;
    st.fromX = st.X; st.fromZ = st.Z;
    st.toX = s.X0 - 0.32 * st.dir; st.toZ = s.Z0 + 0.42;
    st.moveT = 0; st.moveDur = p.lead * 0.82; st.kicking = false;
  }

  private HideShot(s: Shot) {
    s.state = ShotState.Gone;
    for (const g of [s.ball, s.shadow, s.marker]) g.gameObject.setActive(false);
    for (const d of s.dots) d.gameObject.setActive(false);
    s.trail.gameObject.setActive(false);
  }

  /** Court point (metres) → lane-local world point; also returns the scale. */
  private Proj(X: number, Y: number, Z: number): [V2, number] {
    const sc = F / Math.max(0.6, Z + D0);
    return [new V2(X * sc, HorizonY + (Y - CamH) * sc), sc];
  }

  private BallAt(s: Shot, t: number): [V2, number] {
    const q = 4 * t * (1 - t);
    const X = s.X0 + (s.TX - s.X0) * t + s.curl * q, Y = 0.11 + (s.TY - 0.11) * t + s.lift * q, Z = s.Z0 * (1 - t);
    const [p, sc] = this.Proj(X, Y, Z);
    return [p, BallR * sc];
  }

  private AnimateShots(l: Lane, dt: number) {
    for (const s of l.shots) {
      if (s.state === ShotState.Gone) continue;
      s.rt += dt;
      if (s.state === ShotState.Aim) {
        s.kickIn -= dt;
        const [bp, br] = this.BallAt(s, 0);
        this.PlaceBall(s, bp, br, 0);
        if (s.kickIn <= 0.12 && !s.striker.kicking) { s.striker.kicking = true; s.striker.kick = 0; }
        if (s.kickIn <= 0) { s.state = ShotState.Fly; s.fly = 0; l.faced++; Sfx.playClip(this.snd.thud, 0.7, 1.4); s.spin = (s.curl >= 0 ? -1 : 1) * 720; }
      } else if (s.state === ShotState.Fly) {
        s.fly += dt;
        s.t = Math.min(1.3, s.fly / s.dur);
        const [bp, br] = this.BallAt(s, s.t);
        this.PlaceBall(s, bp, br, s.t);
        if (s.t >= 1 && s.state === ShotState.Fly) this.Concede(l, s);
      } else if (s.state === ShotState.Goal) {
        s.fly += dt;
        s.t = s.fly / s.dur;
        const [bp, br] = this.BallAt(s, Math.min(s.t, 1.22));
        this.PlaceBall(s, bp, br, s.t);
        const k = Mathf.clamp01((s.t - 1) / 0.22);
        s.ball.color = Color.white.withAlpha(1 - k);
        if (k >= 1) this.HideShot(s);
      } else if (s.state === ShotState.Saved) {
        s.vel = new V2(s.vel.x * (1 - dt * 0.6), s.vel.y - 30 * dt);
        s.pos = s.pos.add(s.vel.mul(dt));
        s.scale = Math.max(0.2, s.scale * (1 - dt * 0.9));
        s.ball.transform.localPosition = new V3(s.pos.x, s.pos.y, 0);
        s.ball.transform.localScale = new V3(s.scale * 2, s.scale * 2, 1);
        s.ball.transform.localEulerZ = s.ball.transform.localEulerZ + s.spin * dt * 2;
        s.ball.color = Color.white.withAlpha(Mathf.clamp01(1.4 - s.rt * 1.4));
        this.Trail(s, s.pos, s.scale, true);
        if (s.rt > 1.1) this.HideShot(s);
      }
    }
    // shake the net, flash and gloves pop
    l.netShake = Math.max(0, l.netShake - dt * 2.2);
    const sh = l.netShake * 0.25 * Math.sin(Time.time * 50);
    l.frame.transform.localPosition = new V3(sh, -2 + Math.abs(sh) * 0.5, 0);
    l.flash.color = Red.withAlpha(Math.max(0, l.flash.color.a - dt * 0.8));
    l.glovesT += dt;
    if (l.glovesT < 0.9) {
      const k = l.glovesT / 0.9;
      const sc = 5.2 * (k < 0.25 ? Mathf.lerp(0.2, 1.15, k / 0.25) : Mathf.lerp(1.15, 1, (k - 0.25) / 0.3));
      l.gloves.transform.localScale = new V3(sc, sc, 1);
      l.gloves.color = Color.white.withAlpha(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
    } else l.gloves.color = Color.white.withAlpha(0);
  }

  private PlaceBall(s: Shot, p: V2, r: number, t: number) {
    s.pos = p; s.scale = r;
    s.ball.transform.localPosition = new V3(p.x, p.y, 0);
    s.ball.transform.localScale = new V3(r * 2, r * 2, 1);
    s.ball.transform.localEulerZ = s.ball.transform.localEulerZ + s.spin * Time.deltaTime;
    if (s.state !== ShotState.Goal) s.ball.color = Color.white;
    // ground shadow under the ball
    const tt = Math.min(t, 1.2), q = 4 * tt * (1 - tt);
    const X = s.X0 + (s.TX - s.X0) * tt + s.curl * q, Z = s.Z0 * (1 - tt), Y = 0.11 + (s.TY - 0.11) * tt + s.lift * q;
    const [gp, gs] = this.Proj(X, 0, Z);
    s.shadow.transform.localPosition = new V3(gp.x, gp.y, 0);
    s.shadow.transform.localScale = new V3(BallR * gs * 2.6, BallR * gs * 1.1, 1);
    s.shadow.color = Color.white.withAlpha(Mathf.clamp01(0.9 - Y * 0.35) * (gp.y < LineY - 0.5 ? 0 : 1));
    // target marker: pops in at the start of the run-up, pulses until the shot is settled
    const [tp] = this.Proj(s.TX, s.TY, 0);
    const pulse = 1 + 0.12 * Math.sin(s.rt * 14);
    const pop = Mathf.clamp01(s.rt / 0.25);
    const ms = 2.4 * pulse * (0.4 + 0.6 * pop);
    s.marker.transform.localPosition = new V3(tp.x, tp.y, 0);
    s.marker.transform.localScale = new V3(ms, ms, 1);
    s.marker.transform.localEulerZ = s.rt * 60;
    const lane = this.LaneOf(s);
    s.marker.color = (lane?.col ?? White).withAlpha(s.state === ShotState.Aim || s.state === ShotState.Fly ? 0.95 : 0);
    // predicted path (dots) ahead of the ball, trail behind it
    const from = s.state === ShotState.Aim ? 0 : Math.min(1, t);
    for (let k = 0; k < s.dots.length; k++) {
      const u = from + (1 - from) * ((k + 1) / (s.dots.length + 1));
      const [dp, dr] = this.BallAt(s, u);
      const d = s.dots[k];
      const show = (s.state === ShotState.Aim && s.kickIn < s.lead - 0.15) || s.state === ShotState.Fly;
      d.transform.localPosition = new V3(dp.x, dp.y, 0);
      const ds = Math.max(0.24, dr * 0.5);
      d.transform.localScale = new V3(ds, ds, 1);
      d.color = (lane?.col ?? White).withAlpha(show ? 0.7 : 0);
    }
    this.Trail(s, p, r, s.state === ShotState.Fly || s.state === ShotState.Goal);
  }

  private Trail(s: Shot, p: V2, r: number, on: boolean) {
    if (on) s.trailPts.push(p);
    while (s.trailPts.length > 10 || (!on && s.trailPts.length > 0)) s.trailPts.shift();
    if (s.trailPts.length >= 2) {
      s.trail.positionCount = s.trailPts.length;
      for (let i = 0; i < s.trailPts.length; i++) s.trail.setPosition(i, s.trailPts[i]);
      s.trail.startColor = White.withAlpha(0);
      s.trail.endColor = White.withAlpha(0.7);
      s.trail.widthMultiplier = r * 1.6;
      s.trail.startWidth = 0.15; s.trail.endWidth = 1;
    } else s.trail.positionCount = 0;
  }

  private LaneOf(s: Shot) { return this.lanes.find((l) => l.shots.includes(s)) ?? null; }

  // ------------------------------------------------------------------ saves and goals

  private OnHit(h: WallHit) {
    let lane: Lane | null;
    if (this.mode === 0) lane = this.lanes[0];
    else if (this.mode === 1) lane = h.side === 0 ? this.lanes[0] : null;
    else lane = this.lanes[h.side];
    if (!lane) { this.marks.mark(h.world, Pal.TextDim, false); return; }
    this.Throw(lane, h.world);
  }

  /** A ball lands at world point p on a lane: save the closest shot it reaches, else it is a miss. */
  private Throw(l: Lane, p: V2) {
    const local = p.sub(new V2(l.cx, 0));
    let best: Shot | null = null, bestD = Infinity;
    for (const s of l.shots) {
      if (s.state !== ShotState.Fly) continue;
      // the ball stays on the wall for a moment: anything the shot passes in the next 0.2 s counts
      for (let k = 0; k <= 4; k++) {
        const u = Math.min(1, s.t + (k * 0.05) / s.dur);
        const [bp, br] = this.BallAt(s, u);
        const d = V2.distance(local, bp) - br - SaveReach;
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    if (best && bestD <= 0) { this.marks.mark(p, l.col, true, 1.3); this.Save(l, best, local); }
    else { this.marks.mark(p, l.col, false, 1.1); Sfx.playClip(this.snd.thud, 0.5, 0.9 + Math.random() * 0.2); }
  }

  private Save(l: Lane, s: Shot, hitLocal: V2) {
    s.state = ShotState.Saved;
    s.rt = 0;
    const away = s.pos.sub(hitLocal);
    const dir = away.sqrMagnitude > 0.01 ? away.normalized : new V2(Random.range(-1, 1), 1).normalized;
    s.vel = new V2(dir.x * 16, Math.abs(dir.y) * 10 + 12);
    s.spin = Random.range(-900, 900);
    l.saves++; l.streak++; l.row = 0;
    l.bestStreak = Math.max(l.bestStreak, l.streak);
    l.pop = 1;
    l.glovesT = 0;
    l.gloves.transform.localPosition = new V3(s.pos.x, s.pos.y + 0.3, 0);
    l.gloves.transform.localEulerZ = Random.range(-12, 12);
    const w = s.pos.add(new V2(l.cx, 0));
    this.UI.Float(w.add(new V2(0, 2.4)), l.streak >= 3 ? `SAVE! ×${l.streak}` : "SAVE!", Color.lerp(l.col, Color.white, 0.25), 2.4);
    this.marks.mark(w, Pal.hex(0x6cff4a), true, 2.2);
    this.Fx.shake(0.35);
    Fx.haptic(true);
    this.Hitstop(0.05);
    Sfx.playClip(this.snd.thud, 1, 0.75);
    Sfx.playClip(this.snd.cheer, this.demo ? 0.3 : 0.75, 0.95 + Math.random() * 0.1);
    Sfx.play(Snd.Coin, 0.5, 1 + Math.min(6, l.streak) * 0.06);
    if (l.streak > 0 && l.streak % 5 === 0) this.call.show(`${l.streak} IN A ROW!`, Gold, 1.1, 170);
  }

  private Concede(l: Lane, s: Shot) {
    s.state = ShotState.Goal;
    l.conceded++; l.row++; l.streak = 0;
    l.netShake = 1;
    l.flash.color = Red.withAlpha(0.32);
    this.UI.Float(new V2(l.cx + s.pos.x, s.pos.y + 1.5), "GOAL", Red, 1.7);
    Sfx.playClip(this.snd.groan, this.demo ? 0.25 : 0.6);
    Sfx.play(Snd.Hurt, 0.25);
    this.Fx.shake(0.25);
    if (this.mode === 0 && !this.demo && l.row >= 3) {
      // STREAK BREAK: the striker's team celebrates, you get a breather and the shots ease off a little
      l.row = 0;
      this.heat = Math.max(0, this.heat - 22);
      this.gap = 2.6;
      this.call.show("STREAK BREAK!", Red, 1.6, 170);
      Sfx.play(Snd.Warn, 0.8);
      this.UI.Toast("3 GOALS IN A ROW: BREATHE, KEEPER! SHOTS EASE OFF", 2.4);
    }
  }

  // ------------------------------------------------------------------ computer keeper

  private CpuThink(l: Lane) {
    const lv = l.cpu;
    for (const s of l.shots) {
      if (s.state !== ShotState.Fly || s.cpuTries >= (CpuRetry[lv] ? 2 : 1)) continue;
      if (s.fly < CpuReact[lv] + s.cpuNext) continue;
      s.cpuTries++;
      s.cpuNext = s.fly - CpuReact[lv] + ThrowFlight + 0.12; // a retry only after the first ball has landed
      const tl = Math.min(1, s.t + ThrowFlight / s.dur);
      const [aim] = this.BallAt(s, tl);
      const err = Random.value < CpuBlunder[lv] ? CpuErr[lv] * 3 : CpuErr[lv];
      const target = aim.add(Random.insideUnitCircle.mul(err)).add(new V2(l.cx, 0));
      const from = new V2(l.cx + (l.idx === 0 ? -5 : 5) + Random.range(-1.5, 1.5), -12);
      this.throws.throwAt(from, target, l.col, l.colKey, ThrowFlight, (p) => { if (this.step === RoundStep.Play || this.step === RoundStep.End) this.Throw(l, p); });
    }
  }

  // ------------------------------------------------------------------ strikers

  private PoseStriker(_l: Lane, s: Striker, dt: number) {
    s.root.setActive(s.on || s.moveT < s.moveDur);
    if (!s.root.activeSelf) return;
    let moving = false;
    if (s.moveT < s.moveDur) {
      s.moveT += dt;
      const k = Mathf.clamp01(s.moveT / s.moveDur);
      s.X = Mathf.lerp(s.fromX, s.toX, k); s.Z = Mathf.lerp(s.fromZ, s.toZ, k);
      moving = k < 1;
      if (k >= 1 && !s.kicking) s.moveT = s.moveDur;
    }
    s.run += dt * (moving ? 13 : 3);
    if (s.kicking) {
      s.kick += dt;
      if (s.kick > 1.0) {
        // jog back for the next shot
        s.kicking = false;
        s.fromX = s.X; s.fromZ = s.Z;
        s.toX = Mathf.clamp(s.X + Random.range(-1.5, 1.5), -2.6, 2.6); s.toZ = 13 + Random.range(0, 2);
        s.moveT = 0; s.moveDur = 1.3;
      }
    }
    const [p, sc] = this.Proj(s.X, 0, s.Z);
    const k = sc * StrikerK;
    s.root.localPosition = new V3(p.x, p.y, 0);
    s.root.localScale = new V3(k * (s.dir < 0 ? -1 : 1), k, 1);
    const swing = moving ? Math.sin(s.run) * 38 : Math.sin(s.run) * 4;
    let kickLeg = swing;
    if (s.kicking) {
      const t = s.kick;
      kickLeg = t < 0.12 ? Mathf.lerp(swing, 55, t / 0.12) : t < 0.24 ? Mathf.lerp(55, -85, (t - 0.12) / 0.12) : Mathf.lerp(-85, 0, Mathf.clamp01((t - 0.24) / 0.5));
    }
    s.legF.localEulerZ = kickLeg;
    s.legB.localEulerZ = s.kicking ? -10 : -swing;
    s.armF.localEulerZ = s.kicking ? -50 : -swing * 1.1;
    s.armB.localEulerZ = s.kicking ? 60 : swing * 1.1;
    const bob = moving ? Math.abs(Math.sin(s.run)) * 0.06 : Math.sin(s.run * 0.7) * 0.015;
    s.torso.localPosition = new V3(0, 1.1 + bob, 0);
    s.torso.localEulerZ = s.kicking && s.kick < 0.4 ? 8 : moving ? -6 : 0;
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    this.timerT.text = Fmt.clock(Math.ceil(Math.max(0, this.clock)));
    this.timerT.color = this.clock <= 10 && this.step === RoundStep.Play ? Color.lerp(Red, Color.white, 0.5 + 0.5 * Math.sin(Time.time * 10)) : White;
    for (const l of this.lanes) {
      l.scoreT.text = String(l.saves);
      l.pop = Math.max(0, l.pop - Time.deltaTime * 2.5);
      const s = 1 + 0.35 * l.pop;
      l.scoreT.rectTransform.localScale = new V3(s, s, 1);
      l.scoreT.color = Color.lerp(White, l.col, l.pop);
    }
    const l0 = this.lanes[0];
    this.streakT.text = String(l0.streak);
    for (let k = 0; k < 3; k++) {
      this.rowDots[k].color = k < l0.row ? Red : new Color(1, 1, 1, 0.2);
    }
  }

  // ------------------------------------------------------------------ results

  protected RoundResult() {
    const [a, b] = this.lanes;
    const pct = (l: Lane) => (l.faced > 0 ? l.saves / l.faced : 0);
    const starsFor = (l: Lane) => (pct(l) >= 0.7 ? 3 : pct(l) >= 0.5 ? 2 : pct(l) >= 0.3 ? 1 : 0);
    const rate = (l: Lane) => `${Math.round(pct(l) * 100)}%`;
    this.Data.add("allSaves", a.saves + (this.mode === 2 ? b.saves : 0));
    if (this.mode === 0) {
      const best = this.Data.max("best0", a.saves);
      const st = starsFor(a);
      const head = st === 3 ? "WORLD-CLASS KEEPER!" : st === 2 ? "SAFE HANDS!" : st === 1 ? "NICE KEEPING!" : "KEEP PRACTISING!";
      return {
        result: new Result({
          Headline: head, HeadlineColor: Gold, Value: String(a.saves), Stars: st, NewBest: best && a.saves > 0, Victory: st > 0,
          BestLine: `${a.saves} SAVES   ·   BEST ${this.Data.get("best0")}`,
          Stats: [["SAVES", String(a.saves)], ["SHOTS FACED", String(a.faced)], ["SAVE RATE", rate(a)], ["BEST STREAK", String(a.bestStreak)]],
          Primary: "PLAY AGAIN",
        }),
        score: a.saves, label: "SOLO",
      };
    }
    const w = a.saves === b.saves ? -1 : a.saves > b.saves ? 0 : 1;
    const score = `${a.saves} – ${b.saves}`;
    if (this.mode === 1) {
      const won = w === 0;
      if (won) this.Data.add("cpuWins", 1);
      this.Data.max("best1", a.saves);
      return {
        result: new Result({
          Headline: won ? "YOU WIN!" : w < 0 ? "IT'S A DRAW!" : "THE COMPUTER WINS", HeadlineColor: won ? Gold : w < 0 ? White : Pal.hex(0xffb0c0),
          Value: score, Stars: won ? (pct(a) >= 0.7 ? 3 : 2) : w < 0 ? 1 : 0, Victory: won,
          BestLine: `SAVES ${score}   ·   ${DiffNames[this.diff]}`,
          Stats: [["YOUR SAVES", String(a.saves)], ["COMPUTER SAVES", String(b.saves)], ["YOUR SAVE RATE", rate(a)], ["BEST STREAK", String(a.bestStreak)]],
          Primary: won ? "PLAY AGAIN" : "REMATCH",
        }),
        score: a.saves, label: "VS CPU",
      };
    }
    const winner = w < 0 ? a : this.lanes[w];
    this.Data.max("best2", winner.saves);
    return {
      result: new Result({
        Headline: w < 0 ? "IT'S A DRAW!" : `PLAYER ${w + 1} WINS!`, HeadlineColor: w < 0 ? Gold : winner.col, Value: score,
        Stars: starsFor(winner), Victory: true, BestLine: `SAVES ${score}`,
        Stats: [["PLAYER 1 SAVES", String(a.saves)], ["PLAYER 2 SAVES", String(b.saves)], ["P1 SAVE RATE", rate(a)], ["P2 SAVE RATE", rate(b)]],
        Primary: "REMATCH",
      }),
      score: winner.saves, label: w < 0 ? "P1 & P2" : `P${w + 1}`,
    };
  }

  // ------------------------------------------------------------------ test hooks

  /** Flying shots as CSS points (window.__na.game.TestShots()), `ahead` seconds into the future. */
  TestShots(ahead = 0) {
    const out: { lane: number; x: number; y: number; t: number }[] = [];
    const el = Screen.el?.getBoundingClientRect();
    for (const l of this.lanes) for (const s of l.shots) {
      if (s.state !== ShotState.Fly) continue;
      const [p] = this.BallAt(s, Math.min(1, s.t + ahead / s.dur));
      const sp = (window as unknown as { __na: { Camera: { worldToScreen(v: V2): V2 } } }).__na.Camera.worldToScreen(p.add(new V2(l.cx, 0)));
      out.push({ lane: l.idx, x: (el?.left ?? 0) + sp.x / Screen.dpr, y: (el?.top ?? 0) + sp.y / Screen.dpr, t: s.t });
    }
    return out;
  }
  TestState() { return { state: this.State, step: this.step, demo: this.demo, clock: this.clock, mode: this.mode, saves: this.lanes.map((l) => l.saves), faced: this.lanes.map((l) => l.faced), idle: this.idleSeconds }; }
  TestSkip(seconds: number) { this.clock = Math.min(this.clock, seconds); }
}

function CasualDark(c: Color) { return Color.lerp(c, Color.black, 0.22).withAlpha(1); }
