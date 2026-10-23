import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CanvasGroup, CasualFx, CasualLook, Color, Ease, Fmt, Fx, GameInfo,
  GameObject, howTo, Image, Keyboard, Mathf, Mouse, OnlineLink, OnlineRoom, Pal, Phase, Result, Sfx, Snd, SpriteRenderer, SysRandom,
  tableCodeFromUrl, TableLobby, TableOverlay, Text, TextAnchor, Time, TouchScheme, UI, UIKit, UINode, V2, V3,
} from "../../kit";
import { Block, blockC, CitySize, Half, laneOf, Mover, N, planCity, Road, roadC, SpatialHash, walkerPos } from "./City";
import {
  BlockType, blockSprite, clockIcon, coinSprite, crossingSprite, crownSprite, grassSprite, holeIcon, holeInterior, HoleArt,
  Kind, KindDef, Pic, rimSprite, roadSprite, SkinColors, SkinCosts, SkinNames,
} from "./HoleArt";

/**
 * HOLE HUNGRY: a "swallow the city" .io game. Steer a hole through a toy town; everything smaller than the hole
 * tips over the rim and falls in, which fills the growth meter and makes the hole bigger, so it can swallow bigger
 * things: people and cones first, then cars and trees, buses, houses and finally the skyscrapers. Six rival holes
 * roam the same city and can swallow smaller holes, the player included. After two minutes the biggest hole wins.
 * Modes: CLASSIC (respawn small with -50%), ELIMINATION (one life), CLEAR THE CITY (solo, % eaten), ONLINE (a private
 * table: two players on their own devices share one city with the rival holes; the bigger of the two wins).
 * Coins from each round buy rim skins.
 */

// ------------------------------------------------------------------ tuning

const RoundTime = 120;
const Radii = [0.55, 0.72, 0.95, 1.2, 1.5, 1.85, 2.25, 2.7, 3.2, 3.8, 4.5, 5.3, 6.2];
/** Cumulative points needed to reach level i + 1. */
const Need = [8, 22, 45, 80, 130, 200, 300, 440, 620, 860, 1180, 1600];
/** An object falls in when its size is below this fraction of the hole's diameter. */
const EatK = 0.92;
/** Blocking objects can overlap the hole up to this fraction of its radius ("sitting on the rim"). */
const BlockK = 0.55;
const BotCount = 6;
const MaxHalfExtent = 4.6;

const BotNames = [
  "Gobbler", "Munchy", "Vortex", "Sinkhole", "Nom Nom", "Pothole", "Crumbs", "Slurpy", "Abyss", "Doughnut",
  "Pit Stop", "Gulpy", "Chomper", "Void", "Burp", "Manhole",
];
const BotColors = [0xff4d6a, 0xffa020, 0x3fd06a, 0x2fc9ff, 0xa56bff, 0xff5ce1, 0xffe14a, 0x5a7bff].map((h) => Pal.hex(h));
const Gold = Pal.hex(0xffc93c), Ink = Pal.hex(0x14162a), Violet = Pal.hex(0x8a5cff);

enum Mode { Classic, Elimination, Solo, Online }
const ModeNames = ["CLASSIC", "ELIMINATION", "CLEAR THE CITY", "ONLINE"];

// ------------------------------------------------------------------ online (private tables)

/** Online: holes[0] is always me; the other human sits at FriendIdx (bots in between are the same on both devices). */
const FriendIdx = BotCount + 1;
/** Player colours: the table's host (player 1) and the guest (player 2), as in the other online games. */
const HostColor = Pal.hex(0x3a9cff), GuestColor = Pal.hex(0xff4fa0);
/** Online bot rims avoid the two player colours. */
const OnlineBotColors = [0xffa020, 0x3fd06a, 0xa56bff, 0xffe14a, 0xe8402a, 0x9aa4b8].map((h) => Pal.hex(h));
const OnlinePrize = 60;
/** Host → guest state rate, guest → host input rate, and how long either side waits before calling the friend lost. */
const StateEvery = 1 / 16, InputEvery = 1 / 25, SilentLost = 3;
/** Ring of timestamped samples per entity on the guest (interpolation buffer). */
const RingN = 8;
/** Hole wire index: the host's own numbering (0 = host, FriendIdx = guest); the guest swaps 0 and FriendIdx. */
const swapIdx = (i: number) => (i === 0 ? FriendIdx : i === FriendIdx ? 0 : i);
const netNow = () => performance.now() / 1000;
/** URL-safe base64 digits for packing 12-bit numbers (2 chars) and bit sets (6 bits per char). */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64i = new Int8Array(128).fill(0);
for (let i = 0; i < 64; i++) B64i[B64.charCodeAt(i)] = i;
const q12 = (v: number) => Mathf.clamp(Math.round((v + 64) * 32), 0, 4095);
const uq12 = (n: number) => n / 32 - 64;
const r2 = (v: number) => Math.round(v * 100);

interface OStart { seed: number }
/** Host → guest live state (~16 Hz). h: 7 numbers per hole in host order (x, y, R ×100, score, flags, spawns, holes
 * eaten); m: movers near the guest's view, 6 chars each (id+axis, x, y as 12-bit); e: objects swallowed recently as
 * [hole, id, id…] lists (repeated in the next states); v: hole events [seq, kind, a, b, c] (repeated ~1 s);
 * g: every object not standing, as a bit set (every 16th state and in snapshots); end: the buzzer went (final scores). */
interface OState { t: "s"; mt: number; n: number; tm: number; h: number[]; m: string; e: number[][]; v: number[][]; g?: string; end?: number }
/** Guest → host input (~25 Hz): its predicted hole position, the spawn it belongs to, and its camera view. */
interface OInput { t: "i"; mt: number; x: number; y: number; vx: number; vy: number; s: number; cx: number; cy: number; vw: number; vh: number }
interface OSnap { seed: number; over: boolean; s: OState }

enum St { Standing, Falling, Gone }

const levelFor = (score: number) => { let l = 0; while (l < Need.length && score >= Need[l]) l++; return l; };

/** 32 tints from white to near-black (falling objects darken as they sink). */
const Shade: Color[] = [];
for (let i = 0; i < 32; i++) { const v = 1 - (i / 31) * 0.88; Shade.push(new Color(v, v, v, 1)); }

class Obj {
  id = 0;
  def!: KindDef;
  sr!: SpriteRenderer;
  pic!: Pic;
  x = 0; y = 0; hw = 0; hh = 0;
  state = St.Standing;
  shown = false;
  /** Culling extents of the sprite relative to (x, y). */
  ex0 = 0; ex1 = 0; ey0 = 0; ey1 = 0;
  order = 0;
  // falling
  ft = 0; fdur = 0.4; fox = 0; foy = 0; spin = 0; hole: Hole | null = null;
  wobble = 0;
  // movers
  mover = Mover.None;
  a = 0; b = 0; c = 0; speed = 0;
  visX = 0; visY = 0;
  respawn = 0;
  bob = 0;
  // online guest: when it stopped standing locally, and the latest state that streamed it
  goneAt = 0; seenN = -1;
}

class Hole {
  idx = 0;
  name = "";
  color = Color.white;
  player = false;
  x = 0; y = 0; vx = 0; vy = 0; wantX = 0; wantY = 0;
  R = Radii[0];
  level = 0;
  score = 0;
  cityScore = 0;
  pulse = 0;
  alive = false;
  out = false;
  respawnT = 0;
  invuln = 0;
  dyingT = 0;
  eater: Hole | null = null;
  eatenBy = "";
  holesEaten = 0;
  outOrder = 0;
  // AI
  think = 0; tx = 0; ty = 0; stuck = 0; lastX = 0; lastY = 0; skill = 1; aggro = 0.5; wander = 0;
  // view
  root!: GameObject;
  inner!: SpriteRenderer;
  rim!: SpriteRenderer;
  crown!: SpriteRenderer;
  label!: Text;
  labelOn = false;
  /** The local player's rim uses the equipped skin (offline). */
  skinned = false;
  // online: the other human (host: driven by the guest's reports), spawn counter, guest-side interpolation ring
  friend = false;
  spawns = 0;
  rx = 0; ry = 0; rvx = 0; rvy = 0; rAt = -1;
  targetR = 0;
  st = new Float64Array(RingN); sx = new Float64Array(RingN); sy = new Float64Array(RingN); sn = 0;
}

