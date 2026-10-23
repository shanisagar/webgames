import {
  Art, AudioClip, CasualArt, CasualLook, child, Color, GameInfo, howTo, Mathf, Pal, Sfx, SpriteRenderer, SysRandom,
  TextMesh, Time, V2, V3,
} from "../../kit";
import { DuckArt, GoldLook } from "./DuckArt";
import { Ball, Gold, P1Col, P2Col, WallGame, WMode } from "./WallCore";

/**
 * DUCK SHOOT for the LiDAR wall: the fairground duck shoot, played with a ball. A flock of cartoon ducks flies across
 * the marsh behind the booth in patterns (lines, waves, V formations, loops, pop-ups from the reeds); hit a duck to
 * score. The golden duck is worth 5. Ollie the otter cheers from the reeds. SOLO: as many as you can in 1:30. VS
 * COMPUTER: a virtual hunter throws orange balls at the same ducks. 2 PLAYERS: shared wall, player 1 throws on the
 * left half and player 2 on the right; a duck scores for whoever hits it first (cyan / orange bursts).
 */

const RoundTime = 90;
const FlyMin = -3.9, FlyMax = 5.4;
const SoloStarsAt = [12, 25, 40];
const Praise = ["NICE!", "GREAT!", "WOW!", "QUACK-TASTIC!", "BULLSEYE!", "SUPER!"];

type Pattern = "line" | "wave" | "vee" | "loop" | "pop" | "zig";
type DState = "fly" | "hit" | "fall" | "gone";

class Duck {
  look = 0; pattern: Pattern = "line"; state: DState = "gone";
  t = 0; p0 = V2.zero; vel = V2.zero; amp = 0; freq = 0; ph = 0; dir = 1;
  pos = V2.zero; prev = V2.zero; v = V2.zero; rot = 0; vrot = 0; fallV = V2.zero; hitT = 0; by = -1; size = 2.7;
  sr!: SpriteRenderer; glow!: SpriteRenderer; shadow!: SpriteRenderer;
  get gold() { return this.look === GoldLook; }
}

export class DuckGame extends WallGame {
  private ducks: Duck[] = [];
  private sky!: SpriteRenderer;
  private hills!: SpriteRenderer;
  private wheel!: SpriteRenderer;
  private cabins: SpriteRenderer[] = [];
  private stand!: SpriteRenderer;
  private tents: SpriteRenderer[] = [];
  private backReeds: SpriteRenderer[] = [];
  private frontReeds: SpriteRenderer[] = [];
  private water!: SpriteRenderer;
  private awning: SpriteRenderer[] = [];
  private posts: SpriteRenderer[] = [];
  private bulbs: SpriteRenderer[] = [];
  private brandBoard!: SpriteRenderer;
  private brandText!: TextMesh;
  private brandPosts: SpriteRenderer[] = [];
  private otter!: SpriteRenderer;
  private sign!: SpriteRenderer;
  private signText!: TextMesh;
  private zoneLabels: TextMesh[] = [];
  private divider!: SpriteRenderer;
  private otterPose = 0;
  private otterT = 0;
  private otterUp = 0;
  private flashT = 0;
  private waveT = 1;
  private goldT = 14;
  private elapsed = 0;
  private hits = [0, 0];
  private golds = [0, 0];
  private throws = [0, 0];
  private streak = [0, 0];
  private bestStreak = [0, 0];
  private rng = new SysRandom(1);

  private quackClip!: AudioClip;
  private splashClip!: AudioClip;
  private goldClip!: AudioClip;
  private flapClip!: AudioClip;

  protected BrandWord = "DUCK SHOOT";

