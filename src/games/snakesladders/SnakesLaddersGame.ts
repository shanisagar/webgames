import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, Camera, CanvasGroup, CasualArt, CasualFx, CasualLook, Color, Ease, Fmt, Fx,
  GameInfo, GameObject, howTo, Image, Keyboard, Mathf, MeshRenderer, Mouse, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer,
  SysRandom, Text, TextAnchor, TextMesh, Time, Touchscreen, TouchScheme, UI, UIKit, UINode, V2, V3, overUI, wait,
} from "../../kit";
import { Dice3D } from "./Dice3D";
import { ladderMesh, PlayerColors, PlayerNames, snakeMesh, snakePath, SnakesArt, Themes } from "./SnakesArt";
import { Card, CardInfo, CardNames, cellOf, Layout, makeLayout, Player, Rules } from "./SnakesBoard";

/**
 * SNAKES & LADDERS DASH: roll, race, climb and slide. The classic 100-square board with hand-drawn (procedural)
 * snakes and ladders and a real 3-D die. Play against 1–3 computer players, pass-and-play with up to four people on
 * one screen, or race the board alone in fewest rolls. DASH rules add power cards (SHIELD blocks a snake, DOUBLE
 * rolls two dice, SWAP trades places with the leader) picked up on star squares. Five themed boards with their own
 * layouts unlock with stars or coins. Rewarded: re-roll or shield when a snake bites, double coins, boosts.
 */

const hex = (v: number) => Pal.hex(v);
const Gold = hex(0xffc93c), Ink = hex(0x241a3a), Purple = hex(0x8e6cff);
const ModeNames = ["VS CPU", "PASS & PLAY", "SOLO DASH"];
enum Mode { Cpu, Local, Solo }
const TopBandP = 300, BottomBandP = 40, TopBandL = 210, BottomBandL = 30;

class Token {
  sr!: SpriteRenderer;
  pos = V2.zero;
  lift = 0;
  squash = 0;
  constructor(readonly p: Player) {}
}

interface SnakeView { head: SpriteRenderer; eyes: SpriteRenderer; tongue: SpriteRenderer; pts: V2[]; body: MeshRenderer; flick: number; gulp: number }

export class SnakesLaddersGame extends ArcadeGame {
  private world!: GameObject;
  private boardRoot!: GameObject;
  private cover!: SpriteRenderer;
  private fx!: CasualFx;
  private dice!: Dice3D;
  private diceShadow!: SpriteRenderer;
  private diceGlow!: SpriteRenderer;
  private diceLabel!: TextMesh;
  private rng = new SysRandom();

  private theme = 0;
  private builtTheme = -1;
  private layout: Layout = makeLayout(0);
  private rules = new Rules(this.layout);
  private players: Player[] = [];
  private tokens: Token[] = [];
  private snakes: SnakeView[] = [];
  private badges: SpriteRenderer[] = [];
  private mode = Mode.Cpu;
  private dash = true;
  private turn = 0;
  private winner: Player | null = null;
  private awaitingRoll = false;
  private rollPressed = false;
  private pendingCard = -1;
  private doubleNow = false;
  private adPrompts = 0;
  private sixes = 0;
  private dicePos = V2.zero;
  private boardCenter = V2.zero;
  private rot = false;
  private diceT = 1;
  private diceFrom = V2.zero;
  private matchRoutine: ReturnType<SnakesLaddersGame["startCoroutine"]> | null = null;
  private choice = -1;

  // HUD
  private chips: { node: UINode; bg: Image; pawn: Image; name: Text; sq: Text }[] = [];
  private status!: Text;
  private cardButtons: ArcadeButton[] = [];
  private cardIcons: Image[] = [];
  private modeButton!: ArcadeButton; private playersButton!: ArcadeButton; private rulesButton!: ArcadeButton; private boardButton!: ArcadeButton;
  private titleInfo!: Text;
  private picker!: CanvasGroup;
  private pickerRows: { button: ArcadeButton; name: Text; info: Text; swatches: Image[] }[] = [];
  private pickerCoins!: Text;