export class HoleHungryGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject;
  private fx!: CasualFx;
  private defs: KindDef[] = [];
  private objs: Obj[] = [];
  private objCount = 0;
  private hash = new SpatialHash(1200);
  private falling = new Int32Array(1200);
  private fallingCount = 0;
  private holes: Hole[] = [];
  private player!: Hole;
  private rng = new SysRandom();
  private tmp = new Float64Array(2);

  private grassCover!: SpriteRenderer;
  private ground: { sr: SpriteRenderer; x: number; y: number; r: number; shown: boolean }[] = [];
  private blockSrs: SpriteRenderer[] = [];

  private mode = Mode.Classic;
  private timeLeft = RoundTime;
  private ending = 0;
  private finished = false;
  private zoom = 22;
  private camX = 0; private camY = 0;
  private totalValue = 1;
  private eatenValue = 0;
  private outCounter = 0;
  private revived = false;
  private fullRespawnUsed = false;
  private deathDelay = 0;
  private smallAccum = 0; private smallTimer = 0;
  private eatSfxCooldown = 0;
  private lastTick = 0;
  private boardTimer = 0;
  private miniTimer = 0;
  private coinsRun = 0;
  private roundSeed = 1;
  private mouseSteer = false; private lastMouseX = 0; private lastMouseY = 0;

  // HUD
  private timerText!: Text;
  private timerPill!: Image;
  private meterFill!: Image;
  private meterLabel!: Text;
  private boardRows: Text[] = [];
  private boardBg!: Image;
  private miniMap!: UINode;
  private miniDots: Image[] = [];
  private feed: { t: Text; age: number }[] = [];
  private respawnPanel!: UINode;
  private respawnTitle!: Text;
  private respawnCount!: Text;
  private respawnNote!: Text;
  private fullButton!: ArcadeButton;
  private finalPanel!: CanvasGroup;
  private finalRows: Text[] = [];
  private finalTitle!: Text;
  private soloText!: Text;
  private rankOrder: Hole[] = [];

  // title + shop
  private modeButton: ArcadeButton | null = null;
  private skinsButton: ArcadeButton | null = null;
  private skinPreview: Image | null = null;
  private shop!: CanvasGroup;
  private shopCoins!: Text;
  private shopCells: { button: ArcadeButton; price: Text; name: Text }[] = [];

  private eatClip!: AudioClip; private gulpClip!: AudioClip; private upClip!: AudioClip; private slurpClip!: AudioClip;

  // online (private tables)
  private lobby!: TableLobby; private overlay!: TableOverlay;
  private link: OnlineLink<OStart, number, OSnap> | null = null;
  private onlineGo = false; private autoJoined = false; private forfeit = false;
  private onlineSeed = 1;
  /** 0 = offline run, 1 = online host (runs the simulation), 2 = online guest (predicts itself, interpolates the rest). */
  private net = 0;
  /** Host: simulated seconds of this round (the clock in every state); guest: interpolation clock. */
  private simT = 0;
  private sendT = 0; private stateN = 0;
  private eatLog: number[][][] = []; private eatNow: number[] = [];
  private evLog: { n: number; v: number[] }[] = []; private evSeq = 0;
  /** Host: the guest's last input (view rectangle for the mover stream) and when it came. */
  private fin: OInput | null = null; private lastInputAt = 0;
  // guest
  private lastN = -1; private lastEv = 0; private lastStateAt = 0; private clockOff = 0; private clockInit = false; private jitter = 0.02;
  private moverT = new Float64Array(0); private moverX = new Float64Array(0); private moverY = new Float64Array(0); private moverN = new Uint8Array(0);

  // ------------------------------------------------------------------ describe

  protected Describe() {
    const d = HoleArt.Defs;
    return new GameInfo({
      HomeBesidePause: true,
      Id: "holehungry",
      Title: "HOLE HUNGRY",
      Tagline: "SWALLOW THE CITY. BE THE BIGGEST HOLE.",
      PlayLabel: "PLAY",
      Accent: Violet,
      Accent2: Gold,
      BgTop: Pal.hex(0x6aa9e8),
      BgBottom: Pal.hex(0x2c3e6a),
      ShortSide: 22,
      Touch: TouchScheme.Stick,
      Music: { bpm: 124, rootHz: 110, degrees: [0, 4, 5, 3], seed: 91, energy: 0.65, major: true },
      Reminders: [
        "The city is still standing|Come back and swallow it whole.",
        "Six hungry holes are roaming|Can you be the biggest?",
        "New skins are waiting|Spend your coins on a shiny new rim.",
      ],
      HowTo: [
        howTo(holeIcon(0), Color.white, "DRAG anywhere to steer your hole (or move the mouse / use WASD)."),
        howTo(d[Kind.Person].pics[0].sprite, Color.white, "Anything SMALLER than your hole falls in: people, cones, cars, trees..."),
        howTo(d[Kind.House].pics[0].sprite, Color.white, "Bigger things block you. Swallow stuff to fill the meter and GROW."),
        howTo(holeIcon(8), Color.white, "Bigger holes can swallow YOU! Swallow smaller holes for a big bonus."),
        howTo(crownSprite(), Color.white, "After 2 minutes the BIGGEST hole wins. Your rank earns stars and coins."),
        howTo(coinSprite(), Color.white, "Spend coins on new rim SKINS. Try ELIMINATION and CLEAR THE CITY modes!"),
      ],
      Tips: [
        "Start small: people, cones and hydrants are the perfect first snack.",
        "Parking lots are full of cars. Visit one as soon as you can swallow cars!",
        "Stay away from holes bigger than you, and chase the smaller ones.",
        "Downtown towers are worth a fortune once you're big enough.",
        "Keep moving: the other holes are eating the city too!",
      ],
    });
  }

  protected get ShortSide() { return this.zoom; }
  protected get AimOrigin() { return this.player && this.player.alive ? new V2(this.player.x, this.player.y) : new V2(this.camX, this.camY); }

  private get Coins() { return this.Data.get("coins"); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }
  private get Skin() { return Mathf.clamp(this.Data.get("skin"), 0, SkinNames.length - 1); }
  private Owns(i: number) { return i === 0 || (this.Data.get("owned", 1) & (1 << i)) !== 0; }

  protected BestLine() {
    const best = this.Data.get("best");
    return best > 0 ? `BEST ${Fmt.n(best)} PTS   ·   ${this.Data.get("wins")} WINS` : "SWALLOW EVERYTHING. GROW HUGE!";
  }

  protected StatsLine() {
    return `${Fmt.n(this.Coins)} COINS   ·   ${Fmt.n(this.Data.get("swallowed"))} THINGS SWALLOWED`;
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    CasualLook.calm(this, 1.35, 0.16);
    this.defs = HoleArt.Defs;
    this.world = new GameObject("HoleWorld", this.gameObject);
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__hh = { game: this };
    this.mode = Mathf.clamp(this.Data.get("mode"), 0, 3) as Mode;

    // ground: grass outside, asphalt under the city, roads, crossings and blocks
    this.grassCover = Art.spr(this.world, "Grass", grassSprite(), Color.white, 1, -990, Art.Flat);
    const addGround = (sr: SpriteRenderer, x: number, y: number, r: number) => {
      sr.transform.localPosition = new V3(x, y, 0);
      sr.gameObject.setActive(false);
      this.ground.push({ sr, x, y, r, shown: false });
    };
    for (let k = 0; k <= N; k++)
      for (let j = 0; j < N; j++) {
        addGround(Art.spr(this.world, "RoadH", roadSprite(Block, Road), Color.white, 1, -970, Art.Flat), blockC(j), roadC(k), Block * 0.72);
        const v = Art.spr(this.world, "RoadV", roadSprite(Block, Road), Color.white, 1, -970, Art.Flat);
        v.transform.localEulerZ = 90;
        addGround(v, roadC(k), blockC(j), Block * 0.72);
      }
    for (let k = 0; k <= N; k++)
      for (let j = 0; j <= N; j++) addGround(Art.spr(this.world, "Cross", crossingSprite(Road), Color.white, 1, -970, Art.Flat), roadC(j), roadC(k), Road);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const sr = Art.spr(this.world, "Block", blockSprite(BlockType.Park, Block), Color.white, 1, -960, Art.Flat);
        addGround(sr, blockC(i), blockC(j), Block * 0.72);
        this.blockSrs.push(sr);
      }
    // pre-bake every block look so switching cities is instant
    for (let t = 0; t <= BlockType.Parking; t++) blockSprite(t, Block);

    this.fx = CasualFx.create(this.world, 1500, 320);

    // holes
    for (let i = 0; i <= FriendIdx; i++) this.holes.push(this.NewHole(i));
    this.player = this.holes[0];
    this.player.player = true;

    // sounds
    this.eatClip = Sfx.make("hh-eat", 0.09, (t) => Sfx.sinP(Sfx.glide(t, 520, 980, 0.08)) * Sfx.env(t, 0.002, 0.07) * 0.22);
    const noise = new SysRandom(5);
    this.gulpClip = Sfx.make("hh-gulp", 0.32, (t) =>
      (Sfx.sinP(Sfx.glide(t, 320, 70, 0.3)) * 0.6 + (noise.nextDouble() * 2 - 1) * 0.12 * Sfx.env(t, 0.001, 0.05)) * Sfx.env(t, 0.004, 0.25) * 0.45);
    this.upClip = Sfx.make("hh-up", 0.5, (t) => {
      const step = Math.min(3, Math.floor(t / 0.09)), f = [523, 659, 784, 1047][step];
      return (Sfx.sinP(f * t) * 0.5 + Sfx.triP(f * 2 * t) * 0.15) * Sfx.env(t - step * 0.09, 0.004, 0.16) * 0.32;
    });
    this.slurpClip = Sfx.make("hh-slurp", 0.7, (t) => (Sfx.sawP(Sfx.glide(t, 700, 60, 0.65)) * 0.25 + Sfx.sinP(Sfx.glide(t, 300, 40, 0.65)) * 0.45) * Sfx.env(t, 0.01, 0.6) * 0.4);

    this.BuildHud();
    this.BuildTitleExtras();
    this.BuildShop();
    this.BuildOnline();
    this.NewCity(false);
  }

  private NewHole(i: number) {
    const h = new Hole();
    h.idx = i;
    h.root = new GameObject("Hole" + i, this.world);
    h.inner = Art.spr(h.root, "Inner", holeInterior(), Color.white, 1, -420 + i * 0.1, Art.Flat);
    h.rim = Art.spr(h.root, "Rim", rimSprite(-1), Color.white, 1, -380 + i * 0.1, Art.Flat);
    h.crown = Art.spr(h.root, "Crown", crownSprite(), Color.white, 1, 3010, Art.Flat);
    h.crown.gameObject.setActive(false);
    // name tags are HUD labels that follow the hole (world-space text would re-render its canvas every frame)
    h.label = UIKit.at(UIKit.label(this.UI.Hud, "", 30, Color.white), UIKit.Center, V2.zero, new V2(360, 44));
    UIKit.glow(h.label, Ink.withAlpha(0.85), 3);
    h.label.gameObject.setActive(false);
    h.root.setActive(false);
    return h;
  }

  // ------------------------------------------------------------------ HUD

  private BuildHud() {
    const hud = this.UI.Hud;
    const C = UIKit.Center;
    this.timerPill = UIKit.img(hud, "TimerPill", Art.UiRound, new Color(0.06, 0.06, 0.16, 0.55));
    this.timerPill.rectTransform.place(new V2(0.5, 1), new V2(0, -66), new V2(230, 86));
    UIKit.img(this.timerPill.rectTransform, "Clock", clockIcon(), Color.white).rectTransform.place(new V2(0, 0.5), new V2(44, 0), new V2(44, 44));
    this.timerText = UIKit.at(UIKit.label(this.timerPill.rectTransform, "2:00", 52, Color.white), C, new V2(22, 0), new V2(160, 80));

    const [meter, fill] = UIKit.meter(hud, new V2(0.5, 1), new V2(0, -140), new V2(430, 40), Gold);
    this.meterFill = fill;
    UIKit.img(meter, "Edge", Art.UiOutline, new Color(1, 1, 1, 0.55)).rectTransform.stretch();
    this.meterLabel = UIKit.at(UIKit.label(meter, "SIZE 1", 26, Color.white), C, V2.zero, new V2(430, 40));
    UIKit.glow(this.meterLabel, Ink, 2);
    this.soloText = UIKit.at(UIKit.label(hud, "", 30, Color.white), new V2(0.5, 1), new V2(0, -188), new V2(500, 40));
    UIKit.glow(this.soloText, Ink, 3);

    // leaderboard (under the pause button)
    this.boardBg = UIKit.img(hud, "Board", Art.UiRound, new Color(0.06, 0.06, 0.16, 0.5));
    this.boardBg.rectTransform.place(new V2(1, 1), new V2(-168, -300), new V2(300, 7 * 34 + 24));
    for (let i = 0; i <= FriendIdx; i++) {
      const t = UIKit.at(UIKit.label(this.boardBg.rectTransform, "", 24, Color.white, TextAnchor.MiddleLeft), new V2(0.5, 1), new V2(4, -28 - i * 34), new V2(270, 32));
      UIKit.glow(t, Ink.withAlpha(0.7), 2);
      this.boardRows.push(t);
    }

    // minimap
    this.miniMap = UIKit.img(hud, "MiniMap", Art.UiRound, new Color(0.06, 0.06, 0.16, 0.5)).rectTransform;
    this.miniMap.place(new V2(0, 1), new V2(108, -108), new V2(176, 176));
    const inner = UIKit.img(this.miniMap, "City", Art.UiRound, new Color(0.45, 0.5, 0.58, 0.55)).rectTransform;
    inner.stretch(12);
    for (let i = 0; i <= FriendIdx; i++) {
      const d = UIKit.img(this.miniMap, "Dot", Art.UiCircle, Color.white);
      d.rectTransform.place(C, V2.zero, new V2(12, 12));
      this.miniDots.push(d);
    }

    // kill feed
    for (let i = 0; i < 3; i++) {
      const t = UIKit.at(UIKit.label(hud, "", 24, Color.white, TextAnchor.MiddleLeft), new V2(0, 1), new V2(200, -224 - i * 32), new V2(380, 30));
      UIKit.glow(t, Ink, 2);
      this.feed.push({ t, age: 99 });
    }

    // respawn panel
    this.respawnPanel = UIKit.node("Respawn", hud).place(C, new V2(0, -40), new V2(680, 380));
    UIKit.img(this.respawnPanel, "Bg", Art.UiRound, new Color(0.06, 0.05, 0.16, 0.86)).rectTransform.stretch();
    UIKit.img(this.respawnPanel, "Edge", Art.UiOutline, Pal.Danger.withAlpha(0.7)).rectTransform.stretch();
    this.respawnTitle = UIKit.at(UIKit.label(this.respawnPanel, "", 44, Pal.Danger), C, new V2(0, 130), new V2(640, 60));
    this.respawnCount = UIKit.at(UIKit.label(this.respawnPanel, "", 34, Color.white), C, new V2(0, 66), new V2(640, 50));
    this.respawnNote = UIKit.at(UIKit.label(this.respawnPanel, "", 26, Pal.TextDim), C, new V2(0, 22), new V2(640, 40));
    this.fullButton = UIKit.buttonAt(this.respawnPanel, "RESPAWN AT FULL SIZE (AD)", C, new V2(0, -95), new V2(560, 110), true, () => this.TakeFullRespawn(), 32);
    this.fullButton.setAccent(Pal.Warn);
    this.respawnPanel.setActive(false);

    // final standings (shown for a moment when the clock runs out)
    const fp = UIKit.node("Final", hud).place(C, new V2(0, 10), new V2(640, 560));
    this.finalPanel = new CanvasGroup(fp);
    this.finalPanel.alpha = 0;
    this.finalPanel.blocksRaycasts = false;
    UIKit.img(fp, "Bg", Art.UiRound, new Color(0.06, 0.05, 0.16, 0.88)).rectTransform.stretch();
    UIKit.img(fp, "Edge", Art.UiOutline, Gold.withAlpha(0.7)).rectTransform.stretch();
    this.finalTitle = UIKit.at(UIKit.label(fp, "TIME'S UP!", 52, Gold), C, new V2(0, 225), new V2(600, 70));
    for (let i = 0; i <= FriendIdx; i++) {
      const t = UIKit.at(UIKit.label(fp, "", 34, Color.white, TextAnchor.MiddleLeft), C, new V2(10, 150 - i * 58), new V2(520, 52));
      UIKit.glow(t, Ink, 2);
      this.finalRows.push(t);
    }
    fp.setActive(false);
  }

  private BuildTitleExtras() {
    if (!this.UI.TitleExtra) return;
    CasualLook.titleCard(this.UI, new Color(0.07, 0.06, 0.2, 0.72));
    const ex = this.UI.TitleExtra, C = UIKit.Center;
    this.modeButton = UIKit.buttonAt(ex, "MODE", C, new V2(-310, 0), new V2(330, 100), false, () => this.CycleMode(), 28);
    this.modeButton.setAccent(Pal.Cyan);
    this.skinsButton = UIKit.buttonAt(ex, "SKINS", C, new V2(310, 0), new V2(330, 100), false, () => this.OpenShop(), 28);
    this.skinsButton.setAccent(Gold);
    this.skinPreview = UIKit.img(ex, "Skin", holeIcon(this.Skin), Color.white);
    this.skinPreview.rectTransform.place(C, new V2(0, 0), new V2(120, 120));
    this.RefreshTitleExtras();
  }

  private RefreshTitleExtras() {
    if (this.modeButton?.label) this.modeButton.label.text = "MODE: " + ModeNames[this.mode];
    this.modeButton?.setAccent(this.mode === Mode.Online ? GuestColor : Pal.Cyan);
    if (this.skinsButton?.label) this.skinsButton.label.text = "SKINS · " + Fmt.n(this.Coins) + " ◉";
    if (this.skinPreview) this.skinPreview.sprite = holeIcon(this.Skin);
  }

  private CycleMode() {
    this.mode = ((this.mode + 1) % 4) as Mode;
    this.Data.set("mode", this.mode);
    this.RefreshTitleExtras();
    this.UI.Toast(this.mode === Mode.Classic ? "CLASSIC: 2 minutes, 7 holes. Get swallowed and you come back at half size."
      : this.mode === Mode.Elimination ? "ELIMINATION: one life! Be the last hole standing, or the biggest when time runs out."
        : this.mode === Mode.Solo ? "CLEAR THE CITY: just you. Swallow as much of the city as you can in 2 minutes."
          : `ONLINE: play a friend on their own phone in the same city. The bigger hole after 2 minutes wins ${OnlinePrize} coins!`, 3.5);
  }

  // ------------------------------------------------------------------ skin shop

  private BuildShop() {
    const root = UI.root!;
    this.shop = UIKit.layer("HoleSkins", root);
    UIKit.dim(this.shop.node, 0.78);
    const card = UIKit.card(this.shop.node, new V2(980, 1020), Gold);
    const C = UIKit.Center;
    UIKit.at(UIKit.label(card, "HOLE SKINS", 54, Color.white), C, new V2(0, 445), new V2(800, 70));
    this.shopCoins = UIKit.at(UIKit.label(card, "", 34, Gold), C, new V2(0, 385), new V2(800, 50));
    for (let i = 0; i < SkinNames.length; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      const pos = new V2((col - 1.5) * 232, 250 - row * 250);
      const idx = i;
      const b = UIKit.buttonAt(card, "", C, pos, new V2(216, 246), false, () => this.PickSkin(idx));
      b.setAccent(SkinColors[i]);
      UIKit.img(b.node, "Hole", holeIcon(i), Color.white).rectTransform.place(C, new V2(0, 38), new V2(136, 136));
      const name = UIKit.at(UIKit.label(b.node, SkinNames[i], 24, Color.white), C, new V2(0, -55), new V2(210, 30));
      const price = UIKit.at(UIKit.label(b.node, "", 26, Gold), C, new V2(0, -92), new V2(210, 34));
      this.shopCells.push({ button: b, price, name });
    }
    UIKit.buttonAt(card, "CLOSE", C, new V2(0, -440), new V2(320, 96), true, () => this.CloseShop(), 40).setAccent(Gold);
  }

  private OpenShop() {
    this.RefreshShop();
    this.shop.node.setActive(true);
    this.shop.node.setAsLastSibling();
    this.shop.alpha = 1;
    this.shop.blocksRaycasts = true;
    this.shop.interactable = true;
  }

  private CloseShop() {
    this.shop.alpha = 0;
    this.shop.blocksRaycasts = false;
    this.shop.interactable = false;
    this.shop.node.setActive(false);
    this.RefreshTitleExtras();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private get ShopOpen() { return this.shop.node.activeSelf; }

  private RefreshShop() {
    this.shopCoins.text = `◉ ${Fmt.n(this.Coins)} COINS`;
    for (let i = 0; i < this.shopCells.length; i++) {
      const c = this.shopCells[i];
      const owned = this.Owns(i), equipped = this.Skin === i;
      c.price.text = equipped ? "EQUIPPED" : owned ? "OWNED" : "◉ " + Fmt.n(SkinCosts[i]);
      c.price.color = equipped ? Pal.Good : owned ? Color.white : this.Coins >= SkinCosts[i] ? Gold : new Color(1, 0.6, 0.6, 1);
      c.button.setAccent(equipped ? Pal.Good : SkinColors[i]);
    }
  }

  private PickSkin(i: number) {
    if (!this.Owns(i)) {
      if (this.Coins < SkinCosts[i]) {
        Sfx.play(Snd.Deny, 0.6);
        this.UI.Toast(`Need ${Fmt.n(SkinCosts[i] - this.Coins)} more coins. Win rounds to earn them!`, 2.5);
        return;
      }
      this.Coins -= SkinCosts[i];
      this.Data.set("owned", this.Data.get("owned", 1) | (1 << i) | 1);
      Sfx.play(Snd.PowerUp, 0.8);
      Fx.haptic(true);
    } else Sfx.play(Snd.Confirm, 0.6);
    this.Data.set("skin", i);
    this.RefreshShop();
  }

  // ------------------------------------------------------------------ city

  /** Builds a fresh city (and resets every hole) for a round or for the title screen. */
  private NewCity(forRound: boolean, seed?: number) {
    this.roundSeed = seed ?? (forRound ? 1 + this.rng.next(1_000_000) : 4242 + this.rng.next(7));
    const plan = planCity(this.defs, this.roundSeed);
    // online: both devices build the same city from the host's seed (speeds too, so the host's traffic matches)
    const rng = seed !== undefined ? new SysRandom(seed + 17) : this.rng;
    for (let i = 0; i < plan.blocks.length; i++) this.blockSrs[i].sprite = blockSprite(plan.blocks[i], Block);
    this.hash.ensure(plan.items.length + 8);
    if (this.falling.length < plan.items.length) this.falling = new Int32Array(plan.items.length + 64);
    this.hash.clear();
    this.fallingCount = 0;
    this.totalValue = 0;
    this.eatenValue = 0;
    let n = 0;
    for (const p of plan.items) {
      let o = this.objs[n];
      if (!o) {
        o = new Obj();
        o.id = n;
        o.sr = Art.spr(this.world, "Obj", this.defs[0].pics[0].sprite, Color.white, 1, 0, Art.Flat);
        this.objs.push(o);
      }
      const d = this.defs[p.kind];
      o.def = d;
      o.pic = p.vertical && d.picsV.length ? d.picsV[p.variant % d.picsV.length] : d.pics[p.variant % d.pics.length];
      o.hw = p.vertical ? d.hh : d.hw;
      o.hh = p.vertical ? d.hw : d.hh;
      o.x = p.x; o.y = p.y;
      o.mover = p.mover; o.a = p.a; o.b = p.b; o.c = p.c;
      o.speed = p.mover === Mover.Walker ? 0.7 + rng.nextDouble() * 0.6 : p.kind === Kind.Bus ? 2.6 : 3.1 + rng.nextDouble() * 0.8;
      o.visX = o.visY = 0;
      o.bob = rng.nextDouble() * 6;
      o.goneAt = 0; o.seenN = -1;
      o.wobble = 0;
      o.respawn = 0;
      if (o.mover === Mover.Walker) { walkerPos(o.a, o.b, this.tmp); o.x = this.tmp[0]; o.y = this.tmp[1]; }
      this.PrepareSprite(o);
      o.state = St.Standing;
      o.shown = false;
      o.sr.gameObject.setActive(false);
      this.hash.insert(n, o.x, o.y);
      this.totalValue += d.value;
      n++;
    }
    for (let i = n; i < this.objCount; i++) { this.objs[i].state = St.Gone; this.objs[i].sr.gameObject.setActive(false); }
    this.objCount = n;
    if (this.moverN.length < n) {
      this.moverT = new Float64Array(n * RingN); this.moverX = new Float64Array(n * RingN); this.moverY = new Float64Array(n * RingN);
      this.moverN = new Uint8Array(n);
    }
    this.moverN.fill(0);
    this.fx.clear();
  }

  private PrepareSprite(o: Obj) {
    const s = o.pic.sprite, w = s.width / s.ppu, h = s.height / s.ppu;
    o.sr.sprite = s;
    o.sr.color = Color.white;
    o.ex0 = o.pic.ox - w / 2; o.ex1 = o.pic.ox + w / 2;
    o.ey0 = o.pic.oy - h / 2; o.ey1 = o.pic.oy + h / 2;
    o.sr.transform.localScale = V3.one;
    o.sr.transform.localEulerZ = 0;
    this.PlaceObj(o);
  }

  private PlaceObj(o: Obj) {
    const x = o.x + o.visX, y = o.y + o.visY;
    o.sr.transform.localPosition = new V3(x + o.pic.ox, y + o.pic.oy, 0);
    const order = Math.round((500 - y * 3.5) * 4) / 4;
    if (order !== o.order || o.sr.sortingOrder !== order) { o.order = order; o.sr.sortingOrder = order; }
  }

  // ------------------------------------------------------------------ holes

  private SpawnHole(h: Hole, score: number, x: number, y: number) {
    h.alive = true;
    h.out = false;
    h.dyingT = 0;
    h.eater = null;
    h.score = score;
    h.level = levelFor(score);
    h.R = Radii[h.level];
    h.x = x; h.y = y; h.vx = h.vy = 0; h.wantX = h.wantY = 0;
    h.pulse = 0.6;
    h.invuln = 2.5;
    h.think = 0;
    h.tx = x; h.ty = y;
    h.lastX = x; h.lastY = y; h.stuck = 0;
    h.spawns++;
    h.sn = 0;
    h.targetR = h.R;
    h.root.setActive(true);
    const online = this.mode === Mode.Online;
    h.skinned = h.player && !online;
    h.rim.sprite = h.skinned ? rimSprite(this.Skin) : rimSprite(-1);
    h.rim.color = h.skinned ? Color.white : h.color;
    h.label.text = h.player ? "YOU" : h.name;
    h.label.color = online && (h.player || h.friend) ? Color.lerp(h.color, Color.white, 0.25) : h.player ? Gold : Color.lerp(h.color, Color.white, 0.55);
    this.PresentHole(h);
  }

  private SafePoint(minR: number) {
    let bx = 0, by = 0, best = -1;
    for (let t = 0; t < 24; t++) {
      // prefer roads: snap one coordinate to a road line
      const u = -Half + 5 + this.rng.nextDouble() * (CitySize - 10), k = this.rng.next(N + 1);
      const x = t % 2 === 0 ? u : roadC(k), y = t % 2 === 0 ? roadC(k) : u;
      let d = 1e9;
      for (const h of this.holes) {
        if (!h.alive) continue;
        const dd = Math.hypot(h.x - x, h.y - y) - h.R * (h.R > minR ? 3 : 1);
        if (dd < d) d = dd;
      }
      if (d > best) { best = d; bx = x; by = y; }
      if (d > 22) break;
    }
    return [bx, by];
  }

  private SetupHoles(forRound: boolean) {
    const online = forRound && this.net > 0;
    // online: names, colours and starting spots come from the host's seed, so both devices agree
    const rng = online ? new SysRandom(this.roundSeed ^ 0x2f6b) : this.rng;
    const names = BotNames.slice();
    for (let i = names.length - 1; i > 0; i--) { const j = rng.next(i + 1); [names[i], names[j]] = [names[j], names[i]]; }
    const cols = (online ? OnlineBotColors : BotColors).slice();
    for (let i = cols.length - 1; i > 0; i--) { const j = rng.next(i + 1); [cols[i], cols[j]] = [cols[j], cols[i]]; }
    for (const h of this.holes) {
      h.alive = false; h.out = false; h.root.setActive(false); h.holesEaten = 0; h.cityScore = 0; h.outOrder = 0; h.respawnT = 0;
      h.spawns = 0; h.dyingT = 0; h.sn = 0; h.rAt = -1; h.label.gameObject.setActive(false); h.labelOn = false;
    }
    const friend = this.holes[FriendIdx];
    friend.friend = online;
    friend.out = !online;
    const bots = forRound && this.mode === Mode.Solo ? 0 : BotCount;
    if (forRound) {
      this.player.name = "YOU";
      this.player.color = online ? (this.net === 1 ? HostColor : GuestColor) : SkinColors[this.Skin];
      // start at the edge of the central plaza, where there's a crowd to snack on (online: the guest starts across it)
      this.SpawnHole(this.player, 0, blockC(2), blockC(2) + (this.net === 2 ? 6.3 : -6.3));
      this.player.invuln = 3;
    }
    if (online) {
      friend.name = "FRIEND";
      friend.color = this.net === 1 ? GuestColor : HostColor;
      friend.skill = 1; friend.aggro = 0;
      this.SpawnHole(friend, 0, blockC(2), blockC(2) + (this.net === 2 ? -6.3 : 6.3));
      friend.invuln = 3;
    }
    for (let i = 1; i <= BotCount; i++) {
      const h = this.holes[i];
      h.name = names[i - 1];
      h.color = cols[(i - 1) % cols.length];
      h.skill = 0.65 + rng.nextDouble() * 0.35;
      h.aggro = rng.nextDouble();
      if (i > bots) { h.out = true; continue; }
      const a = (i / bots) * Math.PI * 2 + rng.nextDouble() * 0.5, r = 24 + rng.nextDouble() * 22;
      const x = Mathf.clamp(Math.cos(a) * r, -Half + 4, Half - 4), y = Mathf.clamp(Math.sin(a) * r, -Half + 4, Half - 4);
      this.SpawnHole(h, forRound ? 0 : Need[Math.min(3, rng.next(4))], x, y);
    }
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.LeaveTable();
    this.net = 0;
    this.finished = false;
    this.ending = 0;
    this.respawnPanel.setActive(false);
    this.finalPanel.node.setActive(false);
    this.NewCity(false);
    this.SetupHoles(false);
    this.zoom = 30;
    const lead = this.holes[1];
    this.camX = lead.x; this.camY = lead.y;
    this.RefreshTitleExtras();
    // an invite link (?table=12345) opens the join panel and joins straight away
    const code = tableCodeFromUrl();
    if (code && !this.autoJoined) {
      this.autoJoined = true;
      this.mode = Mode.Online;
      this.Data.set("mode", Mode.Online);
      this.RefreshTitleExtras();
      this.lobby.open("join", code);
    }
  }

  protected BeginRun() {
    if (this.ShopOpen) this.CloseShop();
    const online = this.mode === Mode.Online;
    this.net = !online ? 0 : !this.link || this.link.isHost ? 1 : 2;
    this.NewCity(true, online ? this.onlineSeed : undefined);
    this.SetupHoles(true);
    this.ResetNet();
    this.timeLeft = RoundTime;
    this.ending = 0;
    this.finished = false;
    this.revived = false;
    this.fullRespawnUsed = false;
    this.deathDelay = 0;
    this.outCounter = 0;
    this.smallAccum = 0;
    this.coinsRun = 0;
    this.lastTick = 99;
    this.camX = this.player.x; this.camY = this.player.y;
    this.zoom = this.ZoomFor(this.player.R);
    this.mouseSteer = false; this.lastMouseX = Mouse.position.x; this.lastMouseY = Mouse.position.y;
    this.respawnPanel.setActive(false);
    this.finalPanel.node.setActive(false);
    this.finalPanel.alpha = 0;
    for (const f of this.feed) { f.age = 99; f.t.text = ""; }
    this.boardBg.gameObject.setActive(this.mode !== Mode.Solo);
    const rows = online ? FriendIdx + 1 : BotCount + 1;
    this.boardBg.rectTransform.place(new V2(1, 1), new V2(-168, -300 - (rows - 7) * 17), new V2(300, rows * 34 + 24));
    this.overlay.showBar(online);
    this.boardTimer = this.miniTimer = 0;
    this.UI.Announce(this.mode === Mode.Solo ? "CLEAR THE CITY!" : this.mode === Mode.Elimination ? "ONE LIFE. GO!" : "GET HUNGRY!", Violet, 1.4);
    if (online) this.UI.Toast("You and your FRIEND share this city. The bigger hole when the clock runs out wins!", 4);
    else if (this.Data.get("games") === 0) this.UI.Toast("Drag anywhere to steer. Swallow things smaller than your hole to grow!", 5);
    this.Data.add("games", 1);
    Sfx.setIntensity(0.45);
    this.UpdateHud(true);
  }

  protected OnPauseChanged(paused: boolean) {
    if (paused) this.respawnPanel.setActive(false);
    if (this.net > 0) this.overlay.showBar(!paused && !!this.link);
  }

  /** Online: the round keeps running for both players while one of them looks at the pause menu. */
  update() {
    super.update();
    if (this.State === Phase.Paused && this.net > 0) this.TickOnline(Math.min(0.1, Time.unscaledDeltaTime), true);
  }

  /** A page that is hidden can't run the shared round: online, losing focus doesn't pause (the friend keeps playing). */
  onFocusLost() { if (this.net === 0) super.onFocusLost(); }

  private ZoomFor(R: number) { return 8 + R * 6.4; }

  /** CLASSIC and ONLINE: swallowed holes come back at half size. */
  private get Respawns() { return this.mode === Mode.Classic || this.mode === Mode.Online; }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.lobby.tick(Time.unscaledDeltaTime);
    this.overlay.tick();
    if (this.State === Phase.Over) { this.Present(dt); return; }
    if (this.ShopOpen && Keyboard.escape.wasPressedThisFrame) this.CloseShop();
    this.Simulate(dt, false);
    // camera drifts after the biggest bot
    let lead: Hole | null = null;
    for (const h of this.holes) if (h.alive && !h.player && (!lead || h.score > lead.score)) lead = h;
    if (lead) {
      const k = 1 - Math.exp(-dt * 1.5);
      this.camX += (lead.x - this.camX) * k; this.camY += (lead.y - this.camY) * k;
    }
    this.zoom = Mathf.lerp(this.zoom, 26, dt);
    this.Present(dt);
  }

  protected TickRun(dt: number) {
    if (this.net > 0) { this.TickOnline(dt, false); return; }
    if (AdService.isShowing) return; // the city freezes while a rewarded ad plays
    const p = this.player;
    if (this.ending > 0) {
      this.ending -= dt;
      this.AnimateFalling(dt);
      this.Present(dt);
      if (this.ending <= 0 && !this.finished) this.EndRound();
      return;
    }
    this.timeLeft -= dt;
    this.SteerPlayer();
    this.Simulate(dt, true);
    // player death / respawn
    if (!p.alive && !p.out && p.dyingT <= 0) this.TickRespawn(dt);
    if (this.deathDelay > 0) {
      this.deathDelay -= dt;
      if (this.deathDelay <= 0 && !this.finished) { this.EndRound(); return; }
    }
    // camera
    const k = 1 - Math.exp(-dt * 6);
    const fx = p.alive ? p.x : this.camX, fy = p.alive ? p.y : this.camY;
    this.camX += (fx - this.camX) * k; this.camY += (fy - this.camY) * k;
    this.zoom = Mathf.lerp(this.zoom, this.ZoomFor(p.alive ? p.R : Math.max(p.R, 1.5)), dt * 1.6);
    this.Present(dt);
    this.UpdateHud(false);
    // countdown
    const sec = Math.ceil(this.timeLeft);
    if (sec <= 10 && sec !== this.lastTick && sec > 0) { this.lastTick = sec; Sfx.play(Snd.Tick, 0.7, 1 + (10 - sec) * 0.04); }
    let othersLeft = 0;
    for (const h of this.holes) if (!h.player && !h.out) othersLeft++;
    if (this.timeLeft <= 0 || (this.mode === Mode.Elimination && othersLeft === 0 && p.alive) || (this.mode === Mode.Solo && this.eatenValue >= this.totalValue * 0.999)) this.StartEnding();
  }

  private SteerPlayer() {
    // desktop: the hole follows the mouse pointer once it moves (the kit only flags Mouse.present after a click)
    const mp = Mouse.position;
    if (Math.abs(mp.x - this.lastMouseX) + Math.abs(mp.y - this.lastMouseY) > 2) { this.mouseSteer = true; this.lastMouseX = mp.x; this.lastMouseY = mp.y; }
    if (this.Controls.move.sqrMagnitude > 0.0025) this.mouseSteer = false;
    const h = this.player;
    h.wantX = h.wantY = 0;
    if (!h.alive) return;
    const m = this.Controls.move;
    const mag = m.magnitude;
    if (mag > 0.05) {
      const k = Mathf.clamp01(0.3 + mag * 0.9) / mag;
      h.wantX = m.x * k; h.wantY = m.y * k;
    } else if (this.mouseSteer && !this.Controls.usingTouch) {
      const w = this.ScreenToWorld(Mouse.position);
      const dx = w.x - h.x, dy = w.y - h.y, d = Math.hypot(dx, dy);
      if (d > 0.01) {
        const k = Mathf.clamp01((d - h.R * 0.2) / (h.R * 1.4 + 1.6)) / d;
        h.wantX = dx * k; h.wantY = dy * k;
      }
    }
  }

  private Simulate(dt: number, real: boolean) {
    this.eatSfxCooldown -= dt;
    this.MoveTraffic(dt);
    for (const h of this.holes) {
      if (!h.alive) {
        if (h.dyingT > 0) this.AnimateDying(h, dt);
        else if (!h.player && !h.out) {
          h.respawnT -= dt;
          if (h.respawnT <= 0 && (this.Respawns || !real)) {
            const [x, y] = this.SafePoint(0);
            this.SpawnHole(h, Math.floor(h.score * 0.5), x, y);
          }
        }
        continue;
      }
      h.invuln = Math.max(0, h.invuln - dt);
      if (!h.player && !h.friend) this.Think(h, dt);
      if (h.friend) this.FollowFriend(h, dt); else this.MoveHole(h, dt);
      this.EatAndBlock(h, false);
      // grow smoothly towards the level radius
      const target = Radii[h.level];
      h.R = Mathf.moveTowards(h.R, target, dt * (0.6 + target * 0.5));
      h.pulse = Math.max(0, h.pulse - dt * 1.8);
    }
    this.HoleVsHole(real);
    this.AnimateFalling(dt);
  }

  // ------------------------------------------------------------------ traffic

  private MoveTraffic(dt: number) {
    const vx0 = this.camX - this.ViewSize.x * 0.5 - 6, vx1 = this.camX + this.ViewSize.x * 0.5 + 6;
    const vy0 = this.camY - this.ViewSize.y * 0.5 - 6, vy1 = this.camY + this.ViewSize.y * 0.5 + 6;
    for (let i = 0; i < this.objCount; i++) {
      const o = this.objs[i];
      if (o.mover === Mover.None) continue;
      if (o.state === St.Gone) {
        o.respawn -= dt;
        if (o.respawn <= 0) this.RespawnMover(o, vx0, vy0, vx1, vy1);
        continue;
      }
      if (o.state !== St.Standing) continue;
      if (o.mover === Mover.Walker) {
        o.b += o.c * o.speed * dt;
        walkerPos(o.a, o.b, this.tmp);
        o.x = this.tmp[0]; o.y = this.tmp[1];
      } else this.DriveCar(o, dt);
      if (o.wobble > 0) o.wobble = Math.max(0, o.wobble - dt * 3);
      this.hash.move(o.id, o.x, o.y);
      if (o.shown) {
        if (o.mover === Mover.Walker) { o.bob += dt * 9; o.visY = Math.abs(Math.sin(o.bob)) * 0.05; }
        this.PlaceObj(o);
      }
    }
  }

  private DriveCar(o: Obj, dt: number) {
    // a = axis (0 = along x), b = road index, c = direction
    const axis = o.a, dir = o.c;
    let u = axis === 0 ? o.x : o.y;
    // stop for a hole that can't swallow us? no: cars just keep driving
    const nu = u + dir * o.speed * dt;
    // crossing an intersection centre?
    const j0 = (u + Half - Road / 2) / (Block + Road), j1 = (nu + Half - Road / 2) / (Block + Road);
    const cross = Math.floor(j0) !== Math.floor(j1) || (dir > 0 ? nu > Half - Road / 2 : nu < -Half + Road / 2);
    u = nu;
    if (cross) {
      const j = Mathf.clamp(Math.round(dir > 0 ? Math.floor(j1) : Math.ceil(j1)), 0, N);
      const atEdge = (dir > 0 && j >= N) || (dir < 0 && j <= 0);
      const r = this.rng.nextDouble();
      if (atEdge || r < 0.35) {
        // turn onto road j (the crossing road); choose a direction that stays in the city
        let nd = this.rng.next(2) === 0 ? 1 : -1;
        if (o.b <= 0) nd = 1; else if (o.b >= N) nd = -1;
        const oldX = o.x, oldY = o.y;
        const lane = laneOf(1 - axis, j, nd);
        const along = axis === 0 ? laneOf(0, o.b, dir) : laneOf(1, o.b, dir);
        o.a = 1 - axis; o.c = nd; o.b = j;
        if (o.a === 0) { o.x = along; o.y = lane; } else { o.x = lane; o.y = along; }
        o.visX += oldX - o.x; o.visY += oldY - o.y;
        this.SetCarPic(o);
        return;
      }
    }
    if (axis === 0) o.x = u; else o.y = u;
    o.visX *= Math.exp(-dt * 5); o.visY *= Math.exp(-dt * 5);
  }

  private SetCarPic(o: Obj) {
    const d = o.def, vertical = o.a === 1;
    const variant = Math.max(0, d.pics.indexOf(o.pic), d.picsV.indexOf(o.pic));
    o.pic = vertical && d.picsV.length ? d.picsV[variant % d.picsV.length] : d.pics[variant % d.pics.length];
    o.hw = vertical ? d.hh : d.hw; o.hh = vertical ? d.hw : d.hh;
    const s = o.pic.sprite, w = s.width / s.ppu, h = s.height / s.ppu;
    o.sr.sprite = s;
    o.ex0 = o.pic.ox - w / 2; o.ex1 = o.pic.ox + w / 2; o.ey0 = o.pic.oy - h / 2; o.ey1 = o.pic.oy + h / 2;
  }

  private RespawnMover(o: Obj, vx0: number, vy0: number, vx1: number, vy1: number) {
    // somewhere off screen and away from holes
    for (let t = 0; t < 6; t++) {
      let x: number, y: number;
      if (o.mover === Mover.Walker) {
        o.a = this.rng.next(N * N);
        o.b = this.rng.nextDouble() * 70;
        walkerPos(o.a, o.b, this.tmp);
        x = this.tmp[0]; y = this.tmp[1];
      } else {
        o.a = this.rng.next(2); o.b = this.rng.next(N + 1); o.c = this.rng.next(2) === 0 ? 1 : -1;
        const u = -Half + 4 + this.rng.nextDouble() * (CitySize - 8), lane = laneOf(o.a, o.b, o.c);
        x = o.a === 0 ? u : lane; y = o.a === 0 ? lane : u;
      }
      if (x > vx0 && x < vx1 && y > vy0 && y < vy1) continue;
      // online: not in the friend's view either
      const f = this.net === 1 ? this.fin : null;
      if (f && Math.abs(x - f.cx) < f.vw + 6 && Math.abs(y - f.cy) < f.vh + 6) continue;
      let near = false;
      for (const h of this.holes) if (h.alive && Math.hypot(h.x - x, h.y - y) < h.R + 6) near = true;
      if (near) continue;
      o.x = x; o.y = y; o.visX = o.visY = 0;
      if (o.mover === Mover.Car) this.SetCarPic(o);
      o.state = St.Standing;
      o.sr.color = Color.white;
      o.sr.transform.localScale = V3.one;
      o.sr.transform.localEulerZ = 0;
      o.shown = false;
      o.sr.gameObject.setActive(false);
      this.hash.insert(o.id, o.x, o.y);
      this.totalValue += o.def.value;
      return;
    }
    o.respawn = 1;
  }

  // ------------------------------------------------------------------ holes: movement, eating, blocking

  private SpeedFor(h: Hole) { return (4.4 + h.R * 0.55) * (h.player ? 1 : 0.86 + 0.06 * h.skill); }

  private MoveHole(h: Hole, dt: number) {
    const sp = this.SpeedFor(h), k = 1 - Math.exp(-dt * 9);
    h.vx += (h.wantX * sp - h.vx) * k;
    h.vy += (h.wantY * sp - h.vy) * k;
    h.x += h.vx * dt; h.y += h.vy * dt;
    const lim = Half - h.R * 0.35;
    h.x = Mathf.clamp(h.x, -lim, lim);
    h.y = Mathf.clamp(h.y, -lim, lim);
  }

  /** predict: the online guest's own hole (it swallows static things and walkers at once; cars wait for the host). */
  private EatAndBlock(h: Hole, predict: boolean) {
    const range = h.R + MaxHalfExtent, hs = this.hash;
    const cx0 = hs.coord(h.x - range), cx1 = hs.coord(h.x + range), cy0 = hs.coord(h.y - range), cy1 = hs.coord(h.y + range);
    const edible = 2 * h.R * EatK;
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        let id = hs.head[cy * hs.dim + cx];
        while (id >= 0) {
          const next = hs.next[id];
          const o = this.objs[id];
          const dx = o.x - h.x, dy = o.y - h.y;
          if (o.def.size < edible) {
            const r = h.R - o.def.size * 0.28;
            if (dx * dx + dy * dy < r * r && !(predict && o.mover === Mover.Car)) this.StartFall(o, h);
          } else {
            // circle vs box: the hole may overlap the box by (1 - BlockK) of its radius
            const qx = Mathf.clamp(h.x, o.x - o.hw, o.x + o.hw), qy = Mathf.clamp(h.y, o.y - o.hh, o.y + o.hh);
            let ex = h.x - qx, ey = h.y - qy;
            const minD = h.R * BlockK;
            let d2 = ex * ex + ey * ey;
            if (d2 < minD * minD) {
              if (d2 < 1e-8) {
                // centre inside the box: push out through the nearest side
                const px = o.hw - Math.abs(h.x - o.x), py = o.hh - Math.abs(h.y - o.y);
                if (px < py) { ex = Math.sign(h.x - o.x) || 1; ey = 0; h.x = o.x + ex * (o.hw + minD); }
                else { ey = Math.sign(h.y - o.y) || 1; ex = 0; h.y = o.y + ey * (o.hh + minD); }
              } else {
                const d = Math.sqrt(d2), push = (minD - d) / d;
                h.x += ex * push; h.y += ey * push;
                // slide: remove the velocity into the obstacle
                const nx = ex / d, ny = ey / d, vn = h.vx * nx + h.vy * ny;
                if (vn < 0) { h.vx -= vn * nx; h.vy -= vn * ny; }
                d2 = 0;
              }
              if (o.wobble < 0.5) o.wobble = 1;
            }
          }
          id = next;
        }
      }
  }

  private StartFall(o: Obj, h: Hole) {
    this.hash.remove(o.id);
    o.state = St.Falling;
    o.hole = h;
    o.ft = 0;
    o.fdur = 0.32 + Math.min(0.5, o.def.size * 0.07);
    o.fox = o.x - h.x; o.foy = o.y - h.y;
    o.spin = (this.rng.nextDouble() * 2 - 1) * (40 + 60 * this.rng.nextDouble());
    o.sr.sortingOrder = -400 + h.idx * 0.1 + 0.05;
    o.order = o.sr.sortingOrder;
    if (!o.shown) { o.shown = true; o.sr.gameObject.setActive(true); }
    this.falling[this.fallingCount++] = o.id;
    o.goneAt = netNow();
    if (this.net === 1) this.eatNow.push(h.idx, o.id);
  }

  private AnimateFalling(dt: number) {
    for (let i = 0; i < this.fallingCount; i++) {
      const o = this.objs[this.falling[i]];
      const h = o.hole!;
      o.ft += dt / o.fdur;
      const k = Mathf.clamp01(o.ft), e = k * k;
      // slide from where it was towards the centre (and a little up: down the far wall), shrinking and darkening
      const pull = 1 - Ease.outCubic(k);
      const fx = h.x + o.fox * pull, fy = h.y + o.foy * pull + h.R * 0.25 * e;
      const maxS = (h.R * 1.1) / Math.max(0.3, (o.ex1 - o.ex0) * 0.5 + 0.1);
      const s = Math.min(Mathf.lerp(1, 0.12, e), Math.max(0.12, maxS * (1 - e * 0.7)));
      if (o.shown) {
        o.sr.transform.localPosition = new V3(fx + o.pic.ox * s, fy + o.pic.oy * s, 0);
        o.sr.transform.localScale = new V3(s, s * (1 - 0.3 * e), 1);
        o.sr.transform.localEulerZ = o.spin * Ease.outCubic(k);
        o.sr.color = Shade[Math.min(31, Math.floor(k * k * 31))];
      }
      if (o.ft >= 1) {
        o.state = St.Gone;
        o.shown = false;
        o.sr.gameObject.setActive(false);
        if (o.mover !== Mover.None) o.respawn = 18 + this.rng.nextDouble() * 14;
        this.Swallowed(h, o);
        this.falling[i] = this.falling[--this.fallingCount];
        i--;
      }
    }
  }

  private Swallowed(h: Hole, o: Obj) {
    const v = o.def.value;
    this.eatenValue += v;
    if (h.alive && this.net !== 2) this.AddScore(h, v); // the online guest's scores come from the host
    h.cityScore += v;
    const real = this.State === Phase.Playing;
    const visible = Math.abs(h.x - this.camX) < this.ViewSize.x * 0.6 && Math.abs(h.y - this.camY) < this.ViewSize.y * 0.6;
    if (visible && o.def.size > 0.9) this.fx.pop(new V2(h.x, h.y + h.R * 0.3), o.def.color, Math.min(14, 3 + Math.round(o.def.size * 2)), 2 + h.R, 0.12 + h.R * 0.05, 0.45);
    if (!h.player || !real) return;
    this.Data.add("swallowed", 1);
    if (v >= 5) {
      this.UI.Float(new V2(h.x, h.y + h.R + 0.4), "+" + v, v >= 60 ? Gold : Color.white, v >= 60 ? 1.3 : v >= 15 ? 1 : 0.8);
      Sfx.playClip(this.gulpClip, 0.5 + Math.min(0.4, v / 200), 1.25 - Math.min(0.55, o.def.size * 0.08));
      if (v >= 60) { this.Fx.shake(0.12); Fx.haptic(); }
    } else {
      this.smallAccum += v;
    }
    if (this.eatSfxCooldown <= 0) {
      Sfx.playClip(this.eatClip, 0.45, 0.9 + this.rng.nextDouble() * 0.3);
      this.eatSfxCooldown = 0.05;
    }
  }

  private AddScore(h: Hole, v: number) {
    if (this.net > 0 && this.ending > 0) return; // online: scores freeze at the buzzer (both devices rank the same numbers)
    h.score += v;
    this.LevelUp(h);
  }

  private LevelUp(h: Hole) {
    const l = levelFor(h.score);
    if (l < h.level) h.level = l;
    if (l > h.level) {
      h.level = l;
      h.pulse = 1;
      const near = Math.abs(h.x - this.camX) < this.ViewSize.x * 0.6 && Math.abs(h.y - this.camY) < this.ViewSize.y * 0.6;
      if (h.player && this.State === Phase.Playing) {
        Sfx.playClip(this.upClip, 0.8);
        Fx.haptic(true);
        this.Fx.ring(new V2(h.x, h.y), h.color, Radii[l] * 0.9, Radii[l] * 2.2, 0.45);
        this.UI.Float(new V2(h.x, h.y + Radii[l] + 1), l >= Radii.length - 1 ? "MAX SIZE!" : "SIZE " + (l + 1) + "!", Gold, 1.35);
      } else if (near) this.fx.sparkle(new V2(h.x, h.y), h.color, 6, h.R, 0.35);
    }
  }

  private HoleVsHole(real: boolean) {
    const hs = this.holes;
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < hs.length; j++) {
        const b = hs[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        const big = a.R >= b.R ? a : b, small = big === a ? b : a;
        if (big.R > small.R * 1.15 && d < big.R - small.R * 0.35 && small.invuln <= 0 && big.invuln <= 0) { this.EatHole(big, small, real); continue; }
        // equal-ish holes bump softly
        const minD = (a.R + b.R) * 0.75;
        if (d < minD && d > 1e-4) {
          const push = ((minD - d) / d) * 0.5;
          a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
        }
      }
    }
  }

  private EatHole(big: Hole, small: Hole, real: boolean) {
    small.alive = false;
    small.dyingT = 0.55;
    small.eater = big;
    small.eatenBy = big.name;
    big.holesEaten++;
    const bonus = Math.max(15, Math.round(small.score * 0.35));
    this.AddScore(big, bonus);
    if (!real) return;
    if (!this.Respawns) { small.out = true; small.outOrder = ++this.outCounter; }
    if (small.player) { if (this.Respawns) small.respawnT = 3; else this.deathDelay = 1.6; }
    else small.respawnT = small.friend ? 3 : 3 + this.rng.nextDouble() * 3;
    this.HoleEatenFx(big, small, bonus);
    if (this.net === 1) this.PushEvent([1, big.idx, small.idx, bonus]);
  }

  /** Feed, sounds and the respawn panel for "big swallowed small" (the online guest plays these from host events). */
  private HoleEatenFx(big: Hole, small: Hole, bonus: number) {
    if (big.player || small.player) this.AddFeed(big.player ? `YOU SWALLOWED ${small.name.toUpperCase()}!` : `${big.name.toUpperCase()} SWALLOWED YOU!`, big.player ? Gold : Pal.Danger);
    else this.AddFeed(`${big.name} swallowed ${small.name}`, Color.lerp(big.color, Color.white, 0.4));
    if (big.player) {
      Sfx.playClip(this.slurpClip, 0.9, 1.1);
      this.UI.Announce("SWALLOWED " + small.name.toUpperCase() + "!", Gold, 1.3);
      this.UI.Float(new V2(big.x, big.y + big.R + 0.6), "+" + bonus, Gold, 1.4);
      this.Fx.shake(0.25);
      Fx.haptic(true);
    }
    if (small.player) {
      Sfx.playClip(this.slurpClip, 1, 0.8);
      Sfx.play(Snd.Hurt, 0.7);
      this.Fx.shake(0.4);
      Fx.haptic(true);
      if (!this.Respawns) this.UI.Announce("SWALLOWED BY " + big.name.toUpperCase() + "!", Pal.Danger, 1.5);
      else this.respawnPanel.setActive(true);
    }
  }

  private AnimateDying(h: Hole, dt: number) {
    h.dyingT -= dt;
    const e = h.eater;
    if (e) {
      const k = 1 - Math.exp(-dt * 10);
      h.x += (e.x - h.x) * k; h.y += (e.y - h.y) * k;
    }
    if (h.dyingT <= 0) h.root.setActive(false);
  }

  // ------------------------------------------------------------------ player respawn

  private TickRespawn(dt: number) {
    const h = this.player;
    h.respawnT -= dt;
    this.respawnTitle.text = h.eatenBy ? "SWALLOWED BY " + h.eatenBy.toUpperCase() + "!" : "SWALLOWED!";
    this.respawnCount.text = "RESPAWNING IN " + Math.max(1, Math.ceil(h.respawnT));
    this.respawnNote.text = "You come back at HALF SIZE (-50%)";
    const offer = !this.fullRespawnUsed && AdService.rewardedAvailable && this.net === 0; // no ads during an online match
    if (this.fullButton.node.activeSelf !== offer) this.fullButton.node.setActive(offer);
    if (h.respawnT <= 0 && this.net !== 2) this.RespawnPlayer(false); // the online guest waits for the host's respawn
  }

  private TakeFullRespawn() {
    if (this.fullRespawnUsed || AdService.isShowing) return;
    AdService.showRewarded((earned) => {
      if (!earned || this.player.alive || this.State !== Phase.Playing) return;
      this.fullRespawnUsed = true;
      this.RespawnPlayer(true);
    });
  }

  private RespawnPlayer(full: boolean) {
    const h = this.player;
    const [x, y] = this.SafePoint(h.R);
    const score = full ? h.score : Math.floor(h.score * 0.5);
    this.SpawnHole(h, score, x, y);
    h.invuln = 3;
    this.camX = x; this.camY = y;
    this.respawnPanel.setActive(false);
    this.UI.Announce(full ? "BACK AT FULL SIZE!" : "BACK IN! -50%", full ? Pal.Good : Pal.Warn, 1.2);
    Sfx.play(Snd.PowerUp, 0.8);
  }

  // ------------------------------------------------------------------ AI

  private Think(h: Hole, dt: number) {
    h.think -= dt;
    // stuck against a building? try another direction for a moment
    const moved = Math.hypot(h.x - h.lastX, h.y - h.lastY);
    h.lastX = h.x; h.lastY = h.y;
    if (moved < this.SpeedFor(h) * dt * 0.25) h.stuck += dt; else h.stuck = Math.max(0, h.stuck - dt);
    if (h.wander > 0) { h.wander -= dt; this.SteerTo(h, h.tx, h.ty, 1); return; }
    if (h.stuck > 0.6) {
      h.stuck = 0;
      h.wander = 0.8 + this.rng.nextDouble() * 0.6;
      const a = this.rng.nextDouble() * Math.PI * 2;
      h.tx = h.x + Math.cos(a) * 8; h.ty = h.y + Math.sin(a) * 8;
      return;
    }
    if (h.think > 0) { this.SteerTo(h, h.tx, h.ty, 1); return; }
    h.think = (0.18 + this.rng.nextDouble() * 0.15) / h.skill;
    // danger first
    let threat: Hole | null = null, td = 1e9;
    let prey: Hole | null = null, pd = 1e9;
    for (const o of this.holes) {
      if (o === h || !o.alive) continue;
      const d = Math.hypot(o.x - h.x, o.y - h.y);
      if (o.R > h.R * 1.15 && d < o.R + 5 + h.R * 2 && d < td) { threat = o; td = d; }
      if (h.R > o.R * 1.2 && o.invuln <= 0 && d < 9 + h.R * 2.5 && d < pd) { prey = o; pd = d; }
    }
    if (threat && this.rng.nextDouble() < 0.75 + 0.25 * h.skill) {
      const dx = h.x - threat.x, dy = h.y - threat.y, d = Math.max(0.01, td);
      // flee, sliding sideways a little so we don't pin ourselves against the edge
      h.tx = h.x + (dx / d) * 10 - (dy / d) * 4; h.ty = h.y + (dy / d) * 10 + (dx / d) * 4;
      if (Math.abs(h.tx) > Half - 3 || Math.abs(h.ty) > Half - 3) { h.tx = h.x - (dy / d) * 10; h.ty = h.y + (dx / d) * 10; }
      this.SteerTo(h, h.tx, h.ty, 1);
      return;
    }
    if (prey && this.rng.nextDouble() < 0.35 + 0.6 * h.aggro) {
      h.tx = prey.x + prey.vx * 0.4; h.ty = prey.y + prey.vy * 0.4;
      this.SteerTo(h, h.tx, h.ty, 1);
      return;
    }
    // food: the best value-per-distance object we can swallow
    const edible = 2 * h.R * EatK, hs = this.hash, reach = 6 + h.R * 2.2;
    const cx0 = hs.coord(h.x - reach), cx1 = hs.coord(h.x + reach), cy0 = hs.coord(h.y - reach), cy1 = hs.coord(h.y + reach);
    let best = -1, bestScore = 0;
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++)
        for (let id = hs.head[cy * hs.dim + cx]; id >= 0; id = hs.next[id]) {
          const o = this.objs[id];
          if (o.def.size >= edible) continue;
          const d = Math.hypot(o.x - h.x, o.y - h.y);
          const sc = (o.def.value * (0.7 + 0.6 * this.rng.nextDouble() * (1.3 - h.skill))) / (d + 1.5);
          if (sc > bestScore) { bestScore = sc; best = id; }
        }
    if (best >= 0) {
      const o = this.objs[best];
      h.tx = o.x; h.ty = o.y;
    } else if (Math.hypot(h.tx - h.x, h.ty - h.y) < 2 || this.rng.nextDouble() < 0.1) {
      h.tx = (this.rng.nextDouble() * 2 - 1) * (Half - 6);
      h.ty = (this.rng.nextDouble() * 2 - 1) * (Half - 6);
    }
    this.SteerTo(h, h.tx, h.ty, 1);
  }

  private SteerTo(h: Hole, x: number, y: number, speed: number) {
    const dx = x - h.x, dy = y - h.y, d = Math.hypot(dx, dy);
    if (d < 0.05) { h.wantX = h.wantY = 0; return; }
    const k = (Mathf.clamp01(d / Math.max(0.6, h.R)) * speed) / d;
    h.wantX = dx * k; h.wantY = dy * k;
  }

  // ------------------------------------------------------------------ presentation (culling + transforms)

  private Present(dt: number) {
    // keep the view inside the city (a little grass may show past the outer road)
    const lx = Math.max(0, Half + 2 - this.ViewSize.x * 0.5), ly = Math.max(0, Half + 2 - this.ViewSize.y * 0.5);
    this.camX = Mathf.clamp(this.camX, -lx, lx);
    this.camY = Mathf.clamp(this.camY, -ly, ly);
    const vw = this.ViewSize.x * 0.5 + 1, vh = this.ViewSize.y * 0.5 + 1;
    const x0 = this.camX - vw, x1 = this.camX + vw, y0 = this.camY - vh, y1 = this.camY + vh;
    for (const g of this.ground) {
      const on = g.x + g.r > x0 && g.x - g.r < x1 && g.y + g.r > y0 && g.y - g.r < y1;
      if (on !== g.shown) { g.shown = on; g.sr.gameObject.setActive(on); }
    }
    const t = Time.time;
    for (let i = 0; i < this.objCount; i++) {
      const o = this.objs[i];
      if (o.state !== St.Standing) continue;
      const on = o.x + o.ex1 > x0 && o.x + o.ex0 < x1 && o.y + o.ey1 > y0 && o.y + o.ey0 < y1;
      if (on !== o.shown) {
        o.shown = on;
        o.sr.gameObject.setActive(on);
        if (on) this.PlaceObj(o);
      }
      if (on && o.wobble > 0) {
        o.wobble = Math.max(0, o.wobble - dt * 2.5);
        o.sr.transform.localEulerZ = Math.sin(t * 40 + i) * 4 * o.wobble;
      }
    }
    // holes
    let lead: Hole | null = null;
    for (const h of this.holes) if (h.alive && (!lead || h.score > lead.score)) lead = h;
    for (const h of this.holes) {
      if (!h.root.activeSelf) continue;
      this.PresentHole(h);
      const crown = h === lead && h.score > 0 && this.mode !== Mode.Solo;
      if (h.crown.gameObject.activeSelf !== crown) h.crown.gameObject.setActive(crown);
    }
    // camera + outside grass
    this.Fx.CameraTarget = new V2(this.camX, this.camY);
    // the grass outside the city only matters near the edge (saves a full-screen layer of overdraw)
    const outside = x0 < -Half || x1 > Half || y0 < -Half || y1 > Half;
    if (this.grassCover.gameObject.activeSelf !== outside) this.grassCover.gameObject.setActive(outside);
    if (outside) {
      this.grassCover.transform.localPosition = new V3(this.camX, this.camY, 0);
      this.grassCover.transform.localScale = new V3(this.ViewSize.x + 8, this.ViewSize.y + 8, 1);
    }
  }

  private PresentHole(h: Hole) {
    let r = h.R * (1 + 0.16 * Math.sin(h.pulse * Math.PI) * h.pulse);
    if (!h.alive) r *= Mathf.clamp01(h.dyingT / 0.55);
    const pos = new V3(h.x, h.y, 0);
    h.inner.transform.localPosition = pos;
    h.inner.transform.localScale = new V3(r, r, 1);
    h.rim.transform.localPosition = pos;
    h.rim.transform.localScale = new V3(r, r, 1);
    h.rim.transform.localEulerZ = (Time.time * 25 + h.idx * 40) % 360;
    const blink = h.invuln > 0 && h.alive ? 0.55 + 0.45 * Math.abs(Math.sin(Time.time * 9)) : 1;
    h.rim.color = (h.skinned ? Color.white : h.color).withAlpha(blink);
    const lh = 0.42 + r * 0.16;
    const ly = h.y + r * 1.05 + lh * 0.7;
    const showLabel = h.alive && this.mode !== Mode.Solo && this.State !== Phase.Title && this.ending <= 0
      && Math.abs(h.x - this.camX) < this.ViewSize.x * 0.5 + 1 && Math.abs(ly - this.camY) < this.ViewSize.y * 0.5 + 1;
    if (h.labelOn !== showLabel) { h.labelOn = showLabel; h.label.gameObject.setActive(showLabel); }
    if (showLabel) h.label.rectTransform.anchoredPosition = this.UI.WorldToHud(new V2(h.x, ly));
    if (h.crown.gameObject.activeSelf) {
      h.crown.transform.localPosition = new V3(h.x, ly + lh * 1.2, 0);
      const cs = lh * 1.6;
      h.crown.transform.localScale = new V3(cs, cs, 1);
    }
  }

  // ------------------------------------------------------------------ HUD

  private AddFeed(text: string, color: Color) {
    for (let i = this.feed.length - 1; i > 0; i--) {
      this.feed[i].t.text = this.feed[i - 1].t.text;
      this.feed[i].t.color = this.feed[i - 1].t.color;
      this.feed[i].age = this.feed[i - 1].age;
    }
    this.feed[0].t.text = text;
    this.feed[0].t.color = color;
    this.feed[0].age = 0;
  }

  private UpdateHud(force: boolean) {
    const p = this.player, dt = Time.deltaTime;
    const t = Math.max(0, Math.ceil(this.timeLeft));
    set(this.timerText, Fmt.clock(t));
    this.timerText.color = t <= 10 ? (t % 2 === 0 ? Pal.Danger : Color.white) : Color.white;
    const lo = p.level === 0 ? 0 : Need[p.level - 1], hi = p.level < Need.length ? Need[p.level] : lo + 1;
    UIKit.setMeter(this.meterFill, p.level >= Need.length ? 1 : (p.score - lo) / Math.max(1, hi - lo));
    this.meterFill.color = p.alive ? Gold : Pal.Danger;
    set(this.meterLabel, `SIZE ${p.level + 1}   ·   ${Fmt.n(p.score)}`);
    if (this.mode === Mode.Solo) set(this.soloText, `CITY SWALLOWED ${this.CityPercent()}%`);
    else set(this.soloText, "");
    // floating "+N" for small snacks, batched
    this.smallTimer -= dt;
    if (this.smallAccum > 0 && this.smallTimer <= 0 && p.alive) {
      this.UI.Float(new V2(p.x, p.y + p.R + 0.3), "+" + this.smallAccum, Color.white, 0.7);
      this.smallAccum = 0;
      this.smallTimer = 0.35;
    }
    for (const f of this.feed) {
      f.age += dt;
      const a = f.age < 3 ? 1 : Mathf.clamp01(1 - (f.age - 3) / 0.6);
      if (f.t.gameObject.activeSelf !== a > 0) f.t.gameObject.setActive(a > 0); // the outline would linger otherwise
      if (a > 0 && f.t.color.a !== a) f.t.color = f.t.color.withAlpha(a);
    }
    this.boardTimer -= dt;
    if (this.boardTimer <= 0 || force) { this.boardTimer = 0.25; this.RefreshBoard(); }
    this.miniTimer -= dt;
    if (this.miniTimer <= 0 || force) { this.miniTimer = 0.1; this.RefreshMinimap(); }
  }

  private Ranking() {
    const list = this.rankOrder;
    list.length = 0;
    for (const h of this.holes) if (h.player || !h.out || h.outOrder > 0) list.push(h);
    list.sort((a, b) => {
      // holes still in the game rank above eliminated ones (elimination mode)
      if (a.outOrder !== b.outOrder) return a.outOrder === 0 ? -1 : b.outOrder === 0 ? 1 : b.outOrder - a.outOrder;
      return b.score - a.score;
    });
    return list;
  }

  private RefreshBoard() {
    if (this.mode === Mode.Solo) return;
    const list = this.Ranking();
    for (let i = 0; i < this.boardRows.length; i++) {
      const row = this.boardRows[i];
      if (i >= list.length) { set(row, ""); continue; }
      const h = list[i];
      const name = h.player ? "YOU" : h.name;
      const tag = h.outOrder > 0 ? "  ✕" : "";
      set(row, `${i + 1}. ${name}  <color=#ffffffaa>${Fmt.n(h.score)}</color>${tag}`);
      row.color = h.player ? (this.net > 0 ? Color.lerp(h.color, Color.white, 0.25) : Gold) : h.outOrder > 0 ? new Color(1, 1, 1, 0.45) : Color.lerp(h.color, Color.white, 0.45);
    }
  }

  private RefreshMinimap() {
    const k = 76 / Half;
    for (let i = 0; i < this.miniDots.length; i++) {
      const h = this.holes[i], d = this.miniDots[i];
      const on = h.alive;
      if (d.gameObject.activeSelf !== on) d.gameObject.setActive(on);
      if (!on) continue;
      d.rectTransform.anchoredPosition = new V2(h.x * k, h.y * k);
      const s = h.player ? 18 : h.friend ? 16 : 8 + h.R * 4;
      d.rectTransform.sizeDelta = new V2(s, s);
      d.color = h.player && this.net === 0 ? Color.white : h.color;
      if (h.player || h.friend) d.rectTransform.setAsLastSibling();
    }
  }

  private CityPercent() { return Math.min(100, Math.floor((this.eatenValue / Math.max(1, this.totalValue)) * 100)); }

  // ------------------------------------------------------------------ online (private tables)

  private BuildOnline() {
    const theme = { accent: HostColor, accent2: GuestColor, ink: Ink };
    this.lobby = new TableLobby("holehungry", theme, {
      onReady: (room) => this.OnTableReady(room),
      toast: (t, sec) => this.UI.Toast(t, sec ?? 2),
    }, "Hole Hungry");
    this.overlay = new TableOverlay(theme, () => { this.overlay.hide(); this.EnterTitle(); }, (k) => this.link?.react(k));
    this.overlay.onTimeout = () => { this.link?.leave(); this.FriendLeft(); };
    this.overlay.place({ anchor: new V2(0, 0), pos: new V2(290, 70) }, { anchor: new V2(0.5, 1), pos: new V2(0, -270) });
  }

  /** PLAY with ONLINE selected opens the lobby; REMATCH online asks the friend. */
  protected StartRun() {
    if (this.State === Phase.Paused && this.net > 0 && !this.onlineGo) { this.UI.Toast("Restart isn't available online: use MENU to leave the table.", 2.5); return; }
    if (this.mode === Mode.Online && !this.onlineGo) {
      if (this.State === Phase.Over && this.link && this.link.connected) { this.AskRematch(); return; }
      if (this.State === Phase.Over) this.EnterTitle();
      if (this.ShopOpen) this.CloseShop();
      if (!this.lobby.isOpen) {
        this.lobby.createNote = "A 2-minute round in one city with your friend and 6 rival holes. The bigger hole wins!";
        this.lobby.open("menu");
      }
      return;
    }
    this.onlineGo = false;
    super.StartRun();
  }

  private get InRound() { return (this.State === Phase.Playing || this.State === Phase.Paused) && this.net > 0 && !this.finished && this.ending <= 0; }

  private OnTableReady(room: OnlineRoom) {
    this.LeaveTable();
    const link = new OnlineLink<OStart, number, OSnap>(room);
    this.link = link;
    room.onMessage((d) => { if (this.link === link) this.OnNet(d); });
    link.bind({
      onStart: (st) => this.BeginOnline(st.seed),
      validMove: () => false, // real time: no turn moves, the live state and input messages carry the round
      onMove: () => { /* unused */ },
      snapshot: () => this.Snapshot(),
      onSnapshot: (snap) => {
        if (snap.over) return;
        // joined (again) in the middle of a round: build the same city and take the host's state
        const inRound = this.InRound && this.net === 2 && this.roundSeed === snap.seed;
        if (!inRound) this.BeginOnline(snap.seed);
        this.GuestState(snap.s, true);
      },
      onReaction: (k) => this.overlay.Pop(k, true),
      onFriend: (st) => {
        if (st === "connected") {
          this.lastInputAt = this.lastStateAt = netNow();
          if (this.overlay.state === "lost") { this.overlay.hide(); this.UI.Toast("Your friend is back!", 2); }
        } else if (st === "lost") { if (this.InRound && this.overlay.state !== "lost") this.overlay.lost(30); }
        else this.FriendLeft();
      },
      onRematchReady: () => { if (link.isHost) link.start({ seed: 1 + Math.floor(Math.random() * 1_000_000) }); },
      onFriendRematch: () => { if (this.overlay.state !== "rematch") this.UI.Toast("Your friend wants a rematch! Tap REMATCH.", 3); },
    });
    if (link.isHost) link.start({ seed: 1 + Math.floor(Math.random() * 1_000_000) });
    else this.UI.Toast("Joined! Waiting for the host to start…", 3);
  }

  private BeginOnline(seed: number) {
    this.onlineSeed = seed;
    this.overlay.hide();
    this.mode = Mode.Online;
    this.Data.set("mode", Mode.Online);
    this.onlineGo = true;
    this.StartRun();
  }

  private ResetNet() {
    const now = netNow();
    this.simT = 0; this.sendT = 0; this.stateN = 0;
    this.eatLog.length = 0; this.eatNow.length = 0; this.evLog.length = 0; this.evSeq = 0;
    this.fin = null; this.lastInputAt = now;
    this.lastN = -1; this.lastEv = 0; this.lastStateAt = now; this.clockInit = false; this.jitter = 0.02;
    this.forfeit = false;
  }

  private AskRematch() {
    if (!this.link) return;
    this.overlay.waitingRematch();
    this.link.askRematch();
  }

  /** The friend left on purpose or never came back. */
  private FriendLeft() {
    const link = this.link;
    this.link = null;
    if (link && link.room.status !== "closed") link.room.close();
    this.overlay.showBar(false);
    if (this.InRound) {
      if (this.simT > RoundTime * 0.5) {
        // most of the round is played: the player who stayed takes the win
        this.forfeit = true;
        this.overlay.hide();
        this.UI.Announce("YOUR FRIEND LEFT", Gold, 1.4);
        this.StartEnding();
        return;
      }
      this.overlay.left("Your friend left", "Not enough of the round was played for a result.");
      return;
    }
    if (this.State === Phase.Over || this.overlay.state === "rematch") this.overlay.left("Your friend left", "No rematch this time.");
  }

  /** Leaving (menu, title): the friend is told and the room closes. */
  private LeaveTable() {
    if (this.link) { this.link.leave(); this.link = null; }
    this.overlay?.hide();
    this.overlay?.showBar(false);
  }

  private OnNet(d: unknown) {
    const m = d as { t?: string } | null;
    if (!m || typeof m !== "object") return;
    if (m.t === "i" && this.net === 1) this.HostInput(m as OInput);
    else if (m.t === "s" && this.net === 2) this.GuestState(m as OState, false);
  }

  private TickOnline(dt: number, paused: boolean) {
    this.overlay.tick();
    if (this.net === 1) this.HostTick(dt, paused); else this.GuestTick(dt, paused);
  }

  private FollowCamera(dt: number) {
    const p = this.player, k = 1 - Math.exp(-dt * 6);
    const fx = p.alive ? p.x : this.camX, fy = p.alive ? p.y : this.camY;
    this.camX += (fx - this.camX) * k; this.camY += (fy - this.camY) * k;
    this.zoom = Mathf.lerp(this.zoom, this.ZoomFor(p.alive ? p.R : Math.max(p.R, 1.5)), dt * 1.6);
  }

  private CountdownTick() {
    const sec = Math.ceil(this.timeLeft);
    if (sec <= 10 && sec !== this.lastTick && sec > 0) { this.lastTick = sec; Sfx.play(Snd.Tick, 0.7, 1 + (10 - sec) * 0.04); }
  }

  // ---------------------------------------------------- host: the only simulation

  private HostTick(dt: number, paused: boolean) {
    const p = this.player, now = netNow();
    if (this.ending > 0) {
      this.ending -= dt;
      this.AnimateFalling(dt);
      this.Present(dt);
      this.HostSend();
      if (this.ending <= 0 && !this.finished) this.EndRound();
      return;
    }
    // the friend went quiet (app in the background, network): hold the round until they are back
    if (this.link && now - this.lastInputAt > SilentLost && this.overlay.state === "none") this.overlay.lost(30);
    const frozen = !this.link || this.overlay.state === "lost" || this.overlay.state === "left";
    if (!frozen) {
      this.simT += dt;
      this.timeLeft -= dt;
      if (paused) { p.wantX = p.wantY = 0; } else this.SteerPlayer();
      this.Simulate(dt, true);
      if (!p.alive && !p.out && p.dyingT <= 0) this.TickRespawn(dt);
    }
    this.FollowCamera(dt);
    this.Present(dt);
    this.UpdateHud(false);
    this.CountdownTick();
    if (!frozen && this.timeLeft <= 0) this.StartEnding();
    this.HostSend();
  }

  /** The guest's hole follows its own reports (it predicts itself; the host only smooths over the network jitter). */
  private FollowFriend(h: Hole, dt: number) {
    if (h.rAt < 0) return;
    const age = Math.min(0.12, netNow() - h.rAt);
    const tx = h.rx + h.rvx * age, ty = h.ry + h.rvy * age, k = 1 - Math.exp(-dt * 16);
    h.x += (tx - h.x) * k; h.y += (ty - h.y) * k;
    h.vx = h.rvx; h.vy = h.rvy;
    const lim = Half - h.R * 0.35;
    h.x = Mathf.clamp(h.x, -lim, lim);
    h.y = Mathf.clamp(h.y, -lim, lim);
  }

  private HostInput(m: OInput) {
    if (!this.link || m.mt !== this.link.match || !this.InRound) return;
    const now = netNow();
    this.fin = m;
    this.lastInputAt = now;
    if (this.overlay.state === "lost" && this.link.connected) { this.overlay.hide(); this.UI.Toast("Your friend is back!", 2); }
    const f = this.holes[FriendIdx];
    if (!f.alive || m.s !== f.spawns) return; // an input from before a respawn the guest hasn't seen yet
    f.rx = Mathf.clamp(+m.x || 0, -Half, Half); f.ry = Mathf.clamp(+m.y || 0, -Half, Half);
    f.rvx = Mathf.clamp(+m.vx || 0, -20, 20); f.rvy = Mathf.clamp(+m.vy || 0, -20, 20);
    if (f.rAt < 0) { f.x = f.rx; f.y = f.ry; }
    f.rAt = now;
  }

  private PushEvent(v: number[]) {
    this.evLog.push({ n: this.stateN, v: [++this.evSeq, ...v] });
    while (this.evLog.length > 0 && this.evLog[0].n < this.stateN - 20) this.evLog.shift();
  }

  private HostSend() {
    if (!this.link) { this.eatNow.length = 0; return; }
    const now = netNow();
    if (now < this.sendT) return;
    this.sendT = Math.max(this.sendT + StateEvery, now - StateEvery);
    this.link.room.send(this.BuildState(false));
  }

  /** The live state (full = for a snapshot: every mover, the gone set, no eat list). */
  private BuildState(full: boolean): OState {
    let n = this.stateN;
    let e: number[][] = [];
    if (!full) {
      n = ++this.stateN;
      // swallows of this state, grouped by hole, plus the two states before (a lost message doesn't lose a swallow)
      const groups = new Map<number, number[]>();
      for (let i = 0; i < this.eatNow.length; i += 2) {
        let g = groups.get(this.eatNow[i]);
        if (!g) { g = [this.eatNow[i]]; groups.set(this.eatNow[i], g); }
        g.push(this.eatNow[i + 1]);
      }
      this.eatNow.length = 0;
      this.eatLog.push([...groups.values()]);
      while (this.eatLog.length > 3) this.eatLog.shift();
      e = this.eatLog.flat();
    }
    const h: number[] = [];
    for (const o of this.holes) {
      const fl = (o.alive ? 1 : 0) | (o.invuln > 0 ? 2 : 0) | (o.out ? 8 : 0);
      h.push(r2(o.x), r2(o.y), r2(o.R), o.score, fl, o.spawns, o.holesEaten);
    }
    // movers near the guest's view (6 chars each)
    const f = this.fin, fr = this.holes[FriendIdx];
    const cx = f ? f.cx : fr.x, cy = f ? f.cy : fr.y, hw = (f ? f.vw : 16) + 6, hh = (f ? f.vh : 30) + 6;
    const m: string[] = [];
    for (let i = 0; i < this.objCount; i++) {
      const o = this.objs[i];
      if (o.mover === Mover.None || o.state !== St.Standing || i > 2047) continue;
      const car = o.mover === Mover.Car;
      const x = o.x + (car ? o.visX : 0), y = o.y + (car ? o.visY : 0);
      if (!full && (Math.abs(x - cx) > hw || Math.abs(y - cy) > hh)) continue;
      const a = i | (car && o.a === 1 ? 2048 : 0), qx = q12(x), qy = q12(y);
      m.push(B64[a >> 6], B64[a & 63], B64[qx >> 6], B64[qx & 63], B64[qy >> 6], B64[qy & 63]);
    }
    const v: number[][] = [];
    for (const ev of this.evLog) if (ev.n >= this.stateN - 15) v.push(ev.v);
    const st: OState = { t: "s", mt: this.link ? this.link.match : 0, n, tm: Math.round(this.simT * 1000) / 1000, h, m: m.join(""), e, v };
    if (full || n % 16 === 0) {
      const g: string[] = [];
      for (let i = 0; i < this.objCount; i += 6) {
        let b = 0;
        for (let k = 0; k < 6 && i + k < this.objCount; k++) if (this.objs[i + k].state !== St.Standing) b |= 1 << k;
        g.push(B64[b]);
      }
      st.g = g.join("");
    }
    if (this.ending > 0) st.end = 1;
    return st;
  }

  private Snapshot(): OSnap {
    const playing = (this.State === Phase.Playing || this.State === Phase.Paused) && this.net === 1 && !this.finished;
    return { seed: this.roundSeed, over: !playing, s: this.BuildState(true) };
  }

  // ---------------------------------------------------- guest: predict my hole, interpolate the rest

  private GuestState(m: OState, force: boolean) {
    if (!this.link || m.mt !== this.link.match || !m.h) return;
    if (!(this.State === Phase.Playing || this.State === Phase.Paused) || this.finished || this.net !== 2) return;
    if (!force && m.n <= this.lastN) return;
    if (!force) this.lastN = m.n;
    const now = netNow();
    this.lastStateAt = now;
    if (this.overlay.state === "lost") { this.overlay.hide(); this.UI.Toast("Your friend is back!", 2); }
    // clock: host time ≈ now - clockOff; the fastest message shows the true offset, a big jump means the host paused
    const off = now - m.tm;
    if (!this.clockInit || force || off < this.clockOff || off - this.clockOff > 0.6) { this.clockOff = off; this.clockInit = true; }
    else { const j = off - this.clockOff; this.jitter += (j - this.jitter) * 0.05; this.clockOff += j * 0.01; }
    // events first (who swallowed whom), then swallows, the gone set, holes and movers
    for (const v of m.v ?? []) {
      if (v[0] <= this.lastEv) continue;
      this.lastEv = v[0];
      if (!force) this.GuestEvent(v);
    }
    if (!force) for (const g of m.e ?? []) {
      const h = this.holes[swapIdx(g[0])];
      if (!h) continue;
      for (let k = 1; k < g.length; k++) {
        const id = g[k];
        if (id >= 0 && id < this.objCount && this.objs[id].state === St.Standing) this.StartFall(this.objs[id], h);
      }
    }
    if (m.g) {
      for (let c = 0; c < m.g.length; c++) {
        const b = B64i[m.g.charCodeAt(c) & 127];
        for (let k = 0; k < 6; k++) {
          const i = c * 6 + k;
          if (i >= this.objCount) break;
          const o = this.objs[i];
          if ((b >> k) & 1) { if (o.state === St.Standing) this.GuestHide(o, now); }
          // a static thing we swallowed on our own guess but the host didn't: put it back
          else if (o.state === St.Gone && o.mover === Mover.None && (force || now - o.goneAt > 1.5)) this.GuestRestand(o, o.x, o.y);
        }
      }
    }
    const H = m.h, t = m.tm;
    for (let w = 0; w <= FriendIdx; w++) {
      const h = this.holes[swapIdx(w)], b = w * 7;
      const x = H[b] / 100, y = H[b + 1] / 100, R = H[b + 2] / 100, score = H[b + 3], fl = H[b + 4], sp = H[b + 5];
      h.holesEaten = H[b + 6];
      const alive = (fl & 1) !== 0;
      if (alive && (sp !== h.spawns || !h.alive)) {
        // a (re)spawn: start from the host's spot
        const again = h.spawns > 0 && !force;
        this.SpawnHole(h, score, x, y);
        h.spawns = sp;
        h.R = R;
        if (h.player) {
          this.camX = x; this.camY = y;
          this.respawnPanel.setActive(false);
          if (again) { this.UI.Announce("BACK IN! -50%", Pal.Warn, 1.2); Sfx.play(Snd.PowerUp, 0.8); }
        }
      } else if (!alive && h.alive) {
        h.alive = false;
        h.dyingT = force ? 0.01 : Math.max(h.dyingT, 0.55);
        if (h.player) { h.respawnT = 3; if (!force) this.respawnPanel.setActive(true); }
      }
      h.invuln = fl & 2 ? 1 : 0;
      h.targetR = R;
      if (h.score !== score) { h.score = score; this.LevelUp(h); }
      if (!h.player || !h.alive) h.sn = pushRing(h.st, h.sx, h.sy, 0, h.sn, t, x, y);
      else if (force) { h.x = x; h.y = y; this.camX = x; this.camY = y; }
    }
    const ms = m.m ?? "";
    for (let i = 0; i + 6 <= ms.length; i += 6) {
      const a = (B64i[ms.charCodeAt(i) & 127] << 6) | B64i[ms.charCodeAt(i + 1) & 127];
      const id = a & 2047, axis = a >> 11;
      if (id >= this.objCount) continue;
      const o = this.objs[id];
      if (o.mover === Mover.None || o.state === St.Falling) continue;
      const x = uq12((B64i[ms.charCodeAt(i + 2) & 127] << 6) | B64i[ms.charCodeAt(i + 3) & 127]);
      const y = uq12((B64i[ms.charCodeAt(i + 4) & 127] << 6) | B64i[ms.charCodeAt(i + 5) & 127]);
      if (o.state === St.Gone) {
        if (!force && now - o.goneAt < 1.5) continue; // we just swallowed it on our own guess: the host's swallow is on its way
        this.GuestRestand(o, x, y);
      }
      if (o.mover === Mover.Car && o.a !== axis) { o.a = axis; this.SetCarPic(o); }
      this.moverN[id] = pushRing(this.moverT, this.moverX, this.moverY, id * RingN, this.moverN[id], t, x, y);
    }
    if (m.end && this.ending <= 0 && !this.finished) { this.timeLeft = 0; this.StartEnding(); }
  }

  private GuestEvent(v: number[]) {
    if (v[1] === 1) {
      const big = this.holes[swapIdx(v[2])], small = this.holes[swapIdx(v[3])];
      if (!big || !small) return;
      if (small.alive) { small.alive = false; small.dyingT = 0.55; }
      small.eater = big;
      small.eatenBy = big.name;
      if (small.player) small.respawnT = 3;
      this.HoleEatenFx(big, small, v[4]);
    }
  }

  private GuestHide(o: Obj, now: number) {
    this.hash.remove(o.id);
    o.state = St.Gone;
    o.shown = false;
    o.sr.gameObject.setActive(false);
    o.goneAt = now;
  }

  private GuestRestand(o: Obj, x: number, y: number) {
    o.x = x; o.y = y; o.visX = o.visY = 0;
    if (o.mover === Mover.Car) this.SetCarPic(o);
    o.state = St.Standing;
    o.sr.color = Color.white;
    o.sr.transform.localScale = V3.one;
    o.sr.transform.localEulerZ = 0;
    o.shown = false;
    o.sr.gameObject.setActive(false);
    this.moverN[o.id] = 0;
    this.hash.remove(o.id);
    this.hash.insert(o.id, o.x, o.y);
  }

  private GuestTick(dt: number, paused: boolean) {
    const p = this.player, now = netNow();
    this.eatSfxCooldown -= dt;
    if (this.link && !this.finished && this.ending <= 0 && now - this.lastStateAt > SilentLost && this.overlay.state === "none") this.overlay.lost(30);
    const frozen = this.overlay.state === "lost" || this.overlay.state === "left";
    // render the others ~100 ms in the past (more on a jittery connection) so there are always two states to blend
    const rT = now - this.clockOff - Mathf.clamp(0.1 + this.jitter * 2, 0.1, 0.3);
    if (this.clockInit && !frozen) {
      this.simT = Math.max(this.simT, rT);
      if (this.ending <= 0) this.timeLeft = Math.max(0, RoundTime - this.simT);
    }
    // my own hole: predicted from my input right away
    if (p.alive && this.ending <= 0 && !frozen) {
      if (paused) { p.wantX = p.wantY = 0; } else this.SteerPlayer();
      this.MoveHole(p, dt);
      this.EatAndBlock(p, true);
      for (const o of this.holes) {
        if (o === p || !o.alive) continue;
        // the same soft bump as the host's (swallowing a hole is the host's call)
        const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy), minD = (p.R + o.R) * 0.75;
        const big = p.R >= o.R ? p : o, small = big === p ? o : p;
        if (big.R > small.R * 1.15 && d < big.R - small.R * 0.35 && small.invuln <= 0 && big.invuln <= 0) continue;
        if (d < minD && d > 1e-4) { const push = ((minD - d) / d) * 0.5; p.x -= dx * push; p.y -= dy * push; }
      }
    } else if (p.alive) { p.vx = p.vy = 0; }
    for (const h of this.holes) {
      if (!h.root.activeSelf) continue;
      if ((h !== p || !h.alive) && sampleRing(h.st, h.sx, h.sy, 0, h.sn, rT, this.tmp)) { h.x = this.tmp[0]; h.y = this.tmp[1]; }
      h.R += (h.targetR - h.R) * (1 - Math.exp(-dt * 8));
      h.pulse = Math.max(0, h.pulse - dt * 1.8);
      if (!h.alive && h.dyingT > 0) { h.dyingT -= dt; if (h.dyingT <= 0) h.root.setActive(false); }
    }
    // traffic from the host's stream
    for (let i = 0; i < this.objCount; i++) {
      const n = this.moverN[i];
      if (n === 0) continue;
      const o = this.objs[i];
      if (o.state !== St.Standing) continue;
      if (!sampleRing(this.moverT, this.moverX, this.moverY, i * RingN, n, rT, this.tmp)) continue;
      o.x = this.tmp[0]; o.y = this.tmp[1];
      this.hash.move(i, o.x, o.y);
      if (o.shown) {
        if (o.mover === Mover.Walker) { o.bob += dt * 9; o.visY = Math.abs(Math.sin(o.bob)) * 0.05; }
        this.PlaceObj(o);
      }
    }
    this.AnimateFalling(dt);
    if (!p.alive && !p.out && p.dyingT <= 0 && this.ending <= 0) this.TickRespawn(dt);
    if (this.ending > 0) {
      this.ending -= dt;
      if (this.ending <= 0 && !this.finished) { this.EndRound(); return; }
    }
    this.FollowCamera(dt);
    this.Present(dt);
    if (this.ending <= 0) this.UpdateHud(false);
    this.CountdownTick();
    this.GuestSend();
  }

  private GuestSend() {
    const now = netNow();
    if (!this.link || now < this.sendT) return;
    this.sendT = Math.max(this.sendT + InputEvery, now - InputEvery);
    const p = this.player;
    this.link.room.send({
      t: "i", mt: this.link.match, x: r2(p.x) / 100, y: r2(p.y) / 100, vx: r2(p.vx) / 100, vy: r2(p.vy) / 100, s: p.spawns,
      cx: r2(this.camX) / 100, cy: r2(this.camY) / 100, vw: Math.round(this.ViewSize.x * 5) / 10, vh: Math.round(this.ViewSize.y * 5) / 10,
    } satisfies OInput);
  }

  // ---------------------------------------------------- online result

  private OnlineResult() {
    const p = this.player, f = this.holes[FriendIdx];
    const a = p.score, b = f.score;
    const won = this.forfeit || a > b, draw = !this.forfeit && a === b;
    const prize = won ? OnlinePrize : draw ? 15 : 5;
    this.coinsRun = prize;
    this.Coins += prize;
    if (won) this.Data.add("onlineWins", 1);
    this.Data.add("onlineGames", 1);
    this.overlay.showBar(false);
    const list = this.Ranking();
    const rank = Math.max(1, list.indexOf(p) + 1);
    Sfx.play(won ? Snd.Win : Snd.Lose);
    if (won) this.fx.confetti(new V2(this.camX, this.camY + this.ViewSize.y * 0.3), 50, 12, [Gold, HostColor, GuestColor, Pal.Good, Pal.Cyan]);
    this.Finish(new Result({
      Headline: this.forfeit ? "FRIEND LEFT · YOU WIN!" : won ? "YOU WIN!" : draw ? "IT'S A DRAW" : "FRIEND WINS",
      HeadlineColor: won ? Gold : draw ? Color.white : f.color,
      Victory: won,
      Value: `${Fmt.n(a)} – ${Fmt.n(b)}`,
      BestLine: `YOU ${Fmt.n(a)} · FRIEND ${Fmt.n(b)}   ·   +${prize} COINS`,
      Stats: [
        ["YOUR SCORE", Fmt.n(a)],
        ["FRIEND'S SCORE", Fmt.n(b)],
        ["RANK IN TOWN", `#${rank} of ${list.length}`],
        ["ONLINE WINS", String(this.Data.get("onlineWins"))],
      ],
      Primary: this.link ? "REMATCH" : "NEW TABLE",
      Reward: won ? () => this.DoubleCoins() : null,
      RewardLabel: `DOUBLE COINS +${prize} (AD)`,
    }));
  }

  // ------------------------------------------------------------------ end of round

  private StartEnding() {
    this.ending = 2.6;
    for (const h of this.holes) { h.wantX = h.wantY = 0; h.vx = h.vy = 0; }
    this.respawnPanel.setActive(false);
    Sfx.play(Snd.Whoosh, 0.8);
    if (this.mode === Mode.Solo) {
      this.UI.Announce("TIME'S UP!", Gold, 2);
      return;
    }
    // final standings card
    const list = this.Ranking();
    this.finalTitle.text = this.forfeit ? "YOUR FRIEND LEFT" : this.timeLeft <= 0 || this.net > 0 ? "TIME'S UP!" : "LAST HOLE STANDING!";
    const gap = list.length > 7 ? 51 : 58;
    for (let i = 0; i < this.finalRows.length; i++) {
      const row = this.finalRows[i];
      row.rectTransform.anchoredPosition = new V2(10, 150 - i * gap);
      if (i >= list.length) { row.text = ""; continue; }
      const h = list[i];
      row.text = `${i === 0 ? "♛" : (i + 1) + "."}  ${h.player ? "YOU" : h.name}   <color=#ffffffaa>${Fmt.n(h.score)}</color>`;
      row.color = h.player ? (this.net > 0 ? Color.lerp(h.color, Color.white, 0.25) : Gold) : Color.lerp(h.color, Color.white, 0.4);
    }
    this.finalPanel.node.setActive(true);
    this.finalPanel.alpha = 1;
    this.startCoroutine(this.PopFinal());
  }

  private *PopFinal() {
    let t = 0;
    while (t < 0.35) {
      t += Time.unscaledDeltaTime;
      const s = Mathf.lerp(0.6, 1, Ease.outBack(Mathf.clamp01(t / 0.35)));
      this.finalPanel.node.localScale = new V3(s, s, 1);
      yield;
    }
    this.finalPanel.node.localScale = V3.one;
  }

  private EndRound() {
    this.finished = true;
    this.finalPanel.node.setActive(false);
    this.respawnPanel.setActive(false);
    if (this.net > 0) { this.OnlineResult(); return; }
    const p = this.player;
    const list = this.Ranking();
    const rank = Math.max(1, list.indexOf(p) + 1), total = list.length;
    const solo = this.mode === Mode.Solo;
    const pct = this.CityPercent();
    const stars = solo ? (pct >= 45 ? 3 : pct >= 25 ? 2 : pct >= 12 ? 1 : 0) : rank === 1 ? 3 : rank === 2 ? 2 : rank === 3 ? 1 : 0;
    const eliminated = this.mode === Mode.Elimination && !p.alive;
    const rankBonus = [120, 70, 45, 30, 20, 15, 10];
    const coins = solo ? 10 + pct * 2 : Math.round(p.score / 25) + (eliminated ? 5 : rankBonus[Math.min(6, rank - 1)]);
    this.coinsRun = coins;
    this.Coins += coins;
    const newBest = this.Data.max("best", p.score) && !eliminated;
    if (!solo && rank === 1 && !eliminated) this.Data.add("wins", 1);
    if (solo) this.Data.max("bestClear", pct);
    Sfx.play(stars >= 2 ? Snd.Win : Snd.Lose);
    if (stars === 3) this.fx.confetti(new V2(this.camX, this.camY + this.ViewSize.y * 0.3), 50, 12, [Gold, Violet, Pal.Danger, Pal.Good, Pal.Cyan]);
    const top = list.slice(0, 3).map((h, i) => `${i + 1}. ${h.player ? "YOU" : h.name.toUpperCase()}`).join("   ");
    const headline = solo ? (pct >= 45 ? "CITY DEVOURED!" : pct >= 25 ? "WHAT AN APPETITE!" : pct >= 12 ? "TASTY!" : "STILL HUNGRY?")
      : eliminated ? `SWALLOWED! #${rank} OF ${total}`
        : rank === 1 ? "BIGGEST HOLE IN TOWN!" : rank <= 3 ? `#${rank} — SO CLOSE!` : `#${rank} OF ${total}`;
    const canRevive = eliminated && !this.revived;
    this.Finish(new Result({
      Headline: headline,
      HeadlineColor: stars >= 2 || (!eliminated && rank === 1) ? Gold : eliminated ? Pal.Danger : Color.white,
      Stars: stars,
      Value: Fmt.n(p.score),
      NewBest: newBest,
      BestLine: solo ? `CITY SWALLOWED: ${pct}%   ·   BEST ${this.Data.get("bestClear")}%` : top,
      Stats: [
        ["SCORE", Fmt.n(p.score)],
        solo ? ["CITY", pct + "%"] : ["RANK", `#${rank} of ${total}`],
        solo ? ["SIZE", String(p.level + 1)] : ["HOLES SWALLOWED", String(p.holesEaten)],
        ["COINS", "+" + Fmt.n(coins)],
      ],
      Primary: "PLAY AGAIN",
      Victory: stars >= 2,
      Reward: canRevive ? () => this.ReviveFull() : coins > 0 ? () => this.DoubleCoins() : null,
      RewardLabel: canRevive ? "RESPAWN AT FULL SIZE (AD)" : `DOUBLE COINS +${Fmt.n(coins)} (AD)`,
    }));
  }

  private DoubleCoins() {
    this.Coins += this.coinsRun;
    Sfx.play(Snd.Coin, 0.9, 1.15);
    this.UI.Toast(`+${Fmt.n(this.coinsRun)} bonus coins! You have ${Fmt.n(this.Coins)}.`, 2.5);
    this.coinsRun *= 2;
  }

  /** Elimination mode: the rewarded "continue" brings the player back at full size and the round carries on. */
  private ReviveFull() {
    const p = this.player;
    this.revived = true;
    this.finished = false;
    this.deathDelay = 0;
    this.Coins -= this.coinsRun; // the round isn't over: its coins are paid again at the real end
    p.out = false;
    p.outOrder = 0;
    this.outCounter = Math.max(0, this.outCounter - 1);
    this.RespawnPlayer(true);
    this.Revive();
    if (this.timeLeft <= 0.5) this.timeLeft = 15;
  }

  protected OnLayoutChanged() { /* culling reads ViewSize every frame */ }
}

