import {
  ArcadeButton, ArcadeGame, Art, Choice, Color, Ease, Fmt, Fx, GameInfo, GameObject, howTo, Image, ImageType, LineRenderer, Mathf, Pal,
  Phase, Quaternion, Random, Rect, Result, Sfx, Snd, Sprite, SpriteRenderer, Text, TouchScheme, UIKit, V2, V3,
} from "../../kit";
import { Foe, HiveMind, Tactic } from "./HiveMind";

/**
 * SWARMBREAKER: twin-stick arena shooter against an adaptive hive mind.
 * Drones flock (boids) and encircle, flankers circle behind your aim and lunge, snipers lead their shots,
 * wardens shield their allies, and every fifth wave a Hive core arrives. Between waves you pick an upgrade;
 * the hive picks a counter to how you played. (Port of SwarmbreakerGame.cs.)
 */

class Enemy {
  Type = Foe.Drone;
  Pos = V2.zero; Vel = V2.zero; Knock = V2.zero; AimPoint = V2.zero; LungeDir = V2.zero;
  Hp = 0; MaxHp = 0; Radius = 0; Speed = 0; Age = 0; Heading = 0; Timer = 0; Flash = 0; Side = 0;
  Mode = 0;
  Ward: Enemy | null = null;
  Go!: GameObject;
  Body!: SpriteRenderer; Halo!: SpriteRenderer; Shield!: SpriteRenderer;
  Laser!: LineRenderer;
}

class Shot {
  Pos = V2.zero; Vel = V2.zero;
  Life = 0; Damage = 0;
  Pierce = 0;
  Hostile = false;
  LastHit: Enemy | null = null;
  Sr!: SpriteRenderer;
}

class Pending {
  Type = Foe.Drone;
  Pos = V2.zero;
  T = 0;
  Marker!: SpriteRenderer;
}

interface Pillar {
  Pos: V2;
  Radius: number;
  Body: SpriteRenderer; Rim: SpriteRenderer;
}

const PlayerColor = Pal.hex(0x4de8ff);
const FoeColor = [Pal.hex(0xff4d6a), Pal.hex(0xff8a3d), Pal.hex(0xe45cff), Pal.hex(0x8c9cff), Pal.hex(0xff3bd0)];
const FoePoints = [10, 25, 40, 50, 500];
const PlayerRadius = 0.35;

/** Application.isMobilePlatform (kit gap: no equivalent in the kit). */
const isMobilePlatform = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

const choice = (title: string, body: string, color: Color, icon: Sprite | null): Choice => ({ title, body, color, icon });

export class SwarmbreakerGame extends ArcadeGame {
  private world!: GameObject;
  private arena = new Rect();

  // player
  private pPos = V2.zero; private pVel = V2.zero; private aim = V2.up;
  private moveSpeed = 0; private fireRate = 0; private fireTimer = 0; private damage = 0; private bulletSpeed = 0; private bulletLife = 0;
  private invulnerable = 0; private dashTime = 0; private dashCooldown = 0; private dashCooldownMax = 0; private wingTimer = 0;
  private barrels = 0; private pierce = 0; private hp = 0; private maxHp = 0; private wingmen = 0;
  private shockDash = false; private dashRequested = false; private revived = false;
  private killsReported = 0;
  private dashDir = V2.zero;
  private pBody!: SpriteRenderer; private pHalo!: SpriteRenderer; private pReticle!: SpriteRenderer;
  private readonly wingSprites: SpriteRenderer[] = [];

  // world
  private readonly pillars: Pillar[] = [];
  private readonly enemies: Enemy[] = [];
  private readonly enemyPool: Enemy[] = [];
  private readonly bullets: Shot[] = [];
  private readonly shotPool: Shot[] = [];
  private readonly pending: Pending[] = [];
  private readonly markerPool: SpriteRenderer[] = [];
  private readonly queue: Foe[] = [];
  private readonly hive = new HiveMind();
  private readonly alive: number[] = new Array(HiveMind.FoeCount).fill(0);
  private spawnTimer = 0; private waveEndTimer = 0; private multTimer = 0; private attractClock = 0;
  private wave = 0; private score = 0; private kills = 0; private multiplier = 1;
  private waveRunning = false;

  // HUD
  private scoreText!: Text; private waveText!: Text; private multText!: Text; private tacticText!: Text;
  private readonly hearts: Image[] = [];
  private dashButton!: ArcadeButton;
  private dashFill!: Image;

  protected get AimOrigin() { return this.pPos; }

  protected Describe() {
    return new GameInfo({
      Id: "swarmbreaker",
      Reminders: [
        "The hive has evolved|It studied your last run. Go prove it wrong.",
        "Hostiles inbound|A new swarm is massing at the edge of the arena.",
        "Your hull is repaired|The arena is waiting, pilot.",
      ],
      Title: "SWARMBREAKER",
      Tagline: "OUTFIGHT A HIVE MIND THAT LEARNS YOU",
      Accent: PlayerColor,
      Accent2: Pal.hex(0xff4db8),
      BgTop: Pal.hex(0x1a0826),
      BgBottom: Pal.hex(0x04030c),
      ShortSide: 18,
      Touch: TouchScheme.TwinStick,
      Music: { bpm: 128, rootHz: 73.42, degrees: [0, 5, 3, 4], seed: 21, energy: 1 },
      HowTo: [
        howTo(Art.Chevron, PlayerColor, "Move: left stick / WASD. Aim + fire: right stick / mouse button."),
        howTo(Art.Diamond, PlayerColor, "DASH through danger: Space, right-click or the DASH button."),
        howTo(Art.Tri, FoeColor[0], "DRONES flock together and try to SURROUND you."),
        howTo(Art.Chevron, FoeColor[1], "FLANKERS circle behind your aim, then lunge."),
        howTo(Art.Diamond, FoeColor[2], "SNIPERS predict where you'll be. Watch the laser, then juke."),
        howTo(Art.Hex, FoeColor[3], "WARDENS shield allies from the front. Hit them from the side."),
        howTo(Art.Octagon, FoeColor[4], "The HIVE studies you and counters your style every wave."),
      ],
      Tips: [
        "The hive counters what you do most. Switch up your style.",
        "Dashing makes you invulnerable for a moment.",
        "Snipers lock their aim just before firing: change direction then.",
        "Wardens only block from the front. Circle them.",
        "Chain kills quickly to push your multiplier to x8.",
      ],
    });
  }

  protected BestLine() {
    const best = this.Data.get("best");
    return best > 0 ? `BEST  ${Fmt.n(best)}   ·   WAVE ${this.Data.get("bestWave")}` : "";
  }

