import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, Camera, CasualLook, Color, Ease, Fx, GameInfo, GameObject, howTo, LineRenderer,
  Material, Mathf, Pal, Phase, Quaternion, Random, Result, Sfx, Snd, SpriteRenderer, SysRandom, Text, Time, TouchScheme, UIKit, V2, V3,
} from "../../kit";
import { Knot, KnotGenerator, Planner } from "./Knot";
import { UntwineArt } from "./UntwineArt";

/**
 * UNTWINE — a ring-rotation puzzle. A knot of glowing rings sits on a hexagonal lattice; neighbouring rings are
 * linked. Tap a ring to turn it 60° clockwise. A link opens when either ring's gap faces the other, and a ring
 * with every link open slips free and flies away, which can free its neighbours in a chain reaction. Gold
 * couplers turn two rings together and padlocked rings never turn. Clear the knot within the move limit; beat
 * par for three stars.
 * Look: bright toy style for kids (see UntwineArt): glossy plastic tube rings in toy colours on a warm cream
 * backdrop, bouncy taps, pop-and-fly releases with confetti. (Port of UntwineGame.cs.)
 */

const Radius = 0.6;
const Width = 0.22;
const ConfettiCount = 160;
const PopCount = 24;
const StarCount = 14;
const GapDeg = 92;
const TopBand = 320, BottomBand = 290;
const RowH = Math.sqrt(3) * 0.5;

const Mint = Pal.hex(0x22b573); // friendly green (headline / announcements)
const Rose = Pal.hex(0xff4f8b);
const Gold = Pal.hex(0xffb01f);
const LockedColor = UntwineArt.Locked;

class RingView {
  Root!: GameObject; Spin!: GameObject;
  Tube!: SpriteRenderer; Shine!: SpriteRenderer; Shadow!: SpriteRenderer; Fill!: SpriteRenderer; Pivot!: SpriteRenderer;
  Lock!: SpriteRenderer; LockBadge!: SpriteRenderer; Halo!: SpriteRenderer;
  FlySpin = 0;
  Home = V2.zero; FlyDir = V2.zero;
  Color = Color.white;
  Vis = 0; Vel = 0; Target = 0; Shake = 0; Flash = 0; Delay = -1; FlyT = -1;
}

class CouplerView {
  A = 0; B = 0;
  Bar!: LineRenderer; BarIn!: LineRenderer;
  DotA!: SpriteRenderer; DotB!: SpriteRenderer;
}

class Bit {
  Sr!: SpriteRenderer;
  Pos = V2.zero; Vel = V2.zero;
  Rot = 0; RotSpeed = 0; Life = 0; MaxLife = 0; Size = 0;
  Color = Color.white;
  Active = false;
}

class Pop {
  Sr!: SpriteRenderer;
  T = 0; Duration = 0; From = 0; To = 0;
  Color = Color.white;
}

interface Twinkle { Sr: SpriteRenderer; Base: V2; Phase: number; Speed: number; Size: number }

interface Snapshot { Knot: Knot; MovesLeft: number; MovesUsed: number }

const lattice = (a: number, b: number) => new V2(a + b * 0.5, b * RowH);

const LockSprite = () => Art.shape("untwine-lock", (p) => {
  const body = -Art.roundBox(new V2(p.x, (p.y + 0.3) * 1.6), 0.62, 0.18);
  let shackle = 0.11 - Math.abs(new V2(p.x, p.y - 0.12).magnitude - 0.38);
  if (p.y < 0.05) shackle = -1;
  return Art.edge(Math.max(body, shackle));
});

function set(t: Text | null, s: string) { if (t && t.text !== s) t.text = s; }

function setButton(b: ArcadeButton, label: string, enabled: boolean) {
  set(b.label, label);
  if (b.interactable !== enabled) b.interactable = enabled;
}

function setCouplerVisible(c: CouplerView, on: boolean) {
  c.Bar.gameObject.setActive(on);
  c.BarIn.gameObject.setActive(on);
  c.DotA.gameObject.setActive(on);
  c.DotB.gameObject.setActive(on);
}

function startBit(b: Bit, life: number) {
  b.Active = true;
  b.Life = 0;
  b.MaxLife = life;
  b.Rot = Random.range(0, 360);
  b.RotSpeed = Random.range(-540, 540);
  b.Size = Random.range(0.12, 0.22);
  b.Sr.color = b.Color;
  b.Sr.gameObject.setActive(true);
}

export class UntwineGame extends ArcadeGame {
  private world!: GameObject;
  private backdrop: SpriteRenderer | null = null;
  private flatLine!: Material;
  private readonly confetti: Bit[] = [];
  private readonly pops: Pop[] = [];
  private readonly twinkles: Twinkle[] = [];
  private confettiCursor = 0;
  private danger = 0;
  private readonly rings: RingView[] = [];
  private readonly couplers: CouplerView[] = [];
  private readonly history: Snapshot[] = [];
  private readonly demoPlan: number[] = [];
  private turnClip!: AudioClip; private freeClip!: AudioClip;

