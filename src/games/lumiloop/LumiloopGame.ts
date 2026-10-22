import { AdService, applyClientTheme, Behaviour, GameNav, Camera, Color, GameInfo, GameObject, Gamepad, Keyboard, Mathf, Random, Time, V2 } from "../../kit";
import { Arena } from "./Arena";
import { Comet } from "./Comet";
import { EntityKind, Palette, Rules, Save, syncPal } from "./Core";
import { Director, GameEvent } from "./Director";
import { Geo } from "./Geo";
import { Juice } from "./Juice";
import { LightTrail } from "./LightTrail";
import { LumiUI } from "./LumiUI";
import { SteerInput } from "./SteerInput";
import { Entity, Swarm } from "./Swarm";
import { Cue, Synth } from "./Synth";

export enum State { Title, Playing, Paused, Dying, GameOver }

const MaxEnergy = 100;
const ComboWindow = 3;
const HitDamage = 30;
const InvulnerableTime = 1.6;
const LowEnergy = 25;
const ComboScale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]; // pentatonic steps

/**
 * LUMILOOP — an arcade game about drawing loops with light (LumiloopGame.cs).
 *
 * Your comet never stops and leaves a fading trail. Cross the trail to close a loop: everything inside is captured.
 * Sparks refuel your ever-draining light, hunters hurt on touch but are worth big points when looped, cutters sever
 * your trail, and prisms trigger a nova. Chaining loops builds a combo that multiplies score and stretches the trail.
 *
 * This component is the entry point: it builds every system at runtime and runs the game state machine (title/attract
 * mode, playing, paused, dying, game over). Lumiloop has its own small framework instead of ArcadeGame, so the kit host
 * only needs `boot()` and `onFocusLost()` from it.
 */
export class LumiloopGame extends Behaviour {
  static Instance: LumiloopGame | null = null;
  Current = State.Title;

  private arena!: Arena;
  private comet!: Comet;
  private trail!: LightTrail;
  private swarm!: Swarm;
  private juice!: Juice;
  private synth!: Synth;
  private ui!: LumiUI;
  private readonly input = new SteerInput();
  private readonly director = new Director();
  private readonly loop: V2[] = [];
  private readonly captured: Entity[] = [];
  private readonly novaHits: Entity[] = [];

  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private loops = 0;
  private biggestLoop = 0;
  private loopsReported = 0;
  private revived = false;
  private energy = 0;
  private runTime = 0;
  private comboTimer = 0;
  private hitstop = 0;
  private dyingTimer = 0;
  private heartbeatTimer = 0;
  private cutSoundTimer = 0;
  private steerTime = 0;
  private autoTurn = 1;
  private autoFlipTimer = 0;
  private tutorialStep = -1;
  private tutorialTimer = 0;

  // ------------------------------------------------------------------ lifecycle

  /** Awake. */
  boot() {
    LumiloopGame.Instance = this;
    AdService.init();
    this.ApplyTheme();
    this.input.Init();

    Camera.position = V2.zero;
    Camera.roll = 0;
    Camera.backgroundColor = Color.black;

    this.synth = this.Child("Audio", new Synth());
    this.synth.awake();
    this.juice = this.Child("Fx", new Juice());
    this.juice.Init();
    this.arena = this.Child("Arena", new Arena());
    this.arena.Init();
    this.trail = this.Child("Trail", new LightTrail());
    this.trail.Build();
    this.swarm = this.Child("Swarm", new Swarm());
    this.swarm.SetBounds(this.arena.Bounds);
    this.comet = this.Child("Comet", new Comet());
    this.comet.Build();

    this.ui = this.Child("UI", new LumiUI());
    this.ui.Init();
    this.ui.PlayPressed = () => this.StartRun();
    this.ui.RestartPressed = () => this.LeaveGameOver(() => this.StartRun());
    this.ui.PausePressed = () => this.Pause();
    this.ui.ResumePressed = () => this.Resume();
    this.ui.MenuPressed = () => this.LeaveGameOver(() => this.EnterTitle());

    this.EnterTitle();
  }

