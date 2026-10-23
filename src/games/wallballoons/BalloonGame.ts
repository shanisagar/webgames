import {
  Art, AudioClip, CasualArt, CasualLook, child, Color, Ease, GameInfo, howTo, Image, LineRenderer, Mathf, Pal, Sfx, Snd,
  SpriteRenderer, SysRandom, Text, TextMesh, Time, UIKit, UINode, V2, V3,
} from "../../kit";
import { BalloonArt, DuoHues, Hue, SoloHues, Special } from "./BalloonArt";
import { Bad, Ball, Gold, Ink, P1Col, P2Col, WallGame, WMode } from "./WallCore";

/**
 * BALLOON BURST for the LiDAR wall: the balloon-dart stall at the fair, played with a ball. Balloons float up the
 * wall. SOLO: pop the CALLED colour (a big banner changes it every few seconds) and avoid the rest: right +1, wrong -1.
 * VS COMPUTER: you pop CYAN, a virtual popper pops ORANGE. 2 PLAYERS: player 1 throws on the left half and pops cyan,
 * player 2 on the right half pops orange; a wrong pop costs a point. The BRAND balloon is worth 5 for anyone; ICE
 * slows every balloon; BOMB pops the whole cluster around it (only your own colour scores).
 */

const RoundTime = 90;
const SoloStarsAt = [15, 30, 45];
const BodyRX = 1.2, BodyRY = 1.45, Size = 2.5;

class Balloon {
  active = false; hue = 0; special = Special.None; x = 0; y = 0; base = 0; speed = 2; phase = 0; sway = 0.6; rot = 0; age = 0;
  sr!: SpriteRenderer; str!: LineRenderer; label!: TextMesh; glow!: SpriteRenderer; order = 0;
  get center() { return new V2(this.x, this.y + 0.18 * Size); }
}

export class BalloonGame extends WallGame {
  private balloons: Balloon[] = [];
  private back: SpriteRenderer[] = [];
  private sky!: SpriteRenderer;
  private valance: SpriteRenderer[] = [];
  private counter: SpriteRenderer[] = [];
  private plush: SpriteRenderer[] = [];
  private bulbs: SpriteRenderer[] = [];
  private frost!: SpriteRenderer;
  private zoneLabels: TextMesh[] = [];
  private divider!: SpriteRenderer;
  private spawnT = 0;
  private specialT = [8, 16, 12];
  private elapsed = 0;
  private iceT = 0;
  private called = 0;
  private callT = 7;
  private callDur = 7;
  private orderSeq = 0;
  private flashT = 0;
  private right = [0, 0];
  private wrong = [0, 0];
  private brands = [0, 0];
  private throws = [0, 0];
  private hitsAny = [0, 0];
  private rng = new SysRandom(1);
  // banner (solo)
  private banner!: UINode;
  private bannerBg!: Image;
  private bannerText!: Text;
  private bannerIcons: Image[] = [];
  private bannerBar!: Image;
  private bannerPop = 0;

  private popClip!: AudioClip;
  private boomClip!: AudioClip;
  private iceClip!: AudioClip;
  private buzzClip!: AudioClip;
  private callClip!: AudioClip;

  protected BrandWord = "MEGA";

