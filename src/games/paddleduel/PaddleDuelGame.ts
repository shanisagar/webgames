import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject, howTo, Image, Keyboard,
  Mathf, Mouse, overUI, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer, Text, TextAnchor, Time,
  Touchscreen, TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import {
  BallSkins, BallSprite, CoinSprite, CourtH, CourtSprite, CourtW, DigitSprite, Gold, Ink, P1Col, P2Col, PaddleSkins, PaddleSprite,
  RivalSkin, ScanSprite,
} from "./PaddleArt";
import { BaseSpeed, BotLevels, BR, Court, Ev, HL, HW, MaxSpeed, PaddleBot, PEvent, PL, PT, PY } from "./PaddleSim";

/**
 * PADDLE DUEL: the original two-paddle duel, redone neon-retro. Drag your paddle with one finger (or the mouse / keys);
 * where the ball meets the paddle sets its angle and a moving paddle adds spin that curves it. Every return speeds the
 * ball up. FIRST TO 7. VS COMPUTER (easy / medium / hard bot that predicts bounces with a tunable error rate),
 * 2 PLAYERS on one screen (CLASSIC side by side, or TABLE face-off with player 2's side rotated) and SOLO "WALL PONG":
 * keep the rally alive against a wall. Coins from matches unlock paddle and ball skins.
 */

const Red = Pal.hex(0xff4a5a), White = Pal.hex(0xf4ecff);
const ModeNames = ["SOLO", "VS COMPUTER", "2 PLAYERS"];
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const LayoutNames = ["AUTO LAYOUT", "CLASSIC", "TABLE"];
const Prizes = [40, 80, 160];
const WinPoints = 7;
const DigitScale = 2.4;

enum Step { Serve, Play, Point, Wait }

interface Ghost { sr: SpriteRenderer; age: number; x: number; y: number }

export class PaddleDuelGame extends ArcadeGame {
  private court!: GameObject;
  private ball!: SpriteRenderer; private ballGlow!: SpriteRenderer;
  private paddles: { root: GameObject; body: SpriteRenderer; glow: SpriteRenderer }[] = [];
  private ghosts: Ghost[] = []; private ghostNext = 0; private lastGhost = V2.zero;
  private digits: SpriteRenderer[][] = [[], []];
  private endWall!: SpriteRenderer;
  private scan!: SpriteRenderer;
  private fx!: CasualFx;
  private sim = new Court();
  private bot: PaddleBot | null = null;
  private attract: PaddleBot[] = [];
  private step = Step.Wait; private timer = 0; private counting = false; private countShown = 0;
  private courtScale = 1; private courtRot = 0; private classic = false;

  private mode = 1; private diff = 1;
  private score = [0, 0];
  private headStart = false; private revived = false;
  private bestRallyRun = 0; private hits = [0, 0]; private topSpeed = 0; private nearMiss = false; private passed = false;
  private serveTo = 0;
  private touchOwner = new Map<number, number>();
  private lastMouse = V2.zero; private mouseActive = false;
  private digitPop = [0, 0];
  private hintTime = 0;

  // HUD
  private pill!: UINode; private pillTitle!: Text; private pillSub!: Text; private speedFill!: Image;
  private zoneHint: Text[] = [];
  private sideTag: Text[] = [];
  // title
  private modeButtons: ArcadeButton[] = [];
  private diffButton!: ArcadeButton; private layoutButton!: ArcadeButton; private shopButton!: ArcadeButton; private crtButton!: ArcadeButton;
  private modeLabel!: Text;
  private shop!: UINode; private shopCoins!: Text;
  private padImg!: Image; private padName!: Text; private padAction!: ArcadeButton;
  private ballImg!: Image; private ballName!: Text; private ballAction!: ArcadeButton;
  private browsePad = 0; private browseBall = 0;

  private blip!: AudioClip; private wallClip!: AudioClip; private pointClip!: AudioClip; private loseClip!: AudioClip; private whoosh!: AudioClip;
  private soundsThisFrame = 0;

  protected Describe() {
    return new GameInfo({
      Id: "paddleduel",
      Title: "PADDLE DUEL",
      Tagline: "THE ORIGINAL DUEL, TURNED UP TO NEON",
      PlayLabel: "PLAY",
      Accent: P1Col,
      Accent2: P2Col,
      BgTop: Pal.hex(0x14072e),
      BgBottom: Pal.hex(0x030210),
      GridSpacing: 1.1,
      ShortSide: 20,
      Touch: TouchScheme.None,
      Music: { bpm: 128, rootHz: 87.31, degrees: [0, 5, 3, 4], seed: 77, energy: 0.65, major: false },
      Reminders: [
        "Fancy a rally?|First to 7 wins.",
        "The HARD bot reads every bounce|Can you curve one past it?",
        "Two players, one screen|Grab a friend and duel.",
      ],
      HowTo: [
        howTo(Art.RoundSquare, P1Col, "Drag anywhere on your side to slide your paddle (mouse, W/S or arrow keys work too)."),
        howTo(Art.Square, White, "Hit the ball near the paddle's edge for a sharp angle. Every return makes it faster."),
        howTo(Art.Chevron, Gold, "Swipe your paddle as you hit to add SPIN: the ball curves in flight."),
        howTo(Art.Star, P2Col, "FIRST TO 7 POINTS wins. 2 PLAYERS: CLASSIC side by side or TABLE face-off."),
        howTo(Art.Diamond, Pal.hex(0x9dff5a), "SOLO WALL PONG: keep the rally alive against the wall as long as you can."),
        howTo(Art.Disc, Gold, "Earn coins and unlock new paddles and balls in SKINS."),
      ],
      Tips: [
        "Edge hits send the ball at steep angles.",
        "Move the paddle as you hit to curve the ball.",
        "Return to the middle after every hit.",
        "The bot reads straight shots best. Add spin!",
      ],
    });
  }