  /** Client theming (ArcadeGame.boot): accent colours and backgrounds, plus the kit palette for panels and text. */
  private ApplyTheme() {
    const info = applyClientTheme(new GameInfo({
      Id: "lumiloop", Title: "LUMILOOP", Accent: Palette.Comet, Accent2: Palette.CometHot, BgTop: Palette.BgTop, BgBottom: Palette.BgBottom,
    }));
    Palette.Comet = info.Accent;
    Palette.CometHot = info.Accent2;
    Palette.BgTop = info.BgTop;
    Palette.BgBottom = info.BgBottom;
    syncPal();
  }

  onDestroy() {
    GameNav.setPlaying(false);
    if (LumiloopGame.Instance === this) LumiloopGame.Instance = null;
    Time.timeScale = 1;
  }

  /** OnApplicationPause / OnApplicationFocus(false). */
  onFocusLost() {
    if (this.Current === State.Playing && !AdService.isShowing) this.Pause();
    Save.Flush();
  }

  private Child<T extends Behaviour>(childName: string, c: T): T {
    return new GameObject(childName, this.gameObject).addComponent(c);
  }

  // ------------------------------------------------------------------ state transitions

  private EnterTitle() {
    this.Current = State.Title;
    GameNav.setPlaying(false);
    Time.timeScale = 1;
    this.swarm.Clear();
    this.director.Reset(false);
    this.comet.gameObject.setActive(true);
    this.comet.Place(this.arena.Bounds.center, 0);
    this.trail.Restart(this.comet.Position, Time.time);
    this.trail.Lifetime = 2.2;
    this.trail.SetColor(Palette.Comet);
    this.tutorialStep = -1;
    this.input.Reset();
    this.synth.EffectsVolume = 0.3;
    AdService.setBannerVisible(true);
    Synth.SetIntensity(0);
    Synth.Duck(false);
    this.ui.ShowTitle(Save.Best, Save.GamesPlayed, Save.TotalLoops);
    this.RefreshNews();
  }

  private StartRun() {
    this.Current = State.Playing;
    GameNav.setPlaying(true);
    Time.timeScale = 1;

    this.score = this.combo = this.bestCombo = this.loops = this.biggestLoop = this.loopsReported = 0;
    this.revived = false;
    this.energy = MaxEnergy;
    this.runTime = this.comboTimer = this.hitstop = this.steerTime = 0;
    this.heartbeatTimer = this.cutSoundTimer = 0;

    this.swarm.Clear();
    const tutorial = !Save.TutorialDone;
    this.director.Reset(!tutorial);
    this.comet.gameObject.setActive(true);
    this.comet.Place(this.arena.Bounds.center, Math.PI * 0.5);
    this.trail.Restart(this.comet.Position, Time.time);
    this.swarm.SpawnMoteCluster(this.comet.Position);
    this.swarm.SpawnMoteCluster(this.comet.Position);
    this.input.Reset();

    this.synth.EffectsVolume = 1;
    AdService.setBannerVisible(false);
    Synth.Duck(false);
    Synth.Play(Cue.Start);
    this.ui.ShowHud();
    this.juice.Ring(this.comet.Position, Palette.Comet, 0.5, 6, 0.6);

    if (tutorial) this.BeginTutorial();
    else {
      this.tutorialStep = -1;
      this.ui.Hint(null);
      this.ui.Announce("GO!", Palette.Comet);
    }
  }

  private Pause() {
    if (this.Current !== State.Playing) return;
    this.Current = State.Paused;
    this.input.Reset();
    Synth.Duck(true);
    this.ui.ShowPause(true);
  }

  private Resume() {
    if (this.Current !== State.Paused) return;
    this.Current = State.Playing;
    Synth.Duck(false);
    this.ui.ShowPause(false);
    this.comet.MakeInvulnerable(0.8); // a moment to re-orient
  }

