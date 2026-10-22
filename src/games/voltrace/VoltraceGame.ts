import {
  ArcadeButton, ArcadeGame, Art, Color, Fmt, GameInfo, GameObject, howTo, Image, LoopSource, Mathf, Mesh, Pal, Phase, Quaternion,
  Random, Rect, Result, Settings, Sfx, Snd, SpriteRenderer, Text, TextAnchor, Time, TouchScheme, UIKit, UILine, UINode, V2, V3,
} from "../../kit";
import { Track } from "./Track";
import { TrailRenderer } from "./Trail";

/**
 * VOLTRACE: anti-gravity racing on procedurally generated circuits against five AI pilots.
 * Each pilot has a personality (skill, aggression, racing-line discipline, drafting habits, mistakes). The AI
 * plans speed from upcoming curvature, takes the inside line, picks overtaking sides, slipstreams and
 * uses boost on straights. Finish top 3 to climb the leagues; tracks and rivals get harder each league.
 * (Port of VoltraceGame.cs.)
 */

class Pilot {
  Name = "";
  Skill = 0; Aggression = 0; LineDiscipline = 0; Wobble = 0; BoostHappy = 0;
  Offset = 0; PassSide = 0; MistakeTimer = 0; MistakeSteer = 0;
}

class Car {
  Name = "";
  Color = Color.white;
  IsPlayer = false;
  Ai: Pilot | null = null;
  Pos = V2.zero; Vel = V2.zero;
  Heading = 0; Steer = 0; Throttle = 0; BoostMeter = 0; BoostTime = 0; Scrape = 0; TopSpeed = 0;
  Braking = false;
  Index = 0; Lap = 0; Place = 0;
  Finished = false;
  FinishTime = 0; LapStart = 0; BestLap = Infinity;
  Root!: GameObject;
  Body!: SpriteRenderer; Glow!: SpriteRenderer; Flame!: SpriteRenderer;
  Trail!: TrailRenderer;
  Dot: Image | null = null;
  Progress(t: Track) { return this.Lap * t.Count + this.Index; }
}

const Laps = 3;
const CarRadius = 0.75;
const MaxSpeed = 24;
const BoostSpeed = 33;

const PlayerColor = Pal.hex(0x4de8ff);
const Roster: { name: string; color: number; skill: number; aggro: number; line: number; boost: number }[] = [
  { name: "VEGA", color: 0xff4d6a, skill: 0.97, aggro: 0.9, line: 0.8, boost: 0.7 },
  { name: "NOVA", color: 0x5cffa0, skill: 0.99, aggro: 0.3, line: 1.0, boost: 0.5 },
  { name: "RAZOR", color: 0xff8a3d, skill: 0.93, aggro: 1.0, line: 0.5, boost: 1.0 },
  { name: "ECHO", color: 0xe45cff, skill: 0.95, aggro: 0.5, line: 0.85, boost: 0.4 },
  { name: "KITE", color: 0xffc84a, skill: 0.94, aggro: 0.6, line: 0.9, boost: 0.6 },
];

/**
 * Kit gap: MeshRenderer fills each triangle flat with its first vertex colour, so Track.BuildRoadMesh's edge → middle
 * gradient renders as a sawtooth. Same road, cut into bands across its width; both triangles of a band quad start on
 * the same column, whose colour is the gradient sampled at the band centre.
 */
function RoadMeshForKit(track: Track, edge: Color, middle: Color, bands = 8) {
  const m = track.Count, cols = bands + 1;
  const verts: V3[] = [], colors: Color[] = [], tris: number[] = [];
  for (let i = 0; i < m; i++)
    for (let k = 0; k < cols; k++) {
      const side = (k / bands) * 2 - 1, band = Math.min(k, bands - 1), mid = ((band + 0.5) / bands) * 2 - 1;
      verts.push(track.Center[i].add(track.Normal[i].mul(Track.Width * 0.5 * side)).toV3());
      colors.push(Color.lerp(middle, edge, Math.abs(mid)));
    }
  for (let i = 0; i < m; i++) {
    const a = i * cols, b = ((i + 1) % m) * cols;
    for (let k = 0; k < bands; k++) tris.push(a + k, b + k, a + k + 1, b + k, b + k + 1, a + k + 1);
  }
  const mesh = new Mesh();
  mesh.name = "Road";
  mesh.vertices = verts;
  mesh.colors = colors;
  mesh.triangles = tris;
  mesh.markDirty();
  return mesh;
}

