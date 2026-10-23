import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, Camera, CasualLook, Color, Ease, Fmt, Fx, GameInfo, GameObject, howTo, Image,
  Mathf, OnlineLink, OnlineRoom, Pal, Phase, Quaternion, Random, Renderer, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, tableCodeFromUrl,
  TableLobby, TableOverlay, Text, TextAnchor, TextMesh, Time, TouchScheme, UIKit, UINode, V2, V3, WrapMode,
} from "../../kit";
import { LudoArt } from "./LudoArt";
import { LudoAi, LudoBoard, LudoMove, LudoState, StageSpec } from "./LudoRules";

/**
 * LUDO BLITZ — classic 4-colour cross-shaped Ludo board game vs tactical AI rivals across a tournament level ladder.
 * Royal premium look: a walnut board in a gold frame with inlaid ivory tiles on velvet, glossy jewel pawns, an ivory
 * die that tumbles and bounces, tilting squash-and-stretch hops, confetti celebrations and drifting gold dust.
 * All art is shaded procedurally in LudoArt (no texture assets). Strategic Golden 6 / Lucky Reroll power-ups.
 * (Port of LudoBlitzGame.cs.)
 */

const TopBand = 268, BottomBandBase = 250, BottomBandOnline = 340;
const TileStep = 0.92;
const RerollCost = 50;
const GoldenSixCost = 100;
const StartingCoins = 250;
const AdCoinGrant = 150;

// Royal jewel palette (names kept from the original neon version so gameplay code is untouched).
const RubyRed = Pal.hex(0xe0233f);
const EmeraldGreen = Pal.hex(0x1e9e5a);
const AmberGold = Pal.hex(0xf2b21b);
const ElectricBlue = Pal.hex(0x2a6de0);
const RoyalGold = Pal.hex(0xe9be5c);
const Ebony = Pal.hex(0x2b1b14);

const TokenShadowSize = 0.92 * 0.92; // TileStep * 0.92
const DiceShadowSize = 1.55;
const ConfettiCount = 150;

const PlayerColors = [
  RubyRed,      // Seat 0: YOU (Bottom-Left)
  EmeraldGreen, // Seat 1: AI Rival (Top-Left)
  AmberGold,    // Seat 2: AI Rival (Top-Right)
  ElectricBlue, // Seat 3: AI Rival (Bottom-Right)
];

const SeatNames = ["RED", "GREEN", "GOLD", "BLUE"];

const PlayerHighlightColors = [Pal.hex(0xff7a8c), Pal.hex(0x6fe0a1), Pal.hex(0xffe08a), Pal.hex(0x84b4ff)];

const PlayerDarkColors = [Pal.hex(0x6e0f1e), Pal.hex(0x0c4a2a), Pal.hex(0x7a5308), Pal.hex(0x13336f)];

// 3x3 pip positions in [-1..1] dice face coordinates:
// 0:(-1,1)  1:(0,1)  2:(1,1)
// 3:(-1,0)  4:(0,0)  5:(1,0)
// 6:(-1,-1) 7:(0,-1) 8:(1,-1)
const PipOffsets = [
  new V2(-0.26, 0.26), new V2(0, 0.26), new V2(0.26, 0.26),
  new V2(-0.26, 0), new V2(0, 0), new V2(0.26, 0),
  new V2(-0.26, -0.26), new V2(0, -0.26), new V2(0.26, -0.26),
];

const FacePipIndices = [
  [] as number[],
  [4],                // 1
  [2, 6],             // 2
  [2, 4, 6],          // 3
  [0, 2, 6, 8],       // 4
  [0, 2, 4, 6, 8],    // 5
  [0, 2, 3, 5, 6, 8], // 6
];

enum TurnPhase { AwaitRoll, RollingDice, AwaitMove, MovingToken, TurnDelay }

// ------------------------------------------------------------------ online (private tables)
// Host = seat 0 (RED), guest = seat 2 (GOLD, the opposite corner); with "+2 CPU" seats 1 and 3 are CPU rivals run by
// the host. The host owns every dice roll and every CPU / host decision and broadcasts them as sequenced events
// (OnlineLink moves); the guest only sends intents ("roll for me", "I picked token t") which the host validates.
const HostSeat = 0, GuestSeat = 2;
const OnlinePrize = 150, OnlineLosePrize = 10;
const OnlineCpuNames = ["NOVA", "VEX", "KAI"];
/** A new online match: active seats, tokens that start out, first seat to roll, CPU names and skill. */
interface OStart { seats: number[]; out: number; first: number; names: string[]; skill: number }
/** Host → guest events: a die roll for seat p, or seat p moving token tok (from step `from` with roll `roll`). */
type OEv = { e: "roll"; p: number; v: number } | { e: "move"; p: number; tok: number; from: number; roll: number };
/** Full board snapshot from the host (after a reconnect or a desync). `am` = the active LudoMove as numbers. */
interface OSnap { start: OStart; steps: number[][]; turn: number; sixes: number; phase: number; roll: number; am: number[]; ended: number; winner: number }
/** Guest → host intents (plain room messages next to the link's protocol; the link ignores them). */
type OIntent = { t: "lb"; k: "roll"; seq: number } | { t: "lb"; k: "pick"; tok: number; seq: number } | { t: "lb"; k: "pause"; on: boolean };
const moveToArr = (m: LudoMove) => [m.Player, m.TokenIndex, m.FromStep, m.ToStep, m.Roll, m.CapturedPlayer, m.CapturedTokenIndex, m.CapturedFromStep];
const arrToMove = (a: number[]) => new LudoMove({
  Player: a[0], TokenIndex: a[1], FromStep: a[2], ToStep: a[3], Roll: a[4], CapturedPlayer: a[5], CapturedTokenIndex: a[6], CapturedFromStep: a[7],
});

class YardView {
  Root!: GameObject;
  OuterGlow!: SpriteRenderer; Rim!: SpriteRenderer; Fill!: SpriteRenderer; InnerCourt!: SpriteRenderer; TurnHalo!: SpriteRenderer;
  readonly SlotRings: SpriteRenderer[] = new Array(4);
  readonly SlotPads: SpriteRenderer[] = new Array(4);
  NameLabel!: TextMesh; CountLabel!: TextMesh;
}

class TokenView {
  Player = 0;
  TokenIndex = 0;
  Root!: GameObject;
  Visual!: GameObject;
  Shadow!: SpriteRenderer; Halo!: SpriteRenderer; OuterRim!: SpriteRenderer; Body!: SpriteRenderer; InnerRing!: SpriteRenderer;
  CoreIcon!: SpriteRenderer; SelectRing!: SpriteRenderer;
  CurrentWorldPos = V2.zero;
  BaseScale = 1;
  PulsePhase = 0;
  FlyT = -1;
  FlyFrom = V2.zero; FlyTo = V2.zero;
  LandSquash = 0;
}

class ConfettiBit {
  Sr!: SpriteRenderer;
  Pos = V2.zero; Vel = V2.zero;
  Rot = 0; RotSpeed = 0; Life = 0; MaxLife = 0; Flutter = 0; Size = 0;
  Active = false;
}

class TargetMarkerView {
  Root!: GameObject;
  Ring!: SpriteRenderer; Glow!: SpriteRenderer; Arrow!: SpriteRenderer; CaptureCross!: SpriteRenderer;
  MoveIndex = 0;
  WorldPos = V2.zero;
}

interface AmbientSpark { Tr: GameObject; Sr: SpriteRenderer; BasePos: V2; Phase: number; Speed: number; BaseScale: number; Color: Color }

const ConfettiColors = [Pal.hex(0xe9be5c), Pal.hex(0xfff1c9), Pal.hex(0xe0233f), Pal.hex(0x1e9e5a), Pal.hex(0x2a6de0), Pal.hex(0xf2b21b)];

const xy = (v: V2 | V3) => new V2(v.x, v.y);

// ------------------------------------------------------------------ procedural sprites

const CrownSprite = () => Art.shape("lb-crown", (p) => {
  const baseBar = -Art.roundBox(p.sub(new V2(0, -0.45)), 0.68, 0.09);
  const body = Art.poly(p,
    new V2(-0.68, -0.35),
    new V2(-0.78, 0.42),
    new V2(-0.32, 0.02),
    new V2(0, 0.58),
    new V2(0.32, 0.02),
    new V2(0.78, 0.42),
    new V2(0.68, -0.35));
  return Math.max(Art.edge(baseBar), body);
});

const DiceIconSprite = () => Art.shape("lb-dice-icon", (p) => {
  const box = Art.edge(-Art.roundBox(p, 0.85, 0.22));
  const p1 = Art.edge(0.16 - p.sub(new V2(-0.38, 0.38)).magnitude);
  const p2 = Art.edge(0.16 - p.magnitude);
  const p3 = Art.edge(0.16 - p.sub(new V2(0.38, -0.38)).magnitude);
  const pips = Math.max(p1, Math.max(p2, p3));
  return Mathf.clamp01(box - pips * 0.85);
});
void DiceIconSprite; // unused in the C# as well

const RerollSprite = () => Art.shape("lb-reroll", (p) => {
  const r = p.magnitude;
  let ring = Art.edge(0.11 - Math.abs(r - 0.62));
  if (p.x > 0.15 && p.y < 0.1 && p.y > -0.45) ring = 0;
  const head = Art.poly(p, new V2(0.78, 0.18), new V2(0.32, 0.45), new V2(0.42, -0.05));
  return Math.max(ring, head);
});

/** Keeps a HUD label inside its box: wraps off, shrinks the font down to minSize when the text is long. */
function fitLabel(t: Text, minSize: number) {
  t.horizontalOverflow = WrapMode.Wrap;
  t.resizeTextForBestFit = true;
  t.resizeTextMinSize = minSize;
  t.resizeTextMaxSize = t.fontSize;
  t.relayout();
  return t;
}

function makeWorldText(parent: GameObject, name: string, text: string, fontSize: number, charSize: number, color: Color, sortOrder: number) {
  const tm = new GameObject(name, parent).addComponent(new TextMesh());
  tm.text = text;
  tm.fontSize = fontSize;
  tm.characterSize = charSize;
  tm.anchor = "MiddleCenter";
  tm.fontStyle = "bold";
  tm.color = color;
  tm.sortingOrder = sortOrder;
  return tm;
}

const gridToBoardLocal = (gx: number, gy: number) => new V2((gx - 7) * TileStep, (gy - 7) * TileStep);

function hasOnlyOneDistinctMove(moves: LudoMove[]) {
  if (moves.length <= 1) return true;
  const firstStep = moves[0].FromStep;
  for (let i = 1; i < moves.length; i++)
    if (moves[i].FromStep !== firstStep) return false;
  return true;
}

export class LudoBlitzGame extends ArcadeGame {
  private world!: GameObject; private boardRoot: GameObject | null = null; private tokensRoot!: GameObject; private markersRoot!: GameObject;
  private diceWorldRoot: GameObject | null = null;
  private boardAura: SpriteRenderer | null = null; private crownCenterStar: SpriteRenderer | null = null; crownCenterRing!: SpriteRenderer; // unused (as in the C#)
  private readonly yardViews: YardView[] = new Array(LudoBoard.PlayerCount);
  private readonly tokenViews: TokenView[][] = Array.from({ length: LudoBoard.PlayerCount }, () => new Array<TokenView>(LudoBoard.TokensPerPlayer));
  private readonly targetMarkers: TargetMarkerView[] = [];
  private readonly ambientSparks: AmbientSpark[] = [];
  private readonly stackScratch: [number, number][] = [];

  // World 3D Dice visuals (displayed near the board / active player)
  private diceShadow!: SpriteRenderer; private diceGlow!: SpriteRenderer; private diceRim: SpriteRenderer | null = null;
  private diceFace!: SpriteRenderer; diceShine!: SpriteRenderer;
  private diceBody!: GameObject;   // tumbles and bounces above its shadow
  private diceTargetLocal = V3.zero; // the die glides between yards instead of jumping
  private diceSpinDir = 1;
  private velvetBackdrop: SpriteRenderer | null = null;
  private readonly confetti: ConfettiBit[] = [];
  private confettiCursor = 0;
  private readonly dicePips: SpriteRenderer[] = new Array(9);

  // HUD elements
  private stageTitleText!: Text; private turnBannerText!: Text; private coinCountText: Text | null = null; private subStatusText!: Text;
  private coinBadge: UINode | null = null; private diceHudCard: UINode | null = null;
  private diceHudGlow!: Image; private diceHudRim: Image | null = null; private diceHudFace!: Image;
  private readonly diceHudPips: Image[] = new Array(9);
  private diceHudPrompt!: Text; private diceHudSub!: Text;
  private diceHudButton!: ArcadeButton; private rerollButton: ArcadeButton | null = null; private goldenSixButton: ArcadeButton | null = null;
  private speedButton: ArcadeButton | null = null;
  private blitzToggleBtn: ArcadeButton | null = null; private seatsToggleBtn: ArcadeButton | null = null;

  // Audio clips
  private diceRollClip!: AudioClip; private diceLandClip!: AudioClip; private diceSixClip!: AudioClip; private hopClip!: AudioClip;
  private captureClip!: AudioClip; private homeGoalClip!: AudioClip; private bustClip!: AudioClip;

  // Match state
  private readonly state = new LudoState();
  private readonly attractState = new LudoState();
  private readonly legalMoves: LudoMove[] = [];
  private readonly attractMoves: LudoMove[] = [];
  readonly rerollScratch: LudoMove[] = []; // unused (as in the C#)
  private readonly rng = new SysRandom();

  private currentStage!: StageSpec;
  private turnPhase = TurnPhase.AwaitRoll;
  private currentRoll = 1;
  private displayDiceFace = 1;
  private isGoldenRoll = false;
  private rerollUsedThisTurn = false;
  private reviveUsedThisMatch = false;
  private matchEnded = false;
  private lastWinnerPlayer = -1;
  private localMatch = false; // pass-and-play: every active seat is a human on this device

  // Statistics for current run
  private playerCapturesThisRun = 0;
  private playerSixesThisRun = 0;
  private coinsEarnedThisRun = 0;
  private turnsPlayedThisRun = 0;

  // Dice & Hop animation state
  private phaseTimer = 0;
  private diceAnimT = 0; private diceAnimDuration = 0.42;
  private dicePipScrambleTimer = 0;
  private diceBouncePop = 0;
  private coinBadgePop = 0;

  private activeMove = new LudoMove();
  private hopCurrentStep = 0;
  private hopStepT = 0;
  private hopStepDuration = 0;
  private hopStartWorld = V2.zero; private hopEndWorld = V2.zero;

  // Attract mode
  private attractTimer = 0;
  private need = new V2(15.2, 15.2);

  // Online (private tables)
  private lobby!: TableLobby; private overlay!: TableOverlay;
  private link: OnlineLink<OStart, OEv, OSnap> | null = null;
  private online = false; // the current match is an online one
  private mySeat = HostSeat;
  private onlineStart: OStart = { seats: [HostSeat, GuestSeat], out: 2, first: HostSeat, names: OnlineCpuNames, skill: 0.6 };
  private onlineGo = false; private autoJoined = false; private forfeit = false;
  private evQueue: OEv[] = []; // guest: host events waiting for the local animation to catch up
  private optimisticTok = -1; // guest: own move already played locally, waiting for the host's echo
  private askT = 0; // guest: a roll request is on its way
  private syncT = 0; // guest: throttles snapshot requests
  private pendingAsk = -1; // host: the friend asked to roll at this event count
  private pendingPick: { tok: number; seq: number } | null = null; // host: the friend's chosen token
  private forfeitT = -1; // friend left mid-match: the stayer's result shows after this delay
  private lastPrize = 0;
  private viewFlipped = false;
  private onlineToggleBtn: ArcadeButton | null = null;

