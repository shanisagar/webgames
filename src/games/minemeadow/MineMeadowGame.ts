import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, CasualUI, Color, Fmt, Fx, GameInfo,
  GameObject, howTo, Image, Mathf, Pal, Phase, Result, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer, Text,
  TextAnchor, TouchScheme, UIKit, UINode, V2, V2i, V3,
} from "../../kit";

/**
 * MINE MEADOW: classic Minesweeper in a sunny meadow. Tap grass to dig; numbers tell how many hidden mines
 * touch that square. Long-press (or switch to FLAG mode) to plant a flag. Tap a number whose flags are all
 * placed to dig around it. The first dig is always safe. Three sizes with best times. A SCAN hint reveals a
 * safe square and, after hitting a mine, a rewarded ad can undo the blast once. UI-drawn for crisp numbers.
 * (Port of MineMeadowGame.cs.)
 */

const TopBand = 220, BottomBand = 190;

const SizeNames = ["SMALL", "MEDIUM", "LARGE"];
const SizeW = [9, 10, 12], SizeH = [9, 14, 18], SizeMines = [10, 24, 44];
const GrassA = Pal.hex(0x9ddb6a), GrassB = Pal.hex(0x8ed15e), SoilA = Pal.hex(0xf2ddb6), SoilB = Pal.hex(0xead3a8),
  Ink = Pal.hex(0x2f3b22), Red = Pal.hex(0xe8404a), Gold = Pal.hex(0xffb627), Leaf = Pal.hex(0x3e9e3a);
const NumberColors = [
  Color.clear, Pal.hex(0x2f6fd6), Pal.hex(0x2e9e47), Pal.hex(0xe0403c), Pal.hex(0x6a3fc2), Pal.hex(0xa8541e), Pal.hex(0x1d9a9a), Pal.hex(0x333333), Pal.hex(0x888888),
];

class Cell {
  Bg!: Image; Icon!: Image;
  Num!: Text;
  Mine = false; Open = false; Flag = false;
  Count = 0;
  Pop = 0; Delay = 0;
}

// ------------------------------------------------------------------ art

const Tile = () => CasualArt.make("mm-tile", 64, 64, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.96, 0.96), 0.18);
  const c = Color.lerp(new Color(0.88, 0.88, 0.88, 1), Color.white, CasualArt.smooth(-1, 1, p.y));
  return c.withAlpha(CasualArt.fill(d, 2 / 64));
});

const FlagSprite = () => CasualArt.make("mm-flag", 96, 96, (p) => {
  const px = 2 / 96;
  let c = new Color(1, 1, 1, 0);
  const pole = CasualArt.sdBox(p.sub(new V2(-0.2, -0.05)), new V2(0.06, 0.7), 0.03);
  c = CasualArt.over(c, Pal.hex(0x5a4030), CasualArt.fill(pole, px));
  const flag = Math.max(Math.max(-(p.x + 0.15), (p.x + 0.15) * 0.75 + Math.abs(p.y - 0.38) - 0.55), Math.abs(p.y - 0.38) - 0.3);
  c = CasualArt.over(c, Pal.hex(0xe8404a), CasualArt.fill(flag, px));
  const b = CasualArt.sdBox(p.sub(new V2(-0.2, -0.72)), new V2(0.32, 0.08), 0.05);
  c = CasualArt.over(c, Pal.hex(0x5a4030), CasualArt.fill(b, px));
  return c;
});

const MineSprite = () => CasualArt.make("mm-mine", 96, 96, (p) => {
  const px = 2 / 96;
  let c = CasualArt.ballPixel(p.add(new V2(0, 0.05)), Pal.hex(0x343848), px, 0.62);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 4;
    const dir = new V2(Math.cos(a), Math.sin(a));
    const spike = CasualArt.sdSegment(p, dir.neg().mul(0.8), dir.mul(0.8)) - 0.06;
    c = CasualArt.over(c, Pal.hex(0x343848), CasualArt.fill(spike, px) * (1 - c.a * 0) * (c.a < 0.99 ? 1 : 0));
  }
  c = CasualArt.over(c, Color.white, CasualArt.fill(CasualArt.sdCircle(p, new V2(-0.2, 0.25), 0.12), px) * 0.8);
  return c;
});

