import {
  ArcadeGame, Art, CasualArt, CasualFx, CasualLook, CasualUI, Color, Fx, GameInfo, GameObject, howTo, Image, Keyboard, Mathf,
  Pal, Phase, PlayerPrefs, Random, Result, Sfx, Snd, SpriteRenderer, Text, TextAnchor, TouchScheme, UI, UIKit, UINode, V2, V3,
} from "../../kit";
import { Dictionary, hardModeError, LEN, score, Solver } from "./Logic";
import { Green, GreyTile, Ink, TileSprite, WordPanel, Yellow } from "./WordPanel";

/**
 * WORD GRID: guess the hidden five-letter word in six tries. After each guess the tiles turn green (right letter,
 * right spot), yellow (in the word, wrong spot) or grey (not in the word). DAILY is the same word for everyone on a
 * date; PRACTICE is unlimited; VS CPU races a solver (easy / medium / hard) on the same word; 2 PLAYERS race on one
 * device (face to face on a phone). Hard mode makes you use every hint. Stats, guess distribution and a shareable
 * emoji result. Rewarded: reveal a letter, or an extra guess after the sixth miss.
 */

enum Mode { Daily, Practice, Vs, Duo }
const ModeNames = ["DAILY", "PRACTICE", "VS CPU", "2 PLAYERS"];
const ModeHelp = [
  "DAILY: one word a day, the same for everyone. Keep your streak!",
  "PRACTICE: unlimited words, play as many as you like.",
  "VS CPU: race the computer to the same word. First to solve wins!",
  "2 PLAYERS: race a friend on one device. Same word, first to solve wins!",
];
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const DiffColors = [Green, Yellow, Pal.hex(0xff6b7d)];
const P1 = Pal.hex(0x5ec8ff), P2 = Pal.hex(0xff7ab8);
const Praise = ["GENIUS!", "MAGNIFICENT!", "IMPRESSIVE!", "SPLENDID!", "GREAT!", "PHEW!", "LUCKY ONE!"];
/** Seconds the computer takes per guess (min, max) by level. */
const CpuThink: [number, number][] = [[15, 23], [11, 17], [8, 12]];

interface Side {
  panel: WordPanel;
  answer: string;
  history: { word: string; marks: number[] }[];
  done: boolean;
  won: boolean;
  doneAt: number;
  bot: Solver | null;
  botTimer: number;
  botTyping: number;
  name: string;
  color: Color;
  extra: boolean;
}

export class WordGridGame extends ArcadeGame {
  private world!: GameObject;
  private bgCover!: SpriteRenderer;
  private bokeh: { sr: SpriteRenderer; v: V2 }[] = [];
  private fx!: CasualFx;
  private dict: Dictionary | null = null;
  private loading: Promise<void> | null = null;
  private sides: Side[] = [];
  private panels: WordPanel[] = [];
  private cpuPanel!: WordPanel;
  private mode = Mode.Daily;
  private diff = 1;
  private hard = false;
  private focus = 0;
  private clock = 0;
  private ending = 0;

  private replay = false;
  private day = 0;
  private statsCounted = false;
  private usedHints = 0;

  private modeText!: Text; private subText!: Text;
  private hintButton!: ReturnType<typeof UIKit.buttonAt>;
  private modeButton!: ReturnType<typeof UIKit.buttonAt>; private diffButton!: ReturnType<typeof UIKit.buttonAt>; private hardButton!: ReturnType<typeof UIKit.buttonAt>;
  private modeLabel!: Text;
  private card!: UINode; private bars: { fill: Image; label: Text; count: Text }[] = []; private cardTitle!: Text; private shareButton!: ReturnType<typeof UIKit.buttonAt>;
  private loadingText!: Text;

  protected Describe() {
    return new GameInfo({
      Id: "wordgrid",
      Title: "WORD GRID",
      Tagline: "SIX TRIES. ONE WORD. NEW EVERY DAY.",
      PlayLabel: "PLAY",
      Accent: Green,
      Accent2: Yellow,
      BgTop: Pal.hex(0x1c2a5e),
      BgBottom: Pal.hex(0x0b1030),
      ShortSide: 10,
      Touch: TouchScheme.None,
      HomeBesidePause: true,
      Music: { bpm: 92, rootHz: 130.8, degrees: [0, 4, 5, 3], seed: 11, energy: 0.25, major: true },
      Reminders: [
        "Today's word is waiting|Can you solve it in three?",
        "Keep your streak alive|A new Word Grid puzzle is ready.",
        "Race the computer|Who finds the word first?",
      ],
      HowTo: [
        howTo(TileSprite(), Green, "Guess the hidden FIVE-LETTER word in six tries. Type a word and press ENTER."),
        howTo(TileSprite(), Green, "GREEN: the letter is in the word, in the right spot."),
        howTo(TileSprite(), Yellow, "YELLOW: the letter is in the word, but in another spot."),
        howTo(TileSprite(), GreyTile, "GREY: the letter is not in the word at all."),
        howTo(Art.Star, Yellow, "DAILY: the same word for everyone today. PRACTICE: as many as you like."),
        howTo(Art.Diamond, P2, "VS CPU and 2 PLAYERS: race to the same word. First to solve it wins!"),
        howTo(Art.Plus, P1, "HARD MODE: every revealed hint must be used in later guesses."),
      ],
      Tips: [
        "Start with a word full of common letters, like RAISE or STONE.",
        "A yellow letter rules out that spot, too.",
        "Letters can repeat: try them if you're stuck.",
        "Use a fresh word to test many new letters at once.",
      ],
    });
  }

