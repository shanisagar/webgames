import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject, howTo, Image, Keyboard,
  LineRenderer, LoopSource, Mathf, Mesh, Mouse, overUI, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer, Text,
  TextAnchor, Time, Touchscreen, TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import {
  ButtonFace, CloudSprite, StarsSprite, CoinSprite, Danger, Flame, FlameSprite, FlagSprite, Gold, Ink, Mint, P1Col, P2Col, PlanetSprite,
  PuffSprite, RocketSkins, RocketSprite, ShieldBubble, SkySprite,
} from "./RocketArt";
import { BotLevels, crashPoint, multAt, newSeat, Rate, rng, RocketBot, Rounds, Seat, Stake } from "./RocketSim";

/**
 * CASH-OUT ROCKET: a nerve game played for points. A rocket climbs a shared graph while its multiplier rises from
 * 1.00×; it can crash at any moment (a fair crash point drawn each round, revealed only at the crash). Hit CASH OUT to
 * bank 100 × the current multiplier; wait too long and the round scores zero. Five short rounds, running totals.
 * SOLO (beat your best total), VS COMPUTER (a bot with a hidden target that adapts to the score gap) or 2 PLAYERS
 * (one shared graph, a button on each player's side, true multi-touch). Twist: a SHIELD bubble rides the curve; tap
 * it to keep half your round points if the rocket crashes (once per match each). Coins unlock rocket skins.
 */

const White = Pal.hex(0xffffff);
const ModeNames = ["SOLO", "VS COMPUTER", "2 PLAYERS"];
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const BotNames = ["ROOKIE BOT", "PILOT BOT", "ACE BOT"];
const Prizes = [30, 60, 120];
const SeatCols = [P1Col, P2Col];

enum Step { Ready, Flight, Crashed, Wait }

interface Panel {
  node: UINode; face: Image; glow: Image; title: Text; sub: Text; total: Text; name: Text; shieldIcon: Image; shieldText: Text;
  pop: number; size: V2;
}

export class CashRocketGame extends ArcadeGame {
  private sky!: SpriteRenderer; private stars!: SpriteRenderer; private planet!: SpriteRenderer; private clouds!: SpriteRenderer;
  private graphMesh = new Mesh(); private border!: LineRenderer;
  private areaMesh = new Mesh();
  private curve!: LineRenderer; private curveGlow!: LineRenderer;
  private grid: LineRenderer[] = []; private gridLabels: Text[] = [];
  private rocketRoot!: GameObject; private rocket!: SpriteRenderer; private flame!: SpriteRenderer; private rocketGlow!: SpriteRenderer;
  private shield!: SpriteRenderer;
  private flags: SpriteRenderer[] = []; private flagLabels: Text[] = [];
  private fx!: CasualFx;

  private mode = 1; private diff = 1;
  private seats: Seat[] = [];
  private bot: RocketBot | null = null;
  private botShieldAt = -1;
  private round = 0;
  private step = Step.Wait; private timer = 0;
  private t = 0; private m = 1; private crash = 2; private roundRand: () => number = Math.random;
  private viewT = 6; private viewM = 2;
  private cashT = [0, 0];
  private shieldSpawnM = 0; private shieldLife = 0; private shieldClaimed = [false, false];
  private shieldsEnabled = true;
  private bestRoundMult = 0; private roundsBanked = 0; private shieldSaves = 0;
  private G = { x0: -5, y0: -5, x1: 5, y1: 5 };
  private portrait = true;
  private lastTickHalf = 2; private beat = 0;
  private attractT = 0;
  private doubled = false;

  private panels: Panel[] = [];
  private multText: Text[] = [];
  private roundPill!: UINode; private roundText!: Text; private roundPips: Image[] = [];
  private touchSeat = new Map<number, number>();

  private modeButtons: ArcadeButton[] = [];
  private diffButton!: ArcadeButton; private shopButton!: ArcadeButton; private shieldButton!: ArcadeButton;
  private modeLabel!: Text;
  private shop!: UINode; private shopCoins!: Text; private shopImg!: Image; private shopName!: Text; private shopAction!: ArcadeButton; private browse = 0;

  private crowdClip!: AudioClip; private riseClip!: AudioClip; private cashClip!: AudioClip; private boomClip!: AudioClip;
  private launchClip!: AudioClip; private cheerClip!: AudioClip; private thumpClip!: AudioClip; private shieldClip!: AudioClip;
  private crowd: LoopSource | null = null; private rise: LoopSource | null = null;

  protected Describe() {
    return new GameInfo({
      Id: "cashrocket",
      Title: "CASH-OUT ROCKET",
      Tagline: "HOW HIGH DARE YOU RIDE IT?",
      PlayLabel: "PLAY",
      Accent: Mint,
      Accent2: Gold,
      BgTop: Pal.hex(0x1a0f4a),
      BgBottom: Pal.hex(0x5a2a8a),
      GridSpacing: 1.4,
      ShortSide: 20,
      Touch: TouchScheme.None,
      Music: { bpm: 118, rootHz: 98, degrees: [0, 4, 5, 3], seed: 31, energy: 0.55, major: true },
      Reminders: [
        "The rocket is fuelled|How high will you ride it?",
        "Can you out-nerve the ACE BOT?|Five rounds, one winner.",
        "Two players, one rocket|Who cashes out first?",
      ],
      HowTo: [
        howTo(Art.Chevron, Mint, "The rocket climbs and the multiplier rises from 1.00×. It can crash at ANY moment."),
        howTo(Art.RoundSquare, Gold, "Tap CASH OUT to bank 100 × the multiplier. Still riding when it crashes? Zero points."),
        howTo(Art.Disc, Pal.hex(0x8ae6ff), "SHIELD bubble: tap it as it rides the curve to keep half your points if it crashes. Once per match."),
        howTo(Art.Star, P2Col, "Five rounds. Highest total wins. 2 PLAYERS: each has a button on their own side."),
        howTo(Art.Diamond, P1Col, "SOLO: set your best total. VS COMPUTER: the bot hides its target and adapts to the score."),
        howTo(CoinSprite(), Color.white, "Earn coins and unlock new rockets."),
      ],
      Tips: [
        "Behind on points? You'll need a braver ride.",
        "Ahead? Bank early and make them chase.",
        "Watch when the bot cashes out, then decide.",
        "Every crash point is fair: trust your nerve.",
      ],
    });
  }

