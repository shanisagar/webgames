import {
  ArcadeGame, Art, AudioClip, Color, Ease, Fmt, Fx, GameInfo, GameObject, howTo, Mathf, Mouse, overUI, Pal,
  Phase, Random, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, Text, Time, Touchscreen, TouchScheme, UIKit, V2, V3,
} from "../../kit";
import { Board, Dealer, Shape } from "./Blocks";

/**
 * PRISM BLOCKS: a block-placing puzzle with gem-like neon blocks.
 * Drag pieces from the tray onto the 8x8 board. Complete rows or columns to shatter them; clear on consecutive
 * turns to build a combo streak that multiplies your points, and empty the whole board for a big bonus. A new
 * tray arrives when all three pieces are placed; the run ends when none of the remaining pieces fit.
 * Trays are dealt fairly (at least one piece always fits when dealt) and get tougher as the score climbs.
 * (Port of PrismBlocksGame.cs.)
 */

const N = Board.Size;
const TopBand = 300, BottomBand = 70;
const GemSize = 0.92;

const Cyan = Pal.hex(0x63e6ff);
const Pink = Pal.hex(0xff6bd0);
const Gold = Pal.hex(0xffd24d);
const EmptyCell = Pal.hex(0x221c55);

const Gems = [
  Color.clear,
  Pal.hex(0xff4d6d), // ruby
  Pal.hex(0xff9f43), // topaz
  Pal.hex(0xffd93d), // citrine
  Pal.hex(0x4cd964), // emerald
  Pal.hex(0x3ee0f0), // aquamarine
  Pal.hex(0x4d7cff), // sapphire
  Pal.hex(0xa66bff), // amethyst
  Pal.hex(0xff6bd0), // rose quartz
];

class Gem {
  Root!: GameObject;
  Base!: SpriteRenderer; Gloss!: SpriteRenderer; Shade!: SpriteRenderer;
}

class TrayPiece {
  Shape: Shape | null = null;
  Color = 0;
  Root!: GameObject;
  readonly Gems: Gem[] = [];
  Pos = V2.zero;
  Scale = 0; Appear = 0;
  Fits = true;
}

// Local stand-in for Unity's Pointer.current (the kit has no unified pointer): the primary touch while one is
// active, otherwise the mouse.
interface PressLike { readonly isPressed: boolean; readonly wasPressedThisFrame: boolean; readonly wasReleasedThisFrame: boolean }
interface PointerLike { position: V2; press: PressLike; touch: boolean }
let lastTouch: PointerLike | null = null;
function currentPointer(): PointerLike | null {
  const t = Touchscreen.primaryTouch;
  if (t) { lastTouch = { position: t.position, press: t.press, touch: true }; return lastTouch; }
  if (Mouse.present || !lastTouch) { lastTouch = null; return { position: Mouse.position, press: Mouse.leftButton, touch: false }; }
  return { position: lastTouch.position, press: idlePress, touch: true };
}
const idlePress: PressLike = { isPressed: false, wasPressedThisFrame: false, wasReleasedThisFrame: false };

const GlossSprite = () => Art.shape("prism-gloss", (p) => {
  const inside = Art.edge(-Art.roundBox(p, 0.8, 0.24));
  const band = Mathf.clamp01(p.y * 1.4 + 0.15 - Math.max(0, p.x) * 0.5);
  return inside * band * 0.75;
});

const ShadeSprite = () => Art.shape("prism-shade", (p) => {
  const outer = Art.edge(-Art.roundBox(p, 0.92, 0.28));
  const inner = Art.edge(-Art.roundBox(p.sub(new V2(-0.05, 0.07)), 0.8, 0.22));
  return outer * (1 - inner);
});

