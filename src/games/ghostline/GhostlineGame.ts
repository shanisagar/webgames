import {
  ArcadeButton, ArcadeGame, Art, Color, Ease, Fmt, Fx, GameInfo, GameObject, Grid2D, howTo, Image, ImageType, Mathf, Mesh,
  Pal, Phase, Quaternion, Random, Result, Sfx, Snd, SpriteRenderer, Text, TextAnchor, Time, TouchScheme, UIKit, V2, V2i, V3,
} from "../../kit";
import { Facility } from "./Facility";

export enum GuardState { Patrol, Suspicious, Investigate, Alert, Search }

/**
 * GHOSTLINE: top-down stealth infiltration of procedurally generated facilities.
 * Guard AI: patrol routes (A*), vision cones clipped by walls, a detection meter that fills faster up close,
 * hearing (sprint footsteps, thrown decoys), investigation of noises, radio alerts to nearby guards, search
 * patterns around the last known position, and a facility-wide alert level that sharpens every guard.
 * (Port of GhostlineGame.cs.)
 */

class Guard {
  State = GuardState.Patrol;
  Pos = V2.zero; LastKnown = V2.zero;
  Facing = 0; TargetFacing = 0; Meter = 0; Timer = 0; LostTimer = 0; RepathTimer = 0; LookBase = 0;
  Route: V2i[] = [];
  RouteIndex = 0; SearchLeft = 0;
  Radioed = false; Looking = false;
  readonly Path: V2i[] = [];
  PathIndex = 0;
  Root!: GameObject;
  Body!: SpriteRenderer; Nose!: SpriteRenderer; Mark!: SpriteRenderer;
  Cone!: Mesh;
}

class SecurityCam {
  Pos = V2.zero;
  BaseAngle = 0; Angle = 0; Meter = 0; Alarm = 0;
  Body!: SpriteRenderer; Lens!: SpriteRenderer;
  Cone!: Mesh;
}

enum Next { Fresh, Retry, NextLevel }

const PlayerRadius = 0.28;
const WalkSpeed = 3.1, SprintSpeed = 5.3;
const ConeRays = 28;

const PlayerColor = Pal.hex(0x7df9ff);
const ShardColor = Pal.hex(0xffc84a);
const ExitColor = Pal.hex(0x5cffa0);
const StateColor = [Pal.hex(0x59d8ff), Pal.hex(0xffd24d), Pal.hex(0xff9a3d), Pal.hex(0xff3b5c), Pal.hex(0xff9a3d)];

/** Application.isMobilePlatform (kit gap: no equivalent in the kit). */
const isMobilePlatform = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

export class GhostlineGame extends ArcadeGame {
  private world!: GameObject;
  private levelRoot: GameObject | null = null;
  private facility!: Facility;
  private grid: Grid2D | null = null;
  private readonly guards: Guard[] = [];
  private readonly cams: SecurityCam[] = [];
  private readonly shardSprites: SpriteRenderer[] = [];
  private readonly shardsLeft: V2i[] = [];
  private exitSprite!: SpriteRenderer; private exitRing!: SpriteRenderer;
  private player: SpriteRenderer | null = null;
  private playerGlow!: SpriteRenderer; private pointer!: SpriteRenderer; private decoySprite!: SpriteRenderer;
  private readonly coneVerts: V3[] = new Array(ConeRays + 2).fill(V3.zero);
  private readonly coneColors: Color[] = new Array(ConeRays + 2).fill(Color.clear);
  private readonly coneTris: number[] = new Array(ConeRays * 3).fill(0);

  private pPos = V2.zero; private pFacing = V2.up; private camPos = V2.zero; private decoyFrom = V2.zero; private decoyTo = V2.zero;
  private stepTimer = 0; private cloakTime = 0; private cloakCooldown = 0; private levelTime = 0; private decoyTimer = -1; private attractClock = 0;
  private level = 1; private score = 0; private levelStartScore = 0; private decoys = 0; private alertLevel = 0; private spotted = 0;
  private exitOpen = false; private cloakRequested = false; private decoyRequested = false; private escaped = false;
  private next = Next.Fresh;

  // HUD
  private levelText!: Text; private shardText!: Text; private statusText!: Text; private scoreText!: Text;
  private readonly alertPips: Image[] = [];
  private cloakButton!: ArcadeButton; private decoyButton!: ArcadeButton;
  private cloakFill!: Image;

  protected get AimOrigin() { return this.pPos; }

