import {
  AdService, ArcadeButton, ArcadeGame, Art, Color, Ease, FontStyle, GameInfo, GameObject, howTo, Mathf, Pal, Phase, Random,
  Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, Text, TextAnchor, Time, TouchScheme, UIKit, V2, V3,
} from "../../kit";
import { Board, Move, Nexus } from "./Nexus";

/**
 * NEURAL SIEGE: a strategy board game against NEXUS, a search-based AI.
 * Clone a node into an adjacent cell or jump it two cells; every enemy node touching where you land
 * converts to you. NEXUS searches your replies with alpha-beta pruning (deeper every tier), comments on the
 * game, and can be borrowed for three hints per match. Beat it to climb ten tiers. (Port of NeuralSiegeGame.cs.)
 */

const You = 1, Ai = 2;
const MaxTier = 10;
const Cell = 1;

const YouColor = Pal.hex(0x4de8ff);
const AiColor = Pal.hex(0xff4db8);
const JumpColor = Pal.hex(0xffc84a);

class Flip {
  Cell = 0;
  Delay = 0; T = 0;
  From = Color.white; To = Color.white;
}

/** Task<Move>: the C# WebGL build ran searches synchronously (Task.FromResult), so a task is just its result. */
interface MoveTask { Result: Move }

export class NeuralSiegeGame extends ArcadeGame {
  private world!: GameObject;
  private readonly tiles: SpriteRenderer[] = new Array(Board.Cells);
  private readonly pieces: SpriteRenderer[] = new Array(Board.Cells);
  private readonly halos: SpriteRenderer[] = new Array(Board.Cells);
  private readonly markers: SpriteRenderer[] = new Array(Board.Cells);
  private selectRing!: SpriteRenderer; private hintFrom!: SpriteRenderer; private hintTo!: SpriteRenderer; private mover!: SpriteRenderer;
  private readonly flips: Flip[] = [];

  private board!: Board;
  private turn = You;
  private tier = 0; private moveCount = 0; private yourCaptures = 0; private hintsLeft = 0; private selected = -1; private lastYouGain = 0;
  private readonly legal: Move[] = [];
  private readonly converted: number[] = [];
  private nexus!: Nexus; private helper!: Nexus; private attractAi!: Nexus;
  private aiTask: MoveTask | null = null; private hintTask: MoveTask | null = null;
  private aiSnapshot: Board | null = null;
  private aiStarted = 0; private animTimer = 0; private passTimer = 0; private attractTimer = 0;
  private hint = Move.None;
  private moverFrom = V2.zero; private moverTo = V2.zero;
  private moverT = -1;
  private moverCell = -1;
  private gameEnded = false; private adHintsUsed = false;

  private get CanOfferAdHints() { return this.hintsLeft <= 0 && !this.adHintsUsed && !this.gameEnded && AdService.rewardedAvailable; }

  // HUD
  private scoreText!: Text; private statusText!: Text; private chatText!: Text; private tierText!: Text;
  private hintButton!: ArcadeButton;
  private chatTarget = "";
  private chatChars = 0;

  protected Describe() {
    return new GameInfo({
      Id: "neuralsiege",
      Reminders: [
        "NEXUS is waiting|It has simulated your next move 40,000 times.",
        "Rematch requested|NEXUS: I have adapted. Have you?",
        "The board is set|Tier challenge pending. Accept?",
      ],
      Title: "NEURAL SIEGE",
      Tagline: "OUTTHINK A MACHINE THAT THINKS AHEAD",
      Accent: YouColor,
      Accent2: AiColor,
      BgTop: Pal.hex(0x120a28),
      BgBottom: Pal.hex(0x030210),
      ShortSide: 8.4,
      Touch: TouchScheme.None,
      Music: { bpm: 84, rootHz: 69.3, degrees: [0, 3, 5, 2], seed: 91, energy: 0.35, major: false },
      HowTo: [
        howTo(Art.Disc, YouColor, "You are CYAN. Tap one of your nodes, then tap where it should go."),
        howTo(Art.Disc, YouColor, "CLONE: move 1 cell. The original stays, so you gain a node."),
        howTo(Art.Ring, JumpColor, "JUMP: move 2 cells. The node leaves its old cell."),
        howTo(Art.Star, AiColor, "Every enemy node touching the cell you land on becomes yours."),
        howTo(Art.Plus, Pal.TextDim, "Dark cells are blocked. When the board fills, most nodes wins."),
        howTo(Art.Eye, AiColor, "NEXUS searches ahead: deeper and faster every tier. Win to climb 10 tiers."),
        howTo(Art.Diamond, Pal.Warn, "Stuck? HINT borrows NEXUS's own brain (3 per match)."),
      ],
      Tips: [
        "Cloning is usually better than jumping: jumps leave holes behind.",
        "Don't leave empty cells next to your groups that NEXUS can reach.",
        "Corners and edges are harder to convert.",
        "A jump that converts three or more nodes is often worth the hole.",
        "Higher tiers see several moves ahead. Set traps two moves deep.",
      ],
    });
  }

