import {
  Art, CasualArt, CasualLook, child, Color, Ease, Fmt, GameInfo, howTo, LineRenderer, Mathf, Pal, Sfx, Snd,
  SpriteRenderer, SysRandom, TextMesh, Time, V2, V3, AudioClip,
} from "../../kit";
import { LagoriArt, StoneCols, StoneT, StoneW } from "./LagoriArt";
import { Ball, Bad, Gold, P1Col, P2Col, WallGame, WMode } from "./WallCore";

/**
 * LAGORI (Seven Stones / Pittu) for the LiDAR wall: the street game with seven flat stones and a ball, with the whole
 * neighbourhood watching. Throw a ball at your stack to knock it over, then rebuild it by hitting the scattered stones
 * in order, largest first: each hit flies a stone back onto the pile. The tagger kid throws a tag ball that blocks a
 * stone for a moment; hit the tag ball in the air to swat it away. SOLO: rebuild as many stacks as you can in 2:00.
 * VS COMPUTER: a virtual rival rebuilds its own stack on the right half at a set speed. 2 PLAYERS: split wall, the
 * first to rebuild wins the stack, most stacks wins.
 */

const RoundTime = 120;
const GY0 = -7.5, GY1 = 0.75; // ground y at depth 0 (front) and 1 (back)
const PileZ = 0.3;
const Grav = 30;
const SoloStarsAt = [1500, 3500, 6000];
const Cheers = ["LAGORI!", "STACKED!", "SEVEN STONES!", "WHAT A BUILD!"];

type LanePhase = "knock" | "rebuild" | "pause";
type StoneState = "pile" | "fly" | "rest" | "home";
type TagState = "none" | "wind" | "fly" | "sit" | "gone";

class Stone {
  i = 0; x = 0; z = PileZ; h = 0; vx = 0; vz = 0; vh = 0; rot = 0; vrot = 0;
  state: StoneState = "pile"; t = 0; fx = 0; fz = 0; fh = 0; blockT = 0; flash = 0;
  sr!: SpriteRenderer; shadow!: SpriteRenderer;
}

class Lane {
  idx = 0; L = -15; R = 15; cx = 0;
  phase: LanePhase = "knock"; pauseT = 0;
  next = 0; placed = 7; stacks = 0; points = 0; stonesHome = 0; swats = 0; throws = 0; hits = 0; knocks = 0;
  stones: Stone[] = [];
  wobble = 0;
  // tagger
  tagger!: SpriteRenderer; tagName!: TextMesh; tagX = 0; tagZ = 0.9; tagFlip = false; tagT = 6; pose = 0; poseT = 0;
  tag: TagState = "none"; tagSr!: SpriteRenderer; tagShadow!: SpriteRenderer; tagP = V2.zero; tagFrom = V2.zero; tagTo = V2.zero; tagK = 0; tagVel = V2.zero; tagStone: Stone | null = null; tagLife = 0;
  // markers
  chalk!: SpriteRenderer; ring!: SpriteRenderer; arrow!: SpriteRenderer; badge!: SpriteRenderer; badgeText!: TextMesh; hint!: TextMesh; label!: TextMesh;
}

class Neighbour { sr!: SpriteRenderer; look = 0; base = V2.zero; size = 2.4; flip = false; seed = 0; pose = 0; }

const gy = (z: number) => GY0 + (GY1 - GY0) * z;
const sc = (z: number) => 1 - 0.32 * z;

export class LagoriGame extends WallGame {
  private lanes: Lane[] = [];
  private neighbours: Neighbour[] = [];
  private sky!: SpriteRenderer;
  private street!: SpriteRenderer;
  private houses: SpriteRenderer[] = [];
  private divider!: LineRenderer;
  private bunting: { line: LineRenderer; flags: SpriteRenderer[]; a: V2; b: V2 }[] = [];
  private banner!: SpriteRenderer;
  private brandText!: TextMesh;
  private crowdT = 0;

  private clackClip!: AudioClip;
  private crashClip!: AudioClip;
  private swatClip!: AudioClip;
  private denyClip!: AudioClip;

  protected BrandWord = "LAGORI";

  protected Describe() {
    return new GameInfo({
      Id: "walllagori",
      Title: "LAGORI",
      Tagline: "KNOCK THE SEVEN STONES DOWN. BUILD THEM BACK UP!",
      PlayLabel: "PLAY",
      Accent: Pal.hex(0xff7a3d),
      Accent2: Gold,
      BgTop: Pal.hex(0x5ab0ff),
      BgBottom: Pal.hex(0xffd59a),
      ShortSide: 18,
      Music: { bpm: 118, rootHz: 146.8, degrees: [0, 4, 5, 3], seed: 41, energy: 0.8, major: true },
      HowTo: [
        howTo(LagoriArt.Stone(0), Color.white, "THROW a ball at your stack of seven painted stones to KNOCK IT DOWN."),
        howTo(LagoriArt.Badge(), Gold, "Then REBUILD it: hit the scattered stones in order, LARGEST FIRST (follow the arrow). Each hit flies a stone back onto the pile."),
        howTo(LagoriArt.TagBall(), Color.white, "The TAGGER throws a tag ball that BLOCKS a stone for a moment. Hit the tag ball in the air to SWAT it away!"),
        howTo(Art.Star, Gold, "SOLO: rebuild as many stacks as you can in 2:00. Knock +100, each stone +100, full stack +500, swat +150."),
        howTo(Art.Chevron, P2Col, "VS COMPUTER: a virtual rival rebuilds its stack on the right half. 2 PLAYERS: left half vs right half. First to rebuild wins the stack, most stacks wins."),
        howTo(Art.Ring, Color.white, "Operator: SPACE / ENTER start, ESC pause, R back to title."),
      ],
      Tips: ["Biggest stone first!", "Swat the tag ball before it lands.", "Aim at the middle of the stack to knock it flat."],
    });
  }

