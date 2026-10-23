import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Fmt, GameInfo, GameObject, howTo,
  Image, Keyboard, LineRenderer, LoopSource, Mathf, Mouse, overUI, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom,
  Text, TextAnchor, Time, Touchscreen, TouchScheme, UIKit, UINode, V2, V3, Camera,
  OnlineLink, OnlineRoom, tableCodeFromUrl, TableLobby, TableOverlay,
} from "../../kit";
import { applySnap, Canon, CanonAnchor, CanonLaunch, InputHz, InputMsg, KSnap, lerpSnap, NetEvent, PauseMsg, snapKite, StateHz, StateMsg, unflat, ViewMap } from "./KiteNet";
import { Confetti, Designs, KiteArt, Strings } from "./KiteArt";
import { BotLevel, BotLevels, KiteBot } from "./KiteBot";
import { Clash, Kite, KState, PickKind, Rope, Sky, SkyEvent } from "./KitePhysics";

/**
 * KITE CLASH: the rooftop kite-fighting festival as a fast arcade duel. A fighter kite spins while its string is
 * slack; HOLD to pull and it darts the way its nose points. Cross a rival's string and pull AWAY from the crossing to
 * saw through it. Modes: SOLO SKY FESTIVAL (2 minutes, rivals rise in waves, 3 strings), DAILY (date-seeded wind and
 * rivals), VS CPU (best of 3 cuts, easy / medium / hard) and 2 PLAYERS on one device (each player holds their half).
 * Coins from cuts and wins buy kite designs and string colours in the KITE SHOP.
 */

enum Mode { Solo, Daily, Vs, TwoP, Online }
enum Step { Intro, Play, Cut, Over }

const SoloTime = 120, RoundTime = 60, HeatAt = 38, WinCuts = 2;
const ModeNames = ["SOLO", "DAILY", "VS CPU", "2 PLAYERS", "ONLINE"];
const OnlinePrize = 60;
/** Online match payloads (OnlineLink): the host's kite and string; a snapshot carries the match score. */
interface OStart { d: number; s: number; seed: number }
interface OSnap { w: number[]; r: number; d: number[] }
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const WinCoins = [30, 50, 80];
const SoloStars = [1000, 2500, 4200];
const KiteSize = 1.65;
const Gold = Pal.hex(0xffc93c), Coral = Pal.hex(0xff5a5f), Ink = Pal.hex(0x1d1030), Sky1 = Pal.hex(0x3d8bff), Good = Pal.hex(0x4ee08a), Bad = Pal.hex(0xff4a5a);
const P1Col = Pal.hex(0x3d8bff), P2Col = Pal.hex(0xff5a5f);
const Cheers = ["CUT!", "WHAT A CUT!", "SNAPPED!", "KAI PO CHE!", "SLICED!"];

interface RivalType { name: string; strength: number; speed: number; level: number; points: number; color: Color }
const Rivals: RivalType[] = [
  { name: "PAPER", strength: 0.5, speed: 0.95, level: 0, points: 100, color: Pal.hex(0xfff2d8) },
  { name: "SWIFT", strength: 0.8, speed: 1.1, level: 1, points: 150, color: Pal.hex(0x8fe0ff) },
  { name: "CHAMPION", strength: 1.1, speed: 1.05, level: 2, points: 300, color: Gold },
];

class KiteView {
  body!: SpriteRenderer; halo!: SpriteRenderer; arrow!: SpriteRenderer; mark!: SpriteRenderer;
  rope!: LineRenderer; glass!: LineRenderer; tail!: LineRenderer; loose!: LineRenderer; cutTail!: LineRenderer;
  tailPts: V2[] = [];
}
class House { x0 = 0; x1 = 0; top = 0; sr!: SpriteRenderer; }
class Person { sr!: SpriteRenderer; feet = V2.zero; pose = 1; col = 0; cheer = 0; seed = 0; flip = false; }
class Bunting { line!: LineRenderer; flags: SpriteRenderer[] = []; a = V2.zero; b = V2.zero; }
class Streamer { pole!: SpriteRenderer; ribbon!: LineRenderer; base = V2.zero; seed = 0; }
class CloudV { sr!: SpriteRenderer; x = 0; y = 0; speed = 0; w = 0; }
class MeterV { node!: UINode; fill!: Image; spark!: Image; }
class SidePanel { node!: UINode; name!: Text; pips: Image[] = []; timer!: Text; }

