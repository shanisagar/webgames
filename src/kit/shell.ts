import { AdService } from "./ads";
import { GameNav } from "./nav";
import { Art } from "./art";
import { Fx } from "./fx";
import { Color, Ease, Fmt, Mathf, Pal, Random, V2, V3 } from "./math";
import { Settings } from "./prefs";
import { Camera, Sprite } from "./render";
import { Behaviour, Coroutine, Time, waitReal } from "./scene";
import { MusicStyle, DefaultMusic, Sfx, Snd } from "./sfx";
import { CanvasGroup, FontStyle, Image, Outline, Text, TextAnchor, UI, UIKit, UINode, ArcadeButton } from "./ui";
import { Screen, TouchScheme } from "./input";

export interface HowToRow { icon: Sprite | null; color: Color; text: string }
export const howTo = (icon: Sprite | null, color: Color, text: string): HowToRow => ({ icon, color, text });

/** Everything the shared framework needs to know about a game (GameInfo). */
export class GameInfo {
  Id = "game";
  Title = "GAME";
  Tagline = "";
  PlayLabel = "PLAY";
  Accent = Pal.Cyan;
  Accent2 = Pal.Magenta;
  BgTop = Pal.hex(0x140a2e);
  BgBottom = Pal.Dark;
  GridSpacing = 1;
  /** World units visible along the screen's short side. */
  ShortSide = 18;
  HowTo: HowToRow[] = [];
  Tips: string[] = [];
  Music: MusicStyle = DefaultMusic;
  Touch = TouchScheme.None;
  PauseButton = true;
  /** Home button left of pause instead of under it (for games with a minimap or leaderboard under pause). */
  HomeBesidePause = false;
  Reminders: string[] = [];
  constructor(init?: Partial<GameInfo>) { if (init) Object.assign(this, init); }
}

export class Result {
  Headline = "GAME OVER";
  HeadlineColor = Pal.TextDim;
  Value = "0";
  /** If >= 0 the value counts up from zero to this number. */
  CountTo = -1;
  NewBest = false;
  BestLine = "";
  Stats: [string, string][] = [];
  Primary = "PLAY AGAIN";
  Victory = false;
  /** Optional opt-in rewarded ad offer (revive, reboot...). Shown only when an ad is ready. */
  Reward: (() => void) | null = null;
  RewardLabel = "CONTINUE (WATCH AD)";
  /** 0..3 earned stars shown instead of Value (puzzle levels); -1 = no stars. */
  Stars = -1;
  constructor(init?: Partial<Result>) { if (init) Object.assign(this, init); }
}

export interface Choice { title: string; body: string; color: Color; icon: Sprite | null }

interface Floater { text: Text; outline: Outline; age: number; life: number; scale: number; start: V2 }

const C = new V2(0.5, 0.5);

/**
 * Shared screens for every game, built from code: title, HUD shell (pause button, hint bar, announcer, floating text,
 * virtual sticks), pause, results, how-to-play, settings and a 3-card choice picker. Adapts to portrait/landscape
 * (short side = 1080 canvas units) and the device safe area (Shell.cs).
 */
export class Shell extends Behaviour {
  PlayPressed: (() => void) | null = null;
  PausePressed: (() => void) | null = null;
  ResumePressed: (() => void) | null = null;
  RestartPressed: (() => void) | null = null;
  MenuPressed: (() => void) | null = null;

  private info!: GameInfo;
  private safeRoot!: UINode;
  private fxRoot!: UINode;
  private title!: CanvasGroup;
  private hud!: CanvasGroup;
  private pause!: CanvasGroup;
  private over!: CanvasGroup;
  private howToL!: CanvasGroup;
  private settings!: CanvasGroup;
  private choices!: CanvasGroup;
  private modal: CanvasGroup | null = null;
  private fades = new Map<CanvasGroup, Coroutine | null>();
  private clock = 0;
  private lastSafe = "";

  /** Root for game-specific HUD widgets (inside the safe area). */
  Hud!: UINode;
  /** Free area on the title screen below the main buttons for game-specific options. */
  TitleExtra!: UINode;
  get ModalOpen() { return this.modal !== null; }
  get ChoiceOpen() { return this.choices.node.activeSelf && this.choices.interactable; }

