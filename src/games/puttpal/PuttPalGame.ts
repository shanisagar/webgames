import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, CasualUI, Color, Fx, GameInfo, GameObject,
  howTo, LevelPath, Mathf, Pal, Phase, Quaternion, Random, Result, Sfx, Snd, Sprite, SpriteRenderer, SysRandom, TapPointer,
  Text, Time, TouchScheme, UIKit, V2, V3,
} from "../../kit";
import { PuttPalCourses } from "./PuttPalCourses";

/**
 * PUTT PAL: top-down mini golf. Drag back from anywhere and release to putt; the further you pull, the harder the
 * shot. Bank off the wooden rails, bounce off bumpers, avoid sand and water, time the sliding gates and sink the ball
 * in as few strokes as possible. 12 hand-made holes, replayed mirrored after the first lap. GUIDE shows the full
 * bounce path of the next putt (three free, more with a rewarded ad); a rewarded ad also gives extra strokes when you
 * run out. (Port of PuttPalGame.cs.)
 */

const W = PuttPalCourses.W, H = PuttPalCourses.H;
const BallR = 0.17, BumperR = 0.34, MaxSpeed = 13, CupR = 0.27, BarHalfW = 1, BarHalfH = 0.17;
const AimDots = 14;

const Ink = Pal.hex(0x1d3b22), Gold = Pal.hex(0xffc93c), Flag = Pal.hex(0xff4d5e);

/** System.Random(seed).NextDouble(): a fresh seeded generator per sample (white noise). */
const noiseAt = (seed: number) => new SysRandom(seed).nextDouble();

class Bar {
  Sr!: SpriteRenderer;
  Y = 0; X0 = 0; X1 = 0; Phase = 0; Speed = 0; X = 0; Vx = 0;
}

/** Ball state passed by reference to StepBall (C# ref Vector2 p, ref Vector2 v). */
interface BallState { p: V2; v: V2 }

// ------------------------------------------------------------------ art

const Hash = (x: number, y: number) => Mathf.repeat(Math.sin(x * 127.1 + y * 311.7) * 43758.5453, 1);
const Walkable = (c: string) => c !== "#";
const Tile = (m: string[][], x: number, row: number) => (x < 0 || x >= W || row < 0 || row >= H ? "#" : m[x][row]);

function CourseSprite(m: string[][], lvl: number): Sprite {
  const i = (lvl - 1) % PuttPalCourses.Count;
  const mirror = Math.trunc((lvl - 1) / PuttPalCourses.Count) % 2 === 1;
  const ppt = 40;
  const a = H / W;
  return CasualArt.make("pp-course-" + i + (mirror ? "m" : ""), W * ppt, H * ppt, (p) => {
    const lx = (p.x + 1) * 0.5 * W, ly = ((p.y + a) / (2 * a)) * H;
    const cx = Mathf.clamp(Math.floor(lx), 0, W - 1), fyI = Mathf.clamp(Math.floor(ly), 0, H - 1);
    const row = H - 1 - fyI;
    const fx = lx - cx, fy = ly - fyI;
    const ch = Tile(m, cx, row);
    if (!Walkable(ch)) {
      // hedge with a wooden rail along every side that touches the green
      const n = Hash(Math.floor(lx * 6), Math.floor(ly * 6));
      let c = Color.lerp(Pal.hex(0x2e6b34), Pal.hex(0x3c8a40), n * 0.6 + 0.2 * Math.sin(lx * 9) * Math.sin(ly * 9));
      let rail = 9;
      if (Walkable(Tile(m, cx - 1, row))) rail = Math.min(rail, fx);
      if (Walkable(Tile(m, cx + 1, row))) rail = Math.min(rail, 1 - fx);
      if (Walkable(Tile(m, cx, row - 1))) rail = Math.min(rail, 1 - fy);
      if (Walkable(Tile(m, cx, row + 1))) rail = Math.min(rail, fy);
      if (Walkable(Tile(m, cx - 1, row - 1))) rail = Math.min(rail, new V2(fx, 1 - fy).magnitude);
      if (Walkable(Tile(m, cx + 1, row - 1))) rail = Math.min(rail, new V2(1 - fx, 1 - fy).magnitude);
      if (Walkable(Tile(m, cx - 1, row + 1))) rail = Math.min(rail, new V2(fx, fy).magnitude);
      if (Walkable(Tile(m, cx + 1, row + 1))) rail = Math.min(rail, new V2(1 - fx, fy).magnitude);
      if (rail < 0.32) {
        const t = rail / 0.32;
        let wood = Color.lerp(Pal.hex(0xe0a86a), Pal.hex(0xa8703e), t);
        const grain = Math.sin((lx + ly) * 20 + Math.sin(ly * 3) * 2);
        wood = Color.lerp(wood, Pal.hex(0x8a5a30), CasualArt.smooth(0.7, 1, grain) * 0.3);
        if (t > 0.86) wood = Color.lerp(wood, Pal.hex(0x5e3a20), (t - 0.86) / 0.14);
        c = wood;
      } else if (rail < 0.42) c = Color.lerp(c, Pal.hex(0x1c4022), 1 - (rail - 0.32) / 0.1);
      return c.withAlpha(1);
    }
    let g = (row + cx) % 2 === 0 ? Pal.hex(0x5cc65c) : Pal.hex(0x52b952);
    g = Color.lerp(g, Pal.hex(0x6ad46a), (Hash(Math.floor(lx * 14), Math.floor(ly * 14)) - 0.5) * 0.25 + 0.1);
    if (ch === "s") {
      const n = Hash(Math.floor(lx * 16), Math.floor(ly * 16));
      g = Color.lerp(Pal.hex(0xf2d79a), Pal.hex(0xe2c07e), n);
      const l = Tile(m, cx - 1, row) === "s", r = Tile(m, cx + 1, row) === "s", u = Tile(m, cx, row - 1) === "s", d = Tile(m, cx, row + 1) === "s";
      let e = 9;
      if (!l) e = Math.min(e, fx);
      if (!r) e = Math.min(e, 1 - fx);
      if (!u) e = Math.min(e, 1 - fy);
      if (!d) e = Math.min(e, fy);
      if (e < 0.08) g = Color.lerp(g, Pal.hex(0xc9a465), 1 - e / 0.08);
    } else if (ch === "w") {
      const wave = Math.sin(lx * 7 + Math.sin(ly * 4) * 1.5) * Math.sin(ly * 6);
      g = Color.lerp(Pal.hex(0x2f8fe0), Pal.hex(0x4fb4ff), 0.5 + 0.5 * wave);
      g = Color.lerp(g, Color.white, CasualArt.smooth(0.85, 0.95, wave) * 0.5);
      const l = Tile(m, cx - 1, row) === "w", r = Tile(m, cx + 1, row) === "w", u = Tile(m, cx, row - 1) === "w", d = Tile(m, cx, row + 1) === "w";
      let e = 9;
      if (!l && Walkable(Tile(m, cx - 1, row))) e = Math.min(e, fx);
      if (!r && Walkable(Tile(m, cx + 1, row))) e = Math.min(e, 1 - fx);
      if (!u && Walkable(Tile(m, cx, row - 1))) e = Math.min(e, 1 - fy);
      if (!d && Walkable(Tile(m, cx, row + 1))) e = Math.min(e, fy);
      if (e < 0.1) g = Color.lerp(g, Pal.hex(0xbfe6ff), 1 - e / 0.1);
    }
    // soft shadow cast by rails on the top and left
    let sh = 0;
    if (!Walkable(Tile(m, cx - 1, row))) sh = Math.max(sh, 1 - fx / 0.16);
    if (!Walkable(Tile(m, cx, row - 1))) sh = Math.max(sh, 1 - (1 - fy) / 0.16);
    g = Color.lerp(g, Pal.hex(0x245a28), Mathf.clamp01(sh) * 0.45);
    return g.withAlpha(1);
  });
}

