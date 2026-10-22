import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, Camera, CasualLook, Color, Ease, Fmt, Fx, GameInfo, GameObject, howTo,
  Image, Keyboard, LineRenderer, Material, Mathf, Mouse, Pal, Phase, Quaternion, Random, Result, Screen, Sfx, Snd, SpriteRenderer,
  SysRandom, Text, TextAnchor, Time, Touchscreen, TouchScheme, UIKit, UINode, V2, V3, overUI,
} from "../../kit";
import * as CandyArt from "./CandyArt";
import { ComboKind, Match3Board, ObjectiveKind, RealmInfo, SpecialType } from "./Match3Board";

/**
 * CANDY NOVA — a vibrant, animation-rich match-3 cosmic candy puzzle.
 * Swap adjacent jewel candies to match 3 or more, forge Striped Laser Candies (4-match), Wrapped Bomb Candies
 * (L/T-match), and rainbow Nova Color Bombs (5-match), combine specials for board-shaking supernova blasts, clear
 * Gold Jelly & Frost Blockers, and conquer infinite levels. Visual style: "sweet candy land" — pastel sky, candy-cane
 * board with dripping icing, glossy lit candies, a sprinkle-covered chocolate Nova bomb, jelly wobbles, swap arcs and
 * sugar-sprinkle bursts (see CandyArt). (Port of CandyNovaGame.cs.)
 */

const N = Match3Board.N;
const CellCount = Match3Board.CellCount;
const TopBand = 285, BottomBand = 205;

const HammerCost = 100;
const NovaWandCost = 150;
const ShuffleCost = 80;
const StartingGems = 250;
const BgSparkleCount = 26;
const SweetCount = 220;

const Pink = Pal.hex(0xff4db8);
const Cyan = Pal.hex(0x4de8ff);
const Gold = Pal.hex(0xffd24d);
const Emerald = Pal.hex(0x2ee88a);
const IceBlue = Pal.hex(0x70f0ff);
const HudCard = new Color(1, 0.98, 0.99, 0.96);
const HintOrange = new Color(1, 0.58, 0.12);

// 6 distinct colour-blind-friendly jewel candy hues (1-indexed: 1..6)
const CandyPalette = [
  Color.clear,
  Pal.hex(0xff3870), // 1: Ruby Heart (Hot Crimson Rose)
  Pal.hex(0x29dcff), // 2: Sapphire Hex (Electric Cyan-Blue)
  Pal.hex(0x28f078), // 3: Emerald Clover (Radiant Mint-Green)
  Pal.hex(0xffc82e), // 4: Amber Sun (Golden Sunburst Yellow)
  Pal.hex(0xb65cff), // 5: Amethyst Cushion (Royal Violet-Purple)
  Pal.hex(0xff7b29), // 6: Tangerine Tri (Vivid Coral-Orange)
];

enum TurnState { Idle, Swapping, SwapBack, Clearing, Falling, Reshuffling, VictoryBonus, EndDelay }

class CellSlotView {
  Root!: GameObject;
  Checker!: SpriteRenderer; JellyBase!: SpriteRenderer; JellyRim!: SpriteRenderer; FrostBlock!: SpriteRenderer; FrostCore!: SpriteRenderer;
  JellyPop = 0; FrostShake = 0;
}

class CandyView {
  Root!: GameObject;
  Shadow!: SpriteRenderer; Aura!: SpriteRenderer; Body!: SpriteRenderer; Facet!: SpriteRenderer; Gloss!: SpriteRenderer;
  StripeOverlay!: SpriteRenderer; WrapperOverlay!: SpriteRenderer;
  Pop = 0; ClearT = 0; ClearDelay = 0; ClearDuration = 0;
  ClearColor = 0;
  ClearSpecial = SpecialType.None;
  FallOffsetY = 0; FallVelocityY = 0; LandSquash = 0;
}

class LaserFx {
  Outer!: LineRenderer; Core!: LineRenderer;
  T = 0; Duration = 0;
  Color = Color.white;
  Active = false;
}

class LightningFx {
  Bolt!: LineRenderer;
  From = V2.zero; To = V2.zero;
  T = 0; Duration = 0;
  Color = Color.white;
  Active = false;
}

class FlyingGoalOrb {
  Glow!: SpriteRenderer; Body!: SpriteRenderer; Core!: SpriteRenderer;
  From = V2.zero; To = V2.zero;
  T = 0; Duration = 0; TrailTimer = 0;
  Color = Color.white;
  ObjectiveIndex = 0;
  Active = false;
}

/** One sugar sprinkle / candy crumb in the celebration particle pool. */
class SweetBit {
  Sr!: SpriteRenderer;
  Pos = V2.zero; Vel = V2.zero;
  Rot = 0; RotSpeed = 0; Life = 0; MaxLife = 0; Size = 0;
  Color = Color.white;
  Active = false;
}

class BgSparkle {
  Tr!: GameObject;
  Sr!: SpriteRenderer;
  BasePos = V2.zero;
  Phase = 0; Speed = 0; BaseScale = 0; Drift = 0;
  Color = Color.white;
}

// Local stand-in for Unity's Pointer.current (the kit has no unified pointer): the primary touch while one is
// active, otherwise the mouse.
interface PressLike { readonly isPressed: boolean; readonly wasPressedThisFrame: boolean; readonly wasReleasedThisFrame: boolean }
interface PointerLike { position: V2; press: PressLike }
const idlePress: PressLike = { isPressed: false, wasPressedThisFrame: false, wasReleasedThisFrame: false };
let lastTouch: PointerLike | null = null;
function currentPointer(): PointerLike | null {
  const t = Touchscreen.primaryTouch;
  if (t) { lastTouch = { position: t.position, press: t.press }; return lastTouch; }
  if (Mouse.present || !lastTouch) { lastTouch = null; return { position: Mouse.position, press: Mouse.leftButton }; }
  return { position: lastTouch.position, press: idlePress };
}

// ------------------------------------------------------------------ procedural shapes

const CandyHeartSprite = () => Art.shape("cn-heart", (p) => {
  const q = new V2(Math.abs(p.x), -p.y + 0.14);
  const lobe = q.sub(new V2(0.34, -0.22)).magnitude - 0.48;
  const tip = (q.x * 0.88 + q.y * 0.72) - 0.56;
  const roundBottom = p.sub(new V2(0, -0.22)).magnitude - 0.72;
  return Art.edge(-Math.min(lobe, Math.max(tip, roundBottom)));
});

const CandyHexSprite = () => Art.shape("cn-hex", (p) => {
  const q = new V2(Math.abs(p.x), Math.abs(p.y));
  const hex = Math.max(q.x * 0.866025 + q.y * 0.5, q.y) - 0.84;
  const rounded = V2.max(q.sub(new V2(0.45, 0.45)), V2.zero).magnitude - 0.42;
  return Art.edge(-Mathf.lerp(hex, rounded, 0.25));
});

const CandyCloverSprite = () => Art.shape("cn-clover", (p) => {
  const r = p.magnitude;
  const a = Math.atan2(p.y, p.x);
  const wave = 0.74 + 0.14 * Math.cos(a * 5);
  return Art.edge(wave - r);
});

const CandySunSprite = () => Art.shape("cn-sun", (p) => {
  const r = p.magnitude;
  const a = Math.atan2(p.y, p.x);
  const wave = 0.82 + 0.055 * Math.cos(a * 8);
  return Art.edge(wave - r);
});

const CandyOctagonSprite = () => Art.shape("cn-oct", (p) => {
  const q = new V2(Math.abs(p.x), Math.abs(p.y));
  const oct = Math.max(Math.max(q.x, q.y), (q.x + q.y) * 0.7071) - 0.85;
  return Art.edge(-oct);
});

const CandyTriSprite = () => Art.shape("cn-tri", (p) => {
  const q = new V2(Math.abs(p.x), p.y + 0.12);
  const side = q.x * 0.866 + q.y * 0.5 - 0.52;
  const baseLine = -q.y - 0.56;
  const circle = p.magnitude - 0.86;
  const d = Math.max(circle, Math.max(side, baseLine));
  return Art.edge(-d);
});

function CandyShape(colorIndex: number) {
  switch (colorIndex) {
    case 1: return CandyHeartSprite();
    case 2: return CandyHexSprite();
    case 3: return CandyCloverSprite();
    case 4: return CandySunSprite();
    case 5: return CandyOctagonSprite();
    default: return CandyTriSprite();
  }
}

const StripesHSprite = () => Art.shape("cn-stripes-h", (p) => {
  const inside = Art.edge(0.78 - p.magnitude);
  const wave = Math.cos(p.y * Math.PI * 5.5);
  return inside * Art.edge(wave * 0.18 - 0.04);
});

const StripesVSprite = () => Art.shape("cn-stripes-v", (p) => {
  const inside = Art.edge(0.78 - p.magnitude);
  const wave = Math.cos(p.x * Math.PI * 5.5);
  return inside * Art.edge(wave * 0.18 - 0.04);
});

const WrappedFrameSprite = () => Art.shape("cn-wrapped", (p) => {
  const sd1 = Math.abs(Art.roundBox(p, 0.88, 0.26)) - 0.055;
  const sd2 = Math.abs(Art.roundBox(p, 0.64, 0.18)) - 0.04;
  return Math.max(Art.edge(-sd1), 0.75 * Art.edge(-sd2));
});

const JellyPadSprite = () => Art.shape("cn-jelly", (p) => {
  const outer = Art.edge(-Art.roundBox(p, 0.94, 0.24));
  const inner = Art.edge(-Art.roundBox(p, 0.76, 0.18));
  return outer * (0.45 + 0.55 * (1 - inner * 0.5));
});

const FrostCrystalSprite = () => Art.shape("cn-frost", (p) => {
  const box = Art.edge(-Art.roundBox(p, 0.92, 0.2));
  const rim = Art.edge(0.08 - Math.abs(Art.roundBox(p, 0.86, 0.18)));
  const diag1 = Art.edge(0.045 - Math.abs(p.x - p.y)) * Art.edge(0.65 - p.magnitude);
  const diag2 = Art.edge(0.045 - Math.abs(p.x + p.y)) * Art.edge(0.65 - p.magnitude);
  const cross = Art.edge(0.045 - Math.min(Math.abs(p.x), Math.abs(p.y))) * Art.edge(0.72 - p.magnitude);
  return box * Mathf.clamp01(0.45 + 0.55 * Math.max(rim, Math.max(cross, Math.max(diag1, diag2))));
});

const HammerIconSprite = () => Art.shape("cn-hammer", (p) => {
  const r = new V2((p.x + p.y) * 0.7071, (p.y - p.x) * 0.7071);
  const stick = -Art.roundBox(new V2(r.x * 2.5, (r.y + 0.25) * 1.15), 0.16, 0.05);
  const head = 0.42 - r.sub(new V2(0, 0.34)).magnitude;
  const swirl = Art.edge(0.05 - Math.abs(r.sub(new V2(0, 0.34)).magnitude - 0.24));
  return Mathf.clamp01(Art.edge(Math.max(stick, head)) - swirl * 0.35);
});

const NovaWandIconSprite = () => Art.shape("cn-wand", (p) => {
  const r = p.magnitude;
  const a = Math.atan2(p.y, p.x);
  const star = Art.edge((0.55 + 0.25 * Math.cos(a * 4)) - r);
  const ring = Art.edge(0.06 - Math.abs(r - 0.82));
  return Math.max(star, ring);
});

const ShuffleIconSprite = () => Art.shape("cn-shuffle", (p) => {
  const r = p.magnitude;
  const ring = Art.edge(0.09 - Math.abs(r - 0.62)) * (Math.abs(p.y) > 0.12 ? 1 : 0);
  const head1 = Art.poly(p, new V2(0.78, 0.15), new V2(0.38, 0.45), new V2(0.45, -0.1));
  const head2 = Art.poly(p, new V2(-0.78, -0.15), new V2(-0.38, -0.45), new V2(-0.45, 0.1));
  return Math.max(ring, Math.max(head1, head2));
});

const CellLocalPos = (x: number, y: number) => new V3(x - (N - 1) * 0.5, y - (N - 1) * 0.5, 0);

export class CandyNovaGame extends ArcadeGame {
  private world!: GameObject; private bgRoot!: GameObject; private boardRoot!: GameObject;
  boardShadow!: SpriteRenderer; boardFrame!: SpriteRenderer; boardRim!: SpriteRenderer;
  private boardOuterGlow!: SpriteRenderer;
  private selectRing!: SpriteRenderer; private cursorRing!: SpriteRenderer; private hintRingA!: SpriteRenderer; private hintRingB!: SpriteRenderer;
  private crispLineMat!: Material;
  private skyBackdrop: SpriteRenderer | null = null;
  icing!: SpriteRenderer;
  private readonly sweets: SweetBit[] = [];
  private sweetCursor = 0;
  private skyFlash = 0; private skyDanger = 0;

  private readonly slots: CellSlotView[] = new Array(CellCount);
  private readonly candies: CandyView[] = new Array(CellCount);
  private readonly laserPool: LaserFx[] = [];
  private readonly lightningPool: LightningFx[] = [];
  private readonly orbPool: FlyingGoalOrb[] = [];
  private readonly bgSparkles: BgSparkle[] = [];

  private swapClip!: AudioClip; private matchClip!: AudioClip; private specialSpawnClip!: AudioClip; private laserClip!: AudioClip; private bombClip!: AudioClip;
  private novaZapClip!: AudioClip; private jellyClip!: AudioClip; private frostClip!: AudioClip; private landClip!: AudioClip;
  private rng = new SysRandom();

  private board!: Match3Board;
  private realm: RealmInfo = Match3Board.RealmForLevel(1);
  private turnState = TurnState.Idle;

