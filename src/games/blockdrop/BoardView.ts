import { Art, Color, GameObject, Mathf, SpriteRenderer, V2, V3 } from "../../kit";
import { BlockDropArt, KindColors } from "./BlockDropArt";
import { Engine, H, Kind, SHAPES, VISIBLE, W } from "./Engine";

/** Rows drawn: the visible well plus two spawn rows above it. */
const ROWS = VISIBLE + 2;
const WellColor = new Color(0.1, 0.06, 0.24, 0.9);
const CellColor = new Color(0.22, 0.16, 0.45, 0.55);

/** A small piece picture (hold box, next queue). */
class Mini {
  readonly sprites: SpriteRenderer[] = [];
  constructor(parent: GameObject, order: number) {
    for (let i = 0; i < 4; i++) this.sprites.push(Art.spr(parent, "Mini", BlockDropArt.Block, Color.white, 1, order));
  }
  show(kind: Kind, center: V2, size: number, alpha: number) {
    if (kind === Kind.None || kind === Kind.Garbage) { for (const s of this.sprites) s.enabled = false, s.color = Color.clear; return; }
    const shape = SHAPES[kind][0];
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    for (const [x, y] of shape) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    shape.forEach(([x, y], i) => {
      const s = this.sprites[i];
      s.enabled = true;
      s.color = KindColors[kind].withAlpha(alpha);
      s.transform.localPosition = new V3(center.x + (x - cx) * size, center.y + (y - cy) * size, 0);
      s.transform.localScale = new V3(size * 0.98, size * 0.98, 1);
    });
  }
}

export enum ViewStyle { Full, Compact }

/**
 * Draws one player's well with world sprites: cells, the falling piece, ghost, hold box, next queue, an incoming
 * garbage meter and effects (line flashes, collapsing rows, hard drop streaks, bumps).
 */
export class BoardView {
  readonly root: GameObject;
  private readonly body: GameObject;
  readonly edge: SpriteRenderer;
  private readonly bg: SpriteRenderer[] = [];
  private readonly cells: SpriteRenderer[] = [];
  private readonly piece: SpriteRenderer[] = [];
  private readonly ghost: SpriteRenderer[] = [];
  private readonly streaks: SpriteRenderer[] = [];
  private readonly streakT: number[] = [0, 0, 0, 0];
  private readonly holdBox: SpriteRenderer;
  private readonly hold: Mini;
  private readonly nextBoxes: SpriteRenderer[] = [];
  private readonly next: Mini[] = [];
  private readonly bar: SpriteRenderer;
  private readonly barBack: SpriteRenderer;
  private readonly rowOffset = new Array<number>(H).fill(0);
  private prevClearing: number[] = [];
  private lockFlash = 0;
  private lockCells: [number, number][] = [];
  private kick = 0; private kickV = 0; private shakeX = 0;
  private clock = 0;
  style = ViewStyle.Full;
  nextCount = 5;
  accent: Color;
  /** 0..1 grey-out from the top when the player has topped out. */
  dead = 0;
  danger = 0;
  center = V2.zero;
  scale = 1;

  constructor(parent: GameObject, accent: Color) {
    this.accent = accent;
    this.root = new GameObject("Board", parent);
    this.body = new GameObject("Body", this.root);
    Art.spr(this.body, "Well", BlockDropArt.Well, WellColor, 10.8, 0);
    this.edge = Art.spr(this.body, "Edge", BlockDropArt.WellEdge, accent.withAlpha(0.85), 10.8, 1);
    for (let y = 0; y < VISIBLE; y++)
      for (let x = 0; x < W; x++) {
        const s = Art.spr(this.body, "Bg", BlockDropArt.Cell, CellColor, 0.92, 1);
        s.transform.localPosition = new V3(x - 4.5, y - 9.5, 0);
        this.bg.push(s);
      }
    for (let i = 0; i < W * ROWS; i++) {
      const s = Art.spr(this.body, "Cell", BlockDropArt.Block, Color.white, 1, 3);
      s.enabled = false;
      this.cells.push(s);
    }
    for (let i = 0; i < 4; i++) {
      this.ghost.push(Art.spr(this.body, "Ghost", BlockDropArt.Ghost, Color.white, 1, 2));
      this.piece.push(Art.spr(this.body, "Piece", BlockDropArt.Block, Color.white, 1, 4));
      const st = Art.spr(this.body, "Streak", BlockDropArt.Streak, Color.clear, 1, 5, Art.Additive);
      this.streaks.push(st);
    }
    this.holdBox = Art.spr(this.root, "HoldBox", BlockDropArt.Box, new Color(0.16, 0.1, 0.36, 0.85), 1, 0);
    this.hold = new Mini(this.root, 3);
    for (let i = 0; i < 5; i++) {
      this.nextBoxes.push(Art.spr(this.root, "NextBox", BlockDropArt.Box, new Color(0.16, 0.1, 0.36, 0.85), 1, 0));
      this.next.push(new Mini(this.root, 3));
    }
    this.barBack = Art.spr(this.body, "BarBack", BlockDropArt.Bar, new Color(0, 0, 0, 0.35), 1, 1);
    this.bar = Art.spr(this.body, "Bar", BlockDropArt.Bar, new Color(1, 0.3, 0.35, 1), 1, 2);
    this.layoutPanels();
  }

