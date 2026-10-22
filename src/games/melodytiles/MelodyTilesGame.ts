import {
  ArcadeButton, ArcadeGame, Art, AudioClip, CasualArt, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject, howTo,
  Image, Keyboard, Mathf, Mouse, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom, Text, TextAnchor,
  Touchscreen, TouchScheme, UIKit, V2, V3, overUI,
} from "../../kit";
import { MelodySongs } from "./MelodySongs";
import { SlicedSprite, slicedSpr } from "./SlicedSprite";

/**
 * MELODY TILES: tap the falling black piano tiles in order to play a famous (public-domain) melody. Long tiles must be
 * held. Missing a tile or tapping an empty spot ends the song. Stars at one, two and three thirds of a song; after
 * that the song loops faster and faster (ENCORE). Stars unlock new songs. A rewarded ad lets you continue once from
 * where you missed. (Port of MelodyTilesGame.cs.)
 */

// ------------------------------------------------------------------ tuning

const BottomBand = 30;
const Lanes = 4, PoolSize = 28;
const MaxSpeed = 8.5;

const Ivory = Pal.hex(0xfbf7ef), Ink = Pal.hex(0x1e2233), Line = new Color(0.12, 0.14, 0.22, 0.12), Gold = Pal.hex(0xffb627), Red = Pal.hex(0xff4d5e);

class TileData {
  Row = 0; Rows = 0; Lane = 0; Pitch = 0; Loop = 0;
  Tapped = false; Holding = false; HoldDone = false; Missed = false;
  HoldId = -99;
  HoldProgress = 0;
}

class TileView {
  Body!: SlicedSprite; Fill!: SlicedSprite; Dot!: SpriteRenderer;
  Data: TileData | null = null;
}

// ------------------------------------------------------------------ art

const TileSprite = () => CasualArt.make("mt-tile", 128, 128, (p) => {
  const px = 2 / 128;
  const d = CasualArt.sdBox(p, new V2(0.96, 0.96), 0.22);
  const a = CasualArt.fill(d, px);
  let c = Color.lerp(Pal.hex(0x2a2f45), Pal.hex(0x10121c), CasualArt.smooth(0.9, -0.9, p.y));
  const sheen = CasualArt.smooth(-0.2, 0.9, p.y) * CasualArt.smooth(0.9, 0.3, Math.abs(p.x)) * 0.12;
  c = Color.lerp(c, Color.white, sheen);
  c = Color.lerp(Pal.hex(0x4a5170), c, CasualArt.fill(d + 0.05, px));
  return c.withAlpha(a);
}, 40, 128);

const FillSprite = () => CasualArt.make("mt-fill", 64, 64, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.94, 0.94), 0.3);
  return new Color(1, 1, 1, CasualArt.fill(d, 2 / 64));
}, 22, 64);

const TileIcon = () => CasualArt.make("mt-icon", 64, 96, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.8, 1.3), 0.25);
  return new Color(0.1, 0.11, 0.17, CasualArt.fill(d, 2 / 64));
});

const NoteGlyph = () => CasualArt.make("mt-note", 64, 64, (p) => {
  const px = 2 / 64;
  const head = new V2((p.x + 0.25) / 1.25, p.y + 0.5).magnitude - 0.26;
  const stem = CasualArt.sdBox(p.sub(new V2(0.06, 0.1)), new V2(0.06, 0.6), 0.02);
  const flag = CasualArt.sdSegment(p, new V2(0.08, 0.68), new V2(0.45, 0.3)) - 0.08;
  const d = Math.min(head, Math.min(stem, flag));
  return new Color(1, 1, 1, CasualArt.fill(d, px));
});

const Staff = () => CasualArt.make("mt-staff", 64, 256, (p) => {
  // five thin lines near the middle of a 4-unit-tall strip
  let a = 0;
  for (let i = 0; i < 5; i++) a = Math.max(a, CasualArt.fill(Math.abs(p.y - (i - 2) * 0.7) - 0.025, 2 / 64));
  return new Color(1, 1, 1, a);
});

export class MelodyTilesGame extends ArcadeGame {
  // ------------------------------------------------------------------ state

  private world!: GameObject;
  private bgCover!: SpriteRenderer;
  private laneLines: SpriteRenderer[] = [];
  private staves: SpriteRenderer[] = [];
  private views: TileView[] = new Array<TileView>(PoolSize);
  private tiles: TileData[] = [];
  private pitches: number[] = [];
  private beats: number[] = [];
  private notes = new Map<number, AudioClip>();
  private missFlash!: SlicedSprite;
  private fx!: CasualFx;

