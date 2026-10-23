import { Art, Color, GameObject, Mathf, SpriteRenderer, TextMesh, Time, V2, V3 } from "../../kit";
import { H, Kind, SHAPES, W, Well } from "./Stack";
import { Ink, JunkColor, LcdColor, WallBlocksArt } from "./WallBlocksArt";

/**
 * One player's pocket brick-game console drawn with world sprites: plastic shell in the player's colour, LCD with
 * the 8 × 14 well (lit bricks, the falling piece, a chunky ghost and hint arrows around the piece) and an info column
 * (tag, score, lines, next piece). Local units are cells; place() sets the cell size in world units.
 */

// LCD spans x -6.5..6.5, y -7.5..7.5; the well's bottom-left corner sits at (-6, -7); info column centred at x 4.2.
const WellX = -6, WellY = -7, InfoX = 4.2;

function makeText(parent: GameObject, text: string, height: number, color: Color, order: number, anchor: TextMesh["anchor"] = "MiddleCenter") {
  const tm = new GameObject("Text", parent).addComponent(new TextMesh());
  tm.text = text;
  tm.fontSize = 64;
  tm.characterSize = (height * 10) / 64;
  tm.anchor = anchor;
  tm.color = color;
  tm.sortingOrder = order;
  return tm;
}

export class ConsoleView {
  readonly root: GameObject;
  private body: GameObject;
  private shell: SpriteRenderer;
  private cells: SpriteRenderer[] = [];
  private piece: SpriteRenderer[] = [];
  private ghost: SpriteRenderer[] = [];
  private nextMini: SpriteRenderer[] = [];
  private flashes: SpriteRenderer[] = [];
  private hintL: SpriteRenderer; private hintR: SpriteRenderer; private hintTurn: SpriteRenderer; private hintSlam: SpriteRenderer;
  private glow: SpriteRenderer;
  private tag: TextMesh; private score: TextMesh; private lines: TextMesh; private junk: TextMesh; private logo: TextMesh; private deadText: TextMesh;
  private deadVeil: SpriteRenderer;
  center = V2.zero;
  cell = 1;
  private kickY = 0; private kickV = 0; private shakeT = 0;
  private shownScore = 0;
  hints = true;