  protected Describe() {
    return new GameInfo({
      Id: "wallballoons",
      Title: "BALLOON BURST",
      Tagline: "POP YOUR COLOUR. MISS THE REST!",
      PlayLabel: "PLAY",
      Accent: Pal.hex(0xff4fa3),
      Accent2: Gold,
      BgTop: Pal.hex(0x3a1a6a),
      BgBottom: Pal.hex(0x8a3aa8),
      ShortSide: 18,
      Music: { bpm: 122, rootHz: 164.8, degrees: [0, 5, 3, 4], seed: 59, energy: 0.85, major: true },
      HowTo: [
        howTo(BalloonArt.Hue(SoloHues[0].color, 0), Color.white, "Balloons float up the wall. THROW a ball to pop one."),
        howTo(BalloonArt.Hue(SoloHues[1].color, 1), Color.white, "SOLO: pop the CALLED colour shown on the big banner (+1). Other colours cost a point. The call changes every few seconds!"),
        howTo(BalloonArt.Brand(Gold), Color.white, "The BRAND balloon is worth 5 for anyone."),
        howTo(BalloonArt.Ice(), Color.white, "ICE balloon: slows every balloon for a few seconds."),
        howTo(BalloonArt.Bomb(), Color.white, "BOMB balloon: pops the whole cluster around it (only your colour scores, no penalty)."),
        howTo(Art.Chevron, P2Col, "VS COMPUTER: you pop CYAN, the computer pops ORANGE. 2 PLAYERS: P1 throws on the left half (CYAN), P2 on the right (ORANGE). Most points wins."),
        howTo(Art.Ring, Color.white, "Operator: SPACE / ENTER start, ESC pause, R back to title."),
      ],
      Tips: ["Watch the banner: the called colour changes!", "Save the BOMB for a big cluster."],
    });
  }

  protected RoundLength() { return RoundTime; }
  protected QuickRules() {
    return ["1. THROW a ball at the balloons floating up.", "2. Pop YOUR colour: +1. Wrong colour: -1!", `3. ${this.BrandName} balloon +5 · ICE slows · BOMB clears a cluster.`];
  }
  protected ModeLine(m: WMode) { return m === WMode.Solo ? "1:30 · POP THE CALLED COLOUR" : "1:30 · P1 LEFT POPS CYAN · P2 RIGHT POPS ORANGE"; }
  protected SoloStars(score: number) { return score >= SoloStarsAt[2] ? 3 : score >= SoloStarsAt[1] ? 2 : score >= SoloStarsAt[0] ? 1 : 0; }
  protected ScoreCaption() { return "POPS"; }

  private get Solo() { return this.mode === WMode.Solo && !this.demo; }
  private get Hues(): Hue[] { return this.Solo || this.step === "idle" && this.mode === WMode.Solo ? SoloHues : DuoHues; }

  // ------------------------------------------------------------------ build

  protected BuildWorld() {
    const r = this.root;
    this.sky = CasualLook.cover(r, CasualArt.gradient(Pal.hex(0x2a1050), Pal.hex(0x6a2a8a), Pal.hex(0xffb0e0).withAlpha(0.35)), -900);
    for (let i = 0; i < 6; i++) this.back.push(Art.spr(r, "Stripes", BalloonArt.Stripes(), Color.white, 1, -880, Art.Flat));
    for (let i = 0; i < 6; i++) this.valance.push(Art.spr(r, "Valance", BalloonArt.Valance(), Color.white, 1, 500, Art.Flat));
    for (let i = 0; i < 26; i++) this.bulbs.push(Art.spr(r, "Bulb", Art.Disc, Pal.hex(0xfff2b0), 0.3, 502, Art.Flat));
    for (let i = 0; i < 6; i++) this.counter.push(Art.spr(r, "Counter", BalloonArt.Counter(), Color.white, 1, 400, Art.Flat));
    for (let i = 0; i < 10; i++) this.plush.push(Art.spr(r, "Plush", BalloonArt.Plush(i % 3, i % 5), Color.white, 1.6, 401, Art.Flat));
    this.frost = Art.spr(r, "Frost", BalloonArt.Frost(), Color.white, 1, 450, Art.Flat);
    this.divider = Art.spr(r, "Divider", Art.Square, Color.white.withAlpha(0.16), 1, 50, Art.Flat);
    for (let i = 0; i < 2; i++) { const t = child(r, "Zone", new TextMesh()); t.sortingOrder = 410; this.zoneLabels.push(t); }
    for (let i = 0; i < 26; i++) {
      const b = new Balloon();
      b.str = Art.line(r, "String", Color.white.withAlpha(0.7), 0.05, 100, false, true, Art.Flat);
      b.glow = Art.spr(r, "Glow", Art.Glow, Gold, 5, 99, Art.Additive);
      b.sr = Art.spr(r, "Balloon", BalloonArt.Hue(SoloHues[0].color, 0), Color.white, Size, 101, Art.Flat);
      b.label = child(r, "BrandLabel", new TextMesh());
      this.Hide(b);
      this.balloons.push(b);
    }
    this.BuildBanner();
    this.BuildSounds();
  }