  protected get ShortSide() {
    const aspect = Screen.width / Math.max(1, Screen.height);
    const bands = (300 + 260) / 1080;
    const need = Board.Size * Cell + 0.8;
    if (aspect < 1) return Math.max(need, need / (1 / aspect - bands));
    return Math.max(need / (1 - bands), need / aspect);
  }

  protected BestLine() {
    const t = this.Data.get("tier", 1);
    return `TIER ${t}   ·   BEST TIER ${Math.max(t, this.Data.get("bestTier", 1))}`;
  }

  protected StatsLine() {
    return this.Data.get("games") > 0 ? `${this.Data.get("wins")} WINS  ·  ${this.Data.get("games") - this.Data.get("wins")} LOSSES` : "STRATEGY VS AI";
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("Board", this.gameObject);
    const frame = Art.spr(this.world, "Frame Glow", Art.Glow, YouColor.withAlpha(0.12), 12, 0, Art.Additive);
    frame.transform.position = V3.zero;
    for (let i = 0; i < Board.Cells; i++) {
      const p = NeuralSiegeGame.CellPos(i);
      this.tiles[i] = Art.spr(this.world, "Tile", Art.RoundSquare, Color.white, 0.92, 1);
      this.tiles[i].transform.position = p;
      this.markers[i] = Art.spr(this.world, "Marker", Art.Disc, Color.white, 0.3, 4, Art.Additive);
      this.markers[i].transform.position = p;
      this.halos[i] = Art.spr(this.world, "Halo", Art.Glow, Color.white, 1.5, 5, Art.Additive);
      this.halos[i].transform.position = p;
      this.pieces[i] = Art.spr(this.world, "Node", Art.Disc, Color.white, 0.7, 6);
      this.pieces[i].transform.position = p;
    }
    this.selectRing = Art.spr(this.world, "Select", Art.Ring, Color.white, 1.05, 7, Art.Additive);
    this.hintFrom = Art.spr(this.world, "Hint From", Art.Ring, Pal.Warn, 1.1, 8, Art.Additive);
    this.hintTo = Art.spr(this.world, "Hint To", Art.Ring, Pal.Warn, 1.1, 8, Art.Additive);
    this.mover = Art.spr(this.world, "Mover", Art.Disc, Color.white, 0.7, 9);
    this.nexus = new Nexus(Random.rangeInt(0, 999999));
    this.helper = new Nexus(Random.rangeInt(0, 999999));
    this.attractAi = new Nexus(Random.rangeInt(0, 999999));
    this.BuildHud();
    this.CenterCamera();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.scoreText = UIKit.at(UIKit.label(hud, "", 64, Pal.Text), new V2(0.5, 1), new V2(0, -70), new V2(700, 90));
    this.tierText = UIKit.at(UIKit.label(hud, "", 28, Pal.TextDim, TextAnchor.MiddleLeft), new V2(0, 1), new V2(170, -65), new V2(280, 40));
    this.statusText = UIKit.at(UIKit.label(hud, "", 34, Pal.Text), new V2(0.5, 1), new V2(0, -140), new V2(800, 50));
    this.chatText = UIKit.at(UIKit.label(hud, "", 30, AiColor, TextAnchor.MiddleCenter, FontStyle.Italic), new V2(0.5, 1), new V2(0, -200), new V2(960, 50));
    this.hintButton = UIKit.buttonAt(hud, "HINT", new V2(0.5, 0), new V2(0, 140), new V2(320, 120), false, () => this.RequestHint(), 38);
    this.hintButton.setAccent(Pal.Warn);
  }

  private static CellPos(i: number) { return new V2((Board.X(i) - 3) * Cell, (Board.Y(i) - 3) * Cell); }

  private CellAt(world: V2) {
    const x = Math.floor(world.x / Cell + 3.5), y = Math.floor(world.y / Cell + 3.5);
    if (x < 0 || y < 0 || x >= Board.Size || y >= Board.Size) return -1;
    return Board.Index(x, y);
  }