  protected get ShortSide() { return 20; }
  private get Coins() { return this.Data.get("coins", 0); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }
  private get SkinSel() { return Mathf.clamp(this.Data.get("rskin"), 0, RocketSkins.length - 1); }
  private Has(i: number) { return i === 0 || this.Data.get("own_r" + i) === 1; }
  protected BestLine() { return `◉ ${Fmt.n(this.Coins)}   ·   BEST TOTAL ${Fmt.n(this.Data.get("bestTotal"))}   ·   WINS ${this.Data.get("wins")}`; }
  protected StatsLine() { return ""; }
  private get Humans() { return this.mode === 2 ? 2 : 1; }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Coins = 60; this.Data.set("mode", 1); this.Data.set("diff", 1); this.Data.set("shields", 1); }
    const root = this.gameObject;
    this.sky = CasualLook.cover(root, SkySprite());
    this.stars = Art.spr(root, "Stars", StarsSprite(), Color.white, 1, -890, Art.Flat);
    this.planet = Art.spr(root, "Planet", PlanetSprite(), Color.white, 6, -880, Art.Flat);
    this.clouds = Art.spr(root, "Clouds", CloudSprite(), Color.white, 30, -870, Art.Flat);
    Art.meshObject(root, "GraphBg", this.graphMesh, Art.Flat, -10);
    this.border = Art.line(root, "Border", Pal.hex(0xd8c8ff).withAlpha(0.45), 0.08, -9, true, true, Art.LineMat);
    for (let i = 0; i < 7; i++) {
      this.grid.push(Art.line(root, "Grid" + i, new Color(1, 1, 1, 0.12), 0.05, -8, false, true, Art.LineSoftMat));
      const lbl = UIKit.label(this.UI.Hud, "", 26, new Color(1, 1, 1, 0.55), TextAnchor.MiddleLeft);
      lbl.raycastTarget = false;
      this.gridLabels.push(lbl);
    }
    Art.meshObject(root, "Area", this.areaMesh, Art.Flat, -5);
    this.curveGlow = Art.line(root, "CurveGlow", Mint.withAlpha(0.35), 0.7, -4, false, true, Art.LineMat);
    this.curve = Art.line(root, "Curve", Mint, 0.2, -3, false, true, Art.LineMat);
    for (let i = 0; i < 2; i++) {
      const f = Art.spr(root, "Flag" + i, FlagSprite(), SeatCols[i], 0.9, 6, Art.Flat);
      f.gameObject.setActive(false);
      this.flags.push(f);
      const l = UIKit.label(this.UI.Hud, "", 28, SeatCols[i]);
      UIKit.glow(l, Ink, 3);
      l.raycastTarget = false;
      l.gameObject.setActive(false);
      this.flagLabels.push(l);
    }
    this.rocketRoot = new GameObject("Rocket", root);
    this.rocketGlow = Art.spr(this.rocketRoot, "Glow", Art.Glow, Flame.withAlpha(0.4), 3.2, 7, Art.Additive);
    this.rocketGlow.transform.localPosition = new V3(-1.0, 0, 0);
    this.flame = Art.spr(this.rocketRoot, "Flame", FlameSprite(), Color.white, 1.5, 8, Art.Additive);
    this.flame.transform.localPosition = new V3(-1.35, 0, 0);
    this.rocket = Art.spr(this.rocketRoot, "Body", RocketSprite(RocketSkins[0], "0"), Color.white, 2.4, 9, Art.Flat);
    this.shield = Art.spr(root, "Shield", ShieldBubble(), Color.white, 1.9, 12, Art.Flat);
    this.shield.gameObject.setActive(false);
    this.fx = CasualFx.create(root, 20, 320);
    this.BuildHud();
    this.BuildTitle();
    this.BuildSounds();
    this.ApplySkin();
    // kit gap: the shell sizes the logo for titles up to ~12 letters; shrink ours to fit a phone
    const logo = (this.UI as unknown as { logo?: Text }).logo;
    if (logo) logo.fontSize = 100;
    this.Layout();
  }

  private BuildSounds() {
    const noise = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    let lp = 0, lp2 = 0;
    this.crowdClip = Sfx.make("cr-crowd", 2, (t) => {
      const n = noise(Math.trunc(t * 22050));
      lp += (n - lp) * 0.09; lp2 += (lp - lp2) * 0.2;
      const am = 0.6 + 0.25 * Math.sin(2 * Math.PI * t * 1.5) + 0.15 * Math.sin(2 * Math.PI * t * 3.5 + 1);
      return (lp - lp2 * 0.6) * 2.2 * am;
    }, false);
    this.riseClip = Sfx.make("cr-rise", 1, (t) => {
      const trem = 0.75 + 0.25 * Math.sin(2 * Math.PI * 8 * t);
      return (Sfx.sinP(220 * t) * 0.35 + Sfx.sinP(330 * t) * 0.2 + Sfx.triP(440 * t) * 0.1 + Sfx.sinP(110 * t) * 0.2) * trem * 0.6;
    }, false);
    this.cashClip = Sfx.make("cr-cash", 0.7, (t) => {
      const notes = [880, 1108.7, 1318.5, 1760];
      let v = 0;
      for (let k = 0; k < 4; k++) v += Sfx.sinP(notes[k] * t) * Sfx.env(t - k * 0.05, 0.002, 0.35) * 0.22 + Sfx.sqrP(notes[k] * 0.5 * t) * Sfx.env(t - k * 0.05, 0.002, 0.1) * 0.05;
      return v;
    });
    this.boomClip = Sfx.make("cr-boom", 1.4, (t) => (Sfx.sinP(Sfx.glide(t, 120, 30, 0.8)) * 0.6 * Sfx.env(t, 0.003, 0.7) + noise(Math.trunc(t * 22050)) * Sfx.env(t, 0.001, 0.5) * 0.6) * 0.85);
    this.launchClip = Sfx.make("cr-launch", 1.2, (t) => noise(Math.trunc(t * 30000)) * Math.min(1, t * 4) * Sfx.env(t, 0.3, 0.6) * 0.35 + Sfx.sinP(Sfx.glide(t, 90, 260, 1.2)) * 0.2 * Sfx.env(t, 0.2, 0.6));
    let c1 = 0;
    this.cheerClip = Sfx.make("cr-cheer", 1.3, (t) => { const n = noise(Math.trunc(t * 22050) + 99); c1 += (n - c1) * 0.25; return c1 * 1.4 * Sfx.env(t, 0.08, 0.7) * (0.8 + 0.2 * Math.sin(t * 40)); });
    this.thumpClip = Sfx.make("cr-thump", 0.2, (t) => Sfx.sinP(Sfx.glide(t, 90, 45, 0.12)) * Sfx.env(t, 0.002, 0.1) * 0.8);
    this.shieldClip = Sfx.make("cr-shield", 0.5, (t) => (Sfx.sinP(Sfx.glide(t, 500, 1400, 0.25)) * 0.3 + Sfx.triP(Sfx.glide(t, 750, 2100, 0.25)) * 0.12) * Sfx.env(t, 0.005, 0.3));
  }

  // ------------------------------------------------------------------ HUD

  private BuildHud() {
    const hud = this.UI.Hud;
    for (let i = 0; i < 2; i++) {
      const node = UIKit.node("Panel" + i, hud);
      const glow = UIKit.img(node, "Glow", Art.Glow, SeatCols[i].withAlpha(0.3));
      glow.rectTransform.stretch(-90);
      const face = UIKit.img(node, "Face", ButtonFace(), SeatCols[i]);
      face.rectTransform.stretch();
      UIKit.img(node, "Edge", Art.UiOutline, new Color(1, 1, 1, 0.55)).rectTransform.stretch();
      const name = UIKit.label(node, "", 30, Ink);
      const total = UIKit.label(node, "", 32, Ink);
      const title = UIKit.label(node, "CASH OUT", 74, White);
      UIKit.glow(title, Ink.withAlpha(0.7), 4);
      const sub = UIKit.label(node, "", 40, Ink);
      const shieldIcon = UIKit.img(node, "Shield", ShieldBubble(), Color.white);
      const shieldText = UIKit.label(node, "", 24, Ink, TextAnchor.MiddleLeft);
      for (const tx of [name, total, title, sub, shieldText]) tx.raycastTarget = false;
      this.panels.push({ node, face, glow, title, sub, total, name, shieldIcon, shieldText, pop: 0, size: new V2(900, 300) });
    }
    for (let i = 0; i < 2; i++) {
      const t = UIKit.label(hud, "1.00×", 150, White);
      UIKit.glow(t, Ink.withAlpha(0.85), 6);
      t.raycastTarget = false;
      this.multText.push(t);
    }
    this.roundPill = UIKit.node("Round", hud);
    UIKit.img(this.roundPill, "Bg", Art.UiRound, new Color(0.08, 0.04, 0.2, 0.75)).rectTransform.stretch();
    this.roundText = UIKit.at(UIKit.label(this.roundPill, "ROUND 1/5", 28, White), UIKit.Center, new V2(0, 14), new V2(260, 36));
    for (let k = 0; k < Rounds; k++) {
      const pip = UIKit.img(this.roundPill, "Pip", Art.UiCircle, new Color(1, 1, 1, 0.25));
      pip.rectTransform.place(UIKit.Center, new V2((k - 2) * 36, -22), new V2(22, 22));
      this.roundPips.push(pip);
    }
  }

  // ------------------------------------------------------------------ title & shop

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    CasualLook.titleCard(this.UI, new Color(0.1, 0.05, 0.28, 0.6), new V2(1060, 1080), -10);
    for (let i = 0; i < 3; i++) {
      const idx = i;
      this.modeButtons.push(UIKit.buttonAt(ex, ModeNames[i], UIKit.Center, new V2((i - 1) * 330, 10), new V2(315, 96), false, () => this.PickMode(idx), i === 1 ? 27 : 30));
    }
    const row = -98;
    this.diffButton = UIKit.buttonAt(ex, "MEDIUM", UIKit.Center, new V2(-330, row), new V2(315, 84), false, () => this.CycleDiff(), 26);
    this.shieldButton = UIKit.buttonAt(ex, "SHIELDS ON", UIKit.Center, new V2(0, row), new V2(315, 84), false, () => this.ToggleShields(), 26);
    this.shopButton = UIKit.buttonAt(ex, "ROCKETS", UIKit.Center, new V2(330, row), new V2(315, 84), false, () => this.OpenShop(true), 26);
    this.shopButton.setAccent(Gold);
    this.modeLabel = UIKit.at(UIKit.label(ex, "", 25, new Color(1, 1, 1, 0.85)), UIKit.Center, new V2(0, -172), new V2(980, 36));
    this.BuildShop(ex.parent!);
    this.RefreshTitle();
  }

  private BuildShop(parent: UINode) {
    const C = UIKit.Center;
    this.shop = UIKit.node("Shop", parent).stretch();
    UIKit.dim(this.shop, 0.82);
    const card = UIKit.card(this.shop, new V2(900, 760), Gold);
    UIKit.glow(UIKit.at(UIKit.label(card, "ROCKET HANGAR", 56, Color.white), C, new V2(0, 300), new V2(800, 70)), Ink, 3);
    UIKit.img(card, "Coin", CoinSprite(), Color.white).rectTransform.place(C, new V2(-60, 225), new V2(54, 54));
    this.shopCoins = UIKit.at(UIKit.label(card, "0", 46, Gold, TextAnchor.MiddleLeft), C, new V2(85, 225), new V2(220, 60));
    this.shopImg = UIKit.img(card, "Rocket", RocketSprite(RocketSkins[0], "0"), Color.white);
    this.shopImg.rectTransform.place(C, new V2(0, 70), new V2(340, 170));
    this.shopName = UIKit.at(UIKit.label(card, "", 44, Color.white), C, new V2(0, -85), new V2(600, 56));
    UIKit.buttonAt(card, "<", C, new V2(-340, 70), new V2(100, 110), false, () => this.Browse(-1), 52).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(340, 70), new V2(100, 110), false, () => this.Browse(1), 52).setAccent(Gold);
    this.shopAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, -180), new V2(400, 92), false, () => this.ShopAction(), 32);
    UIKit.buttonAt(card, "CLOSE", C, new V2(0, -300), new V2(320, 84), true, () => this.OpenShop(false), 36).setAccent(Gold);
    this.shop.setActive(false);
  }

  private PickMode(i: number) { this.Data.set("mode", i); this.mode = i; Sfx.play(Snd.Click, 0.6); this.RefreshTitle(); }
  private CycleDiff() { if (this.Data.get("mode", 1) !== 1) return; this.Data.set("diff", (this.Data.get("diff", 1) + 1) % 3); Sfx.play(Snd.Click, 0.6); this.RefreshTitle(); }
  private ToggleShields() { this.Data.set("shields", this.Data.get("shields", 1) ? 0 : 1); Sfx.play(Snd.Click, 0.6); this.RefreshTitle(); }

  private RefreshTitle() {
    if (this.modeButtons.length === 0) return;
    const m = Mathf.clamp(this.Data.get("mode", 1), 0, 2), d = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    const accents = [Mint, P1Col, P2Col];
    this.modeButtons.forEach((b, i) => b.setAccent(i === m ? accents[i] : new Color(1, 1, 1, 0.45)));
    const set = (b: ArcadeButton, s: string) => { if (b.label) b.label.text = s; };
    set(this.diffButton, m === 1 ? `BOT: ${DiffNames[d]}` : "—");
    this.diffButton.interactable = m === 1;
    this.diffButton.setAccent([Mint, Gold, Danger][d]);
    const sh = this.Data.get("shields", 1) === 1;
    set(this.shieldButton, sh ? "SHIELDS ON" : "SHIELDS OFF");
    this.shieldButton.setAccent(sh ? Pal.hex(0x8ae6ff) : new Color(1, 1, 1, 0.5));
    set(this.shopButton, `ROCKETS ◉${this.Coins}`);
    const free = this.Data.get("freeShield") > 0 ? " · +1 FREE SHIELD!" : "";
    this.modeLabel.text = (m === 0 ? "5 ROUNDS · BANK THE BIGGEST TOTAL YOU CAN"
      : m === 1 ? `5 ROUNDS VS ${BotNames[d]} · WIN ${Prizes[d]} COINS`
      : "SHARED ROCKET · A CASH OUT BUTTON ON EACH SIDE") + free;
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private OpenShop(on: boolean) {
    if (on) { this.browse = this.SkinSel; this.RefreshShop(); } else this.RefreshTitle();
    this.shop.setActive(on);
    Sfx.play(Snd.Click, 0.6);
  }
  private Browse(d: number) { this.browse = (this.browse + d + RocketSkins.length) % RocketSkins.length; Sfx.play(Snd.Tick, 0.5); this.RefreshShop(); }
  private ShopAction() {
    const i = this.browse, s = RocketSkins[i];
    if (!this.Has(i)) {
      if (this.Coins < s.cost) { Sfx.play(Snd.Deny, 0.6); return; }
      this.Coins = this.Coins - s.cost;
      this.Data.set("own_r" + i, 1);
      Sfx.play(Snd.Coin, 0.8); Sfx.play(Snd.PowerUp, 0.6);
    } else Sfx.play(Snd.Confirm, 0.6);
    this.Data.set("rskin", i);
    this.ApplySkin();
    this.RefreshShop();
  }
  private RefreshShop() {
    const s = RocketSkins[this.browse];
    this.shopCoins.text = Fmt.n(this.Coins);
    this.shopImg.sprite = RocketSprite(s, String(this.browse));
    this.shopName.text = s.name;
    const equipped = this.SkinSel === this.browse, owned = this.Has(this.browse);
    if (this.shopAction.label) this.shopAction.label.text = equipped ? "EQUIPPED" : owned ? "EQUIP" : `UNLOCK ◉ ${s.cost}`;
    this.shopAction.setAccent(equipped ? Pal.TextDim : owned ? Mint : this.Coins >= s.cost ? Gold : Pal.hex(0x8a7a6a));
    this.shopAction.interactable = !equipped && (owned || this.Coins >= s.cost);
  }
  private ApplySkin() { this.rocket.sprite = RocketSprite(RocketSkins[this.SkinSel], String(this.SkinSel)); }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); this.layoutFrames = 2; }
  private layoutFrames = 3;

  private Layout() {
    if (!this.rocket) return;
    const V = this.ViewSize;
    this.portrait = V.y > V.x;
    CasualLook.fitCover(this.sky, V);
    const big = Math.max(V.x, V.y) * 1.1;
    this.stars.transform.localPosition = new V3(0, V.y * 0.05, 0);
    this.stars.transform.localScale = new V3(big, big, 1);
    this.planet.transform.localPosition = new V3(V.x * 0.32, V.y * 0.3, 0);
    this.planet.transform.localScale = V3.one.mul(Math.min(V.x, V.y) * 0.3);
    const cs = Math.min(V.x, V.y);
    this.clouds.transform.localPosition = new V3(0, -V.y / 2 + cs * 0.02, 0);
    this.clouds.transform.localScale = new V3(V.x * 1.15, cs * 0.5, 1);
    const two = this.mode === 2, playing = this.State !== Phase.Title;
    let r;
    if (this.portrait) {
      const top = two ? 520 : this.mode === 1 ? 500 : 330;
      r = this.PlayRect(top, 380, 0.45);
    } else {
      r = this.PlayRect(140, 50, 0.4);
      const u = V.y / 1080, side = 470 * u;
      r = { xMin: r.xMin + side, xMax: r.xMax - side, yMin: r.yMin, yMax: r.yMax };
    }
    if (!playing) r = this.PlayRect(80, 80, 0.8);
    this.G = { x0: r.xMin, y0: r.yMin, x1: r.xMax, y1: r.yMax };
    const g = this.G;
    const a = new Color(0.12, 0.06, 0.32, 0.62), b = new Color(0.25, 0.1, 0.45, 0.5);
    this.graphMesh.vertices = [new V3(g.x0, g.y0, 0), new V3(g.x1, g.y0, 0), new V3(g.x0, g.y1, 0), new V3(g.x1, g.y1, 0)];
    this.graphMesh.colors = [b, b, a, a];
    this.graphMesh.triangles = [0, 2, 1, 2, 3, 1];
    this.graphMesh.markDirty();
    this.border.positionCount = 4;
    this.border.setPositions([new V2(g.x0, g.y0), new V2(g.x1, g.y0), new V2(g.x1, g.y1), new V2(g.x0, g.y1)]);
    this.LayoutPanels();
  }

  private LayoutPanels() {
    const two = this.mode === 2;
    const hud = this.UI.Hud.rect;
    for (let i = 0; i < 2; i++) {
      const p = this.panels[i];
      const visible = this.State !== Phase.Title && (i === 0 || this.mode !== 0 || true);
      p.node.setActive(visible);
      let pos: V2, size: V2, rot = 0, anchor: V2;
      if (this.portrait) {
        const w = Math.min(980, hud.width - 60);
        if (i === 0) { anchor = new V2(0.5, 0); pos = new V2(0, 200); size = new V2(w, 300); }
        else if (two) { anchor = new V2(0.5, 1); pos = new V2(0, -400); size = new V2(w, 240); rot = 180; }
        else { anchor = new V2(0.5, 1); pos = new V2(0, this.mode === 1 ? -380 : -300); size = new V2(w - 200, this.mode === 1 ? 200 : 110); }
      } else {
        anchor = new V2(i === 0 ? 0 : 1, 0.5);
        pos = new V2((i === 0 ? 1 : -1) * 250, -60);
        size = i === 0 || two ? new V2(420, 600) : new V2(400, this.mode === 1 ? 420 : 300);
      }
      p.node.place(anchor, pos, size);
      p.node.localEulerAngles = new V3(0, 0, rot);
      p.size = size;
      const wide = size.x > size.y * 1.4, small = i === 1 && !two;
      const C = UIKit.Center;
      if (wide && small) {
        p.name.rectTransform.place(C, new V2(-size.x / 2 + 150, size.y / 2 - 34), new V2(260, 40));
        p.total.rectTransform.place(C, new V2(size.x / 2 - 170, size.y / 2 - 34), new V2(300, 40));
        p.title.rectTransform.place(C, new V2(0, -4), new V2(size.x - 40, 70));
        p.sub.rectTransform.place(C, new V2(size.x / 2 - 150, -size.y / 2 + 34), new V2(260, 40));
        p.shieldIcon.rectTransform.place(C, new V2(-size.x / 2 + 50, -size.y / 2 + 36), new V2(48, 48));
        p.shieldText.rectTransform.place(C, new V2(-size.x / 2 + 165, -size.y / 2 + 36), new V2(180, 36));
      } else if (wide) {
        p.name.rectTransform.place(C, new V2(-size.x / 2 + 170, size.y / 2 - 38), new V2(300, 40));
        p.total.rectTransform.place(C, new V2(size.x / 2 - 190, size.y / 2 - 38), new V2(340, 40));
        p.title.rectTransform.place(C, new V2(0, small ? -12 : 4), new V2(size.x - 40, 90));
        p.sub.rectTransform.place(C, new V2(0, -size.y / 2 + 40), new V2(size.x - 40, 50));
        p.shieldIcon.rectTransform.place(C, new V2(-size.x / 2 + 60, -size.y / 2 + 48), new V2(64, 64));
        p.shieldText.rectTransform.place(C, new V2(-size.x / 2 + 200, -size.y / 2 + 48), new V2(200, 40));
      } else {
        p.name.rectTransform.place(C, new V2(0, size.y / 2 - 45), new V2(size.x - 20, 40));
        p.total.rectTransform.place(C, new V2(0, size.y / 2 - 95), new V2(size.x - 20, 40));
        p.title.rectTransform.place(C, new V2(0, 10), new V2(size.x - 20, 90));
        p.sub.rectTransform.place(C, new V2(0, -70), new V2(size.x - 20, 50));
        p.shieldIcon.rectTransform.place(C, new V2(-70, -size.y / 2 + 60), new V2(64, 64));
        p.shieldText.rectTransform.place(C, new V2(60, -size.y / 2 + 60), new V2(180, 40));
      }
      p.title.fontSize = small ? (this.mode === 1 ? 52 : 40) : wide ? 80 : 64;
      p.sub.fontSize = small ? 30 : 40;
    }
    // multiplier readouts: one for player 1 (and a flipped one for player 2 at the top in portrait duels)
    // the curve bends below the diagonal, so the upper-left of the graph stays clear for the readout
    const g = this.G, gw = g.x1 - g.x0, gh2 = g.y1 - g.y0;
    const flip = two && this.portrait;
    const at = (fx: number, fy: number) => this.UI.WorldToHud(new V2(g.x0 + gw * fx, g.y0 + gh2 * fy));
    this.multText[0].rectTransform.place(UIKit.Center, flip ? at(0.62, 0.2) : at(0.42, 0.68), new V2(700, 170));
    this.multText[1].rectTransform.place(UIKit.Center, at(0.4, 0.72), new V2(700, 170));
    this.multText[1].rectTransform.localEulerAngles = new V3(0, 0, 180);
    this.multText[1].gameObject.setActive(flip && this.State !== Phase.Title);
    const tc = this.UI.WorldToHud(new V2((this.G.x0 + this.G.x1) / 2, this.G.y1));
    this.roundPill.place(UIKit.Center, tc.add(new V2(0, -55)), new V2(260, 84));
    this.roundPill.localEulerAngles = V3.zero;
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.mode = Mathf.clamp(this.Data.get("mode", 1), 0, 2);
    this.step = Step.Wait;
    this.StopLoops();
    for (const p of this.panels) p.node.setActive(false);
    for (const t of this.multText) t.gameObject.setActive(false);
    this.roundPill.setActive(false);
    for (const f of this.flags) f.gameObject.setActive(false);
    for (const l of this.flagLabels) l.gameObject.setActive(false);
    this.shield.gameObject.setActive(false);
    this.shop?.setActive(false);
    this.ApplySkin();
    this.Layout();
    this.StartAttract();
    this.RefreshTitle();
  }

  private StartAttract() {
    this.t = 0; this.m = 1; this.viewT = 6; this.viewM = 2;
    this.crash = Math.max(2.5, crashPoint(Math.random()));
    this.attractT = 0;
    this.rocketRoot.setActive(true);
  }

  protected BeginRun() {
    this.mode = Mathf.clamp(this.Data.get("mode", 1), 0, 2);
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.shieldsEnabled = this.Data.get("shields", 1) === 1;
    this.Data.add("games", 1);
    const free = this.Data.get("freeShield") > 0 ? 1 : 0;
    if (free) { this.Data.set("freeShield", 0); this.UI.Toast("FREE SHIELD: YOU HAVE 2 THIS MATCH!", 2.5); }
    const sh = this.shieldsEnabled ? 1 : 0;
    this.seats = [newSeat(false, sh + free)];
    if (this.mode !== 0) this.seats.push(newSeat(this.mode === 1, sh));
    this.bot = this.mode === 1 ? new RocketBot(BotLevels[this.diff]) : null;
    this.roundRand = rng((Math.random() * 2 ** 31) | 0);
    this.round = 0;
    this.doubled = false;
    this.bestRoundMult = 0; this.roundsBanked = 0; this.shieldSaves = 0;
    this.touchSeat.clear();
    for (const t of this.multText) t.gameObject.setActive(true);
    this.roundPill.setActive(true);
    if (!this.crowd) this.crowd = Sfx.createLoop(this.crowdClip);
    if (!this.rise) this.rise = Sfx.createLoop(this.riseClip);
    this.layoutFrames = 2;
    this.Layout();
    this.NextRound();
  }

  private NextRound() {
    this.round++;
    this.crash = crashPoint(this.roundRand());
    this.t = 0; this.m = 1; this.viewT = 6; this.viewM = 2;
    this.cashT = [0, 0];
    for (const s of this.seats) { s.cashed = 0; s.bank = 0; s.shieldOn = false; }
    this.shieldClaimed = [false, false];
    this.shieldLife = 0;
    const anyShield = this.seats.some((s) => s.shields > 0);
    // a shield bubble shows up in most rounds (always in the last one if someone still holds a shield)
    this.shieldSpawnM = anyShield && (this.roundRand() < 0.7 || this.round === Rounds) ? 1.15 + this.roundRand() * 0.5 : 0;
    this.botShieldAt = -1;
    if (this.bot) this.bot.plan(this.seats[1], this.seats[0], Rounds - this.round + 1);
    for (const f of this.flags) f.gameObject.setActive(false);
    for (const l of this.flagLabels) l.gameObject.setActive(false);
    this.shield.gameObject.setActive(false);
    this.rocketRoot.setActive(true);
    this.step = Step.Ready;
    this.timer = 2.2;
    this.lastTickHalf = 2;
    this.UI.Announce(this.round === Rounds ? "FINAL ROUND!" : `ROUND ${this.round}`, this.round === Rounds ? Gold : White, 1.2);
    Sfx.play(Snd.Beep, 0.6);
    this.RefreshPanels();
  }

  protected OnPauseChanged(paused: boolean) {
    this.touchSeat.clear();
    if (paused) { if (this.crowd) this.crowd.volume = 0; if (this.rise) this.rise.volume = 0; }
  }

  private StopLoops() { if (this.crowd) this.crowd.volume = 0; if (this.rise) this.rise.volume = 0; }

  // ------------------------------------------------------------------ frame loop

  protected TickBackground(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    if (this.State === Phase.Title) {
      // attract: a calm demo flight that "cashes out" on a loop
      this.attractT += dt;
      if (this.m < this.crash) { this.t += dt; this.m = multAt(this.t); }
      else if (this.attractT > 0) { this.Explode(true); this.attractT = -2.2; this.m = this.crash; }
      if (this.attractT < 0 && this.attractT + dt >= 0) this.StartAttract();
    }
    if (this.crowd && this.State !== Phase.Playing) { this.crowd.volume = Mathf.moveTowards(this.crowd.volume, 0, dt); this.rise!.volume = Mathf.moveTowards(this.rise!.volume, 0, dt * 2); }
    this.Present(dt);
  }

  protected TickRun(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    this.timer -= dt;
    switch (this.step) {
      case Step.Ready: {
        this.ReadInput(dt);
        const half = Math.ceil(this.timer / 0.7);
        if (half < this.lastTickHalf && half >= 1) { this.lastTickHalf = half; Sfx.play(Snd.Tick, 0.6, 1 + (3 - half) * 0.15); }
        if (this.timer <= 0) {
          this.step = Step.Flight;
          this.UI.Announce("LIFT OFF!", Mint, 0.7);
          Sfx.playClip(this.launchClip, 0.8);
          this.Fx.shake(0.25);
          this.beat = 0;
        }
        break;
      }
      case Step.Flight: {
        const allDone = this.seats.every((s) => s.cashed > 0);
        const k = allDone ? 2.6 : 1;
        this.t += dt * k;
        this.m = multAt(this.t);
        if (this.m >= this.crash) { this.m = this.crash; this.t = Math.log(this.crash) / Rate; this.Crash(); break; }
        this.ReadInput(dt);
        this.TickBot(dt);
        this.TickShield(dt);
        // heartbeat + milestone ticks
        this.beat -= dt;
        if (this.beat <= 0 && !allDone) { this.beat = Math.max(0.28, 0.85 / Math.sqrt(this.m)); Sfx.playClip(this.thumpClip, 0.55, 1); }
        const mile = Math.floor(this.m * 2);
        if (mile > this.lastMile) { this.lastMile = mile; if (mile >= 4) Sfx.play(Snd.Tick, 0.45, Math.min(2.2, 0.8 + mile * 0.06)); }
        const tension = Mathf.clamp01(Math.log(this.m) / Math.log(8));
        if (this.crowd) { this.crowd.volume = Mathf.moveTowards(this.crowd.volume, allDone ? 0.12 : 0.18 + 0.4 * tension, dt); this.crowd.pitch = 1 + 0.3 * tension; }
        if (this.rise) { this.rise.volume = Mathf.moveTowards(this.rise.volume, allDone ? 0.05 : 0.14 + 0.16 * tension, dt); this.rise.pitch = 0.8 + 1.4 * tension; }
        Sfx.setIntensity(0.3 + 0.7 * tension);
        this.Back.setDanger(allDone ? 0 : tension * 0.35);
        break;
      }
      case Step.Crashed: {
        if (this.timer <= 0) {
          if (this.round >= Rounds) { this.step = Step.Wait; this.startCoroutine(this.ResultLater()); }
          else this.NextRound();
        }
        break;
      }
      case Step.Wait: break;
    }
    if (this.step !== Step.Flight) this.StopLoopsSoft(dt);
    this.RefreshPanels();
    this.Present(dt);
  }
  private lastMile = 2;

  private StopLoopsSoft(dt: number) {
    if (this.crowd) this.crowd.volume = Mathf.moveTowards(this.crowd.volume, 0, dt * 1.5);
    if (this.rise) this.rise.volume = Mathf.moveTowards(this.rise.volume, 0, dt * 3);
  }

  // ------------------------------------------------------------------ input (multi-touch: each player's own button)

  private SeatAtPanel(screen: V2) {
    for (let i = 0; i < this.Humans; i++) {
      const p = this.panels[i];
      if (!p.node.activeSelf) continue;
      const l = p.node.screenToLocal(screen);
      if (Math.abs(l.x) <= p.size.x / 2 + 20 && Math.abs(l.y) <= p.size.y / 2 + 20) return i;
    }
    return -1;
  }

  private SideOf(screen: V2) {
    if (this.Humans === 1) return 0;
    return this.portrait ? (screen.y < Screen.height / 2 ? 0 : 1) : (screen.x < Screen.width / 2 ? 0 : 1);
  }

  private Press(screen: V2) {
    if (overUI(screen)) return;
    // shield first (it rides the curve), then the buttons
    if (this.shield.gameObject.activeSelf) {
      const sp = this.ScreenToWorld(screen), sh = this.shield.transform.localPosition;
      if (Math.hypot(sp.x - sh.x, sp.y - sh.y) < 1.7) { this.ClaimShield(this.SideOf(screen)); return; }
    }
    const seat = this.SeatAtPanel(screen);
    if (seat >= 0) this.CashOut(seat);
  }

  private ReadInput(_dt: number) {
    if (Touchscreen.present) {
      for (const t of Touchscreen.touches) if (t.press.wasPressedThisFrame) this.Press(t.position);
    }
    if (Mouse.leftButton.wasPressedThisFrame && !(Touchscreen.present && Touchscreen.touches.length > 0)) this.Press(Mouse.position);
    if (Keyboard.space.wasPressedThisFrame || Keyboard.letter("a").wasPressedThisFrame) this.CashOut(0);
    if (this.mode === 2 && (Keyboard.enter.wasPressedThisFrame || Keyboard.letter("l").wasPressedThisFrame)) this.CashOut(1);
    if (Keyboard.letter("s").wasPressedThisFrame) this.ClaimShield(0);
    if (this.mode === 2 && Keyboard.letter("k").wasPressedThisFrame) this.ClaimShield(1);
  }

  private CashOut(i: number) {
    if (this.step !== Step.Flight || i >= this.seats.length) return;
    const s = this.seats[i];
    if (s.cashed > 0) return;
    s.cashed = Math.floor(this.m * 100) / 100;
    s.bank = Math.round(Stake * s.cashed);
    this.cashT[i] = this.t;
    if (!s.bot) { this.bestRoundMult = Math.max(this.bestRoundMult, s.cashed); }
    const rp = this.CurvePoint(this.t, this.m);
    this.fx.pop(rp, Gold, 18, 6, 0.22, 0.5);
    this.fx.sparkle(rp, SeatCols[i], 10, 1.2, 0.3);
    this.UI.Float(rp.add(new V2(0, 1.2)), `+${s.bank}`, SeatCols[i], 1.2);
    this.panels[i].pop = 1;
    Sfx.playClip(this.cashClip, 0.8, Mathf.clamp(0.9 + Math.log(s.cashed) * 0.25, 0.9, 1.6));
    if (!s.bot) { Sfx.playClip(this.cheerClip, 0.35 + 0.3 * Mathf.clamp01(Math.log(s.cashed) / 2)); Fx.haptic(true); }
    this.flags[i].gameObject.setActive(true);
    this.flagLabels[i].gameObject.setActive(true);
    this.flagLabels[i].text = `${this.mode === 1 ? (i === 1 ? "BOT " : "YOU ") : this.mode === 0 ? "" : "P" + (i + 1) + " "}${s.cashed.toFixed(2)}×`;
  }

  private ClaimShield(i: number) {
    if (this.step !== Step.Flight || !this.shield.gameObject.activeSelf || i >= this.seats.length) return;
    const s = this.seats[i];
    if (s.shields <= 0 || s.cashed > 0 || this.shieldClaimed[i]) { if (!s.bot) Sfx.play(Snd.Deny, 0.5); return; }
    s.shields--; s.shieldOn = true; this.shieldClaimed[i] = true;
    const p = this.shield.transform.localPosition;
    this.fx.pop(new V2(p.x, p.y), Pal.hex(0x8ae6ff), 16, 5, 0.2, 0.5);
    Sfx.playClip(this.shieldClip, 0.8);
    this.UI.Float(new V2((this.G.x0 + this.G.x1) / 2, p.y + 1.4), this.mode === 0 ? "SHIELD UP!" : this.mode === 1 && i === 1 ? "BOT TOOK A SHIELD" : `P${i + 1} SHIELD UP!`, SeatCols[i], 0.9);
    this.panels[i].pop = 0.6;
    // everyone eligible has it: the bubble pops away
    if (this.seats.every((ss, k) => this.shieldClaimed[k] || ss.shields <= 0 || ss.cashed > 0)) this.shieldLife = Math.min(this.shieldLife, 0.25);
  }

  private TickBot(dt: number) {
    if (!this.bot) return;
    const me = this.seats[1], opp = this.seats[0];
    if (this.bot.update(this.m, dt, me, opp, Rounds - this.round + 1, opp.cashed > 0)) this.CashOut(1);
    if (this.botShieldAt > 0 && this.shield.gameObject.activeSelf) { this.botShieldAt -= dt; if (this.botShieldAt <= 0) this.ClaimShield(1); }
  }

  private TickShield(dt: number) {
    if (this.shieldSpawnM > 0 && this.m >= this.shieldSpawnM) {
      this.shieldSpawnM = 0;
      this.shieldLife = 3.2;
      this.shield.gameObject.setActive(true);
      Sfx.play(Snd.Pickup, 0.6);
      if (this.bot && this.seats[1].shields > 0 && this.bot.wantsShield()) this.botShieldAt = 0.5 + Math.random() * 0.8 + (2 - this.diff) * 0.3;
    }
    if (this.shield.gameObject.activeSelf) {
      this.shieldLife -= dt;
      if (this.shieldLife <= 0) { this.shield.gameObject.setActive(false); const p = this.shield.transform.localPosition; this.fx.pop(new V2(p.x, p.y), Color.white, 8, 3, 0.15, 0.3); }
    }
  }

  // ------------------------------------------------------------------ crash

  private Crash() {
    this.step = Step.Crashed;
    this.timer = 2.6;
    const humanNear = this.seats.some((s) => !s.bot && s.cashed > 0 && this.crash / s.cashed < 1.12);
    const humanBust = this.seats.some((s) => !s.bot && s.cashed === 0);
    this.Explode(false);
    if (humanNear) { this.SlowMo(0.25, 0.9); this.UI.Announce("CLOSE CALL!", Gold, 1.3); }
    else this.SlowMo(0.45, 0.45);
    this.shield.gameObject.setActive(false);
    // settle the round
    let bestBank = -1, bestSeat = -1;
    this.seats.forEach((s, i) => {
      if (s.cashed === 0 && s.shieldOn) { s.bank = Math.round(Stake * 0.5); if (!s.bot) this.shieldSaves++; this.UI.Float(this.CurvePoint(this.t, this.m).add(new V2(0, -1.5 - i)), this.mode === 1 && i === 1 ? "BOT SHIELD +50" : "SHIELD SAVED +50", SeatCols[i], 1); }
      s.total += s.bank;
      if (!s.bot && s.cashed > 0) this.roundsBanked++;
      if (s.bank > bestBank) { bestBank = s.bank; bestSeat = i; } else if (s.bank === bestBank) bestSeat = -1;
    });
    if (bestSeat >= 0 && this.seats.length > 1 && bestBank > 0) this.seats[bestSeat].roundsWon++;
    if (!humanNear) this.UI.Announce(`CRASHED AT ${this.crash.toFixed(2)}×`, Danger, 1.4);
    if (humanBust && !humanNear) Sfx.play(Snd.Lose, 0.4);
    this.lastMile = 2;
    this.Back.setDanger(0);
  }

  private Explode(quiet: boolean) {
    const p = this.CurvePoint(this.t, this.m);
    const skin = RocketSkins[this.SkinSel];
    this.fx.pop(p, Flame, quiet ? 18 : 40, quiet ? 6 : 10, 0.35, 0.8);
    this.fx.pop(p, Gold, quiet ? 10 : 24, 7, 0.25, 0.6);
    this.fx.confetti(p, quiet ? 10 : 30, 9, [skin.body, skin.accent, skin.trim, Color.white], 0.25);
    for (let k = 0; k < (quiet ? 5 : 14); k++) this.fx.emit(p, Random2(5), new Color(0.8, 0.75, 0.9, 0.7), 1.1, 1.2, PuffSprite(), 0, 0, true, 2.5);
    this.rocketRoot.setActive(false);
    if (quiet) { Sfx.playClip(this.boomClip, 0.25); return; }
    this.Fx.ring(p, Flame, 0.5, 7, 0.5);
    this.Fx.shake(0.9);
    this.Fx.kick(0.6, 0.4);
    this.Back.Flash(Flame, 0.65);
    this.Hitstop(0.05);
    Fx.haptic(true);
    Sfx.playClip(this.boomClip, 0.9);
    Sfx.play(Snd.Explode, 0.5);
  }

  // ------------------------------------------------------------------ rendering

  private CurvePoint(t: number, m: number) {
    const g = this.G, gx0 = g.x0 + (g.x1 - g.x0) * 0.1, gx1 = g.x1 - (g.x1 - g.x0) * 0.1;
    const gy0 = g.y0 + (g.y1 - g.y0) * 0.08, gy1 = g.y1 - (g.y1 - g.y0) * 0.14;
    return new V2(gx0 + (t / this.viewT) * (gx1 - gx0), gy0 + ((m - 1) / (this.viewM - 1)) * (gy1 - gy0));
  }

  private Present(dt: number) {
    const flying = this.step === Step.Flight || this.State === Phase.Title;
    // axes grow smoothly to keep the rocket in view
    const wantT = Math.max(6, this.t * 1.12 + 0.6), wantM = Math.max(2, (this.m - 1) * 1.22 + 1.15);
    this.viewT = Math.max(this.viewT, Mathf.lerp(this.viewT, wantT, 1 - Math.exp(-dt * 6)));
    this.viewM = Math.max(this.viewM, Mathf.lerp(this.viewM, wantM, 1 - Math.exp(-dt * 6)));
    if (wantT > this.viewT * 1.05) this.viewT = wantT / 1.05;
    if (wantM > this.viewM * 1.05) this.viewM = wantM / 1.05;
    // curve + area
    const N = 48, pts: V2[] = [];
    for (let i = 0; i <= N; i++) { const tt = this.t * i / N; pts.push(this.CurvePoint(tt, multAt(tt))); }
    const tension = Mathf.clamp01(Math.log(this.m) / Math.log(6));
    const crashed = this.step === Step.Crashed || (this.State === Phase.Title && this.m >= this.crash);
    const col = crashed ? Danger : Color.lerp(Color.lerp(Mint, Gold, Mathf.clamp01(tension * 2)), Flame, Mathf.clamp01(tension * 2 - 1));
    this.curve.positionCount = pts.length; this.curve.setPositions(pts);
    this.curveGlow.positionCount = pts.length; this.curveGlow.setPositions(pts);
    this.curve.startColor = Mint; this.curve.endColor = col;
    this.curveGlow.startColor = Mint.withAlpha(0.1); this.curveGlow.endColor = col.withAlpha(0.45);
    const base = this.CurvePoint(0, 1).y;
    const v: V3[] = [], c: Color[] = [], tri: number[] = [];
    for (let i = 0; i <= N; i++) {
      v.push(new V3(pts[i].x, base, 0), new V3(pts[i].x, pts[i].y, 0));
      const cc = Color.lerp(Mint, col, i / N);
      c.push(cc.withAlpha(0.02), cc.withAlpha(0.32));
      if (i > 0) { const a = (i - 1) * 2; tri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    this.areaMesh.vertices = v; this.areaMesh.colors = c; this.areaMesh.triangles = tri; this.areaMesh.markDirty();
    // grid
    const steps = [0.25, 0.5, 1, 2, 5, 10, 20];
    const range = this.viewM - 1;
    let st = steps[steps.length - 1];
    for (const s of steps) if (range / s <= 5) { st = s; break; }
    const g = this.G;
    for (let k = 0; k < this.grid.length; k++) {
      const mm = 1 + st * k, on = mm <= this.viewM && (this.State !== Phase.Title);
      const y = this.CurvePoint(0, mm).y;
      const ln = this.grid[k], lb = this.gridLabels[k];
      ln.positionCount = on ? 2 : 0;
      if (on) ln.setPositions([new V2(g.x0 + 0.2, y), new V2(g.x1 - 0.2, y)]);
      lb.gameObject.setActive(on);
      if (on) { lb.text = `${mm % 1 === 0 ? mm.toFixed(0) : mm.toFixed(2)}×`; lb.rectTransform.place(UIKit.Center, this.UI.WorldToHud(new V2(g.x0 + 0.25, y + 0.32)).add(new V2(60, 0)), new V2(120, 32)); }
    }
    // rocket
    const rp = this.CurvePoint(this.t, this.m);
    const dx = (this.CurvePoint(this.t + 0.05, multAt(this.t + 0.05)).x - rp.x), dy = (this.CurvePoint(this.t + 0.05, multAt(this.t + 0.05)).y - rp.y);
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const wobble = flying && this.step !== Step.Ready ? Math.sin(Time.time * 30) * 0.06 * tension : 0;
    this.rocketRoot.localPosition = new V3(rp.x + wobble, rp.y, 0);
    this.rocketRoot.localEulerZ = this.step === Step.Ready ? 40 : ang;
    const fl = this.step === Step.Ready ? 0.45 + 0.1 * Math.sin(Time.time * 40) : 0.9 + 0.35 * Math.sin(Time.time * 47) + 0.4 * tension;
    this.flame.transform.localScale = new V3(1.5 * fl, 1.5 * (0.8 + 0.2 * Math.sin(Time.time * 31)), 1);
    this.flame.transform.localPosition = new V3(-1.15 - 0.4 * fl, 0, 0);
    this.rocketGlow.color = Flame.withAlpha(0.3 + 0.3 * tension);
    if (this.rocketRoot.activeSelf && flying && Math.random() < 0.9) {
      const back = new V2(-Math.cos(ang * Math.PI / 180), -Math.sin(ang * Math.PI / 180));
      const tail = rp.add(back.mul(1.5));
      this.fx.emit(tail, back.mul(2.5).add(Random2(0.8)), new Color(1, 0.85, 0.95, 0.55), 0.55 + Math.random() * 0.4, 0.9, PuffSprite(), 0, 0, false, 1.2);
      if (Math.random() < 0.5) this.fx.emit(tail, back.mul(5).add(Random2(1.5)), Color.lerp(Flame, Gold, Math.random()), 0.18, 0.35, null, 0, 0, true, 2);
    }
    // shield bubble rides the curve a little behind the rocket
    if (this.shield.gameObject.activeSelf) {
      const st2 = Math.max(0, this.t - 0.9);
      const sp = this.CurvePoint(st2, multAt(st2)).add(new V2(0, 0.9 + 0.2 * Math.sin(Time.time * 4)));
      this.shield.transform.localPosition = new V3(sp.x, sp.y, 0);
      const pulse = 1 + 0.08 * Math.sin(Time.time * 9);
      this.shield.transform.localScale = new V3(1.9 * pulse, 1.9 * pulse, 1);
      this.shield.color = Color.white.withAlpha(Mathf.clamp01(this.shieldLife * 2));
    }
    // flags at cash-out points
    for (let i = 0; i < 2; i++) {
      if (!this.flags[i].gameObject.activeSelf || i >= this.seats.length) continue;
      const s = this.seats[i];
      const p = this.CurvePoint(this.cashT[i], s.cashed);
      this.flags[i].transform.localPosition = new V3(p.x + 0.25, p.y + 0.65, 0);
      this.flagLabels[i].rectTransform.place(UIKit.Center, this.UI.WorldToHud(p.add(new V2(0, i === 0 ? -0.75 : 1.75))), new V2(300, 40));
    }
    // multiplier readout
    const txt = crashed && this.State !== Phase.Title ? `${this.crash.toFixed(2)}×` : `${this.m.toFixed(2)}×`;
    for (const t of this.multText) {
      t.text = txt;
      t.color = crashed ? Danger : Color.lerp(White, Color.lerp(Gold, Flame, Mathf.clamp01(tension * 2 - 1)), Mathf.clamp01(tension * 2));
      const s = this.step === Step.Flight ? 1 + 0.04 * Math.sin(Time.time * (6 + 10 * tension)) * (0.3 + tension) : 1;
      t.rectTransform.localScale = new V3(s, s, 1);
    }
  }

  private RefreshPanels() {
    const flight = this.step === Step.Flight, crashed = this.step === Step.Crashed;
    this.roundText.text = this.round === Rounds ? "FINAL ROUND" : `ROUND ${this.round}/${Rounds}`;
    this.roundPips.forEach((p, k) => p.color = k < this.round - 1 ? Gold : k === this.round - 1 ? White : new Color(1, 1, 1, 0.22));
    for (let i = 0; i < 2; i++) {
      const p = this.panels[i];
      p.pop = Math.max(0, p.pop - Time.deltaTime * 3);
      if (i >= this.seats.length) { this.SoloInfo(p); continue; }
      const s = this.seats[i];
      const col = SeatCols[i];
      p.name.text = this.mode === 0 ? "YOU" : this.mode === 1 ? (i === 0 ? "YOU" : BotNames[this.diff]) : `PLAYER ${i + 1}`;
      p.total.text = `TOTAL ${Fmt.n(s.total + (crashed ? 0 : 0))}`;
      p.shieldIcon.gameObject.setActive(this.shieldsEnabled || s.shields > 0 || s.shieldOn);
      p.shieldText.text = s.shieldOn ? "SHIELD ON" : s.shields > 0 ? `SHIELD ×${s.shields}` : "NO SHIELD";
      p.shieldIcon.color = Color.white.withAlpha(s.shieldOn ? 1 : s.shields > 0 ? 0.75 : 0.25);
      let title = "", sub = "", face = col, live = false;
      if (this.step === Step.Ready) { title = s.bot ? "READY" : "GET READY"; sub = `${Stake} PTS × MULTIPLIER`; face = Color.lerp(col, Ink, 0.45); }
      else if (s.cashed > 0) { title = "BANKED!"; sub = `+${s.bank} AT ${s.cashed.toFixed(2)}×`; face = Color.lerp(col, Gold, 0.55); }
      else if (crashed) { title = s.shieldOn ? "SHIELDED" : "CRASHED"; sub = s.shieldOn ? "+50 SAVED" : "+0"; face = s.shieldOn ? Pal.hex(0x6ab8e8) : Color.lerp(Danger, Ink, 0.3); }
      else if (flight) {
        live = true;
        title = s.bot ? "WATCHING…" : "CASH OUT";
        sub = s.bot ? "" : `+${Math.round(Stake * this.m)}`;
        face = s.bot ? Color.lerp(col, Ink, 0.35) : col;
      } else { title = "—"; sub = ""; face = Color.lerp(col, Ink, 0.5); }
      p.title.text = title; p.sub.text = sub;
      p.face.color = face;
      const tension = Mathf.clamp01(Math.log(this.m) / Math.log(6));
      const beat = live && !s.bot ? 0.03 * (0.5 + tension) * Math.max(0, Math.sin(Time.time * (5 + 9 * tension))) : 0;
      const sc = 1 + 0.12 * p.pop + beat;
      p.node.localScale = new V3(sc, sc, 1);
      p.glow.color = col.withAlpha(live && !s.bot ? 0.35 + 0.35 * tension : 0.15);
    }
  }

  private SoloInfo(p: Panel) {
    p.name.text = "BEST TOTAL";
    p.total.text = "";
    p.title.text = Fmt.n(this.Data.get("bestTotal"));
    p.sub.text = "";
    p.shieldIcon.gameObject.setActive(false);
    p.shieldText.text = "";
    p.face.color = Color.lerp(Gold, Ink, 0.35);
    p.glow.color = Gold.withAlpha(0.12);
    p.node.localScale = V3.one;
  }

  // ------------------------------------------------------------------ results

  private *ResultLater(): Generator<{ seconds: number; realtime: boolean } | undefined, void, unknown> {
    const s = this.seats;
    if (this.mode !== 0) {
      const w = s[0].total === s[1].total ? -1 : s[0].total > s[1].total ? 0 : 1;
      const head = w < 0 ? "IT'S A TIE!" : this.mode === 1 ? (w === 0 ? "YOU WIN!" : `${BotNames[this.diff]} WINS`) : `PLAYER ${w + 1} WINS!`;
      this.UI.Announce(head, w === 1 && this.mode === 1 ? Danger : w < 0 ? Gold : SeatCols[w], 1.5);
      if (w === 0 || this.mode === 2) { Sfx.play(Snd.Win, 0.8); Sfx.playClip(this.cheerClip, 0.7); this.fx.confetti(new V2(0, 2), 90, 10, [P1Col, P2Col, Gold, Mint]); }
      else Sfx.play(Snd.Lose, 0.7);
    } else { Sfx.play(Snd.Win, 0.6); this.fx.confetti(new V2(0, 2), 50, 9, [Mint, Gold, P1Col]); }
    yield { seconds: 1.5, realtime: false };
    if (this.State !== Phase.Playing) return;
    this.StopLoops();
    if (this.mode === 0) this.SoloResult();
    else if (this.mode === 1) this.CpuResult();
    else this.DuelResult();
  }

  private SoloResult() {
    const total = this.seats[0].total;
    const best = this.Data.max("bestTotal", total);
    const earned = Math.floor(total / 20);
    this.Coins = this.Coins + earned;
    this.Data.max("bestMult", Math.round(this.bestRoundMult * 100));
    this.Finish(new Result({
      Headline: best ? "NEW RECORD FLIGHT!" : "FLIGHT LOG", HeadlineColor: Gold, Value: Fmt.n(total), CountTo: total, NewBest: best && total > 0, Victory: total >= 500,
      BestLine: `BEST TOTAL ${Fmt.n(this.Data.get("bestTotal"))}   ·   +${earned} COINS`,
      Stats: [["ROUNDS BANKED", `${this.roundsBanked}/${Rounds}`], ["BEST CASH-OUT", this.bestRoundMult > 0 ? `${this.bestRoundMult.toFixed(2)}×` : "—"], ["SHIELD SAVES", String(this.shieldSaves)], ["COINS", Fmt.n(this.Coins)]],
      Primary: "PLAY AGAIN",
      Reward: total > 0 ? () => this.DoubleTotal(total, earned) : null,
      RewardLabel: `DOUBLE YOUR FINAL TOTAL: ${Fmt.n(total * 2)} (AD)`,
    }));
  }

  private DoubleTotal(total: number, earned: number) {
    if (this.doubled) return;
    this.doubled = true;
    this.Coins = this.Coins + earned;
    this.Data.add("doubles", 1);
    this.UI.Toast(`TOTAL DOUBLED: ${Fmt.n(total * 2)} PTS · +${earned} COINS`, 2.8);
    Sfx.play(Snd.Coin, 0.8);
  }

  private CpuResult() {
    const [me, bot] = this.seats, d = this.diff;
    const won = me.total > bot.total, tie = me.total === bot.total;
    const stats: [string, string][] = [["SCORE", `${Fmt.n(me.total)} – ${Fmt.n(bot.total)}`], ["ROUNDS WON", `${me.roundsWon} – ${bot.roundsWon}`], ["BEST CASH-OUT", this.bestRoundMult > 0 ? `${this.bestRoundMult.toFixed(2)}×` : "—"], ["BOT", DiffNames[d]]];
    const base = Math.floor(me.total / 20);
    this.Data.max("bestTotal", me.total);
    if (won) {
      const streak = this.Data.get("streak") + 1;
      this.Data.set("streak", streak);
      this.Data.add("wins", 1);
      const prize = Prizes[d] + base;
      this.Coins = this.Coins + prize;
      this.Finish(new Result({
        Headline: `YOU BEAT ${BotNames[d]}!`, HeadlineColor: Gold, Value: Fmt.n(me.total), CountTo: me.total, Victory: true,
        BestLine: `+${prize} COINS   ·   WIN STREAK ${streak}`, Stats: stats, Primary: "PLAY AGAIN",
        Reward: () => this.DoubleTotal(me.total, prize),
        RewardLabel: `DOUBLE YOUR FINAL TOTAL: +${prize} COINS (AD)`,
      }));
    } else {
      this.Data.set("streak", 0);
      this.Coins = this.Coins + base;
      this.Finish(new Result({
        Headline: tie ? "DEAD HEAT!" : `${BotNames[d]} WINS`, HeadlineColor: Pal.hex(0xffb0c8), Value: `${Fmt.n(me.total)} – ${Fmt.n(bot.total)}`,
        BestLine: base > 0 ? `+${base} COINS · SO CLOSE!` : "BRAVER NEXT TIME?", Stats: stats, Primary: "TRY AGAIN",
        Reward: this.Data.get("freeShield") > 0 ? null : () => { this.Data.set("freeShield", 1); this.UI.Toast("FREE SHIELD READY FOR NEXT MATCH!", 2.5); Sfx.playClip(this.shieldClip, 0.8); },
        RewardLabel: "GET A FREE SHIELD FOR NEXT MATCH (AD)",
      }));
    }
  }

  private DuelResult() {
    const [a, b] = this.seats;
    const w = a.total === b.total ? -1 : a.total > b.total ? 0 : 1;
    this.Data.add("duels", 1);
    this.Coins = this.Coins + 20;
    this.Finish(new Result({
      Headline: w < 0 ? "IT'S A TIE!" : `PLAYER ${w + 1} WINS!`, HeadlineColor: w < 0 ? Gold : SeatCols[w], Victory: true,
      Value: `${Fmt.n(a.total)} – ${Fmt.n(b.total)}`, BestLine: `${Rounds} ROUNDS   ·   +20 COINS`,
      Stats: [["P1 ROUNDS WON", String(a.roundsWon)], ["P2 ROUNDS WON", String(b.roundsWon)], ["BEST CASH-OUT", this.bestRoundMult > 0 ? `${this.bestRoundMult.toFixed(2)}×` : "—"], ["SHIELD SAVES", String(this.shieldSaves)]],
      Primary: "REMATCH",
    }));
  }
}

function Random2(r: number) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r; return new V2(Math.cos(a) * d, Math.sin(a) * d); }
