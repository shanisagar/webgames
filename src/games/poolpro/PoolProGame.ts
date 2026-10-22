import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, CasualUI, Color, Fmt, Fx, GameInfo, GameObject,
  howTo, Image, Keyboard, LineRenderer, Mathf, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer, TapPointer, Text,
  TextAnchor, Time, TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import {
  BallBand, BallBase, BallColors, BallIcon, BallShade, BallSize, BallSpot, BandTilts, ClothSprite, CoinSprite, CrossSprite,
  CueSprite, CueVSprite, GhostSprite, MoveSprite, RailSprite, RidgeSprite, RoomSprite, SlotIcon, SpinBall, TableShadow,
} from "./PoolArt";
import { BreakBoost, castCue, D, Ev, HeadX, MaxSpeed, PoolEvent, PoolSim, R, Rng, Table, TH, TW } from "./PoolPhysics";
import { AiLevel, Frame, groupOf, GroupName, Open, Outcome, PoolAI, ShotPlan, Solids, Stripes } from "./PoolRules";

/**
 * POOL PRO: top-down 8-ball against CPU hustlers in a ladder of cities. Drag to aim (the guide shows the ghost ball
 * and both deflection lines; it gets shorter against better players), pull the cue back on the power slider (or
 * drag back with the mouse) and pick top, back or side spin on the cue ball. Win the entry pot, build a streak,
 * unlock the next city. PRO AIM shows long guide lines (charges, more with a rewarded ad); after a loss a rewarded ad
 * gives a free rematch with PRO AIM for the whole match.
 */

interface Venue {
  city: string; club: string; rival: string; entry: number; prize: number; race: number;
  felt: Color; roomTop: Color; roomBottom: Color; guide: number; ai: AiLevel;
}

const lvl = (noiseDeg: number, powerNoise: number, candidates: number, position: boolean, samples: number): AiLevel => ({ noiseDeg, powerNoise, candidates, position, samples });

const Venues: Venue[] = [
  { city: "LONDON", club: "The Red Lion", rival: "ARCHIE", entry: 50, prize: 100, race: 1, felt: Pal.hex(0x1f8a4c), roomTop: Pal.hex(0x2a1a14), roomBottom: Pal.hex(0x0d0806), guide: 6.5, ai: lvl(2.6, 0.09, 4, false, 0) },
  { city: "SYDNEY", club: "Harbour Hall", rival: "MIA", entry: 100, prize: 250, race: 1, felt: Pal.hex(0x2160b8), roomTop: Pal.hex(0x14223a), roomBottom: Pal.hex(0x060a14), guide: 5.4, ai: lvl(1.9, 0.07, 5, false, 0) },
  { city: "BERLIN", club: "Kiez Club", rival: "LUKAS", entry: 250, prize: 600, race: 1, felt: Pal.hex(0x1a8a86), roomTop: Pal.hex(0x1a2426), roomBottom: Pal.hex(0x070b0c), guide: 4.5, ai: lvl(1.4, 0.06, 6, true, 0) },
  { city: "TORONTO", club: "Maple Room", rival: "OWEN", entry: 500, prize: 1200, race: 1, felt: Pal.hex(0xa3283a), roomTop: Pal.hex(0x2c1416), roomBottom: Pal.hex(0x0e0607), guide: 3.7, ai: lvl(1.05, 0.05, 6, true, 2) },
  { city: "TOKYO", club: "Neon Cue", rival: "HARUTO", entry: 1000, prize: 2500, race: 2, felt: Pal.hex(0x5b3aa8), roomTop: Pal.hex(0x1c1430), roomBottom: Pal.hex(0x08060f), guide: 3.0, ai: lvl(0.8, 0.04, 7, true, 2) },
  { city: "RIO", club: "Copacabana", rival: "RAFA", entry: 2500, prize: 6000, race: 2, felt: Pal.hex(0x2f8f3a), roomTop: Pal.hex(0x2a2010), roomBottom: Pal.hex(0x0c0904), guide: 2.5, ai: lvl(0.58, 0.035, 8, true, 4) },
  { city: "LAS VEGAS", club: "Royal Strip", rival: "VINCE", entry: 5000, prize: 12000, race: 2, felt: Pal.hex(0x1f4fa8), roomTop: Pal.hex(0x2a1030), roomBottom: Pal.hex(0x0a040c), guide: 2.0, ai: lvl(0.4, 0.025, 8, true, 4) },
  { city: "MONACO", club: "Grand Casino", rival: "ETIENNE", entry: 10000, prize: 25000, race: 2, felt: Pal.hex(0x14684a), roomTop: Pal.hex(0x231c10), roomBottom: Pal.hex(0x0a0805), guide: 1.6, ai: lvl(0.26, 0.02, 9, true, 4) },
];

const StartingCoins = 200;
const StartingAims = 3;
const ProGuide = 9;
const Gold = Pal.hex(0xffc93c), Felt = Pal.hex(0x2fbf6a), Red = Pal.hex(0xff5a5a), Ink = Pal.hex(0x0c0f14);
const Cream = Pal.hex(0xfff3d6);
const TopBand = 260;

enum Step { Aim, Strike, Rolling, Settle, CpuThink, CpuPlace, CpuAim, FrameEnd, Wait }

/** One ball's on-screen parts and its 3D orientation (columns = body axes in table space). */
class BallView {
  root!: GameObject;
  shadow!: SpriteRenderer; base!: SpriteRenderer; band: SpriteRenderer | null = null; shade!: SpriteRenderer;
  spots: { holder: GameObject; sr: SpriteRenderer }[] = [];
  m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  dropT = -1; fromX = 0; fromY = 0; toX = 0; toY = 0;
  pop = 0;
  constructor(readonly n: number) {}
}

interface Card { root: UINode; glow: Image; name: Text; sub: Text; tray: Image[]; avatar: Image; initial: Text; frames: Image[] }

const hashNoise = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };

export class PoolProGame extends ArcadeGame {
  private world!: GameObject; private table!: GameObject;
  private bgCover!: SpriteRenderer; private cloth!: SpriteRenderer; private dimmer!: SpriteRenderer; private lamp!: SpriteRenderer;
  private views: BallView[] = [];
  private cueRoot!: GameObject; private cueSr!: SpriteRenderer; private cueShadow!: SpriteRenderer;
  private aimLine!: LineRenderer; private objLine!: LineRenderer; private tanLine!: LineRenderer; private bounceLine!: LineRenderer;
  private ghost!: SpriteRenderer; private cross!: SpriteRenderer; private move!: SpriteRenderer;
  private fx!: CasualFx; private fxWorld!: CasualFx;
  private pointer = new TapPointer();

  private sim = new PoolSim();
  private frame = new Frame(0);
  private ai!: PoolAI;
  private rng = new Rng(1);
  private step = Step.Wait;
  private timer = 0;
  private tableRot = 0; private tableScale = 1;

  // aiming
  private aim = new V2(1, 0);
  private power = 0;
  private spinX = 0; private spinY = 0;
  private dragMode = 0; // 0 none, 1 aim, 2 slider, 3 wheel, 4 place cue, 5 mouse pull, 6 spin panel
  private dragStart = V2.zero; private wheelAcc = 0;
  private strikeT = 0; private shotSpeed = 0;
  private eightBefore = false;
  private proShot = false; private proMatch = false;

  // cpu
  private plan: ShotPlan | null = null;
  private planGen: Generator<void, ShotPlan, void> | null = null;
  private cpuAimFrom = V2.zero; private cpuPower = 0; private cpuPlace = V2.zero; private cpuPlaceFrom = V2.zero;

  // match
  private venueIdx = 0;
  private score = [0, 0];
  private breaker = 0;
  private frameNo = 0;
  private entryPaid = 0;
  private freeEntry = false;
  private potsThisMatch = 0;
  private foulsThisMatch = 0;
  private shotsThisMatch = 0;
  private soundsThisFrame = 0;
  private attractT = 0;
  private attractShots = 0;

  // HUD
  private cards: Card[] = [];
  private infoText!: Text; private coinText!: Text;
  private slider!: UINode; private sliderFill!: Image; private sliderCue!: Image; private sliderLabel!: Text;
  private spinNode!: UINode; private spinDot!: Image;
  private spinPanel!: UINode; private spinBig!: UINode; private spinBigDot!: Image;
  private wheel!: UINode; private ridges: Image[] = [];
  private proButton!: ArcadeButton;
  private turnText!: Text;
  private venueTitle!: Text; private venueSub!: Text; private venuePrev!: ArcadeButton; private venueNext!: ArcadeButton;
  private sliderLen = 400;
  private portrait = false;

