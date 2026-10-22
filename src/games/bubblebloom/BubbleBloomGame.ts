import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Ease, Fmt, Fx, GameInfo,
  GameObject, howTo, Image, Mathf, Pal, Phase, Quaternion, Result, Sfx, Snd, Sprite, SpriteRenderer, SysRandom, TapPointer,
  Text, TextAnchor, Time, TouchScheme, UIKit, V2, V2i, V3,
} from "../../kit";
import { BubbleBloomArt } from "./BubbleBloomArt";

/**
 * BUBBLE BLOOM: a level-based bubble shooter. Drag to aim (the dotted line shows the bounce), let go to shoot.
 * Three or more bubbles of one colour pop; bubbles left hanging drop for bonus points. Each level hides flower
 * buds in bubbles near the top: free them all before you run out of shots. Bombs and rainbow bubbles are
 * boosters (refillable with a rewarded ad); a rewarded ad also gives +5 shots once per level.
 * (Port of BubbleBloomGame.cs.)
 */

// ------------------------------------------------------------------ tuning

const TopBand = 260, BottomBand = 120;
const Cols = 11, MaxRows = 20;
const D = 0.84, R = D * 0.5, RowH = D * 0.8660254;
const BoardW = Cols * D;
const ShotSpeed = 24;
const MaxFalling = 140, MaxPops = 80, AimDots = 46;

const Ink = Pal.hex(0x22405a), Pink = Pal.hex(0xff5c9a), Leaf = Pal.hex(0x3db54a), Sky = Pal.hex(0x3fa2f5), Gold = Pal.hex(0xffb627);

const Empty = -1, BombColor = 100, RainbowColor = 101;

class Cell {
  Color = Empty;
  Bud = false;
  Sr!: SpriteRenderer; BudSr!: SpriteRenderer;
  Offset = V2.zero; OffVel = V2.zero;
  Pop = 1;
}

class Falling {
  Sr!: SpriteRenderer; BudSr: SpriteRenderer | null = null;
  Pos = V2.zero; Vel = V2.zero;
  Spin = 0; Rot = 0;
  Active = false; Popping = false;
  T = 0;
  Color = 0;
}

class Bloom {
  Sr!: SpriteRenderer;
  From = V2.zero; To = V2.zero;
  T = 0;
  Active = false;
}

const PanelSprite = () => CasualArt.make("bb-panel", 128, 256, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.98, 1.98), 0.18);
  const a = CasualArt.fill(d, 2 / 128);
  const edge = CasualArt.fill(d + 0.03, 2 / 128);
  return new Color(1, 1, 1, a * Mathf.lerp(0.75, 0.3, edge));
});

const DashSprite = () => CasualArt.make("bb-dash", 512, 16, (p) => {
  const on = Mathf.repeat(p.x * 9, 1) < 0.6 ? 1 : 0;
  return new Color(1, 1, 1, on * CasualArt.fill(Math.abs(p.y) - 0.016, 2 / 512));
});

const Valid = (r: number, c: number) => r >= 0 && r < MaxRows && c >= 0 && c < (r % 2 === 0 ? Cols : Cols - 1);

function TryAdd(list: V2i[], r: number, c: number) {
  if (Valid(r, c)) list.push(new V2i(c, r));
}

function PatternHas(pattern: number, r: number, c: number, n: number, rows: number) {
  const mid = (n - 1) * 0.5;
  switch (pattern) {
    case 1: return Math.abs(c - mid) <= (rows - r) * 0.75 + 0.5; // inverted pyramid
    case 2: return r < 3 || Math.abs(c - mid) > 2.2; // two pillars
    case 3: return r < 2 || (r + c) % 4 !== 0; // holes
    case 4: return r < 3 + Mathf.roundToInt(2.5 + 2.5 * Math.sin(c * 0.8)); // wave
    default: return true;
  }
}

const SpriteFor = (color: number): Sprite =>
  color === BombColor ? BubbleBloomArt.Bomb : color === RainbowColor ? BubbleBloomArt.Rainbow : BubbleBloomArt.Bubble(Mathf.clamp(color, 0, BubbleBloomArt.Colors - 1));