  private Die() {
    this.Current = State.Dying;
    this.dyingTimer = 1.1;
    const p = this.comet.Position;
    this.juice.Burst(p, Palette.Comet, 60, 9, 0.35, 1);
    this.juice.Burst(p, Color.white, 20, 4, 0.3, 0.8);
    this.juice.Ring(p, Palette.Comet, 0.5, 9, 0.8);
    this.juice.Shake(1);
    this.juice.Kick(2, 0.8);
    this.arena.Flash(Color.white, 0.35);
    Synth.Play(Cue.GameOver);
    Synth.Duck(true);
    Juice.Haptic(true);
    this.trail.Hide();
    this.comet.gameObject.setActive(false);
    this.ui.Hint(null);
    this.ui.Joystick(false, V2.zero, V2.zero);
  }

  private FinishRun() {
    this.Current = State.GameOver;
    GameNav.setPlaying(false);
    const newBest = this.score > Save.Best;
    if (newBest) Save.Best = this.score;
    if (!this.revived) Save.GamesPlayed++;
    Save.TotalLoops += this.loops - this.loopsReported;
    this.loopsReported = this.loops;
    Save.BestCombo = Math.max(Save.BestCombo, this.bestCombo);
    AdService.runEnded();
    Save.Flush();

    this.ui.ShowGameOver({
      Score: this.score,
      Best: Save.Best,
      NewBest: newBest,
      Seconds: this.runTime,
      Loops: this.loops,
      BiggestLoop: this.biggestLoop,
      BestCombo: this.bestCombo,
    }, this.revived ? null : () => this.ReviveFromAd());
  }

  /** Rewarded continue (once per run): 60% light back, a shockwave and a moment of invulnerability. */
  private ReviveFromAd() {
    this.revived = true;
    this.Current = State.Playing;
    Time.timeScale = 1;
    this.energy = MaxEnergy * 0.6;
    this.combo = 0;
    this.comboTimer = 0;
    this.comet.gameObject.setActive(true);
    this.comet.MakeInvulnerable(2.5);
    this.trail.Restart(this.comet.Position, Time.time);
    this.swarm.Knockback(this.comet.Position, 6, 12);
    this.juice.Ring(this.comet.Position, Palette.Comet, 0.5, 10, 0.7);
    this.input.Reset();
    Synth.Duck(false);
    Synth.Play(Cue.Start);
    this.ui.ShowHud();
    this.ui.Announce("REVIVED!", Palette.Comet);
  }

  /** Remote announcements (LiveConfig) are a native service: the web has none. */
  private RefreshNews() { this.ui.SetNews(null); }

  /** Leaving the game-over screen is the only point an interstitial may appear (frequency-capped). */
  private LeaveGameOver(next: () => void) {
    if (AdService.isShowing) return;
    if (this.Current === State.GameOver) AdService.betweenRuns(next);
    else next();
  }

  // ------------------------------------------------------------------ frame loop

  update() {
    const dt = Time.deltaTime;
    if (this.arena.Refresh()) this.swarm.SetBounds(this.arena.Bounds);
    this.HandleBack();

    switch (this.Current) {
      case State.Title:
        this.TickAttract(dt);
        break;
      case State.Playing:
        this.TickPlaying(dt);
        break;
      case State.Dying:
        this.swarm.Tick(dt, this.comet.Position, Time.time);
        this.dyingTimer -= Time.unscaledDeltaTime;
        if (this.dyingTimer <= 0) this.FinishRun();
        break;
      case State.GameOver:
        this.swarm.Tick(dt, this.comet.Position, Time.time);
        break;
    }

    this.ApplyTimeScale();
  }

  private HandleBack() {
    if (AdService.isShowing) return;
    let back = Keyboard.escape.wasPressedThisFrame; // also Android's back button
    if (Gamepad.connected && Gamepad.start.wasPressedThisFrame) back = true;
    if (!back) return;

    switch (this.Current) {
      case State.Playing: this.Pause(); break;
      case State.Paused: this.Resume(); break;
      case State.GameOver: this.EnterTitle(); break;
      case State.Title: this.ui.CloseModal(); break;
    }
  }