export class PrismBlocksGame extends ArcadeGame {
  private world!: GameObject; private boardRoot!: GameObject;
  private readonly cells: Gem[] = new Array(N * N);
  private readonly slotsBg: SpriteRenderer[] = new Array(N * N);
  private readonly pop = new Array<number>(N * N).fill(0);
  private readonly clearT = new Array<number>(N * N).fill(0);
  private readonly clearDelay = new Array<number>(N * N).fill(0);
  private readonly clearColor: Color[] = new Array(N * N).fill(Color.clear);
  private readonly tray: TrayPiece[] = new Array(3);
  private readonly slotPos: V2[] = [V2.zero, V2.zero, V2.zero];
  private readonly previewRows: number[] = []; private readonly previewCols: number[] = [];
  private readonly previewMask = new Array<boolean>(N * N).fill(false);
  private shatterClip!: AudioClip; private dropClip!: AudioClip;
  private rng = new SysRandom();

  private board = new Board();
  private boardCenter = V2.zero; private need = new V2(8.7, 11.7); private dragPos = V2.zero;
  private landscape = false; private dragTouch = false; private dying = false; private revived = false; private announcedBest = false;
  private drag = -1; private ghostX = -1; private ghostY = -1; private best = 0; private pieces = 0; private bestStreak = 0; private allClears = 0;
  private shownScore = 0; private dyingT = 0; private demoTimer = 0; private streakFlash = 0;

  private scoreText!: Text; private bestText!: Text; private streakText!: Text;

