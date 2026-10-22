import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject, howTo,
  Image, ImageType, Keyboard, LoopSource, Mathf, Pal, Phase, Result, Settings, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer,
  Text, TextAnchor, Time, TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import {
  Arrow, Badge, Barrier, Blocker, Cloud, CoinSprite, Drone, Gantry, Gold, HighBar, Ink, Lamp, Liveries, Pack, PowerColors, PowerIcon,
  PowerNames, RollBall, Rotor, Shadow, Skins, Skyline, SpeedLine, Torso, Head, Arm, Thigh, Shin, TrainFront as TrainFace,
} from "./DashArt";
import { Polys, mixRgb, shadeRgb } from "./Polys";
import { Kind, LANES, MovingRatio, Power, ROW, Spawn, TrackGen, planLanes } from "./Track";

/**
 * DASH RUSH: an endless three-lane runner through a sunny rail yard. Swipe (or use the arrow keys / WASD) to change
 * lanes, jump hurdles, roll under bars and run up ramps onto the trains. Grab coins, magnets, 2X score, SKY BOOST
 * jetpacks and shields. Bump into the side of something and BEEP the friendly security drone starts following you;
 * bump again before it gives up and you're caught. Coins unlock runners and longer power-ups. A rewarded ad (or
 * coins) lets you keep running after a crash, and another doubles the coins of a run.
 *
 * Rendering is pseudo-3D: every world point (x across, y up, z along the track) is projected with a pinhole camera
 * behind and above the runner; the track, buildings and train bodies are flat polygons rebuilt every frame, the rest
 * are depth-sorted sprites.
 */

// ------------------------------------------------------------------ world constants (metres-ish)

const LaneW = 2.4, TrainHW = 1.05, TrainH = 3.3, PlayerH = 1.8, RollH = 0.85, PlayerHW = 0.28;
const CamBack = 7.5, Far = 118, Near = 0.7, FogStart = 42;
const JumpH = 2.15, BoostY = 6.4, SwitchTime = 0.15, RollTime = 0.62, ChaseTime = 7;
const laneX = (l: number) => (l - 1) * LaneW;

const FogRgb = 0xf7dcc0;
const SkyTop = Pal.hex(0x2a7fe6), SkyMid = Pal.hex(0x79bdfb), SkyLow = Pal.hex(0xffdcb6);
const BuildingRgb = [0xd8664a, 0xe9d5b0, 0x48a7a0, 0xe7b041, 0x6a7fc0, 0xd9849a, 0x9a6fc0, 0x7fbf6a, 0xc9c2b8];
const Teal = Pal.hex(0x2bd4c4);

const UpgradeBase = [10, 10, 6, 15], UpgradeStep = [2.5, 2.5, 1.4, 4];
const UpgradeCost = [250, 600, 1200, 2500, 5000];
const UpgradeKeys = ["upMag", "upX2", "upBoost", "upShield"];
const MaxUpgrade = 5;

/** Application.isMobilePlatform (kit gap). */
const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

// ------------------------------------------------------------------ track objects

interface Obstacle { kind: Kind; lane: number; z: number; sr: SpriteRenderer; smashed: number }
interface Car { a: number; b: number; poly: Polys }
interface Train {
  lane: number; z0: number; z1: number; moving: boolean; meet: number; len: number; livery: number; ramp: boolean;
  cars: Car[]; front: SpriteRenderer; lights: SpriteRenderer[]; horned: boolean; passed: boolean;
}
interface Ramp { lane: number; z0: number; z1: number; poly: Polys }
interface Coin { x: number; y: number; z: number; sr: SpriteRenderer; pulled: boolean; air: boolean }
interface Pickup { kind: number; lane: number; y: number; z: number; sr: SpriteRenderer; glow: SpriteRenderer }
interface Building { side: number; z0: number; z1: number; x: number; h: number; depth: number; rgb: number; style: number }
interface Prop { z: number; side: number; sr: SpriteRenderer }

class Pool<T extends { gameObject: GameObject }> {
  private readonly free: T[] = [];
  constructor(private readonly make: () => T, prewarm = 0) {
    for (let i = 0; i < prewarm; i++) { const t = make(); t.gameObject.setActive(false); this.free.push(t); }
  }
  take(): T { const t = this.free.pop() ?? this.make(); t.gameObject.setActive(true); return t; }
  give(t: T) { t.gameObject.setActive(false); this.free.push(t); }
}

/** The runner as a little rig of sprites (seen from behind). Units: world metres at scale 1, feet at y = 0. */
class Rig {
  readonly root: GameObject;
  readonly body: GameObject;
  readonly thigh: SpriteRenderer[] = [];
  readonly shin: SpriteRenderer[] = [];
  readonly armPivot: GameObject[] = [];
  readonly arm: SpriteRenderer[] = [];
  readonly torso: SpriteRenderer; readonly pack: SpriteRenderer; readonly head: SpriteRenderer;
  readonly ball: SpriteRenderer; readonly shield: SpriteRenderer;
  readonly flames: SpriteRenderer[] = [];
  skin = -1;

  constructor(parent: GameObject) {
    this.root = new GameObject("Runner", parent);
    this.body = new GameObject("Body", this.root);
    for (let i = 0; i < 2; i++) {
      this.thigh.push(Art.spr(this.body, "Thigh", Thigh(0), Color.white, 0.24, 0, Art.Flat));
      this.shin.push(Art.spr(this.body, "Shin", Shin(0, false), Color.white, 0.26, 0, Art.Flat));
      const piv = new GameObject("ArmPivot", this.body);
      piv.localPosition = new V3(i === 0 ? -0.37 : 0.37, 1.36, 0);
      const a = Art.spr(piv, "Arm", Arm(0), Color.white, 0.2, 0, Art.Flat);
      a.transform.localPosition = new V3(0, -0.27, 0);
      this.armPivot.push(piv);
      this.arm.push(a);
    }
    this.torso = Art.spr(this.body, "Torso", Torso(0), Color.white, 0.74, 0, Art.Flat);
    this.torso.transform.localPosition = new V3(0, 1.08, 0);
    this.head = Art.spr(this.body, "Head", Head(0), Color.white, 0.5, 0, Art.Flat);
    this.head.transform.localPosition = new V3(0, 1.64, 0);
    this.pack = Art.spr(this.body, "Pack", Pack(0), Color.white, 0.46, 0, Art.Flat);
    this.pack.transform.localPosition = new V3(0, 1.04, 0);
    this.ball = Art.spr(this.root, "Ball", RollBall(0), Color.white, 1.0, 0, Art.Flat);
    this.ball.transform.localPosition = new V3(0, 0.5, 0);
    for (let i = 0; i < 2; i++) {
      const f = Art.spr(this.body, "Flame", Art.Glow, Pal.hex(0xffa82a), 0.5, 0, Art.Additive);
      this.flames.push(f);
    }
    this.shield = Art.spr(this.root, "Shield", Art.Ring, Teal.withAlpha(0.7), 2.4, 0, Art.Additive);
    this.shield.transform.localPosition = new V3(0, 0.95, 0);
    this.setSkin(0);
  }

  setSkin(s: number) {
    if (s === this.skin) return;
    this.skin = s;
    for (let i = 0; i < 2; i++) { this.thigh[i].sprite = Thigh(s); this.arm[i].sprite = Arm(s); }
    this.torso.sprite = Torso(s);
    this.head.sprite = Head(s);
    this.pack.sprite = Pack(s);
    this.ball.sprite = RollBall(s);
  }

  setOrder(o: number) {
    for (let i = 0; i < 2; i++) { this.thigh[i].sortingOrder = o; this.shin[i].sortingOrder = o + 0.001; this.arm[i].sortingOrder = o + 0.002; this.flames[i].sortingOrder = o + 0.0025; }
    this.torso.sortingOrder = o + 0.003;
    this.head.sortingOrder = o + 0.004;
    this.pack.sortingOrder = o + 0.005;
    this.ball.sortingOrder = o + 0.006;
    this.shield.sortingOrder = o + 0.007;
  }

  /** Legs: lift 0 (planted) .. 1 (foot up behind). */
  pose(liftL: number, liftR: number, armL: number, armR: number, bob: number, tilt: number) {
    const lifts = [liftL, liftR];
    for (let i = 0; i < 2; i++) {
      const t = Mathf.clamp01(lifts[i]), x = i === 0 ? -0.14 : 0.14;
      const th = this.thigh[i].transform, sh = this.shin[i].transform;
      const ty = 1 - 0.38 * t;
      th.localScale = new V3(0.24, 0.24 * ty, 1);
      th.localPosition = new V3(x, 0.79 - 0.21 * ty, 0);
      this.shin[i].sprite = Shin(this.skin, t > 0.4);
      const sy = 1 - 0.25 * t;
      sh.localScale = new V3(0.26, 0.26 * sy, 1);
      sh.localPosition = new V3(x * (1 - 0.15 * t), 0.27 + 0.36 * t, 0);
    }
    this.armPivot[0].localEulerZ = -armL;
    this.armPivot[1].localEulerZ = armR;
    this.body.localPosition = new V3(0, bob, 0);
    this.body.localEulerZ = tilt;
  }

  showBody(on: boolean) {
    for (let i = 0; i < 2; i++) { this.thigh[i].enabled = on; this.shin[i].enabled = on; this.arm[i].enabled = on; }
    this.torso.enabled = this.head.enabled = this.pack.enabled = on;
    this.ball.enabled = !on;
  }
}

// ------------------------------------------------------------------ game

export class DashRushGame extends ArcadeGame {
  // world
  private world!: GameObject;
  private ground!: Polys;
  private city!: Polys;
  private sky!: SpriteRenderer; private sun!: SpriteRenderer; private sunCore!: SpriteRenderer;
  private readonly skyline: SpriteRenderer[] = [];
  private readonly clouds: { sr: SpriteRenderer; x: number; y: number; s: number }[] = [];
  private flash!: SpriteRenderer;
  private readonly speedLines: { sr: SpriteRenderer; a: number; r: number; v: number }[] = [];
  private fx!: CasualFx;
  private rig!: Rig;
  private shadow!: SpriteRenderer;
  private drone!: SpriteRenderer; private droneRotors: SpriteRenderer[] = []; private droneLights: SpriteRenderer[] = [];

  // pools
  private barrierPool!: Pool<SpriteRenderer>; private barPool!: Pool<SpriteRenderer>; private blockPool!: Pool<SpriteRenderer>;
  private frontPool!: Pool<SpriteRenderer>; private lightPool!: Pool<SpriteRenderer>; private carPool!: Pool<Polys>;
  private coinPool!: Pool<SpriteRenderer>; private powerPool!: Pool<SpriteRenderer>; private glowPool!: Pool<SpriteRenderer>;
  private readonly obstacles: Obstacle[] = [];
  private readonly trains: Train[] = [];
  private readonly ramps: Ramp[] = [];
  private readonly coins: Coin[] = [];
  private readonly pickups: Pickup[] = [];
  private readonly buildings: Building[] = [];
  private readonly lamps: Prop[] = [];
  private readonly gantries: Prop[] = [];
  private readonly spawns: Spawn[] = [];
  private buildZ = [0, 0];
  private propZ = 0;

  // camera / projection
  private F = 9; private horizon = 1; private camX = 0; private camY = 7; private camZ = 0; private baseCamY = 7;
  private sx = 0; private sy = 0; private ss = 0;

  // run state
  private readonly gen = new TrackGen();
  private rng = new SysRandom(1);
  private pz = 0; private px = 0; private py = 0; private vy = 0;
  private lane = 1; private fromLane = 1; private switchT = 1;
  private grounded = true; private rolling = 0; private rollQueued = false; private jumpBuffer = 0; private fastDrop = false;
  private speed = 14; private penalty = 1; private runDist = 0; private phase = 0; private stepPhase = 0;
  private score = 0; private coinsRun = 0; private mult = 1;
  private chase = 0; private droneX = 0; private droneY = 0; private droneVis = 0;
  private invuln = 0; private boost = 0; private boostMax = 1; private boostCoinZ = 0; private boostLane = 1; private boostEnd = 0;
  private readonly power = [0, 0, 0, 0];
  private readonly powerMax = [1, 1, 1, 1];
  private crashed = false; private crashT = 0; private crashKind = "";
  private continues = 0; private adContinues = 0;
  private coinChain = 0; private coinChainT = 0; private coinSpin = 0;
  private attract = false; private hintShown = new Set<number>();
  private tutorialRun = false;
  private topSpeed = 0; private jumps = 0; private rolls = 0;
  private readonly pointer = new TapPointer();
  private swipeUsed = false;
  private boostLoop!: LoopSource;
  private stepClip!: AudioClip; private jumpClip!: AudioClip; private landClip!: AudioClip; private rollClip!: AudioClip;
  private coinClip!: AudioClip; private hornClip!: AudioClip; private crashClip!: AudioClip;
  /** Test / attract autopilot. */
  private auto = false;
  private autoAdvice = { lane: 1, jump: false, roll: false };
  private frameMs = 0;

  // HUD
  private scoreText!: Text; private distText!: Text; private coinText!: Text; private multText!: Text; private multBadge!: Image;
  private chaseText!: Text;
  private readonly powerRows: { node: UINode; ring: Image; icon: Image }[] = [];
  private contNode!: UINode; private contRing!: Image; private contAd!: ArcadeButton; private contCoins!: ArcadeButton; private contTitle!: Text;
  private contTimer = 0; private contOpen = false;
  private titleCoins!: Text;
  private shopNode: UINode | null = null; private shopCoins!: Text;
  private shopPages: UINode[] = []; private shopTabs: ArcadeButton[] = [];
  private readonly skinButtons: ArcadeButton[] = []; private readonly skinInfo: Text[] = [];
  private readonly upButtons: ArcadeButton[] = []; private readonly upPips: Image[][] = []; private readonly upInfo: Text[] = [];