  protected get ShortSide() { return 10; }

  private get Hints() { return this.Data.get("hints", 3); }
  private set Hints(v: number) { this.Data.set("hints", Math.max(0, v)); }

  private Pre(m: Mode) { return m === Mode.Daily ? "d." : "p."; }

  protected BestLine() {
    if (this.mode === Mode.Vs) return `VS ${DiffNames[this.diff]}:  ${this.Data.get("w" + this.diff)} WON  ·  ${this.Data.get("l" + this.diff)} LOST`;
    if (this.mode === Mode.Duo) return `PLAYER 1  ${this.Data.get("p1")}  –  ${this.Data.get("p2")}  PLAYER 2`;
    const pre = this.Pre(this.mode), played = this.Data.get(pre + "played");
    if (played === 0) return this.mode === Mode.Daily ? `TODAY'S PUZZLE #${this.day + 1}` : "";
    return `STREAK ${this.Data.get(pre + "streak")}   ·   WIN ${Math.round((100 * this.Data.get(pre + "won")) / played)}%`;
  }

  protected StatsLine() {
    if (this.mode === Mode.Daily) {
      const done = this.Data.get("d.doneDay") === this.day + 1;
      return done ? `TODAY SOLVED ✓   ·   NEXT WORD IN ${this.NextIn()}` : `DAILY #${this.day + 1}   ·   NEW WORD IN ${this.NextIn()}`;
    }
    return `${this.Data.get("games")} GAMES PLAYED`;
  }

  private NextIn() {
    const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const s = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
    return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("WordGrid", this.gameObject);
    CasualLook.calm(this, 1.3, 0.15);
    this.bgCover = CasualLook.cover(this.world, CasualArt.gradient(Pal.hex(0x243a7a), Pal.hex(0x0b1030), new Color(0.35, 0.95, 0.6, 0.25)), -910);
    const bok = CasualArt.make("wg-bokeh", 64, 64, (p) => new Color(1, 1, 1, CasualArt.fill(CasualArt.sdBox(p, new V2(0.8, 0.8), 0.2), 0.08) * 0.8));
    const cols = [Green, Yellow, GreyTile, P1, P2];
    for (let i = 0; i < 14; i++) {
      const sr = Art.spr(this.world, "Bokeh", bok, cols[i % cols.length].withAlpha(0.07), Random.range(0.5, 1.4), -850);
      sr.transform.localPosition = new V3(Random.range(-9, 9), Random.range(-9, 9), 0);
      sr.transform.localEulerZ = Random.range(-20, 20);
      this.bokeh.push({ sr, v: new V2(Random.range(-0.1, 0.1), Random.range(0.08, 0.25)) });
    }
    this.fx = CasualFx.create(this.world, 60, 160);
    this.mode = Mathf.clamp(this.Data.get("mode"), 0, 3) as Mode;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.hard = this.Data.get("hard") === 1;
    this.day = Dictionary.dayNumber(new Date());

    const hud = this.UI.Hud;
    const area = UIKit.node("Panels", hud).stretch();
    area.setAsFirstSibling();
    for (let i = 0; i < 2; i++) {
      const p = new WordPanel(area, i === 0 ? P1 : P2, false, true);
      const idx = i;
      p.onKey = (k) => { this.focus = idx; this.OnKey(idx, k); };
      this.panels.push(p);
    }
    this.cpuPanel = new WordPanel(area, P2, true, false);
    this.modeText = UIKit.at(UIKit.label(hud, "", 44, Color.white), new V2(0.5, 1), new V2(0, -70), new V2(700, 60));
    UIKit.glow(this.modeText, Ink, 3);
    this.subText = UIKit.at(UIKit.label(hud, "", 26, new Color(1, 1, 1, 0.75)), new V2(0.5, 1), new V2(0, -118), new V2(700, 36));
    this.hintButton = UIKit.buttonAt(hud, "REVEAL", new V2(0, 1), new V2(150, -85), new V2(250, 100), false, () => this.OnHint(), 28);
    this.hintButton.setAccent(Yellow);
    this.loadingText = UIKit.at(UIKit.label(hud, "LOADING WORDS…", 40, Color.white), UIKit.Center, V2.zero, new V2(800, 60));
    this.BuildTitle();
    this.BuildCard();
    this.Layout();
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    CasualLook.titleCard(this.UI, new Color(0.06, 0.08, 0.2, 0.7));
    this.modeButton = UIKit.buttonAt(ex, "MODE", UIKit.Center, new V2(-330, 10), new V2(320, 100), false, () => this.CycleMode(), 30);
    this.diffButton = UIKit.buttonAt(ex, "CPU", UIKit.Center, new V2(0, 10), new V2(300, 100), false, () => this.CycleDiff(), 28);
    this.hardButton = UIKit.buttonAt(ex, "HARD", UIKit.Center, new V2(330, 10), new V2(320, 100), false, () => this.ToggleHard(), 28);
    this.modeLabel = UIKit.at(UIKit.wrap(UIKit.label(ex, "", 24, new Color(1, 1, 1, 0.85))), UIKit.Center, new V2(0, -72), new V2(980, 60));
    this.RefreshTitle();
  }