  constructor(parent: GameObject, public color: Color, tag: string, logo: string) {
    this.root = new GameObject("Console", parent);
    this.body = new GameObject("Body", this.root);
    const b = this.body;
    this.glow = Art.spr(b, "Glow", Art.Glow, color.withAlpha(0.35), 26, -20, Art.Additive);
    this.shell = Art.spr(b, "Shell", WallBlocksArt.Shell, color, 15, -10, Art.Flat);
    this.shell.transform.localPosition = new V3(0, -0.6, 0);
    const bezel = Art.spr(b, "Bezel", WallBlocksArt.Bezel, Color.white, 14, -9, Art.Flat);
    bezel.transform.localPosition = new V3(0, 0, 0);
    Art.spr(b, "Lcd", WallBlocksArt.Lcd, LcdColor, 13, -8, Art.Flat);
    // the well frame and unlit pixels
    const frame = Art.spr(b, "WellFrame", Art.Square, Ink.withAlpha(0.55), 1, -7, Art.Flat);
    frame.transform.localPosition = new V3(WellX + W / 2, WellY + H / 2, 0);
    frame.transform.localScale = new V3(W + 0.24, H + 0.24, 1);
    const inside = Art.spr(b, "WellInside", Art.Square, LcdColor, 1, -6, Art.Flat);
    inside.transform.localPosition = frame.transform.localPosition;
    inside.transform.localScale = new V3(W + 0.06, H + 0.06, 1);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const s = Art.spr(b, "Off", WallBlocksArt.OffCell, Ink.withAlpha(0.045), 0.94, -5, Art.Flat);
        s.transform.localPosition = new V3(WellX + x + 0.5, WellY + y + 0.5, 0);
      }
    for (let i = 0; i < W * H; i++) {
      const s = Art.spr(b, "Cell", WallBlocksArt.Brick, Ink, 0.96, 2, Art.Flat);
      s.transform.localPosition = new V3(WellX + (i % W) + 0.5, WellY + Math.floor(i / W) + 0.5, 0);
      s.enabled = false;
      this.cells.push(s);
    }
    for (let y = 0; y < 4; y++) {
      const f = Art.spr(b, "Flash", Art.Square, Color.white, 1, 6, Art.Flat);
      f.transform.localScale = new V3(W, 0.96, 1);
      f.enabled = false;
      this.flashes.push(f);
    }
    for (let i = 0; i < 4; i++) {
      this.ghost.push(Art.spr(b, "Ghost", WallBlocksArt.Ghost, color, 0.98, 1, Art.Flat));
      this.piece.push(Art.spr(b, "Piece", WallBlocksArt.Lit, color, 1.0, 4, Art.Flat));
      this.nextMini.push(Art.spr(b, "Next", WallBlocksArt.Brick, Ink, 0.72, 3, Art.Flat));
    }
    const hc = new Color(1, 1, 1, 0.75);
    this.hintL = Art.spr(b, "HintL", WallBlocksArt.Push, hc, 0.9, 5, Art.Flat);
    this.hintR = Art.spr(b, "HintR", WallBlocksArt.Push, hc, 0.9, 5, Art.Flat);
    this.hintR.flipX = true;
    this.hintTurn = Art.spr(b, "HintTurn", WallBlocksArt.Turn, hc, 1.0, 5, Art.Flat);
    this.hintSlam = Art.spr(b, "HintSlam", WallBlocksArt.Slam, hc, 1.0, 5, Art.Flat);
    // info column
    this.tag = makeText(b, tag, 1.7, color, 8);
    this.tag.transform.localPosition = new V3(InfoX, 6.0, 0);
    const dim = Ink.withAlpha(0.7);
    makeText(b, "SCORE", 0.62, dim, 8).transform.localPosition = new V3(InfoX, 4.1, 0);
    this.score = makeText(b, "0", 1.15, Ink, 8);
    this.score.transform.localPosition = new V3(InfoX, 3.15, 0);
    makeText(b, "LINES", 0.62, dim, 8).transform.localPosition = new V3(InfoX, 1.75, 0);
    this.lines = makeText(b, "0", 1.15, Ink, 8);
    this.lines.transform.localPosition = new V3(InfoX, 0.8, 0);
    makeText(b, "NEXT", 0.62, dim, 8).transform.localPosition = new V3(InfoX, -0.7, 0);
    this.junk = makeText(b, "", 0.75, Color.white, 9);
    this.junk.transform.localPosition = new V3(InfoX, -5.4, 0);
    // the shell's bottom strip: logo, speaker slots and two buttons
    this.logo = makeText(b, logo, 0.9, Color.white.withAlpha(0.92), -2);
    this.logo.transform.localPosition = new V3(-2.2, -8.75, 0);
    for (let i = 0; i < 4; i++) {
      const s = Art.spr(b, "Slot", Art.RoundSquare, Color.black.withAlpha(0.25), 1, -3, Art.Flat);
      s.transform.localPosition = new V3(3.2 + i * 0.42, -8.75, 0);
      s.transform.localScale = new V3(0.18, 1.1, 1);
    }
    for (let i = 0; i < 2; i++) {
      const bt = Art.spr(b, "Btn", WallBlocksArt.Button, Gold(i), 0.95, -3, Art.Flat);
      bt.transform.localPosition = new V3(5.4 + i * 1.0, -8.55 - i * 0.35, 0);
    }
    this.deadVeil = Art.spr(b, "Dead", Art.Square, Ink.withAlpha(0.6), 1, 10, Art.Flat);
    this.deadVeil.transform.localPosition = new V3(WellX + W / 2, WellY + H / 2, 0);
    this.deadVeil.transform.localScale = new V3(W, H, 1);
    this.deadText = makeText(b, "", 1.3, Color.white, 11);
    this.deadText.transform.localPosition = new V3(WellX + W / 2, WellY + H / 2, 0);
    this.setDead("");
  }

  setTag(tag: string, logo?: string) { this.tag.text = tag; if (logo !== undefined) this.logo.text = logo; }

  setDead(text: string) {
    this.deadVeil.enabled = text.length > 0;
    this.deadText.text = text;
    this.deadText.enabled = text.length > 0;
  }

  /** Local bounds (cells) of the whole console including the shell. */
  static readonly Size = new V2(15, 18.2);
  static readonly CenterOffset = -0.6;

  place(center: V2, cell: number) {
    this.center = center;
    this.cell = cell;
    this.root.localPosition = new V3(center.x, center.y, 0);
    this.root.localScale = new V3(cell, cell, 1);
  }

  setVisible(on: boolean) { this.root.setActive(on); }

  /** World point → well cell coordinates (column, row floats; 0,0 = bottom-left of the well). */
  toCell(world: V2): [number, number] {
    const lx = (world.x - this.center.x) / this.cell, ly = (world.y - this.center.y) / this.cell;
    return [lx - WellX, ly - WellY];
  }

  toWorld(fx: number, fy: number) { return new V2(this.center.x + (WellX + fx) * this.cell, this.center.y + (WellY + fy) * this.cell); }

  /** Is a world point on this console (shell included)? */
  contains(world: V2) {
    const lx = (world.x - this.center.x) / this.cell, ly = (world.y - this.center.y) / this.cell - ConsoleView.CenterOffset;
    return Math.abs(lx) <= ConsoleView.Size.x / 2 && Math.abs(ly) <= ConsoleView.Size.y / 2;
  }

  kick(amount: number) { this.kickV -= amount; }
  shake(t: number) { this.shakeT = Math.max(this.shakeT, t); }

  render(w: Well, dt: number) {
    // body motion: a springy kick when pieces land, a rattle when junk arrives
    // fixed small steps keep the spring stable on slow frames
    for (let left = Math.min(dt, 0.25); left > 0; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      this.kickV += (-this.kickY * 180 - this.kickV * 14) * h;
      this.kickY += this.kickV * h;
    }
    this.shakeT = Math.max(0, this.shakeT - dt);
    const sx = this.shakeT > 0 ? Math.sin(Time.time * 70) * 0.18 * (this.shakeT / 0.4) : 0;
    this.body.localPosition = new V3(sx, this.kickY, 0);
    const clock = Time.time;
    const flashing = w.clearing.length > 0;
    const blink = flashing && Math.floor(clock * 14) % 2 === 0;
    for (let y = 0; y < H; y++) {
      const clearing = flashing && w.clearing.includes(y);
      for (let x = 0; x < W; x++) {
        const k = w.grid[y * W + x] as Kind;
        const s = this.cells[y * W + x];
        s.enabled = k !== Kind.None;
        if (!s.enabled) continue;
        s.sprite = k === Kind.Junk ? WallBlocksArt.JunkBrick : WallBlocksArt.Brick;
        s.color = clearing ? (blink ? Color.white : this.color) : k === Kind.Junk ? JunkColor : Ink;
      }
    }
    this.flashes.forEach((f, i) => {
      const row = flashing ? w.clearing[i] : undefined;
      f.enabled = row !== undefined && row < H;
      if (!f.enabled) return;
      const k = 1 - Mathf.clamp01(w.clearT / Well.ClearDelay);
      f.transform.localPosition = new V3(WellX + W / 2, WellY + row! + 0.5, 0);
      f.transform.localScale = new V3(W * (1 + k * 0.15), 0.96 * (1 - k * 0.7), 1);
      f.color = Color.white.withAlpha(0.65 * (1 - k));
    });
    // falling piece, ghost and hints
    const p = w.active;
    const showPiece = !!p && !w.over && w.clearing.length === 0;
    const gy = showPiece ? w.ghostY() : 0;
    const pulse = 0.5 + 0.5 * Math.sin(clock * 6);
    let c0 = 99, c1 = -99, r0 = 99, r1 = -99;
    for (let i = 0; i < 4; i++) {
      const ps = this.piece[i], gs = this.ghost[i];
      if (!showPiece) { ps.enabled = gs.enabled = false; continue; }
      const [dx, dy] = SHAPES[p!.kind][p!.rot][i];
      const x = p!.x + dx, y = p!.y + dy;
      c0 = Math.min(c0, x); c1 = Math.max(c1, x); r0 = Math.min(r0, y); r1 = Math.max(r1, y);
      ps.enabled = y < H + 0.5;
      ps.transform.localPosition = new V3(WellX + x + 0.5, WellY + y + 0.5, 0);
      ps.color = Color.lerp(this.color, Color.white, 0.08 * pulse);
      const gyy = gy + dy;
      gs.enabled = gy !== p!.y && gyy < H;
      gs.transform.localPosition = new V3(WellX + x + 0.5, WellY + gyy + 0.5, 0);
      gs.color = this.color.withAlpha(0.8);
    }
    const hintOn = showPiece && this.hints;
    const ha = 0.45 + 0.35 * pulse;
    const midY = (r0 + r1 + 1) / 2, midX = (c0 + c1 + 1) / 2;
    const place = (s: SpriteRenderer, on: boolean, x: number, y: number) => {
      s.enabled = on;
      if (!on) return;
      s.transform.localPosition = new V3(WellX + x, WellY + y, 0);
      s.color = new Color(1, 1, 1, ha);
    };
    place(this.hintL, hintOn && c0 > 0, c0 - 0.75 - pulse * 0.12, Math.min(midY, H - 0.5));
    place(this.hintR, hintOn && c1 < W - 1, c1 + 1.75 + pulse * 0.12, Math.min(midY, H - 0.5));
    place(this.hintTurn, hintOn && r1 + 1.9 < H + 0.6, midX, r1 + 1.9);
    place(this.hintSlam, hintOn && r0 - gy >= 3, midX, r0 - 1.4 - pulse * 0.2);
    // next piece
    const nk = w.next;
    const shape = nk !== Kind.None && nk !== Kind.Junk ? SHAPES[nk][0] : null;
    let mx0 = 9, mx1 = -9, my0 = 9, my1 = -9;
    if (shape) for (const [x, y] of shape) { mx0 = Math.min(mx0, x); mx1 = Math.max(mx1, x); my0 = Math.min(my0, y); my1 = Math.max(my1, y); }
    this.nextMini.forEach((s, i) => {
      s.enabled = !!shape && !w.over;
      if (!shape) return;
      const [x, y] = shape[i];
      s.transform.localPosition = new V3(4.2 + (x - (mx0 + mx1) / 2) * 0.76, -2.4 + (y - (my0 + my1) / 2) * 0.76, 0);
    });
    // numbers
    this.shownScore = this.shownScore < w.score ? Math.min(w.score, this.shownScore + Math.max(5, (w.score - this.shownScore) * dt * 8)) : w.score;
    const sc = String(Math.round(this.shownScore));
    if (this.score.text !== sc) this.score.text = sc;
    const ln = String(w.lines);
    if (this.lines.text !== ln) this.lines.text = ln;
    const junk = w.pendingJunk > 0 ? `JUNK +${w.pendingJunk}` : "";
    this.junk.text = junk;
    this.junk.color = Color.lerp(Pal2.Danger, Color.white, pulse * 0.4);
    this.glow.color = this.color.withAlpha(0.22 + 0.06 * pulse);
  }

  resetCounters() { this.shownScore = 0; this.kickY = this.kickV = 0; this.shakeT = 0; }
}

const Pal2 = { Danger: new Color(0.85, 0.12, 0.2, 1) };
function Gold(i: number) { return i === 0 ? new Color(1, 0.82, 0.25, 1) : new Color(1, 0.35, 0.4, 1); }
