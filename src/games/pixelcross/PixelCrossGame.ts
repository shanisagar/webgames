import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, CasualUI, Color, Fmt, Fx, GameInfo, GameObject,
  howTo, Image, LevelPath, Mathf, Pal, Phase, Result, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer, Text, TextAnchor,
  TouchScheme, UIKit, UINode, V2, V2i, V3,
} from "../../kit";
import { PixelCrossPictures } from "./PixelCrossPictures";

/**
 * PIXEL CROSS: nonogram picture puzzles. The numbers beside each row and above each column tell how many filled
 * squares come in a row there. Fill the right squares (drag to fill many) and mark the others with X. A wrong square
 * costs a heart; three hearts lost ends the puzzle. Finishing reveals the hidden pixel picture in colour. Hand-drawn
 * pictures first, then endless generated ones. Hints and an extra heart come from rewarded ads. Drawn with UI elements
 * on the HUD canvas so the numbers stay crisp. (Port of PixelCrossGame.cs.)
 */

const TopBand = 220, BottomBand = 190;
const Lives = 3;

const Paper = Pal.hex(0xfffdf7), Ink = Pal.hex(0x2c3450), Fill = Pal.hex(0x3a4778),
  Cross = Pal.hex(0x9aa3bd), Wrong = Pal.hex(0xf2465e), Accent = Pal.hex(0x5a6cff), Gold = Pal.hex(0xffb627), Done = Pal.hex(0xb9c0d4);

enum Mark { None, Filled, Crossed, WrongCross }

class Cell {
  Bg!: Image; Mk!: Image;
  State = Mark.None;
  Solution = false;
  Pixel = ".";
  Pop = 0;
}

const XMark = () => CasualArt.make("pc-x", 64, 64, (p) => {
  const d = Math.min(CasualArt.sdSegment(p, new V2(-0.55, -0.55), new V2(0.55, 0.55)), CasualArt.sdSegment(p, new V2(-0.55, 0.55), new V2(0.55, -0.55))) - 0.1;
  return new Color(1, 1, 1, CasualArt.fill(d, 2 / 64));
});

const Rounded = () => CasualArt.make("pc-cell", 64, 64, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.92, 0.92), 0.22);
  return new Color(1, 1, 1, CasualArt.fill(d, 2 / 64));
});

const Backdrop = () => CasualArt.make("pc-bg", 128, 256, (p) => {
  let c = Color.lerp(Pal.hex(0xf7f2ff), Pal.hex(0xe0e6ff), CasualArt.smooth(-2, 2, p.y));
  const g = new V2(Mathf.repeat(p.x * 4, 1), Mathf.repeat(p.y * 4, 1));
  const dot = g.sub(new V2(0.5, 0.5)).magnitude;
  c = Color.lerp(c, Pal.hex(0xc7cff2), CasualArt.smooth(0.08, 0.04, dot) * 0.6);
  return c.withAlpha(1);
});

const HeartSprite = () => CasualArt.make("pc-heart", 64, 64, (p) => {
  const q = new V2(Math.abs(p.x), p.y + 0.75).div(1.25);
  let d: number;
  if (q.y + q.x > 1) d = q.sub(new V2(0.25, 0.75)).magnitude - 0.35355;
  else {
    const m = 0.5 * Math.max(q.x + q.y, 0);
    d = Math.sqrt(Math.min(q.sub(new V2(0, 1)).sqrMagnitude, q.sub(new V2(m, m)).sqrMagnitude)) * Mathf.sign(q.x - q.y);
  }
  return new Color(1, 1, 1, CasualArt.fill(d * 1.25, 2 / 64));
});

