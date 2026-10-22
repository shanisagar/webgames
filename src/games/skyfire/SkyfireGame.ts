import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualLook, Color, Ease, Fmt, Fx, GameInfo, GameObject, howTo, Image, Mathf, Mouse,
  overUI, Pal, Phase, Quaternion, Random, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, Text, TextAnchor, Time, Touchscreen,
  TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import { Pickup, PlaneStyle, SkyfireArt, Theme } from "./SkyfireArt";

/**
 * SKYFIRE — a vertical-scrolling WWII-style plane shooter.
 * Drag anywhere to fly (the plane follows your finger 1:1), guns fire automatically. Enemy squadrons fly in
 * formations (V wedges, side sweeps, divers that lock on, slow bombers that fire bullet rings); shooting down a
 * whole red squadron drops a POWER upgrade. Each mission ends with a Flying Fortress boss in three phases.
 * Coins buy permanent hangar upgrades between missions. Bombs clear the sky; a rewarded ad can continue a run
 * once or double the coins of a won mission. (Port of SkyfireGame.cs.)
 */

// ------------------------------------------------------------------ tuning

const ScrollSpeed = 1.5;
const Tile = 4;
const PlayerRadius = 0.2;
const PlayerSize = 1.45;
const BulletSpeed = 18;
const FireInterval = 0.09;
const MissionLength = 62;
const MaxPower = 5;
const MaxPlayerBullets = 220, MaxEnemyBullets = 360, MaxEnemies = 48, MaxPickups = 32, MaxPuffs = 80;
const PowerUpgradeMax = 5, ArmorUpgradeMax = 3, BombUpgradeMax = 3;

const SkyBlue = Pal.hex(0x2e86e8);
const Gold = Pal.hex(0xffc21a);
const Hot = Pal.hex(0xff5a2e);
const Ink = new Color(0.08, 0.1, 0.16, 0.85);

const PlayerBody = new Color(0.80, 0.82, 0.86), PlayerWing = new Color(0.72, 0.74, 0.78), PlayerAccent = new Color(0.16, 0.46, 0.95);

enum Kind { Fighter, Red, Diver, Bomber, Boss, Escort }
enum WaveType { Wedge, Sweep, Divers, Bomber, RedSquadron, Pincer }

class Bullet {
  Sr!: SpriteRenderer;
  Pos = V2.zero; Vel = V2.zero;
  Damage = 0;
  Active = false; Big = false;
}

class Enemy {
  Kind = Kind.Fighter;
  Root: GameObject | null = null; Body!: GameObject;
  BodySr!: SpriteRenderer; FlashSr!: SpriteRenderer; ShadowSr!: SpriteRenderer; PropSr!: SpriteRenderer;
  Pos = V2.zero; Vel = V2.zero;
  Hp = 0; MaxHp = 0; Radius = 0; T = 0; FireTimer = 0; Speed = 0; X0 = 0; Y0 = 0; Amp = 0; Dir = 0; Heading = 0; Delay = 0; Flash = 0; Size = 0; Turn = 0; Alt = 0;
  Phase = 0; Group = 0; Score = 0; Coins = 0;
  Active = false; Entered = false;
}

class PickupItem {
  Sr!: SpriteRenderer;
  Kind = Pickup.Coin;
  Pos = V2.zero; Vel = V2.zero;
  T = 0;
  Value = 0;
  Active = false;
}

class Puff {
  Sr!: SpriteRenderer;
  Pos = V2.zero; Vel = V2.zero;
  T = 0; Duration = 0; Size = 0; Grow = 0;
  Fire = false; Active = false;
}

class Decor {
  Sr!: SpriteRenderer;
  Size = 0;
  Cloud = false;
}

interface WaveEvent { T: number; Type: WaveType; X: number; Side: number }

const themeName = (t: Theme) => (t === Theme.Desert ? "DESERT STORM" : t === Theme.Arctic ? "ARCTIC FRONT" : "PACIFIC ISLANDS");
const themeFor = (m: number): Theme => (m - 1) % 3;

const maxFor = (key: string) => (key === "pw" ? PowerUpgradeMax : key === "ar" ? ArmorUpgradeMax : BombUpgradeMax);

function costFor(key: string, lvl: number) {
  switch (key) {
    case "pw": return 150 + lvl * 150 + lvl * lvl * 50;
    case "ar": return 250 + lvl * 250;
    default: return 200 + lvl * 200;
  }
}

function rot(v: V2, deg: number) {
  const a = deg * Mathf.Deg2Rad, c = Math.cos(a), s = Math.sin(a);
  return new V2(v.x * c - v.y * s, v.x * s + v.y * c);
}

function kill(b: Bullet) {
  if (!b.Active && !b.Sr.gameObject.activeSelf) return;
  b.Active = false;
  b.Sr.gameObject.setActive(false);
}

function set(t: Text | null, s: string) {
  if (t && t.text !== s) t.text = s;
}

