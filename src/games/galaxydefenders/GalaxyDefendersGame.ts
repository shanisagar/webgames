import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, Camera, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject, howTo,
  Image, Keyboard, LoopSource, Mathf, Mesh, MeshRenderer, Mouse, overUI, Pal, Phase, Random, Result, Screen, Sfx, Snd, SpriteRenderer,
  SysRandom, Text, TextAnchor, Time, Touchscreen, TouchScheme, UIKit, UINode, V2, V3,
} from "../../kit";
import { AlienColors, AlienPoints, ArmorColor, BunkerMask, GalaxyArt } from "./GalaxyArt";

/**
 * GALAXY DEFENDERS: a neon fixed-shooter. Rows of invaders march side to side, step down at the edges and speed up
 * as they thin out. Hide behind bunkers that erode pixel by pixel, shoot the saucer for bonus points and power-ups
 * (RAPID, SPREAD, SHIELD), and beat the mothership every fifth wave. Drag to move (or keys), auto-fire or tap-to-fire.
 * Modes: SOLO (lives, waves, high score), VS CPU (split screen race: clearing a wave sends invaders to the rival,
 * bot with three levels), 2 PLAYERS (split screen, or CO-OP on one shared field). Rewarded: extra life continue.
 */

const BaseH = 16;
const BunkerCols = 20, BunkerRows = 14, Cell = 0.072;
const CannonSpeed = 9.5;
const RoundTime = 120;
const DiffNames = ["EASY", "MEDIUM", "HARD"];
const P1 = Pal.hex(0x3ae8ff), P2 = Pal.hex(0xff9a2a), CpuCol = Pal.hex(0xff4a5a), Gold = Pal.hex(0xffd25a), Green = Pal.hex(0x39ff88), Pink = Pal.hex(0xff4fd8);

enum Mode { Solo, VsCpu, Split, Coop }

class Alien { sr!: SpriteRenderer; kind = 0; armor = false; hp = 1; col = 0; row = 0; alive = false; flash = 0; enter = 0; }
class Shot { sr!: SpriteRenderer; pos = V2.zero; vel = V2.zero; kind = 0; friendly = false; owner = -1; active = false; t = 0; }
class Pickup { sr!: SpriteRenderer; pos = V2.zero; kind = 0; active = false; t = 0; }
class Bunker { mesh!: Mesh; mr!: MeshRenderer; cells: boolean[] = []; cx = 0; cy = 0; dirty = true; }
class Ufo { sr!: SpriteRenderer; active = false; x = 0; dir = 1; worth = 100; t = 0; }
class Boss { sr!: SpriteRenderer; active = false; hp = 0; max = 1; t = 0; x = 0; y = 0; fireT = 0; pattern = 0; flash = 0; }

class Bot {
  diff = 1; think = 0; targetX = 0; dodging = false;
}

class Cannon {
  idx = 0;
  sr!: SpriteRenderer; glow!: SpriteRenderer; bubble!: SpriteRenderer;
  x = 0; targetX = 0; hasTarget = false;
  alive = true; out = false; respawn = 0; invuln = 0;
  fireCd = 0; rapid = 0; spread = 0; shield = false;
  lives = 3; score = 0; extraAt = 2000;
  kills = 0; shotsFired = 0; hits = 0; ufos = 0;
  human = true; bot: Bot | null = null; color = P1; name = "";
  fireRequest = false; keyFire = false; keyMove = 0;
  field!: Field;
}

interface Bind { cannon: Cannon; startLocal: number; startX: number; t0: number; moved: boolean; }

class FieldHud {
  node!: UINode;
  score: Text[] = []; sub: Text[] = []; lives: Image[][] = [];
  wave!: Text; timer!: Text;
  bossBar!: UINode; bossFill!: Image;
  floats: { t: Text; age: number; start: V2 }[] = [];
  k = 100; w = 1000; h = 1000; rOff = 70;
}

class Field {
  index = 0;
  root!: GameObject;
  W = 10; H = 16; s = 1; rot = 0; active = true;
  aliens: Alien[] = [];
  shots: Shot[] = [];
  pickups: Pickup[] = [];
  bunkers: Bunker[] = [];
  ufo = new Ufo(); boss = new Boss();
  cannons: Cannon[] = [];
  cols = 8; dx = 0.9; dy = 0.78;
  ox = 0; oy = 0; dir = 1; stepT = 0; frame = 0; total = 1; stepIdx = 0;
  wave = 0; between = 0; started = false; fireT = 2; ufoT = 20; extra = 0;
  over = false; invaded = false;
  ground!: SpriteRenderer; frameSr!: SpriteRenderer; edge!: SpriteRenderer;
  fx!: CasualFx;
  hud!: FieldHud;
  rng = new SysRandom(1);
}

const set = (t: Text | null | undefined, s: string) => { if (t && t.text !== s) t.text = s; };

export class GalaxyDefendersGame extends ArcadeGame {
  private world!: GameObject;
  private cover!: SpriteRenderer;
  private scan!: SpriteRenderer; private vig!: SpriteRenderer;
  private stars: { sr: SpriteRenderer; pos: V2; speed: number }[] = [];
  private divider!: SpriteRenderer;
  private fields: Field[] = [];
  private binds = new Map<number, Bind>();
  private mode = Mode.Solo;
  private diff = 1;
  private tapFire = false;
  private timeLeft = 0;
  private countdown = 0; private countStep = -1;
  private ended = false; private endTimer = 0; private endHead = "";
  private revived = false;
  private usingTouch = false;
  private marchNote = 0;

  private modeButtons: ArcadeButton[] = [];
  private optButtons: ArcadeButton[] = [];

  private shootClip!: AudioClip; private alienBoom!: AudioClip; private playerBoom!: AudioClip; private ufoClip!: AudioClip;
  private marchClips: AudioClip[] = []; private bunkerClip!: AudioClip; private bossHit!: AudioClip;
  private ufoLoop: LoopSource | null = null;

  protected Describe() {
    return new GameInfo({
      Id: "galaxydefenders",
      Title: "GALAXY DEFENDERS",
      Tagline: "DRAG TO MOVE. FIRE AT WILL.",
      Accent: P1,
      Accent2: Pink,
      BgTop: Pal.hex(0x120a2e),
      BgBottom: Pal.hex(0x05030f),
      GridSpacing: 1.6,
      ShortSide: 10,
      Touch: TouchScheme.None,
      HomeBesidePause: true,
      Music: { bpm: 124, rootHz: 73.4, degrees: [0, 5, 3, 4], seed: 81, energy: 0.75 },
      Reminders: [
        "The invaders are back|Defend the planet and beat your high score.",
        "The mothership approaches|Can you reach wave 5?",
        "Challenge the CPU|Clear waves fast to send invaders its way.",
      ],
      HowTo: [
        howTo(GalaxyArt.Cannon(), P1, "DRAG anywhere to move your cannon (or A/D, arrow keys). Fire is AUTO, or TAP to fire (change it on the title screen)."),
        howTo(GalaxyArt.Alien(2, 0), Pink, "Shoot every invader. They speed up as their numbers thin out: 10, 20 and 30 points."),
        howTo(GalaxyArt.Alien(1, 0, true), ArmorColor, "Gold ARMOURED invaders take two hits. Don't let any of them land!"),
        howTo(GalaxyArt.Saucer(), Color.white, "Hit the SAUCER for bonus points and a power-up."),
        howTo(GalaxyArt.Capsule(0), Color.white, "Catch power-ups: RAPID fire, SPREAD shot and a SHIELD that blocks one hit."),
        howTo(GalaxyArt.Boss(), Color.white, "Every 5th wave the MOTHERSHIP attacks. Hide behind the bunkers!"),
        howTo(Art.Ring, P2, "VS CPU / 2 PLAYERS: clear a wave to send extra invaders to your rival. CO-OP shares one field."),
      ],
      Tips: [
        "Thin out the outer columns first: the fleet then takes longer to reach the edge.",
        "Shots can cancel each other out: shoot down a bomb that's about to hit you.",
        "The last invader is very fast. Lead your shot!",
        "Bunkers protect you, but your own shots wear them away too.",
        "The saucer is worth up to 300 points.",
      ],
    });
  }

  protected get ShortSide() { return 10; }

  private get Group() { return Mathf.clamp(this.Data.get("group"), 0, 2); }
  private get SelMode(): Mode { const g = this.Group; return g === 0 ? Mode.Solo : g === 1 ? Mode.VsCpu : this.Data.get("coop") === 1 ? Mode.Coop : Mode.Split; }
  private get Crt() { return this.Data.get("crt", 1) === 1; }

