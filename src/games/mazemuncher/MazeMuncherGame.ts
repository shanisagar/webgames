import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject, howTo,
  Keyboard, Mathf, Mouse, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer, Text, TextMesh, Time, Touchscreen,
  TouchScheme, UIKit, V2, V3, overUI, dp,
} from "../../kit";
import {
  BackSprite, ChaserBody, DotSprite, EyeWhite, FruitSprite, HeroSprite, MazeSprite, MouthFrames, PelletSprite, Pupil,
  ScaredFace, Themes,
} from "./MazeArt";
import {
  BotLevels, DX, DY, FruitNames, FruitX, FruitY, GState, H, MazeCount, MazeNames, MazeSim, MunchBot, Rng, SimEvent,
  SimState, W,
} from "./MazeSim";

/**
 * MAZE MUNCHER: eat every dot in a neon maze while four jelly chasers hunt you. Each chaser has its own mind: RUSH
 * chases you, TRAP cuts you off, SWOOP flanks with RUSH, WOBBLE wanders. Power pellets turn them blue so you can
 * munch them back, bonus fruit pops up twice a maze, and side tunnels wrap around. SOLO is the classic arcade climb
 * (lives, levels, high score), VS CPU races a computer muncher on the same maze (first to clear, or most points in
 * two minutes) and 2 PLAYERS splits one screen. Swipe anywhere (or arrows / WASD); turns are buffered.
 */

const Ink = Pal.hex(0x0b0a24), Gold = Pal.hex(0xffc93c), Lime = Pal.hex(0x9be84a), Coral = Pal.hex(0xff7a4a);
const HeroColors = [Pal.hex(0x8fe23c), Pal.hex(0xff8a3c)];
const ChaserColors = [Pal.hex(0xff3b5c), Pal.hex(0xb46bff), Pal.hex(0x2fe0c8), Pal.hex(0xffb02e)];
const FrightBlue = Pal.hex(0x3a4dff);
const ModeNames = ["SOLO", "VS CPU", "2 PLAYERS"];
const DiffNames = ["EASY", "NORMAL", "HARD"];
const RaceTime = 120;
const BoardW = 19.7, BoardH = 24.4;

const toLocal = (x: number, y: number) => new V2(x - (W - 1) / 2, (H - 1) / 2 - y);

interface GhostView { root: GameObject; body: SpriteRenderer; eye: SpriteRenderer; pupil: SpriteRenderer; face: SpriteRenderer; shadow: SpriteRenderer }

/** One maze on screen: renders a MazeSim and turns its events into juice. */
class Board {
  root: GameObject;
  dots: (SpriteRenderer | null)[] = [];
  maze!: SpriteRenderer; flash!: SpriteRenderer;
  hero!: SpriteRenderer; heroShadow!: SpriteRenderer;
  ghosts: GhostView[] = [];
  fruit!: SpriteRenderer;
  ready!: TextMesh; scoreText!: TextMesh; nameText!: TextMesh; infoText!: TextMesh;
  lifeIcons: SpriteRenderer[] = [];
  fruitIcons: SpriteRenderer[] = [];
  fx: CasualFx;
  bot: MunchBot | null = null;
  rotated = false;
  deathSpin = 0;
  dotSound = 0;
  pellets: SpriteRenderer[] = [];
  fruitsGot: number[] = [];
  private flashReady = false;

  constructor(parent: GameObject, public sim: MazeSim, public theme: number, readonly heroColor: Color, public label: string, readonly owner: number) {
    this.root = new GameObject("Board", parent);
    this.fx = CasualFx.create(this.root, 40, 140);
    this.build();
  }

  private build() {
    const r = this.root, sim = this.sim, th = Themes[this.theme];
    this.maze = Art.spr(r, "Maze", MazeSprite(sim.rows, this.theme), Color.white, 1, 0, Art.Flat);
    this.flash = Art.spr(r, "Flash", MazeSprite(sim.rows, this.theme), Color.white.withAlpha(0), 1, 1, Art.Flat);
    this.flashReady = false;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = sim.dots[y * W + x];
        if (d === 0) { this.dots.push(null); continue; }
        const p = toLocal(x, y);
        const sr = d === 1
          ? Art.spr(r, "Dot", DotSprite(), th.dot, 0.42, 2, Art.Flat)
          : Art.spr(r, "Pellet", PelletSprite(), CasualArt.lighten(th.glow, 0.35), 0.95, 3, Art.Flat);
        sr.transform.localPosition = new V3(p.x, p.y, 0);
        if (d === 2) this.pellets.push(sr);
        this.dots.push(sr);
      }
    this.fruit = Art.spr(r, "Fruit", FruitSprite(0), Color.white, 1.15, 5, Art.Flat);
    const fp = toLocal(FruitX, FruitY);
    this.fruit.transform.localPosition = new V3(fp.x, fp.y, 0);
    for (let k = 0; k < 4; k++) {
      const g = new GameObject("Chaser" + k, r);
      const shadow = Art.spr(g, "Shadow", CasualArt.Soft, new Color(0, 0, 0, 0.35), 1.2, 6, Art.Flat);
      shadow.transform.localPosition = new V3(0, -0.42, 0);
      shadow.transform.localScale = new V3(1.1, 0.4, 1);
      const body = Art.spr(g, "Body", ChaserBody(), ChaserColors[k], 1.02, 7, Art.Flat);
      const eye = Art.spr(g, "Eye", EyeWhite(), Color.white, 0.46, 8, Art.Flat);
      eye.transform.localPosition = new V3(0, 0.12, 0);
      const pupil = Art.spr(g, "Pupil", Pupil(), Color.white, 0.22, 9, Art.Flat);
      const face = Art.spr(g, "Face", ScaredFace(), Pal.hex(0xffe0f0), 0.62, 8, Art.Flat);
      face.transform.localPosition = new V3(0, 0.08, 0);
      this.ghosts.push({ root: g, body, eye, pupil, face, shadow });
    }
    this.heroShadow = Art.spr(r, "HeroShadow", CasualArt.Soft, new Color(0, 0, 0, 0.35), 1.2, 9, Art.Flat);
    this.hero = Art.spr(r, "Hero", HeroSprite(this.heroColor, 1), Color.white, 1.12, 10, Art.Flat);