  private landscape = false; private revived = false; private hammerMode = false; private novaWandMode = false; private freeSwapCommitted = false; private victoryPending = false;
  private level = 0; private cascadeCombo = 0; private bestComboThisRun = 0; private specialsTriggeredThisRun = 0; private earnedStarsLastCheck = 0;
  private shownScore = 0; private stateTimer = 0; private stateDuration = 0; private idleTimer = 0; private demoTimer = 0;
  private boardCenter = V2.zero; private need = new V2(9.0, 11.8);

  // Selection, drag & keyboard cursor state
  private selX = -1; private selY = -1;
  private draggingFromCell = false;
  private dragStartWorld = V2.zero;
  private swapX1 = -1; private swapY1 = -1; private swapX2 = -1; private swapY2 = -1;
  private hintX1 = -1; private hintY1 = -1; private hintX2 = -1; private hintY2 = -1;
  private cursorX = 3; private cursorY = 3;
  private cursorVisible = false; private cursorLocked = false;
  private navRepeatTimer = 0;

  // HUD widgets
  private gemBadge!: UINode; private movesBadge!: UINode;
  private levelHudText!: Text; private realmHudText!: Text; private gemCountText!: Text; private movesCountText!: Text; private movesLabelText!: Text; private scoreHudText!: Text;
  private scoreMeterFill!: Image;
  private readonly hudStars: Image[] = new Array(3);
  private readonly hudStarPop = [0, 0, 0];
  private readonly objCards: UINode[] = new Array(2);
  private readonly objIcons: Image[] = new Array(2);
  private readonly objTexts: Text[] = new Array(2);
  private readonly objCardPop = [0, 0];
  private hammerButton!: ArcadeButton; private novaButton!: ArcadeButton; private shuffleButton!: ArcadeButton;
  private gemBadgePop = 0; private movesWarnPulse = 0; private bonusMoveTickTimer = 0;

  protected Describe() {
    return new GameInfo({
      Id: "candynova",
      Title: "CANDY NOVA",
      Tagline: "SWAP. MATCH. GO SUPERNOVA.",
      Accent: Pink,
      Accent2: Cyan,
      BgTop: Pal.hex(0x2a0b45),
      BgBottom: Pal.hex(0x0a0418),
      GridSpacing: 1.15,
      ShortSide: 9.2,
      Touch: TouchScheme.None,
      Music: { bpm: 112, rootHz: 110, degrees: [0, 5, 3, 4], seed: 31, energy: 0.55, major: true },
      Reminders: [
        "Supernova candies await|Line up 5 in a row and unleash a cosmic chain reaction!",
        "Sweet cosmic puzzle break|Clear the Gold Jelly and shatter the Frost Crystals!",
        "Your Gems are sparkling|Jump into Candy Nova and conquer the next level.",
      ],
      HowTo: [
        howTo(CandyShape(1), CandyPalette[1], "Swipe or tap two adjacent candies to SWAP and match 3 or more."),
        howTo(StripesHSprite(), Cyan, "Match 4 in a line to forge a STRIPED LASER CANDY (clears full row/col)."),
        howTo(WrappedFrameSprite(), Gold, "Match in an L or T shape to forge a WRAPPED BOMB (3x3 blast)."),
        howTo(Art.Star, Pink, "Match 5 in a line for a NOVA COLOR BOMB — zaps every candy of a colour!"),
        howTo(JellyPadSprite(), Gold, "Match on top of GOLD JELLY or next to FROST ICE to clear level goals."),
        howTo(HammerIconSprite(), Emerald, "Combine any two Special Candies or spend Gems on Boosters below!"),
      ],
      Tips: [
        "Swapping a Nova Color Bomb with a Striped or Wrapped candy turns EVERY candy of that color into a Special!",
        "Make matches near the bottom of the board to trigger long falling cascades.",
        "Match candies right next to Frost Crystals (or blast them with lasers) to shatter the ice.",
        "Leftover moves at the end of a level erupt into bonus points toward 3 Stars!",
      ],
    });
  }