  protected Describe() {
    return new GameInfo({
      Id: "ludoblitz",
      Title: "LUDO BLITZ",
      Tagline: "ROLL. RACE. CAPTURE. GO HOME.",
      PlayLabel: "PLAY STAGE",
      Accent: RoyalGold,
      Accent2: RubyRed,
      BgTop: Pal.hex(0x4a0d1f),
      BgBottom: Pal.hex(0x0e0308),
      GridSpacing: 1.2,
      ShortSide: 15.4,
      Touch: TouchScheme.None,
      Music: { bpm: 116, rootHz: 110, degrees: [0, 4, 5, 3], seed: 37, energy: 0.58, major: true },
      Reminders: [
        "The dice are hot!|Your rivals are waiting on the Ludo Blitz circuit.",
        "Golden 6 ready|Roll a 6, capture your rivals, and claim the Crown!",
        "Tournament Stage waiting|Can you get all 4 tokens home first?",
      ],
      HowTo: [
        howTo(Art.RoundSquare, RubyRed, "You are RUBY RED (bottom-left). Race all 4 tokens clockwise into the center Crown Goal!"),
        howTo(Art.Disc, RoyalGold, "Friends nearby? Tap the mode button on the title screen until it says OFFLINE: 2, 3 or 4 PLAYERS and pass the device around."),
        howTo(Art.Ring, Pal.hex(0xff4fa0), "Friend far away? Pick ONLINE, then CREATE TABLE and send the 5-digit code (or the invite link). You both see your own colour at the bottom-left."),
        howTo(Art.Disc, AmberGold, "Roll a 6 to deploy a token from your yard AND earn a bonus roll. (Three 6s in a row forfeits the turn!)"),
        howTo(Art.Ring, Pal.Danger, "Land on a rival token on a non-safe tile to CAPTURE it back to its yard and earn a bonus roll!"),
        howTo(Art.Star, ElectricBlue, "Coloured Start tiles and glowing Star tiles are SAFE SHIELDS — no token can be captured there."),
        howTo(Art.Tri, EmeraldGreen, "Enter your coloured Home Column and roll the exact number needed to reach the center Crown Goal."),
        howTo(Art.Diamond, AmberGold, "Use COINS on LUCKY REROLL (50) or GOLDEN 6 (100) for clutch tactical plays!"),
      ],
      Tips: [
        "Capturing an opponent token grants an immediate bonus roll AND +35 Coins!",
        "Keep tokens on Star safe tiles when enemy tokens are 1 to 6 steps behind you.",
        "Save a Golden 6 for when an enemy token is exactly 6 steps ahead or to break out of your yard.",
        "Reaching the center Crown Goal with any token also awards a bonus roll!",
      ],
    });
  }

  protected get ShortSide() { return LudoBlitzGame.FitShortSide(this.need, TopBand, this.BottomBand); }
  /** Online matches keep a taller bottom band for the quick-reactions bar. */
  private get BottomBand() { return this.online && this.State !== Phase.Title && Screen.width < Screen.height ? BottomBandOnline : BottomBandBase; }

  private get CurrentStageLevel() { return Math.max(1, this.Data.get("stage", 1)); }
  private set CurrentStageLevel(v: number) { this.Data.set("stage", Math.max(1, v)); }

  private get Coins() { return this.Data.get("coins", StartingCoins); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }

  private get BlitzRules() { return this.Data.get("blitzMode", 1) === 1; }
  private set BlitzRules(v: boolean) { this.Data.set("blitzMode", v ? 1 : 0); }

  // 0 = Stage Auto, 2 = 2P Duel, 4 = 4P Royale
  private get SeatModeOverride() { return this.Data.get("seatMode", 0); }
  private set SeatModeOverride(v: number) { this.Data.set("seatMode", v); }

  // 0 = play against the computer; 2 / 3 / 4 = offline pass-and-play for that many people on one device
  private get LocalPlayers() { return this.Data.get("localPlayers", 0); }
  private set LocalPlayers(v: number) { this.Data.set("localPlayers", v); }

  /** ONLINE selected on the title screen (private table with a friend on their own device). */
  private get SelOnline() { return this.Data.get("online", 0) === 1; }
  /** Online table size: 2 = 1v1 duel, 4 = the two friends plus two CPU rivals. */
  private get OnlineSeats() { return this.Data.get("onlineSeats", 2) === 4 ? 4 : 2; }

  private get FriendSeat() { return this.mySeat === HostSeat ? GuestSeat : HostSeat; }
  private get IsHost() { return !this.link || this.link.isHost; }

  /** True when this seat is controlled by a person (seat 0 vs the computer; every seat in pass-and-play; both friends online). */
  private IsHuman(seat: number) {
    if (this.online) return seat === HostSeat || seat === GuestSeat;
    return this.localMatch ? seat >= 0 && seat < LudoBoard.PlayerCount && this.state.ActivePlayers[seat] : seat === 0;
  }

  /** True when this seat takes input on this device (online: only my own seat, and only while the friend is there). */
  private IsLocal(seat: number) {
    if (!this.online) return this.IsHuman(seat);
    return seat === this.mySeat && !!this.link && this.link.connected && !this.overlay.busy;
  }

  /** Online seats whose rolls and moves arrive from the network: everything but my seat on the guest; the friend's seat on the host. */
  private IsRemote(seat: number) { return this.online && (this.IsHost ? seat === this.FriendSeat : seat !== this.mySeat); }

  private SeatName(seat: number) {
    if (this.online) return seat === this.mySeat ? "YOU" : seat === this.FriendSeat ? "FRIEND" : this.currentStage.RivalNames[Mathf.clamp(seat - 1, 0, 2)];
    return this.localMatch ? SeatNames[seat] : seat === 0 ? "YOU" : this.currentStage.RivalNames[Mathf.clamp(seat - 1, 0, 2)];
  }

  protected BestLine() {
    if (this.SelOnline) return `PRIVATE TABLE   ·   PLAY A FRIEND ON THEIR OWN PHONE   ·   WIN ${OnlinePrize} COINS`;
    const st = this.CurrentStageLevel;
    const spec = LudoBoard.GetStage(st);
    return `STAGE ${st}   ·   ${spec.ArenaName} (${spec.Subtitle})`;
  }

  protected StatsLine() {
    const wins = this.Data.get("wins", 0);
    const caps = this.Data.get("captures", 0);
    return wins > 0 || caps > 0
      ? `${wins} WINS   ·   ${caps} CAPTURES   ·   ${this.Coins} COINS`
      : "CLASSIC CROSS-BOARD RACING   ·   TACTICAL AI RIVALS";
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("initCoins", 0) === 0) {
      this.Data.set("initCoins", 1);
      this.Data.set("coins", StartingCoins);
    }

    this.world = new GameObject("LudoWorld", this.gameObject);

