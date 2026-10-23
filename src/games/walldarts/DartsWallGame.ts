import {
  Art, AudioClip, Color, GameInfo, GameObject, howTo, Mathf, Pal, Result, Sfx, Snd, SpriteRenderer, TextMesh, Time, TouchScheme, V2, V3,
  WallBoard,
} from "../../kit";
import { DiffNames, Gold, gauss, Mode, noise, P1, P2, WallGame } from "./WallKit";
import * as DA from "./DartsArt";

/**
 * DARTS WALL: the pub board, projected big. Each player gets a dartboard on their half and ten throws. A ball scores by
 * where it lands (singles, the doubles ring, the trebles ring, outer bull 25, bull 50); a dart sticks in the board at
 * the impact point with a callout. Three darts make a visit ("TON!", "ONE HUNDRED AND EIGHTY!"). Highest total after
 * ten throws each wins. SOLO: ten darts to beat today's top score. VS COMPUTER: a virtual thrower on the right board,
 * its skill is the spread around its aim. 2 PLAYERS: left board vs right board. Rings are widened for soft balls.
 */

const Darts = 10, RoundSecs = 120;
/** Virtual thrower: spread (1 sigma, world units) and where it aims. */
const BotSigma = [2.0, 1.25, 0.75];

interface Board {
  root: GameObject; cab: SpriteRenderer; board: SpriteRenderer; glow: SpriteRenderer; nums: TextMesh[];
  darts: { body: SpriteRenderer; flight: SpriteRenderer; t: number }[];
  c: V2; R: number; Rp: number; shake: number;
  thrown: number; total: number; last: string; visit: number[]; best: number; trebles: number; doubles: number; bulls: number; scores: number[];
}