  protected Describe() {
    return new GameInfo({
      Id: "wallducks",
      Title: "DUCK SHOOT",
      Tagline: "THE FAIRGROUND DUCK SHOOT. BRING YOUR BEST ARM!",
      PlayLabel: "PLAY",
      Accent: Pal.hex(0x2fd06a),
      Accent2: Gold,
      BgTop: Pal.hex(0x5ab8ff),
      BgBottom: Pal.hex(0xbfe8ff),
      ShortSide: 18,
      Music: { bpm: 126, rootHz: 174.6, degrees: [0, 3, 4, 4], seed: 77, energy: 0.85, major: true },
      HowTo: [
        howTo(DuckArt.Duck(0, 0), Color.white, "Ducks fly across the marsh in lines, waves, V shapes and loops. THROW a ball at a duck to hit it: +1."),
        howTo(DuckArt.Duck(GoldLook, 0), Color.white, "The GOLDEN DUCK is fast and worth 5!"),
        howTo(DuckArt.Otter(1), Color.white, "Ollie the otter cheers your best shots from the reeds."),
        howTo(Art.Star, Gold, "SOLO: hit as many ducks as you can in 1:30."),
        howTo(Art.Chevron, P2Col, "VS COMPUTER: a virtual hunter throws orange balls at the same ducks. 2 PLAYERS: player 1 throws on the left half, player 2 on the right; each duck scores for whoever hits it first."),
        howTo(Art.Ring, Color.white, "Operator: SPACE / ENTER start, ESC pause, R back to title."),
      ],
      Tips: ["Throw where the duck is going, not where it is.", "Golden ducks are worth 5!"],
    });
  }

  protected RoundLength() { return RoundTime; }
  protected QuickRules() { return ["1. THROW a ball at a flying duck: +1.", "2. The GOLDEN DUCK is worth 5!", "3. Lead your throw: aim where the duck is going."]; }
  protected ModeLine(m: WMode) { return m === WMode.Solo ? "1:30 · HIT AS MANY DUCKS AS YOU CAN" : "1:30 · P1 LEFT HALF · P2 RIGHT HALF · FIRST HIT SCORES"; }
  protected SoloStars(score: number) { return score >= SoloStarsAt[2] ? 3 : score >= SoloStarsAt[1] ? 2 : score >= SoloStarsAt[0] ? 1 : 0; }
  protected ScoreCaption() { return "DUCKS"; }

  // ------------------------------------------------------------------ build

  protected BuildWorld() {
    const r = this.root;
    this.sky = CasualLook.cover(r, CasualArt.gradient(Pal.hex(0x3d9cff), Pal.hex(0xd8f2ff), Pal.hex(0xfff6d0).withAlpha(0.7)), -900);
    this.hills = Art.spr(r, "Hills", CasualArt.hd(DuckArt.Hills()), Color.white, 1, -880, Art.Flat);
    this.stand = Art.spr(r, "WheelStand", DuckArt.Stand(), Color.white, 1, -872, Art.Flat);
    this.wheel = Art.spr(r, "Wheel", DuckArt.Wheel(), Pal.hex(0x8a7aa8), 1, -871, Art.Flat);
    const cabCols = [0xff5a5f, 0xffc93c, 0x3d8bff, 0x4ee08a, 0xb45cff, 0xff8a3d];
    for (let i = 0; i < 12; i++) this.cabins.push(Art.spr(r, "Cabin", DuckArt.Cabin(), Pal.hex(cabCols[i % cabCols.length]), 0.9, -870, Art.Flat));
    for (let i = 0; i < 4; i++) this.tents.push(Art.spr(r, "Tent", DuckArt.Tent(i), Color.white, 4.4, -865 + i, Art.Flat));
    this.brandBoard = Art.spr(r, "BrandBoard", Art.RoundSquare, this.BrandColor, 1, -860, Art.Flat);
    for (let i = 0; i < 2; i++) this.brandPosts.push(Art.spr(r, "BrandPost", Art.Square, Pal.hex(0x7a4a2a), 1, -861, Art.Flat));
    this.brandText = child(r, "BrandText", new TextMesh());
    this.brandText.sortingOrder = -859;
    for (let i = 0; i < 4; i++) this.backReeds.push(Art.spr(r, "ReedsBack", DuckArt.Reeds(0), Color.white, 1, -500, Art.Flat));
    this.water = Art.spr(r, "Water", DuckArt.Water(), Color.white, 1, -520, Art.Flat);
    for (let i = 0; i < 4; i++) this.frontReeds.push(Art.spr(r, "ReedsFront", DuckArt.Reeds(1), Color.white, 1, 300, Art.Flat));
    this.otter = Art.spr(r, "Ollie", DuckArt.Otter(0), Color.white, 2.6, 290, Art.Flat);
    this.sign = Art.spr(r, "Sign", DuckArt.Sign(), Color.white, 3.6, 291, Art.Flat);
    this.signText = child(r, "SignText", new TextMesh());
    this.signText.sortingOrder = 292;
    for (let i = 0; i < 6; i++) this.awning.push(Art.spr(r, "Awning", DuckArt.Awning(), Color.white, 1, 500, Art.Flat));
    for (let i = 0; i < 2; i++) this.posts.push(Art.spr(r, "Post", DuckArt.Post(), Color.white, 1, 499, Art.Flat));
    for (let i = 0; i < 22; i++) this.bulbs.push(Art.spr(r, "Bulb", Art.Disc, Pal.hex(0xfff2b0), 0.32, 502, Art.Flat));
    this.divider = Art.spr(r, "Divider", Art.Square, Color.white.withAlpha(0.18), 1, 120, Art.Flat);
    for (let i = 0; i < 2; i++) { const t = child(r, "Zone", new TextMesh()); t.sortingOrder = 310; this.zoneLabels.push(t); }
    for (let i = 0; i < 16; i++) {
      const d = new Duck();
      d.shadow = Art.spr(r, "DuckGlow", Art.Glow, Gold.withAlpha(0.5), 5, 140, Art.Additive);
      d.glow = Art.spr(r, "DuckRing", Art.Ring, Color.white, 3.2, 141, Art.Flat);
      d.sr = Art.spr(r, "Duck", DuckArt.Duck(0, 0), Color.white, d.size, 150 + i, Art.Flat);
      for (const g of [d.sr, d.glow, d.shadow]) g.gameObject.setActive(false);
      this.ducks.push(d);
    }
    this.BuildSounds();
  }

