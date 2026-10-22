import {
  ArcadeGame, Art, AudioClip, Camera, Sprite, CasualFx, CasualLook, CasualUI, Color, Fmt, Fx, GameInfo, GameObject, howTo, Image, Keyboard,
  Mathf, Mouse, overUI, Pal, Phase, Random, Result, Screen, Sfx, Snd, SpriteRenderer, Text, Time, Touchscreen,
  TouchScheme, UIKit, UINode, V2, V3, dp,
} from "../../kit";
import { BlockDropArt, Gold, Ink, KindColors, P1Color, P2Color } from "./BlockDropArt";
import { BoardView, ViewStyle } from "./BoardView";
import { BotDriver } from "./Bot";
import { Engine, LockReport, Spin } from "./Engine";

/**
 * BLOCK DROP: the falling-blocks line-clear puzzle with candy-jelly pieces. Rotate, shift and drop the seven
 * four-block pieces into a 10×20 well; full rows clear. Modern feel: 7-bag, SRS-style kicks, hold, five-piece
 * preview, ghost, soft/hard drop, lock delay with move reset, DAS/ARR, combos, back-to-back and spin bonuses.
 * Modes: MARATHON (endless, levels speed up), ULTRA (2-minute score attack), VS CPU (split screen against a bot at
 * three levels; clears send garbage rows) and 2 PLAYERS on one device (keyboard WASD + arrows, or each half of a
 * touch screen). Rewarded continue clears the bottom four rows.
 */

enum Mode { Marathon, Ultra, Vs, Duo }
const ModeNames = ["MARATHON", "ULTRA 2:00", "VS CPU", "2 PLAYERS"];
const ModeHelp = [
  "MARATHON: endless. Every 10 lines the speed goes up.",
  "ULTRA: score as much as you can in 2 minutes.",
  "VS CPU: clear lines to send garbage rows. Top out the computer!",
  "2 PLAYERS: one device. Keys WASD + SPACE vs ARROWS + ENTER, or each half of a touch screen.",
];
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const DiffColors = [Pal.hex(0x8be04e), Gold, Pal.hex(0xff5f7a)];
const UltraTime = 120;
const DAS = 0.16, ARR = 0.033;
const TopBand = 250;

interface KeyMap { left: string[]; right: string[]; soft: string[]; hard: string[]; cw: string[]; ccw: string[]; hold: string[] }
const SoloKeys: KeyMap = {
  left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], soft: ["ArrowDown", "KeyS"], hard: ["Space"],
  cw: ["ArrowUp", "KeyX", "KeyW"], ccw: ["KeyZ", "ControlLeft", "KeyQ"], hold: ["KeyC", "ShiftLeft", "ShiftRight", "KeyE"],
};
const P1Keys: KeyMap = { left: ["KeyA"], right: ["KeyD"], soft: ["KeyS"], hard: ["Space"], cw: ["KeyW"], ccw: ["KeyQ"], hold: ["KeyE", "ShiftLeft"] };
const P2Keys: KeyMap = {
  left: ["ArrowLeft"], right: ["ArrowRight"], soft: ["ArrowDown"], hard: ["Enter", "NumpadEnter", "Numpad0"], cw: ["ArrowUp"],
  ccw: ["Period", "ControlRight", "Numpad1"], hold: ["ShiftRight", "Slash", "Numpad2"],
};

/** One finger (or the mouse) dragging on a board. */
interface Gesture {
  id: number; player: number;
  start: V2; anchor: V2; startTime: number;
  axis: 0 | 1 | 2; // 0 undecided, 1 horizontal, 2 vertical (soft drop)
  moved: boolean;
  samples: { t: number; p: V2 }[];
}

/**
 * Pointer velocity from raw DOM events with their own timestamps, so flicks are measured precisely even when the
 * frame rate dips (the kit only exposes per-frame positions).
 */
const PointerLog = {
  log: new Map<number, { t: number; x: number; y: number }[]>(),
  upAt: new Map<number, number>(),
  downAt: new Map<number, number>(),
  attached: false,
  attach() {
    if (this.attached) return;
    this.attached = true;
    const key = (e: PointerEvent) => (e.pointerType === "mouse" ? -1 : e.pointerId);
    const rec = (e: PointerEvent) => {
      const id = key(e);
      let a = this.log.get(id);
      if (!a || e.type === "pointerdown") { a = []; this.log.set(id, a); this.upAt.delete(id); this.downAt.set(id, e.timeStamp / 1000); }
      a.push({ t: e.timeStamp / 1000, x: e.clientX, y: e.clientY });
      while (a.length > 2 && a[a.length - 1].t - a[0].t > 0.1) a.shift();
    };
    window.addEventListener("pointerdown", rec, true);
    window.addEventListener("pointermove", rec, true);
    window.addEventListener("pointerup", (e) => this.upAt.set(key(e), e.timeStamp / 1000), true);
  },
  /** Seconds the pointer was down (from event timestamps); null when unknown. */
  duration(id: number) { const d = this.downAt.get(id), u = this.upAt.get(id); return d !== undefined && u !== undefined ? u - d : null; },
  /** Release velocity in device px/s, y up (Unity screen convention); null when unknown. */
  velocity(id: number): V2 | null {
    const a = this.log.get(id);
    if (!a || a.length < 2) return null;
    const up = this.upAt.get(id) ?? a[a.length - 1].t;
    const f = a[0], l = a[a.length - 1];
    if (up - l.t > 0.15) return V2.zero; // the finger stopped before lifting
    const dt = Math.max(0.008, l.t - f.t);
    return new V2((l.x - f.x) / dt, -(l.y - f.y) / dt).mul(Screen.dpr);
  },
};

/** An on-screen touch button (pointer-down, held state, multi-touch safe). */
class PadButton {
  held = false;
  pressed = 0;
  readonly bg: Image;
  constructor(parent: UINode, icon: SpriteLike, label: string, color: Color) {
    this.bg = UIKit.img(parent, "Pad", Art.UiRound, color.withAlpha(0.3), true);
    UIKit.img(this.bg.rectTransform, "Edge", Art.UiOutline, color.withAlpha(0.8)).rectTransform.stretch();
    if (icon) UIKit.img(this.bg.rectTransform, "Icon", icon, Color.white).rectTransform.place(UIKit.Center, new V2(0, label ? 12 : 0), new V2(64, 64));
    if (label) UIKit.at(UIKit.label(this.bg.rectTransform, label, 24, Color.white), new V2(0.5, 0), new V2(0, 26), new V2(160, 30));
    const el = this.bg.rectTransform.el;
    el.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); this.held = true; this.pressed++; this.bg.color = color.withAlpha(0.7); Fx.haptic(); });
    const up = () => { this.held = false; this.bg.color = color.withAlpha(0.3); };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
  }
  take() { const p = this.pressed > 0; this.pressed = 0; return p; }
}
type SpriteLike = Sprite | null;