  protected RoundLength() { return RoundTime; }
  protected QuickRules() {
    return ["1. Throw at your stack to KNOCK IT DOWN.", "2. Hit the stones LARGEST FIRST to stack them back up.", "3. Swat the TAGGER's red ball before it blocks you!"];
  }
  protected ModeLine(m: WMode) { return m === WMode.Solo ? "2:00 · REBUILD AS MANY STACKS AS YOU CAN" : "2:00 · LEFT HALF vs RIGHT HALF · MOST STACKS WINS"; }
  protected SoloStars(score: number) { return score >= SoloStarsAt[2] ? 3 : score >= SoloStarsAt[1] ? 2 : score >= SoloStarsAt[0] ? 1 : 0; }

  // ------------------------------------------------------------------ build

  protected BuildWorld() {
    const r = this.root;
    this.sky = CasualLook.cover(r, CasualArt.gradient(Pal.hex(0x4aa0ff), Pal.hex(0xffe2b0), Pal.hex(0xfff1c8).withAlpha(0.6)), -900);
    for (let i = 0; i < 12; i++) {
      const h = Art.spr(r, "House", LagoriArt.House(i % 8, Math.floor(i / 8)), Color.white, 4.3, -800 + (i % 2), Art.Flat);
      this.houses.push(h);
    }
    for (let i = 0; i < 3; i++) {
      const line = Art.line(r, "Bunting", Pal.hex(0x5a3a2a), 0.05, -780, false, true, Art.Flat);
      const flags: SpriteRenderer[] = [];
      for (let k = 0; k < 9; k++) flags.push(Art.spr(r, "Flag", LagoriArt.Flag(), StoneCols[(k + i) % 7], 0.42, -779, Art.Flat));
      this.bunting.push({ line, flags, a: V2.zero, b: V2.zero });
    }
    this.banner = Art.spr(r, "Banner", Art.RoundSquare, this.BrandColor, 1, -770, Art.Flat);
    this.brandText = child(this.root, "BannerText", new TextMesh());
    this.brandText.sortingOrder = -769;
    this.street = Art.spr(r, "Street", CasualArt.hd(LagoriArt.Street()), Color.white, 1, -700, Art.Flat);
    for (let i = 0; i < 14; i++) {
      const n = new Neighbour();
      n.look = (i * 5 + 2) % 15;
      n.seed = i * 1.37;
      n.flip = i % 2 === 0;
      n.sr = Art.spr(r, "Neighbour", LagoriArt.Person(0, n.look), Color.white, 1, -690 + (i % 3), Art.Flat);
      this.neighbours.push(n);
    }
    this.divider = Art.line(r, "Divider", Color.white.withAlpha(0.75), 0.14, -650, false, true, Art.Flat);
    for (let i = 0; i < 2; i++) this.lanes.push(this.MakeLane(i));
  }

  private MakeLane(idx: number) {
    const l = new Lane();
    l.idx = idx;
    const r = this.root;
    l.chalk = Art.spr(r, "Chalk", LagoriArt.Chalk(), Color.white, 7, -640, Art.Flat);
    l.label = child(r, "LaneLabel", new TextMesh());
    l.label.sortingOrder = -639;
    l.ring = Art.spr(r, "NextGlow", Art.Glow, Gold, 4, 150, Art.Additive);
    for (let i = 0; i < 7; i++) {
      const s = new Stone();
      s.i = i;
      s.shadow = Art.spr(r, "Shadow", CasualArt.Soft, new Color(0.1, 0.05, 0, 0.4), 1, 160, Art.Flat);
      s.sr = Art.spr(r, "Stone", LagoriArt.Stone(i), Color.white, StoneW(i), 200, Art.Flat);
      l.stones.push(s);
    }
    l.tagger = Art.spr(r, "Tagger", LagoriArt.Person(0, 100 + idx * 2), Color.white, 1.5, 190, Art.Flat);
    l.tagName = child(r, "TaggerName", new TextMesh());
    l.tagName.sortingOrder = 474;
    l.tagShadow = Art.spr(r, "TagShadow", CasualArt.Soft, new Color(0.1, 0.05, 0, 0.35), 1, 455, Art.Flat);
    l.tagSr = Art.spr(r, "TagBall", LagoriArt.TagBall(), Color.white, 1.1, 460, Art.Flat);
    l.arrow = Art.spr(r, "Arrow", Art.Chevron, Gold, 1.2, 470, Art.Flat);
    l.badge = Art.spr(r, "Badge", LagoriArt.Badge(), Color.white, 1.15, 471, Art.Flat);
    l.badgeText = child(r, "BadgeText", new TextMesh());
    l.badgeText.sortingOrder = 472;
    l.hint = child(r, "Hint", new TextMesh());
    l.hint.sortingOrder = 473;
    return l;
  }