  private BuildSounds() {
    const rnd = new SysRandom(13);
    const n = () => rnd.nextDouble() * 2 - 1;
    let lp = 0;
    this.quackClip = Sfx.make("dk-quack", 0.42, (t) => {
      let v = 0;
      for (const [st, f0] of [[0, 620], [0.2, 560]] as [number, number][]) {
        const tt = t - st;
        if (tt <= 0 || tt > 0.17) continue;
        const f = Sfx.glide(tt, f0, f0 * 0.62, 0.15);
        const raw = Sfx.sawP(f) * 0.6 + Sfx.sqrP(f * 0.5) * 0.25 + n() * 0.15;
        lp += (raw - lp) * 0.35;
        v += lp * Sfx.env(tt, 0.01, 0.14) * (0.7 + 0.3 * Sfx.sinP(tt * 70));
      }
      return v * 0.9;
    });
    let a = 0;
    this.splashClip = Sfx.make("dk-splash", 0.6, (t) => { a += (n() - a) * (0.5 - t * 0.6); return a * Sfx.env(t, 0.004, 0.35) * 0.9 + Sfx.sinP(Sfx.glide(t, 300, 90, 0.2)) * Sfx.env(t, 0.002, 0.12) * 0.4; });
    this.goldClip = Sfx.make("dk-gold", 1.1, (t) => {
      let v = 0;
      [1047, 1319, 1568, 2093, 2637].forEach((f, i) => { const tt = t - i * 0.07; if (tt > 0) v += (Sfx.sinP(f * tt) + 0.3 * Sfx.sinP(f * 2.76 * tt)) * Sfx.env(tt, 0.003, 0.6) * 0.14; });
      return v;
    });
    let b = 0;
    this.flapClip = Sfx.make("dk-flap", 0.35, (t) => { b += (n() - b) * 0.2; return b * (Math.max(0, Math.sin(t * 60)) ** 2) * Sfx.env(t, 0.01, 0.3) * 0.8; });
  }

  // ------------------------------------------------------------------ layout

