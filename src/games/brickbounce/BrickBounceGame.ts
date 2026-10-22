import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, CasualUI, Color, Fmt, GameInfo, GameObject,
  howTo, Mathf, Pal, Phase, Rect, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer, Text, TextAnchor,
  TouchScheme, UIKit, V2, V3,
} from "../../kit";

/**
 * BRICK BOUNCE: turn-based ball brick breaker. Drag to aim, let go to fire your whole stream of balls. Every hit
 * takes one point off a brick; bricks at zero break. After each turn the bricks move down a row and a new row
 * arrives. Collect +1 rings for more balls. If a brick reaches the bottom, the game is over; a rewarded ad can
 * clear the three lowest rows once. A 2× button speeds up long turns. (Port of BrickBounceGame.cs.)
 */

const TopBand = 230, BottomBand = 130;
const Cols = 7, Rows = 10;
const BallR = 0.13, BallSpeed = 17, FireGap = 0.065;

const Ink = Pal.hex(0x2c2350), Gold = Pal.hex(0xffc93c), Pink = Pal.hex(0xff5c9a), Sky = Pal.hex(0x4da6ff);
const Heat = [Pal.hex(0xffd23f), Pal.hex(0xff9a2e), Pal.hex(0xff5c5c), Pal.hex(0xff4fa3), Pal.hex(0xb65cff), Pal.hex(0x5c6cff), Pal.hex(0x2eb8e8), Pal.hex(0x2ed196)];

class Brick {
  Hp = 0; Col = 0; Row = 0;
  Ring = false; Active = false;
  Sr!: SpriteRenderer;
  readonly Digits: SpriteRenderer[] = [];
  Hit = 0; Y = 0; TargetY = 0;
}

class Ball {
  Sr!: SpriteRenderer;
  Pos = V2.zero; Vel = V2.zero;
  Active = false; Returning = false;
  Delay = 0;
}

/** System.Random(seed).NextDouble(): a fresh seeded generator per sample (white noise). */
const noiseAt = (seed: number) => new SysRandom(seed).nextDouble();

// ------------------------------------------------------------------ art

const BrickSprite = () => CasualArt.make("bb2-brick", 96, 96, (p) => {
  const px = 2 / 96;
  const d = CasualArt.sdBox(p, new V2(0.92, 0.92), 0.22);
  let c = Color.lerp(new Color(0.82, 0.82, 0.82, 1), Color.white, CasualArt.smooth(-0.9, 0.9, p.y - p.x * 0.2));
  c = Color.lerp(new Color(0.62, 0.62, 0.62, 1), c, CasualArt.fill(d + 0.1, px));
  const hl = CasualArt.smooth(0.25, 0, Math.abs(p.y - 0.62)) * CasualArt.smooth(0.85, 0.5, Math.abs(p.x));
  c = Color.lerp(c, Color.white, hl * 0.35);
  return c.withAlpha(CasualArt.fill(d, px));
});

const RingSprite = () => CasualArt.make("bb2-ring", 96, 96, (p) => {
  const px = 2 / 96;
  const d = Math.abs(p.magnitude - 0.68) - 0.12;
  let c = new Color(1, 1, 1, 0);
  c = CasualArt.over(c, Pal.hex(0xffc93c), CasualArt.fill(d, px));
  const plus = Math.min(CasualArt.sdBox(p, new V2(0.3, 0.07), 0.04), CasualArt.sdBox(p, new V2(0.07, 0.3), 0.04));
  c = CasualArt.over(c, Color.white, CasualArt.fill(plus, px));
  return c;
});

// segments on a 0.9 x 1.4 box: a top, b top-right, c bottom-right, d bottom, e bottom-left, f top-left, g middle
const DigitMasks = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
const DW = 0.5, DH = 1.15, DT = 0.27;
const Seg: [V2, V2][] = [
  [new V2(-DW, DH), new V2(DW, DH)], [new V2(DW, DH), new V2(DW, 0)], [new V2(DW, 0), new V2(DW, -DH)],
  [new V2(-DW, -DH), new V2(DW, -DH)], [new V2(-DW, 0), new V2(-DW, -DH)], [new V2(-DW, DH), new V2(-DW, 0)], [new V2(-DW, 0), new V2(DW, 0)],
];

