import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, CasualUI, Color, Fmt, Fx, GameInfo, GameObject,
  howTo, Image, Mathf, Pal, Phase, Quaternion, Result, Screen, Sfx, Snd, Sprite, SpriteRenderer, SysRandom, TapPointer, Text,
  TextAnchor, Time, TouchScheme, UIKit, V2, V3,
} from "../../kit";

/**
 * FLAP FLOCK: tap to flap and steer a little bird through the gaps between leafy tree trunks. Every gap is a
 * point; medals at 10, 25, 50 and 100. Golden seeds between the trees unlock new birds. The sky turns from
 * morning to sunset to a starry night as your score climbs. A rewarded ad gives one extra life per game.
 * (Port of FlapFlockGame.cs.)
 */

const Gravity = 30, FlapV = 9.2, TrunkW = 1.5, Spacing = 4.1, MaxFall = -14;
const Pillars = 6, Skins = 5;

const SkinNames = ["SUNNY", "BERRY", "MINTY", "SKY", "ROYAL"];
const SkinCost = [0, 20, 50, 100, 200];
const SkinBody = [Pal.hex(0xffd23f), Pal.hex(0xff5c7a), Pal.hex(0x4cd07d), Pal.hex(0x4da6ff), Pal.hex(0x9b6bff)];
const Ink = Pal.hex(0x23324a), Gold = Pal.hex(0xffc93c);

/** System.Random(seed).NextDouble(): a fresh seeded generator per sample (white noise). */
const noiseAt = (seed: number) => new SysRandom(seed).nextDouble();

/**
 * Kit gap: SpriteRenderer has no drawMode = Sliced / size. Unity slices the trunk sprite (border 0,20,0,20 at
 * 128 ppu): the top and bottom 20 px keep their size and the middle stretches. Rebuilt here from three sprites
 * (the three bands of the same recipe) under one transform.
 */
class SlicedSprite {
  readonly go: GameObject;
  private readonly top: SpriteRenderer; private readonly mid: SpriteRenderer; private readonly bot: SpriteRenderer;
  constructor(parent: GameObject, name: string, pieces: [Sprite, Sprite, Sprite], private readonly borderUnits: number, order: number) {
    this.go = new GameObject(name, parent);
    this.top = Art.spr(this.go, "Top", pieces[0], Color.white, 1, order, Art.Flat);
    this.mid = Art.spr(this.go, "Mid", pieces[1], Color.white, 1, order, Art.Flat);
    this.bot = Art.spr(this.go, "Bottom", pieces[2], Color.white, 1, order, Art.Flat);
  }
  get transform() { return this.go; }
  /** SpriteRenderer.size in sliced mode. */
  set size(s: V2) {
    // borders shrink when the sprite is shorter than both of them (like Unity)
    const b = Math.min(this.borderUnits, s.y * 0.5), m = Math.max(0, s.y - 2 * b);
    const k = this.borderUnits > 0 ? b / this.borderUnits : 0;
    // band sprites are 1 unit wide and (band px / 128) tall
    this.top.transform.localScale = new V3(s.x, k, 1);
    this.top.transform.localPosition = new V3(0, m * 0.5 + b * 0.5, 0);
    this.bot.transform.localScale = new V3(s.x, k, 1);
    this.bot.transform.localPosition = new V3(0, -m * 0.5 - b * 0.5, 0);
    this.mid.transform.localScale = new V3(s.x, m / MidUnits, 1);
    this.mid.transform.localPosition = V3.zero;
  }
}

// ------------------------------------------------------------------ art

const BirdBody = (skin: number) => CasualArt.make("ff2-bird-" + skin, 128, 128, (p) => {
  const px = 2 / 128;
  const body = SkinBody[skin];
  let c = CasualArt.ballPixel(p, body, px, 0.78);
  if (c.a <= 0) return c;
  const belly = new V2((p.x - 0.08) / 0.55, (p.y + 0.32) / 0.38).magnitude - 1;
  c = Color.lerp(c, CasualArt.lighten(body, 0.6), CasualArt.fill(belly * 0.4, px) * 0.9);
  const eyeW = CasualArt.sdCircle(p, new V2(0.3, 0.25), 0.22);
  c = Color.lerp(c, Color.white, CasualArt.fill(eyeW, px));
  const eyeK = CasualArt.sdCircle(p, new V2(0.36, 0.25), 0.1);
  c = Color.lerp(c, Pal.hex(0x1e2233), CasualArt.fill(eyeK, px));
  c = Color.lerp(c, Color.white, CasualArt.fill(CasualArt.sdCircle(p, new V2(0.39, 0.29), 0.035), px));
  const blush = new V2((p.x - 0.18) / 0.12, (p.y + 0.02) / 0.07).magnitude - 1;
  c = Color.lerp(c, Pal.hex(0xff8fa3), CasualArt.fill(blush * 0.08, px) * 0.6);
  return c;
});