/** Application.isMobilePlatform (kit gap: no equivalent in the kit). */
const isMobilePlatform = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export class VoltraceGame extends ArcadeGame {
  private world!: GameObject;
  private trackRoot: GameObject | null = null;
  private track: Track | null = null;
  private readonly cars: Car[] = [];
  private player: Car | null = null;
  private league = 0; private raceCount = 0;
  private countdown = 0; private raceClock = 0; private finishTimer = 0; private cameraZoom = 1;
  private lastBeep = 0;
  private racing = false; private attract = false; private boostStart = false;
  private camPos = V2.zero;
  private engine!: LoopSource;

  // HUD
  private placeText!: Text; private lapText!: Text; private timeText!: Text; private speedText!: Text; private bestLapText!: Text; private leagueText!: Text;
  private boostFill!: Image;
  private boostButton!: ArcadeButton;
  private miniTrack!: UILine;
  private miniRoot!: UINode;
  private miniBounds = new Rect();
  private boostRequested = false;

  protected Describe() {
    return new GameInfo({
      Id: "voltrace",
      Reminders: [
        "Your rivals are practicing|VEGA just shaved a second off her lap. Take it back.",
        "Grid is forming|A new circuit is ready for your league.",
        "Engines warm|RAZOR says you are scared of the next league.",
      ],
      Title: "VOLTRACE",
      Tagline: "ANTI-GRAVITY RACING VS AI RIVALS",
      PlayLabel: "RACE",
      Accent: PlayerColor,
      Accent2: Pal.hex(0xff4db8),
      BgTop: Pal.hex(0x0c0a2a),
      BgBottom: Pal.hex(0x02030a),
      GridSpacing: 3,
      ShortSide: 26,
      Touch: TouchScheme.Halves,
      Music: { bpm: 138, rootHz: 61.74, degrees: [0, 5, 6, 4], seed: 57, energy: 1 },
      HowTo: [
        howTo(Art.Car, PlayerColor, "Steer: hold the left / right side of the screen, A/D, or the stick."),
        howTo(Art.Chevron, Pal.Warn, "Your craft accelerates on its own. Brake: hold both sides, S, or LT."),
        howTo(Art.Tri, Pal.Good, "Drive over BOOST PADS, or ride behind a rival to charge your boost."),
        howTo(Art.Diamond, Pal.Magenta, "Fire boost: Space, gamepad A or the BOOST button."),
        howTo(Art.Eye, Pal.hex(0xff4d6a), "Five AI pilots, each with their own style: line, aggression, slipstreaming."),
        howTo(Art.Star, Pal.Warn, "Finish in the TOP 3 to advance a league. Tracks get tighter, rivals sharper."),
      ],
      Tips: [
        "Brake before a corner, not in it. Carry speed out of the apex.",
        "Tuck in behind a rival: slipstreaming charges your boost fast.",
        "Save your boost for the longest straight.",
        "Scraping the wall costs a lot of speed.",
        "Each AI pilot has a style. RAZOR is fast but reckless.",
      ],
    });
  }

  protected get ShortSide() { return this.Info.ShortSide * this.cameraZoom; }

  protected BestLine() {
    const best = this.Data.get("bestLeague");
    const lap = this.Data.get("bestLapMs");
    return best > 0 ? `LEAGUE ${this.Data.get("league") + 1}   ·   BEST LEAGUE ${best}` + (lap > 0 ? "   ·   LAP " + Fmt.lap(lap / 1000) : "") : "";
  }

  protected StatsLine() {
    return this.Data.get("races") > 0 ? `${Fmt.n(this.Data.get("races"))} RACES  ·  ${Fmt.n(this.Data.get("wins"))} WINS` : "RACE 5 AI PILOTS OVER 3 LAPS";
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("World", this.gameObject);
    this.engine = Sfx.createLoop(Sfx.engineClip());
    this.BuildHud();
    this.league = this.Data.get("league");
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.placeText = UIKit.at(UIKit.label(hud, "", 96, Pal.Text, TextAnchor.MiddleLeft), new V2(0, 1), new V2(170, -80), new V2(260, 120));
    UIKit.glow(this.placeText, PlayerColor.withAlpha(0.4), 4);
    this.lapText = UIKit.at(UIKit.label(hud, "", 40, Pal.Text), new V2(0.5, 1), new V2(0, -60), new V2(400, 60));
    this.timeText = UIKit.at(UIKit.label(hud, "", 30, Pal.TextDim), new V2(0.5, 1), new V2(0, -108), new V2(400, 44));
    this.bestLapText = UIKit.at(UIKit.label(hud, "", 24, Pal.TextDim), new V2(0.5, 1), new V2(0, -146), new V2(400, 36));
    this.leagueText = UIKit.at(UIKit.label(hud, "", 24, this.Info.Accent2, TextAnchor.MiddleLeft), new V2(0, 1), new V2(170, -155), new V2(300, 36));
    this.speedText = UIKit.at(UIKit.label(hud, "", 44, Pal.Text), new V2(0.5, 0), new V2(0, 170), new V2(300, 60));
    [, this.boostFill] = UIKit.meter(hud, new V2(0.5, 0), new V2(0, 120), new V2(420, 26), Pal.Magenta);
    UIKit.at(UIKit.label(hud, "BOOST", 22, Pal.TextDim), new V2(0.5, 0), new V2(0, 88), new V2(300, 30));

    this.boostButton = UIKit.buttonAt(hud, "BOOST", new V2(1, 0), new V2(-150, 360), new V2(180, 180), false, () => (this.boostRequested = true), 32);
    this.boostButton.setAccent(Pal.Magenta);

    this.miniRoot = UIKit.node("Minimap", hud).place(new V2(1, 1), new V2(-150, -280), new V2(240, 240));
    UIKit.img(this.miniRoot, "Bg", Art.UiRound, Pal.Panel.withAlpha(0.55)).rectTransform.stretch(-12);
    this.miniTrack = new UILine(UIKit.node("Track", this.miniRoot).stretch());
    this.miniTrack.loop = true;
    this.miniTrack.thickness = 5;
    this.miniTrack.color = new Color(1, 1, 1, 0.35);
  }

  // ------------------------------------------------------------------ race setup

  private NewRace(attractMode: boolean) {
    this.attract = attractMode;
    for (const c of this.cars) {
      c.Root.destroy();
      if (c.Dot) c.Dot.gameObject.destroy();
    }
    this.cars.length = 0;
    if (this.trackRoot) this.trackRoot.destroy();

    const track = (this.track = Track.Generate(attractMode ? Random.rangeInt(0, 99999) : this.league * 7919 + this.raceCount * 131 + 17, attractMode ? 2 : this.league));
    const trackRoot = (this.trackRoot = new GameObject("Track", this.world));
    Art.meshObject(trackRoot, "Road", RoadMeshForKit(track, new Color(0.12, 0.1, 0.3, 0.95), new Color(0.06, 0.06, 0.16, 0.95)), Art.Flat, 1);
    const left = Art.line(trackRoot, "Edge L", this.Info.Accent2.withAlpha(0.9), 0.22, 3, true);
    const lp = track.EdgePoints(-1);
    left.positionCount = lp.length;
    left.setPositions(lp);
    const right = Art.line(trackRoot, "Edge R", PlayerColor.withAlpha(0.9), 0.22, 3, true);
    const rp = track.EdgePoints(1);
    right.positionCount = rp.length;
    right.setPositions(rp);

    const start = Art.spr(trackRoot, "Start", Art.Square, new Color(1, 1, 1, 0.75), 1, 2);
    start.transform.position = track.Center[0];
    start.transform.rotation = Quaternion.euler(0, 0, Math.atan2(track.Tangent[0].y, track.Tangent[0].x) * Mathf.Rad2Deg);
    start.transform.localScale = new V3(0.6, Track.Width, 1);
    for (const pad of track.BoostPads)
      for (let k = 0; k < 3; k++) {
        const i = track.Wrap(pad + k);
        const arrow = Art.spr(trackRoot, "Boost Pad", Art.Chevron, Pal.Good.withAlpha(0.8), 1.6, 2, Art.Additive);
        arrow.transform.position = track.Center[i];
        arrow.transform.rotation = Quaternion.euler(0, 0, Math.atan2(track.Tangent[i].y, track.Tangent[i].x) * Mathf.Rad2Deg);
      }

    // Grid: two columns behind the start line; the player starts mid-pack.
    // Race: the player plus every AI pilot. Title-screen attract race: the AI pilots only.
    const total = attractMode ? Roster.length : Roster.length + 1;
    const playerSlot = attractMode ? -1 : 3;
    for (let slot = 0, ai = 0; slot < total; slot++) {
      const isPlayer = slot === playerSlot;
      const car = isPlayer ? this.MakeCar("YOU", PlayerColor, null) : this.MakeCar(Roster[ai].name, Pal.hex(Roster[ai].color), this.MakePilot(ai++));
      const row = Math.trunc(slot / 2);
      const index = track.Wrap(-3 - row * 3);
      const side = slot % 2 === 0 ? -1.4 : 1.4;
      car.Index = index;
      car.Lap = -1;
      car.Pos = track.Center[index].add(track.Normal[index].mul(side));
      car.Heading = Math.atan2(track.Tangent[index].y, track.Tangent[index].x);
      car.Vel = V2.zero;
      this.cars.push(car);
      if (isPlayer) this.player = car;
    }
    if (attractMode) this.player = null;

    this.SetupMinimap();
    this.camPos = track.Center[0];
    this.Fx.CameraTarget = this.camPos;
    this.raceClock = 0;
    this.finishTimer = 0;
    this.racing = false;
    this.countdown = attractMode ? 0 : 3.4;
    this.lastBeep = 4;
    if (attractMode) this.racing = true;
  }

  private MakePilot(i: number) {
    const r = Roster[i];
    const leagueSkill = Mathf.lerp(0.9, 1.02, Mathf.clamp01(this.league / 8));
    const p = new Pilot();
    p.Name = r.name;
    p.Skill = r.skill * leagueSkill;
    p.Aggression = r.aggro;
    p.LineDiscipline = r.line;
    p.Wobble = (1 - r.skill) * 3 + (1 - leagueSkill) * 2;
    p.BoostHappy = r.boost;
    p.MistakeTimer = Random.range(4, 12);
    return p;
  }

  private MakeCar(name: string, color: Color, pilot: Pilot | null) {
    const root = new GameObject(name, this.world);
    const car = new Car();
    car.Name = name; car.Color = color; car.Ai = pilot; car.IsPlayer = pilot === null;
    car.Root = root;
    car.Glow = Art.spr(root, "Glow", Art.Glow, color.withAlpha(0.4), 3, 18, Art.Additive);
    car.Flame = Art.spr(root, "Flame", Art.Glow, Color.white, 1, 19, Art.Additive);
    car.Body = Art.spr(root, "Body", Art.Car, color, 1.7, 20);
    car.Trail = root.addComponent(new TrailRenderer());
    car.Trail.sharedMaterial = Art.LineMat;
    car.Trail.time = 0.35;
    car.Trail.widthMultiplier = 0.35;
    car.Trail.startColor = color.withAlpha(0.6);
    car.Trail.endColor = color.withAlpha(0);
    car.Trail.sortingOrder = 15;
    car.Trail.minVertexDistance = 0.3;
    car.Trail.emitting = false;
    car.Dot = UIKit.img(this.miniRoot, "Dot", Art.UiCircle, color);
    car.Dot.rectTransform.sizeDelta = pilot === null ? new V2(22, 22) : new V2(16, 16);
    return car;
  }

  private SetupMinimap() {
    const track = this.track!;
    this.miniBounds = track.Bounds;
    const pts: V2[] = [];
    for (let i = 0; i < track.Count; i += 3) pts.push(this.MiniPoint(track.Center[i]));
    this.miniTrack.setPoints(pts);
    this.miniRoot.gameObject.setActive(!this.attract);
  }

  private MiniPoint(world: V2) {
    const size = Math.max(this.miniBounds.width, this.miniBounds.height);
    const n = world.sub(this.miniBounds.center).div(size);
    return n.mul(220);
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.cameraZoom = 1.5;
    this.NewRace(true);
    this.engine.volume = 0;
  }

  protected BeginRun() {
    this.cameraZoom = 1;
    this.league = this.Data.get("league");
    this.NewRace(false);
    const player = this.player!;
    if (this.boostStart) {
      this.boostStart = false;
      player.BoostMeter = 1;
      this.UI.Float(player.Pos, "FULL BOOST", Pal.Magenta, 1);
    }
    this.boostButton.gameObject.setActive(this.Controls.usingTouch || isMobilePlatform());
    this.UI.Announce("LEAGUE " + (this.league + 1), this.Info.Accent2, 1.2);
    Sfx.setIntensity(0.3);
  }

  protected OnPauseChanged(_paused: boolean) { this.engine.volume = 0; }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.State === Phase.Over) {
      this.engine.volume = Mathf.moveTowards(this.engine.volume, 0, dt);
      this.Simulate(dt);
      this.FollowCamera(this.player, dt);
      return;
    }
    this.Simulate(dt);
    let leader: Car | null = null;
    for (const c of this.cars) if (!leader || c.Progress(this.track!) > leader.Progress(this.track!)) leader = c;
    if (leader) this.FollowCamera(leader, dt);
  }

  protected TickRun(dt: number) {
    const player = this.player!;
    if (!this.racing) {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n < this.lastBeep && n >= 1 && n <= 3) {
        this.lastBeep = n;
        Sfx.play(Snd.Beep);
        this.UI.Announce(String(n), Pal.Warn, 0.9);
      }
      if (this.countdown <= 0) {
        this.racing = true;
        Sfx.play(Snd.BeepHigh);
        this.UI.Announce("GO!", Pal.Good, 0.9);
        for (const c of this.cars) c.LapStart = 0;
      }
    } else this.raceClock += dt;

    if (!player.Finished) {
      player.Steer = this.Controls.steer;
      player.Braking = this.Controls.brake;
      player.Throttle = player.Braking ? 0 : 1;
      if ((this.Controls.actionPressed || this.boostRequested) && player.BoostMeter >= 0.25 && player.BoostTime <= 0) {
        player.BoostTime = 0.6 + player.BoostMeter * 2.2;
        player.BoostMeter = 0;
        Sfx.play(Snd.Whoosh);
        this.Fx.kick(0.8, 0.4);
      }
    }
    this.boostRequested = false;

    this.Simulate(dt);
    this.FollowCamera(player, dt);
    this.UpdateHud();

    if (player.Finished) {
      this.finishTimer += dt;
      if (this.finishTimer > 2.5) this.EndRace();
    }

    const speed = player.Vel.magnitude;
    this.engine.volume = Settings.Sound ? Mathf.lerp(0.05, 0.22, speed / MaxSpeed) : 0;
    this.engine.pitch = 0.6 + (speed / BoostSpeed) * 1.3;
    Sfx.setIntensity(this.racing ? 0.55 + (player.Place <= 2 ? 0.3 : 0) + (Laps - 1 === player.Lap ? 0.15 : 0) : 0.3);
  }

  private FollowCamera(c: Car | null, dt: number) {
    if (!c) return;
    const target = c.Pos.add(c.Vel.mul(0.35));
    this.camPos = V2.lerp(this.camPos, target, 1 - Math.exp(-dt * 5));
    this.Fx.CameraTarget = this.camPos;
  }

  // ------------------------------------------------------------------ simulation

  private Simulate(dt: number) {
    if (!this.track) return;
    for (const c of this.cars) {
      if (c.Ai) this.DriveAi(c, dt);
      else if (this.attract) c.Throttle = 0;
      if (!this.racing) { c.Throttle = 0; c.Steer = 0; }
      this.Physics(c, dt);
    }
    this.Collide();
    this.Rank();
  }

  private Physics(c: Car, dt: number) {
    const track = this.track!;
    const boosting = c.BoostTime > 0;
    if (boosting) c.BoostTime -= dt;
    const skill = c.Ai ? c.Ai.Skill : 1;
    const max = (boosting ? BoostSpeed : MaxSpeed) * skill * this.RubberBand(c);
    const speed = c.Vel.magnitude;

    const turn = c.Steer * 2.7 * Mathf.clamp01(speed / 5) * (1 - 0.3 * Mathf.clamp01(speed / BoostSpeed));
    c.Heading += turn * dt;
    const fwd = new V2(Math.cos(c.Heading), Math.sin(c.Heading));
    const right = new V2(fwd.y, -fwd.x);

    c.Vel = c.Vel.add(fwd.mul(c.Throttle * (boosting ? 26 : 16) * dt));
    if (c.Braking) c.Vel = c.Vel.mul(Math.exp(-2.8 * dt));
    const grip = c.Braking && Math.abs(c.Steer) > 0.5 ? 3.5 : 9; // brake + steer = drift
    const lat = V2.dot(c.Vel, right);
    c.Vel = c.Vel.sub(right.mul(lat * (1 - Math.exp(-grip * dt))));
    c.Vel = c.Vel.mul(Math.exp(-0.22 * dt));
    if (c.Vel.magnitude > max) c.Vel = V2.lerp(c.Vel, c.Vel.normalized.mul(max), 1 - Math.exp(-4 * dt));
    c.Pos = c.Pos.add(c.Vel.mul(dt));

    // Track walls.
    const prev = c.Index;
    c.Index = track.Nearest(c.Pos, c.Index);
    const lateral = track.Lateral(c.Pos, c.Index);
    const limit = Track.Width * 0.5 - CarRadius * 0.6;
    c.Scrape = Math.max(0, c.Scrape - dt * 3);
    if (Math.abs(lateral) > limit) {
      const n = track.Normal[c.Index].mul(Mathf.sign(lateral));
      c.Pos = c.Pos.sub(n.mul(Math.abs(lateral) - limit));
      const into = V2.dot(c.Vel, n);
      if (into > 0) c.Vel = c.Vel.sub(n.mul(into * 1.4));
      c.Vel = c.Vel.mul(Math.exp(-2.5 * dt));
      if (c.Scrape <= 0.1 && speed > 6) {
        this.Fx.spray(c.Pos.add(n.mul(CarRadius)), n.neg().add(c.Vel.normalized.mul(0.5)), Pal.Warn, 5, 6, 0.6, 0.14, 0.25);
        if (c.IsPlayer) { Sfx.play(Snd.Hit, 0.5, 0.6); this.Fx.shake(0.12); }
      }
      c.Scrape = 1;
    }

    // Laps.
    const delta = c.Index - prev;
    if (delta < -track.Count / 2) this.OnCrossLine(c);
    else if (delta > track.Count / 2) c.Lap--;

    // Boost pads and slipstream.
    for (const pad of track.BoostPads) {
      const d = track.Wrap(c.Index - pad);
      if (d <= 2 && Math.abs(lateral) < 2.2 && c.BoostTime < 0.9) {
        c.BoostTime = 1.1;
        if (c.IsPlayer) { Sfx.play(Snd.PowerUp, 0.6, 1.4); this.Fx.kick(0.6, 0.3); }
      }
    }
    for (const o of this.cars) {
      if (o === c) continue;
      const rel = o.Pos.sub(c.Pos);
      const ahead = V2.dot(rel, fwd);
      if (ahead > 1.5 && ahead < 7 && Math.abs(V2.dot(rel, right)) < 1.1 && speed > 10) {
        c.BoostMeter = Math.min(1, c.BoostMeter + dt * 0.18);
        c.Vel = c.Vel.add(fwd.mul(2.5 * dt));
      }
    }
    c.BoostMeter = Math.min(1, c.BoostMeter + dt * 0.02);
    c.TopSpeed = Math.max(c.TopSpeed, speed);

    // Visuals.
    const root = c.Root;
    root.position = new V3(c.Pos.x, c.Pos.y, 0);
    c.Body.transform.localRotation = Quaternion.euler(0, 0, c.Heading * Mathf.Rad2Deg);
    c.Flame.transform.localPosition = fwd.neg().mul(1.05);
    const flame = boosting ? 1.6 : 0.4 + c.Throttle * 0.5;
    c.Flame.transform.localScale = new V3(flame, flame, 1);
    c.Flame.color = (boosting ? Pal.Magenta : c.Color).withAlpha(0.8);
    c.Trail.emitting = speed > 8;
    if (c.Dot) c.Dot.rectTransform.anchoredPosition = this.MiniPoint(c.Pos);
  }

  private OnCrossLine(c: Car) {
    c.Lap++;
    if (c.Lap <= 0) { c.LapStart = this.raceClock; return; }
    const lapTime = this.raceClock - c.LapStart;
    c.LapStart = this.raceClock;
    if (lapTime < c.BestLap) c.BestLap = lapTime;
    if (this.attract) return;
    if (c.Lap >= Laps) {
      if (c.Finished) return; // already home, cruising on
      // Every car records its finishing time, so places are decided by who crossed the line first.
      c.Finished = true;
      c.FinishTime = this.raceClock;
      if (!c.IsPlayer) return;
      let place = 1;
      for (const o of this.cars) if (o !== c && o.Finished) place++;
      c.Place = place;
      c.Ai = this.MakePilot(1); // autopilot takes the cool-down lap
      Sfx.play(place <= 3 ? Snd.Win : Snd.Lose);
      this.UI.Announce(VoltraceGame.Ordinal(place) + " PLACE", place <= 3 ? Pal.Good : Pal.TextDim, 2);
      this.SlowMo(0.4, 1.2);
    } else if (!c.IsPlayer) return;
    else {
      Sfx.play(Snd.Confirm);
      this.UI.Announce(c.Lap === Laps - 1 ? "FINAL LAP" : "LAP " + (c.Lap + 1), Pal.Warn, 1.2);
      this.UI.Float(c.Pos, Fmt.lap(lapTime), PlayerColor, 0.9);
    }
  }

  private RubberBand(c: Car) {
    if (c.IsPlayer || !this.player || !this.racing) return 1;
    const gap = this.player.Progress(this.track!) - c.Progress(this.track!);
    const strength = Mathf.lerp(1, 0.4, this.league / 8);
    if (gap > 40) return 1 + 0.08 * strength;
    if (gap < -60) return 1 - 0.06 * strength;
    return 1;
  }

  private DriveAi(c: Car, dt: number) {
    const track = this.track!;
    const p = c.Ai!;
    const speed = c.Vel.magnitude;
    const look = 6 + Mathf.roundToInt(speed * 0.45);
    const ti = track.Wrap(c.Index + look);

    // Racing line: hug the inside of the upcoming bend.
    let bend = 0;
    for (let k = look; k < look + 18; k++) bend += track.Curvature[track.Wrap(c.Index + k)];
    const half = Track.Width * 0.5 - 1.1;
    const line = -Mathf.clamp(bend * 2.2, -1, 1) * half * p.LineDiscipline;

    // Overtaking: pick the side away from a close car ahead.
    p.PassSide = Mathf.moveTowards(p.PassSide, 0, dt * 0.8);
    for (const o of this.cars) {
      if (o === c) continue;
      const gap = o.Progress(track) - c.Progress(track);
      if (gap <= 0 || gap > 9) continue;
      const theirLat = track.Lateral(o.Pos, o.Index);
      if (Math.abs(theirLat - p.Offset) < 1.8)
        p.PassSide = (theirLat > 0 ? -1 : 1) * (1.4 + p.Aggression * 1.2);
    }
    p.Offset = Mathf.lerp(p.Offset, Mathf.clamp(line + p.PassSide, -half, half), 1 - Math.exp(-dt * 2.5));

    const target = track.Center[ti].add(track.Normal[ti].mul(p.Offset));
    const to = target.sub(c.Pos);
    const want = Math.atan2(to.y, to.x) * Mathf.Rad2Deg;
    const diff = Mathf.deltaAngle(c.Heading * Mathf.Rad2Deg, want);
    const wobble = (Mathf.perlinNoise(c.Pos.x * 0.1, Time.time * 0.7) - 0.5) * p.Wobble;
    c.Steer = Mathf.clamp(diff / 32 + wobble, -1, 1);

    // Occasional mistakes from less disciplined pilots.
    p.MistakeTimer -= dt;
    if (p.MistakeTimer <= 0) {
      p.MistakeTimer = Random.range(6, 16) * (0.5 + p.Skill);
      p.MistakeSteer = Random.value < (1.05 - p.Skill) * 6 ? Random.range(-1, 1) : 0;
    }
    if (Math.abs(p.MistakeSteer) > 0.01) {
      c.Steer = Mathf.clamp(c.Steer + p.MistakeSteer, -1, 1);
      p.MistakeSteer = Mathf.moveTowards(p.MistakeSteer, 0, dt * 1.5);
    }

    // Speed planning from the sharpest curvature ahead.
    let maxK = 0.001;
    for (let k = 4; k < 30 + Math.trunc(speed); k++) maxK = Math.max(maxK, Math.abs(track.Curvature[track.Wrap(c.Index + k)]));
    const cornerSpeed = Math.sqrt((19 * p.Skill) / maxK);
    c.Braking = speed > cornerSpeed * 1.05;
    c.Throttle = c.Braking ? 0 : speed > cornerSpeed ? 0.3 : 1;

    if (c.BoostMeter > 0.75 - p.BoostHappy * 0.3 && maxK < 0.02 && c.BoostTime <= 0 && this.racing) {
      c.BoostTime = 0.6 + c.BoostMeter * 2.2;
      c.BoostMeter = 0;
    }
  }

  private Collide() {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++)
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const d = b.Pos.sub(a.Pos);
        const m = d.magnitude;
        const min = CarRadius * 2;
        if (m >= min || m < 0.0001) continue;
        const n = d.div(m);
        const push = (min - m) * 0.5;
        a.Pos = a.Pos.sub(n.mul(push));
        b.Pos = b.Pos.add(n.mul(push));
        const rel = V2.dot(b.Vel.sub(a.Vel), n);
        if (rel < 0) {
          const impulse = n.mul(rel * 0.6);
          a.Vel = a.Vel.add(impulse);
          b.Vel = b.Vel.sub(impulse);
          if (a.IsPlayer || b.IsPlayer) {
            Sfx.play(Snd.Hit, 0.6);
            this.Fx.shake(0.15);
            this.Fx.spray(a.Pos.add(b.Pos).mul(0.5), n, Pal.Warn, 6, 5, 1.4, 0.14, 0.25);
          }
        }
      }
  }

  private Rank() {
    const track = this.track!;
    this.cars.sort((x, y) => {
      if (x.Finished && y.Finished) return x.FinishTime - y.FinishTime;
      if (x.Finished !== y.Finished) return x.Finished ? -1 : 1;
      return y.Progress(track) - x.Progress(track);
    });
    for (let i = 0; i < this.cars.length; i++) this.cars[i].Place = i + 1;
  }

  // ------------------------------------------------------------------ HUD / end

  private UpdateHud() {
    const player = this.player!;
    this.placeText.text = `P${player.Place}<size=44>/${this.cars.length}</size>`;
    this.placeText.color = player.Place === 1 ? Pal.Warn : Pal.Text;
    this.lapText.text = this.racing ? `LAP ${Mathf.clamp(player.Lap + 1, 1, Laps)}/${Laps}` : "GET READY";
    this.timeText.text = Fmt.lap(this.raceClock);
    this.bestLapText.text = !isFinite(player.BestLap) ? "" : "BEST LAP " + Fmt.lap(player.BestLap);
    this.leagueText.text = "LEAGUE " + (this.league + 1);
    this.speedText.text = Mathf.roundToInt(player.Vel.magnitude * 12) + "<size=24> KM/H</size>";
    UIKit.setMeter(this.boostFill, player.BoostTime > 0 ? 1 : player.BoostMeter);
    this.boostButton.interactable = player.BoostMeter >= 0.25;
  }

  private EndRace() {
    const player = this.player!;
    this.engine.volume = 0;
    this.raceCount++;
    const place = player.Place;
    const podium = place <= 3;
    this.Data.add("races", 1);
    if (place === 1) this.Data.add("wins", 1);
    const newLap = isFinite(player.BestLap) && this.Data.min("bestLapMs", Mathf.roundToInt(player.BestLap * 1000));
    const shownLeague = this.league + 1;
    if (podium) {
      this.league++;
      this.Data.set("league", this.league);
    }
    const newLeague = this.Data.max("bestLeague", this.league + 1);
    Sfx.play(podium ? Snd.Win : Snd.Lose);
    this.Finish(new Result({
      Headline: place === 1 ? "VICTORY!" : podium ? "PODIUM FINISH" : "OFF THE PODIUM",
      HeadlineColor: podium ? Pal.Good : Pal.Danger,
      Value: VoltraceGame.Ordinal(place),
      NewBest: podium && newLeague,
      BestLine: podium ? `PROMOTED TO LEAGUE ${this.league + 1}` : "FINISH TOP 3 TO ADVANCE",
      Stats: [
        ["RACE TIME", Fmt.lap(player.FinishTime)],
        ["BEST LAP" + (newLap ? "  (RECORD)" : ""), Fmt.lap(player.BestLap)],
        ["LEAGUE", String(shownLeague)],
        ["TOP SPEED", Mathf.roundToInt(player.TopSpeed * 12) + " KM/H"],
      ],
      Primary: podium ? "NEXT RACE" : "RETRY",
      Victory: podium,
      Reward: podium ? null : () => { this.boostStart = true; this.StartRun(); },
      RewardLabel: "RETRY WITH FULL BOOST: WATCH AN AD",
    }));
  }

  private static Ordinal(n: number) {
    switch (n) {
      case 1: return "1ST";
      case 2: return "2ND";
      case 3: return "3RD";
      default: return n + "TH";
    }
  }
}
