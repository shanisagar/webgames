import { LevelData } from "../core/level";
import { getLevel } from "../core/levels";
import { PuzzleBoard } from "../core/puzzleBoard";
import { loveNote } from "./loveNotes";
import { Save } from "./save";
import { Sfx, haptic } from "./sfx";
import { toast, ui } from "./store";
import { Theme, getTheme } from "./theme";

export const MAX_LIVES = 3;
export const LEVELS_PER_BONUS_HINT = 5;

type State = "menu" | "playing" | "won" | "lost";

/** What the controller needs from the Phaser board (see BoardScene). */
export interface BoardViewApi {
  build(level: LevelData, theme: Theme, intro: boolean): void;
  applyTheme(theme: Theme): void;
  /** Arrow under a screen point (CSS pixels), with tolerance for fat fingers, or -1. */
  pick(screenX: number, screenY: number, logic: PuzzleBoard): number;
  isBusy(id: number): boolean;
  launch(id: number, stepsToEdge: number): void;
  bounce(id: number, freeSteps: number, blocker: number): void;
  showHint(id: number, rayLength: number): void;
  clearHint(): void;
  readonly hintArrow: number;
  readonly anyAnimating: boolean;
  /** Squared distance from the arrow head to the view centre, used to pick a hint the player can see. */
  distanceToView(id: number): number;
  playWinWave(): void;
  shake(amount: number): void;
  mistakePulse(): void;
  winPulse(): void;
  /** Fractions of the screen height covered by the top and bottom HUD bars. */
  setInsets(top: number, bottom: number): void;
  resetView(): void;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const wait = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));

function tutorialText(level: number): string | null {
  switch (level) {
    case 1: return "TAP AN ARROW TO LAUNCH IT OFF THE GRID";
    case 2: return "BLOCKED ARROWS BOUNCE BACK AND COST A LIFE";
    case 3: return "PINCH OR SCROLL TO ZOOM - DRAG TO PAN";
    default: return null;
  }
}

/** Owns the game loop: level lifecycle, lives, hints, win / lose and progression (port of GameController.cs). */
export class GameController {
  board!: BoardViewApi;
  logic: PuzzleBoard | null = null;
  levelNumber = 1;
  lives = MAX_LIVES;
  mistakes = 0;
  state: State = "menu";
  theme: Theme = getTheme(Save.theme);
  private levelStart = 0;
  private continueUsed = false;
  private run = 0; // invalidates pending win/lose sequences when the level changes

  attach(board: BoardViewApi) {
    this.board = board;
    this.loadLevel(Save.currentLevel);
    this.goToMenu();
  }

  // ------------------------------------------------------------------ lifecycle

  private loadLevel(number: number) {
    this.run++;
    this.levelNumber = number;
    const data = getLevel(number);
    this.logic = new PuzzleBoard(data);
    this.lives = MAX_LIVES;
    this.mistakes = 0;
    this.continueUsed = false;
    this.board.build(data, this.theme, true);
    Sfx.play("appear", 0.8);
    this.refresh();
  }

  private beginPlay() {
    this.state = "playing";
    this.levelStart = performance.now();
    this.board.setInsets(0.16, 0.14);
    ui.set({ screen: "hud", overlay: null, tutorial: tutorialText(this.levelNumber), win: null });
    toast(loveNote(this.levelNumber), 3.8);
  }

  playLevel(number: number) {
    Save.currentLevel = number;
    this.loadLevel(number);
    this.beginPlay();
  }

  restartLevel() { this.loadLevel(this.levelNumber); this.beginPlay(); }
  nextLevel() { this.playLevel(this.levelNumber + 1); }

  goToMenu() {
    // Show a fresh copy of the next level to play behind the menu.
    if (this.state !== "menu") this.loadLevel(Save.currentLevel);
    this.state = "menu";
    this.board.clearHint();
    this.board.setInsets(0.05, 0.05);
    this.board.resetView();
    ui.set({ screen: "menu", overlay: null, tutorial: null, win: null, saveVersion: ui.get().saveVersion + 1 });
  }

  continueWithExtraLife() {
    if (this.state !== "lost" || this.continueUsed) return;
    this.continueUsed = true;
    this.lives = 1;
    this.state = "playing";
    ui.set({ screen: "hud" });
    this.refresh();
    Sfx.play("hint");
  }

  /** Escape / Android back: close the top overlay, then back out of the current screen. */
  back(): boolean {
    const s = ui.get();
    if (s.overlay) { ui.set({ overlay: null }); return true; }
    if (s.screen === "win" || s.screen === "lose" || this.state === "playing") { this.goToMenu(); return true; }
    return false;
  }