  private knot!: Knot;
  private level = 0; private par = 0; private movesLeft = 0; private movesUsed = 0; private undosLeft = 0; private hintsLeft = 0; private hintsUsed = 0;
  private hintRing = -1; private demoStep = 0; private chainBest = 0;
  private ended = false; private revived = false;
  private endTimer = -1; private demoTimer = 0; private idle = 0;
  private need = new V2(5, 5);

  private levelText!: Text; private movesText!: Text; private parText!: Text;
  private undoButton!: ArcadeButton; private hintButton!: ArcadeButton;

  protected Describe() {
    return new GameInfo({
      Id: "untwine",
      Title: "UNTWINE",
      Tagline: "TURN THE RINGS. UNDO THE KNOT.",
      Accent: UntwineArt.Orange,
      Accent2: Pal.hex(0x2e86e8),
      BgTop: Pal.hex(0xffe9c7),
      BgBottom: Pal.hex(0xfbc98f),
      GridSpacing: 1,
      ShortSide: 7,
      Touch: TouchScheme.None,
      Music: { bpm: 100, rootHz: 110, degrees: [0, 4, 5, 3], seed: 33, energy: 0.45, major: true },
      Reminders: [
        "The knot is waiting|A fresh tangle of rings needs untwining.",
        "Your rings miss you|One clever twist could set them all free.",
        "New puzzle ready|Can you beat par on the next knot?",
      ],
      HowTo: [
        howTo(Art.Ring, UntwineArt.Toy[3], "Tap a ring to turn it 60° clockwise."),
        howTo(Art.Ring, UntwineArt.Toy[6], "Two touching rings are linked until one's GAP faces the other."),
        howTo(Art.Star, Gold, "When all its links are open, a ring slips free and flies away."),
        howTo(Art.Chevron, Pal.Good, "Freed rings can free their neighbours: chain reactions!"),
        howTo(Art.Diamond, Gold, "GOLD couplers make two rings turn together."),
        howTo(Art.RoundSquare, LockedColor, "Padlocked rings never turn: open their neighbours instead."),
        howTo(Art.Star, Pal.Warn, "Clear the knot within the move limit. Beat par for 3 stars."),
      ],
      Tips: [
        "Free the outer rings first: the core gets easier.",
        "Turning a ring 5 times = turning it back once. Plan ahead!",
        "Line up several gaps, then trigger a chain with one tap.",
        "Coupled rings: look at what BOTH rings will face.",
      ],
    });
  }