  private CenterCamera() {
    const r = this.PlayRect(300, 260, 0);
    this.Fx.CameraTarget = r.center.neg();
  }

  protected OnLayoutChanged() { this.CenterCamera(); }

  // ------------------------------------------------------------------ match lifecycle

  private NewBoard(forTier: number) {
    const blockers = forTier <= 2 ? 0 : forTier <= 5 ? 1 : 2;
    this.board = Board.Standard(blockers, new SysRandom(Random.rangeInt(0, 999999)));
    this.flips.length = 0;
    this.moverT = -1;
    this.mover.gameObject.setActive(false);
    this.Deselect();
    this.ClearHint();
    this.RefreshBoard();
  }

  protected OnEnterTitle() {
    this.CancelTasks();
    this.NewBoard(2);
    this.turn = You;
    this.attractTimer = 1;
  }

  protected BeginRun() {
    this.CancelTasks();
    this.tier = Mathf.clamp(this.Data.get("tier", 1), 1, MaxTier);
    this.nexus = new Nexus(Random.rangeInt(0, 999999)); // fresh instance: an abandoned search may still be running
    this.NewBoard(this.tier);
    this.turn = You;
    this.moveCount = this.yourCaptures = 0;
    this.hintsLeft = 3;
    this.adHintsUsed = false;
    this.gameEnded = false;
    this.animTimer = 0.3;
    this.Say(this.Opening());
    this.UI.Announce("TIER " + this.tier, AiColor, 1.2);
    if (this.Data.get("games") === 0) this.UI.Hint("Tap one of your cyan nodes to see where it can go.");
    Sfx.setIntensity(0.25);
    this.CenterCamera();
  }

  private CancelTasks() {
    this.aiTask = null; // results of abandoned searches are ignored
    this.hintTask = null;
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Animate(dt);
    if (this.State !== Phase.Title) return;
    this.attractTimer -= dt;
    if (this.attractTimer > 0 || this.animTimer > 0) return;
    this.attractTimer = 0.9;
    if (this.board.Over()) {
      this.NewBoard(2);
      return;
    }
    if (!this.board.HasMove(this.turn)) {
      this.turn = Board.Opponent(this.turn);
      return;
    }
    const m = this.attractAi.Think(this.board, this.turn, 2);
    this.PlayMove(m, this.turn, true);
    this.turn = Board.Opponent(this.turn);
  }

  protected TickRun(dt: number) {
    this.Animate(dt);
    this.UpdateChat(dt);
    this.UpdateHud();
    if (this.gameEnded) return;

    if (this.hintTask) {
      this.ShowHint(this.hintTask.Result);
      this.hintTask = null;
    }

    if (this.animTimer > 0) return;

    if (this.board.Over()) {
      this.EndMatch();
      return;
    }

    if (this.turn === You) {
      if (!this.board.HasMove(You)) {
        if (this.passTimer <= 0) {
          this.passTimer = 1.2;
          this.UI.Announce("NO MOVES: PASS", Pal.TextDim, 1);
        }
        this.passTimer -= dt;
        if (this.passTimer <= 0) this.turn = Ai;
        return;
      }
      this.HandleInput();
    } else this.TickAi();
  }

  private HandleInput() {
    if (!this.Controls.tapped) return;
    const cell = this.CellAt(this.ScreenToWorld(this.Controls.tapScreen));
    if (cell < 0) { this.Deselect(); return; }

    if (this.board.C[cell] === You) {
      this.Select(cell);
      return;
    }
    if (this.selected >= 0) {
      for (const m of this.legal) {
        if (m.To !== cell) continue;
        this.lastYouGain = this.board.Gain(m, You);
        const before = this.board.Count(Ai);
        this.PlayMove(m, You, false);
        this.yourCaptures += before - this.board.Count(Ai);
        this.moveCount++;
        this.Deselect();
        this.ClearHint();
        this.UI.Hint(null);
        this.turn = Ai;
        this.aiStarted = -1;
        return;
      }
      Sfx.play(Snd.Deny, 0.6);
    }
    this.Deselect();
  }

  private Select(cell: number) {
    this.selected = cell;
    this.legal.length = 0;
    const all: Move[] = [];
    this.board.Moves(You, all);
    // Show clones from this node too (the generator deduplicates clones by destination).
    const sx = Board.X(cell), sy = Board.Y(cell);
    for (let to = 0; to < Board.Cells; to++) {
      if (this.board.C[to] !== Board.Empty) continue;
      const dx = Math.abs(Board.X(to) - sx), dy = Math.abs(Board.Y(to) - sy);
      const d = Math.max(dx, dy);
      if (d === 1) this.legal.push(new Move(cell, to, false));
      else if (d === 2) this.legal.push(new Move(cell, to, true));
    }
    Sfx.play(Snd.Click, 0.7);
    this.RefreshMarkers();
  }