  private RefreshTitle() {
    if (!this.modeButton) return;
    CasualUI.setText(this.modeButton.label!, ModeNames[this.mode]);
    this.modeButton.setAccent([Green, P1, P2, Yellow][this.mode]);
    CasualUI.setText(this.diffButton.label!, this.mode === Mode.Vs ? "CPU: " + DiffNames[this.diff] : "CPU: —");
    this.diffButton.setAccent(this.mode === Mode.Vs ? DiffColors[this.diff] : Pal.TextDim);
    this.diffButton.interactable = this.mode === Mode.Vs;
    CasualUI.setText(this.hardButton.label!, this.hard ? "HARD MODE: ON" : "HARD MODE: OFF");
    this.hardButton.setAccent(this.hard ? Pal.hex(0xff6b7d) : Pal.TextDim);
    this.modeLabel.text = ModeHelp[this.mode];
  }

  private CycleMode() { this.mode = ((this.mode + 1) % 4) as Mode; this.Data.set("mode", this.mode); this.RefreshTitle(); this.UI.ShowTitle(this.BestLine(), this.StatsLine()); }
  private CycleDiff() { this.diff = (this.diff + 1) % 3; this.Data.set("diff", this.diff); this.RefreshTitle(); this.UI.ShowTitle(this.BestLine(), this.StatsLine()); }
  private ToggleHard() {
    this.hard = !this.hard;
    this.Data.set("hard", this.hard ? 1 : 0);
    this.RefreshTitle();
    this.UI.Toast(this.hard ? "Hard mode: green letters must stay in place and yellow letters must be used." : "Hard mode off.", 3);
  }

  /** Distribution card + share button, placed inside the shared result screen. */
  private BuildCard() {
    const res = UI.root?.find("Safe/Result") ?? this.UI.Hud;
    this.card = UIKit.node("WordStats", res);
    UIKit.img(this.card, "Bg", Art.UiRound, Pal.Panel.withAlpha(0.85)).rectTransform.stretch();
    UIKit.img(this.card, "Edge", Art.UiOutline, Green.withAlpha(0.4)).rectTransform.stretch();
    this.cardTitle = UIKit.label(this.card, "GUESS DISTRIBUTION", 30, Color.white);
    for (let i = 0; i < 7; i++) {
      const label = UIKit.label(this.card, i < 6 ? String(i + 1) : "+", 28, Color.white);
      const fill = UIKit.img(this.card, "Bar", Art.UiRound, GreyTile);
      const count = UIKit.label(fill.rectTransform, "0", 24, Color.white, TextAnchor.MiddleRight);
      this.bars.push({ fill, label, count });
    }
    this.shareButton = UIKit.buttonAt(this.card, "SHARE", UIKit.Center, V2.zero, new V2(300, 90), true, () => this.Share(), 36);
    this.shareButton.setAccent(Green);
    this.card.setActive(false);
  }

