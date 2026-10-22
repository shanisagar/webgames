import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, CasualUI, Color, Fx, GameInfo, GameObject, howTo,
  Image, Keyboard, Mathf, Pal, Phase, Result, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer, Text, TextAnchor, Time,
  TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";

/**
 * FOUR UP: classic four-in-a-row. Drop discs into the 7×6 grid; the first to line up four (across, down or
 * diagonally) wins. Play against a CPU with three difficulty levels (a real alpha-beta search on bitboards), or pass
 * the phone for two players. HINT shows the best column (rewarded ads refill it) and a rewarded ad can take back a
 * losing move. All visuals are UI elements on the HUD canvas. (Port of FourUpGame.cs.)
 */

const W = 7, H = 6;
const TopBand = 320, BottomBand = 200;
const Ink = Pal.hex(0x14204a), BoardBlue = Pal.hex(0x2f6bff), BackColor = Pal.hex(0x101a3d), Red = Pal.hex(0xff4d5e), Yellow = Pal.hex(0xffc93c), Gold = Pal.hex(0xffd86b);
const DiffNames = ["EASY", "NORMAL", "HARD"];
const Order = [3, 2, 4, 1, 5, 0, 6];
const IntMin = -2147483648;

// ------------------------------------------------------------------ 64-bit helpers
// The C# engine uses ulong bitboards (49 bits). JS bitwise ops are 32-bit, so each board is a (lo, hi) pair of
// unsigned 32-bit words; these helpers do the few 64-bit operations the engine needs.

const bitLo = (i: number) => (i < 32 ? (1 << i) >>> 0 : 0);
const bitHi = (i: number) => (i >= 32 ? (1 << (i - 32)) >>> 0 : 0);

/** (lo, hi) >> k for 0 < k < 32. */
const shrLo = (lo: number, hi: number, k: number) => ((lo >>> k) | (hi << (32 - k))) >>> 0;

function pop32(x: number) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

const toBig = (lo: number, hi: number) => (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);

// ------------------------------------------------------------------ bitboard engine (column-major, 7 bits per column)

class Engine {
  readonly BbLo = [0, 0];
  readonly BbHi = [0, 0];
  readonly Height = new Array<number>(W).fill(0);
  readonly Moves = new Array<number>(W * H).fill(0);
  Count = 0;
  // Top = 0b1000000_1000000_1000000_1000000_1000000_1000000_1000000
  private static readonly TopBits = [6, 13, 20, 27, 34, 41, 48];
  private static readonly TopLo = Engine.TopBits.reduce((m, b) => (m | bitLo(b)) >>> 0, 0);
  private static readonly TopHi = Engine.TopBits.reduce((m, b) => (m | bitHi(b)) >>> 0, 0);
  private static readonly windowsLo: number[] = [];
  private static readonly windowsHi: number[] = [];