function set(t: Text | null, s: string) { if (t && t.text !== s) t.text = s; }

/** Appends a timestamped sample to an entity's ring (oldest dropped); returns the new count. */
function pushRing(t: Float64Array, x: Float64Array, y: Float64Array, base: number, n: number, ts: number, xs: number, ys: number) {
  if (n > 0 && ts <= t[base + n - 1]) return n;
  if (n === RingN) {
    for (let k = 1; k < RingN; k++) { t[base + k - 1] = t[base + k]; x[base + k - 1] = x[base + k]; y[base + k - 1] = y[base + k]; }
    n--;
  }
  t[base + n] = ts; x[base + n] = xs; y[base + n] = ys;
  return n + 1;
}

/** Position at time rT from a ring: lerp between the samples around it, a short extrapolation past the newest,
 * and no lerp across a gap (an entity that left the streamed area and came back jumps instead of sliding). */
function sampleRing(t: Float64Array, x: Float64Array, y: Float64Array, base: number, n: number, rT: number, out: Float64Array) {
  if (n === 0) return false;
  const last = base + n - 1;
  if (rT >= t[last]) {
    const span = n > 1 ? t[last] - t[last - 1] : 1;
    if (n > 1 && span < 0.35) {
      const k = Math.min(rT - t[last], 0.1) / span;
      out[0] = x[last] + (x[last] - x[last - 1]) * k; out[1] = y[last] + (y[last] - y[last - 1]) * k;
    } else { out[0] = x[last]; out[1] = y[last]; }
    return true;
  }
  for (let k = n - 1; k > 0; k--) {
    const a = base + k - 1, b = base + k;
    if (rT < t[a]) continue;
    if (t[b] - t[a] > 0.35) { out[0] = x[b]; out[1] = y[b]; }
    else { const f = (rT - t[a]) / (t[b] - t[a]); out[0] = x[a] + (x[b] - x[a]) * f; out[1] = y[a] + (y[b] - y[a]) * f; }
    return true;
  }
  out[0] = x[base]; out[1] = y[base];
  return true;
}
