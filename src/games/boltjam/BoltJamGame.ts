import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Ease, Fmt, Fx, GameInfo,
  GameObject, howTo, Image, Mathf, Pal, Phase, Quaternion, Rect, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom,
  TapPointer, Text, TouchScheme, UIKit, V2, V3,
} from "../../kit";
import { BoltJamArt } from "./BoltJamArt";

/**
 * BOLT JAM: a screw-sorting puzzle. Wooden planks are screwed to a pegboard in overlapping layers; a screw can
 * only come out when no plank above covers it. Each screw flies to the paint tin of its colour at the top (three
 * per tin), or to the holding tray if no tin wants it. A plank held by one screw swings, a plank with none falls.
 * Drop every plank to win; fill the holding tray and the level is lost. Boosters (extra slot, magnet) refill with
 * rewarded ads; a rewarded ad can also add two holding slots once to continue. (Port of BoltJamGame.cs.)
 */

// ------------------------------------------------------------------ tuning

const TopBand = 200, BottomBand = 170;
const BaseSlots = 5, MaxSlots = 8, ActiveBoxes = 2;
const ScrewSize = 0.46;

const Ink = Pal.hex(0x3b2716), Orange = Pal.hex(0xff8a30), Blue = Pal.hex(0x3f8cff), Gold = Pal.hex(0xffb627);

class Plank {
  Root!: GameObject;
  Sr!: SpriteRenderer; Shadow!: SpriteRenderer;
  Layer = 0; LenIndex = 0;
  Length = 0; Rot = 0; AngVel = 0; Wiggle = 0;
  Center = V2.zero; Vel = V2.zero;
  Falling = false; Gone = false;
  readonly Screws: Screw[] = [];
  PivotLocal = V2.zero; // for swinging
}

class Screw {
  Plank!: Plank;
  Local = V2.zero; // along the plank, in plank space
  Color = 0;
  Head: SpriteRenderer | null = null; Thread!: SpriteRenderer;
  Attached = true; Flying = false; InBox = false; InHold = false; Blocked = false;
  Pos = V2.zero; From = V2.zero; To = V2.zero;
  T = 0; Spin = 0;
  Target: Box | null = null;
  Slot = 0;
}

class Box {
  Sr!: SpriteRenderer;
  Color = 0; Filled = 0; Incoming = 0;
  Pos = V2.zero; Home = V2.zero;
  Leave = -1; Enter = 1;
  Active = false;
  readonly Screws: Screw[] = [];
}

