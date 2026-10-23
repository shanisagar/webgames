import {
  Art, CasualFx, Color, Fmt, Fx, GameInfo, GameObject, howTo, Image, Keyboard, Mathf, Mouse, overUI, Pal, Random, Result,
  Screen, Sfx, Snd, SpriteRenderer, SysRandom, Text, TextMesh, Time, Touchscreen, TouchScheme, UIKit, UINode, V2, V3, WallHit,
} from "../../kit";
import {
  BeachBall, BodySprite, BonkSprite, BubbleSprite, CpuCol, DodgeBall, FeetY, FootSprite, KidHead, KidLeg, Lime,
  NoodleSprite, P1Col, P2Col, PowerSprite, SceneSprite, WarnSprite,
} from "./DodgeArt";
import { brandColor, brandWord, DiffNames, Gold, Ink, Red, RoundStep, WallGame, White } from "./WallKit";

/**
 * DODGEBALL DASH (LiDAR wall + floor strip): the playground dodgeball game, with no stinging. Each player has a lane
 * on the wall and a strip of floor in front of it; a floor-facing LiDAR reports their feet as touches in the
 * projected floor strip, and their avatar follows them along the lane. Soft balls, beach balls and foam noodles drop
 * down the wall at the avatar: step aside to dodge, step under power-ups to catch them. Three lives with a moment of
 * invulnerability after each bonk. SOLO: survive as long as you can. VS COMPUTER: a virtual runner dodges in the
 * other lane. 2 PLAYERS: split wall. The score is seconds survived plus bonus seconds; the higher score wins.
 *
 * Input: live positions, not ball hits: Touchscreen.touches (the floor sensor's touch points; left half = P1, right
 * half = P2), the mouse pointer position (laptop demo), keyboard A/D (P1) and arrows (P2).
 */

const RoundTime = 120, StartLives = 3, MaxLives = 5, Invuln = 1.6;
const KidScale = 1.25, KidR = 0.55 * KidScale, KidLow = FeetY + 0.45 * KidScale, KidHigh = FeetY + 2.55 * KidScale;
const BallCols = [Pal.hex(0xff4d5e), Pal.hex(0x9b6bff), Pal.hex(0xff8a2e), Pal.hex(0x2ec4b6)];
const RunnerReact = [0.3, 0.12, 0.05], RunnerSpeed = [12, 18, 22], RunnerLook = [0.9, 1.3, 1.8], RunnerSlip = [0.1, 0.035, 0.01];
const PowerNames = ["+3 SEC", "+1 LIFE", "SHIELD", "SLOW-MO"];

enum Kind { Ball, Beach, Noodle, Power }

interface Obj {
  kind: Kind; x: number; y: number; vx: number; vy: number; r: number; w: number; power: number;
  sr: SpriteRenderer; warn: SpriteRenderer; spin: number; alive: boolean; fade: number; bounced: boolean; passed: boolean;
}

interface Kid {
  root: GameObject; body: SpriteRenderer; head: SpriteRenderer; dizzy: SpriteRenderer; legs: GameObject[]; bubble: SpriteRenderer;
  foot: SpriteRenderer; bonk: SpriteRenderer[]; x: number; vx: number; target: number; run: number; lean: number; squash: number;
}

interface Lane {
  idx: number; cx: number; half: number; col: Color; name: string; cpu: number;
  root: GameObject; scene: SpriteRenderer; floorText: TextMesh; dim: SpriteRenderer;
  kid: Kid; objs: Obj[];
  lives: number; time: number; bonus: number; out: boolean; invuln: number; shield: number; slow: number;
  dodged: number; powers: number; hitsTaken: number; aiT: number; aiTarget: number;
  touchX: number; touchT: number;
  panel: UINode; nameT: Text; scoreT: Text; hearts: Image[]; pop: number;
}

export class DodgeGame extends WallGame {
  private lanes: Lane[] = [];
  private world!: GameObject;
  private soloScene!: SpriteRenderer;
  private divider!: SpriteRenderer;
  private fx!: CasualFx;
  private clock = RoundTime;
  private elapsed = 0;
  private spawnT = 0;
  private powerT = 6;
  private rng = new SysRandom(1);
  private split = true;
  private timerPanel!: UINode; private timerT!: Text; private timerCap!: Text;
  private bestPanel!: UINode; private bestT!: Text;
  private mouseActive = false; private lastMouse = V2.zero;
  private lastTick = 0;
  private layoutFrames = 3;
  private bonkClip = Sfx.make("wd-boing", 0.45, (t) => (Sfx.sinP(Sfx.glide(t, 520, 180, 0.35)) * 0.6 + Sfx.triP(Sfx.glide(t, 1040, 360, 0.3)) * 0.2) * Sfx.env(t, 0.002, 0.3) * 0.6);

  protected get GameId() { return "walldodge"; }
  protected get MarkStrayHits() { return false; }

  protected Describe() {
    return new GameInfo({
      Id: "walldodge",
      Title: "DODGEBALL DASH",
      Tagline: "STEP LEFT, STEP RIGHT: DON'T GET BONKED!",
      PlayLabel: "PLAY",
      Accent: Pal.hex(0xff5a6e),
      Accent2: P1Col,
      BgTop: Pal.hex(0x5ab8f5),
      BgBottom: Pal.hex(0x1d3b5a),
      GridSpacing: 2,
      ShortSide: 18,
      Touch: TouchScheme.None,
      Music: { bpm: 132, rootHz: 130.8, degrees: [0, 4, 5, 3], seed: 33, energy: 0.8, major: true },
      HowTo: [
        howTo(FootSprite(), Lime, "Stand on your strip of floor: your player follows you. On a laptop, move the mouse (or A/D, arrows)."),
        howTo(DodgeBall(BallCols[0], "r"), BallCols[0], "Soft balls, beach balls and foam noodles drop at you. Step aside to dodge!"),
        howTo(PowerSprite(0), Gold, "Step under power-ups: +3 SEC, +1 LIFE, SHIELD and SLOW-MO."),
        howTo(Art.Disc, Red, "Three lives. After a bonk you blink for a moment and nothing can hit you."),
        howTo(Art.Square, P2Col, "2 PLAYERS / VS COMPUTER: one lane each. Seconds survived + bonus: the higher score wins."),
      ],
      Tips: ["Stay near the middle of your lane: you can step either way.", "Noodles leave a gap: find it early."],
    });
  }