  protected BestLine() {
    switch (this.SelMode) {
      case Mode.Solo: return `HIGH SCORE ${Fmt.n(this.Data.get("best"))}  ·  BEST WAVE ${Math.max(1, this.Data.get("bestWave"))}`;
      case Mode.VsCpu: { const d = Mathf.clamp(this.Data.get("diff", 1), 0, 2); return `VS CPU ${DiffNames[d]}:  ${this.Data.get("w" + d)} WON · ${this.Data.get("l" + d)} LOST`; }
      case Mode.Coop: return `CO-OP BEST ${Fmt.n(this.Data.get("bestCoop"))}`;
      default: return `PLAYER 1  ${this.Data.get("p0")} – ${this.Data.get("p1")}  PLAYER 2`;
    }
  }
  protected StatsLine() { return ""; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("GalaxyWorld", this.gameObject);
    this.cover = CasualLook.cover(this.world, GalaxyArt.Space(), -910);
    for (let i = 0; i < 70; i++) {
      const sr = Art.spr(this.world, "Star", Art.Glow, Color.white.withAlpha(0.6), 0.1, -880, Art.Additive);
      this.stars.push({ sr, pos: new V2(Random.range(-12, 12), Random.range(-12, 12)), speed: Random.range(0.15, 0.9) });
    }
    this.divider = Art.spr(this.world, "Divider", Art.Square, new Color(1, 1, 1, 0.5), 1, -700, Art.Additive);
    this.scan = Art.spr(this.world, "Scan", GalaxyArt.Scanlines(), new Color(1, 1, 1, 0.55), 1, 900, Art.Flat);
    this.vig = Art.spr(this.world, "CrtVig", GalaxyArt.CrtVignette(), Color.white, 1, 901, Art.Flat);
    for (let i = 0; i < 2; i++) this.fields.push(this.MakeField(i));

    // sounds
    this.shootClip = Sfx.make("gd-shoot", 0.16, (t) => Sfx.sqrP(Sfx.glide(t, 1400, 500, 0.12)) * Sfx.env(t, 0.003, 0.14) * 0.18);
    const rng = new SysRandom(7);
    let lp = 0;
    this.alienBoom = Sfx.make("gd-aboom", 0.3, (t) => {
      lp += (rng.nextDouble() * 2 - 1 - lp) * 0.35;
      return (lp * 0.9 + Sfx.sqrP(Sfx.glide(t, 600, 90, 0.25)) * 0.25) * Sfx.env(t, 0.002, 0.28) * 0.5;
    });
    const rng2 = new SysRandom(8);
    let lp2 = 0;
    this.playerBoom = Sfx.make("gd-pboom", 1.0, (t) => {
      lp2 += (rng2.nextDouble() * 2 - 1 - lp2) * 0.12;
      return (lp2 * 1.6 + Sfx.sawP(Sfx.glide(t, 220, 40, 0.8)) * 0.2) * Sfx.env(t, 0.005, 0.95) * 0.6;
    });
    this.ufoClip = Sfx.make("gd-ufo", 0.5, (t) => Sfx.sinP(Sfx.glide(t, 700, 700, 0.5) + Math.sin(t * Math.PI * 2 * 8) * 9) * 0.12 + Sfx.sqrP(1400 * t + Math.sin(t * Math.PI * 2 * 8) * 4) * 0.03, false);
    for (const f of [98, 87.3, 77.8, 73.4]) this.marchClips.push(Sfx.make("gd-march" + f, 0.14, (t) => (Sfx.sqrP(f * t) * 0.35 + Sfx.sinP(f * 0.5 * t) * 0.4) * Sfx.env(t, 0.003, 0.12) * 0.5));
    const rng3 = new SysRandom(9);
    this.bunkerClip = Sfx.make("gd-bunker", 0.12, (t) => (rng3.nextDouble() * 2 - 1) * Sfx.env(t, 0.001, 0.1) * 0.25);
    this.bossHit = Sfx.make("gd-bosshit", 0.15, (t) => Sfx.sqrP(Sfx.glide(t, 300, 180, 0.1)) * Sfx.env(t, 0.002, 0.13) * 0.2);

    this.BuildTitle();
    this.Layout();
  }

  private MakeField(i: number) {
    const f = new Field();
    f.index = i;
    f.root = new GameObject("Field" + i, this.world);
    f.frameSr = Art.spr(f.root, "Frame", Art.Square, new Color(0, 0, 0, 0.0), 1, -800, Art.Flat);
    f.edge = Art.spr(f.root, "Edge", Art.Glow, new Color(1, 1, 1, 0), 1, -790, Art.Additive);
    f.ground = Art.spr(f.root, "Ground", Art.Square, Green.withAlpha(0.8), 1, 5, Art.Additive);
    for (let k = 0; k < 90; k++) {
      const a = new Alien();
      a.sr = Art.spr(f.root, "Alien", GalaxyArt.Alien(0, 0), Color.white, 0.72, 20, Art.Additive);
      a.sr.gameObject.setActive(false);
      f.aliens.push(a);
    }
    for (let k = 0; k < 60; k++) {
      const s = new Shot();
      s.sr = Art.spr(f.root, "Shot", GalaxyArt.Bolt, Color.white, 0.12, 30, Art.Additive);
      s.sr.gameObject.setActive(false);
      f.shots.push(s);
    }
    for (let k = 0; k < 6; k++) {
      const p = new Pickup();
      p.sr = Art.spr(f.root, "Pickup", GalaxyArt.Capsule(0), Color.white, 0.6, 28, Art.Solid);
      p.sr.gameObject.setActive(false);
      f.pickups.push(p);
    }
    for (let k = 0; k < 4; k++) {
      const b = new Bunker();
      b.mesh = new Mesh();
      b.mr = Art.meshObject(f.root, "Bunker", b.mesh, Art.Flat, 10);
      f.bunkers.push(b);
    }
    f.ufo.sr = Art.spr(f.root, "Ufo", GalaxyArt.Saucer(), Color.white, 1.3, 22, Art.Solid);
    f.ufo.sr.gameObject.setActive(false);
    f.boss.sr = Art.spr(f.root, "Boss", GalaxyArt.Boss(), Color.white, 4.4, 21, Art.Solid);
    f.boss.sr.gameObject.setActive(false);
    for (let k = 0; k < 2; k++) {
      const c = new Cannon();
      c.idx = k;
      c.field = f;
      c.glow = Art.spr(f.root, "CannonGlow", Art.Glow, Color.white, 1.8, 24, Art.Additive);
      c.sr = Art.spr(f.root, "Cannon", GalaxyArt.Cannon(), Color.white, 0.95, 25, Art.Solid);
      c.bubble = Art.spr(f.root, "Bubble", GalaxyArt.ShieldBubble, Green, 1.5, 26, Art.Additive);
      c.sr.gameObject.setActive(false);
      c.glow.gameObject.setActive(false);
      c.bubble.gameObject.setActive(false);
      f.cannons.push(c);
    }
    f.fx = CasualFx.create(f.root, 40, 160);
    f.hud = this.MakeHud(f);
    return f;
  }

  private MakeHud(f: Field) {
    const h = new FieldHud();
    h.node = UIKit.node("FieldHud" + f.index, this.UI.Hud);
    h.node.setAsFirstSibling();
    for (let i = 0; i < 2; i++) {
      const sc = UIKit.label(h.node, "0", 62, Color.white, i === 0 ? TextAnchor.MiddleLeft : TextAnchor.MiddleRight);
      UIKit.glow(sc, P1.withAlpha(0.6), 3);
      h.score.push(sc);
      const sub = UIKit.label(h.node, "", 26, new Color(0.75, 0.85, 1, 0.9), i === 0 ? TextAnchor.MiddleLeft : TextAnchor.MiddleRight);
      h.sub.push(sub);
      const icons: Image[] = [];
      for (let k = 0; k < 5; k++) icons.push(UIKit.img(h.node, "Life", GalaxyArt.Cannon(), P1));
      h.lives.push(icons);
    }
    h.wave = UIKit.label(h.node, "", 34, new Color(1, 1, 1, 0.85));
    UIKit.glow(h.wave, Pink.withAlpha(0.5), 2);
    h.timer = UIKit.label(h.node, "", 44, Color.white);
    UIKit.glow(h.timer, P1.withAlpha(0.5), 3);
    const [bar, fill] = UIKit.meter(h.node, UIKit.Center, V2.zero, new V2(500, 26), Pink);
    h.bossBar = bar;
    h.bossFill = fill;
    for (let i = 0; i < 8; i++) {
      const t = UIKit.label(h.node, "", 44, Color.white);
      UIKit.glow(t, new Color(0, 0, 0, 0.7), 3);
      t.gameObject.setActive(false);
      h.floats.push({ t, age: 0, start: V2.zero });
    }
    return h;
  }