const Beak = () => CasualArt.make("ff2-beak", 64, 64, (p) => {
  const d = Math.max(Math.max(-p.x - 0.6, p.x * 0.7 + Math.abs(p.y) * 1.4 - 0.55), -9);
  const c = Color.lerp(Pal.hex(0xff8a1e), Pal.hex(0xffb347), CasualArt.smooth(-0.4, 0.4, p.y));
  return c.withAlpha(CasualArt.fill(d * 0.7, 2 / 64));
});

const Wing = () => CasualArt.make("ff2-wing", 64, 64, (p) => {
  const d = new V2((p.x + 0.1) / 0.85, p.y / 0.45).magnitude - 1;
  return new Color(1, 1, 1, CasualArt.fill(d * 0.45, 2 / 64));
});

const TrunkPixel = (p: V2) => {
  const px = 2 / 128;
  const d = Math.abs(p.x) - 0.86;
  let c = Color.lerp(Pal.hex(0x9a6236), Pal.hex(0xc98e58), CasualArt.smooth(0.6, -0.6, p.x));
  const grain = Math.sin(p.x * 14 + Math.sin(p.y * 6) * 1.5);
  c = Color.lerp(c, Pal.hex(0x7a4a28), CasualArt.smooth(0.6, 1, grain) * 0.4);
  c = Color.lerp(Pal.hex(0x5e3a20), c, CasualArt.fill(d + 0.06, px));
  return c.withAlpha(CasualArt.fill(d, px));
};
// Trunk is 128x128 with a (0, 20, 0, 20) border: bands of 20 / 88 / 20 px (p.y spans [-1, 1]).
const BorderPx = 20, MidUnits = 88 / 128;
const Trunk = (): [Sprite, Sprite, Sprite] => {
  const off = 1 - BorderPx / 128; // centre of the top band in p units
  return [
    CasualArt.make("ff2-trunk-top", 128, BorderPx, (p) => TrunkPixel(p.add(new V2(0, off))), 0, 128),
    CasualArt.make("ff2-trunk-mid", 128, 128 - 2 * BorderPx, (p) => TrunkPixel(p), 0, 128),
    CasualArt.make("ff2-trunk-bot", 128, BorderPx, (p) => TrunkPixel(p.add(new V2(0, -off))), 0, 128),
  ];
};

const Canopy = () => CasualArt.make("ff2-canopy", 256, 128, (p) => {
  const px = 2 / 256;
  let d = 9;
  for (let i = 0; i < 5; i++) {
    const x = -0.62 + i * 0.31;
    d = Math.min(d, CasualArt.sdCircle(p, new V2(x, 0.02 + (i % 2) * 0.08), 0.24 + (i === 2 ? 0.06 : 0)));
  }
  d = Math.min(d, CasualArt.sdBox(p, new V2(0.8, 0.14), 0.12));
  let c = Color.lerp(Pal.hex(0x3e9e3a), Pal.hex(0x6bcb5a), CasualArt.smooth(-0.3, 0.35, p.y));
  c = Color.lerp(Pal.hex(0x2b7a2a), c, CasualArt.fill(d + 0.04, px));
  const dots = Math.sin(p.x * 50) * Math.sin(p.y * 50);
  c = Color.lerp(c, Pal.hex(0x8fe07a), CasualArt.smooth(0.85, 1, dots) * 0.5);
  return c.withAlpha(CasualArt.fill(d, px));
});

const SeedSprite = () => CasualArt.make("ff2-seed", 64, 64, (p) => {
  const d = new V2(p.x / 0.6, p.y / 0.85).magnitude - 1;
  const c = CasualArt.ballPixel(new V2(p.x / 0.7, p.y / 0.95).mul(0.94), Gold, 2 / 64, 0.94);
  return c.withAlpha(CasualArt.fill(d * 0.6, 2 / 64));
});

const Ground = () => CasualArt.make("ff2-ground", 256, 64, (p) => {
  const y = p.y / 0.25;
  let c = y > 0.55 ? Color.lerp(Pal.hex(0x6cc55a), Pal.hex(0x8fe07a), CasualArt.smooth(0.55, 1, y)) : Pal.hex(0xe3c08a);
  const stripes = Mathf.repeat(p.x * 4 - y * 0.5, 1);
  if (y <= 0.55) c = Color.lerp(c, Pal.hex(0xd4ad72), stripes < 0.5 ? 0.5 : 0);
  if (y > 0.4 && y <= 0.55) c = Pal.hex(0x4fa84a);
  return c.withAlpha(1);
});