  private EnsureSounds() {
    if (this.clackClip) return;
    const rnd = new SysRandom(9);
    const n = () => rnd.nextDouble() * 2 - 1;
    this.clackClip = Sfx.make("lg-clack", 0.3, (t) => {
      const knock = Sfx.sinP(Sfx.glide(t, 1250, 900, 0.05)) * Sfx.env(t, 0.001, 0.05) * 0.6 + Sfx.sinP(2600 * t) * Sfx.env(t, 0.001, 0.025) * 0.3;
      return knock + n() * Sfx.env(t, 0.0005, 0.02) * 0.4 + Sfx.sinP(Sfx.glide(t, 180, 90, 0.1)) * Sfx.env(t, 0.002, 0.12) * 0.5;
    });
    this.crashClip = Sfx.make("lg-crash", 0.9, (t) => {
      let v = 0;
      for (let k = 0; k < 7; k++) { const tt = t - k * 0.045 - (k % 2) * 0.02; if (tt > 0) v += Sfx.sinP(Sfx.glide(tt, 1100 - k * 70, 700 - k * 40, 0.05)) * Sfx.env(tt, 0.001, 0.06) * 0.35; }
      return v + n() * Sfx.env(t, 0.002, 0.25) * 0.5 + Sfx.sinP(Sfx.glide(t, 120, 50, 0.3)) * Sfx.env(t, 0.003, 0.3) * 0.6;
    });
    this.swatClip = Sfx.make("lg-swat", 0.45, (t) => Sfx.sinP(Sfx.glide(t, 400, 1400, 0.25)) * Sfx.env(t, 0.003, 0.3) * 0.4 + n() * Sfx.env(t, 0.001, 0.05) * 0.5);
    this.denyClip = Sfx.make("lg-deny", 0.3, (t) => Sfx.sqrP(Sfx.glide(t, 220, 160, 0.2)) * Sfx.env(t, 0.005, 0.2) * 0.25);
  }

  // ------------------------------------------------------------------ layout

  protected LayoutWorld() {
    const V = this.ViewSize;
    CasualLook.fitCover(this.sky, V);
    // houses along the back of the street
    const hw = 4.3, n = Math.ceil(V.x / (hw - 0.05)) + 1;
    const x0 = -n * (hw - 0.05) / 2 + hw / 2;
    this.houses.forEach((h, i) => {
      const on = i < n;
      h.gameObject.setActive(on);
      if (!on) return;
      const tall = 1 + ((i * 7) % 3) * 0.08;
      h.transform.localScale = new V3(hw, hw * tall, 1);
      h.transform.localPosition = new V3(x0 + i * (hw - 0.05), GY1 + 0.25 + hw * 1.3 * tall / 2 - 0.15, 0);
    });
    // bunting between houses
    this.bunting.forEach((b, k) => {
      const xa = -12 + k * 9, xb = xa + 9;
      b.a = new V2(xa, 5.7 - (k % 2) * 0.4);
      b.b = new V2(xb, 5.7 - ((k + 1) % 2) * 0.4);
    });
    // street
    const top = GY1 + 0.6, bottom = -V.y / 2 - 0.5;
    this.street.transform.localScale = new V3(V.x + 1, (top - bottom) / 0.375, 1);
    this.street.transform.localPosition = new V3(0, (top + bottom) / 2, 0);
    // neighbours in front of the houses
    this.neighbours.forEach((p, i) => {
      const x = -V.x / 2 + 1.2 + (i + 0.5) * ((V.x - 2.4) / this.neighbours.length) + Math.sin(i * 2.1) * 0.4;
      p.base = new V2(x, GY1 + 0.15 + (i % 2) * 0.25);
      p.size = 1.12 + (i % 3) * 0.07;
    });
    this.LayoutLanes();
  }

  private LayoutLanes() {
    const split = this.mode !== WMode.Solo || this.demo;
    this.lanes.forEach((l, i) => {
      if (split) { l.L = i === 0 ? -15.6 : 0.6; l.R = i === 0 ? -0.6 : 15.6; l.cx = i === 0 ? -8 : 8; }
      else { l.L = -15.4; l.R = 15.4; l.cx = 0; }
      l.tagFlip = split ? i === 0 : false;
      l.tagX = split ? (i === 0 ? l.L + 2.6 : l.R - 2.6) : 11.5;
      const on = split || i === 0;
      l.chalk.gameObject.setActive(on);
      l.chalk.transform.localPosition = new V3(l.cx, gy(PileZ), 0);
      l.chalk.transform.localScale = new V3(7.4 * sc(PileZ), 7.4 * sc(PileZ), 1);
      l.label.text = on && split ? (this.demo ? `CPU ${i + 1}` : this.mode === WMode.Vs ? (i === 0 ? "YOU" : "COMPUTER") : `PLAYER ${i + 1}`) : "";
      l.label.color = (i === 0 ? P1Col : P2Col).withAlpha(0.85);
      l.label.fontSize = 64; l.label.characterSize = 0.9 * 10 / 64;
      l.label.transform.localPosition = new V3(l.cx, -8.35, 0);
    });
    this.divider.positionCount = split ? 2 : 0;
    if (split) this.divider.setPositions([new V2(0, gy(-0.2)), new V2(0, gy(1.02))]);
  }

  // ------------------------------------------------------------------ round

  protected SetupRound() {
    this.EnsureSounds();
    this.LayoutLanes();
    const split = this.mode !== WMode.Solo || this.demo;
    this.lanes.forEach((l, i) => {
      const on = split || i === 0;
      l.phase = "knock"; l.pauseT = 0; l.next = 0; l.placed = 7; l.stacks = 0; l.points = 0; l.stonesHome = 0; l.swats = 0; l.throws = 0; l.hits = 0; l.knocks = 0;
      l.wobble = 0; l.tag = "none"; l.tagStone = null; l.pose = 0; l.poseT = 0;
      l.tagT = 5 + Math.random() * 3;
      for (const s of l.stones) {
        s.state = "pile"; s.blockT = 0; s.flash = 0; s.rot = 0;
        s.sr.gameObject.setActive(on); s.shadow.gameObject.setActive(on);
      }
      this.StackPile(l);
      for (const g of [l.tagger, l.tagSr, l.tagShadow, l.arrow, l.badge, l.ring]) g.gameObject.setActive(on);
      l.badgeText.text = ""; l.hint.text = "";
      l.tagSr.gameObject.setActive(false); l.tagShadow.gameObject.setActive(false);
    });
    this.crowdT = 0;
    this.banner.color = this.BrandColor;
    this.brandText.text = `★ ${this.BrandName} STREET GAMES ★`;
  }

