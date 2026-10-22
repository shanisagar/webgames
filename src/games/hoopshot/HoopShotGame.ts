import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, CasualUI, Color, Fmt, Fx, GameInfo, GameObject,
  howTo, Mathf, Outline, Pal, Phase, Quaternion, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer, Text, Time,
  TouchScheme, UIKit, V2, V3,
} from "../../kit";

/**
 * HOOP SHOT: flick the basketball up into the hoop. Swipe toward the basket: the direction aims, the length of the
 * swipe sets the power. Clean SWISH shots score double and three swishes in a row set the ball ON FIRE. After ten
 * baskets the hoop starts to move. One miss ends the run (a rewarded ad gives a second chance). AIM shows the arc of
 * your shot while you swipe. Pseudo-3D: the ball flies in depth and is projected onto the screen. (Port of HoopShotGame.cs.)
 */

// world (metres-ish); camera looks down +z
const G = 12, BallR = 0.22, RimR = 0.5, Tube = 0.035, HoopY = 3.05, HoopZ = 6, BoardGap = 0.16, BoardW = 1.8, BoardH = 1.1;
const F = 12, D = 3, CamY = 1.6, FlightT = 1.3;
const RimPts = 24, ArcDots = 16;

const Ink = Pal.hex(0x1a1240), Orange = Pal.hex(0xff7a1a), Gold = Pal.hex(0xffc93c), Fire = Pal.hex(0xff4d1a);

/** System.Random(seed).NextDouble(): a fresh seeded generator per sample (white noise). */
const noiseAt = (seed: number) => new SysRandom(seed).nextDouble();

// ------------------------------------------------------------------ art

const BallSprite = () => CasualArt.make("hs-ball", 128, 128, (p) => {
  const px = 2 / 128;
  let c = CasualArt.ballPixel(p, Orange, px);
  if (c.a <= 0) return c;
  let line = 9;
  line = Math.min(line, Math.abs(p.x));
  line = Math.min(line, Math.abs(p.y));
  line = Math.min(line, Math.abs(new V2(p.x + 1.1, p.y).magnitude - 0.85));
  line = Math.min(line, Math.abs(new V2(p.x - 1.1, p.y).magnitude - 0.85));
  c = Color.lerp(c, new Color(0.25, 0.1, 0.05, c.a), CasualArt.fill(line - 0.035, px) * 0.85);
  const dots = Math.sin(p.x * 60) * Math.sin(p.y * 60);
  c = Color.lerp(c, CasualArt.darken(c, 0.15), CasualArt.smooth(0.6, 1, dots) * 0.4);
  return c;
});

const BoardSprite = () => CasualArt.make("hs-board", 180, 110, (p) => {
  const px = 2 / 180;
  const d = CasualArt.sdBox(p, new V2(0.98, 0.59), 0.04);
  let c = new Color(0.92, 0.96, 1, 0.92);
  c = Color.lerp(c, Color.white, CasualArt.smooth(0.2, 0.6, p.y + p.x * 0.3) * 0.3);
  const frame = CasualArt.sdBox(p, new V2(0.98, 0.59), 0.04) + 0.05;
  c = Color.lerp(Pal.hex(0x2a2f45), c, CasualArt.fill(frame, px));
  const box = Math.abs(CasualArt.sdBox(p.sub(new V2(0, -0.14)), new V2(0.34, 0.24), 0)) - 0.022;
  c = Color.lerp(c, Pal.hex(0xff4d2a), CasualArt.fill(box, px));
  return c.withAlpha(c.a * CasualArt.fill(d, px));
});

const RimHalf = (front: boolean) => CasualArt.make(front ? "hs-rimf" : "hs-rimb", 128, 64, (p) => {
  const px = 2 / 128;
  // ellipse ring; p.y in [-0.5, 0.5]
  const q = new V2(p.x / 0.92, p.y / 0.4);
  const ring = Math.abs(q.magnitude - 1) * 0.4 - 0.03;
  const half = front ? p.y <= 0.02 : p.y >= -0.02;
  const c = Color.lerp(Pal.hex(0xe04a10), Pal.hex(0xff8a3a), CasualArt.smooth(-0.3, 0.3, p.y));
  return c.withAlpha(half ? CasualArt.fill(ring, px) : 0);
});