  private Deselect() {
    this.selected = -1;
    this.legal.length = 0;
    this.RefreshMarkers();
  }

  private TickAi() {
    if (this.aiTask === null && this.aiStarted < 0) {
      if (!this.board.HasMove(Ai)) {
        this.UI.Announce("NEXUS PASSES", AiColor, 1);
        this.Say("No moves. Proceed.");
        this.turn = You;
        return;
      }
      this.aiStarted = Time.time;
      this.aiSnapshot = this.board.Clone();
      const snapshot = this.aiSnapshot;
      const t = this.tier;
      this.aiTask = { Result: this.nexus.Think(snapshot, Ai, t) };
    }
    if (this.aiTask === null || Time.time - this.aiStarted < 0.7) return;

    const task = this.aiTask;
    this.aiTask = null;
    this.aiStarted = -1;
    if (task.Result.IsNone) {
      this.turn = You;
      return;
    }
    const move = task.Result;
    const before = this.board.Count(You);
    this.PlayMove(move, Ai, false);
    const took = before - this.board.Count(You);
    this.Say(this.React(took));
    this.turn = You;
    this.moveCount++;
  }

  // ------------------------------------------------------------------ moves and animation

  private PlayMove(m: Move, who: number, quiet: boolean) {
    const c = who === You ? YouColor : AiColor;
    this.converted.length = 0;
    this.board.Apply(m, who, this.converted);

    this.moverFrom = NeuralSiegeGame.CellPos(m.From);
    this.moverTo = NeuralSiegeGame.CellPos(m.To);
    this.moverT = 0;
    this.moverCell = m.To;
    this.mover.gameObject.setActive(true);
    this.mover.color = c;
    this.RefreshBoard();
    this.pieces[m.To].gameObject.setActive(false);
    this.halos[m.To].gameObject.setActive(false);

    for (let k = 0; k < this.converted.length; k++) {
      const cell = this.converted[k];
      const f = new Flip();
      f.Cell = cell; f.Delay = 0.22 + k * 0.06; f.T = 0; f.From = who === You ? AiColor : YouColor; f.To = c;
      this.flips.push(f);
      this.pieces[cell].color = who === You ? AiColor : YouColor;
    }
    this.animTimer = 0.3 + this.converted.length * 0.06 + 0.2;

    const vol = quiet ? 0.3 : 1;
    Sfx.play(m.Jump ? Snd.Whoosh : Snd.Pickup, 0.6 * vol, m.Jump ? 1.2 : 1);
    if (this.converted.length > 0) {
      Sfx.play(Snd.Zap, 0.5 * vol, 1 + this.converted.length * 0.05);
      if (!quiet && this.converted.length >= 3) {
        this.UI.Float(NeuralSiegeGame.CellPos(m.To), "+" + this.converted.length, c, 1 + this.converted.length * 0.05);
        this.Fx.shake(0.12 + this.converted.length * 0.03);
      }
    }
  }

  private Animate(dt: number) {
    this.animTimer = Math.max(0, this.animTimer - dt);
    if (this.moverT >= 0) {
      this.moverT += dt / 0.25;
      const k = Mathf.clamp01(this.moverT);
      const p = V2.lerp(this.moverFrom, this.moverTo, Ease.outCubic(k));
      const lift = Math.sin(k * Math.PI) * 0.3;
      this.mover.transform.position = p;
      const s = 0.7 * (1 + lift);
      this.mover.transform.localScale = new V3(s, s, 1);
      if (k >= 1) {
        this.moverT = -1;
        this.mover.gameObject.setActive(false);
        if (this.moverCell >= 0) {
          this.pieces[this.moverCell].gameObject.setActive(true);
          this.halos[this.moverCell].gameObject.setActive(true);
          this.Fx.burst(this.moverTo, this.mover.color, 8, 2.5, 0.15, 0.35);
        }
      }
    }
    for (let i = this.flips.length - 1; i >= 0; i--) {
      const f = this.flips[i];
      f.Delay -= dt;
      if (f.Delay > 0) continue;
      f.T += dt / 0.28;
      const k = Mathf.clamp01(f.T);
      const sx = Math.abs(Math.cos(k * Math.PI));
      this.pieces[f.Cell].transform.localScale = new V3(0.7 * Math.max(0.05, sx), 0.7, 1);
      const col = k < 0.5 ? f.From : f.To;
      this.pieces[f.Cell].color = col;
      this.halos[f.Cell].color = col.withAlpha(0.35);
      if (k >= 1) {
        this.pieces[f.Cell].transform.localScale = new V3(0.7, 0.7, 1);
        this.Fx.burst(NeuralSiegeGame.CellPos(f.Cell), f.To, 5, 2, 0.12, 0.3);
        this.flips.splice(i, 1);
      }
    }

    const t = Time.time;
    if (this.selected >= 0) {
      const s = 1.05 + 0.06 * Math.sin(t * 6);
      this.selectRing.transform.localScale = new V3(s, s, 1);
    }
    if (!this.hint.IsNone) {
      const a = 0.5 + 0.5 * Math.sin(t * 6);
      this.hintFrom.color = Pal.Warn.withAlpha(a);
      this.hintTo.color = Pal.Warn.withAlpha(1 - a * 0.5);
    }
  }

