import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CanvasGroup, CasualArt, CasualFx, CasualLook, Color, Fmt, Fx,
  GameInfo, GameObject, Gamepad, howTo, Image, Keyboard, LoopSource, Mathf, Pal, Phase, Render, Result, Screen, Sfx, Snd,
  SpriteRenderer, Text, TextAnchor, Time, Touchscreen, TouchScheme, UI, UIKit, UINode, V2, V3,
} from "../../kit";
import * as A from "./EmberRippleArt";
import { LEVELS } from "./EmberRippleLevels";
import { PLANS } from "./EmberRipplePlans";
import { Hero, HeroBody, HeroInput, NoInput, Phys, PlanDriver, Sim, SimEvent, snapshot, Tile } from "./EmberRippleSim";

/**
 * EMBER & RIPPLE: TWIN TEMPLE. A two-spirit cooperative puzzle platformer. Ember (fire) wades through lava, Ripple
 * (water) through water, green goo destroys both. Each collects gems of its colour and both must stand in their own
 * doors. Buttons, levers, sliding stones, lifts, pushable blocks, moving platforms and wind vents across 20 temple
 * levels (EmberRippleLevels.ts). Desktop: both spirits at once on one keyboard (arrows / WAD). Phones: on-screen
 * ◀ ▶ JUMP for one spirit at a time plus SWAP. Stars for finishing, every gem and the par time.
 */

const TopBand = 200, TouchBand = 360, DeskBand = 40;
const Orange = Pal.hex(0xff8a3a), Cyan = Pal.hex(0x38c8ff), Gold = Pal.hex(0xffc93c);
const RespawnDelay = 0.95, WinDelay = 1.5;

/** Application.isMobilePlatform (kit gap: the kit has no equivalent; same helper as ghostline). */
const isMobilePlatform = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

class HeroView {
  root!: GameObject;
  body!: SpriteRenderer; hair!: SpriteRenderer; glow!: SpriteRenderer;
  eyes: SpriteRenderer[] = []; pupils: SpriteRenderer[] = []; mouth!: SpriteRenderer;
  squash = 0; blink = 0; blinkIn = 2; trail = 0; spawn = 0; fade = 1; pushT = 0;
}

class TouchPad {
  node!: UINode; bg!: Image; icon!: Image; held = false;
}

enum Mode { Play, Dying, Winning, Done }

export class EmberRippleGame extends ArcadeGame {
  private world!: GameObject;
  private levelRoot: GameObject | null = null;
  private cover!: SpriteRenderer;
  private fx!: CasualFx;
  private sim!: Sim;
  private level = 1;
  private mode = Mode.Play;
  private modeT = 0;
  private acc = 0;
  private deaths = 0;
  private active = 0;
  private driver: PlanDriver | null = null;
  private attractEnd = 0;
  private lastTextures: string[] = [];

  // world views
  private readonly views: HeroView[] = [];
  private readonly moverViews: SpriteRenderer[] = [];
  private readonly blockViews: SpriteRenderer[] = [];
  private readonly gemViews: { sr: SpriteRenderer; glow: SpriteRenderer; phase: number }[] = [];
  private readonly buttonViews: { plate: SpriteRenderer; press: number; y: number }[] = [];
  private readonly leverViews: { pivot: GameObject; angle: number }[] = [];
  private readonly doorViews: { panel: SpriteRenderer; inside: SpriteRenderer; open: number; x: number; y: number }[] = [];
  private readonly liquids: { sr: SpriteRenderer; t: Tile; x: number; glow: SpriteRenderer | null }[] = [];
  private readonly torches: { flame: SpriteRenderer; glow: SpriteRenderer; phase: number; x: number; y: number }[] = [];
  private readonly shafts: { sr: SpriteRenderer; phase: number; a: number }[] = [];
  private marker!: SpriteRenderer;

  // camera
  private camPos = V2.zero;
  private camShort = 14;
  private camInit = false;
  private readonly zoomVel = { v: 0 };

  // HUD
  private levelText!: Text; private nameText!: Text; private timeText!: Text;
  private gemText: Text[] = [];
  private hintButton!: ArcadeButton; private skipButton!: ArcadeButton;
  private touchRoot!: UINode;
  private padL = new TouchPad(); private padR = new TouchPad(); private padJ = new TouchPad();
  private swapButton!: ArcadeButton; private swapIcon!: Image;
  private touchUI = false;
  private readonly pathNodes: ArcadeButton[] = [];
  private readonly pathStars: Image[][] = [];
  private readonly pathLocks: Image[] = [];
  private gridLayer!: CanvasGroup;
  private readonly gridButtons: { b: ArcadeButton; stars: Image[]; lock: Image }[] = [];

