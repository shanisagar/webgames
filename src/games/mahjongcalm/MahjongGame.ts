import {
  AdService, ArcadeButton, ArcadeGame, AudioClip, Camera, CasualFx, CasualLook, CasualUI, Choice, Color, Ease, Fmt, Fx, GameInfo,
  GameObject, howTo, Keyboard, LevelPath, Mathf, Mouse, Pal, Phase, Result, Screen, screenToClient, Sfx, Snd, SpriteRenderer,
  SysRandom, TapPointer, Text, TextAnchor, Time, Touchscreen, TouchScheme, UIKit, V2, V3, Art, Rect, CasualArt,
} from "../../kit";
import { Depth, Geom, MahjongArt, TH } from "./MahjongArt";
import {
  Board, DealLayout, FlatPositions, FreePairs, HintPair, LayoutFor, MatchKey, Pos, Redeal, BestPair,
} from "./MahjongLayouts";

/**
 * MAHJONG CALM: classic Mahjong Solitaire. Tiles are stacked in layered layouts (Pyramid, Butterfly, Turtle...); a
 * tile is free when nothing lies on it and its left or right side is open. Tap two free matching tiles to clear them
 * (any flower matches any flower, any season any season). Every deal is built by removing pairs from the full layout
 * in a legal order, so each level is always solvable. HINT, UNDO and SHUFFLE boosters (refillable with rewarded ads);
 * when no moves are left the first shuffle is free, later ones come from the result screen's rewarded offer.
 * Large layouts can be zoomed (pinch, mouse wheel or the zoom button) and panned on small phones.
 */

// ------------------------------------------------------------------ tuning

const TopP = 230, BottomP = 225;          // portrait HUD bands (canvas units)
const TopL = 165, BottomL = 40, SideL = 290; // landscape: boosters in a column on the left
const MaxTile = 1.2;                       // largest tile width in world units (small boards on big screens)
const ComfortCss = 46;                     // tile width (CSS px) the zoom button brings small tiles up to
const RemoveTime = 0.42;

const Jade = Pal.hex(0x3fc09a), Gold = Pal.hex(0xf2c45a), Coral = Pal.hex(0xff8f7a), Sky = Pal.hex(0x7fd3ff);
const Mist = Pal.hex(0xd8efe6), Ink = Pal.hex(0x17322c);
const Blocked = new Color(0.66, 0.68, 0.64, 1), SelTint = new Color(1, 0.88, 0.6, 1), HintTint = new Color(0.72, 1, 0.86, 1);

const xy = (v: V2 | V3) => new V2(v.x, v.y);

class Tile {
  Id = 0; Face = 0; P: Pos = { x: 0, y: 0, z: 0 };
  OnBoard = true; Free = false;
  Root!: GameObject; Body!: SpriteRenderer; Glow!: SpriteRenderer;
  Appear = 1; Remove = -1; RemoveDir = V2.zero;
  Sel = 0; Hint = 0; Hover = 0; Dim = 1; Wiggle = 0;
  Flip = 1; NewFace = -1;
  Move = 1; From = V2.zero;
}