class Player {
  engine: Engine;
  view: BoardView;
  bot: BotDriver | null = null;
  keys: KeyMap | null = null;
  name = "";
  color = P1Color;
  // DAS state
  dir = 0; dasT = 0;
  hardRows = 0;
  sent = 0;
  alive = true;
  nameText: Text | null = null;
  infoText: Text | null = null;
  constructor(engine: Engine, view: BoardView) { this.engine = engine; this.view = view; }
}

export class BlockDropGame extends ArcadeGame {
  static readonly Pointers = PointerLog;
  private world!: GameObject;
  private bgCover!: SpriteRenderer;
  private bokeh: { sr: SpriteRenderer; v: V2; ph: number }[] = [];
  private fx!: CasualFx;
  private views: BoardView[] = [];
  private players: Player[] = [];
  private demo: Player | null = null;
  private demoBot: BotDriver | null = null;
  private gestures = new Map<number, Gesture>();
  private mode = Mode.Marathon;
  private diff = 1;
  private buttonsMode = false;
  private countdown = 0;
  private ending = 0;
  private winner = -1;
  private timeLeft = UltraTime;
  private vsClock = 0;
  private continues = 0;
  private lastLevel = 1;
  private built = false;
  private announcedBest = false;

  // HUD
  private scoreText!: Text; private subText!: Text; private timerText!: Text;
  private holdLabel: Text[] = []; private nextLabel: Text[] = [];
  private nameTexts: Text[] = []; private infoTexts: Text[] = [];
  private holdButton!: Image;
  private pad!: UINode;
  private padButtons: Record<string, PadButton> = {};
  private modeButton!: ReturnType<typeof UIKit.buttonAt>; private diffButton!: ReturnType<typeof UIKit.buttonAt>; private ctrlButton!: ReturnType<typeof UIKit.buttonAt>;
  private modeLabel!: Text;

