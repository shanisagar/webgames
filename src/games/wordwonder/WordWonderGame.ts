import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, Color, Ease, Fmt, Fx, GameInfo, GameObject, howTo, Keyboard,
  LineRenderer, Material, Mathf, Mouse, Pal, Phase, Quaternion, Random, Result, Screen, Sfx, Snd, Sprite, SpriteRenderer, SysRandom,
  Text, TextAnchor, TextMesh, Time, Touchscreen, TouchScheme, UIKit, UINode, V2, V3, overUI,
} from "../../kit";
import { CrosswordGenerator, CrosswordPuzzle, PlacedWord, RevealedCell, WonderInfo } from "./Crossword";

/**
 * WORD WONDER — a colorful, animation-rich crossword & word-wheel puzzle inspired by Words of Wonders.
 * Swipe across tactile 3D letter medallions on the wheel to connect them with a glowing multi-layered energy ribbon
 * and fill every word in the crossword grid. Discover extra valid words to earn Bonus Gems, spend Gems on the Bulb
 * Hint or Hammer, and journey across animated World Wonders. (Port of WordWonderGame.cs.)
 */

const TopBand = 270, BottomBand = 220;
const MaxCells = 84;
const MaxWheel = 8;
const HintCost = 100;
const HammerCost = 200;
const StartingGems = 250;
const SkyStarCount = 28;
const TraceBeadCount = 10;

const Gold = Pal.hex(0xffc94d);
const HotGold = Pal.hex(0xffe066);
const Emerald = Pal.hex(0x2ee88a);
const Coral = Pal.hex(0xff5e8e);
const Magenta = Pal.hex(0xff38b8);
const Sky = Pal.hex(0x38e8ff);
const Violet = Pal.hex(0x9d6bff);
const Pearl = Pal.hex(0xfffbf2);
const TileDarkText = Pal.hex(0x1d1238);

// Vibrant jewel palette cycled across words & connected letters so the board and wheel burst with color
const WordJewelColors = [
  Pal.hex(0xffb830), // Radiant Amber Gold
  Pal.hex(0x2ed8ff), // Electric Sky Cyan
  Pal.hex(0xff5c8d), // Sunset Coral Rose
  Pal.hex(0x2ee88a), // Emerald Mint
  Pal.hex(0xa86bff), // Royal Amethyst
  Pal.hex(0xff7b38), // Vivid Tangerine
];

class CellView {
  Root!: GameObject;
  Shadow!: SpriteRenderer; Base!: SpriteRenderer; Inner!: SpriteRenderer; Edge!: SpriteRenderer; Glow!: SpriteRenderer;
  GemIcon!: SpriteRenderer; Shine!: SpriteRenderer;
  /** TextMesh is its own renderer in the kit (C# keeps the MeshRenderer separately). */
  Letter!: TextMesh;
  WorldPos = V2.zero;
  GridX = 0; GridY = 0;
  ColorIndex = 0;
  Active = false;
  Pop = 0; RevealAnim = 0; Highlight = 0; Shake = 0; SpawnAnim = 0;
}

class WheelNodeView {
  Root!: GameObject;
  Shadow!: SpriteRenderer; Halo!: SpriteRenderer; Disc!: SpriteRenderer; Inner!: SpriteRenderer; Ring!: SpriteRenderer;
  Letter!: TextMesh;
  Angle = 0; TargetAngle = 0;
  Pop = 0; SelectT = 0;
  Char = "";
  Active = false;
}

class FlyingOrb {
  Disc!: SpriteRenderer; Glow!: SpriteRenderer; Core!: SpriteRenderer;
  From = V2.zero; To = V2.zero;
  TargetCellIndex = 0;
  T = 0; Duration = 0; TrailTimer = 0;
  Color = Color.white;
  Active = false;
}

class SkyStar {
  Tr!: GameObject;
  Sr!: SpriteRenderer;
  BasePos = V2.zero;
  Phase = 0; Speed = 0; BaseScale = 0; Drift = 0;
  BaseColor = Color.white;
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

// ------------------------------------------------------------------ procedural icons

function SegmentDist(p: V2, a: V2, b: V2) {
  const ab = b.sub(a);
  const t = Mathf.clamp01(V2.dot(p.sub(a), ab) / Math.max(1e-6, ab.sqrMagnitude));
  return p.sub(a.add(ab.mul(t))).magnitude;
}

const ShuffleSprite = () => Art.shape("ww-shuffle", (p) => {
  const d1 = SegmentDist(p, new V2(-0.6, 0.35), new V2(0.45, -0.35)) - 0.1;
  const d2 = SegmentDist(p, new V2(-0.6, -0.35), new V2(0.45, 0.35)) - 0.1;
  const head1 = Art.poly(p, new V2(0.72, 0.35), new V2(0.28, 0.65), new V2(0.28, 0.05));
  const head2 = Art.poly(p, new V2(0.72, -0.35), new V2(0.28, -0.05), new V2(0.28, -0.65));
  return Math.max(Math.max(Art.edge(-d1), Art.edge(-d2)), Math.max(head1, head2));
});

const BulbSprite = () => Art.shape("ww-bulb", (p) => {
  const bulb = 0.52 - p.sub(new V2(0, 0.18)).magnitude;
  const neck = -Art.roundBox(p.sub(new V2(0, -0.38)), 0.24, 0.08);
  const baseCap = -Art.roundBox(p.sub(new V2(0, -0.62)), 0.18, 0.06);
  return Art.edge(Math.max(bulb, Math.max(neck, baseCap)));
});

const HammerSprite = () => Art.shape("ww-hammer", (p) => {
  const r = new V2((p.x + p.y) * 0.7071, (p.y - p.x) * 0.7071);
  const handle = -Art.roundBox(new V2(r.x * 2.2, (r.y + 0.22) * 1.1), 0.18, 0.06);
  const head = -Art.roundBox(new V2(r.x * 0.95, (r.y - 0.38) * 1.8), 0.48, 0.12);
  return Art.edge(Math.max(handle, head));
});

function MakeLetter(parent: GameObject, name: string, text: string, fontSize: number, characterSize: number, color: Color, order: number) {
  const tm = new GameObject(name, parent).addComponent(new TextMesh());
  tm.text = text;
  tm.fontSize = fontSize;
  tm.characterSize = characterSize;
  tm.anchor = "MiddleCenter";
  tm.fontStyle = "bold";
  tm.color = color;
  tm.sortingOrder = order;
  return tm;
}

export class WordWonderGame extends ArcadeGame {
  private world!: GameObject; private boardRoot!: GameObject; private wheelRoot!: GameObject; private monumentRoot!: GameObject; private previewRoot!: GameObject;
  private boardFrameShadow!: SpriteRenderer; private boardFrameBg!: SpriteRenderer; private boardFrameRim!: SpriteRenderer; private boardFrameGlow!: SpriteRenderer;
  wheelBg!: SpriteRenderer; wheelInnerDisc!: SpriteRenderer; private wheelRim!: SpriteRenderer; private wheelOuterRing!: SpriteRenderer;
  private wheelInnerGlow!: SpriteRenderer; private wheelCompass!: SpriteRenderer;
  private shuffleIconA!: SpriteRenderer; private shuffleIconB!: SpriteRenderer; private previewBg!: SpriteRenderer; private previewEdge!: SpriteRenderer; private previewGlow!: SpriteRenderer;
  private wonderSun!: SpriteRenderer; private wonderSunHalo!: SpriteRenderer; private cursorHalo!: SpriteRenderer; private cursorRing!: SpriteRenderer;
  private previewLabel!: TextMesh;

  // Multi-layer high-visibility trace lines + animated energy beads
  private traceOutlineLine!: LineRenderer; private traceColorLine!: LineRenderer; private traceCoreLine!: LineRenderer; private horizonLine!: LineRenderer;
  private crispLineMat!: Material;
  private readonly traceBeads: SpriteRenderer[] = [];
  private readonly monumentLines: LineRenderer[] = [];
  private readonly skyStars: SkyStar[] = [];

  private readonly cellPool: CellView[] = [];
  private readonly wheelNodes: WheelNodeView[] = [];
  private readonly flyingOrbs: FlyingOrb[] = [];
  private readonly chain: number[] = [];
  private readonly revealedScratch: RevealedCell[] = [];

  private noteClip!: AudioClip; private wordSolveClip!: AudioClip; private bonusClip!: AudioClip; private hammerClip!: AudioClip; private shuffleClip!: AudioClip;
  private rng = new SysRandom();

  private puzzle: CrosswordPuzzle | null = null;
  private wonder: WonderInfo = CrosswordGenerator.Wonders[0];
  private level = 0; private streak = 0; private bestStreak = 0; private hintsUsed = 0; private wordsSolvedThisRun = 0; private bonusFoundThisRun = 0;
  private landscape = false; private tracing = false; private hammerMode = false; private ended = false;
  private pointerWorld = V2.zero; private boardCenter = V2.zero; private wheelCenter = V2.zero; private previewPos = V2.zero; private need = new V2(10, 10);
  private wheelRadius = 2.15; private cellSize = 0.85; private shuffleSpin = 0; private previewShake = 0; private previewAlpha = 0; private previewFlash = 0; private previewPop = 0;
  private previewFlashColor = Color.white;
  private endTimer = -1; private idleTimer = 0; private trailEmitTimer = 0;

  // Demo attract mode state
  private demoWordIdx = 0; private demoCharIdx = 0;
  private demoTimer = 0;

  // HUD elements
  private levelText!: Text; private wonderText!: Text; private gemCountText!: Text; private streakHudText!: Text;
  private hammerButton!: ArcadeButton; private hintButton!: ArcadeButton; private shuffleHudButton!: ArcadeButton; private bonusButton!: ArcadeButton;
  private gemBadge!: UINode;
  private gemBadgePop = 0;

