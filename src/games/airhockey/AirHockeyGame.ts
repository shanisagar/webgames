import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject, howTo, Keyboard,
  LineRenderer, LoopSource, Mathf, Mouse, OnlineLink, OnlineRoom, overUI, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer,
  tableCodeFromUrl, TableLobby, TableOverlay, Text, TextAnchor, Time, Touchscreen, TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import { BlockerSprite, GoldCoin, HoleGlow, MalletSprite, P1Col, P2Col, PuckCol, PuckSprite, RinkH, RinkSprite, RinkW } from "./HockeyArt";
import { Ev, GoalHalf, HL, HockeyAI, HockeyEvent, HockeyLevels, HW, MaxPuck, RM, RP, Rink } from "./HockeyPhysics";

/**
 * AIR HOCKEY: a neon air table. Your mallet follows your finger (or the mouse) and hands its speed to the puck; flick
 * the puck into the far slot. FIRST TO 7 or the most goals in TWO MINUTES. VS CPU (easy / medium / hard: it predicts
 * the puck's bounces to defend, lines up attacking shots and, on hard, banks off the side rails), 2 PLAYERS on one
 * device (each player owns a half; true multi-touch) or SOLO: a 90-second goal rush past sliding blockers.
 */

const Gold = Pal.hex(0xffc93c), Red = Pal.hex(0xff4a5a), Ink = Pal.hex(0x05060f), White = Pal.hex(0xe8eeff);
const ModeNames = ["SOLO", "VS CPU", "2 PLAYERS", "ONLINE"];
const Online = 3;
const OnlinePrize = 80;
/** Online: the host runs the only simulation and streams this compact state (~20/s); the guest sends its target. */
interface HStart { match: number }
interface HState {
  k: number; st: number; tm: number; cd: number; cl: number; sc: number[];
  p: number[]; on: number; m: number[];
  g: number; gg: number; h: number[][]; ov: number; mt: number; sh: number[]; top: number;
  /** host clock (ms) when sent: the guest interpolates on the host's timeline */
  t: number;
}
const SendEvery = 1 / 20, InputEvery = 1 / 30, InterpDelay = 0.1;
const r2 = (v: number) => Math.round(v * 100) / 100;
const MatchNames = ["FIRST TO 7", "2 MINUTES"];
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const CpuNames = ["ROOKIE", "ACE", "LEGEND"];
const Prizes = [50, 100, 200];
const WinGoals = 7, MatchTime = 120, SoloTime = 90;
const PlayerCols = [P1Col, P2Col];
const FingerLead = 0.8;

enum Step { Countdown, Play, Goal, Wait }

export class AirHockeyGame extends ArcadeGame {
  private table!: GameObject;
  private puck!: SpriteRenderer; private puckGlow!: SpriteRenderer; private puckShadow!: SpriteRenderer;
  private mallets: { root: GameObject; body: SpriteRenderer; glow: SpriteRenderer; shadow: SpriteRenderer; ring: SpriteRenderer }[] = [];
  private trail!: LineRenderer; private trailPts: V2[] = [];
  private goalGlow: SpriteRenderer[] = [];
  private blockerViews: SpriteRenderer[] = [];
  private fx!: CasualFx; private fxWorld!: CasualFx;
  private rink = new Rink();
  private ai: HockeyAI | null = null;
  private step = Step.Wait;
  private timer = 0;
  private tableScale = 1; private tableRot = 0; private portrait = true;

  private mode = 1; private match = 0; private diff = 1;
  private score = [0, 0];
  private clock = MatchTime;
  private headStart = false;
  private revived = false;
  private stall = 0;
  private hits = [0, 0]; private shots = [0, 0]; private topSpeed = 0;
  private streak = 0; private bestStreakRun = 0; private conceded = 0;
  private touchOwner = new Map<number, number>();
  private lastMouse = V2.zero; private mouseActive = false;
  private flash = [0, 0];

  // HUD
  private board!: UINode; private scoreText: Text[] = []; private nameText: Text[] = []; private clockText!: Text;
  private sideScore: Text[] = [];
  private soloText!: Text;
  private modeButton: ArcadeButton | null = null; private matchButton!: ArcadeButton; private diffButton!: ArcadeButton; private modeLabel!: Text;

  // online
  private lobby!: TableLobby; private overlay!: TableOverlay;
  private link: OnlineLink<HStart, number, HState> | null = null;
  private me = 0; private onlineMatch = 0; private onlineGo = false; private autoJoined = false; private forfeit = false; private ended = false;
  private netK = 0; private sendAcc = 0; private inAcc = 0;
  private goalId = 0; private hitId = 0; private hitLog: number[][] = [];
  private buf: { at: number; s: HState }[] = []; private seenGoal = 0; private seenHit = 0; private lastStep = -1; private latest: HState | null = null;
  private guestTarget: V2 | null = null;
  private playT = 0;

  private hitClip: AudioClip[] = []; private wallClip!: AudioClip; private goalClip!: AudioClip; private humClip!: AudioClip; private postClip!: AudioClip;
  private hum: LoopSource | null = null;
  private soundsThisFrame = 0;

  protected Describe() {
    return new GameInfo({
      Id: "airhockey",
      Title: "AIR HOCKEY",
      Tagline: "FLICK THE PUCK INTO THEIR GOAL",
      PlayLabel: "PLAY",
      Accent: P1Col,
      Accent2: P2Col,
      BgTop: Pal.hex(0x120a36),
      BgBottom: Pal.hex(0x03030c),
      GridSpacing: 1.2,
      ShortSide: 20,
      Touch: TouchScheme.None,
      Music: { bpm: 124, rootHz: 98, degrees: [0, 3, 7, 5], seed: 17, energy: 0.6, major: false },
      Reminders: [
        "The table is humming|First to 7 wins.",
        "LEGEND is waiting|Can you beat the hard CPU?",
        "Grab a friend|Two players, one phone, both thumbs.",
      ],
      HowTo: [
        howTo(Art.Disc, P1Col, "Your mallet follows your finger (or mouse). Move fast to hit hard."),
        howTo(Art.Chevron, PuckCol, "Knock the puck into the far goal. Bank it off the side rails!"),
        howTo(Art.Square, P2Col, "2 PLAYERS: each player owns a half of the table. Both can touch at once."),
        howTo(Art.Star, Gold, "FIRST TO 7 goals wins, or most goals in TWO MINUTES."),
        howTo(Art.Diamond, Pal.hex(0xff9a3c), "SOLO: score as many goals as you can in 90 s past the sliding blockers."),
      ],
      Tips: [
        "Hit the puck off-centre to angle it past the defender.",
        "Stay between the puck and your goal when defending.",
        "A bank shot off the side rail is hard to read.",
        "Don't chase: let the puck come to you, then strike.",
      ],
    });
  }