  protected LayoutWorld() {
    const V = this.ViewSize, W2 = V.x / 2, H2 = V.y / 2;
    CasualLook.fitCover(this.sky, V);
    const hw = V.x + 2;
    this.hills.transform.localScale = new V3(hw, hw, 1);
    this.hills.transform.localPosition = new V3(0, -2.6 + hw * 0.25 * 0.4, 0);
    // Ferris wheel (right) and tents (left) on the far bank
    this.wheel.transform.localPosition = new V3(10.5, 2.0, 0);
    this.wheel.transform.localScale = new V3(8.6, 8.6, 1);
    this.stand.transform.localPosition = new V3(10.5, -1.0, 0);
    this.stand.transform.localScale = new V3(6.5, 6.5, 1);
    this.tents.forEach((t, i) => {
      const x = [-13, -8.6, -4.6, 3.6][i], s = [4.6, 3.8, 3.2, 3.0][i];
      t.transform.localPosition = new V3(x, -3.0 + s * 0.4 * 0.5 - 0.6, 0);
      t.transform.localScale = new V3(s, s, 1);
    });
    this.brandBoard.transform.localPosition = new V3(-1.2, -1.4, 0);
    this.brandText.transform.localPosition = new V3(-1.2, -1.4, 0);
    // reeds and water
    const tile = V.x / 4 + 0.05;
    this.backReeds.forEach((r, i) => { r.transform.localScale = new V3(tile, tile * 0.85, 1); r.transform.localPosition = new V3(-W2 + tile * (i + 0.5), -4.4, 0); });
    this.water.transform.localScale = new V3(V.x + 1, 9, 1);
    this.water.transform.localPosition = new V3(0, -6.6, 0);
    this.frontReeds.forEach((r, i) => {
      r.transform.localScale = new V3(tile * (i % 2 ? -1 : 1), tile * 0.8, 1);
      r.transform.localPosition = new V3(-W2 + tile * (i + 0.5), -H2 + tile * 0.8 * 0.375 * 0.75 - 0.2, 0);
    });
    // booth: awning across the top, posts at the sides
    const at = V.x / 6 + 0.05;
    this.awning.forEach((a, i) => { a.transform.localScale = new V3(at, at, 1); a.transform.localPosition = new V3(-W2 + at * (i + 0.5), H2 - at * 0.375 + 0.35, 0); });
    this.posts.forEach((p, i) => { p.transform.localScale = new V3(0.9, 0.9, 1); p.transform.localPosition = new V3((i === 0 ? -1 : 1) * (W2 - 0.25), H2 - 7.2 + 0.3, 0); });
    this.bulbs.forEach((b, i) => { const x = -W2 + 0.6 + (i + 0.5) * ((V.x - 1.2) / this.bulbs.length); b.transform.localPosition = new V3(x, H2 - at * 0.75 + 0.55, 0); });
    this.divider.transform.localPosition = new V3(0, -1.5, 0);
    this.divider.transform.localScale = new V3(0.08, 14, 1);
    this.zoneLabels.forEach((t, i) => { t.transform.localPosition = new V3((i === 0 ? -1 : 1) * 8, -8.3, 0); });
  }

  // ------------------------------------------------------------------ round

  protected SetupRound() {
    this.rng = new SysRandom(Math.floor(Math.random() * 1e9));
    for (const d of this.ducks) this.Hide(d);
    this.waveT = this.step === "idle" ? 0.2 : 1.2;
    this.goldT = 10 + Math.random() * 6;
    this.elapsed = 0;
    this.hits = [0, 0]; this.golds = [0, 0]; this.throws = [0, 0]; this.streak = [0, 0]; this.bestStreak = [0, 0];
    this.otterPose = 0; this.otterT = 0;
    const duo = this.mode === WMode.Duo;
    this.divider.gameObject.setActive(duo);
    this.zoneLabels.forEach((t, i) => {
      t.text = duo ? (this.demo ? `CPU ${i + 1}` : `PLAYER ${i + 1}`) : "";
      t.fontSize = 64; t.characterSize = 0.85 * 10 / 64;
      t.color = (i === 0 ? P1Col : P2Col);
    });
    this.brandBoard.color = this.BrandColor;
    this.brandText.text = this.BrandName;
    const len = this.BrandName.length;
    this.brandText.fontSize = 64; this.brandText.characterSize = Math.min(0.75, 7 / Math.max(4, len)) * 10 / 64;
    this.brandText.color = Color.white;
    const bw = Math.min(9, 1.6 + len * Math.min(0.75, 7 / Math.max(4, len)) * 0.62);
    this.brandBoard.transform.localScale = new V3(bw, 1.3, 1);
    this.brandPosts.forEach((p, i) => { p.transform.localPosition = new V3(-1.2 + (i === 0 ? -1 : 1) * (bw / 2 - 0.5), -2.6, 0); p.transform.localScale = new V3(0.18, 2.2, 1); });
  }

  private Hide(d: Duck) { d.state = "gone"; for (const g of [d.sr, d.glow, d.shadow]) g.gameObject.setActive(false); }

  private Free() { return this.ducks.find((d) => d.state === "gone") ?? null; }

