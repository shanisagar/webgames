import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, Color, Ease, Fx, GameInfo, GameObject, howTo, LineRenderer, Mathf,
  Mesh, MeshRenderer, Pal, Phase, Quaternion, Random, Result, Sfx, Snd, SpriteRenderer, SysRandom, Text, TextMesh, Time,
  TouchScheme, UIKit, V2, V3,
} from "../../kit";
import { Generator, Lab, Pour, Solver } from "./Brew";

/**
 * ELIXIR LAB: a liquid-sort puzzle in a neon alchemy lab. Tap a flask to lift it, tap another to pour: liquid only
 * lands on the same colour or in an empty flask. Fill every flask with a single colour to complete the brew. Levels
 * are generated deterministically and are always solvable (a solver verifies each one and powers hints). Later levels
 * add more colours and "mystery brews" whose buried layers stay hidden until uncovered. Undo, hints and an extra
 * flask help when stuck; fewer helpers means more stars. (Port of ElixirLabGame.cs.)
 */

const LayerH = 0.46;
const InnerW = 0.58;
const OuterHalf = 0.37;
const BaseY = -1.0; // where the flat part of the liquid starts
const MouthY = BaseY + Lab.Cap * LayerH + 0.3; // glass rim
const SpacingX = 1.06, RowGap = 3.55, Lift = 0.42;
const PourTime = 0.72;
const MaxFlasks = 18;
const TopBand = 300, BottomBand = 290;

const Gold = Pal.hex(0xffc94d);
const Violet = Pal.hex(0xb36bff);
const MysteryColor = Pal.hex(0x2c2546);

const Potions = [
  Color.clear,
  Pal.hex(0xff3b5c), // ruby
  Pal.hex(0xff8a2b), // ember
  Pal.hex(0xffe14d), // sunlight
  Pal.hex(0x8cff4d), // venom
  Pal.hex(0x1fd67a), // emerald
  Pal.hex(0x2ee6e6), // frost
  Pal.hex(0x3d8bff), // sapphire
  Pal.hex(0x7a4dff), // void
  Pal.hex(0xd15cff), // nightshade
  Pal.hex(0xff5cc8), // fairy
  Pal.hex(0xf4f0ff), // moonmilk
  Pal.hex(0xc4874e), // amber
];

const Ranks = ["APPRENTICE", "BREWER", "ALCHEMIST", "MASTER ALCHEMIST", "ARCHMAGE", "PHILOSOPHER"];

class FlaskView {
  Root!: GameObject;
  Glass!: LineRenderer; Shine!: LineRenderer;
  Body!: MeshRenderer;
  Aura!: SpriteRenderer; BottomCap!: SpriteRenderer; Surface!: SpriteRenderer; Cork!: SpriteRenderer; Select!: SpriteRenderer;
  readonly Layers: SpriteRenderer[] = new Array(Lab.Cap);
  /** TextMesh is its own renderer in the kit (C# keeps the MeshRenderer separately). */
  readonly Marks: TextMesh[] = new Array(Lab.Cap);
  Slot = V2.zero;
  LiftT = 0; Shake = 0; CorkT = -1; Pop = 0;
  Busy = false; Corked = false;
  Order = -1;
}

class PourAnim {
  constructor(public P: Pour) {}
  T = 0;
  Landed = false;
}

const SolidSprite = () => Art.shape("solid", () => 1, 8);
const RankFor = (lv: number) => Ranks[lv <= 5 ? 0 : lv <= 15 ? 1 : lv <= 30 ? 2 : lv <= 60 ? 3 : lv <= 100 ? 4 : 5];

export class ElixirLabGame extends ArcadeGame {
  private world!: GameObject;
  private views: FlaskView[] = [];
  private pours: PourAnim[] = [];
  private history: Pour[] = [];
  private demoPlan: [number, number][] = [];
  private display: { c: Color; hidden: boolean; frac: number }[] = [];
  private stream!: LineRenderer;
  private glassMesh!: Mesh;
  private pourClip!: AudioClip; private corkClip!: AudioClip; private revealClip!: AudioClip;

  private lab: Lab | null = null;
  private level = 0; private moves = 0; private selected = -1; private undosLeft = 0; private hintsLeft = 0; private undosUsed = 0;
  private hintsUsed = 0; private hintFrom = -1; private hintTo = -1; private demoStep = 0;
  private flaskAdded = false; private ended = false; private undoAdUsed = false; private stuckShown = false;
  private idle = 0; private endTimer = -1; private demoTimer = 0;
  private need = new V2(6, 4);

  // HUD
  private levelText!: Text; private subText!: Text;
  private undoButton!: ArcadeButton; private hintButton!: ArcadeButton; private flaskButton!: ArcadeButton;