  private LayoutCard() {
    const res = this.card.parent;
    if (!res) return;
    const r = res.rect, portrait = r.height > r.width;
    const w = 420, h = 600;
    let pos: V2, s = 1;
    if (portrait) {
      const free = r.height / 2 - 520;
      s = Mathf.clamp(free / (h + 40), 0.5, 1);
      pos = new V2(0, 500 + (h * s) / 2 + 10);
      if (free < 300) { s = 0.6; pos = new V2(0, 520 + h * 0.3); }
    } else {
      const free = r.width / 2 - 520;
      s = Mathf.clamp(free / (w + 30), 0.5, 1);
      pos = new V2(-(520 + (w * s) / 2), 0);
    }
    this.card.place(UIKit.Center, pos, new V2(w, h));
    this.card.localScale = new V3(s, s, 1);
    this.cardTitle.rectTransform.place(UIKit.Center, new V2(0, h / 2 - 45), new V2(w, 44));
    for (let i = 0; i < 7; i++) {
      const y = h / 2 - 110 - i * 52;
      this.bars[i].label.rectTransform.place(UIKit.Center, new V2(-w / 2 + 34, y), new V2(40, 44));
    }
    this.shareButton.node.place(UIKit.Center, new V2(0, -h / 2 + 62), new V2(300, 90));
  }

  private RefreshCard(highlight: number) {
    const pre = this.Pre(this.mode);
    const counts = [1, 2, 3, 4, 5, 6, 7].map((g) => this.Data.get(pre + "g" + g));
    const max = Math.max(1, ...counts);
    const w = 420, maxW = w - 110;
    for (let i = 0; i < 7; i++) {
      const b = this.bars[i];
      const show = i < 6 || counts[6] > 0;
      b.fill.gameObject.setActive(show);
      b.label.gameObject.setActive(show);
      const bw = Math.max(46, (maxW * counts[i]) / max);
      const y = 600 / 2 - 110 - i * 52;
      b.fill.rectTransform.place(UIKit.Center, new V2(-w / 2 + 64 + bw / 2, y), new V2(bw, 40));
      b.fill.color = i === highlight ? Green : GreyTile;
      b.count.text = String(counts[i]);
      b.count.rectTransform.stretch(10);
    }
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    if (!this.panels.length) return;
    this.LayoutCard();
    const hud = this.UI.Hud.rect;
    const W = hud.width, H = hud.height, portrait = H > W;
    const top = 160, bottom = 20;
    const p0 = this.panels[0], p1 = this.panels[1], cpu = this.cpuPanel;
    const n = this.sides.length;
    const duo = n === 2 && this.mode === Mode.Duo, vs = n === 2 && this.mode === Mode.Vs;
    p1.root.setActive(duo);
    cpu.root.setActive(vs);
    if (duo) {
      if (portrait) {
        const h = (H - 140) / 2;
        p1.place(new V2(0, H / 2 - 120 - h / 2 + 10), new V2(Math.min(W - 20, 1000), h - 20), true);
        p0.place(new V2(0, -H / 2 + h / 2 + bottom), new V2(Math.min(W - 20, 1000), h - 20), false);
      } else {
        const w = Math.min((W - 60) / 2, 900);
        p0.place(new V2(-W / 4, -top / 2 + bottom / 2), new V2(w, H - top - bottom), false);
        p1.place(new V2(W / 4, -top / 2 + bottom / 2), new V2(w, H - top - bottom), false);
      }
    } else if (vs) {
      if (portrait) {
        const ch = 300;
        cpu.place(new V2(W / 2 - 170, H / 2 - top - ch / 2 + 20), new V2(300, ch), false);
        p0.place(new V2(0, -H / 2 + (H - top - ch - 10) / 2 + bottom), new V2(Math.min(W - 20, 1000), H - top - ch - 10 - bottom), false);
      } else {
        const side = Math.min(380, W * 0.22);
        const mw = Math.min(W - side - 80, 1000);
        p0.place(new V2(-side / 2 - 10, -top / 2 + bottom / 2), new V2(mw, H - top - bottom), false);
        cpu.place(new V2(mw / 2 + 20, -top / 2 + bottom / 2 + 60), new V2(side, Math.min(560, H * 0.55)), false);
      }
    } else {
      p0.place(new V2(0, -top / 2 + bottom / 2), new V2(Math.min(W - 20, 1000), H - top - bottom), false);
    }
    this.hintButton.node.setActive(this.mode !== Mode.Duo && n > 0);
  }

  // ------------------------------------------------------------------ words

  private EnsureWords() {
    if (this.dict) return Promise.resolve();
    if (!this.loading) this.loading = import("./Words").then((m) => { this.dict = new Dictionary(m.ANSWERS, m.EXTRA); });
    return this.loading;
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.sides = [];
    this.card.setActive(false);
    for (const p of this.panels) p.root.setActive(false);
    this.cpuPanel.root.setActive(false);
    this.day = Dictionary.dayNumber(new Date());
    this.RefreshTitle();
    this.EnsureWords();
  }