  protected Describe() {
    return new GameInfo({
      Id: "ghostline",
      Reminders: [
        "New facility located|Fresh data is waiting. Stay unseen.",
        "The guards changed shifts|New patrol routes. New openings.",
        "Your cloak is recharged|A perfect ghost run is still out there.",
      ],
      Title: "GHOSTLINE",
      Tagline: "INFILTRATE. STEAL THE DATA. STAY UNSEEN.",
      PlayLabel: "INFILTRATE",
      Accent: PlayerColor,
      Accent2: Pal.hex(0xff3b5c),
      BgTop: Pal.hex(0x06101c),
      BgBottom: Pal.hex(0x010307),
      ShortSide: 15,
      Touch: TouchScheme.Stick,
      Music: { bpm: 92, rootHz: 55, degrees: [0, 5, 1, 4], seed: 71, energy: 0.45 },
      HowTo: [
        howTo(Art.Disc, PlayerColor, "Move: drag anywhere, WASD or the stick. Steal 3 DATA SHARDS, then reach the EXIT."),
        howTo(Art.Eye, StateColor[0], "Guards see in cones. Walls block sight. Their meter fills faster the closer you are."),
        howTo(Art.Ring, StateColor[1], "SPRINT (Shift / stick fully out) is fast but loud. Guards investigate noises."),
        howTo(Art.Diamond, Pal.Magenta, "DECOY (Q / button) throws a beeping lure that pulls guards away."),
        howTo(Art.Hex, PlayerColor, "CLOAK (Space / E / button) makes you invisible for 3 seconds."),
        howTo(Art.Star, StateColor[3], "Spotted guards radio their friends and search the area. Get caught and it's over."),
        howTo(Art.Plus, ShardColor, "Finish without ever being spotted for a big GHOST BONUS."),
      ],
      Tips: [
        "Guards pause and look around at the end of each patrol leg. Move when they turn away.",
        "A decoy thrown into another room clears a corridor for a few seconds.",
        "Cameras don't move, but they call the nearest guards.",
        "Each alarm raises the alert level, and guards see further. Stay quiet early.",
        "Walking is almost silent. Only sprint when nobody is near.",
      ],
    });
  }

  protected BestLine() {
    const best = this.Data.get("best");
    return best > 0 ? `BEST  ${Fmt.n(best)}   ·   DEEPEST LEVEL ${this.Data.get("bestLevel")}` : "";
  }

  protected StatsLine() {
    return this.Data.get("runs") > 0 ? `${Fmt.n(this.Data.get("levels"))} FACILITIES CLEARED  ·  ${Fmt.n(this.Data.get("ghosts"))} AS A GHOST` : "STEALTH INFILTRATION";
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("World", this.gameObject);
    this.BuildHud();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.levelText = UIKit.at(UIKit.label(hud, "", 40, Pal.Text, TextAnchor.MiddleLeft), new V2(0, 1), new V2(200, -60), new V2(340, 60));
    this.shardText = UIKit.at(UIKit.label(hud, "", 40, ShardColor), new V2(0.5, 1), new V2(0, -60), new V2(420, 60));
    this.statusText = UIKit.at(UIKit.label(hud, "", 34, StateColor[0]), new V2(0.5, 1), new V2(0, -112), new V2(500, 50));
    this.scoreText = UIKit.at(UIKit.label(hud, "", 28, Pal.TextDim, TextAnchor.MiddleLeft), new V2(0, 1), new V2(200, -110), new V2(340, 40));
    for (let i = 0; i < 3; i++) {
      const pip = UIKit.img(hud, "Alert", Art.Tri, Color.white);
      pip.rectTransform.place(new V2(0.5, 1), new V2(-40 + i * 40, -155), new V2(30, 30));
      pip.rectTransform.localRotation = Quaternion.euler(0, 0, 90);
      this.alertPips.push(pip);
    }
    this.cloakButton = UIKit.buttonAt(hud, "CLOAK", new V2(1, 0), new V2(-120, 180), new V2(170, 170), false, () => (this.cloakRequested = true), 30);
    this.cloakButton.setAccent(PlayerColor);
    this.cloakFill = UIKit.img(this.cloakButton.node, "Cooldown", Art.UiCircle, PlayerColor.withAlpha(0.25));
    this.cloakFill.rectTransform.stretch(8);
    this.cloakFill.type = ImageType.Filled;
    this.cloakFill.fillMethod = "Radial360";
    this.cloakFill.fillOrigin = 0; // Origin360.Top
    this.decoyButton = UIKit.buttonAt(hud, "DECOY", new V2(1, 0), new V2(-120, 370), new V2(140, 140), false, () => (this.decoyRequested = true), 26);
    this.decoyButton.setAccent(Pal.Magenta);
  }

  // ------------------------------------------------------------------ level