  /** Local-space bounds of the view (for fitting), including labels under the well when wanted. */
  static bounds(style: ViewStyle, labels: boolean) {
    const bottom = labels ? -12.7 : -10.7;
    return style === ViewStyle.Full ? { xMin: -8.2, xMax: 8.2, yMin: bottom, yMax: 10.7 } : { xMin: -5.8, xMax: 5.8, yMin: bottom, yMax: 13.3 };
  }

  place(center: V2, scale: number, style: ViewStyle, nextCount: number) {
    this.center = center;
    this.scale = scale;
    this.style = style;
    this.nextCount = nextCount;
    this.root.localPosition = new V3(center.x, center.y, 0);
    this.root.localScale = new V3(scale, scale, 1);
    this.layoutPanels();
  }

  setVisible(on: boolean) { this.root.setActive(on); }

  /** World position of a local point. */
  world(local: V2) { return this.center.add(local.mul(this.scale)); }

  /** Local rect of the hold box (for taps). */
  holdRect() {
    const p = this.holdBox.transform.localPosition, s = this.holdBox.transform.localScale.x;
    return { c: new V2(p.x, p.y), half: s * 0.5 + 0.3 };
  }

  holdLabelPos() { const r = this.holdRect(); return new V2(r.c.x, r.c.y + r.half + 0.2); }
  nextLabelPos() { const p = this.nextBoxes[0].transform.localPosition, s = this.nextBoxes[0].transform.localScale.x; return new V2(p.x, p.y + s * 0.5 + 0.5); }

  private layoutPanels() {
    if (this.style === ViewStyle.Full) {
      this.holdBox.transform.localPosition = new V3(-6.95, 8.4, 0);
      this.holdBox.transform.localScale = new V3(2.3, 2.3, 1);
      const ys = [8.4, 5.7, 3.5, 1.3, -0.9];
      for (let i = 0; i < 5; i++) {
        const sz = i === 0 ? 2.3 : 1.95;
        this.nextBoxes[i].transform.localPosition = new V3(6.95, ys[i] + (i === 0 ? 0 : 0.15), 0);
        this.nextBoxes[i].transform.localScale = new V3(sz, sz, 1);
        this.nextBoxes[i].gameObject.setActive(i < this.nextCount);
      }
    } else {
      this.holdBox.transform.localPosition = new V3(-4.1, 12.0, 0);
      this.holdBox.transform.localScale = new V3(2.0, 2.0, 1);
      for (let i = 0; i < 5; i++) {
        this.nextBoxes[i].transform.localPosition = new V3(0.2 + i * 2.15, 12.0, 0);
        this.nextBoxes[i].transform.localScale = new V3(i === 0 ? 2.0 : 1.8, i === 0 ? 2.0 : 1.8, 1);
        this.nextBoxes[i].gameObject.setActive(i < Math.min(this.nextCount, 3));
      }
    }
    this.barBack.transform.localPosition = new V3(-5.62, 0, 0);
    this.barBack.transform.localScale = new V3(0.3, 20 / 4, 1);
  }

  /** Bump the board (hard drop / garbage). */
  bump(amount: number) { this.kickV -= amount * 14; }
  shake(amount: number) { this.shakeX = amount; }

  /** Called with each lock report for effects. */
  onLock(cells: [number, number][], hardRows: number, kind: Kind) {
    this.lockFlash = 1;
    this.lockCells = cells;
    if (hardRows > 0) {
      cells.forEach(([x, y], i) => {
        const s = this.streaks[i];
        const len = Math.min(hardRows + 1, 14);
        s.transform.localPosition = new V3(x - 4.5, y - 9.5 + len * 0.5, 0);
        s.transform.localScale = new V3(0.9, len / 8, 1);
        s.color = KindColors[kind].withAlpha(0.55);
        this.streakT[i] = 1;
      });
      this.bump(Math.min(0.12, 0.03 + hardRows * 0.006));
    }
  }