  // audio
  private clips: Record<string, AudioClip> = {};
  private stoneLoop: LoopSource | null = null;
  private windLoop: LoopSource | null = null;
  private scrapeLoop: LoopSource | null = null;
  private lavaLoop: LoopSource | null = null;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "emberripple",
      Title: "EMBER & RIPPLE",
      Tagline: "TWO ELEMENTS. ONE TEMPLE.",
      PlayLabel: "PLAY",
      Accent: Orange,
      Accent2: Cyan,
      BgTop: Pal.hex(0x2a1f33),
      BgBottom: Pal.hex(0x120c18),
      GridSpacing: 0,
      ShortSide: 14,
      Touch: TouchScheme.None,
      Music: { bpm: 92, rootHz: 98, degrees: [0, 5, 3, 4], seed: 23, energy: 0.38, major: false },
      Reminders: [
        "The temple doors are waiting|Ember and Ripple can't finish it without you.",
        "A new chamber has opened|Fire and water, one more time.",
        "Those gems won't collect themselves|Go for three stars!",
      ],
      HowTo: [
        howTo(A.EmberBody(), Color.white, "EMBER (fire): ← → to move, ↑ to jump. Wades through LAVA, but WATER puts him out."),
        howTo(A.RippleBody(), Color.white, "RIPPLE (water): A D to move, W to jump. Swims through WATER, but LAVA boils her away."),
        howTo(A.LiquidSprite(Tile.Goo, 0), Color.white, "Green GOO destroys both of you. Always jump over it!"),
        howTo(A.GemSprite(0), Color.white, "Ember takes RED gems, Ripple BLUE gems. Both must stand in their own DOOR to finish."),
        howTo(A.ButtonPlate(), Palette_channel("a"), "BUTTONS and LEVERS move stone gates and lifts. Walk into stone BLOCKS to push them."),
        howTo(A.Marker(), Color.white, "PHONE: ◀ ▶ and JUMP move one spirit; SWAP changes spirit. The other one waits."),
        howTo(Art.Star, Gold, "Stars: finish the level, collect every gem, beat the par time."),
      ],
      Tips: [
        "Only one spirit needs to hold a button. Take turns!",
        "Blocks press buttons too, and make handy steps.",
        "A lever stays where you push it. Each lever flips its stones.",
        "Ride a vent's wind and steer towards the ledge.",
        "Stuck? The HINT button explains the level.",
      ],
    });
  }

  private get Unlocked() { return Mathf.clamp(this.Data.get("u", 1), 1, LEVELS.length); }
  private get Selected() { return Mathf.clamp(this.Data.get("sel", 1), 1, this.Unlocked); }
  private TotalStars() { let s = 0; for (let i = 1; i <= LEVELS.length; i++) s += this.Data.get("s" + i); return s; }

  protected BestLine() { return `★ ${this.TotalStars()} / ${LEVELS.length * 3}   ·   ${this.Selected}. ${LEVELS[this.Selected - 1].name.toUpperCase()}`; }
  protected StatsLine() {
    const g = this.Data.get("gems");
    return g > 0 ? `${Fmt.n(g)} GEMS COLLECTED   ·   ${Fmt.n(this.Data.get("cleared"))} LEVELS CLEARED` : "PLAY TOGETHER ON ONE KEYBOARD, OR SWAP ON YOUR PHONE";
  }

  protected get ShortSide() { return this.camShort; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("TempleWorld", this.gameObject);
    CasualLook.calm(this, 1.0, 0.34);
    this.cover = CasualLook.cover(this.world, CasualArt.gradient(Pal.hex(0x231a2c), Pal.hex(0x0d0a12), Pal.hex(0x4a2a3a).withAlpha(0.35)), -950);
    this.fx = CasualFx.create(this.world, 55, 420);
    this.marker = Art.spr(this.world, "Marker", A.Marker(), Color.white, 0.32, 60, Art.Flat);
    for (let k = 0; k < 2; k++) this.views.push(this.MakeHero(k));
    this.MakeSounds();
    this.BuildHud();
    this.BuildTitle();
    this.BuildGrid();
    this.Layout();
  }

  private MakeHero(kind: number) {
    const v = new HeroView();
    v.root = new GameObject(kind === 0 ? "Ember" : "Ripple", this.world);
    const tint = kind === 0 ? A.Palette.Ember : A.Palette.Ripple;
    v.glow = Art.spr(v.root, "Glow", Art.Glow, tint.withAlpha(0.5), 2.6, 19, Art.Additive);
    v.glow.transform.localPosition = new V3(0, 0.5, 0);
    v.hair = Art.spr(v.root, "Hair", kind === 0 ? A.EmberFlame(0) : A.RippleCurl(0), kind === 0 ? Color.white : A.Palette.RippleLight, kind === 0 ? 0.78 : 0.5, 21, kind === 0 ? Art.Solid : Art.Flat);
    v.body = Art.spr(v.root, "Body", kind === 0 ? A.EmberBody() : A.RippleBody(), Color.white, 1, 22, Art.Flat);
    for (let i = 0; i < 2; i++) {
      v.eyes.push(Art.spr(v.body.gameObject, "Eye", A.EyeWhite(), Color.white, 0.2, 23, Art.Flat));
      v.pupils.push(Art.spr(v.body.gameObject, "Pupil", A.Pupil(), Color.white, 0.12, 24, Art.Flat));
    }
    v.mouth = Art.spr(v.body.gameObject, "Mouth", A.Mouth(), Color.white, 0.22, 24, Art.Flat);
    return v;
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    const plate = UIKit.img(hud, "LevelPlate", Art.UiRound, new Color(0.08, 0.05, 0.1, 0.72));
    plate.rectTransform.place(new V2(0, 1), new V2(190, -88), new V2(340, 124));
    this.levelText = UIKit.at(UIKit.label(plate.rectTransform, "LEVEL 1", 40, Color.white, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(170, 22), new V2(300, 50));
    this.nameText = UIKit.at(UIKit.label(plate.rectTransform, "", 26, Gold, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(170, -24), new V2(300, 36));
    CasualLook.fit(this.nameText, 16);

    const gems = UIKit.img(hud, "GemPlate", Art.UiRound, new Color(0.08, 0.05, 0.1, 0.72));
    gems.rectTransform.place(new V2(0.5, 1), new V2(10, -88), new V2(330, 124));
    for (let k = 0; k < 2; k++) {
      UIKit.img(gems.rectTransform, "Gem", A.GemSprite(k), Color.white).rectTransform.place(UIKit.Center, new V2(-130 + k * 150, 22), new V2(50, 50));
      this.gemText.push(UIKit.at(UIKit.label(gems.rectTransform, "0/0", 34, k === 0 ? Pal.hex(0xffb0b8) : Pal.hex(0xb2e6ff), TextAnchor.MiddleLeft), UIKit.Center, new V2(-50 + k * 150, 22), new V2(110, 46)));
    }
    this.timeText = UIKit.at(UIKit.label(gems.rectTransform, "0:00", 30, Color.white.withAlpha(0.9)), UIKit.Center, new V2(0, -28), new V2(300, 40));

    this.hintButton = UIKit.buttonAt(hud, "HINT", new V2(1, 1), new V2(-230, -85), new V2(150, 96), false, () => this.OnHint(), 30);
    this.hintButton.setAccent(Gold);
    this.skipButton = UIKit.buttonAt(hud, "SKIP ▶", new V2(1, 1), new V2(-230, -195), new V2(230, 90), false, () => this.OnSkip(), 28);
    this.skipButton.setAccent(Pal.Warn);
    this.skipButton.node.setActive(false);

    // phone controls (bottom of the screen)
    this.touchRoot = UIKit.node("Touch", hud).stretch();
    const pad = (p: TouchPad, name: string, anchor: V2, pos: V2, size: number, icon: string, tint: Color) => {
      p.node = UIKit.node(name, this.touchRoot).place(anchor, pos, new V2(size, size));
      p.bg = UIKit.img(p.node, "Bg", Art.UiCircle, new Color(0.1, 0.06, 0.12, 0.55));
      p.bg.rectTransform.stretch();
      UIKit.img(p.node, "Ring", Art.UiRing, tint.withAlpha(0.7)).rectTransform.stretch();
      const t = UIKit.label(p.node, icon, icon.length > 1 ? size * 0.2 : size * 0.36, Color.white);
      t.rectTransform.stretch();
      p.icon = UIKit.img(p.node, "Dummy", null, Color.clear);
    };
    pad(this.padL, "Left", new V2(0, 0), new V2(125, 150), 190, "◀", Color.white);
    pad(this.padR, "Right", new V2(0, 0), new V2(335, 150), 190, "▶", Color.white);
    pad(this.padJ, "Jump", new V2(1, 0), new V2(-140, 165), 220, "JUMP", Gold);
    this.swapButton = UIKit.buttonAt(this.touchRoot, "", new V2(1, 0), new V2(-370, 120), new V2(170, 150), false, () => this.Swap(), 26);
    this.swapIcon = UIKit.img(this.swapButton.node, "Face", A.EmberBody(), Color.white);
    this.swapIcon.rectTransform.place(UIKit.Center, new V2(0, 18), new V2(78, 78));
    UIKit.at(UIKit.label(this.swapButton.node, "SWAP", 26, Color.white), UIKit.Center, new V2(0, -46), new V2(160, 36));
    this.touchRoot.setActive(false);
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    CasualLook.titleCard(this.UI, new Color(0.06, 0.04, 0.09, 0.62), new V2(1060, 1100), -10);
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 160 - 60;
      if (i < 4) UIKit.img(ex, "Path", Art.UiRound, new Color(1, 1, 1, 0.25)).rectTransform.place(UIKit.Center, new V2(x + 80, 8), new V2(90, 10));
      const idx = i;
      const b = UIKit.buttonAt(ex, "1", UIKit.Center, new V2(x, 8), new V2(84, 84), false, () => this.PickPath(idx), 34);
      this.pathNodes.push(b);
      const lock = UIKit.img(b.node, "Lock", Lock(), Color.white.withAlpha(0.8));
      lock.rectTransform.place(UIKit.Center, V2.zero, new V2(40, 40));
      this.pathLocks.push(lock);
      const st: Image[] = [];
      for (let k = 0; k < 3; k++) {
        st.push(UIKit.img(ex, "Star", Art.Star, Gold));
        st[k].rectTransform.place(UIKit.Center, new V2(x + (k - 1) * 26, -52), new V2(26, 26));
      }
      this.pathStars.push(st);
    }
    const all = UIKit.buttonAt(ex, "ALL", UIKit.Center, new V2(400, 8), new V2(120, 84), false, () => this.OpenGrid(), 30);
    all.setAccent(Cyan);
  }

  private BuildGrid() {
    const root = UI.root!;
    const rt = UIKit.node("LevelGrid", root).stretch();
    this.gridLayer = new CanvasGroup(rt);
    this.gridLayer.alpha = 1;
    UIKit.dim(rt, 0.8);
    const card = UIKit.card(rt, new V2(940, 1000), Orange);
    UIKit.at(UIKit.label(card, "CHOOSE A CHAMBER", 50, Color.white), UIKit.Center, new V2(0, 425), new V2(860, 70));
    for (let i = 0; i < LEVELS.length; i++) {
      const col = i % 5, row = Math.floor(i / 5);
      const pos = new V2((col - 2) * 165, 290 - row * 175);
      const idx = i + 1;
      const b = UIKit.buttonAt(card, String(idx), UIKit.Center, pos, new V2(130, 130), false, () => this.PickLevel(idx), 46);
      const lock = UIKit.img(b.node, "Lock", Lock(), Color.white.withAlpha(0.75));
      lock.rectTransform.place(UIKit.Center, new V2(0, 6), new V2(52, 52));
      const stars: Image[] = [];
      for (let k = 0; k < 3; k++) {
        stars.push(UIKit.img(card, "Star", Art.Star, Gold));
        stars[k].rectTransform.place(UIKit.Center, pos.add(new V2((k - 1) * 30, -78)), new V2(28, 28));
      }
      this.gridButtons.push({ b, stars, lock });
    }
    UIKit.buttonAt(card, "CLOSE", UIKit.Center, new V2(0, -420), new V2(320, 100), true, () => this.CloseGrid(), 42).setAccent(Orange);
    rt.setActive(false);
  }

  private OpenGrid() {
    this.RefreshGrid();
    this.gridLayer.node.setActive(true);
    this.gridLayer.node.setAsLastSibling();
  }

  private CloseGrid() { this.gridLayer.node.setActive(false); }

  private RefreshGrid() {
    const u = this.Unlocked, sel = this.Selected;
    this.gridButtons.forEach((g, i) => {
      const n = i + 1, open = n <= u, st = this.Data.get("s" + n);
      g.b.interactable = true;
      g.b.setAccent(n === sel ? Orange : open ? Cyan : Pal.TextDim);
      if (g.b.label) g.b.label.text = open ? String(n) : "";
      g.lock.gameObject.setActive(!open);
      for (let k = 0; k < 3; k++) { g.stars[k].gameObject.setActive(open); g.stars[k].color = k < st ? Gold : new Color(1, 1, 1, 0.22); }
    });
  }

  private PickLevel(n: number) {
    if (n > this.Unlocked) { Sfx.play(Snd.Deny, 0.6); this.UI.Toast("Finish the chamber before it to unlock it.", 2); return; }
    this.Data.set("sel", n);
    this.CloseGrid();
    this.RefreshPath();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
    this.StartAttract();
  }

  private PathFirst() { return Mathf.clamp(this.Selected - 2, 1, Math.max(1, LEVELS.length - 4)); }

  private PickPath(i: number) { this.PickLevel(this.PathFirst() + i); }

  private RefreshPath() {
    if (!this.pathNodes.length) return;
    const first = this.PathFirst(), sel = this.Selected, u = this.Unlocked;
    for (let i = 0; i < 5; i++) {
      const n = first + i, open = n <= u, b = this.pathNodes[i], st = this.Data.get("s" + n);
      if (b.label) b.label.text = open ? String(n) : "";
      b.setAccent(n === sel ? Orange : open ? Cyan : Pal.TextDim);
      b.node.localScale = n === sel ? new V3(1.2, 1.2, 1) : V3.one;
      this.pathLocks[i].gameObject.setActive(!open);
      for (let k = 0; k < 3; k++) {
        this.pathStars[i][k].gameObject.setActive(open && st > 0);
        this.pathStars[i][k].color = k < st ? Gold : new Color(1, 1, 1, 0.25);
      }
    }
  }

  // ------------------------------------------------------------------ sounds

  private MakeSounds() {
    let seed = 7;
    const N = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 2 - 1; };
    const lp = (k: number) => { let y = 0; return (x: number) => (y += (x - y) * k); };
    const f1 = lp(0.08), f2 = lp(0.3), f3 = lp(0.04), f4 = lp(0.12), f5 = lp(0.05), f6 = lp(0.02);
    this.clips = {
      jumpE: Sfx.make("er-jump-e", 0.22, (t) => (Sfx.sinP(Sfx.glide(t, 260, 620, 0.18)) * 0.5 + f2(N()) * 0.35) * Sfx.env(t, 0.005, 0.2) * 0.35),
      jumpR: Sfx.make("er-jump-r", 0.2, (t) => Sfx.sinP(Sfx.glide(t, 380, 900, 0.12)) * Sfx.env(t, 0.004, 0.18) * 0.33),
      land: Sfx.make("er-land", 0.14, (t) => (f1(N()) * 0.9 + Sfx.sinP(Sfx.glide(t, 140, 70, 0.1)) * 0.4) * Sfx.env(t, 0.002, 0.12) * 0.4),
      gem: Sfx.make("er-gem", 0.5, (t) => (Sfx.sinP(1318.5 * t) * Sfx.env(t, 0.002, 0.25) + Sfx.sinP(1975.5 * t) * Sfx.env(t - 0.07, 0.002, 0.4) * 0.8) * 0.22),
      steam: Sfx.make("er-steam", 0.9, (t) => (f2(N()) * 0.7 + f3(N()) * 0.6) * Sfx.env(t, 0.01, 0.85) * 0.45),
      sizzle: Sfx.make("er-sizzle", 0.9, (t) => (f4(N()) * (0.6 + 0.4 * Math.sin(t * 90)) + Sfx.sinP(Sfx.glide(t, 300, 80, 0.6)) * 0.3) * Sfx.env(t, 0.01, 0.85) * 0.45),
      goo: Sfx.make("er-goo", 0.6, (t) => (Sfx.sinP(Sfx.glide(t, 180, 60, 0.5) + 30 * Math.sin(t * 40)) * 0.6 + f5(N()) * 0.4) * Sfx.env(t, 0.01, 0.55) * 0.5),
      click: Sfx.make("er-click", 0.12, (t) => (Sfx.sqrP(t * 900) * 0.2 + f2(N()) * 0.5) * Sfx.env(t, 0.001, 0.08) * 0.35),
      clack: Sfx.make("er-clack", 0.2, (t) => (Sfx.triP(Sfx.glide(t, 520, 300, 0.1)) * 0.5 + f2(N()) * 0.5) * Sfx.env(t, 0.001, 0.15) * 0.4),
      door: Sfx.make("er-door", 0.7, (t) => (Sfx.sinP(523.25 * t) * Sfx.env(t, 0.005, 0.5) + Sfx.sinP(783.99 * t) * Sfx.env(t - 0.12, 0.005, 0.5) * 0.7) * 0.2),
      respawn: Sfx.make("er-respawn", 0.6, (t) => (Sfx.sinP(Sfx.glide(t, 400, 1200, 0.5)) * 0.4 + Sfx.sinP(Sfx.glide(t, 600, 1800, 0.5)) * 0.2) * Sfx.env(t, 0.05, 0.5) * 0.3),
      thud: Sfx.make("er-thud", 0.3, (t) => (Sfx.sinP(Sfx.glide(t, 110, 45, 0.25)) * 0.8 + f1(N()) * 0.5) * Sfx.env(t, 0.002, 0.28) * 0.55),
      swap: Sfx.make("er-swap", 0.18, (t) => Sfx.sinP(Sfx.glide(t, 700, 1100, 0.15)) * Sfx.env(t, 0.004, 0.16) * 0.25),
      stone: Sfx.make("er-stone", 1, (t) => (f6(N()) * 2.2 + Sfx.sinP(55 * t) * 0.25 + Sfx.sinP(110 * t) * 0.1) * 0.5),
      wind: Sfx.make("er-wind", 1, (t) => (f3(N()) * 1.4) * (0.75 + 0.25 * Math.sin(t * Math.PI * 2))),
      scrape: Sfx.make("er-scrape", 1, (t) => (f4(N()) * 0.9 * (0.6 + 0.4 * Math.abs(Math.sin(t * Math.PI * 12)))) * 0.6),
      lava: Sfx.make("er-lava", 1, (t) => (f5(N()) * 1.3 * (0.7 + 0.3 * Math.sin(t * Math.PI * 4))) * 0.5),
    };
    this.stoneLoop = Sfx.createLoop(this.clips.stone);
    this.windLoop = Sfx.createLoop(this.clips.wind);
    this.scrapeLoop = Sfx.createLoop(this.clips.scrape);
    this.lavaLoop = Sfx.createLoop(this.clips.lava);
  }

  // ------------------------------------------------------------------ level loading

  private LoadLevel(n: number) {
    this.level = Mathf.clamp(n, 1, LEVELS.length);
    const def = LEVELS[this.level - 1];
    this.sim = new Sim(def);
    this.mode = Mode.Play;
    this.modeT = 0;
    this.acc = 0;
    this.BuildLevelViews();
    this.camInit = false;
  }

  /** Restarts the current level's simulation (after a death) without rebuilding the static art. */
  private ResetSim() {
    this.sim = new Sim(LEVELS[this.level - 1]);
    this.mode = Mode.Play;
    this.modeT = 0;
    this.acc = 0;
    for (const g of this.gemViews) g.sr.gameObject.setActive(true);
    for (const v of this.views) { v.spawn = 0; v.fade = 1; v.squash = 0; }
    this.SyncViews(0);
  }

  private BuildLevelViews() {
    this.levelRoot?.destroy();
    const root = (this.levelRoot = new GameObject("Level", this.world));
    this.moverViews.length = this.blockViews.length = this.gemViews.length = this.buttonViews.length = 0;
    this.leverViews.length = this.doorViews.length = this.liquids.length = this.torches.length = this.shafts.length = 0;
    this.fx.clear();
    const sim = this.sim;
    // free the previous level's big textures (phones have little GPU memory)
    const key = "er-lvl-" + this.level;
    for (const k of this.lastTextures) if (!k.startsWith(key + "-") && Render.scene?.textures.exists(k)) Render.scene.textures.remove(k);
    const bake = A.bakeLevel(sim, key);
    this.lastTextures = [key + "-back", key + "-solid"];
    const center = new V3(sim.W / 2, sim.H / 2, 0);
    Art.spr(root, "Back", bake.back, Color.white, 1, -100, Art.Flat).transform.localPosition = center;
    Art.spr(root, "Stone", bake.solid, Color.white, 1, -50, Art.Flat).transform.localPosition = center;

    // light shafts from the ceiling
    const count = Math.max(2, Math.round(sim.W / 11));
    for (let i = 0; i < count; i++) {
      const x = (i + 0.5 + (A.hash(i, this.level, 2) - 0.5) * 0.6) * (sim.W / count);
      const sr = Art.spr(root, "Shaft", A.Shaft(), Pal.hex(0xffe2b0).withAlpha(0.1), 1, -95, Art.Additive);
      sr.transform.localScale = new V3(2.2 + A.hash(i, 3, 5) * 1.6, sim.H * 0.32, 1);
      sr.transform.localPosition = new V3(x, sim.H * 0.55, 0);
      sr.transform.localEulerZ = -14 + A.hash(i, 9, 1) * 8;
      this.shafts.push({ sr, phase: A.hash(i, 4, 4) * 6, a: 0.07 + A.hash(i, 6, 6) * 0.05 });
    }
    // torches on open back walls, two tiles above a floor
    let lastX = -99;
    for (let cx = 2; cx < sim.W - 2; cx++)
      for (let cy = 1; cy < sim.H - 3; cy++) {
        if (!sim.solidTile(cx, cy - 1) || sim.solidTile(cx, cy) || sim.solidTile(cx, cy + 1) || sim.solidTile(cx, cy + 2)) continue;
        if (cx - lastX < 6 || A.hash(cx, cy, 77) < 0.55) continue;
        if (sim.doors.some((d) => Math.abs(d.x - cx) < 2 && Math.abs(d.y - cy) < 2)) continue;
        lastX = cx;
        const x = cx + 0.5, y = cy + 1.7;
        const glow = Art.spr(root, "TorchGlow", Art.Glow, Pal.hex(0xff9a40).withAlpha(0.45), 4.2, -90, Art.Additive);
        glow.transform.localPosition = new V3(x, y + 0.2, 0);
        Art.spr(root, "Torch", A.TorchBracket(), Color.white, 0.42, -89, Art.Flat).transform.localPosition = new V3(x, y - 0.25, 0);
        const flame = Art.spr(root, "Flame", A.TorchFlame(0), Color.white, 0.5, -88, Art.Additive);
        flame.transform.localPosition = new V3(x, y + 0.22, 0);
        this.torches.push({ flame, glow, phase: A.hash(cx, cy, 3) * 10, x, y });
        break;
      }
    // doors
    for (const d of sim.doors) {
      const tint = d.kind === Hero.Ember ? A.Palette.Ember : A.Palette.Ripple;
      const inside = Art.spr(root, "DoorInside", A.DoorInside(), tint.withAlpha(0.9), 1.32, -73, Art.Flat);
      inside.transform.localPosition = new V3(d.x + 0.5, d.y + 1.03, 0);
      const panel = Art.spr(root, "DoorPanel", A.DoorPanel(d.kind), Color.white, 1.32, -72, Art.Flat);
      const frame = Art.spr(root, "DoorFrame", A.DoorFrame(d.kind), Color.white, 1.5, -71, Art.Flat);
      frame.transform.localPosition = new V3(d.x + 0.5, d.y + 1.094, 0);
      this.doorViews.push({ panel, inside, open: 0, x: d.x + 0.5, y: d.y });
    }
    // sliding stones
    for (const m of sim.movers) {
      const col = m.trigger ? A.Palette.channel(m.trigger) : Pal.hex(0xd8b25a);
      const sr = Art.spr(root, "Stone " + m.letter, A.moverSprite(m.w, m.h, col, m.loop), Color.white, 1, -60, Art.Flat);
      this.moverViews.push(sr);
    }
    for (const t of sim.triggers) {
      const col = A.Palette.channel(t.letter);
      if (t.lever) {
        Art.spr(root, "LeverBase", A.LeverBase(), Color.white, 0.8, -40, Art.Flat).transform.localPosition = new V3(t.x + 0.5, t.y + 0.2, 0);
        const pivot = new GameObject("LeverPivot", root);
        pivot.localPosition = new V3(t.x + 0.5, t.y + 0.16, 0);
        Art.spr(pivot, "Stick", A.LeverStick(), Color.white, 0.42, -41, Art.Flat).transform.localPosition = new V3(0, 0.38, 0);
        Art.spr(pivot, "Knob", CasualArt.Dot, col, 0.2, -40, Art.Flat).transform.localPosition = new V3(0, 0.7, 0);
        this.leverViews.push({ pivot, angle: 35 });
      } else {
        Art.spr(root, "ButtonBase", A.ButtonBase(), Color.white, 0.9, -40, Art.Flat).transform.localPosition = new V3(t.x + 0.5, t.y + 0.1, 0);
        const plate = Art.spr(root, "Plate", A.ButtonPlate(), col, 0.78, -41, Art.Flat);
        this.buttonViews.push({ plate, press: 0, y: t.y });
        plate.transform.localPosition = new V3(t.x + 0.5, t.y + 0.2, 0);
      }
    }
    for (let i = 0; i < sim.blocks.length; i++) this.blockViews.push(Art.spr(root, "Block", A.BlockSprite(), Color.white, 0.98, 0, Art.Flat));
    for (const g of sim.gems) {
      const tint = g.kind === Hero.Ember ? Pal.hex(0xff4a5a) : Pal.hex(0x3aa0ff);
      const glow = Art.spr(root, "GemGlow", Art.Glow, tint.withAlpha(0.55), 1.4, 9, Art.Additive);
      const sr = Art.spr(glow.gameObject, "Gem", A.GemSprite(g.kind), Color.white, 0.56, 10, Art.Flat);
      sr.transform.localScale = new V3(0.56 / 1.4, 0.56 / 1.4, 1);
      glow.transform.localPosition = new V3(g.x, g.y, 0);
      this.gemViews.push({ sr: glow, glow, phase: A.hash(Math.floor(g.x), Math.floor(g.y), 1) * 6 });
    }
    for (const f of sim.fans) Art.spr(root, "Vent", A.VentSprite(), Color.white, 0.94, -45, Art.Flat).transform.localPosition = new V3(f.x + 0.5, f.y + 0.82, 0);
    for (let cy = 0; cy < sim.H; cy++)
      for (let cx = 0; cx < sim.W; cx++) {
        const t = sim.tile(cx, cy);
        if (t !== Tile.Lava && t !== Tile.Water && t !== Tile.Goo) continue;
        const sr = Art.spr(root, "Liquid", A.LiquidSprite(t, 0), Color.white, 1.0, 40, Art.Flat);
        sr.transform.localScale = new V3(1.02, 1, 1);
        sr.transform.localPosition = new V3(cx + 0.5, cy + 1 - 0.375 + 0.07, 0);
        let glow: SpriteRenderer | null = null;
        if (t !== Tile.Water) {
          glow = Art.spr(root, "LiquidGlow", Art.Glow, (t === Tile.Lava ? Pal.hex(0xff6a1a) : Pal.hex(0x8cff3a)).withAlpha(0.32), 2.4, 41, Art.Additive);
          glow.transform.localPosition = new V3(cx + 0.5, cy + 1.05, 0);
        }
        this.liquids.push({ sr, t, x: cx, glow });
      }
    this.SyncViews(0);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    CasualLook.fitCover(this.cover, this.ViewSize, this.camPos);
    const touch = this.touchUI && this.State === Phase.Playing;
    if (this.touchRoot.activeSelf !== touch) this.touchRoot.setActive(touch);
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.CloseGrid();
    this.RefreshPath();
    this.StartAttract();
    Sfx.setIntensity(0.1);
    this.SetLoops(0, 0, 0, 0);
  }

  private StartAttract() {
    this.LoadLevel(this.Selected);
    this.driver = new PlanDriver(PLANS[this.level - 1] ?? []);
    this.attractEnd = 0;
  }

  protected BeginRun() {
    this.CloseGrid();
    this.driver = null;
    this.touchUI = this.touchUI || this.Controls.usingTouch || isMobilePlatform() || Touchscreen.present;
    this.LoadLevel(this.Selected);
    this.deaths = 0;
    this.active = 0;
    this.skipButton.node.setActive(false);
    this.Data.add("runs", 1);
    this.UI.Announce(`${this.level}. ${LEVELS[this.level - 1].name.toUpperCase()}`, Orange, 1.6);
    const tip = LEVELS[this.level - 1].tip;
    if (this.level === 1) this.UI.Toast(this.touchUI ? "◀ ▶ move, JUMP jumps. SWAP switches between Ember and Ripple." : "EMBER: ← → and ↑ to jump.   RIPPLE: A D and W to jump.", 7);
    else if (tip) this.UI.Toast(tip, 5);
    Sfx.setIntensity(0.35);
    this.Layout();
    this.RespawnFx();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.State === Phase.Title && this.driver) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= Phys.Dt && n++ < 8) {
        this.acc -= Phys.Dt;
        const done = this.sim.won || this.sim.dead >= 0 || this.driver.done || !!this.driver.failed;
        if (done) { this.attractEnd += Phys.Dt; continue; }
        const inp = this.driver.update(snapshot(this.sim), Phys.Dt);
        this.sim.step(inp);
        this.HandleEvents(this.sim.events, true);
      }
      if (this.attractEnd > 2.2) this.StartAttract();
    }
    this.SyncViews(dt);
    this.UpdateCamera(dt);
    this.SetLoops(0, 0, 0, 0);
  }

  protected TickRun(dt: number) {
    if (AdService.isShowing) return;
    this.DetectTouch();
    if (Gamepad.connected && (Gamepad.leftShoulder.wasPressedThisFrame || Gamepad.rightShoulder.wasPressedThisFrame || Gamepad.buttonNorth.wasPressedThisFrame)) this.Swap();
    const inputs = this.ReadInputs();
    this.modeT += dt;
    if (this.mode === Mode.Play) {
      this.acc = Math.min(this.acc + dt, Phys.Dt * 10);
      while (this.acc >= Phys.Dt) {
        this.acc -= Phys.Dt;
        this.sim.step(inputs);
        this.HandleEvents(this.sim.events, false);
        if (this.mode !== Mode.Play) break;
      }
    } else if (this.mode === Mode.Dying && this.modeT >= RespawnDelay) {
      this.ResetSim();
      this.RespawnFx();
    } else if (this.mode === Mode.Winning && this.modeT >= WinDelay) {
      this.mode = Mode.Done;
      this.Win();
      return;
    }
    this.SyncViews(dt);
    this.UpdateCamera(dt);
    this.UpdateHud();
    this.UpdateLoops();
  }

  private DetectTouch() {
    const touching = Touchscreen.touches.some((t) => t.press.isPressed);
    if (touching && !this.touchUI) { this.touchUI = true; this.Layout(); }
  }

  private ReadInputs(): HeroInput[] {
    const K = Keyboard;
    const e: HeroInput = { left: K.left.isPressed, right: K.right.isPressed, jump: K.up.isPressed };
    const r: HeroInput = { left: K.letter("a").isPressed, right: K.letter("d").isPressed, jump: K.letter("w").isPressed };
    const out = [e, r];
    const a = out[this.active];
    if (Gamepad.connected) {
      const x = Gamepad.leftStick.x + Gamepad.dpad.x;
      a.left ||= x < -0.35;
      a.right ||= x > 0.35;
      a.jump ||= Gamepad.buttonSouth.isPressed || Gamepad.buttonEast.isPressed;
    }
    if (this.touchUI) {
      const t = this.ReadTouchPads();
      a.left ||= t.left;
      a.right ||= t.right;
      a.jump ||= t.jump;
    }
    return out;
  }

  private ReadTouchPads(): HeroInput {
    const res: HeroInput = { ...NoInput };
    const inPad = (p: TouchPad, c: V2, pad: number) => {
      const r = p.node.canvasRect();
      return c.x >= r.x - pad && c.x <= r.x + r.w + pad && c.y >= r.y - pad && c.y <= r.y + r.h + pad;
    };
    let l = false, rr = false, j = false;
    for (const t of Touchscreen.touches) {
      if (!t.press.isPressed) continue;
      const c = UI.screenToCanvas(t.position);
      // left/right split at the gap between the two pads so sliding a thumb across works
      const lr = this.padL.node.canvasRect(), rrect = this.padR.node.canvasRect();
      const mid = (lr.x + lr.w + rrect.x) / 2;
      if (inPad(this.padL, c, 40) || inPad(this.padR, c, 40)) { if (c.x < mid) l = true; else rr = true; }
      if (inPad(this.padJ, c, 50)) j = true;
    }
    res.left = l; res.right = rr; res.jump = j;
    this.padL.held = l; this.padR.held = rr; this.padJ.held = j;
    return res;
  }

  private Swap() {
    if (this.State !== Phase.Playing) return;
    this.active ^= 1;
    Sfx.playClip(this.clips.swap, 0.8);
    const h = this.sim.heroes[this.active];
    this.fx.sparkle(new V2(h.cx, h.y + 0.6), this.active === 0 ? Orange : Cyan, 6, 0.5, 0.25);
    this.views[this.active].squash = 0.6;
  }

  // ------------------------------------------------------------------ events

  private HandleEvents(events: SimEvent[], attract: boolean) {
    const vol = attract ? 0 : 1;
    for (const ev of events) {
      switch (ev.type) {
        case "jump": {
          Sfx.playClip(ev.hero === Hero.Ember ? this.clips.jumpE : this.clips.jumpR, 0.7 * vol, 0.95 + Math.random() * 0.1);
          const h = this.sim.heroes[ev.hero];
          this.Puff(new V2(h.cx, h.y), ev.hero, 5);
          break;
        }
        case "land": {
          const v = this.views[ev.hero];
          v.squash = Mathf.clamp01(ev.speed / 15);
          if (ev.speed > 6) {
            Sfx.playClip(this.clips.land, Mathf.clamp01(ev.speed / 16) * 0.8 * vol);
            const h = this.sim.heroes[ev.hero];
            this.Puff(new V2(h.cx, h.y), ev.hero, Math.round(ev.speed / 3));
          }
          break;
        }
        case "gem": {
          const tint = ev.hero === Hero.Ember ? Pal.hex(0xff5a6a) : Pal.hex(0x5ab4ff);
          this.fx.sparkle(new V2(ev.x, ev.y), tint, 8, 0.5, 0.3);
          this.fx.pop(new V2(ev.x, ev.y), Color.white, 10, 3, 0.12, 0.35);
          for (let i = 0; i < this.sim.gems.length; i++) if (this.sim.gems[i].taken) this.gemViews[i].sr.gameObject.setActive(false);
          if (!attract) {
            Sfx.playClip(this.clips.gem, 0.9, 1 + (this.sim.gemTaken[ev.hero] - 1) * 0.06);
            this.UI.Float(new V2(ev.x, ev.y + 0.4), "+1", tint, 0.8);
            this.Data.add("gems", 1);
            Fx.haptic();
          }
          break;
        }
        case "trigger":
          Sfx.playClip(ev.lever ? this.clips.clack : this.clips.click, 0.6 * vol, ev.on ? 1.1 : 0.85);
          break;
        case "door":
          if (ev.inside) {
            Sfx.playClip(this.clips.door, 0.5 * vol, ev.hero === Hero.Ember ? 1 : 1.25);
            const d = this.sim.doors.find((x) => x.kind === ev.hero);
            if (d) this.fx.sparkle(new V2(d.x + 0.5, d.y + 1.2), ev.hero === 0 ? Orange : Cyan, 6, 0.6, 0.25);
          }
          break;
        case "blockLand":
          Sfx.playClip(this.clips.thud, Mathf.clamp01(ev.speed / 14) * vol);
          this.fx.pop(new V2(ev.x, ev.y), Pal.hex(0xb7a68a), 8, 2.5, 0.14, 0.4);
          if (!attract) this.Fx.shake(0.12);
          break;
        case "die":
          this.Die(ev.hero, ev.cause, attract);
          break;
        case "win":
          if (!attract) this.OnWin();
          else this.attractEnd = 0.6;
          break;
      }
    }
  }

  private Puff(p: V2, hero: number, n: number) {
    const tint = hero === 0 ? Pal.hex(0xffb070) : Pal.hex(0xbfefff);
    for (let i = 0; i < n; i++) this.fx.emit(p.add(new V2((Math.random() - 0.5) * 0.4, 0.05)), new V2((Math.random() - 0.5) * 2.4, Math.random() * 1.2), tint.withAlpha(0.7), 0.12 + Math.random() * 0.08, 0.35, null, 0, 0, true, 3);
  }

  private Die(hero: number, cause: Tile, attract: boolean) {
    const h = this.sim.heroes[hero];
    const p = new V2(h.cx, h.y + 0.4);
    const ember = hero === Hero.Ember;
    // Ember in water: a burst of steam. Ripple in lava: boiling bubbles. Goo: green splat.
    const steam = cause === Tile.Water || (cause === Tile.Goo && ember);
    for (let i = 0; i < 26; i++) {
      const v = new V2((Math.random() - 0.5) * 4, 1.5 + Math.random() * 4);
      const c = cause === Tile.Goo ? Pal.hex(0x9cff5a) : steam ? new Color(0.92, 0.95, 1, 0.8) : Pal.hex(0x8fdcff);
      this.fx.emit(p, v, c, 0.18 + Math.random() * 0.2, 0.7 + Math.random() * 0.4, steam ? CasualArt.Soft : A.Bubble(), steam ? -2 : 6, 0, true, 1.2);
    }
    this.fx.pop(p, ember ? Orange : Cyan, 16, 5, 0.2, 0.5);
    if (attract) return;
    Sfx.playClip(cause === Tile.Goo ? this.clips.goo : ember ? this.clips.steam : this.clips.sizzle, 0.9);
    Sfx.play(Snd.Hurt, 0.4);
    this.Fx.shake(0.35);
    this.Hitstop(0.06);
    Fx.haptic(true);
    this.mode = Mode.Dying;
    this.modeT = 0;
    this.deaths++;
    this.Data.add("deaths", 1);
    const name = ember ? "EMBER" : "RIPPLE";
    const why = cause === Tile.Goo ? "MELTED IN GOO!" : ember ? "PUT OUT BY WATER!" : "BOILED IN LAVA!";
    this.UI.Announce(`${name} ${why}`, ember ? Orange : Cyan, 1.0);
    if (this.deaths >= 3) {
      this.skipButton.node.setActive(true);
      if (this.deaths === 3) this.UI.Toast(AdService.rewardedAvailable ? "Stuck? Get a HINT, or SKIP this chamber with a short ad." : "Stuck? Tap HINT for a tip.", 5);
    }
  }

  private RespawnFx() {
    for (let k = 0; k < 2; k++) {
      const h = this.sim.heroes[k];
      this.views[k].spawn = 1;
      this.fx.sparkle(new V2(h.cx, h.y + 0.5), k === 0 ? Orange : Cyan, 10, 0.6, 0.3);
      this.Fx.ring(new V2(h.cx, h.y + 0.45), (k === 0 ? Orange : Cyan).withAlpha(0.6), 0.2, 1.6, 0.45);
    }
    Sfx.playClip(this.clips.respawn, 0.6);
  }

  // ------------------------------------------------------------------ win / results

  private OnWin() {
    this.mode = Mode.Winning;
    this.modeT = 0;
    Sfx.play(Snd.Win, 0.8);
    for (const d of this.sim.doors) this.fx.confetti(new V2(d.x + 0.5, d.y + 1.6), 26, 6, [Orange, Cyan, Gold, Color.white]);
    this.UI.Announce("CHAMBER CLEARED!", Gold, 1.4);
  }

  private Stars() {
    const s = this.sim;
    return 1 + (s.allGems ? 1 : 0) + (s.time <= LEVELS[this.level - 1].par ? 1 : 0);
  }

  private Win() {
    const n = this.level, s = this.sim, def = LEVELS[n - 1];
    const stars = this.Stars();
    const prevStars = this.Data.get("s" + n);
    if (stars > prevStars) this.Data.set("s" + n, stars);
    if (prevStars === 0) this.Data.add("cleared", 1);
    const ms = Math.round(s.time * 1000);
    const newBest = this.Data.min("t" + n, ms) && prevStars > 0;
    this.Data.max("u", Math.min(LEVELS.length, n + 1));
    const last = n >= LEVELS.length;
    this.Data.set("sel", last ? n : n + 1);
    const gems = `${s.gemTaken[0] + s.gemTaken[1]}/${s.gemTotal[0] + s.gemTotal[1]}`;
    const best = this.Data.get("t" + n) / 1000;
    this.Finish(new Result({
      Headline: last ? "THE TEMPLE IS YOURS!" : `${n}. ${def.name.toUpperCase()}`,
      HeadlineColor: Gold,
      Stars: stars,
      Value: Fmt.clock(s.time),
      NewBest: newBest,
      BestLine: s.allGems ? (stars === 3 ? "PERFECT! ALL GEMS, UNDER PAR" : `PAR TIME ${Fmt.clock(def.par)}`) : "FIND EVERY GEM FOR A STAR",
      Stats: [
        ["TIME", TimeText(s.time)],
        ["GEMS", gems],
        ["BEST", TimeText(best)],
        ["STARS", `${this.TotalStars()}/${LEVELS.length * 3}`],
      ],
      Primary: last ? "PLAY AGAIN" : "NEXT LEVEL",
      Victory: true,
    }));
  }

  private OnSkip() {
    if (this.State !== Phase.Playing || this.mode !== Mode.Play && this.mode !== Mode.Dying) return;
    if (!AdService.rewardedAvailable) { this.UI.Toast("No video available right now. Try a HINT!", 2.5); Sfx.play(Snd.Deny, 0.6); return; }
    AdService.showRewarded((ok) => {
      if (!ok || this.State !== Phase.Playing) return;
      const n = this.level, last = n >= LEVELS.length;
      this.Data.max("u", Math.min(LEVELS.length, n + 1));
      this.Data.set("sel", last ? n : n + 1);
      this.Data.set("skip" + n, 1);
      this.mode = Mode.Done;
      this.Finish(new Result({
        Headline: "CHAMBER SKIPPED",
        HeadlineColor: Pal.hex(0xffd9a0),
        Value: "→",
        Stars: this.Data.get("s" + n),
        BestLine: last ? "THAT WAS THE LAST CHAMBER" : `ON TO CHAMBER ${n + 1}: ${LEVELS[n].name.toUpperCase()}`,
        Stats: [["DEATHS", String(this.deaths)], ["STARS", `${this.TotalStars()}/${LEVELS.length * 3}`]],
        Primary: last ? "PLAY AGAIN" : "NEXT LEVEL",
      }));
    });
  }

  private OnHint() {
    if (this.State !== Phase.Playing) return;
    const n = this.level, hint = LEVELS[n - 1].hint;
    if (this.Data.get("h" + n) > 0) { this.UI.Toast("HINT: " + hint, 9); return; }
    if (!AdService.rewardedAvailable) {
      // no ad to show: be generous rather than leave the player stuck
      this.Data.set("h" + n, 1);
      this.UI.Toast("HINT: " + hint, 9);
      return;
    }
    AdService.showRewarded((ok) => {
      if (!ok) { this.UI.Toast("Watch the whole video to unlock the hint.", 2.5); return; }
      this.Data.set("h" + n, 1);
      this.UI.Toast("HINT: " + hint, 9);
      Sfx.play(Snd.PowerUp, 0.6);
    });
  }

  // ------------------------------------------------------------------ views

  private SyncViews(dt: number) {
    const sim = this.sim, time = Time.time;
    for (let k = 0; k < 2; k++) this.SyncHero(k, sim.heroes[k], dt, time);
    for (let i = 0; i < sim.movers.length; i++) {
      const m = sim.movers[i];
      this.moverViews[i].transform.localPosition = new V3(m.x + m.w / 2, m.y + m.h / 2, 0);
    }
    for (let i = 0; i < sim.blocks.length; i++) {
      const b = sim.blocks[i];
      this.blockViews[i].transform.localPosition = new V3(b.cx, b.cy, 0);
    }
    let bi = 0, li = 0;
    for (const t of sim.triggers) {
      if (t.lever) {
        const lv = this.leverViews[li++];
        lv.angle = Mathf.lerp(lv.angle, t.on ? -35 : 35, 1 - Math.exp(-dt * 18));
        lv.pivot.localEulerZ = lv.angle;
      } else {
        const bv = this.buttonViews[bi++];
        bv.press = Mathf.moveTowards(bv.press, t.on ? 1 : 0, dt * 8);
        const p = bv.plate.transform.localPosition;
        bv.plate.transform.localPosition = new V3(p.x, bv.y + 0.2 - 0.09 * bv.press, 0);
        bv.plate.color = Color.lerp(A.Palette.channel(t.letter), Color.white, t.on ? 0.25 + 0.15 * Math.sin(time * 8) : 0);
      }
    }
    for (let i = 0; i < sim.gems.length; i++) {
      const g = sim.gems[i], v = this.gemViews[i];
      if (g.taken) continue;
      v.sr.transform.localPosition = new V3(g.x, g.y + 0.08 * Math.sin(time * 2.6 + v.phase), 0);
      const s = 1.4 * (1 + 0.08 * Math.sin(time * 4 + v.phase));
      v.glow.transform.localScale = new V3(s, s, 1);
    }
    for (let i = 0; i < this.doorViews.length; i++) {
      const d = this.doorViews[i], h = sim.heroes[sim.doors[i].kind];
      const target = this.mode === Mode.Winning || this.mode === Mode.Done ? 1 : h.inDoor ? 0.55 : 0;
      d.open = Mathf.moveTowards(d.open, target, dt * 1.8);
      const k = 1 - d.open, H = 2.06;
      d.panel.transform.localScale = new V3(1.32, 1.32 * Math.max(0.02, k), 1);
      d.panel.transform.localPosition = new V3(d.x, d.y + H - (H * k) / 2, 0);
      d.inside.color = d.inside.color.withAlpha(0.35 + 0.6 * d.open + 0.05 * Math.sin(time * 5));
    }
    const frame = Math.floor(time * 9) % 8;
    for (const l of this.liquids) {
      l.sr.sprite = A.LiquidSprite(l.t, (frame + l.x) % 8);
      if (l.glow) l.glow.color = l.glow.color.withAlpha(0.22 + 0.1 * Math.sin(time * 3 + l.x * 1.7));
      if (dt > 0 && l.t !== Tile.Water && Math.random() < dt * 0.35) {
        const c = l.t === Tile.Lava ? Pal.hex(0xffb040) : Pal.hex(0xb6ff6a);
        this.fx.emit(new V2(l.x + 0.2 + Math.random() * 0.6, sim.H > 0 ? this.LiquidTop(l) : 0), new V2(0, 0.6 + Math.random() * 0.6), c, 0.1 + Math.random() * 0.08, 0.6, A.Bubble(), -0.5, 0, true, 1);
      }
    }
    for (const t of this.torches) {
      t.flame.sprite = A.TorchFlame(Math.floor(time * 10 + t.phase) % 3);
      const f = 0.85 + 0.15 * Math.sin(time * 11 + t.phase) * Math.sin(time * 7.3 + t.phase * 2);
      t.glow.color = t.glow.color.withAlpha(0.5 * f);
      t.glow.transform.localScale = new V3(4.2 * f, 4.2 * f, 1);
      if (dt > 0 && Math.random() < dt * 2) this.fx.emit(new V2(t.x + (Math.random() - 0.5) * 0.15, t.y + 0.4), new V2((Math.random() - 0.5) * 0.4, 0.9 + Math.random()), Pal.hex(0xffc060), 0.05, 0.7, A.Spark(), -0.3, 0, true, 0.5);
    }
    for (const s of this.shafts) s.sr.color = s.sr.color.withAlpha(s.a * (0.75 + 0.25 * Math.sin(time * 0.7 + s.phase)));
    // wind wisps over open vents
    for (const f of sim.fans) {
      if (sim.fanBlocked(f) || dt <= 0 || Math.random() > dt * 9) continue;
      this.fx.emit(new V2(f.x + 0.2 + Math.random() * 0.6, f.y + 1.1), new V2(0, 4 + Math.random() * 2), new Color(1, 1, 1, 0.22), 0.16, (f.top - f.y - 1) / 5, A.Wisp(), 0, 0, false, 0.2);
    }
    // marker over the controlled spirit (phones / gamepad only)
    const show = this.State === Phase.Playing && (this.touchUI || Gamepad.connected) && this.mode === Mode.Play;
    this.marker.gameObject.setActive(show);
    if (show) {
      const h = sim.heroes[this.active];
      this.marker.transform.localPosition = new V3(h.cx, h.y + 1.62 + 0.08 * Math.sin(time * 5), 0);
      this.marker.transform.localEulerZ = 180;
      this.marker.color = (this.active === 0 ? Orange : Cyan).withAlpha(0.95);
    }
  }

  private LiquidTop(l: { x: number }) {
    for (let cy = this.sim.H - 1; cy >= 0; cy--) { const t = this.sim.tile(l.x, cy); if (t === Tile.Lava || t === Tile.Water || t === Tile.Goo) { if (this.sim.tile(l.x, cy + 1) === Tile.Air) return cy + 0.95; } }
    return 0;
  }

  private SyncHero(k: number, h: HeroBody, dt: number, time: number) {
    const v = this.views[k], ember = k === 0;
    const visible = h.alive;
    v.root.setActive(visible);
    if (!visible) return;
    v.spawn = Mathf.moveTowards(v.spawn, 0, dt * 2.6);
    v.squash = Mathf.moveTowards(v.squash, 0, dt * 5);
    const winning = this.mode === Mode.Winning || this.mode === Mode.Done;
    v.fade = Mathf.moveTowards(v.fade, winning && h.inDoor ? 0 : 1, dt * 1.2);
    v.root.localPosition = new V3(h.cx, h.y, 0);
    const moving = Math.abs(h.vx) > 0.4 && h.grounded;
    const air = !h.grounded;
    let sx = 1, sy = 1;
    if (air) { const st = Mathf.clamp(h.vy / 13, -1, 1); sy += 0.13 * Math.abs(st); sx -= 0.09 * Math.abs(st); }
    sy -= 0.28 * v.squash; sx += 0.22 * v.squash;
    sy += 0.03 * Math.sin(time * 3.2 + k);
    const bob = moving ? Math.abs(Math.sin(time * 15 + k)) * 0.07 : 0;
    const appear = 1 - v.spawn * v.spawn;
    const fadeS = 0.45 + 0.55 * v.fade;
    const s = 1.1 * appear * fadeS;
    v.body.transform.localScale = new V3(s * sx * (h.facing < 0 ? 1 : 1), s * sy, 1);
    v.body.transform.localPosition = new V3(0, 0.47 * s * sy + bob, 0);
    v.body.transform.localEulerZ = -h.vx * 1.4 + (h.pushing ? -h.facing * 6 : 0);
    v.body.color = Color.white.withAlpha(v.fade);
    // face: eyes look where we go; blink now and then
    v.blinkIn -= dt;
    if (v.blinkIn <= 0) { v.blink = 0.13; v.blinkIn = 2 + Math.random() * 3; }
    v.blink = Math.max(0, v.blink - dt);
    const look = Mathf.clamp(h.vx / Phys.Run, -1, 1) * 0.06 + h.facing * 0.04;
    const lookY = air ? Mathf.clamp(h.vy / 14, -1, 1) * 0.04 : 0;
    const eyeY = ember ? -0.02 : -0.08;
    for (let i = 0; i < 2; i++) {
      const ex = (i === 0 ? -0.17 : 0.17) + look;
      v.eyes[i].transform.localPosition = new V3(ex, eyeY, 0);
      v.eyes[i].transform.localScale = new V3(0.2, 0.2 * (v.blink > 0 ? 0.12 : 1), 1);
      v.pupils[i].transform.localPosition = new V3(ex + look * 0.9, eyeY - 0.02 + lookY, 0);
      v.pupils[i].transform.localScale = new V3(0.12, 0.12 * (v.blink > 0 ? 0.1 : 1), 1);
      v.eyes[i].color = Color.white.withAlpha(v.fade);
      v.pupils[i].color = Color.white.withAlpha(v.fade);
    }
    v.mouth.transform.localPosition = new V3(look * 0.8, ember ? -0.22 : -0.28, 0);
    v.mouth.transform.localScale = new V3(air ? 0.14 : 0.2, air ? 0.2 : 0.14, 1);
    v.mouth.color = Color.white.withAlpha(v.fade);
    // hair: flame flicker / water curl sway
    const frame = Math.floor(time * (ember ? 12 : 6) + k) % 3;
    if (ember) {
      v.hair.sprite = A.EmberFlame(frame);
      const fl = 1 + 0.08 * Math.sin(time * 23) + (air ? 0.12 : 0) + Math.min(0.2, Math.abs(h.vx) * 0.03);
      v.hair.transform.localScale = new V3(0.78 * s * sx, 0.78 * s * fl, 1);
      v.hair.transform.localPosition = new V3(-h.vx * 0.025, (0.47 + 0.42) * s * sy + bob, 0);
      v.hair.transform.localEulerZ = -h.vx * 3.5;
      v.hair.color = Color.white.withAlpha(v.fade);
    } else {
      v.hair.sprite = A.RippleCurl(frame);
      v.hair.transform.localScale = new V3(0.5 * s * sx, 0.5 * s, 1);
      v.hair.transform.localPosition = new V3(-h.vx * 0.02 + 0.02, (0.47 + 0.37) * s * sy + bob, 0);
      v.hair.transform.localEulerZ = -h.vx * 4 + 8 * Math.sin(time * 3);
      v.hair.color = A.Palette.RippleLight.withAlpha(0.9 * v.fade);
    }
    const inDoor = h.inDoor ? 1 : 0;
    const gs = 2.4 + 0.25 * Math.sin(time * (ember ? 9 : 3)) + inDoor * 0.8 + v.spawn * 2;
    v.glow.transform.localScale = new V3(gs, gs, 1);
    v.glow.color = (ember ? A.Palette.Ember : A.Palette.Ripple).withAlpha((ember ? 0.42 : 0.3) * v.fade + inDoor * 0.2);
    // ambient particles: sparks for Ember, bubbles for Ripple
    if (dt > 0 && v.fade > 0.5) {
      v.trail -= dt * (1 + Math.abs(h.vx) * 0.5);
      if (v.trail <= 0) {
        v.trail = ember ? 0.09 : 0.22;
        if (ember) this.fx.emit(new V2(h.cx + (Math.random() - 0.5) * 0.4, h.y + 0.9), new V2(-h.vx * 0.15 + (Math.random() - 0.5) * 0.6, 1.4 + Math.random()), Math.random() < 0.5 ? Pal.hex(0xffd04a) : Pal.hex(0xff7020), 0.07 + Math.random() * 0.05, 0.55, A.Spark(), -0.6, 0, true, 0.8);
        else this.fx.emit(new V2(h.cx + (Math.random() - 0.5) * 0.5, h.y + 0.3 + Math.random() * 0.5), new V2(-h.vx * 0.1 + (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.5), A.Palette.RippleLight.withAlpha(0.8), 0.07 + Math.random() * 0.06, 0.8, A.Bubble(), -0.4, 0, true, 1);
      }
    }
  }

  // ------------------------------------------------------------------ camera

  private UpdateCamera(dt: number) {
    const sim = this.sim;
    if (!sim) return;
    const playing = this.State === Phase.Playing || this.State === Phase.Paused;
    const touch = this.touchUI && playing;
    const top = TopBand, bottom = touch ? TouchBand : DeskBand;
    const portrait = Screen.width < Screen.height;
    const level = new V2(sim.W - 0.6, sim.H - 0.6);
    const fit = ArcadeGame.FitShortSide(level, top, bottom);
    const maxShort = portrait ? 13 : 21, minShort = portrait ? 10 : 16;
    let short: number, center: V2;
    if (fit <= maxShort) {
      short = fit;
      center = new V2(sim.W / 2, sim.H / 2);
    } else {
      const hs = sim.heroes.filter((h) => h.alive);
      const pts = hs.length ? hs : sim.heroes;
      let x0 = Math.min(...pts.map((h) => h.cx)), x1 = Math.max(...pts.map((h) => h.cx));
      let y0 = Math.min(...pts.map((h) => h.y)), y1 = Math.max(...pts.map((h) => h.y + 1));
      let need = new V2(x1 - x0 + 7, y1 - y0 + 5);
      short = Mathf.clamp(ArcadeGame.FitShortSide(need, top, bottom), minShort, maxShort);
      if (ArcadeGame.FitShortSide(need, top, bottom) > maxShort && (touch || this.State === Phase.Title)) {
        // too far apart for one view: follow the spirit under control
        const h = sim.heroes[this.active];
        x0 = x1 = h.cx; y0 = h.y; y1 = h.y + 1;
        need = new V2(7, 5);
        short = maxShort;
      }
      center = new V2((x0 + x1) / 2, (y0 + y1) / 2 + 0.6);
    }
    if (!this.camInit || dt <= 0) { this.camShort = short; this.zoomVel.v = 0; }
    else this.camShort = Mathf.smoothDamp(this.camShort, short, this.zoomVel, 0.45, Math.min(dt, 0.05));
    // visible gameplay rect (world units, relative to the camera) for the current zoom
    const rect = this.PlayRect(top, bottom, 0);
    const w = rect.width, h = rect.height;
    const clampAxis = (c: number, size: number, view: number) => (view >= size ? size / 2 : Mathf.clamp(c, view / 2 - 0.1, size - view / 2 + 0.1));
    const target = new V2(clampAxis(center.x, sim.W, w), clampAxis(center.y, sim.H, h));
    const camTarget = target.sub(rect.center);
    if (!this.camInit || dt <= 0) { this.camPos = camTarget; this.camInit = true; }
    else this.camPos = V2.lerp(this.camPos, camTarget, 1 - Math.exp(-dt * 4.5));
    this.Fx.CameraTarget = this.camPos;
    CasualLook.fitCover(this.cover, this.ViewSize, this.camPos);
  }

  // ------------------------------------------------------------------ HUD + audio

  private UpdateHud() {
    const s = this.sim;
    SetText(this.levelText, `LEVEL ${this.level}`);
    SetText(this.nameText, LEVELS[this.level - 1].name.toUpperCase());
    SetText(this.timeText, `${TimeText(s.time)}   ·   PAR ${Fmt.clock(LEVELS[this.level - 1].par)}`);
    this.timeText.color = s.time <= LEVELS[this.level - 1].par ? Color.white.withAlpha(0.9) : Pal.hex(0xffb0a0);
    for (let k = 0; k < 2; k++) SetText(this.gemText[k], `${s.gemTaken[k]}/${s.gemTotal[k]}`);
    const hintOwned = this.Data.get("h" + this.level) > 0;
    SetText(this.hintButton.label, hintOwned || !AdService.rewardedAvailable ? "HINT" : "HINT ▶");
    if (this.skipButton.node.activeSelf) {
      SetText(this.skipButton.label, AdService.rewardedAvailable ? "SKIP ▶ AD" : "SKIP");
      this.skipButton.interactable = AdService.rewardedAvailable;
    }
    if (this.touchRoot.activeSelf) {
      for (const p of [this.padL, this.padR, this.padJ]) {
        p.bg.color = p.held ? new Color(1, 1, 1, 0.3) : new Color(0.1, 0.06, 0.12, 0.55);
        p.node.localScale = p.held ? new V3(0.94, 0.94, 1) : V3.one;
      }
      this.swapIcon.sprite = this.active === 0 ? A.EmberBody() : A.RippleBody();
      this.swapButton.setAccent(this.active === 0 ? Orange : Cyan);
    }
  }

  private UpdateLoops() {
    const s = this.sim;
    let stone = 0, wind = 0, scrape = 0, lava = 0;
    for (const m of s.movers) if (m.dx !== 0 || m.dy !== 0) stone = Math.max(stone, m.loop ? 0.12 : 0.35);
    for (const b of s.blocks) { if (Math.abs(b.pushed) > 0) scrape = 0.5; b.pushed = 0; }
    const near = (x: number, y: number, r: number) => Math.max(0, ...s.heroes.map((h) => 1 - Math.hypot(h.cx - x, h.y - y) / r));
    for (const f of s.fans) if (!s.fanBlocked(f)) wind = Math.max(wind, near(f.x + 0.5, f.y + 2, 7) * 0.5);
    for (const l of this.liquids) if (l.t === Tile.Lava) lava = Math.max(lava, near(l.x + 0.5, this.LiquidTop(l), 5) * 0.3);
    this.SetLoops(stone, wind, scrape, lava);
  }

  private SetLoops(stone: number, wind: number, scrape: number, lava: number) {
    const dt = Time.unscaledDeltaTime, k = 1 - Math.exp(-dt * 10);
    if (this.stoneLoop) this.stoneLoop.volume = Mathf.lerp(this.stoneLoop.volume, stone, k);
    if (this.windLoop) this.windLoop.volume = Mathf.lerp(this.windLoop.volume, wind, k);
    if (this.scrapeLoop) this.scrapeLoop.volume = Mathf.lerp(this.scrapeLoop.volume, scrape, k);
    if (this.lavaLoop) this.lavaLoop.volume = Mathf.lerp(this.lavaLoop.volume, lava, k);
  }

  protected OnPauseChanged(paused: boolean) { if (paused) this.SetLoops(0, 0, 0, 0); }
}

// ------------------------------------------------------------------ helpers

function SetText(t: Text | null, s: string) { if (t && t.text !== s) t.text = s; }
function TimeText(sec: number) {
  if (!(sec > 0)) return "–";
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}
function Palette_channel(l: string) { return A.Palette.channel(l); }
const Lock = () => CasualArt.make("er-lock", 64, 64, (p) => {
  const px = 2 / 64;
  const body = CasualArt.sdBox(p.add(new V2(0, 0.25)), new V2(0.62, 0.48), 0.12);
  const shackle = Math.max(Math.abs(new V2(p.x, p.y - 0.25).magnitude - 0.38) - 0.1, -(p.y - 0.25));
  const hole = CasualArt.sdCircle(p, new V2(0, -0.22), 0.12);
  const d = Math.max(Math.min(body, shackle), -hole);
  return new Color(1, 1, 1, CasualArt.fill(d, px));
});