const BallSprite = () => CasualArt.make("pp-ball", 64, 64, (p) => {
  const px = 2 / 64;
  let c = CasualArt.ballPixel(p, Color.white, px);
  if (c.a <= 0) return c;
  const dimple = Math.sin(p.x * 26) * Math.sin(p.y * 26);
  c = Color.lerp(c, new Color(0.82, 0.84, 0.88, c.a), CasualArt.smooth(0.6, 0.9, dimple) * 0.35);
  return c;
});

const CupSprite = () => CasualArt.make("pp-cup", 64, 64, (p) => {
  const px = 2 / 64;
  const r = p.magnitude;
  let c = Color.lerp(Pal.hex(0x0e1a10), Pal.hex(0x2a3a2c), CasualArt.smooth(0.2, -0.8, p.y));
  c = Color.lerp(Color.white, c, CasualArt.fill(r - 0.82, px));
  return c.withAlpha(CasualArt.fill(r - 0.96, px));
});

const FlagSprite = () => CasualArt.make("pp-flag", 64, 64, (p) => {
  const d = Math.max(-p.x - 0.9, Math.abs(p.y) * 1.6 + p.x * 0.55 - 0.55 + Math.sin(p.x * 5) * 0.05);
  const c = Color.lerp(Pal.hex(0xd6283e), Pal.hex(0xff5a6e), CasualArt.smooth(-0.5, 0.5, p.y));
  return c.withAlpha(CasualArt.fill(d * 0.7, 2 / 64));
});

const BumperSprite = () => CasualArt.make("pp-bumper", 96, 96, (p) => {
  const px = 2 / 96;
  const r = p.magnitude;
  let c = CasualArt.ballPixel(p, Flag, px);
  const ring = Math.abs(r - 0.58) - 0.12;
  c = Color.lerp(c, Color.white, CasualArt.fill(ring, px) * 0.9 * c.a);
  const cap = r - 0.3;
  c = Color.lerp(c, CasualArt.lighten(Flag, 0.3), CasualArt.fill(cap, px) * c.a);
  return c;
});

