import { CasualArt, Color, Ease, Mathf, Pal, Sfx, Snd, Text, UIKit, UINode, V2, V3, Image, Fx } from "../../kit";
import { LEN, score } from "./Logic";

/** Tile / key colours. */
export const Green = Pal.hex(0x3fcf7a);
export const Yellow = Pal.hex(0xf2c230);
export const GreyTile = Pal.hex(0x4b4f72);
export const KeyBase = Pal.hex(0x8a8fc4);
export const EmptyEdge = new Color(1, 1, 1, 0.22);
export const Ink = Pal.hex(0x14102e);
export const MarkColors = [GreyTile, Yellow, Green];

export const TileSprite = () => CasualArt.make("wg-tile", 96, 96, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.95, 0.95), 0.2);
  const a = CasualArt.fill(d, 2 / 96);
  let v = Mathf.lerp(0.86, 1, CasualArt.smooth(-1, 1, p.y));
  v = Mathf.lerp(v, 0.74, CasualArt.smooth(-0.6, -0.95, p.y) * CasualArt.smooth(-0.12, -0.02, d) * 0.9);
  return new Color(v, v, v, a);
}, 30, 100);

export const TileEdge = () => CasualArt.make("wg-tile-edge", 96, 96, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.95, 0.95), 0.2);
  return new Color(1, 1, 1, CasualArt.fill(Math.abs(d + 0.04) - 0.035, 2 / 96));
}, 30, 100);

interface Tile { node: UINode; bg: Image; edge: Image; text: Text; mark: number }
interface Key { node: UINode; bg: Image; label: Text; mark: number; ch: string }
interface Anim { kind: "flip" | "pop" | "bounce" | "shake"; row: number; col: number; t: number; delay: number; dur: number; mark?: number }

const Rows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

/**
 * One player's word grid and keyboard, drawn with UI elements (so it can be rotated 180° for a face-to-face
 * 2-player game on a phone). Handles typing, flips, shakes and key colouring; the game decides the rules.
 */
export class WordPanel {
  readonly root: UINode;
  private gridRoot: UINode;
  private tiles: Tile[][] = [];
  private keys = new Map<string, Key>();
  private kbRoot: UINode;
  private enterKey!: Key; private backKey!: Key;
  private msg: Text;
  private msgT = 0;
  private hintRoot: UINode;
  private hintSlots: { bg: Image; text: Text }[] = [];
  private nameText: Text;
  private anims: Anim[] = [];
  readonly hidden: boolean;
  rows = 6;
  current = "";
  row = 0;
  locked = false;
  onKey: ((k: string) => void) | null = null;
  tileSize = 100;
  private w = 800; private h = 1200;
  accent: Color;

  /** hidden: colours only, no letters and no keyboard (the opponent's grid in a race). */
  constructor(parent: UINode, accent: Color, hidden: boolean, keyboard: boolean) {
    this.accent = accent;
    this.hidden = hidden;
    this.root = UIKit.node("WordPanel", parent);
    this.gridRoot = UIKit.node("Grid", this.root);
    for (let r = 0; r < 7; r++) {
      const row: Tile[] = [];
      for (let c = 0; c < LEN; c++) {
        const node = UIKit.node("Tile", this.gridRoot);
        const bg = UIKit.img(node, "Bg", TileSprite(), Color.clear);
        bg.rectTransform.stretch();
        const edge = UIKit.img(node, "Edge", TileEdge(), EmptyEdge);
        edge.rectTransform.stretch();
        const text = UIKit.label(node, "", 60, Color.white);
        text.rectTransform.stretch();
        UIKit.glow(text, new Color(0, 0, 0, 0.25), 2);
        row.push({ node, bg, edge, text, mark: -1 });
      }
      this.tiles.push(row);
    }
    this.hintRoot = UIKit.node("Hints", this.root);
    for (let c = 0; c < LEN; c++) {
      const bg = UIKit.img(this.hintRoot, "Hint", TileSprite(), Green.withAlpha(0));
      const text = UIKit.label(bg.rectTransform, "", 30, Color.white);
      text.rectTransform.stretch();
      this.hintSlots.push({ bg, text });
    }
    this.kbRoot = UIKit.node("Keyboard", this.root);
    if (keyboard) {
      for (const row of Rows) for (const ch of row) this.keys.set(ch, this.makeKey(ch, ch));
      this.enterKey = this.makeKey("ENTER", "Enter");
      this.backKey = this.makeKey("⌫", "Backspace");
    }
    this.kbRoot.setActive(keyboard);
    this.msg = UIKit.label(this.root, "", 34, Color.white);
    UIKit.glow(this.msg, Ink, 4);
    this.msg.gameObject.setActive(false);
    this.nameText = UIKit.label(this.root, "", 32, accent);
    UIKit.glow(this.nameText, Ink, 3);
  }