const Hills = () => CasualArt.make("ff2-hills", 512, 128, (p) => {
  const h = -0.05 + 0.1 * Math.sin(p.x * Math.PI * 2) + 0.05 * Math.sin(p.x * Math.PI * 6 + 1);
  return new Color(1, 1, 1, CasualArt.fill(p.y - h, 2 / 512));
});

const Cloud = () => CasualArt.make("ff2-cloud", 128, 64, (p) => {
  let d = Math.min(CasualArt.sdCircle(p, new V2(-0.35, -0.05), 0.28), Math.min(CasualArt.sdCircle(p, new V2(0.05, 0.08), 0.36), CasualArt.sdCircle(p, new V2(0.42, -0.06), 0.26)));
  d = Math.min(d, CasualArt.sdBox(p.sub(new V2(0, -0.2)), new V2(0.7, 0.12), 0.12));
  return new Color(1, 1, 1, CasualArt.fill(d, 2 / 128) * 0.9);
});

const MedalName = (s: number) => (s >= 100 ? "PLATINUM" : s >= 50 ? "GOLD" : s >= 25 ? "SILVER" : s >= 10 ? "BRONZE" : "NO MEDAL YET");
const MedalColor = (s: number) => (s >= 100 ? Pal.hex(0xbfe8ff) : s >= 50 ? Gold : s >= 25 ? Pal.hex(0xd7dce5) : Pal.hex(0xd08a4a));

class Pillar {
  Top!: SlicedSprite; Bottom!: SlicedSprite;
  TopCap!: SpriteRenderer; BottomCap!: SpriteRenderer; Seed!: SpriteRenderer;
  X = 0; GapY = 0; Gap = 0;
  Scored = false; SeedTaken = false;
}

export class FlapFlockGame extends ArcadeGame {
  private world!: GameObject; private bird!: GameObject; private wing!: GameObject;
  private wingSr!: SpriteRenderer;
  private sky!: SpriteRenderer; private sun!: SpriteRenderer; private birdBody!: SpriteRenderer;
  private groundA!: SpriteRenderer; private groundB!: SpriteRenderer; private hillsA!: SpriteRenderer; private hillsB!: SpriteRenderer;
  private readonly clouds: SpriteRenderer[] = [];
  private readonly stars: SpriteRenderer[] = [];
  private readonly pillars: Pillar[] = [];
  private fx!: CasualFx;
  private readonly pointer = new TapPointer();
  private rng = new SysRandom();

  private birdY = 0; private vy = 0; private scroll = 0; private speed = 0; private groundY = 0; private topY = 0; private dead = 0;
  private hillScroll = 0; private flapAnim = 0;
  private score = 0; private seedsRun = 0;
  private started = false; private dying = false; private revived = false;
  private timeOfDay = 0;