  private ApplyTimeScale() {
    let scale = 1;
    switch (this.Current) {
      case State.Paused:
        scale = 0;
        break;
      case State.Dying:
        scale = 0.3;
        break;
      case State.Playing:
        if (this.hitstop > 0) {
          this.hitstop -= Time.unscaledDeltaTime;
          scale = 0.05;
        }
        break;
    }
    Time.timeScale = scale;
  }

  /** Title-screen demo: the comet flies itself, drawing loops around sparks. */
  private TickAttract(dt: number) {
    this.autoFlipTimer -= dt;
    if (this.autoFlipTimer <= 0) {
      this.autoTurn = -this.autoTurn;
      this.autoFlipTimer = Random.range(2.5, 4.5);
    }

    const b = this.arena.Bounds;
    const p = this.comet.Position;
    const nearWall = p.x < b.xMin + 2 || p.x > b.xMax - 2 || p.y < b.yMin + 2 || p.y > b.yMax - 2;
    if (nearWall) this.comet.Steer(b.center.sub(p), dt);
    else this.comet.Turn(this.autoTurn * (4.6 + 1.2 * Math.sin(Time.time * 0.9)), dt);

    this.comet.Move(dt, b);
    this.comet.Animate(dt, Palette.Comet, this.juice);
    if (this.trail.Advance(this.comet.Position, Time.time, this.loop)) this.ResolveLoop(true);

    this.director.Tick(dt, this.swarm, this.comet.Position, this.arena.AreaScale, false);
    this.swarm.Tick(dt, this.comet.Position, Time.time);
  }

  private TickPlaying(dt: number) {
    this.input.Update(this.comet.Position);
    this.ui.Joystick(this.input.JoystickActive, this.input.JoyOrigin, this.input.JoyCurrent);
    if (this.input.HasDirection) {
      this.comet.Steer(this.input.Direction, dt);
      this.steerTime += dt;
    }

    if (this.comet.Move(dt, this.arena.Bounds)) {
      Synth.Play(Cue.Bounce, 0.6);
      this.arena.PulseBorder();
    }

    const trailColor = this.TrailColor();
    this.comet.Animate(dt, trailColor, this.juice);
    this.trail.SetColor(trailColor);
    this.trail.Lifetime = 1.5 + 0.1 * Math.min(this.combo, 10);
    if (this.trail.Advance(this.comet.Position, Time.time, this.loop)) this.ResolveLoop(false);
    if (this.Current !== State.Playing) return;

    const tutorial = this.tutorialStep >= 0;
    switch (this.director.Tick(dt, this.swarm, this.comet.Position, this.arena.AreaScale, !tutorial)) {
      case GameEvent.Surge:
        this.ui.Announce("HUNTER SURGE!", Palette.Hunter);
        Synth.Play(Cue.Surge);
        this.arena.Flash(Palette.Hunter, 0.15);
        break;
      case GameEvent.SparkBloom:
        this.ui.Announce("SPARK BLOOM!", Palette.Mote);
        Synth.Play(Cue.NewBest, 0.6);
        break;
    }
    this.swarm.Tick(dt, this.comet.Position, Time.time);

    if (!this.comet.Invulnerable) {
      const hunter = this.swarm.FirstHarmfulTouching(this.comet.Position, Comet.Radius);
      if (hunter) this.TakeHit(hunter);
    }
    this.CheckCutters(dt);

    this.runTime += dt;
    if (!tutorial || this.tutorialStep >= 3) this.energy -= Mathf.lerp(3.2, 7, this.director.Clock / 240) * dt;

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    const low = this.energy < LowEnergy;
    if (low) {
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        Synth.Play(Cue.Heartbeat, 0.8);
        this.heartbeatTimer = Mathf.lerp(0.55, 1.1, this.energy / LowEnergy);
      }
    }
    this.arena.SetDanger(low ? 1 - (this.energy / LowEnergy) * 0.6 : 0);

    this.TickTutorial(dt);
    Synth.SetIntensity(0.35 + Math.min(this.director.Clock / 150, 0.45) + Math.min(this.combo, 5) * 0.04);
    this.ui.UpdateHud(this.score, Save.Best, this.energy / MaxEnergy, this.combo, this.comboTimer / ComboWindow, low);

