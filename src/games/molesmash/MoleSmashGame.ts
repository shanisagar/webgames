import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Ease, Fmt, Fx, GameInfo, GameObject, howTo,
  Image, Mathf, Mouse, overUI, Pal, Phase, Random, Rect, Result, Screen, Sfx, Snd, SpriteRenderer, Text, TextAnchor, Time, Touchscreen,
  TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import { ClipSprite } from "./ClipSprite";
import {
  BackdropSprite, BandSprite, BoardSprite, Boards, BombSprite, BonkSprite, Brown, clipSpr, CoinSprite, Cyan, Gold, HelmetSprite, HoleBack,
  HoleFront, HoleGlow, Ink, MalletSprite, Mallets, MoleBody, MoleEyes, MoleH, Orange, Red, RoundPanel, SparkSprite,
} from "./MoleArt";

/**
 * MOLE SMASH: the mallet-and-holes game from every village fair. Moles pop out of the holes on a fairground board:
 * tap them before they duck. SOLO is a 90-second round that speeds up as it goes (combo multiplier, golden moles,
 * bomb and helmet moles, stars and a best score). VS COMPUTER and 2 PLAYERS share one board: cyan moles score for
 * player 1, orange moles for player 2, so everyone hunts their own colour (a bomb mole costs its own colour points:
 * leave yours, blast theirs). 2 PLAYERS can sit face to face (TABLE: player 2's side is turned around) or side by
 * side. Coins unlock mallets and boards.
 */

enum Mode { Solo, Cpu, Duo }
enum Kind { Normal, Gold, Bomb, Helmet }
enum St { Idle, Rising, Up, Hiding, Bonked }

const ModeNames = ["SOLO", "VS CPU", "2 PLAYERS"];
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const CpuNames = ["CPU · EASY", "CPU · MEDIUM", "CPU · HARD"];
const SoloTime = 90, DuelTime = 60, ContinueTime = 15;
const StarScores = [700, 1500, 2500];
const Prizes = [40, 80, 150];
const TeamCol = [Cyan, Orange];
const SpacingX = 2.8, SpacingY = 2.65, MoleScale = 1.72;
const UpY = 0.17, DownY = -0.66;
const White = Pal.hex(0xfffaf0);

class Hole {
  root!: GameObject; holder!: GameObject; mole!: GameObject;
  back!: SpriteRenderer; front!: SpriteRenderer; glow!: SpriteRenderer;
  body!: ClipSprite; eyes!: ClipSprite; extra!: ClipSprite; band!: ClipSprite;
  spark!: SpriteRenderer;
  pos = V2.zero;
  st = St.Idle; t = 0; up = 1; rise = 0; kind = Kind.Normal; team = -1; hp = 1; flipped = false; targeted = false; cool = 0;
  squash = 0; hitBy = -1;
}

class Mallet {
  root!: GameObject; arm!: GameObject; sr!: SpriteRenderer; bonk!: SpriteRenderer;
  t = 9; side = 0; style = 0; hit = false;
}

class Floater { t!: Text; age = 9; life = 1; start = V2.zero; rot = 0; }

class Panel {
  node!: UINode; name!: Text; score!: Text; combo!: Text; timer!: Text; icon!: Image; bg!: Image;
  pop = 0; shown = 0;
}

class Bot {
  target: Hole | null = null; timer = 0; cool = 0.8; diff = 1;
}

export class MoleSmashGame extends ArcadeGame {
  private world!: GameObject; private board!: GameObject;
  private cover!: SpriteRenderer; private boardSr!: SpriteRenderer; private boardShadow!: SpriteRenderer;
  private holes: Hole[] = [];
  private mallets: Mallet[] = [];
  private fx!: CasualFx;
  private cols = 3; private rows = 4; private boardW = 10; private boardH = 12; private scale = 1;
  private portrait = true;

  private mode = Mode.Solo; private diff = 1; private table = true;
  private clock = SoloTime; private roundTime = SoloTime; private elapsed = 0;
  private countdown = 0; private countShown = -1; private ending = false; private endT = 0;
  private spawnT = 0; private spawned = [0, 0];
  private score = [0, 0]; private combo = [0, 0]; private bestCombo = [0, 0]; private hits = [0, 0]; private golds = [0, 0]; private bombs = [0, 0];
  private taps = 0; private whiffs = 0; private stun = 0;
  private revived = false; private doubled = false; private lastPrize = 0;
  private bot = new Bot();
  private attract = 0;

  // HUD
  private soloBar!: UINode; private soloScore!: Text; private soloBest!: Text; private soloTimer!: Text; private soloCombo!: Text; private timerFill!: Image; private timerBg!: UINode;
  private panels: Panel[] = [];
  private floatLayer!: UINode; private floaters: Floater[] = [];
  private stunText!: Text;
  // title
  private modeButtons: ArcadeButton[] = []; private optButton!: ArcadeButton; private shopButton!: ArcadeButton; private modeLabel!: Text;
  private shop!: UINode; private shopCoins!: Text; private malletName!: Text; private malletImg!: Image; private malletAction!: ArcadeButton;
  private boardName!: Text; private boardImg!: Image; private boardAction!: ArcadeButton;
  private browseMallet = 0; private browseBoard = 0;

