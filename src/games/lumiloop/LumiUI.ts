import {
  AdService, ArcadeButton, Behaviour, Camera, CanvasGroup, Color, Coroutine, Ease, Fmt, FontStyle, Gamepad, Image, ImageType,
  Keyboard, Mathf, Outline, Random, Screen, Sprite, Text, TextAnchor, Time, UI, UINode, uiFont, V2, V3, waitReal,
} from "../../kit";
import { Palette, Save } from "./Core";
import { Art } from "./LumiArt";
import { Cue, Synth } from "./Synth";
import { UIKit } from "./UIKit";

export interface RunResult {
  Score: number; Best: number; Loops: number; BiggestLoop: number; BestCombo: number;
  Seconds: number;
  NewBest: boolean;
}

/** Local reminders are a native-only service: the row stays hidden on the web, as on unsupported platforms. */
const Notifications = { Supported: false, Enabled: false };

const Tips = [
  "Hunters turn slowly. Swing wide and loop around them.",
  "Bigger loops multiply points. Catch many things at once.",
  "Combos stretch your trail, so huge loops become possible.",
  "Cutters only slice your trail. They can't hurt you.",
  "A Prism's nova clears every hunter nearby.",
  "Low on light? Chase spark clusters first.",
  "Bounce off the walls to make sudden sharp turns.",
  "Loop quickly after a catch to keep your combo alive.",
];

const Center = new V2(0.5, 0.5);

interface Floater { Text: Text; Outline: Outline; Age: number; Life: number; Scale: number; Start: V2 }

/**
 * All screens, built from code (LumiUI.cs): title, HUD, pause, game over, how-to-play and settings, plus floating score
 * text and the on-screen thumb-stick. Layout adapts to portrait, landscape and device safe areas.
 */
export class LumiUI extends Behaviour {
  PlayPressed: (() => void) | null = null;
  PausePressed: (() => void) | null = null;
  ResumePressed: (() => void) | null = null;
  RestartPressed: (() => void) | null = null;
  MenuPressed: (() => void) | null = null;

  private safeRoot!: UINode;
  private fxRoot!: UINode;
  private title!: CanvasGroup;
  private hud!: CanvasGroup;
  private pause!: CanvasGroup;
  private over!: CanvasGroup;
  private howTo!: CanvasGroup;
  private settings!: CanvasGroup;
  private modal: CanvasGroup | null = null;
  private readonly fades = new Map<CanvasGroup, Coroutine | null>();
  private lastKey = "";
  private clock = 0;

  // HUD
  private scoreText!: Text;
  private bestText!: Text;
  private comboText!: Text;
  private hintText!: Text;
  private announceText!: Text;
  private announceGlow!: Outline;
  private comboRing!: Image;
  private energyImage!: Image;
  private comboRoot!: UINode;
  private energyFill!: UINode;
  private hint!: CanvasGroup;
  private announce!: CanvasGroup;
  private announceRoutine: Coroutine | null = null;
  private shownScore = 0;
  private shownEnergy = 1;
  private comboPop = 0;
  private hintTarget = 0;
  private hintPop = 0;
  private shownScoreInt = -1;
  private shownBest = -1;
  private lastCombo = 0;

  // Title
  private logo!: Text;
  private titleBest!: Text;
  private titleStats!: Text;
  private newsText!: Text;
  private notifyToggle!: ArcadeButton;
  private notifyLabel!: Text;
  private toastRoutine: Coroutine | null = null;
  private logoGlow!: Outline;
  private playButton!: ArcadeButton;

  // Settings and pause
  private soundToggle!: ArcadeButton;
  private musicToggle!: ArcadeButton;
  private hapticsToggle!: ArcadeButton;
  private tutorialButton!: ArcadeButton;
  private pauseSound!: ArcadeButton;
  private pauseMusic!: ArcadeButton;
  private resumeButton!: ArcadeButton;

  // Game over
  private retryButton!: ArcadeButton;
  private reviveButton!: ArcadeButton;
  private pendingRevive: (() => void) | null = null;
  private overScore!: Text;
  private overBest!: Text;
  private overTip!: Text;
  private statValues: Text[] = [];
  private newBestBadge!: UINode;
  private overRoutine: Coroutine | null = null;

  // Touch stick and floating text
  private joystick!: CanvasGroup;
  private joyBase!: UINode;
  private joyKnob!: UINode;
  private joyTarget = 0;
  private readonly floaters: Floater[] = [];

  // ------------------------------------------------------------------ construction

  Init() {
    const root = UI.root!;
    root.el.style.setProperty("--na-font", uiFont());
    this.fxRoot = UIKit.node("Fx", root).stretch();
    this.safeRoot = UIKit.node("Safe", root).stretch();

    this.BuildJoystick();
    this.BuildFloaters();
    this.BuildHud();
    this.BuildTitle();
    this.BuildPause();
    this.BuildGameOver();
    this.BuildHowTo();
    this.BuildSettings();

    this.ApplyLayout(true);
    this.RefreshToggles();
  }