  render(e: Engine, dt: number) {
    this.clock += dt;
    // spring for bumps
    for (let t = dt; t > 0; t -= 1 / 120) {
      const h = Math.min(t, 1 / 120);
      this.kickV += (-this.kick * 260 - this.kickV * 18) * h;
      this.kick += this.kickV * h;
    }
    if (!Number.isFinite(this.kick)) { this.kick = 0; this.kickV = 0; }
    this.shakeX = Mathf.moveTowards(this.shakeX, 0, dt * 1.5);
    const sx = this.shakeX > 0 ? Math.sin(this.clock * 70) * this.shakeX : 0;
    this.body.localPosition = new V3(sx, this.kick, 0);

    // rows collapsing after a clear
    if (this.prevClearing.length > 0 && e.clearing.length === 0) {
      const cleared = this.prevClearing;
      let removed = 0;
      for (let y = 0; y < H; y++) {
        if (cleared.includes(y)) { removed++; continue; }
        const ny = y - removed;
        this.rowOffset[ny] = removed;
      }
    }
    this.prevClearing = e.clearing.slice();
    for (let y = 0; y < H; y++) if (this.rowOffset[y] > 0) this.rowOffset[y] = Math.max(0, this.rowOffset[y] - dt * (14 + this.rowOffset[y] * 10));

    const clearK = e.clearing.length > 0 ? 1 - Mathf.clamp01(e.clearTimer / Engine.ClearDelay) : 0;
    this.lockFlash = Math.max(0, this.lockFlash - dt * 5);
    const grey = new Color(0.45, 0.42, 0.55, 1);
    for (let y = 0; y < ROWS; y++) {
      const clearing = e.clearing.includes(y);
      const deadRow = this.dead > 0 && y >= VISIBLE * (1 - this.dead) - 1;
      for (let x = 0; x < W; x++) {
        const k = e.grid[y * W + x];
        const s = this.cells[y * W + x];
        if (k === 0) { if (s.enabled) s.enabled = false; continue; }
        s.enabled = true;
        let c = KindColors[k];
        let sc = 1;
        if (clearing) {
          c = Color.lerp(c, Color.white, Math.min(1, clearK * 2.2));
          sc = 1 - Ease(clearK) * 0.85;
        } else if (deadRow) c = Color.lerp(c, grey, 0.85);
        if (y >= VISIBLE) c = c.withAlpha(0.55);
        s.color = c;
        s.transform.localPosition = new V3(x - 4.5, y - 9.5 + this.rowOffset[y], 0);
        s.transform.localScale = new V3(sc, sc, 1);
      }
    }
    // lock flash on the cells just placed
    if (this.lockFlash > 0 && e.clearing.length === 0) {
      for (const [x, y] of this.lockCells) {
        if (y < 0 || y >= ROWS) continue;
        const s = this.cells[y * W + x];
        if (!s.enabled) continue;
        s.color = Color.lerp(s.color, Color.white, this.lockFlash * 0.6);
      }
    }
    for (let i = 0; i < 4; i++) {
      this.streakT[i] = Math.max(0, this.streakT[i] - dt * 4);
      const st = this.streaks[i];
      st.color = st.color.withAlpha(0.55 * this.streakT[i]);
    }

    // active piece + ghost
    const p = e.active;
    if (p && !e.over && e.clearing.length === 0) {
      const gy = e.ghostY();
      const cells = Engine.cells(p);
      const lockK = e.canMove(0, -1) ? 0 : Mathf.clamp01(e.lockTimer / Engine.LockDelay);
      const base = KindColors[p.kind];
      cells.forEach(([x, y], i) => {
        const s = this.piece[i];
        s.enabled = y < ROWS;
        s.color = Color.lerp(base, Color.white, 0.12 + 0.25 * Math.sin(this.clock * 2) * 0.3 + lockK * 0.25).withAlpha(y >= VISIBLE ? 0.75 : 1);
        s.transform.localPosition = new V3(x - 4.5, y - 9.5, 0);
        const g = this.ghost[i];
        const gyy = y - (p.y - gy);
        g.enabled = gy !== p.y && gyy < ROWS;
        g.color = base.withAlpha(0.6);
        g.transform.localPosition = new V3(x - 4.5, gyy - 9.5, 0);
      });
    } else for (let i = 0; i < 4; i++) { this.piece[i].enabled = false; this.ghost[i].enabled = false; }

    // hold & next
    const hp = this.holdBox.transform.localPosition, hs = this.holdBox.transform.localScale.x;
    this.hold.show(e.hold, new V2(hp.x, hp.y), hs * (e.hold === Kind.I ? 0.2 : 0.26), e.holdUsed ? 0.35 : 1);
    const shown = this.style === ViewStyle.Full ? this.nextCount : Math.min(this.nextCount, 3);
    for (let i = 0; i < 5; i++) {
      const b = this.nextBoxes[i];
      if (i >= shown) { this.next[i].show(Kind.None, V2.zero, 0, 0); continue; }
      const k = e.queue[i];
      const bp = b.transform.localPosition, bs = b.transform.localScale.x;
      this.next[i].show(k, new V2(bp.x, bp.y), bs * (k === Kind.I ? 0.2 : 0.26), 1);
    }

    // garbage meter
    const inc = Math.min(20, e.incoming);
    this.bar.enabled = inc > 0;
    this.barBack.enabled = this.bar.enabled || this.style === ViewStyle.Compact;
    if (inc > 0) {
      const pulse = 0.75 + 0.25 * Math.sin(this.clock * 12);
      this.bar.color = new Color(1, 0.28 + 0.2 * pulse, 0.35, 1);
      this.bar.transform.localScale = new V3(0.3, inc / 4, 1);
      this.bar.transform.localPosition = new V3(-5.62, -10 + inc * 0.5, 0);
    }
    // frame tint: danger pulses red
    const dk = this.danger * (0.5 + 0.5 * Math.sin(this.clock * 8));
    this.edge.color = Color.lerp(this.accent, new Color(1, 0.25, 0.35, 1), dk).withAlpha(0.9);
  }
}

function Ease(t: number) { return t * t * (3 - 2 * t); }
