import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Ease, Fmt, Fx, GameInfo,
  GameObject, howTo, Image, Mathf, Pal, Phase, Quaternion, Result, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer, Text,
  Time, TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import { FruitFusionArt } from "./FruitFusionArt";

/**
 * FRUIT FUSION: drop fruit into a glass jar; two of the same fruit touching merge into the next, bigger one
 * (cherry → strawberry → … → watermelon). Fruit rolls and stacks with real circle physics. If the pile stays
 * above the dashed line for three seconds the game ends. Two boosters (POP a fruit, SHAKE the jar) come once per
 * game and can be refilled with a rewarded ad; a rewarded ad can also clear the top of the jar once to continue.
 * (Port of FruitFusionGame.cs.)
 */

// ------------------------------------------------------------------ tuning

const TopBand = 290, BottomBand = 180;
const JarW = 6.6, JarH = 8.2, Wall = 0.3, DropGap = 1.3;
const Gravity = 20, Restitution = 0.12;
const MaxFruits = 96, Substeps = 6, Iterations = 2;
const DangerSeconds = 3, DropCooldown = 0.42;

const Radius = [0.30, 0.40, 0.50, 0.61, 0.73, 0.87, 1.00, 1.14, 1.28, 1.44, 1.62];
const Points = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66];
const SpawnWeight = [30, 26, 20, 14, 10];

const Ink = Pal.hex(0x5a3020), Cream = Pal.hex(0xfff6e8), Berry = Pal.hex(0xe8405a), Mint = Pal.hex(0x3dbe7a), Gold = Pal.hex(0xffb627);

class Fruit {
  Root!: GameObject;
  Sr!: SpriteRenderer;
  Pos = V2.zero; Vel = V2.zero;
  R = 0; TargetR = 0; Angle = 0; Spin = 0; Age = 0; Pop = 0;
  Tier = 0;
  Active = false; Touched = false; Merging = false;
}

interface MergePair { A: Fruit; B: Fruit }

const Dash = () => CasualArt.make("ff-dashline", 512, 16, (p) => {
  const on = Mathf.repeat(p.x * 7, 1) < 0.62 ? 1 : 0;
  return new Color(1, 1, 1, on * CasualArt.fill(Math.abs(p.y) - 0.018, 2 / 512));
});

const Pin = () => CasualArt.make("ff-pin", 96, 96, (p) => {
  const head = CasualArt.sdCircle(p, new V2(0.22, 0.32), 0.32);
  const needle = CasualArt.sdSegment(p, new V2(0.1, 0.15), new V2(-0.6, -0.65)) - 0.07;
  let c = new Color(1, 1, 1, 0);
  c = CasualArt.over(c, new Color(0.85, 0.88, 0.92, 1), CasualArt.fill(needle, 2 / 96));
  c = CasualArt.over(c, Color.white, CasualArt.fill(head, 2 / 96));
  return c;
});

