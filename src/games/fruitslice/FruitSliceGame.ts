import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, Camera, CasualArt, CasualFx, CasualLook, Color, Fx, GameInfo, GameObject, howTo, Image,
  LineRenderer, Mathf, Mouse, overUI, Pal, Phase, Random, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, Text, TextAnchor,
  Time, Touchscreen, TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import { Backgrounds, BgArt, Blades, BladeStyle, FruitArt, isSpecial, Kind, Looks, NormalKinds } from "./FruitSliceArt";

/**
 * FRUIT SLICE: swipe to slice the fruit that arcs up from below, skip the bombs. A glowing blade follows every
 * finger (multi-touch: one blade per finger) or the mouse. Sliced fruit splits along the cut into two physics halves
 * with juice. Several fruits in one swipe make a COMBO; a fast cut through the middle is a CRITICAL.
 * Modes: CLASSIC (3 lives, a bomb ends the run), ARCADE (60 s, bombs cost points, power fruits: FROST slows time,
 * STARFRUIT starts a frenzy, DRAGONFRUIT doubles points), VS CPU (split screen, the bot slices its own half) and
 * 2 PLAYERS (split screen, 90 s). Stars from every run unlock blades and backgrounds.
 */

const H = 10;          // field height in local units (width follows the screen)
const G = 12;          // gravity, local units / s²
const SliceSpeed = 3.2; // minimum blade speed (local units / s) that cuts
const TrailLife = 0.11;
const ArcadeTime = 60, VsTime = 90;

enum Mode { Classic, Arcade, VsCpu, TwoP }
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const Gold = Pal.hex(0xffc93c), Cyan = Pal.hex(0x3ad7ff), Orange = Pal.hex(0xff8a1a), Red = Pal.hex(0xff3d4a), Ink = Pal.hex(0x1a0f08);
const BotStyle: BladeStyle = { name: "CPU", core: Pal.hex(0xffe0e0), glow: Pal.hex(0xff2a4a), cost: 0 };
const ClassicStars = [40, 100, 180], ArcadeStars = [80, 160, 260];

// ------------------------------------------------------------------ state

class Fruit {
  sr!: SpriteRenderer; glow!: SpriteRenderer;
  kind = Kind.Apple; pos = V2.zero; vel = V2.zero; rot = 0; spin = 0; r = 0.5; age = 0; active = false;
}
class Half { sr!: SpriteRenderer; pos = V2.zero; vel = V2.zero; rot = 0; spin = 0; t = 0; active = false; }
class Splat { sr!: SpriteRenderer; t = 0; life = 0; color = Color.white; active = false; }
class Slash { sr!: SpriteRenderer; t = 0; active = false; }
interface TrailPt { p: V2; t: number }

class Blade {
  id = 0;
  field!: Field;
  style: BladeStyle = Blades[0];
  pts: TrailPt[] = [];
  glow!: LineRenderer; core!: LineRenderer;
  active = false; down = false;
  prevLocal: V2 | null = null;
  hits = 0; lastHit = 0; hitPos = V2.zero; whoosh = 0;
}

class Bot {
  diff = 1;
  pos = V2.zero; from = V2.zero; to = V2.zero;
  phase = 0; cool = 0.6;
  target: Fruit | null = null;
  blade: Blade | null = null;
}

interface Pending { t: number; kind: Kind; x0: number; xt: number; apex: number; side: number }

class FieldHud {
  node!: UINode;
  score!: Text; sub!: Text; timer!: Text; badge!: Text; icon!: Image;
  crosses: Image[] = [];
  floats: { t: Text; age: number; life: number; start: V2 }[] = [];
  k = 100; w = 1000; h = 1000;
}

class Field {
  index = 0;
  root!: GameObject;
  W = 6; s = 1; rot = 0;
  human = true; bot: Bot | null = null; style = 0; name = "";
  fruits: Fruit[] = []; halves: Half[] = []; splats: Splat[] = []; slashes: Slash[] = [];
  fx!: CasualFx;
  frame!: SpriteRenderer; edge!: SpriteRenderer; tint!: SpriteRenderer; flash!: SpriteRenderer;
  rng = new SysRandom(1);
  clock = 0; waveT = 0; queue: Pending[] = [];
  score = 0; misses = 0; lifeAt = 100; cut = 0; bestCombo = 0; crits = 0; bombs = 0; specials = 0;
  freezeT = 0; frenzyT = 0; frenzyTick = 0; doubleT = 0; timeScale = 1; flashT = 0; flashColor = Color.white;
  timeLeft = 0; dead = false;
  hud!: FieldHud;
}

// ------------------------------------------------------------------ helpers

function noiseGen(seed: number) {
  const r = new SysRandom(seed);
  return () => r.nextDouble() * 2 - 1;
}

function set(t: Text | null | undefined, s: string) { if (t && t.text !== s) t.text = s; }

const SlashSprite = () => CasualArt.make("fs-slash", 256, 32, (p) => {
  const w = 0.11 * Math.pow(Math.max(0, 1 - Math.abs(p.x)), 0.7);
  return new Color(1, 1, 1, CasualArt.fill(Math.abs(p.y) - w, 0.02));
});
const Vignette = () => CasualArt.make("fs-vig", 64, 64, (p) => {
  const e = Math.max(Math.abs(p.x), Math.abs(p.y));
  return new Color(1, 1, 1, CasualArt.smooth(0.45, 1, e) * 0.9);
});
const Panel = () => CasualArt.make("fs-panel", 64, 64, (p) => new Color(1, 1, 1, CasualArt.fill(CasualArt.sdBox(p, new V2(0.98, 0.98), 0.08), 2 / 64)));

export class FruitSliceGame extends ArcadeGame {
  private world!: GameObject;
  private cover!: SpriteRenderer;
  private divider!: SpriteRenderer;
  private fields: Field[] = [];
  private blades = new Map<number, Blade>();
  private bladePool: Blade[] = [];
  private mode = Mode.Classic;
  private diff = 1;
  private countdown = 0; private countStep = 0;
  private endTimer = 0; private ended = false; private endReason = "";
  private revived = false; private doubled = false;
  private usingTouch = false;
  private relayout = 0;
  private lastResult: Result | null = null;
  private runStars = 0;
  private attractField: Field | null = null;

  // title UI
  private modeButtons: ArcadeButton[] = [];
  private optButton!: ArcadeButton; private shopButton!: ArcadeButton;
  private shop!: UINode;
  private shopStars!: Text; private bladeName!: Text; private bladeAction!: ArcadeButton; private bladeGlow!: Image; private bladeCore!: Image;
  private bgName!: Text; private bgAction!: ArcadeButton; private bgThumb!: Image;
  private browseBlade = 0; private browseBg = 0;
  private shopClock = 0;

