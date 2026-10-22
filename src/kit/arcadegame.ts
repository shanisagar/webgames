import { GameEvents, parseScore } from "./events";
import { AdService } from "./ads";
import { Backdrop, Fx } from "./fx";
import { ArcadeInput, Keyboard, Gamepad, Screen, screenToWorld } from "./input";
import { Rect, V2 } from "./math";
import { Prefs } from "./prefs";
import { Camera } from "./render";
import { Behaviour, GameObject, Time } from "./scene";
import { Sfx, Snd } from "./sfx";
import { GameInfo, Result, Shell } from "./shell";
import { applyClientTheme } from "./theme";

export enum Phase { Title, Playing, Paused, Over }

/**
 * Base class for every Neon Arcade game (ArcadeGame.cs). It builds the camera, post-processing, audio, backdrop and
 * UI shell, then runs the shared state machine (title → playing ⇄ paused → result) including back button, focus-loss
 * pause, hitstop and slow motion. Subclasses describe themselves and implement the gameplay hooks.
 */
export abstract class ArcadeGame extends Behaviour {
  static Current: ArcadeGame | null = null;
  State = Phase.Title;
  protected Info!: GameInfo;
  protected UI!: Shell;
  protected Fx!: Fx;
  protected Back!: Backdrop;
  protected Data!: Prefs;
  protected readonly Controls = new ArcadeInput();
  /** World size of the camera view. */
  protected ViewSize = V2.one;
  /** Seconds of unpaused play in the current run. */
  protected RunTime = 0;
  /** Fast-forward multiplier applied while playing. */
  protected SpeedMultiplier = 1;
  private hitstopT = 0;
  private slowScale = 1;
  private slowTimer = 0;
  private lastLayout = "";

  // ------------------------------------------------------------------ hooks

  protected abstract Describe(): GameInfo;
  /** Create persistent world objects (called once). */
  protected abstract Build(): void;
  /** Reset and start a run. */
  protected abstract BeginRun(): void;
  protected abstract TickRun(dt: number): void;
  /** Runs on the title and result screens (attract mode / ambient motion). */
  protected TickBackground(_dt: number): void {}
  protected OnEnterTitle(): void {}
  protected OnPauseChanged(_paused: boolean): void {}
  protected OnLayoutChanged(): void {}
  protected BestLine(): string { return ""; }
  protected StatsLine(): string { return ""; }
  /** World point the mouse aim is measured from (usually the player). */
  protected get AimOrigin(): V2 { return V2.zero; }
  /** Override to zoom per game state. */
  protected get ShortSide(): number { return this.Info.ShortSide; }

  /** Builds the game (called by the host once the renderer and UI root exist). */
  boot() {
    ArcadeGame.Current = this;
    AdService.init();
    this.Info = applyClientTheme(this.Describe());
    this.Data = new Prefs(this.Info.Id);
    this.Controls.init();
    this.Controls.scheme = this.Info.Touch;
    Sfx.engine.init(this.Info.Music);
    const root = this.gameObject;
    this.Fx = new GameObject("Fx", root).addComponent(new Fx());
    this.Fx.init();
    this.Back = new GameObject("Backdrop", root).addComponent(new Backdrop());
    this.Back.init(this.Info.BgTop, this.Info.BgBottom, this.Info.Accent, this.Info.Accent2, this.Info.GridSpacing);
    this.UI = new GameObject("UI", root).addComponent(new Shell());
    this.UI.init(this.Info);
    this.UI.PlayPressed = () => this.StartRun();
    this.UI.RestartPressed = () => this.LeaveResult(() => this.StartRun());
    this.UI.PausePressed = () => this.Pause();
    this.UI.ResumePressed = () => this.Resume();
    this.UI.MenuPressed = () => this.LeaveResult(() => this.EnterTitle());
    this.FitCamera(true);
    this.Build();
    this.EnterTitle();
    GameEvents.setGame(this.Info.Id);
    GameEvents.emit({ type: "ready", game: this.Info.Id });
  }