  private boardLeft = 0; private laneW = 0; private rowH = 0; private hitY = 0; private boardTop = 0;
  private songIndex = 0; private songLen = 0; private loopRows = 0; private nextIndex = 0; private score = 0; private tapsLoop0 = 0; private loop = 0;
  private songRow = 0; private speed = 0; private failTimer = 0; private attractRow = 0;
  private started = false; private failing = false; protected finished = false; /* set but never read, as in the C# */ private revived = false; private usingTouch = false;
  private lastLane = -1; private builtLoops = 0;
  private rng = new SysRandom();
  private tapLabel: Text | null = null;

  // HUD
  private scoreText!: Text; private songText!: Text; private speedText!: Text;
  private progressFill!: Image;
  private starIcons: Image[] = new Array<Image>(3);
  // title song picker
  private pickTitle: Text | null = null; private pickInfo: Text | null = null;
  private pickPrev: ArcadeButton | null = null; private pickNext: ArcadeButton | null = null;

  private missClip!: AudioClip;

  // ------------------------------------------------------------------ describe

  protected Describe() {
    return new GameInfo({
      Id: "melodytiles",
      Title: "MELODY TILES",
      Tagline: "TAP THE TILES. PLAY THE SONG.",
      Accent: Pal.hex(0x6c7bff),
      Accent2: Gold,
      BgTop: Ivory,
      BgBottom: Pal.hex(0xede6da),
      ShortSide: 9,
      Touch: TouchScheme.None,
      Music: { bpm: 84, rootHz: 130.8, degrees: [0, 5, 3, 4], seed: 19, energy: 0.3, major: true },
      Reminders: [
        "The piano is waiting|Play your favourite melody again.",
        "A new song is close|Earn a few more stars to unlock it.",
        "Encore!|How fast can your fingers go today?",
      ],
      HowTo: [
        howTo(TileIcon(), Color.white, "TAP the black tiles from the bottom up. Each tile plays the next note of the song."),
        howTo(TileIcon(), Pal.hex(0x6c7bff), "LONG tiles: keep your finger down until the tile has passed."),
        howTo(Art.Diamond, Red, "Don't let a tile slip past the bottom, and don't tap the empty white spaces!"),
        howTo(Art.Star, Gold, "Earn up to 3 stars per song. Stars unlock new songs."),
        howTo(Art.Chevron, Pal.hex(0x6c7bff), "Finish the song and it plays again, faster: ENCORE!"),
        howTo(Art.Square, Ink, "Keyboard: D F J K for the four lanes."),
      ],
      Tips: [
        "Use two thumbs: one for the left lanes, one for the right.",
        "Look ahead at the next tile, not the one you are tapping.",
        "Long tiles give bonus points if you hold them all the way.",
        "Every song in the book is a classic that's free for everyone to play.",
        "Slow songs are the best way to earn the first stars.",
      ],
    });
  }

  protected get ShortSide() { return Screen.width > Screen.height ? 9 : 8; }

  private get TotalStars() { return this.Data.get("stars"); }
  private static UnlockStars(i: number) { return i < 2 ? 0 : (i - 1) * 2 + 1; }
  private Unlocked(i: number) { return this.TotalStars >= MelodyTilesGame.UnlockStars(i); }

  protected BestLine() {
    const s = MelodySongs.All[this.songIndex];
    const best = this.Data.get("best" + this.songIndex);
    return best > 0 ? `${s.Title}   ·   BEST ${Fmt.n(best)}` : s.Title;
  }

  protected StatsLine() { return `${this.TotalStars} STARS   ·   ${this.UnlockedCount()}/${MelodySongs.All.length} SONGS   ·   ${Fmt.n(this.Data.get("tiles"))} TILES PLAYED`; }

