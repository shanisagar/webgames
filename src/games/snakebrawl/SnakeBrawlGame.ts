import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject, howTo,
  Image, Mathf, Pal, Phase, Quaternion, Random, Result, Sfx, Snd, SpriteRenderer, SysRandom, Text, TextAnchor, Time,
  TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import { SnakeBrawlArt } from "./SnakeBrawlArt";

/**
 * SNAKE BRAWL: an arena snake battle against eleven AI snakes. Steer with the floating joystick (or the mouse /
 * WASD), eat candy to grow, hold BOOST to speed up (it costs length). A snake whose head touches another snake's body
 * is out and turns into a pile of candy. Grow to the top of the leaderboard. A rewarded ad lets you respawn once with
 * half your length. (Port of SnakeBrawlGame.cs.)
 */

// ------------------------------------------------------------------ tuning

const ArenaR = 42, Cell = 2;
const Bots = 11, FoodCount = 520, FoodPool = 1100;
const BaseSpeed = 5.4, BoostSpeed = 9.6, StartMass = 12;
const GridN = 48; // cells across (covers ±48 units)

const BotNames = [
  "Noodle", "Slinky", "Ziggy", "Pretzel", "Mango", "Sir Hiss", "Wiggles", "Bubbles", "Coco", "Rocket",
  "Spaghetti", "Lucky", "Tango", "Pickle", "Biscuit", "Zoom", "Doodle", "Pebble", "Captain", "Squiggle",
];

const Ink = Pal.hex(0x1f3a1a), Gold = Pal.hex(0xffc93c);

/** System.Random(seed).NextDouble(): a fresh seeded generator per sample (white noise). */
const noiseAt = (seed: number) => new SysRandom(seed).nextDouble();

class Snake {
  Name = "";
  Color = Color.white; Stripe = Color.white;
  Player = false; Alive = false; Aggressive = false;
  readonly Seg: V2[] = [];
  readonly Srs: SpriteRenderer[] = [];
  Root!: GameObject;
  HeadSr!: SpriteRenderer; EyeL!: SpriteRenderer; EyeR!: SpriteRenderer; PupL!: SpriteRenderer; PupR!: SpriteRenderer;
  Angle = 0; TargetAngle = 0; Mass = 0; Think = 0; Radius = 0; Respawn = 0; DropTimer = 0; Fade = 0;
  Boost = false;
  Kills = 0; Index = 0;
}

class Food {
  Sr!: SpriteRenderer;
  Pos = V2.zero;
  Value = 0; Phase = 0; Life = 0;
  Active = false; Dropped = false;
}

