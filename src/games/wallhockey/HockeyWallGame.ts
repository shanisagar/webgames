import {
  Art, AudioClip, CasualFx, Color, Fmt, Fx, GameInfo, GameObject, howTo, LineRenderer, Mathf, Outline, Pal, Random, Result, Screen,
  Sfx, Snd, SpriteRenderer, Text, TextMesh, Time, TouchScheme, UIKit, UINode, V2, V3, WallHit,
} from "../../kit";
import { BumperSprite, CpuCol, P1Col, P2Col, PaddleSprite, PuckCol, PuckSprite, RinkH, RinkSprite, RinkW, ZoneSprite } from "./RinkArt";
import { Ev, GoalHalf, HH, HitReach, HW, Rink, RinkEvent, RP, SoloPaddles, StrikerAI, StrikerLevels, ThrowFlight } from "./RinkPhysics";
import { brandColor, brandWord, DiffNames, Gold, Ink, Red, RoundStep, WallGame, White } from "./WallKit";

/**
 * AIR HOCKEY WALL (LiDAR wall): the arcade air hockey table, played by throwing. One rink fills the wall with a goal
 * at each end. Player 1 throws at the left half, player 2 at the right. A ball landing near the puck shoves it away
 * from the impact point: the closer the hit, the faster the puck. FIRST TO FIVE (2:00 cap, golden goal on a tie).
 * SOLO: beat a goalie that moves on its own; every goal is a level up. VS COMPUTER: a virtual striker attacks and
 * defends the right half (its throws are drawn landing).
 */

const WinGoals = 5, RoundTime = 120, GoldenMax = 45;
const RinkScale = 0.94, RinkY = -0.55;

export class HockeyWallGame extends WallGame {
  private table!: GameObject;
  private puck!: SpriteRenderer; private puckGlow!: SpriteRenderer; private puckShadow!: SpriteRenderer;
  private trail!: LineRenderer; private trailPts: V2[] = [];
  private goalGlow: SpriteRenderer[] = [];
  private paddleViews: SpriteRenderer[] = [];
  private bumper!: SpriteRenderer;
  private zones: SpriteRenderer[] = [];
  private brand!: TextMesh;
  private fx!: CasualFx;
  private rink = new Rink();
  private ai: (StrikerAI | null)[] = [null, null];
  private inAir = [0, 0];
  private score = [0, 0];
  private clock = RoundTime;
  private golden = false;
  private level = 1;
  private celebrate = 0;
  private conceder = -1;
  private shots = [0, 0]; private topSpeed = 0;
  private lastTick = 0;
  private sounds = 0;
  private hitClip!: AudioClip; private wallClip!: AudioClip; private postClip!: AudioClip; private paddleClip!: AudioClip;
  // HUD
  private board!: UINode; private nameT: Text[] = []; private scoreT: Text[] = []; private scoreGlow: Outline[] = []; private clockT!: Text; private subT!: Text; private pop = [0, 0];
  private zoneT: Text[] = []; private zoneShow = 0;
  private layoutFrames = 3;

  protected get GameId() { return "wallhockey"; }

  protected Describe() {
    return new GameInfo({
      Id: "wallhockey",
      Title: "AIR HOCKEY WALL",
      Tagline: "THROW AT THE PUCK. SMASH IT INTO THEIR GOAL!",
      PlayLabel: "PLAY",
      Accent: P1Col,
      Accent2: P2Col,
      BgTop: Pal.hex(0x120a36),
      BgBottom: Pal.hex(0x03030c),
      GridSpacing: 1.5,
      ShortSide: 18,
      Touch: TouchScheme.None,
      Music: { bpm: 128, rootHz: 98, degrees: [0, 3, 7, 5], seed: 29, energy: 0.75, major: false },
      HowTo: [
        howTo(PuckSprite(), PuckCol, "Throw your ball near the puck: it shoots away from where your ball lands."),
        howTo(Art.Ring, Gold, "The closer you hit, the faster it flies. A direct hit drives it at the far goal."),
        howTo(Art.Square, P1Col, "Player 1 throws at the left half and defends the left goal. Player 2 owns the right."),
        howTo(Art.Star, Gold, "FIRST TO FIVE wins. 2:00 cap: a tie goes to a GOLDEN GOAL."),
        howTo(Art.Diamond, CpuCol, "SOLO: beat the goalie that moves on its own. Every goal is a level up."),
      ],
      Tips: ["Hit the side of the puck that faces your own goal to send it the other way.", "Bank it off the rails past the goalie."],
    });
  }

