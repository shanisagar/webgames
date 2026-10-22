import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject, howTo,
  Image, Mathf, Pal, Phase, Quaternion, Result, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer, Text, TextAnchor,
  TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import { SunnySolitaireArt } from "./SunnySolitaireArt";

/**
 * SUNNY SOLITAIRE: classic Klondike. Tap a card to send it to the best place, or drag it (with the cards on top)
 * anywhere it fits. Build the four foundations from Ace to King by suit. Draw one or three, unlimited undo, three free
 * hints per game (more with a rewarded ad) and auto-finish when every card is face up. Cards are UI elements on the
 * shared HUD canvas so their numbers stay crisp at any resolution. (Port of SunnySolitaireGame.cs.)
 */

// ------------------------------------------------------------------ tuning

const TopBand = 200, BottomBand = 150;
const Stock = 0, Waste = 1, Found0 = 2, Tab0 = 6, PileCount = 13;
const RankNames = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const Gold = Pal.hex(0xffc93c), Coral = Pal.hex(0xff8a3d);

class Card {
  Rank = 0; Suit = 0; Pile = 0;
  Up = false;
  Rt!: UINode;
  Face!: Image; Back!: Image; Small!: Image; Big!: Image; Glow!: Image;
  RankText!: Text; BigRank!: Text;
  Pos = V2.zero; Target = V2.zero;
  Flip = 1; Shake = 0; Pulse = 0;
  get Red() { return this.Suit === 1 || this.Suit === 2; }
}

interface Snap {
  Piles: number[];   // per card index: pile
  Order: number[];   // per card index: position in pile
  Up: boolean[];
  Score: number;
}