  private Spawn(pattern: Pattern, look: number, p0: V2, vel: V2, amp: number, freq: number, ph: number, delay = 0) {
    const d = this.Free();
    if (!d) return null;
    d.look = look; d.pattern = pattern; d.state = "fly"; d.t = -delay; d.p0 = p0; d.vel = vel; d.amp = amp; d.freq = freq; d.ph = ph;
    d.dir = vel.x >= 0 ? 1 : -1; d.rot = 0; d.by = -1; d.size = look === GoldLook ? 2.5 : 2.75;
    d.pos = this.PathAt(d, Math.max(0, d.t)); d.prev = d.pos;
    d.sr.gameObject.setActive(delay <= 0);
    d.shadow.gameObject.setActive(look === GoldLook && delay <= 0);
    d.glow.gameObject.setActive(false);
    return d;
  }

  private PathAt(d: Duck, t: number) {
    const p = d.p0.add(d.vel.mul(t));
    switch (d.pattern) {
      case "wave": return p.add(new V2(0, d.amp * Math.sin(d.freq * t + d.ph)));
      case "loop": return new V2(p.x + d.dir * d.amp * Math.sin(d.freq * t), p.y + d.amp * (1 - Math.cos(d.freq * t)));
      case "pop": return p.add(new V2(0.6 * Math.sin(3 * t + d.ph), 0));
      case "zig": { const k = Mathf.pingPong(d.freq * t + d.ph, 1) * 2 - 1; return p.add(new V2(0, d.amp * k)); }
      default: return p.add(new V2(0, 0.22 * Math.sin(6 * t + d.ph)));
    }
  }

  private Look() { return this.rng.next(4); }

  private SpawnWave() {
    const W2 = this.ViewSize.x / 2 + 2;
    const fast = Mathf.lerp(1, 1.45, this.elapsed / RoundTime) * (this.step === "idle" ? 0.75 : 1);
    const side = this.rng.nextDouble() < 0.5 ? -1 : 1;
    const x0 = -side * W2;
    const y = Mathf.lerp(FlyMin + 1.2, FlyMax - 1.2, this.rng.nextDouble());
    const kinds: Pattern[] = ["line", "wave", "vee", "loop", "pop", "zig", "wave", "line"];
    const k = kinds[this.rng.next(kinds.length)];
    const look = this.Look();
    switch (k) {
      case "line": { const n = 3 + this.rng.next(3); for (let i = 0; i < n; i++) this.Spawn("line", look, new V2(x0, y), new V2(side * 4.2 * fast, 0), 0, 0, i, i * 0.75); break; }
      case "wave": { const n = 3 + this.rng.next(3); for (let i = 0; i < n; i++) this.Spawn("wave", this.Look(), new V2(x0, Mathf.clamp(y, FlyMin + 2, FlyMax - 2)), new V2(side * 4.6 * fast, 0), 1.8, 2.2, -i * 0.9, i * 0.6); break; }
      case "vee": {
        const yy = Mathf.clamp(y, FlyMin + 2.4, FlyMax - 2.4);
        for (let i = 0; i < 5; i++) { const row = Math.ceil(i / 2), up = i % 2 === 0 ? 1 : -1; this.Spawn("line", look, new V2(x0 - side * row * 2.2, yy + (i === 0 ? 0 : up * row * 1.35)), new V2(side * 4.4 * fast, 0), 0, 0, i); }
        break;
      }
      case "loop": { const n = 1 + this.rng.next(2); for (let i = 0; i < n; i++) this.Spawn("loop", this.Look(), new V2(x0, Mathf.clamp(y - 1.5, FlyMin, FlyMax - 4)), new V2(side * 3.6 * fast, 0), 1.8, 2.6, 0, i * 1.1); break; }
      case "pop": {
        const n = 2 + this.rng.next(2);
        for (let i = 0; i < n; i++) {
          const px = (this.rng.nextDouble() * 2 - 1) * (this.FW / 2 - 4);
          const dx = (px > 0 ? -1 : 1) * (1.2 + this.rng.nextDouble() * 2);
          this.Spawn("pop", this.Look(), new V2(px, -5.6), new V2(dx * fast, 4.2 * fast), 0, 0, i, i * 0.5);
        }
        break;
      }
      case "zig": this.Spawn("zig", look, new V2(x0, Mathf.clamp(y, FlyMin + 2, FlyMax - 2)), new V2(side * 5.6 * fast, 0), 1.7, 0.7, 0); break;
    }
    if (this.step !== "idle") Sfx.playClip(this.flapClip, 0.35);
  }

