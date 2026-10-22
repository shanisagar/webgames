import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, CasualFx, CasualLook, Color, Ease, Fmt, Fx, GameInfo, GameObject,
  howTo, Image, Mathf, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, TapPointer, Text, TouchScheme, UIKit,
  V2, V3,
} from "../../kit";
import { TileGardenArt } from "./TileGardenArt";

/**
 * TILE GARDEN: a calm triple-match puzzle. Tiles are stacked in layers; only tiles with nothing on top can be picked.
 * Tapped tiles move into a 7-slot tray, and three of a kind in the tray clear. Clear the whole garden to win; fill the
 * tray and the level is lost. UNDO, MAGIC (pulls a set of three) and SHUFFLE boosters can be refilled with rewarded
 * ads; a rewarded ad can also send three tiles back to the board once per level. (Port of TileGardenGame.cs.)
 */

// ------------------------------------------------------------------ tuning

const TopBand = 250, BottomBand = 200;
const TraySize = 7;
const Fly = 0.28;

const Ink = Pal.hex(0x3a2a20), Jade = Pal.hex(0x2e9e7a), Blossom = Pal.hex(0xff7fa8), Gold = Pal.hex(0xffb627);

class Tile {
  Type = 0; Layer = 0; Hx = 0; Hy = 0; Order = 0;
  OnBoard = false; Blocked = false; Matched = false;
  Root!: GameObject;
  Body!: SpriteRenderer; Icon!: SpriteRenderer;
  From = V2.zero; To = V2.zero; Pos = V2.zero;
  T = 1; PopT = -1; Wiggle = 0; Scale = 1; Appear = 1;
}

interface V3i { x: number; y: number; z: number }