export class PixelCrossGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject;
  private bgCover!: SpriteRenderer;
  private board!: UINode; private gridRoot!: UINode;
  private cells: Cell[][] = [];
  private rowClues: Text[] = []; private colClues: Text[] = [];
  private lines: Image[] = [];
  private W = 0; private H = 0; private level = 0; private lives = 0; private mistakes = 0;
  private picName = "";
  private cellSize = 0; private endTimer = 0; private timer = 0; private revealT = 0;
  private ended = false; private won = false; private revived = false; private crossMode = false; private dragging = false; private built = false;
  private dragAction = -1; private lockAxis = -1; private startR = 0; private startC = 0;
  private pointer = new TapPointer();
  private fx!: CasualFx;
  private path!: LevelPath;
  private rng = new SysRandom();

  private levelText!: Text; private nameText!: Text;
  private hearts: Image[] = [];
  private modeButton!: ArcadeButton; private hintButton!: ArcadeButton;
  private fillClip!: AudioClip; private crossClip!: AudioClip; private wrongClip!: AudioClip; private lineClip!: AudioClip; private revealClip!: AudioClip;
  private lastW = 0; private lastH = 0;
  private gridOrigin = V2.zero;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "pixelcross",
      Title: "PIXEL CROSS",
      Tagline: "SOLVE THE NUMBERS. REVEAL THE PICTURE.",
      Accent: Accent,
      Accent2: Gold,
      BgTop: Pal.hex(0xe3e8ff),
      BgBottom: Pal.hex(0xf7f2ff),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 80, rootHz: 146.8, degrees: [0, 3, 4, 5], seed: 41, energy: 0.2, major: true },
      Reminders: [
        "A hidden picture is waiting|Solve the numbers to reveal it.",
        "Brain break time|One more nonogram before bed?",
        "New pixel puzzle|What will this one be?",
      ],
      HowTo: [
        howTo(Art.Square, Fill, "The numbers show how many FILLED squares come in a row, in that order, with gaps between groups."),
        howTo(Art.Square, Accent, "TAP or DRAG to fill squares. Switch to X mode to mark squares that must stay empty."),
        howTo(Art.Diamond, Wrong, "A wrong square costs a heart. Lose three and the puzzle is over."),
        howTo(Art.Star, Gold, "Fill every right square to reveal the hidden pixel picture!"),
        howTo(Art.Ring, Accent, "Finished rows and columns are crossed out automatically."),
      ],
      Tips: [
        "Start with the biggest numbers: they overlap in the middle.",
        "A row with 0 or a full-width number is solved at once.",
        "Mark empty squares with X to see the gaps.",
        "Drag along a row to fill several squares in one go.",
        "Stuck? A hint reveals one correct square.",
      ],
    });
  }

  protected get ShortSide() { return 9; }
  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }
  private get Hints() { return this.Data.get("hints", 3); }
  private set Hints(value: number) { this.Data.set("hints", Math.max(0, value)); }

  protected BestLine() { return `PUZZLE ${this.CurrentLevel}   ·   ${this.Data.get("stars")} STARS`; }
  protected StatsLine() { return `${this.Data.get("solved")} PICTURES REVEALED   ·   ${this.Data.get("perfect")} PERFECT`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("PixelWorld", this.gameObject);
    CasualLook.calm(this, 1.4, 0.1);
    this.bgCover = CasualLook.cover(this.world, Backdrop(), -910);
    this.fx = CasualFx.create(this.world, 50, 160);

    this.board = UIKit.node("Board", this.UI.Hud).stretch();
    this.board.setAsFirstSibling();
    this.gridRoot = UIKit.node("Grid", this.board);

    const hud = this.UI.Hud;
    const plate = UIKit.img(hud, "TopPlate", Art.UiRound, new Color(1, 1, 1, 0.85));
    plate.rectTransform.place(new V2(0.5, 1), new V2(-60, -86), new V2(820, 110));
    this.levelText = UIKit.at(UIKit.label(plate.rectTransform, "", 34, Ink, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(170, 0), new V2(300, 60));
    this.nameText = UIKit.at(UIKit.label(plate.rectTransform, "", 30, Accent), UIKit.Center, new V2(20, 0), new V2(260, 50));
    for (let i = 0; i < Lives; i++) {
      const h = UIKit.img(plate.rectTransform, "Heart", HeartSprite(), Wrong);
      h.rectTransform.place(new V2(1, 0.5), new V2(-230 + i * 64, 0), new V2(54, 54));
      this.hearts.push(h);
    }
    this.modeButton = UIKit.buttonAt(hud, "FILL", new V2(0.5, 0), new V2(-170, 90), new V2(300, 120), true, () => this.ToggleMode(), 34);
    this.modeButton.setAccent(Accent);
    this.hintButton = UIKit.buttonAt(hud, "HINT", new V2(0.5, 0), new V2(170, 90), new V2(300, 120), false, () => this.OnHint(), 30);
    this.hintButton.setAccent(Gold);

    this.fillClip = Sfx.make("pc-fill", 0.07, (t) => Sfx.sinP(Sfx.glide(t, 700, 520, 0.05)) * Sfx.env(t, 0.002, 0.05) * 0.22);
    this.crossClip = Sfx.make("pc-cross", 0.06, (t) => Sfx.triP(Sfx.glide(t, 500, 380, 0.05)) * Sfx.env(t, 0.002, 0.04) * 0.16);
    this.wrongClip = Sfx.make("pc-wrong", 0.25, (t) => Sfx.triP(Sfx.glide(t, 240, 160, 0.2)) * Sfx.env(t, 0.003, 0.2) * 0.3);
    this.lineClip = Sfx.make("pc-line", 0.25, (t) => (Sfx.sinP(880 * t) * Sfx.env(t, 0.003, 0.18) + Sfx.sinP(1318 * t) * Sfx.env(t - 0.05, 0.003, 0.18)) * 0.15);
    this.revealClip = Sfx.make("pc-reveal", 0.8, (t) =>
      (Sfx.sinP(523.25 * t) * Sfx.env(t, 0.005, 0.5) + Sfx.sinP(659.25 * t) * Sfx.env(t - 0.1, 0.005, 0.5) + Sfx.sinP(783.99 * t) * Sfx.env(t - 0.2, 0.005, 0.55) + Sfx.sinP(1046.5 * t) * Sfx.env(t - 0.3, 0.005, 0.6)) * 0.13);

    CasualLook.titleCard(this.UI, new Color(0.2, 0.24, 0.42, 0.86));
    this.path = new LevelPath(this.UI, Accent, Pal.hex(0x4cc85c), Ink);
    this.built = true;
  }

  // ------------------------------------------------------------------ puzzle

  private Load(lvl: number) {
    let rows: string[];
    if (lvl <= PixelCrossPictures.All.length) {
      const pic = PixelCrossPictures.All[lvl - 1];
      rows = pic.Rows;
      this.picName = pic.Name;
    } else {
      rows = this.Generate(lvl);
      this.picName = "PATTERN " + (lvl - PixelCrossPictures.All.length);
    }
    const H = (this.H = rows.length);
    const W = (this.W = rows[0].length);
    for (const t of [...this.gridRoot.children]) t.destroy();
    this.lines = [];
    this.cells = [];
    for (let r = 0; r < H; r++) {
      const row: Cell[] = [];
      for (let c = 0; c < W; c++) {
        const cell = new Cell();
        cell.Pixel = rows[r][c];
        cell.Solution = rows[r][c] !== ".";
        cell.Bg = UIKit.img(this.gridRoot, "Cell", Rounded(), Paper);
        cell.Mk = UIKit.img(cell.Bg.rectTransform, "Mark", XMark(), Cross);
        cell.Mk.rectTransform.stretch(8);
        cell.Mk.enabled = false;
        row.push(cell);
      }
      this.cells.push(row);
    }
    this.rowClues = [];
    this.colClues = [];
    for (let r = 0; r < H; r++) this.rowClues.push(UIKit.label(this.gridRoot, this.Clue(true, r), 30, Ink, TextAnchor.MiddleRight));
    for (let c = 0; c < W; c++) this.colClues.push(UIKit.label(this.gridRoot, this.Clue(false, c), 30, Ink, TextAnchor.LowerCenter));
    for (let i = 0; i <= Math.trunc(W / 5); i++) this.lines.push(UIKit.img(this.gridRoot, "V", Art.Square, Ink.withAlpha(0.55)));
    for (let i = 0; i <= Math.trunc(H / 5); i++) this.lines.push(UIKit.img(this.gridRoot, "H", Art.Square, Ink.withAlpha(0.55)));
    this.Layout();
  }

  private Generate(lvl: number) {
    const r = new SysRandom(lvl * 7919);
    const w = 10, h = 10;
    const palette = ["b", "v", "g", "r", "o", "p", "l", "y"];
    const a = palette[r.next(palette.length)], b = palette[r.next(palette.length)];
    const grid = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
    // symmetric blobs from a few random "seeds" (each row has at least one cell)
    for (let k = 0; k < 7; k++) {
      const cy = r.next(h), cx = r.next(w / 2);
      const rad = 1 + r.next(3);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w / 2; x++)
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad) grid[y][x] = true;
    }
    const rows: string[] = [];
    for (let y = 0; y < h; y++) {
      const chars: string[] = new Array(w);
      let any = false;
      for (let x = 0; x < w; x++) {
        const sx = x < w / 2 ? x : w - 1 - x;
        const on = grid[y][sx];
        any ||= on;
        chars[x] = on ? ((x + y) % 3 === 0 ? b : a) : ".";
      }
      if (!any) { chars[w / 2 - 1] = a; chars[w / 2] = a; }
      rows.push(chars.join(""));
    }
    return rows;
  }

  private Clue(row: boolean, i: number) {
    const parts: number[] = [];
    let run = 0;
    const n = row ? this.W : this.H;
    for (let k = 0; k < n; k++) {
      const on = row ? this.cells[i][k].Solution : this.cells[k][i].Solution;
      if (on) run++;
      else if (run > 0) { parts.push(run); run = 0; }
    }
    if (run > 0) parts.push(run);
    if (parts.length === 0) return "0";
    return parts.join(row ? " " : "\n");
  }

  private MaxClueParts(row: boolean) {
    let best = 1;
    const n = row ? this.H : this.W;
    for (let i = 0; i < n; i++) {
      const s = row ? this.rowClues[i].text : this.colClues[i].text;
      const parts = s.split(row ? " " : "\n").length;
      best = Math.max(best, parts);
    }
    return best;
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    if (!this.built || this.W === 0) return;
    const W = this.W, H = this.H;
    const r = this.board.rect;
    this.lastW = r.width;
    this.lastH = r.height;
    const availW = r.width - 40, availH = r.height - TopBand - BottomBand - 30;
    const rowParts = this.MaxClueParts(true), colParts = this.MaxClueParts(false);
    // clue space measured in cells: rows need ~0.55 cell per number, columns ~0.6 cell per number
    const cw = availW / (W + rowParts * 0.6 + 0.4), ch = availH / (H + colParts * 0.62 + 0.4);
    const cellSize = (this.cellSize = Math.min(cw, ch, 110));
    const clueW = rowParts * 0.6 * cellSize + 10, clueH = colParts * 0.62 * cellSize + 10;
    const gridW = W * cellSize, gridH = H * cellSize;
    const totalW = clueW + gridW, totalH = clueH + gridH;
    const origin = new V2(-totalW * 0.5 + clueW, r.height * 0.5 - TopBand - (availH - totalH) * 0.5 - clueH);
    this.gridRoot.place(UIKit.Center, V2.zero, new V2(10, 10));
    const fs = Mathf.roundToInt(Mathf.clamp(cellSize * 0.42, 16, 40));
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.cells[y][x];
        c.Bg.rectTransform.place(UIKit.Center, origin.add(new V2((x + 0.5) * cellSize, -(y + 0.5) * cellSize)), new V2(cellSize - 3, cellSize - 3));
      }
    for (let y = 0; y < H; y++) {
      this.rowClues[y].fontSize = fs;
      this.rowClues[y].rectTransform.place(UIKit.Center, origin.add(new V2(-clueW * 0.5 - 6, -(y + 0.5) * cellSize)), new V2(clueW, cellSize));
    }
    for (let x = 0; x < W; x++) {
      this.colClues[x].fontSize = fs;
      this.colClues[x].rectTransform.place(UIKit.Center, origin.add(new V2((x + 0.5) * cellSize, clueH * 0.5 + 4)), new V2(cellSize, clueH));
    }
    let li = 0;
    for (let i = 0; i <= Math.trunc(W / 5); i++, li++)
      this.lines[li].rectTransform.place(UIKit.Center, origin.add(new V2(i * 5 * cellSize - 1.5, -gridH * 0.5)), new V2(3, gridH + 2));
    for (let i = 0; i <= Math.trunc(H / 5); i++, li++)
      this.lines[li].rectTransform.place(UIKit.Center, origin.add(new V2(gridW * 0.5, -i * 5 * cellSize + 1.5)), new V2(gridW + 2, 3));
    this.gridOrigin = origin;
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.path.refresh(this.Data, this.CurrentLevel);
  }

  protected BeginRun() {
    this.level = this.CurrentLevel;
    this.Load(this.level);
    this.lives = Lives;
    this.mistakes = 0;
    this.timer = 0;
    this.ended = this.won = this.revived = this.crossMode = this.dragging = false;
    this.pointer.reset();
    this.pointer.topBand = 0.08;
    if (this.Data.get("runs") === 0) this.UI.Hint("Fill squares to match the numbers. Drag to fill a line!");
    this.Data.add("runs", 1);
    Sfx.setIntensity(0);
    this.Refresh();
  }

  // ------------------------------------------------------------------ frame

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    if (Math.abs(this.board.rect.width - this.lastW) > 1 || Math.abs(this.board.rect.height - this.lastH) > 1) this.Layout();
    if (this.ended) {
      this.endTimer -= dt;
      if (this.won) this.Reveal(dt);
      if (this.endTimer <= 0 && this.State === Phase.Playing) { if (this.won) this.Win(); else this.Lose(); }
      return;
    }
    this.timer += dt;
    this.HandleInput();
    this.Animate(dt);
  }

  private CellAt(screen: V2): [boolean, number, number] {
    const local = this.gridRoot.screenToLocal(screen);
    const d = local.sub(this.gridOrigin);
    const c = Math.floor(d.x / this.cellSize);
    const r = Math.floor(-d.y / this.cellSize);
    return [r >= 0 && r < this.H && c >= 0 && c < this.W, r, c];
  }

  private HandleInput() {
    const pointer = this.pointer;
    if (pointer.down) {
      const [ok, r0, c0] = this.CellAt(pointer.screen);
      if (ok) {
        this.dragging = true;
        this.startR = r0;
        this.startC = c0;
        this.lockAxis = -1;
        const cell = this.cells[r0][c0];
        // the first cell decides what the drag does: fill/cross empty cells, or clear our own marks
        this.dragAction = cell.State === Mark.None ? (this.crossMode ? 2 : 1) : cell.State === Mark.Crossed ? 3 : 0;
        this.Apply(r0, c0);
        this.UI.Hint(null);
      }
    }
    if (this.dragging && pointer.held) {
      let [ok, r, c] = this.CellAt(pointer.screen);
      if (ok) {
        if (this.lockAxis < 0 && (r !== this.startR || c !== this.startC)) this.lockAxis = r !== this.startR ? 1 : 0;
        if (this.lockAxis === 0) r = this.startR;
        if (this.lockAxis === 1) c = this.startC;
        this.Apply(r, c);
      }
    }
    if (pointer.up) this.dragging = false;
  }

  private Apply(r: number, c: number) {
    const cell = this.cells[r][c];
    switch (this.dragAction) {
      case 1: // fill
        if (cell.State !== Mark.None) return;
        if (cell.Solution) {
          cell.State = Mark.Filled;
          cell.Pop = 1;
          Sfx.playClip(this.fillClip, 0.6, 0.95 + this.rng.nextDouble() * 0.1);
          this.CheckLines(r, c);
        } else this.Mistake(r, c);
        break;
      case 2: // cross
        if (cell.State !== Mark.None) return;
        if (!cell.Solution) {
          cell.State = Mark.Crossed;
          cell.Pop = 1;
          Sfx.playClip(this.crossClip, 0.5);
        } else {
          // crossing a square that must be filled: it is a mistake, and the square is filled for you
          cell.State = Mark.Filled;
          cell.Pop = 1;
          this.LoseHeart(r, c);
          this.CheckLines(r, c);
        }
        break;
      case 3: // un-cross
        if (cell.State !== Mark.Crossed) return;
        cell.State = Mark.None;
        break;
      default:
        return;
    }
    this.Refresh();
    if (this.Solved()) this.StartWin();
  }

  private Mistake(r: number, c: number) {
    const cell = this.cells[r][c];
    cell.State = Mark.WrongCross;
    cell.Pop = 1;
    this.LoseHeart(r, c);
  }

  private LoseHeart(_r: number, _c: number) {
    this.mistakes++;
    this.lives--;
    this.dragging = false;
    Sfx.playClip(this.wrongClip, 0.8);
    Fx.haptic(true);
    this.Fx.shake(0.12);
    if (this.lives <= 0) {
      this.ended = true;
      this.won = false;
      this.endTimer = 0.8;
      this.UI.Announce("OUT OF HEARTS", Wrong, 1.2);
    }
  }

  private CheckLines(r: number, c: number) {
    let row = true, col = true;
    for (let x = 0; x < this.W; x++) if (this.cells[r][x].Solution && this.cells[r][x].State !== Mark.Filled) row = false;
    for (let y = 0; y < this.H; y++) if (this.cells[y][c].Solution && this.cells[y][c].State !== Mark.Filled) col = false;
    if (row) for (let x = 0; x < this.W; x++) this.AutoCross(r, x, Math.abs(x - c));
    if (col) for (let y = 0; y < this.H; y++) this.AutoCross(y, c, Math.abs(y - r));
    if (row || col) Sfx.playClip(this.lineClip, 0.6);
  }

  private AutoCross(r: number, c: number, dist: number) {
    const cell = this.cells[r][c];
    if (cell.State === Mark.None) cell.State = Mark.Crossed;
    cell.Pop = 1 + dist * 0.06;
  }

  private Solved() {
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++)
        if (this.cells[y][x].Solution && this.cells[y][x].State !== Mark.Filled) return false;
    return true;
  }

  private StartWin() {
    this.ended = true;
    this.won = true;
    this.endTimer = 2.4;
    this.revealT = 0;
    Sfx.playClip(this.revealClip, 1);
    this.UI.Announce(`IT'S A ${this.picName}!`, Accent, 1.8);
    this.fx.confetti(new V2(0, this.ViewSize.y * 0.3), 60, 9, [Accent, Gold, Wrong, Pal.hex(0x4cc85c), Color.white]);
  }

  private Reveal(dt: number) {
    this.revealT += dt;
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const cell = this.cells[y][x];
        const k = Mathf.clamp01((this.revealT - (x + y) * 0.035) / 0.3);
        if (cell.Solution) cell.Bg.color = Color.lerp(Fill, PixelCrossPictures.ColorOf(cell.Pixel), k);
        else {
          cell.Bg.color = Color.lerp(Paper, new Color(1, 1, 1, 0.6), k);
          cell.Mk.enabled = k < 0.5 && cell.State !== Mark.None;
        }
        const s = 1 + Math.sin(k * Math.PI) * 0.15;
        cell.Bg.rectTransform.localScale = new V3(s, s, 1);
      }
    for (const l of this.lines) l.color = Ink.withAlpha(Mathf.lerp(0.55, 0, this.revealT));
  }

  // ------------------------------------------------------------------ visuals

  private Refresh() {
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const c = this.cells[y][x];
        c.Bg.color = c.State === Mark.Filled ? Fill : Paper;
        c.Mk.enabled = c.State === Mark.Crossed || c.State === Mark.WrongCross;
        c.Mk.color = c.State === Mark.WrongCross ? Wrong : Cross;
      }
    for (let y = 0; y < this.H; y++) {
      let done = true;
      for (let x = 0; x < this.W; x++) if (this.cells[y][x].Solution && this.cells[y][x].State !== Mark.Filled) done = false;
      this.rowClues[y].color = done ? Done : Ink;
    }
    for (let x = 0; x < this.W; x++) {
      let done = true;
      for (let y = 0; y < this.H; y++) if (this.cells[y][x].Solution && this.cells[y][x].State !== Mark.Filled) done = false;
      this.colClues[x].color = done ? Done : Ink;
    }
    CasualUI.setText(this.levelText, "PUZZLE " + this.level);
    CasualUI.setText(this.nameText, `${this.W}×${this.H}`);
    for (let i = 0; i < this.hearts.length; i++) this.hearts[i].color = i < this.lives ? Wrong : new Color(0, 0, 0, 0.15);
    if (this.modeButton.label) this.modeButton.label.text = this.crossMode ? "MODE: X" : "MODE: FILL";
    this.modeButton.setAccent(this.crossMode ? Cross : Accent);
    CasualUI.booster(this.hintButton, "HINT", this.Hints, !this.ended);
  }

  private Animate(dt: number) {
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const c = this.cells[y][x];
        if (c.Pop <= 0) continue;
        c.Pop = Math.max(0, c.Pop - dt * 5);
        const k = Math.min(1, c.Pop);
        const s = 1 + Math.sin(k * Math.PI) * 0.18;
        c.Bg.rectTransform.localScale = new V3(s, s, 1);
      }
  }

  private ToggleMode() {
    if (this.State !== Phase.Playing || this.ended) return;
    this.crossMode = !this.crossMode;
    Sfx.play(Snd.Click, 0.5);
    this.Refresh();
  }

  private OnHint() {
    if (this.State !== Phase.Playing || this.ended) return;
    if (!CasualUI.useOrEarn(() => this.Hints, (v) => (this.Hints = v), this.UI, "+1 HINT")) return;
    this.Data.flush();
    const open: V2i[] = [];
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++)
        if (this.cells[y][x].Solution && this.cells[y][x].State !== Mark.Filled) open.push(new V2i(x, y));
    if (open.length === 0) return;
    const pick = open[this.rng.next(open.length)];
    const cell = this.cells[pick.y][pick.x];
    cell.State = Mark.Filled;
    cell.Pop = 1.6;
    Sfx.play(Snd.PowerUp, 0.5);
    this.CheckLines(pick.y, pick.x);
    this.Refresh();
    if (this.Solved()) this.StartWin();
  }

  // ------------------------------------------------------------------ results

  private Win() {
    const stars = this.mistakes === 0 ? 3 : this.mistakes === 1 ? 2 : 1;
    const level = this.level;
    const prev = this.Data.get("s" + level);
    if (stars > prev) { this.Data.set("s" + level, stars); this.Data.add("stars", stars - prev); }
    this.Data.add("solved", 1);
    if (this.mistakes === 0) this.Data.add("perfect", 1);
    this.Data.set("level", level + 1);
    if (level % 5 === 0) this.Hints = this.Hints + 2;
    const lvl = level;
    this.Finish(new Result({
      Headline: `IT'S A ${this.picName}!`,
      HeadlineColor: Gold,
      Stars: stars,
      Value: Fmt.clock(this.timer),
      BestLine: lvl % 5 === 0 ? "GIFT: +2 HINTS" : `NEXT: PUZZLE ${lvl + 1}`,
      Stats: [["TIME", Fmt.clock(this.timer)], ["MISTAKES", String(this.mistakes)], ["SIZE", `${this.W}×${this.H}`], ["SOLVED", String(this.Data.get("solved"))]],
      Primary: "NEXT PUZZLE",
      Victory: true,
      Reward: () => { this.Hints = this.Hints + 1; this.Data.flush(); this.UI.Toast("+1 HINT", 2); },
      RewardLabel: "GET A FREE HINT (WATCH AD)",
    }));
  }

  private Lose() {
    let filled = 0, total = 0;
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++)
        if (this.cells[y][x].Solution) { total++; if (this.cells[y][x].State === Mark.Filled) filled++; }
    this.Finish(new Result({
      Headline: "OUT OF HEARTS",
      HeadlineColor: Pal.hex(0xffc9d0),
      Value: Mathf.roundToInt((filled * 100) / Math.max(1, total)) + "%",
      BestLine: "OF THE PICTURE FILLED",
      Stats: [["PUZZLE", String(this.level)], ["TIME", Fmt.clock(this.timer)], ["SIZE", `${this.W}×${this.H}`], ["SOLVED", String(this.Data.get("solved"))]],
      Primary: "TRY AGAIN",
      Reward: this.revived ? null : () => this.ExtraHeart(),
      RewardLabel: "+1 HEART & CONTINUE (AD)",
    }));
  }

  private ExtraHeart() {
    this.revived = true;
    this.ended = false;
    this.lives = 1;
    this.pointer.reset();
    this.Revive();
    this.Refresh();
    this.UI.Announce("ONE MORE HEART", Accent, 1.1);
  }
}