  protected get ShortSide() { return 20; }
  private get Coins() { return this.Data.get("coins", 100); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }
  protected BestLine() { return `COINS ${Fmt.n(this.Coins)}   ·   WIN STREAK ${this.Data.get("streak")}`; }
  protected StatsLine() { return `${this.Data.get("wins")} WINS   ·   ${this.Data.get("goals")} GOALS   ·   SOLO BEST ${this.Data.get("bestSolo")}`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Coins = 100; this.Data.set("mode", 1); this.Data.set("diff", 1); }
    this.table = new GameObject("Rink", this.gameObject);
    const t = this.table;
    const shadowSr = Art.spr(t, "RinkGlow", Art.Glow, Pal.hex(0x3a40ff).withAlpha(0.25), RinkH * 1.5, -20, Art.Additive);
    shadowSr.transform.localScale = new V3(RinkW * 1.6, RinkH * 1.25, 1);
    Art.spr(t, "RinkArt", RinkSprite(), Color.white, RinkW, 0, Art.Flat);
    for (let i = 0; i < 2; i++) {
      const g = Art.spr(t, "GoalGlow" + i, HoleGlow(), PlayerCols[i].withAlpha(0), GoalHalf * 4.5, 2, Art.Additive);
      g.transform.localPosition = new V3(0, i === 0 ? -HL : HL, 0);
      this.goalGlow.push(g);
    }
    for (let k = 0; k < 3; k++) { const b = Art.spr(t, "Blocker" + k, BlockerSprite(), Color.white, 1, 6, Art.Solid); b.gameObject.setActive(false); this.blockerViews.push(b); }
    this.trail = Art.line(t, "Trail", PuckCol, RP * 1.4, 8, false, false, Art.LineMat);
    this.puckShadow = Art.spr(t, "PuckShadow", Art.Glow, new Color(0, 0, 0, 0.6), RP * 3, 9, Art.Flat);
    this.puckGlow = Art.spr(t, "PuckGlow", Art.Glow, PuckCol.withAlpha(0.6), RP * 5, 10, Art.Additive);
    this.puck = Art.spr(t, "Puck", PuckSprite(), Color.white, RP * 2 / 0.95, 12, Art.Flat);
    for (let i = 0; i < 2; i++) {
      const root = new GameObject("Mallet" + i, t);
      const shadow = Art.spr(root, "Shadow", Art.Glow, new Color(0, 0, 0, 0.6), RM * 3, 13, Art.Flat);
      shadow.transform.localPosition = new V3(0.12, -0.18, 0);
      const glow = Art.spr(root, "Glow", Art.Glow, PlayerCols[i].withAlpha(0.55), RM * 4.2, 14, Art.Additive);
      const ring = Art.spr(root, "Ring", Art.Ring, PlayerCols[i].withAlpha(0), RM * 2.6, 15, Art.Additive);
      const body = Art.spr(root, "Body", MalletSprite(PlayerCols[i], "p" + i), Color.white, RM * 2 / 0.95, 16, Art.Flat);
      this.mallets.push({ root, body, glow, shadow, ring });
    }
    this.fx = CasualFx.create(t, 30, 200);
    this.fxWorld = CasualFx.create(this.gameObject, 260, 140);
    this.BuildHud();
    this.BuildTitleExtras();
    this.BuildSounds();
    this.BuildOnline();
    this.rink.placePuck(0, 0);
    this.Layout();
  }

  private BuildSounds() {
    const noise = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    for (let k = 0; k < 3; k++) {
      const f = 900 + k * 180;
      this.hitClip.push(Sfx.make("ah-hit" + k, 0.12, (t) => (Sfx.sinP(Sfx.glide(t, f * 1.6, f, 0.03)) * 0.55 + Sfx.sqrP(f * 0.5 * t) * 0.12 + noise(Math.trunc(t * 44100) + k * 91) * 0.5 * Sfx.env(t, 0, 0.006)) * Sfx.env(t, 0.0005, 0.045) * 0.8));
    }
    this.wallClip = Sfx.make("ah-wall", 0.16, (t) => (Sfx.sinP(Sfx.glide(t, 420, 160, 0.05)) * 0.6 + noise(Math.trunc(t * 44100) + 5) * 0.4 * Sfx.env(t, 0, 0.012)) * Sfx.env(t, 0.001, 0.07) * 0.7);
    this.postClip = Sfx.make("ah-post", 0.3, (t) => (Sfx.sinP(1250 * t) * 0.4 + Sfx.sinP(1870 * t) * 0.3 + Sfx.sinP(2640 * t) * 0.15) * Sfx.env(t, 0.0005, 0.16) * 0.6);
    this.goalClip = Sfx.make("ah-goal", 1.1, (t) => {
      const e = Sfx.env(t, 0.01, 0.9);
      let v = (Sfx.sawP(220 * t) * 0.3 + Sfx.sawP(277.2 * t) * 0.22 + Sfx.sawP(329.6 * t) * 0.2 + Sfx.sqrP(110 * t) * 0.15) * e;
      v += noise(Math.trunc(t * 44100)) * Sfx.env(t, 0.002, 0.08) * 0.35;
      return v * 0.55;
    });
    this.humClip = Sfx.make("ah-hum", 2, (t) => (Sfx.sinP(60 * t) * 0.5 + Sfx.sinP(120 * t) * 0.3 + Sfx.sinP(180 * t) * 0.1 + noise(Math.trunc(t * 22050)) * 0.12) * 0.5);
  }

  // ------------------------------------------------------------------ HUD

  private BuildHud() {
    const hud = this.UI.Hud;
    this.board = UIKit.node("Scoreboard", hud).place(new V2(0.5, 1), new V2(0, -80), new V2(640, 130));
    UIKit.img(this.board, "Bg", Art.UiRound, new Color(0.02, 0.02, 0.08, 0.85)).rectTransform.stretch();
    UIKit.img(this.board, "Edge", Art.UiOutline, new Color(0.6, 0.7, 1, 0.3)).rectTransform.stretch();
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? -1 : 1;
      this.nameText.push(UIKit.at(UIKit.label(this.board, "", 26, PlayerCols[i]), UIKit.Center, new V2(x * 205, 30), new V2(220, 36)));
      const s = UIKit.at(UIKit.label(this.board, "0", 76, Color.white), UIKit.Center, new V2(x * 205, -18), new V2(200, 84));
      UIKit.glow(s, PlayerCols[i], 4);
      this.scoreText.push(s);
      const side = UIKit.at(UIKit.label(hud, "0", 180, PlayerCols[i].withAlpha(0.22)), UIKit.Center, V2.zero, new V2(300, 200));
      side.raycastTarget = false;
      this.sideScore.push(side);
    }
    this.clockText = UIKit.at(UIKit.label(this.board, "", 44, White), UIKit.Center, new V2(0, 0), new V2(200, 60));
    UIKit.glow(this.clockText, Ink, 3);
    this.soloText = UIKit.at(UIKit.label(this.board, "", 26, Gold), UIKit.Center, new V2(0, -42), new V2(260, 34));
    const wallet = UIKit.node("Wallet", hud).place(new V2(0, 1), new V2(130, -80), new V2(220, 64));
    UIKit.img(wallet, "Bg", Art.UiRound, new Color(0, 0, 0, 0.5)).rectTransform.stretch();
    UIKit.img(wallet, "Coin", GoldCoin(), Color.white).rectTransform.place(new V2(0, 0.5), new V2(34, 0), new V2(44, 44));
    this.walletText = UIKit.at(UIKit.label(wallet, "", 30, Gold, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(130, 0), new V2(140, 44));
    this.wallet = wallet;
  }
  private wallet!: UINode; private walletText!: Text;

  private BuildTitleExtras() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    this.modeButton = UIKit.buttonAt(ex, "VS CPU", UIKit.Center, new V2(-330, 10), new V2(310, 104), false, () => this.Cycle("mode", 4), 30);
    this.matchButton = UIKit.buttonAt(ex, "FIRST TO 7", UIKit.Center, new V2(0, 10), new V2(310, 104), false, () => this.Cycle("match", 2), 28);
    this.diffButton = UIKit.buttonAt(ex, "MEDIUM", UIKit.Center, new V2(330, 10), new V2(310, 104), false, () => this.Cycle("diff", 3), 30);
    this.modeButton.setAccent(P1Col);
    this.matchButton.setAccent(Gold);
    this.diffButton.setAccent(P2Col);
    this.modeLabel = UIKit.at(UIKit.label(ex, "", 25, new Color(1, 1, 1, 0.85)), UIKit.Center, new V2(0, -68), new V2(980, 36));
    CasualLook.titleCard(this.UI, new Color(0.02, 0.02, 0.09, 0.72), new V2(1060, 1060), -10);
  }

  private get SelMode() { return Mathf.clamp(this.Data.get("mode", 1), 0, 3); }

  private Cycle(key: string, n: number) {
    this.Data.set(key, (this.Data.get(key) + 1) % n);
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
  }

  private RefreshTitle() {
    if (!this.modeButton) return;
    const m = this.SelMode, mt = Mathf.clamp(this.Data.get("match"), 0, 1), d = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    if (this.modeButton.label) this.modeButton.label.text = ModeNames[m];
    if (this.matchButton.label) this.matchButton.label.text = m === 0 ? "90 SEC RUSH" : MatchNames[mt];
    if (this.diffButton.label) this.diffButton.label.text = m === 1 ? DiffNames[d] : "—";
    this.matchButton.interactable = m !== 0;
    this.diffButton.interactable = m === 1;
    this.modeLabel.text = m === 0 ? "SCORE PAST THE SLIDING BLOCKERS: 90 SECONDS" : m === 1 ? `BEAT ${CpuNames[d]} AND WIN ${Prizes[d]} COINS`
      : m === Online ? `PLAY A FRIEND ON THEIR OWN PHONE · WIN ${OnlinePrize} COINS` : "ONE PHONE, TWO PLAYERS: EACH OWNS A HALF";
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); this.layoutFrames = 2; }
  private layoutFrames = 3;

  private Layout() {
    if (!this.table) return;
    this.portrait = Screen.height > Screen.width;
    // online guest: the rink turns half way round so their own goal is at the bottom (left in landscape)
    this.tableRot = (this.portrait ? 0 : -90) + (this.mode === Online && this.me === 1 ? 180 : 0);
    const w = this.portrait ? RinkW : RinkH, h = this.portrait ? RinkH : RinkW;
    const r = this.portrait ? this.PlayRect(250, 40, 0.2) : this.PlayRect(170, 30, 0.2);
    this.tableScale = Math.min((r.xMax - r.xMin) / w, (r.yMax - r.yMin) / h);
    const cx = (r.xMin + r.xMax) / 2, cy = (r.yMin + r.yMax) / 2;
    this.table.localPosition = new V3(cx, cy, 0);
    this.table.localScale = new V3(this.tableScale, this.tableScale, 1);
    this.table.localEulerZ = this.tableRot;
    // LineRenderer widths are world units even in local space: scale the trail with the table (kit gap)
    this.trail.widthMultiplier = RP * 1.6 * this.tableScale;
    this.board.place(new V2(0.5, 1), new V2(0, this.portrait ? -95 : -82), new V2(this.portrait ? 640 : 700, 130));
    this.wallet.place(new V2(0, 1), new V2(130, this.portrait ? -230 : -80), new V2(220, 64));
    const flip = this.mode === 2 && this.portrait;
    if (this.overlay) {
      if (this.portrait) this.overlay.place({ anchor: new V2(0.5, 0), pos: new V2(0, 60) }, { anchor: new V2(0.5, 1), pos: new V2(0, -300) });
      else this.overlay.place({ anchor: new V2(0, 0), pos: new V2(270, 60) }, { anchor: new V2(0.5, 1), pos: new V2(0, -230) });
    }
    for (let i = 0; i < 2; i++) {
      const p = this.UI.WorldToHud(this.TableToWorld(new V2(this.portrait ? HW * 0.55 : 0, (i === 0 ? -1 : 1) * HL * 0.25)));
      this.sideScore[i].rectTransform.anchoredPosition = p;
      this.sideScore[i].rectTransform.localEulerAngles = new V3(0, 0, flip && i === 1 ? 180 : this.portrait ? 0 : 0);
    }
  }

  /** Rotates by a multiple of 90 degrees (exact). */
  private static Turn(x: number, y: number, deg: number) {
    const q = ((Math.round(deg / 90) % 4) + 4) % 4;
    return q === 0 ? new V2(x, y) : q === 1 ? new V2(-y, x) : q === 2 ? new V2(-x, -y) : new V2(y, -x);
  }

  private TableToWorld(p: V2) {
    const t = AirHockeyGame.Turn(p.x, p.y, this.tableRot);
    const lp = this.table.localPosition;
    return new V2(lp.x + t.x * this.tableScale, lp.y + t.y * this.tableScale);
  }

  private ScreenToTable(screen: V2) {
    const w = this.ScreenToWorld(screen);
    const lp = this.table.localPosition;
    return AirHockeyGame.Turn((w.x - lp.x) / this.tableScale, (w.y - lp.y) / this.tableScale, -this.tableRot);
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.LeaveTable();
    this.mode = 1; this.me = 0; this.ended = false;
    this.rink = new Rink();
    this.rink.placePuck(0, 0, 9, 14);
    this.ai = null;
    this.attract = [new HockeyAI(HockeyLevels[1], 0), new HockeyAI(HockeyLevels[1], 1)];
    this.SetBlockers(-1);
    
    this.Layout();
    this.RefreshTitle();
    // an invite link (?table=12345) opens the join panel and joins straight away
    const code = tableCodeFromUrl();
    if (code && !this.autoJoined) {
      this.autoJoined = true;
      this.Data.set("mode", Online);
      this.RefreshTitle();
      this.lobby.open("join", code);
    }
  }
  private attract: HockeyAI[] = [];

  protected BeginRun() {
    this.mode = this.SelMode;
    this.match = Mathf.clamp(this.Data.get("match"), 0, 1);
    this.ended = false; this.forfeit = false; this.playT = 0;
    if (this.mode === Online) {
      this.me = this.link ? this.link.me : 0; this.match = this.onlineMatch;
      this.buf = []; this.latest = null; this.seenGoal = 0; this.seenHit = 0; this.goalId = 0; this.hitId = 0; this.hitLog = []; this.netK = 0; this.lastStep = -1; this.guestTarget = null;
    } else this.me = 0;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.Data.add("games", 1);
    this.rink = new Rink();
    this.rink.events = [];
    this.rink.active = [true, this.mode !== 0];
    this.ai = this.mode === 1 ? new HockeyAI(HockeyLevels[this.diff], 1) : null;
    this.score = [this.headStart && this.mode === 1 ? 1 : 0, 0];
    if (this.headStart) this.UI.Toast("+1 GOAL HEAD START!", 2);
    this.headStart = false;
    this.clock = this.mode === 0 ? SoloTime : MatchTime;
    this.revived = false;
    this.hits = [0, 0]; this.shots = [0, 0]; this.topSpeed = 0;
    this.streak = 0; this.bestStreakRun = 0; this.conceded = 0;
    this.touchOwner.clear();
    this.trailPts = [];
    this.SetBlockers(this.mode === 0 ? 0 : -1);
    const names = this.Names();
    for (let i = 0; i < 2; i++) {
      // the scoreboard's left slot is always "me"
      const slot = this.Seat(i);
      this.nameText[slot].text = names[i]; this.nameText[slot].color = PlayerCols[i];
      UIKit.glow(this.scoreText[slot], PlayerCols[i], 4);
      this.mallets[i].root.setActive(this.mode !== 0 || i === 0);
    }
    for (let i = 0; i < 2; i++) { this.sideScore[i].gameObject.setActive(this.mode !== 0); this.scoreText[i].gameObject.setActive(true); }
    if (!this.hum) this.hum = Sfx.createLoop(this.humClip);
    Sfx.setIntensity(0.5);
    this.layoutFrames = 2;
    this.Layout();
    this.StartFaceoff(-1);
    this.UpdateHud();
  }

  private Seat(i: number) { return this.mode === Online && this.me === 1 ? 1 - i : i; }

  private Names() {
    if (this.mode === Online) return this.me === 0 ? ["YOU", "FRIEND"] : ["FRIEND", "YOU"];
    if (this.mode === 0) return ["GOALS", "STREAK"];
    if (this.mode === 1) return ["YOU", CpuNames[this.diff]];
    return ["PLAYER 1", "PLAYER 2"];
  }

  /** Puck back in play: in the half of the player who conceded (or the centre to start). */
  private StartFaceoff(conceder: number) {
    const y = conceder < 0 ? 0 : conceder === 0 ? -3.2 : 3.2;
    this.rink.placePuck(this.mode === 0 ? 0 : (Math.random() - 0.5) * 2, this.mode === 0 ? -3.2 : y);
    this.trailPts = [];
    this.step = Step.Countdown;
    this.timer = conceder < 0 ? 2.99 : 0.9;
    this.counting = conceder < 0;
    this.countShown = 0;
    this.stall = 0;
  }
  private countShown = 0; private counting = false;

  protected OnPauseChanged(paused: boolean) { if (this.hum) this.hum.volume = paused ? 0 : this.hum.volume; this.touchOwner.clear(); }

  private SetBlockers(level: number) {
    const bl = this.rink.blockers;
    bl.length = 0;
    if (level >= 0) {
      const sp = 2.6 + level * 0.45;
      bl.push({ x: -2, y: 4.6, half: 1.1, r: 0.3, vx: sp, minX: -HW + 1.5, maxX: HW - 1.5 });
      if (level >= 2) bl.push({ x: 2, y: 6.8, half: 0.9, r: 0.3, vx: -sp * 1.2, minX: -HW + 1.3, maxX: HW - 1.3 });
      if (level >= 5) bl.push({ x: 0, y: 2.6, half: 0.8, r: 0.3, vx: sp * 0.9, minX: -HW + 1.2, maxX: HW - 1.2 });
    }
    for (let k = 0; k < this.blockerViews.length; k++) this.blockerViews[k].gameObject.setActive(k < bl.length);
  }

  // ------------------------------------------------------------------ frame loop

  protected TickBackground(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    this.lobby.tick(Time.unscaledDeltaTime);
    this.overlay.tick();
    if (this.State === Phase.Title && this.attract.length) {
      this.attract[0].update(this.rink, dt);
      this.attract[1].update(this.rink, dt);
      this.rink.step(Math.min(dt, 0.05));
      if (this.rink.goal >= 0 || !this.rink.puckOn) this.rink.placePuck(0, 0, (Math.random() - 0.5) * 16, (Math.random() < 0.5 ? -1 : 1) * 12);
    }
    if (this.hum && this.State !== Phase.Playing) this.hum.volume = Mathf.moveTowards(this.hum.volume, 0, dt);
    this.Present(dt);
  }

  protected TickRun(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    this.soundsThisFrame = 0;
    if (this.mode === Online) { this.OnlineTick(dt); return; }
    this.timer -= dt;
    this.ReadInput(dt);
    if (this.ai) this.ai.update(this.rink, dt);
    this.Sim(dt);
    this.UpdateHud();
    this.Present(dt);
  }

  /** One frame of the match (local modes, and the online host). */
  private Sim(dt: number) {
    const r = this.rink;
    switch (this.step) {
      case Step.Countdown: {
        // mallets move, puck waits
        const on = r.puckOn; r.puckOn = false; r.step(dt); r.puckOn = on;
        const n = Math.ceil(this.timer);
        if (this.counting && n !== this.countShown && n >= 1) { this.countShown = n; this.UI.Announce(String(n), White, 0.7); Sfx.play(Snd.Beep, 0.6); }
        if (this.timer <= 0) { this.step = Step.Play; if (this.counting) { this.UI.Announce("GO!", Gold, 0.6); Sfx.play(Snd.BeepHigh, 0.7); } this.counting = false; }
        break;
      }
      case Step.Play: {
        // the clock runs only while the puck is live
        this.clock -= dt;
        r.step(dt);
        this.HandleEvents();
        const sp = Math.hypot(r.vx, r.vy);
        this.topSpeed = Math.max(this.topSpeed, sp);
        this.stall = sp < 0.6 ? this.stall + dt : 0;
        if (this.stall > 7) { this.UI.Toast("PUCK RESET", 1.2); this.StartFaceoff(r.py < 0 ? 0 : 1); }
        if (r.goal >= 0) this.OnGoal(r.goal);
        else if (this.clock <= 0 && (this.mode === 0 || this.match === 1)) { this.clock = 0; this.EndMatch(); }
        if (this.clock <= 10 && this.clock > 0 && (this.mode === 0 || this.match === 1) && Math.ceil(this.clock) !== Math.ceil(this.clock + dt)) Sfx.play(Snd.Tick, 0.6, 1.3);
        break;
      }
      case Step.Goal: {
        const on = r.puckOn; r.puckOn = false; r.step(dt); r.puckOn = on;
        if (this.timer <= 0) this.AfterGoal();
        break;
      }
      case Step.Wait: break;
    }
    if (this.hum) {
      const sp = r.puckOn ? Math.hypot(r.vx, r.vy) : 0;
      this.hum.volume = Mathf.moveTowards(this.hum.volume, 0.16 + 0.1 * Mathf.clamp01(sp / 30), dt);
      this.hum.pitch = 1 + 0.08 * Mathf.clamp01(sp / 40);
    }
  }

  // ------------------------------------------------------------------ input (multi-touch: each finger drives the mallet on its half)

  private ReadInput(dt: number) {
    const r = this.rink;
    const self = this.mode === Online ? this.me : 0;
    const humans = this.mode === 2 ? [0, 1] : [self];
    const touched = [false, false];
    if (this.State === Phase.Paused) return;
    if (Touchscreen.present) {
      for (const t of Touchscreen.touches) {
        const id = t.touchId;
        if (t.press.wasPressedThisFrame && !overUI(t.position) && t.position.y < Screen.height * 0.93) {
          const tp = this.ScreenToTable(t.position);
          const owner = this.mode === 2 ? (tp.y < 0 ? 0 : 1) : self;
          let taken = false;
          for (const [, o] of this.touchOwner) if (o === owner) taken = true;
          if (!taken) this.touchOwner.set(id, owner);
        }
        const owner = this.touchOwner.get(id);
        if (owner === undefined) continue;
        if (!t.press.isPressed || t.press.wasReleasedThisFrame) { this.touchOwner.delete(id); continue; }
        const tp = this.ScreenToTable(t.position);
        const lead = owner === 0 ? FingerLead : -FingerLead;
        r.m[owner].tx = tp.x; r.m[owner].ty = tp.y + lead;
        touched[owner] = true;
      }
    }
    // mouse: player 1's mallet follows the pointer over the table
    // (Mouse.present only turns on after a press on the game element; a hovering mouse is enough here)
    if (!touched[self]) {
      const mp = Mouse.position;
      if (mp.sub(this.lastMouse).sqrMagnitude > 1) this.mouseActive = true;
      this.lastMouse = mp;
      if (this.mouseActive && !(Touchscreen.present && this.touchOwner.size > 0)) {
        const tp = this.ScreenToTable(mp);
        if (Math.abs(tp.x) < HW + 3 && Math.abs(tp.y) < HL + 3) { r.m[self].tx = tp.x; r.m[self].ty = tp.y; touched[self] = true; }
      }
    }
    // keyboard: WASD for player 1, arrows for player 2 (or player 1 when alone)
    const key = (l: string, rr: string, u: string, d: string) => new V2((Keyboard.key(rr).isPressed ? 1 : 0) - (Keyboard.key(l).isPressed ? 1 : 0), (Keyboard.key(u).isPressed ? 1 : 0) - (Keyboard.key(d).isPressed ? 1 : 0));
    const k1 = key("KeyA", "KeyD", "KeyW", "KeyS"), k2 = key("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown");
    const kb = this.mode === 2 ? [k1, k2] : self === 0 ? [k1.add(k2), k2] : [k1, k1.add(k2)];
    for (const i of humans) {
      let k = kb[i];
      if (this.tableRot !== 0) k = AirHockeyGame.Turn(k.x, k.y, -this.tableRot);
      if (k.sqrMagnitude > 0) { this.mouseActive = i === self ? false : this.mouseActive; const m = r.m[i]; m.tx = m.x + k.x * 30 * dt * 2.2; m.ty = m.y + k.y * 30 * dt * 2.2; touched[i] = true; }
      r.m[i].max = 90;
    }
  }

  // ------------------------------------------------------------------ events

  private HandleEvents() {
    const evs = this.rink.events!;
    for (const e of evs) {
      this.OnEvent(e);
      // online host: hits travel to the guest for sound and sparks (the last few ride along in every state)
      if (this.mode === Online && e.type !== Ev.Goal && e.speed > 2) { this.hitLog.push([++this.hitId, e.type, e.a, r2(e.speed), r2(e.x), r2(e.y)]); if (this.hitLog.length > 4) this.hitLog.shift(); }
    }
    evs.length = 0;
  }

  private OnEvent(e: HockeyEvent) {
    const p = new V2(e.x, e.y);
    if (e.type === Ev.Mallet) {
      this.hits[e.a]++;
      if (e.speed > 4) this.shots[e.a]++;
      if (this.soundsThisFrame++ < 3) Sfx.playClip(this.hitClip[Math.floor(Math.random() * 3)], 0.25 + 0.75 * Mathf.clamp01(e.speed / 40), 0.9 + Math.random() * 0.2);
      const k = Mathf.clamp01(e.speed / 45);
      this.fx.sparkle(p, Color.lerp(PlayerCols[e.a], Color.white, 0.4), 4 + Math.round(k * 8), 0.4 + k * 0.6, 0.25);
      this.fx.pop(p, PlayerCols[e.a], 4 + Math.round(k * 10), 3 + k * 6, 0.12, 0.3);
      this.flash[e.a] = 1;
      if (e.speed > 25) { this.Fx.shake(k * 0.35); Fx.haptic(e.speed > 38); }
      if (e.speed > 40) this.Hitstop(0.03);
    } else if (e.type === Ev.Wall || e.type === Ev.Post || e.type === Ev.Block) {
      if (this.soundsThisFrame++ < 3) Sfx.playClip(e.type === Ev.Post ? this.postClip : this.wallClip, Mathf.clamp01(e.speed / 35) * 0.8, 0.9 + Math.random() * 0.2);
      if (e.speed > 12) this.fx.sparkle(p, e.type === Ev.Block ? Pal.hex(0xffb04a) : White, 3 + Math.round(e.speed / 10), 0.35, 0.2);
      if (e.speed > 30) this.Fx.shake(0.12);
    }
  }

  private OnGoal(goal: number) {
    const r = this.rink;
    const scorer = goal === 0 ? 1 : 0;
    if (this.mode === Online) { this.goalId++; this.lastGoal = goal; }
    const gp = new V2(0, goal === 0 ? -HL : HL);
    this.goalGlow[goal].color = PlayerCols[scorer].withAlpha(1);
    this.fx.confetti(gp, 50, 7, [PlayerCols[scorer], Color.white, Gold], 0.25);
    this.fx.pop(gp, PlayerCols[scorer], 24, 8, 0.25, 0.6);
    this.Fx.shake(0.55);
    this.Back.Flash(PlayerCols[scorer], 0.5);
    Fx.haptic(true);
    Sfx.playClip(this.goalClip, 0.75);
    this.step = Step.Goal;
    this.timer = 1.5;
    this.trailPts = [];
    if (this.mode === 0) {
      if (goal === 1) {
        this.score[0]++;
        this.streak++;
        this.bestStreakRun = Math.max(this.bestStreakRun, this.streak);
        const bonus = this.streak >= 3 ? 2 : 0;
        this.clock += bonus;
        this.UI.Announce(this.streak >= 3 ? `GOAL! ×${this.streak} STREAK` : "GOAL!", Gold, 1.2);
        if (bonus) this.UI.Float(this.TableToWorld(gp), `+${bonus}s`, Gold, 1);
        this.SetBlockers(this.score[0]);
      } else {
        this.conceded++;
        this.streak = 0;
        this.clock = Math.max(0, this.clock - 5);
        this.UI.Announce("OWN GOAL  -5s", Red, 1.2);
      }
      this.timer = 1.0;
      void r;
      return;
    }
    this.score[scorer]++;
    this.GoalShout(scorer, gp);
    this.sidePop[scorer] = 1;
  }
  private sidePop = [0, 0];
  private lastGoal = 0;

  private GoalShout(scorer: number, gp: V2) {
    const names = this.Names();
    const mine = (this.mode === 1 || this.mode === Online) && scorer === this.me;
    this.UI.Announce(this.mode === Online ? (mine ? "GOAL!" : "FRIEND SCORES") : this.mode === 1 ? (scorer === 0 ? "GOAL!" : `${names[1]} SCORES`) : `${names[scorer]} SCORES!`, PlayerCols[scorer], 1.3);
    if (mine) this.fxWorld.confetti(this.TableToWorld(gp), 30, 7, [PlayerCols[scorer], Gold, Color.white]);
    this.sidePop[scorer] = 1;
  }

  private AfterGoal() {
    const won = this.mode !== 0 && this.match === 0 && Math.max(this.score[0], this.score[1]) >= WinGoals;
    if (won || ((this.mode === 0 || this.match === 1) && this.clock <= 0)) { this.EndMatch(); return; }
    const conceder = this.mode === 0 ? 0 : this.rink.goal >= 0 ? this.rink.goal : this.lastConceder;
    this.StartFaceoff(conceder);
  }
  private get lastConceder() { return this.score[0] >= this.score[1] ? 1 : 0; }

  // ------------------------------------------------------------------ rendering

  private Present(dt: number) {
    const r = this.rink;
    const puckOn = r.puckOn || this.step === Step.Countdown;
    this.puck.gameObject.setActive(puckOn);
    this.puckGlow.gameObject.setActive(puckOn);
    this.puckShadow.gameObject.setActive(puckOn);
    const sp = Math.hypot(r.vx, r.vy);
    if (puckOn) {
      const pp = new V3(r.px, r.py, 0);
      this.puck.transform.localPosition = pp;
      this.puckGlow.transform.localPosition = pp;
      this.puckShadow.transform.localPosition = new V3(r.px + 0.1, r.py - 0.14, 0);
      this.puckGlow.color = PuckCol.withAlpha(0.35 + 0.45 * Mathf.clamp01(sp / 40));
      this.puck.transform.localEulerZ = this.puck.transform.localEulerZ + sp * dt * 20;
      this.trailPts.push(new V2(r.px, r.py));
    }
    const maxPts = 12;
    while (this.trailPts.length > maxPts || (this.trailPts.length > 0 && (!puckOn || sp < 3))) this.trailPts.shift();
    if (this.trailPts.length >= 2) {
      this.trail.positionCount = this.trailPts.length;
      for (let i = 0; i < this.trailPts.length; i++) this.trail.setPosition(i, this.trailPts[i]);
      const k = Mathf.clamp01(sp / MaxPuck);
      this.trail.startColor = PuckCol.withAlpha(0);
      this.trail.endColor = Color.lerp(PuckCol, Pal.hex(0xff6a2a), k).withAlpha(0.55 + 0.45 * k);
      this.trail.startWidth = 0.25;
      this.trail.endWidth = 1.5;
    } else this.trail.positionCount = 0;
    for (let i = 0; i < 2; i++) {
      const m = r.m[i], v = this.mallets[i];
      v.root.localPosition = new V3(m.x, m.y, 0);
      this.flash[i] = Mathf.moveTowards(this.flash[i], 0, dt * 4);
      const owned = this.State === Phase.Playing && [...this.touchOwner.values()].includes(i);
      v.glow.color = PlayerCols[i].withAlpha(0.45 + 0.4 * this.flash[i]);
      v.ring.color = PlayerCols[i].withAlpha(owned ? 0.5 : 0);
      const s = 1 + 0.12 * this.flash[i];
      v.body.transform.localScale = new V3(s * RM * 2 / 0.95, s * RM * 2 / 0.95, 1);
      this.goalGlow[i].color = this.goalGlow[i].color.withAlpha(Mathf.moveTowards(this.goalGlow[i].color.a, 0, dt * 0.8));
    }
    for (let k = 0; k < r.blockers.length && k < this.blockerViews.length; k++) {
      const b = r.blockers[k], bv = this.blockerViews[k];
      bv.transform.localPosition = new V3(b.x, b.y, 0);
      const len = (b.half + b.r) * 2;
      bv.transform.localScale = new V3(len, len * ((b.r * 2) / len) * 4, 1);
    }
  }

  private UpdateHud() {
    const solo = this.mode === 0;
    for (let i = 0; i < 2; i++) {
      this.scoreText[this.Seat(i)].text = solo ? String(i === 0 ? this.score[0] : this.streak) : String(this.score[i]);
      this.sideScore[i].text = String(this.score[i]);
      this.sidePop[i] = Mathf.moveTowards(this.sidePop[i], 0, Time.deltaTime * 2);
      const s = 1 + 0.4 * this.sidePop[i];
      this.sideScore[i].rectTransform.localScale = new V3(s, s, 1);
      this.sideScore[i].color = PlayerCols[i].withAlpha(0.22 + 0.5 * this.sidePop[i]);
    }
    const timed = solo || this.match === 1;
    this.clockText.text = timed ? Fmt.clock(Math.ceil(Math.max(0, this.clock))) : `TO ${WinGoals}`;
    this.clockText.color = timed && this.clock <= 10 ? Color.lerp(Red, Color.white, 0.5 + 0.5 * Math.sin(Time.time * 10)) : White;
    this.soloText.text = solo ? `BEST ${this.Data.get("bestSolo")}` : "";
    this.walletText.text = Fmt.n(this.Coins);
  }

  // ------------------------------------------------------------------ online (private tables, host-authoritative real time)

  private BuildOnline() {
    const theme = { accent: P1Col, accent2: P2Col, ink: Ink };
    this.lobby = new TableLobby("airhockey", theme, {
      onReady: (room) => this.OnTableReady(room),
      toast: (t, sec) => this.UI.Toast(t, sec ?? 2),
    }, "Air Hockey");
    this.overlay = new TableOverlay(theme, () => { this.overlay.hide(); this.EnterTitle(); }, (k) => this.link?.react(k));
    this.overlay.onTimeout = () => { this.link?.leave(); this.FriendLeft(); };
  }

  /** Online the match keeps running while the pause menu is open: the friend is still playing. */
  update() {
    super.update();
    if (this.State === Phase.Paused && this.mode === Online && !this.ended) this.OnlineTick(Time.unscaledDeltaTime);
  }

  /** PLAY with ONLINE selected opens the lobby; REMATCH online asks the friend. */
  protected StartRun() {
    if (this.State === Phase.Paused && this.mode === Online) { this.UI.Toast("Restart isn't available online: use MENU to leave the table.", 2.5); return; }
    if (this.SelMode === Online && !this.onlineGo) {
      if (this.State === Phase.Over && this.link && this.link.connected) { this.overlay.waitingRematch(); this.link.askRematch(); return; }
      if (this.State === Phase.Over) this.EnterTitle();
      if (!this.lobby.isOpen) {
        this.lobby.createNote = `Your table plays ${MatchNames[Mathf.clamp(this.Data.get("match"), 0, 1)]} (change it on the title screen).`;
        this.lobby.open("menu");
      }
      return;
    }
    this.onlineGo = false;
    super.StartRun();
  }

  private OnTableReady(room: OnlineRoom) {
    this.LeaveTable();
    const link = new OnlineLink<HStart, number, HState>(room);
    this.link = link;
    room.onMessage((d) => this.OnNet(d as { t: string; s?: HState; x?: number; y?: number }));
    const begin = (mt: number) => { this.onlineMatch = mt; this.overlay.hide(); this.Data.set("mode", Online); this.onlineGo = true; this.StartRun(); };
    link.bind({
      onStart: (st) => begin(st.match),
      validMove: () => false,
      onMove: () => {},
      snapshot: () => this.MakeState(),
      onSnapshot: (snap) => {
        if ((this.State === Phase.Playing || this.State === Phase.Paused) && this.mode === Online) { this.OnState(snap); return; }
        if (this.State === Phase.Over || snap.ov) return;
        // joined (again) in the middle of a match: pick it up from the host's state
        begin(snap.mt);
        this.OnState(snap);
      },
      onReaction: (k) => this.overlay.Pop(k, true),
      onFriend: (st) => {
        if (st === "connected") { if (this.overlay.state === "lost") { this.overlay.hide(); this.UI.Toast("Your friend is back!", 2); } }
        else if (st === "lost") { if (this.State !== Phase.Title && !this.ended) this.overlay.lost(30); }
        else this.FriendLeft();
      },
      onRematchReady: () => { if (link.isHost) link.start({ match: this.match }); },
      onFriendRematch: () => { if (this.overlay.state !== "rematch") this.UI.Toast("Your friend wants a rematch! Tap REMATCH.", 3); },
    });
    if (link.isHost) link.start({ match: Mathf.clamp(this.Data.get("match"), 0, 1) });
    else this.UI.Toast("Joined! Waiting for the host to start…", 3);
  }

  private OnlineTick(dt: number) {
    this.overlay.tick();
    this.overlay.showBar(!this.ended);
    const r = this.rink;
    if (this.me === 0) {
      // host: the only simulation; frozen while the friend is away
      this.timer -= dt;
      this.ReadInput(dt);
      if (this.guestTarget) { r.m[1].tx = this.guestTarget.x; r.m[1].ty = this.guestTarget.y; r.m[1].max = 90; }
      if (!this.overlay.busy && !this.ended) { this.playT += dt; this.Sim(dt); }
      this.sendAcc += Time.unscaledDeltaTime;
      if (this.sendAcc >= SendEvery) { this.sendAcc = 0; this.SendState(); }
    } else {
      // guest: my mallet is predicted here from my own input; the puck and the host's mallet come from the host
      this.ReadInput(dt);
      this.inAcc += Time.unscaledDeltaTime;
      if (this.inAcc >= InputEvery && this.link) { this.inAcc = 0; this.link.room.send({ t: "hi", x: r2(r.m[1].tx), y: r2(r.m[1].ty) }); }
      const on = r.puckOn; r.puckOn = false; r.step(dt); r.puckOn = on;
      this.Interpolate();
      if (this.hum) this.hum.volume = Mathf.moveTowards(this.hum.volume, 0.16 + 0.1 * Mathf.clamp01(Math.hypot(r.vx, r.vy) / 30), dt);
    }
    this.UpdateHud();
    this.Present(dt);
  }

  private MakeState(): HState {
    const r = this.rink;
    return {
      k: ++this.netK, st: this.step, tm: r2(this.timer), cd: this.counting ? 1 : 0, cl: r2(this.clock), sc: [...this.score],
      p: [r2(r.px), r2(r.py), r2(r.vx), r2(r.vy)], on: r.puckOn ? 1 : 0, m: [r2(r.m[0].x), r2(r.m[0].y), r2(r.m[1].x), r2(r.m[1].y)],
      g: this.goalId, gg: this.lastGoal, h: this.hitLog.slice(), ov: this.ended ? 1 : 0, mt: this.match, sh: [...this.shots], top: r2(this.topSpeed),
      t: Math.round(performance.now()),
    };
  }

  private SendState() { this.link?.room.send({ t: "hs", s: this.MakeState() }); }

  private OnNet(d: { t: string; s?: HState; x?: number; y?: number }) {
    if (!d || this.mode !== Online || this.State === Phase.Title) return;
    if (d.t === "hi" && this.me === 0 && Number.isFinite(d.x) && Number.isFinite(d.y)) this.guestTarget = new V2(d.x!, d.y!);
    else if (d.t === "hs" && this.me === 1 && d.s) this.OnState(d.s);
  }

  /** Guest: a state from the host (buffered for interpolation; events and score apply at once). */
  private OnState(s: HState) {
    if (this.me !== 1) return;
    const first = !this.latest;
    if (this.latest && s.k <= this.latest.k && s.k > 0 && this.latest.k - s.k < 1000) return;
    const now = performance.now(), ht = s.t ?? now;
    const off = now - ht;
    this.clockOff = first ? off : Math.min(this.clockOff + 0.05, off);
    this.buf.push({ at: ht, s });
    if (this.buf.length > 40) this.buf.shift();
    this.latest = s;
    if (first) { this.seenGoal = s.g; this.seenHit = s.h.length ? s.h[s.h.length - 1][0] : 0; }
    for (const h of s.h) {
      if (h[0] <= this.seenHit) continue;
      this.seenHit = h[0];
      this.OnEvent({ type: h[1], a: h[2], speed: h[3], x: h[4], y: h[5] });
    }
    if (s.g > this.seenGoal) { this.seenGoal = s.g; this.GoalFx(s.gg); }
    this.score = [...s.sc]; this.shots = [...s.sh]; this.topSpeed = s.top; this.clock = s.cl; this.match = s.mt;
    // countdown calls follow the host's timer
    if (s.st === Step.Countdown && s.cd) {
      const n = Math.ceil(s.tm);
      if (n !== this.countShown && n >= 1) { this.countShown = n; this.UI.Announce(String(n), White, 0.7); Sfx.play(Snd.Beep, 0.6); }
    }
    if (this.lastStep === Step.Countdown && s.st === Step.Play && this.counting) { this.UI.Announce("GO!", Gold, 0.6); Sfx.play(Snd.BeepHigh, 0.7); }
    this.counting = s.st === Step.Countdown && s.cd === 1;
    this.lastStep = s.st;
    this.step = s.st === Step.Wait ? Step.Countdown : s.st;
    if (s.ov && !this.ended) this.EndMatch();
  }
  private clockOff = 0;

  private GoalFx(goal: number) {
    const scorer = goal === 0 ? 1 : 0;
    const gp = new V2(0, goal === 0 ? -HL : HL);
    this.goalGlow[goal].color = PlayerCols[scorer].withAlpha(1);
    this.fx.confetti(gp, 50, 7, [PlayerCols[scorer], Color.white, Gold], 0.25);
    this.fx.pop(gp, PlayerCols[scorer], 24, 8, 0.25, 0.6);
    this.Fx.shake(0.55);
    this.Back.Flash(PlayerCols[scorer], 0.5);
    Fx.haptic(true);
    Sfx.playClip(this.goalClip, 0.75);
    this.trailPts = [];
    this.GoalShout(scorer, gp);
  }

  /** Guest: the puck and the host's mallet ~100 ms in the past, interpolated between the two states around it. */
  private Interpolate() {
    const b = this.buf, r = this.rink;
    if (!b.length) return;
    const t = performance.now() - this.clockOff - InterpDelay * 1000;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].at > t) i--;
    const B = b[i], A = i > 0 ? b[i - 1] : B;
    let k = B.at > A.at ? Mathf.clamp01((t - A.at) / (B.at - A.at)) : 1;
    // a reset (goal, faceoff) is a jump, not a slide
    if (Math.hypot(B.s.p[0] - A.s.p[0], B.s.p[1] - A.s.p[1]) > 4 || A.s.on !== B.s.on) k = 1;
    const lp = (a: number, c: number) => a + (c - a) * k;
    r.px = lp(A.s.p[0], B.s.p[0]); r.py = lp(A.s.p[1], B.s.p[1]); r.vx = B.s.p[2]; r.vy = B.s.p[3];
    r.puckOn = B.s.on === 1;
    r.m[0].x = lp(A.s.m[0], B.s.m[0]); r.m[0].y = lp(A.s.m[1], B.s.m[1]);
  }

  /** The friend left on purpose or never came back. */
  private FriendLeft() {
    const link = this.link;
    this.link = null;
    if (link && link.room.status !== "closed") link.room.close();
    if ((this.State === Phase.Playing || this.State === Phase.Paused) && this.mode === Online && !this.ended) {
      if (this.score[0] + this.score[1] >= 2 || this.playT > 40 || this.clock < MatchTime - 40) {
        // the match was well underway: the player who stayed takes the win
        this.forfeit = true;
        this.overlay.hide();
        if (this.State === Phase.Paused) this.Resume();
        this.EndMatch();
        return;
      }
      this.ended = true;
      this.step = Step.Wait;
      this.rink.puckOn = false;
      this.overlay.left("Your friend left", "Not enough of the match was played for a result.");
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
    const me = this.me, fr = 1 - me, a = this.score[me], b = this.score[fr];
    const won = this.forfeit || a > b, draw = !this.forfeit && a === b;
    const prize = won ? OnlinePrize : draw ? 20 : 5;
    this.Coins = this.Coins + prize;
    if (won) this.Data.add("onlineWins", 1);
    this.Data.add("onlineGames", 1);
    this.overlay.showBar(false);
    this.Finish(new Result({
      Headline: this.forfeit ? "FRIEND LEFT · YOU WIN!" : won ? "YOU WIN!" : draw ? "IT'S A DRAW" : "FRIEND WINS",
      HeadlineColor: won ? Gold : PlayerCols[fr], Victory: won,
      Value: `${a} – ${b}`,
      BestLine: `YOU ${a} · FRIEND ${b}   ·   +${prize} COINS`,
      Stats: [["YOUR SHOTS", String(this.shots[me])], ["FRIEND'S SHOTS", String(this.shots[fr])], ["MATCH", String(this.link?.match ?? 1)], ["ONLINE WINS", String(this.Data.get("onlineWins"))]],
      Primary: this.link ? "REMATCH" : "NEW TABLE",
      Reward: won ? () => { this.Coins = this.Coins + prize; this.UI.Toast(`+${prize} COINS: DOUBLED!`, 2.5); Sfx.play(Snd.Coin, 0.8); } : null,
      RewardLabel: `DOUBLE COINS: +${prize} (AD)`,
    }));
  }

  // ------------------------------------------------------------------ results

  private EndMatch() {
    if (this.ended) return;
    this.ended = true;
    if (this.mode === Online && this.me === 0) { this.SendState(); this.link?.pushState(); }
    this.step = Step.Wait;
    this.rink.puckOn = false;
    this.trailPts = [];
    this.startCoroutine(this.ResultLater());
  }

  private *ResultLater(): Generator<{ seconds: number; realtime: boolean } | undefined, void, unknown> {
    const won = this.mode === Online ? this.forfeit || this.score[this.me] > this.score[1 - this.me] : this.mode === 0 ? this.score[0] > 0 : this.score[0] > this.score[1];
    const head = this.mode === Online ? (this.forfeit ? "YOUR FRIEND LEFT" : won ? "YOU WIN!" : this.score[0] === this.score[1] ? "DRAW!" : "FRIEND WINS") : this.mode === 0 ? "TIME UP!" : this.mode === 1 ? (won ? "YOU WIN!" : this.score[0] === this.score[1] ? "DRAW!" : `${CpuNames[this.diff]} WINS`)
      : this.score[0] === this.score[1] ? "DRAW!" : `${this.Names()[won ? 0 : 1]} WINS!`;
    this.UI.Announce(head, this.mode === 1 && !won ? Red : Gold, 1.5);
    if (this.mode === 2 || won) { Sfx.play(Snd.Win, 0.8); this.fxWorld.confetti(this.TableToWorld(V2.zero), 90, 9, [P1Col, P2Col, Gold, Color.white]); }
    else Sfx.play(Snd.Lose, 0.7);
    yield { seconds: 1.6, realtime: false };
    if (this.State !== Phase.Playing) return;
    this.Data.add("goals", this.score[this.me]);
    if (this.mode === Online) this.OnlineResult();
    else if (this.mode === 0) this.SoloResult();
    else if (this.mode === 1) this.CpuResult(won);
    else this.DuelResult();
  }

  private SoloResult() {
    const g = this.score[0];
    const best = this.Data.max("bestSolo", g);
    const earned = g * 5;
    this.Coins = this.Coins + earned;
    const stars = g >= 12 ? 3 : g >= 7 ? 2 : g >= 3 ? 1 : 0;
    this.Finish(new Result({
      Headline: "TIME UP!", HeadlineColor: Gold, Value: String(g), CountTo: g, NewBest: best && g > 0, Victory: stars > 0,
      BestLine: `GOALS   ·   BEST ${this.Data.get("bestSolo")}   ·   +${earned} COINS`,
      Stats: [["GOALS", String(g)], ["BEST STREAK", String(this.bestStreakRun)], ["OWN GOALS", String(this.conceded)], ["TOP SPEED", `${Math.round(this.topSpeed * 0.4)} KM/H`]],
      Primary: "PLAY AGAIN",
      Reward: this.revived ? null : () => { this.revived = true; this.clock = 20; this.Revive(); this.StartFaceoff(0); this.UI.Announce("+20 SECONDS", Gold, 1.2); },
      RewardLabel: "+20 SECONDS & CONTINUE (AD)",
    }));
  }

  private CpuResult(won: boolean) {
    const d = this.diff;
    const stats: [string, string][] = [["LEVEL", DiffNames[d]], ["SCORE", `${this.score[0]} – ${this.score[1]}`], ["SHOTS", String(this.shots[0])], ["TOP SPEED", `${Math.round(this.topSpeed * 0.4)} KM/H`]];
    if (won) {
      const streak = this.Data.get("streak") + 1;
      this.Data.set("streak", streak);
      const bestStreak = this.Data.max("bestStreak", streak);
      const prize = Math.round(Prizes[d] * (1 + Math.min(5, streak - 1) * 0.1));
      this.Coins = this.Coins + prize;
      this.Data.add("wins", 1);
      this.Finish(new Result({
        Headline: `YOU BEAT ${CpuNames[d]}!`, HeadlineColor: Gold, Value: `+${prize}`, CountTo: prize, Victory: true, NewBest: bestStreak && streak >= 2,
        BestLine: `${this.score[0]} – ${this.score[1]}   ·   WIN STREAK ${streak}`, Stats: stats, Primary: "PLAY AGAIN",
        Reward: () => { this.Coins = this.Coins + prize; this.UI.Toast(`+${prize} COINS: DOUBLED!`, 2.5); Sfx.play(Snd.Coin, 0.8); },
        RewardLabel: `DOUBLE COINS: +${prize} (AD)`,
      }));
    } else {
      const streak = this.Data.get("streak");
      this.Data.set("streak", 0);
      this.Data.add("losses", 1);
      this.Finish(new Result({
        Headline: this.score[0] === this.score[1] ? "IT'S A DRAW" : `${CpuNames[d]} WINS`, HeadlineColor: Pal.hex(0xffb0c0),
        Value: `${this.score[0]} – ${this.score[1]}`, BestLine: streak > 1 ? `WIN STREAK OF ${streak} ENDED` : "SO CLOSE. GO AGAIN?", Stats: stats,
        Primary: "TRY AGAIN",
        Reward: () => { this.headStart = true; this.StartRun(); },
        RewardLabel: "REMATCH WITH A +1 GOAL HEAD START (AD)",
      }));
    }
  }

  private DuelResult() {
    const names = this.Names(), w = this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
    this.Data.add("duels", 1);
    this.Finish(new Result({
      Headline: w < 0 ? "IT'S A DRAW!" : `${names[w]} WINS!`, HeadlineColor: w < 0 ? Gold : PlayerCols[w], Victory: true,
      Value: `${this.score[0]} – ${this.score[1]}`, BestLine: MatchNames[this.match],
      Stats: [[`${names[0]} SHOTS`, String(this.shots[0])], [`${names[1]} SHOTS`, String(this.shots[1])], ["TOP SPEED", `${Math.round(this.topSpeed * 0.4)} KM/H`], ["TOTAL GOALS", String(this.score[0] + this.score[1])]],
      Primary: "REMATCH",
    }));
  }
}