  protected Describe() {
    return new GameInfo({
      Id: "dashrush",
      Title: "DASH RUSH",
      Tagline: "SWIPE. JUMP. ROLL. OUTRUN THE RAIL YARD!",
      PlayLabel: "LET'S GO!",
      Accent: Pal.hex(0xff7a2a),
      Accent2: Gold,
      BgTop: Pal.hex(0x2a7fe6),
      BgBottom: Pal.hex(0xffd2a8),
      GridSpacing: 2,
      ShortSide: 10,
      Touch: TouchScheme.None,
      Music: { bpm: 128, rootHz: 110, degrees: [0, 5, 3, 4], seed: 23, energy: 0.95, major: true },
      Reminders: [
        "The trains are rolling|Beat your best distance today!",
        "New runners in the shop|Spend your coins on NOVA, BOLT or ROBO-K.",
        "BEEP the drone misses you|Come back for another rush through the rail yard.",
      ],
      HowTo: [
        howTo(Arrow(0), Pal.hex(0xff7a2a), "SWIPE LEFT / RIGHT (or ← → / A D) to change lanes."),
        howTo(Arrow(1), Pal.hex(0x3dd6ff), "SWIPE UP (↑ W Space) to JUMP over low hurdles."),
        howTo(Arrow(3), Pal.hex(0x8c5cff), "SWIPE DOWN (↓ S) to ROLL under high bars. In the air it drops you fast."),
        howTo(Blocker(), Color.white, "Barricades and trains: switch lanes. Run up RAMPS to race along train roofs!"),
        howTo(Drone(), Color.white, "Bump into something sideways and BEEP the drone follows you. Bump again and you're caught!"),
        howTo(PowerIcon(2), Color.white, "Power-ups: MAGNET, 2X SCORE, SKY BOOST jetpack and SHIELD (one free crash)."),
        howTo(CoinSprite(), Color.white, "Coins unlock new runners and longer power-ups in the SHOP."),
      ],
      Tips: [
        "Follow the coin trail: it always shows a safe way through.",
        "Swipe down in mid-air to drop fast and roll on landing.",
        "Train roofs are the safest place in the yard. Look for ramps!",
        "Oncoming trains have their headlights on. Get out of their lane early!",
        "Upgrade SKY BOOST to fly further over the yard.",
      ],
    });
  }

  private get Coins() { return this.Data.get("coins"); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }
  private get Skin() { return Mathf.clamp(this.Data.get("skin"), 0, Skins.length - 1); }
  private Owned(s: number) { return s === 0 || this.Data.get("own" + s) === 1; }
  private UpLevel(k: number) { return Mathf.clamp(this.Data.get(UpgradeKeys[k]), 0, MaxUpgrade); }
  private PowerDuration(k: number) { return UpgradeBase[k] + UpgradeStep[k] * this.UpLevel(k); }

  protected BestLine() {
    const b = this.Data.get("best");
    return b > 0 ? `BEST ${Fmt.n(b)}   ·   ${Fmt.n(this.Data.get("bestDist"))} M` : "HOW FAR CAN YOU RUN?";
  }

  protected StatsLine() { return this.Data.get("runs") > 0 ? `${Fmt.n(this.Data.get("runs"))} RUN${this.Data.get("runs") === 1 ? "" : "S"}   ·   ${Fmt.n(this.Data.get("totalCoins"))} COINS COLLECTED` : ""; }

  // ------------------------------------------------------------------ build

  protected Build() {
    CasualLook.calm(this, 1.25, 0.14);
    this.world = new GameObject("DashWorld", this.gameObject);
    const w = this.world;
    this.sky = Art.spr(w, "Sky", CasualArt.make("dr-sky", 32, 256, (p) => {
      const t = (p.y + 8) / 16;
      const c = t > 0.5 ? Color.lerp(SkyMid, SkyTop, CasualArt.smooth(0.5, 1, t)) : Color.lerp(SkyLow, SkyMid, CasualArt.smooth(0.25, 0.5, t));
      return c.withAlpha(1);
    }), Color.white, 1, -990, Art.Flat);
    this.sun = Art.spr(w, "Sun", CasualArt.Soft, new Color(1, 0.92, 0.7, 0.75), 9, -985, Art.Flat);
    this.sunCore = Art.spr(w, "SunCore", CasualArt.Dot, new Color(1, 0.98, 0.88, 1), 1.6, -984, Art.Flat);
    for (let i = 0; i < 5; i++) this.clouds.push({ sr: Art.spr(w, "Cloud", Cloud(), Color.white, 3, -980, Art.Flat), x: Random01(i) * 2 - 1, y: 0.3 + Random01(i + 9) * 0.6, s: 2.5 + Random01(i + 3) * 2.5 });
    this.skyline.push(Art.spr(w, "SkylineFar", Skyline(1), new Color(0.72, 0.78, 0.92, 0.85), 1, -975, Art.Flat));
    this.skyline.push(Art.spr(w, "SkylineNear", Skyline(2), new Color(0.6, 0.66, 0.84, 1), 1, -970, Art.Flat));
    this.city = Polys.create(w, "City", -450);
    this.ground = Polys.create(w, "Ground", -500);

    this.barrierPool = new Pool(() => Art.spr(w, "Barrier", Barrier(), Color.white, 2.2, 0, Art.Flat), 16);
    this.barPool = new Pool(() => Art.spr(w, "Bar", HighBar(), Color.white, 2.2, 0, Art.Flat), 12);
    this.blockPool = new Pool(() => Art.spr(w, "Block", Blocker(), Color.white, 2.2, 0, Art.Flat), 12);
    this.frontPool = new Pool(() => Art.spr(w, "TrainFront", TrainFace(0), Color.white, TrainHW * 2, 0, Art.Flat), 10);
    this.lightPool = new Pool(() => Art.spr(w, "Headlight", Art.Glow, new Color(1, 0.95, 0.75, 0.9), 1, 0, Art.Additive), 8);
    this.carPool = new Pool(() => Polys.create(w, "Car", 0), 28);
    this.coinPool = new Pool(() => Art.spr(w, "Coin", CoinSprite(), Color.white, 0.62, 0, Art.Flat), 140);
    this.powerPool = new Pool(() => Art.spr(w, "Power", PowerIcon(0), Color.white, 1.0, 0, Art.Flat), 4);
    this.glowPool = new Pool(() => Art.spr(w, "PowerGlow", Art.Glow, Color.white, 2, 0, Art.Additive), 4);
    for (let i = 0; i < 18; i++) {
      const sr = Art.spr(w, "Lamp", Lamp(), Color.white, 1.6, 0, Art.Flat);
      sr.gameObject.setActive(false);
      this.lamps.push({ z: -999, side: 1, sr });
    }
    for (let i = 0; i < 4; i++) {
      const sr = Art.spr(w, "Gantry", Gantry(), Color.white, 10, 0, Art.Flat);
      sr.gameObject.setActive(false);
      this.gantries.push({ z: -999, side: 0, sr });
    }

    this.shadow = Art.spr(w, "Shadow", Shadow(), Color.white, 1.3, 0, Art.Flat);
    this.rig = new Rig(w);
    this.drone = Art.spr(w, "Drone", Drone(), Color.white, 1.2, 0, Art.Flat);
    for (let i = 0; i < 2; i++) this.droneRotors.push(Art.spr(this.drone.gameObject, "Rotor", Rotor(), Color.white, 0.55, 0, Art.Flat));
    this.droneRotors[0].transform.localPosition = new V3(-0.41, 0.33, 0);
    this.droneRotors[1].transform.localPosition = new V3(0.41, 0.33, 0);
    for (let i = 0; i < 2; i++) this.droneLights.push(Art.spr(this.drone.gameObject, "Siren", Art.Glow, i === 0 ? Pal.hex(0xff3b5c) : Pal.hex(0x3b8bff), 0.7, 0, Art.Additive));
    for (const l of this.droneLights) l.transform.localPosition = new V3(0, 0.36, 0);

    for (let i = 0; i < 16; i++) {
      const sr = Art.spr(w, "SpeedLine", SpeedLine(), Color.white, 1, 45, Art.Additive);
      this.speedLines.push({ sr, a: 0, r: 0, v: 0 });
    }
    this.flash = Art.spr(w, "Flash", CasualArt.Dot, Color.white, 1, 50, Art.Flat);
    this.fx = CasualFx.create(w, 52, 180);

    this.stepClip = Sfx.make("dr-step", 0.07, (t) => (noise(t) * 0.5 + Sfx.sinP(Sfx.glide(t, 140, 70, 0.05)) * 0.6) * Sfx.env(t, 0.002, 0.05) * 0.2);
    this.jumpClip = Sfx.make("dr-jump", 0.28, (t) => (Sfx.sinP(Sfx.glide(t, 300, 900, 0.22)) * 0.5 + noise(t) * 0.25 * Sfx.env(t, 0.01, 0.15)) * Sfx.env(t, 0.005, 0.24) * 0.3);
    this.landClip = Sfx.make("dr-land", 0.16, (t) => (Sfx.sinP(Sfx.glide(t, 160, 55, 0.12)) * 0.8 + noise(t) * 0.35) * Sfx.env(t, 0.002, 0.12) * 0.35);
    this.rollClip = Sfx.make("dr-roll", 0.35, (t) => noise(t) * Math.sin(Math.PI * t / 0.35) * 0.22 + Sfx.sinP(Sfx.glide(t, 500, 180, 0.3)) * Sfx.env(t, 0.01, 0.3) * 0.12);
    this.coinClip = Sfx.make("dr-coin", 0.22, (t) => (Sfx.sinP(1568 * t) * Sfx.env(t, 0.002, 0.09) + Sfx.sinP(2093 * t) * Sfx.env(t - 0.045, 0.002, 0.16) * (t > 0.045 ? 1 : 0)) * 0.2);
    this.hornClip = Sfx.make("dr-horn", 0.9, (t) => (Sfx.sawP(311 * t) + Sfx.sawP(370 * t) * 0.8 + Sfx.sqrP(466 * t) * 0.3) * Sfx.env(t, 0.04, 0.8) * Mathf.clamp01((0.9 - t) * 6) * 0.07);
    this.crashClip = Sfx.make("dr-crash", 0.6, (t) => (noise(t) * Math.exp(-t * 7) * 0.7 + Sfx.sinP(Sfx.glide(t, 120, 35, 0.5)) * Sfx.env(t, 0.003, 0.5) * 0.7 + Sfx.sqrP(Sfx.glide(t, 900, 200, 0.2)) * Sfx.env(t, 0.001, 0.15) * 0.15) * 0.5);
    this.boostLoop = Sfx.createLoop(Sfx.make("dr-jet", 1, (t) => {
      const n = noise(t);
      return (n * 0.35 + Sfx.sawP(55 * t) * 0.12 + Sfx.sinP(110 * t) * 0.1) * 0.5;
    }, false));
    this.boostLoop.volume = 0;

    this.BuildHud();
    this.BuildContinue();
    this.BuildTitleExtra();
    this.Layout();
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__dashrush = this;
  }

  // ------------------------------------------------------------------ HUD

  private BuildHud() {
    const hud = this.UI.Hud;
    const tl = new V2(0, 1), tr = new V2(1, 1);
    this.scoreText = UIKit.at(UIKit.label(hud, "0", 76, Color.white, TextAnchor.MiddleLeft), tl, new V2(385, -78), new V2(520, 96));
    UIKit.glow(this.scoreText, Ink.withAlpha(0.85), 5);
    this.distText = UIKit.at(UIKit.label(hud, "0 M", 30, Pal.hex(0xfff3dc), TextAnchor.MiddleLeft), tl, new V2(385, -138), new V2(520, 40));
    UIKit.glow(this.distText, Ink.withAlpha(0.7), 3);
    this.multBadge = UIKit.img(hud, "Mult", Badge(), Color.white);
    this.multBadge.rectTransform.place(tl, new V2(70, -100), new V2(92, 92));
    this.multText = UIKit.at(UIKit.label(this.multBadge.rectTransform, "x1", 34, Ink), UIKit.Center, V2.zero, new V2(84, 84));

    const pill = UIKit.img(hud, "CoinPill", CasualArt.panel(Ink.withAlpha(0.55), Color.white.withAlpha(0.3), 0.04), Color.white);
    pill.rectTransform.place(tr, new V2(-330, -85), new V2(250, 84));
    UIKit.img(pill.rectTransform, "Coin", CoinSprite(), Color.white).rectTransform.place(new V2(0, 0.5), new V2(44, 0), new V2(64, 64));
    this.coinText = UIKit.at(UIKit.label(pill.rectTransform, "0", 40, Gold, TextAnchor.MiddleRight), new V2(1, 0.5), new V2(-100, 0), new V2(160, 70));
    UIKit.glow(this.coinText, Ink.withAlpha(0.6), 2);

    for (let i = 0; i < 4; i++) {
      const node = UIKit.node("PowerTimer", hud).place(tl, new V2(70, -220 - i * 112), new V2(100, 100));
      const back = UIKit.img(node, "Back", Art.UiCircle, Ink.withAlpha(0.45));
      back.rectTransform.stretch();
      const ring = UIKit.img(node, "Ring", Art.UiRing, PowerColors[i]);
      ring.rectTransform.stretch(-4);
      ring.type = ImageType.Filled;
      ring.fillMethod = "Radial360";
      const icon = UIKit.img(node, "Icon", PowerIcon(i), Color.white);
      icon.rectTransform.stretch(12);
      node.setActive(false);
      this.powerRows.push({ node, ring, icon });
    }
    this.chaseText = UIKit.at(UIKit.label(hud, "", 34, Pal.hex(0xff4d6a)), new V2(0.5, 1), new V2(0, -210), new V2(800, 50));
    UIKit.glow(this.chaseText, Ink.withAlpha(0.8), 3);
  }

  private BuildContinue() {
    const root = (this.contNode = UIKit.node("Continue", this.UI.Hud).stretch());
    UIKit.dim(root, 0.55);
    const card = UIKit.card(root, new V2(820, 760), this.Info.Accent);
    this.contTitle = UIKit.at(UIKit.label(card, "KEEP RUNNING?", 66, Color.white), UIKit.Center, new V2(0, 290), new V2(780, 90));
    UIKit.glow(this.contTitle, this.Info.Accent.withAlpha(0.6), 4);
    const ringBack = UIKit.img(card, "RingBack", Art.UiRing, Color.white.withAlpha(0.15));
    ringBack.rectTransform.place(UIKit.Center, new V2(0, 120), new V2(200, 200));
    this.contRing = UIKit.img(card, "Ring", Art.UiRing, Gold);
    this.contRing.rectTransform.place(UIKit.Center, new V2(0, 120), new V2(200, 200));
    this.contRing.type = ImageType.Filled;
    this.contRing.fillMethod = "Radial360";
    UIKit.img(card, "Runner", Head(0), Color.white).rectTransform.place(UIKit.Center, new V2(0, 120), new V2(96, 104));
    this.contAd = UIKit.buttonAt(card, "CONTINUE  ▶ AD", UIKit.Center, new V2(0, -60), new V2(600, 130), true, () => this.ContinueAd(), 46);
    this.contAd.setAccent(Pal.hex(0x5cf08e));
    this.contCoins = UIKit.buttonAt(card, "USE 300 COINS", UIKit.Center, new V2(0, -200), new V2(600, 104), false, () => this.ContinueCoins(), 38, null);
    this.contCoins.setAccent(Gold);
    UIKit.buttonAt(card, "NO THANKS", UIKit.Center, new V2(0, -318), new V2(320, 80), false, () => this.DeclineContinue(), 30).setAccent(Pal.TextDim);
    root.setActive(false);
  }