  private UnlockedCount() {
    let n = 0;
    for (let i = 0; i < MelodySongs.All.length; i++) if (this.Unlocked(i)) n++;
    return n;
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("MelodyWorld", this.gameObject);
    CasualLook.calm(this, 1.25, 0.12);
    this.bgCover = CasualLook.cover(this.world, CasualArt.gradient(Ivory, Pal.hex(0xede4d3)), -910);

    for (let i = 0; i < 3; i++)
      this.staves.push(Art.spr(this.world, "Staff", Staff(), new Color(0.3, 0.35, 0.6, 0.08), 1, -905, Art.Flat));
    for (let i = 0; i <= Lanes; i++)
      this.laneLines.push(Art.spr(this.world, "Lane", Art.Square, Line, 1, -800, Art.Flat));

    for (let i = 0; i < PoolSize; i++) {
      const v = new TileView();
      // Kit gap: SpriteRenderer has no drawMode = Sliced, so the tiles use the local SlicedSprite renderer.
      v.Body = slicedSpr(this.world, "Tile", TileSprite(), Color.white, 1, 10, Art.Flat);
      v.Fill = slicedSpr(this.world, "Fill", FillSprite(), Color.white, 1, 11, Art.Flat);
      v.Dot = Art.spr(this.world, "Dot", CasualArt.Dot, Color.white, 0.4, 12, Art.Flat);
      v.Body.gameObject.setActive(false);
      v.Fill.gameObject.setActive(false);
      v.Dot.gameObject.setActive(false);
      this.views[i] = v;
    }
    this.missFlash = slicedSpr(this.world, "Miss", FillSprite(), Red, 1, 20, Art.Flat);
    this.missFlash.gameObject.setActive(false);

    this.fx = CasualFx.create(this.world, 40);
    const noise = new SysRandom(5);
    this.missClip = Sfx.make("mt-miss", 0.5, (t) =>
      (Sfx.sinP(110 * t) + Sfx.sinP(116.5 * t) + Sfx.sinP(155.6 * t) + (noise.nextDouble() * 2 - 1) * 0.3 * Sfx.env(t, 0.001, 0.04)) * Sfx.env(t, 0.003, 0.4) * 0.18);

    this.songIndex = Mathf.clamp(this.Data.get("song"), 0, MelodySongs.All.length - 1);
    if (!this.Unlocked(this.songIndex)) this.songIndex = 0;
    this.BuildHud();
    this.Layout();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.scoreText = UIKit.at(UIKit.label(hud, "0", 96, Red), new V2(0.5, 1), new V2(0, -86), new V2(500, 110));
    UIKit.glow(this.scoreText, Color.white, 4);
    const [bar, fill] = UIKit.meter(hud, new V2(0.5, 1), new V2(0, -160), new V2(620, 16), Gold);
    this.progressFill = fill;
    const bg = bar.getComponent(Image);
    if (bg) bg.color = new Color(0, 0, 0, 0.15);
    for (let i = 0; i < 3; i++) {
      this.starIcons[i] = UIKit.img(bar, "Star", Art.Star, new Color(0, 0, 0, 0.2));
      this.starIcons[i].rectTransform.place(new V2((i + 1) / 3, 0.5), V2.zero, new V2(46, 46));
    }
    this.songText = UIKit.at(UIKit.label(hud, "", 26, Ink.withAlpha(0.8)), new V2(0.5, 1), new V2(0, -200), new V2(700, 36));
    this.speedText = UIKit.at(UIKit.label(hud, "", 26, Ink.withAlpha(0.7), TextAnchor.MiddleLeft), new V2(0, 1), new V2(150, -86), new V2(240, 40));

    const tapRt = UIKit.node("TapHint", hud).place(new V2(0.5, 0), new V2(0, 300), new V2(600, 80));
    this.tapLabel = UIKit.label(tapRt, "TAP THE FIRST TILE", 40, Ink);
    this.tapLabel.rectTransform.stretch();
    UIKit.glow(this.tapLabel, Color.white, 3);

    if (this.UI.TitleExtra) {
      CasualLook.titleCard(this.UI, new Color(0.13, 0.14, 0.24, 0.9));
      const plate = UIKit.img(this.UI.TitleExtra, "SongPlate", Art.UiRound, new Color(1, 1, 1, 0.12));
      plate.rectTransform.place(UIKit.Center, V2.zero, new V2(640, 110));
      this.pickTitle = UIKit.at(UIKit.label(plate.rectTransform, "", 34, Color.white), UIKit.Center, new V2(0, 16), new V2(600, 46));
      CasualLook.fit(this.pickTitle, 20);
      this.pickInfo = UIKit.at(UIKit.label(plate.rectTransform, "", 24, Gold), UIKit.Center, new V2(0, -28), new V2(600, 34));
      this.pickPrev = UIKit.buttonAt(this.UI.TitleExtra, "<", UIKit.Center, new V2(-410, 0), new V2(120, 100), false, () => this.PickSong(-1), 50);
      this.pickNext = UIKit.buttonAt(this.UI.TitleExtra, ">", UIKit.Center, new V2(410, 0), new V2(120, 100), false, () => this.PickSong(1), 50);
      this.pickPrev.setAccent(Pal.hex(0x6c7bff));
      this.pickNext.setAccent(Pal.hex(0x6c7bff));
      this.RefreshPicker();
    }
  }