    const top = (H - 1) / 2 + 1.45, bottom = -(H - 1) / 2 - 1.3;
    this.nameText = this.text("Name", new V2(-(W - 1) / 2 - 0.3, top), 0.95, "MiddleLeft", CasualArt.lighten(this.heroColor, 0.2));
    this.scoreText = this.text("Score", new V2(0, top), 1.15, "MiddleCenter", Color.white);
    this.infoText = this.text("Info", new V2((W - 1) / 2 + 0.3, top), 0.8, "MiddleCenter", new Color(1, 1, 1, 0.75));
    this.infoText.anchor = "MiddleCenter";
    this.ready = this.text("Ready", toLocal(FruitX, FruitY), 1.15, "MiddleCenter", Gold);
    for (let i = 0; i < 6; i++) {
      const sr = Art.spr(r, "Life", HeroSprite(this.heroColor, 2), Color.white, 0.85, 20, Art.Flat);
      sr.transform.localPosition = new V3(-(W - 1) / 2 + 0.2 + i * 1.0, bottom, 0);
      this.lifeIcons.push(sr);
    }
    for (let i = 0; i < 7; i++) {
      const sr = Art.spr(r, "FruitIcon", FruitSprite(0), Color.white, 0.85, 20, Art.Flat);
      sr.transform.localPosition = new V3((W - 1) / 2 - 0.2 - i * 1.0, bottom, 0);
      sr.enabled = false;
      this.fruitIcons.push(sr);
    }
  }

  private text(name: string, p: V2, size: number, anchor: TextMesh["anchor"], color: Color) {
    const go = new GameObject(name, this.root);
    go.localPosition = new V3(p.x, p.y, 0);
    const t = go.addComponent(new TextMesh());
    t.fontSize = 40;
    t.characterSize = size / 4;
    t.anchor = anchor;
    t.color = color;
    t.sortingOrder = 22;
    return t;
  }

  destroy() { this.root.destroy(); }

  /** Board-local cell position → world. */
  world(x: number, y: number) { const p = toLocal(x, y); return this.root.transformPoint(p); }

  /** Swaps in a fresh sim for the next level (rebuilds dots and the maze texture). */
  rebuild(sim: MazeSim, theme: number) {
    this.theme = theme;
    for (const c of [...this.root.children]) if (c !== this.fx.gameObject) c.destroy();
    this.sim = sim;
    this.dots = [];
    this.ghosts = [];
    this.lifeIcons = [];
    this.fruitIcons = [];
    this.pellets = [];
    this.build();
  }

  sync(dt: number, showLives: boolean) {
    const sim = this.sim, t = Time.time;
    // hero
    const h = sim.hero;
    const hp = toLocal(h.x, h.y);
    const moving = sim.state === SimState.Play && h.dir >= 0;
    let frame = 1;
    if (moving || sim.chomp > 0) frame = Math.floor(Mathf.pingPong(sim.time * 16, MouthFrames - 0.01));
    const dying = sim.state === SimState.Dying;
    if (dying) {
      const k = 1 - Mathf.clamp01(sim.stateT / 1.7);
      this.deathSpin += dt * 900 * (0.3 + k);
      frame = Math.min(MouthFrames - 1, Math.floor(k * 6));
      const s = 1.12 * Math.max(0, 1 - Mathf.clamp01((k - 0.35) / 0.55));
      this.hero.transform.localScale = new V3(s, s, 1);
      this.hero.transform.localEulerZ = this.deathSpin;
      this.hero.flipX = false;
    } else {
      this.deathSpin = 0;
      const f = h.face >= 0 ? h.face : 3;
      const bob = moving ? 1 + Math.sin(sim.time * 22) * 0.03 : 1 + Math.sin(t * 3) * 0.02;
      this.hero.transform.localScale = new V3(1.12 * bob, 1.12 / bob, 1);
      this.hero.flipX = f === 1;
      this.hero.transform.localEulerZ = f === 0 ? 90 : f === 2 ? -90 : 0;
    }
    this.hero.sprite = HeroSprite(this.heroColor, frame);
    this.hero.transform.localPosition = new V3(hp.x, hp.y, 0);
    this.heroShadow.transform.localPosition = new V3(hp.x + 0.08, hp.y - 0.12, 0);
    const edge = this.edgeFade(h.x);
    this.hero.color = Color.white.withAlpha(edge * (sim.state === SimState.Over ? 0 : 1));
    this.heroShadow.color = new Color(0, 0, 0, 0.3 * edge * (dying ? 0 : 1));

    // chasers
    const flashing = sim.frightT > 0 && sim.frightT < 2 && Math.floor(sim.frightT * 5) % 2 === 0;
    const hideGhosts = (dying && sim.stateT < 1.25) || sim.state === SimState.Clear || sim.state === SimState.Over;
    for (let k = 0; k < 4; k++) {
      const g = sim.ghosts[k], v = this.ghosts[k];
      const p = toLocal(g.x, g.y);
      v.root.localPosition = new V3(p.x, p.y, 0);
      v.root.setActive(!hideGhosts);
      if (hideGhosts) continue;
      const fade = g.state === GState.Active ? this.edgeFade(g.m.x) : 1;
      const wob = Math.sin(t * 9 + k * 1.7) * 0.05;
      v.body.transform.localScale = new V3(1.02 * (1 - wob), 1.02 * (1 + wob), 1);
      const dir = g.state === GState.Active ? g.m.face : g.state === GState.Leaving ? 0 : g.state === GState.Entering ? 2 : (Math.sin(g.bob) > 0 ? 0 : 2);
      const look = dir >= 0 ? new V2(DX[dir], -DY[dir]) : V2.zero;
      if (g.eyes) {
        v.body.color = Color.clear;
        v.face.color = Color.clear;
        v.shadow.color = Color.clear;
        v.eye.color = Color.white.withAlpha(fade);
        v.pupil.color = Color.white.withAlpha(fade);
      } else if (g.fright) {
        v.body.color = (flashing ? Pal.hex(0xf2f4ff) : FrightBlue).withAlpha(fade);
        v.face.color = (flashing ? Pal.hex(0xff4d6d) : Pal.hex(0xffe0f0)).withAlpha(fade);
        v.eye.color = Color.clear;
        v.pupil.color = Color.clear;
        v.shadow.color = new Color(0, 0, 0, 0.3 * fade);
      } else {
        v.body.color = ChaserColors[k].withAlpha(fade);
        v.face.color = Color.clear;
        v.eye.color = Color.white.withAlpha(fade);
        v.pupil.color = Color.white.withAlpha(fade);
        v.shadow.color = new Color(0, 0, 0, 0.3 * fade);
      }
      v.pupil.transform.localPosition = new V3(look.x * 0.1, 0.12 + look.y * 0.1, 0);
    }

    // pellets pulse, fruit bob
    const ps = 0.95 * (1 + Math.sin(t * 7) * 0.14);
    for (const p of this.pellets) if (p.enabled) p.transform.localScale = new V3(ps, ps, 1);
    if (sim.fruitKind >= 0) {
      this.fruit.enabled = true;
      this.fruit.sprite = FruitSprite(sim.fruitKind);
      const s = 1.15 * (1 + Math.sin(t * 5) * 0.07);
      this.fruit.transform.localScale = new V3(s, s, 1);
      this.fruit.color = Color.white.withAlpha(sim.fruitT < 2 && Math.floor(sim.fruitT * 6) % 2 === 0 ? 0.4 : 1);
    } else this.fruit.enabled = false;

    // clear flash
    if (sim.state === SimState.Clear && !this.flashReady) { this.flashReady = true; this.flash.sprite = MazeSprite(sim.rows, this.theme, true); }
    if (sim.state === SimState.Clear) this.flash.color = Color.white.withAlpha(Math.floor(sim.stateT * 5) % 2 === 0 ? 1 : 0);
    else this.flash.color = Color.white.withAlpha(0);

    // texts
    this.scoreText.text = Fmt.n(sim.score);
    this.nameText.text = this.label;
    this.ready.text = sim.state === SimState.Ready ? (sim.stateT > 0.5 ? "READY?" : "GO!") : sim.state === SimState.Over ? "GAME OVER" : sim.state === SimState.Clear ? "CLEAR!" : "";
    this.ready.color = sim.state === SimState.Over ? Pal.hex(0xff5a7a) : sim.state === SimState.Clear ? Lime : Gold;
    for (let i = 0; i < this.lifeIcons.length; i++) this.lifeIcons[i].enabled = showLives && i < sim.lives - (sim.state === SimState.Play || sim.state === SimState.Ready ? 1 : 0);
    for (let i = 0; i < this.fruitIcons.length; i++) {
      const k = this.fruitsGot[this.fruitsGot.length - 1 - i];
      this.fruitIcons[i].enabled = k !== undefined;
      if (k !== undefined) this.fruitIcons[i].sprite = FruitSprite(k);
    }
  }

  private edgeFade(x: number) { return x < 0 ? Mathf.clamp01(1 + x) : x > W - 1 ? Mathf.clamp01(W - x) : 1; }

  eatDot(x: number, y: number) {
    const i = y * W + x, sr = this.dots[i];
    if (sr) { sr.enabled = false; this.dots[i] = null; }
  }
}