  private SpawnGold() {
    const W2 = this.ViewSize.x / 2 + 2, side = this.rng.nextDouble() < 0.5 ? -1 : 1;
    const y = Mathf.lerp(FlyMin + 2.2, FlyMax - 2.2, this.rng.nextDouble());
    const d = this.Spawn(this.rng.nextDouble() < 0.5 ? "zig" : "wave", GoldLook, new V2(-side * W2, y), new V2(side * 7.2, 0), 1.6, this.rng.nextDouble() < 0.5 ? 0.9 : 2.8, 0);
    if (d && this.step === "play") { this.UI.Toast("GOLDEN DUCK! WORTH 5!", 2); Sfx.playClip(this.goldClip, 0.6, 1.2); }
  }

  // ------------------------------------------------------------------ hits

  protected OnBall(b: Ball) {
    this.throws[b.who]++;
    let best: Duck | null = null, bd = 1e9;
    for (const d of this.ducks) {
      if (d.state !== "fly" || d.t < 0) continue;
      const r = d.gold ? 1.8 : 1.6, dist = V2.distance(d.pos, b.world);
      if (dist < r && dist < bd) { bd = dist; best = d; }
    }
    if (!best) { this.streak[b.who] = 0; return; }
    this.Shoot(best, b.who);
  }