  private PickSong(dir: number) {
    const n = MelodySongs.All.length;
    this.songIndex = (this.songIndex + dir + n) % n;
    Sfx.play(Snd.Click, 0.6);
    if (this.Unlocked(this.songIndex)) this.Data.set("song", this.songIndex);
    this.RefreshPicker();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
    this.PreviewSong();
  }

  private RefreshPicker() {
    if (!this.pickTitle || !this.pickInfo) return;
    const s = MelodySongs.All[this.songIndex];
    const open = this.Unlocked(this.songIndex);
    this.pickTitle.text = (open ? "" : "LOCKED · ") + s.Title;
    const st = this.Data.get("s" + this.songIndex);
    this.pickInfo.text = open ? `${s.Composer.toUpperCase()}   ·   ${MelodyTilesGame.StarText(st)}` : `EARN ${MelodyTilesGame.UnlockStars(this.songIndex) - this.TotalStars} MORE STARS TO UNLOCK`;
    this.pickInfo.color = open ? Gold : Pal.hex(0xff9aa8);
  }

  private static StarText(stars: number) { return stars <= 0 ? "NO STARS YET" : stars === 1 ? "1 STAR" : stars + " STARS"; }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.Fx.CameraTarget = V2.zero;
    CasualLook.fitCover(this.bgCover, this.ViewSize);
    const rect = this.PlayRect(0, BottomBand, 0);
    const boardW = Math.min(this.ViewSize.x, this.ViewSize.y * 0.66);
    this.laneW = boardW / Lanes;
    this.rowH = this.laneW * 1.55;
    this.boardLeft = -boardW * 0.5;
    this.hitY = rect.yMin;
    this.boardTop = this.ViewSize.y * 0.5;