  private BuildBanner() {
    const hud = this.UI.Hud;
    this.banner = UIKit.node("Called", hud).place(new V2(0.5, 1), new V2(0, -275), new V2(820, 140));
    this.bannerBg = UIKit.img(this.banner, "Bg", Art.UiRound, SoloHues[0].color);
    this.bannerBg.rectTransform.stretch();
    UIKit.img(this.banner, "Edge", Art.UiOutline, Color.white.withAlpha(0.9)).rectTransform.stretch();
    this.bannerText = UIKit.at(UIKit.label(this.banner, "POP RED!", 92, Color.white), UIKit.Center, new V2(0, 6), new V2(620, 120));
    UIKit.glow(this.bannerText, Ink, 5);
    for (let i = 0; i < 2; i++) {
      const im = UIKit.img(this.banner, "Icon", BalloonArt.Hue(SoloHues[0].color, 0), Color.white);
      im.rectTransform.place(UIKit.Center, new V2((i === 0 ? -1 : 1) * 355, 6), new V2(96, 134));
      this.bannerIcons.push(im);
    }
    const barBg = UIKit.img(this.banner, "BarBg", Art.UiRound, Ink.withAlpha(0.5));
    barBg.rectTransform.place(new V2(0.5, 0), new V2(0, 14), new V2(560, 14));
    this.bannerBar = UIKit.img(barBg.rectTransform, "Bar", Art.UiRound, Color.white);
    const f = this.bannerBar.rectTransform;
    f.anchorMin = V2.zero; f.anchorMax = V2.one; f.pivot = new V2(0, 0.5); f.offsetMin = new V2(2, 2); f.offsetMax = new V2(-2, -2);
    this.banner.setActive(false);
  }

  private BuildSounds() {
    const rnd = new SysRandom(21);
    const n = () => rnd.nextDouble() * 2 - 1;
    let lp = 0;
    this.popClip = Sfx.make("bb-pop", 0.32, (t) => {
      lp += (n() - lp) * 0.55;
      return lp * Sfx.env(t, 0.0005, 0.05) * 1.2 + Sfx.sinP(Sfx.glide(t, 260, 70, 0.08)) * Sfx.env(t, 0.001, 0.08) * 0.7 + n() * Sfx.env(t - 0.01, 0.001, 0.12) * 0.15;
    });
    let lp2 = 0;
    this.boomClip = Sfx.make("bb-boom", 1.1, (t) => { lp2 += (n() - lp2) * 0.12; return lp2 * Sfx.env(t, 0.002, 0.7) * 2 + Sfx.sinP(Sfx.glide(t, 110, 35, 0.6)) * Sfx.env(t, 0.003, 0.6) * 0.8; });
    this.iceClip = Sfx.make("bb-ice", 1.0, (t) => {
      let v = 0;
      [2093, 2637, 3136, 3951].forEach((f, i) => { const tt = t - i * 0.05; if (tt > 0) v += Sfx.sinP(f * tt) * Sfx.env(tt, 0.002, 0.5) * 0.12; });
      return v + n() * Sfx.env(t, 0.01, 0.3) * 0.1;
    });
    this.buzzClip = Sfx.make("bb-buzz", 0.4, (t) => Sfx.sqrP(110 * t) * 0.25 * Sfx.env(t, 0.005, 0.35) + Sfx.sawP(117 * t) * 0.15 * Sfx.env(t, 0.005, 0.35));
    this.callClip = Sfx.make("bb-call", 0.6, (t) => {
      let v = 0;
      [[0, 880], [0.12, 1175]].forEach(([s, f]) => { const tt = t - s; if (tt > 0) v += (Sfx.sinP(f * tt) + 0.4 * Sfx.sinP(f * 2 * tt)) * Sfx.env(tt, 0.003, 0.35) * 0.3; });
      return v;
    });
  }

