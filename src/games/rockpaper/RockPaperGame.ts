import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Ease, Fmt, Fx, GameInfo, GameObject, howTo, Image,
  Keyboard, Mathf, Mouse, overUI, Pal, Phase, Random, Result, Sfx, Snd, SpriteRenderer, Text, TextAnchor, Time, Touchscreen,
  TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import {
  ArenaSprite, ButtonSprite, CardSprite, CoinSprite, Cyan, Gold, Green, Hands, HandSprite, ImpactSprite, Ink, Orange, Pick, PickNames, PipSprite,
  Red, RingSprite, StarPip, VsBadge, White,
} from "./RpsArt";
import { beats, RpsBot } from "./RpsBot";

/**
 * ROCK PAPER SCISSORS: the decider when nobody could agree who goes first. Both players pick in secret, then the
 * hands shake "ROCK… PAPER… SCISSORS… SHOOT!" and flip at once. Best of three (first to two wins).
 * SOLO: how long a winning streak can you build against the CPU? VS COMPUTER: the CPU studies your habits
 * (frequency + Markov models of your last throws; EASY is mostly random). 2 PLAYERS: each player picks on their own
 * half (TABLE face-off or side by side). POWER PICKS: once per match each player may add a one-use card to a throw
 * (DOUBLE: a win counts twice; SHIELD: a loss becomes a draw). Coins unlock hand styles.
 */

enum Mode { Solo, Cpu, Duo }
enum Step { Pick, Shake, Reveal, Over }
enum Lay { Face, Side }

const ModeNames = ["SOLO", "VS CPU", "2 PLAYERS"];
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const Prizes = [30, 60, 100];
const SeatCol = [Cyan, Orange];
const ShakeTime = 2.0, RevealTime = 1.9;
const Verbs = ["CRUSHES", "COVERS", "CUT"]; // winner index → verb (rock crushes scissors, paper covers rock, scissors cut paper)
const Words = ["ROCK…", "PAPER…", "SCISSORS…", "SHOOT!"];

interface Btn { base: SpriteRenderer; icon: SpriteRenderer; ring: SpriteRenderer; label: Text; local: V2; size: number }
interface Card { sr: SpriteRenderer; glow: SpriteRenderer; label: Text; local: V2; size: number; kind: number }

class Seat {
  idx = 0; human = true; name = ""; color = Cyan;
  root!: GameObject;
  hand!: SpriteRenderer; glow!: SpriteRenderer; shadow!: SpriteRenderer;
  btns: Btn[] = []; cards: Card[] = []; pips: SpriteRenderer[] = [];
  status!: Text; nameT!: Text;
  // frame
  lay = Lay.Face; pos = V2.zero; rot = 0; scale = 1; mirror = false; uiRot = 0;
  // state
  pick = -1; locked = false; armed = -1; powerUsed = false; freeShield = 0; wins = 0;
  shown = Pick.Rock; style = 0; offset = 0; pop = 0; lose = 0; winGlow = 0; thinking = 0;
  throwsWon = 0; draws = 0; picks = [0, 0, 0]; powers = 0;
}

export class RockPaperGame extends ArcadeGame {
  private world!: GameObject;
  private cover!: SpriteRenderer; private vs!: SpriteRenderer; private impact!: SpriteRenderer; private divider!: SpriteRenderer;
  private seats: Seat[] = [];
  private fx!: CasualFx;
  private mode = Mode.Cpu; private diff = 1; private table = true; private powers = false;
  private step = Step.Pick; private t = 0; private wordShown = -1;
  private round = 1; private streak = 0; private revived = false; private doubled = false; private lastPrize = 0; private pendingShield = false;
  private outcome = 0; // +1 seat 0 won the throw, -1 seat 1, 0 draw
  private shieldSaved = -1;
  private bot = new RpsBot(1);
  private portrait = true;
  private uiPerWorld = 100;

  // HUD
  private banner!: Text; private bannerT = 9; private bannerDur = 1;
  private topBar!: UINode; private topBig!: Text; private topSmall!: Text; private roundText!: Text;
  // title
  private modeButtons: ArcadeButton[] = []; private optButton!: ArcadeButton; private powerButton!: ArcadeButton; private shopButton!: ArcadeButton; private modeLabel!: Text;
  private shop!: UINode; private shopCoins!: Text; private shopName!: Text; private shopImgs: Image[] = []; private shopAction!: ArcadeButton; private browse = 0;