  private LoadLevel(lvl: number, attract: boolean) {
    if (this.levelRoot) this.levelRoot.destroy();
    this.guards.length = 0;
    this.cams.length = 0;
    this.shardSprites.length = 0;
    this.shardsLeft.length = 0;
    const levelRoot = (this.levelRoot = new GameObject("Level " + lvl, this.world));

    this.facility = Facility.Generate(lvl, attract ? Random.rangeInt(0, 99999) : lvl * 1543 + Random.rangeInt(0, 99999));
    const grid = (this.grid = this.facility.Grid);

    const floorMesh = grid.buildMesh((x, y) => {
      if (grid.Solid[grid.index(x, y)]) return Color.clear;
      return ((x + y) & 1) === 0 ? new Color(0.07, 0.1, 0.16, 1) : new Color(0.06, 0.085, 0.14, 1);
    });
    Art.meshObject(levelRoot, "Floor", floorMesh, Art.Flat, 1);
    const wallMesh = grid.buildMesh((x, y) => (this.IsWallFace(x, y) ? new Color(0.22, 0.2, 0.42, 1) : Color.clear));
    Art.meshObject(levelRoot, "Walls", wallMesh, Art.Flat, 30);
    const edgeMesh = grid.buildMesh((x, y) => (this.IsWallFace(x, y) ? PlayerColor.withAlpha(0.18) : Color.clear), 0.35);
    Art.meshObject(levelRoot, "Wall Glow", edgeMesh, Art.FillAdd, 31);

    for (const s of this.facility.Shards) {
      const sr = Art.spr(levelRoot, "Shard", Art.Diamond, ShardColor, 0.55, 12);
      sr.transform.position = grid.toWorld(s);
      const glow = Art.spr(sr.gameObject, "Glow", Art.Glow, ShardColor.withAlpha(0.6), 3, 11, Art.Additive);
      glow.transform.localScale = new V3(3, 3, 1);
      this.shardSprites.push(sr);
      this.shardsLeft.push(s);
    }
    this.exitRing = Art.spr(levelRoot, "Exit Ring", Art.Ring, ExitColor.withAlpha(0.3), 1.8, 10, Art.Additive);
    this.exitRing.transform.position = grid.toWorld(this.facility.Exit);
    this.exitSprite = Art.spr(levelRoot, "Exit", Art.RoundSquare, ExitColor.withAlpha(0.25), 1.2, 9);
    this.exitSprite.transform.position = grid.toWorld(this.facility.Exit);

    for (const route of this.facility.Patrols) this.guards.push(this.MakeGuard(route));
    for (const { cell, facing } of this.facility.Cameras) {
      const c = new SecurityCam();
      c.Pos = grid.toWorld(cell).add(facing.mul(0.45));
      c.BaseAngle = Math.atan2(facing.y, facing.x);
      c.Angle = c.BaseAngle;
      const root = new GameObject("Camera", levelRoot);
      root.position = c.Pos;
      c.Cone = new Mesh();
      c.Cone.name = "Cam Cone";
      Art.meshObject(root, "Cone", c.Cone, Art.Flat, 6);
      c.Body = Art.spr(root, "Body", Art.RoundSquare, Pal.hex(0x39406a), 0.5, 32);
      c.Lens = Art.spr(root, "Lens", Art.Disc, StateColor[0], 0.22, 33);
      this.cams.push(c);
    }

    this.pPos = grid.toWorld(this.facility.Start);
    this.camPos = this.pPos;
    this.exitOpen = false;
    this.decoyTimer = -1;
    this.alertLevel = 0;
    this.spotted = 0;
    this.escaped = false;
    this.levelTime = 0;
  }

  private IsWallFace(x: number, y: number) {
    const grid = this.grid!;
    if (!grid.isSolid(x, y)) return false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (grid.inBounds(x + dx, y + dy) && !grid.Solid[grid.index(x + dx, y + dy)]) return true;
    return false;
  }

  private MakeGuard(route: V2i[]) {
    const g = new Guard();
    g.Route = route;
    g.RouteIndex = 0;
    g.State = GuardState.Patrol;
    g.Pos = this.grid!.toWorld(route[0]);
    g.Root = new GameObject("Guard", this.levelRoot);
    g.Cone = new Mesh();
    g.Cone.name = "Guard Cone";
    const coneRenderer = Art.meshObject(g.Root, "Cone", g.Cone, Art.Flat, 5);
    coneRenderer.transform.localPosition = V3.zero;
    g.Body = Art.spr(g.Root, "Body", Art.Disc, StateColor[0], 0.62, 20);
    g.Nose = Art.spr(g.Root, "Nose", Art.Chevron, Color.white, 0.32, 21);
    g.Mark = Art.spr(g.Root, "Mark", Art.shape("exclaim", (p) =>
      Math.max(Art.edge(Math.min(0.16 - Math.abs(p.x), 0.1 - Math.abs(p.y - 0.4) + 0.5)),
        Art.edge(0.18 - p.sub(new V2(0, -0.72)).magnitude))), Color.white, 0.6, 40);
    g.Mark.transform.localPosition = new V3(0, 0.75, 0);
    this.NextPatrolLeg(g);
    return g;
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.next = Next.Fresh;
    this.LoadLevel(2, true);
    this.SetPlayerVisible(false);
    this.attractClock = 0;
  }

  protected BeginRun() {
    if (this.next === Next.NextLevel) this.level++;
    else if (this.next === Next.Retry) this.score = this.levelStartScore;
    else { this.level = 1; this.score = 0; }
    this.next = Next.Fresh;
    this.levelStartScore = this.score;

    this.LoadLevel(this.level, false);
    this.SetPlayerVisible(true);
    this.decoys = 2;
    this.cloakTime = 0;
    this.cloakCooldown = 0;
    const touch = this.Controls.usingTouch || isMobilePlatform();
    this.cloakButton.gameObject.setActive(touch);
    this.decoyButton.gameObject.setActive(touch);
    this.UI.Announce("FACILITY " + this.level, PlayerColor, 1.4);
    if (this.level === 1 && this.Data.get("runs") === 0) this.UI.Hint("Steal the 3 golden DATA SHARDS, then reach the green EXIT. Stay out of the cones.");
    Sfx.setIntensity(0.1);
  }