  protected BeginRun() {
    this.mode = Mathf.clamp(this.Data.get("mode"), 0, 3) as Mode;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.hard = this.Data.get("hard") === 1;
    this.day = Dictionary.dayNumber(new Date());
    this.sides = [];
    this.card.setActive(false);
    this.ending = 0;

    this.statsCounted = false;
    this.replay = false;
    this.usedHints = 0;
    this.clock = 0;
    this.focus = 0;
    for (const p of this.panels) p.root.setActive(false);
    this.cpuPanel.root.setActive(false);
    this.loadingText.gameObject.setActive(!this.dict);
    this.EnsureWords().then(() => { if (this.State === Phase.Playing && this.sides.length === 0) this.Setup(); });
    if (this.dict) this.Setup();
  }

  private Setup() {
    const d = this.dict!;
    this.loadingText.gameObject.setActive(false);
    const answer = this.mode === Mode.Daily ? d.daily(this.day) : d.random(Math.random);
    const mk = (panel: WordPanel, name: string, color: Color, bot: Solver | null): Side => ({
      panel, answer, history: [], done: false, won: false, doneAt: 0, bot, botTimer: 0, botTyping: 0, name, color, extra: false,
    });
    if (this.mode === Mode.Vs) {
      this.sides = [mk(this.panels[0], "YOU", P1, null), mk(this.cpuPanel, "CPU · " + DiffNames[this.diff], DiffColors[this.diff], new Solver(d, this.diff, Math.random))];
      this.sides[1].botTimer = this.BotDelay(true);
    } else if (this.mode === Mode.Duo) {
      this.sides = [mk(this.panels[0], "PLAYER 1", P1, null), mk(this.panels[1], "PLAYER 2", P2, null)];
    } else this.sides = [mk(this.panels[0], "", P1, null)];
    for (const s of this.sides) {
      s.panel.setName(this.sides.length > 1 ? s.name : "", s.color);
      s.panel.root.setActive(true);
      s.panel.reset(6);
    }
    this.Data.add("games", 1);
    this.Layout();
    this.UpdateHud();
    // daily: restore today's progress
    if (this.mode === Mode.Daily) {
      const saved = PlayerPrefs.getString(this.DailyKey, "");
      const s = this.sides[0];
      if (saved) {
        for (const w of saved.split(",")) {
          if (w.length !== LEN) continue;
          if (s.history.length >= 6 && !s.extra) { s.extra = true; s.panel.setRows(7); }
          const m = score(w, s.answer);
          s.history.push({ word: w, marks: m });
          s.panel.reveal(w, m, true);
          if (w === s.answer) { s.done = s.won = true; }
        }
        if (!s.done && s.history.length >= s.panel.rows) s.done = true;
        if (s.done) { this.replay = this.Data.get("d.doneDay") === this.day + 1; this.statsCounted = this.replay; this.ending = 0.9; }
      }
      if (!s.done && s.history.length === 0 && this.Data.get("d.played") === 0) s.panel.message("Type any five-letter word, then ENTER", 4);
    } else if (this.Data.get("games") <= 1) for (const s of this.sides) if (!s.bot) s.panel.message("Type any five-letter word, then ENTER", 4);
    Sfx.setIntensity(0.15);
  }

  private get DailyKey() { return "arcade.wordgrid.daily." + this.day; }

  private BotDelay(first: boolean) {
    const [a, b] = CpuThink[this.diff];
    return (first ? 0.55 : 1) * Random.range(a, b);
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Drift(dt);
    for (const s of this.sides) s.panel.update(dt);
  }

  private Drift(dt: number) {
    const hw = this.ViewSize.x * 0.6 + 1, hh = this.ViewSize.y * 0.6 + 1;
    for (const b of this.bokeh) {
      const lp = b.sr.transform.localPosition;
      let p = new V2(lp.x, lp.y).add(b.v.mul(dt));
      if (p.y > hh) p = new V2(Random.range(-hw, hw), -hh);
      b.sr.transform.localPosition = new V3(p.x, p.y, 0);
    }
  }

  protected TickRun(dt: number) {
    this.Drift(dt);
    for (const s of this.sides) s.panel.update(dt);
    if (this.sides.length === 0) return;
    this.clock += dt;
    if (this.ending > 0) {
      this.ending -= dt;
      if (this.ending <= 0) this.End();
      return;
    }
    // physical keyboard
    for (const ch of Keyboard.typed) {
      const i = this.mode === Mode.Duo ? this.focus : 0;
      if (ch === "Enter") this.OnKey(i, "Enter");
      else if (ch === "Backspace") this.OnKey(i, "Backspace");
      else if (/^[a-zA-Z]$/.test(ch)) this.OnKey(i, ch.toUpperCase());
    }
    // the computer
    for (const s of this.sides) {
      if (!s.bot || s.done) continue;
      const human = this.sides[0];
      const speed = human.done ? 4 : 1;
      s.botTimer -= dt * speed;
      const typing = Math.min(LEN, Math.floor((2.2 - s.botTimer) / 0.35));
      if (s.botTimer < 2.2 && typing !== s.botTyping && typing >= 0) { s.botTyping = typing; s.panel.ghostType(typing); }
      if (s.botTimer <= 0 && !s.panel.animating) this.BotGuess(s);
    }
    this.CheckEnd();
    this.UpdateHud();
  }