export class SunnySolitaireGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject;
  private bgCover!: SpriteRenderer;
  private table: UINode | null = null;
  private deck: Card[] = new Array<Card>(52);
  private piles: Card[][] = Array.from({ length: PileCount }, () => [] as Card[]);
  private slots: Image[] = new Array<Image>(PileCount);
  private history: Snap[] = [];
  private pointer = new TapPointer();
  private rng = new SysRandom();

  private cardW = 0; private cardH = 0; private gap = 0; private tabTop = 0; private tableBottom = 0; private topY = 0;
  private tableW = 0; private tableH = 0;
  private score = 0; private moves = 0; private hintsLeft = 0;
  private timer = 0; private autoTimer = 0; private winTimer = 0;
  private won = false; private autoFinishing = false; private drawThree = false; private dealt = false;
  private winVel: V2[] = new Array<V2>(52).fill(V2.zero);
  private winSpin: number[] = new Array<number>(52).fill(0);

  // dragging
  private drag: Card[] = [];
  private pressCard: Card | null = null;
  private pressPile = -1;
  private pressLocal = V2.zero; private dragOffset = V2.zero;
  private dragging = false;

  // HUD
  private scoreText!: Text; private timeText!: Text; private movesText!: Text;
  private undoButton!: ArcadeButton; private hintButton!: ArcadeButton; private autoButton!: ArcadeButton;
  private modeButton: ArcadeButton | null = null;
  private fx!: CasualFx;

  private flipClip!: AudioClip; private placeClip!: AudioClip; private shuffleClip!: AudioClip; private denyClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "sunnysolitaire",
      Title: "SUNNY SOLITAIRE",
      Tagline: "THE CLASSIC CARD GAME, IN THE SUN.",
      Accent: Coral,
      Accent2: Gold,
      BgTop: Pal.hex(0x19a391),
      BgBottom: Pal.hex(0x0e7c74),
      ShortSide: 10,
      Touch: TouchScheme.None,
      Music: { bpm: 88, rootHz: 130.8, degrees: [0, 4, 5, 3], seed: 27, energy: 0.25, major: true },
      Reminders: [
        "A fresh deal is waiting|Relax with a game of Solitaire.",
        "Can you win in under 5 minutes?|Beat your fastest Solitaire time.",
        "The sun is out|And so are the cards. Time for a game!",
      ],
      HowTo: [
        howTo(SunnySolitaireArt.Suit(1), Color.white, "Build the four piles at the top from ACE to KING, one suit each."),
        howTo(SunnySolitaireArt.Suit(0), Color.white, "On the table, stack cards DOWN in alternating colours (red 7 on black 8)."),
        howTo(SunnySolitaireArt.Suit(2), Color.white, "TAP a card to move it automatically, or DRAG it where you want."),
        howTo(SunnySolitaireArt.Suit(3), Color.white, "Only a KING can go into an empty column. Tap the deck to draw new cards."),
        howTo(Art.Star, Gold, "UNDO is unlimited. HINT shows a good move. Faster wins earn more stars."),
      ],
      Tips: [
        "Reveal face-down cards as early as you can.",
        "Don't rush cards to the foundations if you still need them on the table.",
        "Keep an empty column for a King that frees many cards.",
        "Draw 3 is harder, and scores the same.",
        "Stuck? Use UNDO and try another line.",
      ],
    });
  }

  protected get ShortSide() { return 10; }

  protected BestLine() {
    const wins = this.Data.get("wins");
    const best = this.Data.get("fast");
    return wins > 0 ? `${wins} WINS   ·   FASTEST ${Fmt.clock(best / 1000)}` : "DEAL A GAME!";
  }

  protected StatsLine() { return `${this.Data.get("games")} GAMES   ·   BEST SCORE ${Fmt.n(this.Data.get("best"))}   ·   ${this.DrawThreeSetting ? "DRAW 3" : "DRAW 1"}`; }

  private get DrawThreeSetting() { return this.Data.get("draw3") === 1; }
  private set DrawThreeSetting(value: boolean) { this.Data.set("draw3", value ? 1 : 0); }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("SolitaireWorld", this.gameObject);
    CasualLook.calm(this, 1.3, 0.12);
    this.bgCover = CasualLook.cover(this.world, SunnySolitaireArt.Felt, -910);
    this.fx = CasualFx.create(this.world, 50, 160);

    const table = (this.table = UIKit.node("Table", this.UI.Hud).stretch());
    table.setAsFirstSibling();
    for (let i = 0; i < PileCount; i++) {
      this.slots[i] = UIKit.img(table, "Slot", SunnySolitaireArt.Slot, Color.white);
      if (i >= Found0 && i < Tab0) {
        const s = UIKit.img(this.slots[i].rectTransform, "SuitHint", SunnySolitaireArt.Suit(i - Found0), new Color(1, 1, 1, 0.22));
        s.rectTransform.place(UIKit.Center, V2.zero, new V2(60, 60));
      }
    }
    for (let s = 0; s < 4; s++)
      for (let r = 1; r <= 13; r++) this.deck[s * 13 + r - 1] = this.MakeCard(r, s);

    this.flipClip = Sfx.make("ss-flip", 0.09, (t) => (new SysRandom(Math.trunc(t * 44100)).nextDouble() * 2 - 1) * Sfx.env(t, 0.003, 0.05) * 0.22);
    this.placeClip = Sfx.make("ss-place", 0.1, (t) => Sfx.sinP(Sfx.glide(t, 320, 180, 0.08)) * 0.5 * Sfx.env(t, 0.002, 0.07) * 0.35);
    this.shuffleClip = Sfx.make("ss-shuffle", 0.5, (t) => (new SysRandom(Math.trunc(t * 44100) + 7).nextDouble() * 2 - 1) * (0.5 + 0.5 * Math.sin(t * 90)) * Sfx.env(t, 0.02, 0.4) * 0.18);
    this.denyClip = Sfx.make("ss-deny", 0.12, (t) => Sfx.triP(Sfx.glide(t, 230, 170, 0.1)) * Sfx.env(t, 0.002, 0.1) * 0.22);

    this.BuildHud();
    this.Layout();
  }

  private MakeCard(rank: number, suit: number) {
    const c = new Card();
    c.Rank = rank; c.Suit = suit;
    c.Rt = UIKit.node("Card", this.table!);
    c.Glow = UIKit.img(c.Rt, "Glow", SunnySolitaireArt.Glow, Gold.withAlpha(0));
    c.Glow.rectTransform.stretch(-26);
    c.Face = UIKit.img(c.Rt, "Face", SunnySolitaireArt.Face, Color.white);
    c.Face.rectTransform.stretch();
    const ink = c.Red ? SunnySolitaireArt.Red : SunnySolitaireArt.Black;
    c.RankText = UIKit.label(c.Face.rectTransform, RankNames[rank], 44, ink, TextAnchor.UpperLeft);
    c.Small = UIKit.img(c.Face.rectTransform, "SmallSuit", SunnySolitaireArt.Suit(suit), Color.white);
    c.Big = UIKit.img(c.Face.rectTransform, "BigSuit", SunnySolitaireArt.Suit(suit), Color.white);
    c.BigRank = UIKit.label(c.Face.rectTransform, rank >= 11 ? RankNames[rank] : "", 64, ink.withAlpha(0.9));
    c.Back = UIKit.img(c.Rt, "Back", SunnySolitaireArt.Back, Color.white);
    c.Back.rectTransform.stretch();
    return c;
  }

  private SizeCard(c: Card) {
    c.Rt.sizeDelta = new V2(this.cardW, this.cardH);
    const k = this.cardW / 140;
    c.RankText.fontSize = Mathf.roundToInt(44 * k);
    c.RankText.rectTransform.place(new V2(0, 1), new V2(12 * k + 40 * k, -8 * k - 26 * k), new V2(80 * k, 52 * k));
    c.Small.rectTransform.place(new V2(1, 1), new V2(-26 * k, -30 * k), new V2(34 * k, 34 * k));
    const face = c.Rank >= 11;
    c.Big.rectTransform.place(UIKit.Center, new V2(0, face ? -40 * k : -18 * k), face ? new V2(46 * k, 46 * k) : new V2(78 * k, 78 * k));
    c.BigRank.fontSize = Mathf.roundToInt(70 * k);
    c.BigRank.rectTransform.place(UIKit.Center, new V2(0, 14 * k), new V2(120 * k, 90 * k));
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    const plate = UIKit.img(hud, "TopPlate", Art.UiRound, new Color(0, 0.2, 0.2, 0.45));
    plate.rectTransform.place(new V2(0.5, 1), new V2(-60, -80), new V2(820, 100));
    this.scoreText = UIKit.at(UIKit.label(plate.rectTransform, "0", 38, Color.white), new V2(0, 0.5), new V2(150, 0), new V2(260, 60));
    this.timeText = UIKit.at(UIKit.label(plate.rectTransform, "0:00", 38, Gold), UIKit.Center, V2.zero, new V2(200, 60));
    this.movesText = UIKit.at(UIKit.label(plate.rectTransform, "", 30, Color.white.withAlpha(0.85)), new V2(1, 0.5), new V2(-140, 0), new V2(260, 50));

    this.undoButton = UIKit.buttonAt(hud, "UNDO", new V2(0.5, 0), new V2(-260, 75), new V2(240, 100), false, () => this.Undo(), 28);
    this.hintButton = UIKit.buttonAt(hud, "HINT", new V2(0.5, 0), new V2(0, 75), new V2(240, 100), false, () => this.OnHint(), 28);
    this.autoButton = UIKit.buttonAt(hud, "AUTO", new V2(0.5, 0), new V2(260, 75), new V2(240, 100), true, () => this.StartAuto(), 28);
    this.undoButton.setAccent(Pal.hex(0x7fd3ff));
    this.hintButton.setAccent(Gold);
    this.autoButton.setAccent(Coral);

    if (this.UI.TitleExtra) {
      CasualLook.titleCard(this.UI, new Color(0.03, 0.3, 0.29, 0.85));
      // C# bug fix: the C# passes "" here, and UIKit.Button makes no label for an empty text, so the mode never showed.
      this.modeButton = UIKit.buttonAt(this.UI.TitleExtra, "MODE: DRAW 1", UIKit.Center, V2.zero, new V2(420, 96), false, () => this.ToggleMode(), 32);
      this.modeButton.setAccent(Gold);
      this.RefreshMode();
    }
  }

  private ToggleMode() {
    this.DrawThreeSetting = !this.DrawThreeSetting;
    this.Data.flush();
    Sfx.play(Snd.Click, 0.6);
    this.RefreshMode();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private RefreshMode() {
    if (this.modeButton && this.modeButton.label) this.modeButton.label.text = this.DrawThreeSetting ? "MODE: DRAW 3" : "MODE: DRAW 1";
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    if (!this.table) return;
    const r = this.table.rect;
    this.tableW = r.width;
    this.tableH = r.height;
    this.gap = Mathf.clamp(this.tableW * 0.012, 8, 18);
    this.cardW = Math.min((Math.min(this.tableW, 1500) - this.gap * 8) / 7, (this.tableH - TopBand - BottomBand) / 1.42 / 2.6, 190);
    this.cardH = this.cardW * 1.42;
    this.topY = this.tableH * 0.5 - TopBand - this.cardH * 0.5;
    this.tabTop = this.topY - this.cardH - this.gap * 2.2;
    this.tableBottom = -this.tableH * 0.5 + BottomBand;
    for (let i = 0; i < PileCount; i++) {
      this.slots[i].rectTransform.place(UIKit.Center, this.SlotPos(i), new V2(this.cardW, this.cardH));
      this.slots[i].gameObject.setActive(i !== Waste);
    }
    for (const c of this.deck) this.SizeCard(c);
    this.RelayoutAll(true);
  }

  private ColX(col: number) {
    const total = this.cardW * 7 + this.gap * 6;
    return -total * 0.5 + this.cardW * 0.5 + col * (this.cardW + this.gap);
  }

  private SlotPos(pile: number) {
    if (pile === Stock) return new V2(this.ColX(0), this.topY);
    if (pile === Waste) return new V2(this.ColX(1), this.topY);
    if (pile < Tab0) return new V2(this.ColX(3 + pile - Found0), this.topY);
    return new V2(this.ColX(pile - Tab0), this.tabTop);
  }

  private RelayoutAll(instant: boolean) {
    for (let p = 0; p < PileCount; p++) this.RelayoutPile(p, instant);
    this.Restack();
  }

  private RelayoutPile(p: number, instant: boolean) {
    const list = this.piles[p];
    const basePos = this.SlotPos(p);
    if (p >= Tab0) {
      let down = 0, up = 0;
      for (const c of list) { if (c.Up) up++; else down++; }
      let dDown = this.cardH * 0.13, dUp = this.cardH * 0.27;
      const need = down * dDown + Math.max(0, up - 1) * dUp;
      const avail = basePos.y - this.tableBottom - this.cardH * 0.5;
      if (need > avail && need > 0) {
        const k = avail / need;
        dDown *= k;
        dUp *= k;
      }
      let y = basePos.y;
      for (let i = 0; i < list.length; i++) {
        this.SetTarget(list[i], new V2(basePos.x, y), instant);
        y -= list[i].Up ? dUp : dDown;
      }
    } else if (p === Waste) {
      const n = list.length;
      for (let i = 0; i < n; i++) {
        const fromTop = n - 1 - i;
        let off = this.drawThree ? Math.max(0, 2 - fromTop) * this.cardW * 0.28 : 0;
        if (this.drawThree && fromTop > 2) off = 0;
        this.SetTarget(list[i], basePos.add(new V2(off, 0)), instant);
      }
    } else {
      for (let i = 0; i < list.length; i++) this.SetTarget(list[i], basePos.add(p === Stock ? new V2(0, Math.min(i, 6) * 1.5) : V2.zero), instant);
    }
  }

  private SetTarget(c: Card, t: V2, instant: boolean) {
    c.Target = t;
    if (instant) c.Pos = t;
  }

  private Restack() {
    for (let p = 0; p < PileCount; p++)
      for (const c of this.piles[p]) c.Rt.setAsLastSibling();
    for (const c of this.drag) c.Rt.setAsLastSibling();
  }

  // ------------------------------------------------------------------ deal

  private Deal() {
    for (const l of this.piles) l.length = 0;
    const order = [...this.deck];
    for (let i = order.length - 1; i > 0; i--) { const k = this.rng.next(i + 1); const t = order[i]; order[i] = order[k]; order[k] = t; }
    let idx = 0;
    for (let col = 0; col < 7; col++)
      for (let j = 0; j <= col; j++) {
        const c = order[idx++];
        c.Up = j === col;
        this.Put(c, Tab0 + col);
      }
    while (idx < order.length) {
      const c = order[idx++];
      c.Up = false;
      this.Put(c, Stock);
    }
    // fly from the stock
    for (const c of this.deck) { c.Pos = this.SlotPos(Stock); c.Flip = c.Up ? 0 : 1; c.Shake = 0; c.Pulse = 0; c.Rt.localRotation = Quaternion.identity; }
    this.RelayoutAll(false);
    this.history = [];
    Sfx.playClip(this.shuffleClip, 0.7);
  }

  private Put(c: Card, pile: number) {
    c.Pile = pile;
    this.piles[pile].push(c);
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.UI.Hint(null);
    this.drag = [];
  }

  protected BeginRun() {
    this.Layout();
    this.drawThree = this.DrawThreeSetting;
    this.rng = new SysRandom();
    this.Deal();
    this.dealt = true;
    this.score = this.moves = 0;
    this.timer = 0;
    this.hintsLeft = 3;
    this.won = this.autoFinishing = false;
    this.drag = [];
    this.dragging = false;
    this.pointer.reset();
    this.pointer.topBand = 0.07;
    this.Data.add("games", 1);
    if (this.Data.get("games") === 1) this.UI.Hint("Tap a card to move it, or drag it. Tap the deck to draw.");
    Sfx.setIntensity(0);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.dealt) this.Animate(dt);
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    if (this.table && (Math.abs(this.table.rect.width - this.tableW) > 1 || Math.abs(this.table.rect.height - this.tableH) > 1)) this.Layout();
    if (this.won) {
      this.winTimer += dt;
      this.WinCascade(dt);
      if (this.winTimer > 2.6 && this.State === Phase.Playing) this.Win();
      return;
    }
    this.timer += dt;
    if (this.autoFinishing) this.AutoStep(dt);
    else this.HandleInput();
    this.Animate(dt);
    this.UpdateHud();
  }

  private Local(screen: V2) { return this.table!.screenToLocal(screen); }

  private HandleInput() {
    const pointer = this.pointer;
    if (pointer.down) {
      this.UI.Hint(null);
      this.pressLocal = this.Local(pointer.screen);
      [this.pressCard, this.pressPile] = this.CardAt(this.pressLocal);
      this.dragging = false;
      this.drag = [];
    }
    if (pointer.held && this.pressCard && this.pressCard.Up) {
      const now = this.Local(pointer.screen);
      if (!this.dragging && now.sub(this.pressLocal).magnitude > 18 && this.CanPick(this.pressCard)) {
        this.dragging = true;
        this.drag = [];
        const list = this.piles[this.pressCard.Pile];
        for (let i = list.indexOf(this.pressCard); i < list.length; i++) this.drag.push(list[i]);
        this.dragOffset = this.pressCard.Pos.sub(this.pressLocal);
        this.Restack();
        Sfx.playClip(this.flipClip, 0.4, 1.2);
      }
      if (this.dragging) {
        for (let i = 0; i < this.drag.length; i++) {
          const p = now.add(this.dragOffset).add(new V2(0, -i * this.cardH * 0.27));
          this.drag[i].Target = p;
          this.drag[i].Pos = V2.lerp(this.drag[i].Pos, p, 0.6);
        }
      }
    }
    if (pointer.up) {
      if (this.dragging) this.Drop(this.Local(pointer.screen));
      else if (pointer.tap) this.Tap(this.pressCard, this.pressPile);
      this.dragging = false;
      this.drag = [];
      this.pressCard = null;
    }
  }

  private CardAt(local: V2): [Card | null, number] {
    // topmost card first (reverse draw order)
    for (let p = PileCount - 1; p >= 0; p--) {
      const list = this.piles[p];
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        const d = local.sub(c.Pos);
        if (Math.abs(d.x) <= this.cardW * 0.5 && Math.abs(d.y) <= this.cardH * 0.5) return [c, p];
      }
    }
    // empty slots
    for (let p = 0; p < PileCount; p++) {
      const d = local.sub(this.SlotPos(p));
      if (Math.abs(d.x) <= this.cardW * 0.5 && Math.abs(d.y) <= this.cardH * 0.5) return [null, p];
    }
    return [null, -1];
  }

  private CanPick(c: Card) {
    if (!c.Up) return false;
    const list = this.piles[c.Pile];
    if (c.Pile === Waste || (c.Pile >= Found0 && c.Pile < Tab0)) return list[list.length - 1] === c;
    if (c.Pile >= Tab0) {
      // the run above must be a valid sequence
      for (let i = list.indexOf(c); i < list.length - 1; i++)
        if (!SunnySolitaireGame.Follows(list[i + 1], list[i])) return false;
      return true;
    }
    return false;
  }

  /** True if `c` may be placed on top of `under` on the table. */
  private static Follows(c: Card, under: Card) { return under.Up && c.Rank === under.Rank - 1 && c.Red !== under.Red; }

  private CanPlace(run: Card[], pile: number) {
    if (run.length === 0) return false;
    const first = run[0];
    const list = this.piles[pile];
    if (pile >= Found0 && pile < Tab0) {
      if (run.length !== 1) return false;
      if (list.length === 0) return first.Rank === 1;
      const top = list[list.length - 1];
      return top.Suit === first.Suit && first.Rank === top.Rank + 1;
    }
    if (pile >= Tab0) {
      if (list.length === 0) return first.Rank === 13;
      return SunnySolitaireGame.Follows(first, list[list.length - 1]);
    }
    return false;
  }

  private Tap(c: Card | null, pile: number) {
    if (pile === Stock) {
      this.DrawStock();
      return;
    }
    if (!c) return;
    if (!c.Up) {
      const list = this.piles[c.Pile];
      if (c.Pile >= Tab0 && list[list.length - 1] === c) {
        this.SaveUndo();
        c.Up = true;
        c.Flip = 0;
        this.score += 5;
        Sfx.playClip(this.flipClip, 0.6);
      }
      return;
    }
    if (!this.CanPick(c)) { c.Shake = 1; Sfx.playClip(this.denyClip, 0.5); return; }
    const run = this.Run(c);
    const dest = this.BestDestination(run);
    if (dest < 0) {
      for (const r of run) r.Shake = 1;
      Sfx.playClip(this.denyClip, 0.5);
      return;
    }
    this.MoveRun(run, dest);
  }

  private Run(c: Card) {
    const list = this.piles[c.Pile];
    const run: Card[] = [];
    for (let i = list.indexOf(c); i < list.length; i++) run.push(list[i]);
    return run;
  }

  private BestDestination(run: Card[]) {
    const from = run[0].Pile;
    if (run.length === 1)
      for (let f = Found0; f < Tab0; f++)
        if (f !== from && this.CanPlace(run, f)) return f;
    let empty = -1;
    for (let t = Tab0; t < PileCount; t++) {
      if (t === from || !this.CanPlace(run, t)) continue;
      if (this.piles[t].length === 0) { if (empty < 0) empty = t; continue; }
      return t;
    }
    // don't shuffle a king that already sits alone at the bottom of a column
    if (empty >= 0 && !(from >= Tab0 && this.piles[from].indexOf(run[0]) === 0)) return empty;
    return -1;
  }

  private Drop(_local: V2) {
    let best = -1;
    let bestD = Number.MAX_VALUE;
    const first = this.drag[0];
    for (let p = Found0; p < PileCount; p++) {
      if (p === first.Pile || !this.CanPlace(this.drag, p)) continue;
      const at = this.piles[p].length > 0 ? this.piles[p][this.piles[p].length - 1].Target : this.SlotPos(p);
      const d = first.Pos.sub(at).magnitude;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best >= 0 && bestD < this.cardW * 1.6) this.MoveRun([...this.drag], best);
    else {
      Sfx.playClip(this.denyClip, 0.4);
      this.RelayoutPile(first.Pile, false);
      this.Restack();
    }
  }

  private MoveRun(run: Card[], dest: number) {
    this.SaveUndo();
    const from = run[0].Pile;
    for (const c of run) {
      const l = this.piles[from];
      l.splice(l.indexOf(c), 1);
      this.Put(c, dest);
    }
    this.moves++;
    if (dest >= Found0 && dest < Tab0) {
      this.score += 10;
      this.fx.sparkle(this.CardWorld(run[0]), Gold, 4, 0.4, 0.28);
      Fx.haptic();
    } else if (from === Waste) this.score += 5;
    if (from >= Found0 && from < Tab0) this.score = Math.max(0, this.score - 15);
    // reveal the new top card
    if (from >= Tab0 && this.piles[from].length > 0) {
      const top = this.piles[from][this.piles[from].length - 1];
      if (!top.Up) { top.Up = true; top.Flip = 0; this.score += 5; Sfx.playClip(this.flipClip, 0.5); }
    }
    Sfx.playClip(this.placeClip, 0.6, 0.95 + this.rng.nextDouble() * 0.1);
    this.RelayoutPile(from, false);
    this.RelayoutPile(dest, false);
    this.Restack();
    this.CheckWin();
  }

  private CardWorld(c: Card) {
    // HUD local → world (for particles): the HUD spans the screen; map proportionally
    const n = new V2(c.Target.x / Math.max(1, this.tableW), c.Target.y / Math.max(1, this.tableH));
    return new V2(n.x * this.ViewSize.x, n.y * this.ViewSize.y);
  }

  private DrawStock() {
    this.SaveUndo();
    const piles = this.piles;
    if (piles[Stock].length === 0) {
      if (piles[Waste].length === 0) { this.history.pop(); return; }
      for (let i = piles[Waste].length - 1; i >= 0; i--) {
        const c = piles[Waste][i];
        c.Up = false;
        c.Flip = 1;
        this.Put(c, Stock);
      }
      piles[Waste].length = 0;
      Sfx.playClip(this.shuffleClip, 0.5);
    } else {
      const n = this.drawThree ? 3 : 1;
      for (let i = 0; i < n && piles[Stock].length > 0; i++) {
        const c = piles[Stock].pop()!;
        c.Up = true;
        c.Flip = 0;
        this.Put(c, Waste);
      }
      Sfx.playClip(this.flipClip, 0.6);
    }
    this.moves++;
    this.RelayoutPile(Stock, false);
    this.RelayoutPile(Waste, false);
    this.Restack();
  }

  // ------------------------------------------------------------------ undo / hint / auto

  private SaveUndo() {
    const s: Snap = { Piles: new Array(52).fill(0), Order: new Array(52).fill(0), Up: new Array(52).fill(false), Score: this.score };
    for (let i = 0; i < 52; i++) {
      const c = this.deck[i];
      s.Piles[i] = c.Pile;
      s.Order[i] = this.piles[c.Pile].indexOf(c);
      s.Up[i] = c.Up;
    }
    this.history.push(s);
    if (this.history.length > 400) this.history.shift();
  }

  private Undo() {
    if (this.State !== Phase.Playing || this.won || this.autoFinishing || this.history.length === 0) { Sfx.playClip(this.denyClip, 0.4); return; }
    const s = this.history.pop()!;
    for (const l of this.piles) l.length = 0;
    const slotsTmp: (Card | null)[][] = Array.from({ length: PileCount }, () => new Array<Card | null>(52).fill(null));
    for (let i = 0; i < 52; i++) {
      const c = this.deck[i];
      if (c.Up !== s.Up[i]) c.Flip = 0;
      c.Up = s.Up[i];
      c.Pile = s.Piles[i];
      slotsTmp[c.Pile][s.Order[i]] = c;
    }
    for (let p = 0; p < PileCount; p++)
      for (let k = 0; k < 52; k++)
        if (slotsTmp[p][k]) this.piles[p].push(slotsTmp[p][k]!);
    this.score = s.Score;
    this.moves++;
    this.RelayoutAll(false);
    Sfx.play(Snd.Whoosh, 0.4);
  }

  private OnHint() {
    if (this.State !== Phase.Playing || this.won || this.autoFinishing) return;
    if (this.hintsLeft > 0) {
      if (this.ShowHint()) this.hintsLeft--;
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

  private ShowHint() {
    // 1) anything to a foundation, 2) a table move that reveals a card, 3) waste to table, 4) draw
    const piles = this.piles;
    let src: Card | null = null;
    let dest = -1;
    const candidates: Card[] = [];
    for (let p = Waste; p < PileCount; p++) {
      if (p >= Found0 && p < Tab0) continue;
      const list = piles[p];
      if (list.length === 0) continue;
      if (p === Waste) candidates.push(list[list.length - 1]);
      else for (let i = 0; i < list.length; i++) if (list[i].Up && this.CanPick(list[i])) { candidates.push(list[i]); break; }
      if (p >= Tab0) candidates.push(list[list.length - 1]);
    }
    for (const c of candidates) {
      if (!c.Up) continue;
      const single = [c];
      if (piles[c.Pile][piles[c.Pile].length - 1] !== c) continue;
      for (let f = Found0; f < Tab0; f++) if (this.CanPlace(single, f)) { src = c; dest = f; break; }
      if (src) break;
    }
    if (!src) {
      for (const c of candidates) {
        if (!c.Up || c.Pile < Tab0) continue;
        const idx = piles[c.Pile].indexOf(c);
        const reveals = idx > 0 && !piles[c.Pile][idx - 1].Up;
        const kingMove = idx > 0 && c.Rank === 13;
        if (!reveals && !kingMove) continue;
        const run = this.Run(c);
        for (let t = Tab0; t < PileCount; t++) {
          if (t === c.Pile || !this.CanPlace(run, t)) continue;
          src = c; dest = t; break;
        }
        if (src) break;
      }
    }
    if (!src && piles[Waste].length > 0) {
      const w = piles[Waste][piles[Waste].length - 1];
      const run = [w];
      for (let t = Tab0; t < PileCount; t++) if (this.CanPlace(run, t)) { src = w; dest = t; break; }
    }
    if (src) {
      for (const c of this.Run(src)) c.Pulse = 1.6;
      if (piles[dest].length > 0) piles[dest][piles[dest].length - 1].Pulse = 1.6;
      Sfx.play(Snd.Beep, 0.4);
      return true;
    }
    if (piles[Stock].length > 0 || piles[Waste].length > 0) {
      if (piles[Stock].length > 0) piles[Stock][piles[Stock].length - 1].Pulse = 1.6;
      this.UI.Toast("Draw a card from the deck.", 2);
      return true;
    }
    this.NoMoves();
    return false;
  }

  private NoMoves() {
    Sfx.play(Snd.Lose, 0.6);
    this.Finish(new Result({
      Headline: "NO MORE MOVES",
      HeadlineColor: Pal.hex(0xffd2b8),
      Value: Fmt.n(this.score),
      BestLine: `${this.CardsHome()}/52 CARDS ON THE FOUNDATIONS`,
      Stats: [
        ["SCORE", Fmt.n(this.score)],
        ["TIME", Fmt.clock(this.timer)],
        ["MOVES", String(this.moves)],
        ["WINS", String(this.Data.get("wins"))],
      ],
      Primary: "NEW DEAL",
      Reward: this.history.length > 0 ? () => this.KeepPlaying() : null,
      RewardLabel: "UNDO 5 MOVES & KEEP PLAYING (AD)",
    }));
  }

  private CardsHome() {
    let n = 0;
    for (let f = Found0; f < Tab0; f++) n += this.piles[f].length;
    return n;
  }

  private KeepPlaying() {
    this.Revive();
    for (let i = 0; i < 5 && this.history.length > 0; i++) this.Undo();
    this.hintsLeft = Math.max(this.hintsLeft, 1);
  }

  private CanAutoFinish() {
    if (this.piles[Stock].length > 0 || this.piles[Waste].length > 0) return false;
    for (let t = Tab0; t < PileCount; t++) for (const c of this.piles[t]) if (!c.Up) return false;
    return true;
  }

  private StartAuto() {
    if (this.State !== Phase.Playing || this.won || !this.CanAutoFinish()) return;
    this.autoFinishing = true;
    this.autoTimer = 0;
  }

  private AutoStep(dt: number) {
    this.Animate(dt);
    this.autoTimer -= dt;
    if (this.autoTimer > 0) return;
    this.autoTimer = 0.07;
    // move the lowest card that can go up
    let bestC: Card | null = null;
    let bestF = -1;
    for (let t = Tab0; t < PileCount; t++) {
      const list = this.piles[t];
      if (list.length === 0) continue;
      const c = list[list.length - 1];
      const single = [c];
      for (let f = Found0; f < Tab0; f++)
        if (this.CanPlace(single, f) && (!bestC || c.Rank < bestC.Rank)) { bestC = c; bestF = f; }
    }
    if (!bestC) { this.autoFinishing = false; this.CheckWin(); return; }
    this.MoveRun([bestC], bestF);
  }

  private CheckWin() {
    for (let f = Found0; f < Tab0; f++) if (this.piles[f].length < 13) return;
    this.won = true;
    this.autoFinishing = false;
    this.winTimer = 0;
    for (let i = 0; i < 52; i++) {
      this.winVel[i] = new V2((this.rng.nextDouble() - 0.5) * 900, 600 + this.rng.nextDouble() * 900);
      this.winSpin[i] = (this.rng.nextDouble() - 0.5) * 500;
    }
    this.UI.Announce("YOU WIN!", Gold, 1.8);
    this.fx.confetti(new V2(0, this.ViewSize.y * 0.3), 90, 10, [Gold, Coral, Pal.hex(0xffffff), Pal.hex(0x7fd3ff), SunnySolitaireArt.Red]);
    Sfx.play(Snd.Win);
  }

  private WinCascade(dt: number) {
    // cards leap off the foundations one after another and bounce off the bottom
    for (let i = 0; i < 52; i++) {
      const c = this.deck[i];
      const start = (c.Rank - 1) * 0.08 + c.Suit * 0.02;
      if (this.winTimer < start) continue;
      let v = this.winVel[i];
      v = v.withY(v.y - 2600 * dt);
      c.Pos = c.Pos.add(v.mul(dt));
      if (c.Pos.y < -this.tableH * 0.5 + this.cardH * 0.5 && v.y < 0) v = v.withY(-v.y * 0.6);
      this.winVel[i] = v;
      c.Rt.localRotation = Quaternion.euler(0, 0, c.Rt.localRotation.eulerAngles.z + this.winSpin[i] * dt);
      c.Rt.anchoredPosition = c.Pos;
    }
  }

  // ------------------------------------------------------------------ animation

  private Animate(dt: number) {
    for (const c of this.deck) {
      const isDragged = this.dragging && this.drag.includes(c);
      if (!isDragged) c.Pos = V2.lerp(c.Pos, c.Target, 1 - Math.exp(-dt * 18));
      c.Flip = Math.min(1, c.Flip + dt * 6);
      c.Shake = Mathf.moveTowards(c.Shake, 0, dt * 3);
      c.Pulse = Mathf.moveTowards(c.Pulse, 0, dt);
      // flip: shrink to 0 then grow with the new face (show face once past half)
      const k = c.Flip < 0.5 ? 1 - c.Flip * 2 : (c.Flip - 0.5) * 2;
      const showFace = c.Up ? c.Flip >= 0.5 : c.Flip < 0.5;
      c.Face.gameObject.setActive(showFace);
      c.Back.gameObject.setActive(!showFace);
      const wig = Math.sin(c.Shake * 40) * c.Shake * 10;
      c.Rt.anchoredPosition = c.Pos.add(new V2(wig, 0));
      const lift = isDragged ? 1.06 : 1;
      c.Rt.localScale = new V3(Math.max(0.02, k) * lift, lift, 1);
      const glow = c.Pulse > 0 ? (0.5 + 0.5 * Math.sin(c.Pulse * 12)) * Math.min(1, c.Pulse) : 0;
      c.Glow.color = Gold.withAlpha(glow * 0.9);
      if (!this.won && c.Rt.localRotation.z !== 0) c.Rt.localRotation = Quaternion.identity;
    }
  }

  private UpdateHud() {
    SunnySolitaireGame.SetText(this.scoreText, Fmt.n(this.score));
    SunnySolitaireGame.SetText(this.timeText, Fmt.clock(this.timer));
    SunnySolitaireGame.SetText(this.movesText, this.moves + " MOVES");
    this.undoButton.interactable = this.history.length > 0 && !this.won && !this.autoFinishing;
    if (this.hintButton.label) SunnySolitaireGame.SetText(this.hintButton.label, this.hintsLeft > 0 ? `HINT ×${this.hintsLeft}` : AdService.rewardedAvailable ? "HINT +AD" : "HINT");
    this.hintButton.interactable = !this.won && !this.autoFinishing && (this.hintsLeft > 0 || AdService.rewardedAvailable);
    const canAuto = this.CanAutoFinish() && !this.won;
    this.autoButton.gameObject.setActive(canAuto || this.autoFinishing);
  }

  private static SetText(t: Text | null, s: string) {
    if (t && t.text !== s) t.text = s;
  }

  // ------------------------------------------------------------------ results

  private Win() {
    const stars = this.timer <= 300 ? 3 : this.timer <= 540 ? 2 : 1;
    const bonus = Math.max(0, 700 - Mathf.roundToInt(this.timer)) * 2;
    this.score += bonus;
    this.Data.add("wins", 1);
    const newBest = this.Data.max("best", this.score);
    const fastest = this.Data.min("fast", Mathf.roundToInt(this.timer * 1000));
    this.Finish(new Result({
      Headline: fastest ? "FASTEST WIN!" : "SOLITAIRE!",
      HeadlineColor: Gold,
      Stars: stars,
      Value: Fmt.clock(this.timer),
      NewBest: newBest || fastest,
      BestLine: `${this.Data.get("wins")} WINS IN ${this.Data.get("games")} GAMES`,
      Stats: [
        ["SCORE", Fmt.n(this.score)],
        ["TIME", Fmt.clock(this.timer)],
        ["MOVES", String(this.moves)],
        ["TIME BONUS", "+" + Fmt.n(bonus)],
      ],
      Primary: "NEW DEAL",
      Victory: true,
    }));
  }
}