/** Rounded seven-segment digits (white), for the brick numbers. */
const Digit = (d: number) => CasualArt.make("bb2-digit-" + d, 48, 80, (p) => {
  const m = DigitMasks[d];
  let dist = 9;
  for (let i = 0; i < 7; i++) if ((m & (1 << i)) !== 0) dist = Math.min(dist, CasualArt.sdSegment(p, Seg[i][0], Seg[i][1]));
  const px = 2 / 48;
  let c = new Color(1, 1, 1, 0);
  c = CasualArt.over(c, new Color(0.1, 0.08, 0.2, 0.55), CasualArt.fill(dist - DT - 0.08, px));
  c = CasualArt.over(c, Color.white, CasualArt.fill(dist - DT, px));
  return c;
});

const Backdrop = () => CasualArt.make("bb2-bg", 128, 256, (p) => {
  let c = Color.lerp(Pal.hex(0x4b3a8a), Pal.hex(0x2c2350), CasualArt.smooth(-2, 2, p.y));
  const glow = CasualArt.smooth(1.2, 0, p.sub(new V2(0.3, 1.5)).magnitude);
  c = Color.lerp(c, Pal.hex(0x7a5cc8), glow * 0.4);
  return c.withAlpha(1);
});

const FieldSprite = () => CasualArt.make("bb2-field", 64, 64, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.98, 0.98), 0.08);
  return new Color(0.08, 0.06, 0.18, CasualArt.fill(d, 2 / 64) * 0.55);
});

export class BrickBounceGame extends ArcadeGame {
  private world!: GameObject;
  private bgCover!: SpriteRenderer; private field!: SpriteRenderer; private launcher!: SpriteRenderer;
  private readonly aimDots: SpriteRenderer[] = [];
  private readonly bricks: Brick[] = [];
  private readonly balls: Ball[] = [];
  private fx!: CasualFx;
  private readonly pointer = new TapPointer();
  private rng = new SysRandom();

  private area = new Rect();
  private cell = 0; private launchX = 0; private nextLaunchX = 0; private turnTime = 0; private endTimer = 0; private attractTimer = 0;
  private turn = 0; private ballCount = 0; private score = 0; private inFlight = 0; private toFire = 0; private best = 0;
  private firing = false; private aiming = false; private ended = false; private revived = false; private firstBack = false; private speedUp = false;
  private aimDir = V2.up;
  private fireTimer = 0;