  protected get ShortSide() {
    const aspect = Screen.width / Math.max(1, Screen.height);
    return aspect >= 1 ? Math.max(18, 32 / aspect) : 32;
  }
  protected BestLine() { return `SOLO BEST ${this.FormatScore(this.Data.get("best0"))}   ·   WINS VS COMPUTER ${this.Data.get("cpuWins")}`; }
  protected ExtraStats() { return `${this.Data.get("rounds")} ROUNDS   ·   ${Fmt.n(this.Data.get("dodged"))} THINGS DODGED`; }
  protected ModeLine(mode: number, diff: number) {
    return mode === 0 ? "ONE BIG LANE: SURVIVE AS LONG AS YOU CAN"
      : mode === 1 ? `YOU (LEFT LANE) VS A ${DiffNames[diff]} COMPUTER RUNNER (RIGHT): 2 MINUTES`
        : "PLAYER 1 LEFT LANE, PLAYER 2 RIGHT LANE: 2 MINUTES, HIGHER SCORE WINS";
  }
  /** Board scores are tenths of a second. */
  protected FormatScore(n: number) { return (n / 10).toFixed(1) + "s"; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("World", this.gameObject);
    this.soloScene = Art.spr(this.world, "SoloScene", Art.Square, Color.white, 1, -800, Art.Flat);
    this.soloScene.gameObject.setActive(false);
    for (let i = 0; i < 2; i++) this.lanes.push(this.MakeLane(i));
    this.divider = Art.spr(this.world, "Divider", Art.Square, new Color(0.1, 0.12, 0.25, 1), 1, 30, Art.Flat);
    this.divider.transform.localScale = new V3(0.3, 18.2, 1);
    this.fx = CasualFx.create(this.world, 60, 220);
    const wfx = new GameObject("WallFx", this.world);
    this.WallBuild(wfx);
    this.BuildHud();
    this.SetView(this.Data.get("mode", 1) === 0 ? 0 : 2);
  }

  private MakeLane(i: number): Lane {
    const root = new GameObject("Lane" + i, this.world);
    const scene = Art.spr(root, "Scene", SceneSprite(8), Color.white, 16, -800, Art.Flat);
    const ft = new GameObject("FloorText", root);
    ft.localPosition = new V3(0, -7.75, 0);
    const floorText = ft.addComponent(new TextMesh());
    floorText.sortingOrder = -700; floorText.fontSize = 64; floorText.characterSize = 0.15;
    const sign = new GameObject("Sign", root);
    sign.localPosition = new V3(-2.5, 1.75, 0);
    const brand = sign.addComponent(new TextMesh());
    brand.sortingOrder = -790; brand.fontSize = 64; brand.characterSize = 0.13;
    brand.text = brandWord("PLAYGROUND"); brand.color = brandColor(this.Info.Accent);
    if (brand.text.length > 10) brand.characterSize = 0.13 * 10 / brand.text.length;
    const dim = Art.spr(root, "Dim", Art.Square, new Color(0.05, 0.05, 0.15, 0), 1, 45, Art.Flat);
    dim.transform.localScale = new V3(16, 18, 1);
    const kid = this.MakeKid(root, i);
    return {
      idx: i, cx: 0, half: 7.4, col: P1Col, name: "", cpu: -1, root, scene, floorText, dim, kid, objs: [],
      lives: StartLives, time: 0, bonus: 0, out: false, invuln: 0, shield: 0, slow: 0, dodged: 0, powers: 0, hitsTaken: 0, aiT: 0, aiTarget: 0,
      touchX: 0, touchT: -9, panel: null!, nameT: null!, scoreT: null!, hearts: [], pop: 0,
    };
  }

  private MakeKid(parent: GameObject, i: number): Kid {
    const root = new GameObject("Kid" + i, parent);
    const foot = Art.spr(root, "Foot", FootSprite(), Color.white, 2.6, 2, Art.Flat);
    foot.transform.localPosition = new V3(0, FeetY - 0.05, 0);
    const legs: GameObject[] = [];
    for (const lx of [-0.24, 0.24]) {
      const g = new GameObject("Leg", root);
      g.localPosition = new V3(lx, FeetY + 1.05, 0);
      const s = Art.spr(g, "Spr", KidLeg(), Color.white, 0.36, 20, Art.Flat);
      s.transform.localPosition = new V3(0, -0.36 * 1.5 * 0.9, 0);
      legs.push(g);
    }
    const col = i === 0 ? P1Col : P2Col;
    const body = Art.spr(root, "Body", BodySprite(col, "k" + i), Color.white, 1.3, 21, Art.Flat);
    body.transform.localPosition = new V3(0, FeetY + 1.75, 0);
    const head = Art.spr(root, "Head", KidHead(col, "k" + i, false), Color.white, 1.35, 22, Art.Flat);
    head.transform.localPosition = new V3(0, FeetY + 2.85, 0);
    const dizzy = Art.spr(root, "Dizzy", KidHead(col, "k" + i, true), Color.white, 1.35, 23, Art.Flat);
    dizzy.transform.localPosition = new V3(0, FeetY + 2.85, 0);
    dizzy.gameObject.setActive(false);
    const bubble = Art.spr(root, "Bubble", BubbleSprite(), Color.clear, 3.6, 24, Art.Flat);
    bubble.transform.localPosition = new V3(0, FeetY + 1.6, 0);
    const bonk: SpriteRenderer[] = [];
    for (let k = 0; k < 3; k++) { const b = Art.spr(root, "Bonk", BonkSprite(), Color.clear, 0.45, 25, Art.Flat); bonk.push(b); }
    return { root, body, head, dizzy, legs, bubble, foot, bonk, x: 0, vx: 0, target: 0, run: 0, lean: 0, squash: 0 };
  }

