import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, CasualUI, Color, Fx, GameInfo, GameObject,
  howTo, Image, LevelPath, Mathf, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer, Text, Time,
  TouchScheme, UI as UIRoot, UIKit, UINode, V2, V3,
} from "../../kit";

/**
 * LINK LINES: connect each pair of matching coloured dots with a pipe. Pipes can't cross, and to solve a level
 * every square of the board must be filled. Boards grow from 5×5 to 9×9. Solve a level in the fewest moves for
 * three stars. HINT draws one correct pipe (three free, more with a rewarded ad). Puzzles are generated from a
 * random full-board path, so every level always has a solution. Cells are UI elements so pipes stay sharp.
 * (Port of LinkLinesGame.cs.)
 */

const TopBand = 300, BottomBand = 200;

const Ink = Pal.hex(0x1b2140), BoardColor = Pal.hex(0x1e2449), SlotColor = Pal.hex(0x2a3263), Gold = Pal.hex(0xffc93c), Teal = Pal.hex(0x2fd4c0);
const Colors = [
  Pal.hex(0xff4d5e), Pal.hex(0x3d8bff), Pal.hex(0x35d07f), Pal.hex(0xffd23f), Pal.hex(0xff8a2a), Pal.hex(0x2fe0e8),
  Pal.hex(0xc35cff), Pal.hex(0xff6fb5), Pal.hex(0xa8e05a), Pal.hex(0xc08a5a), Pal.hex(0xf2f2f7), Pal.hex(0x7c7cff),
];

// ------------------------------------------------------------------ art

const SlotSprite = () => CasualArt.make("ll-slot", 96, 96, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.92, 0.92), 0.24);
  return new Color(1, 1, 1, CasualArt.fill(d, 2 / 96));
});

const PanelSprite = () => CasualArt.make("ll-panel", 96, 96, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.96, 0.96), 0.18);
  return new Color(1, 1, 1, CasualArt.fill(d, 2 / 96));
}, 24, 100);

const BarH = () => CasualArt.make("ll-barh", 8, 32, (p) => {
  const t = (p.y + 4) / 8;
  let v = Mathf.lerp(0.78, 1, CasualArt.smooth(0.1, 0.75, t));
  v = Mathf.lerp(v, 1.15, CasualArt.smooth(0.7, 0.82, t) * (1 - CasualArt.smooth(0.84, 0.95, t)));
  return new Color(Math.min(1, v), Math.min(1, v), Math.min(1, v), 1);
});

const BarV = () => CasualArt.make("ll-barv", 32, 8, (p) => {
  const t = (p.x + 1) / 2;
  let v = Mathf.lerp(1, 0.78, CasualArt.smooth(0.25, 0.9, t));
  v = Mathf.lerp(v, 1.15, CasualArt.smooth(0.12, 0.22, t) * (1 - CasualArt.smooth(0.24, 0.34, t)));
  return new Color(Math.min(1, v), Math.min(1, v), Math.min(1, v), 1);
});

const Joint = () => CasualArt.make("ll-joint", 64, 64, (p) => {
  const d = p.magnitude - 0.96;
  const v = Mathf.lerp(0.78, 1, CasualArt.smooth(-0.8, 0.5, p.y));
  return new Color(v, v, v, CasualArt.fill(d, 2 / 64));
});

/** RectTransform.TransformPoint for a local point of `node` → Unity screen point (local stand-in, kit has none). */
function localToScreen(node: UINode, local: V2) {
  const r = node.canvasRect(), pv = node.pivot;
  const k = Screen.dpr * UIRoot.cssScale;
  return new V2((local.x + r.x + pv.x * r.w) * k, (local.y + r.y + pv.y * r.h) * k);
}