  private logo!: Text;
  private titleBest!: Text;
  private titleStats!: Text;
  private hintText!: Text;
  private announceText!: Text;
  private newsText!: Text;
  private toastRoutine: Coroutine | null = null;
  private logoGlow!: Outline;
  private announceGlow!: Outline;
  private hint!: CanvasGroup;
  private announce!: CanvasGroup;
  private announceRoutine: Coroutine | null = null;
  private hintTarget = 0;
  private hintPop = 0;
  private playButton!: ArcadeButton;
  private resumeButton!: ArcadeButton;
  private retryButton!: ArcadeButton;
  private pauseButton!: ArcadeButton;
  private homeButton: ArcadeButton | null = null;
  private soundToggle!: ArcadeButton;
  private musicToggle!: ArcadeButton;
  private hapticsToggle!: ArcadeButton;
  private pauseSound!: ArcadeButton;
  private pauseMusic!: ArcadeButton;
  private rewardButton!: ArcadeButton;
  private pendingReward: (() => void) | null = null;
  private overHeadline!: Text;
  private overValue!: Text;
  private overBest!: Text;
  private statValues: Text[] = [];
  private statCaptions: Text[] = [];
  private statCells: UINode[] = [];
  private newBestBadge!: UINode;
  private stars: Image[] = [];
  private overRoutine: Coroutine | null = null;
  private choiceTitle!: Text;
  private choiceCards: { button: ArcadeButton; icon: Image; title: Text; body: Text }[] = [];
  private onChoice: ((i: number) => void) | null = null;
  private sticks: CanvasGroup[] = [];
  private stickBase: UINode[] = [];
  private stickKnob: UINode[] = [];
  private stickTarget = [0, 0];
  private floaters: Floater[] = [];

  // ------------------------------------------------------------------ construction

  init(info: GameInfo) {
    this.info = info;
    const root = UI.root!;
    this.fxRoot = UIKit.node("Fx", root).stretch();
    this.safeRoot = UIKit.node("Safe", root).stretch();
    this.buildSticks();
    this.buildFloaters();
    this.buildHud();
    this.buildTitle();
    this.buildPause();
    this.buildResult();
    this.buildHowTo();
    if (GameNav.home) document.body.classList.add("na-has-nav");
    this.buildSettings();
    this.buildChoices();
    this.applyLayout(true);
    this.refreshToggles();
  }

  private buildHud() {
    const info = this.info;
    this.hud = UIKit.layer("HUD", this.safeRoot);
    this.Hud = UIKit.node("Game HUD", this.hud.node).stretch();
    this.pauseButton = UIKit.buttonAt(this.Hud, "", new V2(1, 1), new V2(-85, -85), new V2(110, 110), false, () => this.PausePressed?.());
    for (let i = 0; i < 2; i++) UIKit.img(this.pauseButton.node, "Bar", Art.UiRound, info.Accent).rectTransform.place(C, new V2(i === 0 ? -13 : 13, 0), new V2(16, 44));
    this.pauseButton.setAccent(info.Accent);
    this.pauseButton.node.setActive(info.PauseButton);
    // One tap back to the game list, stacked under pause: games keep their top bars clear of the right-hand column.
    if (GameNav.home) {
      const home = GameNav.home;
      const pos = !info.PauseButton ? new V2(-85, -85) : info.HomeBesidePause ? new V2(-210, -85) : new V2(-85, -210);
      this.homeButton = this.homeIcon(this.Hud, new V2(1, 1), pos, home);
    }

    const hintRt = UIKit.node("Hint", this.hud.node).place(new V2(0.5, 0), new V2(0, 330), new V2(660, 150));
    this.hint = new CanvasGroup(hintRt);
    this.hint.alpha = 0;
    this.hint.blocksRaycasts = false;
    UIKit.img(hintRt, "Background", Art.UiRound, Pal.Panel.withAlpha(0.85)).rectTransform.stretch();
    UIKit.img(hintRt, "Edge", Art.UiOutline, info.Accent.withAlpha(0.5)).rectTransform.stretch();
    this.hintText = UIKit.wrap(UIKit.label(hintRt, "", 32, Pal.Text));
    this.hintText.rectTransform.stretch(26);

    const an = UIKit.node("Announce", this.hud.node).place(C, new V2(0, 220), new V2(1000, 160));
    this.announce = new CanvasGroup(an);
    this.announce.alpha = 0;
    this.announce.blocksRaycasts = false;
    this.announceText = UIKit.label(an, "", 80, Color.white);
    this.announceText.rectTransform.stretch();
    this.announceGlow = UIKit.glow(this.announceText, info.Accent, 4);
  }