  private BuildTitleExtra() {
    const extra = this.UI.TitleExtra;
    if (!extra) return;
    CasualLook.titleCard(this.UI, Ink.withAlpha(0.5), new V2(1040, 1000), 0);
    const pill = UIKit.img(extra, "CoinPill", CasualArt.panel(Ink.withAlpha(0.6), Gold.withAlpha(0.6), 0.04), Color.white);
    pill.rectTransform.place(UIKit.Center, new V2(-215, 0), new V2(330, 96));
    UIKit.img(pill.rectTransform, "Coin", CoinSprite(), Color.white).rectTransform.place(new V2(0, 0.5), new V2(52, 0), new V2(72, 72));
    this.titleCoins = UIKit.at(UIKit.label(pill.rectTransform, "0", 44, Gold, TextAnchor.MiddleRight), new V2(1, 0.5), new V2(-125, 0), new V2(210, 80));
    const shop = UIKit.buttonAt(extra, "SHOP", UIKit.Center, new V2(205, 0), new V2(330, 96), false, () => this.OpenShop(), 40);
    shop.setAccent(Gold);
    this.BuildShop();
  }

  // ------------------------------------------------------------------ shop (runners + power-up upgrades)

  private BuildShop() {
    const titleLayer = this.UI.TitleExtra.parent?.parent;
    if (!titleLayer) return;
    const root = (this.shopNode = UIKit.node("Shop", titleLayer).stretch());
    UIKit.dim(root, 0.72);
    const card = UIKit.card(root, new V2(980, 1040), Gold);
    UIKit.glow(UIKit.at(UIKit.label(card, "SHOP", 64, Color.white), UIKit.Center, new V2(-250, 452), new V2(400, 90)), Gold.withAlpha(0.5), 3);
    const pill = UIKit.img(card, "CoinPill", CasualArt.panel(Ink.withAlpha(0.6), Gold.withAlpha(0.6), 0.04), Color.white);
    pill.rectTransform.place(UIKit.Center, new V2(250, 452), new V2(330, 84));
    UIKit.img(pill.rectTransform, "Coin", CoinSprite(), Color.white).rectTransform.place(new V2(0, 0.5), new V2(48, 0), new V2(62, 62));
    this.shopCoins = UIKit.at(UIKit.label(pill.rectTransform, "0", 40, Gold, TextAnchor.MiddleRight), new V2(1, 0.5), new V2(-120, 0), new V2(200, 70));
    const tabNames = ["RUNNERS", "POWER-UPS"];
    for (let i = 0; i < 2; i++) {
      const idx = i;
      const b = UIKit.buttonAt(card, tabNames[i], UIKit.Center, new V2(i === 0 ? -225 : 225, 350), new V2(430, 90), false, () => this.ShowShopTab(idx), 36);
      this.shopTabs.push(b);
      this.shopPages.push(UIKit.node("Page" + i, card).place(UIKit.Center, new V2(0, -40), new V2(940, 700)));
    }
    // runners: 2 x 2 cards
    const runners = this.shopPages[0];
    for (let s = 0; s < Skins.length; s++) {
      const idx = s, cx = (s % 2 === 0 ? -228 : 228), cy = s < 2 ? 175 : -175;
      const cell = UIKit.node("Runner", runners).place(UIKit.Center, new V2(cx, cy), new V2(440, 335));
      UIKit.img(cell, "Bg", CasualArt.panel(Pal.hex(0x2a2350).withAlpha(0.9), Color.white.withAlpha(0.18), 0.03), Color.white).rectTransform.stretch();
      const fig = UIKit.node("Figure", cell).place(UIKit.Center, new V2(-110, 0), new V2(200, 300));
      this.RigPreview(fig, s, 150);
      UIKit.at(UIKit.label(cell, Skins[s].name, 42, Color.white, TextAnchor.MiddleLeft), UIKit.Center, new V2(95, 110), new V2(230, 56));
      this.skinInfo.push(CasualLook.fit(UIKit.wrap(UIKit.at(UIKit.label(cell, Skins[s].tag, 22, Pal.TextDim, TextAnchor.UpperLeft), UIKit.Center, new V2(95, 30), new V2(230, 80))), 16)!);
      const b = UIKit.buttonAt(cell, "USE", UIKit.Center, new V2(95, -100), new V2(220, 84), false, () => this.SkinAction(idx), 30);
      this.skinButtons.push(b);
    }
    // power-ups: one row each
    const ups = this.shopPages[1];
    for (let k = 0; k < 4; k++) {
      const idx = k, y = 255 - k * 170;
      const row = UIKit.node("Upgrade", ups).place(UIKit.Center, new V2(0, y), new V2(920, 155));
      UIKit.img(row, "Bg", CasualArt.panel(Pal.hex(0x2a2350).withAlpha(0.9), Color.white.withAlpha(0.18), 0.03), Color.white).rectTransform.stretch();
      UIKit.img(row, "Icon", PowerIcon(k), Color.white).rectTransform.place(new V2(0, 0.5), new V2(80, 0), new V2(112, 112));
      UIKit.at(UIKit.label(row, PowerNames[k], 36, Color.white, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(330, 34), new V2(300, 50));
      this.upInfo.push(UIKit.at(UIKit.label(row, "", 24, Pal.TextDim, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(330, -6), new V2(300, 34)));
      const pips: Image[] = [];
      for (let i = 0; i < MaxUpgrade; i++) {
        const pip = UIKit.img(row, "Pip", Art.UiRound, Color.white.withAlpha(0.2));
        pip.rectTransform.place(new V2(0, 0.5), new V2(200 + i * 52, -46), new V2(44, 20));
        pips.push(pip);
      }
      this.upPips.push(pips);
      const b = UIKit.buttonAt(row, "", new V2(1, 0.5), new V2(-150, 0), new V2(250, 100), false, () => this.BuyUpgrade(idx), 30, null);
      b.label = UIKit.label(b.node, "", 30, Color.white);
      b.label.rectTransform.stretch();
      b.setAccent(PowerColors[k]);
      this.upButtons.push(b);
    }
    UIKit.buttonAt(card, "CLOSE", UIKit.Center, new V2(0, -445), new V2(340, 92), true, () => this.CloseShop(), 40).setAccent(Gold);
    root.setActive(false);
    this.ShowShopTab(0);
  }

  /** The runner composed from its part sprites as UI images (unit = canvas px per metre). */
  private RigPreview(parent: UINode, s: number, unit: number) {
    const part = (sprite: ReturnType<typeof Head>, x: number, y: number, w: number, h: number, rot = 0) => {
      const img = UIKit.img(parent, "Part", sprite, Color.white);
      img.rectTransform.place(new V2(0.5, 0), new V2(x * unit, y * unit), new V2(w * unit, h * unit));
      if (rot) img.rectTransform.localEulerAngles = new V3(0, 0, rot);
      return img;
    };
    const base = -0.02;
    part(Thigh(s), -0.14, base + 0.58, 0.24, 0.42);
    part(Shin(s, false), -0.14, base + 0.27, 0.26, 0.52);
    part(Thigh(s), 0.14, base + 0.64, 0.24, 0.32);
    part(Shin(s, true), 0.13, base + 0.52, 0.26, 0.42);
    part(Arm(s), -0.42, base + 1.1, 0.2, 0.6, -14);
    part(Arm(s), 0.42, base + 1.1, 0.2, 0.6, 14);
    part(Torso(s), 0, base + 1.08, 0.74, 0.72);
    part(Head(s), 0, base + 1.64, 0.5, 0.54);
    part(Pack(s), 0, base + 1.04, 0.46, 0.42);
  }

  private OpenShop() {
    if (!this.shopNode) return;
    this.shopNode.setActive(true);
    this.shopNode.setAsLastSibling();
    this.RefreshShop();
  }

  private CloseShop() { this.shopNode?.setActive(false); this.RefreshTitle(); }

  private ShowShopTab(i: number) {
    for (let k = 0; k < 2; k++) {
      this.shopPages[k].setActive(k === i);
      this.shopTabs[k].setAccent(k === i ? Gold : Pal.TextDim);
    }
    this.RefreshShop();
  }

  private RefreshShop() {
    if (!this.shopNode) return;
    this.shopCoins.text = Fmt.n(this.Coins);
    for (let s = 0; s < Skins.length; s++) {
      const b = this.skinButtons[s], owned = this.Owned(s), using = this.Skin === s;
      if (b.label) b.label.text = using ? "RUNNING" : owned ? "USE" : Fmt.n(Skins[s].cost);
      b.setAccent(using ? Pal.Good : owned ? Pal.Cyan : Gold);
      b.interactable = !using;
    }
    for (let k = 0; k < 4; k++) {
      const lvl = this.UpLevel(k), b = this.upButtons[k];
      this.upInfo[k].text = k === 3 ? `Lasts ${Fmt.n(this.PowerDuration(k))}s or one crash` : `Lasts ${this.PowerDuration(k).toFixed(1)}s`;
      for (let i = 0; i < MaxUpgrade; i++) this.upPips[k][i].color = i < lvl ? PowerColors[k] : Color.white.withAlpha(0.2);
      if (b.label) b.label.text = lvl >= MaxUpgrade ? "MAX" : `▲ ${Fmt.n(UpgradeCost[lvl])}`;
      b.interactable = lvl < MaxUpgrade;
    }
  }

  private SkinAction(s: number) {
    if (!this.Owned(s)) {
      const cost = Skins[s].cost;
      if (this.Coins < cost) { Sfx.play(Snd.Deny, 0.6); this.UI.Toast(`Need ${Fmt.n(cost - this.Coins)} more coins for ${Skins[s].name}.`, 2.5); return; }
      this.Coins = this.Coins - cost;
      this.Data.set("own" + s, 1);
      Sfx.play(Snd.PowerUp, 0.8);
      this.fx.confetti(new V2(0, 0), 40, 9, [Gold, Pal.hex(0xff5a3c), Pal.hex(0x3dd6ff), Pal.hex(0x8c5cff)], 0.28);
    }
    this.Data.set("skin", s);
    this.rig.setSkin(s);
    this.RefreshShop();
  }

  private BuyUpgrade(k: number) {
    const lvl = this.UpLevel(k);
    if (lvl >= MaxUpgrade) { Sfx.play(Snd.Deny, 0.5); return; }
    const cost = UpgradeCost[lvl];
    if (this.Coins < cost) { Sfx.play(Snd.Deny, 0.6); this.UI.Toast(`Need ${Fmt.n(cost - this.Coins)} more coins.`, 2.5); return; }
    this.Coins = this.Coins - cost;
    this.Data.set(UpgradeKeys[k], lvl + 1);
    Sfx.play(Snd.PowerUp, 0.8);
    this.RefreshShop();
  }

  private RefreshTitle() { if (this.titleCoins) this.titleCoins.text = Fmt.n(this.Coins); }

  // ------------------------------------------------------------------ layout / projection

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    const W = this.ViewSize.x, Hh = this.ViewSize.y, portrait = Hh > W;
    this.baseCamY = portrait ? 7.2 : 5.4;
    const sp = Math.min((W * 0.88) / 8.0, (Hh * (portrait ? 0.47 : 0.56)) / this.baseCamY);
    this.F = sp * CamBack;
    const footY = -Hh / 2 + Hh * (portrait ? 0.17 : 0.15);
    this.horizon = footY + this.baseCamY * sp;
    this.Fx.CameraTarget = V2.zero;
    const skyH = Hh * 0.5 + 2 - (this.horizon - 3);
    this.sky.transform.localScale = new V3(W + 4, skyH / 8, 1);
    this.sky.transform.localPosition = new V3(0, this.horizon - 3 + skyH / 2, 0);
    this.flash.transform.localScale = new V3(W * 1.3 + 4, Hh * 1.3 + 4, 1);
    for (let i = 0; i < 2; i++) {
      const sw = W * (1.35 + i * 0.25);
      this.skyline[i].transform.localScale = new V3(sw, sw * (i === 0 ? 0.55 : 0.4), 1);
      this.skyline[i].transform.localPosition = new V3(0, this.horizon + sw * (i === 0 ? 0.55 : 0.4) * 0.125 - 0.05, 0);
    }
    this.sun.transform.localPosition = new V3(W * 0.22, this.horizon + Math.min(Hh * 0.18, 3.5), 0);
    this.sunCore.transform.localPosition = this.sun.transform.localPosition;
  }

  /** Projects a world point; false when it is behind the near plane. Results in sx, sy (screen units) and ss (scale). */
  private P(x: number, y: number, z: number) {
    let d = z - this.camZ;
    const ok = d >= Near;
    if (!ok) d = Near;
    const s = this.F / d;
    this.ss = s;
    this.sx = (x - this.camX) * s;
    this.sy = this.horizon + (y - this.camY) * s;
    return ok;
  }

  private static order(depth: number) { return 20 - depth * 0.15; }
  private fogK(depth: number) { return Mathf.clamp01((depth - FogStart) / (Far - FogStart)); }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.CloseShop();
    this.ResetRun(true);
    this.RefreshTitle();
    this.boostLoop.volume = 0;
  }

  protected BeginRun() {
    this.CloseShop();
    this.tutorialRun = this.Data.get("tut") === 0;
    this.ResetRun(false);
    this.Data.add("runs", 1);
    this.UI.SetPauseButton(true);
    Sfx.setIntensity(0.35);
    if (this.tutorialRun) this.UI.Announce("READY?", this.Info.Accent, 1.2);
    else this.UI.Announce("GO!", this.Info.Accent, 0.9);
  }

  protected OnPauseChanged(paused: boolean) { if (paused) this.boostLoop.volume = 0; }

  private ResetRun(attract: boolean) {
    this.attract = attract;
    this.auto = attract;
    this.ClearTrack();
    this.rng = new SysRandom(attract ? 777 : (Math.random() * 1e9) | 0);
    this.gen.reset(this.rng.next(1 << 30), 0, !attract && this.tutorialRun);
    this.gen.emitEmpty(attract ? 4 : 6);
    this.pz = 0; this.px = 0; this.py = 0; this.vy = 0;
    this.lane = this.fromLane = 1; this.switchT = 1;
    this.grounded = true; this.rolling = 0; this.rollQueued = false; this.jumpBuffer = 0; this.fastDrop = false;
    this.speed = 14; this.penalty = 1; this.runDist = 0; this.phase = 0; this.stepPhase = 0;
    this.score = 0; this.coinsRun = 0; this.mult = 1;
    this.chase = 0; this.droneVis = 0; this.invuln = 0; this.boost = 0; this.boostEnd = 0;
    for (let i = 0; i < 4; i++) this.power[i] = 0;
    this.crashed = false; this.crashT = 0;
    this.continues = this.adContinues = 0;
    this.coinChain = 0;
    this.hintShown.clear();
    this.topSpeed = 0; this.jumps = this.rolls = 0;
    this.camX = 0; this.camY = this.baseCamY; this.camZ = -CamBack;
    this.buildZ[0] = this.buildZ[1] = -CamBack - 4;
    this.buildings.length = 0;
    this.propZ = 0;
    for (const l of this.lamps) { l.z = -999; l.sr.gameObject.setActive(false); }
    for (const g of this.gantries) { g.z = -999; g.sr.gameObject.setActive(false); }
    this.contNode.setActive(false);
    this.contOpen = false;
    this.pointer.reset();
    this.pointer.topBand = 0.08;
    this.rig.setSkin(this.Skin);
    this.rig.showBody(true);
    this.fx.clear();
    this.Generate();
    this.UpdateWorldVisuals(0);
    this.UpdateHud();
  }

