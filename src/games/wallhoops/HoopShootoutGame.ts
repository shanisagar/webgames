import {
  Art, AudioClip, CasualArt, Color, GameInfo, GameObject, howTo, LineRenderer, Mathf, Pal, Phase, Result, Sfx, Snd, SpriteRenderer,
  TextMesh, Time, TouchScheme, V2, V3, WallBoard,
} from "../../kit";
import { DiffNames, Gold, gauss, Mode, noise, P1, P2, WallGame } from "./WallKit";
import * as HA from "./HoopArt";

/**
 * HOOP SHOOTOUT: the fair-arcade basketball machine, projected on the wall. Each player owns a half with a hoop that
 * slides side to side (faster as the round goes on, bobbing up and down in the second half). A ball landing inside the
 * rim area (or on the painted square: a bank shot) is a basket: swish, net ripple, the ball drops through. Rim hits
 * clang off. Now and then the hoops turn golden BRAND hoops worth 3. The last 15 seconds count double.
 * SOLO: one hoop across the whole wall, beat your best in 2:00. VS COMPUTER: a virtual shooter (easy / medium / hard)
 * fills the right hoop. 2 PLAYERS: left vs right, most points wins.
 */

const RoundSecs = 120, FrenzySecs = 15;
const RimRX = 2.2, RimY0 = -0.6, BoardW = 6.6, BoardCY = 1.9;
const NetTopHalf = 2.05, NetBotHalf = 1.25, NetH = 2.8, Strands = 9, NetRows = 6;
const BrandAt = [0.2, 0.5, 0.76], BrandSecs = 7;
/** Bot spread (world units, 1 sigma) and seconds between shots per difficulty. */
const BotSigma = [2.6, 1.8, 1.15], BotEvery = [3.0, 2.3, 1.9];
const RampY = -7.5, FloorY = -6.9;

interface Swish { sr: SpriteRenderer; t: number; from: V2; active: boolean }

class Hoop {
  root!: GameObject;
  glass!: SpriteRenderer; frame!: SpriteRenderer; rimB!: SpriteRenderer; rimF!: SpriteRenderer; bracket!: SpriteRenderer;
  halo!: SpriteRenderer; word!: TextMesh;
  net: LineRenderer[] = [];
  hem!: LineRenderer;
  swish: Swish[] = [];
  x = 0; y = RimY0; kick = 0; kickT = 0; flash = 0; brand = 0;
  color = P1;
}

export class HoopShootoutGame extends WallGame {
  private hoops: Hoop[] = [];
  private cabs: SpriteRenderer[] = []; private cabFrames: SpriteRenderer[] = []; private ramps: SpriteRenderer[] = [];
  private bulbs: SpriteRenderer[] = []; private bulbSide: number[] = []; private bulbsUsed = 0;
  private divider!: SpriteRenderer; private dividerGlow!: SpriteRenderer;

  private phase = 0; private bobPhase = 0; private speed = 0; private amp = 3.4; private bob = 0;
  private brandT = 0; private brandNext = 0; private frenzy = false;
  private score = [0, 0]; private baskets = [0, 0]; private shots = [0, 0]; private streak = [0, 0]; private bestStreak = [0, 0]; private brandHits = [0, 0];
  private botT = [0, 0];