  private buildTitle() {
    const info = this.info;
    this.title = UIKit.layer("Title", this.safeRoot);
    const c = UIKit.node("Center", this.title.node).place(C, V2.zero, new V2(1000, 1000));
    UIKit.img(c, "LogoGlow", Art.Glow, info.Accent.withAlpha(0.16)).rectTransform.place(C, new V2(0, 330), new V2(1150, 420));
    const size = info.Title.length > 10 ? 118 : 140;
    this.logo = UIKit.at(UIKit.label(c, info.Title, size, Color.white), C, new V2(0, 330), new V2(1100, 190));
    this.logo.span.classList.add("na-logo");
    this.logoGlow = UIKit.glow(this.logo, info.Accent, 4);
    UIKit.at(UIKit.label(c, info.Tagline, 34, Pal.TextDim), C, new V2(0, 225), new V2(1000, 50));
    this.titleBest = UIKit.at(UIKit.label(c, "", 42, info.Accent2), C, new V2(0, 140), new V2(900, 60));
    this.playButton = UIKit.buttonAt(c, info.PlayLabel, C, new V2(0, -20), new V2(500, 150), true, () => this.PlayPressed?.(), 62);
    this.playButton.setAccent(info.Accent);
    UIKit.buttonAt(c, "HOW TO PLAY", C, new V2(-185, -195), new V2(340, 100), false, () => this.openModal(this.howToL), 34).setAccent(info.Accent);
    UIKit.buttonAt(c, "SETTINGS", C, new V2(185, -195), new V2(340, 100), false, () => this.openModal(this.settings), 34).setAccent(info.Accent);
    this.TitleExtra = UIKit.node("Extra", c).place(C, new V2(0, -315), new V2(1000, 110));
    this.titleStats = UIKit.at(UIKit.label(c, "", 28, Pal.TextDim), C, new V2(0, -425), new V2(1000, 50));
    if (GameNav.home) {
      const home = GameNav.home;
      this.homeIcon(this.title.node, new V2(0, 1), new V2(85, -85), home);
    }
    this.newsText = UIKit.at(UIKit.wrap(UIKit.label(c, "", 30, Pal.Warn)), C, new V2(0, 475), new V2(980, 60));
  }

  private buildPause() {
    const info = this.info;
    this.pause = UIKit.layer("Pause", this.safeRoot);
    UIKit.dim(this.pause.node, 0.7);
    const c = UIKit.node("Center", this.pause.node).place(C, V2.zero, new V2(1000, 1000));
    UIKit.glow(UIKit.at(UIKit.label(c, "PAUSED", 100, Pal.Text), C, new V2(0, 300), new V2(900, 140)), info.Accent.withAlpha(0.5), 4);
    this.resumeButton = UIKit.buttonAt(c, "RESUME", C, new V2(0, 110), new V2(480, 140), true, () => this.ResumePressed?.(), 56);
    this.resumeButton.setAccent(info.Accent);
    UIKit.buttonAt(c, "RESTART", C, new V2(0, -40), new V2(480, 110), false, () => this.RestartPressed?.(), 40).setAccent(info.Accent);
    UIKit.buttonAt(c, "MENU", C, new V2(0, -175), new V2(480, 110), false, () => this.MenuPressed?.(), 40).setAccent(info.Accent);
    this.pauseSound = UIKit.buttonAt(c, "SOUND", C, new V2(-123, -320), new V2(235, 90), false, () => this.toggleSound(), 28);
    this.pauseMusic = UIKit.buttonAt(c, "MUSIC", C, new V2(123, -320), new V2(235, 90), false, () => this.toggleMusic(), 28);
    if (GameNav.home) {
      const home = GameNav.home;
      UIKit.buttonAt(c, "ALL GAMES", C, new V2(0, -440), new V2(480, 90), false, () => home(), 32).setAccent(info.Accent);
    }
  }

  onDestroy() { document.body.classList.remove("na-has-nav"); }

