import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CanvasGroup, CasualFx, CasualLook, Color, Ease, Fmt, Fx, GameInfo,
  GameObject, howTo, Image, Keyboard, Mathf, Mouse, Pal, Phase, Result, Sfx, Snd, SpriteRenderer, SysRandom, Text,
  TextAnchor, Time, TouchScheme, UI, UIKit, UINode, V2, V3,
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
 * Modes: CLASSIC (respawn small with -50%), ELIMINATION (one life), CLEAR THE CITY (solo, % eaten).
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

enum Mode { Classic, Elimination, Solo }
const ModeNames = ["CLASSIC", "ELIMINATION", "CLEAR THE CITY"];

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
    this.mode = Mathf.clamp(this.Data.get("mode"), 0, 2) as Mode;

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
    for (let i = 0; i <= BotCount; i++) this.holes.push(this.NewHole(i));
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
    for (let i = 0; i < 7; i++) {
      const t = UIKit.at(UIKit.label(this.boardBg.rectTransform, "", 24, Color.white, TextAnchor.MiddleLeft), new V2(0.5, 1), new V2(4, -28 - i * 34), new V2(270, 32));
      UIKit.glow(t, Ink.withAlpha(0.7), 2);
      this.boardRows.push(t);
    }

    // minimap
    this.miniMap = UIKit.img(hud, "MiniMap", Art.UiRound, new Color(0.06, 0.06, 0.16, 0.5)).rectTransform;
    this.miniMap.place(new V2(0, 1), new V2(108, -108), new V2(176, 176));
    const inner = UIKit.img(this.miniMap, "City", Art.UiRound, new Color(0.45, 0.5, 0.58, 0.55)).rectTransform;
    inner.stretch(12);
    for (let i = 0; i <= BotCount; i++) {
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
    for (let i = 0; i < 7; i++) {
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
    if (this.skinsButton?.label) this.skinsButton.label.text = "SKINS · " + Fmt.n(this.Coins) + " ◉";
    if (this.skinPreview) this.skinPreview.sprite = holeIcon(this.Skin);
  }

  private CycleMode() {
    this.mode = ((this.mode + 1) % 3) as Mode;
    this.Data.set("mode", this.mode);
    this.RefreshTitleExtras();
    this.UI.Toast(this.mode === Mode.Classic ? "CLASSIC: 2 minutes, 7 holes. Get swallowed and you come back at half size."
      : this.mode === Mode.Elimination ? "ELIMINATION: one life! Be the last hole standing, or the biggest when time runs out."
        : "CLEAR THE CITY: just you. Swallow as much of the city as you can in 2 minutes.", 3.5);
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
  private NewCity(forRound: boolean) {
    this.roundSeed = forRound ? 1 + this.rng.next(1_000_000) : 4242 + this.rng.next(7);
    const plan = planCity(this.defs, this.roundSeed);
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
      o.speed = p.mover === Mover.Walker ? 0.7 + this.rng.nextDouble() * 0.6 : p.kind === Kind.Bus ? 2.6 : 3.1 + this.rng.nextDouble() * 0.8;
      o.visX = o.visY = 0;
      o.bob = this.rng.nextDouble() * 6;
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
    h.root.setActive(true);
    h.rim.sprite = h.player ? rimSprite(this.Skin) : rimSprite(-1);
    h.rim.color = h.player ? Color.white : h.color;
    h.label.text = h.player ? "YOU" : h.name;
    h.label.color = h.player ? Gold : Color.lerp(h.color, Color.white, 0.55);
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
    const names = BotNames.slice();
    for (let i = names.length - 1; i > 0; i--) { const j = this.rng.next(i + 1); [names[i], names[j]] = [names[j], names[i]]; }
    const cols = BotColors.slice();
    for (let i = cols.length - 1; i > 0; i--) { const j = this.rng.next(i + 1); [cols[i], cols[j]] = [cols[j], cols[i]]; }
    for (const h of this.holes) { h.alive = false; h.out = false; h.root.setActive(false); h.holesEaten = 0; h.cityScore = 0; h.outOrder = 0; h.respawnT = 0; }
    const bots = forRound && this.mode === Mode.Solo ? 0 : BotCount;
    if (forRound) {
      this.player.name = "YOU";
      this.player.color = SkinColors[this.Skin];
      // start at the edge of the central plaza, where there's a crowd to snack on
      this.SpawnHole(this.player, 0, blockC(2), blockC(2) - 6.3);
      this.player.invuln = 3;
    }
    for (let i = 1; i <= BotCount; i++) {
      const h = this.holes[i];
      h.name = names[i - 1];
      h.color = cols[(i - 1) % cols.length];
      h.skill = 0.65 + this.rng.nextDouble() * 0.35;
      h.aggro = this.rng.nextDouble();
      if (i > bots) { h.out = true; continue; }
      const a = (i / bots) * Math.PI * 2 + this.rng.nextDouble() * 0.5, r = 24 + this.rng.nextDouble() * 22;
      const x = Mathf.clamp(Math.cos(a) * r, -Half + 4, Half - 4), y = Mathf.clamp(Math.sin(a) * r, -Half + 4, Half - 4);
      this.SpawnHole(h, forRound ? 0 : Need[Math.min(3, this.rng.next(4))], x, y);
    }
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
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
  }

  protected BeginRun() {
    if (this.ShopOpen) this.CloseShop();
    this.NewCity(true);
    this.SetupHoles(true);
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
    this.boardTimer = this.miniTimer = 0;
    this.UI.Announce(this.mode === Mode.Solo ? "CLEAR THE CITY!" : this.mode === Mode.Elimination ? "ONE LIFE. GO!" : "GET HUNGRY!", Violet, 1.4);
    if (this.Data.get("games") === 0) this.UI.Toast("Drag anywhere to steer. Swallow things smaller than your hole to grow!", 5);
    this.Data.add("games", 1);
    Sfx.setIntensity(0.45);
    this.UpdateHud(true);
  }

  protected OnPauseChanged(paused: boolean) { if (paused) this.respawnPanel.setActive(false); }

  private ZoomFor(R: number) { return 8 + R * 6.4; }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
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
          if (h.respawnT <= 0 && (this.mode === Mode.Classic || !real)) {
            const [x, y] = this.SafePoint(0);
            this.SpawnHole(h, Math.floor(h.score * 0.5), x, y);
          }
        }
        continue;
      }
      h.invuln = Math.max(0, h.invuln - dt);
      if (!h.player) this.Think(h, dt);
      this.MoveHole(h, dt);
      this.EatAndBlock(h);
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

  private EatAndBlock(h: Hole) {
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
            if (dx * dx + dy * dy < r * r) this.StartFall(o, h);
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
    if (h.alive) this.AddScore(h, v);
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
    h.score += v;
    const l = levelFor(h.score);
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
    if (big.player || small.player) this.AddFeed(big.player ? `YOU SWALLOWED ${small.name.toUpperCase()}!` : `${big.name.toUpperCase()} SWALLOWED YOU!`, big.player ? Gold : Pal.Danger);
    else this.AddFeed(`${big.name} swallowed ${small.name}`, Color.lerp(big.color, Color.white, 0.4));
    if (this.mode !== Mode.Classic) { small.out = true; small.outOrder = ++this.outCounter; }
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
      if (this.mode !== Mode.Classic) this.UI.Announce("SWALLOWED BY " + big.name.toUpperCase() + "!", Pal.Danger, 1.5);
      if (this.mode === Mode.Classic) {
        small.respawnT = 3;
        this.respawnPanel.setActive(true);
      } else this.deathDelay = 1.6;
    } else small.respawnT = 3 + this.rng.nextDouble() * 3;
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
    this.respawnTitle.text = "SWALLOWED BY " + h.eatenBy.toUpperCase() + "!";
    this.respawnCount.text = "RESPAWNING IN " + Math.max(1, Math.ceil(h.respawnT));
    this.respawnNote.text = "You come back at HALF SIZE (-50%)";
    const offer = !this.fullRespawnUsed && AdService.rewardedAvailable;
    if (this.fullButton.node.activeSelf !== offer) this.fullButton.node.setActive(offer);
    if (h.respawnT <= 0) this.RespawnPlayer(false);
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
    h.rim.color = (h.player ? Color.white : h.color).withAlpha(blink);
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
      row.color = h.player ? Gold : h.outOrder > 0 ? new Color(1, 1, 1, 0.45) : Color.lerp(h.color, Color.white, 0.45);
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
      const s = h.player ? 18 : 8 + h.R * 4;
      d.rectTransform.sizeDelta = new V2(s, s);
      d.color = h.player ? Color.white : h.color;
      if (h.player) d.rectTransform.setAsLastSibling();
    }
  }

  private CityPercent() { return Math.min(100, Math.floor((this.eatenValue / Math.max(1, this.totalValue)) * 100)); }

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
    this.finalTitle.text = this.timeLeft <= 0 ? "TIME'S UP!" : "LAST HOLE STANDING!";
    for (let i = 0; i < this.finalRows.length; i++) {
      const row = this.finalRows[i];
      if (i >= list.length) { row.text = ""; continue; }
      const h = list[i];
      row.text = `${i === 0 ? "♛" : (i + 1) + "."}  ${h.player ? "YOU" : h.name}   <color=#ffffffaa>${Fmt.n(h.score)}</color>`;
      row.color = h.player ? Gold : Color.lerp(h.color, Color.white, 0.4);
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