  protected Describe() {
    return new GameInfo({
      Id: "wordwonder",
      Title: "WORD WONDER",
      Tagline: "CONNECT LETTERS. UNLOCK THE WONDERS.",
      Accent: Gold,
      Accent2: Sky,
      BgTop: Pal.hex(0x431c68),
      BgBottom: Pal.hex(0x14082e),
      GridSpacing: 1.25,
      ShortSide: 9.6,
      Touch: TouchScheme.None,
      Music: { bpm: 98, rootHz: 110, degrees: [0, 4, 5, 3], seed: 42, energy: 0.45, major: true },
      Reminders: [
        "A new Wonder awaits|Swipe the wheel and uncover the next monument.",
        "Daily brain workout|Can you find all the hidden bonus words today?",
        "Your gems are sparkling|Use a hint or hammer to finish your crossword!",
      ],
      HowTo: [
        howTo(Art.Ring, Gold, "Drag across letters on the wheel to connect them into a word."),
        howTo(Art.RoundSquare, Sky, "Fill every word in the crossword grid to complete the level."),
        howTo(Art.Plus, Coral, "Tap the center arrows (or press SPACE) to shuffle the wheel letters."),
        howTo(Art.Diamond, Emerald, "Valid words not on the board count as BONUS WORDS and award Gems!"),
        howTo(Art.Star, Gold, "Spend Gems on HINT (100) for a random letter or HAMMER (200) to pick any tile."),
        howTo(Art.Chevron, Pal.Good, "Chain correct words without a miss to build a Gem-multiplying STREAK!"),
      ],
      Tips: [
        "Shuffling the wheel often makes hidden words jump right out.",
        "Look at intersecting letters on the grid to narrow down possibilities.",
        "Find short 3-letter bonus words early to stock up on extra Gems.",
        "Use the Hammer on an intersection cell to unlock two words at once!",
      ],
    });
  }

  protected get ShortSide() { return WordWonderGame.FitShortSide(this.need, TopBand, BottomBand); }

  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }

  private get Gems() { return this.Data.get("gems", StartingGems); }
  private set Gems(v: number) { this.Data.set("gems", Math.max(0, v)); }

  protected BestLine() {
    const lv = this.CurrentLevel;
    const w = CrosswordGenerator.WonderForLevel(lv);
    return `LEVEL ${lv}   ·   ${w.Name}`;
  }

  protected StatsLine() {
    const done = this.CurrentLevel - 1;
    return done > 0
      ? `${this.Data.get("stars")} STARS   ·   ${this.Gems} GEMS   ·   ${this.Data.get("bonusTotal")} BONUS WORDS`
      : "SWIPE LETTERS   ·   SOLVE CROSSWORDS   ·   EXPLORE WONDERS";
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("initGems", 0) === 0) {
      this.Data.set("initGems", 1);
      this.Data.set("gems", StartingGems);
    }

    // Non-additive, full-saturation line material so lines never wash out to white!
    this.crispLineMat = new Material("WW CrispLine", false, 1.0, "soft");

    this.world = new GameObject("WordWonderWorld", this.gameObject);