  /** Page hidden / window blurred: pause like OnApplicationPause. */
  onFocusLost() {
    if (AdService.isShowing) return;
    if (this.State === Phase.Playing) this.Pause();
  }

  onDestroy() { if (ArcadeGame.Current === this) ArcadeGame.Current = null; Time.timeScale = 1; }

  // ------------------------------------------------------------------ state machine

  protected EnterTitle() {
    this.State = Phase.Title;
    Time.timeScale = 1;
    this.hitstopT = this.slowTimer = 0;
    this.Controls.reset();
    Sfx.effectsVolume = 0.5;
    Sfx.setIntensity(0);
    Sfx.duck(false);
    this.Back.setDanger(0);
    this.OnEnterTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  protected StartRun() {
    this.State = Phase.Playing;
    Time.timeScale = 1;
    this.hitstopT = this.slowTimer = 0;
    this.RunTime = 0;
    this.Controls.reset();
    Sfx.effectsVolume = 1;
    Sfx.duck(false);
    this.Back.setDanger(0);
    this.UI.ShowHud();
    Sfx.play(Snd.Start);
    this.BeginRun();
    GameEvents.emit({ type: "start", game: this.Info.Id });
  }

  Pause() {
    if (this.State !== Phase.Playing || this.UI.ChoiceOpen) return;
    this.State = Phase.Paused;
    this.Controls.reset();
    Sfx.duck(true);
    this.UI.ShowPause(true);
    this.OnPauseChanged(true);
    GameEvents.emit({ type: "pause", game: this.Info.Id });
  }

  Resume() {
    if (this.State !== Phase.Paused) return;
    this.State = Phase.Playing;
    Sfx.duck(false);
    this.UI.ShowPause(false);
    this.OnPauseChanged(false);
    GameEvents.emit({ type: "resume", game: this.Info.Id });
  }

  /** Ends the run and shows the result screen. */
  protected Finish(result: Result) {
    this.State = Phase.Over;
    this.Controls.reset();
    Sfx.duck(true);
    this.Back.setDanger(0);
    AdService.runEnded();
    this.UI.ShowResult(result);
    GameEvents.emit({
      type: "end", game: this.Info.Id, score: parseScore(result.Value, result.CountTo), victory: result.Victory,
      stars: result.Stars >= 0 ? result.Stars : null, seconds: Math.round(this.RunTime),
    });
  }

  /** Leaving a result screen is the only moment an interstitial may appear (frequency-capped). */
  private LeaveResult(next: () => void) {
    if (AdService.isShowing) return;
    if (this.State === Phase.Over) AdService.betweenRuns(next);
    else next();
  }

  /** Resumes a finished run (after a rewarded "continue" ad) without resetting it. */
  protected Revive() {
    this.State = Phase.Playing;
    Time.timeScale = 1;
    this.hitstopT = this.slowTimer = 0;
    this.Controls.reset();
    Sfx.duck(false);
    this.Back.setDanger(0);
    this.UI.ShowHud();
    GameEvents.emit({ type: "revive", game: this.Info.Id });
  }

  /** Briefly freezes time for impact. */
  protected Hitstop(seconds: number) { this.hitstopT = Math.max(this.hitstopT, seconds); }
  protected SlowMo(scale: number, seconds: number) { this.slowScale = scale; this.slowTimer = seconds; }

  // ------------------------------------------------------------------ frame loop

  update() {
    this.FitCamera(false);
    this.HandleSystemKeys();
    const dt = Time.deltaTime;
    switch (this.State) {
      case Phase.Title:
      case Phase.Over:
        this.TickBackground(dt);
        break;
      case Phase.Playing:
        this.Controls.update(this.AimOrigin);
        this.UI.Stick(0, this.Controls.left.active, this.Controls.left.origin, this.Controls.left.current);
        this.UI.Stick(1, this.Controls.right.active, this.Controls.right.origin, this.Controls.right.current);
        this.RunTime += dt;
        this.TickRun(dt);
        break;
    }
    this.ApplyTimeScale();
  }

  private HandleSystemKeys() {
    if (AdService.isShowing) return;
    const back = Keyboard.escape.wasPressedThisFrame || (Gamepad.connected && Gamepad.start.wasPressedThisFrame);
    if (back) {
      switch (this.State) {
        case Phase.Playing: this.Pause(); break;
        case Phase.Paused: this.Resume(); break;
        case Phase.Over: this.EnterTitle(); break;
        case Phase.Title: this.UI.CloseModal(); break;
      }
      return;
    }
    if (this.State === Phase.Playing && !this.UI.ChoiceOpen) return; // Space/Enter belong to gameplay
    const confirm = Keyboard.enter.wasPressedThisFrame || Keyboard.numpadEnter.wasPressedThisFrame || Keyboard.space.wasPressedThisFrame
      || (Gamepad.connected && Gamepad.buttonSouth.wasPressedThisFrame);
    if (confirm) this.UI.Confirm();
  }

  private ApplyTimeScale() {
    let scale = 1;
    const udt = Time.unscaledDeltaTime;
    if (this.State === Phase.Paused) scale = 0;
    else if (this.State === Phase.Playing && this.UI.ChoiceOpen) scale = 0;
    else if (this.State === Phase.Playing && this.slowTimer <= 0 && this.hitstopT <= 0) scale = this.SpeedMultiplier;
    else {
      if (this.slowTimer > 0) { this.slowTimer -= udt; scale = this.slowScale; }
      if (this.hitstopT > 0) { this.hitstopT -= udt; scale = 0.05; }
    }
    Time.timeScale = scale;
  }

  protected FitCamera(force: boolean) {
    const s = this.ShortSide, aspect = Screen.width / Math.max(1, Screen.height);
    const ortho = aspect < 1 ? s / (2 * aspect) : s * 0.5;
    const sa = Screen.safeArea;
    const key = `${Screen.width}x${Screen.height}:${sa.x},${sa.y},${sa.width},${sa.height}:${ortho}`;
    if (!force && key === this.lastLayout) return;
    this.lastLayout = key;
    Camera.orthographicSize = ortho;
    this.ViewSize = new V2(ortho * 2 * aspect, ortho * 2);
    if (!force) this.OnLayoutChanged();
  }

  /**
   * World-space rectangle (relative to the camera centre) left for gameplay after the safe area and HUD bands
   * (in canvas units, where the screen's short side is 1080) are removed.
   */
  protected PlayRect(topBandUi: number, bottomBandUi: number, margin = 0.3) {
    const w = this.ViewSize.x, h = this.ViewSize.y, sw = Math.max(1, Screen.width), sh = Math.max(1, Screen.height);
    const safe = Screen.safeArea, unitsPerUi = Math.min(w, h) / 1080;
    const left = (safe.xMin / sw) * w + margin, right = ((sw - safe.xMax) / sw) * w + margin;
    const bottom = (safe.yMin / sh) * h + bottomBandUi * unitsPerUi + margin;
    const top = ((sh - safe.yMax) / sh) * h + topBandUi * unitsPerUi + margin;
    return Rect.minMaxRect(-w * 0.5 + left, -h * 0.5 + bottom, w * 0.5 - right, h * 0.5 - top);
  }

  protected ScreenToWorld(screen: V2) { return screenToWorld(screen); }

  /** Short side (world units) that fits a `need`-sized board between HUD bands, in portrait or landscape. */
  protected static FitShortSide(need: V2, topUi: number, bottomUi: number) {
    const aspect = Screen.width / Math.max(1, Screen.height), bands = (topUi + bottomUi) / 1080;
    if (aspect < 1) return Math.max(need.x, need.y / Math.max(0.2, 1 / aspect - bands));
    return Math.max(need.y / Math.max(0.2, 1 - bands), need.x / aspect);
  }
}