export class FruitFusionGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject; private jarRoot!: GameObject;
  private bgCover!: SpriteRenderer; private counter!: SpriteRenderer; private counterFill!: SpriteRenderer;
  private jarBack!: SpriteRenderer; private jarFront!: SpriteRenderer; private dangerLine!: SpriteRenderer;
  private guide!: SpriteRenderer; private heldSr!: SpriteRenderer;
  private readonly wallTiles: SpriteRenderer[] = [];
  private fx!: CasualFx;
  private readonly pointer = new TapPointer();

  private readonly fruits: Fruit[] = [];
  private readonly merges: MergePair[] = [];
  private jarOrigin = V2.zero;
  private rng = new SysRandom();

  private heldTier = 0; private nextTier = 0;
  private heldX = 0; private cooldown = 0; private dangerTimer = 0; private warnTimer = 0; private comboTimer = 0; private overTimer = 0; private attractTimer = 0;
  private score = 0; private combo = 0; private mergesRun = 0; private melonsRun = 0; private maxTierRun = 0; private popCharges = 0; private shakeCharges = 0;
  private popMode = false; private gameOver = false; private revived = false;

  // HUD
  private scoreText!: Text; private bestText!: Text; private comboText!: Text;
  private nextImage!: Image;
  private readonly evoIcons: Image[] = [];
  private readonly titleEvo: Image[] = [];
  private popButton!: ArcadeButton; private shakeButton!: ArcadeButton;
  private nextBubble!: UINode;

  private dropClip!: AudioClip; private mergeClip!: AudioClip; private thudClip!: AudioClip; private popClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "fruitfusion",
      Title: "FRUIT FUSION",
      Tagline: "DROP. MERGE. GROW A WATERMELON!",
      Accent: Berry,
      Accent2: Gold,
      BgTop: Pal.hex(0xffe3c8),
      BgBottom: Pal.hex(0xffc9a8),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 104, rootHz: 130.8, degrees: [0, 5, 3, 4], seed: 61, energy: 0.45, major: true },
      Reminders: [
        "The fruit bowl misses you|Two cherries are waiting to become a strawberry.",
        "Watermelon time?|Can you grow the biggest fruit today?",
        "Fresh fruit delivered|Drop, merge and beat your best score.",
      ],
      HowTo: [
        howTo(FruitFusionArt.Fruit(0), Color.white, "DRAG left and right, then LET GO to drop the fruit into the jar."),
        howTo(FruitFusionArt.Fruit(1), Color.white, "Two SAME fruits that touch MERGE into the next, bigger fruit."),
        howTo(FruitFusionArt.Fruit(10), Color.white, "Merge all the way up to the WATERMELON. Two watermelons pop for a huge bonus!"),
        howTo(Art.Chevron, Berry, "Fast merges in a row build a COMBO for extra points."),
        howTo(Art.Diamond, Pal.Danger, "If fruit stays above the dashed line for 3 seconds, the game is over."),
        howTo(Art.Star, Gold, "POP removes one fruit you tap. SHAKE jiggles the whole jar."),
      ],
      Tips: [
        "Keep big fruit on one side and small fruit on the other.",
        "Drop the next fruit right beside its twin to merge it at once.",
        "Watch the NEXT bubble and plan where that fruit will go.",
        "A SHAKE can unstick two twins that are almost touching.",
        "Chain merges quickly to multiply your points with combos.",
      ],
    });
  }

  protected get ShortSide() { return ArcadeGame.FitShortSide(new V2(JarW + Wall * 2 + 1.0, JarH + Wall + DropGap + 2.1), TopBand, BottomBand); }

  protected BestLine() {
    const best = this.Data.get("best");
    const top = this.Data.get("maxTier");
    if (best <= 0) return "MERGE YOUR WAY TO A WATERMELON";
    return `BEST ${Fmt.n(best)}` + (top > 0 ? `   ·   BIGGEST: ${FruitFusionArt.Names[top - 1]}` : "");
  }

  protected StatsLine() {
    return `${Fmt.n(this.Data.get("melons"))} WATERMELONS   ·   ${Fmt.n(this.Data.get("merges"))} MERGES   ·   ${Fmt.n(this.Data.get("runs"))} GAMES`;
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("FruitWorld", this.gameObject);
    CasualLook.calm(this, 1.2, 0.2);

    this.bgCover = CasualLook.cover(this.world, CasualArt.gradient(Pal.hex(0xffe9d2), Pal.hex(0xffc6a4), new Color(1, 1, 1, 0.35)), -910);
    this.counter = Art.spr(this.world, "Counter", FruitFusionArt.Counter, Color.white, 1, -880, Art.Flat);
    this.counterFill = Art.spr(this.world, "CounterFill", Art.Square, Pal.hex(0x8e522a), 1, -881, Art.Flat);

    this.jarRoot = new GameObject("Jar", this.world);
    this.jarBack = Art.spr(this.jarRoot, "JarBack", FruitFusionArt.JarBack, Color.white, 1, -30, Art.Flat);
    this.jarBack.transform.localScale = new V3(JarW, JarH, 1);
    this.jarBack.transform.localPosition = new V3(0, JarH * 0.5, 0);
    const shadow = Art.spr(this.jarRoot, "JarShadow", CasualArt.Soft, new Color(0.35, 0.15, 0.05, 0.28), 1, -870, Art.Flat);
    shadow.transform.localScale = new V3(JarW + 2, 0.9, 1);
    shadow.transform.localPosition = new V3(0, -Wall, 0);
    this.jarFront = Art.spr(this.jarRoot, "JarFront", FruitFusionArt.JarFront(JarW, JarH, Wall), Color.white, JarW + Wall * 2, 30, Art.Flat);
    this.jarFront.transform.localPosition = new V3(0, (JarH + Wall) * 0.5 - Wall, 0);
    this.dangerLine = Art.spr(this.jarRoot, "Danger", Dash(), new Color(1, 0.35, 0.4, 0.55), JarW - 0.2, 25, Art.Flat);
    this.dangerLine.transform.localPosition = new V3(0, this.DangerY, 0);
    this.guide = Art.spr(this.jarRoot, "Guide", Art.Square, new Color(1, 1, 1, 0.45), 1, 5, Art.Flat);
    this.heldSr = Art.spr(this.jarRoot, "Held", FruitFusionArt.Fruit(0), Color.white, 1, 12, Art.Flat);

    for (let i = 0; i < MaxFruits; i++) {
      const root = new GameObject("Fruit", this.jarRoot);
      const sr = Art.spr(root, "Body", FruitFusionArt.Fruit(0), Color.white, 1, 10, Art.Flat);
      root.setActive(false);
      const f = new Fruit();
      f.Root = root;
      f.Sr = sr;
      this.fruits.push(f);
    }

    this.fx = CasualFx.create(this.world, 40);
    this.BuildAudio();
    this.BuildHud();
    this.Layout();
  }

  private BuildAudio() {
    this.dropClip = Sfx.make("ff-drop", 0.14, (t) => Sfx.sinP(Sfx.glide(t, 520, 260, 0.12)) * Sfx.env(t, 0.003, 0.11) * 0.3);
    this.mergeClip = Sfx.make("ff-merge", 0.26, (t) =>
      (Sfx.sinP(Sfx.glide(t, 380, 980, 0.09)) * 0.7 + Sfx.triP(Sfx.glide(t, 760, 1960, 0.09)) * 0.2) * Sfx.env(t, 0.004, 0.2) * 0.34);
    this.thudClip = Sfx.make("ff-thud", 0.1, (t) => Sfx.sinP(Sfx.glide(t, 160, 70, 0.08)) * Sfx.env(t, 0.002, 0.08) * 0.35);
    const noise = new SysRandom(3);
    this.popClip = Sfx.make("ff-pop", 0.18, (t) => (noise.nextDouble() * 2 - 1) * Sfx.env(t, 0.001, 0.05) * 0.25 + Sfx.sinP(Sfx.glide(t, 900, 300, 0.1)) * Sfx.env(t, 0.002, 0.14) * 0.25);
  }

  private BuildHud() {
    const hud = this.UI.Hud;

    this.scoreText = UIKit.at(UIKit.label(hud, "0", 84, Ink), new V2(0.5, 1), new V2(0, -78), new V2(560, 100));
    UIKit.glow(this.scoreText, Color.white.withAlpha(0.9), 4);
    this.bestText = UIKit.at(UIKit.label(hud, "", 28, Ink.withAlpha(0.75)), new V2(0.5, 1), new V2(0, -140), new V2(560, 40));
    this.comboText = UIKit.at(UIKit.label(hud, "", 44, Berry), new V2(0.5, 1), new V2(0, -268), new V2(600, 60));
    UIKit.glow(this.comboText, Color.white, 3);

    // Evolution strip: every fruit in order; reached ones in colour
    const strip = UIKit.img(hud, "EvoStrip", Art.UiRound, Cream.withAlpha(0.8));
    strip.rectTransform.place(new V2(0.5, 1), new V2(0, -205), new V2(820, 84));
    for (let i = 0; i < FruitFusionArt.Tiers; i++) {
      const img = UIKit.img(strip.rectTransform, "Evo" + i, FruitFusionArt.Fruit(i), Color.white);
      const s = 44 + i * 2.4;
      img.rectTransform.place(UIKit.Center, new V2((i - 5) * 72, 0), new V2(s, s));
      img.preserveAspect = true;
      this.evoIcons.push(img);
    }

    // Next fruit bubble
    this.nextBubble = UIKit.img(hud, "NextBubble", Art.UiCircle, Cream.withAlpha(0.92)).rectTransform;
    this.nextBubble.place(new V2(0, 1), new V2(100, -96), new V2(130, 130));
    UIKit.at(UIKit.label(this.nextBubble, "NEXT", 22, Ink), new V2(0.5, 0), new V2(0, -16), new V2(130, 30));
    this.nextImage = UIKit.img(this.nextBubble, "Next", FruitFusionArt.Fruit(0), Color.white);
    this.nextImage.rectTransform.place(UIKit.Center, new V2(0, 4), new V2(96, 96));
    this.nextImage.preserveAspect = true;

    this.popButton = UIKit.buttonAt(hud, "POP", new V2(0, 0), new V2(170, 100), new V2(260, 120), false, () => this.OnPopButton(), 30, Pin());
    this.popButton.setAccent(Berry);
    this.shakeButton = UIKit.buttonAt(hud, "SHAKE", new V2(1, 0), new V2(-170, 100), new V2(260, 120), false, () => this.OnShakeButton(), 30, Art.Chevron);
    this.shakeButton.setAccent(Mint);

    // Title: the fruit collection (silhouettes until reached)
    if (this.UI.TitleExtra) {
      CasualLook.titleCard(this.UI, new Color(0.47, 0.17, 0.22, 0.86));
      for (let i = 0; i < FruitFusionArt.Tiers; i++) {
        const img = UIKit.img(this.UI.TitleExtra, "TitleEvo" + i, FruitFusionArt.Fruit(i), Color.white);
        const s = 58 + i * 3;
        img.rectTransform.place(UIKit.Center, new V2((i - 5) * 88, 0), new V2(s, s));
        img.preserveAspect = true;
        this.titleEvo.push(img);
      }
    }
  }

  // ------------------------------------------------------------------ layout

  private get DangerY() { return JarH - 0.1; }

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);

    const rect = this.PlayRect(TopBand, BottomBand, 0.15);
    const need = Wall + JarH + DropGap + 1.0;
    let bottom = rect.yMin + 0.15;
    if (rect.height > need + 0.3) bottom = rect.yMin + Math.min(0.6, (rect.height - need) * 0.5);
    this.jarOrigin = new V2(0, bottom + Wall);
    this.jarRoot.localPosition = new V3(this.jarOrigin.x, this.jarOrigin.y, 0);

    // Wallpaper tiles (gingham) above the counter
    const tile = 3;
    const cols = Math.ceil(this.ViewSize.x / tile) + 2, rows = Math.ceil(this.ViewSize.y / tile) + 2;
    while (this.wallTiles.length < cols * rows) this.wallTiles.push(Art.spr(this.world, "Wall", FruitFusionArt.Wallpaper, new Color(1, 1, 1, 0.55), tile + 0.01, -905, Art.Flat));
    for (let i = 0; i < this.wallTiles.length; i++) {
      const on = i < cols * rows;
      this.wallTiles[i].gameObject.setActive(on);
      if (!on) continue;
      const cx = i % cols, cy = Math.trunc(i / cols);
      this.wallTiles[i].transform.localPosition = new V3((cx - cols * 0.5 + 0.5) * tile, (cy - rows * 0.5 + 0.5) * tile, 0);
    }

    const counterTop = bottom + 0.15;
    this.counter.transform.localScale = new V3(this.ViewSize.x + 2, 1.1 / 0.25, 1);
    this.counter.transform.localPosition = new V3(0, counterTop - 0.55, 0);
    const fillH = Math.max(0.1, counterTop - 1.1 + this.ViewSize.y * 0.5 + 1);
    this.counterFill.transform.localScale = new V3(this.ViewSize.x + 2, fillH, 1);
    this.counterFill.transform.localPosition = new V3(0, counterTop - 1.1 - fillH * 0.5 + 0.02, 0);
  }

  // ------------------------------------------------------------------ run lifecycle

  protected OnEnterTitle() {
    this.ClearFruits(false);
    this.gameOver = false;
    this.popMode = false;
    this.heldSr.gameObject.setActive(false);
    this.guide.gameObject.setActive(false);
    this.dangerLine.color = new Color(1, 0.35, 0.4, 0.4);
    this.attractTimer = 0.3;
    this.rng = new SysRandom();
    this.RefreshTitle();
  }

  private RefreshTitle() {
    const top = this.Data.get("maxTier");
    for (let i = 0; i < this.titleEvo.length; i++) {
      const reached = i < Math.max(top, 5);
      this.titleEvo[i].sprite = reached ? FruitFusionArt.Fruit(i) : FruitFusionArt.Fruit(i, true);
      this.titleEvo[i].color = reached ? Color.white : new Color(0.2, 0.08, 0.1, 0.55);
    }
  }

  protected BeginRun() {
    this.ClearFruits(false);
    this.Layout();
    this.rng = new SysRandom();
    this.score = this.combo = this.mergesRun = this.melonsRun = 0;
    this.maxTierRun = 0;
    this.dangerTimer = this.warnTimer = this.comboTimer = this.overTimer = 0;
    this.popCharges = 1;
    this.shakeCharges = 1;
    this.popMode = this.gameOver = this.revived = false;
    this.heldTier = this.RollTier();
    this.nextTier = this.RollTier();
    this.heldX = 0;
    this.cooldown = 0;
    this.pointer.reset();
    this.pointer.topBand = 0.14;
    this.comboText.text = "";
    this.UpdateHud();
    if (this.Data.get("runs") === 0) this.UI.Hint("Drag to aim, let go to drop. Match two fruits to merge them!");
    this.Data.add("runs", 1);
    Sfx.setIntensity(0.25);
  }

  private RollTier() {
    let total = 0;
    for (const w of SpawnWeight) total += w;
    let r = this.rng.next(total);
    for (let i = 0; i < SpawnWeight.length; i++) {
      if (r < SpawnWeight[i]) return i;
      r -= SpawnWeight[i];
    }
    return 0;
  }

  private ClearFruits(burst: boolean) {
    for (const f of this.fruits) {
      if (!f.Active) continue;
      if (burst) this.fx.pop(this.ToWorld(f.Pos), FruitFusionArt.Juice[f.Tier], 8, 3, 0.25, 0.4);
      this.Despawn(f);
    }
    this.merges.length = 0;
    if (!burst) this.fx.clear();
  }

  private ToWorld(local: V2) { return this.jarOrigin.add(local); }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.State !== Phase.Title) { this.Present(dt); return; }
    // Attract mode: fruit rains into the jar and merges on its own.
    this.attractTimer -= dt;
    if (this.attractTimer <= 0) {
      this.attractTimer = 0.7;
      const tier = this.RollTier();
      const x = (this.rng.nextDouble() * 2 - 1) * (JarW * 0.5 - Radius[tier]);
      this.Spawn(tier, new V2(x, JarH + 0.6), new V2(0, -1), false);
    }
    this.Simulate(dt, false);
    for (const f of this.fruits) {
      if (f.Active && f.Touched && f.Age > 1.5 && f.Pos.y + f.R > this.DangerY) {
        this.ClearFruits(true);
        Sfx.playClip(this.popClip, 0.4);
        break;
      }
    }
    this.Present(dt);
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);

    if (this.gameOver) {
      this.overTimer += dt;
      this.Present(dt);
      if (this.overTimer > 1.3 && this.State === Phase.Playing) this.Lose();
      return;
    }

    this.HandleInput(dt);
    this.Simulate(dt, true);
    this.UpdateDanger(dt);
    this.Present(dt);
    this.UpdateHud();
  }

  private HandleInput(dt: number) {
    const half = JarW * 0.5 - Radius[this.heldTier];
    if (Math.abs(this.Controls.move.x) > 0.1) this.heldX += this.Controls.move.x * 7 * dt;

    if (this.popMode) {
      if (this.pointer.tap) {
        const local = this.ScreenToWorld(this.pointer.screen).sub(this.jarOrigin);
        let hit: Fruit | null = null;
        let bestD = 9;
        for (const f of this.fruits) {
          if (!f.Active) continue;
          const d = f.Pos.sub(local).magnitude - f.R;
          if (d < 0.25 && d < bestD) { bestD = d; hit = f; }
        }
        if (hit) {
          this.popCharges--;
          this.popMode = false;
          this.UI.Hint(null);
          this.fx.pop(this.ToWorld(hit.Pos), FruitFusionArt.Juice[hit.Tier], 16, 5, 0.3, 0.5);
          this.fx.sparkle(this.ToWorld(hit.Pos), Color.white, 5, hit.R);
          Sfx.playClip(this.popClip, 0.9);
          Fx.haptic();
          this.Despawn(hit);
        }
      }
      this.heldX = Mathf.clamp(this.heldX, -half, half);
      return;
    }

    if (this.pointer.held || this.pointer.up) {
      const x = this.ScreenToWorld(this.pointer.screen).x - this.jarOrigin.x;
      this.heldX = x;
    }
    this.heldX = Mathf.clamp(this.heldX, -half, half);

    this.cooldown -= dt;
    const drop = (this.pointer.up || this.Controls.actionPressed) && this.cooldown <= 0;
    if (drop) {
      this.Spawn(this.heldTier, new V2(this.heldX, this.HeldY), new V2(0, -2), false);
      Sfx.playClip(this.dropClip, 0.7, 1 + (4 - this.heldTier) * 0.05);
      this.heldTier = this.nextTier;
      this.nextTier = this.RollTier();
      this.cooldown = DropCooldown;
      Fx.haptic();
    }
  }

  private get HeldY() { return JarH + DropGap * 0.6 + Radius[4] * 0.5; }

  // ------------------------------------------------------------------ physics

  private Spawn(tier: number, pos: V2, vel: V2, merged: boolean): Fruit | null {
    let f: Fruit | null = null;
    for (const c of this.fruits) if (!c.Active) { f = c; break; }
    if (!f) return null;
    f.Active = true;
    f.Tier = tier;
    f.TargetR = Radius[tier];
    f.R = merged ? Math.max(Radius[Math.max(0, tier - 1)], Radius[tier] * 0.85) : Radius[tier];
    f.Pos = pos;
    f.Vel = vel;
    f.Angle = this.rng.nextDouble() * 30 - 15;
    f.Spin = 0;
    f.Age = merged ? 1 : 0;
    f.Pop = merged ? 0 : 1;
    f.Touched = merged;
    f.Merging = false;
    f.Sr.sprite = FruitFusionArt.Fruit(tier);
    f.Sr.sortingOrder = 10 + tier;
    f.Root.setActive(true);
    return f;
  }

  private Despawn(f: Fruit) {
    f.Active = false;
    f.Merging = false;
    f.Root.setActive(false);
  }

  private Simulate(dt: number, scoring: boolean) {
    dt = Math.min(dt, 1 / 30);
    const h = dt / Substeps;
    const wall = JarW * 0.5;
    for (let s = 0; s < Substeps; s++) {
      for (let i = 0; i < MaxFruits; i++) {
        const f = this.fruits[i];
        if (!f.Active) continue;
        if (f.R < f.TargetR) f.R = Mathf.moveTowards(f.R, f.TargetR, h * 2.5);
        f.Vel = new V2(f.Vel.x, f.Vel.y - Gravity * h);
        f.Vel = f.Vel.mul(1 - 0.25 * h);
        f.Pos = f.Pos.add(f.Vel.mul(h));
      }
      for (let it = 0; it < Iterations; it++) {
        for (let i = 0; i < MaxFruits; i++) {
          const a = this.fruits[i];
          if (!a.Active) continue;
          for (let j = i + 1; j < MaxFruits; j++) {
            const b = this.fruits[j];
            if (b.Active) this.Collide(a, b);
          }
          this.Walls(a, wall);
        }
      }
      if (this.merges.length > 0) this.ProcessMerges(scoring);
    }
    for (let i = 0; i < MaxFruits; i++) {
      const f = this.fruits[i];
      if (!f.Active) continue;
      f.Age += dt;
      f.Angle += f.Spin * dt;
      f.Pop = Math.min(1, f.Pop + dt * 4);
    }
  }

  private Collide(a: Fruit, b: Fruit) {
    const dx = b.Pos.x - a.Pos.x, dy = b.Pos.y - a.Pos.y;
    const rs = a.R + b.R;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rs * rs) return;
    const dist = Math.sqrt(d2);
    const n = dist > 1e-5 ? new V2(dx / dist, dy / dist) : V2.up;

    if (a.Tier === b.Tier && !a.Merging && !b.Merging && (a.Touched || b.Touched)) {
      a.Merging = b.Merging = true;
      this.merges.push({ A: a, B: b });
    }

    const overlap = rs - dist;
    const ma = a.R * a.R, mb = b.R * b.R;
    const wa = mb / (ma + mb), wb = ma / (ma + mb);
    a.Pos = a.Pos.sub(n.mul(overlap * wa));
    b.Pos = b.Pos.add(n.mul(overlap * wb));
    const vn = V2.dot(b.Vel.sub(a.Vel), n);
    if (vn < 0) {
      const j = -(1 + Restitution) * vn;
      a.Vel = a.Vel.sub(n.mul(j * wa));
      b.Vel = b.Vel.add(n.mul(j * wb));
      const t = new V2(-n.y, n.x);
      const vt = V2.dot(b.Vel.sub(a.Vel), t) * 0.12;
      a.Vel = a.Vel.add(t.mul(vt * wa));
      b.Vel = b.Vel.sub(t.mul(vt * wb));
      if (!a.Touched || !b.Touched) {
        if (-vn > 3) Sfx.playClip(this.thudClip, Mathf.clamp01(-vn / 10) * 0.6, 1.2 - Math.max(a.Tier, b.Tier) * 0.04);
      }
    }
    a.Touched = b.Touched = true;
    const roll = -V2.dot(a.Vel.sub(b.Vel), new V2(-n.y, n.x)) * Mathf.Rad2Deg;
    a.Spin = Mathf.lerp(a.Spin, roll / a.R, 0.08);
    b.Spin = Mathf.lerp(b.Spin, -roll / b.R, 0.08);
  }

  private Walls(f: Fruit, wall: number) {
    if (f.Pos.x - f.R < -wall) {
      f.Pos = f.Pos.withX(-wall + f.R);
      if (f.Vel.x < 0) f.Vel = f.Vel.withX(f.Vel.x * -0.2);
      f.Touched ||= f.Pos.y < JarH;
    } else if (f.Pos.x + f.R > wall) {
      f.Pos = f.Pos.withX(wall - f.R);
      if (f.Vel.x > 0) f.Vel = f.Vel.withX(f.Vel.x * -0.2);
      f.Touched ||= f.Pos.y < JarH;
    }
    if (f.Pos.y - f.R < 0) {
      f.Pos = f.Pos.withY(f.R);
      if (f.Vel.y < 0) {
        if (!f.Touched && f.Vel.y < -3) Sfx.playClip(this.thudClip, Mathf.clamp01(-f.Vel.y / 10) * 0.6, 1.2 - f.Tier * 0.04);
        f.Vel = f.Vel.withY(f.Vel.y * -0.15);
      }
      f.Vel = f.Vel.withX(f.Vel.x * 0.97);
      f.Touched = true;
      f.Spin = Mathf.lerp(f.Spin, (-f.Vel.x / f.R) * Mathf.Rad2Deg, 0.2);
    }
  }

  private ProcessMerges(scoring: boolean) {
    for (let i = 0; i < this.merges.length; i++) {
      const m = this.merges[i];
      if (!m.A.Active || !m.B.Active) continue;
      const tier = m.A.Tier;
      const ma = m.A.R * m.A.R, mb = m.B.R * m.B.R;
      const pos = m.A.Pos.mul(ma).add(m.B.Pos.mul(mb)).mul(1 / (ma + mb));
      const vel = m.A.Vel.add(m.B.Vel).mul(0.5);
      this.Despawn(m.A);
      this.Despawn(m.B);
      const wp = this.ToWorld(pos);

      if (tier >= FruitFusionArt.Tiers - 1) {
        // Two watermelons: a juicy explosion and a big bonus
        this.fx.confetti(wp, 60, 9, [Berry, Gold, Mint, Pal.hex(0x58b7ff), Color.white]);
        this.fx.pop(wp, FruitFusionArt.Juice[tier], 30, 7, 0.4, 0.7);
        Sfx.play(Snd.Win, 0.8);
        if (scoring) {
          this.AddScore(Points[tier] * 10, wp);
          this.melonsRun++;
          this.UI.Announce("MELON SMASH!", Mint, 1.4);
        }
        this.Fx.shake(0.4);
        continue;
      }

      const next = tier + 1;
      const f = this.Spawn(next, pos, vel.add(V2.up.mul(1.2)), true);
      if (!f) continue;
      this.fx.pop(wp, FruitFusionArt.Juice[tier], 10 + next * 2, 3.5 + next * 0.3, 0.2 + next * 0.02, 0.45);
      this.fx.sparkle(wp, Color.white, 3 + Math.trunc(next / 2), Radius[next] * 0.8, 0.25 + next * 0.02);
      Sfx.playClip(this.mergeClip, 0.75, Mathf.clamp(1.35 - next * 0.06, 0.7, 1.4));
      if (next >= 7) this.Fx.shake(0.12 + (next - 7) * 0.05);
      if (!scoring) continue;

      this.mergesRun++;
      this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
      this.comboTimer = 1.3;
      const pts = Points[next] * Math.min(this.combo, 8);
      this.AddScore(pts, wp);
      if (this.combo >= 2) {
        this.comboText.text = `COMBO x${this.combo}!`;
        Sfx.play(Snd.Coin, 0.4, 1 + this.combo * 0.06);
      }
      if (next > this.maxTierRun) {
        this.maxTierRun = next;
        if (next >= 6 && next + 1 > this.Data.get("maxTier")) this.UI.Announce(`NEW: ${FruitFusionArt.Names[next]}!`, Gold, 1.4);
        if (next + 1 > this.Data.get("maxTier")) this.Data.set("maxTier", next + 1);
      }
      if (next === FruitFusionArt.Tiers - 1) {
        this.UI.Announce("WATERMELON!", Mint, 1.6);
        this.fx.confetti(wp, 40, 8, [Berry, Gold, Mint, Color.white]);
        Sfx.play(Snd.NewBest, 0.8);
      }
      Fx.haptic(next >= 8);
    }
    this.merges.length = 0;
  }

  private AddScore(pts: number, world: V2) {
    this.score += pts;
    this.UI.Float(world, "+" + pts, Ink, 0.9 + Math.min(0.6, pts / 200));
  }

  private UpdateDanger(dt: number) {
    let over = false;
    for (const f of this.fruits) {
      if (f.Active && f.Touched && f.Age > 1.0 && f.Pos.y + f.R * 0.85 > this.DangerY && f.Vel.sqrMagnitude < 9) {
        over = true;
        break;
      }
    }
    if (over) {
      this.dangerTimer += dt;
      this.warnTimer -= dt;
      if (this.warnTimer <= 0) {
        this.warnTimer = 0.6;
        Sfx.play(Snd.Warn, 0.5);
      }
      if (this.dangerTimer >= DangerSeconds) {
        this.gameOver = true;
        this.overTimer = 0;
        this.popMode = false;
        this.UI.Hint(null);
        this.heldSr.gameObject.setActive(false);
        this.guide.gameObject.setActive(false);
        Sfx.play(Snd.Lose, 0.8);
        this.Fx.shake(0.3);
        this.UI.Announce("JAR FULL!", Pal.Danger, 1.2);
      }
    } else this.dangerTimer = Math.max(0, this.dangerTimer - dt * 2);

    this.comboTimer -= dt;
    if (this.comboTimer <= 0 && this.comboText.text.length > 0) this.comboText.text = "";
  }

  // ------------------------------------------------------------------ presentation

  private Present(_dt: number) {
    for (const f of this.fruits) {
      if (!f.Active) continue;
      const pop = f.Pop < 1 ? Mathf.lerp(0.7, 1, Ease.outBack(f.Pop)) : 1;
      const s = (f.R / FruitFusionArt.BodyFrac) * 2 * pop;
      f.Root.localPosition = new V3(f.Pos.x, f.Pos.y, 0);
      f.Root.localRotation = Quaternion.euler(0, 0, f.Angle);
      f.Sr.transform.localScale = new V3(s, s, 1);
      f.Sr.color = this.gameOver ? Color.lerp(Color.white, new Color(0.6, 0.6, 0.65, 1), Mathf.clamp01(this.overTimer * 2)) : Color.white;
    }

    const showHeld = this.State === Phase.Playing && !this.gameOver && this.cooldown <= 0;
    this.heldSr.gameObject.setActive(showHeld);
    this.guide.gameObject.setActive(showHeld && !this.popMode);
    if (showHeld) {
      const r = Radius[this.heldTier];
      const s = (r / FruitFusionArt.BodyFrac) * 2;
      const bob = Math.sin(Time.time * 4) * 0.04;
      this.heldSr.sprite = FruitFusionArt.Fruit(this.heldTier);
      this.heldSr.transform.localPosition = new V3(this.heldX, this.HeldY + bob, 0);
      this.heldSr.transform.localScale = new V3(s, s, 1);
      this.heldSr.color = this.popMode ? new Color(1, 1, 1, 0.35) : Color.white;
      const surface = this.SurfaceBelow(this.heldX, r * 0.6);
      const top = this.HeldY - r;
      const len = Math.max(0.05, top - surface);
      this.guide.transform.localScale = new V3(0.05, len, 1);
      this.guide.transform.localPosition = new V3(this.heldX, surface + len * 0.5, 0);
    }

    const k = this.dangerTimer / DangerSeconds;
    const pulse = k > 0 ? 0.5 + 0.5 * Math.sin(Time.time * (8 + k * 14)) : 0;
    this.dangerLine.color = k > 0 ? Color.lerp(new Color(1, 0.35, 0.4, 0.6), new Color(1, 0.1, 0.15, 1), pulse) : new Color(1, 0.35, 0.4, 0.45);
  }

  private SurfaceBelow(x: number, halfWidth: number) {
    let best = 0;
    for (const f of this.fruits) {
      if (!f.Active) continue;
      const dx = Math.abs(f.Pos.x - x);
      const reach = f.R + halfWidth;
      if (dx >= reach) continue;
      const yTop = f.Pos.y + Math.sqrt(Math.max(0, reach * reach - dx * dx)) - halfWidth;
      if (yTop > best && f.Pos.y < this.HeldY - 0.5) best = yTop;
    }
    return Math.min(best, this.HeldY - Radius[this.heldTier]);
  }

  private UpdateHud() {
    FruitFusionGame.SetText(this.scoreText, Fmt.n(this.score));
    const best = Math.max(this.Data.get("best"), this.score);
    FruitFusionGame.SetText(this.bestText, "BEST " + Fmt.n(best));
    if (this.nextImage.sprite !== FruitFusionArt.Fruit(this.nextTier)) this.nextImage.sprite = FruitFusionArt.Fruit(this.nextTier);
    const reached = Math.max(this.Data.get("maxTier"), this.maxTierRun + 1);
    for (let i = 0; i < this.evoIcons.length; i++) {
      const on = i < Math.max(reached, 5);
      const c = on ? Color.white : new Color(0.35, 0.2, 0.15, 0.35);
      if (!this.evoIcons[i].color.equals(c)) {
        this.evoIcons[i].color = c;
        this.evoIcons[i].sprite = on ? FruitFusionArt.Fruit(i) : FruitFusionArt.Fruit(i, true);
      }
      const target = i === this.maxTierRun ? 1.18 : 1;
      const sc = this.evoIcons[i].rectTransform.localScale;
      const v = Mathf.moveTowards(sc.x, target, Time.deltaTime * 2);
      this.evoIcons[i].rectTransform.localScale = new V3(v, v, 1);
    }
    this.BoosterLabel(this.popButton, "POP", this.popCharges, this.popMode);
    this.BoosterLabel(this.shakeButton, "SHAKE", this.shakeCharges, false);
  }

  private static SetText(t: Text | null, s: string) {
    if (t && t.text !== s) t.text = s;
  }

  private BoosterLabel(b: ArcadeButton | null, name: string, charges: number, active: boolean) {
    if (!b || !b.label) return;
    const s = active ? "CANCEL" : charges > 0 ? `${name} ×${charges}` : AdService.rewardedAvailable ? `${name} +AD` : name;
    FruitFusionGame.SetText(b.label, s);
    b.interactable = !this.gameOver && (charges > 0 || active || AdService.rewardedAvailable);
  }

  // ------------------------------------------------------------------ boosters

  private OnPopButton() {
    if (this.State !== Phase.Playing || this.gameOver) return;
    if (this.popMode) {
      this.popMode = false;
      this.UI.Hint(null);
      return;
    }
    if (this.popCharges > 0) {
      this.popMode = true;
      this.UI.Hint("Tap a fruit to POP it.");
      Sfx.play(Snd.Click);
      return;
    }
    if (!AdService.rewardedAvailable) return;
    AdService.showRewarded((ok) => {
      if (!ok) return;
      this.popCharges++;
      this.UI.Toast("+1 POP", 2);
      Sfx.play(Snd.PowerUp, 0.7);
    });
  }

  private OnShakeButton() {
    if (this.State !== Phase.Playing || this.gameOver) return;
    if (this.shakeCharges > 0) {
      this.shakeCharges--;
      this.ShakeJar();
      return;
    }
    if (!AdService.rewardedAvailable) return;
    AdService.showRewarded((ok) => {
      if (!ok) return;
      this.shakeCharges++;
      this.UI.Toast("+1 SHAKE", 2);
      Sfx.play(Snd.PowerUp, 0.7);
    });
  }

  private ShakeJar() {
    for (const f of this.fruits) {
      if (!f.Active) continue;
      f.Vel = f.Vel.add(new V2((this.rng.nextDouble() * 2 - 1) * 3.5, 4 + this.rng.nextDouble() * 3).mul(1 / Math.max(0.6, f.R)));
    }
    this.Fx.shake(0.45);
    Fx.haptic(true);
    Sfx.play(Snd.Whoosh, 0.8);
    this.dangerTimer = 0;
  }

  // ------------------------------------------------------------------ results

  private Lose() {
    const newBest = this.Data.max("best", this.score);
    this.Data.add("merges", this.mergesRun);
    this.Data.add("melons", this.melonsRun);
    const biggest = this.maxTierRun;
    this.Finish(new Result({
      Headline: newBest ? "NEW HIGH SCORE!" : "THE JAR IS FULL",
      HeadlineColor: newBest ? Gold : Pal.hex(0xffd2c2),
      Value: Fmt.n(this.score),
      CountTo: this.score,
      NewBest: newBest,
      BestLine: `BIGGEST FRUIT: ${FruitFusionArt.Names[biggest]}`,
      Stats: [
        ["SCORE", Fmt.n(this.score)],
        ["MERGES", String(this.mergesRun)],
        ["WATERMELONS", String(this.melonsRun)],
        ["BEST", Fmt.n(this.Data.get("best"))],
      ],
      Primary: "PLAY AGAIN",
      Reward: this.revived ? null : () => this.Continue(),
      RewardLabel: "CLEAR THE TOP & CONTINUE (AD)",
    }));
  }

  private Continue() {
    this.revived = true;
    this.gameOver = false;
    this.dangerTimer = 0;
    // Pop every fruit in the top half of the jar
    for (const f of this.fruits) {
      if (!f.Active || f.Pos.y < JarH * 0.5) continue;
      this.fx.pop(this.ToWorld(f.Pos), FruitFusionArt.Juice[f.Tier], 10, 4, 0.28, 0.5);
      this.Despawn(f);
    }
    for (const f of this.fruits) if (f.Active) f.Sr.color = Color.white;
    this.cooldown = 0.6;
    this.pointer.reset();
    this.Revive();
    this.UI.Announce("FRESH START!", Mint, 1.3);
    Sfx.play(Snd.PowerUp);
  }
}