  // ------------------------------------------------------------------ layout

  protected LayoutWorld() {
    const V = this.ViewSize, W2 = V.x / 2, H2 = V.y / 2;
    CasualLook.fitCover(this.sky, V);
    const tw = V.x / 6 + 0.05;
    this.back.forEach((b, i) => { b.transform.localScale = new V3(tw, V.y + 1, 1); b.transform.localPosition = new V3(-W2 + tw * (i + 0.5), 0, 0); b.color = new Color(1, 1, 1, 1); });
    this.valance.forEach((a, i) => { a.transform.localScale = new V3(tw, tw, 1); a.transform.localPosition = new V3(-W2 + tw * (i + 0.5), H2 - tw * 0.375 + 0.4, 0); });
    this.bulbs.forEach((b, i) => { const x = -W2 + 0.5 + (i + 0.5) * ((V.x - 1) / this.bulbs.length); b.transform.localPosition = new V3(x, H2 - tw * 0.75 + 0.5 - Math.sin((i / (this.bulbs.length - 1)) * Math.PI * 4) * 0.0, 0); });
    // counter along the bottom with prizes on it
    const ch = 2.2;
    this.counter.forEach((c, i) => { c.transform.localScale = new V3(tw, ch * 2, 1); c.transform.localPosition = new V3(-W2 + tw * (i + 0.5), -H2 + ch / 2 - 0.15 + (H2 - 9 < 0 ? 0 : -(H2 - 9)), 0); });
    const top = -9 + ch - 0.15 - 0.05;
    this.plush.forEach((p, i) => {
      const x = -W2 + 1.4 + (i + 0.5) * ((V.x - 2.8) / this.plush.length);
      p.transform.localPosition = new V3(x, top + 1.25 + (i % 2) * 0.05, 0);
      p.transform.localScale = new V3((i % 2 ? -1 : 1) * 1.55, 1.55, 1);
    });
    this.frost.transform.localScale = new V3(V.x + 0.5, V.x + 0.5, 1);
    this.divider.transform.localPosition = new V3(0, -0.5, 0);
    this.divider.transform.localScale = new V3(0.08, 13.5, 1);
    this.zoneLabels.forEach((t, i) => t.transform.localPosition = new V3((i === 0 ? -1 : 1) * 8, -8.2, 0));
  }

  // ------------------------------------------------------------------ round

  protected SetupRound() {
    this.rng = new SysRandom(Math.floor(Math.random() * 1e9));
    for (const b of this.balloons) this.Hide(b);
    this.spawnT = 0.2; this.specialT = [7 + Math.random() * 4, 18, 12]; this.elapsed = 0; this.iceT = 0;
    this.right = [0, 0]; this.wrong = [0, 0]; this.brands = [0, 0]; this.throws = [0, 0]; this.hitsAny = [0, 0];
    this.called = this.rng.next(SoloHues.length); this.callDur = 7; this.callT = this.callDur;
    const duo = this.mode !== WMode.Solo || this.demo;
    this.divider.gameObject.setActive(this.mode === WMode.Duo);
    this.zoneLabels.forEach((t, i) => {
      t.text = duo && this.step !== "idle" ? `${this.PlayerName(i)}: ${DuoHues[i].name}` : "";
      t.fontSize = 64; t.characterSize = 0.8 * 10 / 64; t.color = Color.lerp(i === 0 ? P1Col : P2Col, Color.white, 0.2);
    });
    // prefill so the wall is never empty
    for (let i = 0; i < (this.step === "idle" ? 7 : 5); i++) this.Spawn(Special.None, -9 + this.rng.nextDouble() * 15);
    this.WBanner(false);
  }

  private Hide(b: Balloon) { b.active = false; b.sr.gameObject.setActive(false); b.str.positionCount = 0; b.label.text = ""; b.glow.gameObject.setActive(false); }