export class TileGardenGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject;
  private boardRoot!: GameObject;
  private bgCover!: SpriteRenderer;
  private tray!: SpriteRenderer;
  private slots: SpriteRenderer[] = [];
  private tiles: Tile[] = [];
  private trayTiles: Tile[] = [];
  private history: Tile[] = [];
  private fx!: CasualFx;
  private petals!: CasualFx;
  private pointer = new TapPointer();
  private rng = new SysRandom();

  private tileW = 0; private slotW = 0; private trayY = 0;
  private boardCenter = V2.zero;
  private level = 0; private boardCount = 0; private totalTiles = 0; private matches = 0; private combo = 0;
  private timer = 0; private petalTimer = 0; private endTimer = 0; private comboTimer = 0; private attractTimer = 0;
  private ended = false; private won = false; private revived = false;
  protected usedBooster = false; // written but never read (as in the C#)

  // HUD
  private levelText!: Text; private timeText!: Text; private leftText!: Text;
  private undoButton!: ArcadeButton; private magicButton!: ArcadeButton; private shuffleButton!: ArcadeButton;
  private mapNodes: Image[] = [];
  private mapLabels: Text[] = [];
  private mapStars: Image[][] = [];
  private mapNow: Text[] = [];

  private tapClip!: AudioClip; private clearClip!: AudioClip; private denyClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "tilegarden",
      Title: "TILE GARDEN",
      Tagline: "MATCH THREE. CLEAR THE GARDEN.",
      Accent: Jade,
      Accent2: Blossom,
      BgTop: Pal.hex(0xfcefe2),
      BgBottom: Pal.hex(0xf7e7d0),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 76, rootHz: 146.8, degrees: [0, 3, 4, 2], seed: 33, energy: 0.25, major: true },
      Reminders: [
        "Your garden is waiting|A few tiles to match and it's in bloom.",
        "Time for a calm break|Match three and relax in the tile garden.",
        "A new garden has grown|Can you clear it with three stars?",
      ],
      HowTo: [
        howTo(TileGardenArt.Icon(10), Color.white, "TAP a tile to move it into the tray. Only tiles with nothing on top can be picked."),
        howTo(TileGardenArt.Icon(1), Color.white, "Three of the SAME tile in the tray clear away."),
        howTo(TileGardenArt.Icon(5), Color.white, "Clear every tile to finish the garden. Faster clears earn more stars."),
        howTo(Art.Diamond, Pal.Danger, "If all 7 tray slots fill up without a match, the level is lost."),
        howTo(TileGardenArt.Icon(11), Color.white, "UNDO takes back a tile. MAGIC collects a set of three. SHUFFLE mixes the board."),
      ],
      Tips: [
        "Don't fill the tray with singles: look for pairs first.",
        "Uncover tiles that hide many others.",
        "Darker tiles are covered: clear what's on top of them first.",
        "Save MAGIC for when the tray is getting full.",
        "Two of a kind in the tray? The third is the safest pick.",
      ],
    });
  }

  protected get ShortSide() { return Screen.width > Screen.height ? 10 : 9; }

  private get CurrentLevel() { return Math.max(1, this.Data.get("level", 1)); }
  private get Undos() { return this.Data.get("undo", 3); }
  private set Undos(v: number) { this.Data.set("undo", Math.max(0, v)); }
  private get Magics() { return this.Data.get("magic", 2); }
  private set Magics(v: number) { this.Data.set("magic", Math.max(0, v)); }
  private get Shuffles() { return this.Data.get("shuffle", 2); }
  private set Shuffles(v: number) { this.Data.set("shuffle", Math.max(0, v)); }

  protected BestLine() { return `LEVEL ${this.CurrentLevel}   ·   ${this.Data.get("stars")} STARS`; }
  protected StatsLine() { return `${Fmt.n(this.Data.get("cleared"))} TILES MATCHED   ·   ${this.Data.get("level", 1) - 1} GARDENS CLEARED`; }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("TileWorld", this.gameObject);
    CasualLook.calm(this, 1.25, 0.15);
    this.bgCover = CasualLook.cover(this.world, TileGardenArt.Paper, -910);
    this.boardRoot = new GameObject("Board", this.world);
    this.tray = Art.spr(this.world, "Tray", TileGardenArt.Tray, Color.white, 1, 300, Art.Flat);
    for (let i = 0; i < TraySize; i++) this.slots.push(Art.spr(this.world, "Slot", TileGardenArt.Slot, Color.white, 1, 301, Art.Flat));
    this.petals = CasualFx.create(this.world, -500, 60);
    this.fx = CasualFx.create(this.world, 700, 200);

    this.tapClip = Sfx.make("tg-tap", 0.12, (t) => (Sfx.sinP(Sfx.glide(t, 900, 600, 0.08)) * 0.6 + Sfx.triP(1800 * t) * 0.2) * Sfx.env(t, 0.001, 0.07) * 0.3);
    this.clearClip = Sfx.make("tg-clear", 0.45, (t) =>
      (Sfx.sinP(659.25 * t) * Sfx.env(t, 0.004, 0.3) + Sfx.sinP(830.6 * t) * Sfx.env(t - 0.06, 0.004, 0.3) + Sfx.sinP(987.8 * t) * Sfx.env(t - 0.12, 0.004, 0.32)) * 0.17);
    this.denyClip = Sfx.make("tg-deny", 0.12, (t) => Sfx.triP(Sfx.glide(t, 220, 160, 0.1)) * Sfx.env(t, 0.002, 0.1) * 0.25);

    this.BuildHud();
    this.Layout();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    const plate = UIKit.img(hud, "TopPlate", Art.UiRound, new Color(1, 0.98, 0.94, 0.9));
    plate.rectTransform.place(new V2(0.5, 1), new V2(-60, -100), new V2(820, 140));
    this.levelText = UIKit.at(UIKit.label(plate.rectTransform, "LEVEL 1", 40, Ink), new V2(0, 0.5), new V2(150, 0), new V2(260, 60));
    this.timeText = UIKit.at(UIKit.label(plate.rectTransform, "0:00", 44, Jade), UIKit.Center, new V2(0, 0), new V2(220, 60));
    this.leftText = UIKit.at(UIKit.label(plate.rectTransform, "", 30, Ink.withAlpha(0.75)), new V2(1, 0.5), new V2(-140, 0), new V2(260, 50));

    this.undoButton = UIKit.buttonAt(hud, "UNDO", new V2(0.5, 0), new V2(-330, 90), new V2(300, 110), false, () => this.OnUndo(), 28);
    this.magicButton = UIKit.buttonAt(hud, "MAGIC", new V2(0.5, 0), new V2(0, 90), new V2(300, 110), false, () => this.OnMagic(), 28);
    this.shuffleButton = UIKit.buttonAt(hud, "SHUFFLE", new V2(0.5, 0), new V2(330, 90), new V2(300, 110), false, () => this.OnShuffle(), 28);
    this.undoButton.setAccent(Pal.hex(0x3fa2f5));
    this.magicButton.setAccent(Blossom);
    this.shuffleButton.setAccent(Jade);

    if (this.UI.TitleExtra) {
      CasualLook.titleCard(this.UI, new Color(0.15, 0.33, 0.28, 0.88));
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * 180;
        if (i < 4) {
          const link = UIKit.img(this.UI.TitleExtra, "Path", Art.UiRound, new Color(1, 1, 1, 0.35));
          link.rectTransform.place(UIKit.Center, new V2(x + 90, 8), new V2(110, 12));
        }
        const node = UIKit.img(this.UI.TitleExtra, "Node", Art.UiCircle, Color.white);
        node.rectTransform.place(UIKit.Center, new V2(x, 8), new V2(80, 80));
        this.mapNodes.push(node);
        this.mapLabels.push(UIKit.at(UIKit.label(node.rectTransform, "1", 34, Ink), UIKit.Center, V2.zero, new V2(80, 80)));
        const st: Image[] = [];
        for (let k = 0; k < 3; k++) {
          st.push(UIKit.img(this.UI.TitleExtra, "Star", Art.Star, Gold));
          st[k].rectTransform.place(UIKit.Center, new V2(x + (k - 1) * 28, -50), new V2(26, 26));
        }
        this.mapStars.push(st);
        this.mapNow.push(UIKit.at(UIKit.label(this.UI.TitleExtra, "", 24, Gold), UIKit.Center, new V2(x, -52), new V2(160, 30)));
      }
    }
  }

  private RefreshMap() {
    const cur = this.CurrentLevel;
    const first = Math.max(1, cur - 2);
    for (let i = 0; i < this.mapNodes.length; i++) {
      const l = first + i;
      const done = l < cur, now = l === cur;
      this.mapLabels[i].text = String(l);
      this.mapNodes[i].color = now ? Blossom : done ? Jade : new Color(1, 1, 1, 0.85);
      this.mapLabels[i].color = now || done ? Color.white : Ink;
      this.mapNodes[i].rectTransform.localScale = now ? new V3(1.25, 1.25, 1) : V3.one;
      const st = this.Data.get("s" + l);
      for (let k = 0; k < 3; k++) {
        this.mapStars[i][k].gameObject.setActive(done);
        this.mapStars[i][k].color = k < st ? Gold : new Color(1, 1, 1, 0.3);
      }
      this.mapNow[i].text = now ? "PLAY!" : "";
    }
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    const rect = this.PlayRect(TopBand, BottomBand, 0.15);
    this.slotW = Math.min(1.2, (Math.min(rect.width, 9.5) - 0.5) / TraySize);
    this.trayY = rect.yMin + this.slotW * 0.62;
    const trayW = this.slotW * TraySize + 0.35;
    this.tray.transform.localScale = new V3(trayW, (this.slotW * 1.4) / (96 / 512), 1);
    this.tray.transform.localPosition = new V3(0, this.trayY, 0);
    for (let i = 0; i < TraySize; i++) {
      this.slots[i].transform.localScale = new V3(this.slotW * 0.92, this.slotW * 1.02, 1);
      this.slots[i].transform.localPosition = new V3(this.SlotX(i), this.trayY, 0);
    }

    // Fit the board between the HUD and the tray
    if (this.tiles.length > 0) {
      let minX = 999, maxX = -999, minY = 999, maxY = -999, maxL = 0;
      for (const t of this.tiles) {
        minX = Math.min(minX, t.Hx); maxX = Math.max(maxX, t.Hx);
        minY = Math.min(minY, t.Hy); maxY = Math.max(maxY, t.Hy);
        maxL = Math.max(maxL, t.Layer);
      }
      const needW = (maxX - minX) * 0.5 + 1;
      const needH = (maxY - minY) * 0.5 + 1.12 + maxL * 0.08;
      const availW = rect.width - 0.2, availH = rect.yMax - (this.trayY + this.slotW * 0.9) - 0.25;
      this.tileW = Math.min(1.45, Math.min(availW / needW, availH / needH));
      const cy = (this.trayY + this.slotW * 0.9 + 0.25 + rect.yMax) * 0.5;
      this.boardCenter = new V2(-(minX + maxX) * 0.25 * this.tileW, cy - (minY + maxY) * 0.25 * this.tileW - maxL * 0.04 * this.tileW);
      for (const t of this.tiles) {
        if (t.OnBoard) { t.To = this.BoardPos(t); if (t.T >= 1) t.Pos = t.To; }
        const s = t.OnBoard ? this.tileW : this.slotW * 0.95;
        t.Body.transform.localScale = new V3(s, s, 1);
      }
      this.RelayoutTray(false);
    }
  }

  private SlotX(i: number) { return (i - (TraySize - 1) * 0.5) * this.slotW; }

  private BoardPos(t: Tile) { return this.boardCenter.add(new V2(t.Hx * 0.5 * this.tileW, t.Hy * 0.5 * this.tileW + t.Layer * 0.08 * this.tileW)); }

  // ------------------------------------------------------------------ levels

  private BuildLevel(lvl: number) {
    for (const t of this.tiles) t.Root.destroy();
    this.tiles = [];
    this.trayTiles = [];
    this.history = [];
    this.fx.clear();
    this.rng = new SysRandom(lvl * 9173 + 5);

    const layers = Math.min(2 + Math.trunc((lvl - 1) / 2), 5);
    const c0 = Math.min(4 + Math.trunc(lvl / 3), 7), r0 = Math.min(4 + Math.trunc((lvl + 1) / 3), 8);
    const shape = lvl <= 2 ? 0 : lvl % 4;
    let pos: V3i[] = [];
    for (let l = 0; l < layers; l++) {
      const c = c0 - l, r = r0 - l;
      if (c < 1 || r < 1) break;
      const keep = l === 0 ? 1 : 0.82;
      for (let j = 0; j < r; j++)
        for (let i = 0; i < Math.trunc((c + 1) / 2); i++) {
          const mi = c - 1 - i; // mirrored column
          if (!TileGardenGame.ShapeHas(shape, i, j, c, r, l)) continue;
          if (l > 0 && this.rng.nextDouble() > keep) continue;
          const hy = (r - 1) - j * 2;
          pos.push({ x: i * 2 - (c - 1), y: hy, z: l });
          if (mi !== i) pos.push({ x: mi * 2 - (c - 1), y: hy, z: l });
        }
    }
    // total must be a multiple of three: drop tiles from the top layer
    pos = pos.sort((a, b) => b.z - a.z);
    while (pos.length % 3 !== 0) pos.splice(0, 1);
    const sets = pos.length / 3;
    const types = Math.min(4 + lvl, TileGardenArt.Types);
    const bag: number[] = [];
    const offset = this.rng.next(TileGardenArt.Types);
    for (let s = 0; s < sets; s++) {
      const ty = (offset + (s % types)) % TileGardenArt.Types;
      bag.push(ty, ty, ty);
    }
    for (let i = bag.length - 1; i > 0; i--) { const k = this.rng.next(i + 1); const tmp = bag[i]; bag[i] = bag[k]; bag[k] = tmp; }

    for (let i = 0; i < pos.length; i++) {
      const p = pos[i];
      const t = new Tile();
      t.Type = bag[i]; t.Hx = p.x; t.Hy = p.y; t.Layer = p.z; t.OnBoard = true;
      t.Root = new GameObject("Tile", this.boardRoot);
      t.Body = Art.spr(t.Root, "Body", TileGardenArt.Body, Color.white, 1, 0, Art.Flat);
      t.Icon = Art.spr(t.Body.transform, "Icon", TileGardenArt.Icon(t.Type), Color.white, 0.74, 0, Art.Flat);
      t.Icon.transform.localPosition = new V3(0, 0.05, 0);
      t.Appear = -(p.z * 0.25 + this.rng.nextDouble() * 0.25);
      this.tiles.push(t);
    }
    this.boardCount = this.tiles.length;
    this.totalTiles = this.tiles.length;
    this.Layout();
    for (const t of this.tiles) { t.Pos = t.To = this.BoardPos(t); t.T = 1; }
    this.UpdateBlocked();
    this.ApplyOrders();
  }

  private static ShapeHas(shape: number, i: number, j: number, c: number, r: number, layer: number) {
    const ci = (c - 1) * 0.5, cj = (r - 1) * 0.5;
    const dx = Math.abs(i - ci), dy = Math.abs(j - cj);
    switch (shape) {
      case 1: return dx / Math.max(1, ci + 0.5) + dy / Math.max(1, cj + 0.5) <= 1.15; // diamond
      case 2: return dx <= 0.6 + layer * 0 || dy <= 0.6 || layer > 0; // plus on the base
      case 3: return layer > 0 ? dx > 0.6 || dy > 0.6 : true; // ring on top
      default: return true;
    }
  }

  private UpdateBlocked() {
    for (const t of this.tiles) {
      if (!t.OnBoard) continue;
      let blocked = false;
      for (const o of this.tiles) {
        if (!o.OnBoard || o.Layer <= t.Layer) continue;
        if (Math.abs(o.Hx - t.Hx) < 2 && Math.abs(o.Hy - t.Hy) < 2) { blocked = true; break; }
      }
      t.Blocked = blocked;
    }
  }

  private ApplyOrders() {
    for (const t of this.tiles) {
      const order = t.OnBoard ? (10 + t.Layer * 40 + (20 - t.Hy)) * 2 : 600;
      t.Body.sortingOrder = order;
      t.Icon.sortingOrder = order + 1;
    }
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.level = this.CurrentLevel;
    this.BuildLevel(this.level);
    this.ended = false;
    this.attractTimer = 1;
    this.RefreshMap();
  }

  protected BeginRun() {
    this.level = this.CurrentLevel;
    this.BuildLevel(this.level);
    this.timer = 0;
    this.matches = this.combo = 0;
    this.ended = this.won = this.revived = this.usedBooster = false;
    this.pointer.reset();
    this.pointer.topBand = 0.12;
    this.UI.Announce(`LEVEL ${this.level}`, Jade, 1.2);
    if (this.Data.get("runs") === 0) this.UI.Hint("Tap a bright tile to move it to the tray. Three alike clear away!");
    this.Data.add("runs", 1);
    Sfx.setIntensity(0.2);
    this.UpdateHud();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    this.Animate(dt);
    this.Petals(dt);
    if (this.State !== Phase.Title) return;
    this.attractTimer -= dt;
    if (this.attractTimer > 0) return;
    this.attractTimer = 0.9;
    // Attract: pick tiles automatically (pairs first) and replay the level when done
    if (this.boardCount === 0 || this.trayTiles.length >= TraySize - 1) { this.BuildLevel(this.level); return; }
    const pick = this.SmartPick();
    if (pick) this.Take(pick, false);
  }

  protected TickRun(dt: number) {
    this.pointer.update(dt);
    this.Animate(dt);
    this.Petals(dt);
    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.State === Phase.Playing) {
        if (this.won) this.Win();
        else this.Lose();
      }
      return;
    }
    this.timer += dt;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;

    if (this.pointer.tap) {
      const t = this.TileAt(this.ScreenToWorld(this.pointer.screen));
      if (t) {
        if (t.Blocked) {
          t.Wiggle = 1;
          Sfx.playClip(this.denyClip, 0.6);
        } else if (this.TrayRoom() > 0) this.Take(t, true);
      }
    }
    this.CheckEnd();
    this.UpdateHud();
  }

  private Petals(dt: number) {
    this.petalTimer -= dt;
    if (this.petalTimer > 0) return;
    this.petalTimer = 0.45;
    const x = (this.rng.nextDouble() * 2 - 1) * this.ViewSize.x * 0.55;
    this.petals.emit(new V2(x, this.ViewSize.y * 0.55), new V2(0.5 + this.rng.nextDouble() * 0.6, -0.8), Color.white, 0.32, 9,
      TileGardenArt.Petal, 0, (this.rng.nextDouble() * 2 - 1) * 120, false, 0);
  }

  private TileAt(w: V2) {
    let best: Tile | null = null;
    for (const t of this.tiles) {
      if (!t.OnBoard) continue;
      const d = w.sub(t.Pos);
      if (Math.abs(d.x) > this.tileW * 0.47 || d.y > this.tileW * 0.52 || d.y < -this.tileW * 0.56) continue;
      if (!best || t.Body.sortingOrder > best.Body.sortingOrder) best = t;
    }
    return best;
  }

  private TrayRoom() {
    let used = 0;
    for (const t of this.trayTiles) if (!t.Matched) used++;
    return TraySize - used;
  }

  private Take(t: Tile, real: boolean) {
    t.OnBoard = false;
    this.boardCount--;
    t.From = t.Pos;
    t.T = 0;
    let idx = this.trayTiles.length;
    for (let i = this.trayTiles.length - 1; i >= 0; i--)
      if (this.trayTiles[i].Type === t.Type && !this.trayTiles[i].Matched) { idx = i + 1; break; }
    this.trayTiles.splice(idx, 0, t);
    if (real) this.history.push(t);
    Sfx.playClip(this.tapClip, real ? 0.8 : 0.3, 0.95 + this.rng.nextDouble() * 0.1);
    this.UpdateBlocked();
    this.ApplyOrders();
    this.RelayoutTray(true);
    const s = this.slotW * 0.95;
    t.Body.transform.localScale = new V3(s, s, 1);

    // three alike?
    let count = 0;
    for (const o of this.trayTiles) if (o.Type === t.Type && !o.Matched) count++;
    if (count >= 3) {
      let n = 0;
      for (const o of this.trayTiles) {
        if (o.Type !== t.Type || o.Matched || n >= 3) continue;
        o.Matched = true;
        o.PopT = -(Fly + 0.05) - n * 0.04;
        const hi = this.history.indexOf(o);
        if (hi >= 0) this.history.splice(hi, 1);
        n++;
      }
      if (real) {
        this.matches++;
        this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
        this.comboTimer = 3;
        if (this.combo >= 3) this.UI.Announce(this.combo >= 5 ? "AMAZING!" : "GREAT!", Blossom, 0.9);
      }
    }
  }

  private RelayoutTray(animate: boolean) {
    let slot = 0;
    for (const t of this.trayTiles) {
      const target = new V2(this.SlotX(Math.min(slot, TraySize - 1)), this.trayY + 0.02);
      if (!target.equals(t.To)) {
        if (animate && t.T >= 1) { t.From = t.Pos; t.T = 0; }
        t.To = target;
        if (!animate) { t.Pos = target; t.T = 1; }
      }
      slot++;
    }
  }

  private CheckEnd() {
    let pending = false;
    for (const t of this.trayTiles) if (t.Matched || t.T < 1) pending = true;
    if (pending) return;
    if (this.boardCount === 0 && this.trayTiles.length === 0) {
      this.ended = true;
      this.won = true;
      this.endTimer = 1.2;
      this.UI.Announce("GARDEN CLEARED!", Jade, 1.6);
      this.fx.confetti(new V2(0, 1), 70, 9, [Blossom, Gold, Jade, Pal.hex(0x3fa2f5), Color.white]);
      Sfx.play(Snd.Win);
      return;
    }
    if (this.trayTiles.length >= TraySize) {
      this.ended = true;
      this.won = false;
      this.endTimer = 0.8;
      this.UI.Announce("TRAY FULL!", Pal.Danger, 1.2);
      Sfx.play(Snd.Lose, 0.8);
      this.Fx.shake(0.2);
    }
  }

  // ------------------------------------------------------------------ animation

  private Animate(dt: number) {
    for (let i = this.tiles.length - 1; i >= 0; i--) {
      const t = this.tiles[i];
      if (t.Appear < 1) t.Appear = Math.min(1, t.Appear + dt * 3);
      if (t.T < 1) {
        t.T = Math.min(1, t.T + dt / Fly);
        const e = Ease.outCubic(t.T);
        t.Pos = V2.lerp(t.From, t.To, e).add(new V2(0, Math.sin(t.T * Math.PI) * 0.6));
        if (t.T >= 1) t.Pos = t.To;
      } else if (t.OnBoard) t.Pos = t.To;
      t.Wiggle = Mathf.moveTowards(t.Wiggle, 0, dt * 3);
      const wig = Math.sin(t.Wiggle * 30) * t.Wiggle * 0.08;

      if (t.Matched) {
        t.PopT += dt;
        if (t.PopT >= 0) {
          const k = t.PopT / 0.22;
          t.Scale = 1 + Math.sin(Math.min(1, k) * Math.PI) * 0.25 - Math.max(0, k - 0.5) * 1.6;
          if (k >= 1) {
            this.fx.pop(t.Pos, TileGardenArt.IconTint[t.Type], 12, 4, 0.24, 0.45);
            this.fx.sparkle(t.Pos, Color.white, 3, 0.4, 0.3);
            let first = true;
            for (const o of this.trayTiles) if (o !== t && o.Matched && o.Type === t.Type) first = false;
            if (first) {
              Sfx.playClip(this.clearClip, 0.8, 1 + Math.min(this.combo, 6) * 0.05);
              if (this.State === Phase.Playing) this.Data.add("cleared", 3);
              Fx.haptic();
            }
            const ti = this.trayTiles.indexOf(t);
            if (ti >= 0) this.trayTiles.splice(ti, 1);
            this.tiles.splice(i, 1);
            t.Root.destroy();
            this.RelayoutTray(true);
            continue;
          }
        }
      } else t.Scale = 1;

      const ap = t.Appear < 1 ? Ease.outBack(Mathf.clamp01(t.Appear)) : 1;
      t.Root.localPosition = new V3(t.Pos.x + wig, t.Pos.y, 0);
      t.Root.localScale = new V3(t.Scale * ap, t.Scale * ap, 1);
      const tint = t.OnBoard && t.Blocked ? new Color(0.62, 0.6, 0.58, 1) : Color.white;
      t.Body.color = tint;
      t.Icon.color = t.OnBoard && t.Blocked ? new Color(0.7, 0.68, 0.66, 1) : Color.white;
    }
  }

  // ------------------------------------------------------------------ boosters

  private Busy() {
    for (const t of this.trayTiles) if (t.T < 1 || t.Matched) return true;
    return this.ended || this.State !== Phase.Playing;
  }

  private OnUndo() { this.Booster("undo", () => this.Undos, (v) => (this.Undos = v), () => this.DoUndo()); }
  private OnMagic() { this.Booster("magic", () => this.Magics, (v) => (this.Magics = v), () => this.DoMagic()); }
  private OnShuffle() { this.Booster("shuffle", () => this.Shuffles, (v) => (this.Shuffles = v), () => this.DoShuffle()); }

  private Booster(key: string, get: () => number, set: (v: number) => void, run: () => boolean) {
    if (this.Busy()) return;
    if (get() > 0) {
      if (run()) {
        set(get() - 1);
        this.usedBooster = true;
        this.Data.flush();
      } else Sfx.playClip(this.denyClip, 0.6);
      return;
    }
    if (!AdService.rewardedAvailable) return;
    AdService.showRewarded((ok) => {
      if (!ok) return;
      set(get() + 1);
      this.Data.flush();
      this.UI.Toast("+1 " + key.toUpperCase(), 2);
      Sfx.play(Snd.PowerUp, 0.7);
    });
  }

  private DoUndo() {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const t = this.history[i];
      this.history.splice(i, 1);
      if (t.Matched || t.OnBoard) continue;
      this.ReturnToBoard(t);
      return true;
    }
    return false;
  }

  private ReturnToBoard(t: Tile) {
    const ti = this.trayTiles.indexOf(t);
    if (ti >= 0) this.trayTiles.splice(ti, 1);
    t.OnBoard = true;
    this.boardCount++;
    t.From = t.Pos;
    t.To = this.BoardPos(t);
    t.T = 0;
    t.Body.transform.localScale = new V3(this.tileW, this.tileW, 1);
    this.UpdateBlocked();
    this.ApplyOrders();
    this.RelayoutTray(true);
    Sfx.play(Snd.Whoosh, 0.5);
  }

  private DoMagic() {
    // complete a pair (or single) already in the tray, else take the most common type on the board
    const inTray = new Array<number>(TileGardenArt.Types).fill(0);
    for (const t of this.trayTiles) if (!t.Matched) inTray[t.Type]++;
    let best = -1, bestCount = -1;
    for (let ty = 0; ty < TileGardenArt.Types; ty++) {
      let onBoard = 0;
      for (const t of this.tiles) if (t.OnBoard && t.Type === ty) onBoard++;
      if (onBoard + inTray[ty] < 3 || onBoard === 0) continue;
      if (3 - inTray[ty] > this.TrayRoom()) continue;
      if (inTray[ty] > bestCount) { bestCount = inTray[ty]; best = ty; }
    }
    if (best < 0) return false;
    const need = 3 - inTray[best];
    // prefer tiles on the highest layers
    const cands: Tile[] = [];
    for (const t of this.tiles) if (t.OnBoard && t.Type === best) cands.push(t);
    cands.sort((a, b) => b.Layer - a.Layer);
    for (let i = 0; i < need && i < cands.length; i++) this.Take(cands[i], true);
    this.fx.sparkle(new V2(0, this.trayY + 0.6), Blossom, 12, 2.5, 0.4);
    Sfx.play(Snd.PowerUp, 0.7);
    return true;
  }

  private DoShuffle() {
    const board: Tile[] = [];
    for (const t of this.tiles) if (t.OnBoard) board.push(t);
    if (board.length < 2) return false;
    const types: number[] = [];
    for (const t of board) types.push(t.Type);
    for (let i = types.length - 1; i > 0; i--) { const k = this.rng.next(i + 1); const tmp = types[i]; types[i] = types[k]; types[k] = tmp; }
    for (let i = 0; i < board.length; i++) {
      board[i].Type = types[i];
      board[i].Icon.sprite = TileGardenArt.Icon(types[i]);
      board[i].Appear = 0.3;
    }
    Sfx.play(Snd.Whoosh, 0.8);
    this.Fx.shake(0.15);
    return true;
  }

  private SmartPick() {
    // attract-mode AI: complete sets already in the tray, else take a free tile whose type is most available
    let pick: Tile | null = null;
    let bestScore = -1;
    for (const t of this.tiles) {
      if (!t.OnBoard || t.Blocked) continue;
      let score = 0;
      for (const o of this.trayTiles) if (o.Type === t.Type && !o.Matched) score += 10;
      for (const o of this.tiles) if (o !== t && o.OnBoard && !o.Blocked && o.Type === t.Type) score += 3;
      if (score > bestScore) { bestScore = score; pick = t; }
    }
    return pick;
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    TileGardenGame.SetText(this.levelText, "LEVEL " + this.level);
    TileGardenGame.SetText(this.timeText, Fmt.clock(this.timer));
    TileGardenGame.SetText(this.leftText, `${this.boardCount} TILES`);
    this.Label(this.undoButton, "UNDO", this.Undos);
    this.Label(this.magicButton, "MAGIC", this.Magics);
    this.Label(this.shuffleButton, "SHUFFLE", this.Shuffles);
  }

  private Label(b: ArcadeButton | null, name: string, count: number) {
    if (!b || !b.label) return;
    TileGardenGame.SetText(b.label, count > 0 ? `${name} ×${count}` : AdService.rewardedAvailable ? `${name} +AD` : name);
    b.interactable = !this.ended && (count > 0 || AdService.rewardedAvailable);
  }

  private static SetText(t: Text | null, s: string) {
    if (t && t.text !== s) t.text = s;
  }

  // ------------------------------------------------------------------ results

  private Win() {
    const par = Math.max(30, this.totalTiles * 1.5);
    const stars = this.timer <= par ? 3 : this.timer <= par * 1.6 ? 2 : 1;
    const prev = this.Data.get("s" + this.level);
    if (stars > prev) {
      this.Data.set("s" + this.level, stars);
      this.Data.add("stars", stars - prev);
    }
    const ms = Mathf.roundToInt(this.timer * 1000);
    const newBest = this.Data.min("t" + this.level, ms);
    this.Data.set("level", this.level + 1);
    const gift = this.level % 4 === 0;
    if (gift) { this.Undos = this.Undos + 1; this.Magics = this.Magics + 1; this.Shuffles = this.Shuffles + 1; }
    const lvl = this.level;
    this.Finish(new Result({
      Headline: `LEVEL ${lvl} CLEARED!`,
      HeadlineColor: Gold,
      Stars: stars,
      Value: Fmt.clock(this.timer),
      NewBest: newBest,
      BestLine: gift ? "GIFT: +1 UNDO, MAGIC & SHUFFLE" : `NEXT: LEVEL ${lvl + 1}`,
      Stats: [
        ["TIME", Fmt.clock(this.timer)],
        ["SETS", String(this.matches)],
        ["STAR TIME", Fmt.clock(par)],
        ["STARS", String(this.Data.get("stars"))],
      ],
      Primary: "NEXT LEVEL",
      Victory: true,
      Reward: () => {
        this.Magics = this.Magics + 1;
        this.Data.flush();
        this.UI.Toast("+1 MAGIC", 2);
        Sfx.play(Snd.PowerUp, 0.8);
      },
      RewardLabel: "GET A FREE MAGIC (WATCH AD)",
    }));
  }

  private Lose() {
    this.Finish(new Result({
      Headline: "TRAY FULL",
      HeadlineColor: Pal.hex(0xffc2c8),
      Value: `${this.boardCount}`,
      BestLine: "TILES LEFT IN THE GARDEN",
      Stats: [
        ["LEVEL", String(this.level)],
        ["SETS", String(this.matches)],
        ["TIME", Fmt.clock(this.timer)],
        ["STARS", String(this.Data.get("stars"))],
      ],
      Primary: "TRY AGAIN",
      Reward: this.revived ? null : () => this.Continue(),
      RewardLabel: "SEND 3 TILES BACK & CONTINUE (AD)",
    }));
  }

  private Continue() {
    this.revived = true;
    this.ended = false;
    // return the last three tray tiles to the board
    for (let n = 0; n < 3 && this.trayTiles.length > 0; n++) {
      const t = this.trayTiles[this.trayTiles.length - 1];
      const hi = this.history.indexOf(t);
      if (hi >= 0) this.history.splice(hi, 1);
      this.ReturnToBoard(t);
    }
    this.pointer.reset();
    this.Revive();
    this.UI.Announce("3 SLOTS FREE!", Jade, 1.2);
    Sfx.play(Snd.PowerUp);
  }
}