const BarSprite = () => CasualArt.make("pp-bar", 128, 32, (p) => {
  const px = 2 / 128;
  const d = CasualArt.sdBox(p, new V2(0.98, 0.22), 0.2);
  let c = Color.lerp(Pal.hex(0x6a7bff), Pal.hex(0x9aa8ff), CasualArt.smooth(-0.2, 0.2, p.y));
  const stripe = Mathf.repeat(p.x * 4 + p.y * 2, 1);
  c = Color.lerp(c, Pal.hex(0xffd23f), stripe < 0.5 ? 0.85 : 0);
  c = Color.lerp(Pal.hex(0x2a2f66), c, CasualArt.fill(d + 0.05, px));
  return c.withAlpha(CasualArt.fill(d, px));
});

const TeeSprite = () => CasualArt.make("pp-tee", 64, 64, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.9, 0.9), 0.3);
  return new Color(1, 1, 1, CasualArt.fill(d, 2 / 64) * 0.35);
});

export class PuttPalGame extends ArcadeGame {
  private world!: GameObject; private course!: GameObject;
  private bgCover!: SpriteRenderer; private courseSr!: SpriteRenderer; private ball!: SpriteRenderer; private ballShadow!: SpriteRenderer;
  private cup!: SpriteRenderer; private flag!: SpriteRenderer; private pole!: SpriteRenderer; private tee!: SpriteRenderer; private powerRing!: SpriteRenderer;
  private bumperSr: SpriteRenderer[] = [];
  private bumpers: V2[] = [];
  private bars: Bar[] = [];
  private dots: SpriteRenderer[] = [];
  private pointer = new TapPointer();
  private fx!: CasualFx;

  private map!: string[][];
  private level = 0; private par = 0; private strokes = 0; private maxStrokes = 0; private revives = 0;
  private holeName = "";
  private pos = V2.zero; private vel = V2.zero; private holePos = V2.zero; private teePos = V2.zero; private lastRest = V2.zero;
  private scale = 1; private sinkT = 0; private endTimer = 0; private rollTimer = 0; private attract = 0; private barClock = 0;
  private moving = false; private sinking = false; private sunk = false; private ended = false; private aiming = false; private guideArmed = false;
  private aimPower = 0;
  private aimDir = V2.zero;

