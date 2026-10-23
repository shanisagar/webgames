import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Ease, Fmt, Fx, GameInfo, GameObject, howTo, Image,
  Mathf, Mouse, OnlineRoom, overUI, Pal, Phase, Random, Result, Screen, Sfx, Snd, SpriteRenderer, tableCodeFromUrl, TapPointer, Text, TextAnchor, Time,
  TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import { OnlineLink } from "./OnlineLink";
import { TableLobby, TableOverlay } from "./OnlineUI";
import { CoinSprite, DotSprite, DoodleCount, DoodleSprite, Gold, HatchSprite, InkDrop, Panel, Papers, PaperSprite, SheetShadow, StrokeSprite } from "./DotsArt";
import { Board, DotsBot, makePuzzle, Puzzle } from "./DotsEngine";

/**
 * DOTS & BOXES: the graph-paper game from boring lectures. Take turns drawing a line between two neighbouring dots;
 * closing the fourth side of a box claims it (it gets your colour and a doodle) and you go again. Most boxes wins.
 * Boards 4×4, 5×5 or 6×6. VS COMPUTER: EASY grabs what it sees, MEDIUM never hands you a third side if it can help
 * it, HARD plays for chain control (double-crosses, chain parity and an exact endgame search). 2 PLAYERS: TABLE
 * face-off (player 2's side is turned around) or same side. SOLO: puzzle stages: claim N boxes with M lines of
 * ink (lines that close a box are free). A rewarded ad takes back a move once per game; coins unlock paper styles.
 */

enum Mode { Solo, Cpu, Duo, Online }
const ModeNames = ["SOLO", "VS CPU", "2 PLAYERS", "ONLINE"];
/** Online: the guest's pen (the host draws in the paper's first pen colour). */
const GuestPink = Pal.hex(0xff4fa0);
const OnlinePrize = 60;
/** Online match payloads: board size and who moves first (0 = host, 1 = guest); a snapshot replays the moves. */
interface OStart { size: number; first: number }
interface OSnap { size: number; first: number; moves: number[] }
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const Sizes = [4, 5, 6];
const Prizes = [20, 50, 100];
const ModeAccents = [Pal.hex(0x5ce07a), Pal.hex(0x3a9cff), Pal.hex(0xff7a4a), Pal.hex(0xff4fa0)];

class Edge { sr!: SpriteRenderer; t = 9; owner = -1; pre = false; }
class Box { hatch!: SpriteRenderer; doodle!: SpriteRenderer; t = 9; owner = -1; kind = 0; flip = false; }
class PanelUI { node!: UINode; bg!: Image; edge!: Image; name!: Text; score!: Text; turn!: Text; swatch!: Image; glow = 0; pop = 0; }

export class DotsBoxesGame extends ArcadeGame {
  private world!: GameObject; private board!: GameObject;
  private cover!: SpriteRenderer; private sheet!: SpriteRenderer; private sheetShadow!: SpriteRenderer;
  private dots: SpriteRenderer[] = [];
  private edges: Edge[] = [];
  private boxes: Box[] = [];
  private ghost!: SpriteRenderer;
  private fx!: CasualFx;
  private pointer = new TapPointer();

  private bd = new Board(4);
  private n = 4; private scale = 1;
  private mode = Mode.Cpu; private diff = 1; private table = true;
  private turn = 0; private first = 0; private bot = new DotsBot(1);
  private botT = 0; private busy = 0; private ended = false; private endT = 0;
  private undoUsed = false; private lastPrize = 0;
  private puzzle: Puzzle | null = null; private stage = 1; private ink = 0; private inkUsed = 0; private clock = 0;
  private humanMoves = 0; private lastGot = 0; private chainCount = 0;
  private portrait = true;
  private attractT = 0; private attractBot = new DotsBot(1);
  // online
  private lobby!: TableLobby; private overlay!: TableOverlay;
  private link: OnlineLink<OStart, number, OSnap> | null = null;
  private me = 0; private onlineStart: OStart = { size: 5, first: 0 }; private onlineGo = false; private autoJoined = false; private forfeit = false;

  // HUD
  private panels: PanelUI[] = [];
  private soloBar!: UINode; private soloStage!: Text; private soloGoal!: Text; private soloTime!: Text; private inkIcons: Image[] = [];
  private undoButton!: ArcadeButton;
  private hintText!: Text;
  // title
  private modeButtons: ArcadeButton[] = []; private optButton!: ArcadeButton; private sizeButton!: ArcadeButton; private shopButton!: ArcadeButton; private modeLabel!: Text;
  private shop!: UINode; private shopCoins!: Text; private shopName!: Text; private shopImg!: Image; private shopAction!: ArcadeButton; private browse = 0;