  // ------------------------------------------------------------------ input

  get inputEnabled() { return this.state === "playing" && !ui.get().overlay; }

  handleTap(screenX: number, screenY: number) {
    if (!this.inputEnabled || !this.logic) return;
    const id = this.board.pick(screenX, screenY, this.logic);
    if (id < 0 || this.board.isBusy(id)) return;

    ui.set({ tutorial: null });
    const r = this.logic.canExit(id);
    if (r.ok) {
      const steps = this.logic.rayLength(id);
      this.logic.remove(id);
      this.board.launch(id, steps);
      Sfx.play("launch", 0.7);
      this.refresh();
      if (this.logic.remaining === 0) void this.winSequence();
    } else {
      this.board.bounce(id, r.freeSteps, r.blocker);
      this.mistakes++;
      this.lives--;
      Sfx.play("error", 0.8);
      haptic(true);
      this.board.mistakePulse();
      this.board.shake(0.8);
      ui.set({ mistakes: ui.get().mistakes + 1 });
      this.refresh();
      if (this.lives <= 0) void this.loseSequence();
    }
  }

  useHint() {
    if (this.state !== "playing" || !this.logic) return;
    const logic = this.logic;

    // Re-show the current hint for free if it is still valid.
    const current = this.board.hintArrow;
    if (current >= 0 && !logic.isRemoved(current)) {
      this.board.showHint(current, logic.rayLength(current));
      return;
    }
    if (Save.hints <= 0) {
      toast(`NO HINTS LEFT - CLEAR ${LEVELS_PER_BONUS_HINT} SECTORS FOR +1`);
      Sfx.play("error", 0.4);
      return;
    }

    // Prefer arrows that are not moving and are closest to the view centre.
    let best = -1, bestScore = Infinity;
    for (const f of logic.freeArrows()) {
      if (this.board.isBusy(f)) continue;
      const score = this.board.distanceToView(f);
      if (score < bestScore) { bestScore = score; best = f; }
    }
    if (best < 0) return;

    Save.hints = Save.hints - 1;
    this.board.showHint(best, logic.rayLength(best));
    Sfx.play("hint");
    this.refresh();
  }

  // ------------------------------------------------------------------ outcomes

  static starsForMistakes(m: number) { return Math.min(Math.max(3 - m, 1), 3); }

  private async settle(run: number) {
    while (this.board.anyAnimating) {
      await nextFrame();
      if (run !== this.run) return false;
    }
    return run === this.run;
  }

  private async winSequence() {
    const run = this.run;
    this.state = "won";
    ui.set({ tutorial: null });
    if (!(await this.settle(run))) return;
    await wait(0.15);
    if (run !== this.run) return;

    this.board.playWinWave();
    this.board.winPulse();
    Sfx.play("win");
    await wait(0.55);
    if (run !== this.run) return;

    const stars = GameController.starsForMistakes(this.mistakes);
    let bonusHint = false;
    if (Save.completeLevel(this.levelNumber, stars) && this.levelNumber % LEVELS_PER_BONUS_HINT === 0) {
      Save.hints = Save.hints + 1;
      bonusHint = true;
    }
    const time = (performance.now() - this.levelStart) / 1000;
    ui.set({ screen: "win", win: { stars, time, mistakes: this.mistakes, bonusHint }, saveVersion: ui.get().saveVersion + 1 });
  }

  private async loseSequence() {
    const run = this.run;
    this.state = "lost";
    this.board.clearHint();
    if (!(await this.settle(run))) return;
    await wait(0.25);
    if (run !== this.run) return;
    Sfx.play("lose");
    ui.set({ screen: "lose", canContinue: !this.continueUsed });
  }

  // ------------------------------------------------------------------ settings

  setTheme(index: number) {
    Save.theme = index;
    this.theme = getTheme(index);
    this.board.applyTheme(this.theme);
    ui.set({ themeIndex: Save.theme });
  }

  resetProgress() {
    Save.resetProgress();
    this.state = "playing"; // forces goToMenu to load level 1 behind the menu
    this.goToMenu();
    toast("PROGRESS RESET");
  }

  private refresh() {
    const l = this.logic;
    ui.set({
      levelNumber: this.levelNumber,
      difficulty: l ? l.level.difficulty : 0,
      remaining: l ? l.remaining : 0,
      lives: this.lives,
      hints: Save.hints,
      themeIndex: ((Save.theme % 5) + 5) % 5,
    });
  }
}

export const game = new GameController();