  private holeText: Text | null = null; private strokeText!: Text;
  private guideButton!: ArcadeButton;
  private path!: LevelPath;
  private puttClip!: AudioClip; private wallClip!: AudioClip; private bumpClip!: AudioClip; private cupClip!: AudioClip; private splashClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "puttpal",
      Title: "PUTT PAL",
      Tagline: "PULL. PUTT. HOLE IN ONE!",
      Accent: Pal.hex(0x3fbf5a),
      Accent2: Gold,
      BgTop: Pal.hex(0x9fe08a),
      BgBottom: Pal.hex(0x4c9e4a),
      ShortSide: 10,
      Touch: TouchScheme.None,
      Music: { bpm: 96, rootHz: 146.8, degrees: [0, 5, 3, 4], seed: 33, energy: 0.3, major: true },
      Reminders: [
        "The green is ready|Can you get a hole in one today?",
        "A new hole awaits|Sink it under par for three stars.",
        "Bank shots, bumpers and gates|Putt Pal has more holes to play.",
      ],
      HowTo: [
        howTo(Art.Chevron, Pal.hex(0x3fbf5a), "DRAG BACK anywhere and RELEASE to putt. Pull further for more power."),
        howTo(Art.Square, Pal.hex(0xb07a48), "The ball bounces off the wooden rails. Use them for bank shots!"),
        howTo(Art.Disc, Flag, "Red bumpers kick the ball away faster."),
        howTo(Art.Diamond, Pal.hex(0x3da5f5), "Sand slows the ball. Water costs a stroke and puts you back."),
        howTo(Art.Star, Gold, "Sink the ball at or under PAR for stars. GUIDE shows your full path."),
      ],
      Tips: [
        "Too fast and the ball skips over the hole: putt gently near the cup.",
        "Aim at the rail, not the hole, to bank around corners.",
        "Watch the sliding gates and putt when the gap opens.",
        "Short safe putts beat risky long ones near water.",
        "Save your GUIDE for tricky bank shots.",
      ],
    });
  }

  protected get ShortSide() { return 10; }
  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }
  private get Guides() { return this.Data.get("guide", 3); }
  private set Guides(v: number) { this.Data.set("guide", Math.max(0, v)); }
  protected BestLine() { return `HOLE ${this.CurrentLevel}   ·   ${this.Data.get("stars")} STARS`; }
  protected StatsLine() { return `${this.Data.get("aces")} HOLES IN ONE   ·   ${this.Data.get("holes")} HOLES PLAYED`; }

  private At(x: number, row: number) { return x < 0 || x >= W || row < 0 || row >= H ? "#" : this.map[x][row]; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("PuttWorld", this.gameObject);
    CasualLook.calm(this, 1.2, 0.14);
    this.bgCover = CasualLook.cover(this.world, CasualArt.gradient(Pal.hex(0x3c8a40), Pal.hex(0x1f5426), new Color(0.7, 1, 0.6, 0.2)), -910);
    this.course = new GameObject("Course", this.world);
    const course = this.course;
    this.courseSr = Art.spr(course, "Green", CasualArt.Soft, Color.white, 1, -100, Art.Flat);
    this.tee = Art.spr(course, "Tee", TeeSprite(), Color.white, 0.8, -90, Art.Flat);
    this.cup = Art.spr(course, "Cup", CupSprite(), Color.white, CupR * 2.2, -80, Art.Flat);
    this.ballShadow = Art.spr(course, "BallShadow", CasualArt.Soft, new Color(0, 0.15, 0, 0.35), BallR * 3, 5, Art.Flat);
    this.ball = Art.spr(course, "Ball", BallSprite(), Color.white, BallR * 2, 10, Art.Flat);
    this.powerRing = Art.spr(course, "Power", Art.Ring, new Color(1, 1, 1, 0), 1, 8, Art.Flat);
    this.pole = Art.spr(course, "Pole", CasualArt.make("pp-pole", 8, 64, () => Color.white), Color.white, 1, 30, Art.Flat);
    this.pole.transform.localScale = new V3(0.06, 1.1 / 8, 1);
    this.flag = Art.spr(course, "Flag", FlagSprite(), Color.white, 0.6, 31, Art.Flat);
    for (let i = 0; i < AimDots; i++) this.dots.push(Art.spr(course, "Aim", Art.Disc, new Color(1, 1, 1, 0), 0.12, 7, Art.Flat));
    this.fx = CasualFx.create(this.world, 60, 140);

    const hud = this.UI.Hud;
    this.holeText = UIKit.at(UIKit.label(hud, "", 46, Color.white), new V2(0.5, 1), new V2(0, -110), new V2(900, 64));
    UIKit.glow(this.holeText, Ink, 4);
    this.strokeText = UIKit.at(UIKit.label(hud, "", 32, Pal.hex(0xe8ffd8)), new V2(0.5, 1), new V2(0, -170), new V2(900, 44));
    UIKit.glow(this.strokeText, Ink, 3);
    this.guideButton = UIKit.buttonAt(hud, "GUIDE", new V2(0.5, 0), new V2(0, 90), new V2(360, 120), false, () => this.OnGuide(), 30);
    this.guideButton.setAccent(Pal.hex(0x3fbf5a));

    this.path = new LevelPath(this.UI, Pal.hex(0x3fbf5a), Gold, Ink);

    this.puttClip = Sfx.make("pp-putt", 0.12, (t) => (Sfx.sinP(Sfx.glide(t, 1400, 900, 0.05)) * 0.5 + (noiseAt(Math.trunc(t * 44100)) * 2 - 1) * 0.3 * Sfx.env(t, 0.001, 0.02)) * Sfx.env(t, 0.001, 0.08) * 0.35);
    this.wallClip = Sfx.make("pp-wall", 0.1, (t) => (Sfx.sinP(Sfx.glide(t, 420, 260, 0.06)) * 0.6 + (noiseAt(Math.trunc(t * 44100) + 7) * 2 - 1) * 0.2) * Sfx.env(t, 0.001, 0.07) * 0.35);
    this.bumpClip = Sfx.make("pp-bump", 0.2, (t) => Sfx.sinP(Sfx.glide(t, 500, 1100, 0.1)) * Sfx.env(t, 0.002, 0.16) * 0.3);
    this.cupClip = Sfx.make("pp-cup", 0.5, (t) => Sfx.sinP(Sfx.glide(t, 300, 160, 0.2)) * Sfx.env(t, 0.002, 0.15) * 0.5 + Sfx.sinP(1318 * t) * Sfx.env(t - 0.18, 0.003, 0.3) * 0.25);
    this.splashClip = Sfx.make("pp-splash", 0.45, (t) => (noiseAt(Math.trunc(t * 44100) + 9) * 2 - 1) * Sfx.env(t, 0.005, 0.4) * 0.3 * (0.6 + 0.4 * Math.sin(t * 60)));
    this.Setup(this.CurrentLevel);
  }

  // ------------------------------------------------------------------ holes

  private Setup(lvl: number) {
    this.level = lvl;
    const m = PuttPalCourses.Map(lvl);
    this.map = m.map;
    this.par = m.par;
    this.holeName = m.name;
    this.courseSr.sprite = CourseSprite(this.map, lvl);
    this.courseSr.transform.localPosition = new V3(W * 0.5, H * 0.5, 0);
    this.courseSr.transform.localScale = new V3(W, W, 1);
    for (const b of this.bumperSr) b.gameObject.destroy();
    this.bumperSr = [];
    this.bumpers = [];
    for (const b of this.bars) b.Sr.gameObject.destroy();
    this.bars = [];
    for (let row = 0; row < H; row++) {
      let barRow = false;
      let minX = W, maxX = -1;
      for (let x = 0; x < W; x++) {
        const c = this.map[x][row];
        const center = this.TileCenter(x, row);
        if (c === "T") this.teePos = center;
        if (c === "H") this.holePos = center;
        if (c === "o") {
          this.bumpers.push(center);
          this.bumperSr.push(Art.spr(this.course, "Bumper", BumperSprite(), Color.white, BumperR * 2.1, 12, Art.Flat));
          this.bumperSr[this.bumperSr.length - 1].transform.localPosition = center;
        }
        if (c === "m") barRow = true;
        if (Walkable(c)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x + 1); }
      }
      if (barRow) {
        const b = new Bar();
        b.Y = H - row - 0.5; b.X0 = minX + BarHalfW; b.X1 = maxX - BarHalfW; b.Phase = row * 1.3; b.Speed = 1.4 + (row % 3) * 0.3;
        b.Sr = Art.spr(this.course, "Bar", BarSprite(), Color.white, 1, 12, Art.Flat);
        b.Sr.transform.localScale = new V3(BarHalfW * 2, (BarHalfH * 2) / 0.25, 1);
        this.bars.push(b);
      }
    }
    this.tee.transform.localPosition = this.teePos;
    this.cup.transform.localPosition = this.holePos;
    this.pos = this.lastRest = this.teePos;
    this.vel = V2.zero;
    this.strokes = this.revives = 0;
    this.maxStrokes = Math.max(6, this.par + 4);
    this.moving = this.sinking = this.sunk = this.ended = this.aiming = this.guideArmed = false;
    this.barClock = 0;
    this.ball.transform.localScale = V3.one.mul(BallR * 2);
    this.ball.color = Color.white;
    this.Layout();
    this.UpdateBars(0);
    this.Present();
  }

  private TileCenter(x: number, row: number) { return new V2(x + 0.5, H - row - 0.5); }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    const top = 2.1, bottom = 1.9;
    this.scale = Math.min((this.ViewSize.x - 0.3) / W, (this.ViewSize.y - top - bottom) / H);
    this.course.localScale = new V3(this.scale, this.scale, 1);
    this.course.localPosition = new V3(-W * 0.5 * this.scale, -H * 0.5 * this.scale + (bottom - top) * 0.5, 0);
  }

  private ToWorld(local: V2) { const lp = this.course.localPosition;
    return new V2(lp.x, lp.y).add(local.mul(this.scale)); }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.Setup(this.CurrentLevel);
    this.path.refresh(this.Data, this.CurrentLevel);
    this.attract = 1.2;
  }

  protected BeginRun() {
    this.Setup(this.CurrentLevel);
    this.pointer.reset();
    this.pointer.topBand = 0.1;
    this.UI.Announce(`HOLE ${this.level}  ·  PAR ${this.par}`, Gold, 1.3);
    if (this.Data.get("holes") === 0) this.UI.Hint("Drag back anywhere and let go to putt!");
    Sfx.setIntensity(0.1);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.State !== Phase.Title) return;
    this.UpdateBars(dt);
    if (this.moving || this.sinking) this.Simulate(dt);
    else {
      this.attract -= dt;
      if (this.attract <= 0) {
        this.attract = 2.2;
        if (this.sunk || (this.pos.sub(this.teePos).sqrMagnitude > 0.01 && this.strokes > 2)) { this.Setup(this.CurrentLevel); return; }
        // a gentle putt roughly toward the hole
        let d = this.holePos.sub(this.pos).normalized;
        d = Quaternion.euler(0, 0, Random.range(-25, 25)).rotate(d);
        this.Shoot(d, 0.55, true);
      }
    }
    this.Present();
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    this.UpdateBars(dt);
    if (this.ended) {
      this.endTimer -= dt;
      this.Simulate(dt);
      this.Present();
      if (this.endTimer <= 0 && this.State === Phase.Playing) { if (this.sunk) this.Win(); else this.Lose(); }
      return;
    }
    if (this.moving || this.sinking) this.Simulate(dt);
    else this.HandleAim();
    this.Present();
  }

  private HandleAim() {
    const pointer = this.pointer;
    if (pointer.down) { this.aiming = true; this.aimPower = 0; }
    if (!this.aiming) { this.HideAim(); return; }
    const d = pointer.startScreen.sub(pointer.screen);
    this.aimPower = Mathf.clamp01(d.magnitude / TapPointer.dp(230));
    if (d.sqrMagnitude > 1) this.aimDir = d.normalized;
    if (pointer.up || !pointer.held) {
      this.aiming = false;
      this.HideAim();
      if (this.aimPower > 0.06) {
        this.UI.Hint(null);
        this.Shoot(this.aimDir, this.aimPower, false);
      }
      return;
    }
    this.ShowAim();
  }

  private ShowAim() {
    const pc = Color.lerp(Pal.hex(0x7cff7a), Pal.hex(0xff4d5e), this.aimPower);
    this.powerRing.transform.localPosition = this.pos;
    const rs = 0.5 + this.aimPower * 0.5;
    this.powerRing.transform.localScale = new V3(rs, rs, 1);
    this.powerRing.color = new Color(pc.r, pc.g, pc.b, 0.75);
    if (this.guideArmed) {
      // full predicted path with bounces
      const pts = this.Predict(this.pos, this.aimDir.mul(this.aimPower * MaxSpeed), AimDots);
      for (let i = 0; i < AimDots; i++) {
        const on = i < pts.length;
        this.dots[i].color = on ? new Color(Gold.r, Gold.g, Gold.b, 0.95 - i * 0.04) : new Color(1, 1, 1, 0);
        if (on) this.dots[i].transform.localPosition = pts[i];
      }
    } else {
      const len = 0.6 + this.aimPower * 2.6;
      for (let i = 0; i < AimDots; i++) {
        const t = (i + 1) / AimDots;
        this.dots[i].transform.localPosition = this.pos.add(this.aimDir.mul(BallR + t * len));
        this.dots[i].color = i < 7 ? new Color(1, 1, 1, (1 - i / 7) * 0.9) : new Color(1, 1, 1, 0);
      }
    }
  }

  private HideAim() {
    this.powerRing.color = new Color(1, 1, 1, 0);
    for (const d of this.dots) d.color = new Color(1, 1, 1, 0);
  }

  private Shoot(dir: V2, power: number, silent: boolean) {
    this.lastRest = this.pos;
    this.vel = dir.mul(power * MaxSpeed);
    this.moving = true;
    this.rollTimer = 0;
    this.strokes++;
    if (this.guideArmed) this.guideArmed = false;
    if (!silent) {
      Sfx.playClip(this.puttClip, 0.4 + power * 0.5);
      Fx.haptic(false);
      this.UpdateHud();
    }
  }

  // ------------------------------------------------------------------ physics

  private UpdateBars(dt: number) {
    this.barClock += dt;
    for (const b of this.bars) {
      const x = Mathf.lerp(b.X0, b.X1, 0.5 + 0.5 * Math.sin(this.barClock * b.Speed + b.Phase));
      b.Vx = dt > 0 ? (x - b.X) / dt : 0;
      b.X = x;
      b.Sr.transform.localPosition = new V3(b.X, b.Y, 0);
    }
  }

  private Simulate(dt: number) {
    if (this.sinking) {
      this.sinkT += dt;
      this.pos = V2.lerp(this.pos, this.holePos, dt * 14);
      const s = Mathf.lerp(BallR * 2, BallR * 1.1, Mathf.clamp01(this.sinkT * 5));
      this.ball.transform.localScale = V3.one.mul(s);
      this.ball.color = new Color(1, 1, 1, 1 - Mathf.clamp01(this.sinkT * 4 - 0.6));
      if (this.sinkT > 0.35) { this.sinking = false; this.moving = false; }
      return;
    }
    if (!this.moving) return;
    const speed = this.vel.magnitude;
    const steps = Mathf.clamp(Math.ceil((speed * dt) / 0.06), 1, 12);
    const h = dt / steps;
    for (let i = 0; i < steps && this.moving; i++) {
      const st: BallState = { p: this.pos, v: this.vel };
      const hit = this.StepBall(st, h, true);
      this.pos = st.p;
      this.vel = st.v;
      if (hit === 1) Sfx.playClip(this.wallClip, Mathf.clamp01(this.vel.magnitude / MaxSpeed) * 0.8 + 0.1);
      else if (hit === 2) { Sfx.playClip(this.bumpClip, 0.6); Fx.haptic(false); }
      if (this.CheckCup()) return;
      if (this.CheckWater()) return;
    }
    this.rollTimer += dt;
    if (this.vel.sqrMagnitude < 0.0025 || this.rollTimer > 12) {
      this.vel = V2.zero;
      this.moving = false;
      this.OnRest();
    }
  }

  /** Moves the ball one sub-step. Returns 0 nothing, 1 rail, 2 bumper, 3 gate. */
  private StepBall(s: BallState, h: number, live: boolean) {
    let result = 0;
    let p = s.p, v = s.v;
    // rolling friction: sand is much slower
    const tx = Math.floor(p.x), row = H - 1 - Math.floor(p.y);
    const ground = this.At(tx, row);
    const sp = v.magnitude;
    const decel = ground === "s" ? 7 + sp * 1.6 : 0.9 + sp * 0.32;
    if (sp > 0) v = v.mul(Math.max(0, sp - decel * h) / sp);
    // the cup pulls a slow ball in
    const toCup = this.holePos.sub(p);
    const dc = toCup.magnitude;
    if (dc < 0.55 && dc > 0.001) v = v.add(toCup.div(dc).mul(1.2 * (1 - dc / 0.55)).mul(h * 8));
    p = p.add(v.mul(h));
    // rails: circle vs wall tiles around the ball
    const bx = Math.floor(p.x), by = Math.floor(p.y);
    for (let yy = by - 1; yy <= by + 1; yy++)
      for (let xx = bx - 1; xx <= bx + 1; xx++) {
        const r = H - 1 - yy;
        if (Walkable(this.At(xx, r))) continue;
        const closest = new V2(Mathf.clamp(p.x, xx, xx + 1), Mathf.clamp(p.y, yy, yy + 1));
        const d = p.sub(closest);
        const dist = d.magnitude;
        if (dist >= BallR) continue;
        const n = dist > 1e-4 ? d.div(dist) : V2.up;
        p = p.add(n.mul(BallR - dist));
        const vn = V2.dot(v, n);
        if (vn < 0) {
          v = v.sub(n.mul(1.78 * vn));
          if (-vn > 0.6) result = 1;
        }
      }
    for (const b of this.bumpers) {
      const d = p.sub(b);
      const dist = d.magnitude, min = BallR + BumperR;
      if (dist >= min || dist < 1e-4) continue;
      const n = d.div(dist);
      p = b.add(n.mul(min));
      const vn = V2.dot(v, n);
      if (vn < 0) {
        v = v.sub(n.mul(2 * vn));
        v = v.add(n.mul(1.8));
        result = 2;
        if (live) this.Kick(b);
      }
    }
    if (live) {
      for (const b of this.bars) {
        const closest = new V2(Mathf.clamp(p.x, b.X - BarHalfW, b.X + BarHalfW), Mathf.clamp(p.y, b.Y - BarHalfH, b.Y + BarHalfH));
        const d = p.sub(closest);
        const dist = d.magnitude;
        if (dist >= BallR) continue;
        const n = dist > 1e-4 ? d.div(dist) : p.y > b.Y ? V2.up : V2.down;
        p = p.add(n.mul(BallR - dist + 0.002));
        let rel = v.sub(new V2(b.Vx, 0));
        const vn = V2.dot(rel, n);
        if (vn < 0) { rel = rel.sub(n.mul(1.7 * vn)); v = rel.add(new V2(b.Vx, 0)); result = 1; }
      }
    }
    const s2 = v.magnitude;
    if (s2 > MaxSpeed * 1.3) v = v.mul((MaxSpeed * 1.3) / s2);
    s.p = p;
    s.v = v;
    return result;
  }

  private Kick(bumper: V2) {
    const i = this.bumpers.indexOf(bumper);
    if (i >= 0) this.bumperSr[i].transform.localScale = V3.one.mul(BumperR * 2.6);
    this.fx.sparkle(this.ToWorld(bumper), Color.white, 5, 0.3 * this.scale, 0.25);
  }

  private Predict(p: V2, v: V2, count: number) {
    const pts: V2[] = [];
    const h = 1 / 120, spacing = 0.42;
    let acc = 0;
    const st: BallState = { p, v };
    for (let i = 0; i < 1200 && pts.length < count; i++) {
      const before = st.p;
      this.StepBall(st, h, false);
      acc += st.p.sub(before).magnitude;
      if (acc >= spacing) { acc = 0; pts.push(st.p); }
      if (st.p.sub(this.holePos).magnitude < CupR * 0.8 && st.v.magnitude < 5) { pts.push(this.holePos); break; }
      const tx = Math.floor(st.p.x), row = H - 1 - Math.floor(st.p.y);
      if (this.At(tx, row) === "w") { pts.push(st.p); break; }
      if (st.v.sqrMagnitude < 0.0025) break;
    }
    return pts;
  }

  private CheckCup() {
    const d = this.pos.sub(this.holePos).magnitude, sp = this.vel.magnitude;
    if (d > CupR) return false;
    if (sp > 6.5) {
      // too fast: lips out and skips on
      if (d < CupR * 0.6) this.vel = Quaternion.euler(0, 0, Random.range(-18, 18)).rotate(this.vel).mul(0.8);
      return false;
    }
    this.sinking = true;
    this.sunk = true;
    this.sinkT = 0;
    this.vel = V2.zero;
    Sfx.playClip(this.cupClip, this.State === Phase.Title ? 0.25 : 0.8);
    if (this.State !== Phase.Playing) return true;
    this.ended = true;
    this.endTimer = 1.6;
    Fx.haptic(true);
    const strokes = this.strokes, diff = strokes - this.par;
    const call = strokes === 1 ? "HOLE IN ONE!" : diff <= -2 ? "EAGLE!" : diff === -1 ? "BIRDIE!" : diff === 0 ? "PAR" : diff === 1 ? "BOGEY" : `+${diff}`;
    this.UI.Announce(call, strokes === 1 ? Gold : diff <= 0 ? Pal.hex(0x9bff8a) : Color.white, 1.4);
    if (diff <= 0) {
      this.fx.confetti(this.ToWorld(this.holePos).add(V2.up.mul(1.5)), strokes === 1 ? 90 : 50, 8, [Gold, Flag, Color.white, Pal.hex(0x7cff7a)]);
      Sfx.play(Snd.NewBest, 0.6);
    }
    return true;
  }

  private CheckWater() {
    const tx = Math.floor(this.pos.x), row = H - 1 - Math.floor(this.pos.y);
    if (this.At(tx, row) !== "w") return false;
    // only splash once the ball is well over the water
    for (const o of [new V2(BallR * 0.6, 0), new V2(-BallR * 0.6, 0), new V2(0, BallR * 0.6), new V2(0, -BallR * 0.6)]) {
      const q = this.pos.add(o);
      if (this.At(Math.floor(q.x), H - 1 - Math.floor(q.y)) !== "w") return false;
    }
    this.fx.pop(this.ToWorld(this.pos), Pal.hex(0xbfe6ff), 12, 2.5, 0.12, 0.5);
    Sfx.playClip(this.splashClip, this.State === Phase.Title ? 0.2 : 0.7);
    this.pos = this.lastRest;
    this.vel = V2.zero;
    this.moving = false;
    if (this.State === Phase.Playing) {
      this.strokes++;
      this.UI.Toast("SPLASH! +1 STROKE", 1.6);
      this.UpdateHud();
      this.OnRest();
    }
    return true;
  }

  private OnRest() {
    if (this.State !== Phase.Playing || this.ended) return;
    if (this.strokes >= this.maxStrokes) {
      this.ended = true;
      this.endTimer = 0.8;
      this.UI.Announce("OUT OF STROKES", Pal.hex(0xffc6d0), 1.1);
      Sfx.play(Snd.Deny, 0.7);
    }
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ present

  private Present() {
    this.ball.transform.localPosition = this.pos;
    this.ballShadow.transform.localPosition = this.pos.add(new V2(0.05, -0.07));
    this.ballShadow.color = new Color(0, 0.15, 0, this.sunk ? 0 : 0.35);
    const wave = Math.sin(Time.time * 6);
    this.pole.transform.localPosition = this.holePos.add(new V2(0, 0.55));
    this.flag.transform.localPosition = this.holePos.add(new V2(0.3, 0.92));
    this.flag.transform.localScale = new V3(0.6 * (0.9 + 0.1 * wave), 0.6, 1);
    // fade the flag when the ball is right under it so the cup stays visible
    const near = Mathf.clamp01((this.pos.sub(this.holePos).magnitude - 0.4) / 1.2);
    this.flag.color = new Color(1, 1, 1, 0.35 + 0.65 * near);
    this.pole.color = new Color(1, 1, 1, 0.35 + 0.65 * near);
    for (let i = 0; i < this.bumperSr.length; i++) {
      const t = this.bumperSr[i].transform;
      const s = Mathf.lerp(t.localScale.x, BumperR * 2.1, Time.deltaTime * 10);
      t.localScale = new V3(s, s, 1);
    }
  }

  // ------------------------------------------------------------------ boosters

  private OnGuide() {
    if (this.State !== Phase.Playing || this.ended || this.moving) return;
    if (this.guideArmed) return;
    if (!CasualUI.useOrEarn(() => this.Guides, (v) => (this.Guides = v), this.UI, "+1 GUIDE")) { this.UpdateHud(); return; }
    this.guideArmed = true;
    this.Data.flush();
    Sfx.play(Snd.PowerUp, 0.6);
    this.UI.Toast("GUIDE ON: aim to see the whole path", 2);
    this.UpdateHud();
  }

  private UpdateHud() {
    if (!this.holeText) return;
    CasualUI.setText(this.holeText, `HOLE ${this.level}  ·  PAR ${this.par}`);
    CasualUI.setText(this.strokeText, `${this.holeName}   ·   STROKES ${this.strokes}/${this.maxStrokes}`);
    CasualUI.booster(this.guideButton, "GUIDE", this.Guides, this.State === Phase.Playing && !this.ended, this.guideArmed ? "GUIDE ON" : null);
    if (this.guideArmed) this.guideButton.interactable = false;
  }

  // ------------------------------------------------------------------ results

  private Win() {
    const strokes = this.strokes, par = this.par, diff = strokes - par;
    const stars = strokes === 1 || diff < 0 ? 3 : diff === 0 ? 2 : 1;
    const prev = this.Data.get("s" + this.level);
    if (stars > prev) { this.Data.set("s" + this.level, stars); this.Data.add("stars", stars - prev); }
    this.Data.add("holes", 1);
    if (strokes === 1) this.Data.add("aces", 1);
    this.Data.set("level", Math.max(this.CurrentLevel, this.level + 1));
    const gift = this.level % 4 === 0;
    if (gift) this.Guides = this.Guides + 1;
    const call = strokes === 1 ? "HOLE IN ONE!" : diff <= -2 ? "EAGLE!" : diff === -1 ? "BIRDIE!" : diff === 0 ? "PAR!" : diff === 1 ? "BOGEY" : "SUNK IT!";
    const lvl = this.level;
    this.Finish(new Result({
      Headline: call,
      HeadlineColor: Gold,
      Stars: stars,
      Value: strokes === 1 ? "1 STROKE" : `${strokes} STROKES`,
      BestLine: gift ? "GIFT: +1 GUIDE" : `PAR ${par}   ·   NEXT: HOLE ${lvl + 1}`,
      Stats: [["HOLE", String(lvl)], ["STROKES", String(strokes)], ["PAR", String(par)], ["STARS", String(this.Data.get("stars"))]],
      Primary: "NEXT HOLE",
      Victory: true,
      Reward: () => { this.Guides = this.Guides + 2; this.Data.flush(); this.UI.Toast("+2 GUIDES", 2); },
      RewardLabel: "GET 2 FREE GUIDES (WATCH AD)",
    }));
  }

  private Lose() {
    this.Finish(new Result({
      Headline: "OUT OF STROKES",
      HeadlineColor: Pal.hex(0xffc6d0),
      Value: `HOLE ${this.level}`,
      BestLine: `PAR ${this.par}   ·   ${this.holeName}`,
      Stats: [["HOLE", String(this.level)], ["STROKES", String(this.strokes)], ["PAR", String(this.par)], ["STARS", String(this.Data.get("stars"))]],
      Primary: "TRY AGAIN",
      Reward: this.revives > 0 ? null : () => this.Continue(),
      RewardLabel: "+3 STROKES & CONTINUE (AD)",
    }));
  }

  private Continue() {
    this.revives++;
    this.maxStrokes += 3;
    this.ended = false;
    this.pointer.reset();
    this.Revive();
    this.UpdateHud();
    this.UI.Announce("+3 STROKES", Gold, 1);
  }
}