  protected Describe() {
    return new GameInfo({
      Id: "elixirlab",
      Title: "ELIXIR LAB",
      Tagline: "POUR. SORT. BREW THE PERFECT POTION.",
      Accent: Gold,
      Accent2: Violet,
      BgTop: Pal.hex(0x2b0f4f),
      BgBottom: Pal.hex(0x08041a),
      GridSpacing: 1.1,
      ShortSide: 8,
      Touch: TouchScheme.None,
      Music: { bpm: 92, rootHz: 98, degrees: [0, 5, 3, 4], seed: 21, energy: 0.4, major: true },
      Reminders: [
        "The cauldron is bubbling|A new brew is waiting in your lab.",
        "Potions don't sort themselves|Your next elixir needs a steady hand.",
        "Mystery brew detected|Something strange is swirling in the lab...",
      ],
      HowTo: [
        howTo(Art.RoundSquare, Gold, "Tap a flask to lift it, then tap another flask to pour."),
        howTo(Art.Disc, Potions[1], "Liquid only lands on the SAME colour, or in an EMPTY flask."),
        howTo(Art.Star, Potions[5], "Fill every flask with one colour to complete the brew."),
        howTo(Art.Diamond, MysteryColor.scale(2.5), "MYSTERY brews hide buried layers until you uncover them."),
        howTo(Art.Chevron, Violet, "UNDO, HINT and +FLASK help when you're stuck."),
        howTo(Art.Star, Pal.Warn, "Fewer helpers = more stars. Collect them all!"),
      ],
      Tips: [
        "Keep one flask empty as long as you can.",
        "Pour onto flasks that are already almost one colour.",
        "Stuck? Undo a few moves rather than restarting.",
        "Uncover mystery layers early: knowledge is power.",
      ],
    });
  }

  protected get ShortSide() { return ElixirLabGame.FitShortSide(this.need, TopBand, BottomBand); }

  protected BestLine() { return `LEVEL ${this.CurrentLevel}   ·   ${RankFor(this.CurrentLevel)}`; }

  protected StatsLine() {
    const done = this.CurrentLevel - 1;
    return done > 0 ? `${this.Data.get("stars")} STARS   ·   ${done} BREWS COMPLETED` : "A RELAXING POTION-SORTING PUZZLE";
  }

  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("Lab", this.gameObject);
    this.glassMesh = ElixirLabGame.BuildGlassMesh();
    for (let i = 0; i < MaxFlasks; i++) this.views.push(this.CreateFlask(i));
    this.stream = Art.line(this.world, "Stream", Color.white, 0.12, 30);
    this.stream.numCapVertices = 4;
    this.stream.gameObject.setActive(false);

    let ph = 0;
    this.pourClip = Sfx.make("elixir-pour", 0.6, (t) => {
      const f = 170 + 110 * Math.sin(t * 37) + 70 * Math.sin(t * 91);
      ph += f / Sfx.RATE;
      const env = Mathf.clamp01(t / 0.05) * Mathf.clamp01((0.6 - t) / 0.2);
      return Math.sin(ph * Math.PI * 2) * 0.22 * env * (0.55 + 0.45 * Math.sin(t * 70));
    });
    const rng = new SysRandom(4);
    this.corkClip = Sfx.make("elixir-cork", 0.16, (t) =>
      Sfx.sinP(Sfx.glide(t, 1500, 260, 0.07)) * Sfx.env(t, 0.001, 0.06) * 0.4 + (rng.nextDouble() * 2 - 1) * Sfx.env(t, 0.001, 0.015) * 0.25);
    this.revealClip = Sfx.make("elixir-reveal", 0.5, (t) =>
      (Sfx.sinP(Sfx.glide(t, 520, 1040, 0.3)) + 0.4 * Sfx.sinP(Sfx.glide(t, 780, 1560, 0.3))) * Sfx.env(t, 0.01, 0.35) * 0.12);