  private whooshClip!: AudioClip; private slamClip!: AudioClip; private winClip!: AudioClip; private drawClip!: AudioClip; private lockClip!: AudioClip; private shieldClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "rockpaper",
      Title: "ROCK PAPER SCISSORS",
      Tagline: "PICK IN SECRET. SHAKE. SHOOT!",
      PlayLabel: "PLAY",
      Accent: Gold,
      Accent2: Cyan,
      BgTop: Pal.hex(0x2a0f4a),
      BgBottom: Pal.hex(0x0e1a44),
      ShortSide: 10,
      Touch: TouchScheme.None,
      Music: { bpm: 118, rootHz: 110, degrees: [0, 5, 3, 4], seed: 63, energy: 0.55, major: false },
      Reminders: [
        "Can't decide who goes first?|Settle it with Rock Paper Scissors.",
        "The CPU is learning your habits|Can you stay unpredictable?",
        "Beat your best streak|How many wins in a row?",
      ],
      HowTo: [
        howTo(Art.Disc, Gold, "Pick ROCK, PAPER or SCISSORS. Rock crushes scissors, scissors cut paper, paper covers rock."),
        howTo(Art.Star, Cyan, "Both picks stay secret until SHOOT! First to two wins takes the match."),
        howTo(Art.Diamond, Orange, "2 PLAYERS: each player picks on their own half. TABLE puts you face to face."),
        howTo(Art.Square, Pal.hex(0xffb020), "POWER PICKS: once per match add DOUBLE (a win counts twice) or SHIELD (a loss becomes a draw)."),
        howTo(Art.Chevron, Green, "SOLO: build the longest winning streak against the CPU. Draws are free; one loss ends it."),
        howTo(Art.Ring, Red, "The CPU spots patterns. Stay unpredictable!"),
      ],
      Tips: [
        "People throw ROCK first more often than anything else.",
        "After a loss, many players switch to what would have beaten them.",
        "The HARD CPU remembers your last two throws.",
        "Save your SHIELD for match point.",
      ],
    });
  }

  protected get ShortSide() { return 10; }
  private get Coins() { return this.Data.get("coins"); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, Math.round(v))); }
  protected BestLine() { return `BEST STREAK ${this.Data.get("bestStreak")}   ·   COINS ${Fmt.n(this.Coins)}`; }
  protected StatsLine() { return ""; }
  private get Style() { return Mathf.clamp(this.Data.get("hand"), 0, Hands.length - 1); }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__rps = { game: this, RpsBot, star: () => CasualArt.StarShape };
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Data.set("mode", 1); this.Data.set("diff", 1); this.Data.set("power", 1); }
    CasualLook.calm(this, 1.2, 0.2);
    this.world = new GameObject("RpsWorld", this.gameObject);
    this.cover = CasualLook.cover(this.world, ArenaSprite(true), -910);
    this.divider = Art.spr(this.world, "Divider", Art.Glow, new Color(1, 0.7, 1, 0.5), 1, -5, Art.Additive);
    this.vs = Art.spr(this.world, "VS", VsBadge(), Color.white, 1.4, 30, Art.Flat);
    this.impact = Art.spr(this.world, "Impact", ImpactSprite(), new Color(1, 1, 1, 0), 3, 31, Art.Additive);
    for (let i = 0; i < 2; i++) this.seats.push(this.MakeSeat(i));
    this.fx = CasualFx.create(this.world, 60, 220);
    this.BuildHud();
    this.BuildTitle();
    this.BuildSounds();
    this.Layout();
  }

  private MakeSeat(i: number) {
    const s = new Seat();
    s.idx = i; s.color = SeatCol[i];
    s.root = new GameObject("Seat" + i, this.world);
    s.shadow = Art.spr(s.root, "Shadow", Art.Glow, new Color(0, 0, 0, 0.35), 3, 5, Art.Flat);
    s.glow = Art.spr(s.root, "Glow", Art.Glow, s.color.withAlpha(0), 5, 6, Art.Additive);
    s.hand = Art.spr(s.root, "Hand", HandSprite(Pick.Rock, 0, s.color, "s" + i), Color.white, 1, 10 + i, Art.Flat);
    const hud = this.UI.Hud;
    for (let k = 0; k < 3; k++) {
      const base = Art.spr(s.root, "Btn" + k, ButtonSprite(), s.color, 1, 20, Art.Flat);
      const icon = Art.spr(s.root, "Icon" + k, HandSprite(k, 0, s.color, "s" + i), Color.white, 1, 21, Art.Flat);
      const ring = Art.spr(s.root, "Ring" + k, RingSprite(), new Color(1, 1, 1, 0), 1, 22, Art.Flat);
      const label = UIKit.label(hud, PickNames[k], 30, White);
      UIKit.glow(label, Ink, 3);
      label.raycastTarget = false;
      s.btns.push({ base, icon, ring, label, local: V2.zero, size: 1 });
    }
    for (let k = 0; k < 2; k++) {
      const glow = Art.spr(s.root, "CardGlow" + k, Art.Glow, Gold.withAlpha(0), 1, 23, Art.Additive);
      const sr = Art.spr(s.root, "Card" + k, CardSprite(k), Color.white, 1, 24, Art.Flat);
      const label = UIKit.label(hud, k === 0 ? "DOUBLE" : "SHIELD", 22, White);
      UIKit.glow(label, Ink, 3);
      s.cards.push({ sr, glow, label, local: V2.zero, size: 1, kind: k });
    }
    for (let k = 0; k < 2; k++) s.pips.push(Art.spr(s.root, "Pip" + k, PipSprite(), Color.white, 0.7, 25, Art.Flat));
    s.status = UIKit.label(hud, "", 40, White);
    UIKit.glow(s.status, Ink, 4);
    s.nameT = UIKit.label(hud, "", 30, s.color);
    UIKit.glow(s.nameT, Ink, 3);
    return s;
  }

  private BuildSounds() {
    const noise = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    this.whooshClip = Sfx.make("rps-whoosh", 0.25, (t) => noise(Math.trunc(t * 44100)) * Sfx.env(t, 0.06, 0.15) * 0.3);
    this.slamClip = Sfx.make("rps-slam", 0.5, (t) => (Sfx.sinP(Sfx.glide(t, 180, 50, 0.25)) * 0.9 + noise(Math.trunc(t * 22050)) * 0.5 * Sfx.env(t, 0, 0.05)) * Sfx.env(t, 0.002, 0.4) * 0.8);
    this.winClip = Sfx.make("rps-win", 0.7, (t) => { const n = Math.min(3, Math.floor(t / 0.09)); const f = [523, 659, 784, 1047][n]; return (Sfx.sqrP(f * t) * 0.12 + Sfx.sinP(f * 2 * t) * 0.08) * Sfx.env(t - n * 0.09, 0.002, n === 3 ? 0.35 : 0.1); });
    this.drawClip = Sfx.make("rps-draw", 0.4, (t) => (Sfx.sinP(440 * t) + Sfx.sinP(466 * t)) * 0.18 * Sfx.env(t, 0.005, 0.3));
    this.lockClip = Sfx.make("rps-lock", 0.15, (t) => (Sfx.sinP(Sfx.glide(t, 700, 1100, 0.05)) * 0.4 + noise(Math.trunc(t * 44100)) * 0.3 * Sfx.env(t, 0, 0.01)) * Sfx.env(t, 0.002, 0.1));
    this.shieldClip = Sfx.make("rps-shield", 0.6, (t) => (Sfx.sinP(880 * t) * 0.3 + Sfx.sinP(1320 * t) * 0.2 + Sfx.sinP(1760 * t) * 0.1) * Sfx.env(t, 0.01, 0.5) * (0.7 + 0.3 * Math.sin(t * 60)));
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.topBar = UIKit.node("TopBar", hud).place(new V2(0, 1), new V2(220, -95), new V2(380, 150));
    UIKit.img(this.topBar, "Bg", Art.UiRound, new Color(0.06, 0.03, 0.14, 0.75)).rectTransform.stretch();
    UIKit.img(this.topBar, "Edge", Art.UiOutline, Gold.withAlpha(0.5)).rectTransform.stretch();
    this.topBig = UIKit.at(UIKit.label(this.topBar, "", 56, Color.white), UIKit.Center, new V2(0, 14), new V2(370, 70));
    UIKit.glow(this.topBig, Pal.hex(0x5a2a00), 4);
    this.topSmall = UIKit.at(UIKit.label(this.topBar, "", 26, Gold), UIKit.Center, new V2(0, -42), new V2(370, 34));
    this.banner = UIKit.label(hud, "", 76, Color.white);
    UIKit.glow(this.banner, Ink, 5);
    this.banner.gameObject.setActive(false);
    this.roundText = UIKit.label(hud, "", 30, new Color(1, 1, 1, 0.8));
    UIKit.glow(this.roundText, Ink, 3);
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    // kit gap: the shell sizes its logo for titles up to ~12 letters; this one is longer
    const logo = (this.UI as unknown as { logo?: Text }).logo;
    if (logo) { logo.fontSize = 78; logo.rectTransform.sizeDelta = new V2(1060, 150); }
    CasualLook.titleCard(this.UI, new Color(0.05, 0.02, 0.12, 0.7), new V2(1060, 1100), -30);
    const accents = [Green, Cyan, Orange];
    for (let i = 0; i < 3; i++) {
      const idx = i;
      this.modeButtons.push(UIKit.buttonAt(ex, ModeNames[i], UIKit.Center, new V2((i - 1) * 320, 20), new V2(300, 96), false, () => { this.Data.set("mode", idx); this.RefreshTitle(); }, 32));
      this.modeButtons[i].setAccent(accents[i]);
    }
    this.optButton = UIKit.buttonAt(ex, "OPTION", UIKit.Center, new V2(-320, -92), new V2(300, 84), false, () => this.CycleOption(), 26);
    this.powerButton = UIKit.buttonAt(ex, "POWER PICKS", UIKit.Center, new V2(0, -92), new V2(300, 84), false, () => { this.Data.set("power", this.Data.get("power") ^ 1); this.RefreshTitle(); }, 26);
    this.shopButton = UIKit.buttonAt(ex, "HANDS", UIKit.Center, new V2(320, -92), new V2(300, 84), false, () => this.OpenShop(true), 26);
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
    UIKit.glow(UIKit.at(UIKit.label(card, "HAND STYLES", 54, Color.white), C, new V2(0, 370), new V2(860, 70)), Ink, 3);
    UIKit.img(card, "Coin", CoinSprite(), Color.white).rectTransform.place(C, new V2(-70, 300), new V2(54, 54));
    this.shopCoins = UIKit.at(UIKit.label(card, "0", 44, Gold, TextAnchor.MiddleLeft), C, new V2(70, 300), new V2(220, 60));
    for (let k = 0; k < 3; k++) {
      const img = UIKit.img(card, "Hand" + k, HandSprite(k, 0, Cyan, "shop"), Color.white);
      img.rectTransform.place(C, new V2((k - 1) * 190, 90), new V2(150, 225));
      this.shopImgs.push(img);
    }
    this.shopName = UIKit.at(UIKit.label(card, "", 42, Color.white), C, new V2(0, -95), new V2(600, 56));
    UIKit.buttonAt(card, "<", C, new V2(-360, 90), new V2(100, 110), false, () => this.Browse(-1), 52).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(360, 90), new V2(100, 110), false, () => this.Browse(1), 52).setAccent(Gold);
    this.shopAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, -200), new V2(420, 92), false, () => this.ShopAction(), 32);
    UIKit.buttonAt(card, "CLOSE", C, new V2(0, -330), new V2(320, 84), true, () => this.OpenShop(false), 36).setAccent(Gold);
    this.shop.setActive(false);
  }

  private get SelMode() { return Mathf.clamp(this.Data.get("mode", 1), 0, 2) as Mode; }

  private CycleOption() {
    const m = this.SelMode;
    if (m === Mode.Cpu) this.Data.set("diff", (Mathf.clamp(this.Data.get("diff", 1), 0, 2) + 1) % 3);
    else if (m === Mode.Duo) this.Data.set("layout", this.Data.get("layout") ^ 1);
    else return;
    this.RefreshTitle();
  }

  private RefreshTitle() {
    if (!this.optButton) return;
    const m = this.SelMode, d = Mathf.clamp(this.Data.get("diff", 1), 0, 2), lay = this.Data.get("layout"), pw = this.Data.get("power") === 1;
    const accents = [Green, Cyan, Orange];
    this.modeButtons.forEach((b, i) => {
      b.setAccent(i === m ? accents[i] : new Color(1, 1, 1, 0.45));
      if (b.label) b.label.text = (i === m ? "● " : "") + ModeNames[i];
    });
    if (this.optButton.label) this.optButton.label.text = m === Mode.Solo ? "STREAK RUN" : m === Mode.Cpu ? `CPU: ${DiffNames[d]}` : lay === 0 ? "LAYOUT: TABLE" : "SIDE BY SIDE";
    this.optButton.setAccent(accents[m]);
    this.optButton.interactable = m !== Mode.Solo;
    if (this.powerButton.label) this.powerButton.label.text = pw ? "POWER PICKS: ON" : "POWER PICKS: OFF";
    this.powerButton.setAccent(pw ? Pal.hex(0xffb020) : new Color(1, 1, 1, 0.5));
    if (this.shopButton.label) this.shopButton.label.text = `HANDS · ${Hands[this.Style].name}`;
    if (this.shopButton.label) this.shopButton.label.fontSize = 22;
    this.modeLabel.text = m === Mode.Solo ? "HOW MANY WINS IN A ROW? ONE LOSS ENDS THE RUN"
      : m === Mode.Cpu ? `BEST OF THREE · THE CPU LEARNS YOUR HABITS · WIN ${Prizes[d]} COINS`
      : lay === 0 ? "FACE TO FACE: PLAYER 2 SITS ACROSS THE TABLE" : "SIDE BY SIDE: EACH PLAYER PICKS ON THEIR HALF";
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private OpenShop(on: boolean) {
    if (on) { this.browse = this.Style; this.RefreshShop(); } else this.RefreshTitle();
    this.shop.setActive(on);
  }
  private Browse(d: number) { this.browse = (this.browse + d + Hands.length) % Hands.length; Sfx.play(Snd.Click, 0.5); this.RefreshShop(); }
  private ShopAction() {
    const i = this.browse;
    if (i > 0 && this.Data.get("uh" + i) === 0) {
      if (this.Coins < Hands[i].cost) { Sfx.play(Snd.Deny, 0.6); return; }
      this.Coins = this.Coins - Hands[i].cost;
      this.Data.set("uh" + i, 1);
      Sfx.play(Snd.PowerUp, 0.8);
    }
    this.Data.set("hand", i);
    this.RefreshShop();
    this.ApplyStyles();
  }
  private RefreshShop() {
    const i = this.browse, h = Hands[i];
    this.shopCoins.text = Fmt.n(this.Coins);
    this.shopName.text = h.name;
    for (let k = 0; k < 3; k++) this.shopImgs[k].sprite = HandSprite(k, i, Cyan, "shop");
    const eq = this.Style === i, un = i === 0 || this.Data.get("uh" + i) === 1;
    if (this.shopAction.label) this.shopAction.label.text = eq ? "EQUIPPED" : un ? "EQUIP" : `UNLOCK · ${Fmt.n(h.cost)} COINS`;
    this.shopAction.setAccent(eq ? Pal.TextDim : un ? Cyan : this.Coins >= h.cost ? Gold : Pal.hex(0x8a7a6a));
    this.shopAction.interactable = !eq && (un || this.Coins >= h.cost);
  }

  /** Player 1 wears the equipped style; the CPU is a robot (classic if you are the robot); player 2 the next unlocked style. */
  private ApplyStyles() {
    const mine = this.Style;
    this.seats[0].style = mine;
    if (this.mode === Mode.Duo) {
      let o = 0;
      for (let k = 1; k <= Hands.length; k++) { const c = (mine + k) % Hands.length; if (c === 0 || this.Data.get("uh" + c) === 1) { o = c; break; } }
      this.seats[1].style = o === mine ? 0 : o;
    } else this.seats[1].style = mine === 2 ? 0 : 2;
    for (const s of this.seats) for (let k = 0; k < 3; k++) s.btns[k].icon.sprite = HandSprite(k, s.style, s.color, "s" + s.idx);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); this.relayout = 2; }
  private relayout = 2;

  private get Playing() { return this.State !== Phase.Title; }

  private Layout() {
    if (!this.world) return;
    this.Fx.CameraTarget = V2.zero;
    const v = this.ViewSize;
    this.portrait = v.y >= v.x;
    this.cover.sprite = CasualArt.hd(ArenaSprite(true));
    CasualLook.fitCover(this.cover, v);
    this.cover.transform.localEulerZ = 0;
    if (!this.portrait) {
      // the arena art is tall: turn it for wide screens
      this.cover.transform.localEulerZ = 90;
      const sr = this.cover, aspect = 2;
      sr.transform.localScale = new V3(v.y * 1.15 + 1, (v.x * 1.15 + 1) / aspect, 1);
    }
    this.uiPerWorld = 1080 / Math.min(v.x, v.y);
    const duo = this.Playing && this.mode === Mode.Duo;
    const r = this.PlayRect(this.Playing ? 150 : 0, this.Playing ? 10 : 0, 0.1);
    const s0 = this.seats[0], s1 = this.seats[1];
    const face = this.portrait ? !(duo && !this.table) : duo && this.table;
    const c = r.center;
    if (face) {
      s0.lay = s1.lay = Lay.Face;
      s0.mirror = s1.mirror = false;
      if (this.portrait) {
        const sc = Math.min(r.width / 10, r.height / 2 / 10.6);
        s0.pos = s1.pos = c; s0.rot = 0; s1.rot = 180; s0.scale = s1.scale = sc;
        s0.uiRot = 0; s1.uiRot = duo ? 180 : 0;
      } else {
        const sc = Math.min(r.height / 10, r.width / 2 / 10.6);
        s0.pos = s1.pos = c; s0.rot = -90; s1.rot = 90; s0.scale = s1.scale = sc;
        s0.uiRot = -90; s1.uiRot = 90;
      }
    } else {
      s0.lay = s1.lay = Lay.Side;
      const hw = r.width / 2;
      const sc = Math.min(hw / 8.4, r.height / 10.4);
      s0.pos = new V2(c.x - hw / 2, c.y); s1.pos = new V2(c.x + hw / 2, c.y);
      s0.rot = s1.rot = 0; s0.scale = s1.scale = sc;
      s0.mirror = false; s1.mirror = true;
      s0.uiRot = s1.uiRot = 0;
    }
    const vsScale = s0.scale;
    this.vs.transform.localPosition = face ? c : new V2(c.x, c.y + 1.2 * vsScale);
    this.vs.transform.localScale = new V2(1.5 * vsScale, 1.5 * vsScale);
    this.impact.transform.localPosition = this.vs.transform.localPosition;
    if (face) {
      const along = s0.rot === 0 ? new V2(v.x, 0.25 * vsScale) : new V2(0.25 * vsScale, v.y);
      this.divider.transform.localPosition = c;
      this.divider.transform.localScale = along.mul(1);
    } else {
      this.divider.transform.localPosition = c;
      this.divider.transform.localScale = new V2(0.25 * vsScale, v.y);
    }
    this.divider.gameObject.setActive(this.Playing);
    this.vs.gameObject.setActive(true);
    for (const s of this.seats) this.LayoutSeat(s);
    // top HUD bar (solo streak / match round)
    this.topBar.setActive(this.Playing && !(duo && this.table));
    this.topBar.place(new V2(0, 1), new V2(220, -95), new V2(380, 150));
    const rp = face ? (s0.rot === 0 ? c.add(new V2(-3.9 * vsScale, 0)) : c.add(new V2(0, 0))) : new V2(c.x, c.y + 3.2 * vsScale);
    this.roundText.rectTransform.place(UIKit.Center, this.UI.WorldToHud(rp), new V2(320, 50));
    this.roundText.rectTransform.localEulerAngles = new V3(0, 0, face && s0.rot !== 0 ? -90 : 0);
    this.roundText.gameObject.setActive(this.Playing && !(face && !this.portrait));
  }

  /** Canonical seat contents. FACE: owner at the bottom (y < 0), the centre line at y = 0. SIDE: upright, x+ towards the divider. */
  private LayoutSeat(s: Seat) {
    const face = s.lay === Lay.Face;
    const btnY = face ? -8.7 : -3.5, btnX = face ? 3.2 : 2.6, btnS = face ? 2.6 : 2.25;
    for (let k = 0; k < 3; k++) { s.btns[k].local = new V2((k - 1) * btnX * (s.mirror ? -1 : 1), btnY); s.btns[k].size = btnS; }
    for (let k = 0; k < 2; k++) {
      s.cards[k].local = face ? new V2((k === 0 ? -1 : 1) * 4.0, -5.7) : new V2(-3.2 + k * 1.45, 3.7);
      if (!face && s.mirror) s.cards[k].local = new V2(-s.cards[k].local.x, s.cards[k].local.y);
      s.cards[k].size = face ? 1.45 : 1.15;
    }
    for (let k = 0; k < 2; k++) {
      const l = face ? new V2(3.1 + k * 1.0, -1.15) : new V2(1.6 + k * 1.0, 3.55);
      s.pips[k].transform.localPosition = this.SeatPoint(s, l);
      s.pips[k].transform.localScale = new V2(0.8 * s.scale, 0.8 * s.scale);
    }
    const ui = (t: Text, local: V2, size: number, w: number) => {
      t.rectTransform.place(UIKit.Center, this.UI.WorldToHud(this.SeatPoint(s, local)), new V2(w, size * 1.4));
      t.fontSize = Math.round(size);
      t.rectTransform.localEulerAngles = new V3(0, 0, s.uiRot);
    };
    const k = s.scale * this.uiPerWorld / 100;
    for (let b = 0; b < 3; b++) ui(s.btns[b].label, s.btns[b].local.add(new V2(0, -btnS * 0.58)), 30 * k, 300);
    for (let b = 0; b < 2; b++) ui(s.cards[b].label, s.cards[b].local.add(new V2(0, -s.cards[b].size * 0.82)), 22 * k, 200);
    ui(s.status, face ? new V2(0, -6.6) : new V2(0, -1.25), 44 * k, 900);
    ui(s.nameT, face ? new V2(1.0, -1.15) : new V2(1.6, 4.5), 30 * k, 400);
    for (const b of s.btns) {
      const p = this.SeatPoint(s, b.local);
      b.base.transform.localPosition = p; b.icon.transform.localPosition = p.add(this.SeatDir(s, new V2(0, 0.05 * b.size)));
      b.ring.transform.localPosition = p;
      b.base.transform.localScale = new V2(b.size * s.scale, b.size * s.scale);
      b.ring.transform.localScale = new V2(b.size * s.scale * 1.12, b.size * s.scale * 1.12);
      b.icon.transform.localScale = new V2(b.size * 0.42 * s.scale, b.size * 0.42 * s.scale);
      b.icon.transform.localEulerZ = s.rot + (face ? 0 : 0);
    }
    for (const c of s.cards) {
      const p = this.SeatPoint(s, c.local);
      c.sr.transform.localPosition = p; c.glow.transform.localPosition = p;
      c.sr.transform.localEulerZ = s.uiRot;
      c.sr.transform.localScale = new V2(c.size * s.scale, c.size * s.scale);
      c.glow.transform.localScale = new V2(c.size * 2.4 * s.scale, c.size * 2.8 * s.scale);
    }
  }

  private SeatPoint(s: Seat, local: V2) {
    let x = local.x;
    const y = local.y;
    if (s.lay === Lay.Side && s.mirror) x = -x;
    const a = s.rot * Mathf.Deg2Rad, ca = Math.cos(a), sa = Math.sin(a);
    return new V2(s.pos.x + (x * ca - y * sa) * s.scale, s.pos.y + (x * sa + y * ca) * s.scale);
  }
  private SeatDir(s: Seat, local: V2) { return this.SeatPoint(s, local).sub(this.SeatPoint(s, V2.zero)); }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.mode = Mode.Cpu;
    this.shop?.setActive(false);
    this.ApplyStyles();
    for (const s of this.seats) this.ResetSeat(s, true);
    this.ShowSeatUI(false);
    this.Layout();
    this.step = Step.Shake; this.t = 0;
    this.RefreshTitle();
  }

  private ResetSeat(s: Seat, full: boolean) {
    s.pick = -1; s.locked = false; s.armed = -1; s.offset = 0; s.pop = 0; s.lose = 0; s.winGlow = 0; s.shown = Pick.Rock; s.thinking = 0;
    if (full) { s.wins = 0; s.powerUsed = false; s.freeShield = 0; s.throwsWon = 0; s.draws = 0; s.picks = [0, 0, 0]; s.powers = 0; }
  }

  private ShowSeatUI(on: boolean) {
    for (const s of this.seats) {
      const btn = on && s.human;
      for (const b of s.btns) { b.base.gameObject.setActive(btn); b.icon.gameObject.setActive(btn); b.ring.gameObject.setActive(btn); b.label.gameObject.setActive(btn); }
      for (const p of s.pips) p.gameObject.setActive(on && this.mode !== Mode.Solo);
      s.status.gameObject.setActive(on);
      s.nameT.gameObject.setActive(on && this.mode !== Mode.Solo);
      for (const c of s.cards) { c.sr.gameObject.setActive(false); c.glow.gameObject.setActive(false); c.label.gameObject.setActive(false); }
    }
  }

  protected BeginRun() {
    this.mode = this.SelMode;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.table = this.Data.get("layout") === 0;
    this.powers = this.Data.get("power") === 1;
    this.bot = new RpsBot(this.mode === Mode.Solo ? 1 : this.diff);
    for (const s of this.seats) this.ResetSeat(s, true);
    this.seats[0].human = true;
    this.seats[1].human = this.mode === Mode.Duo;
    this.seats[0].name = this.mode === Mode.Duo ? "PLAYER 1" : "YOU";
    this.seats[1].name = this.mode === Mode.Duo ? "PLAYER 2" : this.mode === Mode.Solo ? "CPU" : `CPU · ${DiffNames[this.diff]}`;
    if (this.pendingShield) { this.seats[0].freeShield = 1; this.pendingShield = false; this.UI.Toast("FREE SHIELD READY: tap it before you pick!", 3); }
    this.round = 1; this.streak = 0;
    this.revived = this.doubled = false;
    this.ApplyStyles();
    this.ShowSeatUI(true);
    this.relayout = 3;
    this.Layout();
    this.Data.add("games", 1);
    Sfx.setIntensity(0.25);
    this.BeginThrow();
  }

  private BeginThrow() {
    this.step = Step.Pick; this.t = 0; this.wordShown = -1; this.shieldSaved = -1;
    for (const s of this.seats) {
      s.pick = -1; s.locked = false; s.armed = -1; s.lose = 0; s.winGlow = 0; s.shown = Pick.Rock; s.pop = 0;
    }
    const cpu = this.seats[1];
    if (!cpu.human) {
      cpu.thinking = Random.range(0.5, 1.0);
      cpu.pick = this.bot.choose();
      if (this.mode === Mode.Cpu && this.powers && !cpu.powerUsed) {
        const me = this.seats[0];
        const conf = this.bot.lastConfidence;
        if (this.diff === 0) { if (Random.value < 0.25) cpu.armed = Random.rangeInt(0, 2); }
        else if (me.wins === 1 && Random.value < (this.diff === 2 ? 0.85 : 0.5)) cpu.armed = 1;
        else if (conf > 0.5 && Random.value < (this.diff === 2 ? 0.75 : 0.4)) cpu.armed = 0;
      }
    }
    this.UpdateLabels();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.relayout > 0 && --this.relayout === 0) this.Layout();
    if (this.State === Phase.Title) {
      // attract: the hands keep playing each other
      this.t += dt;
      if (this.step === Step.Shake && this.t >= ShakeTime) { for (const s of this.seats) s.pick = Random.rangeInt(0, 3); this.Reveal(true); }
      else if (this.step === Step.Reveal && this.t >= RevealTime + 0.6) { for (const s of this.seats) { s.lose = 0; s.winGlow = 0; } this.step = Step.Shake; this.t = 0; }
      if (this.step === Step.Shake) for (const s of this.seats) s.shown = Pick.Rock;
    }
    this.Present(dt);
  }

  protected TickRun(dt: number) {
    if (this.relayout > 0 && --this.relayout === 0) this.Layout();
    this.t += dt;
    switch (this.step) {
      case Step.Pick: this.TickPick(dt); break;
      case Step.Shake: this.TickShake(); break;
      case Step.Reveal:
        if (this.t >= RevealTime) this.AfterThrow();
        break;
      case Step.Over:
        if (this.t >= 1.3 && this.State === Phase.Playing) this.ShowResult();
        break;
    }
    this.Present(dt);
  }

  private TickPick(dt: number) {
    const cpu = this.seats[1];
    if (!cpu.human && !cpu.locked) { cpu.thinking -= dt; if (cpu.thinking <= 0) { cpu.locked = true; Sfx.playClip(this.lockClip, 0.4, 0.8); this.UpdateLabels(); } }
    this.ReadInput();
    if (this.seats.every((s) => s.locked)) {
      this.step = Step.Shake; this.t = 0; this.wordShown = -1;
      Sfx.setIntensity(0.6);
      this.UpdateLabels();
    }
  }

  private TickShake() {
    const w = Math.min(3, Math.floor(this.t / (ShakeTime / 4)));
    if (w !== this.wordShown) {
      this.wordShown = w;
      const col = w === 3 ? Gold : White;
      if (this.Table) for (const s of this.seats) this.SetStatus(s, Words[w], col);
      else { this.Banner(Words[w], col, 0.5); for (const s of this.seats) this.SetStatus(s, "", col); }
      if (w < 3) Sfx.playClip(this.whooshClip, 0.6, 0.9 + w * 0.1); else Sfx.play(Snd.BeepHigh, 0.6);
    }
    if (this.t >= ShakeTime * 0.75) this.Reveal(false);
  }

  private get Table() { return this.mode === Mode.Duo && this.table; }

  // ------------------------------------------------------------------ input

  private ReadInput() {
    const taps: V2[] = [];
    if (Touchscreen.present) for (const t of Touchscreen.touches) if (t.press.wasPressedThisFrame && !overUI(t.position)) taps.push(t.position);
    if (Mouse.leftButton.wasPressedThisFrame && !overUI(Mouse.position) && !(Touchscreen.present && Touchscreen.touches.length)) taps.push(Mouse.position);
    for (const sp of taps) {
      const w = this.ScreenToWorld(sp);
      for (const s of this.seats) {
        if (!s.human || s.locked) continue;
        for (let k = 0; k < 3; k++) {
          const b = s.btns[k];
          if (V2.distance(w, b.base.transform.localPosition as unknown as V2) < b.size * s.scale * 0.55) this.Choose(s, k);
        }
        for (const c of s.cards) {
          if (!c.sr.gameObject.activeSelf) continue;
          const p = c.sr.transform.localPosition;
          if (Math.abs(w.x - p.x) < c.size * s.scale * 0.6 && Math.abs(w.y - p.y) < c.size * s.scale * 0.8) this.Arm(s, c.kind);
        }
      }
    }
    // keyboard: 1 2 3 (or R P S) and Q / E for powers; player 2 uses 8 9 0 and O / P
    const p1 = this.seats[0], p2 = this.seats[1];
    const K = Keyboard;
    if (!p1.locked) {
      if (K.digit(1).wasPressedThisFrame || K.letter("r").wasPressedThisFrame) this.Choose(p1, 0);
      else if (K.digit(2).wasPressedThisFrame || (K.letter("p").wasPressedThisFrame && this.mode !== Mode.Duo)) this.Choose(p1, 1);
      else if (K.digit(3).wasPressedThisFrame || K.letter("s").wasPressedThisFrame) this.Choose(p1, 2);
      if (K.letter("q").wasPressedThisFrame) this.Arm(p1, 0);
      if (K.letter("e").wasPressedThisFrame) this.Arm(p1, 1);
    }
    if (p2.human && !p2.locked) {
      if (K.digit(8).wasPressedThisFrame) this.Choose(p2, 0);
      else if (K.digit(9).wasPressedThisFrame) this.Choose(p2, 1);
      else if (K.digit(0).wasPressedThisFrame) this.Choose(p2, 2);
      if (K.letter("o").wasPressedThisFrame) this.Arm(p2, 0);
      if (K.letter("p").wasPressedThisFrame) this.Arm(p2, 1);
    }
  }

  private CardAvailable(s: Seat, kind: number) {
    if (kind === 1 && s.freeShield > 0) return true;
    return this.powers && !s.powerUsed;
  }

  private Arm(s: Seat, kind: number) {
    if (s.locked || !this.CardAvailable(s, kind)) return;
    s.armed = s.armed === kind ? -1 : kind;
    Sfx.play(Snd.Click, 0.6, s.armed >= 0 ? 1.2 : 0.9);
    this.UpdateLabels();
  }

  private Choose(s: Seat, k: number) {
    s.pick = k; s.locked = true;
    s.picks[k]++;
    Sfx.playClip(this.lockClip, 0.7);
    Fx.haptic();
    s.btns[k].base.transform.localScale = s.btns[k].base.transform.localScale.mul(1.15);
    this.UpdateLabels();
  }

  // ------------------------------------------------------------------ reveal

  private Reveal(attract: boolean) {
    this.step = Step.Reveal; this.t = 0;
    const [a, b] = this.seats;
    for (const s of this.seats) { s.shown = s.pick as Pick; s.pop = 1; }
    this.impact.color = new Color(1, 0.95, 0.8, 1);
    Sfx.playClip(this.slamClip, attract ? 0.25 : 0.9);
    this.Fx.shake(attract ? 0.05 : 0.35);
    let res = beats(a.pick, b.pick) ? 1 : beats(b.pick, a.pick) ? -1 : 0;
    if (attract) { this.outcome = res; this.PaintOutcome(res, false); return; }
    // powers
    const used = [a.armed, b.armed];
    for (let i = 0; i < 2; i++) {
      const s = this.seats[i];
      if (used[i] < 0) continue;
      s.powers++;
      if (used[i] === 1 && s.freeShield > 0) s.freeShield--;
      else s.powerUsed = true;
    }
    this.shieldSaved = -1;
    if (res !== 0) {
      const loser = res > 0 ? 1 : 0;
      if (used[loser] === 1) { this.shieldSaved = loser; res = 0; }
    }
    this.outcome = res;
    this.PaintOutcome(res, true);
    const centre = this.vs.transform.localPosition as unknown as V2;
    this.fx.pop(centre, Color.white, 16, 7, 0.3, 0.4);
    if (res !== 0) {
      const w = this.seats[res > 0 ? 0 : 1];
      const pts = used[w.idx] === 0 ? 2 : 1;
      if (this.mode !== Mode.Solo) w.wins = Math.min(2, w.wins + pts);
      w.throwsWon++;
      if (this.mode === Mode.Solo) {
        if (res > 0) this.streak += pts;
      }
      const winnerPick = w.pick, loserPick = this.seats[1 - w.idx].pick;
      const line = `${PickNames[winnerPick]} ${Verbs[winnerPick]} ${PickNames[loserPick]}!`;
      const head = this.mode === Mode.Duo ? `${w.name} WINS THE THROW` : w.idx === 0 ? (pts === 2 ? "DOUBLE WIN!" : "YOU WIN!") : "CPU WINS";
      if (this.Table) for (const s of this.seats) this.SetStatus(s, s === w ? (pts === 2 ? "DOUBLE WIN!" : "YOU WIN!") : line, s === w ? Gold : White);
      else { this.Banner(line, w.color, 1.6); this.SetStatus(this.seats[0], head, w.idx === 0 ? Gold : Red); this.SetStatus(this.seats[1], "", White); }
      Sfx.playClip(this.winClip, 0.8, w.idx === 0 || this.mode === Mode.Duo ? 1 : 0.8);
      const tip = this.HandTip(w);
      this.fx.confetti(tip, 30, 6, [w.color, Gold, Color.white], 0.22);
      this.fx.sparkle(tip, Gold, 10, 1.2, 0.5);
      this.Back.Flash(w.color, 0.3);
      if (pts === 2) this.UI.Toast("DOUBLE: THIS WIN COUNTS TWICE!", 2);
      Fx.haptic(true);
    } else {
      for (const s of this.seats) s.draws++;
      const msg = this.shieldSaved >= 0 ? "SHIELD BLOCKS IT!" : "DRAW! GO AGAIN";
      if (this.shieldSaved >= 0) { Sfx.playClip(this.shieldClip, 0.8); this.fx.sparkle(this.HandTip(this.seats[this.shieldSaved]), Pal.hex(0x6ac8ff), 14, 1.4, 0.5); }
      else Sfx.playClip(this.drawClip, 0.7);
      if (this.Table) for (const s of this.seats) this.SetStatus(s, msg, White);
      else { this.Banner(msg, this.shieldSaved >= 0 ? Pal.hex(0x6ac8ff) : White, 1.4); for (const s of this.seats) this.SetStatus(s, "", White); }
    }
    this.bot.observe(a.pick, b.pick);
    this.UpdateLabels();
  }

  private PaintOutcome(res: number, real: boolean) {
    const [a, b] = this.seats;
    a.winGlow = res > 0 ? 1 : 0; b.winGlow = res < 0 ? 1 : 0;
    a.lose = res < 0 ? 1 : 0; b.lose = res > 0 ? 1 : 0;
    void real;
  }

  private HandTip(s: Seat) { return this.SeatPoint(s, this.HandLocal(s, 1.2)); }

  private AfterThrow() {
    const [a, b] = this.seats;
    if (this.mode === Mode.Solo) {
      if (this.outcome < 0) { this.EndMatch(); return; }
      this.round++;
      this.BeginThrow();
      return;
    }
    if (a.wins >= 2 || b.wins >= 2) { this.EndMatch(); return; }
    this.round++;
    this.BeginThrow();
  }

  private EndMatch() {
    this.step = Step.Over; this.t = 0;
    const [a, b] = this.seats;
    const solo = this.mode === Mode.Solo;
    const won = solo ? false : a.wins > b.wins;
    const head = solo ? `STREAK: ${this.streak}` : this.mode === Mode.Duo ? `${(a.wins > b.wins ? a : b).name} WINS THE MATCH!` : won ? "YOU WIN THE MATCH!" : "THE CPU WINS";
    const good = this.mode === Mode.Duo || won || (solo && this.streak > 0);
    if (this.Table) for (const s of this.seats) this.SetStatus(s, s.wins >= 2 ? "YOU WIN THE MATCH!" : "MATCH LOST", s.wins >= 2 ? Gold : Red);
    else this.Banner(head, good ? Gold : Red, 1.4);
    Sfx.play(good ? Snd.Win : Snd.Lose, 0.8);
    if (good) this.fx.confetti(V2.zero, 80, 10, [Cyan, Orange, Gold, Color.white], 0.3);
  }

  // ------------------------------------------------------------------ presentation

  /** Where a seat's hand sits (canonical), pushed forward by `fwd`. */
  private HandLocal(s: Seat, fwd: number) {
    return s.lay === Lay.Face ? new V2(0, -3.6 + fwd) : new V2(0.5 + fwd, 1.0);
  }

  private Present(dt: number) {
    this.TickBanner(Time.unscaledDeltaTime);
    const shaking = this.step === Step.Shake;
    const k = this.t;
    this.impact.color = this.impact.color.withAlpha(Mathf.moveTowards(this.impact.color.a, 0, dt * 3));
    const is = 1 + 2.5 * (1 - this.impact.color.a);
    this.impact.transform.localScale = new V2(is * this.seats[0].scale, is * this.seats[0].scale);
    const vsPulse = 1 + 0.06 * Math.sin(Time.time * 4);
    this.vs.transform.localScale = new V2(1.5 * vsPulse * this.seats[0].scale, 1.5 * vsPulse * this.seats[0].scale);
    this.vs.color = Color.white.withAlpha(this.step === Step.Reveal ? Mathf.clamp01(this.t * 2 - 1.5) : 1);
    for (const s of this.seats) {
      // fist bobbing on ROCK… PAPER… SCISSORS…, then the punch forward on SHOOT
      let off = 0;
      if (shaking) {
        const beat = ShakeTime / 4;
        off = k < beat * 3 ? -0.85 * Math.abs(Math.sin((Math.PI * k) / beat)) : 0.6 * Ease.outCubic(Mathf.clamp01((k - beat * 3) / 0.12));
      } else if (this.step === Step.Reveal || this.step === Step.Over) {
        off = 0.6 - 0.3 * Ease.outCubic(Mathf.clamp01(this.t / 0.5));
        if (s.winGlow > 0 && this.t > 0.3) off += 0.25 * Math.abs(Math.sin((this.t - 0.3) * 8)) * Math.max(0, 1 - (this.t - 0.3) / 1.4);
        if (s.lose > 0) off -= 0.5 * Ease.outCubic(Mathf.clamp01((this.t - 0.25) / 0.4));
      } else off = 0.08 * Math.sin(Time.time * 2.4 + s.idx);
      s.offset = off;
      s.pop = Mathf.moveTowards(s.pop, 0, dt * 3);
      const local = this.HandLocal(s, off);
      const p = this.SeatPoint(s, local);
      const shakeX = s.lose > 0 && (this.step === Step.Reveal) && this.t > 0.25 && this.t < 0.75 ? Math.sin(this.t * 70) * 0.08 * s.scale : 0;
      s.hand.transform.localPosition = p.add(this.SeatDir(s, new V2(1, 0)).mul(shakeX));
      const hs = (s.lay === Lay.Face ? 3.1 : 3.1) * s.scale * (1 + 0.18 * Ease.outCubic(s.pop));
      // the flip on SHOOT: squash across while the picture swaps
      const flip = this.step === Step.Reveal && this.t < 0.12 ? Math.abs(Math.cos(this.t / 0.12 * Math.PI)) : 1;
      s.hand.transform.localScale = new V2(hs * Math.max(0.15, flip), hs);
      const handRot = s.lay === Lay.Face ? 0 : s.mirror ? 90 : -90;
      s.hand.transform.localEulerZ = s.rot + handRot;
      s.hand.flipX = s.mirror;
      const shown = this.step === Step.Reveal || this.step === Step.Over ? s.shown : Pick.Rock;
      s.hand.sprite = HandSprite(shown, s.style, s.color, "s" + s.idx);
      s.hand.color = Color.lerp(Color.white, new Color(0.55, 0.55, 0.65, 1), s.lose * Mathf.clamp01((this.t - 0.3) * 3) * (this.step === Step.Reveal || this.step === Step.Over ? 1 : 0));
      s.glow.transform.localPosition = this.SeatPoint(s, this.HandLocal(s, off + 0.8));
      s.glow.transform.localScale = new V2(5.5 * s.scale, 5.5 * s.scale);
      s.glow.color = s.color.withAlpha((s.winGlow > 0 && this.step !== Step.Pick ? 0.55 + 0.2 * Math.sin(Time.time * 10) : 0.12) * (this.State === Phase.Title ? 0.6 : 1));
      s.shadow.transform.localPosition = this.SeatPoint(s, this.HandLocal(s, off - 0.4)).add(new V2(0.15, -0.2).mul(s.scale));
      s.shadow.transform.localScale = new V2(3.2 * s.scale, 3.2 * s.scale);
      if (this.State === Phase.Title) continue;
      // pick buttons
      for (let b = 0; b < 3; b++) {
        const btn = s.btns[b];
        const sel = s.locked && s.pick === b;
        const hide = s.locked && this.mode === Mode.Duo; // never show the other player what you picked
        const target = btn.size * s.scale * (s.locked ? 0.92 : 1 + 0.03 * Math.sin(Time.time * 3 + b));
        const cur = btn.base.transform.localScale.x;
        const ns = Mathf.lerp(cur, target, 1 - Math.exp(-dt * 12));
        btn.base.transform.localScale = new V2(ns, ns);
        btn.icon.transform.localScale = new V2(ns * 0.42, ns * 0.42);
        btn.base.color = s.locked ? (sel && !hide ? Color.lerp(s.color, Color.white, 0.25) : new Color(0.35, 0.35, 0.45, 1)) : s.color;
        btn.icon.color = s.locked && !(sel && !hide) ? new Color(1, 1, 1, 0.45) : Color.white;
        btn.ring.color = sel && !hide ? Gold.withAlpha(0.9) : new Color(1, 1, 1, 0);
        btn.label.color = s.locked && !(sel && !hide) ? new Color(1, 1, 1, 0.4) : White;
      }
      // power cards
      for (const c of s.cards) {
        const avail = this.CardAvailable(s, c.kind) && (this.step === Step.Pick || s.armed === c.kind) && this.State === Phase.Playing && (s.human || this.mode === Mode.Cpu);
        const showCpu = !s.human && this.step !== Step.Pick && s.armed === c.kind; // the CPU's card is revealed with its hand
        const vis = s.human ? avail : (this.powers && !s.powerUsed && this.step === Step.Pick && this.mode === Mode.Cpu) || showCpu;
        c.sr.gameObject.setActive(vis);
        c.label.gameObject.setActive(vis);
        c.glow.gameObject.setActive(vis);
        if (!vis) continue;
        const armed = s.armed === c.kind && (s.human || showCpu);
        const hidden = s.human && this.mode === Mode.Duo && s.locked;
        const lift = armed && !hidden ? 0.45 : 0;
        const p = this.SeatPoint(s, c.local.add(new V2(0, lift)));
        c.sr.transform.localPosition = p;
        c.glow.transform.localPosition = p;
        c.glow.color = Gold.withAlpha(armed && !hidden ? 0.6 + 0.25 * Math.sin(Time.time * 8) : 0);
        c.sr.color = !s.human && !showCpu ? new Color(0.35, 0.3, 0.45, 1) : Color.white;
      }
      // pips (best of three)
      for (let p = 0; p < 2; p++) s.pips[p].sprite = p < s.wins ? StarPip() : PipSprite();
    }
  }

  /** Big centre text between the hands (the shell's announcer sits too high for these layouts). */
  private Banner(text: string, col: Color, dur: number) {
    this.banner.text = text;
    this.banner.color = Color.lerp(col, Color.white, 0.25);
    this.banner.fontSize = text.length > 16 ? 60 : 78;
    this.bannerT = 0; this.bannerDur = dur;
    this.banner.gameObject.setActive(true);
    this.banner.rectTransform.place(UIKit.Center, this.UI.WorldToHud(this.vs.transform.localPosition as unknown as V2), new V2(1100, 120));
  }

  private TickBanner(dt: number) {
    if (this.bannerT > 8) return;
    this.bannerT += dt;
    const t = this.bannerT, d = this.bannerDur;
    if (t >= d) { this.banner.gameObject.setActive(false); this.bannerT = 9; return; }
    const sc = Mathf.lerp(1.6, 1, Ease.outBack(Mathf.clamp01(t / 0.3)));
    this.banner.rectTransform.localScale = new V3(sc, sc, 1);
    this.banner.color = this.banner.color.withAlpha(t > d - 0.3 ? (d - t) / 0.3 : Mathf.clamp01(t / 0.1));
  }

  private SetStatus(s: Seat, text: string, col: Color) { s.status.text = text; s.status.color = col; }

  private UpdateLabels() {
    const solo = this.mode === Mode.Solo;
    for (const s of this.seats) {
      s.nameT.text = s.name;
      if (this.step === Step.Pick) {
        if (s.human) this.SetStatus(s, s.locked ? (this.mode === Mode.Duo ? "LOCKED IN ✓" : "LOCKED IN") : s.armed === 0 ? "DOUBLE ARMED · PICK!" : s.armed === 1 ? "SHIELD ARMED · PICK!" : "PICK YOUR HAND", s.locked ? Green : White);
        else this.SetStatus(s, s.locked ? "READY" : "THINKING…", s.locked ? Green : new Color(1, 1, 1, 0.7));
      }
      for (const c of s.cards) c.label.text = c.kind === 0 ? "DOUBLE" : s.freeShield > 0 && (!this.powers || s.powerUsed) ? "FREE SHIELD" : "SHIELD";
    }
    this.topBig.text = solo ? `STREAK ${this.streak}` : `${this.seats[0].wins} – ${this.seats[1].wins}`;
    this.topSmall.text = solo ? `BEST ${this.Data.get("bestStreak")}` : "FIRST TO 2 WINS";
    this.roundText.text = solo ? `THROW ${this.round}` : `ROUND ${this.round}`;
  }

  // ------------------------------------------------------------------ results

  private ShowResult() {
    const [a, b] = this.seats;
    const fav = a.picks.indexOf(Math.max(...a.picks));
    if (this.mode === Mode.Solo) {
      const st = this.streak;
      const prev = this.Data.get("bestStreak");
      const nb = this.Data.max("bestStreak", st);
      const earned = st * 5;
      this.lastPrize = earned;
      this.Coins = this.Coins + earned;
      this.Finish(new Result({
        Headline: st >= 10 ? "UNSTOPPABLE!" : st >= 5 ? "HOT STREAK!" : "STREAK OVER",
        HeadlineColor: st > 0 ? Gold : Pal.hex(0xffb0c0),
        Value: String(st), CountTo: st, NewBest: nb && prev > 0, Victory: st > 0,
        BestLine: `WINS IN A ROW   ·   BEST ${this.Data.get("bestStreak")}   ·   +${earned} COINS`,
        Stats: [["THROWS", String(this.round)], ["DRAWS", String(a.draws)], ["FAVOURITE", PickNames[fav]], ["POWERS USED", String(a.powers)]],
        Primary: "NEW RUN",
        Reward: !this.revived ? () => this.ContinueStreak() : !this.doubled && earned > 0 ? () => this.DoubleCoins() : null,
        RewardLabel: !this.revived ? "KEEP THE STREAK + A FREE SHIELD (AD)" : `DOUBLE COINS: +${earned} (AD)`,
      }));
      return;
    }
    if (this.mode === Mode.Cpu) {
      const won = a.wins > b.wins;
      const prize = won ? Prizes[this.diff] : 10;
      this.lastPrize = prize;
      this.Coins = this.Coins + prize;
      if (won) { this.Data.add("wins", 1); this.Data.add("w" + this.diff, 1); }
      this.Finish(new Result({
        Headline: won ? `YOU BEAT THE ${DiffNames[this.diff]} CPU!` : "THE CPU READ YOU",
        HeadlineColor: won ? Gold : Pal.hex(0xffb0c0),
        Value: `${a.wins} – ${b.wins}`, Victory: won,
        BestLine: `+${prize} COINS   ·   COINS ${Fmt.n(this.Coins)}`,
        Stats: [["ROUNDS", String(this.round)], ["DRAWS", String(a.draws)], ["YOUR FAVOURITE", PickNames[fav]], ["CPU POWERS", String(b.powers)]],
        Primary: won ? "PLAY AGAIN" : "REMATCH",
        Reward: won ? () => this.DoubleCoins() : () => { this.pendingShield = true; this.StartRun(); },
        RewardLabel: won ? `DOUBLE COINS: +${prize} (AD)` : "REMATCH WITH A FREE SHIELD (AD)",
      }));
      return;
    }
    const w = a.wins > b.wins ? a : b;
    this.Data.add("duels", 1);
    this.Finish(new Result({
      Headline: `${w.name} WINS!`, HeadlineColor: w.color, Victory: true,
      Value: `${a.wins} – ${b.wins}`, BestLine: "BEST OF THREE",
      Stats: [["ROUNDS", String(this.round)], ["DRAWS", String(a.draws)], ["P1 FAVOURITE", PickNames[fav]], ["P2 FAVOURITE", PickNames[b.picks.indexOf(Math.max(...b.picks))]]],
      Primary: "REMATCH",
    }));
  }

  private ContinueStreak() {
    this.revived = true;
    this.Coins = this.Coins - this.lastPrize;
    this.seats[0].freeShield = 1;
    this.Revive();
    this.round++;
    this.BeginThrow();
    this.Banner("STREAK SAVED!", Gold, 1.2);
    this.UI.Toast("FREE SHIELD: tap it before you pick to turn a loss into a draw.", 3.5);
  }

  private DoubleCoins() {
    this.doubled = true;
    this.Coins = this.Coins + this.lastPrize;
    this.UI.Toast(`+${this.lastPrize} COINS: DOUBLED!`, 2.5);
    Sfx.play(Snd.Coin, 0.8);
  }

  /** Test hook: CSS-pixel centres of a seat's pick buttons and cards. */
  debugTargets(seat: number) {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect(), k = c.width / r.width;
    const cam = (window as unknown as { __na: { Camera: { worldToScreen(p: V2 | V3): { x: number; y: number } } } }).__na.Camera;
    const s = this.seats[seat];
    const to = (p: V2 | V3) => { const sp = cam.worldToScreen(p); return { x: r.left + sp.x / k, y: r.top + sp.y / k }; };
    return { btns: s.btns.map((b) => to(b.base.transform.localPosition)), cards: s.cards.map((cd) => ({ ...to(cd.sr.transform.localPosition), on: cd.sr.gameObject.activeSelf })), step: this.step, locked: s.locked };
  }
}
