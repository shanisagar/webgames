import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject,
  howTo, Image, Keyboard, LineRenderer, LoopSource, Mathf, Mouse, overUI, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer,
  Text, TextAnchor, Time, Touchscreen, TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import {
  ArenaFar, ArenaNear, ArrowHead, BlurSprite, ChalkSprite, ChipSprite, CoinIcon, FallenSprite, FarSize, GuideDot, MarbleSprite,
  NearSize, OwnerRing, Paints, PencilSprite, ScuffSprite, ShineSprite, SneakerSprite, SparkSprite, StartMark, TopIcon, TopSprite,
} from "./TopArt";
import {
  Arenas, arenasUnlocked, Bot, BotLevels, dayNumber, Designs, Ev, LaunchPlan, makeDaily, makeStage, Out, R, Rng, Sim, StageSpec,
  TopEvent,
} from "./TopPhysics";

/**
 * TOP RUMBLE: the wooden spinning tops of the school yard as a physics battle. Pull back from your start mark (like
 * pulling the string) to aim and set the power, let go to throw: more power = more spin. The top then drifts and
 * curls on its own; drag on your side to nudge it (costs a little spin and nudge energy). Faster-spinning, harder
 * tops knock others away and drain their spin; a top that leaves the ring or stops spinning is out. Last top
 * spinning wins. SOLO School Yard Tour (endless generated ladder of rivals with stars) and a DAILY seeded line-up,
 * VS CPU best of 3 (easy / medium / hard) and 2 PLAYERS on one device (both launch and nudge at once). Coins buy
 * new tops and paints in the Top Shop.
 */

const Ink = Pal.hex(0x2a1a10), Cream = Pal.hex(0xfff3dc), Gold = Pal.hex(0xffc93c), Red = Pal.hex(0xff5a4e);
const Sky = Pal.hex(0x38c8ff), Pink = Pal.hex(0xff4f9a), Orange = Pal.hex(0xffa020), Green = Pal.hex(0x7ee04a);
const OwnerCols = [Sky, Pink, Orange, Green];
enum Mode { Solo, Daily, Cpu, Duo }
const ModeNames = ["SOLO TOUR", "DAILY", "VS CPU", "2 PLAYERS"];
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const CpuNames = ["PIP", "ZARA", "RUFUS"];
const Prizes = [60, 120, 220];
const AimTime = 12;
const PullMin = 0.45, PullFull = 5.6;

enum Step { Intro, Aim, Rip, Battle, RoundOver, Wait }

interface Player { name: string; human: boolean; slot: number; design: number; paint: number; boost: number; bot: Bot | null; color: Color }

class TopView {
  root!: GameObject; owner!: SpriteRenderer; shadow!: SpriteRenderer; blur!: SpriteRenderer; body!: SpriteRenderer;
  shine!: SpriteRenderer; fallen!: SpriteRenderer; mark!: SpriteRenderer;
  ang = 0; fallT = -1; fallAng = 0; pop = 0; scuffT = 0; key = "";
}

/** One human's pointer / keyboard state. */
class Slot {
  touch = -2; // -2 none, -1 mouse, else touch id
  start = V2.zero; cur = V2.zero;
  aim = new V2(0, 1); power = 0.7;
  locked = false; plan: LaunchPlan | null = null;
  dragging = false;
  keyAim = false;
  stickBase!: Image; stickKnob!: Image;
  reset() { this.touch = -2; this.dragging = false; this.locked = false; this.plan = null; this.keyAim = false; }
}

interface Card { root: UINode; glow: Image; name: Text; spin: Image; spinBg: UINode; energy: Image; energyBg: UINode; pips: Image[]; icon: Image; out: Text }

const hashNoise = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };

export class TopRumbleGame extends ArcadeGame {
  private world!: GameObject; private arenaRoot!: GameObject;
  private far!: SpriteRenderer; private near!: SpriteRenderer;
  private decor: SpriteRenderer[] = [];
  private views: TopView[] = [];
  private scuffs: { sr: SpriteRenderer; t: number }[] = []; private scuffNext = 0;
  private guideDots: SpriteRenderer[][] = []; private arrows: SpriteRenderer[] = []; private strings: LineRenderer[] = [];
  private fx!: CasualFx;
  private sim = new Sim();
  private players: Player[] = [];
  private slots = [new Slot(), new Slot()];
  private mode = Mode.Cpu; private diff = 1; private arenaIdx = 0;
  private stage: StageSpec | null = null;
  private step = Step.Wait; private timer = 0; private aimClock = AimTime;
  private round = 0; private wins = [0, 0];
  private revived = false; private powerMatch = false;
  private planned: boolean[] = []; private cpuLockAt: number[] = [];
  private scale = 1; private rot = 0; private portrait = true;
  private layoutFrames = 3;
  private attractT = 0; private attractBots: Bot[] = [];
  private builtArena = -1;
  private soundsThisFrame = 0;
  private lastOut = "";
  private matchStats = { hits: 0, bestHit: 0, rings: 0 };
  private roundWinner = -1;

  // HUD
  private cards: Card[] = [];
  private infoText!: Text; private aimText: Text[] = [];
  private powerText: Text[] = [];
  private modeButtons: ArcadeButton[] = []; private opt1!: ArcadeButton; private opt2!: ArcadeButton; private shopButton!: ArcadeButton;
  private optInfo!: Text;
  // shop
  private shop!: UINode; private shopTop!: Image; private shopName!: Text; private shopBlurb!: Text; private shopCoins!: Text;
  private shopStats: Image[] = []; private shopAction!: ArcadeButton; private paintName!: Text; private paintAction!: ArcadeButton;
  private browseDesign = 0; private browsePaint = 0; private shopClock = 0;

  // sounds
  private zip!: AudioClip; private clack: AudioClip[] = []; private clang!: AudioClip; private clatter!: AudioClip; private ooh!: AudioClip;
  private thud!: AudioClip; private humClip!: AudioClip; private hums: LoopSource[] = [];

  protected Describe() {
    return new GameInfo({
      Id: "toprumble",
      Title: "TOP RUMBLE",
      Tagline: "PULL THE STRING. LAST TOP SPINNING WINS.",
      PlayLabel: "PLAY",
      Accent: Orange,
      Accent2: Gold,
      BgTop: Pal.hex(0x6a5a40),
      BgBottom: Pal.hex(0x3a2e20),
      ShortSide: 24,
      Touch: TouchScheme.None,
      Music: { bpm: 112, rootHz: 196, degrees: [0, 5, 3, 4], seed: 77, energy: 0.35, major: true },
      Reminders: [
        "The chalk ring is drawn|Who has the last top spinning?",
        "A new rival in the school yard|Climb the tour and earn stars.",
        "Today's daily rumble is ready|Beat the line-up for bonus coins.",
      ],
      HowTo: [
        howTo(TopIcon(), Color.white, "PULL BACK from your start mark and let go to throw your top. More pull = more speed AND more spin."),
        howTo(Art.Chevron, Orange, "Watch the guide arc: too hard and you fly out of the ring!"),
        howTo(Art.Ring, Sky, "NUDGE: drag on your side (or arrows / WASD) to tilt your top. It costs a little spin."),
        howTo(Art.Star, Gold, "Faster-spinning tops hit harder and drain spin from the others."),
        howTo(Art.Disc, Red, "Out of the ring, or out of spin (it wobbles and topples) = OUT. Last top spinning wins."),
        howTo(CoinIcon(), Color.white, "Win coins and buy new tops and paints in the TOP SHOP."),
      ],
      Tips: [
        "Hit them from the middle side: the knock sends them towards the edge.",
        "A full-power throw spins longest, but aim it so you don't fly out.",
        "Low on spin? Dodge sideways and let the others crash.",
        "WHIRL outlasts everyone; STINGER hits like a truck.",
        "Save some nudge for when you're near the chalk line.",
      ],
    });
  }

  // ------------------------------------------------------------------ data

  private get Coins() { return this.Data.get("coins", 150); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }
  private get StageN() { return Math.max(1, this.Data.get("stage", 1)); }
  private get TotalStars() { return this.Data.get("stars"); }
  private Owns(d: number) { return d === 0 || this.Data.get("own" + d) === 1; }
  private OwnsPaint(p: number) { return p === 0 || this.Data.get("pnt" + p) === 1; }
  private get Equipped() { return Mathf.clamp(this.Data.get("top"), 0, Designs.length - 1); }
  private get EquippedPaint() { return Mathf.clamp(this.Data.get("paint"), 0, Paints.length - 1); }
  private get Today() { return dayNumber(); }

