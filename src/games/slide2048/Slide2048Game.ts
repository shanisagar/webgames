import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, CasualUI, Color, Ease, Fmt, Fx,
  GameInfo, GameObject, howTo, Image, Keyboard, Mathf, Pal, Phase, Result, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer,
  Text, TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";

/**
 * SLIDE 2048: the classic number-sliding puzzle. Swipe (or use the arrow keys) to slide every tile; two equal tiles
 * that meet merge into their sum. Reach 2048, then keep going for a bigger tile. One free UNDO per game and more with a
 * rewarded ad; when no moves are left, a rewarded ad can undo three moves to continue. Tiles are UI elements so the
 * numbers are always sharp. (Port of Slide2048Game.cs.)
 */

const TopBand = 260, BottomBand = 170, N = 4, SlideTime = 0.11;
const Ink = Pal.hex(0x4a3b33), BoardColor = Pal.hex(0xc9b8a6), SlotColor = Pal.hex(0xe0d3c4), Gold = Pal.hex(0xffb627), Coral = Pal.hex(0xff7a59);
const TileColors = [
  Pal.hex(0xfff4e6), Pal.hex(0xffe7c2), Pal.hex(0xffc48a), Pal.hex(0xff9e6b), Pal.hex(0xff7a59), Pal.hex(0xff5a5f),
  Pal.hex(0xffd85a), Pal.hex(0xffc93c), Pal.hex(0x9be07c), Pal.hex(0x4cc88a), Pal.hex(0x3fb6e8), Pal.hex(0x6c7bff), Pal.hex(0xa66cff), Pal.hex(0xe85cc8),
];

class Tile {
  Value = 0; X = 0; Y = 0;
  Rt!: UINode;
  Bg!: Image;
  Label!: Text;
  From = V2.zero; To = V2.zero;
  T = 1; Pop = 0; Spawn = 0;
  MergeInto: Tile | null = null;
  Dying = false;
}

interface Snapshot { Values: number[]; Score: number }

const Round = () => CasualArt.make("s2-round", 96, 96, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.96, 0.96), 0.3);
  return new Color(1, 1, 1, CasualArt.fill(d, 2 / 96));
}, 30, 100);

const TileSprite = () => CasualArt.make("s2-tile", 96, 96, (p) => {
  const px = 2 / 96;
  const d = CasualArt.sdBox(p, new V2(0.96, 0.96), 0.3);
  let c = Color.lerp(new Color(0.9, 0.9, 0.9, 1), Color.white, CasualArt.smooth(-1, 0.8, p.y));
  c = Color.lerp(new Color(0.78, 0.78, 0.78, 1), c, CasualArt.fill(d + 0.08, px));
  return c.withAlpha(CasualArt.fill(d, px));
}, 30, 100);

const BackdropSprite = () => CasualArt.make("s2-bg", 128, 256, (p) => {
  let c = Color.lerp(Pal.hex(0xf5e3cf), Pal.hex(0xfff3e4), CasualArt.smooth(-2, 2, p.y));
  const stripes = Mathf.repeat((p.x + p.y) * 3, 1);
  c = Color.lerp(c, Pal.hex(0xffebd6), stripes < 0.5 ? 0.35 : 0);
  return c.withAlpha(1);
});

function level(v: number) { let l = 0; while (v > 2) { v >>= 1; l++; } return l; }
const colorFor = (v: number) => TileColors[Math.min(level(v), TileColors.length - 1)];
const textFor = (v: number) => (v <= 4 ? Ink : Color.white);