  private StackPile(l: Lane) {
    for (const s of l.stones) { s.state = "pile"; s.x = l.cx; s.z = PileZ; s.h = s.i * StoneT * 0.9; s.vx = s.vz = s.vh = 0; s.rot = 0; s.vrot = 0; }
    l.placed = 7; l.next = 0;
  }

  // ------------------------------------------------------------------ input

  private LaneAt(p: V2) { return this.mode === WMode.Solo && !this.demo ? this.lanes[0] : this.lanes[p.x < 0 ? 0 : 1]; }

  protected OnBall(b: Ball) {
    const l = this.LaneAt(b.world);
    // in 2-player / vs each thrower plays their own half
    if (this.mode !== WMode.Solo || this.demo) { if (l.idx !== b.who) return; }
    l.throws++;
    const p = b.world;
    const col = this.PlayerColor(b.who);
    // swat a tag ball in the air
    if (l.tag === "fly" && V2.distance(p, l.tagP) < 1.5) {
      l.tag = "gone"; l.tagLife = 1.2; l.tagVel = new V2((p.x < l.tagP.x ? 1 : -1) * 9, 14);
      l.swats++; l.hits++;
      this.Score(l, 150, l.tagP, "SWAT! +150", col);
      Sfx.playClip(this.swatClip, 0.9);
      this.fx.pop(l.tagP, Pal.hex(0xff3d6e), 16, 7, 0.3, 0.6);
      this.Fx.shake(0.25);
      this.crowdT = Math.max(this.crowdT, 1.2);
      return;
    }
    if (l.phase === "knock") {
      const top = this.PileTop(l), base = gy(PileZ);
      const half = StoneW(0) * sc(PileZ) / 2 + 1.0;
      if (Math.abs(p.x - l.cx) < half && p.y > base - 1.1 && p.y < top + 1.2) { l.hits++; this.Knock(l, p, col); }
      return;
    }
    if (l.phase !== "rebuild") return;
    // the stone under the ball: the one asked for first, else any resting stone
    const want = l.stones[l.next];
    const hitWant = want && want.state === "rest" && this.HitsStone(want, p, 0.75);
    if (hitWant) {
      if (want.blockT > 0) { this.UI.Float(this.StonePos(want).add(new V2(0, 1.2)), "BLOCKED!", Bad, 1.6); Sfx.playClip(this.denyClip, 0.8); return; }
      l.hits++;
      this.SendHome(l, want, col);
      return;
    }
    for (const s of l.stones) {
      if (s.state !== "rest" || !this.HitsStone(s, p, 0.35)) continue;
      s.vh = 5; s.state = "fly"; s.vrot = (Math.random() - 0.5) * 300;
      this.UI.Float(this.StonePos(s).add(new V2(0, 1.2)), "LARGEST FIRST!", Pal.hex(0xffe0a0), 1.5);
      Sfx.playClip(this.denyClip, 0.7);
      return;
    }
  }

  private HitsStone(s: Stone, p: V2, pad: number) {
    const c = this.StonePos(s), k = sc(s.z);
    const hw = StoneW(s.i) * k / 2 + pad, hh = Math.max(0.95, StoneT * k / 2 + pad);
    return Math.abs(p.x - c.x) < hw && Math.abs(p.y - c.y) < hh;
  }

  private Score(l: Lane, pts: number, at: V2, text: string, col: Color) {
    l.points += pts;
    this.scores[l.idx] = this.mode === WMode.Solo && !this.demo ? l.points : l.stacks;
    this.UI.Float(at.add(new V2(0, 1)), text, Color.lerp(col, Color.white, 0.3), text.length > 6 ? 1.35 : 1.8);
  }

  private Knock(l: Lane, p: V2, col: Color) {
    l.phase = "rebuild";
    l.next = 0; l.placed = 0; l.knocks++;
    for (const s of l.stones) {
      const rel = (s.x - p.x) + (Math.random() - 0.5) * 2;
      const dir = Math.abs(rel) < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(rel);
      s.state = "fly";
      s.vx = dir * (3 + Math.random() * 7) * (0.7 + s.i * 0.08);
      s.vz = (Math.random() - 0.3) * 0.9;
      s.vh = 4 + Math.random() * 6 + s.i * 0.5;
      s.vrot = (Math.random() - 0.5) * 900;
      s.blockT = 0;
    }
    this.Score(l, 100, new V2(l.cx, this.PileTop(l)), "KNOCKED! +100", col);
    Sfx.playClip(this.crashClip, 1);
    this.Fx.shake(0.55);
    this.Hitstop(0.06);
    this.fx.pop(new V2(l.cx, gy(PileZ) + 1.5), Pal.hex(0xe8c896), 26, 8, 0.45, 0.8);
    this.Fx.ring(new V2(l.cx, gy(PileZ) + 1.5), col, 1, 7, 0.45);
    this.crowdT = Math.max(this.crowdT, 1.5);
    this.Cheer(0.45);
    l.tagT = Math.max(l.tagT, 3.5);
  }

  private SendHome(l: Lane, s: Stone, col: Color) {
    s.state = "home"; s.t = 0; s.fx = s.x; s.fz = s.z; s.fh = s.h;
    s.vrot = 0;
    l.next++;
    const pos = this.StonePos(s);
    this.fx.pop(pos, StoneCols[s.i], 18, 6, 0.32, 0.6);
    this.Fx.ring(pos, col, 0.6, 3.6, 0.35);
    this.Fx.shake(0.18);
    Sfx.playClip(this.clackClip, 0.9, 1.05 + s.i * 0.04);
    this.Score(l, 100, pos, `+100`, col);
  }

  private Arrive(l: Lane, s: Stone) {
    s.state = "pile"; s.x = l.cx; s.z = PileZ; s.h = s.i * StoneT * 0.9; s.rot = 0;
    l.placed++;
    l.stonesHome++;
    l.wobble = 1;
    Sfx.playClip(this.clackClip, 0.8, 0.85 + s.i * 0.05);
    this.fx.sparkle(this.StonePos(s), StoneCols[s.i], 5, 0.8, 0.3);
    if (l.placed >= 7) this.StackDone(l);
  }