  protected get ShortSide() { return 20; }
  private get Coins() { return this.Data.get("coins", 0); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }
  private get PadSel() { return Mathf.clamp(this.Data.get("pskin"), 0, PaddleSkins.length - 1); }
  private get BallSel() { return Mathf.clamp(this.Data.get("bskin"), 0, BallSkins.length - 1); }
  private HasPad(i: number) { return i === 0 || this.Data.get("own_p" + i) === 1; }
  private HasBall(i: number) { return i === 0 || this.Data.get("own_b" + i) === 1; }
  protected BestLine() { return `◉ ${Fmt.n(this.Coins)}   ·   BEST RALLY ${this.Data.get("bestRally")}   ·   WINS ${this.Data.get("wins")}`; }
  protected StatsLine() { return ""; }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Coins = 60; this.Data.set("mode", 1); this.Data.set("diff", 1); this.Data.set("crt", 1); }
    this.court = new GameObject("Court", this.gameObject);
    const c = this.court;
    Art.spr(c, "CourtArt", CourtSprite(), Color.white, CourtW, 0, Art.Flat);
    for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++) {
      const d = Art.spr(c, `Digit${i}${k}`, DigitSprite("0"), (i === 0 ? P1Col : P2Col).withAlpha(0.3), DigitScale, 2, Art.Additive);
      this.digits[i].push(d);
    }
    this.endWall = Art.spr(c, "EndWall", PaddleSprite(PaddleSkins[3], "wall"), Color.white, 1, 3, Art.Additive);
    this.endWall.transform.localScale = new V3(HW * 2 / 0.95, 1.4, 1);
    this.endWall.transform.localPosition = new V3(0, HL, 0);
    for (let i = 0; i < 26; i++) {
      const g = Art.spr(c, "Ghost" + i, BallSprite(BallSkins[0], "0"), Color.clear, BR * 2 / 0.56, 8, Art.Additive);
      this.ghosts.push({ sr: g, age: 9, x: 0, y: 0 });
    }
    for (let i = 0; i < 2; i++) {
      const root = new GameObject("Paddle" + i, c);
      const glow = Art.spr(root, "Glow", Art.Glow, Color.clear, 1, 9, Art.Additive);
      glow.transform.localScale = new V3(PL * 3.2, 1.6, 1);
      const body = Art.spr(root, "Body", PaddleSprite(PaddleSkins[0], "p0"), Color.white, PL * 2 / 0.95, 10, Art.Flat);
      this.paddles.push({ root, body, glow });
    }
    this.ballGlow = Art.spr(c, "BallGlow", Art.Glow, Color.clear, 2.2, 11, Art.Additive);
    this.ball = Art.spr(c, "Ball", BallSprite(BallSkins[0], "0"), Color.white, BR * 2 / 0.56, 12, Art.Flat);
    this.fx = CasualFx.create(c, 30, 220);
    this.scan = Art.spr(this.gameObject, "Scanlines", ScanSprite(), new Color(1, 1, 1, 0.22), 1, 400, Art.Flat);
    this.BuildHud();
    this.BuildTitle();
    this.BuildSounds();
    this.ApplySkins();
    this.Layout();
  }

  private BuildSounds() {
    const noise = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    this.blip = Sfx.make("pd-blip", 0.11, (t) => (Sfx.sqrP(660 * t) * 0.35 + Sfx.sinP(1320 * t) * 0.25) * Sfx.env(t, 0.001, 0.07) * 0.8);
    this.wallClip = Sfx.make("pd-wall", 0.08, (t) => Sfx.sqrP(330 * t) * 0.32 * Sfx.env(t, 0.001, 0.05));
    this.pointClip = Sfx.make("pd-point", 0.7, (t) => {
      const n = Math.min(3, Math.floor(t / 0.09)), f = [523.3, 659.3, 784, 1046.5][n];
      return (Sfx.sqrP(f * t) * 0.25 + Sfx.sinP(f * 2 * t) * 0.15) * Sfx.env(t - n * 0.09, 0.002, 0.25) + noise(Math.trunc(t * 44100)) * Sfx.env(t, 0.001, 0.12) * 0.25;
    });
    this.loseClip = Sfx.make("pd-lose", 0.8, (t) => (Sfx.sawP(Sfx.glide(t, 420, 70, 0.6)) * 0.3 + Sfx.sqrP(Sfx.glide(t, 210, 35, 0.6)) * 0.2) * Sfx.env(t, 0.005, 0.55) + noise(Math.trunc(t * 22050)) * Sfx.env(t, 0.001, 0.25) * 0.35);
    this.whoosh = Sfx.make("pd-whoosh", 0.35, (t) => noise(Math.trunc(t * 30000)) * Math.sin(Math.PI * t / 0.35) * 0.25);
  }

  // ------------------------------------------------------------------ HUD

  private BuildHud() {
    const hud = this.UI.Hud;
    this.pill = UIKit.node("Pill", hud).place(new V2(0.5, 1), new V2(0, -80), new V2(460, 110));
    UIKit.img(this.pill, "Bg", Art.UiRound, new Color(0.03, 0.01, 0.1, 0.82)).rectTransform.stretch();
    UIKit.img(this.pill, "Edge", Art.UiOutline, P1Col.withAlpha(0.35)).rectTransform.stretch();
    this.pillTitle = UIKit.at(UIKit.label(this.pill, "", 34, White), UIKit.Center, new V2(0, 22), new V2(440, 44));
    UIKit.glow(this.pillTitle, Ink, 3);
    this.pillSub = UIKit.at(UIKit.label(this.pill, "", 22, Gold, TextAnchor.MiddleLeft), UIKit.Center, new V2(-110, -26), new V2(200, 30));
    const [, fill] = UIKit.meter(this.pill, UIKit.Center, new V2(95, -26), new V2(210, 22), Gold);
    this.speedFill = fill;
    for (let i = 0; i < 2; i++) {
      const t = UIKit.label(hud, i === 0 ? "P1 · DRAG TO MOVE" : "P2 · DRAG TO MOVE", 44, Color.white);
      UIKit.glow(t, i === 0 ? P1Col : P2Col, 4);
      t.raycastTarget = false;
      t.gameObject.setActive(false);
      this.zoneHint.push(t);
      const tag = UIKit.label(hud, "", 30, (i === 0 ? P1Col : P2Col).withAlpha(0.85));
      tag.raycastTarget = false;
      this.sideTag.push(tag);
    }
  }

  // ------------------------------------------------------------------ title & skins

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    CasualLook.titleCard(this.UI, new Color(0.03, 0.01, 0.1, 0.62), new V2(1060, 1080), -10);
    for (let i = 0; i < 3; i++) {
      const idx = i;
      const b = UIKit.buttonAt(ex, ModeNames[i], UIKit.Center, new V2((i - 1) * 330, 10), new V2(315, 96), false, () => this.PickMode(idx), i === 1 ? 27 : 30);
      this.modeButtons.push(b);
    }
    const row = -98, w = 240;
    this.diffButton = UIKit.buttonAt(ex, "MEDIUM", UIKit.Center, new V2(-375, row), new V2(w, 84), false, () => this.Cycle("diff", 3), 26);
    this.layoutButton = UIKit.buttonAt(ex, "AUTO", UIKit.Center, new V2(-125, row), new V2(w, 84), false, () => this.Cycle("layout", 3), 24);
    this.shopButton = UIKit.buttonAt(ex, "SKINS", UIKit.Center, new V2(125, row), new V2(w, 84), false, () => this.OpenShop(true), 26);
    this.crtButton = UIKit.buttonAt(ex, "CRT ON", UIKit.Center, new V2(375, row), new V2(w, 84), false, () => this.Cycle("crt", 2), 26);
    this.shopButton.setAccent(Gold);
    this.modeLabel = UIKit.at(UIKit.label(ex, "", 25, new Color(1, 1, 1, 0.8)), UIKit.Center, new V2(0, -172), new V2(980, 36));
    this.BuildShop(ex.parent!);
    this.RefreshTitle();
  }

  private BuildShop(parent: UINode) {
    const C = UIKit.Center;
    this.shop = UIKit.node("Shop", parent).stretch();
    UIKit.dim(this.shop, 0.82);
    const card = UIKit.card(this.shop, new V2(900, 1000), Gold);
    card.localScale = new V3(0.94, 0.94, 1);
    UIKit.glow(UIKit.at(UIKit.label(card, "SKINS", 60, Color.white), C, new V2(0, 420), new V2(800, 70)), Ink, 3);
    UIKit.img(card, "Coin", CoinSprite(), Color.white).rectTransform.place(C, new V2(-60, 350), new V2(54, 54));
    this.shopCoins = UIKit.at(UIKit.label(card, "0", 46, Gold, TextAnchor.MiddleLeft), C, new V2(85, 350), new V2(220, 60));
    UIKit.at(UIKit.label(card, "PADDLE", 30, Pal.TextDim), C, new V2(0, 280), new V2(400, 40));
    this.padImg = UIKit.img(card, "Paddle", PaddleSprite(PaddleSkins[0], "p0"), Color.white);
    this.padImg.rectTransform.place(C, new V2(0, 185), new V2(440, 110));
    this.padName = UIKit.at(UIKit.label(card, "", 40, Color.white), C, new V2(0, 95), new V2(600, 56));
    UIKit.buttonAt(card, "<", C, new V2(-340, 185), new V2(100, 110), false, () => this.Browse(0, -1), 52).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(340, 185), new V2(100, 110), false, () => this.Browse(0, 1), 52).setAccent(Gold);
    this.padAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, 10), new V2(380, 90), false, () => this.ShopAction(0), 32);
    UIKit.at(UIKit.label(card, "BALL", 30, Pal.TextDim), C, new V2(0, -85), new V2(400, 40));
    this.ballImg = UIKit.img(card, "Ball", BallSprite(BallSkins[0], "0"), Color.white);
    this.ballImg.rectTransform.place(C, new V2(0, -175), new V2(150, 150));
    this.ballName = UIKit.at(UIKit.label(card, "", 40, Color.white), C, new V2(0, -262), new V2(600, 56));
    UIKit.buttonAt(card, "<", C, new V2(-340, -175), new V2(100, 110), false, () => this.Browse(1, -1), 52).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(340, -175), new V2(100, 110), false, () => this.Browse(1, 1), 52).setAccent(Gold);
    this.ballAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, -332), new V2(380, 90), false, () => this.ShopAction(1), 32);
    UIKit.buttonAt(card, "CLOSE", C, new V2(0, -455), new V2(320, 84), true, () => this.OpenShop(false), 36).setAccent(Gold);
    this.shop.setActive(false);
  }

  private PickMode(i: number) {
    this.Data.set("mode", i);
    Sfx.play(Snd.Click, 0.6);
    this.mode = i;
    this.RefreshTitle();
  }

  private Cycle(key: string, n: number) {
    if (key === "diff" && this.Data.get("mode", 1) !== 1) return;
    this.Data.set(key, (this.Data.get(key) + 1) % n);
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
    this.Layout();
  }

  private RefreshTitle() {
    if (this.modeButtons.length === 0) return;
    const m = Mathf.clamp(this.Data.get("mode", 1), 0, 2), d = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    const accents = [Pal.hex(0x9dff5a), P1Col, P2Col];
    this.modeButtons.forEach((b, i) => b.setAccent(i === m ? accents[i] : new Color(1, 1, 1, 0.4)));
    const set = (b: ArcadeButton, s: string) => { if (b.label) b.label.text = s; };
    set(this.diffButton, m === 1 ? DiffNames[d] : "—");
    this.diffButton.interactable = m === 1;
    this.diffButton.setAccent([Pal.hex(0x9dff5a), Gold, Red][d]);
    const lay = Mathf.clamp(this.Data.get("layout"), 0, 2);
    set(this.layoutButton, lay === 0 ? `AUTO · ${this.IsClassic() ? "CLASSIC" : "TABLE"}` : LayoutNames[lay]);
    this.layoutButton.setAccent(P1Col);
    set(this.shopButton, `SKINS ◉${this.Coins}`);
    set(this.crtButton, this.Data.get("crt") ? "CRT ON" : "CRT OFF");
    this.crtButton.setAccent(this.Data.get("crt") ? P2Col : new Color(1, 1, 1, 0.5));
    this.modeLabel.text = m === 0 ? "WALL PONG: HOW LONG CAN YOU KEEP THE RALLY ALIVE?"
      : m === 1 ? `FIRST TO 7 VS THE ${DiffNames[d]} BOT · WIN ${Prizes[d]} COINS`
      : "ONE SCREEN, TWO PLAYERS · EACH DRAGS THEIR OWN PADDLE";
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private OpenShop(on: boolean) {
    if (on) { this.browsePad = this.PadSel; this.browseBall = this.BallSel; this.RefreshShop(); }
    else this.RefreshTitle();
    this.shop.setActive(on);
    Sfx.play(Snd.Click, 0.6);
  }

  private Browse(row: number, d: number) {
    if (row === 0) this.browsePad = (this.browsePad + d + PaddleSkins.length) % PaddleSkins.length;
    else this.browseBall = (this.browseBall + d + BallSkins.length) % BallSkins.length;
    Sfx.play(Snd.Tick, 0.5);
    this.RefreshShop();
  }

  private ShopAction(row: number) {
    const i = row === 0 ? this.browsePad : this.browseBall;
    const owned = row === 0 ? this.HasPad(i) : this.HasBall(i);
    const cost = row === 0 ? PaddleSkins[i].cost : BallSkins[i].cost;
    if (!owned) {
      if (this.Coins < cost) { Sfx.play(Snd.Deny, 0.6); return; }
      this.Coins = this.Coins - cost;
      this.Data.set((row === 0 ? "own_p" : "own_b") + i, 1);
      Sfx.play(Snd.Coin, 0.8);
      Sfx.play(Snd.PowerUp, 0.6);
    } else Sfx.play(Snd.Confirm, 0.6);
    this.Data.set(row === 0 ? "pskin" : "bskin", i);
    this.ApplySkins();
    this.RefreshShop();
  }

  private RefreshShop() {
    this.shopCoins.text = Fmt.n(this.Coins);
    const p = PaddleSkins[this.browsePad], b = BallSkins[this.browseBall];
    this.padImg.sprite = PaddleSprite(p, "p" + this.browsePad);
    this.padName.text = p.name;
    this.SetAction(this.padAction, this.PadSel === this.browsePad, this.HasPad(this.browsePad), p.cost);
    this.ballImg.sprite = BallSprite(b, String(this.browseBall));
    this.ballName.text = b.name;
    this.SetAction(this.ballAction, this.BallSel === this.browseBall, this.HasBall(this.browseBall), b.cost);
  }

  private SetAction(b: ArcadeButton, equipped: boolean, owned: boolean, cost: number) {
    if (b.label) b.label.text = equipped ? "EQUIPPED" : owned ? "EQUIP" : `UNLOCK ◉ ${cost}`;
    b.setAccent(equipped ? Pal.TextDim : owned ? P1Col : this.Coins >= cost ? Gold : Pal.hex(0x8a7a6a));
    b.interactable = !equipped && (owned || this.Coins >= cost);
  }

  private ApplySkins() {
    const ps = PaddleSkins[this.PadSel], bs = BallSkins[this.BallSel];
    this.paddles[0].body.sprite = PaddleSprite(ps, "p" + this.PadSel);
    this.paddles[1].body.sprite = PaddleSprite(this.mode === 1 ? RivalSkin : RivalSkin, "rival");
    const bspr = BallSprite(bs, String(this.BallSel));
    this.ball.sprite = bspr;
    for (const g of this.ghosts) g.sr.sprite = bspr;
  }
  private get BallCol() { return BallSkins[this.BallSel].col; }
  private PadCol(i: number) { return i === 0 ? PaddleSkins[this.PadSel].a : P2Col; }

  // ------------------------------------------------------------------ layout

  private IsClassic() {
    const sel = Mathf.clamp(this.Data.get("layout"), 0, 2);
    return sel === 1 || (sel === 0 && Screen.width >= Screen.height);
  }

  protected OnLayoutChanged() { this.Layout(); this.layoutFrames = 2; }
  private layoutFrames = 3;

  private Layout() {
    if (!this.court) return;
    const portrait = Screen.height > Screen.width;
    this.classic = this.IsClassic();
    this.courtRot = this.classic ? -90 : 0;
    const w = this.classic ? CourtH : CourtW, h = this.classic ? CourtW : CourtH;
    const two = this.mode === 2;
    const top = this.classic ? (portrait ? 330 : 150) : (two ? 150 : 200), bottom = this.classic ? (portrait ? 200 : 20) : 30;
    const r = this.PlayRect(top, bottom, 0.1);
    this.courtScale = Math.min((r.xMax - r.xMin) / w, (r.yMax - r.yMin) / h);
    this.court.localPosition = new V3((r.xMin + r.xMax) / 2, (r.yMin + r.yMax) / 2, 0);
    this.court.localScale = new V3(this.courtScale, this.courtScale, 1);
    this.court.localEulerZ = this.courtRot;
    // CRT lines cover the whole view
    const V = this.ViewSize;
    this.scan.transform.localPosition = V3.zero;
    this.scan.transform.localScale = new V3(V.x * 1.1, V.y * 1.1 / 75, 1);
    this.scan.gameObject.setActive(this.Data.get("crt") === 1);
    // HUD
    const tableTwo = two && !this.classic;
    this.pill.place(new V2(0.5, 1), new V2(0, -80), new V2(460, 110));
    this.pill.setActive(!tableTwo || this.State !== Phase.Playing);
    for (let i = 0; i < 2; i++) {
      const p = this.UI.WorldToHud(this.CourtToWorld(new V2(0, (i === 0 ? -1 : 1) * HL * 0.42)));
      const zh = this.zoneHint[i].rectTransform;
      zh.place(UIKit.Center, p, new V2(800, 70));
      zh.localEulerAngles = new V3(0, 0, tableTwo && i === 1 ? 180 : 0);
      const tp = this.UI.WorldToHud(this.CourtToWorld(this.classic ? new V2(HW + 0.55, (i === 0 ? -1 : 1) * HL * 0.5) : new V2((i === 0 ? -1 : 1) * (-HW * 0.55), (i === 0 ? -1 : 1) * (HL + 0.5))));
      const st = this.sideTag[i].rectTransform;
      st.place(UIKit.Center, tp, new V2(400, 44));
      st.localEulerAngles = new V3(0, 0, tableTwo && i === 1 ? 180 : 0);
    }
    this.PlaceDigits();
  }

  private PlaceDigits() {
    const tableTwo = !this.classic;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      // classic: high on each half; table: off to each player's right of the court, readable from their seat
      const base = this.classic ? new V2(-HW * 0.45, s * HL * 0.42) : new V2(-s * HW * 0.5, s * HL * 0.32);
      const rot = this.classic ? 90 : tableTwo && i === 1 && this.mode === 2 ? 180 : 0;
      const n = this.digits[i].filter((d) => d.gameObject.activeSelf).length;
      const sp = DigitScale * 1.25;
      const pop = 1 + 0.45 * this.digitPop[i];
      this.digits[i].forEach((d, k) => {
        // lay the digits out along the screen-horizontal axis of the rotated frame
        const off = (k - (n - 1) / 2) * sp * pop;
        const along = this.classic ? new V2(0, off) : rot === 180 ? new V2(-off, 0) : new V2(off, 0);
        d.transform.localPosition = new V3(base.x + along.x, base.y + along.y, 0);
        d.transform.localEulerZ = rot;
        d.transform.localScale = new V3(DigitScale * pop, DigitScale * pop, 1);
      });
    }
  }

  private CourtToWorld(p: V2) {
    let x = p.x, y = p.y;
    if (this.courtRot !== 0) { const t = x; x = y; y = -t; }
    const lp = this.court.localPosition;
    return new V2(lp.x + x * this.courtScale, lp.y + y * this.courtScale);
  }

  private ScreenToCourt(screen: V2) {
    const w = this.ScreenToWorld(screen);
    const lp = this.court.localPosition;
    let x = (w.x - lp.x) / this.courtScale, y = (w.y - lp.y) / this.courtScale;
    if (this.courtRot !== 0) { const t = x; x = -y; y = t; }
    return new V2(x, y);
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.mode = Mathf.clamp(this.Data.get("mode", 1), 0, 2);
    this.sim = new Court();
    this.sim.serve(Math.random() < 0.5 ? 0 : 1, 14);
    this.attract = [new PaddleBot(BotLevels[2], 0), new PaddleBot(BotLevels[2], 1)];
    this.bot = null;
    this.step = Step.Wait;
    this.endWall.gameObject.setActive(false);
    for (const t of this.zoneHint) t.gameObject.setActive(false);
    for (const t of this.sideTag) t.text = "";
    this.score = [0, 0];
    this.SetDigits();
    this.ApplySkins();
    this.paddles[1].root.setActive(true);
    this.shop?.setActive(false);
    this.Layout();
    this.RefreshTitle();
  }

  protected BeginRun() {
    this.mode = Mathf.clamp(this.Data.get("mode", 1), 0, 2);
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.Data.add("games", 1);
    this.sim = new Court();
    this.sim.wallTop = this.mode === 0;
    this.bot = this.mode === 1 ? new PaddleBot(BotLevels[this.diff], 1) : null;
    this.attract = [];
    this.score = [this.headStart && this.mode === 1 ? 1 : 0, 0];
    if (this.headStart && this.mode === 1) this.UI.Toast("+1 POINT HEAD START!", 2);
    this.headStart = false;
    this.revived = false;
    this.bestRallyRun = 0; this.hits = [0, 0]; this.topSpeed = 0;
    this.touchOwner.clear();
    this.ClearGhosts();
    this.endWall.gameObject.setActive(this.mode === 0);
    this.paddles[1].root.setActive(this.mode !== 0);
    const names = this.Names();
    for (let i = 0; i < 2; i++) this.sideTag[i].text = this.mode === 0 && i === 1 ? "" : names[i];
    this.ApplySkins();
    this.SetDigits();
    this.layoutFrames = 2;
    this.Layout();
    this.hintTime = 3.2;
    this.StartServe(this.mode === 0 ? 0 : Math.random() < 0.5 ? 0 : 1, true);
    Sfx.setIntensity(0.4);
    this.UpdateHud();
  }

  private Names() {
    if (this.mode === 0) return ["YOU", "WALL"];
    if (this.mode === 1) return ["YOU", `${DiffNames[this.diff]} BOT`];
    return ["PLAYER 1", "PLAYER 2"];
  }

  private StartServe(toward: number, countdown: boolean) {
    this.sim.live = false;
    this.sim.bx = 0; this.sim.by = this.mode === 0 ? 2 : 0;
    this.sim.rally = 0;
    this.serveTo = toward;
    this.step = Step.Serve;
    this.timer = countdown ? 2.99 : 1.1;
    this.counting = countdown;
    this.countShown = 0;
    this.nearMiss = false; this.passed = false;
    this.ClearGhosts();
  }

  protected OnPauseChanged(_paused: boolean) { this.touchOwner.clear(); }

  // ------------------------------------------------------------------ frame loop

  protected TickBackground(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    if (this.State === Phase.Title && this.attract.length) {
      for (const b of this.attract) b.update(this.sim, dt);
      this.sim.step(Math.min(dt, 0.05));
      for (const e of this.sim.events) if (e.type === Ev.Score) this.sim.serve(1 - e.who, 14);
      this.sim.events.length = 0;
      if (!this.sim.live) this.sim.serve(0, 14);
    }
    this.Present(dt);
  }

  protected TickRun(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    this.soundsThisFrame = 0;
    this.timer -= dt;
    this.ReadInput(dt);
    if (this.bot) this.bot.update(this.sim, dt);
    const s = this.sim;
    switch (this.step) {
      case Step.Serve: {
        s.step(dt);
        const n = Math.ceil(this.timer);
        if (this.counting && n !== this.countShown && n >= 1) { this.countShown = n; this.UI.Announce(String(n), White, 0.7); Sfx.play(Snd.Beep, 0.6); }
        if (this.timer <= 0) {
          if (this.counting) { this.UI.Announce("GO!", Gold, 0.6); Sfx.play(Snd.BeepHigh, 0.7); }
          this.counting = false;
          s.serve(this.serveTo, this.mode === 0 && this.revived ? Math.max(BaseSpeed, this.reviveSpeed) : BaseSpeed);
          if (this.mode === 0) s.by = 2;
          Sfx.playClip(this.whoosh, 0.5);
          this.step = Step.Play;
        }
        break;
      }
      case Step.Play: {
        s.step(dt);
        this.HandleEvents();
        this.topSpeed = Math.max(this.topSpeed, s.speed);
        this.CheckNearMiss();
        break;
      }
      case Step.Point: {
        s.step(dt);
        s.events.length = 0;
        if (this.timer <= 0) this.AfterPoint();
        break;
      }
      case Step.Wait: s.step(dt); break;
    }
    this.hintTime -= dt;
    const showHints = this.hintTime > 0 && this.step === Step.Serve;
    for (let i = 0; i < 2; i++) this.zoneHint[i].gameObject.setActive(showHints && (i === 0 || this.mode === 2));
    Sfx.setIntensity(0.35 + 0.6 * Mathf.clamp01((s.speed - BaseSpeed) / (MaxSpeed - BaseSpeed)));
    this.UpdateHud();
    this.Present(dt);
  }
  private reviveSpeed = BaseSpeed;

  // ------------------------------------------------------------------ input (multi-touch: each finger drives the paddle on its side)

  private ReadInput(dt: number) {
    const s = this.sim;
    const two = this.mode === 2;
    const touched = [false, false];
    if (Touchscreen.present) {
      for (const t of Touchscreen.touches) {
        const id = t.touchId;
        if (t.press.wasPressedThisFrame && !overUI(t.position)) {
          const cp = this.ScreenToCourt(t.position);
          const owner = two ? (cp.y < 0 ? 0 : 1) : 0;
          let taken = false;
          for (const [, o] of this.touchOwner) if (o === owner) taken = true;
          if (!taken) this.touchOwner.set(id, owner);
        }
        const owner = this.touchOwner.get(id);
        if (owner === undefined) continue;
        if (!t.press.isPressed || t.press.wasReleasedThisFrame) { this.touchOwner.delete(id); continue; }
        s.paddles[owner].tx = this.ScreenToCourt(t.position).x;
        touched[owner] = true;
      }
      for (const id of [...this.touchOwner.keys()]) if (!Touchscreen.touches.some((t) => t.touchId === id)) this.touchOwner.delete(id);
    }
    // mouse: player 1's paddle follows the pointer (hovering is enough)
    if (!touched[0]) {
      const mp = Mouse.position;
      if (mp.sub(this.lastMouse).sqrMagnitude > 1) this.mouseActive = true;
      this.lastMouse = mp;
      if (this.mouseActive && !(Touchscreen.present && this.touchOwner.size > 0)) {
        const cp = this.ScreenToCourt(mp);
        if (Math.abs(cp.y) < HL + 6 && (!two || cp.y < 2)) { s.paddles[0].tx = cp.x; touched[0] = true; }
      }
    }
    // keyboard: W/S or A/D for player 1, arrows for player 2 (or player 1 when alone); keys follow the screen
    const axis = (l: string, r: string, u: string, d: string) => {
      const kx = (Keyboard.key(r).isPressed ? 1 : 0) - (Keyboard.key(l).isPressed ? 1 : 0);
      const ky = (Keyboard.key(u).isPressed ? 1 : 0) - (Keyboard.key(d).isPressed ? 1 : 0);
      return this.classic ? -ky : kx;
    };
    const k1 = axis("KeyA", "KeyD", "KeyW", "KeyS"), k2 = axis("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown");
    const kb = [two ? k1 : k1 + k2, k2];
    for (let i = 0; i < (two ? 2 : 1); i++) {
      if (kb[i] !== 0) {
        if (i === 0) this.mouseActive = false;
        const p = s.paddles[i];
        p.tx = p.x + Math.sign(kb[i]) * 22 * dt * 1.6;
      }
      s.paddles[i].max = 140;
    }
  }

  // ------------------------------------------------------------------ events

  private HandleEvents() {
    const evs = this.sim.events;
    for (const e of evs) this.OnEvent(e);
    evs.length = 0;
  }

  private OnEvent(e: PEvent) {
    const p = new V2(e.x, e.y);
    const k = Mathf.clamp01((e.speed - BaseSpeed) / (MaxSpeed - BaseSpeed));
    if (e.type === Ev.Paddle) {
      this.hits[e.who]++;
      const r = this.sim.rally;
      this.bestRallyRun = Math.max(this.bestRallyRun, r);
      if (this.soundsThisFrame++ < 3) Sfx.playClip(this.blip, 0.7, Math.min(1.9, 0.85 + r * 0.035));
      const col = this.PadCol(e.who);
      this.fx.sparkle(p, Color.lerp(col, Color.white, 0.4), 5 + Math.round(k * 8), 0.5 + k * 0.5, 0.22);
      this.fx.pop(p, col, 6 + Math.round(k * 10), 4 + k * 6, 0.14, 0.32);
      if (e.edge > 0.75) { this.fx.pop(p, Gold, 8, 7, 0.12, 0.3); }
      this.Fx.shake(0.06 + k * 0.18);
      Fx.haptic(k > 0.6);
      if (Math.abs(this.sim.spin) > 0.55 && e.who === 0 && this.mode !== 2) this.UI.Float(this.CourtToWorld(p), "SPIN!", Gold, 0.8);
      if (this.mode === 0 && r > 0 && r % 10 === 0) { this.UI.Announce(`RALLY ${r}!`, Gold, 0.9); Sfx.play(Snd.PowerUp, 0.5); this.Back.Flash(Gold, 0.18); }
      else if (r > 0 && r % 10 === 0) { this.UI.Float(this.CourtToWorld(new V2(0, 0)), `RALLY ${r}`, Gold, 1); }
      if (e.speed >= MaxSpeed - 0.01 && r % 5 === 0) this.Fx.kick(0.3, 0.2);
    } else if (e.type === Ev.Wall || e.type === Ev.EndWall) {
      if (this.soundsThisFrame++ < 3) Sfx.playClip(this.wallClip, 0.45 + 0.4 * k, e.type === Ev.EndWall ? 0.8 : 1);
      this.fx.sparkle(p, e.type === Ev.EndWall ? Pal.hex(0x9adfff) : White, 3 + Math.round(k * 5), 0.4, 0.18);
      if (e.type === Ev.EndWall) this.wallFlash = 1;
    } else if (e.type === Ev.Score) this.OnPoint(e);
  }
  private wallFlash = 0;

  /** Slow motion as the ball slips past a paddle (more if it only just missed). */
  private CheckNearMiss() {
    const s = this.sim;
    if (this.passed || !s.live) return;
    for (let k = 0; k < 2; k++) {
      if (k === 1 && this.mode === 0) continue;
      const dir = k === 0 ? -1 : 1;
      if (Math.sign(s.vy) !== dir || dir * s.by < PY + PT) continue;
      this.passed = true;
      const gap = Math.abs(s.bx - s.paddles[k].x) - (s.paddles[k].len + BR);
      this.nearMiss = gap < 0.7;
      this.SlowMo(this.nearMiss ? 0.22 : 0.45, this.nearMiss ? 0.45 : 0.25);
      if (this.nearMiss) this.UI.Float(this.CourtToWorld(new V2(s.bx, s.by)), "SO CLOSE!", White, 0.9);
    }
  }

  private OnPoint(e: PEvent) {
    const scorer = e.who, loser = 1 - scorer;
    const exit = new V2(Mathf.clamp(e.x, -HW, HW), scorer === 0 ? HL : -HL);
    const col = this.mode === 0 ? Red : this.PadCol(scorer);
    this.fx.pop(exit, col, 30, 10, 0.26, 0.7);
    this.fx.pop(exit, Color.white, 12, 6, 0.18, 0.4);
    this.fx.confetti(exit, 34, 8, [col, Color.white, Gold], 0.22);
    this.Fx.shake(0.7);
    this.Fx.kick(0.45, 0.35);
    this.Back.Flash(col, 0.6);
    this.Hitstop(0.06);
    Fx.haptic(true);
    this.ClearGhosts();
    this.step = Step.Point;
    this.timer = 1.25;
    if (this.mode === 0) {
      Sfx.playClip(this.loseClip, 0.8);
      this.UI.Announce("MISSED!", Red, 1.0);
      this.timer = 1.0;
      return;
    }
    this.score[scorer]++;
    this.digitPop[scorer] = 1;
    this.SetDigits();
    const human = this.mode === 2 || scorer === 0;
    Sfx.playClip(human ? this.pointClip : this.loseClip, 0.8);
    const names = this.Names();
    const match = this.score[scorer] === WinPoints - 1 && this.score[loser] < WinPoints - 1;
    this.UI.Announce(this.mode === 1 ? (scorer === 0 ? (match ? "MATCH POINT!" : "POINT!") : `${names[1]} SCORES`) : `${names[scorer]} SCORES!`, col, 1.2);
    this.serveTo = loser;
  }

  private AfterPoint() {
    if (this.mode === 0) { this.EndRun(); return; }
    if (Math.max(this.score[0], this.score[1]) >= WinPoints) { this.EndRun(); return; }
    this.StartServe(this.serveTo, false);
  }

  // ------------------------------------------------------------------ rendering

  private SetDigits() {
    for (let i = 0; i < 2; i++) {
      const v = this.mode === 0 && this.State === Phase.Playing ? (i === 0 ? this.sim.rally : -1) : this.score[i];
      const str = v < 0 ? "" : String(Math.min(999, v));
      this.digits[i].forEach((d, k) => {
        const on = k < str.length;
        d.gameObject.setActive(on);
        if (on) d.sprite = DigitSprite(str[k]);
      });
    }
    this.PlaceDigits();
  }

  private ClearGhosts() { for (const g of this.ghosts) { g.age = 9; g.sr.color = Color.clear; } this.lastGhost = new V2(this.sim.bx, this.sim.by); }

  private Present(dt: number) {
    const s = this.sim;
    const serving = this.State === Phase.Playing && this.step === Step.Serve;
    const visible = s.live || serving || this.State === Phase.Title;
    const blink = serving ? (Math.sin(Time.time * 18) > -0.2 ? 1 : 0.25) : 1;
    this.ball.gameObject.setActive(visible);
    this.ballGlow.gameObject.setActive(visible);
    const k = Mathf.clamp01((s.speed - BaseSpeed) / (MaxSpeed - BaseSpeed));
    const bc = this.BallCol;
    if (visible) {
      // pixel snap: the ball steps on a fine retro grid
      const g = 0.1, bx = Math.round(s.bx / g) * g, by = Math.round(s.by / g) * g;
      this.ball.transform.localPosition = new V3(bx, by, 0);
      this.ball.color = Color.white.withAlpha(blink);
      if (BallSkins[this.BallSel].shape !== 0) this.ball.transform.localEulerZ = this.ball.transform.localEulerZ + (s.spin * 900 + 60) * dt;
      else this.ball.transform.localEulerZ = 0;
      this.ballGlow.transform.localPosition = new V3(bx, by, 0);
      this.ballGlow.color = Color.lerp(bc, Pal.hex(0xff6a3a), k).withAlpha((0.35 + 0.4 * k) * blink);
      // trail: pixel ghosts at snapped spots, alpha in hard steps
      if (s.live) {
        const here = new V2(bx, by);
        if (V2.distance(here, this.lastGhost) >= 0.32) {
          const gh = this.ghosts[this.ghostNext];
          this.ghostNext = (this.ghostNext + 1) % this.ghosts.length;
          gh.age = 0; gh.x = bx; gh.y = by;
          this.lastGhost = here;
        }
      }
    }
    const life = 0.16 + 0.12 * k;
    const tc = Color.lerp(bc, Pal.hex(0xff5a3a), k * 0.7);
    for (const gh of this.ghosts) {
      if (gh.age > life) { if (gh.sr.color.a > 0) gh.sr.color = Color.clear; continue; }
      gh.age += dt;
      const f = 1 - gh.age / life, stepA = Math.ceil(f * 4) / 4;
      gh.sr.transform.localPosition = new V3(gh.x, gh.y, 0);
      gh.sr.color = tc.withAlpha(stepA * 0.55);
      const sc = BR * 2 / 0.56 * (0.55 + 0.45 * stepA);
      gh.sr.transform.localScale = new V3(sc, sc, 1);
    }
    for (let i = 0; i < 2; i++) {
      const p = s.paddles[i], v = this.paddles[i];
      v.root.localPosition = new V3(p.x, (i === 0 ? -1 : 1) * PY, 0);
      v.root.localEulerZ = i === 0 ? 0 : 180;
      const col = this.PadCol(i);
      v.glow.color = col.withAlpha(0.3 + 0.55 * p.hitFlash);
      const sx = 1 + 0.08 * p.hitFlash, sy = 1 + 0.35 * p.hitFlash;
      v.body.transform.localScale = new V3(PL * 2 / 0.95 * sx, PL * 2 / 0.95 * sy, 1);
    }
    this.wallFlash = Math.max(0, this.wallFlash - dt * 3);
    this.endWall.color = Color.white.withAlpha(0.55 + 0.45 * this.wallFlash);
    for (let i = 0; i < 2; i++) {
      if (this.digitPop[i] > 0) { this.digitPop[i] = Math.max(0, this.digitPop[i] - dt * 2.2); this.PlaceDigits(); }
      for (const d of this.digits[i]) d.color = (i === 0 ? this.PadCol(0) : P2Col).withAlpha(0.26 + 0.6 * this.digitPop[i]);
    }
    if (this.mode === 0 && this.State === Phase.Playing) {
      const want = String(this.sim.rally);
      const cur = this.digits[0].filter((d) => d.gameObject.activeSelf).length;
      if (cur !== want.length || this.lastRallyShown !== this.sim.rally) { this.lastRallyShown = this.sim.rally; this.SetDigits(); }
    }
  }
  private lastRallyShown = -1;

  private UpdateHud() {
    const s = this.sim;
    if (this.mode === 0) {
      this.pillTitle.text = `RALLY ${s.rally}`;
      this.pillSub.text = `BEST ${this.Data.get("bestRally")}`;
    } else {
      this.pillTitle.text = this.mode === 1 ? `YOU ${this.score[0]} – ${this.score[1]} BOT` : `FIRST TO ${WinPoints}`;
      this.pillSub.text = s.rally > 0 ? `RALLY ${s.rally}` : "SPEED";
    }
    UIKit.setMeter(this.speedFill, 0.08 + 0.92 * Mathf.clamp01((s.speed - BaseSpeed) / (MaxSpeed - BaseSpeed)));
  }

  // ------------------------------------------------------------------ results

  private EndRun() {
    this.step = Step.Wait;
    this.sim.live = false;
    this.ClearGhosts();
    this.startCoroutine(this.ResultLater());
  }

  private *ResultLater(): Generator<{ seconds: number; realtime: boolean } | undefined, void, unknown> {
    if (this.mode !== 0) {
      const w = this.score[0] > this.score[1] ? 0 : 1;
      const won = this.mode === 2 || w === 0;
      const head = this.mode === 1 ? (w === 0 ? "YOU WIN!" : "BOT WINS") : `${this.Names()[w]} WINS!`;
      this.UI.Announce(head, this.mode === 1 && w === 1 ? Red : this.PadCol(w), 1.5);
      if (won) { Sfx.play(Snd.Win, 0.8); this.fx.confetti(new V2(0, w === 0 ? -HL * 0.4 : HL * 0.4), 90, 10, [P1Col, P2Col, Gold, Color.white]); }
      else Sfx.play(Snd.Lose, 0.7);
      yield { seconds: 1.6, realtime: false };
    } else yield { seconds: 0.3, realtime: false };
    if (this.State !== Phase.Playing) return;
    this.Data.add("points", this.score[0]);
    if (this.mode === 0) this.SoloResult();
    else if (this.mode === 1) this.CpuResult(this.score[0] > this.score[1]);
    else this.DuelResult();
  }

  private SoloResult() {
    const r = this.bestRallyRun;
    const best = this.Data.max("bestRally", r);
    const earned = r * 2;
    this.Coins = this.Coins + earned;
    const rewardCont = !this.revived;
    this.Finish(new Result({
      Headline: "RALLY OVER", HeadlineColor: Gold, Value: String(r), CountTo: r, NewBest: best && r > 0, Victory: r >= 10,
      BestLine: `BEST RALLY ${this.Data.get("bestRally")}   ·   +${earned} COINS`,
      Stats: [["RALLY", String(r)], ["TOP SPEED", `${Math.round(this.topSpeed * 4)} KM/H`], ["BEST EVER", String(this.Data.get("bestRally"))], ["COINS", Fmt.n(this.Coins)]],
      Primary: "PLAY AGAIN",
      Reward: rewardCont ? () => { this.revived = true; this.reviveSpeed = Math.max(BaseSpeed, this.sim.speed * 0.8); const keep = this.bestRallyRun; this.Revive(); this.StartServe(0, true); this.sim.rally = keep; this.UI.Announce("KEEP IT ALIVE!", Gold, 1.2); }
        : earned > 0 ? () => { this.Coins = this.Coins + earned; this.UI.Toast(`+${earned} COINS: DOUBLED!`, 2.5); Sfx.play(Snd.Coin, 0.8); } : null,
      RewardLabel: rewardCont ? "CONTINUE THE RALLY (AD)" : `DOUBLE COINS: +${earned} (AD)`,
    }));
  }

  private CpuResult(won: boolean) {
    const d = this.diff;
    const stats: [string, string][] = [["LEVEL", DiffNames[d]], ["SCORE", `${this.score[0]} – ${this.score[1]}`], ["LONGEST RALLY", String(this.bestRallyRun)], ["TOP SPEED", `${Math.round(this.topSpeed * 4)} KM/H`]];
    this.Data.max("bestRally", this.bestRallyRun);
    if (won) {
      const streak = this.Data.get("streak") + 1;
      this.Data.set("streak", streak);
      const prize = Math.round(Prizes[d] * (1 + Math.min(5, streak - 1) * 0.1)) + (this.score[1] === 0 ? Prizes[d] / 2 : 0);
      this.Coins = this.Coins + prize;
      this.Data.add("wins", 1);
      this.Finish(new Result({
        Headline: this.score[1] === 0 ? "FLAWLESS WIN!" : `YOU BEAT THE ${DiffNames[d]} BOT!`, HeadlineColor: Gold, Value: `+${prize}`, CountTo: prize, Victory: true,
        BestLine: `${this.score[0]} – ${this.score[1]}   ·   WIN STREAK ${streak}`, Stats: stats, Primary: "PLAY AGAIN",
        Reward: () => { this.Coins = this.Coins + prize; this.UI.Toast(`+${prize} COINS: DOUBLED!`, 2.5); Sfx.play(Snd.Coin, 0.8); },
        RewardLabel: `DOUBLE COINS: +${prize} (AD)`,
      }));
    } else {
      const streak = this.Data.get("streak");
      this.Data.set("streak", 0);
      const consol = this.score[0] * 5;
      this.Coins = this.Coins + consol;
      this.Finish(new Result({
        Headline: "THE BOT WINS", HeadlineColor: Pal.hex(0xffb0c8),
        Value: `${this.score[0]} – ${this.score[1]}`, BestLine: streak > 1 ? `WIN STREAK OF ${streak} ENDED` : consol > 0 ? `+${consol} COINS · SO CLOSE!` : "SHAKE IT OFF. GO AGAIN?", Stats: stats,
        Primary: "TRY AGAIN",
        Reward: () => { this.headStart = true; this.StartRun(); },
        RewardLabel: "REMATCH WITH A +1 POINT HEAD START (AD)",
      }));
    }
  }

  private DuelResult() {
    const names = this.Names(), w = this.score[0] > this.score[1] ? 0 : 1;
    this.Data.add("duels", 1);
    this.Coins = this.Coins + 20;
    this.Data.max("bestRally", this.bestRallyRun);
    this.Finish(new Result({
      Headline: `${names[w]} WINS!`, HeadlineColor: this.PadCol(w), Victory: true,
      Value: `${this.score[0]} – ${this.score[1]}`, BestLine: `FIRST TO ${WinPoints}   ·   +20 COINS`,
      Stats: [[`${names[0]} RETURNS`, String(this.hits[0])], [`${names[1]} RETURNS`, String(this.hits[1])], ["LONGEST RALLY", String(this.bestRallyRun)], ["TOP SPEED", `${Math.round(this.topSpeed * 4)} KM/H`]],
      Primary: "REMATCH",
      Reward: () => { this.Coins = this.Coins + 20; this.UI.Toast("+20 COINS: DOUBLED!", 2.5); Sfx.play(Snd.Coin, 0.8); },
      RewardLabel: "DOUBLE COINS: +20 (AD)",
    }));
  }
}