  private ClearTrack() {
    for (const o of this.obstacles) this.PoolFor(o.kind).give(o.sr);
    this.obstacles.length = 0;
    for (const t of this.trains) this.FreeTrain(t);
    this.trains.length = 0;
    for (const r of this.ramps) this.carPool.give(r.poly);
    this.ramps.length = 0;
    for (const c of this.coins) this.coinPool.give(c.sr);
    this.coins.length = 0;
    for (const p of this.pickups) { this.powerPool.give(p.sr); this.glowPool.give(p.glow); }
    this.pickups.length = 0;
  }

  private PoolFor(k: Kind) { return k === Kind.Barrier ? this.barrierPool : k === Kind.Bar ? this.barPool : this.blockPool; }

  private FreeTrain(t: Train) {
    for (const c of t.cars) this.carPool.give(c.poly);
    this.frontPool.give(t.front);
    for (const l of t.lights) this.lightPool.give(l);
  }

  /** Removes everything ahead of `fromZ` and restarts the generator there with all lanes free. */
  private ClearAhead(fromZ: number) {
    for (let i = this.obstacles.length - 1; i >= 0; i--) if (this.obstacles[i].z > fromZ - 6) { this.PoolFor(this.obstacles[i].kind).give(this.obstacles[i].sr); this.obstacles.splice(i, 1); }
    for (let i = this.trains.length - 1; i >= 0; i--) {
      const t = this.trains[i];
      if (this.TrainBack(t) > fromZ - 6) { this.FreeTrain(t); this.trains.splice(i, 1); }
    }
    for (let i = this.ramps.length - 1; i >= 0; i--) if (this.ramps[i].z1 > fromZ - 6) { this.carPool.give(this.ramps[i].poly); this.ramps.splice(i, 1); }
    for (let i = this.coins.length - 1; i >= 0; i--) if (this.coins[i].z > fromZ) { this.coinPool.give(this.coins[i].sr); this.coins.splice(i, 1); }
    for (let i = this.pickups.length - 1; i >= 0; i--) if (this.pickups[i].z > fromZ) { this.powerPool.give(this.pickups[i].sr); this.glowPool.give(this.pickups[i].glow); this.pickups.splice(i, 1); }
    const row = Math.ceil(fromZ / ROW);
    this.gen.restartAt(row);
  }

  // ------------------------------------------------------------------ generation

  private Tier() {
    if (this.attract) return 1;
    const d = this.runDist;
    return d < 350 ? 0 : d < 1000 ? 1 : d < 2000 ? 2 : 3;
  }

  private Generate() {
    while (this.gen.frontier * ROW < this.pz + Far + 12) {
      if (this.boost > 0 || (this.boostEnd > 0 && this.gen.frontier * ROW < this.boostEnd + 20)) { this.gen.emitEmpty(1); continue; }
      const tier = this.Tier();
      this.gen.coinRuns = tier <= 1 ? 0.6 : 0.5;
      this.spawns.length = 0;
      this.gen.next(tier, this.spawns, true);
      for (const s of this.spawns) this.SpawnObject(s);
    }
    this.gen.trim(Math.floor(this.pz / ROW) - 4);
  }

  private SpawnObject(s: Spawn) {
    const w = this.world;
    switch (s.kind) {
      case Kind.Barrier: case Kind.Bar: case Kind.Block:
        this.obstacles.push({ kind: s.kind, lane: s.lane, z: (s.z0 + s.z1) / 2, sr: this.PoolFor(s.kind).take(), smashed: 0 });
        break;
      case Kind.Ramp:
        this.ramps.push({ lane: s.lane, z0: s.z0, z1: s.z1, poly: this.carPool.take() });
        break;
      case Kind.Train: {
        const len = s.moving ? s.len : s.z1 - s.z0;
        const n = Math.max(1, Math.round(len / 9.5));
        const gap = 0.45, carLen = (len - gap * (n - 1)) / n;
        const cars: Car[] = [];
        for (let i = 0; i < n; i++) cars.push({ a: i * (carLen + gap), b: i * (carLen + gap) + carLen, poly: this.carPool.take() });
        const front = this.frontPool.take();
        front.sprite = TrainFace(s.sub);
        const lights = s.moving ? [this.lightPool.take(), this.lightPool.take()] : [];
        this.trains.push({ lane: s.lane, z0: s.z0, z1: s.z1, moving: s.moving, meet: s.z0, len, livery: s.sub, ramp: s.ramp, cars, front, lights, horned: false, passed: false });
        break;
      }
      case Kind.Coin:
        this.coins.push({ x: laneX(s.lane), y: s.y, z: s.z0, sr: this.coinPool.take(), pulled: false, air: false });
        break;
      case Kind.Power: {
        const sr = this.powerPool.take();
        sr.sprite = PowerIcon(s.sub);
        const glow = this.glowPool.take();
        glow.color = PowerColors[s.sub].withAlpha(0.55);
        this.pickups.push({ kind: s.sub, lane: s.lane, y: s.y, z: s.z0, sr, glow });
        break;
      }
    }
    void w;
  }