  private clack: AudioClip[] = []; private thud!: AudioClip; private dropClip!: AudioClip; private strikeClip!: AudioClip; private rackClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "poolpro",
      Title: "POOL PRO",
      Tagline: "8-BALL HUSTLE AROUND THE WORLD",
      PlayLabel: "PLAY",
      Accent: Pal.hex(0x35d07f),
      Accent2: Gold,
      BgTop: Pal.hex(0x1c1410),
      BgBottom: Pal.hex(0x070504),
      ShortSide: 10,
      Touch: TouchScheme.None,
      Music: { bpm: 88, rootHz: 110, degrees: [0, 3, 5, 4], seed: 81, energy: 0.22, major: false },
      Reminders: [
        "The tables are open|Pot the 8 and take the pot.",
        "A new hustler is waiting|Win in London to unlock Sydney.",
        "Keep your streak alive|Every win in a row pays a bonus.",
      ],
      HowTo: [
        howTo(Art.Chevron, Pal.hex(0x35d07f), "DRAG on the table to aim. The guide shows the ghost ball and where both balls go."),
        howTo(Art.Square, Gold, "PULL the cue down on the power slider and let go to shoot (mouse: drag back and release)."),
        howTo(Art.Disc, Pal.hex(0xff5a5a), "SPIN: tap the cue ball icon. Top follows, back draws, side bends off cushions."),
        howTo(Art.Diamond, Pal.hex(0x4fa3ff), "Pot all your SOLIDS or STRIPES, then the 8. The first ball you pot after the break sets your group."),
        howTo(Art.Ring, Pal.hex(0xff9d4a), "Fouls (scratch, wrong ball first, no rail) give ball in hand. Potting the 8 early loses!"),
        howTo(Art.Star, Gold, "Win the pot, build a streak and unlock the next city."),
      ],
      Tips: [
        "Hit the cue ball low (back spin) to draw it back after contact.",
        "A centre hit on a straight shot stops the cue ball dead: a stun shot.",
        "With ball in hand, drag the cue ball to a spot with an easy next shot.",
        "Don't pot the 8 until your group is cleared!",
        "Better players give you shorter guide lines. PRO AIM shows the long ones.",
      ],
    });
  }

  protected get ShortSide() { return 10; }
  private get Coins() { return this.Data.get("coins", StartingCoins); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }
  private get Aims() { return this.Data.get("aims", StartingAims); }
  private set Aims(v: number) { this.Data.set("aims", Math.max(0, v)); }
  private get Unlocked() { return Mathf.clamp(this.Data.get("unlocked", 1), 1, Venues.length); }
  private get Venue() { return Venues[this.venueIdx]; }
  protected BestLine() { return `COINS ${Fmt.n(this.Coins)}   ·   STREAK ${this.Data.get("streak")}`; }
  protected StatsLine() { return `${this.Data.get("wins")} WINS   ·   BEST STREAK ${this.Data.get("bestStreak")}   ·   CITIES ${this.Unlocked}/${Venues.length}`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Coins = StartingCoins; this.Aims = StartingAims; }
    this.venueIdx = Mathf.clamp(this.Data.get("venue", 0), 0, this.Unlocked - 1);
    CasualLook.calm(this, 1.25, 0.28);
    this.world = new GameObject("PoolWorld", this.gameObject);
    this.bgCover = CasualLook.cover(this.world, RoomSprite(this.Venue.roomTop, this.Venue.roomBottom), -910);
    this.lamp = Art.spr(this.world, "Lamp", CasualArt_Soft(), Pal.hex(0xffd7a0).withAlpha(0.13), 1, -880, Art.Additive);
    this.table = new GameObject("Table", this.world);
    const t = this.table;
    const shadow = Art.spr(t, "TableShadow", TableShadow(), Color.white, 1, -50, Art.Flat);
    shadow.transform.localScale = new V3(27, 27, 1);
    shadow.transform.localPosition = new V3(0.25, -0.45, 0);
    this.cloth = Art.spr(t, "Cloth", ClothSprite(), this.Venue.felt, 21, 0, Art.Flat);
    Art.spr(t, "Rails", RailSprite(), Color.white, (TW / 2 + 1.3) * 2, 5, Art.Flat);

    this.aimLine = Art.line(t, "Aim", new Color(1, 1, 1, 0.85), 0.05, 15, false, false, Art.Flat);
    this.objLine = Art.line(t, "ObjLine", new Color(1, 1, 1, 0.85), 0.05, 15, false, false, Art.Flat);
    this.tanLine = Art.line(t, "TanLine", new Color(1, 1, 1, 0.5), 0.04, 15, false, false, Art.Flat);
    this.bounceLine = Art.line(t, "Bounce", new Color(1, 1, 1, 0.45), 0.04, 15, false, false, Art.Flat);
    this.ghost = Art.spr(t, "Ghost", GhostSprite(), Color.white, D * 1.04, 24, Art.Flat);
    this.cross = Art.spr(t, "Cross", CrossSprite(), Red, D * 0.7, 25, Art.Flat);
    this.move = Art.spr(t, "Move", MoveSprite(), Color.white, D * 2.3, 26, Art.Flat);

    for (let n = 0; n < 16; n++) this.views.push(this.MakeBall(n));

    this.cueRoot = new GameObject("Cue", t);
    const cueLen = 9.5;
    this.cueShadow = Art.spr(this.cueRoot, "CueShadow", CueSprite(), new Color(0, 0, 0, 0.3), cueLen, 29, Art.Flat);
    this.cueSr = Art.spr(this.cueRoot, "CueStick", CueSprite(), Color.white, cueLen, 30, Art.Flat);
    this.fx = CasualFx.create(t, 40, 160);
    this.fxWorld = CasualFx.create(this.world, 260, 120);

    this.dimmer = Art.spr(this.world, "Dimmer", Art.Square, new Color(0, 0, 0, 0.5), 100, 200, Art.Flat);

    this.BuildHud();
    this.BuildTitleExtras();
    this.BuildSounds();

    this.sim.rack(7);
    this.ResetViews();
    this.Layout();
  }

  private MakeBall(n: number) {
    const v = new BallView(n);
    v.root = new GameObject("Ball" + n, this.table);
    v.shadow = Art.spr(v.root, "Shadow", CasualArt_Soft(), new Color(0, 0, 0, 0.5), D * 1.45, 10, Art.Flat);
    const stripe = n >= 9;
    v.base = Art.spr(v.root, "Base", BallBase(), stripe ? BallColors[0] : BallColors[n], BallSize, 20, Art.Flat);
    if (stripe) v.band = Art.spr(v.root, "Band", BallBand(0), BallColors[n], BallSize, 21, Art.Flat);
    for (let k = 0; k < 2; k++) {
      const holder = new GameObject("SpotHolder", v.root);
      const sr = Art.spr(holder, "Spot", BallSpot(n), Color.white, 1, 22, Art.Flat);
      v.spots.push({ holder, sr });
    }
    v.shade = Art.spr(v.root, "Shade", BallShade(), Color.white, BallSize, 23, Art.Flat);
    return v;
  }

  private BuildSounds() {
    for (let k = 0; k < 3; k++) {
      const f1 = 2400 + k * 380, f2 = 3900 + k * 300;
      this.clack.push(Sfx.make("pool-clack" + k, 0.09, (t) => (Sfx.sinP(f1 * t) * 0.55 + Sfx.sinP(f2 * t) * 0.3 + hashNoise(Math.trunc(t * 44100) + k * 999) * 0.5 * Sfx.env(t, 0, 0.004)) * Sfx.env(t, 0.0004, 0.028) * 0.75));
    }
    this.thud = Sfx.make("pool-thud", 0.16, (t) => (Sfx.sinP(Sfx.glide(t, 210, 120, 0.05)) * 0.8 + hashNoise(Math.trunc(t * 44100) + 5) * 0.3 * Sfx.env(t, 0, 0.01)) * Sfx.env(t, 0.002, 0.07) * 0.6);
    this.dropClip = Sfx.make("pool-drop", 0.45, (t) => {
      let v = Sfx.sinP(Sfx.glide(t, 150, 90, 0.08)) * Sfx.env(t, 0.002, 0.09) * 0.7;
      for (const [d, f] of [[0.06, 1500], [0.12, 1150], [0.19, 1350], [0.27, 950]]) v += Sfx.sinP(f * (t - d)) * Sfx.env(t - d, 0.0005, 0.02) * 0.3;
      v += hashNoise(Math.trunc(t * 44100) + 77) * Sfx.env(t - 0.05, 0.01, 0.25) * 0.08;
      return v * 0.8;
    });
    this.strikeClip = Sfx.make("pool-strike", 0.08, (t) => (Sfx.sinP(950 * t) * 0.5 + Sfx.sinP(1900 * t) * 0.2 + hashNoise(Math.trunc(t * 44100) + 3) * 0.6 * Sfx.env(t, 0, 0.005)) * Sfx.env(t, 0.0004, 0.022) * 0.7);
    this.rackClip = Sfx.make("pool-rack", 0.5, (t) => {
      let v = 0;
      for (let i = 0; i < 9; i++) { const d = i * 0.045 + (i % 3) * 0.008; v += Sfx.sinP((2200 + (i % 4) * 300) * (t - d)) * Sfx.env(t - d, 0.0004, 0.02) * (0.5 - i * 0.03); }
      return v * 0.6;
    });
  }

  // ------------------------------------------------------------------ HUD

  private BuildHud() {
    const hud = this.UI.Hud;
    for (let i = 0; i < 2; i++) this.cards.push(this.MakeCard(hud, i));
    this.infoText = UIKit.at(UIKit.label(hud, "", 30, Cream), new V2(0.5, 1), new V2(0, -60), new V2(560, 44));
    UIKit.glow(this.infoText, Ink, 3);
    this.coinText = UIKit.at(UIKit.label(hud, "", 30, Gold), new V2(0.5, 1), new V2(0, -104), new V2(560, 44));
    UIKit.glow(this.coinText, Ink, 3);
    this.turnText = UIKit.at(UIKit.label(hud, "", 28, Color.white), new V2(0.5, 1), new V2(0, -146), new V2(560, 40));
    UIKit.glow(this.turnText, Ink, 3);

    // power slider (pull the cue down)
    this.slider = UIKit.node("Power", hud).place(UIKit.Center, V2.zero, new V2(120, 600));
    UIKit.img(this.slider, "Track", Art.UiRound, new Color(0, 0, 0, 0.55)).rectTransform.stretch();
    UIKit.img(this.slider, "Edge", Art.UiOutline, new Color(1, 1, 1, 0.25)).rectTransform.stretch();
    this.sliderFill = UIKit.img(this.slider, "Fill", Art.UiRound, Felt.withAlpha(0.75));
    this.sliderCue = UIKit.img(this.slider, "Cue", CueVSprite(), Color.white);
    this.sliderLabel = UIKit.at(UIKit.label(this.slider, "POWER", 24, Cream), new V2(0.5, 1), new V2(0, 26), new V2(160, 34));

    // spin selector
    this.spinNode = UIKit.node("Spin", hud).place(UIKit.Center, V2.zero, new V2(130, 130));
    UIKit.img(this.spinNode, "Ball", SpinBall(), Color.white).rectTransform.stretch();
    this.spinDot = UIKit.img(this.spinNode, "Dot", Art.UiCircle, Pal.hex(0xe0262b));
    this.spinDot.rectTransform.place(UIKit.Center, V2.zero, new V2(30, 30));
    UIKit.at(UIKit.label(this.spinNode, "SPIN", 24, Cream), new V2(0.5, 0), new V2(0, -22), new V2(160, 34));

    this.spinPanel = UIKit.node("SpinPanel", hud).stretch();
    UIKit.img(this.spinPanel, "Dim", null, new Color(0, 0, 0, 0.55)).rectTransform.stretch(-400);
    this.spinBig = UIKit.node("Big", this.spinPanel).place(UIKit.Center, V2.zero, new V2(560, 560));
    UIKit.img(this.spinBig, "Ball", SpinBall(), Color.white).rectTransform.stretch();
    this.spinBigDot = UIKit.img(this.spinBig, "Dot", Art.UiCircle, Pal.hex(0xe0262b));
    this.spinBigDot.rectTransform.place(UIKit.Center, V2.zero, new V2(80, 80));
    UIKit.at(UIKit.label(this.spinPanel, "TAP WHERE THE CUE HITS", 40, Color.white), UIKit.Center, new V2(0, 350), new V2(900, 60));
    UIKit.at(UIKit.label(this.spinPanel, "TOP = FOLLOW   ·   BOTTOM = DRAW   ·   SIDES = ENGLISH", 26, Cream), UIKit.Center, new V2(0, -340), new V2(1000, 44));
    this.spinPanel.setActive(false);

    // fine aim wheel
    this.wheel = UIKit.node("Wheel", hud).place(UIKit.Center, V2.zero, new V2(90, 380));
    UIKit.img(this.wheel, "Track", Art.UiRound, new Color(0, 0, 0, 0.55)).rectTransform.stretch();
    for (let i = 0; i < 12; i++) this.ridges.push(UIKit.img(this.wheel, "Ridge", RidgeSprite(), Color.white));
    UIKit.img(this.wheel, "Edge", Art.UiOutline, new Color(1, 1, 1, 0.25)).rectTransform.stretch();

    this.proButton = UIKit.buttonAt(hud, "PRO AIM", UIKit.Center, V2.zero, new V2(260, 96), false, () => this.OnProAim(), 26);
    this.proButton.setAccent(Gold);
  }

  private MakeCard(hud: UINode, i: number): Card {
    const root = UIKit.node("Card" + i, hud).place(i === 0 ? new V2(0, 1) : new V2(1, 1), new V2(i === 0 ? 255 : -375, -92), new V2(450, 150));
    const glow = UIKit.img(root, "Glow", Art.Glow, Gold.withAlpha(0));
    glow.rectTransform.stretch(-60);
    UIKit.img(root, "Bg", Art.UiRound, new Color(0.06, 0.05, 0.05, 0.82)).rectTransform.stretch();
    UIKit.img(root, "Edge", Art.UiOutline, new Color(1, 1, 1, 0.18)).rectTransform.stretch();
    const avatar = UIKit.img(root, "Avatar", Art.UiCircle, i === 0 ? Pal.hex(0x35d07f) : Pal.hex(0xff7a4a));
    avatar.rectTransform.place(new V2(0, 0.5), new V2(66, 0), new V2(100, 100));
    const initial = UIKit.at(UIKit.label(avatar.rectTransform, i === 0 ? "YOU" : "?", 34, Ink), UIKit.Center, V2.zero, new V2(100, 100));
    const name = UIKit.at(UIKit.label(root, "", 32, Color.white, TextAnchor.MiddleLeft), new V2(0, 1), new V2(290, -32), new V2(320, 44));
    const sub = UIKit.at(UIKit.label(root, "", 22, Cream, TextAnchor.MiddleRight), new V2(1, 1), new V2(-80, -32), new V2(140, 40));
    const tray: Image[] = [];
    for (let k = 0; k < 7; k++) {
      const im = UIKit.img(root, "Tray", SlotIcon(), Color.white);
      im.rectTransform.place(new V2(0, 0), new V2(150 + k * 42, 46), new V2(40, 40));
      tray.push(im);
    }
    const frames: Image[] = [];
    for (let k = 0; k < 3; k++) {
      const im = UIKit.img(root, "Frame", Art.UiCircle, new Color(1, 1, 1, 0.2));
      im.rectTransform.place(new V2(1, 1), new V2(-28 - k * 26, -32), new V2(18, 18));
      frames.push(im);
    }
    return { root, glow, name, sub, tray, avatar, initial, frames };
  }

  private BuildTitleExtras() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    const card = UIKit.node("Venue", ex).place(UIKit.Center, V2.zero, new V2(640, 112));
    UIKit.img(card, "Bg", Art.UiRound, new Color(0.05, 0.04, 0.04, 0.8)).rectTransform.stretch();
    UIKit.img(card, "Edge", Art.UiOutline, Gold.withAlpha(0.5)).rectTransform.stretch();
    this.venueTitle = UIKit.at(UIKit.label(card, "", 36, Color.white), UIKit.Center, new V2(30, 20), new V2(560, 50));
    CasualLook.fit(this.venueTitle, 22);
    this.venueSub = UIKit.at(UIKit.label(card, "", 24, Gold), UIKit.Center, new V2(30, -26), new V2(560, 36));
    CasualLook.fit(this.venueSub, 16);
    this.venuePrev = UIKit.buttonAt(ex, "<", UIKit.Center, new V2(-400, 0), new V2(110, 110), false, () => this.PickVenue(-1), 50);
    this.venueNext = UIKit.buttonAt(ex, ">", UIKit.Center, new V2(400, 0), new V2(110, 110), false, () => this.PickVenue(1), 50);
    this.venuePrev.setAccent(Gold);
    this.venueNext.setAccent(Gold);
    UIKit.img(card, "Coin", CoinSprite(), Color.white).rectTransform.place(new V2(0, 0.5), new V2(40, 0), new V2(50, 50));
    CasualLook.titleCard(this.UI, new Color(0.04, 0.03, 0.02, 0.72), new V2(1040, 1060), -10);
  }

  private PickVenue(d: number) {
    const n = Mathf.clamp(this.venueIdx + d, 0, Venues.length - 1);
    if (n === this.venueIdx) return;
    this.venueIdx = n;
    if (n < this.Unlocked) this.Data.set("venue", n);
    this.ApplyVenueLook();
    this.RefreshTitle();
  }

  private RefreshTitle() {
    if (!this.venueTitle) return;
    const v = this.Venue, locked = this.venueIdx >= this.Unlocked;
    this.venueTitle.text = `${this.venueIdx + 1}. ${v.city}  ·  ${v.club.toUpperCase()}`;
    this.venueSub.text = locked ? `LOCKED: BEAT ${Venues[this.venueIdx - 1].rival} IN ${Venues[this.venueIdx - 1].city}`
      : `ENTRY ${Fmt.n(v.entry)}  ·  WIN ${Fmt.n(v.prize)}  ·  VS ${v.rival}${v.race > 1 ? `  ·  RACE TO ${v.race}` : ""}`;
    this.venueSub.color = locked ? Pal.hex(0xff9a8a) : Gold;
    this.venuePrev.interactable = this.venueIdx > 0;
    this.venueNext.interactable = this.venueIdx < Venues.length - 1;
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private ApplyVenueLook() {
    const v = this.Venue;
    this.cloth.color = v.felt;
    this.bgCover.sprite = CasualArt_hd(RoomSprite(v.roomTop, v.roomBottom));
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); this.layoutFrames = 2; }
  private layoutFrames = 3;

  private Layout() {
    if (!this.table) return;
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    this.dimmer.transform.localScale = new V3(this.ViewSize.x * 1.3 + 2, this.ViewSize.y * 1.3 + 2, 1);
    this.portrait = Screen.height > Screen.width;
    const upu = Math.min(this.ViewSize.x, this.ViewSize.y) / 1080;
    const left = 175, right = this.portrait ? 25 : 200, bottom = this.portrait ? 250 : 30;
    const r = this.PlayRect(this.portrait ? 300 : TopBand, bottom, 0.05);
    for (let i = 0; i < 2; i++) {
      const c = this.cards[i], cw = this.portrait ? 420 : 450;
      c.root.place(i === 0 ? new V2(0, 1) : new V2(1, 1), new V2(i === 0 ? 15 + cw / 2 : -150 - cw / 2, -90), new V2(cw, 146));
      for (let k = 0; k < 7; k++) c.tray[k].rectTransform.place(new V2(0, 0), new V2(146 + k * (this.portrait ? 38 : 42), 44), new V2(38, 38));
    }
    const iy = this.portrait ? -185 : -50;
    this.infoText.rectTransform.anchoredPosition = new V2(0, iy);
    this.coinText.rectTransform.anchoredPosition = new V2(0, iy - 40);
    this.turnText.rectTransform.anchoredPosition = new V2(0, iy - 80);
    const x0 = r.xMin + left * upu, x1 = r.xMax - right * upu;
    const ow = (TW / 2 + 1.3) * 2, oh = (TH / 2 + 1.3) * 2;
    const w = this.portrait ? oh : ow, h = this.portrait ? ow : oh;
    this.tableScale = Math.min((x1 - x0) / w, (r.yMax - r.yMin) / h);
    this.tableRot = this.portrait ? 90 : 0;
    const cx = (x0 + x1) / 2, cy = (r.yMin + r.yMax) / 2;
    this.table.localPosition = new V3(cx, cy, 0);
    this.table.localScale = new V3(this.tableScale, this.tableScale, 1);
    this.table.localEulerZ = this.tableRot;
    this.lamp.transform.localPosition = new V3(cx, cy, 0);
    this.lamp.transform.localScale = V3.one.mul(Math.max(w, h) * this.tableScale * 1.3);

    // widgets around the table (HUD-local coordinates)
    const halfW = (w * this.tableScale) / 2, halfH = (h * this.tableScale) / 2;
    const toHud = (x: number, y: number) => this.UI.WorldToHud(new V2(x, y));
    const tableHudH = (h * this.tableScale) / upu;
    this.sliderLen = Math.min(620, tableHudH * 0.78);
    this.slider.place(UIKit.Center, toHud(cx - halfW - 88 * upu, cy), new V2(110, this.sliderLen));
    this.sliderCue.rectTransform.place(new V2(0.5, 1), new V2(0, -this.sliderLen * 0.5), new V2(30, this.sliderLen * 0.62));
    if (this.portrait) {
      const by = cy - halfH - 120 * upu;
      this.spinNode.place(UIKit.Center, toHud(cx - halfW + 75 * upu, by), new V2(130, 130));
      this.proButton.node.place(UIKit.Center, toHud(cx - 50 * upu, by), new V2(240, 96));
      this.wheel.place(UIKit.Center, toHud(cx + halfW - 150 * upu, by), new V2(290, 90));
    } else {
      const wx = cx + halfW + 100 * upu;
      this.spinNode.place(UIKit.Center, toHud(wx, cy + halfH - 110 * upu), new V2(130, 130));
      this.wheel.place(UIKit.Center, toHud(wx, cy - 20 * upu), new V2(90, Math.min(380, tableHudH * 0.38)));
      this.proButton.node.place(UIKit.Center, toHud(wx, cy - halfH + 70 * upu), new V2(190, 96));
    }
    this.LayoutWheel();
    this.Present(0);
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.venueIdx = Mathf.clamp(this.Data.get("venue", 0), 0, this.Unlocked - 1);
    this.ApplyVenueLook();
    this.sim.rack(Math.floor(Math.random() * 1e9));
    this.sim.events = null;
    this.ResetViews();
    this.attractT = 1.5;
    this.attractShots = 0;
    this.HideGuide();
    this.cueRoot.setActive(false);
    this.move.color = Color.clear;
    this.RefreshTitle();
  }

  protected BeginRun() {
    if (this.venueIdx >= this.Unlocked) this.venueIdx = this.Unlocked - 1;
    // can't afford it: drop to the best venue you can pay for; broke players get a free game in London
    while (this.venueIdx > 0 && this.Coins < this.Venue.entry && !this.freeEntry) this.venueIdx--;
    this.ApplyVenueLook();
    const v = this.Venue;
    this.entryPaid = 0;
    if (this.freeEntry) this.UI.Toast("FREE REMATCH  ·  PRO AIM ON", 2.5);
    else if (this.Coins >= v.entry) { this.entryPaid = v.entry; this.Coins = this.Coins - v.entry; }
    else this.UI.Toast("HOUSE GAME: FREE ENTRY", 2.5);
    this.freeEntry = false;
    this.Data.add("games", 1);
    this.score = [0, 0];
    this.frameNo = 0;
    this.potsThisMatch = this.foulsThisMatch = this.shotsThisMatch = 0;
    this.ai = new PoolAI(v.ai, new Rng((Date.now() & 0xffffff) + this.venueIdx * 7919));
    this.rng = new Rng(Date.now() & 0xfffffff);
    this.pointer.reset();
    this.pointer.topBand = 0.06;
    this.spinPanel.setActive(false);
    this.cards[1].name.text = v.rival;
    this.cards[1].initial.text = v.rival[0];
    this.cards[0].name.text = "YOU";
    this.cards[0].initial.text = "ME";
    Sfx.setIntensity(0.15);
    this.layoutFrames = 2;
    this.StartFrame(0);
    this.UI.Announce(`${v.city}  ·  VS ${v.rival}`, Gold, 1.6);
  }

  protected OnPauseChanged(paused: boolean) { if (paused) { this.dragMode = 0; this.spinPanel.setActive(false); } }

  private StartFrame(breaker: number) {
    this.breaker = breaker;
    this.frameNo++;
    this.sim.rack(this.rng.int(1e9));
    this.sim.events = [];
    this.frame = new Frame(breaker);
    this.ResetViews();
    Sfx.playClip(this.rackClip, 0.6);
    this.spinX = this.spinY = 0;
    this.BeginTurn();
  }

  private BeginTurn() {
    const f = this.frame;
    this.power = 0;
    this.dragMode = 0;
    this.proShot = false;
    this.plan = null;
    this.planGen = null;
    this.eightBefore = f.onEight(f.turn, this.sim);
    if (f.turn === 0) {
      this.step = Step.Aim;
      this.AimAtSuggestion();
      if (f.breakShot) this.UI.Hint(this.Data.get("games") <= 1 ? "BREAK! Drag the cue ball behind the line, then pull the cue down hard." : "YOUR BREAK");
      else if (f.ballInHand) this.UI.Toast("BALL IN HAND: drag the cue ball anywhere", 2.5);
      else if (this.Data.get("games") <= 1 && this.shotsThisMatch < 4) this.UI.Hint("Drag on the table to aim, then pull the cue down on the left.");
      else this.UI.Hint(null);
    } else {
      this.UI.Hint(null);
      this.step = Step.CpuThink;
      this.timer = 0;
      this.cpuAimFrom = this.aim;
      if (f.breakShot) {
        const b = this.ai.planBreak(this.sim);
        this.cpuPlace = new V2(b.x, b.y);
        this.plan = b.plan;
      } else {
        this.cpuPlace = f.ballInHand ? (() => { const p = this.ai.placeCue(this.sim, f, 1); return new V2(p.x, p.y); })() : new V2(this.sim.x[0], this.sim.y[0]);
      }
      this.cpuPlaceFrom = new V2(this.sim.x[0], this.sim.y[0]);
    }
    this.UpdateHud();
  }

  /** Points the aim at the closest legal ball the cue ball can see. */
  private AimAtSuggestion() {
    const s = this.sim, targets = this.frame.targets(0, s);
    let best = -1, bd = 1e9;
    for (const b of targets) {
      const h = castCue(s, s.x[0], s.y[0], s.x[b] - s.x[0], s.y[b] - s.y[0]);
      const d = Math.hypot(s.x[b] - s.x[0], s.y[b] - s.y[0]) + (h.ball === b ? 0 : 50);
      if (d < bd) { bd = d; best = b; }
    }
    if (best >= 0) this.aim = new V2(s.x[best] - s.x[0], s.y[best] - s.y[0]).normalized;
  }

  // ------------------------------------------------------------------ frame loop

  protected TickBackground(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    this.dimmer.color = new Color(0, 0, 0, Mathf.moveTowards(this.dimmer.color.a, this.State === Phase.Title ? 0.3 : 0.25, dt * 2));
    if (this.State === Phase.Title) {
      // attract: the rack breaks by itself every few seconds
      if (this.sim.moving) this.Simulate(dt, true);
      else {
        this.attractT -= dt;
        if (this.attractT <= 0) {
          if (this.attractShots >= 2) { this.sim.rack(Math.floor(Math.random() * 1e9)); this.ResetViews(); this.attractShots = 0; this.attractT = 1.2; }
          else {
            this.attractShots++;
            this.attractT = 2.5;
            if (!this.sim.on[0]) this.sim.place(0, HeadX, 0);
            const ai = new PoolAI(Venues[3].ai, new Rng(Math.floor(Math.random() * 1e6)));
            if (this.attractShots === 1) { const b = ai.planBreak(this.sim); this.sim.place(0, b.x, b.y); this.sim.shoot(b.plan.dx, b.plan.dy, b.plan.speed * 0.9); }
            else { const a = Math.random() * Math.PI * 2; this.sim.shoot(Math.cos(a), Math.sin(a), 14); }
          }
        }
      }
    }
    this.Present(dt);
  }

  protected TickRun(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    this.dimmer.color = new Color(0, 0, 0, Mathf.moveTowards(this.dimmer.color.a, 0, dt * 3));
    this.pointer.update(dt);
    this.soundsThisFrame = 0;
    this.timer += dt;
    switch (this.step) {
      case Step.Aim: this.PlayerAim(dt); break;
      case Step.Strike: this.TickStrike(dt); break;
      case Step.Rolling:
        this.Simulate(dt, false);
        if (!this.sim.moving) { this.step = Step.Settle; this.timer = 0; }
        break;
      case Step.Settle:
        if (this.timer > 0.35) this.Resolve();
        break;
      case Step.CpuThink: this.CpuThink(); break;
      case Step.CpuPlace: this.CpuPlaceTick(); break;
      case Step.CpuAim: this.CpuAimTick(); break;
      case Step.FrameEnd:
        if (this.timer > 2.2) this.StartFrame(1 - this.breaker);
        break;
      case Step.Wait: break;
    }
    this.Present(dt);
  }

  // ------------------------------------------------------------------ player input

  private ScreenToTable(screen: V2) {
    const w = this.ScreenToWorld(screen);
    const lp = this.table.localPosition;
    let x = (w.x - lp.x) / this.tableScale, y = (w.y - lp.y) / this.tableScale;
    if (this.tableRot !== 0) { const t = x; x = y; y = -t; }
    return new V2(x, y);
  }

  private Inside(node: UINode, screen: V2, pad = 0) {
    if (!node.activeInHierarchy) return false;
    const l = node.screenToLocal(screen), s = node.sizeDelta;
    return Math.abs(l.x) <= s.x / 2 + pad && Math.abs(l.y) <= s.y / 2 + pad;
  }

  private PlayerAim(dt: number) {
    const p = this.pointer, f = this.frame, s = this.sim;
    const cue = new V2(s.x[0], s.y[0]);
    // keyboard fine aim
    const rot = (Keyboard.left.isPressed ? 1 : 0) - (Keyboard.right.isPressed ? 1 : 0);
    if (rot !== 0) this.RotateAim(rot * dt * (Keyboard.key("ShiftLeft").isPressed ? 30 : 6));

    if (this.spinPanel.activeSelf) {
      if (p.down || p.held) {
        if (this.Inside(this.spinBig, p.screen, 40)) {
          const l = this.spinBig.screenToLocal(p.screen).div(280);
          const v = V2.clampMagnitude(l, 0.78).div(0.78);
          this.spinX = v.x; this.spinY = v.y;
          this.dragMode = 6;
        } else if (p.down) { this.spinPanel.setActive(false); this.dragMode = 0; }
      }
      if (p.up && this.dragMode === 6) { this.spinPanel.setActive(false); this.dragMode = 0; Sfx.play(Snd.Click, 0.5); }
      this.UpdateSpinWidgets();
      this.ShowGuide();
      return;
    }

    if (p.down) {
      this.dragStart = p.screen;
      const tp = this.ScreenToTable(p.screen);
      if (this.Inside(this.spinNode, p.screen, 20)) { this.spinPanel.setActive(true); Sfx.play(Snd.Click, 0.5); this.dragMode = 0; return; }
      else if (this.Inside(this.slider, p.screen, 30)) this.dragMode = 2;
      else if (this.Inside(this.wheel, p.screen, 25)) { this.dragMode = 3; this.wheelAcc = 0; }
      else if (f.ballInHand && V2.distance(tp, cue) < Math.max(D * 1.4, this.PxToTable(TapPointer.dp(34)))) this.dragMode = 4;
      else if (!p.usingTouch) this.dragMode = 5;
      else this.dragMode = 1;
    }
    if (p.held) {
      switch (this.dragMode) {
        case 1: {
          const tp = this.ScreenToTable(p.screen);
          if (V2.distance(tp, cue) > R * 0.8) this.aim = tp.sub(cue).normalized;
          break;
        }
        case 2: {
          const d = this.dragStart.y - p.screen.y; // pulled down = positive
          const len = this.sliderLen * Screen.height / Math.max(1, this.UI.Hud.rect.height);
          this.power = Mathf.clamp01(d / Math.max(1, len * 0.8));
          break;
        }
        case 3: {
          const d = this.portrait ? p.screen.x - this.dragStart.x : p.screen.y - this.dragStart.y;
          const delta = d - this.wheelAcc;
          this.wheelAcc = d;
          this.RotateAim(-delta / TapPointer.dp(1) * 0.08);
          this.wheelPhase += delta / TapPointer.dp(1);
          this.LayoutWheel();
          break;
        }
        case 4: {
          let tp = this.ScreenToTable(p.screen);
          const lx = TW / 2 - R - 0.02, ly = TH / 2 - R - 0.02;
          tp = new V2(Mathf.clamp(tp.x, -lx, f.kitchen ? HeadX : lx), Mathf.clamp(tp.y, -ly, ly));
          if (s.fits(tp.x, tp.y, 0, f.kitchen)) { s.place(0, tp.x, tp.y); }
          break;
        }
        case 5: {
          // mouse: drag back from where you pressed; the aim stays where it was
          const d = this.dragStart.sub(p.screen);
          this.power = Mathf.clamp01(d.magnitude / TapPointer.dp(220));
          break;
        }
      }
    } else if (!p.usingTouch && this.dragMode === 0) {
      // mouse hover aims
      const tp = this.ScreenToTable(p.screen);
      const inTable = Math.abs(tp.x) < TW / 2 + 2 && Math.abs(tp.y) < TH / 2 + 2;
      if (inTable && V2.distance(tp, cue) > R * 1.2 && !this.Inside(this.slider, p.screen, 30) && !this.Inside(this.wheel, p.screen, 25) && !this.Inside(this.spinNode, p.screen, 20)) this.aim = tp.sub(cue).normalized;
    }
    if (p.up) {
      const mode = this.dragMode;
      this.dragMode = 0;
      if ((mode === 2 || mode === 5) && this.power > 0.03) { this.Shoot(); return; }
      this.power = 0;
    }
    if (Keyboard.space.wasPressedThisFrame && this.power === 0) this.power = 0.0001;
    this.ShowGuide();
  }

  private wheelPhase = 0;

  private PxToTable(px: number) { return (px / Screen.height) * this.ViewSize.y / this.tableScale; }

  private RotateAim(deg: number) {
    const a = Math.atan2(this.aim.y, this.aim.x) + (deg * Math.PI) / 180;
    this.aim = new V2(Math.cos(a), Math.sin(a));
  }

  private LayoutWheel() {
    const n = this.ridges.length;
    const size = this.wheel.sizeDelta;
    const len = this.portrait ? size.x : size.y;
    const gap = len / n;
    for (let i = 0; i < n; i++) {
      const off = Mathf.repeat(i * gap + this.wheelPhase * 0.6, len) - len / 2;
      const k = 1 - Math.abs(off) / (len / 2);
      const im = this.ridges[i];
      if (this.portrait) { im.rectTransform.place(UIKit.Center, new V2(off, 0), new V2(18, size.y * 0.7)); im.rectTransform.localEulerAngles = new V3(0, 0, 0); }
      else im.rectTransform.place(UIKit.Center, new V2(0, off), new V2(size.x * 0.7, 18));
      im.color = new Color(1, 1, 1, Mathf.clamp01(k * 1.4) * 0.9 * this.widgetAlpha);
      if (this.portrait) im.sprite = RidgeVSprite();
      else im.sprite = RidgeSprite();
    }
  }

  private UpdateSpinWidgets() {
    this.spinDot.rectTransform.anchoredPosition = new V2(this.spinX, this.spinY).mul(42);
    this.spinBigDot.rectTransform.anchoredPosition = new V2(this.spinX, this.spinY).mul(280 * 0.78);
  }

  private Shoot() {
    this.UI.Hint(null);
    this.shotSpeed = MaxSpeed * (0.03 + 0.97 * Math.pow(this.power, 1.6)) * (this.frame.breakShot ? BreakBoost : 1);
    this.step = Step.Strike;
    this.strikeT = 0;
    this.HideGuide();
  }

  private TickStrike(dt: number) {
    this.strikeT += dt;
    const k = Mathf.clamp01(this.strikeT / 0.08);
    this.ShowCue(this.aim, this.power * (1 - k) - 0.05 * k, 1);
    if (k < 1) return;
    const top = this.spinY, side = this.spinX;
    this.eightBefore = this.frame.onEight(this.frame.turn, this.sim);
    this.sim.events = [];
    this.sim.shoot(this.aim.x, this.aim.y, this.shotSpeed, top, side);
    Sfx.playClip(this.strikeClip, 0.3 + 0.7 * Mathf.clamp01(this.shotSpeed / MaxSpeed), 0.95 + Math.random() * 0.1);
    Fx.haptic(this.shotSpeed > MaxSpeed * 0.7);
    if (this.frame.breakShot && this.shotSpeed > MaxSpeed * 0.6) { this.Fx.shake(0.12); }
    this.shotsThisMatch++;
    if (this.frame.turn === 0 && this.proShot) this.proShot = false;
    this.step = Step.Rolling;
    this.timer = 0;
    this.cueFade = 1;
    this.power = 0;
  }

  private cueFade = 0;

  // ------------------------------------------------------------------ simulation + events

  private Simulate(dt: number, quiet: boolean) {
    if (!this.sim.events) this.sim.events = [];
    this.sim.advance(dt);
    const evs = this.sim.events;
    for (const e of evs) this.OnEvent(e, quiet);
    evs.length = 0;
  }

  private OnEvent(e: PoolEvent, quiet: boolean) {
    const volK = quiet ? 0.25 : 1;
    if (e.type === Ev.Ball) {
      if (this.soundsThisFrame < 4) {
        this.soundsThisFrame++;
        const v = Mathf.clamp01(e.speed / 22);
        Sfx.playClip(this.clack[Math.floor(Math.random() * 3)], (0.08 + 0.92 * v) * volK, 0.9 + Math.random() * 0.2);
      }
      if (e.speed > 24 && !quiet) {
        this.Fx.shake(Mathf.clamp01((e.speed - 20) / 40) * 0.55);
        this.fx.sparkle(new V2(e.x, e.y), Color.white, 6, 0.4, 0.3);
        Fx.haptic(true);
      }
    } else if (e.type === Ev.Cushion) {
      if (e.speed > 1 && this.soundsThisFrame < 5) { this.soundsThisFrame++; Sfx.playClip(this.thud, Mathf.clamp01(e.speed / 25) * 0.8 * volK, 0.9 + Math.random() * 0.2); }
    } else if (e.type === Ev.Pocket) {
      const v = this.views[e.a];
      const pk = Table.pockets[e.b];
      v.dropT = 0; v.fromX = e.x; v.fromY = e.y;
      v.toX = pk.mx + pk.dx * (pk.side ? 0.5 : 0.62); v.toY = pk.my + pk.dy * (pk.side ? 0.5 : 0.62);
      Sfx.playClip(this.dropClip, (0.45 + 0.5 * Mathf.clamp01(e.speed / 12)) * volK, 0.95 + Math.random() * 0.1);
      if (!quiet) {
        const w = this.TableToWorld(new V2(v.toX, v.toY)), tp = new V2(v.toX, v.toY);
        if (e.a === 0) this.fx.pop(tp, Pal.hex(0xff8a7a), 10, 2.5, 0.18, 0.4);
        else {
          this.fx.pop(tp, Color.lerp(BallColors[e.a], Color.white, 0.3), 14, 3, 0.2, 0.5);
          const mine = this.frame.groups[this.frame.turn];
          const good = e.a !== 8 && (mine === Open || groupOf(e.a) === mine);
          if (good && this.frame.turn === 0) this.UI.Float(w, "NICE!", Gold, 0.8);
        }
        this.UpdateHud();
      }
    }
  }

  private TableToWorld(p: V2) {
    let x = p.x, y = p.y;
    if (this.tableRot !== 0) { const t = x; x = -y; y = t; }
    const lp = this.table.localPosition;
    return new V2(lp.x + x * this.tableScale, lp.y + y * this.tableScale);
  }

  // ------------------------------------------------------------------ rules

  private Resolve() {
    const f = this.frame, s = this.sim;
    const me = f.turn;
    const wasBreak = f.breakShot;
    const o: Outcome = f.judge(s, s.record, this.eightBefore);
    const cueGone = !s.on[0];
    f.apply(o, s);
    if (cueGone && s.on[0]) this.views[0].pop = 1;
    const mine = me === 0;
    if (mine) this.potsThisMatch += s.record.potted.filter((n) => n !== 8 && (f.groups[0] === Open || groupOf(n) === f.groups[0])).length;
    if (o.respot8) { this.views[8].dropT = -1; this.views[8].pop = 1; this.UI.Toast("8 ON THE BREAK: RE-SPOTTED", 2); }
    if (f.over) {
      const won = f.winner === 0;
      this.score[f.winner]++;
      const headline = won ? (o.win ? "YOU POTTED THE 8!" : `${this.Venue.rival}: ${f.reason}`) : (o.win ? `${this.Venue.rival} POTS THE 8` : f.reason);
      this.UI.Announce(headline, won ? Gold : Red, 2);
      if (won) { Sfx.play(Snd.Win, 0.8); this.fxWorld.confetti(this.TableToWorld(V2.zero).add(V2.up.mul(2)), 80, 8, [Gold, Color.white, Felt, Pal.hex(0xff7a4a)]); Fx.haptic(true); }
      else Sfx.play(Snd.Lose, 0.7);
      this.UpdateHud();
      if (this.score[f.winner] >= this.Venue.race) { this.step = Step.Wait; this.EndMatch(won, f.reason); }
      else { this.step = Step.FrameEnd; this.timer = 0; this.UI.Toast(`FRAME ${won ? "WON" : "LOST"}  ·  ${this.score[0]} - ${this.score[1]}`, 2); }
      return;
    }
    if (o.foul) {
      if (mine) this.foulsThisMatch++;
      this.UI.Announce(`FOUL: ${o.foulReason}`, Red, 1.4);
      Sfx.play(Snd.Deny, 0.6);
    } else if (o.assigned !== Open) {
      const g = f.groups[0];
      this.UI.Announce(`YOU ARE ${GroupName[g]}`, g === Solids ? Gold : Pal.hex(0x8fc8ff), 1.4);
    } else if (wasBreak && o.continues && mine) this.UI.Toast("GREAT BREAK! TABLE IS OPEN", 1.6);
    else if (o.continues && mine && o.ownPotted > 1) this.UI.Toast(`${o.ownPotted} BALLS!`, 1.2);
    if (f.turn === 0 && me === 1) this.UI.Toast(f.ballInHand ? "YOUR TURN  ·  BALL IN HAND" : "YOUR TURN", 1.6);
    if (f.onEight(0, s) && f.turn === 0 && !this.eightTold) { this.eightTold = true; this.UI.Toast("ON THE 8! Pot it to win", 2); }
    this.BeginTurn();
  }

  private eightTold = false;

  // ------------------------------------------------------------------ CPU

  private CpuThink() {
    const f = this.frame;
    // place the cue ball first (ball in hand / break)
    if (f.ballInHand && V2.distance(this.cpuPlace, new V2(this.sim.x[0], this.sim.y[0])) > 1e-3) { this.step = Step.CpuPlace; this.timer = 0; return; }
    if (!this.plan) {
      if (!this.planGen) this.planGen = this.ai.plan(this.sim, f, 1);
      const t0 = performance.now();
      while (performance.now() - t0 < 7) {
        const r = this.planGen.next();
        if (r.done) { this.plan = r.value; this.planGen = null; break; }
      }
    }
    if (this.plan && this.timer > 0.55) {
      this.plan = this.ai.noisy(this.plan);
      this.cpuAimFrom = this.aim;
      this.cpuPower = Mathf.clamp01(Math.pow(Mathf.clamp01((this.plan.speed / MaxSpeed - 0.03) / 0.97), 1 / 1.6));
      this.spinX = this.plan.side; this.spinY = this.plan.top;
      this.step = Step.CpuAim;
      this.timer = 0;
    }
    this.ShowCue(this.aim, 0, 1);
  }

  private CpuPlaceTick() {
    const k = Mathf.clamp01(this.timer / 0.6);
    const p = V2.lerp(this.cpuPlaceFrom, this.cpuPlace, 1 - Math.pow(1 - k, 3));
    if (this.sim.fits(p.x, p.y, 0) || k >= 1) this.sim.place(0, p.x, p.y);
    if (k >= 1) { this.sim.place(0, this.cpuPlace.x, this.cpuPlace.y); this.step = Step.CpuThink; this.timer = 0.2; }
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
    if (t > 1.5) {
      this.aim = target;
      this.power = this.cpuPower;
      this.shotSpeed = p.speed;
      this.step = Step.Strike;
      this.strikeT = 0;
      this.HideGuide();
    }
  }

  // ------------------------------------------------------------------ guide + cue

  private ShowGuide(cpu = false) {
    const s = this.sim, f = this.frame;
    const cx = s.x[0], cy = s.y[0];
    if (!s.on[0]) { this.HideGuide(); return; }
    const pro = !cpu && (this.proShot || this.proMatch);
    const len = pro ? ProGuide : this.Venue.guide;
    const hit = castCue(s, cx, cy, this.aim.x, this.aim.y);
    this.aimLine.positionCount = 2;
    this.aimLine.setPosition(0, new V2(cx, cy).add(this.aim.mul(R)));
    this.aimLine.setPosition(1, new V2(hit.gx, hit.gy).sub(this.aim.mul(R)));
    this.ghost.transform.localPosition = new V3(hit.gx, hit.gy, 0);
    let legal = true;
    if (hit.ball >= 0) {
      legal = f.targets(f.turn, s).includes(hit.ball);
      const nx = s.x[hit.ball] - hit.gx, ny = s.y[hit.ball] - hit.gy;
      const nl = Math.hypot(nx, ny) || 1;
      const n = new V2(nx / nl, ny / nl);
      const cut = Math.abs(V2.dot(this.aim, n));
      const ol = this.Clip(new V2(s.x[hit.ball], s.y[hit.ball]), n, Math.max(0.35, len * cut) + R) - R;
      const ob = new V2(s.x[hit.ball], s.y[hit.ball]);
      this.objLine.positionCount = 2;
      this.objLine.setPosition(0, ob.add(n.mul(R)));
      this.objLine.setPosition(1, ob.add(n.mul(R + ol)));
      const tv = this.aim.sub(n.mul(V2.dot(this.aim, n)));
      const tl = tv.magnitude;
      if (tl > 0.02) {
        const td = tv.div(tl);
        this.tanLine.positionCount = 2;
        this.tanLine.setPosition(0, new V2(hit.gx, hit.gy).add(td.mul(R)));
        this.tanLine.setPosition(1, new V2(hit.gx, hit.gy).add(td.mul(Math.max(R, this.Clip(new V2(hit.gx, hit.gy), td, R + Math.max(0.3, len * 0.55 * Math.sqrt(1 - cut * cut)))))));
      } else this.tanLine.positionCount = 0;
      this.bounceLine.positionCount = 0;
    } else {
      this.objLine.positionCount = 0;
      this.tanLine.positionCount = 0;
      if (pro) {
        const rd = new V2(hit.nx !== 0 ? -this.aim.x : this.aim.x, hit.ny !== 0 ? -this.aim.y : this.aim.y);
        const h2 = castCue(s, hit.gx, hit.gy, rd.x, rd.y);
        this.bounceLine.positionCount = 2;
        this.bounceLine.setPosition(0, new V2(hit.gx, hit.gy).add(rd.mul(R)));
        this.bounceLine.setPosition(1, new V2(h2.gx, h2.gy));
      } else this.bounceLine.positionCount = 0;
    }
    const col = legal ? new Color(1, 1, 1, 0.9) : Red.withAlpha(0.95);
    this.ghost.color = col;
    this.aimLine.color = pro ? Gold.withAlpha(0.9) : new Color(1, 1, 1, 0.8);
    this.objLine.color = pro ? Gold.withAlpha(0.9) : new Color(1, 1, 1, 0.85);
    this.cross.color = legal ? Color.clear : Red;
    this.cross.transform.localPosition = new V3(hit.gx, hit.gy, 0);
    const inHand = f.ballInHand && f.turn === 0 && this.step === Step.Aim;
    this.move.color = inHand ? new Color(1, 1, 1, 0.55 + 0.25 * Math.sin(Time.time * 5)) : Color.clear;
    this.move.transform.localPosition = new V3(cx, cy, 0);
    this.ShowCue(this.aim, this.power, 1);
  }

  /** Length along dir from p that stays on the cloth (guide lines never spill over the rails). */
  private Clip(p: V2, dir: V2, len: number) {
    const hx = TW / 2 - R * 0.5, hy = TH / 2 - R * 0.5;
    let t = len;
    if (dir.x > 1e-6) t = Math.min(t, (hx - p.x) / dir.x); else if (dir.x < -1e-6) t = Math.min(t, (-hx - p.x) / dir.x);
    if (dir.y > 1e-6) t = Math.min(t, (hy - p.y) / dir.y); else if (dir.y < -1e-6) t = Math.min(t, (-hy - p.y) / dir.y);
    return Math.max(0, t);
  }

  private HideGuide() {
    this.aimLine.positionCount = 0; this.objLine.positionCount = 0; this.tanLine.positionCount = 0; this.bounceLine.positionCount = 0;
    this.ghost.color = Color.clear; this.cross.color = Color.clear; this.move.color = Color.clear;
  }

  private ShowCue(dir: V2, pull: number, alpha: number) {
    if (!this.sim.on[0]) { this.cueRoot.setActive(false); return; }
    this.cueRoot.setActive(true);
    this.cueRoot.localPosition = new V3(this.sim.x[0], this.sim.y[0], 0);
    this.cueRoot.localEulerZ = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    const len = 9.5, off = R + 0.12 + pull * 2.4;
    this.cueSr.transform.localPosition = new V3(-off - len / 2, 0, 0);
    // shadow falls down-right in screen space
    const sh = this.ScreenOffsetToCue(new V2(0.12, -0.16));
    this.cueShadow.transform.localPosition = new V3(-off - len / 2 + sh.x, sh.y, 0);
    this.cueSr.color = new Color(1, 1, 1, alpha);
    this.cueShadow.color = new Color(0, 0, 0, 0.3 * alpha);
  }

  /** A screen-space offset expressed in the cue's local frame. */
  private ScreenOffsetToCue(o: V2) {
    const a = -((this.cueRoot.localEulerZ + this.tableRot) * Math.PI) / 180;
    return new V2(o.x * Math.cos(a) - o.y * Math.sin(a), o.x * Math.sin(a) + o.y * Math.cos(a));
  }

  // ------------------------------------------------------------------ ball rendering

  private ResetViews() {
    for (const v of this.views) {
      v.dropT = -1; v.pop = 0;
      v.root.setActive(this.sim.on[v.n] === 1);
      // a random orientation so every rack looks different
      // (stripe axes start in the table plane and numbers face up-ish, so the rack reads clearly)
      v.m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      this.Rotate(v.m, 1, 0, 0, (Math.random() - 0.5) * 1.6);
      this.Rotate(v.m, 0, 1, 0, (Math.random() - 0.5) * (v.n >= 9 ? 0.5 : 1.2));
      this.Rotate(v.m, 0, 0, 1, Math.random() * Math.PI * 2);
      if (v.n === 0) { v.m = [1, 0, 0, 0, 1, 0, 0, 0, 1]; this.Rotate(v.m, 1, 0, 0, 0.5); }
    }
    this.cueFade = 0;
  }

  /** m = Rot(axis, angle) · m (column-major 3×3 stored row-major: m[r*3+c]). */
  private Rotate(m: number[], x: number, y: number, z: number, a: number) {
    const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    const r = [
      t * x * x + c, t * x * y - s * z, t * x * z + s * y,
      t * x * y + s * z, t * y * y + c, t * y * z - s * x,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c,
    ];
    const o = m.slice();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] = r[i * 3] * o[j] + r[i * 3 + 1] * o[3 + j] + r[i * 3 + 2] * o[6 + j];
  }

  private Present(dt: number) {
    const s = this.sim;
    const rotRad = (this.tableRot * Math.PI) / 180;
    // world-fixed light: shadow offset and shading counter-rotate with the table
    const sh = new V2(0.07, -0.1);
    const shLocal = new V2(sh.x * Math.cos(-rotRad) - sh.y * Math.sin(-rotRad), sh.x * Math.sin(-rotRad) + sh.y * Math.cos(-rotRad));
    for (const v of this.views) {
      const n = v.n;
      if (v.dropT >= 0) {
        v.dropT += dt;
        const k = Mathf.clamp01(v.dropT / 0.28);
        const x = Mathf.lerp(v.fromX, v.toX, k), y = Mathf.lerp(v.fromY, v.toY, k);
        v.root.localPosition = new V3(x, y, 0);
        const sc = Mathf.lerp(1, 0.72, k);
        v.root.localScale = new V3(sc, sc, 1);
        const a = 1 - Mathf.clamp01((v.dropT - 0.18) / 0.2);
        this.SetBallAlpha(v, a, true);
        if (v.dropT > 0.4) { v.dropT = -1; v.root.setActive(false); }
        continue;
      }
      const on = s.on[n] === 1;
      if (v.root.activeSelf !== on) v.root.setActive(on);
      if (!on) continue;
      v.pop = Mathf.moveTowards(v.pop, 0, dt * 3);
      const ps = 1 + 0.25 * Math.sin(v.pop * Math.PI);
      v.root.localPosition = new V3(s.x[n], s.y[n], 0);
      v.root.localScale = new V3(ps, ps, 1);
      this.SetBallAlpha(v, 1, false);
      // roll: ω = ẑ × r / R, plus side spin about z
      const wx = -s.ry[n] / R, wy = s.rx[n] / R, wz = s.sz[n] / R * 0.5;
      const w = Math.hypot(wx, wy, wz);
      if (w * dt > 1e-5) this.Rotate(v.m, wx / w, wy / w, wz / w, w * dt);
      v.shadow.transform.localPosition = new V3(shLocal.x, shLocal.y, 0);
      v.shade.transform.localEulerZ = -this.tableRot;
      const m = v.m;
      // stripe band: body axis x
      if (v.band) {
        let ax = m[0], ay = m[3], az = m[6];
        if (az < 0) { ax = -ax; ay = -ay; az = -az; }
        const idx = Math.round((Math.asin(Mathf.clamp01(az)) / (Math.PI / 2)) * (BandTilts - 1));
        v.band.sprite = BallBand(idx);
        v.band.transform.localEulerZ = (Math.atan2(ay, ax) * 180) / Math.PI;
      }
      // number spots at ±z body axis, number up = body y
      const theta = 0.5, spotSize = (2 * Math.sin(theta) * R) / 0.96;
      for (let k = 0; k < 2; k++) {
        const sg = k === 0 ? 1 : -1;
        const sx = m[2] * sg, sy = m[5] * sg, sz = m[8] * sg;
        const spot = v.spots[k];
        if (sz <= 0.01) { spot.sr.color = Color.clear; continue; }
        const rho = Math.hypot(sx, sy);
        let phi = 0, t1x = 1, t1y = 0, t1z = 0, t2x = 0, t2y = 1, t2z = 0;
        if (rho > 1e-4) {
          phi = Math.atan2(sy, sx);
          t1x = (sz * sx) / rho; t1y = (sz * sy) / rho; t1z = -rho;
          t2x = -sy / rho; t2y = sx / rho; t2z = 0;
        }
        const ux = m[1] * sg, uy = m[4] * sg, uz = m[7] * sg;
        const th = Math.atan2(-(ux * t1x + uy * t1y + uz * t1z), ux * t2x + uy * t2y + uz * t2z);
        const c = Math.cos(theta) * R;
        spot.holder.localPosition = new V3(sx * c, sy * c, 0);
        spot.holder.localEulerZ = (phi * 180) / Math.PI;
        spot.holder.localScale = new V3(sz, 1, 1);
        spot.sr.transform.localEulerZ = (th * 180) / Math.PI;
        spot.sr.transform.localScale = new V3(spotSize, spotSize, 1);
        spot.sr.color = new Color(1, 1, 1, Mathf.clamp01(sz / 0.18));
      }
    }
    if (this.State === Phase.Playing && (this.step === Step.Rolling || this.step === Step.Settle)) {
      this.cueFade = Mathf.moveTowards(this.cueFade, 0, dt * 5);
      if (this.cueFade > 0) this.ShowCue(this.aim, -0.05, this.cueFade); else this.cueRoot.setActive(false);
    }
    if (this.State === Phase.Playing) {
      const pw = this.power;
      this.sliderFill.rectTransform.place(new V2(0.5, 1), new V2(0, -6 - (this.sliderLen - 12) * pw * 0.5), new V2(84, (this.sliderLen - 12) * pw));
      this.sliderFill.color = Color.lerp(Felt, Red, pw).withAlpha(0.8);
      this.sliderCue.rectTransform.anchoredPosition = new V2(0, -this.sliderLen * 0.36 - pw * this.sliderLen * 0.3);
      this.sliderLabel.text = pw > 0.01 ? `${Math.round(pw * 100)}%` : "POWER";
      const myTurn = this.frame.turn === 0 && this.step === Step.Aim;
      this.SetWidgets(myTurn);
      this.cards[0].glow.color = Gold.withAlpha(this.frame.turn === 0 ? 0.25 + 0.15 * Math.sin(Time.time * 4) : 0);
      this.cards[1].glow.color = Pal.hex(0xff7a4a).withAlpha(this.frame.turn === 1 ? 0.25 + 0.15 * Math.sin(Time.time * 4) : 0);
    } else this.SetWidgets(false, true);
  }

  private widgetsOn = true;
  private widgetAlpha = 1;
  private SetWidgets(on: boolean, hide = false) {
    for (const n of [this.slider, this.spinNode, this.wheel, this.proButton.node]) if (n.activeSelf === hide) n.setActive(!hide);
    const a = on ? 1 : 0.35;
    if (this.widgetsOn !== on) { this.widgetsOn = on; this.widgetAlpha = a; this.LayoutWheel(); }
    this.sliderCue.color = Color.white.withAlpha(a);
    this.spinDot.color = Pal.hex(0xe0262b).withAlpha(a);
  }

  private SetBallAlpha(v: BallView, a: number, dropping: boolean) {
    const base = v.n >= 9 || v.n === 0 ? BallColors[0] : BallColors[v.n];
    v.base.color = Color.lerp(Color.black, base, dropping ? 0.4 + 0.6 * a : 1).withAlpha(dropping ? Math.max(a, 0.001) : 1);
    if (v.band) v.band.color = BallColors[v.n].withAlpha(dropping ? a : 1);
    v.shade.color = new Color(1, 1, 1, dropping ? a : 1);
    v.shadow.color = new Color(0, 0, 0, dropping ? 0 : 0.5);
    if (dropping) for (const sp of v.spots) sp.sr.color = sp.sr.color.withAlpha(Math.min(sp.sr.color.a, a));
    const order = dropping ? 1 : 0;
    if ((v.base.sortingOrder === 20) === (order === 1)) {
      v.base.sortingOrder = dropping ? 2 : 20;
      if (v.band) v.band.sortingOrder = dropping ? 3 : 21;
      for (const sp of v.spots) sp.sr.sortingOrder = dropping ? 3 : 22;
      v.shade.sortingOrder = dropping ? 4 : 23;
    }
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    if (!this.cards.length) return;
    const f = this.frame, s = this.sim, v = this.Venue;
    for (let p = 0; p < 2; p++) {
      const c = this.cards[p], g = f.groups[p];
      c.sub.text = g === Open ? "OPEN" : GroupName[g];
      const balls = g === Solids ? [1, 2, 3, 4, 5, 6, 7] : g === Stripes ? [9, 10, 11, 12, 13, 14, 15] : [];
      const onEight = f.onEight(p, s);
      for (let k = 0; k < 7; k++) {
        const im = c.tray[k];
        if (onEight) { im.sprite = k === 3 ? BallIcon(8) : SlotIcon(); im.color = Color.white; im.rectTransform.localScale = k === 3 ? new V3(1.2, 1.2, 1) : V3.one; continue; }
        im.rectTransform.localScale = V3.one;
        if (balls.length === 0) { im.sprite = SlotIcon(); im.color = Color.white; continue; }
        const n = balls[k];
        im.sprite = BallIcon(n);
        im.color = s.on[n] ? Color.white : new Color(1, 1, 1, 0.18);
      }
      for (let k = 0; k < 3; k++) {
        c.frames[k].gameObject.setActive(v.race > 1 && k < v.race);
        c.frames[k].color = k < this.score[p] ? Gold : new Color(1, 1, 1, 0.2);
      }
    }
    this.infoText.text = `${v.city}  ·  ${v.club.toUpperCase()}`;
    this.coinText.text = `PRIZE ${Fmt.n(this.PrizeNow())}${v.race > 1 ? `   ·   ${this.score[0]} - ${this.score[1]}` : ""}`;
    this.turnText.text = f.turn === 0 ? (f.ballInHand ? "YOUR SHOT  ·  BALL IN HAND" : "YOUR SHOT") : `${v.rival} IS SHOOTING`;
    this.turnText.color = f.turn === 0 ? Felt : Pal.hex(0xffb08a);
    CasualUI.booster(this.proButton, "PRO AIM", this.Aims, this.State === Phase.Playing && !this.proMatch, this.proMatch ? "PRO AIM ON" : this.proShot ? "PRO AIM ON" : null);
    if (this.proShot || this.proMatch) this.proButton.interactable = false;
    this.UpdateSpinWidgets();
  }

  private PrizeNow() {
    const streak = this.Data.get("streak");
    return Math.round(this.Venue.prize * (1 + Math.min(5, streak) * 0.1));
  }

  private OnProAim() {
    if (this.State !== Phase.Playing || this.proShot || this.proMatch) return;
    if (!CasualUI.useOrEarn(() => this.Aims, (v) => (this.Aims = v), this.UI, "+1 PRO AIM")) { this.UpdateHud(); return; }
    this.proShot = true;
    Sfx.play(Snd.PowerUp, 0.6);
    this.UI.Toast("PRO AIM: long guide lines for this shot", 2);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ results

  private EndMatch(won: boolean, reason: string) {
    const v = this.Venue, idx = this.venueIdx;
    this.HideGuide();
    this.cueRoot.setActive(false);
    const wasPro = this.proMatch;
    this.proMatch = false;
    this.Data.add("frames", this.score[0]);
    this.Data.add("pots", this.potsThisMatch);
    const pots = this.potsThisMatch, fouls = this.foulsThisMatch;
    this.startCoroutine(this.ShowResultLater(won, reason, v, idx, pots, fouls, wasPro));
  }

  private *ShowResultLater(won: boolean, reason: string, v: Venue, idx: number, pots: number, fouls: number, wasPro: boolean): Generator<{ seconds: number; realtime: boolean } | undefined, void, unknown> {
    yield { seconds: 1.6, realtime: false };
    if (this.State !== Phase.Playing) return;
    if (won) {
      const prize = this.PrizeNow();
      this.Coins = this.Coins + prize;
      this.Data.add("wins", 1);
      this.Data.add("earned", prize);
      this.Data.add("streak", 1);
      const best = this.Data.max("bestStreak", this.Data.get("streak"));
      const unlockedNew = idx + 1 < Venues.length && this.Unlocked <= idx + 1;
      if (unlockedNew) this.Data.set("unlocked", idx + 2);
      if (idx + 1 < Venues.length && this.Coins >= Venues[idx + 1].entry) { this.venueIdx = idx + 1; this.Data.set("venue", idx + 1); }
      const next = this.venueIdx !== idx ? Venues[this.venueIdx] : null;
      Sfx.play(Snd.NewBest, 0.6);
      this.Finish(new Result({
        Headline: `YOU BEAT ${v.rival}!`,
        HeadlineColor: Gold,
        Value: `+${Fmt.n(prize)}`,
        CountTo: prize,
        NewBest: best && this.Data.get("streak") >= 2,
        BestLine: unlockedNew ? `NEW CITY UNLOCKED: ${Venues[idx + 1].city}` : `COINS ${Fmt.n(this.Coins)}`,
        Stats: [["CITY", v.city], ["WIN STREAK", String(this.Data.get("streak"))], ["BALLS POTTED", String(pots)], ["COINS", Fmt.n(this.Coins)]],
        Primary: next ? `NEXT: ${next.city}` : "PLAY AGAIN",
        Victory: true,
        Reward: () => { this.Coins = this.Coins + prize; this.UI.Toast(`+${Fmt.n(prize)} COINS: PRIZE DOUBLED!`, 2.5); Sfx.play(Snd.Coin, 0.8); },
        RewardLabel: `DOUBLE PRIZE: +${Fmt.n(prize)} (AD)`,
      }));
    } else {
      this.Data.add("losses", 1);
      const streak = this.Data.get("streak");
      this.Data.set("streak", 0);
      const entry = this.entryPaid;
      this.Finish(new Result({
        Headline: `${v.rival} WINS`,
        HeadlineColor: Pal.hex(0xffb0a0),
        Value: entry > 0 ? `-${Fmt.n(entry)}` : "0",
        BestLine: reason + (streak > 1 ? `   ·   STREAK OF ${streak} ENDED` : ""),
        Stats: [["CITY", v.city], ["FRAMES", `${this.score[0]} - ${this.score[1]}`], ["BALLS POTTED", String(pots)], ["FOULS", String(fouls)]],
        Primary: "TRY AGAIN",
        Reward: wasPro ? null : () => this.Rematch(entry),
        RewardLabel: entry > 0 ? "FREE REMATCH + PRO AIM (AD)" : "REMATCH WITH PRO AIM (AD)",
      }));
    }
  }

  /** Rewarded rematch: the entry fee comes back and PRO AIM is on for the whole match. */
  private Rematch(entry: number) {
    if (entry > 0) this.Coins = this.Coins + entry;
    this.freeEntry = true;
    this.proMatch = true;
    this.StartRun();
  }
}

// small local helpers
function CasualArt_Soft() { return CasualArt.Soft; }
function CasualArt_hd(s: ReturnType<typeof RoomSprite>) { return CasualArt.hd(s); }
const RidgeVSprite = () => CasualArt.make("pool-ridge-v", 16, 64, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.5, 3.7), 0.4);
  const c = Color.lerp(Pal.hex(0x9aa0aa), Pal.hex(0xf2f4f8), CasualArt.smooth(-0.5, 0.5, -p.x));
  return c.withAlpha(CasualArt.fill(d, 2 / 16));
});