  private Spawn(special: Special, y = -10.5) {
    const b = this.balloons.find((x) => !x.active);
    if (!b) return null;
    b.active = true; b.special = special; b.age = 0;
    const hues = this.Hues;
    if (special === Special.None) {
      // in solo, lean towards the called colour so there is always something to pop
      b.hue = this.Solo && this.rng.nextDouble() < 0.38 ? this.called : this.rng.next(hues.length);
    }
    let x = 0;
    for (let tries = 0; tries < 12; tries++) {
      x = (this.rng.nextDouble() * 2 - 1) * (this.FW / 2 - 2.2);
      if (this.balloons.every((o) => o === b || !o.active || Math.abs(o.x - x) > 2.4 || Math.abs(o.y - y) > 3.2)) break;
    }
    b.x = x; b.base = x; b.y = y; b.phase = this.rng.nextDouble() * 6.28; b.sway = 0.35 + this.rng.nextDouble() * 0.5;
    b.speed = (1.7 + this.rng.nextDouble() * 1.1) * Mathf.lerp(1, 1.5, this.elapsed / RoundTime) * (this.step === "idle" ? 0.6 : 1);
    if (special !== Special.None) b.speed *= 1.15;
    b.order = this.orderSeq++;
    b.sr.gameObject.setActive(true);
    b.sr.sprite = this.SpriteFor(b);
    b.glow.gameObject.setActive(special !== Special.None);
    b.glow.color = special === Special.Brand ? this.BrandColor.withAlpha(0.6) : special === Special.Ice ? Pal.hex(0x9fe8ff).withAlpha(0.5) : Pal.hex(0xff5a3a).withAlpha(0.5);
    b.label.text = special === Special.Brand ? this.BrandName : special === Special.Ice ? "ICE" : special === Special.Bomb ? "BOMB" : "";
    b.label.fontSize = 64;
    const len = Math.max(3, b.label.text.length);
    b.label.characterSize = (special === Special.Brand ? Math.min(0.62, 2.3 / len * 1.25) : 0.48) * 10 / 64;
    b.label.color = special === Special.Bomb ? Pal.hex(0xffe24a) : special === Special.Ice ? Pal.hex(0x1a5a8a) : Color.white;
    return b;
  }

  private SpriteFor(b: Balloon) {
    switch (b.special) {
      case Special.Brand: return BalloonArt.Brand(this.BrandColor);
      case Special.Ice: return BalloonArt.Ice();
      case Special.Bomb: return BalloonArt.Bomb();
      default: { const h = this.Hues[b.hue % this.Hues.length]; return BalloonArt.Hue(h.color, b.hue); }
    }
  }

  private HueColor(b: Balloon) {
    if (b.special === Special.Brand) return this.BrandColor;
    if (b.special === Special.Ice) return Pal.hex(0x9fe8ff);
    if (b.special === Special.Bomb) return Pal.hex(0x3a3a4a);
    return this.Hues[b.hue % this.Hues.length].color;
  }

  // ------------------------------------------------------------------ hits

  protected OnBall(ball: Ball) {
    this.throws[ball.who]++;
    let best: Balloon | null = null;
    for (const b of this.balloons) {
      if (!b.active || b.y < -8.6) continue;
      const c = b.center, dx = (ball.world.x - c.x) / (BodyRX + 0.3), dy = (ball.world.y - c.y) / (BodyRY + 0.3);
      if (dx * dx + dy * dy <= 1 && (!best || b.order > best.order)) best = b;
    }
    if (!best) return;
    this.hitsAny[ball.who]++;
    this.Pop(best, ball.who, true);
  }

  /** Is this balloon one `who` should pop? */
  private Mine(b: Balloon, who: number) {
    if (b.special !== Special.None) return true;
    return this.Solo ? b.hue === this.called : b.hue === who;
  }