    this.BuildMonumentLayer();
    this.BuildBoardLayer();
    this.BuildWheelLayer();
    this.BuildPreviewLayer();
    this.BuildOrbsPool();
    this.BuildAudio();
    this.BuildHud();
  }

  private BuildMonumentLayer() {
    this.monumentRoot = new GameObject("Monument", this.world);

    // Glowing setting sun / moon behind the Wonder silhouette
    this.wonderSunHalo = Art.spr(this.monumentRoot, "WonderSunHalo", Art.Glow, Gold.withAlpha(0.28), 9.5, -18, Art.Additive);
    this.wonderSunHalo.transform.localPosition = new V3(0, -0.5, 0);
    this.wonderSun = Art.spr(this.monumentRoot, "WonderSun", Art.Disc, Coral.withAlpha(0.22), 4.2, -17, Art.Flat);
    this.wonderSun.transform.localPosition = new V3(0, -0.8, 0);

    // Twinkling sky stars & floating fireflies
    const starRng = new SysRandom(77);
    const starCols = [Gold, Sky, Coral, Emerald, Violet, Color.white];
    for (let i = 0; i < SkyStarCount; i++) {
      const isDiamond = i % 3 === 0;
      const sc = starCols[i % starCols.length];
      const sr = Art.spr(this.monumentRoot, "SkyStar_" + i, isDiamond ? Art.Star : Art.Disc, sc.withAlpha(0.55), 0.14, -16, Art.Additive);
      const star = new SkyStar();
      star.Tr = sr.transform;
      star.Sr = sr;
      star.BasePos = new V2(starRng.nextDouble() * 18.0 - 9.0, starRng.nextDouble() * 11.0 - 4.5);
      star.Phase = starRng.nextDouble() * Math.PI * 2.0;
      star.Speed = 1.4 + starRng.nextDouble() * 2.4;
      star.BaseScale = (isDiamond ? 0.22 : 0.11) + starRng.nextDouble() * 0.14;
      star.Drift = 0.15 + starRng.nextDouble() * 0.25;
      star.BaseColor = sc;
      star.Tr.localPosition = star.BasePos;
      this.skyStars.push(star);
    }

    this.horizonLine = Art.line(this.monumentRoot, "Horizon", Gold.withAlpha(0.35), 0.06, -15, false, false, this.crispLineMat);
    for (let i = 0; i < 8; i++) {
      const lr = Art.line(this.monumentRoot, "Silhouette " + i, Gold.withAlpha(0.32), 0.07, -14, false, false, this.crispLineMat);
      this.monumentLines.push(lr);
    }
  }

  private BuildBoardLayer() {
    this.boardRoot = new GameObject("Board", this.world);

    // Ornate framed backdrop behind the crossword grid
    this.boardFrameGlow = Art.spr(this.boardRoot, "BoardGlow", Art.Glow, Gold.withAlpha(0.22), 6, -3, Art.Additive);
    this.boardFrameShadow = Art.spr(this.boardRoot, "BoardShadow", Art.RoundSquare, new Color(0.03, 0.01, 0.08, 0.52), 1, -2, Art.Flat);
    this.boardFrameBg = Art.spr(this.boardRoot, "BoardFrameBg", Art.RoundSquare, Pal.hex(0x1c1036).withAlpha(0.76), 1, -1, Art.Flat);
    this.boardFrameRim = Art.spr(this.boardRoot, "BoardFrameRim", Art.RoundSquare, Gold.withAlpha(0.45), 1, 0, Art.Flat);

    for (let i = 0; i < MaxCells; i++) {
      const cv = new CellView();
      cv.Root = new GameObject("Cell " + i, this.boardRoot);
      cv.Shadow = Art.spr(cv.Root, "Shadow", Art.RoundSquare, new Color(0.04, 0.01, 0.1, 0.55), 0.94, 1, Art.Flat);
      cv.Shadow.transform.localPosition = new V3(0.045, -0.065, 0);
      cv.Glow = Art.spr(cv.Root, "Glow", Art.Glow, Color.clear, 1.65, 1, Art.Additive);
      cv.Edge = Art.spr(cv.Root, "Edge", Art.RoundSquare, Gold, 0.95, 2, Art.Flat);
      cv.Base = Art.spr(cv.Root, "Base", Art.RoundSquare, Pearl, 0.89, 3, Art.Flat);
      cv.Inner = Art.spr(cv.Root, "Inner", Art.RoundSquare, Color.white.withAlpha(0.4), 0.77, 4, Art.Flat);
      cv.Shine = Art.spr(cv.Root, "Shine", Art.RoundSquare, Color.white.withAlpha(0.25), 0.34, 5, Art.Flat);
      cv.Shine.transform.localPosition = new V3(-0.18, 0.18, 0);

      cv.GemIcon = Art.spr(cv.Root, "Gem", Art.Diamond, Emerald, 0.38, 6, Art.Flat);
      cv.GemIcon.transform.localPosition = new V3(0.22, 0.22, 0);

      cv.Letter = MakeLetter(cv.Root, "Char", "", 74, 0.076, TileDarkText, 6);

      cv.Root.setActive(false);
      this.cellPool.push(cv);
    }
  }

  private BuildWheelLayer() {
    this.wheelRoot = new GameObject("Wheel", this.world);

    // Rich jewel-toned royal wheel platter so colored connector lines & glowing orbs pop with maximum contrast!
    this.wheelInnerGlow = Art.spr(this.wheelRoot, "WheelHalo", Art.Glow, Gold.withAlpha(0.38), 6.2, 7, Art.Additive);
    this.wheelOuterRing = Art.spr(this.wheelRoot, "WheelOuterRing", Art.Octagon, Gold.withAlpha(0.28), 4.88, 8, Art.Flat);
    this.wheelBg = Art.spr(this.wheelRoot, "WheelDisc", Art.Disc, Pal.hex(0x211342).withAlpha(0.95), 4.65, 9, Art.Flat);
    this.wheelInnerDisc = Art.spr(this.wheelRoot, "WheelInnerDisc", Art.Disc, Pal.hex(0x2e1b59).withAlpha(0.92), 4.15, 10, Art.Flat);
    this.wheelRim = Art.spr(this.wheelRoot, "WheelRim", Art.Ring, Gold.withAlpha(0.88), 4.68, 11, Art.Flat);
    this.wheelCompass = Art.spr(this.wheelRoot, "WheelCompass", Art.Star, Sky.withAlpha(0.18), 3.65, 11, Art.Additive);

    // Flanking Hammer (left) & Bulb (right) badges around the top of the wheel
    this.CreateWheelHelperBadge(new V2(-2.55, 1.55), HammerSprite(), "200", Coral);
    this.CreateWheelHelperBadge(new V2(2.55, 1.55), BulbSprite(), "100", Gold);

    // Center Shuffle button with colorful ring
    this.shuffleIconA = Art.spr(this.wheelRoot, "ShuffleBtnBg", Art.Disc, Pal.hex(0x3b2370), 1.12, 12, Art.Flat);
    Art.spr(this.wheelRoot, "ShuffleBtnRim", Art.Ring, Sky.withAlpha(0.85), 1.15, 13, Art.Flat);
    this.shuffleIconB = Art.spr(this.wheelRoot, "ShuffleIcon", ShuffleSprite(), Gold, 0.72, 14, Art.Flat);

    // 3-layer high-contrast connector ribbon (sorted above the dark wheel platter 9..11, and beneath letter medallions 18..21):
    // 1) Deep dark magenta/indigo casing so it stands out over light medallions AND dark platter
    this.traceOutlineLine = Art.line(this.world, "TraceOutline", Pal.hex(0x160830), 0.36, 15, false, true, this.crispLineMat);
    this.traceOutlineLine.numCapVertices = 8;
    this.traceOutlineLine.numCornerVertices = 8;
    this.traceOutlineLine.gameObject.setActive(false);

    // 2) Saturated vibrant gradient ribbon (Coral/Magenta -> Gold -> Electric Cyan) using non-additive crispLineMat
    this.traceColorLine = Art.line(this.world, "TraceColor", Coral, 0.24, 16, false, true, this.crispLineMat);
    this.traceColorLine.numCapVertices = 8;
    this.traceColorLine.numCornerVertices = 8;
    this.traceColorLine.gameObject.setActive(false);

    // 3) Inner bright golden/cyan energy core
    this.traceCoreLine = Art.line(this.world, "TraceCore", HotGold, 0.1, 17, false, true, this.crispLineMat);
    this.traceCoreLine.numCapVertices = 6;
    this.traceCoreLine.numCornerVertices = 6;
    this.traceCoreLine.gameObject.setActive(false);

    // Animated energy beads that race along the connected path
    for (let i = 0; i < TraceBeadCount; i++) {
      const bead = Art.spr(this.world, "TraceBead_" + i, Art.Disc, HotGold, 0.18, 17, Art.Flat);
      bead.gameObject.setActive(false);
      this.traceBeads.push(bead);
    }

    // Live pointer/finger cursor ring while dragging
    this.cursorHalo = Art.spr(this.world, "CursorHalo", Art.Glow, Coral.withAlpha(0.55), 1.15, 22, Art.Additive);
    this.cursorRing = Art.spr(this.world, "CursorRing", Art.Ring, HotGold, 0.58, 23, Art.Flat);
    this.cursorHalo.gameObject.setActive(false);
    this.cursorRing.gameObject.setActive(false);

    // Tactile 3D letter medallions around the wheel
    for (let i = 0; i < MaxWheel; i++) {
      const wn = new WheelNodeView();
      wn.Root = new GameObject("WheelNode " + i, this.wheelRoot);
      wn.Shadow = Art.spr(wn.Root, "Shadow", Art.Disc, new Color(0.03, 0.01, 0.08, 0.55), 1.16, 14, Art.Flat);
      wn.Shadow.transform.localPosition = new V3(0.04, -0.06, 0);
      wn.Halo = Art.spr(wn.Root, "Halo", Art.Glow, Color.clear, 1.85, 14, Art.Additive);
      wn.Ring = Art.spr(wn.Root, "Ring", Art.Disc, Gold, 1.16, 18, Art.Flat);
      wn.Disc = Art.spr(wn.Root, "Disc", Art.Disc, Pearl, 1.04, 19, Art.Flat);
      wn.Inner = Art.spr(wn.Root, "Inner", Art.Ring, Color.white.withAlpha(0.5), 0.92, 20, Art.Flat);
      wn.Letter = MakeLetter(wn.Root, "Letter", "A", 84, 0.084, TileDarkText, 21);

      wn.Root.setActive(false);
      this.wheelNodes.push(wn);
    }
  }

  private CreateWheelHelperBadge(localPos: V2, iconSprite: Sprite, priceText: string, rimAccent: Color) {
    const root = new GameObject("WheelBadge_" + priceText, this.wheelRoot);
    root.localPosition = new V3(localPos.x, localPos.y, 0);

    Art.spr(root, "Glow", Art.Glow, rimAccent.withAlpha(0.28), 1.55, 8, Art.Additive);
    Art.spr(root, "Shadow", Art.Disc, new Color(0, 0, 0.05, 0.45), 1.12, 9, Art.Flat).transform.localPosition = new V3(0.03, -0.05, 0);
    Art.spr(root, "Bg", Art.Disc, Pal.hex(0x28184e), 1.04, 10, Art.Flat);
    Art.spr(root, "Rim", Art.Ring, rimAccent, 1.08, 11, Art.Flat);

    const ico = Art.spr(root, "Icon", iconSprite, rimAccent, 0.48, 12, Art.Flat);
    ico.transform.localPosition = new V3(0, 0.14, 0);

    const gem = Art.spr(root, "Gem", Art.Diamond, Emerald, 0.22, 12, Art.Flat);
    gem.transform.localPosition = new V3(-0.22, -0.22, 0);

    const tm = MakeLetter(root, "Price", priceText, 42, 0.048, Color.white, 12);
    tm.transform.localPosition = new V3(0.08, -0.22, 0);
  }

  private BuildPreviewLayer() {
    this.previewRoot = new GameObject("WordPreview", this.world);
    this.previewGlow = Art.spr(this.previewRoot, "Glow", Art.Glow, Gold.withAlpha(0.35), 2.4, 24, Art.Additive);
    this.previewEdge = Art.spr(this.previewRoot, "Edge", Art.RoundSquare, Gold, 1, 25, Art.Flat);
    this.previewBg = Art.spr(this.previewRoot, "Bg", Art.RoundSquare, Pal.hex(0x24134a), 1, 26, Art.Flat);
    this.previewLabel = MakeLetter(this.previewRoot, "PreviewText", "", 72, 0.072, Color.white, 27);
    this.previewRoot.setActive(false);
  }

  private BuildOrbsPool() {
    for (let i = 0; i < 18; i++) {
      const orb = new FlyingOrb();
      orb.Glow = Art.spr(this.world, "OrbGlow", Art.Glow, Gold, 1.35, 29, Art.Additive);
      orb.Disc = Art.spr(this.world, "OrbDisc", Art.Disc, Coral, 0.44, 30, Art.Flat);
      orb.Core = Art.spr(this.world, "OrbCore", Art.Star, Color.white, 0.28, 31, Art.Flat);
      orb.Disc.gameObject.setActive(false);
      orb.Glow.gameObject.setActive(false);
      orb.Core.gameObject.setActive(false);
      this.flyingOrbs.push(orb);
    }
  }

  private BuildAudio() {
    this.noteClip = Sfx.make("ww-note", 0.22, (t) =>
      (Sfx.sinP(523.25 * t) * 0.7 + Sfx.triP(1046.5 * t) * 0.25) * Sfx.env(t, 0.003, 0.16) * 0.26);

    this.wordSolveClip = Sfx.make("ww-solve", 0.55, (t) => {
      const f = t < 0.1 ? 523.25 : t < 0.2 ? 659.25 : t < 0.3 ? 783.99 : 1046.5;
      const lt = t % 0.1;
      return (Sfx.sinP(f * t) + 0.35 * Sfx.triP(f * 2 * t)) * Sfx.env(lt, 0.003, 0.18) * 0.2;
    });

    this.bonusClip = Sfx.make("ww-bonus", 0.42, (t) => {
      const f = t < 0.12 ? 587.33 : t < 0.24 ? 880 : 1174.66;
      return (Sfx.sinP(f * t) + 0.3 * Sfx.sinP(f * 1.5 * t)) * Sfx.env(t, 0.004, 0.32) * 0.22;
    });

    const noise = new SysRandom(19);
    this.hammerClip = Sfx.make("ww-hammer", 0.32, (t) =>
      Sfx.sinP(Sfx.glide(t, 280, 65, 0.22)) * Sfx.env(t, 0.001, 0.22) * 0.5
      + (noise.nextDouble() * 2 - 1) * Sfx.env(t, 0.001, 0.05) * 0.35);

    this.shuffleClip = Sfx.make("ww-shuffle", 0.18, (t) =>
      Sfx.sinP(Sfx.glide(t, 420, 940, 0.15)) * Sfx.env(t, 0.002, 0.13) * 0.22);
  }

  private BuildHud() {
    const hud = this.UI.Hud;

    this.gemBadge = UIKit.node("GemBadge", hud).place(new V2(0, 1), new V2(185, -85), new V2(260, 88));
    UIKit.img(this.gemBadge, "Bg", Art.UiRound, Pal.Panel.withAlpha(0.88)).rectTransform.stretch();
    UIKit.img(this.gemBadge, "Edge", Art.UiOutline, Emerald.withAlpha(0.85)).rectTransform.stretch();
    const gemIcon = UIKit.img(this.gemBadge, "Diamond", Art.Diamond, Emerald);
    gemIcon.rectTransform.place(new V2(0, 0.5), new V2(48, 0), new V2(54, 54));
    this.gemCountText = UIKit.at(UIKit.label(this.gemBadge, "250", 40, Color.white, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(165, 0), new V2(160, 64));

    this.levelText = UIKit.at(UIKit.label(hud, "LEVEL 1", 58, Pal.Text), new V2(0.5, 1), new V2(0, -68), new V2(640, 76));
    UIKit.glow(this.levelText, Gold.withAlpha(0.55), 3);
    this.wonderText = UIKit.at(UIKit.label(hud, "", 28, Gold), new V2(0.5, 1), new V2(0, -124), new V2(740, 40));
    this.streakHudText = UIKit.at(UIKit.label(hud, "", 28, Emerald), new V2(0.5, 1), new V2(0, -166), new V2(700, 38));

    this.hammerButton = UIKit.buttonAt(hud, "HAMMER · 200", new V2(0.5, 0), new V2(-325, 115), new V2(290, 110),
      false, () => this.OnHammerButton(), 28, HammerSprite());
    this.shuffleHudButton = UIKit.buttonAt(hud, "SHUFFLE", new V2(0.5, 0), new V2(0, 115), new V2(240, 110),
      false, () => this.ShuffleWheel(false), 28, ShuffleSprite());
    this.hintButton = UIKit.buttonAt(hud, "HINT · 100", new V2(0.5, 0), new V2(325, 115), new V2(290, 110),
      false, () => this.OnHintButton(), 28, BulbSprite());

    this.hammerButton.setAccent(Coral);
    this.shuffleHudButton.setAccent(Sky);
    this.hintButton.setAccent(Gold);

    this.bonusButton = UIKit.buttonAt(hud, "BONUS WORDS: 0", new V2(0.5, 0), new V2(0, 212), new V2(360, 58),
      false, () => this.OnBonusPillTapped(), 24);
    this.bonusButton.setAccent(Emerald);
  }

  // ------------------------------------------------------------------ layout & wonder art

  private LoadPuzzle(lv: number, _isDemo: boolean) {
    const puzzle = this.puzzle = CrosswordGenerator.Build(lv);
    this.wonder = CrosswordGenerator.WonderForLevel(lv);
    this.chain.length = 0;
    this.tracing = false;
    this.hammerMode = false;
    this.previewAlpha = 0;
    this.HideTraceVisuals();

    for (const orb of this.flyingOrbs) {
      orb.Active = false;
      orb.Disc.gameObject.setActive(false);
      orb.Glow.gameObject.setActive(false);
      orb.Core.gameObject.setActive(false);
    }

    // Configure wheel nodes with staggered entrance pop
    const wnCount = puzzle.Wheel.length;
    for (let i = 0; i < this.wheelNodes.length; i++) {
      const wn = this.wheelNodes[i];
      wn.Active = i < wnCount;
      wn.Root.setActive(wn.Active);
      if (!wn.Active) continue;
      wn.Char = puzzle.Wheel[i];
      wn.Letter.text = wn.Char;
      const a = Math.PI * 0.5 - i * ((Math.PI * 2) / wnCount);
      wn.Angle = a + 0.6;
      wn.TargetAngle = a;
      wn.Pop = 1;
      wn.SelectT = 0;
    }

    // Assign a jewel color index per word so solved words on the board are rich and colorful!
    let cellIdx = 0;
    for (let y = 0; y < puzzle.H; y++)
      for (let x = 0; x < puzzle.W; x++) {
        const ch = puzzle.Grid[puzzle.Index(x, y)];
        if (ch === "" || cellIdx >= this.cellPool.length) continue;
        const cv = this.cellPool[cellIdx++];
        cv.Active = true;
        cv.GridX = x;
        cv.GridY = y;
        cv.ColorIndex = this.FindWordColorForCell(x, y);
        cv.Letter.text = ch;
        cv.Pop = cv.RevealAnim = cv.Highlight = cv.Shake = 0;
        cv.SpawnAnim = Mathf.clamp01(1 + (x + y) * 0.08);
        cv.Root.setActive(true);
      }
    for (let i = cellIdx; i < this.cellPool.length; i++) {
      this.cellPool[i].Active = false;
      this.cellPool[i].Root.setActive(false);
    }

    this.LayoutBoardAndWheel();
    this.RebuildMonumentArt();
  }

  private FindWordColorForCell(gx: number, gy: number) {
    const puzzle = this.puzzle!;
    for (let w = 0; w < puzzle.Words.length; w++) {
      const pw = puzzle.Words[w];
      for (let i = 0; i < pw.Text.length; i++) {
        const [cx, cy] = pw.CellAt(i);
        if (cx === gx && cy === gy) return w % WordJewelColors.length;
      }
    }
    return (gx + gy) % WordJewelColors.length;
  }

  private LayoutBoardAndWheel() {
    const puzzle = this.puzzle;
    if (!puzzle) return;
    this.landscape = Screen.width > Screen.height;

    if (this.landscape) {
      this.need = new V2(14.8, 9.2);
      this.boardCenter = new V2(-3.55, 0.35);
      this.wheelCenter = new V2(3.55, -0.05);
      this.wheelRadius = 1.95;
      this.previewPos = new V2(3.55, 2.75);

      const maxBoardW = 6.2;
      const maxBoardH = 5.6;
      this.cellSize = Mathf.clamp(Math.min(maxBoardW / Math.max(1, puzzle.W), maxBoardH / Math.max(1, puzzle.H)), 0.58, 1.15);
    } else {
      this.need = new V2(8.8, 12.6);
      this.boardCenter = new V2(0, 2.65);
      this.wheelCenter = new V2(0, -2.55);
      this.wheelRadius = 1.85;
      this.previewPos = new V2(0, -0.05);

      const maxBoardW = 7.2;
      const maxBoardH = 4.4;
      this.cellSize = Mathf.clamp(Math.min(maxBoardW / Math.max(1, puzzle.W), maxBoardH / Math.max(1, puzzle.H)), 0.54, 1.06);
    }

    this.boardRoot.localPosition = this.boardCenter;
    this.wheelRoot.localPosition = this.wheelCenter;
    const wheelScale = this.wheelRadius / 1.95;
    this.wheelRoot.localScale = new V3(wheelScale, wheelScale, 1);

    // Size the ornate board frame around the active crossword cells
    const cellSize = this.cellSize;
    const bw = puzzle.W * cellSize + 0.65;
    const bh = puzzle.H * cellSize + 0.65;
    this.boardFrameShadow.transform.localPosition = new V3(0.06, -0.08, 0);
    this.boardFrameShadow.transform.localScale = new V3(bw + 0.14, bh + 0.14, 1);
    this.boardFrameBg.transform.localScale = new V3(bw, bh, 1);
    this.boardFrameRim.transform.localScale = new V3(bw + 0.1, bh + 0.1, 1);
    this.boardFrameGlow.transform.localScale = new V3(bw + 1.8, bh + 1.8, 1);

    for (let i = 0; i < this.cellPool.length; i++) {
      const cv = this.cellPool[i];
      if (!cv.Active) continue;
      const lx = (cv.GridX - (puzzle.W - 1) * 0.5) * cellSize;
      const ly = ((puzzle.H - 1) * 0.5 - cv.GridY) * cellSize;
      cv.Root.localPosition = new V3(lx, ly, 0);
      cv.Root.localScale = new V3(cellSize, cellSize, 1);
      cv.WorldPos = this.boardCenter.add(new V2(lx, ly));
    }

    this.CenterCamera();
  }

  private RebuildMonumentArt() {
    const wonder = this.wonder;
    const c1 = Pal.hex(wonder.AccentHex).withAlpha(0.35);
    const c2 = Pal.hex(wonder.Accent2Hex).withAlpha(0.28);

    this.wonderSun.color = Color.lerp(Pal.hex(wonder.AccentHex), Coral, 0.4).withAlpha(0.22);
    this.wonderSunHalo.color = Pal.hex(wonder.AccentHex).withAlpha(0.32);

    this.horizonLine.startColor = c1;
    this.horizonLine.endColor = c2;
    this.horizonLine.positionCount = 2;
    this.horizonLine.setPosition(0, new V3(-16, -3.6, 0));
    this.horizonLine.setPosition(1, new V3(16, -3.6, 0));

    for (const lr of this.monumentLines) lr.positionCount = 0;

    const t = wonder.MonumentType % 4;
    const P = (x: number, y: number) => new V2(x, y);
    if (t === 0) {
      // Great Pyramids of Giza + desert dunes
      this.SetMonumentPoly(0, c1, P(-5.5, -3.6), P(-1.8, 1.0), P(1.9, -3.6));
      this.SetMonumentPoly(1, c2, P(-1.8, 1.0), P(-0.3, -3.6));
      this.SetMonumentPoly(2, c1, P(0.5, -3.6), P(3.4, 0.0), P(6.3, -3.6));
      this.SetMonumentPoly(3, c2, P(3.4, 0.0), P(4.4, -3.6));
      this.SetMonumentPoly(4, c1, P(-7.8, -3.6), P(-6.1, -1.4), P(-4.4, -3.6));
    } else if (t === 1) {
      // Stonehenge trilithon arches
      this.SetMonumentPoly(0, c1, P(-4.4, -3.6), P(-4.4, -0.4), P(-1.5, -0.4), P(-1.5, -3.6));
      this.SetMonumentPoly(1, c2, P(-0.9, -3.6), P(-0.9, 0.4), P(1.9, 0.4), P(1.9, -3.6));
      this.SetMonumentPoly(2, c1, P(2.5, -3.6), P(2.5, -0.5), P(5.0, -0.5), P(5.0, -3.6));
    } else if (t === 2) {
      // Parthenon pediment & columns
      this.SetMonumentPoly(0, c1, P(-5.4, -0.9), P(0, 1.1), P(5.4, -0.9), P(-5.4, -0.9));
      this.SetMonumentPoly(1, c2, P(-4.6, -3.6), P(-4.6, -0.9));
      this.SetMonumentPoly(2, c2, P(-2.3, -3.6), P(-2.3, -0.9));
      this.SetMonumentPoly(3, c2, P(0, -3.6), P(0, -0.9));
      this.SetMonumentPoly(4, c2, P(2.3, -3.6), P(2.3, -0.9));
      this.SetMonumentPoly(5, c2, P(4.6, -3.6), P(4.6, -0.9));
    } else {
      // Chichen Itza / Step Pyramid
      this.SetMonumentPoly(0, c1, P(-5.0, -3.6), P(-4.1, -2.2), P(4.1, -2.2), P(5.0, -3.6));
      this.SetMonumentPoly(1, c2, P(-3.5, -2.2), P(-2.7, -0.8), P(2.7, -0.8), P(3.5, -2.2));
      this.SetMonumentPoly(2, c1, P(-1.7, -0.8), P(-1.2, 0.5), P(1.2, 0.5), P(1.7, -0.8));
      this.SetMonumentPoly(3, c2, P(-0.6, -3.6), P(-0.35, 0.5), P(0.35, 0.5), P(0.6, -3.6));
    }
  }

  private SetMonumentPoly(index: number, col: Color, ...pts: V2[]) {
    if (index >= this.monumentLines.length) return;
    const lr = this.monumentLines[index];
    lr.startColor = col;
    lr.endColor = col.withAlpha(col.a * 0.75);
    lr.positionCount = pts.length;
    for (let i = 0; i < pts.length; i++) lr.setPosition(i, new V3(pts[i].x, pts[i].y, 0));
  }

  private CenterCamera() {
    const r = this.PlayRect(TopBand, BottomBand, 0);
    this.Fx.CameraTarget = r.center.neg();
  }

  protected OnLayoutChanged() { this.LayoutBoardAndWheel(); }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.LoadPuzzle(Math.max(3, this.CurrentLevel), true);
    this.demoWordIdx = 0;
    this.demoCharIdx = 0;
    this.demoTimer = 0.8;
  }

  protected BeginRun() {
    this.level = this.CurrentLevel;
    this.LoadPuzzle(this.level, false);
    this.streak = this.bestStreak = this.hintsUsed = this.wordsSolvedThisRun = this.bonusFoundThisRun = 0;
    this.ended = false;
    this.endTimer = -1;
    this.idleTimer = 0;

    const accent = Pal.hex(this.wonder.AccentHex);
    this.UI.Announce(`${this.wonder.Name} · LV ${this.level}`, accent, 1.4);

    if (this.level === 1) this.UI.Hint("Drag across E - T - N on the wheel to spell TEN and NET!");
    else if (this.level === 2) this.UI.Hint("Spell extra words not on the board to earn BONUS GEMS!");
    else if (this.level === 3 && this.Data.get("seenTools", 0) === 0) {
      this.Data.set("seenTools", 1);
      this.UI.Hint("Collect Gems from sparkling tiles! Spend Gems on HINT or HAMMER.");
    }
    Sfx.setIntensity(0.18);
  }

  protected OnPauseChanged(paused: boolean) {
    if (paused) this.CancelTrace();
  }

  private CancelTrace() {
    this.tracing = false;
    this.chain.length = 0;
    this.HideTraceVisuals();
  }

  private HideTraceVisuals() {
    this.traceOutlineLine.gameObject.setActive(false);
    this.traceColorLine.gameObject.setActive(false);
    this.traceCoreLine.gameObject.setActive(false);
    this.cursorHalo.gameObject.setActive(false);
    this.cursorRing.gameObject.setActive(false);
    for (let i = 0; i < this.traceBeads.length; i++) this.traceBeads[i].gameObject.setActive(false);
  }

  // ------------------------------------------------------------------ frame loops

  protected TickBackground(dt: number) {
    this.AnimateWorld(dt);
    const puzzle = this.puzzle;
    if (this.State !== Phase.Title || !puzzle) return;

    this.demoTimer -= dt;
    if (this.demoTimer > 0) return;

    if (puzzle.AllSolved || this.demoWordIdx >= puzzle.Words.length) {
      this.LoadPuzzle(3 + Random.rangeInt(0, 25), true);
      this.demoWordIdx = 0;
      this.demoCharIdx = 0;
      this.demoTimer = 1.0;
      return;
    }

    const targetWord = puzzle.Words[this.demoWordIdx];
    if (targetWord.Solved) {
      this.demoWordIdx++;
      this.demoCharIdx = 0;
      this.demoTimer = 0.3;
      return;
    }

    if (this.demoCharIdx < targetWord.Text.length) {
      const want = targetWord.Text[this.demoCharIdx];
      const nodeIdx = this.FindUnusedWheelNode(want);
      if (nodeIdx >= 0) {
        this.chain.push(nodeIdx);
        this.wheelNodes[nodeIdx].Pop = 1;
        this.pointerWorld = this.WheelNodeWorldPos(nodeIdx);
        this.tracing = true;
      }
      this.demoCharIdx++;
      this.demoTimer = 0.24;
    } else {
      puzzle.RevealWord(targetWord, this.revealedScratch);
      for (const [rx, ry] of this.revealedScratch) {
        const cv = this.FindCellView(rx, ry);
        if (cv) {
          cv.RevealAnim = 1;
          cv.Pop = 1.25;
          cv.Highlight = 1;
        }
      }
      this.chain.length = 0;
      this.tracing = false;
      this.HideTraceVisuals();
      this.demoWordIdx++;
      this.demoCharIdx = 0;
      this.demoTimer = 0.65;
    }
  }

  protected TickRun(dt: number) {
    this.AnimateWorld(dt);
    this.UpdateHud(dt);

    if (this.ended) {
      if (this.endTimer > 0 && (this.endTimer -= dt) <= 0) this.CompleteLevel();
      return;
    }

    this.idleTimer += dt;
    this.HandlePointerInput(dt);
    this.HandleKeyboardInput();

    if (this.puzzle!.AllSolved && !this.AnyOrbFlying()) {
      this.ended = true;
      this.endTimer = 0.72;
      this.UI.Hint(null);
    }
  }

  // ------------------------------------------------------------------ pointer & keyboard input

  private HandlePointerInput(dt: number) {
    const ptr = currentPointer();
    if (!ptr) return;
    const puzzle = this.puzzle!;
    const sp = ptr.position;
    const wp = this.ScreenToWorld(sp);

    if (!this.tracing) {
      if (!ptr.press.wasPressedThisFrame || overUI(sp)) return;
      this.idleTimer = 0;

      if (this.hammerMode) {
        const cv = this.CellAtWorld(wp);
        if (cv && !puzzle.Revealed[puzzle.Index(cv.GridX, cv.GridY)]) {
          this.ApplyHammerToCell(cv);
          return;
        }
      }

      const hitNode = this.WheelNodeAtWorld(wp, 0.64 * (this.wheelRadius / 1.95));
      if (hitNode >= 0) {
        if (this.hammerMode) {
          this.hammerMode = false;
          this.UI.Hint(null);
        }
        this.tracing = true;
        this.chain.length = 0;
        this.SelectWheelNode(hitNode);
        this.pointerWorld = wp;
        return;
      }

      const ws = this.wheelRadius / 1.95;
      if (wp.sub(this.wheelCenter).magnitude < 0.64 * ws) {
        this.ShuffleWheel(false);
        return;
      }

      const hammerWorld = this.wheelCenter.add(new V2(-2.55, 1.55).mul(ws));
      if (wp.sub(hammerWorld).magnitude < 0.64 * ws) {
        this.OnHammerButton();
        return;
      }
      const bulbWorld = this.wheelCenter.add(new V2(2.55, 1.55).mul(ws));
      if (wp.sub(bulbWorld).magnitude < 0.64 * ws) {
        this.OnHintButton();
        return;
      }

      const tappedCell = this.CellAtWorld(wp);
      if (tappedCell && !puzzle.Revealed[puzzle.Index(tappedCell.GridX, tappedCell.GridY)]) {
        tappedCell.Shake = 1;
        tappedCell.Pop = 0.6;
        this.Fx.burst(tappedCell.WorldPos, Gold, 5, 2, 0.12, 0.25);
        Sfx.play(Snd.Tick, 0.4, 0.9);
      }
      return;
    }

    if (ptr.press.isPressed) {
      const prev = this.pointerWorld;
      this.pointerWorld = wp;

      // Emit colorful stardust trail particles while dragging across the wheel
      this.trailEmitTimer -= dt;
      if (this.trailEmitTimer <= 0 && wp.sub(prev).sqrMagnitude > 0.002) {
        this.trailEmitTimer = 0.032;
        const sparkCol = WordJewelColors[this.chain.length % WordJewelColors.length];
        this.Fx.burst(wp, sparkCol, 2, 1.4, 0.11, 0.28);
      }

      const hover = this.WheelNodeAtWorld(wp, 0.58 * (this.wheelRadius / 1.95));
      if (hover >= 0) {
        const chain = this.chain;
        if (chain.length >= 2 && chain[chain.length - 2] === hover) {
          const removed = chain[chain.length - 1];
          this.wheelNodes[removed].Pop = 0.6;
          chain.splice(chain.length - 1, 1);
          this.previewPop = 0.6;
          Sfx.play(Snd.Tick, 0.45, 0.85);
          Fx.haptic();
        } else if (!chain.includes(hover)) {
          this.SelectWheelNode(hover);
        }
      }
      return;
    }

    if (this.chain.length >= 2) this.SubmitChain();
    this.CancelTrace();
  }

  private HandleKeyboardInput() {
    const kb = Keyboard;
    if (this.tracing) return;

    if (kb.space.wasPressedThisFrame) {
      this.ShuffleWheel(false);
      return;
    }
    if (kb.backspace.wasPressedThisFrame && this.chain.length > 0) {
      this.chain.splice(this.chain.length - 1, 1);
      this.previewPop = 0.5;
      Sfx.play(Snd.Tick, 0.45, 0.85);
      return;
    }
    if ((kb.enter.wasPressedThisFrame || kb.numpadEnter.wasPressedThisFrame) && this.chain.length >= 2) {
      this.SubmitChain();
      this.chain.length = 0;
      this.HideTraceVisuals();
      return;
    }

    for (let k = 0; k < 26; k++) {
      const c = String.fromCharCode(65 + k);
      if (kb.letter(c).wasPressedThisFrame) {
        const node = this.FindUnusedWheelNode(c);
        if (node >= 0) this.SelectWheelNode(node);
        else Sfx.play(Snd.Deny, 0.35);
      }
    }
  }

  private FindUnusedWheelNode(c: string) {
    for (let i = 0; i < this.puzzle!.Wheel.length; i++)
      if (this.wheelNodes[i].Char === c && !this.chain.includes(i)) return i;
    return -1;
  }

  private SelectWheelNode(index: number) {
    this.chain.push(index);
    this.wheelNodes[index].Pop = 1.15;
    this.previewPop = 1;
    const pitch = 0.92 + (this.chain.length - 1) * 0.105;
    Sfx.playClip(this.noteClip, 0.78, pitch);
    Fx.haptic();

    const burstCol = WordJewelColors[(this.chain.length - 1) % WordJewelColors.length];
    const pos = this.WheelNodeWorldPos(index);
    this.Fx.burst(pos, burstCol, 10, 3.0, 0.16, 0.36);
    this.Fx.ring(pos, burstCol, 0.25, 1.25, 0.26);
    this.previewAlpha = 1;
  }

  // ------------------------------------------------------------------ word submission & helpers

  private CurrentChainString() {
    if (this.chain.length === 0) return "";
    let sb = "";
    for (let i = 0; i < this.chain.length; i++) sb += this.wheelNodes[this.chain[i]].Char;
    return sb;
  }

  private SubmitChain() {
    const puzzle = this.puzzle!;
    const word = this.CurrentChainString();
    if (word.length < 2) return;

    const match = puzzle.FindWord(word);
    if (match) {
      if (!match.Solved) {
        this.SolveBoardWord(match);
      } else {
        for (let i = 0; i < match.Text.length; i++) {
          const [cx, cy] = match.CellAt(i);
          const cv = this.FindCellView(cx, cy);
          if (cv) {
            cv.Highlight = 1;
            cv.Pop = 0.95;
            this.Fx.burst(cv.WorldPos, Gold, 6, 2.5, 0.14, 0.32);
          }
        }
        Sfx.play(Snd.Confirm, 0.55, 1.15);
        this.UI.Float(this.previewPos, "ALREADY FOUND", Gold, 0.85);
      }
      return;
    }

    if (puzzle.BonusWords.has(word) || CrosswordGenerator.IsValidDictionaryWord(word)) {
      if (!puzzle.FoundBonus.has(word)) {
        puzzle.FoundBonus.add(word);
        this.bonusFoundThisRun++;
        this.Data.add("bonusTotal", 1);
        const gemReward = 5 + Math.min(10, this.streak * 2);
        this.AwardGems(gemReward, this.previewPos, `BONUS WORD!  +${gemReward} GEMS`);
        Sfx.playClip(this.bonusClip, 0.85, 1.05);
        this.Fx.burst(this.previewPos, Emerald, 24, 5.0, 0.22, 0.6);
        this.Fx.ring(this.previewPos, Emerald, 0.3, 2.2, 0.4);
        Fx.haptic();
        this.previewFlash = 1;
        this.previewPop = 1.2;
        this.previewFlashColor = Emerald;
      } else {
        Sfx.play(Snd.Confirm, 0.45, 1.1);
        this.UI.Float(this.previewPos, "BONUS ALREADY FOUND", Emerald, 0.8);
      }
      return;
    }

    this.streak = 0;
    this.previewShake = 1;
    this.previewFlash = 1;
    this.previewFlashColor = Pal.Danger;
    this.Fx.burst(this.previewPos, Coral, 10, 3.2, 0.15, 0.32);
    Sfx.play(Snd.Deny, 0.55);
  }

  private SolveBoardWord(match: PlacedWord) {
    const puzzle = this.puzzle!;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.Data.max("bestStreak", this.bestStreak);

    const newlySolved = puzzle.RevealWord(match, this.revealedScratch);
    this.wordsSolvedThisRun += newlySolved.length;

    const wordIdx = Math.max(0, puzzle.Words.indexOf(match));
    const wordColor = WordJewelColors[wordIdx % WordJewelColors.length];

    // Launch colorful flying orbs from the wheel nodes to each cell of the word!
    for (let i = 0; i < match.Text.length; i++) {
      const [cx, cy] = match.CellAt(i);
      const cv = this.FindCellView(cx, cy);
      if (!cv) continue;
      cv.ColorIndex = wordIdx % WordJewelColors.length;
      const fromPos = i < this.chain.length ? this.WheelNodeWorldPos(this.chain[i]) : this.wheelCenter;
      this.LaunchOrb(fromPos, cv, i * 0.055, wordColor);
    }

    let gemsCollected = 0;
    for (const [gx, gy, hasGem] of this.revealedScratch) {
      if (!hasGem) continue;
      gemsCollected += 15;
      const cv = this.FindCellView(gx, gy);
      if (cv) {
        this.Fx.burst(cv.WorldPos, Emerald, 22, 5.0, 0.24, 0.65);
        this.Fx.ring(cv.WorldPos, Emerald, 0.2, 1.9, 0.42);
      }
    }

    if (gemsCollected > 0) this.AwardGems(gemsCollected, this.boardCenter, `+${gemsCollected} GEM TILE!`);

    if (this.streak >= 2) {
      const streakBonus = this.streak * 2;
      this.Gems += streakBonus;
      this.gemBadgePop = 1;
      const praise = ["", "", "GREAT!", "AWESOME!", "BRILLIANT!", "WONDERFUL!", "LEGENDARY!"];
      const label = `${praise[Math.min(this.streak, praise.length - 1)]}  STREAK x${this.streak}`;
      this.UI.Float(this.boardCenter.add(new V2(0, 0.4)), label, wordColor, 0.98);
    }

    if (newlySolved.length >= 2) {
      this.UI.Announce("CROSS COMPLETE!", Sky, 1.1);
      this.AwardGems(10, this.boardCenter, "+10 CROSS BONUS");
    }

    Sfx.playClip(this.wordSolveClip, 0.85, 0.96 + Math.min(this.streak, 6) * 0.04);
    this.Fx.burst(this.previewPos, wordColor, 18, 4.2, 0.2, 0.48);
    this.Fx.kick(0.55);
    Fx.haptic();
    this.previewFlash = 1;
    this.previewPop = 1.25;
    this.previewFlashColor = wordColor;

    const progress = puzzle.SolvedWordCount / Math.max(1, puzzle.Words.length);
    Sfx.setIntensity(Mathf.clamp01(0.18 + progress * 0.65));
  }

  private LaunchOrb(from: V2, target: CellView, delay: number, color: Color) {
    let orb: FlyingOrb | null = null;
    for (const o of this.flyingOrbs) if (!o.Active) { orb = o; break; }
    if (!orb) orb = this.flyingOrbs[0];

    orb.Active = true;
    orb.From = from;
    orb.To = target.WorldPos;
    orb.TargetCellIndex = this.cellPool.indexOf(target);
    orb.T = -delay;
    orb.Duration = 0.3;
    orb.TrailTimer = 0;
    orb.Color = color;
    orb.Disc.color = color;
    orb.Glow.color = color.withAlpha(0.75);
    orb.Core.color = Color.white;
    orb.Disc.transform.position = from;
    orb.Glow.transform.position = from;
    orb.Core.transform.position = from;
    orb.Disc.gameObject.setActive(true);
    orb.Glow.gameObject.setActive(true);
    orb.Core.gameObject.setActive(true);
  }

  private AnyOrbFlying() {
    for (const o of this.flyingOrbs) if (o.Active) return true;
    return false;
  }

  private AwardGems(amount: number, worldOrigin: V2, floaterText: string) {
    this.Gems += amount;
    this.gemBadgePop = 1;
    Sfx.play(Snd.Coin, 0.65, 1.1);
    if (floaterText) this.UI.Float(worldOrigin, floaterText, Emerald, 0.92);
  }

  private ShuffleWheel(quiet: boolean) {
    const puzzle = this.puzzle;
    if (!puzzle || this.tracing) return;
    const n = puzzle.Wheel.length;
    const indices: number[] = [];
    for (let i = 0; i < n; i++) indices.push(i);
    for (let i = n - 1; i > 0; i--) {
      const j = this.rng.next(i + 1);
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let i = 0; i < n; i++) {
      const target = Math.PI * 0.5 - indices[i] * ((Math.PI * 2) / n);
      this.wheelNodes[i].TargetAngle = target;
      this.wheelNodes[i].Pop = 0.95;
    }
    this.shuffleSpin = 1;
    if (!quiet) {
      this.Fx.ring(this.wheelCenter, Sky, 0.4, this.wheelRadius * 1.15, 0.35);
      this.Fx.burst(this.wheelCenter, Gold, 14, 3.8, 0.16, 0.4);
      Sfx.playClip(this.shuffleClip, 0.75, Random.range(0.95, 1.08));
      Fx.haptic();
    }
  }

  private OnHintButton() {
    const puzzle = this.puzzle;
    if (this.State !== Phase.Playing || this.ended || !puzzle || puzzle.AllSolved) return;

    if (this.Gems < HintCost) {
      this.OfferGemTopUp();
      return;
    }

    const [hx, hy] = puzzle.PickHintCell(this.rng);
    if (hx < 0) return;

    this.Gems -= HintCost;
    this.hintsUsed++;
    this.gemBadgePop = 0.7;
    this.hammerMode = false;
    this.UI.Hint(null);

    const [solvedNow, gotGem] = puzzle.RevealCell(hx, hy);
    const cv = this.FindCellView(hx, hy);
    if (cv) {
      cv.RevealAnim = 1;
      cv.Pop = 1.35;
      cv.Highlight = 1;
      this.Fx.burst(cv.WorldPos, Gold, 26, 5.2, 0.24, 0.65);
      this.Fx.ring(cv.WorldPos, Gold, 0.25, 2.0, 0.42);
    }
    if (gotGem && cv) this.AwardGems(15, cv.WorldPos, "+15 GEM TILE!");

    Sfx.play(Snd.PowerUp, 0.75, 1.1);
    this.Fx.kick(0.55);
    Fx.haptic();
    if (solvedNow.length > 0) this.wordsSolvedThisRun += solvedNow.length;
  }

  private OnHammerButton() {
    const puzzle = this.puzzle;
    if (this.State !== Phase.Playing || this.ended || !puzzle || puzzle.AllSolved) return;

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

    this.hammerMode = true;
    Sfx.play(Snd.Confirm, 0.65, 1.05);
    this.UI.Hint("HAMMER READY: Tap any unrevealed tile on the crossword to smash it open!");
  }

  private ApplyHammerToCell(cv: CellView) {
    this.hammerMode = false;
    this.UI.Hint(null);
    if (this.Gems < HammerCost) return;

    this.Gems -= HammerCost;
    this.hintsUsed++;
    this.gemBadgePop = 0.8;

    const [solvedNow, gotGem] = this.puzzle!.RevealCell(cv.GridX, cv.GridY);
    cv.RevealAnim = 1;
    cv.Pop = 1.5;
    cv.Highlight = 1;

    Sfx.playClip(this.hammerClip, 0.9, 1);
    this.Fx.burst(cv.WorldPos, Coral, 32, 6.4, 0.26, 0.7);
    this.Fx.ring(cv.WorldPos, Coral, 0.3, 2.4, 0.45);
    this.Fx.shake(0.15);
    this.Fx.kick(0.8);
    Fx.haptic(true);

    if (gotGem) this.AwardGems(15, cv.WorldPos, "+15 GEM TILE!");
    if (solvedNow.length > 0) {
      this.wordsSolvedThisRun += solvedNow.length;
      Sfx.playClip(this.wordSolveClip, 0.8, 1.05);
    }
  }

  private OfferGemTopUp() {
    if (AdService.rewardedAvailable) {
      AdService.showRewarded((earned) => {
        if (!earned) return;
        this.AwardGems(150, this.wheelCenter, "+150 GEMS!");
        Sfx.play(Snd.PowerUp, 0.85);
      });
      return;
    }
    Sfx.play(Snd.Deny, 0.55);
    this.UI.Toast("Not enough Gems! Find Bonus Words or complete levels to earn more Gems.", 3.5);
  }

  private OnBonusPillTapped() {
    const puzzle = this.puzzle;
    if (!puzzle) return;
    if (puzzle.FoundBonus.size === 0) {
      this.UI.Toast(`Spell valid words not in the grid for +5 Gems! (${puzzle.BonusWords.size} hidden in this wheel)`, 3.5);
    } else {
      const list = [...puzzle.FoundBonus].join(", ");
      this.UI.Toast(`FOUND BONUS WORDS (${puzzle.FoundBonus.size}): ${list}`, 4);
    }
  }

  // ------------------------------------------------------------------ hit testing & lookups

  private WheelNodeWorldPos(i: number) {
    const wn = this.wheelNodes[i];
    const r = 1.38 * (this.wheelRadius / 1.95);
    return this.wheelCenter.add(new V2(Math.cos(wn.Angle), Math.sin(wn.Angle)).mul(r));
  }

  private WheelNodeAtWorld(wp: V2, hitRadius: number) {
    let best = -1;
    let bestD = hitRadius;
    for (let i = 0; i < this.puzzle!.Wheel.length; i++) {
      const d = this.WheelNodeWorldPos(i).sub(wp).magnitude;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private CellAtWorld(wp: V2) {
    const half = this.cellSize * 0.48;
    for (let i = 0; i < this.cellPool.length; i++) {
      const cv = this.cellPool[i];
      if (!cv.Active) continue;
      const d = wp.sub(cv.WorldPos);
      if (Math.abs(d.x) <= half && Math.abs(d.y) <= half) return cv;
    }
    return null;
  }

  private FindCellView(gx: number, gy: number) {
    for (let i = 0; i < this.cellPool.length; i++) {
      const cv = this.cellPool[i];
      if (cv.Active && cv.GridX === gx && cv.GridY === gy) return cv;
    }
    return null;
  }

  // ------------------------------------------------------------------ animation & rendering

  private AnimateWorld(dt: number) {
    const puzzle = this.puzzle;
    if (!puzzle) return;
    const time = Time.time;
    const accent = Pal.hex(this.wonder.AccentHex);

    // 1. Animate twinkling sky stars & breathing Wonder sun
    const sunPulse = 1 + 0.06 * Math.sin(time * 1.8);
    this.wonderSun.transform.localScale = new V3(4.2 * sunPulse, 4.2 * sunPulse, 1);
    this.wonderSunHalo.transform.localScale = new V3(9.5 * sunPulse, 9.5 * sunPulse, 1);

    for (let i = 0; i < this.skyStars.length; i++) {
      const st = this.skyStars[i];
      const tw = 0.45 + 0.55 * Math.sin(time * st.Speed + st.Phase);
      const dy = Math.sin(time * 0.8 + st.Phase) * st.Drift;
      const dx = Math.cos(time * 0.5 + st.Phase) * st.Drift * 0.6;
      st.Tr.localPosition = new V3(st.BasePos.x + dx, st.BasePos.y + dy, 0);
      st.Tr.localRotation = Quaternion.euler(0, 0, time * 24 * (i % 2 === 0 ? 1 : -1));
      const sc = st.BaseScale * (0.7 + 0.55 * tw);
      st.Tr.localScale = new V3(sc, sc, 1);
      st.Sr.color = st.BaseColor.withAlpha(0.22 + 0.58 * tw);
    }

    // 2. Animate flying orbs with sparkling particle trails
    for (let i = 0; i < this.flyingOrbs.length; i++) {
      const orb = this.flyingOrbs[i];
      if (!orb.Active) continue;
      orb.T += dt / orb.Duration;
      if (orb.T < 0) continue;
      if (orb.T >= 1) {
        orb.Active = false;
        orb.Disc.gameObject.setActive(false);
        orb.Glow.gameObject.setActive(false);
        orb.Core.gameObject.setActive(false);
        if (orb.TargetCellIndex >= 0 && orb.TargetCellIndex < this.cellPool.length) {
          const cv = this.cellPool[orb.TargetCellIndex];
          cv.RevealAnim = 1;
          cv.Pop = 1.35;
          cv.Highlight = 1;
          this.Fx.burst(cv.WorldPos, orb.Color, 14, 3.8, 0.2, 0.48);
          this.Fx.ring(cv.WorldPos, orb.Color, 0.2, 1.35, 0.28);
        }
        continue;
      }
      const k = Ease.outCubic(orb.T);
      const mid = orb.From.add(orb.To).mul(0.5).add(new V2(0, 1.15));
      const p = V2.lerp(V2.lerp(orb.From, mid, k), V2.lerp(mid, orb.To, k), k);
      orb.Disc.transform.position = p;
      orb.Glow.transform.position = p;
      orb.Core.transform.position = p;
      orb.Core.transform.localRotation = Quaternion.euler(0, 0, time * 360);

      orb.TrailTimer -= dt;
      if (orb.TrailTimer <= 0) {
        orb.TrailTimer = 0.028;
        this.Fx.burst(p, orb.Color, 2, 1.2, 0.12, 0.22);
      }
    }

    // 3. Animate crossword board frame & 3D flip/bounce cells
    this.boardFrameRim.color = Color.lerp(accent, Sky, 0.35 + 0.35 * Math.sin(time * 2.2)).withAlpha(0.65);
    this.boardFrameGlow.color = accent.withAlpha(0.18 + 0.06 * Math.sin(time * 2.2));

    const cellSize = this.cellSize;
    const pulse = 0.5 + 0.5 * Math.sin(time * 6.5);
    for (let i = 0; i < this.cellPool.length; i++) {
      const cv = this.cellPool[i];
      if (!cv.Active) continue;
      cv.Pop = Mathf.moveTowards(cv.Pop, 0, dt * 3.8);
      cv.RevealAnim = Mathf.moveTowards(cv.RevealAnim, 0, dt * 3.2);
      cv.Highlight = Mathf.moveTowards(cv.Highlight, 0, dt * 2.2);
      cv.Shake = Mathf.moveTowards(cv.Shake, 0, dt * 3.5);
      cv.SpawnAnim = Mathf.moveTowards(cv.SpawnAnim, 0, dt * 2.4);

      const idx = puzzle.Index(cv.GridX, cv.GridY);
      const rev = puzzle.Revealed[idx];
      const hasGem = puzzle.HasGem[idx] && !rev;

      const spawnScale = Ease.outCubic(1 - Mathf.clamp01(cv.SpawnAnim));
      const popBump = 1 + 0.26 * Math.sin(Mathf.clamp01(cv.Pop) * Math.PI);
      // 3D card-flip effect on reveal!
      const flipX = cv.RevealAnim > 0.01 ? Math.abs(Math.cos(cv.RevealAnim * Math.PI)) : 1;

      const s = cellSize * spawnScale * popBump;
      const shakeOff = new V2(Math.sin(time * 55) * 0.06 * cv.Shake, 0);
      // Subtle diagonal breathing wave across the crossword
      const idleWave = Math.sin(time * 2.6 - (cv.GridX + cv.GridY) * 0.45);
      const bobY = rev ? idleWave * 0.015 * cellSize : 0;

      const lx = (cv.GridX - (puzzle.W - 1) * 0.5) * cellSize + shakeOff.x;
      const ly = ((puzzle.H - 1) * 0.5 - cv.GridY) * cellSize + shakeOff.y + bobY;
      cv.Root.localPosition = new V3(lx, ly, 0);
      cv.Root.localScale = new V3(s * Math.max(0.15, flipX), s, 1);

      if (rev) {
        const jewel = WordJewelColors[cv.ColorIndex % WordJewelColors.length];
        const solvedBg = Color.lerp(jewel, Color.white, 0.18 + 0.52 * cv.Highlight);
        cv.Base.color = solvedBg;
        cv.Inner.color = Color.white.withAlpha(0.55);
        cv.Edge.color = Color.lerp(jewel, Color.white, 0.55);
        cv.Glow.color = jewel.withAlpha(0.32 + 0.45 * cv.Highlight);
        cv.Shine.color = Color.white.withAlpha(0.38 + 0.35 * cv.Highlight);
        cv.Letter.gameObject.setActive(true);
        cv.Letter.color = TileDarkText;
        cv.GemIcon.gameObject.setActive(false);
      } else {
        const shimmer = Math.pow(Math.max(0, Math.sin(time * 2.2 - (cv.GridX + cv.GridY) * 0.55)), 8);
        cv.Base.color = Color.lerp(Pearl, Color.white, shimmer * 0.5);
        cv.Inner.color = Color.lerp(Pal.hex(0xefe8ff), Color.white, 0.4 + shimmer * 0.4);
        cv.Edge.color = this.hammerMode
          ? Color.lerp(Coral, Gold, pulse)
          : Color.lerp(Pal.hex(0xb8a6e8), Sky, shimmer * 0.6);
        cv.Glow.color = this.hammerMode
          ? Coral.withAlpha(0.28 + 0.25 * pulse)
          : (hasGem ? Emerald.withAlpha(0.22 + 0.18 * pulse) : Color.clear);
        cv.Shine.color = Color.white.withAlpha(0.45);
        cv.Letter.gameObject.setActive(false);
        cv.GemIcon.gameObject.setActive(hasGem);
        if (hasGem) {
          const gs = 0.36 + 0.07 * Math.sin(time * 5.5 + i);
          cv.GemIcon.transform.localScale = new V3(gs, gs, 1);
          cv.GemIcon.transform.localRotation = Quaternion.euler(0, 0, Math.sin(time * 3.5 + i) * 14);
        }
      }
    }

    // 4. Animate wheel platter, rotating compass ring & tactile 3D letter medallions
    this.shuffleSpin = Mathf.moveTowards(this.shuffleSpin, 0, dt * 3.2);
    this.shuffleIconB.transform.localRotation = Quaternion.euler(0, 0, -this.shuffleSpin * 180 + Math.sin(time * 2.5) * 6);
    const shufflePulse = 1.12 + 0.05 * Math.sin(time * 4);
    this.shuffleIconA.transform.localScale = new V3(shufflePulse, shufflePulse, 1);

    this.wheelOuterRing.transform.localRotation = Quaternion.euler(0, 0, time * 10);
    this.wheelCompass.transform.localRotation = Quaternion.euler(0, 0, -time * 14);
    this.wheelRim.color = Color.lerp(Gold, Sky, 0.35 + 0.35 * Math.sin(time * 2.4));
    this.wheelInnerGlow.color = Color.lerp(accent, Magenta, 0.4 + 0.4 * Math.sin(time * 1.9)).withAlpha(0.36);

    const chain = this.chain;
    for (let i = 0; i < puzzle.Wheel.length; i++) {
      const wn = this.wheelNodes[i];
      const diff = Mathf.deltaAngle(wn.Angle * Mathf.Rad2Deg, wn.TargetAngle * Mathf.Rad2Deg) * Mathf.Deg2Rad;
      wn.Angle += diff * (1 - Math.exp(-dt * 18));
      wn.Pop = Mathf.moveTowards(wn.Pop, 0, dt * 4.2);

      const orderInChain = chain.indexOf(i);
      const selected = orderInChain >= 0;
      wn.SelectT = Mathf.moveTowards(wn.SelectT, selected ? 1 : 0, dt * 12);

      const localPos = new V2(Math.cos(wn.Angle), Math.sin(wn.Angle)).mul(1.38);
      wn.Root.localPosition = new V3(localPos.x, localPos.y, 0);
      const idleBob = selected ? 0.04 * Math.sin(time * 10 + i) : 0.02 * Math.sin(time * 3.2 + i);
      const ns = 1 + 0.24 * Math.sin(Mathf.clamp01(wn.Pop) * Math.PI) + 0.14 * wn.SelectT + idleBob;
      wn.Root.localScale = new V3(ns, ns, 1);

      const nodeJewel = WordJewelColors[(selected ? orderInChain : i) % WordJewelColors.length];
      wn.Disc.color = Color.lerp(Pearl, nodeJewel, wn.SelectT);
      wn.Ring.color = Color.lerp(Pal.hex(0x9c84e0), Color.white, wn.SelectT);
      wn.Inner.color = selected ? Color.white.withAlpha(0.75) : Pal.hex(0xd8ceff).withAlpha(0.6);
      wn.Halo.color = nodeJewel.withAlpha(0.68 * wn.SelectT);
      wn.Letter.color = selected ? TileDarkText : Pal.hex(0x211442);
    }

    // 5. Update 3-layer high-contrast connector ribbon + animated racing energy beads!
    if (chain.length > 0) {
      this.traceOutlineLine.gameObject.setActive(true);
      this.traceColorLine.gameObject.setActive(true);
      this.traceCoreLine.gameObject.setActive(true);

      const pts = chain.length + (this.tracing ? 1 : 0);
      this.traceOutlineLine.positionCount = pts;
      this.traceColorLine.positionCount = pts;
      this.traceCoreLine.positionCount = pts;

      // Animated pulse width so the connector line feels alive with energy
      const wPulse = 1 + 0.14 * Math.sin(time * 16);
      this.traceOutlineLine.widthMultiplier = 0.36 * wPulse;
      this.traceColorLine.widthMultiplier = 0.24 * wPulse;
      this.traceCoreLine.widthMultiplier = 0.1 * wPulse;

      // Rich saturated start & end colors (never white!)
      const startCol = Color.lerp(Coral, Magenta, 0.5 + 0.5 * Math.sin(time * 6));
      const endCol = Color.lerp(Gold, Sky, 0.5 + 0.5 * Math.cos(time * 6));
      this.traceOutlineLine.startColor = this.traceOutlineLine.endColor = Pal.hex(0x120629).withAlpha(0.95);
      this.traceColorLine.startColor = startCol;
      this.traceColorLine.endColor = endCol;
      this.traceCoreLine.startColor = HotGold;
      this.traceCoreLine.endColor = Sky;

      for (let i = 0; i < chain.length; i++) {
        const p = this.WheelNodeWorldPos(chain[i]);
        this.traceOutlineLine.setPosition(i, p);
        this.traceColorLine.setPosition(i, p);
        this.traceCoreLine.setPosition(i, p);
      }

      let tipPos = chain.length > 0 ? this.WheelNodeWorldPos(chain[chain.length - 1]) : this.wheelCenter;
      if (this.tracing) {
        tipPos = this.wheelCenter.add(V2.clampMagnitude(this.pointerWorld.sub(this.wheelCenter), this.wheelRadius * 1.05));
        this.traceOutlineLine.setPosition(chain.length, tipPos);
        this.traceColorLine.setPosition(chain.length, tipPos);
        this.traceCoreLine.setPosition(chain.length, tipPos);

        this.cursorHalo.gameObject.setActive(true);
        this.cursorRing.gameObject.setActive(true);
        this.cursorHalo.transform.position = tipPos;
        this.cursorRing.transform.position = tipPos;
        const cs = 0.52 + 0.08 * Math.sin(time * 14);
        this.cursorRing.transform.localScale = new V3(cs, cs, 1);
        this.cursorRing.color = endCol;
        this.cursorHalo.color = startCol.withAlpha(0.55);
      } else {
        this.cursorHalo.gameObject.setActive(false);
        this.cursorRing.gameObject.setActive(false);
      }

      // Animate glowing energy beads racing from start to tip along the connected segments
      const segCount = pts - 1;
      for (let b = 0; b < this.traceBeads.length; b++) {
        const activeBead = segCount > 0 && b < Math.min(TraceBeadCount, segCount * 3);
        this.traceBeads[b].gameObject.setActive(activeBead);
        if (!activeBead) continue;

        const totalT = Mathf.repeat(time * 1.85 + b / Math.max(1, segCount * 3), 1) * segCount;
        const segIdx = Mathf.clamp(Math.floor(totalT), 0, segCount - 1);
        const localT = totalT - segIdx;
        const a = segIdx < chain.length ? this.WheelNodeWorldPos(chain[segIdx]) : tipPos;
        const c = segIdx + 1 < chain.length ? this.WheelNodeWorldPos(chain[segIdx + 1]) : tipPos;
        const bp = V2.lerp(a, c, localT);
        this.traceBeads[b].transform.position = bp;
        const bs = 0.16 + 0.06 * Math.sin(time * 18 + b);
        this.traceBeads[b].transform.localScale = new V3(bs, bs, 1);
        this.traceBeads[b].color = Color.lerp(HotGold, Sky, totalT / Math.max(1, segCount));
      }
    } else {
      this.HideTraceVisuals();
    }

    // 6. Update word preview pill with reactive bounce & color glow
    this.previewShake = Mathf.moveTowards(this.previewShake, 0, dt * 3.5);
    this.previewFlash = Mathf.moveTowards(this.previewFlash, 0, dt * 3);
    this.previewPop = Mathf.moveTowards(this.previewPop, 0, dt * 5);
    const currentWord = this.CurrentChainString();
    if (currentWord.length > 0) {
      this.previewAlpha = 1;
      this.previewLabel.text = currentWord.split("").join(" ");
    } else {
      this.previewAlpha = Mathf.moveTowards(this.previewAlpha, 0, dt * 4.5);
    }

    const showPreview = this.previewAlpha > 0.02;
    if (this.previewRoot.activeSelf !== showPreview) this.previewRoot.setActive(showPreview);
    if (showPreview) {
      const sx = Math.sin(time * 60) * 0.12 * this.previewShake;
      const popScale = 1 + 0.16 * Math.sin(Mathf.clamp01(this.previewPop) * Math.PI);
      this.previewRoot.localPosition = new V3(this.previewPos.x + sx, this.previewPos.y, 0);
      this.previewRoot.localScale = new V3(popScale, popScale, 1);

      const pw = Math.max(1.9, this.previewLabel.text.length * 0.29 + 0.85);
      this.previewBg.transform.localScale = new V3(pw, 0.84, 1);
      this.previewEdge.transform.localScale = new V3(pw + 0.1, 0.94, 1);
      this.previewGlow.transform.localScale = new V3(pw + 1.2, 1.8, 1);

      const liveAccent = WordJewelColors[Math.max(0, chain.length - 1) % WordJewelColors.length];
      const edgeCol = Color.lerp(liveAccent, this.previewFlashColor, this.previewFlash);
      this.previewEdge.color = edgeCol.withAlpha(this.previewAlpha);
      this.previewGlow.color = edgeCol.withAlpha(0.38 * this.previewAlpha);
      this.previewBg.color = Pal.hex(0x221248).withAlpha(0.96 * this.previewAlpha);
      this.previewLabel.color = Color.white.withAlpha(this.previewAlpha);
    }
  }

  // ------------------------------------------------------------------ HUD & completion

  private UpdateHud(dt: number) {
    const puzzle = this.puzzle!;
    WordWonderGame.Set(this.levelText, "LEVEL " + this.level);
    WordWonderGame.Set(this.wonderText, `${this.wonder.Name}   ·   ${this.wonder.Region}`);
    WordWonderGame.Set(this.gemCountText, Fmt.n(this.Gems));

    this.gemBadgePop = Mathf.moveTowards(this.gemBadgePop, 0, dt * 3.5);
    const gs = 1 + 0.14 * Ease.outCubic(this.gemBadgePop);
    this.gemBadge.localScale = new V3(gs, gs, 1);

    if (this.streak >= 2) WordWonderGame.Set(this.streakHudText, `STREAK x${this.streak}   ·   ${puzzle.SolvedWordCount}/${puzzle.Words.length} WORDS`);
    else WordWonderGame.Set(this.streakHudText, `${puzzle.SolvedWordCount} / ${puzzle.Words.length} WORDS SOLVED`);

    WordWonderGame.Set(this.bonusButton.label, `BONUS WORDS: ${puzzle.FoundBonus.size}`);

    const busy = this.ended || puzzle.AllSolved;
    if (this.hammerMode) WordWonderGame.SetButton(this.hammerButton, "CANCEL HAMMER", !busy);
    else if (this.Gems >= HammerCost) WordWonderGame.SetButton(this.hammerButton, `HAMMER · ${HammerCost}`, !busy);
    else if (AdService.rewardedAvailable) WordWonderGame.SetButton(this.hammerButton, "+150 GEMS (AD)", !busy);
    else WordWonderGame.SetButton(this.hammerButton, `HAMMER · ${HammerCost}`, false);

    if (this.Gems >= HintCost) WordWonderGame.SetButton(this.hintButton, `HINT · ${HintCost}`, !busy);
    else if (AdService.rewardedAvailable) WordWonderGame.SetButton(this.hintButton, "+150 GEMS (AD)", !busy);
    else WordWonderGame.SetButton(this.hintButton, `HINT · ${HintCost}`, false);

    WordWonderGame.SetButton(this.shuffleHudButton, "SHUFFLE", !busy);
  }

  private static Set(t: Text | null, s: string) {
    if (t && t.text !== s) t.text = s;
  }

  private static SetButton(b: ArcadeButton | null, label: string, enabled: boolean) {
    if (!b) return;
    WordWonderGame.Set(b.label, label);
    if (b.interactable !== enabled) b.interactable = enabled;
  }

  private CompleteLevel() {
    const puzzle = this.puzzle!;
    const level = this.level;
    const stars = this.hintsUsed === 0 ? 3 : this.hintsUsed <= 2 ? 2 : 1;
    const prevStars = this.Data.get("s" + level);
    if (stars > prevStars) {
      this.Data.set("s" + level, stars);
      this.Data.add("stars", stars - prevStars);
    }

    const clearReward = 25 + stars * 10;
    this.Gems += clearReward;

    const newWonderUnlocked = CrosswordGenerator.WonderForLevel(level + 1).Name !== this.wonder.Name;
    this.Data.set("level", level + 1);
    this.Data.max("bestLevel", level + 1);

    const accent = Pal.hex(this.wonder.AccentHex);
    for (let i = 0; i < this.cellPool.length; i++) {
      if (this.cellPool[i].Active) {
        const burstCol = WordJewelColors[i % WordJewelColors.length];
        this.Fx.burst(this.cellPool[i].WorldPos, burstCol, 8, 5.2, 0.22, 0.78);
      }
    }
    this.Fx.kick(1.1, 0.18);
    this.Fx.shake(0.12);
    Fx.haptic(true);
    Sfx.play(Snd.Win);

    const nextWonder = CrosswordGenerator.WonderForLevel(level + 1);
    this.Finish(new Result({
      Headline: newWonderUnlocked ? "NEW WONDER: " + nextWonder.Name : "WONDER SOLVED!",
      HeadlineColor: accent,
      Stars: stars,
      Value: "LEVEL " + level,
      BestLine: `${this.wonder.Name}   ·   +${clearReward} GEMS EARNED`,
      Stats: [
        ["WORDS SOLVED", String(puzzle.Words.length)],
        ["BONUS WORDS", String(this.bonusFoundThisRun)],
        ["BEST STREAK", "x" + Math.max(1, this.bestStreak)],
        ["TOTAL GEMS", Fmt.n(this.Gems)],
      ],
      Primary: "NEXT LEVEL",
      Victory: true,
      Reward: () => {
        this.AwardGems(100, V2.zero, "+100 BONUS GEMS!");
      },
      RewardLabel: "+100 BONUS GEMS (WATCH AD)",
    }));
  }
}