  // sounds
  private sMove!: AudioClip; private sRotate!: AudioClip; private sLock!: AudioClip; private sHard!: AudioClip; private sHold!: AudioClip;
  private sClear!: AudioClip; private sQuad!: AudioClip; private sGarbage!: AudioClip; private sSoft!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "blockdrop",
      Title: "BLOCK DROP",
      Tagline: "ROTATE. DROP. CLEAR THE LINES!",
      PlayLabel: "PLAY",
      Accent: Pal.hex(0xff5fa8),
      Accent2: Gold,
      BgTop: Pal.hex(0x3a1c78),
      BgBottom: Pal.hex(0x120a30),
      ShortSide: 20,
      Touch: TouchScheme.None,
      Music: { bpm: 128, rootHz: 110, degrees: [0, 5, 3, 4], seed: 64, energy: 0.6, major: false },
      Reminders: [
        "One more line?|Your candy well is waiting in Block Drop.",
        "Beat the CPU|Send garbage rows and top out the computer.",
        "Ultra score attack|How many points can you get in 2 minutes?",
      ],
      HowTo: [
        howTo(BlockDropArt.Block, KindColors[3], "Move and rotate the falling pieces. Fill a whole row to clear it."),
        howTo(BlockDropArt.IconDrop, KindColors[1], "TOUCH: tap = rotate · drag = move · drag down = soft drop · flick down = drop · flick up = hold."),
        howTo(BlockDropArt.IconRight, KindColors[7], "KEYS: ← → move · ↑/X rotate · Z rotate back · ↓ soft · SPACE drop · C hold."),
        howTo(BlockDropArt.IconHold, KindColors[2], "HOLD keeps a piece for later. The ghost shows where it lands."),
        howTo(Art.Star, Gold, "Clear 4 rows at once for a QUAD. Chain clears for combos; spins and back-to-backs pay extra."),
        howTo(Art.Diamond, KindColors[5], "VERSUS: your clears send garbage rows. Clear to cancel what's coming!"),
        howTo(Art.Ring, KindColors[6], "2 PLAYERS: WASD + SPACE (Q/E) vs ARROWS + ENTER (. / R-SHIFT), or one half of the screen each."),
      ],
      Tips: [
        "Keep the stack flat and leave one column open for a QUAD.",
        "Use HOLD to save the long piece for a big clear.",
        "The ghost shows where your piece will land.",
        "Clearing lines cancels incoming garbage first.",
        "Back-to-back QUADs send extra garbage.",
        "You can still slide a piece for half a second after it lands.",
      ],
    });
  }

  protected get ShortSide() { return 20; }

  protected BestLine() {
    if (this.mode === Mode.Vs) return `VS ${DiffNames[this.diff]}:  ${this.Data.get("w" + this.diff)} WON  ·  ${this.Data.get("l" + this.diff)} LOST`;
    if (this.mode === Mode.Duo) return `PLAYER 1  ${this.Data.get("p1")}  –  ${this.Data.get("p2")}  PLAYER 2`;
    const b = this.Data.get("best" + this.mode);
    return b > 0 ? `${ModeNames[this.mode]} BEST  ${Fmt.n(b)}` : "";
  }

  protected StatsLine() {
    const g = this.Data.get("games");
    return g > 0 ? `${g} GAMES   ·   ${Fmt.n(this.Data.get("lines"))} LINES CLEARED   ·   BEST LEVEL ${Math.max(1, this.Data.get("maxLevel"))}` : "THE FALLING-BLOCKS CLASSIC, CANDY STYLE";
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("BlockDrop", this.gameObject);
    CasualLook.calm(this, 1.2, 0.2);
    this.bgCover = CasualLook.cover(this.world, BlockDropArt.Backdrop, -910);
    const bokehColors = [KindColors[1], KindColors[3], KindColors[6], KindColors[7], Gold];
    for (let i = 0; i < 16; i++) {
      const sr = Art.spr(this.world, "Bokeh", BlockDropArt.Bokeh, bokehColors[i % bokehColors.length].withAlpha(0.1), Random.range(1.5, 5), -850);
      sr.transform.localPosition = new V3(Random.range(-20, 20), Random.range(-15, 15), 0);
      this.bokeh.push({ sr, v: new V2(Random.range(-0.3, 0.3), Random.range(0.1, 0.5)), ph: Random.range(0, 6) });
    }
    this.fx = CasualFx.create(this.world, 60, 220);
    this.mode = Mathf.clamp(this.Data.get("mode"), 0, 3) as Mode;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.buttonsMode = this.Data.get("buttons") === 1;
    for (let i = 0; i < 2; i++) this.views.push(new BoardView(this.world, i === 0 ? P1Color : P2Color));
    this.BuildHud();
    CasualLook.titleCard(this.UI, new Color(0.09, 0.04, 0.22, 0.8));
    this.BuildTitle();
    this.BuildSounds();
    PointerLog.attach();
    this.built = true;
    this.Layout();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.scoreText = UIKit.at(UIKit.label(hud, "0", 72, Color.white), new V2(0.5, 1), new V2(0, -85), new V2(700, 90));
    UIKit.glow(this.scoreText, Ink, 4);
    this.subText = UIKit.at(UIKit.label(hud, "", 30, new Color(1, 0.85, 0.95, 0.9)), new V2(0.5, 1), new V2(0, -155), new V2(800, 40));
    UIKit.glow(this.subText, Ink, 3);
    this.timerText = UIKit.at(UIKit.label(hud, "", 40, Gold), new V2(0.5, 1), new V2(0, -205), new V2(400, 50));
    UIKit.glow(this.timerText, Ink, 3);
    for (let i = 0; i < 2; i++) {
      const h = UIKit.label(hud, "HOLD", 24, new Color(1, 1, 1, 0.75));
      h.rectTransform.place(new V2(0.5, 0.5), V2.zero, new V2(200, 32));
      this.holdLabel.push(h);
      const n = UIKit.label(hud, "NEXT", 24, new Color(1, 1, 1, 0.75));
      n.rectTransform.place(new V2(0.5, 0.5), V2.zero, new V2(200, 32));
      this.nextLabel.push(n);
      const nm = UIKit.label(hud, "", 30, Color.white);
      nm.rectTransform.place(new V2(0.5, 0.5), V2.zero, new V2(500, 40));
      UIKit.glow(nm, Ink, 3);
      this.nameTexts.push(nm);
      const inf = UIKit.label(hud, "", 24, new Color(1, 1, 1, 0.8));
      inf.rectTransform.place(new V2(0.5, 0.5), V2.zero, new V2(500, 34));
      UIKit.glow(inf, Ink, 2);
      this.infoTexts.push(inf);
    }
    // touch: HOLD button bottom-left (gesture mode)
    this.holdButton = UIKit.img(hud, "HoldBtn", Art.UiRound, KindColors[2].withAlpha(0.28), true);
    this.holdButton.rectTransform.place(new V2(0, 0), new V2(130, 95), new V2(200, 120));
    UIKit.img(this.holdButton.rectTransform, "Edge", Art.UiOutline, KindColors[2].withAlpha(0.8)).rectTransform.stretch();
    UIKit.img(this.holdButton.rectTransform, "Icon", BlockDropArt.IconHold, Color.white).rectTransform.place(UIKit.Center, new V2(-52, 0), new V2(46, 46));
    UIKit.at(UIKit.label(this.holdButton.rectTransform, "HOLD", 30, Color.white), UIKit.Center, new V2(24, 0), new V2(100, 40));
    this.holdButton.rectTransform.el.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); this.HumanHold(0); });
    // button pad
    this.pad = UIKit.node("Pad", hud).place(new V2(0.5, 0), new V2(0, 130), new V2(1060, 230));
    const defs: [string, SpriteLike, string, Color][] = [
      ["hold", BlockDropArt.IconHold, "HOLD", KindColors[2]], ["ccw", BlockDropArt.IconCCW, "", KindColors[6]],
      ["left", BlockDropArt.IconLeft, "", KindColors[7]], ["soft", BlockDropArt.IconDown, "", KindColors[3]],
      ["right", BlockDropArt.IconRight, "", KindColors[7]], ["cw", BlockDropArt.IconCW, "", KindColors[6]],
      ["hard", BlockDropArt.IconDrop, "DROP", KindColors[1]],
    ];
    defs.forEach(([id, icon, label, col], i) => {
      const b = new PadButton(this.pad, icon, label, col);
      b.bg.rectTransform.place(UIKit.Center, new V2((i - 3) * 150, 0), new V2(138, 200));
      this.padButtons[id] = b;
    });
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    this.modeButton = UIKit.buttonAt(ex, "MODE", UIKit.Center, new V2(-330, 10), new V2(320, 100), false, () => this.CycleMode(), 28);
    this.diffButton = UIKit.buttonAt(ex, "CPU", UIKit.Center, new V2(0, 10), new V2(300, 100), false, () => this.CycleDiff(), 28);
    this.ctrlButton = UIKit.buttonAt(ex, "TOUCH", UIKit.Center, new V2(330, 10), new V2(320, 100), false, () => this.ToggleControls(), 26);
    this.modeLabel = UIKit.at(UIKit.wrap(UIKit.label(ex, "", 24, new Color(1, 1, 1, 0.85))), UIKit.Center, new V2(0, -72), new V2(980, 60));
    this.RefreshTitle();
  }

  private RefreshTitle() {
    if (!this.modeButton) return;
    CasualUI.setText(this.modeButton.label!, ModeNames[this.mode]);
    this.modeButton.setAccent(KindColors[[1, 2, 5, 7][this.mode]]);
    CasualUI.setText(this.diffButton.label!, this.mode === Mode.Vs ? "CPU: " + DiffNames[this.diff] : "LEVEL 1");
    this.diffButton.setAccent(this.mode === Mode.Vs ? DiffColors[this.diff] : Pal.TextDim);
    this.diffButton.interactable = this.mode === Mode.Vs;
    CasualUI.setText(this.ctrlButton.label!, this.buttonsMode ? "TOUCH: BUTTONS" : "TOUCH: SWIPE");
    this.ctrlButton.setAccent(KindColors[3]);
    this.modeLabel.text = ModeHelp[this.mode];
  }

  private CycleMode() {
    this.mode = ((this.mode + 1) % 4) as Mode;
    this.Data.set("mode", this.mode);
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private CycleDiff() {
    this.diff = (this.diff + 1) % 3;
    this.Data.set("diff", this.diff);
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private ToggleControls() {
    this.buttonsMode = !this.buttonsMode;
    this.Data.set("buttons", this.buttonsMode ? 1 : 0);
    this.RefreshTitle();
    this.UI.Toast(this.buttonsMode ? "On-screen buttons: ◀ ▶ move, ▼ soft drop, DROP, rotate both ways and HOLD." : "Swipe: tap rotates, drag moves cell by cell, drag down soft-drops, flick down drops, flick up holds.", 3.5);
  }

  private BuildSounds() {
    const noise = (t: number) => (Math.sin(t * 12345.678) * 43758.5453) % 1;
    this.sMove = Sfx.make("bd-move", 0.04, (t) => Sfx.sqrP(t * 1400) * Sfx.env(t, 0.001, 0.03) * 0.05);
    this.sRotate = Sfx.make("bd-rot", 0.08, (t) => Sfx.sinP(Sfx.glide(t, 700, 1100, 0.06)) * Sfx.env(t, 0.002, 0.07) * 0.18);
    this.sSoft = Sfx.make("bd-soft", 0.03, (t) => Sfx.triP(t * 520) * Sfx.env(t, 0.001, 0.025) * 0.08);
    this.sLock = Sfx.make("bd-lock", 0.12, (t) => (Sfx.sinP(Sfx.glide(t, 240, 120, 0.1)) * 0.6 + noise(t) * 0.15 * Sfx.env(t, 0.001, 0.02)) * Sfx.env(t, 0.002, 0.1) * 0.35);
    this.sHard = Sfx.make("bd-hard", 0.22, (t) => (Sfx.sinP(Sfx.glide(t, 180, 55, 0.18)) * 0.8 + noise(t) * 0.35 * Sfx.env(t, 0.001, 0.05)) * Sfx.env(t, 0.002, 0.2) * 0.5);
    this.sHold = Sfx.make("bd-hold", 0.16, (t) => Sfx.sinP(Sfx.glide(t, 500, 900, 0.14)) * Sfx.env(t, 0.01, 0.14) * 0.16 + Sfx.sinP(Sfx.glide(t, 750, 1350, 0.14)) * Sfx.env(t, 0.01, 0.14) * 0.06);
    this.sClear = Sfx.make("bd-clear", 0.5, (t) => {
      const a = Sfx.sinP(523 * t) * Sfx.env(t, 0.002, 0.3) + Sfx.sinP(659 * t) * Sfx.env(Math.max(0, t - 0.05), 0.002, 0.3) + Sfx.sinP(784 * t) * Sfx.env(Math.max(0, t - 0.1), 0.002, 0.35);
      const shimmer = Sfx.sinP(2093 * t) * Sfx.env(t, 0.01, 0.4) * 0.15;
      return a * 0.13 + shimmer;
    });
    this.sQuad = Sfx.make("bd-quad", 0.9, (t) => {
      const notes = [523, 659, 784, 1047, 1319];
      let s = 0;
      notes.forEach((f, i) => { const tt = t - i * 0.06; if (tt > 0) s += (Sfx.sinP(f * tt) + Sfx.triP(f * 2 * tt) * 0.3) * Sfx.env(tt, 0.002, 0.5); });
      return s * 0.1 + noise(t) * Sfx.env(t, 0.001, 0.15) * 0.08;
    });
    this.sGarbage = Sfx.make("bd-garbage", 0.35, (t) => (Sfx.sawP(Sfx.glide(t, 90, 60, 0.3)) * 0.5 + noise(t) * 0.3) * Sfx.env(t, 0.01, 0.3) * 0.25);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private get TouchUI() { return Touchscreen.present || (matchMedia?.("(pointer: coarse)").matches ?? false); }

  private BottomBand() {
    if (!this.TouchUI) return 40;
    if (this.State !== Phase.Title && this.mode !== Mode.Duo && this.buttonsMode) return 270;
    return this.mode === Mode.Duo ? 40 : 150;
  }

  private Layout() {
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    this.Fx.CameraTarget = V2.zero;
    if (!this.built) return;
    const title = this.State === Phase.Title || this.players.length === 0;
    const r = this.PlayRect(title ? 330 : TopBand, title ? 60 : this.BottomBand(), 0.3);
    const v0 = this.views[0], v1 = this.views[1];
    const fitIn = (w: number, h: number) => Math.min(r.width / w, r.height / h);
    const centerOf = (b: { xMin: number; xMax: number; yMin: number; yMax: number }, s: number, c: V2) =>
      new V2(c.x - ((b.xMin + b.xMax) / 2) * s, c.y - ((b.yMin + b.yMax) / 2) * s);
    const two = !title && (this.mode === Mode.Vs || this.mode === Mode.Duo);
    if (!two) {
      const b = BoardView.bounds(ViewStyle.Full, false);
      let s = fitIn(b.xMax - b.xMin, b.yMax - b.yMin);
      if (title) s *= 0.75;
      const c = title ? new V2(r.center.x, r.center.y) : r.center;
      v0.place(centerOf(b, s, c), s, ViewStyle.Full, 5);
      v0.setVisible(true);
      v1.setVisible(false);
      if (title) v0.root.localPosition = v0.root.localPosition.withY(v0.root.localPosition.y);
    } else {
      const full = BoardView.bounds(ViewStyle.Full, true), comp = BoardView.bounds(ViewStyle.Compact, true);
      const fw = full.xMax - full.xMin, fh = full.yMax - full.yMin, cw = comp.xMax - comp.xMin, ch = comp.yMax - comp.yMin;
      const gap = 1;
      if (this.mode === Mode.Vs) {
        // A: equal full boards side by side. B: small CPU board stacked above the player's.
        const sA = fitIn(fw * 2 + gap, fh);
        const ratio = 0.4;
        const sB = fitIn(Math.max(fw, cw * ratio), fh + ch * ratio + 0.4);
        if (sA >= sB) {
          v0.place(centerOf(full, sA, new V2(r.center.x - (fw + gap) * 0.5 * sA, r.center.y)), sA, ViewStyle.Full, 3);
          v1.place(centerOf(full, sA, new V2(r.center.x + (fw + gap) * 0.5 * sA, r.center.y)), sA, ViewStyle.Full, 3);
        } else {
          const totalH = (fh + ch * ratio + 0.4) * sB;
          const top = r.center.y + totalH / 2;
          const cpuS = sB * ratio;
          v1.place(centerOf(comp, cpuS, new V2(r.center.x, top - ch * cpuS / 2)), cpuS, ViewStyle.Compact, 1);
          v0.place(centerOf(full, sB, new V2(r.center.x, top - ch * cpuS - 0.4 * sB - fh * sB / 2)), sB, ViewStyle.Full, 3);
        }
      } else {
        const sA = fitIn(fw * 2 + gap, fh), sB = fitIn(cw * 2 + gap, ch);
        const style = sA >= sB ? ViewStyle.Full : ViewStyle.Compact;
        const s = Math.max(sA, sB), w = style === ViewStyle.Full ? fw : cw, b = style === ViewStyle.Full ? full : comp;
        v0.place(centerOf(b, s, new V2(r.center.x - (w + gap) * 0.5 * s, r.center.y)), s, style, 3);
        v1.place(centerOf(b, s, new V2(r.center.x + (w + gap) * 0.5 * s, r.center.y)), s, style, 3);
      }
      v0.setVisible(true);
      v1.setVisible(true);
    }
    this.PlaceLabels();
    this.RefreshControlsUI();
  }

  /** HUD canvas units per world unit. */
  private get UiPerWorld() { return 1080 / Math.min(this.ViewSize.x, this.ViewSize.y); }

  private PlaceLabels() {
    const title = this.State === Phase.Title || this.players.length === 0;
    const two = !title && (this.mode === Mode.Vs || this.mode === Mode.Duo);
    for (let i = 0; i < 2; i++) {
      const v = this.views[i];
      const on = v.root.activeSelf && this.State !== Phase.Title;
      const k = v.scale * this.UiPerWorld;
      const showPanels = on && v.style === ViewStyle.Full;
      this.holdLabel[i].gameObject.setActive(showPanels);
      this.nextLabel[i].gameObject.setActive(showPanels);
      if (showPanels) {
        this.holdLabel[i].rectTransform.anchoredPosition = this.UI.WorldToHud(v.world(v.holdLabelPos()));
        this.nextLabel[i].rectTransform.anchoredPosition = this.UI.WorldToHud(v.world(v.nextLabelPos()));
        this.holdLabel[i].fontSize = this.nextLabel[i].fontSize = Math.round(Mathf.clamp(k * 0.62, 14, 30));
      }
      this.nameTexts[i].gameObject.setActive(on && two);
      this.infoTexts[i].gameObject.setActive(on && two);
      if (on && two) {
        this.nameTexts[i].rectTransform.anchoredPosition = this.UI.WorldToHud(v.world(new V2(0, -11.3)));
        this.infoTexts[i].rectTransform.anchoredPosition = this.UI.WorldToHud(v.world(new V2(0, -12.3)));
        this.nameTexts[i].fontSize = Math.round(Mathf.clamp(k * 0.85, 16, 38));
        this.infoTexts[i].fontSize = Math.round(Mathf.clamp(k * 0.62, 13, 28));
      }
    }
  }

  private RefreshControlsUI() {
    const playing = this.State === Phase.Playing || this.State === Phase.Paused;
    const touch = this.TouchUI;
    const solo = this.mode !== Mode.Duo;
    this.pad.setActive(playing && touch && solo && this.buttonsMode);
    this.holdButton.gameObject.setActive(playing && touch && solo && !this.buttonsMode);
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.players = [];
    this.gestures.clear();
    this.RefreshTitle();
    this.StartDemo();
    this.Layout();
  }

  private StartDemo() {
    const e = new Engine((Math.random() * 1e9) | 0);
    e.levelFromLines = false;
    e.reset(1);
    e.level = 4;
    this.demo = new Player(e, this.views[0]);
    this.demoBot = new BotDriver(1, Math.random);
    this.demoBot.reset();
    e.onSpawn = () => this.demoBot?.newPiece();
    e.onLock = (r) => this.views[0].onLock(r.cells, 0, r.kind);
  }

  protected BeginRun() {
    this.demo = null;
    this.demoBot = null;
    this.mode = Mathf.clamp(this.Data.get("mode"), 0, 3) as Mode;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.buttonsMode = this.Data.get("buttons") === 1;
    this.players = [];
    this.gestures.clear();
    const seed = (Math.random() * 1e9) | 0;
    const count = this.mode === Mode.Vs || this.mode === Mode.Duo ? 2 : 1;
    for (let i = 0; i < count; i++) {
      // both players get the same piece sequence in versus (fair race)
      const e = new Engine(seed);
      e.levelFromLines = this.mode === Mode.Marathon || this.mode === Mode.Ultra;
      e.reset(1);
      const p = new Player(e, this.views[i]);
      p.color = i === 0 ? P1Color : P2Color;
      this.views[i].accent = p.color;
      this.views[i].dead = 0;
      this.views[i].danger = 0;
      if (this.mode === Mode.Vs && i === 1) {
        p.bot = new BotDriver(this.diff, Math.random);
        p.bot.reset();
        p.name = "CPU · " + DiffNames[this.diff];
      } else if (this.mode === Mode.Duo) {
        p.keys = i === 0 ? P1Keys : P2Keys;
        p.name = i === 0 ? "PLAYER 1" : "PLAYER 2";
      } else {
        p.keys = SoloKeys;
        p.name = "YOU";
      }
      const idx = i;
      e.onSpawn = () => { p.bot?.newPiece(); };
      e.onLock = (r) => this.OnLock(idx, r);
      e.onGarbage = (n) => this.OnGarbage(idx, n);
      this.players.push(p);
    }
    this.countdown = 1.6;
    this.ending = 0;
    this.winner = -1;
    this.timeLeft = UltraTime;
    this.vsClock = 0;
    this.continues = 0;
    this.lastLevel = 1;
    this.announcedBest = false;
    this.fx.clear();
    this.Data.add("games", 1);
    this.Layout();
    this.UpdateHud();
    this.UI.Announce("READY", Gold, 0.9);
    if (this.Data.get("games") <= 2) this.UI.Toast(this.TouchUI ? (this.mode === Mode.Duo ? "Each player uses one half of the screen: tap rotates, drag moves, flick down drops." : "Tap to rotate · drag to move · flick down to drop · flick up to hold") : this.mode === Mode.Duo ? "P1: WASD + SPACE (Q / E)   ·   P2: ARROWS + ENTER (. / RIGHT SHIFT)" : "← → move · ↑ rotate · ↓ soft drop · SPACE drop · C hold", 4);
    Sfx.setIntensity(0.3);
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.AnimateBackdrop(dt);
    if (this.State === Phase.Title && this.demo && this.demoBot) {
      const e = this.demo.engine;
      if (e.over || e.stackHeight() > 15) { this.StartDemo(); return; }
      this.demoBot.tick(e, dt);
      e.tick(dt);
      this.views[0].render(e, dt);
    } else if (this.State === Phase.Over) {
      for (const p of this.players) { p.view.dead = Math.min(1, p.view.dead + (p.alive ? 0 : dt * 2)); p.view.render(p.engine, dt); }
    }
  }

  private AnimateBackdrop(dt: number) {
    const hw = this.ViewSize.x * 0.6 + 3, hh = this.ViewSize.y * 0.6 + 3;
    for (const b of this.bokeh) {
      b.ph += dt;
      const lp = b.sr.transform.localPosition;
      let p = new V2(lp.x, lp.y).add(b.v.mul(dt));
      if (p.y > hh) p = new V2(Random.range(-hw, hw), -hh);
      if (p.x > hw) p = p.withX(-hw); else if (p.x < -hw) p = p.withX(hw);
      b.sr.transform.localPosition = new V3(p.x, p.y, 0);
      b.sr.color = b.sr.color.withAlpha(0.07 + 0.05 * Math.sin(b.ph * 0.8));
    }
  }

  protected TickRun(dt: number) {
    this.AnimateBackdrop(dt);
    if (this.countdown > 0) {
      const before = this.countdown;
      this.countdown -= dt;
      if (before > 0.6 && this.countdown <= 0.6) { this.UI.Announce("GO!", KindColors[3], 0.7); Sfx.play(Snd.Start, 0.6); }
      for (const p of this.players) p.view.render(p.engine, dt);
      this.ReadGestures(true);
      return;
    }
    if (this.ending > 0) {
      this.ending -= dt;
      for (const p of this.players) { if (!p.alive) p.view.dead = Math.min(1, p.view.dead + dt * 1.6); p.view.render(p.engine, dt); }
      if (this.ending <= 0) this.End();
      return;
    }
    this.ReadGestures(false);
    if (this.mode === Mode.Vs || this.mode === Mode.Duo) {
      this.vsClock += dt;
      const lvl = Math.min(15, 1 + Math.floor(this.vsClock / 20));
      for (const p of this.players) p.engine.level = lvl;
      if (lvl !== this.lastLevel) { this.lastLevel = lvl; this.UI.Float(V2.zero.withY(this.ViewSize.y * 0.3), "SPEED UP!", Gold, 1.1); Sfx.play(Snd.PowerUp, 0.4); }
    }
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive) continue;
      if (p.keys) this.HumanKeys(i, dt);
      if (p.bot) {
        const a = p.bot.tick(p.engine, dt);
        if (a === "rotate" || a === "move") Sfx.playClip(a === "rotate" ? this.sRotate : this.sMove, 0.15, 1.1);
      }
      const level = p.engine.level;
      p.engine.tick(dt);
      if (p.engine.level > level && this.mode !== Mode.Vs && this.mode !== Mode.Duo) this.LevelUp(p);
      if (p.engine.over && p.alive) this.TopOut(i);
    }
    if (this.mode === Mode.Ultra && this.ending <= 0) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 10 && Math.floor(this.timeLeft + dt) !== Math.floor(this.timeLeft) && this.timeLeft > 0) Sfx.play(Snd.Tick, 0.6, 1.2);
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.ending = 0.9; this.UI.Announce("TIME!", Gold, 1); Sfx.play(Snd.Win, 0.6); }
    }
    // danger
    let maxDanger = 0;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const h = p.engine.stackHeight();
      p.view.danger = Mathf.clamp01((h - 13) / 5);
      if (!p.bot) maxDanger = Math.max(maxDanger, p.view.danger);
      p.view.render(p.engine, dt);
    }
    this.Back.setDanger(maxDanger * 0.6);
    Sfx.setIntensity(0.3 + maxDanger * 0.5);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ human input

  private keyHeld(codes: string[]) { return codes.some((c) => Keyboard.key(c).isPressed); }
  private keyPressed(codes: string[]) { return codes.some((c) => Keyboard.key(c).wasPressedThisFrame); }

  private HumanKeys(i: number, dt: number) {
    const p = this.players[i], k = p.keys!;
    const pad = i === 0 && this.mode !== Mode.Duo && this.pad.activeSelf ? this.padButtons : null;
    if (this.keyPressed(k.cw) || pad?.cw.take()) this.HumanRotate(i, 1);
    if (this.keyPressed(k.ccw) || pad?.ccw.take()) this.HumanRotate(i, -1);
    if (this.keyPressed(k.hold) || pad?.hold.take()) this.HumanHold(i);
    const plp = pad ? pad.left.take() : false, prp = pad ? pad.right.take() : false;
    const l = this.keyHeld(k.left) || !!pad?.left.held, r = this.keyHeld(k.right) || !!pad?.right.held;
    const lp = this.keyPressed(k.left) || plp, rp = this.keyPressed(k.right) || prp;
    this.Das(i, l, r, lp, rp, dt);
    if (pad) pad.soft.take();
    p.engine.softDropping = this.keyHeld(k.soft) || !!pad?.soft.held;
    if (this.keyPressed(k.hard) || pad?.hard.take()) this.HumanHardDrop(i);
  }

  private Das(i: number, l: boolean, r: boolean, lp: boolean, rp: boolean, dt: number) {
    const p = this.players[i];
    let dir = 0;
    if (lp) dir = -1; else if (rp) dir = 1; else if (l && p.dir === -1) dir = -1; else if (r && p.dir === 1) dir = 1; else if (l) dir = -1; else if (r) dir = 1;
    if (dir === 0) { p.dir = 0; return; }
    if (dir !== p.dir || lp || rp) {
      p.dir = dir;
      p.dasT = DAS;
      this.HumanMove(i, dir);
      return;
    }
    p.dasT -= dt;
    let guard = 0;
    while (p.dasT <= 0 && guard++ < 10) {
      p.dasT += ARR;
      if (!this.HumanMove(i, dir, true)) { p.dasT = Math.max(p.dasT, 0); break; }
    }
  }

  private HumanMove(i: number, dir: number, repeat = false) {
    const ok = this.players[i].engine.move(dir);
    if (ok) Sfx.playClip(this.sMove, repeat ? 0.25 : 0.45, 1 + Math.random() * 0.1);
    return ok;
  }

  private HumanRotate(i: number, dir: 1 | -1) {
    if (this.State !== Phase.Playing || this.countdown > 0 || this.ending > 0) return;
    if (this.players[i].engine.rotate(dir)) Sfx.playClip(this.sRotate, 0.45, dir > 0 ? 1 : 0.9);
  }

  private HumanHold(i: number) {
    if (this.State !== Phase.Playing || this.countdown > 0 || this.ending > 0 || !this.players[i]) return;
    if (this.players[i].engine.holdPiece()) Sfx.playClip(this.sHold, 0.6);
    else Sfx.play(Snd.Deny, 0.3);
  }

  private HumanHardDrop(i: number) {
    if (this.State !== Phase.Playing || this.countdown > 0 || this.ending > 0) return;
    const p = this.players[i];
    if (p.engine.busy) return;
    p.hardRows = p.engine.ghostY() < p.engine.active!.y ? p.engine.active!.y - p.engine.ghostY() : 0;
    p.engine.hardDrop();
  }

  /** Swipe controls: per finger, each assigned to a board (halves in 2 players). */
  private ReadGestures(countdown: boolean) {
    const now = Time.unscaledTime;
    const seen = new Set<number>();
    const handle = (id: number, pos: V2, down: boolean, pressed: boolean, released: boolean) => {
      seen.add(id);
      let g = this.gestures.get(id);
      if (pressed && !g) {
        if (pos.y > Screen.height * 0.9 || overUI(pos)) return;
        const player = this.mode === Mode.Duo ? (pos.x < Screen.width * 0.5 ? 0 : 1) : 0;
        if (!this.players[player] || this.players[player].bot) return;
        for (const o of this.gestures.values()) if (o.player === player) return; // one finger per board
        g = { id, player, start: pos, anchor: pos, startTime: now, axis: 0, moved: false, samples: [{ t: now - 1 / 60, p: pos }] };
        this.gestures.set(id, g);
        if (!released && down) return;
      }
      if (!g) return;
      g.samples.push({ t: now, p: pos });
      while (g.samples.length > 2 && now - g.samples[0].t > 0.1) g.samples.shift();
      if (!countdown) this.GestureMove(g, pos);
      if (released || !down) {
        if (!countdown) this.GestureEnd(g, pos, now);
        this.gestures.delete(id);
      }
    };
    for (const t of Touchscreen.touches) handle(t.touchId, t.position, t.press.isPressed, t.press.wasPressedThisFrame, t.press.wasReleasedThisFrame);
    if (Mouse.present && Touchscreen.touches.length === 0) {
      const b = Mouse.leftButton;
      if (b.isPressed || b.wasPressedThisFrame || b.wasReleasedThisFrame) handle(-1, Mouse.position, b.isPressed, b.wasPressedThisFrame, b.wasReleasedThisFrame);
    }
    for (const id of [...this.gestures.keys()]) if (!seen.has(id)) this.gestures.delete(id);
  }

  private CellPx(player: number) { return Math.max(this.players[player].view.scale * Camera.ppu, dp(11)); }

  private GestureMove(g: Gesture, pos: V2) {
    const p = this.players[g.player];
    if (!p || !p.alive) return;
    const step = this.CellPx(g.player);
    const total = pos.sub(g.start);
    if (g.axis === 0 && total.magnitude > step * 0.55) {
      g.axis = -total.y > Math.abs(total.x) * 1.3 ? 2 : Math.abs(total.x) >= Math.abs(total.y) ? 1 : 0;
      if (g.axis === 0 && total.y > step * 1.5) g.axis = 2; // upward drags wait for the flick
      g.anchor = g.axis === 1 ? new V2(g.start.x, pos.y) : g.axis === 2 ? new V2(pos.x, g.start.y) : g.anchor;
      g.moved = g.axis !== 0;
    }
    if (g.axis === 1) {
      let dx = pos.x - g.anchor.x;
      let guard = 0;
      while (Math.abs(dx) >= step && guard++ < 12) {
        const dir = Math.sign(dx);
        this.HumanMove(g.player, dir);
        g.anchor = g.anchor.withX(g.anchor.x + dir * step);
        dx = pos.x - g.anchor.x;
      }
      // a clear downward pull switches to soft drop
      if (g.anchor.y - pos.y > step * 2.2 && Math.abs(pos.x - g.anchor.x) < step) { g.axis = 2; g.anchor = new V2(pos.x, g.anchor.y); }
    } else if (g.axis === 2) {
      let dy = g.anchor.y - pos.y;
      let guard = 0;
      while (dy >= step && guard++ < 25) {
        if (p.engine.softStep()) Sfx.playClip(this.sSoft, 0.3, 1);
        g.anchor = g.anchor.withY(g.anchor.y - step);
        dy = g.anchor.y - pos.y;
      }
      if (dy < -step * 0.5) g.anchor = g.anchor.withY(pos.y - step * 0.5 * 0); // finger moved back up: re-anchor
      if (Math.abs(pos.x - g.anchor.x) > step * 1.6) { g.axis = 1; g.anchor = new V2(g.anchor.x, pos.y); }
    }
  }

  private GestureEnd(g: Gesture, pos: V2, now: number) {
    const p = this.players[g.player];
    if (!p || !p.alive) return;
    const first = g.samples[0];
    const dtS = Math.max(0.016, now - first.t);
    const vel = PointerLog.velocity(g.id) ?? pos.sub(first.p).div(dtS);
    const total = pos.sub(g.start);
    const step = this.CellPx(g.player);
    const flick = dp(650);
    if (-vel.y > flick && -total.y > step * 1.2 && -total.y > Math.abs(total.x) * 1.2) { this.HumanHardDrop(g.player); return; }
    if (vel.y > flick && total.y > step * 1.5 && total.y > Math.abs(total.x) * 1.2) { this.HumanHold(g.player); return; }
    if (!g.moved && total.magnitude < dp(16) && (PointerLog.duration(g.id) ?? now - g.startTime) < 0.4) {
      // tap on the hold box = hold, otherwise rotate (left third of a board rotates back)
      const w = this.ScreenToWorld(pos);
      const v = p.view;
      const local = w.sub(v.center).div(v.scale);
      const hr = v.holdRect();
      if (Math.abs(local.x - hr.c.x) < hr.half && Math.abs(local.y - hr.c.y) < hr.half) { this.HumanHold(g.player); return; }
      this.HumanRotate(g.player, 1);
    }
  }

  // ------------------------------------------------------------------ events

  private OnLock(i: number, r: LockReport) {
    const p = this.players[i];
    if (!p) return;
    p.view.onLock(r.cells, p.hardRows, r.kind);
    if (p.hardRows > 0) Sfx.playClip(this.sHard, p.bot ? 0.25 : 0.7, 1 + Math.random() * 0.08);
    else Sfx.playClip(this.sLock, p.bot ? 0.2 : 0.55);
    p.hardRows = 0;
    if (r.lines > 0) {
      const big = r.lines >= 4 || r.spin === Spin.Full || r.allClear;
      Sfx.playClip(big ? this.sQuad : this.sClear, p.bot ? 0.45 : 0.9, 1 + Math.max(0, r.combo) * 0.06);
      // particles along the cleared rows
      for (const y of r.rows) {
        for (let x = 0; x < 10; x += 1) {
          const k = p.engine.grid[y * 10 + x];
          const w = p.view.world(new V2(x - 4.5, y - 9.5));
          this.fx.pop(w, KindColors[k] ?? Color.white, 3, 5 * p.view.scale, 0.28 * p.view.scale, 0.45);
        }
      }
      const mid = p.view.world(new V2(0, r.rows[0] - 9.5));
      let label = r.label;
      if (r.b2b && label) label = "B2B " + label;
      if (label) this.UI.Float(mid.add(new V2(0, 1)), label, r.allClear ? Gold : r.lines >= 4 ? KindColors[1] : KindColors[3], big ? 1.35 : 1.05);
      if (r.combo > 0) this.UI.Float(mid.add(new V2(0, -1)), `COMBO ×${r.combo}`, KindColors[7], 0.9);
      if (r.score > 0 && this.mode !== Mode.Vs && this.mode !== Mode.Duo) this.UI.Float(mid, "+" + Fmt.n(r.score), Color.white, 0.8);
      if (big) {
        this.Fx.shake(0.25);
        p.view.shake(0.18);
        Fx.haptic(true);
        this.fx.confetti(mid.add(new V2(0, 2)), 26, 9, [KindColors[1], KindColors[2], KindColors[3], KindColors[7], Gold]);
        if (r.allClear) this.UI.Announce("ALL CLEAR!", Gold, 1.3);
      } else Fx.haptic();
      if (r.lines > 0) this.Data.add("lines", r.lines);
    }
    if (r.sent > 0 && this.players.length > 1) {
      const o = this.players[1 - i];
      if (o.alive) {
        o.engine.receive(r.sent);
        p.sent += r.sent;
        this.UI.Float(p.view.world(new V2(0, 4)), `+${r.sent} ▶`, Pal.hex(0xff5f7a), 1);
        this.SendBeam(p, o, r.sent);
      }
    }
  }

  private SendBeam(from: Player, to: Player, n: number) {
    const a = from.view.world(new V2(0, 0)), b = to.view.world(new V2(-5.6, -8));
    for (let k = 0; k < 6 + n * 3; k++) {
      const t = k / (6 + n * 3);
      const pos = V2.lerp(a, b, t * 0.15);
      this.fx.emit(pos, b.sub(a).mul(1.4 + Random.range(0, 0.6)).add(Random.insideUnitCircle.mul(1.2)), Pal.hex(0xff5f7a), 0.35 * to.view.scale, 0.65, null, 0, 0, true, 0.6);
    }
  }

  private OnGarbage(i: number, n: number) {
    const p = this.players[i];
    p.view.bump(0.08 + n * 0.02);
    Sfx.playClip(this.sGarbage, p.bot ? 0.4 : 0.8);
    if (!p.bot) { this.Fx.shake(0.12); Fx.haptic(true); this.Back.Flash(Pal.hex(0xff3355), 0.25); }
  }

  private LevelUp(p: Player) {
    this.UI.Announce("LEVEL " + p.engine.level, KindColors[7], 1.1);
    Sfx.play(Snd.PowerUp, 0.6);
    this.fx.sparkle(p.view.world(new V2(0, 8)), Gold, 10, 3, 0.6);
    this.Data.max("maxLevel", p.engine.level);
  }

  private TopOut(i: number) {
    const p = this.players[i];
    p.alive = false;
    p.engine.over = true;
    Sfx.play(Snd.Lose, p.bot ? 0.5 : 0.8);
    this.Fx.shake(0.35);
    if (this.players.length > 1) {
      this.winner = 1 - i;
      const w = this.players[this.winner];
      this.UI.Announce(this.mode === Mode.Duo ? `${w.name} WINS!` : w.bot ? "CPU WINS" : "YOU WIN!", w.color, 1.4);
      if (!w.bot) this.fx.confetti(w.view.world(new V2(0, 6)), 60, 10, [KindColors[1], KindColors[2], KindColors[3], KindColors[7], Gold]);
    } else this.UI.Announce("TOPPED OUT", Pal.hex(0xff5f7a), 1.2);
    this.ending = 1.4;
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    const ps = this.players;
    if (ps.length === 0) return;
    const e = ps[0].engine;
    const two = ps.length > 1;
    this.scoreText.gameObject.setActive(!two);
    if (!two) {
      CasualUI.setText(this.scoreText, Fmt.n(e.score));
      CasualUI.setText(this.subText, `LEVEL ${e.level}   ·   LINES ${e.lines}`);
      const best = this.Data.get("best" + this.mode);
      if (!this.announcedBest && best > 0 && e.score > best) { this.announcedBest = true; this.UI.Float(V2.zero.withY(this.ViewSize.y * 0.35), "NEW BEST!", Gold, 1.2); Sfx.play(Snd.NewBest, 0.5); }
      this.subText.rectTransform.anchoredPosition = new V2(0, -155);
    } else {
      CasualUI.setText(this.subText, `SPEED ${e.level}   ·   ${Fmt.clock(this.vsClock)}`);
      this.subText.rectTransform.anchoredPosition = new V2(0, -95);
      for (let i = 0; i < 2; i++) {
        const p = ps[i];
        CasualUI.setText(this.nameTexts[i], p.name);
        this.nameTexts[i].color = p.color;
        CasualUI.setText(this.infoTexts[i], `LINES ${p.engine.lines}  ·  SENT ${p.sent}`);
      }
    }
    this.timerText.gameObject.setActive(this.mode === Mode.Ultra);
    if (this.mode === Mode.Ultra) {
      CasualUI.setText(this.timerText, "⏱ " + Fmt.clock(Math.ceil(this.timeLeft)));
      this.timerText.color = this.timeLeft <= 10 ? Pal.hex(0xff5f7a) : Gold;
    }
  }

  // ------------------------------------------------------------------ results

  private End() {
    const ps = this.players;
    if (this.mode === Mode.Duo) {
      const w = this.winner;
      if (w >= 0) this.Data.add(w === 0 ? "p1" : "p2", 1);
      this.Finish(new Result({
        Headline: w >= 0 ? `${ps[w].name} WINS!` : "DRAW",
        HeadlineColor: w >= 0 ? ps[w].color : Color.white,
        Value: `${this.Data.get("p1")} – ${this.Data.get("p2")}`,
        BestLine: "PLAYER 1  –  PLAYER 2",
        Stats: [["P1 LINES", String(ps[0].engine.lines)], ["P2 LINES", String(ps[1].engine.lines)], ["P1 SENT", String(ps[0].sent)], ["P2 SENT", String(ps[1].sent)]],
        Primary: "REMATCH",
        Victory: w >= 0,
      }));
      return;
    }
    if (this.mode === Mode.Vs) {
      const won = this.winner === 0;
      if (won) { this.Data.add("w" + this.diff, 1); this.Data.add("streak", 1); this.Data.max("streakBest", this.Data.get("streak")); }
      else { this.Data.add("l" + this.diff, 1); this.Data.set("streak", 0); }
      const me = ps[0];
      this.Finish(new Result({
        Headline: won ? "YOU WIN!" : "CPU WINS",
        HeadlineColor: won ? Gold : Pal.hex(0xffc6d6),
        Value: won ? "VICTORY" : "SO CLOSE!",
        Stars: won ? this.diff + 1 : 0,
        BestLine: `VS ${DiffNames[this.diff]}:  ${this.Data.get("w" + this.diff)} WON  ·  ${this.Data.get("l" + this.diff)} LOST`,
        Stats: [["LINES", String(me.engine.lines)], ["GARBAGE SENT", String(me.sent)], ["TIME", Fmt.clock(this.vsClock)], ["WIN STREAK", String(this.Data.get("streak"))]],
        Primary: won ? "PLAY AGAIN" : "REMATCH",
        Victory: won,
        Reward: !won && this.continues === 0 ? () => this.Continue() : null,
        RewardLabel: "CLEAR 4 ROWS & CONTINUE (AD)",
      }));
      return;
    }
    const e = ps[0].engine;
    const key = "best" + this.mode;
    const prev = this.Data.get(key);
    const newBest = this.Data.max(key, e.score);
    this.Data.max("maxLevel", e.level);
    const timeUp = this.mode === Mode.Ultra && this.timeLeft <= 0;
    this.Finish(new Result({
      Headline: timeUp ? "TIME'S UP!" : this.mode === Mode.Ultra ? "TOPPED OUT" : "GAME OVER",
      HeadlineColor: timeUp ? Gold : Pal.hex(0xffc6d6),
      Value: Fmt.n(e.score),
      CountTo: e.score,
      NewBest: newBest && prev > 0,
      BestLine: `BEST  ${Fmt.n(Math.max(prev, e.score))}`,
      Stats: [["LINES", String(e.lines)], ["LEVEL", String(e.level)], ["QUADS", String(e.quads)], ["MAX COMBO", String(Math.max(0, e.maxCombo))]],
      Victory: newBest,
      Reward: !timeUp && this.continues === 0 ? () => this.Continue() : null,
      RewardLabel: "CLEAR 4 ROWS & CONTINUE (AD)",
    }));
  }

  private Continue() {
    this.continues++;
    const p = this.players[0];
    p.engine.clearBottom(4);
    p.alive = true;
    p.view.dead = 0;
    if (this.players.length > 1) this.players[1].engine.pendingGarbage = [];
    this.winner = -1;
    this.ending = 0;
    this.countdown = 1.2;
    this.gestures.clear();
    this.Revive();
    this.Layout();
    this.UI.Announce("CONTINUE!", KindColors[3], 1);
    this.fx.sparkle(p.view.world(new V2(0, -8)), Gold, 14, 4, 0.7);
    Sfx.play(Snd.PowerUp, 0.7);
  }

  protected OnPauseChanged(paused: boolean) {
    if (!paused) this.gestures.clear();
    for (const p of this.players) p.engine.softDropping = false;
  }
}