    if (this.energy <= 0) {
      this.energy = 0;
      this.Die();
    }
  }

  // ------------------------------------------------------------------ rules

  private ResolveLoop(attract: boolean) {
    const center = Geo.Centroid(this.loop);
    this.swarm.CaptureInside(this.loop, center, this.captured);
    const n = this.captured.length;
    const color = attract ? Palette.Comet : this.TrailColor();
    this.juice.Loop(this.loop, center, color, n > 0);

    if (attract) {
      if (n > 0) this.juice.Ring(center, color, 0.4, 3, 0.4);
      return;
    }

    if (n === 0) {
      Synth.Play(Cue.Whiff, 0.5);
      if (this.tutorialStep === 1) this.AdvanceTutorial();
      return;
    }

    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = ComboWindow;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.loops++;
    this.biggestLoop = Math.max(this.biggestLoop, n);

    let basePoints = 0, gain = 0;
    let gotMote = false, gotHunter = false, gotPrism = false;
    for (const e of this.captured) {
      basePoints += Rules.Points(e.Kind);
      gain += Rules.Energy(e.Kind);
      gotMote ||= e.Kind === EntityKind.Mote;
      gotHunter ||= e.Kind === EntityKind.Hunter;
      gotPrism ||= e.Kind === EntityKind.Prism;
    }
    const multiplier = Math.min(this.combo, 10);
    const points = Mathf.roundToInt(basePoints * (1 + (n - 1) * 0.5) * multiplier);
    this.score += points;
    this.energy = Math.min(MaxEnergy, this.energy + gain);

    this.ui.FloatText(center, "+" + points.toLocaleString("en-US"), Color.lerp(color, Color.white, 0.4), 1 + Math.min(n, 10) * 0.06);
    const label = n >= 10 ? "SUPERNOVA!" : n >= 6 ? "MEGA LOOP!" : n >= 3 ? "NICE LOOP!" : null;
    if (label) this.ui.FloatText(center.add(V2.up.mul(1.1)), label, Palette.CometHot, 1.1);
    if (this.combo >= 2 && this.combo % 5 === 0) this.ui.Announce("COMBO x" + this.combo + "!", Palette.CometHot);

    Synth.Play(Cue.Loop, 0.8, Math.pow(2, ComboScale[Math.min(this.combo - 1, ComboScale.length - 1)] / 12));
    if (gotMote) Synth.Play(Cue.Spark, 0.6);
    this.juice.Ring(center, color, 0.5, 3.5 + n * 0.3, 0.45);
    this.juice.Kick(0.6 + n * 0.05, 0);
    if (gotHunter) {
      Synth.Play(Cue.HunterDown);
      this.juice.Shake(0.25);
      this.hitstop = 0.05;
    }
    Juice.Haptic(gotHunter);

    if (gotPrism) this.TriggerNova(center, multiplier);

    if (this.tutorialStep === 1) this.AdvanceTutorial();
    else if (this.tutorialStep === 2 && gotMote) this.AdvanceTutorial();
    else if (this.tutorialStep === 3 && gotHunter) this.AdvanceTutorial();
  }

  private TriggerNova(center: V2, multiplier: number) {
    this.swarm.Nova(center, 7.5, this.novaHits);
    let points = 0;
    for (const e of this.novaHits) points += Rules.Points(e.Kind);
    points *= multiplier;
    this.score += points;

    this.juice.Ring(center, Palette.Prism, 0.5, 16, 0.7);
    this.juice.Ring(center, Color.white, 0.3, 9, 0.5);
    this.juice.Burst(center, Palette.Prism, 40, 10, 0.3, 0.9);
    this.juice.Kick(2.5, 0.6);
    this.juice.Shake(0.5);
    this.arena.Flash(Palette.Prism, 0.25);
    Synth.Play(Cue.Nova);
    Juice.Haptic(true);
    this.ui.Announce(points > 0 ? "NOVA +" + points : "NOVA!", Palette.Prism);
  }

  private TakeHit(_hunter: Entity) {
    this.energy -= HitDamage;
    this.combo = 0;
    this.comboTimer = 0;
    const p = this.comet.Position;
    this.comet.MakeInvulnerable(InvulnerableTime);
    this.swarm.Knockback(p, 5, 9);
    this.trail.Restart(p, Time.time);

    this.juice.Burst(p, Palette.Hunter, 26, 7);
    this.juice.Ring(p, Palette.Hunter, 0.5, 4, 0.4);
    this.juice.Shake(0.7);
    this.juice.Kick(0.8, 0.9);
    this.arena.Flash(Palette.Danger, 0.3);
    this.hitstop = 0.09;
    Synth.Play(Cue.Hurt);
    Juice.Haptic(true);
    this.ui.FloatText(p, "-" + Mathf.roundToInt(HitDamage), Palette.Danger, 1.1);
  }

  private CheckCutters(dt: number) {
    this.cutSoundTimer -= dt;
    for (const e of this.swarm.Live) {
      if (e.Kind !== EntityKind.Cutter || e.Captured || e.Age < 0.4) continue;
      const at = this.trail.TryCut(e.Pos, e.Radius + 0.08);
      if (!at) continue;
      this.juice.Burst(at, Palette.Cutter, 12, 4, 0.18, 0.4);
      if (this.cutSoundTimer <= 0) {
        Synth.Play(Cue.Cut, 0.8);
        this.cutSoundTimer = 0.15;
      }
    }
  }

  private TrailColor() { return Color.lerp(Palette.Comet, Palette.CometHot, Mathf.clamp01((this.combo - 1) / 5)); }

  // ------------------------------------------------------------------ tutorial (first run only)

  private BeginTutorial() {
    this.tutorialStep = 0;
    this.tutorialTimer = 0;
    this.ShowTutorialHint();
  }

  private AdvanceTutorial() {
    this.tutorialStep++;
    this.tutorialTimer = 0;
    if (this.tutorialStep >= 5) {
      this.tutorialStep = -1;
      Save.TutorialDone = true;
      Save.Flush();
      this.director.Hunters = this.director.Cutters = this.director.Prisms = this.director.Events = true;
      this.ui.Hint(null);
      this.ui.Announce("GO!", Palette.Comet);
      return;
    }
    Synth.Play(Cue.Spark, 0.7, 1.5);
    if (this.tutorialStep === 3) this.swarm.Telegraph(EntityKind.Hunter, this.swarm.RandomSpawnPoint(this.comet.Position, 6), 1.2);
    this.ShowTutorialHint();
  }

  private ShowTutorialHint() {
    switch (this.tutorialStep) {
      case 0:
        this.ui.Hint(this.input.UsingTouch ? "Drag anywhere to steer your comet" : "Steer with the mouse, WASD or the arrow keys");
        break;
      case 1: this.ui.Hint("Cross your own trail to close a LOOP"); break;
      case 2: this.ui.Hint("Loop around the golden SPARKS to refuel your light"); break;
      case 3: this.ui.Hint("HUNTERS drain your light on touch. Trap one in a loop!"); break;
      case 4: this.ui.Hint("Loop quickly to chain combos. Good luck!"); break;
    }
  }

  private TickTutorial(dt: number) {
    if (this.tutorialStep < 0) return;
    this.tutorialTimer += dt;
    switch (this.tutorialStep) {
      case 0:
        if (this.steerTime > 1.6) this.AdvanceTutorial();
        break;
      case 3:
        if (this.swarm.CountOf(EntityKind.Hunter) === 0) this.swarm.Telegraph(EntityKind.Hunter, this.swarm.RandomSpawnPoint(this.comet.Position, 6), 1.2);
        if (this.tutorialTimer > 16) this.AdvanceTutorial(); // don't hold anyone hostage
        break;
      case 4:
        if (this.tutorialTimer > 3.5) this.AdvanceTutorial();
        break;
    }
  }
}