  private swishClip!: AudioClip; private clangClip!: AudioClip; private dingClip!: AudioClip; private boardClip!: AudioClip; private fireClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "wallhoops",
      Title: "HOOP SHOOTOUT",
      Tagline: "THROW IT IN THE MOVING HOOP!",
      PlayLabel: "PLAY",
      Accent: HA.Orange,
      Accent2: Gold,
      BgTop: Pal.hex(0x2a1460),
      BgBottom: Pal.hex(0x0b0620),
      ShortSide: 18,
      Touch: TouchScheme.None,
      Music: { bpm: 124, rootHz: 110, degrees: [0, 5, 3, 4], seed: 23, energy: 0.75, major: true },
      Reminders: [
        "The hoops are moving|How many baskets in two minutes?",
        "Golden hoop alert|BRAND hoops are worth 3 points!",
        "Bring a friend|Left half vs right half: shootout!",
      ],
      HowTo: [
        howTo(Art.Disc, HA.Orange, "Throw the ball at YOUR hoop. Inside the rim area = BASKET (1 point)."),
        howTo(Art.Square, Color.white, "The painted square on the backboard counts too: BANK SHOT!"),
        howTo(Art.Star, Gold, "Golden BRAND hoops appear now and then: worth 3 points!"),
        howTo(Art.Chevron, P2, "The hoops slide faster as time runs out, and start bobbing. Last 15 s: double points!"),
        howTo(Art.Diamond, P1, "2 PLAYERS: left half is PLAYER 1, right half is PLAYER 2. Most points wins."),
      ],
      Tips: [
        "Aim where the hoop is going, not where it is.",
        "Three baskets in a row: ON FIRE! Every basket gets +1.",
        "Save your best throws for the golden hoop.",
        "Rim shots clang out: aim for the middle of the net.",
      ],
    });
  }

  protected RoundSeconds() { return RoundSecs; }
  protected BallSprite() { return HA.BallSprite(); }
  protected get BallSize() { return 1.25; }
  protected Backdrop() { return HA.Backdrop(); }
  protected ModeInfo(m: Mode) {
    return m === Mode.Solo ? "One hoop slides across the whole wall.\n\nScore as many baskets as you can in 2:00 and beat today's best!"
      : m === Mode.Cpu ? "You shoot at the LEFT hoop.\n\nA virtual shooter fills the RIGHT hoop. Outscore it in 2:00!"
        : "PLAYER 1: left hoop.\nPLAYER 2: right hoop.\n\nThrow at the same time. Most points in 2:00 wins!";
  }

  // ------------------------------------------------------------------ build

  protected BuildWall() {
    const w = this.wall;
    for (let i = 0; i < 2; i++) {
      this.cabs.push(Art.spr(w, "Cabinet" + i, HA.CabinetSprite(), Color.white, 1, -20, Art.Flat));
      this.cabFrames.push(Art.spr(w, "CabFrame" + i, HA.CabinetFrame(), Color.white, 1, -19, Art.Flat));
      this.ramps.push(Art.spr(w, "Ramp" + i, HA.RampSprite(), Color.white, 1, 30, Art.Flat));
    }
    for (let i = 0; i < 64; i++) { this.bulbs.push(Art.spr(w, "Bulb", HA.Bulb(), Color.white, 0.55, -18, Art.Flat)); this.bulbSide.push(0); }
    this.dividerGlow = Art.spr(w, "DividerGlow", CasualArt.Soft, Gold.withAlpha(0.25), 1, -17, Art.Additive);
    this.divider = Art.spr(w, "Divider", CasualArt.make("wh-div", 8, 64, () => Color.white), Gold, 1, -16, Art.Flat);
    for (let i = 0; i < 2; i++) this.hoops.push(this.MakeHoop(i));
    const n = (i: number) => noise(i);
    this.swishClip = Sfx.make("wh-swish", 0.5, (t) => {
      const e = Sfx.env(t, 0.015, 0.35);
      return (n(Math.trunc(t * 44100) + 11) * (0.5 + 0.5 * Math.sin(t * 160)) * 0.45 + Sfx.sinP(Sfx.glide(t, 900, 500, 0.3)) * 0.1) * e;
    });
    this.clangClip = Sfx.make("wh-clang", 0.6, (t) => (Sfx.sinP(820 * t) * 0.45 + Sfx.sinP(1290 * t) * 0.3 + Sfx.sinP(2210 * t) * 0.18 + n(Math.trunc(t * 44100) + 4) * 0.25 * Sfx.env(t, 0, 0.01)) * Sfx.env(t, 0.001, 0.35) * 0.7);
    this.boardClip = Sfx.make("wh-board", 0.2, (t) => (Sfx.sinP(Sfx.glide(t, 240, 120, 0.1)) * 0.7 + n(Math.trunc(t * 44100) + 8) * 0.35) * Sfx.env(t, 0.001, 0.1) * 0.7);
    this.dingClip = Sfx.make("wh-ding", 1.0, (t) => {
      let v = 0;
      const notes = [784, 988, 1175, 1568];
      for (let k = 0; k < 4; k++) { const tt = t - k * 0.09; if (tt > 0) v += (Sfx.sinP(notes[k] * tt) + 0.3 * Sfx.sinP(notes[k] * 2.01 * tt)) * Sfx.env(tt, 0.002, 0.45) * 0.25; }
      return v;
    });
    this.fireClip = Sfx.make("wh-fire", 0.7, (t) => (n(Math.trunc(t * 22050) + 31) * 0.5 + Sfx.sawP(Sfx.glide(t, 80, 160, 0.6)) * 0.3) * Sfx.env(t, 0.05, 0.45) * 0.6);
  }

  private MakeHoop(side: number) {
    const h = new Hoop();
    h.root = new GameObject("Hoop" + side, this.wall);
    const r = h.root;
    h.halo = Art.spr(r, "Halo", HA.Halo(), Gold.withAlpha(0), 9, 1, Art.Additive);
    h.halo.transform.localPosition = new V2(0, BoardCY - 0.4);
    h.halo.transform.localScale = new V3(10, 8.5, 1);
    h.glass = Art.spr(r, "Glass", HA.BoardSprite(), Color.white, BoardW, 2, Art.Flat);
    h.glass.transform.localPosition = new V2(0, BoardCY);
    h.frame = Art.spr(r, "Frame", HA.BoardFrame(), Color.white, BoardW, 3, Art.Flat);
    h.frame.transform.localPosition = new V2(0, BoardCY);
    h.word = new GameObject("Word", r).addComponent(new TextMesh());
    h.word.fontSize = 64; h.word.characterSize = 0.11; h.word.anchor = "MiddleCenter"; h.word.fontStyle = "bold"; h.word.sortingOrder = 4;
    h.word.transform.localPosition = new V2(0, BoardCY + 1.55);
    h.bracket = Art.spr(r, "Bracket", CasualArt.make("wh-brk", 32, 16, (p) => new Color(0.7, 0.72, 0.8, CasualArt.fill(CasualArt.sdBox(p, new V2(0.95, 0.45), 0.1), 2 / 32))), Color.white, 1.4, 5, Art.Flat);
    h.bracket.transform.localPosition = new V2(0, -0.05);
    h.rimB = Art.spr(r, "RimBack", HA.RimHalf(false), Color.white, RimRX * 2 / 0.917, 6, Art.Flat);
    for (let i = 0; i < 3; i++) {
      const sr = Art.spr(r, "SwishBall", HA.BallSprite(), Color.white, 1.25, 7, Art.Flat);
      sr.gameObject.setActive(false);
      h.swish.push({ sr, t: 0, from: V2.zero, active: false });
    }
    for (let i = 0; i < Strands; i++) h.net.push(Art.line(r, "Net" + i, new Color(1, 1, 1, 0.9), 0.075, 8, false, false, Art.Flat));
    h.hem = Art.line(r, "Hem", new Color(1, 1, 1, 0.9), 0.08, 8, false, false, Art.Flat);
    h.rimF = Art.spr(r, "RimFront", HA.RimHalf(true), Color.white, RimRX * 2 / 0.917, 9, Art.Flat);
    return h;
  }

  // ------------------------------------------------------------------ round setup

  protected ResetRound() {
    const solo = this.Solo;
    this.phase = 0; this.bobPhase = 0; this.speed = 0; this.bob = 0;
    this.amp = solo ? 5 : 3.4;
    this.brandT = 0; this.brandNext = 0; this.frenzy = false;
    this.score = [0, 0]; this.baskets = [0, 0]; this.shots = [0, 0]; this.streak = [0, 0]; this.bestStreak = [0, 0]; this.brandHits = [0, 0];
    this.botT = [1.2 + Math.random(), 1.6 + Math.random()];
    const names = this.Names();
    for (let i = 0; i < 2; i++) {
      const h = this.hoops[i];
      h.root.setActive(!solo || i === 0);
      h.color = solo ? HA.Orange : this.sideCol[i];
      h.brand = 0; h.kick = 0; h.flash = 0;
      h.word.text = solo ? "HOOP SHOOTOUT" : names[i];
      for (const s of h.swish) { s.active = false; s.sr.gameObject.setActive(false); }
    }
    // cabinets, ramps and bulbs
    this.bulbsUsed = 0;
    const cabsN = solo ? 1 : 2;
    for (let i = 0; i < 2; i++) {
      const on = i < cabsN;
      this.cabs[i].gameObject.setActive(on); this.cabFrames[i].gameObject.setActive(on); this.ramps[i].gameObject.setActive(on);
      if (!on) continue;
      const cx = solo ? 0 : i === 0 ? -8 : 8, wdt = solo ? 30.4 : 15, cy = -1.0, hgt = 11.6;
      for (const s of [this.cabs[i], this.cabFrames[i]]) { s.transform.localPosition = new V2(cx, cy); s.transform.localScale = new V3(wdt, hgt / 0.8, 1); }
      this.cabFrames[i].color = (solo ? HA.Orange : this.sideCol[i]).withAlpha(0.95);
      this.ramps[i].transform.localPosition = new V2(cx, RampY);
      this.ramps[i].transform.localScale = new V3(wdt, 2.6 / 0.18, 1);
      // bulbs along the top and the sides
      const top = cy + hgt / 2 - 0.45, left = cx - wdt / 2 + 0.45, right = cx + wdt / 2 - 0.45, bottom = cy - hgt / 2 + 0.6;
      const nTop = solo ? 30 : 15;
      for (let k = 0; k < nTop; k++) this.PlaceBulb(new V2(Mathf.lerp(left, right, k / (nTop - 1)), top), i);
      for (let k = 1; k < 7; k++) { const y = Mathf.lerp(top, bottom, k / 6); this.PlaceBulb(new V2(left, y), i); this.PlaceBulb(new V2(right, y), i); }
    }
    for (let k = this.bulbsUsed; k < this.bulbs.length; k++) this.bulbs[k].gameObject.setActive(false);
    this.divider.gameObject.setActive(!solo);
    this.dividerGlow.gameObject.setActive(!solo);
    this.divider.transform.localPosition = new V2(0, -1.8);
    this.divider.transform.localScale = new V3(0.16, 14.4 / 8, 1);
    this.dividerGlow.transform.localPosition = new V2(0, -1.8);
    this.dividerGlow.transform.localScale = new V3(1.4, 15, 1);
    this.PlaceHoops();
  }

  private PlaceBulb(p: V2, side: number) {
    if (this.bulbsUsed >= this.bulbs.length) return;
    const b = this.bulbs[this.bulbsUsed];
    this.bulbSide[this.bulbsUsed] = side;
    this.bulbsUsed++;
    b.gameObject.setActive(true);
    b.transform.localPosition = p;
  }

  // ------------------------------------------------------------------ motion

  /** Hoop rim centre for a side, `ahead` seconds from now (used by the virtual shooter to lead the hoop). */
  private HoopPos(side: number, ahead = 0) {
    const ph = this.phase + this.speed * ahead, bp = this.bobPhase + this.speed * 0.8 * ahead;
    const off = this.amp * Math.sin(ph), y = RimY0 + this.bob * Math.sin(bp);
    if (this.Solo) return new V2(off, y);
    return side === 0 ? new V2(-8 + off, y) : new V2(8 - off, y);
  }

  private PlaceHoops() {
    for (let i = 0; i < 2; i++) {
      const h = this.hoops[i], p = this.HoopPos(i);
      h.x = p.x; h.y = p.y;
      h.root.localPosition = new V3(p.x, p.y, 0);
    }
  }

  protected TickWall(dt: number, live: boolean) {
    if (live) {
      const p = this.RoundProgress;
      this.speed = p < 0.1 ? 0 : Mathf.lerp(0.6, 1.75, (p - 0.1) / 0.9);
      this.bob = Mathf.moveTowards(this.bob, p < 0.5 ? 0 : Mathf.lerp(0.6, 1.3, (p - 0.5) / 0.5), dt * 0.5);
      if (this.Solo) this.amp = Mathf.lerp(5, 10.4, Mathf.clamp01((p - 0.05) / 0.7));
    } else this.speed = Mathf.moveTowards(this.speed, this.State === Phase.Playing ? 0 : 0.45, dt);
    this.phase += this.speed * dt;
    this.bobPhase += this.speed * 0.8 * dt;
    this.PlaceHoops();
    this.Present(dt);
  }

  protected TickPlay(dt: number) {
    const p = this.RoundProgress;
    // golden BRAND hoops
    if (this.brandT > 0) {
      this.brandT -= dt;
      if (this.brandT <= 0) for (const h of this.hoops) h.brand = 0;
    } else if (this.brandNext < BrandAt.length && p >= BrandAt[this.brandNext]) {
      this.brandNext++;
      this.brandT = BrandSecs;
      for (const h of this.hoops) h.brand = 1;
      this.Big(`${this.BrandWord("GOLDEN")} HOOP ×3`, this.BrandColor, 1.6, 1.8);
      Sfx.playClip(this.dingClip, 0.9);
      this.fxw.sparkle(new V2(this.hoops[0].x, this.hoops[0].y + 2), this.BrandColor, 14, 3, 0.5);
      if (!this.Solo) this.fxw.sparkle(new V2(this.hoops[1].x, this.hoops[1].y + 2), this.BrandColor, 14, 3, 0.5);
    }
    if (!this.frenzy && this.clock <= FrenzySecs) {
      this.frenzy = true;
      this.Big("FINAL 15s · DOUBLE POINTS!", Pal.hex(0xff6a3a), 1.8, 1.6);
      Sfx.playClip(this.hornClip, 0.6, 1.25);
      Sfx.setIntensity(1);
    }
    // virtual shooters
    for (let side = 0; side < 2; side++) {
      if (!this.IsBot(side)) continue;
      this.botT[side] -= dt;
      if (this.botT[side] > 0) continue;
      const d = this.demo ? 1 : this.diff;
      this.botT[side] = BotEvery[d] * Mathf.lerp(0.7, 1.3, Math.random());
      const dur = 0.85;
      const aim = this.HoopPos(side, dur).add(new V2(0, -0.4));
      const s = BotSigma[d] * (this.hoops[side].brand ? 0.85 : 1);
      this.Throw(side, aim.add(new V2(gauss() * s, gauss() * s * 0.8)), dur);
    }
  }

  protected OnTime() {
    this.brandT = 0;
    for (const h of this.hoops) h.brand = 0;
  }

  // ------------------------------------------------------------------ hits

  protected OnHit(side: number, p: V2, bot: boolean) {
    if (!this.Live) return;
    const h = this.hoops[this.Solo ? 0 : side];
    const lx = p.x - h.x, ly = p.y - h.y;
    this.shots[side]++;
    const inRim = (lx / 1.9) * (lx / 1.9) + ((ly + 0.4) / 1.15) * ((ly + 0.4) / 1.15) <= 1;
    const bank = !inRim && Math.abs(lx) < 1.3 && ly > 0.3 && ly < 2.0;
    const col = this.sideCol[side];
    if (inRim || bank) {
      const swish = inRim && Math.hypot(lx / 1.9, (ly + 0.4) / 1.15) < 0.42;
      let pts = h.brand ? 3 : 1;
      if (this.frenzy) pts *= 2;
      this.streak[side]++;
      this.bestStreak[side] = Math.max(this.bestStreak[side], this.streak[side]);
      const fire = this.streak[side] >= 3;
      if (fire) pts += 1;
      this.score[side] += pts;
      this.baskets[side]++;
      if (h.brand) this.brandHits[side]++;
      this.Impact(p, h.brand ? this.BrandColor : col, true);
      this.StartSwish(h, p);
      Sfx.playClip(this.swishClip, 0.9);
      Sfx.play(Snd.Coin, 0.55, 1 + Math.min(0.5, this.streak[side] * 0.05));
      if (h.brand || fire || swish) Sfx.playClip(this.cheerClip, bot ? 0.35 : 0.7);
      if (this.streak[side] === 3) Sfx.playClip(this.fireClip, 0.8);
      const label = h.brand ? `${this.BrandWord("GOLDEN")}! +${pts}` : fire ? `ON FIRE! +${pts}` : bank ? `BANK SHOT! +${pts}` : swish ? `SWISH! +${pts}` : `+${pts}`;
      const lc = h.brand ? this.BrandColor : fire ? Pal.hex(0xff7a3a) : Color.white;
      this.UI.Float(new V2(h.x, h.y + 1.4), label, lc, h.brand || fire ? 1.7 : 1.35);
      this.fxw.sparkle(new V2(h.x, h.y), h.brand ? this.BrandColor : Gold, h.brand ? 18 : 9, 1.6, 0.45);
      if (h.brand || swish) this.fxw.confetti(new V2(h.x, h.y + 0.5), h.brand ? 40 : 16, 8, [col, Gold, Color.white]);
      h.flash = 1;
      this.Fx.shake(h.brand ? 0.35 : 0.18);
      this.PopPanel(side);
      if (!bot) this.Data.add("baskets", 1);
      return;
    }
    // misses: rim clang, backboard, wall
    this.streak[side] = 0;
    this.Impact(p, col, false);
    if (Math.abs(lx) > 1.75 && Math.abs(lx) < 2.9 && Math.abs(ly) < 0.85) {
      Sfx.playClip(this.clangClip, 0.85, 0.95 + Math.random() * 0.1);
      this.Drop(HA.BallSprite(), p, new V2(Math.sign(lx) * Mathf.lerp(5, 8, Math.random()), Mathf.lerp(7, 10, Math.random())), 1.25, { floor: FloorY, life: 1.8, order: 12 });
      this.UI.Float(new V2(p.x, p.y + 1), "CLANG!", Pal.hex(0xffb070), 1.1);
      h.flash = 0.6;
      this.Fx.shake(0.12);
    } else if (Math.abs(lx) < BoardW / 2 && ly > -0.45 && ly < BoardCY + 2.2) {
      Sfx.playClip(this.boardClip, 0.8);
      this.Drop(HA.BallSprite(), p, new V2((Math.random() - 0.5) * 3, -1), 1.25, { floor: FloorY, life: 1.6, order: 12 });
    } else {
      Sfx.playClip(this.thudClip, 0.7);
      this.Drop(HA.BallSprite(), p, new V2((Math.random() - 0.5) * 3, -2), 1.25, { floor: FloorY, life: 1.6, order: 12 });
    }
  }

  private StartSwish(h: Hoop, p: V2) {
    const s = h.swish.find((x) => !x.active) ?? h.swish[0];
    s.active = true; s.t = 0; s.from = new V2(p.x - h.x, p.y - h.y);
    s.sr.gameObject.setActive(true);
    h.kick = 1; h.kickT = 0;
  }

  // ------------------------------------------------------------------ present

  private Present(dt: number) {
    const t = Time.time;
    // chase lights
    for (let k = 0; k < this.bulbsUsed; k++) {
      const side = this.bulbSide[k];
      const on = Math.sin(t * (this.frenzy ? 14 : 7) - k * 0.85) > 0.2;
      const base = this.Solo ? HA.Orange : this.sideCol[side];
      const brand = this.hoops[this.Solo ? 0 : side].brand > 0;
      const c = brand ? this.BrandColor : base;
      this.bulbs[k].color = on ? Color.lerp(c, Color.white, 0.35) : c.withAlpha(0.28);
    }
    this.dividerGlow.color = Gold.withAlpha(0.18 + 0.08 * Math.sin(t * 3));
    for (let i = 0; i < 2; i++) {
      const h = this.hoops[i];
      if (!h.root.activeSelf) continue;
      h.flash = Mathf.moveTowards(h.flash, 0, dt * 2.5);
      const brand = h.brand > 0;
      const bc = this.BrandColor;
      h.frame.color = Color.lerp(brand ? bc : h.color, Color.white, h.flash * 0.6);
      h.glass.color = brand ? Color.lerp(Color.white, bc, 0.35 + 0.1 * Math.sin(t * 8)) : Color.white;
      h.halo.color = (brand ? bc : h.color).withAlpha(brand ? 0.55 + 0.25 * Math.sin(t * 9) : 0.12 + h.flash * 0.5);
      h.word.text = brand ? `${this.BrandWord("GOLDEN")} ×3` : this.Solo ? "HOOP SHOOTOUT" : this.Names()[i];
      h.word.characterSize = h.word.text.length > 11 ? 0.08 : 0.11;
      h.word.color = brand ? CasualArt.darken(bc, 0.35) : CasualArt.darken(h.color, 0.25);
      const rimC = brand ? Color.lerp(bc, Color.white, 0.15) : Color.white;
      h.rimF.color = rimC; h.rimB.color = rimC;
      // swish balls: snap to the rim centre, then drop through the net
      for (const s of h.swish) {
        if (!s.active) continue;
        s.t += dt;
        const k1 = Mathf.clamp01(s.t / 0.12);
        let pos: V2, size = 1.25;
        if (s.t < 0.12) pos = V2.lerp(s.from, new V2(0, 0.55), 1 - (1 - k1) * (1 - k1));
        else {
          const k2 = (s.t - 0.12) / 0.5;
          pos = new V2(Math.sin(k2 * 9) * 0.06, 0.55 - 4.2 * k2 * k2 - 0.6 * k2);
          size = 1.25 * (1 - 0.12 * k2);
          if (k2 >= 1) {
            s.active = false;
            s.sr.gameObject.setActive(false);
            this.Drop(HA.BallSprite(), new V2(h.x + pos.x, h.y + pos.y), new V2((Math.random() - 0.5) * 4, -9), 1.15, { floor: FloorY, life: 1.3, order: 12 });
            continue;
          }
        }
        s.sr.transform.localPosition = pos;
        s.sr.transform.localScale = new V3(size, size, 1);
        s.sr.transform.localEulerZ = s.t * 400;
      }
      // net ripple (damped wave travelling down the strands)
      h.kickT += dt;
      h.kick = Mathf.moveTowards(h.kick, 0, dt * 1.3);
      const kick = h.kick;
      const hemPts: V2[] = [];
      for (let sIdx = 0; sIdx < Strands; sIdx++) {
        const ln = h.net[sIdx];
        ln.positionCount = NetRows + 1;
        for (let j = 0; j <= NetRows; j++) {
          const v = j / NetRows;
          const stretch = 1 + kick * 0.35 * Math.max(0, Math.sin(h.kickT * 10 - v * 2));
          const half = Mathf.lerp(NetTopHalf, NetBotHalf, v) * (1 - kick * 0.18 * Math.sin(h.kickT * 12 - v * 3));
          const u = -1 + (2 * (sIdx + ((sIdx + j) % 2 === 0 ? -0.5 : 0.5) * 0.9 + 0.5)) / Strands;
          const x = half * Mathf.clamp(u, -1, 1) + Math.sin(h.kickT * 14 + v * 4) * kick * 0.12 * v;
          const y = -v * NetH * stretch;
          ln.setPosition(j, new V2(x, y));
          if (j === NetRows) hemPts.push(new V2(x, y));
        }
        ln.color = new Color(1, 1, 1, 0.92);
      }
      hemPts.sort((a, b) => a.x - b.x);
      h.hem.setPositions(hemPts);
      // on fire
      const fire = this.Live && this.streak[i] >= 3;
      if (fire) {
        const a = Math.random() * Math.PI;
        const fc = Math.random() < 0.5 ? Pal.hex(0xff8a2a) : Pal.hex(0xffd84a);
        this.fxw.emit(new V2(h.x + Math.cos(a) * RimRX, h.y - Math.sin(a) * 0.4), new V2(Math.cos(a) * 0.6, 3 + Math.random() * 3), fc, 0.4 + Math.random() * 0.25, 0.45);
        const fr = 0.5 + 0.5 * Math.sin(t * 18);
        h.rimF.color = Color.lerp(h.rimF.color, Pal.hex(0xffd84a), fr * 0.6);
      }
    }
  }

  // ------------------------------------------------------------------ HUD + results

  protected PanelText(side: number): [string, string] {
    if (this.Solo) {
      if (side === 0) return [String(this.score[0]), this.streak[0] >= 3 ? `ON FIRE! · ${this.baskets[0]} BASKETS` : `${this.baskets[0]} BASKETS · ${this.Accuracy(0)}%`];
      const top = WallBoard.list(this.Info.Id, 1)[0];
      return [top ? String(top.score) : "---", top ? `BEAT ${top.label}'S SCORE!` : "SET TODAY'S BEST!"];
    }
    return [String(this.score[side]), this.streak[side] >= 3 ? "ON FIRE!" : `${this.baskets[side]} BASKETS · ${this.Accuracy(side)}%`];
  }

  private Accuracy(side: number) { return this.shots[side] > 0 ? Math.round((this.baskets[side] / this.shots[side]) * 100) : 0; }

  protected MakeResult() {
    const s = this.score;
    const stats = (i: number): [string, string][] => [["BASKETS", `${this.baskets[i]} / ${this.shots[i]}`], ["ACCURACY", `${this.Accuracy(i)}%`], ["BEST STREAK", String(this.bestStreak[i])], [`${this.BrandWord("GOLDEN")} BASKETS`, String(this.brandHits[i])]];
    const stars = (v: number) => WallGame.Stars(v, 8, 18, 30);
    if (this.mode === Mode.Solo) {
      const nb = this.SaveBest(s[0]);
      this.Data.add("solos", 1);
      return {
        result: new Result({
          Headline: nb ? "NEW BEST!" : s[0] >= 18 ? "GREAT SHOOTING!" : "TIME!", HeadlineColor: nb ? Gold : Pal.hex(0xffd2b0),
          Value: String(s[0]), CountTo: s[0], NewBest: nb, Victory: s[0] > 0, BestLine: `POINTS · SOLO BEST ${this.Data.get("best0")}`,
          Stats: stats(0), Primary: "PLAY AGAIN",
        }),
        score: s[0], label: "SOLO", stars: stars(s[0]),
      };
    }
    if (this.mode === Mode.Cpu) {
      const won = s[0] > s[1], draw = s[0] === s[1];
      if (won) { this.Data.add("wins", 1); this.Data.max("bestWinDiff" + this.diff, s[0] - s[1]); }
      this.SaveBest(s[0]);
      return {
        result: new Result({
          Headline: won ? "YOU WIN!" : draw ? "IT'S A DRAW!" : "THE COMPUTER WINS", HeadlineColor: won ? Gold : draw ? Color.white : Pal.hex(0xffb0c0),
          Value: `${s[0]} – ${s[1]}`, Victory: won, BestLine: `VS COMPUTER · ${DiffNames[this.diff]}`, Stats: stats(0), Primary: won ? "PLAY AGAIN" : "REMATCH",
        }),
        score: s[0], label: "VS CPU", stars: won ? Math.max(1, stars(s[0])) : 0,
      };
    }
    const w = s[0] === s[1] ? -1 : s[0] > s[1] ? 0 : 1;
    this.Data.add("duels", 1);
    this.SaveBest(Math.max(s[0], s[1]));
    const names = ["PLAYER 1", "PLAYER 2"];
    return {
      result: new Result({
        Headline: w < 0 ? "IT'S A DRAW!" : `${names[w]} WINS!`, HeadlineColor: w < 0 ? Gold : this.sideCol[w], Victory: true,
        Value: `${s[0]} – ${s[1]}`, BestLine: "PLAYER 1 – PLAYER 2",
        Stats: [["P1 BASKETS", `${this.baskets[0]} / ${this.shots[0]}`], ["P2 BASKETS", `${this.baskets[1]} / ${this.shots[1]}`], ["P1 BEST STREAK", String(this.bestStreak[0])], ["P2 BEST STREAK", String(this.bestStreak[1])]],
        Primary: "REMATCH",
      }),
      score: Math.max(s[0], s[1]), label: w < 0 ? "DRAW" : w === 0 ? "P1" : "P2", stars: stars(Math.max(s[0], s[1])),
    };
  }

}