  protected get ShortSide() {
    const aspect = Screen.width / Math.max(1, Screen.height);
    return aspect >= 1 ? Math.max(18, 32 / aspect) : 32;
  }
  protected BestLine() { return `SOLO BEST ${this.Data.get("best0")} GOALS   ·   WINS VS COMPUTER ${this.Data.get("cpuWins")}`; }
  protected ExtraStats() { return `${this.Data.get("rounds")} ROUNDS   ·   ${Fmt.n(this.Data.get("allGoals"))} GOALS SCORED`; }
  protected ModeLine(mode: number, diff: number) {
    return mode === 0 ? "2 MINUTES VS A MOVING GOALIE: EVERY GOAL IS A LEVEL UP"
      : mode === 1 ? `YOU (LEFT) VS A ${DiffNames[diff]} COMPUTER STRIKER (RIGHT): FIRST TO FIVE`
        : "PLAYER 1 THROWS LEFT, PLAYER 2 THROWS RIGHT: FIRST TO FIVE";
  }
  protected FormatScore(n: number) { return String(n); }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.table = new GameObject("Rink", this.gameObject);
    this.table.localPosition = new V3(0, RinkY, 0);
    this.table.localScale = new V3(RinkScale, RinkScale, 1);
    const t = this.table;
    const g = Art.spr(t, "RinkGlow", Art.Glow, Pal.hex(0x3a40ff).withAlpha(0.22), RinkW * 1.25, -20, Art.Additive);
    g.transform.localScale = new V3(RinkW * 1.25, RinkH * 1.6, 1);
    Art.spr(t, "RinkArt", RinkSprite(), Color.white, RinkW, 0, Art.Flat);
    const bc = new GameObject("Brand", t);
    this.brand = bc.addComponent(new TextMesh());
    this.brand.sortingOrder = 1; this.brand.fontSize = 64; this.brand.characterSize = 0.12;
    for (let i = 0; i < 2; i++) {
      const z = Art.spr(t, "Zone" + i, ZoneSprite(), Color.clear, 5, 1, Art.Flat);
      z.transform.localPosition = new V3(i === 0 ? -HW * 0.55 : HW * 0.55, 0, 0);
      this.zones.push(z);
      const gg = Art.spr(t, "GoalGlow" + i, Art.Glow, Color.clear, 1, 2, Art.Additive);
      gg.transform.localPosition = new V3(i === 0 ? -HW : HW, 0, 0);
      gg.transform.localScale = new V3(5, GoalHalf * 4, 1);
      this.goalGlow.push(gg);
    }
    this.bumper = Art.spr(t, "Bumper", BumperSprite(), Color.white, 1.12, 4, Art.Flat);
    this.bumper.transform.localPosition = new V3(-HW - 0.3, 0, 0);
    for (let k = 0; k < 3; k++) { const p = Art.spr(t, "Paddle" + k, PaddleSprite(k === 0 ? Pal.hex(0xff7a1a) : Pal.hex(0xb06bff), "k" + Math.min(k, 1)), Color.white, 1, 6, Art.Solid); p.gameObject.setActive(false); this.paddleViews.push(p); }
    this.trail = Art.line(t, "Trail", PuckCol, RP * 1.6, 8, false, false, Art.LineMat);
    this.puckShadow = Art.spr(t, "PuckShadow", Art.Glow, new Color(0, 0, 0, 0.6), RP * 3.2, 9, Art.Flat);
    this.puckGlow = Art.spr(t, "PuckGlow", Art.Glow, PuckCol.withAlpha(0.6), RP * 5.5, 10, Art.Additive);
    this.puck = Art.spr(t, "Puck", PuckSprite(), Color.white, RP * 2 / 0.95, 12, Art.Flat);
    this.fx = CasualFx.create(t, 30, 220);
    const wfx = new GameObject("WallFx", this.gameObject);
    this.WallBuild(wfx);
    this.BuildHud();
    this.BuildSounds();
    this.rink.place(0, 0);
    this.Layout();
  }

  private BuildSounds() {
    const noise = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    this.hitClip = Sfx.make("wh-smack", 0.22, (t) => (Sfx.sinP(Sfx.glide(t, 1500, 700, 0.04)) * 0.4 + Sfx.sinP(Sfx.glide(t, 220, 90, 0.1)) * 0.6 + noise(Math.trunc(t * 44100)) * 0.6 * Sfx.env(t, 0, 0.01)) * Sfx.env(t, 0.0005, 0.08) * 0.85);
    this.wallClip = Sfx.make("wh-wall", 0.16, (t) => (Sfx.sinP(Sfx.glide(t, 420, 160, 0.05)) * 0.6 + noise(Math.trunc(t * 44100) + 5) * 0.4 * Sfx.env(t, 0, 0.012)) * Sfx.env(t, 0.001, 0.07) * 0.7);
    this.postClip = Sfx.make("wh-post", 0.3, (t) => (Sfx.sinP(1250 * t) * 0.4 + Sfx.sinP(1870 * t) * 0.3 + Sfx.sinP(2640 * t) * 0.15) * Sfx.env(t, 0.0005, 0.16) * 0.6);
    this.paddleClip = Sfx.make("wh-paddle", 0.2, (t) => (Sfx.sqrP(Sfx.glide(t, 600, 300, 0.05)) * 0.25 + Sfx.sinP(Sfx.glide(t, 300, 120, 0.1)) * 0.5) * Sfx.env(t, 0.001, 0.08) * 0.7);
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.board = UIKit.node("Scoreboard", hud).place(new V2(0.5, 1), new V2(0, -82), new V2(1000, 150));
    UIKit.img(this.board, "Bg", Art.UiRound, new Color(0.02, 0.02, 0.08, 0.9)).rectTransform.stretch();
    UIKit.img(this.board, "Edge", Art.UiOutline, new Color(0.6, 0.7, 1, 0.4)).rectTransform.stretch();
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? -1 : 1;
      this.nameT.push(UIKit.at(UIKit.label(this.board, "", 34, i === 0 ? P1Col : P2Col), UIKit.Center, new V2(x * 330, 42), new V2(330, 46)));
      const s = UIKit.at(UIKit.label(this.board, "0", 112, Color.white), UIKit.Center, new V2(x * 330, -20), new V2(260, 120));
      this.scoreGlow.push(UIKit.glow(s, i === 0 ? P1Col : P2Col, 5));
      this.scoreT.push(s);
    }
    this.clockT = UIKit.at(UIKit.label(this.board, "2:00", 92, White), UIKit.Center, new V2(0, 10), new V2(300, 110));
    UIKit.glow(this.clockT, Ink, 4);
    this.subT = UIKit.at(UIKit.label(this.board, "FIRST TO 5", 28, Gold), UIKit.Center, new V2(0, -52), new V2(320, 36));
    for (let i = 0; i < 2; i++) {
      const z = UIKit.at(UIKit.label(hud, "", 64, Color.white), UIKit.Center, V2.zero, new V2(900, 90));
      z.raycastTarget = false;
      UIKit.glow(z, Ink, 4);
      this.zoneT.push(z);
    }
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); this.layoutFrames = 2; }

  private Layout() {
    if (!this.board) return;
    this.LayoutWall();
    // the scoreboard sits just above the rink
    const rinkTop = this.UI.WorldToHud(new V2(0, RinkY + (HH + 0.75) * RinkScale)).y;
    this.board.place(UIKit.Center, new V2(0, rinkTop + 78), new V2(1000, 150));
    const k = Math.min(1, (this.UI.WorldToHud(new V2(16, 0)).x - this.UI.WorldToHud(new V2(-16, 0)).x) / 1920);
    this.board.localScale = new V3(k, k, 1);
    for (let i = 0; i < 2; i++) {
      this.zoneT[i].rectTransform.anchoredPosition = this.UI.WorldToHud(this.RinkToWorld(new V2((i === 0 ? -1 : 1) * HW * 0.55, -3.2)));
      this.zoneT[i].rectTransform.localScale = new V3(k, k, 1);
    }
  }

  private RinkToWorld(p: V2) { return new V2(p.x * RinkScale, RinkY + p.y * RinkScale); }
  private WorldToRink(w: V2) { return new V2(w.x / RinkScale, (w.y - RinkY) / RinkScale); }

  // ------------------------------------------------------------------ rounds

  protected OnTitle() {
    this.rink = new Rink();
    this.rink.place(0, 0, Random.range(-14, 14), Random.range(-8, 8));
    this.SetPaddles(0);
    this.bumper.gameObject.setActive(false);
    this.trailPts = [];
    this.ApplyBrand();
    this.zoneShow = 0;
  }

  private ApplyBrand() {
    const w = brandWord("ARCADE"), c = brandColor(this.Info.Accent);
    this.brand.text = w;
    this.brand.color = Color.lerp(c, Color.white, 0.35).withAlpha(0.95);
    this.brand.characterSize = w.length > 7 ? 0.17 * 7 / w.length : 0.17;
  }

  protected SetupRound() {
    this.rink = new Rink();
    this.rink.leftOpen = this.mode !== 0 || this.demo;
    this.score = [0, 0];
    this.clock = RoundTime;
    this.golden = false;
    this.level = 1;
    this.celebrate = 0;
    this.shots = [0, 0]; this.topSpeed = 0;
    this.inAir = [0, 0];
    this.trailPts = [];
    const solo = this.mode === 0 && !this.demo;
    this.ai = this.demo ? [new StrikerAI(StrikerLevels[1], 0), new StrikerAI(StrikerLevels[1], 1)]
      : this.mode === 1 ? [null, new StrikerAI(StrikerLevels[this.diff], 1)] : [null, null];
    this.SetPaddles(solo ? 1 : 0);
    this.bumper.gameObject.setActive(solo);
    this.rink.place(solo ? -5 : 0, 0);
    const names = this.Names();
    for (let i = 0; i < 2; i++) { this.nameT[i].text = names[i]; this.nameT[i].color = this.SideCol(i); this.scoreGlow[i].effectColor = this.SideCol(i); }
    this.subT.text = solo ? "BEAT THE GOALIE" : `FIRST TO ${WinGoals}`;
    this.zoneT[0].text = this.demo ? "COMPUTER 1" : solo ? "THROW ANYWHERE!" : this.mode === 1 ? "YOU THROW HERE" : "PLAYER 1 THROWS HERE";
    this.zoneT[1].text = this.demo ? "COMPUTER 2" : solo ? "" : this.mode === 1 ? "COMPUTER'S HALF" : "PLAYER 2 THROWS HERE";
    this.zoneShow = 1;
    this.ApplyBrand();
    this.Layout();
    this.UpdateHud();
  }

  private Names() {
    if (this.demo) return ["COMPUTER 1", "COMPUTER 2"];
    if (this.mode === 0) return ["GOALS", "LEVEL"];
    if (this.mode === 1) return ["YOU", `COMPUTER · ${DiffNames[this.diff]}`];
    return ["PLAYER 1", "PLAYER 2"];
  }
  private SideCol(i: number) { return i === 0 ? P1Col : this.mode === 1 || this.demo ? CpuCol : P2Col; }

  private SetPaddles(level: number) {
    this.rink.paddles = level > 0 ? SoloPaddles(level) : [];
    for (let k = 0; k < this.paddleViews.length; k++) this.paddleViews[k].gameObject.setActive(k < this.rink.paddles.length);
  }

  // ------------------------------------------------------------------ frame

  protected TickIdle(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    // the puck drifts around the empty table behind the title
    const r = this.rink;
    r.events.length = 0;
    r.step(Math.min(dt, 0.05));
    if (r.speed < 6) { const a = Random.range(0, Math.PI * 2); r.vx += Math.cos(a) * 12; r.vy += Math.sin(a) * 12; }
    if (r.goal >= 0 || !r.puckOn) r.place(0, 0, Random.range(-14, 14), Random.range(-8, 8));
    r.events.length = 0;
    this.Present(dt);
  }

  protected TickRound(dt: number, hits: WallHit[], live: boolean) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    this.sounds = 0;
    const r = this.rink;
    const play = live && this.step === RoundStep.Play;
    if (play) {
      if (this.celebrate > 0) {
        this.celebrate -= dt;
        if (this.celebrate <= 0) this.Faceoff();
      } else {
        this.clock -= dt;
        if (this.clock <= 10 && this.clock > 0 && !this.golden && Math.ceil(this.clock) !== this.lastTick) { this.lastTick = Math.ceil(this.clock); Sfx.play(Snd.Tick, 0.8, 1.3); }
      }
      for (const h of hits) this.OnHit(h);
      for (let i = 0; i < 2; i++) {
        const ai = this.ai[i];
        if (!ai) continue;
        const aim = ai.think(r, dt, this.inAir[i] > 0);
        if (aim) this.CpuThrow(i, new V2(aim[0], aim[1]));
      }
      r.step(dt);
      for (const e of r.events) this.OnEvent(e);
      r.events.length = 0;
      this.topSpeed = Math.max(this.topSpeed, r.speed);
      if (r.goal >= 0 && this.celebrate <= 0) this.OnGoal(r.goal);
      if (this.clock <= 0 && this.celebrate <= 0) this.ClockOut();
    } else {
      r.events.length = 0;
    }
    this.zoneShow = Math.max(0, this.zoneShow - (play ? dt * 0.4 : 0));
    this.UpdateHud();
    this.Present(dt);
  }

  private ClockOut() {
    const solo = this.mode === 0 && !this.demo;
    if (!solo && this.score[0] === this.score[1] && !this.golden) {
      this.golden = true;
      this.clock = GoldenMax;
      this.call.show("GOLDEN GOAL!", Gold, 1.5, 200);
      Sfx.playClip(this.snd.whistle, 1);
      return;
    }
    this.clock = 0;
    this.EndRound();
  }

  // ------------------------------------------------------------------ hits

  private OnHit(h: WallHit) {
    let owner: number;
    if (this.mode === 0) owner = 0;
    else if (this.mode === 1) { if (h.side === 1) { this.marks.mark(h.world, Pal.TextDim, false); this.UI.Toast("THE RIGHT HALF IS THE COMPUTER'S. THROW LEFT!", 1.5); return; } owner = 0; }
    else owner = h.side;
    this.Strike(owner, h.world);
  }

  private CpuThrow(side: number, rinkPt: V2) {
    const target = this.RinkToWorld(rinkPt);
    const from = new V2((side === 0 ? -1 : 1) * Random.range(6, 13), -12);
    this.inAir[side]++;
    this.throws.throwAt(from, target, this.SideCol(side), side === 0 ? "c0" : "c1", ThrowFlight, (p) => {
      this.inAir[side] = Math.max(0, this.inAir[side] - 1);
      if (this.step === RoundStep.Play) this.Strike(side, p);
    });
  }

  /** A ball lands at world point w for player `owner`. */
  private Strike(owner: number, w: V2) {
    const col = this.SideCol(owner);
    const p = this.WorldToRink(w);
    const toward = owner === 0 ? 1 : -1;
    const speed = this.celebrate > 0 ? 0 : this.rink.hit(p.x, p.y, owner, toward);
    if (speed <= 0) {
      this.marks.mark(w, col, false, 1.2);
      Sfx.playClip(this.snd.thud, 0.45, 0.9 + Math.random() * 0.2);
      return;
    }
    this.shots[owner]++;
    const k = Mathf.clamp01(speed / 44);
    this.marks.mark(w, col, true, 1.2 + k * 0.8);
    const pp = new V2(this.rink.px, this.rink.py);
    this.fx.pop(pp, Color.lerp(col, Color.white, 0.4), 8 + Math.round(k * 14), 4 + k * 9, 0.2, 0.4);
    this.fx.sparkle(pp, PuckCol, 4 + Math.round(k * 8), 0.8, 0.35);
    this.Fx.ring(this.RinkToWorld(pp), col, 0.5, 4 + k * 4, 0.4);
    Sfx.playClip(this.hitClip, 0.5 + 0.5 * k, 0.8 + k * 0.5);
    Sfx.playClip(this.snd.thud, 0.6, 1);
    this.Fx.shake(0.1 + k * 0.35);
    Fx.haptic(k > 0.6);
    if (k > 0.75) {
      this.Hitstop(0.04);
      this.UI.Float(this.RinkToWorld(pp).add(new V2(0, 1.8)), `${Math.round(speed * 3.2)} KM/H`, Gold, 1.3);
    }
  }

  private OnEvent(e: RinkEvent) {
    if (this.sounds >= 3) return;
    const p = new V2(e.x, e.y);
    if (e.type === Ev.Wall || e.type === Ev.Post) {
      this.sounds++;
      Sfx.playClip(e.type === Ev.Post ? this.postClip : this.wallClip, Mathf.clamp01(e.speed / 35) * 0.8, 0.9 + Math.random() * 0.2);
      if (e.speed > 14) this.fx.sparkle(p, White, 3 + Math.round(e.speed / 10), 0.4, 0.25);
      if (e.speed > 30) this.Fx.shake(0.12);
    } else if (e.type === Ev.Paddle) {
      this.sounds++;
      Sfx.playClip(this.paddleClip, 0.8);
      this.fx.pop(p, Pal.hex(0xff9a3c), 10, 5, 0.18, 0.35);
      if (this.mode === 0 && !this.demo) this.UI.Float(this.RinkToWorld(p).add(new V2(-1, 1.2)), "BLOCKED!", Pal.hex(0xff9a3c), 1.2);
    }
  }

  private OnGoal(goal: number) {
    const scorer = goal === 0 ? 1 : 0;
    const solo = this.mode === 0 && !this.demo;
    const gp = new V2(goal === 0 ? -HW : HW, 0);
    const col = this.SideCol(scorer);
    this.goalGlow[goal].color = col.withAlpha(1);
    this.fx.confetti(gp, 70, 9, [col, Color.white, Gold], 0.3);
    this.fx.pop(gp, col, 30, 10, 0.3, 0.6);
    this.Fx.shake(0.6);
    this.Back.Flash(col, 0.45);
    Fx.haptic(true);
    this.Hitstop(0.08);
    Sfx.playClip(this.snd.horn, 0.7);
    Sfx.playClip(this.snd.cheer, this.demo ? 0.35 : 0.9);
    this.score[scorer]++;
    this.pop[scorer] = 1;
    this.trailPts = [];
    this.celebrate = 1.9;
    this.conceder = goal;
    if (solo) {
      this.level++;
      this.call.show("GOAL!", Gold, 1.4, 320);
      this.UI.Toast(`LEVEL ${this.level}: THE GOALIE GETS FASTER`, 1.8);
      return;
    }
    const names = this.Names();
    const final = this.score[scorer] >= WinGoals || this.golden;
    this.call.show(final ? "GOAL!" : this.mode === 1 && scorer === 1 && !this.demo ? "COMPUTER SCORES" : "GOAL!", col, 1.4, final || scorer === 0 || this.mode !== 1 ? 320 : 170);
    if (!final) this.UI.Toast(`${names[scorer]} SCORES!   ${this.score[0]} – ${this.score[1]}`, 1.6);
    if (final) { this.celebrate = 0; this.EndRound("WINNER!"); }
  }

  private Faceoff() {
    const solo = this.mode === 0 && !this.demo;
    if (solo) this.SetPaddles(this.level);
    // the puck comes back in the half of the team that conceded
    const x = solo ? -5 : this.conceder === 0 ? -4.5 : 4.5;
    this.rink.place(x, Random.range(-1.5, 1.5));
    this.fx.sparkle(new V2(x, 0), PuckCol, 12, 1.2, 0.4);
    Sfx.play(Snd.Pickup, 0.6);
  }

  // ------------------------------------------------------------------ rendering

  private Present(dt: number) {
    const r = this.rink;
    const on = r.puckOn && this.celebrate <= 0;
    for (const s of [this.puck, this.puckGlow, this.puckShadow]) s.gameObject.setActive(on);
    const sp = r.speed;
    if (r.puckOn) {
      const pp = new V3(r.px, r.py, 0);
      this.puck.transform.localPosition = pp;
      this.puckGlow.transform.localPosition = pp;
      this.puckShadow.transform.localPosition = new V3(r.px + 0.12, r.py - 0.18, 0);
      this.puckGlow.color = PuckCol.withAlpha(0.35 + 0.5 * Mathf.clamp01(sp / 40));
      this.puck.transform.localEulerZ = this.puck.transform.localEulerZ + sp * dt * 20;
      this.trailPts.push(new V2(r.px, r.py));
    }
    while (this.trailPts.length > 14 || (this.trailPts.length > 0 && (!r.puckOn || sp < 3))) this.trailPts.shift();
    if (this.trailPts.length >= 2) {
      this.trail.positionCount = this.trailPts.length;
      for (let i = 0; i < this.trailPts.length; i++) this.trail.setPosition(i, this.trailPts[i]);
      const k = Mathf.clamp01(sp / 44);
      this.trail.startColor = PuckCol.withAlpha(0);
      this.trail.endColor = Color.lerp(PuckCol, Pal.hex(0xff5a2a), k).withAlpha(0.55 + 0.45 * k);
      this.trail.widthMultiplier = RP * 1.7 * RinkScale;
      this.trail.startWidth = 0.2; this.trail.endWidth = 1.4;
    } else this.trail.positionCount = 0;
    for (let i = 0; i < 2; i++) this.goalGlow[i].color = this.goalGlow[i].color.withAlpha(Mathf.moveTowards(this.goalGlow[i].color.a, 0, dt * 0.7));
    for (let k = 0; k < r.paddles.length && k < this.paddleViews.length; k++) {
      const p = r.paddles[k], v = this.paddleViews[k];
      v.transform.localPosition = new V3(p.x, p.y, 0);
      v.transform.localScale = new V3(p.r * 2 / 0.8, (p.half * 2 + p.r * 2) / 3.85, 1);
    }
    for (let i = 0; i < 2; i++) {
      const z = this.zones[i];
      const show = this.zoneShow > 0 && this.zoneT[i].text !== "";
      z.color = this.SideCol(i).withAlpha(show ? 0.35 * Mathf.clamp01(this.zoneShow * 2) * (0.75 + 0.25 * Math.sin(Time.time * 5)) : 0);
      this.zoneT[i].color = this.SideCol(i).withAlpha(show ? Mathf.clamp01(this.zoneShow * 2) : 0);
    }
  }

  private UpdateHud() {
    const solo = this.mode === 0 && !this.demo;
    for (let i = 0; i < 2; i++) {
      this.scoreT[i].text = solo && i === 1 ? String(this.level) : String(this.score[i]);
      this.pop[i] = Math.max(0, this.pop[i] - Time.deltaTime * 2);
      const s = 1 + 0.45 * this.pop[i];
      this.scoreT[i].rectTransform.localScale = new V3(s, s, 1);
    }
    this.clockT.text = this.golden ? "GOLDEN" : Fmt.clock(Math.ceil(Math.max(0, this.clock)));
    this.clockT.fontSize = this.golden ? 60 : 92;
    this.clockT.color = (this.clock <= 10 && !this.golden) || this.golden ? Color.lerp(this.golden ? Gold : Red, Color.white, 0.5 + 0.5 * Math.sin(Time.time * 10)) : White;
  }

  // ------------------------------------------------------------------ results

  protected RoundResult() {
    const [a, b] = this.score;
    this.Data.add("allGoals", a + (this.mode === 2 ? b : 0));
    const top = `${Math.round(this.topSpeed * 3.2)} KM/H`;
    if (this.mode === 0) {
      const best = this.Data.max("best0", a);
      const st = a >= 10 ? 3 : a >= 6 ? 2 : a >= 3 ? 1 : 0;
      return {
        result: new Result({
          Headline: st >= 2 ? "SHARPSHOOTER!" : a > 0 ? "NICE SHOOTING!" : "THE GOALIE WINS THIS TIME", HeadlineColor: Gold, Value: String(a), Stars: st,
          NewBest: best && a > 0, Victory: st > 0, BestLine: `${a} GOALS   ·   LEVEL ${this.level}   ·   BEST ${this.Data.get("best0")}`,
          Stats: [["GOALS", String(a)], ["LEVEL REACHED", String(this.level)], ["THROWS ON THE PUCK", String(this.shots[0])], ["TOP SPEED", top]],
          Primary: "PLAY AGAIN",
        }),
        score: a, label: "SOLO",
      };
    }
    const w = a === b ? -1 : a > b ? 0 : 1;
    const score = `${a} – ${b}`;
    const margin = Math.abs(a - b);
    if (this.mode === 1) {
      const won = w === 0;
      if (won) this.Data.add("cpuWins", 1);
      this.Data.max("best1", a);
      return {
        result: new Result({
          Headline: won ? "YOU WIN!" : w < 0 ? "IT'S A DRAW!" : "THE COMPUTER WINS", HeadlineColor: won ? Gold : w < 0 ? White : Pal.hex(0xffb0c0),
          Value: score, Stars: won ? (margin >= 3 ? 3 : 2) : w < 0 ? 1 : 0, Victory: won, BestLine: `${score}   ·   ${DiffNames[this.diff]}`,
          Stats: [["YOUR GOALS", String(a)], ["COMPUTER GOALS", String(b)], ["YOUR PUCK HITS", String(this.shots[0])], ["TOP SPEED", top]],
          Primary: won ? "PLAY AGAIN" : "REMATCH",
        }),
        score: a, label: "VS CPU",
      };
    }
    return {
      result: new Result({
        Headline: w < 0 ? "IT'S A DRAW!" : `PLAYER ${w + 1} WINS!`, HeadlineColor: w < 0 ? Gold : this.SideCol(w), Value: score,
        Stars: w < 0 ? 1 : margin >= 4 ? 3 : margin >= 2 ? 2 : 1, Victory: true, BestLine: score,
        Stats: [["PLAYER 1 GOALS", String(a)], ["PLAYER 2 GOALS", String(b)], ["PUCK HITS P1 / P2", `${this.shots[0]} / ${this.shots[1]}`], ["TOP SPEED", top]],
        Primary: "REMATCH",
      }),
      score: Math.max(a, b), label: w < 0 ? "P1 & P2" : `P${w + 1}`,
    };
  }

  // ------------------------------------------------------------------ test hooks

  /** Puck (CSS point) and velocity for scripted play: window.__na.game.TestPuck(). */
  TestPuck(ahead = 0) {
    const [x, y] = ahead > 0 ? this.rink.predict(ahead) : [this.rink.px, this.rink.py];
    const w = this.RinkToWorld(new V2(x, y));
    const sp = (window as unknown as { __na: { Camera: { worldToScreen(v: V2): V2 } } }).__na.Camera.worldToScreen(w);
    const el = Screen.el?.getBoundingClientRect();
    const toCss = (q: V2) => { const s = (window as unknown as { __na: { Camera: { worldToScreen(v: V2): V2 } } }).__na.Camera.worldToScreen(q); return { x: (el?.left ?? 0) + s.x / Screen.dpr, y: (el?.top ?? 0) + s.y / Screen.dpr }; };
    const unit = toCss(this.RinkToWorld(new V2(x + 1, y)));
    const c = { x: (el?.left ?? 0) + sp.x / Screen.dpr, y: (el?.top ?? 0) + sp.y / Screen.dpr };
    return { x: c.x, y: c.y, unit: unit.x - c.x, vx: this.rink.vx, vy: this.rink.vy, on: this.rink.puckOn && this.celebrate <= 0, rx: x, ry: y, reach: HitReach };
  }
  TestState() { return { state: this.State, step: this.step, demo: this.demo, clock: this.clock, mode: this.mode, score: this.score.slice(), level: this.level, golden: this.golden, idle: this.idleSeconds }; }
  TestSkip(seconds: number) { this.clock = Math.min(this.clock, seconds); }
}