  static {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let c = 0; c < W; c++)
      for (let r = 0; r < H; r++)
        for (const d of dirs) {
          const ec = c + d[0] * 3, er = r + d[1] * 3;
          if (ec < 0 || ec >= W || er < 0 || er >= H) continue;
          let lo = 0, hi = 0;
          for (let i = 0; i < 4; i++) {
            const b = (c + d[0] * i) * 7 + r + d[1] * i;
            lo = (lo | bitLo(b)) >>> 0;
            hi = (hi | bitHi(b)) >>> 0;
          }
          Engine.windowsLo.push(lo);
          Engine.windowsHi.push(hi);
        }
  }

  Reset() {
    this.BbLo[0] = this.BbLo[1] = this.BbHi[0] = this.BbHi[1] = 0;
    for (let c = 0; c < W; c++) this.Height[c] = c * 7;
    this.Count = 0;
  }

  get Turn() { return this.Count & 1; }
  CanPlay(c: number) { const h = this.Height[c]; return ((bitLo(h) & Engine.TopLo) | (bitHi(h) & Engine.TopHi)) === 0; }
  RowOf(c: number) { return this.Height[c] - c * 7; }
  Play(c: number) {
    const p = this.Count & 1, h = this.Height[c]++;
    this.BbLo[p] = (this.BbLo[p] ^ bitLo(h)) >>> 0;
    this.BbHi[p] = (this.BbHi[p] ^ bitHi(h)) >>> 0;
    this.Moves[this.Count++] = c;
  }
  Undo() {
    const c = this.Moves[--this.Count], p = this.Count & 1, h = --this.Height[c];
    this.BbLo[p] = (this.BbLo[p] ^ bitLo(h)) >>> 0;
    this.BbHi[p] = (this.BbHi[p] ^ bitHi(h)) >>> 0;
  }
  get Full() { return this.Count >= W * H; }

  static IsWin(lo: number, hi: number) {
    for (const d of [1, 7, 6, 8]) {
      const ylo = (lo & shrLo(lo, hi, d)) >>> 0, yhi = (hi & (hi >>> d)) >>> 0;
      if (((ylo & shrLo(ylo, yhi, 2 * d)) | (yhi & (yhi >>> (2 * d)))) !== 0) return true;
    }
    return false;
  }

  /** The winning window of a board as a bit mask (0n when none). */
  WinMask(lo: number, hi: number): bigint {
    for (let i = 0; i < Engine.windowsLo.length; i++) {
      const wl = Engine.windowsLo[i], wh = Engine.windowsHi[i];
      if (((lo & wl) >>> 0) === wl && ((hi & wh) >>> 0) === wh) return toBig(wl, wh);
    }
    return 0n;
  }

  private Evaluate(me: number) {
    const aLo = this.BbLo[me], aHi = this.BbHi[me], oLo = this.BbLo[me ^ 1], oHi = this.BbHi[me ^ 1];
    let s = 0;
    for (let i = 0; i < Engine.windowsLo.length; i++) {
      const wl = Engine.windowsLo[i], wh = Engine.windowsHi[i];
      const maLo = aLo & wl, maHi = aHi & wh, moLo = oLo & wl, moHi = oHi & wh;
      if ((maLo | maHi) !== 0 && (moLo | moHi) !== 0) continue;
      const ca = pop32(maLo) + pop32(maHi), co = pop32(moLo) + pop32(moHi);
      if (ca === 3) s += 40; else if (ca === 2) s += 6; else if (ca === 1) s += 1;
      if (co === 3) s -= 48; else if (co === 2) s -= 6; else if (co === 1) s -= 1;
    }
    const center = (0b111111 << (3 * 7)) >>> 0; // column 3 lies entirely in the low word
    s += (pop32(aLo & center) - pop32(oLo & center)) * 4;
    return s;
  }

  Nodes = 0;

  private Negamax(depth: number, alpha: number, beta: number, ply: number): number {
    this.Nodes++;
    const me = this.Count & 1;
    // a move that wins right away
    for (let i = 0; i < W; i++) {
      const c = Order[i];
      if (!this.CanPlay(c)) continue;
      this.Play(c);
      const win = Engine.IsWin(this.BbLo[me], this.BbHi[me]);
      this.Undo();
      if (win) return 100000 - ply;
    }
    if (this.Full) return 0;
    if (depth === 0) return this.Evaluate(me);
    let best = -1000000;
    for (let i = 0; i < W; i++) {
      const c = Order[i];
      if (!this.CanPlay(c)) continue;
      this.Play(c);
      const v = -this.Negamax(depth - 1, -beta, -alpha, ply + 1);
      this.Undo();
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  /** Scores for every column (int.MinValue when full) from the side to move. */
  Score(depth: number) {
    const res = new Array<number>(W).fill(0);
    this.Nodes = 0;
    const me = this.Count & 1;
    for (let c = 0; c < W; c++) {
      if (!this.CanPlay(c)) { res[c] = IntMin; continue; }
      this.Play(c);
      res[c] = Engine.IsWin(this.BbLo[me], this.BbHi[me]) ? 100000 : -this.Negamax(depth - 1, -1000000, 1000000, 1);
      this.Undo();
    }
    return res;
  }
}

// ------------------------------------------------------------------ state

class Disc {
  Img!: Image;
  Col = 0; Row = 0; Player = 0;
  Y = 0; Vy = 0; TargetY = 0;
  Landed = false;
}

// ------------------------------------------------------------------ art

const DiscSprite = () => CasualArt.make("fu-disc", 128, 128, (p) => {
  const px = 2 / 128;
  const r = p.magnitude;
  const d = r - 0.95;
  let v = Mathf.lerp(0.82, 1, CasualArt.smooth(-0.9, 0.7, p.y));
  const ring = Math.abs(r - 0.66) - 0.05;
  v = Mathf.lerp(v, 0.78, CasualArt.fill(ring, px) * 0.8);
  const inner = r - 0.6;
  v = Mathf.lerp(v, Mathf.lerp(0.9, 1, CasualArt.smooth(0.5, -0.5, p.y)), CasualArt.fill(inner, px) * 0.6);
  const hl = new V2((p.x + 0.3) / 0.35, (p.y - 0.5) / 0.18).magnitude - 1;
  v = Mathf.lerp(v, 1.25, CasualArt.fill(hl * 0.15, px) * 0.6);
  v = Math.min(1, v);
  return new Color(v, v, v, CasualArt.fill(d, px));
});

const HoleCell = () => CasualArt.make("fu-hole", 128, 128, (p) => {
  const px = 2 / 128;
  const r = p.magnitude;
  const hole = r - 0.78;
  let v = Mathf.lerp(0.85, 1, CasualArt.smooth(-1, 1, p.y));
  // bevel around the hole
  const rim = CasualArt.smooth(0.78, 0.95, r);
  const shade = V2.dot(p.normalized, new V2(0, 1));
  v *= Mathf.lerp(1 - shade * 0.15, 1, rim);
  return new Color(v, v, v, CasualArt.fill(-hole, px));
});

const PanelSprite = () => CasualArt.make("fu-panel", 96, 96, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.96, 0.96), 0.22);
  return new Color(1, 1, 1, CasualArt.fill(d, 2 / 96));
}, 28, 100);