  private buildResult() {
    const info = this.info;
    this.over = UIKit.layer("Result", this.safeRoot);
    UIKit.dim(this.over.node, 0.62);
    const c = UIKit.node("Center", this.over.node).place(C, V2.zero, new V2(1000, 1000));
    this.overHeadline = UIKit.at(UIKit.label(c, "", 64, Pal.TextDim), C, new V2(0, 420), new V2(1000, 80));
    UIKit.glow(this.overHeadline, Color.black.withAlpha(0.5), 3);
    this.overValue = UIKit.at(UIKit.label(c, "0", 140, Color.white), C, new V2(0, 295), new V2(1000, 170));
    UIKit.glow(this.overValue, info.Accent.withAlpha(0.5), 4);
    this.overBest = UIKit.at(UIKit.label(c, "", 36, Pal.TextDim), C, new V2(0, 185), new V2(900, 60));
    for (let i = 0; i < 3; i++) {
      const size = i === 1 ? 190 : 150;
      const s = UIKit.img(c, "Star", Art.Star, Color.white);
      s.rectTransform.place(C, new V2((i - 1) * 190, i === 1 ? 315 : 285), new V2(size, size));
      s.gameObject.setActive(false);
      this.stars.push(s);
    }
    this.newBestBadge = UIKit.node("NewBest", c).place(C, new V2(0, 185), new V2(360, 72));
    UIKit.img(this.newBestBadge, "Glow", Art.Glow, Pal.Warn.withAlpha(0.4)).rectTransform.stretch(-80);
    UIKit.img(this.newBestBadge, "Background", Art.UiRound, Pal.Warn).rectTransform.stretch();
    UIKit.label(this.newBestBadge, "NEW BEST!", 40, Pal.Dark).rectTransform.stretch();
    this.newBestBadge.setActive(false);
    const cells = [new V2(-220, 55), new V2(220, 55), new V2(-220, -75), new V2(220, -75)];
    for (let i = 0; i < 4; i++) {
      const cell = UIKit.node("Stat", c).place(C, cells[i], new V2(400, 115));
      UIKit.img(cell, "Background", Art.UiRound, Pal.Panel.withAlpha(0.7)).rectTransform.stretch();
      UIKit.img(cell, "Edge", Art.UiOutline, info.Accent.withAlpha(0.2)).rectTransform.stretch();
      this.statValues.push(UIKit.at(UIKit.label(cell, "", 48, Pal.Text), C, new V2(0, 14), new V2(380, 60)));
      this.statCaptions.push(UIKit.at(UIKit.label(cell, "", 24, Pal.TextDim), C, new V2(0, -34), new V2(380, 30)));
      this.statCells.push(cell);
    }
    this.rewardButton = UIKit.buttonAt(c, "CONTINUE", C, new V2(0, -200), new V2(600, 96), false, () => this.claimReward(), 34);
    this.rewardButton.setAccent(Pal.Warn);
    this.rewardButton.node.setActive(false);
    // Long offers ("+2 HOLDING SLOTS & CONTINUE (AD)") shrink to fit instead of spilling past the button.
    if (this.rewardButton.label) {
      this.rewardButton.label.resizeTextForBestFit = true;
      this.rewardButton.label.resizeTextMinSize = 20;
      this.rewardButton.label.resizeTextMaxSize = 34;
    }
    this.retryButton = UIKit.buttonAt(c, "PLAY AGAIN", C, new V2(0, -320), new V2(560, 130), true, () => this.RestartPressed?.(), 52);
    this.retryButton.setAccent(info.Accent);
    UIKit.buttonAt(c, "MENU", C, new V2(0, -450), new V2(300, 90), false, () => this.MenuPressed?.(), 36).setAccent(info.Accent);
  }

  private buildHowTo() {
    const info = this.info;
    this.howToL = UIKit.layer("HowTo", this.safeRoot);
    UIKit.dim(this.howToL.node, 0.75);
    const card = UIKit.card(this.howToL.node, new V2(900, 980), info.Accent);
    UIKit.at(UIKit.label(card, "HOW TO PLAY", 54, Pal.Text), C, new V2(0, 410), new V2(800, 80));
    const rows = Math.min(info.HowTo.length, 7);
    const step = rows > 0 ? Math.min(100, 640 / rows) : 100;
    for (let i = 0; i < rows; i++) {
      const y = 310 - i * step, row = info.HowTo[i];
      if (row.icon) UIKit.img(card, "Icon", row.icon, row.color).rectTransform.place(C, new V2(-370, y), new V2(60, 60));
      UIKit.at(UIKit.wrap(UIKit.label(card, row.text, 30, Pal.Text, TextAnchor.MiddleLeft, FontStyle.Normal)), C, new V2(40, y), new V2(740, step));
    }
    UIKit.buttonAt(card, "GOT IT", C, new V2(0, -405), new V2(360, 110), true, () => this.closeModal(), 44).setAccent(info.Accent);
  }

  private buildSettings() {
    const info = this.info;
    this.settings = UIKit.layer("Settings", this.safeRoot);
    UIKit.dim(this.settings.node, 0.75);
    const card = UIKit.card(this.settings.node, new V2(760, 680), info.Accent);
    UIKit.at(UIKit.label(card, "SETTINGS", 54, Pal.Text), C, new V2(0, 260), new V2(700, 80));
    this.soundToggle = this.settingRow(card, "SOUND", 150, () => this.toggleSound());
    this.musicToggle = this.settingRow(card, "MUSIC", 50, () => this.toggleMusic());
    this.hapticsToggle = this.settingRow(card, "VIBRATION", -50, () => { Settings.Haptics = !Settings.Haptics; this.refreshToggles(); });
    UIKit.buttonAt(card, "CLOSE", C, new V2(0, -230), new V2(360, 96), true, () => this.closeModal(), 44).setAccent(info.Accent);
  }

  private settingRow(card: UINode, label: string, y: number, toggle: () => void) {
    UIKit.at(UIKit.label(card, label, 40, Pal.Text, TextAnchor.MiddleLeft), C, new V2(-110, y), new V2(420, 80));
    return UIKit.buttonAt(card, "ON", C, new V2(230, y), new V2(200, 86), false, toggle, 36);
  }

