import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Fmt, Fx, FontStyle, GameInfo,
  GameObject, howTo, Image, Keyboard, Mathf, Pal, Phase, Result, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer, Text,
  TextAnchor, TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import { SudokuLogic } from "./SudokuLogic";

/**
 * SUDOKU ZEN: calm, classic 9×9 Sudoku with four difficulties. Tap a cell, then a number. Pencil notes, undo, erase
 * and hints (three free per puzzle, more with a rewarded ad). Three mistakes end the puzzle; a rewarded ad gives a
 * second chance. Every puzzle has exactly one solution. The board is drawn with UI elements on the shared HUD canvas
 * so digits are always crisp. (Port of SudokuZenGame.cs.)
 */

const TopBand = 210;
const MaxMistakes = 3;

const Paper = Pal.hex(0xfffbf2), Ink = Pal.hex(0x2f3a33), Jade = Pal.hex(0x2e8b6e), Wrong = Pal.hex(0xe0503e),
  Selected = Pal.hex(0xbfe3cf), Related = Pal.hex(0xeaf2e4), Same = Pal.hex(0xd3ebdd), Thick = Pal.hex(0x3f5a4a), Gold = Pal.hex(0xe8b04a);

class Cell {
  Bg!: Image;
  Num!: Text;
  Notes: Text[] | null = null;
  Value = 0; NotesMask = 0;
  Given = false;
  Delay = 0; Pulse = 0;
  Base = Paper;
}

interface UndoStep { Index: number; Value: number; Notes: number }

const Backdrop = () => CasualArt.make("sz-backdrop", 128, 256, (p) => {
  let c = Color.lerp(Pal.hex(0xe7eedf), Pal.hex(0xf6f1e6), CasualArt.smooth(-2, 2, p.y));
  // ink-wash mountains
  for (let layer = 0; layer < 3; layer++) {
    const baseY = -0.9 - layer * 0.35;
    const h = baseY + 0.35 * Math.exp(-Math.pow((p.x - 0.4 + layer * 0.45) * 2.2, 2)) + 0.2 * Math.exp(-Math.pow((p.x + 0.5 - layer * 0.2) * 3, 2))
      + 0.03 * Math.sin(p.x * 13 + layer);
    if (p.y < h) c = Color.lerp(c, layer === 0 ? Pal.hex(0xc9d7c6) : layer === 1 ? Pal.hex(0xa9c1ae) : Pal.hex(0x86a592), 0.85);
  }
  // a faint ensō
  const r = p.sub(new V2(0.35, 1.3)).magnitude;
  const ang = Math.atan2(p.y - 1.3, p.x - 0.35);
  const brush = Math.abs(r - 0.42) - 0.03 * (0.5 + 0.5 * Math.sin(ang * 1.3 + 1));
  if (ang > -2.6) c = Color.lerp(c, Pal.hex(0x6f8d7a), CasualArt.fill(brush, 2 / 128) * 0.35);
  return c.withAlpha(1);
});