  /** Recolours a lane's kid (P1 blue, P2 pink, computer orange). */
  private DressKid(l: Lane) {
    const key = l.col === P1Col ? "p1" : l.col === P2Col ? "p2" : "cpu";
    l.kid.body.sprite = BodySprite(l.col, key);
    l.kid.head.sprite = KidHead(l.col, key, false);
    l.kid.dizzy.sprite = KidHead(l.col, key, true);
    l.kid.foot.color = l.col.withAlpha(0.85);
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.timerPanel = UIKit.node("Timer", hud).place(UIKit.Center, V2.zero, new V2(300, 150));
    UIKit.img(this.timerPanel, "Bg", Art.UiRound, new Color(0.02, 0.04, 0.12, 0.88)).rectTransform.stretch();
    UIKit.img(this.timerPanel, "Edge", Art.UiOutline, Gold.withAlpha(0.6)).rectTransform.stretch();
    this.timerT = UIKit.at(UIKit.label(this.timerPanel, "2:00", 92, White), UIKit.Center, new V2(0, 8), new V2(300, 110));
    this.timerCap = UIKit.at(UIKit.label(this.timerPanel, "", 26, Gold), UIKit.Center, new V2(0, -52), new V2(300, 36));
    for (const l of this.lanes) {
      l.panel = UIKit.node("Lane" + l.idx, hud).place(UIKit.Center, V2.zero, new V2(440, 190));
      UIKit.img(l.panel, "Bg", Art.UiRound, new Color(0.02, 0.04, 0.12, 0.86)).rectTransform.stretch();
      UIKit.img(l.panel, "Edge", Art.UiOutline, Color.white.withAlpha(0.5)).rectTransform.stretch();
      l.nameT = UIKit.at(UIKit.label(l.panel, "", 34, White), new V2(0.5, 1), new V2(0, -30), new V2(430, 44));
      l.scoreT = UIKit.at(UIKit.label(l.panel, "0.0", 96, White), UIKit.Center, new V2(0, -6), new V2(430, 100));
      UIKit.glow(l.scoreT, Ink, 5);
      for (let k = 0; k < MaxLives; k++) {
        const h = UIKit.img(l.panel, "Heart", PowerSprite(1), Color.white);
        h.rectTransform.place(UIKit.Center, new V2((k - 2) * 62, -66), new V2(52, 52));
        l.hearts.push(h);
      }
    }
    this.bestPanel = UIKit.node("Best", hud).place(UIKit.Center, V2.zero, new V2(440, 190));
    UIKit.img(this.bestPanel, "Bg", Art.UiRound, new Color(0.02, 0.04, 0.12, 0.86)).rectTransform.stretch();
    UIKit.img(this.bestPanel, "Edge", Art.UiOutline, Gold.withAlpha(0.5)).rectTransform.stretch();
    UIKit.at(UIKit.label(this.bestPanel, "TODAY'S BEST", 32, Gold), new V2(0.5, 1), new V2(0, -32), new V2(430, 44));
    this.bestT = UIKit.at(UIKit.label(this.bestPanel, "—", 90, White), UIKit.Center, new V2(0, -22), new V2(430, 100));
  }

  // ------------------------------------------------------------------ layout

  private SetView(mode: number) {
    this.split = mode !== 0;
    this.lanes.forEach((l, i) => {
      l.cx = this.split ? (i === 0 ? -8 : 8) : 0;
      l.half = this.split ? 7.4 : 15;
      l.root.localPosition = new V3(l.cx, 0, 0);
      l.root.setActive(this.split || i === 0);
      l.scene.gameObject.setActive(this.split);
      l.dim.transform.localScale = new V3(this.split ? 16 : 32, 18, 1);
    });
    this.soloScene.gameObject.setActive(!this.split);
    if (!this.split) { this.soloScene.sprite = SceneSprite(16); this.soloScene.transform.localScale = new V3(32, 32, 1); }
    this.divider.gameObject.setActive(this.split);
    this.Layout();
  }

  protected OnLayoutChanged() { this.Layout(); this.layoutFrames = 2; }

  private Layout() {
    if (!this.timerPanel) return;
    this.LayoutWall();
    const at = (x: number, y: number) => this.UI.WorldToHud(new V2(x, y));
    const top = 7.3;
    if (this.split) {
      for (const l of this.lanes) { l.panel.setActive(true); l.panel.anchoredPosition = at(l.cx, top); }
      this.bestPanel.setActive(false);
    } else {
      this.lanes[0].panel.setActive(true);
      this.lanes[0].panel.anchoredPosition = at(-10.6, top);
      this.lanes[1].panel.setActive(false);
      this.bestPanel.setActive(true);
      this.bestPanel.anchoredPosition = at(10.6, top);
    }
    this.timerPanel.place(UIKit.Center, at(0, top), new V2(300, 150));
  }

  // ------------------------------------------------------------------ rounds

  protected OnTitle() {
    this.ClearObjs();
    this.SetView(this.Data.get("mode", 1) === 0 ? 0 : 2);
    for (const l of this.lanes) this.ResetKid(l);
  }

  protected RefreshTitle() {
    super.RefreshTitle();
    const v = this.Data.get("mode", 1) === 0 ? 0 : 2;
    if ((v === 0) === this.split) this.SetView(v);
  }