    this.BuildHud();
  }

  private static BuildGlassMesh() {
    const outline = ElixirLabGame.GlassOutline(false);
    const verts: V3[] = new Array(outline.length + 1);
    const cols: Color[] = new Array(verts.length);
    verts[0] = new V3(0, (BaseY + MouthY) * 0.5, 0);
    const glass = new Color(0.75, 0.85, 1, 0.07);
    cols[0] = glass;
    for (let i = 0; i < outline.length; i++) {
      verts[i + 1] = outline[i];
      cols[i + 1] = glass;
    }
    const tris: number[] = [];
    for (let i = 1; i < verts.length - 1; i++) tris.push(0, i + 1, i);
    tris.push(0, 1, verts.length - 1);
    const m = new Mesh();
    m.name = "Flask Glass";
    m.vertices = verts;
    m.colors = cols;
    m.triangles = tris;
    m.recalculateBounds();
    return m;
  }

  /** The flask silhouette: straight walls, round bottom, a flared rim. */
  private static GlassOutline(withLip: boolean) {
    const pts: V3[] = [];
    if (withLip) pts.push(new V3(-OuterHalf - 0.08, MouthY + 0.06));
    pts.push(new V3(-OuterHalf, MouthY));
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI + (i / 16) * Math.PI;
      pts.push(new V3(Math.cos(a) * OuterHalf, BaseY + Math.sin(a) * OuterHalf));
    }
    pts.push(new V3(OuterHalf, MouthY));
    if (withLip) pts.push(new V3(OuterHalf + 0.08, MouthY + 0.06));
    return pts;
  }

  private CreateFlask(index: number) {
    const v = new FlaskView();
    v.Root = new GameObject("Flask " + index, this.world);
    v.Select = Art.spr(v.Root, "Select", Art.Glow, Gold, 1, 0, Art.Additive);
    v.Select.transform.localScale = new V3(1.8, 4.2, 1);
    v.Aura = Art.spr(v.Root, "Aura", Art.Glow, Color.clear, 1, 0, Art.Additive);
    v.Aura.transform.localScale = new V3(1.6, 3.4, 1);
    v.Aura.transform.localPosition = new V3(0, BaseY + 0.6, 0);
    v.Body = Art.meshObject(v.Root, "Glass Fill", this.glassMesh, Art.Flat, 1);
    v.BottomCap = Art.spr(v.Root, "Bottom", Art.Disc, Color.white, InnerW / 0.92, 2);
    v.BottomCap.transform.localPosition = new V3(0, BaseY, 0);
    for (let k = 0; k < Lab.Cap; k++) {
      v.Layers[k] = Art.spr(v.Root, "Layer " + k, SolidSprite(), Color.white, 1, 2);
      const tm = new GameObject("Mark " + k, v.Root).addComponent(new TextMesh());
      tm.text = "?";
      tm.fontSize = 64;
      tm.characterSize = 0.06;
      tm.anchor = "MiddleCenter";
      tm.fontStyle = "bold";
      tm.color = new Color(1, 1, 1, 0.55);
      tm.sortingOrder = 4;
      v.Marks[k] = tm;
    }
    v.Surface = Art.spr(v.Root, "Surface", SolidSprite(), Color.white, 1, 3);
    v.Shine = Art.line(v.Root, "Shine", new Color(1, 1, 1, 0.22), 0.05, 5, false, false, Art.LineSoftMat);
    v.Shine.positionCount = 2;
    v.Shine.setPosition(0, new V3(-0.2, BaseY + 0.05, 0));
    v.Shine.setPosition(1, new V3(-0.2, MouthY - 0.25, 0));
    v.Glass = Art.line(v.Root, "Glass", new Color(0.85, 0.9, 1, 0.85), 0.055, 6, false, false);
    const outline = ElixirLabGame.GlassOutline(true);
    v.Glass.positionCount = outline.length;
    v.Glass.setPositions(outline);
    v.Cork = Art.spr(v.Root, "Cork", Art.RoundSquare, Pal.hex(0xc9894a), 1, 7);
    v.Cork.transform.localScale = new V3(0.56, 0.3, 1);
    v.Root.gameObject.setActive(false);
    ElixirLabGame.SetOrders(v, 0);
    return v;
  }

  private static SetOrders(v: FlaskView, offset: number) {
    if (v.Order === offset) return;
    v.Order = offset;
    v.Select.sortingOrder = offset;
    v.Aura.sortingOrder = offset;
    v.Body.sortingOrder = offset + 1;
    v.BottomCap.sortingOrder = offset + 2;
    for (const l of v.Layers) l.sortingOrder = offset + 2;
    v.Surface.sortingOrder = offset + 3;
    for (const m of v.Marks) m.sortingOrder = offset + 4;
    v.Shine.sortingOrder = offset + 5;
    v.Glass.sortingOrder = offset + 6;
    v.Cork.sortingOrder = offset + 7;
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.levelText = UIKit.at(UIKit.label(hud, "", 66, Pal.Text), new V2(0.5, 1), new V2(0, -78), new V2(700, 90));
    UIKit.glow(this.levelText, Gold.withAlpha(0.45), 3);
    this.subText = UIKit.at(UIKit.label(hud, "", 30, Pal.TextDim), new V2(0.5, 1), new V2(0, -145), new V2(800, 44));
    this.undoButton = UIKit.buttonAt(hud, "UNDO", new V2(0.5, 0), new V2(-330, 150), new V2(290, 120), false, () => this.Undo(), 34);
    this.hintButton = UIKit.buttonAt(hud, "HINT", new V2(0.5, 0), new V2(0, 150), new V2(290, 120), false, () => this.Hint(), 34);
    this.flaskButton = UIKit.buttonAt(hud, "+ FLASK", new V2(0.5, 0), new V2(330, 150), new V2(290, 120), false, () => this.ExtraFlask(), 34);
    this.undoButton.setAccent(Violet);
    this.hintButton.setAccent(Pal.Warn);
    this.flaskButton.setAccent(Pal.Cyan);
  }

  // ------------------------------------------------------------------ layout

  private Layout() {
    const n = this.lab!.Count;
    // Pick the row count that lets the flasks appear largest on this screen.
    let bestRows = 1;
    let bestSide = Number.MAX_VALUE;
    for (let rows = 1; rows <= 3; rows++) {
      const per = Math.ceil(n / rows);
      if (rows > 1 && per < 3) break;
      const size = ElixirLabGame.NeedFor(per, rows);
      const side = ElixirLabGame.FitShortSide(size, TopBand, BottomBand);
      if (side < bestSide - 0.01) {
        bestSide = side;
        bestRows = rows;
      }
    }
    const perRow = Math.ceil(n / bestRows);
    this.need = ElixirLabGame.NeedFor(perRow, bestRows);
    for (let i = 0; i < this.views.length; i++) {
      const v = this.views[i];
      const on = i < n;
      v.Root.gameObject.setActive(on);
      if (!on) continue;
      const row = Math.trunc(i / perRow), col = i % perRow;
      const inRow = Math.min(perRow, n - row * perRow);
      const x = (col - (inRow - 1) * 0.5) * SpacingX;
      const y = ((bestRows - 1) * 0.5 - row) * RowGap - 0.2;
      v.Slot = new V2(x, y);
    }
    this.CenterCamera();
  }

  private static NeedFor(perRow: number, rows: number) { return new V2(perRow * SpacingX + 0.4, rows * RowGap - 0.1); }

  private CenterCamera() {
    const r = this.PlayRect(TopBand, BottomBand, 0);
    this.Fx.CameraTarget = r.center.neg();
  }

  protected OnLayoutChanged() { this.CenterCamera(); }

  // ------------------------------------------------------------------ lifecycle

  private Load(next: Lab) {
    this.lab = next;
    this.pours = [];
    this.history = [];
    this.selected = this.hintFrom = this.hintTo = -1;
    this.stream.gameObject.setActive(false);
    for (const v of this.views) {
      v.Busy = false;
      v.LiftT = v.Shake = v.Pop = 0;
      v.CorkT = -1;
      v.Corked = false;
    }
    for (let i = 0; i < next.Count; i++) this.views[i].Corked = next.IsComplete(i);
    this.Layout();
  }

  protected OnEnterTitle() {
    this.NewDemo();
  }

  private NewDemo() {
    const demoLevel = 7 + Random.rangeInt(0, 30);
    const demo = Generator.Build(demoLevel);
    this.Load(demo.lab);
    this.demoPlan = [...demo.solution];
    this.demoStep = 0;
    this.demoTimer = 1.2;
  }

  protected BeginRun() {
    this.level = this.CurrentLevel;
    this.Load(Generator.Build(this.level).lab);
    this.moves = this.undosUsed = this.hintsUsed = 0;
    this.undosLeft = 3;
    this.hintsLeft = this.level <= 3 ? 3 : 2;
    this.flaskAdded = this.ended = this.undoAdUsed = this.stuckShown = false;
    this.endTimer = -1;
    this.idle = 0;
    const mystery = Generator.ForLevel(this.level).Mystery;
    this.UI.Announce(mystery ? "MYSTERY BREW" : "LEVEL " + this.level, mystery ? Violet : Gold, 1.3);
    if (this.level === 1) this.UI.Hint("Tap a flask to lift it, then tap another flask to pour.");
    else if (this.level === 2) this.UI.Hint("Liquid can only land on the same colour, or in an empty flask.");
    else if (mystery && this.Data.get("seenMystery") === 0) {
      this.UI.Hint("Mystery brew! Hidden layers reveal themselves when you uncover them.");
      this.Data.set("seenMystery", 1);
    }
    Sfx.setIntensity(0.1);
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Animate(dt);
    const lab = this.lab!;
    if (this.State !== Phase.Title || this.pours.length > 0) return;
    this.demoTimer -= dt;
    if (this.demoTimer > 0) return;
    if (this.demoStep >= this.demoPlan.length || lab.Solved()) {
      this.NewDemo();
      return;
    }
    const [a, b] = this.demoPlan[this.demoStep++];
    if (!lab.CanPour(a, b)) {
      this.NewDemo();
      return;
    }
    this.StartPour(a, b, true);
    this.demoTimer = 0.55;
  }

  protected TickRun(dt: number) {
    this.Animate(dt);
    this.UpdateHud();
    const lab = this.lab!;
    if (this.ended) {
      if (this.endTimer > 0 && (this.endTimer -= dt) <= 0) this.CompleteLevel();
      return;
    }
    this.HandleInput();

    this.idle += dt;
    if (this.level <= 2 && this.idle > 4 && this.hintFrom < 0 && this.pours.length === 0 && this.selected < 0) this.ShowHint(true);

    if (this.pours.length > 0) return;
    if (lab.Solved()) {
      this.ended = true;
      this.endTimer = 0.7;
      this.UI.Hint(null);
      return;
    }
    if (!lab.HasMove()) {
      if (!this.stuckShown) {
        this.stuckShown = true;
        Sfx.play(Snd.Warn);
        this.UI.Hint(this.CanRecover ? "No moves left! Undo, or add an extra flask." : "No moves left!");
      }
      if (!this.CanRecover) this.OutOfMoves();
    }
  }

  private HandleInput() {
    if (!this.Controls.tapped) return;
    const lab = this.lab!;
    this.idle = 0;
    const i = this.FlaskAt(this.ScreenToWorld(this.Controls.tapScreen));
    if (i < 0) {
      this.Deselect();
      return;
    }
    if (this.selected < 0 || this.selected === i) {
      if (this.selected === i) {
        this.Deselect();
        return;
      }
      this.TrySelect(i);
      return;
    }
    if (this.views[i].Busy) return;
    if (lab.CanPour(this.selected, i)) {
      this.moves++;
      this.StartPour(this.selected, i, false);
      return;
    }
    // Not a valid target: shake it and put the lifted flask back down.
    this.views[i].Shake = 1;
    Sfx.play(Snd.Deny, 0.5);
    this.selected = -1;
  }

  private TrySelect(i: number) {
    const lab = this.lab!;
    if (this.views[i].Busy || lab.F[i].length === 0 || lab.IsComplete(i)) {
      this.views[i].Shake = 0.6;
      Sfx.play(Snd.Deny, 0.4);
      return;
    }
    this.selected = i;
    Sfx.play(Snd.Pickup, 0.6, 0.9 + 0.05 * lab.F[i].length);
  }

  private Deselect() {
    if (this.selected >= 0) Sfx.play(Snd.Click, 0.4, 0.8);
    this.selected = -1;
  }

  private FlaskAt(p: V2) {
    for (let i = 0; i < this.lab!.Count; i++) {
      const d = p.sub(this.views[i].Slot);
      if (Math.abs(d.x) < SpacingX * 0.5 && d.y > BaseY - OuterHalf - 0.35 && d.y < MouthY + Lift + 0.4) return i;
    }
    return -1;
  }

  private StartPour(a: number, b: number, quiet: boolean) {
    const p = this.lab!.Apply(a, b);
    if (!quiet) this.history.push(p);
    this.pours.push(new PourAnim(p));
    this.views[a].Busy = this.views[b].Busy = true;
    this.selected = -1;
    this.hintFrom = this.hintTo = -1;
    this.stuckShown = false;
    if (!quiet) this.UI.Hint(null);
    Sfx.playClip(this.pourClip, quiet ? 0.25 : 0.7, Random.range(0.92, 1.08));
  }

  // ------------------------------------------------------------------ animation

  private Animate(dt: number) {
    const lab = this.lab;
    if (!lab) return;
    const time = Time.time;
    for (let k = this.pours.length - 1; k >= 0; k--) {
      const pa = this.pours[k];
      pa.T += dt / PourTime;
      if (!pa.Landed && pa.T >= 0.62) {
        pa.Landed = true;
        this.OnPourLanded(pa.P);
      }
      if (pa.T >= 1) {
        this.views[pa.P.From].Busy = false;
        this.views[pa.P.To].Busy = false;
        this.pours.splice(k, 1);
      }
    }

    let streaming = false;
    for (let i = 0; i < lab.Count; i++) {
      const v = this.views[i];
      v.LiftT = Mathf.moveTowards(v.LiftT, i === this.selected ? 1 : 0, dt * 6);
      v.Shake = Mathf.moveTowards(v.Shake, 0, dt * 3);
      v.Pop = Mathf.moveTowards(v.Pop, 0, dt * 3);

      let pos = v.Slot.add(new V2(Math.sin(time * 55) * 0.07 * v.Shake, Lift * Ease.outCubic(v.LiftT)));
      let angle = 0;
      let fill = 1; // progress of the stream for a pour involving this flask
      let asSrc: PourAnim | null = null, asDst: PourAnim | null = null;
      for (const pa of this.pours) {
        if (pa.P.From === i) asSrc = pa;
        if (pa.P.To === i) asDst = pa;
      }
      if (asSrc) {
        const dst = this.views[asSrc.P.To];
        const side = dst.Slot.x >= v.Slot.x ? 1 : -1;
        const tilt = -side * 72;
        const mouthLocal = ElixirLabGame.Rotate(new V2(0, MouthY), tilt);
        const target = dst.Slot.add(new V2(-side * 0.1, MouthY + 0.55)).sub(mouthLocal);
        const t = asSrc.T;
        const k = t < 0.3 ? Ease.inOutCubic(t / 0.3) : t < 0.75 ? 1 : 1 - Ease.inOutCubic((t - 0.75) / 0.25);
        pos = V2.lerp(v.Slot, target, k);
        angle = tilt * k;
        fill = Mathf.clamp01((t - 0.3) / 0.36);
        if (t > 0.28 && t < 0.72) {
          streaming = true;
          const mouth = pos.add(ElixirLabGame.Rotate(new V2(0, MouthY), angle));
          const surface = BaseY + this.LiquidHeight(asSrc.P.To, Mathf.clamp01((t - 0.3) / 0.36));
          const bottom = dst.Slot.add(new V2(0, surface));
          const col = Potions[asSrc.P.Color];
          this.stream.startColor = col;
          this.stream.endColor = col;
          const w = 0.13 * Math.sin(Mathf.clamp01((t - 0.28) / 0.44) * Math.PI);
          this.stream.widthMultiplier = Math.max(0.02, w);
          this.stream.positionCount = 3;
          this.stream.setPosition(0, mouth);
          this.stream.setPosition(1, new V2(Mathf.lerp(mouth.x, bottom.x, 0.8), Mathf.lerp(mouth.y, bottom.y, 0.35)));
          this.stream.setPosition(2, bottom);
        }
        ElixirLabGame.SetOrders(v, 20);
      } else ElixirLabGame.SetOrders(v, i === this.selected ? 10 : 0);
      if (asDst) fill = Mathf.clamp01((asDst.T - 0.3) / 0.36);

      const s = 1 + 0.06 * Math.sin(v.Pop * Math.PI);
      v.Root.localPosition = new V3(pos.x, pos.y, 0);
      v.Root.localRotation = Quaternion.euler(0, 0, angle);
      v.Root.localScale = new V3(s, s, 1);

      this.DrawLiquid(i, v, asSrc ? asSrc.P : null, asDst ? asDst.P : null, fill);

      // Selection and hint glows.
      let glow = Color.clear;
      if (i === this.selected) glow = Gold.withAlpha(0.35);
      if (this.State === Phase.Playing && (i === this.hintFrom || i === this.hintTo)) {
        const phase = i === this.hintFrom ? 0 : Math.PI;
        glow = Pal.Warn.withAlpha(0.25 + 0.25 * Math.sin(time * 6 + phase));
      }
      v.Select.color = glow;
      v.Select.transform.localPosition = new V3(0, (BaseY + MouthY) * 0.5, 0);

      // Cork.
      if (v.Corked && lab.IsComplete(i)) {
        if (v.CorkT < 0) v.CorkT = 1;
        v.CorkT = Mathf.moveTowards(v.CorkT, 0, dt * 4);
        v.Cork.gameObject.setActive(true);
        const drop = Ease.outBack(1 - v.CorkT);
        v.Cork.transform.localPosition = new V3(0, MouthY + 0.1 + (1 - drop) * 0.9, 0);
      } else {
        v.Corked = false;
        v.CorkT = -1;
        v.Cork.gameObject.setActive(false);
      }
    }
    this.stream.gameObject.setActive(streaming);
  }

  private static Rotate(v: V2, degrees: number) {
    const a = degrees * Mathf.Deg2Rad, c = Math.cos(a), s = Math.sin(a);
    return new V2(v.x * c - v.y * s, v.x * s + v.y * c);
  }

  /** Displayed liquid height (local units above BaseY) of a flask receiving a pour. */
  private LiquidHeight(i: number, fill: number) {
    let h = this.lab!.F[i].length * LayerH;
    for (const pa of this.pours) if (pa.P.To === i) h -= pa.P.Amount * LayerH * (1 - fill);
    return Math.max(0, h);
  }

  private DrawLiquid(i: number, v: FlaskView, asSrc: Pour | null, asDst: Pour | null, fill: number) {
    const lab = this.lab!;
    const display = this.display;
    display.length = 0;
    const f = lab.F[i];
    const hidden = lab.Hidden[i];
    for (let k = 0; k < f.length; k++) {
      let frac = 1;
      if (asDst && k >= f.length - asDst.Amount) frac = fill;
      display.push({ c: Potions[f[k]], hidden: hidden[k], frac });
    }
    if (asSrc)
      for (let k = 0; k < asSrc.Amount; k++) display.push({ c: Potions[asSrc.Color], hidden: false, frac: 1 - fill });

    let y = BaseY;
    let top = Color.clear;
    for (let k = 0; k < Lab.Cap; k++) {
      const layer = v.Layers[k];
      const mark = v.Marks[k];
      if (k >= display.length || display[k].frac <= 0.001) {
        layer.gameObject.setActive(false);
        mark.gameObject.setActive(false);
        continue;
      }
      const { c, hidden: isHidden, frac } = display[k];
      const h = LayerH * frac;
      const col = isHidden ? MysteryColor : c;
      layer.gameObject.setActive(true);
      layer.color = col;
      layer.transform.localPosition = new V3(0, y + h * 0.5, 0);
      layer.transform.localScale = new V3(InnerW, h + 0.002, 1);
      mark.gameObject.setActive(isHidden);
      if (isHidden) mark.transform.localPosition = new V3(0, y + h * 0.5, 0);
      y += h;
      top = col;
    }

    const any = display.length > 0 && display[0].frac > 0.001;
    v.BottomCap.gameObject.setActive(any);
    if (any) {
      const c0 = display[0].hidden ? MysteryColor : display[0].c;
      v.BottomCap.color = c0.withAlpha(Mathf.clamp01(display[0].frac * 4));
    }
    v.Surface.gameObject.setActive(any);
    if (any) {
      v.Surface.color = Color.lerp(top, Color.white, 0.5).withAlpha(0.9);
      v.Surface.transform.localPosition = new V3(0, y - 0.025, 0);
      v.Surface.transform.localScale = new V3(InnerW, 0.05, 1);
    }
    v.Aura.color = any ? top.withAlpha(lab.IsComplete(i) ? 0.32 : 0.14) : Color.clear;
  }

  private OnPourLanded(p: Pour) {
    const lab = this.lab!;
    const dst = this.views[p.To];
    dst.Pop = 1;
    const quiet = this.State !== Phase.Playing;
    if (lab.IsComplete(p.To) && !dst.Corked) {
      dst.Corked = true;
      const mouth = dst.Slot.add(new V2(0, MouthY));
      this.Fx.burst(mouth, Potions[p.Color], quiet ? 6 : 18, 4, 0.2, 0.6);
      if (!quiet) {
        this.Fx.ring(mouth, Potions[p.Color], 0.3, 2.2, 0.45);
        this.Fx.kick(0.6);
        Fx.haptic();
        Sfx.playClip(this.corkClip, 0.8);
        const done = lab.CompleteCount();
        Sfx.play(Snd.Coin, 0.6, 1 + done * 0.06);
        Sfx.setIntensity(Mathf.clamp01(done / Math.max(1, lab.Colors)) * 0.7);
        const praise = ["BREWED!", "PURE!", "PERFECT!", "SUBLIME!", "MAGICAL!"];
        this.UI.Float(mouth.add(V2.up.mul(0.5)), praise[Random.rangeInt(0, praise.length)], Potions[p.Color], 0.9);
      }
    }
    if (p.RevealedBelow && !quiet) {
      const src = this.views[p.From];
      this.Fx.burst(src.Slot.add(new V2(0, BaseY + lab.F[p.From].length * LayerH)), Violet, 10, 2.5, 0.15, 0.4);
      Sfx.playClip(this.revealClip, 0.7);
    }
  }

  // ------------------------------------------------------------------ helpers (undo / hint / flask)

  private get CanUndo() { return this.undosLeft > 0 && this.history.length > 0; }
  private get CanAddFlask() { return !this.flaskAdded && this.lab !== null && this.lab.Count < MaxFlasks; }

  /** True while some helper can still get the player out of a dead end. */
  private get CanRecover() {
    return this.CanUndo
      || (this.undosLeft <= 0 && !this.undoAdUsed && this.history.length > 0 && AdService.rewardedAvailable)
      || (this.CanAddFlask && (!AdService.active || AdService.rewardedAvailable));
  }

  private Undo() {
    if (this.State !== Phase.Playing || this.ended || this.pours.length > 0) return;
    if (this.undosLeft <= 0) {
      if (!this.undoAdUsed && AdService.rewardedAvailable)
        AdService.showRewarded((earned) => {
          if (!earned) return;
          this.undoAdUsed = true;
          this.undosLeft += 5;
          Sfx.play(Snd.PowerUp);
        });
      return;
    }
    if (this.history.length === 0) {
      Sfx.play(Snd.Deny, 0.5);
      return;
    }
    const p = this.history.pop()!;
    this.lab!.Undo(p);
    this.undosLeft--;
    this.undosUsed++;
    this.moves = Math.max(0, this.moves - 1);
    this.selected = this.hintFrom = this.hintTo = -1;
    this.stuckShown = false;
    this.UI.Hint(null);
    this.views[p.From].Pop = this.views[p.To].Pop = 1;
    Sfx.play(Snd.Whoosh, 0.6, 1.3);
  }

  private Hint() {
    if (this.State !== Phase.Playing || this.ended || this.pours.length > 0) return;
    if (this.hintsLeft <= 0) {
      if (AdService.rewardedAvailable)
        AdService.showRewarded((earned) => {
          if (!earned) return;
          this.hintsLeft++;
          this.ShowHint(false);
        });
      return;
    }
    this.ShowHint(false);
  }

  private ShowHint(free: boolean) {
    const plan = Solver.Solve(this.lab!, 60000);
    if (!plan || plan.length === 0) {
      this.UI.Hint("This brew can't be finished from here. Undo a few moves or add a flask.");
      Sfx.play(Snd.Deny, 0.6);
      return;
    }
    if (!free) {
      this.hintsLeft--;
      this.hintsUsed++;
    }
    this.hintFrom = plan[0][0];
    this.hintTo = plan[0][1];
    this.selected = -1;
    Sfx.play(Snd.Confirm, 0.6);
    if (free) this.UI.Hint("Try pouring the glowing flask into the other glowing flask.");
  }

  private ExtraFlask() {
    if (this.State !== Phase.Playing || this.ended || !this.CanAddFlask) return;
    if (AdService.active) {
      if (!AdService.rewardedAvailable) return;
      AdService.showRewarded((earned) => {
        if (earned) this.AddFlaskNow();
      });
      return;
    }
    this.AddFlaskNow(); // no ads in this build: one free extra flask per level
  }

  private AddFlaskNow() {
    if (!this.CanAddFlask) return;
    const lab = this.lab!;
    this.flaskAdded = true;
    lab.AddFlask();
    this.Layout();
    this.stuckShown = false;
    this.UI.Hint(null);
    const v = this.views[lab.Count - 1];
    v.Pop = 1;
    this.Fx.burst(v.Slot, Pal.Cyan, 16, 3, 0.18, 0.5);
    Sfx.play(Snd.PowerUp, 0.7);
  }

  // ------------------------------------------------------------------ HUD / end

  private UpdateHud() {
    ElixirLabGame.Set(this.levelText, "LEVEL " + this.level);
    const spec = Generator.ForLevel(this.level);
    ElixirLabGame.Set(this.subText, (spec.Mystery ? "MYSTERY BREW   ·   " : "") + "MOVES " + this.moves);

    const busy = this.pours.length > 0 || this.ended;
    if (this.undosLeft > 0) ElixirLabGame.SetButton(this.undoButton, "UNDO  " + this.undosLeft, this.history.length > 0 && !busy);
    else if (!this.undoAdUsed && AdService.rewardedAvailable) ElixirLabGame.SetButton(this.undoButton, "+5 UNDO (AD)", !busy);
    else ElixirLabGame.SetButton(this.undoButton, "UNDO  0", false);

    if (this.hintsLeft > 0) ElixirLabGame.SetButton(this.hintButton, "HINT  " + this.hintsLeft, !busy);
    else if (AdService.rewardedAvailable) ElixirLabGame.SetButton(this.hintButton, "HINT (AD)", !busy);
    else ElixirLabGame.SetButton(this.hintButton, "HINT  0", false);

    if (!this.CanAddFlask) ElixirLabGame.SetButton(this.flaskButton, "+ FLASK", false);
    else if (AdService.active) ElixirLabGame.SetButton(this.flaskButton, "+ FLASK (AD)", AdService.rewardedAvailable && !busy);
    else ElixirLabGame.SetButton(this.flaskButton, "+ FLASK", !busy);
  }

  private static Set(t: Text | null, s: string) {
    if (t && t.text !== s) t.text = s;
  }

  private static SetButton(b: ArcadeButton, label: string, enabled: boolean) {
    ElixirLabGame.Set(b.label, label);
    if (b.interactable !== enabled) b.interactable = enabled;
  }

  private CompleteLevel() {
    const lab = this.lab!, level = this.level;
    const assists = this.undosUsed + this.hintsUsed + (this.flaskAdded ? 2 : 0);
    const stars = assists === 0 ? 3 : assists <= 3 ? 2 : 1;
    const prev = this.Data.get("s" + level);
    if (stars > prev) {
      this.Data.set("s" + level, stars);
      this.Data.add("stars", stars - prev);
    }
    this.Data.set("level", level + 1);
    this.Data.max("bestLevel", level + 1);
    const rankUp = RankFor(level + 1) !== RankFor(level);

    for (let i = 0; i < lab.Count; i++)
      if (lab.F[i].length > 0)
        this.Fx.burst(this.views[i].Slot.add(new V2(0, MouthY)), Potions[lab.F[i][0]], 14, 6, 0.24, 0.9);
    this.Fx.kick(1.2, 0.2);
    this.Fx.shake(0.15);
    Fx.haptic(true);
    Sfx.play(Snd.Win);
    this.Finish(new Result({
      Headline: rankUp ? "PROMOTED: " + RankFor(level + 1) : "BREW COMPLETE!",
      HeadlineColor: Gold,
      Stars: stars,
      Value: "LEVEL " + level,
      BestLine: `LEVEL ${level}   ·   ${this.moves} MOVES`,
      Stats: [
        ["LEVEL", String(level)],
        ["MOVES", String(this.moves)],
        ["HELPERS USED", assists === 0 ? "NONE" : String(this.undosUsed + this.hintsUsed + (this.flaskAdded ? 1 : 0))],
        ["TOTAL STARS", String(this.Data.get("stars"))],
      ],
      Primary: "NEXT LEVEL",
      Victory: true,
    }));
  }

  private OutOfMoves() {
    if (this.ended) return;
    this.ended = true;
    this.endTimer = -1;
    Sfx.play(Snd.Lose);
    this.Finish(new Result({
      Headline: "THE BREW IS STUCK",
      HeadlineColor: Pal.Danger,
      Value: "LEVEL " + this.level,
      BestLine: "Every flask is blocked.",
      Stats: [
        ["LEVEL", String(this.level)],
        ["MOVES", String(this.moves)],
      ],
      Primary: "RETRY",
      Reward: this.CanAddFlask ? () => {
        this.ended = false;
        this.Revive();
        this.AddFlaskNow();
      } : null,
      RewardLabel: "ADD A FLASK (WATCH AD)",
    }));
  }
}