const NetSprite = () => CasualArt.make("hs-net", 96, 96, (p) => {
  const px = 2 / 96;
  // trapezoid from the rim (top) narrowing downward; diamond mesh
  const t = (1 - p.y) * 0.5; // 0 at top, 1 at bottom
  const half = Mathf.lerp(0.92, 0.55, t);
  if (Math.abs(p.x) > half || p.y < -0.95) return new Color(1, 1, 1, 0);
  const u = p.x / half;
  const a = Mathf.repeat(u * 3 + t * 4, 1), b = Mathf.repeat(u * 3 - t * 4, 1);
  const line = Math.min(Math.min(a, 1 - a), Math.min(b, 1 - b));
  const edge = Math.min(half - Math.abs(p.x), p.y + 0.95);
  return new Color(1, 1, 1, Math.max(CasualArt.fill(line - 0.05, px * 3), CasualArt.fill(-edge + 0.02, px) * 0) * (1 - t * 0.35));
});

const FloorSprite = () => CasualArt.make("hs-floor", 256, 256, (p) => {
  const t = (p.y + 1) * 0.5; // 0 near .. 1 horizon
  const depth = Mathf.lerp(1, 0.08, t);
  const u = p.x / depth;
  const plank = Mathf.repeat(u * 2.2, 1);
  let c = Color.lerp(Pal.hex(0xd9924a), Pal.hex(0xb87332), Mathf.repeat(Math.floor(u * 2.2) * 0.37, 1) * 0.6);
  c = Color.lerp(c, Pal.hex(0x8a5226), CasualArt.smooth(0.94, 1, plank) * 0.5);
  // painted key lines
  const key = Math.abs(Math.abs(u) - 1.25);
  c = Color.lerp(c, Color.white, CasualArt.smooth(0.05 * depth + 0.01, 0.0, key) * 0.85 * CasualArt.smooth(0.15, 0.3, t));
  const lineY = Math.abs(t - 0.62);
  c = Color.lerp(c, Color.white, CasualArt.smooth(0.012, 0, lineY) * (Math.abs(u) < 1.25 ? 0.85 : 0));
  // shine and fade to the horizon
  c = Color.lerp(c, Color.white, Math.exp(-u * u * 1.5) * 0.12 * (1 - t));
  c = Color.lerp(c, Pal.hex(0x3a2a5a), CasualArt.smooth(0.75, 1, t));
  return c.withAlpha(1);
});

const Backdrop = () => CasualArt.make("hs-bg", 64, 256, (p) => {
  const t = (p.y + 4) / 8;
  let c = Color.lerp(Pal.hex(0x120c33), Pal.hex(0x2b1e6b), t);
  // stadium lights
  for (let i = 0; i < 4; i++) {
    const lx = -0.75 + i * 0.5;
    const g = Math.exp(-((p.x - lx) * (p.x - lx) * 40 + (p.y - 3.3) * (p.y - 3.3) * 30));
    c = Color.lerp(c, Pal.hex(0xfff3c8), g * 0.8);
  }
  const crowd = Math.sin(p.x * 80) * Math.sin(p.y * 70);
  c = Color.lerp(c, Pal.hex(0x4a3a8a), CasualArt.smooth(0.5, 1, crowd) * CasualArt.smooth(1.4, 0.2, Math.abs(p.y - 1.2)) * 0.5);
  return c.withAlpha(1);
});

export class HoopShotGame extends ArcadeGame {
  private world!: GameObject;
  private bgCover!: SpriteRenderer; private floor!: SpriteRenderer; private board!: SpriteRenderer; private pole!: SpriteRenderer;
  private rimBack!: SpriteRenderer; private rimFront!: SpriteRenderer; private net!: SpriteRenderer; private ball!: SpriteRenderer;
  private shadow!: SpriteRenderer; private spot!: SpriteRenderer;
  private readonly arc: SpriteRenderer[] = [];
  private readonly pointer = new TapPointer();
  private fx!: CasualFx;
  private rng = new SysRandom();