export class BubbleBloomGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject; private board!: GameObject;
  private bgCover!: SpriteRenderer; private boardPanel!: SpriteRenderer; private dangerLine!: SpriteRenderer; private pot!: SpriteRenderer;
  private flySr!: SpriteRenderer; private loadSr!: SpriteRenderer; private nextSr!: SpriteRenderer; private nextRing!: SpriteRenderer;
  private readonly vines: SpriteRenderer[] = [];
  private readonly dots: SpriteRenderer[] = new Array(AimDots);
  private readonly grid: Cell[][] = Array.from({ length: MaxRows }, () => new Array<Cell>(Cols));
  private readonly falling: Falling[] = new Array(MaxFalling);
  private readonly pops: Falling[] = new Array(MaxPops);
  private readonly blooms: Bloom[] = [];
  private fx!: CasualFx;
  private readonly pointer = new TapPointer();

  private top = 0; private left = 0; private shooterY = 0; private dangerY = 0;
  private shooterPos = V2.zero; private nextPos = V2.zero;

  private level = 0; private shots = 0; private startShots = 0; private buds = 0; private budsTotal = 0; private score = 0;
  private colorsInLevel = 0; private currentColor = 0; private nextColor = 0; private combo = 0;
  private flying = false; private aiming = false; private swapPress = false; private ended = false;
  private revived = false; private won = false;
  private flyPos = V2.zero; private flyVel = V2.zero; private aimDir = V2.up;
  private endTimer = 0; private keyAngle = 90; private loadAnim = 1; private attractTimer = 0; private attractAngle = 0;
  private rng = new SysRandom();

  // scratch
  private readonly queue: V2i[] = [];
  private readonly found: V2i[] = [];
  private readonly seen: boolean[][] = Array.from({ length: MaxRows }, () => new Array<boolean>(Cols).fill(false));
  private readonly nbrs: V2i[] = [];
  private readonly path: V2[] = [];

  // HUD
  private levelText!: Text; private scoreText!: Text; private budText!: Text; private shotsText!: Text;
  private budIcon!: Image;
  private bombButton!: ArcadeButton; private rainbowButton!: ArcadeButton;
  private readonly mapLabels: Text[] = [];
  private readonly mapNodes: Image[] = [];
  private readonly mapStars: Image[][] = [];
  private readonly mapNow: Text[] = [];

  private shootClip!: AudioClip; private popClip!: AudioClip; private attachClip!: AudioClip; private bloomClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "bubblebloom",
      Title: "BUBBLE BLOOM",
      Tagline: "POP BUBBLES. FREE THE FLOWERS.",
      Accent: Pink,
      Accent2: Gold,
      BgTop: Pal.hex(0x7ccbf5),
      BgBottom: Pal.hex(0xbfe9ff),
      ShortSide: 10,
      Touch: TouchScheme.None,
      Music: { bpm: 112, rootHz: 146.8, degrees: [0, 4, 5, 3], seed: 77, energy: 0.45, major: true },
      Reminders: [
        "The flowers are waiting|Pop the bubbles and let them bloom!",
        "A new garden level is ready|Can you clear it with 3 stars?",
        "Bubble trouble in the garden|Your buds need rescuing.",
      ],
      HowTo: [
        howTo(BubbleBloomArt.Bubble(0), Color.white, "DRAG to aim (the dotted line shows where it goes), LET GO to shoot."),
        howTo(BubbleBloomArt.Bubble(3), Color.white, "Match 3 or more of the same colour to POP them. Hanging bubbles drop for bonus points."),
        howTo(BubbleBloomArt.Bud, Color.white, "Free every FLOWER BUD before your shots run out to win the level."),
        howTo(BubbleBloomArt.Bubble(4), Color.white, "Tap the small bubble beside the pot to SWAP it with the one you're holding."),
        howTo(BubbleBloomArt.Bomb, Color.white, "BOMB blasts everything around it. RAINBOW matches any colour."),
        howTo(Art.Star, Gold, "Win with shots to spare for 3 stars."),
      ],
      Tips: [
        "Bounce shots off the side walls to reach tricky spots.",
        "Popping a bubble that holds others up drops them all for big points.",
        "Swap when your bubble doesn't fit anywhere useful.",
        "Each symbol matches its colour: hearts, stars, suns, leaves, drops and moons.",
        "Save your bomb for a bud stuck behind other colours.",
      ],
    });
  }

  protected get ShortSide() { return ArcadeGame.FitShortSide(new V2(BoardW + 0.5, 13 * RowH + D + 3.2), TopBand, BottomBand); }

  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }
  private get Bombs() { return this.Data.get("bombs", 2); }
  private set Bombs(v: number) { this.Data.set("bombs", Math.max(0, v)); }
  private get Rainbows() { return this.Data.get("rainbows", 1); }
  private set Rainbows(v: number) { this.Data.set("rainbows", Math.max(0, v)); }

  protected BestLine() { return `LEVEL ${this.CurrentLevel}   ·   ${this.Data.get("stars")} STARS`; }
  protected StatsLine() { return `${Fmt.n(this.Data.get("flowers"))} FLOWERS BLOOMED   ·   BEST ${Fmt.n(this.Data.get("best"))}`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("BubbleWorld", this.gameObject);
    const world = this.world;
    CasualLook.calm(this, 1.2, 0.16);
    this.bgCover = CasualLook.cover(world, BubbleBloomArt.Garden, -910);

    this.board = new GameObject("Board", world);
    this.boardPanel = Art.spr(world, "BoardPanel", PanelSprite(), Color.white, 1, -60, Art.Flat);
    this.dangerLine = Art.spr(world, "Danger", DashSprite(), new Color(1, 0.3, 0.4, 0.5), BoardW, -50, Art.Flat);

    for (let r = 0; r < MaxRows; r++)
      for (let c = 0; c < Cols; c++) {
        const cell = new Cell();
        cell.Sr = Art.spr(this.board, "Bubble", BubbleBloomArt.Bubble(0), Color.white, D * 1.04, 10, Art.Flat);
        cell.BudSr = Art.spr(this.board, "Bud", BubbleBloomArt.Bud, Color.white, D * 1.04, 11, Art.Flat);
        cell.Sr.gameObject.setActive(false);
        cell.BudSr.gameObject.setActive(false);
        this.grid[r][c] = cell;
      }
    for (let i = 0; i < MaxFalling; i++) {
      const f = new Falling();
      f.Sr = Art.spr(world, "Falling", BubbleBloomArt.Bubble(0), Color.white, D * 1.04, 20, Art.Flat);
      f.BudSr = Art.spr(world, "FallingBud", BubbleBloomArt.Bud, Color.white, D * 1.04, 21, Art.Flat);
      f.Sr.gameObject.setActive(false);
      f.BudSr.gameObject.setActive(false);
      this.falling[i] = f;
    }
    for (let i = 0; i < MaxPops; i++) {
      const f = new Falling();
      f.Sr = Art.spr(world, "Pop", BubbleBloomArt.Bubble(0), Color.white, D, 22, Art.Flat);
      f.Sr.gameObject.setActive(false);
      this.pops[i] = f;
    }
    for (let i = 0; i < AimDots; i++) {
      this.dots[i] = Art.spr(world, "AimDot", BubbleBloomArt.AimDot, Color.white, 0.17, 15, Art.Flat);
      this.dots[i].gameObject.setActive(false);
    }

    this.pot = Art.spr(world, "Pot", BubbleBloomArt.Pot, Color.white, 1.9, 30, Art.Flat);
    this.loadSr = Art.spr(world, "Loaded", BubbleBloomArt.Bubble(0), Color.white, D * 1.04, 31, Art.Flat);
    this.nextRing = Art.spr(world, "NextRing", CasualArt.Dot, new Color(1, 1, 1, 0.6), D * 0.95, 29, Art.Flat);
    this.nextSr = Art.spr(world, "Next", BubbleBloomArt.Bubble(0), Color.white, D * 0.78, 31, Art.Flat);
    this.flySr = Art.spr(world, "Flying", BubbleBloomArt.Bubble(0), Color.white, D * 1.04, 25, Art.Flat);
    this.flySr.gameObject.setActive(false);

    this.fx = CasualFx.create(world, 45, 320);
    this.BuildAudio();
    this.BuildHud();
    this.Layout();
  }

  private BuildAudio() {
    this.shootClip = Sfx.make("bb-shoot", 0.16, (t) => Sfx.sinP(Sfx.glide(t, 300, 700, 0.12)) * Sfx.env(t, 0.004, 0.13) * 0.28);
    this.popClip = Sfx.make("bb-pop", 0.12, (t) => (Sfx.sinP(Sfx.glide(t, 1100, 500, 0.06)) * 0.7 + Sfx.triP(Sfx.glide(t, 2200, 900, 0.05)) * 0.2) * Sfx.env(t, 0.001, 0.07) * 0.32);
    this.attachClip = Sfx.make("bb-attach", 0.09, (t) => Sfx.sinP(Sfx.glide(t, 420, 260, 0.07)) * Sfx.env(t, 0.002, 0.06) * 0.3);
    this.bloomClip = Sfx.make("bb-bloom", 0.5, (t) =>
      (Sfx.sinP(523.25 * t) * Sfx.env(t, 0.005, 0.3) + Sfx.sinP(659.25 * t) * Sfx.env(t - 0.08, 0.005, 0.3) + Sfx.sinP(783.99 * t) * Sfx.env(t - 0.16, 0.005, 0.32)) * 0.18);
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    const plate = UIKit.img(hud, "TopPlate", Art.UiRound, new Color(1, 1, 1, 0.82));
    plate.rectTransform.place(new V2(0.5, 1), new V2(-60, -100), new V2(820, 150));
    const pr = plate.rectTransform;

    this.levelText = UIKit.at(UIKit.label(pr, "LEVEL 1", 34, Ink, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(170, 28), new V2(300, 50));
    this.scoreText = UIKit.at(UIKit.label(pr, "0", 42, Ink, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(170, -26), new V2(300, 56));

    this.budIcon = UIKit.img(pr, "BudIcon", BubbleBloomArt.Flower(0), Color.white);
    this.budIcon.rectTransform.place(UIKit.Center, new V2(40, 0), new V2(96, 96));
    this.budText = UIKit.at(UIKit.label(pr, "0/0", 46, Pink, TextAnchor.MiddleLeft), UIKit.Center, new V2(170, 0), new V2(160, 60));
    UIKit.glow(this.budText, Color.white, 2);

    this.shotsText = UIKit.at(UIKit.label(pr, "0", 52, Ink), new V2(1, 0.5), new V2(-80, 10), new V2(140, 64));
    UIKit.at(UIKit.label(pr, "SHOTS", 22, Ink.withAlpha(0.7)), new V2(1, 0.5), new V2(-80, -38), new V2(140, 30));

    this.bombButton = UIKit.buttonAt(hud, "BOMB", new V2(0, 0), new V2(140, 110), new V2(220, 130), false, () => this.OnBomb(), 26, BubbleBloomArt.Bomb);
    this.bombButton.setAccent(Pal.hex(0xff7a45));
    this.rainbowButton = UIKit.buttonAt(hud, "RAINBOW", new V2(1, 0), new V2(-140, 110), new V2(220, 130), false, () => this.OnRainbow(), 26, BubbleBloomArt.Rainbow);
    this.rainbowButton.setAccent(Pal.hex(0xa66cff));

    if (this.UI.TitleExtra) {
      const extra = this.UI.TitleExtra;
      CasualLook.titleCard(this.UI, new Color(0.13, 0.3, 0.45, 0.84));
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * 180;
        if (i < 4) {
          const link = UIKit.img(extra, "Path", Art.UiRound, new Color(1, 1, 1, 0.35));
          link.rectTransform.place(UIKit.Center, new V2(x + 90, 8), new V2(110, 12));
        }
        const node = UIKit.img(extra, "Node", Art.UiCircle, Color.white);
        node.rectTransform.place(UIKit.Center, new V2(x, 8), new V2(80, 80));
        this.mapNodes.push(node);
        this.mapLabels.push(UIKit.at(UIKit.label(node.rectTransform, "1", 34, Ink), UIKit.Center, V2.zero, new V2(80, 80)));
        const st: Image[] = [];
        for (let k = 0; k < 3; k++) {
          st.push(UIKit.img(extra, "Star", Art.Star, Gold));
          st[k].rectTransform.place(UIKit.Center, new V2(x + (k - 1) * 28, -50), new V2(26, 26));
        }
        this.mapStars.push(st);
        this.mapNow.push(UIKit.at(UIKit.label(extra, "", 24, Gold), UIKit.Center, new V2(x, -52), new V2(160, 30)));
      }
    }
  }

  // ------------------------------------------------------------------ geometry

  private CellPos(r: number, c: number) { return new V2(this.left + c * D + (r % 2 === 1 ? R : 0), this.top - R - r * RowH); }

  private Neighbors(r: number, c: number, list: V2i[]) {
    list.length = 0;
    const o = r % 2 === 0 ? -1 : 0;
    TryAdd(list, r, c - 1);
    TryAdd(list, r, c + 1);
    TryAdd(list, r - 1, c + o);
    TryAdd(list, r - 1, c + o + 1);
    TryAdd(list, r + 1, c + o);
    TryAdd(list, r + 1, c + o + 1);
  }

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    const rect = this.PlayRect(TopBand, BottomBand, 0.1);
    this.top = rect.yMax;
    this.left = -BoardW * 0.5 + R;
    this.shooterY = rect.yMin + 1.1;
    this.dangerY = this.shooterY + 1.25;
    this.shooterPos = new V2(0, this.shooterY);
    this.nextPos = new V2(-1.75, this.shooterY - 0.35);

    const panelH = this.top - (this.shooterY - 1.2) + 0.25;
    this.boardPanel.transform.localScale = new V3(BoardW + 0.3, panelH / 2, 1);
    this.boardPanel.transform.localPosition = new V3(0, this.top + 0.15 - panelH * 0.5, 0);
    this.dangerLine.transform.localPosition = new V3(0, this.dangerY, 0);
    this.dangerLine.transform.localScale = new V3(BoardW, BoardW, 1);

    this.pot.transform.localPosition = new V3(0, this.shooterY - 0.65, 0);
    this.loadSr.transform.localPosition = new V3(this.shooterPos.x, this.shooterPos.y, 0);
    this.nextSr.transform.localPosition = new V3(this.nextPos.x, this.nextPos.y, 0);
    this.nextRing.transform.localPosition = new V3(this.nextPos.x, this.nextPos.y, 0);

    const need = Math.ceil(BoardW / 1.0) + 1;
    while (this.vines.length < need) this.vines.push(Art.spr(this.world, "Vine", BubbleBloomArt.Vine, Color.white, 1.05, 12, Art.Flat));
    for (let i = 0; i < this.vines.length; i++)
      this.vines[i].transform.localPosition = new V3(-BoardW * 0.5 + 0.5 + i * 1.0, this.top + 0.08, 0);
    for (let r = 0; r < MaxRows; r++)
      for (let c = 0; c < Cols; c++) this.PlaceCell(r, c);
  }

  private PlaceCell(r: number, c: number) {
    const cell = this.grid[r][c];
    const p = this.CellPos(r, c).add(cell.Offset);
    const s = D * 1.04 * (cell.Pop < 1 ? Ease.outBack(Mathf.clamp01(cell.Pop)) : 1);
    cell.Sr.transform.localPosition = new V3(p.x, p.y, 0);
    cell.Sr.transform.localScale = new V3(s, s, 1);
    cell.BudSr.transform.localPosition = cell.Sr.transform.localPosition;
    cell.BudSr.transform.localScale = cell.Sr.transform.localScale;
  }

  // ------------------------------------------------------------------ levels

  private BuildLevel(lvl: number) {
    this.ClearBoard();
    this.rng = new SysRandom(lvl * 7349 + 11);
    const rows = Math.min(6 + Math.trunc(lvl / 2), 12);
    this.colorsInLevel = Math.min(3 + Math.trunc((lvl - 1) / 3), BubbleBloomArt.Colors);
    const pattern = lvl <= 2 ? 0 : lvl % 5;
    let count = 0;
    for (let r = 0; r < rows; r++) {
      const n = r % 2 === 0 ? Cols : Cols - 1;
      for (let c = 0; c < n; c++) {
        if (!PatternHas(pattern, r, c, n, rows)) continue;
        let color = this.rng.next(this.colorsInLevel);
        // grow clusters: often copy the colour of an upper / left neighbour
        if (this.rng.nextDouble() < 0.55) {
          this.Neighbors(r, c, this.nbrs);
          for (const nb of this.nbrs) {
            if (nb.y > r || (nb.y === r && nb.x > c)) continue;
            const nc = this.grid[nb.y][nb.x];
            if (nc.Color >= 0) { color = nc.Color; break; }
          }
        }
        this.SetCell(r, c, color, false);
        count++;
      }
    }
    // Buds in the top rows
    this.budsTotal = Math.min(2 + Math.trunc(lvl / 3), 7);
    let placed = 0, guard = 0;
    while (placed < this.budsTotal && guard++ < 400) {
      const r = this.rng.next(Math.min(3, rows));
      const c = this.rng.next(r % 2 === 0 ? Cols : Cols - 1);
      const cell = this.grid[r][c];
      if (cell.Color < 0 || cell.Bud) continue;
      cell.Bud = true;
      cell.BudSr.gameObject.setActive(true);
      placed++;
    }
    this.budsTotal = placed;
    this.buds = placed;
    const factor = 2.0 + Math.min(0.9, lvl * 0.05);
    this.startShots = Math.ceil(count / factor) + 5;
    this.shots = this.startShots;
    for (let r = 0; r < MaxRows; r++)
      for (let c = 0; c < Cols; c++) this.grid[r][c].Pop = 0 - (r * 0.06 + c * 0.015);
  }

  private SetCell(r: number, c: number, color: number, bud: boolean) {
    const cell = this.grid[r][c];
    cell.Color = color;
    cell.Bud = bud;
    cell.Offset = cell.OffVel = V2.zero;
    cell.Pop = 1;
    cell.Sr.sprite = SpriteFor(color);
    cell.Sr.gameObject.setActive(color !== Empty);
    cell.BudSr.gameObject.setActive(color !== Empty && bud);
    this.PlaceCell(r, c);
  }

  private ClearBoard() {
    for (let r = 0; r < MaxRows; r++)
      for (let c = 0; c < Cols; c++) {
        const cell = this.grid[r][c];
        cell.Color = Empty;
        cell.Bud = false;
        cell.Sr.gameObject.setActive(false);
        cell.BudSr.gameObject.setActive(false);
      }
    for (const f of this.falling) { f.Active = false; f.Sr.gameObject.setActive(false); f.BudSr!.gameObject.setActive(false); }
    for (const f of this.pops) { f.Active = false; f.Sr.gameObject.setActive(false); }
    for (const b of this.blooms) b.Sr.gameObject.setActive(false);
    for (const b of this.blooms) b.Active = false;
    this.fx.clear();
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.Layout();
    this.level = this.CurrentLevel;
    this.BuildLevel(this.level);
    this.HideAim();
    this.flying = false;
    this.flySr.gameObject.setActive(false);
    this.ended = false;
    this.currentColor = this.PickColor();
    this.nextColor = this.PickColor();
    this.RefreshLoaded();
    this.attractTimer = 1.2;
    this.RefreshMap();
  }

  private RefreshMap() {
    const cur = this.CurrentLevel;
    const first = Math.max(1, cur - 2);
    for (let i = 0; i < this.mapNodes.length; i++) {
      const l = first + i;
      const done = l < cur, now = l === cur;
      this.mapLabels[i].text = String(l);
      this.mapNodes[i].color = now ? Pink : done ? Leaf : new Color(1, 1, 1, 0.85);
      this.mapLabels[i].color = now || done ? Color.white : Ink;
      this.mapNodes[i].rectTransform.localScale = now ? new V3(1.25, 1.25, 1) : V3.one;
      const st = this.Data.get("s" + l);
      for (let k = 0; k < 3; k++) {
        this.mapStars[i][k].gameObject.setActive(done);
        this.mapStars[i][k].color = k < st ? Gold : new Color(1, 1, 1, 0.3);
      }
      this.mapNow[i].text = now ? "PLAY!" : "";
    }
  }

  protected BeginRun() {
    this.Layout();
    this.level = this.CurrentLevel;
    this.BuildLevel(this.level);
    this.score = this.combo = 0;
    this.flying = this.aiming = this.ended = this.revived = this.won = false;
    this.flySr.gameObject.setActive(false);
    this.loadSr.gameObject.setActive(true); // fix: the C# left it hidden when PLAY was pressed mid attract shot
    this.HideAim();
    this.currentColor = this.PickColor();
    this.nextColor = this.PickColor();
    this.RefreshLoaded();
    this.pointer.reset();
    this.pointer.topBand = 0.12;
    this.keyAngle = 90;
    this.UI.Announce(`LEVEL ${this.level}`, Pink, 1.3);
    if (this.Data.get("runs") === 0) this.UI.Hint("Drag to aim, let go to shoot. Free all the flower buds!");
    this.Data.add("runs", 1);
    Sfx.setIntensity(0.25);
    this.UpdateHud();
  }

  private PickColor() {
    // only colours still on the board (so every bubble is useful)
    let mask = 0, n = 0;
    for (let r = 0; r < MaxRows; r++)
      for (let c = 0; c < Cols; c++) {
        const col = this.grid[r][c].Color;
        if (col >= 0 && col < BubbleBloomArt.Colors && (mask & (1 << col)) === 0) { mask |= 1 << col; n++; }
      }
    if (n === 0) return this.rng.next(Math.max(1, this.colorsInLevel));
    let pick = this.rng.next(n);
    for (let i = 0; i < BubbleBloomArt.Colors; i++) {
      if ((mask & (1 << i)) === 0) continue;
      if (pick-- === 0) return i;
    }
    return 0;
  }

  private RefreshLoaded() {
    this.loadSr.sprite = SpriteFor(this.currentColor);
    this.nextSr.sprite = SpriteFor(this.nextColor);
    this.loadAnim = 0;
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Animate(dt);
    if (this.State !== Phase.Title) return;
    // Attract: the pot sways and fires now and then
    this.attractAngle += dt;
    this.aimDir = new V2(Math.cos(Math.PI * 0.5 + Math.sin(this.attractAngle * 0.7) * 0.9), Math.sin(Math.PI * 0.5 + Math.sin(this.attractAngle * 0.7) * 0.9));
    if (this.flying) this.UpdateFlight(dt, false);
    else {
      this.attractTimer -= dt;
      if (this.attractTimer <= 0) {
        this.attractTimer = 1.6;
        this.Fire(false);
      }
    }
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    this.Animate(dt);

    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.State === Phase.Playing) {
        if (this.won) this.Win();
        else this.Lose();
      }
      return;
    }

    if (this.flying) this.UpdateFlight(dt, true);
    else this.HandleAim(dt);
    this.UpdateHud();
  }

  private HandleAim(dt: number) {
    // keyboard
    const mv = this.Controls.move;
    if (Math.abs(mv.x) > 0.1) {
      this.keyAngle = Mathf.clamp(this.keyAngle - mv.x * 90 * dt, 12, 168);
      this.aimDir = new V2(Math.cos(this.keyAngle * Mathf.Deg2Rad), Math.sin(this.keyAngle * Mathf.Deg2Rad));
      this.aiming = true;
      this.ShowAim();
    }
    if (this.Controls.action2Pressed) this.Swap();
    if (this.Controls.actionPressed && this.aiming) { this.Fire(true); return; }

    if (this.pointer.down) {
      const w = this.ScreenToWorld(this.pointer.screen);
      this.swapPress = w.sub(this.nextPos).magnitude < 0.75 || w.sub(this.shooterPos).magnitude < 0.6;
    }
    if (this.pointer.held && !this.swapPress) {
      const w = this.ScreenToWorld(this.pointer.screen);
      let d = w.sub(this.shooterPos);
      if (d.y < 0.3) d = d.withY(0.3);
      const ang = Mathf.clamp(Math.atan2(d.y, d.x) * Mathf.Rad2Deg, 10, 170);
      this.keyAngle = ang;
      this.aimDir = new V2(Math.cos(ang * Mathf.Deg2Rad), Math.sin(ang * Mathf.Deg2Rad));
      this.aiming = true;
      this.ShowAim();
    }
    if (this.pointer.up) {
      if (this.swapPress) {
        if (this.pointer.tap) this.Swap();
        this.swapPress = false;
      } else if (this.aiming) this.Fire(true);
    }
  }

  private Swap() {
    if (this.currentColor >= BubbleBloomArt.Colors) return; // specials stay loaded
    const t = this.currentColor;
    this.currentColor = this.nextColor;
    this.nextColor = t;
    this.RefreshLoaded();
    Sfx.play(Snd.Click, 0.7);
  }

  private Fire(real: boolean) {
    this.HideAim();
    this.aiming = false;
    this.flying = true;
    this.flyPos = this.shooterPos;
    this.flyVel = this.aimDir.normalized.mul(ShotSpeed);
    this.flySr.sprite = SpriteFor(this.currentColor);
    this.flySr.gameObject.setActive(true);
    this.loadSr.gameObject.setActive(false);
    Sfx.playClip(this.shootClip, real ? 0.8 : 0.3);
    if (real) {
      this.shots--;
      this.UI.Hint(null);
    }
  }

  private UpdateFlight(dt: number, real: boolean) {
    const dist = ShotSpeed * dt;
    const steps = Math.max(1, Math.ceil(dist / (R * 0.5)));
    const h = dt / steps;
    const wallL = -BoardW * 0.5 + R, wallR = BoardW * 0.5 - R;
    for (let s = 0; s < steps; s++) {
      this.flyPos = this.flyPos.add(this.flyVel.mul(h));
      if (this.flyPos.x < wallL) { this.flyPos = this.flyPos.withX(wallL + (wallL - this.flyPos.x)); this.flyVel = this.flyVel.withX(Math.abs(this.flyVel.x)); Sfx.play(Snd.Tick, 0.25); }
      if (this.flyPos.x > wallR) { this.flyPos = this.flyPos.withX(wallR - (this.flyPos.x - wallR)); this.flyVel = this.flyVel.withX(-Math.abs(this.flyVel.x)); Sfx.play(Snd.Tick, 0.25); }
      if (this.flyPos.y >= this.top - R || this.HitsBubble(this.flyPos)) {
        this.Land(real);
        return;
      }
    }
    this.flySr.transform.localPosition = new V3(this.flyPos.x, this.flyPos.y, 0);
  }

  private HitsBubble(p: V2) {
    const lim = D * 0.82;
    const lim2 = lim * lim;
    const r0 = Mathf.clamp(Mathf.roundToInt((this.top - R - p.y) / RowH), 0, MaxRows - 1);
    for (let r = Math.max(0, r0 - 2); r <= Math.min(MaxRows - 1, r0 + 2); r++)
      for (let c = 0; c < Cols; c++) {
        if (this.grid[r][c].Color === Empty || !Valid(r, c)) continue;
        if (this.CellPos(r, c).sub(p).sqrMagnitude < lim2) return true;
      }
    return false;
  }

  private Land(real: boolean) {
    this.flying = false;
    this.flySr.gameObject.setActive(false);
    // nearest empty cell to the landing point
    const r0 = Mathf.clamp(Mathf.roundToInt((this.top - R - this.flyPos.y) / RowH), 0, MaxRows - 1);
    let bestR = -1, bestC = -1;
    let best = Number.MAX_VALUE;
    for (let r = Math.max(0, r0 - 1); r <= Math.min(MaxRows - 1, r0 + 1); r++)
      for (let c = 0; c < Cols; c++) {
        if (!Valid(r, c) || this.grid[r][c].Color !== Empty) continue;
        if (r > 0 && !this.HasNeighbor(r, c)) continue;
        const d = this.CellPos(r, c).sub(this.flyPos).sqrMagnitude;
        if (d < best) { best = d; bestR = r; bestC = c; }
      }
    if (bestR < 0) {
      // fallback: anything empty in range
      for (let r = Math.max(0, r0 - 2); r <= Math.min(MaxRows - 1, r0 + 2); r++)
        for (let c = 0; c < Cols; c++) {
          if (!Valid(r, c) || this.grid[r][c].Color !== Empty) continue;
          const d = this.CellPos(r, c).sub(this.flyPos).sqrMagnitude;
          if (d < best) { best = d; bestR = r; bestC = c; }
        }
    }
    if (bestR < 0) { this.AfterShot(real); return; }

    let color = this.currentColor;
    if (color === RainbowColor) color = this.BestNeighborColor(bestR, bestC);
    this.SetCell(bestR, bestC, color === BombColor ? BombColor : color, false);
    this.grid[bestR][bestC].Pop = 0.5;
    this.Wobble(bestR, bestC);
    Sfx.playClip(this.attachClip, real ? 0.7 : 0.3);

    let popped = 0;
    if (color === BombColor) popped = this.Explode(bestR, bestC, real);
    else popped = this.Match(bestR, bestC, real);

    if (popped > 0) {
      const dropped = this.DropFloating(real);
      if (real) {
        this.combo++;
        if (this.combo >= 3) this.UI.Announce(`COMBO x${this.combo}!`, Gold, 0.9);
        if (dropped >= 6) this.UI.Announce(dropped >= 12 ? "AVALANCHE!" : "NICE DROP!", Sky, 1);
      }
    } else if (real) this.combo = 0;

    this.AfterShot(real);
  }

  private HasNeighbor(r: number, c: number) {
    this.Neighbors(r, c, this.nbrs);
    for (const n of this.nbrs) if (this.grid[n.y][n.x].Color !== Empty) return true;
    return false;
  }

  private BestNeighborColor(r: number, c: number) {
    this.Neighbors(r, c, this.nbrs);
    let bestColor = this.PickColor(), bestSize = 0;
    const local = [...this.nbrs];
    for (const n of local) {
      const col = this.grid[n.y][n.x].Color;
      if (col < 0 || col >= BubbleBloomArt.Colors) continue;
      const size = this.GroupSize(n.y, n.x, col);
      if (size > bestSize) { bestSize = size; bestColor = col; }
    }
    return bestColor;
  }

  private GroupSize(r: number, c: number, color: number) {
    this.Flood(r, c, color);
    return this.found.length;
  }

  private ClearSeen() { for (const row of this.seen) row.fill(false); }

  private Flood(r: number, c: number, color: number) {
    this.ClearSeen();
    this.found.length = 0;
    const queue = this.queue;
    queue.length = 0;
    queue.push(new V2i(c, r));
    this.seen[r][c] = true;
    let head = 0;
    while (head < queue.length) {
      const p = queue[head++];
      this.found.push(p);
      this.Neighbors(p.y, p.x, this.nbrs);
      for (const n of this.nbrs) {
        if (this.seen[n.y][n.x] || this.grid[n.y][n.x].Color !== color) continue;
        this.seen[n.y][n.x] = true;
        queue.push(n);
      }
    }
  }

  private Match(r: number, c: number, real: boolean) {
    const color = this.grid[r][c].Color;
    this.Flood(r, c, color);
    if (this.found.length < 3) return 0;
    const n = this.found.length;
    for (let i = 0; i < n; i++) this.PopCell(this.found[i].y, this.found[i].x, i * 0.035, real, 10 + i * 2);
    if (real) Fx.haptic(n >= 6);
    return n;
  }

  private Explode(r: number, c: number, real: boolean) {
    const at = this.CellPos(r, c);
    let n = 0;
    for (let rr = 0; rr < MaxRows; rr++)
      for (let cc = 0; cc < Cols; cc++) {
        if (this.grid[rr][cc].Color === Empty || !Valid(rr, cc)) continue;
        const d = this.CellPos(rr, cc).sub(at).magnitude;
        if (d < D * 2.1) { this.PopCell(rr, cc, d * 0.05, real, 15); n++; }
      }
    this.fx.pop(at, Pal.hex(0xffb347), 26, 7, 0.3, 0.6);
    this.Fx.shake(0.35);
    Sfx.play(Snd.Boom, 0.8);
    return n;
  }

  private PopCell(r: number, c: number, delay: number, real: boolean, points: number) {
    const cell = this.grid[r][c];
    const p = this.CellPos(r, c).add(cell.Offset);
    const color = cell.Color;
    const bud = cell.Bud;
    cell.Color = Empty;
    cell.Bud = false;
    cell.Sr.gameObject.setActive(false);
    cell.BudSr.gameObject.setActive(false);

    const pop = this.NextPop();
    if (pop) {
      pop.Active = true;
      pop.Popping = true;
      pop.T = -delay;
      pop.Pos = p;
      pop.Color = color;
      pop.Sr.sprite = SpriteFor(color);
      pop.Sr.transform.localPosition = new V3(p.x, p.y, 0);
      pop.Sr.transform.localScale = new V3(D, D, 1);
      pop.Sr.color = Color.white;
      pop.Sr.gameObject.setActive(true);
    }
    if (bud) this.FreeBud(p, real);
    if (real) {
      this.score += points;
    }
  }

  private NextPop() {
    for (const p of this.pops) if (!p.Active) return p;
    return null;
  }

  private DropFloating(real: boolean) {
    this.ClearSeen();
    const queue = this.queue;
    queue.length = 0;
    for (let c = 0; c < Cols; c++) {
      if (this.grid[0][c].Color === Empty) continue;
      this.seen[0][c] = true;
      queue.push(new V2i(c, 0));
    }
    let head = 0;
    while (head < queue.length) {
      const p = queue[head++];
      this.Neighbors(p.y, p.x, this.nbrs);
      for (const n of this.nbrs) {
        if (this.seen[n.y][n.x] || this.grid[n.y][n.x].Color === Empty) continue;
        this.seen[n.y][n.x] = true;
        queue.push(n);
      }
    }
    let dropped = 0;
    for (let r = 0; r < MaxRows; r++)
      for (let c = 0; c < Cols; c++) {
        const cell = this.grid[r][c];
        if (cell.Color === Empty || this.seen[r][c] || !Valid(r, c)) continue;
        this.DropCell(r, c, real);
        dropped++;
      }
    if (dropped > 0 && real) {
      const pts = dropped * 25 * Math.max(1, Math.trunc(dropped / 5));
      this.score += pts;
      this.UI.Float(new V2(0, this.top - 3), "+" + Fmt.n(pts), Sky, 1.1);
    }
    return dropped;
  }

  private DropCell(r: number, c: number, real: boolean) {
    const cell = this.grid[r][c];
    const p = this.CellPos(r, c).add(cell.Offset);
    let f: Falling | null = null;
    for (const x of this.falling) if (!x.Active) { f = x; break; }
    if (f) {
      f.Active = true;
      f.Popping = false;
      f.Pos = p;
      f.Vel = new V2((this.rng.nextDouble() * 2 - 1) * 2.5, 1.5 + this.rng.nextDouble() * 2);
      f.Rot = 0;
      f.Spin = (this.rng.nextDouble() * 2 - 1) * 200;
      f.Color = cell.Color;
      f.Sr.sprite = SpriteFor(cell.Color);
      f.Sr.gameObject.setActive(true);
      f.BudSr!.gameObject.setActive(false);
    }
    if (cell.Bud) this.FreeBud(p, real);
    cell.Color = Empty;
    cell.Bud = false;
    cell.Sr.gameObject.setActive(false);
    cell.BudSr.gameObject.setActive(false);
  }

  private FreeBud(p: V2, real: boolean) {
    if (!real) return;
    this.buds = Math.max(0, this.buds - 1);
    let b: Bloom | null = null;
    for (const x of this.blooms) if (!x.Active) { b = x; break; }
    if (!b) {
      b = new Bloom();
      b.Sr = Art.spr(this.world, "Bloom", BubbleBloomArt.Flower(0), Color.white, 1, 50, Art.Flat);
      this.blooms.push(b);
    }
    b.Active = true;
    b.T = 0;
    b.From = p;
    b.To = new V2(0, this.top + 1.6);
    b.Sr.sprite = BubbleBloomArt.Flower(this.rng.next(3));
    b.Sr.gameObject.setActive(true);
    this.fx.sparkle(p, Pal.hex(0xffe36a), 8, 0.6, 0.35);
    this.fx.confetti(p, 12, 5, [Pink, Pal.hex(0xffe36a), Color.white, Leaf]);
    Sfx.playClip(this.bloomClip, 0.9);
    this.score += 100;
    this.UI.Float(p, "+100", Pink, 1.1);
    this.Data.add("flowers", 1);
  }

  private Wobble(r: number, c: number) {
    const at = this.CellPos(r, c);
    for (let rr = Math.max(0, r - 2); rr <= Math.min(MaxRows - 1, r + 2); rr++)
      for (let cc = 0; cc < Cols; cc++) {
        const cell = this.grid[rr][cc];
        if (cell.Color === Empty || (rr === r && cc === c)) continue;
        const d = this.CellPos(rr, cc).sub(at);
        const m = d.magnitude;
        if (m > D * 2.2 || m < 1e-3) continue;
        cell.OffVel = cell.OffVel.add(d.div(m).mul(1.6 * (1 - m / (D * 2.2))));
      }
  }

  private AfterShot(real: boolean) {
    // reload
    this.currentColor = this.nextColor;
    if (!this.ColorOnBoard(this.currentColor)) this.currentColor = this.PickColor();
    this.nextColor = this.PickColor();
    this.RefreshLoaded();
    this.loadSr.gameObject.setActive(true);
    if (!real) { if (this.BoardEmpty() || this.LowestY() < this.dangerY) this.BuildLevel(this.level); return; }

    if (this.buds <= 0) {
      this.won = true;
      this.ended = true;
      this.endTimer = 2.0;
      this.DropEverything();
      this.UI.Announce("GARDEN IN BLOOM!", Pink, 1.8);
      this.fx.confetti(new V2(0, this.top - 2), 70, 9, [Pink, Gold, Leaf, Sky, Color.white]);
      Sfx.play(Snd.Win);
      return;
    }
    if (this.LowestY() < this.dangerY) {
      this.ended = true;
      this.won = false;
      this.endTimer = 0.9;
      this.UI.Announce("TOO LOW!", Pal.Danger, 1.2);
      Sfx.play(Snd.Lose, 0.8);
      return;
    }
    if (this.shots <= 0) {
      this.ended = true;
      this.won = false;
      this.endTimer = 0.9;
      this.UI.Announce("OUT OF SHOTS", Pal.Danger, 1.2);
      Sfx.play(Snd.Lose, 0.8);
      return;
    }
    if (this.shots === 5) this.UI.Toast("5 shots left!", 2);
  }

  private ColorOnBoard(color: number) {
    if (color >= BubbleBloomArt.Colors) return true;
    for (let r = 0; r < MaxRows; r++)
      for (let c = 0; c < Cols; c++)
        if (this.grid[r][c].Color === color) return true;
    return false;
  }

  private BoardEmpty() {
    for (let c = 0; c < Cols; c++) if (this.grid[0][c].Color !== Empty) return false;
    return true;
  }

  private LowestY() {
    for (let r = MaxRows - 1; r >= 0; r--)
      for (let c = 0; c < Cols; c++)
        if (this.grid[r][c].Color !== Empty) return this.CellPos(r, c).y - R;
    return Number.MAX_VALUE;
  }

  private DropEverything() {
    let n = 0;
    for (let r = 0; r < MaxRows; r++)
      for (let c = 0; c < Cols; c++) {
        if (this.grid[r][c].Color === Empty) continue;
        this.DropCell(r, c, false);
        n++;
      }
    this.score += n * 25;
  }

  // ------------------------------------------------------------------ animation

  private Animate(dt: number) {
    // springy cells
    for (let r = 0; r < MaxRows; r++)
      for (let c = 0; c < Cols; c++) {
        const cell = this.grid[r][c];
        if (cell.Color === Empty) continue;
        const moving = cell.Offset.sqrMagnitude > 1e-6 || cell.OffVel.sqrMagnitude > 1e-6 || cell.Pop < 1;
        if (!moving) continue;
        cell.OffVel = cell.OffVel.add(cell.Offset.neg().mul(160 * dt));
        cell.OffVel = cell.OffVel.mul(Math.max(0, 1 - 12 * dt));
        cell.Offset = cell.Offset.add(cell.OffVel.mul(dt));
        if (cell.Pop < 1) cell.Pop = Math.min(1, cell.Pop + dt * 3.5);
        this.PlaceCell(r, c);
      }

    for (const f of this.falling) {
      if (!f.Active) continue;
      f.Vel = f.Vel.withY(f.Vel.y - 26 * dt);
      f.Pos = f.Pos.add(f.Vel.mul(dt));
      f.Rot += f.Spin * dt;
      f.Sr.transform.localPosition = new V3(f.Pos.x, f.Pos.y, 0);
      f.Sr.transform.localRotation = Quaternion.euler(0, 0, f.Rot);
      if (f.Pos.y < this.shooterY - 1.4) {
        f.Active = false;
        f.Sr.gameObject.setActive(false);
        const col = f.Color >= 0 && f.Color < BubbleBloomArt.Colors ? BubbleBloomArt.Tint[f.Color] : Color.white;
        this.fx.pop(f.Pos, col, 7, 4, 0.2, 0.4);
        if (this.State === Phase.Playing) Sfx.playClip(this.popClip, 0.35, 0.9 + this.rng.nextDouble() * 0.3);
      }
    }

    for (const p of this.pops) {
      if (!p.Active) continue;
      p.T += dt;
      if (p.T < 0) continue;
      if (p.T < dt * 1.01) {
        const col = p.Color >= 0 && p.Color < BubbleBloomArt.Colors ? BubbleBloomArt.Tint[p.Color] : Pal.hex(0xffb347);
        this.fx.pop(p.Pos, col, 9, 4.5, 0.2, 0.4);
        Sfx.playClip(this.popClip, 0.55, 0.95 + Math.min(0.5, p.T * 3) + this.rng.nextDouble() * 0.1);
      }
      const k = p.T / 0.16;
      if (k >= 1) {
        p.Active = false;
        p.Sr.gameObject.setActive(false);
        continue;
      }
      const s = D * (1 + k * 0.45);
      p.Sr.transform.localScale = new V3(s, s, 1);
      p.Sr.color = new Color(1, 1, 1, 1 - k);
    }

    for (const b of this.blooms) {
      if (!b.Active) continue;
      b.T += dt;
      const k = Mathf.clamp01(b.T / 0.9);
      const e = Ease.inOutSine(k);
      const pos = V2.lerp(b.From, b.To, e).add(new V2(0, Math.sin(k * Math.PI) * 1.2));
      const s = Mathf.lerp(0.4, 1.3, Ease.outBack(Math.min(1, k * 2))) * (k > 0.85 ? 1 - ((k - 0.85) / 0.15) * 0.6 : 1);
      b.Sr.transform.localPosition = new V3(pos.x, pos.y, 0);
      b.Sr.transform.localScale = new V3(s, s, 1);
      b.Sr.transform.localRotation = Quaternion.euler(0, 0, b.T * 160);
      if (k >= 1) {
        b.Active = false;
        b.Sr.gameObject.setActive(false);
      }
    }

    this.loadAnim = Math.min(1, this.loadAnim + dt * 5);
    const ls = D * 1.04 * Ease.outBack(this.loadAnim);
    this.loadSr.transform.localScale = new V3(ls, ls, 1);
    const pulse = 1 + Math.sin(Time.time * 3) * 0.05;
    this.nextRing.transform.localScale = new V3(D * 0.95 * pulse, D * 0.95 * pulse, 1);
    const tilt = Mathf.clamp((Math.atan2(this.aimDir.y, this.aimDir.x) * Mathf.Rad2Deg - 90) * 0.25, -18, 18);
    this.pot.transform.localRotation = Quaternion.euler(0, 0, tilt);
  }

  private ShowAim() {
    const path = this.path;
    path.length = 0;
    let p = this.shooterPos, v = this.aimDir.normalized;
    path.push(p);
    const wallL = -BoardW * 0.5 + R, wallR = BoardW * 0.5 - R;
    let travelled = 0;
    let bounces = 0;
    const step = 0.1;
    while (travelled < 26) {
      p = p.add(v.mul(step));
      travelled += step;
      if (p.x < wallL) { p = p.withX(wallL); v = v.withX(Math.abs(v.x)); path.push(p); if (++bounces > 2) break; }
      if (p.x > wallR) { p = p.withX(wallR); v = v.withX(-Math.abs(v.x)); path.push(p); if (++bounces > 2) break; }
      if (p.y >= this.top - R || this.HitsBubble(p)) break;
    }
    path.push(p);

    // dots spaced along the polyline
    const spacing = 0.42, offset = Mathf.repeat(Time.time * 1.4, spacing);
    let di = 0;
    let acc = -offset;
    const col = this.currentColor < BubbleBloomArt.Colors ? BubbleBloomArt.Tint[this.currentColor] : Color.white;
    for (let i = 1; i < path.length && di < AimDots; i++) {
      const a = path[i - 1], b = path[i];
      const len = b.sub(a).magnitude;
      while (acc + spacing <= len && di < AimDots) {
        acc += spacing;
        if (acc < 0.6 && i === 1) continue;
        const q = a.add(b.sub(a).mul(acc / Math.max(1e-4, len)));
        const d = this.dots[di++];
        d.gameObject.setActive(true);
        d.transform.localPosition = new V3(q.x, q.y, 0);
        const fade = 1 - (di / AimDots) * 0.6;
        d.color = Color.lerp(col, Color.white, 0.25).withAlpha(0.9 * fade);
      }
      acc -= len;
    }
    for (; di < AimDots; di++) this.dots[di].gameObject.setActive(false);
  }

  private HideAim() {
    for (const d of this.dots) d.gameObject.setActive(false);
  }

  // ------------------------------------------------------------------ HUD & boosters

  private UpdateHud() {
    SetText(this.levelText, "LEVEL " + this.level);
    SetText(this.scoreText, Fmt.n(this.score));
    SetText(this.budText, `${this.budsTotal - this.buds}/${this.budsTotal}`);
    SetText(this.shotsText, String(this.shots));
    this.shotsText.color = this.shots <= 5 ? Pal.Danger : Ink;
    this.Booster(this.bombButton, "BOMB", this.Bombs, this.currentColor === BombColor);
    this.Booster(this.rainbowButton, "RAINBOW", this.Rainbows, this.currentColor === RainbowColor);
  }

  private Booster(b: ArcadeButton | null, name: string, count: number, loaded: boolean) {
    if (!b || !b.label) return;
    SetText(b.label, loaded ? "LOADED" : count > 0 ? `${name} ×${count}` : AdService.rewardedAvailable ? `${name} +AD` : name);
    b.interactable = !this.ended && !this.flying && !loaded && (count > 0 || AdService.rewardedAvailable);
  }

  private OnBomb() { this.UseSpecial(BombColor); }
  private OnRainbow() { this.UseSpecial(RainbowColor); }

  private UseSpecial(special: number) {
    if (this.State !== Phase.Playing || this.ended || this.flying || this.currentColor >= BubbleBloomArt.Colors) return;
    const have = special === BombColor ? this.Bombs : this.Rainbows;
    if (have > 0) {
      if (special === BombColor) this.Bombs = have - 1;
      else this.Rainbows = have - 1;
      this.Data.flush();
      this.currentColor = special;
      this.RefreshLoaded();
      Sfx.play(Snd.PowerUp, 0.7);
      return;
    }
    if (!AdService.rewardedAvailable) return;
    AdService.showRewarded((ok) => {
      if (!ok) return;
      if (special === BombColor) this.Bombs = this.Bombs + 1;
      else this.Rainbows = this.Rainbows + 1;
      this.Data.flush();
      this.UI.Toast(special === BombColor ? "+1 BOMB" : "+1 RAINBOW", 2);
      Sfx.play(Snd.PowerUp, 0.7);
    });
  }

  // ------------------------------------------------------------------ results

  private Win() {
    const bonus = this.shots * 100;
    this.score += bonus;
    const ratio = this.shots / Math.max(1, this.startShots);
    const stars = ratio >= 0.3 ? 3 : ratio >= 0.12 ? 2 : 1;
    const prev = this.Data.get("s" + this.level);
    if (stars > prev) {
      this.Data.set("s" + this.level, stars);
      this.Data.add("stars", stars - prev);
    }
    const newBest = this.Data.max("best", this.score);
    this.Data.set("level", this.level + 1);
    // a little gift every 5 levels
    if (this.level % 5 === 0) { this.Bombs = this.Bombs + 1; this.Rainbows = this.Rainbows + 1; }
    const lvl = this.level;
    this.Finish(new Result({
      Headline: `LEVEL ${lvl} COMPLETE!`,
      HeadlineColor: Gold,
      Stars: stars,
      Value: Fmt.n(this.score),
      NewBest: newBest,
      BestLine: lvl % 5 === 0 ? "GIFT: +1 BOMB  +1 RAINBOW" : `NEXT: LEVEL ${lvl + 1}`,
      Stats: [
        ["SCORE", Fmt.n(this.score)],
        ["FLOWERS", `${this.budsTotal}/${this.budsTotal}`],
        ["SHOTS LEFT", String(this.shots)],
        ["BONUS", "+" + Fmt.n(bonus)],
      ],
      Primary: "NEXT LEVEL",
      Victory: true,
      Reward: () => {
        this.Bombs = this.Bombs + 1;
        this.Data.flush();
        this.UI.Toast("+1 BOMB for your next level!", 2.5);
        Sfx.play(Snd.PowerUp, 0.8);
      },
      RewardLabel: "GET A FREE BOMB (WATCH AD)",
    }));
  }

  private Lose() {
    this.Data.max("best", this.score);
    this.Finish(new Result({
      Headline: "SO CLOSE!",
      HeadlineColor: Pal.hex(0xffc2d6),
      Value: `${this.budsTotal - this.buds}/${this.budsTotal}`,
      BestLine: `LEVEL ${this.level} · FLOWERS FREED`,
      Stats: [
        ["SCORE", Fmt.n(this.score)],
        ["FLOWERS", `${this.budsTotal - this.buds}/${this.budsTotal}`],
        ["LEVEL", String(this.level)],
        ["STARS", String(this.Data.get("stars"))],
      ],
      Primary: "TRY AGAIN",
      Reward: this.revived || this.LowestY() < this.dangerY ? null : () => this.Continue(),
      RewardLabel: "+5 SHOTS & CONTINUE (AD)",
    }));
  }

  private Continue() {
    this.revived = true;
    this.ended = false;
    this.shots += 5;
    this.pointer.reset();
    this.Revive();
    this.UI.Announce("+5 SHOTS!", Leaf, 1.2);
    Sfx.play(Snd.PowerUp);
  }
}

function SetText(t: Text | null, s: string) {
  if (t && t.text !== s) t.text = s;
}