  onDestroy() {
    this.fxRoot?.destroy();
    this.safeRoot?.destroy();
  }

  private BuildHud() {
    this.hud = UIKit.layer("HUD", this.safeRoot);

    const top = UIKit.node("Top", this.hud.node);
    top.anchorMin = new V2(0, 1);
    top.anchorMax = new V2(1, 1);
    top.pivot = new V2(0.5, 1);
    top.anchoredPosition = V2.zero;
    top.sizeDelta = new V2(0, 200);
    const topCenter = new V2(0.5, 1);

    this.scoreText = UIKit.label(top, "0", 80, Palette.Text);
    this.scoreText.rectTransform.place(topCenter, new V2(0, -62), new V2(600, 100));
    UIKit.glow(this.scoreText, Palette.Comet.withAlpha(0.35));

    const bar = UIKit.img(top, "Energy", Art.UiRound, new Color(1, 1, 1, 0.08));
    bar.rectTransform.place(topCenter, new V2(0, -126), new V2(520, 24));
    this.energyImage = UIKit.img(bar.node, "Fill", Art.UiRound, Palette.Comet);
    this.energyFill = this.energyImage.rectTransform;
    this.energyFill.anchorMin = V2.zero;
    this.energyFill.anchorMax = V2.one;
    this.energyFill.pivot = new V2(0, 0.5);
    this.energyFill.offsetMin = new V2(3, 3);
    this.energyFill.offsetMax = new V2(-3, -3);

    this.bestText = UIKit.label(top, "", 26, Palette.TextDim);
    this.bestText.rectTransform.place(topCenter, new V2(0, -164), new V2(500, 36));

    this.comboRoot = UIKit.node("Combo", top).place(new V2(0, 1), new V2(95, -90), new V2(130, 130));
    UIKit.img(this.comboRoot, "Track", Art.UiRing, new Color(1, 1, 1, 0.12)).rectTransform.stretch();
    this.comboRing = UIKit.img(this.comboRoot, "Timer", Art.UiRing, Palette.CometHot);
    this.comboRing.rectTransform.stretch();
    this.comboRing.type = ImageType.Filled;
    this.comboRing.fillMethod = "Radial360";
    this.comboRing.fillOrigin = 2; // Top
    // fillClockwise = false: the kit fills clockwise, so mirror the (symmetric) ring
    this.comboRing.rectTransform.localScale = new V3(-1, 1, 1);
    this.comboText = UIKit.label(this.comboRoot, "x2", 48, Palette.CometHot);
    this.comboText.rectTransform.stretch();
    this.comboRoot.setActive(false);

    const pauseButton = UIKit.button(top, "", new V2(110, 110), false, () => this.PausePressed?.());
    pauseButton.node.place(new V2(1, 1), new V2(-85, -90), new V2(110, 110));
    for (let i = 0; i < 2; i++)
      UIKit.img(pauseButton.node, "Bar", Art.UiRound, Palette.Comet).rectTransform.place(Center, new V2(i === 0 ? -13 : 13, 0), new V2(16, 44));

    const hintRt = UIKit.node("Hint", this.hud.node).place(new V2(0.5, 0), new V2(0, 230), new V2(940, 120));
    this.hint = new CanvasGroup(hintRt);
    this.hint.alpha = 0;
    this.hint.blocksRaycasts = false;
    UIKit.img(hintRt, "Background", Art.UiRound, Palette.Panel.withAlpha(0.82)).rectTransform.stretch();
    UIKit.img(hintRt, "Edge", Art.UiOutline, Palette.Comet.withAlpha(0.5)).rectTransform.stretch();
    this.hintText = UIKit.wrap(UIKit.label(hintRt, "", 38, Palette.Text));
    this.hintText.rectTransform.stretch(28);

    const announceRt = UIKit.node("Announce", this.hud.node).place(Center, new V2(0, 260), new V2(1000, 160));
    this.announce = new CanvasGroup(announceRt);
    this.announce.alpha = 0;
    this.announce.blocksRaycasts = false;
    this.announceText = UIKit.label(announceRt, "", 84, Color.white);
    this.announceText.rectTransform.stretch();
    this.announceGlow = UIKit.glow(this.announceText, Palette.Comet, 4);
  }

