import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, CasualUI, Color, Ease, Fmt, Fx, GameInfo,
  GameObject, howTo, Image, LevelPath, Mathf, Pal, Phase, Rect, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom,
  TapPointer, Text, TextAnchor, TouchScheme, UIKit, V2, V3,
} from "../../kit";

/**
 * HEXA SORT: drag stacks of coloured hexagon tiles onto a hex board. When a stack lands next to stacks whose
 * top colour matches, those tiles slide over onto it; ten or more of one colour on top of a stack clear away and
 * can set off chains. Clear the level's target before the board fills up. HAMMER smashes a stack and SHUFFLE
 * deals new stacks (both refill with rewarded ads); a rewarded ad can also clear room to continue once.
 * (Port of HexaSortGame.cs.)
 */

// ------------------------------------------------------------------ tuning

const TopBand = 250, BottomBand = 170;
const ClearAt = 10, MaxVisible = 16;
const Lift = 0.13;

const Colors = [
  Pal.hex(0xff5468), Pal.hex(0xff9a2e), Pal.hex(0xffd23f), Pal.hex(0x4cd07d), Pal.hex(0x2ec4c4), Pal.hex(0x4d8cff), Pal.hex(0x9b6bff), Pal.hex(0xff77c8),
];
const Ink = Pal.hex(0x3c2e5a), Violet = Pal.hex(0x7a5cff), Gold = Pal.hex(0xffb627);

class Cell {
  Q = 0; R = 0;
  Pos = V2.zero;
  Slot!: SpriteRenderer;
  Stack: number[] = [];
  readonly Tiles: SpriteRenderer[] = [];
  Locked = false;
  Bump = 0;
  Incoming = 0;
}

class Offer {
  Stack: number[] = [];
  readonly Tiles: SpriteRenderer[] = [];
  Home = V2.zero; Pos = V2.zero;
  Used = false;
}

class Flyer {
  Sr!: SpriteRenderer;
  From = V2.zero; To = V2.zero;
  T = 0; Delay = 0; Dur = 0;
  Active = false;
  Color = 0;
  Target: Cell | null = null;
}

// ------------------------------------------------------------------ art

/** Signed distance to a flat-topped hexagon of circumradius r. */
function SdHex(p: V2, r: number) {
  let qx = Math.abs(p.x), qy = Math.abs(p.y); // flat top
  const kx = -0.866025404, ky = 0.5, kz = 0.577350269;
  const dot = Math.min(kx * qx + ky * qy, 0);
  qx -= 2 * dot * kx;
  qy -= 2 * dot * ky;
  const rr = r * 0.866025404;
  qx -= Mathf.clamp(qx, -kz * rr, kz * rr);
  qy -= rr;
  return Math.hypot(qx, qy) * Mathf.sign(qy);
}

const HexTop = () => CasualArt.make("hx-top", 128, 128, (p) => {
  const px = 2 / 128;
  const d = SdHex(p, 0.9) - 0.04;
  let c = Color.lerp(new Color(0.86, 0.86, 0.86, 1), Color.white, CasualArt.smooth(-0.8, 0.8, p.y - p.x * 0.3));
  c = Color.lerp(new Color(0.62, 0.62, 0.62, 1), c, CasualArt.fill(d + 0.07, px));
  const hl = CasualArt.smooth(0.3, 0, p.sub(new V2(-0.3, 0.35)).magnitude);
  c = Color.lerp(c, Color.white, hl * 0.4);
  return c.withAlpha(CasualArt.fill(d, px));
});

/** A tile: top face plus a darker side extrusion below it (white, tinted per colour). */
const HexTile = () => CasualArt.make("hx-tile", 128, 160, (p) => {
  const px = 2 / 128;
  const top = p.sub(new V2(0, 0.12));
  const dTop = SdHex(top, 0.9) - 0.03;
  const dSide = Math.min(SdHex(p.add(new V2(0, 0.12)), 0.9) - 0.03, Math.max(Math.abs(p.x) - 0.9, Math.abs(p.y) - 0.12));
  let c = new Color(1, 1, 1, 0);
  c = CasualArt.over(c, new Color(0.55, 0.55, 0.55, 1), CasualArt.fill(dSide, px));
  let face = Color.lerp(new Color(0.85, 0.85, 0.85, 1), Color.white, CasualArt.smooth(-0.8, 0.8, top.y - top.x * 0.3));
  face = Color.lerp(new Color(0.72, 0.72, 0.72, 1), face, CasualArt.fill(dTop + 0.06, px));
  c = CasualArt.over(c, face, CasualArt.fill(dTop, px));
  return c;
});