  protected StatsLine() {
    return this.Data.get("runs") > 0 ? `${Fmt.n(this.Data.get("runs"))} RUNS  ·  ${Fmt.n(this.Data.get("kills"))} KILLS` : "TWIN-STICK ARENA SHOOTER";
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("World", this.gameObject);
    this.pHalo = Art.spr(this.world, "Player Halo", Art.Glow, PlayerColor.withAlpha(0.5), 2.2, 24, Art.Additive);
    this.pBody = Art.spr(this.world, "Player", Art.Chevron, PlayerColor, 0.9, 26);
    this.pReticle = Art.spr(this.world, "Reticle", Art.ThinRing, PlayerColor.withAlpha(0.5), 0.5, 26, Art.Additive);
    this.BuildHud();
    this.LayoutArena();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.scoreText = UIKit.at(UIKit.label(hud, "0", 72, Pal.Text), new V2(0.5, 1), new V2(0, -60), new V2(600, 90));
    UIKit.glow(this.scoreText, PlayerColor.withAlpha(0.35));
    this.waveText = UIKit.at(UIKit.label(hud, "", 30, Pal.TextDim), new V2(0.5, 1), new V2(0, -122), new V2(600, 40));
    this.tacticText = UIKit.at(UIKit.label(hud, "", 26, this.Info.Accent2), new V2(0.5, 1), new V2(0, -160), new V2(700, 36));
    this.multText = UIKit.at(UIKit.label(hud, "", 46, Pal.Warn), new V2(1, 1), new V2(-230, -85), new V2(160, 70));
    for (let i = 0; i < 8; i++) {
      const h = UIKit.img(hud, "Hull", Art.Hex, PlayerColor);
      h.rectTransform.place(new V2(0, 1), new V2(60 + i * 52, -70), new V2(44, 44));
      this.hearts.push(h);
    }
    this.dashButton = UIKit.buttonAt(hud, "DASH", new V2(1, 0), new V2(-120, 190), new V2(170, 170), false, () => (this.dashRequested = true), 36);
    this.dashButton.setAccent(PlayerColor);
    this.dashFill = UIKit.img(this.dashButton.transform, "Cooldown", Art.UiCircle, PlayerColor.withAlpha(0.25));
    this.dashFill.rectTransform.stretch(8);
    this.dashFill.type = ImageType.Filled;
    this.dashFill.fillMethod = "Radial360";
    this.dashFill.fillOrigin = 2; // Image.Origin360.Top
  }

  protected OnLayoutChanged() { this.LayoutArena(); }

  private LayoutArena() {
    this.arena = this.PlayRect(200, 40, 0.4);
    this.Fx.CameraTarget = V2.zero;
  }

  // ------------------------------------------------------------------ run lifecycle

  protected OnEnterTitle() {
    this.ClearWorld();
    this.SetPlayerVisible(false);
    this.attractClock = 0;
    for (let i = 0; i < 14; i++) this.Spawn(Foe.Drone, Random.insideUnitCircle.mul(4));
  }

  protected BeginRun() {
    this.ClearWorld();
    this.LayoutArena();
    this.pPos = this.arena.center;
    this.pVel = V2.zero;
    this.moveSpeed = 7;
    this.fireRate = 7;
    this.damage = 1;
    this.bulletSpeed = 20;
    this.bulletLife = 0.8;
    this.barrels = 1;
    this.pierce = 0;
    this.maxHp = this.hp = 5;
    this.wingmen = 0;
    this.shockDash = false;
    this.revived = false;
    this.killsReported = 0;
    this.dashCooldownMax = 1.1;
    this.dashCooldown = this.dashTime = this.invulnerable = 0;
    this.wave = this.score = this.kills = 0;
    this.multiplier = 1;
    for (const w of this.wingSprites) w.gameObject.setActive(false);
    this.SetPlayerVisible(true);
    this.dashButton.gameObject.setActive(this.Controls.usingTouch || isMobilePlatform());
    this.NextWave();
  }

  private NextWave() {
    this.wave++;
    this.BuildPillars();
    const [roster, insight] = this.hive.Plan(this.wave, Mathf.clamp((this.arena.width * this.arena.height) / 250, 0.7, 1.4));
    this.hive.BeginWave();
    this.queue.length = 0;
    this.queue.push(...roster);
    this.spawnTimer = 1.2;
    this.waveRunning = true;
    this.waveEndTimer = 0;
    this.UI.Announce(this.wave % 5 === 0 ? "WAVE " + this.wave + ": HIVE CORE" : "WAVE " + this.wave, this.wave % 5 === 0 ? FoeColor[4] : PlayerColor);
    this.UI.Hint(insight != null ? "HIVE ANALYSIS: " + insight : null);
    if (insight != null) Sfx.play(Snd.Alarm, 0.5);
    Sfx.setIntensity(0.4 + Math.min(this.wave * 0.06, 0.6));
  }

  private ClearWorld() {
    for (let i = this.enemies.length - 1; i >= 0; i--) this.Recycle(this.enemies[i]);
    this.enemies.length = 0;
    for (const s of this.bullets) { s.Sr.gameObject.setActive(false); this.shotPool.push(s); }
    this.bullets.length = 0;
    for (const p of this.pending) { p.Marker.gameObject.setActive(false); this.markerPool.push(p.Marker); }
    this.pending.length = 0;
    this.queue.length = 0;
    for (const p of this.pillars) { p.Body.gameObject.destroy(); p.Rim.gameObject.destroy(); }
    this.pillars.length = 0;
    this.Fx.clearParticles();
    this.UI.Hint(null);
  }

  private SetPlayerVisible(on: boolean) {
    this.pBody.gameObject.setActive(on);
    this.pHalo.gameObject.setActive(on);
    this.pReticle.gameObject.setActive(on);
  }