  private bpos = V3.zero; private bvel = V3.zero; private start = V3.zero;
  private hoopX = 0; private hoopPhase = 0; private flight = 0; private offY = 0; private endTimer = 0; private attract = 0;
  private netKick = 0; private spin = 0; private idle = 0;
  private flying = false; private scored = false; private touched = false; private banked = false; private ended = false;
  private revived = false; private aimArmed = false;
  private score = 0; private streak = 0; private swishRun = 0; private bounces = 0;
  private prevY = 0;
  private comboFade = 0;
  private comboGlow!: Outline;

  private scoreText: Text | null = null; private comboText!: Text; private bestText!: Text;
  private aimButton!: ArcadeButton;
  private throwClip!: AudioClip; private swishClip!: AudioClip; private rimClip!: AudioClip; private boardClip!: AudioClip; private bounceClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "hoopshot",
      Title: "HOOP SHOT",
      Tagline: "FLICK. SWISH. ON FIRE!",
      Accent: Orange,
      Accent2: Gold,
      BgTop: Pal.hex(0x2b1e6b),
      BgBottom: Pal.hex(0x120c33),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 112, rootHz: 110, degrees: [0, 3, 5, 3], seed: 71, energy: 0.55, major: false },
      Reminders: [
        "The court is open|How many baskets in a row can you make?",
        "Get on fire|Three swishes in a row doubles your points!",
        "Beat your best streak|One more round of Hoop Shot?",
      ],
      HowTo: [
        howTo(Art.Chevron, Orange, "SWIPE UP toward the hoop to shoot. Longer swipe = more power."),
        howTo(Art.Ring, Gold, "Each basket is 1 point. A clean SWISH (no rim) is 2!"),
        howTo(Art.Star, Fire, "Three swishes in a row: ON FIRE! Points are doubled."),
        howTo(Art.Square, Color.white, "Bank shots off the backboard count too."),
        howTo(Art.Diamond, Pal.Danger, "One miss ends the run. After 10 baskets the hoop moves!"),
      ],
      Tips: [
        "Find your perfect swipe length and repeat it.",
        "Swipe straight at the hoop, not at the backboard.",
        "Short swipes hit the front rim; long ones bank in.",
        "When the hoop moves, shoot as it reaches the middle.",
        "Use AIM to learn the arc, then go without it.",
      ],
    });
  }

  protected get ShortSide() { return Screen.width > Screen.height ? 12 : 9; }
  private get Aims() { return this.Data.get("aim", 3); }
  private set Aims(v: number) { this.Data.set("aim", Math.max(0, v)); }
  protected BestLine() { const b = this.Data.get("best"); return b > 0 ? `BEST ${b}   ·   LONGEST STREAK ${this.Data.get("streak")}` : "SWIPE UP TO SHOOT!"; }
  protected StatsLine() { return `${Fmt.n(this.Data.get("baskets"))} BASKETS   ·   ${Fmt.n(this.Data.get("swishes"))} SWISHES`; }

  // ------------------------------------------------------------------ projection

  private K(z: number) { return F / Math.max(0.3, z + D); }
  private Proj(p: V3) { const k = this.K(p.z); return new V2(p.x * k, this.offY + (p.y - CamY) * k); }
  private get BoardZ() { return HoopZ + RimR + BoardGap; }
  private get RimCenter() { return new V3(this.hoopX, HoopY, HoopZ); }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("HoopWorld", this.gameObject);
    const world = this.world;
    CasualLook.calm(this, 1.4, 0.18);
    this.bgCover = CasualLook.cover(world, Backdrop(), -910);
    this.floor = Art.spr(world, "Floor", FloorSprite(), Color.white, 1, -900, Art.Flat);
    this.pole = Art.spr(world, "Pole", CasualArt.make("hs-pole", 8, 64, () => new Color(0.75, 0.78, 0.85, 1)), Color.white, 1, -5, Art.Flat);
    this.board = Art.spr(world, "Board", BoardSprite(), Color.white, 1, 0, Art.Flat);
    this.rimBack = Art.spr(world, "RimBack", RimHalf(false), Color.white, 1, 5, Art.Flat);
    this.net = Art.spr(world, "Net", NetSprite(), Color.white, 1, 14, Art.Flat);
    this.rimFront = Art.spr(world, "RimFront", RimHalf(true), Color.white, 1, 15, Art.Flat);
    this.shadow = Art.spr(world, "Shadow", CasualArt.Soft, new Color(0, 0, 0, 0.4), 1, -800, Art.Flat);
    this.spot = Art.spr(world, "Spot", Art.Ring, new Color(1, 1, 1, 0.35), 1, -790, Art.Flat);
    this.ball = Art.spr(world, "Ball", BallSprite(), Color.white, 1, 20, Art.Flat);
    for (let i = 0; i < ArcDots; i++) this.arc.push(Art.spr(world, "Arc", Art.Disc, new Color(1, 1, 1, 0), 0.18, 25, Art.Flat));
    this.fx = CasualFx.create(world, 80, 200);

    const hud = this.UI.Hud;
    this.scoreText = UIKit.at(UIKit.label(hud, "0", 120, Color.white), new V2(0.5, 1), new V2(0, -140), new V2(500, 150));
    UIKit.glow(this.scoreText, Ink, 6);
    this.bestText = UIKit.at(UIKit.label(hud, "", 28, new Color(1, 1, 1, 0.75)), new V2(0.5, 1), new V2(0, -230), new V2(600, 40));
    this.comboText = UIKit.at(UIKit.label(hud, "", 44, Gold), UIKit.Center, new V2(0, -120), new V2(800, 70));
    this.comboGlow = UIKit.glow(this.comboText, Ink, 4);
    this.aimButton = UIKit.buttonAt(hud, "AIM", new V2(1, 0), new V2(-170, 90), new V2(260, 110), false, () => this.OnAim(), 28);
    this.aimButton.setAccent(Orange);

    this.throwClip = Sfx.make("hs-throw", 0.18, (t) => (noiseAt(Math.trunc(t * 44100)) * 2 - 1) * Sfx.env(t, 0.01, 0.15) * 0.18 * Math.sin(t * 20));
    this.swishClip = Sfx.make("hs-swish", 0.35, (t) => (noiseAt(Math.trunc(t * 44100) + 5) * 2 - 1) * Sfx.env(t, 0.02, 0.3) * 0.25 * (0.5 + 0.5 * Math.sin(t * 90)));
    this.rimClip = Sfx.make("hs-rim", 0.3, (t) => (Sfx.sinP(980 * t) * 0.5 + Sfx.sinP(1530 * t) * 0.3) * Sfx.env(t, 0.001, 0.25) * 0.3);
    this.boardClip = Sfx.make("hs-board", 0.15, (t) => (Sfx.sinP(Sfx.glide(t, 220, 120, 0.1)) * 0.7 + (noiseAt(Math.trunc(t * 44100) + 8) * 2 - 1) * 0.3) * Sfx.env(t, 0.001, 0.12) * 0.4);
    this.bounceClip = Sfx.make("hs-bounce", 0.15, (t) => Sfx.sinP(Sfx.glide(t, 160, 70, 0.12)) * Sfx.env(t, 0.001, 0.13) * 0.6);
    this.hoopX = 0;
    this.NewShot(true);
    this.Layout();
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    // put the hoop in the upper part and the ball near the bottom of the screen
    const ballY = this.Proj(new V3(0, BallR, 0)).y - this.offY, hoopY = (HoopY - CamY) * this.K(HoopZ);
    const wantBall = -this.ViewSize.y * 0.5 + 2.6, wantHoop = this.ViewSize.y * 0.5 - 4.4;
    this.offY = Mathf.lerp(wantBall - ballY, wantHoop - hoopY, 0.5);
    const horizon = this.offY + (0 - CamY) * this.K(40);
    const bottom = -this.ViewSize.y * 0.5 - 0.5;
    this.floor.transform.localPosition = new V3(0, (horizon + bottom) * 0.5, 0);
    this.floor.transform.localScale = new V3(this.ViewSize.x * 1.6, horizon - bottom, 1);
    this.PlaceHoop();
  }

  private PlaceHoop() {
    const c = this.RimCenter;
    const k = this.K(HoopZ);
    const rc = this.Proj(c);
    const rw = RimR * 2 * k * 1.06;
    this.rimBack.transform.localPosition = rc;
    this.rimBack.transform.localScale = new V3(rw, rw, 1);
    this.rimFront.transform.localPosition = rc;
    this.rimFront.transform.localScale = new V3(rw, rw, 1);
    const kb = this.K(this.BoardZ);
    const bc = this.Proj(new V3(this.hoopX, HoopY + BoardH * 0.5 - 0.18, this.BoardZ));
    this.board.transform.localPosition = bc;
    this.board.transform.localScale = new V3(BoardW * kb, BoardW * kb, 1);
    const pb = this.Proj(new V3(this.hoopX, 0, this.BoardZ + 0.4)), pt = this.Proj(new V3(this.hoopX, HoopY, this.BoardZ + 0.4));
    this.pole.transform.localPosition = pb.add(pt).mul(0.5);
    this.pole.transform.localScale = new V3(0.18 * kb, (pt.y - pb.y) / 8, 1);
    const stretch = 1 + this.netKick * 0.35;
    const nh = rw * 0.95 * stretch;
    this.net.transform.localPosition = rc.add(new V2(0, -nh * 0.5 + rw * 0.05));
    this.net.transform.localScale = new V3(rw * (1 - this.netKick * 0.1), nh, 1);
  }

  // ------------------------------------------------------------------ shots

  private NewShot(first: boolean) {
    const sx = first ? 0 : this.rng.nextDouble() * 2.4 - 1.2;
    this.start = new V3(sx, BallR, 0);
    this.bpos = this.start;
    this.bvel = V3.zero;
    this.flying = this.scored = this.touched = this.banked = false;
    this.bounces = 0;
    this.flight = 0;
    this.idle = 0;
    this.spin = 0;
  }

  private IdealVelocity() {
    const c = this.RimCenter, start = this.start;
    const vz = (c.z - start.z) / FlightT;
    const vy = (c.y - start.y + 0.5 * G * FlightT * FlightT) / FlightT;
    const vx = (c.x - start.x) / FlightT;
    return new V3(vx, vy, vz);
  }

  /** Turns a screen swipe into a launch velocity: length sets power, direction sets aim. */
  private SwipeVelocity(swipe: V2) {
    const ideal = this.IdealVelocity();
    const ballS = this.Proj(this.start), hoopS = this.Proj(this.RimCenter);
    const wantAngle = Math.atan2(hoopS.x - ballS.x, hoopS.y - ballS.y);
    const angle = Math.atan2(swipe.x, Math.max(1, swipe.y));
    const power = swipe.magnitude / TapPointer.dp(260);
    const s = Mathf.clamp(1 + (power - 1) * 0.12 + 0.01, 0.86, 1.16);
    const aimErr = (angle - wantAngle) * 1.1;
    let v = ideal.mul(s);
    v = v.withX(ideal.x + aimErr * ideal.z * 0.5);
    return v;
  }

  private Launch(v: V3, silent: boolean) {
    this.bvel = v;
    this.flying = true;
    this.flight = 0;
    this.prevY = this.bpos.y;
    this.spin = -v.x * 120 - 360;
    if (!silent) { Sfx.playClip(this.throwClip, 0.6); Fx.haptic(false); }
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.hoopX = 0;
    this.NewShot(true);
    this.attract = 1;
    this.comboText.text = "";
    this.HideArc();
  }

  protected BeginRun() {
    this.score = this.streak = this.swishRun = 0;
    this.hoopX = 0;
    this.hoopPhase = 0;
    this.ended = this.revived = this.aimArmed = false;
    this.rng = new SysRandom();
    this.NewShot(true);
    this.pointer.reset();
    this.pointer.topBand = 0.08;
    this.comboText.text = "";
    this.Data.add("games", 1);
    if (this.Data.get("games") === 1) this.UI.Hint("Swipe UP toward the hoop to shoot!");
    Sfx.setIntensity(0.25);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.State !== Phase.Title) return;
    this.netKick = Mathf.moveTowards(this.netKick, 0, dt * 3);
    if (this.flying) this.Simulate(dt, false);
    else {
      this.attract -= dt;
      if (this.attract <= 0) {
        this.attract = 2.4;
        this.NewShot(false);
        let v = this.IdealVelocity();
        v = v.mul(1 + (this.rng.nextDouble() - 0.5) * 0.03);
        this.Launch(v, true);
      }
    }
    this.Present(dt);
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    this.netKick = Mathf.moveTowards(this.netKick, 0, dt * 3);
    this.MoveHoop(dt);
    if (this.ended) {
      this.endTimer -= dt;
      if (this.flying) this.Simulate(dt, true);
      this.Present(dt);
      if (this.endTimer <= 0 && this.State === Phase.Playing) this.Lose();
      return;
    }
    if (this.flying) this.Simulate(dt, true);
    else this.Aim();
    this.Present(dt);
  }

  private MoveHoop(dt: number) {
    if (this.score < 10) { this.hoopX = Mathf.moveTowards(this.hoopX, 0, dt); return; }
    const speed = Math.min(1.6, 0.6 + (this.score - 10) * 0.03);
    this.hoopPhase += dt * speed;
    const range = Math.min(1.4, 0.7 + (this.score - 10) * 0.025);
    this.hoopX = Math.sin(this.hoopPhase) * range;
  }

  private Aim() {
    this.idle += Time.deltaTime;
    const p = this.pointer;
    if (p.held) {
      const swipe = p.screen.sub(p.startScreen);
      if (this.aimArmed && swipe.y > TapPointer.dp(30)) this.ShowArc(this.SwipeVelocity(swipe));
      else this.HideArc();
    }
    if (p.up) {
      this.HideArc();
      const swipe = p.screen.sub(p.startScreen);
      if (swipe.y > TapPointer.dp(40)) {
        this.UI.Hint(null);
        this.aimArmed = false;
        this.Launch(this.SwipeVelocity(swipe), false);
        this.UpdateHud();
      }
    }
  }

  private ShowArc(v: V3) {
    let p = this.start;
    const h = 1 / 60;
    let shown = 0;
    for (let i = 0; i < 120 && shown < ArcDots; i++) {
      v = v.withY(v.y - G * h);
      p = p.add(v.mul(h));
      if (i % 4 === 3) {
        this.arc[shown].transform.localPosition = this.Proj(p);
        const sc = Math.max(0.08, 0.5 * this.K(p.z) * BallR);
        this.arc[shown].transform.localScale = new V3(sc, sc, sc);
        this.arc[shown].color = new Color(Gold.r, Gold.g, Gold.b, 0.9 - shown * 0.04);
        shown++;
      }
      if (p.z > HoopZ || p.y < 0) break;
    }
    for (let i = shown; i < ArcDots; i++) this.arc[i].color = new Color(1, 1, 1, 0);
  }

  private HideArc() {
    for (const a of this.arc) a.color = new Color(1, 1, 1, 0);
  }

  // ------------------------------------------------------------------ physics

  private Simulate(dt: number, live: boolean) {
    this.flight += dt;
    const steps = 6;
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.prevY = this.bpos.y;
      this.bvel = this.bvel.withY(this.bvel.y - G * h);
      // gentle "friendly rim" assist: a ball dropping just above the hoop drifts toward its centre
      if (this.bvel.y < 0 && this.bpos.y > HoopY && this.bpos.y < HoopY + 1) {
        const off = new V2(this.hoopX - this.bpos.x, HoopZ - this.bpos.z);
        if (off.magnitude < RimR * 1.5) this.bvel = new V3(this.bvel.x + off.x * 9 * h, this.bvel.y, this.bvel.z + off.y * 9 * h);
      }
      this.bpos = this.bpos.add(this.bvel.mul(h));
      this.Collide(live);
      // through the hoop: crossing the rim height going down, inside the ring
      if (!this.scored && this.prevY >= HoopY && this.bpos.y < HoopY && this.bvel.y < 0) {
        const d = new V2(this.bpos.x - this.hoopX, this.bpos.z - HoopZ);
        if (d.magnitude < RimR - BallR * 0.3) this.OnScore(live);
      }
    }
    this.spin += dt * (this.bvel.x * 60);
    // end of the shot
    const gone = this.bpos.z > this.BoardZ + 3 || this.bpos.z < -2.5 || Math.abs(this.bpos.x) > 6;
    if (this.bounces >= 2 || this.flight > 3.2 || gone) {
      this.flying = false;
      if (!live) return;
      if (this.scored) { this.NewShot(false); this.UpdateHud(); } // web fix: the C# never re-enabled AIM after a shot
      else this.Miss();
    }
  }

  private Collide(live: boolean) {
    // rim: a ring of small spheres
    for (let i = 0; i < RimPts; i++) {
      const a = (i * Math.PI * 2) / RimPts;
      const rp = new V3(this.hoopX + Math.cos(a) * RimR, HoopY, HoopZ + Math.sin(a) * RimR);
      const d = this.bpos.sub(rp);
      const dist = d.magnitude, min = BallR + Tube;
      if (dist >= min || dist < 1e-4) continue;
      const n = d.mul(1 / dist);
      this.bpos = rp.add(n.mul(min));
      const vn = V3.dot(this.bvel, n);
      if (vn < 0) {
        this.bvel = this.bvel.sub(n.mul(1.4 * vn));
        this.bvel = this.bvel.mul(0.85);
        this.touched = true;
        if (-vn > 0.8) Sfx.playClip(this.rimClip, Mathf.clamp01(-vn / 6) * (live ? 0.7 : 0.25), 0.95 + this.rng.nextDouble() * 0.1);
      }
    }
    // backboard
    const bz = this.BoardZ;
    if (this.bpos.z + BallR > bz && this.bpos.z < bz + 0.3 && this.bvel.z > 0 && Math.abs(this.bpos.x - this.hoopX) < BoardW * 0.5 && this.bpos.y > HoopY - 0.2 && this.bpos.y < HoopY - 0.2 + BoardH) {
      this.bpos = this.bpos.withZ(bz - BallR);
      this.bvel = this.bvel.withZ(-this.bvel.z * 0.55);
      this.bvel = this.bvel.withX(this.bvel.x * 0.85);
      this.banked = true;
      this.touched = true;
      Sfx.playClip(this.boardClip, live ? 0.6 : 0.2);
    }
    // floor
    if (this.bpos.y < BallR) {
      this.bpos = this.bpos.withY(BallR);
      if (this.bvel.y < 0) {
        if (-this.bvel.y > 1.5) Sfx.playClip(this.bounceClip, Mathf.clamp01(-this.bvel.y / 8) * (live ? 0.8 : 0.3));
        this.bvel = new V3(this.bvel.x * 0.8, -this.bvel.y * 0.55, this.bvel.z * 0.8);
        this.bounces++;
      }
    }
  }

  private OnScore(live: boolean) {
    this.scored = true;
    this.netKick = 1;
    const swish = !this.touched;
    Sfx.playClip(this.swishClip, live ? 0.8 : 0.3);
    if (!live) return;
    this.streak++;
    this.swishRun = swish ? this.swishRun + 1 : 0;
    const onFire = this.swishRun >= 3;
    const pts = (swish ? 2 : 1) * (onFire ? 2 : 1);
    this.score += pts;
    this.Data.add("baskets", 1);
    if (swish) this.Data.add("swishes", 1);
    this.Data.max("streak", this.streak);
    const label = onFire ? `ON FIRE!  +${pts}` : swish ? `SWISH!  +${pts}` : this.banked ? `BANK SHOT  +${pts}` : `+${pts}`;
    this.comboText.text = label;
    this.comboText.color = onFire ? Fire : swish ? Gold : Color.white;
    this.comboGlow.effectColor = Ink;
    this.comboFade = 1.2;
    const rc = this.Proj(this.RimCenter);
    this.fx.sparkle(rc, onFire ? Fire : Gold, swish ? 12 : 6, 0.6, 0.4);
    if (swish) this.fx.confetti(rc.add(V2.up.mul(0.6)), onFire ? 40 : 18, 5, [Gold, Orange, Color.white]);
    if (this.score === 10) this.UI.Announce("THE HOOP IS MOVING!", Orange, 1.2);
    Fx.haptic(swish);
    Sfx.setIntensity(Math.min(1, 0.25 + this.score * 0.02));
    this.UpdateHud();
  }

  private Miss() {
    this.ended = true;
    this.endTimer = 0.9;
    this.swishRun = 0;
    this.UI.Announce("MISS!", Pal.hex(0xffc6d0), 0.9);
    Sfx.play(Snd.Deny, 0.6);
    this.Fx.shake(0.2);
  }

  // ------------------------------------------------------------------ present

  private Present(dt: number) {
    this.PlaceHoop();
    const bpos = this.bpos;
    const k = this.K(bpos.z);
    const bp = this.Proj(bpos);
    this.ball.transform.localPosition = bp;
    const bs = BallR * 2 * k;
    this.ball.transform.localScale = new V3(bs, bs, bs);
    this.ball.transform.localRotation = Quaternion.euler(0, 0, this.spin);
    this.ball.sortingOrder = bpos.z < HoopZ - RimR * 0.6 ? 20 : bpos.z > HoopZ + RimR * 0.6 ? 3 : 10;
    const onFire = this.swishRun >= 3 && this.State === Phase.Playing;
    this.ball.color = onFire ? Color.lerp(Color.white, Pal.hex(0xffb080), 0.5 + 0.5 * Math.sin(Time.time * 20)) : Color.white;
    if (onFire && this.flying) this.fx.emit(bp, new V2(0, 1.5), Fire, BallR * k * 1.2, 0.35);
    const sp = this.Proj(new V3(bpos.x, 0, bpos.z));
    const sh = Mathf.clamp01(1 - bpos.y / 5);
    this.shadow.transform.localPosition = sp;
    this.shadow.transform.localScale = new V3(BallR * 3 * k, BallR * 1 * k, 1);
    this.shadow.color = new Color(0, 0, 0, 0.45 * sh);
    const ss = this.Proj(new V3(this.start.x, 0, this.start.z));
    this.spot.transform.localPosition = ss;
    this.spot.transform.localScale = new V3(BallR * 4 * this.K(0), BallR * 1.3 * this.K(0), 1);
    this.spot.color = new Color(1, 1, 1, this.flying ? 0.12 : 0.35);
    if (!this.flying && this.State === Phase.Playing) {
      // the ball bobs gently while waiting
      const bob = Math.abs(Math.sin(this.idle * 3)) * 0.06;
      this.ball.transform.localPosition = bp.add(new V2(0, bob * this.K(0)));
    }
    if (this.comboFade > 0) {
      this.comboFade -= dt;
      const c = this.comboText.color;
      this.comboText.color = new Color(c.r, c.g, c.b, Mathf.clamp01(this.comboFade * 2));
      // uGUI's Outline fades with the text (useGraphicAlpha); the kit's Outline does not
      this.comboGlow.effectColor = Ink.withAlpha(Ink.a * this.comboText.color.a);
    }
  }

  // ------------------------------------------------------------------ boosters

  private OnAim() {
    if (this.State !== Phase.Playing || this.ended || this.flying || this.aimArmed) return;
    if (!CasualUI.useOrEarn(() => this.Aims, (v) => (this.Aims = v), this.UI, "+1 AIM")) { this.UpdateHud(); return; }
    this.aimArmed = true;
    this.Data.flush();
    Sfx.play(Snd.PowerUp, 0.6);
    this.UpdateHud();
  }

  private UpdateHud() {
    if (!this.scoreText) return;
    CasualUI.setText(this.scoreText, String(this.score));
    CasualUI.setText(this.bestText, `BEST ${Math.max(this.score, this.Data.get("best"))}   ·   STREAK ${this.streak}`);
    CasualUI.booster(this.aimButton, "AIM", this.Aims, this.State === Phase.Playing && !this.ended && !this.flying, this.aimArmed ? "AIM ON" : null);
    if (this.aimArmed) this.aimButton.interactable = false;
  }

  // ------------------------------------------------------------------ results

  private Lose() {
    const newBest = this.Data.max("best", this.score);
    this.Finish(new Result({
      Headline: newBest ? "NEW BEST!" : this.score >= 20 ? "GREAT SHOOTING!" : "GAME OVER",
      HeadlineColor: newBest ? Gold : Pal.hex(0xffd2c2),
      Value: String(this.score),
      CountTo: this.score,
      NewBest: newBest,
      BestLine: `BEST ${this.Data.get("best")}   ·   LONGEST STREAK ${this.Data.get("streak")}`,
      Stats: [["POINTS", String(this.score)], ["BASKETS", String(this.streak)], ["SWISHES", Fmt.n(this.Data.get("swishes"))], ["BEST", String(this.Data.get("best"))]],
      Primary: "SHOOT AGAIN",
      Reward: this.revived ? null : () => this.Continue(),
      RewardLabel: "SECOND CHANCE (WATCH AD)",
    }));
  }

  private Continue() {
    this.revived = true;
    this.ended = false;
    this.NewShot(false);
    this.pointer.reset();
    this.Revive();
    this.UI.Announce("SECOND CHANCE!", Orange, 1);
    this.UpdateHud();
  }
}