  protected get ShortSide() { return CandyNovaGame.FitShortSide(this.need, TopBand, BottomBand); }

  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }

  private get Gems() { return this.Data.get("gems", StartingGems); }
  private set Gems(v: number) { this.Data.set("gems", Math.max(0, v)); }

  protected BestLine() {
    const lv = this.CurrentLevel;
    const r = Match3Board.RealmForLevel(lv);
    return `LEVEL ${lv}   ·   ${r.Name}`;
  }

  protected StatsLine() {
    const cleared = this.CurrentLevel - 1;
    return cleared > 0
      ? `${this.Data.get("stars")} STARS   ·   ${Fmt.n(this.Gems)} GEMS   ·   BEST SCORE ${Fmt.n(this.Data.get("bestScore"))}`
      : "MATCH 4 FOR LASERS   ·   MATCH 5 FOR SUPERNOVA BOMBS";
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("initGems", 0) === 0) {
      this.Data.set("initGems", 1);
      this.Data.set("gems", StartingGems);
    }

    this.board = new Match3Board();
    this.crispLineMat = new Material("CN CrispLine", false, 1.15, "soft");

    this.world = new GameObject("CandyNovaWorld", this.gameObject);

    this.BuildAmbientBackground();
    this.BuildBoardWorld();
    this.BuildFxPools();
    this.BuildAudio();
    this.BuildHud();
    this.LayoutWorld();
  }

  private BuildAmbientBackground() {
    this.bgRoot = new GameObject("CandyLandAmbient", this.world);

    // Pastel sky covering the shared neon backdrop (follows the camera in AnimateWorld).
    this.skyBackdrop = CandyArt.Spr(this.world, "CandyLandSky", CandyArt.SkyBackdrop(), Color.white, 1, -900);

    // A calmer, brighter post-process for a candy look (C#: bloom threshold 1.1, no chromatic aberration, vignette 0.16).
    CasualLook.calm(this, 1.1, 0.16);

    // Floating soap-bubbles and sugar sprinkles drifting up through the sky.
    const sRng = new SysRandom(101);
    for (let i = 0; i < BgSparkleCount; i++) {
      const bubble = i % 3 === 0;
      const col = bubble ? Color.white : CandyArt.SprinkleColors[i % 6];
      const spr = bubble ? CandyArt.Bubble() : CandyArt.Sprinkle();
      const sr = CandyArt.Spr(this.bgRoot, (bubble ? "Bubble_" : "Sprinkle_") + i, spr, col.withAlpha(0.5), 0.3, -880);
      const sp = new BgSparkle();
      sp.Tr = sr.transform;
      sp.Sr = sr;
      sp.BasePos = new V2(sRng.nextDouble() * 18.0 - 9.0, sRng.nextDouble() * 18.0 - 9.0);
      sp.Phase = sRng.nextDouble() * Math.PI * 2.0;
      sp.Speed = 0.25 + sRng.nextDouble() * 0.45;
      sp.BaseScale = bubble ? 0.35 + sRng.nextDouble() * 0.45 : 0.16 + sRng.nextDouble() * 0.12;
      sp.Drift = 0.25 + sRng.nextDouble() * 0.45;
      sp.Color = col;
      sp.Tr.localPosition = sp.BasePos;
      this.bgSparkles.push(sp);
    }

    // Sugar-sprinkle burst pool (drawn above the candies, below lasers).
    const sweetRoot = new GameObject("SweetBursts", this.world);
    for (let i = 0; i < SweetCount; i++) {
      const sr = CandyArt.Spr(sweetRoot, "Sweet_" + i, i % 4 === 0 ? Art.Disc : CandyArt.Sprinkle(), Color.white, 0.2, 30);
      sr.gameObject.setActive(false);
      const b = new SweetBit();
      b.Sr = sr;
      this.sweets.push(b);
    }
  }

  private BuildBoardWorld() {
    this.boardRoot = new GameObject("Board", this.world);

    const frameSize = (N + 0.16) / 0.9; // the cane band's inner edge sits just outside the cells
    this.boardOuterGlow = CandyArt.Spr(this.boardRoot, "BoardGlow", CandyArt.Soft(), CandyArt.Berry.withAlpha(0.22), frameSize * 1.4, -5);
    this.boardShadow = CandyArt.Spr(this.boardRoot, "BoardShadow", CandyArt.Soft(), CandyArt.Plum.withAlpha(0.32), frameSize * 1.2, -4);
    this.boardShadow.transform.localPosition = new V3(0.12, -0.35, 0);
    this.boardRim = CandyArt.Spr(this.boardRoot, "CandyCaneFrame", CandyArt.CandyCaneFrame(), Color.white, frameSize, -3);
    this.boardFrame = CandyArt.Spr(this.boardRoot, "CreamTray", CandyArt.Tray(), CandyArt.Cream, N + 0.22, -2);
    this.icing = CandyArt.Spr(this.boardRoot, "Icing", CandyArt.Icing(), Color.white, frameSize, 2);
    this.icing.transform.localPosition = new V3(0, frameSize * 0.5 - frameSize * 0.1875 * 0.5 + 0.05, 0);

    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = Match3Board.Index(x, y);
        const localPos = CellLocalPos(x, y);

        // Slot & tile modifier layer (sugar tile, Gold Jelly beneath, Frost Ice above)
        const slot = new CellSlotView();
        slot.Root = new GameObject(`Slot_${x}_${y}`, this.boardRoot);
        slot.Root.localPosition = localPos;

        const alt = ((x + y) & 1) === 0;
        slot.Checker = CandyArt.Spr(slot.Root, "Tile", CandyArt.Tile(), alt ? CandyArt.Cream : CandyArt.Blush, 0.96, 0);
        slot.JellyBase = CandyArt.Spr(slot.Root, "JellyBase", CandyArt.JellySlab(), CandyArt.Honey, 0.98, 1);
        slot.JellyRim = CandyArt.Spr(slot.Root, "JellyRim", CandyArt.SelectFrame(), Color.white.withAlpha(0.8), 0.86, 2);
        slot.FrostBlock = CandyArt.Spr(slot.Root, "IceCube", CandyArt.IceCube(), IceBlue, 0.98, 14);
        slot.FrostCore = CandyArt.Spr(slot.Root, "IceSparkle", CandyArt.Twinkle(), Color.white.withAlpha(0.85), 0.5, 15);
        this.slots[i] = slot;

        // Candy layer
        const cv = new CandyView();
        cv.Root = new GameObject(`Candy_${x}_${y}`, this.boardRoot);
        cv.Root.localPosition = localPos;
        cv.Shadow = CandyArt.Spr(cv.Root, "Shadow", CandyArt.Soft(), CandyArt.Plum.withAlpha(0.3), 0.95, 3);
        cv.Shadow.transform.localPosition = new V3(0.03, -0.1, 0);
        cv.Aura = Art.spr(cv.Root, "Aura", Art.Glow, Color.clear, 1.55, 4, Art.Additive);
        cv.Body = CandyArt.Spr(cv.Root, "Body", CandyArt.CandyBody(1), Color.white, 0.88, 5);
        cv.Facet = CandyArt.Spr(cv.Root, "Shine", CandyArt.CandyShine(1), Color.white, 0.88, 6);
        cv.StripeOverlay = CandyArt.Spr(cv.Root, "Stripes", StripesHSprite(), Color.white, 0.84, 7);
        cv.WrapperOverlay = CandyArt.Spr(cv.Root, "Wrapper", WrappedFrameSprite(), Gold, 0.94, 8);
        cv.Gloss = CandyArt.Spr(cv.Root, "Twinkle", CandyArt.Twinkle(), Color.clear, 0.36, 9);
        cv.Gloss.transform.localPosition = new V3(-0.2, 0.22, 0);
        this.candies[i] = cv;
      }

    this.selectRing = CandyArt.Spr(this.boardRoot, "SelectFrame", CandyArt.SelectFrame(), CandyArt.Berry, 1.06, 18);
    this.cursorRing = CandyArt.Spr(this.boardRoot, "CursorFrame", CandyArt.SelectFrame(), CandyArt.Sky, 1.06, 19);
    this.hintRingA = CandyArt.Spr(this.boardRoot, "HintRingA", Art.Ring, HintOrange, 1.06, 17);
    this.hintRingB = CandyArt.Spr(this.boardRoot, "HintRingB", Art.Ring, HintOrange, 1.06, 17);

    this.selectRing.gameObject.setActive(false);
    this.cursorRing.gameObject.setActive(false);
    this.hintRingA.gameObject.setActive(false);
    this.hintRingB.gameObject.setActive(false);
  }

  private BuildFxPools() {
    for (let i = 0; i < 16; i++) {
      const lf = new LaserFx();
      lf.Outer = Art.line(this.world, "LaserOuter_" + i, Pink, 0.55, 22, false, true, this.crispLineMat);
      lf.Core = Art.line(this.world, "LaserCore_" + i, Color.white, 0.22, 23, false, true, this.crispLineMat);
      lf.Outer.positionCount = 2;
      lf.Core.positionCount = 2;
      lf.Outer.gameObject.setActive(false);
      lf.Core.gameObject.setActive(false);
      this.laserPool.push(lf);
    }

    for (let i = 0; i < 28; i++) {
      const bolt = Art.line(this.world, "Lightning_" + i, Cyan, 0.16, 24, false, true, this.crispLineMat);
      bolt.positionCount = 6;
      bolt.gameObject.setActive(false);
      const lfx = new LightningFx();
      lfx.Bolt = bolt;
      this.lightningPool.push(lfx);
    }

    for (let i = 0; i < 20; i++) {
      const orb = new FlyingGoalOrb();
      orb.Glow = Art.spr(this.world, "GoalOrbGlow_" + i, Art.Glow, Gold, 1.2, 26, Art.Additive);
      orb.Body = Art.spr(this.world, "GoalOrbBody_" + i, CandyArt.CandyBody(1), Pink, 0.5, 27, Art.Flat);
      orb.Core = Art.spr(this.world, "GoalOrbCore_" + i, Art.Star, Color.white, 0.28, 28, Art.Flat);
      orb.Glow.gameObject.setActive(false);
      orb.Body.gameObject.setActive(false);
      orb.Core.gameObject.setActive(false);
      this.orbPool.push(orb);
    }
  }

  private BuildAudio() {
    const noise = new SysRandom(23);
    const Noise = () => noise.nextDouble() * 2 - 1;

    this.swapClip = Sfx.make("cn-swap", 0.11, (t) =>
      Sfx.sinP(Sfx.glide(t, 380, 680, 0.09)) * Sfx.env(t, 0.002, 0.08) * 0.28);

    this.matchClip = Sfx.make("cn-match", 0.28, (t) =>
      (Sfx.sinP(587.33 * t) * 0.65 + Sfx.triP(1174.66 * t) * 0.35) * Sfx.env(t, 0.002, 0.2) * 0.28);

    this.specialSpawnClip = Sfx.make("cn-special-spawn", 0.42, (t) => {
      const f = t < 0.09 ? 523.25 : t < 0.18 ? 659.25 : t < 0.27 ? 783.99 : 1046.5;
      return (Sfx.sinP(f * t) + 0.4 * Sfx.sinP(f * 2 * t)) * Sfx.env(t % 0.09, 0.002, 0.14) * 0.24;
    });

    this.laserClip = Sfx.make("cn-laser", 0.34, (t) =>
      (Sfx.sawP(Sfx.glide(t, 1800, 420, 0.28)) * 0.45 + Sfx.sinP(Sfx.glide(t, 920, 1480, 0.22)) * 0.45)
      * Sfx.env(t, 0.002, 0.26) * 0.25);

    let bombLp = 0;
    this.bombClip = Sfx.make("cn-bomb", 0.48, (t) => {
      bombLp += (Noise() - bombLp) * 0.35;
      return (bombLp * 0.55 + Sfx.sinP(Sfx.glide(t, 190, 48, 0.38)) * 0.6) * Sfx.env(t, 0.002, 0.36) * 0.38;
    });

    this.novaZapClip = Sfx.make("cn-nova", 0.65, (t) => {
      const arpF = 523.25 * Math.pow(2, ((Math.trunc(t * 22) % 6) * 2) / 12);
      return (Sfx.sinP(arpF * t) * 0.6 + Sfx.triP(arpF * 2 * t) * 0.3 + Noise() * 0.15) * Sfx.env(t, 0.005, 0.52) * 0.26;
    });

    this.jellyClip = Sfx.make("cn-jelly", 0.22, (t) =>
      Sfx.sinP(Sfx.glide(t, 640, 1180, 0.18) + Math.sin(t * 95) * 0.25) * Sfx.env(t, 0.003, 0.16) * 0.25);

    this.frostClip = Sfx.make("cn-frost", 0.26, (t) =>
      (Noise() * 0.45 + Sfx.sinP(2450 * t) * 0.4 + Sfx.sinP(3120 * t) * 0.3) * Sfx.env(t, 0.001, 0.18) * 0.26);

    this.landClip = Sfx.make("cn-land", 0.07, (t) =>
      Sfx.sinP(Sfx.glide(t, 260, 140, 0.05)) * Sfx.env(t, 0.001, 0.045) * 0.2);
  }

  private BuildHud() {
    const hud = this.UI.Hud;

    // The shared title text is white/pale; a soft plum card keeps it readable on the light candy sky.
    const titleCentre = this.UI.TitleExtra ? this.UI.TitleExtra.parent : null;
    if (titleCentre) {
      const tc = UIKit.img(titleCentre, "CandyTitleCard", Art.UiRound, new Color(0.3, 0.11, 0.33, 0.78));
      tc.rectTransform.place(UIKit.Center, new V2(0, 30), new V2(1080, 1060));
      tc.rectTransform.setAsFirstSibling();
    }

    // Top-Left: Gems Counter Badge
    this.gemBadge = UIKit.node("GemBadge", hud).place(new V2(0, 1), new V2(150, -72), new V2(230, 76));
    UIKit.img(this.gemBadge, "Bg", Art.UiRound, HudCard).rectTransform.stretch();
    UIKit.img(this.gemBadge, "Edge", Art.UiOutline, CandyArt.Mint).rectTransform.stretch();
    UIKit.img(this.gemBadge, "Icon", Art.Diamond, CandyArt.Mint).rectTransform.place(new V2(0, 0.5), new V2(44, 0), new V2(46, 46));
    this.gemCountText = UIKit.at(UIKit.label(this.gemBadge, "250", 36, CandyArt.Plum, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(148, 0), new V2(140, 56));

    // Top-Left (below Gems): Moves Left Counter Card
    this.movesBadge = UIKit.node("MovesBadge", hud).place(new V2(0, 1), new V2(150, -182), new V2(230, 118));
    UIKit.img(this.movesBadge, "Bg", Art.UiRound, HudCard).rectTransform.stretch();
    UIKit.img(this.movesBadge, "Edge", Art.UiOutline, CandyArt.Sky).rectTransform.stretch();
    this.movesCountText = UIKit.at(UIKit.label(this.movesBadge, "24", 58, CandyArt.Plum), UIKit.Center, new V2(0, 14), new V2(200, 68));
    this.movesLabelText = UIKit.at(UIKit.label(this.movesBadge, "MOVES", 22, CandyArt.Sky), UIKit.Center, new V2(0, -34), new V2(200, 28));

    // Top-Center: Level title + Realm + 3-Star Score Meter + Objective cards
    this.levelHudText = UIKit.at(UIKit.label(hud, "LEVEL 1", 46, Color.white), new V2(0.5, 1), new V2(20, -54), new V2(540, 58));
    UIKit.glow(this.levelHudText, CandyArt.Plum.withAlpha(0.9), 3);

    this.realmHudText = UIKit.at(UIKit.label(hud, "SUGAR NEBULA", 22, CandyArt.PlumSoft), new V2(0.5, 1), new V2(20, -94), new V2(540, 30));

    const [meterRt, fill] = UIKit.meter(hud, new V2(0.5, 1), new V2(20, -136), new V2(440, 32), Pink);
    this.scoreMeterFill = fill;
    const meterBg = meterRt.image;
    if (meterBg) meterBg.color = CandyArt.Plum.withAlpha(0.35);
    UIKit.img(meterRt, "Edge", Art.UiOutline, Color.white.withAlpha(0.9)).rectTransform.stretch();
    this.scoreHudText = UIKit.at(UIKit.label(meterRt, "0", 22, Color.white), UIKit.Center, V2.zero, new V2(420, 30));
    UIKit.glow(this.scoreHudText, CandyArt.Plum.withAlpha(0.8), 2);

    for (let i = 0; i < 3; i++) {
      this.hudStars[i] = UIKit.img(meterRt, "Star_" + i, Art.Star, new Color(1, 1, 1, 0.55));
      this.hudStars[i].rectTransform.place(new V2(0, 0.5), new V2(200 + i * 115, 0), new V2(40, 40));
    }

    // Objective Pill Cards
    for (let i = 0; i < 2; i++) {
      const card = UIKit.node("Objective_" + i, hud).place(new V2(0.5, 1), new V2(20 + (i === 0 ? -125 : 125), -204), new V2(236, 68));
      UIKit.img(card, "Bg", Art.UiRound, HudCard).rectTransform.stretch();
      UIKit.img(card, "Edge", Art.UiOutline, CandyArt.Berry.withAlpha(0.85)).rectTransform.stretch();
      this.objIcons[i] = UIKit.img(card, "Icon", CandyHeartSprite(), CandyPalette[1]);
      this.objIcons[i].rectTransform.place(new V2(0, 0.5), new V2(42, 0), new V2(46, 46));
      this.objTexts[i] = UIKit.at(UIKit.label(card, "0 / 14", 28, CandyArt.Plum, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(148, 0), new V2(150, 50));
      this.objCards[i] = card;
    }

    // Bottom HUD: 3 Booster Buttons (Lollipop Hammer, Nova/Free Swap Wand, Shuffle)
    this.hammerButton = UIKit.buttonAt(hud, `HAMMER · ${HammerCost}`, new V2(0.5, 0), new V2(-330, 108), new V2(300, 108),
      false, () => this.OnHammerBoosterPressed(), 26, HammerIconSprite());
    this.novaButton = UIKit.buttonAt(hud, `NOVA · ${NovaWandCost}`, new V2(0.5, 0), new V2(0, 108), new V2(300, 108),
      false, () => this.OnNovaBoosterPressed(), 26, NovaWandIconSprite());
    this.shuffleButton = UIKit.buttonAt(hud, `SHUFFLE · ${ShuffleCost}`, new V2(0.5, 0), new V2(330, 108), new V2(300, 108),
      false, () => this.OnShuffleBoosterPressed(), 26, ShuffleIconSprite());

    this.hammerButton.setAccent(Pink);
    this.novaButton.setAccent(Gold);
    this.shuffleButton.setAccent(Cyan);
  }

  // ------------------------------------------------------------------ layout & coordinate helpers

  private LayoutWorld() {
    this.landscape = Screen.width > Screen.height;
    if (this.landscape) {
      this.need = new V2(13.6, 9.2);
      this.boardCenter = new V2(0, -0.15);
    } else {
      this.need = new V2(8.9, 11.8);
      this.boardCenter = new V2(0, -0.1);
    }
    this.boardRoot.localPosition = this.boardCenter;
    this.CenterCamera();
  }

  private CenterCamera() {
    const r = this.PlayRect(TopBand, BottomBand, 0);
    this.Fx.CameraTarget = r.center.neg();
  }

  protected OnLayoutChanged() {
    if ((Screen.width > Screen.height) !== this.landscape) this.LayoutWorld();
    else this.CenterCamera();
  }

  private CellWorldPos(x: number, y: number) { return this.boardCenter.add(new V2(x - (N - 1) * 0.5, y - (N - 1) * 0.5)); }

  /** Cell under a world point as [gx, gy], or null (C# bool + out params). */
  private WorldToCell(wp: V2): [number, number] | null {
    const local = wp.sub(this.boardCenter).add(new V2((N - 1) * 0.5, (N - 1) * 0.5));
    const gx = Mathf.roundToInt(local.x);
    const gy = Mathf.roundToInt(local.y);
    if (!Match3Board.InBounds(gx, gy)) return null;
    const center = this.CellWorldPos(gx, gy);
    return Math.abs(wp.x - center.x) <= 0.52 && Math.abs(wp.y - center.y) <= 0.52 ? [gx, gy] : null;
  }

  // ------------------------------------------------------------------ lifecycle & level setup

  protected OnEnterTitle() {
    this.CancelSelectionAndModes();
    this.SetupLevel(Math.max(1, this.CurrentLevel), true);
    this.demoTimer = 0.7;
  }

  protected BeginRun() {
    this.CancelSelectionAndModes();
    this.level = this.CurrentLevel;
    this.SetupLevel(this.level, false);

    this.revived = false;
    this.bestComboThisRun = 1;
    this.specialsTriggeredThisRun = 0;
    this.earnedStarsLastCheck = 0;
    this.shownScore = 0;

    const accent = Pal.hex(this.realm.AccentHex);
    this.UI.Announce(`LEVEL ${this.level} · ${this.realm.Name}`, accent, 1.4);

    if (this.level === 1) this.UI.Hint("Swipe adjacent candies to match 3+! Match 4 for a Laser, or 5 for a Supernova Bomb!");
    else if (this.level === 2) this.UI.Hint("GOLD JELLY: Match candies on top of glowing Gold Jelly pads to clear them!");
    else if (this.level === 3) this.UI.Hint("FROST ICE: Match candies right next to Frost Crystals (or blast them) to shatter the ice!");
    else if (this.level === 4 && this.Data.get("seenBoosters", 0) === 0) {
      this.Data.set("seenBoosters", 1);
      this.UI.Hint("Use Gems on HAMMER, NOVA WAND (upgrade or free swap), or SHUFFLE below!");
    }

    Sfx.setIntensity(0.2);
  }

  private SetupLevel(lv: number, isDemo: boolean) {
    this.board.GenerateLevel(lv, isDemo);
    this.realm = Match3Board.RealmForLevel(lv);
    this.turnState = TurnState.Idle;
    this.stateTimer = 0;
    this.idleTimer = 0;
    this.cascadeCombo = 0;
    this.victoryPending = false;
    this.hintX1 = this.hintY1 = this.hintX2 = this.hintY2 = -1;

    for (let i = 0; i < CellCount; i++) {
      const cv = this.candies[i];
      cv.Pop = 0;
      cv.ClearT = 0;
      cv.ClearDelay = 0;
      cv.FallOffsetY = 0; // start settled: the drop only animates during a cascade, so an offset here stuck
      cv.FallVelocityY = 0;
      cv.LandSquash = 0;
      this.slots[i].JellyPop = 0;
      this.slots[i].FrostShake = 0;
    }

    for (const lf of this.laserPool) {
      lf.Active = false;
      lf.Outer.gameObject.setActive(false);
      lf.Core.gameObject.setActive(false);
    }
    for (const lfx of this.lightningPool) {
      lfx.Active = false;
      lfx.Bolt.gameObject.setActive(false);
    }
    for (const orb of this.orbPool) {
      orb.Active = false;
      orb.Glow.gameObject.setActive(false);
      orb.Body.gameObject.setActive(false);
      orb.Core.gameObject.setActive(false);
    }

    this.ConfigureObjectiveCards();
  }

  private ConfigureObjectiveCards() {
    const board = this.board;
    const count = board.Objectives.length;
    if (count === 1) {
      this.objCards[0].setActive(true);
      this.objCards[1].setActive(false);
      this.objCards[0].anchoredPosition = new V2(20, -204);
    } else {
      this.objCards[0].setActive(count > 0);
      this.objCards[1].setActive(count > 1);
      this.objCards[0].anchoredPosition = new V2(20 - 125, -204);
      this.objCards[1].anchoredPosition = new V2(20 + 125, -204);
    }

    for (let i = 0; i < Math.min(2, count); i++) {
      const obj = board.Objectives[i];
      switch (obj.Kind) {
        case ObjectiveKind.CollectColor:
          this.objIcons[i].sprite = CandyShape(obj.TargetColor);
          this.objIcons[i].color = CandyPalette[obj.TargetColor];
          break;
        case ObjectiveKind.ClearJelly:
          this.objIcons[i].sprite = JellyPadSprite();
          this.objIcons[i].color = Gold;
          break;
        case ObjectiveKind.BreakFrost:
          this.objIcons[i].sprite = FrostCrystalSprite();
          this.objIcons[i].color = IceBlue;
          break;
        default:
          this.objIcons[i].sprite = Art.Star;
          this.objIcons[i].color = Gold;
          break;
      }
    }

    // Position the 3 star markers along the score meter proportional to Star1, Star2, Star3
    const maxS = Math.max(1, board.Star3);
    const w = 428;
    const ratios = [board.Star1 / maxS, board.Star2 / maxS, 1];
    for (let i = 0; i < 3; i++) {
      const xPos = Mathf.clamp(ratios[i] * w, 40, w);
      this.hudStars[i].rectTransform.anchoredPosition = new V2(xPos, 0);
      this.hudStars[i].color = new Color(1, 1, 1, 0.28);
    }
  }

  protected OnPauseChanged(paused: boolean) {
    if (paused) this.draggingFromCell = false;
  }

  private CancelSelectionAndModes() {
    this.selX = this.selY = -1;
    this.draggingFromCell = false;
    this.hammerMode = false;
    this.novaWandMode = false;
    this.cursorLocked = false;
    if (this.selectRing) this.selectRing.gameObject.setActive(false);
  }

  // ------------------------------------------------------------------ main frame loops

  protected TickBackground(dt: number) {
    this.StepBoardStateMachine(dt, true);
    this.AnimateWorld(dt);

    if (this.State !== Phase.Title || this.turnState !== TurnState.Idle) return;
    this.demoTimer -= dt;
    if (this.demoTimer > 0) return;
    this.demoTimer = 0.85;

    const m = this.board.FindBestMove();
    if (m) this.BeginSwap(m[0], m[1], m[2], m[3], false, true);
    else this.SetupLevel(1 + this.rng.next(8), true);
  }

  protected TickRun(dt: number) {
    this.StepBoardStateMachine(dt, false);
    this.AnimateWorld(dt);
    this.UpdateHud(dt);

    if (this.turnState === TurnState.Idle) {
      this.idleTimer += dt;
      if (this.idleTimer >= 4.5 && this.hintX1 < 0) {
        [this.hintX1, this.hintY1, this.hintX2, this.hintY2] = this.board.FindBestMove() ?? [-1, -1, -1, -1];
      }

      this.HandlePointerInput();
      this.HandleKeyboardAndGamepadInput(dt);
    }
  }

  // ------------------------------------------------------------------ input handling

  private HandlePointerInput() {
    const ptr = currentPointer();
    if (!ptr) return;
    const board = this.board;
    const sp = ptr.position;
    const wp = this.ScreenToWorld(sp);

    if (ptr.press.wasPressedThisFrame && !overUI(sp)) {
      this.cursorVisible = false;
      this.cursorLocked = false;
      const cell = this.WorldToCell(wp);
      if (!cell) {
        this.selX = this.selY = -1;
        this.draggingFromCell = false;
        return;
      }
      const [gx, gy] = cell;

      // 1. Lollipop Hammer mode: smash tapped candy, jelly, or frost!
      if (this.hammerMode) {
        const idx = Match3Board.Index(gx, gy);
        if (!board.Hole[idx] && (board.Frost[idx] > 0 || board.Color[idx] > 0)) this.ExecuteHammerOnCell(gx, gy);
        else Sfx.play(Snd.Deny, 0.45);
        return;
      }

      if (!board.IsPlayableCandy(gx, gy)) {
        const idx = Match3Board.Index(gx, gy);
        if (!board.Hole[idx] && board.Frost[idx] > 0) {
          this.slots[idx].FrostShake = 1;
          Sfx.play(Snd.Tick, 0.45, 0.85);
        }
        this.selX = this.selY = -1;
        this.draggingFromCell = false;
        return;
      }

      // 2. Check if tapping an orthogonally adjacent cell to an existing selection (Tap-Tap swap)
      if (this.selX >= 0 && Math.abs(gx - this.selX) + Math.abs(gy - this.selY) === 1) {
        this.BeginSwap(this.selX, this.selY, gx, gy, this.novaWandMode, false);
        return;
      }

      // 3. Otherwise select this cell and begin tracking drag/swipe
      this.selX = gx;
      this.selY = gy;
      this.draggingFromCell = true;
      this.dragStartWorld = wp;
      this.candies[Match3Board.Index(gx, gy)].Pop = 0.85;
      Sfx.play(Snd.Click, 0.45, 1.15);
      Fx.haptic();
      return;
    }

    if (this.draggingFromCell && ptr.press.isPressed) {
      const delta = wp.sub(this.dragStartWorld);
      if (delta.magnitude >= 0.36) {
        let dx = 0, dy = 0;
        if (Math.abs(delta.x) > Math.abs(delta.y)) dx = delta.x > 0 ? 1 : -1;
        else dy = delta.y > 0 ? 1 : -1;

        const tx = this.selX + dx, ty = this.selY + dy;
        this.draggingFromCell = false;
        if (board.IsPlayableCandy(tx, ty)) {
          this.BeginSwap(this.selX, this.selY, tx, ty, this.novaWandMode, false);
        } else {
          const ti = Match3Board.InBounds(tx, ty) ? Match3Board.Index(tx, ty) : -1;
          if (ti >= 0 && board.Frost[ti] > 0) this.slots[ti].FrostShake = 1;
          Sfx.play(Snd.Deny, 0.45);
        }
      }
      return;
    }

    if (this.draggingFromCell && ptr.press.wasReleasedThisFrame) {
      this.draggingFromCell = false;
      // In Nova Wand mode, tapping a single candy without dragging upgrades it into a Nova Color Bomb!
      if (this.novaWandMode && this.selX >= 0 && board.IsPlayableCandy(this.selX, this.selY)) this.ExecuteNovaUpgradeOnCell(this.selX, this.selY);
    }
  }

  private HandleKeyboardAndGamepadInput(dt: number) {
    const board = this.board;
    this.navRepeatTimer -= dt;
    const move = this.Controls.move;
    const kb = Keyboard;

    let dx = 0, dy = 0;
    if (kb.left.wasPressedThisFrame || kb.letter("a").wasPressedThisFrame) dx = -1;
    else if (kb.right.wasPressedThisFrame || kb.letter("d").wasPressedThisFrame) dx = 1;
    else if (kb.up.wasPressedThisFrame || kb.letter("w").wasPressedThisFrame) dy = 1;
    else if (kb.down.wasPressedThisFrame || kb.letter("s").wasPressedThisFrame) dy = -1;
    if (dx === 0 && dy === 0 && this.navRepeatTimer <= 0 && move.sqrMagnitude > 0.35) {
      if (Math.abs(move.x) > Math.abs(move.y)) dx = move.x > 0 ? 1 : -1;
      else dy = move.y > 0 ? 1 : -1;
      this.navRepeatTimer = 0.18;
    }

    if (dx !== 0 || dy !== 0) {
      this.cursorVisible = true;
      this.idleTimer = 0;
      if (this.cursorLocked && board.IsPlayableCandy(this.cursorX, this.cursorY)) {
        const tx = this.cursorX + dx, ty = this.cursorY + dy;
        this.cursorLocked = false;
        if (board.IsPlayableCandy(tx, ty)) {
          this.BeginSwap(this.cursorX, this.cursorY, tx, ty, this.novaWandMode, false);
          return;
        }
        Sfx.play(Snd.Deny, 0.45);
      } else {
        this.cursorX = Mathf.clamp(this.cursorX + dx, 0, N - 1);
        this.cursorY = Mathf.clamp(this.cursorY + dy, 0, N - 1);
        Sfx.play(Snd.Tick, 0.35, 1.1);
      }
    }

    if (this.Controls.actionPressed) {
      this.cursorVisible = true;
      this.idleTimer = 0;
      if (this.hammerMode) {
        this.ExecuteHammerOnCell(this.cursorX, this.cursorY);
      } else if (this.novaWandMode && this.cursorLocked) {
        this.ExecuteNovaUpgradeOnCell(this.cursorX, this.cursorY);
      } else if (board.IsPlayableCandy(this.cursorX, this.cursorY)) {
        this.cursorLocked = !this.cursorLocked;
        this.selX = this.cursorLocked ? this.cursorX : -1;
        this.selY = this.cursorLocked ? this.cursorY : -1;
        this.candies[Match3Board.Index(this.cursorX, this.cursorY)].Pop = 0.8;
        Sfx.play(Snd.Click, 0.5, this.cursorLocked ? 1.2 : 0.9);
      } else {
        Sfx.play(Snd.Deny, 0.45);
      }
    }
  }

  // ------------------------------------------------------------------ turn state machine & resolution

  private BeginSwap(x1: number, y1: number, x2: number, y2: number, isFreeSwap: boolean, isDemo: boolean) {
    this.idleTimer = 0;
    this.hintX1 = this.hintY1 = this.hintX2 = this.hintY2 = -1;
    this.selX = this.selY = -1;
    this.cursorLocked = false;
    this.draggingFromCell = false;

    this.swapX1 = x1;
    this.swapY1 = y1;
    this.swapX2 = x2;
    this.swapY2 = y2;
    this.freeSwapCommitted = isFreeSwap && this.Gems >= NovaWandCost;

    this.turnState = TurnState.Swapping;
    this.stateTimer = 0;
    this.stateDuration = 0.17;

    if (!isDemo) {
      this.UI.Hint(null);
      Sfx.playClip(this.swapClip, 0.75, Random.range(0.96, 1.06));
      Fx.haptic();
    }
  }

  private StepBoardStateMachine(dt: number, isAttractDemo: boolean) {
    const board = this.board;
    switch (this.turnState) {
      case TurnState.Swapping: {
        this.stateTimer += dt;
        if (this.stateTimer < this.stateDuration) return;

        const valid = this.freeSwapCommitted || board.IsValidSwap(this.swapX1, this.swapY1, this.swapX2, this.swapY2);
        if (!valid) {
          if (!isAttractDemo) {
            Sfx.play(Snd.Deny, 0.55);
            Fx.haptic();
          }
          this.turnState = TurnState.SwapBack;
          this.stateTimer = 0;
          this.stateDuration = 0.16;
          return;
        }

        board.SwapCells(this.swapX1, this.swapY1, this.swapX2, this.swapY2);
        if (this.freeSwapCommitted) {
          this.Gems -= NovaWandCost;
          this.gemBadgePop = 0.8;
          this.novaWandMode = false;
          this.freeSwapCommitted = false;
        } else if (!isAttractDemo) {
          board.MovesLeft = Math.max(0, board.MovesLeft - 1);
        }

        this.cascadeCombo = 0;
        if (!this.TriggerResolveStep(true, isAttractDemo)) {
          // A Free Swap that didn't immediately form a match completes cleanly
          this.CheckPostTurnState(isAttractDemo);
        }
        break;
      }

      case TurnState.SwapBack: {
        this.stateTimer += dt;
        if (this.stateTimer >= this.stateDuration) this.turnState = TurnState.Idle;
        break;
      }

      case TurnState.Clearing: {
        this.stateTimer += dt;
        if (this.stateTimer >= this.stateDuration) this.BeginGravityFall(isAttractDemo);
        break;
      }

      case TurnState.Falling: {
        let anyStillFalling = false;
        for (let i = 0; i < CellCount; i++) {
          const cv = this.candies[i];
          if (cv.FallOffsetY > 0.001) {
            cv.FallVelocityY += 28 * dt;
            cv.FallOffsetY -= cv.FallVelocityY * dt;
            if (cv.FallOffsetY <= 0) {
              cv.FallOffsetY = 0;
              cv.FallVelocityY = 0;
              cv.LandSquash = 1;
            } else {
              anyStillFalling = true;
            }
          }
        }

        this.stateTimer += dt;
        if (!anyStillFalling && this.stateTimer >= 0.08) {
          if (!isAttractDemo) Sfx.playClip(this.landClip, 0.45, Random.range(0.95, 1.08));

          this.cascadeCombo++;
          if (!this.TriggerResolveStep(false, isAttractDemo)) this.CheckPostTurnState(isAttractDemo);
        }
        break;
      }

      case TurnState.Reshuffling: {
        this.stateTimer += dt;
        if (this.stateTimer >= this.stateDuration) {
          board.Reshuffle(this.rng);
          for (let i = 0; i < CellCount; i++) this.candies[i].Pop = 1;
          this.turnState = TurnState.Idle;
        }
        break;
      }

      case TurnState.VictoryBonus: {
        this.bonusMoveTickTimer -= dt;
        if (board.MovesLeft > 0 && this.bonusMoveTickTimer <= 0) {
          this.bonusMoveTickTimer = 0.09;
          board.MovesLeft--;
          board.AddBonusScore(120);

          // Fire a celebratory burst on a random playable candy cell
          const rx = this.rng.next(N), ry = this.rng.next(N);
          const ri = Match3Board.Index(rx, ry);
          const wp = this.CellWorldPos(rx, ry);
          const col = CandyPalette[1 + (ri % Match3Board.MaxColors)];
          this.candies[ri].Pop = 1.25;
          this.Fx.burst(wp, col, 14, 4.8, 0.22, 0.52);
          this.Fx.ring(wp, Gold, 0.2, 1.4, 0.28);
          this.SpawnSweets(wp, col, 10, 6);
          this.UI.Float(wp, "+120", Gold, 0.9);
          Sfx.play(Snd.Coin, 0.65, 1.05 + (board.MovesLimit - board.MovesLeft) * 0.04);
          Fx.haptic();
        } else if (board.MovesLeft <= 0 && !this.AnyGoalOrbActive()) {
          this.turnState = TurnState.EndDelay;
          this.stateTimer = 0;
          this.stateDuration = 0.55;
        }
        break;
      }

      case TurnState.EndDelay: {
        this.stateTimer += dt;
        if (this.stateTimer >= this.stateDuration && this.State === Phase.Playing) {
          if (this.victoryPending) this.CompleteLevel();
          else this.FailLevel();
        }
        break;
      }
    }
  }

  private TriggerResolveStep(isPlayerSwap: boolean, isAttractDemo: boolean) {
    const board = this.board;
    const sx1 = isPlayerSwap ? this.swapX1 : -1;
    const sy1 = isPlayerSwap ? this.swapY1 : -1;
    const sx2 = isPlayerSwap ? this.swapX2 : -1;
    const sy2 = isPlayerSwap ? this.swapY2 : -1;

    if (!board.ResolveStep(sx1, sy1, sx2, sy2, isPlayerSwap, this.cascadeCombo, this.rng)) return false;

    let maxDelay = 0;
    let sumPos = V2.zero;
    const clearedCount = board.StepCleared.length;
    let anyJellyBroken = false, anyFrostBroken = false, anyBombTriggered = false;

    for (let c = 0; c < clearedCount; c++) {
      const cl = board.StepCleared[c];
      const idx = Match3Board.Index(cl.X, cl.Y);
      const wp = this.CellWorldPos(cl.X, cl.Y);
      sumPos = sumPos.add(wp);
      maxDelay = Math.max(maxDelay, cl.Delay);

      if (cl.BrokeFrost) {
        anyFrostBroken = true;
        this.slots[idx].FrostShake = 1;
        this.Fx.burst(wp, IceBlue, isAttractDemo ? 6 : 18, 4.8, 0.22, 0.55);
        this.Fx.ring(wp, IceBlue, 0.2, 1.45, 0.3);
        if (!isAttractDemo) this.TrySpawnGoalOrb(wp, ObjectiveKind.BreakFrost, 0, IceBlue);
        continue;
      }

      const cv = this.candies[idx];
      cv.ClearT = 1;
      cv.ClearDelay = cl.Delay;
      cv.ClearDuration = 0.24;
      cv.ClearColor = cl.Color;
      cv.ClearSpecial = cl.Special;

      if (cl.Special !== SpecialType.None) {
        this.specialsTriggeredThisRun++;
        if (cl.Special === SpecialType.Wrapped) {
          anyBombTriggered = true;
          this.Fx.ring(wp, CandyPalette[Mathf.clamp(cl.Color, 1, 6)], 0.3, 2.8, 0.38);
          this.Fx.burst(wp, Gold, isAttractDemo ? 10 : 28, 6.2, 0.26, 0.65);
        }
      }

      if (cl.BrokeJelly) {
        anyJellyBroken = true;
        this.slots[idx].JellyPop = 1;
        this.Fx.burst(wp, Gold, isAttractDemo ? 5 : 16, 4.2, 0.2, 0.5);
        if (!isAttractDemo) this.TrySpawnGoalOrb(wp, ObjectiveKind.ClearJelly, 0, Gold);
      }

      if (!isAttractDemo && cl.Color > 0) this.TrySpawnGoalOrb(wp, ObjectiveKind.CollectColor, cl.Color, CandyPalette[cl.Color]);
    }

    // Spawn laser beam visuals
    for (const lb of board.StepLasers) {
      this.SpawnLaserVisual(lb.X, lb.Y, lb.Horizontal, CandyPalette[Mathf.clamp(lb.Color, 1, 6)]);
      if (!isAttractDemo) {
        const origin = this.CellWorldPos(lb.X, lb.Y);
        this.Fx.ring(origin, Cyan, 0.2, 2.2, 0.32);
      }
    }

    // Spawn lightning arc visuals for Nova Color Bomb
    for (let a = 0; a < board.StepArcs.length; a++) {
      const arc = board.StepArcs[a];
      const from = this.CellWorldPos(arc.FromX, arc.FromY);
      const to = this.CellWorldPos(arc.ToX, arc.ToY);
      const col = CandyPalette[Mathf.clamp(arc.Color, 1, 6)];
      this.SpawnLightningVisual(from, to, col);
      if (a === 0 && !isAttractDemo) this.Fx.ring(from, Color.white, 0.3, 3.2, 0.42);
    }

    // Animate newly spawned special candies
    for (const sp of board.StepSpawned) {
      const idx = Match3Board.Index(sp.X, sp.Y);
      this.candies[idx].ClearT = 0;
      this.candies[idx].Pop = 1.45;
      const wp = this.CellWorldPos(sp.X, sp.Y);
      const col = sp.Special === SpecialType.Nova ? Color.white : CandyPalette[Mathf.clamp(sp.Color, 1, 6)];
      this.Fx.ring(wp, col, 0.2, 1.9, 0.36);
      this.Fx.burst(wp, col, isAttractDemo ? 8 : 22, 5.0, 0.24, 0.58);
      this.SpawnSweets(wp, col, isAttractDemo ? 6 : 16, 5.5);
    }

    if (!isAttractDemo) {
      this.bestComboThisRun = Math.max(this.bestComboThisRun, this.cascadeCombo + 1);
      const pitch = 0.96 + Math.min(this.cascadeCombo, 9) * 0.08;
      Sfx.playClip(this.matchClip, 0.85, pitch);

      if (board.StepArcs.length > 0 || board.StepComboKind === ComboKind.NovaNova) Sfx.playClip(this.novaZapClip, 0.9, 1);
      else if (board.StepLasers.length > 0) Sfx.playClip(this.laserClip, 0.85, Random.range(0.95, 1.08));
      else if (anyBombTriggered || board.StepComboKind === ComboKind.MegaBlast5x5) Sfx.playClip(this.bombClip, 0.9, 1);

      if (board.StepSpawned.length > 0) Sfx.playClip(this.specialSpawnClip, 0.8, 1.05);
      if (anyJellyBroken) Sfx.playClip(this.jellyClip, 0.7, 1.05);
      if (anyFrostBroken) Sfx.playClip(this.frostClip, 0.75, 1.0);

      // Award bonus Gems for forging 4/5-match specials or executing big combos!
      if (board.StepSpawned.length > 0 || board.StepComboKind !== ComboKind.None) {
        const gemBonus = board.StepComboKind !== ComboKind.None ? 8 : (board.StepMaxMatchLen >= 5 ? 6 : 3);
        this.Gems += gemBonus;
        this.gemBadgePop = 1;
      }

      const centerClear = clearedCount > 0 ? sumPos.div(clearedCount) : this.boardCenter;
      this.UI.Float(centerClear, "+" + Fmt.n(board.StepPoints), this.cascadeCombo >= 1 ? Gold : Color.white,
        Mathf.clamp(0.95 + this.cascadeCombo * 0.12, 0.95, 1.45));

      this.TriggerPraiseAndFeel(centerClear);
    }

    const hasSpecialDrama = board.StepLasers.length > 0 || board.StepArcs.length > 0 || board.StepComboKind !== ComboKind.None;
    this.turnState = TurnState.Clearing;
    this.stateTimer = 0;
    this.stateDuration = Mathf.clamp((hasSpecialDrama ? 0.3 : 0.22) + maxDelay, 0.22, 0.44);
    return true;
  }

  private TriggerPraiseAndFeel(worldAnchor: V2) {
    const board = this.board;
    let intensityRank = this.cascadeCombo;
    if (board.StepComboKind === ComboKind.NovaNova) intensityRank = Math.max(intensityRank, 5);
    else if (board.StepComboKind !== ComboKind.None || board.StepMaxMatchLen >= 5) intensityRank = Math.max(intensityRank, 4);
    else if (board.StepMaxMatchLen === 4 || board.StepLasers.length > 0) intensityRank = Math.max(intensityRank, 2);

    const shake = Mathf.clamp(0.05 + intensityRank * 0.045, 0.05, 0.28);
    if (intensityRank >= 1) {
      this.Fx.shake(shake);
      this.Fx.kick(0.35 + intensityRank * 0.18, intensityRank >= 3 ? 0.16 : 0);
      Fx.haptic(intensityRank >= 3);
    } else {
      Fx.haptic();
    }

    if (board.StepComboKind === ComboKind.NovaNova) {
      this.Back.Flash(Pink, 0.35);
      this.skyFlash = 0.6;
      this.SpawnSweets(worldAnchor, Gold, 46, 8);
      this.UI.Announce("SUPERNOVA WIPE!", Gold, 1.4);
    } else if (intensityRank >= 4) {
      this.Back.Flash(Gold, 0.2);
      this.skyFlash = Math.max(this.skyFlash, 0.35);
      this.SpawnSweets(worldAnchor, Gold, 30, 7);
      this.UI.Announce("SUPERNOVA! x" + (this.cascadeCombo + 1), Gold, 1.2);
    } else if (intensityRank === 3) {
      this.UI.Announce("DIVINE! x" + (this.cascadeCombo + 1), Pink, 1.1);
      this.SpawnSweets(worldAnchor, Pink, 22, 6);
    } else if (intensityRank === 2) {
      this.UI.Announce("DELICIOUS!", Cyan, 1.0);
    } else if (this.cascadeCombo === 1) {
      this.UI.Float(worldAnchor.add(new V2(0, 0.55)), "SWEET! x2", Emerald, 1.08);
    }

    Sfx.setIntensity(Mathf.clamp01(0.22 + this.cascadeCombo * 0.14));
  }

  private BeginGravityFall(_isAttractDemo: boolean) {
    this.board.ApplyGravityAndRefill(this.rng);
    for (const fm of this.board.StepFalls) {
      const idx = Match3Board.Index(fm.X, fm.ToY);
      const cv = this.candies[idx];
      cv.ClearT = 0;
      cv.ClearDelay = 0;
      cv.FallOffsetY = Math.max(0.1, fm.FromY - fm.ToY);
      cv.FallVelocityY = 3.5;
    }
    this.turnState = TurnState.Falling;
    this.stateTimer = 0;
  }

  private CheckPostTurnState(isAttractDemo: boolean) {
    const board = this.board;
    if (isAttractDemo) {
      if (!board.HasValidMove()) board.Reshuffle(this.rng);
      this.turnState = TurnState.Idle;
      return;
    }

    if (board.AllObjectivesComplete) {
      this.victoryPending = true;
      this.turnState = TurnState.VictoryBonus;
      this.bonusMoveTickTimer = 0.2;
      this.UI.Announce("LEVEL CLEAR!", Gold, 1.3);
      Sfx.play(Snd.PowerUp, 0.85);
      this.Fx.kick(0.8, 0.12);
      return;
    }

    if (board.MovesLeft <= 0) {
      this.victoryPending = false;
      this.turnState = TurnState.EndDelay;
      this.stateTimer = 0;
      this.stateDuration = 0.65;
      Sfx.play(Snd.Warn, 0.7);
      return;
    }

    if (!board.HasValidMove()) {
      this.UI.Announce("NO MOVES · SHUFFLING!", Cyan, 1.2);
      Sfx.play(Snd.Whoosh, 0.8);
      this.Fx.ring(this.boardCenter, Cyan, 0.5, 4.5, 0.45);
      this.turnState = TurnState.Reshuffling;
      this.stateTimer = 0;
      this.stateDuration = 0.42;
      return;
    }

    this.turnState = TurnState.Idle;
  }

  // ------------------------------------------------------------------ boosters

  private OnHammerBoosterPressed() {
    if (this.State !== Phase.Playing || this.turnState !== TurnState.Idle) return;

    if (this.hammerMode) {
      this.hammerMode = false;
      this.UI.Hint(null);
      Sfx.play(Snd.Click, 0.5, 0.85);
      return;
    }

    if (this.Gems < HammerCost) {
      this.OfferGemTopUp();
      return;
    }

    this.novaWandMode = false;
    this.hammerMode = true;
    Sfx.play(Snd.Confirm, 0.65, 1.1);
    this.UI.Hint("LOLLIPOP HAMMER: Tap any candy, Special, Gold Jelly, or Frost Ice tile to smash it!");
  }

  private ExecuteHammerOnCell(gx: number, gy: number) {
    const board = this.board;
    if (this.Gems < HammerCost) return;
    if (!board.ApplyHammer(gx, gy, this.rng)) {
      Sfx.play(Snd.Deny, 0.45);
      return;
    }

    this.hammerMode = false;
    this.UI.Hint(null);
    this.Gems -= HammerCost;
    this.gemBadgePop = 0.85;
    this.cascadeCombo = 0;

    const wp = this.CellWorldPos(gx, gy);
    Sfx.playClip(this.bombClip, 0.9, 1.15);
    this.Fx.burst(wp, Pink, 30, 6.0, 0.25, 0.65);
    this.Fx.ring(wp, Pink, 0.25, 2.3, 0.4);
    this.Fx.shake(0.14);
    this.Fx.kick(0.75);
    Fx.haptic(true);

    // Process cleared visuals from the hammer hit
    for (const cl of board.StepCleared) {
      const idx = Match3Board.Index(cl.X, cl.Y);
      const cp = this.CellWorldPos(cl.X, cl.Y);
      if (cl.BrokeFrost) {
        this.slots[idx].FrostShake = 1;
        this.Fx.burst(cp, IceBlue, 16, 4.5, 0.22, 0.5);
        this.TrySpawnGoalOrb(cp, ObjectiveKind.BreakFrost, 0, IceBlue);
        continue;
      }
      const cv = this.candies[idx];
      cv.ClearT = 1;
      cv.ClearDelay = cl.Delay;
      cv.ClearDuration = 0.24;
      cv.ClearColor = cl.Color;
      cv.ClearSpecial = cl.Special;
      if (cl.BrokeJelly) {
        this.slots[idx].JellyPop = 1;
        this.TrySpawnGoalOrb(cp, ObjectiveKind.ClearJelly, 0, Gold);
      }
      if (cl.Color > 0) this.TrySpawnGoalOrb(cp, ObjectiveKind.CollectColor, cl.Color, CandyPalette[cl.Color]);
    }

    for (const lb of board.StepLasers) this.SpawnLaserVisual(lb.X, lb.Y, lb.Horizontal, CandyPalette[Mathf.clamp(lb.Color, 1, 6)]);
    for (const arc of board.StepArcs)
      this.SpawnLightningVisual(this.CellWorldPos(arc.FromX, arc.FromY), this.CellWorldPos(arc.ToX, arc.ToY), CandyPalette[Mathf.clamp(arc.Color, 1, 6)]);

    this.turnState = TurnState.Clearing;
    this.stateTimer = 0;
    this.stateDuration = 0.26;
  }

  private OnNovaBoosterPressed() {
    if (this.State !== Phase.Playing || this.turnState !== TurnState.Idle) return;

    if (this.novaWandMode) {
      this.novaWandMode = false;
      this.UI.Hint(null);
      Sfx.play(Snd.Click, 0.5, 0.85);
      return;
    }

    if (this.Gems < NovaWandCost) {
      this.OfferGemTopUp();
      return;
    }

    this.hammerMode = false;
    this.novaWandMode = true;
    Sfx.play(Snd.Confirm, 0.65, 1.15);
    this.UI.Hint("NOVA WAND: Tap any candy to turn it into a NOVA COLOR BOMB, or drag two candies to FREE SWAP!");
  }

  private ExecuteNovaUpgradeOnCell(gx: number, gy: number) {
    if (this.Gems < NovaWandCost || !this.board.UpgradeToNova(gx, gy)) {
      Sfx.play(Snd.Deny, 0.45);
      return;
    }

    this.novaWandMode = false;
    this.selX = this.selY = -1;
    this.UI.Hint(null);
    this.Gems -= NovaWandCost;
    this.gemBadgePop = 0.85;

    const idx = Match3Board.Index(gx, gy);
    this.candies[idx].Pop = 1.5;
    const wp = this.CellWorldPos(gx, gy);
    Sfx.playClip(this.specialSpawnClip, 0.95, 1.1);
    this.Fx.burst(wp, Gold, 28, 5.5, 0.25, 0.65);
    this.Fx.ring(wp, Pink, 0.25, 2.2, 0.42);
    this.Fx.kick(0.65);
    Fx.haptic(true);
    this.UI.Float(wp, "NOVA READY!", Gold, 1.0);
  }

  private OnShuffleBoosterPressed() {
    if (this.State !== Phase.Playing || this.turnState !== TurnState.Idle) return;

    if (this.Gems < ShuffleCost) {
      this.OfferGemTopUp();
      return;
    }

    this.hammerMode = false;
    this.novaWandMode = false;
    this.UI.Hint(null);
    this.Gems -= ShuffleCost;
    this.gemBadgePop = 0.75;

    Sfx.play(Snd.Whoosh, 0.85, 1.08);
    this.Fx.ring(this.boardCenter, Cyan, 0.4, 4.4, 0.4);
    this.Fx.burst(this.boardCenter, Cyan, 24, 5.0, 0.22, 0.55);
    Fx.haptic();

    this.turnState = TurnState.Reshuffling;
    this.stateTimer = 0;
    this.stateDuration = 0.36;
  }

  private OfferGemTopUp() {
    if (AdService.rewardedAvailable) {
      AdService.showRewarded((earned) => {
        if (!earned) return;
        this.Gems += 150;
        this.gemBadgePop = 1;
        Sfx.play(Snd.PowerUp, 0.85);
        this.UI.Float(this.boardCenter, "+150 GEMS!", Emerald, 1.1);
      });
      return;
    }
    Sfx.play(Snd.Deny, 0.55);
    this.UI.Toast("Not enough Gems! Forge Special Candies or complete levels to earn more Gems.", 3.2);
  }

  // ------------------------------------------------------------------ visual effects helpers

  private SpawnLaserVisual(gx: number, gy: number, horizontal: boolean, color: Color) {
    let lf: LaserFx | null = null;
    for (const l of this.laserPool) if (!l.Active) { lf = l; break; }
    if (!lf) lf = this.laserPool[0];

    lf.Active = true;
    lf.T = 0;
    lf.Duration = 0.32;
    lf.Color = color;

    const center = this.CellWorldPos(gx, gy);
    const halfSpan = N * 0.5 + 0.35;
    const bc = this.boardCenter;
    const p0 = horizontal ? new V3(bc.x - halfSpan, center.y, 0) : new V3(center.x, bc.y - halfSpan, 0);
    const p1 = horizontal ? new V3(bc.x + halfSpan, center.y, 0) : new V3(center.x, bc.y + halfSpan, 0);

    lf.Outer.setPosition(0, p0);
    lf.Outer.setPosition(1, p1);
    lf.Core.setPosition(0, p0);
    lf.Core.setPosition(1, p1);
    lf.Outer.gameObject.setActive(true);
    lf.Core.gameObject.setActive(true);
  }

  private SpawnLightningVisual(from: V2, to: V2, color: Color) {
    let lfx: LightningFx | null = null;
    for (const l of this.lightningPool) if (!l.Active) { lfx = l; break; }
    if (!lfx) lfx = this.lightningPool[0];

    lfx.Active = true;
    lfx.From = from;
    lfx.To = to;
    lfx.T = 0;
    lfx.Duration = 0.34;
    lfx.Color = color;
    lfx.Bolt.gameObject.setActive(true);
    this.UpdateLightningVertices(lfx);
  }

  private UpdateLightningVertices(lfx: LightningFx) {
    const dir = lfx.To.sub(lfx.From);
    const perp = new V2(-dir.y, dir.x).normalized;
    const pts = lfx.Bolt.positionCount;
    for (let i = 0; i < pts; i++) {
      const u = i / (pts - 1);
      let p = V2.lerp(lfx.From, lfx.To, u);
      if (i > 0 && i < pts - 1) {
        const jitter = (this.rng.nextDouble() * 2 - 1) * 0.24;
        p = p.add(perp.mul(jitter));
      }
      lfx.Bolt.setPosition(i, new V3(p.x, p.y, 0));
    }
  }

  private TrySpawnGoalOrb(fromWorld: V2, kind: ObjectiveKind, color: number, visualCol: Color) {
    const board = this.board;
    let targetObjIdx = -1;
    for (let i = 0; i < board.Objectives.length; i++) {
      const o = board.Objectives[i];
      if (o.Kind !== kind) continue;
      if (kind === ObjectiveKind.CollectColor && o.TargetColor !== color) continue;
      targetObjIdx = i;
      break;
    }
    if (targetObjIdx < 0) return;

    let orb: FlyingGoalOrb | null = null;
    for (const o of this.orbPool) if (!o.Active) { orb = o; break; }
    if (!orb) return;

    // Convert HUD objective card position into approximate world target at top of play area
    const xOffset = board.Objectives.length === 1 ? 0 : (targetObjIdx === 0 ? -1.4 : 1.4);
    const toWorld = this.boardCenter.add(new V2(xOffset, N * 0.5 + 0.85));

    orb.Active = true;
    orb.From = fromWorld;
    orb.To = toWorld;
    orb.T = 0;
    orb.Duration = 0.36;
    orb.TrailTimer = 0;
    orb.Color = visualCol;
    orb.ObjectiveIndex = targetObjIdx;
    orb.Glow.color = visualCol.withAlpha(0.75);
    orb.Body.sprite = CandyArt.CandyBody(color > 0 ? color : 4);
    orb.Body.color = visualCol;
    orb.Core.color = Color.white;
    orb.Glow.transform.position = fromWorld;
    orb.Body.transform.position = fromWorld;
    orb.Core.transform.position = fromWorld;
    orb.Glow.gameObject.setActive(true);
    orb.Body.gameObject.setActive(true);
    orb.Core.gameObject.setActive(true);
  }

  private AnyGoalOrbActive() {
    for (const o of this.orbPool) if (o.Active) return true;
    return false;
  }

  // ------------------------------------------------------------------ world animation & rendering

  private AnimateWorld(dt: number) {
    const board = this.board;
    const time = Time.time;
    const accent = Pal.hex(this.realm.AccentHex);

    // 0. Pastel sky: follows the camera, tinted by the realm, blushes red when moves run low.
    const camC = this.Fx.CameraTarget;
    if (this.skyBackdrop) {
      const h = Camera.orthographicSize * 2 * 1.2;
      this.skyBackdrop.transform.position = new V3(camC.x, camC.y, 0);
      this.skyBackdrop.transform.localScale = new V3(h * Camera.aspect, h, 1);
      const lowMoves = this.State === Phase.Playing && board.MovesLeft <= 5 && this.turnState !== TurnState.VictoryBonus;
      this.skyDanger = Mathf.moveTowards(this.skyDanger, lowMoves ? Mathf.inverseLerp(6, 0, board.MovesLeft) : 0, dt * 1.5);
      this.skyFlash = Mathf.moveTowards(this.skyFlash, 0, dt * 1.8);
      let tint = this.realm.AccentHex !== 0 ? Color.lerp(Color.white, accent, 0.1) : Color.white;
      tint = Color.lerp(tint, new Color(1, 0.74, 0.76), this.skyDanger * 0.55);
      tint = Color.lerp(tint, Color.white, this.skyFlash);
      this.skyBackdrop.color = tint;
    }

    // 1. Bubbles and sprinkles float up through the sky and wrap around
    for (let i = 0; i < this.bgSparkles.length; i++) {
      const sp = this.bgSparkles[i];
      const tw = 0.5 + 0.5 * Math.sin(time * 1.3 + sp.Phase);
      const y = Mathf.repeat(sp.BasePos.y + 9 + time * sp.Speed, 18) - 9;
      const x = sp.BasePos.x + Math.sin(time * 0.6 + sp.Phase) * sp.Drift;
      sp.Tr.localPosition = new V3(camC.x + x, camC.y + y, 0);
      const bubble = i % 3 === 0;
      sp.Tr.localRotation = Quaternion.euler(0, 0, bubble ? 0 : time * 40 * (i % 2 === 0 ? 1 : -1) + sp.Phase * 57);
      const wob = bubble ? 0.06 * Math.sin(time * 3.1 + sp.Phase) : 0;
      const sc = sp.BaseScale * (bubble ? 1 : 0.85 + 0.3 * tw);
      sp.Tr.localScale = new V3(sc * (1 + wob), sc * (1 - wob), 1);
      sp.Sr.color = sp.Color.withAlpha(bubble ? 0.55 + 0.2 * tw : 0.35 + 0.3 * tw);
    }

    // 2. Board glow breathes softly in the realm colour
    this.boardOuterGlow.color = Color.lerp(CandyArt.Berry, accent, 0.35).withAlpha(0.18 + 0.06 * Math.sin(time * 2.1));

    this.AnimateSweets(dt);

    // 3. Laser beams
    for (const lf of this.laserPool) {
      if (!lf.Active) continue;
      lf.T += dt / lf.Duration;
      if (lf.T >= 1) {
        lf.Active = false;
        lf.Outer.gameObject.setActive(false);
        lf.Core.gameObject.setActive(false);
        continue;
      }
      const fade = 1 - Ease.inQuad(lf.T);
      lf.Outer.widthMultiplier = 0.75 * fade;
      lf.Core.widthMultiplier = 0.28 * fade;
      lf.Outer.startColor = lf.Outer.endColor = Color.lerp(lf.Color, Color.white, 0.15).withAlpha(0.9 * fade);
      lf.Core.startColor = lf.Core.endColor = Color.white.withAlpha(fade);
    }

    // 4. Lightning arcs
    for (const lfx of this.lightningPool) {
      if (!lfx.Active) continue;
      lfx.T += dt / lfx.Duration;
      if (lfx.T >= 1) {
        lfx.Active = false;
        lfx.Bolt.gameObject.setActive(false);
        continue;
      }
      this.UpdateLightningVertices(lfx);
      const fade = 1 - lfx.T;
      lfx.Bolt.widthMultiplier = (0.14 + 0.08 * Math.sin(time * 45)) * fade;
      lfx.Bolt.startColor = Color.white.withAlpha(fade);
      lfx.Bolt.endColor = lfx.Color.withAlpha(fade);
    }

    // 5. Flying objective orbs
    for (const orb of this.orbPool) {
      if (!orb.Active) continue;
      orb.T += dt / orb.Duration;
      if (orb.T >= 1) {
        orb.Active = false;
        orb.Glow.gameObject.setActive(false);
        orb.Body.gameObject.setActive(false);
        orb.Core.gameObject.setActive(false);
        if (orb.ObjectiveIndex >= 0 && orb.ObjectiveIndex < this.objCardPop.length) this.objCardPop[orb.ObjectiveIndex] = 1;
        continue;
      }
      const k = Ease.outCubic(orb.T);
      const mid = orb.From.add(orb.To).mul(0.5).add(new V2(0, 0.9));
      const p = V2.lerp(V2.lerp(orb.From, mid, k), V2.lerp(mid, orb.To, k), k);
      orb.Glow.transform.position = p;
      orb.Body.transform.position = p;
      orb.Core.transform.position = p;
      orb.Core.transform.localRotation = Quaternion.euler(0, 0, time * 320);

      orb.TrailTimer -= dt;
      if (orb.TrailTimer <= 0) {
        orb.TrailTimer = 0.035;
        this.Fx.burst(p, orb.Color, 2, 1.2, 0.11, 0.22);
      }
    }

    // 6. Render board slots (Checker, Gold Jelly, Frost Blockers) & Candies
    const pulse = 0.5 + 0.5 * Math.sin(time * 7);
    const rainbowT = time * 0.45;

    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = Match3Board.Index(x, y);
        const slot = this.slots[i];
        const cv = this.candies[i];

        if (board.Hole[i]) {
          slot.Root.setActive(false);
          cv.Root.setActive(false);
          continue;
        }
        slot.Root.setActive(true);

        // Jelly underlay
        slot.JellyPop = Mathf.moveTowards(slot.JellyPop, 0, dt * 4);
        const jelly = board.Jelly[i];
        slot.JellyBase.gameObject.setActive(jelly > 0);
        slot.JellyRim.gameObject.setActive(jelly >= 2);
        if (jelly > 0) {
          // Jelly wobble: idle counter-phase jiggle, plus a damped boing when it is hit.
          const idle = 0.025 * Math.sin(time * 4 + i);
          const boing = Math.sin((1 - slot.JellyPop) * Math.PI * 3) * slot.JellyPop * 0.22;
          const js = 0.98;
          slot.JellyBase.transform.localScale = new V3(js * (1 + idle + boing), js * (1 - idle - boing), 1);
          slot.JellyBase.color = jelly >= 2
            ? Color.lerp(CandyArt.Honey, new Color(1, 0.5, 0.2), 0.35).withAlpha(0.95)
            : CandyArt.Honey.withAlpha(0.78 + 0.08 * pulse);
          if (jelly >= 2) slot.JellyRim.transform.localScale = slot.JellyBase.transform.localScale.mul(0.88);
        }

        // Frost blocker overlay
        slot.FrostShake = Mathf.moveTowards(slot.FrostShake, 0, dt * 4.5);
        const frost = board.Frost[i];
        slot.FrostBlock.gameObject.setActive(frost > 0);
        slot.FrostCore.gameObject.setActive(frost > 0);
        if (frost > 0) {
          const sx = Math.sin(time * 55) * 0.07 * slot.FrostShake;
          slot.FrostBlock.transform.localPosition = new V3(sx, 0, 0);
          slot.FrostCore.transform.localPosition = new V3(sx, 0, 0);
          slot.FrostCore.transform.localRotation = Quaternion.euler(0, 0, time * 22 + i * 15);
          slot.FrostBlock.color = frost >= 2 ? new Color(0.8, 0.93, 1, 1) : new Color(0.72, 0.95, 1, 0.86);
          const twk = 0.5 + 0.5 * Math.sin(time * 2.5 + i * 1.7);
          const fs = 0.32 + 0.22 * twk;
          slot.FrostCore.transform.localScale = new V3(fs, fs, fs);
          slot.FrostCore.color = Color.white.withAlpha(0.45 + 0.5 * twk);
        }

        // Candy clear animation
        cv.Pop = Mathf.moveTowards(cv.Pop, 0, dt * 4.2);
        cv.LandSquash = Mathf.moveTowards(cv.LandSquash, 0, dt * 2.6);

        if (cv.ClearT > 0) {
          if (cv.ClearDelay > 0) {
            cv.ClearDelay -= dt;
            if (cv.ClearDelay <= 0) {
              const bc = CandyPalette[Mathf.clamp(cv.ClearColor, 1, 6)];
              this.Fx.burst(this.CellWorldPos(x, y), bc, this.State === Phase.Playing ? 8 : 3, 3.8, 0.19, 0.42);
            }
            cv.Root.localRotation = Quaternion.identity;
            cv.Root.setActive(true);
            this.ConfigureCandySprites(cv, cv.ClearColor, cv.ClearSpecial, time, i, rainbowT, 1);
            cv.Root.localPosition = CellLocalPos(x, y);
            cv.Root.localScale = new V3(1.06, 1.06, 1.06);
            continue;
          }

          if (cv.ClearT >= 1) {
            // First frame of the pop: a puff of sugar sprinkles in the candy's colour.
            const sc = CandyPalette[Mathf.clamp(cv.ClearColor, 1, 6)];
            this.SpawnSweets(this.CellWorldPos(x, y), sc, this.State === Phase.Playing ? 7 : 3, 4.6);
          }
          cv.ClearT = Mathf.moveTowards(cv.ClearT, 0, dt / Math.max(0.1, cv.ClearDuration));
          cv.Root.setActive(cv.ClearT > 0.01);
          const k = 1 - cv.ClearT; // 0 → 1 over the pop
          const flash = k < 0.2 ? k / 0.2 : Mathf.clamp01(1 - (k - 0.2) / 0.4);
          this.ConfigureCandySprites(cv, cv.ClearColor, cv.ClearSpecial, time, i, rainbowT, Mathf.clamp01(cv.ClearT * 1.8), flash * 0.7);
          // Swell, then shrink away; mostly gone before the Clearing state hands over to gravity.
          const cs = k < 0.2
            ? Mathf.lerp(1, 1.3, Ease.outCubic(k / 0.2))
            : Mathf.lerp(1.3, 0, Ease.outCubic((k - 0.2) / 0.75));
          cv.Root.localPosition = CellLocalPos(x, y);
          cv.Root.localScale = new V3(cs, cs, 1);
          cv.Root.localRotation = Quaternion.euler(0, 0, k * k * 160 * (((x + y) & 1) === 0 ? 1 : -1));
          continue;
        }

        const col = board.Color[i];
        const spec = board.Special[i];
        if (col === 0 || frost > 0) {
          cv.Root.setActive(false);
          continue;
        }

        cv.Root.setActive(true);
        this.ConfigureCandySprites(cv, col, spec, time, i, rainbowT, 1);

        // Calculate position including active swap animation, gravity fall, or reshuffle swirl
        let basePos = CellLocalPos(x, y);
        let swapScaleBump = 1;

        if (this.turnState === TurnState.Swapping || this.turnState === TurnState.SwapBack) {
          const u = Mathf.clamp01(this.stateTimer / Math.max(0.01, this.stateDuration));
          const t = this.turnState === TurnState.Swapping ? Ease.inOutSine(u) : Ease.inOutSine(1 - u);
          // The two candies pass each other on small opposite arcs instead of colliding head-on.
          const a1 = CellLocalPos(this.swapX1, this.swapY1), a2 = CellLocalPos(this.swapX2, this.swapY2);
          const sd = a2.sub(a1);
          const perp = new V3(-sd.y, sd.x, 0).mul(0.2 * Math.sin(t * Math.PI));
          if (x === this.swapX1 && y === this.swapY1) {
            basePos = V3.lerp(a1, a2, t).add(perp);
            swapScaleBump = 1 + 0.2 * Math.sin(u * Math.PI);
          } else if (x === this.swapX2 && y === this.swapY2) {
            basePos = V3.lerp(a2, a1, t).sub(perp);
            swapScaleBump = 1 - 0.12 * Math.sin(u * Math.PI);
          }
        } else if (this.turnState === TurnState.Reshuffling) {
          const u = Math.sin(Mathf.clamp01(this.stateTimer / this.stateDuration) * Math.PI);
          basePos = V3.lerp(basePos, V3.zero, u * 0.45);
        }

        // Idle hint nudge toward the partner candy
        let hintOffset = V2.zero;
        let hintBump = 0;
        if (this.turnState === TurnState.Idle && this.hintX1 >= 0) {
          const hDir = new V2(this.hintX2 - this.hintX1, this.hintY2 - this.hintY1);
          const nudge = Math.max(0, Math.sin(time * 7.5)) * 0.12;
          if (x === this.hintX1 && y === this.hintY1) { hintOffset = hDir.mul(nudge); hintBump = 0.12 * pulse; }
          else if (x === this.hintX2 && y === this.hintY2) { hintOffset = hDir.mul(-nudge); hintBump = 0.12 * pulse; }
        }

        // Subtle idle breathing wave across the board
        const breathe = 0.025 * Math.sin(time * 3.0 + x * 0.7 + y * 0.9);
        const popBump = 0.24 * Math.sin(Mathf.clamp01(cv.Pop) * Math.PI);
        const isSelected = x === this.selX && y === this.selY;
        const selectBump = isSelected ? 0.12 + 0.04 * Math.sin(time * 9) : 0;

        // Jelly landing: a damped squash/stretch wobble anchored to the tile floor, and a
        // vertical stretch while falling fast.
        const w = cv.LandSquash;
        const squash = w > 0 ? Math.sin((1 - w) * Math.PI * 3) * w * 0.24 : 0;
        const fallStretch = cv.FallOffsetY > 0.001 ? Mathf.clamp(cv.FallVelocityY * 0.012, 0, 0.16) : 0;
        const scaleAll = (1 + breathe + popBump + selectBump + hintBump) * swapScaleBump;
        const sxFinal = scaleAll * (1 + squash - fallStretch * 0.5);
        const syFinal = scaleAll * (1 - squash * 0.9 + fallStretch);
        const floorShift = -squash * 0.4;

        // Selected candy hops in place.
        const hop = isSelected ? Math.abs(Math.sin(time * 7)) * 0.1 : 0;

        const rotZ = isSelected ? Math.sin(time * 12) * 6 : Math.sin(time * 2.2 + i) * 2.2;
        cv.Root.localPosition = basePos.add(new V3(hintOffset.x, cv.FallOffsetY + hintOffset.y + floorShift + hop, 0));
        cv.Root.localScale = new V3(sxFinal, syFinal, 1);
        cv.Root.localRotation = Quaternion.euler(0, 0, rotZ);
      }

    // 7. Update selection, keyboard cursor, and idle hint rings
    const showSel = this.selX >= 0 && this.turnState === TurnState.Idle;
    if (this.selectRing.gameObject.activeSelf !== showSel) this.selectRing.gameObject.setActive(showSel);
    if (showSel) {
      this.selectRing.transform.localPosition = CellLocalPos(this.selX, this.selY);
      const sr = 1.02 + 0.08 * Math.sin(time * 10);
      this.selectRing.transform.localScale = new V3(sr, sr, 1);
      this.selectRing.color = this.novaWandMode ? CandyArt.Honey : CandyArt.Berry;
    }

    const showCur = this.cursorVisible && this.State === Phase.Playing && this.turnState === TurnState.Idle;
    if (this.cursorRing.gameObject.activeSelf !== showCur) this.cursorRing.gameObject.setActive(showCur);
    if (showCur) {
      this.cursorRing.transform.localPosition = CellLocalPos(this.cursorX, this.cursorY);
      const cr = 1.04 + 0.06 * Math.sin(time * 8);
      this.cursorRing.transform.localScale = new V3(cr, cr, 1);
      this.cursorRing.color = this.cursorLocked ? CandyArt.Honey : CandyArt.Sky;
    }

    const showHint = this.turnState === TurnState.Idle && this.hintX1 >= 0 && this.State === Phase.Playing;
    if (this.hintRingA.gameObject.activeSelf !== showHint) {
      this.hintRingA.gameObject.setActive(showHint);
      this.hintRingB.gameObject.setActive(showHint);
    }
    if (showHint) {
      const hr = 1.0 + 0.12 * pulse;
      const hc = HintOrange.withAlpha(0.45 + 0.5 * pulse);
      this.hintRingA.transform.localPosition = CellLocalPos(this.hintX1, this.hintY1);
      this.hintRingB.transform.localPosition = CellLocalPos(this.hintX2, this.hintY2);
      this.hintRingA.transform.localScale = new V3(hr, hr, 1);
      this.hintRingB.transform.localScale = new V3(hr, hr, 1);
      this.hintRingA.color = hc;
      this.hintRingB.color = hc;
    }
  }

  private ConfigureCandySprites(cv: CandyView, col: number, spec: SpecialType, time: number, idx: number, rainbowT: number, alpha: number, flash = 0) {
    const baseColor = CandyPalette[Mathf.clamp(col, 1, 6)];

    // Twinkle: every few seconds a little star glints on each candy, staggered across the board.
    const tph = Mathf.repeat(time * 0.32 + idx * 0.137, 1);
    const glint = tph < 0.1 ? Math.sin((tph / 0.1) * Math.PI) : 0;
    cv.Gloss.color = Color.white.withAlpha(glint * alpha);
    const gs = 0.12 + 0.3 * glint;
    cv.Gloss.transform.localScale = new V3(gs, gs, gs);
    cv.Gloss.transform.localRotation = Quaternion.euler(0, 0, glint * 45);

    if (spec === SpecialType.Nova) {
      // Chocolate truffle with rainbow sprinkles.
      const rainbow = Pal.rainbow(rainbowT + idx * 0.07);
      cv.Body.sprite = CandyArt.ChocoBomb();
      cv.Body.color = Color.lerp(new Color(0.92, 0.92, 0.92), Color.white, 0.5 + 0.5 * flash).withAlpha(alpha);
      cv.Facet.color = Color.clear; // the truffle has its own baked lighting
      cv.Facet.transform.localRotation = Quaternion.identity;
      cv.Aura.color = rainbow.withAlpha((0.45 + 0.15 * Math.sin(time * 6 + idx)) * alpha);
      cv.StripeOverlay.gameObject.setActive(false);
      cv.WrapperOverlay.gameObject.setActive(false);
      return;
    }

    cv.Body.sprite = CandyArt.CandyBody(col);
    cv.Body.color = Color.lerp(baseColor, Color.white, flash).withAlpha(alpha);
    cv.Facet.sprite = CandyArt.CandyShine(col);
    cv.Facet.color = Color.white.withAlpha(alpha);
    cv.Facet.transform.localRotation = Quaternion.identity;

    if (spec === SpecialType.StripedH || spec === SpecialType.StripedV) {
      cv.StripeOverlay.gameObject.setActive(true);
      cv.StripeOverlay.sprite = spec === SpecialType.StripedH ? StripesHSprite() : StripesVSprite();
      cv.StripeOverlay.color = Color.white.withAlpha(0.9 * alpha);
      cv.WrapperOverlay.gameObject.setActive(false);
      cv.Aura.color = baseColor.withAlpha((0.32 + 0.16 * Math.sin(time * 8 + idx)) * alpha);
    } else if (spec === SpecialType.Wrapped) {
      cv.StripeOverlay.gameObject.setActive(false);
      cv.WrapperOverlay.gameObject.setActive(true);
      cv.WrapperOverlay.sprite = WrappedFrameSprite();
      const wpulse = 0.5 + 0.5 * Math.sin(time * 9 + idx);
      cv.WrapperOverlay.color = Color.lerp(CandyArt.Honey, Color.white, wpulse * 0.6).withAlpha(0.95 * alpha);
      const ws = 0.94 * (1 + 0.04 * wpulse);
      cv.WrapperOverlay.transform.localScale = new V3(ws, ws, 1);
      cv.Aura.color = Gold.withAlpha(0.42 * alpha);
    } else {
      cv.StripeOverlay.gameObject.setActive(false);
      cv.WrapperOverlay.gameObject.setActive(false);
      const boosterHighlight = this.hammerMode || this.novaWandMode;
      cv.Aura.color = boosterHighlight ? Gold.withAlpha((0.2 + 0.15 * Math.sin(time * 7 + idx)) * alpha) : Color.clear;
    }
  }

  // ------------------------------------------------------------------ sugar-sprinkle bursts

  private SpawnSweets(origin: V2, main: Color, count: number, power: number) {
    if (this.sweets.length === 0) return;
    for (let n = 0; n < count; n++) {
      const b = this.sweets[this.sweetCursor];
      this.sweetCursor = (this.sweetCursor + 1) % this.sweets.length;
      const a = Random.range(0, Math.PI * 2);
      const sp = power * Random.range(0.35, 1);
      b.Pos = origin;
      b.Vel = new V2(Math.cos(a) * sp, Math.sin(a) * sp + power * 0.35);
      b.Color = n % 2 === 0 ? main : CandyArt.SprinkleColors[Random.rangeInt(0, CandyArt.SprinkleColors.length)];
      CandyNovaGame.StartSweet(b, 0.55 + Random.range(0, 0.45));
    }
  }

  /** Victory shower of sprinkles falling from the top of the view. */
  private SweetShower(count: number) {
    if (this.sweets.length === 0) return;
    const h = Camera.orthographicSize, w = h * Camera.aspect;
    const c = this.Fx.CameraTarget;
    for (let n = 0; n < count; n++) {
      const b = this.sweets[this.sweetCursor];
      this.sweetCursor = (this.sweetCursor + 1) % this.sweets.length;
      b.Pos = c.add(new V2(Random.range(-w, w), h + Random.range(0.2, 4)));
      b.Vel = new V2(Random.range(-1.2, 1.2), Random.range(-4, -1.5));
      b.Color = CandyArt.SprinkleColors[Random.rangeInt(0, CandyArt.SprinkleColors.length)];
      CandyNovaGame.StartSweet(b, 2.8 + Random.range(0, 1.2));
    }
  }

  private static StartSweet(b: SweetBit, life: number) {
    b.Active = true;
    b.Life = 0;
    b.MaxLife = life;
    b.Rot = Random.range(0, 360);
    b.RotSpeed = Random.range(-600, 600);
    b.Size = Random.range(0.13, 0.24);
    b.Sr.color = b.Color;
    b.Sr.gameObject.setActive(true);
  }

  private AnimateSweets(dt: number) {
    for (const b of this.sweets) {
      if (!b.Active) continue;
      b.Life += dt;
      if (b.Life >= b.MaxLife) {
        b.Active = false;
        b.Sr.gameObject.setActive(false);
        continue;
      }
      b.Vel = b.Vel.withY(b.Vel.y - 13 * dt);
      b.Vel = b.Vel.mul(1 - Math.min(1, 1.3 * dt));
      b.Vel = b.Vel.withY(Math.max(b.Vel.y, -5));
      b.Pos = b.Pos.add(b.Vel.mul(dt));
      b.Rot += b.RotSpeed * dt;
      const tr = b.Sr.transform;
      tr.position = new V3(b.Pos.x, b.Pos.y, 0);
      tr.localRotation = Quaternion.euler(0, 0, b.Rot);
      const k = Mathf.clamp01((b.MaxLife - b.Life) / 0.3);
      const sc = b.Size * (0.6 + 0.4 * k);
      tr.localScale = new V3(sc, sc, 1);
      b.Sr.color = b.Color.withAlpha(k);
    }
  }

  // ------------------------------------------------------------------ HUD updates & end of level

  private UpdateHud(dt: number) {
    const board = this.board;
    const Set = CandyNovaGame.Set;
    Set(this.levelHudText, "LEVEL " + this.level);
    Set(this.realmHudText, `${this.realm.Name}   ·   ${this.realm.Subtitle}`);
    Set(this.gemCountText, Fmt.n(this.Gems));

    this.gemBadgePop = Mathf.moveTowards(this.gemBadgePop, 0, dt * 3.8);
    const gs = 1 + 0.15 * Ease.outCubic(this.gemBadgePop);
    this.gemBadge.localScale = new V3(gs, gs, 1);

    // Moves Left counter (pulses urgently when <= 5)
    Set(this.movesCountText, String(board.MovesLeft));
    if (board.MovesLeft <= 5 && this.turnState !== TurnState.VictoryBonus) {
      this.movesWarnPulse += dt * 7;
      const mp = 1 + 0.12 * Math.abs(Math.sin(this.movesWarnPulse));
      this.movesBadge.localScale = new V3(mp, mp, 1);
      this.movesCountText.color = Color.lerp(CandyArt.Plum, Pal.Danger, 0.55 + 0.45 * Math.sin(this.movesWarnPulse));
      this.movesLabelText.color = Pal.Danger;
      this.Back.setDanger(Mathf.inverseLerp(5, 0, board.MovesLeft) * 0.45);
    } else {
      this.movesBadge.localScale = V3.one;
      this.movesCountText.color = CandyArt.Plum;
      this.movesLabelText.color = CandyArt.Sky;
      this.Back.setDanger(0);
    }

    // Score & 3-Star progress bar
    this.shownScore = Mathf.moveTowards(this.shownScore, board.Score, Math.max(45, (board.Score - this.shownScore) * 9) * dt);
    Set(this.scoreHudText, `SCORE  ${Fmt.n(Mathf.roundToInt(this.shownScore))}`);
    UIKit.setMeter(this.scoreMeterFill, this.shownScore / Math.max(1, board.Star3));

    const currentStars = board.Score >= board.Star3 ? 3 : board.Score >= board.Star2 ? 2 : board.Score >= board.Star1 ? 1 : 0;
    if (currentStars > this.earnedStarsLastCheck) {
      for (let s = this.earnedStarsLastCheck; s < currentStars; s++) this.hudStarPop[s] = 1;
      this.earnedStarsLastCheck = currentStars;
      Sfx.play(Snd.Coin, 0.7, 1.1 + currentStars * 0.12);
    }
    for (let i = 0; i < 3; i++) {
      this.hudStarPop[i] = Mathf.moveTowards(this.hudStarPop[i], 0, dt * 3.5);
      const sp = 1 + 0.35 * Ease.outCubic(this.hudStarPop[i]);
      this.hudStars[i].rectTransform.localScale = new V3(sp, sp, 1);
      this.hudStars[i].color = i < currentStars ? Gold : new Color(1, 1, 1, 0.55);
    }

    // Objective progress pills
    for (let i = 0; i < Math.min(2, board.Objectives.length); i++) {
      this.objCardPop[i] = Mathf.moveTowards(this.objCardPop[i], 0, dt * 4);
      const op = 1 + 0.14 * Ease.outCubic(this.objCardPop[i]);
      this.objCards[i].localScale = new V3(op, op, 1);

      const obj = board.Objectives[i];
      if (obj.Completed) {
        Set(this.objTexts[i], "DONE ★");
        this.objTexts[i].color = CandyArt.Leaf;
      } else if (obj.Kind === ObjectiveKind.Score) {
        Set(this.objTexts[i], `${Fmt.n(obj.Current)}/${Fmt.n(obj.Target)}`);
        this.objTexts[i].color = CandyArt.Plum;
      } else {
        Set(this.objTexts[i], `${obj.Remaining} LEFT`);
        this.objTexts[i].color = CandyArt.Plum;
      }
    }

    // Booster buttons
    const canAct = this.turnState === TurnState.Idle;
    this.UpdateBoosterButton(this.hammerButton, this.hammerMode, `HAMMER · ${HammerCost}`, "CANCEL HAMMER", HammerCost, canAct);
    this.UpdateBoosterButton(this.novaButton, this.novaWandMode, `NOVA · ${NovaWandCost}`, "CANCEL NOVA", NovaWandCost, canAct);
    this.UpdateBoosterButton(this.shuffleButton, false, `SHUFFLE · ${ShuffleCost}`, "", ShuffleCost, canAct);
  }

  private UpdateBoosterButton(btn: ArcadeButton, modeOn: boolean, normalText: string, cancelText: string, cost: number, canAct: boolean) {
    if (modeOn) CandyNovaGame.SetButton(btn, cancelText, canAct);
    else if (this.Gems >= cost) CandyNovaGame.SetButton(btn, normalText, canAct);
    else if (AdService.rewardedAvailable) CandyNovaGame.SetButton(btn, "+150 GEMS (AD)", canAct);
    else CandyNovaGame.SetButton(btn, normalText, false);
  }

  private static Set(t: Text | null, s: string) {
    if (t && t.text !== s) t.text = s;
  }

  private static SetButton(b: ArcadeButton | null, label: string, enabled: boolean) {
    if (!b) return;
    CandyNovaGame.Set(b.label, label);
    if (b.interactable !== enabled) b.interactable = enabled;
  }

  private CompleteLevel() {
    const board = this.board;
    const level = this.level;
    this.CancelSelectionAndModes();
    const stars = board.EarnedStars;
    const prevStars = this.Data.get("s" + level);
    if (stars > prevStars) {
      this.Data.set("s" + level, stars);
      this.Data.add("stars", stars - prevStars);
    }

    const newBest = this.Data.max("bestScore", board.Score);
    const gemReward = 30 + stars * 15;
    this.Gems += gemReward;

    this.Data.set("level", level + 1);
    this.Data.max("bestLevel", level + 1);

    for (let i = 0; i < CellCount; i++) {
      if (!board.Hole[i]) {
        const c = CandyPalette[1 + (i % Match3Board.MaxColors)];
        this.Fx.burst(this.CellWorldPos(i % N, Math.trunc(i / N)), c, 6, 5.2, 0.22, 0.75);
      }
    }
    this.Fx.kick(1.1, 0.16);
    this.Fx.shake(0.14);
    Fx.haptic(true);
    Sfx.play(Snd.Win);
    this.skyFlash = 0.5;
    this.SweetShower(170);

    this.Finish(new Result({
      Headline: `LEVEL ${level} COMPLETE!`,
      HeadlineColor: Gold,
      Stars: stars,
      Value: Fmt.n(board.Score),
      NewBest: newBest,
      BestLine: `${this.realm.Name}   ·   +${gemReward} GEMS EARNED`,
      Stats: [
        ["SCORE", Fmt.n(board.Score)],
        ["BEST COMBO", "x" + this.bestComboThisRun],
        ["SPECIALS", String(this.specialsTriggeredThisRun)],
        ["TOTAL GEMS", Fmt.n(this.Gems)],
      ],
      Primary: "NEXT LEVEL",
      Victory: true,
      Reward: () => {
        this.Gems += 120;
        this.gemBadgePop = 1;
        Sfx.play(Snd.Coin, 0.85, 1.15);
      },
      RewardLabel: "+120 BONUS GEMS (WATCH AD)",
    }));
  }

  private FailLevel() {
    const board = this.board;
    this.CancelSelectionAndModes();
    Sfx.play(Snd.Lose);

    this.Finish(new Result({
      Headline: "OUT OF MOVES",
      HeadlineColor: Pink,
      Value: Fmt.n(board.Score),
      CountTo: board.Score,
      BestLine: `LEVEL ${this.level}   ·   ${this.realm.Name}`,
      Stats: [
        ["SCORE", Fmt.n(board.Score)],
        ["BEST COMBO", "x" + this.bestComboThisRun],
        ["SPECIALS", String(this.specialsTriggeredThisRun)],
        ["GEMS", Fmt.n(this.Gems)],
      ],
      Primary: "TRY AGAIN",
      Victory: false,
      Reward: this.revived ? null : () => this.ContinueWithExtraMoves(),
      RewardLabel: "+5 MOVES & NOVA BOMB (AD)",
    }));
  }

  private ContinueWithExtraMoves() {
    const board = this.board;
    this.revived = true;
    board.MovesLeft = 5;
    this.turnState = TurnState.Idle;

    // Gift one Nova Color Bomb on a random playable candy to help the player finish strong!
    for (let attempt = 0; attempt < 25; attempt++) {
      const rx = this.rng.next(N), ry = this.rng.next(N);
      if (board.UpgradeToNova(rx, ry)) {
        const idx = Match3Board.Index(rx, ry);
        this.candies[idx].Pop = 1.5;
        const wp = this.CellWorldPos(rx, ry);
        this.Fx.burst(wp, Gold, 26, 5.2, 0.24, 0.6);
        this.SpawnSweets(wp, Gold, 24, 6.5);
        this.Fx.ring(wp, Pink, 0.25, 2.2, 0.4);
        break;
      }
    }

    this.Revive();
    Sfx.play(Snd.PowerUp, 0.9);
    this.UI.Announce("+5 MOVES & NOVA!", Gold, 1.3);
  }
}