  private StackDone(l: Lane) {
    const solo = this.mode === WMode.Solo && !this.demo;
    l.stacks++;
    const col = this.PlayerColor(l.idx);
    const top = new V2(l.cx, this.PileTop(l));
    this.fx.confetti(top, 60, 11, StoneCols);
    this.Fx.shake(0.4);
    this.crowdT = 3;
    this.Cheer(0.9);
    Sfx.play(Snd.Win, 0.7);
    if (solo) {
      this.Score(l, 500, top.add(new V2(0, 0.8)), "STACK! +500", Gold);
      this.Big(Cheers[(l.stacks - 1) % Cheers.length], Gold, 1.4, 200);
      l.phase = "pause"; l.pauseT = 1.3;
      l.tag = l.tag === "none" ? "none" : "gone"; l.tagLife = 0.5; l.tagVel = new V2(0, 8);
      return;
    }
    this.Score(l, 500, top.add(new V2(0, 0.8)), "+500", col);
    this.scores[0] = this.lanes[0].stacks; this.scores[1] = this.lanes[1].stacks;
    this.Big(`${this.PlayerName(l.idx)} WINS THE STACK!`, col, 2, 130);
    // both piles go back up for the next race
    for (const o of this.lanes) {
      o.phase = "pause"; o.pauseT = 2.4;
      if (o.tag !== "none") { o.tag = "gone"; o.tagLife = 0.5; o.tagVel = new V2(0, 8); }
      for (const s of o.stones) s.blockT = 0;
      if (o !== l) {
        let k = 0;
        for (const s of o.stones) if (s.state !== "pile") { s.state = "home"; s.t = -0.12 * k++; s.fx = s.x; s.fz = s.z; s.fh = s.h; }
        o.next = 7;
      }
    }
    this.DelayCpu(0, 2.6); this.DelayCpu(1, 2.6);
  }

  // ------------------------------------------------------------------ computer players