  private makeKey(label: string, value: string): Key {
    const node = UIKit.node("Key", this.kbRoot);
    const bg = UIKit.img(node, "Bg", TileSprite(), KeyBase, true);
    bg.rectTransform.stretch();
    const text = UIKit.label(node, label, 40, Color.white);
    text.rectTransform.stretch();
    const k: Key = { node, bg, label: text, mark: -1, ch: value };
    bg.rectTransform.el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      node.localScale = new V3(0.9, 0.9, 1);
      Fx.haptic();
      this.onKey?.(value);
    });
    const up = () => { node.localScale = V3.one; };
    bg.rectTransform.el.addEventListener("pointerup", up);
    bg.rectTransform.el.addEventListener("pointerleave", up);
    bg.rectTransform.el.addEventListener("pointercancel", up);
    return k;
  }

  setName(s: string, color: Color) { this.nameText.text = s; this.nameText.color = color; }

  /** Places the panel: node rect in its parent, with an optional 180° turn. */
  place(center: V2, size: V2, flipped: boolean) {
    this.root.place(UIKit.Center, center, size);
    this.root.localEulerAngles = new V3(0, 0, flipped ? 180 : 0);
    this.w = size.x;
    this.h = size.y;
    this.layout();
  }

  layout() {
    const W = this.w, H = this.h;
    const kb = this.kbRoot.activeSelf;
    const pad = 10, kg = Math.max(6, W * 0.012);
    const keyW = kb ? Math.min((W - 2 * pad - 9 * kg) / 10, 118) : 0;
    const keyH = kb ? Math.min(keyW * 1.42, H * 0.095) : 0;
    const kbH = kb ? 3 * keyH + 2 * kg : 0;
    const nameH = this.nameText.text ? Math.min(46, H * 0.05) : 0;
    const hintH = this.hidden ? 0 : Math.min(54, H * 0.045);
    const avail = H - kbH - (kb ? 26 : 0) - nameH - hintH - 16;
    const rows = this.rows, gap = 0.1;
    const t = Math.max(10, Math.min(avail / (rows + (rows - 1) * gap), (W * 0.94) / (5 + 4 * gap), this.hidden ? 70 : 150));
    this.tileSize = t;
    const gw = 5 * t + 4 * t * gap, gh = rows * t + (rows - 1) * t * gap;
    // centre the grid in the space between the hint strip and the keyboard
    const areaTop = H / 2 - nameH - hintH - 6, areaBottom = -H / 2 + kbH + (kb ? 26 : 0);
    const top = Math.min(areaTop, (areaTop + areaBottom) / 2 + gh / 2);
    this.nameText.rectTransform.place(UIKit.Center, new V2(0, H / 2 - nameH / 2), new V2(W, nameH));
    this.nameText.fontSize = Math.round(Math.max(18, nameH * 0.72));
    this.hintRoot.place(UIKit.Center, new V2(0, top + hintH / 2 + 2), new V2(W, hintH));
    for (let c = 0; c < LEN; c++) {
      const hs = hintH * 0.82;
      this.hintSlots[c].bg.rectTransform.place(UIKit.Center, new V2((c - 2) * (t * (1 + gap)), 0), new V2(hs, hs));
      this.hintSlots[c].text.fontSize = Math.round(hs * 0.6);
    }
    this.gridRoot.place(UIKit.Center, new V2(0, top - gh / 2), new V2(gw, gh));
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < LEN; c++) {
        const tile = this.tiles[r][c];
        tile.node.setActive(r < rows);
        tile.node.place(UIKit.Center, new V2((c - 2) * t * (1 + gap), gh / 2 - t / 2 - r * t * (1 + gap)), new V2(t, t));
        tile.text.fontSize = Math.round(t * 0.58);
      }
    this.msg.rectTransform.place(UIKit.Center, new V2(0, top - gh / 2), new V2(W, 60));
    this.msg.fontSize = Math.round(Mathf.clamp(t * 0.36, 22, 38));
    if (kb) {
      const by = -H / 2 + kbH / 2 + 4;
      this.kbRoot.place(UIKit.Center, new V2(0, by), new V2(W, kbH));
      Rows.forEach((row, ri) => {
        const y = kbH / 2 - keyH / 2 - ri * (keyH + kg);
        let x0 = -((row.length - 1) * (keyW + kg)) / 2;
        if (ri === 2) x0 = -((row.length - 1) * (keyW + kg)) / 2;
        for (let i = 0; i < row.length; i++) {
          const k = this.keys.get(row[i])!;
          k.node.place(UIKit.Center, new V2(x0 + i * (keyW + kg), y), new V2(keyW, keyH));
          k.label.fontSize = Math.round(Math.min(keyW * 0.55, keyH * 0.42));
        }
        if (ri === 2) {
          const wide = keyW * 1.5 + kg * 0.5;
          const xl = x0 - keyW / 2 - kg - wide / 2, xr = x0 + (row.length - 1) * (keyW + kg) + keyW / 2 + kg + wide / 2;
          this.enterKey.node.place(UIKit.Center, new V2(xl, y), new V2(wide, keyH));
          this.backKey.node.place(UIKit.Center, new V2(xr, y), new V2(wide, keyH));
          this.enterKey.label.fontSize = Math.round(Math.min(keyW * 0.36, keyH * 0.3));
          this.backKey.label.fontSize = Math.round(Math.min(keyW * 0.6, keyH * 0.45));
        }
      });
    }
  }

  // ------------------------------------------------------------------ state

  reset(rows: number) {
    this.rows = rows;
    this.current = "";
    this.row = 0;
    this.locked = false;
    this.anims = [];
    for (const row of this.tiles) for (const t of row) this.paintTile(t, "", -1);
    for (const k of this.keys.values()) { k.mark = -1; k.bg.color = KeyBase; }
    if (this.enterKey) { this.enterKey.bg.color = KeyBase; this.backKey.bg.color = KeyBase; }
    for (const h of this.hintSlots) { h.bg.color = Green.withAlpha(0); h.text.text = ""; }
    this.msg.gameObject.setActive(false);
    this.layout();
  }

  setRows(rows: number) { this.rows = rows; this.layout(); }

  private paintTile(t: Tile, ch: string, mark: number) {
    t.mark = mark;
    t.text.text = this.hidden ? "" : ch;
    if (mark >= 0) { t.bg.color = MarkColors[mark]; t.edge.color = Color.clear; }
    else { t.bg.color = ch ? new Color(1, 1, 1, 0.1) : new Color(1, 1, 1, 0.04); t.edge.color = ch ? new Color(1, 1, 1, 0.55) : EmptyEdge; }
    t.node.localScale = V3.one;
    t.node.localEulerAngles = V3.zero;
  }

  type(ch: string) {
    if (this.locked || this.current.length >= LEN || this.row >= this.rows) return false;
    this.current += ch;
    const t = this.tiles[this.row][this.current.length - 1];
    this.paintTile(t, ch, -1);
    this.anims.push({ kind: "pop", row: this.row, col: this.current.length - 1, t: 0, delay: 0, dur: 0.12 });
    return true;
  }

  /** Typing dots for a hidden opponent ("thinking"). */
  ghostType(n: number) {
    if (this.row >= this.rows) return;
    for (let c = 0; c < LEN; c++) this.paintTile(this.tiles[this.row][c], c < n ? "•" : "", -1);
    if (n > 0) this.anims.push({ kind: "pop", row: this.row, col: n - 1, t: 0, delay: 0, dur: 0.12 });
  }

  back() {
    if (this.locked || this.current.length === 0) return false;
    this.current = this.current.slice(0, -1);
    this.paintTile(this.tiles[this.row][this.current.length], "", -1);
    return true;
  }

  shake() {
    for (let c = 0; c < LEN; c++) this.anims.push({ kind: "shake", row: this.row, col: c, t: 0, delay: 0, dur: 0.45 });
  }

  /** Reveals a guess on the current row with flips; returns the flip time. */
  reveal(word: string, marks: number[], instant = false) {
    const r = this.row;
    for (let c = 0; c < LEN; c++) {
      const t = this.tiles[r][c];
      t.text.text = this.hidden ? "" : word[c];
      if (instant) this.paintTile(t, word[c], marks[c]);
      else this.anims.push({ kind: "flip", row: r, col: c, t: 0, delay: c * 0.22, dur: 0.42, mark: marks[c] });
    }
    // keyboard colours (best state wins), applied after the flips
    const apply = () => {
      for (let c = 0; c < LEN; c++) {
        const k = this.keys.get(word[c]);
        if (k && marks[c] > k.mark) { k.mark = marks[c]; k.bg.color = MarkColors[marks[c]]; }
      }
    };
    if (instant) apply(); else this.pendingKeys.push({ at: LEN * 0.22 + 0.4, apply });
    this.row++;
    this.current = "";
    return instant ? 0 : LEN * 0.22 + 0.45;
  }
  private pendingKeys: { at: number; apply: () => void }[] = [];

  bounceRow(r: number) {
    for (let c = 0; c < LEN; c++) this.anims.push({ kind: "bounce", row: r, col: c, t: 0, delay: c * 0.09, dur: 0.5 });
  }

  /** Shows a revealed hint letter above the grid and colours its key. */
  showHint(pos: number, ch: string) {
    const h = this.hintSlots[pos];
    h.bg.color = Green;
    h.text.text = ch;
    const k = this.keys.get(ch);
    if (k && k.mark < 2) { k.mark = 2; k.bg.color = Green; }
  }

  message(s: string, seconds = 1.6) {
    this.msg.text = s;
    this.msg.gameObject.setActive(true);
    this.msgT = seconds;
  }

  tileWorldKey(r: number, c: number) { return this.tiles[r][c].node; }

  update(dt: number) {
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg.gameObject.setActive(false); }
    for (const p of this.pendingKeys) p.at -= dt;
    for (const p of this.pendingKeys.filter((q) => q.at <= 0)) p.apply();
    this.pendingKeys = this.pendingKeys.filter((q) => q.at > 0);
    for (const a of this.anims) {
      a.t += dt;
      const tile = this.tiles[a.row][a.col];
      const k = Mathf.clamp01((a.t - a.delay) / a.dur);
      if (a.t < a.delay) continue;
      switch (a.kind) {
        case "pop": { const s = 1 + 0.12 * Math.sin(k * Math.PI); tile.node.localScale = new V3(s, s, 1); break; }
        case "flip": {
          const sy = k < 0.5 ? 1 - Ease.inQuad(k * 2) : Ease.outCubic((k - 0.5) * 2);
          if (k >= 0.5 && tile.mark !== a.mark) {
            this.paintTile(tile, tile.text.text || "", a.mark!);
            if (!this.hidden) Sfx.play(Snd.Tick, 0.35, 0.9 + a.col * 0.08 + (a.mark ?? 0) * 0.1);
          }
          tile.node.localScale = new V3(1, Math.max(0.02, sy), 1);
          break;
        }
        case "bounce": { const y = Math.sin(k * Math.PI) * this.tileSize * 0.35; tile.node.localScale = new V3(1 + 0.08 * Math.sin(k * Math.PI), 1 + 0.08 * Math.sin(k * Math.PI), 1); tile.node.anchoredPosition = tile.node.anchoredPosition.withY(this.rowY(a.row) + y); break; }
        case "shake": { const x = Math.sin(k * Math.PI * 6) * (1 - k) * this.tileSize * 0.18; tile.node.anchoredPosition = tile.node.anchoredPosition.withX(this.colX(a.col) + x); break; }
      }
    }
    for (const a of this.anims) if (a.t >= a.delay + a.dur) {
      const tile = this.tiles[a.row][a.col];
      tile.node.localScale = V3.one;
      if (a.kind === "bounce") tile.node.anchoredPosition = tile.node.anchoredPosition.withY(this.rowY(a.row));
      if (a.kind === "shake") tile.node.anchoredPosition = tile.node.anchoredPosition.withX(this.colX(a.col));
    }
    this.anims = this.anims.filter((a) => a.t < a.delay + a.dur);
  }

  get animating() { return this.anims.some((a) => a.kind === "flip") || this.pendingKeys.length > 0; }

  private rowY(r: number) { const t = this.tileSize, gh = this.rows * t + (this.rows - 1) * t * 0.1; return gh / 2 - t / 2 - r * t * 1.1; }
  private colX(c: number) { return (c - 2) * this.tileSize * 1.1; }

  /** Marks for a guess (used by the game; kept here for symmetry with reveal). */
  static marks(guess: string, answer: string) { return score(guess, answer); }

  /** Canvas-space centre of the grid (for effects). */
  gridNode() { return this.gridRoot; }
  get keyboardRoot() { return this.kbRoot; }
}

