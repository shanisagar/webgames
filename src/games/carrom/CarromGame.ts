import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject,
  howTo, Image, Keyboard, LineRenderer, Mathf, OnlineLink, OnlineRoom, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer,
  tableCodeFromUrl, TableLobby, TableOverlay, TapPointer, Text, TextAnchor, Time, TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import {
  AimIcon, BoardHalf, BoardShadow, BoardSprite, CoinIcon, CoinSprite, EmptySlot, GlowRing, GoldSprite, RailSprite, RingSprite,
  RoomSprite, StrikerSprite, Themes,
} from "./CarromArt";
import {
  BaseHalf, BaseY, CarromEvent, CarromSim, castDisc, colourOf, Ev, MaxSpeed, N, Pockets, Queen, RC, Rng, RS, Striker,
} from "./CarromPhysics";
import { AiLevels, Board, CarromAI, Classic, Freestyle, Outcome, Points, ShotPlan } from "./CarromRules";

/**
 * CARROM FLICK: top-down carrom. Slide the striker along your baseline (the rail under the board), pull back
 * anywhere to aim and set the power, let go to flick. CLASSIC: pocket your colour (white or black), pocket the red
 * queen and cover it with one of yours; a pocketed striker costs a coin. FREESTYLE: two-minute rounds where every coin
 * scores (white 20, black 10, queen 50). SOLO: clear the board in as few strikes as you can (or a two-minute points
 * attack), VS CPU (three levels; the CPU simulates its candidate shots) or 2 PLAYERS on one device from opposite
 * sides. AIM+ shows long guide lines with the coin's path (charges, coins or a rewarded ad).
 */

const Gold = Pal.hex(0xffc93c), Cream = Pal.hex(0xfff3d6), Ink = Pal.hex(0x140c08), Red = Pal.hex(0xff5a4e);
const Teal = Pal.hex(0x2ee6b8), Blue = Pal.hex(0x4fa3ff), Orange = Pal.hex(0xff9d3c);
const PlayerColors = [Orange, Blue];
const ModeNames = ["SOLO", "VS CPU", "2 PLAYERS", "ONLINE"];
const Online = 3;
const OnlinePrize = 80;
/** Online (private table) payloads. Host = player 0 (white, bottom), guest = player 1 (black; sees its own side at the bottom). */
interface OStart { rules: number; seed: number; first: number }
/** A shot: striker x on the shooter's baseline, direction and speed (rounded so both devices simulate the same input). */
interface OMove { x: number; dx: number; dy: number; sp: number }
interface OOut { foul: boolean; reason: string; qc: boolean; qr: boolean; q: boolean; text: string; potted: number; cont: boolean; ret: number[] }
/** The settled board after each shot (host → guest). */
interface OSnap {
  rules: number; seed: number; first: number; n: number;
  d: number[]; // per disc: on, x, y, ang (x/y/ang rounded)
  b: { turn: number; qs: number; qb: number; due: number[]; score: number[]; pots: number[]; fouls: number[]; strikes: number; over: boolean; winner: number; reason: string; brk: boolean };
  clock: number; timeUp: boolean; lastX: number[]; out: OOut | null; rolling: boolean;
}
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const RuleNames = ["CLASSIC", "FREESTYLE"];
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const CpuNames = ["RAVI", "MEERA", "ARJUN"];
const Prizes = [60, 120, 250];
const RoundTime = 120;
const SoloStrikes = 30;
const StartingAims = 3;
const AimCost = 100;
const BaseGuide = 3.2, ProGuide = 14;
const RailY = BoardHalf + 1.15, RailLen = 2 * BaseHalf + 2 * RS + 0.8;
const ContentHalfH = RailY + 0.9, ContentHalfW = BoardHalf + 0.2;

enum Step { Aim, Rolling, Settle, CpuThink, CpuPlace, CpuAim, Wait, Remote }
enum Drag { None, Slide, Pull, Key }

class DiscView {
  root!: GameObject; shadow!: SpriteRenderer; body!: SpriteRenderer; glow: SpriteRenderer | null = null;
  dropT = -1; fromX = 0; fromY = 0; toX = 0; toY = 0; pop = 0;
  constructor(readonly n: number) {}
}

interface Card { root: UINode; glow: Image; name: Text; sub: Text; icon: Image; tray: Image[]; score: Text }

const hashNoise = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };

export class CarromGame extends ArcadeGame {
  private world!: GameObject; private table!: GameObject;
  private bgCover!: SpriteRenderer; private boardSr!: SpriteRenderer; private lamp!: SpriteRenderer;
  private views: DiscView[] = [];
  private rails: { sr: SpriteRenderer; knob: SpriteRenderer; ring: SpriteRenderer }[] = [];
  private aimLine!: LineRenderer; private coinLine!: LineRenderer; private deflLine!: LineRenderer; private bounceLine!: LineRenderer;
  private pullLine!: LineRenderer; private ghost!: SpriteRenderer; private pocketGlow!: SpriteRenderer;
  private fx!: CasualFx; private fxWorld!: CasualFx;
  private pointer = new TapPointer();

  private sim = new CarromSim();
  private board = new Board(Classic, 2);
  private ai: CarromAI | null = null;
  private rng = new Rng(1);
  private step = Step.Wait;
  private timer = 0;
  private tableScale = 1;
  private portrait = true;

  // settings for the current match
  private mode = 1; private rules = Classic; private diff = 1;
  // aiming
  private aim = new V2(0, 1);
  private power = 0;
  private drag = Drag.None;
  private dragStart = V2.zero;
  private lastX = [0, 0];
  private proShot = false; private proMatch = false;
  // cpu
  private plan: ShotPlan | null = null;
  private planGen: Generator<void, ShotPlan, void> | null = null;
  private cpuFromX = 0; private cpuAimFrom = V2.zero; private cpuPower = 0;
  // match
  private clock = RoundTime;
  private timeUp = false;
  private penalties = 0; private strikeLimit = SoloStrikes;
  private revived = false;
  private soundsThisFrame = 0;
  private attractT = 0; private attractShots = 0;
  private cueFlash = 0;
  private lineK = 1;

  // HUD
  private cards: Card[] = [];
  private infoText!: Text; private turnText!: Text; private powerText!: Text;
  private aimButton!: ArcadeButton;
  private coinWallet!: Text;
  private modeButton: ArcadeButton | null = null; private rulesButton!: ArcadeButton; private diffButton!: ArcadeButton; private modeLabel!: Text;

  // online
  private lobby!: TableLobby; private overlay!: TableOverlay;
  private link: OnlineLink<OStart, OMove, OSnap> | null = null;
  private me = 0; private onlineStart: OStart = { rules: 0, seed: 1, first: 0 }; private onlineGo = false; private autoJoined = false;
  private forfeit = false; private shotN = 0; private pendingSnap: OSnap | null = null; private waitT = 0; private ended = false;
  private ease: { x: number; y: number }[] = [];
  private lastPrize = 0;