export class DartsWallGame extends WallGame {
  private boards: Board[] = [];
  private botT = [0, 0];
  private thunkClip!: AudioClip; private dingClip!: AudioClip; private bounceClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "walldarts",
      Title: "DARTS WALL",
      Tagline: "TEN THROWS. HIT THE TREBLE 20!",
      PlayLabel: "PLAY",
      Accent: Pal.hex(0xe0383f),
      Accent2: Gold,
      BgTop: Pal.hex(0x174a37),
      BgBottom: Pal.hex(0x0c2a20),
      ShortSide: 18,
      Touch: TouchScheme.None,
      Music: { bpm: 104, rootHz: 87.3, degrees: [0, 3, 4, 5], seed: 57, energy: 0.5, major: true },
      Reminders: [
        "The oche is open|Ten darts. What's your total?",
        "Treble 20 is 60|Can you beat today's top score?",
        "Pub challenge|Left board vs right board, ten darts each.",
      ],
      HowTo: [
        howTo(Art.Disc, Pal.hex(0xf1dfb8), "Throw the ball at YOUR dartboard: it scores where it lands, and a dart sticks there."),
        howTo(Art.Ring, Pal.hex(0x1a8f4a), "Outer thin ring = DOUBLE, inner thin ring = TREBLE (×3). Outer bull 25, bull 50!"),
        howTo(Art.Star, Gold, "Ten throws each. Highest total wins. Three darts make a visit: 100+ is a TON!"),
        howTo(Art.Diamond, P2, "2 PLAYERS: left board is PLAYER 1, right board is PLAYER 2."),
        howTo(Art.Chevron, P1, "SOLO: ten darts to beat today's top score on the leaderboard."),
      ],
      Tips: [
        "Treble 20 is at the top: 60 points!",
        "Not sure? Aim for the bull: 25 or 50 and big singles around it.",
        "19 at the bottom-left is the pros' plan B.",
      ],
    });
  }

  protected RoundSeconds() { return RoundSecs; }
  protected BallSprite() { return DA.BallSprite(); }
  protected get BallSize() { return 0.9; }
  protected Backdrop() { return DA.Backdrop(); }
  protected ModeInfo(m: Mode) {
    return m === Mode.Solo ? "One big board, ten darts.\n\nThe leaderboard is the target: beat today's top score!"
      : m === Mode.Cpu ? "You throw at the LEFT board.\n\nA virtual thrower uses the RIGHT board. Ten darts each, highest total wins!"
        : "PLAYER 1: left board.\nPLAYER 2: right board.\n\nTen darts each. Highest total wins!";
  }

  // ------------------------------------------------------------------ build

  protected BuildWall() {
    for (let i = 0; i < 2; i++) this.boards.push(this.MakeDartboard(i));
    const n = (i: number) => noise(i);
    this.thunkClip = Sfx.make("wd-thunk", 0.25, (t) => (Sfx.sinP(Sfx.glide(t, 300, 110, 0.05)) * 0.7 + n(Math.trunc(t * 44100) + 5) * 0.5 * Sfx.env(t, 0, 0.01)) * Sfx.env(t, 0.001, 0.08) * 0.9);
    this.dingClip = Sfx.make("wd-ding", 0.8, (t) => {
      let v = 0;
      for (const [f, d] of [[988, 0], [1319, 0.08]] as [number, number][]) { const tt = t - d; if (tt > 0) v += Sfx.sinP(f * tt) * Sfx.env(tt, 0.002, 0.4) * 0.3; }
      return v;
    });
    this.bounceClip = Sfx.make("wd-bounce", 0.2, (t) => (Sfx.sinP(Sfx.glide(t, 900, 500, 0.05)) * 0.4 + n(Math.trunc(t * 44100) + 2) * 0.3 * Sfx.env(t, 0, 0.01)) * Sfx.env(t, 0.001, 0.07) * 0.7);
  }

  private MakeDartboard(i: number): Board {
    const root = new GameObject("Board" + i, this.wall);
    const glow = Art.spr(root, "Lamp", Art.Glow, Pal.hex(0xffd8a0).withAlpha(0.3), 1, -12, Art.Additive);
    const cab = Art.spr(root, "Cabinet", DA.CabinetSprite(), Color.white, 1, -10, Art.Flat);
    const board = Art.spr(root, "Board", DA.BoardSprite(), Color.white, 1, -8, Art.Flat);
    const nums: TextMesh[] = [];
    for (let k = 0; k < 20; k++) {
      const t = new GameObject("Num" + k, root).addComponent(new TextMesh());
      t.text = String(DA.Order[k]); t.fontSize = 64; t.anchor = "MiddleCenter"; t.fontStyle = "bold"; t.sortingOrder = -7; t.color = Pal.hex(0xf0f0f0);
      nums.push(t);
    }
    const darts: Board["darts"] = [];
    for (let k = 0; k < Darts + 2; k++) {
      const body = Art.spr(root, "Dart", DA.DartSprite(), Color.white, 2.0, 20 + k, Art.Flat);
      const flight = Art.spr(body.gameObject, "Flight", DA.FlightTint(), Color.white, 1, 21 + k, Art.Flat);
      body.gameObject.setActive(false);
      darts.push({ body, flight, t: 0 });
    }
    return { root, cab, board, glow, nums, darts, c: V2.zero, R: 6.6, Rp: 5.5, shake: 0, thrown: 0, total: 0, last: "", visit: [], best: 0, trebles: 0, doubles: 0, bulls: 0, scores: [] };
  }

  // ------------------------------------------------------------------ round

  protected ResetRound() {
    const solo = this.Solo;
    this.botT = [1.5 + Math.random(), 2 + Math.random()];
    for (let i = 0; i < 2; i++) {
      const b = this.boards[i];
      b.root.setActive(!solo || i === 0);
      b.c = solo ? new V2(0, -1.7) : new V2(i === 0 ? -8 : 8, -1.75);
      b.R = solo ? 7.0 : 6.6;
      b.Rp = b.R * DA.PlayShare;
      b.thrown = b.total = b.best = b.trebles = b.doubles = b.bulls = 0;
      b.last = ""; b.visit = []; b.scores = []; b.shake = 0;
      b.root.localPosition = new V3(b.c.x, b.c.y, 0);
      b.board.transform.localScale = new V3(b.R * 2, b.R * 2, 1);
      b.cab.transform.localScale = new V3(b.R * 2.18, b.R * 2.18, 1);
      b.cab.color = Color.lerp(Color.white, this.sideCol[i], solo ? 0 : 0.12);
      b.glow.transform.localScale = new V3(b.R * 3.2, b.R * 3.0, 1);
      b.glow.transform.localPosition = new V2(0, b.R * 0.4);
      const nr = b.R * (1 + DA.PlayShare) / 2;
      for (let k = 0; k < 20; k++) {
        const a = (k * 18 * Math.PI) / 180;
        b.nums[k].transform.localPosition = new V2(Math.sin(a) * nr, Math.cos(a) * nr);
        b.nums[k].characterSize = (b.R * 0.13 * 10) / 64;
      }
      for (const d of b.darts) d.body.gameObject.setActive(false);
    }
  }

  /** Score at a point on a board: [points, label, kind (0 miss, 1 single, 2 double, 3 treble, 4 outer bull, 5 bull)]. */
  private ScoreAt(b: Board, p: V2): [number, string, number] {
    const d = p.sub(b.c), q = d.magnitude / b.Rp;
    if (q > 1) return [0, d.magnitude <= b.R ? "BOUNCE OUT" : "MISS", 0];
    if (q < DA.Bull) return [50, "BULLSEYE!", 5];
    if (q < DA.OuterBull) return [25, "OUTER BULL", 4];
    const ang = (Math.atan2(d.x, d.y) * 180) / Math.PI;
    const n = DA.Order[Math.floor(Mathf.repeat(ang + 9, 360) / 18) % 20];
    if (q > DA.TrebleIn && q < DA.TrebleOut) return [n * 3, `TREBLE ${n}`, 3];
    if (q > DA.DoubleIn) return [n * 2, `DOUBLE ${n}`, 2];
    return [n, String(n), 1];
  }

  /** World point at the centre of a segment's ring (for aiming). */
  private Spot(b: Board, n: number, ring: number) {
    const k = DA.Order.indexOf(n), a = (k * 18 * Math.PI) / 180;
    const r = ring === 3 ? (DA.TrebleIn + DA.TrebleOut) / 2 : ring === 2 ? (DA.DoubleIn + 1) / 2 : ring === 5 ? 0 : (DA.OuterBull + DA.TrebleIn) / 2;
    return b.c.add(new V2(Math.sin(a), Math.cos(a)).mul(r * b.Rp));
  }

  // ------------------------------------------------------------------ frame

  protected TickWall(dt: number) {
    for (let i = 0; i < 2; i++) {
      const b = this.boards[i];
      if (!b.root.activeSelf) continue;
      b.shake = Mathf.moveTowards(b.shake, 0, dt * 4);
      const s = b.shake * 0.12;
      b.root.localPosition = new V3(b.c.x + Math.sin(Time.time * 70) * s, b.c.y + Math.cos(Time.time * 63) * s, 0);
      b.glow.color = Pal.hex(0xffd8a0).withAlpha(0.22 + 0.03 * Math.sin(Time.time * 2 + i));
      for (const d of b.darts) {
        if (!d.body.gameObject.activeSelf) continue;
        d.t += dt;
        const k = Mathf.clamp01(d.t / 0.12);
        const sc = Mathf.lerp(3.4, 2.0, k * k) * (1 + Math.sin(Mathf.clamp01(d.t / 0.35) * Math.PI * 3) * 0.05 * (1 - Mathf.clamp01(d.t / 0.35)));
        d.body.transform.localScale = new V3(sc, sc, 1);
      }
    }
  }

  protected Remaining(side: number) { return Darts - this.boards[side].thrown; }

  protected RoundDone() {
    if (this.FlightsInAir > 0) return false;
    const n = this.Solo ? 1 : 2;
    for (let i = 0; i < n; i++) if (this.boards[i].thrown < Darts) return false;
    return true;
  }

  protected TickPlay(dt: number) {
    for (let side = 0; side < 2; side++) {
      if (!this.IsBot(side)) continue;
      const b = this.boards[side];
      if (b.thrown + this.FlightsFor(side) >= Darts) continue;
      this.botT[side] -= dt;
      if (this.botT[side] > 0) continue;
      // keep pace with the human (a little behind), but never stall
      const other = this.boards[1 - side];
      const behind = this.IsBot(1 - side) ? false : other.thrown > b.thrown + 1;
      this.botT[side] = (behind ? 1.4 : 3.6) * Mathf.lerp(0.75, 1.25, Math.random());
      const d = this.demo ? 1 : this.diff;
      // hard: treble 20 (bull when 20 has been missing); medium: treble 20 or 19; easy: the bull
      const aim = d === 0 ? this.Spot(b, 20, 5) : d === 1 ? this.Spot(b, Math.random() < 0.7 ? 20 : 19, 3) : this.Spot(b, 20, 3);
      const s = BotSigma[d];
      this.Throw(side, aim.add(new V2(gauss() * s, gauss() * s)), 0.85);
    }
  }

  protected OnHit(side: number, p: V2, bot: boolean) {
    if (!this.Live) return;
    const b = this.boards[this.Solo ? 0 : side];
    if (b.thrown >= Darts) {
      this.Impact(p, this.sideCol[side], false);
      this.SideTag(side, "NO DARTS LEFT!", Color.white);
      return;
    }
    b.thrown++;
    const [pts, label, kind] = this.ScoreAt(b, p);
    b.total += pts;
    b.best = Math.max(b.best, pts);
    b.scores.push(pts);
    b.visit.push(pts);
    b.last = kind === 0 ? "MISS" : kind === 3 ? `T${label.split(" ")[1]}` : kind === 2 ? `D${label.split(" ")[1]}` : kind >= 4 ? (kind === 5 ? "BULL" : "25") : label;
    const col = this.sideCol[side];
    if (kind === 0) {
      this.Impact(p, col, false);
      Sfx.playClip(label === "MISS" ? this.thudClip : this.bounceClip, 0.8);
      this.Drop(DA.BallSprite(), p, new V2((Math.random() - 0.5) * 4, 2), 0.9, { life: 1.4 });
      this.UI.Float(p.add(new V2(0, 1)), label, new Color(1, 1, 1, 0.85), 1.1);
    } else {
      // the dart sticks where the ball landed
      const dart = b.darts[b.thrown - 1];
      dart.body.gameObject.setActive(true);
      dart.t = 0;
      dart.body.transform.localPosition = p.sub(b.c);
      dart.body.transform.localEulerZ = (Math.random() - 0.5) * 30;
      dart.flight.color = col;
      this.Impact(p, kind >= 3 ? Gold : col, kind >= 2);
      Sfx.playClip(this.thunkClip, 1);
      b.shake = kind >= 3 ? 1 : 0.5;
      if (kind === 5) {
        b.bulls++;
        Sfx.playClip(this.roarClip, bot ? 0.4 : 0.8);
        this.fxw.confetti(b.c, 50, 9, [col, Gold, Color.white, Pal.hex(0xd8262e)]);
        if (this.Solo) this.Big("BULLSEYE!", Gold, 1.1, 1.8); else this.SideTag(side, "BULLSEYE!", Gold);
        this.Fx.shake(0.35);
      } else if (kind === 3) {
        b.trebles++;
        Sfx.playClip(this.dingClip, 0.9); Sfx.playClip(this.cheerClip, bot ? 0.3 : 0.6);
        this.fxw.sparkle(p, Gold, 12, 1.2, 0.45);
        this.Fx.shake(0.2);
      } else if (kind === 2) {
        b.doubles++;
        Sfx.playClip(this.dingClip, 0.7, 0.85);
        this.fxw.sparkle(p, Color.white, 8, 1, 0.4);
      } else if (kind === 4) {
        b.bulls++;
        Sfx.playClip(this.dingClip, 0.7, 0.8); Sfx.playClip(this.cheerClip, bot ? 0.25 : 0.5);
      }
      const big = kind >= 3;
      this.UI.Float(p.add(new V2(0, 1.2)), kind === 1 ? `${pts}` : `${label}  ${pts}`, big ? Gold : Color.white, big ? 1.6 : 1.25);
    }
    this.PopPanel(side);
    if (b.visit.length === 3 || b.thrown === Darts) {
      const v = b.visit.reduce((a, x) => a + x, 0);
      b.visit = [];
      if (v === 180) { this.Big("ONE HUNDRED AND EIGHTY!", Gold, 2.0, 1.6); Sfx.playClip(this.roarClip, 1); this.fxw.confetti(b.c, 90, 11, [Gold, Color.white, col]); }
      else if (v >= 100) { this.SideTag(this.Solo ? 0 : side, `TON${v >= 140 ? "-FORTY" : ""}! ${v}`, Gold); Sfx.playClip(this.cheerClip, 0.7); }
      else if (v > 0) this.SideTag(this.Solo ? 0 : side, `VISIT: ${v}`, Color.white);
    }
    if (b.thrown === Darts && !bot) Sfx.play(Snd.Confirm, 0.7);
    if (!bot) this.Data.add("darts", 1);
  }

  // ------------------------------------------------------------------ HUD + results

  private Pips(b: Board) { return "●".repeat(Darts - b.thrown) + "○".repeat(b.thrown); }

  protected PanelText(side: number): [string, string] {
    if (this.Solo && side === 1) {
      const top = WallBoard.list(this.Info.Id, 1)[0];
      return [top ? String(top.score) : "---", top ? `TODAY'S TOP · ${top.label}` : "SET TODAY'S TOP SCORE!"];
    }
    const b = this.boards[side];
    return [String(b.total), b.thrown >= Darts ? "ALL DARTS THROWN" : `<size=34>${this.Pips(b)}</size>  ${b.last ? "· " + b.last : ""}`];
  }

  protected MakeResult() {
    const a = this.boards[0], b = this.boards[1];
    const stars = (x: Board) => WallGame.Stars(x.total, 120, 220, 320);
    const stats = (x: Board): [string, string][] => [["TOTAL", String(x.total)], ["BEST DART", String(x.best)], ["TREBLES", String(x.trebles)], ["BULLS", String(x.bulls)]];
    if (this.mode === Mode.Solo) {
      const top = WallBoard.list(this.Info.Id, 1)[0];
      const beat = !top || a.total > top.score;
      const nb = this.SaveBest(a.total);
      return {
        result: new Result({
          Headline: beat && a.total > 0 ? "TODAY'S TOP SCORE!" : nb ? "NEW BEST!" : a.total >= 220 ? "GREAT ARROWS!" : "TEN DARTS DONE!", HeadlineColor: beat || nb ? Gold : Color.white,
          Value: String(a.total), CountTo: a.total, NewBest: nb, Victory: beat, BestLine: top && !beat ? `TODAY'S TOP ${top.score} (${top.label})` : `SOLO BEST ${this.Data.get("best0")}`,
          Stats: stats(a), Primary: "THROW AGAIN",
        }),
        score: a.total, label: "SOLO", stars: stars(a),
      };
    }
    const w = a.total === b.total ? -1 : a.total > b.total ? 0 : 1;
    if (this.mode === Mode.Cpu) {
      if (w === 0) this.Data.add("wins", 1);
      this.SaveBest(a.total);
      return {
        result: new Result({
          Headline: w === 0 ? "YOU WIN!" : w < 0 ? "IT'S A DRAW!" : "THE COMPUTER WINS", HeadlineColor: w === 0 ? Gold : w < 0 ? Color.white : Pal.hex(0xffb0c0),
          Value: `${a.total} – ${b.total}`, Victory: w === 0, BestLine: `VS COMPUTER · ${DiffNames[this.diff]}`, Stats: stats(a), Primary: w === 0 ? "PLAY AGAIN" : "REMATCH",
        }),
        score: a.total, label: "VS CPU", stars: w === 0 ? Math.max(1, stars(a)) : 0,
      };
    }
    this.Data.add("duels", 1);
    const win = w === 1 ? b : a;
    this.SaveBest(win.total);
    return {
      result: new Result({
        Headline: w < 0 ? "IT'S A DRAW!" : `PLAYER ${w + 1} WINS!`, HeadlineColor: w < 0 ? Gold : this.sideCol[w], Victory: true,
        Value: `${a.total} – ${b.total}`, BestLine: "PLAYER 1 – PLAYER 2",
        Stats: [["P1 BEST DART", String(a.best)], ["P2 BEST DART", String(b.best)], ["P1 TREBLES", String(a.trebles)], ["P2 TREBLES", String(b.trebles)]],
        Primary: "REMATCH",
      }),
      score: win.total, label: w < 0 ? "DRAW" : w === 0 ? "P1" : "P2", stars: stars(win),
    };
  }
}