  private BotGuess(s: Side) {
    const w = s.bot!.next();
    const m = score(w, s.answer);
    s.bot!.feed(w, m);
    s.history.push({ word: w, marks: m });
    s.panel.reveal(w, m);
    s.botTyping = 0;
    s.botTimer = this.BotDelay(false);
    Sfx.play(Snd.Click, 0.4, 0.8);
    if (w === s.answer) { s.done = s.won = true; s.doneAt = this.clock; s.panel.bounceRow(s.history.length - 1); this.UI.Toast(`${s.name} SOLVED IT IN ${s.history.length}!`, 2.5); }
    else if (s.history.length >= s.panel.rows) { s.done = true; s.doneAt = this.clock; }
  }

  private OnKey(i: number, k: string) {
    if (this.State !== Phase.Playing || this.ending > 0) return;
    const s = this.sides[i];
    if (!s || s.bot || s.done) return;
    const p = s.panel;
    if (p.animating && k === "Enter") return;
    if (k === "Backspace") { if (p.back()) Sfx.play(Snd.Click, 0.3, 0.8); return; }
    if (k === "Enter") { this.Submit(i); return; }
    if (k.length === 1 && p.type(k)) { Sfx.play(Snd.Click, 0.35, 1 + p.current.length * 0.05); this.UI.Hint(null); }
  }

  private Submit(i: number) {
    const s = this.sides[i], p = s.panel, d = this.dict!;
    const w = p.current;
    if (w.length < LEN) { p.shake(); p.message("Not enough letters"); Sfx.play(Snd.Deny, 0.5); return; }
    if (!d.isWord(w)) { p.shake(); p.message("Not in word list"); Sfx.play(Snd.Deny, 0.5); Fx.haptic(); return; }
    if (this.hard) {
      const err = hardModeError(w, s.history);
      if (err) { p.shake(); p.message(err, 2); Sfx.play(Snd.Deny, 0.5); return; }
    }
    const m = score(w, s.answer);
    s.history.push({ word: w, marks: m });
    const t = p.reveal(w, m);
    if (this.mode === Mode.Daily) PlayerPrefs.setString(this.DailyKey, s.history.map((h) => h.word).join(","));
    if (w === s.answer) {
      s.done = s.won = true;
      s.doneAt = this.clock + t;
      this.Delay(t, () => {
        p.bounceRow(s.history.length - 1);
        Sfx.play(Snd.Win, 0.7);
        Fx.haptic(true);
        this.fx.confetti(new V2(0, this.ViewSize.y * 0.25), 50, 7, [Green, Yellow, P1, P2, Color.white]);
        p.message(Praise[Math.min(s.history.length - 1, 6)], 2.5);
      });
    } else if (s.history.length >= p.rows) {
      s.done = true;
      s.doneAt = this.clock + t;
    }
  }

  private delays: { t: number; fn: () => void }[] = [];
  private Delay(t: number, fn: () => void) { this.delays.push({ t: this.clock + t, fn }); }

  private CheckEnd() {
    const due = this.delays.filter((d) => d.t <= this.clock);
    this.delays = this.delays.filter((d) => d.t > this.clock);
    for (const d of due) d.fn();
    const ss = this.sides;
    if (ss.length === 0 || this.ending > 0) return;
    let finished = false;
    if (ss.length === 1) finished = ss[0].done;
    else {
      const solvedFirst = ss.some((s) => s.won);
      finished = solvedFirst || ss.every((s) => s.done);
      // a lone failure keeps the race going for the other player
    }
    if (!finished) return;
    if (ss.some((s) => s.panel.animating)) return;
    this.ending = ss.length === 1 && ss[0].won ? 1.6 : 1.0;
  }

  // ------------------------------------------------------------------ hints

  private OnHint() {
    if (this.State !== Phase.Playing || this.ending > 0) return;
    const s = this.sides[0];
    if (!s || s.done) return;
    if (!CasualUI.useOrEarn(() => this.Hints, (v) => (this.Hints = v), this.UI, "+1 REVEAL")) { this.UpdateHud(); return; }
    this.RevealLetter();
  }