  protected TickCpu(dt: number, who: number, level: number) {
    const l = this.lanes[who];
    if (l.phase !== "knock" && l.phase !== "rebuild") return;
    if (!this.CpuReady(who, dt, [3.0, 2.2, 1.5][level])) return;
    let target: V2;
    if (l.phase === "knock") {
      target = new V2(l.cx + (Math.random() - 0.5) * (level === 0 ? 4.5 : 2.4), gy(PileZ) + 1.2 + Math.random() * 1.6);
    } else {
      const want = l.stones[l.next];
      if (l.tag === "fly" && level > 0 && Math.random() < 0.25 + level * 0.2) target = this.Aim(l.tagP, l.tagVel, level, 0.5);
      else if (!want || want.state !== "rest" || want.blockT > 0.4) { this.DelayCpu(who, 0.35); return; }
      else {
        const c = this.StonePos(want);
        const ok = Math.random() < [0.45, 0.62, 0.8][level];
        if (ok) target = c.add(new V2((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4));
        else { const a = Math.random() * Math.PI * 2, r = StoneW(want.i) * 0.5 + 1 + Math.random() * 1.5; target = c.add(new V2(Math.cos(a) * r, Math.sin(a) * r * 0.6)); }
      }
    }
    target = new V2(Mathf.clamp(target.x, l.L + 0.6, l.R - 0.6), Mathf.clamp(target.y, -8.4, 5.5));
    this.Throw(who, target);
  }

  // ------------------------------------------------------------------ simulation

  protected TickWorld(dt: number) {
    const t = Time.time;
    this.crowdT = Math.max(0, this.crowdT - dt);
    const split = this.mode !== WMode.Solo || this.demo;
    for (const l of this.lanes) {
      const on = split || l.idx === 0;
      if (!on) continue;
      if (l.phase === "pause") {
        l.pauseT -= dt;
        if (l.pauseT <= 0) { this.StackPile(l); l.phase = "knock"; l.tagT = 5 + Math.random() * 3; }
      }
      this.TickStones(l, dt);
      this.TickTagger(l, dt);
      this.DrawLane(l, t);
    }
    // neighbours
    this.neighbours.forEach((p, i) => {
      const cheer = this.crowdT > 0;
      const pose = cheer ? (Math.sin(t * 5 + p.seed) > 0 ? 1 : 4) : (Math.sin(t * 0.6 + p.seed * 3) > 0.93 ? 4 : 0);
      if (pose !== p.pose) { p.pose = pose; p.sr.sprite = LagoriArt.Person(pose, p.look); }
      const hop = cheer ? Math.abs(Math.sin(t * 9 + p.seed)) * 0.35 : 0;
      p.sr.transform.localPosition = new V3(p.base.x, p.base.y + p.size + hop, 0);
      p.sr.transform.localScale = new V3(p.size * (p.flip ? -1 : 1), p.size, 1);
      void i;
    });
    // bunting sways
    for (const b of this.bunting) {
      const pts: V2[] = [];
      for (let k = 0; k <= 10; k++) { const f = k / 10; pts.push(V2.lerp(b.a, b.b, f).add(new V2(0, -Math.sin(f * Math.PI) * 0.8 + Math.sin(t * 1.5 + k) * 0.03))); }
      b.line.setPositions(pts);
      b.flags.forEach((fl, k) => {
        const p = pts[k + 1];
        fl.transform.localPosition = new V3(p.x, p.y - 0.25, 0);
        fl.transform.localEulerZ = Math.sin(t * 2 + k) * 6;
      });
    }
    // brand banner hangs from the middle bunting
    const bb = this.bunting[1];
    const mid = V2.lerp(bb.a, bb.b, 0.5).add(new V2(0, -0.8 - 0.55));
    const bw = Math.min(10, 2.2 + this.brandText.text.length * 0.38);
    this.banner.transform.localPosition = new V3(mid.x, mid.y + Math.sin(t * 1.3) * 0.05, 0);
    this.banner.transform.localScale = new V3(bw, 1.05, 1);
    this.brandText.transform.localPosition = new V3(mid.x, mid.y + Math.sin(t * 1.3) * 0.05, 0);
    this.brandText.fontSize = 64; this.brandText.characterSize = 0.62 * 10 / 64;
    this.brandText.color = Color.white;
  }

  private TickStones(l: Lane, dt: number) {
    for (const s of l.stones) {
      s.blockT = Math.max(0, s.blockT - dt);
      s.flash = Math.max(0, s.flash - dt);
      if (s.state === "fly") this.StepStone(l, s, dt);
      else if (s.state === "home") {
        s.t += dt;
        const k = Mathf.clamp01(s.t / 0.55);
        if (s.t < 0) continue;
        const e = Ease.inOutCubic(k), th = s.i * StoneT * 0.9;
        s.x = Mathf.lerp(s.fx, l.cx, e); s.z = Mathf.lerp(s.fz, PileZ, e);
        s.h = Mathf.lerp(s.fh, th, e) + Math.sin(k * Math.PI) * 4.2;
        s.rot = (1 - e) * 360;
        if (k >= 1) this.Arrive(l, s);
      }
    }
    // resting stones keep apart and out of the home circle so every stone is a clear target
    for (let it = 0; it < 2; it++) {
      for (const a of l.stones) {
        if (a.state !== "rest") continue;
        const ha = StoneW(a.i) / 2;
        if (Math.abs(a.x - l.cx) < 4.2 && Math.abs(a.z - PileZ) < 0.16) a.x += (a.x < l.cx ? -1 : 1) * 4 * dt + (a.x === l.cx ? 0.1 : 0);
        for (const b of l.stones) {
          if (b === a || b.state !== "rest") continue;
          const hb = StoneW(b.i) / 2, dz = Math.abs(a.z - b.z), dx = a.x - b.x, need = (ha + hb) * 0.9;
          if (dz < 0.12 && Math.abs(dx) < need) {
            const push = (need - Math.abs(dx)) * 0.5 * Math.min(1, dt * 8), d = dx === 0 ? 1 : Math.sign(dx);
            a.x += d * push; b.x -= d * push;
          }
        }
        a.x = Mathf.clamp(a.x, l.L + ha + 0.4, l.R - ha - 0.4);
      }
    }
    l.wobble = Math.max(0, l.wobble - dt * 2.5);
  }

  private StepStone(l: Lane, s: Stone, dt0: number) {
    const n = Math.max(1, Math.ceil(dt0 / (1 / 90)));
    const dt = dt0 / n;
    for (let it = 0; it < n && s.state === "fly"; it++) {
        s.vh -= Grav * dt;
        s.x += s.vx * dt; s.z += s.vz * dt; s.h += s.vh * dt;
        s.rot += s.vrot * dt;
        const hw = StoneW(s.i) / 2;
        if (s.x < l.L + hw + 0.4) { s.x = l.L + hw + 0.4; s.vx = Math.abs(s.vx) * 0.5; }
        if (s.x > l.R - hw - 0.4) { s.x = l.R - hw - 0.4; s.vx = -Math.abs(s.vx) * 0.5; }
        if (s.z < 0.04) { s.z = 0.04; s.vz = Math.abs(s.vz) * 0.4; }
        if (s.z > 0.78) { s.z = 0.78; s.vz = -Math.abs(s.vz) * 0.4; }
        if (s.h <= 0) {
          s.h = 0;
          if (s.vh < -9) { s.vh = -s.vh * 0.32; s.vx *= 0.6; s.vz *= 0.6; s.vrot *= 0.5; if (s.vh > 2.5) Sfx.playClip(this.clackClip, 0.25, 0.7 + Math.random() * 0.2); }
          else { s.vh = 0; s.vx *= Math.max(0, 1 - 6 * dt); s.vz *= Math.max(0, 1 - 6 * dt); }
          s.rot = Mathf.lerp(s.rot, Math.round(s.rot / 180) * 180, 1 - Math.exp(-dt * 10));
          if (Math.abs(s.vx) < 0.15 && Math.abs(s.vz) < 0.02 && s.vh === 0) { s.state = "rest"; s.rot = Math.round(s.rot / 180) * 180; }
        }
    }
  }

  private TickTagger(l: Lane, dt: number) {
    const live = this.step === "play" && l.phase === "rebuild";
    l.poseT = Math.max(0, l.poseT - dt);
    const solo = this.mode === WMode.Solo && !this.demo;
    if (live && l.tag === "none") {
      l.tagT -= dt;
      const want = l.stones[l.next];
      if (l.tagT <= 0 && want && want.state === "rest" && l.next < 6) {
        l.tag = "wind"; l.tagLife = 0.6; l.tagStone = want; l.pose = 2;
      }
    }
    const hand = new V2(l.tagX + (l.tagFlip ? 0.5 : -0.5), gy(l.tagZ) + 2.6);
    switch (l.tag) {
      case "wind":
        l.tagLife -= dt;
        l.tagP = hand.add(new V2(l.tagFlip ? -0.4 : 0.4, 0.4));
        if (l.tagLife <= 0) {
          const s = l.tagStone!;
          if (s.state !== "rest") { l.tag = "none"; l.pose = 0; l.tagT = 1.5; break; }
          l.tag = "fly"; l.tagK = 0; l.tagFrom = hand; l.tagTo = this.StonePos(s).add(new V2(0, StoneT * sc(s.z) * 0.5 + 0.45)); l.pose = 3; l.poseT = 0.5;
          Sfx.play(Snd.Whoosh, 0.6);
        }
        break;
      case "fly": {
        const dur = 1.35;
        const prev = l.tagP;
        l.tagK += dt / dur;
        const k = Mathf.clamp01(l.tagK);
        l.tagP = V2.lerp(l.tagFrom, l.tagTo, k).add(new V2(0, Math.sin(k * Math.PI) * 4.5));
        l.tagVel = dt > 0 ? l.tagP.sub(prev).div(dt) : V2.zero;
        if (k >= 1) {
          const s = l.tagStone!;
          if (s.state === "rest") { s.blockT = 3; l.tag = "sit"; l.tagLife = 3; Sfx.play(Snd.Hit, 0.6); this.UI.Float(l.tagP.add(new V2(0, 0.6)), "TAGGED!", Pal.hex(0xff7aa0), 1.4); }
          else { l.tag = "gone"; l.tagLife = 0.8; l.tagVel = new V2(l.tagFlip ? 4 : -4, 6); }
        }
        break;
      }
      case "sit": {
        l.tagLife -= dt;
        const s = l.tagStone!;
        l.tagP = this.StonePos(s).add(new V2(0, StoneT * sc(s.z) * 0.5 + 0.45 + Math.abs(Math.sin(Time.time * 6)) * 0.12));
        if (l.tagLife <= 0 || s.state !== "rest") { s.blockT = 0; l.tag = "gone"; l.tagLife = 0.8; l.tagVel = new V2(l.tagFlip ? -5 : 5, 7); }
        break;
      }
      case "gone":
        l.tagLife -= dt;
        l.tagVel = l.tagVel.add(new V2(0, -Grav * 0.6 * dt));
        l.tagP = l.tagP.add(l.tagVel.mul(dt));
        if (l.tagLife <= 0) { l.tag = "none"; l.pose = 0; l.tagT = solo ? Mathf.lerp(9, 4.5, 1 - this.timeLeft / RoundTime) : 7 + Math.random() * 3; }
        break;
    }
    if (l.tag !== "wind" && l.poseT <= 0 && l.pose !== 0) l.pose = 0;
  }

  // ------------------------------------------------------------------ drawing

  private StonePos(s: Stone) { const k = sc(s.z); return new V2(s.x, gy(s.z) + (s.h + StoneT / 2) * k); }
  private PileTop(_l: Lane) { return gy(PileZ) + 7 * StoneT * 0.9 * sc(PileZ); }

  private DrawLane(l: Lane, t: number) {
    for (const s of l.stones) {
      const k = sc(s.z);
      let p = this.StonePos(s);
      if (s.state === "pile" && l.wobble > 0) p = p.add(new V2(Math.sin(t * 40 + s.i) * 0.05 * l.wobble * s.i, 0));
      s.sr.transform.localPosition = new V3(p.x, p.y, 0);
      const w = StoneW(s.i) * k;
      s.sr.transform.localScale = new V3(w, w, 1);
      s.sr.transform.localEulerZ = s.state === "pile" ? 0 : s.rot;
      s.sr.sortingOrder = 200 + Math.round((1 - s.z) * 30) * 8 + s.i;
      s.sr.color = s.blockT > 0 ? Color.lerp(Color.white, Pal.hex(0xff9ab8), 0.4 + 0.2 * Math.sin(t * 12)) : Color.white;
      const gh = Mathf.clamp01(1 - s.h / 6);
      s.shadow.transform.localPosition = new V3(s.x, gy(s.z) + 0.05, 0);
      s.shadow.transform.localScale = new V3(w * 1.25 * (0.6 + 0.4 * gh), 0.7 * k * (0.6 + 0.4 * gh), 1);
      s.shadow.color = new Color(0.12, 0.06, 0, 0.35 * gh);
      s.shadow.sortingOrder = 160 + Math.round((1 - s.z) * 30);
      s.shadow.gameObject.setActive(s.state !== "pile" || s.i === 0);
    }
    // the stone to hit next
    const want = l.phase === "rebuild" ? l.stones[l.next] : null;
    const show = !!want && want.state === "rest" && this.step !== "idle";
    const col = this.PlayerColor(l.idx);
    l.ring.gameObject.setActive(show);
    l.arrow.gameObject.setActive(show || (l.phase === "knock" && this.step !== "idle"));
    l.badge.gameObject.setActive(show);
    l.badgeText.text = show ? String(want!.i + 1) : "";
    if (show) {
      const p = this.StonePos(want!), k = sc(want!.z);
      const pulse = 1 + 0.12 * Math.sin(t * 8);
      l.ring.transform.localPosition = new V3(p.x, p.y, 0);
      l.ring.transform.localScale = new V3(StoneW(want!.i) * k * 2 * pulse, 2.2 * pulse, 1);
      l.ring.color = (want!.blockT > 0 ? Bad : col).withAlpha(0.7);
      const ay = p.y + 1.9 + Math.abs(Math.sin(t * 5)) * 0.45;
      l.arrow.transform.localPosition = new V3(p.x, ay + 0.9, 0);
      l.arrow.transform.localEulerZ = -90;
      l.arrow.color = col;
      l.badge.transform.localPosition = new V3(p.x, ay - 0.15, 0);
      l.badgeText.transform.localPosition = new V3(p.x, ay - 0.15, 0);
      l.badgeText.fontSize = 64; l.badgeText.characterSize = 0.8 * 10 / 64; l.badgeText.color = Pal.hex(0x1d1030);
    } else if (l.phase === "knock" && this.step !== "idle") {
      const ay = this.PileTop(l) + 1.1 + Math.abs(Math.sin(t * 5)) * 0.45;
      l.arrow.transform.localPosition = new V3(l.cx, ay, 0);
      l.arrow.transform.localEulerZ = -90;
      l.arrow.color = col;
    }
    l.hint.text = l.phase === "knock" && this.step === "play" ? "KNOCK IT DOWN!" : "";
    if (l.hint.text) {
      l.hint.transform.localPosition = new V3(l.cx, this.PileTop(l) + 2.6 + Math.sin(t * 3) * 0.1, 0);
      l.hint.fontSize = 64; l.hint.characterSize = 0.85 * 10 / 64; l.hint.color = Color.lerp(col, Color.white, 0.5 + 0.3 * Math.sin(t * 6));
    }
    // tagger and tag ball
    const tk = sc(l.tagZ), size = 1.9 * tk;
    l.tagger.sprite = LagoriArt.Person(l.pose === 2 ? 2 : l.pose === 3 ? 3 : (this.crowdT > 0 && Math.sin(t * 5) > 0 ? 1 : 0), 100 + l.idx * 2);
    l.tagger.transform.localPosition = new V3(l.tagX, gy(l.tagZ) + size, 0);
    l.tagger.transform.localScale = new V3(size * (l.tagFlip ? -1 : 1), size, 1);
    l.tagName.text = this.step === "idle" ? "" : "TAGGER";
    l.tagName.fontSize = 64; l.tagName.characterSize = 0.65 * 10 / 64; l.tagName.color = Pal.hex(0xffe0ea);
    l.tagName.transform.localPosition = new V3(l.tagX, gy(l.tagZ) + size * 2 + 0.45, 0);
    const ball = l.tag !== "none";
    l.tagSr.gameObject.setActive(ball);
    l.tagShadow.gameObject.setActive(l.tag === "fly" || l.tag === "sit");
    if (ball) {
      l.tagSr.transform.localPosition = new V3(l.tagP.x, l.tagP.y, 0);
      const bs = l.tag === "fly" ? 1.25 : 1.05;
      l.tagSr.transform.localScale = new V3(bs, bs, 1);
      l.tagSr.transform.localEulerZ = t * 400;
      l.tagSr.color = Color.white.withAlpha(l.tag === "gone" ? Mathf.clamp01(l.tagLife * 2) : 1);
      if (l.tag === "fly") {
        const gz = Mathf.lerp(l.tagZ, l.tagStone ? l.tagStone.z : PileZ, l.tagK);
        l.tagShadow.transform.localPosition = new V3(l.tagP.x, gy(gz), 0);
        l.tagShadow.transform.localScale = new V3(1.2, 0.4, 1);
        if (Math.random() < 0.5) this.fx.emit(l.tagP, V2.zero, Pal.hex(0xff8ab0), 0.35, 0.3, null, 0, 0, true, 2);
      }
    } else if (l.tag === "none" && this.step === "play" && l.phase === "rebuild") {
      // the ball waits in the tagger's hand
      l.tagSr.gameObject.setActive(true);
      const hand = new V2(l.tagX + (l.tagFlip ? 0.45 : -0.45), gy(l.tagZ) + size * 0.75);
      l.tagSr.transform.localPosition = new V3(hand.x, hand.y, 0);
      l.tagSr.transform.localScale = new V3(0.8, 0.8, 1);
      l.tagSr.color = Color.white;
    }
  }

  // ------------------------------------------------------------------ HUD / results

  protected ScoreCaption() { return "SCORE"; }
  protected PanelValue(i: number) { return this.mode === WMode.Solo && !this.demo ? Fmt.n(this.lanes[0].points) : String(this.lanes[i].stacks); }
  protected PanelSub(i: number) {
    const l = this.lanes[i];
    if (this.mode === WMode.Solo && !this.demo) return `STACKS ${l.stacks}`;
    return `STACKS · ${l.phase === "knock" ? "KNOCK!" : `${l.placed}/7`}`;
  }
  protected CardSub(i: number) { return `STACKS · ${Fmt.n(this.lanes[i].points)} PTS`; }
  protected Winner() {
    const [a, b] = this.lanes;
    if (a.stacks !== b.stacks) return a.stacks > b.stacks ? 0 : 1;
    if (a.placed !== b.placed && a.phase !== "knock" && b.phase !== "knock") return a.placed > b.placed ? 0 : 1;
    if (a.points !== b.points) return a.points > b.points ? 0 : 1;
    return -1;
  }
  protected BoardScore(i: number) { return this.lanes[i].points; }
  protected ResultValue() { return `${this.lanes[0].stacks} – ${this.lanes[1].stacks}`; }
  protected ResultStats(): [string, string][] {
    const [a, b] = this.lanes;
    const acc = (l: Lane) => (l.throws ? `${Math.round((l.hits / l.throws) * 100)}%` : "–");
    if (this.mode === WMode.Solo) return [["STACKS REBUILT", String(a.stacks)], ["STONES STACKED", String(a.stonesHome)], ["TAG BALLS SWATTED", String(a.swats)], ["ACCURACY", acc(a)]];
    return [["STACKS", `${a.stacks} – ${b.stacks}`], ["POINTS", `${Fmt.n(a.points)} – ${Fmt.n(b.points)}`], ["STONES STACKED", `${a.stonesHome} – ${b.stonesHome}`], ["SWATS", `${a.swats} – ${b.swats}`]];
  }

  /** Test hook: targets in CSS pixels. */
  get debugInfo() {
    return {
      state: this.State, step: this.step, mode: this.mode, demo: this.demo, timeLeft: this.timeLeft, scores: this.scores,
      lanes: this.lanes.map((l) => ({
        phase: l.phase, next: l.next, placed: l.placed, stacks: l.stacks, points: l.points, tag: l.tag,
        tagCss: this.Css(l.tagP), pile: this.Css(new V2(l.cx, gy(PileZ) + 1.6)),
        stones: l.stones.map((s) => ({ i: s.i, state: s.state, block: s.blockT, css: this.Css(this.StonePos(s)) })),
      })),
    };
  }
}