  private Shoot(d: Duck, who: number) {
    const gold = d.gold, pts = gold ? 5 : 1;
    d.state = "hit"; d.hitT = 0.3; d.by = who;
    d.sr.sprite = DuckArt.Duck(d.look, 2);
    this.scores[who] += pts;
    this.hits[who]++;
    if (gold) this.golds[who]++;
    this.streak[who]++;
    this.bestStreak[who] = Math.max(this.bestStreak[who], this.streak[who]);
    const col = this.PlayerColor(who);
    this.fx.pop(d.pos, col, 22, 9, 0.38, 0.6);
    this.Fx.ring(d.pos, col, 1, 5.5, 0.4);
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 5;
      this.fx.emit(d.pos, new V2(Math.cos(a) * s, Math.sin(a) * s + 2), Color.lerp(Color.white, gold ? Gold : Pal.hex(0xf2e6c8), 0.5), 0.45, 1.3, DuckArt.Feather(), -5, (Math.random() - 0.5) * 500, false, 3);
    }
    d.glow.gameObject.setActive(true);
    d.glow.color = col;
    Sfx.playClip(this.quackClip, 0.9, gold ? 1.25 : 0.9 + Math.random() * 0.25);
    this.Fx.shake(gold ? 0.45 : 0.15);
    this.flashT = gold ? 0.8 : 0.25;
    this.UI.Float(d.pos.add(new V2(0, 1.2)), gold ? "+5 GOLD!" : "+1", Color.lerp(col, Color.white, 0.25), gold ? 2.0 : 1.8);
    if (gold) { Sfx.playClip(this.goldClip, 0.8); this.fx.confetti(d.pos, 50, 10, [Gold, Color.white, col]); this.Cheer(0.8); this.Hitstop(0.08); }
    const s = this.streak[who];
    if (gold || s % 5 === 0) this.OtterCheer(gold ? "GOLD!" : s >= 10 ? `${s} IN A ROW!` : Praise[Math.floor(Math.random() * Praise.length)], col);
    if (!gold && s >= 3 && s % 5 !== 0) this.UI.Float(d.pos.add(new V2(0, 2.4)), `${s} IN A ROW!`, Gold, 1.1);
  }

  private OtterCheer(text: string, col: Color) {
    this.otterPose = 1; this.otterT = 2;
    this.signText.text = text;
    this.signText.color = Color.lerp(col, Pal.hex(0x24142e), 0.55);
    if (this.step === "play") this.Cheer(0.35);
  }

  // ------------------------------------------------------------------ computer hunters

  protected TickCpu(dt: number, who: number, level: number) {
    if (!this.CpuReady(who, dt, [1.9, 1.35, 0.95][level])) return;
    let best: Duck | null = null, score = -1e9;
    for (const d of this.ducks) {
      if (d.state !== "fly" || d.t < 0) continue;
      const p = d.pos;
      if (p.x < this.FL + 1 || p.x > this.FR - 1 || p.y > FlyMax || p.y < FlyMin - 1.5) continue;
      if (this.mode === WMode.Duo && (p.x < 0 ? 0 : 1) !== who) continue;
      const sc = (d.gold ? 6 : 0) - Math.abs(p.x) * 0.1 + Math.random() * 1.5;
      if (sc > score) { score = sc; best = d; }
    }
    if (!best) { this.DelayCpu(who, 0.3); return; }
    let target = this.Aim(best.pos, best.v, level);
    if (this.mode === WMode.Duo) target = new V2(who === 0 ? Math.min(-0.3, target.x) : Math.max(0.3, target.x), target.y);
    this.Throw(who, target);
  }

  // ------------------------------------------------------------------ frame

  protected TickWorld(dt: number) {
    const t = Time.time;
    const live = this.step === "play";
    if (live) this.elapsed += dt;
    // spawning (also gently on the title screen)
    const flying = this.ducks.filter((d) => d.state === "fly").length;
    const want = this.step === "idle" ? 4 : this.step === "count" ? 3 : Math.round(Mathf.lerp(5, 10, this.elapsed / RoundTime)) + (this.mode === WMode.Solo ? 0 : 2);
    this.waveT -= dt;
    if (this.waveT <= 0 && flying < want && this.step !== "end") { this.SpawnWave(); this.waveT = this.step === "idle" ? 2.5 : Mathf.lerp(1.6, 0.8, this.elapsed / RoundTime); }
    if (live) { this.goldT -= dt; if (this.goldT <= 0) { this.SpawnGold(); this.goldT = 13 + Math.random() * 7; } }
    const W2 = this.ViewSize.x / 2 + 3.5;
    for (const d of this.ducks) {
      if (d.state === "gone") continue;
      if (d.state === "fly") {
        d.t += dt;
        if (d.t < 0) continue;
        d.sr.gameObject.setActive(true);
        if (d.gold) d.shadow.gameObject.setActive(true);
        d.prev = d.pos;
        d.pos = this.PathAt(d, d.t);
        d.v = dt > 0 ? d.pos.sub(d.prev).div(dt) : d.v;
        if (Math.abs(d.v.x) > 0.3) d.dir = d.v.x > 0 ? 1 : -1;
        const frame = Math.sin(t * (d.gold ? 22 : 15) + d.ph * 2) > 0 ? 0 : 1;
        d.sr.sprite = DuckArt.Duck(d.look, frame);
        d.rot = Mathf.lerp(d.rot, Mathf.clamp(d.v.y * 4, -25, 30) * d.dir, 1 - Math.exp(-dt * 6));
        if (d.pos.x < -W2 - 1 || d.pos.x > W2 + 1 || d.pos.y > FlyMax + 4 || (d.pattern === "pop" && d.t > 6)) {
          if (d.t > 0.5) { this.Hide(d); continue; }
        }
      } else if (d.state === "hit") {
        d.hitT -= dt;
        d.rot += dt * 200;
        if (d.hitT <= 0) { d.state = "fall"; d.fallV = new V2(d.dir * 1.5, 3); d.vrot = d.dir * -500; }
      } else if (d.state === "fall") {
        d.fallV = d.fallV.add(new V2(0, -26 * dt));
        d.pos = d.pos.add(d.fallV.mul(dt));
        d.rot += d.vrot * dt;
        if (d.pos.y < -6.2) {
          this.fx.pop(new V2(d.pos.x, -5.9), Pal.hex(0xcff4ff), 14, 6, 0.3, 0.5);
          if (this.step !== "idle") Sfx.playClip(this.splashClip, 0.5);
          this.Hide(d);
          continue;
        }
      }
      d.sr.transform.localPosition = new V3(d.pos.x, d.pos.y, 0);
      d.sr.transform.localScale = new V3(d.size * (d.dir < 0 ? -1 : 1), d.size, 1);
      d.sr.transform.localEulerZ = d.rot;
      d.sr.sortingOrder = d.state === "fall" ? 200 : 150 + this.ducks.indexOf(d);
      if (d.gold) {
        d.shadow.transform.localPosition = new V3(d.pos.x, d.pos.y, 0);
        d.shadow.color = Gold.withAlpha(0.45 + 0.2 * Math.sin(t * 10));
        if (d.state === "fly" && Math.random() < 0.6) this.fx.sparkle(d.pos.add(new V2((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.5)), Gold, 1, 0.3, 0.3);
      }
      if (d.glow.gameObject.activeSelf) {
        const k = Mathf.clamp01(d.hitT / 0.3);
        d.glow.transform.localPosition = new V3(d.pos.x, d.pos.y, 0);
        const s = 3.2 + (1 - k) * 1.5;
        d.glow.transform.localScale = new V3(s, s, 1);
        d.glow.color = d.glow.color.withAlpha(k);
        if (d.state !== "hit") d.glow.gameObject.setActive(false);
      }
    }
    // Ferris wheel
    const wa = t * 8;
    this.wheel.transform.localEulerZ = wa;
    const wc = this.wheel.transform.localPosition;
    this.cabins.forEach((c, i) => {
      const a = (wa + i * 30) * Mathf.Deg2Rad, r = 8.6 * 0.43;
      c.transform.localPosition = new V3(wc.x + Math.cos(a) * r, wc.y + Math.sin(a) * r - 0.35, 0);
    });
    // booth lights chase and flash on hits
    this.flashT = Math.max(0, this.flashT - dt);
    this.bulbs.forEach((b, i) => {
      const on = this.flashT > 0 ? Math.sin(t * 30) > -0.5 : ((i + Math.floor(t * 6)) % 3) === 0;
      b.color = on ? Pal.hex(0xfff6c0) : Pal.hex(0xc89a50);
      const s = on ? 0.38 : 0.3;
      b.transform.localScale = new V3(s, s, 1);
    });
    // Ollie
    this.otterT = Math.max(0, this.otterT - dt);
    if (this.otterT <= 0) this.otterPose = 0;
    const up = this.otterPose === 1 ? 1 : 0;
    this.otterUp = Mathf.moveTowards(this.otterUp, up, dt * 4);
    this.otter.sprite = DuckArt.Otter(this.otterPose);
    const ox = this.ViewSize.x / 2 > 17 ? -14 : -12.8;
    const oy = -7.9 + this.otterUp * 1.9 + (this.otterPose === 1 ? Math.abs(Math.sin(t * 9)) * 0.35 : Math.sin(t * 2) * 0.12);
    this.otter.transform.localPosition = new V3(ox, oy, 0);
    this.otter.transform.localScale = new V3(2.8, 2.8, 1);
    const sv = this.otterUp > 0.5;
    this.sign.gameObject.setActive(sv);
    this.signText.text = sv ? this.signText.text : "";
    this.sign.transform.localPosition = new V3(ox + 3.4, oy + 2.5, 0);
    this.sign.transform.localEulerZ = Math.sin(t * 6) * 4;
    this.signText.transform.localPosition = new V3(ox + 3.4, oy + 2.5, 0);
    this.signText.fontSize = 64;
    this.signText.characterSize = Math.min(0.75, 5.6 / Math.max(4, this.signText.text.length)) * 10 / 64;
    this.signText.transform.localEulerZ = Math.sin(t * 6) * 4;
  }

  // ------------------------------------------------------------------ HUD / results

  protected PanelSub(i: number) { return this.golds[i] > 0 ? `★ ${this.golds[i]} GOLD` : ""; }
  protected CardSub(i: number) { return `${this.hits[i]} DUCKS · ${this.golds[i]} GOLD`; }
  protected ResultStats(): [string, string][] {
    const acc = (i: number) => (this.throws[i] ? `${Math.round((this.hits[i] / this.throws[i]) * 100)}%` : "–");
    if (this.mode === WMode.Solo) return [["DUCKS HIT", String(this.hits[0])], ["GOLDEN DUCKS", String(this.golds[0])], ["BEST STREAK", String(this.bestStreak[0])], ["ACCURACY", acc(0)]];
    return [["POINTS", `${this.scores[0]} – ${this.scores[1]}`], ["DUCKS HIT", `${this.hits[0]} – ${this.hits[1]}`], ["GOLDEN DUCKS", `${this.golds[0]} – ${this.golds[1]}`], ["BEST STREAK", `${this.bestStreak[0]} – ${this.bestStreak[1]}`]];
  }

  /** Test hook: ducks in CSS pixels. */
  get debugInfo() {
    return {
      state: this.State, step: this.step, mode: this.mode, demo: this.demo, timeLeft: this.timeLeft, scores: this.scores, hits: this.hits, golds: this.golds,
      ducks: this.ducks.filter((d) => d.state === "fly" && d.t >= 0).map((d) => ({ gold: d.gold, x: d.pos.x, css: this.Css(d.pos), lead: this.Css(d.pos.add(d.v.mul(0.12))) })),
    };
  }
}