const Backdrop = () => CasualArt.make("mm-bg", 128, 256, (p) => {
  let c = Color.lerp(Pal.hex(0xbfe9ff), Pal.hex(0x8fd3ff), CasualArt.smooth(0, 2, p.y));
  const hill = -0.4 + 0.2 * Math.sin(p.x * 2.3 + 0.4);
  if (p.y < hill) c = Color.lerp(Pal.hex(0xa8e07c), Pal.hex(0x7cc152), CasualArt.smooth(hill, -2, p.y));
  const fl = Math.sin(p.x * 37 + p.y * 9) * Math.sin(p.y * 41 - p.x * 5);
  if (p.y < hill - 0.1 && fl > 0.94) c = Color.lerp(c, Math.sin(p.x * 11) > 0 ? Pal.hex(0xffffff) : Pal.hex(0xffe36a), 0.9);
  return c.withAlpha(1);
});

export class MineMeadowGame extends ArcadeGame {
  private world!: GameObject;
  private bgCover!: SpriteRenderer;
  private board!: UINode; private gridRoot!: UINode;
  private cells: Cell[][] = [];
  private W = 0; private H = 0; private mines = 0; private size = 0; private opened = 0; private flags = 0;
  private cellSize = 0; private timer = 0; private endTimer = 0;
  private placed = false; private ended = false; private won = false; private revived = false; private flagMode = false; private built = false; private pressHandled = false;
  private lastBlast = V2i.zero;
  private readonly pointer = new TapPointer();
  private fx!: CasualFx;
  private rng = new SysRandom();
  private lastW = 0; private lastH = 0;
  private gridOrigin = V2.zero;