const ArrowSprite = () => CasualArt.make("fu-arrow", 64, 64, (p) => {
  const d = Math.max(Math.abs(p.x) * 1.2 - p.y * 0.9 - 0.6, p.y - 0.6);
  return new Color(1, 1, 1, CasualArt.fill(d * 0.7, 2 / 64));
});

export class FourUpGame extends ArcadeGame {
  private world!: GameObject;
  private bgCover!: SpriteRenderer;
  private board!: UINode; private back!: UINode; private discLayer!: UINode; private frontLayer!: UINode; private gridRoot!: UINode;
  private ghost!: Image; private arrow!: Image;
  private holes: Image[] = [];
  private discs: Disc[] = [];
  private eng = new Engine();
  private pointer = new TapPointer();
  private fx!: CasualFx;
  private rng = new SysRandom();

  private cs = 0; private bw = 0; private bh = 0; private cy = 0; private lastW = 0; private lastH = 0;
  private cpuTimer = 0; private endTimer = 0; private hintTimer = 0; private attract = 0;
  private aimCol = 3; private hintCol = -1; private mode = 0; private diff = 0; private human = 0; private winner = -1; private revives = 0;
  private built = false; private ended = false; private busy = false;
  private winMask = 0n;

  private turnText: Text | null = null; private scoreText!: Text; private modeLabel!: Text;
  private turnDisc!: Image;
  private hintButton!: ArcadeButton; private modeButton: ArcadeButton | null = null; private diffButton!: ArcadeButton;
  private dropClip!: AudioClip; private landClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "fourup",
      Title: "FOUR UP",
      Tagline: "DROP. BLOCK. LINE UP FOUR!",
      Accent: Red,
      Accent2: Yellow,
      BgTop: Pal.hex(0x1f3a8a),
      BgBottom: Pal.hex(0x0e1a44),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 104, rootHz: 130.8, degrees: [0, 3, 5, 4], seed: 27, energy: 0.35, major: true },
      Reminders: [
        "The CPU wants a rematch|Can you line up four first?",
        "Beat HARD mode|Only the best players win against it.",
        "Play with a friend|Two players on one phone in Four Up.",
      ],
      HowTo: [
        howTo(Art.Chevron, Red, "TAP a column (or drag and release) to drop your disc."),
        howTo(Art.Disc, Yellow, "Discs fall to the lowest free space in the column."),
        howTo(Art.Star, Gold, "Line up FOUR of your colour across, down or diagonally to win."),
        howTo(Art.Diamond, Pal.Danger, "Watch out: block your opponent's three-in-a-rows!"),
        howTo(Art.Ring, BoardBlue, "Choose VS CPU (three levels) or 2 PLAYERS on the title screen."),
      ],
      Tips: [
        "The middle column is the strongest.",
        "Make two threats at once: they can only block one.",
        "Before you drop, check what the space above gives your opponent.",
        "Build from the bottom up and keep options open.",
        "Diagonals are the easiest lines to miss.",
      ],
    });
  }

  protected get ShortSide() { return 9; }
  private get Hints() { return this.Data.get("hint", 3); }
  private set Hints(v: number) { this.Data.set("hint", Math.max(0, v)); }

  protected BestLine() {
    const d = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    return `VS CPU ${DiffNames[d]}:  ${this.Data.get("w" + d)} WON  ·  ${this.Data.get("l" + d)} LOST`;
  }

  protected StatsLine() { return `${this.Data.get("games")} GAMES   ·   BEST STREAK ${this.Data.get("streakBest")}`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("FourWorld", this.gameObject);
    CasualLook.calm(this, 1.3, 0.12);
    this.bgCover = CasualLook.cover(this.world, CasualArt.gradient(Pal.hex(0x2a4db0), Pal.hex(0x0e1a44), new Color(0.5, 0.7, 1, 0.3)), -910);
    this.fx = CasualFx.create(this.world, 60, 140);

    this.board = UIKit.node("Board", this.UI.Hud).stretch();
    this.board.setAsFirstSibling();
    this.gridRoot = UIKit.node("Grid", this.board);
    this.back = UIKit.img(this.gridRoot, "Back", PanelSprite(), BackColor).rectTransform;
    this.ghost = UIKit.img(this.gridRoot, "Ghost", DiscSprite(), new Color(1, 1, 1, 0));
    this.arrow = UIKit.img(this.gridRoot, "Arrow", ArrowSprite(), new Color(1, 1, 1, 0));
    this.discLayer = UIKit.node("Discs", this.gridRoot).stretch();
    this.frontLayer = UIKit.node("Front", this.gridRoot).stretch();
    for (let i = 0; i < W * H; i++) {
      this.holes.push(UIKit.img(this.frontLayer, "Cell", HoleCell(), BoardBlue));
      this.holes[i].raycastTarget = false;
    }

    const hud = this.UI.Hud;
    this.turnDisc = UIKit.img(hud, "TurnDisc", DiscSprite(), Red);
    this.turnDisc.rectTransform.place(new V2(0.5, 1), new V2(-230, -120), new V2(70, 70));
    this.turnText = UIKit.at(UIKit.label(hud, "", 46, Color.white, TextAnchor.MiddleLeft), new V2(0.5, 1), new V2(60, -120), new V2(520, 70));
    UIKit.glow(this.turnText, Ink, 4);
    this.scoreText = UIKit.at(UIKit.label(hud, "", 30, new Color(0.8, 0.86, 1, 1)), new V2(0.5, 1), new V2(0, -195), new V2(900, 44));
    this.hintButton = UIKit.buttonAt(hud, "HINT", new V2(0.5, 0), new V2(0, 100), new V2(340, 120), false, () => this.OnHint(), 30);
    this.hintButton.setAccent(Yellow);

    if (this.UI.TitleExtra) {
      this.modeButton = UIKit.buttonAt(this.UI.TitleExtra, "VS CPU", UIKit.Center, new V2(-190, 10), new V2(340, 110), false, () => this.ToggleMode(), 30);
      this.diffButton = UIKit.buttonAt(this.UI.TitleExtra, "NORMAL", UIKit.Center, new V2(190, 10), new V2(340, 110), false, () => this.CycleDiff(), 30);
      this.modeButton.setAccent(Red);
      this.diffButton.setAccent(Yellow);
      this.modeLabel = UIKit.at(UIKit.label(this.UI.TitleExtra, "", 24, new Color(1, 1, 1, 0.8)), UIKit.Center, new V2(0, -70), new V2(800, 34));
    }

    this.dropClip = Sfx.make("fu-drop", 0.12, (t) => Sfx.sinP(Sfx.glide(t, 900, 500, 0.1)) * Sfx.env(t, 0.002, 0.1) * 0.15);
    this.landClip = Sfx.make("fu-land", 0.16, (t) => (Sfx.sinP(Sfx.glide(t, 260, 140, 0.12)) * 0.7 + (new SysRandom(Math.trunc(t * 44100)).nextDouble() * 2 - 1) * 0.25 * Sfx.env(t, 0.001, 0.03)) * Sfx.env(t, 0.002, 0.13) * 0.4);
    this.built = true;
    this.eng.Reset();
    this.Layout();
    this.RefreshTitle();
  }

  private ToggleMode() {
    this.Data.set("mode", this.Data.get("mode") === 0 ? 1 : 0);
    this.Data.flush();
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
  }

  private CycleDiff() {
    this.Data.set("diff", (Mathf.clamp(this.Data.get("diff", 1), 0, 2) + 1) % 3);
    this.Data.flush();
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private RefreshTitle() {
    if (!this.modeButton) return;
    const m = this.Data.get("mode"), d = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    if (this.modeButton.label) this.modeButton.label.text = m === 0 ? "VS CPU" : "2 PLAYERS";
    if (this.diffButton.label) this.diffButton.label.text = m === 0 ? DiffNames[d] : "—";
    this.diffButton.interactable = m === 0;
    this.modeLabel.text = m === 0 ? "TAP TO CHANGE MODE OR CPU LEVEL" : "PASS THE PHONE: RED VS YELLOW";
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    if (!this.built) return;
    const r = this.board.rect;
    this.lastW = r.width;
    this.lastH = r.height;
    this.cs = Math.min((r.width - 60) / W, (r.height - TopBand - BottomBand - 40) / (H + 1.2), 150);
    this.bw = this.cs * W;
    this.bh = this.cs * H;
    this.cy = (BottomBand - TopBand) * 0.5 - this.cs * 0.5;
    this.gridRoot.place(UIKit.Center, new V2(0, this.cy), new V2(this.bw, this.bh));
    this.back.place(UIKit.Center, V2.zero, new V2(this.bw + 24, this.bh + 24));
    for (let c = 0; c < W; c++)
      for (let row = 0; row < H; row++)
        this.holes[c * H + row].rectTransform.place(UIKit.Center, this.Pos(c, row), new V2(this.cs + 1, this.cs + 1));
    this.ghost.rectTransform.sizeDelta = new V2(this.cs * 0.86, this.cs * 0.86);
    this.arrow.rectTransform.sizeDelta = new V2(this.cs * 0.5, this.cs * 0.5);
    for (const d of this.discs) {
      d.TargetY = this.Pos(d.Col, d.Row).y;
      if (d.Landed) d.Y = d.TargetY;
      d.Img.rectTransform.sizeDelta = new V2(this.cs * 0.86, this.cs * 0.86);
      d.Img.rectTransform.anchoredPosition = new V2(this.Pos(d.Col, 0).x, d.Y);
    }
  }

  private Pos(c: number, row: number) { return new V2((c - (W - 1) * 0.5) * this.cs, (row - (H - 1) * 0.5) * this.cs); }
  private get GhostY() { return this.bh * 0.5 + this.cs * 0.62; }

  private ColumnAt(screen: V2) {
    const local = this.gridRoot.screenToLocal(screen);
    const c = Math.floor((local.x + this.bw * 0.5) / this.cs);
    if (c < 0 || c >= W) return -1;
    if (local.y < -this.bh * 0.5 - this.cs || local.y > this.bh * 0.5 + this.cs * 2) return -1;
    return c;
  }

  // ------------------------------------------------------------------ lifecycle

  private ClearBoard() {
    for (const d of this.discs) d.Img.gameObject.destroy();
    this.discs = [];
    this.eng.Reset();
    this.winMask = 0n;
    this.winner = -1;
    for (const h of this.holes) h.color = BoardBlue;
  }

  protected OnEnterTitle() {
    this.ClearBoard();
    this.RefreshTitle();
    this.attract = 0.6;
    this.ghost.color = this.arrow.color = new Color(1, 1, 1, 0);
  }

  protected BeginRun() {
    this.Layout();
    this.ClearBoard();
    this.mode = this.Data.get("mode");
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    // the human goes first every other game
    const first = this.Data.get("first");
    this.Data.set("first", first ^ 1);
    this.human = this.mode === 0 ? first : 0;
    this.ended = this.busy = false;
    this.revives = 0;
    this.hintCol = -1;
    this.cpuTimer = 0.7;
    this.aimCol = 3;
    this.rng = new SysRandom();
    this.pointer.reset();
    this.pointer.topBand = 0.1;
    this.Data.add("games", 1);
    if (this.Data.get("games") === 1) this.UI.Hint("Tap a column to drop your disc. Get four in a row!");
    Sfx.setIntensity(0.15);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.AnimateDiscs(dt);
    if (this.State !== Phase.Title) return;
    // attract: the CPU plays itself on the title board
    this.attract -= dt;
    if (this.attract > 0) return;
    this.attract = 0.55;
    if (this.winner >= 0 || this.eng.Full) { this.ClearBoard(); this.attract = 1.2; return; }
    const s = this.eng.Score(2);
    const col = this.Pick(s, 0.3);
    if (col >= 0) this.Drop(col, true);
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    if (Math.abs(this.board.rect.width - this.lastW) > 1 || Math.abs(this.board.rect.height - this.lastH) > 1) this.Layout();
    // Not in the C#: there TickRun never calls AnimateDiscs, so discs would freeze above the board during play and
    // `busy` would never clear. Animating here (as TickBackground does) is the evident intent.
    this.AnimateDiscs(dt);
    this.HighlightWin();
    if (this.hintTimer > 0) this.hintTimer -= dt;
    if (this.ended) {
      this.endTimer -= dt;
      this.ghost.color = this.arrow.color = new Color(1, 1, 1, 0);
      if (this.endTimer <= 0 && this.State === Phase.Playing) this.End();
      return;
    }
    if (this.busy) return;
    const cpuTurn = this.mode === 0 && this.eng.Turn !== this.human;
    if (cpuTurn) {
      this.ghost.color = new Color(1, 1, 1, 0);
      this.cpuTimer -= dt;
      if (this.cpuTimer <= 0) this.CpuMove();
      this.UpdateArrow();
      return;
    }
    this.HumanInput();
    this.UpdateArrow();
  }

  private HumanInput() {
    const kb = Keyboard;
    if (kb.left.wasPressedThisFrame || kb.letter("a").wasPressedThisFrame) this.aimCol = Math.max(0, this.aimCol - 1);
    if (kb.right.wasPressedThisFrame || kb.letter("d").wasPressedThisFrame) this.aimCol = Math.min(W - 1, this.aimCol + 1);
    if (this.pointer.held) {
      const c = this.ColumnAt(this.pointer.screen);
      if (c >= 0) this.aimCol = c;
    }
    const pc = this.eng.Turn === 0 ? Red : Yellow;
    this.ghost.color = new Color(pc.r, pc.g, pc.b, 0.85);
    const gp = this.ghost.rectTransform.anchoredPosition;
    const tx = this.Pos(this.aimCol, 0).x;
    this.ghost.rectTransform.anchoredPosition = new V2(Mathf.lerp(gp.x, tx, 0.35), this.GhostY);
    const drop = (this.pointer.up && this.ColumnAt(this.pointer.screen) >= 0) || this.Controls.actionPressed || kb.down.wasPressedThisFrame || kb.enter.wasPressedThisFrame;
    if (drop) {
      if (this.eng.CanPlay(this.aimCol)) {
        this.UI.Hint(null);
        this.hintCol = -1;
        this.Drop(this.aimCol, false);
      } else Sfx.play(Snd.Deny, 0.5);
    }
  }

  private UpdateArrow() {
    if (this.hintCol >= 0 && this.hintTimer > 0) {
      this.arrow.color = new Color(Gold.r, Gold.g, Gold.b, 0.6 + 0.4 * Math.sin(Time.time * 8));
      this.arrow.rectTransform.anchoredPosition = new V2(this.Pos(this.hintCol, 0).x, this.GhostY + this.cs * 0.75 + Math.sin(Time.time * 6) * 8);
    } else this.arrow.color = new Color(1, 1, 1, 0);
  }

  private Pick(scores: number[], randomness: number) {
    let best = IntMin;
    for (let c = 0; c < W; c++) best = Math.max(best, scores[c]);
    if (best === IntMin) return -1;
    const options: number[] = [];
    for (let c = 0; c < W; c++)
      if (scores[c] !== IntMin && scores[c] >= best - (best >= 90000 ? 0 : 2)) options.push(c);
    if (randomness > 0 && this.rng.nextDouble() < randomness && best < 90000) {
      // a "human" slip: any column that does not lose right away
      const safe: number[] = [];
      for (let c = 0; c < W; c++) if (scores[c] !== IntMin && scores[c] > -90000) safe.push(c);
      if (safe.length > 0) return safe[this.rng.next(safe.length)];
    }
    return options[this.rng.next(options.length)];
  }

  private CpuMove() {
    const depth = this.diff === 0 ? 2 : this.diff === 1 ? 4 : 7;
    const slip = this.diff === 0 ? 0.35 : this.diff === 1 ? 0.08 : 0;
    const s = this.eng.Score(depth);
    const col = this.Pick(s, slip);
    if (col >= 0) this.Drop(col, false);
  }

  private Drop(col: number, silent: boolean) {
    const row = this.eng.RowOf(col);
    const player = this.eng.Turn;
    this.eng.Play(col);
    const d = new Disc();
    d.Col = col; d.Row = row; d.Player = player; d.Y = this.GhostY; d.TargetY = this.Pos(col, row).y;
    d.Img = UIKit.img(this.discLayer, "Disc", DiscSprite(), player === 0 ? Red : Yellow);
    d.Img.raycastTarget = false;
    d.Img.rectTransform.place(UIKit.Center, new V2(this.Pos(col, 0).x, d.Y), new V2(this.cs * 0.86, this.cs * 0.86));
    this.discs.push(d);
    this.busy = true;
    if (!silent) Sfx.playClip(this.dropClip, 0.5, 0.9 + row * 0.05);
    if (Engine.IsWin(this.eng.BbLo[player], this.eng.BbHi[player])) {
      this.winner = player;
      this.winMask = this.eng.WinMask(this.eng.BbLo[player], this.eng.BbHi[player]);
    } else if (this.eng.Full) this.winner = 2;
  }

  private AnimateDiscs(dt: number) {
    const g = this.cs * 55;
    for (const d of this.discs) {
      if (d.Landed) continue;
      d.Vy -= g * dt;
      d.Y += d.Vy * dt;
      if (d.Y <= d.TargetY) {
        d.Y = d.TargetY;
        if (Math.abs(d.Vy) > this.cs * 6) { d.Vy = -d.Vy * 0.22; Sfx.playClip(this.landClip, this.State === Phase.Title ? 0.15 : 0.5, 0.9 + d.Row * 0.04); }
        else { d.Vy = 0; d.Landed = true; this.OnLanded(d); }
      }
      d.Img.rectTransform.anchoredPosition = new V2(this.Pos(d.Col, 0).x, d.Y);
    }
  }

  private OnLanded(_d: Disc) {
    this.busy = false;
    if (this.winner >= 0 && !this.ended) {
      if (this.State === Phase.Title) { this.attract = 1.6; return; }
      this.ended = true;
      this.endTimer = 1.6;
      const humanWon = this.mode === 1 ? this.winner < 2 : this.winner === this.human;
      if (this.winner === 2) { this.UI.Announce("DRAW!", Color.white, 1.2); Sfx.play(Snd.Click, 0.7); }
      else if (humanWon) {
        this.UI.Announce(this.mode === 1 ? (this.winner === 0 ? "RED WINS!" : "YELLOW WINS!") : "YOU WIN!", this.winner === 0 ? Red : Yellow, 1.3);
        Sfx.play(Snd.NewBest, 0.7);
        this.fx.confetti(new V2(0, this.ViewSize.y * 0.3), 60, 8, [Red, Yellow, Gold, Color.white]);
      } else { this.UI.Announce("CPU WINS", Pal.hex(0xffc6d0), 1.2); Sfx.play(Snd.Deny, 0.7); this.Fx.shake(0.2); }
      Fx.haptic(true);
      return;
    }
    if (this.State === Phase.Playing) {
      this.cpuTimer = 0.45 + this.rng.nextDouble() * 0.3;
      this.UpdateHud();
    }
  }

  private HighlightWin() {
    if (this.winMask === 0n) return;
    const t = 0.5 + 0.5 * Math.sin(Time.time * 7);
    for (const d of this.discs) {
      const inLine = (this.winMask & (1n << BigInt(d.Col * 7 + d.Row))) !== 0n;
      const baseC = d.Player === 0 ? Red : Yellow;
      d.Img.color = inLine ? Color.lerp(baseC, Color.white, t * 0.45) : Color.lerp(baseC, BackColor, 0.45);
      const s = inLine ? 1 + t * 0.06 : 1;
      d.Img.rectTransform.localScale = new V3(s, s, 1);
    }
  }

  // ------------------------------------------------------------------ hint

  private OnHint() {
    if (this.State !== Phase.Playing || this.ended || this.busy) return;
    if (this.mode === 0 && this.eng.Turn !== this.human) return;
    if (!CasualUI.useOrEarn(() => this.Hints, (v) => (this.Hints = v), this.UI, "+1 HINT")) { this.UpdateHud(); return; }
    const s = this.eng.Score(7);
    this.hintCol = this.Pick(s, 0);
    this.aimCol = this.hintCol;
    this.hintTimer = 4;
    Sfx.play(Snd.PowerUp, 0.6);
    this.Data.flush();
    this.UpdateHud();
  }

  private UpdateHud() {
    if (!this.turnText) return;
    const t = this.eng.Turn;
    this.turnDisc.color = t === 0 ? Red : Yellow;
    const who = this.mode === 1 ? (t === 0 ? "RED'S TURN" : "YELLOW'S TURN") : t === this.human ? "YOUR TURN" : "CPU IS THINKING…";
    CasualUI.setText(this.turnText, who);
    if (this.mode === 0) {
      const you = this.human === 0 ? "RED" : "YELLOW";
      CasualUI.setText(this.scoreText, `YOU ARE ${you}   ·   CPU ${DiffNames[this.diff]}   ·   STREAK ${this.Data.get("streak")}`);
    } else CasualUI.setText(this.scoreText, `RED ${this.Data.get("p0")}  –  ${this.Data.get("p1")} YELLOW`);
    this.hintButton.gameObject.setActive(this.mode === 0);
    CasualUI.booster(this.hintButton, "HINT", this.Hints, !this.ended && !this.busy && t === this.human);
  }

  // ------------------------------------------------------------------ results

  private End() {
    if (this.mode === 1) {
      if (this.winner < 2) this.Data.add("p" + this.winner, 1);
      const head = this.winner === 2 ? "DRAW!" : this.winner === 0 ? "RED WINS!" : "YELLOW WINS!";
      this.Finish(new Result({
        Headline: head,
        HeadlineColor: this.winner === 0 ? Red : this.winner === 1 ? Yellow : Color.white,
        Value: `${this.Data.get("p0")} – ${this.Data.get("p1")}`,
        BestLine: "RED – YELLOW",
        Stats: [["MOVES", String(this.eng.Count)], ["RED WINS", String(this.Data.get("p0"))], ["YELLOW WINS", String(this.Data.get("p1"))], ["GAMES", String(this.Data.get("games"))]],
        Primary: "REMATCH",
        Victory: this.winner < 2,
      }));
      return;
    }
    const won = this.winner === this.human, draw = this.winner === 2;
    if (won) {
      this.Data.add("w" + this.diff, 1);
      this.Data.add("streak", 1);
      this.Data.max("streakBest", this.Data.get("streak"));
    } else if (!draw) { this.Data.add("l" + this.diff, 1); this.Data.set("streak", 0); }
    const moves = Math.trunc((this.eng.Count + 1) / 2);
    this.Finish(new Result({
      Headline: won ? "YOU WIN!" : draw ? "DRAW!" : "CPU WINS",
      HeadlineColor: won ? Gold : draw ? Color.white : Pal.hex(0xffc6d0),
      Value: won ? `IN ${moves} MOVES` : draw ? "FULL BOARD" : "SO CLOSE!",
      Stars: won ? this.diff + 1 : 0,
      BestLine: `VS ${DiffNames[this.diff]}:  ${this.Data.get("w" + this.diff)} WON  ·  ${this.Data.get("l" + this.diff)} LOST`,
      Stats: [["LEVEL", DiffNames[this.diff]], ["MOVES", String(moves)], ["STREAK", String(this.Data.get("streak"))], ["BEST STREAK", String(this.Data.get("streakBest"))]],
      Primary: won ? "PLAY AGAIN" : "REMATCH",
      Victory: won,
      Reward: won || draw ? () => { this.Hints = this.Hints + 2; this.Data.flush(); this.UI.Toast("+2 HINTS", 2); } : this.revives === 0 ? () => this.TakeBack() : null,
      RewardLabel: won || draw ? "GET 2 FREE HINTS (WATCH AD)" : "TAKE BACK YOUR MOVE (AD)",
    }));
  }

  private TakeBack() {
    this.revives++;
    // undo the CPU's winning move and the human move before it
    for (let i = 0; i < 2 && this.eng.Count > 0; i++) {
      this.eng.Undo();
      const last = this.discs[this.discs.length - 1];
      last.Img.gameObject.destroy();
      this.discs.pop();
    }
    for (const d of this.discs) {
      d.Img.color = d.Player === 0 ? Red : Yellow;
      d.Img.rectTransform.localScale = V3.one;
    }
    this.winMask = 0n;
    this.winner = -1;
    this.ended = this.busy = false;
    this.hintCol = -1;
    this.pointer.reset();
    this.Revive();
    this.UpdateHud();
    this.UI.Announce("YOUR MOVE AGAIN!", Yellow, 1.1);
  }
}