function set(t: Text | null | undefined, s: string) { if (t && t.text !== s) t.text = s; }
function noise(seed: number) { const r = new SysRandom(seed); return () => r.nextDouble() * 2 - 1; }
function todaySeed() { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

export class KiteClashGame extends ArcadeGame {
  /** Test hook: scales simulated time (the headless test machine runs at a low frame rate). */
  static TestTimeScale = 1;
  /** Test hook: artificial latency + jitter (ms) on everything this device sends at an online table. */
  static NetLag = { ms: 0, jitter: 0 };

  // online
  private lobby!: TableLobby; private overlay!: TableOverlay;
  private link: OnlineLink<OStart, number, OSnap> | null = null;
  private onlineGo = false; private autoJoined = false; private onlineStart: OStart = { d: 0, s: 0, seed: 1 };
  private seat = 0; private view = new ViewMap();
  private netSim: Sky | null = null; private local: Kite | null = null;
  private netWins = [0, 0]; private netDesigns: number[] = [0, 0, 2, 1]; private resumeWins: number[] | null = null;
  private states: StateMsg[] = []; private offsetEst = -1e9; private evLog: NetEvent[] = []; private evId = 0; private lastEv = 0;
  private inSeq = 0; private lastIn = 0; private sendT = 0; private mePaused = false; private friendPaused = false;
  private forfeit = false; private netEnded = false; private lastStateBytes = 0; private barOn = false; private designT = 0;

  private world!: GameObject;
  private skyBg!: SpriteRenderer; private sun!: SpriteRenderer; private sunGlow!: SpriteRenderer;
  private clouds: CloudV[] = [];
  private skylines: SpriteRenderer[] = [];
  private houses: House[] = [];
  private spectators: Person[] = [];
  private flyers: Person[] = [];
  private buntings: Bunting[] = [];
  private streamers: Streamer[] = [];
  private views: KiteView[] = [];
  private birdViews: SpriteRenderer[] = [];
  private pickViews: { sr: SpriteRenderer; glow: SpriteRenderer }[] = [];
  private fx!: CasualFx;
  private goalRing!: SpriteRenderer; private guide!: SpriteRenderer;
  private roofBase = -6;
  private portrait = true;

  // simulation
  private sky = new Sky(1);
  private bots = new Map<Kite, KiteBot>();
  private rivalType = new Map<Kite, RivalType>();
  private humans: Kite[] = [];
  private mode = Mode.Solo;
  private diff = 1;
  private step = Step.Intro;
  private stepT = 0;
  private roundT = 0;
  private rng = new SysRandom(1);
  private attract = false;

  // run state
  private score = 0; private lives = 3; private timeLeft = SoloTime; private cuts = 0; private combo = 0; private comboT = 0; private bestCombo = 0;
  private coinsRun = 0; private starBonus = 0; private revived = false; private doubled = false; private glassStart = false; private pendingGlass = false;
  private roundWins = [0, 0]; private round = 0;
  private spawnT = 0; private champT = 40; private relaunchT = 0; private endT = 0; private endReason = "";
  private tutStep = -1; private tutT = 0; private tutGoal = V2.zero;
  private lastResult: Result | null = null; private countStep = -1; private heatWarned = false;
  private touchOwner = new Map<number, number>(); private mouseOwner = -1; private usingTouch = false;
  private cheerT = 0;
  private zoneT = 0;

  // HUD
  private scoreText!: Text; private comboText!: Text; private timerText!: Text; private scoreNode!: UINode;
  private lifeIcons: Image[] = []; private lifeNode!: UINode;
  private windNode!: UINode; private windArrow!: Image; private windLabel!: Text;
  private panels: SidePanel[] = []; private centerTimer!: Text;
  private meters: MeterV[] = [];
  private zoneHint: Text[] = [];
  private glassBadge!: Text;

  // title
  private modeButtons: ArcadeButton[] = [];
  private optButton!: ArcadeButton; private shopButton!: ArcadeButton;
  private shop!: UINode; private shopCoins!: Text;
  private kiteImg!: Image; private kiteName!: Text; private kiteAction!: ArcadeButton;
  private strImg!: Image; private strName!: Text; private strAction!: ArcadeButton;
  private browseKite = 0; private browseStr = 0;

  // sound
  private snapClip!: AudioClip; private cheerClip!: AudioClip; private launchClip!: AudioClip; private chirpClip!: AudioClip;
  private chimeClip!: AudioClip; private gustClip!: AudioClip; private lostClip!: AudioClip;
  private windLoop: LoopSource | null = null; private zipLoop: LoopSource | null = null; private sawLoop: LoopSource | null = null;
  private windClip!: AudioClip; private zipClip!: AudioClip; private sawClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "kiteclash",
      Title: "KITE CLASH",
      Tagline: "HOLD TO PULL. CROSS STRINGS. CUT THEM DOWN!",
      PlayLabel: "PLAY",
      Accent: Coral,
      Accent2: Gold,
      BgTop: Pal.hex(0x3a68d2),
      BgBottom: Pal.hex(0xffc77a),
      ShortSide: 14,
      Touch: TouchScheme.None,
      HomeBesidePause: true,
      Music: { bpm: 116, rootHz: 146.8, degrees: [0, 5, 3, 4], seed: 23, energy: 0.85, major: true },
      Reminders: [
        "The festival sky is open|Cut a rival kite before sunset.",
        "Today's DAILY wind is up|Same rivals for everyone, beat your best.",
        "Grab a friend|Two kites, one phone: hold your half of the screen.",
      ],
      HowTo: [
        howTo(KiteArt.Kite(0), Color.white, "Your kite SPINS while the string is slack. HOLD (finger, mouse or SPACE) to pull: it darts where its nose points."),
        howTo(Art.Chevron, Color.white, "Steer by timing: release to let it turn, hold when the nose points where you want to go. A long release makes it sink."),
        howTo(KiteArt.Swatch(), Gold, "Cross a rival's STRING, then pull AWAY from the crossing. Pulling harder saws their string until it SNAPS."),
        howTo(KiteArt.Glass(), Color.white, "Keep pulling while crossed: a slack string only gives way a little and can't saw. GLASS charm = sharper string for 10 s."),
        howTo(KiteArt.Bird(0), Color.white, "Birds make your kite wobble. Wind gusts change direction: watch the streamers and the wind arrow."),
        howTo(Art.Star, Gold, "SOLO: cut as many rivals as you can in 2 minutes (3 strings). VS CPU and 2 PLAYERS: best of 3 cuts."),
        howTo(KiteArt.Coin(), Color.white, "Earn coins from cuts and wins and spend them in the KITE SHOP on kites and string colours."),
      ],
      Tips: [
        "Cut near your own kite: the string moves fastest there.",
        "Don't pull towards the crossing: that feeds your string to them.",
        "If the meter turns red, turn your nose away from the crossing and pull hard.",
        "Short taps make small hops, long holds make long dashes.",
        "Grab the GLASS charm before you attack a CHAMPION kite.",
      ],
    });
  }

  protected get ShortSide() { return Screen.width < Screen.height ? 14 : 18; }

  // ------------------------------------------------------------------ save data
  private get Coins() { return this.Data.get("coins"); }
  private get KiteSel() { return Mathf.clamp(this.Data.get("kite"), 0, Designs.length - 1); }
  private get StrSel() { return Mathf.clamp(this.Data.get("str"), 0, Strings.length - 1); }
  private HasKite(i: number) { return i === 0 || this.Data.get("uk" + i) === 1; }
  private HasStr(i: number) { return i === 0 || this.Data.get("us" + i) === 1; }
  private get SelMode(): Mode { return Mathf.clamp(this.Data.get("mode"), 0, 4) as Mode; }
  private get SelDiff() { return Mathf.clamp(this.Data.get("diff", 1), 0, 2); }

  protected BestLine() {
    switch (this.SelMode) {
      case Mode.Solo: return `SKY FESTIVAL BEST ${Fmt.n(this.Data.get("best"))}`;
      case Mode.Daily: return `DAILY ${this.DailyLabel()}  ·  TODAY'S BEST ${Fmt.n(this.Data.get("dDate") === todaySeed() ? this.Data.get("dBest") : 0)}`;
      case Mode.Vs: { const d = this.SelDiff; return `VS CPU ${DiffNames[d]}:  ${this.Data.get("w" + d)} WON · ${this.Data.get("l" + d)} LOST`; }
      case Mode.Online: return `ONLINE: ${this.Data.get("onlineWins")} WINS IN ${this.Data.get("onlineGames")} MATCHES`;
      default: return `PLAYER 1  ${this.Data.get("p0")} – ${this.Data.get("p1")}  PLAYER 2`;
    }
  }
  protected StatsLine() { return ""; }
  private DailyLabel() { const d = new Date(); return `${d.getDate()} ${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getMonth()]}`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Data.set("coins", 40); this.Data.set("diff", 1); }
    CasualLook.calm(this, 1.35, 0.12);
    this.world = new GameObject("Festival", this.gameObject);
    const w = this.world;
    this.skyBg = CasualLook.cover(w, KiteArt.Sky(), -900);
    this.sunGlow = Art.spr(w, "SunGlow", Art.Glow, Pal.hex(0xffd27a).withAlpha(0.75), 14, -890, Art.Flat);
    this.sun = Art.spr(w, "Sun", KiteArt.SunDisc(), Color.white, 2.6, -889, Art.Flat);
    for (let i = 0; i < 7; i++) {
      const c = new CloudV();
      c.sr = Art.spr(w, "Cloud", KiteArt.Cloud(i % 3), Color.white.withAlpha(i < 3 ? 0.55 : 0.85), 1, i < 3 ? -870 : -835, Art.Flat);
      this.clouds.push(c);
    }
    for (let i = 0; i < 8; i++) { const s = Art.spr(w, "Skyline", KiteArt.Skyline(i % 2), Color.white, 1, -850, Art.Flat); s.gameObject.setActive(false); this.skylines.push(s); }
    for (let i = 0; i < 18; i++) {
      const h = new House();
      h.sr = Art.spr(w, "House", KiteArt.House(i % 8, i % 3), Color.white, 1, -10 + (i % 2), Art.Flat);
      h.sr.gameObject.setActive(false);
      this.houses.push(h);
    }
    for (let i = 0; i < 9; i++) {
      const b = new Bunting();
      b.line = Art.line(w, "Bunting", Pal.hex(0x4a2a3a).withAlpha(0.8), 0.035, 2, false, true, Art.Flat);
      for (let k = 0; k < 7; k++) b.flags.push(Art.spr(w, "Flag", KiteArt.Flag(), Confetti[(i + k) % Confetti.length], 0.32, 3, Art.Flat));
      this.buntings.push(b);
    }
    for (let i = 0; i < 4; i++) {
      const s = new Streamer();
      s.pole = Art.spr(w, "Pole", Art.Square, Pal.hex(0x5a3a2a), 1, 4, Art.Flat);
      s.ribbon = Art.line(w, "Ribbon", Confetti[(i * 2) % Confetti.length], 0.16, 5, false, true, Art.Flat);
      s.ribbon.endWidth = 0.35;
      s.seed = i * 1.7;
      this.streamers.push(s);
    }
    for (let i = 0; i < 16; i++) {
      const p = new Person();
      p.col = (i * 3) % 7; p.pose = i % 3 === 0 ? 2 : 1; p.seed = i * 0.77;
      p.sr = Art.spr(w, "Spectator", KiteArt.Person(p.pose, p.col), Color.white, 0.75, 6, Art.Flat);
      this.spectators.push(p);
    }
    for (let i = 0; i < 6; i++) {
      const p = new Person();
      p.col = [1, 0, 3, 5, 4, 6][i]; p.pose = 0;
      p.sr = Art.spr(w, "Flyer", KiteArt.Person(0, p.col), Color.white, 0.9, 7, Art.Flat);
      p.sr.gameObject.setActive(false);
      this.flyers.push(p);
    }
    for (let i = 0; i < 6; i++) this.views.push(this.MakeView(i));
    for (let i = 0; i < 8; i++) { const b = Art.spr(w, "Bird", KiteArt.Bird(0), Color.white, 0.7, 15, Art.Flat); b.gameObject.setActive(false); this.birdViews.push(b); }
    for (let i = 0; i < 3; i++) {
      const glow = Art.spr(w, "PickGlow", Art.Glow, Color.white, 2.2, 23, Art.Additive);
      const sr = Art.spr(w, "Pick", KiteArt.Glass(), Color.white, 1.0, 24, Art.Flat);
      glow.gameObject.setActive(false); sr.gameObject.setActive(false);
      this.pickViews.push({ sr, glow });
    }
    this.goalRing = Art.spr(w, "Goal", Art.Ring, Gold, 2.6, 22, Art.Flat);
    this.goalRing.gameObject.setActive(false);
    this.guide = Art.spr(w, "Guide", Art.Chevron, Color.white, 1.1, 46, Art.Flat);
    this.guide.gameObject.setActive(false);
    this.fx = CasualFx.create(w, 50, 320);
    this.BuildSounds();
    this.BuildHud();
    this.BuildTitle();
    this.BuildOnline();
    this.Layout();
  }

  private MakeView(i: number) {
    const v = new KiteView(), w = this.world, o = 30 + i * 3;
    v.rope = Art.line(w, "String", Color.white, 0.06, 20 + i, false, true, Art.Flat);
    v.glass = Art.line(w, "Glass", Pal.hex(0x9ff6ff), 0.22, 21 + i, false, true, Art.LineMat);
    v.loose = Art.line(w, "Loose", Color.white, 0.05, 19, false, true, Art.Flat);
    v.cutTail = Art.line(w, "CutTail", Color.white, 0.05, 19, false, true, Art.Flat);
    v.tail = Art.line(w, "Tail", Color.white, 0.12, o, false, true, Art.Flat);
    v.tail.endWidth = 0.3;
    v.halo = Art.spr(w, "Halo", Art.Glow, Color.white, KiteSize * 2.2, o, Art.Additive);
    v.body = Art.spr(w, "Kite", KiteArt.Kite(0), Color.white, KiteSize, o + 1, Art.Flat);
    v.arrow = Art.spr(w, "Nose", Art.Chevron, Color.white, 0.55, o + 2, Art.Flat);
    v.mark = Art.spr(w, "Mark", Art.Star, Gold, 0.6, o + 2, Art.Flat);
    for (let k = 0; k < 7; k++) v.tailPts.push(V2.zero);
    this.HideView(v);
    return v;
  }

  private HideView(v: KiteView) {
    for (const g of [v.body, v.halo, v.arrow, v.mark]) g.gameObject.setActive(false);
    for (const l of [v.rope, v.glass, v.tail, v.loose, v.cutTail]) l.positionCount = 0;
  }

  private BuildSounds() {
    const n1 = noise(3);
    this.snapClip = Sfx.make("kc-snap", 0.55, (t) => {
      const crack = n1() * Sfx.env(t, 0.0005, 0.03) * 0.9;
      const twang = Sfx.sinP(Sfx.glide(t, 1400, 320, 0.25)) * Sfx.env(t, 0.002, 0.45) * 0.35 + Sfx.triP(Sfx.glide(t, 700, 160, 0.3)) * Sfx.env(t, 0.002, 0.3) * 0.2;
      return crack + twang;
    });
    const n2 = noise(7);
    let lp = 0, bp = 0;
    const voices = [310, 362, 415, 455, 520, 280, 390];
    this.cheerClip = Sfx.make("kc-cheer", 2.2, (t) => {
      const raw = n2();
      lp += (raw - lp) * 0.32; bp += (lp - bp) * 0.06;
      const crowd = (lp - bp) * 1.4;
      let v = 0;
      for (let i = 0; i < voices.length; i++) {
        const st = i * 0.07, tt = t - st;
        if (tt <= 0) continue;
        const f = voices[i] * (1 + 0.25 * Math.min(1, tt * 2.5)) * (1 + 0.02 * Math.sin(tt * 30 + i));
        v += (Sfx.sawP(f * tt) * 0.5 + Sfx.sinP(f * 2 * tt) * 0.3) * Sfx.env(tt, 0.08, 1.4) * 0.05;
      }
      const clap = (Math.sin(t * 47) > 0.96 || Math.sin(t * 61 + 1) > 0.97) ? n2() * 0.25 : 0;
      const swell = Math.min(1, t * 3) * Math.max(0, 1 - (t - 0.8) / 1.4);
      return (crowd * 0.5 + v + clap) * swell;
    });
    const n3 = noise(11);
    let lp3 = 0;
    this.launchClip = Sfx.make("kc-launch", 0.7, (t) => { lp3 += (n3() - lp3) * (0.05 + t * 0.4); return lp3 * Sfx.env(t, 0.15, 0.5) * 0.9; });
    this.chirpClip = Sfx.make("kc-chirp", 0.42, (t) => {
      let v = 0;
      for (const [s, f0, f1] of [[0, 3200, 4200], [0.12, 3600, 2800], [0.24, 3000, 4400]]) { const tt = t - s; if (tt > 0) v += Sfx.sinP(Sfx.glide(tt, f0, f1, 0.08)) * Sfx.env(tt, 0.004, 0.08) * 0.25; }
      return v;
    });
    this.chimeClip = Sfx.make("kc-chime", 0.8, (t) => {
      let v = 0;
      [1047, 1319, 1568, 2093].forEach((f, i) => { const tt = t - i * 0.06; if (tt > 0) v += (Sfx.sinP(f * tt) + 0.3 * Sfx.sinP(f * 2.76 * tt)) * Sfx.env(tt, 0.003, 0.5) * 0.15; });
      return v;
    });
    const n4 = noise(19);
    let lp4 = 0;
    this.gustClip = Sfx.make("kc-gust", 1.4, (t) => { lp4 += (n4() - lp4) * (0.03 + 0.05 * Math.sin(t * 2.2) ** 2); return lp4 * Sfx.env(t, 0.5, 0.8) * 1.6; });
    this.lostClip = Sfx.make("kc-lost", 0.9, (t) => (Sfx.triP(Sfx.glide(t, 520, 140, 0.8)) * 0.4 + Sfx.sinP(Sfx.glide(t, 260, 70, 0.8)) * 0.3) * Sfx.env(t, 0.01, 0.8));
    // loops
    const n5 = noise(23);
    let a = 0, b = 0;
    this.windClip = Sfx.make("kc-wind", 3, (t) => { a += (n5() - a) * 0.02; b += (a - b) * 0.5; return (a * 1.8 + (a - b) * 0.5) * (0.75 + 0.25 * Math.sin(t * Math.PI * 2 / 3)); }, false);
    const n6 = noise(29);
    let z = 0;
    this.zipClip = Sfx.make("kc-zip", 1, (t) => { const r = n6(); z += (r - z) * 0.6; return ((r - z) * 0.5 + Sfx.sawP(880 * t) * 0.06 + Sfx.sinP(1760 * t) * 0.05) * (0.8 + 0.2 * Sfx.sinP(24 * t)); }, false);
    const n7 = noise(31);
    this.sawClip = Sfx.make("kc-saw", 1, (t) => (Sfx.sqrP(150 * t) * 0.12 + n7() * 0.35) * (0.55 + 0.45 * Sfx.sinP(28 * t)), false);
    this.windLoop = Sfx.createLoop(this.windClip);
    this.zipLoop = Sfx.createLoop(this.zipClip);
    this.sawLoop = Sfx.createLoop(this.sawClip);
  }

  // ------------------------------------------------------------------ HUD

  private BuildHud() {
    const hud = this.UI.Hud;
    // solo score
    this.scoreNode = UIKit.node("Score", hud).place(new V2(0, 1), new V2(190, -80), new V2(330, 120));
    UIKit.img(this.scoreNode, "Bg", Art.UiRound, Ink.withAlpha(0.55)).rectTransform.stretch();
    UIKit.at(UIKit.label(this.scoreNode, "SCORE", 24, Gold), UIKit.Center, new V2(0, 34), new V2(300, 30));
    this.scoreText = UIKit.at(UIKit.label(this.scoreNode, "0", 60, Color.white), UIKit.Center, new V2(0, -12), new V2(320, 70));
    UIKit.glow(this.scoreText, Ink, 3);
    this.comboText = UIKit.at(UIKit.label(hud, "", 40, Gold, TextAnchor.MiddleLeft), new V2(0, 1), new V2(240, -170), new V2(400, 50));
    UIKit.glow(this.comboText, Ink, 3);
    this.timerText = UIKit.at(UIKit.label(hud, "2:00", 64, Color.white), new V2(0.5, 1), new V2(0, -70), new V2(300, 80));
    UIKit.glow(this.timerText, Ink, 4);
    this.lifeNode = UIKit.node("Lives", hud).place(new V2(0.5, 1), new V2(0, -140), new V2(240, 60));
    for (let i = 0; i < 3; i++) {
      const im = UIKit.img(this.lifeNode, "Life", KiteArt.Kite(0), Color.white);
      im.rectTransform.place(UIKit.Center, new V2((i - 1) * 64, 0), new V2(44, 55));
      this.lifeIcons.push(im);
    }
    this.glassBadge = UIKit.at(UIKit.label(hud, "", 34, Pal.hex(0x9ff6ff)), new V2(0.5, 1), new V2(0, -200), new V2(500, 44));
    UIKit.glow(this.glassBadge, Ink, 3);
    // wind
    this.windNode = UIKit.node("Wind", hud).place(new V2(0, 1), new V2(110, -205), new V2(150, 76));
    UIKit.img(this.windNode, "Bg", Art.UiRound, Ink.withAlpha(0.45)).rectTransform.stretch();
    this.windArrow = UIKit.img(this.windNode, "Arrow", Art.Chevron, Color.white);
    this.windArrow.rectTransform.place(UIKit.Center, new V2(-42, 0), new V2(42, 42));
    this.windLabel = UIKit.at(UIKit.label(this.windNode, "WIND", 22, Color.white), UIKit.Center, new V2(30, 0), new V2(90, 30));
    // duel panels
    for (let i = 0; i < 2; i++) {
      const p = new SidePanel();
      p.node = UIKit.node("Side" + i, hud);
      UIKit.img(p.node, "Bg", Art.UiRound, Ink.withAlpha(0.55)).rectTransform.stretch();
      p.name = UIKit.at(UIKit.label(p.node, "", 28, Color.white), UIKit.Center, new V2(0, 22), new V2(300, 36));
      for (let k = 0; k < WinCuts; k++) {
        const im = UIKit.img(p.node, "Pip", KiteArt.Kite(0), Color.white);
        im.rectTransform.place(UIKit.Center, new V2((k - 0.5) * 56, -22), new V2(38, 48));
        p.pips.push(im);
      }
      p.timer = UIKit.at(UIKit.label(p.node, "", 30, Color.white), UIKit.Center, new V2(110, -22), new V2(100, 40));
      this.panels.push(p);
    }
    this.centerTimer = UIKit.at(UIKit.label(hud, "", 52, Color.white), new V2(0.5, 1), new V2(0, -80), new V2(200, 70));
    UIKit.glow(this.centerTimer, Ink, 4);
    for (let i = 0; i < 4; i++) {
      const m = new MeterV();
      m.node = UIKit.node("Saw", hud);
      UIKit.img(m.node, "Bg", Art.UiRound, Ink.withAlpha(0.7)).rectTransform.stretch();
      m.fill = UIKit.img(m.node, "Fill", Art.UiRound, Good);
      const f = m.fill.rectTransform;
      f.anchorMin = new V2(0, 0); f.anchorMax = new V2(0.5, 1); f.offsetMin = new V2(4, 4); f.offsetMax = new V2(-4, -4);
      m.spark = UIKit.img(m.node, "Spark", Art.Star, Color.white);
      m.spark.rectTransform.place(UIKit.Center, V2.zero, new V2(40, 40));
      m.node.setActive(false);
      this.meters.push(m);
    }
    for (let i = 0; i < 2; i++) {
      const t = UIKit.label(hud, i === 0 ? "P1: HOLD HERE" : "P2: HOLD HERE", 54, Color.white);
      UIKit.glow(t, i === 0 ? P1Col : P2Col, 4);
      t.gameObject.setActive(false);
      this.zoneHint.push(t);
    }
    this.LayoutHud();
  }

  private LayoutHud() {
    const two = this.mode === Mode.TwoP && this.portrait && this.State !== Phase.Title;
    const duel = this.mode === Mode.Vs || this.mode === Mode.TwoP || this.mode === Mode.Online;
    for (let i = 0; i < 2; i++) {
      const p = this.panels[i];
      if (two) {
        p.node.place(new V2(0.5, i === 0 ? 0 : 1), new V2(0, i === 0 ? 70 : -70), new V2(300, 100));
        p.node.localEulerAngles = new V3(0, 0, i === 0 ? 0 : 180);
        p.timer.gameObject.setActive(true);
        p.name.rectTransform.place(UIKit.Center, new V2(-40, 22), new V2(220, 36));
        p.pips.forEach((im, k) => im.rectTransform.place(UIKit.Center, new V2(-70 + k * 56, -22), new V2(38, 48)));
      } else {
        p.node.place(new V2(0.5, 1), new V2((i === 0 ? -1 : 1) * 240, -80), new V2(300, 110));
        p.node.localEulerAngles = new V3(0, 0, 0);
        p.timer.gameObject.setActive(false);
        p.name.rectTransform.place(UIKit.Center, new V2(0, 24), new V2(280, 36));
        p.pips.forEach((im, k) => im.rectTransform.place(UIKit.Center, new V2((k - 0.5) * 60, -22), new V2(38, 48)));
      }
      p.node.setActive(duel);
    }
    this.centerTimer.gameObject.setActive(duel && !two);
    const solo = !duel;
    this.scoreNode.setActive(solo);
    this.timerText.gameObject.setActive(solo);
    this.lifeNode.setActive(solo);
    this.comboText.gameObject.setActive(solo);
    this.windNode.place(new V2(0, 1), two ? new V2(100, -330) : solo ? new V2(110, -205) : this.portrait ? new V2(100, -190) : new V2(100, -80), new V2(150, 76));
    // zone hints
    const L = this.UI.Hud.rect;
    for (let i = 0; i < 2; i++) {
      const t = this.zoneHint[i];
      if (this.portrait) { t.rectTransform.place(UIKit.Center, new V2(0, (i === 0 ? -1 : 1) * L.height * 0.22), new V2(900, 80)); t.rectTransform.localEulerAngles = new V3(0, 0, i === 0 ? 0 : 180); }
      else { t.rectTransform.place(UIKit.Center, new V2((i === 0 ? -1 : 1) * L.width * 0.25, -60), new V2(700, 80)); t.rectTransform.localEulerAngles = V3.zero; }
    }
  }

  // ------------------------------------------------------------------ title & shop

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    CasualLook.titleCard(this.UI, new Color(0.12, 0.05, 0.22, 0.38), new V2(1060, 1080), -10);
    for (let i = 0; i < ModeNames.length; i++) {
      const idx = i;
      const b = UIKit.buttonAt(ex, ModeNames[i], UIKit.Center, new V2((i - 2) * 200, 0), new V2(190, 92), false, () => this.PickMode(idx), 24);
      this.modeButtons.push(b);
    }
    this.optButton = UIKit.buttonAt(ex, "OPTION", UIKit.Center, new V2(-185, -108), new V2(350, 86), false, () => this.CycleOpt(), 28);
    this.shopButton = UIKit.buttonAt(ex, "KITE SHOP", UIKit.Center, new V2(185, -108), new V2(350, 86), false, () => this.OpenShop(true), 28);
    this.shopButton.setAccent(Gold);
    this.BuildShop(ex.parent!);
    this.RefreshTitle();
  }

  private BuildShop(parent: UINode) {
    const C = UIKit.Center;
    this.shop = UIKit.node("Shop", parent).stretch();
    UIKit.dim(this.shop, 0.8);
    const card = UIKit.card(this.shop, new V2(900, 1000), Gold);
    card.localScale = new V3(0.94, 0.94, 1);
    UIKit.glow(UIKit.at(UIKit.label(card, "KITE SHOP", 56, Color.white), C, new V2(0, 420), new V2(800, 70)), Ink, 3);
    UIKit.img(card, "Coin", KiteArt.Coin(), Color.white).rectTransform.place(C, new V2(-70, 350), new V2(54, 54));
    this.shopCoins = UIKit.at(UIKit.label(card, "0", 46, Gold, TextAnchor.MiddleLeft), C, new V2(60, 350), new V2(220, 60));
    UIKit.at(UIKit.label(card, "KITE", 30, Pal.TextDim), C, new V2(0, 285), new V2(400, 40));
    this.kiteImg = UIKit.img(card, "Kite", KiteArt.Kite(0), Color.white);
    this.kiteImg.rectTransform.place(C, new V2(0, 165), new V2(160, 200));
    this.kiteName = UIKit.at(UIKit.label(card, "", 40, Color.white), C, new V2(0, 40), new V2(600, 56));
    UIKit.buttonAt(card, "<", C, new V2(-330, 165), new V2(100, 110), false, () => this.Browse(0, -1), 52).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(330, 165), new V2(100, 110), false, () => this.Browse(0, 1), 52).setAccent(Gold);
    this.kiteAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, -40), new V2(380, 90), false, () => this.ShopAction(0), 32);
    UIKit.at(UIKit.label(card, "STRING", 30, Pal.TextDim), C, new V2(0, -125), new V2(400, 40));
    this.strImg = UIKit.img(card, "String", KiteArt.Swatch(), Color.white);
    this.strImg.rectTransform.place(C, new V2(0, -195), new V2(420, 105));
    this.strName = UIKit.at(UIKit.label(card, "", 40, Color.white), C, new V2(0, -262), new V2(600, 56));
    UIKit.buttonAt(card, "<", C, new V2(-330, -200), new V2(100, 110), false, () => this.Browse(1, -1), 52).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(330, -200), new V2(100, 110), false, () => this.Browse(1, 1), 52).setAccent(Gold);
    this.strAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, -345), new V2(380, 90), false, () => this.ShopAction(1), 32);
    UIKit.buttonAt(card, "CLOSE", C, new V2(0, -440), new V2(320, 84), true, () => this.OpenShop(false), 36).setAccent(Gold);
    this.shop.setActive(false);
  }

  private PickMode(i: number) {
    this.Data.set("mode", i);
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private CycleOpt() {
    if (this.SelMode !== Mode.Vs) return;
    this.Data.set("diff", (this.SelDiff + 1) % 3);
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private RefreshTitle() {
    if (this.modeButtons.length === 0) return;
    const m = this.SelMode;
    const accents = [Coral, Gold, Sky1, Pal.hex(0x4ee08a), Pal.hex(0xb46bff)];
    this.modeButtons.forEach((b, i) => b.setAccent(i === m ? accents[i] : new Color(1, 1, 1, 0.45)));
    const label = m === Mode.Solo ? "2 MIN · 3 STRINGS" : m === Mode.Daily ? `DAILY · ${this.DailyLabel()}` : m === Mode.Vs ? "CPU: " + DiffNames[this.SelDiff] : m === Mode.Online ? "PRIVATE TABLE" : "BEST OF 3 CUTS";
    if (this.optButton.label) this.optButton.label.text = label;
    this.optButton.setAccent(accents[m]);
    this.optButton.interactable = true;
    if (this.shopButton.label) this.shopButton.label.text = `KITE SHOP  ◉ ${this.Coins}`;
  }

  private OpenShop(on: boolean) {
    if (on) { this.browseKite = this.KiteSel; this.browseStr = this.StrSel; this.RefreshShop(); }
    else this.RefreshTitle();
    this.shop.setActive(on);
    Sfx.play(Snd.Click, 0.6);
  }

  private Browse(row: number, d: number) {
    if (row === 0) this.browseKite = (this.browseKite + d + Designs.length) % Designs.length;
    else this.browseStr = (this.browseStr + d + Strings.length) % Strings.length;
    Sfx.play(Snd.Tick, 0.5);
    this.RefreshShop();
  }

  private ShopAction(row: number) {
    const i = row === 0 ? this.browseKite : this.browseStr;
    const owned = row === 0 ? this.HasKite(i) : this.HasStr(i);
    const cost = row === 0 ? Designs[i].cost : Strings[i].cost;
    if (!owned) {
      if (this.Coins < cost) { Sfx.play(Snd.Deny, 0.6); return; }
      this.Data.add("coins", -cost);
      this.Data.set((row === 0 ? "uk" : "us") + i, 1);
      Sfx.playClip(this.chimeClip, 0.8);
    } else Sfx.play(Snd.Confirm, 0.6);
    this.Data.set(row === 0 ? "kite" : "str", i);
    this.RefreshShop();
    this.ApplyTitleKites();
  }

  private RefreshShop() {
    set(this.shopCoins, String(this.Coins));
    const k = Designs[this.browseKite];
    this.kiteImg.sprite = KiteArt.Kite(this.browseKite);
    set(this.kiteName, k.name);
    this.SetAction(this.kiteAction, this.KiteSel === this.browseKite, this.HasKite(this.browseKite), k.cost);
    const s = Strings[this.browseStr];
    this.strImg.color = s.color;
    set(this.strName, s.name);
    this.SetAction(this.strAction, this.StrSel === this.browseStr, this.HasStr(this.browseStr), s.cost);
  }

  private SetAction(b: ArcadeButton, equipped: boolean, owned: boolean, cost: number) {
    if (b.label) b.label.text = equipped ? "EQUIPPED" : owned ? "EQUIP" : `BUY ◉ ${cost}`;
    b.setAccent(equipped ? Pal.TextDim : owned ? Sky1 : this.Coins >= cost ? Gold : Pal.hex(0x8a7a6a));
    b.interactable = !equipped && (owned || this.Coins >= cost);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    const V = this.ViewSize, W2 = V.x / 2, H2 = V.y / 2;
    this.portrait = V.x < V.y;
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.skyBg, V);
    this.roofBase = -H2 + Mathf.clamp(V.y * 0.15, 3.0, 4.6);
    const rb = this.roofBase;
    // houses
    const rng = new SysRandom(11);
    let x = -W2 - 0.8, n = 0;
    for (const h of this.houses) {
      if (x > W2 + 0.8) { h.sr.gameObject.setActive(false); continue; }
      const w = (2.3 + rng.nextDouble() * 1.2) * (this.portrait ? 0.95 : 1.1);
      h.x0 = x; h.x1 = x + w;
      h.top = rb + (rng.nextDouble() - 0.5) * 1.1;
      const height = w * 2;
      const bottom = h.top - height * 0.925;
      const scale = Math.max(1, (h.top - (-H2 - 0.3)) / (height * 0.925));
      h.sr.gameObject.setActive(true);
      h.sr.transform.localScale = new V3(w, w * scale, 1);
      h.sr.transform.localPosition = new V3(x + w / 2, h.top - height * scale * 0.925 + height * scale / 2, 0);
      void bottom;
      x += w - 0.02;
      n++;
    }
    // far skyline
    const tw = 7;
    let i = 0;
    for (const s of this.skylines) {
      const sx = -W2 - 1 + i * tw;
      s.gameObject.setActive(sx < W2 + tw);
      s.transform.localScale = new V3(tw + 0.05, tw, 1);
      s.transform.localPosition = new V3(sx + tw / 2, rb - 0.6 + tw * 0.25 - tw * 0.1, 0);
      i++;
    }
    this.sun.transform.localPosition = new V3(W2 * 0.42, rb + V.y * 0.16, 0);
    this.sunGlow.transform.localPosition = this.sun.transform.localPosition;
    this.sunGlow.transform.localScale = new V3(V.x * 1.3, V.x * 1.1, 1);
    // spectators on roofs
    const act = this.houses.filter((h) => h.sr.gameObject.activeSelf);
    this.spectators.forEach((p, k) => {
      const h = act[k % act.length];
      const on = k < act.length * 2 && h !== undefined;
      p.sr.gameObject.setActive(on);
      if (!on) return;
      const f = k < act.length ? 0.28 : 0.68;
      p.feet = new V2(Mathf.lerp(h.x0, h.x1, f + (k % 3) * 0.04), h.top);
      p.flip = k % 2 === 1;
    });
    // bunting between neighbouring roofs
    this.buntings.forEach((b, k) => {
      const h0 = act[k], h1 = act[k + 1];
      const on = !!h0 && !!h1 && k % 2 === 0;
      b.line.gameObject.setActive(on);
      for (const f of b.flags) f.gameObject.setActive(on);
      if (!on) return;
      b.a = new V2(Mathf.lerp(h0.x0, h0.x1, 0.45), h0.top + 0.55);
      b.b = new V2(Mathf.lerp(h1.x0, h1.x1, 0.55), h1.top + 0.55);
    });
    this.streamers.forEach((s, k) => {
      const h = act[[1, 3, 5, 7][k]];
      const on = !!h;
      s.pole.gameObject.setActive(on); s.ribbon.gameObject.setActive(on);
      if (!on) return;
      s.base = new V2(Mathf.lerp(h.x0, h.x1, 0.85), h.top);
      s.pole.transform.localPosition = new V3(s.base.x, s.base.y + 0.75, 0);
      s.pole.transform.localScale = new V3(0.07, 1.5, 1);
    });
    // clouds
    this.clouds.forEach((c, k) => {
      c.w = (k < 3 ? 3 : 4.5) + (k % 2) * 1.2;
      if (c.x === 0) c.x = -W2 + ((k * 0.37) % 1) * V.x;
      c.y = Mathf.lerp(rb + 2, H2 - 1.5, ((k * 0.61) % 1));
      c.speed = (k < 3 ? 0.12 : 0.22);
    });
    // sky arena
    const unit = Math.min(V.x, V.y) / 1080;
    const top = H2 - (this.mode === Mode.TwoP && this.portrait ? 150 : this.portrait ? 230 : 160) * unit;
    this.sky.arena = { xMin: -W2 + 0.9, xMax: W2 - 0.9, yMin: rb + 1.7, yMax: top - 0.6 };
    this.view?.set(this.sky.arena, this.seat === 1 && this.mode === Mode.Online);
    if (this.UI) this.LayoutHud();
  }

  private RoofAt(x: number) {
    for (const h of this.houses) if (h.sr.gameObject.activeSelf && x >= h.x0 && x < h.x1) return h.top;
    return this.roofBase;
  }

  /** The flyer's hand on the roof at x (the string starts there). */
  private HandAt(x: number, flip: boolean) { return new V2(x + (flip ? -0.28 : 0.28), this.RoofAt(x) + 1.26); }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.LeaveTable();
    this.attract = true;
    this.mode = Mode.Vs;
    this.Layout();
    this.SetupDuel(true);
    this.ApplyTitleKites();
    this.RefreshTitle();
    this.shop?.setActive(false);
    for (const z of this.zoneHint) z.gameObject.setActive(false);
    if (this.zipLoop) this.zipLoop.volume = 0;
    if (this.sawLoop) this.sawLoop.volume = 0;
    // an invite link (?table=12345) opens the join panel and joins straight away
    const code = tableCodeFromUrl();
    if (code && !this.autoJoined && this.lobby) {
      this.autoJoined = true;
      this.Data.set("mode", Mode.Online);
      this.RefreshTitle();
      this.UI.ShowTitle(this.BestLine(), this.StatsLine());
      this.lobby.open("join", code);
    }
  }

  private ApplyTitleKites() {
    if (!this.attract || this.sky.kites.length < 2) return;
    this.sky.kites[0].design = this.KiteSel; this.sky.kites[0].stringColor = this.StrSel;
  }

  protected BeginRun() {
    this.attract = false;
    this.mode = this.SelMode;
    this.diff = this.SelDiff;
    this.glassStart = this.pendingGlass; this.pendingGlass = false;
    this.score = 0; this.lives = 3; this.timeLeft = SoloTime; this.cuts = 0; this.combo = 0; this.comboT = 0; this.bestCombo = 0;
    this.coinsRun = 0; this.revived = false; this.doubled = false; this.lastResult = null;
    this.roundWins = [0, 0]; this.round = 0; this.heatWarned = false;
    this.touchOwner.clear(); this.mouseOwner = -1;
    this.Data.add("games", 1);
    this.Layout();
    if (this.mode === Mode.Solo || this.mode === Mode.Daily) this.SetupSolo();
    else if (this.mode === Mode.Online) this.SetupOnline();
    else this.SetupDuel(false);
    this.LayoutHud();
    Sfx.setIntensity(0.65);
    this.zoneT = this.mode === Mode.TwoP ? 3.5 : 0;
  }

  private ClearSky(seed: number) {
    this.sky.reset(seed);
    this.bots.clear(); this.rivalType.clear(); this.humans = [];
    for (const v of this.views) this.HideView(v);
    for (const f of this.flyers) f.sr.gameObject.setActive(false);
    this.fx.clear();
    this.goalRing.gameObject.setActive(false);
    this.guide.gameObject.setActive(false);
  }

  private NewKite(id: number, design: number, str: number, spinDir: number) {
    const k = new Kite(id);
    k.design = design; k.stringColor = str; k.spinDir = spinDir;
    this.sky.kites.push(k);
    return k;
  }

  // ---------- duel (VS CPU, 2 PLAYERS, title attract)

  private SetupDuel(attract: boolean) {
    const seed = attract ? 5 : Math.floor(Math.random() * 1e9);
    this.ClearSky(seed);
    this.rng = new SysRandom(seed + 1);
    this.sky.birdEvery = 16; this.sky.pickEvery = 19;
    this.sky.canClash = () => true;
    const p1Design = attract ? this.KiteSel : this.KiteSel;
    const other = (p1Design + (this.mode === Mode.TwoP ? 3 : 2)) % Designs.length;
    const a = this.NewKite(0, p1Design, this.StrSel, 1);
    const b = this.NewKite(1, other === p1Design ? (other + 1) % Designs.length : other, this.mode === Mode.TwoP ? 1 : 4, -1);
    if (attract) {
      this.bots.set(a, new KiteBot(a, BotLevels[1], new SysRandom(seed + 2)));
      this.bots.set(b, new KiteBot(b, BotLevels[1], new SysRandom(seed + 3)));
    } else if (this.mode === Mode.Vs) {
      this.humans = [a];
      this.bots.set(b, new KiteBot(b, BotLevels[this.diff], new SysRandom(seed + 3)));
    } else this.humans = [a, b];
    this.StartRound();
  }

  private StartRound() {
    const W2 = this.ViewSize.x / 2;
    const ks = this.sky.kites;
    this.sky.clashes = [];
    for (const b of this.sky.birds) b.active = false;
    for (const p of this.sky.pickups) p.active = false;
    this.sky.heat = 1;
    ks.forEach((k, i) => {
      const s = i === 0 ? -1 : 1;
      const fx = s * W2 * (this.portrait ? 0.55 : 0.6);
      const hand = this.HandAt(fx, s > 0);
      k.launch(hand, new V2(fx * 0.75, Math.min(hand.y + 6, this.sky.arena.yMax - 1)), 1.6);
      k.safeT = 0;
      if (this.glassStart && i === 0 && !this.attract) k.glassT = 12;
      const f = this.flyers[i];
      f.feet = new V2(fx, this.RoofAt(fx)); f.flip = s > 0;
      f.sr.gameObject.setActive(true);
    });
    this.roundT = 0;
    this.step = Step.Intro;
    this.stepT = this.attract ? 1.6 : 2.6;
    this.countStep = -1;
    this.heatWarned = false;
    Sfx.playClip(this.launchClip, this.attract ? 0.2 : 0.6);
    if (!this.attract) {
      this.round++;
      if (this.mode === Mode.Vs && this.Data.get("vstip") === 0 && this.round === 1) { this.UI.Toast("Cross the CPU's string, then HOLD to pull AWAY from the crossing!", 4); this.Data.set("vstip", 1); }
      if (this.mode === Mode.TwoP && this.round === 1) this.UI.Toast("Each player holds their own half of the screen. P1: SPACE / A   P2: ENTER / L", 4);
    }
  }

  // ---------- solo festival

  private SetupSolo() {
    const daily = this.mode === Mode.Daily;
    const seed = daily ? todaySeed() * 7 + 3 : Math.floor(Math.random() * 1e9);
    this.ClearSky(seed);
    this.rng = new SysRandom(seed + 1);
    this.sky.birdEvery = 11; this.sky.pickEvery = 14; this.sky.windEvery = 12;
    this.sky.birdT = 7; this.sky.pickT = 9;
    this.sky.canClash = (a, b) => this.humans.includes(a) || this.humans.includes(b);
    const me = this.NewKite(0, this.KiteSel, this.StrSel, 1);
    me.strength = 1.5; // festival flyers: your string is the best on the roofs
    this.humans = [me];
    this.LaunchHuman(false);
    this.spawnT = 2.5; this.champT = 42; this.relaunchT = 0; this.endT = 0;
    this.tutStep = !daily && this.Data.get("tut") === 0 ? 0 : -1;
    this.tutT = 0;
    this.step = Step.Play; this.stepT = 0;
    if (this.tutStep < 0) this.UI.Announce(daily ? "DAILY FESTIVAL!" : "FLY!", Gold, 1.2);
  }

  private SoloAnchorX() { return -this.ViewSize.x / 2 * (this.portrait ? 0.15 : 0.22); }

  private LaunchHuman(safe: boolean) {
    const me = this.humans[0];
    const x = this.SoloAnchorX(), hand = this.HandAt(x, false);
    me.launch(hand, new V2(x + 0.5, Math.min(hand.y + 6.5, this.sky.arena.yMax - 1)), 1.4);
    if (safe) me.safeT = 3.5;
    if (this.glassStart) me.glassT = 12;
    const f = this.flyers[0];
    f.feet = new V2(x, this.RoofAt(x)); f.flip = false; f.sr.gameObject.setActive(true);
    Sfx.playClip(this.launchClip, 0.6);
  }

  private SpawnRival(type: RivalType, passive = false) {
    if (this.sky.kites.length >= 6) return null;
    const W2 = this.ViewSize.x / 2, me = this.humans[0];
    // pick a free roof spot away from the player and other flyers
    let x = 0;
    for (let tries = 0; tries < 20; tries++) {
      x = (this.rng.nextDouble() * 2 - 1) * W2 * 0.85;
      const clear = Math.abs(x - this.SoloAnchorX()) > 2.4 && this.sky.kites.every((k) => k === me || Math.abs(k.anchor.x - x) > 1.6);
      if (clear) break;
    }
    const flip = x > this.SoloAnchorX();
    const hand = this.HandAt(x, flip);
    let design = this.rng.next(Designs.length);
    if (design === this.KiteSel) design = (design + 1) % Designs.length;
    const id = this.sky.kites.reduce((m, k) => Math.max(m, k.id), 0) + 1;
    const k = this.NewKite(id, design, 1 + this.rng.next(Strings.length - 1), this.rng.nextDouble() < 0.5 ? 1 : -1);
    k.strength = type.strength; k.speedMul = type.speed;
    k.launch(hand, new V2(x * 0.8, Math.min(hand.y + 5 + this.rng.nextDouble() * 4, this.sky.arena.yMax - 1)), 1.6);
    const lv: BotLevel = { ...BotLevels[type.level] };
    if (type.level === 0) lv.aggr = 0.35;
    const bot = new KiteBot(k, lv, new SysRandom(this.rng.next()));
    bot.passive = passive;
    this.bots.set(k, bot);
    this.rivalType.set(k, type);
    return k;
  }

  protected OnPauseChanged(paused: boolean) {
    this.touchOwner.clear(); this.mouseOwner = -1;
    if (this.mode === Mode.Online && this.link) { this.mePaused = paused; this.link.room.send({ t: "kp", p: paused ? 1 : 0 } satisfies PauseMsg); }
    if (paused) { if (this.zipLoop) this.zipLoop.volume = 0; if (this.sawLoop) this.sawLoop.volume = 0; }
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.State === Phase.Title && this.attract) {
      this.TickAttract(dt);
    } else if (this.mode === Mode.Online) {
      this.OnlineDisplay(dt);
    } else {
      this.sky.step(dt * 0.5);
      this.sky.drainEvents();
    }
    this.Render(dt);
    this.UpdateLoops(false);
  }

  private TickAttract(dt: number) {
    const ks = this.sky.kites;
    if (this.step === Step.Intro) { this.stepT -= dt; if (this.stepT <= 0) this.step = Step.Play; }
    if (this.step === Step.Play || this.step === Step.Intro) {
      ks.forEach((k, i) => { const b = this.bots.get(k); k.hold = this.step === Step.Play && b ? b.tick(dt, this.sky, ks[1 - i]) : false; });
    }
    this.sky.step(dt);
    for (const e of this.sky.drainEvents()) {
      if (e.type === "cut") { this.step = Step.Cut; this.stepT = 3.2; this.CutFx(e.at, e.loser, true); }
    }
    this.roundT += dt;
    if (this.step === Step.Cut) { this.stepT -= dt; if (this.stepT <= 0) this.StartRound(); }
    if (this.roundT > 45 && this.step === Step.Play) this.StartRound();
  }

  protected TickRun(dt0: number) {
    const dt = dt0 * KiteClashGame.TestTimeScale;
    this.ReadInput();
    if (this.mode === Mode.Solo || this.mode === Mode.Daily) this.TickSolo(dt);
    else if (this.mode === Mode.Online) this.TickOnline(dt0);
    else this.TickDuel(dt);
    this.zoneT = Math.max(0, this.zoneT - dt0);
    for (let i = 0; i < 2; i++) {
      const on = this.zoneT > 0;
      this.zoneHint[i].gameObject.setActive(on);
      if (on) this.zoneHint[i].color = Color.white.withAlpha(Mathf.clamp01(this.zoneT) * (0.75 + 0.25 * Math.sin(Time.time * 6)));
    }
    this.Render(dt);
    this.UpdateHud(dt);
    this.UpdateLoops(true);
  }

  private ControlOn() { return this.step === Step.Play; }

  private TickDuel(dt: number) {
    const ks = this.sky.kites;
    this.stepT -= dt;
    if (this.step === Step.Intro) {
      const n = Math.ceil(this.stepT / 0.8);
      if (n !== this.countStep) {
        this.countStep = n;
        if (n >= 1 && n <= 3) { this.UI.Announce(String(n), Gold, 0.7); Sfx.play(Snd.Beep, 0.6); }
      }
      if (this.stepT <= 0) { this.step = Step.Play; this.UI.Announce(this.round === 1 ? "FLY!" : `ROUND ${this.round}`, Coral, 0.9); Sfx.play(Snd.BeepHigh, 0.7); }
    }
    ks.forEach((k, i) => {
      const bot = this.bots.get(k);
      if (bot) k.hold = this.step === Step.Play ? bot.tick(dt, this.sky, ks[1 - i]) : false;
      else k.hold = this.ControlOn() && this.HumanHold(this.humans.indexOf(k));
    });
    if (this.step === Step.Play) {
      this.roundT += dt;
      this.sky.heat = this.roundT > HeatAt ? 1 + (this.roundT - HeatAt) / 6 : 1;
      if (this.roundT > HeatAt && !this.heatWarned) { this.heatWarned = true; this.UI.Toast("The strings are heating up: they cut faster now!", 3); Sfx.play(Snd.Warn, 0.6); }
      if (this.roundT >= RoundTime) {
        // time: the higher kite takes the round
        const w = ks[0].pos.y >= ks[1].pos.y ? 0 : 1;
        this.UI.Announce("TIME! HIGHER KITE WINS", Gold, 1.6);
        this.RoundWon(w, null);
      }
    }
    this.sky.step(dt);
    for (const e of this.sky.drainEvents()) this.OnSkyEvent(e);
    if (this.step === Step.Cut && this.stepT <= 0) {
      if (this.roundWins[0] >= WinCuts || this.roundWins[1] >= WinCuts) { this.step = Step.Over; this.EndDuel(); }
      else this.StartRound();
    }
  }

  private RoundWon(w: number, at: V2 | null) {
    if (this.step !== Step.Play) return;
    this.roundWins[w]++;
    this.step = Step.Cut;
    this.stepT = 3.0;
    for (const k of this.sky.kites) k.hold = false;
    if (!at) { Sfx.playClip(this.cheerClip, 0.6); this.cheerT = 2; }
    const human = this.mode === Mode.Vs ? w === 0 : true;
    if (this.mode === Mode.Vs) this.coinsRun += w === 0 ? 5 : 0;
    const name = this.mode === Mode.TwoP ? `PLAYER ${w + 1}` : w === 0 ? "YOU" : "CPU";
    const done = this.roundWins[w] >= WinCuts;
    const t = done ? (this.mode === Mode.TwoP ? `PLAYER ${w + 1} WINS!` : w === 0 ? "YOU WIN!" : "CPU WINS") : `${name} ${this.roundWins[0]} – ${this.roundWins[1]}`;
    this.startCoroutine((function* (self: KiteClashGame) {
      let t0 = 0;
      while (t0 < 1.1) { t0 += Time.unscaledDeltaTime; yield; }
      self.UI.Announce(t, human ? Gold : Bad, 1.5);
    })(this));
  }

  private TickSolo(dt: number) {
    const me = this.humans[0];
    const tut = this.tutStep >= 0;
    if (!tut && this.step === Step.Play) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 10 && Math.ceil(this.timeLeft) !== Math.ceil(this.timeLeft + dt) && this.timeLeft > 0) Sfx.play(Snd.Tick, 0.7);
    }
    me.hold = (this.step === Step.Play && me.state === KState.Fly) ? this.HumanHold(0) : false;
    // only a few rivals hunt you at once (more as the festival goes on); the others fly their own patch of sky
    const hunters = 1 + Math.floor((SoloTime - this.timeLeft) / 50);
    let n = 0;
    for (const k of this.sky.kites) {
      const b = this.bots.get(k);
      if (!b) continue;
      const hunt = k.tethered && n++ < hunters;
      k.hold = this.step === Step.Play ? b.tick(dt, this.sky, me.flying && hunt ? me : null) : false;
    }
    if (tut) this.TickTutorial(dt);
    else if (this.step === Step.Play) this.SoloSpawner(dt);
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) this.combo = 0;
    if (this.relaunchT > 0) {
      this.relaunchT -= dt;
      if (this.relaunchT <= 0 && this.step === Step.Play) this.LaunchHuman(true);
    }
    this.sky.step(dt);
    for (const e of this.sky.drainEvents()) this.OnSkyEvent(e);
    // remove finished rivals
    this.sky.kites = this.sky.kites.filter((k) => k === me || k.state !== KState.Gone);
    for (const k of [...this.bots.keys()]) if (!this.sky.kites.includes(k)) { this.bots.delete(k); this.rivalType.delete(k); }
    if (this.step === Step.Play && !tut && this.timeLeft <= 0) {
      this.step = Step.Over; this.endT = 1.6; this.endReason = "time";
      this.UI.Announce("FESTIVAL OVER!", Gold, 1.5);
      Sfx.play(Snd.Alarm, 0.6);
      this.CheerAll();
    }
    if (this.step === Step.Over) {
      this.endT -= dt;
      if (this.endT <= 0 && this.State === Phase.Playing) this.EndSolo();
    }
  }

  private SoloSpawner(dt: number) {
    const elapsed = SoloTime - this.timeLeft;
    const want = elapsed < 20 ? 1 : elapsed < 60 ? 2 : elapsed < 95 ? 3 : 4;
    const rivals = this.sky.kites.filter((k) => this.bots.has(k) && k.tethered);
    this.champT -= dt;
    if (this.champT <= 0 && !rivals.some((k) => this.rivalType.get(k) === Rivals[2]) && this.timeLeft > 12) {
      this.champT = 45;
      if (this.SpawnRival(Rivals[2])) { this.UI.Announce("CHAMPION KITE!", Gold, 1.4); Sfx.play(Snd.Warn, 0.7); }
      return;
    }
    if (rivals.length >= want) { this.spawnT = Math.max(this.spawnT, 1.2); return; }
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 1.6 + this.rng.nextDouble() * 1.8;
    const swift = elapsed > 25 && this.rng.nextDouble() < Math.min(0.6, 0.2 + elapsed / 200);
    this.SpawnRival(swift ? Rivals[1] : Rivals[0]);
  }

  private TickTutorial(dt: number) {
    const me = this.humans[0];
    this.tutT += dt;
    me.safeT = Math.max(me.safeT, 1);
    switch (this.tutStep) {
      case 0:
        this.UI.Hint("Your kite SPINS while the string is slack. Watch the white arrow at its nose.");
        if (this.tutT > 3.2 && me.flying) { this.tutStep = 1; this.tutT = 0; }
        break;
      case 1:
        this.UI.Hint("HOLD anywhere (or SPACE) to pull: the kite darts where its nose points. Let go to turn.");
        if (me.pulls >= 3 && this.tutT > 2.5) {
          this.tutStep = 2; this.tutT = 0;
          const A = this.sky.arena;
          this.tutGoal = new V2((A.xMin + A.xMax) / 2 + (me.pos.x < 0 ? 1 : -1) * (A.xMax - A.xMin) * 0.22, Mathf.lerp(A.yMin, A.yMax, 0.62));
        }
        break;
      case 2:
        this.UI.Hint("Fly into the golden ring: hold when the nose points at it.");
        if (V2.distance(me.pos, this.tutGoal) < 1.5 || this.tutT > 16) {
          Sfx.playClip(this.chimeClip, 0.8);
          this.fx.sparkle(this.tutGoal, Gold, 12, 1.2, 0.4);
          this.tutStep = 3; this.tutT = 0;
          const r = this.SpawnRival({ ...Rivals[0], strength: 0.5 }, true);
          if (r) r.safeT = 0;
        }
        break;
      case 3: {
        this.UI.Hint("Fly ACROSS the rival's string, then HOLD and pull AWAY from the crossing to cut it!");
        const rival = this.sky.kites.find((k) => k !== me && k.tethered);
        if (!rival && this.tutT > 2) { const r = this.SpawnRival({ ...Rivals[0], strength: 0.5 }, true); void r; }
        break;
      }
      case 4:
        if (this.tutT > 2.5) {
          this.tutStep = -1;
          this.Data.set("tut", 1);
          this.score = 0;
          this.UI.Hint(null);
          this.UI.Announce("2 MINUTES: GO!", Gold, 1.3);
          this.spawnT = 1.5;
          me.safeT = 2;
        }
        break;
    }
  }

  // ------------------------------------------------------------------ events

  private OnSkyEvent(e: SkyEvent) {
    switch (e.type) {
      case "cut": this.OnCut(e.winner, e.loser, e.at); break;
      case "bird":
        Sfx.playClip(this.chirpClip, 0.7, 0.9 + Math.random() * 0.3);
        for (let i = 0; i < 8; i++) this.fx.emit(e.bird.pos, Random2().mul(2.5), Pal.hex(0x3a3050), 0.18, 0.9, CasualArt.Dot, 2, 300, true, 2);
        if (this.humans.includes(e.kite)) { this.UI.Float(e.kite.pos.add(new V2(0, 1)), "WOBBLE!", Pal.hex(0xffe0a0), 0.8); }
        break;
      case "pickup": {
        const glass = e.pickup.kind === PickKind.Glass;
        Sfx.playClip(this.chimeClip, 0.85);
        this.fx.sparkle(e.pickup.pos, glass ? Pal.hex(0x9ff6ff) : Color.white, 14, 1.0, 0.45);
        if (this.humans.includes(e.kite) || this.mode === Mode.TwoP) {
          this.UI.Float(e.kite.pos.add(new V2(0, 1.2)), glass ? "GLASS STRING!" : "WIND BOOST!", glass ? Pal.hex(0x9ff6ff) : Pal.hex(0xc8fff0), 0.9);
          if (this.mode === Mode.Solo || this.mode === Mode.Daily) { this.score += 50; }
        } else if (this.mode === Mode.Vs) this.UI.Float(e.kite.pos.add(new V2(0, 1.2)), glass ? "CPU: GLASS!" : "CPU: BOOST!", Bad, 0.8);
        break;
      }
      case "gust": {
        Sfx.playClip(this.gustClip, 0.5);
        const arrow = e.wind.x >= 0 ? "→" : "←";
        if (!this.attract && this.State === Phase.Playing) this.UI.Float(new V2(0, this.sky.arena.yMax - 1.5), `WIND SHIFT ${arrow}`, Color.white, 0.8);
        break;
      }
      case "crash": this.OnCrash(e.kite); break;
      case "cross":
        if (!this.attract && this.humans.some((h) => e.clash.has(h))) Sfx.play(Snd.Zap, 0.35, 1.4);
        break;
    }
  }

  private OnCut(winner: Kite, loser: Kite, at: V2) {
    const humanLost = this.humans.includes(loser), humanWon = this.humans.includes(winner);
    this.CutFx(at, loser, humanWon || this.mode === Mode.TwoP);
    if (this.mode === Mode.Vs || this.mode === Mode.TwoP) {
      const w = this.sky.kites.indexOf(winner);
      this.UI.Announce(Cheers[Math.floor(Math.random() * Cheers.length)], humanWon || this.mode === Mode.TwoP ? Gold : Bad, 1.0);
      this.RoundWon(w, at);
      if (this.mode === Mode.Vs && humanLost) Sfx.playClip(this.lostClip, 0.6);
      return;
    }
    // solo festival
    if (humanLost) {
      this.combo = 0; this.comboT = 0;
      Sfx.playClip(this.lostClip, 0.7);
      this.Back.Flash(Bad, 0.25);
      if (this.tutStep >= 0) { this.relaunchT = 1.2; return; }
      this.lives--;
      if (this.lives <= 0 && this.step === Step.Play) {
        this.step = Step.Over; this.endT = 1.8; this.endReason = "lives";
        this.UI.Announce("OUT OF STRING!", Bad, 1.5);
      } else {
        this.UI.Announce(`STRING CUT! ${this.lives} LEFT`, Bad, 1.3);
        this.relaunchT = 1.8;
      }
      return;
    }
    if (humanWon) {
      const type = this.rivalType.get(loser) ?? Rivals[0];
      if (this.tutStep === 3) {
        this.tutStep = 4; this.tutT = 0;
        this.UI.Hint("GREAT CUT! Now the festival begins: cut as many kites as you can!");
        this.UI.Announce(Cheers[0], Gold, 1.1);
        this.coinsRun += 5;
        return;
      }
      this.combo = this.comboT > 0 ? this.combo + 1 : 1;
      this.comboT = 6;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const mult = Math.min(3, 1 + 0.5 * (this.combo - 1));
      const pts = Math.round(type.points * mult);
      this.score += pts;
      this.cuts++;
      this.coinsRun += type === Rivals[2] ? 15 : 5;
      this.UI.Float(at.add(new V2(0, 0.8)), `+${pts}`, Gold, 1.2);
      this.UI.Announce(this.combo > 1 ? `COMBO x${this.combo}!` : type === Rivals[2] ? "CHAMPION CUT!" : Cheers[Math.floor(Math.random() * Cheers.length)], Gold, 1.0);
    }
  }

  private OnCrash(k: Kite) {
    const human = this.humans.includes(k);
    this.fx.pop(k.pos, Color.white, 12, 4, 0.18, 0.5);
    if (this.mode === Mode.Vs || this.mode === Mode.TwoP) {
      const w = 1 - this.sky.kites.indexOf(k);
      this.UI.Announce("TANGLED ON THE ROOFS!", Bad, 1.2);
      Sfx.playClip(this.lostClip, 0.6);
      this.RoundWon(w, null);
      return;
    }
    if (!human) return;
    Sfx.playClip(this.lostClip, 0.7);
    this.Back.Flash(Bad, 0.2);
    this.combo = 0; this.comboT = 0;
    if (this.tutStep >= 0) { this.relaunchT = 1.2; this.UI.Announce("TOO LOW: KEEP IT UP!", Bad, 1.2); return; }
    this.lives--;
    if (this.lives <= 0 && this.step === Step.Play) { this.step = Step.Over; this.endT = 1.8; this.endReason = "lives"; this.UI.Announce("OUT OF STRING!", Bad, 1.5); }
    else { this.UI.Announce(`TANGLED! ${this.lives} LEFT`, Bad, 1.3); this.relaunchT = 1.8; }
  }

  private CutFx(at: V2, loser: Kite, big: boolean) {
    Sfx.playClip(this.snapClip, this.attract ? 0.3 : 0.9);
    this.fx.pop(at, Color.white, 18, 7, 0.2, 0.5);
    this.fx.pop(at, Gold, 12, 5, 0.16, 0.6);
    const d = Designs[loser.design];
    this.fx.confetti(loser.pos, 26, 6, [d.a, d.b, d.c, Gold, Color.white], 0.28);
    if (!this.attract) {
      this.Fx.ring(at, Color.white, 0.2, 3.2, 0.45);
      this.Fx.shake(big ? 0.4 : 0.25);
      this.SlowMo(0.3, 0.75);
      this.Hitstop(0.05);
    }
    this.CheerAll();
    const self = this;
    this.startCoroutine((function* () {
      let t = 0;
      while (t < 0.18) { t += Time.unscaledDeltaTime; yield; }
      Sfx.playClip(self.cheerClip, self.attract ? 0.25 : 0.75);
    })());
  }

  private CheerAll() {
    this.cheerT = 2.2;
    for (const p of this.spectators) {
      if (!p.sr.gameObject.activeSelf) continue;
      p.cheer = 1.6 + Math.random() * 0.8;
      if (!this.attract && Math.random() < 0.35) this.fx.confetti(p.feet.add(new V2(0, 1.2)), 6, 5, Confetti, 0.2);
    }
  }

  // ------------------------------------------------------------------ online (private tables)

  private BuildOnline() {
    const theme = { accent: P1Col, accent2: P2Col, ink: Ink };
    this.lobby = new TableLobby("kiteclash", theme, {
      onReady: (room) => this.OnTableReady(room),
      toast: (t, sec) => this.UI.Toast(t, sec ?? 2),
    }, "Kite Clash");
    this.lobby.createNote = "A real-time kite duel: best of 3 cuts. You both fly from the left roof on your own screen.";
    this.overlay = new TableOverlay(theme, () => { this.overlay.hide(); this.EnterTitle(); }, (k) => this.link?.react(k));
    this.overlay.onTimeout = () => { this.link?.leave(); this.FriendLeft(); };
  }

  /** PLAY with ONLINE selected opens the lobby; REMATCH online asks the friend. */
  protected StartRun() {
    if (this.State === Phase.Paused && this.mode === Mode.Online) { this.UI.Toast("Restart isn't available online: use MENU to leave the table.", 2.5); return; }
    if (this.SelMode === Mode.Online && !this.onlineGo) {
      if (this.State === Phase.Over && this.link && this.link.connected) { this.overlay.waitingRematch(); this.link.askRematch(); return; }
      if (this.State === Phase.Over) this.EnterTitle();
      if (!this.lobby.isOpen) this.lobby.open("menu");
      return;
    }
    this.onlineGo = false;
    super.StartRun();
  }

  /** A real-time match keeps running when the window loses focus (the friend is still flying). */
  onFocusLost() { if (this.mode === Mode.Online && this.link && this.State === Phase.Playing) return; super.onFocusLost(); }

  update() {
    super.update();
    this.lobby?.tick(Time.unscaledDeltaTime);
    this.overlay?.tick();
    this.NetPump(Time.unscaledDeltaTime);
  }

  private OnTableReady(room: OnlineRoom) {
    this.LeaveTable();
    const lag = KiteClashGame.NetLag;
    if (lag.ms > 0) {
      // test hook: artificial latency + jitter on everything this device sends
      const send = room.send.bind(room);
      room.send = (d: unknown) => { window.setTimeout(() => send(d), lag.ms + Math.random() * lag.jitter); };
    }
    const link = new OnlineLink<OStart, number, OSnap>(room);
    this.link = link;
    this.seat = link.me;
    this.view.set(this.sky.arena, this.seat === 1);
    room.onMessage((d) => this.OnNetMessage(d as { t?: string }));
    link.bind({
      onStart: (st) => {
        this.onlineStart = st;
        this.overlay.hide();
        this.Data.set("mode", Mode.Online);
        this.onlineGo = true;
        this.resumeWins = null;
        this.StartRun();
      },
      validMove: () => false,
      onMove: () => {},
      snapshot: () => ({ w: this.netWins.slice(), r: this.round, d: this.netDesigns.slice() }),
      onSnapshot: (snap) => {
        if (this.State === Phase.Playing && this.mode === Mode.Online) return; // the state stream keeps us in sync
        if (snap.r <= 0) return;
        // joined (again) in the middle of a match: continue from the host's score
        this.overlay.hide();
        this.Data.set("mode", Mode.Online);
        this.onlineGo = true;
        this.resumeWins = snap.w.slice();
        this.StartRun();
      },
      onReaction: (k) => this.overlay.Pop(k, true),
      onFriend: (st) => {
        if (st === "connected") {
          if (this.overlay.state === "lost") { this.overlay.hide(); this.UI.Toast("Your friend is back!", 2); }
          this.SendDesign();
        } else if (st === "lost") { if (this.State === Phase.Playing && this.mode === Mode.Online && this.step !== Step.Over) this.overlay.lost(30); }
        else this.FriendLeft();
      },
      onRematchReady: () => { if (link.isHost) link.start({ d: this.KiteSel, s: this.StrSel, seed: Math.floor(Math.random() * 1e9) }); },
      onFriendRematch: () => { if (this.overlay.state !== "rematch") this.UI.Toast("Your friend wants a rematch! Tap REMATCH.", 3); },
    });
    this.SendDesign();
    if (link.isHost) link.start({ d: this.KiteSel, s: this.StrSel, seed: Math.floor(Math.random() * 1e9) });
    else this.UI.Toast("Joined! Waiting for the host to start…", 3);
  }

  private SendDesign() { if (this.link && !this.link.isHost) this.link.room.send({ t: "kd", d: this.KiteSel, s: this.StrSel }); }

  private OnNetMessage(m: { t?: string }) {
    if (!m || !this.link) return;
    if (m.t === "kd" && this.link.isHost) {
      const d = m as unknown as { d: number; s: number };
      this.netDesigns[2] = Mathf.clamp(d.d | 0, 0, Designs.length - 1); this.netDesigns[3] = Mathf.clamp(d.s | 0, 0, Strings.length - 1);
      if (this.netSim && this.netSim.kites[1]) { this.netSim.kites[1].design = this.netDesigns[2]; this.netSim.kites[1].stringColor = this.netDesigns[3]; }
    } else if (m.t === "kp") {
      const p = (m as PauseMsg).p === 1;
      if (p !== this.friendPaused) this.UI.Toast(p ? "Your friend paused the game." : "Your friend is back: fly!", 2);
      this.friendPaused = p;
    } else if (m.t === "kg" && this.link.isHost) this.OnGuestInput(m as InputMsg);
    else if (m.t === "ks" && !this.link.isHost) this.OnHostState(m as StateMsg);
  }

  /** Both devices: set up the duel; the host also builds the canonical simulation. */
  private SetupOnline() {
    const seed = this.onlineStart.seed || 1;
    this.ClearSky(seed);
    this.sky.canClash = () => false;
    this.sky.birdEvery = 0; this.sky.pickEvery = 0;
    this.Layout();
    this.view.set(this.sky.arena, this.seat === 1);
    // display kites: slot 0 = me (left roof), slot 1 = friend
    const me = this.NewKite(0, this.KiteSel, this.StrSel, 1), fr = this.NewKite(1, 2, 1, -1);
    this.humans = [me];
    for (let i = 0; i < 2; i++) { const f = this.flyers[i]; f.sr.gameObject.setActive(true); }
    this.netWins = this.resumeWins ? this.resumeWins.slice() : [0, 0];
    this.resumeWins = null;
    this.round = this.netWins[0] + this.netWins[1];
    this.netDesigns[0] = this.onlineStart.d; this.netDesigns[1] = this.onlineStart.s;
    if (this.seat === 0) { this.netDesigns[2] = this.netDesigns[2] ?? 2; }
    this.states = []; this.offsetEst = -1e9; this.lastEv = 0; this.inSeq = 0; this.lastIn = 0; this.sendT = 0;
    this.mePaused = this.friendPaused = false; this.forfeit = false; this.netEnded = false;
    this.local = null; this.netSim = null; this.evLog = [];
    if (this.seat === 0) {
      const sim = new Sky(seed);
      sim.arena = { ...Canon };
      sim.birdEvery = 16; sim.pickEvery = 19;
      sim.canClash = () => true;
      const a = new Kite(0), b = new Kite(1);
      a.design = this.KiteSel; a.stringColor = this.StrSel; a.spinDir = 1;
      b.design = this.netDesigns[2]; b.stringColor = this.netDesigns[3]; b.spinDir = -1;
      sim.kites = [a, b];
      this.netSim = sim;
      this.StartNetRound();
    } else {
      this.local = new Kite(1);
      this.local.spinDir = -1; this.local.anchor = CanonAnchor(1);
      this.local.design = this.KiteSel; this.local.stringColor = this.StrSel;
      this.step = Step.Intro; this.stepT = 2.6; this.roundT = 0;
    }
    me.design = this.KiteSel; me.stringColor = this.StrSel;
    void fr;
    this.countStep = -1;
    this.UpdateDisplayWins();
    if (this.netWins[0] + this.netWins[1] === 0) this.UI.Toast("You fly from the LEFT roof. HOLD anywhere to pull, cross your friend's string to cut it!", 4);
  }

  /** Host: a new round in the canonical sky. */
  private StartNetRound() {
    const sim = this.netSim!;
    sim.clashes = [];
    for (const b of sim.birds) b.active = false;
    for (const p of sim.pickups) p.active = false;
    sim.heat = 1;
    sim.kites.forEach((k, i) => { k.launch(CanonAnchor(i), CanonLaunch(i), 1.6); k.safeT = 0; });
    this.roundT = 0;
    this.step = Step.Intro;
    this.stepT = 2.6;
    this.round++;
    this.heatWarned = false;
    Sfx.playClip(this.launchClip, 0.6);
  }

  private TickOnline(dt: number) {
    const host = this.seat === 0;
    const frozen = !this.link || !this.link.connected || this.mePaused || this.friendPaused || this.overlay.busy;
    if (host && this.netSim) {
      if (!frozen) this.HostStep(dt);
    } else if (!host && this.local) {
      const st = this.states[this.states.length - 1];
      if (!frozen && st && !st.pz) {
        this.stepT -= dt;
        if (this.step === Step.Play) this.roundT += dt;
        const k = this.local;
        k.hold = this.step === Step.Play && k.flying && this.HumanHold(0);
        const wind = st ? new V2(st.wd[0], st.wd[1]) : V2.zero;
        if (k.state === KState.Fly) k.step(dt, wind, Canon, Time.time);
      }
    }
    this.Countdown();
    this.OnlineDisplay(dt);
    const bar = this.State === Phase.Playing && this.step !== Step.Over;
    if (this.barOn !== bar) {
      this.barOn = bar;
      if (this.portrait) this.overlay.place({ anchor: new V2(0.5, 0), pos: new V2(0, 90) }, { anchor: new V2(0.5, 1), pos: new V2(0, -330) });
      else this.overlay.place({ anchor: new V2(0, 0), pos: new V2(290, 70) }, { anchor: new V2(0.5, 1), pos: new V2(0, -260) });
      this.overlay.showBar(bar);
    }
  }

  /** Host: run the match one frame in the canonical sky. */
  private HostStep(dt: number) {
    const sim = this.netSim!, ks = sim.kites;
    this.stepT -= dt;
    ks[0].hold = this.step === Step.Play && ks[0].flying && this.HumanHold(0);
    if (this.step !== Step.Play) ks[1].hold = false;
    if (this.step === Step.Intro && this.stepT <= 0) this.step = Step.Play;
    if (this.step === Step.Play) {
      this.roundT += dt;
      sim.heat = this.roundT > HeatAt ? 1 + (this.roundT - HeatAt) / 6 : 1;
      if (this.roundT >= RoundTime) this.NetRoundWon(ks[0].pos.y >= ks[1].pos.y ? 0 : 1, true);
    }
    sim.step(dt);
    for (const e of sim.drainEvents()) {
      if (e.type === "cut") {
        const w = ks.indexOf(e.winner), l = ks.indexOf(e.loser);
        this.NetEvent({ e: "cut", w, k: l, x: e.at.x, y: e.at.y });
        this.NetRoundWon(w, false);
      } else if (e.type === "crash") {
        const l = ks.indexOf(e.kite);
        this.NetEvent({ e: "crash", k: l, x: e.kite.pos.x, y: e.kite.pos.y });
        this.NetRoundWon(1 - l, false);
      } else if (e.type === "bird") this.NetEvent({ e: "bird", k: ks.indexOf(e.kite), x: e.bird.pos.x, y: e.bird.pos.y });
      else if (e.type === "pickup") this.NetEvent({ e: "pick", k: ks.indexOf(e.kite), g: e.pickup.kind === PickKind.Glass ? 1 : 0, x: e.pickup.pos.x, y: e.pickup.pos.y });
      else if (e.type === "gust") this.NetEvent({ e: "gust", x: e.wind.x });
    }
    if (this.step === Step.Cut && this.stepT <= 0) {
      if (this.netWins[0] >= WinCuts || this.netWins[1] >= WinCuts) { this.step = Step.Over; this.NetEvent({ e: "end", sc: this.netWins.slice() }); this.OnlineResult(); }
      else this.StartNetRound();
    }
  }

  private NetRoundWon(w: number, timeUp: boolean) {
    if (this.step !== Step.Play) return;
    this.netWins[w]++;
    this.step = Step.Cut;
    this.stepT = 3.0;
    for (const k of this.netSim!.kites) k.hold = false;
    this.NetEvent({ e: "round", w, sc: this.netWins.slice(), tu: timeUp ? 1 : 0 });
  }

  /** Host: log an event for the guest (repeated in the next states) and play it here. */
  private NetEvent(ev: Omit<NetEvent, "i">) {
    const e = { ...ev, i: ++this.evId } as NetEvent;
    if (e.x !== undefined) e.x = Math.round(e.x * 100) / 100;
    if (e.y !== undefined) e.y = Math.round(e.y * 100) / 100;
    this.evLog.push(e);
    if (this.evLog.length > 5) this.evLog.shift();
    this.PlayNetEvent(e);
  }

  /** Both devices: sounds, effects and announcements for a match event (canonical seats). */
  private PlayNetEvent(e: NetEvent) {
    const mine = e.k === this.seat;
    const at = e.x !== undefined ? this.view.xy(e.x, e.y ?? 0) : V2.zero;
    const disp = (seat: number) => this.sky.kites[seat === this.seat ? 0 : 1];
    switch (e.e) {
      case "cut": {
        const loser = disp(e.k ?? 0);
        this.CutFx(at, loser, true);
        this.UI.Announce(Cheers[Math.floor(Math.random() * Cheers.length)], mine ? Bad : Gold, 1.0);
        if (mine) Sfx.playClip(this.lostClip, 0.6);
        break;
      }
      case "crash":
        this.fx.pop(at, Color.white, 12, 4, 0.18, 0.5);
        this.UI.Announce(mine ? "TANGLED ON THE ROOFS!" : "FRIEND TANGLED!", mine ? Bad : Gold, 1.2);
        Sfx.playClip(this.lostClip, 0.6);
        break;
      case "bird":
        Sfx.playClip(this.chirpClip, 0.7, 0.9 + Math.random() * 0.3);
        for (let i = 0; i < 8; i++) this.fx.emit(at, Random2().mul(2.5), Pal.hex(0x3a3050), 0.18, 0.9, CasualArt.Dot, 2, 300, true, 2);
        if (mine) { this.UI.Float(at.add(new V2(0, 1)), "WOBBLE!", Pal.hex(0xffe0a0), 0.8); if (this.local) this.local.wobbleT = 1.3; }
        break;
      case "pick": {
        const glass = e.g === 1;
        Sfx.playClip(this.chimeClip, 0.85);
        this.fx.sparkle(at, glass ? Pal.hex(0x9ff6ff) : Color.white, 14, 1.0, 0.45);
        this.UI.Float(at.add(new V2(0, 1.2)), (mine ? "" : "FRIEND: ") + (glass ? "GLASS STRING!" : "WIND BOOST!"), mine ? Pal.hex(0x9ff6ff) : Bad, 0.9);
        if (mine && this.local) { if (glass) this.local.glassT = 10; else this.local.boostT = 6; }
        break;
      }
      case "gust":
        Sfx.playClip(this.gustClip, 0.5);
        this.UI.Float(new V2(0, this.sky.arena.yMax - 1.5), `WIND SHIFT ${((e.x ?? 1) >= 0) === (this.seat === 0) ? "→" : "←"}`, Color.white, 0.8);
        break;
      case "round": {
        const sc = e.sc ?? this.netWins;
        const a = sc[this.seat], b = sc[1 - this.seat], won = e.w === this.seat;
        const done = Math.max(a, b) >= WinCuts;
        if (e.tu) this.UI.Announce("TIME! HIGHER KITE WINS", Gold, 1.6);
        if (!e.tu) { /* the cut already cheered */ } else { Sfx.playClip(this.cheerClip, 0.6); this.cheerT = 2; }
        const t = done ? (won ? "YOU WIN!" : "FRIEND WINS") : `YOU ${a} – ${b} FRIEND`;
        this.startCoroutine((function* (self: KiteClashGame) {
          let t0 = 0;
          while (t0 < 1.1) { t0 += Time.unscaledDeltaTime; yield; }
          self.UI.Announce(t, won ? Gold : Bad, 1.5);
        })(this));
        break;
      }
      case "end": break;
    }
  }

  private Countdown() {
    if (this.step !== Step.Intro) { if (this.countStep > 0 && this.step === Step.Play) { this.countStep = 0; this.UI.Announce(this.round <= 1 ? "FLY!" : `ROUND ${this.round}`, Coral, 0.9); Sfx.play(Snd.BeepHigh, 0.7); } return; }
    const n = Math.ceil(this.stepT / 0.8);
    if (n !== this.countStep && n >= 1 && n <= 3) { this.countStep = n; this.UI.Announce(String(n), Gold, 0.7); Sfx.play(Snd.Beep, 0.6); }
  }

  private UpdateDisplayWins() { this.roundWins = [this.netWins[this.seat], this.netWins[1 - this.seat]]; }

  /** Host: receive the guest's hold and predicted kite (accepted within a tolerance). */
  private OnGuestInput(m: InputMsg) {
    if (!this.link || m.m !== this.link.match || m.s <= this.lastIn || !this.netSim) return;
    this.lastIn = m.s;
    const k = this.netSim.kites[1];
    k.hold = !!m.h && this.step === Step.Play && k.flying;
    if (k.state !== KState.Fly) return;
    const p = new V2(m.x, m.y);
    if (V2.distance(p, k.pos) > 4) return; // too far from what the host simulates: keep the host's kite
    const A = Canon;
    k.pos = new V2(Mathf.clamp(p.x, A.xMin, A.xMax), Mathf.clamp(p.y, A.yMin, A.yMax));
    k.vel = V2.clampMagnitude(new V2(m.vx, m.vy), 14);
    k.ang = m.a; k.spin = Mathf.clamp01(m.sp);
  }

  /** Guest: a host state arrives. */
  private OnHostState(m: StateMsg) {
    if (!this.link || m.m !== this.link.match) return;
    if (this.State !== Phase.Playing && this.State !== Phase.Paused) {
      if (this.State === Phase.Over || m.st === Step.Over) return;
      return;
    }
    const now = performance.now();
    const sample = m.T - now;
    this.offsetEst = this.offsetEst < -1e8 ? sample : sample > this.offsetEst ? sample : this.offsetEst + (sample - this.offsetEst) * 0.02;
    const last = this.states[this.states.length - 1];
    if (last && m.T <= last.T) return;
    this.states.push(m);
    while (this.states.length > 30) this.states.shift();
    // match flow follows the host
    if (m.st !== this.step) { this.step = m.st as Step; }
    this.stepT = m.sT; this.roundT = m.rT; this.round = m.r;
    this.netWins = m.w.slice();
    this.netDesigns = m.d.slice();
    // the host may have missed my kite design (sent before it was listening): repeat it until it shows up
    if ((m.d[2] !== this.KiteSel || m.d[3] !== this.StrSel) && performance.now() - this.designT > 1000) { this.designT = performance.now(); this.SendDesign(); }
    if (this.states.length === 1) { for (const e of m.ev) this.lastEv = Math.max(this.lastEv, e.i); } // (re)joined: old news
    for (const e of m.ev) if (e.i > this.lastEv) { this.lastEv = e.i; this.PlayNetEvent(e); }
    // my own kite: predicted here; adopt the host's version on launches, cuts and big disagreements
    const k = this.local, hs = m.k[1];
    if (k) {
      k.anchor = CanonAnchor(1);
      if (k.state !== KState.Fly || hs.st !== KState.Fly || V2.distance(k.pos, new V2(hs.x, hs.y)) > 4) applySnap(k, hs);
      if (Math.abs(k.glassT - hs.gt) > 1.5) k.glassT = hs.gt;
      if (Math.abs(k.boostT - hs.bt) > 1.5) k.boostT = hs.bt;
      k.safeT = hs.sf ? 0.5 : 0;
    }
    if (m.st === Step.Over && !this.netEnded) { this.netEnded = true; this.UpdateDisplayWins(); this.OnlineResult(); }
  }

  /** Both devices: send state (host) or input (guest). Runs every frame, also while paused or on the result. */
  private NetPump(dt: number) {
    const link = this.link;
    if (!link || this.mode !== Mode.Online || !link.connected || link.match === 0) return;
    if (this.State !== Phase.Playing && this.State !== Phase.Paused && this.State !== Phase.Over) return;
    this.sendT -= dt;
    if (this.sendT > 0) return;
    if (link.isHost && this.netSim) {
      this.sendT = 1 / StateHz;
      const sim = this.netSim, r2 = (v: number) => Math.round(v * 100) / 100;
      const msg: StateMsg = {
        t: "ks", m: link.match, T: Math.round(performance.now()), st: this.step, sT: r2(this.stepT), rT: r2(this.roundT), w: this.netWins, r: this.round,
        wd: [r2(sim.wind.x), r2(sim.wind.y)], k: sim.kites.map((k) => snapKite(k)),
        b: sim.birds.filter((b) => b.active).map((b) => [r2(b.pos.x), r2(b.pos.y), r2(b.flap), b.vel.x < 0 ? 1 : 0]),
        p: sim.pickups.filter((p) => p.active).map((p) => [p.kind, r2(p.pos.x), r2(p.pos.y), r2(p.t), p.life]),
        c: sim.clashes.map((c) => [r2(c.point.x), r2(c.point.y), r2(c.meter), r2(c.net), c.crossing ? 1 : 0]),
        d: [sim.kites[0].design, sim.kites[0].stringColor, sim.kites[1].design, sim.kites[1].stringColor],
        ev: this.evLog, pz: this.mePaused || this.friendPaused ? 1 : 0,
      };
      link.room.send(msg);
      this.lastStateBytes = JSON.stringify(msg).length;
    } else if (!link.isHost && this.local && this.State === Phase.Playing) {
      this.sendT = 1 / InputHz;
      const k = this.local, r2 = (v: number) => Math.round(v * 100) / 100;
      link.room.send({ t: "kg", m: link.match, s: ++this.inSeq, h: k.hold ? 1 : 0, x: r2(k.pos.x), y: r2(k.pos.y), vx: r2(k.vel.x), vy: r2(k.vel.y), a: Math.round(k.ang * 10) / 10, sp: r2(k.spin) } satisfies InputMsg);
    }
  }

  /** Both devices: map the canonical match onto this screen (mirrored for the guest). */
  private OnlineDisplay(dt: number) {
    void dt;
    this.UpdateDisplayWins();
    const W2 = this.ViewSize.x / 2, f = this.portrait ? 0.55 : 0.6;
    const hands = [this.HandAt(-W2 * f, false), this.HandAt(W2 * f, true)];
    const d = this.sky.kites;
    if (d.length < 2) return;
    let ks: KSnap[] | null = null, wind = V2.zero;
    let birds: number[][] = [], picks: number[][] = [], clashes: number[][] = [];
    if (this.seat === 0 && this.netSim) {
      const sim = this.netSim;
      ks = sim.kites.map((k) => snapKite(k));
      wind = sim.wind;
      birds = sim.birds.filter((b) => b.active).map((b) => [b.pos.x, b.pos.y, b.flap, b.vel.x < 0 ? 1 : 0]);
      picks = sim.pickups.filter((p) => p.active).map((p) => [p.kind, p.pos.x, p.pos.y, p.t, p.life]);
      clashes = sim.clashes.map((c) => [c.point.x, c.point.y, c.meter, c.net, c.crossing ? 1 : 0]);
      d[1].design = sim.kites[1].design; d[1].stringColor = sim.kites[1].stringColor;
    } else if (this.states.length) {
      // the friend's kite and the sky: interpolated ~100 ms behind the host
      const renderT = performance.now() + this.offsetEst - 100;
      let a = this.states[0], b = a;
      for (let i = 0; i < this.states.length; i++) { if (this.states[i].T <= renderT) a = this.states[i]; if (this.states[i].T >= renderT) { b = this.states[i]; break; } b = this.states[i]; }
      const t = b.T > a.T ? Mathf.clamp01((renderT - a.T) / (b.T - a.T)) : 1;
      const k0 = lerpSnap(a.k[0], b.k[0], t);
      ks = [k0, this.local ? snapKite(this.local) : b.k[1]];
      wind = new V2(b.wd[0], b.wd[1]);
      birds = b.b.map((bb) => { const aa = a.b.find((x) => Math.abs(x[0] - bb[0]) < 1.5 && Math.abs(x[1] - bb[1]) < 1); return aa ? [aa[0] + (bb[0] - aa[0]) * t, aa[1] + (bb[1] - aa[1]) * t, bb[2], bb[3]] : bb; });
      picks = b.p; clashes = b.c;
      d[1].design = b.d[0]; d[1].stringColor = b.d[1];
    }
    if (!ks) return;
    for (let slot = 0; slot < 2; slot++) {
      const seat = slot === 0 ? this.seat : 1 - this.seat;
      this.ToDisplay(ks[seat], d[slot], hands[slot]);
    }
    const V = this.view;
    this.sky.wind = new V2(V.mx * wind.x, wind.y);
    this.sky.windTarget = this.sky.wind;
    this.sky.birds.forEach((bd, i) => {
      const s = birds[i];
      bd.active = !!s;
      if (!s) return;
      bd.pos = V.xy(s[0], s[1]); bd.flap = s[2]; bd.vel = new V2((s[3] ? -1 : 1) * V.mx, 0);
    });
    this.sky.pickups.forEach((pk, i) => {
      const s = picks[i];
      pk.active = !!s;
      if (!s) return;
      pk.kind = s[0] as PickKind; pk.pos = V.xy(s[1], s[2]); pk.t = s[3]; pk.life = s[4];
    });
    this.sky.clashes = clashes.map((c) => {
      const cl = new Clash(d[0], d[1]);
      cl.point = V.xy(c[0], c[1]);
      cl.meter = this.seat === 0 ? c[2] : -c[2];
      cl.net = c[3]; cl.crossing = c[4] === 1;
      return cl;
    });
  }

  private ToDisplay(s: KSnap, k: Kite, hand: V2) {
    const V = this.view;
    k.pos = V.xy(s.x, s.y); k.vel = V.v(new V2(s.vx, s.vy)); k.ang = V.ang(s.a);
    k.state = s.st as KState; k.hold = s.h === 1;
    k.glassT = s.gt; k.boostT = s.bt; k.safeT = s.sf ? 1 : 0; k.flash = s.fl; k.lowT = s.lt; k.cutT = s.ct;
    k.anchor = hand;
    const pts = V.pts(unflat(s.r));
    if (pts.length >= 2) { pts[0] = hand; k.rope.pts = pts; }
    if (s.lo) { const r = k.loose ?? new Rope(V2.zero, V2.up, 2); r.pts = V.pts(unflat(s.lo)); if (r.pts.length) r.pts[0] = hand; k.loose = r; } else k.loose = null;
    if (s.ta) { const r = k.tail ?? new Rope(V2.zero, V2.up, 2); r.pts = V.pts(unflat(s.ta)); k.tail = r; } else k.tail = null;
  }

  /** The friend left on purpose or never came back. */
  private FriendLeft() {
    const link = this.link;
    this.link = null;
    if (link && link.room.status !== "closed") link.room.close();
    if (this.mode === Mode.Online && this.State === Phase.Playing && this.step !== Step.Over) {
      if (this.netWins[0] + this.netWins[1] > 0 || this.roundT > 20) {
        // the match was underway: the player who stayed takes the win
        this.forfeit = true;
        this.overlay.hide();
        this.step = Step.Over;
        this.UI.Announce("YOUR FRIEND LEFT", Gold, 1.4);
        this.OnlineResult();
        return;
      }
      this.step = Step.Over;
      this.overlay.left("Your friend left", "The match had only just started, so there is no result.");
      return;
    }
    if (this.State === Phase.Over || this.overlay.state === "rematch") this.overlay.left("Your friend left", "No rematch this time.");
  }

  /** Leaving (menu, title): the friend is told and the room closes. */
  private LeaveTable() {
    if (this.link) { this.link.leave(); this.link = null; }
    this.netSim = null; this.local = null;
    this.overlay?.hide();
    this.overlay?.showBar(false);
    this.barOn = false;
  }

  private OnlineResult() {
    if (this.State !== Phase.Playing && this.State !== Phase.Paused) return;
    if (this.State === Phase.Paused) this.Resume();
    this.UpdateDisplayWins();
    const [a, b] = this.roundWins;
    const won = this.forfeit || a > b;
    const prize = won ? OnlinePrize : 10;
    this.coinsRun = prize;
    this.Data.add("coins", prize);
    if (won) this.Data.add("onlineWins", 1);
    this.Data.add("onlineGames", 1);
    this.overlay.showBar(false);
    this.barOn = false;
    this.doubled = false;
    const r = new Result({
      Headline: this.forfeit ? "FRIEND LEFT · YOU WIN!" : won ? "YOU WIN!" : "FRIEND WINS",
      HeadlineColor: won ? Gold : Pal.hex(0xffb0b8), Victory: won,
      Value: `${a} – ${b}`,
      BestLine: `YOU ${a} · FRIEND ${b}   ·   +${prize} COINS`,
      Stats: [["YOUR CUTS", String(a)], ["FRIEND'S CUTS", String(b)], ["MATCH", String(this.link?.match ?? 1)], ["COINS", `+${prize}  (◉${this.Coins})`]],
      Primary: this.link ? "REMATCH" : "NEW TABLE",
    });
    if (won) { r.Reward = () => this.DoubleCoins(); r.RewardLabel = `DOUBLE COINS: +${prize} MORE (WATCH AD)`; }
    this.lastResult = r;
    this.Finish(r);
  }

  // ------------------------------------------------------------------ input

  private ZoneOf(screen: V2) {
    if (this.mode !== Mode.TwoP) return 0;
    if (this.portrait) return screen.y < Screen.height / 2 ? 0 : 1;
    return screen.x < Screen.width / 2 ? 0 : 1;
  }

  private ReadInput() {
    for (const t of Touchscreen.touches) {
      this.usingTouch = true;
      const id = t.touchId;
      if (t.press.wasPressedThisFrame && !this.touchOwner.has(id) && !overUI(t.position)) this.touchOwner.set(id, this.ZoneOf(t.position));
      if (!t.press.isPressed || t.press.wasReleasedThisFrame) this.touchOwner.delete(id);
    }
    for (const id of [...this.touchOwner.keys()]) if (!Touchscreen.touches.some((t) => t.touchId === id)) this.touchOwner.delete(id);
    if (Mouse.present && !(this.usingTouch && Touchscreen.present)) {
      if (Mouse.leftButton.wasPressedThisFrame && !overUI(Mouse.position)) this.mouseOwner = this.ZoneOf(Mouse.position);
      if (!Mouse.leftButton.isPressed) this.mouseOwner = -1;
    }
  }

  private HumanHold(i: number) {
    if (i < 0) return false;
    for (const o of this.touchOwner.values()) if (o === i) return true;
    if (this.mouseOwner === i) return true;
    const K = Keyboard;
    if (this.mode === Mode.TwoP) {
      if (i === 0) return K.space.isPressed || K.letter("a").isPressed;
      return K.enter.isPressed || K.numpadEnter.isPressed || K.rightShift.isPressed || K.letter("l").isPressed;
    }
    return K.space.isPressed || K.letter("a").isPressed || K.enter.isPressed || K.up.isPressed || K.letter("w").isPressed || K.letter("l").isPressed || K.rightShift.isPressed;
  }

  // ------------------------------------------------------------------ results

  private EndSolo() {
    const daily = this.mode === Mode.Daily;
    const bonus = this.endReason === "time" ? this.lives * 150 : 0;
    const total = this.score + bonus;
    let newBest: boolean, bestLine: string;
    if (daily) {
      const d = todaySeed();
      if (this.Data.get("dDate") !== d) { this.Data.set("dDate", d); this.Data.set("dBest", 0); }
      newBest = this.Data.max("dBest", total);
      bestLine = `DAILY ${this.DailyLabel()}  ·  TODAY'S BEST ${Fmt.n(this.Data.get("dBest"))}`;
    } else {
      newBest = this.Data.max("best", total);
      bestLine = `BEST ${Fmt.n(this.Data.get("best"))}`;
    }
    const stars = total >= SoloStars[2] ? 3 : total >= SoloStars[1] ? 2 : total >= SoloStars[0] ? 1 : 0;
    this.coinsRun += stars * 10;
    this.starBonus = stars * 10;
    this.Data.add("coins", this.coinsRun);
    this.Data.add("cuts", this.cuts);
    this.Data.max("stars" + (daily ? "D" : "S"), stars);
    const r = new Result({
      Headline: `${Fmt.n(total)} POINTS`,
      HeadlineColor: Gold,
      Stars: stars,
      NewBest: newBest,
      BestLine: (this.endReason === "time" ? "FESTIVAL OVER  ·  " : "OUT OF STRING  ·  ") + bestLine,
      Stats: [["KITES CUT", String(this.cuts)], ["BEST COMBO", this.bestCombo > 1 ? "x" + this.bestCombo : "–"], ["STRINGS LEFT", bonus > 0 ? `${this.lives} (+${bonus})` : String(this.lives)], ["COINS", `+${this.coinsRun}  (◉${this.Coins})`]],
      Primary: "PLAY AGAIN",
      Victory: stars > 0,
    });
    if (this.endReason === "lives" && !this.revived && this.timeLeft > 3) {
      r.Reward = () => this.ReTie();
      r.RewardLabel = "RE-TIE YOUR STRING & CONTINUE (WATCH AD)";
    } else if (!this.doubled && this.coinsRun > 0) {
      r.Reward = () => this.DoubleCoins();
      r.RewardLabel = `DOUBLE COINS: +${this.coinsRun} MORE (WATCH AD)`;
    }
    this.lastResult = r;
    this.Finish(r);
  }

  private ReTie() {
    this.revived = true;
    // the coins of the first part were paid out: keep counting from here
    this.Data.add("coins", -this.coinsRun);
    this.coinsRun -= this.starBonus;
    this.lives = 1;
    this.step = Step.Play;
    this.endT = 0;
    this.LaunchHuman(true);
    this.Revive();
    this.UI.Announce("STRING RE-TIED!", Good, 1.3);
    Sfx.play(Snd.PowerUp, 0.8);
  }

  private DoubleCoins() {
    this.doubled = true;
    this.Data.add("coins", this.coinsRun);
    const r = this.lastResult!;
    const i = r.Stats.findIndex((s) => s[0] === "COINS");
    if (i >= 0) r.Stats[i] = ["COINS", `+${this.coinsRun * 2}  (◉${this.Coins})`];
    r.BestLine = "COINS DOUBLED!";
    r.Reward = null;
    Sfx.play(Snd.Coin, 0.8);
    this.UI.ShowResult(r);
  }

  private EndDuel() {
    const [a, b] = this.roundWins;
    if (this.mode === Mode.TwoP) {
      const w = a > b ? 0 : 1;
      this.Data.add("p" + w, 1);
      this.Finish(new Result({
        Headline: `PLAYER ${w + 1} WINS!`,
        HeadlineColor: w === 0 ? P1Col : P2Col,
        Value: `${a} – ${b}`,
        BestLine: `MATCHES  P1 ${this.Data.get("p0")} – ${this.Data.get("p1")} P2`,
        Stats: [["ROUNDS", String(this.round)], ["WINNER", `PLAYER ${w + 1}`]],
        Primary: "REMATCH",
        Victory: true,
      }));
      return;
    }
    const won = a > b, d = this.diff;
    if (won) { this.Data.add("w" + d, 1); this.Data.add("streak", 1); this.coinsRun += WinCoins[d]; }
    else { this.Data.add("l" + d, 1); this.Data.set("streak", 0); }
    this.Data.add("coins", this.coinsRun);
    const r = new Result({
      Headline: won ? "YOU WIN!" : "CPU WINS",
      HeadlineColor: won ? Gold : Pal.hex(0xffb0b8),
      Value: `${a} – ${b}`,
      BestLine: `VS CPU ${DiffNames[d]}  ·  ${this.Data.get("w" + d)} WON · ${this.Data.get("l" + d)} LOST`,
      Stats: [["CPU LEVEL", DiffNames[d]], ["ROUNDS", String(this.round)], ["WIN STREAK", String(this.Data.get("streak"))], ["COINS", `+${this.coinsRun}  (◉${this.Coins})`]],
      Primary: won ? "PLAY AGAIN" : "REMATCH",
      Victory: won,
    });
    if (won && this.coinsRun > 0) { r.Reward = () => this.DoubleCoins(); r.RewardLabel = `DOUBLE COINS: +${this.coinsRun} MORE (WATCH AD)`; }
    else if (!won && !this.glassStart) { r.Reward = () => this.GlassRematch(); r.RewardLabel = "GLASS STRING REMATCH (WATCH AD)"; }
    this.lastResult = r;
    this.Finish(r);
  }

  private GlassRematch() {
    this.pendingGlass = true;
    this.StartRun();
    this.UI.Toast("GLASS STRING: your string cuts much faster for the first 12 seconds of each round!", 3.5);
  }

  // ------------------------------------------------------------------ rendering

  private Render(dt: number) {
    const V = this.ViewSize, W2 = V.x / 2, t = Time.time, wind = this.sky.wind;
    // clouds drift with the wind
    for (const c of this.clouds) {
      c.x += (wind.x * c.speed + 0.05) * dt;
      if (c.x > W2 + c.w) c.x = -W2 - c.w;
      if (c.x < -W2 - c.w) c.x = W2 + c.w;
      c.sr.transform.localPosition = new V3(c.x, c.y, 0);
      c.sr.transform.localScale = new V3(c.w, c.w, 1);
    }
    // people
    this.cheerT = Math.max(0, this.cheerT - dt);
    for (const p of this.spectators) {
      if (!p.sr.gameObject.activeSelf) continue;
      p.cheer = Math.max(0, p.cheer - dt);
      const cheering = p.cheer > 0;
      const pose = cheering ? 2 : p.pose;
      p.sr.sprite = KiteArt.Person(pose, p.col);
      const hop = cheering ? Math.abs(Math.sin(t * 9 + p.seed * 5)) * 0.25 : Math.sin(t * 1.5 + p.seed) * 0.02;
      p.sr.flipX = p.flip;
      p.sr.transform.localPosition = new V3(p.feet.x, p.feet.y + 0.56 + hop, 0);
    }
    const ks = this.sky.kites;
    this.flyers.forEach((f, i) => {
      const k = ks[i];
      const on = !!k && k.state !== KState.Gone && f.sr.gameObject.activeSelf;
      if (!k || !on) { if (!k) f.sr.gameObject.setActive(false); return; }
      // flyers stand where their string starts
      f.feet = new V2(k.anchor.x - (k.anchor.x > this.FeetX(k) ? 0.28 : -0.28) * 0, k.anchor.y - 1.26);
      const flip = this.FlyerFlip(k);
      f.sr.flipX = flip;
      const tug = k.hold ? Math.sin(t * 30) * 0.03 : 0;
      f.sr.transform.localPosition = new V3(k.anchor.x + (flip ? 0.28 : -0.28), k.anchor.y - 1.26 + 0.675 + tug, 0);
      f.sr.sprite = KiteArt.Person(k.state === KState.Cut ? 1 : 0, f.col);
    });
    // bunting + streamers react to the wind
    for (const b of this.buntings) {
      if (!b.line.gameObject.activeSelf) continue;
      const pts: V2[] = [];
      for (let i = 0; i <= 8; i++) {
        const u = i / 8, sag = Math.sin(u * Math.PI) * (0.45 + 0.1 * Math.sin(t * 2 + b.a.x));
        pts.push(V2.lerp(b.a, b.b, u).add(new V2(wind.x * 0.05 * Math.sin(u * Math.PI), -sag)));
      }
      b.line.setPositions(pts);
      b.flags.forEach((f, i) => {
        const u = (i + 1) / (b.flags.length + 1), sag = Math.sin(u * Math.PI) * (0.45 + 0.1 * Math.sin(t * 2 + b.a.x));
        const p = V2.lerp(b.a, b.b, u).add(new V2(wind.x * 0.05 * Math.sin(u * Math.PI), -sag - 0.15));
        f.transform.localPosition = new V3(p.x, p.y, 0);
        f.transform.localEulerZ = Mathf.clamp(wind.x * 14, -35, 35) + Math.sin(t * 7 + i * 1.3 + b.a.x) * 10;
      });
    }
    for (const s of this.streamers) {
      if (!s.ribbon.gameObject.activeSelf) continue;
      const top = s.base.add(new V2(0, 1.5));
      const dir = wind.magnitude > 0.05 ? wind.normalized : V2.right;
      const len = 0.9 + wind.magnitude * 0.7;
      const pts: V2[] = [];
      for (let i = 0; i <= 6; i++) {
        const u = i / 6;
        const wave = Math.sin(t * 9 - u * 6 + s.seed) * 0.18 * u;
        pts.push(top.add(dir.mul(u * len)).add(V2.perpendicular(dir).mul(wave)).add(new V2(0, -u * u * 0.35 * (1.6 - wind.magnitude))));
      }
      s.ribbon.setPositions(pts);
    }
    // kites
    const human = new Set(this.humans);
    this.views.forEach((v, i) => {
      const k = ks[i];
      if (!k || k.state === KState.Gone) { this.HideView(v); return; }
      this.RenderKite(v, k, human.has(k), i);
    });
    // birds
    this.birdViews.forEach((sr, i) => {
      const b = this.sky.birds[i];
      const on = !!b && b.active;
      sr.gameObject.setActive(on);
      if (!on) return;
      sr.sprite = KiteArt.Bird(Math.sin(b.flap) > 0 ? 0 : 1);
      sr.flipX = b.vel.x < 0;
      sr.transform.localPosition = new V3(b.pos.x, b.pos.y, 0);
    });
    // pickups
    this.pickViews.forEach((pv, i) => {
      const p = this.sky.pickups[i];
      const on = !!p && p.active;
      pv.sr.gameObject.setActive(on); pv.glow.gameObject.setActive(on);
      if (!on) return;
      const glass = p.kind === PickKind.Glass;
      pv.sr.sprite = glass ? KiteArt.Glass() : KiteArt.Swirl();
      const fade = p.life - p.t < 2 ? (Math.sin(t * 20) > 0 ? 1 : 0.35) : 1;
      const pop = Math.min(1, p.t * 3);
      pv.sr.transform.localPosition = new V3(p.pos.x, p.pos.y, 0);
      pv.sr.transform.localScale = new V3(pop * 1.05, pop * 1.05, 1);
      pv.sr.transform.localEulerZ = glass ? Math.sin(t * 2) * 12 : -t * 200;
      pv.sr.color = Color.white.withAlpha(fade);
      pv.glow.transform.localPosition = new V3(p.pos.x, p.pos.y, 0);
      const gs = 2.2 + Math.sin(t * 5) * 0.25;
      pv.glow.transform.localScale = new V3(gs, gs, 1);
      pv.glow.color = (glass ? Pal.hex(0x6fe8ff) : Pal.hex(0xc8fff0)).withAlpha(0.55 * fade);
    });
    // tutorial helpers
    const tutGoal = this.State === Phase.Playing && this.tutStep === 2;
    this.goalRing.gameObject.setActive(tutGoal);
    if (tutGoal) {
      this.goalRing.transform.localPosition = new V3(this.tutGoal.x, this.tutGoal.y, 0);
      const s = 2.6 + Math.sin(t * 5) * 0.25;
      this.goalRing.transform.localScale = new V3(s, s, 1);
    }
    let guideAt: V2 | null = null, guideDir = V2.up;
    if (this.State === Phase.Playing && this.tutStep === 3) {
      const rival = ks.find((k) => k !== this.humans[0] && k.tethered);
      if (rival) {
        const mid = V2.lerp(rival.anchor, rival.pos, 0.6);
        guideDir = mid.sub(this.humans[0].pos).normalized;
        guideAt = mid.sub(guideDir.mul(1.4 + Math.sin(t * 6) * 0.3));
      }
    } else if (tutGoal) {
      guideDir = this.tutGoal.sub(this.humans[0].pos).normalized;
      guideAt = this.tutGoal.sub(guideDir.mul(2.1 + Math.sin(t * 6) * 0.3));
    }
    this.guide.gameObject.setActive(!!guideAt);
    if (guideAt) {
      this.guide.transform.localPosition = new V3(guideAt.x, guideAt.y, 0);
      this.guide.transform.localEulerZ = Math.atan2(guideDir.y, guideDir.x) * Mathf.Rad2Deg;
      this.guide.color = Gold;
    }
  }

  private FeetX(k: Kite) { return k.anchor.x; }
  private FlyerFlip(k: Kite) { return k.anchor.x > ((this.humans[0] && (this.mode === Mode.Solo || this.mode === Mode.Daily)) ? this.SoloAnchorX() + 0.5 : 0); }

  private RenderKite(v: KiteView, k: Kite, human: boolean, i: number) {
    const t = Time.time;
    const strCol = Strings[k.stringColor].color;
    const glint = Strings[k.stringColor].glint;
    // string
    const tethered = k.tethered;
    if (tethered) {
      v.rope.setPositions(smoothPts(k.rope.pts));
      v.rope.color = glint ? Color.lerp(strCol, Color.white, 0.25 + 0.25 * Math.sin(t * 8)) : strCol;
      v.rope.widthMultiplier = human ? 0.075 : 0.06;
    } else v.rope.positionCount = 0;
    const glass = tethered && k.glassT > 0;
    if (glass) {
      v.glass.setPositions(smoothPts(k.rope.pts, 2));
      v.glass.color = Pal.hex(0x9ff6ff).withAlpha(0.35 + 0.25 * Math.sin(t * 14 + i));
    } else v.glass.positionCount = 0;
    if (k.state === KState.Cut) {
      if (k.loose) { v.loose.setPositions(smoothPts(k.loose.pts)); v.loose.color = strCol.withAlpha(0.9); } else v.loose.positionCount = 0;
      if (k.tail) { v.cutTail.setPositions(smoothPts(k.tail.pts)); v.cutTail.color = strCol.withAlpha(Mathf.clamp01(2 - k.cutT * 0.35)); } else v.cutTail.positionCount = 0;
    } else { v.loose.positionCount = 0; v.cutTail.positionCount = 0; }
    // body
    const d = Designs[k.design];
    v.body.gameObject.setActive(true);
    v.body.sprite = KiteArt.Kite(k.design);
    const sway = k.state === KState.Fly && !k.hold ? Math.sin(t * 3 + i) * 4 : 0;
    const rot = k.ang - 90 + sway;
    v.body.transform.localPosition = new V3(k.pos.x, k.pos.y, 0);
    v.body.transform.localEulerZ = rot;
    const pulse = k.hold ? 1.04 : 1;
    const fade = k.state === KState.Cut ? Mathf.clamp01(1.4 - k.cutT * 0.22) : 1;
    v.body.transform.localScale = new V3(KiteSize * pulse, KiteSize * pulse, 1);
    v.body.color = Color.white.withAlpha(fade);
    // halo: glass / shield / champion / flash
    const champ = this.rivalType.get(k) === Rivals[2];
    let halo: Color | null = null;
    if (human && k.lowT > 0.5 && k.flying && !this.attract) {
      halo = Bad.withAlpha(0.35 + 0.35 * Math.sin(t * 14));
      if (k.lowT > 0.5 && k.lowT - Time.deltaTime <= 0.5) this.UI.Float(k.pos.add(new V2(0, 1.3)), "TOO LOW! PULL UP!", Bad, 0.8);
    } else if (k.flash > 0) halo = Color.white.withAlpha(k.flash * 1.2);
    else if (glass) halo = Pal.hex(0x6fe8ff).withAlpha(0.45 + 0.15 * Math.sin(t * 10));
    else if (k.safeT > 0 && tethered && !this.attract && this.tutStep < 0) halo = Color.white.withAlpha(0.3 + 0.25 * Math.sin(t * 12));
    else if (k.boostT > 0) halo = Pal.hex(0xc8fff0).withAlpha(0.4);
    else if (champ && tethered) halo = Gold.withAlpha(0.4);
    v.halo.gameObject.setActive(!!halo && k.state !== KState.Cut);
    if (halo) { v.halo.color = halo; v.halo.transform.localPosition = new V3(k.pos.x, k.pos.y, 0); }
    v.mark.gameObject.setActive(champ && tethered);
    if (champ) { v.mark.transform.localPosition = new V3(k.pos.x, k.pos.y + 1.3, 0); v.mark.transform.localEulerZ = t * 90; }
    // nose arrow for players
    const showArrow = human && k.state === KState.Fly && this.State === Phase.Playing;
    v.arrow.gameObject.setActive(showArrow);
    if (showArrow) {
      const dir = k.dir, big = this.tutStep >= 0 && this.tutStep <= 2;
      const dist = 1.25 + (k.hold ? 0.2 : 0) + (big ? Math.sin(t * 8) * 0.15 : 0);
      const p = k.pos.add(dir.mul(dist));
      v.arrow.transform.localPosition = new V3(p.x, p.y, 0);
      v.arrow.transform.localEulerZ = k.ang;
      const s = big ? 0.85 : 0.55;
      v.arrow.transform.localScale = new V3(s, s, 1);
      const col = this.mode === Mode.TwoP ? (this.humans.indexOf(k) === 0 ? P1Col : P2Col) : this.mode === Mode.Online ? (this.seat === 0 ? P1Col : P2Col) : Color.white;
      v.arrow.color = Color.lerp(col, Color.white, 0.35).withAlpha(k.hold ? 0.95 : 0.7);
    }
    // tail: a little chain hanging from the bottom tip
    const rr = rot * Mathf.Deg2Rad, tip = k.pos.add(new V2(Math.sin(rr) * 0.92 * pulse, -Math.cos(rr) * 0.92 * pulse));
    const pts = v.tailPts;
    pts[0] = tip;
    const g = new V2(this.sky.wind.x * 0.4, -1).normalized;
    for (let j = 1; j < pts.length; j++) {
      let p = pts[j].add(g.mul(0.06)).add(new V2(Math.sin(t * 8 + j + i) * 0.02, 0));
      const dd = p.sub(pts[j - 1]);
      p = pts[j - 1].add(dd.magnitude > 1e-4 ? dd.normalized.mul(0.2) : g.mul(0.2));
      pts[j] = p;
    }
    v.tail.setPositions(pts);
    v.tail.startColor = d.pattern === 7 ? Gold : d.c; v.tail.endColor = (d.pattern === 7 ? Gold : d.a).withAlpha(fade * 0.9);
    // boost trail
    if (k.boostT > 0 && k.hold && Math.random() < 0.6) this.fx.emit(k.pos, k.vel.mul(-0.2).add(Random2().mul(0.6)), Pal.hex(0xd8fff6), 0.22, 0.4, null, 0, 0, true, 2);
    // the flyer's spool spins while pulling
    void human;
  }

  private UpdateHud(dt: number) {
    const solo = this.mode === Mode.Solo || this.mode === Mode.Daily;
    const me = this.humans[0];
    if (solo) {
      set(this.scoreText, Fmt.n(this.score));
      set(this.timerText, this.tutStep >= 0 ? "PRACTICE" : Fmt.clock(Math.ceil(this.timeLeft)));
      this.timerText.color = this.timeLeft <= 10 && this.tutStep < 0 ? Color.lerp(Color.white, Bad, 0.5 + 0.5 * Math.sin(Time.time * 10)) : Color.white;
      this.timerText.fontSize = this.tutStep >= 0 ? 44 : 64;
      set(this.comboText, this.combo > 1 && this.comboT > 0 ? `COMBO x${this.combo}` : "");
      this.lifeIcons.forEach((im, i) => {
        im.sprite = KiteArt.Kite(this.KiteSel);
        im.color = i < this.lives ? Color.white : new Color(0.55, 0.55, 0.7, 0.4);
      });
      set(this.glassBadge, me && me.glassT > 0 ? `GLASS STRING ${Math.ceil(me.glassT)}` : me && me.boostT > 0 ? `WIND BOOST ${Math.ceil(me.boostT)}` : "");
    } else {
      const ks = this.sky.kites;
      const online = this.mode === Mode.Online;
      const names = this.mode === Mode.TwoP ? ["PLAYER 1", "PLAYER 2"] : online ? ["YOU", "FRIEND"] : ["YOU", "CPU " + DiffNames[this.diff]];
      const left = Math.max(0, RoundTime - this.roundT);
      const seatCol = (i: number) => (online ? ((i === 0) === (this.seat === 0) ? 0 : 1) : i);
      this.panels.forEach((p, i) => {
        set(p.name, names[i]);
        p.name.color = seatCol(i) === 0 ? Pal.hex(0x9cc4ff) : Pal.hex(0xffa6a8);
        p.pips.forEach((im, k) => {
          im.sprite = KiteArt.Kite(ks[i]?.design ?? 0);
          im.color = k < this.roundWins[i] ? Color.white : new Color(0.55, 0.55, 0.7, 0.45);
        });
        set(p.timer, Fmt.clock(Math.ceil(left)));
      });
      set(this.centerTimer, Fmt.clock(Math.ceil(left)));
      this.centerTimer.color = left < 10 ? Bad : Color.white;
      const g = ks[0] && ks[0].glassT > 0 && this.mode === Mode.Vs ? `GLASS STRING ${Math.ceil(ks[0].glassT)}` : "";
      set(this.glassBadge, g);
      this.glassBadge.rectTransform.place(new V2(0.5, 1), new V2(0, -170), new V2(500, 44));
    }
    // wind
    const w = this.sky.wind;
    this.windArrow.rectTransform.localEulerAngles = new V3(0, 0, Math.atan2(w.y, w.x) * Mathf.Rad2Deg);
    const ws = 0.75 + w.magnitude * 0.3;
    this.windArrow.rectTransform.localScale = new V3(ws, ws, 1);
    set(this.windLabel, w.magnitude > 1.35 ? "GUSTY" : "WIND");
    // saw meters at the crossings
    let mi = 0;
    for (const c of this.sky.clashes) {
      if (mi >= this.meters.length) break;
      if (!c.crossing && Math.abs(c.meter) < 0.02) continue;
      this.PlaceMeter(this.meters[mi++], c);
    }
    for (; mi < this.meters.length; mi++) this.meters[mi].node.setActive(false);
    void dt;
  }

  private PlaceMeter(m: MeterV, c: Clash) {
    m.node.setActive(true);
    const pos = this.UI.WorldToHud(c.point.add(new V2(0, 0.95)));
    m.node.place(UIKit.Center, pos, new V2(190, 30));
    // two players: P1 colour fills from the left, P2 from the right; otherwise green = you are winning
    const ks = this.sky.kites;
    const leftKite = this.humans[0] ?? ks[0];
    const edge = c.has(leftKite) ? c.edgeFor(leftKite) : c.meter;
    const k = Mathf.clamp01(Math.abs(edge));
    const f = m.fill.rectTransform;
    if (edge >= 0) { f.anchorMin = new V2(0.5, 0); f.anchorMax = new V2(0.5 + 0.5 * k, 1); }
    else { f.anchorMin = new V2(0.5 - 0.5 * k, 0); f.anchorMax = new V2(0.5, 1); }
    f.offsetMin = new V2(edge >= 0 ? 0 : 4, 4); f.offsetMax = new V2(edge >= 0 ? -4 : 0, -4);
    m.fill.enabled = k > 0.02;
    const twoP = this.mode === Mode.TwoP;
    const col = twoP ? (edge >= 0 ? P1Col : P2Col) : this.humans.length && c.has(this.humans[0]) ? (edge >= 0 ? Good : Bad) : Gold;
    m.fill.color = col.withAlpha(k > 0.7 ? 0.75 + 0.25 * Math.sin(Time.time * 30) : 1);
    m.spark.rectTransform.localEulerAngles = new V3(0, 0, Time.time * 400);
    const ss = c.crossing ? 0.8 + Math.abs(c.net) * 0.8 : 0.5;
    m.spark.rectTransform.localScale = new V3(ss, ss, 1);
    m.spark.color = c.crossing ? Color.white : new Color(1, 1, 1, 0.3);
    m.node.localEulerAngles = new V3(0, 0, 0);
    // sparks fly at the crossing while sawing
    if (c.crossing && Math.abs(c.net) > 0.05 && Math.random() < 0.7) {
      this.fx.emit(c.point, Random2().mul(2 + Math.abs(c.net) * 3), Math.random() < 0.5 ? Gold : Color.white, 0.12, 0.3, null, 3, 0, true, 2);
    }
  }

  private UpdateLoops(playing: boolean) {
    const w = this.windLoop, z = this.zipLoop, s = this.sawLoop;
    if (w) { w.volume = (playing ? 0.16 : 0.08) + this.sky.windStrength * (playing ? 0.08 : 0.04); w.pitch = 0.85 + this.sky.windStrength * 0.12; }
    let pull = 0;
    if (playing) for (const h of this.humans) if (h.hold && h.flying) pull = Math.max(pull, Mathf.clamp01(h.vel.magnitude / 8));
    if (z) { z.volume = Mathf.moveTowards(z.volume, pull * 0.22, Time.unscaledDeltaTime * 3); z.pitch = 0.8 + pull * 0.5; }
    let saw = 0;
    if (playing) for (const c of this.sky.clashes) if (c.crossing) saw = Math.max(saw, 0.08 + Math.abs(c.net) * 0.5);
    if (s) { s.volume = Mathf.moveTowards(s.volume, Math.min(0.45, saw), Time.unscaledDeltaTime * 4); s.pitch = 0.9 + Math.min(0.6, saw); }
    if (this.State === Phase.Paused || AdService.isShowing) { if (z) z.volume = 0; if (s) s.volume = 0; }
  }

  /** Test hook for scripted play (window.__G().debugInfo): kite positions in CSS pixels. */
  get debugInfo() {
    const toCss = (p: V2) => { const sp = Camera.worldToScreen(p); return { x: sp.x / Screen.dpr, y: sp.y / Screen.dpr }; };
    return {
      state: this.State, mode: this.mode, step: this.step, tut: this.tutStep, score: this.score, lives: this.lives, timeLeft: this.timeLeft,
      wins: this.roundWins, round: this.round, cuts: this.cuts, roundT: this.roundT, rewarded: AdService.rewardedAvailable, coins: this.Coins,
      portrait: this.portrait, arena: this.sky.arena, goal: this.tutGoal,
      kites: this.sky.kites.map((k) => ({ id: k.id, x: k.pos.x, y: k.pos.y, ang: k.ang, spinDir: k.spinDir, state: k.state, hold: k.hold, human: this.humans.includes(k), ax: k.anchor.x, ay: k.anchor.y, css: toCss(k.pos), vx: k.vel.x, vy: k.vel.y })),
      clashes: this.sky.clashes.map((c) => ({ a: c.a.id, b: c.b.id, meter: c.meter, crossing: c.crossing, x: c.point.x, y: c.point.y })),
      net: this.link || this.mode === Mode.Online ? {
        seat: this.seat, wins: this.netWins, st: this.step, round: this.round, roundT: this.roundT, status: this.link?.room.status ?? "none", match: this.link?.match ?? 0,
        code: this.link?.room.code ?? "", overlay: this.overlay.state, bytes: this.lastStateBytes,
        canon: this.netSim ? this.netSim.kites.map((k) => ({ x: k.pos.x, y: k.pos.y, st: k.state })) : this.states.length ? this.states[this.states.length - 1].k.map((k) => ({ x: k.x, y: k.y, st: k.st })) : [],
        local: this.local ? { x: this.local.pos.x, y: this.local.pos.y, st: this.local.state } : null,
      } : null,
    };
  }
}

/** Catmull-Rom resample so a verlet string with few points draws as a smooth curve. */
function smoothPts(p: V2[], sub = 3): V2[] {
  if (p.length < 3) return p;
  const out: V2[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      out.push(new V2(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)));
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

function Random2() { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()); return new V2(Math.cos(a) * r, Math.sin(a) * r); }