  private RevealLetter() {
    const s = this.sides[0];
    const known = new Set<number>();
    for (const h of s.history) for (let i = 0; i < LEN; i++) if (h.marks[i] === 2) known.add(i);
    const open = [0, 1, 2, 3, 4].filter((i) => !known.has(i) && !this.revealed.has(i));
    if (open.length === 0) { s.panel.message("Nothing left to reveal!"); return; }
    const pos = open[Math.floor(Math.random() * open.length)];
    this.revealed.add(pos);
    s.panel.showHint(pos, s.answer[pos]);
    this.usedHints++;
    Sfx.play(Snd.PowerUp, 0.6);
    s.panel.message(`Letter ${pos + 1} is ${s.answer[pos]}`, 2);
    this.UpdateHud();
  }
  private revealed = new Set<number>();

  private UpdateHud() {
    const n = this.sides.length;
    if (n === 0) return;
    const title = this.mode === Mode.Daily ? `DAILY #${this.day + 1}` : this.mode === Mode.Practice ? "PRACTICE" : this.mode === Mode.Vs ? "RACE THE CPU" : "2 PLAYER RACE";
    CasualUI.setText(this.modeText, title + (this.hard ? "  ·  HARD" : ""));
    let sub = "";
    if (this.mode === Mode.Vs) {
      const b = this.sides[1];
      sub = b.won ? "CPU SOLVED IT!" : b.done ? "CPU IS OUT OF GUESSES" : `CPU: ${b.history.length} / 6 GUESSES`;
    } else if (this.mode === Mode.Duo) sub = "SAME WORD · FIRST TO SOLVE WINS";
    else sub = `GUESS ${Math.min(this.sides[0].history.length + 1, this.sides[0].panel.rows)} OF ${this.sides[0].panel.rows}`;
    CasualUI.setText(this.subText, sub);
    CasualUI.booster(this.hintButton, "REVEAL", this.Hints, !this.sides[0].done && this.ending <= 0);
  }

  // ------------------------------------------------------------------ results

  private End() {
    const ss = this.sides;
    if (this.mode === Mode.Duo) {
      const winner = this.Winner();
      if (winner >= 0) this.Data.add(winner === 0 ? "p1" : "p2", 1);
      this.card.setActive(false);
      this.Finish(new Result({
        Headline: winner >= 0 ? `${ss[winner].name} WINS!` : "NOBODY GOT IT",
        HeadlineColor: winner >= 0 ? ss[winner].color : Color.white,
        Value: ss[0].answer,
        BestLine: `P1  ${this.Data.get("p1")}  –  ${this.Data.get("p2")}  P2`,
        Stats: [["P1 GUESSES", ss[0].won ? String(ss[0].history.length) : "✗"], ["P2 GUESSES", ss[1].won ? String(ss[1].history.length) : "✗"]],
        Primary: "REMATCH",
        Victory: winner >= 0,
      }));
      return;
    }
    if (this.mode === Mode.Vs) {
      const winner = this.Winner();
      const won = winner === 0;
      if (won) this.Data.add("w" + this.diff, 1); else if (winner === 1) this.Data.add("l" + this.diff, 1);
      const me = ss[0], cpu = ss[1];
      this.card.setActive(false);
      const canExtra = !won && !cpu.won && !me.extra;
      this.Finish(new Result({
        Headline: won ? "YOU WIN!" : winner === 1 ? "CPU WINS" : "NOBODY GOT IT",
        HeadlineColor: won ? Yellow : Pal.hex(0xffc6d0),
        Value: canExtra ? "?????" : me.answer,
        Stars: won ? this.diff + 1 : -1,
        BestLine: (won ? `THE WORD: ${me.answer}  ·  ` : "") + `VS ${DiffNames[this.diff]}: ${this.Data.get("w" + this.diff)} WON · ${this.Data.get("l" + this.diff)} LOST`,
        Stats: [["YOUR GUESSES", me.won ? String(me.history.length) : "✗"], ["CPU GUESSES", cpu.won ? String(cpu.history.length) : "✗"], ["WORD", canExtra ? "?????" : me.answer], ["CPU", DiffNames[this.diff]]],
        Primary: won ? "PLAY AGAIN" : "REMATCH",
        Victory: won,
        Reward: canExtra ? () => this.ExtraGuess() : null,
        RewardLabel: "+1 EXTRA GUESS (WATCH AD)",
      }));
      return;
    }
    const s = ss[0], pre = this.Pre(this.mode);
    const canExtra = !s.won && !s.extra && !this.replay;
    if (!this.statsCounted) this.CountStats(s, canExtra);
    const guesses = s.history.length;
    this.RefreshCard(s.won ? guesses - 1 : -1);
    this.card.setActive(this.mode === Mode.Daily || this.mode === Mode.Practice);
    const played = Math.max(1, this.Data.get(pre + "played"));
    this.Finish(new Result({
      Headline: s.won ? Praise[Math.min(guesses - 1, 6)] : canExtra ? "OUT OF GUESSES" : "SO CLOSE!",
      HeadlineColor: s.won ? Green : Pal.hex(0xffc6d0),
      Value: canExtra ? "?????" : s.answer,
      Stars: s.won ? Math.max(1, Math.min(3, 6 - guesses) - (this.usedHints > 0 ? 1 : 0)) : -1,
      BestLine: (canExtra ? "" : `THE WORD: ${s.answer}  ·  `) + (this.mode === Mode.Daily ? `NEXT DAILY IN ${this.NextIn()}` : "PRACTICE"),
      Stats: [["PLAYED", String(this.Data.get(pre + "played"))], ["WIN %", String(Math.round((100 * this.Data.get(pre + "won")) / played))], ["STREAK", String(this.Data.get(pre + "streak"))], ["MAX STREAK", String(this.Data.get(pre + "maxStreak"))]],
      Primary: this.mode === Mode.Daily ? "PRACTICE" : "NEXT WORD",
      Victory: s.won,
      Reward: canExtra ? () => this.ExtraGuess() : null,
      RewardLabel: "+1 EXTRA GUESS (WATCH AD)",
    }));
    // after the daily, PLAY AGAIN goes to practice
    if (this.mode === Mode.Daily) this.Data.set("mode", Mode.Practice);
    this.UI.Toast(s.won ? "Tap SHARE to copy your result!" : "Better luck next time!", 2.5);
  }