export class Slide2048Game extends ArcadeGame {
  private world!: GameObject;
  private bgCover!: SpriteRenderer;
  private board!: UINode;
  private boardBg!: UINode;
  private slots: Image[] = [];
  private tiles: Tile[] = [];
  private grid: (Tile | null)[][] = Array.from({ length: N }, () => Array<Tile | null>(N).fill(null));
  private history: Snapshot[] = [];
  private pointer = new TapPointer();
  private fx!: CasualFx;
  private rng = new SysRandom();
  private cell = 0; private size = 0; private animTimer = 0; private endTimer = 0; private lastW = 0; private lastH = 0;
  private score = 0; private best = 0; private moves = 0; private undos = 0; private biggest = 0;
  private won2048 = false; private ended = false; private revived = false; private built = false;
  private scoreText!: Text; private bestText!: Text; private bigText!: Text;
  private undoButton!: ArcadeButton;
  private slideClip!: AudioClip; private mergeClip!: AudioClip;
  private pendingValue = new Map<Tile, number>();
  private spawnPending = false;

  protected Describe() {
    return new GameInfo({
      Id: "slide2048",
      Title: "SLIDE 2048",
      Tagline: "SWIPE. MERGE. REACH 2048!",
      Accent: Coral,
      Accent2: Gold,
      BgTop: Pal.hex(0xfff3e4),
      BgBottom: Pal.hex(0xf5e3cf),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 90, rootHz: 130.8, degrees: [0, 4, 5, 3], seed: 48, energy: 0.25, major: true },
      HowTo: [
        howTo(Art.Chevron, Coral, "SWIPE (or press the arrow keys) to slide all tiles in one direction."),
        howTo(Art.Square, TileColors[2], "Two tiles with the same number that touch MERGE into one with their sum."),
        howTo(Art.Star, Gold, "Merge your way up to the 2048 tile, then keep going for a new record!"),
        howTo(Art.Diamond, Pal.Danger, "The game ends when the board is full and nothing can merge."),
        howTo(Art.Ring, Coral, "UNDO takes back your last move."),
      ],
      Tips: [
        "Keep your biggest tile in a corner.",
        "Swipe mostly in two directions, e.g. down and left.",
        "Build a chain of decreasing tiles along one edge.",
        "Don't swipe away from your corner unless you must.",
        "Merge small tiles early so they don't clutter the board.",
      ],
    });
  }

  protected get ShortSide() { return 9; }
  private get Undos() { return this.Data.get("undo", 0); }
  private set Undos(v: number) { this.Data.set("undo", Math.max(0, v)); }

  protected BestLine() {
    const b = this.Data.get("best"), t = this.Data.get("tile");
    return b > 0 ? `BEST ${Fmt.n(b)}   ·   BEST TILE ${Fmt.n(t)}` : "REACH THE 2048 TILE!";
  }

  protected StatsLine() { return `${this.Data.get("games")} GAMES   ·   ${this.Data.get("wins")} TIMES 2048`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("SlideWorld", this.gameObject);
    CasualLook.calm(this, 1.4, 0.1);
    this.bgCover = CasualLook.cover(this.world, BackdropSprite(), -910);
    this.fx = CasualFx.create(this.world, 50, 120);
    this.board = UIKit.node("Board", this.UI.Hud).stretch();
    this.board.setAsFirstSibling();
    this.boardBg = UIKit.img(this.board, "BoardBg", Round(), BoardColor).rectTransform;
    for (let i = 0; i < N * N; i++) this.slots.push(UIKit.img(this.boardBg, "Slot", Round(), SlotColor));

    const hud = this.UI.Hud;
    const sBox = UIKit.img(hud, "ScoreBox", Round(), BoardColor);
    sBox.rectTransform.place(new V2(0.5, 1), new V2(-240, -110), new V2(300, 150));
    UIKit.at(UIKit.label(sBox.rectTransform, "SCORE", 26, SlotColor), new V2(0.5, 1), new V2(0, -30), new V2(280, 34));
    this.scoreText = UIKit.at(UIKit.label(sBox.rectTransform, "0", 54, Color.white), new V2(0.5, 0.5), new V2(0, -16), new V2(280, 70));
    const bBox = UIKit.img(hud, "BestBox", Round(), BoardColor);
    bBox.rectTransform.place(new V2(0.5, 1), new V2(90, -110), new V2(300, 150));
    UIKit.at(UIKit.label(bBox.rectTransform, "BEST", 26, SlotColor), new V2(0.5, 1), new V2(0, -30), new V2(280, 34));
    this.bestText = UIKit.at(UIKit.label(bBox.rectTransform, "0", 54, Color.white), new V2(0.5, 0.5), new V2(0, -16), new V2(280, 70));
    this.bigText = UIKit.at(UIKit.label(hud, "", 30, Ink), new V2(0.5, 1), new V2(0, -220), new V2(700, 40));
    this.undoButton = UIKit.buttonAt(hud, "UNDO", new V2(0.5, 0), new V2(0, 90), new V2(340, 120), false, () => this.OnUndo(), 32);
    this.undoButton.setAccent(Coral);

    if (this.UI.TitleExtra) {
      CasualLook.titleCard(this.UI, new Color(0.36, 0.26, 0.2, 0.86));
      const row = [2, 8, 64, 512, 2048];
      row.forEach((v, i) => {
        const t = UIKit.img(this.UI.TitleExtra, "Demo", TileSprite(), colorFor(v));
        t.rectTransform.place(UIKit.Center, new V2((i - 2) * 150, 0), new V2(130, 110));
        UIKit.at(UIKit.label(t.rectTransform, String(v), v >= 1000 ? 34 : 44, textFor(v)), UIKit.Center, V2.zero, new V2(130, 110));
      });
    }

    this.slideClip = Sfx.make("s2-slide", 0.08, (t) => Sfx.sinP(Sfx.glide(t, 320, 260, 0.06)) * 0.4 * Sfx.env(t, 0.003, 0.06) * 0.3);
    this.mergeClip = Sfx.make("s2-merge", 0.16, (t) => (Sfx.sinP(Sfx.glide(t, 500, 800, 0.08)) * 0.6 + Sfx.triP(1000 * t) * 0.15) * Sfx.env(t, 0.003, 0.13) * 0.3);
    this.built = true;
    this.Layout();
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    if (!this.built) return;
    const r = this.board.rect;
    this.lastW = r.width;
    this.lastH = r.height;
    this.size = Math.min(r.width - 60, r.height - TopBand - BottomBand - 40, 980);
    this.cell = this.size / N;
    const cy = (BottomBand - TopBand) * 0.5;
    this.boardBg.place(UIKit.Center, new V2(0, cy), new V2(this.size + 24, this.size + 24));
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) this.slots[y * N + x].rectTransform.place(UIKit.Center, this.SlotPos(x, y), new V2(this.cell - 16, this.cell - 16));
    for (const t of this.tiles) {
      t.To = this.SlotPos(t.X, t.Y);
      if (t.T >= 1) t.From = t.To;
      this.SizeTile(t);
    }
  }

  private SlotPos(x: number, y: number) { return new V2((x - (N - 1) * 0.5) * this.cell, ((N - 1) * 0.5 - y) * this.cell); }

  private SizeTile(t: Tile) {
    t.Rt.sizeDelta = new V2(this.cell - 16, this.cell - 16);
    const digits = String(t.Value).length;
    t.Label.fontSize = Mathf.roundToInt(this.cell * (digits <= 2 ? 0.46 : digits === 3 ? 0.38 : digits === 4 ? 0.3 : 0.24));
  }

  // ------------------------------------------------------------------ tiles

  private MakeTile(v: number, x: number, y: number, spawn: boolean) {
    const t = new Tile();
    t.Value = v; t.X = x; t.Y = y;
    t.Rt = UIKit.node("Tile", this.boardBg);
    t.Bg = UIKit.img(t.Rt, "Bg", TileSprite(), colorFor(v));
    t.Bg.rectTransform.stretch();
    t.Label = UIKit.label(t.Rt, String(v), 60, textFor(v));
    t.Label.rectTransform.stretch();
    t.From = t.To = this.SlotPos(x, y);
    t.Rt.anchoredPosition = t.To;
    t.Spawn = spawn ? 0 : 1;
    if (spawn) t.Rt.localScale = new V3(0, 0, 1);
    this.SizeTile(t);
    this.grid[x][y] = t;
    this.tiles.push(t);
    return t;
  }

  private SetValue(t: Tile, v: number) {
    t.Value = v;
    t.Bg.color = colorFor(v);
    t.Label.text = String(v);
    t.Label.color = textFor(v);
    this.SizeTile(t);
  }

  private SpawnRandom() {
    const free: [number, number][] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!this.grid[x][y]) free.push([x, y]);
    if (free.length === 0) return false;
    const [x, y] = free[this.rng.next(free.length)];
    this.MakeTile(this.rng.nextDouble() < 0.9 ? 2 : 4, x, y, true);
    return true;
  }

  private ClearAll() {
    for (const t of this.tiles) t.Rt.destroy();
    this.tiles = [];
    for (const col of this.grid) col.fill(null);
  }

  // ------------------------------------------------------------------ lifecycle

  protected BeginRun() {
    this.Layout();
    this.ClearAll();
    this.pendingValue.clear();
    this.spawnPending = false;
    this.history = [];
    this.score = this.moves = 0;
    this.biggest = 2;
    this.won2048 = this.ended = this.revived = false;
    this.undos = 1;
    this.animTimer = 0;
    this.best = this.Data.get("best");
    this.SpawnRandom();
    this.SpawnRandom();
    this.pointer.reset();
    this.pointer.topBand = 0.05;
    this.Data.add("games", 1);
    if (this.Data.get("games") === 1) this.UI.Hint("Swipe to slide the tiles. Equal numbers merge!");
    Sfx.setIntensity(0);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    if (Math.abs(this.board.rect.width - this.lastW) > 1 || Math.abs(this.board.rect.height - this.lastH) > 1) this.Layout();
    this.Animate(dt);
    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.State === Phase.Playing) this.Lose();
      return;
    }
    if (this.animTimer > 0) { this.animTimer -= dt; return; }
    const dir = this.ReadDirection();
    if (dir >= 0) this.Move(dir);
  }

  private ReadDirection() {
    const kb = Keyboard;
    if (kb.left.wasPressedThisFrame || kb.letter("a").wasPressedThisFrame) return 0;
    if (kb.right.wasPressedThisFrame || kb.letter("d").wasPressedThisFrame) return 1;
    if (kb.up.wasPressedThisFrame || kb.letter("w").wasPressedThisFrame) return 2;
    if (kb.down.wasPressedThisFrame || kb.letter("s").wasPressedThisFrame) return 3;
    const p = this.pointer;
    if (p.up || (p.held && p.screen.sub(p.startScreen).magnitude > TapPointer.dp(40))) {
      const d = p.screen.sub(p.startScreen);
      if (d.magnitude < TapPointer.dp(24)) return -1;
      p.reset(); // one move per swipe
      if (Math.abs(d.x) > Math.abs(d.y)) return d.x < 0 ? 0 : 1;
      return d.y > 0 ? 2 : 3;
    }
    return -1;
  }

  private Move(dir: number) {
    // 0 left, 1 right, 2 up, 3 down
    const snap = this.Snap();
    let moved = false, gained = 0;
    const mergedThisMove = Array.from({ length: N }, () => Array<boolean>(N).fill(false));
    for (let line = 0; line < N; line++)
      for (let step = 0; step < N; step++) {
        const [x, y] = Slide2048Game.Cell(dir, line, step);
        const t = this.grid[x][y];
        if (!t) continue;
        let cx = x, cy = y;
        for (;;) {
          const [nx, ny] = Slide2048Game.Step(dir, cx, cy);
          if (nx < 0 || nx >= N || ny < 0 || ny >= N) break;
          const o = this.grid[nx][ny];
          if (!o) { cx = nx; cy = ny; continue; }
          if (o.Value === t.Value && !mergedThisMove[nx][ny] && !o.MergeInto) {
            this.grid[x][y] = null;
            t.MergeInto = o;
            t.Dying = true;
            t.From = t.Rt.anchoredPosition;
            t.To = this.SlotPos(nx, ny);
            t.T = 0;
            mergedThisMove[nx][ny] = true;
            const v = o.Value * 2;
            o.Pop = -SlideTime; // pops after the slide
            this.pendingValue.set(o, v);
            gained += v;
            moved = true;
            cx = -1;
          }
          break;
        }
        if (cx < 0) continue;
        if (cx !== x || cy !== y) {
          this.grid[x][y] = null;
          this.grid[cx][cy] = t;
          t.X = cx; t.Y = cy;
          t.From = t.Rt.anchoredPosition;
          t.To = this.SlotPos(cx, cy);
          t.T = 0;
          moved = true;
        }
      }
    if (!moved) return;
    this.history.push(snap);
    if (this.history.length > 30) this.history.shift();
    this.moves++;
    this.score += gained;
    this.animTimer = SlideTime;
    Sfx.playClip(gained > 0 ? this.mergeClip : this.slideClip, gained > 0 ? 0.6 + Math.min(0.4, gained / 512) : 0.5,
      gained > 0 ? Mathf.clamp(1 + Math.log2(gained) * 0.03 - 0.1, 0.9, 1.5) : 1);
    this.UI.Hint(null);
    this.spawnPending = true;
    this.UpdateHud();
  }

  private static Cell(dir: number, line: number, step: number): [number, number] {
    switch (dir) {
      case 0: return [step, line];
      case 1: return [N - 1 - step, line];
      case 2: return [line, step];
      default: return [line, N - 1 - step];
    }
  }

  private static Step(dir: number, x: number, y: number): [number, number] {
    if (dir === 0) return [x - 1, y];
    if (dir === 1) return [x + 1, y];
    if (dir === 2) return [x, y - 1];
    return [x, y + 1];
  }

  private Snap(): Snapshot {
    const values: number[] = new Array(N * N).fill(0);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const t = this.grid[x][y]; values[y * N + x] = t ? this.Val(t) : 0; }
    return { Values: values, Score: this.score };
  }

  private Restore(s: Snapshot) {
    this.ClearAll();
    this.pendingValue.clear();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (s.Values[y * N + x] > 0) this.MakeTile(s.Values[y * N + x], x, y, false);
    this.score = s.Score;
    this.UpdateHud();
  }

  private Animate(dt: number) {
    for (let i = this.tiles.length - 1; i >= 0; i--) {
      const t = this.tiles[i];
      if (t.T < 1) {
        t.T = Math.min(1, t.T + dt / SlideTime);
        t.Rt.anchoredPosition = V2.lerp(t.From, t.To, Ease.outCubic(t.T));
        if (t.T >= 1 && t.Dying) { this.tiles.splice(i, 1); t.Rt.destroy(); continue; }
      } else t.Rt.anchoredPosition = t.To;
      let s = 1;
      if (t.Spawn < 1) { t.Spawn = Math.min(1, t.Spawn + dt * 6); s = Ease.outBack(t.Spawn); }
      if (t.Pop < 0) {
        t.Pop += dt;
        const v = this.pendingValue.get(t);
        if (t.Pop >= 0 && v !== undefined) {
          this.pendingValue.delete(t);
          this.SetValue(t, v);
          t.Pop = 1;
          this.OnMerged(t);
        }
      } else if (t.Pop > 0) {
        t.Pop = Math.max(0, t.Pop - dt * 6);
        s = 1 + Math.sin(t.Pop * Math.PI) * 0.18;
      }
      t.Rt.localScale = new V3(s, s, 1);
    }
    if (this.spawnPending && this.animTimer <= 0) {
      this.spawnPending = false;
      this.SpawnRandom();
      if (!this.CanMove()) {
        this.ended = true;
        this.endTimer = 1;
        this.UI.Announce("NO MORE MOVES", Pal.Danger, 1.2);
        Sfx.play(Snd.Lose, 0.7);
      }
    }
  }

  private OnMerged(t: Tile) {
    if (t.Value > this.biggest) {
      this.biggest = t.Value;
      if (this.biggest >= 128) this.UI.Float(V2.zero, this.biggest + "!", colorFor(this.biggest), 1.2);
    }
    if (t.Value === 2048 && !this.won2048) {
      this.won2048 = true;
      this.Data.add("wins", 1);
      this.UI.Announce("2048!", Gold, 2);
      this.fx.confetti(new V2(0, this.ViewSize.y * 0.3), 90, 10, TileColors);
      Sfx.play(Snd.Win);
    }
    if (t.Value >= 256) Fx.haptic(t.Value >= 1024);
  }

  private CanMove() {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const t = this.grid[x][y];
        if (!t) return true;
        const v = this.Val(t);
        if (x + 1 < N && this.grid[x + 1][y] && this.Val(this.grid[x + 1][y]!) === v) return true;
        if (y + 1 < N && this.grid[x][y + 1] && this.Val(this.grid[x][y + 1]!) === v) return true;
      }
    return false;
  }

  private Val(t: Tile) { return this.pendingValue.get(t) ?? t.Value; }

  private OnUndo() {
    if (this.State !== Phase.Playing || this.ended || this.history.length === 0 || this.animTimer > 0) return;
    if (this.undos > 0) this.undos--;
    else if (!CasualUI.useOrEarn(() => this.Undos, (v) => (this.Undos = v), this.UI, "+1 UNDO")) return;
    this.Restore(this.history.pop()!);
    Sfx.play(Snd.Whoosh, 0.5);
  }

  private UpdateHud() {
    CasualUI.setText(this.scoreText, Fmt.n(this.score));
    CasualUI.setText(this.bestText, Fmt.n(Math.max(this.best, this.score)));
    CasualUI.setText(this.bigText, `BIGGEST TILE: ${Fmt.n(this.biggest)}`);
    const total = this.undos + this.Undos;
    if (this.undoButton.label) CasualUI.setText(this.undoButton.label, total > 0 ? `UNDO ×${total}` : AdService.rewardedAvailable ? "UNDO +AD" : "UNDO");
    this.undoButton.interactable = !this.ended && this.history.length > 0 && (total > 0 || AdService.rewardedAvailable);
  }

  private Lose() {
    const newBest = this.Data.max("best", this.score);
    this.Data.max("tile", this.biggest);
    this.Finish(new Result({
      Headline: this.won2048 ? "YOU MADE 2048!" : newBest ? "NEW BEST SCORE!" : "GAME OVER",
      HeadlineColor: this.won2048 || newBest ? Gold : Pal.hex(0xffd2c2),
      Value: Fmt.n(this.score),
      CountTo: this.score,
      NewBest: newBest,
      BestLine: `BIGGEST TILE: ${Fmt.n(this.biggest)}`,
      Stats: [["SCORE", Fmt.n(this.score)], ["MOVES", String(this.moves)], ["BIGGEST", Fmt.n(this.biggest)], ["BEST", Fmt.n(this.Data.get("best"))]],
      Primary: "NEW GAME",
      Victory: this.won2048,
      Reward: this.revived || this.history.length === 0 ? null : () => this.UndoThree(),
      RewardLabel: "UNDO 3 MOVES & CONTINUE (AD)",
    }));
  }

  private UndoThree() {
    this.revived = true;
    this.ended = false;
    const k = Math.min(3, this.history.length);
    const s = this.history[this.history.length - k];
    this.history.splice(this.history.length - k, k);
    this.Restore(s);
    this.pointer.reset();
    this.Revive();
    this.UI.Announce("BACK IN THE GAME!", Coral, 1.1);
  }
}