  private buildChoices() {
    const info = this.info;
    this.choices = UIKit.layer("Choices", this.safeRoot);
    UIKit.dim(this.choices.node, 0.78);
    const c = UIKit.node("Center", this.choices.node).place(C, V2.zero, new V2(1000, 1000));
    this.choiceTitle = UIKit.at(UIKit.label(c, "", 56, Pal.Text), C, new V2(0, 380), new V2(1000, 80));
    UIKit.glow(this.choiceTitle, info.Accent.withAlpha(0.5), 3);
    for (let i = 0; i < 3; i++) {
      const index = i;
      const b = UIKit.buttonAt(c, "", C, new V2(0, 200 - i * 225), new V2(880, 200), false, () => this.pickChoice(index));
      const icon = UIKit.img(b.node, "Icon", Art.Disc, Color.white);
      icon.rectTransform.place(new V2(0, 0.5), new V2(95, 0), new V2(96, 96));
      const t = UIKit.at(UIKit.label(b.node, "", 44, Color.white, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(510, 38), new V2(660, 60));
      const body = UIKit.at(UIKit.wrap(UIKit.label(b.node, "", 28, Pal.TextDim, TextAnchor.UpperLeft, FontStyle.Normal)), new V2(0, 0.5), new V2(510, -30), new V2(660, 90));
      this.choiceCards.push({ button: b, icon, title: t, body });
    }
  }

  private buildSticks() {
    for (let i = 0; i < 2; i++) {
      const rt = UIKit.node("Stick" + i, this.fxRoot).stretch();
      const g = new CanvasGroup(rt);
      g.alpha = 0;
      g.blocksRaycasts = false;
      this.sticks.push(g);
      const col = i === 0 ? this.info.Accent : this.info.Accent2;
      this.stickBase.push(UIKit.img(rt, "Base", Art.UiRing, col.withAlpha(0.35)).rectTransform.place(C, V2.zero, new V2(200, 200)));
      this.stickKnob.push(UIKit.img(rt, "Knob", Art.UiCircle, col.withAlpha(0.3)).rectTransform.place(C, V2.zero, new V2(90, 90)));
    }
  }

  private buildFloaters() {
    for (let i = 0; i < 28; i++) {
      const t = UIKit.at(UIKit.label(this.fxRoot, "", 48, Color.white), C, V2.zero, new V2(600, 80));
      this.floaters.push({ text: t, outline: UIKit.glow(t, Color.black, 3), age: 0, life: 0, scale: 1, start: V2.zero });
      t.gameObject.setActive(false);
    }
  }

  // ------------------------------------------------------------------ screens

  ShowTitle(bestLine: string, statsLine: string) {
    this.closeModal();
    this.hideChoices();
    this.show(this.hud, false);
    this.show(this.pause, false);
    this.show(this.over, false);
    this.show(this.title, true);
    this.titleBest.text = bestLine ?? "";
    this.titleStats.text = statsLine ?? "";
    this.Hint(null);
    this.Stick(0, false, V2.zero, V2.zero);
    this.Stick(1, false, V2.zero, V2.zero);
    this.clearFloaters();
  }

  ShowHud() {
    this.closeModal();
    this.hideChoices();
    this.show(this.title, false);
    this.show(this.over, false);
    this.show(this.pause, false);
    this.show(this.hud, true);
    this.announce.alpha = 0;
    this.Hint(null);
    this.clearFloaters();
  }

  ShowPause(on: boolean) {
    if (on) { this.refreshToggles(); this.Stick(0, false, V2.zero, V2.zero); this.Stick(1, false, V2.zero, V2.zero); }
    this.show(this.pause, on);
  }

  SetPauseButton(visible: boolean) {
    this.pauseButton.node.setActive(visible && this.info.PauseButton);
    this.homeButton?.node.setActive(visible);
  }

  private homeIcon(parent: UINode, anchor: V2, pos: V2, home: () => void) {
    const b = UIKit.buttonAt(parent, "", anchor, pos, new V2(110, 110), false, () => home());
    UIKit.img(b.node, "Home", Art.Home, this.info.Accent).rectTransform.place(C, new V2(0, 2), new V2(54, 54));
    b.setAccent(this.info.Accent);
    return b;
  }

  ShowResult(r: Result) {
    this.hideChoices();
    this.show(this.pause, false);
    this.show(this.hud, false);
    this.show(this.over, true);
    this.Stick(0, false, V2.zero, V2.zero);
    this.Stick(1, false, V2.zero, V2.zero);
    this.Hint(null);
    this.stopCoroutine(this.overRoutine);
    this.pendingReward = r.Reward;
    if (this.rewardButton.label) this.rewardButton.label.text = r.RewardLabel;
    this.overRoutine = this.startCoroutine(this.resultRoutine(r));
  }

  private *resultRoutine(r: Result) {
    this.overHeadline.text = r.Headline;
    this.overHeadline.color = r.HeadlineColor;
    this.overHeadline.fontSize = r.Headline.length > 14 ? 50 : 64;
    this.overValue.text = r.CountTo >= 0 ? "0" : r.Value;
    this.overValue.gameObject.setActive(r.Stars < 0);
    for (const s of this.stars) {
      s.gameObject.setActive(r.Stars >= 0);
      s.color = new Color(1, 1, 1, 0.12);
      s.rectTransform.localScale = V3.one;
    }
    this.overBest.text = r.BestLine;
    this.overBest.gameObject.setActive(true);
    this.newBestBadge.setActive(false);
    if (this.retryButton.label) this.retryButton.label.text = r.Primary;
    for (let i = 0; i < 4; i++) {
      const has = !!r.Stats && i < r.Stats.length;
      this.statCells[i].setActive(has);
      if (!has) continue;
      this.statCaptions[i].text = r.Stats[i][0];
      this.statValues[i].text = r.Stats[i][1];
    }
    yield waitReal(0.25);
    for (let i = 0; i < Math.min(3, r.Stars); i++) {
      Sfx.play(Snd.Coin, 0.8, 1 + i * 0.18);
      Fx.haptic();
      const rt = this.stars[i].rectTransform;
      let t = 0;
      while (t < 0.3) {
        t += Time.unscaledDeltaTime;
        const k = Mathf.clamp01(t / 0.3), s = Mathf.lerp(1.8, 1, Ease.outBack(k));
        rt.localScale = new V3(s, s, 1);
        this.stars[i].color = Color.lerp(Color.white, Pal.Warn, k);
        yield;
      }
      yield waitReal(0.08);
    }
    if (r.CountTo >= 0) {
      const duration = Mathf.clamp(0.4 + r.CountTo / 5000, 0.5, 1.4);
      let t = 0, tick = 0;
      while (t < duration) {
        const dt = Time.unscaledDeltaTime;
        t += dt;
        tick -= dt;
        this.overValue.text = Fmt.n(Math.round(Mathf.lerp(0, r.CountTo, Ease.outCubic(Mathf.clamp01(t / duration)))));
        if (tick <= 0 && r.CountTo > 0) { Sfx.play(Snd.Tick, 0.5, 1 + t / duration); tick = 0.05; }
        yield;
      }
      this.overValue.text = r.Value;
    }
    if (r.NewBest) {
      this.overBest.gameObject.setActive(false);
      this.newBestBadge.setActive(true);
      Sfx.play(Snd.NewBest);
      let t = 0;
      while (t < 0.35) {
        t += Time.unscaledDeltaTime;
        const s = Ease.outBack(Mathf.clamp01(t / 0.35));
        this.newBestBadge.localScale = new V3(s, s, 1);
        yield;
      }
    }
    this.overRoutine = null;
  }

  /** Shows up to three cards and calls onPick with the chosen index. */
  ShowChoices(heading: string, cards: Choice[], onPick: (i: number) => void) {
    this.onChoice = onPick;
    this.choiceTitle.text = heading;
    this.choiceCards.forEach((cc, i) => {
      const has = i < cards.length;
      cc.button.node.setActive(has);
      if (!has) return;
      cc.button.setAccent(cards[i].color);
      cc.icon.sprite = cards[i].icon ?? Art.Disc;
      cc.icon.color = cards[i].color;
      cc.title.text = cards[i].title;
      cc.title.color = cards[i].color;
      cc.body.text = cards[i].body;
    });
    this.show(this.choices, true);
  }

  private pickChoice(index: number) {
    if (!this.ChoiceOpen) return;
    const cb = this.onChoice;
    this.onChoice = null;
    this.hideChoices();
    cb?.(index);
  }

  private hideChoices() { this.show(this.choices, false); }

  private openModal(g: CanvasGroup) {
    if (this.modal && this.modal !== g) this.show(this.modal, false);
    this.modal = g;
    this.refreshToggles();
    this.show(g, true);
  }

  CloseModal() { return this.closeModal(); }
  closeModal() {
    if (!this.modal) return false;
    this.show(this.modal, false);
    this.modal = null;
    return true;
  }

  private toggleSound() { Settings.Sound = !Settings.Sound; this.refreshToggles(); }
  private toggleMusic() { Settings.Music = !Settings.Music; this.refreshToggles(); }

  private refreshToggles() {
    this.setToggle(this.soundToggle, Settings.Sound, "ON", "OFF");
    this.setToggle(this.musicToggle, Settings.Music, "ON", "OFF");
    this.setToggle(this.hapticsToggle, Settings.Haptics, "ON", "OFF");
    this.setToggle(this.pauseSound, Settings.Sound, "SOUND ON", "SOUND OFF");
    this.setToggle(this.pauseMusic, Settings.Music, "MUSIC ON", "MUSIC OFF");
  }

  private setToggle(b: ArcadeButton | undefined, on: boolean, onText: string, offText: string) {
    if (!b) return;
    if (b.label) b.label.text = on ? onText : offText;
    b.setAccent(on ? this.info.Accent : Pal.TextDim);
  }

  // ------------------------------------------------------------------ HUD services

  /** A line of news on the title screen. */
  SetNews(text: string) { this.newsText.text = text ?? ""; }

  /** Shows a message in the hint bar for a few seconds. */
  Toast(text: string, seconds = 5) {
    this.stopCoroutine(this.toastRoutine);
    this.Hint(text);
    const self = this;
    this.toastRoutine = this.startCoroutine((function* () {
      yield waitReal(seconds);
      if (self.hintText.text === text) self.Hint(null);
      self.toastRoutine = null;
    })());
  }

  Hint(text: string | null) {
    if (!text) { this.hintTarget = 0; return; }
    if (this.hintText.text !== text || this.hintTarget < 0.5) this.hintPop = 1;
    this.hintText.text = text;
    this.hintTarget = 1;
  }

  Announce(text: string, color: Color, duration = 1.6) {
    this.stopCoroutine(this.announceRoutine);
    this.announceRoutine = this.startCoroutine(this.announceRoutineGen(text, color, duration));
  }

  private *announceRoutineGen(text: string, color: Color, duration: number) {
    this.announceText.text = text;
    this.announceText.fontSize = text.length > 16 ? 60 : 80;
    this.announceText.color = Color.lerp(color, Color.white, 0.3);
    this.announceGlow.effectColor = color.withAlpha(0.6);
    const rt = this.announce.node;
    let t = 0;
    while (t < duration) {
      t += Time.unscaledDeltaTime;
      const a = t < 0.15 ? t / 0.15 : t > duration - 0.4 ? (duration - t) / 0.4 : 1;
      this.announce.alpha = Mathf.clamp01(a);
      const s = Mathf.lerp(1.6, 1, Ease.outBack(Mathf.clamp01(t / 0.35)));
      rt.localScale = new V3(s, s, 1);
      yield;
    }
    this.announce.alpha = 0;
    this.announceRoutine = null;
  }

  /** Floating text that rises from a world point. */
  Float(world: V2, text: string, color: Color, scale = 1) {
    let f: Floater | null = null;
    for (const x of this.floaters) {
      if (!x.text.gameObject.activeSelf) { f = x; break; }
      if (!f || x.age > f.age) f = x;
    }
    if (!f) return;
    const sp = Camera.worldToScreen(world); // device px, y down
    const local = this.fxRoot.screenToLocal(new V2(sp.x, Screen.height - sp.y));
    const r = this.fxRoot.rect, hx = r.width / 2 - 200, hy = r.height / 2 - 80;
    f.start = new V2(Mathf.clamp(local.x, -hx, hx), Mathf.clamp(local.y, -hy, hy));
    f.age = 0;
    f.life = 0.9;
    f.scale = scale;
    f.text.text = text;
    f.text.color = color;
    f.outline.effectColor = new Color(color.r * 0.3, color.g * 0.3, color.b * 0.3, 0.8);
    f.text.gameObject.setActive(true);
    f.text.rectTransform.setAsLastSibling();
    Shell.animateFloater(f);
  }

  private clearFloaters() { for (const f of this.floaters) f.text.gameObject.setActive(false); }

  Stick(index: number, active: boolean, originScreen: V2, currentScreen: V2) {
    this.stickTarget[index] = active ? 1 : 0;
    if (!active) return;
    const o = this.fxRoot.screenToLocal(originScreen), c = this.fxRoot.screenToLocal(currentScreen);
    this.stickBase[index].anchoredPosition = o;
    this.stickKnob[index].anchoredPosition = o.add(V2.clampMagnitude(c.sub(o), 70));
  }

  /** Screen point → HUD-local coordinates (for world-anchored widgets). */
  ScreenToHud(screen: V2) { return this.Hud.screenToLocal(screen); }

  /** World point → HUD-local coordinates. */
  WorldToHud(world: V2) { const sp = Camera.worldToScreen(world); return this.Hud.screenToLocal(new V2(sp.x, Screen.height - sp.y)); }

  // ------------------------------------------------------------------ per-frame

  update() {
    const dt = Time.unscaledDeltaTime;
    this.clock += dt;
    this.applyLayout(false);
    for (const f of this.floaters) {
      if (!f.text.gameObject.activeSelf) continue;
      f.age += dt;
      if (f.age >= f.life) f.text.gameObject.setActive(false);
      else Shell.animateFloater(f);
    }
    for (let i = 0; i < 2; i++) this.sticks[i].alpha = Mathf.moveTowards(this.sticks[i].alpha, this.stickTarget[i], dt * 8);
    this.hint.alpha = Mathf.moveTowards(this.hint.alpha, this.hintTarget, dt * 4);
    this.hintPop = Mathf.moveTowards(this.hintPop, 0, dt * 3);
    const hs = 1 + 0.08 * Ease.outCubic(this.hintPop);
    this.hint.node.localScale = new V3(hs, hs, 1);
    if (this.title.node.activeSelf) {
      this.logoGlow.effectColor = Color.lerp(this.info.Accent, Pal.rainbow(this.clock * 0.08), 0.4).withAlpha(0.75);
      const ls = 1 + 0.02 * Math.sin(this.clock * 2);
      this.logo.rectTransform.localScale = new V3(ls, ls, 1);
    }
    // Rewarded offers appear as soon as an ad has loaded, and never while one is on screen.
    const offer = this.pendingReward !== null && Shell.isShown(this.over) && AdService.rewardedAvailable;
    if (this.rewardButton.node.activeSelf !== offer) this.rewardButton.node.setActive(offer);
    if (this.newBestBadge.activeSelf && this.overRoutine === null) {
      const bs = 1 + 0.05 * Math.sin(this.clock * 6);
      this.newBestBadge.localScale = new V3(bs, bs, 1);
    }
  }

  private claimReward() {
    if (!this.pendingReward || AdService.isShowing) return;
    AdService.showRewarded((earned) => {
      if (!earned) return;
      const reward = this.pendingReward;
      this.pendingReward = null;
      reward?.();
    });
  }

  /** Enter / Space / gamepad A activate the obvious button on the visible screen. */
  Confirm() {
    if (this.modal) { this.closeModal(); return true; }
    if (this.ChoiceOpen) { this.choiceCards[0].button.press(); return true; }
    if (Shell.isShown(this.title)) { this.playButton.press(); return true; }
    if (Shell.isShown(this.over)) { this.retryButton.press(); return true; }
    if (Shell.isShown(this.pause)) { this.resumeButton.press(); return true; }
    return false;
  }

  private static animateFloater(f: Floater) {
    const k = Mathf.clamp01(f.age / f.life);
    f.text.rectTransform.anchoredPosition = f.start.add(new V2(0, 120 * Ease.outCubic(k)));
    const pop = k < 0.15 ? Mathf.lerp(0.4, 1.25, k / 0.15) : Mathf.lerp(1.25, 1, Mathf.clamp01((k - 0.15) / 0.2));
    const s = pop * f.scale;
    f.text.rectTransform.localScale = new V3(s, s, 1);
    f.text.color = f.text.color.withAlpha(k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
  }

  /** Keeps the safe root inside the device safe area. */
  private applyLayout(force: boolean) {
    const sa = Screen.safeArea, key = `${Screen.width}x${Screen.height}:${sa.x},${sa.y},${sa.width},${sa.height}`;
    if (!force && key === this.lastSafe) return;
    this.lastSafe = key;
    const w = Math.max(1, Screen.width), h = Math.max(1, Screen.height);
    this.safeRoot.anchorMin = new V2(sa.xMin / w, sa.yMin / h);
    this.safeRoot.anchorMax = new V2(sa.xMax / w, sa.yMax / h);
    this.safeRoot.offsetMin = V2.zero;
    this.safeRoot.offsetMax = V2.zero;
  }

  private show(g: CanvasGroup, on: boolean, duration = 0.22) {
    const running = this.fades.get(g);
    if (running) this.stopCoroutine(running);
    this.fades.set(g, null);
    if (on) { g.node.setActive(true); g.blocksRaycasts = true; g.interactable = true; }
    else { g.blocksRaycasts = false; g.interactable = false; if (!g.node.activeSelf) return; }
    this.fades.set(g, this.startCoroutine(this.fade(g, on, duration)));
  }

  private *fade(g: CanvasGroup, on: boolean, duration: number) {
    const from = g.alpha, to = on ? 1 : 0, rt = g.node;
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

  private static isShown(g: CanvasGroup) { return g.node.activeSelf && g.interactable; }

  RandomTip() { return this.info.Tips.length === 0 ? "" : this.info.Tips[Random.rangeInt(0, this.info.Tips.length)]; }
}