  private turnText!: Text; private ballText!: Text; private bestText!: Text;
  private speedButton!: ArcadeButton;
  private hitClip!: AudioClip; private breakClip!: AudioClip; private fireClip!: AudioClip; private ringClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "brickbounce",
      Title: "BRICK BOUNCE",
      Tagline: "AIM. FIRE. BREAK EVERY BRICK.",
      Accent: Pink,
      Accent2: Gold,
      BgTop: Pal.hex(0x2c2350),
      BgBottom: Pal.hex(0x4b3a8a),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 118, rootHz: 110, degrees: [0, 5, 3, 4], seed: 33, energy: 0.55, major: true },
      Reminders: [
        "The bricks are coming down|Fire your balls and break them all!",
        "How many balls can you collect?|Beat your best Brick Bounce score.",
        "One more turn?|The perfect angle is waiting.",
      ],
      HowTo: [
        howTo(Art.Chevron, Sky, "DRAG to aim (the dotted line shows the path), LET GO to fire all your balls."),
        howTo(Art.Square, Heat[2], "Every hit takes 1 off a brick's number. At 0 the brick breaks."),
        howTo(Art.Ring, Gold, "Hit a +1 RING to get an extra ball for every next turn."),
        howTo(Art.Diamond, Pal.Danger, "The bricks move down each turn. If one reaches the bottom, it's game over."),
        howTo(Art.Star, Pink, "Press 2× to speed up a long turn."),
      ],
      Tips: [
        "Bounce balls into the gaps so they rattle around above the bricks.",
        "Aim for +1 rings early: more balls means more damage.",
        "Shallow angles hit many bricks from the side.",
        "Clear the bricks closest to the bottom first.",
        "The first ball back decides where you fire from next.",
      ],
    });
  }

  protected get ShortSide() { return Screen.width > Screen.height ? 11 : 8.6; }
  protected BestLine() { const b = this.Data.get("best"); return b > 0 ? `BEST: ${b} TURNS` : "HOW MANY TURNS CAN YOU LAST?"; }
  protected StatsLine() { return `${Fmt.n(this.Data.get("bricks"))} BRICKS BROKEN   ·   ${this.Data.get("games")} GAMES`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("BrickWorld", this.gameObject);
    const world = this.world;
    CasualLook.calm(this, 1.15, 0.2);
    this.bgCover = CasualLook.cover(world, Backdrop(), -910);
    this.field = Art.spr(world, "Field", FieldSprite(), Color.white, 1, -800, Art.Flat);
    this.launcher = Art.spr(world, "Launcher", CasualArt.ball(Color.white), Color.white, BallR * 2.6, 50, Art.Flat);
    for (let i = 0; i < 40; i++) {
      const d = Art.spr(world, "Aim", CasualArt.Dot, new Color(1, 1, 1, 0.7), 0.1, 40, Art.Flat);
      d.gameObject.setActive(false);
      this.aimDots.push(d);
    }
    this.fx = CasualFx.create(world, 60, 260);

    const hud = this.UI.Hud;
    this.turnText = UIKit.at(UIKit.label(hud, "1", 80, Color.white), new V2(0.5, 1), new V2(0, -86), new V2(400, 100));
    UIKit.glow(this.turnText, Ink, 4);
    this.bestText = UIKit.at(UIKit.label(hud, "", 28, Gold), new V2(0.5, 1), new V2(0, -150), new V2(400, 40));
    this.ballText = UIKit.at(UIKit.label(hud, "", 32, Color.white, TextAnchor.MiddleLeft), new V2(0, 0), new V2(200, 70), new V2(320, 50));
    UIKit.glow(this.ballText, Ink, 3);
    this.speedButton = UIKit.buttonAt(hud, "2×", new V2(1, 0), new V2(-120, 70), new V2(170, 100), false, () => (this.speedUp = true), 40);
    this.speedButton.setAccent(Gold);
    CasualLook.titleCard(this.UI, new Color(0.12, 0.08, 0.26, 0.8));

    this.hitClip = Sfx.make("bb2-hit", 0.05, (t) => Sfx.sinP(Sfx.glide(t, 1200, 900, 0.04)) * Sfx.env(t, 0.001, 0.035) * 0.16);
    this.breakClip = Sfx.make("bb2-break", 0.18, (t) => (noiseAt(Math.trunc(t * 44100)) * 2 - 1) * Sfx.env(t, 0.001, 0.08) * 0.3 + Sfx.sinP(Sfx.glide(t, 700, 300, 0.1)) * Sfx.env(t, 0.002, 0.12) * 0.25);
    this.fireClip = Sfx.make("bb2-fire", 0.05, (t) => Sfx.sinP(Sfx.glide(t, 500, 700, 0.04)) * Sfx.env(t, 0.001, 0.04) * 0.1);
    this.ringClip = Sfx.make("bb2-ring", 0.25, (t) => (Sfx.sinP(Sfx.glide(t, 800, 1600, 0.2)) * 0.5) * Sfx.env(t, 0.003, 0.2) * 0.3);
    this.Layout();
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    const r = this.PlayRect(TopBand, BottomBand, 0.2);
    this.cell = Math.min(r.width / Cols, (r.height - 1.2) / (Rows + 1));
    const w = this.cell * Cols, h = this.cell * (Rows + 1) + 0.6;
    this.area = new Rect(-w * 0.5, r.center.y - h * 0.5, w, h);
    this.field.transform.localScale = new V3(w + 0.2, h + 0.2, 1);
    this.field.transform.localPosition = new V3(0, this.area.center.y, 0);
    this.launchX = Mathf.clamp(this.launchX, this.area.xMin + BallR, this.area.xMax - BallR);
    for (const b of this.bricks) { b.TargetY = this.RowY(b.Row); b.Y = b.TargetY; this.PlaceBrick(b); }
    this.PlaceLauncher();
  }

  private RowY(row: number) { return this.area.yMax - this.cell * (row + 0.5) - 0.05; }
  private ColX(col: number) { return this.area.xMin + this.cell * (col + 0.5); }
  private get FloorY() { return this.area.yMin + BallR + 0.05; }

  private PlaceLauncher() {
    this.launcher.transform.localPosition = new V3(this.launchX, this.FloorY, 0);
  }

  // ------------------------------------------------------------------ bricks

  private NewBrick(col: number, row: number, hp: number, ring: boolean) {
    let b = this.bricks.find((x) => !x.Active);
    if (!b) {
      b = new Brick();
      b.Sr = Art.spr(this.world, "Brick", BrickSprite(), Color.white, 1, 20, Art.Flat);
      for (let i = 0; i < 3; i++) b.Digits[i] = Art.spr(b.Sr.transform, "Digit", Digit(0), Color.white, 0.18, 21, Art.Flat);
      this.bricks.push(b);
    }
    b.Active = true;
    b.Col = col;
    b.Row = row;
    b.Hp = hp;
    b.Ring = ring;
    b.Hit = 0;
    b.TargetY = this.RowY(row);
    b.Y = b.TargetY + this.cell;
    b.Sr.gameObject.setActive(true);
    b.Sr.sprite = ring ? RingSprite() : BrickSprite();
    this.PlaceBrick(b);
    return b;
  }

  private PlaceBrick(b: Brick) {
    const s = this.cell * (b.Ring ? 0.6 : 0.94) * (1 + b.Hit * 0.08);
    b.Sr.transform.localScale = new V3(s, s, 1);
    b.Sr.transform.localPosition = new V3(this.ColX(b.Col), b.Y, 0);
    if (b.Ring) {
      b.Sr.color = Color.white;
      for (const d of b.Digits) d.gameObject.setActive(false);
      return;
    }
    const level = Mathf.clamp(Math.floor(Math.log(Math.max(1, b.Hp)) / Math.log(Math.max(2, this.turn + 1)) * (Heat.length - 1)), 0, Heat.length - 1);
    b.Sr.color = Color.lerp(Heat[level], Color.white, b.Hit * 0.6);
    const s2 = String(b.Hp);
    for (let i = 0; i < 3; i++) {
      const d = b.Digits[i];
      const on = i < s2.length;
      d.gameObject.setActive(on);
      if (!on) continue;
      d.sprite = Digit(s2.charCodeAt(i) - 48);
      const gap = 0.26;
      d.transform.localPosition = new V3((i - (s2.length - 1) * 0.5) * gap, 0, 0);
      d.transform.localScale = new V3(0.26, 0.26, 1);
    }
  }

  private AddRow() {
    // existing bricks move down
    for (const b of this.bricks) {
      if (!b.Active) continue;
      b.Row++;
      b.TargetY = this.RowY(b.Row);
      if (b.Ring && b.Row >= Rows) { b.Active = false; b.Sr.gameObject.setActive(false); }
    }
    const count = 2 + this.rng.next(Math.min(5, 2 + Math.trunc(this.turn / 8)));
    const cols: number[] = [];
    for (let i = 0; i < Cols; i++) cols.push(i);
    for (let i = cols.length - 1; i > 0; i--) { const k = this.rng.next(i + 1); const t = cols[i]; cols[i] = cols[k]; cols[k] = t; }
    for (let i = 0; i < count && i < Cols - 1; i++) {
      const hp = this.rng.nextDouble() < 0.25 ? this.turn * 2 : this.turn;
      this.NewBrick(cols[i], 0, Math.max(1, hp), false);
    }
    this.NewBrick(cols[Cols - 1], 0, 1, true);
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.Reset();
    for (let i = 0; i < 5; i++) { this.turn++; this.AddRow(); }
    this.attractTimer = 1;
  }

  private Reset() {
    for (const b of this.bricks) { b.Active = false; b.Sr.gameObject.setActive(false); }
    for (const b of this.balls) { b.Active = false; b.Sr.gameObject.setActive(false); }
    this.fx.clear();
    this.turn = 0;
    this.ballCount = 1;
    this.score = 0;
    this.firing = this.aiming = this.ended = false;
    this.inFlight = this.toFire = 0;
    this.launchX = 0;
    this.Layout();
  }

  protected BeginRun() {
    this.rng = new SysRandom();
    this.Reset();
    this.revived = false;
    this.best = this.Data.get("best");
    this.turn = 1;
    this.AddRow();
    this.pointer.reset();
    this.pointer.topBand = 0.08;
    this.Data.add("games", 1);
    if (this.Data.get("games") === 1) this.UI.Hint("Drag to aim, let go to fire!");
    Sfx.setIntensity(0.3);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.AnimateBricks(dt);
    if (this.State !== Phase.Title) return;
    if (this.firing) { this.Simulate(dt, false); return; }
    this.attractTimer -= dt;
    if (this.attractTimer > 0) return;
    this.attractTimer = 1.2;
    const a = Mathf.lerp(30, 150, this.rng.nextDouble()) * Mathf.Deg2Rad;
    this.aimDir = new V2(Math.cos(a), Math.sin(a));
    this.ballCount = 12;
    this.Fire();
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    this.AnimateBricks(dt);
    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.State === Phase.Playing) this.Lose();
      return;
    }
    if (this.firing) {
      this.turnTime += dt;
      const speed = this.speedUp ? 2.2 : 1;
      this.Simulate(dt * speed, true);
      this.speedButton.node.setActive(this.turnTime > 2.5 && !this.speedUp);
      return;
    }
    this.speedButton.node.setActive(false);
    this.Aim();
  }

  private Aim() {
    if (this.pointer.held) {
      const w = this.ScreenToWorld(this.pointer.screen);
      const from = new V2(this.launchX, this.FloorY);
      // drag anywhere: aim towards the finger (or opposite when the finger is below the launcher)
      let d = w.sub(from);
      if (d.y < 0.2) d = d.neg();
      const ang = Mathf.clamp(Math.atan2(d.y, d.x) * Mathf.Rad2Deg, 8, 172);
      this.aimDir = new V2(Math.cos(ang * Mathf.Deg2Rad), Math.sin(ang * Mathf.Deg2Rad));
      this.aiming = true;
      this.ShowAim();
    }
    if (this.pointer.up && this.aiming) {
      this.aiming = false;
      this.HideAim();
      this.UI.Hint(null);
      this.Fire();
    }
  }

  private ShowAim() {
    const area = this.area;
    let px = this.launchX, py = this.FloorY;
    let vx = this.aimDir.x;
    const vy = this.aimDir.y;
    let di = 0;
    let travelled = 0, next = 0.45;
    for (let s = 0; s < 600 && di < this.aimDots.length; s++) {
      px += vx * 0.05;
      py += vy * 0.05;
      travelled += 0.05;
      if (px < area.xMin + BallR || px > area.xMax - BallR) { vx = -vx; px = Mathf.clamp(px, area.xMin + BallR, area.xMax - BallR); }
      if (py > area.yMax - BallR) break;
      if (this.HitsBrick(new V2(px, py))) break;
      if (travelled >= next) {
        next += 0.45;
        const d = this.aimDots[di++];
        d.gameObject.setActive(true);
        d.transform.localPosition = new V3(px, py, 0);
        d.color = new Color(1, 1, 1, 0.8 - di * 0.015);
      }
      if (travelled > 14) break;
    }
    for (; di < this.aimDots.length; di++) this.aimDots[di].gameObject.setActive(false);
  }

  private HideAim() {
    for (const d of this.aimDots) d.gameObject.setActive(false);
  }

  private HitsBrick(p: V2) {
    for (const b of this.bricks) {
      if (!b.Active || b.Ring) continue;
      const cx = this.ColX(b.Col), cy = b.TargetY;
      const h = this.cell * 0.47 + BallR;
      if (Math.abs(p.x - cx) < h && Math.abs(p.y - cy) < h) return true;
    }
    return false;
  }

  private Fire() {
    this.firing = true;
    this.firstBack = false;
    this.turnTime = 0;
    this.speedUp = false;
    this.toFire = this.ballCount;
    this.fireTimer = 0;
    this.inFlight = 0;
    this.nextLaunchX = this.launchX;
  }

  private NewBall() {
    let b = this.balls.find((x) => !x.Active);
    if (!b) {
      b = new Ball();
      b.Sr = Art.spr(this.world, "Ball", CasualArt.ball(Color.white), Color.white, BallR * 2, 30, Art.Flat);
      this.balls.push(b);
    }
    b.Active = true;
    b.Returning = false;
    b.Sr.gameObject.setActive(true);
    return b;
  }

  private Simulate(dt: number, real: boolean) {
    if (this.toFire > 0) {
      this.fireTimer -= dt;
      while (this.fireTimer <= 0 && this.toFire > 0) {
        this.fireTimer += FireGap;
        const b = this.NewBall();
        b.Pos = new V2(this.launchX, this.FloorY);
        b.Vel = this.aimDir.mul(BallSpeed);
        this.toFire--;
        this.inFlight++;
        if (real) Sfx.playClip(this.fireClip, 0.4);
      }
    }
    this.launcher.gameObject.setActive(this.toFire > 0 || !this.firing);
    const substeps = Math.ceil(BallSpeed * dt / (BallR * 0.8));
    const h = dt / Math.max(1, substeps);
    for (const b of this.balls) {
      if (!b.Active) continue;
      if (b.Returning) {
        b.Pos = new V2(Mathf.moveTowards(b.Pos.x, this.nextLaunchX, dt * 14), this.FloorY);
        if (Math.abs(b.Pos.x - this.nextLaunchX) < 0.01) this.Retire(b);
        else b.Sr.transform.localPosition = new V3(b.Pos.x, b.Pos.y, 0);
        continue;
      }
      for (let s = 0; s < substeps && b.Active && !b.Returning; s++) this.StepBall(b, h, real);
      b.Sr.transform.localPosition = new V3(b.Pos.x, b.Pos.y, 0);
    }
    if (this.inFlight === 0 && this.toFire === 0) this.EndTurn(real);
  }

  private StepBall(b: Ball, h: number, real: boolean) {
    const area = this.area;
    b.Pos = b.Pos.add(b.Vel.mul(h));
    if (b.Pos.x < area.xMin + BallR) { b.Pos = b.Pos.withX(area.xMin + BallR); b.Vel = b.Vel.withX(Math.abs(b.Vel.x)); }
    if (b.Pos.x > area.xMax - BallR) { b.Pos = b.Pos.withX(area.xMax - BallR); b.Vel = b.Vel.withX(-Math.abs(b.Vel.x)); }
    if (b.Pos.y > area.yMax - BallR) { b.Pos = b.Pos.withY(area.yMax - BallR); b.Vel = b.Vel.withY(-Math.abs(b.Vel.y)); }
    if (b.Pos.y < this.FloorY && b.Vel.y < 0) {
      b.Pos = b.Pos.withY(this.FloorY);
      if (!this.firstBack) { this.firstBack = true; this.nextLaunchX = Mathf.clamp(b.Pos.x, area.xMin + BallR, area.xMax - BallR); }
      b.Returning = true;
      return;
    }
    // avoid endless horizontal bouncing
    if (Math.abs(b.Vel.y) < BallSpeed * 0.08) b.Vel = new V2(b.Vel.x, -BallSpeed * 0.1).normalized.mul(BallSpeed);

    for (const br of this.bricks) {
      if (!br.Active) continue;
      const c = new V2(this.ColX(br.Col), br.TargetY);
      if (br.Ring) {
        if (b.Pos.sub(c).sqrMagnitude < (this.cell * 0.3 + BallR) * (this.cell * 0.3 + BallR)) {
          br.Active = false;
          br.Sr.gameObject.setActive(false);
          if (real) { this.ballCount++; Sfx.playClip(this.ringClip, 0.7); this.UI.Float(c, "+1", Gold, 0.9); }
          this.fx.pop(c, Gold, 10, 4, 0.18, 0.4);
        }
        continue;
      }
      const half = this.cell * 0.47;
      const cx = Mathf.clamp(b.Pos.x, c.x - half, c.x + half), cy = Mathf.clamp(b.Pos.y, c.y - half, c.y + half);
      const d = b.Pos.sub(new V2(cx, cy));
      if (d.sqrMagnitude >= BallR * BallR) continue;
      // reflect on the axis of least penetration
      const px = half + BallR - Math.abs(b.Pos.x - c.x), py = half + BallR - Math.abs(b.Pos.y - c.y);
      if (px < py) { b.Vel = b.Vel.withX(Mathf.sign(b.Pos.x - c.x) * Math.abs(b.Vel.x)); b.Pos = b.Pos.withX(b.Pos.x + Mathf.sign(b.Pos.x - c.x) * px); }
      else { b.Vel = b.Vel.withY(Mathf.sign(b.Pos.y - c.y) * Math.abs(b.Vel.y)); b.Pos = b.Pos.withY(b.Pos.y + Mathf.sign(b.Pos.y - c.y) * py); }
      this.Damage(br, real);
      break;
    }
  }

  private Damage(br: Brick, real: boolean) {
    br.Hp--;
    br.Hit = 1;
    const c = new V2(this.ColX(br.Col), br.TargetY);
    if (br.Hp <= 0) {
      br.Active = false;
      br.Sr.gameObject.setActive(false);
      this.fx.pop(c, br.Sr.color, 14, 5, 0.22, 0.45);
      Sfx.playClip(this.breakClip, real ? 0.7 : 0.25, 0.9 + this.rng.nextDouble() * 0.2);
      if (real) { this.score++; this.Data.add("bricks", 1); this.Fx.shake(0.05); }
    } else {
      if (real) Sfx.playClip(this.hitClip, 0.5, 0.9 + this.rng.nextDouble() * 0.3);
      this.PlaceBrick(br);
    }
  }

  private Retire(b: Ball) {
    b.Active = false;
    b.Sr.gameObject.setActive(false);
    this.inFlight--;
  }

  private EndTurn(real: boolean) {
    this.firing = false;
    this.launchX = this.nextLaunchX;
    this.PlaceLauncher();
    this.launcher.gameObject.setActive(true);
    if (!real) {
      this.turn++;
      this.AddRow();
      if (this.LowestRow() >= Rows - 1) this.OnEnterTitle();
      return;
    }
    this.turn++;
    this.AddRow();
    this.UpdateHud();
    if (this.LowestRow() >= Rows) {
      this.ended = true;
      this.endTimer = 1;
      this.UI.Announce("THE BRICKS GOT THROUGH!", Pal.Danger, 1.3);
      Sfx.play(Snd.Lose, 0.8);
      this.Fx.shake(0.3);
    } else if (this.LowestRow() >= Rows - 1) Sfx.play(Snd.Warn, 0.5);
  }

  private LowestRow() {
    let r = -1;
    for (const b of this.bricks) if (b.Active && !b.Ring) r = Math.max(r, b.Row);
    return r;
  }

  private AnimateBricks(dt: number) {
    for (const b of this.bricks) {
      if (!b.Active) continue;
      const move = Math.abs(b.Y - b.TargetY) > 1e-3 || b.Hit > 0;
      if (!move) continue;
      b.Y = Mathf.moveTowards(b.Y, b.TargetY, dt * 8);
      b.Hit = Mathf.moveTowards(b.Hit, 0, dt * 6);
      this.PlaceBrick(b);
    }
  }

  private UpdateHud() {
    CasualUI.setText(this.turnText, String(this.turn));
    CasualUI.setText(this.bestText, "BEST " + Math.max(this.best, this.turn));
    CasualUI.setText(this.ballText, "×" + this.ballCount + " BALLS");
  }

  private Lose() {
    const newBest = this.Data.max("best", this.turn);
    this.Finish(new Result({
      Headline: newBest ? "NEW RECORD!" : "GAME OVER",
      HeadlineColor: newBest ? Gold : Pal.hex(0xffc2d6),
      Value: String(this.turn),
      CountTo: this.turn,
      NewBest: newBest,
      BestLine: "TURNS SURVIVED",
      Stats: [["TURNS", String(this.turn)], ["BALLS", String(this.ballCount)], ["BRICKS", String(this.score)], ["BEST", String(this.Data.get("best"))]],
      Primary: "PLAY AGAIN",
      Reward: this.revived ? null : () => this.Continue(),
      RewardLabel: "CLEAR 3 ROWS & CONTINUE (AD)",
    }));
  }

  private Continue() {
    this.revived = true;
    this.ended = false;
    const low = this.LowestRow();
    for (const b of this.bricks) {
      if (!b.Active || b.Row < low - 2) continue;
      b.Active = false;
      b.Sr.gameObject.setActive(false);
      this.fx.pop(new V2(this.ColX(b.Col), b.TargetY), b.Sr.color, 8, 4, 0.2, 0.4);
    }
    this.pointer.reset();
    this.Revive();
    this.UI.Announce("ROOM TO BREATHE!", Sky, 1.1);
  }
}