  private BuildTitle() {
    this.title = UIKit.layer("Title", this.safeRoot);
    const c = UIKit.node("Center", this.title.node).place(Center, V2.zero, new V2(1000, 1000));

    UIKit.img(c, "LogoGlow", Art.Glow, Palette.Comet.withAlpha(0.16)).rectTransform.place(Center, new V2(0, 300), new V2(1150, 420));
    this.logo = UIKit.label(c, "LUMILOOP", 150, Color.white);
    this.logo.rectTransform.place(Center, new V2(0, 300), new V2(1000, 190));
    this.logoGlow = UIKit.glow(this.logo, Palette.Comet, 4);

    UIKit.label(c, "DRAW LOOPS  ·  CAPTURE LIGHT", 36, Palette.TextDim).rectTransform.place(Center, new V2(0, 195), new V2(1000, 50));

    this.titleBest = UIKit.label(c, "", 44, Palette.Mote);
    this.titleBest.rectTransform.place(Center, new V2(0, 110), new V2(800, 60));

    this.playButton = UIKit.button(c, "PLAY", new V2(500, 150), true, () => this.PlayPressed?.(), 66);
    this.playButton.node.place(Center, new V2(0, -50), new V2(500, 150));

    const how = UIKit.button(c, "HOW TO PLAY", new V2(340, 100), false, () => this.OpenModal(this.howTo), 34);
    how.node.place(Center, new V2(-185, -225), new V2(340, 100));
    const set = UIKit.button(c, "SETTINGS", new V2(340, 100), false, () => this.OpenModal(this.settings), 34);
    set.node.place(Center, new V2(185, -225), new V2(340, 100));

    this.titleStats = UIKit.label(c, "", 28, Palette.TextDim);
    this.titleStats.rectTransform.place(Center, new V2(0, -340), new V2(1000, 50));
    this.newsText = UIKit.wrap(UIKit.label(c, "", 30, Palette.CometHot));
    this.newsText.rectTransform.place(Center, new V2(0, 460), new V2(980, 60));
  }

  private BuildPause() {
    this.pause = UIKit.layer("Pause", this.safeRoot);
    UIKit.dim(this.pause.node, 0.7);
    const c = UIKit.node("Center", this.pause.node).place(Center, V2.zero, new V2(1000, 1000));

    const paused = UIKit.label(c, "PAUSED", 100, Palette.Text);
    UIKit.glow(paused, Palette.Comet.withAlpha(0.5), 4);
    paused.rectTransform.place(Center, new V2(0, 300), new V2(900, 140));

    this.resumeButton = LumiUI.MakeButton(c, "RESUME", new V2(480, 140), new V2(0, 110), true, () => this.ResumePressed?.(), 56);
    LumiUI.MakeButton(c, "RESTART", new V2(480, 110), new V2(0, -40), false, () => this.RestartPressed?.(), 40);
    LumiUI.MakeButton(c, "MENU", new V2(480, 110), new V2(0, -175), false, () => this.MenuPressed?.(), 40);
    this.pauseSound = LumiUI.MakeButton(c, "SOUND", new V2(235, 90), new V2(-123, -320), false, () => this.ToggleSound(), 28);
    this.pauseMusic = LumiUI.MakeButton(c, "MUSIC", new V2(235, 90), new V2(123, -320), false, () => this.ToggleMusic(), 28);
  }

  private BuildGameOver() {
    this.over = UIKit.layer("GameOver", this.safeRoot);
    UIKit.dim(this.over.node, 0.6);
    const c = UIKit.node("Center", this.over.node).place(Center, V2.zero, new V2(1000, 1000));

    UIKit.label(c, "YOUR LIGHT FADED", 46, Palette.TextDim).rectTransform.place(Center, new V2(0, 420), new V2(1000, 60));

    this.overScore = UIKit.label(c, "0", 150, Color.white);
    this.overScore.rectTransform.place(Center, new V2(0, 300), new V2(1000, 180));
    UIKit.glow(this.overScore, Palette.Comet.withAlpha(0.5), 4);

    this.overBest = UIKit.label(c, "", 38, Palette.TextDim);
    this.overBest.rectTransform.place(Center, new V2(0, 185), new V2(800, 60));

    this.newBestBadge = UIKit.node("NewBest", c).place(Center, new V2(0, 185), new V2(360, 72));
    UIKit.img(this.newBestBadge, "Glow", Art.Glow, Palette.Mote.withAlpha(0.4)).rectTransform.stretch(-80);
    UIKit.img(this.newBestBadge, "Background", Art.UiRound, Palette.Mote).rectTransform.stretch();
    UIKit.label(this.newBestBadge, "NEW BEST!", 40, Palette.BgBottom).rectTransform.stretch();
    this.newBestBadge.setActive(false);

    const captions = ["TIME", "LOOPS", "BIGGEST LOOP", "BEST COMBO"];
    const cells = [new V2(-220, 55), new V2(220, 55), new V2(-220, -75), new V2(220, -75)];
    for (let i = 0; i < 4; i++) {
      const cell = UIKit.node("Stat", c).place(Center, cells[i], new V2(400, 115));
      UIKit.img(cell, "Background", Art.UiRound, Palette.Panel.withAlpha(0.7)).rectTransform.stretch();
      UIKit.img(cell, "Edge", Art.UiOutline, Palette.Comet.withAlpha(0.2)).rectTransform.stretch();
      this.statValues[i] = UIKit.label(cell, "0", 50, Palette.Text);
      this.statValues[i].rectTransform.place(Center, new V2(0, 14), new V2(380, 60));
      UIKit.label(cell, captions[i], 24, Palette.TextDim).rectTransform.place(Center, new V2(0, -34), new V2(380, 30));
    }

    this.overTip = UIKit.wrap(UIKit.label(c, "", 30, Palette.TextDim, TextAnchor.MiddleCenter, FontStyle.Normal));
    this.overTip.rectTransform.place(Center, new V2(0, -185), new V2(900, 80));

    this.reviveButton = LumiUI.MakeButton(c, "REVIVE: WATCH AN AD", new V2(600, 90), new V2(0, -190), false, () => this.ClaimRevive(), 32);
    this.reviveButton.setAccent(Palette.CometHot);
    this.reviveButton.node.setActive(false);
    this.retryButton = LumiUI.MakeButton(c, "PLAY AGAIN", new V2(520, 140), new V2(0, -310), true, () => this.RestartPressed?.(), 56);
    LumiUI.MakeButton(c, "MENU", new V2(300, 96), new V2(0, -440), false, () => this.MenuPressed?.(), 36);
  }