  private RefreshBoard() {
    for (let i = 0; i < Board.Cells; i++) {
      const v = this.board.C[i];
      this.tiles[i].color = v === Board.Blocked ? Pal.hex(0x05040c) : ((Board.X(i) + Board.Y(i)) & 1) === 0 ? Pal.hex(0x1b1640) : Pal.hex(0x161234);
      const occupied = v === You || v === Ai;
      this.pieces[i].gameObject.setActive(occupied);
      this.halos[i].gameObject.setActive(occupied);
      if (!occupied) continue;
      const c = v === You ? YouColor : AiColor;
      this.pieces[i].color = c;
      this.pieces[i].transform.localScale = new V3(0.7, 0.7, 1);
      this.halos[i].color = c.withAlpha(0.35);
    }
    this.RefreshMarkers();
  }

  private RefreshMarkers() {
    for (let i = 0; i < Board.Cells; i++) this.markers[i].gameObject.setActive(false);
    this.selectRing.gameObject.setActive(this.selected >= 0);
    if (this.selected < 0) return;
    this.selectRing.transform.position = NeuralSiegeGame.CellPos(this.selected);
    this.selectRing.color = YouColor;
    for (const m of this.legal) {
      const mk = this.markers[m.To];
      mk.gameObject.setActive(true);
      const gain = this.board.Gain(m, You);
      mk.sprite = m.Jump ? Art.Ring : Art.Disc;
      const s = m.Jump ? 0.5 : 0.3 + Math.min(gain, 8) * 0.02;
      mk.transform.localScale = new V3(s, s, 1);
      mk.color = (m.Jump ? JumpColor : YouColor).withAlpha(0.8);
    }
  }

  // ------------------------------------------------------------------ hints

  private RequestHint() {
    if (this.CanOfferAdHints && this.turn === You && this.State === Phase.Playing) {
      AdService.showRewarded((earned) => {
        if (!earned) return;
        this.adHintsUsed = true;
        this.hintsLeft += 3;
        Sfx.play(Snd.PowerUp);
        this.Say("More help? I am... generous.");
      });
      return;
    }
    if (this.gameEnded || this.turn !== You || this.hintsLeft <= 0 || this.hintTask !== null || this.animTimer > 0 || this.State !== Phase.Playing) return;
    this.hintsLeft--;
    this.helper = new Nexus(Random.rangeInt(0, 999999));
    const snapshot = this.board.Clone();
    this.hintTask = { Result: this.helper.Think(snapshot, You, 6) };
    Sfx.play(Snd.Charge, 0.4, 1.6);
    this.Say("You want my help? ...Fine.");
  }

  private ShowHint(m: Move) {
    if (m.IsNone || this.turn !== You) return;
    this.hint = m;
    this.hintFrom.gameObject.setActive(true);
    this.hintTo.gameObject.setActive(true);
    this.hintFrom.transform.position = NeuralSiegeGame.CellPos(m.From);
    this.hintTo.transform.position = NeuralSiegeGame.CellPos(m.To);
    this.Select(m.From);
    Sfx.play(Snd.Confirm, 0.6);
  }

  private ClearHint() {
    this.hint = Move.None;
    this.hintFrom.gameObject.setActive(false);
    this.hintTo.gameObject.setActive(false);
  }

  // ------------------------------------------------------------------ NEXUS personality