export class BoltJamGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject; private boardRoot!: GameObject;
  private bgCover!: SpriteRenderer; private bench!: SpriteRenderer; private holdPanel!: SpriteRenderer;
  private readonly pegTiles: SpriteRenderer[] = [];
  private readonly sockets: SpriteRenderer[] = [];
  private planks: Plank[] = [];
  private screws: Screw[] = [];
  private readonly boxes: Box[] = new Array(ActiveBoxes);
  private readonly hold: (Screw | null)[] = new Array(MaxSlots).fill(null);
  private boxQueue: number[] = [];
  private fx!: CasualFx;
  private readonly pointer = new TapPointer();
  private rng = new SysRandom();

  private board = new Rect();
  private boxY = 0; private holdY = 0; private slotGap = 0;
  private level = 0; private slots = 0; private screwsLeft = 0; private planksLeft = 0; private score = 0; private totalScrews = 0;
  private timer = 0; private endTimer = 0; private attractTimer = 0;
  private ended = false; private won = false; private revived = false;

  // HUD
  private levelText!: Text; private leftText!: Text; private timeText!: Text;
  private slotButton!: ArcadeButton; private magnetButton!: ArcadeButton;
  private readonly mapNodes: Image[] = [];
  private readonly mapLabels: Text[] = [];
  private readonly mapStars: Image[][] = [];
  private readonly mapNow: Text[] = [];

  private unscrewClip!: AudioClip; private clinkClip!: AudioClip; private dropClip!: AudioClip; private denyClip!: AudioClip; private boxClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "boltjam",
      Title: "BOLT JAM",
      Tagline: "UNSCREW. SORT. DROP EVERY PLANK.",
      Accent: Orange,
      Accent2: Blue,
      BgTop: Pal.hex(0xe6c99e),
      BgBottom: Pal.hex(0xd9b98c),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 98, rootHz: 110, degrees: [0, 3, 5, 4], seed: 52, energy: 0.35, major: true },
      Reminders: [
        "The workshop is open|Those planks won't unscrew themselves!",
        "A new puzzle on the pegboard|Sort the screws and drop every plank.",
        "Paint tins are waiting|Fill them with matching screws.",
      ],
      HowTo: [
        howTo(BoltJamArt.Screw, BoltJamArt.Tint[0], "TAP a screw to take it out. A screw covered by a plank on top can't be removed yet."),
        howTo(BoltJamArt.Box, BoltJamArt.Tint[1], "Screws fly to the paint TIN of their colour. A full tin (3 screws) is shipped away."),
        howTo(BoltJamArt.Socket, Color.white, "No matching tin? The screw waits in the HOLDING tray. If it fills up, you lose."),
        howTo(BoltJamArt.Screw, BoltJamArt.Tint[2], "A plank with no screws left falls off. Drop them all to clear the level!"),
        howTo(Art.Star, Gold, "SLOT adds a holding slot for this level. MAGNET fills the first tin from free screws."),
      ],
      Tips: [
        "Look at the next tin colours before you tap.",
        "A swinging plank can uncover the screws beneath it.",
        "Keep the holding tray as empty as you can.",
        "Top planks first: they hide the screws underneath.",
        "Use MAGNET when the holding tray is almost full.",
      ],
    });
  }

  protected get ShortSide() { return Screen.width > Screen.height ? 11 : 9.4; }

  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }
  private get SlotBoosts() { return this.Data.get("slotb", 2); }
  private set SlotBoosts(v: number) { this.Data.set("slotb", Math.max(0, v)); }
  private get Magnets() { return this.Data.get("magnet", 2); }
  private set Magnets(v: number) { this.Data.set("magnet", Math.max(0, v)); }

  protected BestLine() { return `LEVEL ${this.CurrentLevel}   ·   ${this.Data.get("stars")} STARS`; }
  protected StatsLine() { return `${Fmt.n(this.Data.get("screws"))} SCREWS SORTED   ·   ${Fmt.n(this.Data.get("planks"))} PLANKS DROPPED`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("BoltWorld", this.gameObject);
    CasualLook.calm(this, 1.25, 0.2);
    this.bgCover = CasualLook.cover(this.world, CasualArt.gradient(Pal.hex(0x8a5a34), Pal.hex(0x5e3a20)), -920);
    this.bench = Art.spr(this.world, "Bench", BoltJamArt.Bench, Color.white, 1, -880, Art.Flat);
    this.boardRoot = new GameObject("Board", this.world);
    this.holdPanel = Art.spr(this.world, "HoldPanel", Art.Square, new Color(0.2, 0.12, 0.06, 0.45), 1, -850, Art.Flat);
    for (let i = 0; i < MaxSlots; i++) this.sockets.push(Art.spr(this.world, "Socket", BoltJamArt.Socket, Color.white, ScrewSize * 1.35, -840, Art.Flat));
    for (let i = 0; i < ActiveBoxes; i++) {
      const b = new Box();
      b.Sr = Art.spr(this.world, "Box", BoltJamArt.Box, Color.white, 1.9, 400, Art.Flat);
      this.boxes[i] = b;
    }
    this.fx = CasualFx.create(this.world, 700, 200);

    const noise = new SysRandom(9);
    const N = () => noise.nextDouble() * 2 - 1;
    this.unscrewClip = Sfx.make("bj-unscrew", 0.28, (t) => (N() * 0.35 * (0.5 + 0.5 * Math.sin(t * 260)) + Sfx.sinP(Sfx.glide(t, 500, 900, 0.25)) * 0.3) * Sfx.env(t, 0.01, 0.24) * 0.35);
    this.clinkClip = Sfx.make("bj-clink", 0.25, (t) => (Sfx.sinP(2350 * t) * 0.5 + Sfx.sinP(3520 * t) * 0.3 + Sfx.sinP(5100 * t) * 0.15) * Sfx.env(t, 0.001, 0.18) * 0.22);
    this.dropClip = Sfx.make("bj-drop", 0.35, (t) => (Sfx.sinP(Sfx.glide(t, 180, 90, 0.3)) * 0.6 + N() * 0.25 * Sfx.env(t, 0.001, 0.06)) * Sfx.env(t, 0.004, 0.3) * 0.4);
    this.denyClip = Sfx.make("bj-deny", 0.14, (t) => Sfx.triP(Sfx.glide(t, 240, 170, 0.12)) * Sfx.env(t, 0.002, 0.12) * 0.25);
    this.boxClip = Sfx.make("bj-box", 0.4, (t) => (Sfx.sinP(523.25 * t) * Sfx.env(t, 0.004, 0.25) + Sfx.sinP(783.99 * t) * Sfx.env(t - 0.08, 0.004, 0.3)) * 0.2);

    this.BuildHud();
    this.Layout();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    const plate = UIKit.img(hud, "TopPlate", Art.UiRound, new Color(0.25, 0.15, 0.08, 0.85));
    plate.rectTransform.place(new V2(0.5, 1), new V2(-60, -90), new V2(820, 120));
    this.levelText = UIKit.at(UIKit.label(plate.rectTransform, "LEVEL 1", 40, Color.white), new V2(0, 0.5), new V2(150, 0), new V2(260, 60));
    this.timeText = UIKit.at(UIKit.label(plate.rectTransform, "0:00", 40, Gold), UIKit.Center, V2.zero, new V2(200, 60));
    this.leftText = UIKit.at(UIKit.label(plate.rectTransform, "", 30, Color.white.withAlpha(0.85)), new V2(1, 0.5), new V2(-140, 0), new V2(260, 50));

    this.slotButton = UIKit.buttonAt(hud, "SLOT", new V2(0.5, 0), new V2(-200, 85), new V2(340, 110), false, () => this.OnSlot(), 28);
    this.magnetButton = UIKit.buttonAt(hud, "MAGNET", new V2(0.5, 0), new V2(200, 85), new V2(340, 110), false, () => this.OnMagnet(), 28);
    this.slotButton.setAccent(Blue);
    this.magnetButton.setAccent(Orange);

    if (this.UI.TitleExtra) {
      CasualLook.titleCard(this.UI, new Color(0.24, 0.15, 0.08, 0.9));
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * 180;
        if (i < 4) {
          const link = UIKit.img(this.UI.TitleExtra, "Path", Art.UiRound, new Color(1, 1, 1, 0.3));
          link.rectTransform.place(UIKit.Center, new V2(x + 90, 8), new V2(110, 12));
        }
        const node = UIKit.img(this.UI.TitleExtra, "Node", Art.UiCircle, Color.white);
        node.rectTransform.place(UIKit.Center, new V2(x, 8), new V2(80, 80));
        this.mapNodes.push(node);
        this.mapLabels.push(UIKit.at(UIKit.label(node.rectTransform, "1", 34, Ink), UIKit.Center, V2.zero, new V2(80, 80)));
        const st: Image[] = [];
        for (let k = 0; k < 3; k++) {
          st.push(UIKit.img(this.UI.TitleExtra, "Star", Art.Star, Gold));
          st[k].rectTransform.place(UIKit.Center, new V2(x + (k - 1) * 28, -50), new V2(26, 26));
        }
        this.mapStars.push(st);
        this.mapNow.push(UIKit.at(UIKit.label(this.UI.TitleExtra, "", 24, Gold), UIKit.Center, new V2(x, -52), new V2(160, 30)));
      }
    }
  }

  private RefreshMap() {
    const cur = this.CurrentLevel, first = Math.max(1, cur - 2);
    for (let i = 0; i < this.mapNodes.length; i++) {
      const l = first + i;
      const done = l < cur, now = l === cur;
      this.mapLabels[i].text = String(l);
      this.mapNodes[i].color = now ? Orange : done ? Pal.hex(0x4cc86a) : new Color(1, 1, 1, 0.85);
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

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    const rect = this.PlayRect(TopBand, BottomBand, 0.15);
    this.boxY = rect.yMax - 0.7;
    this.holdY = this.boxY - 1.45;
    this.slotGap = Math.min(0.8, (Math.min(rect.width, 8.6) - 0.4) / MaxSlots);
    const bw = Math.min(rect.width, 8.8);
    this.board = Rect.minMaxRect(-bw * 0.5, rect.yMin + 0.2, bw * 0.5, this.holdY - 0.65);

    // pegboard tiles fill the board area
    const tile = 2;
    const cols = Math.ceil(this.ViewSize.x / tile) + 1, rows = Math.ceil(this.ViewSize.y / tile) + 1;
    while (this.pegTiles.length < cols * rows) this.pegTiles.push(Art.spr(this.world, "Peg", BoltJamArt.Pegboard, Color.white, tile + 0.01, -900, Art.Flat));
    for (let i = 0; i < this.pegTiles.length; i++) {
      const on = i < cols * rows;
      this.pegTiles[i].gameObject.setActive(on);
      if (!on) continue;
      const cx = i % cols, cy = Math.floor(i / cols);
      this.pegTiles[i].transform.localPosition = new V3((cx - cols * 0.5 + 0.5) * tile, (cy - rows * 0.5 + 0.5) * tile, 0);
    }
    this.bench.transform.localScale = new V3(this.ViewSize.x + 2, 2.2 / 0.25, 1);
    this.bench.transform.localPosition = new V3(0, this.ViewSize.y * 0.5 - (this.ViewSize.y * 0.5 - this.boxY) - 0.0 + 0.2, 0);
    this.holdPanel.transform.localScale = new V3(this.slotGap * MaxSlots + 0.3, 0.95, 1);
    this.holdPanel.transform.localPosition = new V3(0, this.holdY, 0);
    for (let i = 0; i < MaxSlots; i++) {
      this.sockets[i].transform.localPosition = new V3(this.SlotX(i), this.holdY, 0);
      this.sockets[i].color = i < this.slots ? Color.white : new Color(1, 1, 1, 0.18);
    }
    for (let i = 0; i < ActiveBoxes; i++) this.boxes[i].Home = new V2((i - 0.5) * 2.4, this.boxY);
  }

  private SlotX(i: number) { return (i - (MaxSlots - 1) * 0.5) * this.slotGap; }

  // ------------------------------------------------------------------ levels

  private BuildLevel(lvl: number) {
    for (const p of this.planks) p.Root.destroy();
    for (const s of this.screws) { if (s.Head) s.Head.gameObject.destroy(); }
    this.planks = [];
    this.screws = [];
    this.boxQueue = [];
    for (let i = 0; i < MaxSlots; i++) this.hold[i] = null;
    this.fx.clear();
    this.Layout();
    this.rng = new SysRandom(lvl * 4211 + 3);

    const count = Math.min(3 + lvl, 11);
    const colors = Math.min(2 + Math.floor((lvl + 1) / 2), BoltJamArt.Colors);
    const angles = [0, 90, 30, -30, 45, -45, 60, -60, 15, -15];
    for (let i = 0; i < count; i++) {
      let li = this.rng.next(BoltJamArt.Lengths.length);
      let len = BoltJamArt.Lengths[li];
      let middle = li >= 2 && this.rng.nextDouble() < 0.5;
      const ang = angles[this.rng.next(angles.length)];
      // place inside the board, keeping the holes inside
      let c = V2.zero;
      for (let tries = 0; tries < 30; tries++) {
        const rad = ang * Mathf.Deg2Rad;
        const ex = Math.abs(Math.cos(rad)) * len * 0.5 + 0.5, ey = Math.abs(Math.sin(rad)) * len * 0.5 + 0.5;
        const x0 = this.board.xMin + ex, x1 = this.board.xMax - ex, y0 = this.board.yMin + ey, y1 = this.board.yMax - ey;
        if (x1 < x0 || y1 < y0) { li = 0; len = BoltJamArt.Lengths[0]; middle = false; continue; }
        c = new V2(Mathf.lerp(x0, x1, this.rng.nextDouble()), Mathf.lerp(y0, y1, this.rng.nextDouble()));
        // keep planks clustered towards the middle so they overlap
        c = V2.lerp(c, this.board.center, 0.25);
        break;
      }
      const pl = new Plank();
      pl.Layer = i; pl.LenIndex = li; pl.Length = len; pl.Rot = ang; pl.Center = c;
      pl.Root = new GameObject("Plank", this.boardRoot);
      pl.Shadow = Art.spr(pl.Root, "Shadow", BoltJamArt.Plank(li, middle), new Color(0, 0, 0, 0.22), len, 10 + i * 10 - 1, Art.Flat);
      pl.Shadow.transform.localPosition = new V3(0.08 / len, -0.12 / len, 0);
      pl.Shadow.transform.localScale = V3.one;
      pl.Sr = Art.spr(pl.Root, "Plank", BoltJamArt.Plank(li, middle), BoltJamArt.PlankTint[this.rng.next(BoltJamArt.PlankTint.length)], 1, 10 + i * 10, Art.Flat);
      pl.Root.localScale = new V3(len, len, 1);
      for (const hx of BoltJamArt.Holes(li, middle)) {
        const s = new Screw();
        s.Plank = pl; s.Local = new V2(hx, 0);
        pl.Screws.push(s);
        this.screws.push(s);
      }
      this.planks.push(pl);
    }
    // the number of screws must be a multiple of 3: add extra screws to the longest planks if needed
    while (this.screws.length % 3 !== 0) {
      let pl = this.planks[this.rng.next(this.planks.length)];
      if (pl.Screws.length >= 3) { pl = this.planks[0]; }
      // remove one from a plank with 3 holes, or add a centre screw on a plank with 2
      let three: Plank | null = null;
      for (const p of this.planks) if (p.Screws.length === 3) { three = p; break; }
      if (three) { const s = three.Screws[1]; three.Screws.splice(1, 1); this.screws.splice(this.screws.indexOf(s), 1); }
      else {
        const p = this.planks[this.rng.next(this.planks.length)];
        const s = new Screw();
        s.Plank = p; s.Local = new V2(0, 0);
        p.Screws.push(s);
        this.screws.push(s);
      }
    }
    // colours in triples, shuffled
    const bag: number[] = [];
    for (let t = 0; t < Math.floor(this.screws.length / 3); t++) {
      const col = t % colors;
      bag.push(col, col, col);
      this.boxQueue.push(col);
    }
    this.Shuffle(bag);
    this.Shuffle(this.boxQueue);
    for (let i = 0; i < this.screws.length; i++) {
      const s = this.screws[i];
      s.Color = bag[i];
      s.Head = Art.spr(this.boardRoot, "Screw", BoltJamArt.Screw, BoltJamArt.Tint[s.Color], ScrewSize, 15 + s.Plank.Layer * 10, Art.Flat);
      s.Thread = Art.spr(s.Head.transform, "Thread", BoltJamArt.Thread, Color.white, 0.55, 14 + s.Plank.Layer * 10, Art.Flat);
      s.Thread.transform.localPosition = new V3(0, -0.9, 0);
      s.Thread.gameObject.setActive(false);
    }
    this.totalScrews = this.screws.length;
    this.screwsLeft = this.screws.length;
    this.planksLeft = this.planks.length;
    this.slots = BaseSlots;
    for (let i = 0; i < ActiveBoxes; i++) { this.boxes[i].Active = false; this.boxes[i].Sr.gameObject.setActive(false); this.boxes[i].Screws.length = 0; }
    for (let i = 0; i < ActiveBoxes; i++) this.NextBox(i, true);
    this.Layout();
    this.PlaceAll();
    this.UpdateBlocked();
  }

  private Shuffle(list: number[]) {
    for (let i = list.length - 1; i > 0; i--) { const k = this.rng.next(i + 1); const t = list[i]; list[i] = list[k]; list[k] = t; }
  }

  private NextBox(i: number, instant: boolean) {
    const b = this.boxes[i];
    b.Screws.length = 0;
    b.Filled = b.Incoming = 0;
    b.Leave = -1;
    if (this.boxQueue.length === 0) {
      b.Active = false;
      b.Sr.gameObject.setActive(false);
      return;
    }
    b.Color = this.boxQueue[0];
    this.boxQueue.splice(0, 1);
    b.Active = true;
    b.Enter = instant ? 1 : 0;
    b.Sr.color = BoltJamArt.Tint[b.Color];
    b.Sr.gameObject.setActive(true);
    b.Pos = b.Home.add(new V2(0, 3 * (1 - b.Enter)));
  }

  private BoxSocket(b: Box, i: number) { return b.Pos.add(new V2((i - 1) * 0.58 * 0.95, 0.08 * 0.95)); }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.level = this.CurrentLevel;
    this.BuildLevel(this.level);
    this.ended = false;
    this.attractTimer = 1.2;
    this.RefreshMap();
  }

  protected BeginRun() {
    this.level = this.CurrentLevel;
    this.BuildLevel(this.level);
    this.timer = 0;
    this.score = 0;
    this.ended = this.won = this.revived = false;
    this.pointer.reset();
    this.pointer.topBand = 0.1;
    this.UI.Announce(`LEVEL ${this.level}`, Orange, 1.2);
    if (this.Data.get("runs") === 0) this.UI.Hint("Tap a screw that isn't covered. It flies to the tin of its colour!");
    this.Data.add("runs", 1);
    Sfx.setIntensity(0.2);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Step(dt);
    if (this.State !== Phase.Title) return;
    this.attractTimer -= dt;
    if (this.attractTimer > 0) return;
    this.attractTimer = 0.8;
    if (this.planksLeft === 0 || this.HoldCount() >= this.slots - 1) { this.BuildLevel(this.level); return; }
    let pick: Screw | null = null;
    for (const s of this.screws) {
      if (!s.Attached || s.Blocked) continue;
      if (!pick || this.BoxFor(s)) pick = s;
      if (this.BoxFor(s)) break;
    }
    if (pick) this.Unscrew(pick, false);
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    if (!this.ended) {
      this.timer += dt;
      if (this.pointer.tap) this.TapAt(this.ScreenToWorld(this.pointer.screen));
    }
    this.Step(dt);
    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.State === Phase.Playing) {
        if (this.won) this.Win();
        else this.Lose();
      }
      return;
    }
    this.CheckEnd();
    this.UpdateHud();
  }

  private TapAt(w: V2) {
    let best: Screw | null = null;
    let bestD = 0.42;
    let bestLayer = -1;
    for (const s of this.screws) {
      if (!s.Attached) continue;
      const d = s.Pos.sub(w).magnitude;
      if (d > 0.42) continue;
      if (s.Plank.Layer > bestLayer || (s.Plank.Layer === bestLayer && d < bestD)) { best = s; bestD = d; bestLayer = s.Plank.Layer; }
    }
    if (!best) {
      // tapping a plank wiggles it (a hint that it is screwed down)
      for (const p of this.planks) if (!p.Falling && !p.Gone && this.Covers(p, w)) { p.Wiggle = 1; break; }
      return;
    }
    if (best.Blocked) {
      for (const p of this.planks) if (!p.Falling && !p.Gone && p.Layer > best.Plank.Layer && this.Covers(p, best.Pos)) p.Wiggle = 1;
      Sfx.playClip(this.denyClip, 0.6);
      Fx.haptic();
      return;
    }
    if (!this.BoxFor(best) && this.FreeSlot() < 0) {
      Sfx.playClip(this.denyClip, 0.6);
      return;
    }
    this.Unscrew(best, true);
  }

  private BoxFor(s: Screw): Box | null {
    for (const b of this.boxes)
      if (b.Active && b.Leave < 0 && b.Enter >= 1 && b.Color === s.Color && b.Filled + b.Incoming < 3) return b;
    return null;
  }

  private FreeSlot() {
    for (let i = 0; i < this.slots; i++) if (!this.hold[i]) return i;
    return -1;
  }

  private HoldCount() {
    let n = 0;
    for (let i = 0; i < this.slots; i++) if (this.hold[i]) n++;
    return n;
  }

  private Unscrew(s: Screw, real: boolean) {
    s.Attached = false;
    const idx = s.Plank.Screws.indexOf(s);
    if (idx >= 0) s.Plank.Screws.splice(idx, 1);
    s.From = s.Pos;
    s.T = 0;
    s.Flying = true;
    s.Head!.sortingOrder = 500;
    s.Thread.sortingOrder = 499;
    s.Thread.gameObject.setActive(true);
    const b = this.BoxFor(s);
    if (b) {
      s.Target = b;
      s.Slot = b.Filled + b.Incoming;
      b.Incoming++;
      s.To = this.BoxSocket(b, s.Slot);
    } else {
      const i = this.FreeSlot();
      s.Target = null;
      s.Slot = i;
      this.hold[i] = s;
      s.InHold = true;
      s.To = new V2(this.SlotX(i), this.holdY);
    }
    this.screwsLeft--;
    if (real) { this.score += 10; this.Data.add("screws", 1); }
    Sfx.playClip(this.unscrewClip, real ? 0.8 : 0.3, 0.95 + this.rng.nextDouble() * 0.1);

    const pl = s.Plank;
    if (pl.Screws.length === 1) {
      // starts to swing around the last screw
      pl.AngVel = 0;
    } else if (pl.Screws.length === 0) {
      pl.Falling = true;
      pl.Vel = new V2((this.rng.nextDouble() - 0.5) * 1.5, 0.5);
      pl.AngVel = (this.rng.nextDouble() - 0.5) * 160;
      this.planksLeft--;
      if (real) {
        this.score += 50;
        this.Data.add("planks", 1);
        this.UI.Float(pl.Center, "+50", Orange, 1);
      }
      Sfx.playClip(this.dropClip, real ? 0.7 : 0.25);
    }
    this.UpdateBlocked();
  }

  // ------------------------------------------------------------------ simulation

  private Step(dt: number) {
    // planks: swing on one screw, fall with none
    for (const p of this.planks) {
      if (p.Gone) continue;
      if (p.Falling) {
        p.Vel = p.Vel.withY(p.Vel.y - 18 * dt);
        p.Center = p.Center.add(p.Vel.mul(dt));
        p.Rot += p.AngVel * dt;
        if (p.Center.y < -this.ViewSize.y * 0.5 - 3.5) {
          p.Gone = true;
          p.Root.setActive(false);
        }
      } else if (p.Screws.length === 1) {
        const pivot = p.Screws[0].Pos;
        const r = p.Center.sub(pivot);
        const L = r.magnitude;
        if (L > 0.05) {
          let phi = Math.atan2(r.x, -r.y);
          const acc = -(18 / L) * Math.sin(phi);
          p.AngVel += acc * dt * Mathf.Rad2Deg;
          p.AngVel *= Math.max(0, 1 - 1.4 * dt);
          const dphi = p.AngVel * dt * Mathf.Deg2Rad;
          phi += dphi;
          p.Center = pivot.add(new V2(Math.sin(phi), -Math.cos(phi)).mul(L));
          p.Rot += dphi * Mathf.Rad2Deg;
        }
      }
      p.Wiggle = Mathf.moveTowards(p.Wiggle, 0, dt * 3);
    }

    for (const s of this.screws) {
      if (s.Attached) {
        s.Pos = this.PlankPoint(s.Plank, s.Local);
        continue;
      }
      if (!s.Flying) continue;
      s.T = Math.min(1, s.T + dt / 0.45);
      const rise = Mathf.clamp01(s.T / 0.3);
      const move = Mathf.clamp01((s.T - 0.25) / 0.75);
      const lifted = s.From.add(new V2(0, 0.35 * rise));
      s.Pos = V2.lerp(lifted, s.To, Ease.inOutSine(move)).add(new V2(0, Math.sin(move * Math.PI) * 0.8));
      s.Spin += dt * (s.T < 0.3 ? 1400 : 500);
      if (s.T >= 1) {
        s.Flying = false;
        s.Thread.gameObject.setActive(false);
        Sfx.playClip(this.clinkClip, 0.5, 0.9 + this.rng.nextDouble() * 0.2);
        if (s.Target) this.Arrive(s, s.Target);
      }
    }

    for (const b of this.boxes) {
      if (!b.Active) continue;
      if (b.Enter < 1) {
        b.Enter = Math.min(1, b.Enter + dt * 2.5);
        b.Pos = b.Home.add(new V2(0, 3 * (1 - Ease.outBack(b.Enter))));
        if (b.Enter >= 1) this.PullFromHold(b);
      } else if (b.Leave >= 0) {
        b.Leave += dt;
        const k = Mathf.clamp01(b.Leave / 0.45);
        b.Pos = b.Home.add(new V2((b.Home.x < 0 ? -1 : 1) * 9 * Ease.inQuad(k), 0.5 * Math.sin(k * Math.PI)));
        for (const s of b.Screws) s.Pos = this.BoxSocket(b, b.Screws.indexOf(s));
        if (k >= 1) {
          for (const s of b.Screws) s.Head!.gameObject.setActive(false);
          this.NextBox(this.boxes.indexOf(b), false);
        }
      } else b.Pos = b.Home;
      b.Sr.transform.localPosition = new V3(b.Pos.x, b.Pos.y, 0);
      for (let i = 0; i < b.Screws.length; i++)
        if (!b.Screws[i].Flying) b.Screws[i].Pos = this.BoxSocket(b, i);
    }
    this.PlaceAll();
  }

  private Arrive(s: Screw, b: Box) {
    b.Incoming--;
    b.Filled++;
    b.Screws.push(s);
    s.InBox = true;
    s.InHold = false;
    s.Head!.sortingOrder = 402;
    if (b.Filled >= 3) {
      b.Leave = 0;
      Sfx.playClip(this.boxClip, 0.8);
      this.fx.sparkle(b.Pos, Color.white, 8, 0.8, 0.35);
      this.fx.pop(b.Pos, BoltJamArt.Tint[b.Color], 14, 4, 0.24, 0.45);
      if (this.State === Phase.Playing) { this.score += 30; this.UI.Float(b.Pos.add(new V2(0, -0.6)), "+30", Gold, 0.9); }
      Fx.haptic();
    }
  }

  private PullFromHold(b: Box) {
    for (let i = 0; i < this.slots; i++) {
      const s = this.hold[i];
      if (!s || s.Flying || s.Color !== b.Color || b.Filled + b.Incoming >= 3) continue;
      this.hold[i] = null;
      s.InHold = false;
      s.Target = b;
      s.Slot = b.Filled + b.Incoming;
      b.Incoming++;
      s.From = s.Pos;
      s.To = this.BoxSocket(b, s.Slot);
      s.T = 0.25;
      s.Flying = true;
      s.Head!.sortingOrder = 500;
    }
  }

  private PlankPoint(p: Plank, local: V2) {
    const r = p.Rot * Mathf.Deg2Rad;
    const c = Math.cos(r), s = Math.sin(r);
    return p.Center.add(new V2(local.x * c - local.y * s, local.x * s + local.y * c));
  }

  private Covers(p: Plank, w: V2) {
    const r = -p.Rot * Mathf.Deg2Rad;
    const d = w.sub(p.Center);
    const c = Math.cos(r), s = Math.sin(r);
    const l = new V2(d.x * c - d.y * s, d.x * s + d.y * c);
    return Math.abs(l.x) < p.Length * 0.5 - 0.05 && Math.abs(l.y) < BoltJamArt.Thick * 0.5 - 0.04;
  }

  private UpdateBlocked() {
    for (const s of this.screws) {
      if (!s.Attached) { s.Blocked = false; continue; }
      s.Pos = this.PlankPoint(s.Plank, s.Local);
      let blocked = false;
      for (const p of this.planks) {
        if (p.Falling || p.Gone || p.Layer <= s.Plank.Layer) continue;
        if (this.Covers(p, s.Pos)) { blocked = true; break; }
      }
      s.Blocked = blocked;
    }
  }

  private PlaceAll() {
    let swinging = false;
    for (const p of this.planks) {
      if (p.Gone) continue;
      const wig = Math.sin(p.Wiggle * 28) * p.Wiggle * 3;
      p.Root.localPosition = new V3(p.Center.x, p.Center.y, 0);
      p.Root.localRotation = Quaternion.euler(0, 0, p.Rot + wig);
      if (!p.Falling && p.Screws.length === 1) swinging = true;
    }
    if (swinging) this.UpdateBlocked();
    for (const s of this.screws) {
      if (!s.Head || !s.Head.gameObject.activeSelf) continue;
      s.Head.transform.localPosition = new V3(s.Pos.x, s.Pos.y, 0);
      s.Head.transform.localRotation = Quaternion.euler(0, 0, s.Spin);
      const sc = s.Flying ? ScrewSize * 1.15 : ScrewSize;
      s.Head.transform.localScale = new V3(sc, sc, 1);
    }
  }

  // ------------------------------------------------------------------ end conditions

  private CheckEnd() {
    for (const s of this.screws) if (s.Flying) return;
    for (const b of this.boxes) if (b.Active && (b.Leave >= 0 || b.Enter < 1)) return;
    if (this.planksLeft === 0) {
      this.ended = true;
      this.won = true;
      this.endTimer = 1.0;
      this.UI.Announce("ALL PLANKS DOWN!", Orange, 1.5);
      this.fx.confetti(new V2(0, 0), 70, 9, [BoltJamArt.Tint[0], BoltJamArt.Tint[1], BoltJamArt.Tint[2], BoltJamArt.Tint[3], Color.white]);
      Sfx.play(Snd.Win);
      return;
    }
    if (this.FreeSlot() < 0) {
      // tray full: lost unless some free screw can still go to a tin
      let canMove = false;
      for (const s of this.screws) if (s.Attached && !s.Blocked && this.BoxFor(s)) { canMove = true; break; }
      if (canMove) return;
      this.ended = true;
      this.won = false;
      this.endTimer = 0.7;
      this.UI.Announce("NO ROOM LEFT!", Pal.Danger, 1.2);
      Sfx.play(Snd.Lose, 0.8);
      this.Fx.shake(0.2);
    }
  }

  // ------------------------------------------------------------------ boosters

  private OnSlot() {
    if (this.State !== Phase.Playing || this.ended) return;
    if (this.slots >= MaxSlots) { Sfx.playClip(this.denyClip, 0.5); return; }
    if (this.SlotBoosts > 0) {
      this.SlotBoosts = this.SlotBoosts - 1;
      this.AddSlot();
      return;
    }
    if (!AdService.rewardedAvailable) return;
    AdService.showRewarded((ok) => {
      if (!ok) return;
      this.SlotBoosts = this.SlotBoosts + 1;
      this.UI.Toast("+1 SLOT booster", 2);
    });
  }

  private AddSlot() {
    this.slots = Math.min(MaxSlots, this.slots + 1);
    this.Layout();
    this.fx.sparkle(new V2(this.SlotX(this.slots - 1), this.holdY), Color.white, 6, 0.3, 0.3);
    Sfx.play(Snd.PowerUp, 0.7);
  }

  private OnMagnet() {
    if (this.State !== Phase.Playing || this.ended) return;
    if (this.Magnets > 0) {
      if (this.DoMagnet()) { this.Magnets = this.Magnets - 1; }
      else Sfx.playClip(this.denyClip, 0.5);
      return;
    }
    if (!AdService.rewardedAvailable) return;
    AdService.showRewarded((ok) => {
      if (!ok) return;
      this.Magnets = this.Magnets + 1;
      this.UI.Toast("+1 MAGNET", 2);
    });
  }

  private DoMagnet() {
    // fill the first ready tin with matching screws from the board, even covered ones
    for (const b of this.boxes) {
      if (!b.Active || b.Leave >= 0 || b.Enter < 1) continue;
      const need = 3 - b.Filled - b.Incoming;
      if (need <= 0) continue;
      const cands: Screw[] = [];
      for (const s of this.screws) if (s.Attached && s.Color === b.Color) cands.push(s);
      if (cands.length < need) continue;
      cands.sort((x, y) => y.Plank.Layer - x.Plank.Layer);
      for (let i = 0; i < need; i++) this.Unscrew(cands[i], true);
      this.fx.sparkle(b.Pos, BoltJamArt.Tint[b.Color], 10, 1, 0.4);
      Sfx.play(Snd.Zap, 0.6);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    BoltJamGame.SetText(this.levelText, "LEVEL " + this.level);
    BoltJamGame.SetText(this.timeText, Fmt.clock(this.timer));
    BoltJamGame.SetText(this.leftText, `${this.planksLeft} PLANKS`);
    this.Label(this.slotButton, "SLOT", this.SlotBoosts, this.slots < MaxSlots);
    this.Label(this.magnetButton, "MAGNET", this.Magnets, true);
  }

  private Label(b: ArcadeButton | null, name: string, count: number, usable: boolean) {
    if (!b || !b.label) return;
    BoltJamGame.SetText(b.label, count > 0 ? `${name} ×${count}` : AdService.rewardedAvailable ? `${name} +AD` : name);
    b.interactable = !this.ended && usable && (count > 0 || AdService.rewardedAvailable);
  }

  private static SetText(t: Text | null, s: string) {
    if (t && t.text !== s) t.text = s;
  }

  // ------------------------------------------------------------------ results

  private Win() {
    const par = Math.max(25, this.totalScrews * 2.2);
    const stars = this.timer <= par ? 3 : this.timer <= par * 1.6 ? 2 : 1;
    const prev = this.Data.get("s" + this.level);
    if (stars > prev) {
      this.Data.set("s" + this.level, stars);
      this.Data.add("stars", stars - prev);
    }
    this.Data.max("best", this.score);
    this.Data.set("level", this.level + 1);
    const gift = this.level % 4 === 0;
    if (gift) { this.SlotBoosts = this.SlotBoosts + 1; this.Magnets = this.Magnets + 1; }
    const lvl = this.level;
    this.Finish(new Result({
      Headline: `LEVEL ${lvl} COMPLETE!`,
      HeadlineColor: Gold,
      Stars: stars,
      Value: Fmt.clock(this.timer),
      BestLine: gift ? "GIFT: +1 SLOT  +1 MAGNET" : `NEXT: LEVEL ${lvl + 1}`,
      Stats: [
        ["SCORE", Fmt.n(this.score)],
        ["SCREWS", String(this.totalScrews)],
        ["STAR TIME", Fmt.clock(par)],
        ["STARS", String(this.Data.get("stars"))],
      ],
      Primary: "NEXT LEVEL",
      Victory: true,
      Reward: () => {
        this.Magnets = this.Magnets + 1;
        this.UI.Toast("+1 MAGNET", 2);
        Sfx.play(Snd.PowerUp, 0.8);
      },
      RewardLabel: "GET A FREE MAGNET (WATCH AD)",
    }));
  }

  private Lose() {
    this.Finish(new Result({
      Headline: "JAMMED!",
      HeadlineColor: Pal.hex(0xffc2b0),
      Value: `${this.planksLeft}`,
      BestLine: "PLANKS STILL ON THE BOARD",
      Stats: [
        ["LEVEL", String(this.level)],
        ["SCREWS LEFT", String(this.screwsLeft)],
        ["TIME", Fmt.clock(this.timer)],
        ["STARS", String(this.Data.get("stars"))],
      ],
      Primary: "TRY AGAIN",
      Reward: this.revived || this.slots >= MaxSlots ? null : () => this.Continue(),
      RewardLabel: "+2 HOLDING SLOTS & CONTINUE (AD)",
    }));
  }

  private Continue() {
    this.revived = true;
    this.ended = false;
    this.slots = Math.min(MaxSlots, this.slots + 2);
    this.Layout();
    this.pointer.reset();
    this.Revive();
    this.UI.Announce("+2 SLOTS!", Blue, 1.2);
    Sfx.play(Snd.PowerUp);
  }
}
