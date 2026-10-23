import {
  Art, AudioClip, CasualArt, Color, GameInfo, GameObject, howTo, LineRenderer, Mathf, Pal, Phase, Result, Sfx, Snd, SpriteRenderer,
  TextMesh, Time, TouchScheme, V2, V3, WallBoard,
} from "../../kit";
import { DiffNames, Gold, gauss, Mode, noise, P1, P2, WallGame } from "./WallKit";
import * as CA from "./CricketArt";

/**
 * CRICKET BOWLING: gully cricket with a tennis ball against a painted street wall. Each player bowls at the chalk
 * stumps on their half. Hit the stumps: WICKET (stumps fly, bails pop, the crowd roars) and a new batter walks in at
 * fresh stumps. The batters sometimes come forward to DEFEND (the bat blocks the lower stumps; aim for the top!).
 * The chalk FOUR box and the SIX hoarding give bonus runs. Three wickets in three balls: HAT-TRICK.
 * Most wickets wins; runs break ties. SOLO: as many wickets as you can in 1:30. VS COMPUTER: a virtual bowler on the
 * right half (easy / medium / hard). 2 PLAYERS: left vs right.
 */

const RoundSecs = 90;
const Ground = -6.2, StumpH = 5.0, StumpW = 0.42, StumpGap = 1.18, StumpHalf = 1.55;
const BodyH = 6.8, BodyCY = Ground + 3.35, BatLen = 3.6;
const OutSecs = 1.7;
/** Virtual bowler: spread (1 sigma) and seconds between balls per difficulty. */
const BotSigma = [2.6, 1.7, 1.1], BotEvery = [3.4, 2.5, 1.9];
const Shirts = [P1, P2, Pal.hex(0x2fa86a)];

enum Bat { Guard, Defend, Swing, Out, WalkIn }

interface Side {
  root: GameObject;
  stumps: SpriteRenderer[]; bails: SpriteRenderer[];
  body: SpriteRenderer; arms: LineRenderer; pivot: GameObject; bat: SpriteRenderer;
  fourBox: SpriteRenderer; fourText: TextMesh; fourSub: TextMesh;
  sixBoard: SpriteRenderer; sixText: TextMesh; sixBrand: TextMesh;
  sx: number; cx: number; d: number; range: number;
  state: Bat; t: number; handsX: number; handsY: number; bodyX: number; batAng: number; lean: number; alpha: number;
  four: V2; six: V2; fourFlash: number; sixFlash: number; shirt: number;
  wkts: number; runs: number; balls: number; run: number; hatTricks: number; fours: number; sixes: number; defended: number;
}