  // ------------------------------------------------------------------ title

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    const labels = ["SOLO", "VS CPU", "2 PLAYERS"];
    for (let i = 0; i < 3; i++) {
      const idx = i;
      this.modeButtons.push(UIKit.buttonAt(ex, labels[i], UIKit.Center, new V2((i - 1) * 320, 0), new V2(300, 96), false, () => this.PickGroup(idx), 32));
    }
    for (let i = 0; i < 3; i++) {
      const idx = i;
      this.optButtons.push(UIKit.buttonAt(ex, "", UIKit.Center, new V2((i - 1) * 320, -112), new V2(300, 86), false, () => this.Option(idx), 27));
    }
    this.RefreshTitle();
  }

  private PickGroup(i: number) { this.Data.set("group", i); this.RefreshTitle(); this.UI.ShowTitle(this.BestLine(), this.StatsLine()); }

  /** Row 2 buttons: [context] [FIRE] [CRT] (SOLO has no context button). */
  private Option(i: number) {
    const g = this.Group;
    const kind = g === 0 ? ["fire", "crt", ""][i] : ["ctx", "fire", "crt"][i];
    if (kind === "fire") this.Data.set("tap", this.Data.get("tap") ^ 1);
    else if (kind === "crt") { this.Data.set("crt", this.Crt ? 0 : 1); this.ApplyCrt(); }
    else if (kind === "ctx") {
      if (g === 1) this.Data.set("diff", (Mathf.clamp(this.Data.get("diff", 1), 0, 2) + 1) % 3);
      else this.Data.set("coop", this.Data.get("coop") ^ 1);
    }
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private RefreshTitle() {
    if (!this.modeButtons.length) return;
    const g = this.Group, acc = [P1, CpuCol, P2];
    this.modeButtons.forEach((b, i) => { b.setAccent(i === g ? acc[i] : new Color(1, 1, 1, 0.45)); b.node.localScale = V3.one; });
    const fire = this.Data.get("tap") === 1 ? "FIRE: TAP" : "FIRE: AUTO", crt = this.Crt ? "CRT: ON" : "CRT: OFF";
    const labels = g === 0 ? [fire, crt, ""] : [g === 1 ? "CPU: " + DiffNames[Mathf.clamp(this.Data.get("diff", 1), 0, 2)] : this.Data.get("coop") === 1 ? "CO-OP" : "SPLIT SCREEN", fire, crt];
    const n = g === 0 ? 2 : 3;
    this.optButtons.forEach((b, i) => {
      b.node.setActive(i < n);
      if (b.label) b.label.text = labels[i];
      const x = n === 2 ? (i - 0.5) * 340 : (i - 1) * 320;
      b.node.anchoredPosition = new V2(x, -112);
      b.setAccent(i === 0 && g > 0 ? acc[g] : Pal.hex(0xb48aff));
    });
  }

  private ApplyCrt() {
    const on = this.Crt;
    this.scan.gameObject.setActive(on);
    this.vig.gameObject.setActive(on);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private get SplitMode() { return this.State !== Phase.Title && (this.mode === Mode.VsCpu || this.mode === Mode.Split); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.cover, this.ViewSize);
    this.scan.transform.localScale = new V2(this.ViewSize.x + 0.2, (this.ViewSize.y + 0.2) / 192);
    this.vig.transform.localScale = new V2(this.ViewSize.x + 0.1, this.ViewSize.y + 0.1);
    this.ApplyCrt();
    const rect = this.PlayRect(0, 0, 0.05);
    const portrait = this.ViewSize.x < this.ViewSize.y;
    const split = this.SplitMode, gap = 0.14;
    this.divider.gameObject.setActive(split);
    for (const f of this.fields) {
      let cx = rect.center.x, cy = rect.center.y, rw = rect.width, rh = rect.height;
      if (split) {
        if (portrait) { rh = (rect.height - gap) / 2; cy = f.index === 0 ? rect.yMin + rh / 2 : rect.yMax - rh / 2; }
        else { rw = (rect.width - gap) / 2; cx = f.index === 0 ? rect.xMin + rw / 2 : rect.xMax - rw / 2; }
      }
      const minW = 10, maxW = split ? 13 : 15;
      f.s = Math.min(rh / BaseH, rw / minW);
      f.W = Math.min(rw / f.s, maxW);
      // tall portrait screens get a taller field (more room for the fleet to descend)
      f.H = Math.min(rh / f.s, split ? BaseH : 20);
      f.rot = split && portrait && this.mode === Mode.Split && f.index === 1 ? 180 : 0;
      f.root.localPosition = new V3(cx, cy, 0);
      f.root.localScale = new V2(f.s, f.s);
      f.root.localEulerZ = f.rot;
      f.frameSr.transform.localScale = new V2(f.W / 0.97, f.H / 0.97);
      f.frameSr.color = new Color(0.02, 0.0, 0.08, split ? 0.35 : 0.25);
      f.ground.transform.localPosition = new V3(0, -f.H / 2 + 0.55, 0);
      f.ground.transform.localScale = new V2(f.W / 0.97, 0.05);
      f.edge.transform.localPosition = new V3(0, -f.H / 2, 0);
      f.edge.transform.localScale = new V2(f.W * 1.5, 1.4);
      const c0 = f.cannons[0];
      f.edge.color = split ? (c0.bot ? CpuCol : f.index === 0 ? P1 : P2).withAlpha(0.4) : new Color(1, 1, 1, 0);
      this.PlaceBunkers(f);
      this.LayoutHud(f, cx, cy, f.W * f.s, f.H * f.s);
    }
    if (split) {
      this.divider.transform.localPosition = new V3(rect.center.x, rect.center.y, 0);
      this.divider.transform.localScale = portrait ? new V2(rect.width, 0.05) : new V2(0.05, rect.height);
      this.divider.color = Pink.withAlpha(0.6);
    }
  }

  private LayoutHud(f: Field, cx: number, cy: number, rw: number, rh: number) {
    const h = f.hud, upw = 1080 / Math.min(this.ViewSize.x, this.ViewSize.y);
    h.k = f.s * upw;
    h.w = rw * upw;
    h.h = rh * upw;
    h.node.place(UIKit.Center, this.UI.WorldToHud(new V2(cx, cy)), new V2(h.w, h.h));
    h.node.localEulerAngles = new V3(0, 0, f.rot);
    const trw = new V2(cx + (f.rot === 0 ? rw / 2 : -rw / 2), cy + (f.rot === 0 ? rh / 2 : -rh / 2));
    const near = Math.abs(trw.x - this.ViewSize.x / 2) < 1.6 && Math.abs(trw.y - this.ViewSize.y / 2) < 1.6;
    h.rOff = near ? 280 : 40;
    const L = -h.w / 2, R = h.w / 2, T = h.h / 2;
    for (let i = 0; i < 2; i++) {
      const left = i === 0, x0 = left ? L + 30 : R - h.rOff;
      h.score[i].rectTransform.place(UIKit.Center, new V2(left ? x0 + 220 : x0 - 220, T - 50), new V2(440, 70));
      h.sub[i].rectTransform.place(UIKit.Center, new V2(left ? x0 + 220 : x0 - 220, T - 98), new V2(440, 34));
      for (let k = 0; k < 5; k++) h.lives[i][k].rectTransform.place(UIKit.Center, new V2(left ? x0 + 26 + k * 50 : x0 - 26 - k * 50, T - 138), new V2(42, 32));
    }
    h.wave.rectTransform.place(UIKit.Center, new V2(0, T - 40), new V2(420, 44));
    h.timer.rectTransform.place(UIKit.Center, new V2(0, T - 88), new V2(300, 54));
    h.bossBar.place(UIKit.Center, new V2(0, T - 140), new V2(Math.min(520, h.w * 0.4), 24));
  }

  // ------------------------------------------------------------------ bunkers

  private PlaceBunkers(f: Field) {
    for (let i = 0; i < 4; i++) {
      const b = f.bunkers[i];
      b.cx = (i - 1.5) * Math.min(2.4, f.W / 4.3);
      b.cy = -f.H / 2 + 3.3;
      b.dirty = true;
    }
  }

  private ResetBunkers(f: Field) {
    const mask = BunkerMask(BunkerCols, BunkerRows);
    for (const b of f.bunkers) { b.cells = mask.slice(); b.dirty = true; }
  }

  private RebuildBunker(b: Bunker) {
    const m = b.mesh;
    const v: V3[] = [], tri: number[] = [], col: Color[] = [];
    const w = BunkerCols * Cell, h = BunkerRows * Cell;
    for (let r = 0; r < BunkerRows; r++)
      for (let c = 0; c < BunkerCols; c++) {
        if (!b.cells[r * BunkerCols + c]) continue;
        const x0 = b.cx - w / 2 + c * Cell, y1 = b.cy + h / 2 - r * Cell, x1 = x0 + Cell + 0.002, y0 = y1 - Cell - 0.002;
        const i = v.length;
        v.push(new V3(x0, y0, 0), new V3(x1, y0, 0), new V3(x0, y1, 0), new V3(x1, y1, 0));
        tri.push(i, i + 2, i + 1, i + 2, i + 3, i + 1);
        const k = r / BunkerRows;
        const top = Color.lerp(Pal.hex(0xb8ffd8), Green, Mathf.clamp01(k * 3));
        const exposed = r === 0 || !b.cells[(r - 1) * BunkerCols + c];
        const cc = exposed ? Pal.hex(0xd8ffe8) : Color.lerp(top, Pal.hex(0x1aa860), k);
        col.push(cc, cc, cc, cc);
      }
    m.vertices = v; m.triangles = tri; m.colors = col;
    m.markDirty();
    b.dirty = false;
  }

  /** Cell index under a local point, or -1. */
  private BunkerCell(b: Bunker, p: V2) {
    const w = BunkerCols * Cell, h = BunkerRows * Cell;
    const c = Math.floor((p.x - (b.cx - w / 2)) / Cell), r = Math.floor((b.cy + h / 2 - p.y) / Cell);
    if (c < 0 || r < 0 || c >= BunkerCols || r >= BunkerRows) return -1;
    return r * BunkerCols + c;
  }

  private Erode(f: Field, b: Bunker, p: V2, radius: number) {
    const w = BunkerCols * Cell, h = BunkerRows * Cell;
    const c0 = (p.x - (b.cx - w / 2)) / Cell, r0 = (b.cy + h / 2 - p.y) / Cell;
    for (let r = Math.floor(r0 - radius - 1); r <= r0 + radius + 1; r++)
      for (let c = Math.floor(c0 - radius - 1); c <= c0 + radius + 1; c++) {
        if (c < 0 || r < 0 || c >= BunkerCols || r >= BunkerRows) continue;
        const d = Math.hypot(c + 0.5 - c0, r + 0.5 - r0);
        if (d < radius * (0.6 + Math.random() * 0.6)) b.cells[r * BunkerCols + c] = false;
      }
    b.dirty = true;
    f.fx.pop(p, Green, 5, 2.5, 0.08, 0.3);
  }

  /** Moves a shot from a to b against the bunkers; true if it hit one. */
  private ShotVsBunkers(f: Field, a: V2, b: V2, friendly: boolean) {
    const n = Math.max(1, Math.ceil(V2.distance(a, b) / 0.05));
    for (const bk of f.bunkers) {
      const w = BunkerCols * Cell / 2 + 0.1, h = BunkerRows * Cell / 2 + 0.1;
      if (Math.max(a.x, b.x) < bk.cx - w || Math.min(a.x, b.x) > bk.cx + w || Math.max(a.y, b.y) < bk.cy - h || Math.min(a.y, b.y) > bk.cy + h) continue;
      for (let i = 0; i <= n; i++) {
        const p = V2.lerp(a, b, i / n), c = this.BunkerCell(bk, p);
        if (c >= 0 && bk.cells[c]) {
          this.Erode(f, bk, p, friendly ? 1.8 : 2.4);
          if (this.IsHumanField(f)) Sfx.playClip(this.bunkerClip, 0.35);
          return true;
        }
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ lifecycle

  private IsHumanField(f: Field) { return f.cannons.some((c) => c.sr.gameObject.activeSelf && c.human); }

  private ResetField(f: Field, seed: number) {
    for (const a of f.aliens) { a.alive = false; a.sr.gameObject.setActive(false); }
    for (const s of f.shots) { s.active = false; s.sr.gameObject.setActive(false); }
    for (const p of f.pickups) { p.active = false; p.sr.gameObject.setActive(false); }
    f.ufo.active = false; f.ufo.sr.gameObject.setActive(false);
    f.boss.active = false; f.boss.sr.gameObject.setActive(false);
    for (const c of f.cannons) { c.sr.gameObject.setActive(false); c.glow.gameObject.setActive(false); c.bubble.gameObject.setActive(false); c.bot = null; }
    f.fx.clear();
    f.rng = new SysRandom(seed);
    f.wave = 0; f.between = 0; f.over = false; f.invaded = false; f.extra = 0; f.started = false;
    f.ufoT = 18 + f.rng.nextDouble() * 8;
    f.fireT = 2;
    this.ResetBunkers(f);
    for (const fl of f.hud.floats) fl.t.gameObject.setActive(false);
  }

  private SetupCannon(c: Cannon, x: number, human: boolean, color: Color, name: string) {
    Object.assign(c, {
      x, targetX: x, hasTarget: false, alive: true, out: false, respawn: 0, invuln: 1, fireCd: 0.5, rapid: 0, spread: 0, shield: false,
      lives: 3, score: 0, extraAt: 2000, kills: 0, shotsFired: 0, hits: 0, ufos: 0, human, color, name, fireRequest: false,
    });
    c.bot = null;
    c.sr.gameObject.setActive(true);
    c.glow.gameObject.setActive(true);
    c.sr.color = Color.lerp(color, Color.white, 0.35);
    c.glow.color = color.withAlpha(0.35);
  }

  protected OnEnterTitle() {
    this.binds.clear();
    if (this.ufoLoop) this.ufoLoop.volume = 0;
    this.mode = Mode.Solo;
    for (const f of this.fields) { this.ResetField(f, 99); f.root.setActive(f.index === 0); f.hud.node.setActive(false); }
    const f = this.fields[0];
    this.SetupCannon(f.cannons[0], 0, false, P1, "DEMO");
    f.cannons[0].bot = new Bot();
    f.cannons[0].bot!.diff = 2;
    this.Layout();
    this.NextWave(f);
    this.RefreshTitle();
  }

  protected BeginRun() {
    this.binds.clear();
    this.mode = this.SelMode;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.tapFire = this.Data.get("tap") === 1;
    const seed = Math.floor(Math.random() * 1e9);
    const split = this.mode === Mode.VsCpu || this.mode === Mode.Split;
    for (const f of this.fields) {
      this.ResetField(f, seed);
      f.root.setActive(f.index === 0 || split);
      f.hud.node.setActive(f.index === 0 || split);
    }
    const f0 = this.fields[0], f1 = this.fields[1];
    if (this.mode === Mode.Coop) {
      this.SetupCannon(f0.cannons[0], -2, true, P1, "PLAYER 1");
      this.SetupCannon(f0.cannons[1], 2, true, P2, "PLAYER 2");
    } else {
      this.SetupCannon(f0.cannons[0], 0, true, P1, this.mode === Mode.Split ? "PLAYER 1" : "YOU");
      if (split) {
        const bot = this.mode === Mode.VsCpu;
        this.SetupCannon(f1.cannons[0], 0, !bot, bot ? CpuCol : P2, bot ? "CPU " + DiffNames[this.diff] : "PLAYER 2");
        if (bot) { f1.cannons[0].bot = new Bot(); f1.cannons[0].bot!.diff = this.diff; }
      }
    }
    this.Layout();
    for (const f of this.fields) if (f.root.activeSelf) this.NextWave(f);
    this.timeLeft = RoundTime;
    this.ended = false;
    this.revived = false;
    this.countdown = split ? 3.2 : 1.2;
    this.countStep = -1;
    this.Data.add("games", 1);
    if (!this.ufoLoop) this.ufoLoop = Sfx.createLoop(this.ufoClip);
    Sfx.setIntensity(0.3);
    const how = this.tapFire ? "Drag to move, TAP to fire!" : "Drag to move. Your cannon fires automatically!";
    this.UI.Toast(split ? (this.mode === Mode.VsCpu ? "Clear waves to send invaders to the CPU! " : "Clear waves to send invaders to your rival! ") + how : how, 3.5);
    if (!split) this.UI.Announce("WAVE 1", P1, 1.2);
  }

  protected OnPauseChanged(paused: boolean) { if (paused) { this.binds.clear(); if (this.ufoLoop) this.ufoLoop.volume = 0; } }

  // ------------------------------------------------------------------ waves

  private NextWave(f: Field) {
    f.wave++;
    f.between = 0;
    f.started = true;
    for (const s of f.shots) if (!s.friendly) { s.active = false; s.sr.gameObject.setActive(false); }
    this.ResetBunkers(f);
    const w = f.wave;
    f.cols = f.W >= 12 ? 10 : 8;
    f.dx = Math.min(0.92, (f.W - 2.4) / f.cols);
    f.dy = 0.76;
    f.dir = 1;
    f.frame = 0;
    f.stepT = 0.8;
    f.ox = 0;
    f.oy = f.H / 2 - 2.9 - Math.min(5, (w - 1) % 5) * 0.28;
    f.fireT = 1.6;
    if (w % 5 === 0) {
      const b = f.boss;
      b.active = true;
      b.max = b.hp = 40 + w * 6;
      b.t = 0; b.x = 0; b.y = f.H / 2 + 3; b.fireT = 2; b.pattern = 0; b.flash = 0;
      b.sr.gameObject.setActive(true);
      f.total = 1;
      this.AnnounceField(f, `WAVE ${w}: MOTHERSHIP!`, Pink);
      Sfx.play(Snd.Alarm, 0.6);
    } else {
      // formation variety
      const pattern = (w - 1) % 5; // 0 block, 1 V, 2 checker, 3 armoured front
      const rows = 5;
      let n = 0;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < f.cols; c++) {
          if (pattern === 1 && Math.abs(c - (f.cols - 1) / 2) < r * 0.9 - 1.2) continue;
          if (pattern === 2 && (r + c) % 2 === 1 && r > 0) continue;
          const kind = r === 0 ? 2 : r < 3 ? 1 : 0;
          const armor = (pattern === 3 && r >= 3) || (w > 5 && r === 1) || (w > 10 && r >= 3);
          this.SpawnAlien(f, kind, armor, c, r, 6 + r * 0.6);
          n++;
        }
      f.total = n;
      if (f.started && w > 1) this.AnnounceField(f, `WAVE ${w}`, P1);
    }
    if (f.extra > 0) { this.AddReinforcements(f, f.extra); f.extra = 0; }
  }

  private SpawnAlien(f: Field, kind: number, armor: boolean, col: number, row: number, enter: number) {
    const a = f.aliens.find((x) => !x.alive);
    if (!a) return null;
    a.alive = true; a.kind = kind; a.armor = armor; a.hp = armor ? 2 : 1; a.col = col; a.row = row; a.flash = 0; a.enter = enter;
    a.sr.sprite = GalaxyArt.Alien(kind, 0, armor);
    a.sr.color = armor ? ArmorColor : AlienColors[kind];
    a.sr.gameObject.setActive(true);
    return a;
  }

  /** Extra invaders from the rival: a new row above the fleet. */
  private AddReinforcements(f: Field, n: number) {
    const alive = f.aliens.filter((a) => a.alive);
    if (f.boss.active && alive.length === 0) { f.ox = 0; f.oy = f.H / 2 - 4.2; }
    const minRow = alive.length ? Math.min(...alive.map((a) => a.row)) : 0;
    const row = alive.length ? minRow - 1 : 0;
    const start = Math.max(0, Math.floor((f.cols - n) / 2));
    for (let i = 0; i < n; i++) this.SpawnAlien(f, 2, f.wave > 3 && i % 2 === 0, (start + i) % f.cols, row - Math.floor((start + i) / f.cols), 5);
    f.total += n;
    this.AnnounceField(f, `+${n} INVADERS!`, CpuCol);
    if (this.IsHumanField(f)) Sfx.play(Snd.Warn, 0.6);
  }

  private AlienPos(f: Field, a: Alien) {
    return new V2(f.ox + (a.col - (f.cols - 1) / 2) * f.dx, f.oy - a.row * f.dy + a.enter);
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.TickStars(dt);
    if (this.ufoLoop) this.ufoLoop.volume = 0;
    if (this.State !== Phase.Title) { for (const f of this.fields) if (f.root.activeSelf) this.TickVisuals(f, dt); return; }
    const f = this.fields[0];
    this.TickField(f, dt * 0.8, true);
    if (f.cannons[0].out || f.invaded) { this.ResetField(f, 99); this.SetupCannon(f.cannons[0], 0, false, P1, "DEMO"); f.cannons[0].bot = new Bot(); f.cannons[0].bot!.diff = 2; this.NextWave(f); }
  }

  private TickStars(dt: number) {
    const hw = this.ViewSize.x / 2 + 0.5, hh = this.ViewSize.y / 2 + 0.5;
    for (const s of this.stars) {
      s.pos = new V2(s.pos.x, s.pos.y - s.speed * dt);
      if (s.pos.y < -hh) s.pos = new V2(Random.range(-hw, hw), hh);
      if (Math.abs(s.pos.x) > hw) s.pos = new V2(Random.range(-hw, hw), s.pos.y);
      s.sr.transform.localPosition = s.pos;
      const sz = 0.05 + s.speed * 0.12;
      s.sr.transform.localScale = new V2(sz, sz);
    }
  }

  protected TickRun(dt: number) {
    this.TickStars(dt);
    const split = this.mode === Mode.VsCpu || this.mode === Mode.Split;
    if (this.countdown > 0) {
      this.countdown -= dt;
      if (split) {
        const step = Math.ceil(this.countdown);
        if (step !== this.countStep && step >= 0) {
          this.countStep = step;
          if (step > 0 && step <= 3) { this.UI.Announce(String(step), Gold, 0.8); Sfx.play(Snd.Beep, 0.6); }
          if (step === 0) { this.UI.Announce("DEFEND!", P1, 0.9); Sfx.play(Snd.BeepHigh, 0.7); }
        }
      }
    }
    this.ReadInput();
    let ufoOn = false;
    for (const f of this.fields) {
      if (!f.root.activeSelf) continue;
      this.TickField(f, dt, false);
      if (f.ufo.active && this.IsHumanField(f)) ufoOn = true;
    }
    if (this.ufoLoop) this.ufoLoop.volume = ufoOn && !this.ended ? 0.35 : 0;
    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.State === Phase.Playing) this.End();
      return;
    }
    if (this.countdown > 0) return;
    if (split) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      const a = this.fields[0], b = this.fields[1];
      if (a.over || b.over) this.BeginEnd(a.over && b.over ? "BOTH DOWN" : "KNOCKOUT", 2);
      else if (this.timeLeft <= 0) { this.BeginEnd("TIME UP", 1.6); this.UI.Announce("TIME UP!", Gold, 1.3); Sfx.play(Snd.Alarm, 0.6); }
    } else if (this.fields[0].over) this.BeginEnd(this.fields[0].invaded ? "INVADED" : "GAME OVER", 2);
  }

  private BeginEnd(head: string, t: number) {
    this.ended = true;
    this.endHead = head;
    this.endTimer = t;
    this.binds.clear();
    if (head !== "TIME UP") this.UI.Announce(head === "INVADED" ? "INVADED!" : head === "KNOCKOUT" ? "KNOCKOUT!" : "GAME OVER", CpuCol, 1.6);
  }

  private TickField(f: Field, dt: number, attract: boolean) {
    const live = attract || (this.countdown <= 0 && !this.ended);
    if (live && !f.over) {
      this.TickFormation(f, dt);
      this.TickBoss(f, dt);
      this.TickUfo(f, dt);
      this.AlienFire(f, dt);
      // wave cleared?
      if (!f.aliens.some((a) => a.alive) && !f.boss.active) {
        if (f.between === 0) {
          f.between = 2.2;
          this.WaveCleared(f, attract);
        }
        f.between -= dt;
        if (f.between <= 0.001) this.NextWave(f);
      }
    }
    for (const c of f.cannons) if (c.sr.gameObject.activeSelf) this.TickCannon(f, c, dt, live && !f.over);
    this.TickShots(f, dt);
    this.TickPickups(f, dt);
    this.TickVisuals(f, dt);
    if (!attract) this.UpdateHud(f);
  }

  private WaveCleared(f: Field, attract: boolean) {
    if (attract) return;
    const bonus = f.wave * 100;
    const shooter = f.cannons.filter((c) => !c.out);
    for (const c of shooter) this.AddScore(c, Math.round(bonus / Math.max(1, shooter.length)));
    this.AnnounceField(f, `WAVE ${f.wave} CLEARED  +${bonus}`, Green);
    if (this.IsHumanField(f)) Sfx.play(Snd.Win, 0.6);
    if (f.wave >= this.Data.get("bestWave") && this.mode === Mode.Solo) this.Data.set("bestWave", f.wave + 1);
    if (this.mode === Mode.VsCpu || this.mode === Mode.Split) {
      const other = this.fields[1 - f.index];
      const n = 4 + Math.min(4, f.wave);
      if (other.aliens.some((a) => a.alive) || other.boss.active) this.AddReinforcements(other, n);
      else other.extra += n;
    }
  }

  private TickFormation(f: Field, dt: number) {
    const alive = f.aliens.filter((a) => a.alive);
    for (const a of alive) if (a.enter > 0) a.enter = Math.max(0, a.enter - dt * 9);
    if (alive.length === 0) return;
    const ratio = alive.length / Math.max(1, f.total);
    const waveK = Math.max(0.45, 1 - (((f.wave - 1) % 5) + Math.floor((f.wave - 1) / 5) * 1.5) * 0.08);
    const interval = Math.max(0.028, (0.03 + 0.62 * Math.pow(ratio, 1.25)) * waveK);
    f.stepT -= dt;
    if (f.stepT > 0) return;
    f.stepT += interval;
    if (f.stepT < 0) f.stepT = interval;
    f.frame ^= 1;
    // edge check
    let minX = 1e9, maxX = -1e9;
    for (const a of alive) { const p = this.AlienPos(f, a); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
    const step = 0.16, edge = f.W / 2 - 0.45;
    if ((f.dir > 0 && maxX + step > edge) || (f.dir < 0 && minX - step < -edge)) { f.oy -= 0.42; f.dir = -f.dir; }
    else f.ox += f.dir * step;
    for (const a of alive) a.sr.sprite = GalaxyArt.Alien(a.kind, f.frame, a.armor && a.hp > 1);
    if (this.IsHumanField(f) && (this.mode === Mode.Solo || this.mode === Mode.Coop || f.index === 0)) {
      Sfx.playClip(this.marchClips[this.marchNote], 0.7);
      this.marchNote = (this.marchNote + 1) % 4;
    }
    // landing: bunkers get eaten, the cannon line means invasion
    const cy = -f.H / 2 + 1.3;
    for (const a of alive) {
      const p = this.AlienPos(f, a);
      for (const b of f.bunkers) {
        if (Math.abs(p.x - b.cx) < BunkerCols * Cell / 2 + 0.36 && Math.abs(p.y - b.cy) < BunkerRows * Cell / 2 + 0.3) {
          for (let k = 0; k < b.cells.length; k++) {
            if (!b.cells[k]) continue;
            const cx = b.cx - BunkerCols * Cell / 2 + (k % BunkerCols + 0.5) * Cell, cyy = b.cy + BunkerRows * Cell / 2 - (Math.floor(k / BunkerCols) + 0.5) * Cell;
            if (Math.abs(cx - p.x) < 0.36 && Math.abs(cyy - p.y) < 0.28) { b.cells[k] = false; b.dirty = true; }
          }
        }
      }
      if (p.y - 0.25 < cy + 0.35 && !f.invaded && a.enter <= 0) {
        f.invaded = true;
        for (const c of f.cannons) if (c.sr.gameObject.activeSelf && !c.out) { c.lives = 0; this.KillCannon(f, c); }
        f.over = true;
        break;
      }
    }
  }

  private TickBoss(f: Field, dt: number) {
    const b = f.boss;
    if (!b.active) return;
    b.t += dt;
    b.flash = Math.max(0, b.flash - dt);
    const targetY = f.H / 2 - 3.6;
    b.y = Mathf.moveTowards(b.y, targetY, dt * 3);
    const range = f.W / 2 - 2.4;
    b.x = Math.sin(b.t * (0.55 + (1 - b.hp / b.max) * 0.5)) * range;
    b.fireT -= dt;
    if (b.fireT <= 0 && b.y <= targetY + 0.01) {
      const rage = 1 - b.hp / b.max;
      const origin = new V2(b.x, b.y - 0.8);
      if (b.pattern % 3 === 2) {
        // aimed triple at the nearest cannon
        const c = this.NearestCannon(f, b.x);
        const dir = c ? new V2(c.x, -f.H / 2 + 1.3).sub(origin).normalized : V2.down;
        for (let i = -1; i <= 1; i++) this.FireAlienShot(f, origin, V2.fromAngle(Math.atan2(dir.y, dir.x) + i * 0.12, 6.5 + rage * 2), 2);
        b.fireT = 1.3 - rage * 0.5;
      } else {
        const n = 5 + Math.floor(rage * 3);
        for (let i = 0; i < n; i++) {
          const ang = -Math.PI / 2 + (i - (n - 1) / 2) * 0.22;
          this.FireAlienShot(f, origin, V2.fromAngle(ang, 4.5 + rage * 1.5), b.pattern % 2);
        }
        b.fireT = 1.6 - rage * 0.6;
      }
      b.pattern++;
    }
  }

  private TickUfo(f: Field, dt: number) {
    const u = f.ufo;
    if (!u.active) {
      if (f.boss.active || f.between > 0) return;
      f.ufoT -= dt;
      if (f.ufoT <= 0 && f.aliens.filter((a) => a.alive).length >= 6) {
        u.active = true;
        u.dir = f.rng.nextDouble() < 0.5 ? 1 : -1;
        u.x = -u.dir * (f.W / 2 + 1);
        u.worth = [50, 100, 150, 300][f.rng.next(4)];
        u.sr.gameObject.setActive(true);
        f.ufoT = 20 + f.rng.nextDouble() * 10;
      }
      return;
    }
    u.t += dt;
    u.x += u.dir * 3 * dt;
    u.sr.transform.localPosition = new V2(u.x, f.H / 2 - 1.75 + Math.sin(u.t * 4) * 0.06);
    if (Math.abs(u.x) > f.W / 2 + 1.2) { u.active = false; u.sr.gameObject.setActive(false); }
  }

  private AlienFire(f: Field, dt: number) {
    const alive = f.aliens.filter((a) => a.alive && a.enter <= 0);
    if (!alive.length) return;
    const lvl = (f.wave - 1) % 5 + Math.floor((f.wave - 1) / 5) * 1.5;
    const maxShots = Math.min(6, 2 + Math.floor(lvl / 1.5));
    f.fireT -= dt;
    if (f.fireT > 0) return;
    f.fireT = Math.max(0.3, 1.25 - lvl * 0.1) * (0.6 + f.rng.nextDouble() * 0.8);
    if (f.shots.filter((s) => s.active && !s.friendly).length >= maxShots) return;
    // pick a column: a third of the time the one above a cannon
    let col: number;
    const cols = [...new Set(alive.map((a) => a.col))];
    const target = this.NearestCannon(f, 0, true);
    if (target && f.rng.nextDouble() < 0.35) {
      col = cols.reduce((best, c) => {
        const x = f.ox + (c - (f.cols - 1) / 2) * f.dx, bx = f.ox + (best - (f.cols - 1) / 2) * f.dx;
        return Math.abs(x - target.x) < Math.abs(bx - target.x) ? c : best;
      }, cols[0]);
    } else col = cols[f.rng.next(cols.length)];
    const shooter = alive.filter((a) => a.col === col).reduce((lo, a) => (a.row > lo.row ? a : lo));
    const p = this.AlienPos(f, shooter).add(new V2(0, -0.35));
    const speed = [4.2, 4.8, 6.2][shooter.kind] + lvl * 0.15;
    this.FireAlienShot(f, p, new V2(0, -speed), shooter.kind);
  }

  private FireAlienShot(f: Field, p: V2, vel: V2, kind: number) {
    const s = f.shots.find((x) => !x.active);
    if (!s) return;
    s.active = true; s.friendly = false; s.owner = -1; s.kind = kind; s.pos = p; s.vel = vel; s.t = 0;
    s.sr.sprite = GalaxyArt.Shot(kind, 0);
    s.sr.color = [Pal.hex(0xc8ff9a), Pal.hex(0x9af4ff), Pal.hex(0xffa6ec)][kind];
    s.sr.transform.localScale = new V2(0.17, 0.17);
    s.sr.transform.localEulerZ = Math.atan2(vel.y, vel.x) * Mathf.Rad2Deg + 90;
    s.sr.gameObject.setActive(true);
  }

  private NearestCannon(f: Field, x: number, any = false) {
    let best: Cannon | null = null;
    for (const c of f.cannons) {
      if (!c.sr.gameObject.activeSelf || c.out || (!any && !c.alive)) continue;
      if (!best || Math.abs(c.x - x) < Math.abs(best.x - x)) best = c;
    }
    return best;
  }

  // ------------------------------------------------------------------ cannons

  private TickCannon(f: Field, c: Cannon, dt: number, live: boolean) {
    const cy = -f.H / 2 + 1.3;
    c.invuln = Math.max(0, c.invuln - dt);
    c.rapid = Math.max(0, c.rapid - dt);
    c.spread = Math.max(0, c.spread - dt);
    c.fireCd = Math.max(0, c.fireCd - dt);
    if (!c.alive) {
      c.sr.color = c.sr.color.withAlpha(0);
      c.glow.color = c.glow.color.withAlpha(0);
      c.bubble.gameObject.setActive(false);
      if (c.out) return;
      c.respawn -= dt;
      if (c.respawn <= 0 && live) { c.alive = true; c.invuln = 2; c.x = 0; c.targetX = 0; c.hasTarget = false; }
      return;
    }
    if (live) {
      if (c.bot) this.TickBot(f, c, c.bot, dt);
      let move = 0;
      if (c.keyMove !== 0) { move = c.keyMove * CannonSpeed * dt; c.hasTarget = false; }
      else if (c.hasTarget) move = Mathf.clamp(c.targetX - c.x, -CannonSpeed * 1.8 * dt, CannonSpeed * 1.8 * dt);
      const lim = f.W / 2 - 0.55;
      c.x = Mathf.clamp(c.x + move, -lim, lim);
      // firing
      const auto = !this.tapFire || !c.human;
      const maxB = c.rapid > 0 ? 5 : auto ? 2 : 3;
      const mine = f.shots.filter((s) => s.active && s.friendly && s.owner === c.idx).length;
      const want = c.fireRequest || c.keyFire || (auto && this.TargetAbove(f, c.x));
      if (want && c.fireCd <= 0 && mine < maxB) this.FireCannon(f, c, cy);
      c.fireRequest = false;
    }
    const blink = c.invuln > 0 && Math.sin(c.invuln * 30) > 0 ? 0.35 : 1;
    c.sr.transform.localPosition = new V2(c.x, cy);
    c.sr.color = Color.lerp(c.color, Color.white, 0.35).withAlpha(blink);
    c.glow.transform.localPosition = new V2(c.x, cy);
    c.glow.color = c.color.withAlpha((c.rapid > 0 || c.spread > 0 ? 0.6 : 0.3) * blink);
    c.bubble.gameObject.setActive(c.shield);
    if (c.shield) {
      c.bubble.transform.localPosition = new V2(c.x, cy + 0.05);
      const pulse = 1.45 + 0.06 * Math.sin(Time.time * 6);
      c.bubble.transform.localScale = new V2(pulse, pulse);
    }
  }

  /** Auto-fire only shoots when something is above (saves the bunkers). */
  private TargetAbove(f: Field, x: number) {
    for (const a of f.aliens) if (a.alive && a.enter <= 0 && Math.abs(this.AlienPos(f, a).x - x) < 0.55) return true;
    if (f.ufo.active && Math.abs(f.ufo.x - x) < 1.6) return true;
    if (f.boss.active && Math.abs(f.boss.x - x) < 2.2) return true;
    for (const s of f.shots) if (s.active && !s.friendly && Math.abs(s.pos.x - x) < 0.25 && s.pos.y > -f.H / 2 + 3) return true;
    return false;
  }

  private FireCannon(f: Field, c: Cannon, cy: number) {
    const angles = c.spread > 0 ? [-0.2, 0, 0.2] : [0];
    for (const ang of angles) {
      const s = f.shots.find((x) => !x.active);
      if (!s) break;
      s.active = true; s.friendly = true; s.owner = c.idx; s.kind = 9; s.t = 0;
      s.pos = new V2(c.x, cy + 0.45);
      s.vel = V2.fromAngle(Math.PI / 2 + ang, 17);
      s.sr.sprite = GalaxyArt.Bolt;
      s.sr.color = Color.lerp(c.color, Color.white, 0.4);
      s.sr.transform.localScale = new V2(0.12, 0.12);
      s.sr.transform.localEulerZ = -ang * Mathf.Rad2Deg;
      s.sr.gameObject.setActive(true);
      c.shotsFired++;
    }
    c.fireCd = c.rapid > 0 ? 0.12 : !this.tapFire || !c.human ? 0.42 : 0.16;
    if (c.human || this.IsHumanField(f)) Sfx.playClip(this.shootClip, c.human ? 0.55 : 0.2, 0.95 + Math.random() * 0.1);
  }

  private KillCannon(f: Field, c: Cannon) {
    if (!c.alive) { if (c.lives <= 0) c.out = true; return; }
    c.alive = false;
    c.lives = Math.max(0, c.lives - 1);
    c.out = c.lives <= 0;
    c.respawn = 1.4;
    c.shield = false; c.rapid = 0; c.spread = 0;
    const p = new V2(c.x, -f.H / 2 + 1.3), w = this.ToWorld(f, p);
    this.Fx.burst(w, c.color, 30, 7 * f.s, 0.4 * f.s, 0.8);
    this.Fx.burst(w, Color.white, 12, 4 * f.s, 0.3 * f.s, 0.5);
    this.Fx.ring(w, c.color, 0.3 * f.s, 3 * f.s, 0.5);
    for (let i = 0; i < 16; i++) f.fx.emit(p, Random.insideUnitCircle.mul(5).add(new V2(0, 3)), c.color, 0.12, 0.9, GalaxyArt.Pixel, 8, 300, false, 0.8);
    this.Fx.shake(0.45);
    this.Fx.kick(0.5, 0.4);
    Fx.haptic(true);
    Sfx.playClip(this.playerBoom, c.human ? 0.85 : 0.4);
    if (c.out) {
      if (f.cannons.every((x) => !x.sr.gameObject.activeSelf || x.out)) f.over = true;
      else this.AnnounceField(f, `${c.name} IS OUT!`, c.color);
    }
  }

  private AddScore(c: Cannon, pts: number) {
    c.score += pts;
    if (c.score >= c.extraAt) {
      c.extraAt += 2000;
      if (c.lives < 5 && !c.out) {
        c.lives++;
        this.AnnounceField(c.field, "EXTRA LIFE!", Green);
        Sfx.play(Snd.PowerUp, 0.6);
      }
    }
  }

  // ------------------------------------------------------------------ shots and hits

  private TickShots(f: Field, dt: number) {
    const cy = -f.H / 2 + 1.3;
    for (const s of f.shots) {
      if (!s.active) continue;
      s.t += dt;
      const a = s.pos, b = s.pos.add(s.vel.mul(dt));
      s.pos = b;
      if (!s.friendly && Math.floor(s.t * 10) % 2 !== Math.floor((s.t - dt) * 10) % 2) s.sr.sprite = GalaxyArt.Shot(s.kind, Math.floor(s.t * 10) % 2);
      s.sr.transform.localPosition = s.pos;
      if (s.pos.y > f.H / 2 + 0.5 || s.pos.y < -f.H / 2 + 0.55 || Math.abs(s.pos.x) > f.W / 2 + 0.5) {
        if (!s.friendly && s.pos.y < -f.H / 2 + 0.6) f.fx.pop(new V2(s.pos.x, -f.H / 2 + 0.6), s.sr.color, 5, 2, 0.08, 0.3);
        this.KillShot(s);
        continue;
      }
      if (this.ShotVsBunkers(f, a, b, s.friendly)) { this.KillShot(s); continue; }
      if (s.friendly) {
        if (this.FriendlyHits(f, s)) { this.KillShot(s); continue; }
        // shot vs shot
        for (const o of f.shots) {
          if (!o.active || o.friendly) continue;
          if (Math.abs(o.pos.x - s.pos.x) < 0.2 && Math.abs(o.pos.y - s.pos.y) < 0.45) {
            f.fx.pop(o.pos, Color.white, 6, 3, 0.1, 0.3);
            this.Fx.burst(this.ToWorld(f, o.pos), Color.white, 5, 2 * f.s, 0.2 * f.s, 0.25);
            this.KillShot(o);
            this.KillShot(s);
            const c = f.cannons[s.owner];
            if (c) this.AddScore(c, 5);
            break;
          }
        }
      } else {
        for (const c of f.cannons) {
          if (!c.sr.gameObject.activeSelf || !c.alive || c.invuln > 0) continue;
          if (Math.abs(s.pos.x - c.x) < 0.45 && s.pos.y < cy + 0.3 && s.pos.y > cy - 0.35) {
            this.KillShot(s);
            if (c.shield) {
              c.shield = false;
              c.invuln = 0.6;
              this.Fx.ring(this.ToWorld(f, new V2(c.x, cy)), Green, 0.5 * f.s, 2.5 * f.s, 0.4);
              Sfx.play(Snd.Hit, 0.6);
            } else this.KillCannon(f, c);
            break;
          }
        }
      }
    }
  }

  private KillShot(s: Shot) { s.active = false; s.sr.gameObject.setActive(false); }

  private FriendlyHits(f: Field, s: Shot) {
    const c = f.cannons[s.owner];
    // aliens
    for (const a of f.aliens) {
      if (!a.alive) continue;
      const p = this.AlienPos(f, a);
      if (Math.abs(p.x - s.pos.x) < 0.38 && Math.abs(p.y - s.pos.y) < 0.36) {
        if (c) c.hits++;
        a.hp--;
        if (a.hp > 0) {
          a.flash = 0.15;
          a.sr.sprite = GalaxyArt.Alien(a.kind, f.frame, false);
          a.sr.color = AlienColors[a.kind];
          f.fx.pop(p, ArmorColor, 8, 3, 0.12, 0.3);
          if (this.IsHumanField(f)) Sfx.play(Snd.Hit, 0.4, 1.4);
          return true;
        }
        this.KillAlien(f, a, p, c);
        return true;
      }
    }
    // saucer
    const u = f.ufo;
    if (u.active && Math.abs(u.x - s.pos.x) < 0.7 && Math.abs(f.H / 2 - 1.75 - s.pos.y) < 0.4) {
      u.active = false;
      u.sr.gameObject.setActive(false);
      const p = new V2(u.x, f.H / 2 - 1.75);
      this.Fx.burst(this.ToWorld(f, p), Pal.hex(0xff3d6a), 26, 6 * f.s, 0.4 * f.s, 0.7);
      this.Fx.ring(this.ToWorld(f, p), Gold, 0.3 * f.s, 2.5 * f.s, 0.4);
      if (c) { this.AddScore(c, u.worth); c.ufos++; c.hits++; }
      this.Float(f, p, `${u.worth}`, Gold);
      this.SpawnPickup(f, p, f.rng.next(3));
      if (this.IsHumanField(f)) Sfx.play(Snd.Explode, 0.7);
      return true;
    }
    // mothership
    const b = f.boss;
    if (b.active && Math.abs(b.x - s.pos.x) < 1.9 && Math.abs(b.y - s.pos.y) < 0.75) {
      b.hp--;
      b.flash = 0.08;
      if (c) c.hits++;
      f.fx.pop(s.pos, Pink, 5, 3, 0.1, 0.3);
      if (this.IsHumanField(f)) Sfx.playClip(this.bossHit, 0.4, 0.9 + Math.random() * 0.2);
      if (b.hp <= 0) {
        b.active = false;
        b.sr.gameObject.setActive(false);
        const p = new V2(b.x, b.y), w = this.ToWorld(f, p);
        for (let i = 0; i < 4; i++) this.Fx.burst(w.add(Random.insideUnitCircle.mul(1.2 * f.s)), [Pink, Gold, P1, Color.white][i], 30, 9 * f.s, 0.5 * f.s, 1);
        this.Fx.ring(w, Pink, 0.5 * f.s, 7 * f.s, 0.8);
        this.Fx.shake(0.7);
        this.Fx.kick(0.8, 0.5);
        this.Hitstop(0.12);
        const pts = 1000 * Math.ceil(f.wave / 5);
        if (c) this.AddScore(c, pts);
        this.Float(f, p, `MOTHERSHIP  +${pts}`, Gold);
        this.SpawnPickup(f, p, 2);
        Sfx.playClip(this.playerBoom, 0.9);
        Sfx.play(Snd.NewBest, 0.6);
      }
      return true;
    }
    return false;
  }

  private KillAlien(f: Field, a: Alien, p: V2, c: Cannon | undefined) {
    a.alive = false;
    a.sr.gameObject.setActive(false);
    const col = a.armor ? ArmorColor : AlienColors[a.kind];
    const w = this.ToWorld(f, p);
    this.Fx.burst(w, col, 12, 4.5 * f.s, 0.28 * f.s, 0.45);
    for (let i = 0; i < 7; i++) f.fx.emit(p, Random.insideUnitCircle.mul(4), col, 0.09, 0.5, GalaxyArt.Pixel, 3, 400, false, 1.5);
    const pts = AlienPoints[a.kind] + (a.armor ? 10 : 0);
    if (c) { this.AddScore(c, pts); c.kills++; }
    if (this.IsHumanField(f)) Sfx.playClip(this.alienBoom, 0.45, 0.9 + Math.random() * 0.25);
    if (f.rng.nextDouble() < 0.035) this.SpawnPickup(f, p, f.rng.next(3));
  }

  private SpawnPickup(f: Field, p: V2, kind: number) {
    const k = f.pickups.find((x) => !x.active);
    if (!k) return;
    k.active = true; k.kind = kind; k.pos = p; k.t = 0;
    k.sr.sprite = GalaxyArt.Capsule(kind);
    k.sr.gameObject.setActive(true);
  }

  private TickPickups(f: Field, dt: number) {
    const cy = -f.H / 2 + 1.3;
    for (const k of f.pickups) {
      if (!k.active) continue;
      k.t += dt;
      k.pos = new V2(k.pos.x, k.pos.y - 3 * dt);
      k.sr.transform.localPosition = k.pos;
      k.sr.transform.localEulerZ = Math.sin(k.t * 5) * 12;
      if (k.pos.y < -f.H / 2) { k.active = false; k.sr.gameObject.setActive(false); continue; }
      for (const c of f.cannons) {
        if (!c.sr.gameObject.activeSelf || !c.alive) continue;
        if (Math.abs(k.pos.x - c.x) < 0.75 && Math.abs(k.pos.y - cy) < 0.55) {
          k.active = false;
          k.sr.gameObject.setActive(false);
          const names = ["RAPID FIRE!", "SPREAD SHOT!", "SHIELD!"];
          if (k.kind === 0) c.rapid = 10; else if (k.kind === 1) c.spread = 10; else c.shield = true;
          this.Float(f, new V2(c.x, cy + 1.2), names[k.kind], [P2, P1, Green][k.kind]);
          f.fx.sparkle(new V2(c.x, cy), Color.white, 8, 0.8, 0.25);
          if (c.human || this.IsHumanField(f)) Sfx.play(Snd.PowerUp, 0.7);
          break;
        }
      }
    }
  }

  private TickVisuals(f: Field, dt: number) {
    for (const a of f.aliens) {
      if (!a.alive) continue;
      a.flash = Math.max(0, a.flash - dt);
      const p = this.AlienPos(f, a);
      a.sr.transform.localPosition = p;
      if (a.flash > 0) a.sr.color = Color.white;
      else a.sr.color = a.armor && a.hp > 1 ? ArmorColor : AlienColors[a.kind];
    }
    const b = f.boss;
    if (b.active) {
      b.sr.transform.localPosition = new V2(b.x, b.y + Math.sin(b.t * 2) * 0.08);
      b.sr.color = b.flash > 0 ? Color.lerp(Color.white, Pink, 0.3) : Color.white;
    }
    for (const bk of f.bunkers) if (bk.dirty) this.RebuildBunker(bk);
  }

  // ------------------------------------------------------------------ bot

  private TickBot(f: Field, c: Cannon, bot: Bot, dt: number) {
    const d = bot.diff;
    const look = [0.3, 0.6, 0.95][d], speedK = [0.5, 0.75, 1][d], err = [0.55, 0.25, 0.06][d], think = [0.6, 0.3, 0.1][d];
    const cy = -f.H / 2 + 1.3;
    // threats
    const danger = (x: number) => {
      for (const s of f.shots) {
        if (!s.active || s.friendly || s.vel.y >= 0) continue;
        const t = (s.pos.y - cy) / -s.vel.y;
        if (t < 0 || t > look) continue;
        const sx = s.pos.x + s.vel.x * t;
        if (Math.abs(sx - x) < 0.62) return true;
      }
      return false;
    };
    bot.think -= dt;
    let goal = bot.targetX;
    if (danger(c.x) && (d > 0 || Math.random() < 0.5)) {
      const lim = f.W / 2 - 0.6;
      const opts = [1.1, -1.1, 2, -2, 3, -3].map((o) => Mathf.clamp(c.x + o, -lim, lim)).filter((x) => !danger(x));
      if (opts.length) { goal = opts[0]; bot.dodging = true; bot.targetX = goal; bot.think = think; }
    } else if (bot.think <= 0) {
      bot.think = think;
      bot.dodging = false;
      let tx: number | null = null;
      if (f.ufo.active && d > 0 && Math.abs(f.ufo.x) < f.W / 2 - 1) tx = f.ufo.x + f.ufo.dir * 1.2;
      else if (f.boss.active) tx = f.boss.x;
      else {
        // nearest column, lower invaders first
        let best = 1e9;
        for (const a of f.aliens) {
          if (!a.alive || a.enter > 0) continue;
          const p = this.AlienPos(f, a);
          const score = Math.abs(p.x - c.x) + (p.y + f.H / 2) * (d === 2 ? 0.35 : 0.1);
          if (score < best) { best = score; tx = p.x + f.dir * (d === 2 ? 0.15 : 0); }
        }
      }
      if (tx !== null) bot.targetX = tx + (Math.random() - 0.5) * 2 * err;
      goal = bot.targetX;
    }
    const step = CannonSpeed * speedK * dt;
    const nx = c.x + Mathf.clamp(goal - c.x, -step, step);
    if (!danger(nx) || bot.dodging || d === 0) { c.targetX = nx; c.hasTarget = true; }
    else c.hasTarget = false;
    c.keyMove = 0;
  }

  // ------------------------------------------------------------------ input

  private ToLocal(f: Field, w: V2) { const l = f.root.inverseTransformPoint(w); return new V2(l.x, l.y); }
  private ToWorld(f: Field, l: V2) { const w = f.root.transformPoint(l); return new V2(w.x, w.y); }

  private HumanCannons() {
    const out: Cannon[] = [];
    for (const f of this.fields) if (f.root.activeSelf) for (const c of f.cannons) if (c.sr.gameObject.activeSelf && c.human) out.push(c);
    return out;
  }

  private ReadInput() {
    const humans = this.HumanCannons();
    // keyboard
    const K = Keyboard;
    const p1Left = K.letter("a").isPressed, p1Right = K.letter("d").isPressed, p1Fire = K.space.isPressed || K.letter("w").isPressed;
    const arrowsL = K.left.isPressed, arrowsR = K.right.isPressed, arrowsFire = K.up.isPressed || K.enter.isPressed;
    const twoKeyboards = humans.length >= 2;
    for (const c of humans) {
      const isP1 = c === humans[0];
      let mv = 0, fire = false;
      if (isP1) { mv = (p1Right ? 1 : 0) - (p1Left ? 1 : 0); fire = p1Fire; if (!twoKeyboards) { mv += (arrowsR ? 1 : 0) - (arrowsL ? 1 : 0); fire ||= arrowsFire; } }
      else { mv = (arrowsR ? 1 : 0) - (arrowsL ? 1 : 0); fire = arrowsFire; }
      // keys act in screen space: flip for a rotated field
      c.keyMove = Mathf.clamp(mv, -1, 1) * (c.field.rot === 180 ? -1 : 1);
      c.keyFire = fire;
    }
    // touches and mouse
    const pts: { id: number; pos: V2; down: boolean; pressed: boolean }[] = [];
    for (const t of Touchscreen.touches) { this.usingTouch = true; pts.push({ id: t.touchId, pos: t.position, down: t.press.wasPressedThisFrame, pressed: t.press.isPressed && !t.press.wasReleasedThisFrame }); }
    if (Mouse.present && !(this.usingTouch && Touchscreen.present)) pts.push({ id: -1, pos: Mouse.position, down: Mouse.leftButton.wasPressedThisFrame, pressed: Mouse.leftButton.isPressed });
    for (const p of pts) {
      if (p.down && !this.binds.has(p.id) && !overUI(p.pos) && !this.ended) {
        const c = this.CannonForPoint(p.pos, humans);
        if (c) {
          const l = this.ToLocal(c.field, this.ScreenToWorld(p.pos));
          this.binds.set(p.id, { cannon: c, startLocal: l.x, startX: c.x, t0: Time.unscaledTime, moved: false });
        }
      }
      const b = this.binds.get(p.id);
      if (!b) continue;
      const l = this.ToLocal(b.cannon.field, this.ScreenToWorld(p.pos));
      const dx = l.x - b.startLocal;
      if (Math.abs(dx) > 0.15) {
        if (!b.moved) { b.moved = true; b.startLocal = l.x; b.startX = b.cannon.x; }
        b.cannon.targetX = b.startX + (l.x - b.startLocal) * 1.3;
        b.cannon.hasTarget = true;
      }
      if (!p.pressed) {
        if (!b.moved && Time.unscaledTime - b.t0 < 0.4) b.cannon.fireRequest = true;
        this.binds.delete(p.id);
      }
    }
    for (const id of [...this.binds.keys()]) if (!pts.some((p) => p.id === id)) this.binds.delete(id);
  }

  private CannonForPoint(screen: V2, humans: Cannon[]) {
    if (humans.length === 0) return null;
    const w = this.ScreenToWorld(screen);
    if (this.mode === Mode.Coop) return screen.x < Screen.width / 2 ? humans[0] : humans[1] ?? humans[0];
    for (const c of humans) {
      const l = this.ToLocal(c.field, w);
      if (Math.abs(l.x) <= c.field.W / 2 + 0.5 && Math.abs(l.y) <= c.field.H / 2 + 0.5) return c;
    }
    return this.mode === Mode.Solo ? humans[0] : null;
  }

  // ------------------------------------------------------------------ HUD

  private AnnounceField(f: Field, text: string, color: Color) {
    if (this.State === Phase.Title) return;
    if (this.mode === Mode.VsCpu || this.mode === Mode.Split) this.Float(f, new V2(0, 1), text, color, 1.6);
    else this.UI.Announce(text, color, 1.4);
  }

  private Float(f: Field, local: V2, text: string, color: Color, life = 1) {
    if (this.State === Phase.Title) return;
    const h = f.hud;
    let fl = h.floats.find((x) => !x.t.gameObject.activeSelf);
    if (!fl) fl = h.floats.reduce((m, x) => (x.age > m.age ? x : m), h.floats[0]);
    fl.start = new V2(Mathf.clamp(local.x * h.k, -h.w / 2 + 250, h.w / 2 - 250), Mathf.clamp(local.y * h.k, -h.h / 2 + 100, h.h / 2 - 220));
    fl.age = -life + 1;
    fl.t.text = text;
    fl.t.color = color;
    fl.t.fontSize = text.length > 14 ? 40 : 48;
    fl.t.rectTransform.place(UIKit.Center, fl.start, new V2(900, 70));
    fl.t.gameObject.setActive(true);
  }

  private UpdateHud(f: Field) {
    const h = f.hud;
    const coop = this.mode === Mode.Coop;
    for (let i = 0; i < 2; i++) {
      const c = f.cannons[i], show = i === 0 || coop;
      h.score[i].gameObject.setActive(show);
      h.sub[i].gameObject.setActive(show);
      for (let k = 0; k < 5; k++) {
        h.lives[i][k].gameObject.setActive(show && k < c.lives);
        h.lives[i][k].color = c.color;
      }
      if (!show) continue;
      set(h.score[i], Fmt.n(c.score));
      h.score[i].color = Color.lerp(c.color, Color.white, 0.6);
      const best = this.mode === Mode.Solo ? `HI ${Fmt.n(Math.max(this.Data.get("best"), c.score))}` : c.name;
      set(h.sub[i], c.out ? `${c.name}: OUT` : best + (c.rapid > 0 ? "  · RAPID" : c.spread > 0 ? "  · SPREAD" : ""));
    }
    set(h.wave, f.between > 0 ? "GET READY" : f.boss.active ? `WAVE ${f.wave} · MOTHERSHIP` : `WAVE ${f.wave}`);
    const split = this.mode === Mode.VsCpu || this.mode === Mode.Split;
    h.timer.gameObject.setActive(split);
    if (split) {
      set(h.timer, Fmt.clock(Math.ceil(this.timeLeft)));
      h.timer.color = this.timeLeft < 10 && Math.sin(Time.time * 10) > 0 ? CpuCol : Color.white;
    }
    h.bossBar.setActive(f.boss.active);
    if (f.boss.active) UIKit.setMeter(h.bossFill, f.boss.hp / f.boss.max);
    const dt = Time.unscaledDeltaTime;
    for (const fl of h.floats) {
      if (!fl.t.gameObject.activeSelf) continue;
      fl.age += dt;
      const k = Mathf.clamp01(fl.age);
      if (fl.age >= 1) { fl.t.gameObject.setActive(false); continue; }
      fl.t.rectTransform.anchoredPosition = fl.start.add(new V2(0, 70 * k));
      const s = k < 0.12 ? Mathf.lerp(0.5, 1.15, k / 0.12) : Mathf.lerp(1.15, 1, Mathf.clamp01((k - 0.12) / 0.2));
      fl.t.rectTransform.localScale = new V3(s, s, 1);
      fl.t.color = fl.t.color.withAlpha(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    }
  }

  // ------------------------------------------------------------------ results

  private End() {
    if (this.ufoLoop) this.ufoLoop.volume = 0;
    const f0 = this.fields[0];
    if (this.mode === Mode.Solo || this.mode === Mode.Coop) {
      const coop = this.mode === Mode.Coop;
      const cs = coop ? f0.cannons : [f0.cannons[0]];
      const score = cs.reduce((s, c) => s + c.score, 0);
      const key = coop ? "bestCoop" : "best";
      const newBest = this.Data.max(key, score);
      if (!coop) this.Data.max("bestWave", f0.wave);
      const shots = cs.reduce((s, c) => s + c.shotsFired, 0), hits = cs.reduce((s, c) => s + c.hits, 0);
      const r = new Result({
        Headline: f0.invaded ? "INVADED!" : "GAME OVER",
        HeadlineColor: f0.invaded ? CpuCol : Pal.TextDim,
        Value: Fmt.n(score),
        CountTo: score,
        NewBest: newBest,
        BestLine: `REACHED WAVE ${f0.wave}  ·  ${coop ? "CO-OP BEST" : "HIGH SCORE"} ${Fmt.n(this.Data.get(key))}`,
        Stats: coop
          ? [["PLAYER 1", Fmt.n(cs[0].score)], ["PLAYER 2", Fmt.n(cs[1].score)], ["WAVE", String(f0.wave)], ["ACCURACY", `${Math.round((100 * hits) / Math.max(1, shots))}%`]]
          : [["WAVE", String(f0.wave)], ["INVADERS", String(cs[0].kills)], ["SAUCERS", String(cs[0].ufos)], ["ACCURACY", `${Math.round((100 * hits) / Math.max(1, shots))}%`]],
        Primary: "PLAY AGAIN",
        Victory: newBest,
      });
      if (!this.revived) { r.Reward = () => this.ExtraLife(); r.RewardLabel = coop ? "EXTRA LIFE EACH: CONTINUE (WATCH AD)" : "EXTRA LIFE: CONTINUE (WATCH AD)"; }
      this.Finish(r);
      return;
    }
    const a = f0.cannons[0], b = this.fields[1].cannons[0];
    let w: number;
    if (this.fields[0].over && !this.fields[1].over) w = 1;
    else if (this.fields[1].over && !this.fields[0].over) w = 0;
    else w = a.score === b.score ? -1 : a.score > b.score ? 0 : 1;
    const why = this.endHead === "KNOCKOUT" ? "KNOCKOUT" : "ON POINTS";
    if (this.mode === Mode.Split) {
      if (w >= 0) this.Data.add("p" + w, 1);
      this.Finish(new Result({
        Headline: w < 0 ? "DRAW!" : `PLAYER ${w + 1} WINS!`,
        HeadlineColor: w === 0 ? P1 : w === 1 ? P2 : Color.white,
        Value: `${Fmt.n(a.score)} – ${Fmt.n(b.score)}`,
        BestLine: `${w < 0 ? "" : why + "  ·  "}WINS  P1 ${this.Data.get("p0")} – ${this.Data.get("p1")} P2`,
        Stats: [["P1 WAVE", String(this.fields[0].wave)], ["P2 WAVE", String(this.fields[1].wave)], ["P1 INVADERS", String(a.kills)], ["P2 INVADERS", String(b.kills)]],
        Primary: "REMATCH",
        Victory: w >= 0,
      }));
      return;
    }
    const won = w === 0;
    if (won) this.Data.add("w" + this.diff, 1); else if (w === 1) this.Data.add("l" + this.diff, 1);
    this.Finish(new Result({
      Headline: won ? "YOU WIN!" : w < 0 ? "DRAW!" : "CPU WINS",
      HeadlineColor: won ? Gold : w < 0 ? Color.white : Pal.hex(0xffb0b8),
      Stars: won ? this.diff + 1 : 0,
      BestLine: `${why}  ·  YOU ${Fmt.n(a.score)} – ${Fmt.n(b.score)} CPU`,
      Stats: [["CPU LEVEL", DiffNames[this.diff]], ["YOUR WAVE", String(this.fields[0].wave)], ["INVADERS", String(a.kills)], ["RECORD", `${this.Data.get("w" + this.diff)} – ${this.Data.get("l" + this.diff)}`]],
      Primary: won ? "PLAY AGAIN" : "REMATCH",
      Victory: won,
    }));
  }

  private ExtraLife() {
    this.revived = true;
    const f = this.fields[0];
    for (const c of f.cannons) {
      if (!c.sr.gameObject.activeSelf) continue;
      c.lives = 1; c.out = false; c.alive = true; c.invuln = 2.5; c.x = c.idx === 0 && this.mode === Mode.Coop ? -2 : c.idx === 1 ? 2 : 0; c.hasTarget = false;
    }
    f.over = false;
    if (f.invaded) {
      // push the fleet back up and repair the bunkers
      f.invaded = false;
      f.oy += 4;
      this.ResetBunkers(f);
    }
    for (const s of f.shots) if (!s.friendly) this.KillShot(s);
    this.ended = false;
    this.binds.clear();
    this.Revive();
    this.UI.Announce("EXTRA LIFE!", Green, 1.2);
    Sfx.play(Snd.PowerUp, 0.8);
  }

  /** Test hook (window.__na.game.debugInfo). */
  get debugInfo() {
    const css = (f: Field, p: V2) => { const s = Camera.worldToScreen(this.ToWorld(f, p)); return { x: s.x / Screen.dpr, y: s.y / Screen.dpr }; };
    return {
      state: this.State, mode: this.mode, countdown: this.countdown, ended: this.ended, timeLeft: this.timeLeft, rewarded: AdService.rewardedAvailable,
      fields: this.fields.map((f) => ({
        active: f.root.activeSelf, wave: f.wave, over: f.over, invaded: f.invaded, W: f.W, rot: f.rot,
        aliens: f.aliens.filter((a) => a.alive).length, boss: f.boss.active ? f.boss.hp : -1,
        cannons: f.cannons.filter((c) => c.sr.gameObject.activeSelf).map((c) => ({ x: c.x, score: c.score, lives: c.lives, alive: c.alive, out: c.out, kills: c.kills, css: css(f, new V2(c.x, -f.H / 2 + 1.3)) })),
        threats: f.shots.filter((s) => s.active && !s.friendly).map((s) => ({ x: s.pos.x, y: s.pos.y })),
        lowest: (() => { const al = f.aliens.filter((a) => a.alive); if (!al.length) return null; const a = al.reduce((m, x) => (this.AlienPos(f, x).y < this.AlienPos(f, m).y ? x : m)); const p = this.AlienPos(f, a); return { x: p.x, y: p.y, css: css(f, p) }; })(),
      })),
    };
  }
}

