import {
  ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject, howTo, Mathf, Pal,
  Phase, Quaternion, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer, Text, TextAnchor, Time, TouchScheme,
  UIKit, V2, V3,
} from "../../kit";
import { SlicedSprite, slicedSpr, SpriteDrawMode } from "./SlicedSprite";

/**
 * SKY STACK: build a skyscraper floor by floor. A crane slides each new floor back and forth; tap to drop it.
 * Whatever hangs over the edge is sliced off and tumbles away, so the tower gets narrower unless you land PERFECT
 * drops (three in a row widen the floor again). The sky changes as you climb from the city to the clouds, the sunset
 * and finally space. A rewarded ad lets you rebuild once after a miss. (Port of SkyStackGame.cs.)
 */

// ------------------------------------------------------------------ tuning

const TopBand = 250, BottomBand = 60;
const FloorH = 0.9, StartW = 4.2, Perfect = 0.09;
const MaxFloors = 64, MaxChunks = 12;

const Ink = Pal.hex(0x1e2a44), Gold = Pal.hex(0xffc93c);
const SkyLow = [Pal.hex(0x9ed8ff), Pal.hex(0xbfe6ff), Pal.hex(0xffb38a), Pal.hex(0x3b2f6b), Pal.hex(0x0c1230)];
const SkyHigh = [Pal.hex(0x4aa8f0), Pal.hex(0x7ec4f5), Pal.hex(0xff7a70), Pal.hex(0x1c1946), Pal.hex(0x05081a)];
const SkyAt = [0, 40, 90, 140, 200]; // world height of each sky stage

class Floor {
  Wall!: SlicedSprite; Windows!: SlicedSprite; Roof!: SlicedSprite;
  X = 0; W = 0; Y = 0;
  Color = Color.white;
  Land = 0; // landing squash timer
  Active = false;
}

class Chunk {
  constructor(public Wall: SlicedSprite, public Windows: SlicedSprite) {}
  Pos = V2.zero; Vel = V2.zero;
  Rot = 0; Spin = 0; W = 0;
  Active = false;
}

// ------------------------------------------------------------------ art

const WallSprite = () => CasualArt.make("st-wall", 128, 128, (p) => {
  const px = 2 / 128;
  const d = CasualArt.sdBox(p, new V2(0.98, 0.98), 0.18);
  const a = CasualArt.fill(d, px);
  let c = Color.lerp(new Color(0.82, 0.82, 0.82, 1), Color.white, CasualArt.smooth(-1, 0.6, p.y));
  const edge = CasualArt.fill(d + 0.06, px);
  c = Color.lerp(new Color(0.6, 0.6, 0.6, 1), c, edge);
  return c.withAlpha(a);
}, 24, 128);

const WindowTile = () => CasualArt.make("st-window", 64, 64, (p) => {
  const px = 2 / 64;
  const d = CasualArt.sdBox(p, new V2(0.55, 0.62), 0.12);
  let glass = Color.lerp(Pal.hex(0x9fd8ff), Pal.hex(0xe6f6ff), CasualArt.smooth(-0.6, 0.6, p.y + p.x * 0.4));
  const shine = CasualArt.smooth(0.08, 0, Math.abs(p.x + p.y * 0.6 + 0.15));
  glass = Color.lerp(glass, Color.white, shine * 0.6);
  const frame = Pal.hex(0x51607a);
  const c = Color.lerp(frame, glass, CasualArt.fill(d + 0.07, px));
  return c.withAlpha(CasualArt.fill(d, px));
}, 0, 128);

const LitWindowTile = () => CasualArt.make("st-window-lit", 64, 64, (p) => {
  const px = 2 / 64;
  const d = CasualArt.sdBox(p, new V2(0.55, 0.62), 0.12);
  const glass = Color.lerp(Pal.hex(0xffd36a), Pal.hex(0xfff2b8), CasualArt.smooth(-0.6, 0.6, p.y));
  const frame = Pal.hex(0x51607a);
  const c = Color.lerp(frame, glass, CasualArt.fill(d + 0.07, px));
  return c.withAlpha(CasualArt.fill(d, px));
}, 0, 128);