  private BuildHowTo() {
    this.howTo = UIKit.layer("HowTo", this.safeRoot);
    UIKit.dim(this.howTo.node, 0.75);
    const card = UIKit.card(this.howTo.node, new V2(900, 960), Palette.Comet);

    UIKit.label(card, "HOW TO PLAY", 56, Palette.Text).rectTransform.place(Center, new V2(0, 400), new V2(800, 80));

    const rows: [Sprite, Color, string][] = [
      [Art.Disc, Palette.Comet, "Your comet never stops. Steer by dragging, with the mouse, or WASD."],
      [Art.Ring, Palette.Comet, "Cross your own trail to close a LOOP."],
      [Art.Disc, Palette.Mote, "Loop golden SPARKS to refuel. Your light is always fading."],
      [Art.Dart, Palette.Hunter, "HUNTERS drain your light on touch. Loop them instead!"],
      [Art.Shuriken, Palette.Cutter, "CUTTERS slice your trail. Loop them for big points."],
      [Art.Gem, Palette.Prism, "Loop a PRISM to unleash a NOVA that clears hunters."],
      [Art.Glow, Palette.CometHot, "Loop fast to chain COMBOS: more points and a longer trail."],
    ];
    for (let i = 0; i < rows.length; i++) {
      const y = 290 - i * 97;
      const s = rows[i][0] === Art.Glow ? 96 : 60;
      UIKit.img(card, "Icon", rows[i][0], rows[i][1]).rectTransform.place(Center, new V2(-370, y), new V2(s, s));
      UIKit.wrap(UIKit.label(card, rows[i][2], 31, Palette.Text, TextAnchor.MiddleLeft, FontStyle.Normal))
        .rectTransform.place(Center, new V2(40, y), new V2(740, 90));
    }

    LumiUI.MakeButton(card, "GOT IT", new V2(360, 110), new V2(0, -395), true, () => this.CloseModal(), 44);
  }

  private BuildSettings() {
    this.settings = UIKit.layer("Settings", this.safeRoot);
    UIKit.dim(this.settings.node, 0.75);
    const card = UIKit.card(this.settings.node, new V2(760, 780), Palette.Comet);

    UIKit.label(card, "SETTINGS", 56, Palette.Text).rectTransform.place(Center, new V2(0, 300), new V2(700, 80));
    this.soundToggle = this.SettingRow(card, "SOUND", 200, () => this.ToggleSound())[0];
    this.musicToggle = this.SettingRow(card, "MUSIC", 105, () => this.ToggleMusic())[0];
    this.hapticsToggle = this.SettingRow(card, "VIBRATION", 10, () => { Save.Haptics = !Save.Haptics; this.RefreshToggles(); })[0];
    [this.notifyToggle, this.notifyLabel] = this.SettingRow(card, "REMINDERS", -85, () => { Notifications.Enabled = !Notifications.Enabled; this.RefreshToggles(); });
    this.tutorialButton = LumiUI.MakeButton(card, "REPLAY TUTORIAL", new V2(520, 86), new V2(0, -195), false, () => {
      Save.TutorialDone = false;
      this.RefreshToggles();
    }, 32);
    LumiUI.MakeButton(card, "CLOSE", new V2(360, 96), new V2(0, -310), true, () => this.CloseModal(), 44);
  }