  private minesText!: Text; private timeText!: Text; private sizeText!: Text;
  private flagButton!: ArcadeButton; private scanButton!: ArcadeButton;
  private readonly sizeButtons: (ArcadeButton | null)[] = [null, null, null];
  private digClip!: AudioClip; private flagClip!: AudioClip; private boomClip!: AudioClip; private cascadeClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "minemeadow",
      Title: "MINE MEADOW",
      Tagline: "DIG SAFE. FLAG THE MINES.",
      Accent: Leaf,
      Accent2: Gold,
      BgTop: Pal.hex(0xbfe9ff),
      BgBottom: Pal.hex(0x9ddb6a),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 92, rootHz: 146.8, degrees: [0, 4, 5, 3], seed: 70, energy: 0.25, major: true },
      Reminders: [
        "The meadow needs clearing|Can you find every mine?",
        "Beat your best time|A quick game of Mine Meadow?",
        "Feeling lucky?|Try the LARGE meadow today.",
      ],
      HowTo: [
        howTo(Art.Square, GrassA, "TAP grass to dig. Your first dig is always safe."),
        howTo(Art.Square, NumberColors[1], "A NUMBER tells how many mines touch that square (including diagonals)."),
        howTo(FlagSprite(), Color.white, "LONG-PRESS (or use FLAG mode) to mark a mine with a flag."),
        howTo(Art.Ring, Leaf, "Tap a number whose mines are all flagged to dig all around it."),
        howTo(MineSprite(), Color.white, "Dig up every safe square to win. Digging a mine ends the game!"),
      ],
      Tips: [
        "A 1 touching only one hidden square: that square is a mine.",
        "Corners and edges are where the easy clues are.",
        "Flag mines first, then tap the numbers to clear around them fast.",
        "When a number is satisfied, every other neighbour is safe.",
        "Stuck with a guess? SCAN reveals one safe square.",
      ],
    });
  }

  protected get ShortSide() { return 9; }
  private get SizeSetting() { return Mathf.clamp(this.Data.get("size"), 0, 2); }
  private set SizeSetting(v: number) { this.Data.set("size", Mathf.clamp(v, 0, 2)); }
  private get Scans() { return this.Data.get("scan", 3); }
  private set Scans(v: number) { this.Data.set("scan", Math.max(0, v)); }

  protected BestLine() {
    const b = this.Data.get("best" + this.SizeSetting);
    return SizeNames[this.SizeSetting] + (b > 0 ? "   ·   BEST " + Fmt.clock(b / 1000) : "");
  }

  protected StatsLine() { return `${this.Data.get("wins")} MEADOWS CLEARED   ·   ${this.Data.get("games")} GAMES`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("MeadowWorld", this.gameObject);
    CasualLook.calm(this, 1.3, 0.12);
    this.bgCover = CasualLook.cover(this.world, Backdrop(), -910);
    this.fx = CasualFx.create(this.world, 50, 200);
    this.board = UIKit.node("Board", this.UI.Hud).stretch();
    this.board.setAsFirstSibling();
    this.gridRoot = UIKit.node("Grid", this.board);

    const hud = this.UI.Hud;
    const plate = UIKit.img(hud, "TopPlate", Art.UiRound, new Color(1, 1, 1, 0.85));
    plate.rectTransform.place(new V2(0.5, 1), new V2(-60, -86), new V2(820, 110));
    const mineIcon = UIKit.img(plate.rectTransform, "MineIcon", MineSprite(), Color.white);
    mineIcon.rectTransform.place(new V2(0, 0.5), new V2(70, 0), new V2(70, 70));
    this.minesText = UIKit.at(UIKit.label(plate.rectTransform, "", 40, Ink, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(200, 0), new V2(160, 60));
    this.sizeText = UIKit.at(UIKit.label(plate.rectTransform, "", 28, Leaf), UIKit.Center, V2.zero, new V2(220, 50));
    this.timeText = UIKit.at(UIKit.label(plate.rectTransform, "0:00", 40, Ink), new V2(1, 0.5), new V2(-110, 0), new V2(180, 60));

    this.flagButton = UIKit.buttonAt(hud, "DIG", new V2(0.5, 0), new V2(-170, 90), new V2(300, 120), true, () => this.ToggleFlag(), 32, FlagSprite());
    this.flagButton.setAccent(Leaf);
    this.scanButton = UIKit.buttonAt(hud, "SCAN", new V2(0.5, 0), new V2(170, 90), new V2(300, 120), false, () => this.OnScan(), 30);
    this.scanButton.setAccent(Gold);

    if (this.UI.TitleExtra) {
      CasualLook.titleCard(this.UI, new Color(0.17, 0.33, 0.14, 0.86));
      for (let i = 0; i < 3; i++) {
        const s = i;
        this.sizeButtons[i] = UIKit.buttonAt(this.UI.TitleExtra, SizeNames[i], UIKit.Center, new V2((i - 1) * 300, 0), new V2(280, 90), false, () => this.PickSize(s), 28);
      }
      this.RefreshSizes();
    }

    const noise = new SysRandom(6);
    const N = () => noise.nextDouble() * 2 - 1;
    this.digClip = Sfx.make("mm-dig", 0.09, (t) => (N() * 0.5 + Sfx.sinP(Sfx.glide(t, 300, 160, 0.07)) * 0.5) * Sfx.env(t, 0.002, 0.07) * 0.25);
    this.flagClip = Sfx.make("mm-flag", 0.12, (t) => Sfx.sinP(Sfx.glide(t, 600, 900, 0.08)) * Sfx.env(t, 0.002, 0.1) * 0.25);
    let lp = 0;
    this.boomClip = Sfx.make("mm-boom", 0.7, (t) => { lp += (N() - lp) * 0.2; return (lp + Sfx.sinP(Sfx.glide(t, 120, 40, 0.5)) * 0.6) * Sfx.env(t, 0.002, 0.6) * 0.5; });
    this.cascadeClip = Sfx.make("mm-cascade", 0.3, (t) => (N() * 0.2 * Sfx.env(t, 0.01, 0.1) + Sfx.sinP(Sfx.glide(t, 500, 1200, 0.25)) * 0.3) * Sfx.env(t, 0.005, 0.25) * 0.4);
    this.built = true;
  }

  private PickSize(s: number) {
    this.SizeSetting = s;
    Sfx.play(Snd.Click, 0.6);
    this.RefreshSizes();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private RefreshSizes() {
    for (let i = 0; i < 3; i++) this.sizeButtons[i]?.setAccent(i === this.SizeSetting ? Gold : Leaf);
  }

  // ------------------------------------------------------------------ board

  private NewBoard() {
    this.size = this.SizeSetting;
    this.W = SizeW[this.size];
    this.H = SizeH[this.size];
    this.mines = SizeMines[this.size];
    for (let i = this.gridRoot.childCount - 1; i >= 0; i--) this.gridRoot.getChild(i).destroy();
    this.cells = [];
    for (let y = 0; y < this.H; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < this.W; x++) {
        const c = new Cell();
        c.Bg = UIKit.img(this.gridRoot, "Cell", Tile(), Color.white);
        c.Icon = UIKit.img(c.Bg.rectTransform, "Icon", FlagSprite(), Color.white);
        c.Icon.rectTransform.stretch(6);
        c.Icon.enabled = false;
        c.Num = UIKit.label(c.Bg.rectTransform, "", 40, Ink);
        c.Num.rectTransform.stretch();
        row.push(c);
      }
      this.cells.push(row);
    }
    this.placed = false;
    this.opened = this.flags = 0;
    this.Layout();
  }

  private PlaceMines(sx: number, sy: number) {
    let n = 0;
    while (n < this.mines) {
      const x = this.rng.next(this.W), y = this.rng.next(this.H);
      if (this.cells[y][x].Mine || (Math.abs(x - sx) <= 1 && Math.abs(y - sy) <= 1)) continue;
      this.cells[y][x].Mine = true;
      n++;
    }
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        let k = 0;
        this.ForNeighbors(x, y, (nx, ny) => { if (this.cells[ny][nx].Mine) k++; });
        this.cells[y][x].Count = k;
      }
    this.placed = true;
  }

  private ForNeighbors(x: number, y: number, f: (nx: number, ny: number) => void) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < this.W && ny >= 0 && ny < this.H) f(nx, ny);
      }
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    if (!this.built || this.W === 0) return;
    const r = this.board.rect;
    this.lastW = r.width;
    this.lastH = r.height;
    const availW = r.width - 30, availH = r.height - TopBand - BottomBand - 20;
    // in landscape, rotate tall boards to use the width
    this.cellSize = Math.min(availW / this.W, availH / this.H, 120);
    const gw = this.W * this.cellSize, gh = this.H * this.cellSize;
    const origin = new V2(-gw * 0.5, r.height * 0.5 - TopBand - (availH - gh) * 0.5);
    this.gridRoot.place(UIKit.Center, V2.zero, new V2(10, 10));
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const c = this.cells[y][x];
        c.Bg.rectTransform.place(UIKit.Center, origin.add(new V2((x + 0.5) * this.cellSize, -(y + 0.5) * this.cellSize)), new V2(this.cellSize - 2, this.cellSize - 2));
        c.Num.fontSize = Mathf.roundToInt(this.cellSize * 0.58);
      }
    this.gridOrigin = origin;
    this.Refresh();
  }

  private CellAt(screen: V2): [boolean, number, number] {
    const local = this.gridRoot.screenToLocal(screen);
    const d = local.sub(this.gridOrigin);
    const x = Math.floor(d.x / this.cellSize);
    const y = Math.floor(-d.y / this.cellSize);
    return [x >= 0 && x < this.W && y >= 0 && y < this.H, x, y];
  }

  // ------------------------------------------------------------------ lifecycle

  protected BeginRun() {
    this.rng = new SysRandom();
    this.NewBoard();
    this.timer = 0;
    this.ended = this.won = this.revived = this.flagMode = false;
    this.pointer.reset();
    this.pointer.topBand = 0.08;
    this.Data.add("games", 1);
    if (this.Data.get("games") === 1) this.UI.Hint("Tap to dig. Long-press to plant a flag.");
    Sfx.setIntensity(0);
    this.Refresh();
  }

  protected OnEnterTitle() { this.RefreshSizes(); }

  // ------------------------------------------------------------------ frame

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    if (Math.abs(this.board.rect.width - this.lastW) > 1 || Math.abs(this.board.rect.height - this.lastH) > 1) this.Layout();
    this.Animate(dt);
    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.State === Phase.Playing) { if (this.won) this.Win(); else this.Lose(); }
      return;
    }
    if (this.placed) this.timer += dt;
    if (this.pointer.down) this.pressHandled = false;
    // long-press flags
    if (this.pointer.held && !this.pressHandled && this.pointer.heldTime > 0.38 && this.pointer.screen.sub(this.pointer.startScreen).magnitude < TapPointer.dp(14)) {
      this.pressHandled = true;
      const [ok, fx0, fy0] = this.CellAt(this.pointer.screen);
      if (ok) this.ToggleFlagAt(fx0, fy0);
    }
    if (this.pointer.up && !this.pressHandled && this.pointer.tap) {
      const [ok, x, y] = this.CellAt(this.pointer.screen);
      if (ok) {
        this.UI.Hint(null);
        if (this.flagMode) this.ToggleFlagAt(x, y);
        else this.Dig(x, y);
      }
    }
    CasualUI.setText(this.timeText, Fmt.clock(this.timer));
  }

  private ToggleFlagAt(x: number, y: number) {
    const c = this.cells[y][x];
    if (c.Open) return;
    c.Flag = !c.Flag;
    this.flags += c.Flag ? 1 : -1;
    c.Pop = 1;
    Sfx.playClip(this.flagClip, 0.6, c.Flag ? 1 : 0.8);
    Fx.haptic();
    this.Refresh();
  }

  private Dig(x: number, y: number) {
    const c = this.cells[y][x];
    if (c.Flag) return;
    if (!this.placed) this.PlaceMines(x, y);
    if (c.Open) {
      // chord: dig around a satisfied number
      if (c.Count === 0) return;
      let f = 0;
      this.ForNeighbors(x, y, (nx, ny) => { if (this.cells[ny][nx].Flag) f++; });
      if (f !== c.Count) { c.Pop = 0.6; return; }
      let any = false;
      this.ForNeighbors(x, y, (nx, ny) => {
        const n = this.cells[ny][nx];
        if (!n.Open && !n.Flag) { any = true; this.OpenCell(nx, ny, 0); }
      });
      if (any) Sfx.playClip(this.cascadeClip, 0.6);
      this.AfterDig();
      return;
    }
    this.OpenCell(x, y, 0);
    Sfx.playClip(this.digClip, 0.7, 0.9 + this.rng.nextDouble() * 0.2);
    this.AfterDig();
  }

  private OpenCell(x: number, y: number, _delay: number) {
    const c = this.cells[y][x];
    if (c.Open || c.Flag) return;
    if (c.Mine) {
      this.Blast(x, y);
      return;
    }
    // flood fill zeros (breadth first so the reveal ripples outwards)
    const queue: V2i[] = [new V2i(x, y)];
    c.Open = true;
    this.opened++;
    c.Delay = 0;
    let ripple = 0;
    while (queue.length > 0) {
      const p = queue.shift()!;
      const pc = this.cells[p.y][p.x];
      pc.Pop = 1;
      if (pc.Count !== 0) continue;
      this.ForNeighbors(p.x, p.y, (nx, ny) => {
        const n = this.cells[ny][nx];
        if (n.Open || n.Flag || n.Mine) return;
        n.Open = true;
        this.opened++;
        n.Delay = (Math.abs(nx - x) + Math.abs(ny - y)) * 0.025;
        ripple++;
        queue.push(new V2i(nx, ny));
      });
    }
    if (ripple > 6) Sfx.playClip(this.cascadeClip, 0.7);
  }

  private Blast(x: number, y: number) {
    this.ended = true;
    this.won = false;
    this.endTimer = 1.6;
    this.lastBlast = new V2i(x, y);
    const c = this.cells[y][x];
    c.Open = true;
    c.Pop = 1;
    Sfx.playClip(this.boomClip, 1);
    this.Fx.shake(0.5);
    Fx.haptic(true);
    // show the other mines one after another
    for (let yy = 0; yy < this.H; yy++)
      for (let xx = 0; xx < this.W; xx++) {
        const m = this.cells[yy][xx];
        if (m.Mine && !m.Flag && !(xx === x && yy === y)) { m.Delay = 0.15 + (Math.abs(xx - x) + Math.abs(yy - y)) * 0.03; m.Pop = 1; }
      }
    this.UI.Announce("BOOM!", Red, 1.2);
    this.Refresh();
  }

  private AfterDig() {
    if (this.ended) return;
    if (this.opened >= this.W * this.H - this.mines) {
      this.ended = true;
      this.won = true;
      this.endTimer = 1.6;
      for (let y = 0; y < this.H; y++)
        for (let x = 0; x < this.W; x++)
          if (this.cells[y][x].Mine && !this.cells[y][x].Flag) { this.cells[y][x].Flag = true; this.cells[y][x].Pop = 1; this.cells[y][x].Delay = (x + y) * 0.02; }
      this.UI.Announce("MEADOW CLEARED!", Leaf, 1.6);
      this.fx.confetti(new V2(0, this.ViewSize.y * 0.3), 70, 9, [Red, Gold, Leaf, Pal.hex(0x3fa2f5), Color.white]);
      Sfx.play(Snd.Win);
    }
    this.Refresh();
  }

  // ------------------------------------------------------------------ visuals

  private Refresh() {
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const c = this.cells[y][x];
        const alt = (x + y) % 2 === 0;
        const showOpen = c.Open && c.Delay <= 0;
        const showMine = c.Mine && this.ended && !this.won && (c.Open || c.Delay <= 0) && !c.Flag;
        if (showMine) {
          c.Bg.color = x === this.lastBlast.x && y === this.lastBlast.y ? Red : SoilA;
          c.Icon.enabled = true;
          c.Icon.sprite = MineSprite();
          c.Num.text = "";
          continue;
        }
        if (showOpen) {
          c.Bg.color = alt ? SoilA : SoilB;
          c.Icon.enabled = false;
          c.Num.text = c.Count > 0 ? String(c.Count) : "";
          c.Num.color = NumberColors[c.Count];
        } else {
          c.Bg.color = alt ? GrassA : GrassB;
          c.Num.text = "";
          const wrongFlag = c.Flag && this.ended && !this.won && !c.Mine;
          c.Icon.enabled = c.Flag;
          c.Icon.sprite = FlagSprite();
          c.Icon.color = wrongFlag ? new Color(1, 1, 1, 0.35) : Color.white;
        }
      }
    CasualUI.setText(this.minesText, String(this.mines - this.flags));
    CasualUI.setText(this.sizeText, SizeNames[this.size]);
    if (this.flagButton.label) this.flagButton.label.text = this.flagMode ? "FLAG MODE" : "DIG MODE";
    this.flagButton.setAccent(this.flagMode ? Red : Leaf);
    CasualUI.booster(this.scanButton, "SCAN", this.Scans, !this.ended);
  }

  private Animate(dt: number) {
    let changed = false;
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const c = this.cells[y][x];
        if (c.Delay > 0) {
          c.Delay -= dt;
          if (c.Delay <= 0) changed = true;
          continue;
        }
        if (c.Pop <= 0) continue;
        c.Pop = Math.max(0, c.Pop - dt * 4);
        const s = 1 + Math.sin(c.Pop * Math.PI) * 0.15;
        c.Bg.rectTransform.localScale = new V3(s, s, 1);
      }
    if (changed) this.Refresh();
  }

  private ToggleFlag() {
    if (this.State !== Phase.Playing || this.ended) return;
    this.flagMode = !this.flagMode;
    Sfx.play(Snd.Click, 0.5);
    this.Refresh();
  }

  private OnScan() {
    if (this.State !== Phase.Playing || this.ended) return;
    if (!this.placed) { this.UI.Toast("Dig your first square first: it's always safe!", 2.5); return; }
    if (!CasualUI.useOrEarn(() => this.Scans, (v) => (this.Scans = v), this.UI, "+1 SCAN")) return;
    // prefer a safe square next to opened ground (most useful), else any
    let best = new V2i(-1, -1);
    let bestScore = -1;
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const c = this.cells[y][x];
        if (c.Open || c.Mine || c.Flag) continue;
        let sc = this.rng.next(3);
        this.ForNeighbors(x, y, (nx, ny) => { if (this.cells[ny][nx].Open) sc += 4; });
        if (sc > bestScore) { bestScore = sc; best = new V2i(x, y); }
      }
    if (best.x < 0) return;
    this.OpenCell(best.x, best.y, 0);
    this.cells[best.y][best.x].Pop = 1.5;
    Sfx.play(Snd.PowerUp, 0.5);
    this.AfterDig();
  }

  // ------------------------------------------------------------------ results

  private Win() {
    const ms = Mathf.roundToInt(this.timer * 1000);
    const best = this.Data.min("best" + this.size, ms);
    this.Data.add("wins", 1);
    const par = SizeMines[this.size] * 6;
    const stars = this.timer <= par ? 3 : this.timer <= par * 2 ? 2 : 1;
    this.Finish(new Result({
      Headline: best ? "NEW BEST TIME!" : "MEADOW CLEARED!",
      HeadlineColor: Gold,
      Stars: stars,
      Value: Fmt.clock(this.timer),
      NewBest: best,
      BestLine: `${SizeNames[this.size]} · BEST ${Fmt.clock(this.Data.get("best" + this.size) / 1000)}`,
      Stats: [["TIME", Fmt.clock(this.timer)], ["MINES", String(this.mines)], ["SIZE", `${this.W}×${this.H}`], ["WINS", String(this.Data.get("wins"))]],
      Primary: "NEW MEADOW",
      Victory: true,
      Reward: () => { this.Scans = this.Scans + 2; this.UI.Toast("+2 SCANS", 2); },
      RewardLabel: "GET 2 FREE SCANS (WATCH AD)",
    }));
  }

  private Lose() {
    const safe = this.W * this.H - this.mines;
    this.Finish(new Result({
      Headline: "YOU HIT A MINE",
      HeadlineColor: Pal.hex(0xffc9c0),
      Value: Mathf.roundToInt((this.opened * 100) / Math.max(1, safe)) + "%",
      BestLine: "OF THE MEADOW CLEARED",
      Stats: [["TIME", Fmt.clock(this.timer)], ["SIZE", `${this.W}×${this.H}`], ["MINES", String(this.mines)], ["WINS", String(this.Data.get("wins"))]],
      Primary: "TRY AGAIN",
      Reward: this.revived ? null : () => this.UndoBlast(),
      RewardLabel: "UNDO THE BLAST (WATCH AD)",
    }));
  }

  private UndoBlast() {
    this.revived = true;
    this.ended = false;
    const c = this.cells[this.lastBlast.y][this.lastBlast.x];
    c.Open = false;
    c.Flag = true;
    this.flags++;
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) this.cells[y][x].Delay = 0;
    this.pointer.reset();
    this.Revive();
    this.Refresh();
    this.UI.Announce("PHEW! FLAGGED IT", Leaf, 1.2);
  }
}
