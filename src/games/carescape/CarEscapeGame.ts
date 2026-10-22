import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, CasualUI, Color, Ease, Fmt, Fx,
  GameInfo, GameObject, howTo, Keyboard, LevelPath, LineRenderer, Mathf, Pal, Phase, Quaternion, Rect, Result, Screen, Sfx,
  Snd, SpriteRenderer, SysRandom, TapPointer, Text, TouchScheme, UIKit, V2, V3,
} from "../../kit";
import { CarEscapeArt } from "./CarEscapeArt";
import { blockerOf, CarSpec, ConeSpec, generateLevel, hintCar, LevelSpec, Lot } from "./CarEscapeLevels";

/**
 * CAR ESCAPE: a parking-jam puzzle. The lot is packed with cars, vans and trucks; tap a car to drive it forward
 * (swipe along its axis to pick forward or reverse). With a clear lane it drives out onto the road, otherwise it
 * bumps the first car or cone in its way and rolls back, which costs a move. Clear the lot to win; later lots have
 * a move limit. Boosters: UNDO, HINT (pulses the best car to move) and TOW (lifts any car away). Rewarded ads refill
 * boosters, give a free booster after a win and add +5 moves to continue when the moves run out.
 */

// ------------------------------------------------------------------ tuning

const TopBand = 230, BottomBand = 200, SideBand = 360;
const CurbW = 0.18, RoadW = 1.2; // in cells
const ContinueMoves = 5;

const Ink = Pal.hex(0x1f2633), Yellow = Pal.hex(0xffc531), Blue = Pal.hex(0x3d8bff), Green = Pal.hex(0x2ecc71);
const Red = Pal.hex(0xff4757), Gold = Pal.hex(0xffb627);

class Car {
  Spec!: CarSpec;
  Root!: GameObject;
  Body!: SpriteRenderer;
  Shadow!: SpriteRenderer;
  Home = V2.zero; Pos = V2.zero;
  Angle = 0; Heading = 0;
  Gone = false; Exiting = false; Towing = false;
  // exit path: straight along D, quarter turn towards T, then straight off-screen
  D = V2.zero; T = V2.zero; ExitA = 0; ExitR = 0; ExitS = 0; ExitV = 0; ExitT = 0; ExitLen = 0; Reverse = false;
  PuffT = 0;
  // bump
  BumpT = -1; BumpDist = 0; BumpOut = 0; BumpDir = V2.zero; BumpHit = false;
  BumpCar: Car | null = null; BumpCone: Cone | null = null;
  // reactions
  Jolt = 0; JoltDir = V2.zero; Pop = 1; Press = 1; Lift = 0;
}

class Cone {
  Spec!: ConeSpec;
  Sr!: SpriteRenderer;
  Pos = V2.zero;
  Jolt = 0; JoltDir = V2.zero;
}

interface Move { kind: "exit" | "bump" | "tow"; car: Car }