  private SettingRow(card: UINode, label: string, y: number, toggle: () => void): [ArcadeButton, Text] {
    const t = UIKit.label(card, label, 40, Palette.Text, TextAnchor.MiddleLeft);
    t.rectTransform.place(Center, new V2(-110, y), new V2(420, 80));
    return [LumiUI.MakeButton(card, "ON", new V2(200, 86), new V2(230, y), false, toggle, 36), t];
  }

  private static MakeButton(parent: UINode, label: string, size: V2, position: V2, primary: boolean, onClick: () => void, fontSize: number) {
    const b = UIKit.button(parent, label, size, primary, onClick, fontSize);
    b.node.place(Center, position, size);
    return b;
  }

  private BuildJoystick() {
    const rt = UIKit.node("Joystick", this.fxRoot).stretch();
    this.joystick = new CanvasGroup(rt);
    this.joystick.alpha = 0;
    this.joystick.blocksRaycasts = false;
    this.joyBase = UIKit.img(rt, "Base", Art.UiRing, Palette.Comet.withAlpha(0.35)).rectTransform.place(Center, V2.zero, new V2(200, 200));
    this.joyKnob = UIKit.img(rt, "Knob", Art.UiCircle, Palette.Comet.withAlpha(0.3)).rectTransform.place(Center, V2.zero, new V2(90, 90));
  }

  private BuildFloaters() {
    for (let i = 0; i < 24; i++) {
      const t = UIKit.label(this.fxRoot, "", 52, Color.white);
      t.rectTransform.place(Center, V2.zero, new V2(600, 80));
      const f: Floater = { Text: t, Outline: UIKit.glow(t, Color.black, 3), Age: 0, Life: 0, Scale: 1, Start: V2.zero };
      t.gameObject.setActive(false);
      this.floaters.push(f);
    }
  }

  // ------------------------------------------------------------------ screens

  ShowTitle(best: number, games: number, loops: number) {
    this.CloseModal();
    this.Show(this.hud, false);
    this.Show(this.pause, false);
    this.Show(this.over, false);
    this.Show(this.title, true);
    this.titleBest.text = best > 0 ? "BEST  " + Fmt.n(best) : "";
    this.titleStats.text = games > 0 ? `${Fmt.n(games)} RUNS  ·  ${Fmt.n(loops)} LOOPS CLOSED` : "AN ARCADE GAME OF LOOPS AND LIGHT";
    this.Hint(null);
    this.Joystick(false, V2.zero, V2.zero);
    this.ClearFloaters();
  }

  ShowHud() {
    this.CloseModal();
    this.Show(this.title, false);
    this.Show(this.over, false);
    this.Show(this.pause, false);
    this.Show(this.hud, true);
    this.shownScore = 0;
    this.shownScoreInt = -1;
    this.shownBest = -1;
    this.shownEnergy = 1;
    this.lastCombo = 0;
    this.comboRoot.setActive(false);
    this.announce.alpha = 0;
    this.ClearFloaters();
  }

  ShowPause(on: boolean) {
    if (on) this.RefreshToggles();
    this.Show(this.pause, on);
    if (on) this.Joystick(false, V2.zero, V2.zero);
  }

  /** `revive`: optional rewarded continue; offered only once an ad is ready. */
  ShowGameOver(result: RunResult, revive: (() => void) | null = null) {
    this.pendingRevive = revive;
    this.Show(this.pause, false);
    this.Show(this.hud, false);
    this.Show(this.over, true);
    this.Joystick(false, V2.zero, V2.zero);
    this.Hint(null);
    if (this.overRoutine) this.stopCoroutine(this.overRoutine);
    this.overRoutine = this.startCoroutine(this.GameOverRoutine(result));
  }

  private *GameOverRoutine(r: RunResult) {
    this.overScore.text = "0";
    this.newBestBadge.setActive(false);
    this.overBest.gameObject.setActive(true);
    this.overBest.text = "BEST  " + Fmt.n(r.Best);
    this.statValues[0].text = Fmt.clock(r.Seconds);
    this.statValues[1].text = Fmt.n(r.Loops);
    this.statValues[2].text = String(r.BiggestLoop);
    this.statValues[3].text = "x" + r.BestCombo;
    this.overTip.text = "TIP: " + Tips[Random.rangeInt(0, Tips.length)];

    yield waitReal(0.25);

    const duration = Mathf.clamp(0.4 + r.Score / 4000, 0.5, 1.4);
    let t = 0, tick = 0;
    while (t < duration) {
      const dt = Time.unscaledDeltaTime;
      t += dt;
      tick -= dt;
      const v = Mathf.roundToInt(Mathf.lerp(0, r.Score, Ease.outCubic(Mathf.clamp01(t / duration))));
      this.overScore.text = Fmt.n(v);
      if (tick <= 0 && r.Score > 0) {
        Synth.Play(Cue.Tick, 0.5, 1 + t / duration);
        tick = 0.05;
      }
      yield;
    }
    this.overScore.text = Fmt.n(r.Score);

    if (r.NewBest && r.Score > 0) {
      this.overBest.gameObject.setActive(false);
      this.newBestBadge.setActive(true);
      Synth.Play(Cue.NewBest);
      t = 0;
      while (t < 0.35) {
        t += Time.unscaledDeltaTime;
        const s = Ease.outBack(Mathf.clamp01(t / 0.35));
        this.newBestBadge.localScale = new V3(s, s, 1);
        yield;
      }
    }
    this.overRoutine = null;
  }