  private sliceClip!: AudioClip; private squishClip!: AudioClip; private throwClip!: AudioClip; private comboClip!: AudioClip;
  private critClip!: AudioClip; private freezeClip!: AudioClip; private fuseClip!: AudioClip; private boomClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "fruitslice",
      Title: "FRUIT SLICE",
      Tagline: "SWIPE TO SLICE. SKIP THE BOMBS.",
      Accent: Pal.hex(0xff5a3d),
      Accent2: Gold,
      BgTop: Pal.hex(0x5a2f12),
      BgBottom: Pal.hex(0x2a1406),
      ShortSide: 10,
      Touch: TouchScheme.None,
      HomeBesidePause: true,
      Music: { bpm: 118, rootHz: 146.8, degrees: [0, 4, 5, 3], seed: 64, energy: 0.6, major: true },
      Reminders: [
        "The fruit is ripe|Grab your blade and slice a new high score.",
        "Beat the CPU blade|Can you out-slice it on HARD?",
        "New blades are waiting|Earn stars to unlock PRISM.",
      ],
      HowTo: [
        howTo(SlashSprite(), Cyan, "SWIPE across fruit to slice it. Every finger is a blade (mouse: hold and drag)."),
        howTo(FruitArt.Whole(Kind.Bomb), Color.white, "Skip the BOMBS! In CLASSIC a bomb ends the run; in timed modes it costs 10 points."),
        howTo(FruitArt.Whole(Kind.Orange), Color.white, "Slice 3+ fruits in one swipe for a COMBO. A fast cut through the middle is a CRITICAL (+10)."),
        howTo(FruitArt.Cross, Red, "CLASSIC: dropping 3 fruits ends the run. Every 100 points wins a life back."),
        howTo(FruitArt.Whole(Kind.Frost), Color.white, "ARCADE power fruit: FROSTBERRY slows time, STARFRUIT starts a frenzy, DRAGONFRUIT doubles points."),
        howTo(Art.Ring, Orange, "VS CPU and 2 PLAYERS: split screen, 90 seconds, the higher score wins."),
        howTo(Art.Star, Gold, "Earn stars every run and unlock new BLADES and BACKGROUNDS."),
      ],
      Tips: [
        "Wait for fruit to bunch up at the top of the arc, then take them all in one swipe.",
        "Short, fast flicks cut cleaner than long slow drags.",
        "Bombs glow red: swipe around them, not through them.",
        "In ARCADE, save the FROSTBERRY for a crowded screen.",
        "Two fingers, two blades: cover both sides of the screen.",
      ],
    });
  }

  protected get ShortSide() { return 10; }

  // ------------------------------------------------------------------ save data
  private get Stars() { return this.Data.get("stars"); }
  private UnlockedBlade(i: number) { return i === 0 || this.Data.get("ub" + i) === 1; }
  private UnlockedBg(i: number) { return i === 0 || this.Data.get("ug" + i) === 1; }
  private get ModeGroup() { return Mathf.clamp(this.Data.get("group"), 0, 2); }
  private get SoloSub() { return Mathf.clamp(this.Data.get("sub"), 0, 1); }
  private get SelectedMode(): Mode { const g = this.ModeGroup; return g === 0 ? (this.SoloSub === 0 ? Mode.Classic : Mode.Arcade) : g === 1 ? Mode.VsCpu : Mode.TwoP; }

  protected BestLine() {
    switch (this.SelectedMode) {
      case Mode.Classic: return `CLASSIC BEST ${this.Data.get("best_c")}`;
      case Mode.Arcade: return `ARCADE BEST ${this.Data.get("best_a")}`;
      case Mode.VsCpu: { const d = Mathf.clamp(this.Data.get("diff", 1), 0, 2); return `VS CPU ${DiffNames[d]}:  ${this.Data.get("w" + d)} WON · ${this.Data.get("l" + d)} LOST`; }
      default: return `PLAYER 1  ${this.Data.get("p0")} – ${this.Data.get("p1")}  PLAYER 2`;
    }
  }
  protected StatsLine() { return ""; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("SliceWorld", this.gameObject);
    CasualLook.calm(this, 1.25, 0.22);
    this.cover = CasualLook.cover(this.world, BgArt.Cover(this.EquippedBg()), -910);
    this.divider = Art.spr(this.world, "Divider", Art.Square, new Color(1, 1, 1, 0.5), 1, -700, Art.Additive);
    this.divider.gameObject.setActive(false);
    for (let i = 0; i < 2; i++) this.fields.push(this.MakeField(i));
    for (let i = 0; i < 10; i++) this.bladePool.push(this.MakeBlade());

    const noise = noiseGen(5);
    this.sliceClip = Sfx.make("fs-slice", 0.2, (t) => {
      const n = noise();
      return n * Sfx.env(t, 0.01, 0.17) * 0.35 * (0.5 + 0.5 * Sfx.sinP(Sfx.glide(t, 1800, 600, 0.2)));
    });
    const n2 = noiseGen(9);
    let lp = 0;
    this.squishClip = Sfx.make("fs-squish", 0.24, (t) => {
      lp += (n2() - lp) * 0.25;
      return (lp * 0.9 * Sfx.env(t, 0.002, 0.12) + Sfx.sinP(Sfx.glide(t, 420, 120, 0.15)) * 0.4 * Sfx.env(t, 0.002, 0.2)) * 0.6;
    });
    this.throwClip = Sfx.make("fs-throw", 0.18, (t) => Sfx.sinP(Sfx.glide(t, 90, 170, 0.15)) * Sfx.env(t, 0.01, 0.16) * 0.35);
    this.comboClip = Sfx.make("fs-combo", 0.5, (t) => {
      const notes = [523, 659, 784, 1047];
      let v = 0;
      for (let i = 0; i < 4; i++) { const tt = t - i * 0.06; if (tt > 0) v += Sfx.triP(notes[i] * tt) * Sfx.env(tt, 0.004, 0.3) * 0.22; }
      return v;
    });
    this.critClip = Sfx.make("fs-crit", 0.45, (t) => (Sfx.sinP(2400 * t) * 0.3 + Sfx.sinP(3610 * t) * 0.2 + Sfx.sinP(Sfx.glide(t, 1200, 2400, 0.1)) * 0.2) * Sfx.env(t, 0.002, 0.4));
    this.freezeClip = Sfx.make("fs-freeze", 0.7, (t) => {
      let v = 0;
      for (const f of [1760, 2217, 2637, 3520]) v += Sfx.sinP(f * t + Math.sin(t * 30) * 0.3) * 0.12;
      return v * Sfx.env(t, 0.02, 0.6);
    });
    const n3 = noiseGen(3);
    this.fuseClip = Sfx.make("fs-fuse", 0.35, (t) => n3() * (Math.random() < 0.08 ? 0.5 : 0.08) * Sfx.env(t, 0.01, 0.3));
    const n4 = noiseGen(4);
    let lp2 = 0;
    this.boomClip = Sfx.make("fs-boom", 1.1, (t) => {
      lp2 += (n4() - lp2) * 0.08;
      return (lp2 * 2.2 + Sfx.sinP(Sfx.glide(t, 110, 35, 0.6)) * 0.5) * Sfx.env(t, 0.003, 1.0) * 0.7;
    });

    this.BuildTitle();
    this.Layout();
  }

  private MakeField(i: number) {
    const f = new Field();
    f.index = i;
    f.root = new GameObject("Field" + i, this.world);
    f.frame = Art.spr(f.root, "Frame", Panel(), new Color(0, 0, 0, 0), 1, -800, Art.Flat);
    f.edge = Art.spr(f.root, "Edge", Art.Glow, new Color(1, 1, 1, 0), 1, -790, Art.Additive);
    f.tint = Art.spr(f.root, "Tint", Vignette(), new Color(1, 1, 1, 0), 1, 70, Art.Flat);
    f.flash = Art.spr(f.root, "Flash", Art.Square, new Color(1, 1, 1, 0), 1, 75, Art.Flat);
    for (let k = 0; k < 30; k++) {
      const fr = new Fruit();
      fr.glow = Art.spr(f.root, "Glow", FruitArt.BombGlow, Color.white, 1, 19, Art.Additive);
      fr.sr = Art.spr(f.root, "Fruit", FruitArt.Whole(Kind.Apple), Color.white, 1, 20);
      fr.glow.gameObject.setActive(false);
      fr.sr.gameObject.setActive(false);
      f.fruits.push(fr);
    }
    for (let k = 0; k < 60; k++) {
      const h = new Half();
      h.sr = Art.spr(f.root, "Half", FruitArt.Half(Kind.Apple), Color.white, 1, 12);
      h.sr.gameObject.setActive(false);
      f.halves.push(h);
    }
    for (let k = 0; k < 28; k++) {
      const s = new Splat();
      s.sr = Art.spr(f.root, "Splat", FruitArt.Splat(k % 3), Color.white, 1, -60 + k, Art.Flat);
      s.sr.gameObject.setActive(false);
      f.splats.push(s);
    }
    for (let k = 0; k < 10; k++) {
      const s = new Slash();
      s.sr = Art.spr(f.root, "Slash", SlashSprite(), Color.white, 1, 40, Art.Additive);
      s.sr.gameObject.setActive(false);
      f.slashes.push(s);
    }
    f.fx = CasualFx.create(f.root, 30, 220);
    f.hud = this.MakeHud(f);
    return f;
  }

  private MakeHud(f: Field) {
    const h = new FieldHud();
    h.node = UIKit.node("FieldHud" + f.index, this.UI.Hud);
    h.node.setAsFirstSibling();
    h.icon = UIKit.img(h.node, "Icon", FruitArt.Whole(Kind.Melon), Color.white);
    h.score = UIKit.label(h.node, "0", 92, Color.white, TextAnchor.MiddleLeft);
    UIKit.glow(h.score, new Color(0.25, 0.1, 0, 0.8), 4);
    h.sub = UIKit.label(h.node, "", 30, new Color(1, 0.92, 0.75, 0.95), TextAnchor.MiddleLeft);
    UIKit.glow(h.sub, new Color(0, 0, 0, 0.5), 2);
    h.timer = UIKit.label(h.node, "", 72, Color.white);
    UIKit.glow(h.timer, new Color(0, 0, 0, 0.55), 4);
    h.badge = UIKit.label(h.node, "", 40, Gold);
    UIKit.glow(h.badge, new Color(0.3, 0.15, 0, 0.8), 3);
    for (let i = 0; i < 3; i++) h.crosses.push(UIKit.img(h.node, "Cross", FruitArt.Cross, Color.white));
    for (let i = 0; i < 10; i++) {
      const t = UIKit.label(h.node, "", 48, Color.white);
      UIKit.glow(t, new Color(0, 0, 0, 0.6), 3);
      t.gameObject.setActive(false);
      h.floats.push({ t, age: 0, life: 1, start: V2.zero });
    }
    return h;
  }

  private MakeBlade() {
    const b = new Blade();
    b.glow = Art.line(this.world, "BladeGlow", Color.white, 0.5, 80, false, true, Art.LineMat);
    b.core = Art.line(this.world, "BladeCore", Color.white, 0.15, 81, false, true, Art.LineMat);
    return b;
  }

  // ------------------------------------------------------------------ title UI

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    const labels = ["SOLO", "VS CPU", "2 PLAYERS"];
    for (let i = 0; i < 3; i++) {
      const idx = i;
      const b = UIKit.buttonAt(ex, labels[i], UIKit.Center, new V2((i - 1) * 320, 0), new V2(300, 96), false, () => this.PickGroup(idx), 32);
      this.modeButtons.push(b);
    }
    this.optButton = UIKit.buttonAt(ex, "CLASSIC", UIKit.Center, new V2(-170, -112), new V2(320, 88), false, () => this.CycleOption(), 30);
    this.shopButton = UIKit.buttonAt(ex, "BLADES", UIKit.Center, new V2(170, -112), new V2(320, 88), false, () => this.OpenShop(true), 30, null);
    this.shopButton.setAccent(Gold);
    this.BuildShop(ex.parent!);
    this.RefreshTitle();
  }

  private BuildShop(parent: UINode) {
    const C = UIKit.Center;
    this.shop = UIKit.node("Shop", parent).stretch();
    UIKit.dim(this.shop, 0.78);
    const card = UIKit.card(this.shop, new V2(900, 1000), Gold);
    card.localScale = new V3(0.94, 0.94, 1);
    UIKit.glow(UIKit.at(UIKit.label(card, "BLADES & BACKGROUNDS", 50, Color.white), C, new V2(0, 410), new V2(860, 70)), Ink, 3);
    UIKit.img(card, "Star", Art.Star, Gold).rectTransform.place(C, new V2(-60, 340), new V2(56, 56));
    this.shopStars = UIKit.at(UIKit.label(card, "0", 46, Gold, TextAnchor.MiddleLeft), C, new V2(60, 340), new V2(200, 60));
    // blade row
    UIKit.at(UIKit.label(card, "BLADE", 30, Pal.TextDim), C, new V2(0, 270), new V2(400, 40));
    this.bladeGlow = UIKit.img(card, "BladeGlow", SlashSprite(), Cyan);
    this.bladeGlow.rectTransform.place(C, new V2(0, 195), new V2(600, 110));
    this.bladeCore = UIKit.img(card, "BladeCore", SlashSprite(), Color.white);
    this.bladeCore.rectTransform.place(C, new V2(0, 195), new V2(560, 34));
    this.bladeName = UIKit.at(UIKit.label(card, "", 40, Color.white), C, new V2(0, 120), new V2(600, 56));
    UIKit.buttonAt(card, "<", C, new V2(-360, 160), new V2(100, 110), false, () => this.Browse(0, -1), 52).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(360, 160), new V2(100, 110), false, () => this.Browse(0, 1), 52).setAccent(Gold);
    this.bladeAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, 45), new V2(380, 90), false, () => this.ShopAction(0), 32);
    // background row
    UIKit.at(UIKit.label(card, "BACKGROUND", 30, Pal.TextDim), C, new V2(0, -40), new V2(400, 40));
    this.bgThumb = UIKit.img(card, "BgThumb", BgArt.Thumb(0), Color.white);
    this.bgThumb.rectTransform.place(C, new V2(0, -150), new V2(420, 170));
    this.bgName = UIKit.at(UIKit.label(card, "", 40, Color.white), C, new V2(0, -265), new V2(600, 56));
    UIKit.buttonAt(card, "<", C, new V2(-360, -150), new V2(100, 110), false, () => this.Browse(1, -1), 52).setAccent(Gold);
    UIKit.buttonAt(card, ">", C, new V2(360, -150), new V2(100, 110), false, () => this.Browse(1, 1), 52).setAccent(Gold);
    this.bgAction = UIKit.buttonAt(card, "EQUIP", C, new V2(0, -345), new V2(380, 90), false, () => this.ShopAction(1), 32);
    UIKit.buttonAt(card, "CLOSE", C, new V2(0, -435), new V2(320, 84), true, () => this.OpenShop(false), 36).setAccent(Gold);
    this.shop.setActive(false);
  }

  private PickGroup(i: number) {
    this.Data.set("group", i);
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private CycleOption() {
    const g = this.ModeGroup;
    if (g === 0) this.Data.set("sub", this.SoloSub ^ 1);
    else if (g === 1) this.Data.set("diff", (Mathf.clamp(this.Data.get("diff", 1), 0, 2) + 1) % 3);
    else return;
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private RefreshTitle() {
    if (this.modeButtons.length === 0) return;
    const g = this.ModeGroup;
    const accents = [Pal.hex(0xff5a3d), Cyan, Orange];
    this.modeButtons.forEach((b, i) => {
      b.setAccent(i === g ? accents[i] : new Color(1, 1, 1, 0.45));
      b.node.localScale = V3.one;
    });
    const label = g === 0 ? (this.SoloSub === 0 ? "MODE: CLASSIC" : "MODE: ARCADE") : g === 1 ? "CPU: " + DiffNames[Mathf.clamp(this.Data.get("diff", 1), 0, 2)] : "90 s · SPLIT";
    if (this.optButton.label) this.optButton.label.text = label;
    this.optButton.setAccent(accents[g]);
    this.optButton.interactable = g !== 2;
    if (this.shopButton.label) this.shopButton.label.text = `BLADES  ★${this.Stars}`;
  }

  private OpenShop(on: boolean) {
    if (on) {
      this.browseBlade = this.Data.get("blade");
      this.browseBg = this.EquippedBg();
      this.RefreshShop();
    } else this.RefreshTitle();
    this.shop.setActive(on);
  }

  private Browse(row: number, d: number) {
    if (row === 0) this.browseBlade = (this.browseBlade + d + Blades.length) % Blades.length;
    else {
      this.browseBg = (this.browseBg + d + Backgrounds.length) % Backgrounds.length;
    }
    this.RefreshShop();
  }

  private ShopAction(row: number) {
    if (row === 0) {
      const i = this.browseBlade, b = Blades[i];
      if (!this.UnlockedBlade(i)) {
        if (this.Stars < b.cost) { Sfx.play(Snd.Deny, 0.6); return; }
        this.Data.add("stars", -b.cost);
        this.Data.set("ub" + i, 1);
        Sfx.play(Snd.PowerUp, 0.8);
      }
      this.Data.set("blade", i);
    } else {
      const i = this.browseBg, g = Backgrounds[i];
      if (!this.UnlockedBg(i)) {
        if (this.Stars < g.cost) { Sfx.play(Snd.Deny, 0.6); return; }
        this.Data.add("stars", -g.cost);
        this.Data.set("ug" + i, 1);
        Sfx.play(Snd.PowerUp, 0.8);
      }
      this.Data.set("bg", i);
      this.ApplyBg();
    }
    this.RefreshShop();
  }

  private RefreshShop() {
    set(this.shopStars, String(this.Stars));
    const bi = this.browseBlade, b = Blades[bi];
    set(this.bladeName, b.name);
    this.bladeGlow.color = b.glow;
    this.bladeCore.color = b.core;
    const be = this.Data.get("blade") === bi, bu = this.UnlockedBlade(bi);
    this.SetAction(this.bladeAction, be, bu, b.cost);
    const gi = this.browseBg, g = Backgrounds[gi];
    set(this.bgName, g.name);
    this.bgThumb.sprite = BgArt.Thumb(gi);
    this.SetAction(this.bgAction, this.EquippedBg() === gi, this.UnlockedBg(gi), g.cost);
  }

  private SetAction(btn: ArcadeButton, equipped: boolean, unlocked: boolean, cost: number) {
    const s = equipped ? "EQUIPPED" : unlocked ? "EQUIP" : `UNLOCK ★${cost}`;
    if (btn.label) btn.label.text = s;
    btn.setAccent(equipped ? Pal.TextDim : unlocked ? Cyan : this.Stars >= cost ? Gold : Pal.hex(0x8a7a6a));
    btn.interactable = !equipped && (unlocked || this.Stars >= cost);
  }

  private EquippedBg() { return Mathf.clamp(this.Data.get("bg"), 0, Backgrounds.length - 1); }

  private ApplyBg() {
    this.cover.sprite = CasualArt.hd(BgArt.Cover(this.EquippedBg()));
    CasualLook.fitCover(this.cover, this.ViewSize);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private get Split() { return this.State !== Phase.Title && (this.mode === Mode.VsCpu || this.mode === Mode.TwoP); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.cover, this.ViewSize);
    const rect = this.PlayRect(0, 0, 0.05);
    const portrait = this.ViewSize.x < this.ViewSize.y;
    const split = this.Split;
    const gap = 0.12;
    this.divider.gameObject.setActive(split);
    for (const f of this.fields) {
      let cx = rect.center.x, cy = rect.center.y, rw = rect.width, rh = rect.height;
      if (split) {
        if (portrait) { rh = (rect.height - gap) / 2; cy = f.index === 0 ? rect.yMin + rh / 2 : rect.yMax - rh / 2; }
        else { rw = (rect.width - gap) / 2; cx = f.index === 0 ? rect.xMin + rw / 2 : rect.xMax - rw / 2; }
      }
      f.s = rh / H;
      f.W = rw / f.s;
      f.rot = split && portrait && this.mode === Mode.TwoP && f.index === 1 ? 180 : 0;
      f.root.localPosition = new V3(cx, cy, 0);
      f.root.localScale = new V2(f.s, f.s);
      f.root.localEulerZ = f.rot;
      f.frame.transform.localScale = new V2(f.W + 0.1, H + 0.1);
      f.frame.color = split ? new Color(0, 0, 0, 0.16) : new Color(0, 0, 0, 0);
      f.tint.transform.localScale = new V2(f.W, H);
      f.edge.transform.localPosition = new V3(0, -H / 2, 0);
      f.edge.transform.localScale = new V2(f.W * 1.6, 1.6);
      const style = f.bot && this.mode === Mode.VsCpu ? BotStyle : Blades[Mathf.clamp(f.style, 0, Blades.length - 1)];
      f.edge.color = split ? style.glow.withAlpha(0.55) : new Color(1, 1, 1, 0);
      f.flash.transform.localScale = new V2(f.W + 0.2, H + 0.2);
      this.LayoutHud(f, cx, cy, rw, rh);
    }
    if (split) {
      if (portrait) { this.divider.transform.localPosition = new V3(rect.center.x, rect.center.y, 0); this.divider.transform.localScale = new V2(rect.width, 0.06); }
      else { this.divider.transform.localPosition = new V3(rect.center.x, rect.center.y, 0); this.divider.transform.localScale = new V2(0.06, rect.height); }
      this.divider.color = new Color(1, 0.85, 0.6, 0.45);
    }
  }

  private LayoutHud(f: Field, cx: number, cy: number, rw: number, rh: number) {
    const h = f.hud, uiPerWorld = 1080 / Math.min(this.ViewSize.x, this.ViewSize.y);
    h.k = f.s * uiPerWorld;
    h.w = rw * uiPerWorld;
    h.h = rh * uiPerWorld;
    h.node.place(UIKit.Center, this.UI.WorldToHud(new V2(cx, cy)), new V2(h.w, h.h));
    h.node.localEulerAngles = new V3(0, 0, f.rot);
    const L = -h.w / 2, T = h.h / 2, Rr = h.w / 2;
    // keep clear of the pause/home buttons in the screen's top-right corner
    const topRightWorld = new V2(cx + (f.rot === 0 ? rw / 2 : -rw / 2), cy + (f.rot === 0 ? rh / 2 : -rh / 2));
    const near = Math.abs(topRightWorld.x - this.ViewSize.x / 2) < 1 && Math.abs(topRightWorld.y - this.ViewSize.y / 2) < 1.5;
    const rOff = near ? 300 : 70;
    h.icon.rectTransform.place(UIKit.Center, new V2(L + 70, T - 75), new V2(88, 88));
    h.score.rectTransform.place(UIKit.Center, new V2(L + 130 + 250, T - 72), new V2(500, 100));
    h.sub.rectTransform.place(UIKit.Center, new V2(L + 40 + 250, T - 140), new V2(500, 40));
    h.badge.rectTransform.place(UIKit.Center, new V2(L + 40 + 250, T - 190), new V2(500, 50));
    h.badge.alignment = TextAnchor.MiddleLeft;
    h.timer.rectTransform.place(UIKit.Center, new V2(0, T - 72), new V2(300, 90));
    for (let i = 0; i < 3; i++) h.crosses[i].rectTransform.place(UIKit.Center, new V2(Rr - rOff - (2 - i) * 74 - 30, T - 70 - (i === 1 ? 0 : 0)), new V2(i === 2 ? 70 : 56, i === 2 ? 70 : 56));
  }

  // ------------------------------------------------------------------ lifecycle

  private ResetField(f: Field, seed: number) {
    for (const fr of f.fruits) { fr.active = false; fr.sr.gameObject.setActive(false); fr.glow.gameObject.setActive(false); }
    for (const h of f.halves) { h.active = false; h.sr.gameObject.setActive(false); }
    for (const s of f.splats) { s.active = false; s.sr.gameObject.setActive(false); }
    for (const s of f.slashes) { s.active = false; s.sr.gameObject.setActive(false); }
    f.fx.clear();
    f.rng = new SysRandom(seed);
    f.clock = 0; f.waveT = 1; f.queue = [];
    f.score = 0; f.misses = 0; f.lifeAt = 100; f.cut = 0; f.bestCombo = 0; f.crits = 0; f.bombs = 0; f.specials = 0;
    f.freezeT = f.frenzyT = f.doubleT = f.flashT = 0; f.timeScale = 1;
    f.dead = false;
    f.bot = null;
    f.tint.color = new Color(1, 1, 1, 0);
    f.flash.color = new Color(1, 1, 1, 0);
    for (const fl of f.hud.floats) fl.t.gameObject.setActive(false);
  }

  private ClearBlades() {
    for (const b of this.blades.values()) this.ReleaseBlade(b);
    this.blades.clear();
    for (const b of this.bladePool) { b.active = false; b.pts = []; b.glow.positionCount = 0; b.core.positionCount = 0; }
  }

  protected OnEnterTitle() {
    this.ClearBlades();
    this.mode = Mode.Arcade;
    for (const f of this.fields) { this.ResetField(f, 77); f.root.setActive(f.index === 0); }
    this.Layout();
    const f = this.fields[0];
    f.bot = this.MakeBot(f, 1);
    f.waveT = 0.4;
    this.attractField = f;
    this.ApplyBg();
    this.RefreshTitle();
    this.shop?.setActive(false);
  }

  protected BeginRun() {
    this.relayout = 3;
    this.attractField = null;
    this.ClearBlades();
    this.mode = this.SelectedMode;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    const seed = Math.floor(Math.random() * 1e9);
    const split = this.mode === Mode.VsCpu || this.mode === Mode.TwoP;
    for (const f of this.fields) {
      this.ResetField(f, seed);
      f.root.setActive(f.index === 0 || split);
      f.hud.node.setActive(f.index === 0 || split);
      f.human = f.index === 0 || this.mode === Mode.TwoP;
      f.timeLeft = this.mode === Mode.Arcade ? ArcadeTime : VsTime;
    }
    const p1 = this.Data.get("blade");
    this.fields[0].style = p1;
    this.fields[1].style = p1 === 1 ? 0 : 1;
    this.fields[0].name = this.mode === Mode.TwoP ? "PLAYER 1" : "YOU";
    this.fields[1].name = this.mode === Mode.TwoP ? "PLAYER 2" : "CPU " + DiffNames[this.diff];
    if (this.mode === Mode.VsCpu) this.fields[1].bot = this.MakeBot(this.fields[1], this.diff);
    this.Layout();
    this.ended = false;
    this.endTimer = 0;
    this.revived = this.doubled = false;
    this.lastResult = null;
    this.countdown = split ? 3.2 : 0.6;
    this.countStep = -1;
    this.Data.add("games", 1);
    Sfx.setIntensity(0.25);
    if (this.Data.get("games") <= 1) this.UI.Toast("Swipe across the fruit to slice it. Avoid the bombs!", 4);
    else if (split) this.UI.Toast(this.mode === Mode.TwoP ? "Each player slices on their own half!" : "Out-slice the CPU on your half!", 3);
    for (const f of this.fields) this.UpdateHud(f);
  }

  protected OnPauseChanged(paused: boolean) { if (paused) this.ClearBlades(); }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.UpdateBladeVisuals();
    if (this.shop?.activeSelf) {
      this.shopClock += Time.unscaledDeltaTime;
      if (Blades[this.browseBlade].rainbow) this.bladeGlow.color = Pal.rainbow(this.shopClock * 0.5).withAlpha(1);
    }
    const f = this.attractField;
    if (!f || this.State !== Phase.Title) {
      for (const fl of this.fields) this.TickFieldVisuals(fl, dt);
      return;
    }
    this.TickField(f, dt, true);
  }

  protected TickRun(dt: number) {
    // the HUD panels follow the fields: lay out again once the camera has settled on the new run
    if (this.relayout > 0 && --this.relayout === 0) this.Layout();
    if (this.countdown > 0) {
      this.countdown -= dt;
      const split = this.mode === Mode.VsCpu || this.mode === Mode.TwoP;
      if (split) {
        const step = Math.ceil(this.countdown);
        if (step !== this.countStep && step >= 0) {
          this.countStep = step;
          if (step > 0 && step <= 3) { this.UI.Announce(String(step), Gold, 0.8); Sfx.play(Snd.Beep, 0.6); }
          if (step === 0) { this.UI.Announce("SLICE!", Pal.hex(0xff5a3d), 0.9); Sfx.play(Snd.BeepHigh, 0.7); }
        }
      }
    }
    this.ReadPointers();
    const active = this.fields.filter((f) => f.root.activeSelf);
    for (const f of active) this.TickField(f, dt, false);
    this.UpdateBladeVisuals();
    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.State === Phase.Playing) this.End();
      return;
    }
    if (this.countdown > 0) return;
    // end conditions
    if (this.mode === Mode.Classic) {
      const f = this.fields[0];
      if (f.dead) this.BeginEnd("BOOM!", 1.8);
      else if (f.misses >= 3) { this.BeginEnd("GAME OVER", 1.4); this.UI.Announce("GAME OVER", Red, 1.2); }
    } else if (active.every((f) => f.timeLeft <= 0)) {
      this.BeginEnd("TIME UP", 1.5);
      this.UI.Announce("TIME UP!", Gold, 1.3);
      Sfx.play(Snd.Alarm, 0.6);
    }
  }

  private BeginEnd(reason: string, t: number) {
    this.ended = true;
    this.endReason = reason;
    this.endTimer = t;
    this.ClearBlades();
  }

  private TickField(f: Field, dt: number, attract: boolean) {
    const live = attract || (this.countdown <= 0 && !this.ended);
    // power timers
    f.freezeT = Math.max(0, f.freezeT - dt);
    f.frenzyT = Math.max(0, f.frenzyT - dt);
    f.doubleT = Math.max(0, f.doubleT - dt);
    f.timeScale = Mathf.moveTowards(f.timeScale, f.freezeT > 0 ? 0.35 : 1, dt * 2.5);
    const fdt = dt * f.timeScale;
    if (live && !f.dead) {
      f.clock += fdt;
      if (this.mode !== Mode.Classic && !attract) {
        // ARCADE: the frost also stops the clock; split screen keeps one shared pace
        const clockRate = this.mode === Mode.Arcade && f.freezeT > 0 ? 0 : 1;
        f.timeLeft = Math.max(0, f.timeLeft - dt * clockRate);
      }
      if (attract || this.mode === Mode.Classic || f.timeLeft > 0.4) this.Spawner(f, fdt, attract);
    }
    this.TickFieldVisuals(f, dt);
    // fruits
    for (const fr of f.fruits) {
      if (!fr.active) continue;
      fr.age += fdt;
      fr.vel = new V2(fr.vel.x, fr.vel.y - G * fdt);
      fr.pos = fr.pos.add(fr.vel.mul(fdt));
      fr.rot += fr.spin * fdt;
      this.PlaceFruit(fr);
      if (fr.kind === Kind.Bomb && Math.random() < dt * 30) {
        const tip = fr.pos.add(V2.fromAngle((fr.rot + 62) * Mathf.Deg2Rad, fr.r * 1.15));
        f.fx.emit(tip, Random.insideUnitCircle.mul(1.6).add(new V2(0, 1)), Random.value < 0.5 ? Pal.hex(0xffd25a) : Color.white, 0.12, 0.25, null, 0, 0, true, 2);
      }
      if (fr.pos.y < -H / 2 - fr.r - 0.7 && fr.vel.y < 0) {
        fr.active = false;
        fr.sr.gameObject.setActive(false);
        fr.glow.gameObject.setActive(false);
        if (!attract && this.mode === Mode.Classic && fr.kind !== Kind.Bomb && !isSpecial(fr.kind) && !f.dead && !this.ended) this.Miss(f, fr);
      }
    }
    if (f.bot && (live || attract) && !f.dead) this.TickBot(f, f.bot, dt);
    this.UpdateHud(f);
  }

  /** Halves, splats, slashes, overlays: keep animating on the result screen too. */
  private TickFieldVisuals(f: Field, dt: number) {
    const fdt = dt * f.timeScale;
    for (const h of f.halves) {
      if (!h.active) continue;
      h.t += fdt;
      h.vel = new V2(h.vel.x * (1 - 0.3 * fdt), h.vel.y - G * 1.05 * fdt);
      h.pos = h.pos.add(h.vel.mul(fdt));
      h.rot += h.spin * fdt;
      h.sr.transform.localPosition = h.pos;
      h.sr.transform.localEulerZ = h.rot;
      if (h.pos.y < -H / 2 - 2 || h.t > 4) { h.active = false; h.sr.gameObject.setActive(false); }
    }
    for (const s of f.splats) {
      if (!s.active) continue;
      s.t += dt;
      const k = s.t / s.life;
      if (k >= 1) { s.active = false; s.sr.gameObject.setActive(false); continue; }
      s.sr.color = s.color.withAlpha(s.color.a * (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4));
    }
    for (const s of f.slashes) {
      if (!s.active) continue;
      s.t += dt;
      const k = s.t / 0.22;
      if (k >= 1) { s.active = false; s.sr.gameObject.setActive(false); continue; }
      s.sr.color = Color.white.withAlpha(1 - k);
    }
    // overlays
    const tintTarget = f.freezeT > 0 ? Pal.hex(0x8fe0ff).withAlpha(0.55) : f.frenzyT > 0 ? Gold.withAlpha(0.45 + 0.15 * Math.sin(Time.time * 12)) : f.doubleT > 0 ? Pal.hex(0xff5aa8).withAlpha(0.3) : new Color(1, 1, 1, 0);
    f.tint.color = Color.lerp(f.tint.color, tintTarget, 1 - Math.exp(-dt * 6));
    f.flashT = Math.max(0, f.flashT - dt);
    f.flash.color = f.flashColor.withAlpha(Math.min(0.9, f.flashT * 2.2));
  }

  private PlaceFruit(fr: Fruit) {
    const size = fr.r * 2 / 0.9;
    fr.sr.transform.localPosition = fr.pos;
    fr.sr.transform.localEulerZ = fr.rot;
    fr.sr.transform.localScale = new V2(size, size);
    if (fr.glow.gameObject.activeSelf) {
      fr.glow.transform.localPosition = fr.pos;
      const pulse = fr.kind === Kind.Bomb ? 1 + 0.18 * Math.sin(fr.age * 18) : 1 + 0.08 * Math.sin(fr.age * 6);
      fr.glow.transform.localScale = new V2(size * 1.7 * pulse, size * 1.7 * pulse);
    }
  }

  // ------------------------------------------------------------------ spawning

  private Difficulty(f: Field) {
    if (this.mode === Mode.Classic) return Mathf.clamp01(f.clock / 150 + f.score / 400);
    return Mathf.clamp01(f.clock / 70);
  }

  private Spawner(f: Field, fdt: number, attract: boolean) {
    for (let i = f.queue.length - 1; i >= 0; i--) {
      const q = f.queue[i];
      q.t -= fdt;
      if (q.t > 0) continue;
      f.queue.splice(i, 1);
      this.Launch(f, q);
    }
    if (f.frenzyT > 0) {
      f.frenzyTick -= fdt;
      if (f.frenzyTick <= 0) {
        f.frenzyTick = 0.16;
        const side = f.rng.nextDouble() < 0.5 ? -1 : 1;
        this.Launch(f, { t: 0, kind: NormalKinds[f.rng.next(NormalKinds.length)], x0: 0, xt: 0, apex: 0.3 + f.rng.nextDouble() * 0.35, side });
      }
    }
    f.waveT -= fdt;
    if (f.waveT > 0) return;
    const d = this.Difficulty(f);
    const classic = this.mode === Mode.Classic && !attract;
    f.waveT = attract ? 1.7 : classic ? Mathf.lerp(2.5, 1.35, d) : Mathf.lerp(1.75, 1.05, d);
    this.SpawnWave(f, d, classic, attract);
  }

  private SpawnWave(f: Field, d: number, classic: boolean, attract: boolean) {
    const rng = f.rng;
    const maxN = attract ? 3 : classic ? Math.round(Mathf.lerp(2, 5, d)) : Math.round(Mathf.lerp(3, 6, d));
    let n = 1 + rng.next(maxN);
    if (classic && f.clock < 8) n = Math.min(n, 2);
    const kinds: Kind[] = [];
    for (let i = 0; i < n; i++) kinds.push(NormalKinds[rng.next(NormalKinds.length)]);
    const bombChance = attract ? 0.3 : classic ? (f.clock < 12 ? 0 : Mathf.lerp(0.18, 0.55, d)) : Mathf.lerp(0.25, 0.5, d);
    if (rng.nextDouble() < bombChance) kinds.push(Kind.Bomb);
    if (!classic && d > 0.5 && rng.nextDouble() < 0.25) kinds.push(Kind.Bomb);
    if (!classic && !attract && f.timeLeft > 8 && rng.nextDouble() < 0.16 && !f.fruits.some((x) => x.active && isSpecial(x.kind))) {
      kinds[0] = [Kind.Frost, Kind.Star, Kind.Dragon][rng.next(3)];
    }
    // shuffle
    for (let i = kinds.length - 1; i > 0; i--) { const j = rng.next(i + 1); const t = kinds[i]; kinds[i] = kinds[j]; kinds[j] = t; }
    const pattern = rng.next(4);
    const m = kinds.length;
    for (let i = 0; i < m; i++) {
      let x0 = rng.nextDouble() * 2 - 1, xt = rng.nextDouble() * 2 - 1, delay = 0;
      const apex = 0.55 + rng.nextDouble() * 0.36;
      switch (pattern) {
        case 0: x0 = m === 1 ? x0 * 0.6 : -0.85 + (1.7 * i) / Math.max(1, m - 1) + (rng.nextDouble() - 0.5) * 0.2; xt = x0 * 0.5 + (rng.nextDouble() - 0.5) * 0.4; break; // salvo
        case 1: delay = i * 0.26; x0 = (i % 2 === 0 ? -1 : 1) * (0.4 + rng.nextDouble() * 0.5); xt = -x0 * 0.6; break;            // stream
        case 2: { const c = (rng.nextDouble() - 0.5) * 0.4; x0 = c; xt = m === 1 ? 0 : -1 + (2 * i) / (m - 1); delay = i * 0.05; break; } // fan
        default: { const side = i % 2 === 0 ? -1 : 1; x0 = side * 0.9; xt = -side * (0.2 + rng.nextDouble() * 0.6); delay = Math.floor(i / 2) * 0.35; } // crossing pairs
      }
      f.queue.push({ t: delay, kind: kinds[i], x0: Mathf.clamp(x0, -1, 1), xt: Mathf.clamp(xt, -1, 1), apex, side: 0 });
    }
    if (f.human || attract) Sfx.playClip(this.throwClip, attract ? 0.12 : 0.4, 0.9 + Math.random() * 0.2);
  }

  private Launch(f: Field, q: Pending) {
    const fr = f.fruits.find((x) => !x.active);
    if (!fr) return;
    const L = Looks[q.kind];
    fr.kind = q.kind;
    fr.r = L.radius;
    fr.age = 0;
    fr.rot = f.rng.nextDouble() * 360;
    fr.spin = (f.rng.nextDouble() - 0.5) * 300;
    const hw = Math.max(0.5, f.W / 2 - 0.8);
    if (q.side !== 0) {
      // frenzy: in from the sides
      const y0 = -H / 2 + 1 + f.rng.nextDouble() * 3;
      fr.pos = new V2(q.side * (f.W / 2 + fr.r), y0);
      const apexY = -H / 2 + H * (0.55 + q.apex * 0.6);
      const vy = Math.sqrt(2 * G * Math.max(0.5, apexY - y0));
      fr.vel = new V2(-q.side * (f.W * 0.32 + f.rng.nextDouble() * 1.5), vy);
    } else {
      const x0 = q.x0 * hw, xt = q.xt * hw * 0.8;
      const y0 = -H / 2 - fr.r - 0.3, apexY = -H / 2 + H * q.apex;
      const vy = Math.sqrt(2 * G * (apexY - y0));
      const T = (2 * vy) / G;
      fr.pos = new V2(x0, y0);
      fr.vel = new V2((xt - x0) / T, vy);
    }
    fr.active = true;
    fr.sr.sprite = FruitArt.Whole(q.kind);
    fr.sr.color = Color.white;
    fr.sr.gameObject.setActive(true);
    const glowCol = q.kind === Kind.Bomb ? Pal.hex(0xff2a1a).withAlpha(0.7) : q.kind === Kind.Frost ? Pal.hex(0x6fdcff).withAlpha(0.8) : q.kind === Kind.Star ? Gold.withAlpha(0.8) : q.kind === Kind.Dragon ? Pal.hex(0xff4fa3).withAlpha(0.8) : null;
    fr.glow.gameObject.setActive(glowCol !== null);
    if (glowCol) fr.glow.color = glowCol;
    this.PlaceFruit(fr);
    if (q.kind === Kind.Bomb && f.human) Sfx.playClip(this.fuseClip, 0.35);
  }

  // ------------------------------------------------------------------ input and blades

  private ReadPointers() {
    for (const t of Touchscreen.touches) {
      const id = t.touchId;
      this.usingTouch = true;
      if (t.press.wasPressedThisFrame && !this.blades.has(id)) this.TryStartBlade(id, t.position);
      const b = this.blades.get(id);
      if (!b) continue;
      if (t.press.isPressed && !t.press.wasReleasedThisFrame) this.MoveBlade(b, this.ScreenToWorld(t.position));
      else { this.MoveBlade(b, this.ScreenToWorld(t.position)); this.ReleaseBlade(b); this.blades.delete(id); }
    }
    if (Mouse.present && !(this.usingTouch && Touchscreen.present)) {
      const id = -1;
      if (Mouse.leftButton.wasPressedThisFrame && !this.blades.has(id)) this.TryStartBlade(id, Mouse.position);
      const b = this.blades.get(id);
      if (b) {
        this.MoveBlade(b, this.ScreenToWorld(Mouse.position));
        if (!Mouse.leftButton.isPressed) { this.ReleaseBlade(b); this.blades.delete(id); }
      }
    }
  }

  private TryStartBlade(id: number, screen: V2) {
    if (this.ended || overUI(screen)) return;
    const world = this.ScreenToWorld(screen);
    let field: Field | null = null;
    for (const f of this.fields) {
      if (!f.root.activeSelf || !f.human) continue;
      const l = this.ToLocal(f, world);
      if (Math.abs(l.x) <= f.W / 2 + 0.4 && Math.abs(l.y) <= H / 2 + 0.4) { field = f; break; }
    }
    if (!field && !this.Split) field = this.fields[0];
    if (!field) return;
    const b = this.TakeBlade();
    if (!b) return;
    b.id = id;
    b.field = field;
    b.style = Blades[Mathf.clamp(field.style, 0, Blades.length - 1)];
    b.down = true;
    b.prevLocal = this.ToLocal(field, world);
    b.pts = [{ p: world, t: Time.unscaledTime }];
    b.hits = 0;
    this.blades.set(id, b);
  }

  private TakeBlade() {
    const b = this.bladePool.find((x) => !x.active);
    if (!b) return null;
    b.active = true;
    return b;
  }

  private ReleaseBlade(b: Blade) {
    this.FinishCombo(b);
    b.down = false;
    b.prevLocal = null;
  }

  private ToLocal(f: Field, world: V2) { const l = f.root.inverseTransformPoint(world); return new V2(l.x, l.y); }
  private ToWorld(f: Field, local: V2) { const w = f.root.transformPoint(local); return new V2(w.x, w.y); }

  private MoveBlade(b: Blade, world: V2) {
    const now = Time.unscaledTime, udt = Math.max(1e-3, Time.unscaledDeltaTime);
    const last = b.pts[b.pts.length - 1];
    if (!last || V2.distance(last.p, world) > 0.01) b.pts.push({ p: world, t: now });
    else last.t = now;
    const f = b.field, local = this.ToLocal(f, world);
    if (b.prevLocal && !this.ended && this.countdown <= 0 && !f.dead) {
      const seg = local.sub(b.prevLocal), speed = seg.magnitude / udt;
      if (speed > SliceSpeed && seg.magnitude > 0.01) {
        this.CutAlong(f, b, b.prevLocal, local, speed);
        b.whoosh -= udt;
        if (b.whoosh <= 0 && speed > 14 && f.human) { Sfx.playClip(this.sliceClip, 0.22, 0.9 + Math.random() * 0.3); b.whoosh = 0.28; }
      }
    }
    b.prevLocal = local;
    if (b.hits > 0 && now - b.lastHit > 0.3) this.FinishCombo(b);
  }

  private CutAlong(f: Field, b: Blade, a: V2, c: V2, speed: number) {
    const ab = c.sub(a), len2 = Math.max(1e-6, ab.sqrMagnitude), dir = ab.normalized;
    for (const fr of f.fruits) {
      if (!fr.active) continue;
      const t = Mathf.clamp01(V2.dot(fr.pos.sub(a), ab) / len2);
      const closest = a.add(ab.mul(t));
      const dist = V2.distance(closest, fr.pos);
      if (dist > fr.r * 0.95) continue;
      // the cut line's offset from the centre (perpendicular distance to the infinite line)
      const perp = Math.abs(V2.dot(fr.pos.sub(a), V2.perpendicular(dir)));
      this.SliceFruit(f, b, fr, dir, perp, speed);
    }
  }

  private SliceFruit(f: Field, b: Blade, fr: Fruit, dir: V2, perp: number, speed: number) {
    fr.active = false;
    fr.sr.gameObject.setActive(false);
    fr.glow.gameObject.setActive(false);
    const world = this.ToWorld(f, fr.pos);
    if (fr.kind === Kind.Bomb) { this.BombHit(f, fr); return; }
    const L = Looks[fr.kind];
    const ang = Math.atan2(dir.y, dir.x) * Mathf.Rad2Deg;
    const n = V2.perpendicular(dir);
    const size = fr.r * 2 / 0.9;
    for (let s = 0; s < 2; s++) {
      const h = f.halves.find((x) => !x.active);
      if (!h) break;
      const side = s === 0 ? 1 : -1;
      h.active = true;
      h.t = 0;
      h.pos = fr.pos.add(n.mul(side * 0.04));
      h.vel = fr.vel.mul(0.6).add(n.mul(side * (1.6 + Math.random() * 0.8))).add(dir.mul(0.8));
      h.rot = ang + (s === 0 ? 0 : 180);
      h.spin = side * (90 + Math.random() * 160);
      h.sr.sprite = FruitArt.Half(fr.kind);
      h.sr.transform.localScale = new V2(size, size);
      h.sr.transform.localPosition = h.pos;
      h.sr.transform.localEulerZ = h.rot;
      h.sr.gameObject.setActive(true);
    }
    // juice
    const sp = f.splats.find((x) => !x.active) ?? f.splats.reduce((m, x) => (x.t > m.t ? x : m), f.splats[0]);
    sp.active = true;
    sp.t = 0;
    sp.life = 2.6;
    sp.color = L.juice.withAlpha(0.8);
    sp.sr.color = sp.color;
    sp.sr.transform.localPosition = fr.pos;
    const ss = size * (1.3 + Math.random() * 0.5);
    sp.sr.transform.localScale = new V2(ss, ss);
    sp.sr.transform.localEulerZ = Math.random() * 360;
    sp.sr.gameObject.setActive(true);
    for (let i = 0; i < 14; i++) {
      const v = n.mul((Math.random() - 0.5) * 9).add(dir.mul(Math.random() * 5)).add(new V2(0, Math.random() * 3));
      f.fx.emit(fr.pos, v, i % 4 === 0 ? CasualArt.lighten(L.juice, 0.4) : L.juice, 0.1 + Math.random() * 0.16, 0.5 + Math.random() * 0.4, FruitArt.Drop, 16, 0, true, 0.8);
    }
    const sl = f.slashes.find((x) => !x.active);
    if (sl) {
      sl.active = true;
      sl.t = 0;
      sl.sr.transform.localPosition = fr.pos;
      sl.sr.transform.localEulerZ = ang;
      sl.sr.transform.localScale = new V2(size * 1.7, size * 1.7);
      sl.sr.gameObject.setActive(true);
    }
    this.Fx.burst(world, L.juice, 6, 3 * f.s, 0.3 * f.s, 0.35);
    // scoring
    const mult = f.doubleT > 0 ? 2 : 1;
    let pts = 1;
    const crit = speed > 15 && perp < fr.r * 0.25 && !isSpecial(fr.kind) && Math.random() < 0.35;
    if (crit) {
      pts += 10;
      f.crits++;
      this.Float(f, fr.pos.add(new V2(0, 0.6)), `CRITICAL! +${10 * mult}`, Pal.hex(0xff4a4a), 1.2);
      f.fx.sparkle(fr.pos, Gold, 8, 0.8, 0.35);
      f.flashColor = Color.white;
      f.flashT = Math.max(f.flashT, 0.12);
      if (f.human) Sfx.playClip(this.critClip, 0.6);
      this.Hitstop(0.05);
    }
    this.AddScore(f, pts * mult);
    f.cut++;
    if (f.human) Sfx.playClip(this.squishClip, 0.55, 0.85 + Math.random() * 0.35);
    else Sfx.playClip(this.squishClip, 0.22, 0.85 + Math.random() * 0.35);
    if (isSpecial(fr.kind)) this.Special(f, fr);
    b.hits++;
    b.lastHit = Time.unscaledTime;
    b.hitPos = fr.pos;
  }

  private Special(f: Field, fr: Fruit) {
    f.specials++;
    switch (fr.kind) {
      case Kind.Frost:
        f.freezeT = 4.5;
        this.Float(f, fr.pos.add(new V2(0, 0.7)), "FREEZE!", Pal.hex(0x8fe8ff), 1.3);
        Sfx.playClip(this.freezeClip, 0.6);
        break;
      case Kind.Star:
        f.frenzyT = 4;
        f.frenzyTick = 0.3;
        this.Float(f, fr.pos.add(new V2(0, 0.7)), "FRENZY!", Gold, 1.3);
        Sfx.play(Snd.PowerUp, 0.6);
        break;
      default:
        f.doubleT = 7;
        this.Float(f, fr.pos.add(new V2(0, 0.7)), "DOUBLE POINTS!", Pal.hex(0xff5aa8), 1.2);
        Sfx.play(Snd.PowerUp, 0.6, 1.2);
    }
    f.fx.sparkle(fr.pos, Looks[fr.kind].juice, 12, 1, 0.4);
  }

  private FinishCombo(b: Blade) {
    const n = b.hits;
    b.hits = 0;
    if (n < 3 || !b.field) return;
    const f = b.field, mult = f.doubleT > 0 ? 2 : 1;
    this.AddScore(f, n * mult);
    f.bestCombo = Math.max(f.bestCombo, n);
    this.Float(f, b.hitPos.add(new V2(0, 1)), `${n} FRUIT COMBO +${n * mult}`, Gold, 1 + Math.min(0.5, (n - 3) * 0.1));
    f.fx.confetti(b.hitPos, 10 + n * 3, 6, [Gold, Color.white, Pal.hex(0xff5a3d)], 0.16);
    Sfx.playClip(this.comboClip, f.human ? 0.6 : 0.25, 1 + Math.min(0.5, (n - 3) * 0.08));
  }

  private AddScore(f: Field, pts: number) {
    f.score = Math.max(0, f.score + pts);
    if (this.mode === Mode.Classic && f.score >= f.lifeAt) {
      f.lifeAt += 100;
      if (f.misses > 0) {
        f.misses--;
        this.Float(f, new V2(f.W / 2 - 2, H / 2 - 1.6), "+1 LIFE", Pal.hex(0x6fe06a), 1.1);
        Sfx.play(Snd.Pickup, 0.6);
      }
    }
  }

  private Miss(f: Field, fr: Fruit) {
    f.misses++;
    const p = new V2(Mathf.clamp(fr.pos.x, -f.W / 2 + 0.6, f.W / 2 - 0.6), -H / 2 + 0.5);
    this.Float(f, p, "MISS", Red, 1);
    f.fx.pop(p, Red, 10, 3, 0.18, 0.4);
    f.flashColor = Red;
    f.flashT = Math.max(f.flashT, 0.12);
    Sfx.play(Snd.Hurt, 0.5);
    this.Fx.shake(0.12);
  }

  private BombHit(f: Field, fr: Fruit) {
    f.bombs++;
    const world = this.ToWorld(f, fr.pos);
    this.Fx.burst(world, Pal.hex(0xffb03a), 30, 9 * f.s, 0.5 * f.s, 0.7);
    this.Fx.burst(world, Color.white, 14, 5 * f.s, 0.4 * f.s, 0.4);
    this.Fx.ring(world, Pal.hex(0xff6a2a), 0.5 * f.s, 6 * f.s, 0.5);
    f.fx.pop(fr.pos, Pal.hex(0x333333), 16, 7, 0.25, 0.8);
    this.Fx.shake(0.5);
    this.Fx.kick(0.6, 0.3);
    Fx.haptic(true);
    Sfx.playClip(this.boomClip, f.human ? 0.9 : 0.5);
    f.flashColor = Color.white;
    f.flashT = 0.5;
    if (this.mode === Mode.Classic && this.State === Phase.Playing) {
      f.dead = true;
      this.Hitstop(0.2);
      // everything else blows off the screen
      for (const o of f.fruits) if (o.active) o.vel = o.pos.sub(fr.pos).normalized.mul(10).add(new V2(0, 3));
      this.UI.Announce("BOOM!", Pal.hex(0xff6a2a), 1.4);
      return;
    }
    if (this.State !== Phase.Playing) return;
    const loss = Math.min(10, f.score);
    f.score -= loss;
    this.Float(f, fr.pos.add(new V2(0, 0.6)), loss > 0 ? `-${loss}` : "BOOM!", Red, 1.3);
    for (const o of f.fruits) if (o.active && o.kind !== Kind.Bomb) o.vel = o.vel.add(o.pos.sub(fr.pos).normalized.mul(5));
  }

  private UpdateBladeVisuals() {
    const now = Time.unscaledTime;
    for (const b of this.bladePool) {
      if (!b.active) continue;
      while (b.pts.length > 0 && now - b.pts[0].t > TrailLife) b.pts.shift();
      if (!b.down && b.pts.length < 2) { b.active = false; b.pts = []; b.glow.positionCount = 0; b.core.positionCount = 0; continue; }
      if (b.pts.length < 2) { b.glow.positionCount = 0; b.core.positionCount = 0; continue; }
      const s = b.field ? b.field.s : 1;
      b.glow.setPositions(b.pts.map((x) => x.p));
      b.core.setPositions(b.pts.map((x) => x.p));
      const glow = b.style.rainbow ? Pal.rainbow(now * 0.7).withAlpha(1) : b.style.glow;
      b.glow.startColor = glow.withAlpha(0);
      b.glow.endColor = glow.withAlpha(0.95);
      b.core.startColor = b.style.core.withAlpha(0.2);
      b.core.endColor = b.style.core;
      b.glow.widthMultiplier = 0.55 * s;
      b.core.widthMultiplier = 0.18 * s;
      b.glow.startWidth = b.core.startWidth = 0.15;
      b.glow.endWidth = b.core.endWidth = 1;
    }
  }

  // ------------------------------------------------------------------ bot

  private MakeBot(f: Field, diff: number) {
    const bot = new Bot();
    bot.diff = diff;
    bot.pos = new V2(0, -H * 0.2);
    bot.cool = 0.5;
    const b = this.TakeBlade();
    if (b) {
      b.id = -100 - f.index;
      b.field = f;
      b.style = f.index === 0 ? Blades[0] : BotStyle;
      b.down = false;
      b.pts = [];
      b.active = true;
      bot.blade = b;
    }
    return bot;
  }

  private TickBot(f: Field, bot: Bot, dt: number) {
    const d = bot.diff;
    const reaction = [0.5, 0.3, 0.14][d], moveSpeed = [12, 20, 30][d], swipeSpeed = [16, 24, 34][d];
    const missChance = [0.28, 0.12, 0.03][d], bombCare = [0.45, 0.85, 1][d], rest = [0.32, 0.14, 0.04][d];
    const b = bot.blade;
    if (!b) return;
    b.active = true;
    if (bot.phase === 0) {
      b.down = false;
      b.prevLocal = null;
      bot.cool -= dt;
      if (bot.cool > 0) return;
      // choose the most urgent fruit that will still be on screen when the blade gets there
      const pred = (fr: Fruit, t: number) => { const ft = t * f.timeScale; return fr.pos.add(fr.vel.mul(ft)).add(new V2(0, -0.5 * G * ft * ft)); };
      let best: Fruit | null = null, bestScore = -1e9, bestT = 0;
      for (const fr of f.fruits) {
        if (!fr.active || fr.kind === Kind.Bomb || fr.age < reaction || fr.pos.y < -H / 2 + 0.4) continue;
        let tArr = V2.distance(bot.pos, fr.pos) / moveSpeed + 0.1;
        tArr = V2.distance(bot.pos, pred(fr, tArr)) / moveSpeed + 0.1;
        const p = pred(fr, tArr);
        if (p.y < -H / 2 + 0.7 || Math.abs(p.x) > f.W / 2 - 0.2) continue;
        const urgency = -p.y * 0.5 + (fr.vel.y < 0 ? 2 : 0) + (isSpecial(fr.kind) ? 4 : 0) + Math.random() * (3 - d) - tArr * 2;
        if (urgency > bestScore) { bestScore = urgency; best = fr; bestT = tArr; }
      }
      if (!best) return;
      // swipe direction: through a neighbour on HARD/MEDIUM, otherwise a random diagonal
      let dir = V2.fromAngle(Random.range(-0.9, 0.9) + (Random.value < 0.5 ? 0 : Math.PI));
      if (d > 0) {
        let other: Fruit | null = null, od = d === 2 ? 3.2 : 2;
        for (const fr of f.fruits) if (fr.active && fr !== best && fr.kind !== Kind.Bomb && V2.distance(fr.pos, best.pos) < od) { od = V2.distance(fr.pos, best.pos); other = fr; }
        if (other) dir = pred(other, bestT).sub(pred(best, bestT)).normalized;
      }
      const tArr = bestT;
      let center = pred(best, tArr);
      if (Math.random() < missChance) center = center.add(V2.perpendicular(dir).mul(best.r * (1.3 + Math.random())));
      else center = center.add(V2.perpendicular(dir).mul(best.r * (Math.random() - 0.5) * (d === 2 ? 0.6 : 1.1)));
      const reach = best.r + 1.1;
      let ok = false;
      for (let tries = 0; tries < 4 && !ok; tries++) {
        const from = center.sub(dir.mul(reach)), to = center.add(dir.mul(reach));
        ok = true;
        if (Math.random() < bombCare) {
          for (const fr of f.fruits) {
            if (!fr.active || fr.kind !== Kind.Bomb) continue;
            const bp = pred(fr, tArr + reach / swipeSpeed);
            const ab = to.sub(from), t = Mathf.clamp01(V2.dot(bp.sub(from), ab) / Math.max(1e-6, ab.sqrMagnitude));
            if (V2.distance(from.add(ab.mul(t)), bp) < fr.r + 0.55) { ok = false; break; }
          }
        }
        if (!ok) dir = V2.fromAngle(Math.atan2(dir.y, dir.x) + Math.PI / 2 + Random.range(-0.4, 0.4));
        else { bot.from = from; bot.to = to; }
      }
      if (!ok) { bot.cool = 0.12; return; }
      bot.target = best;
      bot.phase = 1;
      return;
    }
    if (bot.phase === 1) {
      // finger lifted: glide to the start of the swipe
      bot.pos = V2.moveTowards(bot.pos, bot.from, moveSpeed * dt);
      if (V2.distance(bot.pos, bot.from) < 0.02) {
        bot.phase = 2;
        b.down = true;
        b.pts = [{ p: this.ToWorld(f, bot.pos), t: Time.unscaledTime }];
        b.prevLocal = bot.pos;
      }
      return;
    }
    // swiping
    const step = swipeSpeed * dt;
    const prev = bot.pos;
    bot.pos = V2.moveTowards(bot.pos, bot.to, step);
    const world = this.ToWorld(f, bot.pos), now = Time.unscaledTime;
    b.pts.push({ p: world, t: now });
    if (!this.ended && f.timeLeft > 0) this.CutAlong(f, b, prev, bot.pos, Math.max(SliceSpeed + 1, step / Math.max(1e-3, dt)));
    b.prevLocal = bot.pos;
    if (V2.distance(bot.pos, bot.to) < 0.02) {
      this.FinishCombo(b);
      b.down = false;
      bot.phase = 0;
      bot.cool = rest + Math.random() * rest;
    }
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud(f: Field) {
    const h = f.hud;
    const classic = this.mode === Mode.Classic;
    set(h.score, String(f.score));
    h.score.color = f.doubleT > 0 ? Pal.hex(0xffd0e6) : Color.white;
    const best = classic ? this.Data.get("best_c") : this.mode === Mode.Arcade ? this.Data.get("best_a") : -1;
    set(h.sub, best >= 0 ? `BEST ${Math.max(best, f.score)}` : f.name);
    let badge = "";
    if (f.doubleT > 0) badge = `x2  ${Math.ceil(f.doubleT)}s`;
    else if (f.freezeT > 0) badge = "FROZEN";
    else if (f.frenzyT > 0) badge = "FRENZY!";
    set(h.badge, badge);
    h.badge.color = f.doubleT > 0 ? Pal.hex(0xff7ac0) : f.freezeT > 0 ? Pal.hex(0x9fe9ff) : Gold;
    h.timer.gameObject.setActive(!classic);
    if (!classic) {
      set(h.timer, String(Math.ceil(f.timeLeft)));
      h.timer.color = f.timeLeft <= 5 && f.timeLeft > 0 ? (Math.sin(Time.time * 12) > 0 ? Red : Color.white) : f.freezeT > 0 && this.mode === Mode.Arcade ? Pal.hex(0x9fe9ff) : Color.white;
    }
    for (let i = 0; i < 3; i++) {
      h.crosses[i].gameObject.setActive(classic);
      h.crosses[i].color = i < f.misses ? Red : new Color(1, 1, 1, 0.35);
    }
    const dt = Time.unscaledDeltaTime;
    for (const fl of h.floats) {
      if (!fl.t.gameObject.activeSelf) continue;
      fl.age += dt;
      const k = fl.age / fl.life;
      if (k >= 1) { fl.t.gameObject.setActive(false); continue; }
      fl.t.rectTransform.anchoredPosition = fl.start.add(new V2(0, 90 * Mathf.clamp01(k * 1.6)));
      const s = k < 0.12 ? Mathf.lerp(0.4, 1.2, k / 0.12) : Mathf.lerp(1.2, 1, Mathf.clamp01((k - 0.12) / 0.2));
      fl.t.rectTransform.localScale = new V3(s, s, 1);
      fl.t.color = fl.t.color.withAlpha(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    }
  }

  private Float(f: Field, local: V2, text: string, color: Color, scale: number) {
    const h = f.hud;
    let fl = h.floats.find((x) => !x.t.gameObject.activeSelf);
    if (!fl) fl = h.floats.reduce((m, x) => (x.age > m.age ? x : m), h.floats[0]);
    const x = Mathf.clamp(local.x * h.k, -h.w / 2 + 220, h.w / 2 - 220), y = Mathf.clamp(local.y * h.k, -h.h / 2 + 80, h.h / 2 - 260);
    fl.start = new V2(x, y);
    fl.age = 0;
    fl.life = 1.0;
    fl.t.text = text;
    fl.t.color = color;
    fl.t.fontSize = Math.round(46 * scale);
    fl.t.rectTransform.place(UIKit.Center, fl.start, new V2(700, 80));
    fl.t.gameObject.setActive(true);
  }

  // ------------------------------------------------------------------ results

  private StarsFor(score: number, th: number[]) { return th.filter((t) => score >= t).length; }

  private End() {
    const f = this.fields[0];
    this.Data.add("fruits", f.cut + (this.mode === Mode.TwoP ? this.fields[1].cut : 0));
    this.Data.max("bestCombo", f.bestCombo);
    if (this.mode === Mode.Classic || this.mode === Mode.Arcade) {
      const classic = this.mode === Mode.Classic;
      const key = classic ? "best_c" : "best_a";
      const newBest = this.Data.max(key, f.score);
      const stars = this.StarsFor(f.score, classic ? ClassicStars : ArcadeStars);
      this.runStars = stars;
      this.Data.add("stars", stars);
      const r = new Result({
        Headline: `${f.score} POINTS`,
        HeadlineColor: Gold,
        Stars: stars,
        NewBest: newBest,
        BestLine: `${classic ? (this.endReason === "BOOM!" ? "BOMBED!" : "3 MISSES") : "TIME UP"}  ·  BEST ${this.Data.get(key)}`,
        Stats: [["FRUIT SLICED", String(f.cut)], ["BEST COMBO", f.bestCombo > 0 ? String(f.bestCombo) : "–"], ["CRITICALS", String(f.crits)], ["STARS EARNED", `+${stars}  (★${this.Stars})`]],
        Primary: "PLAY AGAIN",
        Victory: stars > 0,
      });
      if (classic && !this.revived) {
        r.Reward = () => this.SecondChance();
        r.RewardLabel = "SECOND CHANCE: 1 LIFE (WATCH AD)";
      } else if (!this.doubled && f.score > 0) {
        r.Reward = () => this.DoubleScore();
        r.RewardLabel = "DOUBLE SCORE (WATCH AD)";
      }
      this.lastResult = r;
      this.Finish(r);
      return;
    }
    const a = this.fields[0].score, b = this.fields[1].score;
    if (this.mode === Mode.TwoP) {
      const w = a === b ? -1 : a > b ? 0 : 1;
      if (w >= 0) this.Data.add("p" + w, 1);
      this.Finish(new Result({
        Headline: w < 0 ? "DRAW!" : `PLAYER ${w + 1} WINS!`,
        HeadlineColor: w === 0 ? Cyan : w === 1 ? Orange : Color.white,
        Value: `${a} – ${b}`,
        BestLine: `WINS  P1 ${this.Data.get("p0")} – ${this.Data.get("p1")} P2`,
        Stats: [["P1 FRUIT", String(this.fields[0].cut)], ["P2 FRUIT", String(this.fields[1].cut)], ["P1 BEST COMBO", String(this.fields[0].bestCombo)], ["P2 BEST COMBO", String(this.fields[1].bestCombo)]],
        Primary: "REMATCH",
        Victory: w >= 0,
      }));
      return;
    }
    const won = a > b, draw = a === b;
    if (won) { this.Data.add("w" + this.diff, 1); } else if (!draw) this.Data.add("l" + this.diff, 1);
    const stars = won ? this.diff + 1 : 0;
    this.runStars = stars;
    this.Data.add("stars", stars);
    const r = new Result({
      Headline: won ? "YOU WIN!" : draw ? "DRAW!" : "CPU WINS",
      HeadlineColor: won ? Gold : draw ? Color.white : Pal.hex(0xffb0b8),
      Stars: stars,
      BestLine: `YOU ${a}  –  ${b} CPU`,
      Stats: [["CPU LEVEL", DiffNames[this.diff]], ["FRUIT SLICED", String(this.fields[0].cut)], ["BEST COMBO", String(this.fields[0].bestCombo)], ["STARS", `+${stars}  (★${this.Stars})`]],
      Primary: won ? "PLAY AGAIN" : "REMATCH",
      Victory: won,
    });
    if (won) { r.Reward = () => this.DoubleStars(); r.RewardLabel = `DOUBLE STARS: +${stars} MORE (WATCH AD)`; }
    this.lastResult = r;
    this.Finish(r);
  }

  private SecondChance() {
    this.revived = true;
    const f = this.fields[0];
    f.misses = 2;
    f.dead = false;
    for (const fr of f.fruits) { fr.active = false; fr.sr.gameObject.setActive(false); fr.glow.gameObject.setActive(false); }
    f.queue = [];
    f.waveT = 1.2;
    f.flashT = 0;
    this.ended = false;
    this.Revive();
    this.UI.Announce("SECOND CHANCE!", Pal.hex(0x6fe06a), 1.2);
    Sfx.play(Snd.PowerUp, 0.8);
  }

  private DoubleScore() {
    this.doubled = true;
    const f = this.fields[0];
    const classic = this.mode === Mode.Classic, key = classic ? "best_c" : "best_a";
    f.score *= 2;
    const newBest = this.Data.max(key, f.score);
    const stars = this.StarsFor(f.score, classic ? ClassicStars : ArcadeStars);
    this.Data.add("stars", Math.max(0, stars - this.runStars));
    this.runStars = stars;
    const r = this.lastResult!;
    r.Headline = `${f.score} POINTS`;
    r.Stars = stars;
    r.NewBest = newBest;
    r.BestLine = `DOUBLED!  ·  BEST ${this.Data.get(key)}`;
    r.Stats[3] = ["STARS EARNED", `+${stars}  (★${this.Stars})`];
    r.Reward = null;
    Sfx.play(Snd.Coin, 0.8);
    this.UI.ShowResult(r);
  }

  private DoubleStars() {
    const extra = this.runStars;
    this.Data.add("stars", extra);
    const r = this.lastResult!;
    r.Stats[3] = ["STARS", `+${extra * 2}  (★${this.Stars})`];
    r.BestLine = `STARS DOUBLED!  ·  YOU ${this.fields[0].score} – ${this.fields[1].score} CPU`;
    r.Reward = null;
    Sfx.play(Snd.Coin, 0.8);
    this.UI.ShowResult(r);
  }

  /** Test hook for scripted play (window.__na.game.debugInfo): fruit positions in CSS pixels. */
  get debugInfo() {
    return {
      state: this.State, mode: this.mode, countdown: this.countdown, ended: this.ended, rewarded: AdService.rewardedAvailable,
      fields: this.fields.map((f) => ({
        score: f.score, misses: f.misses, timeLeft: f.timeLeft, active: f.root.activeSelf, W: f.W, s: f.s, rot: f.rot, cut: f.cut, dead: f.dead,
        fruits: f.fruits.filter((x) => x.active).map((x) => {
          const sp = Camera.worldToScreen(this.ToWorld(f, x.pos));
          return { kind: x.kind, bomb: x.kind === Kind.Bomb, x: x.pos.x, y: x.pos.y, vx: x.vel.x, vy: x.vel.y, cx: sp.x / Screen.dpr, cy: sp.y / Screen.dpr };
        }),
      })),
      screen: { w: Screen.width, h: Screen.height },
    };
  }
}