  protected SetupRound() {
    this.ClearObjs();
    this.SetView(this.mode);
    this.clock = RoundTime;
    this.elapsed = 0;
    this.spawnT = 1.0;
    this.powerT = 7;
    this.rng = new SysRandom(Math.floor(Math.random() * 1e9));
    const names = this.demo ? ["COMPUTER 1", "COMPUTER 2"] : this.mode === 0 ? ["YOU", ""] : this.mode === 1 ? ["YOU", `COMPUTER · ${DiffNames[this.diff]}`] : ["PLAYER 1", "PLAYER 2"];
    this.lanes.forEach((l, i) => {
      l.col = i === 0 ? P1Col : this.mode === 1 || this.demo ? CpuCol : P2Col;
      l.cpu = this.demo ? 1 : this.mode === 1 && i === 1 ? this.diff : -1;
      l.name = names[i];
      l.lives = StartLives; l.time = 0; l.bonus = 0; l.out = false; l.invuln = 0; l.shield = 0; l.slow = 0;
      l.dodged = 0; l.powers = 0; l.hitsTaken = 0; l.aiT = 0; l.pop = 0; l.touchT = -9;
      l.nameT.text = l.name; l.nameT.color = l.col;
      l.floorText.text = this.demo ? "" : this.mode === 0 ? "STEP LEFT AND RIGHT TO DODGE!" : i === 0 ? (this.mode === 1 ? "YOUR LANE" : "PLAYER 1 LANE") : this.mode === 1 ? "COMPUTER LANE" : "PLAYER 2 LANE";
      l.floorText.color = Color.white.withAlpha(0.75);
      this.DressKid(l);
      this.ResetKid(l);
    });
    this.timerCap.text = this.mode === 0 && !this.demo ? "SURVIVED" : "TIME LEFT";
    const top = this.Data.get("best0");
    this.bestT.text = top > 0 ? this.FormatScore(top) : "—";
    this.UpdateHud();
  }

  private ResetKid(l: Lane) {
    const k = l.kid;
    k.x = k.target = 0; k.vx = 0; l.aiTarget = 0;
    k.dizzy.gameObject.setActive(false);
    k.head.gameObject.setActive(true);
    l.dim.color = l.dim.color.withAlpha(0);
    this.PoseKid(l, 0);
  }

  private ClearObjs() {
    for (const l of this.lanes) for (const o of l.objs) this.Kill(o);
  }

  // ------------------------------------------------------------------ frame