  private clack: AudioClip[] = []; private thud!: AudioClip; private dropClip!: AudioClip; private strikeClip!: AudioClip; private rackClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "carrom",
      Title: "CARROM FLICK",
      Tagline: "FLICK THE STRIKER. POCKET YOUR COINS.",
      PlayLabel: "PLAY",
      Accent: Orange,
      Accent2: Gold,
      BgTop: Pal.hex(0x3a2016),
      BgBottom: Pal.hex(0x120806),
      ShortSide: 26,
      Touch: TouchScheme.None,
      Music: { bpm: 96, rootHz: 146.83, degrees: [0, 4, 7, 5], seed: 44, energy: 0.25, major: true },
      Reminders: [
        "The board is powdered|Flick a quick game of carrom.",
        "Pocket the queen|Cover it with your coin for the bonus.",
        "Beat ARJUN on HARD|The best carrom player in town.",
      ],
      HowTo: [
        howTo(Art.Square, Gold, "SLIDE the striker along your baseline: drag on the rail under the board."),
        howTo(Art.Chevron, Orange, "PULL BACK anywhere and let go to flick. Further pull = more power."),
        howTo(CoinSprite(0), Color.white, "CLASSIC: pocket all your coins (white or black). Pot one and you strike again."),
        howTo(CoinSprite(2), Color.white, "QUEEN: pocket it, then cover it by pocketing one of yours on the same or next strike."),
        howTo(Art.Ring, Red, "FOUL: a pocketed striker returns one of your coins to the centre."),
        howTo(Art.Star, Gold, "FREESTYLE: 2 minutes, every coin scores. White 20, black 10, queen 50."),
        howTo(AimIcon(), Teal, "AIM+ shows the long guide and where the coin goes."),
      ],
      Tips: [
        "Thin cuts send the coin sideways: aim at the coin's edge.",
        "The heavy striker follows through: soft shots keep it on the board.",
        "Slide the striker so the coin, pocket and striker line up.",
        "Bank off the side frame to reach coins behind others.",
        "Don't pocket your last coin before the queen is covered!",
      ],
    });
  }

  private get Coins() { return this.Data.get("coins", 200); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }
  private get Aims() { return this.Data.get("aims", StartingAims); }
  private set Aims(v: number) { this.Data.set("aims", Math.max(0, v)); }
  private get Theme() { return Themes[Mathf.clamp(this.Data.get("theme", 0), 0, Themes.length - 1)]; }
  protected BestLine() { return `COINS ${Fmt.n(this.Coins)}   ·   STREAK ${this.Data.get("streak")}`; }
  protected StatsLine() {
    const bs = this.Data.get("bestStrikes"), bp = this.Data.get("bestPoints");
    return `${this.Data.get("wins")} WINS   ·   BEST CLEAR ${bs > 0 ? bs + " STRIKES" : "—"}   ·   BEST 2-MIN ${bp}`;
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Coins = 200; this.Aims = StartingAims; this.Data.set("mode", 1); this.Data.set("diff", 1); }
    CasualLook.calm(this, 1.25, 0.26);
    this.world = new GameObject("CarromWorld", this.gameObject);
    this.bgCover = CasualLook.cover(this.world, RoomSprite(this.Theme), -910);
    this.lamp = Art.spr(this.world, "Lamp", CasualArt.Soft, Pal.hex(0xffe0b0).withAlpha(0.12), 1, -880, Art.Additive);
    this.table = new GameObject("Board", this.world);
    const t = this.table;
    const shadow = Art.spr(t, "Shadow", BoardShadow(), Color.white, BoardHalf * 2 * 1.3, -60, Art.Flat);
    shadow.transform.localPosition = new V3(0.35, -0.6, 0);
    this.boardSr = Art.spr(t, "BoardArt", BoardSprite(this.Theme), Color.white, BoardHalf * 2, 0, Art.Flat);
    for (let k = 0; k < 2; k++) {
      const sr = Art.spr(t, "Rail" + k, RailSprite(), Color.white, 1, 2, Art.Flat);
      sr.transform.localScale = new V3(RailLen, RailLen, 1);
      sr.transform.localPosition = new V3(0, k === 0 ? -RailY : RailY, 0);
      const ring = Art.spr(t, "KnobGlow", GlowRing(), PlayerColors[k].withAlpha(0.6), RS * 3.4, 3, Art.Additive);
      const knob = Art.spr(t, "Knob", StrikerSprite(), Color.white, RS * 2.1, 4, Art.Flat);
      this.rails.push({ sr, knob, ring });
    }
    this.pocketGlow = Art.spr(t, "PocketGlow", GlowRing(), Gold.withAlpha(0), 2.4, 5, Art.Additive);
    this.aimLine = Art.line(t, "Aim", new Color(1, 1, 1, 0.85), 0.09, 15, false, false, Art.Flat);
    this.coinLine = Art.line(t, "CoinLine", new Color(1, 1, 1, 0.85), 0.09, 15, false, false, Art.Flat);
    this.deflLine = Art.line(t, "Defl", new Color(1, 1, 1, 0.45), 0.07, 15, false, false, Art.Flat);
    this.bounceLine = Art.line(t, "Bounce", new Color(1, 1, 1, 0.45), 0.07, 15, false, false, Art.Flat);
    this.pullLine = Art.line(t, "Pull", Orange, 0.22, 16, false, false, Art.Flat);
    this.ghost = Art.spr(t, "Ghost", RingSprite(), Color.white, RS * 2.05, 24, Art.Flat);
    for (let n = 0; n < N; n++) this.views.push(this.MakeDisc(n));
    this.fx = CasualFx.create(t, 40, 160);
    this.fxWorld = CasualFx.create(this.world, 260, 120);
    this.BuildHud();
    this.BuildTitleExtras();
    this.BuildSounds();
    this.sim.rack(7);
    this.ResetViews();
    this.Layout();
    this.BuildOnline();
    // dev only: lets the scripted tests plan shots with the CPU's brain
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__carromAI = { CarromAI, Rng };
  }

  private MakeDisc(n: number) {
    const v = new DiscView(n);
    v.root = new GameObject("Disc" + n, this.table);
    const r = n === Striker ? RS : RC;
    if (n === Striker) v.glow = Art.spr(v.root, "Glow", GlowRing(), Orange.withAlpha(0.7), r * 3.6, 9, Art.Additive);
    v.shadow = Art.spr(v.root, "Shadow", CasualArt.Soft, new Color(0, 0, 0, 0.45), r * 2.6, 10, Art.Flat);
    v.body = Art.spr(v.root, "Body", n === Striker ? StrikerSprite() : CoinSprite(colourOf(n)), Color.white, r * 2 / 0.95, 20, Art.Flat);
    return v;
  }

  private BuildSounds() {
    for (let k = 0; k < 3; k++) {
      const f1 = 1650 + k * 260, f2 = 3100 + k * 340;
      this.clack.push(Sfx.make("cr-clack" + k, 0.08, (t) => (Sfx.sinP(f1 * t) * 0.5 + Sfx.sinP(f2 * t) * 0.25 + hashNoise(Math.trunc(t * 44100) + k * 777) * 0.45 * Sfx.env(t, 0, 0.004)) * Sfx.env(t, 0.0004, 0.024) * 0.7));
    }
    this.thud = Sfx.make("cr-thud", 0.2, (t) => (Sfx.sinP(Sfx.glide(t, 240, 150, 0.06)) * 0.75 + Sfx.sinP(520 * t) * 0.2 * Sfx.env(t, 0, 0.03) + hashNoise(Math.trunc(t * 44100) + 9) * 0.35 * Sfx.env(t, 0, 0.012)) * Sfx.env(t, 0.002, 0.09) * 0.65);
    this.dropClip = Sfx.make("cr-drop", 0.42, (t) => {
      let v = Sfx.sinP(Sfx.glide(t, 170, 80, 0.12)) * Sfx.env(t, 0.003, 0.14) * 0.75;
      v += hashNoise(Math.trunc(t * 44100) + 31) * Sfx.env(t, 0.004, 0.05) * 0.18;
      v += Sfx.sinP(900 * (t - 0.07)) * Sfx.env(t - 0.07, 0.001, 0.03) * 0.12;
      return v * 0.85;
    });
    this.strikeClip = Sfx.make("cr-strike", 0.1, (t) => (Sfx.sinP(Sfx.glide(t, 1300, 700, 0.03)) * 0.55 + Sfx.sinP(310 * t) * 0.35 * Sfx.env(t, 0, 0.05) + hashNoise(Math.trunc(t * 44100) + 3) * 0.55 * Sfx.env(t, 0, 0.006)) * Sfx.env(t, 0.0004, 0.035) * 0.8);
    this.rackClip = Sfx.make("cr-rack", 0.55, (t) => {
      let v = 0;
      for (let i = 0; i < 10; i++) { const d = i * 0.042 + (i % 3) * 0.007; v += Sfx.sinP((1800 + (i % 4) * 260) * (t - d)) * Sfx.env(t - d, 0.0004, 0.02) * (0.5 - i * 0.03); }
      return v * 0.6;
    });
  }

  // ------------------------------------------------------------------ HUD

  private BuildHud() {
    const hud = this.UI.Hud;
    for (let i = 0; i < 2; i++) this.cards.push(this.MakeCard(hud, i));
    this.infoText = UIKit.at(UIKit.label(hud, "", 30, Cream), new V2(0.5, 1), new V2(0, -60), new V2(620, 44));
    UIKit.glow(this.infoText, Ink, 3);
    this.turnText = UIKit.at(UIKit.label(hud, "", 40, Color.white), new V2(0.5, 1), new V2(0, -110), new V2(700, 56));
    UIKit.glow(this.turnText, Ink, 4);
    CasualLook.fit(this.turnText, 24);
    this.powerText = UIKit.at(UIKit.label(hud, "", 34, Color.white), UIKit.Center, V2.zero, new V2(200, 50));
    UIKit.glow(this.powerText, Ink, 4);
    this.aimButton = UIKit.buttonAt(hud, "AIM+", UIKit.Center, V2.zero, new V2(300, 104), false, () => this.OnAimPlus(), 30, AimIcon());
    this.aimButton.setAccent(Teal);
    const wallet = UIKit.node("Wallet", hud).place(new V2(0, 0), new V2(160, 60), new V2(260, 70));
    UIKit.img(wallet, "Bg", Art.UiRound, new Color(0, 0, 0, 0.45)).rectTransform.stretch();
    UIKit.img(wallet, "Coin", GoldSprite(), Color.white).rectTransform.place(new V2(0, 0.5), new V2(38, 0), new V2(48, 48));
    this.coinWallet = UIKit.at(UIKit.label(wallet, "", 32, Gold, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(150, 0), new V2(170, 50));
    this.walletNode = wallet;
  }
  private walletNode!: UINode;

  private MakeCard(hud: UINode, i: number): Card {
    const root = UIKit.node("Card" + i, hud).place(new V2(0, 1), new V2(250, -92), new V2(430, 150));
    const glow = UIKit.img(root, "Glow", Art.Glow, PlayerColors[i].withAlpha(0));
    glow.rectTransform.stretch(-60);
    UIKit.img(root, "Bg", Art.UiRound, new Color(0.07, 0.04, 0.03, 0.84)).rectTransform.stretch();
    UIKit.img(root, "Edge", Art.UiOutline, PlayerColors[i].withAlpha(0.45)).rectTransform.stretch();
    const icon = UIKit.img(root, "Icon", CoinIcon(i), Color.white);
    icon.rectTransform.place(new V2(0, 0.5), new V2(62, 10), new V2(84, 84));
    const name = UIKit.at(UIKit.label(root, "", 32, Color.white, TextAnchor.MiddleLeft), new V2(0, 1), new V2(240, -34), new V2(240, 44));
    CasualLook.fit(name, 20);
    const sub = UIKit.at(UIKit.label(root, "", 22, Cream, TextAnchor.MiddleLeft), new V2(0, 0), new V2(62 + 70, 24), new V2(140, 30));
    const score = UIKit.at(UIKit.label(root, "", 40, Gold, TextAnchor.MiddleRight), new V2(1, 1), new V2(-70, -34), new V2(120, 50));
    const tray: Image[] = [];
    for (let k = 0; k < 9; k++) {
      const im = UIKit.img(root, "Tray", EmptySlot(), Color.white);
      im.rectTransform.place(new V2(0, 0), new V2(130 + k * 31, 56), new V2(30, 30));
      tray.push(im);
    }
    return { root, glow, name, sub, icon, tray, score };
  }

  private BuildTitleExtras() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    this.modeButton = UIKit.buttonAt(ex, "VS CPU", UIKit.Center, new V2(-330, 10), new V2(310, 104), false, () => this.CycleSetting("mode", 4), 30);
    this.rulesButton = UIKit.buttonAt(ex, "CLASSIC", UIKit.Center, new V2(0, 10), new V2(310, 104), false, () => this.CycleSetting("rules", 2), 30);
    this.diffButton = UIKit.buttonAt(ex, "MEDIUM", UIKit.Center, new V2(330, 10), new V2(310, 104), false, () => this.CycleSetting("diff", 3), 30);
    this.modeButton.setAccent(Orange);
    this.rulesButton.setAccent(Gold);
    this.diffButton.setAccent(Teal);
    this.modeLabel = UIKit.at(UIKit.label(ex, "", 25, new Color(1, 1, 1, 0.85)), UIKit.Center, new V2(0, -68), new V2(980, 36));
    CasualLook.fit(this.modeLabel, 16);
    CasualLook.titleCard(this.UI, new Color(0.06, 0.03, 0.02, 0.62), new V2(1060, 1060), -10);
  }

  private get SelMode() { return Mathf.clamp(this.Data.get("mode", 1), 0, 3); }

  private CycleSetting(key: string, n: number) {
    this.Data.set(key, (this.Data.get(key) + 1) % n);
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
  }

  private RefreshTitle() {
    if (!this.modeButton) return;
    const m = this.SelMode, r = Mathf.clamp(this.Data.get("rules"), 0, 1), d = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    if (this.modeButton.label) this.modeButton.label.text = ModeNames[m];
    if (this.rulesButton.label) this.rulesButton.label.text = RuleNames[r];
    if (this.diffButton.label) this.diffButton.label.text = m === 1 ? DiffNames[d] : "—";
    this.diffButton.interactable = m === 1;
    this.modeLabel.text = m === 0
      ? (r === Classic ? `CLEAR ALL 19 COINS IN ${SoloStrikes} STRIKES OR LESS` : "2 MINUTES: WHITE 20 · BLACK 10 · QUEEN 50")
      : m === 1 ? `BEAT ${CpuNames[d]} (${DiffNames[d]}) AND WIN ${Prizes[d]} COINS`
        : m === Online ? `PLAY A FRIEND ON THEIR OWN PHONE · WIN ${OnlinePrize} COINS`
          : "TWO PLAYERS, OPPOSITE SIDES OF THE PHONE";
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); this.layoutFrames = 2; }
  private layoutFrames = 3;

  private Layout() {
    if (!this.table) return;
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    this.portrait = Screen.height > Screen.width;
    const upu = Math.min(this.ViewSize.x, this.ViewSize.y) / 1080;
    let cx: number, cy: number;
    if (this.portrait) {
      const r = this.PlayRect(300, 200, 0.1);
      this.tableScale = Math.min((r.xMax - r.xMin) / (ContentHalfW * 2), (r.yMax - r.yMin) / (ContentHalfH * 2));
      cx = (r.xMin + r.xMax) / 2; cy = (r.yMin + r.yMax) / 2;
    } else {
      const r = this.PlayRect(30, 30, 0.1);
      const side = 470 * upu;
      this.tableScale = Math.min((r.xMax - r.xMin - side * 2) / (ContentHalfW * 2), (r.yMax - r.yMin) / (ContentHalfH * 2));
      cx = (r.xMin + r.xMax) / 2; cy = (r.yMin + r.yMax) / 2;
    }
    this.table.localPosition = new V3(cx, cy, 0);
    this.table.localScale = new V3(this.tableScale, this.tableScale, 1);
    // online guest: the board turns so their own baseline is at the bottom
    this.rot = this.mode === Online && this.me === 1;
    this.table.localEulerZ = this.rot ? 180 : 0;
    // LineRenderer widths are world units even in local space: scale the guide lines with the board (kit gap)
    this.lineK = this.tableScale;
    this.aimLine.widthMultiplier = 0.09 * this.lineK; this.coinLine.widthMultiplier = 0.09 * this.lineK;
    this.deflLine.widthMultiplier = 0.07 * this.lineK; this.bounceLine.widthMultiplier = 0.07 * this.lineK;
    this.lamp.transform.localPosition = new V3(cx, cy, 0);
    this.lamp.transform.localScale = V3.one.mul(BoardHalf * 2 * this.tableScale * 1.6);
    const toHud = (x: number, y: number) => this.UI.WorldToHud(new V2(cx + x * this.tableScale, cy + y * this.tableScale));
    const flip = this.portrait && this.mode === 2;
    if (this.portrait) {
      const cw = 440;
      this.cards[this.Seat(0)].root.place(new V2(0, 1), new V2(15 + cw / 2, -88), new V2(cw, 146));
      this.cards[this.Seat(1)].root.place(new V2(1, 1), new V2(-150 - cw / 2 + 20, -88), new V2(cw, 146));
      this.infoText.rectTransform.place(new V2(0.5, 1), new V2(0, -190), new V2(700, 40));
      this.turnText.rectTransform.place(new V2(0.5, 1), new V2(0, -240), new V2(760, 56));
      const by = toHud(0, -ContentHalfH);
      this.aimButton.node.place(UIKit.Center, new V2(170, by.y - 90), new V2(300, 104));
      this.walletNode.place(UIKit.Center, new V2(-170, by.y - 90), new V2(260, 76));
    } else {
      const cw = 420;
      const left = toHud(-ContentHalfW, 0).x - 30 - cw / 2;
      const right = toHud(ContentHalfW, 0).x + 30 + cw / 2;
      this.cards[this.Seat(1)].root.place(UIKit.Center, new V2(left, toHud(0, BoardHalf).y - 75), new V2(cw, 146));
      this.cards[this.Seat(0)].root.place(UIKit.Center, new V2(left, toHud(0, -BoardHalf).y + 75), new V2(cw, 146));
      this.infoText.rectTransform.place(UIKit.Center, new V2(right, 60), new V2(440, 40));
      this.turnText.rectTransform.place(UIKit.Center, new V2(right, 0), new V2(440, 56));
      this.aimButton.node.place(UIKit.Center, new V2(right, toHud(0, -BoardHalf).y + 60), new V2(300, 104));
      this.walletNode.place(UIKit.Center, new V2(right, toHud(0, -BoardHalf).y + 190), new V2(260, 76));
    }
    this.cards[1].root.localEulerAngles = new V3(0, 0, flip ? 180 : 0);
    if (this.overlay && this.portrait) this.overlay.place({ anchor: new V2(0.5, 0), pos: new V2(0, 70) }, { anchor: new V2(0.5, 1), pos: new V2(0, -330) });
    else if (this.overlay) this.overlay.place({ anchor: new V2(1, 0), pos: new V2(-270, 300) }, { anchor: new V2(0, 0.5), pos: new V2(260, 0) });
    this.Present(0);
  }

  /** HUD slot of player i's card: online, my card takes player 1's usual (bottom / left) slot. */
  private Seat(i: number) { return this.mode === Online && this.me === 1 ? 1 - i : i; }
  private rot = false;

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.LeaveTable();
    this.ended = false;
    this.ApplyTheme();
    this.sim.rack(Math.floor(Math.random() * 1e9));
    this.sim.events = null;
    this.ResetViews();
    this.attractT = 1.2;
    this.attractShots = 0;
    this.HideGuide();
    this.mode = 1;
    this.me = 0;
    this.Layout();
    this.RefreshTitle();
    // an invite link (?table=12345) opens the join panel and joins straight away
    const code = tableCodeFromUrl();
    if (code && !this.autoJoined) {
      this.autoJoined = true;
      this.Data.set("mode", Online);
      this.RefreshTitle();
      this.lobby.open("join", code);
    }
  }

  private ApplyTheme() {
    const th = this.Theme;
    this.boardSr.sprite = BoardSprite(th);
    this.bgCover.sprite = CasualArt.hd(RoomSprite(th));
  }

  protected BeginRun() {
    this.mode = this.SelMode;
    this.rules = Mathf.clamp(this.Data.get("rules"), 0, 1);
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.Data.add("games", 1);
    this.ended = false; this.forfeit = false; this.pendingSnap = null; this.shotN = 0; this.waitT = 0;
    if (this.mode === Online) { this.me = this.link ? this.link.me : 0; this.rules = this.onlineStart.rules; this.proMatch = false; }
    else this.me = 0;
    this.board = new Board(this.rules, this.mode === 0 ? 1 : 2);
    this.ai = this.mode === 1 ? new CarromAI(AiLevels[this.diff], new Rng((Date.now() & 0xffffff) + this.diff * 7919)) : null;
    this.rng = new Rng(Date.now() & 0xfffffff);
    this.sim.rack(this.mode === Online ? this.onlineStart.seed : this.rng.int(1e9));
    if (this.mode === Online) this.board.turn = this.onlineStart.first;
    this.sim.events = [];
    this.ResetViews();
    this.clock = RoundTime;
    this.timeUp = false;
    this.penalties = 0;
    this.strikeLimit = SoloStrikes;
    this.revived = false;
    this.lastX = [0, 0];
    this.pointer.reset();
    this.pointer.topBand = 0.05;
    const names = this.Names();
    for (let i = 0; i < 2; i++) {
      this.cards[i].name.text = names[i];
      this.cards[i].root.setActive(i === 0 || this.mode !== 0);
      this.cards[i].icon.sprite = this.board.colourOf(i) < 0 ? CoinIcon(i === 0 ? 2 : 1) : CoinIcon(i);
      this.cards[i].root.localEulerAngles = V3.zero;
      this.views[Striker].glow!.color = PlayerColors[0].withAlpha(0.7);
    }
    Sfx.playClip(this.rackClip, 0.6);
    Sfx.setIntensity(0.15);
    this.layoutFrames = 2;
    this.Layout();
    const title = this.mode === 0 ? (this.rules === Classic ? `CLEAR THE BOARD · ${SoloStrikes} STRIKES` : "2-MINUTE POINTS RUSH")
      : this.mode === 1 ? `VS ${CpuNames[this.diff]} · ${RuleNames[this.rules]}`
        : this.mode === Online ? `${this.board.turn === this.me ? "YOU BREAK" : "FRIEND BREAKS"} · ${RuleNames[this.rules]}` : `2 PLAYERS · ${RuleNames[this.rules]}`;
    this.UI.Announce(title, Gold, 1.6);
    this.BeginTurn(true);
  }

  private Names() {
    if (this.mode === Online) return this.me === 0 ? ["YOU", "FRIEND"] : ["FRIEND", "YOU"];
    if (this.mode === 0) return ["YOU", ""];
    if (this.mode === 1) return ["YOU", CpuNames[this.diff]];
    return ["PLAYER 1", "PLAYER 2"];
  }

  private IsHuman(p: number) { return this.mode === Online ? p === this.me : this.mode !== 1 || p === 0; }

  protected OnPauseChanged(paused: boolean) { if (paused) { this.drag = Drag.None; this.power = 0; } }

  private BeginTurn(first = false) {
    const b = this.board, p = b.turn;
    this.power = 0;
    this.drag = Drag.None;
    this.proShot = false;
    this.plan = null;
    this.planGen = null;
    const x = this.sim.freeBaseX(p, this.lastX[p]);
    this.sim.place(Striker, x, p === 0 ? -BaseY : BaseY);
    this.views[Striker].pop = 1;
    this.views[Striker].glow!.color = PlayerColors[p].withAlpha(0.7);
    this.aim = new V2(0, p === 0 ? 1 : -1);
    if (this.mode === Online && p !== this.me) { this.UI.Hint(null); this.step = Step.Remote; this.timer = 0; }
    else if (this.IsHuman(p)) {
      this.step = Step.Aim;
      if (first && this.Data.get("games") <= 2) this.UI.Hint("Drag the rail to slide the striker. Pull back anywhere and let go to flick!");
      else if (this.mode === 2) this.UI.Announce(`${this.Names()[p]}`, PlayerColors[p], 0.9);
    } else {
      this.UI.Hint(null);
      this.step = Step.CpuThink;
      this.timer = 0;
    }
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame loop

  protected TickBackground(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    this.lobby.tick(Time.unscaledDeltaTime);
    this.overlay.tick();
    if (this.State === Phase.Title) {
      if (this.sim.moving) this.Simulate(dt, true);
      else {
        this.attractT -= dt;
        if (this.attractT <= 0) {
          if (this.attractShots >= 3 || Board.coinsLeft(this.sim) < 8) { this.sim.rack(Math.floor(Math.random() * 1e9)); this.ResetViews(); this.attractShots = 0; this.attractT = 1.2; }
          else {
            this.attractShots++;
            this.attractT = 2.6;
            const ai = new CarromAI(AiLevels[2], new Rng(Math.floor(Math.random() * 1e6)));
            const side = this.attractShots % 2 === 1 ? 0 : 1;
            let plan: ShotPlan;
            if (this.attractShots === 1) plan = ai.planBreak(this.sim, side);
            else {
              const b = new Board(Freestyle, 2);
              b.turn = side;
              const g = ai.plan(this.sim, b, side);
              let r = g.next(), k = 0;
              while (!r.done && k++ < 60) r = g.next();
              plan = r.done ? r.value : ai.planBreak(this.sim, side);
            }
            this.sim.place(Striker, this.sim.freeBaseX(side, plan.x), side === 0 ? -BaseY : BaseY);
            this.sim.shoot(plan.dx, plan.dy, plan.speed);
          }
        }
      }
    }
    this.Present(dt);
  }

  protected TickRun(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    this.overlay.tick();
    this.overlay.showBar(this.mode === Online && !this.ended);
    if (this.State === Phase.Paused || this.overlay.busy) this.pointer.reset(); else this.pointer.update(dt);
    this.soundsThisFrame = 0;
    this.timer += dt;
    if (this.rules === Freestyle && !this.timeUp && this.step !== Step.Wait) {
      this.clock -= dt;
      if (this.clock <= 10 && Math.ceil(this.clock) !== Math.ceil(this.clock + dt) && this.clock > 0) Sfx.play(Snd.Tick, 0.6, 1.2);
      // online the host's clock is the reference: the guest waits for the host's final board
      if (this.clock <= 0 && !(this.mode === Online && this.me === 1)) { this.clock = 0; this.timeUp = true; if (this.step === Step.Aim || this.step === Step.CpuThink || this.step === Step.CpuPlace || this.step === Step.CpuAim || this.step === Step.Remote) this.EndMatch(); }
      if (this.clock < 0) this.clock = 0;
    }
    switch (this.step) {
      case Step.Aim: this.PlayerAim(dt); break;
      case Step.Rolling:
        this.Simulate(dt, false);
        if (!this.sim.moving) { this.step = Step.Settle; this.timer = 0; }
        break;
      case Step.Settle:
        if (this.timer > 0.3) this.Resolve();
        break;
      case Step.CpuThink: this.CpuThink(); break;
      case Step.CpuPlace: this.CpuPlaceTick(); break;
      case Step.CpuAim: this.CpuAimTick(); break;
      case Step.Wait:
        // online guest waiting for the host's settled board: ask again if it doesn't come
        if (this.mode === Online && this.me === 1 && !this.ended) { this.waitT += Time.unscaledDeltaTime; if (this.waitT > 5) { this.waitT = 0; this.link?.room.send({ t: "sync?" }); } }
        break;
      case Step.Remote: this.HideGuide(); break;
    }
    if (this.rules === Freestyle) this.UpdateClock();
    this.Present(dt);
  }

  // ------------------------------------------------------------------ player input

  private ScreenToTable(screen: V2) {
    const w = this.ScreenToWorld(screen);
    const lp = this.table.localPosition;
    const k = this.rot ? -1 : 1;
    return new V2(k * (w.x - lp.x) / this.tableScale, k * (w.y - lp.y) / this.tableScale);
  }

  private TableToWorld(p: V2) {
    const lp = this.table.localPosition;
    const k = this.rot ? -1 : 1;
    return new V2(lp.x + k * p.x * this.tableScale, lp.y + k * p.y * this.tableScale);
  }

  private PlayerAim(dt: number) {
    const p = this.pointer, me = this.board.turn;
    const by = me === 0 ? -BaseY : BaseY, railY = me === 0 ? -RailY : RailY;
    // keyboard: arrows slide, A/D turn, hold space for power
    const slide = (Keyboard.right.isPressed ? 1 : 0) - (Keyboard.left.isPressed ? 1 : 0);
    if (slide !== 0 && this.drag !== Drag.Pull) this.MoveStriker(this.sim.x[Striker] + slide * dt * 5 * (this.rot ? -1 : 1));
    const turn = (Keyboard.letter("a").isPressed ? 1 : 0) - (Keyboard.letter("d").isPressed ? 1 : 0);
    if (turn !== 0) this.RotateAim(turn * dt * (Keyboard.leftShift.isPressed ? 10 : 50));
    if (Keyboard.space.wasPressedThisFrame && this.drag === Drag.None) { this.drag = Drag.Key; this.power = 0; this.keyT = 0; }
    if (this.drag === Drag.Key) {
      this.keyT += dt;
      this.power = Mathf.pingPong(this.keyT / 1.3, 1);
      if (Keyboard.space.wasReleasedThisFrame || !Keyboard.space.isPressed) { this.drag = Drag.None; if (this.power > 0.03) { this.Strike(); return; } this.power = 0; }
    }

    if (p.down && this.drag !== Drag.Key) {
      const tp = this.ScreenToTable(p.screen);
      this.dragStart = tp;
      const onRail = Math.abs(tp.y - railY) < 1.6 && Math.abs(tp.x) < RailLen / 2 + 1.2;
      const onStrikerSide = Math.abs(tp.y - by) < RS * 1.4 && Math.abs(tp.x - this.sim.x[Striker]) > RS * 1.6 && Math.abs(tp.x) < BaseHalf + 0.6;
      this.drag = onRail || onStrikerSide ? Drag.Slide : Drag.Pull;
      if (this.drag === Drag.Slide) { this.MoveStriker(tp.x); this.UI.Hint(null); }
    }
    if (p.held) {
      const tp = this.ScreenToTable(p.screen);
      if (this.drag === Drag.Slide) this.MoveStriker(tp.x);
      else if (this.drag === Drag.Pull) {
        const v = this.dragStart.sub(tp);
        const l = v.magnitude;
        if (l > 0.35) { this.aim = v.div(l); this.power = Mathf.clamp01((l - 0.35) / 7); }
        else this.power = 0;
      }
    }
    if (p.up) {
      const was = this.drag;
      this.drag = Drag.None;
      if (was === Drag.Pull && this.power > 0.03) { this.Strike(); return; }
      if (was === Drag.Pull) this.power = 0;
    }
    this.ShowGuide(false);
  }

  private keyT = 0;

  private MoveStriker(x: number) {
    const me = this.board.turn;
    const nx = this.sim.freeBaseX(me, Mathf.clamp(x, -BaseHalf, BaseHalf));
    this.sim.place(Striker, nx, me === 0 ? -BaseY : BaseY);
    this.lastX[me] = nx;
  }

  private RotateAim(deg: number) {
    const a = Math.atan2(this.aim.y, this.aim.x) + (deg * Math.PI) / 180;
    this.aim = new V2(Math.cos(a), Math.sin(a));
  }

  private Strike(speed = -1, remote = false) {
    this.UI.Hint(null);
    let sp = speed >= 0 ? speed : MaxSpeed * (0.04 + 0.96 * Math.pow(this.power, 1.35));
    if (this.mode === Online && !remote) {
      // both devices simulate exactly this (rounded) input; the host's settled board is the reference
      const mv: OMove = { x: r4(this.sim.x[Striker]), dx: r4(this.aim.x), dy: r4(this.aim.y), sp: r4(sp) };
      this.sim.place(Striker, mv.x, this.sim.y[Striker]);
      this.aim = new V2(mv.dx, mv.dy); sp = mv.sp;
      this.link?.sendMove(mv);
    }
    this.sim.events = [];
    this.sim.shoot(this.aim.x, this.aim.y, sp);
    Sfx.playClip(this.strikeClip, 0.35 + 0.65 * Mathf.clamp01(sp / MaxSpeed), 0.95 + Math.random() * 0.1);
    Fx.haptic(sp > MaxSpeed * 0.7);
    if (sp > MaxSpeed * 0.75) this.Fx.shake(0.1);
    this.fx.pop(new V2(this.sim.x[Striker], this.sim.y[Striker]), Color.white.withAlpha(0.8), 6, 2.5, 0.16, 0.25);
    this.cueFlash = 1;
    this.HideGuide();
    this.power = 0;
    this.step = Step.Rolling;
    this.timer = 0;
  }

  // ------------------------------------------------------------------ simulation + events

  private Simulate(dt: number, quiet: boolean) {
    if (!this.sim.events) this.sim.events = [];
    this.sim.advance(dt);
    const evs = this.sim.events;
    for (const e of evs) this.OnEvent(e, quiet);
    evs.length = 0;
  }

  private OnEvent(e: CarromEvent, quiet: boolean) {
    const volK = quiet ? 0.22 : 1;
    if (e.type === Ev.Hit) {
      if (this.soundsThisFrame < 4) {
        this.soundsThisFrame++;
        const v = Mathf.clamp01(e.speed / 30);
        Sfx.playClip(this.clack[Math.floor(Math.random() * 3)], (0.1 + 0.9 * v) * volK, (e.a === Striker ? 0.85 : 1) + Math.random() * 0.15);
      }
      if (!quiet && e.speed > 18) {
        this.fx.sparkle(new V2(e.x, e.y), Color.white, 5, 0.5, 0.35);
        if (e.speed > 30) { this.Fx.shake(Mathf.clamp01((e.speed - 25) / 40) * 0.4); Fx.haptic(true); }
      }
    } else if (e.type === Ev.Wall) {
      if (e.speed > 1 && this.soundsThisFrame < 5) { this.soundsThisFrame++; Sfx.playClip(this.thud, Mathf.clamp01(e.speed / 35) * 0.9 * volK, 0.9 + Math.random() * 0.2); }
      if (!quiet && e.speed > 25) this.fx.pop(new V2(e.x, e.y), Pal.hex(0xffe6b0), 6, 2, 0.14, 0.3);
    } else if (e.type === Ev.Pocket) {
      const v = this.views[e.a];
      const [px, py] = Pockets[e.b];
      v.dropT = 0; v.fromX = e.x; v.fromY = e.y; v.toX = px; v.toY = py;
      Sfx.playClip(this.dropClip, (0.5 + 0.5 * Mathf.clamp01(e.speed / 20)) * volK, 0.95 + Math.random() * 0.1);
      if (!quiet) {
        const tp = new V2(px, py);
        if (e.a === Striker) { this.fx.pop(tp, Red, 12, 3, 0.2, 0.45); this.UI.Float(this.TableToWorld(tp), "FOUL!", Red, 0.9); }
        else {
          const c = colourOf(e.a);
          const good = this.board.colourOf(this.board.turn) < 0 || c === 2 || c === this.board.colourOf(this.board.turn);
          this.fx.pop(tp, c === 2 ? Red : c === 0 ? Cream : Pal.hex(0x8a7466), 16, 3.5, 0.22, 0.5);
          this.fx.sparkle(tp, Gold, 8, 0.9, 0.35);
          const txt = this.rules === Freestyle || this.mode === 0 ? `+${Points[c]}` : c === 2 ? "QUEEN!" : good ? "NICE!" : "OOPS";
          this.UI.Float(this.TableToWorld(tp), txt, c === 2 ? Pal.hex(0xff7a8a) : good ? Gold : Pal.hex(0xc0b0a0), c === 2 ? 1.1 : 0.85);
          if (c === 2) { this.Fx.shake(0.15); Fx.haptic(true); }
        }
        this.UpdateHud();
      }
    }
  }

  // ------------------------------------------------------------------ rules

  private Resolve() {
    const b = this.board, s = this.sim;
    if (this.mode === Online && this.me === 1) {
      // the guest never judges: it shows the host's settled board
      const snap = this.pendingSnap;
      this.pendingSnap = null;
      if (snap && snap.n > this.shotN) this.ApplySnap(snap);
      else { this.step = Step.Wait; this.waitT = 0; }
      return;
    }
    const me = b.turn;
    const rec = s.record;
    const o: Outcome = b.resolve(s, rec);
    for (const n of o.returned) { this.views[n].dropT = -1; this.views[n].pop = 1; this.fx.pop(new V2(s.x[n], s.y[n]), Gold, 10, 2, 0.18, 0.4); }
    if (this.mode === 0 && rec.strikerPotted && this.rules === Classic) this.penalties++;
    if (this.mode === Online) {
      this.shotN++;
      this.lastOut = { foul: o.foul, reason: o.foulReason, qc: o.queenCovered, qr: o.queenReturned, q: o.queen, text: o.text, potted: rec.potted.length, cont: o.continues, ret: o.returned };
      if (this.rules === Freestyle && this.timeUp && !b.over) b.timeUp();
    }
    this.AnnounceOutcome({ foul: o.foul, reason: o.foulReason, qc: o.queenCovered, qr: o.queenReturned, q: o.queen, text: o.text, potted: rec.potted.length, cont: o.continues, ret: o.returned });
    if (b.over || (this.rules === Freestyle && this.timeUp)) { if (this.rules === Freestyle && this.timeUp && !b.over) b.timeUp(); this.EndMatch(); this.link?.pushState(); return; }
    if (this.mode === 0 && this.rules === Classic && b.strikes + this.penalties >= this.strikeLimit) { this.EndMatch(); return; }
    if (this.mode === 1 && b.turn !== me && b.turn === 0) this.UI.Toast("YOUR TURN", 1.2);
    this.BeginTurn();
    if (this.mode === Online) this.link?.pushState();
  }
  private lastOut: OOut | null = null;

  private AnnounceOutcome(o: OOut) {
    if (o.foul) {
      this.UI.Announce(this.mode === 0 && this.rules === Classic ? "STRIKER IN: +1 STRIKE" : `FOUL: ${o.reason}`, Red, 1.3);
      Sfx.play(Snd.Deny, 0.6);
      if (o.ret.length && this.mode !== 0) this.UI.Toast(o.ret.some((n) => n === Queen) ? "Queen and a penalty coin go back to the centre" : "A penalty coin goes back to the centre", 2.2);
    } else if (o.qc) { this.UI.Announce("QUEEN COVERED!", Pal.hex(0xff6a7a), 1.4); Sfx.play(Snd.PowerUp, 0.7); this.fxWorld.confetti(this.TableToWorld(V2.zero), 40, 6, [Red, Gold, Color.white]); }
    else if (o.qr) { this.UI.Announce("QUEEN NOT COVERED", Pal.hex(0xffa0a0), 1.3); }
    else if (o.q && this.mode !== 0 && this.rules === Classic) this.UI.Toast("Now COVER the queen: pocket one of your coins", 2.5);
    else if (o.text === "COVER THE QUEEN FIRST") this.UI.Toast("Your last coin can't go before the queen is covered!", 2.5);
    else if (o.potted >= 2 && (o.cont || this.mode === 0)) this.UI.Announce(`${o.potted} IN ONE!`, Gold, 1);
  }

  // ------------------------------------------------------------------ CPU

  private CpuThink() {
    const b = this.board, me = b.turn;
    if (!this.plan && this.ai) {
      if (b.breakShot) this.plan = this.ai.planBreak(this.sim, me);
      else {
        if (!this.planGen) this.planGen = this.ai.plan(this.sim, b, me);
        const t0 = performance.now();
        while (performance.now() - t0 < 8) {
          const r = this.planGen.next();
          if (r.done) { this.plan = r.value; this.planGen = null; break; }
        }
      }
    }
    this.ShowGuide(true, true);
    if (this.plan && this.timer > 0.6 && this.ai) {
      this.plan = this.ai.noisy(this.plan);
      this.cpuFromX = this.sim.x[Striker];
      this.cpuAimFrom = this.aim;
      this.cpuPower = Mathf.clamp01(Math.pow(Mathf.clamp01((this.plan.speed / MaxSpeed - 0.04) / 0.96), 1 / 1.35));
      this.step = Step.CpuPlace;
      this.timer = 0;
    }
  }

  private CpuPlaceTick() {
    const p = this.plan!;
    const k = Mathf.clamp01(this.timer / 0.7);
    const x = Mathf.lerp(this.cpuFromX, p.x, 1 - Math.pow(1 - k, 3));
    const me = this.board.turn;
    if (this.sim.fits(Striker, x, me === 0 ? -BaseY : BaseY)) this.sim.place(Striker, x, me === 0 ? -BaseY : BaseY);
    this.ShowGuide(true, true);
    if (k >= 1) {
      this.MoveStriker(p.x);
      this.step = Step.CpuAim; this.timer = 0;
    }
  }

  private CpuAimTick() {
    const p = this.plan!;
    const target = new V2(p.dx, p.dy).normalized;
    const a0 = Math.atan2(this.cpuAimFrom.y, this.cpuAimFrom.x), a1 = Math.atan2(target.y, target.x);
    const da = Mathf.deltaAngle(a0 * Mathf.Rad2Deg, a1 * Mathf.Rad2Deg) * Mathf.Deg2Rad;
    const t = this.timer;
    const k = Mathf.clamp01(t / 0.7);
    const a = a0 + da * (k * k * (3 - 2 * k));
    this.aim = new V2(Math.cos(a), Math.sin(a));
    this.power = t < 0.8 ? 0 : this.cpuPower * Mathf.clamp01((t - 0.8) / 0.5);
    this.ShowGuide(true);
    if (t > 1.5) { this.aim = target; this.Strike(Math.min(MaxSpeed, p.speed)); }
  }

  // ------------------------------------------------------------------ guide

  private ShowGuide(cpu: boolean, idle = false) {
    const s = this.sim;
    const sx = s.x[Striker], sy = s.y[Striker];
    const pro = !cpu && (this.proShot || this.proMatch);
    const len = pro ? ProGuide : BaseGuide;
    const hit = castDisc(s, sx, sy, this.aim.x, this.aim.y);
    const alpha = idle ? 0.25 : this.power > 0 || this.drag === Drag.Pull ? 0.95 : 0.55;
    const lineCol = pro ? Teal.withAlpha(alpha) : new Color(1, 1, 1, alpha);
    this.aimLine.positionCount = 2;
    this.aimLine.setPosition(0, new V2(sx, sy).add(this.aim.mul(RS)));
    this.aimLine.setPosition(1, new V2(hit.gx, hit.gy).sub(this.aim.mul(RS * 0.9)));
    this.aimLine.color = lineCol;
    this.ghost.transform.localPosition = new V3(hit.gx, hit.gy, 0);
    this.ghost.color = lineCol;
    this.pocketGlow.color = Gold.withAlpha(0);
    this.bounceLine.positionCount = 0;
    if (hit.coin >= 0) {
      const cx = s.x[hit.coin], cy = s.y[hit.coin];
      const n = new V2(cx - hit.gx, cy - hit.gy).normalized;
      const cut = Math.abs(V2.dot(this.aim, n));
      const ol = Math.max(0.6, len * cut);
      // follow the coin's straight path; with AIM+, light up the pocket it is heading into
      const ch = castDisc(s, cx, cy, n.x, n.y, hit.coin);
      const end = Math.min(ol, ch.dist);
      this.coinLine.positionCount = 2;
      this.coinLine.setPosition(0, new V2(cx, cy).add(n.mul(RC)));
      this.coinLine.setPosition(1, new V2(cx, cy).add(n.mul(RC + end)));
      const legal = this.board.targets(this.board.turn, s).includes(hit.coin);
      this.coinLine.color = legal ? lineCol : Red.withAlpha(alpha);
      this.ghost.color = legal ? lineCol : Red.withAlpha(alpha);
      if (pro) {
        for (const [px, py] of Pockets) {
          const t = (px - cx) * n.x + (py - cy) * n.y;
          if (t <= 0 || t > end + 1.2) continue;
          const off = Math.abs(-(px - cx) * n.y + (py - cy) * n.x);
          if (off < 0.42) { this.pocketGlow.transform.localPosition = new V3(px, py, 0); this.pocketGlow.color = Gold.withAlpha(0.55 + 0.3 * Math.sin(Time.time * 8)); }
        }
      }
      const tv = this.aim.sub(n.mul(V2.dot(this.aim, n)));
      if (tv.magnitude > 0.05) {
        const td = tv.normalized;
        this.deflLine.positionCount = 2;
        this.deflLine.setPosition(0, new V2(hit.gx, hit.gy).add(td.mul(RS)));
        this.deflLine.setPosition(1, new V2(hit.gx, hit.gy).add(td.mul(RS + Math.max(0.4, len * 0.45 * Math.sqrt(1 - cut * cut)))));
        this.deflLine.color = lineCol.withAlpha(alpha * 0.5);
      } else this.deflLine.positionCount = 0;
    } else {
      this.coinLine.positionCount = 0;
      this.deflLine.positionCount = 0;
      if (pro) {
        const rd = new V2(hit.nx !== 0 ? -this.aim.x : this.aim.x, hit.ny !== 0 ? -this.aim.y : this.aim.y);
        const h2 = castDisc(s, hit.gx, hit.gy, rd.x, rd.y);
        this.bounceLine.positionCount = 2;
        this.bounceLine.setPosition(0, new V2(hit.gx, hit.gy).add(rd.mul(RS)));
        this.bounceLine.setPosition(1, new V2(h2.gx, h2.gy));
        this.bounceLine.color = lineCol.withAlpha(alpha * 0.6);
      }
    }
    // the pull band: behind the striker, longer and redder with power
    if (this.power > 0.01) {
      const back = this.aim.mul(-1);
      const pl = 0.4 + this.power * 4.2;
      this.pullLine.positionCount = 2;
      this.pullLine.setPosition(0, new V2(sx, sy).add(back.mul(RS * 0.7)));
      this.pullLine.setPosition(1, new V2(sx, sy).add(back.mul(RS + pl)));
      const pc = Color.lerp(Teal, Color.lerp(Gold, Red, Mathf.clamp01((this.power - 0.5) * 2)), Mathf.clamp01(this.power * 2));
      this.pullLine.color = pc.withAlpha(0.9);
      this.pullLine.widthMultiplier = (0.16 + this.power * 0.14) * this.lineK;
      const hp = this.UI.WorldToHud(this.TableToWorld(new V2(sx, sy).add(back.mul(RS + pl + 1.1))));
      this.powerText.rectTransform.anchoredPosition = hp;
      this.powerText.text = `${Math.round(this.power * 100)}%`;
      this.powerText.color = pc;
      this.powerText.rectTransform.localEulerAngles = new V3(0, 0, this.portrait && this.mode === 2 && this.board.turn === 1 ? 180 : 0);
    } else { this.pullLine.positionCount = 0; this.powerText.text = ""; }
  }

  private HideGuide() {
    this.aimLine.positionCount = 0; this.coinLine.positionCount = 0; this.deflLine.positionCount = 0; this.bounceLine.positionCount = 0; this.pullLine.positionCount = 0;
    this.ghost.color = Color.clear; this.pocketGlow.color = Color.clear;
    if (this.powerText) this.powerText.text = "";
  }

  // ------------------------------------------------------------------ rendering

  private ResetViews() {
    for (const v of this.views) {
      v.dropT = -1; v.pop = 0;
      v.root.setActive(this.sim.on[v.n] === 1);
      v.root.localScale = V3.one;
    }
  }

  private Present(dt: number) {
    const s = this.sim;
    for (const v of this.views) {
      const n = v.n;
      if (v.dropT >= 0) {
        v.dropT += dt;
        const k = Mathf.clamp01(v.dropT / 0.25);
        v.root.localPosition = new V3(Mathf.lerp(v.fromX, v.toX, k), Mathf.lerp(v.fromY, v.toY, k), 0);
        const sc = Mathf.lerp(1, 0.6, k);
        v.root.localScale = new V3(sc, sc, 1);
        const a = 1 - Mathf.clamp01((v.dropT - 0.12) / 0.2);
        v.body.color = Color.lerp(Color.black, Color.white, 0.3 + 0.7 * a).withAlpha(a);
        v.shadow.color = Color.clear;
        if (v.glow) v.glow.color = Color.clear;
        if (v.dropT > 0.35) { v.dropT = -1; v.root.setActive(false); }
        continue;
      }
      const on = s.on[n] === 1;
      if (v.root.activeSelf !== on) v.root.setActive(on);
      if (!on) continue;
      v.pop = Mathf.moveTowards(v.pop, 0, dt * 3);
      const ps = 1 + 0.3 * Math.sin(v.pop * Math.PI);
      // online: a small correction from the host's board slides into place instead of jumping
      const e = this.ease[n];
      if (e && (e.x !== 0 || e.y !== 0)) { const k = Math.exp(-dt * 12); e.x *= k; e.y *= k; if (Math.abs(e.x) + Math.abs(e.y) < 0.002) { e.x = 0; e.y = 0; } }
      v.root.localPosition = new V3(s.x[n] + (e ? e.x : 0), s.y[n] + (e ? e.y : 0), 0);
      v.root.localScale = new V3(ps, ps, 1);
      v.body.color = Color.white;
      v.body.transform.localEulerZ = (s.ang[n] * 180) / Math.PI;
      v.shadow.color = new Color(0, 0, 0, 0.42);
      v.shadow.transform.localPosition = this.rot ? new V3(-0.07, 0.1, 0) : new V3(0.07, -0.1, 0);
      if (v.glow) {
        const active = this.State === Phase.Playing && (this.step === Step.Aim || this.step === Step.CpuAim || this.step === Step.CpuPlace || this.step === Step.CpuThink || this.step === Step.Remote);
        const c = PlayerColors[this.board.turn];
        v.glow.color = c.withAlpha(active ? 0.45 + 0.25 * Math.sin(Time.time * 5) : 0);
      }
    }
    // rails: the knob mirrors the striker for the side on turn
    const playing = this.State === Phase.Playing;
    for (let k = 0; k < 2; k++) {
      const r = this.rails[k];
      const show = playing ? (k === 0 || this.mode !== 0) : false;
      r.sr.color = show ? Color.white : Color.white.withAlpha(0.35);
      const myTurn = playing && this.board.turn === k;
      const x = myTurn && s.on[Striker] && (this.step === Step.Aim || this.step === Step.CpuPlace || this.step === Step.CpuAim || this.step === Step.CpuThink) ? s.x[Striker] : this.lastX[k];
      r.knob.transform.localPosition = new V3(x, k === 0 ? -RailY : RailY, 0);
      r.ring.transform.localPosition = new V3(x, k === 0 ? -RailY : RailY, 0);
      r.knob.color = show ? Color.white.withAlpha(myTurn ? 1 : 0.45) : Color.clear;
      r.ring.color = show && myTurn && (this.step === Step.Aim) ? PlayerColors[k].withAlpha(0.5 + 0.3 * Math.sin(Time.time * 4)) : Color.clear;
    }
    if (playing) {
      for (let i = 0; i < 2; i++) this.cards[i].glow.color = PlayerColors[i].withAlpha(this.board.turn === i && this.mode !== 0 ? 0.28 + 0.14 * Math.sin(Time.time * 4) : 0);
      const human = this.IsHuman(this.board.turn) && this.step === Step.Aim;
      this.aimButton.node.setActive(true);
      this.aimButton.interactable = human && !this.proShot && !this.proMatch;
    }
    this.cueFlash = Mathf.moveTowards(this.cueFlash, 0, dt * 4);
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    if (!this.cards.length) return;
    const b = this.board, s = this.sim;
    const names = this.Names();
    for (let p = 0; p < 2; p++) {
      const c = this.cards[p];
      const col = b.colourOf(p);
      if (this.rules === Freestyle || this.mode === 0) {
        c.score.text = this.mode === 0 && this.rules === Classic ? `${19 - Board.coinsLeft(s)}/19` : String(b.score[p]);
        c.sub.text = this.mode === 0 && this.rules === Classic ? `STRIKES ${b.strikes + this.penalties}/${this.strikeLimit}` : "POINTS";
        for (let k = 0; k < 9; k++) c.tray[k].gameObject.setActive(false);
        c.sub.rectTransform.place(new V2(0, 0), new V2(240, 34), new V2(240, 34));
      } else {
        c.score.text = b.due[p] > 0 ? `DUE ${b.due[p]}` : "";
        c.sub.text = "";
        const left = Board.left(s, col);
        for (let k = 0; k < 9; k++) {
          const im = c.tray[k];
          im.gameObject.setActive(true);
          const potted = k < 9 - left;
          im.sprite = potted ? CoinIcon(col) : EmptySlot();
          im.color = Color.white;
        }
        if (b.queenState === 2 && b.queenBy === p) c.score.text = "♛";
      }
      c.name.text = names[p];
    }
    this.infoText.text = this.mode === 0 ? (this.rules === Classic ? "CLEAR THE BOARD" : "POINTS RUSH")
      : `${RuleNames[this.rules]}${this.mode === 1 ? ` · ${DiffNames[this.diff]}` : ""}`;
    if (this.rules === Freestyle) this.UpdateClock();
    else this.SetTurnText();
    this.coinWallet.text = Fmt.n(this.Coins);
    const label = this.proMatch || this.proShot ? "AIM+ ON" : this.Aims > 0 ? `AIM+ ×${this.Aims}` : this.Coins >= AimCost ? `AIM+ ${AimCost}` : AdService.rewardedAvailable && this.mode !== Online ? "AIM+ +AD" : "AIM+";
    if (this.aimButton.label) this.aimButton.label.text = label;
  }

  private SetTurnText(extra = "") {
    const b = this.board, p = b.turn;
    let t: string;
    if (this.mode === 0) t = "YOUR STRIKE";
    else if (this.mode === 1) t = p === 0 ? "YOUR TURN" : `${CpuNames[this.diff]} IS AIMING…`;
    else if (this.mode === Online) t = p === this.me ? "YOUR TURN" : "FRIEND'S TURN";
    else t = `${this.Names()[p]}'S TURN`;
    if (this.mode !== 0 && this.rules === Classic) t += p === 0 || this.mode === 2 || (this.mode === Online && p === this.me) ? `  ·  ${b.colourOf(p) === 0 ? "WHITE" : "BLACK"}` : "";
    this.turnText.text = t + extra;
    this.turnText.color = Color.lerp(PlayerColors[p], Color.white, 0.25);
  }

  private UpdateClock() {
    const c = Math.max(0, this.clock);
    this.SetTurnText(`  ·  ${Fmt.clock(Math.ceil(c))}`);
    if (c <= 10) this.turnText.color = Color.lerp(Red, Color.white, 0.5 + 0.5 * Math.sin(Time.time * 10));
  }

  private OnAimPlus() {
    if (this.State !== Phase.Playing || this.proShot || this.proMatch || this.step !== Step.Aim) return;
    if (this.Aims > 0) this.Aims = this.Aims - 1;
    else if (this.Coins >= AimCost) { this.Coins = this.Coins - AimCost; this.UI.Toast(`-${AimCost} COINS`, 1.2); }
    else {
      // no ads during an online match
      if (this.mode === Online) { this.UI.Toast(`AIM+ costs ${AimCost} coins`, 1.6); return; }
      if (!AdService.rewardedAvailable) return;
      AdService.showRewarded((ok) => { if (!ok) return; this.Aims = this.Aims + 1; this.UI.Toast("+1 AIM+", 1.6); Sfx.play(Snd.PowerUp, 0.7); this.UpdateHud(); });
      return;
    }
    this.proShot = true;
    Sfx.play(Snd.PowerUp, 0.6);
    this.UI.Toast("AIM+: long guide for this strike", 1.8);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ online (private tables)

  private BuildOnline() {
    const theme = { accent: Orange, accent2: Blue, ink: Ink };
    this.lobby = new TableLobby("carrom", theme, {
      onReady: (room) => this.OnTableReady(room),
      toast: (t, sec) => this.UI.Toast(t, sec ?? 2),
    }, "Carrom Flick");
    this.overlay = new TableOverlay(theme, () => { this.overlay.hide(); this.EnterTitle(); }, (k) => this.link?.react(k));
    this.overlay.onTimeout = () => { this.link?.leave(); this.FriendLeft(); };
  }

  /** Online the board keeps running while the pause menu is open (the friend may be shooting). */
  update() {
    super.update();
    if (this.State === Phase.Paused && this.mode === Online && !this.ended) {
      const dt = Time.unscaledDeltaTime;
      if (this.step === Step.Rolling) { this.Simulate(dt, false); if (!this.sim.moving) { this.step = Step.Settle; this.timer = 0; } }
      else if (this.step === Step.Settle) { this.timer += dt; if (this.timer > 0.3) this.Resolve(); }
      this.overlay.tick();
      this.Present(dt);
    }
  }

  /** PLAY with ONLINE selected opens the lobby; REMATCH online asks the friend. */
  protected StartRun() {
    if (this.State === Phase.Paused && this.mode === Online) { this.UI.Toast("Restart isn't available online: use MENU to leave the table.", 2.5); return; }
    if (this.SelMode === Online && !this.onlineGo) {
      if (this.State === Phase.Over && this.link && this.link.connected) { this.AskRematch(); return; }
      if (this.State === Phase.Over) this.EnterTitle();
      if (!this.lobby.isOpen) {
        this.lobby.createNote = `Your table plays ${RuleNames[Mathf.clamp(this.Data.get("rules"), 0, 1)]} rules (change them on the title screen).`;
        this.lobby.open("menu");
      }
      return;
    }
    this.onlineGo = false;
    super.StartRun();
  }

  private OnTableReady(room: OnlineRoom) {
    this.LeaveTable();
    const link = new OnlineLink<OStart, OMove, OSnap>(room);
    this.link = link;
    link.bind({
      onStart: (st) => {
        this.onlineStart = st;
        this.overlay.hide();
        this.Data.set("mode", Online);
        this.onlineGo = true;
        this.StartRun();
      },
      validMove: (mv, by) => (this.State === Phase.Playing || this.State === Phase.Paused) && this.mode === Online && !this.ended
        && by === this.board.turn && this.step === Step.Remote && Number.isFinite(mv.x) && Number.isFinite(mv.sp) && Math.abs(mv.x) <= BaseHalf + 0.01,
      onMove: (mv, by) => this.RemoteShot(mv, by),
      snapshot: () => this.Snapshot(),
      onSnapshot: (snap) => {
        if ((this.State === Phase.Playing || this.State === Phase.Paused) && this.mode === Online) { this.OnSnap(snap); return; }
        if (this.State === Phase.Over && this.mode === Online && snap.b.over) return;
        // joined (again) in the middle of a match: start from the host's state
        this.onlineStart = { rules: snap.rules, seed: snap.seed, first: snap.first };
        this.overlay.hide();
        this.Data.set("mode", Online);
        this.onlineGo = true;
        this.StartRun();
        this.ApplySnap(snap);
      },
      onReaction: (k) => this.overlay.Pop(k, true),
      onFriend: (st) => {
        if (st === "connected") { if (this.overlay.state === "lost") { this.overlay.hide(); this.UI.Toast("Your friend is back!", 2); } }
        else if (st === "lost") { if (this.State !== Phase.Title && !this.ended) this.overlay.lost(30); }
        else this.FriendLeft();
      },
      onRematchReady: () => { if (link.isHost) link.start({ rules: this.rules, seed: Math.floor(Math.random() * 1e9), first: link.match % 2 }); },
      onFriendRematch: () => { if (this.overlay.state !== "rematch") this.UI.Toast("Your friend wants a rematch! Tap REMATCH.", 3); },
    });
    if (link.isHost) link.start({ rules: Mathf.clamp(this.Data.get("rules"), 0, 1), seed: Math.floor(Math.random() * 1e9), first: 0 });
    else this.UI.Toast("Joined! Waiting for the host to start…", 3);
  }

  /** The friend's shot: play it here too (the host's result is the reference). */
  private RemoteShot(mv: OMove, by: number) {
    this.sim.place(Striker, mv.x, by === 0 ? -BaseY : BaseY);
    this.lastX[by] = mv.x;
    this.aim = new V2(mv.dx, mv.dy);
    this.Strike(mv.sp, true);
  }

  private Snapshot(): OSnap {
    const s = this.sim, b = this.board, d: number[] = [];
    for (let i = 0; i < N; i++) d.push(s.on[i], r4(s.x[i]), r4(s.y[i]), Math.round(s.ang[i] * 100) / 100);
    return {
      rules: this.rules, seed: this.onlineStart.seed, first: this.onlineStart.first, n: this.shotN, d,
      b: { turn: b.turn, qs: b.queenState, qb: b.queenBy, due: [...b.due], score: [...b.score], pots: [...b.pots], fouls: [...b.fouls], strikes: b.strikes, over: b.over, winner: b.winner, reason: b.reason, brk: b.breakShot },
      clock: Math.round(this.clock * 10) / 10, timeUp: this.timeUp, lastX: this.lastX.map(r4), out: this.lastOut, rolling: this.step === Step.Rolling || this.step === Step.Settle,
    };
  }

  /** Guest: a board from the host. While my own animation of the same shot still runs, it waits for it to settle. */
  private OnSnap(snap: OSnap) {
    if (this.ended && !snap.b.over) return;
    if (snap.rolling && snap.n <= this.shotN) return; // the host is mid-shot: its settled board follows
    if ((this.step === Step.Rolling || this.step === Step.Settle) && snap.n > this.shotN) { this.pendingSnap = snap; return; }
    if (this.step === Step.Rolling && snap.n === this.shotN) return;
    this.ApplySnap(snap);
  }

  private ApplySnap(snap: OSnap) {
    const s = this.sim, b = this.board;
    if (snap.seed !== this.onlineStart.seed) { this.onlineStart = { rules: snap.rules, seed: snap.seed, first: snap.first }; }
    s.stopAll();
    for (let i = 0; i < N; i++) {
      const on = snap.d[i * 4] === 1, x = snap.d[i * 4 + 1], y = snap.d[i * 4 + 2];
      const v = this.views[i];
      const wasOn = s.on[i] === 1;
      if (on) {
        // hide a small correction (the local replay of the shot ended a hair away)
        const dx = s.x[i] - x, dy = s.y[i] - y;
        this.ease[i] = wasOn && v.dropT < 0 && Math.hypot(dx, dy) < 1.2 ? { x: dx, y: dy } : { x: 0, y: 0 };
        s.place(i, x, y);
        s.ang[i] = snap.d[i * 4 + 3];
        if (!wasOn) { v.dropT = -1; v.pop = 1; }
      } else { s.on[i] = 0; }
    }
    const sb = snap.b;
    b.turn = sb.turn; b.queenState = sb.qs; b.queenBy = sb.qb; b.due = [...sb.due]; b.score = [...sb.score]; b.pots = [...sb.pots]; b.fouls = [...sb.fouls];
    b.strikes = sb.strikes; b.over = sb.over; b.winner = sb.winner; b.reason = sb.reason; b.breakShot = sb.brk;
    this.clock = snap.clock; this.timeUp = snap.timeUp; this.lastX = [...snap.lastX];
    this.pendingSnap = null;
    // announce the shot we just watched (not old ones after a rejoin)
    if (snap.n === this.shotN + 1 && snap.out) {
      this.AnnounceOutcome(snap.out);
      for (const n of snap.out.ret) { this.views[n].pop = 1; this.fx.pop(new V2(s.x[n], s.y[n]), Gold, 10, 2, 0.18, 0.4); }
    }
    this.shotN = snap.n;
    this.UpdateHud();
    if (b.over) { this.EndMatch(); return; }
    this.BeginTurn();
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
    if ((this.State === Phase.Playing || this.State === Phase.Paused) && this.mode === Online && !this.ended) {
      const b = this.board;
      if (b.strikes >= 6 || b.pots[0] + b.pots[1] >= 3) {
        // the match was well underway: the player who stayed takes the win
        this.forfeit = true;
        this.overlay.hide();
        if (this.State === Phase.Paused) this.Resume();
        this.EndMatch();
        return;
      }
      this.ended = true;
      this.step = Step.Wait;
      this.HideGuide();
      this.overlay.left("Your friend left", "Not enough of the board was played for a result.");
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

  private OnlineResult() {
    const b = this.board, me = this.me, fr = 1 - me;
    const won = this.forfeit || b.winner === me, draw = !this.forfeit && b.winner < 0;
    const prize = won ? OnlinePrize : draw ? 20 : 5;
    this.lastPrize = prize;
    this.Coins = this.Coins + prize;
    if (won) this.Data.add("onlineWins", 1);
    this.Data.add("onlineGames", 1);
    this.overlay.showBar(false);
    const classic = this.rules === Classic;
    this.Finish(new Result({
      Headline: this.forfeit ? "FRIEND LEFT · YOU WIN!" : won ? "YOU WIN!" : draw ? "IT'S A DRAW" : "FRIEND WINS",
      HeadlineColor: won ? Gold : PlayerColors[fr], Victory: won,
      Value: classic ? `${b.pots[me]} – ${b.pots[fr]}` : `${b.score[me]} – ${b.score[fr]}`,
      BestLine: `${classic ? "YOUR COINS" : "YOUR POINTS"} ${classic ? b.pots[me] : b.score[me]} · FRIEND ${classic ? b.pots[fr] : b.score[fr]}   ·   +${prize} COINS`,
      Stats: classic
        ? [["YOUR COINS", `${b.pots[me]}/9`], ["FRIEND'S COINS", `${b.pots[fr]}/9`], ["MATCH", String(this.link?.match ?? 1)], ["ONLINE WINS", String(this.Data.get("onlineWins"))]]
        : [["YOUR POINTS", String(b.score[me])], ["FRIEND'S POINTS", String(b.score[fr])], ["MATCH", String(this.link?.match ?? 1)], ["ONLINE WINS", String(this.Data.get("onlineWins"))]],
      Primary: this.link ? "REMATCH" : "NEW TABLE",
      Reward: won ? () => { this.Coins = this.Coins + this.lastPrize; this.UI.Toast(`+${this.lastPrize} COINS: DOUBLED!`, 2.5); Sfx.play(Snd.Coin, 0.8); } : null,
      RewardLabel: `DOUBLE COINS: +${prize} (AD)`,
    }));
  }

  // ------------------------------------------------------------------ results

  private EndMatch() {
    if (this.ended) return;
    this.ended = true;
    this.step = Step.Wait;
    this.HideGuide();
    const b = this.board;
    if (this.rules === Freestyle && !b.over && !(this.mode === Online && this.me === 1)) b.timeUp();
    if (this.mode === Online && this.me === 0) this.link?.pushState();
    this.startCoroutine(this.ShowResultLater());
  }

  private *ShowResultLater(): Generator<{ seconds: number; realtime: boolean } | undefined, void, unknown> {
    const b = this.board;
    const won = this.mode === Online ? this.forfeit || b.winner === this.me : this.mode === 0 ? Board.coinsLeft(this.sim) === 0 || this.rules === Freestyle : b.winner === 0;
    if (this.mode === 2 || won) {
      Sfx.play(Snd.Win, 0.8);
      this.fxWorld.confetti(this.TableToWorld(V2.zero).add(V2.up.mul(2)), 90, 9, [Gold, Color.white, Orange, Red, Teal]);
    } else Sfx.play(Snd.Lose, 0.7);
    const head = this.mode === Online ? (this.forfeit ? "YOUR FRIEND LEFT" : won ? "YOU WIN!" : b.winner < 0 ? "DRAW!" : "FRIEND WINS") : this.mode === 0 ? (this.rules === Classic ? (won ? "BOARD CLEARED!" : "OUT OF STRIKES") : "TIME UP!")
      : this.mode === 1 ? (b.winner === 0 ? "YOU WIN!" : b.winner === 1 ? `${CpuNames[this.diff]} WINS` : "DRAW")
        : b.winner < 0 ? "DRAW!" : `${this.Names()[b.winner]} WINS!`;
    this.UI.Announce(head, won || this.mode === 2 ? Gold : Red, 1.6);
    yield { seconds: 1.7, realtime: false };
    if (this.State !== Phase.Playing) return;
    if (this.mode === Online) this.OnlineResult();
    else if (this.mode === 0) this.SoloResult();
    else if (this.mode === 1) this.CpuResult();
    else this.TwoPlayerResult();
  }

  private SoloResult() {
    const b = this.board;
    if (this.rules === Classic) {
      const used = b.strikes + this.penalties;
      const cleared = Board.coinsLeft(this.sim) === 0;
      if (cleared) {
        const stars = used <= 14 ? 3 : used <= 20 ? 2 : 1;
        const prev = this.Data.get("bestStrikes");
        const best = prev === 0 || used < prev;
        if (best) this.Data.set("bestStrikes", used);
        const earned = stars * 30;
        this.Coins = this.Coins + earned;
        this.Data.add("clears", 1);
        this.Finish(new Result({
          Headline: "BOARD CLEARED!", HeadlineColor: Gold, Stars: stars, Victory: true, NewBest: best && prev > 0,
          BestLine: `${used} STRIKES   ·   BEST ${this.Data.get("bestStrikes")}`,
          Stats: [["STRIKES", String(used)], ["FOULS", String(this.penalties)], ["COINS EARNED", `+${earned}`], ["WALLET", Fmt.n(this.Coins)]],
          Primary: "PLAY AGAIN",
          Reward: () => { this.Coins = this.Coins + earned; this.UI.Toast(`+${earned} COINS: DOUBLED!`, 2.5); Sfx.play(Snd.Coin, 0.8); },
          RewardLabel: `DOUBLE COINS: +${earned} (AD)`,
        }));
      } else {
        const left = Board.coinsLeft(this.sim);
        this.Finish(new Result({
          Headline: "OUT OF STRIKES", HeadlineColor: Pal.hex(0xffb0a0), Value: `${19 - left}/19`,
          BestLine: `${left} COIN${left === 1 ? "" : "S"} LEFT ON THE BOARD`,
          Stats: [["POCKETED", String(19 - left)], ["STRIKES", String(used)], ["FOULS", String(this.penalties)], ["BEST CLEAR", this.Data.get("bestStrikes") ? String(this.Data.get("bestStrikes")) : "—"]],
          Primary: "TRY AGAIN",
          Reward: this.revived ? null : () => { this.revived = true; this.strikeLimit += 5; this.Revive(); this.BeginTurn(); this.UI.Announce("+5 STRIKES", Teal, 1.2); },
          RewardLabel: "+5 STRIKES & CONTINUE (AD)",
        }));
      }
      return;
    }
    const pts = b.score[0];
    const best = this.Data.max("bestPoints", pts);
    const earned = Math.floor(pts / 10);
    this.Coins = this.Coins + earned;
    const stars = pts >= 250 ? 3 : pts >= 150 ? 2 : pts >= 60 ? 1 : 0;
    this.Finish(new Result({
      Headline: "TIME UP!", HeadlineColor: Gold, Value: String(pts), CountTo: pts, NewBest: best && pts > 0, Victory: stars > 0,
      BestLine: `BEST ${this.Data.get("bestPoints")}   ·   +${earned} COINS`,
      Stats: [["POINTS", String(pts)], ["COINS POCKETED", String(b.pots[0])], ["STRIKES", String(b.strikes)], ["FOULS", String(b.fouls[0])]],
      Primary: "PLAY AGAIN",
      Reward: this.revived || Board.coinsLeft(this.sim) === 0 ? null : () => { this.revived = true; this.clock = 30; this.timeUp = false; b.over = false; this.Revive(); this.BeginTurn(); this.UI.Announce("+30 SECONDS", Teal, 1.2); },
      RewardLabel: "+30 SECONDS & CONTINUE (AD)",
    }));
  }

  private CpuResult() {
    const b = this.board, d = this.diff;
    const won = b.winner === 0;
    const wasPro = this.proMatch;
    this.proMatch = false;
    const statsClassic: [string, string][] = [["LEVEL", DiffNames[d]], ["YOUR COINS", `${b.pots[0]}/9`], ["THEIR COINS", `${b.pots[1]}/9`], ["FOULS", String(b.fouls[0])]];
    const statsFree: [string, string][] = [["LEVEL", DiffNames[d]], ["YOUR POINTS", String(b.score[0])], ["THEIR POINTS", String(b.score[1])], ["FOULS", String(b.fouls[0])]];
    const stats = this.rules === Classic ? statsClassic : statsFree;
    if (won) {
      const streak = this.Data.get("streak") + 1;
      this.Data.set("streak", streak);
      const bestStreak = this.Data.max("bestStreak", streak);
      const prize = Math.round(Prizes[d] * (1 + Math.min(5, streak - 1) * 0.1));
      this.Coins = this.Coins + prize;
      this.Data.add("wins", 1);
      Sfx.play(Snd.NewBest, 0.6);
      this.Finish(new Result({
        Headline: `YOU BEAT ${CpuNames[d]}!`, HeadlineColor: Gold, Value: `+${prize}`, CountTo: prize, Victory: true,
        NewBest: bestStreak && streak >= 2,
        BestLine: this.rules === Classic ? `BOARD POINTS ${b.score[0]}   ·   STREAK ${streak}` : `${b.score[0]} – ${b.score[1]}   ·   STREAK ${streak}`,
        Stats: [...stats.slice(0, 3), ["WALLET", Fmt.n(this.Coins)]],
        Primary: d < 2 ? "PLAY AGAIN" : "REMATCH",
        Reward: () => { this.Coins = this.Coins + prize; this.UI.Toast(`+${prize} COINS: DOUBLED!`, 2.5); Sfx.play(Snd.Coin, 0.8); },
        RewardLabel: `DOUBLE COINS: +${prize} (AD)`,
      }));
    } else {
      const streak = this.Data.get("streak");
      this.Data.set("streak", 0);
      this.Data.add("losses", 1);
      this.Finish(new Result({
        Headline: b.winner < 0 ? "IT'S A DRAW" : `${CpuNames[d]} WINS`, HeadlineColor: Pal.hex(0xffb0a0),
        Value: this.rules === Classic ? `${b.pots[0]}/9` : `${b.score[0]}–${b.score[1]}`,
        BestLine: (b.reason || "") + (streak > 1 ? `   ·   STREAK OF ${streak} ENDED` : ""),
        Stats: stats,
        Primary: "TRY AGAIN",
        Reward: wasPro ? null : () => this.Rematch(),
        RewardLabel: "REMATCH WITH AIM+ ON EVERY STRIKE (AD)",
      }));
    }
  }

  private TwoPlayerResult() {
    const b = this.board, names = this.Names();
    this.Data.add("duels", 1);
    const w = b.winner;
    this.Finish(new Result({
      Headline: w < 0 ? "IT'S A DRAW!" : `${names[w]} WINS!`, HeadlineColor: w < 0 ? Gold : PlayerColors[w], Victory: true,
      Value: this.rules === Classic ? `${b.pots[0]} – ${b.pots[1]}` : `${b.score[0]} – ${b.score[1]}`,
      BestLine: this.rules === Classic ? `${b.reason}   ·   BOARD POINTS ${w >= 0 ? b.score[w] : 0}` : b.reason,
      Stats: [[`${names[0]} COINS`, String(b.pots[0])], [`${names[1]} COINS`, String(b.pots[1])], ["STRIKES", String(b.strikes)], ["FOULS", `${b.fouls[0]} – ${b.fouls[1]}`]],
      Primary: "REMATCH",
    }));
  }

  /** Rewarded rematch: AIM+ on for every strike of the next match. */
  private Rematch() {
    this.StartRun();
    this.proMatch = true;
    this.UI.Toast("AIM+ ON FOR THE WHOLE MATCH", 2.5);
    this.UpdateHud();
  }
}