export class MahjongGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject;
  private boardRoot!: GameObject;
  private bgCover!: SpriteRenderer;
  private fx!: CasualFx;
  private motes!: CasualFx;
  private pointer = new TapPointer();
  private rng = new SysRandom();
  private path: LevelPath | null = null;

  private tiles: Tile[] = [];
  private board!: Board;
  private faces: number[] = [];
  private solution: [number, number][] = [];
  private history: [Tile, Tile][] = [];
  private selected: Tile | null = null;
  private hintPair: [Tile, Tile] | null = null;
  private hintTimer = 0;
  private layoutName = "";
  private level = 1;
  private left = 0; private moves = 0; private combo = 0; private comboTimer = 0;
  private timer = 0; private endTimer = 0; private attractTimer = 0; private moteTimer = 0;
  private boosters = 0; private freeShuffleUsed = false; private stuckHandled = false; private ended = false;
  private blockedTaps = 0;

  // board view
  private center = V2.zero;
  private need = V2.one;
  private rect = new Rect(0, 0, 1, 1);
  private fit = 1; private zoom = 1; private zoomMax = 1; private zoomGoal = -1;
  private pan = V2.zero;
  private texSize = 0; private pendingSize = 0; private sizeTimer = 0; private releaseSize = 0; private releaseFrames = 0;
  private pinching = false; private pinchD = 1; private pinchZoom = 1; private pinchAnchor = V2.zero;
  private dragging = false; private dragPan = V2.zero; private dragWorld = V2.zero; private suppressTap = false;

  // HUD
  private levelText!: Text; private nameText!: Text; private timeText!: Text; private leftText!: Text; private movesText!: Text;
  private undoButton!: ArcadeButton; private hintButton!: ArcadeButton; private shuffleButton!: ArcadeButton; private zoomButton!: ArcadeButton;

  private tapClip!: AudioClip; private selClip!: AudioClip; private bellClip!: AudioClip; private denyClip!: AudioClip;
  private shuffleClip!: AudioClip; private hintClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "mahjongcalm",
      Title: "MAHJONG CALM",
      Tagline: "MATCH THE PAIRS. CLEAR THE BOARD. BREATHE.",
      PlayLabel: "PLAY",
      Accent: Jade,
      Accent2: Gold,
      BgTop: Pal.hex(0x155247),
      BgBottom: Pal.hex(0x0b2b26),
      ShortSide: 10,
      Touch: TouchScheme.None,
      Music: { bpm: 62, rootHz: 146.83, degrees: [0, 5, 3, 4], seed: 27, energy: 0.08, major: true },
      Reminders: [
        "Your tiles are waiting|A calm game of mahjong is one tap away.",
        "Time to unwind|Match a few pairs and clear the board.",
        "A new layout is ready|Can you clear it with three stars?",
      ],
      HowTo: [
        howTo(MahjongArt.Tile(4, 96), Color.white, "TAP two MATCHING tiles to clear them. Clear every tile to finish the level."),
        howTo(MahjongArt.Tile(31, 96), Color.white, "Only FREE tiles can be picked: nothing on top, and the left or right side open. Bright tiles are free, dim ones are blocked."),
        howTo(MahjongArt.Tile(35, 96), Color.white, "Any FLOWER matches any flower, and any SEASON matches any season."),
        howTo(MahjongArt.HintIcon, Gold, "HINT shows a pair, UNDO takes a pair back, SHUFFLE mixes the tiles left (always solvable)."),
        howTo(MahjongArt.ShuffleIcon, Jade, "No moves left? The first shuffle is free. Pinch or scroll to zoom big boards."),
        howTo(Art.Star, Gold, "Clear quickly without boosters for three stars."),
      ],
      Tips: [
        "Clear tiles that block long rows first.",
        "If all four of a kind are free, take them both pairs at once.",
        "Work the tall stacks down early: they hide the most tiles.",
        "Hold back when three of a kind are free: pick the pair that unblocks more.",
        "There is no rush. Every deal can be solved.",
      ],
    });
  }

  protected get ShortSide() { return 10; }

  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }
  private get Hints() { return this.Data.get("hint", 3); }
  private set Hints(v: number) { this.Data.set("hint", Math.max(0, v)); }
  private get Undos() { return this.Data.get("undo", 3); }
  private set Undos(v: number) { this.Data.set("undo", Math.max(0, v)); }
  private get Shuffles() { return this.Data.get("shuffle", 2); }
  private set Shuffles(v: number) { this.Data.set("shuffle", Math.max(0, v)); }

  protected BestLine() { return `LEVEL ${this.CurrentLevel}   ·   ${this.Data.get("stars")} ★`; }
  protected StatsLine() { return `${Fmt.n(this.Data.get("pairs"))} PAIRS MATCHED   ·   ${this.CurrentLevel - 1} BOARDS CLEARED`; }

  private get Landscape() { return Screen.width > Screen.height; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("MahjongWorld", this.gameObject);
    CasualLook.calm(this, 1.35, 0.22);
    this.bgCover = CasualLook.cover(this.world, MahjongArt.Backdrop, -910);
    this.motes = CasualFx.create(this.world, -600, 40);
    this.boardRoot = new GameObject("Board", this.world);
    this.fx = CasualFx.create(this.world, 6000, 220);

    const bell = (t: number, f: number) => (Sfx.sinP(f * t) + 0.35 * Sfx.sinP(f * 2.01 * t) * Math.exp(-t * 6) + 0.12 * Sfx.sinP(f * 3.02 * t) * Math.exp(-t * 9));
    this.tapClip = Sfx.make("mj-tap", 0.12, (t) => (Sfx.sinP(1900 * t) * Math.exp(-t * 110) * 0.45 + Sfx.sinP(Sfx.glide(t, 720, 520, 0.05)) * Math.exp(-t * 50) * 0.7) * 0.32);
    this.selClip = Sfx.make("mj-sel", 0.14, (t) => (Sfx.sinP(2400 * t) * Math.exp(-t * 120) * 0.35 + Sfx.sinP(980 * t) * Math.exp(-t * 45) * 0.5) * 0.3);
    this.bellClip = Sfx.make("mj-bell", 1.4, (t) => bell(t, 523.25) * Sfx.env(t, 0.004, 0.9) * 0.16);
    this.denyClip = Sfx.make("mj-deny", 0.16, (t) => Sfx.sinP(Sfx.glide(t, 210, 150, 0.12)) * Sfx.env(t, 0.002, 0.09) * 0.32);
    this.hintClip = Sfx.make("mj-hint", 0.9, (t) => (bell(t, 659.25) * Sfx.env(t, 0.004, 0.45) + bell(t, 987.77) * Sfx.env(t - 0.12, 0.004, 0.5)) * 0.1);
    const clackAt = [0, 0.05, 0.11, 0.16, 0.24, 0.3, 0.37, 0.45];
    this.shuffleClip = Sfx.make("mj-shuffle", 0.6, (t) => {
      let v = 0;
      clackAt.forEach((c, i) => { const u = t - c; if (u >= 0) v += Sfx.sinP((1500 + i * 90) * u) * Math.exp(-u * 140) * 0.5 + Sfx.sinP(600 * u) * Math.exp(-u * 60) * 0.4; });
      return v * 0.22;
    });

    this.BuildHud();
    this.Layout();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    const plate = UIKit.img(hud, "TopPlate", Art.UiRound, new Color(0.03, 0.13, 0.11, 0.78));
    plate.rectTransform.place(new V2(0.5, 1), new V2(-60, -92), new V2(820, 126));
    this.levelText = UIKit.at(UIKit.label(plate.rectTransform, "LEVEL 1", 38, Gold, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(170, 16), new V2(280, 50));
    this.nameText = UIKit.at(UIKit.label(plate.rectTransform, "", 24, Mist.withAlpha(0.75), TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(170, -26), new V2(280, 34));
    this.timeText = UIKit.at(UIKit.label(plate.rectTransform, "0:00", 46, Color.white), UIKit.Center, new V2(10, 0), new V2(200, 60));
    this.leftText = UIKit.at(UIKit.label(plate.rectTransform, "", 32, Color.white, TextAnchor.MiddleRight), new V2(1, 0.5), new V2(-150, 16), new V2(260, 44));
    this.movesText = UIKit.at(UIKit.label(plate.rectTransform, "", 24, Jade, TextAnchor.MiddleRight), new V2(1, 0.5), new V2(-150, -26), new V2(260, 34));

    const mk = (label: string, icon: ReturnType<typeof MahjongArt.Tile>, accent: Color, cb: () => void) => {
      const b = UIKit.buttonAt(hud, label, new V2(0.5, 0), V2.zero, new V2(230, 140), false, cb, 26, icon);
      b.setAccent(accent);
      if (b.label) CasualLook.fit(b.label, 18);
      return b;
    };
    this.undoButton = mk("UNDO", MahjongArt.UndoIcon, Sky, () => this.OnUndo());
    this.hintButton = mk("HINT", MahjongArt.HintIcon, Gold, () => this.OnHint());
    this.shuffleButton = mk("SHUFFLE", MahjongArt.ShuffleIcon, Jade, () => this.OnShuffle());
    this.zoomButton = mk("ZOOM", MahjongArt.ZoomIcon(true), Mist, () => this.ToggleZoom());

    if (this.UI.TitleExtra) {
      CasualLook.titleCard(this.UI, new Color(0.03, 0.14, 0.12, 0.84));
      this.path = new LevelPath(this.UI, Coral, Jade, Ink);
    }
  }

  private PlaceHud() {
    const btns = [this.undoButton, this.hintButton, this.shuffleButton];
    const zoom = this.zoomMax > 1.12;
    this.zoomButton.node.setActive(zoom);
    if (zoom) btns.push(this.zoomButton);
    if (this.Landscape) {
      const step = 165, y0 = ((btns.length - 1) * step) / 2;
      btns.forEach((b, i) => b.node.place(new V2(0, 0.5), new V2(150, y0 - i * step - 20), new V2(220, 140)));
    } else {
      const step = zoom ? 250 : 270, x0 = -((btns.length - 1) * step) / 2;
      btns.forEach((b, i) => b.node.place(new V2(0.5, 0), new V2(x0 + i * step, 100), new V2(230, 140)));
    }
  }

  // ------------------------------------------------------------------ layout & view

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    let r = this.Landscape ? this.PlayRect(TopL, BottomL, 0.3) : this.PlayRect(TopP, BottomP, 0.12);
    if (this.Landscape) {
      const k = Math.min(this.ViewSize.x, this.ViewSize.y) / 1080;
      r = Rect.minMaxRect(Math.max(r.xMin, -this.ViewSize.x / 2 + SideL * k), r.yMin, r.xMax, r.yMax);
    }
    this.rect = r;
    // extents of the whole board (all tiles, removed ones too, so the view never jumps)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of this.tiles) {
      const p = MahjongGame.Raw(t.P);
      minX = Math.min(minX, p.x - 0.5); maxX = Math.max(maxX, p.x + 0.5 + Depth);
      minY = Math.min(minY, p.y - TH / 2 - Depth); maxY = Math.max(maxY, p.y + TH / 2);
    }
    if (this.tiles.length === 0) { minX = -4; maxX = 4; minY = -3; maxY = 3; }
    this.center = new V2((minX + maxX) / 2, (minY + maxY) / 2);
    this.need = new V2(maxX - minX + 0.15, maxY - minY + 0.15);
    this.fit = Math.min(MaxTile, r.width / this.need.x, r.height / this.need.y);
    const comfort = (ComfortCss * Screen.dpr) / Math.max(1, Camera.ppu);
    this.zoomMax = Mathf.clamp(comfort / this.fit, 1, 2.6);
    if (this.zoomMax < 1.12) this.zoomMax = 1;
    this.zoom = Mathf.clamp(this.zoom, 1, this.zoomMax);
    this.ClampPan();
    this.ApplyView();
    this.PlaceHud();
    for (const t of this.tiles) this.Place(t);
  }

  /** Position of a tile's face centre in board units (one unit = a tile width), before centring. */
  private static Raw(p: Pos) { return new V2(p.x * 0.5 - p.z * Depth, -p.y * 0.5 * TH + p.z * Depth); }
  private BoardPos(t: Tile) { return MahjongGame.Raw(t.P).sub(this.center); }

  private get Scale() { return this.fit * this.zoom; }

  private ApplyView() {
    this.boardRoot.localPosition = new V3(this.rect.center.x + this.pan.x, this.rect.center.y + this.pan.y, 0);
    this.boardRoot.localScale = new V3(this.Scale, this.Scale, 1);
    // texture size follows the tile's size on screen (applied once the zoom settles)
    const want = MahjongArt.SizeFor(this.Scale * Camera.ppu);
    if (this.texSize === 0) this.SetTexSize(want);
    else if (want !== this.texSize) { if (want !== this.pendingSize) { this.pendingSize = want; this.sizeTimer = 0.18; } }
    else this.pendingSize = 0;
  }

  private ClampPan() {
    const s = this.Scale;
    const mx = Math.max(0, (this.need.x * s - this.rect.width) / 2 + 0.3), my = Math.max(0, (this.need.y * s - this.rect.height) / 2 + 0.3);
    this.pan = this.zoom <= 1.001 ? V2.zero : new V2(Mathf.clamp(this.pan.x, -mx, mx), Mathf.clamp(this.pan.y, -my, my));
  }

  private ToBoard(world: V2) { return world.sub(xy(this.boardRoot.localPosition)).div(this.Scale); }

  /** Zooms keeping the board point `anchor` (board units) under the world point `at`. */
  private ZoomTo(z: number, anchor: V2, at: V2) {
    this.zoom = Mathf.clamp(z, 1, this.zoomMax);
    this.pan = at.sub(anchor.mul(this.Scale)).sub(this.rect.center);
    this.ClampPan();
    this.ApplyView();
  }

  private ToggleZoom() {
    if (this.zoomMax <= 1) return;
    this.zoomGoal = this.zoom > (1 + this.zoomMax) / 2 ? 1 : this.zoomMax;
    Sfx.play(Snd.Whoosh, 0.25);
  }

  private SetTexSize(size: number) {
    if (size === this.texSize) return;
    if (this.texSize > 0) { this.releaseSize = this.texSize; this.releaseFrames = 3; }
    this.texSize = size;
    this.pendingSize = 0;
    for (const t of this.tiles) this.Skin(t);
  }

  private Skin(t: Tile) {
    const g = Geom(this.texSize), off = new V3(-g.offset.x, -g.offset.y, 0);
    t.Body.sprite = MahjongArt.Tile(t.Face, this.texSize);
    t.Glow.sprite = MahjongArt.Glow(this.texSize);
    t.Body.transform.localPosition = off;
    t.Glow.transform.localPosition = off;
  }

  private Place(t: Tile) {
    const base = 10 + t.P.z * 400 + (t.P.x + t.P.y) * 4 + (t.Remove >= 0 ? 4000 : 0);
    t.Body.sortingOrder = base;
    t.Glow.sortingOrder = base + 1;
  }

  // ------------------------------------------------------------------ level

  private BuildLevel(lvl: number) {
    for (const t of this.tiles) t.Root.destroy();
    this.tiles = [];
    this.history = [];
    this.selected = null;
    this.hintPair = null;
    this.fx.clear();
    const layout = LayoutFor(lvl);
    this.layoutName = layout.Name;
    this.board = new Board(layout.Positions);
    const deal = DealLayout(this.board, lvl * 7919 + 13);
    this.faces = deal.faces.slice();
    this.solution = deal.solution;
    this.rng = new SysRandom(lvl * 31 + 7);
    layout.Positions.forEach((p, i) => {
      const t = new Tile();
      t.Id = i; t.Face = this.faces[i]; t.P = p;
      t.Root = new GameObject("Tile", this.boardRoot);
      t.Body = Art.spr(t.Root, "Body", MahjongArt.Glow(MahjongArt.Sizes[0]), Color.white, 1, 0, Art.Flat);
      t.Glow = Art.spr(t.Root, "Glow", MahjongArt.Glow(MahjongArt.Sizes[0]), Color.clear, 1, 0, Art.Flat);
      t.Appear = -(p.z * 0.12 + (p.x + p.y) * 0.008 + this.rng.nextDouble() * 0.08);
      this.tiles.push(t);
    });
    this.zoom = 1;
    this.zoomGoal = -1;
    this.pan = V2.zero;
    this.Layout();
    if (this.texSize > 0) for (const t of this.tiles) this.Skin(t);
    this.Recount();
  }

  private get On() { return this.tiles.map((t) => t.OnBoard); }

  /** Free flags, tiles left and the number of available matches. */
  private Recount() {
    const on = this.On;
    this.left = 0;
    for (const t of this.tiles) { t.Free = t.OnBoard && this.board.isFree(t.Id, on); if (t.OnBoard) this.left++; }
    this.moves = this.left > 0 ? FreePairs(this.board, on, this.faces).length : 0;
    this.stuckHandled = false;
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.level = this.CurrentLevel;
    this.BuildLevel(this.level);
    this.ended = false;
    this.attractTimer = 2.2;
    this.path?.refresh(this.Data, this.level);
  }

  protected BeginRun() {
    this.level = this.CurrentLevel;
    this.BuildLevel(this.level);
    this.timer = 0;
    this.combo = 0;
    this.boosters = 0;
    this.blockedTaps = 0;
    this.ended = this.freeShuffleUsed = false;
    this.pointer.reset();
    this.pointer.topBand = 0;
    this.UI.Announce(`LEVEL ${this.level}`, Jade, 1.3);
    if (this.Data.get("runs") === 0) this.UI.Hint("Tap two matching BRIGHT tiles to clear them. Dim tiles are blocked.");
    else if (this.zoomMax > 1) this.UI.Toast("Big board: pinch, scroll or tap ZOOM for larger tiles.", 3.5);
    this.Data.add("runs", 1);
    Sfx.setIntensity(0.1);
    this.UpdateHud();
  }

  protected OnPauseChanged(_paused: boolean) { this.pointer.reset(); }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Animate(dt);
    this.Ambient(dt);
    if (this.State !== Phase.Title) return;
    this.attractTimer -= dt;
    if (this.attractTimer > 0) return;
    this.attractTimer = 1.3;
    // attract mode: the board slowly solves itself, then deals again
    if (this.left === 0) { this.BuildLevel(this.level); this.attractTimer = 2.2; return; }
    const pairs = FreePairs(this.board, this.On, this.faces);
    if (pairs.length === 0) { this.BuildLevel(this.level); this.attractTimer = 2.2; return; }
    const p = BestPair(this.board, this.On, this.faces, pairs, this.rng);
    this.RemovePair(this.tiles[p[0]], this.tiles[p[1]], false);
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    this.Gestures(dt);
    this.Animate(dt);
    this.Ambient(dt);
    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.State === Phase.Playing) this.Win();
      return;
    }
    this.timer += dt;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
    this.hintTimer -= dt;
    if (this.hintTimer <= 0) this.hintPair = null;

    if (this.pointer.tap && !this.suppressTap && !this.UI.ChoiceOpen) this.Tap(this.ScreenToWorld(this.pointer.screen));
    this.Hover();
    this.Keys();
    this.CheckEnd();
    this.UpdateHud();
  }

  private Keys() {
    if (Keyboard.letter("h").wasPressedThisFrame) this.OnHint();
    if (Keyboard.letter("u").wasPressedThisFrame || Keyboard.backspace.wasPressedThisFrame) this.OnUndo();
    if (Keyboard.letter("s").wasPressedThisFrame) this.OnShuffle();
    if (Keyboard.letter("z").wasPressedThisFrame) this.ToggleZoom();
  }

  /** Pinch / wheel zoom and drag panning (only when zoomed in). */
  private Gestures(dt: number) {
    const touches = Touchscreen.touches.filter((t) => t.press.isPressed);
    if (touches.length >= 2 && this.zoomMax > 1) {
      const a = touches[0].position, b = touches[1].position;
      const d = Math.max(1, a.sub(b).magnitude), mid = this.ScreenToWorld(a.add(b).mul(0.5));
      if (!this.pinching) { this.pinching = true; this.pinchD = d; this.pinchZoom = this.zoom; this.pinchAnchor = this.ToBoard(mid); }
      else this.ZoomTo(this.pinchZoom * (d / this.pinchD), this.pinchAnchor, mid);
      this.suppressTap = true;
      this.dragging = false;
      this.zoomGoal = -1;
    } else this.pinching = false;
    if (touches.length === 0 && !this.pointer.held && !Mouse.leftButton.isPressed) this.suppressTap = false;

    if (Mouse.present && Math.abs(Mouse.scroll) > 0 && this.zoomMax > 1 && !this.UI.ChoiceOpen) {
      const at = this.ScreenToWorld(Mouse.position);
      this.ZoomTo(this.zoom * Math.exp(Mouse.scroll * 0.0016), this.ToBoard(at), at);
      this.zoomGoal = -1;
    }

    if (this.pointer.down) { this.dragging = false; this.dragPan = this.pan; this.dragWorld = this.ScreenToWorld(this.pointer.screen); }
    if (this.pointer.held && !this.pinching && this.zoom > 1.01) {
      if (!this.dragging && this.pointer.screen.sub(this.pointer.startScreen).magnitude > TapPointer.dp(12)) this.dragging = true;
      if (this.dragging) {
        this.pan = this.dragPan.add(this.ScreenToWorld(this.pointer.screen).sub(this.dragWorld));
        this.ClampPan();
        this.ApplyView();
      }
    }

    if (this.zoomGoal > 0) {
      const anchor = this.ToBoard(this.rect.center);
      const z = Mathf.lerp(this.zoom, this.zoomGoal, 1 - Math.exp(-dt * 12));
      this.ZoomTo(Math.abs(z - this.zoomGoal) < 0.01 ? this.zoomGoal : z, anchor, this.rect.center);
      if (this.zoom === this.zoomGoal) this.zoomGoal = -1;
    }
  }

  private Hover() {
    const mouse = Mouse.present && !this.pointer.usingTouch;
    const h = mouse ? this.TileAt(this.ScreenToWorld(Mouse.position), false) : null;
    for (const t of this.tiles) t.Hover = Mathf.moveTowards(t.Hover, t === h && t.Free ? 1 : 0, Time.deltaTime * 8);
  }

  /** Top tile under a world point; with `forgiving`, the nearest free tile when the point is just off a face. */
  private TileAt(w: V2, forgiving = true) {
    const q = this.ToBoard(w);
    let best: Tile | null = null, bestKey = -Infinity;
    for (const t of this.tiles) {
      if (!t.OnBoard || t.Remove >= 0) continue;
      const d = q.sub(this.BoardPos(t));
      if (Math.abs(d.x) > 0.5 || Math.abs(d.y) > TH / 2) continue;
      const key = t.P.z * 1000 + t.P.x + t.P.y;
      if (key > bestKey) { bestKey = key; best = t; }
    }
    if (best || !forgiving) return best;
    let near: Tile | null = null, nd = 0.62;
    for (const t of this.tiles) {
      if (!t.OnBoard || t.Remove >= 0 || !t.Free) continue;
      const d = q.sub(this.BoardPos(t)), dist = new V2(d.x, d.y / TH).magnitude;
      if (dist < nd) { nd = dist; near = t; }
    }
    return near;
  }

  private Tap(w: V2) {
    const t = this.TileAt(w);
    if (!t) {
      if (this.selected) { this.selected = null; Sfx.playClip(this.tapClip, 0.4, 0.9); }
      return;
    }
    if (!t.Free) {
      t.Wiggle = 1;
      Sfx.playClip(this.denyClip, 0.7);
      Fx.haptic();
      if (++this.blockedTaps === 2 || this.blockedTaps === 6) this.UI.Toast("That tile is blocked: free its left or right side, or clear the tile on top.", 3.5);
      return;
    }
    if (this.selected === t) { this.selected = null; Sfx.playClip(this.tapClip, 0.5, 0.92); return; }
    if (this.selected && MatchKey(this.selected.Face) === MatchKey(t.Face)) {
      this.RemovePair(this.selected, t, true);
      return;
    }
    if (this.selected) this.selected.Wiggle = 0.5;
    this.selected = t;
    Sfx.playClip(this.selClip, 0.8, 0.96 + this.rng.nextDouble() * 0.08);
  }

  private RemovePair(a: Tile, b: Tile, real: boolean) {
    const mid = xy(a.Root.localPosition).add(xy(b.Root.localPosition)).mul(0.5);
    for (const t of [a, b]) {
      t.OnBoard = false;
      t.Remove = 0;
      t.RemoveDir = mid.sub(xy(t.Root.localPosition));
      this.Place(t);
    }
    this.selected = null;
    this.hintPair = null;
    this.history.push([a, b]);
    this.Recount();
    const notes = [1, 1.122, 1.26, 1.498, 1.682, 2];
    if (real) {
      this.combo = this.comboTimer > 0 ? this.combo + 1 : 0;
      this.comboTimer = 3.2;
      Sfx.playClip(this.tapClip, 0.9);
      Sfx.playClip(this.bellClip, 0.85, notes[Math.min(this.combo, notes.length - 1)]);
      this.Data.add("pairs", 1);
      if (this.Data.get("pairs") === 1) this.UI.Hint(null);
      Fx.haptic();
      if (this.combo === 4) this.UI.Announce("LOVELY!", Gold, 1);
      else if (this.combo === 7) this.UI.Announce("SERENE!", Jade, 1);
    } else Sfx.playClip(this.bellClip, 0.25, notes[this.rng.next(notes.length)]);
  }

  private CheckEnd() {
    if (this.Busy()) return;
    if (this.left === 0) {
      this.ended = true;
      this.endTimer = 1.6;
      this.selected = null;
      this.UI.Announce("BOARD CLEARED!", Gold, 1.6);
      for (let i = 0; i < 3; i++) this.fx.confetti(new V2((i - 1) * 2.2, this.rect.center.y + 1), 26, 8, [Gold, Jade, Coral, Sky, Color.white], 0.2);
      this.Petals(40);
      Sfx.play(Snd.Win, 0.8);
      return;
    }
    if (this.moves === 0 && !this.stuckHandled) {
      this.stuckHandled = true;
      this.Stuck();
    }
  }

  /** Removal or shuffle animations still running. */
  private Busy() {
    for (const t of this.tiles) if ((t.Remove >= 0 && t.Remove < 1) || t.Flip < 1 || t.Move < 1) return true;
    return false;
  }

  // ------------------------------------------------------------------ no moves

  private Stuck() {
    Sfx.play(Snd.Warn, 0.4);
    const cards: Choice[] = [];
    const actions: (() => void)[] = [];
    if (!this.freeShuffleUsed) {
      cards.push({ title: "FREE SHUFFLE", body: "Mix the tiles left into a new layout that can be solved.", color: Jade, icon: MahjongArt.ShuffleIcon });
      actions.push(() => { this.freeShuffleUsed = true; this.boosters++; this.DoShuffle(); });
    } else if (this.Shuffles > 0) {
      cards.push({ title: `USE A SHUFFLE (×${this.Shuffles})`, body: "Spend one of your shuffles to keep playing.", color: Jade, icon: MahjongArt.ShuffleIcon });
      actions.push(() => { this.Shuffles = this.Shuffles - 1; this.boosters++; this.DoShuffle(); });
    }
    if (this.history.length > 0 && this.Undos > 0) {
      cards.push({ title: `UNDO A PAIR (×${this.Undos})`, body: "Take back your last match and try another way.", color: Sky, icon: MahjongArt.UndoIcon });
      actions.push(() => { this.Undos = this.Undos - 1; this.boosters++; this.DoUndo(); });
    }
    if (cards.length === 0) { this.Lose(); return; }
    cards.push({ title: "END LEVEL", body: "Stop here and see your result.", color: Coral, icon: Art.Diamond });
    actions.push(() => this.Lose());
    this.UI.ShowChoices("NO MORE MOVES", cards, (i) => actions[i]?.());
  }

  // ------------------------------------------------------------------ boosters

  private OnUndo() { this.Booster("undo", () => this.Undos, (v) => (this.Undos = v), () => this.DoUndo()); }
  private OnHint() { this.Booster("hint", () => this.Hints, (v) => (this.Hints = v), () => this.DoHint()); }
  private OnShuffle() { this.Booster("shuffle", () => this.Shuffles, (v) => (this.Shuffles = v), () => this.DoShuffle()); }

  private Booster(key: string, get: () => number, set: (v: number) => void, run: () => boolean) {
    if (this.ended || this.State !== Phase.Playing || this.UI.ChoiceOpen || this.Busy()) return;
    if (get() > 0) {
      if (run()) { set(get() - 1); this.boosters++; this.Data.flush(); }
      else Sfx.playClip(this.denyClip, 0.6);
      return;
    }
    if (!AdService.rewardedAvailable) return;
    AdService.showRewarded((ok) => {
      if (!ok) return;
      set(get() + 1);
      this.Data.flush();
      this.UI.Toast("+1 " + key.toUpperCase(), 2);
      Sfx.play(Snd.PowerUp, 0.7);
    });
  }

  private DoHint() {
    const p = HintPair(this.board, this.On, this.faces, this.rng);
    if (!p) return false;
    this.hintPair = [this.tiles[p[0]], this.tiles[p[1]]];
    this.hintTimer = 4;
    this.selected = null;
    Sfx.playClip(this.hintClip, 0.9);
    for (const t of this.hintPair) this.fx.sparkle(this.WorldOf(t), Gold, 5, 0.4 * this.Scale, 0.25 * this.Scale);
    return true;
  }

  private DoUndo() {
    const last = this.history.pop();
    if (!last) return false;
    for (const t of last) {
      t.OnBoard = true;
      t.Remove = -1;
      t.Appear = 0;
      t.Root.setActive(true);
      this.Place(t);
    }
    this.selected = null;
    this.hintPair = null;
    this.Recount();
    Sfx.play(Snd.Whoosh, 0.35);
    return true;
  }

  /** Re-deals the faces of the tiles left into a solvable arrangement (moving tiles to flat rows if it must). */
  private DoShuffle() {
    const on = this.On;
    if (this.left < 2) return false;
    let deal = Redeal(this.board, on, this.faces, this.rng);
    if (!deal) {
      // these positions can never be emptied (e.g. two tiles stacked): lay the tiles out in rows
      const live = this.tiles.filter((t) => t.OnBoard);
      const c = this.CentreHalfUnits();
      const flat = FlatPositions(live.length, c, live.length > 12 ? 6 : 4);
      const pos = this.tiles.map((t) => t.P);
      live.forEach((t, i) => { t.From = this.BoardPos(t); t.P = flat[i]; t.Move = 0; pos[t.Id] = flat[i]; });
      // removed tiles keep their old spots but can't come back
      this.history = [];
      this.board = new Board(pos);
      deal = Redeal(this.board, this.On, this.faces, this.rng);
      if (!deal) return false;
      for (const t of live) { const target = this.BoardPos(t); t.From = t.From.sub(target); }
    }
    this.solution = deal.solution;
    let k = 0;
    for (const t of this.tiles) {
      if (!t.OnBoard) continue;
      t.NewFace = deal.faces[t.Id];
      t.Flip = -k * 0.012;
      k++;
    }
    this.faces = deal.faces.slice();
    this.selected = null;
    this.hintPair = null;
    for (const t of this.tiles) this.Place(t);
    this.Recount();
    Sfx.play(Snd.Whoosh, 0.6);
    Sfx.playClip(this.shuffleClip, 0.9);
    return true;
  }

  private CentreHalfUnits() {
    let sx = 0, sy = 0, n = 0;
    for (const t of this.tiles) if (t.OnBoard) { sx += t.P.x; sy += t.P.y; n++; }
    return { x: n ? sx / n : 0, y: n ? sy / n : 0 };
  }

  // ------------------------------------------------------------------ animation

  private WorldOf(t: Tile) { return xy(this.boardRoot.localPosition).add(xy(t.Root.localPosition).mul(this.Scale)); }

  private Animate(dt: number) {
    if (this.pendingSize > 0) { this.sizeTimer -= Time.unscaledDeltaTime; if (this.sizeTimer <= 0 && !this.pinching) this.SetTexSize(this.pendingSize); }
    if (this.releaseFrames > 0 && --this.releaseFrames === 0 && this.releaseSize !== this.texSize) MahjongArt.Release(this.releaseSize);
    const pulse = 0.55 + 0.45 * Math.sin(Time.unscaledTime * 6);
    for (const t of this.tiles) {
      if (t.Remove >= 1) continue;
      let pos = this.BoardPos(t), scale = 1, alpha = 1, sx = 1;
      if (t.Appear < 1) {
        t.Appear = Math.min(1, t.Appear + dt * 2.2);
        const a = Mathf.clamp01(t.Appear);
        pos = pos.add(new V2(0, (1 - Ease.outCubic(a)) * 0.9));
        alpha = Mathf.clamp01(a * 2);
      }
      if (t.Move < 1) {
        t.Move = Math.min(1, t.Move + dt * 2.5);
        pos = pos.add(t.From.mul(1 - Ease.inOutCubic(t.Move)));
      }
      if (t.Flip < 1) {
        const before = t.Flip;
        t.Flip = Math.min(1, t.Flip + dt * 2.4);
        const f = Mathf.clamp01(t.Flip);
        sx = Math.max(0.04, Math.abs(Math.cos(f * Math.PI)));
        if (before < 0.5 && t.Flip >= 0.5 && t.NewFace >= 0) {
          t.Face = t.NewFace;
          t.NewFace = -1;
          t.Body.sprite = MahjongArt.Tile(t.Face, this.texSize);
        }
      }
      if (t.Remove >= 0) {
        t.Remove = Math.min(1, t.Remove + dt / RemoveTime);
        const r = t.Remove, e = Ease.outCubic(Mathf.clamp01(r * 1.4));
        pos = pos.add(t.RemoveDir.mul(0.3 * e)).add(new V2(0, 0.28 * e));
        scale = 1 + 0.12 * Math.sin(Math.min(1, r * 1.8) * Math.PI) - CasualArt.smooth(0.55, 1, r) * 0.5;
        alpha = 1 - CasualArt.smooth(0.5, 1, r);
        if (r >= 1) {
          t.Root.setActive(false);
          const w = this.WorldOf(t);
          this.fx.sparkle(w, Gold, 4, 0.35 * this.Scale, 0.28 * this.Scale);
          this.fx.pop(w, Pal.hex(0xfff3d6), 8, 2.4 * this.Scale, 0.12 * this.Scale, 0.4);
          continue;
        }
      }
      t.Wiggle = Mathf.moveTowards(t.Wiggle, 0, dt * 3);
      const wig = Math.sin(t.Wiggle * 28) * t.Wiggle * 0.07;
      const isSel = this.selected === t;
      const isHint = !!this.hintPair && (this.hintPair[0] === t || this.hintPair[1] === t);
      t.Sel = Mathf.moveTowards(t.Sel, isSel ? 1 : 0, dt * 10);
      t.Hint = Mathf.moveTowards(t.Hint, isHint ? 1 : 0, dt * 6);
      t.Dim = Mathf.moveTowards(t.Dim, t.Free || t.Remove >= 0 || this.State === Phase.Title ? 1 : 0, dt * 5);
      const lift = t.Sel * 0.05;
      scale *= 1 + t.Sel * 0.05 + t.Hint * 0.04 * pulse;
      t.Root.localPosition = new V3(pos.x + wig, pos.y + lift, 0);
      t.Root.localScale = new V3(scale * sx, scale, 1);
      let c = Color.lerp(Blocked, Color.white, t.Dim);
      c = Color.lerp(c, SelTint, t.Sel);
      c = Color.lerp(c, HintTint, t.Hint * (0.35 + 0.45 * pulse));
      if (this.State === Phase.Over) alpha *= 0.3;
      t.Body.color = c.withAlpha(alpha);
      let g = Color.clear;
      if (t.Sel > 0.01) g = Gold.withAlpha(0.95 * t.Sel);
      else if (t.Hint > 0.01) g = Pal.hex(0x7dffd6).withAlpha(t.Hint * (0.6 + 0.4 * pulse));
      else if (t.Hover > 0.01) g = Color.white.withAlpha(0.45 * t.Hover);
      t.Glow.color = g.withAlpha(g.a * alpha);
    }
  }

  private Ambient(dt: number) {
    this.moteTimer -= dt;
    if (this.moteTimer > 0) return;
    this.moteTimer = 0.55;
    const x = (this.rng.nextDouble() * 2 - 1) * this.ViewSize.x * 0.5;
    const warm = this.rng.nextDouble() < 0.5 ? Pal.hex(0xffd98a) : Pal.hex(0xbff5dd);
    this.motes.emit(new V2(x, -this.ViewSize.y * 0.55), new V2((this.rng.nextDouble() - 0.5) * 0.3, 0.5 + this.rng.nextDouble() * 0.4),
      warm.withAlpha(0.18 + this.rng.nextDouble() * 0.12), 0.3 + this.rng.nextDouble() * 0.5, 9, MahjongArt.Mote, 0, 0, false, 0);
  }

  private Petals(n: number) {
    for (let i = 0; i < n; i++) {
      const x = (this.rng.nextDouble() * 2 - 1) * this.ViewSize.x * 0.5;
      this.fx.emit(new V2(x, this.ViewSize.y * 0.55 + this.rng.nextDouble() * 2), new V2(0.4 + this.rng.nextDouble() * 0.6, -1.4 - this.rng.nextDouble()),
        Color.white, 0.3, 4.5, MahjongArt.Petal, 0.2, (this.rng.nextDouble() * 2 - 1) * 160, false, 0);
    }
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    CasualUI.setText(this.levelText, "LEVEL " + this.level);
    CasualUI.setText(this.nameText, this.layoutName);
    CasualUI.setText(this.timeText, Fmt.clock(this.timer));
    CasualUI.setText(this.leftText, `${this.left} TILES`);
    CasualUI.setText(this.movesText, this.moves === 1 ? "1 MATCH" : `${this.moves} MATCHES`);
    this.movesText.color = this.moves <= 1 ? Coral : Jade;
    const busy = this.ended;
    CasualUI.booster(this.undoButton, "UNDO", this.Undos, !busy && this.history.length > 0);
    CasualUI.booster(this.hintButton, "HINT", this.Hints, !busy && this.moves > 0);
    CasualUI.booster(this.shuffleButton, "SHUFFLE", this.Shuffles, !busy && this.left > 2);
    const zin = this.zoom < (1 + this.zoomMax) / 2;
    CasualUI.setText(this.zoomButton.label, zin ? "ZOOM IN" : "ZOOM OUT");
    if (this.zoomButton.icon) this.zoomButton.icon.sprite = MahjongArt.ZoomIcon(zin);
  }

  // ------------------------------------------------------------------ results

  private Win() {
    const n = this.tiles.length;
    const par = 20 + n * 1.6;
    let stars = this.timer <= par ? 3 : this.timer <= par * 2 ? 2 : 1;
    if (this.boosters >= 1) stars--;
    if (this.boosters >= 4) stars--;
    stars = Math.max(1, stars);
    const prev = this.Data.get("s" + this.level);
    if (stars > prev) {
      this.Data.set("s" + this.level, stars);
      this.Data.add("stars", stars - prev);
    }
    const newBest = this.Data.min("t" + this.level, Mathf.roundToInt(this.timer * 1000));
    this.Data.set("level", this.level + 1);
    this.Data.add("cleared", 1);
    const gift = this.level % 3 === 0;
    if (gift) { this.Hints = this.Hints + 1; this.Undos = this.Undos + 1; this.Shuffles = this.Shuffles + 1; }
    const lvl = this.level;
    this.Finish(new Result({
      Headline: `LEVEL ${lvl} CLEARED!`,
      HeadlineColor: Gold,
      Stars: stars,
      Value: Fmt.clock(this.timer),
      NewBest: newBest && prev > 0,
      BestLine: gift ? "GIFT: +1 HINT, UNDO & SHUFFLE" : `NEXT: LEVEL ${lvl + 1} · ${LayoutFor(lvl + 1).Name}`,
      Stats: [
        ["TIME", Fmt.clock(this.timer)],
        ["PAIRS", String(n / 2)],
        ["BOOSTERS", String(this.boosters)],
        ["3★ TIME", Fmt.clock(par)],
      ],
      Primary: "NEXT LEVEL",
      Victory: true,
      Reward: () => {
        this.Hints = this.Hints + 1;
        this.Data.flush();
        this.UI.Toast("+1 HINT", 2);
        Sfx.play(Snd.PowerUp, 0.8);
      },
      RewardLabel: "GET A FREE HINT (WATCH AD)",
    }));
  }

  private Lose() {
    this.selected = null;
    Sfx.play(Snd.Lose, 0.5);
    this.Finish(new Result({
      Headline: "NO MORE MOVES",
      HeadlineColor: Pal.hex(0xffd0c4),
      Value: `${this.left}`,
      BestLine: "TILES LEFT ON THE BOARD",
      Stats: [
        ["LEVEL", String(this.level)],
        ["PAIRS", String((this.tiles.length - this.left) / 2)],
        ["TIME", Fmt.clock(this.timer)],
        ["STARS", String(this.Data.get("stars"))],
      ],
      Primary: "TRY AGAIN",
      Reward: () => this.Continue(),
      RewardLabel: "SHUFFLE & CONTINUE (WATCH AD)",
    }));
  }

  private Continue() {
    this.pointer.reset();
    this.Revive();
    this.boosters++;
    this.DoShuffle();
    this.UI.Announce("SHUFFLED!", Jade, 1.2);
    Sfx.play(Snd.PowerUp);
  }

  // ------------------------------------------------------------------ dev / tests

  /** Board state for scripted tests (dev builds expose the game as window.__na.game). */
  DebugState() {
    const on = this.On;
    const sol = this.solution.filter(([a, b]) => on[a] && on[b]);
    return {
      state: Phase[this.State], level: this.level, layout: this.layoutName, left: this.left, moves: this.moves, zoom: this.zoom, zoomMax: this.zoomMax,
      texSize: this.texSize, boosters: this.boosters, freeShuffleUsed: this.freeShuffleUsed, busy: this.Busy(),
      choice: this.UI.ChoiceOpen,
      solution: sol,
      tiles: this.tiles.map((t) => {
        const sp = Camera.worldToScreen(this.WorldOf(t));
        const c = screenToClient(new V2(sp.x, Screen.height - sp.y));
        return { id: t.Id, face: t.Face, key: MatchKey(t.Face), on: t.OnBoard, free: t.Free, x: c.x, y: c.y, z: t.P.z };
      }),
    };
  }
}