  private TrainFront(t: Train, pz = this.pz) { return t.moving ? t.meet * (1 + MovingRatio) - MovingRatio * pz : t.z0; }
  private TrainBack(t: Train, pz = this.pz) { return this.TrainFront(t, pz) + t.len; }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.posed) { this.UpdateWorldVisuals(0); return; }
    if (this.State === Phase.Title) {
      if (this.shopNode?.activeSelf && Keyboard.escape.wasPressedThisFrame) this.CloseShop();
      this.speed = 15;
      this.Simulate(dt);
      this.UpdateWorldVisuals(dt);
    } else {
      // result screen: the world stays frozen, the drone keeps hovering
      this.boostLoop.volume = Mathf.moveTowards(this.boostLoop.volume, 0, dt);
      this.UpdateWorldVisuals(0);
    }
  }

  protected TickRun(dt: number) {
    const t0 = performance.now();
    if (this.contOpen) { this.TickContinue(dt); this.UpdateWorldVisuals(0); return; }
    if (this.crashed) {
      this.crashT += dt;
      this.CrashAnim(dt);
      this.UpdateWorldVisuals(dt);
      if (this.crashT > 1.0) this.OfferContinue();
      return;
    }
    this.ReadInput();
    this.Simulate(dt);
    this.UpdateWorldVisuals(dt);
    this.UpdateHud();
    this.frameMs = performance.now() - t0;
  }

  private ReadInput() {
    if (this.auto) return;
    const K = Keyboard;
    if (K.left.wasPressedThisFrame || K.letter("a").wasPressedThisFrame) this.Steer(-1);
    if (K.right.wasPressedThisFrame || K.letter("d").wasPressedThisFrame) this.Steer(1);
    if (K.up.wasPressedThisFrame || K.letter("w").wasPressedThisFrame || K.space.wasPressedThisFrame) this.Jump();
    if (K.down.wasPressedThisFrame || K.letter("s").wasPressedThisFrame) this.Roll();
    this.pointer.update(Time.unscaledDeltaTime);
    const p = this.pointer;
    if (p.down) this.swipeUsed = false;
    if ((p.held || p.up) && !this.swipeUsed) {
      const d = p.screen.sub(p.startScreen);
      const th = TapPointer.dp(26);
      if (d.magnitude > th) {
        this.swipeUsed = true;
        if (Math.abs(d.x) > Math.abs(d.y)) this.Steer(d.x < 0 ? -1 : 1);
        else if (d.y > 0) this.Jump();
        else this.Roll();
      }
    }
    if (p.up) this.swipeUsed = false;
  }

  // ------------------------------------------------------------------ actions

  private Steer(dir: number) {
    if (this.crashed) return;
    const target = Mathf.clamp(this.lane + dir, 0, LANES - 1);
    if (target === this.lane) {
      // bumping the outer wall: a tiny nudge, no penalty
      if (!this.auto) Sfx.play(Snd.Click, 0.25, 0.6);
      return;
    }
    // start the move from where we are now (supports double swipes)
    this.fromLane = this.lane;
    this.lane = target;
    this.switchStartX = this.px;
    this.switchT = 0;
    Sfx.play(Snd.Whoosh, 0.22, 1.5);
    if (this.grounded && this.boost <= 0) this.Dust(0.5);
  }
  private switchStartX = 0;

  private Jump() {
    if (this.crashed || this.boost > 0) return;
    if (this.rolling > 0) this.rolling = 0;
    if (!this.grounded) { this.jumpBuffer = 0.16; return; }
    this.vy = Math.sqrt(2 * this.Gravity() * JumpH);
    this.grounded = false;
    this.fastDrop = false;
    this.jumps++;
    Sfx.playClip(this.jumpClip, 0.8, 1 + Random01(this.jumps) * 0.1);
    this.Dust(0.7);
  }

  private Roll() {
    if (this.crashed || this.boost > 0) return;
    if (!this.grounded) { this.fastDrop = true; this.vy = Math.min(this.vy, -26); this.rollQueued = true; return; }
    if (this.rolling <= 0) { this.rolls++; Sfx.playClip(this.rollClip, 0.7); }
    this.rolling = RollTime;
  }

  private Gravity() { return 44 * Math.pow(Math.max(1, this.speed / 14), 1.5); }

  // ------------------------------------------------------------------ simulation

  private Simulate(dt: number) {
    if (dt <= 0) return;
    if (this.auto) this.Autopilot();
    const prevZ = this.pz;
    const base = this.attract ? 15 : 14 + 15 * (1 - Math.exp(-this.runDist / 2400));
    this.penalty = Mathf.moveTowards(this.penalty, 1, dt * 0.25);
    const target = base * this.penalty * (this.boost > 0 ? 1.2 : 1);
    this.speed = Mathf.moveTowards(this.speed, target, dt * 8);
    this.topSpeed = Math.max(this.topSpeed, this.speed);
    this.pz += this.speed * dt;
    this.runDist = this.pz;
    if (!this.attract) this.score += (this.pz - prevZ) * this.mult;
    this.phase += dt * (5 + this.speed * 0.42);

    // lanes
    if (this.switchT < 1) {
      this.switchT = Math.min(1, this.switchT + dt / SwitchTime);
      const k = Mathf.smoothStep(0, 1, this.switchT);
      this.px = Mathf.lerp(this.switchStartX, laneX(this.lane), k);
    } else this.px = laneX(this.lane);

    // power-ups
    for (let i = 0; i < 4; i++) if (this.power[i] > 0) {
      this.power[i] = Math.max(0, this.power[i] - dt);
      if (this.power[i] <= 0 && !this.attract) Sfx.play(Snd.Beep, 0.4, 0.8);
    }
    this.mult = this.power[Power.Double] > 0 ? 2 : 1;
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.chase > 0) {
      this.chase -= dt;
      if (this.chase <= 0 && !this.attract) { this.UI.Float(new V2(0, 2), "BEEP GAVE UP!", Teal, 0.8); Sfx.play(Snd.Confirm, 0.5); }
    }

    // boost (jetpack)
    if (this.boost > 0) {
      this.boost -= dt;
      this.py = Mathf.moveTowards(this.py, BoostY, dt * 9);
      this.vy = 0;
      this.grounded = false;
      this.rolling = 0;
      this.SpawnBoostCoins();
      if (this.boost <= 0) {
        this.boostEnd = 0;
        this.invuln = Math.max(this.invuln, 1.6);
        this.UI.Float(new V2(0, 1), "LANDING", Pal.hex(0x3dd6ff), 0.8);
      }
    } else this.Vertical(dt);

    this.rolling = Math.max(0, this.rolling - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    if (!this.attract) this.Collide(prevZ);
    this.Collect(dt);
    this.Events();
    this.Generate();
    this.Recycle();
    this.Steps();
  }

  /** Height of the surface under the runner (train roofs, ramps). */
  private SurfaceAt(x: number, z: number) {
    const l = Mathf.clamp(Math.round(x / LaneW) + 1, 0, 2);
    if (Math.abs(x - laneX(l)) > TrainHW + 0.15) return 0;
    let h = 0;
    for (const t of this.trains) {
      if (t.lane !== l) continue;
      const f = this.TrainFront(t, z);
      if (z >= f - 0.05 && z <= f + t.len) h = Math.max(h, TrainH);
    }
    for (const r of this.ramps) {
      if (r.lane !== l || z < r.z0 || z > r.z1 + 0.05) continue;
      h = Math.max(h, TrainH * Mathf.clamp01((z - r.z0) / (r.z1 - r.z0)));
    }
    return h;
  }

  private Vertical(dt: number) {
    const surf = this.SurfaceAt(this.px, this.pz);
    if (this.grounded) {
      if (surf > this.py + 0.02 && surf - this.py < 0.9) this.py = surf;
      else if (surf < this.py - 0.05) { this.grounded = false; this.vy = 0; }
      else if (surf <= this.py + 0.02) this.py = surf;
      if (this.grounded && this.jumpBuffer > 0) { this.jumpBuffer = 0; this.Jump(); }
      return;
    }
    const g = this.Gravity() * (this.fastDrop ? 2.2 : 1);
    this.vy -= g * dt;
    this.py += this.vy * dt;
    if (this.py <= surf) {
      const hard = this.vy < -9;
      this.py = surf;
      this.vy = 0;
      this.grounded = true;
      this.fastDrop = false;
      if (hard) { Sfx.playClip(this.landClip, 0.6); this.Dust(1); }
      if (this.rollQueued) { this.rollQueued = false; this.Roll(); }
      else if (this.jumpBuffer > 0) { this.jumpBuffer = 0; this.Jump(); }
    }
  }

  private Steps() {
    if (!this.grounded || this.rolling > 0 || this.crashed || this.boost > 0) return;
    const step = Math.floor(this.phase / Math.PI);
    if (step !== this.stepPhase) {
      this.stepPhase = step;
      if (!this.attract) Sfx.playClip(this.stepClip, 0.5, 0.9 + (step % 2) * 0.15);
      if (this.speed > 21 && step % 2 === 0) this.Dust(0.25);
    }
  }

  // ------------------------------------------------------------------ autopilot (title screen + test bot)

  private Autopilot() {
    const a = this.Advice();
    if (a.lane !== this.lane && this.switchT >= 1) this.Steer(Math.sign(a.lane - this.lane));
    if (a.jump) { this.Jump(); this.lastJumpInfo = `${Math.floor(this.pz)}`; }
    else if (a.roll) this.Roll();
  }

  /** What a perfect player would do now: target lane, jump, roll (read from the track grid + live obstacles). */
  Advice() {
    const row = Math.floor(this.pz / ROW);
    const elev = this.py > TrainH - 0.6 ? 1 : 0;
    const plan = planLanes(this.gen, row, { lane: this.lane, elev }, 18);
    let lane = this.lane;
    if (plan && plan.length > 1) lane = plan[1];
    if (this.boost > 0) lane = this.boostLane;
    let jump = false, roll = false, barD = 1e9, hurdleD = 1e9;
    const v = Math.max(1, this.speed), g = this.Gravity(), airT = 2 * Math.sqrt((2 * JumpH) / g);
    for (const o of this.obstacles) {
      if (o.lane !== this.lane || o.smashed > 0) continue;
      const d = o.z - this.pz;
      if (d < 0 || d > 30) continue;
      // only obstacles on the planned line (the plan may leave this lane before reaching it)
      const k = Math.floor(o.z / ROW) - row;
      if (plan && k >= 0 && k < plan.length && plan[k] !== this.lane) continue;
      if (o.kind === Kind.Barrier && this.grounded && this.py < 0.5 && d < v * airT * 0.5 && d > v * airT * 0.18) jump = true;
      if (o.kind === Kind.Bar && d < v * 0.32 + 0.6 && this.rolling < 0.25) { roll = true; barD = Math.min(barD, d); }
      if (o.kind === Kind.Barrier) hurdleD = Math.min(hurdleD, d);
    }
    if (roll && hurdleD < barD) roll = false;
    this.autoAdvice.lane = lane; this.autoAdvice.jump = jump; this.autoAdvice.roll = roll;
    return this.autoAdvice;
  }

  /** Test hook: runs the simulation synchronously (autopilot on) for `seconds` of game time; returns crashes. */
  SimFast(seconds: number, dt = 1 / 60) {
    let crashes = 0;
    const kinds: string[] = [];
    for (let t = 0; t < seconds; t += dt) {
      if (this.crashed) { crashes++; kinds.push(this.crashKind + "@" + Math.floor(this.pz) + " " + this.crashInfo); this.crashed = false; this.KeepRunningFree(); }
      this.Simulate(dt);
      this.camZ = this.pz - CamBack;
    }
    return { crashes, kinds, dist: Math.floor(this.pz), score: Math.floor(this.score), coins: this.coinsRun, stumbles: this.stumbles };
  }
  private stumbles = 0;
  private KeepRunningFree() { this.ClearAhead(this.pz + 4); this.gen.emitEmpty(3); this.py = 0; this.grounded = true; this.invuln = 2; this.chase = 0; }

  /** Dev hook for store art: a staged, frozen scene (camera shift / zoom in screen units). */
  private posed = false; private poseShift = 0;
  Poster(shiftX: number, zoom: number, horizonDy: number, drone: boolean) {
    this.ResetRun(true);
    this.attract = true;
    for (let i = 0; i < 90; i++) this.Simulate(1 / 30);
    this.ClearAhead(this.pz + 1);
    this.gen.emitEmpty(40);
    const z = this.pz;
    const mk = (kind: Kind, lane: number, z0: number, z1: number, y = 0, sub = 0, moving = false): Spawn =>
      ({ kind, lane, z0, z1, y, sub, moving, len: moving ? 16 : 0, ramp: false });
    this.SpawnObject(mk(Kind.Train, 0, z + 7, z + 40, 0, 0));
    this.SpawnObject(mk(Kind.Train, 2, z + 22, z + 22, 0, 3, true));
    this.trains[this.trains.length - 1].meet = z + 22 / (1 + MovingRatio);
    this.SpawnObject(mk(Kind.Barrier, 1, z + 4.6, z + 5));
    this.SpawnObject(mk(Kind.Power, 1, z + 19, z + 19, 1.1, Power.Magnet));
    for (let i = 1; i < 9; i++) {
      const cz = z + 2.2 + i * 1.5, d = (cz - (z + 4.8)) / 4;
      this.SpawnObject(mk(Kind.Coin, 1, cz, cz, 0.75 + 2.1 * Math.max(0, 1 - d * d)));
    }
    for (let i = 0; i < 8; i++) this.SpawnObject(mk(Kind.Coin, 0, z + 12 + i * 1.6, z + 12 + i * 1.6, TrainH + 0.75));
    this.lane = this.fromLane = 1; this.px = 0; this.switchT = 1;
    this.py = 1.7; this.vy = 4; this.grounded = false;
    this.chase = drone ? 99 : 0; this.droneVis = drone ? 1 : 0; this.droneX = this.px + 1.6; this.droneY = 3.2;
    this.posed = true;
    this.poseShift = shiftX;
    this.F *= zoom;
    this.horizon += horizonDy;
    this.camY = this.baseCamY;
  }

  /** Test hook: state for the Playwright bot. */
  Snapshot() {
    return {
      state: this.State, crashed: this.crashed, cont: this.contOpen, pz: this.pz, lane: this.lane, py: this.py, grounded: this.grounded,
      speed: this.speed, score: Math.floor(this.score), coins: this.coinsRun, bank: this.Coins, chase: this.chase, boost: this.boost,
      frameMs: this.frameMs, tier: this.Tier(), crashKind: this.crashKind, sprites: this.coins.length + this.obstacles.length,
    };
  }

  // ------------------------------------------------------------------ collisions

  private Collide(prevZ: number) {
    if (this.boost > 0) return;
    const pz = this.pz, px = this.px, py = this.py;
    const h = this.rolling > 0 ? RollH : PlayerH;
    const zMin = Math.min(prevZ, pz) - 0.35, zMax = pz + 0.35;
    const ghost = this.invuln > 0;
    // obstacles
    for (const o of this.obstacles) {
      if (o.smashed > 0) continue;
      if (o.z + 0.6 < zMin || o.z - 0.6 > zMax) continue;
      const ox = laneX(o.lane);
      if (Math.abs(px - ox) > 1.0 + PlayerHW) continue;
      let y0 = 0, y1 = 0.95;
      if (o.kind === Kind.Bar) { y0 = 1.25; y1 = 2.6; }
      if (o.kind === Kind.Block) { y0 = 0; y1 = 2.3; }
      const thick = o.kind === Kind.Block ? 0.5 : 0.18;
      if (o.z + thick < zMin + 0.1 || o.z - thick > zMax - 0.1) continue;
      if (py + h <= y0 + 0.05 || py >= y1 - 0.05) continue;
      if (ghost) continue;
      const frontal = Math.abs(px - ox) < 0.75 && prevZ + 0.35 <= o.z - thick + 0.5;
      if (frontal) this.Hit(o.kind === Kind.Bar ? "bar" : o.kind === Kind.Block ? "block" : "barrier", o);
      else this.Stumble();
      return;
    }
    // trains
    for (const t of this.trains) {
      const tx = laneX(t.lane);
      if (Math.abs(px - tx) > TrainHW + PlayerHW) continue;
      const f = this.TrainFront(t), b = f + t.len;
      if (pz + 0.35 < f || pz - 0.35 > b) continue;
      if (py >= TrainH - 0.15) continue;
      if (ghost) continue;
      const fPrev = this.TrainFront(t, prevZ);
      const wasBefore = prevZ + 0.35 <= fPrev + 0.05;
      if (wasBefore && Math.abs(px - tx) < TrainHW) {
        // ran into the front: forgiving if we're nearly level with the roof
        if (py > TrainH - 0.85 && !t.moving) { this.py = TrainH; this.grounded = true; this.vy = 0; continue; }
        this.Hit(t.moving ? "train-onc" : "train", null);
      } else this.Stumble();
      return;
    }
  }

  private Hit(kind: string, o: Obstacle | null) {
    if (this.power[Power.Shield] > 0) {
      this.power[Power.Shield] = 0;
      this.invuln = 1.2;
      Sfx.play(Snd.Zap, 0.8);
      Sfx.play(Snd.Explode, 0.5);
      this.Fx.shake(0.3);
      if (o) { o.smashed = 0.001; this.Burst(o.lane, o.z, 1, Pal.hex(0xff8a3d)); }
      this.UI.Float(new V2(0, 1.5), "SHIELD SAVED YOU!", Teal, 0.9);
      this.FlashScreen(Teal, 0.35);
      return;
    }
    this.Crash(kind);
  }

  private Stumble() {
    this.stumbles++;
    if (this.chase > 0) { this.Crash("caught"); return; }
    // bounce back to where we came from
    const back = this.fromLane;
    this.fromLane = this.lane;
    this.lane = back;
    this.switchStartX = this.px;
    this.switchT = 0;
    this.chase = ChaseTime;
    this.penalty = 0.8;
    this.invuln = 0.4;
    Sfx.play(Snd.Hurt, 0.7);
    Sfx.play(Snd.Alarm, 0.25, 1.4);
    this.Fx.shake(0.28);
    Fx.haptic(true);
    this.Dust(1.2);
    this.UI.Float(new V2(0, 1.5), "WHOA!", Pal.hex(0xff4d6a), 0.9);
  }

  crashInfo = ""; lastJumpInfo = "";
  private Crash(kind: string) {
    const row = Math.floor(this.pz / ROW);
    const rows: string[] = [];
    for (let r = row - 3; r <= row + 2; r++) rows.push((this.gen.cellsAt(r) ?? []).join(""));
    this.crashInfo = `lane=${this.lane} from=${this.fromLane} sw=${this.switchT.toFixed(2)} px=${this.px.toFixed(2)} py=${this.py.toFixed(2)} vy=${this.vy.toFixed(1)} g=${this.grounded} roll=${this.rolling.toFixed(2)} v=${this.speed.toFixed(1)} zrow=${(this.pz - row * ROW).toFixed(2)} rows=${rows.join("|")} lastJump=${this.lastJumpInfo}`;
    this.crashed = true;
    this.crashT = 0;
    this.crashKind = kind;
    this.rolling = 0;
    this.boostLoop.volume = 0;
    this.Hitstop(0.1);
    Sfx.playClip(this.crashClip, 1);
    Sfx.play(Snd.Hurt, 0.8);
    this.Fx.shake(0.75);
    Fx.haptic(true);
    this.Burst(this.lane, this.pz + 0.6, 1.0, Pal.hex(0xfff1d6));
    this.FlashScreen(Color.white, 0.45);
    if (kind === "caught") this.UI.Announce("CAUGHT!", Pal.hex(0xff4d6a), 1.2);
    else this.UI.Announce("OUCH!", Pal.hex(0xff4d6a), 1.0);
    this.UI.SetPauseButton(false);
    Sfx.setIntensity(0.1);
  }

  private CrashAnim(dt: number) {
    // knocked back onto the ground, the drone swoops in
    this.vy -= 30 * dt;
    this.py = Math.max(this.SurfaceAt(this.px, this.pz), this.py + this.vy * dt);
    if (this.crashT < dt * 1.5) this.vy = 6;
    this.chase = Math.max(this.chase, 0.5);
  }

  // ------------------------------------------------------------------ continue (rewarded ad or coins)

  private ContinueCost() { return this.continues === 0 ? 300 : 900; }

  private OfferContinue() {
    if (this.contOpen) return;
    const adOk = AdService.rewardedAvailable && this.adContinues < 2;
    const coinOk = this.Coins >= this.ContinueCost();
    if (this.continues >= 2 || (!adOk && !coinOk)) { this.EndRun(); return; }
    this.contOpen = true;
    this.contTimer = 6;
    this.contNode.setActive(true);
    this.contNode.setAsLastSibling();
    this.contTitle.text = this.continues === 0 ? "KEEP RUNNING?" : "ONE LAST CHANCE!";
    this.contAd.node.setActive(adOk);
    this.contCoins.node.setActive(true);
    if (this.contCoins.label) this.contCoins.label.text = `USE ${Fmt.n(this.ContinueCost())} COINS`;
    this.contCoins.interactable = coinOk;
    Sfx.play(Snd.Warn, 0.6);
  }

  private TickContinue(dt: number) {
    if (AdService.isShowing) return;
    this.contTimer -= Time.unscaledDeltaTime || dt;
    this.contRing.fillAmount = Mathf.clamp01(this.contTimer / 6);
    if (this.contTimer <= 0) this.DeclineContinue();
  }

  private ContinueAd() {
    if (!this.contOpen || AdService.isShowing) return;
    AdService.showRewarded((earned) => {
      if (!earned) return;
      this.adContinues++;
      this.KeepRunning();
    });
  }

  private ContinueCoins() {
    if (!this.contOpen) return;
    const cost = this.ContinueCost();
    if (this.Coins < cost) { Sfx.play(Snd.Deny, 0.6); return; }
    this.Coins = this.Coins - cost;
    this.KeepRunning();
  }

  private DeclineContinue() {
    if (!this.contOpen) return;
    this.contOpen = false;
    this.contNode.setActive(false);
    this.EndRun();
  }

  private KeepRunning() {
    this.continues++;
    this.contOpen = false;
    this.contNode.setActive(false);
    this.crashed = false;
    this.chase = 0;
    this.droneVis = 0;
    this.penalty = 0.85;
    this.ClearAhead(this.pz + 4);
    this.gen.emitEmpty(3);
    this.lane = this.fromLane = Mathf.clamp(Math.round(this.px / LaneW) + 1, 0, 2);
    this.px = laneX(this.lane);
    this.switchT = 1;
    this.py = this.SurfaceAt(this.px, this.pz);
    this.vy = 0;
    this.grounded = true;
    this.invuln = 2.5;
    this.pointer.reset();
    this.swipeUsed = false;
    this.FlashScreen(Color.white, 0.8);
    this.UI.SetPauseButton(true);
    this.UI.Announce("KEEP RUNNING!", Pal.Good, 1.2);
    Sfx.play(Snd.PowerUp, 0.9);
    Sfx.setIntensity(0.5);
    this.Generate();
  }

  private EndRun() {
    this.contOpen = false;
    this.contNode.setActive(false);
    const score = Math.floor(this.score), dist = Math.floor(this.runDist);
    const newBest = this.Data.max("best", score);
    this.Data.max("bestDist", dist);
    this.Data.add("totalCoins", this.coinsRun);
    if (this.tutorialRun) this.Data.set("tut", 1);
    Sfx.play(newBest ? Snd.Win : Snd.Lose, 0.8);
    const earned = this.coinsRun;
    const headline = this.crashKind === "caught" ? "BEEP CAUGHT YOU!" : this.crashKind === "train-onc" ? "HEAD-ON WITH A TRAIN!" : this.crashKind === "train" ? "SMACK INTO A TRAIN!" : "CRASHED!";
    this.Finish(new Result({
      Headline: headline,
      HeadlineColor: Pal.hex(0xffd9a8),
      Value: Fmt.n(score),
      CountTo: score,
      NewBest: newBest,
      BestLine: `BEST ${Fmt.n(this.Data.get("best"))}`,
      Stats: [
        ["DISTANCE", Fmt.n(dist) + " M"],
        ["COINS", "+" + Fmt.n(earned)],
        ["TOP SPEED", Mathf.roundToInt(this.topSpeed * 3.6) + " KM/H"],
        ["BANK", Fmt.n(this.Coins)],
      ],
      Primary: "RUN AGAIN",
      Reward: earned > 0 ? () => {
        this.Coins = this.Coins + earned;
        this.Data.add("totalCoins", earned);
        Sfx.play(Snd.Coin, 0.9, 1.2);
        this.fx.confetti(new V2(0, 0), 50, 10, [Gold, Pal.hex(0xffe066), Pal.hex(0xff9a1a)], 0.3);
        this.UI.Toast(`+${Fmt.n(earned)} bonus coins! Bank: ${Fmt.n(this.Coins)}`, 3);
      } : null,
      RewardLabel: `DOUBLE COINS: +${Fmt.n(earned)} (WATCH AD)`,
    }));
  }

  // ------------------------------------------------------------------ pickups

  private Collect(dt: number) {
    const pz = this.pz, px = this.px, py = this.py;
    const h = this.rolling > 0 ? RollH : PlayerH;
    const magnet = this.power[Power.Magnet] > 0 || this.boost > 0;
    this.coinChainT -= dt;
    if (this.coinChainT <= 0) this.coinChain = 0;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      const dz = c.z - pz;
      if (dz > 20) continue;
      if (magnet && dz < 16 && dz > -1 && (c.air === (this.boost > 0) || this.power[Power.Magnet] > 0)) {
        c.pulled = true;
      }
      if (c.pulled) {
        const k = 1 - Math.exp(-dt * 14);
        c.x += (px - c.x) * k;
        c.y += (py + 0.9 - c.y) * k;
        c.z += (pz + 0.2 - c.z) * Math.min(1, k * 1.3);
      }
      if (Math.abs(c.z - pz) < 0.9 && Math.abs(c.x - px) < 0.95 && c.y > py - 0.4 && c.y < py + h + 0.5) {
        this.TakeCoin(c);
        this.coinPool.give(c.sr);
        this.coins.splice(i, 1);
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (Math.abs(p.z - pz) < 1.1 && Math.abs(laneX(p.lane) - px) < 1.1 && p.y > py - 0.6 && p.y < py + h + 0.8) {
        this.TakePower(p.kind);
        this.powerPool.give(p.sr);
        this.glowPool.give(p.glow);
        this.pickups.splice(i, 1);
      }
    }
  }

  private TakeCoin(c: Coin) {
    if (this.attract) return;
    this.coinsRun++;
    this.Coins = this.Coins + 1;
    this.coinChain = Math.min(this.coinChain + 1, 16);
    this.coinChainT = 0.45;
    Sfx.playClip(this.coinClip, 0.55, 1 + this.coinChain * 0.04);
    if (this.P(c.x, c.y, c.z)) this.fx.sparkle(new V2(this.sx, this.sy), Gold, 2, 0.3 * this.ss, 0.35 * this.ss);
  }

  private TakePower(kind: number) {
    if (this.attract) return;
    const dur = this.PowerDuration(kind);
    Sfx.play(Snd.PowerUp, 0.85);
    this.UI.Float(new V2(0, 2.2), PowerNames[kind] + "!", PowerColors[kind], 1);
    this.Fx.kick(0.5, 0.2);
    if (kind === Power.Boost) {
      this.boost = this.boostMax = dur;
      this.boostLane = this.lane;
      this.boostCoinZ = this.pz + 14;
      this.boostEnd = this.pz + this.speed * 1.2 * dur;
      this.rolling = 0;
      this.ClearAhead(this.pz + 26);
      this.FlashScreen(Color.white, 0.55);
      this.Generate();
      return;
    }
    this.power[kind] = this.powerMax[kind] = dur;
  }

  /** Coin lines in the sky while the jetpack is on. */
  private SpawnBoostCoins() {
    const end = Math.min(this.boostEnd - 10, this.pz + Far);
    while (this.boostCoinZ < end) {
      if (this.rng.nextDouble() < 0.06) this.boostLane = Mathf.clamp(this.boostLane + (this.rng.next(2) === 0 ? -1 : 1), 0, 2);
      this.coins.push({ x: laneX(this.boostLane), y: BoostY + 0.9, z: this.boostCoinZ, sr: this.coinPool.take(), pulled: false, air: true });
      this.boostCoinZ += 1.7;
    }
  }

  // ------------------------------------------------------------------ events (hints, horns, near misses)

  private Events() {
    if (this.attract) return;
    // tutorial hints
    for (const [row, key] of this.gen.hints) {
      if (this.hintShown.has(row)) continue;
      const d = row * ROW - this.pz;
      if (d > this.speed * 1.9 || d < 0) continue;
      this.hintShown.add(row);
      const touch = this.Controls.usingTouch || isMobile();
      const text = key === "lane" ? (touch ? "SWIPE LEFT or RIGHT to change lanes!" : "Press ← or → to change lanes!")
        : key === "jump" ? (touch ? "SWIPE UP to jump!" : "Press ↑ or SPACE to jump!")
        : key === "roll" ? (touch ? "SWIPE DOWN to roll!" : "Press ↓ to roll!")
        : "Run up the RAMP onto the trains!";
      this.UI.Toast(text, 2.6);
      this.SlowMo(0.45, 0.9);
      Sfx.play(Snd.Beep, 0.6, 1.2);
    }
    for (const t of this.trains) {
      if (!t.moving) continue;
      const f = this.TrainFront(t), d = f - this.pz;
      if (!t.horned && d < 70) { t.horned = true; Sfx.playClip(this.hornClip, 0.8, 1); }
      if (!t.passed && d < 0) {
        t.passed = true;
        if (Math.abs(t.lane - this.lane) === 1 && this.boost <= 0 && Math.abs(this.py - 0) < 1) {
          this.score += 50 * this.mult;
          this.UI.Float(new V2(laneX(t.lane) * 0.5, 0.5), "CLOSE CALL +" + 50 * this.mult, Pal.hex(0xffe066), 0.8);
          this.SlowMo(0.55, 0.22);
        }
      }
    }
  }

  // ------------------------------------------------------------------ recycling

  private Recycle() {
    const behind = this.camZ - 2;
    for (let i = this.obstacles.length - 1; i >= 0; i--) if (this.obstacles[i].z < behind) { this.PoolFor(this.obstacles[i].kind).give(this.obstacles[i].sr); this.obstacles.splice(i, 1); }
    for (let i = this.trains.length - 1; i >= 0; i--) if (this.TrainBack(this.trains[i]) < behind) { this.FreeTrain(this.trains[i]); this.trains.splice(i, 1); }
    for (let i = this.ramps.length - 1; i >= 0; i--) if (this.ramps[i].z1 < behind) { this.carPool.give(this.ramps[i].poly); this.ramps.splice(i, 1); }
    for (let i = this.coins.length - 1; i >= 0; i--) if (this.coins[i].z < behind) { this.coinPool.give(this.coins[i].sr); this.coins.splice(i, 1); }
    for (let i = this.pickups.length - 1; i >= 0; i--) if (this.pickups[i].z < behind) { this.powerPool.give(this.pickups[i].sr); this.glowPool.give(this.pickups[i].glow); this.pickups.splice(i, 1); }
  }

  // ------------------------------------------------------------------ fx helpers

  private Dust(amount: number) {
    if (!this.P(this.px, this.py, this.pz)) return;
    const n = Math.round(4 * amount) + 1;
    for (let i = 0; i < n; i++) {
      const dir = new V2((Random01(this.jumps * 31 + i + Time.frameCount) - 0.5) * 3, 0.6 + Random01(i + Time.frameCount * 7) * 1.4).mul(this.ss);
      this.fx.emit(new V2(this.sx + (Random01(i * 3 + Time.frameCount) - 0.5) * 0.6 * this.ss, this.sy + 0.1 * this.ss), dir, new Color(0.93, 0.86, 0.76, 0.75), 0.55 * this.ss * (0.6 + amount * 0.4), 0.45, CasualArt.Soft, -2 * this.ss, 0, true, 3);
    }
  }

  private Burst(lane: number, z: number, amount: number, color: Color) {
    if (!this.P(laneX(lane), 1, z)) return;
    const pos = new V2(this.sx, this.sy);
    this.fx.pop(pos, color, Math.round(14 * amount), 7 * this.ss, 0.35 * this.ss, 0.6);
    this.fx.pop(pos, new Color(0.95, 0.9, 0.82, 0.8), Math.round(10 * amount), 4 * this.ss, 0.5 * this.ss, 0.5);
  }

  private flashA = 0; private flashColor = Color.white;
  private FlashScreen(c: Color, a: number) { this.flashColor = c; this.flashA = Math.max(this.flashA, a); }

  // ------------------------------------------------------------------ rendering

  private UpdateWorldVisuals(dt: number) {
    // camera follows the runner
    const k = 1 - Math.exp(-dt * 7);
    const surf = this.grounded ? this.py : this.SurfaceAt(this.px, this.pz);
    const wantY = this.baseCamY + (this.boost > 0 ? this.py * 0.75 : surf * 0.85 + Math.max(0, this.py - surf) * 0.3);
    if (dt > 0) {
      this.camX += (this.px * 0.72 - this.camX) * k;
      this.camY += (wantY - this.camY) * (1 - Math.exp(-dt * 4));
    }
    if (this.posed) this.camX = this.px * 0.72 + this.poseShift;
    this.camZ = this.pz - CamBack;
    this.coinSpin += dt * 5;

    this.DrawSky(dt);
    this.DrawGround();
    this.DrawCity();
    this.DrawProps();
    this.DrawObstacles(dt);
    this.DrawTrains();
    this.DrawPickups(dt);
    this.DrawRunner(dt);
    this.DrawDrone(dt);
    this.DrawSpeedLines(dt);
    this.flashA = Mathf.moveTowards(this.flashA, 0, Time.unscaledDeltaTime * 2.2);
    this.flash.color = this.flashColor.withAlpha(this.flashA);
    const intensity = this.State === Phase.Playing && !this.crashed ? 0.35 + 0.55 * Mathf.clamp01((this.speed - 14) / 14) + (this.boost > 0 ? 0.1 : 0) : 0.1;
    if (this.State === Phase.Playing) Sfx.setIntensity(intensity);
    this.boostLoop.volume = this.boost > 0 && Settings.Sound && this.State === Phase.Playing ? 0.22 : Mathf.moveTowards(this.boostLoop.volume, 0, Time.unscaledDeltaTime * 2);
  }

  private DrawSky(dt: number) {
    const W = this.ViewSize.x;
    const shift = -this.camX * 0.06;
    this.skyline[0].transform.localPosition = this.skyline[0].transform.localPosition.withX(shift * 0.5);
    this.skyline[1].transform.localPosition = this.skyline[1].transform.localPosition.withX(shift);
    for (const c of this.clouds) {
      c.x -= dt * 0.012;
      if (c.x < -0.8) c.x += 1.6;
      c.sr.transform.localPosition = new V3(c.x * W * 1.1 + shift * 0.3, this.horizon + 1.5 + c.y * Math.max(3, this.ViewSize.y * 0.5 - this.horizon), 0);
      c.sr.transform.localScale = new V3(c.s, c.s, 1);
    }
  }

  /** Track bed, sleepers, rails, low walls and the yard floor. */
  private DrawGround() {
    const g = this.ground;
    g.begin();
    const camZ = this.camZ, F = this.F, hz = this.horizon, cy = this.camY, cx = this.camX;
    const bottom = -this.ViewSize.y / 2 - 0.5;
    const dMin = Math.max(Near, (cy * F) / Math.max(0.1, hz - bottom) * 0.9);
    const zNear = camZ + dMin, zFar = camZ + Far;
    const seg = 6;
    const X = (x: number, s: number) => (x - cx) * s;
    const Yg = (y: number, s: number) => hz + (y - cy) * s;
    const quadFlat = (xa: number, xb: number, y: number, z0: number, z1: number, rgb: number) => {
      const s0 = F / (z0 - camZ), s1 = F / (z1 - camZ);
      g.quad(X(xa, s0), Yg(y, s0), X(xb, s0), Yg(y, s0), X(xb, s1), Yg(y, s1), X(xa, s1), Yg(y, s1), rgb);
    };
    const wallFace = (x: number, h: number, z0: number, z1: number, rgb: number) => {
      const s0 = F / (z0 - camZ), s1 = F / (z1 - camZ);
      g.quad(X(x, s0), Yg(0, s0), X(x, s0), Yg(h, s0), X(x, s1), Yg(h, s1), X(x, s1), Yg(0, s1), rgb);
    };
    // horizon haze strip under far geometry
    for (let kk = Math.floor(zFar / seg); kk * seg + seg > zNear; kk--) {
      const z0 = Math.max(kk * seg, zNear), z1 = Math.min(kk * seg + seg, zFar);
      if (z1 <= z0) continue;
      const fog = this.fogK((z0 + z1) / 2 - camZ) * 0.92;
      const odd = (kk & 1) === 1;
      const yard = mixRgb(odd ? 0xb9ada0 : 0xb0a497, FogRgb, fog);
      quadFlat(-90, -4.3, 0, z0, z1, yard);
      quadFlat(4.3, 90, 0, z0, z1, yard);
      const bed = mixRgb(odd ? 0x8f7d70 : 0x877567, FogRgb, fog);
      quadFlat(-3.95, 3.95, 0, z0, z1, bed);
      // lane beds (darker ballast between the rails)
      for (let l = 0; l < LANES; l++) quadFlat(laneX(l) - 0.95, laneX(l) + 0.95, 0, z0, z1, mixRgb(odd ? 0x75655a : 0x6e5f54, FogRgb, fog));
      // low walls along the track
      const wallTop = mixRgb(0xe2d8ca, FogRgb, fog), wallSide = mixRgb(0xbcae9d, FogRgb, fog);
      if (cx > -3.95) wallFace(-3.95, 0.7, z0, z1, wallSide);
      if (cx < 3.95) wallFace(3.95, 0.7, z0, z1, wallSide);
      quadFlat(-4.35, -3.95, 0.7, z0, z1, wallTop);
      quadFlat(3.95, 4.35, 0.7, z0, z1, wallTop);
      // yard stripes for a sense of speed
      if (!odd) {
        quadFlat(-6.2, -5.9, 0, z0, z0 + Math.min(3, z1 - z0), mixRgb(0xf2e6d2, FogRgb, fog));
        quadFlat(5.9, 6.2, 0, z0, z0 + Math.min(3, z1 - z0), mixRgb(0xf2e6d2, FogRgb, fog));
      }
    }
    // sleepers
    const sp = 1.35;
    for (let n = Math.floor(Math.min(zFar, camZ + 80) / sp); n * sp > zNear; n--) {
      const z = n * sp, depth = z - camZ;
      if (depth > 45 && (n & 1) === 1) continue;
      const fog = this.fogK(depth) * 0.92;
      const rgb = mixRgb(0x5a4334, FogRgb, fog);
      for (let l = 0; l < LANES; l++) quadFlat(laneX(l) - 1.12, laneX(l) + 1.12, 0.03, z - 0.2, z + 0.2, rgb);
    }
    // rails (split in depth bands for the fog)
    const bands = [zNear, camZ + 18, camZ + 40, camZ + 70, zFar];
    for (let b = 0; b + 1 < bands.length; b++) {
      const z0 = bands[b], z1 = bands[b + 1];
      if (z1 <= z0) continue;
      const fog = this.fogK((z0 + z1) / 2 - camZ) * 0.92;
      const base = mixRgb(0x4a4550, FogRgb, fog), top = mixRgb(0xe6e9f0, FogRgb, fog);
      for (let l = 0; l < LANES; l++)
        for (const off of [-0.62, 0.62]) {
          const x = laneX(l) + off;
          quadFlat(x - 0.09, x + 0.09, 0.06, z0, z1, base);
          quadFlat(x - 0.05, x + 0.05, 0.16, z0, z1, top);
        }
    }
  }

  /** Buildings on both sides of the yard. */
  private DrawCity() {
    const camZ = this.camZ, zFar = camZ + Far + 10;
    for (let side = 0; side < 2; side++) {
      while (this.buildZ[side] < zFar) {
        const z0 = this.buildZ[side] + (this.rng.nextDouble() < 0.25 ? 2 + this.rng.nextDouble() * 4 : 0.4);
        const len = 8 + this.rng.nextDouble() * 14;
        this.buildings.push({
          side: side === 0 ? -1 : 1, z0, z1: z0 + len, x: 6.6 + this.rng.nextDouble() * 1.6, h: 6 + this.rng.nextDouble() * (this.rng.nextDouble() < 0.3 ? 16 : 8),
          depth: 8 + this.rng.nextDouble() * 6, rgb: BuildingRgb[this.rng.next(BuildingRgb.length)], style: this.rng.next(3),
        });
        this.buildZ[side] = z0 + len;
      }
    }
    for (let i = this.buildings.length - 1; i >= 0; i--) if (this.buildings[i].z1 < camZ + Near) this.buildings.splice(i, 1);
    const g = this.city;
    g.begin();
    // far to near
    const list = this.buildings;
    list.sort((a, b) => b.z0 - a.z0);
    for (const b of list) this.DrawBuilding(b);
  }

  private DrawBuilding(b: Building) {
    const g = this.city, camZ = this.camZ, F = this.F, hz = this.horizon, cy = this.camY, cx = this.camX;
    const z0 = Math.max(b.z0, camZ + Near), z1 = Math.min(b.z1, camZ + Far);
    if (z1 <= z0) return;
    const fog = this.fogK((z0 + z1) * 0.5 - camZ) * 0.9;
    const xIn = b.side * b.x, xOut = b.side * (b.x + b.depth);
    const s0 = F / (z0 - camZ), s1 = F / (z1 - camZ);
    const X = (x: number, s: number) => (x - cx) * s, Y = (y: number, s: number) => hz + (y - cy) * s;
    const base = b.rgb;
    // roof (only visible when below the camera)
    if (b.h < cy) g.quad(X(xIn, s0), Y(b.h, s0), X(xOut, s0), Y(b.h, s0), X(xOut, s1), Y(b.h, s1), X(xIn, s1), Y(b.h, s1), mixRgb(shadeRgb(base, 0.72), FogRgb, fog));
    // front wall (faces the camera)
    if (b.z0 >= camZ + Near) {
      g.quad(X(xIn, s0), Y(0, s0), X(xOut, s0), Y(0, s0), X(xOut, s0), Y(b.h, s0), X(xIn, s0), Y(b.h, s0), mixRgb(shadeRgb(base, 1.05), FogRgb, fog));
    }
    // side wall facing the track
    const sideRgb = mixRgb(shadeRgb(base, 0.86), FogRgb, fog);
    g.quad(X(xIn, s0), Y(0, s0), X(xIn, s0), Y(b.h, s0), X(xIn, s1), Y(b.h, s1), X(xIn, s1), Y(0, s1), sideRgb);
    // parapet
    g.quad(X(xIn, s0), Y(b.h - 0.35, s0), X(xIn, s0), Y(b.h, s0), X(xIn, s1), Y(b.h, s1), X(xIn, s1), Y(b.h - 0.35, s1), mixRgb(shadeRgb(base, 0.65), FogRgb, fog));
    // awning stripe
    const aw = b.style === 0 ? 0xff6a4a : b.style === 1 ? 0x2bb5a8 : 0xffc23a;
    g.quad(X(xIn, s0), Y(2.6, s0), X(xIn, s0), Y(3.1, s0), X(xIn, s1), Y(3.1, s1), X(xIn, s1), Y(2.6, s1), mixRgb(aw, FogRgb, fog));
    // windows (skipped far away)
    const depthMid = (z0 + z1) * 0.5 - camZ;
    if (depthMid > 75) return;
    const glass = mixRgb(0x34507e, FogRgb, fog), lit = mixRgb(0xffe2a0, FogRgb, fog), frame = mixRgb(shadeRgb(base, 0.6), FogRgb, fog);
    const cols = Math.floor((b.z1 - b.z0 - 1) / 2.4);
    for (let r = 0; ; r++) {
      const y = 4.2 + r * 2.6;
      if (y + 1.4 > b.h - 0.6) break;
      for (let c = 0; c < cols; c++) {
        const wz0 = b.z0 + 1 + c * 2.4, wz1 = wz0 + 1.2;
        if (wz0 < camZ + Near || wz1 > camZ + Far) continue;
        const a0 = F / (wz0 - camZ), a1 = F / (wz1 - camZ);
        const on = ((c * 7 + r * 13 + Math.floor(b.z0)) % 9) === 0;
        g.quad(X(xIn, a0), Y(y - 0.08, a0), X(xIn, a0), Y(y + 1.48, a0), X(xIn, a1), Y(y + 1.48, a1), X(xIn, a1), Y(y - 0.08, a1), frame);
        g.quad(X(xIn, a0), Y(y, a0), X(xIn, a0), Y(y + 1.4, a0), X(xIn, a1), Y(y + 1.4, a1), X(xIn, a1), Y(y, a1), on ? lit : glass);
      }
    }
  }

  /** Lamp posts and signal gantries. */
  private DrawProps() {
    const camZ = this.camZ;
    // keep lamps every 16 m (alternating sides) and a gantry every 64 m
    for (const l of this.lamps) if (l.z < camZ + Near) l.z = -999;
    for (const gt of this.gantries) if (gt.z < camZ + Near) gt.z = -999;
    if (this.propZ < camZ) this.propZ = Math.ceil(camZ / 16) * 16;
    while (this.propZ < camZ + Far) {
      const slot = this.lamps.find((l) => l.z < -900);
      if (!slot) break;
      slot.z = this.propZ;
      slot.side = Math.round(this.propZ / 16) % 2 === 0 ? -1 : 1;
      if (Math.round(this.propZ / 16) % 4 === 0) {
        const gslot = this.gantries.find((x) => x.z < -900);
        if (gslot) gslot.z = this.propZ + 8;
      }
      this.propZ += 16;
    }
    for (const l of this.lamps) {
      const on = l.z > -900 && this.P(l.side * 4.6, 3.2, l.z);
      l.sr.gameObject.setActive(on);
      if (!on) continue;
      const d = l.z - camZ;
      l.sr.transform.localPosition = new V3(this.sx + (l.side < 0 ? 0.45 : -0.45) * this.ss, this.sy, 0);
      l.sr.transform.localScale = new V3(1.6 * this.ss, 1.6 * this.ss, 1);
      l.sr.flipX = l.side < 0;
      l.sr.color = Color.white.withAlpha(1 - this.fogK(d) * 0.9);
      l.sr.sortingOrder = DashRushGame.order(d);
    }
    for (const gt of this.gantries) {
      const on = gt.z > -900 && this.P(0, 3.7, gt.z);
      gt.sr.gameObject.setActive(on);
      if (!on) continue;
      const d = gt.z - camZ;
      gt.sr.transform.localPosition = new V3(this.sx, this.sy, 0);
      gt.sr.transform.localScale = new V3(10 * this.ss, 10 * this.ss, 1);
      gt.sr.color = Color.white.withAlpha((1 - this.fogK(d) * 0.9) * Mathf.clamp01((d - 9) / 10));
      gt.sr.sortingOrder = DashRushGame.order(d) + 0.05;
    }
  }

  /** Places a sprite with its bottom at (x, y, z); world width w (sprites are 1 unit wide at scale 1). */
  private Place(sr: SpriteRenderer, x: number, y: number, z: number, w: number, aspect: number, keyBias = 0) {
    const d = z - this.camZ;
    if (d < Near || d > Far) { sr.enabled = false; return false; }
    sr.enabled = true;
    this.P(x, y + (w * aspect) / 2, z);
    sr.transform.localPosition = new V3(this.sx, this.sy, 0);
    sr.transform.localScale = new V3(w * this.ss, w * this.ss, 1);
    // elevated pickups draw over the roofs/ramps they sit on, but never over the runner when they are ahead of it
    sr.sortingOrder = DashRushGame.order(keyBias < 0 && d > CamBack ? Math.max(d + keyBias, CamBack + 0.2) : d + keyBias);
    const fog = this.fogK(d);
    sr.color = Color.white.withAlpha(1 - fog * fog * 0.95);
    return true;
  }

  private DrawObstacles(dt: number) {
    for (const o of this.obstacles) {
      const w = 2.2, aspect = o.kind === Kind.Barrier ? 0.5 : o.kind === Kind.Bar ? 260 / 220 : 236 / 220;
      let y = 0, x = laneX(o.lane);
      if (o.smashed > 0) {
        o.smashed += dt;
        y = o.smashed * 8 - o.smashed * o.smashed * 20;
        x += o.smashed * 6 * (o.lane === 0 ? -1 : 1);
        o.sr.transform.localEulerZ = o.smashed * 400;
        if (o.smashed > 1) { o.sr.enabled = false; continue; }
      } else o.sr.transform.localEulerZ = 0;
      this.Place(o.sr, x, y, o.z, w, aspect);
    }
  }

  private DrawTrains() {
    const camZ = this.camZ;
    for (const t of this.trains) {
      const f = this.TrainFront(t), x = laneX(t.lane);
      const over = this.pz + 1 > f && this.pz - 1 < f + t.len; // runner is alongside / on top
      for (let i = 0; i < t.cars.length; i++) {
        const c = t.cars[i];
        const za = f + c.a, zb = f + c.b;
        const visible = zb > camZ + Near && za < camZ + Far;
        c.poly.enabled = visible;
        if (!visible) continue;
        let key = (Math.max(za, camZ + Near) + Math.min(zb, camZ + Far)) / 2 - camZ;
        if (over && this.pz > za - 1 && this.pz < zb + 1) key = Math.max(key, CamBack + 0.3);
        c.poly.sortingOrder = DashRushGame.order(key);
        this.DrawCar(c.poly, x, za, zb, t.livery, i === 0, i === t.cars.length - 1);
      }
      // locomotive face
      const fd = f - camZ;
      const faceOn = fd >= Near && fd < Far;
      t.front.enabled = faceOn;
      if (faceOn) {
        this.P(x, TrainH / 2, f);
        t.front.transform.localPosition = new V3(this.sx, this.sy, 0);
        t.front.transform.localScale = new V3(TrainHW * 2 * this.ss, TrainHW * 2 * this.ss, 1);
        t.front.sortingOrder = DashRushGame.order(Math.max(fd, (t.cars[0].b - t.cars[0].a) * 0.5 + fd)) + 0.01;
        const fog = this.fogK(fd);
        t.front.color = Color.white.withAlpha(1 - fog * fog * 0.95);
      }
      for (let i = 0; i < t.lights.length; i++) {
        const l = t.lights[i];
        l.enabled = faceOn;
        if (!faceOn) continue;
        this.P(x + (i === 0 ? -0.62 : 0.62) * TrainHW, 1.02, f - 0.05);
        const pulse = 0.85 + 0.15 * Math.sin(Time.time * 18 + i);
        l.transform.localPosition = new V3(this.sx, this.sy, 0);
        l.transform.localScale = new V3(1.4 * this.ss * pulse, 1.4 * this.ss * pulse, 1);
        l.sortingOrder = t.front.sortingOrder + 0.01;
      }
    }
    for (const r of this.ramps) {
      const visible = r.z1 > camZ + Near && r.z0 < camZ + Far;
      r.poly.enabled = visible;
      if (!visible) continue;
      r.poly.sortingOrder = DashRushGame.order((Math.max(r.z0, camZ + Near) + r.z1) / 2 - camZ);
      this.DrawRamp(r);
    }
  }

  private DrawCar(g: Polys, x: number, za: number, zb: number, livery: number, first: boolean, last: boolean) {
    g.begin();
    const camZ = this.camZ, F = this.F, hz = this.horizon, cy = this.camY, cx = this.camX;
    const z0 = Math.max(za, camZ + Near), z1 = Math.min(zb, camZ + Far);
    if (z1 <= z0) return;
    const L = Liveries[livery];
    const fog = this.fogK((z0 + z1) / 2 - camZ) * 0.9;
    const s0 = F / (z0 - camZ), s1 = F / (z1 - camZ);
    const X = (xx: number, s: number) => (xx - cx) * s, Y = (y: number, s: number) => hz + (y - cy) * s;
    const xl = x - TrainHW, xr = x + TrainHW;
    const fogc = (rgb: number) => mixRgb(rgb, FogRgb, fog);
    // side wall facing the camera
    const sideX = cx < xl ? xl : cx > xr ? xr : NaN;
    if (!isNaN(sideX)) {
      const sq = (ya: number, yb: number, rgb: number, za_ = z0, zb_ = z1) => {
        const a = F / (za_ - camZ), b = F / (zb_ - camZ);
        g.quad(X(sideX, a), Y(ya, a), X(sideX, a), Y(yb, a), X(sideX, b), Y(yb, b), X(sideX, b), Y(ya, b), rgb);
      };
      sq(0, TrainH, fogc(shadeRgb(L.body, 0.82)));
      sq(0, 0.55, fogc(0x2b2d3b));
      sq(1.05, 1.35, fogc(L.stripe));
      sq(TrainH - 0.2, TrainH, fogc(shadeRgb(L.body, 0.62)));
      const glass = fogc(0x223a64);
      // windows (or a door at the ends)
      for (let w = za + 1.0; w + 1.25 < zb - 0.6; w += 2.0) {
        if (w < z0 || w + 1.25 > z1) continue;
        sq(1.75, 2.75, glass, w, w + 1.25);
      }
    }
    // roof
    const roof = fogc(L.roof);
    g.quad(X(xl, s0), Y(TrainH, s0), X(xr, s0), Y(TrainH, s0), X(xr, s1), Y(TrainH, s1), X(xl, s1), Y(TrainH, s1), roof);
    // roof edge strips + vents
    const edge = fogc(shadeRgb(L.roof, 0.78));
    g.quad(X(xl, s0), Y(TrainH, s0), X(xl + 0.18, s0), Y(TrainH, s0), X(xl + 0.18, s1), Y(TrainH, s1), X(xl, s1), Y(TrainH, s1), edge);
    g.quad(X(xr - 0.18, s0), Y(TrainH, s0), X(xr, s0), Y(TrainH, s0), X(xr, s1), Y(TrainH, s1), X(xr - 0.18, s1), Y(TrainH, s1), edge);
    for (const k of [0.3, 0.7]) {
      const vz = za + (zb - za) * k;
      if (vz - 0.7 < z0 || vz + 0.7 > z1) continue;
      const a = F / (vz - 0.7 - camZ), b = F / (vz + 0.7 - camZ);
      g.quad(X(x - 0.45, a), Y(TrainH + 0.05, a), X(x + 0.45, a), Y(TrainH + 0.05, a), X(x + 0.45, b), Y(TrainH + 0.05, b), X(x - 0.45, b), Y(TrainH + 0.05, b), fogc(shadeRgb(L.roof, 0.6)));
    }
    // the coupled end of a following car peeks through the gap
    if (!first && za >= camZ + Near) {
      g.quad(X(xl + 0.2, s0), Y(0.4, s0), X(xr - 0.2, s0), Y(0.4, s0), X(xr - 0.2, s0), Y(TrainH - 0.2, s0), X(xl + 0.2, s0), Y(TrainH - 0.2, s0), fogc(0x23232e));
    }
    void last;
  }

  private DrawRamp(r: Ramp) {
    const g = r.poly;
    g.begin();
    const camZ = this.camZ, F = this.F, hz = this.horizon, cy = this.camY, cx = this.camX;
    const x = laneX(r.lane), xl = x - TrainHW, xr = x + TrainHW;
    const z0 = Math.max(r.z0, camZ + Near), z1 = Math.min(r.z1, camZ + Far);
    if (z1 <= z0) return;
    const hAt = (z: number) => TrainH * Mathf.clamp01((z - r.z0) / (r.z1 - r.z0));
    const fog = this.fogK((z0 + z1) / 2 - camZ) * 0.9;
    const X = (xx: number, s: number) => (xx - cx) * s, Y = (y: number, s: number) => hz + (y - cy) * s;
    // side face (triangle-ish)
    const sideX = cx < xl ? xl : cx > xr ? xr : NaN;
    const s0 = F / (z0 - camZ), s1 = F / (z1 - camZ);
    if (!isNaN(sideX)) g.quad(X(sideX, s0), Y(0, s0), X(sideX, s0), Y(hAt(z0), s0), X(sideX, s1), Y(hAt(z1), s1), X(sideX, s1), Y(0, s1), mixRgb(0x59647e, FogRgb, fog));
    // sloped deck in stripes
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = r.z0 + ((r.z1 - r.z0) * i) / n, b = r.z0 + ((r.z1 - r.z0) * (i + 1)) / n;
      const za = Math.max(a, z0), zb = Math.min(b, z1);
      if (zb <= za) continue;
      const sa = F / (za - camZ), sb = F / (zb - camZ);
      const rgb = mixRgb(i % 2 === 0 ? 0xffc23a : 0x3a3a4c, FogRgb, fog);
      g.quad(X(xl, sa), Y(hAt(za), sa), X(xr, sa), Y(hAt(za), sa), X(xr, sb), Y(hAt(zb), sb), X(xl, sb), Y(hAt(zb), sb), rgb);
    }
  }

  private DrawPickups(dt: number) {
    const spin = Math.abs(Math.cos(this.coinSpin));
    for (const c of this.coins) {
      if (!this.Place(c.sr, c.x, c.y - 0.31, c.z, 0.62, 1, c.y > 1.2 ? -6 : 0)) continue;
      const s = c.sr.transform.localScale;
      c.sr.transform.localScale = new V3(s.x * (0.25 + 0.75 * spin), s.y, 1);
    }
    for (const p of this.pickups) {
      const bob = 0.15 * Math.sin(Time.time * 3 + p.z);
      if (!this.Place(p.sr, laneX(p.lane), p.y + bob - 0.5, p.z, 1.0, 1, -6)) { p.glow.enabled = false; continue; }
      p.glow.enabled = true;
      p.glow.transform.localPosition = p.sr.transform.localPosition;
      const gs = p.sr.transform.localScale.x * (2.2 + 0.2 * Math.sin(Time.time * 6));
      p.glow.transform.localScale = new V3(gs, gs, 1);
      p.glow.sortingOrder = p.sr.sortingOrder - 0.005;
    }
    void dt;
  }

  private DrawRunner(dt: number) {
    const rig = this.rig;
    const d = CamBack;
    this.P(this.px, this.py, this.pz);
    rig.root.localPosition = new V3(this.sx, this.sy, 0);
    rig.root.localScale = new V3(this.ss, this.ss, 1);
    const order = DashRushGame.order(d);
    rig.setOrder(order);
    // shadow on the surface below
    const surf = this.SurfaceAt(this.px, this.pz);
    const lift = Math.max(0, this.py - surf);
    this.P(this.px, surf, this.pz);
    this.shadow.transform.localPosition = new V3(this.sx, this.sy, 0);
    const shs = this.ss * 1.3 / (1 + lift * 0.25);
    this.shadow.transform.localScale = new V3(shs, shs, 1);
    this.shadow.sortingOrder = order - 0.01;
    this.shadow.color = Color.white.withAlpha(1 / (1 + lift * 0.4));

    const lean = this.switchT < 1 ? Math.sin(this.switchT * Math.PI) * (this.lane > this.fromLane ? -1 : 1) * 14 : 0;
    rig.root.localEulerZ = lean;
    const blink = this.invuln > 0 && this.State === Phase.Playing && !this.crashed && Math.floor(Time.time * 14) % 2 === 0;
    const alpha = blink ? 0.45 : 1;
    for (const sr of [rig.torso, rig.head, rig.pack, rig.ball, ...rig.thigh, ...rig.shin, ...rig.arm]) sr.color = Color.white.withAlpha(alpha);

    if (this.crashed) {
      rig.showBody(true);
      const k = Mathf.clamp01(this.crashT * 3);
      rig.pose(0.6, 0.2, 150 * k, 150 * k, 0, 0);
      rig.root.localEulerZ = (this.lane === 0 ? 1 : -1) * 70 * k;
    } else if (this.rolling > 0 && this.grounded) {
      rig.showBody(false);
      rig.ball.transform.localEulerZ = (rig.ball.transform.localEulerZ - dt * 900) % 360;
      const sq = 1 + 0.06 * Math.sin(this.phase * 2);
      rig.ball.transform.localScale = new V3(1.0 * sq, 1.0 / sq, 1);
    } else if (this.boost > 0) {
      rig.showBody(true);
      const f = Math.sin(Time.time * 30) * 0.1;
      rig.pose(0.55, 0.45, 25 + f * 20, 25 - f * 20, 0.04 * Math.sin(Time.time * 4), 0);
    } else if (!this.grounded) {
      rig.showBody(true);
      const up = this.vy > 0;
      rig.pose(up ? 0.9 : 0.5, up ? 0.35 : 0.6, up ? 150 : 60, up ? 150 : 60, 0, 0);
    } else {
      rig.showBody(true);
      const s = Math.sin(this.phase), c = Math.cos(this.phase);
      const run = this.State === Phase.Playing || this.attract ? 1 : 0;
      rig.pose(Math.max(0, s) * run, Math.max(0, -s) * run, 8 + s * 32 * run, 8 - s * 32 * run, Math.abs(c) * 0.06 * run, s * 3 * run);
    }
    // jetpack flames
    for (let i = 0; i < 2; i++) {
      const f = rig.flames[i];
      f.enabled = this.boost > 0;
      if (!f.enabled) continue;
      const fl = 0.7 + 0.3 * Math.sin(Time.time * 40 + i * 2);
      f.transform.localPosition = new V3(i === 0 ? -0.14 : 0.14, 0.72 - fl * 0.25, 0);
      f.transform.localScale = new V3(0.42 * fl, 0.9 * fl, 1);
    }
    if (this.boost > 0 && this.State === Phase.Playing && Time.frameCount % 2 === 0) {
      this.P(this.px, this.py + 0.6, this.pz);
      this.fx.emit(new V2(this.sx + (Random01(Time.frameCount) - 0.5) * 0.3 * this.ss, this.sy), new V2(0, -3 * this.ss), new Color(1, 0.8, 0.5, 0.6), 0.5 * this.ss, 0.4, CasualArt.Soft, 0, 0, true, 2);
    }
    // shield bubble
    rig.shield.enabled = this.power[Power.Shield] > 0 && !this.crashed;
    if (rig.shield.enabled) {
      const pulse = 2.3 + 0.08 * Math.sin(Time.time * 5);
      rig.shield.transform.localScale = new V3(pulse, pulse, 1);
      const ending = this.power[Power.Shield] < 2 && Math.floor(Time.time * 8) % 2 === 0;
      rig.shield.color = Teal.withAlpha(ending ? 0.25 : 0.6);
    }
  }

  private DrawDrone(dt: number) {
    const want = this.chase > 0 || (this.crashed && this.crashKind === "caught") ? 1 : 0;
    this.droneVis = Mathf.moveTowards(this.droneVis, want, dt * 1.6);
    const on = this.droneVis > 0.01;
    this.drone.gameObject.setActive(on);
    if (!on) return;
    const t = Time.time;
    const side = this.lane === 2 ? -1 : 1;
    const tx = this.crashed ? this.px : this.px + side * 1.6;
    this.droneX += (tx - this.droneX) * (1 - Math.exp(-dt * 4));
    const ty = (this.crashed ? this.py + 2.6 : this.py + 2.9) + 0.18 * Math.sin(t * 3);
    this.droneY += (ty - this.droneY) * (1 - Math.exp(-dt * 5));
    // flies in from above-behind
    const yIn = this.droneY + (1 - this.droneVis) * 6;
    this.P(this.droneX, yIn, this.pz - 1.6 - (this.crashed ? -1.2 : 0));
    this.drone.transform.localPosition = new V3(this.sx, this.sy, 0);
    this.drone.transform.localScale = new V3(1.2 * this.ss, 1.2 * this.ss, 1);
    this.drone.transform.localEulerZ = Math.sin(t * 2.2) * 6;
    this.drone.sortingOrder = DashRushGame.order(CamBack - 1.6);
    for (let i = 0; i < 2; i++) {
      this.droneRotors[i].transform.localScale = new V3(0.55 * (0.4 + 0.6 * Math.abs(Math.sin(t * 50 + i))), 0.55, 1);
      this.droneRotors[i].sortingOrder = this.drone.sortingOrder + 0.001;
      const blink = Math.floor(t * 6) % 2 === i;
      this.droneLights[i].color = (i === 0 ? Pal.hex(0xff3b5c) : Pal.hex(0x3b8bff)).withAlpha(blink ? 0.95 : 0.12);
      this.droneLights[i].sortingOrder = this.drone.sortingOrder + 0.002;
    }
  }

  private DrawSpeedLines(dt: number) {
    const fast = this.State === Phase.Playing && !this.crashed ? Mathf.clamp01((this.speed - 19) / 9) + (this.boost > 0 ? 0.6 : 0) : 0;
    const W = this.ViewSize.x, Hh = this.ViewSize.y;
    const vx = 0, vy = this.horizon;
    for (let i = 0; i < this.speedLines.length; i++) {
      const l = this.speedLines[i];
      if (fast <= 0.01) { l.sr.enabled = false; l.r = 0; continue; }
      l.sr.enabled = true;
      if (l.r <= 0 || l.r > Math.max(W, Hh)) {
        l.a = Random01(i * 17 + Time.frameCount) * Math.PI * 2;
        l.r = Math.max(W, Hh) * (0.25 + Random01(i + Time.frameCount * 3) * 0.2);
        l.v = 20 + Random01(i * 5 + Time.frameCount) * 25;
      }
      l.r += l.v * dt * (0.6 + fast);
      const x = vx + Math.cos(l.a) * l.r, y = vy + Math.sin(l.a) * l.r * 0.8;
      l.sr.transform.localPosition = new V3(x, y, 0);
      l.sr.transform.localEulerZ = l.a * Mathf.Rad2Deg;
      l.sr.transform.localScale = new V3(2.4 + fast * 2, 1.4, 1);
      l.sr.color = Color.white.withAlpha(0.22 * fast * Mathf.clamp01(l.r / (W * 0.4) - 0.5));
    }
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    if (this.attract) return;
    this.scoreText.text = Fmt.n(Math.floor(this.score));
    this.distText.text = Fmt.n(Math.floor(this.runDist)) + " M";
    this.coinText.text = Fmt.n(this.coinsRun);
    this.multText.text = "x" + this.mult;
    this.multBadge.color = this.mult > 1 ? Color.white : new Color(1, 1, 1, 0.55);
    const timers = [this.power[0], this.power[1], this.boost, this.power[3]];
    const maxes = [this.powerMax[0], this.powerMax[1], this.boostMax, this.powerMax[3]];
    let row = 0;
    for (let i = 0; i < 4; i++) {
      const r = this.powerRows[i];
      const on = timers[i] > 0;
      r.node.setActive(on);
      if (!on) continue;
      r.node.anchoredPosition = new V2(70, -220 - row * 112);
      r.ring.fillAmount = timers[i] / Math.max(0.01, maxes[i]);
      row++;
    }
    this.chaseText.text = this.chase > 0 && !this.crashed ? "BEEP IS ON YOUR TAIL!" : "";
    this.chaseText.color = Pal.hex(0xff4d6a).withAlpha(0.6 + 0.4 * Math.abs(Math.sin(Time.time * 5)));
  }
}

// ------------------------------------------------------------------ helpers

/** Deterministic hash noise in [0, 1). */
function Random01(i: number) { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }

let noiseState = 1;
/** White noise for synthesized clips. */
function noise(_t: number) { noiseState = (noiseState * 1103515245 + 12345) & 0x7fffffff; return (noiseState / 0x7fffffff) * 2 - 1; }