const Backdrop = () => CasualArt.make("hx-bg", 128, 256, (p) => {
  let c = Color.lerp(Pal.hex(0xffe2d2), Pal.hex(0xe4dcff), CasualArt.smooth(-2, 2, p.y));
  // faint honeycomb
  const g = new V2(p.x * 3, p.y * 3);
  const hex = SdHex(new V2(Mathf.repeat(g.x + 0.5, 1.5) - 0.75, Mathf.repeat(g.y + 0.43, 0.866) - 0.433), 0.5);
  c = Color.lerp(c, Color.white, CasualArt.smooth(0.04, 0, Math.abs(hex)) * 0.25);
  return c.withAlpha(1);
});

const Key = (q: number, r: number) => q + "," + r;

export class HexaSortGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject;
  private bgCover!: SpriteRenderer; private boardPanel!: SpriteRenderer;
  private cells: Cell[] = [];
  private readonly byCoord = new Map<string, Cell>();
  private readonly offers: Offer[] = new Array(3);
  private readonly flyers: Flyer[] = [];
  private readonly tilePool: SpriteRenderer[] = [];
  private work: Cell[] = [];
  private fx!: CasualFx;
  private readonly pointer = new TapPointer();
  private rng = new SysRandom();
  private path!: LevelPath;

  private hexSize = 0.8; private stepTimer = 0; private endTimer = 0; private attractTimer = 0;
  private level = 0; private cleared = 0; private target = 0; private colorsInLevel = 0; private score = 0; private combo = 0;
  private resolving = false; private ended = false; private won = false; private revived = false; private hammerMode = false;
  private dragging: Offer | null = null;
  private dragOffset = V2.zero;

  private levelText!: Text; private goalText!: Text; private scoreText!: Text;
  private goalFill!: Image;
  private hammerButton!: ArcadeButton; private shuffleButton!: ArcadeButton;
  private placeClip!: AudioClip; private slideClip!: AudioClip; private clearClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "hexasort",
      Title: "HEXA SORT",
      Tagline: "STACK. SORT. CLEAR THE COLOURS.",
      Accent: Violet,
      Accent2: Gold,
      BgTop: Pal.hex(0xe9e2ff),
      BgBottom: Pal.hex(0xffe4d6),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 96, rootHz: 130.8, degrees: [0, 5, 3, 4], seed: 12, energy: 0.35, major: true },
      Reminders: [
        "Your hexagons are waiting|Sort the colours and clear the board.",
        "A satisfying puzzle break|Stack, slide and clear ten in a row.",
        "New level unlocked|Can you clear it before the board fills?",
      ],
      HowTo: [
        howTo(HexTop(), Colors[5], "DRAG a stack from the bottom onto an empty space on the board."),
        howTo(HexTop(), Colors[0], "Neighbours with the same TOP colour slide onto the stack you placed."),
        howTo(HexTop(), Colors[3], "10 or more tiles of one colour on top clear away. Chains score more!"),
        howTo(Art.Diamond, Pal.Danger, "If the board fills up with no room left, the level is lost."),
        howTo(Art.Star, Gold, "HAMMER smashes one stack. SHUFFLE gives you new stacks."),
      ],
      Tips: [
        "Place stacks next to tops of the same colour.",
        "Keep one or two spaces free for emergencies.",
        "Tall stacks of one colour are close to clearing: feed them.",
        "A clear can uncover a new top colour and start a chain.",
        "Use HAMMER on a mixed stack that blocks the middle.",
      ],
    });
  }

  protected get ShortSide() { return Screen.width > Screen.height ? 11 : 9; }

  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }
  private get Hammers() { return this.Data.get("hammer", 2); }
  private set Hammers(v: number) { this.Data.set("hammer", Math.max(0, v)); }
  private get Shuffles() { return this.Data.get("shuffle", 2); }
  private set Shuffles(v: number) { this.Data.set("shuffle", Math.max(0, v)); }

  protected BestLine() { return `LEVEL ${this.CurrentLevel}   ·   ${this.Data.get("stars")} STARS`; }
  protected StatsLine() { return `${Fmt.n(this.Data.get("tiles"))} TILES CLEARED   ·   BEST CHAIN x${Math.max(1, this.Data.get("chain"))}`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("HexWorld", this.gameObject);
    CasualLook.calm(this, 1.25, 0.15);
    this.bgCover = CasualLook.cover(this.world, Backdrop(), -910);
    this.boardPanel = Art.spr(this.world, "Panel", CasualArt.Soft, new Color(1, 1, 1, 0.55), 1, -800, Art.Flat);
    for (let i = 0; i < 3; i++) this.offers[i] = new Offer();
    this.fx = CasualFx.create(this.world, 900, 220);

    this.placeClip = Sfx.make("hx-place", 0.12, (t) => Sfx.sinP(Sfx.glide(t, 300, 200, 0.1)) * Sfx.env(t, 0.002, 0.1) * 0.35);
    this.slideClip = Sfx.make("hx-slide", 0.08, (t) => Sfx.sinP(Sfx.glide(t, 900, 1300, 0.06)) * 0.5 * Sfx.env(t, 0.001, 0.06) * 0.22);
    this.clearClip = Sfx.make("hx-clear", 0.5, (t) =>
      (Sfx.sinP(587.3 * t) * Sfx.env(t, 0.004, 0.3) + Sfx.sinP(740 * t) * Sfx.env(t - 0.06, 0.004, 0.3) + Sfx.sinP(880 * t) * Sfx.env(t - 0.12, 0.004, 0.35)) * 0.18);

    const hud = this.UI.Hud;
    const plate = UIKit.img(hud, "TopPlate", Art.UiRound, new Color(1, 1, 1, 0.82));
    plate.rectTransform.place(new V2(0.5, 1), new V2(-60, -100), new V2(820, 150));
    this.levelText = UIKit.at(UIKit.label(plate.rectTransform, "LEVEL 1", 36, Ink, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(170, 30), new V2(300, 50));
    this.scoreText = UIKit.at(UIKit.label(plate.rectTransform, "0", 30, Ink.withAlpha(0.7), TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(170, -24), new V2(300, 44));
    this.goalText = UIKit.at(UIKit.label(plate.rectTransform, "", 34, Violet), new V2(1, 0.5), new V2(-190, 28), new V2(340, 50));
    const [bar, goalFill] = UIKit.meter(plate.rectTransform, new V2(1, 0.5), new V2(-190, -26), new V2(320, 22), Violet);
    this.goalFill = goalFill;
    const bg = bar.image;
    if (bg) bg.color = new Color(0, 0, 0, 0.1);

    this.hammerButton = UIKit.buttonAt(hud, "HAMMER", new V2(0, 0), new V2(150, 85), new V2(250, 100), false, () => this.OnHammer(), 26);
    this.shuffleButton = UIKit.buttonAt(hud, "SHUFFLE", new V2(1, 0), new V2(-150, 85), new V2(250, 100), false, () => this.OnShuffle(), 26);
    this.hammerButton.setAccent(Colors[0]);
    this.shuffleButton.setAccent(Colors[5]);

    CasualLook.titleCard(this.UI, new Color(0.24, 0.18, 0.4, 0.86));
    this.path = new LevelPath(this.UI, Violet, Colors[3], Ink);
    this.Layout();
  }

  // ------------------------------------------------------------------ board

  private BuildBoard(lvl: number) {
    for (const c of this.cells) {
      for (const t of c.Tiles) this.Release(t);
      c.Slot.gameObject.destroy();
    }
    this.cells = [];
    this.byCoord.clear();
    const radius = lvl < 3 ? 2 : 3;
    for (let q = -radius; q <= radius; q++)
      for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
        const c = new Cell();
        c.Q = q; c.R = r;
        c.Slot = Art.spr(this.world, "Slot", HexTop(), new Color(0.84, 0.8, 0.96, 1), 1, -700, Art.Flat);
        this.cells.push(c);
        this.byCoord.set(Key(q, r), c);
      }
    // later levels lock a few cells (rocks) for variety
    const locks = lvl >= 4 ? Math.min(1 + Math.floor(lvl / 4), 5) : 0;
    for (let i = 0; i < locks; i++) {
      const c = this.cells[this.rng.next(this.cells.length)];
      if (c.Q === 0 && c.R === 0) continue;
      c.Locked = true;
      c.Slot.color = new Color(0.55, 0.5, 0.65, 1);
    }
    // a few starter stacks
    const starters = 2 + Math.min(Math.floor(lvl / 2), 4);
    for (let i = 0; i < starters; i++) {
      const c = this.cells[this.rng.next(this.cells.length)];
      if (c.Locked || c.Stack.length > 0) continue;
      this.RandomStack(c.Stack);
      this.SyncCell(c, true);
    }
    this.Layout();
  }

  private RandomStack(s: number[]) {
    s.length = 0;
    const runs = 1 + this.rng.next(Math.min(3, this.colorsInLevel));
    let last = -1;
    for (let i = 0; i < runs; i++) {
      let col = this.rng.next(this.colorsInLevel);
      if (col === last) col = (col + 1) % this.colorsInLevel;
      last = col;
      const n = 1 + this.rng.next(i === runs - 1 ? 4 : 3);
      for (let k = 0; k < n; k++) s.push(col);
    }
  }

  private Neighbors(c: Cell): Cell[] {
    const dq = [1, 1, 0, -1, -1, 0], dr = [0, -1, -1, 0, 1, 1];
    const out: Cell[] = [];
    for (let i = 0; i < 6; i++) {
      const n = this.byCoord.get(Key(c.Q + dq[i], c.R + dr[i]));
      if (n) out.push(n);
    }
    return out;
  }

  // ------------------------------------------------------------------ tiles (pooled)

  private Take() {
    let sr: SpriteRenderer;
    if (this.tilePool.length > 0) { sr = this.tilePool.pop()!; sr.gameObject.setActive(true); }
    else sr = Art.spr(this.world, "Tile", HexTile(), Color.white, 1, 0, Art.Flat);
    return sr;
  }

  private Release(sr: SpriteRenderer) {
    sr.gameObject.setActive(false);
    this.tilePool.push(sr);
  }

  private SyncCell(c: Cell, _instant: boolean) {
    while (c.Tiles.length < Math.min(c.Stack.length, MaxVisible)) c.Tiles.push(this.Take());
    while (c.Tiles.length > Math.min(c.Stack.length, MaxVisible)) this.Release(c.Tiles.pop()!);
    this.PlaceStack(c.Tiles, c.Stack, c.Pos, this.BaseOrder(c), c.Bump);
    for (let i = Math.max(0, c.Tiles.length - c.Incoming); i < c.Tiles.length; i++) c.Tiles[i].gameObject.setActive(false);
  }

  private BaseOrder(c: Cell) { return 100 + Mathf.roundToInt((10 - c.Pos.y) * 20); }

  private PlaceStack(tiles: SpriteRenderer[], stack: number[], at: V2, order: number, bump: number) {
    const start = Math.max(0, stack.length - tiles.length);
    for (let i = 0; i < tiles.length; i++) {
      const sr = tiles[i];
      const col = stack[start + i];
      sr.color = Colors[col];
      const s = this.hexSize * 2 * (1 + bump * 0.06);
      sr.transform.localScale = new V3(s, s, 1);
      sr.transform.localPosition = new V3(at.x, at.y + i * Lift * this.hexSize, 0);
      sr.sortingOrder = order + i;
      sr.gameObject.setActive(true);
    }
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    const rect = this.PlayRect(TopBand, BottomBand, 0.2);
    const trayH = 2.4;
    const boardRect = Rect.minMaxRect(rect.xMin, rect.yMin + trayH, rect.xMax, rect.yMax);
    let radius = 0;
    for (const c of this.cells) radius = Math.max(radius, Math.max(Math.abs(c.Q), Math.max(Math.abs(c.R), Math.abs(c.Q + c.R))));
    radius = Math.max(1, radius);
    // flat-top: width = (3R+2) * size, height = (2R+1) * sqrt3 * size (+ stack height)
    const sw = boardRect.width / (3 * radius + 2), sh = (boardRect.height - 1.2) / ((2 * radius + 1) * 1.732);
    this.hexSize = Mathf.clamp(Math.min(sw, sh), 0.4, 0.95);
    const center = new V2(boardRect.center.x, boardRect.center.y - 0.3);
    for (const c of this.cells) {
      const x = this.hexSize * 1.5 * c.Q;
      const y = -this.hexSize * 1.732 * (c.R + c.Q * 0.5);
      c.Pos = center.add(new V2(x, y));
      const s = this.hexSize * 2 * 0.95;
      c.Slot.transform.localScale = new V3(s, s, 1);
      c.Slot.transform.localPosition = new V3(c.Pos.x, c.Pos.y - Lift * this.hexSize, 0);
      this.SyncCell(c, true);
    }
    const panel = this.hexSize * (3 * radius + 3.5);
    this.boardPanel.transform.localScale = new V3(panel * 1.2, panel * 1.2, 1);
    this.boardPanel.transform.localPosition = new V3(center.x, center.y, 0);
    for (let i = 0; i < 3; i++) {
      this.offers[i].Home = new V2((i - 1) * Math.min(2.6, rect.width / 3.2), rect.yMin + 0.9);
      if (this.offers[i] !== this.dragging) this.offers[i].Pos = this.offers[i].Home;
      this.PlaceOffer(this.offers[i]);
    }
  }

  private PlaceOffer(o: Offer) {
    while (o.Tiles.length < Math.min(o.Stack.length, MaxVisible)) o.Tiles.push(this.Take());
    while (o.Tiles.length > Math.min(o.Stack.length, MaxVisible)) this.Release(o.Tiles.pop()!);
    const drag = o === this.dragging;
    this.PlaceStack(o.Tiles, o.Stack, o.Pos, drag ? 2000 : 1500, drag ? 1 : 0);
    for (const t of o.Tiles) t.gameObject.setActive(!o.Used);
  }

  private DealOffers() {
    for (let i = 0; i < 3; i++) {
      const o = this.offers[i];
      this.RandomStack(o.Stack);
      o.Used = false;
      o.Pos = o.Home.add(new V2(0, -3));
    }
    this.Layout();
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.level = this.CurrentLevel;
    this.Setup(this.level);
    this.path.refresh(this.Data, this.CurrentLevel);
    this.attractTimer = 1;
  }

  private Setup(lvl: number) {
    this.rng = new SysRandom(lvl * 3301 + 17);
    this.colorsInLevel = Math.min(3 + Math.floor((lvl + 1) / 2), Colors.length);
    this.target = 40 + lvl * 15;
    this.BuildBoard(lvl);
    this.rng = new SysRandom();
    this.DealOffers();
    this.cleared = this.score = this.combo = 0;
    this.resolving = this.ended = this.won = this.hammerMode = false;
    this.dragging = null;
    this.work = [];
  }

  protected BeginRun() {
    this.level = this.CurrentLevel;
    this.Setup(this.level);
    this.revived = false;
    this.pointer.reset();
    this.pointer.topBand = 0.1;
    this.UI.Announce(`LEVEL ${this.level}`, Violet, 1.2);
    if (this.Data.get("runs") === 0) this.UI.Hint("Drag a stack onto the board. Same top colours slide together!");
    this.Data.add("runs", 1);
    Sfx.setIntensity(0.2);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Animate(dt);
    this.Resolve(dt);
    if (this.State !== Phase.Title || this.resolving) return;
    this.attractTimer -= dt;
    if (this.attractTimer > 0) return;
    this.attractTimer = 1.1;
    // attract: place a random offer on the best matching cell
    const o = this.offers.find((x) => !x.Used);
    if (!o) { this.DealOffers(); return; }
    let best: Cell | null = null;
    let bestScore = -1;
    for (const c of this.cells) {
      if (c.Locked || c.Stack.length > 0) continue;
      let sc = 0;
      for (const n of this.Neighbors(c)) if (n.Stack.length > 0 && n.Stack[n.Stack.length - 1] === o.Stack[o.Stack.length - 1]) sc += 2;
      sc += this.rng.next(2);
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    if (!best) { this.Setup(this.level); return; }
    this.Place(o, best);
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    this.Animate(dt);
    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.State === Phase.Playing) { if (this.won) this.Win(); else this.Lose(); }
      return;
    }
    this.Resolve(dt);
    if (!this.resolving) this.Input();
    this.UpdateHud();
  }

  private Input() {
    const w = this.ScreenToWorld(this.pointer.screen);
    if (this.hammerMode) {
      if (this.pointer.tap) {
        const c = this.CellAt(w);
        if (c && c.Stack.length > 0) {
          this.Hammers = this.Hammers - 1;
          this.Smash(c);
          this.hammerMode = false;
          this.UI.Hint(null);
        }
      }
      return;
    }
    if (this.pointer.down && !this.dragging) {
      for (const o of this.offers) {
        if (o.Used) continue;
        if (w.sub(o.Home).magnitude < this.hexSize * 1.6 + 0.3 && w.y < o.Home.y + this.hexSize * 2.5) {
          this.dragging = o;
          this.dragOffset = new V2(0, 1.2);
          Sfx.play(Snd.Click, 0.4);
          this.UI.Hint(null);
          break;
        }
      }
    }
    if (this.dragging) {
      if (this.pointer.held) this.dragging.Pos = V2.lerp(this.dragging.Pos, w.add(this.dragOffset), 0.6);
      if (this.pointer.up) {
        const target = this.CellAt(this.dragging.Pos);
        if (target && !target.Locked && target.Stack.length === 0) this.Place(this.dragging, target);
        this.dragging = null;
        this.Layout();
      } else this.PlaceOffer(this.dragging);
    }
  }

  private CellAt(w: V2) {
    let best: Cell | null = null;
    let bestD = this.hexSize * 1.05;
    for (const c of this.cells) {
      const d = c.Pos.sub(w).magnitude;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  private Place(o: Offer, c: Cell) {
    c.Stack.push(...o.Stack);
    o.Stack.length = 0;
    o.Used = true;
    c.Bump = 1;
    this.SyncCell(c, true);
    this.PlaceOffer(o);
    Sfx.playClip(this.placeClip, 0.8);
    this.combo = 0;
    this.work.push(c);
    this.resolving = true;
    this.stepTimer = 0.12;
    if (this.offers.every((x) => x.Used)) this.DealOffers();
  }

  // ------------------------------------------------------------------ resolving merges

  private Resolve(dt: number) {
    if (!this.resolving) return;
    this.stepTimer -= dt;
    if (this.stepTimer > 0) return;
    if (this.work.length === 0) {
      this.resolving = false;
      this.AfterResolve();
      return;
    }
    const c = this.work.shift()!;
    if (c.Stack.length === 0) { this.stepTimer = 0; return; }
    const top = c.Stack[c.Stack.length - 1];
    // pull matching tops from neighbours
    let moved = 0;
    for (const n of this.Neighbors(c)) {
      if (n.Stack.length === 0 || n.Stack[n.Stack.length - 1] !== top) continue;
      const run = HexaSortGame.TopRun(n.Stack);
      for (let k = 0; k < run; k++) {
        n.Stack.pop();
        c.Stack.push(top);
        this.Fly(top, n.Pos.add(new V2(0, (n.Stack.length + 1) * Lift * this.hexSize)), c.Pos.add(new V2(0, (c.Stack.length - 1) * Lift * this.hexSize)), moved * 0.04, c);
        moved++;
      }
      this.SyncCell(n, true);
      this.work.push(n);
    }
    if (moved > 0) {
      Sfx.playClip(this.slideClip, 0.7, 1 + Math.min(moved, 10) * 0.03);
      c.Bump = 1;
      this.work.push(c);
      this.stepTimer = 0.24 + moved * 0.04;
      this.SyncCell(c, true);
      return;
    }
    // clear a tall single-colour top
    const topRun = HexaSortGame.TopRun(c.Stack);
    if (topRun >= ClearAt) {
      for (let k = 0; k < topRun; k++) c.Stack.pop();
      this.combo++;
      this.cleared += topRun;
      const pts = topRun * 10 * this.combo;
      this.score += pts;
      if (this.State === Phase.Playing) {
        this.Data.add("tiles", topRun);
        this.Data.max("chain", this.combo);
      }
      const at = c.Pos.add(new V2(0, c.Stack.length * Lift * this.hexSize + 0.6));
      this.fx.pop(at, Colors[top], 22, 6, 0.3, 0.6);
      this.fx.sparkle(at, Color.white, 8, 0.8, 0.4);
      this.UI.Float(at, this.combo > 1 ? `+${pts}  x${this.combo}` : "+" + pts, Colors[top], 1.1);
      Sfx.playClip(this.clearClip, 0.9, 1 + Math.min(this.combo, 6) * 0.06);
      Fx.haptic(this.combo > 1);
      if (this.combo >= 3) this.UI.Announce(this.combo >= 5 ? "INCREDIBLE!" : "CHAIN!", Gold, 0.9);
      this.SyncCell(c, true);
      this.work.push(c);
      for (const n of this.Neighbors(c)) this.work.push(n);
      this.stepTimer = 0.25;
      return;
    }
    this.stepTimer = 0;
  }

  private static TopRun(s: number[]) {
    if (s.length === 0) return 0;
    const top = s[s.length - 1];
    let n = 0;
    for (let i = s.length - 1; i >= 0 && s[i] === top; i--) n++;
    return n;
  }

  private Fly(color: number, from: V2, to: V2, delay: number, target: Cell) {
    let f = this.flyers.find((x) => !x.Active);
    if (!f) { f = new Flyer(); f.Sr = Art.spr(this.world, "Flyer", HexTile(), Color.white, 1, 3000, Art.Flat); this.flyers.push(f); }
    f.Active = true;
    f.From = from;
    f.To = to;
    f.T = 0;
    f.Delay = delay;
    f.Dur = 0.18;
    f.Color = color;
    f.Target = target;
    target.Incoming++;
    f.Sr.color = Colors[color];
    f.Sr.gameObject.setActive(false);
  }

  private AfterResolve() {
    if (this.State !== Phase.Playing) return;
    if (this.cleared >= this.target && !this.ended) {
      this.ended = true;
      this.won = true;
      this.endTimer = 1.2;
      this.UI.Announce("LEVEL CLEAR!", Gold, 1.5);
      this.fx.confetti(new V2(0, 1), 70, 9, Colors);
      Sfx.play(Snd.Win);
      return;
    }
    let space = false;
    for (const c of this.cells) if (!c.Locked && c.Stack.length === 0) { space = true; break; }
    if (!space) {
      this.ended = true;
      this.won = false;
      this.endTimer = 0.8;
      this.UI.Announce("BOARD FULL!", Pal.Danger, 1.2);
      Sfx.play(Snd.Lose, 0.8);
    }
  }

  private Smash(c: Cell) {
    for (const col of c.Stack) this.fx.pop(c.Pos, Colors[col], 3, 5, 0.25, 0.5);
    c.Stack.length = 0;
    this.SyncCell(c, true);
    this.Fx.shake(0.25);
    Sfx.play(Snd.Boom, 0.7);
  }

  // ------------------------------------------------------------------ animation

  private Animate(dt: number) {
    for (const c of this.cells) {
      if (c.Bump > 0) {
        c.Bump = Mathf.moveTowards(c.Bump, 0, dt * 5);
        this.SyncCell(c, true);
      }
    }
    for (const f of this.flyers) {
      if (!f.Active) continue;
      if (f.Delay > 0) { f.Delay -= dt; continue; }
      f.Sr.gameObject.setActive(true);
      f.T += dt / f.Dur;
      const k = Mathf.clamp01(f.T);
      const p = V2.lerp(f.From, f.To, Ease.inOutSine(k)).add(new V2(0, Math.sin(k * Math.PI) * 0.7));
      const s = this.hexSize * 2;
      f.Sr.transform.localPosition = new V3(p.x, p.y, 0);
      f.Sr.transform.localScale = new V3(s * (1 - Math.sin(k * Math.PI) * 0.25), s, 1);
      if (f.T >= 1) {
        f.Active = false;
        f.Sr.gameObject.setActive(false);
        if (f.Target) { f.Target.Incoming = Math.max(0, f.Target.Incoming - 1); f.Target.Bump = Math.max(f.Target.Bump, 0.4); this.SyncCell(f.Target, true); }
      }
    }
    for (const o of this.offers) {
      if (o === this.dragging || o.Used) continue;
      if (o.Pos.sub(o.Home).sqrMagnitude > 1e-4) {
        o.Pos = V2.lerp(o.Pos, o.Home, 1 - Math.exp(-dt * 10));
        this.PlaceOffer(o);
      }
    }
  }

  // ------------------------------------------------------------------ boosters & HUD

  private OnHammer() {
    if (this.State !== Phase.Playing || this.ended || this.resolving) return;
    if (this.hammerMode) { this.hammerMode = false; this.UI.Hint(null); return; }
    if (this.Hammers > 0) { this.hammerMode = true; this.UI.Hint("Tap a stack to smash it."); return; }
    CasualUI.useOrEarn(() => this.Hammers, (v) => (this.Hammers = v), this.UI, "+1 HAMMER");
  }

  private OnShuffle() {
    if (this.State !== Phase.Playing || this.ended || this.resolving) return;
    if (CasualUI.useOrEarn(() => this.Shuffles, (v) => (this.Shuffles = v), this.UI, "+1 SHUFFLE")) {
      this.DealOffers();
      Sfx.play(Snd.Whoosh, 0.7);
    }
  }

  private UpdateHud() {
    CasualUI.setText(this.levelText, "LEVEL " + this.level);
    CasualUI.setText(this.scoreText, Fmt.n(this.score));
    CasualUI.setText(this.goalText, `${Math.min(this.cleared, this.target)}/${this.target}`);
    UIKit.setMeter(this.goalFill, this.cleared / Math.max(1, this.target));
    CasualUI.booster(this.hammerButton, "HAMMER", this.Hammers, !this.ended, this.hammerMode ? "CANCEL" : null);
    CasualUI.booster(this.shuffleButton, "SHUFFLE", this.Shuffles, !this.ended);
  }

  // ------------------------------------------------------------------ results

  private Win() {
    let free = 0, open = 0;
    for (const c of this.cells) if (!c.Locked) { open++; if (c.Stack.length === 0) free++; }
    const k = free / Math.max(1, open);
    const stars = k >= 0.5 ? 3 : k >= 0.25 ? 2 : 1;
    const prev = this.Data.get("s" + this.level);
    if (stars > prev) { this.Data.set("s" + this.level, stars); this.Data.add("stars", stars - prev); }
    this.Data.max("best", this.score);
    this.Data.set("level", this.level + 1);
    if (this.level % 4 === 0) { this.Hammers = this.Hammers + 1; this.Shuffles = this.Shuffles + 1; }
    const lvl = this.level;
    this.Finish(new Result({
      Headline: `LEVEL ${lvl} CLEAR!`,
      HeadlineColor: Gold,
      Stars: stars,
      Value: Fmt.n(this.score),
      BestLine: lvl % 4 === 0 ? "GIFT: +1 HAMMER  +1 SHUFFLE" : `NEXT: LEVEL ${lvl + 1}`,
      Stats: [["SCORE", Fmt.n(this.score)], ["TILES", String(this.cleared)], ["FREE SPACES", String(free)], ["STARS", String(this.Data.get("stars"))]],
      Primary: "NEXT LEVEL",
      Victory: true,
      Reward: () => { this.Hammers = this.Hammers + 1; this.UI.Toast("+1 HAMMER", 2); },
      RewardLabel: "GET A FREE HAMMER (WATCH AD)",
    }));
  }

  private Lose() {
    this.Finish(new Result({
      Headline: "BOARD FULL",
      HeadlineColor: Pal.hex(0xffc6d0),
      Value: `${this.cleared}/${this.target}`,
      BestLine: `LEVEL ${this.level} · TILES CLEARED`,
      Stats: [["SCORE", Fmt.n(this.score)], ["LEVEL", String(this.level)], ["TILES", String(this.cleared)], ["STARS", String(this.Data.get("stars"))]],
      Primary: "TRY AGAIN",
      Reward: this.revived ? null : () => this.Continue(),
      RewardLabel: "CLEAR 3 STACKS & CONTINUE (AD)",
    }));
  }

  private Continue() {
    this.revived = true;
    this.ended = false;
    const full = this.cells.filter((c) => c.Stack.length > 0);
    for (let i = 0; i < 3 && full.length > 0; i++) {
      const k = this.rng.next(full.length);
      this.Smash(full[k]);
      full.splice(k, 1);
    }
    this.pointer.reset();
    this.Revive();
    this.UI.Announce("ROOM TO PLAY!", Violet, 1.1);
  }
}