  private Pop(b: Balloon, who: number, direct: boolean) {
    const c = b.center, col = this.HueColor(b), pcol = this.PlayerColor(who);
    this.Hide(b);
    this.fx.pop(c, col, 18, 8, 0.35, 0.5);
    for (let i = 0; i < 7; i++) { const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 5; this.fx.emit(c, new V2(Math.cos(a) * s, Math.sin(a) * s), col, 0.55, 0.9, BalloonArt.Shred(), -9, (Math.random() - 0.5) * 700, false, 2.5); }
    this.Fx.ring(c, pcol, 0.8, 4.8, 0.35);
    Sfx.playClip(this.popClip, direct ? 1 : 0.6, 0.85 + Math.random() * 0.3);
    if (b.special === Special.Brand) {
      this.Add(who, 5, c, `+5 ${this.BrandName}!`, Gold, 2);
      this.brands[who]++;
      this.fx.confetti(c, 60, 11, [this.BrandColor, Gold, Color.white]);
      this.Cheer(0.8); this.Fx.shake(0.4); this.Hitstop(0.06); this.flashT = 0.8;
      Sfx.play(Snd.Coin, 0.9);
      return;
    }
    if (b.special === Special.Ice) {
      this.iceT = 5;
      this.Big("FREEZE!", Pal.hex(0x9fe8ff), 1.1, 200);
      Sfx.playClip(this.iceClip, 0.9);
      for (let i = 0; i < 30; i++) this.fx.emit(c, V2.fromAngle(Math.random() * 6.28, 3 + Math.random() * 8), Pal.hex(0xdff8ff), 0.3, 1.0, CasualArt.StarShape, -2, 200, true, 2);
      return;
    }
    if (b.special === Special.Bomb) {
      this.Big("BOOM!", Pal.hex(0xff7a3a), 1.0, 220);
      Sfx.playClip(this.boomClip, 1);
      this.Fx.shake(0.7); this.Hitstop(0.08);
      this.fx.pop(c, Pal.hex(0xffb03a), 40, 12, 0.6, 0.7);
      this.Fx.ring(c, Pal.hex(0xffe24a), 1, 10, 0.5);
      let got = 0;
      for (const o of this.balloons) {
        if (!o.active || V2.distance(o.center, c) > 4.8) continue;
        const mine = this.Mine(o, who) && o.special === Special.None;
        if (o.special === Special.Brand) { this.Pop(o, who, false); continue; }
        if (o.special !== Special.None) continue;
        this.Pop(o, who, false);
        if (mine) got++;
      }
      if (got > 0) this.Add(who, 0, c.add(new V2(0, 1)), `CLUSTER x${got}!`, Gold, 1.6);
      return;
    }
    if (this.Mine(b, who)) {
      this.Add(who, 1, c, "+1", Color.lerp(col, Color.white, 0.3), 1.8);
      this.right[who]++;
      this.flashT = Math.max(this.flashT, 0.15);
    } else if (direct) {
      this.Add(who, -1, c, "-1 WRONG!", Bad, 1.5);
      this.wrong[who]++;
      Sfx.playClip(this.buzzClip, 0.8);
      this.Fx.shake(0.15);
    }
  }

  private Add(who: number, pts: number, at: V2, text: string, col: Color, scale: number) {
    this.scores[who] = Math.max(0, this.scores[who] + pts);
    this.UI.Float(at.add(new V2(0, 1.4)), text, col, scale);
  }

  // ------------------------------------------------------------------ computer poppers

  protected TickCpu(dt: number, who: number, level: number) {
    if (!this.CpuReady(who, dt, [1.75, 1.2, 0.85][level])) return;
    let best: Balloon | null = null, score = -1e9;
    for (const b of this.balloons) {
      if (!b.active || b.y < -7.5 || b.y > 4.6) continue;
      if (this.mode === WMode.Duo && (b.x < 0 ? 0 : 1) !== who) continue;
      if (b.special === Special.Ice) continue;
      if (!this.Mine(b, who)) continue;
      let sc = (b.special === Special.Brand ? 5 : 1) + Math.random() * 1.5 - Math.abs(b.y) * 0.05;
      if (b.special === Special.Bomb) { let n = 0; for (const o of this.balloons) if (o.active && o !== b && V2.distance(o.center, b.center) < 4.8 && this.Mine(o, who)) n++; sc = n >= 3 ? 4 + n : -5; }
      if (sc > score) { score = sc; best = b; }
    }
    if (!best) { this.DelayCpu(who, 0.3); return; }
    const vel = new V2(Math.cos(Time.time * 1.3 + best.phase) * best.sway * 1.3, best.speed * (this.iceT > 0 ? 0.35 : 1));
    let target = this.Aim(best.center, vel, level, 0.8);
    if (this.mode === WMode.Duo) target = new V2(who === 0 ? Math.min(-0.3, target.x) : Math.max(0.3, target.x), target.y);
    this.Throw(who, target);
  }