export class SudokuZenGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject;
  private bgCover!: SpriteRenderer;
  private board!: UINode; private gridRoot!: UINode; private controls!: UINode;
  private cells: Cell[] = [];
  private puzzle = new Array<number>(81).fill(0);
  private solution = new Array<number>(81).fill(0);
  private undo: UndoStep[] = [];
  private boxLines: Image[] = [];
  private pad: ArcadeButton[] = [];
  private padCount: Text[] = [];
  private undoB!: ArcadeButton; private eraseB!: ArcadeButton; private notesB!: ArcadeButton; private hintB!: ArcadeButton;
  private diffText!: Text; private timeText!: Text; private mistakeText!: Text;
  private diffButtons: (ArcadeButton | null)[] = [null, null, null, null];
  private pointer = new TapPointer();
  private fx!: CasualFx;

  private selected = -1; private mistakes = 0; private hintsLeft = 0; private difficulty = 0;
  private notesMode = false; private finished = false; private revived = false; private built = false;
  private timer = 0; private cellSize = 0; private boardSize = 0; private endTimer = 0;
  private gridCenter = V2.zero;
  private lastW = 0; private lastH = 0;

  private placeClip!: AudioClip; private wrongClip!: AudioClip; private noteClip!: AudioClip; private doneClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "sudokuzen",
      Title: "SUDOKU ZEN",
      Tagline: "BREATHE. THINK. FILL THE GRID.",
      Accent: Jade,
      Accent2: Gold,
      BgTop: Pal.hex(0xf3eee2),
      BgBottom: Pal.hex(0xe4ebdd),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 66, rootHz: 110, degrees: [0, 3, 5, 4], seed: 8, energy: 0.15, major: true },
      Reminders: [
        "A fresh puzzle is ready|Take a calm minute with Sudoku Zen.",
        "Train your brain|Can you beat your best Sudoku time?",
        "Expert puzzle waiting|Only for the bravest minds.",
      ],
      HowTo: [
        howTo(Art.Square, Jade, "Fill the grid so every ROW, COLUMN and 3×3 BOX has the numbers 1 to 9 once."),
        howTo(Art.Chevron, Jade, "TAP a cell, then tap a NUMBER. Keyboard: arrows and 1-9."),
        howTo(Art.Diamond, Wrong, "A wrong number turns red and counts as a mistake. Three mistakes end the puzzle."),
        howTo(Art.Ring, Jade, "NOTES mode writes small pencil marks to keep track of possibilities."),
        howTo(Art.Star, Gold, "Finish with no mistakes for three stars."),
      ],
      Tips: [
        "Start with the numbers that already appear most often.",
        "If a box has only one place for a number, put it there.",
        "Use notes on hard puzzles: write every candidate, then cross them out.",
        "Every puzzle has exactly one solution - no guessing needed.",
        "Take a breath. There is no timer pressure.",
      ],
    });
  }

  protected get ShortSide() { return 9; }

  protected BestLine() {
    const best = this.Data.get("best" + this.Difficulty);
    return `${SudokuLogic.Levels[this.Difficulty]}` + (best > 0 ? `   ·   BEST ${Fmt.clock(best / 1000)}` : "");
  }

  protected StatsLine() { return `${this.Data.get("solved")} PUZZLES SOLVED   ·   ${this.Data.get("perfect")} PERFECT`; }

  private get Difficulty() { return Mathf.clamp(this.Data.get("diff"), 0, 3); }
  private set Difficulty(v: number) { this.Data.set("diff", Mathf.clamp(v, 0, 3)); }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("SudokuWorld", this.gameObject);
    CasualLook.calm(this, 1.4, 0.1);
    this.bgCover = CasualLook.cover(this.world, Backdrop(), -910);
    this.fx = CasualFx.create(this.world, 50, 120);

    this.board = UIKit.node("Board", this.UI.Hud).stretch();
    this.board.setAsFirstSibling();
    this.gridRoot = UIKit.node("Grid", this.board);
    UIKit.img(this.gridRoot, "GridBg", Art.UiRound, Thick).rectTransform.stretch(-10);
    for (let i = 0; i < 81; i++) {
      const c = new Cell();
      c.Bg = UIKit.img(this.gridRoot, "Cell", Art.Square, Paper);
      c.Num = UIKit.label(c.Bg.rectTransform, "", 60, Ink);
      c.Num.rectTransform.stretch();
      this.cells.push(c);
    }
    for (let i = 0; i < 4; i++) this.boxLines.push(UIKit.img(this.gridRoot, "BoxLine", Art.Square, Thick));

    this.controls = UIKit.node("Controls", this.board);
    for (let d = 0; d < 9; d++) {
      const digit = d + 1;
      this.pad[d] = UIKit.button(this.controls, String(digit), new V2(104, 120), false, () => this.Enter(digit), 58);
      this.pad[d].setAccent(Jade);
      this.padCount[d] = UIKit.at(UIKit.label(this.pad[d].node, "", 20, Jade), new V2(0.5, 0), new V2(0, 16), new V2(100, 26));
    }
    this.undoB = UIKit.button(this.controls, "UNDO", new V2(220, 92), false, () => this.Undo(), 28);
    this.eraseB = UIKit.button(this.controls, "ERASE", new V2(220, 92), false, () => this.Erase(), 28);
    this.notesB = UIKit.button(this.controls, "NOTES", new V2(220, 92), false, () => this.ToggleNotes(), 28);
    this.hintB = UIKit.button(this.controls, "HINT", new V2(220, 92), false, () => this.OnHint(), 28);
    for (const b of [this.undoB, this.eraseB, this.notesB, this.hintB]) b.setAccent(Pal.hex(0x5a7a66));
    this.hintB.setAccent(Gold);

    const hud = this.UI.Hud;
    const plate = UIKit.img(hud, "TopPlate", Art.UiRound, new Color(1, 1, 1, 0.75));
    plate.rectTransform.place(new V2(0.5, 1), new V2(-60, -86), new V2(820, 110));
    this.diffText = UIKit.at(UIKit.label(plate.rectTransform, "", 34, Jade), new V2(0, 0.5), new V2(160, 0), new V2(280, 60));
    this.timeText = UIKit.at(UIKit.label(plate.rectTransform, "0:00", 38, Ink), UIKit.Center, V2.zero, new V2(200, 60));
    this.mistakeText = UIKit.at(UIKit.label(plate.rectTransform, "", 28, Ink), new V2(1, 0.5), new V2(-150, 0), new V2(280, 50));

    if (this.UI.TitleExtra) {
      CasualLook.titleCard(this.UI, new Color(0.18, 0.27, 0.22, 0.86));
      for (let d = 0; d < 4; d++) {
        const level = d;
        this.diffButtons[d] = UIKit.buttonAt(this.UI.TitleExtra, SudokuLogic.Levels[d], UIKit.Center, new V2((d - 1.5) * 235, 0), new V2(220, 90), false, () => this.PickDifficulty(level), 28);
        this.diffButtons[d]!.setAccent(Jade);
      }
      this.RefreshDifficulty();
    }

    this.placeClip = Sfx.make("sz-place", 0.18, (t) => (Sfx.sinP(880 * t) * 0.5 + Sfx.sinP(1320 * t) * 0.2) * Sfx.env(t, 0.003, 0.14) * 0.25);
    this.wrongClip = Sfx.make("sz-wrong", 0.25, (t) => Sfx.triP(Sfx.glide(t, 260, 190, 0.2)) * 0.6 * Sfx.env(t, 0.003, 0.2) * 0.3);
    this.noteClip = Sfx.make("sz-note", 0.08, (t) => Sfx.sinP(1600 * t) * Sfx.env(t, 0.002, 0.05) * 0.15);
    this.doneClip = Sfx.make("sz-done", 0.6, (t) =>
      (Sfx.sinP(523.25 * t) * Sfx.env(t, 0.005, 0.4) + Sfx.sinP(659.25 * t) * Sfx.env(t - 0.07, 0.005, 0.4) + Sfx.sinP(783.99 * t) * Sfx.env(t - 0.14, 0.005, 0.45) + Sfx.sinP(1046.5 * t) * Sfx.env(t - 0.21, 0.005, 0.5)) * 0.13);
    this.built = true;
    this.Layout();
  }

  private PickDifficulty(d: number) {
    this.Difficulty = d;
    this.Data.flush();
    Sfx.play(Snd.Click, 0.6);
    this.RefreshDifficulty();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private RefreshDifficulty() {
    for (let d = 0; d < 4; d++) this.diffButtons[d]?.setAccent(d === this.Difficulty ? Gold : Jade);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    if (!this.built) return;
    const r = this.board.rect;
    const w = r.width, h = r.height;
    const landscape = w > h * 1.15;
    const tools = [this.undoB, this.eraseB, this.notesB, this.hintB];
    if (!landscape) {
      this.boardSize = Math.min(w - 50, h - TopBand - 400);
      this.gridCenter = new V2(0, h * 0.5 - TopBand - this.boardSize * 0.5 - 10);
      const padY = this.gridCenter.y - this.boardSize * 0.5 - 210;
      const toolsY = this.gridCenter.y - this.boardSize * 0.5 - 75;
      this.controls.place(UIKit.Center, V2.zero, new V2(w, h));
      const pw = Math.min(112, (w - 40) / 9);
      for (let d = 0; d < 9; d++) this.pad[d].node.place(UIKit.Center, new V2((d - 4) * pw, padY), new V2(pw - 8, 130));
      const tw = Math.min(240, (w - 40) / 4);
      for (let i = 0; i < 4; i++) tools[i].node.place(UIKit.Center, new V2((i - 1.5) * tw, toolsY), new V2(tw - 14, 92));
    } else {
      this.boardSize = Math.min(h - TopBand - 40, w * 0.55);
      this.gridCenter = new V2(-w * 0.5 + 40 + this.boardSize * 0.5, h * 0.5 - TopBand - this.boardSize * 0.5);
      this.controls.place(UIKit.Center, V2.zero, new V2(w, h));
      const cx = (this.gridCenter.x + this.boardSize * 0.5 + w * 0.5) * 0.5;
      const s = Math.min(140, (w * 0.5 - this.boardSize * 0.5) / 3.4);
      for (let d = 0; d < 9; d++)
        this.pad[d].node.place(UIKit.Center, new V2(cx + ((d % 3) - 1) * s, this.gridCenter.y - 40 + (1 - Math.trunc(d / 3)) * s), new V2(s - 10, s - 10));
      for (let i = 0; i < 4; i++)
        tools[i].node.place(UIKit.Center, new V2(cx + ((i % 2) - 0.5) * s * 1.5, this.gridCenter.y + s * 1.6 + (1 - Math.trunc(i / 2)) * 100), new V2(s * 1.4, 86));
    }
    this.gridRoot.place(UIKit.Center, this.gridCenter, new V2(this.boardSize, this.boardSize));
    this.cellSize = this.boardSize / 9;
    for (let i = 0; i < 81; i++) {
      const row = Math.trunc(i / 9), col = i % 9;
      const x = -this.boardSize * 0.5 + (col + 0.5) * this.cellSize, y = this.boardSize * 0.5 - (row + 0.5) * this.cellSize;
      const c = this.cells[i];
      c.Bg.rectTransform.place(UIKit.Center, new V2(x, y), new V2(this.cellSize - 2, this.cellSize - 2));
      c.Num.fontSize = Mathf.roundToInt(this.cellSize * 0.62);
      if (c.Notes) this.PlaceNotes(c);
    }
    for (let i = 0; i < 2; i++) {
      const off = -this.boardSize * 0.5 + (i + 1) * 3 * this.cellSize;
      this.boxLines[i].rectTransform.place(UIKit.Center, new V2(off, 0), new V2(5, this.boardSize));
      this.boxLines[i + 2].rectTransform.place(UIKit.Center, new V2(0, -off), new V2(this.boardSize, 5));
    }
  }

  private PlaceNotes(c: Cell) {
    for (let k = 0; k < 9; k++) {
      const nx = ((k % 3) - 1) * this.cellSize * 0.3, ny = (1 - Math.trunc(k / 3)) * this.cellSize * 0.3;
      c.Notes![k].rectTransform.place(UIKit.Center, new V2(nx, ny), new V2(this.cellSize * 0.33, this.cellSize * 0.33));
      c.Notes![k].fontSize = Mathf.roundToInt(this.cellSize * 0.24);
    }
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.RefreshDifficulty();
  }

  protected BeginRun() {
    this.Layout();
    this.difficulty = this.Difficulty;
    SudokuLogic.Generate(this.difficulty, new SysRandom(), this.puzzle, this.solution);
    for (let i = 0; i < 81; i++) {
      const c = this.cells[i];
      c.Value = this.puzzle[i];
      c.Given = this.puzzle[i] !== 0;
      c.NotesMask = 0;
      SudokuZenGame.Pulse(c, (Math.trunc(i / 9) + (i % 9)) * 0.025);
    }
    this.undo = [];
    this.selected = -1;
    this.mistakes = 0;
    this.hintsLeft = 3;
    this.notesMode = this.finished = this.revived = false;
    this.timer = 0;
    this.pointer.reset();
    this.pointer.topBand = 0.08;
    this.Data.add("games", 1);
    if (this.Data.get("games") === 1) this.UI.Hint("Tap an empty cell, then tap a number below.");
    Sfx.setIntensity(0);
    this.Refresh();
  }

  // ------------------------------------------------------------------ frame

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    if (Math.abs(this.board.rect.width - this.lastW) > 1 || Math.abs(this.board.rect.height - this.lastH) > 1) {
      this.lastW = this.board.rect.width;
      this.lastH = this.board.rect.height;
      this.Layout();
    }
    if (this.finished) {
      this.endTimer -= dt;
      this.Animate(dt);
      if (this.endTimer <= 0 && this.State === Phase.Playing) this.Win();
      return;
    }
    this.timer += dt;
    if (this.pointer.tap) this.TapAt(this.pointer.screen);
    this.Keys();
    this.Animate(dt);
    SudokuZenGame.SetText(this.timeText, Fmt.clock(this.timer));
  }

  private TapAt(screen: V2) {
    const local = this.gridRoot.screenToLocal(screen);
    const half = this.boardSize * 0.5;
    if (local.x < -half || local.x > half || local.y < -half || local.y > half) return;
    const col = Mathf.clamp(Math.floor((local.x + half) / this.cellSize), 0, 8);
    const row = Mathf.clamp(Math.floor((half - local.y) / this.cellSize), 0, 8);
    this.selected = row * 9 + col;
    Sfx.playClip(this.noteClip, 0.5, 0.8);
    this.UI.Hint(null);
    this.Refresh();
  }

  private Keys() {
    const kb = Keyboard;
    if (this.selected < 0 && (kb.up.wasPressedThisFrame || kb.down.wasPressedThisFrame || kb.left.wasPressedThisFrame || kb.right.wasPressedThisFrame)) { this.selected = 40; this.Refresh(); return; }
    if (this.selected >= 0) {
      let r = Math.trunc(this.selected / 9), c = this.selected % 9;
      if (kb.up.wasPressedThisFrame) r = (r + 8) % 9;
      if (kb.down.wasPressedThisFrame) r = (r + 1) % 9;
      if (kb.left.wasPressedThisFrame) c = (c + 8) % 9;
      if (kb.right.wasPressedThisFrame) c = (c + 1) % 9;
      if (r * 9 + c !== this.selected) { this.selected = r * 9 + c; this.Refresh(); }
    }
    for (let d = 0; d < 9; d++) if (kb.digit(d + 1).wasPressedThisFrame) this.Enter(d + 1);
    if (kb.backspace.wasPressedThisFrame || kb.key("Delete").wasPressedThisFrame) this.Erase();
    if (kb.letter("n").wasPressedThisFrame) this.ToggleNotes();
    if (kb.letter("z").wasPressedThisFrame) this.Undo();
    if (kb.letter("h").wasPressedThisFrame) this.OnHint();
  }

  // ------------------------------------------------------------------ actions

  private Enter(digit: number) {
    if (this.State !== Phase.Playing || this.finished || this.selected < 0) return;
    const c = this.cells[this.selected];
    if (c.Given || (c.Value !== 0 && c.Value === this.solution[this.selected])) { Sfx.play(Snd.Deny, 0.3); return; }
    if (this.notesMode) {
      if (c.Value !== 0) return;
      this.undo.push({ Index: this.selected, Value: c.Value, Notes: c.NotesMask });
      c.NotesMask ^= 1 << digit;
      Sfx.playClip(this.noteClip, 0.6);
      this.Refresh();
      return;
    }
    this.undo.push({ Index: this.selected, Value: c.Value, Notes: c.NotesMask });
    c.Value = digit;
    c.NotesMask = 0;
    if (digit !== this.solution[this.selected]) {
      this.mistakes++;
      SudokuZenGame.Pulse(c, 0);
      Sfx.playClip(this.wrongClip, 0.8);
      Fx.haptic(true);
      if (this.mistakes >= MaxMistakes) {
        this.Refresh();
        this.Lose();
        return;
      }
    } else {
      Sfx.playClip(this.placeClip, 0.7, 0.9 + digit * 0.03);
      this.ClearNotesAround(this.selected, digit);
      this.CheckGroups(this.selected);
      if (this.Solved()) {
        this.finished = true;
        this.endTimer = 1.4;
        for (let i = 0; i < 81; i++) SudokuZenGame.Pulse(this.cells[i], (Math.trunc(i / 9) + (i % 9)) * 0.03);
        Sfx.playClip(this.doneClip, 1);
        this.fx.confetti(new V2(0, this.ViewSize.y * 0.25), 70, 9, [Jade, Gold, Pal.hex(0xff8fa3), Pal.hex(0x7fb8ff), Color.white]);
        this.UI.Announce("SOLVED!", Jade, 1.6);
      }
    }
    this.Refresh();
  }

  private ClearNotesAround(idx: number, digit: number) {
    const r = Math.trunc(idx / 9), c = idx % 9, br = Math.trunc(r / 3) * 3, bc = Math.trunc(c / 3) * 3;
    for (let i = 0; i < 81; i++) {
      const rr = Math.trunc(i / 9), cc = i % 9;
      if (rr === r || cc === c || (Math.trunc(rr / 3) * 3 === br && Math.trunc(cc / 3) * 3 === bc)) this.cells[i].NotesMask &= ~(1 << digit);
    }
  }

  private CheckGroups(idx: number) {
    const r = Math.trunc(idx / 9), c = idx % 9, br = Math.trunc(r / 3) * 3, bc = Math.trunc(c / 3) * 3;
    let row = true, col = true, box = true;
    for (let k = 0; k < 9; k++) {
      if (this.cells[r * 9 + k].Value !== this.solution[r * 9 + k]) row = false;
      if (this.cells[k * 9 + c].Value !== this.solution[k * 9 + c]) col = false;
      const bi = (br + Math.trunc(k / 3)) * 9 + bc + (k % 3);
      if (this.cells[bi].Value !== this.solution[bi]) box = false;
    }
    let done = 0;
    for (let k = 0; k < 9; k++) {
      if (row) SudokuZenGame.Pulse(this.cells[r * 9 + k], Math.abs(k - c) * 0.04);
      if (col) SudokuZenGame.Pulse(this.cells[k * 9 + c], Math.abs(k - r) * 0.04);
      if (box) SudokuZenGame.Pulse(this.cells[(br + Math.trunc(k / 3)) * 9 + bc + (k % 3)], k * 0.03);
    }
    if (row) done++;
    if (col) done++;
    if (box) done++;
    if (done > 0) {
      Sfx.play(Snd.Coin, 0.35, 1 + done * 0.1);
      Fx.haptic();
    }
  }

  private Solved() {
    for (let i = 0; i < 81; i++) if (this.cells[i].Value !== this.solution[i]) return false;
    return true;
  }

  private Erase() {
    if (this.State !== Phase.Playing || this.finished || this.selected < 0) return;
    const c = this.cells[this.selected];
    if (c.Given || (c.Value !== 0 && c.Value === this.solution[this.selected])) return;
    if (c.Value === 0 && c.NotesMask === 0) return;
    this.undo.push({ Index: this.selected, Value: c.Value, Notes: c.NotesMask });
    c.Value = 0;
    c.NotesMask = 0;
    Sfx.play(Snd.Click, 0.5);
    this.Refresh();
  }

  private Undo() {
    if (this.State !== Phase.Playing || this.finished || this.undo.length === 0) return;
    const u = this.undo.pop()!;
    const c = this.cells[u.Index];
    c.Value = u.Value;
    c.NotesMask = u.Notes;
    this.selected = u.Index;
    Sfx.play(Snd.Whoosh, 0.35);
    this.Refresh();
  }

  private ToggleNotes() {
    if (this.State !== Phase.Playing || this.finished) return;
    this.notesMode = !this.notesMode;
    Sfx.play(Snd.Click, 0.5);
    this.Refresh();
  }

  private OnHint() {
    if (this.State !== Phase.Playing || this.finished) return;
    if (this.hintsLeft > 0) {
      if (this.GiveHint()) this.hintsLeft--;
      return;
    }
    if (!AdService.rewardedAvailable) return;
    AdService.showRewarded((ok) => {
      if (!ok) return;
      this.hintsLeft += 3;
      this.UI.Toast("+3 HINTS", 2);
      Sfx.play(Snd.PowerUp, 0.7);
    });
  }

  private GiveHint() {
    let idx = this.selected;
    if (idx < 0 || this.cells[idx].Value === this.solution[idx]) {
      // pick the empty cell with the fewest candidates (the most "logical" next step)
      idx = -1;
      let best = 10;
      const g = new Array<number>(81);
      for (let i = 0; i < 81; i++) g[i] = this.cells[i].Value === this.solution[i] ? this.cells[i].Value : 0;
      for (let i = 0; i < 81; i++) {
        if (g[i] !== 0) continue;
        let n = 0;
        for (let v = 1; v <= 9; v++) if (SudokuLogic.Allowed(g, i, v)) n++;
        if (n < best) { best = n; idx = i; }
      }
    }
    if (idx < 0) return false;
    this.selected = idx;
    const wasNotes = this.notesMode;
    this.notesMode = false;
    this.Enter(this.solution[idx]);
    this.notesMode = wasNotes;
    SudokuZenGame.Pulse(this.cells[idx], 0);
    return true;
  }

  // ------------------------------------------------------------------ visuals

  private Refresh() {
    const selVal = this.selected >= 0 ? this.cells[this.selected].Value : 0;
    const sr = Math.trunc(this.selected / 9), sc = this.selected % 9;
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < 81; i++) {
      const c = this.cells[i];
      if (c.Value === this.solution[i] && c.Value !== 0) counts[c.Value]++;
      const r = Math.trunc(i / 9), col = i % 9;
      let bg = Paper;
      if (this.selected >= 0) {
        const related = r === sr || col === sc || (Math.trunc(r / 3) === Math.trunc(sr / 3) && Math.trunc(col / 3) === Math.trunc(sc / 3));
        if (related) bg = Related;
        if (selVal !== 0 && c.Value === selVal) bg = Same;
        if (i === this.selected) bg = Selected;
      }
      c.Bg.color = bg;
      c.Base = bg;
      c.Num.text = c.Value === 0 ? "" : String(c.Value);
      c.Num.color = c.Given ? Ink : c.Value === this.solution[i] ? Jade : Wrong;
      c.Num.fontStyle = c.Given ? FontStyle.Bold : FontStyle.Normal;
      if (c.NotesMask !== 0 && !c.Notes) {
        c.Notes = [];
        for (let k = 0; k < 9; k++) c.Notes.push(UIKit.label(c.Bg.rectTransform, String(k + 1), 20, Pal.hex(0x5a7a66), TextAnchor.MiddleCenter, FontStyle.Normal));
        this.PlaceNotes(c);
      }
      if (c.Notes)
        for (let k = 0; k < 9; k++) c.Notes[k].enabled = c.Value === 0 && (c.NotesMask & (1 << (k + 1))) !== 0;
    }
    for (let d = 0; d < 9; d++) {
      const left = 9 - counts[d + 1];
      this.padCount[d].text = left > 0 ? String(left) : "";
      this.pad[d].interactable = left > 0;
    }
    SudokuZenGame.SetText(this.diffText, SudokuLogic.Levels[this.difficulty]);
    SudokuZenGame.SetText(this.mistakeText, `MISTAKES ${this.mistakes}/${MaxMistakes}`);
    this.mistakeText.color = this.mistakes > 0 ? Wrong : Ink;
    if (this.notesB.label) this.notesB.label.text = this.notesMode ? "NOTES: ON" : "NOTES: OFF";
    this.notesB.setAccent(this.notesMode ? Gold : Pal.hex(0x5a7a66));
    if (this.hintB.label) this.hintB.label.text = this.hintsLeft > 0 ? `HINT ×${this.hintsLeft}` : AdService.rewardedAvailable ? "HINT +AD" : "HINT";
    this.undoB.interactable = this.undo.length > 0;
  }

  private static Pulse(c: Cell, delay: number) {
    c.Delay = delay;
    c.Pulse = 1;
  }

  private Animate(dt: number) {
    for (const c of this.cells) {
      if (c.Pulse <= 0) continue;
      if (c.Delay > 0) { c.Delay -= dt; continue; }
      c.Pulse = Math.max(0, c.Pulse - dt * 2.5);
      const k = Math.sin((1 - c.Pulse) * Math.PI);
      const s = 1 + k * 0.12;
      c.Bg.rectTransform.localScale = new V3(s, s, 1);
      const flash = c.Num.color.equals(Wrong) && c.Value !== 0 ? Pal.hex(0xf8c9c0) : Pal.hex(0xbfe6ce);
      c.Bg.color = Color.lerp(c.Base, flash, k * 0.7);
      if (c.Pulse <= 0) {
        c.Bg.rectTransform.localScale = V3.one;
        c.Bg.color = c.Base;
      }
    }
  }

  private static SetText(t: Text | null, s: string) {
    if (t && t.text !== s) t.text = s;
  }

  // ------------------------------------------------------------------ results

  private Win() {
    const stars = this.mistakes === 0 ? 3 : this.mistakes === 1 ? 2 : 1;
    this.Data.add("solved", 1);
    if (this.mistakes === 0) this.Data.add("perfect", 1);
    const newBest = this.Data.min("best" + this.difficulty, Mathf.roundToInt(this.timer * 1000));
    this.Finish(new Result({
      Headline: this.mistakes === 0 ? "PERFECT!" : "SOLVED!",
      HeadlineColor: Gold,
      Stars: stars,
      Value: Fmt.clock(this.timer),
      NewBest: newBest,
      BestLine: `${SudokuLogic.Levels[this.difficulty]} · BEST ${Fmt.clock(this.Data.get("best" + this.difficulty) / 1000)}`,
      Stats: [
        ["TIME", Fmt.clock(this.timer)],
        ["MISTAKES", String(this.mistakes)],
        ["LEVEL", SudokuLogic.Levels[this.difficulty]],
        ["SOLVED", String(this.Data.get("solved"))],
      ],
      Primary: "NEW PUZZLE",
      Victory: true,
    }));
  }

  private Lose() {
    Sfx.play(Snd.Lose, 0.6);
    let filled = 0;
    for (let i = 0; i < 81; i++) if (this.cells[i].Value === this.solution[i]) filled++;
    this.Finish(new Result({
      Headline: "THREE MISTAKES",
      HeadlineColor: Pal.hex(0xffc9c0),
      Value: Mathf.roundToInt((filled / 81) * 100) + "%",
      BestLine: "OF THE GRID COMPLETE",
      Stats: [
        ["TIME", Fmt.clock(this.timer)],
        ["LEVEL", SudokuLogic.Levels[this.difficulty]],
        ["FILLED", `${filled}/81`],
        ["SOLVED", String(this.Data.get("solved"))],
      ],
      Primary: "NEW PUZZLE",
      Reward: this.revived ? null : () => this.SecondChance(),
      RewardLabel: "SECOND CHANCE (WATCH AD)",
    }));
  }

  private SecondChance() {
    this.revived = true;
    this.mistakes = MaxMistakes - 1;
    // remove the wrong number that ended the game
    for (let i = 0; i < 81; i++) if (!this.cells[i].Given && this.cells[i].Value !== 0 && this.cells[i].Value !== this.solution[i]) this.cells[i].Value = 0;
    this.pointer.reset();
    this.Revive();
    this.Refresh();
    this.UI.Announce("ONE MORE TRY", Jade, 1.2);
  }
}