    for (let i = 0; i <= Lanes; i++) {
      const l = this.laneLines[i];
      l.transform.localScale = new V3(0.025, this.ViewSize.y + 1, 1);
      l.transform.localPosition = new V3(this.boardLeft + i * this.laneW, 0, 0);
    }
    for (const st of this.staves) st.transform.localScale = new V3(this.ViewSize.x + 1, 1, 1);
  }

  // ------------------------------------------------------------------ song building

  private LoadSong(index: number) {
    this.songIndex = index;
    const s = MelodySongs.All[index];
    MelodySongs.Parse(s, this.pitches, this.beats);
    this.songLen = this.pitches.length;
    this.loopRows = 0;
    for (let i = 0; i < this.songLen; i++) this.loopRows += MelodyTilesGame.RowsFor(this.beats[i]);
    this.tiles = [];
    this.builtLoops = 0;
    this.lastLane = -1;
    this.rng = new SysRandom(index * 31 + 7);
    this.AppendLoop();
    this.AppendLoop();
    for (const p of this.pitches) this.NoteClip(p);
  }

  private static RowsFor(len: number) { return len < 1 ? 1 : Mathf.roundToInt(len * 2); }

  private AppendLoop() {
    let row = this.builtLoops * this.loopRows + 1; // first tile one row above the bottom
    for (let i = 0; i < this.songLen; i++) {
      const rows = MelodyTilesGame.RowsFor(this.beats[i]);
      let lane = this.rng.next(Lanes);
      if (lane === this.lastLane) lane = (lane + 1 + this.rng.next(Lanes - 1)) % Lanes;
      this.lastLane = lane;
      const t = new TileData();
      t.Row = row; t.Rows = rows; t.Lane = lane; t.Pitch = this.pitches[i]; t.Loop = this.builtLoops; t.HoldId = -99;
      this.tiles.push(t);
      row += rows;
    }
    this.builtLoops++;
  }

  private NoteClip(midi: number) {
    const cached = this.notes.get(midi);
    if (cached) return cached;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const decay = Mathf.lerp(1.6, 3.2, Mathf.inverseLerp(48, 84, midi));
    const amp = [1, 0.5, 0.28, 0.16, 0.09, 0.05];
    const noise = new SysRandom(midi);
    const c = Sfx.make("mt-n" + midi, 1.5, (t) => {
      let v = 0;
      for (let k = 0; k < amp.length; k++) {
        const fk = f * (k + 1) * (1 + 0.0004 * (k + 1) * (k + 1));
        v += amp[k] * Math.sin(2 * Math.PI * fk * t) * Math.exp(-t * decay * (1 + 0.6 * k));
      }
      const hammer = (noise.nextDouble() * 2 - 1) * Math.exp(-t * 300) * 0.25;
      return (v * Math.min(1, t / 0.004) + hammer) * 0.26;
    });
    this.notes.set(midi, c);
    return c;
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.SetMusicMuted(false);
    if (!this.Unlocked(this.songIndex)) this.songIndex = 0;
    this.RefreshPicker();
    this.PreviewSong();
  }

  private PreviewSong() {
    this.LoadSong(this.songIndex);
    this.attractRow = -1.5;
    this.nextIndex = 0;
    this.failing = this.finished = false;
    this.missFlash.gameObject.setActive(false);
    if (this.tapLabel) this.tapLabel.text = "";
  }

  protected BeginRun() {
    if (!this.Unlocked(this.songIndex)) this.songIndex = 0;
    this.Data.set("song", this.songIndex);
    this.LoadSong(this.songIndex);
    this.Layout();
    this.SetMusicMuted(true);
    const s = MelodySongs.All[this.songIndex];
    this.speed = s.Speed;
    this.songRow = 0;
    this.nextIndex = 0;
    this.score = this.tapsLoop0 = this.loop = 0;
    this.started = this.failing = this.finished = this.revived = false;
    this.missFlash.gameObject.setActive(false);
    this.fx.clear();
    this.tapLabel!.text = "TAP THE FIRST TILE";
    MelodyTilesGame.SetText(this.songText, `${s.Title} · ${s.Composer.toUpperCase()}`);
    this.Data.add("runs", 1);
    Sfx.setIntensity(0);
    this.UpdateHud();
  }

  private SetMusicMuted(muted: boolean) {
    Sfx.setMusicMuted(muted);
  }

  onDestroy() {
    this.SetMusicMuted(false);
    super.onDestroy();
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.State === Phase.Title) {
      // Attract: tiles glide down and "play" themselves silently.
      this.attractRow += dt * 2.2;
      while (this.nextIndex < this.tiles.length && this.tiles[this.nextIndex].Row + 0.2 < this.attractRow) {
        this.tiles[this.nextIndex].Tapped = true;
        this.nextIndex++;
      }
      if (this.nextIndex >= this.tiles.length - this.songLen) this.AppendLoop();
      this.Present(this.attractRow);
    } else this.Present(this.songRow);
  }

  protected TickRun(dt: number) {
    if (this.failing) {
      this.failTimer += dt;
      const blink = Mathf.repeat(this.failTimer * 5, 1) < 0.55 ? 1 : 0.35;
      this.missFlash.color = Red.withAlpha(0.9 * blink);
      this.Present(this.songRow);
      if (this.failTimer > 1.1 && this.State === Phase.Playing) this.Lose();
      return;
    }

    this.ReadPresses();
    if (this.started) {
      const progress = Mathf.clamp01((this.songRow - this.loop * this.loopRows) / Math.max(1, this.loopRows));
      const target = Math.min(MaxSpeed, MelodySongs.All[this.songIndex].Speed * (1 + 0.14 * this.loop) * (1 + progress * 0.12));
      this.speed = Mathf.moveTowards(this.speed, target, dt * 0.5);
      this.songRow += this.speed * dt;
      this.UpdateHolds();
      this.CheckMiss();
    }
    if (this.nextIndex >= this.tiles.length - Math.trunc(this.songLen / 2)) this.AppendLoop();
    this.Present(this.songRow);
    this.UpdateHud();
  }

  private ReadPresses() {
    for (const t of Touchscreen.touches) {
      if (!t.press.wasPressedThisFrame) continue;
      this.usingTouch = true;
      this.Press(t.position, t.touchId);
    }
    if (!this.usingTouch && Mouse.leftButton.wasPressedThisFrame) this.Press(Mouse.position, -1);

    const kb = Keyboard;
    if (kb.letter("d").wasPressedThisFrame) this.PressLane(0, -10);
    if (kb.letter("f").wasPressedThisFrame) this.PressLane(1, -11);
    if (kb.letter("j").wasPressedThisFrame) this.PressLane(2, -12);
    if (kb.letter("k").wasPressedThisFrame) this.PressLane(3, -13);
  }

  private IsDown(id: number) {
    if (id === -1) return Mouse.leftButton.isPressed;
    if (id <= -10) {
      const kb = Keyboard;
      switch (id) {
        case -10: return kb.letter("d").isPressed;
        case -11: return kb.letter("f").isPressed;
        case -12: return kb.letter("j").isPressed;
        default: return kb.letter("k").isPressed;
      }
    }
    for (const t of Touchscreen.touches)
      if (t.touchId === id && t.press.isPressed) return true;
    return false;
  }

  private Press(screen: V2, id: number) {
    if (overUI(screen)) return;
    const w = this.ScreenToWorld(screen);
    if (w.x < this.boardLeft || w.x > this.boardLeft + this.laneW * Lanes) return;
    if (screen.y > Screen.height * 0.9) return; // HUD band
    const lane = Mathf.clamp(Math.floor((w.x - this.boardLeft) / this.laneW), 0, Lanes - 1);
    const frac = (w.x - this.boardLeft) / this.laneW - lane;

    const next = this.tiles[this.nextIndex];
    const bottom = this.TileBottom(next, this.songRow), top = bottom + next.Rows * this.rowH;
    const laneOk = lane === next.Lane
      || (frac < 0.15 && lane - 1 === next.Lane)
      || (frac > 0.85 && lane + 1 === next.Lane);
    if (laneOk && w.y <= top + this.rowH * 0.35) {
      this.Hit(next, id);
      return;
    }
    // pressing on a later tile is ignored (no penalty); an empty spot is a miss
    for (let i = this.nextIndex + 1; i < Math.min(this.tiles.length, this.nextIndex + 8); i++) {
      const t = this.tiles[i];
      const b = this.TileBottom(t, this.songRow);
      if (t.Lane === lane && w.y >= b - 0.1 && w.y <= b + t.Rows * this.rowH + 0.1) return;
    }
    if (!this.started) return; // before the first tap nothing can go wrong
    this.Fail(lane, w.y);
  }

  private PressLane(lane: number, id: number) {
    const next = this.tiles[this.nextIndex];
    if (next.Lane === lane) this.Hit(next, id);
    else if (this.started) {
      const y = this.hitY + this.rowH * 0.5;
      this.Fail(lane, y);
    }
  }

  private TileBottom(t: TileData, row: number) { return this.hitY + (t.Row - row) * this.rowH; }

  private Hit(t: TileData, id: number) {
    if (!this.started) {
      this.started = true;
      this.tapLabel!.text = "";
    }
    t.Tapped = true;
    this.nextIndex++;
    this.score++;
    if (t.Loop === 0) this.tapsLoop0++;
    Sfx.playClip(this.NoteClip(t.Pitch), 0.9);
    const c = new V2(this.boardLeft + (t.Lane + 0.5) * this.laneW, Math.max(this.hitY + this.rowH * 0.5, this.TileBottom(t, this.songRow) + this.rowH * 0.5));
    const hue = Pal.hex(MelodySongs.All[this.songIndex].Hue);
    this.fx.pop(c, hue, 8, 3, 0.18, 0.35);
    this.fx.emit(c, new V2((this.rng.nextDouble() - 0.5) * 1.2, 2.4), hue, 0.45, 0.9, NoteGlyph(), 0, (this.rng.nextDouble() - 0.5) * 90, false, 0.6);
    if (t.Rows > 1) {
      t.Holding = true;
      t.HoldId = id;
    }
    // Star milestones on the first time through
    if (t.Loop === 0) {
      const stars = this.StarsFor(this.tapsLoop0);
      const before = this.StarsFor(this.tapsLoop0 - 1);
      if (stars > before) {
        Sfx.play(Snd.Coin, 0.6, 1 + stars * 0.1);
        this.fx.sparkle(new V2(0, this.ViewSize.y * 0.5 - 2), Gold, 10, 1.5, 0.45);
        if (stars === 3) this.UI.Announce("SONG COMPLETE!", Gold, 1.6);
      }
    }
    const idx = this.nextIndex - 1;
    if (idx > 0 && idx % this.songLen === 0) {
      this.loop = Math.trunc(idx / this.songLen);
      this.UI.Announce(this.loop === 1 ? "ENCORE!" : `ENCORE x${this.loop}!`, Pal.hex(0x6c7bff), 1.4);
      Sfx.play(Snd.PowerUp, 0.5);
    }
  }

  private StarsFor(taps: number) {
    const n = this.songLen;
    return taps >= n ? 3 : taps >= Math.trunc((n * 2) / 3) ? 2 : taps >= Math.trunc(n / 3) ? 1 : 0;
  }

  private UpdateHolds() {
    for (let i = Math.max(0, this.nextIndex - 6); i < this.nextIndex; i++) {
      const t = this.tiles[i];
      if (!t.Holding) continue;
      t.HoldProgress = Mathf.clamp01((this.songRow - t.Row + 0.3) / t.Rows);
      if (!this.IsDown(t.HoldId)) {
        t.Holding = false;
        continue;
      }
      if (t.HoldProgress >= 1) {
        t.Holding = false;
        t.HoldDone = true;
        const bonus = t.Rows - 1;
        this.score += bonus;
        const c = new V2(this.boardLeft + (t.Lane + 0.5) * this.laneW, this.hitY + this.rowH * 0.6);
        this.UI.Float(c, "+" + bonus, Pal.hex(0x6c7bff), 0.9);
        this.fx.sparkle(c, Pal.hex(MelodySongs.All[this.songIndex].Hue), 5, 0.4, 0.3);
      }
    }
  }

  private CheckMiss() {
    const next = this.tiles[this.nextIndex];
    if (this.TileBottom(next, this.songRow) < this.hitY - this.rowH * 0.05) {
      // scroll back so the missed tile is visible
      this.songRow = next.Row - 0.35;
      this.Fail(next.Lane, this.TileBottom(next, this.songRow) + this.rowH * 0.5, next);
    }
  }

  private Fail(lane: number, y: number, missed: TileData | null = null) {
    this.failing = true;
    this.failTimer = 0;
    const bottom = missed ? this.TileBottom(missed, this.songRow) : this.hitY + Math.floor((y - this.hitY) / this.rowH + 0.0001) * this.rowH;
    const h = missed ? missed.Rows * this.rowH : this.rowH;
    if (missed) missed.Missed = true;
    this.missFlash.gameObject.setActive(true);
    this.missFlash.size = new V2(this.laneW - 0.06, h - 0.06);
    this.missFlash.transform.localPosition = new V3(this.boardLeft + (lane + 0.5) * this.laneW, bottom + h * 0.5, 0);
    Sfx.playClip(this.missClip, 0.9);
    this.Fx.shake(0.25);
    Fx.haptic(true);
    for (const t of this.tiles) t.Holding = false;
  }

  // ------------------------------------------------------------------ presentation

  private Present(row: number) {
    const off = Mathf.repeat(row * this.rowH * 0.3, 4);
    for (let i = 0; i < this.staves.length; i++)
      this.staves[i].transform.localPosition = new V3(0, -this.ViewSize.y * 0.5 + i * 4 + 2 - off, 0);

    const hue = Pal.hex(MelodySongs.All[this.songIndex].Hue);
    const laneW = this.laneW;
    let vi = 0;
    const start = Math.max(0, this.nextIndex - 8);
    for (let i = start; i < this.tiles.length && vi < PoolSize; i++) {
      const t = this.tiles[i];
      const bottom = this.TileBottom(t, row);
      if (bottom > this.boardTop + 0.5) break;
      const h = t.Rows * this.rowH;
      if (bottom + h < -this.ViewSize.y * 0.5 - 0.5) continue;
      const v = this.views[vi++];
      v.Data = t;
      const x = this.boardLeft + (t.Lane + 0.5) * laneW;
      v.Body.gameObject.setActive(true);
      v.Body.size = new V2(laneW - 0.05, h - 0.05);
      v.Body.transform.localPosition = new V3(x, bottom + h * 0.5, 0);
      const tapped = t.Tapped;
      if (tapped) {
        const fade = Mathf.clamp01((row - t.Row) * 0.6);
        v.Body.color = Color.lerp(new Color(0.55, 0.58, 0.7, 0.55), new Color(0.75, 0.77, 0.85, 0.25), fade);
      } else v.Body.color = Color.white;

      const hold = t.Rows > 1;
      v.Fill.gameObject.setActive(hold);
      v.Dot.gameObject.setActive(hold && !t.HoldDone);
      if (hold) {
        const prog = t.HoldDone ? 1 : t.HoldProgress;
        const fh = Math.max(0.12, (h - 0.2) * prog);
        v.Fill.size = new V2(laneW * 0.32, Math.max(0.1, h - 0.2));
        v.Fill.color = hue.withAlpha(0.25);
        v.Fill.transform.localPosition = new V3(x, bottom + h * 0.5, 0);
        if (tapped) {
          v.Fill.size = new V2(laneW * 0.32, fh);
          v.Fill.transform.localPosition = new V3(x, bottom + 0.1 + fh * 0.5, 0);
          v.Fill.color = hue;
        }
        v.Dot.transform.localPosition = new V3(x, bottom + 0.1 + (tapped ? fh : 0.2), 0);
        v.Dot.color = tapped ? Color.white : hue;
        const ds = laneW * 0.32;
        v.Dot.transform.localScale = new V3(ds, ds, 1);
      }
    }
    for (; vi < PoolSize; vi++) {
      this.views[vi].Body.gameObject.setActive(false);
      this.views[vi].Fill.gameObject.setActive(false);
      this.views[vi].Dot.gameObject.setActive(false);
    }
  }

  private UpdateHud() {
    MelodyTilesGame.SetText(this.scoreText, String(this.score));
    const k = Mathf.clamp01(this.tapsLoop0 / Math.max(1, this.songLen));
    UIKit.setMeter(this.progressFill, k);
    const stars = this.StarsFor(this.tapsLoop0);
    for (let i = 0; i < 3; i++) this.starIcons[i].color = i < stars ? Gold : new Color(0, 0, 0, 0.2);
    MelodyTilesGame.SetText(this.speedText, this.loop > 0 ? `ENCORE x${this.loop}` : "");
  }

  private static SetText(t: Text | null, s: string) {
    if (t && t.text !== s) t.text = s;
  }

  // ------------------------------------------------------------------ results

  private Lose() {
    const stars = this.StarsFor(this.tapsLoop0);
    const prev = this.Data.get("s" + this.songIndex);
    const openBefore = this.UnlockedCount();
    if (stars > prev) {
      this.Data.set("s" + this.songIndex, stars);
      this.Data.add("stars", stars - prev);
    }
    const newBest = this.Data.max("best" + this.songIndex, this.score);
    this.Data.add("tiles", this.score);
    const newSong = this.UnlockedCount() > openBefore ? this.UnlockedCount() - 1 : -1;
    const s = MelodySongs.All[this.songIndex];
    this.Finish(new Result({
      Headline: this.loop > 0 ? "ENCORE!" : stars >= 3 ? "BRAVO!" : stars > 0 ? "WELL PLAYED!" : "OOPS!",
      HeadlineColor: stars > 0 ? Gold : Pal.hex(0xffb0b8),
      Stars: stars,
      Value: String(this.score),
      NewBest: newBest,
      BestLine: newSong >= 0 ? `NEW SONG UNLOCKED: ${MelodySongs.All[newSong].Title}` : s.Title,
      Stats: [
        ["TILES", String(this.score)],
        ["SONG", Mathf.roundToInt(Mathf.clamp01(this.tapsLoop0 / Math.max(1, this.songLen)) * 100) + "%"],
        ["ENCORES", String(this.loop)],
        ["BEST", String(this.Data.get("best" + this.songIndex))],
      ],
      Primary: "PLAY AGAIN",
      Victory: stars >= 3,
      Reward: this.revived ? null : () => this.Continue(),
      RewardLabel: "KEEP PLAYING (WATCH AD)",
    }));
    this.RefreshPicker();
  }

  private Continue() {
    this.revived = true;
    this.failing = false;
    this.missFlash.gameObject.setActive(false);
    const next = this.tiles[this.nextIndex];
    next.Missed = false;
    this.songRow = next.Row - 1.5;
    this.speed = Math.max(MelodySongs.All[this.songIndex].Speed, this.speed * 0.85);
    this.started = false;
    this.tapLabel!.text = "TAP TO CONTINUE";
    this.Revive();
    this.SetMusicMuted(true);
  }
}