class Swipe { constructor(public start: V2, public owner: number) {} }

export class MazeMuncherGame extends ArcadeGame {
  private world!: GameObject;
  private bgCover!: SpriteRenderer;
  private boards: Board[] = [];
  private demo: Board | null = null;
  private mode = 0; private diff = 1;
  private level = 1;
  private raceT = 0;
  private ended = false; private endT = 0;
  private revives = 0;
  private headStart = false;
  private swipes = new Map<number, Swipe>();
  private portrait = true;
  private rotateTop = false;
  private totalDots = 0;

  private modeButtons: ArcadeButton[] = [];
  private diffButtons: ArcadeButton[] = [];
  private timerText!: Text;
  private levelText!: Text;
  private bestText!: Text;

  private sDot: AudioClip[] = [];
  private sPellet!: AudioClip; private sGhost!: AudioClip; private sFruit!: AudioClip; private sDeath!: AudioClip;
  private sClear!: AudioClip; private sLife!: AudioClip; private sTurn!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "mazemuncher",
      Title: "MAZE MUNCHER",
      Tagline: "EAT THE DOTS. DODGE THE GHOSTS.",
      PlayLabel: "PLAY",
      Accent: Lime,
      Accent2: Gold,
      BgTop: Pal.hex(0x1a1450),
      BgBottom: Pal.hex(0x07081c),
      ShortSide: 26,
      Touch: TouchScheme.None,
      Music: { bpm: 128, rootHz: 98, degrees: [0, 5, 3, 4], seed: 64, energy: 0.6, major: false },
      Reminders: [
        "The chasers are restless|Can you clear the next maze?",
        "Beat your high score|Power pellets turn the tables.",
        "Race the CPU muncher|First to clear the maze wins.",
      ],
      HowTo: [
        howTo(Art.Chevron, Lime, "SWIPE anywhere (or arrows / WASD) to steer. Swipe early: the turn waits for the next corner."),
        howTo(Art.Disc, Pal.hex(0xffd9a8), "Eat every dot to clear the maze. Side tunnels wrap around."),
        howTo(Art.Ring, Pal.hex(0x7aa2ff), "POWER PELLETS turn the chasers blue: munch them for 200, 400, 800, 1600!"),
        howTo(Art.Diamond, ChaserColors[0], "RUSH chases you, TRAP cuts you off, SWOOP flanks, WOBBLE wanders."),
        howTo(Art.Star, Gold, "Bonus fruit appears twice per maze. Extra life every 10,000 points."),
        howTo(Art.Square, Coral, "VS CPU: race a computer muncher. 2 PLAYERS: split screen, one half each."),
      ],
      Tips: [
        "Chasers alternate between scattering to their corners and hunting you.",
        "Save a power pellet for when the chasers bunch up.",
        "Chasers slow down in the side tunnels: use them to escape.",
        "TRAP aims four tiles ahead of you: change direction to fool it.",
        "Swipe before you reach a corner: the turn is buffered.",
      ],
    });
  }

  protected get ShortSide() { return 26; }
  protected BestLine() {
    const m = this.Data.get("mode");
    if (m === 1) { const d = this.Data.get("diff", 1); return `VS CPU ${DiffNames[d]}:  ${this.Data.get("w" + d)} WON  ·  ${this.Data.get("l" + d)} LOST`; }
    if (m === 2) return `PLAYER 1  ${this.Data.get("p1")}  –  ${this.Data.get("p2")}  PLAYER 2`;
    return `HIGH SCORE ${Fmt.n(this.Data.get("best"))}`;
  }
  protected StatsLine() { return `${this.Data.get("games")} GAMES  ·  BEST LEVEL ${Math.max(1, this.Data.get("bestLevel"))}  ·  ${Fmt.n(this.Data.get("dots"))} DOTS EATEN`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__mazemuncher = this;
    CasualLook.calm(this, 1.1, 0.25);
    this.world = new GameObject("MazeWorld", this.gameObject);
    this.bgCover = CasualLook.cover(this.world, BackSprite(), -910);
    this.BuildSounds();
    const hud = this.UI.Hud;
    this.timerText = UIKit.at(UIKit.label(hud, "", 54, Color.white), new V2(0.5, 1), new V2(0, -80), new V2(400, 70));
    UIKit.glow(this.timerText, Ink, 4);
    this.levelText = UIKit.at(UIKit.label(hud, "", 34, Gold), new V2(0.5, 1), new V2(0, -70), new V2(700, 50));
    UIKit.glow(this.levelText, Ink, 3);
    this.bestText = UIKit.at(UIKit.label(hud, "", 26, new Color(1, 1, 1, 0.7)), new V2(0.5, 1), new V2(0, -112), new V2(700, 40));
    UIKit.glow(this.bestText, Ink, 3);
    this.BuildTitle();
    this.Layout();
  }

  private BuildTitle() {
    const ex = this.UI.TitleExtra;
    if (!ex) return;
    for (let i = 0; i < 3; i++) {
      const b = UIKit.buttonAt(ex, ModeNames[i], UIKit.Center, new V2((i - 1) * 325, 18), new V2(305, 96), false, () => this.PickMode(i), 32);
      this.modeButtons.push(b);
    }
    for (let i = 0; i < 3; i++) {
      const b = UIKit.buttonAt(ex, DiffNames[i], UIKit.Center, new V2((i - 1) * 190, -66), new V2(176, 58), false, () => this.PickDiff(i), 22);
      this.diffButtons.push(b);
    }
    CasualLook.titleCard(this.UI, new Color(0.03, 0.02, 0.1, 0.72), new V2(1060, 1080), -20);
    this.RefreshTitle();
  }

  private PickMode(i: number) {
    this.Data.set("mode", i);
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
  }

  private PickDiff(i: number) {
    this.Data.set("diff", i);
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
  }

  private RefreshTitle() {
    const m = this.Data.get("mode"), d = this.Data.get("diff", 1);
    for (let i = 0; i < 3; i++) {
      const on = i === m;
      this.modeButtons[i].setAccent(on ? Lime : new Color(0.55, 0.55, 0.75, 1));
      this.modeButtons[i].node.localScale = on ? new V3(1.05, 1.05, 1) : V3.one;
      if (this.modeButtons[i].label) this.modeButtons[i].label!.color = on ? Color.white : new Color(1, 1, 1, 0.6);
    }
    for (let i = 0; i < 3; i++) {
      this.diffButtons[i].node.setActive(m === 1);
      this.diffButtons[i].setAccent(i === d ? Gold : new Color(0.55, 0.55, 0.75, 1));
      if (this.diffButtons[i].label) this.diffButtons[i].label!.color = i === d ? Color.white : new Color(1, 1, 1, 0.55);
    }
    if (this.State === Phase.Title) this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private BuildSounds() {
    const noise = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    this.sDot = [0, 1].map((k) => Sfx.make("mm-dot" + k, 0.07, (t) => Sfx.triP(Sfx.glide(t, k ? 640 : 480, k ? 420 : 700, 0.06)) * Sfx.env(t, 0.003, 0.06) * 0.28));
    this.sPellet = Sfx.make("mm-pellet", 0.5, (t) => (Sfx.sqrP(Sfx.glide(t, 180, 720, 0.4)) * 0.25 + Sfx.sinP(Sfx.glide(t, 360, 1440, 0.4)) * 0.3) * Sfx.env(t, 0.01, 0.45) * 0.5);
    this.sGhost = Sfx.make("mm-ghost", 0.42, (t) => {
      const notes = [523, 659, 784, 1047], i = Math.min(3, Math.floor(t / 0.08));
      return (Sfx.sqrP(notes[i] * t) * 0.18 + Sfx.sinP(notes[i] * 2 * t) * 0.2) * Sfx.env(t, 0.004, 0.4) * 0.7;
    });
    this.sFruit = Sfx.make("mm-fruit", 0.5, (t) => {
      let v = 0;
      for (const [d, f] of [[0, 1319], [0.07, 1568], [0.14, 2093]]) v += Sfx.sinP(f * (t - d)) * Sfx.env(t - d, 0.002, 0.25) * 0.35;
      return v;
    });
    this.sDeath = Sfx.make("mm-death", 1.3, (t) => {
      const f = 620 * Math.pow(0.25, t / 1.1) * (1 + 0.06 * Math.sin(t * 60));
      return (Sfx.triP(f * t) * 0.4 + Sfx.sqrP(f * 0.5 * t) * 0.12 + noise(Math.trunc(t * 44100)) * 0.05 * Sfx.env(t - 1.0, 0.01, 0.3)) * Sfx.env(t, 0.01, 1.25);
    });
    this.sClear = Sfx.make("mm-clear", 1.0, (t) => {
      const notes = [523, 659, 784, 1047, 784, 1047, 1319];
      let v = 0;
      for (let i = 0; i < notes.length; i++) { const d = i * 0.11; v += (Sfx.sqrP(notes[i] * (t - d)) * 0.12 + Sfx.sinP(notes[i] * (t - d)) * 0.2) * Sfx.env(t - d, 0.003, i === notes.length - 1 ? 0.35 : 0.1); }
      return v * 0.8;
    });
    this.sLife = Sfx.make("mm-life", 0.6, (t) => {
      let v = 0;
      for (let i = 0; i < 6; i++) { const d = i * 0.07; v += Sfx.sinP((880 + i * 220) * (t - d)) * Sfx.env(t - d, 0.002, 0.08) * 0.3; }
      return v;
    });
    this.sTurn = Sfx.make("mm-turn", 0.04, (t) => Sfx.sinP(1800 * t) * Sfx.env(t, 0.001, 0.03) * 0.08);
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    if (!this.world) return;
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    this.portrait = Screen.height >= Screen.width;
    const list = this.State === Phase.Playing || this.State === Phase.Paused || (this.State === Phase.Over && this.boards.length) ? this.boards : this.demo ? [this.demo] : [];
    if (list.length === 1) {
      const r = this.PlayRect(this.portrait ? 175 : 130, this.portrait ? 60 : 30, 0.2);
      this.Place(list[0], r.center, Math.min(r.width / BoardW, r.height / BoardH), false);
    } else if (list.length === 2) {
      const r = this.PlayRect(this.portrait ? 120 : 150, 20, 0.15);
      if (this.portrait) {
        const gap = 1.8, hh = (r.height - gap) / 2;
        const s = Math.min(r.width / BoardW, hh / BoardH);
        this.Place(list[0], new V2(r.center.x, r.yMin + hh / 2), s, false);
        this.Place(list[1], new V2(r.center.x, r.yMax - hh / 2), s, this.rotateTop);
      } else {
        const gap = 1.2, hw = (r.width - gap) / 2;
        const s = Math.min(hw / BoardW, r.height / BoardH);
        this.Place(list[0], new V2(r.xMin + hw / 2, r.center.y), s, false);
        this.Place(list[1], new V2(r.xMax - hw / 2, r.center.y), s, false);
      }
    }
    this.LayoutHud();
  }

  private Place(b: Board, c: V2, s: number, rotated: boolean) {
    b.root.localPosition = new V3(c.x, c.y, 0);
    b.root.localScale = new V3(s, s, 1);
    b.root.localEulerZ = rotated ? 180 : 0;
    b.rotated = rotated;
  }

  private LayoutHud() {
    const split = this.boards.length === 2;
    if (split && this.portrait) {
      // timer sits between the two mazes
      const a = this.boards[0].root.localPosition, b = this.boards[1].root.localPosition, s = this.boards[0].root.localScale.y;
      const mid = new V2(0, (a.y + BoardH * s * 0.5 + b.y - BoardH * s * 0.5) / 2);
      const hp = this.UI.WorldToHud(mid);
      this.timerText.rectTransform.place(UIKit.Center, hp, new V2(400, 70));
      if (this.rotateTop) this.timerText.rectTransform.localEulerAngles = new V3(0, 0, 0);
    } else this.timerText.rectTransform.place(new V2(0.5, 1), new V2(0, -80), new V2(400, 70));
  }

  // ------------------------------------------------------------------ lifecycle

  private ClearBoards() {
    for (const b of this.boards) b.destroy();
    this.boards = [];
  }

  protected OnEnterTitle() {
    this.ClearBoards();
    this.StartDemo();
    this.RefreshTitle();
    this.timerText.text = "";
    Sfx.setIntensity(0.1);
  }

  private StartDemo() {
    this.demo?.destroy();
    const maze = Math.floor(Math.random() * MazeCount);
    const sim = new MazeSim(maze, 2, { lives: 3, infiniteLives: true, seed: (Math.random() * 1e9) | 0, extraLifeAt: 0 });
    this.demo = new Board(this.world, sim, maze, HeroColors[0], "DEMO", 0);
    this.demo.bot = new MunchBot(BotLevels[2], new Rng((Math.random() * 1e9) | 0));
    this.Layout();
  }

  protected TickBackground(dt: number) {
    if (this.State === Phase.Over) {
      for (const b of this.boards) b.sync(0, this.mode === 0);
      return;
    }
    const d = this.demo;
    if (!d) return;
    dt = Math.min(dt, 0.05);
    d.bot?.think(d.sim, dt);
    d.sim.step(dt);
    for (const e of d.sim.events) if (e.k === "dot") d.eatDot(e.x, e.y); else if (e.k === "pellet") d.eatDot(e.x, e.y);
    d.sim.events.length = 0;
    d.sync(dt, false);
    if (d.sim.state === SimState.Clear && d.sim.stateT <= 0) this.StartDemo();
  }

  protected BeginRun() {
    this.demo?.destroy();
    this.demo = null;
    this.ClearBoards();
    this.mode = Mathf.clamp(this.Data.get("mode"), 0, 2);
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    this.ended = false;
    this.endT = 0;
    this.revives = 0;
    this.level = 1;
    this.totalDots = 0;
    this.swipes.clear();
    this.Data.add("games", 1);
    const touch = matchMedia?.("(pointer: coarse)").matches ?? false;
    this.rotateTop = this.mode === 2 && touch;
    if (this.mode === 0) {
      const sim = this.MakeSim(0, 1, 3, false, 0, (Math.random() * 1e9) | 0);
      this.boards.push(new Board(this.world, sim, 0, HeroColors[0], "1UP", 0));
      this.levelText.text = `LEVEL 1  ·  ${MazeNames[0]}`;
      if (this.Data.get("games") <= 2) this.UI.Hint("Swipe anywhere to steer. Eat every dot, dodge the chasers!");
    } else {
      const maze = Math.floor(Math.random() * MazeCount), seed = (Math.random() * 1e9) | 0;
      const a = this.MakeSim(maze, 2, 3, true, 0, seed), b = this.MakeSim(maze, 2, 3, true, 0, seed);
      this.boards.push(new Board(this.world, a, maze, HeroColors[0], this.mode === 1 ? "YOU" : "P1", 0));
      this.boards.push(new Board(this.world, b, maze, HeroColors[1], this.mode === 1 ? "CPU" : "P2", 1));
      if (this.mode === 1) {
        this.boards[1].bot = new MunchBot(BotLevels[this.diff], new Rng(seed ^ 0x5bd1e995));
        b.heroSpeedMul = [0.88, 0.95, 1][this.diff];
        if (this.headStart) { b.stateT += 4; this.UI.Announce("HEAD START!", Gold, 1.2); }
      }
      this.raceT = RaceTime;
      this.levelText.text = "";
      this.bestText.text = "";
      if (this.mode === 2) this.UI.Hint(this.portrait ? "Each player swipes on their own half. First to clear wins!" : "P1: WASD / left half  ·  P2: ARROWS / right half");
      else this.UI.Hint("Race the CPU! Clear the maze first or have more points after 2:00.");
    }
    this.headStart = false;
    Sfx.setIntensity(0.45);
    this.Layout();
  }

  private MakeSim(maze: number, level: number, lives: number, infinite: boolean, score: number, seed: number) {
    return new MazeSim(maze, level, { lives, infiniteLives: infinite, seed, extraLifeAt: infinite ? 0 : 10000, startScore: score });
  }

  // ------------------------------------------------------------------ frame

  protected TickRun(dt: number) {
    dt = Math.min(dt, 0.05);
    this.ReadInput();
    for (const b of this.boards) {
      b.bot?.think(b.sim, dt);
      if (!this.ended) b.sim.step(dt);
      this.HandleEvents(b);
      b.sync(dt, this.mode === 0);
    }
    if (this.ended) {
      this.endT -= dt;
      if (this.endT <= 0 && this.State === Phase.Playing) this.End();
      return;
    }
    if (this.mode === 0) this.TickSolo();
    else this.TickRace(dt);
  }

  private TickSolo() {
    const b = this.boards[0], sim = b.sim;
    this.bestText.text = `HIGH SCORE ${Fmt.n(Math.max(this.Data.get("best"), sim.score))}`;
    if (sim.state === SimState.Clear && sim.stateT <= 0) this.NextLevel();
    else if (sim.state === SimState.Over) { this.ended = true; this.endT = 1.2; }
  }

  private NextLevel() {
    const old = this.boards[0].sim;
    this.level++;
    const maze = (this.level - 1) % MazeCount;
    const sim = this.MakeSim(maze, this.level, old.lives, false, old.score, (Math.random() * 1e9) | 0);
    const b = this.boards[0];
    b.rebuild(sim, maze);
    this.levelText.text = `LEVEL ${this.level}  ·  ${MazeNames[maze]}`;
    this.UI.Announce(`LEVEL ${this.level}`, Lime, 1.2);
    this.Data.max("bestLevel", this.level);
    Sfx.setIntensity(Math.min(1, 0.45 + this.level * 0.06));
    this.Layout();
  }

  private TickRace(dt: number) {
    const a = this.boards[0].sim, b = this.boards[1].sim;
    const started = a.state !== SimState.Ready || a.time > 2;
    if (started) this.raceT = Math.max(0, this.raceT - dt);
    const secs = Math.ceil(this.raceT);
    this.timerText.text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    this.timerText.color = this.raceT < 10 ? Pal.hex(0xff5a7a) : Color.white;
    if (a.state === SimState.Clear || b.state === SimState.Clear || this.raceT <= 0) {
      this.ended = true;
      this.endT = 2.2;
      if (this.raceT <= 0) { this.UI.Announce("TIME!", Gold, 1.4); Sfx.play(Snd.Alarm, 0.6); }
    }
  }

  private HandleEvents(b: Board) {
    const sim = b.sim, loud = !b.bot || this.mode === 0 ? 1 : 0.45;
    const th = Themes[b.theme];
    for (const e of sim.events) this.OnEvent(b, e, loud, th.dot);
    sim.events.length = 0;
  }

  private OnEvent(b: Board, e: SimEvent, vol: number, dotColor: Color) {
    switch (e.k) {
      case "dot": {
        b.eatDot(e.x, e.y);
        b.dotSound ^= 1;
        Sfx.playClip(this.sDot[b.dotSound], 0.55 * vol, 1);
        const p = new V2(e.x - (W - 1) / 2, (H - 1) / 2 - e.y);
        b.fx.emit(p, Random2(), dotColor, 0.18, 0.25);
        if (!b.bot) { this.totalDots++; }
        break;
      }
      case "pellet": {
        b.eatDot(e.x, e.y);
        Sfx.playClip(this.sPellet, 0.8 * vol);
        const p = new V2(e.x - (W - 1) / 2, (H - 1) / 2 - e.y);
        b.fx.pop(p, Color.white, 16, 5, 0.25, 0.5);
        this.Back.Flash(Pal.hex(0x7aa2ff), 0.18);
        if (!b.bot) this.totalDots++;
        break;
      }
      case "ghost": {
        Sfx.playClip(this.sGhost, 0.9 * vol);
        const p = new V2(e.x - (W - 1) / 2, (H - 1) / 2 - e.y);
        b.fx.pop(p, ChaserColors[e.kind], 22, 6, 0.3, 0.6);
        b.fx.sparkle(p, Color.white, 6, 0.8, 0.35);
        this.UI.Float(b.world(e.x, e.y).xy, String(e.pts), Pal.hex(0x7af5ff), 1.1);
        if (this.mode === 0) this.Hitstop(0.12);
        Fx.haptic(false);
        break;
      }
      case "fruit": {
        Sfx.playClip(this.sFruit, 0.9 * vol);
        const p = new V2(e.x - (W - 1) / 2, (H - 1) / 2 - e.y);
        b.fx.confetti(p, 20, 6, [Gold, Coral, Lime, Color.white], 0.2);
        this.UI.Float(b.world(e.x, e.y).xy, `${FruitNames[e.kind]} ${e.pts}`, Gold, 1);
        b.fruitsGot.push(e.kind);
        break;
      }
      case "fruitShow":
        if (!b.bot) Sfx.play(Snd.Beep, 0.35);
        break;
      case "death": {
        Sfx.playClip(this.sDeath, 0.8 * vol);
        const h = b.sim.hero;
        b.fx.pop(new V2(h.x - (W - 1) / 2, (H - 1) / 2 - h.y), b.heroColor, 26, 6, 0.3, 0.8);
        if (!b.bot) { this.Fx.shake(0.35); Fx.haptic(true); this.Back.Flash(Pal.hex(0xff3b5c), 0.25); }
        break;
      }
      case "clear":
        Sfx.playClip(this.sClear, 0.9 * vol);
        b.fx.confetti(V2.zero, 50, 9, [Lime, Gold, Coral, Pal.hex(0x7aa2ff), Color.white], 0.25);
        if (this.mode === 0) this.UI.Announce("MAZE CLEAR!", Lime, 1.6);
        break;
      case "life":
        Sfx.playClip(this.sLife, 0.9);
        this.UI.Announce("EXTRA LIFE!", Lime, 1.2);
        break;
      case "over":
        Sfx.play(Snd.Lose, 0.7);
        break;
      case "frightEnd":
      case "respawn":
      case "phase":
        break;
    }
  }

  // ------------------------------------------------------------------ input

  /** Which player a screen point belongs to. */
  private OwnerAt(pos: V2) {
    if (this.mode !== 2) return 0;
    return this.portrait ? (pos.y > Screen.height * 0.5 ? 1 : 0) : (pos.x > Screen.width * 0.5 ? 1 : 0);
  }

  private Steer(owner: number, screenDir: number) {
    this.UI.Hint(null);
    const b = this.boards.find((x) => x.owner === owner && !x.bot);
    if (!b) return;
    const d = b.rotated ? (screenDir + 2) & 3 : screenDir;
    if (b.sim.hero.want !== d) Sfx.playClip(this.sTurn, 0.5);
    b.sim.setWant(d);
  }

  private ReadInput() {
    const K = Keyboard;
    const keyDir = (up: boolean, left: boolean, down: boolean, right: boolean) => (up ? 0 : left ? 1 : down ? 2 : right ? 3 : -1);
    const wasd = keyDir(K.letter("w").wasPressedThisFrame, K.letter("a").wasPressedThisFrame, K.letter("s").wasPressedThisFrame, K.letter("d").wasPressedThisFrame);
    const arrows = keyDir(K.up.wasPressedThisFrame, K.left.wasPressedThisFrame, K.down.wasPressedThisFrame, K.right.wasPressedThisFrame);
    if (this.mode === 2) {
      if (wasd >= 0) this.SteerMaze(0, wasd);
      if (arrows >= 0) this.SteerMaze(1, arrows);
    } else {
      if (wasd >= 0) this.SteerMaze(0, wasd);
      if (arrows >= 0) this.SteerMaze(0, arrows);
    }
    // swipes: every touch is tracked on its own so two players can swipe at once
    const th = dp(16);
    const seen = new Set<number>();
    for (const t of Touchscreen.touches) {
      seen.add(t.touchId);
      this.TrackSwipe(t.touchId, t.position, t.press.wasPressedThisFrame, t.press.isPressed && !t.press.wasReleasedThisFrame, th);
    }
    if (Mouse.present && !(Touchscreen.present && Touchscreen.touches.length)) {
      seen.add(-1);
      this.TrackSwipe(-1, Mouse.position, Mouse.leftButton.wasPressedThisFrame, Mouse.leftButton.isPressed, th);
    }
    for (const id of [...this.swipes.keys()]) if (!seen.has(id)) this.swipes.delete(id);
  }

  private SteerMaze(owner: number, mazeDir: number) {
    this.UI.Hint(null);
    const b = this.boards.find((x) => x.owner === owner && !x.bot);
    if (!b) return;
    b.sim.setWant(mazeDir);
  }

  private TrackSwipe(id: number, pos: V2, down: boolean, held: boolean, th: number) {
    if (down) {
      if (overUI(pos) || pos.y > Screen.height * 0.93) return;
      this.swipes.set(id, new Swipe(pos, this.OwnerAt(pos)));
      return;
    }
    const s = this.swipes.get(id);
    if (!s) return;
    if (!held) { this.swipes.delete(id); return; }
    const d = pos.sub(s.start);
    if (d.magnitude < th) return;
    const dir = Math.abs(d.x) > Math.abs(d.y) ? (d.x > 0 ? 3 : 1) : d.y > 0 ? 0 : 2;
    this.Steer(s.owner, dir);
    s.start = pos;
  }

  // ------------------------------------------------------------------ test hooks (dev only)

  private testBots = new Map<number, MunchBot>();
  TestSuggest(owner: number) {
    const b = this.boards.find((x) => x.owner === owner && !x.bot);
    if (!b) return -1;
    let bot = this.testBots.get(owner);
    if (!bot) { bot = new MunchBot(BotLevels[2], new Rng(owner + 7)); this.testBots.set(owner, bot); }
    const before = b.sim.hero.want;
    bot.think(b.sim, 1);
    const d = b.sim.hero.want;
    b.sim.hero.want = before;
    return b.rotated ? (d + 2) & 3 : d;
  }
  TestInfo() {
    return {
      state: this.State, mode: this.mode, level: this.level, raceT: this.raceT,
      boards: this.boards.map((b) => ({ owner: b.owner, bot: !!b.bot, state: b.sim.state, score: b.sim.score, lives: b.sim.lives, dotsLeft: b.sim.dotsLeft, rotated: b.rotated })),
    };
  }
  set TestSpeed(v: number) { this.SpeedMultiplier = v; }

  // ------------------------------------------------------------------ results

  private End() {
    if (this.mode === 0) { this.EndSolo(); return; }
    const a = this.boards[0].sim, b = this.boards[1].sim;
    let winner: number;
    if (a.state === SimState.Clear && b.state !== SimState.Clear) winner = 0;
    else if (b.state === SimState.Clear && a.state !== SimState.Clear) winner = 1;
    else winner = a.score > b.score ? 0 : b.score > a.score ? 1 : -1;
    const byClear = a.state === SimState.Clear || b.state === SimState.Clear;
    this.Data.add("dots", this.totalDots);
    const left = Math.ceil(this.raceT);
    if (this.mode === 2) {
      if (winner >= 0) this.Data.add(winner === 0 ? "p1" : "p2", 1);
      this.Finish(new Result({
        Headline: winner < 0 ? "DRAW!" : winner === 0 ? "PLAYER 1 WINS!" : "PLAYER 2 WINS!",
        HeadlineColor: winner < 0 ? Color.white : HeroColors[winner],
        Value: `${Fmt.n(a.score)} – ${Fmt.n(b.score)}`,
        BestLine: `MATCHES  P1 ${this.Data.get("p1")}  –  ${this.Data.get("p2")} P2`,
        Stats: [["WIN BY", byClear ? "CLEARING" : "POINTS"], ["TIME LEFT", `${left}s`], ["P1 CHASERS", String(a.ghostsEaten)], ["P2 CHASERS", String(b.ghostsEaten)]],
        Primary: "REMATCH",
        Victory: winner >= 0,
      }));
      return;
    }
    const won = winner === 0, draw = winner < 0;
    if (won) this.Data.add("w" + this.diff, 1); else if (!draw) this.Data.add("l" + this.diff, 1);
    this.Finish(new Result({
      Headline: won ? "YOU WIN!" : draw ? "DRAW!" : "CPU WINS",
      HeadlineColor: won ? Gold : draw ? Color.white : Pal.hex(0xffb0c0),
      Value: `${Fmt.n(a.score)} – ${Fmt.n(b.score)}`,
      Stars: won ? 1 + (byClear ? 1 : 0) + (this.diff === 2 || left >= 30 ? 1 : 0) : 0,
      BestLine: `VS ${DiffNames[this.diff]}:  ${this.Data.get("w" + this.diff)} WON  ·  ${this.Data.get("l" + this.diff)} LOST`,
      Stats: [["CPU", DiffNames[this.diff]], ["WIN BY", byClear ? "CLEARING" : "POINTS"], ["DOTS LEFT", `${a.dotsLeft} – ${b.dotsLeft}`], ["CHASERS", `${a.ghostsEaten} – ${b.ghostsEaten}`]],
      Primary: won ? "PLAY AGAIN" : "REMATCH",
      Victory: won,
      Reward: won ? null : () => { this.headStart = true; this.StartRun(); },
      RewardLabel: "REMATCH WITH A HEAD START (AD)",
    }));
  }

  private EndSolo() {
    const sim = this.boards[0].sim;
    const best = this.Data.max("best", sim.score);
    this.Data.max("bestLevel", this.level);
    this.Data.add("dots", this.totalDots);
    this.totalDots = 0;
    this.Finish(new Result({
      Headline: "GAME OVER",
      HeadlineColor: Pal.hex(0xffb0c0),
      Value: String(sim.score),
      CountTo: sim.score,
      NewBest: best,
      BestLine: `HIGH SCORE ${Fmt.n(this.Data.get("best"))}`,
      Stats: [["LEVEL", String(this.level)], ["DOTS LEFT", String(sim.dotsLeft)], ["CHASERS EATEN", String(sim.ghostsEaten)], ["BONUS FRUIT", String(sim.fruitsEaten)]],
      Primary: "PLAY AGAIN",
      Victory: false,
      Reward: this.revives === 0 ? () => this.Continue() : null,
      RewardLabel: "EXTRA LIFE (WATCH AD)",
    }));
  }

  private Continue() {
    this.revives++;
    this.ended = false;
    const b = this.boards[0];
    b.sim.continueRun(1);
    this.Revive();
    this.HandleEvents(b);
    this.UI.Announce("EXTRA LIFE!", Lime, 1.2);
    Sfx.playClip(this.sLife, 0.9);
  }
}

function Random2() { const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2; return new V2(Math.cos(a) * s, Math.sin(a) * s); }