const RoofSprite = () => CasualArt.make("st-roof", 128, 32, (p) => {
  const px = 2 / 128;
  const d = CasualArt.sdBox(p, new V2(0.99, 0.2), 0.08);
  const c = Color.lerp(new Color(0.55, 0.55, 0.6, 1), new Color(0.85, 0.86, 0.9, 1), CasualArt.smooth(-0.2, 0.2, p.y));
  return c.withAlpha(CasualArt.fill(d, px));
}, [12, 0, 12, 0], 128);

const Cloud = (v: number) => CasualArt.make("st-cloud-" + v, 256, 128, (p) => {
  let d = 9;
  for (let i = 0; i < 5; i++) {
    const x = -0.6 + i * 0.3 + (v === 1 ? 0.05 : 0);
    const r = 0.18 + 0.12 * Math.sin(i * 1.7 + v * 2) + (i === 2 ? 0.12 : 0);
    d = Math.min(d, CasualArt.sdCircle(p, new V2(x, -0.1 + r * 0.4), r));
  }
  d = Math.min(d, CasualArt.sdBox(p.sub(new V2(0, -0.2)), new V2(0.72, 0.12), 0.12));
  const c = Color.lerp(new Color(0.86, 0.9, 0.97, 1), Color.white, CasualArt.smooth(-0.3, 0.3, p.y));
  return c.withAlpha(CasualArt.fill(d, 2 / 256) * 0.95);
});

/** C# float math for the hash-like Repeat(Sin(x) * big) patterns. */
const f32 = Math.fround;

const SkylineSprite = () => CasualArt.make("st-skyline", 512, 128, (p) => {
  // silhouettes of distant buildings
  const x = p.x * 12;
  const cell = Math.floor(x);
  const h = 0.05 + Mathf.repeat(f32(f32(Math.sin(cell * 12.9898)) * 43758.5), 1) * 0.18;
  const back = 0.02 + Mathf.repeat(f32(f32(Math.sin(Math.floor(x * 0.7 + 3) * 78.233)) * 12345.6), 1) * 0.2;
  let c = new Color(1, 1, 1, 0);
  if (p.y < -0.25 + back) c = new Color(0.62, 0.72, 0.86, 1);
  if (p.y < -0.25 + h) c = new Color(0.47, 0.58, 0.76, 1);
  return c;
});

const GroundSprite = () => CasualArt.make("st-ground", 256, 64, (p) => {
  const y = p.y / 0.25;
  let c = y > 0.6 ? Color.lerp(Pal.hex(0x7fcf66), Pal.hex(0x9be07c), CasualArt.smooth(0.6, 1, y)) : Pal.hex(0x8a6a4a);
  if (y <= 0.6 && y > 0.4) c = Pal.hex(0x6cb55a);
  const n = Mathf.perlinNoise(p.x * 20, p.y * 20);
  c = Color.lerp(c, CasualArt.darken(c, 0.15), n * 0.4);
  return c.withAlpha(1);
});

const HookSprite = () => CasualArt.make("st-hook", 64, 64, (p) => {
  const px = 2 / 64;
  const d = Math.min(CasualArt.sdBox(p.sub(new V2(0, 0.35)), new V2(0.5, 0.28), 0.1),
    Math.abs(CasualArt.sdCircle(p, new V2(0, -0.35), 0.32)) - 0.09);
  const c = Color.lerp(Pal.hex(0xffb627), Pal.hex(0xe08a10), CasualArt.smooth(0.5, -0.5, p.y));
  return c.withAlpha(CasualArt.fill(d, px));
});