export class CarEscapeGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject;
  private lotRoot!: GameObject;
  private bgCover!: SpriteRenderer;
  private bays: SpriteRenderer[] = [];
  private curbs: SpriteRenderer[] = [];
  private roads: SpriteRenderer[] = [];
  private crossings: SpriteRenderer[] = [];
  private decor: SpriteRenderer[] = [];
  private halo!: SpriteRenderer;
  private arrows: SpriteRenderer[] = [];
  private selectHalo!: SpriteRenderer;
  private cable!: LineRenderer;
  private hook!: SpriteRenderer;
  private cars: Car[] = [];
  private cones: Cone[] = [];
  private history: Move[] = [];
  private fx!: CasualFx;
  private readonly pointer = new TapPointer();
  private spec!: LevelSpec;
  private lot = new Lot(1, 1);

  private cs = 1; private lotCenter = V2.zero;
  private level = 0; private moves = 0; private bumps = 0; private limit = 0; private towed = 0;
  private timer = 0; private endTimer = 0; private attractTimer = 0; private hintT = 0; private clock = 0;
  private ended = false; private won = false; private revived = false; private towMode = false;
  private hinted: Car | null = null; private selected: Car | null = null; private pressed: Car | null = null; private hover: Car | null = null;
  private landscape = false;

  // HUD
  private levelText!: Text; private movesText!: Text; private leftText!: Text;
  private undoButton!: ArcadeButton; private hintButton!: ArcadeButton; private towButton!: ArcadeButton;
  private path!: LevelPath;

  private honkClip!: AudioClip; private vroomClip!: AudioClip; private thudClip!: AudioClip; private beepClip!: AudioClip;
  private towClip!: AudioClip; private coneClip!: AudioClip; private popClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "carescape",
      Title: "CAR ESCAPE",
      Tagline: "TAP. DRIVE. CLEAR THE PARKING JAM!",
      PlayLabel: "PLAY",
      Accent: Yellow,
      Accent2: Pal.hex(0x8fd3ff),
      BgTop: Pal.hex(0x8bd66a),
      BgBottom: Pal.hex(0x6cc35a),
      ShortSide: 9.4,
      Touch: TouchScheme.None,
      Music: { bpm: 104, rootHz: 130.8, degrees: [0, 4, 5, 3], seed: 61, energy: 0.38, major: true },
      Reminders: [
        "The parking lot is jammed|Only you can get those cars out!",
        "Honk honk!|A new parking jam is waiting for you.",
        "Rush hour!|Clear the lot in as few moves as you can.",
      ],
      HowTo: [
        howTo(CarEscapeArt.Car(2, 2, 0), Color.white, "TAP a car to drive it forward. If its lane is clear, it drives out of the lot!"),
        howTo(CarEscapeArt.Car(2, 1, 1), Color.white, "SWIPE along a car to choose forward or reverse."),
        howTo(CarEscapeArt.Cone(0), Color.white, "Blocked? The car bumps into whatever is in the way and rolls back. That costs a move."),
        howTo(CarEscapeArt.Car(3, 3, 0), Color.white, "Clear every car to finish the lot. No bumps = three stars. Later lots have a move limit."),
        howTo(Art.Star, Gold, "UNDO takes back a move, HINT shows the best car to move, TOW lifts any car away."),
      ],
      Tips: [
        "Look along a car's nose: is the lane clear all the way to the road?",
        "Trucks block a lot: free them early.",
        "Cones never move. Plan around them.",
        "A car can also back out: swipe towards its tail.",
        "Out of moves? Watch an ad for +5 moves.",
      ],
    });
  }

  protected get ShortSide() { return Screen.width > Screen.height ? 10.5 : 9.4; }

  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }
  private get Undos() { return this.Data.get("undo", 3); }
  private set Undos(v: number) { this.Data.set("undo", Math.max(0, v)); }
  private get Hints() { return this.Data.get("hint", 3); }
  private set Hints(v: number) { this.Data.set("hint", Math.max(0, v)); }
  private get Tows() { return this.Data.get("tow", 2); }
  private set Tows(v: number) { this.Data.set("tow", Math.max(0, v)); }

  protected BestLine() { return `LEVEL ${this.CurrentLevel}   ·   ${this.Data.get("stars")} STARS`; }
  protected StatsLine() { return `${Fmt.n(this.Data.get("cars"))} CARS ESCAPED   ·   ${this.CurrentLevel - 1} LOTS CLEARED`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("CarWorld", this.gameObject);
    CasualLook.calm(this, 1.3, 0.16);
    this.bgCover = CasualLook.cover(this.world, CarEscapeArt.Grass, -950);
    this.lotRoot = new GameObject("Lot", this.world);
    for (let i = 0; i < 4; i++) this.curbs.push(Art.spr(this.world, "Curb", CarEscapeArt.Curb, Color.white, 1, -905, Art.Flat));
    for (let i = 0; i < 4; i++) this.crossings.push(Art.spr(this.world, "Crossing", CarEscapeArt.Crossing, Color.white, 1, -915, Art.Flat));
    this.halo = Art.spr(this.world, "Halo", CarEscapeArt.Halo, Yellow, 1, 25, Art.Flat);
    this.halo.gameObject.setActive(false);
    this.selectHalo = Art.spr(this.world, "Select", CarEscapeArt.Halo, Color.white, 1, 24, Art.Flat);
    this.selectHalo.gameObject.setActive(false);
    for (let i = 0; i < 3; i++) {
      const a = Art.spr(this.world, "HintArrow", CarEscapeArt.Arrow, Yellow, 0.5, 260, Art.Flat);
      a.gameObject.setActive(false);
      this.arrows.push(a);
    }
    this.cable = Art.line(this.world, "Cable", Pal.hex(0x2b2f38), 0.06, 455, false, true, Art.Flat);
    this.cable.positionCount = 2;
    this.cable.gameObject.setActive(false);
    this.hook = Art.spr(this.world, "Hook", CarEscapeArt.Hook, Pal.hex(0x2b2f38), 0.5, 456, Art.Flat);
    this.hook.gameObject.setActive(false);
    this.fx = CasualFx.create(this.world, 700, 260);

    const noise = new SysRandom(11);
    const N = () => noise.nextDouble() * 2 - 1;
    this.honkClip = Sfx.make("ce-honk", 0.34, (t) => {
      const vib = 1 + 0.01 * Math.sin(t * 38);
      const v = Sfx.sqrP(392 * vib * t) * 0.35 + Sfx.sqrP(494 * vib * t) * 0.3 + Sfx.sinP(784 * t) * 0.15;
      const e = Math.min(1, t / 0.012) * (t < 0.24 ? 1 : Math.max(0, 1 - (t - 0.24) / 0.08));
      return v * e * 0.16;
    });
    let lp = 0;
    this.vroomClip = Sfx.make("ce-vroom", 0.75, (t) => {
      lp += (N() - lp) * 0.08;
      const f = Sfx.glide(t, 55, 150, 0.6);
      return (Sfx.sawP(f) * 0.4 + Sfx.sqrP(f * 0.5) * 0.15 + lp * 0.5) * Sfx.env(t, 0.03, 0.55) * 0.32;
    });
    this.thudClip = Sfx.make("ce-thud", 0.25, (t) => (Sfx.sinP(Sfx.glide(t, 170, 55, 0.2)) * 0.7 + N() * Sfx.env(t, 0.001, 0.03) * 0.5) * Sfx.env(t, 0.002, 0.18) * 0.45);
    this.beepClip = Sfx.make("ce-beep", 0.42, (t) => Sfx.sinP(1150 * t) * (t < 0.12 || (t > 0.24 && t < 0.36) ? 1 : 0) * 0.14);
    this.towClip = Sfx.make("ce-tow", 0.8, (t) => (Sfx.sawP(Sfx.glide(t, 120, 260, 0.7)) * 0.25 + Sfx.sinP(Sfx.glide(t, 400, 1300, 0.7)) * 0.25) * Sfx.env(t, 0.05, 0.7) * 0.3);
    this.coneClip = Sfx.make("ce-cone", 0.16, (t) => Sfx.triP(Sfx.glide(t, 900, 420, 0.12)) * Sfx.env(t, 0.001, 0.1) * 0.3);
    this.popClip = Sfx.make("ce-pop", 0.22, (t) => Sfx.sinP(Sfx.glide(t, 300, 900, 0.15)) * Sfx.env(t, 0.003, 0.15) * 0.3);

    this.BuildHud();
    this.Layout();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    const plate = UIKit.img(hud, "TopPlate", Art.UiRound, new Color(0.12, 0.15, 0.2, 0.88));
    plate.rectTransform.place(new V2(0.5, 1), new V2(-60, -100), new V2(820, 140));
    this.levelText = UIKit.at(UIKit.label(plate.rectTransform, "LEVEL 1", 40, Color.white), new V2(0, 0.5), new V2(150, 0), new V2(260, 60));
    this.movesText = UIKit.at(UIKit.label(plate.rectTransform, "", 46, Yellow), UIKit.Center, V2.zero, new V2(260, 120));
    this.leftText = UIKit.at(UIKit.label(plate.rectTransform, "", 32, Color.white.withAlpha(0.85)), new V2(1, 0.5), new V2(-140, 0), new V2(260, 50));

    this.undoButton = UIKit.buttonAt(hud, "UNDO", new V2(0.5, 0), new V2(-330, 95), new V2(300, 115), false, () => this.OnUndo(), 30);
    this.hintButton = UIKit.buttonAt(hud, "HINT", new V2(0.5, 0), new V2(0, 95), new V2(300, 115), false, () => this.OnHint(), 30);
    this.towButton = UIKit.buttonAt(hud, "TOW", new V2(0.5, 0), new V2(330, 95), new V2(300, 115), false, () => this.OnTow(), 30);
    this.undoButton.setAccent(Blue);
    this.hintButton.setAccent(Yellow);
    this.towButton.setAccent(Pal.hex(0xff8c2e));

    if (this.UI.TitleExtra) CasualLook.titleCard(this.UI, new Color(0.11, 0.14, 0.2, 0.86));
    this.path = new LevelPath(this.UI, Yellow, Green, Ink);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    this.landscape = Screen.width > Screen.height * 1.15;
    this.PlaceButtons();
    const rect = this.landscape ? this.SideRect() : this.PlayRect(TopBand, BottomBand, 0.1);
    const w = this.spec ? this.spec.w : 6, h = this.spec ? this.spec.h : 8;
    const ring = 2 * (CurbW + RoadW);
    // the outer half of the top and bottom roads may run under the HUD bands
    // the outer quarter of the side roads may run off narrow screens
    this.cs = Math.min(1.5, rect.width / (w + ring - (this.landscape ? 0 : RoadW * 0.5)), rect.height / (h + ring - RoadW * 0.9));
    this.lotCenter = new V2(rect.center.x, rect.center.y);
    const cs = this.cs, hx = (w * cs) / 2, hy = (h * cs) / 2, c = this.lotCenter;

    // bays
    while (this.bays.length < w * h) this.bays.push(Art.spr(this.lotRoot, "Bay", CarEscapeArt.Bay, Color.white, 1, -900, Art.Flat));
    for (let i = 0; i < this.bays.length; i++) {
      const on = i < w * h;
      this.bays[i].gameObject.setActive(on);
      if (!on) continue;
      const x = i % w, y = Math.floor(i / w);
      this.bays[i].transform.localPosition = this.CellPos(x, y);
      this.bays[i].transform.localScale = new V3(cs * 1.002, cs * 1.002, 1);
    }
    // curbs
    const cw = CurbW * cs;
    const curbRects = [
      new Rect(c.x - hx - cw, c.y + hy, w * cs + cw * 2, cw), new Rect(c.x - hx - cw, c.y - hy - cw, w * cs + cw * 2, cw),
      new Rect(c.x - hx - cw, c.y - hy, cw, h * cs), new Rect(c.x + hx, c.y - hy, cw, h * cs),
    ];
    for (let i = 0; i < 4; i++) {
      const r = curbRects[i];
      this.curbs[i].transform.localPosition = new V3(r.center.x, r.center.y, 0);
      this.curbs[i].transform.localScale = new V3(r.width, r.height, 1);
    }
    // roads span the whole view
    const rw = RoadW * cs, top = this.RoadLine(1), bottom = this.RoadLine(3), right = this.RoadLine(0), left = this.RoadLine(2);
    const vw = this.ViewSize.x + 4, vh = this.ViewSize.y + 4;
    const nx = Math.ceil(vw / rw) + 1, ny = Math.ceil(vh / rw) + 1;
    const need = 2 * nx + 2 * ny;
    while (this.roads.length < need) this.roads.push(Art.spr(this.world, "Road", CarEscapeArt.Road, Color.white, 1, -920, Art.Flat));
    let k = 0;
    for (const yLine of [top, bottom])
      for (let i = 0; i < nx; i++, k++) {
        const r = this.roads[k];
        r.gameObject.setActive(true);
        r.transform.localPosition = new V3(c.x + (i - nx / 2) * rw, yLine, 0);
        r.transform.localScale = new V3(rw * 1.01, rw, 1);
        r.transform.localRotation = Quaternion.euler(0, 0, 0);
      }
    for (const xLine of [left, right])
      for (let i = 0; i < ny; i++, k++) {
        const r = this.roads[k];
        r.gameObject.setActive(true);
        r.transform.localPosition = new V3(xLine, c.y + (i - ny / 2) * rw, 0);
        r.transform.localScale = new V3(rw * 1.01, rw, 1);
        r.transform.localRotation = Quaternion.euler(0, 0, 90);
        r.sortingOrder = -919;
      }
    for (; k < this.roads.length; k++) this.roads[k].gameObject.setActive(false);
    const corners = [new V2(left, top), new V2(right, top), new V2(left, bottom), new V2(right, bottom)];
    for (let i = 0; i < 4; i++) {
      this.crossings[i].transform.localPosition = new V3(corners[i].x, corners[i].y, 0);
      this.crossings[i].transform.localScale = new V3(rw, rw, 1);
    }
    this.LayoutDecor(left, right, top, bottom, rw);

    for (const car of this.cars) {
      car.Home = this.CarCenter(car.Spec);
      if (!car.Exiting && !car.Towing) car.Pos = car.Home;
    }
    for (const cone of this.cones) cone.Pos = this.CellPos(cone.Spec.x, cone.Spec.y);
    this.PlaceAll();
  }

  /** Landscape: the boosters stand on the right, so the lot gets the full height. */
  private SideRect() {
    const r = this.PlayRect(TopBand - 40, 30, 0.1);
    const unitsPerUi = Math.min(this.ViewSize.x, this.ViewSize.y) / 1080;
    const side = SideBand * unitsPerUi;
    return Rect.minMaxRect(r.xMin + side, r.yMin, r.xMax - side, r.yMax);
  }

  private PlaceButtons() {
    const bs = [this.undoButton, this.hintButton, this.towButton];
    for (let i = 0; i < 3; i++) {
      const size = new V2(300, 115);
      if (this.landscape) bs[i].node.place(new V2(1, 0.5), new V2(-200, 150 - i * 150), size);
      else bs[i].node.place(new V2(0.5, 0), new V2((i - 1) * 330, 95), size);
    }
  }

  /** World coordinate of a road's centre line: 0 right, 1 top, 2 left, 3 bottom. */
  private RoadLine(side: number) {
    const w = this.spec ? this.spec.w : 6, h = this.spec ? this.spec.h : 8;
    const off = (CurbW + RoadW * 0.5) * this.cs;
    switch (side) {
      case 0: return this.lotCenter.x + (w * this.cs) / 2 + off;
      case 1: return this.lotCenter.y + (h * this.cs) / 2 + off;
      case 2: return this.lotCenter.x - (w * this.cs) / 2 - off;
      default: return this.lotCenter.y - (h * this.cs) / 2 - off;
    }
  }

  private LayoutDecor(left: number, right: number, top: number, bottom: number, rw: number) {
    const rng = new SysRandom(77);
    const step = 1.25 * Math.max(0.8, this.cs);
    const vx = this.ViewSize.x * 0.5 + 1, vy = this.ViewSize.y * 0.5 + 1;
    let n = 0;
    for (let y = -vy; y <= vy; y += step)
      for (let x = -vx; x <= vx; x += step) {
        const p = new V2(x + (rng.nextDouble() - 0.5) * step * 0.8, y + (rng.nextDouble() - 0.5) * step * 0.8);
        const kind = rng.next(5);
        const size = (kind < 3 ? 1.1 + rng.nextDouble() * 0.5 : 0.55 + rng.nextDouble() * 0.2) * Math.max(0.75, this.cs);
        const pad = rw * 0.5 + size * 0.42;
        if (Math.abs(p.x - left) < pad || Math.abs(p.x - right) < pad || Math.abs(p.y - top) < pad || Math.abs(p.y - bottom) < pad) continue;
        if (p.x > left && p.x < right && p.y > bottom && p.y < top) continue;
        if (rng.nextDouble() < 0.35) continue;
        if (n >= this.decor.length) this.decor.push(Art.spr(this.world, "Decor", CarEscapeArt.Bush, Color.white, 1, -890, Art.Flat));
        const d = this.decor[n++];
        d.sprite = kind < 3 ? CarEscapeArt.Tree(kind) : CarEscapeArt.Bush;
        d.sortingOrder = kind < 3 ? -880 : -885;
        d.gameObject.setActive(true);
        d.transform.localPosition = new V3(p.x, p.y, 0);
        d.transform.localScale = new V3(size, size, 1);
        d.transform.localRotation = Quaternion.euler(0, 0, rng.next(360));
      }
    for (; n < this.decor.length; n++) this.decor[n].gameObject.setActive(false);
  }

  private CellPos(x: number, y: number) {
    const w = this.spec ? this.spec.w : 6, h = this.spec ? this.spec.h : 8;
    return new V2(this.lotCenter.x + (x + 0.5 - w / 2) * this.cs, this.lotCenter.y + (y + 0.5 - h / 2) * this.cs);
  }

  private CarCenter(s: CarSpec) {
    const a = this.CellPos(s.x, s.y);
    const k = (s.len - 1) * 0.5 * this.cs;
    return s.horiz ? a.add(new V2(k, 0)) : a.add(new V2(0, k));
  }

  private CellAt(w: V2): [number, number] {
    const s = this.spec;
    const fx = (w.x - this.lotCenter.x) / this.cs + s.w / 2, fy = (w.y - this.lotCenter.y) / this.cs + s.h / 2;
    return [Math.floor(fx), Math.floor(fy)];
  }

  // ------------------------------------------------------------------ levels

  private BuildLevel(n: number) {
    for (const c of this.cars) { c.Root.destroy(); c.Shadow.gameObject.destroy(); }
    for (const c of this.cones) c.Sr.gameObject.destroy();
    this.cars = [];
    this.cones = [];
    this.history = [];
    this.fx.clear();
    this.hinted = this.selected = this.pressed = this.hover = null;
    this.towMode = false;
    this.cable.gameObject.setActive(false);
    this.hook.gameObject.setActive(false);
    this.spec = generateLevel(n);
    this.lot = new Lot(this.spec.w, this.spec.h);
    for (const cs of this.spec.cones) {
      this.lot.set(cs.x, cs.y, -2);
      const cone = new Cone();
      cone.Spec = cs;
      cone.Sr = Art.spr(this.lotRoot, "Cone", CarEscapeArt.Cone(cs.kind), Color.white, 1, 35, Art.Flat);
      this.cones.push(cone);
    }
    for (const s of this.spec.cars) {
      this.lot.put(s);
      const car = new Car();
      car.Spec = s;
      car.Root = new GameObject("Car", this.lotRoot);
      car.Shadow = Art.spr(this.lotRoot, "Shadow", CarEscapeArt.Shadow(s.len), Color.white, 1, 30, Art.Flat);
      car.Body = Art.spr(car.Root, "Body", CarEscapeArt.Car(s.len, s.color, s.style), Color.white, s.len, 40, Art.Flat);
      car.Angle = car.Heading = s.horiz ? (s.dir > 0 ? 0 : 180) : (s.dir > 0 ? 90 : -90);
      car.Pop = 0;
      car.PuffT = -((s.x + s.y) * 0.03); // staggered drop-in
      this.cars.push(car);
    }
    this.limit = this.spec.limit;
    this.Layout();
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.level = this.CurrentLevel;
    this.BuildLevel(this.level);
    this.ended = false;
    this.attractTimer = 1.4;
    this.path.refresh(this.Data, this.level);
  }

  protected BeginRun() {
    this.level = this.CurrentLevel;
    this.BuildLevel(this.level);
    this.moves = this.bumps = this.towed = 0;
    this.timer = 0;
    this.ended = this.won = this.revived = false;
    this.pointer.reset();
    this.pointer.topBand = 0.1;
    this.UI.Announce(`LEVEL ${this.level}`, Yellow, 1.2);
    if (this.Data.get("runs") === 0) this.UI.Hint("Tap a car whose lane is clear to drive it out of the lot!");
    else if (this.limit > 0 && this.Data.get("limitSeen") === 0) {
      this.Data.set("limitSeen", 1);
      this.UI.Hint(`Move limit: ${this.limit} moves. Every bump costs one!`);
    }
    this.Data.add("runs", 1);
    Sfx.setIntensity(0.2);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Animate(dt);
    if (this.State !== Phase.Title) return;
    this.attractTimer -= dt;
    if (this.attractTimer > 0) return;
    this.attractTimer = 0.75;
    const left = this.cars.filter((c) => !c.Gone && !c.Exiting && !c.Towing);
    if (left.length === 0) { this.BuildLevel(this.level); this.attractTimer = 1.4; return; }
    const pick = hintCar(this.lot, left.map((c) => c.Spec));
    if (pick) this.Drive(this.cars[pick.id], pick.dir, false);
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
      this.UpdateHud();
      return;
    }
    this.timer += dt;
    this.HandlePointer();
    this.HandleKeys();
    this.CheckEnd();
    this.UpdateHud();
  }

  private HandlePointer() {
    const p = this.pointer;
    if (p.down) {
      this.pressed = this.CarAt(this.ScreenToWorld(p.startScreen));
    }
    if (!p.held && !p.up) this.pressed = null;
    // hover lift for mice
    this.hover = !p.usingTouch && !p.held ? this.CarAt(this.ScreenToWorld(p.screen)) : null;
    if (!p.up) return;
    const start = this.ScreenToWorld(p.startScreen);
    const car = this.CarAt(start);
    this.pressed = null;
    if (!car) {
      const cone = this.ConeAt(start);
      if (cone && p.tap) { cone.Jolt = 1; cone.JoltDir = V2.up; Sfx.playClip(this.coneClip, 0.5); }
      return;
    }
    this.selected = null;
    if (this.towMode) {
      if (p.tap) this.TowCar(car);
      return;
    }
    if (p.tap) { this.Drive(car, car.Spec.dir, true); return; }
    const delta = this.ScreenToWorld(p.screen).sub(start);
    const along = car.Spec.horiz ? delta.x : delta.y, across = car.Spec.horiz ? delta.y : delta.x;
    if (Math.abs(along) >= Math.abs(across) * 0.7) this.Drive(car, along > 0 ? 1 : -1, true);
    else { car.Jolt = 0.6; car.JoltDir = car.Spec.horiz ? V2.up : V2.right; }
  }

  private HandleKeys() {
    const live = this.cars.filter((c) => this.IsParked(c));
    if (live.length === 0) return;
    const dirs: [boolean, V2][] = [
      [Keyboard.left.wasPressedThisFrame || Keyboard.letter("a").wasPressedThisFrame, V2.left],
      [Keyboard.right.wasPressedThisFrame || Keyboard.letter("d").wasPressedThisFrame, V2.right],
      [Keyboard.up.wasPressedThisFrame || Keyboard.letter("w").wasPressedThisFrame, V2.up],
      [Keyboard.down.wasPressedThisFrame || Keyboard.letter("s").wasPressedThisFrame, V2.down],
    ];
    for (const [pressed, d] of dirs) {
      if (!pressed) continue;
      if (!this.selected || !this.IsParked(this.selected)) { this.selected = this.Nearest(live, this.lotCenter, null); continue; }
      const from = this.selected.Home;
      let best: Car | null = null, bestScore = 1e9;
      for (const c of live) {
        if (c === this.selected) continue;
        const v = c.Home.sub(from);
        const along = V2.dot(v, d);
        if (along < this.cs * 0.3) continue;
        const score = along + Math.abs(V2.dot(v, new V2(-d.y, d.x))) * 2;
        if (score < bestScore) { bestScore = score; best = c; }
      }
      if (best) { this.selected = best; Sfx.play(Snd.Tick, 0.4); }
    }
    if (this.selected && !this.IsParked(this.selected)) this.selected = null;
    const go = Keyboard.space.wasPressedThisFrame || Keyboard.enter.wasPressedThisFrame;
    const back = Keyboard.letter("r").wasPressedThisFrame;
    if ((go || back) && !this.selected) { this.selected = this.Nearest(live, this.lotCenter, null); return; }
    if (this.selected && (go || back)) {
      const c = this.selected;
      if (this.towMode) this.TowCar(c);
      else this.Drive(c, (back ? -c.Spec.dir : c.Spec.dir) as 1 | -1, true);
    }
    if (Keyboard.letter("z").wasPressedThisFrame || Keyboard.backspace.wasPressedThisFrame) this.OnUndo();
    if (Keyboard.letter("h").wasPressedThisFrame) this.OnHint();
    if (Keyboard.letter("t").wasPressedThisFrame) this.OnTow();
  }

  private Nearest(list: Car[], p: V2, skip: Car | null) {
    let best: Car | null = null, bd = 1e9;
    for (const c of list) { if (c === skip) continue; const d = c.Home.sub(p).magnitude; if (d < bd) { bd = d; best = c; } }
    return best;
  }

  private IsParked(c: Car) { return !c.Gone && !c.Exiting && !c.Towing; }

  private CarAt(w: V2): Car | null {
    if (!this.spec) return null;
    const [x, y] = this.CellAt(w);
    if (this.lot.inside(x, y)) {
      const v = this.lot.at(x, y);
      if (v >= 0 && this.IsParked(this.cars[v])) return this.cars[v];
    }
    // forgiving taps: nearest car within half a cell of its body
    let best: Car | null = null, bd = 1e9;
    for (const c of this.cars) {
      if (!this.IsParked(c)) continue;
      const l = c.Spec.len * 0.5 * this.cs, d = c.Home.sub(w);
      const ex = Math.max(0, Math.abs(d.x) - (c.Spec.horiz ? l : this.cs * 0.4)), ey = Math.max(0, Math.abs(d.y) - (c.Spec.horiz ? this.cs * 0.4 : l));
      const dist = Math.hypot(ex, ey);
      if (dist < this.cs * 0.3 && dist < bd) { bd = dist; best = c; }
    }
    return best;
  }

  private ConeAt(w: V2): Cone | null {
    for (const c of this.cones) if (c.Pos.sub(w).magnitude < this.cs * 0.5) return c;
    return null;
  }

  // ------------------------------------------------------------------ moves

  private Busy(c: Car) { return !this.IsParked(c) || c.BumpT >= 0; }

  /** Drives a car along its axis (d = +1 / -1 in grid terms). Exits when the lane is clear, bumps otherwise. */
  private Drive(car: Car, d: 1 | -1, real: boolean) {
    if (this.Busy(car)) return;
    if (this.hinted === car || real) this.hinted = null;
    const s = car.Spec;
    const b = blockerOf(this.lot, s, d);
    const axis = s.horiz ? new V2(d, 0) : new V2(0, d);
    if (real) { this.moves++; if (this.moves === 1) this.UI.Hint(null); }
    if (!b) {
      this.lot.take(s);
      this.StartExit(car, axis, d !== s.dir);
      if (real) {
        this.history.push({ kind: "exit", car });
        this.Data.add("cars", 1);
      }
      Sfx.playClip(this.vroomClip, real ? 0.7 : 0.25, 0.9 + Math.random() * 0.25);
      if (d !== s.dir) Sfx.playClip(this.beepClip, real ? 0.6 : 0.2);
      return;
    }
    if (real) { this.bumps++; this.history.push({ kind: "bump", car }); }
    car.BumpT = 0;
    car.BumpHit = false;
    car.BumpDir = axis;
    car.BumpDist = (b.gap + 0.12) * this.cs;
    car.BumpOut = 0.07 + b.gap * 0.045;
    car.BumpCar = b.value >= 0 ? this.cars[b.value] : null;
    car.BumpCone = b.value < 0 ? this.cones.find((c) => c.Spec.x === b.x && c.Spec.y === b.y) ?? null : null;
    Sfx.playClip(this.vroomClip, real ? 0.25 : 0.1, 1.3);
  }

  private StartExit(car: Car, D: V2, reverse: boolean) {
    car.Exiting = true;
    car.Reverse = reverse;
    car.D = D;
    car.ExitS = car.ExitV = car.ExitT = 0;
    car.PuffT = 0;
    // turn towards the side of the lot the car is on (shorter way off-screen)
    const P0 = car.Home, rel = P0.sub(this.lotCenter);
    const perp = new V2(-D.y, D.x);
    let side = V2.dot(rel, perp);
    if (Math.abs(side) < 1e-3) side = car.Spec.id % 2 === 0 ? 1 : -1;
    const T = side > 0 ? perp : perp.neg();
    car.T = T;
    // lane: right-hand traffic on the road beyond this edge
    const roadSide = D.x > 0.5 ? 0 : D.y > 0.5 ? 1 : D.x < -0.5 ? 2 : 3;
    const roadC = this.RoadLine(roadSide);
    const right = new V2(T.y, -T.x);
    const laneOff = RoadW * this.cs * 0.23 * V2.dot(right, D);
    const roadAlong = (roadSide === 0 || roadSide === 2 ? roadC - this.lotCenter.x : roadC - this.lotCenter.y) * (roadSide < 2 ? 1 : -1);
    const L = roadAlong + laneOff;
    const d0 = V2.dot(rel, D);
    car.ExitR = this.cs * 0.55;
    car.ExitA = Math.max(0, L - car.ExitR - d0);
    car.ExitLen = car.ExitA + car.ExitR * Math.PI * 0.5 + this.ViewSize.magnitude + 4;
    car.Body.sortingOrder = 300;
    car.Shadow.sortingOrder = 290;
    // exhaust puff from the tail
    const tail = car.Home.sub(this.Facing(car).mul(car.Spec.len * 0.5 * this.cs));
    for (let i = 0; i < 4; i++) this.fx.emit(tail, this.Facing(car).mul(-1.2 * this.cs).add(Random2(0.6 * this.cs)), new Color(0.92, 0.94, 0.97, 0.75), 0.42 * this.cs, 0.55, CasualArt.Soft, 0, 0, true, 2.5);
  }

  private Facing(car: Car) { return V2.fromAngle(car.Angle * Mathf.Deg2Rad); }

  private ExitPose(car: Car, s: number): [V2, number] {
    const a = car.ExitA, r = car.ExitR, D = car.D, T = car.T;
    const angD = Math.atan2(D.y, D.x) * Mathf.Rad2Deg, angT = Math.atan2(T.y, T.x) * Mathf.Rad2Deg;
    const startHeading = car.Reverse ? angD + 180 : angD;
    if (s <= a) return [car.Home.add(D.mul(s)), startHeading];
    const arc = r * Math.PI * 0.5;
    if (s <= a + arc) {
      const th = (s - a) / r;
      if (!car.Reverse) {
        const p = car.Home.add(D.mul(a + r * Math.sin(th))).add(T.mul(r * (1 - Math.cos(th))));
        return [p, angD + Mathf.deltaAngle(angD, angT) * (th / (Math.PI * 0.5))];
      }
      // reversing: back up to the lane, swing the nose round, then drive off forwards
      const k = th / (Math.PI * 0.5);
      const p = car.Home.add(D.mul(a + r * Math.sin(th))).add(T.mul(r * (1 - Math.cos(th)) * 0.6));
      return [p, startHeading + Mathf.deltaAngle(startHeading, angT) * Ease.inOutSine(k)];
    }
    const base = car.Home.add(D.mul(a + r)).add(T.mul(car.Reverse ? r * 0.6 : r));
    return [base.add(T.mul(s - a - arc)), angT];
  }

  private TowCar(car: Car) {
    if (this.Busy(car)) return;
    if (this.Tows <= 0) { this.towMode = false; return; }
    this.Tows = this.Tows - 1;
    this.towMode = false;
    this.UI.Hint(null);
    this.lot.take(car.Spec);
    car.Towing = true;
    car.ExitT = 0;
    car.Body.sortingOrder = 450;
    car.Shadow.sortingOrder = 440;
    this.towed++;
    this.history.push({ kind: "tow", car });
    if (this.hinted === car) this.hinted = null;
    Sfx.playClip(this.towClip, 0.8);
    this.fx.sparkle(car.Home, Yellow, 10, this.cs * 0.8, 0.3 * this.cs);
  }

  // ------------------------------------------------------------------ animation

  private Animate(dt: number) {
    this.clock += dt;
    const cs = this.cs;
    let towing: Car | null = null;
    for (const car of this.cars) {
      if (car.Gone) continue;
      car.Pop = Math.min(1, car.Pop + dt * 3.2 * (car.PuffT < 0 ? 0 : 1));
      if (car.PuffT < 0) car.PuffT += dt;
      car.Jolt = Math.max(0, car.Jolt - dt * 2.4);
      const pressTarget = this.pressed === car ? 0.95 : this.hover === car ? 1.04 : 1;
      car.Press = Mathf.lerp(car.Press, pressTarget, 1 - Math.exp(-dt * 18));
      let pos = car.Home, heading = car.Angle;
      if (car.Exiting) {
        car.ExitT += dt;
        car.ExitV = Math.min(16 * cs, car.ExitV + 42 * cs * dt);
        car.ExitS += car.ExitV * dt;
        [pos, heading] = this.ExitPose(car, car.ExitS);
        car.PuffT -= dt;
        if (car.PuffT <= 0 && car.ExitS < car.ExitA + 3 * cs) {
          car.PuffT = 0.07;
          const tail = pos.sub(V2.fromAngle(heading * Mathf.Deg2Rad, car.Spec.len * 0.5 * cs));
          this.fx.emit(tail, Random2(0.5 * cs), new Color(0.9, 0.92, 0.95, 0.55), 0.3 * cs, 0.45, CasualArt.Soft, 0, 0, true, 3);
        }
        if (car.ExitS >= car.ExitLen) { car.Gone = true; car.Exiting = false; car.Root.setActive(false); car.Shadow.gameObject.setActive(false); continue; }
      } else if (car.Towing) {
        car.ExitT += dt;
        towing = car;
        const t = car.ExitT;
        const lift = Ease.outCubic(Mathf.clamp01(t / 0.35));
        car.Lift = lift;
        const fly = Mathf.clamp01((t - 0.45) / 0.6);
        pos = car.Home.add(new V2(Math.sin(t * 7) * 0.05 * cs * (1 - fly), Ease.inQuad(fly) * (this.ViewSize.y + 4)));
        heading = car.Angle + Math.sin(t * 6) * 6 * lift;
        if (fly >= 1) { car.Gone = true; car.Towing = false; car.Lift = 0; car.Root.setActive(false); car.Shadow.gameObject.setActive(false); continue; }
      } else if (car.BumpT >= 0) {
        car.BumpT += dt;
        let off: number;
        if (car.BumpT < car.BumpOut) off = car.BumpDist * Ease.inQuad(car.BumpT / car.BumpOut);
        else {
          if (!car.BumpHit) this.BumpHit(car);
          const k = Mathf.clamp01((car.BumpT - car.BumpOut) / 0.3);
          off = car.BumpDist * (1 - Ease.outCubic(k)) - Math.sin(k * Math.PI) * 0.05 * cs;
          if (k >= 1) car.BumpT = -1;
        }
        pos = pos.add(car.BumpDir.mul(off));
      }
      if (car.Jolt > 0) {
        const j = car.Jolt;
        pos = pos.add(car.JoltDir.mul(Math.sin((1 - j) * Math.PI * 4) * 0.09 * cs * j));
        heading += Math.sin((1 - j) * 26) * 5 * j;
      }
      car.Pos = pos;
      car.Heading = heading;
    }
    for (const cone of this.cones) cone.Jolt = Math.max(0, cone.Jolt - dt * 2.2);

    // tow cable
    this.cable.gameObject.setActive(!!towing);
    this.hook.gameObject.setActive(!!towing);
    if (towing) {
      const topY = this.ViewSize.y * 0.5 + 1;
      const fromTop = Mathf.clamp01(towing.ExitT / 0.25);
      const end = towing.Pos.add(new V2(0, 0.05 * cs));
      const hookPos = V2.lerp(new V2(end.x, topY), end, fromTop);
      this.cable.setPosition(0, new V2(end.x, topY));
      this.cable.setPosition(1, hookPos);
      this.cable.widthMultiplier = 0.09 * cs;
      this.hook.transform.localPosition = new V3(hookPos.x, hookPos.y - 0.15 * cs, 0);
      this.hook.transform.localScale = new V3(0.5 * cs, 0.5 * cs, 1);
    }

    // hint highlight
    if (this.hinted && !this.IsParked(this.hinted)) this.hinted = null;
    this.hintT += dt;
    this.halo.gameObject.setActive(!!this.hinted);
    for (const a of this.arrows) a.gameObject.setActive(!!this.hinted);
    if (this.hinted) {
      const c = this.hinted, pulse = 0.5 + 0.5 * Math.sin(this.hintT * 7);
      this.PlaceHalo(this.halo, c, 1.08 + pulse * 0.08);
      this.halo.color = Yellow.withAlpha(0.65 + 0.35 * pulse);
      const f = this.Facing(c);
      for (let i = 0; i < this.arrows.length; i++) {
        const k = ((this.hintT * 1.6 + i / this.arrows.length) % 1);
        const p = c.Home.add(f.mul((c.Spec.len * 0.5 + 0.35 + k * 1.3) * cs));
        this.arrows[i].transform.localPosition = new V3(p.x, p.y, 0);
        this.arrows[i].transform.localRotation = Quaternion.euler(0, 0, c.Angle);
        this.arrows[i].transform.localScale = new V3(0.5 * cs, 0.5 * cs, 1);
        this.arrows[i].color = Yellow.withAlpha(Math.sin(k * Math.PI) * 0.95);
      }
    }
    const sel = this.selected && this.IsParked(this.selected) && this.State === Phase.Playing ? this.selected : null;
    this.selectHalo.gameObject.setActive(!!sel);
    if (sel) {
      this.PlaceHalo(this.selectHalo, sel, 1.1);
      this.selectHalo.color = (this.towMode ? Pal.hex(0xff8c2e) : Color.white).withAlpha(0.7 + 0.3 * Math.sin(this.clock * 6));
    }
    this.PlaceAll();
  }

  private PlaceHalo(sr: SpriteRenderer, c: Car, k: number) {
    sr.transform.localPosition = new V3(c.Home.x, c.Home.y, 0);
    sr.transform.localRotation = Quaternion.euler(0, 0, c.Spec.horiz ? 0 : 90);
    // the halo sprite is 2:1 (one unit wide, half a unit tall): stretch it to the car
    sr.transform.localScale = new V3((c.Spec.len + 0.22) * this.cs * k, 2 * this.cs * 1.02 * k, 1);
  }

  private BumpHit(car: Car) {
    car.BumpHit = true;
    const front = car.Home.add(car.BumpDir.mul(car.BumpDist + car.Spec.len * 0.5 * this.cs - 0.05 * this.cs));
    if (car.BumpCar) {
      const o = car.BumpCar;
      o.Jolt = 1;
      o.JoltDir = car.BumpDir;
      Sfx.playClip(this.honkClip, 0.7, 0.85 + (o.Spec.id % 5) * 0.08);
    } else if (car.BumpCone) {
      car.BumpCone.Jolt = 1;
      car.BumpCone.JoltDir = car.BumpDir;
      Sfx.playClip(this.coneClip, 0.7);
    }
    car.Jolt = 0.5;
    car.JoltDir = car.BumpDir.neg();
    Sfx.playClip(this.thudClip, 0.8);
    this.fx.pop(front, Color.white, 8, 3 * this.cs, 0.14 * this.cs, 0.3);
    this.fx.sparkle(front, Yellow, 3, 0.2 * this.cs, 0.22 * this.cs);
    if (this.State === Phase.Playing) {
      this.Fx.shake(0.14);
      Fx.haptic();
      this.UI.Float(front, "BUMP!", Red, 0.7);
    }
  }

  private PlaceAll() {
    const cs = this.cs;
    for (const car of this.cars) {
      if (car.Gone) continue;
      const pop = car.Pop >= 1 ? 1 : Ease.outBack(Mathf.clamp01(car.Pop));
      const scale = cs * pop * car.Press * (1 + car.Lift * 0.18);
      car.Root.localPosition = new V3(car.Pos.x, car.Pos.y, 0);
      car.Root.localRotation = Quaternion.euler(0, 0, car.Heading);
      car.Root.localScale = new V3(scale, scale, 1);
      const so = new V2(0.06, -0.09).mul(cs * (1 + car.Lift * 3));
      car.Shadow.transform.localPosition = new V3(car.Pos.x + so.x, car.Pos.y + so.y, 0);
      car.Shadow.transform.localRotation = Quaternion.euler(0, 0, car.Heading);
      car.Shadow.transform.localScale = new V3(scale * car.Spec.len, scale * car.Spec.len, 1);
      car.Shadow.color = new Color(1, 1, 1, Mathf.clamp01(pop) * (1 - car.Lift * 0.4));
    }
    for (const cone of this.cones) {
      const j = cone.Jolt;
      const p = cone.Pos.add(cone.JoltDir.mul(Math.sin((1 - j) * Math.PI * 3) * 0.08 * cs * j));
      cone.Sr.transform.localPosition = new V3(p.x, p.y, 0);
      cone.Sr.transform.localRotation = Quaternion.euler(0, 0, Math.sin((1 - j) * 30) * 12 * j);
      const s = cs * 0.78 * (1 + j * 0.08);
      cone.Sr.transform.localScale = new V3(s, s, 1);
    }
  }

  // ------------------------------------------------------------------ end conditions

  private CarsLeft() { let n = 0; for (const c of this.cars) if (this.IsParked(c)) n++; return n; }

  private CheckEnd() {
    if (this.CarsLeft() === 0) {
      this.ended = true;
      this.won = true;
      this.endTimer = 1.1;
      this.hinted = null;
      this.UI.Announce(this.bumps === 0 ? "PERFECT!" : "LOT CLEARED!", Yellow, 1.5);
      this.fx.confetti(this.lotCenter.add(new V2(0, -1)), 90, 11, [...CarEscapeArt.Colors, Color.white]);
      this.fx.sparkle(this.lotCenter, Color.white, 14, 2.5, 0.35);
      Sfx.play(Snd.Win);
      Sfx.playClip(this.honkClip, 0.5, 1.2);
      return;
    }
    if (this.limit > 0 && this.moves >= this.limit) {
      for (const c of this.cars) if (c.BumpT >= 0) return; // let the last bump finish
      this.ended = true;
      this.won = false;
      this.endTimer = 0.8;
      this.UI.Announce("OUT OF MOVES!", Red, 1.2);
      Sfx.play(Snd.Lose, 0.8);
      this.Fx.shake(0.2);
    }
  }

  // ------------------------------------------------------------------ boosters

  private OnUndo() {
    if (this.State !== Phase.Playing || this.ended) return;
    const last = this.history[this.history.length - 1];
    if (!last) { Sfx.play(Snd.Deny, 0.5); this.UI.Toast("Nothing to undo yet", 1.5); return; }
    if (!CasualUI.useOrEarn(() => this.Undos, (v) => (this.Undos = v), this.UI, "+1 UNDO")) return;
    this.history.pop();
    const car = last.car;
    if (last.kind === "bump") {
      this.moves = Math.max(0, this.moves - 1);
      this.bumps = Math.max(0, this.bumps - 1);
      car.BumpT = -1;
    } else {
      if (last.kind === "exit") { this.moves = Math.max(0, this.moves - 1); this.Data.add("cars", -1); }
      else this.towed = Math.max(0, this.towed - 1);
      car.Gone = car.Exiting = car.Towing = false;
      car.Lift = 0;
      car.Root.setActive(true);
      car.Shadow.gameObject.setActive(true);
      car.Body.sortingOrder = 40;
      car.Shadow.sortingOrder = 30;
      car.Pos = car.Home;
      car.Heading = car.Angle;
      car.Pop = 0;
      car.PuffT = 0;
      this.lot.put(car.Spec);
      this.fx.pop(car.Home, Color.white, 10, 3 * this.cs, 0.2 * this.cs, 0.4);
    }
    Sfx.play(Snd.Whoosh, 0.6);
    Sfx.playClip(this.popClip, 0.5);
  }

  private OnHint() {
    if (this.State !== Phase.Playing || this.ended) return;
    if (this.hinted) return; // already showing
    const live = this.cars.filter((c) => this.IsParked(c));
    const pick = hintCar(this.lot, live.map((c) => c.Spec));
    if (!pick) return;
    if (!CasualUI.useOrEarn(() => this.Hints, (v) => (this.Hints = v), this.UI, "+1 HINT")) return;
    this.hinted = this.cars[pick.id];
    this.hintT = 0;
    Sfx.play(Snd.Pickup, 0.6);
    this.fx.sparkle(this.hinted.Home, Yellow, 6, 0.6 * this.cs, 0.3 * this.cs);
  }

  private OnTow() {
    if (this.State !== Phase.Playing || this.ended) return;
    if (this.towMode) { this.towMode = false; this.UI.Hint(null); return; }
    if (this.Tows > 0) {
      this.towMode = true;
      this.UI.Hint("Tap any car and the tow truck lifts it away!");
      Sfx.play(Snd.Confirm, 0.6);
      return;
    }
    if (!AdService.rewardedAvailable) return;
    AdService.showRewarded((ok) => {
      if (!ok) return;
      this.Tows = this.Tows + 1;
      this.UI.Toast("+1 TOW", 2);
      Sfx.play(Snd.PowerUp, 0.7);
    });
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    CasualUI.setText(this.levelText, "LEVEL " + this.level);
    if (this.limit > 0) {
      const left = Math.max(0, this.limit - this.moves);
      CasualUI.setText(this.movesText, `<size=24>MOVES LEFT</size>\n${left}`);
      this.movesText.color = left <= 3 ? Color.lerp(Red, Color.white, 0.5 + 0.5 * Math.sin(this.clock * 8) * (left <= 1 ? 1 : 0)) : Yellow;
    } else {
      CasualUI.setText(this.movesText, `<size=24>MOVES</size>\n${this.moves}`);
      this.movesText.color = Yellow;
    }
    const left = this.CarsLeft();
    CasualUI.setText(this.leftText, left === 1 ? "1 CAR" : `${left} CARS`);
    const usable = !this.ended && this.State === Phase.Playing;
    CasualUI.booster(this.undoButton, "UNDO", this.Undos, usable && this.history.length > 0);
    CasualUI.booster(this.hintButton, "HINT", this.Hints, usable && !this.hinted);
    CasualUI.booster(this.towButton, "TOW", this.Tows, usable, this.towMode ? "CANCEL" : null);
  }

  // ------------------------------------------------------------------ results

  private StarsFor() {
    const par = Math.max(1, this.spec.par - this.towed);
    if (this.moves <= par) return 3;
    if (this.moves <= par + Math.max(2, Math.floor(par * 0.2))) return 2;
    return 1;
  }

  private Win() {
    const stars = this.StarsFor();
    const prev = this.Data.get("s" + this.level);
    if (stars > prev) {
      this.Data.set("s" + this.level, stars);
      this.Data.add("stars", stars - prev);
    }
    this.Data.set("level", this.level + 1);
    const gift = this.level % 5 === 0;
    if (gift) { this.Hints = this.Hints + 1; this.Tows = this.Tows + 1; }
    const lvl = this.level;
    const freeHint = lvl % 2 === 0;
    this.Finish(new Result({
      Headline: stars === 3 ? `PERFECT PARKING!` : `LEVEL ${lvl} CLEARED!`,
      HeadlineColor: Gold,
      Stars: stars,
      Value: String(this.moves),
      BestLine: gift ? "GIFT: +1 HINT  +1 TOW" : `NEXT: LEVEL ${lvl + 1}`,
      Stats: [
        ["MOVES", String(this.moves)],
        ["BUMPS", String(this.bumps)],
        ["PAR", String(this.spec.par)],
        ["STARS", String(this.Data.get("stars"))],
      ],
      Primary: "NEXT LEVEL",
      Victory: true,
      Reward: () => {
        if (freeHint) this.Hints = this.Hints + 1;
        else this.Tows = this.Tows + 1;
        this.UI.Toast(freeHint ? "+1 HINT" : "+1 TOW", 2);
        Sfx.play(Snd.PowerUp, 0.8);
      },
      RewardLabel: freeHint ? "GET A FREE HINT (WATCH AD)" : "GET A FREE TOW (WATCH AD)",
    }));
  }

  private Lose() {
    this.Finish(new Result({
      Headline: "OUT OF MOVES!",
      HeadlineColor: Pal.hex(0xffc2b0),
      Value: String(this.CarsLeft()),
      BestLine: "CARS STILL PARKED",
      Stats: [
        ["LEVEL", String(this.level)],
        ["MOVES", `${this.moves}/${this.limit}`],
        ["BUMPS", String(this.bumps)],
        ["STARS", String(this.Data.get("stars"))],
      ],
      Primary: "TRY AGAIN",
      Reward: this.revived ? null : () => this.Continue(),
      RewardLabel: `+${ContinueMoves} MOVES & CONTINUE (AD)`,
    }));
  }

  private Continue() {
    this.revived = true;
    this.ended = false;
    this.limit += ContinueMoves;
    this.pointer.reset();
    this.Revive();
    this.UI.Announce(`+${ContinueMoves} MOVES!`, Blue, 1.2);
    Sfx.play(Snd.PowerUp);
  }
}

function Random2(k: number) { return new V2((Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k); }