  private Opening() {
    const lines = [
      "NEXUS online. Tier " + this.tier + ". Let's see what you've learned.",
      "Tier " + this.tier + ". I have already simulated this game.",
      "Initiating siege protocol. Tier " + this.tier + ".",
    ];
    return lines[Random.rangeInt(0, lines.length)];
  }

  private React(took: number) {
    const diff = this.board.Count(Ai) - this.board.Count(You);
    const Pick = NeuralSiegeGame.Pick;
    if (took >= 4) return Pick("Efficient.", "Your formation had a hole in it.", "Predictable.");
    if (this.lastYouGain >= 7) return Pick("Interesting. Recalculating.", "That was... unexpected.", "Adapting to your pattern.");
    if (diff >= 8) return Pick("Resistance is statistically irrelevant.", "Probability of your victory: declining.");
    if (diff <= -8) return Pick("Anomaly detected.", "This is... suboptimal.", "Increasing search depth.");
    return Random.value < 0.35 ? Pick("Your move.", "Proceed.", "Calculating...", "Hm.") : "";
  }

  private static Pick(...options: string[]) { return options[Random.rangeInt(0, options.length)]; }

  private Say(line: string) {
    if (!line) return;
    this.chatTarget = "NEXUS: " + line;
    this.chatChars = 0;
  }

  private UpdateChat(dt: number) {
    if (this.chatChars >= this.chatTarget.length) return;
    const before = Math.trunc(this.chatChars);
    this.chatChars += dt * 45;
    const now = Math.min(Math.trunc(this.chatChars), this.chatTarget.length);
    this.chatText.text = this.chatTarget.substring(0, now);
    if (now > before && now % 3 === 0) Sfx.play(Snd.Tick, 0.2, 1.6);
  }

  // ------------------------------------------------------------------ HUD / end

  private UpdateHud() {
    const you = this.board.Count(You), ai = this.board.Count(Ai);
    this.scoreText.text = `<color=#4DE8FF>YOU ${you}</color>   <size=40>vs</size>   <color=#FF4DB8>${ai} NEXUS</color>`;
    this.tierText.text = "TIER " + this.tier;
    if (this.gameEnded) this.statusText.text = "";
    else if (this.turn === You) { this.statusText.text = "YOUR TURN"; this.statusText.color = YouColor; }
    else {
      const dots = 1 + (Math.trunc(Time.time * 3) % 3);
      this.statusText.text = "NEXUS IS THINKING" + ".".repeat(dots);
      this.statusText.color = AiColor;
    }
    const offer = this.CanOfferAdHints;
    this.hintButton.label!.text = offer ? "+3 HINTS (AD)" : "HINT  " + this.hintsLeft;
    this.hintButton.interactable = (this.hintsLeft > 0 || offer) && this.turn === You && !this.gameEnded;
    Sfx.setIntensity(0.2 + Mathf.clamp01(1 - this.board.EmptyCount() / 40) * 0.6);
  }

  private EndMatch() {
    this.gameEnded = true;
    const you = this.board.Count(You), ai = this.board.Count(Ai);
    const win = you > ai, draw = you === ai;
    this.Data.add("games", 1);
    const shownTier = this.tier;
    if (win) {
      this.Data.add("wins", 1);
      this.Data.set("tier", Math.min(MaxTier, this.tier + 1));
    }
    const newBest = win && this.Data.max("bestTier", Math.min(MaxTier, this.tier + 1));
    this.Say(win ? "...Impressive. I will remember this." : draw ? "Equilibrium. Acceptable." : "As calculated.");
    Sfx.play(win ? Snd.Win : Snd.Lose);
    if (win) this.Fx.burst(V2.zero, YouColor, 60, 8, 0.3, 1);
    this.Finish(new Result({
      Headline: win ? "VICTORY" : draw ? "DRAW" : "DEFEAT",
      HeadlineColor: win ? Pal.Good : draw ? Pal.Warn : Pal.Danger,
      Value: you + " - " + ai,
      NewBest: newBest,
      BestLine: win ? (this.tier >= MaxTier ? "MAXIMUM TIER. NEXUS BOWS." : "NEXUS UPGRADED TO TIER " + (this.tier + 1)) : "TIER " + this.tier,
      Stats: [
        ["TIER", String(shownTier)],
        ["MOVES", String(this.moveCount)],
        ["NODES CONVERTED", String(this.yourCaptures)],
        ["HINTS USED", String(3 - this.hintsLeft)],
      ],
      Primary: win ? "NEXT TIER" : "REMATCH",
      Victory: win,
    }));
  }
}