  private scratchClip!: AudioClip; private claimClip!: AudioClip; private chainClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "dotsboxes",
      Title: "DOTS & BOXES",
      Tagline: "CLOSE A BOX, GO AGAIN!",
      PlayLabel: "PLAY",
      Accent: Pal.hex(0x3a7cff),
      Accent2: Pal.hex(0xff5a3a),
      BgTop: Pal.hex(0x2a3050),
      BgBottom: Pal.hex(0x141a30),
      ShortSide: 10,
      Touch: TouchScheme.None,
      Music: { bpm: 96, rootHz: 146.8, degrees: [0, 5, 3, 4], seed: 77, energy: 0.3, major: true },
      Reminders: [
        "Bored? Grab a pen|A quick game of Dots & Boxes.",
        "The HARD CPU plays the long game|Can you out-chain it?",
        "New puzzle stage waiting|Claim the boxes with your ink.",
      ],
      HowTo: [
        howTo(Art.Square, Pal.hex(0x3a7cff), "TAP between two neighbouring dots to draw a line."),
        howTo(Art.Star, Gold, "Close the 4th side of a box to claim it, and you go again!"),
        howTo(Art.Diamond, Pal.hex(0xff5a3a), "Careful: drawing the 3rd side of a box hands it to your opponent."),
        howTo(Art.Chevron, Pal.hex(0x5ce07a), "Most boxes wins. Sometimes it pays to give away two boxes to keep control of a long chain."),
        howTo(Art.Ring, Pal.hex(0x9a7aff), "SOLO puzzles: claim the goal with the ink you have. Lines that close a box are free."),
        howTo(Art.Disc, Pal.hex(0xffb020), "2 PLAYERS: TABLE puts you face to face, or sit side by side."),
      ],
      Tips: [
        "Avoid drawing the third side of a box.",
        "Long chains decide the game: count them.",
        "Late in the game, the player who must open a chain usually loses.",
        "Give away two boxes at the end of a chain to keep control.",
      ],
    });
  }

  protected get ShortSide() { return 10; }
  private get Coins() { return this.Data.get("coins"); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, Math.round(v))); }
  private get Paper() { return Mathf.clamp(this.Data.get("paper"), 0, Papers.length - 1); }
  private get Pens(): [Color, Color] { const p = Papers[this.Paper].pens; return this.mode === Mode.Online ? [p[0], GuestPink] : p; }
  protected BestLine() { return `PUZZLE STAGE ${this.Data.get("stage", 1)}   ·   COINS ${Fmt.n(this.Coins)}`; }
  protected StatsLine() { return ""; }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__db = { game: this, star: () => CasualArt.StarShape };
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Data.set("mode", 1); this.Data.set("diff", 1); this.Data.set("size", 1); this.Data.set("stage", 1); }
    CasualLook.calm(this, 1.5, 0.12);
    this.world = new GameObject("DotsWorld", this.gameObject);
    this.cover = CasualLook.cover(this.world, PaperSprite(this.Paper), -910);
    this.board = new GameObject("Board", this.world);
    this.sheetShadow = Art.spr(this.board, "SheetShadow", SheetShadow(), Color.white, 1, -8, Art.Flat);
    this.sheet = Art.spr(this.board, "Sheet", Art.Square, new Color(1, 1, 1, 0), 1, -7, Art.Flat);
    for (let i = 0; i < 49; i++) this.dots.push(Art.spr(this.board, "Dot", DotSprite(), Color.white, 0.2, 20, Art.Flat));
    for (let i = 0; i < 84; i++) { const e = new Edge(); e.sr = Art.spr(this.board, "Edge", StrokeSprite(), Color.white, 1, 10, Art.Flat); e.sr.gameObject.setActive(false); this.edges.push(e); }
    for (let i = 0; i < 36; i++) {
      const b = new Box();
      b.hatch = Art.spr(this.board, "Hatch", HatchSprite(), Color.white, 0.9, 2, Art.Flat);
      b.doodle = Art.spr(this.board, "Doodle", DoodleSprite(0), Color.white, 0.62, 4, Art.Flat);
      b.hatch.gameObject.setActive(false); b.doodle.gameObject.setActive(false);
      this.boxes.push(b);
    }
    this.ghost = Art.spr(this.board, "Ghost", StrokeSprite(), new Color(1, 1, 1, 0), 1, 9, Art.Flat);
    this.fx = CasualFx.create(this.board, 40, 200);
    this.BuildHud();
    this.BuildOnline();
    this.BuildTitle();
    this.BuildSounds();
    this.NewBoard(5);
    this.Layout();
  }

  private BuildSounds() {
    const noise = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    // pen scratch: filtered noise with a little wobble
    let lp = 0;
    this.scratchClip = Sfx.make("db-scratch", 0.2, (t) => { lp += (noise(Math.trunc(t * 44100)) - lp) * 0.35; return lp * Sfx.env(t, 0.01, 0.16) * (0.7 + 0.3 * Math.sin(t * 160)) * 0.8; });
    this.claimClip = Sfx.make("db-claim", 0.35, (t) => (Sfx.sinP(Sfx.glide(t, 660, 990, 0.08)) * 0.35 + Sfx.triP(1320 * t) * 0.12) * Sfx.env(t, 0.004, 0.28));
    this.chainClip = Sfx.make("db-chain", 0.5, (t) => { const n = Math.min(3, Math.floor(t / 0.07)); return Sfx.sqrP([784, 988, 1175, 1568][n] * t) * 0.1 * Sfx.env(t - n * 0.07, 0.002, 0.12); });
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    for (let i = 0; i < 2; i++) {
      const p = new PanelUI();
      p.node = UIKit.node("Panel" + i, hud);
      p.bg = UIKit.img(p.node, "Bg", Panel(), new Color(1, 1, 1, 0.92));
      p.bg.rectTransform.stretch();
      p.edge = UIKit.img(p.node, "Edge", Art.UiOutline, Color.white);
      p.edge.rectTransform.stretch();
      p.swatch = UIKit.img(p.node, "Swatch", HatchSprite(), Color.white);
      p.swatch.rectTransform.place(new V2(0, 0.5), new V2(75, 0), new V2(90, 90));
      p.name = UIKit.at(UIKit.label(p.node, "", 28, Color.white, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(275, 30), new V2(270, 36));
      p.score = UIKit.at(UIKit.label(p.node, "0", 62, Color.white, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(275, -18), new V2(270, 70));
      p.turn = UIKit.at(UIKit.label(p.node, "", 26, Color.white), new V2(1, 0.5), new V2(-105, 0), new V2(200, 40));
      CasualLook.fit(p.turn, 16);
      this.panels.push(p);
    }
    this.soloBar = UIKit.node("SoloBar", hud).place(new V2(0.5, 1), new V2(-60, -100), new V2(860, 170));
    UIKit.img(this.soloBar, "Bg", Panel(), new Color(1, 1, 1, 0.92)).rectTransform.stretch();
    this.soloStage = UIKit.at(UIKit.label(this.soloBar, "", 30, Color.white, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(200, 42), new V2(340, 40));
    this.soloGoal = UIKit.at(UIKit.label(this.soloBar, "", 50, Color.white, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(200, -16), new V2(340, 60));
    this.soloTime = UIKit.at(UIKit.label(this.soloBar, "", 30, Color.white), new V2(1, 0.5), new V2(-90, 42), new V2(160, 40));
    for (let i = 0; i < 6; i++) {
      const img = UIKit.img(this.soloBar, "Ink", InkDrop(), Color.white);
      img.rectTransform.place(new V2(1, 0.5), new V2(-300 + i * 46, -20), new V2(42, 42));
      this.inkIcons.push(img);
    }
    this.undoButton = UIKit.buttonAt(hud, "UNDO (AD)", new V2(0, 0), new V2(150, 300), new V2(230, 84), false, () => this.OnUndo(), 26);
    this.undoButton.setAccent(Gold);
    this.hintText = UIKit.label(hud, "", 30, Color.white);
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    CasualLook.titleCard(this.UI, new Color(0.08, 0.1, 0.2, 0.8), new V2(1060, 1100), -30);
    const accents = ModeAccents;
    for (let i = 0; i < 4; i++) {
      const idx = i;
      const b = UIKit.buttonAt(ex, ModeNames[i], UIKit.Center, new V2((i - 1.5) * 245, 20), new V2(232, 96), false, () => { this.Data.set("mode", idx); this.RefreshTitle(); }, 28);
      b.setAccent(accents[i]);
      this.modeButtons.push(b);
    }
    this.optButton = UIKit.buttonAt(ex, "OPTION", UIKit.Center, new V2(-320, -92), new V2(300, 84), false, () => this.CycleOption(), 26);
    this.sizeButton = UIKit.buttonAt(ex, "SIZE", UIKit.Center, new V2(0, -92), new V2(300, 84), false, () => { this.Data.set("size", (this.Data.get("size", 1) + 1) % 3); this.RefreshTitle(); }, 26);
    this.shopButton = UIKit.buttonAt(ex, "PAPER", UIKit.Center, new V2(320, -92), new V2(300, 84), false, () => this.OpenShop(true), 26);
    this.shopButton.setAccent(Gold);
    this.modeLabel = UIKit.at(UIKit.label(ex, "", 25, new Color(1, 1, 1, 0.85)), UIKit.Center, new V2(0, -160), new V2(980, 34));
    this.BuildShop(ex.parent!);
    this.RefreshTitle();
  }

  private BuildShop(parent: UINode) {
    const C = UIKit.Center;
    this.shop = UIKit.node("Shop", parent).stretch();
    UIKit.dim(this.shop, 0.8);
    const card = UIKit.card(this.shop, new V2(900, 900), Gold);
    card.localScale = new V3(0.94, 0.94, 1);
    UIKit.glow(UIKit.at(UIKit.label(card, "PAPER STYLES", 54, Color.white), C, new V2(0, 370), new V2(860, 70)), Pal.Dark, 3);
    UIKit.img(card, "Coin", CoinSprite(), Color.white).rectTransform.place(C, new V2(-70, 300), new V2(54, 54));
    this.shopCoins = UIKit.at(UIKit.label(card, "0", 44, Gold, TextAnchor.MiddleLeft), C, new V2(70, 300), new V2(220, 60));
    this.shopImg = UIKit.img(card, "Paper", PaperSprite(0), Color.white);
    this.shopImg.rectTransform.place(C, new V2(0, 90), new V2(180, 300));
    this.shopName = UIKit.at(UIKit.label(card, "", 42, Color.white), C, new V2(0, -95), new V2(600, 56));
    UIKit.buttonAt(card, "<", C, new V2(-330, 90), new V2(100, 110), false, () => this.Browse(-1), 52).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(330, 90), new V2(100, 110), false, () => this.Browse(1), 52).setAccent(Gold);
    this.shopAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, -200), new V2(420, 92), false, () => this.ShopAction(), 32);
    UIKit.buttonAt(card, "CLOSE", C, new V2(0, -330), new V2(320, 84), true, () => this.OpenShop(false), 36).setAccent(Gold);
    this.shop.setActive(false);
  }

  private get SelMode() { return Mathf.clamp(this.Data.get("mode", 1), 0, 3) as Mode; }

  private CycleOption() {
    const m = this.SelMode;
    if (m === Mode.Cpu) this.Data.set("diff", (Mathf.clamp(this.Data.get("diff", 1), 0, 2) + 1) % 3);
    else if (m === Mode.Duo) this.Data.set("layout", this.Data.get("layout") ^ 1);
    else return;
    this.RefreshTitle();
  }

  private RefreshTitle() {
    if (!this.optButton) return;
    const m = this.SelMode, d = Mathf.clamp(this.Data.get("diff", 1), 0, 2), lay = this.Data.get("layout"), sz = Sizes[Mathf.clamp(this.Data.get("size", 1), 0, 2)];
    const accents = ModeAccents;
    this.modeButtons.forEach((b, i) => {
      b.setAccent(i === m ? accents[i] : new Color(1, 1, 1, 0.45));
      if (b.label) b.label.text = (i === m ? "● " : "") + ModeNames[i];
    });
    const stage = this.Data.get("stage", 1);
    if (this.optButton.label) this.optButton.label.text = m === Mode.Solo ? `STAGE ${stage}` : m === Mode.Cpu ? `CPU: ${DiffNames[d]}` : m === Mode.Online ? "PRIVATE TABLE" : lay === 0 ? "LAYOUT: TABLE" : "SAME SIDE";
    this.optButton.setAccent(accents[m]);
    this.optButton.interactable = m === Mode.Cpu || m === Mode.Duo;
    if (this.sizeButton.label) this.sizeButton.label.text = m === Mode.Solo ? "PUZZLE" : `BOARD ${sz}×${sz}`;
    this.sizeButton.interactable = m !== Mode.Solo;
    this.sizeButton.setAccent(Pal.hex(0x9a7aff));
    if (this.shopButton.label) this.shopButton.label.text = `PAPER · ${Papers[this.Paper].name}`;
    if (this.shopButton.label) this.shopButton.label.fontSize = 22;
    this.modeLabel.text = m === Mode.Solo ? `STAGE ${stage}: CLAIM THE GOAL WITH YOUR INK · ${"★".repeat(this.Data.get("s" + (stage - 1)))}`
      : m === Mode.Cpu ? `MOST BOXES WINS · BEAT THE ${DiffNames[d]} CPU FOR ${this.PrizeFor(d, sz)} COINS`
      : m === Mode.Online ? `PLAY A FRIEND ON THEIR OWN PHONE · WIN ${OnlinePrize} COINS`
      : lay === 0 ? "FACE TO FACE: PLAYER 2 SITS ACROSS THE TABLE" : "SIDE BY SIDE: TAKE TURNS ON ONE BOARD";
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private PrizeFor(d: number, sz: number) { return Math.round(Prizes[d] * (sz === 4 ? 1 : sz === 5 ? 1.4 : 1.8)); }

  private OpenShop(on: boolean) {
    if (on) { this.browse = this.Paper; this.RefreshShop(); } else this.RefreshTitle();
    this.shop.setActive(on);
  }
  private Browse(d: number) { this.browse = (this.browse + d + Papers.length) % Papers.length; Sfx.play(Snd.Click, 0.5); this.RefreshShop(); }
  private ShopAction() {
    const i = this.browse;
    if (i > 0 && this.Data.get("up" + i) === 0) {
      if (this.Coins < Papers[i].cost) { Sfx.play(Snd.Deny, 0.6); return; }
      this.Coins = this.Coins - Papers[i].cost;
      this.Data.set("up" + i, 1);
      Sfx.play(Snd.PowerUp, 0.8);
    }
    this.Data.set("paper", i);
    this.ApplyPaper();
    this.RefreshShop();
  }
  private RefreshShop() {
    const i = this.browse, st = Papers[i];
    this.shopCoins.text = Fmt.n(this.Coins);
    this.shopName.text = st.name;
    this.shopImg.sprite = PaperSprite(i);
    const eq = this.Paper === i, un = i === 0 || this.Data.get("up" + i) === 1;
    if (this.shopAction.label) this.shopAction.label.text = eq ? "EQUIPPED" : un ? "EQUIP" : `UNLOCK · ${Fmt.n(st.cost)} COINS`;
    this.shopAction.setAccent(eq ? Pal.TextDim : un ? Pal.hex(0x3a9cff) : this.Coins >= st.cost ? Gold : Pal.hex(0x8a7a6a));
    this.shopAction.interactable = !eq && (un || this.Coins >= st.cost);
  }

  private ApplyPaper() {
    const st = Papers[this.Paper];
    this.cover.sprite = CasualArt.hd(PaperSprite(this.Paper));
    CasualLook.fitCover(this.cover, this.ViewSize);
    for (const d of this.dots) d.color = st.dot;
    this.RepaintAll();
    for (let i = 0; i < 2; i++) {
      const p = this.panels[i], pen = this.Pens[i];
      p.bg.color = Color.lerp(st.paper, Color.white, 0.3).withAlpha(0.95);
      p.name.color = pen; p.score.color = st.ink; p.turn.color = pen; p.swatch.color = pen;
    }
    this.soloStage.color = st.pens[0]; this.soloGoal.color = st.ink; this.soloTime.color = st.ink;
    this.hintText.color = st.ink;
  }

  // ------------------------------------------------------------------ board

  private NewBoard(n: number) {
    this.n = n;
    this.bd = new Board(n);
    for (let i = 0; i < this.dots.length; i++) {
      const on = i < (n + 1) * (n + 1);
      this.dots[i].gameObject.setActive(on);
      if (!on) continue;
      const r = Math.floor(i / (n + 1)), c = i % (n + 1);
      this.dots[i].transform.localPosition = this.DotPos(r, c);
      this.dots[i].transform.localScale = new V2(0.17, 0.17);
    }
    for (const e of this.edges) { e.sr.gameObject.setActive(false); e.t = 9; e.owner = -1; e.pre = false; }
    for (const b of this.boxes) { b.hatch.gameObject.setActive(false); b.doodle.gameObject.setActive(false); b.owner = -1; b.t = 9; }
    this.sheet.transform.localScale = new V2(n + 1.1, n + 1.1);
    this.sheetShadow.transform.localScale = new V2(n + 2.4, n + 2.4);
    this.sheetShadow.color = new Color(1, 1, 1, 0);
    this.ghost.color = new Color(1, 1, 1, 0);
  }

  private DotPos(r: number, c: number) { return new V2(c - this.n / 2, this.n / 2 - r); }
  private BoxPos(b: number) { const r = Math.floor(b / this.n), c = b % this.n; return new V2(c - this.n / 2 + 0.5, this.n / 2 - r - 0.5); }
  private EdgeMid(e: number) { const [r1, c1, r2, c2] = this.bd.ends(e); return V2.lerp(this.DotPos(r1, c1), this.DotPos(r2, c2), 0.5); }

  private PlaceEdge(e: number, k: number) {
    const ed = this.edges[e], [r1, c1, r2, c2] = this.bd.ends(e);
    const a = this.DotPos(r1, c1), b = this.DotPos(r2, c2);
    const len = 1.06 * Ease.outCubic(Mathf.clamp01(k));
    const dir = b.sub(a).normalized;
    const start = a.sub(dir.mul(0.03));
    ed.sr.transform.localPosition = start.add(dir.mul(len / 2));
    ed.sr.transform.localEulerZ = this.bd.isH(e) ? 0 : 90;
    ed.sr.transform.localScale = new V2(Math.max(0.001, len), 1.0);
  }

  private RepaintAll() {
    const st = Papers[this.Paper];
    for (let e = 0; e < this.bd.E && e < this.edges.length; e++) {
      const ed = this.edges[e];
      if (!ed.sr.gameObject.activeSelf) continue;
      ed.sr.color = ed.pre ? st.pencil.withAlpha(0.85) : this.Pens[Math.max(0, Math.min(1, ed.owner))];
    }
    for (let b = 0; b < this.n * this.n; b++) {
      const bx = this.boxes[b];
      if (bx.owner < 0) continue;
      const pen = this.Pens[Math.min(1, bx.owner)];
      bx.hatch.color = pen.withAlpha(0.55);
      bx.doodle.color = pen;
    }
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); this.relayout = 2; }
  private relayout = 2;

  private get Playing() { return this.State !== Phase.Title; }
  private get Table() { return this.Playing && this.mode === Mode.Duo && this.table; }

  private Layout() {
    if (!this.board) return;
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.cover, this.ViewSize);
    this.portrait = Screen.height >= Screen.width;
    const solo = this.Playing && this.mode === Mode.Solo;
    const sideBySide = this.Playing && this.mode === Mode.Duo && !this.table;
    let top = 250, bottom = 250;
    if (!this.Playing) { top = 0; bottom = 0; }
    else if (solo) { top = 290; bottom = this.portrait ? 200 : 140; }
    else if (sideBySide) { top = 150; bottom = 250; }
    if (!this.portrait && this.Playing && !solo) { top = 30; bottom = 30; }
    const r = this.PlayRect(top, bottom, 0.25);
    const need = this.n + 1.3;
    let w = r.width, cx = r.center.x;
    if (!this.portrait && this.Playing && !solo) {
      // wide screens: player panels in the left column (TABLE: turned panels at both ends)
      const left = (this.Table ? 330 : 560) / this.UiPerWorld, right = (this.Table ? 330 : 300) / this.UiPerWorld;
      w = r.width - left - right;
      cx = r.xMin + left + w / 2;
    }
    this.scale = Math.min(w / need, r.height / need);
    if (!this.Playing) this.scale = Math.min(this.ViewSize.x, this.ViewSize.y) / need * 0.95;
    this.board.localPosition = this.Playing ? new V3(cx, r.center.y, 0) : V3.zero;
    this.board.localScale = new V2(this.scale, this.scale);
    this.LayoutHud();
  }

  private get UiPerWorld() { return 1080 / Math.min(this.ViewSize.x, this.ViewSize.y); }

  private LayoutHud() {
    const duel = this.Playing && this.mode !== Mode.Solo;
    this.soloBar.setActive(this.Playing && this.mode === Mode.Solo);
    const bottom = this.mode === Mode.Online ? this.me : 0;
    for (let i = 0; i < 2; i++) {
      const p = this.panels[i];
      p.node.setActive(duel);
      if (!duel) continue;
      let anchor: V2, pos: V2, rot = 0;
      let size = new V2(500, 150);
      if (!this.portrait) {
        if (this.Table) { anchor = new V2(i === 0 ? 0 : 1, 0.5); pos = new V2(i === 0 ? 150 : -150, 0); rot = i === 0 ? -90 : 90; }
        else { anchor = new V2(0, i === bottom ? 0 : 1); pos = new V2(290, i === bottom ? 110 : -110); }
      } else if (this.mode === Mode.Duo && !this.table) {
        anchor = new V2(0.5, 0); pos = new V2((i === 0 ? -1 : 1) * 265, 110); size = new V2(500, 150);
      } else if (i === bottom) { anchor = new V2(0.5, 0); pos = new V2(0, 110); }
      else { anchor = new V2(0.5, 1); pos = new V2(-60, -110); rot = this.Table ? 180 : 0; }
      p.node.place(anchor, pos, size);
      p.node.localEulerAngles = new V3(0, 0, rot);
    }
    const showUndo = this.Playing && this.mode !== Mode.Duo && this.mode !== Mode.Online;
    const online = this.Playing && this.mode === Mode.Online;
    this.overlay.showBar(online);
    if (this.portrait) this.overlay.place({ anchor: new V2(0.5, 0), pos: new V2(0, 255) }, { anchor: new V2(0.5, 1), pos: new V2(0, -270) });
    else this.overlay.place({ anchor: new V2(0, 0), pos: new V2(290, 255) }, { anchor: new V2(0, 1), pos: new V2(290, -260) });
    this.undoButton.node.setActive(showUndo);
    if (this.portrait) this.undoButton.node.place(new V2(1, 0), new V2(-150, this.mode === Mode.Solo ? 110 : 300), new V2(240, 84));
    else this.undoButton.node.place(new V2(1, 0), new V2(-170, 80), new V2(260, 84));
    this.hintText.rectTransform.place(new V2(0.5, 0), new V2(this.portrait ? -110 : 0, this.portrait ? 110 : 60), new V2(700, 50));
    this.hintText.gameObject.setActive(this.Playing && this.mode === Mode.Solo);
  }

  private BoardToWorld(p: V2) { const b = this.board.localPosition; return new V2(b.x + p.x * this.scale, b.y + p.y * this.scale); }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.LeaveTable();
    this.mode = Mode.Cpu;
    this.shop?.setActive(false);
    this.NewBoard(5);
    this.ApplyPaper();
    this.Layout();
    this.attractT = 0.6; this.turn = 0;
    this.RefreshTitle();
    // an invite link (?table=12345) opens the join panel and joins straight away
    const code = tableCodeFromUrl();
    if (code && !this.autoJoined) {
      this.autoJoined = true;
      this.Data.set("mode", Mode.Online);
      this.RefreshTitle();
      this.lobby.open("join", code);
    }
  }

  protected BeginRun() {
    this.mode = this.SelMode;
    if (this.mode !== Mode.Online) this.me = 0;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.table = this.Data.get("layout") === 0;
    this.bot = new DotsBot(this.diff);
    this.ended = false; this.endT = 0; this.busy = 0;
    this.undoUsed = false;
    this.humanMoves = 0; this.chainCount = 0;
    this.clock = 0;
    if (this.mode === Mode.Solo) {
      this.stage = Math.max(1, this.Data.get("stage", 1));
      this.puzzle = makePuzzle(this.stage);
      this.NewBoard(this.puzzle.n);
      for (const e of this.puzzle.pre) {
        this.bd.drawn[e] = 1;
        for (let k = 0; k < 2; k++) { const b = this.bd.edgeBoxes[e * 2 + k]; if (b >= 0) this.bd.sides[b]++; }
        const ed = this.edges[e];
        ed.pre = true; ed.owner = -1; ed.t = 9;
        ed.sr.gameObject.setActive(true);
        this.PlaceEdge(e, 1);
      }
      this.ink = this.puzzle.ink; this.inkUsed = 0;
      this.turn = 0;
    } else if (this.mode === Mode.Online) {
      this.puzzle = null;
      this.me = this.link ? this.link.me : 0;
      this.forfeit = false;
      this.NewBoard(this.onlineStart.size);
      this.turn = this.onlineStart.first;
    } else {
      this.puzzle = null;
      this.NewBoard(Sizes[Mathf.clamp(this.Data.get("size", 1), 0, 2)]);
      this.turn = this.first;
      this.first ^= 1;
    }
    this.botT = 0.8;
    this.ApplyPaper();
    this.relayout = 3;
    this.Layout();
    this.Data.add("games", 1);
    Sfx.setIntensity(0.15);
    const names = this.Names();
    for (let i = 0; i < 2; i++) this.panels[i].name.text = names[i];
    if (this.mode === Mode.Solo) this.UI.Toast(`Claim ${this.puzzle!.goal} boxes with ${this.ink} lines of ink. Closing a box is free!`, 4);
    else if (this.Data.get("games") <= 1) this.UI.Toast("Tap between two dots to draw a line. Close a box to go again!", 4);
    const youStart = (this.mode === Mode.Cpu && this.turn === 0) || (this.mode === Mode.Online && this.turn === this.me);
    this.UI.Announce(this.mode === Mode.Solo ? `STAGE ${this.stage}` : youStart ? "YOU START" : `${names[this.turn]} STARTS`, Gold, 1.3);
    this.UpdateHud(0);
  }

  private Names() {
    if (this.mode === Mode.Online) return this.me === 0 ? ["YOU", "FRIEND"] : ["FRIEND", "YOU"];
    if (this.mode === Mode.Cpu) return ["YOU", `CPU · ${DiffNames[this.diff]}`];
    if (this.mode === Mode.Solo) return ["YOU", ""];
    return ["PLAYER 1", "PLAYER 2"];
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.relayout > 0 && --this.relayout === 0) this.Layout();
    this.lobby.tick(Time.unscaledDeltaTime);
    this.overlay.tick();
    if (this.State === Phase.Title) {
      // attract: two bots doodle away behind the title
      this.attractT -= dt;
      if (this.attractT <= 0) {
        if (this.bd.over || this.bd.drawnCount() >= this.bd.E) { this.NewBoard(5); this.ApplyPaper(); this.attractT = 1; }
        else {
          const e = this.attractBot.move(this.bd, this.turn);
          this.Apply(e, this.turn, true);
          this.attractT = 0.35;
        }
      }
    }
    this.Animate(dt);
  }

  protected TickRun(dt: number) {
    if (this.relayout > 0 && --this.relayout === 0) this.Layout();
    this.overlay.tick();
    this.busy = Math.max(0, this.busy - dt);
    if (!this.ended) {
      this.clock += dt;
      if (this.IsHumanTurn) this.ReadInput();
      else if (this.mode === Mode.Online) this.ShowGhost(-1);
      else if (this.mode === Mode.Cpu && this.busy <= 0) {
        this.botT -= dt;
        if (this.botT <= 0) {
          const e = this.bot.move(this.bd, 1);
          this.Apply(e, 1, false);
          this.botT = this.diff === 0 ? 0.55 : 0.4;
        }
      }
    } else {
      this.endT -= dt;
      if (this.endT <= 0 && this.State === Phase.Playing) this.ShowResult();
    }
    this.Animate(dt);
    this.UpdateHud(dt);
  }

  private get IsHumanTurn() {
    if (this.mode === Mode.Online) return this.turn === this.me && !!this.link && this.link.connected && !this.overlay.busy;
    return this.mode !== Mode.Cpu || this.turn === 0;
  }

  // ------------------------------------------------------------------ input

  private ReadInput() {
    this.pointer.update(Time.unscaledDeltaTime);
    // desktop hover: show the line you are about to draw
    let hover = -1;
    if (!this.pointer.usingTouch && Mouse.present && !overUI(Mouse.position)) hover = this.EdgeAt(this.ScreenToBoard(Mouse.position), 0.42);
    else if (this.pointer.held) hover = this.EdgeAt(this.ScreenToBoard(this.pointer.screen), 0.42);
    this.ShowGhost(hover);
    if (this.pointer.tap) {
      const e = this.EdgeAt(this.ScreenToBoard(this.pointer.screen), 0.45);
      if (e >= 0) this.HumanMove(e);
    }
  }

  private ScreenToBoard(s: V2) {
    const w = this.ScreenToWorld(s), b = this.board.localPosition;
    return new V2((w.x - b.x) / this.scale, (w.y - b.y) / this.scale);
  }

  /** Nearest undrawn edge to a board point (within `maxD` of the segment). */
  private EdgeAt(p: V2, maxD: number) {
    let best = -1, bd = maxD;
    for (let e = 0; e < this.bd.E; e++) {
      if (this.bd.drawn[e]) continue;
      const m = this.EdgeMid(e), h = this.bd.isH(e);
      const along = h ? Math.abs(p.x - m.x) : Math.abs(p.y - m.y);
      const across = h ? Math.abs(p.y - m.y) : Math.abs(p.x - m.x);
      if (along > 0.5) continue;
      const d = across + Math.max(0, along - 0.32) * 0.6;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  private ShowGhost(e: number) {
    if (e < 0) { this.ghost.color = this.ghost.color.withAlpha(Mathf.moveTowards(this.ghost.color.a, 0, Time.unscaledDeltaTime * 6)); return; }
    const m = this.EdgeMid(e);
    this.ghost.transform.localPosition = m;
    this.ghost.transform.localEulerZ = this.bd.isH(e) ? 0 : 90;
    this.ghost.transform.localScale = new V2(1.0, 1.0);
    this.ghost.color = this.Pens[this.turn].withAlpha(0.32 + 0.1 * Math.sin(Time.time * 8));
  }

  private HumanMove(e: number) {
    if (this.mode === Mode.Solo) {
      const free = this.bd.completes(e);
      if (!free && this.ink <= 0) { Sfx.play(Snd.Deny, 0.6); this.UI.Toast("Out of ink! Only lines that close a box are free.", 2); return; }
      if (!free) { this.ink--; this.inkUsed++; }
    }
    this.humanMoves++;
    this.Apply(e, this.turn, false);
    if (this.mode === Mode.Online) this.link?.sendMove(e);
  }

  // ------------------------------------------------------------------ moves

  private Apply(e: number, p: number, attract: boolean) {
    if (e < 0 || this.bd.drawn[e]) return;
    const got = this.bd.play(e, p);
    const ed = this.edges[e];
    ed.owner = p; ed.pre = false; ed.t = 0;
    ed.sr.gameObject.setActive(true);
    ed.sr.color = this.Pens[p];
    this.PlaceEdge(e, 0);
    Sfx.playClip(this.scratchClip, attract ? 0.15 : 0.6, Random.range(0.9, 1.15));
    if (!attract) this.busy = 0.18;
    if (got.length) {
      this.chainCount = this.lastGot === p ? this.chainCount + got.length : got.length;
      for (const b of got) this.Claim(b, p, attract);
      if (!attract) {
        Sfx.playClip(this.claimClip, 0.7, 1 + Math.min(0.6, this.chainCount * 0.06));
        if (this.chainCount >= 3 && this.chainCount % 3 === 0) Sfx.playClip(this.chainClip, 0.6);
        this.panels[Math.min(1, p)].pop = 1;
        Fx.haptic();
      }
    } else {
      this.chainCount = 0;
      if (this.mode !== Mode.Solo || attract) this.turn ^= 1;
    }
    this.lastGot = got.length ? p : -1;
    if (attract) return;
    this.CheckEnd();
  }

  private Claim(b: number, p: number, attract: boolean) {
    const bx = this.boxes[b];
    bx.owner = p; bx.t = 0;
    bx.kind = Random.rangeInt(0, DoodleCount);
    bx.flip = this.Table && p === 1;
    bx.doodle.sprite = DoodleSprite(bx.kind);
    const pen = this.Pens[Math.min(1, p)];
    bx.hatch.color = pen.withAlpha(0.55);
    bx.doodle.color = pen;
    bx.hatch.gameObject.setActive(true);
    bx.doodle.gameObject.setActive(true);
    const pos = this.BoxPos(b);
    bx.hatch.transform.localPosition = pos; bx.doodle.transform.localPosition = pos;
    bx.doodle.transform.localEulerZ = (bx.flip ? 180 : 0) + Random.range(-12, 12);
    if (!attract) {
      this.fx.pop(pos, pen, 10, 3, 0.12, 0.4);
      this.fx.sparkle(pos, Gold, 4, 0.4, 0.22);
      this.Fx.shake(0.06);
    }
  }

  private CheckEnd() {
    const total = this.n * this.n;
    if (this.mode === Mode.Solo) {
      const pz = this.puzzle!;
      if (this.bd.score[0] >= pz.goal) this.EndGame(true);
      else if (this.ink <= 0 && this.bd.captures().length === 0) this.EndGame(false);
      else if (this.bd.score[0] >= total) this.EndGame(true);
      return;
    }
    if (this.bd.score[0] + this.bd.score[1] >= total) this.EndGame(this.bd.score[this.me] > this.bd.score[1 - this.me]);
    else if (this.bd.score[0] * 2 > total && this.mode === Mode.Cpu) { /* keep playing to the end: the board fills fast */ }
  }

  private EndGame(win: boolean) {
    this.ended = true;
    this.endT = 1.6;
    this.ghost.color = new Color(1, 1, 1, 0);
    const s = this.bd.score;
    let head: string, good = win;
    if (this.mode === Mode.Solo) head = win ? "STAGE CLEAR!" : "OUT OF INK";
    else if (this.mode === Mode.Cpu) head = s[0] > s[1] ? "YOU WIN!" : s[0] === s[1] ? "DRAW!" : "CPU WINS";
    else if (this.mode === Mode.Online) { const a = s[this.me], b = s[1 - this.me]; head = a > b ? "YOU WIN!" : a === b ? "DRAW!" : "FRIEND WINS"; good = a >= b; }
    else { head = s[0] === s[1] ? "DRAW!" : `${this.Names()[s[0] > s[1] ? 0 : 1]} WINS!`; good = true; }
    this.UI.Announce(head, good ? Gold : Pal.hex(0xff5a5a), 1.6);
    Sfx.play(good ? Snd.Win : Snd.Lose, 0.8);
    if (good) this.fx.confetti(new V2(0, this.n * 0.3), 70, 8, [this.Pens[0], this.Pens[1], Gold], 0.18);
  }

  // ------------------------------------------------------------------ animation + HUD

  private Animate(dt: number) {
    for (let e = 0; e < this.bd.E; e++) {
      const ed = this.edges[e];
      if (ed.t > 1) continue;
      ed.t += dt / 0.14;
      this.PlaceEdge(e, ed.t);
    }
    for (let b = 0; b < this.n * this.n; b++) {
      const bx = this.boxes[b];
      if (bx.t > 1) continue;
      bx.t += dt / 0.3;
      const k = Mathf.clamp01(bx.t);
      bx.hatch.transform.localScale = new V2(0.9 * Ease.outCubic(k), 0.9 * Ease.outCubic(k));
      const s = 0.62 * Ease.outBack(Mathf.clamp01(k * 1.3 - 0.2));
      bx.doodle.transform.localScale = new V2(s, s);
    }
    // the dots breathe a little on the current player's turn colour while the CPU thinks
    for (let i = 0; i < 2; i++) {
      const p = this.panels[i];
      p.glow = Mathf.moveTowards(p.glow, this.Playing && !this.ended && this.turn === i ? 1 : 0, dt * 4);
      p.pop = Mathf.moveTowards(p.pop, 0, dt * 3);
    }
  }

  private UpdateHud(dt: number) {
    void dt;
    const st = Papers[this.Paper];
    if (this.mode === Mode.Solo && this.puzzle) {
      this.soloStage.text = `STAGE ${this.stage}`;
      this.soloGoal.text = `${this.bd.score[0]} / ${this.puzzle.goal} BOXES`;
      this.soloTime.text = Fmt.clock(this.clock);
      for (let i = 0; i < this.inkIcons.length; i++) {
        const on = i < this.puzzle.ink;
        this.inkIcons[i].gameObject.setActive(on);
        this.inkIcons[i].color = i < this.ink ? st.pens[0] : st.pencil.withAlpha(0.35);
      }
      this.hintText.text = this.ink > 0 ? `${this.ink} LINE${this.ink === 1 ? "" : "S"} OF INK LEFT · CLOSING A BOX IS FREE` : this.bd.captures().length ? "NO INK LEFT · CLOSE THE BOXES YOU CAN!" : "";
    } else {
      for (let i = 0; i < 2; i++) {
        const p = this.panels[i];
        p.score.text = String(this.bd.score[i]);
        const s = 1 + 0.3 * Ease.outCubic(p.pop);
        p.score.rectTransform.localScale = new V3(s, s, 1);
        const mine = this.turn === i && !this.ended;
        p.turn.text = !mine ? "" : this.mode === Mode.Online ? (i === this.me ? "YOUR TURN" : "FRIEND'S TURN") : this.mode === Mode.Cpu && i === 1 ? "THINKING…" : "YOUR TURN";
        p.turn.rectTransform.localScale = new V3(1 + 0.05 * Math.sin(Time.time * 6), 1 + 0.05 * Math.sin(Time.time * 6), 1);
        p.edge.color = this.Pens[i].withAlpha(0.3 + 0.6 * p.glow);
        p.node.localScale = new V3(1 + 0.04 * p.glow, 1 + 0.04 * p.glow, 1);
      }
    }
    const canUndo = !this.undoUsed && !this.ended && this.LastHumanIndex() >= 0 && this.IsHumanTurn && AdService.rewardedAvailable;
    this.undoButton.interactable = canUndo;
    if (this.undoButton.label) this.undoButton.label.text = this.undoUsed ? "UNDO USED" : "UNDO (AD)";
  }

  // ------------------------------------------------------------------ undo

  /** Index in the move list of the last move made by the human (player 0). */
  private LastHumanIndex() {
    const ms = this.bd.moves;
    for (let i = ms.length - 1; i >= 0; i--) if (ms[i].p === 0) return i;
    return -1;
  }

  private OnUndo() {
    if (this.undoUsed || this.ended || this.LastHumanIndex() < 0) return;
    AdService.showRewarded((ok) => { if (ok) this.DoUndo(); });
  }

  /** Takes back everything since (and including) the human's last line that was not a free capture. */
  private DoUndo() {
    this.undoUsed = true;
    const ms = this.bd.moves;
    let idx = this.LastHumanIndex();
    // in puzzles, also roll back the free captures that preceded it in the same burst
    while (idx >= 0 && this.mode === Mode.Solo && ms[idx].got.length > 0 && idx > 0 && ms[idx - 1].p === 0) idx--;
    while (this.bd.moves.length > idx && this.bd.moves.length > 0) {
      const m = this.bd.undo()!;
      if (this.mode === Mode.Solo && m.got.length === 0) { this.ink++; this.inkUsed--; }
      const ed = this.edges[m.e];
      ed.sr.gameObject.setActive(false); ed.owner = -1;
      for (const b of m.got) { const bx = this.boxes[b]; bx.owner = -1; bx.hatch.gameObject.setActive(false); bx.doodle.gameObject.setActive(false); }
    }
    this.turn = 0;
    this.chainCount = 0;
    this.UI.Toast("MOVE TAKEN BACK", 1.5);
    Sfx.play(Snd.Whoosh, 0.6);
  }


  // ------------------------------------------------------------------ online (private tables)

  private BuildOnline() {
    const theme = { accent: Pal.hex(0x3a9cff), accent2: GuestPink, ink: Papers[0].ink };
    this.lobby = new TableLobby("dotsboxes", theme, {
      onReady: (room) => this.OnTableReady(room),
      toast: (t, sec) => this.UI.Toast(t, sec ?? 2),
    }, "Dots & Boxes");
    this.overlay = new TableOverlay(theme, () => { this.overlay.hide(); this.EnterTitle(); }, (k) => this.link?.react(k));
    this.overlay.onTimeout = () => { this.link?.leave(); this.FriendLeft(); };
  }

  /** PLAY with ONLINE selected opens the lobby; REMATCH online asks the friend. */
  protected StartRun() {
    if (this.State === Phase.Paused && this.mode === Mode.Online) { this.UI.Toast("Restart isn't available online: use MENU to leave the table.", 2.5); return; }
    if (this.SelMode === Mode.Online && !this.onlineGo) {
      if (this.State === Phase.Over && this.link && this.link.connected) { this.AskRematch(); return; }
      if (this.State === Phase.Over) { this.EnterTitle(); }
      if (!this.lobby.isOpen) {
        const sz = Sizes[Mathf.clamp(this.Data.get("size", 1), 0, 2)];
        this.lobby.createNote = `Your table plays on a ${sz}×${sz} board (change it on the title screen).`;
        this.lobby.open("menu");
      }
      return;
    }
    this.onlineGo = false;
    super.StartRun();
  }

  private OnTableReady(room: OnlineRoom) {
    this.LeaveTable();
    const link = new OnlineLink<OStart, number, OSnap>(room);
    this.link = link;
    link.bind({
      onStart: (st) => {
        this.onlineStart = st;
        this.overlay.hide();
        this.Data.set("mode", Mode.Online);
        this.onlineGo = true;
        this.StartRun();
      },
      validMove: (e, by) => this.State === Phase.Playing && !this.ended && by === this.turn && e >= 0 && e < this.bd.E && !this.bd.drawn[e],
      onMove: (e, by) => this.Apply(e, by, false),
      snapshot: () => ({ size: this.n, first: this.onlineStart.first, moves: this.bd.moves.map((m) => m.e) }),
      onSnapshot: (snap) => {
        if (this.State === Phase.Playing && this.mode === Mode.Online) { this.Rebuild(snap); return; }
        if (this.State === Phase.Playing) return;
        // joined (again) in the middle of a match: start from the host's state
        this.onlineStart = { size: snap.size, first: snap.first };
        this.overlay.hide();
        this.Data.set("mode", Mode.Online);
        this.onlineGo = true;
        this.StartRun();
        this.Rebuild(snap);
      },
      onReaction: (k) => this.overlay.Pop(k, true),
      onFriend: (st) => {
        if (st === "connected") { if (this.overlay.state === "lost") { this.overlay.hide(); this.UI.Toast("Your friend is back!", 2); } }
        else if (st === "lost") { if (this.State === Phase.Playing && !this.ended) this.overlay.lost(30); }
        else this.FriendLeft();
      },
      onRematchReady: () => { if (link.isHost) link.start({ size: this.n, first: link.match % 2 }); },
      onFriendRematch: () => { if (this.overlay.state !== "rematch") this.UI.Toast("Your friend wants a rematch! Tap REMATCH.", 3); },
    });
    if (link.isHost) {
      const sz = Sizes[Mathf.clamp(this.Data.get("size", 1), 0, 2)];
      link.start({ size: sz, first: 0 });
    } else this.UI.Toast("Joined! Waiting for the host to start…", 3);
  }

  /** The host's snapshot replaces the local board (after a reconnect or an out-of-order move). */
  private Rebuild(snap: OSnap) {
    this.onlineStart = { size: snap.size, first: snap.first };
    this.NewBoard(snap.size);
    this.ApplyPaper();
    this.turn = snap.first;
    for (const e of snap.moves) this.Apply(e, this.turn, true);
    this.ended = false;
    this.Layout();
    this.CheckEnd();
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
    if (this.State === Phase.Playing && this.mode === Mode.Online && !this.ended) {
      const total = this.n * this.n, claimed = this.bd.score[0] + this.bd.score[1];
      if (claimed * 2 > total) {
        // most of the board is decided: the player who stayed takes the win
        this.forfeit = true;
        this.overlay.hide();
        this.ended = true;
        this.endT = 0.2;
        this.UI.Announce("YOUR FRIEND LEFT", Gold, 1.4);
        return;
      }
      this.ended = true;
      this.endT = 1e9; // no result screen: the overlay's MENU leaves
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
    const s = this.bd.score, a = s[this.me], b = s[1 - this.me];
    const won = this.forfeit || a > b, draw = !this.forfeit && a === b;
    const prize = won ? OnlinePrize : draw ? 15 : 5;
    this.lastPrize = prize;
    this.Coins = this.Coins + prize;
    if (won) this.Data.add("onlineWins", 1);
    this.Data.add("onlineGames", 1);
    this.overlay.showBar(false);
    this.Finish(new Result({
      Headline: this.forfeit ? "FRIEND LEFT · YOU WIN!" : won ? "YOU WIN!" : draw ? "IT'S A DRAW" : "FRIEND WINS",
      HeadlineColor: won ? Gold : this.Pens[1 - this.me], Victory: won,
      Value: `${a} – ${b}`,
      BestLine: `YOU ${a} · FRIEND ${b}   ·   +${prize} COINS`,
      Stats: [["YOUR BOXES", String(a)], ["FRIEND'S BOXES", String(b)], ["MATCH", String(this.link?.match ?? 1)], ["ONLINE WINS", String(this.Data.get("onlineWins"))]],
      Primary: this.link ? "REMATCH" : "NEW TABLE",
      Reward: won ? () => this.DoubleCoins() : null,
      RewardLabel: `DOUBLE COINS: +${prize} (AD)`,
    }));
  }

  // ------------------------------------------------------------------ results

  private ShowResult() {
    const s = this.bd.score;
    if (this.mode === Mode.Online) { this.OnlineResult(); return; }
    if (this.mode === Mode.Solo) {
      const pz = this.puzzle!;
      const win = s[0] >= pz.goal;
      if (win) {
        const stars = this.clock <= 25 ? 3 : this.clock <= 60 ? 2 : 1;
        const prev = this.Data.get("s" + this.stage);
        this.Data.max("s" + this.stage, stars);
        this.Data.set("stage", Math.max(this.Data.get("stage", 1), this.stage + 1));
        const prize = 15 + this.stage * 3 + (stars - 1) * 10;
        this.lastPrize = prize;
        this.Coins = this.Coins + prize;
        this.Finish(new Result({
          Headline: `STAGE ${this.stage} CLEAR!`, HeadlineColor: Gold, Stars: stars, Victory: true, NewBest: stars > prev && prev > 0,
          BestLine: `${s[0]} BOXES   ·   ${Fmt.clock(this.clock)}   ·   +${prize} COINS`,
          Stats: [["BOXES", `${s[0]} / ${pz.goal}`], ["INK USED", `${this.inkUsed} / ${pz.ink}`], ["TIME", Fmt.clock(this.clock)], ["NEXT", `STAGE ${this.stage + 1}`]],
          Primary: "NEXT STAGE",
          Reward: () => this.DoubleCoins(), RewardLabel: `DOUBLE COINS: +${prize} (AD)`,
        }));
      } else {
        this.Finish(new Result({
          Headline: "OUT OF INK", HeadlineColor: Pal.hex(0xffb0c0), Stars: 0,
          BestLine: `${s[0]} OF ${pz.goal} BOXES · TRY A DIFFERENT FIRST LINE`,
          Stats: [["BOXES", `${s[0]} / ${pz.goal}`], ["INK", `${pz.ink} LINES`], ["TIME", Fmt.clock(this.clock)], ["STAGE", String(this.stage)]],
          Primary: "TRY AGAIN",
          Reward: !this.undoUsed ? () => this.UndoAndContinue() : null, RewardLabel: "TAKE BACK YOUR LAST LINE (AD)",
        }));
      }
      return;
    }
    if (this.mode === Mode.Cpu) {
      const won = s[0] > s[1], draw = s[0] === s[1];
      const prize = won ? this.PrizeFor(this.diff, this.n) : draw ? 15 : 5;
      this.lastPrize = prize;
      this.Coins = this.Coins + prize;
      if (won) { this.Data.add("wins", 1); this.Data.add("w" + this.diff, 1); }
      this.Finish(new Result({
        Headline: won ? `YOU BEAT THE ${DiffNames[this.diff]} CPU!` : draw ? "IT'S A DRAW" : "THE CPU WINS",
        HeadlineColor: won ? Gold : Pal.hex(0xffb0c0), Victory: won,
        Value: `${s[0]} – ${s[1]}`,
        BestLine: `${this.n}×${this.n} BOARD   ·   +${prize} COINS`,
        Stats: [["YOUR BOXES", String(s[0])], ["CPU BOXES", String(s[1])], ["LINES DRAWN", String(this.bd.moves.length)], ["COINS", Fmt.n(this.Coins)]],
        Primary: won ? "PLAY AGAIN" : "REMATCH",
        Reward: won ? () => this.DoubleCoins() : !this.undoUsed ? () => this.UndoAndContinue() : null,
        RewardLabel: won ? `DOUBLE COINS: +${prize} (AD)` : "TAKE BACK YOUR LAST MOVE (AD)",
      }));
      return;
    }
    const w = s[0] === s[1] ? -1 : s[0] > s[1] ? 0 : 1;
    this.Data.add("duels", 1);
    this.Finish(new Result({
      Headline: w < 0 ? "IT'S A DRAW!" : `${this.Names()[w]} WINS!`, HeadlineColor: w < 0 ? Gold : this.Pens[w === 0 ? 0 : 1], Victory: true,
      Value: `${s[0]} – ${s[1]}`, BestLine: `${this.n}×${this.n} BOARD`,
      Stats: [["P1 BOXES", String(s[0])], ["P2 BOXES", String(s[1])], ["LINES", String(this.bd.moves.length)], ["BOARD", `${this.n}×${this.n}`]],
      Primary: "REMATCH",
    }));
  }

  private UndoAndContinue() {
    this.Coins = this.Coins - this.lastPrize;
    this.ended = false;
    this.Revive();
    this.DoUndo();
    this.relayout = 2;
  }

  private DoubleCoins() {
    this.Coins = this.Coins + this.lastPrize;
    this.UI.Toast(`+${this.lastPrize} COINS: DOUBLED!`, 2.5);
    Sfx.play(Snd.Coin, 0.8);
  }

  /** Test hook: CSS pixel position of an edge's midpoint, plus state. */
  debugEdge(e: number) {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect(), k = c.width / r.width;
    const cam = (window as unknown as { __na: { Camera: { worldToScreen(p: V2): { x: number; y: number } } } }).__na.Camera;
    const sp = cam.worldToScreen(this.BoardToWorld(this.EdgeMid(e)));
    return { x: r.left + sp.x / k, y: r.top + sp.y / k };
  }
  get Engine() { return this.bd; }
}