  protected Describe() {
    return new GameInfo({
      Id: "prismblocks",
      Title: "PRISM BLOCKS",
      Tagline: "DRAG. DROP. SHATTER THE LINES.",
      Accent: Cyan,
      Accent2: Pink,
      BgTop: Pal.hex(0x1b1450),
      BgBottom: Pal.hex(0x050318),
      GridSpacing: 1,
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 108, rootHz: 87.31, degrees: [0, 5, 3, 4], seed: 57, energy: 0.55, major: true },
      Reminders: [
        "Your gems are waiting|One more game? That high score won't beat itself.",
        "Combo time|Line up the gems and shatter a few rows.",
        "Daily brain break|A quick game of Prism Blocks is calling.",
      ],
      HowTo: [
        howTo(Art.RoundSquare, Gems[5], "Drag pieces from the tray onto the board."),
        howTo(Art.RoundSquare, Gems[3], "Fill a ROW or COLUMN completely to shatter it."),
        howTo(Art.Star, Gold, "Clear several lines at once for big points."),
        howTo(Art.Chevron, Gems[1], "Clear on consecutive turns to build a COMBO streak."),
        howTo(Art.Diamond, Gems[7], "Empty the whole board: ALL CLEAR bonus!"),
        howTo(Art.Plus, Pal.TextDim, "Pieces can't be rotated. Game over when nothing fits."),
      ],
      Tips: [
        "Keep a 3x3 space open for the big square.",
        "Fill edges and corners first; keep the middle flexible.",
        "Place all three pieces with a plan: the order matters.",
        "A streak survives two turns without a clear. Use them wisely.",
      ],
    });
  }

  protected get ShortSide() { return ArcadeGame.FitShortSide(this.need, TopBand, BottomBand); }

  protected BestLine() { return this.best > 0 ? "BEST  " + Fmt.n(this.best) : ""; }

  protected StatsLine() {
    const games = this.Data.get("games");
    return games > 0 ? `${games} GAMES   ·   ${Fmt.n(this.Data.get("lines"))} LINES SHATTERED` : "A CLASSIC BLOCK PUZZLE WITH A SPARKLE";
  }

  // ------------------------------------------------------------------ build

  private NewGem(parent: GameObject, name: string, order: number) {
    const g = new Gem();
    g.Root = new GameObject(name, parent);
    g.Base = Art.spr(g.Root, "Base", Art.RoundSquare, Color.white, GemSize, order);
    g.Shade = Art.spr(g.Root, "Shade", ShadeSprite(), new Color(0, 0, 0.05, 0.4), GemSize, order + 1, Art.Flat);
    g.Gloss = Art.spr(g.Root, "Gloss", GlossSprite(), new Color(1, 1, 1, 0.55), GemSize, order + 2, Art.Flat);
    return g;
  }

  private static Paint(g: Gem, c: Color, alpha: number) {
    g.Base.color = c.withAlpha(c.a * alpha);
    g.Shade.color = new Color(0, 0, 0.05, 0.4 * alpha);
    g.Gloss.color = new Color(1, 1, 1, 0.5 * alpha);
  }

  private static SetOrder(g: Gem, order: number) {
    g.Base.sortingOrder = order;
    g.Shade.sortingOrder = order + 1;
    g.Gloss.sortingOrder = order + 2;
  }

  protected Build() {
    this.world = new GameObject("Prism", this.gameObject);
    this.boardRoot = new GameObject("Board", this.world);
    Art.spr(this.boardRoot, "Frame", Art.RoundSquare, Pal.hex(0x0d0a26).withAlpha(0.95), N + 0.6, 0);
    const frameLine = Art.line(this.boardRoot, "Frame Edge", Cyan.withAlpha(0.45), 0.06, 1, true, false);
    const h = N * 0.5 + 0.3;
    frameLine.positionCount = 4;
    frameLine.setPositions([new V3(-h, -h), new V3(h, -h), new V3(h, h), new V3(-h, h)]);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = Board.Index(x, y);
        const local = new V3(x - (N - 1) * 0.5, y - (N - 1) * 0.5, 0);
        this.slotsBg[i] = Art.spr(this.boardRoot, "Slot", Art.RoundSquare, EmptyCell, GemSize, 2);
        this.slotsBg[i].transform.localPosition = local;
        this.cells[i] = this.NewGem(this.boardRoot, "Cell", 4);
        this.cells[i].Root.localPosition = local;
      }
    for (let k = 0; k < 3; k++) {
      const tp = new TrayPiece();
      tp.Root = new GameObject("Tray " + k, this.world);
      for (let g = 0; g < 9; g++) tp.Gems.push(this.NewGem(tp.Root, "Gem", 20));
      this.tray[k] = tp;
    }

    const noise = new SysRandom(6);
    let lp = 0;
    this.shatterClip = Sfx.make("prism-shatter", 0.5, (t) => {
      const n = noise.nextDouble() * 2 - 1;
      lp += (n - lp) * 0.6;
      const glass = (n - lp) * Sfx.env(t, 0.001, 0.12) * 0.35;
      const ring = (Sfx.sinP(2093 * t) + 0.6 * Sfx.sinP(2637 * t) + 0.4 * Sfx.sinP(3136 * t)) * Sfx.env(t, 0.002, 0.4) * 0.07;
      return glass + ring;
    });
    this.dropClip = Sfx.make("prism-drop", 0.14, (t) =>
      Sfx.sinP(Sfx.glide(t, 320, 140, 0.1)) * Sfx.env(t, 0.001, 0.08) * 0.45 + (noise.nextDouble() * 2 - 1) * Sfx.env(t, 0.0005, 0.01) * 0.15);

    this.BuildHud();
    this.best = this.Data.get("best");
    this.Layout();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.scoreText = UIKit.at(UIKit.label(hud, "0", 92, Color.white), new V2(0.5, 1), new V2(0, -88), new V2(700, 120));
    UIKit.glow(this.scoreText, Cyan.withAlpha(0.45), 4);
    this.bestText = UIKit.at(UIKit.label(hud, "", 30, Gold), new V2(0.5, 1), new V2(0, -165), new V2(700, 44));
    this.streakText = UIKit.at(UIKit.label(hud, "", 34, Pink), new V2(0.5, 1), new V2(0, -215), new V2(800, 48));
  }

  // ------------------------------------------------------------------ layout

  private Layout() {
    this.landscape = Screen.width > Screen.height;
    if (!this.landscape) {
      this.boardCenter = new V2(0, 1.75);
      for (let k = 0; k < 3; k++) this.slotPos[k] = new V2((k - 1) * 2.9, -4.2);
      this.need = new V2(8.8, 11.8);
    } else {
      this.boardCenter = new V2(-2.05, 0);
      for (let k = 0; k < 3; k++) this.slotPos[k] = new V2(4.35, (1 - k) * 2.9);
      this.need = new V2(12.6, 8.8);
    }
    this.boardRoot.localPosition = new V3(this.boardCenter.x, this.boardCenter.y, 0);
    this.CenterCamera();
  }

  private CenterCamera() {
    const r = this.PlayRect(TopBand, BottomBand, 0);
    this.Fx.CameraTarget = r.center.neg();
  }

  protected OnLayoutChanged() {
    if ((Screen.width > Screen.height) !== this.landscape) this.Layout();
    else this.CenterCamera();
  }

  private CellWorld(x: number, y: number) { return this.boardCenter.add(new V2(x - (N - 1) * 0.5, y - (N - 1) * 0.5)); }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.CancelDrag();
    this.NewBoard(true);
    this.demoTimer = 1;
  }

  private NewBoard(demo: boolean) {
    this.board = new Board();
    for (let i = 0; i < N * N; i++) this.pop[i] = this.clearT[i] = this.clearDelay[i] = 0;
    if (demo) {
      // A colourful half-built board for the title screen.
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < N; x++)
          if (this.rng.nextDouble() < 0.62) this.board.C[Board.Index(x, y)] = 1 + ((x + y * 3) % 8);
    }
    this.dying = false;
    this.dyingT = 0;
    this.Deal();
  }

  protected BeginRun() {
    this.rng = new SysRandom();
    this.NewBoard(false);
    this.shownScore = 0;
    this.pieces = this.bestStreak = this.allClears = 0;
    this.revived = this.announcedBest = false;
    this.best = this.Data.get("best");
    if (this.Data.get("games") === 0) this.UI.Hint("Drag a piece onto the board. Fill a row or column to shatter it!");
    Sfx.setIntensity(0.15);
  }

  private Deal() {
    const shapes = Dealer.Deal(this.board, this.rng);
    for (let k = 0; k < 3; k++) {
      const tp = this.tray[k];
      const s = shapes[k];
      tp.Shape = s;
      tp.Color = this.rng.next(1, Gems.length);
      tp.Appear = 0;
      tp.Pos = this.slotPos[k].add(this.landscape ? new V2(3, 0) : new V2(0, -3));
      tp.Scale = PrismBlocksGame.TrayScale(s);
      for (let g = 0; g < tp.Gems.length; g++) {
        const on = g < s.Cells.length;
        tp.Gems[g].Root.setActive(on);
        if (!on) continue;
        const [cx, cy] = s.Cells[g];
        tp.Gems[g].Root.localPosition = new V3(cx - (s.W - 1) * 0.5, cy - (s.H - 1) * 0.5, 0);
      }
    }
    this.RefreshFits();
  }

  private static TrayScale(s: Shape) { return Math.min(0.55, 2.5 / Math.max(s.W, s.H)); }

  private RefreshFits() {
    for (const tp of this.tray) tp.Fits = tp.Shape !== null && this.board.Fits(tp.Shape);
  }

  protected OnPauseChanged(paused: boolean) {
    if (paused) this.CancelDrag();
  }

  private CancelDrag() {
    this.drag = -1;
    this.ghostX = this.ghostY = -1;
    this.previewRows.length = 0;
    this.previewCols.length = 0;
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Animate(dt);
    if (this.State !== Phase.Title) return;
    this.demoTimer -= dt;
    if (this.demoTimer > 0) return;
    this.demoTimer = 0.5;
    if (!this.DemoMove()) this.NewBoard(true);
  }

  /** The title-screen autopilot: places the piece that clears the most lines. */
  private DemoMove() {
    let bestK = -1, bx = 0, by = 0, bestScore = -1;
    for (let k = 0; k < 3; k++) {
      const s = this.tray[k].Shape;
      if (!s) continue;
      for (let y = 0; y + s.H <= N; y++)
        for (let x = 0; x + s.W <= N; x++) {
          if (!this.board.CanPlace(s, x, y)) continue;
          this.board.PreviewLines(s, x, y, this.previewRows, this.previewCols);
          const sc = (this.previewRows.length + this.previewCols.length) * 20 + y * -1 + this.rng.next(4);
          if (sc > bestScore) {
            bestScore = sc;
            bestK = k;
            bx = x;
            by = y;
          }
        }
    }
    this.previewRows.length = 0;
    this.previewCols.length = 0;
    if (bestK < 0) return false;
    this.PlacePiece(bestK, bx, by, true);
    return true;
  }

  protected TickRun(dt: number) {
    this.Animate(dt);
    this.UpdateHud(dt);
    if (this.dying) {
      this.dyingT += dt;
      if (this.dyingT >= 1.1 && this.State === Phase.Playing) this.GameOver();
      return;
    }
    this.HandleDrag();
  }

  private HandleDrag() {
    const ptr = currentPointer();
    if (!ptr) return;
    const sp = ptr.position;
    const wp = this.ScreenToWorld(sp);
    if (this.drag < 0) {
      if (!ptr.press.wasPressedThisFrame || overUI(sp)) return;
      const k = this.SlotAt(wp);
      if (k < 0 || !this.tray[k].Shape) return;
      this.drag = k;
      this.dragTouch = ptr.touch;
      this.dragPos = this.DragTarget(wp);
      this.UI.Hint(null);
      Sfx.play(Snd.Pickup, 0.5, 1.1);
      Fx.haptic();
      return;
    }
    if (ptr.press.isPressed) {
      this.dragPos = this.DragTarget(wp);
      this.UpdateGhost();
      return;
    }
    // Released.
    if (this.ghostX >= 0) this.PlacePiece(this.drag, this.ghostX, this.ghostY, false);
    else Sfx.play(Snd.Deny, 0.35);
    this.CancelDrag();
  }

  private DragTarget(pointerWorld: V2) { return pointerWorld.add(this.dragTouch ? new V2(0, 2.2) : V2.zero); }

  private SlotAt(p: V2) {
    for (let k = 0; k < 3; k++) {
      const d = p.sub(this.slotPos[k]);
      if (Math.abs(d.x) < 1.45 && Math.abs(d.y) < 1.45) return k;
    }
    return -1;
  }

  private UpdateGhost() {
    this.ghostX = this.ghostY = -1;
    const s = this.tray[this.drag].Shape!;
    const origin = this.boardCenter.sub(new V2((N - 1) * 0.5, (N - 1) * 0.5)); // centre of cell (0,0)
    const c00 = this.dragPos.sub(new V2((s.W - 1) * 0.5, (s.H - 1) * 0.5));
    const f = c00.sub(origin);
    // Forgiving snap: the nearest valid spot within about one cell.
    let bestD = 1.15;
    const rx = Mathf.roundToInt(f.x), ry = Mathf.roundToInt(f.y);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = rx + dx, y = ry + dy;
        if (!this.board.CanPlace(s, x, y)) continue;
        const d = new V2(x, y).sub(f).magnitude;
        if (d < bestD) {
          bestD = d;
          this.ghostX = x;
          this.ghostY = y;
        }
      }
    if (this.ghostX >= 0) this.board.PreviewLines(s, this.ghostX, this.ghostY, this.previewRows, this.previewCols);
    else {
      this.previewRows.length = 0;
      this.previewCols.length = 0;
    }
  }

  // ------------------------------------------------------------------ placing and clearing

  private PlacePiece(k: number, x: number, y: number, quiet: boolean) {
    const tp = this.tray[k];
    const s = tp.Shape!;
    const before = this.board.Score;
    const res = this.board.Place(s, x, y, tp.Color);
    tp.Shape = null;
    this.pieces++;
    const centre = this.CellWorld(x, y).add(new V2((s.W - 1) * 0.5, (s.H - 1) * 0.5));
    for (const [cx, cy] of s.Cells) this.pop[Board.Index(x + cx, y + cy)] = 1;

    for (let c = 0; c < res.Cleared.length; c++) {
      const i = res.Cleared[c];
      const p = this.CellWorld(i % N, Math.trunc(i / N));
      this.clearColor[i] = Gems[res.ClearedColors[c]];
      this.clearDelay[i] = 0.02 + p.sub(centre).magnitude * 0.035;
      this.clearT[i] = 1;
    }

    if (!quiet) {
      Sfx.playClip(this.dropClip, 0.8, Random.range(0.92, 1.08));
      Fx.haptic();
      if (res.Lines > 0) {
        this.bestStreak = Math.max(this.bestStreak, res.Streak);
        Sfx.playClip(this.shatterClip, 0.9, 1 + Math.min(res.Lines, 4) * 0.05);
        Sfx.play(Snd.Coin, 0.7, 1 + Math.min(res.Streak, 8) * 0.08);
        this.Fx.shake(0.08 + res.Lines * 0.05);
        this.Fx.kick(0.5 + res.Lines * 0.25, res.Lines >= 3 ? 0.25 : 0);
        if (res.Lines >= 2) Fx.haptic(true);
        const words = ["", "NICE!", "GREAT!", "AMAZING!", "INCREDIBLE!", "UNBELIEVABLE!"];
        if (res.Lines >= 2) this.UI.Announce(words[Math.min(res.Lines, words.length - 1)], Gems[tp.Color], 1.1);
        else if (res.Streak >= 3) this.UI.Announce("COMBO x" + res.Streak, Pink, 1);
        if (res.Streak >= 2) this.streakFlash = 1;
        if (res.AllClear) {
          this.allClears++;
          this.UI.Announce("ALL CLEAR! +" + Board.AllClearBonus, Gold, 1.8);
          Sfx.play(Snd.NewBest, 0.8);
          this.Fx.burst(this.boardCenter, Gold, 60, 9, 0.3, 1.1);
          this.Back.Flash(Gold, 0.25);
        }
      } else Sfx.play(Snd.Build, 0.3, Random.range(1.2, 1.4));
      const gained = this.board.Score - before;
      this.UI.Float(centre, "+" + gained, res.Lines > 0 ? Gold : Pal.Text, res.Lines > 0 ? 1.1 + res.Lines * 0.1 : 0.8);
      Sfx.setIntensity(Mathf.clamp01(0.15 + this.board.Streak * 0.15));
      this.Back.setDanger(this.board.Filled > 40 ? Mathf.inverseLerp(40, 56, this.board.Filled) * 0.5 : 0);
      if (!this.announcedBest && this.best > 0 && this.board.Score > this.best) {
        this.announcedBest = true;
        this.UI.Announce("NEW BEST!", Gold, 1.4);
        Sfx.play(Snd.PowerUp, 0.6);
      }
    } else if (res.Lines > 0) Sfx.playClip(this.shatterClip, 0.2);

    const trayEmpty = !this.tray[0].Shape && !this.tray[1].Shape && !this.tray[2].Shape;
    if (trayEmpty) this.Deal();
    else this.RefreshFits();
    if (!quiet && !Dealer.AnyFits(this.board, this.Shapes())) {
      this.dying = true;
      this.dyingT = 0;
      Sfx.play(Snd.Warn);
    }
  }

  private Shapes() { return [this.tray[0].Shape, this.tray[1].Shape, this.tray[2].Shape]; }

  // ------------------------------------------------------------------ rendering

  private Animate(dt: number) {
    const time = Time.time;
    this.previewMask.fill(false);
    for (const r of this.previewRows) for (let c = 0; c < N; c++) this.previewMask[Board.Index(c, r)] = true;
    for (const c of this.previewCols) for (let r = 0; r < N; r++) this.previewMask[Board.Index(c, r)] = true;
    const dragShape = this.drag >= 0 ? this.tray[this.drag].Shape : null;
    const dragColor = this.drag >= 0 ? Gems[this.tray[this.drag].Color] : Color.white;
    const pulse = 0.5 + 0.5 * Math.sin(time * 9);

    for (let i = 0; i < N * N; i++) {
      const g = this.cells[i];
      const v = this.board.C[i];
      this.pop[i] = Mathf.moveTowards(this.pop[i], 0, dt * 5);
      const scale = 1 + 0.18 * Math.sin(this.pop[i] * Math.PI);
      if (this.clearT[i] > 0) {
        if (this.clearDelay[i] > 0) {
          this.clearDelay[i] -= dt;
          if (this.clearDelay[i] <= 0) {
            const p = this.CellWorld(i % N, Math.trunc(i / N));
            const quiet = this.State !== Phase.Playing;
            this.Fx.burst(p, this.clearColor[i], quiet ? 2 : 6, 4, 0.2, 0.5);
          }
          g.Root.setActive(true);
          PrismBlocksGame.Paint(g, Color.lerp(this.clearColor[i], Color.white, 0.25), 1);
          g.Root.localScale = V3.one;
          continue;
        }
        this.clearT[i] = Mathf.moveTowards(this.clearT[i], 0, dt / 0.3);
        g.Root.setActive(this.clearT[i] > 0);
        PrismBlocksGame.Paint(g, Color.lerp(Color.white, this.clearColor[i], this.clearT[i]), this.clearT[i]);
        const s = Mathf.lerp(0.2, 1.15, this.clearT[i]);
        g.Root.localScale = new V3(s, s, 1);
        continue;
      }

      const ghost = dragShape !== null && this.ghostX >= 0 && this.IsGhostCell(dragShape, i);
      if (v === 0 && !ghost) {
        g.Root.setActive(false);
        continue;
      }
      g.Root.setActive(true);
      if (v === 0) {
        PrismBlocksGame.Paint(g, dragColor, 0.35 + 0.1 * pulse);
        g.Root.localScale = V3.one;
        continue;
      }
      let col = Gems[v];
      if (this.dying) {
        const k = Mathf.clamp01(this.dyingT * 1.6 - (N - 1 - Math.trunc(i / N)) * 0.08);
        col = Color.lerp(col, Pal.hex(0x3a3660), k);
      }
      if (this.previewMask[i]) col = Color.lerp(col, dragColor, 0.55 + 0.25 * pulse);
      PrismBlocksGame.Paint(g, col, 1);
      g.Root.localScale = new V3(scale, scale, 1);
    }

    for (let k = 0; k < 3; k++) {
      const tp = this.tray[k];
      const active = tp.Shape !== null;
      if (tp.Root.activeSelf !== active) tp.Root.setActive(active);
      if (!tp.Shape) continue;
      tp.Appear = Mathf.moveTowards(tp.Appear, 1, dt * 4);
      const dragging = k === this.drag;
      const target = dragging ? this.dragPos : this.slotPos[k];
      tp.Pos = dragging ? target : V2.lerp(tp.Pos, target, 1 - Math.exp(-dt * 16));
      const wantScale = dragging ? 1 : PrismBlocksGame.TrayScale(tp.Shape);
      tp.Scale = Mathf.lerp(tp.Scale, wantScale, 1 - Math.exp(-dt * 22));
      const s = tp.Scale * Ease.outBack(tp.Appear);
      tp.Root.localPosition = new V3(tp.Pos.x, tp.Pos.y, 0);
      tp.Root.localScale = new V3(s, s, 1);
      const alpha = dragging ? (this.ghostX >= 0 ? 0.9 : 1) : tp.Fits || this.State !== Phase.Playing ? 1 : 0.3;
      for (let g = 0; g < tp.Shape.Cells.length; g++) {
        PrismBlocksGame.Paint(tp.Gems[g], Gems[tp.Color], alpha);
        PrismBlocksGame.SetOrder(tp.Gems[g], dragging ? 40 : 20);
      }
    }
  }

  private IsGhostCell(s: Shape, i: number) {
    const x = (i % N) - this.ghostX, y = Math.trunc(i / N) - this.ghostY;
    for (const [cx, cy] of s.Cells) if (cx === x && cy === y) return true;
    return false;
  }

  // ------------------------------------------------------------------ HUD / end

  private UpdateHud(dt: number) {
    this.shownScore = Mathf.moveTowards(this.shownScore, this.board.Score, Math.max(30, (this.board.Score - this.shownScore) * 8) * dt);
    PrismBlocksGame.Set(this.scoreText, Fmt.n(Mathf.roundToInt(this.shownScore)));
    PrismBlocksGame.Set(this.bestText, "BEST  " + Fmt.n(Math.max(this.best, this.board.Score)));
    this.streakFlash = Mathf.moveTowards(this.streakFlash, 0, dt * 1.5);
    if (this.board.Streak >= 2) {
      const left = 3 - this.board.Misses;
      PrismBlocksGame.Set(this.streakText, `COMBO x${this.board.Streak}   ·   ${left} ${left === 1 ? "TURN" : "TURNS"} TO KEEP IT`);
      const s = 1 + 0.15 * this.streakFlash;
      this.streakText.rectTransform.localScale = new V3(s, s, 1);
    } else PrismBlocksGame.Set(this.streakText, "");
  }

  private static Set(t: Text, s: string) {
    if (t.text !== s) t.text = s;
  }

  private GameOver() {
    this.CancelDrag();
    const score = this.board.Score;
    this.Data.add("games", 1);
    this.Data.add("lines", this.board.Lines);
    const newBest = this.Data.max("best", score);
    if (newBest) this.best = score;
    Sfx.play(newBest ? Snd.Win : Snd.Lose);
    this.Finish(new Result({
      Headline: "NO SPACE LEFT",
      HeadlineColor: Pink,
      Value: Fmt.n(score),
      CountTo: score,
      NewBest: newBest,
      BestLine: "BEST  " + Fmt.n(Math.max(this.best, score)),
      Stats: [
        ["LINES", String(this.board.Lines)],
        ["BEST COMBO", "x" + this.bestStreak],
        ["PIECES", String(this.pieces)],
        ["ALL CLEARS", String(this.allClears)],
      ],
      Primary: "PLAY AGAIN",
      Reward: this.revived ? null : () => this.Rescue(),
      RewardLabel: "CLEAR SPACE & CONTINUE (AD)",
    }));
  }

  /** Rewarded continue (once per game): shatters the middle of the board and deals a fresh tray. */
  private Rescue() {
    this.revived = true;
    this.dying = false;
    this.dyingT = 0;
    for (let y = 2; y < 6; y++)
      for (let x = 2; x < 6; x++) {
        const i = Board.Index(x, y);
        if (this.board.C[i] === 0) continue;
        this.clearColor[i] = Gems[this.board.C[i]];
        this.clearDelay[i] = 0.05 + ((x - 3.5) * (x - 3.5) + (y - 3.5) * (y - 3.5)) * 0.02;
        this.clearT[i] = 1;
      }
    this.board.ClearCentre(4);
    this.Deal();
    this.Revive();
    Sfx.playClip(this.shatterClip, 1, 0.9);
    this.UI.Announce("SECOND CHANCE!", Gold, 1.3);
  }
}