    this.BuildRoyalAtmosphere();
    this.BuildAmbientSparks();
    this.BuildBoardVisuals();
    this.BuildTokensPool();
    this.BuildTargetMarkers();
    this.BuildWorldDice();
    this.BuildAudio();
    this.BuildHud();
    this.BuildOnline();
    this.BuildTitleExtras();
    this.UpdateLayout();
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__lb = { game: this };
  }

  // ------------------------------------------------------------------ royal atmosphere

  /**
   * Velvet backdrop over the shared neon backdrop, and a calmer post-process for a premium (non-neon) look.
   * Only this scene's own post-process profile is touched; other games are unaffected.
   */
  private BuildRoyalAtmosphere() {
    this.velvetBackdrop = LudoArt.Spr(this.world, "VelvetBackdrop", LudoArt.Velvet, Color.white, 1, -900);

    // C#: bloom threshold 1.2, chromatic aberration off, vignette unchanged (0.3).
    CasualLook.calm(this, 1.2, 0.3);

    const confettiRoot = new GameObject("Confetti", this.world);
    for (let i = 0; i < ConfettiCount; i++) {
      const sr = LudoArt.Spr(confettiRoot, "Bit_" + i, i % 4 === 0 ? Art.Disc : Art.Square, Color.white, 0.18, 80);
      sr.gameObject.setActive(false);
      this.confetti.push(Object.assign(new ConfettiBit(), { Sr: sr }));
    }
  }

  private BuildAmbientSparks() {
    // Slow gold dust drifting upward through the velvet, behind the board.
    const sparkRng = new SysRandom(404);
    for (let i = 0; i < 30; i++) {
      const c = i % 5 === 0 ? Pal.hex(0xfff1c9) : RoyalGold;
      const sr = Art.spr(this.world, "Dust_" + i, LudoArt.Soft, c.withAlpha(0.3), 0.2, -850, Art.Additive);
      this.ambientSparks.push({
        Tr: sr.transform,
        Sr: sr,
        BasePos: new V2(sparkRng.nextDouble() * 20.0 - 10.0, sparkRng.nextDouble() * 32.0 - 16.0),
        Phase: sparkRng.nextDouble() * Math.PI * 2.0,
        Speed: 0.25 + sparkRng.nextDouble() * 0.45,
        BaseScale: 0.10 + sparkRng.nextDouble() * 0.22,
        Color: c,
      });
    }
  }

  private BuildBoardVisuals() {
    const boardRoot = (this.boardRoot = new GameObject("BoardRoot", this.world));

    const fullSize = 15 * TileStep + 0.55;

    // Walnut board in a gold frame, casting a soft shadow on the velvet.
    this.boardAura = LudoArt.Spr(boardRoot, "BoardAura", LudoArt.Soft, RubyRed.withAlpha(0.18), fullSize * 1.55, -13);
    const shadow = LudoArt.Spr(boardRoot, "BoardShadow", LudoArt.Soft, new Color(0, 0, 0, 0.75), fullSize * 1.22, -12);
    shadow.transform.localPosition = new V3(0.18, -0.42, 0);
    LudoArt.Spr(boardRoot, "GoldFrame", LudoArt.GoldFrame, Color.white, fullSize + 0.62, -11);
    LudoArt.Spr(boardRoot, "Walnut", LudoArt.Wood, Color.white, fullSize, -10);

    // 1. Four corner yards
    for (let p = 0; p < LudoBoard.PlayerCount; p++) this.BuildCornerYard(p);

    // 2. 52 outer track squares: ivory tiles inlaid in the walnut
    for (let idx = 0; idx < LudoBoard.TrackLength; idx++) {
      const tc = LudoBoard.TrackCoords[idx];
      const localPos = gridToBoardLocal(tc.x, tc.y);
      const tileRoot = new GameObject("Track_" + idx, boardRoot);
      tileRoot.localPosition = localPos;

      const [isStart, startOwner] = LudoBoard.IsStartTrack(idx);
      const isStar = LudoBoard.IsStarTrack(idx);

      const fillCol = isStart ? PlayerColors[startOwner] : LudoArt.Ivory;
      LudoArt.Spr(tileRoot, "Tile", LudoArt.Bevel, fillCol, TileStep * 0.92, -6);

      if (isStart) {
        const chev = LudoArt.Spr(tileRoot, "StartChevron", Art.Chevron, Color.white.withAlpha(0.92), TileStep * 0.44, -4);
        // Point along player's initial direction: P0=UP(90), P1=RIGHT(0), P2=DOWN(-90), P3=LEFT(180)
        const rotZ = startOwner === 0 ? 90 : startOwner === 1 ? 0 : startOwner === 2 ? -90 : 180;
        chev.transform.localRotation = Quaternion.euler(0, 0, rotZ);
      } else if (isStar) {
        // Gold star inlay with a subtle engraved shadow
        const engr = LudoArt.Spr(tileRoot, "StarShadow", Art.Star, LudoArt.GoldDeep.withAlpha(0.55), TileStep * 0.62, -5);
        engr.transform.localPosition = new V3(0.025, -0.035, 0);
        LudoArt.Spr(tileRoot, "StarIcon", Art.Star, RoyalGold, TileStep * 0.60, -4);
      }
    }

    // 3. Four coloured home columns (steps 51..55), brightening toward the crown
    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      const pCol = PlayerColors[p];
      const rotZ = p === 0 ? 90 : p === 1 ? 0 : p === 2 ? -90 : 180;

      for (let step = LudoBoard.HomeEntryStep + 1; step < LudoBoard.GoalStep; step++) {
        const hc = LudoBoard.HomeStretchCoord(p, step);
        const localPos = gridToBoardLocal(hc.x, hc.y);
        const hRoot = new GameObject(`HomeCol_P${p}_${step}`, boardRoot);
        hRoot.localPosition = localPos;

        const k = (step - LudoBoard.HomeEntryStep) / 5;
        const tileFill = Color.lerp(PlayerDarkColors[p], pCol, 0.55 + 0.45 * k);
        LudoArt.Spr(hRoot, "Tile", LudoArt.Bevel, tileFill, TileStep * 0.92, -6);
        const chev = LudoArt.Spr(hRoot, "Arrow", Art.Chevron, Color.white.withAlpha(0.5), TileStep * 0.34, -4);
        chev.transform.localRotation = Quaternion.euler(0, 0, rotZ);
      }
    }

    // 4. Center 3x3 crown goal
    this.BuildCenterCrownGoal();
  }

  private BuildCornerYard(p: number) {
    const col = PlayerColors[p];
    const dark = PlayerDarkColors[p];
    const yardGrid = LudoBoard.YardCenterGrid(p);
    const localCenter = gridToBoardLocal(yardGrid.x, yardGrid.y);

    const yv = new YardView();
    yv.Root = new GameObject("Yard_P" + p, this.boardRoot);
    yv.Root.localPosition = localCenter;

    const yardSpan = 6 * TileStep - 0.10;
    yv.OuterGlow = LudoArt.Spr(yv.Root, "YardShadow", LudoArt.Soft, new Color(0, 0, 0, 0.35), yardSpan * 1.2, -8);
    yv.OuterGlow.transform.localPosition = new V3(0.06, -0.12, 0);
    // Gold border that lights up on this player's turn
    yv.TurnHalo = LudoArt.Spr(yv.Root, "TurnHalo", Art.RoundSquare, RoyalGold.withAlpha(0), yardSpan + 0.30, -7);
    yv.Rim = LudoArt.Spr(yv.Root, "YardRim", LudoArt.Bevel, col, yardSpan, -6);
    yv.Fill = LudoArt.Spr(yv.Root, "YardPanel", LudoArt.Bevel, Color.lerp(col, Color.white, 0.10), yardSpan - 0.34, -5);
    Art.spr(yv.Root, "InnerCourtRim", Art.RoundSquare, RoyalGold, yardSpan * 0.735, -4, Art.Flat);
    yv.InnerCourt = LudoArt.Spr(yv.Root, "InnerCourt", LudoArt.Bevel, LudoArt.Ivory, yardSpan * 0.70, -3);

    for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
      const slotGrid = LudoBoard.YardSlotGrid(p, t);
      const slotOffset = slotGrid.sub(yardGrid).mul(TileStep);

      const ring = LudoArt.Spr(yv.Root, "SlotRing_" + t, Art.Ring, RoyalGold, TileStep * 1.10, -2);
      ring.transform.localPosition = slotOffset;
      yv.SlotRings[t] = ring;

      const pad = LudoArt.Spr(yv.Root, "SlotPad_" + t, LudoArt.Pit, Color.lerp(dark, col, 0.45), TileStep * 0.90, -1);
      pad.transform.localPosition = slotOffset;
      yv.SlotPads[t] = pad;
    }

    // Player name & home count on the coloured border
    const topYard = p === 1 || p === 2;
    const bannerY = topYard ? yardSpan * 0.425 : -yardSpan * 0.425;
    const countY = topYard ? -yardSpan * 0.425 : yardSpan * 0.425;

    yv.NameLabel = makeWorldText(yv.Root, "Name", p === 0 ? "YOU" : "AI", 44, 0.055, Color.white, 0);
    yv.NameLabel.transform.localPosition = new V3(0, bannerY, 0);

    yv.CountLabel = makeWorldText(yv.Root, "HomeCount", "HOME 0/4", 36, 0.044, Pal.hex(0xfff1c9), 0);
    yv.CountLabel.transform.localPosition = new V3(0, countY, 0);

    this.yardViews[p] = yv;
  }

  private BuildCenterCrownGoal() {
    const cRoot = new GameObject("CrownGoal", this.boardRoot);
    cRoot.localPosition = V3.zero;

    const span = 3 * TileStep;
    LudoArt.Spr(cRoot, "GoalRim", LudoArt.Bevel, RoyalGold, span, -6);
    LudoArt.Spr(cRoot, "GoalBase", LudoArt.Bevel, Pal.hex(0x3a0a16), span - 0.18, -5);

    // 4 coloured home triangles pointing toward the center
    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      const dir = p === 0 ? new V2(0, -1) : p === 1 ? new V2(-1, 0) : p === 2 ? new V2(0, 1) : new V2(1, 0);
      const rotZ = p === 0 ? 90 : p === 1 ? 0 : p === 2 ? -90 : 180;

      const tri = LudoArt.Spr(cRoot, "GoalTri_P" + p, Art.Tri, PlayerColors[p], TileStep * 1.30, -4);
      tri.transform.localPosition = dir.mul(TileStep * 0.76);
      tri.transform.localRotation = Quaternion.euler(0, 0, rotZ);
    }

    // Gold-rimmed crown medallion
    LudoArt.Spr(cRoot, "MedallionShadow", LudoArt.Soft, new Color(0, 0, 0, 0.5), TileStep * 1.9, -3);
    LudoArt.Spr(cRoot, "MedallionRim", LudoArt.Dome, RoyalGold, TileStep * 1.30, -2);
    this.crownCenterRing = LudoArt.Spr(cRoot, "MedallionFace", LudoArt.Dome, Pal.hex(0x8e1630), TileStep * 1.06, -1);
    this.crownCenterStar = LudoArt.Spr(cRoot, "CrownIcon", CrownSprite(), Pal.hex(0xffd978), TileStep * 0.68, 0);
    LudoArt.Spr(cRoot, "MedallionGloss", LudoArt.Gloss, Color.white.withAlpha(0.55), TileStep * 1.10, 1);
  }

  private BuildTokensPool() {
    this.tokensRoot = new GameObject("Tokens", this.world);

    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      const col = PlayerColors[p];
      const hi = PlayerHighlightColors[p];

      for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
        const tv = new TokenView();
        tv.Player = p;
        tv.TokenIndex = t;
        tv.PulsePhase = (p * 4 + t) * 0.7;
        tv.Root = new GameObject(`Token_P${p}_${t}`, this.tokensRoot);

        tv.Shadow = LudoArt.Spr(tv.Root, "Shadow", LudoArt.Soft, new Color(0, 0, 0, 0.55), TokenShadowSize, 10);
        tv.Shadow.transform.localPosition = new V3(0.05, -0.09, 0);

        tv.SelectRing = Art.spr(tv.Root, "SelectRing", Art.Ring, RoyalGold, TileStep * 1.18, 11, Art.Flat);
        tv.SelectRing.gameObject.setActive(false);

        tv.Visual = new GameObject("Visual", tv.Root);

        // A glossy jewel pawn seen from above: gold base ring, coloured body, raised head, highlight.
        tv.Halo = LudoArt.Spr(tv.Visual, "Halo", LudoArt.Soft, col.withAlpha(0.30), TileStep * 1.25, 11);
        tv.OuterRim = LudoArt.Spr(tv.Visual, "BaseRing", LudoArt.Dome, RoyalGold, TileStep * 0.84, 12);
        tv.Body = LudoArt.Spr(tv.Visual, "Body", LudoArt.Dome, col, TileStep * 0.70, 13);
        tv.InnerRing = LudoArt.Spr(tv.Visual, "Head", LudoArt.Dome, hi, TileStep * 0.40, 14);
        tv.InnerRing.transform.localPosition = new V3(-0.02, 0.03, 0);
        tv.CoreIcon = LudoArt.Spr(tv.Visual, "Gloss", LudoArt.Gloss, Color.white.withAlpha(0.85), TileStep * 0.66, 15);

        this.tokenViews[p][t] = tv;
      }
    }
  }

  private BuildTargetMarkers() {
    this.markersRoot = new GameObject("TargetMarkers", this.world);

    for (let i = 0; i < LudoBoard.TokensPerPlayer; i++) {
      const tm = new TargetMarkerView();
      tm.Root = new GameObject("TargetMarker_" + i, this.markersRoot);

      tm.Glow = Art.spr(tm.Root, "Glow", LudoArt.Soft, RoyalGold.withAlpha(0.45), TileStep * 1.55, 20, Art.Additive);
      tm.Ring = Art.spr(tm.Root, "Ring", Art.Ring, RoyalGold, TileStep * 0.96, 21, Art.Flat);
      tm.CaptureCross = Art.spr(tm.Root, "CaptureStar", Art.Star, Pal.hex(0xfff1c9), TileStep * 0.55, 22, Art.Flat);
      tm.Arrow = Art.spr(tm.Root, "Arrow", Art.Chevron, RoyalGold, TileStep * 0.48, 23, Art.Flat);
      tm.Arrow.transform.localRotation = Quaternion.euler(0, 0, -90); // Pointing down at tile
      tm.Arrow.transform.localPosition = new V3(0, TileStep * 0.58, 0);

      tm.Root.setActive(false);
      this.targetMarkers.push(tm);
    }
  }

  private BuildWorldDice() {
    const diceWorldRoot = (this.diceWorldRoot = new GameObject("WorldDice", this.boardRoot));

    // Shadow stays on the board; the body above it tumbles and bounces.
    this.diceShadow = LudoArt.Spr(diceWorldRoot, "Shadow", LudoArt.Soft, new Color(0, 0, 0, 0.6), DiceShadowSize, 25);
    this.diceShadow.transform.localPosition = new V3(0.08, -0.14, 0);

    this.diceBody = new GameObject("Body", diceWorldRoot);

    this.diceGlow = LudoArt.Spr(this.diceBody, "Glow", LudoArt.Soft, RoyalGold.withAlpha(0), 2.3, 25);
    this.diceRim = LudoArt.Spr(this.diceBody, "Side", LudoArt.DiceBevel, Pal.hex(0xb9a68e), 1.12, 26);
    this.diceRim.transform.localPosition = new V3(0.06, -0.085, 0); // cube depth
    this.diceFace = LudoArt.Spr(this.diceBody, "Face", LudoArt.DiceBevel, LudoArt.Ivory, 1.12, 27);
    this.diceShine = LudoArt.Spr(this.diceBody, "Shine", LudoArt.Gloss, Color.white.withAlpha(0.55), 1.0, 30);

    for (let i = 0; i < 9; i++) {
      const pip = LudoArt.Spr(this.diceBody, "Pip_" + i, LudoArt.Pit, Ebony, 0.21, 29);
      pip.transform.localPosition = PipOffsets[i].mul(1.12);
      this.dicePips[i] = pip;
    }
  }

  // ------------------------------------------------------------------ confetti

  private SpawnConfetti(origin: V2, count: number, power: number) {
    for (let n = 0; n < count; n++) {
      const c = this.confetti[this.confettiCursor];
      this.confettiCursor = (this.confettiCursor + 1) % this.confetti.length;
      const a = Random.range(Math.PI * 0.12, Math.PI * 0.88);
      const sp = power * Random.range(0.45, 1);
      c.Pos = origin;
      c.Vel = new V2(Math.cos(a) * sp * 0.8, Math.sin(a) * sp);
      this.StartBit(c, 1.4 + Random.range(0, 0.8));
    }
  }

  /** Victory shower falling from the top of the screen. */
  private SpawnConfettiShower(count: number) {
    const h = Camera.orthographicSize, w = h * Camera.aspect;
    for (let n = 0; n < count; n++) {
      const c = this.confetti[this.confettiCursor];
      this.confettiCursor = (this.confettiCursor + 1) % this.confetti.length;
      c.Pos = new V2(Random.range(-w, w), h + Random.range(0.2, 3.5));
      c.Vel = new V2(Random.range(-1, 1), Random.range(-3.5, -1.5));
      this.StartBit(c, 3.2 + Random.range(0, 1.2));
    }
  }

  private StartBit(c: ConfettiBit, life: number) {
    c.Active = true;
    c.Life = 0;
    c.MaxLife = life;
    c.Rot = Random.range(0, 360);
    c.RotSpeed = Random.range(-540, 540);
    c.Flutter = Random.range(0, Math.PI * 2);
    c.Size = Random.range(0.12, 0.24);
    c.Sr.color = ConfettiColors[Random.rangeInt(0, ConfettiColors.length)];
    c.Sr.gameObject.setActive(true);
  }

  private AnimateConfetti(dt: number) {
    for (let i = 0; i < this.confetti.length; i++) {
      const c = this.confetti[i];
      if (!c.Active) continue;
      c.Life += dt;
      if (c.Life >= c.MaxLife) {
        c.Active = false;
        c.Sr.gameObject.setActive(false);
        continue;
      }
      // Gravity with air drag and a paper-like sideways flutter
      c.Vel = c.Vel.withY(c.Vel.y - 9.5 * dt);
      c.Vel = c.Vel.mul(1 - Math.min(1, 1.6 * dt));
      c.Vel = c.Vel.withY(Math.max(c.Vel.y, -3.2));
      c.Pos = c.Pos.add(c.Vel.mul(dt)).add(new V2(Math.sin(c.Life * 7 + c.Flutter) * 0.9 * dt, 0));
      c.Rot += c.RotSpeed * dt;
      const flip = Math.abs(Math.cos(c.Life * 9 + c.Flutter)); // tumbling paper
      const tr = c.Sr.transform;
      tr.position = new V3(c.Pos.x, c.Pos.y, 0);
      tr.localRotation = Quaternion.euler(0, 0, c.Rot);
      tr.localScale = new V3(c.Size, c.Size * (0.25 + 0.75 * flip), 1);
      const fade = Mathf.clamp01((c.MaxLife - c.Life) / 0.5);
      c.Sr.color = c.Sr.color.withAlpha(fade);
    }
  }

  private BuildAudio() {
    const noiseRng = new SysRandom(73);
    const Noise = () => noiseRng.nextDouble() * 2 - 1;

    this.diceRollClip = Sfx.make("lb-diceroll", 0.34, (t) => {
      const clickRate = t % 0.055;
      const click = Sfx.sinP(Sfx.glide(clickRate, 1400, 420, 0.04)) * Sfx.env(clickRate, 0.001, 0.03);
      return (click * 0.65 + Noise() * Sfx.env(clickRate, 0.001, 0.018) * 0.25) * 0.32;
    });

    this.diceLandClip = Sfx.make("lb-diceland", 0.16, (t) =>
      (Sfx.sinP(Sfx.glide(t, 360, 110, 0.12)) * 0.7 + Noise() * Sfx.env(t, 0.001, 0.03) * 0.3)
      * Sfx.env(t, 0.002, 0.11) * 0.38);

    this.diceSixClip = Sfx.make("lb-dicesix", 0.45, (t) => {
      const f = t < 0.11 ? 587.33 : t < 0.22 ? 783.99 : 1174.66;
      const lt = t % 0.11;
      return (Sfx.sinP(f * t) + 0.35 * Sfx.triP(f * 2 * t)) * Sfx.env(lt, 0.003, 0.18) * 0.26;
    });

    this.hopClip = Sfx.make("lb-hop", 0.11, (t) =>
      (Sfx.sinP(Sfx.glide(t, 440, 680, 0.09)) * 0.75 + Sfx.triP(880 * t) * 0.25)
      * Sfx.env(t, 0.002, 0.08) * 0.24);

    this.captureClip = Sfx.make("lb-capture", 0.52, (t) => {
      const sweep = Sfx.sawP(Sfx.glide(t, 520, 95, 0.42)) * 0.45;
      const boom = Sfx.sinP(Sfx.glide(t, 180, 48, 0.45)) * 0.55;
      return (sweep + boom + Noise() * Sfx.env(t, 0.001, 0.12) * 0.35) * Sfx.env(t, 0.003, 0.42) * 0.42;
    });

    this.homeGoalClip = Sfx.make("lb-home", 0.58, (t) => {
      const f = t < 0.12 ? 523.25 : t < 0.24 ? 659.25 : t < 0.36 ? 783.99 : 1046.5;
      const lt = t % 0.12;
      return (Sfx.sinP(f * t) + 0.4 * Sfx.sinP(f * 2 * t)) * Sfx.env(lt, 0.003, 0.20) * 0.28;
    });

    this.bustClip = Sfx.make("lb-bust", 0.42, (t) => {
      const f = t < 0.18 ? 349.23 : 233.08;
      return Sfx.sqrP(f * t) * Sfx.env(t % 0.18, 0.003, 0.15) * 0.18;
    });
  }

  private BuildHud() {
    const hud = this.UI.Hud;

    // Top-Left Coin Badge
    const coinBadge = (this.coinBadge = UIKit.node("CoinBadge", hud).place(new V2(0, 1), new V2(185, -85), new V2(265, 88)));
    UIKit.img(coinBadge, "Bg", Art.UiRound, Pal.hex(0x2b160b, 0.94)).rectTransform.stretch();
    UIKit.img(coinBadge, "Edge", Art.UiOutline, RoyalGold).rectTransform.stretch();
    const coinIcon = UIKit.img(coinBadge, "StarCoin", Art.UiCircle, RoyalGold);
    coinIcon.rectTransform.place(new V2(0, 0.5), new V2(48, 0), new V2(54, 54));
    const coinMark = UIKit.img(coinIcon.rectTransform, "Mark", Art.Star, Pal.hex(0x7a4e10));
    coinMark.rectTransform.stretch(12);
    this.coinCountText = UIKit.at(UIKit.label(coinBadge, "250", 40, Pal.hex(0xfff1c9), TextAnchor.MiddleLeft),
      new V2(0, 0.5), new V2(168, 0), new V2(160, 64));

    // Header rows. Row 1: the stage title sits in the gap between the coin badge (left) and the
    // speed / pause buttons (right). Rows 2-3 run full width below them. Every text shrinks to fit its
    // box instead of spilling over its neighbours.
    this.stageTitleText = fitLabel(UIKit.at(UIKit.label(hud, "STAGE 1 · NEON CLUB", 40, Pal.hex(0xffe7a8)),
      new V2(0.5, 1), new V2(24, -85), new V2(460, 76)), 22);
    UIKit.glow(this.stageTitleText, Pal.hex(0x5a1a08, 0.9), 3);

    this.turnBannerText = fitLabel(UIKit.at(UIKit.label(hud, "YOUR TURN — TAP DICE TO ROLL", 34, RubyRed),
      new V2(0.5, 1), new V2(0, -170), new V2(960, 48)), 20);
    UIKit.glow(this.turnBannerText, new Color(0, 0, 0, 0.7), 2);

    this.subStatusText = fitLabel(UIKit.at(UIKit.label(hud, "", 25, Pal.TextDim),
      new V2(0.5, 1), new V2(0, -216), new V2(960, 36)), 16);

    // Speed Toggle Button (Top-Right, left of Pause button)
    this.speedButton = UIKit.buttonAt(hud, "1X", new V2(1, 1), new V2(-215, -85), new V2(110, 110),
      false, () => this.ToggleSpeedMultiplier(), 34);
    this.speedButton.setAccent(RoyalGold);

    // Bottom Control Dock:
    // Left: LUCKY REROLL (50 Coins)
    this.rerollButton = UIKit.buttonAt(hud, "REROLL · 50", new V2(0.5, 0), new V2(-345, 118), new V2(275, 118),
      false, () => this.OnRerollPressed(), 26, RerollSprite());
    this.rerollButton.setAccent(ElectricBlue);

    // Right: GOLDEN 6 (100 Coins)
    this.goldenSixButton = UIKit.buttonAt(hud, "GOLDEN 6 · 100", new V2(0.5, 0), new V2(345, 118), new V2(275, 118),
      false, () => this.OnGoldenSixPressed(), 25, CrownSprite());
    this.goldenSixButton.setAccent(RoyalGold);

    // Center: Interactive 3D Dice Roller Button Card
    this.diceHudButton = UIKit.buttonAt(hud, "", new V2(0.5, 0), new V2(0, 122), new V2(360, 146),
      false, () => this.OnDiceActionTriggered(), 32);
    this.diceHudButton.setAccent(RubyRed);
    const diceHudCard = (this.diceHudCard = this.diceHudButton.node);

    // Visual 3D die on left side of the center Dice Button
    const dieVisualRoot = UIKit.node("DieIconRoot", diceHudCard).place(new V2(0, 0.5), new V2(82, 0), new V2(108, 108));
    this.diceHudGlow = UIKit.img(dieVisualRoot, "Glow", Art.Glow, RubyRed.withAlpha(0.45));
    this.diceHudGlow.rectTransform.stretch(-28);
    this.diceHudRim = UIKit.img(dieVisualRoot, "Rim", Art.UiRound, RubyRed);
    this.diceHudRim.rectTransform.stretch();
    this.diceHudFace = UIKit.img(dieVisualRoot, "Face", Art.UiRound, LudoArt.Ivory);
    this.diceHudFace.rectTransform.stretch(8);

    for (let i = 0; i < 9; i++) {
      const pipImg = UIKit.img(dieVisualRoot, "Pip_" + i, Art.UiCircle, Ebony);
      pipImg.rectTransform.place(UIKit.Center, PipOffsets[i].mul(86), new V2(18, 18));
      this.diceHudPips[i] = pipImg;
    }

    this.diceHudPrompt = UIKit.at(UIKit.label(diceHudCard, "TAP TO ROLL", 34, Color.white, TextAnchor.MiddleLeft),
      new V2(0, 0.5), new V2(248, 18), new V2(200, 50));
    this.diceHudSub = UIKit.at(UIKit.label(diceHudCard, "YOUR DICE", 24, Pal.TextDim, TextAnchor.MiddleLeft),
      new V2(0, 0.5), new V2(248, -22), new V2(200, 36));

    this.UpdateDiceVisuals(6, RubyRed, false);
  }

  private BuildTitleExtras() {
    if (!this.UI.TitleExtra) return;

    this.blitzToggleBtn = UIKit.buttonAt(this.UI.TitleExtra, "START: CLASSIC", UIKit.Center, new V2(-330, 0), new V2(318, 86),
      false, () => {
        this.BlitzRules = !this.BlitzRules;
        this.RefreshTitleExtraButtons();
      }, 24);

    this.seatsToggleBtn = UIKit.buttonAt(this.UI.TitleExtra, "RIVALS: STAGE AUTO", UIKit.Center, new V2(0, 0), new V2(318, 86),
      false, () => {
        if (this.SelOnline) {
          this.Data.set("onlineSeats", this.OnlineSeats === 2 ? 4 : 2);
          this.RefreshTitleExtraButtons();
          return;
        }
        const local = this.LocalPlayers;
        if (local === 0) {
          const cur = this.SeatModeOverride;
          if (cur === 4) { this.SeatModeOverride = 0; this.LocalPlayers = 2; }
          else this.SeatModeOverride = cur === 0 ? 2 : 4;
        } else this.LocalPlayers = local >= 4 ? 0 : local + 1;
        this.RefreshTitleExtraButtons();
      }, 24);

    // ONLINE: a private table with a friend on their own device (PLAY then opens the PRIVATE TABLE panel)
    this.onlineToggleBtn = UIKit.buttonAt(this.UI.TitleExtra, "ONLINE", UIKit.Center, new V2(330, 0), new V2(318, 86),
      false, () => {
        this.Data.set("online", this.SelOnline ? 0 : 1);
        this.RefreshTitleExtraButtons();
      }, 24);

    this.RefreshTitleExtraButtons();
  }

  private RefreshTitleExtraButtons() {
    if (this.blitzToggleBtn) {
      const blitz = this.BlitzRules;
      if (this.blitzToggleBtn.label) this.blitzToggleBtn.label.text = blitz ? "START: BLITZ (2 OUT)" : "START: CLASSIC";
      this.blitzToggleBtn.setAccent(blitz ? AmberGold : ElectricBlue);
    }
    if (this.seatsToggleBtn) {
      const m = this.SeatModeOverride;
      const local = this.LocalPlayers;
      if (this.seatsToggleBtn.label)
        this.seatsToggleBtn.label.text = this.SelOnline ? (this.OnlineSeats === 4 ? "TABLE: 2 + 2 CPU" : "TABLE: 1v1 DUEL")
          : local >= 2 ? `OFFLINE: ${local} PLAYERS`
          : m === 2 ? "VS AI: 1v1 DUEL" : m === 4 ? "VS AI: 4P ROYALE" : "VS AI: STAGE AUTO";
      this.seatsToggleBtn.setAccent(this.SelOnline ? AmberGold : local >= 2 ? RoyalGold : m === 4 ? RubyRed : m === 2 ? EmeraldGreen : ElectricBlue);
    }
    if (this.onlineToggleBtn) {
      const on = this.SelOnline;
      if (this.onlineToggleBtn.label) this.onlineToggleBtn.label.text = on ? "● ONLINE" : "ONLINE";
      this.onlineToggleBtn.setAccent(on ? Pal.hex(0xff4fa0) : new Color(1, 1, 1, 0.45));
    }
    const play = (this.UI as unknown as { playButton?: ArcadeButton }).playButton;
    if (play && play.label) play.label.text = this.SelOnline ? "PLAY ONLINE" : "PLAY STAGE";
    if (this.State === Phase.Title) this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  // ------------------------------------------------------------------ layout & coordinate conversion

  private GridToWorld(gridPos: V2) {
    const local = gridToBoardLocal(gridPos.x, gridPos.y);
    return xy(this.boardRoot!.transformPoint(local));
  }

  protected OnLayoutChanged() { this.UpdateLayout(); if (this.overlay) this.PlaceReactions(); }

  private UpdateLayout() {
    if (!this.boardRoot) return;
    const r = this.PlayRect(TopBand, this.BottomBand, 0.22);
    this.Fx.CameraTarget = V2.zero;

    const boardWorldSpan = 15 * TileStep + 0.7;
    const avail = Math.min(r.width, r.height);
    const scale = Mathf.clamp(avail / boardWorldSpan, 0.65, 1.18);

    this.boardRoot.localPosition = new V3(r.center.x, r.center.y, 0);
    this.boardRoot.localScale = new V3(scale, scale, 1);
    this.tokensRoot.localScale = V3.one;
    this.markersRoot.localScale = V3.one;

    this.PositionWorldDiceForPlayer(this.state.CurrentTurn, true);
    this.SnapAllTokensToLogicalPositions();

    // Velvet backdrop always covers the whole view
    if (this.velvetBackdrop) {
      const h = Camera.orthographicSize * 2 * 1.25;
      this.velvetBackdrop.transform.localScale = new V3(h * Camera.aspect, h, 1);
    }
  }

  private PositionWorldDiceForPlayer(player: number, snap = false) {
    if (!this.diceWorldRoot) return;
    // The die sits on the active player's yard; it glides there (see AnimateAmbient) unless snapping.
    const yardGrid = LudoBoard.YardCenterGrid(player);
    this.diceTargetLocal = gridToBoardLocal(yardGrid.x, yardGrid.y).toV3();
    if (snap) this.diceWorldRoot.localPosition = this.diceTargetLocal;
    this.diceWorldRoot.localScale = V3.one.mul(0.58);
  }

  private get DicePos() { return xy(this.diceWorldRoot!.position); }

  // ------------------------------------------------------------------ lifecycle & match setup

  protected OnEnterTitle() {
    this.LeaveTable();
    this.online = false;
    this.SetViewFlip(false);
    this.SpeedMultiplier = 1;
    this.RefreshTitleExtraButtons();
    this.SetupMatch(this.CurrentStageLevel, true);
    this.UpdateLayout();
    // an invite link (?table=12345) opens the join panel and joins straight away
    const code = tableCodeFromUrl();
    if (code && !this.autoJoined) {
      this.autoJoined = true;
      this.Data.set("online", 1);
      this.RefreshTitleExtraButtons();
      this.lobby.open("join", code);
    }
  }

  protected BeginRun() {
    this.SpeedMultiplier = 1;
    if (this.speedButton && this.speedButton.label) this.speedButton.label.text = "1X";
    if (this.speedButton) this.speedButton.setAccent(RoyalGold);
    this.mySeat = this.online && this.link ? (this.link.isHost ? HostSeat : GuestSeat) : HostSeat;
    this.evQueue.length = 0;
    this.optimisticTok = -1;
    this.askT = 0;
    this.pendingAsk = -1;
    this.pendingPick = null;
    this.forfeitT = -1;
    this.forfeit = false;

    this.playerCapturesThisRun = 0;
    this.playerSixesThisRun = 0;
    this.coinsEarnedThisRun = 0;
    this.turnsPlayedThisRun = 0;
    this.reviveUsedThisMatch = false;
    this.matchEnded = false;
    this.lastWinnerPlayer = -1;

    this.SetupMatch(this.CurrentStageLevel, false);
    this.SetViewFlip(this.online && this.mySeat === GuestSeat);
    this.UpdateLayout();
    if (this.speedButton) this.speedButton.node.setActive(!this.online);
    this.overlay.showBar(this.online);
    this.PlaceReactions();

    if (this.online) {
      const first = this.onlineStart.first;
      this.UI.Announce(first === this.mySeat ? "YOU START" : first === this.FriendSeat ? "FRIEND STARTS" : `${this.SeatName(first)} STARTS`, PlayerColors[this.mySeat], 1.5);
      if (this.Data.get("onlineGames", 0) === 0) this.UI.Hint(`You are ${SeatNames[this.mySeat]} (bottom-left). Tap the dice on your turn, then tap a glowing token.`);
    } else if (this.localMatch) {
      this.UI.Announce(`OFFLINE · ${this.LocalPlayers} PLAYERS`, RoyalGold, 1.5);
      this.UI.Hint("Pass the device around: RED starts. Tap the dice on your turn, then tap a glowing token.");
    } else this.UI.Announce(`STAGE ${this.currentStage.StageNumber} · ${this.currentStage.ArenaName}`, RubyRed, 1.5);
    if (!this.localMatch && !this.online && this.Data.get("games", 0) === 0) {
      this.UI.Hint("Tap ROLL DICE (or press SPACE) to roll and race your Ruby Red tokens home!");
    }
    Sfx.setIntensity(0.35);
  }

  private SetupMatch(stageLevel: number, isAttract: boolean) {
    this.currentStage = LudoBoard.GetStage(stageLevel);

    let seats = this.currentStage.ActiveSeats;
    const online = !isAttract && this.online;
    this.localMatch = !isAttract && !online && this.LocalPlayers >= 2;
    if (online) {
      const st = this.onlineStart;
      seats = st.seats.slice();
      this.currentStage = {
        ...this.currentStage, ArenaName: "PRIVATE TABLE", Subtitle: seats.length > 2 ? "2 FRIENDS + 2 CPU" : "1v1 FRIENDS",
        ActiveSeats: seats, RivalNames: st.names.slice(0, 3), AiSkill: st.skill, DefaultTokensOut: st.out, WinCoins: OnlinePrize,
      };
    } else if (this.localMatch) {
      const n = this.LocalPlayers;
      seats = n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3]; // 2 players sit opposite
    } else if (!isAttract) {
      if (this.SeatModeOverride === 2) seats = [0, 2];
      else if (this.SeatModeOverride === 4) seats = [0, 1, 2, 3];
    } else {
      seats = [0, 1, 2, 3];
    }

    // coin power-ups are single-player only (online they would let one friend buy dice)
    if (this.rerollButton) this.rerollButton.node.setActive(!this.localMatch && !online);
    if (this.goldenSixButton) this.goldenSixButton.node.setActive(!this.localMatch && !online);

    const startOut = isAttract ? 2 : online ? this.onlineStart.out
      : this.BlitzRules ? Math.max(2, this.currentStage.DefaultTokensOut) : stageLevel <= 2 ? 1 : 0;

    const targetState = isAttract ? this.attractState : this.state;
    targetState.InitMatch(seats, startOut);

    if (isAttract) this.state.InitMatch(seats, startOut);

    // Update yard visuals & labels
    const state = this.state;
    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      const active = state.ActivePlayers[p];
      const yv = this.yardViews[p];
      const pName = isAttract ? SeatNames[p] : this.SeatName(p);
      yv.NameLabel.text = active ? pName : "—";
      yv.NameLabel.color = active ? Color.white : Pal.TextDim.withAlpha(0.3);
      yv.CountLabel.text = active ? `HOME ${state.HomeCount(p)}/4` : "";
      yv.OuterGlow.gameObject.setActive(active);

      for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
        this.tokenViews[p][t].Root.setActive(active);
        this.tokenViews[p][t].FlyT = -1;
      }
    }

    this.SnapAllTokensToLogicalPositions();
    this.HideTargetMarkers();
    this.BeginPlayerTurn(online ? this.onlineStart.first : 0, false);
  }

  private BeginPlayerTurn(player: number, isBonusTurn: boolean) {
    this.state.CurrentTurn = player;
    if (!isBonusTurn) this.state.ConsecutiveSixes = 0;

    this.turnPhase = TurnPhase.AwaitRoll;
    this.isGoldenRoll = false;
    this.rerollUsedThisTurn = false;
    this.legalMoves.length = 0;
    this.HideTargetMarkers();
    this.PositionWorldDiceForPlayer(player);
    this.UpdateDiceVisuals(this.currentRoll, PlayerColors[player], false);

    // AI rolls automatically after a brisk pause
    this.phaseTimer = this.IsHuman(player) ? 0 : 0.36;
    if (this.localMatch && this.State === Phase.Playing && !isBonusTurn)
      this.UI.Float(this.DicePos, `${SeatNames[player]}'S TURN`, PlayerColors[player], 0.9);
    if (this.online && this.State === Phase.Playing && !isBonusTurn && player === this.mySeat)
      this.UI.Float(this.DicePos, "YOUR TURN!", PlayerColors[player], 0.9);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ Title Attract Mode

  protected TickBackground(dt: number) {
    this.lobby.tick(Time.unscaledDeltaTime);
    this.overlay.tick();
    this.AnimateAmbient(dt);
    this.AnimateTokens(dt);

    if (this.State !== Phase.Title) return;

    this.attractTimer -= dt;
    if (this.attractTimer > 0) return;
    this.attractTimer = 0.55;

    // Play an automated AI move on the board in the background
    const state = this.state;
    const p = state.CurrentTurn;
    const roll = this.rng.next(1, 7);
    this.UpdateDiceVisuals(roll, PlayerColors[p], roll === 6);
    this.diceBouncePop = 1;

    state.GetLegalMoves(p, roll, this.attractMoves);
    if (this.attractMoves.length > 0) {
      const m = LudoAi.ChooseMove(state, this.attractMoves, 0.7, this.rng);
      state.ApplyMove(m);
      if (m.HasCapture) {
        const capPos = this.GetStepWorldPos(m.Player, m.ToStep, m.TokenIndex);
        this.Fx.ring(capPos, PlayerColors[m.Player], 0.25, 1.8, 0.35);
      }
      if (state.HasPlayerWon(p)) {
        this.SetupMatch(this.CurrentStageLevel, true);
        return;
      }
    }

    this.SnapAllTokensToLogicalPositions();
    state.CurrentTurn = state.NextActivePlayer(p);
    this.PositionWorldDiceForPlayer(state.CurrentTurn);
  }

  // ------------------------------------------------------------------ Gameplay Loop

  protected TickRun(dt: number) {
    this.AnimateAmbient(dt);
    this.AnimateTokens(dt);
    this.UpdateYardTurnHighlights();

    if (this.coinBadgePop > 0 && this.coinBadge) {
      this.coinBadgePop = Mathf.moveTowards(this.coinBadgePop, 0, dt * 3.5);
      const cs = 1 + 0.16 * Ease.outCubic(this.coinBadgePop);
      this.coinBadge.localScale = new V3(cs, cs, 1);
    }

    if (this.online) {
      this.overlay.tick();
      this.askT = Math.max(0, this.askT - dt);
      this.syncT = Math.max(0, this.syncT - Time.unscaledDeltaTime);
    }
    if (this.forfeitT > 0) {
      this.forfeitT -= Time.unscaledDeltaTime;
      if (this.forfeitT <= 0) { this.forfeitT = -1; this.ShowOnlineResult(this.mySeat); }
    }
    if (this.matchEnded) return;
    if (this.online) {
      // the friend dropped (or left): the table waits; the guest plays the host's events as its board catches up
      if (!this.link || this.overlay.busy) { this.UpdateHud(); return; }
      if (!this.IsHost) this.PlayQueuedEvent();
    }

    switch (this.turnPhase) {
      case TurnPhase.AwaitRoll:
        this.TickAwaitRoll(dt);
        break;
      case TurnPhase.RollingDice:
        this.TickRollingDice(dt);
        break;
      case TurnPhase.AwaitMove:
        this.TickAwaitMove(dt);
        break;
      case TurnPhase.MovingToken:
        this.TickMovingToken(dt);
        break;
      case TurnPhase.TurnDelay:
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.AdvanceToNextTurnOrBonus();
        break;
    }

    this.UpdateHud();
  }

  private TickAwaitRoll(dt: number) {
    if (this.IsLocal(this.state.CurrentTurn)) {
      // Player can press Space/Enter/Action or tap the board die / yard to roll
      if (this.Controls.actionPressed) {
        this.HumanRoll();
        return;
      }
      if (this.Controls.tapped) {
        const tapWorld = this.ScreenToWorld(this.Controls.tapScreen);
        const distToDie = V2.distance(tapWorld, this.DicePos);
        if (distToDie < 1.6) {
          this.HumanRoll();
          return;
        }
      }
    } else if (this.IsHuman(this.state.CurrentTurn) || this.IsRemote(this.state.CurrentTurn)) {
      // online: the friend's roll (host: waits for their request; guest: every roll comes from the host)
      if (this.online && this.IsHost && this.link && this.pendingAsk >= 0) {
        const ok = this.pendingAsk === this.link.seq && this.state.CurrentTurn === this.FriendSeat;
        this.pendingAsk = -1;
        if (ok) this.TriggerRoll(-1, false);
      }
    } else {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.TriggerRoll(-1, false);
    }
  }

  private TriggerRoll(forcedValue: number, golden: boolean) {
    if (this.turnPhase !== TurnPhase.AwaitRoll && !(this.turnPhase === TurnPhase.AwaitMove && golden)) return;

    this.HideTargetMarkers();
    this.isGoldenRoll = golden;

    const p = this.state.CurrentTurn;
    if (forcedValue >= 1 && forcedValue <= 6) this.currentRoll = forcedValue;
    else this.currentRoll = this.RollSmartDie(p);
    // online: the host owns every roll and tells the guest
    if (this.online && this.link && this.IsHost) this.SendEvent({ e: "roll", p, v: this.currentRoll });

    this.turnPhase = TurnPhase.RollingDice;
    this.diceAnimT = 0;
    this.diceAnimDuration = this.IsHuman(p) ? 0.62 : 0.44;
    this.dicePipScrambleTimer = 0;
    this.diceSpinDir = Random.value < 0.5 ? -1 : 1;

    Sfx.playClip(this.diceRollClip, 0.85, Random.range(0.95, 1.06));
    Fx.haptic();
    this.UpdateHud();
  }

  private RollSmartDie(player: number) {
    let raw = this.rng.next(1, 7);

    // Friendly anti-frustration boost if all 4 of a player's tokens are stuck in the yard
    if (this.state.YardCount(player) === LudoBoard.TokensPerPlayer && raw !== 6) {
      if (this.rng.nextDouble() < (this.IsHuman(player) ? 0.32 : 0.22)) raw = 6;
    }
    return raw;
  }

  private TickRollingDice(dt: number) {
    this.diceAnimT += dt;
    this.dicePipScrambleTimer -= dt;
    if (this.dicePipScrambleTimer <= 0) {
      this.dicePipScrambleTimer = 0.045;
      this.displayDiceFace = this.rng.next(1, 7);
      this.UpdateDiceVisuals(this.displayDiceFace, PlayerColors[this.state.CurrentTurn], this.isGoldenRoll);
    }

    const k = Mathf.clamp01(this.diceAnimT / this.diceAnimDuration);
    // Thrown die: three decaying bounces while it spins down, its shadow shrinking as it rises.
    const decay = (1 - k) * (1 - k);
    const bounce = Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) * 1.25;
    const spin = decay * 900 * this.diceSpinDir;
    const wobble = Math.sin(k * Math.PI * 9) * 0.08 * (1 - k);

    this.diceBody.localPosition = new V3(0, bounce, 0);
    this.diceBody.localRotation = Quaternion.euler(0, 0, spin);
    this.diceBody.localScale = new V3(1 + wobble, 1 - wobble, 1);
    this.diceShadow.transform.localScale = V3.one.mul(DiceShadowSize * (1 - 0.3 * bounce));
    this.diceShadow.color = new Color(0, 0, 0, 0.6 - 0.25 * bounce);
    this.diceWorldRoot!.localScale = V3.one.mul(0.58 * (1 + 0.12 * Math.sin(k * Math.PI)));

    if (this.diceHudCard) this.diceHudCard.localRotation = Quaternion.euler(0, 0, Math.sin(k * Math.PI * 4) * 8 * (1 - k));

    if (this.diceAnimT >= this.diceAnimDuration) {
      this.diceBody.localPosition = V3.zero;
      this.diceBody.localRotation = Quaternion.identity;
      this.diceBody.localScale = V3.one;
      this.diceShadow.transform.localScale = V3.one.mul(DiceShadowSize);
      this.diceShadow.color = new Color(0, 0, 0, 0.6);
      this.diceWorldRoot!.localScale = V3.one.mul(0.58);
      if (this.diceHudCard) this.diceHudCard.localRotation = Quaternion.identity;

      this.OnDiceRollLanded();
    }
  }

  private OnDiceRollLanded() {
    const state = this.state;
    const p = state.CurrentTurn;
    const pCol = PlayerColors[p];
    this.displayDiceFace = this.currentRoll;
    this.diceBouncePop = 1;
    this.UpdateDiceVisuals(this.currentRoll, pCol, this.isGoldenRoll || this.currentRoll === 6);

    this.Fx.ring(this.DicePos, Pal.hex(0xfff1c9).scale(0.35), 0.3, 1.4, 0.28);
    if (this.currentRoll === 6) {
      Sfx.playClip(this.diceSixClip, 0.9, this.isGoldenRoll ? 1.12 : 1);
      this.Fx.ring(this.DicePos, RoyalGold, 0.2, 1.9, 0.35);
      this.SpawnConfetti(this.DicePos, 10, 5);
      if (p === this.mySeat && !this.localMatch) this.playerSixesThisRun++;
    } else {
      Sfx.playClip(this.diceLandClip, 0.85, 0.95 + this.currentRoll * 0.03);
    }

    // Three consecutive natural 6s forfeits the turn! (Golden 6 power-up never busts)
    if (this.currentRoll === 6 && !this.isGoldenRoll) {
      state.ConsecutiveSixes++;
      if (state.ConsecutiveSixes >= 3) {
        Sfx.playClip(this.bustClip, 0.85);
        this.UI.Float(this.DicePos, "THREE 6s! TURN BUST!", Pal.Warn, 1.05);
        state.ConsecutiveSixes = 0;
        this.activeMove = new LudoMove();
        this.turnPhase = TurnPhase.TurnDelay;
        this.phaseTimer = 0.75;
        return;
      }
    } else if (this.currentRoll !== 6) {
      state.ConsecutiveSixes = 0;
    }

    state.GetLegalMoves(p, this.currentRoll, this.legalMoves);

    if (this.legalMoves.length === 0) {
      Sfx.play(Snd.Tick, 0.5, 0.75);
      this.UI.Float(this.DicePos, "NO MOVES", Pal.TextDim, 0.9);
      this.activeMove = new LudoMove();
      this.turnPhase = TurnPhase.TurnDelay;
      this.phaseTimer = 0.62;
      return;
    }

    if (this.IsRemote(p) || (this.online && this.IsHuman(p) && p !== this.mySeat)) {
      this.turnPhase = TurnPhase.AwaitMove; // the friend's (or, on the guest, the host's) choice arrives over the network
      this.phaseTimer = -1;
    } else if (this.IsHuman(p)) {
      // Auto-move if all legal moves start from the same step (e.g. only 1 unique choice) AND player has no reroll needed
      const singleUniqueOption = hasOnlyOneDistinctMove(this.legalMoves);
      if (singleUniqueOption && this.legalMoves.length === 1) {
        this.ShowTargetMarkersForPlayer();
        this.turnPhase = TurnPhase.AwaitMove;
        this.phaseTimer = 0.24; // Brief beat so player sees the roll, then auto-moves or lets them tap
      } else {
        this.ShowTargetMarkersForPlayer();
        this.turnPhase = TurnPhase.AwaitMove;
        this.phaseTimer = -1; // Wait for player selection
      }
    } else {
      this.turnPhase = TurnPhase.AwaitMove;
      this.phaseTimer = 0.28;
    }
  }

  private TickAwaitMove(dt: number) {
    const p = this.state.CurrentTurn;

    if (this.online && (this.IsRemote(p) || (this.IsHuman(p) && !this.IsLocal(p)))) {
      // waiting for the network; the host plays the friend's pick once its own board has reached that point
      const pick = this.pendingPick;
      if (this.IsHost && this.link && pick && p === this.FriendSeat) {
        this.pendingPick = null;
        const m = pick.seq === this.link.seq ? this.legalMoves.find((x) => x.TokenIndex === pick.tok) : undefined;
        if (m) this.ExecuteMove(m); else this.link.pushState();
      }
      return;
    }

    if (!this.IsHuman(p)) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        const chosen = LudoAi.ChooseMove(this.state, this.legalMoves, this.currentStage.AiSkill, this.rng);
        this.ExecuteMove(chosen);
      }
      return;
    }

    // If there is only 1 distinct move and the brief auto-move delay elapsed (and player isn't holding), execute it automatically!
    if (this.phaseTimer > 0) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0 && hasOnlyOneDistinctMove(this.legalMoves)) {
        this.HumanPick(this.legalMoves[0]);
        return;
      }
    }

    // Keyboard shortcut: Space / Enter picks the best tactical move
    if (this.Controls.actionPressed && this.legalMoves.length > 0) {
      const best = LudoAi.ChooseMove(this.state, this.legalMoves, 1.0, this.rng);
      this.HumanPick(best);
      return;
    }

    // Touch / Mouse tap on either a legal token, its destination marker, or Player 0's yard
    if (this.Controls.tapped) {
      const tapWorld = this.ScreenToWorld(this.Controls.tapScreen);
      let bestMoveIdx = -1;
      let bestDist = 1.05;

      for (let i = 0; i < this.legalMoves.length; i++) {
        const m = this.legalMoves[i];
        const tokenPos = xy(this.tokenViews[m.Player][m.TokenIndex].Root.position);
        const dToken = V2.distance(tapWorld, tokenPos);
        if (dToken < bestDist) {
          bestDist = dToken;
          bestMoveIdx = i;
        }

        const destPos = this.GetStepWorldPos(m.Player, m.ToStep, m.TokenIndex);
        const dDest = V2.distance(tapWorld, destPos);
        if (dDest < bestDist) {
          bestDist = dDest;
          bestMoveIdx = i;
        }

        if (m.LeavesYard) {
          const dYard = V2.distance(tapWorld, xy(this.yardViews[p].Root.position));
          if (dYard < 2.2 && bestMoveIdx < 0) bestMoveIdx = i;
        }
      }

      if (bestMoveIdx >= 0) this.HumanPick(this.legalMoves[bestMoveIdx]);
    }
  }

  private ShowTargetMarkersForPlayer() {
    this.HideTargetMarkers();
    let markerCount = 0;
    for (let i = 0; i < this.legalMoves.length; i++) {
      const m = this.legalMoves[i];
      this.tokenViews[m.Player][m.TokenIndex].SelectRing.gameObject.setActive(true);

      let duplicateDest = false;
      for (let j = 0; j < i; j++) {
        if (this.legalMoves[j].ToStep === m.ToStep) {
          duplicateDest = true;
          break;
        }
      }
      if (duplicateDest || markerCount >= this.targetMarkers.length) continue;

      const tm = this.targetMarkers[markerCount++];
      const destWorld = this.GetStepWorldPos(m.Player, m.ToStep, m.TokenIndex);
      tm.MoveIndex = i;
      tm.WorldPos = destWorld;
      tm.Root.position = destWorld;
      tm.Root.setActive(true);
      tm.CaptureCross.gameObject.setActive(m.HasCapture);
      tm.Ring.color = m.HasCapture ? Pal.Danger : AmberGold;
      tm.Glow.color = (m.HasCapture ? Pal.Danger : RubyRed).withAlpha(0.45);
    }
  }

  private HideTargetMarkers() {
    for (let i = 0; i < this.targetMarkers.length; i++) this.targetMarkers[i].Root.setActive(false);

    for (let p = 0; p < LudoBoard.PlayerCount; p++)
      for (let t = 0; t < LudoBoard.TokensPerPlayer; t++)
        this.tokenViews[p][t].SelectRing.gameObject.setActive(false);
  }

  // ------------------------------------------------------------------ Step-by-Step Token Hop Animation

  private ExecuteMove(move: LudoMove) {
    this.HideTargetMarkers();
    this.activeMove = move;
    if (move.Player === this.mySeat && !this.localMatch) this.turnsPlayedThisRun++;
    if (this.online && this.link && this.IsHost) this.SendEvent({ e: "move", p: move.Player, tok: move.TokenIndex, from: move.FromStep, roll: move.Roll });

    this.turnPhase = TurnPhase.MovingToken;
    const tv = this.tokenViews[move.Player][move.TokenIndex];

    if (move.LeavesYard) {
      this.hopCurrentStep = 0;
      this.hopStepT = 0;
      this.hopStepDuration = 0.30;
      this.hopStartWorld = xy(tv.Root.position);
      this.hopEndWorld = this.GetStepWorldPos(move.Player, 0, move.TokenIndex);
    } else {
      this.hopCurrentStep = move.FromStep + 1;
      this.hopStepT = 0;
      this.hopStepDuration = 0.13;
      this.hopStartWorld = xy(tv.Root.position);
      this.hopEndWorld = this.GetStepWorldPos(move.Player, this.hopCurrentStep, move.TokenIndex);
    }
  }

  private TickMovingToken(dt: number) {
    const am = this.activeMove;
    const tv = this.tokenViews[am.Player][am.TokenIndex];
    this.hopStepT += dt;
    const k = Mathf.clamp01(this.hopStepT / this.hopStepDuration);

    // Smooth ground interpolation + parabolic jump arc
    const groundPos = V2.lerp(this.hopStartWorld, this.hopEndWorld, Ease.inOutSine(k));
    const air = 4 * k * (1 - k);
    const arcHeight = (am.LeavesYard ? 0.95 : 0.46) * air;

    tv.Root.position = groundPos;
    tv.Visual.localPosition = new V3(0, arcHeight, 0);

    // Squash before take-off, stretch in the air, and lean into the direction of travel
    const stretch = k < 0.15 ? 1 - 0.14 * (1 - k / 0.15) : 1 + 0.16 * Math.sin(k * Math.PI);
    tv.Visual.localScale = new V3(1 / Math.sqrt(stretch), stretch, 1);
    const travel = this.hopEndWorld.sub(this.hopStartWorld);
    const lean = travel.sqrMagnitude > 1e-6 ? -travel.normalized.x * 14 * Math.sin(k * Math.PI) : 0;
    tv.Visual.localRotation = Quaternion.euler(0, 0, lean);
    tv.Shadow.transform.localScale = V3.one.mul(TokenShadowSize * (1 - 0.35 * air));

    if (this.hopStepT >= this.hopStepDuration) {
      const stepOffset = this.hopCurrentStep - Math.max(0, am.FromStep);
      Sfx.playClip(this.hopClip, 0.72, 0.92 + stepOffset * 0.06);
      this.Fx.ring(this.hopEndWorld, Pal.hex(0xfff1c9).scale(0.3), 0.12, 0.6, 0.18);
      tv.LandSquash = 1;

      if (this.hopCurrentStep < am.ToStep) {
        this.hopCurrentStep++;
        this.hopStepT = 0;
        this.hopStartWorld = this.hopEndWorld;
        this.hopEndWorld = this.GetStepWorldPos(am.Player, this.hopCurrentStep, am.TokenIndex);
      } else {
        tv.Visual.localPosition = V3.zero;
        tv.Visual.localScale = V3.one;
        tv.Visual.localRotation = Quaternion.identity;
        tv.Shadow.transform.localScale = V3.one.mul(TokenShadowSize);
        this.CompleteActiveMove();
      }
    }
  }

  private CompleteActiveMove() {
    const state = this.state, am = this.activeMove;
    state.ApplyMove(am);
    const moverCol = PlayerColors[am.Player];
    const landPos = this.GetStepWorldPos(am.Player, am.ToStep, am.TokenIndex);

    // 1. Check Capture!
    if (am.HasCapture) {
      const cp = am.CapturedPlayer;
      const ct = am.CapturedTokenIndex;
      const capView = this.tokenViews[cp][ct];

      // Start fly-back animation to captured player's yard
      capView.FlyFrom = landPos;
      capView.FlyTo = this.GridToWorld(LudoBoard.YardSlotGrid(cp, ct));
      capView.FlyT = 0;

      Sfx.playClip(this.captureClip, 0.95);
      this.Hitstop(0.055);
      this.Fx.shake(0.42);
      this.Fx.kick(0.85, 0.22);
      this.Fx.ring(landPos, moverCol, 0.25, 2.6, 0.45);
      this.Fx.burst(landPos, PlayerColors[cp], 34, 6.5, 0.25, 0.65);
      this.SpawnConfetti(landPos, 14, 6);
      Fx.haptic(true);

      if (this.localMatch) {
        this.UI.Float(landPos, `${SeatNames[am.Player]} CAPTURED ${SeatNames[cp]}!`, moverCol, 1.1);
      } else if (this.online) {
        if (am.Player === this.mySeat) { this.playerCapturesThisRun++; this.Data.add("captures", 1); }
        const who = am.Player === this.mySeat ? "YOU" : this.SeatName(am.Player);
        this.UI.Float(landPos, cp === this.mySeat ? `${who} CAPTURED YOU!` : `${who} CAPTURED ${this.SeatName(cp)}!`,
          cp === this.mySeat ? Pal.Danger : moverCol, 1.1);
      } else if (am.Player === 0) {
        this.playerCapturesThisRun++;
        this.Data.add("captures", 1);
        this.GrantCoins(35);
        this.UI.Float(landPos, "CAPTURED! +35 COINS", AmberGold, 1.15);
      } else if (cp === 0) {
        this.UI.Float(landPos, `${this.currentStage.RivalNames[am.Player - 1]} CAPTURED YOU!`, Pal.Danger, 1.1);
      } else {
        this.UI.Float(landPos, "CAPTURED!", moverCol, 1.0);
      }
    }

    // 2. Check Reaching Crown Goal!
    if (am.ReachesGoal) {
      Sfx.playClip(this.homeGoalClip, 0.95);
      this.Fx.shake(0.25);
      this.Fx.kick(0.65, 0.15);
      this.Fx.ring(landPos, AmberGold, 0.2, 2.2, 0.42);
      this.Fx.burst(landPos, moverCol, 28, 5.5, 0.24, 0.6);
      this.SpawnConfetti(landPos, 40, 8);
      Fx.haptic(true);

      const homeNow = state.HomeCount(am.Player);
      this.yardViews[am.Player].CountLabel.text = `HOME ${homeNow}/4`;

      if (am.Player === 0 && !this.localMatch && !this.online) {
        this.GrantCoins(25);
        this.UI.Float(landPos, `HOME! (${homeNow}/4) +25`, AmberGold, 1.12);
      } else {
        this.UI.Float(landPos, `HOME! (${homeNow}/4)`, moverCol, 1.0);
      }
    } else if (am.LeavesYard) {
      this.Fx.ring(landPos, moverCol, 0.2, 1.2, 0.28);
    } else if (am.ToStep <= LudoBoard.HomeEntryStep) {
      const trackIdx = LudoBoard.StepToTrackIndex(am.Player, am.ToStep);
      if (LudoBoard.IsStarTrack(trackIdx)) {
        Sfx.play(Snd.Pickup, 0.65, 1.15);
        this.Fx.ring(landPos, AmberGold, 0.2, 1.35, 0.3);
        this.UI.Float(landPos, "SAFE STAR!", AmberGold, 0.92);
      }
    }

    this.SnapAllTokensToLogicalPositions();

    // 3. Check Victory / Match End!
    if (state.HasPlayerWon(am.Player)) {
      this.OnPlayerWonMatch(am.Player);
      return;
    }

    // Ramp music intensity as tokens get closer to winning
    let maxHome = 0;
    for (let p = 0; p < LudoBoard.PlayerCount; p++)
      if (state.ActivePlayers[p]) maxHome = Math.max(maxHome, state.HomeCount(p));
    Sfx.setIntensity(0.35 + maxHome * 0.18);

    this.turnPhase = TurnPhase.TurnDelay;
    this.phaseTimer = am.HasCapture ? 0.48 : 0.22;
  }

  private AdvanceToNextTurnOrBonus() {
    if (this.matchEnded) return;

    const am = this.activeMove;
    const bonusRoll = am.Roll > 0 && am.GrantsBonusRoll;
    if (bonusRoll) {
      const reason = am.HasCapture ? "CAPTURE BONUS ROLL!"
        : am.ReachesGoal ? "HOME BONUS ROLL!"
          : "ROLLED 6 — BONUS ROLL!";
      if (this.online ? this.state.CurrentTurn === this.mySeat : this.IsHuman(this.state.CurrentTurn)) this.UI.Float(this.DicePos, reason, AmberGold, 0.98);
      this.BeginPlayerTurn(this.state.CurrentTurn, true);
    } else {
      const nextPlayer = this.state.NextActivePlayer(this.state.CurrentTurn);
      this.BeginPlayerTurn(nextPlayer, false);
    }
  }

  // ------------------------------------------------------------------ Power-Ups & Controls

  private OnDiceActionTriggered() {
    if (this.State !== Phase.Playing || this.matchEnded || !this.IsLocal(this.state.CurrentTurn)) return;

    if (this.turnPhase === TurnPhase.AwaitRoll) {
      this.HumanRoll();
    } else if (this.turnPhase === TurnPhase.AwaitMove && this.legalMoves.length > 0) {
      const best = LudoAi.ChooseMove(this.state, this.legalMoves, 1.0, this.rng);
      this.HumanPick(best);
    }
  }

  private OnRerollPressed() {
    if (this.State !== Phase.Playing || this.matchEnded || this.localMatch || this.state.CurrentTurn !== 0) return;

    if (this.Coins < RerollCost) {
      this.TryOfferRewardedCoins();
      return;
    }

    if (this.turnPhase !== TurnPhase.AwaitMove || this.rerollUsedThisTurn) {
      Sfx.play(Snd.Deny, 0.6);
      return;
    }

    this.Coins -= RerollCost;
    this.rerollUsedThisTurn = true;
    this.coinBadgePop = 1;

    // Pick a smart helpful roll different from currentRoll
    const bestRoll = this.PickHelpfulReroll(this.currentRoll);
    Sfx.play(Snd.PowerUp, 0.8, 1.15);
    this.UI.Float(this.DicePos, "LUCKY REROLL!", ElectricBlue, 1.05);

    this.turnPhase = TurnPhase.AwaitRoll;
    this.TriggerRoll(bestRoll, false);
  }

  private PickHelpfulReroll(avoidRoll: number) {
    let bestRoll = 6;
    let bestVal = -Infinity;
    const tempMoves: LudoMove[] = [];

    for (let r = 1; r <= 6; r++) {
      if (r === avoidRoll) continue;
      this.state.GetLegalMoves(0, r, tempMoves);
      if (tempMoves.length === 0) continue;
      for (let i = 0; i < tempMoves.length; i++) {
        const v = LudoAi.EvaluateMove(this.state, tempMoves[i], 1.0) + (r === 6 ? 35 : 0);
        if (v > bestVal) {
          bestVal = v;
          bestRoll = r;
        }
      }
    }
    return bestRoll;
  }

  private OnGoldenSixPressed() {
    if (this.State !== Phase.Playing || this.matchEnded || this.localMatch || this.state.CurrentTurn !== 0) return;

    if (this.Coins < GoldenSixCost) {
      this.TryOfferRewardedCoins();
      return;
    }

    if (this.turnPhase !== TurnPhase.AwaitRoll && this.turnPhase !== TurnPhase.AwaitMove) {
      Sfx.play(Snd.Deny, 0.6);
      return;
    }

    this.Coins -= GoldenSixCost;
    this.coinBadgePop = 1;
    Sfx.play(Snd.PowerUp, 0.9, 1.05);
    this.Fx.burst(this.DicePos, AmberGold, 24, 5, 0.22, 0.55);
    this.UI.Float(this.DicePos, "GOLDEN 6!", AmberGold, 1.15);

    this.TriggerRoll(6, true);
  }

  private TryOfferRewardedCoins() {
    if (AdService.rewardedAvailable) {
      AdService.showRewarded((earned) => {
        if (!earned) return;
        this.GrantCoins(AdCoinGrant);
        Sfx.play(Snd.Coin);
        this.UI.Announce(`+${AdCoinGrant} COINS!`, AmberGold, 1.2);
        this.UpdateHud();
      });
    } else {
      Sfx.play(Snd.Deny, 0.7);
      this.UI.Toast("Capture rival tokens or win stages to earn more Coins!", 2.5);
    }
  }

  private ToggleSpeedMultiplier() {
    this.SpeedMultiplier = this.SpeedMultiplier < 1.5 ? 1.85 : 1;
    if (this.speedButton && this.speedButton.label) {
      const fast = this.SpeedMultiplier > 1.5;
      this.speedButton.label.text = fast ? "2X" : "1X";
      this.speedButton.setAccent(fast ? RubyRed : RoyalGold);
    }
  }

  private GrantCoins(amount: number) {
    if (amount <= 0) return;
    this.Coins += amount;
    this.coinsEarnedThisRun += amount;
    this.coinBadgePop = 1;
  }

  // ------------------------------------------------------------------ Match Finish & Revive

  private OnPlayerWonMatch(winner: number) {
    this.matchEnded = true;
    this.lastWinnerPlayer = winner;
    if (this.localMatch) {
      this.OnLocalMatchWon(winner);
      return;
    }
    if (this.online) {
      this.OnOnlineMatchWon(winner);
      return;
    }
    this.Data.add("games", 1);

    const playerWon = winner === 0;
    const completedStage = this.currentStage.StageNumber;
    const boardPos = xy(this.boardRoot!.position);

    if (playerWon) {
      this.Data.add("wins", 1);
      this.GrantCoins(this.currentStage.WinCoins);
      this.CurrentStageLevel = completedStage + 1;
      this.Data.max("bestStage", this.CurrentStageLevel);

      Sfx.play(Snd.Win);
      this.Fx.burst(boardPos, AmberGold, 65, 8.5, 0.30, 1.0);
      this.Fx.burst(boardPos, RubyRed, 45, 7.0, 0.26, 0.9);
      this.SpawnConfettiShower(ConfettiCount);

      const stars = this.playerCapturesThisRun >= 2 ? 3 : this.playerCapturesThisRun >= 1 ? 2 : 3;
      this.Data.add("stars", stars);

      this.Finish(new Result({
        Headline: `STAGE ${completedStage} CLEARED!`,
        HeadlineColor: Pal.Good,
        Stars: stars,
        Value: `+${this.coinsEarnedThisRun} COINS`,
        NewBest: completedStage >= this.Data.get("bestStage", 1) - 1,
        BestLine: `NEXT UP: STAGE ${this.CurrentStageLevel} · ${LudoBoard.GetStage(this.CurrentStageLevel).ArenaName}`,
        Stats: [
          ["STAGE", String(completedStage)],
          ["CAPTURES", String(this.playerCapturesThisRun)],
          ["SIXES ROLLED", String(this.playerSixesThisRun)],
          ["COINS EARNED", "+" + this.coinsEarnedThisRun],
        ],
        Primary: "NEXT STAGE",
        Victory: true,
      }));
    } else {
      Sfx.play(Snd.Lose);
      const winnerName = this.currentStage.RivalNames[Mathf.clamp(winner - 1, 0, 2)];
      const yourHome = this.state.HomeCount(0);

      this.Finish(new Result({
        Headline: `${winnerName} WON THE RACE`,
        HeadlineColor: Pal.Danger,
        Value: `${yourHome}/4 HOME`,
        BestLine: `STAGE ${completedStage} · ${this.currentStage.ArenaName}`,
        Stats: [
          ["YOUR PROGRESS", this.state.TotalProgressPercent(0) + "%"],
          ["CAPTURES", String(this.playerCapturesThisRun)],
          ["SIXES ROLLED", String(this.playerSixesThisRun)],
          ["COINS EARNED", "+" + this.coinsEarnedThisRun],
        ],
        Primary: "RETRY STAGE",
        Victory: false,
        Reward: !this.reviveUsedThisMatch ? () => this.OnReviveAccepted() : null,
        RewardLabel: "REWIND AI & ROLL GOLDEN 6 (AD)",
      }));
    }
  }

  /** Pass-and-play finish: no stage progress, coins or revive; just the winner and everyone's progress. */
  private OnLocalMatchWon(winner: number) {
    this.Data.add("localGames", 1);
    Sfx.play(Snd.Win);
    const boardPos = xy(this.boardRoot!.position);
    this.Fx.burst(boardPos, PlayerColors[winner], 65, 8.5, 0.30, 1.0);
    this.Fx.burst(boardPos, AmberGold, 45, 7.0, 0.26, 0.9);
    this.SpawnConfettiShower(ConfettiCount);

    const stats: [string, string][] = [];
    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      if (!this.state.ActivePlayers[p]) continue;
      stats.push([SeatNames[p], p === winner ? "WINNER" : `${this.state.HomeCount(p)}/4 HOME`]);
    }

    this.Finish(new Result({
      Headline: `${SeatNames[winner]} WINS!`,
      HeadlineColor: PlayerColors[winner],
      Value: "4/4 HOME",
      BestLine: `OFFLINE MATCH · ${this.LocalPlayers} PLAYERS`,
      Stats: stats,
      Primary: "PLAY AGAIN",
      Victory: true,
    }));
  }

  private OnReviveAccepted() {
    this.reviveUsedThisMatch = true;
    this.matchEnded = false;

    // Knock the winning AI's final token back out to the outer track (step 46) so the race continues!
    if (this.lastWinnerPlayer > 0 && this.lastWinnerPlayer < LudoBoard.PlayerCount) {
      this.state.Steps[this.lastWinnerPlayer][0] = 45;
      this.yardViews[this.lastWinnerPlayer].CountLabel.text = `HOME ${this.state.HomeCount(this.lastWinnerPlayer)}/4`;
    }

    this.SnapAllTokensToLogicalPositions();
    this.Revive();

    // Give the player the turn with an immediate Golden 6 roll!
    this.UI.Announce("SECOND WIND! GOLDEN 6!", AmberGold, 1.4);
    Sfx.play(Snd.PowerUp);
    this.BeginPlayerTurn(0, false);
    this.TriggerRoll(6, true);
  }

  // ------------------------------------------------------------------ online (private tables)

  private BuildOnline() {
    const theme = { accent: RubyRed, accent2: AmberGold, ink: Ebony };
    this.lobby = new TableLobby("ludoblitz", theme, {
      onReady: (room) => this.OnTableReady(room),
      toast: (t, sec) => this.UI.Toast(t, sec ?? 2),
    }, "Ludo Blitz");
    this.overlay = new TableOverlay(theme, () => { this.overlay.hide(); this.EnterTitle(); }, (k) => this.link?.react(k));
    this.overlay.onTimeout = () => { this.link?.leave(); this.FriendLeft(); };
  }

  /** Quick reactions: above the dice in portrait, bottom-left in landscape; the friend's pop up near the top. */
  private PlaceReactions() {
    if (Screen.width < Screen.height) this.overlay.place({ anchor: new V2(0.5, 0), pos: new V2(0, 262) }, { anchor: new V2(0.5, 1), pos: new V2(0, -300) });
    else this.overlay.place({ anchor: new V2(0, 0), pos: new V2(300, 122) }, { anchor: new V2(0.5, 1), pos: new V2(0, -300) });
  }

  /** PLAY with ONLINE selected opens the PRIVATE TABLE lobby; REMATCH online asks the friend. */
  protected StartRun() {
    if (this.State === Phase.Paused && this.online) { this.UI.Toast("Restart isn't available online: use MENU to leave the table.", 2.5); return; }
    if (this.SelOnline && !this.onlineGo) {
      if (this.State === Phase.Over && this.link && this.link.connected) { this.AskRematch(); return; }
      if (this.State === Phase.Over) this.EnterTitle();
      if (!this.lobby.isOpen) {
        this.lobby.createNote = (this.OnlineSeats === 4 ? "Your table: you two plus two CPU rivals" : "Your table: a 1v1 duel")
          + (this.BlitzRules ? ", 2 tokens out at the start." : ", classic start.") + " Change it on the title screen.";
        this.lobby.open("menu");
      }
      return;
    }
    this.online = this.onlineGo && !!this.link;
    this.onlineGo = false;
    super.StartRun();
  }

  private NewOnlineStart(first: number): OStart {
    return { seats: this.OnlineSeats === 4 ? [0, 1, 2, 3] : [HostSeat, GuestSeat], out: this.BlitzRules ? 2 : 1, first, names: OnlineCpuNames, skill: 0.6 };
  }

  private OnTableReady(room: OnlineRoom) {
    this.LeaveTable();
    const link = new OnlineLink<OStart, OEv, OSnap>(room);
    this.link = link;
    room.onMessage((d) => { if (this.link === link) this.OnIntent(d as OIntent); });
    link.bind({
      onStart: (st) => {
        this.onlineStart = st;
        this.overlay.hide();
        this.Data.set("online", 1);
        this.onlineGo = true;
        this.StartRun();
      },
      // only the host sends events; the guest checks their shape here and their fit when it plays them
      validMove: (ev) => !link.isHost && !!ev && (ev.e === "roll" || ev.e === "move") && ev.p >= 0 && ev.p < LudoBoard.PlayerCount,
      onMove: (ev) => this.OnEvent(ev),
      snapshot: () => this.Snapshot(),
      onSnapshot: (snap) => {
        if (this.State === Phase.Over) return;
        if (this.State !== Phase.Title) { if (this.online) this.Rebuild(snap); return; }
        // joined (again) in the middle of a match: start from the host's state
        this.onlineStart = snap.start;
        this.overlay.hide();
        this.Data.set("online", 1);
        this.onlineGo = true;
        this.StartRun();
        this.Rebuild(snap);
      },
      onReaction: (k) => this.overlay.Pop(k, true),
      onFriend: (st) => {
        if (st === "connected") { if (this.overlay.state === "lost") { this.overlay.hide(); this.UI.Toast("Your friend is back!", 2); } }
        else if (st === "lost") { if ((this.State === Phase.Playing || this.State === Phase.Paused) && this.online && !this.matchEnded) this.overlay.lost(30); }
        else this.FriendLeft();
      },
      onRematchReady: () => { if (link.isHost) link.start(this.NewOnlineStart(link.match % 2 === 1 ? GuestSeat : HostSeat)); },
      onFriendRematch: () => { if (this.overlay.state !== "rematch") this.UI.Toast("Your friend wants a rematch! Tap REMATCH.", 3); },
    });
    if (link.isHost) link.start(this.NewOnlineStart(HostSeat));
    else this.UI.Toast("Joined! Waiting for the host to start…", 3);
  }

  /** Host: one of its rolls or moves (its own, a CPU's, or the friend's validated request) goes out. */
  private SendEvent(ev: OEv) { this.link?.sendMove(ev); }

  /** Guest: a host event arrives; it is played in order once the local board has caught up. */
  private OnEvent(ev: OEv) {
    if (ev.e === "move" && ev.p === this.mySeat && this.optimisticTok === ev.tok) { this.optimisticTok = -1; return; } // my own move, echoed
    this.evQueue.push(ev);
    if (this.evQueue.length > 10) this.RequestSync(); // far behind (tab was in the background): jump to the host's board
  }

  private PlayQueuedEvent() {
    const ev = this.evQueue[0];
    if (!ev) return;
    const st = this.state;
    if (ev.e === "roll") {
      if (this.turnPhase !== TurnPhase.AwaitRoll) return;
      if (ev.p !== st.CurrentTurn || ev.v < 1 || ev.v > 6) { this.RequestSync(); return; }
      this.evQueue.shift();
      this.askT = 0;
      this.TriggerRoll(ev.v, false);
    } else {
      if (this.turnPhase !== TurnPhase.AwaitMove) return;
      const m = ev.p === st.CurrentTurn && ev.roll === this.currentRoll
        ? this.legalMoves.find((x) => x.TokenIndex === ev.tok && x.FromStep === ev.from) : undefined;
      if (!m) { this.RequestSync(); return; }
      this.evQueue.shift();
      this.ExecuteMove(m);
    }
  }

  private RequestSync() {
    if (this.syncT > 0 || !this.link) return;
    this.syncT = 2;
    this.link.room.send({ t: "sync?" });
  }

  /** My roll: the host rolls itself; the guest asks the host (which owns every die). */
  private HumanRoll() {
    if (this.online && !this.IsHost) {
      if (this.askT > 0 || !this.link) return;
      this.askT = 3;
      this.link.room.send({ t: "lb", k: "roll", seq: this.link.seq } satisfies OIntent);
      Sfx.play(Snd.Click, 0.5);
      return;
    }
    this.TriggerRoll(-1, false);
  }

  /** My move: the guest plays it at once (it is legal on the shared board) and tells the host, which echoes it. */
  private HumanPick(m: LudoMove) {
    if (this.online && !this.IsHost && this.link) {
      this.optimisticTok = m.TokenIndex;
      this.link.room.send({ t: "lb", k: "pick", tok: m.TokenIndex, seq: this.link.seq } satisfies OIntent);
    }
    this.ExecuteMove(m);
  }

  /** Host: the guest's requests (validated against the host's own board when it gets there). */
  private OnIntent(d: OIntent) {
    if (!d || d.t !== "lb" || !this.link) return;
    if (d.k === "pause") { if (this.State === Phase.Playing || this.State === Phase.Paused) this.UI.Toast(d.on ? "Your friend paused the game." : "Your friend is back in the game.", 2); return; }
    if (!this.link.isHost || !this.online || this.matchEnded || (this.State !== Phase.Playing && this.State !== Phase.Paused)) return;
    if (d.k === "roll") {
      if (d.seq !== this.link.seq) return; // stale (an event went out since): the guest asks again
      this.pendingAsk = d.seq;
      if (this.turnPhase === TurnPhase.AwaitRoll && this.state.CurrentTurn === this.FriendSeat) { this.pendingAsk = -1; this.TriggerRoll(-1, false); }
    } else if (d.k === "pick") {
      if (d.seq !== this.link.seq) { this.link.pushState(); return; }
      this.pendingPick = { tok: d.tok, seq: d.seq };
    }
  }

  private Snapshot(): OSnap {
    return {
      start: this.onlineStart, steps: this.state.Steps.map((r) => r.slice()), turn: this.state.CurrentTurn, sixes: this.state.ConsecutiveSixes,
      phase: this.turnPhase, roll: this.currentRoll, am: moveToArr(this.activeMove), ended: this.matchEnded ? 1 : 0, winner: this.lastWinnerPlayer,
    };
  }

  /** Guest: the host's snapshot replaces the local board, mid-turn included (after a reconnect or a desync). */
  private Rebuild(snap: OSnap) {
    this.evQueue.length = 0;
    this.optimisticTok = -1;
    this.askT = 0;
    this.onlineStart = snap.start;
    const st = this.state;
    for (let p = 0; p < LudoBoard.PlayerCount; p++)
      for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
        st.Steps[p][t] = snap.steps[p]?.[t] ?? LudoBoard.YardStep;
        const tv = this.tokenViews[p][t];
        tv.FlyT = -1;
        tv.Visual.localPosition = V3.zero; tv.Visual.localScale = V3.one; tv.Visual.localRotation = Quaternion.identity;
      }
    this.matchEnded = false;
    this.SnapAllTokensToLogicalPositions();
    this.BeginPlayerTurn(snap.turn, true);
    st.ConsecutiveSixes = snap.sixes;
    const am = arrToMove(snap.am);
    switch (snap.phase as TurnPhase) {
      case TurnPhase.RollingDice:
        this.TriggerRoll(snap.roll, false);
        break;
      case TurnPhase.AwaitMove:
        this.currentRoll = snap.roll;
        this.UpdateDiceVisuals(snap.roll, PlayerColors[snap.turn], snap.roll === 6);
        st.GetLegalMoves(snap.turn, snap.roll, this.legalMoves);
        this.turnPhase = this.legalMoves.length ? TurnPhase.AwaitMove : TurnPhase.TurnDelay;
        this.phaseTimer = this.legalMoves.length ? -1 : 0.3;
        if (this.legalMoves.length === 0) this.activeMove = new LudoMove();
        else if (snap.turn === this.mySeat) {
          this.ShowTargetMarkersForPlayer();
          if (this.legalMoves.length === 1) this.phaseTimer = 0.24;
        }
        break;
      case TurnPhase.MovingToken:
        this.currentRoll = am.Roll;
        this.UpdateDiceVisuals(am.Roll, PlayerColors[snap.turn], am.Roll === 6);
        this.turnPhase = TurnPhase.AwaitMove;
        this.ExecuteMove(am);
        break;
      case TurnPhase.TurnDelay:
        this.currentRoll = snap.roll;
        this.activeMove = am;
        this.turnPhase = TurnPhase.TurnDelay;
        this.phaseTimer = 0.2;
        break;
      default: break; // AwaitRoll: BeginPlayerTurn already set it up
    }
    if (snap.ended && snap.winner >= 0 && this.State === Phase.Playing) this.OnPlayerWonMatch(snap.winner);
  }

  private AskRematch() {
    if (!this.link) return;
    this.overlay.waitingRematch();
    this.link.askRematch();
  }

  /** The friend left on purpose or never came back. */
  private FriendLeft() {
    const link = this.link;
    const seq = link ? link.seq : 0;
    this.link = null;
    if (link && link.room.status !== "closed") link.room.close();
    if ((this.State === Phase.Playing || this.State === Phase.Paused) && this.online && !this.matchEnded) {
      this.matchEnded = true;
      this.HideTargetMarkers();
      let progress = 0;
      for (let p = 0; p < LudoBoard.PlayerCount; p++) if (this.state.ActivePlayers[p]) progress = Math.max(progress, this.state.TotalProgressPercent(p));
      if (seq >= 30 || progress >= 25) {
        // the match was clearly underway: the player who stayed takes the win
        this.forfeit = true;
        this.overlay.hide();
        this.forfeitT = 1.4;
        this.UI.Announce("YOUR FRIEND LEFT", AmberGold, 1.4);
        return;
      }
      this.overlay.left("Your friend left", "Not enough of the match was played for a result.");
      return;
    }
    if (this.State === Phase.Over || this.overlay.state === "rematch") this.overlay.left("Your friend left", "No rematch this time.");
  }

  /** Leaving (menu, title): the friend is told and the room closes. */
  private LeaveTable() {
    if (this.link) { this.link.leave(); this.link = null; }
    this.evQueue.length = 0;
    this.optimisticTok = -1;
    this.overlay?.hide();
    this.overlay?.showBar(false);
  }

  protected OnPauseChanged(paused: boolean) {
    if (this.online && this.link) this.link.room.send({ t: "lb", k: "pause", on: paused } satisfies OIntent);
  }

  /** Both devices reach the same finish (same events, same rules); each shows its own result. */
  private OnOnlineMatchWon(winner: number) {
    const boardPos = xy(this.boardRoot!.position);
    if (winner === this.mySeat) {
      Sfx.play(Snd.Win);
      this.Fx.burst(boardPos, AmberGold, 65, 8.5, 0.30, 1.0);
      this.Fx.burst(boardPos, PlayerColors[winner], 45, 7.0, 0.26, 0.9);
      this.SpawnConfettiShower(ConfettiCount);
    } else Sfx.play(Snd.Lose);
    this.ShowOnlineResult(winner);
  }

  private ShowOnlineResult(winner: number) {
    const me = this.mySeat, fr = this.FriendSeat;
    const won = this.forfeit || winner === me, friendWon = !this.forfeit && winner === fr;
    const prize = won ? OnlinePrize : OnlineLosePrize;
    this.lastPrize = prize;
    this.GrantCoins(prize);
    if (won) this.Data.add("onlineWins", 1);
    this.Data.add("onlineGames", 1);
    this.overlay.showBar(false);
    const a = this.state.HomeCount(me), b = this.state.HomeCount(fr);
    this.Finish(new Result({
      Headline: this.forfeit ? "FRIEND LEFT · YOU WIN!" : won ? "YOU WIN!" : friendWon ? "FRIEND WINS" : `${this.SeatName(winner)} WINS`,
      HeadlineColor: won ? AmberGold : PlayerColors[winner],
      Victory: won,
      Value: `${a}/4 HOME`,
      BestLine: `YOU ${a}/4 · FRIEND ${b}/4 HOME   ·   +${prize} COINS`,
      Stats: [
        ["YOUR HOME", `${a}/4`],
        ["FRIEND'S HOME", `${b}/4`],
        ["YOUR CAPTURES", String(this.playerCapturesThisRun)],
        ["ONLINE WINS", String(this.Data.get("onlineWins", 0))],
      ],
      Primary: this.link ? "REMATCH" : "NEW TABLE",
      Reward: won ? () => this.DoubleCoins() : null,
      RewardLabel: `DOUBLE COINS: +${prize} (AD)`,
    }));
  }

  private DoubleCoins() {
    this.GrantCoins(this.lastPrize);
    this.UI.Toast(`+${this.lastPrize} COINS: DOUBLED!`, 2.5);
    Sfx.play(Snd.Coin, 0.8);
  }

  /**
   * Guest view: the board turns 180° so the guest's GOLD corner sits bottom-left. Lit sprites (tiles, pawns' pits,
   * stars, labels) turn back in place so the light still comes from the top-left; direction arrows turn with the board.
   */
  private SetViewFlip(on: boolean) {
    if (!this.boardRoot || on === this.viewFlipped) return;
    this.viewFlipped = on;
    this.boardRoot.localEulerZ = on ? 180 : 0;
    const turnsWithBoard = (n: string) => n === "StartChevron" || n === "Arrow" || n.startsWith("GoalTri_");
    const walk = (g: GameObject) => {
      for (const c of g.children) {
        if (c === this.diceWorldRoot) continue;
        if (c.getComponent(Renderer) && !turnsWithBoard(c.name)) {
          c.localEulerZ = c.localEulerZ + 180;
          if (/Shadow/.test(c.name)) c.localPosition = new V2(-c.localPosition.x, -c.localPosition.y);
        }
        walk(c);
      }
    };
    walk(this.boardRoot);
    if (this.diceWorldRoot) this.diceWorldRoot.localEulerZ = on ? 180 : 0;
  }

  /** Test hook: CSS pixel position of a world point. */
  debugWorldToCss(p: V2) {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect(), k = c.width / r.width;
    const sp = Camera.worldToScreen(p);
    return { x: r.left + sp.x / k, y: r.top + sp.y / k };
  }

  // ------------------------------------------------------------------ Visual Updates & Formations

  private GetStepWorldPos(player: number, step: number, tokenIndex: number) {
    const grid = LudoBoard.StepToGridPos(player, step, tokenIndex);
    return this.GridToWorld(grid);
  }

  private SnapAllTokensToLogicalPositions() {
    if (!this.boardRoot) return;
    const state = this.state;

    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      if (!state.ActivePlayers[p]) continue;
      this.yardViews[p].CountLabel.text = `HOME ${state.HomeCount(p)}/4`;

      for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
        const tv = this.tokenViews[p][t];
        if (tv.FlyT >= 0) continue; // Currently flying back to yard
        const s = state.Steps[p][t];
        tv.CurrentWorldPos = this.GetStepWorldPos(p, s, t);
        tv.BaseScale = 1;
      }
    }

    // Arrange stacked tokens on shared outer track or home column tiles into neat mini-formations
    this.ApplyStackFormations();

    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      if (!state.ActivePlayers[p]) continue;
      for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
        const tv = this.tokenViews[p][t];
        if (tv.FlyT >= 0) continue;
        tv.Root.position = tv.CurrentWorldPos;
        tv.Root.localScale = V3.one.mul(this.boardRoot.localScale.x * tv.BaseScale);
      }
    }
  }

  private ApplyStackFormations() {
    const state = this.state;
    const spreadRadius = TileStep * 0.24 * this.boardRoot!.localScale.x;
    const stack = this.stackScratch;

    // Check each of the 52 outer track tiles for multiple tokens
    for (let tr = 0; tr < LudoBoard.TrackLength; tr++) {
      stack.length = 0;
      for (let p = 0; p < LudoBoard.PlayerCount; p++) {
        if (!state.ActivePlayers[p]) continue;
        for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
          const s = state.Steps[p][t];
          if (LudoBoard.StepToTrackIndex(p, s) === tr && this.tokenViews[p][t].FlyT < 0) stack.push([p, t]);
        }
      }
      this.LayoutStackGroup(stack, spreadRadius);
    }

    // Check each player's 5 home stretch tiles
    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      if (!state.ActivePlayers[p]) continue;
      for (let hs = LudoBoard.HomeEntryStep + 1; hs < LudoBoard.GoalStep; hs++) {
        stack.length = 0;
        for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
          if (state.Steps[p][t] === hs && this.tokenViews[p][t].FlyT < 0) stack.push([p, t]);
        }
        this.LayoutStackGroup(stack, spreadRadius);
      }
    }
  }

  private LayoutStackGroup(group: [number, number][], radius: number) {
    const count = group.length;
    if (count <= 1) return;

    const scale = count === 2 ? 0.80 : 0.72;
    for (let i = 0; i < count; i++) {
      const angle = (i * Math.PI * 2) / count + Math.PI * 0.25;
      const offset = new V2(Math.cos(angle), Math.sin(angle)).mul(radius);
      const tv = this.tokenViews[group[i][0]][group[i][1]];
      tv.CurrentWorldPos = tv.CurrentWorldPos.add(offset);
      tv.BaseScale = scale;
    }
  }

  private AnimateTokens(dt: number) {
    const time = Time.time;
    const boardScale = this.boardRoot ? this.boardRoot.localScale.x : 1;

    // Animate legal destination target markers
    for (let i = 0; i < this.targetMarkers.length; i++) {
      const tm = this.targetMarkers[i];
      if (!tm.Root.activeSelf) continue;

      const pulse = 1 + 0.14 * Math.sin(time * 7 + i);
      tm.Ring.transform.localScale = V3.one.mul(TileStep * 0.96 * boardScale * pulse);
      tm.Glow.transform.localScale = V3.one.mul(TileStep * 1.55 * boardScale * pulse);

      const bounceY = (TileStep * 0.52 + 0.14 * Math.abs(Math.sin(time * 6.5 + i))) * boardScale;
      tm.Arrow.transform.localPosition = new V3(0, bounceY, 0);
      tm.Arrow.transform.localScale = V3.one.mul(TileStep * 0.46 * boardScale);

      if (tm.CaptureCross.gameObject.activeSelf) {
        tm.CaptureCross.transform.localRotation = Quaternion.euler(0, 0, time * 140);
        tm.CaptureCross.transform.localScale = V3.one.mul(TileStep * 0.56 * boardScale * pulse);
      }
    }

    // Animate tokens (selection pulse + captured fly-back arcs)
    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      if (!this.state.ActivePlayers[p]) continue;
      for (let t = 0; t < LudoBoard.TokensPerPlayer; t++) {
        const tv = this.tokenViews[p][t];

        // Captured token flying back to yard
        if (tv.FlyT >= 0) {
          tv.FlyT += dt * 2.1;
          const k = Mathf.clamp01(tv.FlyT);
          const pos = V2.lerp(tv.FlyFrom, tv.FlyTo, Ease.inOutCubic(k));
          const arc = 1.6 * 4 * k * (1 - k);
          tv.Root.position = pos;
          tv.Visual.localPosition = new V3(0, arc, 0);
          tv.Visual.localRotation = Quaternion.euler(0, 0, k * 720);

          if (tv.FlyT >= 1) {
            tv.FlyT = -1;
            tv.Visual.localPosition = V3.zero;
            tv.Visual.localRotation = Quaternion.identity;
            this.Fx.ring(tv.FlyTo, PlayerColors[p], 0.15, 0.95, 0.25);
            this.SnapAllTokensToLogicalPositions();
          }
          continue;
        }

        // Selectable legal token pulse on player's turn
        const am = this.activeMove;
        if (tv.SelectRing.gameObject.activeSelf) {
          const s = 1 + 0.14 * Math.sin(time * 8 + tv.PulsePhase);
          tv.SelectRing.transform.localScale = V3.one.mul(TileStep * 1.22 * s);
          const bob = 0.07 * Math.abs(Math.sin(time * 6.5 + tv.PulsePhase));
          tv.Visual.localPosition = new V3(0, bob, 0);
        } else if (this.turnPhase !== TurnPhase.MovingToken || am.Player !== p || am.TokenIndex !== t) {
          tv.Visual.localPosition = V3.zero;
        }

        // Springy landing squash for tokens that are not mid-hop
        const hopping = this.turnPhase === TurnPhase.MovingToken && am.Player === p && am.TokenIndex === t;
        if (!hopping && tv.LandSquash > 0) {
          tv.LandSquash = Mathf.moveTowards(tv.LandSquash, 0, dt * 4.5);
          const sq = Math.sin(tv.LandSquash * Math.PI * 1.5) * tv.LandSquash;
          tv.Visual.localScale = new V3(1 + 0.18 * sq, 1 - 0.15 * sq, 1);
          if (tv.LandSquash <= 0) tv.Visual.localScale = V3.one;
        }
      }
    }
  }

  private AnimateAmbient(dt: number) {
    const time = Time.time;

    if (this.crownCenterStar) {
      const s = TileStep * (0.68 + 0.05 * Math.sin(time * 3.2));
      this.crownCenterStar.transform.localScale = new V3(s, s, 1);
    }

    if (this.diceBouncePop > 0) {
      this.diceBouncePop = Mathf.moveTowards(this.diceBouncePop, 0, dt * 4.5);
      const popScale = 1 + 0.22 * Ease.outCubic(this.diceBouncePop);
      this.diceWorldRoot!.localScale = V3.one.mul(0.58 * popScale);
    } else if (this.turnPhase === TurnPhase.AwaitRoll && this.IsLocal(this.state.CurrentTurn) && this.State === Phase.Playing && this.askT <= 0) {
      const pulse = 1 + 0.07 * Math.sin(time * 6);
      this.diceWorldRoot!.localScale = V3.one.mul(0.58 * pulse);
    }

    if (this.velvetBackdrop) {
      const c = this.Fx.CameraTarget;
      this.velvetBackdrop.transform.position = new V3(c.x, c.y, 0);
    }

    // Gold dust drifts upward and wraps around
    for (let i = 0; i < this.ambientSparks.length; i++) {
      const sp = this.ambientSparks[i];
      const w = 0.5 + 0.5 * Math.sin(time * sp.Speed * 3 + sp.Phase);
      const y = Mathf.repeat(sp.BasePos.y + 16 + time * sp.Speed, 32) - 16;
      const x = sp.BasePos.x + Math.sin(time * 0.5 + sp.Phase) * 0.6;
      sp.Tr.localPosition = new V2(x, y);
      const sc = sp.BaseScale * (0.75 + 0.45 * w);
      sp.Tr.localScale = new V3(sc, sc, 1);
      sp.Sr.color = sp.Color.withAlpha(0.10 + 0.22 * w);
    }

    // The die glides to whoever's turn it is
    if (this.diceWorldRoot) {
      const lp = this.diceWorldRoot.localPosition;
      this.diceWorldRoot.localPosition = V3.lerp(new V3(lp.x, lp.y, 0), this.diceTargetLocal, 1 - Math.exp(-dt * 9));
    }

    this.AnimateConfetti(dt);
  }

  private UpdateYardTurnHighlights() {
    const pulse = 0.55 + 0.45 * Math.sin(Time.time * 6.5);
    for (let p = 0; p < LudoBoard.PlayerCount; p++) {
      const yv = this.yardViews[p];
      const isTurn = this.state.ActivePlayers[p] && this.state.CurrentTurn === p && !this.matchEnded;
      yv.TurnHalo.color = isTurn ? Color.lerp(RoyalGold, Pal.hex(0xfff1c9), pulse * 0.5).withAlpha(0.55 + 0.4 * pulse) : Color.clear;
    }
    if (this.boardAura) {
      this.boardAura.color = Color.lerp(this.boardAura.color, PlayerColors[this.state.CurrentTurn].withAlpha(0.22), Time.deltaTime * 5);
    }
  }

  private UpdateDiceVisuals(face: number, accent: Color, golden: boolean) {
    face = Mathf.clamp(face, 1, 6);
    const rimColor = golden ? RoyalGold : accent;
    const pipColor = golden ? LudoArt.GoldDeep : face === 6 ? RubyRed : Ebony;
    const faceColor = golden ? Pal.hex(0xffe7a8) : LudoArt.Ivory;

    // World Die: ivory (or gold) cube; a soft glow in the roller's colour
    if (this.diceRim) {
      this.diceRim.color = golden ? LudoArt.GoldDeep : Pal.hex(0xb9a68e);
      this.diceGlow.color = rimColor.withAlpha(golden ? 0.55 : 0.22);
      this.diceFace.color = faceColor;
    }

    // HUD Die
    if (this.diceHudRim) {
      this.diceHudRim.color = rimColor;
      this.diceHudGlow.color = rimColor.withAlpha(golden ? 0.55 : 0.35);
      this.diceHudFace.color = faceColor;
    }

    for (let i = 0; i < 9; i++) {
      if (this.dicePips[i]) this.dicePips[i].gameObject.setActive(false);
      if (this.diceHudPips[i]) this.diceHudPips[i].gameObject.setActive(false);
    }

    const activePips = FacePipIndices[face];
    for (let i = 0; i < activePips.length; i++) {
      const idx = activePips[i];
      if (this.dicePips[idx]) {
        this.dicePips[idx].gameObject.setActive(true);
        this.dicePips[idx].color = pipColor;
      }
      if (this.diceHudPips[idx]) {
        this.diceHudPips[idx].gameObject.setActive(true);
        this.diceHudPips[idx].color = pipColor;
      }
    }
  }

  private UpdateHud() {
    if (!this.coinCountText) return;
    const state = this.state, turnPhase = this.turnPhase, currentRoll = this.currentRoll;

    this.coinCountText.text = Fmt.n(this.Coins);
    this.stageTitleText.text = this.online ? `PRIVATE TABLE · ${this.onlineStart.seats.length > 2 ? "2 + 2 CPU" : "1v1"}`
      : this.localMatch ? `OFFLINE MATCH · ${this.LocalPlayers} PLAYERS` : `STAGE ${this.currentStage.StageNumber} · ${this.currentStage.ArenaName}`;

    const p = state.CurrentTurn;
    const pCol = PlayerColors[p];
    const mine = this.online ? p === this.mySeat : this.IsHuman(p);
    const pName = (this.online ? p === this.mySeat : p === 0 && !this.localMatch) ? "YOUR" : this.SeatName(p) + "'S";

    if (mine) {
      if (turnPhase === TurnPhase.AwaitRoll && this.askT > 0) {
        this.turnBannerText.text = "ROLLING...";
        this.turnBannerText.color = AmberGold;
        this.diceHudPrompt.text = "ROLLING...";
        this.diceHudSub.text = "GOOD LUCK!";
      } else if (turnPhase === TurnPhase.AwaitRoll) {
        this.turnBannerText.text = this.localMatch ? `${SeatNames[p]}'S TURN — TAP DICE TO ROLL!` : "YOUR TURN — TAP DICE TO ROLL!";
        this.turnBannerText.color = pCol;
        this.diceHudPrompt.text = "ROLL DICE";
        this.diceHudSub.text = state.ConsecutiveSixes > 0 ? `STREAK: ${state.ConsecutiveSixes}x SIX!` : "TAP OR SPACE";
      } else if (turnPhase === TurnPhase.RollingDice) {
        this.turnBannerText.text = "ROLLING...";
        this.turnBannerText.color = AmberGold;
        this.diceHudPrompt.text = "ROLLING...";
        this.diceHudSub.text = "GOOD LUCK!";
      } else if (turnPhase === TurnPhase.AwaitMove) {
        this.turnBannerText.text = `ROLLED ${currentRoll} — TAP A GLOWING TOKEN!`;
        this.turnBannerText.color = AmberGold;
        this.diceHudPrompt.text = `MOVE (${currentRoll})`;
        this.diceHudSub.text = "TAP TOKEN OR HERE";
      } else {
        this.turnBannerText.text = `ROLLED ${currentRoll}`;
        this.turnBannerText.color = RubyRed;
        this.diceHudPrompt.text = `ROLLED ${currentRoll}`;
        this.diceHudSub.text = "MOVING...";
      }
    } else {
      this.turnBannerText.text = `${pName} TURN` + (turnPhase === TurnPhase.AwaitMove || turnPhase === TurnPhase.MovingToken ? ` (ROLLED ${currentRoll})` : "...");
      this.turnBannerText.color = pCol;
      this.diceHudPrompt.text = this.SeatName(p);
      this.diceHudSub.text = turnPhase === TurnPhase.RollingDice ? "ROLLING..." : `ROLLED ${currentRoll}`;
    }

    if (this.localMatch) {
      let sb = "HOME: ";
      let first = true;
      for (let s = 0; s < LudoBoard.PlayerCount; s++) {
        if (!state.ActivePlayers[s]) continue;
        if (!first) sb += "   ·   ";
        sb += SeatNames[s] + " " + state.HomeCount(s) + "/4";
        first = false;
      }
      this.subStatusText.text = sb;
    } else if (this.online) {
      let sb = `HOME: YOU ${state.HomeCount(this.mySeat)}/4   ·   FRIEND ${state.HomeCount(this.FriendSeat)}/4`;
      for (let s = 0; s < LudoBoard.PlayerCount; s++)
        if (state.ActivePlayers[s] && s !== HostSeat && s !== GuestSeat) sb += `   ·   ${this.SeatName(s)} ${state.HomeCount(s)}/4`;
      this.subStatusText.text = sb;
    } else this.subStatusText.text = `HOME: YOU ${state.HomeCount(0)}/4   ·   CAPTURES: ${this.playerCapturesThisRun}`;
    if (this.localMatch) this.diceHudSub.text = turnPhase === TurnPhase.AwaitRoll ? `${SeatNames[p]} · TAP TO ROLL` : this.diceHudSub.text;

    const human = this.online ? this.IsLocal(p) && this.askT <= 0 : this.IsHuman(p);
    this.diceHudButton.setAccent(human ? (turnPhase === TurnPhase.AwaitMove ? AmberGold : pCol) : Pal.TextDim);
    this.diceHudButton.interactable = human && (turnPhase === TurnPhase.AwaitRoll || turnPhase === TurnPhase.AwaitMove) && !this.matchEnded;

    const rerollButton = this.rerollButton!, goldenSixButton = this.goldenSixButton!;
    const needAdForReroll = this.Coins < RerollCost && AdService.rewardedAvailable;
    if (rerollButton.label)
      rerollButton.label.text = needAdForReroll ? `+${AdCoinGrant} COINS (AD)` : `REROLL · ${RerollCost}`;
    rerollButton.interactable = p === 0 && !this.matchEnded && ((turnPhase === TurnPhase.AwaitMove && !this.rerollUsedThisTurn && this.Coins >= RerollCost) || needAdForReroll);

    const needAdForGolden = this.Coins < GoldenSixCost && AdService.rewardedAvailable;
    if (goldenSixButton.label)
      goldenSixButton.label.text = needAdForGolden ? `+${AdCoinGrant} COINS (AD)` : `GOLDEN 6 · ${GoldenSixCost}`;
    goldenSixButton.interactable = p === 0 && !this.matchEnded && (((turnPhase === TurnPhase.AwaitRoll || turnPhase === TurnPhase.AwaitMove) && !this.isGoldenRoll && this.Coins >= GoldenSixCost) || needAdForGolden);
  }
}