export class SkyfireGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject; private terrainRoot!: GameObject; private fxRoot!: GameObject;
  private readonly tiles: SpriteRenderer[] = [];
  private readonly decor: Decor[] = [];
  private curtainL!: SpriteRenderer; private curtainR!: SpriteRenderer; private bombFlash!: SpriteRenderer;
  private scroll = 0; private laneHalf = 0; private viewTop = 0; private viewBottom = 0; private viewHalfW = 0;
  private theme = Theme.Ocean;
  private tileCols = 0; private tileRows = 0;

  // player
  private pRoot!: GameObject; private pBody!: GameObject;
  private pBodySr!: SpriteRenderer; private pShadowSr!: SpriteRenderer; private pPropSr!: SpriteRenderer; private pFlashSr!: SpriteRenderer;
  private readonly wingRoots: GameObject[] = new Array(2);
  private readonly wingProps: SpriteRenderer[] = new Array(2);
  private pPos = V2.zero; private lastDrag = V2.zero;
  private dragging = false; private mouseDragging = false;
  private fireTimer = 0; private wingFireTimer = 0; private invuln = 0; private supportTimer = 0; private bank = 0; private deathTimer = 0;
  private hp = 0; private maxHp = 0; private power = 0; private bombs = 0; private hitsTaken = 0;
  private dying = false; private revived = false; private missionWon = false;

  // world objects
  private readonly pBullets: Bullet[] = new Array(MaxPlayerBullets);
  private readonly eBullets: Bullet[] = new Array(MaxEnemyBullets);
  private readonly enemies: Enemy[] = new Array(MaxEnemies);
  private readonly pickups: PickupItem[] = new Array(MaxPickups);
  private readonly puffs: Puff[] = new Array(MaxPuffs);
  private puffCursor = 0;

  // mission
  private readonly waves: WaveEvent[] = [];
  private waveCursor = 0; private mission = 0; private score = 0; private coinsRun = 0; private kills = 0; private nextGroup = 1;
  private missionClock = 0; private bossClock = 0;
  private bossSpawned = false; private bossDead = false;
  private boss: Enemy | null = null;
  private readonly groupAlive = new Map<number, number>();
  private readonly groupEscaped = new Map<number, boolean>();
  private rng = new SysRandom();
  private attractTimer = 0;

  // HUD
  private scoreText!: Text; private missionText!: Text; private coinText!: Text; private powerText!: Text;
  private progressFill!: Image; private bossFill!: Image;
  private bossBar!: UINode;
  private readonly hearts: Image[] = [];
  private bombButton!: ArcadeButton;
  private upPower: ArcadeButton | null = null; private upArmor: ArcadeButton | null = null; private upBomb: ArcadeButton | null = null;
  private bombRequested = false;

  private gunClip!: AudioClip; private boomClip!: AudioClip; private bigBoomClip!: AudioClip; private pickupClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "skyfire",
      Title: "SKYFIRE",
      Tagline: "SHOOT. DODGE. RULE THE SKIES.",
      Accent: Hot,
      Accent2: SkyBlue,
      BgTop: Pal.hex(0x14324f),
      BgBottom: Pal.hex(0x061423),
      GridSpacing: 1.4,
      ShortSide: 9.4,
      Touch: TouchScheme.None,
      Music: { bpm: 132, rootHz: 98, degrees: [0, 5, 3, 4], seed: 45, energy: 0.9, major: true },
      Reminders: [
        "Squadron incoming|Enemy planes spotted over the islands. Scramble, pilot!",
        "Your plane is refuelled|A new mission is waiting on the runway.",
        "The Fortress is back|Take it down and claim the bounty.",
      ],
      HowTo: [
        howTo(Art.Chevron, PlayerAccent, "DRAG anywhere to fly. Your guns fire automatically. (Keys: WASD / arrows.)"),
        howTo(SkyfireArt.PickupSprite(Pickup.Power), Color.white, "Shoot down a whole RED SQUADRON to drop a POWER upgrade (up to 5 guns)."),
        howTo(SkyfireArt.PickupSprite(Pickup.Bomb), Color.white, "BOMB clears every bullet on screen: tap the button or press Space."),
        howTo(SkyfireArt.PickupSprite(Pickup.Support), Color.white, "SUPPORT brings two wingmen for a few seconds of extra firepower."),
        howTo(SkyfireArt.PickupSprite(Pickup.Health), Color.white, "Getting hit costs a heart and one power level. Repair kits restore a heart."),
        howTo(SkyfireArt.PickupSprite(Pickup.Coin), Color.white, "Collect COINS and spend them in the hangar on permanent upgrades."),
        howTo(Art.Star, Gold, "Every mission ends with a Flying Fortress. Finish without a hit for 3 stars."),
      ],
      Tips: [
        "Your hitbox is only the cockpit: you can squeeze between bullets.",
        "Keep moving sideways: aimed shots can't follow you.",
        "Save a bomb for the Fortress' third phase.",
        "Divers lock on to where you are: sidestep just before they arrive.",
        "Upgrade POWER in the hangar to start every mission with more guns.",
      ],
    });
  }

  protected get ShortSide() { return Screen.width > Screen.height ? 17 : 9.4; }

  private get Coins() { return this.Data.get("coins"); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }

  private get CurrentMission() { return Math.max(1, this.Data.get("mission", 1)); }

  protected BestLine() {
    const best = this.Data.get("best");
    return best > 0 ? `MISSION ${this.CurrentMission}   ·   BEST ${Fmt.n(best)}` : `MISSION ${this.CurrentMission}`;
  }

  protected StatsLine() { return `${Fmt.n(this.Coins)} COINS   ·   ${Fmt.n(this.Data.get("kills"))} PLANES DOWNED   ·   ${this.Data.get("stars")} STARS`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("SkyfireWorld", this.gameObject);
    this.terrainRoot = new GameObject("Terrain", this.world);
    this.fxRoot = new GameObject("Fx", this.world);

    this.CalmPostFx();
    this.BuildAudio();
    this.BuildPools();
    this.BuildPlayer();

    this.curtainL = SkyfireArt.Spr(this.world, "LaneCurtainL", Art.Square, new Color(0.02, 0.04, 0.08, 0.45), 1, 45);
    this.curtainR = SkyfireArt.Spr(this.world, "LaneCurtainR", Art.Square, new Color(0.02, 0.04, 0.08, 0.45), 1, 45);
    this.bombFlash = SkyfireArt.Spr(this.world, "BombFlash", Art.Square, new Color(1, 1, 1, 0), 1, 50);

    this.BuildHud();
    this.Layout();
    this.SetTheme(themeFor(this.CurrentMission));
  }

  private CalmPostFx() {
    // This game is colourful, not neon: bloom only on the brightest effects, no colour fringing.
    CasualLook.calm(this, 1.15, 0.22);
  }

  private BuildAudio() {
    const noise = new SysRandom(4);
    const N = () => noise.nextDouble() * 2 - 1;
    this.gunClip = Sfx.make("sf-gun", 0.06, (t) => (N() * 0.6 + Sfx.sinP(Sfx.glide(t, 900, 300, 0.05)) * 0.4) * Sfx.env(t, 0.001, 0.045) * 0.16);
    let lp = 0;
    this.boomClip = Sfx.make("sf-boom", 0.42, (t) => {
      lp += (N() - lp) * 0.25;
      return (lp * 0.8 + Sfx.sinP(Sfx.glide(t, 160, 40, 0.3)) * 0.5) * Sfx.env(t, 0.002, 0.36) * 0.42;
    });
    let lp2 = 0;
    this.bigBoomClip = Sfx.make("sf-bigboom", 1.1, (t) => {
      lp2 += (N() - lp2) * 0.12;
      return (lp2 * 0.9 + Sfx.sinP(Sfx.glide(t, 90, 28, 0.9)) * 0.6) * Sfx.env(t, 0.004, 0.95) * 0.55;
    });
    this.pickupClip = Sfx.make("sf-pickup", 0.2, (t) => Sfx.sinP(Sfx.glide(t, 700, 1400, 0.15)) * Sfx.env(t, 0.002, 0.17) * 0.25);
  }

  private BuildPools() {
    for (let i = 0; i < MaxPlayerBullets; i++) {
      const sr = Art.spr(this.fxRoot, "PB", SkyfireArt.PlayerBullet, Color.white, 0.36, 20, Art.Flat);
      sr.gameObject.setActive(false);
      this.pBullets[i] = Object.assign(new Bullet(), { Sr: sr });
    }
    for (let i = 0; i < MaxEnemyBullets; i++) {
      const sr = Art.spr(this.fxRoot, "EB", SkyfireArt.EnemyBullet, Color.white, 0.44, 30, Art.Flat);
      sr.gameObject.setActive(false);
      this.eBullets[i] = Object.assign(new Bullet(), { Sr: sr });
    }
    for (let i = 0; i < MaxEnemies; i++) this.enemies[i] = new Enemy();
    for (let i = 0; i < MaxPickups; i++) {
      const sr = SkyfireArt.Spr(this.fxRoot, "Pickup", SkyfireArt.PickupSprite(Pickup.Coin), Color.white, 0.6, 22);
      sr.gameObject.setActive(false);
      this.pickups[i] = Object.assign(new PickupItem(), { Sr: sr });
    }
    for (let i = 0; i < MaxPuffs; i++) {
      const sr = SkyfireArt.Spr(this.fxRoot, "Puff", SkyfireArt.Fireball, Color.white, 1, 28);
      sr.gameObject.setActive(false);
      this.puffs[i] = Object.assign(new Puff(), { Sr: sr });
    }
  }

  private BuildPlayer() {
    this.pRoot = new GameObject("Player", this.world);
    this.pShadowSr = SkyfireArt.Spr(this.pRoot, "Shadow", SkyfireArt.Silhouette(PlaneStyle.Fighter), new Color(0, 0, 0, 0.28), PlayerSize * 0.85, -870);
    this.pShadowSr.transform.localPosition = new V3(0.45, -0.7, 0);
    this.pBody = new GameObject("Body", this.pRoot);
    this.pBodySr = SkyfireArt.Spr(this.pBody, "Plane", SkyfireArt.Plane(PlaneStyle.Fighter, PlayerBody, PlayerWing, PlayerAccent), Color.white, PlayerSize, 25);
    this.pFlashSr = Art.spr(this.pBody, "Flash", SkyfireArt.Silhouette(PlaneStyle.Fighter), Color.clear, PlayerSize, 26, Art.Additive);
    this.pPropSr = SkyfireArt.Spr(this.pBody, "Prop", SkyfireArt.Prop, Color.white, PlayerSize * 0.36, 27);
    this.pPropSr.transform.localPosition = new V3(0, PlayerSize * 0.44, 0);

    for (let i = 0; i < 2; i++) {
      const r = new GameObject("Wingman" + i, this.world);
      SkyfireArt.Spr(r, "Shadow", SkyfireArt.Silhouette(PlaneStyle.Fighter), new Color(0, 0, 0, 0.25), 0.8, -870).transform.localPosition = new V3(0.35, -0.55, 0);
      SkyfireArt.Spr(r, "Plane", SkyfireArt.Plane(PlaneStyle.Fighter, new Color(0.9, 0.8, 0.45), new Color(0.82, 0.72, 0.38), Hot), Color.white, 0.85, 24);
      const prop = SkyfireArt.Spr(r, "Prop", SkyfireArt.Prop, Color.white, 0.3, 26);
      prop.transform.localPosition = new V3(0, 0.37, 0);
      this.wingProps[i] = prop;
      r.setActive(false);
      this.wingRoots[i] = r;
    }
  }

  private BuildHud() {
    const hud = this.UI.Hud;

    for (let i = 0; i < 6; i++) {
      const h = UIKit.img(hud, "Heart", SkyfireArt.Heart, Color.white);
      h.rectTransform.place(new V2(0, 1), new V2(64 + i * 58, -78), new V2(52, 52));
      this.hearts.push(h);
    }

    this.scoreText = UIKit.at(UIKit.label(hud, "0", 60, Color.white), new V2(0.5, 1), new V2(0, -66), new V2(520, 76));
    UIKit.glow(this.scoreText, Ink, 3);
    this.missionText = UIKit.at(UIKit.label(hud, "", 26, Color.white), new V2(0.5, 1), new V2(0, -118), new V2(620, 36));
    UIKit.glow(this.missionText, Ink, 2);
    const [prog, progressFill] = UIKit.meter(hud, new V2(0.5, 1), new V2(0, -150), new V2(420, 18), Hot);
    this.progressFill = progressFill;
    const progBg = prog.image;
    if (progBg) progBg.color = new Color(0, 0, 0, 0.35);

    const coinIcon = UIKit.img(hud, "CoinIcon", SkyfireArt.PickupSprite(Pickup.Coin), Color.white);
    coinIcon.rectTransform.place(new V2(1, 1), new V2(-330, -84), new V2(50, 50));
    this.coinText = UIKit.at(UIKit.label(hud, "0", 38, Gold, TextAnchor.MiddleLeft), new V2(1, 1), new V2(-206, -84), new V2(180, 56));
    UIKit.glow(this.coinText, Ink, 3);

    const [bossBar, bossFill] = UIKit.meter(hud, new V2(0.5, 1), new V2(0, -198), new V2(720, 28), Pal.Danger);
    this.bossBar = bossBar;
    this.bossFill = bossFill;
    const bossLabel = UIKit.at(UIKit.label(this.bossBar, "FLYING FORTRESS", 22, Color.white), UIKit.Center, V2.zero, new V2(700, 28));
    UIKit.glow(bossLabel, Ink, 2);
    this.bossBar.setActive(false);

    this.powerText = UIKit.at(UIKit.label(hud, "", 26, Color.white, TextAnchor.MiddleLeft), new V2(0, 0), new V2(210, 70), new V2(380, 40));
    UIKit.glow(this.powerText, Ink, 2);

    this.bombButton = UIKit.buttonAt(hud, "BOMB", new V2(1, 0), new V2(-140, 150), new V2(220, 140), false,
      () => (this.bombRequested = true), 32, SkyfireArt.PickupSprite(Pickup.Bomb));
    this.bombButton.setAccent(SkyBlue);

    // Hangar: permanent upgrades bought with coins, on the title screen
    // Fix: the C# passed "" as the label, so UIKit made no Label and the names/costs never showed.
    if (this.UI.TitleExtra) {
      this.upPower = UIKit.buttonAt(this.UI.TitleExtra, "POWER", UIKit.Center, new V2(-330, 0), new V2(310, 96), false, () => this.BuyUpgrade("pw"), 24,
        SkyfireArt.PickupSprite(Pickup.Power));
      this.upArmor = UIKit.buttonAt(this.UI.TitleExtra, "ARMOR", UIKit.Center, new V2(0, 0), new V2(310, 96), false, () => this.BuyUpgrade("ar"), 24,
        SkyfireArt.PickupSprite(Pickup.Health));
      this.upBomb = UIKit.buttonAt(this.UI.TitleExtra, "BOMBS", UIKit.Center, new V2(330, 0), new V2(310, 96), false, () => this.BuyUpgrade("bm"), 24,
        SkyfireArt.PickupSprite(Pickup.Bomb));
      this.upPower.setAccent(Pal.Danger);
      this.upArmor.setAccent(Pal.Good);
      this.upBomb.setAccent(SkyBlue);
      this.RefreshHangar();
    }
  }

  // ------------------------------------------------------------------ hangar (permanent upgrades)

  private BuyUpgrade(key: string) {
    const lvl = this.Data.get(key);
    if (lvl >= maxFor(key)) { Sfx.play(Snd.Deny, 0.5); return; }
    const cost = costFor(key, lvl);
    if (this.Coins < cost) {
      Sfx.play(Snd.Deny, 0.6);
      this.UI.Toast(`Need ${Fmt.n(cost - this.Coins)} more coins. Shoot down planes and Fortresses to earn them!`, 3);
      return;
    }
    this.Coins -= cost;
    this.Data.set(key, lvl + 1);
    this.Data.flush();
    Sfx.play(Snd.PowerUp, 0.8);
    this.RefreshHangar();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private RefreshHangar() {
    this.SetUpgradeLabel(this.upPower, "POWER", "pw");
    this.SetUpgradeLabel(this.upArmor, "ARMOR", "ar");
    this.SetUpgradeLabel(this.upBomb, "BOMBS", "bm");
  }

  private SetUpgradeLabel(b: ArcadeButton | null, name: string, key: string) {
    if (!b || !b.label) return;
    const lvl = this.Data.get(key), max = maxFor(key);
    b.label.text = lvl >= max ? `${name} MAX` : `${name} ${lvl + 1} · ${Fmt.n(costFor(key, lvl))}`;
    b.interactable = lvl < max;
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    this.viewHalfW = this.ViewSize.x * 0.5;
    this.viewTop = this.ViewSize.y * 0.5;
    this.viewBottom = -this.viewTop;
    this.laneHalf = Math.min(4.5, this.viewHalfW - 0.25);

    // Terrain tiles: enough to cover the view with one spare row/column for scrolling
    const cols = Math.ceil(this.ViewSize.x / Tile) + 2, rows = Math.ceil(this.ViewSize.y / Tile) + 2;
    if (cols !== this.tileCols || rows !== this.tileRows) {
      for (const t of this.tiles) t.gameObject.destroy();
      this.tiles.length = 0;
      for (let i = 0; i < cols * rows; i++) this.tiles.push(SkyfireArt.Spr(this.terrainRoot, "Tile", SkyfireArt.Ground(this.theme), Color.white, Tile + 0.02, -900));
      this.tileCols = cols;
      this.tileRows = rows;
    }
    if (this.decor.length === 0) {
      for (let i = 0; i < 5; i++) this.decor.push(Object.assign(new Decor(), { Sr: SkyfireArt.Spr(this.terrainRoot, "Decor", SkyfireArt.Decor(this.theme, i % 4), Color.white, 3, -890) }));
      for (let i = 0; i < 3; i++) this.decor.push(Object.assign(new Decor(), { Sr: SkyfireArt.Spr(this.terrainRoot, "Cloud", SkyfireArt.Cloud(i), new Color(1, 1, 1, 0.8), 4, -880), Cloud: true }));
      for (let i = 0; i < this.decor.length; i++) this.RespawnDecor(this.decor[i], this.viewBottom + ((i + 0.5) * this.ViewSize.y / this.decor.length) * 1.4);
    }

    // Dim the area outside the lane (wide landscape screens)
    const side = this.viewHalfW - this.laneHalf;
    const wide = side > 0.6;
    this.curtainL.gameObject.setActive(wide);
    this.curtainR.gameObject.setActive(wide);
    if (wide) {
      this.curtainL.transform.localScale = new V3(side / 0.97, (this.ViewSize.y / 0.97) * 1.05, 1);
      this.curtainR.transform.localScale = this.curtainL.transform.localScale;
      this.curtainL.transform.localPosition = new V3(-this.laneHalf - side * 0.5, 0, 0);
      this.curtainR.transform.localPosition = new V3(this.laneHalf + side * 0.5, 0, 0);
    }
    this.bombFlash.transform.localScale = new V3(this.ViewSize.x * 1.1, this.ViewSize.y * 1.1, 1);
    this.pPos = this.ClampPlayer(this.pPos);
  }

  private SetTheme(t: Theme) {
    this.theme = t;
    const g = SkyfireArt.Ground(t);
    for (const tile of this.tiles) tile.sprite = g;
    let v = 0;
    for (const d of this.decor)
      if (!d.Cloud) d.Sr.sprite = SkyfireArt.Decor(t, v++ % 4);
  }

  private RespawnDecor(d: Decor, y: number) {
    if (d.Cloud) {
      d.Size = 3 + this.rng.nextDouble() * 3;
      d.Sr.color = new Color(1, 1, 1, this.theme === Theme.Desert ? 0.55 : 0.8);
    } else {
      d.Size = 2.4 + this.rng.nextDouble() * 2.6;
      d.Sr.sprite = SkyfireArt.Decor(this.theme, this.rng.next(4));
    }
    d.Sr.transform.localScale = new V3(d.Size * (this.rng.next(2) === 0 ? 1 : -1), d.Size, 1);
    d.Sr.transform.localPosition = new V3((this.rng.nextDouble() * 2 - 1) * (this.viewHalfW + 0.5), y, 0);
  }

  private ScrollTerrain(dt: number) {
    this.scroll += ScrollSpeed * dt;
    const off = Mathf.repeat(this.scroll, Tile);
    const x0 = -(this.tileCols * Tile) * 0.5 + Tile * 0.5, y0 = this.viewBottom - Tile * 0.5;
    for (let j = 0; j < this.tileRows; j++)
      for (let i = 0; i < this.tileCols; i++)
        this.tiles[j * this.tileCols + i].transform.localPosition = new V3(x0 + i * Tile, y0 + j * Tile - off + Tile * 0.5, 0);

    for (const d of this.decor) {
      let p = d.Sr.transform.localPosition;
      p = p.withY(p.y - (d.Cloud ? ScrollSpeed * 1.8 : ScrollSpeed) * dt);
      d.Sr.transform.localPosition = p;
      if (p.y < this.viewBottom - d.Size) this.RespawnDecor(d, this.viewTop + d.Size * 0.6 + this.rng.nextDouble() * 3);
    }
  }

  private ClampPlayer(p: V2) {
    const bottom = this.viewBottom + 1.0;
    const top = this.viewTop - 3.2;
    return new V2(Mathf.clamp(p.x, -this.laneHalf + 0.5, this.laneHalf - 0.5), Mathf.clamp(p.y, bottom, Math.max(bottom, top)));
  }

  // ------------------------------------------------------------------ run lifecycle

  protected OnEnterTitle() {
    this.ClearWorld();
    this.SetTheme(themeFor(this.CurrentMission));
    this.pPos = new V2(0, this.viewBottom + 3.2);
    this.pRoot.setActive(true);
    this.pBodySr.color = Color.white;
    for (const w of this.wingRoots) w.setActive(false);
    this.bossBar.setActive(false);
    this.attractTimer = 0.5;
    this.RefreshHangar();
  }

  protected BeginRun() {
    this.ClearWorld();
    this.Layout();
    this.mission = this.CurrentMission;
    this.SetTheme(themeFor(this.mission));
    this.rng = new SysRandom(this.mission * 7919 + 13);
    this.BuildWaves();

    this.maxHp = 3 + this.Data.get("ar");
    this.hp = this.maxHp;
    this.power = Math.min(MaxPower, 1 + Math.trunc(this.Data.get("pw") / 2));
    this.bombs = 2 + this.Data.get("bm");
    this.score = this.coinsRun = this.kills = this.hitsTaken = 0;
    this.invuln = 2;
    this.supportTimer = 0;
    this.dying = this.revived = this.missionWon = false;
    this.bossSpawned = this.bossDead = false;
    this.boss = null;
    this.missionClock = this.bossClock = 0;
    this.waveCursor = 0;
    this.groupAlive.clear();
    this.groupEscaped.clear();
    this.pPos = new V2(0, this.viewBottom + 2.2);
    this.pRoot.setActive(true);
    for (const w of this.wingRoots) w.setActive(false);
    this.bombButton.node.setActive(true);
    this.bossBar.setActive(false);

    this.UI.Announce(`MISSION ${this.mission}`, Hot, 1.6);
    if (this.Data.get("runs") === 0) this.UI.Hint("Drag anywhere to fly. Your guns fire on their own!");
    this.Data.add("runs", 1);
    Sfx.setIntensity(0.4);
  }

  private ClearWorld() {
    for (const b of this.pBullets) kill(b);
    for (const b of this.eBullets) kill(b);
    for (const e of this.enemies) if (e.Active) this.Despawn(e);
    for (const p of this.pickups) { p.Active = false; p.Sr.gameObject.setActive(false); }
    for (const p of this.puffs) { p.Active = false; p.Sr.gameObject.setActive(false); }
    this.Fx.clearParticles();
    this.UI.Hint(null);
    this.bombFlash.color = new Color(1, 1, 1, 0);
  }

  private BuildWaves() {
    this.waves.length = 0;
    const mission = this.mission;
    const gap = Math.max(2.0, 3.6 - 0.12 * (mission - 1));
    let i = 0;
    for (let t = 2.5; t < MissionLength; t += gap, i++) {
      let type: WaveType;
      const frac = t / MissionLength;
      if (Math.abs(frac - 0.3) < (gap / MissionLength) * 0.5 || Math.abs(frac - 0.72) < (gap / MissionLength) * 0.5) type = WaveType.RedSquadron;
      else if (i % 6 === 4) type = WaveType.Bomber;
      else {
        const r = this.rng.next(mission >= 3 ? 5 : 4);
        type = r === 0 ? WaveType.Wedge : r === 1 ? WaveType.Sweep : r === 2 ? WaveType.Divers : r === 3 ? WaveType.Wedge : WaveType.Pincer;
        if (mission === 1 && type === WaveType.Divers && t < 12) type = WaveType.Wedge;
      }
      this.waves.push({ T: t, Type: type, X: (this.rng.nextDouble() * 2 - 1) * (this.laneHalf - 1.6), Side: this.rng.next(2) === 0 ? -1 : 1 });
      // From mission 4 on, some waves come in pairs
      if (mission >= 4 && i % 3 === 1)
        this.waves.push({ T: t + gap * 0.5, Type: WaveType.Sweep, X: 0, Side: this.rng.next(2) === 0 ? -1 : 1 });
    }
    this.waves.sort((a, b) => a.T - b.T);
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.ScrollTerrain(dt);
    this.UpdatePuffs(dt);
    this.UpdateEnemyBullets(dt, false);
    if (this.State !== Phase.Title) return;

    // Attract mode: the player's plane weaves and fires at passing fighters.
    const t = Time.time;
    this.pPos = new V2(Math.sin(t * 0.8) * Math.min(2.4, this.laneHalf - 1), this.viewBottom + 3.2 + Math.sin(t * 1.3) * 0.4);
    this.PresentPlayer(dt, Math.cos(t * 0.8));
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = 0.14;
      this.FirePlayerGuns(2, true);
    }
    this.UpdatePlayerBullets(dt);
    this.attractTimer -= dt;
    if (this.attractTimer <= 0) {
      this.attractTimer = 3.2;
      this.SpawnWedge((this.rng.nextDouble() * 2 - 1) * (this.laneHalf - 1.6), true);
    }
    this.UpdateEnemies(dt, true);
  }

  protected TickRun(dt: number) {
    this.ScrollTerrain(dt);

    if (this.dying) {
      this.deathTimer -= dt;
      this.UpdateEnemies(dt, false);
      this.UpdateEnemyBullets(dt, false);
      this.UpdatePlayerBullets(dt);
      this.UpdatePuffs(dt);
      if (this.deathTimer <= 0) { this.dying = false; this.Lose(); }
      this.UpdateHud();
      return;
    }

    this.UpdatePlayer(dt);
    this.UpdateDirector(dt);
    this.UpdateEnemies(dt, false);
    this.UpdatePlayerBullets(dt);
    this.UpdateEnemyBullets(dt, true);
    this.UpdatePickups(dt);
    this.UpdatePuffs(dt);
    this.UpdateBombFlash(dt);
    this.UpdateHud();

    if (this.bossDead && !this.missionWon) {
      this.bossClock += dt;
      if (this.bossClock > 2.4) this.Win();
    }
  }

  // ------------------------------------------------------------------ player

  private UpdatePlayer(dt: number) {
    let move = this.Controls.move.mul(9 * dt);
    move = move.add(this.ReadDrag());
    const vx = dt > 0 ? move.x / dt : 0;
    this.pPos = this.ClampPlayer(this.pPos.add(move));
    this.bank = Mathf.moveTowards(this.bank, Mathf.clamp(vx / 9, -1, 1), dt * 6);
    this.invuln = Math.max(0, this.invuln - dt);
    this.supportTimer = Math.max(0, this.supportTimer - dt);
    this.PresentPlayer(dt, this.bank);

    // Guns
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer += FireInterval;
      if (this.fireTimer < 0) this.fireTimer = 0;
      this.FirePlayerGuns(this.power, false);
    }
    if (this.supportTimer > 0) {
      this.wingFireTimer -= dt;
      if (this.wingFireTimer <= 0) {
        this.wingFireTimer = 0.16;
        for (let i = 0; i < 2; i++) this.SpawnPlayerBullet(new V2(this.wingRoots[i].localPosition.x, this.wingRoots[i].localPosition.y).add(new V2(0, 0.4)), V2.up.mul(BulletSpeed), 0.8);
      }
    }

    if (this.Controls.actionPressed || this.Controls.action2Pressed) this.bombRequested = true;
    if (this.bombRequested) {
      this.bombRequested = false;
      this.UseBomb();
    }
  }

  private ReadDrag() {
    let delta = V2.zero;
    if (Touchscreen.present) {
      const t = Touchscreen.primaryTouch;
      const sp = t ? t.position : this.lastDrag;
      const pressedNow = !!t && t.press.wasPressedThisFrame, pressed = !!t && t.press.isPressed;
      if (pressedNow) {
        this.dragging = !overUI(sp) && sp.y < Screen.height * 0.9;
        this.lastDrag = sp;
      }
      if (this.dragging && pressed) {
        delta = delta.add(this.ScreenToWorld(sp).sub(this.ScreenToWorld(this.lastDrag)));
        this.lastDrag = sp;
      }
      if (!pressed) this.dragging = false;
      if (this.dragging) return delta;
    }
    if (Mouse.present) {
      const mp = Mouse.position;
      if (Mouse.leftButton.wasPressedThisFrame) {
        this.mouseDragging = !overUI(mp);
        this.lastDrag = mp;
      }
      if (this.mouseDragging && Mouse.leftButton.isPressed) {
        delta = delta.add(this.ScreenToWorld(mp).sub(this.ScreenToWorld(this.lastDrag)));
        this.lastDrag = mp;
      }
      if (!Mouse.leftButton.isPressed) this.mouseDragging = false;
    }
    return delta;
  }

  private PresentPlayer(dt: number, bankAmount: number) {
    this.pRoot.localPosition = new V3(this.pPos.x, this.pPos.y, 0);
    // Banking: squash the wings a little as the plane rolls
    const sx = 1 - Math.abs(bankAmount) * 0.22;
    this.pBody.localScale = new V3(sx, 1, 1);
    this.pBody.localRotation = Quaternion.euler(0, 0, -bankAmount * 6);
    this.pShadowSr.transform.localScale = new V3(PlayerSize * 0.85 * sx, PlayerSize * 0.85, 1);
    this.pPropSr.transform.localRotation = Quaternion.euler(0, 0, Time.time * 2400);
    const blink = this.invuln > 0 && this.State === Phase.Playing && Mathf.repeat(Time.time * 10, 1) < 0.5;
    this.pBodySr.color = blink ? new Color(1, 1, 1, 0.35) : Color.white;
    this.pFlashSr.color = Color.clear;

    const support = this.supportTimer > 0 && this.State === Phase.Playing;
    for (let i = 0; i < 2; i++) {
      if (this.wingRoots[i].activeSelf !== support) this.wingRoots[i].setActive(support);
      if (!support) continue;
      const side = i === 0 ? -1 : 1;
      const target = this.pPos.add(new V2(side * 1.25, -0.55 + 0.12 * Math.sin(Time.time * 3 + i)));
      const wl = this.wingRoots[i].localPosition;
      this.wingRoots[i].localPosition = V3.lerp(new V3(wl.x, wl.y, 0), target.toV3(), 1 - Math.exp(-dt * 12));
      this.wingProps[i].transform.localRotation = Quaternion.euler(0, 0, Time.time * 2400);
      if (this.supportTimer < 2) this.wingRoots[i].setActive(Mathf.repeat(Time.time * 8, 1) < 0.6);
    }
  }

  private FirePlayerGuns(level: number, quiet: boolean) {
    const dmg = 1 + 0.15 * this.Data.get("pw");
    const o = this.pPos.add(new V2(0, 0.7));
    const up = V2.up.mul(BulletSpeed);
    switch (level) {
      case 1:
        this.SpawnPlayerBullet(o.add(new V2(-0.13, 0)), up, dmg);
        this.SpawnPlayerBullet(o.add(new V2(0.13, 0)), up, dmg);
        break;
      case 2:
        this.SpawnPlayerBullet(o.add(new V2(-0.25, -0.05)), up, dmg);
        this.SpawnPlayerBullet(o, up, dmg);
        this.SpawnPlayerBullet(o.add(new V2(0.25, -0.05)), up, dmg);
        break;
      case 3:
        this.SpawnPlayerBullet(o.add(new V2(-0.25, -0.05)), up, dmg);
        this.SpawnPlayerBullet(o, up, dmg);
        this.SpawnPlayerBullet(o.add(new V2(0.25, -0.05)), up, dmg);
        this.SpawnPlayerBullet(o.add(new V2(-0.4, -0.2)), rot(V2.up, 8).mul(BulletSpeed), dmg);
        this.SpawnPlayerBullet(o.add(new V2(0.4, -0.2)), rot(V2.up, -8).mul(BulletSpeed), dmg);
        break;
      case 4:
        for (let i = 0; i < 4; i++) this.SpawnPlayerBullet(o.add(new V2(-0.39 + i * 0.26, -0.04 * Math.abs(i - 1.5))), up, dmg);
        this.SpawnPlayerBullet(o.add(new V2(-0.45, -0.2)), rot(V2.up, 10).mul(BulletSpeed), dmg);
        this.SpawnPlayerBullet(o.add(new V2(0.45, -0.2)), rot(V2.up, -10).mul(BulletSpeed), dmg);
        break;
      default:
        for (let i = 0; i < 5; i++) this.SpawnPlayerBullet(o.add(new V2(-0.44 + i * 0.22, -0.04 * Math.abs(i - 2))), up, dmg);
        this.SpawnPlayerBullet(o.add(new V2(-0.45, -0.2)), rot(V2.up, 9).mul(BulletSpeed), dmg);
        this.SpawnPlayerBullet(o.add(new V2(0.45, -0.2)), rot(V2.up, -9).mul(BulletSpeed), dmg);
        this.SpawnPlayerBullet(o.add(new V2(-0.5, -0.3)), rot(V2.up, 18).mul(BulletSpeed), dmg);
        this.SpawnPlayerBullet(o.add(new V2(0.5, -0.3)), rot(V2.up, -18).mul(BulletSpeed), dmg);
        break;
    }
    if (!quiet && Random.value < 0.5) Sfx.playClip(this.gunClip, 0.35, Random.range(0.9, 1.1));
  }

  private HitPlayer() {
    if (this.invuln > 0 || this.dying || this.missionWon) return;
    this.hp--;
    this.hitsTaken++;
    const oldPower = this.power;
    this.power = Math.max(1, this.power - 1);
    this.invuln = 2;
    this.Fx.shake(0.45);
    this.Fx.kick(0.6, 0.1);
    Fx.haptic(true);
    this.Hitstop(0.06);
    Sfx.play(Snd.Hurt);
    this.Explode(this.pPos, 0.9, 4);
    this.ClearEnemyBulletsNear(this.pPos, 2.2);
    if (oldPower !== this.power && this.hp > 0) this.UI.Float(this.pPos.add(V2.up.mul(1.1)), "POWER DOWN", Pal.Danger, 0.9);
    if (this.hp <= 0) {
      this.dying = true;
      this.deathTimer = 1.4;
      this.pRoot.setActive(false);
      for (const w of this.wingRoots) w.setActive(false);
      this.Explode(this.pPos, 1.8, 10);
      Sfx.playClip(this.bigBoomClip, 0.9, 1);
      this.Fx.shake(0.8);
    }
  }

  private UseBomb() {
    if (this.bombs <= 0 || this.dying || this.missionWon) { if (this.bombs <= 0) Sfx.play(Snd.Deny, 0.5); return; }
    this.bombs--;
    this.invuln = Math.max(this.invuln, 2);
    this.bombFlash.color = new Color(1, 0.96, 0.85, 0.85);
    this.Fx.shake(0.7);
    this.Fx.kick(1.2, 0.15);
    Fx.haptic(true);
    Sfx.playClip(this.bigBoomClip, 1, 1.05);
    for (const b of this.eBullets)
      if (b.Active) { this.Pop(b.Pos, 0.35); kill(b); }
    for (const e of this.enemies) {
      if (!e.Active || e.Delay > 0 || !this.OnScreen(e.Pos, 0.5)) continue;
      this.Damage(e, e.Kind === Kind.Boss ? e.MaxHp * 0.07 : 40, true);
    }
    for (let i = 0; i < 10; i++)
      this.Explode(new V2((this.rng.nextDouble() * 2 - 1) * this.laneHalf, Mathf.lerp(this.viewBottom + 2, this.viewTop - 2, this.rng.nextDouble())), 1.2, 2);
  }

  private UpdateBombFlash(dt: number) {
    const c = this.bombFlash.color;
    if (c.a <= 0) return;
    this.bombFlash.color = c.withAlpha(Mathf.moveTowards(c.a, 0, dt * 1.6));
  }

  // ------------------------------------------------------------------ bullets

  private SpawnPlayerBullet(pos: V2, vel: V2, dmg: number) {
    for (let i = 0; i < this.pBullets.length; i++) {
      const b = this.pBullets[i];
      if (b.Active) continue;
      b.Active = true;
      b.Pos = pos;
      b.Vel = vel;
      b.Damage = dmg;
      b.Sr.gameObject.setActive(true);
      b.Sr.transform.localPosition = pos;
      b.Sr.transform.localRotation = Quaternion.euler(0, 0, Math.atan2(vel.y, vel.x) * Mathf.Rad2Deg - 90);
      b.Sr.transform.localScale = new V3(0.36, 0.36, 1); // sprite is 1:2, so 0.36 x 0.72 world
      return;
    }
  }

  private SpawnEnemyBullet(pos: V2, vel: V2, big: boolean) {
    for (let i = 0; i < this.eBullets.length; i++) {
      const b = this.eBullets[i];
      if (b.Active) continue;
      b.Active = true;
      b.Pos = pos;
      b.Vel = vel;
      b.Big = big;
      b.Sr.sprite = big ? SkyfireArt.EnemyBulletBig : SkyfireArt.EnemyBullet;
      const s = big ? 0.6 : 0.44;
      b.Sr.transform.localScale = new V3(s, s, 1);
      b.Sr.transform.localPosition = pos;
      b.Sr.gameObject.setActive(true);
      return;
    }
  }

  private get EnemyBulletSpeed() { return 4.6 + 0.22 * Math.min(this.mission, 10); }

  private FireAimed(from: V2, count: number, spreadDeg: number, speedMul = 1, big = false) {
    let dir = this.pPos.sub(from);
    if (dir.sqrMagnitude < 0.01) dir = V2.down;
    dir = dir.normalized;
    const start = -spreadDeg * (count - 1) * 0.5;
    for (let i = 0; i < count; i++) this.SpawnEnemyBullet(from, rot(dir, start + spreadDeg * i).mul(this.EnemyBulletSpeed * speedMul), big);
  }

  private FireRing(from: V2, count: number, offsetDeg: number, speedMul = 1, big = false) {
    for (let i = 0; i < count; i++) {
      const a = (offsetDeg + (360 * i) / count) * Mathf.Deg2Rad;
      this.SpawnEnemyBullet(from, new V2(Math.cos(a), Math.sin(a)).mul(this.EnemyBulletSpeed * speedMul), big);
    }
  }

  private OnScreen(p: V2, margin: number) { return p.y < this.viewTop + margin && p.y > this.viewBottom - margin && Math.abs(p.x) < this.viewHalfW + margin; }

  private UpdatePlayerBullets(dt: number) {
    for (let i = 0; i < this.pBullets.length; i++) {
      const b = this.pBullets[i];
      if (!b.Active) continue;
      b.Pos = b.Pos.add(b.Vel.mul(dt));
      if (b.Pos.y > this.viewTop + 0.5 || Math.abs(b.Pos.x) > this.viewHalfW + 0.5) { kill(b); continue; }
      b.Sr.transform.localPosition = b.Pos;
      if (this.State !== Phase.Playing && this.State !== Phase.Title) continue;
      for (let j = 0; j < this.enemies.length; j++) {
        const e = this.enemies[j];
        if (!e.Active || e.Delay > 0 || !e.Entered) continue;
        if (!this.HitsEnemy(e, b.Pos)) continue;
        this.Damage(e, b.Damage, false);
        this.Pop(b.Pos, 0.28);
        kill(b);
        break;
      }
    }
  }

  private HitsEnemy(e: Enemy, p: V2) {
    const d = p.sub(e.Pos);
    if (e.Kind === Kind.Boss) {
      // Body plus both wings
      if (d.sqrMagnitude < 1.3 * 1.3) return true;
      const wy = d.y - 0.25;
      return Math.abs(wy) < 0.7 && Math.abs(d.x) < e.Size * 0.48;
    }
    if (e.Kind === Kind.Bomber) {
      if (Math.abs(d.x) < 0.35 && Math.abs(d.y) < e.Size * 0.45) return true;
      return Math.abs(d.y - 0.25) < 0.4 && Math.abs(d.x) < e.Size * 0.47;
    }
    return d.sqrMagnitude < e.Radius * e.Radius;
  }

  private UpdateEnemyBullets(dt: number, collide: boolean) {
    const pr = PlayerRadius + 0.13;
    for (let i = 0; i < this.eBullets.length; i++) {
      const b = this.eBullets[i];
      if (!b.Active) continue;
      b.Pos = b.Pos.add(b.Vel.mul(dt));
      if (!this.OnScreen(b.Pos, 0.6)) { kill(b); continue; }
      b.Sr.transform.localPosition = b.Pos;
      if (!collide) continue;
      const r = b.Big ? pr + 0.07 : pr;
      if (b.Pos.sub(this.pPos).sqrMagnitude < r * r && this.invuln <= 0) {
        kill(b);
        this.HitPlayer();
      }
    }
  }

  private ClearEnemyBulletsNear(p: V2, radius: number) {
    for (const b of this.eBullets)
      if (b.Active && b.Pos.sub(p).sqrMagnitude < radius * radius) { this.Pop(b.Pos, 0.3); kill(b); }
  }

  // ------------------------------------------------------------------ director (waves and boss)

  private UpdateDirector(dt: number) {
    this.missionClock += dt;
    while (this.waveCursor < this.waves.length && this.missionClock >= this.waves[this.waveCursor].T) {
      const w = this.waves[this.waveCursor++];
      switch (w.Type) {
        case WaveType.Wedge: this.SpawnWedge(w.X, false); break;
        case WaveType.Sweep: this.SpawnSweep(w.Side, false); break;
        case WaveType.Divers: this.SpawnDivers(); break;
        case WaveType.Bomber: this.SpawnBomber(w.X); break;
        case WaveType.RedSquadron: this.SpawnSweep(w.Side, true); break;
        case WaveType.Pincer: this.SpawnSweep(-1, false, 4); this.SpawnSweep(1, false, 4); break;
      }
    }

    if (!this.bossSpawned && this.missionClock > MissionLength + 2 && (this.CountEnemies() <= 2 || this.missionClock > MissionLength + 9)) {
      this.bossSpawned = true;
      this.SpawnBoss();
    }
  }

  private CountEnemies() {
    let n = 0;
    for (const e of this.enemies) if (e.Active) n++;
    return n;
  }

  private NewEnemy(kind: Kind, pos: V2, delay: number): Enemy | null {
    let e: Enemy | null = null;
    for (const x of this.enemies) if (!x.Active) { e = x; break; }
    if (!e) return null;
    if (!e.Root) {
      e.Root = new GameObject("Enemy", this.world);
      e.Body = new GameObject("Body", e.Root);
      e.ShadowSr = SkyfireArt.Spr(e.Root, "Shadow", null, new Color(0, 0, 0, 0.26), 1, -870);
      e.BodySr = SkyfireArt.Spr(e.Body, "Plane", null, Color.white, 1, 10);
      e.FlashSr = Art.spr(e.Body, "Flash", null!, Color.clear, 1, 11, Art.Additive);
      e.PropSr = SkyfireArt.Spr(e.Body, "Prop", SkyfireArt.Prop, Color.white, 1, 12);
    }
    e.Kind = kind;
    e.Active = true;
    e.Entered = false;
    e.Pos = pos;
    e.Vel = V2.zero;
    e.T = 0;
    e.Delay = delay;
    e.Phase = 0;
    e.Group = 0;
    e.Flash = 0;
    e.Turn = 0;
    e.Heading = 180;
    e.FireTimer = 1 + this.rng.nextDouble() * 1.8;
    const hpMul = 1 + 0.14 * (this.mission - 1);

    let style: PlaneStyle;
    let body: Color, wing: Color, accent: Color;
    switch (kind) {
      case Kind.Red:
        style = PlaneStyle.Interceptor; body = new Color(0.86, 0.2, 0.18); wing = new Color(0.76, 0.16, 0.14); accent = Color.white;
        e.Size = 1.15; e.Radius = 0.5; e.MaxHp = 3 * hpMul; e.Score = 150; e.Coins = 1; e.Alt = 0.55;
        break;
      case Kind.Diver:
        style = PlaneStyle.Interceptor; body = new Color(0.40, 0.44, 0.55); wing = new Color(0.34, 0.38, 0.48); accent = new Color(1, 0.85, 0.2);
        e.Size = 1.15; e.Radius = 0.5; e.MaxHp = 4 * hpMul; e.Score = 150; e.Coins = 2; e.Alt = 0.55;
        break;
      case Kind.Bomber:
        style = PlaneStyle.Bomber; body = new Color(0.52, 0.54, 0.42); wing = new Color(0.45, 0.47, 0.36); accent = new Color(0.9, 0.32, 0.2);
        e.Size = 3.2; e.Radius = 1.2; e.MaxHp = 45 * hpMul; e.Score = 1500; e.Coins = 10; e.Alt = 1.0;
        break;
      case Kind.Boss:
        style = PlaneStyle.Fortress; body = new Color(0.47, 0.50, 0.57); wing = new Color(0.40, 0.43, 0.50); accent = new Color(0.9, 0.22, 0.2);
        e.Size = 6.4; e.Radius = 2; e.MaxHp = 280 + 110 * (this.mission - 1); e.Score = 10000; e.Coins = 40; e.Alt = 1.6;
        break;
      default:
        style = PlaneStyle.EnemyFighter; body = new Color(0.38, 0.54, 0.31); wing = new Color(0.32, 0.47, 0.26); accent = new Color(1, 0.8, 0.2);
        e.Size = 1.2; e.Radius = 0.5; e.MaxHp = (kind === Kind.Escort ? 4 : 3) * hpMul; e.Score = 100; e.Coins = 1; e.Alt = 0.5;
        break;
    }
    e.Hp = e.MaxHp;
    e.BodySr.sprite = SkyfireArt.Plane(style, body, wing, accent);
    e.FlashSr.sprite = SkyfireArt.Silhouette(style);
    e.ShadowSr.sprite = e.FlashSr.sprite;
    e.BodySr.transform.localScale = V3.one.mul(e.Size);
    e.FlashSr.transform.localScale = V3.one.mul(e.Size);
    e.ShadowSr.transform.localScale = V3.one.mul(e.Size * 0.85);
    e.ShadowSr.transform.localPosition = new V3(0.35 + e.Alt * 0.25, -0.5 - e.Alt * 0.35, 0);
    const prop = kind !== Kind.Bomber && kind !== Kind.Boss;
    e.PropSr.gameObject.setActive(prop);
    if (prop) {
      e.PropSr.transform.localScale = V3.one.mul(e.Size * 0.34);
      e.PropSr.transform.localPosition = new V3(0, e.Size * 0.44, 0);
    }
    e.Root.localPosition = new V3(pos.x, pos.y, 0);
    e.Root.setActive(delay <= 0);
    return e;
  }

  private SpawnWedge(cx: number, demo: boolean) {
    const count = demo ? 3 : Math.min(7, 5 + Math.trunc((this.mission - 1) / 3));
    for (let i = 0; i < count; i++) {
      const k = i - Math.trunc(count / 2);
      const e = this.NewEnemy(Kind.Fighter, new V2(cx + k * 0.9, this.viewTop + 1 + Math.abs(k) * 0.7), 0);
      if (!e) return;
      e.Speed = demo ? 2.2 : 2.6 + 0.05 * this.mission;
      e.X0 = e.Pos.x;
      e.Amp = 0.35;
      e.Phase = 0;
      if (demo) e.FireTimer = 99;
    }
  }

  private SpawnSweep(side: number, red: boolean, count = 0) {
    const n = count > 0 ? count : red ? 5 : 6;
    const group = red ? this.nextGroup++ : 0;
    if (red) { this.groupAlive.set(group, n); this.groupEscaped.set(group, false); }
    for (let i = 0; i < n; i++) {
      const e = this.NewEnemy(red ? Kind.Red : Kind.Fighter, new V2(side * (this.laneHalf + 0.8), this.viewTop - 1.5), i * 0.32);
      if (!e) return;
      e.Dir = -side;
      e.Group = group;
      e.Speed = 4.4 + 0.05 * this.mission;
      e.Vel = new V2(e.Dir * 0.85, -0.52).normalized.mul(e.Speed);
      e.Turn = e.Dir * 34; // degrees per second, curving down and across
      e.Phase = 1;
    }
  }

  private SpawnDivers() {
    const n = Math.min(5, 3 + Math.trunc((this.mission - 1) / 4));
    for (let i = 0; i < n; i++) {
      const x = Mathf.lerp(-this.laneHalf + 1.2, this.laneHalf - 1.2, n === 1 ? 0.5 : i / (n - 1));
      const e = this.NewEnemy(Kind.Diver, new V2(x, this.viewTop + 1), i * 0.25);
      if (!e) return;
      e.Phase = 2;
      e.Y0 = this.viewTop - 2.6 - this.rng.nextDouble() * 1.2;
      e.Speed = 7.2 + 0.15 * this.mission;
    }
  }

  private SpawnBomber(x: number) {
    const e = this.NewEnemy(Kind.Bomber, new V2(Mathf.clamp(x, -this.laneHalf + 1.8, this.laneHalf - 1.8), this.viewTop + 2), 0);
    if (!e) return;
    e.Phase = 3;
    e.Speed = 1.0;
    e.X0 = e.Pos.x;
    e.Y0 = this.viewTop - 3.8;
    e.FireTimer = 2.2;
  }

  private SpawnBoss() {
    const e = this.NewEnemy(Kind.Boss, new V2(0, this.viewTop + 4), 0);
    if (!e) { this.bossSpawned = false; return; } // pool full: try again next frame
    this.boss = e;
    e.Phase = 4;
    e.FireTimer = 2;
    e.Y0 = this.viewTop - 4.2;
    this.bossBar.setActive(true);
    this.UI.Announce("WARNING: FLYING FORTRESS", Pal.Danger, 2.2);
    Sfx.play(Snd.Alarm, 0.8);
    Sfx.setIntensity(1);
  }

  // ------------------------------------------------------------------ enemy behaviour

  private UpdateEnemies(dt: number, attract: boolean) {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.Active) continue;
      if (e.Delay > 0) {
        e.Delay -= dt;
        if (e.Delay > 0) continue;
        e.Root!.setActive(true);
      }
      e.T += dt;
      e.Flash = Mathf.moveTowards(e.Flash, 0, dt * 6);
      const prev = e.Pos;

      switch (e.Phase) {
        case 0: // straight wedge with gentle sway
          e.Pos = new V2(e.X0 + Math.sin(e.T * 1.6 + e.X0) * e.Amp, e.Pos.y - e.Speed * dt);
          break;
        case 1: // curving sweep
          e.Vel = rot(e.Vel, e.Turn * dt);
          if (e.Vel.y > -0.5 * e.Speed) e.Turn = 0; // stop turning once heading mostly down/across
          e.Pos = e.Pos.add(e.Vel.mul(dt));
          break;
        case 2: // diver: drop in, pause, lock on, dive
          if (e.T < 1.1) e.Pos = e.Pos.withY(Mathf.lerp(this.viewTop + 1, e.Y0, Ease.outCubic(e.T / 1.1)));
          else if (e.T < 1.6) { /* pause */ }
          else {
            if (e.Vel.equals(V2.zero)) {
              const d = this.pPos.sub(e.Pos);
              e.Vel = (d.sqrMagnitude > 0.01 ? d.normalized : V2.down).mul(e.Speed);
              if (e.Vel.y > -1) e.Vel = new V2(e.Vel.x, -1).normalized.mul(e.Speed);
            }
            e.Pos = e.Pos.add(e.Vel.mul(dt));
          }
          break;
        case 3: // bomber: descend, hover and sway, then leave
          if (e.T < 4) e.Pos = e.Pos.withY(Mathf.lerp(this.viewTop + 2, e.Y0, Ease.outCubic(Mathf.clamp01(e.T / 4))));
          else if (e.T < 13) e.Pos = e.Pos.withX(e.X0 + Math.sin((e.T - 4) * 0.6) * Math.max(0, Math.min(1.6, this.laneHalf - 1.7 - Math.abs(e.X0))));
          else e.Pos = e.Pos.withY(e.Pos.y - 1.8 * dt);
          break;
        case 4: // boss
          if (e.T < 3) e.Pos = e.Pos.withY(Mathf.lerp(this.viewTop + 4, e.Y0, Ease.outCubic(e.T / 3)));
          else {
            const frac = e.Hp / e.MaxHp;
            const spd = frac < 0.33 ? 0.75 : 0.5;
            e.Pos = new V2(Math.sin((e.T - 3) * spd) * Math.min(2.3, this.laneHalf - 2.6 + 1.2), e.Y0 + Math.sin((e.T - 3) * 0.9) * 0.4);
          }
          break;
      }

      if (!e.Entered && e.Pos.y < this.viewTop - 0.2 && Math.abs(e.Pos.x) < this.laneHalf + 0.2) e.Entered = true;

      // Facing: point the nose along the motion (planes are drawn nose-up)
      const v = e.Pos.sub(prev);
      if (e.Kind === Kind.Boss || e.Kind === Kind.Bomber) e.Heading = 180;
      else if (v.sqrMagnitude > 1e-6) {
        const target = Math.atan2(v.y, v.x) * Mathf.Rad2Deg - 90;
        e.Heading = Mathf.moveTowardsAngle(e.Heading, target, 360 * dt);
      } else if (e.T < 0.05) e.Heading = 180;

      if (!attract) this.EnemyFire(e, dt);

      // Collision with the player
      if (!attract && this.State === Phase.Playing && !this.dying && this.invuln <= 0 && e.Entered && this.HitsEnemy(e, this.pPos)) {
        if (e.Kind === Kind.Fighter || e.Kind === Kind.Red || e.Kind === Kind.Diver || e.Kind === Kind.Escort) this.Damage(e, 999, false);
        this.HitPlayer();
      }

      // Leaving the screen
      if (e.Pos.y < this.viewBottom - 2 || (e.Entered && Math.abs(e.Pos.x) > this.viewHalfW + 2.5)) {
        if (e.Group > 0) this.groupEscaped.set(e.Group, true);
        this.Despawn(e);
        continue;
      }
      this.PresentEnemy(e);
    }
  }

  private PresentEnemy(e: Enemy) {
    e.Root!.localPosition = new V3(e.Pos.x, e.Pos.y, 0);
    const r = Quaternion.euler(0, 0, e.Heading);
    e.Body.localRotation = r;
    e.ShadowSr.transform.localRotation = r;
    e.FlashSr.color = new Color(1, 1, 1, e.Flash * 0.85);
    if (e.PropSr.gameObject.activeSelf) e.PropSr.transform.localRotation = Quaternion.euler(0, 0, Time.time * 2200);
    if (e.Kind === Kind.Boss && e.Hp / e.MaxHp < 0.33 && Random.value < 0.2)
      this.SpawnPuff(e.Pos.add(new V2(Random.range(-2.4, 2.4), Random.range(-0.4, 0.8))), V2.down.mul(1.5), 0.6, 0.9, false);
  }

  private EnemyFire(e: Enemy, dt: number) {
    if (!e.Entered || this.State !== Phase.Playing || this.dying) return;
    e.FireTimer -= dt;
    const frac = e.Hp / e.MaxHp;
    const mission = this.mission;
    switch (e.Kind) {
      case Kind.Fighter:
      case Kind.Escort:
      case Kind.Red:
        if (e.FireTimer <= 0) {
          e.FireTimer = Math.max(1.2, (2.6 + this.rng.nextDouble() * 1.6) * Math.pow(0.95, mission - 1));
          if (e.Pos.y > this.pPos.y + 2.5 && e.Pos.y < this.viewTop - 0.5) this.FireAimed(e.Pos, mission >= 6 && e.Kind === Kind.Escort ? 2 : 1, 12);
        }
        break;
      case Kind.Diver:
        if (e.T > 1.2 && e.T < 1.25 + dt && e.FireTimer < 99) {
          e.FireTimer = 99;
          this.FireAimed(e.Pos, mission >= 3 ? 3 : 1, 14);
        }
        break;
      case Kind.Bomber:
        if (e.FireTimer <= 0 && e.T < 13) {
          e.FireTimer = Math.max(1.1, 2.0 - 0.06 * mission);
          this.FireRing(e.Pos, 10 + Math.min(mission, 8), e.T * 40, 0.8);
        }
        break;
      case Kind.Boss:
        if (e.T < 3) return;
        if (frac > 0.66) {
          if (e.FireTimer <= 0) {
            e.FireTimer = 1.3;
            this.FireAimed(e.Pos.add(new V2(0, -1.6)), 5, 12, 1);
            if (Mathf.repeat(e.T, 4.5) < 1.3) this.SpawnEscorts(e.Pos);
          }
        } else if (frac > 0.33) {
          if (e.FireTimer <= 0) {
            e.FireTimer = 0.13;
            const a = e.T * 140;
            this.SpawnEnemyBullet(e.Pos, new V2(Math.cos(a * Mathf.Deg2Rad), Math.sin(a * Mathf.Deg2Rad)).mul(this.EnemyBulletSpeed * 0.75), false);
            this.SpawnEnemyBullet(e.Pos, new V2(Math.cos((a + 180) * Mathf.Deg2Rad), Math.sin((a + 180) * Mathf.Deg2Rad)).mul(this.EnemyBulletSpeed * 0.75), false);
            if (Mathf.repeat(e.T, 2) < 0.13) this.FireAimed(e.Pos.add(new V2(0, -1.6)), 3, 10, 1.15, true);
          }
        } else {
          if (e.FireTimer <= 0) {
            e.FireTimer = 0.85;
            this.FireRing(e.Pos, 16, e.T * 23, 0.8, true);
            this.FireAimed(e.Pos.add(new V2(0, -1.6)), 3, 8, 1.25);
          }
        }
        break;
    }
  }

  private SpawnEscorts(_near: V2) {
    for (let s = -1; s <= 1; s += 2) {
      const e = this.NewEnemy(Kind.Escort, new V2(s * (this.laneHalf + 0.8), this.viewTop - 2.2), 0);
      if (!e) return;
      e.Dir = -s;
      e.Speed = 4.8;
      e.Vel = new V2(e.Dir * 0.8, -0.6).normalized.mul(e.Speed);
      e.Turn = e.Dir * 40;
      e.Phase = 1;
    }
  }

  private Damage(e: Enemy, dmg: number, bomb: boolean) {
    if (!e.Active || e.Hp <= 0) return;
    e.Hp -= dmg;
    e.Flash = 1;
    if (e.Kind === Kind.Boss && this.State === Phase.Playing) this.Fx.shake(0.02);
    if (e.Hp > 0) return;
    this.Destroyed(e, bomb);
  }

  private Destroyed(e: Enemy, _bomb: boolean) {
    const demo = this.State !== Phase.Playing;
    if (!demo) {
      this.kills++;
      this.score += e.Score;
    }
    switch (e.Kind) {
      case Kind.Boss:
        this.BossDeath(e);
        return;
      case Kind.Bomber:
        this.Explode(e.Pos, 2.0, 8);
        Sfx.playClip(this.bigBoomClip, 0.75, 1.15);
        this.Fx.shake(0.4);
        if (!demo) {
          this.DropCoins(e.Pos, e.Coins, 1.5);
          this.DropPickup(e.Pos, this.rng.nextDouble() < 0.5 ? Pickup.Bomb : Pickup.Health);
          this.UI.Float(e.Pos.add(V2.up), "+" + Fmt.n(e.Score), Gold, 1);
        }
        break;
      default: {
        this.Explode(e.Pos, 0.9, 3);
        Sfx.playClip(this.boomClip, 0.55, Random.range(0.9, 1.15));
        if (!demo) {
          if (this.rng.nextDouble() < 0.35) this.DropCoins(e.Pos, e.Coins, 0.4);
          const r = this.rng.nextDouble();
          if (r < 0.025) this.DropPickup(e.Pos, Pickup.Support);
          else if (r < 0.045) this.DropPickup(e.Pos, Pickup.Health);
          else if (r < 0.06) this.DropPickup(e.Pos, Pickup.Bomb);
          else if (r < 0.075) this.DropPickup(e.Pos, Pickup.Power);
        }
        break;
      }
    }

    if (e.Group > 0 && this.groupAlive.has(e.Group)) {
      this.groupAlive.set(e.Group, this.groupAlive.get(e.Group)! - 1);
      if (this.groupAlive.get(e.Group)! <= 0 && !this.groupEscaped.get(e.Group) && !demo) {
        this.DropPickup(e.Pos, Pickup.Power);
        this.UI.Float(e.Pos.add(V2.up.mul(0.8)), "SQUADRON DOWN!", Gold, 1.05);
        this.score += 1000;
        Sfx.play(Snd.Coin, 0.8, 1.2);
      }
    }
    this.Despawn(e);
  }

  private BossDeath(e: Enemy) {
    this.bossDead = true;
    this.bossClock = 0;
    this.bossBar.setActive(false);
    for (const b of this.eBullets) if (b.Active) { this.Pop(b.Pos, 0.3); kill(b); }
    for (let i = 0; i < 14; i++)
      this.Explode(e.Pos.add(new V2(Random.range(-2.6, 2.6), Random.range(-1.2, 1.2))), Random.range(1.2, 2.2), 3);
    this.Explode(e.Pos, 3.2, 14);
    Sfx.playClip(this.bigBoomClip, 1, 0.85);
    this.Fx.shake(1);
    this.Fx.kick(1.4, 0.2);
    Fx.haptic(true);
    this.SlowMo(0.35, 0.8);
    this.DropCoins(e.Pos, e.Coins + 5 * this.mission, 2.6);
    this.UI.Float(e.Pos.add(V2.up.mul(1.5)), "+" + Fmt.n(e.Score), Gold, 1.4);
    this.UI.Announce("FORTRESS DESTROYED!", Gold, 2);
    this.Despawn(e);
    this.boss = null;
  }

  private Despawn(e: Enemy) {
    e.Active = false;
    if (e.Root) e.Root.setActive(false);
  }

  // ------------------------------------------------------------------ pickups

  private DropCoins(at: V2, value: number, spread: number) {
    const pieces = Mathf.clamp(value, 1, 10);
    const each = Math.max(1, Math.trunc(value / pieces));
    for (let i = 0; i < pieces; i++) {
      const p = this.NewPickup(Pickup.Coin, at);
      if (!p) return;
      p.Value = each;
      p.Vel = Random.insideUnitCircle.mul(2 + spread * 2).add(V2.up.mul(1.5));
    }
  }

  private DropPickup(at: V2, kind: Pickup) {
    const p = this.NewPickup(kind, at);
    if (!p) return;
    p.Vel = new V2(Random.range(-1.5, 1.5), 1.5);
  }

  private NewPickup(kind: Pickup, at: V2): PickupItem | null {
    for (const p of this.pickups) {
      if (p.Active) continue;
      p.Active = true;
      p.Kind = kind;
      p.Pos = at;
      p.T = 0;
      p.Value = 1;
      p.Sr.sprite = SkyfireArt.PickupSprite(kind);
      const s = kind === Pickup.Coin ? 0.5 : 0.78;
      p.Sr.transform.localScale = new V3(s, s, 1);
      p.Sr.gameObject.setActive(true);
      return p;
    }
    return null;
  }

  private UpdatePickups(dt: number) {
    const magnet = 2.4;
    for (const p of this.pickups) {
      if (!p.Active) continue;
      p.T += dt;
      const toPlayer = this.pPos.sub(p.Pos);
      const dist = toPlayer.magnitude;
      if (p.Kind === Pickup.Coin) {
        p.Vel = p.Vel.mul(1 - Math.min(1, 2.5 * dt));
        p.Vel = p.Vel.add(V2.down.mul(1.6 * dt));
        if (dist < magnet || p.T > 1.2) p.Vel = p.Vel.add(toPlayer.normalized.mul(18 * dt).mul(p.T > 1.2 ? 1.6 : 1));
        p.Sr.transform.localScale = new V3(0.5 * Math.abs(Math.cos(p.T * 6)) + 0.05, 0.5, 1);
      } else {
        // Power-ups drift and bounce off the lane edges so the player can chase them
        p.Vel = V2.lerp(p.Vel, new V2(Mathf.sign(p.Vel.x === 0 ? 1 : p.Vel.x) * 1.4, -1.1), dt * 1.5);
        if (dist < 1.2) p.Vel = p.Vel.add(toPlayer.normalized.mul(10 * dt));
        if (Math.abs(p.Pos.x) > this.laneHalf - 0.4) p.Vel = p.Vel.withX(-Mathf.sign(p.Pos.x) * Math.abs(p.Vel.x));
        const pulse = 0.78 * (1 + 0.08 * Math.sin(p.T * 8));
        p.Sr.transform.localScale = new V3(pulse, pulse, 1);
      }
      p.Pos = p.Pos.add(p.Vel.mul(dt));
      p.Sr.transform.localPosition = p.Pos;
      if (dist < 0.75) { this.Collect(p); continue; }
      if (p.Pos.y < this.viewBottom - 1) { p.Active = false; p.Sr.gameObject.setActive(false); }
    }
  }

  private Collect(p: PickupItem) {
    p.Active = false;
    p.Sr.gameObject.setActive(false);
    const up = this.pPos.add(V2.up);
    switch (p.Kind) {
      case Pickup.Coin:
        this.coinsRun += p.Value;
        this.Coins += p.Value;
        this.score += 20 * p.Value;
        Sfx.play(Snd.Coin, 0.35, Random.range(1.1, 1.3));
        return;
      case Pickup.Power:
        if (this.power < MaxPower) { this.power++; this.UI.Float(up, "POWER UP!", Pal.Danger, 1.05); }
        else { this.score += 2000; this.UI.Float(up, "MAX POWER +2,000", Gold, 1); }
        break;
      case Pickup.Bomb:
        this.bombs = Math.min(9, this.bombs + 1);
        this.UI.Float(up, "+1 BOMB", SkyBlue, 1);
        break;
      case Pickup.Health:
        if (this.hp < this.maxHp) { this.hp++; this.UI.Float(up, "REPAIRED!", Pal.Good, 1); }
        else { this.score += 1000; this.UI.Float(up, "+1,000", Gold, 0.9); }
        break;
      case Pickup.Support:
        this.supportTimer = 12;
        for (let i = 0; i < 2; i++) this.wingRoots[i].localPosition = this.pPos.add(new V2(i === 0 ? -3 : 3, -2));
        this.UI.Float(up, "WINGMEN!", Gold, 1);
        break;
    }
    Sfx.playClip(this.pickupClip, 0.8, 1);
    this.Fx.ring(p.Pos, Color.white.scale(0.5), 0.3, 1.4, 0.3);
  }

  // ------------------------------------------------------------------ explosions

  private Explode(at: V2, size: number, pieces: number) {
    this.SpawnPuff(at, V2.zero, size, 0.5, true);
    for (let i = 0; i < pieces; i++) {
      const o = Random.insideUnitCircle.mul(size * 0.45);
      this.SpawnPuff(at.add(o), o.mul(1.5), size * Random.range(0.45, 0.8), Random.range(0.35, 0.6), true);
      this.SpawnPuff(at.add(o), o.add(V2.down.mul(1.2)), size * Random.range(0.5, 0.9), Random.range(0.7, 1.1), false);
    }
    this.Fx.burst(at, new Color(1, 0.7, 0.3), 6 + pieces * 2, 5 * size, 0.16, 0.45);
  }

  private Pop(at: V2, size: number) { this.SpawnPuff(at, V2.zero, size, 0.18, true); }

  private SpawnPuff(at: V2, vel: V2, size: number, duration: number, fire: boolean) {
    const p = this.puffs[this.puffCursor];
    this.puffCursor = (this.puffCursor + 1) % this.puffs.length;
    p.Active = true;
    p.Pos = at;
    p.Vel = vel;
    p.T = 0;
    p.Duration = duration;
    p.Size = size;
    p.Fire = fire;
    p.Sr.sprite = fire ? SkyfireArt.Fireball : SkyfireArt.Smoke;
    p.Sr.sortingOrder = fire ? 29 : 28;
    p.Sr.transform.localRotation = Quaternion.euler(0, 0, Random.range(0, 360));
    p.Sr.gameObject.setActive(true);
  }

  private UpdatePuffs(dt: number) {
    for (const p of this.puffs) {
      if (!p.Active) continue;
      p.T += dt;
      const k = p.T / p.Duration;
      if (k >= 1) { p.Active = false; p.Sr.gameObject.setActive(false); continue; }
      p.Pos = p.Pos.add(p.Vel.add(V2.down.mul(ScrollSpeed)).mul(dt));
      const s = p.Size * (p.Fire ? Mathf.lerp(0.4, 1.1, Ease.outCubic(k)) : Mathf.lerp(0.6, 1.4, k));
      p.Sr.transform.localPosition = p.Pos;
      p.Sr.transform.localScale = new V3(s, s, 1);
      p.Sr.color = p.Fire ? new Color(1, 1 - k * 0.3, 1 - k * 0.6, 1 - k * k) : new Color(1, 1, 1, (1 - k) * 0.8);
    }
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    set(this.scoreText, Fmt.n(this.score));
    set(this.missionText, `MISSION ${this.mission}  ·  ${themeName(this.theme)}`);
    set(this.coinText, Fmt.n(this.Coins));
    UIKit.setMeter(this.progressFill, Mathf.clamp01(this.missionClock / (MissionLength + 2)));
    for (let i = 0; i < this.hearts.length; i++) {
      const slot = i < this.maxHp;
      if (this.hearts[i].gameObject.activeSelf !== slot) this.hearts[i].gameObject.setActive(slot);
      this.hearts[i].color = i < this.hp ? Color.white : new Color(0.15, 0.15, 0.2, 0.55);
    }
    if (this.boss && this.boss.Active) UIKit.setMeter(this.bossFill, this.boss.Hp / this.boss.MaxHp);
    set(this.powerText, this.power >= MaxPower ? "POWER MAX" : `POWER ${this.power}/${MaxPower}`);
    set(this.bombButton.label, `BOMB ×${this.bombs}`);
    this.bombButton.interactable = this.bombs > 0 && !this.dying;
  }

  // ------------------------------------------------------------------ results

  private Win() {
    this.missionWon = true;
    const mission = this.mission;
    const stars = this.hitsTaken === 0 ? 3 : this.hitsTaken <= 1 ? 2 : 1;
    const prev = this.Data.get("s" + mission);
    if (stars > prev) {
      this.Data.set("s" + mission, stars);
      this.Data.add("stars", stars - prev);
    }
    const newBest = this.Data.max("best", this.score);
    this.Data.add("kills", this.kills);
    this.Data.set("mission", mission + 1);
    this.Data.max("bestMission", mission + 1);
    Sfx.play(Snd.Win);
    const earned = this.coinsRun;
    this.Finish(new Result({
      Headline: `MISSION ${mission} COMPLETE!`,
      HeadlineColor: Gold,
      Stars: stars,
      Value: Fmt.n(this.score),
      NewBest: newBest,
      BestLine: `NEXT: MISSION ${mission + 1} · ${themeName(themeFor(mission + 1))}`,
      Stats: [
        ["SCORE", Fmt.n(this.score)],
        ["PLANES DOWNED", String(this.kills)],
        ["HITS TAKEN", String(this.hitsTaken)],
        ["COINS", "+" + Fmt.n(earned)],
      ],
      Primary: "NEXT MISSION",
      Victory: true,
      Reward: earned > 0 ? () => {
        this.Coins += earned;
        Sfx.play(Snd.Coin, 0.9, 1.15);
        this.UI.Toast(`+${Fmt.n(earned)} bonus coins!`, 2.5);
      } : null,
      RewardLabel: `DOUBLE COINS +${Fmt.n(earned)} (WATCH AD)`,
    }));
  }

  private Lose() {
    const newBest = this.Data.max("best", this.score);
    this.Data.add("kills", this.kills);
    Sfx.play(Snd.Lose);
    this.Finish(new Result({
      Headline: "SHOT DOWN",
      HeadlineColor: Pal.Danger,
      Value: Fmt.n(this.score),
      CountTo: this.score,
      NewBest: newBest,
      BestLine: `MISSION ${this.mission} · ${Mathf.roundToInt(Mathf.clamp01(this.missionClock / (MissionLength + 2)) * 100)}% COMPLETE`,
      Stats: [
        ["SCORE", Fmt.n(this.score)],
        ["PLANES DOWNED", String(this.kills)],
        ["COINS", "+" + Fmt.n(this.coinsRun)],
        ["BEST", Fmt.n(this.Data.get("best"))],
      ],
      Primary: "RETRY MISSION",
      Victory: false,
      Reward: this.revived ? null : () => this.Continue(),
      RewardLabel: "CONTINUE WITH FULL HEALTH (AD)",
    }));
  }

  private Continue() {
    this.revived = true;
    this.hp = this.maxHp;
    this.bombs = Math.max(this.bombs, 1) + 1;
    this.invuln = 3;
    this.dying = false;
    for (const b of this.eBullets) kill(b);
    this.pRoot.setActive(true);
    this.Revive();
    this.UI.Announce("BACK IN THE FIGHT!", Pal.Good, 1.4);
    Sfx.play(Snd.PowerUp);
  }
}