  private BuildPillars() {
    const arena = this.arena;
    for (const p of this.pillars) { p.Body.gameObject.destroy(); p.Rim.gameObject.destroy(); }
    this.pillars.length = 0;
    const count = Random.rangeInt(2, 5);
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const r = Random.range(0.7, 1.2);
        const pos = new V2(Random.range(arena.xMin + 2.5, arena.xMax - 2.5), Random.range(arena.yMin + 2.5, arena.yMax - 2.5));
        if (pos.sub(this.pPos).sqrMagnitude < 9) continue;
        let overlaps = false;
        for (const o of this.pillars) if (o.Pos.sub(pos).magnitude < o.Radius + r + 2) overlaps = true;
        if (overlaps) continue;
        const body = Art.spr(this.world, "Pillar", Art.Octagon, Pal.hex(0x1c1640), r * 2, 5);
        body.transform.position = pos;
        const rim = Art.spr(this.world, "Pillar Rim", Art.ThinRing, this.Info.Accent2.withAlpha(0.6), r * 2.15, 6, Art.Additive);
        rim.transform.position = pos;
        this.pillars.push({ Pos: pos, Radius: r, Body: body, Rim: rim });
        break;
      }
    }
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.State !== Phase.Title) return;
    this.attractClock += dt;
    const target = new V2(Math.sin(this.attractClock * 0.5) * this.arena.width * 0.3, Math.sin(this.attractClock * 0.37) * this.arena.height * 0.3);
    for (const e of this.enemies) {
      e.Age += dt;
      const steer = this.Flock(e).add(target.sub(e.Pos).normalized.mul(1.2));
      e.Vel = V2.clampMagnitude(e.Vel.add(steer.mul(6 * dt)), 3.5);
      e.Pos = e.Pos.add(e.Vel.mul(dt));
      this.KeepInArena(e);
      this.Present(e);
    }
  }

  protected TickRun(dt: number) {
    this.UpdatePlayer(dt);
    this.UpdateSpawning(dt);
    this.UpdateEnemies(dt);
    this.UpdateShots(dt);
    this.UpdateWingmen(dt);

    this.multTimer -= dt;
    if (this.multTimer <= 0 && this.multiplier > 1) {
      this.multiplier--;
      this.multTimer = 1.2;
    }

    if (this.hive.Command(dt, this.alive) && this.enemies.length > 3)
      this.UI.Float(this.pPos.add(V2.up.mul(1.5)), "HIVE: " + HiveMind.Describe(this.hive.Current), this.Info.Accent2, 0.8);

    if (this.waveRunning && this.queue.length === 0 && this.pending.length === 0 && this.enemies.length === 0) {
      this.waveRunning = false;
      this.waveEndTimer = 1.1;
      Sfx.play(Snd.Win, 0.7);
      this.UI.Announce("WAVE " + this.wave + " CLEARED", Pal.Good);
      this.UI.Hint(null);
      for (const s of this.bullets) if (s.Hostile) s.Life = 0;
    }
    if (!this.waveRunning && this.waveEndTimer > 0) {
      this.waveEndTimer -= dt;
      if (this.waveEndTimer <= 0) this.OfferUpgrades();
    }

    this.UpdateHud();
  }

  // ------------------------------------------------------------------ player

  private UpdatePlayer(dt: number) {
    const C = this.Controls, arena = this.arena;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);

    if ((C.actionPressed || this.dashRequested) && this.dashCooldown <= 0 && this.dashTime <= 0) {
      this.dashDir = C.move.sqrMagnitude > 0.05 ? C.move.normalized : this.pVel.sqrMagnitude > 0.5 ? this.pVel.normalized : this.aim;
      this.dashTime = 0.17;
      this.dashCooldown = this.dashCooldownMax;
      this.hive.Dashes++;
      Sfx.play(Snd.Whoosh);
      this.Fx.spray(this.pPos, this.dashDir.neg(), PlayerColor, 14, 6, 0.5);
    }
    this.dashRequested = false;

    if (this.dashTime > 0) {
      this.dashTime -= dt;
      this.pVel = this.dashDir.mul(21);
      if (this.shockDash)
        for (let i = this.enemies.length - 1; i >= 0; i--) {
          const e = this.enemies[i];
          const r = e.Radius + 0.8;
          if (e.Age > 0.3 && e.Pos.sub(this.pPos).sqrMagnitude < r * r) this.Damage(e, 30 * dt, this.dashDir); // ~5 per dash
        }
    } else {
      const target = C.move.mul(this.moveSpeed);
      this.pVel = V2.lerp(this.pVel, target, 1 - Math.exp(-dt * 14));
    }

    this.pPos = this.pPos.add(this.pVel.mul(dt));
    this.pPos = new V2(Mathf.clamp(this.pPos.x, arena.xMin + PlayerRadius, arena.xMax - PlayerRadius),
      Mathf.clamp(this.pPos.y, arena.yMin + PlayerRadius, arena.yMax - PlayerRadius));
    for (const p of this.pillars) this.pPos = SwarmbreakerGame.PushOut(this.pPos, PlayerRadius, p);

    if (C.aimActive) this.aim = C.aim;
    else if (C.move.sqrMagnitude > 0.05 && !C.usingTouch) this.aim = V2.lerp(this.aim, C.move.normalized, dt * 4).normalized;

    this.fireTimer -= dt;
    if (C.fire && this.fireTimer <= 0) {
      this.fireTimer = 1 / this.fireRate;
      this.FirePlayer();
    }

    let nearest = 99;
    for (const e of this.enemies) nearest = Math.min(nearest, e.Pos.sub(this.pPos).magnitude);
    this.hive.Observe(dt, nearest, this.pVel.magnitude);

    const angle = Math.atan2(this.aim.y, this.aim.x) * Mathf.Rad2Deg;
    this.pBody.transform.setPositionAndRotation(this.pPos, Quaternion.euler(0, 0, angle));
    this.pHalo.transform.position = this.pPos;
    const blink = this.invulnerable > 0 && Mathf.repeat(this.RunTime * 12, 1) < 0.5;
    this.pBody.color = blink ? PlayerColor.withAlpha(0.3) : this.dashTime > 0 ? Color.white : PlayerColor;
    this.pHalo.color = PlayerColor.withAlpha(this.dashTime > 0 ? 0.9 : 0.45);
    this.pReticle.transform.position = this.pPos.add(this.aim.mul(2.2));
    this.pReticle.color = PlayerColor.withAlpha(C.aimActive ? 0.6 : 0.15);
  }

  private FirePlayer() {
    const spread = 8 * Mathf.Deg2Rad;
    const start = -(this.barrels - 1) * 0.5 * spread;
    const baseAngle = Math.atan2(this.aim.y, this.aim.x);
    for (let i = 0; i < this.barrels; i++) {
      const a = baseAngle + start + i * spread;
      const dir = new V2(Math.cos(a), Math.sin(a));
      this.SpawnShot(this.pPos.add(dir.mul(0.5)), dir.mul(this.bulletSpeed), this.bulletLife, this.damage, this.pierce, false);
      this.hive.Shots++;
    }
    Sfx.play(Snd.Shoot, 0.35, Random.range(0.95, 1.08));
    this.Fx.spray(this.pPos.add(this.aim.mul(0.5)), this.aim, PlayerColor, 2, 5, 0.3, 0.12, 0.12);
  }

  private UpdateWingmen(dt: number) {
    this.wingTimer -= dt;
    for (let i = 0; i < this.wingmen; i++) {
      const a = this.RunTime * 2.5 + (i * Math.PI * 2) / this.wingmen;
      const wp = this.pPos.add(new V2(Math.cos(a), Math.sin(a)).mul(1.3));
      this.wingSprites[i].transform.position = wp;
      if (this.wingTimer > 0) continue;
      let target: Enemy | null = null;
      let best = 64;
      for (const e of this.enemies) {
        const d = e.Pos.sub(wp).sqrMagnitude;
        if (d < best && e.Age > 0.3) { best = d; target = e; }
      }
      if (target != null) this.SpawnShot(wp, target.Pos.sub(wp).normalized.mul(18), 0.8, this.damage * 0.7, 0, false);
    }
    if (this.wingTimer <= 0) this.wingTimer = 0.55;
  }

  private HurtPlayer(source: Foe) {
    if (this.invulnerable > 0 || this.dashTime > 0) return;
    this.hp--;
    this.invulnerable = 1.3;
    this.multiplier = 1;
    this.hive.DamageBy[source] += 1;
    this.Fx.shake(0.7);
    this.Fx.kick(0.8, 0.9);
    this.Fx.burst(this.pPos, Pal.Danger, 24, 7);
    this.Back.Flash(Pal.Danger, 0.3);
    Sfx.play(Snd.Hurt);
    Fx.haptic(true);
    this.Hitstop(0.08);
    for (const e of this.enemies) {
      const d = e.Pos.sub(this.pPos);
      if (d.sqrMagnitude < 16) e.Knock = e.Knock.add(d.normalized.mul(8));
    }
    for (const s of this.bullets) if (s.Hostile && s.Pos.sub(this.pPos).sqrMagnitude < 9) s.Life = 0;
    if (this.hp <= 0) this.GameOver();
  }

  private GameOver() {
    this.SetPlayerVisible(false);
    this.Fx.burst(this.pPos, PlayerColor, 60, 10, 0.35, 1);
    this.Fx.ring(this.pPos, PlayerColor, 0.5, 10, 0.8);
    this.Fx.shake(1);
    Sfx.play(Snd.Boom);
    Sfx.play(Snd.Lose);
    const newBest = this.Data.max("best", this.score);
    this.Data.max("bestWave", this.wave);
    if (!this.revived) this.Data.add("runs", 1);
    this.Data.add("kills", this.kills - this.killsReported);
    this.killsReported = this.kills;
    const accuracy = this.hive.Shots > 0 ? this.hive.Hits / this.hive.Shots : 0;
    this.Finish(new Result({
      Headline: "HULL BREACHED",
      HeadlineColor: Pal.Danger,
      Value: Fmt.n(this.score),
      CountTo: this.score,
      NewBest: newBest && this.score > 0,
      BestLine: "BEST  " + Fmt.n(this.Data.get("best")),
      Stats: [
        ["WAVE", String(this.wave)],
        ["KILLS", Fmt.n(this.kills)],
        ["ACCURACY (LAST WAVE)", Mathf.roundToInt(accuracy * 100) + "%"],
        ["TIME", Fmt.clock(this.RunTime)],
      ],
      Reward: this.revived ? null : () => this.ReviveFromAd(),
      RewardLabel: "REVIVE: WATCH AN AD",
    }));
  }

  /** Rewarded continue (once per run): 3 hull, a shockwave clear and a moment of invulnerability. */
  private ReviveFromAd() {
    this.revived = true;
    this.hp = Math.min(3, this.maxHp);
    this.invulnerable = 3;
    this.SetPlayerVisible(true);
    for (const s of this.bullets) if (s.Hostile) s.Life = 0;
    for (const e of this.enemies) {
      const d = e.Pos.sub(this.pPos);
      if (d.sqrMagnitude < 36) e.Knock = e.Knock.add(d.normalized.mul(12));
    }
    this.Fx.ring(this.pPos, PlayerColor, 0.5, 12, 0.6);
    this.Fx.kick(1.5, 0.4);
    Sfx.play(Snd.PowerUp);
    this.Revive();
    this.UI.Announce("REVIVED", PlayerColor);
  }

  // ------------------------------------------------------------------ upgrades

  private OfferUpgrades() {
    const pool = [0, 1, 2, 3, 4, 5, 8, 9];
    if (this.hp < this.maxHp) pool.push(6);
    if (this.wingmen < 3) pool.push(7);
    const remove = (v: number) => { const i = pool.indexOf(v); if (i >= 0) pool.splice(i, 1); };
    if (this.barrels >= 5) remove(1);
    if (this.shockDash) remove(8);
    const picks: number[] = [];
    while (picks.length < 3 && pool.length > 0) {
      const i = Random.rangeInt(0, pool.length);
      picks.push(pool[i]);
      pool.splice(i, 1);
    }
    const cards = picks.map((p) => SwarmbreakerGame.UpgradeCard(p));
    Sfx.play(Snd.PowerUp, 0.7);
    this.UI.ShowChoices("CHOOSE AN UPGRADE", cards, (index) => {
      this.ApplyUpgrade(picks[index]);
      Sfx.play(Snd.Confirm);
      this.NextWave();
    });
  }

  private static UpgradeCard(id: number): Choice {
    switch (id) {
      case 0: return choice("RAPID FIRE", "+25% fire rate.", Pal.Warn, Art.Tri);
      case 1: return choice("TWIN BARRELS", "+1 projectile per shot.", Pal.Cyan, Art.Chevron);
      case 2: return choice("PIERCING ROUNDS", "Shots pass through one more enemy.", Pal.Violet, Art.Diamond);
      case 3: return choice("HEAVY SLUGS", "+50% damage per shot.", Pal.Orange, Art.Hex);
      case 4: return choice("THRUSTERS", "+12% speed, faster dash recharge.", Pal.Good, Art.Chevron);
      case 5: return choice("HULL PLATING", "+1 max hull and repair 1.", Pal.Cyan, Art.Hex);
      case 6: return choice("NANO REPAIR", "Repair 2 hull.", Pal.Good, Art.Plus);
      case 7: return choice("WINGMAN DRONE", "An orbiting drone that fires at the nearest enemy.", Pal.Magenta, Art.Disc);
      case 8: return choice("SHOCK DASH", "Dashing through enemies damages them.", Pal.Warn, Art.Star);
      default: return choice("OVERCHARGE", "+25% shot speed and range.", Pal.Violet, Art.Ring);
    }
  }

  private ApplyUpgrade(id: number) {
    switch (id) {
      case 0: this.fireRate *= 1.25; break;
      case 1: this.barrels = Math.min(5, this.barrels + 1); break;
      case 2: this.pierce++; break;
      case 3: this.damage *= 1.5; break;
      case 4: this.moveSpeed *= 1.12; this.dashCooldownMax *= 0.85; break;
      case 5: this.maxHp = Math.min(8, this.maxHp + 1); this.hp = Math.min(this.maxHp, this.hp + 1); break;
      case 6: this.hp = Math.min(this.maxHp, this.hp + 2); break;
      case 7:
        this.wingmen++;
        while (this.wingSprites.length < this.wingmen)
          this.wingSprites.push(Art.spr(this.world, "Wingman", Art.Disc, Pal.Magenta, 0.35, 26));
        for (let i = 0; i < this.wingSprites.length; i++) this.wingSprites[i].gameObject.setActive(i < this.wingmen);
        break;
      case 8: this.shockDash = true; break;
      default: this.bulletSpeed *= 1.25; this.bulletLife *= 1.25; break;
    }
  }

  // ------------------------------------------------------------------ enemies

  private UpdateSpawning(dt: number) {
    const arena = this.arena;
    this.spawnTimer -= dt;
    if (this.queue.length > 0 && this.spawnTimer <= 0) {
      const burst = Math.min(this.queue.length, Random.rangeInt(2, 5));
      for (let i = 0; i < burst; i++) {
        const type = this.queue[0];
        this.queue.splice(0, 1);
        const pos = type === Foe.Hive ? new V2(arena.center.x, arena.yMax - 2) : this.EdgePoint();
        const marker = this.markerPool.pop() ?? Art.spr(this.world, "Warning", Art.Ring, Color.white, 1, 18, Art.Additive);
        marker.gameObject.setActive(true);
        marker.transform.position = pos;
        const p = new Pending();
        p.Type = type; p.Pos = pos; p.T = 0; p.Marker = marker;
        this.pending.push(p);
      }
      Sfx.play(Snd.Warn, 0.6);
      this.spawnTimer = Mathf.lerp(2.4, 1.2, this.wave / 15);
    }

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.T += dt;
      const k = Mathf.clamp01(p.T / 0.9);
      const s = Mathf.lerp(2.8, 1, Ease.outCubic(k)) * (p.Type === Foe.Hive ? 2.5 : 1);
      p.Marker.transform.localScale = new V3(s, s, 1);
      p.Marker.color = FoeColor[p.Type].withAlpha(0.3 + 0.5 * Math.abs(Math.sin(p.T * 12)));
      if (k < 1) continue;
      this.Spawn(p.Type, p.Pos);
      this.Fx.ring(p.Pos, FoeColor[p.Type], 0.4, 2.4, 0.35);
      p.Marker.gameObject.setActive(false);
      this.markerPool.push(p.Marker);
      this.pending.splice(i, 1);
    }
  }

  private EdgePoint() {
    const arena = this.arena;
    for (let attempt = 0; attempt < 12; attempt++) {
      let p: V2;
      const x = Random.range(arena.xMin + 1, arena.xMax - 1), y = Random.range(arena.yMin + 1, arena.yMax - 1);
      switch (Random.rangeInt(0, 4)) {
        case 0: p = new V2(arena.xMin + 1, y); break;
        case 1: p = new V2(arena.xMax - 1, y); break;
        case 2: p = new V2(x, arena.yMin + 1); break;
        default: p = new V2(x, arena.yMax - 1); break;
      }
      if (p.sub(this.pPos).sqrMagnitude > 25) return p;
    }
    return arena.center.add(arena.center.sub(this.pPos).normalized.mul(5));
  }

  private Spawn(type: Foe, pos: V2) {
    const e = this.enemyPool.pop() ?? this.CreateEnemy();
    e.Go.setActive(true);
    e.Type = type;
    e.Pos = pos;
    e.Vel = e.Knock = V2.zero;
    e.Age = e.Timer = e.Flash = 0;
    e.Mode = 0;
    e.Ward = null;
    e.Side = Random.value < 0.5 ? -1 : 1;
    e.Laser.gameObject.setActive(false);
    e.Shield.gameObject.setActive(type === Foe.Warden);
    const scale = 1 + (this.wave - 1) * 0.07;
    const c = FoeColor[type];
    switch (type) {
      case Foe.Drone: SwarmbreakerGame.Setup(e, Art.Tri, 0.7, 0.3, 2 * scale, 3.4 + Math.min(this.wave * 0.08, 1.8)); break;
      case Foe.Flanker: SwarmbreakerGame.Setup(e, Art.Chevron, 0.85, 0.36, 3 * scale, 5); e.Timer = Random.range(1.5, 3); break;
      case Foe.Sniper: SwarmbreakerGame.Setup(e, Art.Diamond, 0.85, 0.38, 4 * scale, 3.2); e.Timer = Random.range(1.5, 2.5); break;
      case Foe.Warden: SwarmbreakerGame.Setup(e, Art.Hex, 1.1, 0.5, 9 * scale, 2.1); break;
      case Foe.Hive: SwarmbreakerGame.Setup(e, Art.Octagon, 2.6, 1.2, 60 + this.wave * 10, 1.2); e.Timer = 2; break;
    }
    e.Body.color = c;
    e.Halo.color = c.withAlpha(0.4);
    e.Heading = Math.atan2(this.pPos.y - pos.y, this.pPos.x - pos.x);
    this.enemies.push(e);
    this.alive[type]++;
    this.Present(e);
    return e;
  }

  private static Setup(e: Enemy, s: Sprite, size: number, radius: number, hp: number, speed: number) {
    e.Body.sprite = s;
    e.Body.transform.localScale = new V3(size, size, 1);
    e.Halo.transform.localScale = new V3(size * 2.2, size * 2.2, 1);
    e.Radius = radius;
    e.MaxHp = e.Hp = hp;
    e.Speed = speed;
  }

  private CreateEnemy() {
    const e = new Enemy();
    e.Go = new GameObject("Enemy", this.world);
    e.Halo = Art.spr(e.Go, "Halo", Art.Glow, Color.white, 1, 19, Art.Additive);
    e.Body = Art.spr(e.Go, "Body", Art.Tri, Color.white, 1, 20);
    e.Shield = Art.spr(e.Go, "Shield", Art.shape("warden-shield", (p) => {
      const a = Math.abs(Math.atan2(p.y, p.x));
      return Art.edge(0.08 - Math.abs(p.magnitude - 0.85)) * (a < 1.05 ? 1 : 0);
    }), FoeColor[Foe.Warden], 2.4, 21, Art.Additive);
    e.Laser = Art.line(e.Go, "Laser", FoeColor[Foe.Sniper], 0.05, 17);
    e.Laser.positionCount = 2;
    return e;
  }

  private Recycle(e: Enemy) {
    e.Go.setActive(false);
    this.enemyPool.push(e);
  }

  private UpdateEnemies(dt: number) {
    for (let i = 0; i < this.alive.length; i++) this.alive[i] = 0;
    for (const e of this.enemies) this.alive[e.Type]++;

    // Surround: hand out evenly spaced slots around the player, ordered by current bearing.
    let ring: Enemy[] | null = null;
    if (this.hive.Current === Tactic.Surround && this.hive.TacticAge < 4) {
      ring = [];
      for (const e of this.enemies) if (e.Type === Foe.Drone) ring.push(e);
      ring.sort((a, b) => this.Bearing(a) - this.Bearing(b));
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.Age += dt;
      e.Flash = Math.max(0, e.Flash - dt * 6);
      const toPlayer = this.pPos.sub(e.Pos);
      const dist = toPlayer.magnitude;
      const dirToPlayer = dist > 0.001 ? toPlayer.div(dist) : V2.up;

      switch (e.Type) {
        case Foe.Drone: {
          let target = this.pPos;
          if (ring != null) {
            const slot = ring.indexOf(e);
            const a = (slot * Math.PI * 2) / ring.length;
            target = this.pPos.add(new V2(Math.cos(a), Math.sin(a)).mul(3.2));
          }
          const seek = target.sub(e.Pos).normalized.mul(1.6);
          e.Vel = V2.clampMagnitude(e.Vel.add(this.Flock(e).add(seek).mul(7 * dt)), e.Speed);
          e.Pos = e.Pos.add(e.Vel.mul(dt));
          e.Heading = Math.atan2(e.Vel.y, e.Vel.x);
          break;
        }
        case Foe.Flanker: this.TickFlanker(e, dt, dirToPlayer, dist); break;
        case Foe.Sniper: this.TickSniper(e, dt, dirToPlayer, dist); break;
        case Foe.Warden: this.TickWarden(e, dt, dirToPlayer); break;
        case Foe.Hive: this.TickHive(e, dt); break;
      }

      e.Pos = e.Pos.add(e.Knock.mul(dt));
      e.Knock = e.Knock.mul(Math.exp(-5 * dt));
      this.KeepInArena(e);
      for (const p of this.pillars) e.Pos = SwarmbreakerGame.PushOut(e.Pos, e.Radius, p);

      if (e.Age > 0.4 && dist < e.Radius + PlayerRadius && (e.Type !== Foe.Flanker || e.Mode !== 1)) {
        this.HurtPlayer(e.Type);
        if (this.State !== Phase.Playing) return;
      }
      this.Present(e);
    }
  }

  private Bearing(e: Enemy) { return Math.atan2(e.Pos.y - this.pPos.y, e.Pos.x - this.pPos.x); }

  private Flock(e: Enemy) {
    let sep = V2.zero, align = V2.zero, center = V2.zero;
    let n = 0;
    for (const o of this.enemies) {
      if (o === e) continue;
      const d = e.Pos.sub(o.Pos);
      const m = d.magnitude;
      if (m > 2.4 || m < 0.0001) continue;
      if (m < 0.9 + o.Radius) sep = sep.add(d.div(m * m));
      if (o.Type === Foe.Drone) {
        align = align.add(o.Vel);
        center = center.add(o.Pos);
        n++;
      }
    }
    let force = sep.mul(1.4);
    if (n > 0) {
      force = force.add(align.div(n).normalized.mul(0.4));
      force = force.add(center.div(n).sub(e.Pos).normalized.mul(0.3));
    }
    return force;
  }

  private TickFlanker(e: Enemy, dt: number, dirToPlayer: V2, dist: number) {
    e.Timer -= dt;
    switch (e.Mode) {
      case 0: { // orbit toward the blind spot behind the player's aim
        const side = this.hive.Current === Tactic.Pincer ? e.Side * 1.4 : e.Side * 0.7;
        const a = Math.atan2(-this.aim.y, -this.aim.x) + side;
        const slot = this.pPos.add(new V2(Math.cos(a), Math.sin(a)).mul(3.6));
        const to = slot.sub(e.Pos);
        e.Vel = V2.lerp(e.Vel, to.normalized.mul(e.Speed * Mathf.clamp01(to.magnitude)), 1 - Math.exp(-dt * 5));
        e.Pos = e.Pos.add(e.Vel.mul(dt));
        e.Heading = Math.atan2(dirToPlayer.y, dirToPlayer.x);
        if (e.Timer <= 0 && dist < 5.5) {
          e.Mode = 1;
          e.Timer = 0.45;
          Sfx.play(Snd.Charge, 0.25, 2);
        }
        break;
      }
      case 1: // wind-up telegraph
        e.Vel = e.Vel.mul(Math.exp(-dt * 8));
        e.Pos = e.Pos.add(e.Vel.mul(dt));
        e.Heading = Math.atan2(dirToPlayer.y, dirToPlayer.x);
        e.Flash = 0.6 + 0.4 * Math.sin(e.Timer * 40);
        if (e.Timer <= 0) {
          e.Mode = 2;
          e.Timer = 0.35;
          e.LungeDir = dirToPlayer;
          Sfx.play(Snd.Whoosh, 0.6, 1.3);
        }
        break;
      case 2: // lunge
        e.Pos = e.Pos.add(e.LungeDir.mul(13 * dt));
        if (e.Timer <= 0) {
          e.Mode = 3;
          e.Timer = 0.7;
          e.Vel = e.LungeDir.mul(3);
        }
        break;
      default: // recover
        e.Vel = e.Vel.mul(Math.exp(-dt * 3));
        e.Pos = e.Pos.add(e.Vel.mul(dt));
        if (e.Timer <= 0) {
          e.Mode = 0;
          e.Timer = Random.range(2, 3.5);
          e.Side = -e.Side;
        }
        break;
    }
  }

  private TickSniper(e: Enemy, dt: number, dirToPlayer: V2, dist: number) {
    e.Timer -= dt;
    if (e.Mode === 0) {
      // Hold range 9 and strafe; prefer spots with line of sight.
      const away = dirToPlayer.neg();
      let desired = this.pPos.add(away.mul(9)).add(new V2(-away.y, away.x).mul(e.Side * 2));
      if (this.hive.Current === Tactic.ShieldWall) desired = this.pPos.add(away.mul(10.5));
      const to = desired.sub(e.Pos);
      e.Vel = V2.lerp(e.Vel, to.normalized.mul(e.Speed * Mathf.clamp01(to.magnitude * 0.5)), 1 - Math.exp(-dt * 3));
      e.Pos = e.Pos.add(e.Vel.mul(dt));
      e.Heading = Math.atan2(dirToPlayer.y, dirToPlayer.x);
      if (e.Timer <= 0 && this.HasLineOfSight(e.Pos, this.pPos)) {
        e.Mode = 1;
        e.Timer = 1.05;
        e.Laser.gameObject.setActive(true);
        Sfx.play(Snd.Charge, 0.5);
      } else if (e.Timer <= 0) {
        e.Timer = 0.5;
        e.Side = -e.Side;
      }
    } else {
      // Charging: lead the target (predict where the player will be when the bolt arrives), lock late.
      e.Vel = e.Vel.mul(Math.exp(-dt * 6));
      if (e.Timer > 0.25) {
        const travel = dist / 17;
        e.AimPoint = this.pPos.add(this.pVel.mul(travel));
      }
      const dir = e.AimPoint.sub(e.Pos).normalized;
      e.Heading = Math.atan2(dir.y, dir.x);
      const k = 1 - Mathf.clamp01(e.Timer / 1.05);
      e.Laser.setPosition(0, e.Pos);
      e.Laser.setPosition(1, e.Pos.add(dir.mul(30)));
      e.Laser.widthMultiplier = Mathf.lerp(0.02, 0.1, k);
      const lc = FoeColor[Foe.Sniper].withAlpha(e.Timer < 0.25 ? 0.9 : 0.25 + 0.3 * k);
      e.Laser.startColor = e.Laser.endColor = lc;
      if (e.Timer <= 0) {
        this.SpawnShot(e.Pos.add(dir.mul(0.6)), dir.mul(17), 2, 1, 0, true);
        Sfx.play(Snd.Laser, 0.6);
        e.Laser.gameObject.setActive(false);
        e.Mode = 0;
        e.Timer = Random.range(2.2, 3.2);
        e.Side = Random.value < 0.5 ? -1 : 1;
      }
    }
  }

  private TickWarden(e: Enemy, dt: number, dirToPlayer: V2) {
    if (e.Ward == null || !this.enemies.includes(e.Ward) || e.Ward.Type === Foe.Warden) {
      // Protect the most valuable ally: snipers first, then the most damaged.
      e.Ward = null;
      let best = -1;
      for (const o of this.enemies) {
        if (o === e || o.Type === Foe.Warden) continue;
        const value = (o.Type === Foe.Sniper ? 3 : o.Type === Foe.Hive ? 4 : 1) + (1 - o.Hp / o.MaxHp) - o.Pos.sub(e.Pos).magnitude * 0.05;
        if (value > best) { best = value; e.Ward = o; }
      }
    }
    const target = e.Ward != null ? e.Ward.Pos.add(this.pPos.sub(e.Ward.Pos).normalized.mul(1.6)) : this.pPos;
    const to = target.sub(e.Pos);
    e.Vel = V2.lerp(e.Vel, to.normalized.mul(e.Speed * Mathf.clamp01(to.magnitude)), 1 - Math.exp(-dt * 4));
    e.Pos = e.Pos.add(e.Vel.mul(dt));
    const want = Math.atan2(dirToPlayer.y, dirToPlayer.x);
    e.Heading = Mathf.lerpAngle(e.Heading * Mathf.Rad2Deg, want * Mathf.Rad2Deg, 1 - Math.exp(-dt * 4)) * Mathf.Deg2Rad;
  }

  private TickHive(e: Enemy, dt: number) {
    const arena = this.arena;
    e.Timer -= dt;
    const rage = e.Hp < e.MaxHp * 0.5 ? 1.5 : 1;
    const orbit = arena.center.add(new V2(Math.cos(e.Age * 0.3), Math.sin(e.Age * 0.45)).scale(new V2(arena.width * 0.25, arena.height * 0.2)));
    e.Vel = V2.lerp(e.Vel, orbit.sub(e.Pos).mul(0.8), 1 - Math.exp(-dt * 2));
    e.Pos = e.Pos.add(e.Vel.mul(dt));
    e.Heading += dt * 0.8 * rage;
    if (e.Timer > 0) return;
    e.Timer = 2.6 / rage;
    const n = 14;
    for (let k = 0; k < n; k++) {
      const a = e.Heading + (k * Math.PI * 2) / n;
      const d = new V2(Math.cos(a), Math.sin(a));
      this.SpawnShot(e.Pos.add(d.mul(1.3)), d.mul(6.5), 3, 1, 0, true);
    }
    Sfx.play(Snd.Zap, 0.7);
    if (this.enemies.length < 18)
      for (let k = 0; k < 2; k++) this.Spawn(Foe.Drone, e.Pos.add(Random.insideUnitCircle.mul(1.5)));
  }

  private KeepInArena(e: Enemy) {
    const arena = this.arena;
    e.Pos = new V2(Mathf.clamp(e.Pos.x, arena.xMin + e.Radius, arena.xMax - e.Radius),
      Mathf.clamp(e.Pos.y, arena.yMin + e.Radius, arena.yMax - e.Radius));
  }

  private Present(e: Enemy) {
    e.Go.transform.position = new V3(e.Pos.x, e.Pos.y, 0);
    const pop = Ease.outBack(Mathf.clamp01(e.Age / 0.3));
    e.Go.transform.localScale = new V3(pop, pop, 1);
    const deg = e.Heading * Mathf.Rad2Deg;
    e.Body.transform.localRotation = Quaternion.euler(0, 0, e.Type === Foe.Warden || e.Type === Foe.Hive ? deg * 0.3 : deg);
    e.Shield.transform.localRotation = Quaternion.euler(0, 0, deg);
    const c = FoeColor[e.Type];
    e.Body.color = Color.lerp(c, Color.white, e.Flash);
    e.Halo.color = c.withAlpha(0.3 + 0.4 * e.Flash);
  }

  private Damage(e: Enemy, amount: number, from: V2) {
    e.Hp -= amount;
    e.Flash = 1;
    e.Knock = e.Knock.add(from.normalized.mul(e.Type === Foe.Hive ? 0.3 : 2.5));
    if (e.Hp > 0) {
      Sfx.play(Snd.Hit, 0.4, Random.range(0.9, 1.2));
      return;
    }
    this.Kill(e);
  }

  private Kill(e: Enemy) {
    const index = this.enemies.indexOf(e);
    if (index < 0) return;
    this.enemies.splice(index, 1);
    this.Recycle(e);
    this.kills++;
    const points = FoePoints[e.Type] * this.multiplier;
    this.score += points;
    this.multiplier = Math.min(8, this.multiplier + (this.multTimer > 0 ? 1 : 0));
    this.multTimer = 2;
    const c = FoeColor[e.Type];
    const big = e.Type === Foe.Hive;
    this.Fx.burst(e.Pos, c, big ? 80 : 16, big ? 12 : 6, big ? 0.4 : 0.22, big ? 1.2 : 0.5);
    this.Fx.ring(e.Pos, c, 0.3, big ? 12 : 2.2, big ? 0.8 : 0.3);
    this.UI.Float(e.Pos, "+" + points, Color.lerp(c, Color.white, 0.4), big ? 1.6 : 0.8);
    Sfx.play(big ? Snd.Boom : Snd.Explode, big ? 1 : 0.5, Random.range(0.9, 1.15));
    if (big) {
      this.Fx.shake(0.9);
      this.Fx.kick(2.5, 0.6);
      this.Back.Flash(c, 0.3);
      this.Hitstop(0.12);
      Fx.haptic(true);
    } else this.Fx.shake(0.08);
  }

  // ------------------------------------------------------------------ projectiles

  private SpawnShot(pos: V2, vel: V2, life: number, dmg: number, pierceCount: number, hostile: boolean) {
    let s = this.shotPool.pop();
    if (!s) { s = new Shot(); s.Sr = Art.spr(this.world, "Shot", Art.Disc, Color.white, 1, 30, Art.Additive); }
    s.Sr.gameObject.setActive(true);
    s.Pos = pos;
    s.Vel = vel;
    s.Life = life;
    s.Damage = dmg;
    s.Pierce = pierceCount;
    s.Hostile = hostile;
    s.LastHit = null;
    s.Sr.color = hostile ? Pal.hex(0xff5ca8) : Color.lerp(PlayerColor, Color.white, 0.4);
    const size = hostile ? 0.34 : 0.24;
    s.Sr.transform.localScale = new V3(size * 1.8, size, 1);
    s.Sr.transform.rotation = Quaternion.euler(0, 0, Math.atan2(vel.y, vel.x) * Mathf.Rad2Deg);
    this.bullets.push(s);
  }

  private UpdateShots(dt: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const s = this.bullets[i];
      s.Life -= dt;
      s.Pos = s.Pos.add(s.Vel.mul(dt));
      let dead = s.Life <= 0 || !this.arena.contains(s.Pos);
      if (!dead)
        for (const p of this.pillars)
          if (s.Pos.sub(p.Pos).sqrMagnitude < p.Radius * p.Radius) {
            dead = true;
            this.Fx.spray(s.Pos, s.Pos.sub(p.Pos).normalized, s.Sr.color, 4, 4, 0.8, 0.12, 0.2);
            break;
          }

      if (!dead && s.Hostile) {
        if (s.Pos.sub(this.pPos).sqrMagnitude < (PlayerRadius + 0.12) * (PlayerRadius + 0.12) && this.invulnerable <= 0 && this.dashTime <= 0) {
          dead = true;
          this.HurtPlayer(Foe.Sniper);
          if (this.State !== Phase.Playing) return;
        }
      } else if (!dead) {
        for (const e of this.enemies) {
          if (e === s.LastHit || e.Age < 0.2) continue;
          const r = e.Radius + 0.12;
          if (e.Pos.sub(s.Pos).sqrMagnitude > r * r) continue;
          if (e.Type === Foe.Warden && SwarmbreakerGame.Blocks(e, s)) {
            dead = true;
            this.Fx.spray(s.Pos, s.Vel.normalized.neg(), FoeColor[Foe.Warden], 5, 5, 0.6, 0.14, 0.2);
            Sfx.play(Snd.Tick, 0.5, 0.6);
            break;
          }
          this.hive.Hits++;
          this.Damage(e, s.Damage, s.Vel);
          s.LastHit = e;
          if (s.Pierce-- <= 0) dead = true;
          break;
        }
      }

      if (dead) {
        s.Sr.gameObject.setActive(false);
        this.shotPool.push(s);
        this.bullets.splice(i, 1);
        continue;
      }
      s.Sr.transform.position = s.Pos;
    }
  }

  /** Warden shields block shots arriving within ±60° of the direction it faces. */
  private static Blocks(warden: Enemy, s: Shot) {
    const facing = new V2(Math.cos(warden.Heading), Math.sin(warden.Heading));
    return V2.dot(facing, s.Vel.normalized.neg()) > 0.5;
  }

  private HasLineOfSight(a: V2, b: V2) {
    for (const p of this.pillars) {
      const ab = b.sub(a);
      const t = Mathf.clamp01(V2.dot(p.Pos.sub(a), ab) / Math.max(ab.sqrMagnitude, 1e-5));
      if (a.add(ab.mul(t)).sub(p.Pos).sqrMagnitude < p.Radius * p.Radius) return false;
    }
    return true;
  }

  private static PushOut(pos: V2, radius: number, p: Pillar) {
    const d = pos.sub(p.Pos);
    const min = radius + p.Radius;
    const m = d.magnitude;
    if (m >= min) return pos;
    return p.Pos.add((m > 0.0001 ? d.div(m) : V2.up).mul(min));
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    this.scoreText.text = Fmt.n(this.score);
    const remaining = this.queue.length + this.pending.length + this.enemies.length;
    this.waveText.text = `WAVE ${this.wave}   ·   ${remaining} HOSTILES`;
    this.tacticText.text = this.enemies.length > 0 ? "HIVE TACTIC: " + HiveMind.Describe(this.hive.Current) : "";
    this.multText.text = this.multiplier > 1 ? "x" + this.multiplier : "";
    for (let i = 0; i < this.hearts.length; i++) {
      this.hearts[i].gameObject.setActive(i < this.maxHp);
      this.hearts[i].color = i < this.hp ? PlayerColor : new Color(1, 1, 1, 0.12);
    }
    this.dashFill.fillAmount = this.dashCooldownMax > 0 ? this.dashCooldown / this.dashCooldownMax : 0;
    this.Back.setDanger(this.hp === 1 ? 0.8 : 0);
  }
}