  protected BestLine() {
    const m = this.SelectedMode;
    const c = `COINS ${Fmt.n(this.Coins)}`;
    if (m === Mode.Solo) return `${c}   ·   STAGE ${this.StageN}   ·   ★ ${this.TotalStars}`;
    if (m === Mode.Daily) return `${c}   ·   ${this.Data.get("dday") === this.Today ? "TODAY: BEATEN ✓" : "TODAY: +150 BONUS"}`;
    if (m === Mode.Cpu) return `${c}   ·   WINS ${this.Data.get("wins")}`;
    return `${c}   ·   DUELS ${this.Data.get("duels")}`;
  }
  protected StatsLine() { return ""; }
  private get SelectedMode(): Mode { return Mathf.clamp(this.Data.get("mode", 0), 0, 3) as Mode; }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (this.Data.get("init") === 0) { this.Data.set("init", 1); this.Coins = 150; this.Data.set("stage", 1); this.Data.set("diff", 1); }
    CasualLook.calm(this, 1.3, 0.22);
    this.world = new GameObject("TopWorld", this.gameObject);
    this.arenaRoot = new GameObject("Arena", this.world);
    this.far = Art.spr(this.arenaRoot, "Far", ArenaFar(0), Color.white, FarSize, -900, Art.Flat);
    this.near = Art.spr(this.arenaRoot, "Near", ArenaNear(0), Color.white, NearSize, -890, Art.Flat);
    this.builtArena = -1;
    for (let i = 0; i < 16; i++) this.decor.push(Art.spr(this.arenaRoot, "Decor", SneakerSprite(0), Color.white, 1, -870, Art.Flat));
    for (let i = 0; i < 70; i++) {
      const sr = Art.spr(this.arenaRoot, "Scuff", ScuffSprite(), Color.clear, 1, -880, Art.Flat);
      this.scuffs.push({ sr, t: 0 });
    }
    for (let i = 0; i < 4; i++) this.views.push(this.MakeView());
    for (let h = 0; h < 2; h++) {
      const dots: SpriteRenderer[] = [];
      for (let k = 0; k < 16; k++) dots.push(Art.spr(this.arenaRoot, "Dot", GuideDot(), Color.clear, 0.32, 40, Art.Flat));
      this.guideDots.push(dots);
      this.arrows.push(Art.spr(this.arenaRoot, "Arrow", ArrowHead(), Color.clear, 0.9, 41, Art.Flat));
      this.strings.push(Art.line(this.arenaRoot, "String", Cream, 0.08, 39, false, false, Art.Flat));
    }
    this.fx = CasualFx.create(this.arenaRoot, 60, 260);
    this.BuildHud();
    this.BuildTitle();
    this.BuildSounds();
    this.ApplyArena(0);
    this.Layout();
    if (import.meta.env.DEV) { const w = window as unknown as Record<string, unknown>; w.__tr = { game: this, makeStage, makeDaily }; w.__trArt = { SparkSprite, ChipSprite, Glow: () => CasualArt.Soft }; }
  }

  private MakeView() {
    const v = new TopView();
    v.mark = Art.spr(this.arenaRoot, "Mark", StartMark(), Color.clear, 2.4, -860, Art.Flat);
    v.root = new GameObject("Top", this.arenaRoot);
    v.owner = Art.spr(v.root, "Owner", OwnerRing(), Color.clear, 2.6, 10, Art.Flat);
    v.shadow = Art.spr(v.root, "Shadow", CasualArt.Soft, new Color(0, 0, 0, 0.4), 2.6, 11, Art.Flat);
    v.fallen = Art.spr(v.root, "Fallen", FallenSprite(0, 0), Color.clear, 2.3, 12, Art.Flat);
    v.blur = Art.spr(v.root, "Blur", BlurSprite(0, 0), Color.white, 2, 13, Art.Flat);
    v.body = Art.spr(v.root, "Body", TopSprite(0, 0), Color.white, 2, 14, Art.Flat);
    v.shine = Art.spr(v.root, "Shine", ShineSprite(), Color.white, 2, 15, Art.Flat);
    return v;
  }

  private BuildSounds() {
    const N = (t: number, k = 0) => hashNoise(Math.trunc(t * 44100) + k);
    this.zip = Sfx.make("tr-zip", 0.5, (t) => {
      const f = Sfx.glide(t, 220, 1100, 0.32);
      const rattle = 0.6 + 0.4 * Sfx.sqrP(70 * t);
      return (Sfx.sawP(f) * 0.25 + N(t, 5) * 0.55 * rattle) * Sfx.env(t, 0.008, 0.3) * 0.75;
    });
    for (let k = 0; k < 3; k++) {
      const f1 = 820 + k * 170, f2 = 1460 + k * 230;
      this.clack.push(Sfx.make("tr-clack" + k, 0.12, (t) => (Sfx.sinP(f1 * t) * 0.55 + Sfx.sinP(f2 * t) * 0.3 + N(t, k * 99) * 0.5 * Sfx.env(t, 0, 0.006)) * Sfx.env(t, 0.0005, 0.04) * 0.8));
    }
    this.clang = Sfx.make("tr-clang", 0.4, (t) => (Sfx.sinP(2650 * t) * 0.4 + Sfx.sinP(3920 * t) * 0.25 + Sfx.sinP(1210 * t) * 0.3 + N(t, 7) * 0.4 * Sfx.env(t, 0, 0.01)) * Sfx.env(t, 0.0005, 0.16) * 0.7);
    const knocks: [number, number][] = [];
    { let tt = 0, gap = 0.13, a = 1; for (let i = 0; i < 9; i++) { knocks.push([tt, a]); tt += gap; gap *= 0.78; a *= 0.8; } }
    this.clatter = Sfx.make("tr-clatter", 1, (t) => {
      let v = 0;
      for (const [k0, a] of knocks) { const d = t - k0; if (d < 0 || d > 0.08) continue; v += (Sfx.sinP(760 * d) * 0.5 + Sfx.sinP(1330 * d) * 0.3 + N(t, 3) * 0.4 * Sfx.env(d, 0, 0.005)) * Sfx.env(d, 0.0005, 0.03) * a; }
      v += N(t, 11) * 0.12 * Sfx.env(t - 0.55, 0.05, 0.25) * (t > 0.5 ? 1 : 0);
      return v * 0.8;
    });
    let lp = 0;
    this.ooh = Sfx.make("tr-ooh", 1.5, (t) => {
      let v = 0;
      for (let i = 0; i < 6; i++) { const f = Sfx.glide(t, 230 + i * 23, 170 + i * 19, 1.2); v += Sfx.sawP(f + i * 0.37) * 0.16; }
      v += N(t, 21) * 0.15;
      lp += (v - lp) * 0.08;
      return lp * Sfx.env(t, 0.18, 1.0) * 1.6;
    });
    this.thud = Sfx.make("tr-thud", 0.22, (t) => (Sfx.sinP(Sfx.glide(t, 150, 70, 0.1)) * 0.8 + N(t, 13) * 0.3 * Sfx.env(t, 0, 0.02)) * Sfx.env(t, 0.002, 0.1) * 0.8);
    this.humClip = Sfx.make("tr-hum", 1, (t) => (Sfx.sinP(110 * t) * 0.45 + Sfx.sinP(220 * t) * 0.22 + Sfx.triP(330 * t) * 0.12 + Sfx.sawP(55 * t) * 0.06) * (0.72 + 0.28 * Sfx.sinP(8 * t)) * 0.55);
  }

  // ------------------------------------------------------------------ HUD

  private BuildHud() {
    const hud = this.UI.Hud;
    for (let i = 0; i < 4; i++) this.cards.push(this.MakeCard(hud, i));
    this.infoText = UIKit.at(UIKit.label(hud, "", 30, Cream), new V2(0.5, 1), new V2(0, -60), new V2(620, 44));
    UIKit.glow(this.infoText, Ink, 3);
    CasualLook.fit(this.infoText, 18);
    for (let h = 0; h < 2; h++) {
      const t = UIKit.at(UIKit.label(hud, "", 38, Color.white), UIKit.Center, V2.zero, new V2(760, 60));
      UIKit.glow(t, Ink, 4);
      this.aimText.push(t);
      const p = UIKit.at(UIKit.label(hud, "", 34, Color.white), UIKit.Center, V2.zero, new V2(220, 50));
      UIKit.glow(p, Ink, 4);
      this.powerText.push(p);
      const s = this.slots[h];
      s.stickBase = UIKit.img(hud, "StickBase", Art.UiRing, OwnerCols[h].withAlpha(0));
      s.stickBase.rectTransform.place(UIKit.Center, V2.zero, new V2(220, 220));
      s.stickKnob = UIKit.img(hud, "StickKnob", Art.UiCircle, OwnerCols[h].withAlpha(0));
      s.stickKnob.rectTransform.place(UIKit.Center, V2.zero, new V2(90, 90));
    }
  }

  private MakeCard(hud: UINode, i: number): Card {
    const root = UIKit.node("Card" + i, hud).place(new V2(0, 1), new V2(220, -80), new V2(400, 120));
    const glow = UIKit.img(root, "Glow", Art.Glow, OwnerCols[i].withAlpha(0));
    glow.rectTransform.stretch(-50);
    UIKit.img(root, "Bg", Art.UiRound, new Color(0.12, 0.08, 0.05, 0.82)).rectTransform.stretch();
    UIKit.img(root, "Edge", Art.UiOutline, OwnerCols[i].withAlpha(0.6)).rectTransform.stretch();
    const icon = UIKit.img(root, "Icon", TopSprite(0, 0), Color.white);
    icon.rectTransform.place(new V2(0, 0.5), new V2(60, 0), new V2(84, 84));
    const name = UIKit.at(UIKit.label(root, "", 30, Color.white, TextAnchor.MiddleLeft), new V2(0, 1), new V2(225, -30), new V2(200, 40));
    CasualLook.fit(name, 18);
    const [spinBg, spin] = UIKit.meter(root, new V2(0, 0), new V2(250, 48), new V2(250, 26), OwnerCols[i]);
    const [energyBg, energy] = UIKit.meter(root, new V2(0, 0), new V2(250, 20), new V2(250, 14), Cream.withAlpha(0.85));
    const pips: Image[] = [];
    for (let k = 0; k < 2; k++) {
      const pip = UIKit.img(root, "Pip", Art.Star, new Color(1, 1, 1, 0.2));
      pip.rectTransform.place(new V2(1, 1), new V2(-58 + k * 34, -30), new V2(32, 32));
      pips.push(pip);
    }
    const out = UIKit.at(UIKit.label(root, "", 30, Red), new V2(0, 0), new V2(250, 36), new V2(260, 44));
    UIKit.glow(out, Ink, 4);
    return { root, glow, name, spin, spinBg, energy, energyBg, pips, icon, out };
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    CasualLook.titleCard(this.UI, new Color(0.16, 0.1, 0.05, 0.6), new V2(1060, 1060), -10);
    const accents = [Orange, Gold, Sky, Pink];
    for (let i = 0; i < 4; i++) {
      const idx = i;
      const b = UIKit.buttonAt(ex, ModeNames[i], UIKit.Center, new V2((i - 1.5) * 245, 10), new V2(232, 96), false, () => this.PickMode(idx), 28);
      b.setAccent(accents[i]);
      this.modeButtons.push(b);
    }
    this.opt1 = UIKit.buttonAt(ex, "CPU", UIKit.Center, new V2(-330, -100), new V2(320, 88), false, () => this.CycleOpt(1), 26);
    this.opt2 = UIKit.buttonAt(ex, "ARENA", UIKit.Center, new V2(0, -100), new V2(320, 88), false, () => this.CycleOpt(2), 26);
    this.shopButton = UIKit.buttonAt(ex, "TOP SHOP", UIKit.Center, new V2(330, -100), new V2(320, 88), false, () => this.OpenShop(true), 28);
    this.shopButton.setAccent(Gold);
    this.optInfo = UIKit.at(UIKit.label(ex, "", 28, Cream), UIKit.Center, new V2(-165, -100), new V2(650, 88));
    CasualLook.fit(this.optInfo, 18);
    UIKit.glow(this.optInfo, Ink, 3);
    this.BuildShop(ex.parent!);
  }

  private PickMode(i: number) {
    this.Data.set("mode", i);
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
  }

  private CycleOpt(which: number) {
    const m = this.SelectedMode;
    if (m === Mode.Cpu && which === 1) this.Data.set("diff", (Mathf.clamp(this.Data.get("diff", 1), 0, 2) + 1) % 3);
    else if ((m === Mode.Cpu && which === 2) || (m === Mode.Duo && which === 1)) {
      const n = arenasUnlocked(this.StageN);
      this.Data.set("arena", (Mathf.clamp(this.Data.get("arena"), 0, Arenas.length - 1) + 1) % n);
      this.ApplyArena(this.Data.get("arena"));
    } else return;
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
  }

  private RefreshTitle() {
    if (!this.opt1) return;
    const m = this.SelectedMode;
    const accents = [Orange, Gold, Sky, Pink];
    this.modeButtons.forEach((b, i) => {
      b.setAccent(i === m ? accents[i] : new Color(1, 1, 1, 0.4));
      b.node.localScale = i === m ? new V3(1.06, 1.06, 1) : V3.one;
    });
    const arena = Mathf.clamp(this.Data.get("arena"), 0, arenasUnlocked(this.StageN) - 1);
    let info = "";
    if (m === Mode.Solo) {
      const st = makeStage(this.StageN);
      info = `STAGE ${st.n} · ${st.title} · ${Arenas[st.arena].name}`;
    } else if (m === Mode.Daily) {
      const st = makeDaily(this.Today);
      info = `TODAY: ${st.title} · ${Arenas[st.arena].name}`;
    }
    const twoButtons = m === Mode.Cpu;
    this.opt1.node.setActive(m === Mode.Cpu || m === Mode.Duo);
    this.opt2.node.setActive(twoButtons);
    this.optInfo.gameObject.setActive(m === Mode.Solo || m === Mode.Daily);
    this.optInfo.text = info;
    if (m === Mode.Cpu) {
      const d = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
      if (this.opt1.label) this.opt1.label.text = `CPU: ${DiffNames[d]}`;
      if (this.opt2.label) this.opt2.label.text = Arenas[arena].name;
      this.opt1.setAccent(Sky); this.opt2.setAccent(Green);
      this.opt1.node.place(UIKit.Center, new V2(-330, -100), new V2(320, 88));
    } else if (m === Mode.Duo) {
      if (this.opt1.label) this.opt1.label.text = `ARENA: ${Arenas[arena].name}`;
      this.opt1.setAccent(Green);
      this.opt1.node.place(UIKit.Center, new V2(-165, -100), new V2(650, 88));
    }
    if (this.shopButton.label) this.shopButton.label.text = "TOP SHOP";
    const st = m === Mode.Solo ? makeStage(this.StageN) : m === Mode.Daily ? makeDaily(this.Today) : null;
    this.ApplyArena(st ? st.arena : arena);
    this.UI.SetNews(m === Mode.Daily && this.Data.get("dday") !== this.Today ? "NEW DAILY RUMBLE: BEAT IT FOR +150 COINS" : "");
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  // ------------------------------------------------------------------ shop

  private BuildShop(parent: UINode) {
    const C = UIKit.Center;
    this.shop = UIKit.node("Shop", parent).stretch();
    UIKit.dim(this.shop, 0.8);
    const card = UIKit.card(this.shop, new V2(900, 1010), Gold);
    const solid = UIKit.img(card, "Solid", Art.UiRound, Pal.hex(0x1e140c));
    solid.rectTransform.stretch(2);
    solid.rectTransform.setSiblingIndex(1);
    UIKit.glow(UIKit.at(UIKit.label(card, "TOP SHOP", 56, Color.white), C, new V2(0, 440), new V2(800, 70)), Ink, 3);
    UIKit.img(card, "Coin", CoinIcon(), Color.white).rectTransform.place(C, new V2(-70, 380), new V2(48, 48));
    this.shopCoins = UIKit.at(UIKit.label(card, "0", 40, Gold, TextAnchor.MiddleLeft), C, new V2(60, 380), new V2(200, 56));
    this.shopTop = UIKit.img(card, "Preview", TopSprite(0, 0), Color.white);
    this.shopTop.rectTransform.place(C, new V2(0, 245), new V2(220, 220));
    UIKit.img(card, "Shine", ShineSprite(), Color.white).rectTransform.place(C, new V2(0, 245), new V2(220, 220));
    UIKit.buttonAt(card, "<", C, new V2(-330, 245), new V2(110, 120), false, () => this.Browse(0, -1), 56).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(330, 245), new V2(110, 120), false, () => this.Browse(0, 1), 56).setAccent(Gold);
    this.shopName = UIKit.at(UIKit.label(card, "", 46, Color.white), C, new V2(0, 108), new V2(700, 60));
    this.shopBlurb = UIKit.at(UIKit.label(card, "", 26, Pal.TextDim), C, new V2(0, 62), new V2(800, 40));
    const statNames = ["ATTACK", "DEFENCE", "STAMINA"], statCols = [Red, Sky, Green];
    for (let k = 0; k < 3; k++) {
      UIKit.at(UIKit.label(card, statNames[k], 28, Cream, TextAnchor.MiddleLeft), C, new V2(-220, 5 - k * 46), new V2(260, 40));
      const [, fill] = UIKit.meter(card, C, new V2(110, 5 - k * 46), new V2(400, 28), statCols[k]);
      this.shopStats.push(fill);
    }
    this.shopAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, -175), new V2(420, 96), true, () => this.ShopAction(0), 36);
    UIKit.at(UIKit.label(card, "PAINT", 26, Pal.TextDim), C, new V2(0, -262), new V2(400, 36));
    this.paintName = UIKit.at(UIKit.label(card, "", 40, Color.white), C, new V2(0, -305), new V2(500, 56));
    UIKit.buttonAt(card, "<", C, new V2(-330, -305), new V2(110, 96), false, () => this.Browse(1, -1), 50).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(330, -305), new V2(110, 96), false, () => this.Browse(1, 1), 50).setAccent(Gold);
    this.paintAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, -385), new V2(420, 80), false, () => this.ShopAction(1), 32);
    UIKit.buttonAt(card, "CLOSE", C, new V2(0, -468), new V2(300, 70), false, () => this.OpenShop(false), 34).setAccent(Gold);
    this.shop.setActive(false);
  }

  private OpenShop(on: boolean) {
    if (on) { this.browseDesign = this.Equipped; this.browsePaint = this.EquippedPaint; this.RefreshShop(); Sfx.play(Snd.Click, 0.6); }
    else this.RefreshTitle();
    this.shop.setActive(on);
  }

  private Browse(row: number, d: number) {
    if (row === 0) this.browseDesign = (this.browseDesign + d + Designs.length) % Designs.length;
    else this.browsePaint = (this.browsePaint + d + Paints.length) % Paints.length;
    Sfx.play(Snd.Tick, 0.5);
    this.RefreshShop();
  }

  private ShopAction(row: number) {
    if (row === 0) {
      const i = this.browseDesign, d = Designs[i];
      if (!this.Owns(i)) {
        if (this.Coins < d.cost) { Sfx.play(Snd.Deny, 0.6); return; }
        this.Coins = this.Coins - d.cost;
        this.Data.set("own" + i, 1);
        Sfx.play(Snd.PowerUp, 0.8);
      } else Sfx.play(Snd.Confirm, 0.6);
      this.Data.set("top", i);
    } else {
      const i = this.browsePaint, p = Paints[i];
      if (!this.OwnsPaint(i)) {
        if (this.Coins < p.cost) { Sfx.play(Snd.Deny, 0.6); return; }
        this.Coins = this.Coins - p.cost;
        this.Data.set("pnt" + i, 1);
        Sfx.play(Snd.PowerUp, 0.8);
      } else Sfx.play(Snd.Confirm, 0.6);
      this.Data.set("paint", i);
    }
    this.RefreshShop();
  }

  private RefreshShop() {
    const d = Designs[this.browseDesign], di = this.browseDesign, pi = this.browsePaint;
    this.shopCoins.text = Fmt.n(this.Coins);
    this.shopTop.sprite = TopSprite(di, pi);
    this.shopName.text = d.name;
    this.shopBlurb.text = d.blurb;
    UIKit.setMeter(this.shopStats[0], d.atk / 5);
    UIKit.setMeter(this.shopStats[1], d.def / 5);
    UIKit.setMeter(this.shopStats[2], d.sta / 5);
    this.SetAction(this.shopAction, this.Equipped === di, this.Owns(di), d.cost);
    this.paintName.text = Paints[pi].name;
    this.SetAction(this.paintAction, this.EquippedPaint === pi, this.OwnsPaint(pi), Paints[pi].cost);
  }

  private SetAction(b: ArcadeButton, equipped: boolean, owned: boolean, cost: number) {
    if (b.label) b.label.text = equipped ? "EQUIPPED" : owned ? "EQUIP" : `BUY  ${Fmt.n(cost)}`;
    b.setAccent(equipped ? Pal.TextDim : owned ? Sky : this.Coins >= cost ? Gold : Pal.hex(0x8a7a6a));
    b.interactable = !equipped && (owned || this.Coins >= cost);
  }

  // ------------------------------------------------------------------ arena

  private ApplyArena(i: number) {
    i = Mathf.clamp(i, 0, Arenas.length - 1);
    if (this.builtArena === i) return;
    this.builtArena = i;
    this.far.sprite = ArenaFar(i);
    this.near.sprite = ArenaNear(i);
    const rng = new Rng(i * 31 + 5);
    for (let k = 0; k < this.decor.length; k++) {
      const sr = this.decor[k];
      const pair = Math.floor(k / 2), second = k % 2 === 1;
      const a = (pair / 8) * Math.PI * 2 + 0.35 + rng.range(-0.12, 0.12);
      const rad = 13.2 + rng.range(0, 1.6);
      let sprite = SneakerSprite(pair), size = 2.2, ang = (a * 180) / Math.PI + 90, off = second ? 0.75 : -0.75;
      if (i === 1 || i === 3) {
        sprite = k % 3 === 0 ? PencilSprite(k) : MarbleSprite(k);
        size = k % 3 === 0 ? 4.2 : 1;
        ang = rng.range(0, 360); off = second ? 1.4 : -1.2;
      } else if (k % 4 === 3) { sprite = i === 0 ? ChalkSprite(k) : MarbleSprite(k); size = i === 0 ? 1.4 : 1; ang = rng.range(0, 360); }
      sr.sprite = sprite;
      const tx = -Math.sin(a), ty = Math.cos(a);
      sr.transform.localPosition = new V3(Math.cos(a) * rad + tx * off, Math.sin(a) * rad + ty * off, 0);
      sr.transform.localScale = new V3(size, size, 1);
      sr.transform.localEulerZ = ang + (second ? 8 : -8);
      sr.color = Color.white;
    }
    for (const s of this.scuffs) { s.t = 0; s.sr.color = Color.clear; }
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); this.layoutFrames = 2; }

  private Layout() {
    if (!this.arenaRoot) return;
    this.Fx.CameraTarget = V2.zero;
    this.portrait = Screen.height >= Screen.width;
    const duo = this.State !== Phase.Title && this.mode === Mode.Duo;
    const need = this.portrait ? 23.5 : 22;
    let cx: number, cy: number;
    if (this.portrait) {
      const r = duo ? this.PlayRect(170, 170, 0.1) : this.PlayRect(this.players.length > 2 && this.State !== Phase.Title ? 330 : 200, 120, 0.1);
      this.scale = Math.min((r.xMax - r.xMin) / need, (r.yMax - r.yMin) / need);
      cx = (r.xMin + r.xMax) / 2; cy = (r.yMin + r.yMax) / 2;
    } else {
      const r = this.PlayRect(30, 30, 0.1);
      const upu = Math.min(this.ViewSize.x, this.ViewSize.y) / 1080;
      const side = 440 * upu;
      this.scale = Math.min((r.yMax - r.yMin) / need, (r.xMax - r.xMin - side * 2) / need);
      cx = (r.xMin + r.xMax) / 2; cy = (r.yMin + r.yMax) / 2;
    }
    if (this.State === Phase.Title) { this.scale = Math.min(this.ViewSize.x, this.ViewSize.y) / 22; cx = 0; cy = 0; }
    this.rot = duo && !this.portrait ? -90 : 0;
    this.arenaRoot.localPosition = new V3(cx, cy, 0);
    this.arenaRoot.localScale = new V3(this.scale, this.scale, 1);
    this.arenaRoot.localEulerZ = this.rot;
    for (const l of this.strings) l.widthMultiplier = 0.09 * this.scale;
    this.LayoutHud();
  }

  private LayoutHud() {
    if (!this.cards.length) return;
    const n = this.players.length;
    const duo = this.mode === Mode.Duo;
    for (let i = 0; i < 4; i++) {
      const c = this.cards[i];
      c.root.setActive(this.State !== Phase.Title && i < n);
      c.root.localEulerAngles = V3.zero;
      c.root.localScale = V3.one;
    }
    const cw = 400, ch = 120;
    if (duo) {
      if (this.portrait) {
        this.cards[0].root.place(new V2(0.5, 0), new V2(0, 80), new V2(cw, ch));
        this.cards[1].root.place(new V2(0.5, 1), new V2(-60, -80), new V2(cw, ch));
        this.cards[1].root.localEulerAngles = new V3(0, 0, 180);
        this.infoText.rectTransform.place(new V2(0, 0.5), new V2(150, 0), new V2(260, 44));
        this.infoText.rectTransform.localEulerAngles = new V3(0, 0, 90);
      } else {
        this.cards[0].root.place(new V2(0, 0), new V2(30 + cw / 2, 90), new V2(cw, ch));
        this.cards[1].root.place(new V2(1, 0), new V2(-30 - cw / 2, 90), new V2(cw, ch));
        this.infoText.rectTransform.place(new V2(0.5, 1), new V2(0, -50), new V2(620, 44));
        this.infoText.rectTransform.localEulerAngles = V3.zero;
      }
    } else if (this.portrait) {
      this.cards[0].root.place(new V2(0, 1), new V2(15 + cw / 2, -80), new V2(cw, ch));
      for (let i = 1; i < n; i++) {
        const small = n > 2;
        this.cards[i].root.place(new V2(1, 1), new V2(-150 - cw / 2 + 20, -80 - (i - 1) * (small ? 100 : 0)), new V2(cw, ch));
        if (small) this.cards[i].root.localScale = new V3(0.8, 0.8, 1);
      }
      this.infoText.rectTransform.place(new V2(0, 1), new V2(15 + cw / 2, -170), new V2(cw, 40));
      this.infoText.rectTransform.localEulerAngles = V3.zero;
    } else {
      this.cards[0].root.place(new V2(0, 0.5), new V2(40 + cw / 2, 60), new V2(cw, ch));
      for (let i = 1; i < n; i++) this.cards[i].root.place(new V2(1, 0.5), new V2(-40 - cw / 2, 170 - (i - 1) * 140), new V2(cw, ch));
      this.infoText.rectTransform.place(new V2(0, 0.5), new V2(40 + cw / 2, -40), new V2(cw, 44));
      this.infoText.rectTransform.localEulerAngles = V3.zero;
    }
  }

  // ------------------------------------------------------------------ coordinates

  private SimToWorld(p: V2) {
    const a = (this.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const lp = this.arenaRoot.localPosition;
    return new V2(lp.x + (p.x * c - p.y * s) * this.scale, lp.y + (p.x * s + p.y * c) * this.scale);
  }
  private ScreenToSim(screen: V2) {
    const w = this.ScreenToWorld(screen), lp = this.arenaRoot.localPosition;
    const x = (w.x - lp.x) / this.scale, y = (w.y - lp.y) / this.scale;
    const a = (-this.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return new V2(x * c - y * s, x * s + y * c);
  }
  /** Screen-space direction (keyboard) → sim direction. */
  private ScreenDirToSim(d: V2) {
    const a = (-this.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return new V2(d.x * c - d.y * s, d.x * s + d.y * c);
  }
  private SimToHud(p: V2) { return this.UI.WorldToHud(this.SimToWorld(p)); }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.mode = this.SelectedMode;
    this.players = [];
    this.shop?.setActive(false);
    this.HideGuides();
    this.StartAttract();
    this.Layout();
    this.RefreshTitle();
  }

  private StartAttract() {
    const rng = new Rng(Math.floor(Math.random() * 1e9));
    this.sim.reset(2, Arenas[this.builtArena < 0 ? 0 : this.builtArena]);
    this.sim.seed(rng.int(1e9));
    this.sim.events = [];
    this.attractBots = [new Bot(BotLevels[2], new Rng(rng.int(1e9))), new Bot(BotLevels[1], new Rng(rng.int(1e9)))];
    const looks: [number, number][] = [[this.Equipped, this.EquippedPaint], [rng.int(Designs.length), rng.int(Paints.length)]];
    for (let i = 0; i < 2; i++) { this.sim.tops[i].setDesign(Designs[looks[i][0]]); this.SetLook(i, looks[i][0], looks[i][1], OwnerCols[i]); }
    for (let i = 2; i < 4; i++) this.views[i].root.setActive(false);
    for (let i = 0; i < 2; i++) { const p = this.attractBots[i].planLaunch(this.sim, i); this.sim.launch(i, p.ax, p.ay, p.power); }
    this.attractT = 0;
  }

  protected BeginRun() {
    this.mode = this.SelectedMode;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.Data.add("games", 1);
    this.round = 0; this.wins = [0, 0];
    this.revived = false;
    this.matchStats = { hits: 0, bestHit: 0, rings: 0 };
    const me: Player = { name: this.mode === Mode.Duo ? "PLAYER 1" : "YOU", human: true, slot: 0, design: this.Equipped, paint: this.EquippedPaint, boost: 0, bot: null, color: OwnerCols[0] };
    this.players = [me];
    const seed = (Date.now() & 0xfffffff) ^ 0x5bd1e995;
    const rng = new Rng(seed);
    if (this.mode === Mode.Solo || this.mode === Mode.Daily) {
      this.stage = this.mode === Mode.Solo ? makeStage(this.StageN) : makeDaily(this.Today);
      this.arenaIdx = this.stage.arena;
      this.stage.rivals.forEach((rv, i) => this.players.push({ name: rv.name, human: false, slot: -1, design: rv.design, paint: rv.paint === me.paint && rv.design === me.design ? (rv.paint + 1) % Paints.length : rv.paint, boost: rv.boost, bot: new Bot(rv.bot, new Rng(rng.int(1e9))), color: OwnerCols[i + 1] }));
    } else if (this.mode === Mode.Cpu) {
      this.stage = null;
      this.arenaIdx = Mathf.clamp(this.Data.get("arena"), 0, arenasUnlocked(this.StageN) - 1);
      const d = this.diff;
      const design = [0, 3, 4][d], paint = [2, 4, 6][d];
      this.players.push({ name: CpuNames[d], human: false, slot: -1, design, paint: paint === me.paint ? (paint + 1) % Paints.length : paint, boost: 0, bot: new Bot(BotLevels[d], new Rng(rng.int(1e9))), color: OwnerCols[1] });
    } else {
      this.stage = null;
      this.arenaIdx = Mathf.clamp(this.Data.get("arena"), 0, arenasUnlocked(this.StageN) - 1);
      const p2design = this.Equipped, p2paint = (this.EquippedPaint + 1) % Paints.length;
      this.players.push({ name: "PLAYER 2", human: true, slot: 1, design: p2design, paint: p2paint, boost: 0, bot: null, color: OwnerCols[1] });
    }
    this.ApplyArena(this.arenaIdx);
    for (let i = 0; i < 4; i++) {
      const c = this.cards[i];
      if (i >= this.players.length) continue;
      const p = this.players[i];
      c.name.text = p.name;
      c.icon.sprite = TopSprite(p.design, p.paint);
      c.energyBg.setActive(p.human);
      for (const pip of c.pips) pip.gameObject.setActive(this.mode === Mode.Cpu || this.mode === Mode.Duo);
    }
    if (!this.hums.length) { this.hums.push(Sfx.createLoop(this.humClip)); this.hums.push(Sfx.createLoop(this.humClip)); }
    Sfx.setIntensity(0.3);
    this.layoutFrames = 2;
    this.Layout();
    this.StartRound();
  }

  private StartRound() {
    this.round++;
    const n = this.players.length;
    this.sim.reset(n, Arenas[this.arenaIdx]);
    this.sim.seed((Date.now() & 0xffffff) + this.round * 7919);
    this.sim.events = [];
    for (let i = 0; i < 4; i++) this.views[i].root.setActive(i < n);
    for (let i = 0; i < n; i++) {
      const p = this.players[i], t = this.sim.tops[i];
      t.setDesign(Designs[p.design], p.boost);
      t.bonus = this.powerMatch && i === 0 ? 1 : 0;
      this.SetLook(i, p.design, p.paint, p.color);
      this.views[i].pop = 1;
      this.cards[i].out.text = "";
    }
    // in 2-player portrait the second player sits at the top: start marks bottom/top already (2 tops)
    for (const s of this.slots) s.reset();
    for (let h = 0; h < 2; h++) {
      const i = this.players.findIndex((p) => p.human && p.slot === h);
      if (i < 0) continue;
      const t = this.sim.tops[i];
      this.slots[h].aim = new V2(-t.sx, -t.sy).normalized;
      this.slots[h].power = 0.7;
    }
    this.planned = this.players.map((p) => p.human);
    this.cpuLockAt = this.players.map(() => 1.2 + Math.random() * 1.6);
    this.aimClock = AimTime;
    this.roundWinner = -1;
    this.step = Step.Intro;
    this.timer = 0;
    this.lastOut = "";
    const title = this.mode === Mode.Solo ? `STAGE ${this.stage!.n}` : this.mode === Mode.Daily ? "DAILY RUMBLE" : `ROUND ${this.round}`;
    this.UI.Announce(title, Gold, 1.1);
    this.UpdateHud();
  }

  private SetLook(i: number, design: number, paint: number, col: Color) {
    const v = this.views[i];
    const key = design + ":" + paint;
    if (v.key !== key) {
      v.key = key;
      v.body.sprite = TopSprite(design, paint);
      v.blur.sprite = BlurSprite(design, paint);
      v.fallen.sprite = FallenSprite(design, paint);
    }
    v.owner.color = col.withAlpha(0.75);
    v.mark.color = col.withAlpha(0);
    v.fallT = -1;
    v.root.setActive(true);
  }

  protected OnPauseChanged(paused: boolean) {
    for (const s of this.slots) { s.touch = -2; s.dragging = false; }
    if (paused) for (const h of this.hums) h.volume = 0;
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    if (this.shop?.activeSelf) {
      this.shopClock += Time.unscaledDeltaTime;
      this.shopTop.rectTransform.localEulerAngles = new V3(0, 0, -this.shopClock * 220);
    }
    if (this.State === Phase.Title) {
      this.attractBots.forEach((b, i) => b.drive(this.sim, i, dt));
      this.Simulate(dt, true);
      if (this.sim.winner >= 0) { this.attractT += dt; if (this.attractT > 2.5) this.StartAttract(); }
    } else {
      // result screen: the battle is frozen (a RE-SPIN continues it exactly), the tops just keep turning
    }
    for (const h of this.hums) h.volume = Mathf.moveTowards(h.volume, 0, dt);
    this.Present(dt);
  }

  protected TickRun(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    this.soundsThisFrame = 0;
    this.timer += dt;
    this.ReadPointers();
    switch (this.step) {
      case Step.Intro:
        if (this.timer > 0.9) { this.step = Step.Aim; this.timer = 0; if (this.Data.get("games") <= 2 && this.round === 1 && this.portrait) this.UI.Hint(this.mode === Mode.Duo ? "Both players: pull back from your mark and let go!" : "Pull back from your top and let go to throw it!"); }
        break;
      case Step.Aim: this.TickAim(dt); break;
      case Step.Rip:
        if (this.timer > 0.45) this.LaunchAll();
        break;
      case Step.Battle: this.TickBattle(dt); break;
      case Step.RoundOver:
        this.DriveBots(dt);
        this.Simulate(dt, false);
        if (this.timer > 2) this.AfterRound();
        break;
      case Step.Wait: this.Simulate(dt, true); break;
    }
    this.UpdateHums(dt);
    this.UpdateHud();
    this.Present(dt);
  }

  // ------------------------------------------------------------------ input

  private HumanIndex(slot: number) { return this.players.findIndex((p) => p.human && p.slot === slot); }

  /** Multi-touch: each finger belongs to the player whose half it started on. The mouse acts the same way. */
  private ReadPointers() {
    const duo = this.mode === Mode.Duo;
    const ownerOf = (sp: V2) => (duo ? (sp.y < 0 ? 0 : 1) : 0);
    const valid = (pos: V2) => !overUI(pos) && pos.y < Screen.height * 0.94;
    let anyTouch = false;
    if (Touchscreen.present) {
      for (const t of Touchscreen.touches) {
        anyTouch = true;
        const id = t.touchId;
        if (t.press.wasPressedThisFrame && valid(t.position)) {
          const sp = this.ScreenToSim(t.position);
          const s = this.slots[ownerOf(sp)];
          if (s.touch === -2 && this.HumanIndex(ownerOf(sp)) >= 0) { s.touch = id; s.start = sp; s.cur = sp; this.PointerDown(ownerOf(sp)); }
        }
        for (let h = 0; h < 2; h++) {
          const s = this.slots[h];
          if (s.touch !== id) continue;
          s.cur = this.ScreenToSim(t.position);
          if (!t.press.isPressed || t.press.wasReleasedThisFrame) { this.PointerUp(h); s.touch = -2; }
        }
      }
    }
    if (!anyTouch && Mouse.present) {
      const mp = Mouse.position;
      if (Mouse.leftButton.wasPressedThisFrame && valid(mp)) {
        const sp = this.ScreenToSim(mp);
        const h = ownerOf(sp);
        const s = this.slots[h];
        if (s.touch === -2 && this.HumanIndex(h) >= 0) { s.touch = -1; s.start = sp; s.cur = sp; this.PointerDown(h); }
      }
      for (let h = 0; h < 2; h++) {
        const s = this.slots[h];
        if (s.touch !== -1) continue;
        s.cur = this.ScreenToSim(mp);
        if (!Mouse.leftButton.isPressed || Mouse.leftButton.wasReleasedThisFrame) { this.PointerUp(h); s.touch = -2; }
      }
    }
  }

  private PointerDown(h: number) {
    const s = this.slots[h];
    if (this.step === Step.Aim && !s.locked) { s.dragging = true; s.keyAim = false; this.UI.Hint(null); }
    else if (this.step === Step.Battle) s.dragging = true;
  }

  private PointerUp(h: number) {
    const s = this.slots[h];
    if (!s.dragging) return;
    s.dragging = false;
    if (this.step === Step.Aim && !s.locked) {
      if (s.power > 0.04 && s.cur.sub(s.start).magnitude > PullMin) this.Lock(h);
    }
  }

  /** Keyboard: P1 = WASD (+ arrows when alone) and Space, P2 = arrows and Enter. */
  private KeyDir(h: number) {
    const duo = this.mode === Mode.Duo;
    const k = (c: string) => (Keyboard.key(c).isPressed ? 1 : 0);
    const wasd = new V2(k("KeyD") - k("KeyA"), k("KeyW") - k("KeyS"));
    const arrows = new V2(k("ArrowRight") - k("ArrowLeft"), k("ArrowUp") - k("ArrowDown"));
    let d = duo ? (h === 0 ? wasd : arrows) : wasd.add(arrows);
    if (d.sqrMagnitude > 1) d = d.normalized;
    // the top player in portrait 2P looks at the screen upside down
    if (duo && h === 1 && this.portrait) d = d.neg();
    return this.ScreenDirToSim(d);
  }
  private KeyLaunch(h: number) {
    const duo = this.mode === Mode.Duo;
    if (h === 0) return Keyboard.space.wasPressedThisFrame || (!duo && (Keyboard.enter.wasPressedThisFrame || Keyboard.numpadEnter.wasPressedThisFrame));
    return Keyboard.enter.wasPressedThisFrame || Keyboard.numpadEnter.wasPressedThisFrame;
  }

  // ------------------------------------------------------------------ aim

  private TickAim(dt: number) {
    this.aimClock -= dt;
    const n = this.players.length;
    for (let h = 0; h < 2; h++) {
      const i = this.HumanIndex(h);
      if (i < 0) continue;
      const s = this.slots[h];
      if (s.locked) continue;
      const t = this.sim.tops[i];
      if (s.dragging) {
        const v = s.start.sub(s.cur);
        const l = v.magnitude;
        if (l > PullMin) { s.aim = v.div(l); s.power = Mathf.clamp01((l - PullMin) / (PullFull - PullMin)); }
        else s.power = 0;
      } else {
        // keyboard aiming: left/right turn, up/down power, Space/Enter throws
        const kd = this.KeyDir(h);
        if (kd.sqrMagnitude > 0.01) {
          s.keyAim = true;
          const toC = new V2(-t.sx, -t.sy).normalized;
          const side = kd.x * -toC.y + kd.y * toC.x; // turn
          const fwd = V2.dot(kd, toC);
          const a = Math.atan2(s.aim.y, s.aim.x) + side * dt * 1.6;
          s.aim = new V2(Math.cos(a), Math.sin(a));
          s.power = Mathf.clamp01(s.power + fwd * dt * 0.8);
        }
        if (this.KeyLaunch(h)) { s.keyAim = true; this.Lock(h); continue; }
      }
      if (this.aimClock <= 0) {
        if (s.power < 0.25) s.power = 0.6;
        this.Lock(h);
      }
    }
    // CPUs plan one per frame, then lock after a short "winding" pause
    for (let i = 0; i < n; i++) {
      const p = this.players[i];
      if (p.human || !p.bot) continue;
      if (!this.planned[i]) {
        const plan = p.bot.planLaunch(this.sim, i);
        this.planned[i] = true;
        (this.players[i] as Player & { plan?: LaunchPlan }).plan = plan;
        break;
      }
    }
    const allLocked = this.players.every((p, i) => (p.human ? this.slots[p.slot].locked : this.planned[i] && this.timer >= this.cpuLockAt[i]));
    if (allLocked) {
      this.step = Step.Rip; this.timer = 0;
      this.UI.Announce("LET IT RIP!", Orange, 0.9);
      Sfx.play(Snd.Charge, 0.5);
    }
    this.ShowGuides();
  }

  private Lock(h: number) {
    const s = this.slots[h];
    if (s.locked) return;
    s.locked = true; s.dragging = false;
    s.plan = { ax: s.aim.x, ay: s.aim.y, power: Math.max(0.05, s.power) };
    Sfx.play(Snd.Confirm, 0.5, 1 + s.power * 0.3);
    Fx.haptic();
    const others = this.players.some((p) => p.human && p.slot !== h && !this.slots[p.slot].locked);
    if (others) this.aimText[h].text = "READY!";
  }

  private LaunchAll() {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const plan = p.human ? this.slots[p.slot].plan : (p as Player & { plan?: LaunchPlan }).plan;
      const pl = plan ?? { ax: -this.sim.tops[i].sx, ay: -this.sim.tops[i].sy, power: 0.6 };
      this.sim.launch(i, pl.ax, pl.ay, pl.power);
    }
    this.HideGuides();
    Sfx.playClip(this.zip, 0.9, 1);
    for (let i = 1; i < this.players.length; i++) Sfx.playClip(this.zip, 0.4, 0.92 + 0.12 * i);
    this.Fx.shake(0.12);
    Fx.haptic(true);
    for (let i = 0; i < this.players.length; i++) { const t = this.sim.tops[i]; this.fx.pop(new V2(t.x, t.y), Cream, 10, 3, 0.2, 0.35); }
    this.step = Step.Battle; this.timer = 0;
    for (const s of this.slots) { s.dragging = false; s.start = s.cur; }
    if (this.Data.get("games") <= 2 && this.round === 1 && this.portrait) this.UI.Toast(this.mode === Mode.Duo ? "Drag on your side to nudge your top!" : "Drag anywhere to nudge your top. Stay in the ring!", 3);
  }

  // ------------------------------------------------------------------ battle

  private TickBattle(dt: number) {
    for (let h = 0; h < 2; h++) {
      const i = this.HumanIndex(h);
      if (i < 0) continue;
      const s = this.slots[h], t = this.sim.tops[i];
      let v = V2.zero;
      if (s.dragging) { v = s.cur.sub(s.start).div(2.6); if (v.magnitude > 1) v = v.normalized; if (v.magnitude < 0.12) v = V2.zero; }
      const kd = this.KeyDir(h);
      if (kd.sqrMagnitude > 0.01) v = kd;
      t.nx = v.x; t.ny = v.y;
    }
    this.DriveBots(dt);
    this.Simulate(dt, false);
    const me = this.sim.tops[0];
    const soloLike = this.mode === Mode.Solo || this.mode === Mode.Daily;
    if (this.sim.winner >= 0 || (soloLike && !me.alive)) {
      this.roundWinner = this.sim.winner >= 0 ? this.sim.winner : -1;
      this.step = Step.RoundOver; this.timer = 0;
      for (const p of this.sim.tops) { p.nx = 0; p.ny = 0; }
      this.SlowMo(0.35, 0.7);
      const w = this.roundWinner;
      if (w >= 0) {
        const name = this.players[w].name;
        const txt = this.mode === Mode.Duo ? `${name} WINS THE ROUND!` : w === 0 ? (soloLike || this.WillWinMatch(0) ? "LAST TOP SPINNING!" : "ROUND TO YOU!") : `${name} WINS THE ROUND`;
        this.UI.Announce(txt, w === 0 || this.mode === Mode.Duo ? this.players[w].color : Red, 1.6);
        if (w === 0 || this.mode === Mode.Duo) this.fx.confetti(new V2(this.sim.tops[w].x, this.sim.tops[w].y), 40, 6, [Gold, Sky, Pink, Cream, Green]);
      } else this.UI.Announce("KNOCKED OUT!", Red, 1.4);
    }
  }

  private WillWinMatch(i: number) { return this.mode === Mode.Cpu && this.wins[i] + 1 >= 2; }

  private DriveBots(dt: number) {
    for (let i = 0; i < this.players.length; i++) { const p = this.players[i]; if (p.bot) p.bot.drive(this.sim, i, dt); }
  }

  private Simulate(dt: number, quiet: boolean) {
    if (!this.sim.events) this.sim.events = [];
    this.sim.advance(dt);
    for (const e of this.sim.events) this.OnEvent(e, quiet);
    this.sim.events.length = 0;
  }

  private OnEvent(e: TopEvent, quiet: boolean) {
    const vk = quiet ? 0.25 : 1;
    const p = new V2(e.x, e.y);
    switch (e.type) {
      case Ev.Hit: {
        const k = Mathf.clamp01(e.impact / 14);
        if (this.soundsThisFrame++ < 3) {
          Sfx.playClip(this.clack[Math.floor(Math.random() * 3)], (0.25 + 0.75 * k) * vk, 0.9 + Math.random() * 0.2);
          if (e.impact > 7) Sfx.playClip(this.clang, k * 0.7 * vk, 0.9 + Math.random() * 0.25);
        }
        if (quiet) break;
        this.matchStats.hits++;
        this.matchStats.bestHit = Math.max(this.matchStats.bestHit, e.impact);
        const n = 3 + Math.round(k * 12);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 10 * (0.4 + k);
          this.fx.emit(p, new V2(Math.cos(a) * sp, Math.sin(a) * sp), Color.lerp(Gold, Color.white, Math.random()), 0.35 + k * 0.3, 0.18 + Math.random() * 0.2, SparkSprite(), 0, 0, true, 4);
        }
        if (e.impact > 5) {
          for (let i = 0; i < Math.round(k * 7); i++) {
            const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
            this.fx.emit(p, new V2(Math.cos(a) * sp, Math.sin(a) * sp), Color.white, 0.3 + Math.random() * 0.2, 0.6 + Math.random() * 0.4, ChipSprite(), 0, (Math.random() - 0.5) * 900, false, 3);
          }
          this.Scuff(p, Math.random() * 360, 1.6 + k);
        }
        this.views[e.a].pop = Math.max(this.views[e.a].pop, k);
        this.views[e.b].pop = Math.max(this.views[e.b].pop, k);
        if (e.impact > 6) { this.Fx.shake(0.08 + k * 0.3); Fx.haptic(e.impact > 10); }
        if (e.impact > 11) { this.Hitstop(0.06); this.UI.Float(this.SimToWorld(p), e.impact > 15 ? "SMASH!" : "CRACK!", Gold, 1.1); }
        break;
      }
      case Ev.Land:
        Sfx.playClip(this.thud, 0.5 * vk, 0.9 + Math.random() * 0.2);
        if (!quiet) { this.fx.pop(p, new Color(0.85, 0.75, 0.6, 0.8), 8, 2.2, 0.35, 0.4); this.Scuff(p, Math.atan2(this.sim.tops[e.a].vy, this.sim.tops[e.a].vx) * Mathf.Rad2Deg, 1.8); }
        break;
      case Ev.RingOut: {
        if (!quiet) {
          Sfx.playClip(this.ooh, 0.8, 0.95 + Math.random() * 0.1);
          this.Fx.shake(0.25);
          this.matchStats.rings++;
          const nm = this.players[e.a]?.name ?? "";
          this.UI.Float(this.SimToWorld(p.normalized.mul(R - 1.5)), `${nm}: RING OUT!`, this.players[e.a]?.color ?? Red, 1);
          this.cards[e.a].out.text = "RING OUT";
          this.lastOut = "RING OUT";
        } else Sfx.playClip(this.ooh, 0.2, 1);
        break;
      }
      case Ev.Topple: {
        Sfx.playClip(this.clatter, 0.9 * vk, 0.95 + Math.random() * 0.1);
        const v = this.views[e.a];
        v.fallT = 0; v.fallAng = Math.random() * 360;
        if (!quiet) {
          this.fx.pop(p, new Color(0.85, 0.75, 0.6, 0.8), 10, 2.5, 0.3, 0.5);
          const nm = this.players[e.a]?.name ?? "";
          this.UI.Float(this.SimToWorld(p), `${nm}: TOPPLED!`, this.players[e.a]?.color ?? Red, 1);
          this.cards[e.a].out.text = "TOPPLED";
          this.lastOut = "TOPPLED";
          Fx.haptic(true);
        }
        break;
      }
      case Ev.Launch: break;
    }
  }

  private DustColor() { return [new Color(0.9, 0.85, 0.75, 0.45), new Color(0.95, 0.8, 0.6, 0.35), new Color(1, 0.92, 0.7, 0.5), new Color(1, 1, 1, 0.3)][Mathf.clamp(this.builtArena, 0, 3)]; }

  private Scuff(p: V2, angDeg: number, size: number) {
    const s = this.scuffs[this.scuffNext];
    this.scuffNext = (this.scuffNext + 1) % this.scuffs.length;
    s.t = 1;
    s.sr.transform.localPosition = new V3(p.x, p.y, 0);
    s.sr.transform.localEulerZ = angDeg;
    s.sr.transform.localScale = new V3(size, size, 1);
  }

  private UpdateHums(dt: number) {
    if (this.hums.length < 2) return;
    const tops = this.sim.tops;
    const mine = tops[0];
    const s0 = mine && mine.alive && mine.launched ? Math.min(1, mine.s) : 0;
    let s1 = 0;
    for (let i = 1; i < tops.length; i++) if (tops[i].alive && tops[i].launched) s1 = Math.max(s1, Math.min(1, tops[i].s));
    this.hums[0].volume = Mathf.moveTowards(this.hums[0].volume, s0 > 0 ? 0.12 + 0.18 * s0 : 0, dt * 2);
    this.hums[0].pitch = 0.55 + 0.75 * s0;
    this.hums[1].volume = Mathf.moveTowards(this.hums[1].volume, s1 > 0 ? 0.08 + 0.1 * s1 : 0, dt * 2);
    this.hums[1].pitch = 0.6 + 0.8 * s1 + 0.03;
  }

  // ------------------------------------------------------------------ round / match end

  private AfterRound() {
    const w = this.roundWinner;
    if (this.mode === Mode.Cpu || this.mode === Mode.Duo) {
      if (w >= 0) this.wins[w]++;
      this.UpdateHud();
      if (this.wins[0] >= 2 || this.wins[1] >= 2) { this.EndMatch(); return; }
      this.StartRound();
      return;
    }
    this.EndMatch();
  }

  private EndMatch() {
    this.step = Step.Wait;
    this.HideGuides();
    if (this.mode === Mode.Solo || this.mode === Mode.Daily) this.SoloResult();
    else if (this.mode === Mode.Cpu) this.CpuResult();
    else this.DuoResult();
  }

  private SoloResult() {
    const won = this.roundWinner === 0;
    const me = this.sim.tops[0];
    const st = this.stage!;
    const daily = this.mode === Mode.Daily;
    if (won) {
      Sfx.play(Snd.Win, 0.8);
      let stars = me.s >= 0.5 ? 3 : me.s >= 0.25 ? 2 : 1;
      if (this.revived) stars = Math.max(1, stars - 1);
      let earned: number;
      let best = false;
      if (daily) {
        const first = this.Data.get("dday") !== this.Today;
        earned = first ? 150 : 25;
        if (first) { this.Data.set("dday", this.Today); this.Data.add("dailies", 1); }
      } else {
        earned = Math.round((20 + 4 * Math.min(st.n, 50)) * (0.5 + stars * 0.25));
        const prev = this.Data.get("s" + st.n);
        if (stars > prev) { this.Data.add("stars", stars - prev); this.Data.set("s" + st.n, stars); }
        best = this.Data.max("stage", st.n + 1);
        const nowArenas = arenasUnlocked(st.n + 1);
        if (nowArenas > arenasUnlocked(st.n)) this.UI.Toast(`NEW ARENA UNLOCKED: ${Arenas[nowArenas - 1].name}!`, 3);
      }
      this.Coins = this.Coins + earned;
      this.Data.add("wins", 1);
      this.Finish(new Result({
        Headline: daily ? "DAILY RUMBLE WON!" : `STAGE ${st.n} CLEAR!`, HeadlineColor: Gold, Stars: stars, Victory: true, NewBest: false,
        BestLine: daily ? `+${earned} COINS   ·   COME BACK TOMORROW` : `+${earned} COINS   ·   ★ ${this.TotalStars} TOTAL`,
        Stats: [["SPIN LEFT", `${Math.round(Math.min(1, me.s) * 100)}%`], ["HITS", String(this.matchStats.hits)], ["COINS", `+${earned}`], ["WALLET", Fmt.n(this.Coins)]],
        Primary: daily ? "PLAY AGAIN" : "NEXT STAGE",
        Reward: () => { this.Coins = this.Coins + earned; this.UI.Toast(`+${earned} COINS: DOUBLED!`, 2.5); Sfx.play(Snd.Coin, 0.8); },
        RewardLabel: `DOUBLE COINS: +${earned} (AD)`,
      }));
      void best;
    } else {
      Sfx.play(Snd.Lose, 0.7);
      const left = this.sim.tops.filter((t) => t.alive).length;
      this.Finish(new Result({
        Headline: this.lastOut === "RING OUT" ? "RING OUT!" : "TOPPLED!", HeadlineColor: Pal.hex(0xffb0a0),
        Value: daily ? "DAILY" : `STAGE ${st.n}`,
        BestLine: `${left} RIVAL${left === 1 ? "" : "S"} STILL SPINNING`,
        Stats: [["HITS", String(this.matchStats.hits)], ["BIGGEST HIT", this.matchStats.bestHit.toFixed(0)], ["STAGE", daily ? "DAILY" : String(st.n)], ["WALLET", Fmt.n(this.Coins)]],
        Primary: "TRY AGAIN",
        Reward: this.revived || left === 0 ? null : () => this.ReSpin(),
        RewardLabel: "RE-SPIN: BACK IN AT HALF SPIN (AD)",
      }));
    }
  }

  private ReSpin() {
    this.revived = true;
    const t = this.sim.tops[0];
    t.alive = true; t.out = Out.None; t.s = 0.5; t.air = 0; t.launched = true;
    t.x = t.sx * 0.8; t.y = t.sy * 0.8; t.vx = -t.sx * 0.15; t.vy = -t.sy * 0.15; t.energy = 1;
    this.sim.winner = -1;
    this.views[0].fallT = -1; this.views[0].pop = 1;
    this.cards[0].out.text = "";
    this.Revive();
    this.step = Step.Battle; this.timer = 0;
    this.UI.Announce("RE-SPIN!", Sky, 1.2);
    Sfx.playClip(this.zip, 0.9, 1.05);
    this.fx.pop(new V2(t.x, t.y), Sky, 18, 4, 0.25, 0.5);
  }

  private CpuResult() {
    const won = this.wins[0] >= 2, d = this.diff;
    const wasPower = this.powerMatch;
    this.powerMatch = false;
    const stats: [string, string][] = [["LEVEL", DiffNames[d]], ["ROUNDS", `${this.wins[0]} – ${this.wins[1]}`], ["HITS", String(this.matchStats.hits)], ["RING OUTS", String(this.matchStats.rings)]];
    if (won) {
      Sfx.play(Snd.Win, 0.8);
      const streak = this.Data.get("streak") + 1;
      this.Data.set("streak", streak);
      const prize = Math.round(Prizes[d] * (1 + Math.min(5, streak - 1) * 0.1));
      this.Coins = this.Coins + prize;
      this.Data.add("wins", 1);
      this.Finish(new Result({
        Headline: `YOU BEAT ${CpuNames[d]}!`, HeadlineColor: Gold, Value: `+${prize}`, CountTo: prize, Victory: true,
        BestLine: `WIN STREAK ${streak}   ·   WALLET ${Fmt.n(this.Coins)}`,
        Stats: stats, Primary: "PLAY AGAIN",
        Reward: () => { this.Coins = this.Coins + prize; this.UI.Toast(`+${prize} COINS: DOUBLED!`, 2.5); Sfx.play(Snd.Coin, 0.8); },
        RewardLabel: `DOUBLE COINS: +${prize} (AD)`,
      }));
    } else {
      Sfx.play(Snd.Lose, 0.7);
      const streak = this.Data.get("streak");
      this.Data.set("streak", 0);
      this.Finish(new Result({
        Headline: `${CpuNames[d]} WINS`, HeadlineColor: Pal.hex(0xffb0a0), Value: `${this.wins[0]} – ${this.wins[1]}`,
        BestLine: streak > 1 ? `STREAK OF ${streak} ENDED` : "SO CLOSE. ONE MORE?",
        Stats: stats, Primary: "TRY AGAIN",
        Reward: wasPower ? null : () => this.PowerRematch(),
        RewardLabel: "REMATCH WITH A POWER LAUNCH (AD)",
      }));
    }
  }

  private PowerRematch() {
    this.powerMatch = true;
    this.StartRun();
    this.UI.Toast("POWER LAUNCH: FULL SPIN + EXTRA SPEED EVERY ROUND", 3);
  }

  private DuoResult() {
    Sfx.play(Snd.Win, 0.8);
    this.Data.add("duels", 1);
    const w = this.wins[0] >= 2 ? 0 : 1;
    this.Finish(new Result({
      Headline: `${this.players[w].name} WINS!`, HeadlineColor: this.players[w].color, Victory: true, Value: `${this.wins[0]} – ${this.wins[1]}`,
      BestLine: `${Arenas[this.arenaIdx].name}   ·   BEST OF 3`,
      Stats: [["HITS", String(this.matchStats.hits)], ["BIGGEST HIT", this.matchStats.bestHit.toFixed(0)], ["RING OUTS", String(this.matchStats.rings)], ["ROUNDS", String(this.round)]],
      Primary: "REMATCH",
    }));
  }

  // ------------------------------------------------------------------ guides

  private ShowGuides() {
    for (let h = 0; h < 2; h++) {
      const i = this.HumanIndex(h);
      const dots = this.guideDots[h];
      const s = this.slots[h];
      const show = i >= 0 && this.step === Step.Aim;
      if (!show) { this.HideGuide(h); continue; }
      const t = this.sim.tops[i];
      const col = this.players[i].color;
      const active = s.dragging || s.keyAim || s.locked;
      const power = active ? s.power : 0;
      // predict: the throw arc, then the glide (this top alone)
      const ghost = new Sim();
      ghost.reset(1, this.sim.arena);
      const g = ghost.tops[0];
      g.setDesign(Designs[this.players[i].design]);
      g.dir = t.dir; g.x = t.x; g.y = t.y; g.bonus = t.bonus;
      ghost.launch(0, s.aim.x, s.aim.y, Math.max(0.05, power));
      const pts: V2[] = [];
      for (let k = 0; k < 16; k++) {
        for (let j = 0; j < 14; j++) ghost.step(1 / 120);
        pts.push(new V2(g.x, g.y));
      }
      const outAt = pts.findIndex((p) => p.magnitude > R);
      for (let k = 0; k < dots.length; k++) {
        const vis = active && power > 0.02;
        const p = pts[k];
        const bad = outAt >= 0 && k >= outAt;
        const inAir = k * 14 / 120 < g.airTotal;
        dots[k].transform.localPosition = new V3(p.x, p.y, 0);
        const sc = (inAir ? 0.55 : 0.4) * (1 - k * 0.025);
        dots[k].transform.localScale = new V3(sc, sc, 1);
        dots[k].color = vis ? (bad ? Red : Color.lerp(col, Color.white, 0.4)).withAlpha((s.locked ? 0.35 : 0.9) * (1 - k / 22)) : Color.clear;
      }
      const ar = this.arrows[h];
      if (active && power > 0.02) {
        const p0 = new V2(t.x, t.y).add(s.aim.mul(1.6 + power * 0.8));
        ar.transform.localPosition = new V3(p0.x, p0.y, 0);
        ar.transform.localEulerZ = Math.atan2(s.aim.y, s.aim.x) * Mathf.Rad2Deg;
        ar.color = col.withAlpha(s.locked ? 0.4 : 0.95);
        // the string being pulled back
        const st = this.strings[h];
        const back = s.aim.neg();
        const len = 0.8 + power * 4.2;
        st.positionCount = 10;
        for (let k = 0; k < 10; k++) {
          const f = k / 9;
          const perp = new V2(-back.y, back.x).mul(Math.sin(f * Math.PI * 3 + Time.time * 18) * 0.12 * (1 - power) * f);
          st.setPosition(k, new V2(t.x, t.y).add(back.mul(0.7 + len * f)).add(perp));
        }
        st.color = Cream.withAlpha(s.locked ? 0.4 : 0.95);
        const pt = this.powerText[h];
        pt.rectTransform.anchoredPosition = this.SimToHud(new V2(t.x, t.y).add(back.mul(len + 2)));
        pt.text = s.locked ? "" : `${Math.round(power * 100)}%`;
        pt.color = Color.lerp(Green, Color.lerp(Gold, Red, Mathf.clamp01((power - 0.6) * 2.5)), Mathf.clamp01(power * 1.6));
        pt.rectTransform.localEulerAngles = new V3(0, 0, this.FlipHud(h) ? 180 : 0);
      } else { ar.color = Color.clear; this.strings[h].positionCount = 0; this.powerText[h].text = ""; }
    }
  }

  private FlipHud(h: number) { return this.mode === Mode.Duo && this.portrait && h === 1; }

  private HideGuide(h: number) {
    for (const d of this.guideDots[h]) d.color = Color.clear;
    this.arrows[h].color = Color.clear;
    this.strings[h].positionCount = 0;
    if (this.powerText.length) this.powerText[h].text = "";
  }
  private HideGuides() { for (let h = 0; h < 2; h++) this.HideGuide(h); }

  // ------------------------------------------------------------------ rendering

  private Present(dt: number) {
    const tops = this.sim.tops;
    const playing = this.State === Phase.Playing;
    for (let i = 0; i < 4; i++) {
      const v = this.views[i];
      if (i >= tops.length) { v.root.setActive(false); v.mark.color = Color.clear; continue; }
      const t = tops[i];
      v.root.setActive(true);
      // start marks while aiming
      v.mark.transform.localPosition = new V3(t.sx, t.sy, 0);
      const aiming = playing && (this.step === Step.Intro || this.step === Step.Aim || this.step === Step.Rip);
      v.mark.color = Color.lerp(Color.white, this.players[i]?.color ?? Color.white, 0.35).withAlpha(aiming ? 0.85 : Mathf.moveTowards(v.mark.color.a, 0, dt));
      const sc = Math.min(1, t.s);
      v.pop = Mathf.moveTowards(v.pop, 0, dt * 3);
      let x = t.x, y = t.y, size = 2 * t.r / 0.95;
      let lift = 0;
      if (t.air > 0 && t.airTotal > 0) { const k = 1 - t.air / t.airTotal; lift = Math.sin(k * Math.PI); }
      if (!t.launched && aiming) {
        // winding: a gentle bob at the start mark
        lift = 0.05 + 0.04 * Math.sin(Time.time * 6 + i);
      }
      // wobble as spin runs out
      let wob = 0;
      if (t.launched && t.alive && t.s < 0.35) wob = (0.35 - t.s) / 0.35;
      const wa = t.wobbleT * 2 * t.dir + i;
      const wx = Math.cos(wa) * wob * 0.22, wy = Math.sin(wa) * wob * 0.22;
      v.root.localPosition = new V3(x, y, 0);
      const fallen = !t.alive && (t.out === Out.Topple || (t.out === Out.Ring && t.outT > 0.7));
      if (fallen && v.fallT < 0) { v.fallT = 0; v.fallAng = Math.atan2(t.vy, t.vx) * Mathf.Rad2Deg + (Math.random() - 0.5) * 60; if (t.out === Out.Ring) Sfx.playClip(this.clatter, playing ? 0.5 : 0.15, 1.05); }
      if (v.fallT >= 0) v.fallT += dt;
      const fk = v.fallT >= 0 ? Mathf.clamp01(v.fallT / 0.25) : 0;
      // spin visuals
      if (t.launched && (t.alive || v.fallT < 0)) v.ang += t.dir * (2.5 + 13 * sc + 4 * wob) * dt * Mathf.Rad2Deg;
      else if (!t.launched) v.ang += t.dir * 40 * dt;
      const blurK = t.launched ? Mathf.clamp01((sc - 0.2) / 0.55) : 0;
      const s1 = size * (1 + 0.32 * lift) * (1 + 0.12 * Math.sin(v.pop * Math.PI));
      const showTop = fk < 1;
      v.body.transform.localPosition = new V3(wx, wy, 0);
      v.blur.transform.localPosition = new V3(wx, wy, 0);
      v.shine.transform.localPosition = new V3(wx, wy, 0);
      v.body.transform.localEulerZ = v.ang;
      v.blur.transform.localEulerZ = v.ang;
      const ts = s1 * (1 - fk * 0.3);
      v.body.transform.localScale = new V3(ts * (1 - wob * 0.06), ts, 1);
      v.blur.transform.localScale = new V3(ts * 1.0, ts, 1);
      v.shine.transform.localScale = new V3(ts, ts, 1);
      const alpha = showTop ? 1 - fk : 0;
      v.body.color = Color.white.withAlpha(alpha * (1 - 0.72 * blurK));
      v.blur.color = Color.white.withAlpha(alpha);
      v.shine.color = Color.white.withAlpha(alpha * 0.9);
      v.fallen.color = Color.white.withAlpha(fk);
      v.fallen.transform.localEulerZ = v.fallAng;
      v.fallen.transform.localScale = new V3(size * 1.15, size * 1.15, 1);
      v.fallen.transform.localPosition = new V3(Math.cos(v.fallAng * Mathf.Deg2Rad) * 0.3, Math.sin(v.fallAng * Mathf.Deg2Rad) * 0.3, 0);
      const sh = 0.18 + lift * 1.2 + wob * 0.12;
      v.shadow.transform.localPosition = new V3(sh * 0.7 + wx * 0.5, -sh + wy * 0.5, 0);
      v.shadow.transform.localScale = new V3(size * 1.25 * (1 - 0.25 * lift), size * 1.25 * (1 - 0.25 * lift), 1);
      v.shadow.color = new Color(0.1, 0.05, 0, (0.55 - 0.25 * lift) * (showTop ? 1 : 0.4));
      const ownerOn = t.alive && (playing || this.State === Phase.Over);
      v.owner.color = (this.players[i]?.color ?? Color.white).withAlpha(ownerOn ? 0.55 + 0.2 * Math.sin(Time.time * 5) : 0);
      v.owner.transform.localScale = new V3(size * 1.35, size * 1.35, 1);
      // scuffs while sliding fast
      if (t.alive && t.launched && t.air <= 0) {
        v.scuffT -= dt * t.speed;
        if (v.scuffT <= 0) { v.scuffT = 2.2; if (t.speed > 3) this.Scuff(new V2(t.x, t.y), Math.atan2(t.vy, t.vx) * Mathf.Rad2Deg, 0.9); }
        if (t.speed > 2.5 && Math.random() < dt * t.speed * 3) {
          const back = new V2(-t.vx, -t.vy).normalized;
          this.fx.emit(new V2(t.x, t.y).add(back.mul(t.r * 0.8)), back.mul(0.6 + Math.random()).add(new V2((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2)), this.DustColor(), 0.5 + Math.random() * 0.4, 0.5 + Math.random() * 0.3, CasualArt.Soft, 0, 0, false, 2);
        }
      }
    }
    for (const s of this.scuffs) {
      if (s.t <= 0) continue;
      s.t -= dt / 7;
      s.sr.color = new Color(1, 1, 1, Mathf.clamp01(s.t) * 0.55);
    }
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    if (!this.cards.length || this.State !== Phase.Playing) return;
    const tops = this.sim.tops;
    for (let i = 0; i < this.players.length; i++) {
      const c = this.cards[i], t = tops[i];
      if (!t) continue;
      UIKit.setMeter(c.spin, t.launched ? Math.min(1, t.s) : this.step === Step.Aim && this.players[i].human ? Sim.launchSpin(this.slots[this.players[i].slot].power) : 0);
      c.spin.color = t.s < 0.25 && t.launched && t.alive ? Color.lerp(Red, Color.white, 0.5 + 0.5 * Math.sin(Time.time * 12)) : this.players[i].color;
      UIKit.setMeter(c.energy, t.energy);
      for (let k = 0; k < 2; k++) {
        const w = this.mode === Mode.Duo || this.mode === Mode.Cpu ? this.wins[i] ?? 0 : 0;
        c.pips[k].color = k < w ? Gold : new Color(1, 1, 1, 0.2);
      }
      c.glow.color = this.players[i].color.withAlpha(t.alive ? 0.12 + (this.step === Step.Aim && !this.IsLocked(i) ? 0.2 * (0.5 + 0.5 * Math.sin(Time.time * 6)) : 0) : 0);
      c.icon.rectTransform.localEulerAngles = new V3(0, 0, c.icon.rectTransform.localEulerAngles.z - (t.alive && t.launched ? 300 * Math.min(1, t.s) : 0) * Time.deltaTime);
      c.icon.color = t.alive ? Color.white : new Color(1, 1, 1, 0.35);
      c.spinBg.setActive(t.alive || !t.launched);
      if (this.players[i].human) c.energyBg.setActive(t.alive || !t.launched);
    }
    // info line
    const m = this.mode;
    this.infoText.text = m === Mode.Solo ? `STAGE ${this.stage?.n} · ${this.stage?.title}` : m === Mode.Daily ? `DAILY · ${this.stage?.title}`
      : m === Mode.Cpu ? `ROUND ${this.round} · ${DiffNames[this.diff]}` : `ROUND ${this.round} · BEST OF 3`;
    // aim prompts near each human's mark
    for (let h = 0; h < 2; h++) {
      const i = this.HumanIndex(h);
      const at = this.aimText[h];
      const s = this.slots[h];
      if (i < 0 || this.step !== Step.Aim) { if (this.step !== Step.Rip) at.text = ""; this.Stick(h, false); continue; }
      const t = tops[i];
      if (this.mode === Mode.Duo && !this.portrait) at.rectTransform.anchoredPosition = this.SimToHud(new V2(t.sx, t.sy)).add(new V2(0, 150));
      else at.rectTransform.anchoredPosition = this.SimToHud(new V2(t.sx, t.sy).add(new V2(t.sx, t.sy).normalized.mul(3.3)));
      at.rectTransform.localEulerAngles = new V3(0, 0, this.FlipHud(h) ? 180 : 0);
      const secs = Math.max(0, Math.ceil(this.aimClock));
      if (!s.locked) at.text = s.dragging ? (s.power > 0.02 ? "LET GO TO THROW!" : "PULL BACK FURTHER") : s.keyAim ? `${this.mode === Mode.Duo && h === 1 ? "ENTER" : "SPACE"} TO THROW  ${secs}` : `PULL BACK & LET GO  ${secs}`;
      at.color = s.locked ? Green : this.aimClock < 4 ? Color.lerp(Red, Color.white, 0.5 + 0.5 * Math.sin(Time.time * 10)) : Color.white;
    }
    if (this.step === Step.Battle) for (let h = 0; h < 2; h++) this.Stick(h, this.slots[h].dragging && this.HumanIndex(h) >= 0);
  }

  private IsLocked(i: number) { const p = this.players[i]; return p.human ? this.slots[p.slot].locked : this.planned[i] && this.timer >= this.cpuLockAt[i]; }

  private Stick(h: number, on: boolean) {
    const s = this.slots[h];
    const col = OwnerCols[h];
    if (!on) { s.stickBase.color = col.withAlpha(0); s.stickKnob.color = col.withAlpha(0); return; }
    const o = this.SimToHud(s.start), c = this.SimToHud(s.cur);
    s.stickBase.rectTransform.anchoredPosition = o;
    s.stickKnob.rectTransform.anchoredPosition = o.add(V2.clampMagnitude(c.sub(o), 90));
    s.stickBase.color = col.withAlpha(0.5);
    s.stickKnob.color = col.withAlpha(0.45);
  }
}