export class CricketBowlingGame extends WallGame {
  private sides: Side[] = [];
  private pipe!: SpriteRenderer;
  private defendT = 0; private defendNext = 3; private defendPhase = 0;
  private botT = [0, 0];
  private clatterClip!: AudioClip; private thockClip!: AudioClip; private chalkClip!: AudioClip; private bellClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "wallcricket",
      Title: "CRICKET BOWLING",
      Tagline: "HIT THE STUMPS. HOWZAT!",
      PlayLabel: "PLAY",
      Accent: Pal.hex(0x2fa86a),
      Accent2: Gold,
      BgTop: Pal.hex(0xf2a65a),
      BgBottom: Pal.hex(0x3a2a40),
      ShortSide: 18,
      Touch: TouchScheme.None,
      Music: { bpm: 118, rootHz: 98, degrees: [0, 4, 5, 3], seed: 41, energy: 0.7, major: true },
      Reminders: [
        "The street match is on|How many wickets can you take?",
        "Aim over the bat|Defending batters leave the top of the stumps open!",
        "Bring a friend|Left half vs right half: bowl them out!",
      ],
      HowTo: [
        howTo(Art.Disc, CA.Ball, "Throw the ball at the chalk STUMPS on your half: hit them for a WICKET!"),
        howTo(Art.Square, CA.Chalk, "The batter sometimes DEFENDS: the bat blocks the lower stumps. Aim at the top!"),
        howTo(Art.Star, Gold, "Hit the FOUR box for 4 runs or the SIX board for 6 runs (runs break ties)."),
        howTo(Art.Diamond, P2, "Three wickets with three balls in a row: HAT-TRICK!"),
        howTo(Art.Chevron, P1, "2 PLAYERS: left half is PLAYER 1, right half is PLAYER 2. Most wickets wins."),
      ],
      Tips: [
        "When the bat comes across, go for the bails.",
        "Fresh stumps appear somewhere new after every wicket.",
        "Runs only break ties: wickets win matches!",
      ],
    });
  }

  protected RoundSeconds() { return RoundSecs; }
  protected BallSprite() { return CA.BallSprite(); }
  protected get BallSize() { return 0.95; }
  protected Backdrop() { return CA.Backdrop(); }
  protected ModeInfo(m: Mode) {
    return m === Mode.Solo ? "One set of stumps across the whole wall.\n\nTake as many wickets as you can in 1:30!"
      : m === Mode.Cpu ? "You bowl at the LEFT stumps.\n\nA virtual bowler attacks the RIGHT stumps. Take more wickets in 1:30!"
        : "PLAYER 1: left stumps.\nPLAYER 2: right stumps.\n\nMost wickets in 1:30 wins. Runs break ties!";
  }
  /** Board score = wickets × 1000 + runs. */
  protected BoardText(score: number) { return `${Math.floor(score / 1000)}W ${score % 1000}R`; }

  // ------------------------------------------------------------------ build

  protected BuildWall() {
    const w = this.wall;
    Art.spr(w, "StreetWall", CA.WallSprite(), Color.white, 32, -30, Art.Flat);
    this.pipe = Art.spr(w, "Drainpipe", CA.PipeSprite(), Color.white, 0.55, -20, Art.Flat);
    this.pipe.transform.localPosition = new V2(0, -0.8);
    this.pipe.transform.localScale = new V3(0.55, 0.85, 1);
    for (let i = 0; i < 2; i++) this.sides.push(this.MakeSide(i));
    const n = (i: number) => noise(i);
    this.clatterClip = Sfx.make("wc-clatter", 0.6, (t) => {
      let v = 0;
      for (let k = 0; k < 4; k++) { const tt = t - k * 0.06 - (k > 1 ? 0.05 : 0); if (tt > 0) v += Sfx.sinP(Sfx.glide(tt, 700 - k * 90, 380 - k * 40, 0.05)) * Sfx.env(tt, 0.001, 0.07) * 0.4; }
      return v + n(Math.trunc(t * 44100) + 2) * Sfx.env(t, 0.001, 0.12) * 0.35;
    });
    this.thockClip = Sfx.make("wc-thock", 0.25, (t) => (Sfx.sinP(Sfx.glide(t, 520, 260, 0.04)) * 0.6 + Sfx.triP(180 * t) * 0.3 + n(Math.trunc(t * 44100) + 6) * 0.3 * Sfx.env(t, 0, 0.008)) * Sfx.env(t, 0.001, 0.09) * 0.9);
    this.chalkClip = Sfx.make("wc-chalk", 0.3, (t) => n(Math.trunc(t * 30000) + 9) * (0.5 + 0.5 * Math.sin(t * 300)) * Sfx.env(t, 0.01, 0.2) * 0.35);
    this.bellClip = Sfx.make("wc-bell", 0.9, (t) => (Sfx.sinP(1320 * t) * 0.4 + Sfx.sinP(1980 * t) * 0.2 + Sfx.sinP(2640 * t) * 0.1) * Sfx.env(t, 0.002, 0.5) * 0.6);
  }

  private MakeSide(i: number): Side {
    const root = new GameObject("Side" + i, this.wall);
    const tm = (name: string, size: number, order: number) => {
      const t = new GameObject(name, root).addComponent(new TextMesh());
      t.fontSize = 64; t.characterSize = size * 10 / 64; t.anchor = "MiddleCenter"; t.fontStyle = "bold"; t.sortingOrder = order; t.color = CA.Chalk;
      return t;
    };
    const fourBox = Art.spr(root, "FourBox", CA.ChalkBox(), Color.white, 1, -5, Art.Flat);
    const fourText = tm("Four", 1.6, -4), fourSub = tm("FourSub", 0.5, -4);
    const sixBoard = Art.spr(root, "SixBoard", CA.Hoarding(), Color.white, 1, -5, Art.Flat);
    const sixText = tm("Six", 1.3, -4), sixBrand = tm("SixBrand", 0.55, -4);
    const stumps: SpriteRenderer[] = [], bails: SpriteRenderer[] = [];
    for (let k = 0; k < 3; k++) stumps.push(Art.spr(root, "Stump" + k, CA.StumpSprite(), Color.white, 1, -3, Art.Flat));
    for (let k = 0; k < 2; k++) bails.push(Art.spr(root, "Bail" + k, CA.BailSprite(), Color.white, 1, -3, Art.Flat));
    const body = Art.spr(root, "Batter", CA.BatterSprite(Shirts[i], "s" + i), Color.white, BodyH / 2, 5, Art.Flat);
    const arms = Art.line(root, "Arms", CA.Skin, 0.32, 6, false, false, Art.Flat);
    const pivot = new GameObject("BatPivot", root);
    const bat = Art.spr(pivot, "Bat", CA.BatSprite(), Color.white, BatLen / 5, 7, Art.Flat);
    bat.transform.localPosition = new V2(0, -BatLen / 2);
    return {
      root, stumps, bails, body, arms, pivot, bat, fourBox, fourText, fourSub, sixBoard, sixText, sixBrand,
      sx: 0, cx: 0, d: -1, range: 2.5, state: Bat.Guard, t: 0, handsX: 0, handsY: 0, bodyX: 0, batAng: 0, lean: 0, alpha: 1,
      four: V2.zero, six: V2.zero, fourFlash: 0, sixFlash: 0, shirt: i,
      wkts: 0, runs: 0, balls: 0, run: 0, hatTricks: 0, fours: 0, sixes: 0, defended: 0,
    };
  }

  // ------------------------------------------------------------------ round

  protected ResetRound() {
    const solo = this.Solo;
    this.defendT = 0; this.defendNext = 4; this.defendPhase = 0;
    this.botT = [1.4 + Math.random(), 1.6 + Math.random()];
    this.pipe.gameObject.setActive(!solo);
    for (let i = 0; i < 2; i++) {
      const s = this.sides[i];
      s.root.setActive(!solo || i === 0);
      s.cx = solo ? 0 : i === 0 ? -8 : 8;
      s.d = solo ? -1 : i === 0 ? -1 : 1;
      s.range = solo ? 5.5 : 2.3;
      s.wkts = s.runs = s.balls = s.run = s.hatTricks = s.fours = s.sixes = s.defended = 0;
      s.sx = s.cx;
      s.four = solo ? new V2(-8.5, 2.4) : new V2(s.cx + s.d * 3.7, 2.3);
      s.six = solo ? new V2(8.5, 2.9) : new V2(s.cx - s.d * 3.7, 2.9);
      s.fourFlash = s.sixFlash = 0;
      s.shirt = i;
      this.SetStumps(s, true);
      s.state = Bat.Guard; s.t = 0; s.alpha = 1; s.lean = 0;
      s.bodyX = this.GuardX(s);
      s.handsX = s.bodyX - s.d * 0.7;
      s.handsY = BodyCY + 0.4;
      s.batAng = s.d * 25;
    }
    this.PlaceAll();
  }

  private GuardX(s: Side) { return s.sx + s.d * 2.45; }

  private SetStumps(s: Side, visible: boolean) {
    for (let k = 0; k < 3; k++) {
      const st = s.stumps[k];
      st.gameObject.setActive(visible);
      st.transform.localPosition = new V2(s.sx + (k - 1) * StumpGap, Ground + StumpH / 2);
      st.transform.localScale = new V3(StumpW * 2.1, StumpH / 10, 1);
      st.transform.localEulerZ = (Math.random() - 0.5) * 2;
    }
    for (let k = 0; k < 2; k++) {
      const b = s.bails[k];
      b.gameObject.setActive(visible);
      b.transform.localPosition = new V2(s.sx + (k === 0 ? -0.59 : 0.59), Ground + StumpH + 0.12);
      b.transform.localScale = new V3(1.22, 1.22 * 1.2, 1);
      b.transform.localEulerZ = 0;
    }
  }

  // ------------------------------------------------------------------ motion

  protected TickWall(dt: number, live: boolean) {
    // the batters' shared rhythm: everyone defends at the same moments (fair for both halves)
    if (live) {
      const p = this.RoundProgress;
      if (this.defendT > 0) this.defendT -= dt;
      else {
        this.defendNext -= dt;
        if (this.defendNext <= 0) {
          this.defendT = Mathf.lerp(1.5, 2.6, Math.random()) + p * 1.0;
          this.defendNext = Mathf.lerp(4.0, 1.4, p) * Mathf.lerp(0.7, 1.3, Math.random());
          this.defendPhase = Math.random() * Math.PI * 2;
        }
      }
    } else if (this.State !== Phase.Playing) {
      // title: gentle demo of the defending batter
      const k = Time.time % 7;
      this.defendT = k > 4 ? 1 : 0;
    } else this.defendT = 0;
    const speed = 2.2 + this.RoundProgress * 1.6;
    this.defendPhase += dt * speed;
    for (const s of this.sides) if (s.root.activeSelf) this.TickBatter(s, dt);
    this.PlaceAll();
  }

  private TickBatter(s: Side, dt: number) {
    s.t += dt;
    s.fourFlash = Mathf.moveTowards(s.fourFlash, 0, dt * 1.5);
    s.sixFlash = Mathf.moveTowards(s.sixFlash, 0, dt * 1.5);
    const guardX = this.GuardX(s);
    switch (s.state) {
      case Bat.Guard:
      case Bat.Defend: {
        const defending = this.defendT > 0;
        s.state = defending ? Bat.Defend : Bat.Guard;
        const tx = defending ? s.sx + Math.sin(this.defendPhase + s.shirt * 0.0) * (StumpHalf - 0.45) * (s.d < 0 ? 1 : -1) : guardX - s.d * 0.7;
        s.handsX = Mathf.moveTowards(s.handsX, tx, dt * (defending ? 9 : 6));
        s.handsY = Mathf.moveTowards(s.handsY, defending ? Ground + 3.55 : BodyCY + 0.4, dt * 8);
        s.batAng = Mathf.moveTowards(s.batAng, defending ? 0 : s.d * 25, dt * 260);
        s.bodyX = Mathf.moveTowards(s.bodyX, defending ? s.sx + s.d * 2.15 : guardX, dt * 5);
        s.lean = Mathf.moveTowards(s.lean, defending ? -s.d * 8 : 0, dt * 60);
        s.alpha = 1;
        break;
      }
      case Bat.Swing: {
        const k = s.t / 0.5;
        s.batAng = s.d * (25 - Math.sin(Math.min(1, k) * Math.PI) * 140);
        s.handsY = BodyCY + 0.4 + Math.sin(Math.min(1, k) * Math.PI) * 1.2;
        if (k >= 1) s.state = Bat.Guard;
        break;
      }
      case Bat.Out: {
        s.lean = Mathf.moveTowards(s.lean, s.d * 75, dt * 160);
        s.alpha = Mathf.clamp01(1 - (s.t - 0.6) / 0.5);
        if (s.t >= OutSecs * 0.65) {
          // new batter and fresh chalk stumps somewhere else
          s.sx = s.cx + Mathf.lerp(-s.range, s.range, Math.random());
          if (Math.abs(s.sx - s.cx) < 0.6 && s.range > 1) s.sx += 1.2 * Math.sign(Math.random() - 0.5);
          this.SetStumps(s, true);
          for (let k = 0; k < 3; k++) this.fxw.emit(new V2(s.sx + (k - 1) * StumpGap, Ground + 2.5), new V2(0, 1), new Color(1, 1, 1, 0.6), 1.6, 0.6, CA.Dust());
          Sfx.playClip(this.chalkClip, 0.6);
          s.shirt = (s.shirt + 1) % 3;
          s.body.sprite = CA.BatterSprite(Shirts[s.shirt === 0 ? 0 : s.shirt === 1 ? 1 : 2], "s" + s.shirt);
          s.state = Bat.WalkIn; s.t = 0;
          s.lean = 0;
          s.bodyX = this.GuardX(s) + s.d * 6;
          s.alpha = 1;
        }
        break;
      }
      case Bat.WalkIn: {
        s.bodyX = Mathf.moveTowards(s.bodyX, guardX, dt * 10);
        s.handsX = s.bodyX - s.d * 0.7;
        s.handsY = BodyCY + 0.4 + Math.abs(Math.sin(s.t * 12)) * 0.15;
        s.batAng = s.d * 25;
        if (Math.abs(s.bodyX - guardX) < 0.01) { s.state = Bat.Guard; s.t = 0; }
        break;
      }
    }
  }

  private PlaceAll() {
    for (const s of this.sides) {
      if (!s.root.activeSelf) continue;
      const walk = s.state === Bat.WalkIn ? Math.abs(Math.sin(s.t * 12)) * 0.15 : 0;
      s.body.transform.localPosition = new V2(s.bodyX, BodyCY + walk);
      s.body.transform.localEulerZ = s.lean;
      s.body.color = new Color(1, 1, 1, s.alpha);
      s.bat.color = new Color(1, 1, 1, s.alpha);
      s.pivot.localPosition = new V3(s.handsX, s.handsY, 0);
      s.pivot.localEulerZ = s.batAng;
      // arms from both shoulders to the hands
      const sh = new V2(s.bodyX, BodyCY + 0.95 + walk);
      const l = sh.add(new V2(-0.62, 0)), r = sh.add(new V2(0.62, 0));
      s.arms.positionCount = 3;
      s.arms.setPosition(0, l);
      s.arms.setPosition(1, new V2(s.handsX, s.handsY));
      s.arms.setPosition(2, r);
      s.arms.color = CA.Skin.withAlpha(s.alpha);
      // zones
      s.fourBox.transform.localPosition = s.four;
      s.fourBox.transform.localScale = new V3(4.4, 4.4, 1);
      s.fourBox.color = Color.lerp(Color.white, Gold, s.fourFlash);
      s.fourText.text = "4"; s.fourText.transform.localPosition = s.four.add(new V2(0, 0.2));
      s.fourSub.text = "FOUR RUNS"; s.fourSub.transform.localPosition = s.four.add(new V2(0, -0.85));
      s.fourText.color = Color.lerp(CA.Chalk, Gold, s.fourFlash);
      const brand = this.BrandColor;
      s.sixBoard.transform.localPosition = s.six;
      s.sixBoard.transform.localScale = new V3(3.8, 3.8, 1);
      s.sixBoard.color = Color.lerp(brand, Color.white, 0.1 + s.sixFlash * 0.6);
      s.sixText.text = "6"; s.sixText.transform.localPosition = s.six.add(new V2(0.95, -0.05)); s.sixText.color = Color.white;
      s.sixBrand.text = this.BrandWord("BRAND"); s.sixBrand.transform.localPosition = s.six.add(new V2(-0.45, 0)); s.sixBrand.color = CasualArt.darken(brand, 0.65);
    }
  }

  // ------------------------------------------------------------------ play

  protected TickPlay(dt: number) {
    for (let side = 0; side < 2; side++) {
      if (!this.IsBot(side)) continue;
      this.botT[side] -= dt;
      if (this.botT[side] > 0) continue;
      const d = this.demo ? 1 : this.diff;
      this.botT[side] = BotEvery[d] * Mathf.lerp(0.75, 1.25, Math.random());
      const s = this.sides[side];
      if (s.state === Bat.Out || s.state === Bat.WalkIn) { this.botT[side] = 0.5; continue; }
      const sg = BotSigma[d];
      // a smart bowler aims over the bat when the batter defends
      let aim = new V2(s.sx, Ground + StumpH * 0.48);
      if (this.defendT > 0 && d >= 1) aim = new V2(s.sx, Ground + StumpH * 0.82);
      if (Math.random() < 0.08) aim = Math.random() < 0.5 ? s.four : s.six;
      this.Throw(side, aim.add(new V2(gauss() * sg, gauss() * sg * 0.9)), 0.8);
    }
  }

  protected OnHit(side: number, p: V2, bot: boolean) {
    if (!this.Live) return;
    const s = this.sides[this.Solo ? 0 : side];
    const col = this.sideCol[side];
    if (s.state === Bat.Out || s.state === Bat.WalkIn) {
      this.Impact(p, col, false);
      Sfx.playClip(this.thudClip, 0.5);
      this.Drop(CA.BallSprite(), p, new V2((Math.random() - 0.5) * 4, 2), 0.95, { floor: Ground - 1.2, life: 1.2 });
      this.SideTag(side, "NEW BATTER COMING IN...", Color.white);
      return;
    }
    s.balls++;
    const lx = p.x - s.sx;
    const batBlock = s.state === Bat.Defend && Math.abs(p.x - s.handsX) < 0.62 && p.y < s.handsY - 0.6 && p.y > Ground - 0.4;
    const onStumps = Math.abs(lx) < StumpHalf && p.y > Ground - 0.3 && p.y < Ground + StumpH + 0.5;
    if (batBlock) {
      s.run = 0; s.defended++;
      this.Impact(p, col, false);
      Sfx.playClip(this.thockClip, 0.9);
      this.Drop(CA.BallSprite(), p, new V2(-s.d * Mathf.lerp(3, 6, Math.random()), Mathf.lerp(4, 8, Math.random())), 0.95, { floor: Ground - 1.2, life: 1.4, order: 8 });
      this.UI.Float(p.add(new V2(0, 1.2)), "DEFENDED!", Color.white, 1.3);
      this.fxw.pop(p, Pal.hex(0xe2b878), 10, 5, 0.25, 0.4);
      s.batAng += s.d * 12;
      this.Fx.shake(0.12);
      return;
    }
    if (onStumps) { this.Wicket(s, side, p, bot); return; }
    s.run = 0;
    this.Impact(p, col, false);
    const inBox = (c: V2, hw: number, hh: number) => Math.abs(p.x - c.x) < hw && Math.abs(p.y - c.y) < hh;
    if (inBox(s.six, 1.95, 1.15)) {
      s.runs += 6; s.sixes++;
      s.sixFlash = 1;
      Sfx.playClip(this.bellClip, 0.8); Sfx.playClip(this.cheerClip, bot ? 0.3 : 0.6);
      this.UI.Float(s.six.add(new V2(0, 1.6)), `${this.BrandWord("BRAND")} SIX! +6`, this.BrandColor, 1.5);
      this.fxw.confetti(s.six, 26, 7, [this.BrandColor, Gold, Color.white]);
      this.PopPanel(side);
    } else if (inBox(s.four, 2.25, 1.25)) {
      s.runs += 4; s.fours++;
      s.fourFlash = 1;
      Sfx.playClip(this.bellClip, 0.7, 0.85); Sfx.play(Snd.Coin, 0.5);
      this.UI.Float(s.four.add(new V2(0, 1.6)), "FOUR! +4", Gold, 1.4);
      this.fxw.sparkle(s.four, Gold, 12, 2, 0.45);
      this.PopPanel(side);
    } else {
      Sfx.playClip(this.thudClip, 0.7);
      const near = Math.abs(lx) < StumpHalf + 1.1 && p.y < Ground + StumpH + 1.2 && p.y > Ground - 0.5;
      if (near && s.state === Bat.Guard) { s.state = Bat.Swing; s.t = 0; this.UI.Float(p.add(new V2(0, 1.2)), "BEATEN!", Pal.hex(0xffe0a0), 1.2); Sfx.playClip(this.groanClip, bot ? 0.25 : 0.5); }
      else this.UI.Float(p.add(new V2(0, 1.0)), "DOT BALL", new Color(1, 1, 1, 0.85), 0.9);
    }
    this.Drop(CA.BallSprite(), p, new V2((Math.random() - 0.5) * 4, Mathf.lerp(1, 4, Math.random())), 0.95, { floor: Ground - 1.2, life: 1.3 });
  }

  private Wicket(s: Side, side: number, p: V2, bot: boolean) {
    s.wkts++;
    s.run++;
    const hat = s.run >= 3 && s.run % 3 === 0;
    if (hat) s.hatTricks++;
    this.Impact(p, Gold, true);
    // stumps fly, bails pop
    for (let k = 0; k < 3; k++) {
      const st = s.stumps[k];
      st.gameObject.setActive(false);
      const away = (k - 1) + (p.x < s.sx ? 0.6 : -0.6);
      this.Drop(CA.StumpSprite(), new V2(st.transform.localPosition.x, st.transform.localPosition.y), new V2(away * Mathf.lerp(3, 6, Math.random()), Mathf.lerp(9, 14, Math.random())), 1, { life: 1.6, gravity: 26, spin: Mathf.lerp(-400, 400, Math.random()), order: 9, floor: Ground - 1.6, shape: new V2(StumpW * 2.1, StumpH / 10) });
    }
    for (let k = 0; k < 2; k++) {
      const b = s.bails[k];
      b.gameObject.setActive(false);
      this.Drop(CA.BailSprite(), new V2(b.transform.localPosition.x, b.transform.localPosition.y), new V2((k === 0 ? -1 : 1) * Mathf.lerp(3, 7, Math.random()), Mathf.lerp(14, 20, Math.random())), 1.22, { shape: new V2(1, 1.2), life: 1.8, gravity: 24, spin: Mathf.lerp(600, 1100, Math.random()) * (k === 0 ? 1 : -1), order: 10 });
    }
    this.fxw.emit(new V2(s.sx, Ground + 2.5), V2.zero, new Color(1, 1, 1, 0.7), 4, 0.6, CA.Dust());
    this.fxw.pop(new V2(s.sx, Ground + 4), CA.Chalk, 22, 9, 0.3, 0.6);
    this.fxw.confetti(new V2(s.sx, Ground + 5), hat ? 70 : 34, 10, [this.sideCol[side], Gold, Color.white]);
    this.Drop(CA.BallSprite(), p, new V2((Math.random() - 0.5) * 6, 5), 0.95, { floor: Ground - 1.2, life: 1.4 });
    Sfx.playClip(this.clatterClip, 1);
    Sfx.playClip(this.roarClip, bot ? 0.4 : hat ? 1 : 0.8);
    this.Fx.shake(hat ? 0.5 : 0.35);
    this.Hitstop(0.05);
    const text = hat ? "HAT-TRICK!" : s.run === 2 ? "TWO IN TWO!" : "WICKET!";
    if (!this.Solo) this.SideTag(side, text, hat ? Gold : this.sideCol[side]);
    else this.Big(text, hat ? Gold : Color.white, 1.0, 1.8);
    this.UI.Float(new V2(s.sx, Ground + StumpH + 1.4), hat ? "HAT-TRICK!" : "HOWZAT!", hat ? Gold : Color.white, 1.6);
    if (hat) this.Big("HAT-TRICK!", Gold, 1.4, 2);
    this.PopPanel(side);
    s.state = Bat.Out; s.t = 0;
    if (!bot) this.Data.add("wickets", 1);
  }
  protected OnTime() { this.defendT = 0; }

  // ------------------------------------------------------------------ HUD + results

  private Overs(balls: number) { return `${Math.floor(balls / 6)}.${balls % 6} OV`; }

  protected PanelText(side: number): [string, string] {
    if (this.Solo && side === 1) {
      const top = WallBoard.list(this.Info.Id, 1)[0];
      return [top ? this.BoardText(top.score) : "---", top ? `BEAT ${top.label}!` : "SET TODAY'S BEST!"];
    }
    const s = this.sides[side];
    return [`${s.wkts}`, `WICKETS · ${s.runs} RUNS · ${this.Overs(s.balls)}`];
  }

  protected MakeResult() {
    const a = this.sides[0], b = this.sides[1];
    const score = (s: Side) => s.wkts * 1000 + Math.min(999, s.runs);
    const stars = (s: Side) => WallGame.Stars(s.wkts, 5, 10, 16);
    const stats = (s: Side): [string, string][] => [["WICKETS", String(s.wkts)], ["RUNS", String(s.runs)], ["BALLS", `${s.balls} (${this.Overs(s.balls)})`], ["HAT-TRICKS", String(s.hatTricks)]];
    if (this.mode === Mode.Solo) {
      const nb = this.SaveBest(score(a));
      return {
        result: new Result({
          Headline: nb ? "NEW BEST!" : a.wkts >= 9 ? "WHAT A SPELL!" : "STUMPS!", HeadlineColor: nb ? Gold : Color.white,
          Value: `${a.wkts} WKTS`, NewBest: nb, Victory: a.wkts > 0, BestLine: `${a.runs} BONUS RUNS · SOLO BEST ${this.BoardText(this.Data.get("best0"))}`,
          Stats: stats(a), Primary: "BOWL AGAIN",
        }),
        score: score(a), label: "SOLO", stars: stars(a),
      };
    }
    const cmp = a.wkts !== b.wkts ? a.wkts - b.wkts : a.runs - b.runs;
    const w = cmp === 0 ? -1 : cmp > 0 ? 0 : 1;
    const tie = a.wkts === b.wkts && w >= 0 ? "  (ON RUNS)" : "";
    if (this.mode === Mode.Cpu) {
      if (w === 0) this.Data.add("wins", 1);
      this.SaveBest(score(a));
      return {
        result: new Result({
          Headline: w === 0 ? `YOU WIN!${tie}` : w < 0 ? "IT'S A TIE!" : `THE COMPUTER WINS${tie}`, HeadlineColor: w === 0 ? Gold : w < 0 ? Color.white : Pal.hex(0xffb0c0),
          Value: `${a.wkts} – ${b.wkts}`, Victory: w === 0, BestLine: `WICKETS · RUNS ${a.runs} – ${b.runs} · ${DiffNames[this.diff]}`, Stats: stats(a),
          Primary: w === 0 ? "PLAY AGAIN" : "REMATCH",
        }),
        score: score(a), label: "VS CPU", stars: w === 0 ? Math.max(1, stars(a)) : 0,
      };
    }
    this.Data.add("duels", 1);
    const win = w === 1 ? b : a;
    this.SaveBest(score(win));
    return {
      result: new Result({
        Headline: w < 0 ? "IT'S A TIE!" : `PLAYER ${w + 1} WINS!${tie}`, HeadlineColor: w < 0 ? Gold : this.sideCol[w], Victory: true,
        Value: `${a.wkts} – ${b.wkts}`, BestLine: `WICKETS · RUNS ${a.runs} – ${b.runs}`,
        Stats: [["P1 WICKETS", String(a.wkts)], ["P2 WICKETS", String(b.wkts)], ["P1 RUNS", String(a.runs)], ["P2 RUNS", String(b.runs)]],
        Primary: "REMATCH",
      }),
      score: score(win), label: w < 0 ? "TIE" : w === 0 ? "P1" : "P2", stars: stars(win),
    };
  }
}