  private OpenModal(g: CanvasGroup) {
    if (this.modal && this.modal !== g) this.Show(this.modal, false);
    this.modal = g;
    this.RefreshToggles();
    this.Show(g, true);
  }

  /** Closes the how-to or settings panel. Returns false when none was open. */
  CloseModal() {
    if (!this.modal) return false;
    this.Show(this.modal, false);
    this.modal = null;
    Save.Flush();
    return true;
  }

  private ToggleSound() {
    Save.Sound = !Save.Sound;
    this.RefreshToggles();
  }

  private ToggleMusic() {
    Save.Music = !Save.Music;
    this.RefreshToggles();
  }

  private RefreshToggles() {
    LumiUI.SetToggle(this.soundToggle, Save.Sound, "ON", "OFF");
    LumiUI.SetToggle(this.musicToggle, Save.Music, "ON", "OFF");
    LumiUI.SetToggle(this.hapticsToggle, Save.Haptics, "ON", "OFF");
    LumiUI.SetToggle(this.notifyToggle, Notifications.Enabled, "ON", "OFF");
    if (this.notifyToggle) {
      // hide the row where unsupported
      this.notifyToggle.node.setActive(Notifications.Supported);
      this.notifyLabel.gameObject.setActive(Notifications.Supported);
    }
    LumiUI.SetToggle(this.pauseSound, Save.Sound, "SOUND ON", "SOUND OFF");
    LumiUI.SetToggle(this.pauseMusic, Save.Music, "MUSIC ON", "MUSIC OFF");
    if (this.tutorialButton) {
      this.tutorialButton.label!.text = Save.TutorialDone ? "REPLAY TUTORIAL" : "TUTORIAL: NEXT RUN";
      this.tutorialButton.setAccent(Save.TutorialDone ? Palette.Comet : Palette.Mote);
    }
    Save.Flush();
  }

  private static SetToggle(b: ArcadeButton | undefined, on: boolean, onText: string, offText: string) {
    if (!b) return;
    b.label!.text = on ? onText : offText;
    b.setAccent(on ? Palette.Comet : Palette.TextDim);
  }

  // ------------------------------------------------------------------ HUD

  UpdateHud(score: number, best: number, energy01: number, combo: number, combo01: number, lowEnergy: boolean) {
    const dt = Time.unscaledDeltaTime;

    this.shownScore = Mathf.moveTowards(this.shownScore, score, Math.max(1, (score - this.shownScore) * 10 * dt));
    const s = Mathf.roundToInt(this.shownScore);
    if (s !== this.shownScoreInt) {
      this.shownScoreInt = s;
      this.scoreText.text = Fmt.n(s);
    }
    const b = Math.max(best, score);
    if (b !== this.shownBest) {
      this.shownBest = b;
      this.bestText.text = "BEST  " + Fmt.n(b);
    }

    this.shownEnergy = Mathf.lerp(this.shownEnergy, Mathf.clamp01(energy01), 1 - Math.exp(-dt * 10));
    this.energyImage.enabled = this.shownEnergy > 0.015;
    this.energyFill.anchorMax = new V2(Math.max(0.015, this.shownEnergy), 1);
    let ec = Color.lerp(Palette.Danger, Palette.Comet, Mathf.clamp01((energy01 - 0.15) / 0.35));
    if (lowEnergy) ec = ec.withAlpha(0.55 + 0.45 * Math.abs(Math.sin(this.clock * 8)));
    this.energyImage.color = ec;

    if (combo >= 2) {
      if (!this.comboRoot.activeSelf) this.comboRoot.setActive(true);
      if (combo !== this.lastCombo) {
        this.comboText.text = "x" + combo;
        this.comboPop = 1;
      }
      this.comboRing.fillAmount = combo01;
      const cc = combo >= 6 ? Color.lerp(Palette.CometHot, Palette.Rainbow(this.clock * 0.8), 0.5) : Palette.CometHot;
      this.comboText.color = cc;
      this.comboRing.color = cc;
    } else if (this.comboRoot.activeSelf) {
      this.comboRoot.setActive(false);
    }
    this.lastCombo = combo;
  }