  // ------------------------------------------------------------------ frame

  protected TickWorld(dt: number) {
    const t = Time.time;
    const live = this.step === "play";
    if (live) this.elapsed += dt;
    this.iceT = Math.max(0, this.iceT - dt);
    const slow = this.iceT > 0 ? 0.35 : 1;
    // spawning
    const count = this.balloons.filter((b) => b.active).length;
    const want = this.step === "idle" ? 8 : Math.round(Mathf.lerp(9, 15, this.elapsed / RoundTime));
    this.spawnT -= dt * slow;
    if (this.spawnT <= 0 && count < want && this.step !== "end") { this.Spawn(Special.None); this.spawnT = this.step === "idle" ? 1.1 : Mathf.lerp(0.75, 0.4, this.elapsed / RoundTime); }
    if (live) {
      const kinds = [Special.Brand, Special.Ice, Special.Bomb];
      for (let k = 0; k < 3; k++) {
        this.specialT[k] -= dt;
        if (this.specialT[k] <= 0) { this.Spawn(kinds[k]); this.specialT[k] = [11, 22, 15][k] + Math.random() * 5; }
      }
      // the called colour (solo)
      if (this.Solo) {
        this.callT -= dt;
        if (this.callT <= 0) this.NewCall();
      }
    }
    for (const b of this.balloons) {
      if (!b.active) continue;
      b.age += dt;
      b.y += b.speed * slow * dt;
      b.x = b.base + Math.sin(t * 1.3 + b.phase) * b.sway;
      b.rot = Math.sin(t * 1.3 + b.phase + 0.6) * 7;
      if (b.y > 10.5) { this.Hide(b); continue; }
      b.sr.transform.localPosition = new V3(b.x, b.y, 0);
      b.sr.transform.localEulerZ = b.rot;
      b.sr.sortingOrder = 101 + (b.order % 200) * 2;
      b.sr.color = this.iceT > 0 ? Color.lerp(Color.white, Pal.hex(0xc8f4ff), 0.45) : Color.white;
      const c = b.center;
      b.glow.transform.localPosition = new V3(c.x, c.y, 0);
      b.glow.sortingOrder = b.sr.sortingOrder - 1;
      if (b.glow.gameObject.activeSelf) { const s = 5 + Math.sin(t * 6 + b.phase) * 0.5; b.glow.transform.localScale = new V3(s, s * 1.15, 1); }
      b.label.sortingOrder = b.sr.sortingOrder + 1;
      if (b.label.text) { b.label.transform.localPosition = new V3(c.x, c.y + (b.special === Special.Bomb ? -1.0 : 0.05), 0); b.label.transform.localEulerZ = b.rot; }
      // string
      const knot = new V2(b.x + Math.sin(b.rot * Mathf.Deg2Rad) * 1.25, b.y - 1.25);
      const pts: V2[] = [];
      for (let k = 0; k < 6; k++) pts.push(knot.add(new V2(Math.sin(t * 3 + b.phase + k * 0.9) * 0.12 * k * 0.4, -k * 0.42)));
      b.str.setPositions(pts);
      b.str.sortingOrder = b.sr.sortingOrder - 1;
    }
    // ICE overlay, booth lights
    this.frost.gameObject.setActive(this.iceT > 0);
    if (this.iceT > 0) this.frost.color = Color.white.withAlpha(Mathf.clamp01(this.iceT * 2) * (0.85 + 0.15 * Math.sin(t * 5)));
    this.flashT = Math.max(0, this.flashT - dt);
    const cc = this.Solo && live ? SoloHues[this.called].color : null;
    this.bulbs.forEach((b, i) => {
      const on = this.flashT > 0 ? Math.sin(t * 30 + i) > -0.3 : ((i + Math.floor(t * 5)) % 3) === 0;
      b.color = on ? (cc ? Color.lerp(cc, Color.white, 0.4) : Pal.hex(0xfff6c0)) : Pal.hex(0xa87a50);
      const s = on ? 0.36 : 0.28;
      b.transform.localScale = new V3(s, s, 1);
    });
    this.WBanner(this.Solo && (live || this.step === "count"));
  }