  protected TickIdle(dt: number) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    for (const l of this.lanes) {
      // the kids wander a little behind the title
      const k = l.kid;
      if (Math.abs(k.x - k.target) < 0.1 && Random.value < dt * 0.6) k.target = Random.range(-l.half + 2, l.half - 2);
      this.MoveKid(l, dt, 6);
      this.TickObjs(l, dt, false);
    }
  }

  protected TickRound(dt: number, _hits: WallHit[], live: boolean) {
    if (this.layoutFrames > 0) { this.layoutFrames--; this.Layout(); }
    const play = live && this.step === RoundStep.Play;
    const solo = this.mode === 0 && !this.demo;
    this.ReadInput(dt);
    if (play) {
      this.elapsed += dt;
      if (!solo) {
        this.clock -= dt;
        if (this.clock <= 10 && this.clock > 0 && Math.ceil(this.clock) !== this.lastTick) { this.lastTick = Math.ceil(this.clock); Sfx.play(Snd.Tick, 0.8, 1.3); }
      }
      this.Spawner(dt);
    }
    for (const l of this.lanes) {
      if (!l.root.activeSelf) continue;
      if (l.cpu >= 0 && !l.out && this.step !== RoundStep.End) this.RunnerThink(l, dt);
      if (play && !l.out) { l.time += dt; l.invuln = Math.max(0, l.invuln - dt); l.shield = Math.max(0, l.shield - dt); l.slow = Math.max(0, l.slow - dt); }
      this.MoveKid(l, dt, l.cpu >= 0 ? RunnerSpeed[l.cpu] : 26);
      this.TickObjs(l, dt, play && !l.out);
    }
    if (play) {
      const active = this.lanes.filter((l) => l.root.activeSelf);
      if (active.every((l) => l.out)) this.EndRound(solo ? "OUT!" : "ALL OUT!");
      else if (!solo && this.clock <= 0) { this.clock = 0; this.EndRound(); }
    }
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ input: live feet positions, not ball hits

  private ReadInput(dt: number) {
    const now = Time.unscaledTime;
    const humans = this.lanes.filter((l) => l.cpu < 0 && l.root.activeSelf && !this.demo);
    if (humans.length === 0) return;
    const laneFor = (screenX: number) => {
      if (this.mode === 0) return this.lanes[0];
      const side = screenX < Screen.width / 2 ? 0 : 1;
      const l = this.lanes[side];
      return l.cpu < 0 ? l : null;
    };
    const toLaneX = (l: Lane, screen: V2) => Mathf.clamp(this.ScreenToWorld(screen).x - l.cx, -l.half + 0.8, l.half - 0.8);
    // floor sensor / touch screen: every touch point in a half is a foot of that half's player (average them)
    const sum = [0, 0], cnt = [0, 0];
    for (const t of Touchscreen.touches) {
      if (!t.press.isPressed || overUI(t.position)) continue;
      const l = laneFor(t.position.x);
      if (!l) continue;
      sum[l.idx] += toLaneX(l, t.position); cnt[l.idx]++;
    }
    for (const l of humans) if (cnt[l.idx] > 0) { l.touchX = sum[l.idx] / cnt[l.idx]; l.touchT = now; l.kid.target = l.touchX; }
    // keyboard: A/D for player 1, arrows for player 2 (or player 1 when alone)
    const k1 = (Keyboard.letter("d").isPressed ? 1 : 0) - (Keyboard.letter("a").isPressed ? 1 : 0);
    const k2 = (Keyboard.right.isPressed ? 1 : 0) - (Keyboard.left.isPressed ? 1 : 0);
    const keys = this.mode === 2 ? [k1, k2] : [k1 + k2, 0];
    for (const l of humans) {
      if (keys[l.idx] !== 0) { l.kid.target = Mathf.clamp(l.kid.x + keys[l.idx] * 2.5, -l.half + 0.8, l.half - 0.8); l.touchT = now; this.mouseActive = false; }
    }
    // mouse: the pointer's position drives the player of the half it is over (no click needed)
    const mp = Mouse.position;
    if (mp.sub(this.lastMouse).sqrMagnitude > 1) this.mouseActive = true;
    this.lastMouse = mp;
    if (this.mouseActive && mp.x >= 0 && mp.x <= Screen.width) {
      const l = laneFor(mp.x);
      if (l && now - l.touchT > 0.5) l.kid.target = toLaneX(l, mp);
    }
    void dt;
  }

  private MoveKid(l: Lane, dt: number, speed: number) {
    const k = l.kid;
    const nx = Mathf.moveTowards(k.x, Mathf.clamp(k.target, -l.half + 0.8, l.half - 0.8), speed * dt * (l.out ? 0 : 1));
    k.vx = dt > 0 ? (nx - k.x) / dt : 0;
    k.x = nx;
    this.PoseKid(l, dt);
  }

  private PoseKid(l: Lane, dt: number) {
    const k = l.kid;
    const moving = Math.abs(k.vx) > 0.6;
    k.run += dt * (moving ? 16 : 0);
    k.lean = Mathf.lerp(k.lean, Mathf.clamp(-k.vx * 0.9, -14, 14), 1 - Math.exp(-dt * 12));
    k.squash = Math.max(0, k.squash - dt * 3);
    k.root.localPosition = new V3(k.x, -FeetY * (KidScale - 1) + (l.out ? -0.5 : 0), 0);
    k.root.localScale = new V3(KidScale, KidScale, 1);
    k.root.localEulerZ = l.out ? 0 : k.lean;
    const sw = moving ? Math.sin(k.run) * 32 : 0;
    k.legs[0].localEulerZ = l.out ? 70 : sw;
    k.legs[1].localEulerZ = l.out ? -70 : -sw;
    const s = 1 + 0.2 * k.squash;
    k.body.transform.localScale = new V3(1.3 * s, 1.3 / s, 1);
    const blink = l.invuln > 0 && Math.floor(Time.time * 14) % 2 === 0;
    const a = blink ? 0.35 : 1;
    for (const sr of [k.body, k.head, k.dizzy]) sr.color = Color.white.withAlpha(a);
    k.head.gameObject.setActive(!(l.out || l.invuln > Invuln - 0.7));
    k.dizzy.gameObject.setActive(l.out || l.invuln > Invuln - 0.7);
    k.bubble.color = new Color(0.55, 0.85, 1, l.shield > 0 ? (l.shield < 1.2 && Math.floor(Time.time * 10) % 2 === 0 ? 0.3 : 0.85) : 0);
    k.foot.color = l.col.withAlpha(l.out ? 0.2 : 0.55 + 0.3 * Math.sin(Time.time * 6));
    const dizzyOn = l.out || l.invuln > 0.5;
    k.bonk.forEach((b, i) => {
      const ang = Time.time * 5 + i * 2.1;
      b.transform.localPosition = new V3(Math.cos(ang) * 0.9, FeetY + 3.6 + Math.sin(ang) * 0.25, 0);
      b.color = Gold.withAlpha(dizzyOn ? 1 : 0);
    });
    l.dim.color = l.dim.color.withAlpha(Mathf.moveTowards(l.dim.color.a, l.out ? 0.45 : 0, dt * 1.5));
  }

  // ------------------------------------------------------------------ spawning (the same pattern drops in every lane)

  private Spawner(dt: number) {
    const solo = this.mode === 0 && !this.demo;
    const t = this.elapsed;
    const width = solo ? 1.75 : 1;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      const r = () => this.rng.nextDouble();
      const k = Mathf.clamp01(t / 100);
      const speed = Mathf.lerp(6.5, 13.5, k) * (0.85 + r() * 0.3);
      const roll = r();
      const pattern = t > 50 && roll < 0.18 ? "volley" : t > 35 && roll < 0.36 ? "noodle" : t > 60 && roll < 0.5 ? "beach" : t > 25 && roll < 0.62 ? "bounce" : t > 12 && roll < 0.85 ? "aimed" : "drop";
      const u = r() * 2 - 1, aim = (r() - 0.5) * 2.4, u2 = r() * 2 - 1, wv = r();
      for (const l of this.lanes) {
        if (!l.root.activeSelf || l.out) continue;
        const span = l.half - 1;
        switch (pattern) {
          case "drop": this.Drop(l, Kind.Ball, u * span, 0, -speed); if (solo) this.Drop(l, Kind.Ball, u2 * span, 0, -speed * 0.9); break;
          case "aimed": { const x = u * span, tx = Mathf.clamp(l.kid.x + aim, -span, span); this.Drop(l, Kind.Ball, x, (tx - x) / (17 / speed), -speed); break; }
          case "bounce": this.Drop(l, Kind.Ball, u * span, (u2 >= 0 ? 1 : -1) * Mathf.lerp(5, 9, wv), -speed * 0.8); break;
          case "beach": this.Drop(l, Kind.Beach, u * span * 0.8, (u2 >= 0 ? 1 : -1) * 2.5, -speed * 0.55); break;
          case "noodle": {
            const w = Mathf.lerp(0.42, 0.58, wv) * l.half * 2, gapLeft = u >= 0;
            const x = gapLeft ? l.half - w / 2 - 0.2 : -l.half + w / 2 + 0.2;
            this.Drop(l, Kind.Noodle, x, 0, -speed * 0.7, w);
            break;
          }
          case "volley": for (let i = -1; i <= 1; i++) this.Drop(l, Kind.Ball, Mathf.clamp(u * span * 0.5 + i * 3.2, -span, span), i * 1.2, -speed * 0.95); break;
        }
      }
      this.spawnT = Mathf.lerp(1.35, 0.7, k) / width * (pattern === "noodle" || pattern === "volley" ? 1.5 : 1);
    }
    this.powerT -= dt;
    if (this.powerT <= 0) {
      const kind = Math.floor(this.rng.nextDouble() * 4), u = this.rng.nextDouble() * 2 - 1;
      for (const l of this.lanes) if (l.root.activeSelf && !l.out) this.Drop(l, Kind.Power, u * (l.half - 1.5), 0, -4.2, 0, kind);
      this.powerT = 8 + this.rng.nextDouble() * 4;
    }
  }

  private Drop(l: Lane, kind: Kind, x: number, vx: number, vy: number, w = 0, power = 0) {
    let o = l.objs.find((q) => !q.alive);
    if (!o) {
      const sr = Art.spr(l.root, "Obj", DodgeBall(BallCols[0], "c0"), Color.white, 1, 30, Art.Flat);
      const warn = Art.spr(l.root, "Warn", WarnSprite(), Color.clear, 1.3, 46, Art.Flat);
      o = { kind, x: 0, y: 0, vx: 0, vy: 0, r: 1, w: 0, power: 0, sr, warn, spin: 0, alive: false, fade: 0, bounced: false, passed: false };
      l.objs.push(o);
    }
    const r = kind === Kind.Ball ? 0.8 : kind === Kind.Beach ? 1.45 : kind === Kind.Noodle ? 0.4 : 0.8;
    const lead = kind === Kind.Power ? 0.4 : 0.65;
    Object.assign(o, { kind, x, y: 9 + r + Math.abs(vy) * lead, vx, vy, r, w, power, spin: Random.range(-300, 300), alive: true, fade: 0, bounced: false, passed: false });
    const ci = Math.floor(Math.random() * BallCols.length);
    o.sr.sprite = kind === Kind.Ball ? DodgeBall(BallCols[ci], "c" + ci) : kind === Kind.Beach ? BeachBall() : kind === Kind.Noodle ? NoodleSprite() : PowerSprite(power);
    o.sr.gameObject.setActive(true);
    o.warn.gameObject.setActive(kind !== Kind.Power);
    this.PlaceObj(o);
  }

  private Kill(o: Obj) { o.alive = false; o.sr.gameObject.setActive(false); o.warn.gameObject.setActive(false); }

  private TickObjs(l: Lane, dt: number, live: boolean) {
    const k = l.kid;
    const sdt = dt * (l.slow > 0 ? 0.5 : 1);
    for (const o of l.objs) {
      if (!o.alive) continue;
      o.x += o.vx * sdt; o.y += o.vy * sdt;
      const lim = l.half - (o.kind === Kind.Noodle ? o.w / 2 : o.r);
      if (o.x > lim) { o.x = lim; o.vx = -Math.abs(o.vx); }
      if (o.x < -lim) { o.x = -lim; o.vx = Math.abs(o.vx); }
      // soft bounce on the floor, then it rolls away harmlessly
      if (!o.bounced && o.kind !== Kind.Power && o.y - o.r < FeetY + 0.1) {
        o.bounced = true; o.y = FeetY + 0.1 + o.r; o.vy = Math.abs(o.vy) * 0.32; o.vx *= 0.6;
        if (live) { l.dodged++; Sfx.playClip(this.snd.thud, 0.25, 1.3); }
      }
      if (o.bounced) { o.vy -= 22 * sdt; o.fade += dt * 1.6; }
      if (o.kind === Kind.Power && o.y < FeetY - 1.5) o.fade += dt * 3;
      if (o.fade >= 1 || o.y < -10.5) { this.Kill(o); continue; }
      o.sr.transform.localEulerZ = o.sr.transform.localEulerZ + o.spin * dt;
      this.PlaceObj(o);
      if (!live || o.bounced) continue;
      // collision with the kid (a capsule from the knees to the head)
      let touch = false;
      if (o.kind === Kind.Noodle) touch = Math.abs(o.x - k.x) < o.w / 2 + KidR && o.y - o.r < KidHigh + KidR && o.y + o.r > KidLow - KidR;
      else {
        const cy = Mathf.clamp(o.y, KidLow, KidHigh);
        touch = Math.hypot(o.x - k.x, o.y - cy) < o.r + KidR;
      }
      if (!touch) continue;
      if (o.kind === Kind.Power) { this.Catch(l, o); continue; }
      if (l.invuln > 0) continue;
      this.Bonk(l, o);
    }
  }

  private PlaceObj(o: Obj) {
    o.sr.transform.localPosition = new V3(o.x, o.y, 0);
    const a = 1 - Mathf.clamp01(o.fade);
    if (o.kind === Kind.Noodle) { o.sr.transform.localScale = new V3(o.w / 0.97, 3.9, 1); o.sr.transform.localEulerZ = 0; }
    else { const s = o.r * 2 / (o.kind === Kind.Ball ? 0.9 : 0.92); o.sr.transform.localScale = new V3(s, s, 1); }
    o.sr.color = Color.white.withAlpha(a);
    // warning chevron at the top edge until it drops into view
    const above = o.y - o.r > 8.6;
    o.warn.transform.localPosition = new V3(o.x, 7.9, 0);
    o.warn.color = Color.white.withAlpha(above && o.kind !== Kind.Power ? 0.6 + 0.4 * Math.sin(Time.time * 20) : 0);
    if (!above) o.warn.gameObject.setActive(false);
  }

  private Bonk(l: Lane, o: Obj) {
    const k = l.kid;
    o.vy = Math.abs(o.vy) * 0.6 + 4; o.vx = (o.x - k.x >= 0 ? 1 : -1) * 6; o.bounced = true; o.fade = 0.3;
    const w = new V2(l.cx + k.x, FeetY + 2.2);
    if (l.shield > 0) {
      l.shield = 0; l.invuln = 0.6;
      this.fx.pop(w.sub(new V2(l.cx, 0)), Pal.hex(0x8fd8ff), 18, 7, 0.3, 0.5);
      this.UI.Float(w.add(new V2(0, 1.5)), "BLOCKED!", Pal.hex(0x8fd8ff), 1.5);
      Sfx.play(Snd.Zap, 0.6);
      return;
    }
    l.lives--; l.hitsTaken++;
    l.invuln = Invuln;
    k.squash = 1;
    this.fx.sparkle(new V2(k.x, FeetY + 3.2), Gold, 10, 1.2, 0.5);
    this.UI.Float(w.add(new V2(0, 1.8)), l.lives > 0 ? "BONK!" : "OUT!", l.lives > 0 ? Gold : Red, 1.9);
    Sfx.playClip(this.bonkClip, 0.9, 0.9 + Math.random() * 0.2);
    this.Fx.shake(0.3);
    Fx.haptic(true);
    if (l.lives <= 0) {
      l.out = true;
      Sfx.playClip(this.snd.groan, this.demo ? 0.25 : 0.6);
      this.Back.Flash(Red, 0.2);
      if (this.lanes.some((q) => q !== l && q.root.activeSelf && !q.out)) this.call.show(`${l.name} IS OUT!`, Red, 1.3, 140);
    }
  }

  private Catch(l: Lane, o: Obj) {
    const w = new V2(l.cx + o.x, o.y);
    this.Kill(o);
    l.powers++;
    l.pop = 1;
    switch (o.power) {
      case 0: l.bonus += 3; break;
      case 1: l.lives = Math.min(MaxLives, l.lives + 1); break;
      case 2: l.shield = 6; break;
      case 3: l.slow = 5; break;
    }
    this.fx.sparkle(new V2(o.x, o.y), Gold, 14, 1.0, 0.45);
    this.UI.Float(w.add(new V2(0, 1.2)), PowerNames[o.power], [Gold, Red, Pal.hex(0x8fd8ff), Pal.hex(0xc6a6ff)][o.power], 1.6);
    Sfx.play(Snd.PowerUp, 0.8);
    Sfx.playClip(this.snd.cheer, this.demo ? 0.15 : 0.35, 1.2);
  }

  // ------------------------------------------------------------------ computer runner

  private RunnerThink(l: Lane, dt: number) {
    const lv = l.cpu;
    l.aiT -= dt;
    if (l.aiT <= 0) {
      l.aiT = RunnerReact[lv] * (0.7 + Math.random() * 0.6);
      const k = l.kid, look = RunnerLook[lv];
      let best = k.x, bestCost = Infinity;
      for (let i = 0; i <= 24; i++) {
        const c = -l.half + 0.8 + (i / 24) * (l.half * 2 - 1.6);
        let cost = Math.abs(c - k.x) * 0.06 + Math.abs(c) * 0.01;
        const travel = Math.abs(c - k.x) / RunnerSpeed[lv];
        for (const o of l.objs) {
          if (!o.alive || o.bounced) continue;
          if (o.vy >= 0) continue;
          const slow = l.slow > 0 ? 0.5 : 1;
          const tHit = (o.y - o.r - KidHigh - KidR) / -o.vy / slow, tEnd = (o.y + o.r - KidLow + KidR) / -o.vy / slow;
          if (tHit > look || tEnd < 0) continue;
          // where it will be across the lane then (bouncing off the lane sides)
          let px = o.x + o.vx * Math.max(0, tHit);
          const lim = l.half - (o.kind === Kind.Noodle ? o.w / 2 : o.r);
          for (let b = 0; b < 3; b++) { if (px > lim) px = 2 * lim - px; if (px < -lim) px = -2 * lim - px; }
          const reach = (o.kind === Kind.Noodle ? o.w / 2 : o.r) + KidR + 0.7;
          if (o.kind === Kind.Power) { if (Math.abs(c - px) < 1.2 && travel < tHit) cost -= 1.2; continue; }
          const w = 6 / (Math.max(0, tHit) + 0.25);
          if (Math.abs(c - px) < reach) cost += w;
          else if ((px - k.x) * (c - px) > 0 || Math.abs(px - k.x) < reach) {
            // the way there runs under it: when would the kid be passing below?
            const tPass = Math.max(0, Math.abs(px - k.x) - reach) / RunnerSpeed[lv], tOut = (Math.abs(px - k.x) + reach) / RunnerSpeed[lv];
            if (tPass < tEnd && tOut > tHit) cost += w * 0.8;
          }
        }
        if (cost < bestCost) { bestCost = cost; best = c; }
      }
      if (Math.random() < RunnerSlip[lv]) best = k.x + Random.range(-3, 3);
      l.aiTarget = best;
    }
    l.kid.target = l.aiTarget;
  }

  // ------------------------------------------------------------------ HUD

  private Score(l: Lane) { return l.time + l.bonus; }

  private UpdateHud() {
    const solo = this.mode === 0 && !this.demo;
    this.timerT.text = solo ? Fmt.clock(Math.floor(this.lanes[0].time)) : Fmt.clock(Math.ceil(Math.max(0, this.clock)));
    this.timerT.color = !solo && this.clock <= 10 && this.step === RoundStep.Play ? Color.lerp(Red, Color.white, 0.5 + 0.5 * Math.sin(Time.time * 10)) : White;
    for (const l of this.lanes) {
      l.scoreT.text = this.Score(l).toFixed(1);
      l.pop = Math.max(0, l.pop - Time.deltaTime * 2.5);
      const s = 1 + 0.3 * l.pop;
      l.scoreT.rectTransform.localScale = new V3(s, s, 1);
      l.scoreT.color = l.out ? Pal.TextDim : Color.lerp(White, Gold, l.pop);
      for (let k = 0; k < MaxLives; k++) {
        l.hearts[k].gameObject.setActive(k < Math.max(StartLives, l.lives));
        l.hearts[k].color = k < l.lives ? Color.white : new Color(0.3, 0.3, 0.4, 0.5);
      }
    }
  }

  // ------------------------------------------------------------------ results

  protected RoundResult() {
    const [a, b] = this.lanes;
    const sa = this.Score(a), sb = this.Score(b);
    const tenths = (v: number) => Math.round(v * 10);
    this.Data.add("dodged", a.dodged + (this.mode === 2 ? b.dodged : 0));
    if (this.mode === 0) {
      const best = this.Data.max("best0", tenths(sa));
      const st = a.time >= 90 ? 3 : a.time >= 60 ? 2 : a.time >= 30 ? 1 : 0;
      const head = st === 3 ? "DODGE LEGEND!" : st === 2 ? "SUPER DODGER!" : st === 1 ? "NICE MOVES!" : "GOOD TRY!";
      return {
        result: new Result({
          Headline: head, HeadlineColor: Gold, Value: sa.toFixed(1), Stars: st, NewBest: best, Victory: st > 0,
          BestLine: `SCORE ${sa.toFixed(1)}   ·   BEST ${this.FormatScore(this.Data.get("best0"))}`,
          Stats: [["TIME SURVIVED", Fmt.clock(Math.floor(a.time))], ["BONUS", `+${a.bonus} SEC`], ["THINGS DODGED", String(a.dodged)], ["POWER-UPS", String(a.powers)]],
          Primary: "PLAY AGAIN",
        }),
        score: tenths(sa), label: "SOLO",
      };
    }
    const w = Math.abs(sa - sb) < 0.05 ? -1 : sa > sb ? 0 : 1;
    const score = `${sa.toFixed(1)} – ${sb.toFixed(1)}`;
    if (this.mode === 1) {
      const won = w === 0;
      if (won) this.Data.add("cpuWins", 1);
      return {
        result: new Result({
          Headline: won ? "YOU WIN!" : w < 0 ? "IT'S A DRAW!" : "THE COMPUTER WINS", HeadlineColor: won ? Gold : w < 0 ? White : Pal.hex(0xffb0c0),
          Value: score, Stars: won ? (a.out ? 2 : 3) : w < 0 ? 1 : 0, Victory: won, BestLine: `${score}   ·   ${DiffNames[this.diff]}`,
          Stats: [["YOUR SCORE", sa.toFixed(1)], ["COMPUTER SCORE", sb.toFixed(1)], ["BONKS TAKEN", String(a.hitsTaken)], ["POWER-UPS", String(a.powers)]],
          Primary: won ? "PLAY AGAIN" : "REMATCH",
        }),
        score: tenths(sa), label: "VS CPU",
      };
    }
    const winner = w < 0 ? a : this.lanes[w];
    return {
      result: new Result({
        Headline: w < 0 ? "IT'S A DRAW!" : `PLAYER ${w + 1} WINS!`, HeadlineColor: w < 0 ? Gold : winner.col, Value: score,
        Stars: winner.out ? (winner.time >= 60 ? 2 : 1) : 3, Victory: true, BestLine: score,
        Stats: [["PLAYER 1 SCORE", sa.toFixed(1)], ["PLAYER 2 SCORE", sb.toFixed(1)], ["BONKS P1 / P2", `${a.hitsTaken} / ${b.hitsTaken}`], ["POWER-UPS P1 / P2", `${a.powers} / ${b.powers}`]],
        Primary: "REMATCH",
      }),
      score: tenths(Math.max(sa, sb)), label: w < 0 ? "P1 & P2" : `P${w + 1}`,
    };
  }

  // ------------------------------------------------------------------ test hooks

  TestState() {
    return {
      state: this.State, step: this.step, demo: this.demo, clock: this.clock, mode: this.mode,
      lanes: this.lanes.map((l) => ({ x: +l.kid.x.toFixed(2), target: +l.kid.target.toFixed(2), lives: l.lives, out: l.out, score: +this.Score(l).toFixed(1), invuln: l.invuln })),
      idle: this.idleSeconds,
    };
  }
  /** Threats near the kid of lane i, in lane units: [{x, y, r, w, kind}]. */
  TestObjs(i: number) { return this.lanes[i].objs.filter((o) => o.alive && !o.bounced).map((o) => ({ x: o.x, y: o.y, r: o.r, w: o.w, vy: o.vy, vx: o.vx, kind: o.kind })); }
  /** CSS x of a lane-local x (at the floor strip). */
  TestLaneToCss(i: number, x: number) {
    const el = Screen.el?.getBoundingClientRect();
    const sp = (window as unknown as { __na: { Camera: { worldToScreen(v: V2): V2 } } }).__na.Camera.worldToScreen(new V2(this.lanes[i].cx + x, FeetY - 1.2));
    return { x: (el?.left ?? 0) + sp.x / Screen.dpr, y: (el?.top ?? 0) + sp.y / Screen.dpr };
  }
  TestSkip(seconds: number) { this.clock = Math.min(this.clock, seconds); }
  TestKill(i: number) { const l = this.lanes[i]; l.lives = 1; l.invuln = 0; l.shield = 0; }
}