  private SetPlayerVisible(on: boolean) {
    if (!this.player) {
      this.playerGlow = Art.spr(this.world, "Player Glow", Art.Glow, PlayerColor.withAlpha(0.4), 1.8, 24, Art.Additive);
      this.player = Art.spr(this.world, "Player", Art.Disc, PlayerColor, 0.56, 25);
      this.pointer = Art.spr(this.world, "Objective", Art.Chevron, ShardColor.withAlpha(0.8), 0.4, 26, Art.Additive);
      this.decoySprite = Art.spr(this.world, "Decoy", Art.Diamond, Pal.Magenta, 0.35, 27);
    }
    this.player.gameObject.setActive(on);
    this.playerGlow.gameObject.setActive(on);
    this.pointer.gameObject.setActive(on);
    this.decoySprite.gameObject.setActive(false);
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.State !== Phase.Title || !this.grid) return;
    this.attractClock += dt;
    for (const g of this.guards) this.TickGuard(g, dt, false);
    if (this.guards.length > 0) {
      const g = this.guards[Math.trunc(this.attractClock / 8) % this.guards.length];
      this.camPos = V2.lerp(this.camPos, g.Pos, 1 - Math.exp(-dt * 1.5));
      this.Fx.CameraTarget = this.camPos;
    }
    this.AnimateLevel(dt);
  }

  protected TickRun(dt: number) {
    this.levelTime += dt;
    this.UpdatePlayer(dt);
    this.UpdateDecoy(dt);
    for (const g of this.guards) {
      this.TickGuard(g, dt, true);
      if (this.State !== Phase.Playing) return;
    }
    for (const c of this.cams) this.TickCamera(c, dt);
    this.CheckObjectives();
    this.AnimateLevel(dt);
    this.UpdateHud();
  }

  private UpdatePlayer(dt: number) {
    const grid = this.grid!, player = this.player!;
    this.cloakTime = Math.max(0, this.cloakTime - dt);
    this.cloakCooldown = Math.max(0, this.cloakCooldown - dt);
    if ((this.Controls.actionPressed || this.cloakRequested) && this.cloakCooldown <= 0) {
      this.cloakTime = 3;
      this.cloakCooldown = 11;
      Sfx.play(Snd.Whoosh, 0.8, 1.4);
      this.Fx.burst(this.pPos, PlayerColor, 18, 3);
    }
    if ((this.Controls.action2Pressed || this.decoyRequested) && this.decoys > 0 && this.decoyTimer < 0) this.ThrowDecoy();
    this.cloakRequested = this.decoyRequested = false;

    const move = this.Controls.move;
    const sprint = this.Controls.sprint && move.sqrMagnitude > 0.1;
    const speed = sprint ? SprintSpeed : WalkSpeed;
    if (move.sqrMagnitude > 0.01) this.pFacing = move.normalized;
    this.pPos = this.pPos.add(move.mul(speed * dt));
    this.pPos = grid.resolveCircle(this.pPos, PlayerRadius);

    if (move.sqrMagnitude > 0.05) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = sprint ? 0.32 : 0.5;
        this.EmitNoise(this.pPos, sprint ? 5.5 : 1.3, sprint);
        if (sprint) Sfx.play(Snd.Step, 0.6, Random.range(0.8, 1.1));
      }
    }

    const alpha = this.cloakTime > 0 ? 0.22 + 0.1 * Math.sin(Time.time * 20) : 1;
    player.transform.position = this.pPos;
    player.color = PlayerColor.withAlpha(alpha);
    this.playerGlow.transform.position = this.pPos;
    this.playerGlow.color = PlayerColor.withAlpha(0.4 * alpha);
    this.camPos = V2.lerp(this.camPos, this.pPos.add(move.mul(1.5)), 1 - Math.exp(-dt * 5));
    this.Fx.CameraTarget = this.camPos;

    // Objective pointer.
    const target = this.shardsLeft.length > 0 ? this.NearestShard() : grid.toWorld(this.facility.Exit);
    const to = target.sub(this.pPos);
    const far = to.magnitude > 3;
    this.pointer.gameObject.setActive(far);
    if (far) {
      const dir = to.normalized;
      this.pointer.transform.setPositionAndRotation(this.pPos.add(dir.mul(1.1)), Quaternion.euler(0, 0, Math.atan2(dir.y, dir.x) * Mathf.Rad2Deg));
      this.pointer.color = (this.shardsLeft.length > 0 ? ShardColor : ExitColor).withAlpha(0.8);
    }
  }

  private NearestShard() {
    const grid = this.grid!;
    let best = grid.toWorld(this.shardsLeft[0]);
    for (const s of this.shardsLeft) {
      const w = grid.toWorld(s);
      if (w.sub(this.pPos).sqrMagnitude < best.sub(this.pPos).sqrMagnitude) best = w;
    }
    return best;
  }

  private ThrowDecoy() {
    this.decoys--;
    this.decoyFrom = this.pPos;
    const dist = Math.min(6, this.grid!.raycast(this.pPos, this.pFacing, 6) - 0.4);
    this.decoyTo = this.pPos.add(this.pFacing.mul(Math.max(0.5, dist)));
    this.decoyTimer = 0;
    this.decoySprite.gameObject.setActive(true);
    Sfx.play(Snd.Whoosh, 0.5, 1.8);
  }

  private UpdateDecoy(dt: number) {
    if (this.decoyTimer < 0) return;
    this.decoyTimer += dt;
    const k = Mathf.clamp01(this.decoyTimer / 0.45);
    const p = V2.lerp(this.decoyFrom, this.decoyTo, Ease.outCubic(k));
    this.decoySprite.transform.position = p.add(V2.up.mul(Math.sin(k * Math.PI) * 0.6));
    this.decoySprite.transform.localRotation = Quaternion.euler(0, 0, this.decoyTimer * 600);
    if (this.decoyTimer >= 0.6 && this.decoyTimer - dt < 0.6) {
      Sfx.play(Snd.BeepHigh, 0.8);
      this.EmitNoise(this.decoyTo, 9, true);
    }
    if (this.decoyTimer > 1.6) {
      this.decoyTimer = -1;
      this.decoySprite.gameObject.setActive(false);
    }
  }

  private EmitNoise(at: V2, radius: number, visible: boolean) {
    if (visible) this.Fx.ring(at, Pal.Magenta, 0.2, radius / 0.41, 0.5);
    for (const g of this.guards) {
      if (g.State === GuardState.Alert || g.Pos.sub(at).sqrMagnitude > radius * radius) continue;
      this.Investigate(g, at, false);
    }
  }

  private CheckObjectives() {
    const grid = this.grid!;
    for (let i = this.shardsLeft.length - 1; i >= 0; i--) {
      const w = grid.toWorld(this.shardsLeft[i]);
      if (w.sub(this.pPos).sqrMagnitude > 0.5) continue;
      this.shardsLeft.splice(i, 1);
      for (const s of this.shardSprites)
        if (s.gameObject.activeSelf && s.transform.position.xy.sub(w).sqrMagnitude < 0.01) s.gameObject.setActive(false);
      this.score += 100;
      Sfx.play(Snd.Pickup);
      Sfx.play(Snd.Coin, 0.6);
      this.Fx.burst(w, ShardColor, 24, 5);
      this.Fx.ring(w, ShardColor, 0.3, 3, 0.4);
      this.UI.Float(w, "+100 DATA", ShardColor, 0.9);
      if (this.shardsLeft.length === 0) {
        this.exitOpen = true;
        this.UI.Announce("EXIT UNLOCKED", ExitColor);
        Sfx.play(Snd.PowerUp);
        if (this.level === 1) this.UI.Hint("Now get to the green EXIT.");
      } else if (this.level === 1 && this.Data.get("runs") === 0) this.UI.Hint("Sprinting (Shift / stick fully out) is fast but loud. Guards will come to check.");
    }
    if (this.exitOpen && grid.toWorld(this.facility.Exit).sub(this.pPos).sqrMagnitude < 0.8) this.CompleteLevel();
  }

  // ------------------------------------------------------------------ guard AI

  private ViewRange(s: GuardState) { return (s === GuardState.Alert ? 9 : s === GuardState.Patrol ? 6 : 7.5) * (1 + this.alertLevel * 0.12); }

  /** Returns [sees, distance] (C# out parameter). */
  private Sees(from: V2, facing: number, halfFov: number, range: number): [boolean, number] {
    const distance = this.pPos.sub(from).magnitude;
    if (this.State !== Phase.Playing || this.cloakTime > 0) return [false, distance];
    if (distance > range) return [false, distance];
    if (distance > 1.1) {
      const angle = Math.abs(Mathf.deltaAngle(facing * Mathf.Rad2Deg, Math.atan2(this.pPos.y - from.y, this.pPos.x - from.x) * Mathf.Rad2Deg)) * Mathf.Deg2Rad;
      if (angle > halfFov) return [false, distance];
    }
    return [this.grid!.lineOfSight(from, this.pPos), distance];
  }

  private TickGuard(g: Guard, dt: number, perceive: boolean) {
    const range = this.ViewRange(g.State);
    const halfFov = (g.State === GuardState.Alert ? 60 : 45) * Mathf.Deg2Rad;
    let dist = range;
    let sees = false;
    if (perceive) [sees, dist] = this.Sees(g.Pos, g.Facing, halfFov, range);
    if (sees) {
      const closeness = 1 - dist / range;
      const rate = (0.9 + closeness * 2.6) * (this.Controls.sprint ? 1.4 : 1) * (1 + this.alertLevel * 0.2);
      g.Meter = Math.min(1, g.Meter + dt * rate);
      g.LastKnown = this.pPos;
    } else g.Meter = Math.max(0, g.Meter - dt * (g.State === GuardState.Alert ? 0.12 : 0.3));

    switch (g.State) {
      case GuardState.Patrol:
        if (g.Meter > 0.2) { this.Enter(g, GuardState.Suspicious); break; }
        if (g.Looking) {
          GhostlineGame.LookAround(g, dt);
          if (g.Timer <= 0) { g.Looking = false; this.NextPatrolLeg(g); }
        } else if (this.Follow(g, 2.1, dt)) {
          g.Looking = true;
          g.Timer = Random.range(1.2, 2.6);
          g.LookBase = g.Facing;
        }
        break;

      case GuardState.Suspicious:
        g.TargetFacing = GhostlineGame.Angle(g.LastKnown.sub(g.Pos));
        if (g.Meter >= 1) this.Enter(g, GuardState.Alert);
        else if (g.Meter <= 0) this.Investigate(g, g.LastKnown, false);
        break;

      case GuardState.Investigate:
        if (g.Meter >= 1) { this.Enter(g, GuardState.Alert); break; }
        if (g.Meter > 0.2 && sees) g.TargetFacing = GhostlineGame.Angle(this.pPos.sub(g.Pos));
        if (g.Looking) {
          GhostlineGame.LookAround(g, dt);
          if (g.Timer <= 0) { g.Looking = false; this.ResumePatrol(g); }
        } else if (this.Follow(g, g.Radioed ? 3.6 : 2.6, dt)) {
          g.Looking = true;
          g.Timer = 3;
          g.LookBase = g.Facing;
        }
        break;

      case GuardState.Alert: {
        g.RepathTimer -= dt;
        if (sees) g.LostTimer = 0;
        else g.LostTimer += dt;
        if (g.RepathTimer <= 0) {
          g.RepathTimer = 0.35;
          this.PathTo(g, sees ? this.pPos : g.LastKnown);
        }
        const arrived = this.Follow(g, 4.5, dt);
        if (sees) g.TargetFacing = GhostlineGame.Angle(this.pPos.sub(g.Pos));
        if (!sees && (g.LostTimer > 2 || (arrived && g.LostTimer > 0.6))) this.Enter(g, GuardState.Search);
        if (perceive && this.pPos.sub(g.Pos).sqrMagnitude < 0.45) { this.Caught(g); return; }
        break;
      }

      case GuardState.Search:
        if (g.Meter >= 0.6) { this.Enter(g, GuardState.Alert); break; }
        if (g.Looking) {
          GhostlineGame.LookAround(g, dt);
          if (g.Timer > 0) break;
          g.Looking = false;
          if (--g.SearchLeft <= 0) { this.ResumePatrol(g); break; }
          this.PathTo(g, this.RandomNear(g.LastKnown, 6));
        } else if (this.Follow(g, 3, dt)) {
          g.Looking = true;
          g.Timer = 1.4;
          g.LookBase = g.Facing;
        }
        break;
    }

    // Anyone brushing past the player notices immediately.
    if (perceive && g.State !== GuardState.Alert && this.cloakTime <= 0 && this.pPos.sub(g.Pos).sqrMagnitude < 0.5) {
      g.Meter = 1;
      g.LastKnown = this.pPos;
      this.Enter(g, GuardState.Alert);
    }

    g.Facing = Mathf.lerpAngle(g.Facing * Mathf.Rad2Deg, g.TargetFacing * Mathf.Rad2Deg, 1 - Math.exp(-dt * 7)) * Mathf.Deg2Rad;
    this.PresentGuard(g, range, halfFov);
  }

  private Enter(g: Guard, s: GuardState) {
    const previous = g.State;
    g.State = s;
    g.Looking = false;
    switch (s) {
      case GuardState.Suspicious:
        g.Path.length = 0;
        Sfx.play(Snd.Beep, 0.5, 0.8);
        break;
      case GuardState.Alert:
        g.LostTimer = 0;
        g.RepathTimer = 0;
        if (previous !== GuardState.Alert) this.RaiseAlarm(g.Pos, g.LastKnown, g);
        break;
      case GuardState.Search:
        g.SearchLeft = 3;
        this.PathTo(g, g.LastKnown);
        break;
    }
  }

  private RaiseAlarm(source: V2, lastKnown: V2, caller: Guard | null) {
    this.spotted++;
    this.alertLevel = Math.min(3, this.alertLevel + 1);
    Sfx.play(Snd.Alarm, 0.8);
    this.Fx.shake(0.25);
    this.Back.Flash(Pal.Danger, 0.15);
    this.UI.Float(source.add(V2.up), "SPOTTED!", Pal.Danger, 1);
    for (const o of this.guards) {
      if (o === caller || o.State === GuardState.Alert || o.Pos.sub(source).sqrMagnitude > 14 * 14) continue;
      o.LastKnown = lastKnown;
      this.Investigate(o, lastKnown, true);
    }
    Sfx.setIntensity(0.9);
  }

  private Investigate(g: Guard, at: V2, radioed: boolean) {
    if (!this.PathTo(g, at)) return;
    g.State = GuardState.Investigate;
    g.Radioed = radioed;
    g.Looking = false;
    g.LastKnown = at;
  }

  private ResumePatrol(g: Guard) {
    g.State = GuardState.Patrol;
    g.Radioed = false;
    g.Looking = false;
    this.PathTo(g, this.grid!.toWorld(g.Route[g.RouteIndex]));
  }

  private NextPatrolLeg(g: Guard) {
    g.RouteIndex = (g.RouteIndex + 1) % g.Route.length;
    this.PathTo(g, this.grid!.toWorld(g.Route[g.RouteIndex]));
  }

  private PathTo(g: Guard, target: V2) {
    const grid = this.grid!;
    const from = grid.toCell(g.Pos);
    let to = grid.toCell(target);
    if (grid.isSolid(to)) to = this.NearestOpen(to);
    if (!grid.findPath(from, to, g.Path)) { g.Path.length = 0; return false; }
    g.PathIndex = 0;
    return true;
  }

  private NearestOpen(c: V2i) {
    for (let r = 1; r < 4; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (!this.grid!.isSolid(c.x + dx, c.y + dy)) return new V2i(c.x + dx, c.y + dy);
    return c;
  }

  private RandomNear(center: V2, radius: number) {
    const grid = this.grid!;
    for (let i = 0; i < 12; i++) {
      const p = center.add(Random.insideUnitCircle.mul(radius));
      const c = grid.toCell(p);
      if (!grid.isSolid(c) && grid.lineOfSight(center, grid.toWorld(c))) return grid.toWorld(c);
    }
    return center;
  }

  /** Moves along the current path (with light string-pulling). Returns true when the path is done. */
  private Follow(g: Guard, speed: number, dt: number) {
    const grid = this.grid!;
    if (g.PathIndex >= g.Path.length) return true;
    while (g.PathIndex + 1 < g.Path.length && g.PathIndex < g.Path.length - 1 &&
      grid.lineOfSight(g.Pos, grid.toWorld(g.Path[g.PathIndex + 1])) && grid.toWorld(g.Path[g.PathIndex]).sub(g.Pos).sqrMagnitude < 0.3)
      g.PathIndex++;
    const target = grid.toWorld(g.Path[g.PathIndex]);
    const to = target.sub(g.Pos);
    const step = speed * dt;
    if (to.magnitude <= step) {
      g.Pos = target;
      g.PathIndex++;
    } else {
      g.Pos = g.Pos.add(to.normalized.mul(step));
      g.TargetFacing = GhostlineGame.Angle(to);
    }
    g.Pos = grid.resolveCircle(g.Pos, 0.28);
    return g.PathIndex >= g.Path.length;
  }

  private static LookAround(g: Guard, dt: number) {
    g.Timer -= dt;
    g.TargetFacing = g.LookBase + Math.sin(g.Timer * 2.2) * 1.2;
  }

  private static Angle(v: V2) { return Math.atan2(v.y, v.x); }

  private TickCamera(c: SecurityCam, dt: number) {
    c.Angle = c.BaseAngle + Math.sin(Time.time * 0.7 + c.Pos.x) * 0.9;
    const range = 7 * (1 + this.alertLevel * 0.1);
    const [sees] = this.Sees(c.Pos, c.Angle, 30 * Mathf.Deg2Rad, range);
    c.Meter = sees ? Math.min(1, c.Meter + dt * 1.6) : Math.max(0, c.Meter - dt * 0.5);
    c.Alarm = Math.max(0, c.Alarm - dt);
    if (c.Meter >= 1 && c.Alarm <= 0) {
      c.Alarm = 5;
      c.Meter = 0.5;
      this.RaiseAlarm(c.Pos, this.pPos, null);
      // Summon the three closest guards.
      this.guards.sort((a, b) => a.Pos.sub(c.Pos).sqrMagnitude - b.Pos.sub(c.Pos).sqrMagnitude);
      for (let i = 0; i < Math.min(3, this.guards.length); i++)
        if (this.guards[i].State !== GuardState.Alert) this.Investigate(this.guards[i], this.pPos, true);
    }
    const state = c.Alarm > 0 ? GuardState.Alert : c.Meter > 0 ? GuardState.Suspicious : GuardState.Patrol;
    c.Lens.color = StateColor[state];
    this.BuildCone(c.Cone, c.Pos, c.Angle, 30 * Mathf.Deg2Rad, range, StateColor[state], 0.16);
  }

  private PresentGuard(g: Guard, range: number, halfFov: number) {
    g.Root.position = g.Pos;
    const c = StateColor[g.State];
    g.Body.color = c;
    g.Nose.transform.localPosition = new V3(Math.cos(g.Facing), Math.sin(g.Facing), 0).mul(0.38);
    g.Nose.transform.localRotation = Quaternion.euler(0, 0, g.Facing * Mathf.Rad2Deg);
    const mark = g.State !== GuardState.Patrol || g.Meter > 0.05;
    g.Mark.gameObject.setActive(mark);
    if (mark) {
      g.Mark.color = g.State === GuardState.Alert ? StateColor[3] : StateColor[1];
      const s = 0.35 + 0.35 * (g.State === GuardState.Alert ? 1 : g.Meter);
      g.Mark.transform.localScale = new V3(s, s, 1);
    }
    this.BuildCone(g.Cone, g.Pos, g.Facing, halfFov, range, c, g.State === GuardState.Alert ? 0.24 : 0.14);
  }

  private BuildCone(mesh: Mesh, origin: V2, facing: number, halfFov: number, range: number, color: Color, alpha: number) {
    const grid = this.grid!;
    this.coneVerts[0] = V3.zero;
    this.coneColors[0] = color.withAlpha(alpha);
    for (let i = 0; i <= ConeRays; i++) {
      const a = facing - halfFov + (2 * halfFov * i) / ConeRays;
      const dir = new V2(Math.cos(a), Math.sin(a));
      const d = grid.raycast(origin, dir, range);
      this.coneVerts[i + 1] = dir.mul(d).toV3();
      this.coneColors[i + 1] = color.withAlpha(alpha * 0.25);
    }
    for (let i = 0; i < ConeRays; i++) {
      this.coneTris[i * 3] = 0;
      this.coneTris[i * 3 + 1] = i + 2;
      this.coneTris[i * 3 + 2] = i + 1;
    }
    mesh.clear();
    // Unity copies the arrays into the mesh; the kit keeps references, so hand it copies.
    mesh.vertices = this.coneVerts.slice();
    mesh.colors = this.coneColors.slice();
    mesh.triangles = this.coneTris.slice();
    mesh.markDirty();
  }

  private AnimateLevel(_dt: number) {
    const t = Time.time;
    for (const s of this.shardSprites) {
      if (!s.gameObject.activeSelf) continue;
      s.transform.localRotation = Quaternion.euler(0, 0, t * 90);
      const k = 0.55 * (1 + 0.12 * Math.sin(t * 4));
      s.transform.localScale = new V3(k, k, 1);
    }
    const pulse = this.exitOpen ? 1 + 0.2 * Math.sin(t * 5) : 1;
    this.exitRing.transform.localScale = new V3(1.8 * pulse, 1.8 * pulse, 1);
    this.exitRing.color = ExitColor.withAlpha(this.exitOpen ? 0.8 : 0.15);
    this.exitSprite.color = ExitColor.withAlpha(this.exitOpen ? 0.55 : 0.12);
  }

  // ------------------------------------------------------------------ HUD / outcomes

  private UpdateHud() {
    this.levelText.text = "FACILITY " + this.level;
    this.scoreText.text = Fmt.n(this.score) + " PTS";
    this.shardText.text = this.exitOpen ? "REACH THE EXIT" : `DATA SHARDS ${3 - this.shardsLeft.length}/3`;
    this.shardText.color = this.exitOpen ? ExitColor : ShardColor;

    let alert = false;
    let meter = 0;
    for (const g of this.guards) {
      if (g.State === GuardState.Alert) alert = true;
      meter = Math.max(meter, g.Meter);
    }
    for (const c of this.cams) { meter = Math.max(meter, c.Meter); if (c.Alarm > 0) alert = true; }
    if (this.cloakTime > 0) { this.statusText.text = "CLOAKED"; this.statusText.color = PlayerColor; }
    else if (alert) { this.statusText.text = "DETECTED"; this.statusText.color = StateColor[3]; }
    else if (meter > 0.05) { this.statusText.text = "SUSPICIOUS"; this.statusText.color = StateColor[1]; }
    else { this.statusText.text = "HIDDEN"; this.statusText.color = StateColor[0]; }
    this.Back.setDanger(alert ? 0.8 : meter * 0.4);
    if (!alert) Sfx.setIntensity(0.1 + meter * 0.5);

    for (let i = 0; i < this.alertPips.length; i++) this.alertPips[i].color = i < this.alertLevel ? StateColor[3] : new Color(1, 1, 1, 0.12);
    this.cloakFill.fillAmount = this.cloakCooldown / 11;
    this.cloakButton.interactable = this.cloakCooldown <= 0;
    this.decoyButton.label!.text = "DECOY " + this.decoys;
    this.decoyButton.interactable = this.decoys > 0;
  }

  private CompleteLevel() {
    const ghost = this.spotted === 0;
    const timeBonus = Math.max(0, Mathf.roundToInt((150 - this.levelTime) * 5));
    const levelScore = 1000 + timeBonus + (ghost ? 750 : 0);
    this.score += levelScore;
    Sfx.play(Snd.Win);
    this.Fx.burst(this.pPos, ExitColor, 50, 7);
    this.Data.add("levels", 1);
    if (ghost) this.Data.add("ghosts", 1);
    const newBest = this.Data.max("best", this.score);
    this.Data.max("bestLevel", this.level);
    this.next = Next.NextLevel;
    this.Finish(new Result({
      Headline: ghost ? "GHOST RUN!" : "INFILTRATION COMPLETE",
      HeadlineColor: ExitColor,
      Value: Fmt.n(this.score),
      CountTo: this.score,
      NewBest: newBest,
      BestLine: "BEST  " + Fmt.n(this.Data.get("best")),
      Stats: [
        ["FACILITY", String(this.level)],
        ["TIME", Fmt.clock(this.levelTime)],
        ["TIME BONUS", "+" + Fmt.n(timeBonus)],
        ["GHOST BONUS", ghost ? "+750" : "SPOTTED x" + this.spotted],
      ],
      Primary: "NEXT FACILITY",
      Victory: true,
    }));
  }

  private Caught(_g: Guard) {
    Sfx.play(Snd.Hurt);
    Sfx.play(Snd.Lose);
    this.Fx.shake(0.8);
    this.Fx.burst(this.pPos, Pal.Danger, 40, 6);
    this.Back.Flash(Pal.Danger, 0.35);
    Fx.haptic(true);
    if (!this.escaped) this.Data.add("runs", 1);
    const newBest = this.Data.max("best", this.score);
    this.Data.max("bestLevel", this.level);
    this.next = Next.Retry;
    this.Finish(new Result({
      Headline: "CAUGHT",
      HeadlineColor: Pal.Danger,
      Value: Fmt.n(this.score),
      CountTo: this.score,
      NewBest: newBest && this.score > 0,
      BestLine: "BEST  " + Fmt.n(this.Data.get("best")),
      Stats: [
        ["FACILITY", String(this.level)],
        ["SHARDS", 3 - this.shardsLeft.length + "/3"],
        ["TIMES SPOTTED", String(this.spotted)],
        ["TIME", Fmt.clock(this.levelTime)],
      ],
      Primary: "RETRY FACILITY",
      Reward: this.escaped ? null : () => this.EscapeFromAd(),
      RewardLabel: "ESCAPE: WATCH AN AD",
    }));
  }

  /** Rewarded continue (once per facility): back to the entrance, guards stand down, free cloak. */
  private EscapeFromAd() {
    this.escaped = true;
    this.pPos = this.grid!.toWorld(this.facility.Start);
    this.camPos = this.pPos;
    this.cloakTime = 3;
    for (const g of this.guards) {
      g.Meter = 0;
      g.LostTimer = 0;
      this.ResumePatrol(g);
    }
    this.Fx.burst(this.pPos, PlayerColor, 30, 4);
    Sfx.play(Snd.Whoosh);
    this.Revive();
    this.UI.Announce("ESCAPED", PlayerColor);
  }
}