  protected get ShortSide() { return UntwineGame.FitShortSide(this.need, TopBand, BottomBand); }

  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }

  protected BestLine() { return `LEVEL ${this.CurrentLevel}`; }

  protected StatsLine() {
    const done = this.CurrentLevel - 1;
    return done > 0 ? `${this.Data.get("stars")} STARS   ·   ${done} KNOTS UNTWINED   ·   BEST CHAIN ${this.Data.get("chain")}` : "A SATISFYING RING-TWISTING PUZZLE";
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("Knot", this.gameObject);
    const rng = new SysRandom(8);
    this.turnClip = Sfx.make("untwine-turn", 0.12, (t) =>
      Sfx.sinP(Sfx.glide(t, 1100, 700, 0.08)) * Sfx.env(t, 0.001, 0.05) * 0.22
      + (rng.nextDouble() * 2 - 1) * Sfx.env(t, 0.0005, 0.01) * 0.18);
    this.freeClip = Sfx.make("untwine-free", 0.4, (t) =>
      (Sfx.sinP(Sfx.glide(t, 420, 1500, 0.32)) + 0.35 * Sfx.triP(Sfx.glide(t, 840, 3000, 0.32))) * Sfx.env(t, 0.005, 0.28) * 0.16);
    this.BuildToyWorld();
    this.BuildHud();
  }

  /** Cream backdrop over the shared neon one, a calmer post-process, and the confetti/pop pools. */
  private BuildToyWorld() {
    this.backdrop = UntwineArt.Spr(this.world, "ToyBackdrop", UntwineArt.Backdrop, Color.white, 1, -900);
    this.flatLine = new Material("Untwine Flat Line", false, 1, "soft");

    // Only this scene's own post-process profile is touched; other games are unaffected.
    CasualLook.calm(this, 1.15, 0.14);

    const rng = new SysRandom(5);
    for (let i = 0; i < StarCount; i++) {
      const sr = UntwineArt.Spr(this.world, "Twinkle", Art.Star, new Color(1, 0.72, 0.36, 0.35), 0.3, -880);
      this.twinkles.push({
        Sr: sr,
        Base: new V2(rng.nextDouble() * 12.0 - 6.0, rng.nextDouble() * 16.0 - 8.0),
        Phase: rng.nextDouble() * 6.28,
        Speed: 0.6 + rng.nextDouble() * 0.8,
        Size: 0.18 + rng.nextDouble() * 0.22,
      });
    }

    const fxRoot = new GameObject("ToyFx", this.world);
    for (let i = 0; i < ConfettiCount; i++) {
      const sr = UntwineArt.Spr(fxRoot, "Confetti", i % 3 === 0 ? Art.Disc : i % 3 === 1 ? Art.Star : Art.Square, Color.white, 0.2, 40);
      sr.gameObject.setActive(false);
      this.confetti.push(Object.assign(new Bit(), { Sr: sr }));
    }
    for (let i = 0; i < PopCount; i++) {
      const sr = UntwineArt.Spr(fxRoot, "Pop", Art.Ring, Color.white, 1, 38);
      sr.gameObject.setActive(false);
      this.pops.push(Object.assign(new Pop(), { Sr: sr }));
    }
  }

  private Ring(i: number) {
    const size = UntwineArt.RingSpriteSize(Radius, Width);
    while (this.rings.length <= i) {
      const v = new RingView();
      v.Root = new GameObject("Ring " + this.rings.length, this.world);
      v.Halo = UntwineArt.Spr(v.Root, "Halo", UntwineArt.Soft, Color.clear, 2.1, 1);
      v.Fill = UntwineArt.Spr(v.Root, "Fill", UntwineArt.Soft, Color.clear, Radius * 2.3, 2);
      // Drop shadow: rotates with the ring but stays offset straight down.
      v.Shadow = UntwineArt.Spr(v.Root, "Shadow", UntwineArt.RingTube(Radius, Width, GapDeg), new Color(0.36, 0.2, 0.12, 0.24), size, 3);
      v.Spin = new GameObject("Spin", v.Root);
      v.Tube = UntwineArt.Spr(v.Spin, "Tube", UntwineArt.RingTube(Radius, Width, GapDeg), Color.white, size, 4);
      v.Shine = UntwineArt.Spr(v.Spin, "Shine", UntwineArt.RingShine(Radius, Width, GapDeg), Color.white, size, 5);
      v.Pivot = UntwineArt.Spr(v.Root, "Peg", UntwineArt.Dome, Color.white, 0.22, 6);
      v.LockBadge = UntwineArt.Spr(v.Root, "LockBadge", UntwineArt.Dome, Color.white, 0.62, 6);
      v.Lock = UntwineArt.Spr(v.Root, "Lock", LockSprite(), UntwineArt.Ink, 0.36, 7);
      this.rings.push(v);
    }
    return this.rings[i];
  }

  private Coupler(index: number) {
    while (this.couplers.length <= index) {
      const c = new CouplerView();
      c.Bar = Art.line(this.world, "CouplerEdge", new Color(0.72, 0.40, 0.08), 0.2, 3, false, true, this.flatLine);
      c.Bar.positionCount = 2;
      c.Bar.numCapVertices = 6;
      c.BarIn = Art.line(this.world, "Coupler", Gold, 0.13, 3, false, true, this.flatLine);
      c.BarIn.positionCount = 2;
      c.BarIn.numCapVertices = 6;
      c.DotA = UntwineArt.Spr(this.world, "Bolt", UntwineArt.Dome, Gold, 0.34, 7);
      c.DotB = UntwineArt.Spr(this.world, "Bolt", UntwineArt.Dome, Gold, 0.34, 7);
      this.couplers.push(c);
    }
    return this.couplers[index];
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    // A friendly rounded card behind the level / moves read-out.
    const card = UIKit.node("TopCard", hud).place(new V2(0.5, 1), new V2(0, -146), new V2(600, 214));
    UIKit.img(card, "Bg", Art.UiRound, UntwineArt.Card).rectTransform.stretch();
    UIKit.img(card, "Edge", Art.UiOutline, UntwineArt.Orange).rectTransform.stretch();
    this.levelText = UIKit.at(UIKit.label(hud, "", 66, UntwineArt.Ink), new V2(0.5, 1), new V2(0, -86), new V2(700, 90));
    this.movesText = UIKit.at(UIKit.label(hud, "", 46, UntwineArt.Orange), new V2(0.5, 1), new V2(0, -160), new V2(700, 60));
    this.parText = UIKit.at(UIKit.label(hud, "", 28, UntwineArt.InkSoft), new V2(0.5, 1), new V2(0, -212), new V2(700, 40));
    this.undoButton = UIKit.buttonAt(hud, "UNDO", new V2(0.5, 0), new V2(-190, 150), new V2(320, 120), false, () => this.Undo(), 34);
    this.hintButton = UIKit.buttonAt(hud, "HINT", new V2(0.5, 0), new V2(190, 150), new V2(320, 120), false, () => this.Hint(), 34);
    this.undoButton.setAccent(Rose);
    this.hintButton.setAccent(Pal.Warn);

    // The shared title text is white; give it a soft card so it stays readable on the light backdrop.
    const titleCentre = this.UI.TitleExtra ? this.UI.TitleExtra.parent : null;
    if (titleCentre) {
      const tc = UIKit.img(titleCentre, "ToyTitleCard", Art.UiRound, new Color(0.33, 0.2, 0.45, 0.72));
      tc.rectTransform.place(UIKit.Center, new V2(0, 30), new V2(1080, 1060));
      tc.rectTransform.setAsFirstSibling();
    }
  }

  // ------------------------------------------------------------------ level setup

  private Load(k: Knot) {
    this.knot = k;
    this.history.length = 0;
    this.hintRing = -1;
    let centre = V2.zero;
    for (let i = 0; i < k.N; i++) centre = centre.add(lattice(k.A[i], k.B[i]));
    centre = centre.div(Math.max(1, k.N));
    let min = new V2(Number.MAX_VALUE, Number.MAX_VALUE), max = min.neg();
    for (let i = 0; i < k.N; i++) {
      const v = this.Ring(i);
      v.Home = lattice(k.A[i], k.B[i]).sub(centre);
      min = V2.min(min, v.Home);
      max = V2.max(max, v.Home);
    }
    for (let i = 0; i < this.rings.length; i++) {
      const v = this.rings[i];
      const on = i < k.N;
      v.Root.setActive(on);
      if (!on) continue;
      const toy = (((k.A[i] + 3 * k.B[i]) % 7) + 7) % 7; // hex neighbours always get different colours
      v.Color = k.Locked[i] ? LockedColor : UntwineArt.Toy[toy];
      v.FlySpin = (i % 2 === 0 ? 1 : -1) * (220 + 40 * (i % 3));
      v.Target = v.Vis = k.O[i] * 60;
      v.Vel = v.Shake = v.Flash = 0;
      v.Delay = v.FlyT = -1;
      v.Lock.gameObject.setActive(k.Locked[i]);
      v.LockBadge.gameObject.setActive(k.Locked[i]);
      v.Pivot.gameObject.setActive(!k.Locked[i]);
      this.Place(v, i, Time.time);
    }
    let c = 0;
    for (let i = 0; i < k.N; i++) {
      const j = k.Partner[i];
      if (j <= i) continue;
      const cv = this.Coupler(c++);
      cv.A = i;
      cv.B = j;
      cv.Bar.setPosition(0, this.rings[i].Home);
      cv.Bar.setPosition(1, this.rings[j].Home);
      cv.BarIn.setPosition(0, this.rings[i].Home);
      cv.BarIn.setPosition(1, this.rings[j].Home);
      cv.DotA.transform.localPosition = this.rings[i].Home;
      cv.DotB.transform.localPosition = this.rings[j].Home;
    }
    for (let i = 0; i < this.couplers.length; i++) setCouplerVisible(this.couplers[i], i < c);
    this.need = max.sub(min).add(V2.one.mul(Radius * 2 + 0.5));
    this.CenterCamera();
  }

  private CenterCamera() {
    const r = this.PlayRect(TopBand, BottomBand, 0);
    this.Fx.CameraTarget = r.center.neg();
  }

  protected OnLayoutChanged() { this.CenterCamera(); }

  protected OnEnterTitle() { this.NewDemo(); }

  private NewDemo() {
    const demoLevel = 8 + Random.rangeInt(0, 20);
    this.Load(KnotGenerator.Build(demoLevel)[0]);
    this.demoPlan.length = 0;
    this.demoPlan.push(...(Planner.Best(this.knot, Random.rangeInt(0, 9999), 2) ?? []));
    this.demoStep = 0;
    this.demoTimer = 1.2;
  }

  protected BeginRun() {
    this.level = this.CurrentLevel;
    const [k, par] = KnotGenerator.Build(this.level);
    this.par = par;
    this.Load(k);
    this.movesLeft = this.par + this.Slack;
    this.movesUsed = this.hintsUsed = this.chainBest = 0;
    this.undosLeft = 3;
    this.hintsLeft = this.level <= 3 ? 5 : 3;
    this.ended = this.revived = false;
    this.endTimer = -1;
    this.idle = 0;
    this.UI.Announce("LEVEL " + this.level, UntwineArt.Orange, 1.2);
    const spec = KnotGenerator.ForLevel(this.level);
    if (this.level === 1) this.UI.Hint("Tap a ring to turn it. Point a gap at its neighbour to unlink them!");
    else if (this.level === 2) this.UI.Hint("A ring flies free once ALL its links are open.");
    else if (spec.Couplers > 0 && this.Data.get("seenCoupler") === 0) {
      this.Data.set("seenCoupler", 1);
      this.UI.Hint("New: GOLD couplers make two rings turn together.");
    } else if (spec.Locked > 0 && this.Data.get("seenLock") === 0) {
      this.Data.set("seenLock", 1);
      this.UI.Hint("New: padlocked rings never turn. Open their neighbours instead.");
    }
    Sfx.setIntensity(0.15);
  }

  private get Slack() { return Math.max(3, Math.ceil(this.par * 0.3)); }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Animate(dt);
    if (this.State !== Phase.Title) return;
    this.demoTimer -= dt;
    if (this.demoTimer > 0) return;
    if (this.knot.Remaining === 0 || this.demoStep >= this.demoPlan.length) {
      if (this.Busy) return;
      this.NewDemo();
      return;
    }
    this.Turn(this.demoPlan[this.demoStep++], true);
    this.demoTimer = 0.42;
  }

  protected TickRun(dt: number) {
    this.Animate(dt);
    this.UpdateHud();
    if (this.ended) {
      if (this.endTimer > 0 && (this.endTimer -= dt) <= 0) this.CompleteLevel();
      return;
    }
    this.idle += dt;
    if (this.level <= 2 && this.idle > 5 && this.hintRing < 0 && !this.Busy) this.ShowHint(true);

    if (this.Controls.tapped) {
      this.idle = 0;
      const i = this.RingAt(this.ScreenToWorld(this.Controls.tapScreen));
      if (i >= 0) this.PlayerTap(i);
    }

    if (this.Busy) return;
    if (this.knot.Remaining === 0) {
      this.ended = true;
      this.endTimer = 0.5;
      this.UI.Hint(null);
    } else if (this.movesLeft <= 0) this.OutOfMoves();
  }

  private get Busy() {
    for (let i = 0; i < this.knot.N; i++)
      if (this.rings[i].Delay >= 0 || (this.rings[i].FlyT >= 0 && this.rings[i].FlyT < 0.4)) return true;
    return false;
  }

  private RingAt(p: V2) {
    let best = -1;
    let bestD = Radius + 0.2;
    for (let i = 0; i < this.knot.N; i++) {
      if (this.knot.Gone[i]) continue;
      const d = this.rings[i].Home.sub(p).magnitude;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private PlayerTap(i: number) {
    if (this.movesLeft <= 0) return;
    if (this.knot.Locked[i]) {
      this.rings[i].Shake = 1;
      Sfx.play(Snd.Deny, 0.5);
      if (this.Data.get("lockTip") === 0) {
        this.Data.set("lockTip", 1);
        this.UI.Hint("Locked rings never turn. Turn their neighbours to face them instead.");
      }
      return;
    }
    this.history.push({ Knot: this.knot.Clone(), MovesLeft: this.movesLeft, MovesUsed: this.movesUsed });
    if (this.history.length > 60) this.history.splice(0, 1);
    this.movesLeft--;
    this.movesUsed++;
    this.hintRing = -1;
    this.UI.Hint(null);
    this.Turn(i, false);
  }

  private Turn(i: number, quiet: boolean) {
    const knot = this.knot;
    const p = knot.Partner[i];
    const partnerTurns = p >= 0 && !knot.Gone[p] && !knot.Locked[p];
    const waves = knot.Tap(i);
    if (!waves) return;
    this.Spin(i);
    if (partnerTurns) this.Spin(p);
    Sfx.playClip(this.turnClip, quiet ? 0.25 : 0.7, Random.range(0.95, 1.08));

    let count = 0;
    for (let w = 0; w < waves.length; w++)
      for (const r of waves[w]) {
        const v = this.rings[r];
        v.Delay = 0.16 + w * 0.2 + count * 0.03;
        const a = knot.O[r] * 60 * Mathf.Deg2Rad;
        v.FlyDir = new V2(Math.cos(a), Math.sin(a));
        count++;
      }
    if (!quiet && waves.length >= 2) {
      let chain = 0;
      for (const w of waves) chain += w.length;
      this.chainBest = Math.max(this.chainBest, chain);
      const words = ["", "", "CHAIN x", "COMBO x", "AMAZING x", "UNREAL x"];
      this.UI.Announce(words[Math.min(waves.length, words.length - 1)] + chain, Gold, 1.1);
      this.SpawnConfetti(V2.zero, 18 + waves.length * 8, 7);
      this.Fx.shake(0.1 + waves.length * 0.04);
    }
  }

  private Spin(i: number) {
    const v = this.rings[i];
    v.Target -= 60;
    v.Flash = 1;
  }

  // ------------------------------------------------------------------ animation

  private Animate(dt: number) {
    const time = Time.time;
    this.AnimateToyWorld(dt, time);
    for (let i = 0; i < this.knot.N; i++) {
      const v = this.rings[i];
      // Springy rotation with a little overshoot.
      const acc = (v.Target - v.Vis) * 420 - v.Vel * 26;
      v.Vel += acc * dt;
      v.Vis += v.Vel * dt;
      v.Shake = Mathf.moveTowards(v.Shake, 0, dt * 3);
      v.Flash = Mathf.moveTowards(v.Flash, 0, dt * 3.2);

      if (v.Delay >= 0) {
        v.Delay -= dt;
        if (v.Delay < 0) this.Release(i);
      }
      if (v.FlyT >= 0 && v.FlyT < 1) v.FlyT = Math.min(1, v.FlyT + dt / 0.75);
      this.Place(v, i, time);

      const hinted = i === this.hintRing && this.State === Phase.Playing;
      const pulse = 0.5 + 0.5 * Math.sin(time * 7);
      v.Halo.color = hinted ? UntwineArt.Sun.withAlpha(0.45 + 0.35 * pulse) : v.Color.withAlpha(0.22 * v.Flash);
      v.Halo.transform.localScale = V3.one.mul(hinted ? 2.0 + 0.2 * pulse : 2.0);
    }
    for (let c = 0; c < this.couplers.length; c++) {
      const cv = this.couplers[c];
      if (!cv.Bar.gameObject.activeSelf) continue;
      const alive = (!this.knot.Gone[cv.A] && !this.knot.Gone[cv.B]) || this.rings[cv.A].Delay >= 0 || this.rings[cv.B].Delay >= 0;
      const a = alive ? 1 : 0;
      cv.Bar.startColor = cv.Bar.endColor = new Color(0.72, 0.40, 0.08, a);
      cv.BarIn.startColor = cv.BarIn.endColor = Gold.withAlpha(a);
      cv.DotA.color = cv.DotB.color = Gold.withAlpha(a);
    }
  }

  private Place(v: RingView, index: number, time: number) {
    let pos = v.Home.add(new V2(Math.sin(time * 60) * 0.06 * v.Shake, 0));
    let alpha = 1;
    // Bouncy "boing" when tapped, plus a gentle idle breathing.
    const tapPop = Math.sin(v.Flash * Math.PI) * 0.09;
    const breathe = 0.012 * Math.sin(time * 2.4 + index * 0.9);
    let sx = 1 + tapPop + breathe, sy = 1 + tapPop * 0.6 + breathe;
    let extraSpin = 0;
    const hinted = index === this.hintRing && this.State === Phase.Playing;
    if (hinted) pos = pos.withY(pos.y + Math.abs(Math.sin(time * 5)) * 0.06);
    if (v.FlyT >= 0) {
      const t = v.FlyT;
      if (t < 0.18) {
        // Pop up first...
        const k = t / 0.18;
        const s = 1 + 0.22 * Math.sin(k * Math.PI * 0.5);
        sx = sy = s;
      } else {
        // ...then fly off with a spin, shrinking and fading.
        const k = (t - 0.18) / 0.82;
        pos = pos.add(v.FlyDir.mul(9 * Ease.inQuad(k))).add(new V2(0, 1.2 * Math.sin(k * Math.PI)));
        const s = Mathf.lerp(1.22, 0.7, k);
        sx = sy = s;
        extraSpin = v.FlySpin * k;
        alpha = 1 - Mathf.clamp01((k - 0.5) / 0.5);
      }
    }
    v.Root.localPosition = new V3(pos.x, pos.y, 0);
    v.Root.localScale = new V3(sx, sy, 1);
    const rot = v.Vis + extraSpin;
    v.Spin.localRotation = Quaternion.euler(0, 0, rot);
    v.Shadow.transform.localRotation = Quaternion.euler(0, 0, rot);
    v.Shadow.transform.localPosition = new V3(0.04, -0.08, 0);

    const body = Color.lerp(v.Color, Color.white, 0.3 * v.Flash).withAlpha(alpha);
    v.Tube.color = body;
    v.Shine.color = Color.white.withAlpha(alpha);
    v.Shadow.color = new Color(0.36, 0.2, 0.12, 0.24 * alpha);
    v.Fill.color = v.Color.withAlpha(0.14 * alpha);
    v.Pivot.color = Color.lerp(v.Color, Color.white, 0.2).withAlpha(alpha);
    v.Lock.color = UntwineArt.Ink.withAlpha(alpha);
    v.LockBadge.color = new Color(0.86, 0.83, 0.8, alpha);
    const visible = v.FlyT < 1;
    if (v.Root.activeSelf !== visible) v.Root.setActive(visible);
  }

  private Release(i: number) {
    const v = this.rings[i];
    v.FlyT = 0;
    const quiet = this.State !== Phase.Playing;
    this.SpawnConfetti(v.Home, quiet ? 6 : 18, 5.5, v.Color);
    this.SpawnPop(v.Home, v.Color, 0.6, 2.1, 0.4);
    if (quiet) {
      Sfx.playClip(this.freeClip, 0.2, 1);
      return;
    }
    this.Fx.kick(0.3);
    Fx.haptic();
    const gone = this.knot.N - this.knot.Remaining;
    Sfx.playClip(this.freeClip, 0.75, 0.9 + 0.04 * Math.min(gone, 15));
    Sfx.setIntensity(Mathf.clamp01(gone / this.knot.N) * 0.75);
  }

  // ------------------------------------------------------------------ toy world: backdrop, stars, confetti, pops

  private AnimateToyWorld(dt: number, time: number) {
    const cam = this.Fx.CameraTarget;
    const h = Camera.orthographicSize * 2 * 1.2;
    if (this.backdrop) {
      this.backdrop.transform.position = new V3(cam.x, cam.y, 0);
      this.backdrop.transform.localScale = new V3(h * Camera.aspect, h, 1);
      const low = this.State === Phase.Playing && !this.ended && this.movesLeft <= 3;
      this.danger = Mathf.moveTowards(this.danger, low ? 1 : 0, dt * 1.5);
      this.backdrop.color = Color.lerp(Color.white, new Color(1, 0.8, 0.8), this.danger * (0.6 + 0.25 * Math.sin(time * 4)));
    }

    for (let i = 0; i < this.twinkles.length; i++) {
      const t = this.twinkles[i];
      const tw = 0.5 + 0.5 * Math.sin(time * t.Speed * 2 + t.Phase);
      const tr = t.Sr.transform;
      tr.position = new V3(cam.x + t.Base.x, cam.y + t.Base.y + Math.sin(time * 0.6 + t.Phase) * 0.15, 0);
      tr.localRotation = Quaternion.euler(0, 0, time * 12 * (i % 2 === 0 ? 1 : -1) + t.Phase * 57);
      tr.localScale = V3.one.mul(t.Size * (0.8 + 0.3 * tw));
      t.Sr.color = new Color(1, 0.72, 0.36, 0.18 + 0.22 * tw);
    }

    for (let i = 0; i < this.confetti.length; i++) {
      const b = this.confetti[i];
      if (!b.Active) continue;
      b.Life += dt;
      if (b.Life >= b.MaxLife) {
        b.Active = false;
        b.Sr.gameObject.setActive(false);
        continue;
      }
      b.Vel = b.Vel.withY(b.Vel.y - 11 * dt);
      b.Vel = b.Vel.mul(1 - Math.min(1, 1.4 * dt));
      b.Vel = b.Vel.withY(Math.max(b.Vel.y, -3.5));
      b.Pos = b.Pos.add(b.Vel.mul(dt)).add(new V2(Math.sin(b.Life * 7 + b.Rot) * 0.6 * dt, 0));
      b.Rot += b.RotSpeed * dt;
      const tr = b.Sr.transform;
      tr.position = new V3(b.Pos.x, b.Pos.y, 0);
      tr.localRotation = Quaternion.euler(0, 0, b.Rot);
      const flip = Math.abs(Math.cos(b.Life * 8 + b.Rot * 0.01));
      tr.localScale = new V3(b.Size, b.Size * (0.3 + 0.7 * flip), 1);
      b.Sr.color = b.Color.withAlpha(Mathf.clamp01((b.MaxLife - b.Life) / 0.4));
    }

    for (let i = 0; i < this.pops.length; i++) {
      const pp = this.pops[i];
      if (!pp.Sr.gameObject.activeSelf) continue;
      pp.T += dt;
      if (pp.T >= pp.Duration) {
        pp.Sr.gameObject.setActive(false);
        continue;
      }
      const k = pp.T / pp.Duration;
      const s = Mathf.lerp(pp.From, pp.To, Ease.outCubic(k));
      pp.Sr.transform.localScale = new V3(s, s, 1);
      pp.Sr.color = pp.Color.withAlpha((1 - k) * 0.9);
    }
  }

  private SpawnConfetti(origin: V2, count: number, power: number, main: Color | null = null) {
    for (let n = 0; n < count; n++) {
      const b = this.confetti[this.confettiCursor];
      this.confettiCursor = (this.confettiCursor + 1) % this.confetti.length;
      const a = Random.range(0, Math.PI * 2);
      const sp = power * Random.range(0.35, 1);
      b.Pos = origin;
      b.Vel = new V2(Math.cos(a) * sp, Math.sin(a) * sp + power * 0.4);
      b.Color = main && n % 2 === 0 ? main : UntwineArt.Confetti[Random.rangeInt(0, UntwineArt.Confetti.length)];
      startBit(b, 0.9 + Random.range(0, 0.6));
    }
  }

  /** Confetti falling from the top of the view (level complete). */
  private ConfettiShower(count: number) {
    const h = Camera.orthographicSize, w = h * Camera.aspect;
    const c = this.Fx.CameraTarget;
    for (let n = 0; n < count; n++) {
      const b = this.confetti[this.confettiCursor];
      this.confettiCursor = (this.confettiCursor + 1) % this.confetti.length;
      b.Pos = c.add(new V2(Random.range(-w, w), h + Random.range(0.2, 3.5)));
      b.Vel = new V2(Random.range(-1, 1), Random.range(-3, -1.2));
      b.Color = UntwineArt.Confetti[Random.rangeInt(0, UntwineArt.Confetti.length)];
      startBit(b, 3 + Random.range(0, 1.2));
    }
  }

  private SpawnPop(at: V2, color: Color, from: number, to: number, duration: number) {
    let pp: Pop | null = null;
    for (let i = 0; i < this.pops.length; i++)
      if (!this.pops[i].Sr.gameObject.activeSelf) { pp = this.pops[i]; break; }
    if (!pp) pp = this.pops[0];
    pp.T = 0;
    pp.Duration = duration;
    pp.From = from;
    pp.To = to;
    pp.Color = color;
    pp.Sr.transform.position = new V3(at.x, at.y, 0);
    pp.Sr.gameObject.setActive(true);
  }

  // ------------------------------------------------------------------ helpers

  private Undo() {
    if (this.State !== Phase.Playing || this.ended || this.Busy) return;
    if (this.undosLeft <= 0) {
      if (this.history.length > 0 && AdService.rewardedAvailable)
        AdService.showRewarded((earned) => {
          if (!earned) return;
          this.undosLeft += 3;
          Sfx.play(Snd.PowerUp);
        });
      return;
    }
    if (this.history.length === 0) {
      Sfx.play(Snd.Deny, 0.5);
      return;
    }
    const snap = this.history.pop()!;
    this.undosLeft--;
    this.movesLeft = snap.MovesLeft;
    this.movesUsed = snap.MovesUsed;
    for (let i = 0; i < this.knot.N; i++) {
      const v = this.rings[i];
      if (this.knot.Gone[i] && !snap.Knot.Gone[i]) {
        v.FlyT = v.Delay = -1;
        v.Root.setActive(true);
        v.Flash = 1;
      }
      // Turn back the short way to the restored orientation.
      const want = snap.Knot.O[i] * 60;
      const delta = Mathf.deltaAngle(v.Target, want);
      v.Target += delta;
    }
    this.knot.CopyFrom(snap.Knot);
    this.hintRing = -1;
    Sfx.play(Snd.Whoosh, 0.6, 1.3);
  }

  private Hint() {
    if (this.State !== Phase.Playing || this.ended || this.Busy) return;
    if (this.hintsLeft <= 0) {
      if (AdService.rewardedAvailable)
        AdService.showRewarded((earned) => {
          if (!earned) return;
          this.hintsLeft += 2;
          this.ShowHint(false);
        });
      return;
    }
    this.ShowHint(false);
  }

  private ShowHint(free: boolean) {
    const plan = Planner.Best(this.knot, Random.rangeInt(0, 9999), 3);
    if (!plan || plan.length === 0) return;
    if (!free) {
      this.hintsLeft--;
      this.hintsUsed++;
    }
    this.hintRing = plan[0];
    Sfx.play(Snd.Confirm, 0.6);
    if (free) this.UI.Hint("Try tapping the glowing ring.");
  }

  // ------------------------------------------------------------------ HUD / end

  private UpdateHud() {
    set(this.levelText, "LEVEL " + this.level);
    set(this.movesText, this.movesLeft + (this.movesLeft === 1 ? " MOVE LEFT" : " MOVES LEFT"));
    this.movesText.color = this.movesLeft <= 3 ? Pal.Danger : UntwineArt.Orange;
    set(this.parText, `PAR ${this.par}   ·   USED ${this.movesUsed}`);
    const busy = this.ended || this.Busy;
    if (this.undosLeft > 0) setButton(this.undoButton, "UNDO  " + this.undosLeft, this.history.length > 0 && !busy);
    else if (AdService.rewardedAvailable && this.history.length > 0) setButton(this.undoButton, "+3 UNDO (AD)", !busy);
    else setButton(this.undoButton, "UNDO  0", false);
    if (this.hintsLeft > 0) setButton(this.hintButton, "HINT  " + this.hintsLeft, !busy);
    else if (AdService.rewardedAvailable) setButton(this.hintButton, "HINT (AD)", !busy);
    else setButton(this.hintButton, "HINT  0", false);
    this.Back.setDanger(0); // the toy backdrop blushes red itself (AnimateToyWorld)
  }

  private CompleteLevel() {
    const level = this.level, par = this.par, movesUsed = this.movesUsed;
    let stars = movesUsed <= par ? 3 : movesUsed <= par + Math.trunc(this.Slack / 2) ? 2 : 1;
    if (this.revived) stars = 1;
    const prev = this.Data.get("s" + level);
    if (stars > prev) {
      this.Data.set("s" + level, stars);
      this.Data.add("stars", stars - prev);
    }
    this.Data.set("level", level + 1);
    this.Data.max("chain", this.chainBest);
    this.SpawnConfetti(V2.zero, 60, 9);
    this.ConfettiShower(100);
    this.SpawnPop(V2.zero, UntwineArt.Sun, 0.8, 6, 0.6);
    this.Fx.kick(0.6);
    Fx.haptic(true);
    Sfx.play(Snd.Win);
    this.Finish(new Result({
      Headline: movesUsed < par ? "AMAZING!" : "WELL DONE!",
      HeadlineColor: Mint,
      Stars: stars,
      Value: "LEVEL " + level,
      BestLine: `LEVEL ${level}   ·   ${movesUsed} MOVES   ·   PAR ${par}`,
      Stats: [
        ["LEVEL", String(level)],
        ["MOVES", String(movesUsed)],
        ["BEST CHAIN", String(this.chainBest)],
        ["TOTAL STARS", String(this.Data.get("stars"))],
      ],
      Primary: "NEXT LEVEL",
      Victory: true,
    }));
  }

  private OutOfMoves() {
    this.ended = true;
    this.endTimer = -1;
    Sfx.play(Snd.Lose);
    const rem = this.knot.Remaining;
    this.Finish(new Result({
      Headline: "OUT OF MOVES",
      HeadlineColor: Pal.Danger,
      Value: rem + (rem === 1 ? " RING LEFT" : " RINGS LEFT"),
      BestLine: `LEVEL ${this.level}   ·   PAR ${this.par}`,
      Stats: [
        ["LEVEL", String(this.level)],
        ["RINGS FREED", this.knot.N - rem + " / " + this.knot.N],
      ],
      Primary: "RETRY",
      Reward: () => {
        this.ended = false;
        this.revived = true;
        this.movesLeft += 5;
        this.Revive();
        this.UI.Announce("+5 MOVES", Gold, 1);
      },
      RewardLabel: "+5 MOVES (WATCH AD)",
    }));
  }
}