  /** A line of news on the title screen (remote announcements, push messages). */
  SetNews(text: string | null) { this.newsText.text = text ?? ""; }

  /** Shows a message in the hint bar for a few seconds. */
  Toast(text: string, seconds = 5) {
    if (this.toastRoutine) this.stopCoroutine(this.toastRoutine);
    this.Hint(text);
    this.toastRoutine = this.startCoroutine(this.ClearToast(text, seconds));
  }

  private *ClearToast(text: string, seconds: number) {
    yield waitReal(seconds);
    if (this.hintText.text === text) this.Hint(null);
    this.toastRoutine = null;
  }

  Hint(text: string | null) {
    if (!text) {
      this.hintTarget = 0;
      return;
    }
    this.hintText.text = text;
    this.hintTarget = 1;
    this.hintPop = 1;
  }

  Announce(text: string, color: Color) {
    if (this.announceRoutine) this.stopCoroutine(this.announceRoutine);
    this.announceRoutine = this.startCoroutine(this.AnnounceRoutine(text, color));
  }

  private *AnnounceRoutine(text: string, color: Color) {
    this.announceText.text = text;
    this.announceText.color = Color.lerp(color, Color.white, 0.3);
    this.announceGlow.effectColor = color.withAlpha(0.6);
    const rt = this.announce.node;
    let t = 0;
    while (t < 1.6) {
      t += Time.unscaledDeltaTime;
      const a = t < 0.15 ? t / 0.15 : t > 1.2 ? 1 - (t - 1.2) / 0.4 : 1;
      this.announce.alpha = Mathf.clamp01(a);
      const s = Mathf.lerp(1.6, 1, Ease.outBack(Mathf.clamp01(t / 0.35)));
      rt.localScale = new V3(s, s, 1);
      yield;
    }
    this.announce.alpha = 0;
    this.announceRoutine = null;
  }

  FloatText(world: V2, text: string, color: Color, scale = 1) {
    let f: Floater | null = null;
    for (const x of this.floaters) {
      if (!x.Text.gameObject.activeSelf) { f = x; break; }
      if (!f || x.Age > f.Age) f = x; // recycle the oldest when all are busy
    }
    if (!f) return;

    const sp = Camera.worldToScreen(world);
    let local = this.fxRoot.screenToLocal(new V2(sp.x, Screen.height - sp.y));
    const size = this.fxRoot.rect.size;
    const half = new V2(size.x * 0.5 - 220, size.y * 0.5 - 80);
    local = new V2(Mathf.clamp(local.x, -half.x, half.x), Mathf.clamp(local.y, -half.y, half.y));

    f.Start = local;
    f.Age = 0;
    f.Life = 0.9;
    f.Scale = scale;
    f.Text.text = text;
    f.Text.color = color;
    f.Outline.effectColor = new Color(color.r * 0.3, color.g * 0.3, color.b * 0.3, 0.8);
    f.Text.gameObject.setActive(true);
    f.Text.rectTransform.setAsLastSibling();
    LumiUI.AnimateFloater(f);
  }

  private ClearFloaters() {
    for (const f of this.floaters) f.Text.gameObject.setActive(false);
  }

  Joystick(active: boolean, originScreen: V2, currentScreen: V2) {
    this.joyTarget = active ? 1 : 0;
    if (!active) return;
    const o = this.fxRoot.screenToLocal(originScreen);
    const c = this.fxRoot.screenToLocal(currentScreen);
    const d = V2.clampMagnitude(c.sub(o), 70);
    this.joyBase.anchoredPosition = o;
    this.joyKnob.anchoredPosition = o.add(d);
  }

  // ------------------------------------------------------------------ per-frame