export class SkyStackGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject;
  private sky!: SpriteRenderer; private ground!: SpriteRenderer; private skyline!: SpriteRenderer;
  private hook!: SpriteRenderer; private cable!: SpriteRenderer; private sun!: SpriteRenderer;
  private readonly clouds: SpriteRenderer[] = [];
  private readonly stars: SpriteRenderer[] = [];
  private readonly floors: Floor[] = [];
  private readonly chunks: Chunk[] = [];
  private moving!: Floor;
  private fx!: CasualFx;
  private readonly pointer = new TapPointer();
  private rng = new SysRandom();

  private count = 0; private score = 0; private perfectStreak = 0; private residents = 0;
  private camY = 0; private moveDir = 1; private moveSpeed = 0; private swingRange = 0; private groundY = 0;
  private failTimer = 0; private baseHue = 0; private attractTimer = 0;
  private dropping = false; private failing = false; private revived = false;
  private dropVel = 0;

  // HUD
  private scoreText!: Text; private comboText!: Text; private peopleText!: Text;

  private dropClip!: AudioClip; private perfectClip!: AudioClip; private cutClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "skystack",
      Title: "SKY STACK",
      Tagline: "STACK THE FLOORS. TOUCH THE STARS.",
      Accent: Pal.hex(0x3f8cff),
      Accent2: Gold,
      BgTop: Pal.hex(0x4aa8f0),
      BgBottom: Pal.hex(0x9ed8ff),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 110, rootHz: 123.5, degrees: [0, 4, 5, 3], seed: 91, energy: 0.5, major: true },
      Reminders: [
        "The crane is waiting|How high can your tower go today?",
        "The city needs a new skyline|Stack floors and reach the clouds.",
        "Next stop: outer space|Beat your highest tower.",
      ],
      HowTo: [
        howTo(Art.Square, Pal.hex(0x3f8cff), "TAP to drop the floor the crane is carrying."),
        howTo(Art.Chevron, Pal.hex(0xff8a30), "Anything hanging over the edge is SLICED off: the tower gets narrower."),
        howTo(Art.Star, Gold, "Land it exactly on top for a PERFECT. Three perfects in a row make the floor wider!"),
        howTo(Art.Diamond, Pal.Danger, "Miss the tower completely and the game is over."),
        howTo(Art.Ring, Pal.hex(0x9ed8ff), "Climb through the clouds, the sunset and into space."),
      ],
      Tips: [
        "Watch the edge of the tower, not the moving floor.",
        "Tap a tiny bit early: the floor needs a moment to fall.",
        "A narrow tower is hard - chase perfects to widen it.",
        "The crane gets faster the higher you go.",
        "Find a rhythm and count the swings.",
      ],
    });
  }

  protected get ShortSide() { return Screen.width > Screen.height ? 11 : 9; }

  protected BestLine() {
    const best = this.Data.get("best");
    return best > 0 ? `BEST TOWER: ${best} FLOORS` : "BUILD THE TALLEST TOWER!";
  }

  protected StatsLine() { return `${Fmt.n(this.Data.get("perfects"))} PERFECT DROPS   ·   ${Fmt.n(this.Data.get("people"))} RESIDENTS HOUSED`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("StackWorld", this.gameObject);
    CasualLook.calm(this, 1.2, 0.16);
    this.sky = Art.spr(this.world, "Sky", CasualArt.gradient(Color.white, new Color(0.82, 0.86, 0.92, 1)), Color.white, 1, -950, Art.Flat);
    this.sun = Art.spr(this.world, "Sun", CasualArt.Soft, new Color(1, 0.95, 0.75, 0.9), 6, -940, Art.Flat);
    for (let i = 0; i < 40; i++) {
      const s = Art.spr(this.world, "Star", CasualArt.StarShape, Color.white, 0.12 + this.rng.nextDouble() * 0.12, -935, Art.Flat);
      this.stars.push(s);
    }
    for (let i = 0; i < 6; i++) this.clouds.push(Art.spr(this.world, "Cloud", Cloud(i % 2), Color.white, 4, -920 + i, Art.Flat));
    this.skyline = Art.spr(this.world, "Skyline", SkylineSprite(), Color.white, 1, -925, Art.Flat);
    this.ground = Art.spr(this.world, "Ground", GroundSprite(), Color.white, 1, -900, Art.Flat);

    for (let i = 0; i < MaxFloors; i++) this.floors.push(this.NewFloor(10));
    for (let i = 0; i < MaxChunks; i++) {
      const f = this.NewFloor(30);
      this.chunks.push(new Chunk(f.Wall, f.Windows));
      f.Roof.gameObject.setActive(false);
    }
    this.moving = this.NewFloor(20);
    this.cable = Art.spr(this.world, "Cable", Art.Square, Pal.hex(0x2f3a50), 1, 19, Art.Flat);
    this.hook = Art.spr(this.world, "Hook", HookSprite(), Color.white, 0.6, 21, Art.Flat);

    this.fx = CasualFx.create(this.world, 60, 200);
    let lp = 0;
    const noise = new SysRandom(4);
    this.dropClip = Sfx.make("st-drop", 0.25, (t) => { lp += (noise.nextDouble() * 2 - 1 - lp) * 0.25; return (Sfx.sinP(Sfx.glide(t, 180, 90, 0.18)) * 0.6 + lp * 0.5) * Sfx.env(t, 0.002, 0.2) * 0.5; });
    this.perfectClip = Sfx.make("st-perfect", 0.35, (t) => (Sfx.sinP(880 * t) * Sfx.env(t, 0.003, 0.25) + Sfx.sinP(1318.5 * t) * Sfx.env(t - 0.05, 0.003, 0.28)) * 0.2);
    this.cutClip = Sfx.make("st-cut", 0.2, (t) => ((noise.nextDouble() * 2 - 1) * 0.5 + Sfx.sawP(Sfx.glide(t, 600, 200, 0.15)) * 0.2) * Sfx.env(t, 0.002, 0.15) * 0.3);

    const hud = this.UI.Hud;
    this.scoreText = UIKit.at(UIKit.label(hud, "0", 120, Color.white), new V2(0.5, 1), new V2(0, -110), new V2(500, 140));
    UIKit.glow(this.scoreText, Ink.withAlpha(0.6), 5);
    this.comboText = UIKit.at(UIKit.label(hud, "", 40, Gold), new V2(0.5, 1), new V2(0, -205), new V2(600, 50));
    UIKit.glow(this.comboText, Ink.withAlpha(0.6), 3);
    this.peopleText = UIKit.at(UIKit.label(hud, "", 26, Color.white, TextAnchor.MiddleLeft), new V2(0, 1), new V2(170, -80), new V2(300, 40));
    UIKit.glow(this.peopleText, Ink.withAlpha(0.6), 2);
    if (this.UI.TitleExtra) CasualLook.titleCard(this.UI, new Color(0.12, 0.2, 0.38, 0.82));
    this.Layout();
  }

  private NewFloor(order: number) {
    const f = new Floor();
    f.Wall = slicedSpr(this.world, "Wall", WallSprite(), Color.white, 1, order, Art.Flat);
    f.Wall.drawMode = SpriteDrawMode.Sliced;
    f.Windows = slicedSpr(this.world, "Windows", WindowTile(), Color.white, 1, order + 1, Art.Flat);
    f.Windows.drawMode = SpriteDrawMode.Tiled;
    f.Roof = slicedSpr(this.world, "Roof", RoofSprite(), Color.white, 1, order + 2, Art.Flat);
    f.Roof.drawMode = SpriteDrawMode.Sliced;
    SkyStackGame.Show(f, false);
    return f;
  }

  private static Show(f: Floor, on: boolean) {
    f.Wall.gameObject.setActive(on);
    f.Windows.gameObject.setActive(on);
    f.Roof.gameObject.setActive(on);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.PlayRect(TopBand, BottomBand, 0);
    this.groundY = -this.ViewSize.y * 0.5 + 1.4;
    this.swingRange = Math.min(this.ViewSize.x * 0.5 - 0.3, 6);
    this.sky.transform.localScale = new V3(this.ViewSize.x * 1.2 + 2, (this.ViewSize.y * 1.2 + 2) / 4, 1);
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.ResetTower();
    this.attractTimer = 0.6;
  }

  private ResetTower() {
    this.Layout();
    for (const f of this.floors) { f.Active = false; SkyStackGame.Show(f, false); }
    for (const c of this.chunks) { c.Active = false; c.Wall.gameObject.setActive(false); c.Windows.gameObject.setActive(false); }
    this.fx.clear();
    this.count = 0;
    this.baseHue = this.rng.nextDouble();
    // the ground floor (lobby)
    const b = this.floors[0];
    b.Active = true;
    b.X = 0;
    b.W = StartW;
    b.Y = this.groundY;
    b.Color = this.FloorColor(0);
    this.count = 1;
    this.camY = 0;
    this.dropping = this.failing = false;
    this.perfectStreak = 0;
    this.PrepareNext();
    this.PlaceAll(0);
  }

  private FloorColor(i: number) { return Color.HSVToRGB(Mathf.repeat(this.baseHue + i * 0.035, 1), 0.42, 0.98); }

  protected BeginRun() {
    this.rng = new SysRandom();
    this.ResetTower();
    this.score = 0;
    this.residents = 0;
    this.revived = false;
    this.pointer.reset();
    this.pointer.topBand = 0.05;
    this.comboText.text = "";
    if (this.Data.get("runs") === 0) this.UI.Hint("Tap to drop the floor right on top of the tower!");
    this.Data.add("runs", 1);
    Sfx.setIntensity(0.3);
    this.UpdateHud();
  }

  private get Top() { return this.floors[(this.count - 1) % MaxFloors]; }

  private PrepareNext() {
    const top = this.Top;
    const moving = this.moving;
    moving.W = top.W;
    moving.Color = this.FloorColor(this.count);
    this.moveDir = this.rng.next(2) === 0 ? 1 : -1;
    moving.X = -this.moveDir * this.swingRange;
    moving.Y = top.Y + FloorH + 1.6;
    this.moveSpeed = Math.min(9, 3.2 + this.count * 0.09);
    moving.Land = 0;
    SkyStackGame.Show(moving, true);
    this.dropping = false;
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Simulate(dt, false);
    if (this.State !== Phase.Title || this.failing) return;
    // attract: the crane drops floors near the middle on its own
    if (!this.dropping && Math.abs(this.moving.X - this.Top.X) < 0.15 + this.rng.nextDouble() * 0.2) {
      this.attractTimer -= dt;
      if (this.attractTimer <= 0) { this.Drop(); this.attractTimer = 0.3; }
    }
    if (this.count > 26) this.ResetTower();
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    if (this.failing) {
      this.failTimer += dt;
      this.Simulate(dt, true);
      if (this.failTimer > 1.3 && this.State === Phase.Playing) this.Lose();
      return;
    }
    if ((this.pointer.down || this.Controls.actionPressed) && !this.dropping) this.Drop();
    this.Simulate(dt, true);
    this.UpdateHud();
  }

  private Drop() {
    this.dropping = true;
    this.dropVel = 0;
    this.UI.Hint(null);
  }

  private Simulate(dt: number, real: boolean) {
    const moving = this.moving;
    if (!this.failing) {
      if (!this.dropping) {
        moving.X += this.moveDir * this.moveSpeed * dt;
        if (moving.X > this.swingRange) { moving.X = this.swingRange; this.moveDir = -1; }
        if (moving.X < -this.swingRange) { moving.X = -this.swingRange; this.moveDir = 1; }
      } else {
        this.dropVel += 40 * dt;
        moving.Y -= this.dropVel * dt;
        const target = this.Top.Y + FloorH;
        if (moving.Y <= target) {
          moving.Y = target;
          this.Land(real);
        }
      }
    }

    for (const c of this.chunks) {
      if (!c.Active) continue;
      c.Vel = c.Vel.withY(c.Vel.y - 22 * dt);
      c.Pos = c.Pos.add(c.Vel.mul(dt));
      c.Rot += c.Spin * dt;
      if (c.Pos.y < this.camY - this.ViewSize.y) { c.Active = false; c.Wall.gameObject.setActive(false); c.Windows.gameObject.setActive(false); }
    }

    const targetCam = Math.max(0, this.Top.Y + FloorH * 2.5 - (this.groundY + this.ViewSize.y * 0.45));
    this.camY = Mathf.lerp(this.camY, targetCam, 1 - Math.exp(-dt * 4));
    this.PlaceAll(dt);
  }

  private Land(real: boolean) {
    const top = this.Top, moving = this.moving;
    const left = Math.max(moving.X - moving.W * 0.5, top.X - top.W * 0.5);
    const right = Math.min(moving.X + moving.W * 0.5, top.X + top.W * 0.5);
    const overlap = right - left;
    if (overlap <= 0.02) {
      // missed: the whole floor tumbles
      this.SpawnChunk(moving.X, moving.W, moving.Y, moving.Color, moving.X > top.X ? 1 : -1);
      SkyStackGame.Show(moving, false);
      Sfx.playClip(this.cutClip, 0.8, 0.8);
      if (!real) { this.ResetTower(); return; }
      this.failing = true;
      this.failTimer = 0;
      this.Fx.shake(0.3);
      Fx.haptic(true);
      this.UI.Announce("MISSED!", Pal.Danger, 1.1);
      Sfx.play(Snd.Lose, 0.7);
      return;
    }
    const perfect = Math.abs(moving.X - top.X) <= Perfect;
    let newX: number, newW: number;
    if (perfect) {
      newX = top.X;
      newW = top.W;
      this.perfectStreak++;
      if (this.perfectStreak >= 3) newW = Math.min(StartW, newW + 0.18);
      Sfx.playClip(this.perfectClip, 0.8, 1 + Math.min(this.perfectStreak, 8) * 0.06);
      this.fx.sparkle(new V2(newX, moving.Y + FloorH * 0.5), Color.white, 8, newW * 0.5, 0.3);
      if (real) {
        this.Data.add("perfects", 1);
        this.comboText.text = this.perfectStreak >= 2 ? `PERFECT x${this.perfectStreak}!` : "PERFECT!";
        Fx.haptic();
      }
    } else {
      this.perfectStreak = 0;
      newX = (left + right) * 0.5;
      newW = overlap;
      // slice off the overhang
      const cutW = moving.W - overlap;
      const cutX = moving.X > top.X ? right + cutW * 0.5 : left - cutW * 0.5;
      this.SpawnChunk(cutX, cutW, moving.Y, moving.Color, moving.X > top.X ? 1 : -1);
      Sfx.playClip(this.cutClip, 0.6);
      if (real) this.comboText.text = "";
    }
    Sfx.playClip(this.dropClip, real ? 0.8 : 0.3, 0.9 + this.rng.nextDouble() * 0.2);
    const f = this.floors[this.count % MaxFloors];
    f.Active = true;
    f.X = newX;
    f.W = newW;
    f.Y = moving.Y;
    f.Color = moving.Color;
    f.Land = 1;
    this.count++;
    this.fx.pop(new V2(newX, f.Y - FloorH * 0.5), new Color(0.9, 0.9, 0.95, 0.8), 6, 2, 0.2, 0.3);
    if (real) {
      this.score++;
      const people = 10 + this.rng.next(30);
      this.residents += people;
      if (this.score % 25 === 0) { this.UI.Announce(SkyStackGame.AltitudeName(this.score), Gold, 1.4); Sfx.play(Snd.PowerUp, 0.5); }
    }
    this.PrepareNext();
  }

  private static AltitudeName(floorsBuilt: number) {
    return floorsBuilt >= 200 ? "DEEP SPACE!" : floorsBuilt >= 140 ? "REACHED SPACE!" : floorsBuilt >= 90 ? "SUNSET SKY!" : floorsBuilt >= 40 ? "ABOVE THE CLOUDS!" : floorsBuilt + " FLOORS!";
  }

  private SpawnChunk(x: number, w: number, y: number, color: Color, side: number) {
    for (const c of this.chunks) {
      if (c.Active) continue;
      c.Active = true;
      c.Pos = new V2(x, y + FloorH * 0.5);
      c.W = w;
      c.Vel = new V2(side * (1.5 + this.rng.nextDouble()), 1.5);
      c.Rot = 0;
      c.Spin = -side * (90 + this.rng.nextDouble() * 120);
      c.Wall.color = color;
      c.Wall.size = new V2(w, FloorH);
      c.Windows.size = new V2(Math.max(0.01, w - 0.25), FloorH * 0.55);
      c.Wall.gameObject.setActive(true);
      c.Windows.gameObject.setActive(w > 0.35);
      return;
    }
  }

  // ------------------------------------------------------------------ presentation

  private PlaceAll(dt: number) {
    const camY = this.camY, ViewSize = this.ViewSize;
    this.Fx.CameraTarget = new V2(0, camY);
    const alt = camY;
    // sky colour by altitude
    let stage = 0;
    while (stage < SkyAt.length - 1 && alt > SkyAt[stage + 1] * FloorH) stage++;
    const k = stage < SkyAt.length - 1 ? Mathf.inverseLerp(SkyAt[stage] * FloorH, SkyAt[stage + 1] * FloorH, alt) : 1;
    const next = Math.min(stage + 1, SkyAt.length - 1);
    const low = Color.lerp(SkyLow[stage], SkyLow[next], k), high = Color.lerp(SkyHigh[stage], SkyHigh[next], k);
    this.sky.color = Color.lerp(low, high, 0.5);
    this.sky.transform.localPosition = new V3(0, camY, 0);
    const space = Mathf.inverseLerp(120 * FloorH, 170 * FloorH, alt);
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      const sx = Mathf.repeat(i * 0.6180339, 1) * ViewSize.x - ViewSize.x * 0.5;
      const sy = Mathf.repeat(i * 0.381966 + 0.3, 1) * ViewSize.y - ViewSize.y * 0.5;
      s.transform.localPosition = new V3(sx, camY + sy, 0);
      s.color = new Color(1, 1, 1, space * (0.5 + 0.5 * Math.sin(Time.time * 2 + i)));
    }
    this.sun.transform.localPosition = new V3(ViewSize.x * 0.28, camY + ViewSize.y * 0.32 - alt * 0.02, 0);
    this.sun.color = Color.lerp(new Color(1, 0.97, 0.8, 0.9), new Color(1, 0.6, 0.45, 0.9), Mathf.inverseLerp(60, 110, alt / FloorH)).mul(new Color(1, 1, 1, 1 - space));

    // clouds drift, appear around the cloud layer
    const cloudBand = 40 * FloorH;
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      const y = cloudBand + (i - 2.5) * 2.6;
      const x = Mathf.repeat(i * 3.7 + Time.time * (0.3 + i * 0.08), ViewSize.x + 8) - ViewSize.x * 0.5 - 4;
      c.transform.localPosition = new V3(x, y + (i % 2) * 1.2, 0);
      const vis = 1 - Mathf.clamp01(Math.abs(alt - cloudBand) / (ViewSize.y * 1.2));
      c.color = new Color(1, 1, 1, 0.35 + vis * 0.6);
    }
    this.skyline.transform.localScale = new V3(ViewSize.x + 2, ViewSize.x + 2, 1);
    this.skyline.transform.localPosition = new V3(0, this.groundY + (ViewSize.x + 2) * 0.125 - 0.05 + camY * 0.4, 0);
    this.ground.transform.localScale = new V3(ViewSize.x + 2, 3 / 0.25, 1);
    this.ground.transform.localPosition = new V3(0, this.groundY - 1.45, 0);

    const windows = alt > 95 * FloorH ? LitWindowTile() : WindowTile();
    const moving = this.moving;
    moving.Windows.sprite = windows;
    for (const f of this.floors) {
      if (!f.Active) { if (f.Wall.gameObject.activeSelf) SkyStackGame.Show(f, false); continue; }
      if (f.Windows.sprite !== windows) f.Windows.sprite = windows;
      SkyStackGame.Show(f, true);
      f.Land = Mathf.moveTowards(f.Land, 0, dt * 5);
      this.PlaceFloor(f, f.X, f.Y, f.W, f.Land);
    }
    if (moving.Wall.gameObject.activeSelf) {
      this.PlaceFloor(moving, moving.X, moving.Y, moving.W, 0);
      const top = camY + ViewSize.y * 0.5 + 0.5;
      const cy = moving.Y + FloorH * 0.5;
      const showCrane = !this.dropping && !this.failing;
      this.cable.gameObject.setActive(showCrane);
      this.hook.gameObject.setActive(showCrane);
      if (showCrane) {
        this.cable.transform.localScale = new V3(0.06, Math.max(0.1, top - cy), 1);
        this.cable.transform.localPosition = new V3(moving.X, (top + cy) * 0.5, 0);
        this.hook.transform.localPosition = new V3(moving.X, cy + 0.15, 0);
      }
    } else {
      this.cable.gameObject.setActive(false);
      this.hook.gameObject.setActive(false);
    }

    for (const c of this.chunks) {
      if (!c.Active) continue;
      c.Wall.transform.localPosition = new V3(c.Pos.x, c.Pos.y, 0);
      c.Wall.transform.localRotation = Quaternion.euler(0, 0, c.Rot);
      c.Windows.transform.localPosition = c.Wall.transform.localPosition;
      c.Windows.transform.localRotation = c.Wall.transform.localRotation;
    }
  }

  private PlaceFloor(f: Floor, x: number, y: number, w: number, land: number) {
    const squash = 1 - land * 0.12;
    const h = FloorH * squash;
    const cy = y + h * 0.5;
    f.Wall.color = f.Color;
    f.Wall.size = new V2(w, h);
    f.Wall.transform.localPosition = new V3(x, cy, 0);
    const ww = Math.max(0.01, w - 0.25);
    f.Windows.size = new V2(ww, h * 0.55);
    f.Windows.transform.localPosition = new V3(x, cy - h * 0.04, 0);
    f.Windows.gameObject.setActive(w > 0.35);
    f.Roof.size = new V2(w + 0.12, 0.16);
    f.Roof.transform.localPosition = new V3(x, y + h - 0.02, 0);
  }

  private UpdateHud() {
    SkyStackGame.SetText(this.scoreText, String(this.score));
    SkyStackGame.SetText(this.peopleText, this.residents > 0 ? `${Fmt.n(this.residents)} RESIDENTS` : "");
  }

  private static SetText(t: Text | null, s: string) {
    if (t && t.text !== s) t.text = s;
  }

  // ------------------------------------------------------------------ results

  private Lose() {
    const newBest = this.Data.max("best", this.score);
    this.Data.add("people", this.residents);
    this.Finish(new Result({
      Headline: newBest ? "NEW RECORD TOWER!" : "THE TOWER IS DONE",
      HeadlineColor: newBest ? Gold : Pal.hex(0xd6e6ff),
      Value: String(this.score),
      CountTo: this.score,
      NewBest: newBest,
      BestLine: this.score >= 40 ? SkyStackGame.AltitudeName(this.score) : `${this.score} FLOORS HIGH`,
      Stats: [
        ["FLOORS", String(this.score)],
        ["RESIDENTS", Fmt.n(this.residents)],
        ["PERFECTS", String(this.Data.get("perfects"))],
        ["BEST", String(this.Data.get("best"))],
      ],
      Primary: "BUILD AGAIN",
      Reward: this.revived ? null : () => this.Rebuild(),
      RewardLabel: "KEEP BUILDING (WATCH AD)",
    }));
  }

  private Rebuild() {
    this.revived = true;
    this.failing = false;
    // the next floor is as wide as the last good one
    this.PrepareNext();
    this.pointer.reset();
    this.Revive();
    this.UI.Announce("KEEP GOING!", Pal.hex(0x3f8cff), 1.1);
    Sfx.play(Snd.PowerUp);
  }
}