  private hopClip!: AudioClip; private rattleClip!: AudioClip; private landClip!: AudioClip; private climbClip!: AudioClip;
  private hissClip!: AudioClip; private cardClip!: AudioClip; private blockClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "snakesladders",
      Title: "SNAKES & LADDERS",
      Tagline: "ROLL. RACE. CLIMB AND SLIDE!",
      PlayLabel: "PLAY",
      Accent: hex(0x37c96b),
      Accent2: Gold,
      BgTop: hex(0x7fd36a),
      BgBottom: hex(0x23714a),
      ShortSide: 14,
      Touch: TouchScheme.None,
      Music: { bpm: 112, rootHz: 130.8, degrees: [0, 3, 4, 3], seed: 88, energy: 0.45, major: true },
      Reminders: [
        "The dice are waiting|Race to square 100 in Snakes & Ladders Dash.",
        "Watch out for the snakes!|Can you climb to the top first?",
        "New board unlocked?|Collect stars to open the Starry Night board.",
      ],
      HowTo: [
        howTo(SnakesArt.Pawn, PlayerColors[0], "TAP THE DICE to roll. Your pawn hops forward that many squares."),
        howTo(Art.Chevron, Gold, "Land at the foot of a LADDER to climb up. Land on a SNAKE's head and slide down its tail."),
        howTo(Art.Star, Gold, "First to reach square 100 wins (no exact roll needed). A 6 gives you another roll."),
        howTo(SnakesArt.Icon(0), hex(0x5cc8ff), "DASH rules: star squares give power cards. SHIELD blocks the next snake."),
        howTo(SnakesArt.Icon(1), hex(0xff8a4a), "DOUBLE rolls two dice this turn. SWAP trades places with the leader. Tap a card before you roll."),
        howTo(SnakesArt.Pawn, PlayerColors[1], "Play VS CPU, PASS & PLAY with up to 4 friends, or SOLO DASH: reach 100 in the fewest rolls."),
        howTo(Art.RoundSquare, Purple, "Win stars and coins to unlock new boards with new snakes and ladders."),
      ],
      Tips: [
        "Save SWAP for when the leader is far ahead.",
        "DOUBLE is best early: big rolls, big jumps.",
        "Square 100 is close... and so are the biggest snakes.",
        "A six rolls again: keep your fingers crossed!",
      ],
    });
  }

  protected get ShortSide() {
    const rot = Screen.width > Screen.height * 1.05;
    const need = rot ? new V2(15.6, 11.1) : new V2(11.1, 14.9);
    return SnakesLaddersGame.FitShortSide(need, rot ? TopBandL : TopBandP, rot ? BottomBandL : BottomBandP);
  }

  // ------------------------------------------------------------------ data

  private get Coins() { return this.Data.get("coins", 0); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }
  private get Rerolls() { return this.Data.get("rr", 1); }
  private set Rerolls(v: number) { this.Data.set("rr", Math.max(0, v)); }
  private get Shields() { return this.Data.get("sh", 0); }
  private set Shields(v: number) { this.Data.set("sh", Math.max(0, v)); }
  private TotalStars() { let s = 0; for (let i = 0; i < Themes.length; i++) s += this.Data.get("s" + i); return s; }
  private Owns(i: number) { return i === 0 || this.Data.get("own" + i) === 1 || this.TotalStars() >= Themes[i].stars; }
  private get ModeSetting() { return Mathf.clamp(this.Data.get("mode", 0), 0, 2) as Mode; }
  private get PlayersSetting() { return Mathf.clamp(this.Data.get("players", 2), 2, 4); }

  protected BestLine() {
    const m = this.ModeSetting;
    if (m === Mode.Solo) { const b = this.Data.get("best"); return b > 0 ? `SOLO BEST: ${b} ROLLS` : "SOLO DASH: REACH 100 IN THE FEWEST ROLLS"; }
    if (m === Mode.Local) return `PASS & PLAY  ·  ${this.PlayersSetting} PLAYERS  ·  ${Themes[this.Data.get("theme", 0)].name}`;
    return `VS CPU:  ${this.Data.get("wins")} WON  ·  ${this.Data.get("losses")} LOST`;
  }

  protected StatsLine() { return `★ ${this.TotalStars()} STARS   ·   ◉ ${Fmt.n(this.Coins)} COINS   ·   RE-ROLLS ${this.Rerolls}   ·   SHIELDS ${this.Shields}`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("SnakesWorld", this.gameObject);
    CasualLook.calm(this, 1.3, 0.14);
    this.cover = CasualLook.cover(this.world, SnakesArt.Back(0), -910);
    this.boardRoot = new GameObject("Board", this.world);
    this.fx = CasualFx.create(this.world, 70, 220);
    this.diceShadow = Art.spr(this.world, "DiceShadow", CasualArt.Soft, new Color(0, 0, 0, 0.35), 1.6, 38, Art.Flat);
    this.diceGlow = Art.spr(this.world, "DiceGlow", CasualArt.Soft, new Color(1, 1, 1, 0), 3.2, 37, Art.Flat);
    this.dice = new Dice3D(this.world, 40, 1.25);
    this.diceLabel = new GameObject("DiceLabel", this.world).addComponent(new TextMesh());
    this.diceLabel.fontSize = 34;
    this.diceLabel.characterSize = 0.08;
    this.diceLabel.sortingOrder = 41;
    this.BuildAudio();
    this.BuildHud();
    this.BuildTitleExtras();
    this.BuildPicker();
    const center = this.UI.TitleExtra?.parent;
    for (const c of center?.children ?? []) if (c.textC && c.textC.text === this.Info.Title) c.textC.fontSize = 100;
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__snakesladders = this;
    this.Layout();
  }

  private BuildAudio() {
    const S = Sfx, rng = new SysRandom(4);
    this.hopClip = S.make("sl-hop", 0.1, (t) => S.sinP(S.glide(t, 520, 880, 0.08)) * S.env(t, 0.002, 0.07) * 0.2);
    this.rattleClip = S.make("sl-rattle", 0.5, (t) => {
      const k = Math.floor(t / 0.045), lt = t - k * 0.045;
      return ((rng.nextDouble() * 2 - 1) * 0.5 + S.sinP((900 + (k % 3) * 260) * lt)) * S.env(lt, 0.001, 0.02) * 0.2;
    });
    this.landClip = S.make("sl-land", 0.18, (t) => (S.sinP(S.glide(t, 300, 120, 0.15)) * 0.8 + (rng.nextDouble() * 2 - 1) * 0.3 * S.env(t, 0.001, 0.03)) * S.env(t, 0.002, 0.14) * 0.32);
    this.climbClip = S.make("sl-climb", 0.75, (t) => {
      let v = 0;
      const n = [392, 493.9, 587.3, 784, 987.8];
      for (let i = 0; i < n.length; i++) { const st = t - i * 0.1; if (st > 0) v += (S.sinP(n[i] * st) + 0.25 * S.triP(n[i] * 2 * st)) * S.env(st, 0.004, 0.25); }
      return v * 0.1;
    });
    let lp = 0;
    this.hissClip = S.make("sl-hiss", 0.9, (t) => {
      lp += ((rng.nextDouble() * 2 - 1) - lp) * 0.6;
      return (lp * 0.5 * S.env(t, 0.02, 0.5) + S.sinP(S.glide(t, 500, 120, 0.85)) * 0.35 * S.env(t, 0.01, 0.7)) * 0.25;
    });
    this.cardClip = S.make("sl-card", 0.5, (t) => (S.sinP(S.glide(t, 880, 1760, 0.3)) * 0.5 + S.sinP(1318 * t) * 0.3) * S.env(t, 0.004, 0.3) * 0.15);
    this.blockClip = S.make("sl-block", 0.4, (t) => (S.sqrP(660 * t) * 0.2 + S.sinP(1320 * t) * 0.5 + S.sinP(1980 * t) * 0.3) * S.env(t, 0.001, 0.25) * 0.2);
  }

  private BuildHud() {
    const hud = this.UI.Hud, C = UIKit.Center;
    for (let i = 0; i < 4; i++) {
      const node = UIKit.node("Chip", hud).place(new V2(0.5, 1), V2.zero, new V2(205, 104));
      const bg = UIKit.img(node, "Bg", Art.UiRound, new Color(0.05, 0.05, 0.12, 0.75));
      bg.rectTransform.stretch();
      const pawn = UIKit.img(node, "Pawn", SnakesArt.Pawn, PlayerColors[i]);
      pawn.rectTransform.place(new V2(0, 0.5), new V2(40, 0), new V2(54, 68));
      const name = UIKit.at(UIKit.label(node, "YOU", 26, Color.white, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(132, 18), new V2(130, 34));
      CasualLook.fit(name, 16);
      const sq = UIKit.at(UIKit.label(node, "START", 30, Gold, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(132, -20), new V2(130, 38));
      this.chips.push({ node, bg, pawn, name, sq });
    }
    this.status = UIKit.at(UIKit.label(hud, "", 36, Color.white), new V2(0.5, 1), new V2(0, -182), new V2(980, 50));
    UIKit.glow(this.status, Ink, 4);
    CasualLook.fit(this.status, 22);
    for (let i = 0; i < 2; i++) {
      const idx = i;
      const b = UIKit.buttonAt(hud, "CARD", new V2(0.5, 0), new V2(i === 0 ? -340 : 340, 150), new V2(270, 150), false, () => this.UseCard(idx), 26);
      if (b.label) b.label.rectTransform.place(new V2(0.5, 0), new V2(0, 32), new V2(260, 34));
      const icon = UIKit.img(b.node, "Icon", SnakesArt.Icon(0), Color.white);
      icon.rectTransform.place(C, new V2(0, 22), new V2(64, 64));
      this.cardButtons.push(b);
      this.cardIcons.push(icon);
    }
  }

  private BuildTitleExtras() {
    if (!this.UI.TitleExtra) return;
    CasualLook.titleCard(this.UI, new Color(0.08, 0.16, 0.12, 0.7));
    const ex = this.UI.TitleExtra, C = UIKit.Center;
    const mk = (x: number, f: () => void, col: Color) => { const b = UIKit.buttonAt(ex, "MODE", C, new V2(x, 8), new V2(238, 100), false, f, 26); b.setAccent(col); if (b.label) CasualLook.fit(b.label, 16); return b; };
    this.modeButton = mk(-375, () => this.Cycle("mode"), PlayerColors[1]);
    this.playersButton = mk(-125, () => this.Cycle("players"), PlayerColors[2]);
    this.rulesButton = mk(125, () => this.Cycle("rules"), Gold);
    this.boardButton = mk(375, () => this.OpenPicker(), Purple);
    this.titleInfo = UIKit.at(UIKit.label(ex, "", 24, new Color(1, 1, 1, 0.82)), C, new V2(0, -66), new V2(980, 34));
    this.RefreshTitle();
  }

  private RefreshTitle() {
    if (!this.modeButton) return;
    const m = this.ModeSetting, n = this.PlayersSetting, dash = this.Data.get("rules", 1) === 1;
    set(this.modeButton.label, ModeNames[m]);
    set(this.playersButton.label, m === Mode.Solo ? "1 PLAYER" : m === Mode.Cpu ? `${n - 1} CPU${n > 2 ? "S" : ""}` : `${n} PLAYERS`);
    this.playersButton.interactable = m !== Mode.Solo;
    set(this.rulesButton.label, dash ? "DASH CARDS" : "CLASSIC");
    set(this.boardButton.label, Themes[this.Data.get("theme", 0)].name);
    this.titleInfo.text = m === Mode.Cpu ? `YOU VS ${n - 1} COMPUTER PLAYER${n > 2 ? "S" : ""}  ·  ${dash ? "POWER CARDS ON" : "CLASSIC RULES"}`
      : m === Mode.Local ? `${n} PLAYERS PASS THE PHONE  ·  ${dash ? "POWER CARDS ON" : "CLASSIC RULES"}` : "RACE THE BOARD ALONE  ·  FEWEST ROLLS WINS STARS";
  }

  private Cycle(what: string) {
    if (what === "mode") this.Data.set("mode", (this.ModeSetting + 1) % 3);
    else if (what === "players") this.Data.set("players", this.PlayersSetting >= 4 ? 2 : this.PlayersSetting + 1);
    else this.Data.set("rules", this.Data.get("rules", 1) === 1 ? 0 : 1);
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  // ------------------------------------------------------------------ board picker

  private BuildPicker() {
    this.picker = UIKit.layer("BoardPicker", UI.root!);
    UIKit.dim(this.picker.node, 0.8);
    const card = UIKit.card(this.picker.node, new V2(940, 1040), Purple);
    const C = UIKit.Center;
    UIKit.at(UIKit.label(card, "BOARDS", 54, Color.white), C, new V2(0, 455), new V2(800, 70));
    this.pickerCoins = UIKit.at(UIKit.label(card, "", 30, Gold), C, new V2(0, 400), new V2(800, 40));
    for (let i = 0; i < Themes.length; i++) {
      const idx = i, y = 285 - i * 160;
      const row = UIKit.img(card, "Row", Art.UiRound, new Color(1, 1, 1, 0.06));
      row.rectTransform.place(C, new V2(0, y), new V2(880, 145));
      const sw: Image[] = [];
      for (let k = 0; k < 4; k++) {
        const s = UIKit.img(card, "Sw", Art.UiRound, k % 2 ? Themes[i].tileB : Themes[i].tileA);
        s.rectTransform.place(C, new V2(-385 + (k % 2) * 52, y + (k < 2 ? 26 : -26)), new V2(50, 50));
        sw.push(s);
      }
      const name = UIKit.at(UIKit.label(card, Themes[i].name, 36, Color.white, TextAnchor.MiddleLeft), C, new V2(-110, y + 22), new V2(380, 46));
      const info = UIKit.at(UIKit.label(card, "", 24, Pal.TextDim, TextAnchor.MiddleLeft), C, new V2(-110, y - 24), new V2(380, 34));
      const button = UIKit.buttonAt(card, "PLAY", C, new V2(300, y), new V2(250, 100), false, () => this.PickerAction(idx), 28);
      this.pickerRows.push({ button, name, info, swatches: sw });
    }
    UIKit.buttonAt(card, "CLOSE", C, new V2(0, -455), new V2(320, 96), true, () => this.ClosePicker(), 40).setAccent(Purple);
  }

  private OpenPicker() {
    this.RefreshPicker();
    const g = this.picker;
    g.node.setActive(true);
    g.node.setAsLastSibling();
    g.alpha = 1; g.blocksRaycasts = true; g.interactable = true;
    Sfx.play(Snd.Click, 0.6);
  }

  private ClosePicker() {
    const g = this.picker;
    g.alpha = 0; g.blocksRaycasts = false; g.interactable = false;
    g.node.setActive(false);
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private RefreshPicker() {
    this.pickerCoins.text = `★ ${this.TotalStars()} STARS   ·   ◉ ${Fmt.n(this.Coins)} COINS`;
    const cur = this.Data.get("theme", 0);
    for (let i = 0; i < Themes.length; i++) {
      const r = this.pickerRows[i], t = Themes[i], own = this.Owns(i);
      r.info.text = own ? `★ BEST ${this.Data.get("s" + i)} / 3` : `UNLOCK: ★${t.stars} OR ◉${t.coins}`;
      set(r.button.label, i === cur ? "SELECTED" : own ? "PLAY HERE" : `BUY ◉${t.coins}`);
      r.button.setAccent(i === cur ? Pal.Good : own ? Purple : Gold);
      r.button.interactable = i !== cur && (own || this.Coins >= t.coins);
    }
  }

  private PickerAction(i: number) {
    if (!this.Owns(i)) {
      if (this.Coins < Themes[i].coins) { Sfx.play(Snd.Deny, 0.6); return; }
      this.Coins = this.Coins - Themes[i].coins;
      this.Data.set("own" + i, 1);
      Sfx.play(Snd.Coin, 0.8);
      this.UI.Toast(Themes[i].name + " UNLOCKED!", 2);
    }
    this.Data.set("theme", i);
    this.LoadTheme(i);
    this.RefreshPicker();
  }

  private get PickerOpen() { return this.picker?.node.activeSelf ?? false; }

  // ------------------------------------------------------------------ board visuals

  private CellPos(sq: number) {
    const [c, r] = cellOf(Mathf.clamp(sq, 1, 100));
    const local = new V2(c - 4.5, r - 4.5);
    return this.boardCenter.add(local);
  }

  private LoadTheme(theme: number) {
    this.theme = theme;
    this.layout = makeLayout(theme);
    this.rules = new Rules(this.layout);
    this.cover.sprite = CasualArt.hd(SnakesArt.Back(theme));
    this.BuildBoard();
  }

  private BuildBoard() {
    for (const c of [...this.boardRoot.children]) c.destroy();
    this.snakes = [];
    this.badges = [];
    this.builtTheme = this.theme;
    const th = Themes[this.theme], bc = this.boardCenter;
    const shadow = Art.spr(this.boardRoot, "Shadow", CasualArt.Soft, new Color(0, 0, 0, 0.35), 15, -30, Art.Flat);
    shadow.transform.localPosition = bc.add(new V2(0.2, -0.5));
    const frame = Art.spr(this.boardRoot, "Frame", SnakesArt.Frame, th.frame, 10.9, -20, Art.Flat);
    frame.transform.localPosition = bc;
    for (let sq = 1; sq <= 100; sq++) {
      const [c, r] = cellOf(sq), p = this.CellPos(sq);
      const col = (c + r) % 2 === 0 ? th.tileA : th.tileB;
      const tile = Art.spr(this.boardRoot, "Tile", SnakesArt.Tile, sq === 100 ? Gold : col, 0.98, -10, Art.Flat);
      tile.transform.localPosition = p;
      if (sq === 100) {
        const st = Art.spr(this.boardRoot, "Goal", CasualArt.StarShape, Color.white.withAlpha(0.9), 0.62, -9, Art.Flat);
        st.transform.localPosition = p;
      }
      const tm = new GameObject("Num", this.boardRoot).addComponent(new TextMesh());
      tm.text = sq === 1 ? "START" : String(sq);
      tm.fontSize = sq === 1 ? 20 : 26;
      tm.characterSize = 0.08;
      tm.color = sq === 100 ? hex(0x6b3d00) : th.ink.withAlpha(0.75);
      tm.sortingOrder = -8;
      tm.transform.localPosition = sq === 1 || sq === 100 ? p.add(new V2(0, sq === 100 ? -0.3 : 0.3)) : p.add(new V2(-0.24, 0.26));
    }
    for (const c of this.layout.cards) {
      const b = Art.spr(this.boardRoot, "Badge", SnakesArt.CardBadge, Color.white, 0.5, -7, Art.Flat);
      b.transform.localPosition = this.CellPos(c);
      this.badges.push(b);
    }
    for (const l of this.layout.ladders) {
      const mr = Art.meshObject(this.boardRoot, "Ladder", ladderMesh(this.CellPos(l.from), this.CellPos(l.to), th.ladder), Art.Flat, 2);
      void mr;
    }
    this.layout.snakes.forEach((s, i) => {
      const pts = snakePath(this.CellPos(s.from), this.CellPos(s.to), i * 7 + this.theme);
      const [a, b] = th.snakes[i % th.snakes.length];
      const body = Art.meshObject(this.boardRoot, "Snake", snakeMesh(pts, a, b, i), Art.Flat, 5 + i);
      const dir = pts[0].sub(pts[3]).normalized, ang = Math.atan2(dir.y, dir.x) * Mathf.Rad2Deg;
      const tongue = Art.spr(this.boardRoot, "Tongue", SnakesArt.Tongue, Color.white, 0.36, 5 + i, Art.Flat);
      const head = Art.spr(this.boardRoot, "Head", SnakesArt.Head, a, 0.56, 5 + i, Art.Flat);
      const eyes = Art.spr(this.boardRoot, "Eyes", SnakesArt.Eyes, Color.white, 0.56, 5 + i, Art.Flat);
      for (const sr of [head, eyes]) { sr.transform.localPosition = pts[0].add(dir.mul(0.06)); sr.transform.localEulerZ = ang; }
      tongue.transform.localPosition = pts[0].add(dir.mul(0.3));
      tongue.transform.localEulerZ = ang;
      this.snakes.push({ head, eyes, tongue, pts, body, flick: this.rng.nextDouble() * 3, gulp: 0 });
    });
    for (const b of this.badges) b.gameObject.setActive(this.dash || this.State === Phase.Title);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.rot = Screen.width > Screen.height * 1.05;
    const r = this.PlayRect(this.rot ? TopBandL : TopBandP, this.rot ? BottomBandL : BottomBandP, 0.2);
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.cover, this.ViewSize, V2.zero);
    let bc: V2;
    if (this.rot) {
      bc = new V2(Math.max(r.xMin + 5.55, -this.ViewSize.x / 2 + 5.8), r.center.y);
      this.dicePos = new V2((bc.x + 5.45 + r.xMax) / 2, r.center.y - 0.3);
    } else {
      bc = new V2(0, r.yMax - 5.55);
      this.dicePos = new V2(0, Math.max(bc.y - 7.6, (bc.y - 5.45 + r.yMin) / 2 + 0.6));
    }
    const moved = !bc.equals(this.boardCenter) || this.builtTheme !== this.theme;
    this.boardCenter = bc;
    if (moved && this.builtTheme >= 0) this.BuildBoard();
    for (const t of this.tokens) t.pos = this.TokenSpot(t.p);
    if (this.cardButtons.length) {
      for (let i = 0; i < 2; i++) {
        if (this.rot) this.cardButtons[i].node.place(new V2(1, 0), new V2(-190, 300 - i * 175), new V2(270, 150));
        else this.cardButtons[i].node.place(new V2(0.5, 0), new V2(i === 0 ? -350 : 350, 165), new V2(270, 150));
      }
    }
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.StopMatch();
    this.theme = Mathf.clamp(this.Data.get("theme", 0), 0, Themes.length - 1);
    if (!this.Owns(this.theme)) this.theme = 0;
    this.LoadTheme(this.theme);
    this.SetupPlayers(4, Mode.Cpu, true);
    this.RefreshTitle();
    this.dice.show(1 + this.rng.next(6));
  }

  /** Test hooks (dev only). */
  testState() {
    const sp = Camera.worldToScreen(this.dicePos);
    return { state: this.State, turn: this.turn, awaiting: this.awaitingRoll, pos: this.players.map((p) => p.pos), cards: this.players.map((p) => p.cards.map((c) => CardNames[c])), winner: this.winner?.seat ?? -1, dice: { x: sp.x / Screen.dpr, y: sp.y / Screen.dpr }, choice: this.UI.ChoiceOpen };
  }
  testSpeed(k: number) { this.SpeedMultiplier = k; }

  private StopMatch() {
    this.stopAllCoroutines();
    this.matchRoutine = null;
    this.awaitingRoll = false;
  }

  private SetupPlayers(n: number, mode: Mode, attract = false) {
    for (const t of this.tokens) t.sr.gameObject.destroy();
    this.tokens = [];
    this.players = [];
    for (let i = 0; i < n; i++) {
      const human = !attract && (mode === Mode.Local || i === 0);
      const p = new Player(i, human);
      this.players.push(p);
      const tk = new Token(p);
      tk.sr = Art.spr(this.world, "Pawn", SnakesArt.Pawn, PlayerColors[i], 0.66, 30 + i, Art.Flat);
      tk.pos = this.TokenSpot(p);
      this.tokens.push(tk);
    }
  }

  /** Where a player's pawn stands: on its square, spread out when several share it; off-board left of 1 at start. */
  private TokenSpot(p: Player) {
    if (p.pos <= 0) {
      const base = this.CellPos(1);
      return base.add(new V2(-0.3 + (p.seat % 2) * 0.6, -0.92 - Math.floor(p.seat / 2) * 0.0 + (p.seat >= 2 ? -0.32 : 0)));
    }
    const same = this.players.filter((o) => o.pos === p.pos);
    const k = same.indexOf(p), n = same.length;
    const off = n <= 1 ? V2.zero : [new V2(-0.2, 0.12), new V2(0.2, 0.12), new V2(-0.2, -0.14), new V2(0.2, -0.14)][k % 4];
    return this.CellPos(p.pos).add(off);
  }

  protected BeginRun() {
    this.ClosePickerSilently();
    this.StopMatch();
    this.mode = this.ModeSetting;
    this.dash = this.Data.get("rules", 1) === 1;
    const n = this.mode === Mode.Solo ? 1 : this.PlayersSetting;
    this.theme = Mathf.clamp(this.Data.get("theme", 0), 0, Themes.length - 1);
    if (!this.Owns(this.theme)) this.theme = 0;
    this.LoadTheme(this.theme);
    this.SetupPlayers(n, this.mode);
    this.winner = null;
    this.turn = 0;
    this.adPrompts = 0;
    this.sixes = 0;
    this.fx.clear();
    // stored shield (from a rewarded ad) goes into your hand
    const me = this.players[0];
    if (this.Shields > 0 && this.mode !== Mode.Local) { this.Shields = this.Shields - 1; me.cards.push(Card.Shield); this.UI.Toast("Your SHIELD is ready: it blocks the next snake!", 3); }
    this.Data.add("games", 1);
    Sfx.setIntensity(0.25);
    this.RefreshChips();
    this.RefreshCards();
    this.matchRoutine = this.startCoroutine(this.Match());
  }

  private ClosePickerSilently() {
    if (!this.PickerOpen) return;
    this.picker.alpha = 0; this.picker.blocksRaycasts = false; this.picker.interactable = false;
    this.picker.node.setActive(false);
  }

  protected TickBackground(dt: number) {
    if (this.State === Phase.Title) {
      if (this.PickerOpen && Keyboard.escape.wasPressedThisFrame) this.ClosePicker();
      // attract: the pawns race on their own behind the title
      if (!this.matchRoutine) { this.matchRoutine = this.startCoroutine(this.Match()); }
    }
    this.Animate(dt);
  }

  protected TickRun(dt: number) {
    if (this.awaitingRoll) {
      const roll = this.Controls.actionPressed || Keyboard.enter.wasPressedThisFrame || this.TappedDice();
      if (roll) this.rollPressed = true;
      if (Keyboard.digit(1).wasPressedThisFrame) this.UseCard(0);
      if (Keyboard.digit(2).wasPressedThisFrame) this.UseCard(1);
    }
    this.Animate(dt);
  }

  private TappedDice() {
    const hit = (screen: V2) => !overUI(screen) && V2.distance(this.ScreenToWorld(screen), this.dicePos) < 1.6;
    if (Touchscreen.present) for (const t of Touchscreen.touches) if (t.press.wasPressedThisFrame && hit(t.position)) return true;
    if (Mouse.present && Mouse.leftButton.wasPressedThisFrame && hit(Mouse.position)) return true;
    // anywhere on the lower part of the screen works too (big thumb target)
    if (this.Controls.tapped && !overUI(this.Controls.tapScreen)) {
      const w = this.ScreenToWorld(this.Controls.tapScreen);
      if (this.rot ? w.x > this.boardCenter.x + 5.6 : w.y < this.boardCenter.y - 5.6) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ match flow (coroutines)

  private get Attract() { return this.State !== Phase.Playing; }

  private *Match(): Generator<ReturnType<typeof wait> | undefined, void, unknown> {
    while (!this.winner) {
      const p = this.players[this.turn];
      const again: boolean = yield* this.Turn(p);
      if (this.winner) break;
      if (!again) { this.turn = (this.turn + 1) % this.players.length; this.sixes = 0; }
      yield wait(this.Attract ? 0.35 : 0.25);
    }
    if (this.Attract) {
      yield wait(2);
      for (const pl of this.players) { pl.pos = 0; pl.cards = []; }
      this.winner = null;
      this.matchRoutine = null;
      return;
    }
    yield wait(1.6);
    this.End();
  }

  private *Turn(p: Player): Generator<ReturnType<typeof wait> | undefined, boolean, unknown> {
    const human = p.human && !this.Attract;
    this.RefreshChips();
    this.RefreshCards();
    this.doubleNow = false;
    this.pendingCard = -1;
    let reroll = true;
    const start = p.pos;
    let extra = false;
    while (reroll) {
      reroll = false;
      if (human) {
        this.SetStatus(this.mode === Mode.Local ? `${PlayerNames[p.seat]}'S TURN  ·  TAP THE DICE!` : "YOUR TURN  ·  TAP THE DICE!", PlayerColors[p.seat]);
        this.awaitingRoll = true;
        this.rollPressed = false;
        this.RefreshCards();
        while (!this.rollPressed) {
          if (this.pendingCard >= 0) { const c = this.pendingCard; this.pendingCard = -1; yield* this.PlayCard(p, c); this.RefreshCards(); }
          yield;
        }
        this.awaitingRoll = false;
        this.RefreshCards();
      } else {
        if (!this.Attract) this.SetStatus(`${this.NameOf(p)} IS ROLLING…`, PlayerColors[p.seat]);
        yield wait(this.Attract ? 0.2 : 0.45);
        if (this.dash) {
          const c = this.rules.cpuCard(p, this.players);
          if (c >= 0) { yield* this.PlayCard(p, c); yield wait(0.3); }
        }
      }
      let roll = 1 + this.rng.next(6);
      const r1 = roll, usedDouble = this.doubleNow;
      yield* this.RollDice(roll, p);
      if (this.doubleNow) {
        const r2 = 1 + this.rng.next(6);
        yield wait(0.15);
        yield* this.RollDice(r2, p);
        roll = r1 + r2;
        if (!this.Attract) this.UI.Float(this.dicePos.add(new V2(0, 1.4)), `${r1} + ${r2} = ${roll}`, Gold, 1.1);
        this.doubleNow = false;
      }
      p.rolls++;
      extra = r1 === 6 && !usedDouble;
      yield* this.Hop(p, this.rules.path(p.pos, roll));
      if (p.pos >= 100) { yield* this.Win(p); return false; }
      // star square: a power card
      if (this.dash && this.rules.isCard(p.pos) && p.cards.length < 2) {
        const card = [Card.Shield, Card.Double, Card.Swap][this.rng.next(3)] as Card;
        p.cards.push(card);
        Sfx.playClip(this.cardClip, this.Attract ? 0.2 : 0.8);
        this.fx.sparkle(this.CellPos(p.pos), Gold, 8, 0.5, 0.32);
        if (!this.Attract) this.UI.Float(this.CellPos(p.pos).add(new V2(0, 0.8)), "+ " + CardNames[card], hex(0xd6b8ff), 0.9);
        this.RefreshCards();
        yield wait(0.35);
      }
      const ladder = this.rules.ladderAt(p.pos);
      if (ladder) { yield* this.Climb(p, ladder.to); if (p.pos >= 100) { yield* this.Win(p); return false; } }
      const snake = this.rules.snakeAt(p.pos);
      if (snake) {
        const si = this.layout.snakes.indexOf(snake);
        const sh = p.cards.indexOf(Card.Shield);
        if (sh >= 0) {
          p.cards.splice(sh, 1);
          yield* this.Block(p);
        } else {
          let action = 0;
          if (human && snake.from - snake.to >= 6) action = yield* this.SnakePrompt(p, snake.from - snake.to);
          if (action === 1) { // re-roll
            this.UI.Announce("RE-ROLL!", Gold, 0.9);
            yield* this.Teleport(p, start);
            reroll = true;
            continue;
          } else if (action === 2) yield* this.Block(p);
          else yield* this.Slide(p, si);
        }
      }
      if (this.players.length > 1 && extra && !this.winner) {
        if (!this.Attract) this.UI.Announce("SIX! ROLL AGAIN", PlayerColors[p.seat], 0.9);
        this.sixes++;
        if (this.sixes >= 3) extra = false;
      }
    }
    this.RefreshChips();
    return extra;
  }

  private *RollDice(value: number, p: Player): Generator<ReturnType<typeof wait> | undefined, void, unknown> {
    const th = this.Attract ? 0.55 : 0.85;
    this.dice.body = Color.lerp(Color.white, PlayerColors[p.seat], 0.12);
    this.dice.roll(value, th);
    this.diceT = 0;
    this.diceFrom = this.dicePos.add(this.rot ? new V2(0, 2.5) : new V2(-2.2, 0.4));
    Sfx.playClip(this.rattleClip, this.Attract ? 0.12 : 0.6, 0.9 + this.rng.nextDouble() * 0.2);
    let t = 0;
    while (t < th) { t += Time.deltaTime; this.diceT = Mathf.clamp01(t / th); yield; }
    this.diceT = 1;
    Sfx.playClip(this.landClip, this.Attract ? 0.15 : 0.7);
    if (!this.Attract) {
      this.fx.pop(this.dicePos.add(new V2(0, -0.5)), Color.white, 8, 2.5, 0.18, 0.4);
      this.UI.Float(this.dicePos.add(new V2(0, 1.2)), String(value), PlayerColors[p.seat], 1.3);
      if (value === 6) this.Fx.shake(0.06);
    }
    yield wait(this.Attract ? 0.1 : 0.22);
  }

  private *Hop(p: Player, path: number[]): Generator<ReturnType<typeof wait> | undefined, void, unknown> {
    const tk = this.tokens[p.seat];
    const per = this.Attract ? 0.12 : 0.15;
    for (let i = 0; i < path.length; i++) {
      const from = tk.pos;
      p.pos = path[i];
      const to = this.TokenSpot(p);
      let t = 0;
      while (t < per) {
        t += Time.deltaTime;
        const k = Mathf.clamp01(t / per);
        tk.pos = V2.lerp(from, to, k);
        tk.lift = Math.sin(k * Math.PI) * 0.42;
        yield;
      }
      tk.lift = 0;
      tk.squash = 1;
      Sfx.playClip(this.hopClip, this.Attract ? 0.12 : 0.55, 1 + i * 0.07);
      this.RefreshChips();
    }
    for (const t of this.tokens) t.pos = this.TokenSpot(t.p);
  }

  private *Climb(p: Player, to: number): Generator<ReturnType<typeof wait> | undefined, void, unknown> {
    const tk = this.tokens[p.seat];
    const a = tk.pos, b = this.CellPos(to);
    const dur = 0.45 + V2.distance(a, b) * 0.06;
    Sfx.playClip(this.climbClip, this.Attract ? 0.15 : 0.8);
    if (!this.Attract) this.UI.Float(a.add(new V2(0, 0.8)), "LADDER!", Pal.Good, 1);
    p.climbs++;
    let t = 0;
    while (t < dur) {
      t += Time.deltaTime;
      const k = Ease.inOutCubic(Mathf.clamp01(t / dur));
      tk.pos = V2.lerp(a, b, k);
      tk.lift = Math.abs(Math.sin(k * Math.PI * 6)) * 0.1;
      yield;
    }
    p.pos = to;
    tk.lift = 0;
    tk.squash = 1;
    for (const t2 of this.tokens) t2.pos = this.TokenSpot(t2.p);
    this.fx.sparkle(b, Gold, 7, 0.5, 0.3);
    this.RefreshChips();
  }

  private *Slide(p: Player, si: number): Generator<ReturnType<typeof wait> | undefined, void, unknown> {
    const sv = this.snakes[si], snake = this.layout.snakes[si];
    const tk = this.tokens[p.seat];
    p.bites++;
    sv.gulp = 1;
    Sfx.playClip(this.hissClip, this.Attract ? 0.15 : 0.8);
    if (!this.Attract) { this.UI.Float(tk.pos.add(new V2(0, 0.8)), "SNAKE!", hex(0xff6b6b), 1.1); this.Fx.shake(0.15); Fx.haptic(true); }
    yield wait(0.25);
    const pts = sv.pts, dur = 0.5 + pts.length * 0.012;
    let t = 0;
    while (t < dur) {
      t += Time.deltaTime;
      const k = Ease.inOutSine(Mathf.clamp01(t / dur)) * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(k));
      tk.pos = V2.lerp(pts[i], pts[i + 1], k - i);
      yield;
    }
    p.pos = snake.to;
    tk.squash = 1;
    for (const t2 of this.tokens) t2.pos = this.TokenSpot(t2.p);
    this.RefreshChips();
  }

  private *Block(p: Player): Generator<ReturnType<typeof wait> | undefined, void, unknown> {
    const pos = this.tokens[p.seat].pos;
    Sfx.playClip(this.blockClip, this.Attract ? 0.2 : 0.9);
    this.Fx.ring(pos, hex(0x7fd8ff), 0.3, 2.2, 0.5);
    this.fx.sparkle(pos, hex(0xbfefff), 8, 0.5, 0.3);
    if (!this.Attract) this.UI.Float(pos.add(new V2(0, 0.8)), "SHIELD BLOCK!", hex(0x7fd8ff), 1);
    this.RefreshCards();
    yield wait(0.45);
  }

  private *Teleport(p: Player, to: number): Generator<ReturnType<typeof wait> | undefined, void, unknown> {
    const tk = this.tokens[p.seat];
    this.fx.pop(tk.pos, PlayerColors[p.seat], 10, 3, 0.2, 0.4);
    p.pos = to;
    for (const t2 of this.tokens) t2.pos = this.TokenSpot(t2.p);
    tk.squash = 1;
    this.fx.pop(tk.pos, PlayerColors[p.seat], 10, 3, 0.2, 0.4);
    this.RefreshChips();
    yield wait(0.3);
  }

  /** A snake is about to bite a human: offer a re-roll or a shield (charges or a rewarded ad), or take the slide. */
  private *SnakePrompt(_p: Player, drop: number): Generator<ReturnType<typeof wait> | undefined, number, unknown> {
    const adOk = AdService.rewardedAvailable && this.adPrompts < 2;
    if (this.Rerolls <= 0 && !adOk) return 0;
    this.choice = -1;
    const cards = [
      { title: this.Rerolls > 0 ? `RE-ROLL  (×${this.Rerolls})` : "RE-ROLL  (WATCH AD)", body: "Go back and roll again.", color: Gold, icon: SnakesArt.Icon(1) },
      ...(adOk ? [{ title: "SHIELD  (WATCH AD)", body: "Block this snake and stay on your square.", color: hex(0x5cc8ff), icon: SnakesArt.Icon(0) }] : []),
      { title: "SLIDE DOWN", body: `Take the snake: down ${drop} squares.`, color: hex(0xff7a7a), icon: Art.Chevron },
    ];
    this.UI.ShowChoices("UH-OH, A SNAKE!", cards, (i) => { this.choice = i; });
    while (this.choice < 0) yield;
    const pick = cards[this.choice].title;
    if (pick.startsWith("RE-ROLL")) {
      if (this.Rerolls > 0) { this.Rerolls = this.Rerolls - 1; return 1; }
      return yield* this.WatchAd(1);
    }
    if (pick.startsWith("SHIELD")) return yield* this.WatchAd(2);
    return 0;
  }

  private *WatchAd(result: number): Generator<ReturnType<typeof wait> | undefined, number, unknown> {
    let done = false, ok = false;
    this.adPrompts++;
    AdService.showRewarded((e) => { ok = e; done = true; });
    while (!done) yield;
    return ok ? result : 0;
  }

  private *PlayCard(p: Player, idx: number): Generator<ReturnType<typeof wait> | undefined, void, unknown> {
    const card = p.cards[idx];
    if (card === undefined || card === Card.Shield) return;
    p.cards.splice(idx, 1);
    Sfx.playClip(this.cardClip, this.Attract ? 0.2 : 0.8);
    if (!this.Attract) this.UI.Announce(CardNames[card] + "!", card === Card.Double ? hex(0xff8a4a) : hex(0x9df07a), 0.9);
    if (card === Card.Double) { this.doubleNow = true; return; }
    // swap with the leader (the player furthest ahead of you)
    const lead = this.players.filter((o) => o !== p).reduce((a: Player | null, o) => (!a || o.pos > a.pos ? o : a), null);
    if (!lead || lead.pos <= p.pos) { if (!this.Attract) this.UI.Toast("Nobody is ahead of you: SWAP fizzles.", 2); return; }
    const a = this.tokens[p.seat], b = this.tokens[lead.seat];
    const pa = a.pos, pb = b.pos;
    let t = 0;
    while (t < 0.6) {
      t += Time.deltaTime;
      const k = Ease.inOutCubic(Mathf.clamp01(t / 0.6));
      a.pos = V2.lerp(pa, pb, k); b.pos = V2.lerp(pb, pa, k);
      a.lift = b.lift = Math.sin(k * Math.PI) * 0.8;
      yield;
    }
    [p.pos, lead.pos] = [lead.pos, p.pos];
    a.lift = b.lift = 0;
    for (const t2 of this.tokens) t2.pos = this.TokenSpot(t2.p);
    this.RefreshChips();
  }

  private UseCard(i: number) {
    if (this.State !== Phase.Playing || !this.awaitingRoll) return;
    const p = this.players[this.turn];
    const c = p.cards[i];
    if (c === undefined) return;
    if (c === Card.Shield) { this.UI.Toast("SHIELD works by itself: it blocks the next snake.", 2); return; }
    if (this.doubleNow && c === Card.Double) return;
    this.pendingCard = i;
  }

  private *Win(p: Player): Generator<ReturnType<typeof wait> | undefined, void, unknown> {
    p.finished = true;
    this.winner = p;
    const pos = this.CellPos(100);
    this.fx.confetti(pos.add(new V2(0, 0.5)), this.Attract ? 20 : 80, 8, [PlayerColors[p.seat], Gold, Color.white]);
    this.Fx.ring(pos, Gold, 0.3, 3, 0.6);
    if (!this.Attract) {
      const you = this.mode !== Mode.Local && p.seat === 0;
      this.UI.Announce(this.mode === Mode.Solo ? "FINISHED!" : you ? "YOU WIN!" : `${this.NameOf(p)} WINS!`, PlayerColors[p.seat], 1.5);
      Sfx.play(you || this.mode === Mode.Local || this.mode === Mode.Solo ? Snd.Win : Snd.Lose, 0.8);
      this.SetStatus("", Color.white);
    }
    yield wait(0.2);
  }

  private NameOf(p: Player) {
    if (this.mode === Mode.Local) return PlayerNames[p.seat];
    if (this.Attract) return PlayerNames[p.seat];
    return p.seat === 0 ? "YOU" : "CPU " + p.seat;
  }

  // ------------------------------------------------------------------ results

  private End() {
    const w = this.winner!, me = this.players[0];
    const th = this.theme;
    if (this.mode === Mode.Local) {
      this.Data.add("lw" + w.seat, 1);
      this.Finish(new Result({
        Headline: `${PlayerNames[w.seat]} WINS!`,
        HeadlineColor: PlayerColors[w.seat],
        Value: `IN ${w.rolls} ROLLS`,
        BestLine: `${this.players.length} PLAYERS  ·  ${Themes[th].name}`,
        Stats: this.players.slice(0, 4).map((p) => [PlayerNames[p.seat], p === w ? "100 ★" : String(p.pos)] as [string, string]),
        Primary: "REMATCH",
        Victory: true,
      }));
      return;
    }
    if (this.mode === Mode.Solo) {
      const rolls = me.rolls;
      const stars = rolls <= 14 ? 3 : rolls <= 20 ? 2 : 1;
      const prev = this.Data.get("best");
      const best = this.Data.min("best", rolls);
      this.Data.max("s" + th, stars);
      const coins = 10 + stars * 5;
      this.Coins = this.Coins + coins;
      this.Finish(new Result({
        Headline: "SOLO DASH DONE!",
        HeadlineColor: Gold,
        Value: `${rolls} ROLLS`,
        Stars: stars,
        NewBest: best && prev > 0,
        BestLine: `BEST ${this.Data.get("best")} ROLLS  ·  ${Themes[th].name}`,
        Stats: [["ROLLS", String(rolls)], ["LADDERS", String(me.climbs)], ["SNAKE BITES", String(me.bites)], ["COINS", "+" + coins]],
        Primary: "PLAY AGAIN",
        Victory: true,
        Reward: () => this.DoubleCoins(coins),
        RewardLabel: `DOUBLE COINS +${coins} ◉ (AD)`,
      }));
      return;
    }
    const won = w === me;
    let stars = 0, coins = 0;
    if (won) {
      stars = 1 + (me.rolls <= 20 ? 1 : 0) + (me.bites <= 1 ? 1 : 0);
      this.Data.max("s" + th, stars);
      this.Data.add("wins", 1);
      this.Data.add("streak", 1);
      coins = 15 + 10 * (this.players.length - 1) + stars * 5 + Math.min(20, (this.Data.get("streak") - 1) * 5);
      this.Coins = this.Coins + coins;
    } else { this.Data.add("losses", 1); this.Data.set("streak", 0); }
    this.Finish(new Result({
      Headline: won ? "YOU WIN!" : `${this.NameOf(w)} WINS`,
      HeadlineColor: won ? Gold : hex(0xffc0c0),
      Value: won ? "" : `${me.pos}/100`,
      Stars: won ? stars : -1,
      BestLine: `${Themes[th].name}  ·  ${this.Data.get("wins")} WINS  ·  STREAK ${this.Data.get("streak")}`,
      Stats: [["ROLLS", String(me.rolls)], ["LADDERS", String(me.climbs)], ["SNAKE BITES", String(me.bites)], ["COINS", won ? "+" + coins : "◉ " + Fmt.n(this.Coins)]],
      Primary: won ? "PLAY AGAIN" : "REMATCH",
      Victory: won,
      Reward: won ? () => this.DoubleCoins(coins) : () => { this.Rerolls = this.Rerolls + 1; this.Shields = this.Shields + 1; this.UI.Toast("+1 RE-ROLL & +1 SHIELD for your next game!", 2.5); Sfx.play(Snd.PowerUp, 0.8); },
      RewardLabel: won ? `DOUBLE COINS +${coins} ◉ (AD)` : "+1 RE-ROLL & +1 SHIELD (AD)",
    }));
  }

  private DoubleCoins(coins: number) {
    this.Coins = this.Coins + coins;
    this.UI.Toast(`+${coins} COINS!`, 2);
    Sfx.play(Snd.Coin, 0.8);
  }

  // ------------------------------------------------------------------ HUD

  private SetStatus(s: string, c: Color) { set(this.status, s); this.status.color = Color.lerp(c, Color.white, 0.55); }

  private RefreshChips() {
    const n = this.players.length;
    for (let i = 0; i < 4; i++) {
      const c = this.chips[i];
      const on = i < n && this.State !== Phase.Title;
      c.node.setActive(on);
      if (!on) continue;
      const p = this.players[i];
      const x = -55 + (i - (n - 1) / 2) * 215;
      const cur = i === this.turn;
      c.node.place(new V2(0.5, 1), new V2(x, -78), new V2(205, 104));
      c.node.localScale = cur ? new V3(1.08, 1.08, 1) : V3.one;
      c.bg.color = cur ? Color.lerp(PlayerColors[i], Color.black, 0.35).withAlpha(0.92) : new Color(0.05, 0.05, 0.12, 0.7);
      set(c.name, this.NameOf(p));
      set(c.sq, p.pos <= 0 ? "START" : p.pos >= 100 ? "100 ★" : "SQ " + p.pos);
    }
  }

  private RefreshCards() {
    const p = this.players[this.turn];
    const show = this.State === Phase.Playing && !!p && p.human;
    for (let i = 0; i < 2; i++) {
      const b = this.cardButtons[i];
      const c = show ? p.cards[i] : undefined;
      b.node.setActive(show && (this.dash || c !== undefined));
      if (!b.node.activeSelf) continue;
      if (c === undefined) {
        set(b.label, this.dash ? "EMPTY" : "");
        this.cardIcons[i].color = new Color(1, 1, 1, 0.15);
        this.cardIcons[i].sprite = SnakesArt.CardBadge;
        b.setAccent(Pal.TextDim);
        b.interactable = false;
      } else {
        set(b.label, CardNames[c] + (c === Card.Shield ? " (AUTO)" : ""));
        this.cardIcons[i].sprite = SnakesArt.Icon(c);
        const col = c === Card.Shield ? hex(0x5cc8ff) : c === Card.Double ? hex(0xff8a4a) : hex(0x9df07a);
        this.cardIcons[i].color = col;
        b.setAccent(col);
        b.interactable = this.awaitingRoll && c !== Card.Shield;
      }
    }
    void CardInfo;
  }

  // ------------------------------------------------------------------ per-frame visuals

  private Animate(dt: number) {
    for (const t of this.tokens) {
      t.squash = Math.max(0, t.squash - dt * 4);
      const s = 0.66, sq = 1 + Math.sin(t.squash * 8) * 0.18 * t.squash;
      t.sr.transform.localScale = new V2(s * (2 - sq), s * sq);
      t.sr.transform.localPosition = t.pos.add(new V2(0, 0.22 + t.lift));
      t.sr.sortingOrder = 30 + Math.round((10 - t.pos.y) * 2) + (t.lift > 0 ? 40 : 0);
    }
    for (const sv of this.snakes) {
      sv.flick -= dt;
      const k = sv.flick < 0.35 && sv.flick > 0 ? Math.sin((sv.flick / 0.35) * Math.PI) : 0;
      if (sv.flick <= 0) sv.flick = 2 + this.rng.nextDouble() * 3;
      sv.tongue.transform.localScale = new V2(0.36 * k, 0.36);
      sv.gulp = Math.max(0, sv.gulp - dt * 1.5);
      const g = 0.56 * (1 + 0.25 * Math.sin(sv.gulp * Math.PI));
      sv.head.transform.localScale = new V2(g, g);
      sv.eyes.transform.localScale = new V2(g, g);
    }
    // the die: thrown in from the side, bouncing, then resting with a gentle bob
    const k = this.diceT;
    const human = this.State === Phase.Playing && this.awaitingRoll;
    this.dice.update(dt, human ? 1 : 0);
    const hop = k < 1 ? Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * 1.3 : human ? Math.abs(Math.sin(Time.time * 3)) * 0.12 : 0;
    const base = V2.lerp(this.diceFrom, this.dicePos, Ease.outCubic(k));
    this.dice.root.localPosition = base.add(new V2(0, hop));
    this.diceShadow.transform.localPosition = base.add(new V2(0.1, -0.72));
    const ss = 1.5 * (1 - hop * 0.25);
    this.diceShadow.transform.localScale = new V2(ss, ss * 0.45);
    const p = this.players[this.turn];
    const glowA = human ? 0.35 + 0.2 * Math.sin(Time.time * 5) : 0;
    this.diceGlow.color = (p ? PlayerColors[p.seat] : Color.white).withAlpha(glowA);
    this.diceGlow.transform.localPosition = this.dicePos;
    this.diceLabel.text = human ? "TAP TO ROLL" : "";
    this.diceLabel.color = Color.white;
    this.diceLabel.transform.localPosition = this.dicePos.add(new V2(0, -1.25));
  }
}

function set(t: Text | null, s: string) { if (t && t.text !== s) t.text = s; }