  private scoreText!: Text; private seedText!: Text; private tapText!: Text;
  private medalIcon!: Image;
  private skinPreview: Image | null = null;
  private skinLabel!: Text; private skinInfo!: Text;
  private skinAction!: ArcadeButton;
  private browse = 0;
  private flapClip!: AudioClip; private pointClip!: AudioClip; private hitClip!: AudioClip; private seedClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "flapflock",
      Title: "FLAP FLOCK",
      Tagline: "TAP. FLAP. FLY THROUGH THE FOREST.",
      Accent: Pal.hex(0xff8a3d),
      Accent2: Gold,
      BgTop: Pal.hex(0x7ccbf5),
      BgBottom: Pal.hex(0xbfe9ff),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 120, rootHz: 146.8, degrees: [0, 4, 5, 3], seed: 15, energy: 0.5, major: true },
      Reminders: [
        "Your bird is ready to fly|How many trees can you pass today?",
        "Go for the gold medal|Fly through 50 gaps!",
        "Golden seeds await|Collect them to unlock new birds.",
      ],
      HowTo: [
        howTo(Art.Chevron, Pal.hex(0xff8a3d), "TAP anywhere (or press Space) to flap upwards."),
        howTo(Art.Square, Pal.hex(0x8a5a34), "Fly through the gaps between the trees. Each gap is one point."),
        howTo(Art.Diamond, Pal.Danger, "Don't touch the trees or the ground!"),
        howTo(Art.Star, Gold, "Medals at 10, 25, 50 and 100 points."),
        howTo(Art.Disc, Gold, "Grab golden SEEDS to unlock new birds on the title screen."),
      ],
      Tips: [
        "Short, gentle taps beat big panicky ones.",
        "Aim for the middle of each gap.",
        "Find a rhythm: the trees come at a steady pace.",
        "Don't chase seeds that are too far out of the way.",
        "Relax your thumb: tension makes you over-tap.",
      ],
    });
  }

  protected get ShortSide() { return Screen.width > Screen.height ? 10 : 9; }
  private get Seeds() { return this.Data.get("seeds"); }
  private set Seeds(v: number) { this.Data.set("seeds", Math.max(0, v)); }
  private get Skin() { return Mathf.clamp(this.Data.get("skin"), 0, Skins - 1); }
  private Owned(s: number) { return s === 0 || this.Data.get("own" + s) === 1; }
  protected BestLine() { const b = this.Data.get("best"); return b > 0 ? `BEST ${b}   ·   ${MedalName(b)}` : "TAP TO FLAP!"; }
  protected StatsLine() { return `${Fmt.n(this.Seeds)} SEEDS   ·   ${this.Data.get("games")} FLIGHTS`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("FlapWorld", this.gameObject);
    const world = this.world;
    CasualLook.calm(this, 1.2, 0.16);
    this.sky = Art.spr(world, "Sky", CasualArt.gradient(Color.white, new Color(0.85, 0.9, 0.95, 1)), Color.white, 1, -950, Art.Flat);
    this.sun = Art.spr(world, "Sun", CasualArt.Soft, new Color(1, 0.95, 0.7, 0.9), 5, -940, Art.Flat);
    for (let i = 0; i < 30; i++) this.stars.push(Art.spr(world, "Star", CasualArt.StarShape, Color.white, 0.14, -945, Art.Flat));
    for (let i = 0; i < 4; i++) this.clouds.push(Art.spr(world, "Cloud", Cloud(), Color.white, 3, -930, Art.Flat));
    this.hillsA = Art.spr(world, "Hills", Hills(), Pal.hex(0xa8dfa0), 1, -920, Art.Flat);
    this.hillsB = Art.spr(world, "Hills2", Hills(), Pal.hex(0xa8dfa0), 1, -920, Art.Flat);
    for (let i = 0; i < Pillars; i++) {
      const p = new Pillar();
      p.Top = new SlicedSprite(world, "TrunkTop", Trunk(), BorderPx / 128, 10);
      p.Bottom = new SlicedSprite(world, "TrunkBottom", Trunk(), BorderPx / 128, 10);
      p.TopCap = Art.spr(world, "CapTop", Canopy(), Color.white, 1, 11, Art.Flat);
      p.BottomCap = Art.spr(world, "CapBottom", Canopy(), Color.white, 1, 11, Art.Flat);
      p.Seed = Art.spr(world, "Seed", SeedSprite(), Color.white, 0.55, 12, Art.Flat);
      this.pillars[i] = p;
    }
    this.groundA = Art.spr(world, "Ground", Ground(), Color.white, 1, 40, Art.Flat);
    this.groundB = Art.spr(world, "Ground2", Ground(), Color.white, 1, 40, Art.Flat);

    this.bird = new GameObject("Bird", world);
    this.birdBody = Art.spr(this.bird, "Body", BirdBody(0), Color.white, 1.05, 30, Art.Flat);
    const beak = Art.spr(this.bird, "Beak", Beak(), Color.white, 0.42, 31, Art.Flat);
    beak.transform.localPosition = new V3(0.48, -0.02, 0);
    this.wingSr = Art.spr(this.bird, "Wing", Wing(), Color.white, 0.55, 32, Art.Flat);
    this.wing = this.wingSr.transform;
    this.wing.localPosition = new V3(-0.12, -0.05, 0);
    this.fx = CasualFx.create(world, 60, 160);

    const hud = this.UI.Hud;
    this.scoreText = UIKit.at(UIKit.label(hud, "0", 130, Color.white), new V2(0.5, 1), new V2(0, -150), new V2(500, 160));
    UIKit.glow(this.scoreText, Ink, 6);
    // The C# centres this left-aligned label at x=150, which puts the count on top of the seed icon; start it after the icon.
    this.seedText = UIKit.at(UIKit.label(hud, "", 34, Gold, TextAnchor.MiddleLeft), new V2(0, 1), new V2(215, -80), new V2(240, 50));
    UIKit.glow(this.seedText, Ink, 3);
    const seedIcon = UIKit.img(hud, "SeedIcon", SeedSprite(), Color.white);
    seedIcon.rectTransform.place(new V2(0, 1), new V2(60, -80), new V2(44, 56));
    this.tapText = UIKit.at(UIKit.label(hud, "TAP TO FLAP", 50, Color.white), UIKit.Center, new V2(0, -220), new V2(700, 70));
    UIKit.glow(this.tapText, Ink, 4);
    this.medalIcon = UIKit.img(hud, "Medal", Art.Star, Gold);
    this.medalIcon.rectTransform.place(new V2(0.5, 1), new V2(0, -260), new V2(70, 70));

    if (this.UI.TitleExtra) {
      const extra = this.UI.TitleExtra;
      CasualLook.titleCard(this.UI, new Color(0.14, 0.28, 0.44, 0.82));
      this.skinPreview = UIKit.img(extra, "Skin", BirdBody(0), Color.white);
      this.skinPreview.rectTransform.place(UIKit.Center, new V2(-250, 0), new V2(100, 100));
      this.skinLabel = UIKit.at(UIKit.label(extra, "", 30, Color.white), UIKit.Center, new V2(-40, 20), new V2(280, 44));
      this.skinInfo = UIKit.at(UIKit.label(extra, "", 24, Gold), UIKit.Center, new V2(-40, -24), new V2(280, 34));
      const prev = UIKit.buttonAt(extra, "<", UIKit.Center, new V2(-420, 0), new V2(110, 96), false, () => this.Browse(-1), 46);
      const next = UIKit.buttonAt(extra, ">", UIKit.Center, new V2(420, 0), new V2(110, 96), false, () => this.Browse(1), 46);
      this.skinAction = UIKit.buttonAt(extra, "USE", UIKit.Center, new V2(210, 0), new V2(220, 96), false, () => this.SkinAction(), 28);
      for (const b of [prev, next, this.skinAction]) b.setAccent(Pal.hex(0xff8a3d));
      this.browse = this.Skin;
      this.RefreshSkin();
    }

    this.flapClip = Sfx.make("ff2-flap", 0.1, (t) => ((noiseAt(Math.trunc(t * 44100)) * 2 - 1) * 0.4 + Sfx.sinP(Sfx.glide(t, 500, 800, 0.08)) * 0.3) * Sfx.env(t, 0.003, 0.08) * 0.3);
    this.pointClip = Sfx.make("ff2-point", 0.2, (t) => (Sfx.sinP(1046.5 * t) * Sfx.env(t, 0.002, 0.08) + Sfx.sinP(1568 * t) * Sfx.env(t - 0.06, 0.002, 0.12)) * 0.2);
    this.hitClip = Sfx.make("ff2-hit", 0.3, (t) => (Sfx.sinP(Sfx.glide(t, 300, 80, 0.25)) * 0.6 + (noiseAt(Math.trunc(t * 44100) + 3) * 2 - 1) * 0.3 * Sfx.env(t, 0.001, 0.05)) * Sfx.env(t, 0.002, 0.25) * 0.45);
    this.seedClip = Sfx.make("ff2-seed", 0.2, (t) => Sfx.sinP(Sfx.glide(t, 900, 1800, 0.15)) * Sfx.env(t, 0.002, 0.18) * 0.25);
    this.Layout();
    this.ApplySkin();
  }

  private Browse(d: number) {
    this.browse = (this.browse + d + Skins) % Skins;
    Sfx.play(Snd.Click, 0.6);
    this.RefreshSkin();
  }

  private SkinAction() {
    if (!this.Owned(this.browse)) {
      const cost = SkinCost[this.browse];
      if (this.Seeds < cost) { Sfx.play(Snd.Deny, 0.6); this.UI.Toast(`Need ${cost - this.Seeds} more golden seeds.`, 2.5); return; }
      this.Seeds = this.Seeds - cost;
      this.Data.set("own" + this.browse, 1);
      Sfx.play(Snd.PowerUp, 0.8);
    }
    this.Data.set("skin", this.browse);
    this.Data.flush();
    this.ApplySkin();
    this.RefreshSkin();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private RefreshSkin() {
    if (!this.skinPreview) return;
    this.skinPreview.sprite = BirdBody(this.browse);
    this.skinLabel.text = SkinNames[this.browse] + " BIRD";
    const owned = this.Owned(this.browse), using_ = this.browse === this.Skin;
    this.skinInfo.text = using_ ? "FLYING" : owned ? "OWNED" : `${SkinCost[this.browse]} SEEDS`;
    if (this.skinAction.label) this.skinAction.label.text = using_ ? "IN USE" : owned ? "USE" : "BUY";
    this.skinAction.interactable = !using_;
  }

  private ApplySkin() { this.birdBody.sprite = BirdBody(this.Skin); }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    this.sky.transform.localScale = new V3(this.ViewSize.x * 1.2 + 2, (this.ViewSize.y * 1.2 + 2) / 4, 1);
    this.groundY = -this.ViewSize.y * 0.5 + 1.6;
    this.topY = this.ViewSize.y * 0.5;
    const gw = this.ViewSize.x + 2;
    for (const g of [this.groundA, this.groundB]) g.transform.localScale = new V3(gw, 2.2 / 0.25, 1);
    for (const h of [this.hillsA, this.hillsB]) h.transform.localScale = new V3(gw, gw, 1);
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.ResetWorld();
    this.browse = this.Skin;
    this.RefreshSkin();
    this.ApplySkin();
  }

  private ResetWorld() {
    this.birdY = 0.5;
    this.vy = 0;
    this.score = this.seedsRun = 0;
    this.speed = 3.6;
    this.started = this.dying = false;
    this.dead = 0;
    this.timeOfDay = 0;
    const x0 = this.ViewSize.x * 0.5 + 2;
    for (let i = 0; i < Pillars; i++) this.SetupPillar(this.pillars[i], x0 + i * Spacing);
    this.fx.clear();
  }

  private SetupPillar(p: Pillar, x: number) {
    p.X = x;
    p.Gap = Mathf.lerp(3.5, 2.75, Mathf.clamp01(this.score / 60));
    const lo = this.groundY + p.Gap * 0.5 + 1.2, hi = this.topY - p.Gap * 0.5 - 1.4;
    p.GapY = Mathf.lerp(lo, Math.max(lo, hi), this.rng.nextDouble());
    p.Scored = false;
    p.SeedTaken = this.rng.nextDouble() > 0.3;
    p.Seed.gameObject.setActive(!p.SeedTaken);
  }

  protected BeginRun() {
    this.rng = new SysRandom();
    this.ResetWorld();
    this.revived = false;
    this.pointer.reset();
    this.pointer.topBand = 0.04;
    this.tapText.text = "TAP TO FLAP";
    this.Data.add("games", 1);
    Sfx.setIntensity(0.3);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.State !== Phase.Title) return;
    this.Scenery(dt, true);
    {
      this.birdY = 0.6 + Math.sin(Time.time * 2.4) * 0.35;
      this.vy = Math.cos(Time.time * 2.4) * 0.8;
      this.flapAnim += dt * 10;
    }
    this.PresentBird(dt);
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    const tap = this.pointer.down || this.Controls.actionPressed;
    if (!this.started) {
      this.birdY = 0.6 + Math.sin(Time.time * 3) * 0.25;
      this.flapAnim += dt * 10;
      this.Scenery(dt, false);
      this.PresentBird(dt);
      if (tap) { this.started = true; this.tapText.text = ""; this.Flap(); }
      return;
    }
    if (this.dying) {
      this.dead += dt;
      this.vy = Math.max(MaxFall, this.vy - Gravity * dt);
      this.birdY = Math.max(this.groundY + 0.45, this.birdY + this.vy * dt);
      this.PresentBird(dt);
      if (this.dead > 1.1 && this.State === Phase.Playing) this.Lose();
      return;
    }
    if (tap) this.Flap();
    this.vy = Math.max(MaxFall, this.vy - Gravity * dt);
    this.birdY += this.vy * dt;
    if (this.birdY > this.topY - 0.3) { this.birdY = this.topY - 0.3; this.vy = Math.min(this.vy, 0); }
    this.speed = Math.min(5.4, 3.6 + this.score * 0.03);
    this.Scenery(dt, false);
    this.Collide();
    this.PresentBird(dt);
  }

  private Flap() {
    this.vy = FlapV;
    this.flapAnim = 0;
    Sfx.playClip(this.flapClip, 0.5, 0.95 + this.rng.nextDouble() * 0.1);
    this.fx.emit(new V2(this.BirdX - 0.3, this.birdY - 0.1), new V2(-1.5, -1), new Color(1, 1, 1, 0.7), 0.18, 0.35);
  }

  private get BirdX() { return -this.ViewSize.x * 0.5 + Math.min(3, this.ViewSize.x * 0.3); }

  private Scenery(dt: number, idle: boolean) {
    const v = idle ? 2 : this.speed;
    this.scroll += v * dt;
    this.hillScroll += v * 0.25 * dt;
    const gw = this.ViewSize.x + 2;
    const o = Mathf.repeat(this.scroll, gw);
    this.groundA.transform.localPosition = new V3(-o, this.groundY - 1.1, 0);
    this.groundB.transform.localPosition = new V3(-o + gw, this.groundY - 1.1, 0);
    const ho = Mathf.repeat(this.hillScroll, gw);
    this.hillsA.transform.localPosition = new V3(-ho, this.groundY + gw * 0.125 - 0.6, 0);
    this.hillsB.transform.localPosition = new V3(-ho + gw, this.groundY + gw * 0.125 - 0.6, 0);
    for (let i = 0; i < this.clouds.length; i++) {
      const x = Mathf.repeat(i * 4.3 - this.scroll * 0.15, this.ViewSize.x + 6) - this.ViewSize.x * 0.5 - 3;
      this.clouds[i].transform.localPosition = new V3(x, this.topY - 2 - i * 1.3, 0);
    }
    // time of day follows the score: morning → sunset → night → morning
    const target = (this.score % 60) / 60;
    this.timeOfDay = Mathf.moveTowards(this.timeOfDay, target, dt * 0.05);
    if (target < this.timeOfDay - 0.5) this.timeOfDay = target;
    this.ApplySky();

    if (!idle || this.State === Phase.Title) {
      for (const p of this.pillars) {
        p.X -= v * dt;
        if (p.X < -this.ViewSize.x * 0.5 - TrunkW) {
          let maxX = -Number.MAX_VALUE;
          for (const q of this.pillars) maxX = Math.max(maxX, q.X);
          this.SetupPillar(p, maxX + Spacing);
        }
        this.PlacePillar(p);
      }
    }
  }

  private ApplySky() {
    const t = this.timeOfDay;
    const dayTop = Pal.hex(0x7ccbf5), sunsetTop = Pal.hex(0xff9e7a), nightTop = Pal.hex(0x1c2350);
    let c = t < 0.45 ? Color.lerp(dayTop, sunsetTop, CasualArt.smooth(0.25, 0.45, t)) : Color.lerp(sunsetTop, nightTop, CasualArt.smooth(0.5, 0.7, t));
    if (t > 0.88) c = Color.lerp(nightTop, dayTop, CasualArt.smooth(0.88, 1, t));
    this.sky.color = c;
    const night = CasualArt.smooth(0.55, 0.7, t) * (1 - CasualArt.smooth(0.88, 0.98, t));
    const vs = this.ViewSize;
    for (let i = 0; i < this.stars.length; i++) {
      const sx = Mathf.repeat(i * 0.618, 1) * vs.x - vs.x * 0.5, sy = Mathf.repeat(i * 0.382 + 0.2, 0.7) * vs.y * 0.6 + vs.y * 0.05;
      this.stars[i].transform.localPosition = new V3(sx, sy, 0);
      this.stars[i].color = new Color(1, 1, 1, night * (0.5 + 0.5 * Math.sin(Time.time * 2 + i)));
    }
    this.sun.transform.localPosition = new V3(vs.x * 0.25, this.topY - 2.5 - t * 6, 0);
    this.sun.color = new Color(1, Mathf.lerp(0.95, 0.6, t * 2), Mathf.lerp(0.7, 0.4, t * 2), 0.9 * (1 - night));
    const hill = Color.lerp(Pal.hex(0xa8dfa0), Pal.hex(0x3a4c6a), night);
    this.hillsA.color = this.hillsB.color = hill;
    for (const cl of this.clouds) cl.color = new Color(1, 1, 1, 0.85 - night * 0.5);
  }

  private PlacePillar(p: Pillar) {
    const gapTop = p.GapY + p.Gap * 0.5, gapBottom = p.GapY - p.Gap * 0.5;
    const topH = Math.max(0.1, this.topY + 1 - gapTop), botH = Math.max(0.1, gapBottom - (this.groundY - 1));
    p.Top.size = new V2(TrunkW, topH);
    p.Top.transform.localPosition = new V3(p.X, gapTop + topH * 0.5, 0);
    p.Bottom.size = new V2(TrunkW, botH);
    p.Bottom.transform.localPosition = new V3(p.X, gapBottom - botH * 0.5, 0);
    const cw = TrunkW * 1.6;
    p.TopCap.transform.localScale = new V3(cw, -cw, 1);
    p.TopCap.transform.localPosition = new V3(p.X, gapTop + 0.25, 0);
    p.BottomCap.transform.localScale = new V3(cw, cw, 1);
    p.BottomCap.transform.localPosition = new V3(p.X, gapBottom - 0.25, 0);
    p.Seed.transform.localPosition = new V3(p.X + Spacing * 0.5, p.GapY + Math.sin(Time.time * 3 + p.X) * 0.15, 0);
  }

  private Collide() {
    const bx = this.BirdX, r = 0.4;
    if (this.birdY - r < this.groundY) { this.Die(); return; }
    for (const p of this.pillars) {
      const gapTop = p.GapY + p.Gap * 0.5, gapBottom = p.GapY - p.Gap * 0.5;
      const half = TrunkW * 0.5 + 0.15;
      if (Math.abs(bx - p.X) < half + r * 0.8 && (this.birdY + r * 0.85 > gapTop + 0.1 || this.birdY - r * 0.85 < gapBottom - 0.1)) { this.Die(); return; }
      if (!p.Scored && p.X < bx) {
        p.Scored = true;
        this.score++;
        Sfx.playClip(this.pointClip, 0.6);
        if (this.score === 10 || this.score === 25 || this.score === 50 || this.score === 100) {
          this.UI.Announce(MedalName(this.score) + " MEDAL!", MedalColor(this.score), 1.3);
          this.fx.confetti(new V2(0, this.topY - 3), 40, 7, [Gold, Color.white, MedalColor(this.score)]);
          Sfx.play(Snd.NewBest, 0.6);
        }
        this.UpdateHud();
      }
      if (!p.SeedTaken) {
        const lp = p.Seed.transform.localPosition, sp = new V2(lp.x, lp.y);
        if (sp.sub(new V2(bx, this.birdY)).sqrMagnitude < 0.5) {
          p.SeedTaken = true;
          p.Seed.gameObject.setActive(false);
          this.seedsRun++;
          this.Seeds = this.Seeds + 1;
          Sfx.playClip(this.seedClip, 0.7);
          this.fx.sparkle(sp, Gold, 6, 0.4, 0.3);
          this.UpdateHud();
        }
      }
    }
  }

  private Die() {
    if (this.dying) return;
    this.dying = true;
    this.dead = 0;
    this.vy = 6;
    Sfx.playClip(this.hitClip, 0.9);
    this.Fx.shake(0.35);
    Fx.haptic(true);
    this.fx.pop(new V2(this.BirdX, this.birdY), SkinBody[this.Skin], 14, 5, 0.2, 0.5);
  }

  private PresentBird(dt: number) {
    this.bird.localPosition = new V3(this.BirdX, this.birdY, 0);
    const tilt = Mathf.clamp(this.vy * 4.5, -80, 30);
    this.bird.localRotation = Quaternion.euler(0, 0, tilt);
    this.flapAnim += dt;
    const w = Math.sin(Math.min(1, this.flapAnim * 6) * Math.PI * 2);
    this.wing.localRotation = Quaternion.euler(0, 0, w * 40);
    this.wing.localScale = new V3(0.55, 0.55 * (0.7 + 0.3 * Math.abs(w)), 1);
    this.wingSr.color = CasualArt.lighten(SkinBody[this.Skin], 0.35);
  }

  private UpdateHud() {
    CasualUI.setText(this.scoreText, String(this.score));
    CasualUI.setText(this.seedText, Fmt.n(this.Seeds));
    this.medalIcon.gameObject.setActive(this.score >= 10);
    this.medalIcon.color = MedalColor(this.score);
  }

  private Lose() {
    const newBest = this.Data.max("best", this.score);
    this.Finish(new Result({
      Headline: newBest ? "NEW BEST!" : this.score >= 10 ? MedalName(this.score) + " MEDAL" : "OUCH!",
      HeadlineColor: this.score >= 10 ? MedalColor(this.score) : Pal.hex(0xffd2c2),
      Value: String(this.score),
      CountTo: this.score,
      NewBest: newBest,
      BestLine: `BEST ${this.Data.get("best")}   ·   ${MedalName(this.Data.get("best"))}`,
      Stats: [["SCORE", String(this.score)], ["SEEDS", "+" + this.seedsRun], ["MEDAL", MedalName(this.score)], ["BEST", String(this.Data.get("best"))]],
      Primary: "FLY AGAIN",
      Reward: this.revived ? null : () => this.Continue(),
      RewardLabel: "EXTRA LIFE (WATCH AD)",
    }));
  }

  private Continue() {
    this.revived = true;
    this.dying = false;
    this.started = false;
    this.birdY = 0.5;
    this.vy = 0;
    // push the trees ahead so there is room to start again
    const x = this.ViewSize.x * 0.5 + 1;
    const list = [...this.pillars];
    list.sort((a, b) => a.X - b.X);
    for (let i = 0; i < list.length; i++) { list[i].X = x + i * Spacing; list[i].Scored = false; this.PlacePillar(list[i]); }
    this.tapText.text = "TAP TO CONTINUE";
    this.pointer.reset();
    this.Revive();
  }
}