  private NewCall() {
    let n = this.called;
    while (n === this.called) n = this.rng.next(SoloHues.length);
    this.called = n;
    this.callDur = Mathf.lerp(7.5, 5, this.elapsed / RoundTime);
    this.callT = this.callDur;
    this.bannerPop = 1;
    Sfx.playClip(this.callClip, 0.9);
    // make sure some of the new colour are on the way
    for (let i = 0; i < 2; i++) { const b = this.Spawn(Special.None, -10.5 - i * 2.5); if (b) { b.hue = n; b.sr.sprite = this.SpriteFor(b); } }
  }

  private WBanner(on: boolean) {
    if (!this.banner) return;
    this.banner.setActive(on);
    if (!on) return;
    const h = SoloHues[this.called];
    this.bannerBg.color = h.color;
    this.bannerText.text = `POP ${h.name}!`;
    for (const im of this.bannerIcons) im.sprite = BalloonArt.Hue(h.color, this.called);
    UIKit.setMeter(this.bannerBar, this.step === "play" ? this.callT / this.callDur : 1);
    this.bannerPop = Math.max(0, this.bannerPop - Time.unscaledDeltaTime * 2.5);
    const warn = this.step === "play" && this.callT < 1.2;
    const s = (1 + 0.25 * Ease.outBack(this.bannerPop)) * (warn ? 1 + 0.04 * Math.sin(Time.time * 20) : 1);
    const w = this.UI.Hud.rect.width, fit = Math.min(1, (w - 40) / 860);
    this.banner.localScale = new V3(s * fit, s * fit, 1);
  }

  // ------------------------------------------------------------------ HUD / results

  protected PanelSub(i: number) { return this.Solo ? `WRONG ${this.wrong[0]}` : DuoHues[i].name; }
  protected CardSub(i: number) { return `${this.right[i]} RIGHT · ${this.wrong[i]} WRONG · ${this.brands[i]} ${this.BrandName}`; }
  protected ResultStats(): [string, string][] {
    const acc = (i: number) => (this.throws[i] ? `${Math.round((this.hitsAny[i] / this.throws[i]) * 100)}%` : "–");
    if (this.mode === WMode.Solo) return [["RIGHT POPS", String(this.right[0])], ["WRONG POPS", String(this.wrong[0])], [`${this.BrandName} BALLOONS`, String(this.brands[0])], ["ACCURACY", acc(0)]];
    return [["POINTS", `${this.scores[0]} – ${this.scores[1]}`], ["RIGHT POPS", `${this.right[0]} – ${this.right[1]}`], ["WRONG POPS", `${this.wrong[0]} – ${this.wrong[1]}`], [`${this.BrandName}`, `${this.brands[0]} – ${this.brands[1]}`]];
  }

  /** Test hook: balloons in CSS pixels, with whether each player should pop them. */
  get debugInfo() {
    return {
      state: this.State, step: this.step, mode: this.mode, demo: this.demo, timeLeft: this.timeLeft, scores: this.scores, called: this.called, ice: this.iceT,
      right: this.right, wrong: this.wrong, brands: this.brands,
      targets: this.balloons.filter((b) => b.active && b.y > -8).map((b) => ({ special: b.special, css: this.Css(b.center), lead: this.Css(b.center.add(new V2(0, b.speed * (this.iceT > 0 ? 0.35 : 1) * 0.1))), mine: [this.Mine(b, 0) && b.special !== Special.Ice, this.Mine(b, 1) && b.special !== Special.Ice] })),
    };
  }
}