  private bonkClip!: AudioClip; private popClip!: AudioClip; private whiffClip!: AudioClip; private goldClip!: AudioClip; private boomClip!: AudioClip;
  private clankClip!: AudioClip; private comboClip!: AudioClip; private squeakClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "molesmash",
      Title: "MOLE SMASH",
      Tagline: "BONK THEM BEFORE THEY DUCK!",
      PlayLabel: "PLAY",
      Accent: Gold,
      Accent2: Cyan,
      BgTop: Pal.hex(0x3a2a8a),
      BgBottom: Pal.hex(0x1a0f3a),
      ShortSide: 10,
      Touch: TouchScheme.None,
      Music: { bpm: 132, rootHz: 130.8, degrees: [0, 4, 5, 3], seed: 41, energy: 0.65, major: true },
      Reminders: [
        "The moles are back|Bonk them before they duck!",
        "Golden moles spotted|Each one is worth 50 points.",
        "Two mallets, one board|Challenge a friend in Mole Smash.",
      ],
      HowTo: [
        howTo(Art.Disc, Brown, "TAP the moles as they pop out of their holes. Be quick: they duck again!"),
        howTo(Art.Star, Gold, "Golden moles are worth 5×. Hits in a row build your COMBO multiplier."),
        howTo(Art.Diamond, Red, "Don't bonk BOMB moles. HELMET moles need two hits (the first one stings)."),
        howTo(Art.Chevron, Pal.hex(0xff9a3c), "SOLO: 90 seconds, and the moles get faster and faster."),
        howTo(Art.Square, Cyan, "VS CPU and 2 PLAYERS: hunt your own colour. Cyan scores for player 1, orange for player 2."),
        howTo(Art.Ring, Orange, "A bomb mole blows up points of its own colour: leave yours, blast theirs!"),
      ],
      Tips: [
        "Keep your combo alive: a miss resets it.",
        "Watch for the golden glint.",
        "Helmet moles: hit twice, fast.",
        "In duels, tap your rival's bomb moles to cost them points.",
      ],
    });
  }

  protected get ShortSide() { return 10; }
  private get Coins() { return this.Data.get("coins"); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, Math.round(v))); }
  protected BestLine() { return `BEST ${Fmt.n(this.Data.get("best"))}   ·   COINS ${Fmt.n(this.Coins)}`; }
  protected StatsLine() { return ""; }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ms = { game: this, star: () => CasualArt.StarShape, eyes: MoleEyes };
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Data.set("mode", 0); this.Data.set("diff", 1); this.Data.set("um0", 1); this.Data.set("ub0", 1); }
    CasualLook.calm(this, 1.35, 0.15);
    this.world = new GameObject("MoleWorld", this.gameObject);
    this.cover = CasualLook.cover(this.world, BackdropSprite(this.BoardStyle), -910);
    this.board = new GameObject("Board", this.world);
    this.boardShadow = Art.spr(this.board, "Shadow", Art.Glow, new Color(0, 0, 0, 0.45), 1, -6, Art.Flat);
    this.boardSr = Art.spr(this.board, "BoardArt", BoardSprite(0, 9.4, 11.6), Color.white, 1, -5, Art.Flat);
    for (let i = 0; i < 16; i++) this.holes.push(this.MakeHole(i));
    for (let i = 0; i < 6; i++) this.mallets.push(this.MakeMallet());
    this.fx = CasualFx.create(this.board, 60, 220);
    this.BuildHud();
    this.BuildTitle();
    this.BuildSounds();
    this.SetGrid(true);
    this.Layout();
  }

  private MakeHole(i: number) {
    const h = new Hole();
    h.root = new GameObject("Hole" + i, this.board);
    h.glow = Art.spr(h.root, "Glow", HoleGlow(), new Color(1, 1, 1, 0), 2.5, 1, Art.Additive);
    h.back = Art.spr(h.root, "Back", HoleBack(), Color.white, 2.0, 2, Art.Flat);
    h.holder = new GameObject("Holder", h.root);
    h.mole = new GameObject("Mole", h.holder);
    h.body = clipSpr(h.mole, "Body", MoleBody(Brown, "brown"), Color.white, 1, 3);
    h.extra = clipSpr(h.mole, "Extra", HelmetSprite(), Color.white, 1, 4);
    h.band = clipSpr(h.mole, "Band", BandSprite(), Color.white, 1, 4);
    h.eyes = clipSpr(h.mole, "Eyes", MoleEyes(0), Color.white, 1, 5);
    h.spark = Art.spr(h.mole, "Spark", SparkSprite(), new Color(1, 0.8, 0.3, 0), 0.32, 6, Art.Additive);
    h.spark.transform.localPosition = new V3(0.2, 0.2, 0);
    h.front = Art.spr(h.root, "Front", HoleFront(), Color.white, 2.0, 7, Art.Flat);
    h.mole.localScale = new V2(MoleScale, MoleScale);
    h.mole.setActive(false);
    return h;
  }

  private MakeMallet() {
    const m = new Mallet();
    m.root = new GameObject("Mallet", this.board);
    m.bonk = Art.spr(m.root, "Bonk", BonkSprite(), new Color(1, 1, 1, 0), 1.3, 40, Art.Flat);
    m.arm = new GameObject("Arm", m.root);
    m.sr = Art.spr(m.arm, "Head", MalletSprite(0), Color.white, 1.15, 42, Art.Flat);
    m.sr.transform.localPosition = new V3(0, 0.8 * 1.15, 0);
    m.root.setActive(false);
    return m;
  }

  private BuildSounds() {
    const noise = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    this.bonkClip = Sfx.make("ms-bonk", 0.22, (t) => (Sfx.sinP(Sfx.glide(t, 330, 120, 0.09)) * 0.8 + noise(Math.trunc(t * 44100)) * 0.5 * Sfx.env(t, 0, 0.012) + Sfx.sinP(Sfx.glide(t, 900, 400, 0.05)) * 0.2 * Sfx.env(t, 0, 0.04)) * Sfx.env(t, 0.001, 0.16) * 0.8);
    this.squeakClip = Sfx.make("ms-squeak", 0.16, (t) => Sfx.sinP(Sfx.glide(t, 1400, 2200, 0.12) + Math.sin(t * 90) * 0.0) * Sfx.env(t, 0.005, 0.13) * 0.3);
    this.popClip = Sfx.make("ms-pop", 0.12, (t) => Sfx.sinP(Sfx.glide(t, 260, 620, 0.08)) * Sfx.env(t, 0.003, 0.09) * 0.35);
    this.whiffClip = Sfx.make("ms-whiff", 0.18, (t) => noise(Math.trunc(t * 44100)) * Sfx.env(t, 0.03, 0.12) * 0.25 * (0.5 + 0.5 * Math.sin(t * 40)));
    this.goldClip = Sfx.make("ms-gold", 0.6, (t) => (Sfx.sinP(1318 * t) * Sfx.env(t, 0.002, 0.25) + Sfx.sinP(1760 * t) * Sfx.env(Math.max(0, t - 0.08), 0.002, 0.3) * (t > 0.08 ? 1 : 0) + Sfx.sinP(2637 * t) * Sfx.env(Math.max(0, t - 0.16), 0.002, 0.35) * (t > 0.16 ? 1 : 0)) * 0.3);
    this.boomClip = Sfx.make("ms-boom", 0.8, (t) => (noise(Math.trunc(t * 22050)) * 0.8 + Sfx.sinP(Sfx.glide(t, 120, 40, 0.4)) * 0.8) * Sfx.env(t, 0.002, 0.6) * 0.7);
    this.clankClip = Sfx.make("ms-clank", 0.5, (t) => (Sfx.sinP(1210 * t) * 0.4 + Sfx.sinP(1870 * t) * 0.3 + Sfx.sinP(3050 * t) * 0.2 + noise(Math.trunc(t * 44100)) * 0.3 * Sfx.env(t, 0, 0.01)) * Sfx.env(t, 0.0005, 0.35) * 0.55);
    this.comboClip = Sfx.make("ms-combo", 0.45, (t) => { const n = Math.min(3, Math.floor(t / 0.08)); const f = [784, 988, 1175, 1568][n]; return Sfx.sqrP(f * t) * 0.12 * Sfx.env(t - n * 0.08, 0.002, 0.12); });
  }

  // ------------------------------------------------------------------ HUD

  private BuildHud() {
    const hud = this.UI.Hud;
    this.floatLayer = UIKit.node("Floats", hud).stretch();
    for (let i = 0; i < 14; i++) {
      const f = new Floater();
      f.t = UIKit.label(this.floatLayer, "", 56, Color.white);
      UIKit.glow(f.t, new Color(0.15, 0.05, 0, 0.85), 4);
      f.t.gameObject.setActive(false);
      this.floaters.push(f);
    }
    // solo bar
    this.soloBar = UIKit.node("SoloBar", hud).place(new V2(0.5, 1), new V2(0, -100), new V2(1000, 170));
    const sc = UIKit.node("ScoreBox", this.soloBar).place(new V2(0, 0.5), new V2(185, 0), new V2(330, 150));
    UIKit.img(sc, "Bg", RoundPanel(), new Color(0.12, 0.05, 0.2, 0.72)).rectTransform.stretch();
    this.soloScore = UIKit.at(UIKit.label(sc, "0", 72, Color.white), UIKit.Center, new V2(0, 14), new V2(320, 90));
    UIKit.glow(this.soloScore, Pal.hex(0x5a2a00), 4);
    this.soloBest = UIKit.at(UIKit.label(sc, "", 26, Gold), UIKit.Center, new V2(0, -46), new V2(320, 34));
    this.timerBg = UIKit.node("Timer", this.soloBar).place(UIKit.Center, new V2(40, 0), new V2(250, 150));
    UIKit.img(this.timerBg, "Bg", RoundPanel(), new Color(0.12, 0.05, 0.2, 0.72)).rectTransform.stretch();
    this.soloTimer = UIKit.at(UIKit.label(this.timerBg, "1:30", 64, Color.white), UIKit.Center, new V2(0, 14), new V2(240, 80));
    UIKit.glow(this.soloTimer, Pal.hex(0x2a0a40), 4);
    const [, fill] = UIKit.meter(this.timerBg, UIKit.Center, new V2(0, -42), new V2(190, 22), Gold);
    this.timerFill = fill;
    this.soloCombo = UIKit.at(UIKit.label(hud, "", 54, Gold), new V2(0.5, 1), new V2(0, -230), new V2(600, 70));
    UIKit.glow(this.soloCombo, Pal.hex(0x6a2a00), 4);
    // duel panels
    for (let i = 0; i < 2; i++) {
      const p = new Panel();
      p.node = UIKit.node("Panel" + i, hud);
      p.bg = UIKit.img(p.node, "Bg", RoundPanel(), new Color(0.1, 0.05, 0.18, 0.78));
      p.bg.rectTransform.stretch();
      UIKit.img(p.node, "Edge", Art.UiOutline, TeamCol[i].withAlpha(0.8)).rectTransform.stretch();
      p.icon = UIKit.img(p.node, "Icon", MoleBody(TeamCol[i], "team" + i), Color.white);
      p.icon.rectTransform.place(new V2(0, 0.5), new V2(70, -4), new V2(86, 108));
      p.name = UIKit.at(UIKit.label(p.node, "", 28, TeamCol[i], TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(270, 34), new V2(260, 36));
      p.score = UIKit.at(UIKit.label(p.node, "0", 64, Color.white, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(270, -16), new V2(260, 72));
      UIKit.glow(p.score, TeamCol[i].withAlpha(0.7), 4);
      p.combo = UIKit.at(UIKit.label(p.node, "", 30, Gold), new V2(1, 0.5), new V2(-80, -26), new V2(150, 40));
      p.timer = UIKit.at(UIKit.label(p.node, "", 40, White), new V2(1, 0.5), new V2(-80, 22), new V2(150, 50));
      this.panels.push(p);
    }
    this.stunText = UIKit.at(UIKit.label(hud, "", 44, Red), UIKit.Center, new V2(0, 0), new V2(600, 60));
    UIKit.glow(this.stunText, Color.black.withAlpha(0.6), 3);
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    CasualLook.titleCard(this.UI, new Color(0.08, 0.03, 0.16, 0.72), new V2(1060, 1100), -30);
    const accents = [Gold, Cyan, Orange];
    for (let i = 0; i < 3; i++) {
      const idx = i;
      const b = UIKit.buttonAt(ex, ModeNames[i], UIKit.Center, new V2((i - 1) * 320, 20), new V2(300, 96), false, () => this.PickMode(idx), 32);
      b.setAccent(accents[i]);
      this.modeButtons.push(b);
    }
    this.optButton = UIKit.buttonAt(ex, "MEDIUM", UIKit.Center, new V2(-170, -92), new V2(320, 84), false, () => this.CycleOption(), 28);
    this.shopButton = UIKit.buttonAt(ex, "MALLETS", UIKit.Center, new V2(170, -92), new V2(320, 84), false, () => this.OpenShop(true), 28);
    this.shopButton.setAccent(Gold);
    this.modeLabel = UIKit.at(UIKit.label(ex, "", 25, new Color(1, 1, 1, 0.85)), UIKit.Center, new V2(0, -160), new V2(980, 34));
    this.BuildShop(ex.parent!);
    this.RefreshTitle();
  }

  private BuildShop(parent: UINode) {
    const C = UIKit.Center;
    this.shop = UIKit.node("Shop", parent).stretch();
    UIKit.dim(this.shop, 0.8);
    const card = UIKit.card(this.shop, new V2(900, 1000), Gold);
    card.localScale = new V3(0.94, 0.94, 1);
    UIKit.glow(UIKit.at(UIKit.label(card, "MALLETS & BOARDS", 52, Color.white), C, new V2(0, 410), new V2(860, 70)), Ink, 3);
    UIKit.img(card, "Coin", CoinSprite(), Color.white).rectTransform.place(C, new V2(-70, 342), new V2(54, 54));
    this.shopCoins = UIKit.at(UIKit.label(card, "0", 44, Gold, TextAnchor.MiddleLeft), C, new V2(70, 342), new V2(220, 60));
    UIKit.at(UIKit.label(card, "MALLET", 30, Pal.TextDim), C, new V2(0, 270), new V2(400, 40));
    this.malletImg = UIKit.img(card, "MalletImg", MalletSprite(0), Color.white);
    this.malletImg.rectTransform.place(C, new V2(0, 175), new V2(96, 160));
    this.malletImg.rectTransform.localEulerAngles = new V3(0, 0, -35);
    this.malletName = UIKit.at(UIKit.label(card, "", 38, Color.white), C, new V2(0, 85), new V2(600, 50));
    UIKit.buttonAt(card, "<", C, new V2(-330, 175), new V2(100, 110), false, () => this.Browse(0, -1), 52).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(330, 175), new V2(100, 110), false, () => this.Browse(0, 1), 52).setAccent(Gold);
    this.malletAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, 15), new V2(380, 88), false, () => this.ShopAction(0), 32);
    UIKit.at(UIKit.label(card, "BOARD", 30, Pal.TextDim), C, new V2(0, -60), new V2(400, 40));
    this.boardImg = UIKit.img(card, "BoardImg", BoardSprite(0, 12.2, 8.95), Color.white);
    this.boardImg.rectTransform.place(C, new V2(0, -160), new V2(250, 170));
    this.boardName = UIKit.at(UIKit.label(card, "", 38, Color.white), C, new V2(0, -270), new V2(600, 50));
    UIKit.buttonAt(card, "<", C, new V2(-330, -160), new V2(100, 110), false, () => this.Browse(1, -1), 52).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(330, -160), new V2(100, 110), false, () => this.Browse(1, 1), 52).setAccent(Gold);
    this.boardAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, -350), new V2(380, 88), false, () => this.ShopAction(1), 32);
    UIKit.buttonAt(card, "CLOSE", C, new V2(0, -445), new V2(320, 80), true, () => this.OpenShop(false), 36).setAccent(Gold);
    this.shop.setActive(false);
  }

  private get SelMode() { return Mathf.clamp(this.Data.get("mode"), 0, 2) as Mode; }
  private get MalletStyle() { return Mathf.clamp(this.Data.get("mallet"), 0, Mallets.length - 1); }
  private get BoardStyle() { return Mathf.clamp(this.Data.get("board"), 0, Boards.length - 1); }

  private PickMode(i: number) {
    this.Data.set("mode", i);
    this.RefreshTitle();
  }

  private CycleOption() {
    const m = this.SelMode;
    if (m === Mode.Cpu) this.Data.set("diff", (Mathf.clamp(this.Data.get("diff", 1), 0, 2) + 1) % 3);
    else if (m === Mode.Duo) this.Data.set("layout", this.Data.get("layout") ^ 1);
    else return;
    this.RefreshTitle();
  }

  private RefreshTitle() {
    if (!this.optButton) return;
    const m = this.SelMode;
    const accents = [Gold, Cyan, Orange];
    this.modeButtons.forEach((b, i) => {
      b.setAccent(i === m ? accents[i] : new Color(1, 1, 1, 0.45));
      if (b.label) b.label.text = (i === m ? "● " : "") + ModeNames[i];
    });
    const d = Mathf.clamp(this.Data.get("diff", 1), 0, 2), lay = this.Data.get("layout");
    if (this.optButton.label) this.optButton.label.text = m === Mode.Solo ? `${SoloTime} SEC ROUND` : m === Mode.Cpu ? `CPU: ${DiffNames[d]}` : lay === 0 ? "LAYOUT: TABLE" : "LAYOUT: SIDE BY SIDE";
    this.optButton.setAccent(accents[m]);
    this.optButton.interactable = m !== Mode.Solo;
    if (this.shopButton.label) this.shopButton.label.text = "MALLETS & BOARDS";
    if (this.shopButton.label) this.shopButton.label.fontSize = 24;
    this.modeLabel.text = m === Mode.Solo ? "BONK AS MANY AS YOU CAN · THEY GET FASTER!"
      : m === Mode.Cpu ? `YOU HUNT CYAN · THE CPU HUNTS ORANGE · WIN ${Prizes[d]} COINS`
      : lay === 0 ? "FACE TO FACE: PLAYER 2 SITS AT THE TOP" : "SIDE BY SIDE: CYAN VS ORANGE ON ONE BOARD";
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private OpenShop(on: boolean) {
    if (on) { this.browseMallet = this.MalletStyle; this.browseBoard = this.BoardStyle; this.RefreshShop(); }
    else this.RefreshTitle();
    this.shop.setActive(on);
  }

  private Browse(row: number, d: number) {
    if (row === 0) this.browseMallet = (this.browseMallet + d + Mallets.length) % Mallets.length;
    else this.browseBoard = (this.browseBoard + d + Boards.length) % Boards.length;
    Sfx.play(Snd.Click, 0.5);
    this.RefreshShop();
  }

  private ShopAction(row: number) {
    const i = row === 0 ? this.browseMallet : this.browseBoard;
    const cost = row === 0 ? Mallets[i].cost : Boards[i].cost;
    const key = (row === 0 ? "um" : "ub") + i;
    if (this.Data.get(key) === 0 && i > 0) {
      if (this.Coins < cost) { Sfx.play(Snd.Deny, 0.6); return; }
      this.Coins = this.Coins - cost;
      this.Data.set(key, 1);
      Sfx.play(Snd.PowerUp, 0.8);
    }
    this.Data.set(row === 0 ? "mallet" : "board", i);
    if (row === 1) this.ApplyBoardStyle();
    this.RefreshShop();
  }

  private RefreshShop() {
    this.shopCoins.text = Fmt.n(this.Coins);
    const mi = this.browseMallet, bi = this.browseBoard;
    this.malletImg.sprite = MalletSprite(mi);
    this.malletName.text = Mallets[mi].name;
    this.SetAction(this.malletAction, this.MalletStyle === mi, mi === 0 || this.Data.get("um" + mi) === 1, Mallets[mi].cost);
    this.boardImg.sprite = BoardSprite(bi, 12.2, 8.95);
    this.boardName.text = Boards[bi].name;
    this.SetAction(this.boardAction, this.BoardStyle === bi, bi === 0 || this.Data.get("ub" + bi) === 1, Boards[bi].cost);
  }

  private SetAction(b: ArcadeButton, equipped: boolean, unlocked: boolean, cost: number) {
    if (b.label) b.label.text = equipped ? "EQUIPPED" : unlocked ? "EQUIP" : `UNLOCK · ${Fmt.n(cost)} COINS`;
    b.setAccent(equipped ? Pal.TextDim : unlocked ? Cyan : this.Coins >= cost ? Gold : Pal.hex(0x8a7a6a));
    b.interactable = !equipped && (unlocked || this.Coins >= cost);
  }

  private ApplyBoardStyle() {
    this.cover.sprite = CasualArt.hd(BackdropSprite(this.BoardStyle));
    this.spacingY = -1;
    this.Layout();
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.SetGrid(false); this.Layout(); this.relayout = 2; }
  private relayout = 2;

  private get Duel() { return this.State !== Phase.Title && this.mode !== Mode.Solo; }
  private get Table() { return this.Duel && this.mode === Mode.Duo && this.table; }

  /** Portrait boards are 3 wide × 4 tall, landscape 4 × 3. */
  private SetGrid(force: boolean) {
    const portrait = Screen.height >= Screen.width;
    if (!force && portrait === this.portrait && this.boardSr.sprite) return;
    this.portrait = portrait;
    this.cols = portrait ? 3 : 4;
    this.rows = portrait ? 4 : 3;
    this.spacingY = -1;
  }
  private spacingY = -1;

  /** Row spacing stretches a little so the board fills tall screens. */
  private PlaceHoles(spY: number) {
    spY = Math.round(spY * 20) / 20;
    if (spY === this.spacingY) return;
    this.spacingY = spY;
    this.boardW = this.cols * SpacingX + 1.0;
    this.boardH = this.rows * spY + 1.0;
    for (let i = 0; i < this.holes.length; i++) {
      const h = this.holes[i];
      const on = i < this.cols * this.rows;
      h.root.setActive(on);
      if (!on) { this.HideNow(h); continue; }
      const c = i % this.cols, r = Math.floor(i / this.cols);
      h.pos = new V2((c - (this.cols - 1) / 2) * SpacingX, ((this.rows - 1) / 2 - r) * spY - 0.35);
      h.root.localPosition = h.pos;
    }
    this.boardSr.sprite = BoardSprite(this.BoardStyle, this.boardW, this.boardH);
    this.boardSr.transform.localScale = new V2(this.boardW, this.boardW);
    this.boardShadow.transform.localScale = new V2(this.boardW * 1.3, this.boardH * 1.25);
    this.boardShadow.transform.localPosition = new V3(0, -0.3, 0);
  }

  private Layout() {
    if (!this.board) return;
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.cover, this.ViewSize);
    const solo = !this.Duel;
    const wideDuel = !solo && !this.portrait;
    const top = solo ? (this.portrait ? 300 : 210) : wideDuel ? 30 : 240, bottom = solo ? (this.portrait ? 120 : 40) : wideDuel ? 30 : 240;
    let r = this.PlayRect(top, bottom, 0.15);
    if (wideDuel) {
      // wide screens: the player panels sit at the left and right ends
      const k = 1080 / Math.min(this.ViewSize.x, this.ViewSize.y);
      r = this.Table ? Rect.minMaxRect(r.xMin + 330 / k, r.yMin, r.xMax - 330 / k, r.yMax) : Rect.minMaxRect(r.xMin + 620 / k, r.yMin, r.xMax - 140 / k, r.yMax);
    }
    const bw = this.cols * SpacingX + 1.0;
    const fitY = ((r.height / r.width) * bw - 1.0) / this.rows;
    this.PlaceHoles(Mathf.clamp(fitY, SpacingY, 3.3));
    this.scale = Math.min(r.width / this.boardW, r.height / this.boardH);
    if (this.State === Phase.Title) {
      const v = this.ViewSize;
      this.scale = Math.min(v.x / this.boardW, v.y / this.boardH) * 0.98;
      this.board.localPosition = V2.zero;
    } else this.board.localPosition = new V3(r.center.x, r.center.y, 0);
    this.board.localScale = new V2(this.scale, this.scale);
    this.LayoutHud(r);
  }

  private LayoutHud(r: { xMin: number; xMax: number; yMin: number; yMax: number }) {
    const duel = this.Duel;
    this.soloBar.setActive(!duel);
    this.soloCombo.gameObject.setActive(!duel);
    this.soloBar.place(new V2(0.5, 1), new V2(this.portrait ? -60 : 0, -100), new V2(this.portrait ? 900 : 1000, 170));
    for (let i = 0; i < 2; i++) {
      const p = this.panels[i];
      p.node.setActive(duel);
      if (!duel) continue;
      let anchor: V2, pos: V2, rot = 0;
      if (!this.portrait) {
        if (this.Table) { anchor = new V2(i === 0 ? 0 : 1, 0.5); pos = new V2(i === 0 ? 160 : -160, 0); rot = i === 0 ? -90 : 90; }
        else { anchor = new V2(0, i === 0 ? 0 : 1); pos = new V2(310, i === 0 ? 130 : -130); }
      } else if (this.mode === Mode.Duo && !this.table) { anchor = new V2(0.5, 0); pos = new V2((i === 0 ? -1 : 1) * 270, 105); }
      else if (i === 0) { anchor = new V2(0.5, 0); pos = new V2(0, 105); }
      else { anchor = new V2(0.5, 1); pos = new V2(this.portrait ? -60 : 0, -105); rot = this.Table ? 180 : 0; }
      const narrow = this.mode === Mode.Duo && !this.table && this.portrait;
      p.node.place(anchor, pos, new V2(narrow ? 520 : 580, 150));
      p.node.localEulerAngles = new V3(0, 0, rot);
    }
    void r;
  }

  private BoardToWorld(p: V2) { const b = this.board.localPosition; return new V2(b.x + p.x * this.scale, b.y + p.y * this.scale); }
  private WorldToBoard(w: V2) { const b = this.board.localPosition; return new V2((w.x - b.x) / this.scale, (w.y - b.y) / this.scale); }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.mode = Mode.Solo;
    this.shop?.setActive(false);
    this.ResetBoard();
    this.ApplyBoardStyle();
    this.SetGrid(true);
    this.Layout();
    this.attract = 0.5;
    this.RefreshTitle();
  }

  private ResetBoard() {
    for (const h of this.holes) this.HideNow(h);
    for (const m of this.mallets) { m.t = 9; m.root.setActive(false); }
    for (const f of this.floaters) { f.age = 9; f.t.gameObject.setActive(false); }
    this.fx.clear();
  }

  private HideNow(h: Hole) {
    h.st = St.Idle; h.rise = 0; h.targeted = false; h.mole.setActive(false); h.glow.color = h.glow.color.withAlpha(0); h.cool = 0.4;
  }

  protected BeginRun() {
    this.mode = this.SelMode;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.table = this.Data.get("layout") === 0;
    this.ResetBoard();
    this.roundTime = this.clock = this.mode === Mode.Solo ? SoloTime : DuelTime;
    this.elapsed = 0;
    this.score = [0, 0]; this.combo = [0, 0]; this.bestCombo = [0, 0]; this.hits = [0, 0]; this.golds = [0, 0]; this.bombs = [0, 0];
    this.spawned = [0, 0];
    this.taps = this.whiffs = 0; this.stun = 0;
    this.revived = this.doubled = false;
    this.ending = false; this.endT = 0;
    this.countdown = this.mode === Mode.Solo ? 1.6 : 3.2;
    this.countShown = -1;
    this.spawnT = 0.2;
    this.bot = new Bot();
    this.bot.diff = this.diff;
    this.Data.add("games", 1);
    const names = this.Names();
    for (let i = 0; i < 2; i++) this.panels[i].name.text = names[i];
    this.SetGrid(true);
    this.relayout = 3;
    this.Layout();
    Sfx.setIntensity(0.3);
    if (this.mode === Mode.Duo) this.UI.Toast(this.table ? (this.portrait ? "Cyan scores for the bottom player, orange for the top!" : "Cyan scores for the left player, orange for the right!") : "Player 1 hunts CYAN, player 2 hunts ORANGE!", 3);
    else if (this.mode === Mode.Cpu) this.UI.Toast("You hunt the CYAN moles. The CPU hunts ORANGE!", 3);
    else if (this.Data.get("games") <= 1) this.UI.Toast("Tap the moles before they duck!", 3);
    this.UpdateHud(0);
  }

  private Names() {
    if (this.mode === Mode.Cpu) return ["YOU", CpuNames[this.diff]];
    return ["PLAYER 1", "PLAYER 2"];
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.relayout > 0 && --this.relayout === 0) this.Layout();
    if (this.State === Phase.Title) {
      // attract: moles pop out by themselves and get bonked by a phantom mallet
      this.attract -= dt;
      if (this.attract <= 0) {
        this.attract = Random.range(0.35, 0.8);
        const free = this.holes.filter((h, i) => i < this.cols * this.rows && h.st === St.Idle);
        if (free.length) this.Spawn(free[Random.rangeInt(0, free.length)], Random.value < 0.15 ? Kind.Gold : Kind.Normal, -1, 1.2);
      }
      for (const h of this.holes) if ((h.st === St.Up) && h.t > 0.5 && Random.value < dt * 1.5) this.Bonk(h, -1, true);
    }
    this.TickHoles(dt);
    this.TickMallets(dt);
    this.TickFloaters(dt);
  }

  protected TickRun(dt: number) {
    if (this.relayout > 0 && --this.relayout === 0) this.Layout();
    if (this.countdown > 0) {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 0.2);
      if (this.mode === Mode.Solo) {
        if (this.countShown < 0) { this.countShown = 1; this.UI.Announce("READY?", White, 1.1); }
        if (this.countdown <= 0.2 && this.countShown === 1) { this.countShown = 0; this.UI.Announce("GO!", Gold, 0.7); Sfx.play(Snd.BeepHigh, 0.7); }
      } else if (n !== this.countShown && n >= 0) {
        this.countShown = n;
        if (n > 0) { this.UI.Announce(String(n), White, 0.7); Sfx.play(Snd.Beep, 0.6); }
        else { this.UI.Announce("SMASH!", Gold, 0.7); Sfx.play(Snd.BeepHigh, 0.7); }
      }
    } else if (!this.ending) {
      this.clock -= dt;
      this.elapsed += dt;
      const before = Math.ceil(this.clock + dt);
      if (this.clock <= 10 && this.clock > 0 && Math.ceil(this.clock) !== before) Sfx.play(Snd.Tick, 0.6, 1.3);
      if (this.clock <= 0) { this.clock = 0; this.EndRound(); }
      else { this.TickSpawner(dt); this.TickBot(dt); }
      this.ReadInput();
    } else {
      this.endT -= dt;
      if (this.endT <= 0 && this.State === Phase.Playing) { this.ShowResult(); return; }
    }
    this.stun = Math.max(0, this.stun - dt);
    this.TickHoles(dt);
    this.TickMallets(dt);
    this.TickFloaters(dt);
    this.UpdateHud(dt);
  }

  /** 0 → 1 over the round (moles speed up). */
  private get Progress() { return Mathf.clamp01(this.elapsed / this.roundTime); }

  private TickSpawner(dt: number) {
    const k = this.mode === Mode.Solo ? Mathf.clamp01(this.elapsed / SoloTime) : this.Progress;
    const duel = this.mode !== Mode.Solo;
    const interval = duel ? Mathf.lerp(0.62, 0.3, k) : Mathf.lerp(0.9, 0.34, Ease.inOutSine(k));
    const maxUp = duel ? Math.round(Mathf.lerp(3, 6, k)) : Math.round(Mathf.lerp(2, 5, k));
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    const up = this.holes.filter((h) => h.st !== St.Idle).length;
    if (up >= maxUp) { this.spawnT = 0.08; return; }
    const free = this.holes.filter((h, i) => i < this.cols * this.rows && h.st === St.Idle && h.cool <= 0);
    if (!free.length) { this.spawnT = 0.08; return; }
    const h = free[Random.rangeInt(0, free.length)];
    // what pops out
    const r = Random.value;
    let kind = Kind.Normal;
    if (this.elapsed > 4) {
      if (r < 0.07) kind = Kind.Gold;
      else if (r < 0.19) kind = Kind.Bomb;
      else if (r < 0.28 && this.elapsed > 12) kind = Kind.Helmet;
    }
    let team = -1;
    if (duel) {
      // keep both colours fair: the team that has had fewer moles is more likely
      const d = this.spawned[0] - this.spawned[1];
      team = Random.value < 0.5 - Mathf.clamp(d * 0.12, -0.4, 0.4) ? 0 : 1;
      this.spawned[team]++;
    }
    const upTime = (duel ? Mathf.lerp(1.3, 0.78, k) : Mathf.lerp(1.35, 0.62, k)) * (kind === Kind.Gold ? 0.75 : kind === Kind.Bomb ? 1.3 : kind === Kind.Helmet ? 1.35 : 1) * Random.range(0.85, 1.15);
    this.Spawn(h, kind, team, upTime);
    this.spawnT = interval * Random.range(0.7, 1.3);
  }

  private Spawn(h: Hole, kind: Kind, team: number, upTime: number) {
    h.kind = kind; h.team = team; h.up = upTime; h.t = 0; h.st = St.Rising; h.rise = 0; h.hp = kind === Kind.Helmet ? 2 : 1;
    h.targeted = false; h.squash = 0; h.hitBy = -1;
    h.flipped = this.Table && this.portrait && team === 1;
    h.holder.localEulerZ = h.flipped ? 180 : 0;
    h.front.transform.localEulerZ = h.flipped ? 180 : 0;
    h.front.transform.localPosition = new V3(0, h.flipped ? 0 : 0, 0);
    const fur = kind === Kind.Gold ? Gold : team === 0 ? Cyan : team === 1 ? Orange : Brown;
    const key = kind === Kind.Gold ? "gold" : team === 0 ? "team0" : team === 1 ? "team1" : "brown";
    h.body.sprite = MoleBody(fur, key, kind === Kind.Gold);
    h.eyes.sprite = MoleEyes(kind === Kind.Bomb ? 2 : kind === Kind.Gold ? 3 : 0);
    h.extra.gameObject.setActive(kind === Kind.Helmet || kind === Kind.Bomb);
    if (kind === Kind.Helmet) { h.extra.sprite = HelmetSprite(); h.extra.transform.localPosition = V3.zero; h.extra.transform.localEulerZ = 0; h.extra.color = Color.white; }
    if (kind === Kind.Bomb) h.extra.sprite = BombSprite(fur, key);
    h.band.gameObject.setActive(kind === Kind.Gold && team >= 0);
    if (team >= 0) h.band.color = TeamCol[team];
    h.spark.gameObject.setActive(kind === Kind.Bomb);
    h.mole.setActive(true);
    h.mole.localScale = new V2(MoleScale, MoleScale);
    if (this.State === Phase.Playing) Sfx.playClip(this.popClip, 0.35, Random.range(0.9, 1.15));
  }

  private TickHoles(dt: number) {
    for (const h of this.holes) {
      h.cool -= dt;
      if (h.st === St.Idle) { h.glow.color = h.glow.color.withAlpha(Mathf.moveTowards(h.glow.color.a, 0, dt * 3)); continue; }
      h.t += dt;
      switch (h.st) {
        case St.Rising: h.rise = Ease.outBack(Mathf.clamp01(h.t / 0.14)); if (h.t >= 0.14) { h.st = St.Up; h.t = 0; } break;
        case St.Up: h.rise = 1; if (h.t >= h.up) { h.st = St.Hiding; h.t = 0; this.Escaped(h); } break;
        case St.Hiding: h.rise = 1 - Ease.outCubic(Mathf.clamp01(h.t / 0.16)); if (h.t >= 0.16) { this.HideNow(h); continue; } break;
        case St.Bonked: {
          const k = h.t;
          h.squash = Mathf.clamp01(1 - k / 0.18);
          h.rise = k < 0.2 ? 1 : 1 - Ease.outCubic(Mathf.clamp01((k - 0.2) / 0.22));
          if (k >= 0.42) { this.HideNow(h); continue; }
          break;
        }
      }
      // place the mole: it rises out of the hole line, everything under the line is cropped
      const y = Mathf.lerp(DownY, UpY, h.rise) * MoleScale;
      const sq = h.squash;
      const sx = MoleScale * (1 + 0.18 * sq), sy = MoleScale * (1 - 0.22 * sq);
      h.mole.localScale = new V2(sx, sy);
      const ty = y - (MoleH * 0.5) * (MoleScale - sy);
      h.mole.localPosition = new V3(Math.sin(h.t * 50) * 0.04 * (h.st === St.Up && h.kind === Kind.Bomb ? 1 : 0), ty, 0);
      const top = ty + (MoleH * 0.5) * sy;
      const vis = Mathf.clamp01(top / (MoleH * sy));
      h.body.visible = h.eyes.visible = h.extra.visible = h.band.visible = vis;
      h.spark.enabled = vis > 0.55;
      if (h.kind === Kind.Bomb) h.spark.color = new Color(1, 0.75 + 0.25 * Math.sin(h.t * 40), 0.3, 0.7 + 0.3 * Math.sin(h.t * 33));
      const team = h.kind === Kind.Gold && h.team < 0 ? Gold : h.team >= 0 ? TeamCol[h.team] : h.kind === Kind.Gold ? Gold : Color.clear;
      const ga = h.st === St.Bonked ? 0 : h.team >= 0 ? 0.55 * h.rise : h.kind === Kind.Gold ? 0.6 * h.rise : 0;
      h.glow.color = (h.kind === Kind.Bomb ? Red : team).withAlpha(ga + (h.kind === Kind.Bomb ? 0.15 * Math.sin(h.t * 12) * h.rise : 0));
      if (h.kind === Kind.Gold && h.st === St.Up && Random.value < dt * 6) this.fx.sparkle(h.pos.add(new V2(Random.range(-0.6, 0.6), Random.range(0.3, 1.6) * (h.flipped ? -1 : 1))), Gold, 1, 0.1, 0.35);
    }
  }

  /** A mole ducked without being hit: it breaks its colour's combo. */
  private Escaped(h: Hole) {
    if (this.State !== Phase.Playing || this.ending) return;
    if (h.kind === Kind.Bomb) return;
    const team = this.mode === Mode.Solo ? 0 : h.team;
    if (team < 0) return;
    if (this.combo[team] >= 5) this.Float(h.pos.add(new V2(0, 1.2 * (h.flipped ? -1 : 1))), "COMBO LOST", Pal.TextDim, h.flipped ? 180 : 0, 0.8);
    this.combo[team] = 0;
  }

  // ------------------------------------------------------------------ input

  private ReadInput() {
    const taps: V2[] = [];
    if (Touchscreen.present) for (const t of Touchscreen.touches) if (t.press.wasPressedThisFrame && !overUI(t.position)) taps.push(t.position);
    if (Mouse.leftButton.wasPressedThisFrame && !overUI(Mouse.position) && !(Touchscreen.present && Touchscreen.touches.length)) taps.push(Mouse.position);
    for (const s of taps) this.Tap(this.WorldToBoard(this.ScreenToWorld(s)), s);
  }

  /** Which player a tap belongs to (only matters for mallet art): the half of the screen it came from. */
  private SideOf(screen: V2) {
    if (this.mode === Mode.Duo && this.table && this.portrait) return screen.y > Screen.height * 0.5 ? 1 : 0;
    if (this.mode === Mode.Duo) return screen.x > Screen.width * 0.5 ? 1 : 0;
    return 0;
  }

  private Tap(p: V2, screen: V2) {
    if (Math.abs(p.x) > this.boardW / 2 + 0.6 || Math.abs(p.y) > this.boardH / 2 + 0.6) return;
    const side = this.SideOf(screen);
    const human = this.mode !== Mode.Duo; // solo / vs: the only tapper is player 1
    if (human && this.stun > 0) { Sfx.play(Snd.Deny, 0.4); return; }
    this.taps++;
    const hit = this.FindMole(p);
    this.Swing(hit ? hit.pos.add(new V2(0, (hit.flipped ? -1 : 1) * 0.55)) : p, this.Table && side === 1 ? 1 : 0, this.MalletStyle, !!hit);
    if (!hit) {
      Sfx.playClip(this.whiffClip, 0.5, Random.range(0.9, 1.1));
      if (human) {
        this.whiffs++;
        if (this.combo[0] >= 3) this.Float(p.add(new V2(0, 0.6)), "MISS", Pal.TextDim, 0, 0.8);
        this.combo[0] = 0;
      }
      return;
    }
    this.Bonk(hit, human ? 0 : -1, false);
  }

  private FindMole(p: V2): Hole | null {
    let best: Hole | null = null, bd = 1e9;
    for (const h of this.holes) {
      if (h.st !== St.Rising && h.st !== St.Up) continue;
      if (h.rise < 0.3 && h.st === St.Rising && h.t < 0.05) continue;
      const lx = p.x - h.pos.x, ly = (p.y - h.pos.y) * (h.flipped ? -1 : 1);
      if (Math.abs(lx) > 1.15 || ly < -0.75 || ly > 2.1) continue;
      const d = Math.hypot(lx, ly - 0.7);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  // ------------------------------------------------------------------ hits

  /** `by` = 0 when player 1 (solo / vs human) swung, 1 for the CPU, -1 unknown (2 players) or attract mode. */
  private Bonk(h: Hole, by: number, attract: boolean) {
    const head = h.pos.add(new V2(0, (h.flipped ? -1 : 1) * 0.9));
    if (attract) {
      this.Swing(h.pos.add(new V2(0, (h.flipped ? -1 : 1) * 0.55)), 0, this.MalletStyle, true);
      h.st = St.Bonked; h.t = 0; h.eyes.sprite = MoleEyes(1);
      this.fx.pop(head, h.kind === Kind.Gold ? Gold : White, 8, 3.5, 0.2, 0.35);
      return;
    }
    const solo = this.mode === Mode.Solo;
    // the team whose colour this mole is (solo: always player 1)
    const team = solo ? 0 : h.team;
    if (h.kind === Kind.Helmet && h.hp > 1) {
      h.hp--;
      Sfx.playClip(this.clankClip, 0.8, Random.range(0.95, 1.05));
      this.fx.sparkle(head, White, 6, 0.5, 0.35);
      this.FlyHelmet(h);
      h.t = Math.max(0, h.t - 0.35); // stays up a little longer for the second hit
      h.squash = 1;
      if (by === 0) { this.stun = 0.35; this.stunText.text = "CLANK!"; }
      this.Fx.shake(0.12);
      return;
    }
    h.st = St.Bonked; h.t = 0; h.hitBy = by;
    h.eyes.sprite = MoleEyes(1);
    if (h.kind === Kind.Bomb) {
      h.extra.gameObject.setActive(false);
      h.spark.gameObject.setActive(false);
      Sfx.playClip(this.boomClip, 0.9);
      this.fx.pop(head, Pal.hex(0xff7a1a), 26, 7, 0.35, 0.5);
      this.fx.pop(head, Pal.hex(0x3a3a3a), 14, 4, 0.5, 0.8);
      this.Fx.shake(0.6);
      this.Back.Flash(Red, 0.4);
      Fx.haptic(true);
      const loss = solo ? 50 : 30;
      this.score[team] = Math.max(0, this.score[team] - loss);
      this.combo[team] = 0;
      this.bombs[team]++;
      if (solo || by === 0) { this.stun = solo ? 0.8 : 0.5; this.stunText.text = "BOOM!"; }
      this.Float(head.add(new V2(0, 0.4 * (h.flipped ? -1 : 1))), `−${loss}`, Red, this.FloatRot(team), 1.3);
      this.panels[team].pop = 1;
      return;
    }
    // a good hit for the mole's colour
    this.hits[team]++;
    this.combo[team]++;
    this.bestCombo[team] = Math.max(this.bestCombo[team], this.combo[team]);
    const mult = this.Mult(team);
    const base = h.kind === Kind.Gold ? 50 : h.kind === Kind.Helmet ? 30 : 10;
    const pts = base * mult;
    this.score[team] += pts;
    if (h.kind === Kind.Gold) { this.golds[team]++; Sfx.playClip(this.goldClip, 0.8); this.fx.confetti(head, 22, 6, [Gold, Color.white, Pal.hex(0xffe58a)], 0.22); this.Back.Flash(Gold, 0.25); }
    Sfx.playClip(this.bonkClip, 0.9, Random.range(0.92, 1.1) + Math.min(0.3, this.combo[team] * 0.01));
    if (this.MalletStyle === 1) Sfx.playClip(this.squeakClip, 0.5, Random.range(0.9, 1.2));
    const col = team >= 0 && !solo ? TeamCol[team] : h.kind === Kind.Gold ? Gold : White;
    this.fx.pop(head, col, 10, 4.5, 0.22, 0.4);
    for (let i = 0; i < 3; i++) this.fx.emit(head.add(new V2(Random.range(-0.5, 0.5), 0.3)), new V2(Random.range(-1, 1), 2.5), Gold, 0.35, 0.7, CasualArt.StarShape, 3, Random.range(-300, 300), true, 1);
    this.Fx.shake(h.kind === Kind.Gold ? 0.3 : 0.12);
    this.Hitstop(0.035);
    Fx.haptic(h.kind === Kind.Gold);
    this.Float(head.add(new V2(0, 0.5 * (h.flipped ? -1 : 1))), `+${pts}`, h.kind === Kind.Gold ? Gold : col, this.FloatRot(team), h.kind === Kind.Gold ? 1.4 : 1);
    this.panels[team].pop = 1;
    if (mult > this.Mult(team, this.combo[team] - 1)) {
      Sfx.playClip(this.comboClip, 0.6);
      this.Float(head.add(new V2(0, 1.4 * (h.flipped ? -1 : 1))), `COMBO ×${mult}!`, Gold, this.FloatRot(team), 1.2);
      if (solo) this.soloPop = 1;
    }
  }
  private soloPop = 0;

  private Mult(team: number, combo = this.combo[team]) {
    if (this.mode === Mode.Solo) return Math.min(5, 1 + Math.floor(combo / 5));
    return Math.min(3, 1 + Math.floor(combo / 6));
  }

  private FloatRot(team: number) { return !this.Table ? 0 : this.portrait ? (team === 1 ? 180 : 0) : team === 1 ? 90 : -90; }

  private FlyHelmet(h: Hole) {
    h.extra.gameObject.setActive(false);
    const dir = h.flipped ? -1 : 1;
    const p = h.pos.add(new V2(0, 1.3 * dir));
    for (let i = 0; i < 6; i++) this.fx.emit(p, new V2(Random.range(-3, 3), Random.range(3, 6) * dir), Pal.hex(0xc8d0dc), 0.25, 0.5, null, 10 * dir, 0, true, 1);
    this.fx.emit(p, new V2(Random.range(-2, 2), 6 * dir), Color.white, 1.4, 0.7, HelmetSprite(), 14 * dir, Random.range(-500, 500), false, 0.5);
  }

  // ------------------------------------------------------------------ mallets

  private Swing(target: V2, side: number, style: number, hit: boolean) {
    let m = this.mallets.find((x) => x.t > 0.45);
    if (!m) m = this.mallets.reduce((a, b) => (a.t > b.t ? a : b));
    m.t = 0; m.side = side; m.hit = hit;
    if (m.style !== style || !m.sr.sprite) { m.style = style; m.sr.sprite = MalletSprite(style); }
    m.root.setActive(true);
    m.root.localPosition = target;
    m.root.localEulerZ = side === 1 ? 180 : 0;
    m.bonk.color = new Color(1, 1, 1, 0);
  }

  private TickMallets(dt: number) {
    for (const m of this.mallets) {
      if (m.t > 9) continue;
      m.t += dt;
      if (m.t > 0.45) { m.root.setActive(false); m.t = 10; continue; }
      // wind-up → strike → hold → fade. The arm pivots around the grip, lower right of the target.
      const k = m.t;
      const strike = Ease.outCubic(Mathf.clamp01(k / 0.07));
      const ang = Mathf.lerp(5, 52, strike);
      const s = Mathf.lerp(1.3, 1, strike);
      const L = 1.26 * 1.15;
      const rad = ang * Mathf.Deg2Rad;
      void rad;
      m.arm.localPosition = new V3(Math.sin(52 * Mathf.Deg2Rad) * L, -Math.cos(52 * Mathf.Deg2Rad) * L, 0);
      m.arm.localEulerZ = ang;
      m.arm.localScale = new V2(s, s);
      const fade = k > 0.3 ? 1 - (k - 0.3) / 0.15 : 1;
      m.sr.color = Color.white.withAlpha(Mathf.clamp01(fade));
      const bk = Mathf.clamp01((k - 0.06) / 0.2);
      m.bonk.color = new Color(1, 1, 1, m.hit && k > 0.06 ? (1 - bk) * 0.95 : 0);
      const bs = Mathf.lerp(0.6, 1.4, Ease.outCubic(bk));
      m.bonk.transform.localScale = new V2(bs, bs);
    }
  }

  // ------------------------------------------------------------------ bot

  private TickBot(dt: number) {
    if (this.mode !== Mode.Cpu) return;
    const b = this.bot;
    if (b.target) {
      const h = b.target;
      b.timer -= dt;
      if (h.st !== St.Rising && h.st !== St.Up) { h.targeted = false; b.target = null; b.cool = 0.1; return; }
      if (b.timer > 0) return;
      const acc = [0.8, 0.9, 0.97][b.diff];
      h.targeted = false;
      b.target = null;
      b.cool = [0.25, 0.12, 0.05][b.diff];
      if (Random.value < acc) {
        this.Swing(h.pos.add(new V2(0, 0.55)), 0, 0, true);
        this.Bonk(h, 1, false);
        if (h.st === St.Up && h.kind === Kind.Helmet) { b.target = h; h.targeted = true; b.timer = [0.5, 0.3, 0.18][b.diff]; }
      } else {
        this.Swing(h.pos.add(new V2(Random.range(-1.2, 1.2), Random.range(-0.6, 0.2))), 0, 0, false);
        Sfx.playClip(this.whiffClip, 0.4);
      }
      return;
    }
    b.cool -= dt;
    if (b.cool > 0) return;
    const cands = this.holes.filter((h) => (h.st === St.Rising || h.st === St.Up) && !h.targeted && h.rise > 0.2
      && ((h.team === 1 && h.kind !== Kind.Bomb) || (b.diff === 2 && h.team === 0 && h.kind === Kind.Bomb)));
    if (!cands.length) return;
    // golden first, then the mole that has been up the longest
    cands.sort((a, c) => (c.kind === Kind.Gold ? 1 : 0) - (a.kind === Kind.Gold ? 1 : 0) || (c.t - a.t));
    const h = b.diff === 0 ? cands[Random.rangeInt(0, cands.length)] : cands[0];
    const react = [[0.7, 1.15], [0.45, 0.75], [0.3, 0.5]][b.diff];
    b.target = h; h.targeted = true; b.timer = Random.range(react[0], react[1]);
  }

  // ------------------------------------------------------------------ floats

  private Float(boardPos: V2, text: string, color: Color, rot: number, scale = 1) {
    let f = this.floaters.find((x) => x.age >= x.life);
    if (!f) f = this.floaters.reduce((a, b) => (a.age > b.age ? a : b));
    f.age = 0; f.life = 0.95; f.rot = rot;
    f.t.text = text;
    f.t.color = color;
    f.t.fontSize = Math.round(56 * scale);
    f.start = this.UI.WorldToHud(this.BoardToWorld(boardPos));
    f.t.gameObject.setActive(true);
    f.t.rectTransform.place(UIKit.Center, f.start, new V2(600, 90));
    f.t.rectTransform.localEulerAngles = new V3(0, 0, rot);
  }

  private TickFloaters(dt: number) {
    for (const f of this.floaters) {
      if (f.age >= f.life) continue;
      f.age += dt;
      if (f.age >= f.life) { f.t.gameObject.setActive(false); continue; }
      const k = f.age / f.life;
      const up = V2.fromAngle((f.rot + 90) * Mathf.Deg2Rad, 110 * Ease.outCubic(k));
      f.t.rectTransform.anchoredPosition = f.start.add(up);
      const pop = k < 0.15 ? Mathf.lerp(0.4, 1.25, k / 0.15) : Mathf.lerp(1.25, 1, Mathf.clamp01((k - 0.15) / 0.2));
      f.t.rectTransform.localScale = new V3(pop, pop, 1);
      f.t.color = f.t.color.withAlpha(k < 0.65 ? 1 : 1 - (k - 0.65) / 0.35);
    }
  }

  // ------------------------------------------------------------------ HUD update

  private UpdateHud(dt: number) {
    const clock = Fmt.clock(Math.ceil(Math.max(0, this.clock)));
    const low = this.clock <= 10 && this.countdown <= 0;
    const tc = low ? Color.lerp(Red, Color.white, 0.5 + 0.5 * Math.sin(Time.time * 10)) : White;
    if (this.mode === Mode.Solo) {
      this.soloScore.text = Fmt.n(this.score[0]);
      this.soloBest.text = `BEST ${Fmt.n(this.Data.get("best"))}`;
      this.soloTimer.text = clock;
      this.soloTimer.color = tc;
      UIKit.setMeter(this.timerFill, this.clock / this.roundTime);
      const m = this.Mult(0);
      this.soloPop = Mathf.moveTowards(this.soloPop, 0, dt * 2.5);
      this.soloCombo.text = this.combo[0] >= 2 ? (m > 1 ? `COMBO ${this.combo[0]}  ·  ×${m}` : `COMBO ${this.combo[0]}`) : "";
      const s = 1 + 0.35 * Ease.outCubic(this.soloPop);
      this.soloCombo.rectTransform.localScale = new V3(s, s, 1);
      this.soloCombo.color = Color.lerp(Gold, Color.white, this.soloPop);
    } else {
      for (let i = 0; i < 2; i++) {
        const p = this.panels[i];
        p.score.text = Fmt.n(this.score[i]);
        const m = this.Mult(i);
        p.combo.text = m > 1 ? `×${m}` : this.combo[i] >= 2 ? `${this.combo[i]} HITS` : "";
        p.timer.text = clock;
        p.timer.color = tc;
        p.pop = Mathf.moveTowards(p.pop, 0, dt * 3);
        const s = 1 + 0.25 * Ease.outCubic(p.pop);
        p.score.rectTransform.localScale = new V3(s, s, 1);
        const lead = this.score[i] > this.score[1 - i];
        p.bg.color = lead ? Color.lerp(new Color(0.1, 0.05, 0.18, 0.82), TeamCol[i], 0.25) : new Color(0.1, 0.05, 0.18, 0.78);
      }
    }
    if (this.stun <= 0) this.stunText.text = "";
    else this.stunText.rectTransform.anchoredPosition = new V2(0, -Math.sin(Time.time * 20) * 6 + (this.portrait ? 0 : -50));
  }

  // ------------------------------------------------------------------ end

  private EndRound() {
    this.ending = true;
    this.endT = 1.7;
    for (const h of this.holes) if (h.st === St.Rising || h.st === St.Up) { h.st = St.Hiding; h.t = 0; }
    const head = this.mode === Mode.Solo ? "TIME UP!" : this.score[0] === this.score[1] ? "DRAW!" : this.mode === Mode.Cpu ? (this.score[0] > this.score[1] ? "YOU WIN!" : "CPU WINS") : `${this.Names()[this.score[0] > this.score[1] ? 0 : 1]} WINS!`;
    const good = this.mode !== Mode.Cpu || this.score[0] >= this.score[1];
    this.UI.Announce(head, good ? Gold : Red, 1.6);
    Sfx.play(good ? Snd.Win : Snd.Lose, 0.8);
    if (good) this.fx.confetti(new V2(0, this.boardH * 0.3), 70, 9, [Cyan, Orange, Gold, Color.white], 0.3);
  }

  private ShowResult() {
    if (this.mode === Mode.Solo) this.SoloResult();
    else if (this.mode === Mode.Cpu) this.CpuResult();
    else this.DuoResult();
  }

  private Accuracy() { return this.taps > 0 ? Math.round((100 * this.hits[0]) / Math.max(1, this.taps)) : 0; }

  private SoloResult() {
    const s = this.score[0];
    const prevBest = this.Data.get("best");
    const newBest = this.Data.max("best", s);
    const stars = s >= StarScores[2] ? 3 : s >= StarScores[1] ? 2 : s >= StarScores[0] ? 1 : 0;
    const earned = Math.floor(s / 20);
    this.lastPrize = earned;
    this.Coins = this.Coins + earned;
    this.Data.add("hits", this.hits[0]);
    this.Data.max("stars", stars);
    const reward = !this.revived ? () => this.Continue() : !this.doubled && earned > 0 ? () => this.DoubleCoins() : null;
    this.Finish(new Result({
      Headline: (stars === 3 ? "MOLE MASTER!" : stars > 0 ? "TIME UP!" : "TIME UP!") + "   " + "★".repeat(stars) + "☆".repeat(3 - stars),
      HeadlineColor: stars > 0 ? Gold : Pal.hex(0xffb0c0),
      Value: Fmt.n(s), CountTo: s, Stars: -1, NewBest: newBest && prevBest > 0, Victory: stars > 0,
      BestLine: `BEST ${Fmt.n(this.Data.get("best"))}   ·   +${earned} COINS`,
      Stats: [["MOLES BONKED", String(this.hits[0])], ["BEST COMBO", String(this.bestCombo[0])], ["ACCURACY", `${this.Accuracy()}%`], ["GOLDEN MOLES", String(this.golds[0])]],
      Primary: "PLAY AGAIN",
      Reward: reward,
      RewardLabel: !this.revived ? `+${ContinueTime} SECONDS · KEEP GOING (AD)` : `DOUBLE COINS: +${earned} (AD)`,
    }));
  }

  private CpuResult() {
    const won = this.score[0] > this.score[1], draw = this.score[0] === this.score[1];
    const prize = won ? Prizes[this.diff] : draw ? 20 : 10;
    this.lastPrize = prize;
    this.Coins = this.Coins + prize;
    if (won) { this.Data.add("wins", 1); this.Data.add("w" + this.diff, 1); }
    const stats: [string, string][] = [["SCORE", `${Fmt.n(this.score[0])} – ${Fmt.n(this.score[1])}`], ["YOUR HITS", String(this.hits[0])], ["BEST COMBO", String(this.bestCombo[0])], ["ACCURACY", `${this.Accuracy()}%`]];
    this.Finish(new Result({
      Headline: won ? `YOU BEAT THE ${DiffNames[this.diff]} CPU!` : draw ? "IT'S A DRAW" : "THE CPU WINS",
      HeadlineColor: won ? Gold : Pal.hex(0xffb0c0),
      Value: `+${prize}`, CountTo: prize, Victory: won,
      BestLine: `${Fmt.n(this.score[0])} – ${Fmt.n(this.score[1])}   ·   COINS ${Fmt.n(this.Coins)}`,
      Stats: stats, Primary: won ? "PLAY AGAIN" : "REMATCH",
      Reward: won ? (() => this.DoubleCoins()) : !this.revived ? (() => this.Continue()) : null,
      RewardLabel: won ? `DOUBLE COINS: +${prize} (AD)` : `+${ContinueTime} SECONDS TO CATCH UP (AD)`,
    }));
  }

  private DuoResult() {
    const names = this.Names(), w = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
    this.Data.add("duels", 1);
    this.Finish(new Result({
      Headline: w < 0 ? "IT'S A DRAW!" : `${names[w]} WINS!`, HeadlineColor: w < 0 ? Gold : TeamCol[w], Victory: true,
      Value: `${Fmt.n(this.score[0])} – ${Fmt.n(this.score[1])}`,
      BestLine: "CYAN VS ORANGE",
      Stats: [["P1 HITS", String(this.hits[0])], ["P2 HITS", String(this.hits[1])], ["P1 BEST COMBO", String(this.bestCombo[0])], ["P2 BEST COMBO", String(this.bestCombo[1])]],
      Primary: "REMATCH",
    }));
  }

  private Continue() {
    this.revived = true;
    this.Coins = this.Coins - this.lastPrize; // the round is not over yet: its coins are paid again at the end
    this.clock = ContinueTime;
    this.roundTime = Math.max(this.roundTime, ContinueTime);
    this.ending = false;
    this.Revive();
    this.countdown = 1.2; this.countShown = -1;
    this.UI.Announce(`+${ContinueTime} SECONDS!`, Gold, 1.2);
    this.relayout = 2;
  }

  private DoubleCoins() {
    this.doubled = true;
    this.Coins = this.Coins + this.lastPrize;
    this.UI.Toast(`+${this.lastPrize} COINS: DOUBLED!`, 2.5);
    Sfx.play(Snd.Coin, 0.8);
  }

  /** Test hook for scripted play: the board-space centres of moles that are up, in CSS pixels. */
  debugMoles() {
    const out: { i: number; x: number; y: number; kind: number; team: number; st: number }[] = [];
    const c = document.querySelector("canvas");
    if (!c) return out;
    const r = c.getBoundingClientRect(), k = c.width / r.width;
    this.holes.forEach((h, i) => {
      if (h.st !== St.Rising && h.st !== St.Up) return;
      const w = this.BoardToWorld(h.pos.add(new V2(0, (h.flipped ? -1 : 1) * 0.75)));
      const sp = (window as unknown as { __na: { Camera: { worldToScreen(p: V2): { x: number; y: number } } } }).__na.Camera.worldToScreen(w);
      out.push({ i, x: r.left + sp.x / k, y: r.top + sp.y / k, kind: h.kind, team: h.team, st: h.st });
    });
    return out;
  }
  get AdReady() { return AdService.rewardedAvailable; }
}