  update() {
    const dt = Time.unscaledDeltaTime;
    this.clock += dt;
    this.ApplyLayout(false);

    for (const f of this.floaters) {
      if (!f.Text.gameObject.activeSelf) continue;
      f.Age += dt;
      if (f.Age >= f.Life) f.Text.gameObject.setActive(false);
      else LumiUI.AnimateFloater(f);
    }

    this.joystick.alpha = Mathf.moveTowards(this.joystick.alpha, this.joyTarget, dt * 8);

    this.hint.alpha = Mathf.moveTowards(this.hint.alpha, this.hintTarget, dt * 4);
    this.hintPop = Mathf.moveTowards(this.hintPop, 0, dt * 3);
    const hs = 1 + 0.08 * Ease.outCubic(this.hintPop);
    this.hint.node.localScale = new V3(hs, hs, 1);

    this.comboPop = Mathf.moveTowards(this.comboPop, 0, dt * 4);
    const cs = 1 + 0.35 * this.comboPop * this.comboPop;
    this.comboRoot.localScale = new V3(cs, cs, 1);

    if (this.title.node.activeSelf) {
      this.logoGlow.effectColor = Color.lerp(Palette.Comet, Palette.Rainbow(this.clock * 0.08), 0.5).withAlpha(0.75);
      const ls = 1 + 0.02 * Math.sin(this.clock * 2);
      this.logo.rectTransform.localScale = new V3(ls, ls, 1);
    }

    if (this.newBestBadge.activeSelf && !this.overRoutine) {
      const bs = 1 + 0.05 * Math.sin(this.clock * 6);
      this.newBestBadge.localScale = new V3(bs, bs, 1);
    }

    const offer = this.pendingRevive !== null && LumiUI.IsShown(this.over) && AdService.rewardedAvailable;
    if (this.reviveButton.node.activeSelf !== offer) {
      this.reviveButton.node.setActive(offer);
      this.overTip.gameObject.setActive(!offer); // the offer takes the tip's place
    }

    this.HandleConfirmKey();
  }

  private ClaimRevive() {
    if (!this.pendingRevive || AdService.isShowing) return;
    AdService.showRewarded((earned) => {
      if (!earned) return;
      const revive = this.pendingRevive;
      this.pendingRevive = null;
      revive?.();
    });
  }

  private HandleConfirmKey() {
    if (AdService.isShowing) return;
    let confirm = Keyboard.enter.wasPressedThisFrame || Keyboard.numpadEnter.wasPressedThisFrame || Keyboard.space.wasPressedThisFrame;
    if (Gamepad.connected && Gamepad.buttonSouth.wasPressedThisFrame) confirm = true;
    if (!confirm) return;

    if (this.modal) this.CloseModal();
    else if (LumiUI.IsShown(this.title)) this.playButton.press();
    else if (LumiUI.IsShown(this.over)) this.retryButton.press();
    else if (LumiUI.IsShown(this.pause)) this.resumeButton.press();
  }

  private static AnimateFloater(f: Floater) {
    const k = Mathf.clamp01(f.Age / f.Life);
    f.Text.rectTransform.anchoredPosition = f.Start.add(new V2(0, 120 * Ease.outCubic(k)));
    const pop = k < 0.15 ? Mathf.lerp(0.4, 1.25, k / 0.15) : Mathf.lerp(1.25, 1, Mathf.clamp01((k - 0.15) / 0.2));
    const s = pop * f.Scale;
    f.Text.rectTransform.localScale = new V3(s, s, 1);
    f.Text.color = f.Text.color.withAlpha(k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
  }

  /** CanvasScaler (1080 units on the short side) is the kit host's; this keeps the safe-area root in step. */
  private ApplyLayout(force: boolean) {
    const safe = Screen.safeArea;
    const key = `${Screen.width}x${Screen.height}:${safe.x},${safe.y},${safe.width},${safe.height}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;

    const w = Math.max(1, Screen.width), h = Math.max(1, Screen.height);
    this.safeRoot.anchorMin = new V2(safe.xMin / w, safe.yMin / h);
    this.safeRoot.anchorMax = new V2(safe.xMax / w, safe.yMax / h);
    this.safeRoot.offsetMin = V2.zero;
    this.safeRoot.offsetMax = V2.zero;
  }

  // ------------------------------------------------------------------ transitions

  private Show(g: CanvasGroup, on: boolean, duration = 0.22) {
    const running = this.fades.get(g);
    if (running) this.stopCoroutine(running);
    this.fades.set(g, null);
    if (on) {
      g.node.setActive(true);
      g.blocksRaycasts = true;
      g.interactable = true;
    } else {
      g.blocksRaycasts = false; // stop double clicks while fading out
      g.interactable = false;
      if (!g.node.activeSelf) return;
    }
    this.fades.set(g, this.startCoroutine(this.Fade(g, on, duration)));
  }

  private *Fade(g: CanvasGroup, on: boolean, duration: number) {
    const from = g.alpha, to = on ? 1 : 0;
    const rt = g.node;
    let t = 0;
    while (t < duration) {
      t += Time.unscaledDeltaTime;
      const k = Ease.outCubic(Mathf.clamp01(t / duration));
      g.alpha = Mathf.lerp(from, to, k);
      const s = on ? Mathf.lerp(0.96, 1, k) : Mathf.lerp(1, 0.98, k);
      rt.localScale = new V3(s, s, 1);
      yield;
    }
    g.alpha = to;
    rt.localScale = V3.one;
    if (!on) g.node.setActive(false);
    this.fades.set(g, null);
  }

  private static IsShown(g: CanvasGroup) { return g.node.activeSelf && g.interactable; }
}