export class SnakeBrawlGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject;
  private outside!: SpriteRenderer;
  private grass: SpriteRenderer[] = [];
  private snakes: Snake[] = [];
  private food: Food[] = new Array(FoodPool);
  private player: Snake | null = null;
  private fx!: CasualFx;
  private rng = new SysRandom();

  // segment grid (rebuilt every frame, no allocations)
  private cellHead = new Int32Array(GridN * GridN);
  private segNext = new Int32Array(4096);
  private segOwner = new Int32Array(4096);
  private segPos: V2[] = new Array(4096);
  private segR = new Float32Array(4096);
  private segCount = 0;

  private zoom = 16; private deathTimer = 0; private aliveTime = 0;
  private dying = false; private revived = false;
  private bestRank = 0;
  private cam = V2.zero;

  // HUD
  private lengthText!: Text; private rankText!: Text; private killsText!: Text;
  private board: Text[] = new Array(5);
  private miniMap!: UINode;
  private miniDots: Image[] = [];
  private boostButton: ArcadeButton | null = null;
  private skinPreview: Image | null = null;
  private skinSegs: Image[] = [];
  private skinLabel!: Text;

  private eatClip!: AudioClip; private dieClip!: AudioClip;
  /** Made but never played (same in the C#). */
  boostClip!: AudioClip;
  private eatCooldown = 0;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      HomeBesidePause: true,
      Id: "snakebrawl",
      Title: "SNAKE BRAWL",
      Tagline: "EAT. GROW. OUTSMART EVERY SNAKE.",
      Accent: Pal.hex(0x4cc85c),
      Accent2: Gold,
      BgTop: Pal.hex(0x9bd86a),
      BgBottom: Pal.hex(0x4e8a3a),
      ShortSide: 16,
      Touch: TouchScheme.Stick,
      Music: { bpm: 118, rootHz: 98, degrees: [0, 5, 3, 4], seed: 64, energy: 0.6, major: true },
      Reminders: [
        "The arena is hungry|Eleven snakes are waiting for a challenge.",
        "Can you reach #1?|Grow the longest snake in the arena.",
        "Fresh candy in the garden|Slither back in for a snack.",
      ],
      HowTo: [
        howTo(SnakeBrawlArt.Head, SnakeBrawlArt.Skins[0], "DRAG anywhere to steer (or move the mouse / WASD)."),
        howTo(SnakeBrawlArt.Food, Gold, "Eat CANDY to grow longer."),
        howTo(Art.Chevron, Pal.hex(0xff8a30), "Hold BOOST (or Shift / mouse button) to speed up. Boosting costs length."),
        howTo(Art.Diamond, Pal.Danger, "If your HEAD touches another snake, you're out. Make others crash into YOU!"),
        howTo(SnakeBrawlArt.Segment, SnakeBrawlArt.Skins[1], "Beaten snakes turn into a trail of candy. Stay away from the fence."),
      ],
      Tips: [
        "Boost in front of a snake's head to make it crash into you.",
        "Big snakes turn slowly: circle them to trap them.",
        "Follow a boosting snake: it leaves candy behind.",
        "Keep away from the fence when you're big.",
        "Coil around a pile of candy to keep it for yourself.",
      ],
    });
  }

  protected get ShortSide() { return this.zoom; }
  protected get AimOrigin() { return this.player && this.player.Alive && this.player.Seg.length > 0 ? this.player.Seg[0] : this.cam; }

  private get SkinIndex() { return Mathf.clamp(this.Data.get("skin"), 0, SnakeBrawlArt.SkinNames.length - 1); }
  private set SkinIndex(v: number) { this.Data.set("skin", v); }

  protected BestLine() {
    const best = this.Data.get("best");
    return best > 0 ? `BEST LENGTH ${Fmt.n(best)}   ·   BEST RANK #${Math.max(1, this.Data.get("bestRank", 12))}` : "GROW THE LONGEST SNAKE!";
  }

  protected StatsLine() { return `${Fmt.n(this.Data.get("kills"))} SNAKES BEATEN   ·   ${this.Data.get("wins")} TIMES #1`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("SnakeWorld", this.gameObject);
    CasualLook.calm(this, 1.25, 0.24);
    this.outside = Art.spr(this.world, "Outside", SnakeBrawlArt.Outside, Color.white, 1, -950, Art.Flat);
    const tile = 8;
    const n = Math.ceil((ArenaR * 2) / tile) + 1;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const g = Art.spr(this.world, "Grass", SnakeBrawlArt.Grass, Color.white, tile + 0.02, -900, Art.Flat);
        g.transform.localPosition = new V3((x - (n - 1) * 0.5) * tile, (y - (n - 1) * 0.5) * tile, 0);
        this.grass.push(g);
      }
    // fence: rope + posts on the arena circle
    const rope = Art.line(this.world, "Rope", Pal.hex(0x8a5a34), 0.28, 3, true, true, Art.Flat);
    const posts = Mathf.roundToInt((2 * Math.PI * ArenaR) / 1.6);
    rope.positionCount = posts;
    for (let i = 0; i < posts; i++) {
      const a = (i * Math.PI * 2) / posts;
      const p = new V2(Math.cos(a), Math.sin(a)).mul(ArenaR);
      rope.setPosition(i, new V3(p.x, p.y, 0));
      const post = Art.spr(this.world, "Post", SnakeBrawlArt.Post, Color.white, 0.7, 4, Art.Flat);
      post.transform.localPosition = new V3(p.x, p.y, 0);
    }
    // outside the fence: darken with a big soft ring (the outside cover follows the camera)
    for (let i = 0; i < FoodPool; i++) {
      const sr = Art.spr(this.world, "Candy", SnakeBrawlArt.Food, Color.white, 0.3, 2, Art.Flat);
      sr.gameObject.setActive(false);
      const f = new Food();
      f.Sr = sr;
      this.food[i] = f;
    }
    this.fx = CasualFx.create(this.world, 600, 200);

    this.eatClip = Sfx.make("sb-eat", 0.07, (t) => Sfx.sinP(Sfx.glide(t, 700, 1100, 0.05)) * Sfx.env(t, 0.002, 0.05) * 0.16);
    this.boostClip = Sfx.make("sb-boost", 0.25, (t) => (noiseAt(Math.trunc(t * 44100)) * 2 - 1) * Sfx.env(t, 0.02, 0.2) * 0.12);
    this.dieClip = Sfx.make("sb-die", 0.6, (t) => (Sfx.sawP(Sfx.glide(t, 420, 90, 0.5)) * 0.3 + Sfx.sinP(Sfx.glide(t, 220, 60, 0.5)) * 0.4) * Sfx.env(t, 0.005, 0.5) * 0.35);

    this.BuildHud();
    for (let i = 0; i < FoodCount; i++) this.SpawnFood(this.RandomPoint(ArenaR - 1.5), 1, false);
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.lengthText = UIKit.at(UIKit.label(hud, "0", 64, Color.white), new V2(0.5, 1), new V2(0, -70), new V2(400, 80));
    UIKit.glow(this.lengthText, Ink, 4);
    this.rankText = UIKit.at(UIKit.label(hud, "", 30, Gold), new V2(0.5, 1), new V2(0, -126), new V2(400, 40));
    UIKit.glow(this.rankText, Ink, 3);
    this.killsText = UIKit.at(UIKit.label(hud, "", 26, Color.white), new V2(0.5, 1), new V2(0, -166), new V2(400, 36));
    UIKit.glow(this.killsText, Ink, 2);

    const bg = UIKit.img(hud, "Leaderboard", Art.UiRound, new Color(0, 0.12, 0, 0.35));
    bg.rectTransform.place(new V2(1, 1), new V2(-170, -280), new V2(300, 220));
    for (let i = 0; i < this.board.length; i++) {
      this.board[i] = UIKit.at(UIKit.label(bg.rectTransform, "", 24, Color.white, TextAnchor.MiddleLeft), new V2(0.5, 1), new V2(0, -28 - i * 40), new V2(270, 36));
      UIKit.glow(this.board[i], Ink.withAlpha(0.6), 2);
    }

    this.miniMap = UIKit.img(hud, "MiniMap", Art.UiCircle, new Color(0.1, 0.25, 0.08, 0.55)).rectTransform;
    this.miniMap.place(new V2(0, 1), new V2(110, -110), new V2(170, 170));
    UIKit.img(this.miniMap, "MiniRing", Art.UiRing, new Color(1, 1, 1, 0.4)).rectTransform.stretch();
    for (let i = 0; i < Bots + 1; i++) {
      const d = UIKit.img(this.miniMap, "Dot", Art.UiCircle, Color.white);
      d.rectTransform.place(UIKit.Center, V2.zero, new V2(10, 10));
      this.miniDots.push(d);
    }

    this.boostButton = UIKit.buttonAt(hud, "BOOST", new V2(1, 0), new V2(-150, 150), new V2(210, 210), true, () => {}, 34, Art.Chevron);
    this.boostButton.setAccent(Pal.hex(0xff8a30));

    if (this.UI.TitleExtra) {
      CasualLook.titleCard(this.UI, new Color(0.12, 0.28, 0.1, 0.85));
      for (let i = 3; i >= 0; i--) {
        const seg = UIKit.img(this.UI.TitleExtra, "Seg", SnakeBrawlArt.Segment, Color.white);
        seg.rectTransform.place(UIKit.Center, new V2(-180 - i * 48, Math.sin(i * 1.3) * 14), new V2(70, 70));
        this.skinSegs.unshift(seg);
      }
      this.skinPreview = UIKit.img(this.UI.TitleExtra, "SkinHead", SnakeBrawlArt.Head, SnakeBrawlArt.Skins[0]);
      this.skinPreview.rectTransform.place(UIKit.Center, new V2(-120, 0), new V2(86, 86));
      this.skinLabel = UIKit.at(UIKit.label(this.UI.TitleExtra, "", 30, Color.white), UIKit.Center, new V2(130, 0), new V2(240, 50));
      const prev = UIKit.buttonAt(this.UI.TitleExtra, "<", UIKit.Center, new V2(-420, 0), new V2(110, 96), false, () => this.ChangeSkin(-1), 46);
      const next = UIKit.buttonAt(this.UI.TitleExtra, ">", UIKit.Center, new V2(420, 0), new V2(110, 96), false, () => this.ChangeSkin(1), 46);
      prev.setAccent(Pal.hex(0x4cc85c));
      next.setAccent(Pal.hex(0x4cc85c));
      this.RefreshSkin();
    }
  }

  private ChangeSkin(d: number) {
    const n = SnakeBrawlArt.SkinNames.length;
    this.SkinIndex = (this.SkinIndex + d + n) % n;
    this.Data.flush();
    Sfx.play(Snd.Click, 0.6);
    this.RefreshSkin();
  }

  private RefreshSkin() {
    if (!this.skinPreview) return;
    const c = SnakeBrawlArt.Skins[this.SkinIndex];
    this.skinPreview.color = c;
    for (let k = 0; k < this.skinSegs.length; k++) this.skinSegs[k].color = k % 2 === 0 ? SnakeBrawlGame.StripeOf(c) : c;
    this.skinLabel.text = SnakeBrawlArt.SkinNames[this.SkinIndex] + " SNAKE";
  }

  private static StripeOf(c: Color) { return Color.lerp(c, Color.white, 0.35); }

  // ------------------------------------------------------------------ snakes

  private NewSnake(isPlayer: boolean, index: number) {
    const s = new Snake();
    s.Player = isPlayer;
    s.Index = index;
    s.Root = new GameObject(isPlayer ? "Player" : "Bot", this.world);
    const order = 100 + index * 4;
    s.HeadSr = Art.spr(s.Root, "Head", SnakeBrawlArt.Head, Color.white, 1, order + 1, Art.Flat);
    s.EyeL = Art.spr(s.HeadSr.transform, "EyeL", SnakeBrawlArt.Eye, Color.white, 0.36, order + 2, Art.Flat);
    s.EyeR = Art.spr(s.HeadSr.transform, "EyeR", SnakeBrawlArt.Eye, Color.white, 0.36, order + 2, Art.Flat);
    s.PupL = Art.spr(s.HeadSr.transform, "PupL", SnakeBrawlArt.Pupil, Color.white, 0.18, order + 3, Art.Flat);
    s.PupR = Art.spr(s.HeadSr.transform, "PupR", SnakeBrawlArt.Pupil, Color.white, 0.18, order + 3, Art.Flat);
    this.snakes.push(s);
    return s;
  }

  private SpawnSnake(s: Snake, mass: number) {
    const at = this.SafePoint();
    s.Alive = true;
    s.Fade = 1;
    s.Mass = mass;
    s.Kills = 0;
    s.Angle = s.TargetAngle = Math.atan2(-at.y, -at.x) * Mathf.Rad2Deg + (this.rng.nextDouble() * 60 - 30);
    s.Radius = SnakeBrawlGame.RadiusFor(mass);
    s.Seg.length = 0;
    const n = SnakeBrawlGame.SegmentsFor(mass, s.Player);
    const back = SnakeBrawlGame.Dir(s.Angle).neg().mul(SnakeBrawlGame.Spacing(s));
    for (let i = 0; i < n; i++) s.Seg.push(at.add(back.mul(i)));
    s.Root.gameObject.setActive(true);
    if (!s.Player) {
      s.Name = BotNames[this.rng.next(BotNames.length)];
      const skin = this.rng.next(SnakeBrawlArt.Skins.length);
      s.Color = SnakeBrawlArt.Skins[skin];
      s.Stripe = this.rng.next(3) === 0 ? CasualArt.darken(s.Color, 0.25) : SnakeBrawlGame.StripeOf(s.Color);
      s.Aggressive = this.rng.nextDouble() < 0.4;
    }
    s.HeadSr.color = s.Color;
    this.SyncRenderers(s);
  }

  private static RadiusFor(mass: number) { return Math.min(1.05, 0.3 + Math.sqrt(mass) * 0.036); }
  private static SegmentsFor(mass: number, isPlayer: boolean) { return Mathf.clamp(Mathf.roundToInt(6 + mass * 0.55), 6, isPlayer ? 260 : 150); }
  private static Spacing(s: Snake) { return s.Radius * 0.62; }
  private static Dir(deg: number) { return new V2(Math.cos(deg * Mathf.Deg2Rad), Math.sin(deg * Mathf.Deg2Rad)); }

  private RandomPoint(radius: number) {
    const a = this.rng.nextDouble() * Math.PI * 2;
    const r = Math.sqrt(this.rng.nextDouble()) * radius;
    return new V2(Math.cos(a), Math.sin(a)).mul(r);
  }

  private SafePoint() {
    let best = this.RandomPoint(ArenaR - 8);
    let bestD = -1;
    for (let t = 0; t < 14; t++) {
      const p = this.RandomPoint(ArenaR - 8);
      let d = Number.MAX_VALUE;
      for (const s of this.snakes) {
        if (!s.Alive) continue;
        for (let i = 0; i < s.Seg.length; i += 4) d = Math.min(d, s.Seg[i].sub(p).sqrMagnitude);
      }
      if (d > bestD) { bestD = d; best = p; }
      if (d > 100) break;
    }
    return best;
  }

  private SyncRenderers(s: Snake) {
    const order = 100 + s.Index * 4;
    while (s.Srs.length < s.Seg.length)
      s.Srs.push(Art.spr(s.Root, "Seg", SnakeBrawlArt.Segment, Color.white, 1, order, Art.Flat));
    for (let i = 0; i < s.Srs.length; i++) {
      const on = i < s.Seg.length && i > 0;
      if (s.Srs[i].gameObject.activeSelf !== on) s.Srs[i].gameObject.setActive(on);
    }
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.EnsureBots();
    if (this.player) { this.player.Alive = false; this.player.Root.gameObject.setActive(false); }
    this.dying = false;
  }

  private EnsureBots() {
    while (this.snakes.length < Bots + 1) {
      const s = this.NewSnake(this.snakes.length === 0, this.snakes.length);
      if (s.Player) { this.player = s; s.Root.gameObject.setActive(false); continue; }
      this.SpawnSnake(s, StartMass + this.rng.nextDouble() * 60);
    }
  }

  protected BeginRun() {
    this.EnsureBots();
    const player = this.player!;
    // fresh arena
    for (const f of this.food) { f.Active = false; f.Sr.gameObject.setActive(false); }
    for (let i = 0; i < FoodCount; i++) this.SpawnFood(this.RandomPoint(ArenaR - 1.5), 1, false);
    for (const s of this.snakes) if (!s.Player) this.SpawnSnake(s, StartMass + this.rng.nextDouble() * 50);
    player.Name = "YOU";
    player.Color = SnakeBrawlArt.Skins[this.SkinIndex];
    player.Stripe = SnakeBrawlGame.StripeOf(player.Color);
    this.SpawnSnake(player, StartMass);
    player.Root.gameObject.setActive(true);
    this.dying = this.revived = false;
    this.aliveTime = 0;
    this.bestRank = Bots + 1;
    this.fx.clear();
    this.cam = player.Seg[0];
    this.zoom = 15;
    if (this.Data.get("runs") === 0) this.UI.Hint("Drag to steer. Eat candy to grow. Don't bump your head!");
    this.Data.add("runs", 1);
    Sfx.setIntensity(0.4);
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Simulate(dt, false);
    // the camera follows the biggest snake
    let lead: Snake | null = null;
    for (const s of this.snakes) if (s.Alive && !s.Player && (!lead || s.Mass > lead.Mass)) lead = s;
    if (lead) this.cam = V2.lerp(this.cam, lead.Seg[0], 1 - Math.exp(-dt * 2));
    this.zoom = Mathf.lerp(this.zoom, 18, dt);
    this.ApplyCamera();
  }

  protected TickRun(dt: number) {
    const player = this.player!;
    if (this.dying) {
      this.deathTimer -= dt;
      this.Simulate(dt, true);
      this.ApplyCamera();
      if (this.deathTimer <= 0 && this.State === Phase.Playing) this.Lose();
      return;
    }
    this.aliveTime += dt;
    this.SteerPlayer(dt);
    this.Simulate(dt, true);
    if (player.Alive) {
      this.cam = V2.lerp(this.cam, player.Seg[0], 1 - Math.exp(-dt * 7));
      this.zoom = Mathf.lerp(this.zoom, 13 + player.Radius * 12, dt * 1.5);
    }
    this.ApplyCamera();
    this.UpdateHud();
  }

  private ApplyCamera() {
    this.Fx.CameraTarget = this.cam;
    this.outside.transform.localPosition = new V3(this.cam.x, this.cam.y, 0);
    this.outside.transform.localScale = new V3(this.ViewSize.x + 4, this.ViewSize.y + 4, 1);
  }

  private SteerPlayer(_dt: number) {
    const player = this.player!;
    if (!player.Alive) return;
    const m = this.Controls.move;
    if (m.sqrMagnitude > 0.04) player.TargetAngle = Math.atan2(m.y, m.x) * Mathf.Rad2Deg;
    else if (this.Controls.aimActive && !this.Controls.usingTouch) player.TargetAngle = Math.atan2(this.Controls.aim.y, this.Controls.aim.x) * Mathf.Rad2Deg;
    const boost = (this.boostButton !== null && this.boostButton.held) || this.Controls.fire || (this.Controls.sprint && !this.Controls.usingTouch);
    player.Boost = boost && player.Mass > StartMass;
  }

  private Simulate(dt: number, real: boolean) {
    this.BuildGrid();
    this.eatCooldown -= dt;
    for (let si = 0; si < this.snakes.length; si++) {
      const s = this.snakes[si];
      if (!s.Alive) {
        if (!s.Player) {
          s.Respawn -= dt;
          if (s.Respawn <= 0) this.SpawnSnake(s, StartMass + this.rng.nextDouble() * (real ? 40 : 60));
        }
        if (s.Fade > 0) {
          s.Fade = Math.max(0, s.Fade - dt * 2);
          this.Present(s);
          if (s.Fade <= 0) s.Root.gameObject.setActive(false);
        }
        continue;
      }
      if (!s.Player) this.Think(s, dt);
      this.Move(s, dt);
    }
    this.Collisions(real);
    this.Eat(dt);
    for (const s of this.snakes) if (s.Alive) this.Present(s);
    this.AnimateFood(dt);
  }

  private Move(s: Snake, dt: number) {
    const turn = 300 / (1 + s.Radius * 1.6);
    s.Angle = Mathf.moveTowardsAngle(s.Angle, s.TargetAngle, turn * dt);
    const speed = s.Boost ? BoostSpeed : BaseSpeed;
    if (s.Boost) {
      s.Mass = Math.max(StartMass, s.Mass - 2.4 * dt);
      s.DropTimer -= dt;
      if (s.DropTimer <= 0) {
        s.DropTimer = 0.22;
        this.SpawnFood(s.Seg[s.Seg.length - 1].add(Random.insideUnitCircle.mul(0.3)), 0.6, true, s.Color);
      }
      if (s.Mass <= StartMass) s.Boost = false;
    }
    s.Radius = Mathf.moveTowards(s.Radius, SnakeBrawlGame.RadiusFor(s.Mass), dt * 0.2);
    const head = s.Seg[0].add(SnakeBrawlGame.Dir(s.Angle).mul(speed * dt));
    s.Seg[0] = head;
    const spacing = SnakeBrawlGame.Spacing(s);
    for (let i = 1; i < s.Seg.length; i++) {
      const d = s.Seg[i].sub(s.Seg[i - 1]);
      const m = d.magnitude;
      if (m > spacing) s.Seg[i] = s.Seg[i - 1].add(d.mul(spacing / m));
    }
    // grow / shrink the tail to match the mass
    const target = SnakeBrawlGame.SegmentsFor(s.Mass, s.Player);
    while (s.Seg.length < target) s.Seg.push(s.Seg[s.Seg.length - 1]);
    while (s.Seg.length > target && s.Seg.length > 6) s.Seg.pop();
    this.SyncRenderers(s);
  }

  private Think(s: Snake, dt: number) {
    const rng = this.rng, player = this.player;
    s.Think -= dt;
    if (s.Think > 0) return;
    s.Think = 0.1 + rng.nextDouble() * 0.06;
    const h = s.Seg[0];
    // stay inside the fence
    if (h.magnitude > ArenaR - 5 - s.Radius * 3) {
      s.TargetAngle = Math.atan2(-h.y, -h.x) * Mathf.Rad2Deg + (rng.nextDouble() * 40 - 20);
      s.Boost = false;
      return;
    }
    // danger ahead?
    const dAhead = this.Danger(s, s.Angle), dL = this.Danger(s, s.Angle + 40), dR = this.Danger(s, s.Angle - 40);
    if (dAhead > 0) {
      const side = dL < dR ? 1 : dL > dR ? -1 : rng.next(2) === 0 ? 1 : -1;
      s.TargetAngle = s.Angle + side * (dAhead > 1 ? 100 : 60);
      s.Boost = s.Mass > 40 && dAhead > 1.5 && rng.nextDouble() < 0.3;
      return;
    }
    // hunt the player: try to cut in front of their head
    if (s.Aggressive && player && player.Alive && s.Mass > player.Mass * 0.8) {
      const ph = player.Seg[0];
      if (ph.sub(h).sqrMagnitude < 100) {
        const aim = ph.add(SnakeBrawlGame.Dir(player.Angle).mul(3.5));
        s.TargetAngle = Math.atan2(aim.y - h.y, aim.x - h.x) * Mathf.Rad2Deg;
        s.Boost = s.Mass > 25 && rng.nextDouble() < 0.5;
        return;
      }
    }
    // eat: best nearby candy (value over distance)
    let best: Food | null = null;
    let bestScore = 0;
    const fwd = SnakeBrawlGame.Dir(s.Angle);
    for (const f of this.food) {
      if (!f.Active) continue;
      const d2 = f.Pos.sub(h).sqrMagnitude;
      if (d2 > 110) continue;
      const to = f.Pos.sub(h);
      const facing = V2.dot(to.normalized, fwd);
      const sc = (f.Value * (1.4 + facing)) / (1 + d2);
      if (sc > bestScore) { bestScore = sc; best = f; }
    }
    s.Boost = false;
    if (best) {
      s.TargetAngle = Math.atan2(best.Pos.y - h.y, best.Pos.x - h.x) * Mathf.Rad2Deg;
      if (best.Value > 1.5 && s.Mass > 30 && rng.nextDouble() < 0.15) s.Boost = true;
    } else s.TargetAngle += rng.nextDouble() * 60 - 30;
  }

  private Danger(s: Snake, angle: number) {
    let danger = 0;
    const d = SnakeBrawlGame.Dir(angle);
    for (let k = 1; k <= 3; k++) {
      const p = s.Seg[0].add(d.mul(k * (1.3 + s.Radius)));
      if (p.magnitude > ArenaR - 1) { danger += 1.5; continue; }
      if (this.Occupied(p, s.Radius + 0.4, s.Index)) danger += k === 1 ? 2 : 1;
    }
    return danger;
  }

  // ------------------------------------------------------------------ grid & collisions

  private BuildGrid() {
    this.cellHead.fill(-1);
    this.segCount = 0;
    for (let si = 0; si < this.snakes.length; si++) {
      const s = this.snakes[si];
      if (!s.Alive) continue;
      for (let i = 0; i < s.Seg.length; i++) {
        if (this.segCount >= this.segPos.length) this.Grow();
        const cell = SnakeBrawlGame.CellOf(s.Seg[i]);
        const k = this.segCount;
        this.segPos[k] = s.Seg[i];
        this.segOwner[k] = si;
        this.segR[k] = s.Radius;
        this.segNext[k] = this.cellHead[cell];
        this.cellHead[cell] = k;
        this.segCount++;
      }
    }
  }

  private Grow() {
    const n = this.segPos.length * 2;
    const resize = <T extends Int32Array | Float32Array>(a: T, make: (n: number) => T) => { const b = make(n); b.set(a); return b; };
    this.segPos.length = n;
    this.segOwner = resize(this.segOwner, (k) => new Int32Array(k));
    this.segR = resize(this.segR, (k) => new Float32Array(k));
    this.segNext = resize(this.segNext, (k) => new Int32Array(k));
  }

  private static CellOf(p: V2) {
    const x = Mathf.clamp(Math.floor((p.x + GridN) / Cell), 0, GridN - 1);
    const y = Mathf.clamp(Math.floor((p.y + GridN) / Cell), 0, GridN - 1);
    return y * GridN + x;
  }

  private Occupied(p: V2, r: number, self: number) {
    const cx = Mathf.clamp(Math.floor((p.x + GridN) / Cell), 0, GridN - 1);
    const cy = Mathf.clamp(Math.floor((p.y + GridN) / Cell), 0, GridN - 1);
    for (let y = Math.max(0, cy - 1); y <= Math.min(GridN - 1, cy + 1); y++)
      for (let x = Math.max(0, cx - 1); x <= Math.min(GridN - 1, cx + 1); x++) {
        for (let i = this.cellHead[y * GridN + x]; i >= 0; i = this.segNext[i]) {
          if (this.segOwner[i] === self) continue;
          const rr = r + this.segR[i];
          const q = this.segPos[i], dx = q.x - p.x, dy = q.y - p.y;
          if (dx * dx + dy * dy < rr * rr) return true;
        }
      }
    return false;
  }

  private HitBy(head: V2, r: number, self: number) {
    const cx = Mathf.clamp(Math.floor((head.x + GridN) / Cell), 0, GridN - 1);
    const cy = Mathf.clamp(Math.floor((head.y + GridN) / Cell), 0, GridN - 1);
    for (let y = Math.max(0, cy - 1); y <= Math.min(GridN - 1, cy + 1); y++)
      for (let x = Math.max(0, cx - 1); x <= Math.min(GridN - 1, cx + 1); x++) {
        for (let i = this.cellHead[y * GridN + x]; i >= 0; i = this.segNext[i]) {
          if (this.segOwner[i] === self) continue;
          const rr = (r + this.segR[i]) * 0.82;
          const q = this.segPos[i], dx = q.x - head.x, dy = q.y - head.y;
          if (dx * dx + dy * dy < rr * rr) return this.segOwner[i];
        }
      }
    return -1;
  }

  private Collisions(real: boolean) {
    for (let si = 0; si < this.snakes.length; si++) {
      const s = this.snakes[si];
      if (!s.Alive) continue;
      const h = s.Seg[0];
      if (h.magnitude > ArenaR - s.Radius * 0.6) { this.Kill(s, null, real); continue; }
      const other = this.HitBy(h, s.Radius, si);
      if (other >= 0) this.Kill(s, this.snakes[other], real);
    }
  }

  private Kill(s: Snake, killer: Snake | null, real: boolean) {
    s.Alive = false;
    s.Respawn = 2 + this.rng.nextDouble() * 3;
    s.Boost = false;
    for (let i = 0; i < s.Seg.length; i += 2)
      this.SpawnFood(s.Seg[i].add(Random.insideUnitCircle.mul(s.Radius)), 1.2 + (s.Mass / Math.max(1, s.Seg.length)) * 0.8, true, s.Color);
    this.fx.pop(s.Seg[0], s.Color, 16, 5, 0.35, 0.6);
    if (killer) {
      killer.Kills++;
      if (real && killer.Player) {
        this.UI.Float(s.Seg[0], "BEAT " + s.Name.toUpperCase() + "!", Gold, 1.1);
        Sfx.play(Snd.Coin, 0.7);
        Fx.haptic();
        this.Data.add("kills", 1);
      }
    }
    if (s.Player && real) {
      this.dying = true;
      this.deathTimer = 1.4;
      Sfx.playClip(this.dieClip, 0.9);
      this.Fx.shake(0.35);
      Fx.haptic(true);
      this.UI.Announce(killer ? "CRASHED INTO " + killer.Name.toUpperCase() : "HIT THE FENCE!", Pal.Danger, 1.3);
    }
  }

  // ------------------------------------------------------------------ food

  private SpawnFood(p: V2, value: number, dropped: boolean, color: Color = Color.clear) {
    if (p.magnitude > ArenaR - 0.8) p = p.normalized.mul(ArenaR - 0.8);
    let f: Food | null = null;
    for (let i = 0; i < this.food.length; i++) {
      if (!this.food[i].Active) { f = this.food[i]; break; }
    }
    if (!f) {
      // recycle the oldest dropped candy
      f = this.food[this.rng.next(this.food.length)];
    }
    f.Active = true;
    f.Pos = p;
    f.Value = value;
    f.Dropped = dropped;
    f.Life = dropped ? 30 + this.rng.nextDouble() * 20 : 0;
    f.Phase = this.rng.nextDouble() * 6;
    const c = color.a > 0 ? Color.lerp(color, Color.white, 0.25) : SnakeBrawlArt.Skins[this.rng.next(SnakeBrawlArt.Skins.length)];
    f.Sr.color = c;
    const size = 0.24 + Math.min(0.35, value * 0.12);
    f.Sr.transform.localScale = new V3(size, size, 1);
    f.Sr.transform.localPosition = new V3(p.x, p.y, 0);
    f.Sr.gameObject.setActive(true);
  }

  private Eat(dt: number) {
    let active = 0;
    for (const f of this.food) {
      if (!f.Active) continue;
      active++;
      if (f.Dropped) {
        f.Life -= dt;
        if (f.Life <= 0) { f.Active = false; f.Sr.gameObject.setActive(false); continue; }
      }
      for (const s of this.snakes) {
        if (!s.Alive) continue;
        const d = s.Seg[0].sub(f.Pos);
        const pull = s.Radius * 3.2;
        const d2 = d.sqrMagnitude;
        if (d2 > pull * pull) continue;
        if (d2 < s.Radius * 1.1 * (s.Radius * 1.1)) {
          s.Mass += f.Value;
          f.Active = false;
          f.Sr.gameObject.setActive(false);
          if (s.Player && this.eatCooldown <= 0) {
            Sfx.playClip(this.eatClip, 0.5, 0.9 + Math.min(0.5, f.Value * 0.15));
            this.eatCooldown = 0.04;
          }
          break;
        }
        // candy is sucked towards a nearby head
        f.Pos = f.Pos.add(d.normalized.mul(Math.min(Math.sqrt(d2), 7 * dt)));
        f.Sr.transform.localPosition = new V3(f.Pos.x, f.Pos.y, 0);
        break;
      }
    }
    // keep the arena stocked
    for (let i = active; i < FoodCount; i += 1) {
      this.SpawnFood(this.RandomPoint(ArenaR - 1.5), this.rng.nextDouble() < 0.08 ? 2.5 : 1, false);
      if (i - active > 4) break;
    }
  }

  private AnimateFood(dt: number) {
    // a gentle twinkle on candy close to the camera
    const vx = this.ViewSize.x * 0.6, vy = this.ViewSize.y * 0.6;
    for (const f of this.food) {
      if (!f.Active) continue;
      if (Math.abs(f.Pos.x - this.cam.x) > vx || Math.abs(f.Pos.y - this.cam.y) > vy) continue;
      f.Phase += dt * 3;
      const size = (0.24 + Math.min(0.35, f.Value * 0.12)) * (1 + Math.sin(f.Phase) * 0.1);
      f.Sr.transform.localScale = new V3(size, size, 1);
    }
  }

  // ------------------------------------------------------------------ presentation

  private Present(s: Snake) {
    if (s.Seg.length === 0) return; // never spawned yet (the player snake on the title screen)
    const r = s.Radius * 2;
    const alpha = s.Alive ? 1 : s.Fade;
    for (let i = 1; i < s.Seg.length && i < s.Srs.length; i++) {
      const sr = s.Srs[i];
      const p = s.Seg[i];
      sr.transform.localPosition = new V3(p.x, p.y, 0);
      const taper = i > s.Seg.length - 6 ? Mathf.lerp(0.6, 1, (s.Seg.length - i) / 6) : 1;
      const sc = r * taper;
      sr.transform.localScale = new V3(sc, sc, 1);
      let c = Math.trunc(i / 3) % 2 === 0 ? s.Color : s.Stripe;
      if (s.Boost) c = Color.lerp(c, Color.white, 0.25 * (0.5 + 0.5 * Math.sin(Time.time * 18 - i * 0.6)));
      sr.color = c.withAlpha(alpha);
    }
    const h = s.Seg[0];
    s.HeadSr.transform.localPosition = new V3(h.x, h.y, 0);
    s.HeadSr.transform.localRotation = Quaternion.euler(0, 0, s.Angle);
    const hs = r * 1.12;
    s.HeadSr.transform.localScale = new V3(hs, hs, 1);
    s.HeadSr.color = s.Color.withAlpha(alpha);
    // eyes look where the snake wants to go
    const look = Mathf.clamp(Mathf.deltaAngle(s.Angle, s.TargetAngle) / 90, -1, 1);
    s.EyeL.transform.localPosition = new V3(0.18, 0.24, 0);
    s.EyeR.transform.localPosition = new V3(0.18, -0.24, 0);
    s.PupL.transform.localPosition = new V3(0.25, 0.24 + look * 0.05, 0);
    s.PupR.transform.localPosition = new V3(0.25, -0.24 + look * 0.05, 0);
    const w = new Color(1, 1, 1, alpha);
    s.EyeL.color = s.EyeR.color = s.PupL.color = s.PupR.color = w;
  }

  private UpdateHud() {
    const player = this.player!;
    const len = Mathf.roundToInt(player.Mass * 10);
    SnakeBrawlGame.SetText(this.lengthText, Fmt.n(len));
    // leaderboard
    const alive: Snake[] = [];
    for (const s of this.snakes) if (s.Alive || s === player) alive.push(s);
    alive.sort((a, b) => b.Mass - a.Mass);
    const rank = alive.indexOf(player) + 1;
    if (player.Alive) this.bestRank = Math.min(this.bestRank, rank);
    SnakeBrawlGame.SetText(this.rankText, `RANK #${rank} OF ${alive.length}`);
    SnakeBrawlGame.SetText(this.killsText, player.Kills > 0 ? `${player.Kills} BEATEN` : "");
    for (let i = 0; i < this.board.length; i++) {
      if (i < alive.length) {
        const s = alive[i];
        SnakeBrawlGame.SetText(this.board[i], `${i + 1}. ${s.Name}  ${Fmt.n(Mathf.roundToInt(s.Mass * 10))}`);
        this.board[i].color = s.Player ? Gold : Color.white;
      } else SnakeBrawlGame.SetText(this.board[i], "");
    }
    // minimap
    const k = 85 / ArenaR;
    for (let i = 0; i < this.miniDots.length; i++) {
      const on = i < this.snakes.length && this.snakes[i].Alive;
      this.miniDots[i].gameObject.setActive(on);
      if (!on) continue;
      const s = this.snakes[i];
      this.miniDots[i].rectTransform.anchoredPosition = s.Seg[0].mul(k);
      const size = s.Player ? 16 : 6 + Math.min(10, s.Mass * 0.05);
      this.miniDots[i].rectTransform.sizeDelta = new V2(size, size);
      this.miniDots[i].color = s.Player ? Color.white : s.Color;
      if (s.Player) this.miniDots[i].rectTransform.setAsLastSibling();
    }
  }

  private static SetText(t: Text | null, s: string) {
    if (t && t.text !== s) t.text = s;
  }

  // ------------------------------------------------------------------ results

  private Lose() {
    const player = this.player!;
    const len = Mathf.roundToInt(player.Mass * 10);
    const newBest = this.Data.max("best", len);
    const prevRank = this.Data.get("bestRank", 99);
    if (this.bestRank < prevRank) this.Data.set("bestRank", this.bestRank);
    if (this.bestRank === 1) this.Data.add("wins", 1);
    this.Finish(new Result({
      Headline: this.bestRank === 1 ? "YOU WERE #1!" : newBest ? "NEW RECORD!" : "GAME OVER",
      HeadlineColor: this.bestRank === 1 || newBest ? Gold : Pal.hex(0xffd0c0),
      Value: Fmt.n(len),
      CountTo: len,
      NewBest: newBest,
      BestLine: `BEST RANK THIS GAME: #${this.bestRank}`,
      Stats: [
        ["LENGTH", Fmt.n(len)],
        ["BEATEN", String(player.Kills)],
        ["TIME", Fmt.clock(this.aliveTime)],
        ["BEST", Fmt.n(this.Data.get("best"))],
      ],
      Primary: "PLAY AGAIN",
      Reward: this.revived ? null : () => this.Respawn(),
      RewardLabel: "RESPAWN WITH HALF LENGTH (AD)",
    }));
  }

  private Respawn() {
    const player = this.player!;
    this.revived = true;
    this.dying = false;
    const mass = Math.max(StartMass, player.Mass * 0.5);
    const kills = player.Kills;
    this.SpawnSnake(player, mass);
    player.Kills = kills;
    this.cam = player.Seg[0];
    this.Revive();
    this.UI.Announce("BACK IN THE BRAWL!", Pal.hex(0x4cc85c), 1.2);
    Sfx.play(Snd.PowerUp);
  }
}