function sameAs(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class LinkLinesGame extends ArcadeGame {
  private world!: GameObject;
  private bgCover!: SpriteRenderer;
  private board!: UINode; private panel!: UINode; private gridRoot!: UINode;
  private tintLayer!: UINode; private pipeLayer!: UINode; private dotLayer!: UINode;
  private cursor!: Image;
  private readonly pointer = new TapPointer();
  private fx!: CasualFx;

  private n = 0; private k = 0; private level = 0;
  private sol: number[][] | null = null;
  private paths: number[][] = [];
  private snap: number[][] = [];
  private endA: number[] = []; private endB: number[] = []; private owner: number[] | null = null; private endColor: number[] = [];
  private tints: Image[] | null = null; private armR: Image[] = []; private armD: Image[] = []; private joints: Image[] = [];
  private dots: (Image | null)[] = [];
  private cs = 0; private size = 0; private lastW = 0; private lastH = 0; private winTimer = 0; private attract = 0;
  private moves = 0; private lastMoved = 0; private hintsUsed = 0;
  private built = false; private won = false;

  private dragColor = -1;
  private drag: number[] = [];
  private before: number[] = [];

  private levelText: Text | null = null; private infoText!: Text;
  private resetButton!: ArcadeButton; private hintButton!: ArcadeButton;
  private path!: LevelPath;
  private tickClip!: AudioClip; private linkClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "linklines",
      Title: "LINK LINES",
      Tagline: "CONNECT THE DOTS. FILL THE BOARD.",
      Accent: Teal,
      Accent2: Gold,
      BgTop: Pal.hex(0x2a2f66),
      BgBottom: Pal.hex(0x12152e),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 84, rootHz: 110, degrees: [0, 5, 3, 4], seed: 61, energy: 0.22, major: true },
      Reminders: [
        "A new puzzle is waiting|Link every pair and fill the board.",
        "Keep your brain sharp|Solve one Link Lines level today.",
        "Go for three stars|Solve a board in the fewest moves.",
      ],
      HowTo: [
        howTo(Art.Disc, Colors[0], "DRAG from a dot to draw a pipe to the other dot of the SAME colour."),
        howTo(Art.Diamond, Pal.Danger, "Pipes can't cross. Drawing over another pipe cuts it."),
        howTo(Art.Square, Teal, "Fill EVERY square of the board to solve the level."),
        howTo(Art.Star, Gold, "Use as few moves as possible for 3 stars."),
        howTo(Art.Ring, Colors[3], "Stuck? HINT draws one correct pipe."),
      ],
      Tips: [
        "Pairs near the edges usually run along the edges.",
        "Connect the shortest, most obvious pairs first.",
        "An empty square in a corner needs a pipe to bend into it.",
        "Long pipes often wind around the outside of the board.",
        "Finish one colour before starting the next to save moves.",
      ],
    });
  }

  protected get ShortSide() { return 9; }
  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }
  private get Hints() { return this.Data.get("hint", 3); }
  private set Hints(v: number) { this.Data.set("hint", Math.max(0, v)); }
  protected BestLine() { return `LEVEL ${this.CurrentLevel}   ·   ${this.Data.get("stars")} STARS`; }
  protected StatsLine() { return `${this.Data.get("solved")} SOLVED   ·   ${this.Data.get("perfect")} PERFECT`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("LinkWorld", this.gameObject);
    CasualLook.calm(this, 1.3, 0.12);
    this.bgCover = CasualLook.cover(this.world, CasualArt.gradient(Pal.hex(0x2a2f66), Pal.hex(0x12152e), new Color(0.45, 0.6, 1, 0.25)), -910);
    this.fx = CasualFx.create(this.world, 60, 140);

    this.board = UIKit.node("Board", this.UI.Hud).stretch();
    this.board.setAsFirstSibling();
    this.panel = UIKit.img(this.board, "Panel", PanelSprite(), BoardColor).rectTransform;
    this.gridRoot = UIKit.node("Grid", this.board);
    this.tintLayer = UIKit.node("Tints", this.gridRoot).stretch();
    this.pipeLayer = UIKit.node("Pipes", this.gridRoot).stretch();
    this.dotLayer = UIKit.node("Dots", this.gridRoot).stretch();
    this.cursor = UIKit.img(this.gridRoot, "Cursor", Art.UiCircle, new Color(1, 1, 1, 0));
    this.cursor.raycastTarget = false;

    const hud = this.UI.Hud;
    this.levelText = UIKit.at(UIKit.label(hud, "LEVEL 1", 58, Color.white), new V2(0.5, 1), new V2(0, -110), new V2(700, 80));
    UIKit.glow(this.levelText, Ink, 4);
    this.infoText = UIKit.at(UIKit.label(hud, "", 28, new Color(0.8, 0.85, 1, 1)), new V2(0.5, 1), new V2(0, -180), new V2(900, 44));
    this.resetButton = UIKit.buttonAt(hud, "RESET", new V2(0.5, 0), new V2(-190, 100), new V2(320, 120), false, () => this.OnReset(), 30);
    this.hintButton = UIKit.buttonAt(hud, "HINT", new V2(0.5, 0), new V2(190, 100), new V2(320, 120), false, () => this.OnHint(), 30);
    this.resetButton.setAccent(Colors[1]);
    this.hintButton.setAccent(Teal);

    this.path = new LevelPath(this.UI, Teal, Colors[2], Ink);

    this.tickClip = Sfx.make("ll-tick", 0.07, (t) => Sfx.sinP(Sfx.glide(t, 700, 620, 0.05)) * Sfx.env(t, 0.002, 0.05) * 0.2);
    this.linkClip = Sfx.make("ll-link", 0.35, (t) => (Sfx.sinP(784 * t) * Sfx.env(t, 0.002, 0.12) + Sfx.sinP(1175 * t) * Sfx.env(t - 0.07, 0.002, 0.25)) * 0.22);
    this.built = true;
    this.Setup(this.CurrentLevel);
  }

  // ------------------------------------------------------------------ puzzle

  private static SizeFor(lvl: number) { return lvl <= 4 ? 5 : lvl <= 12 ? 6 : lvl <= 24 ? 7 : lvl <= 40 ? 8 : 9; }

  private static ColorsFor(lvl: number, n: number) {
    let c = n;
    if (lvl % 3 === 0) c++;
    if (n >= 8 && lvl % 2 === 0) c++;
    return Mathf.clamp(c, 3, Math.min(Colors.length, Math.trunc((n * n) / 3)));
  }

  private static HamiltonPath(n: number, r: SysRandom) {
    const p: number[] = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) p.push(y * n + (y % 2 === 0 ? x : n - 1 - x));
    if (r.next(2) === 0) for (let i = 0; i < p.length; i++) { const x = p[i] % n, y = Math.trunc(p[i] / n); p[i] = x * n + y; }
    const nb: number[] = [];
    const iters = n * n * 60;
    for (let it = 0; it < iters; it++) {
      if (r.next(2) === 0) p.reverse();
      const head = p[0], hx = head % n, hy = Math.trunc(head / n);
      nb.length = 0;
      if (hx > 0) nb.push(head - 1);
      if (hx < n - 1) nb.push(head + 1);
      if (hy > 0) nb.push(head - n);
      if (hy < n - 1) nb.push(head + n);
      const pick = nb[r.next(nb.length)];
      const idx = p.indexOf(pick);
      if (idx <= 1) continue;
      // List.Reverse(0, idx)
      for (let a = 0, b = idx - 1; a < b; a++, b--) { const t = p[a]; p[a] = p[b]; p[b] = t; }
    }
    return p;
  }

  private Generate(lvl: number) {
    this.n = LinkLinesGame.SizeFor(lvl);
    this.k = LinkLinesGame.ColorsFor(lvl, this.n);
    const n = this.n, k = this.k;
    const r = new SysRandom(lvl * 7919 + 1301);
    let ham: number[] = [];
    let len: number[] = [];
    for (let attemptOuter = 0; attemptOuter < 20; attemptOuter++) {
      ham = LinkLinesGame.HamiltonPath(n, r);
      const total = n * n;
      len = new Array(k).fill(0);
      const w: number[] = new Array(k).fill(0);
      let sum = 0;
      for (let i = 0; i < k; i++) { w[i] = 0.25 + r.nextDouble() * 1.4; sum += w[i]; }
      const extra = total - 3 * k;
      let given = 0;
      for (let i = 0; i < k; i++) { len[i] = 3 + Math.floor((extra * w[i]) / sum); given += len[i]; }
      while (given < total) { len[r.next(k)]++; given++; }
      // reject boards where too many pairs are trivially next to each other
      let trivial = 0, at = 0;
      for (let i = 0; i < k; i++) {
        const a = ham[at], b = ham[at + len[i] - 1];
        if (this.Adjacent(a, b)) trivial++;
        at += len[i];
      }
      if (trivial <= 1) break;
    }
    const sol: number[][] = new Array(k);
    this.endA = new Array(k).fill(0);
    this.endB = new Array(k).fill(0);
    const order: number[] = [];
    for (let i = 0; i < k; i++) order.push(i);
    for (let i = order.length - 1; i > 0; i--) { const j = r.next(i + 1); const t = order[i]; order[i] = order[j]; order[j] = t; }
    let start = 0;
    for (let i = 0; i < k; i++) {
      const c = order[i];
      sol[c] = ham.slice(start, start + len[i]);
      this.endA[c] = sol[c][0];
      this.endB[c] = sol[c][sol[c].length - 1];
      start += len[i];
    }
    this.sol = sol;
    this.endColor = new Array(n * n).fill(-1);
    for (let c = 0; c < k; c++) { this.endColor[this.endA[c]] = c; this.endColor[this.endB[c]] = c; }
    this.paths = [];
    for (let c = 0; c < k; c++) this.paths.push([]);
    this.owner = new Array(n * n).fill(0);
  }

  private Adjacent(a: number, b: number) {
    const n = this.n;
    const ax = a % n, ay = Math.trunc(a / n), bx = b % n, by = Math.trunc(b / n);
    return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
  }

  private Complete(c: number) {
    const p = this.paths[c];
    if (p.length < 2) return false;
    const a = p[0], b = p[p.length - 1];
    return (a === this.endA[c] && b === this.endB[c]) || (a === this.endB[c] && b === this.endA[c]);
  }

  private CompleteCount() {
    let s = 0;
    for (let c = 0; c < this.k; c++) if (this.Complete(c)) s++;
    return s;
  }

  private Filled() {
    let s = 0;
    for (const o of this.owner!) if (o >= 0) s++;
    return s;
  }

  private RecomputeOwner() {
    const owner = this.owner!;
    owner.fill(-1);
    for (let c = 0; c < this.k; c++) for (const i of this.paths[c]) owner[i] = c;
  }

  // ------------------------------------------------------------------ grid visuals

  private BuildCells() {
    if (this.tints)
      for (const arr of [this.tints, this.armR, this.armD, this.joints, this.dots])
        for (const im of arr) if (im) im.gameObject.destroy();
    const m = this.n * this.n;
    this.tints = new Array(m);
    this.armR = new Array(m);
    this.armD = new Array(m);
    this.joints = new Array(m);
    this.dots = new Array(m).fill(null);
    for (let i = 0; i < m; i++) {
      this.tints[i] = UIKit.img(this.tintLayer, "Slot", SlotSprite(), SlotColor);
      this.armR[i] = UIKit.img(this.pipeLayer, "ArmR", BarH(), Color.white);
      this.armD[i] = UIKit.img(this.pipeLayer, "ArmD", BarV(), Color.white);
      this.joints[i] = UIKit.img(this.pipeLayer, "Joint", Joint(), Color.white);
      if (this.endColor[i] >= 0) this.dots[i] = UIKit.img(this.dotLayer, "Dot", CasualArt.ball(Colors[this.endColor[i]]), Color.white);
      for (const im of [this.tints[i], this.armR[i], this.armD[i], this.joints[i], this.dots[i]]) if (im) im.raycastTarget = false;
    }
    this.cursor.transform.setAsLastSibling();
    this.Layout();
    this.Redraw();
  }

  private CellPos(i: number) {
    const n = this.n;
    return new V2(((i % n) + 0.5) * this.cs - this.size * 0.5, this.size * 0.5 - (Math.trunc(i / n) + 0.5) * this.cs);
  }

  private CellAt(screen: V2) {
    const local = this.gridRoot.screenToLocal(screen);
    const x = Math.floor((local.x + this.size * 0.5) / this.cs), y = Math.floor((this.size * 0.5 - local.y) / this.cs);
    if (x < 0 || x >= this.n || y < 0 || y >= this.n) return -1;
    return y * this.n + x;
  }

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    if (!this.built || !this.tints) return;
    const r = this.board.rect;
    this.lastW = r.width;
    this.lastH = r.height;
    this.size = Math.min(r.width - 70, r.height - TopBand - BottomBand - 40, 1000);
    this.cs = this.size / this.n;
    const cs = this.cs;
    const cy = (BottomBand - TopBand) * 0.5;
    this.panel.place(UIKit.Center, new V2(0, cy), new V2(this.size + 28, this.size + 28));
    this.gridRoot.place(UIKit.Center, new V2(0, cy), new V2(this.size, this.size));
    const w = cs * 0.34;
    for (let i = 0; i < this.tints.length; i++) {
      const c = this.CellPos(i);
      this.tints[i].rectTransform.place(UIKit.Center, c, new V2(cs - 4, cs - 4));
      this.armR[i].rectTransform.place(UIKit.Center, c.add(new V2(cs * 0.5, 0)), new V2(cs, w));
      this.armD[i].rectTransform.place(UIKit.Center, c.sub(new V2(0, cs * 0.5)), new V2(w, cs));
      this.joints[i].rectTransform.place(UIKit.Center, c, new V2(w, w));
      this.dots[i]?.rectTransform.place(UIKit.Center, c, new V2(cs * 0.72, cs * 0.72));
    }
    this.cursor.rectTransform.sizeDelta = new V2(cs * 1.5, cs * 1.5);
  }

  private Redraw() {
    if (!this.tints) return;
    this.RecomputeOwner();
    const owner = this.owner!;
    for (let i = 0; i < this.tints.length; i++) {
      const o = owner[i];
      this.tints[i].color = o >= 0 ? Color.lerp(SlotColor, Colors[o], 0.32) : SlotColor;
      this.armR[i].enabled = this.armD[i].enabled = false;
      this.joints[i].enabled = o >= 0;
      if (o >= 0) this.joints[i].color = Colors[o];
    }
    const n = this.n;
    for (let c = 0; c < this.k; c++) {
      const p = this.paths[c];
      for (let j = 1; j < p.length; j++) {
        const a = p[j - 1], b = p[j];
        const arm = b === a + 1 ? this.armR[a] : a === b + 1 ? this.armR[b] : b === a + n ? this.armD[a] : this.armD[b];
        arm.enabled = true;
        arm.color = Colors[c];
      }
    }
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ lifecycle

  private Setup(lvl: number) {
    this.level = lvl;
    this.Generate(lvl);
    this.dragColor = -1;
    this.moves = this.hintsUsed = 0;
    this.lastMoved = -1;
    this.won = false;
    this.winTimer = 0;
    this.BuildCells();
  }

  protected OnEnterTitle() {
    this.Setup(this.CurrentLevel);
    this.path.refresh(this.Data, this.CurrentLevel);
    this.attract = 0;
  }

  protected BeginRun() {
    this.Setup(this.CurrentLevel);
    this.pointer.reset();
    this.pointer.topBand = 0.1;
    this.UI.Announce(`LEVEL ${this.level}`, Teal, 1.1);
    if (this.Data.get("runs") === 0) this.UI.Hint("Drag from a dot to the dot of the same colour. Fill every square!");
    this.Data.add("runs", 1);
    Sfx.setIntensity(0.1);
    this.Redraw();
  }

  protected TickBackground(dt: number) {
    if (this.State !== Phase.Title || !this.sol) return;
    // attract: the solution draws itself, then fades and starts again
    this.attract += dt;
    const cycle = 6, t = this.attract % cycle;
    const p = Mathf.clamp01(t / 3.6);
    for (let c = 0; c < this.k; c++) {
      const cnt = t > 5.2 ? 0 : Math.ceil(p * this.sol[c].length);
      if (this.paths[c].length !== cnt) this.paths[c] = this.sol[c].slice(0, cnt);
    }
    this.Redraw();
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i];
      if (d) { const s = 1 + 0.06 * Math.sin(Time.time * 3 + i); d.rectTransform.localScale = new V3(s, s, s); }
    }
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    if (Math.abs(this.board.rect.width - this.lastW) > 1 || Math.abs(this.board.rect.height - this.lastH) > 1) this.Layout();
    this.AnimateDots(dt);
    if (this.won) {
      this.winTimer += dt;
      const n = this.n, tints = this.tints!;
      for (let i = 0; i < tints.length; i++) {
        const wave = Mathf.clamp01(this.winTimer * 3 - ((i % n) + Math.trunc(i / n)) * 0.12);
        const s = 1 + Math.sin(wave * Math.PI) * 0.12;
        tints[i].rectTransform.localScale = new V3(s, s, 1);
      }
      if (this.winTimer > 1.5 && this.State === Phase.Playing) this.Win();
      return;
    }
    this.HandleInput();
  }

  private AnimateDots(dt: number) {
    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i];
      if (!d) continue;
      const t = d.rectTransform;
      const target = this.Complete(this.endColor[i]) ? 1.08 : 1;
      const s = Mathf.lerp(t.localScale.x, target, dt * 10);
      t.localScale = new V3(s, s, 1);
    }
  }

  // ------------------------------------------------------------------ input

  private HandleInput() {
    if (this.pointer.down) {
      const cell = this.CellAt(this.pointer.screen);
      if (cell >= 0) this.StartDrag(cell);
    }
    if (this.dragColor >= 0) {
      const local = this.gridRoot.screenToLocal(this.pointer.screen);
      this.cursor.rectTransform.anchoredPosition = local;
      const cc = Colors[this.dragColor];
      this.cursor.color = new Color(cc.r, cc.g, cc.b, 0.3);
      if (this.pointer.held) {
        const cell = this.CellAt(this.pointer.screen);
        if (cell >= 0) this.DragTo(cell);
      }
      if (this.pointer.up || !this.pointer.held) this.EndDrag();
    } else this.cursor.color = new Color(1, 1, 1, 0);
  }

  private StartDrag(cell: number) {
    let c = this.endColor[cell];
    let start: number[];
    if (c >= 0) start = [cell];
    else if (this.owner![cell] >= 0) {
      c = this.owner![cell];
      const p = this.paths[c];
      start = p.slice(0, p.indexOf(cell) + 1);
    } else return;
    this.before = [...this.paths[c]];
    this.snap = [];
    for (let i = 0; i < this.k; i++) this.snap.push([...this.paths[i]]);
    this.snap[c].length = 0;
    this.dragColor = c;
    this.drag = start;
    this.UI.Hint(null);
    this.Apply();
    Sfx.playClip(this.tickClip, 0.4, 0.9);
  }

  private DragTo(target: number) {
    const n = this.n;
    for (let guard = 0; guard < 24; guard++) {
      const last = this.drag[this.drag.length - 1];
      if (last === target) return;
      const lx = last % n, ly = Math.trunc(last / n), tx = target % n, ty = Math.trunc(target / n);
      let next: number;
      if (Math.abs(tx - lx) >= Math.abs(ty - ly)) next = last + (tx > lx ? 1 : -1);
      else next = last + (ty > ly ? n : -n);
      if (!this.Step(next)) return;
    }
  }

  private Step(cell: number) {
    const drag = this.drag;
    const idx = drag.indexOf(cell);
    if (idx >= 0) {
      drag.splice(idx + 1, drag.length - idx - 1);
      this.Apply();
      return true;
    }
    const last = drag[drag.length - 1];
    // a finished pipe can't grow past its second dot
    if (drag.length > 1 && this.endColor[last] === this.dragColor) return false;
    const ec = this.endColor[cell];
    if (ec >= 0 && ec !== this.dragColor) return false;
    if (ec === this.dragColor && cell === drag[0]) return false;
    drag.push(cell);
    this.Apply();
    if (ec === this.dragColor) {
      Sfx.playClip(this.linkClip, 0.7, 0.9 + this.dragColor * 0.04);
      Fx.haptic(false);
      this.fx.sparkle(this.ToWorld(cell), Colors[this.dragColor], 8, 0.5, 0.4);
    } else Sfx.playClip(this.tickClip, 0.35, 0.9 + Math.min(0.6, drag.length * 0.03));
    return true;
  }

  private Apply() {
    this.paths[this.dragColor] = [...this.drag];
    const used = new Set(this.drag);
    for (let c = 0; c < this.k; c++) {
      if (c === this.dragColor) continue;
      const p = [...this.snap[c]];
      const cut = p.findIndex((i) => used.has(i));
      if (cut >= 0) p.splice(cut, p.length - cut);
      this.paths[c] = p;
    }
    this.Redraw();
  }

  private EndDrag() {
    const c = this.dragColor;
    this.dragColor = -1;
    this.cursor.color = new Color(1, 1, 1, 0);
    if (this.paths[c].length <= 1) this.paths[c].length = 0;
    const changed = this.paths[c].length !== this.before.length || !sameAs(this.paths[c], this.before);
    if (changed && c !== this.lastMoved) { this.moves++; this.lastMoved = c; }
    this.Redraw();
    this.CheckWin();
  }

  private CheckWin() {
    if (this.CompleteCount() < this.k) return;
    if (this.Filled() < this.n * this.n) {
      this.UI.Hint("All linked! Now make the pipes fill EVERY square.");
      return;
    }
    this.won = true;
    this.winTimer = 0;
    Sfx.play(Snd.NewBest, 0.7);
    Fx.haptic(true);
    this.fx.confetti(new V2(0, this.ViewSize.y * 0.25), 60, 8, [Colors[0], Colors[1], Colors[2], Colors[3], Gold]);
    this.UI.Announce(this.moves <= this.k ? "PERFECT!" : "SOLVED!", Gold, 1.2);
  }

  private ToWorld(cell: number) {
    return this.ScreenToWorld(localToScreen(this.gridRoot, this.CellPos(cell)));
  }

  // ------------------------------------------------------------------ boosters

  private OnReset() {
    if (this.State !== Phase.Playing || this.won) return;
    for (let c = 0; c < this.k; c++) this.paths[c].length = 0;
    this.lastMoved = -1;
    Sfx.play(Snd.Click, 0.6);
    this.Redraw();
  }

  private OnHint() {
    if (this.State !== Phase.Playing || this.won) return;
    const sol = this.sol!;
    // the first colour whose pipe isn't already the solution
    let target = -1;
    for (let c = 0; c < this.k; c++) {
      const p = this.paths[c];
      const right = this.Complete(c) && (sameAs(p, sol[c]) || sameAs([...p].reverse(), sol[c]));
      if (!right) { target = c; break; }
    }
    if (target < 0) return;
    if (!CasualUI.useOrEarn(() => this.Hints, (v) => (this.Hints = v), this.UI, "+1 HINT")) { this.UpdateHud(); return; }
    this.hintsUsed++;
    this.snap = [];
    for (let i = 0; i < this.k; i++) this.snap.push([...this.paths[i]]);
    this.dragColor = target;
    this.drag = [...sol[target]];
    this.Apply();
    this.dragColor = -1;
    this.lastMoved = target;
    this.moves++;
    Sfx.playClip(this.linkClip, 0.7);
    this.Redraw();
    this.CheckWin();
  }

  private UpdateHud() {
    if (!this.levelText || !this.owner) return;
    const n = this.n;
    CasualUI.setText(this.levelText, `LEVEL ${this.level}   ·   ${n}×${n}`);
    const pct = Mathf.roundToInt((this.Filled() * 100) / (n * n));
    CasualUI.setText(this.infoText, `LINKED ${this.CompleteCount()}/${this.k}   ·   FILLED ${pct}%   ·   MOVES ${this.moves} (BEST ${this.k})`);
    CasualUI.booster(this.hintButton, "HINT", this.Hints, this.State === Phase.Playing && !this.won);
    this.resetButton.interactable = this.State === Phase.Playing && !this.won;
  }

  // ------------------------------------------------------------------ results

  private Win() {
    const k = this.k, moves = this.moves;
    let stars = moves <= k ? 3 : moves <= k + 3 ? 2 : 1;
    if (this.hintsUsed > 0) stars = Math.min(stars, 2);
    const prev = this.Data.get("s" + this.level);
    if (stars > prev) { this.Data.set("s" + this.level, stars); this.Data.add("stars", stars - prev); }
    this.Data.add("solved", 1);
    if (stars === 3) this.Data.add("perfect", 1);
    this.Data.set("level", Math.max(this.CurrentLevel, this.level + 1));
    const gift = this.level % 5 === 0;
    if (gift) this.Hints = this.Hints + 1;
    const lvl = this.level, n = this.n;
    this.Finish(new Result({
      Headline: stars === 3 ? "PERFECT!" : `LEVEL ${lvl} SOLVED!`,
      HeadlineColor: Gold,
      Stars: stars,
      Value: `${moves} MOVES`,
      BestLine: gift ? "GIFT: +1 HINT" : `PERFECT = ${k} MOVES   ·   NEXT: LEVEL ${lvl + 1}`,
      Stats: [["BOARD", `${n}×${n}`], ["MOVES", String(moves)], ["HINTS", String(this.hintsUsed)], ["STARS", String(this.Data.get("stars"))]],
      Primary: "NEXT LEVEL",
      Victory: true,
      Reward: () => { this.Hints = this.Hints + 2; this.UI.Toast("+2 HINTS", 2); },
      RewardLabel: "GET 2 FREE HINTS (WATCH AD)",
    }));
  }
}