  /** Records a finished solo game (once; a game that may still get an extra guess is counted when it ends). */
  private CountStats(s: Side, pending: boolean) {
    const pre = this.Pre(this.mode);
    if (pending && !s.won) {
      // counted as a loss now; an extra-guess win later converts it
      this.pendingLoss = true;
    }
    this.statsCounted = true;
    this.Data.set(pre + "streakBefore", this.Data.get(pre + "streak"));
    this.Data.add(pre + "played", 1);
    if (s.won) {
      this.Data.add(pre + "won", 1);
      this.Data.add(pre + "g" + Math.min(7, s.history.length), 1);
      this.Data.add(pre + "streak", 1);
      this.Data.max(pre + "maxStreak", this.Data.get(pre + "streak"));
    } else this.Data.set(pre + "streak", 0);
    if (this.mode === Mode.Daily) this.Data.set("d.doneDay", this.day + 1);
  }
  private pendingLoss = false;

  private Winner() {
    const ss = this.sides;
    const solved = ss.map((s, i) => ({ s, i })).filter((x) => x.s.won);
    if (solved.length === 0) return -1;
    solved.sort((a, b) => a.s.doneAt - b.s.doneAt);
    return solved[0].i;
  }

  private ExtraGuess() {
    const s = this.sides[0];
    s.extra = true;
    s.done = false;
    s.panel.setRows(7);
    if (this.pendingLoss && (this.mode === Mode.Daily || this.mode === Mode.Practice)) {
      // undo the loss we recorded; the game is still on
      const pre = this.Pre(this.mode);
      this.Data.add(pre + "played", -1);
      this.Data.set(pre + "streak", this.Data.get(pre + "streakBefore"));
      this.statsCounted = false;
      this.pendingLoss = false;
    }
    if (this.mode === Mode.Daily) this.Data.set("mode", Mode.Daily);
    this.card.setActive(false);
    this.ending = 0;
    this.Revive();
    this.Layout();
    this.UI.Announce("ONE MORE TRY!", Yellow, 1.2);
    Sfx.play(Snd.PowerUp, 0.7);
  }

  // ------------------------------------------------------------------ share

  private ShareText() {
    const s = this.sides[0];
    const tag = this.mode === Mode.Daily ? `#${this.day + 1}` : "Practice";
    const n = s.won ? `${s.history.length}/6` : "X/6";
    const rows = s.history.map((h) => h.marks.map((m) => (m === 2 ? "🟩" : m === 1 ? "🟨" : "⬛")).join(""));
    return `Word Grid ${tag} ${n}${this.hard ? "*" : ""}${s.extra ? " (+1)" : ""}\n\n${rows.join("\n")}`;
  }

  private Share() {
    const text = this.ShareText();
    const done = () => { this.UI.Toast("Result copied to clipboard!", 2); Sfx.play(Snd.Coin, 0.5); };
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch { this.UI.Toast(text, 4); }
      ta.remove();
    };
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    } catch { fallback(); }
    (window as unknown as { __wgShare?: string }).__wgShare = text;
  }

  protected OnPauseChanged(_paused: boolean) {}
}
