import {
  AdService, ArcadeButton, ArcadeGame, Art, AudioClip, Camera, CasualFx, CasualLook, Color, Fmt, Fx, GameInfo, GameObject, howTo,
  Image, Keyboard, LineRenderer, Mathf, Mesh, MeshRenderer, Mouse, Pal, Phase, Result, Screen, Sfx, Snd, SpriteRenderer, SysRandom,
  Text, TextAnchor, TextMesh, Time, Touchscreen, TouchScheme, UI, UIKit, UINode, V2, V3, CanvasGroup, overUI, dp,
} from "../../kit";
import { TowerArt } from "./TowerArt";
import { Bot, BotNames, Sim, Tower } from "./TowerSim";
import { buildMap, campaignSpec, LevelSpec, MapDef, MapH, MapW, Play, quickSpec } from "./TowerMaps";

/**
 * TOWER CONQUEST: send troops, capture towers, grow your empire. One shared, fog-free map split into territories.
 * Drag from your tower to any tower to send troops (drag through several of your towers to send from all of them,
 * or tap a tower and then a target). A tower falls when the troops sent beat its garrison, then it makes troops for
 * you. Outposts, keeps and fortresses differ in garrison, production and capacity. Most towers at the buzzer wins.
 * Modes: a generated campaign (solo clear-the-map, duels and four-empire free-for-alls, with stars), quick battles
 * vs the computer (easy / medium / hard), a free-for-all against three empires and 2 players on one shared board
 * (each player drags from their own towers, multi-touch). RALLY gives +20 troops to every tower you own.
 */

const hex = (v: number) => Pal.hex(v);
const Colors = [hex(0x3d8bff), hex(0xff4f5e), hex(0xffb31f), hex(0xa463ff)];
const Names = ["BLUE", "RED", "GOLD", "VIOLET"];
const NeutralPaint = hex(0xc3c9d1);
const NeutralCell = hex(0xd9efc6);
const NeutralPill = hex(0x667080);
const PlateTop = hex(0xfffaf0), PlateSide = hex(0x8c6a46);
const Gold = hex(0xffc93c), Ink = hex(0x1b2742), Green = hex(0x46c37b);
const ModeNames = ["CAMPAIGN", "VS CPU", "FREE-FOR-ALL", "2 PLAYERS"];
const PlayTags = ["SOLO", "DUEL", "FFA", "2P"];
const TowerSize = [0.98, 1.2, 1.5];
const RallyCost = 120, RallyMax = 2, RallyAmount = 20;
const ReviveTime = 30;

enum Mode { Campaign, VsCpu, FFA, TwoP }

class TowerView {
  root!: GameObject;
  stone!: SpriteRenderer;
  paint!: SpriteRenderer;
  pill!: SpriteRenderer;
  label!: TextMesh;
  ring!: SpriteRenderer;
  target!: SpriteRenderer;
  cell!: MeshRenderer;
  cellColor = NeutralCell;
  shownOwner = -2;
  size = 1;
  pop = 0;
  hit = 0;
  text = "";
  constructor(readonly t: Tower) {}
}

interface Drag { id: number; owner: number; sources: Tower[]; m: V2; startScreen: V2; start: Tower; moved: boolean; hover: Tower | null }

// ------------------------------------------------------------------ geometry helpers

function roundRect(hw: number, hh: number, r: number, steps = 6): V2[] {
  const pts: V2[] = [];
  const corners = [[hw - r, -hh + r, -90], [hw - r, hh - r, 0], [-hw + r, hh - r, 90], [-hw + r, -hh + r, 180]];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= steps; i++) {
      const a = (a0 + (90 * i) / steps) * Mathf.Deg2Rad;
      pts.push(new V2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  return pts;
}

/** Keeps the part of a convex polygon on the side of the line through `m` where (p - m)·n <= 0. */
function clipHalf(poly: V2[], m: V2, n: V2): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = V2.dot(a.sub(m), n), db = V2.dot(b.sub(m), n);
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) out.push(V2.lerpUnclamped(a, b, da / (da - db)));
  }
  return out;
}

/** Offsets a convex CCW polygon inwards by g. */
function inset(poly: V2[], g: number): V2[] {
  const n = poly.length;
  if (n < 3) return poly;
  const lines: [V2, V2][] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const d = b.sub(a).normalized;
    const nn = new V2(-d.y, d.x);
    lines.push([a.add(nn.mul(g)), d]);
  }
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const [p1, d1] = lines[(i + n - 1) % n], [p2, d2] = lines[i];
    const den = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(den) < 1e-4) { out.push(p2); continue; }
    const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
    out.push(p1.add(d1.mul(t)));
  }
  return out;
}

function polyMesh(poly: V2[], centerShade = 1, edgeShade = 0.86): Mesh {
  const m = new Mesh();
  let c = V2.zero;
  for (const p of poly) c = c.add(p);
  c = c.div(Math.max(1, poly.length));
  m.vertices = [c.toV3(), ...poly.map((p) => p.toV3())];
  m.colors = [new Color(centerShade, centerShade, centerShade, 1), ...poly.map(() => new Color(edgeShade, edgeShade, edgeShade, 1))];
  for (let i = 0; i < poly.length; i++) m.triangles.push(0, 1 + i, 1 + ((i + 1) % poly.length));
  return m;
}

export class TowerConquestGame extends ArcadeGame {
  private world!: GameObject;
  private mapRoot!: GameObject;
  private cover!: SpriteRenderer;
  private fx!: CasualFx;
  private rng = new SysRandom();

  private sim: Sim = new Sim(1);
  private map: MapDef | null = null;
  private spec: LevelSpec = campaignSpec(1);
  private bots: Bot[] = [];
  private humans: boolean[] = [];
  private views: TowerView[] = [];
  private unitPool: SpriteRenderer[] = [];
  private lines: LineRenderer[] = [];
  private lineShadows: LineRenderer[] = [];
  private arrows: SpriteRenderer[] = [];
  private tutorialLine!: LineRenderer;
  private tutorialArrow!: SpriteRenderer;
  private drags = new Map<number, Drag>();
  private tapSel: Tower[][] = [[], [], [], []];
  private rot = false;
  private builtRot: boolean | null = null;

  private mode = Mode.Campaign;
  private diff = 1;
  private playLevel = 1;
  private timeBonus = 0;
  private ended = false;
  private endTimer = 0;
  private outcome = 0; // 1 win, -1 loss
  private winner = -1;
  private revived = false;
  private rallyUsed = 0;
  private humanSent = false;
  private lastTick = -1;
  private attractTimer = 0;
  private sfxGate = 0;
  private clashGate = 0;

  // HUD
  private timerText!: Text;
  private timerPill!: Image;
  private levelText!: Text;
  private subText!: Text;
  private barSegs: Image[] = [];
  private barBack!: UINode;
  private rallyButton!: ArcadeButton;
  private sendButton!: ArcadeButton;
  private tutText!: Text;
  private modeButton!: ArcadeButton;
  private optButton!: ArcadeButton;
  private titleInfo!: Text;

  // level map
  private mapLayer!: CanvasGroup;
  private mapPage = 0;
  private mapCells: { button: ArcadeButton; num: Text; tag: Text; stars: Image[] }[] = [];
  private mapTitle!: Text;
  private mapPageText!: Text;

  private sendClip!: AudioClip; private captureClip!: AudioClip; private lostClip!: AudioClip; private selectClip!: AudioClip;
  private thudClip!: AudioClip; private clashClip!: AudioClip; private rallyClip!: AudioClip;

  protected Describe() {
    return new GameInfo({
      Id: "towerconquest",
      Title: "TOWER CONQUEST",
      Tagline: "SEND TROOPS. CAPTURE TOWERS. GROW YOUR EMPIRE.",
      PlayLabel: "PLAY",
      Accent: Colors[0],
      Accent2: Gold,
      BgTop: hex(0x2c86b5),
      BgBottom: hex(0x123e66),
      ShortSide: 16,
      Touch: TouchScheme.None,
      Music: { bpm: 120, rootHz: 110, degrees: [0, 5, 3, 4], seed: 61, energy: 0.6, major: true },
      Reminders: [
        "Your towers are waiting|Grow your empire in Tower Conquest.",
        "A new map to conquer|Can you take every tower before the buzzer?",
        "Rematch?|The red empire is expanding without you.",
      ],
      HowTo: [
        howTo(TowerArt.Paint(1), Colors[0], "DRAG from your BLUE tower to another tower to send troops. Tap a tower, then a target, works too."),
        howTo(TowerArt.Paint(0), Colors[1], "A tower falls when the troops you send beat its garrison. Then it makes troops for you."),
        howTo(TowerArt.Paint(2), Gold, "Outposts need 20 troops, keeps 50, fortresses 100. Bigger towers make more troops."),
        howTo(Art.Chevron, Colors[0], "Drag THROUGH several of your towers to attack with all of them at once."),
        howTo(Art.Ring, Colors[3], "Streams that meet head-on cancel out. Watch your back: rivals attack too!"),
        howTo(Art.Star, Gold, "Most towers at the buzzer wins. Solo levels: take every tower in time."),
        howTo(Art.Plus, Green, "RALLY gives +20 troops to every tower you own. SEND toggles ALL or HALF."),
      ],
      Tips: [
        "Grab the cheap outposts first: every tower you own makes troops.",
        "Do not empty your home tower when a rival is close.",
        "Fortresses are expensive but make troops fast.",
        "Attack a rival tower right after it sends its troops away.",
        "Send to your own towers to build a big strike force at the front.",
      ],
    });
  }

  private get TopBand() { return this.rot ? 175 : 255; }
  private get BottomBand() { return this.rot ? 120 : 205; }

  protected get ShortSide() {
    const rot = Screen.width > Screen.height * 1.05;
    const need = rot ? new V2(MapH + 0.9, MapW + 0.9) : new V2(MapW + 0.7, MapH + 0.9);
    return TowerConquestGame.FitShortSide(need, rot ? 175 : 255, rot ? 120 : 205);
  }

  // ------------------------------------------------------------------ data

  private get Coins() { return this.Data.get("coins", 0); }
  private set Coins(v: number) { this.Data.set("coins", Math.max(0, v)); }
  private get Rally() { return this.Data.get("rally", 2); }
  private set Rally(v: number) { this.Data.set("rally", Math.max(0, v)); }
  private get MaxLevel() { return Math.max(1, this.Data.get("level", 1)); }
  private get Pick() { return Mathf.clamp(this.Data.get("pick", this.MaxLevel), 1, this.MaxLevel); }
  private get SendHalf() { return this.Data.get("half", 0) === 1; }
  private TotalStars() { let s = 0; for (let l = 1; l <= this.MaxLevel; l++) s += this.Data.get("s" + l); return s; }

  protected BestLine() {
    const m = this.Data.get("mode", 0) as Mode;
    if (m === Mode.Campaign) {
      const sp = campaignSpec(this.Pick);
      return `LEVEL ${this.Pick}  ·  ${this.SpecLine(sp)}`;
    }
    if (m === Mode.VsCpu) { const d = this.Data.get("diff", 1); return `VS CPU ${BotNames[d]}:  ${this.Data.get("w" + d)} WON  ·  ${this.Data.get("l" + d)} LOST`; }
    if (m === Mode.FFA) { const d = this.Data.get("diff", 1); return `FREE-FOR-ALL ${BotNames[d]}:  ${this.Data.get("f" + d)} WINS`; }
    return `2 PLAYERS:  BLUE ${this.Data.get("p0")}  –  ${this.Data.get("p1")} RED`;
  }

  protected StatsLine() { return `★ ${this.TotalStars()} STARS   ·   ◉ ${Fmt.n(this.Coins)} COINS   ·   BEST STREAK ${this.Data.get("streakBest")}`; }

  private SpecLine(sp: LevelSpec) {
    if (sp.play === Play.Solo) return "SOLO: TAKE EVERY TOWER";
    if (sp.play === Play.Duel) return `DUEL VS RED (${BotNames[sp.diff]})`;
    if (sp.play === Play.FFA) return `FREE-FOR-ALL (${BotNames[sp.diff]})`;
    return "2 PLAYERS";
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("TowerWorld", this.gameObject);
    CasualLook.calm(this, 1.3, 0.16);
    this.cover = CasualLook.cover(this.world, TowerArt.Water, -910);
    this.mapRoot = new GameObject("Map", this.world);
    this.fx = CasualFx.create(this.world, 70, 260);
    for (let i = 0; i < 24; i++) {
      const sh = Art.line(this.world, "DragShadow", new Color(0, 0, 0, 0.25), 0.22, 49, false, true, Art.Flat);
      const l = Art.line(this.world, "Drag", Color.white, 0.13, 50, false, true, Art.Flat);
      const a = Art.spr(this.world, "Arrow", TowerArt.Arrow, Color.white, 0.42, 51, Art.Flat);
      a.gameObject.setActive(false);
      this.lines.push(l);
      this.lineShadows.push(sh);
      this.arrows.push(a);
    }
    this.tutorialLine = Art.line(this.world, "Tutorial", Color.white, 0.1, 48, false, true, Art.Flat);
    this.tutorialArrow = Art.spr(this.world, "TutArrow", TowerArt.Arrow, Color.white, 0.5, 48, Art.Flat);
    this.tutorialArrow.gameObject.setActive(false);
    this.BuildAudio();
    this.BuildHud();
    this.BuildTitleExtras();
    this.BuildLevelMap();
    this.rot = Screen.width > Screen.height * 1.05;
    this.Layout();
    // the shared logo size overflows for a 14-letter title
    const center = this.UI.TitleExtra?.parent;
    for (const c of center?.children ?? []) if (c.textC && c.textC.text === this.Info.Title) c.textC.fontSize = 104;
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__towerconquest = this;
  }

  /** Test hook (dev only): towers in CSS pixels with owner and troops. */
  testTowers() {
    return this.sim.towers.map((t) => {
      const sp = Camera.worldToScreen(this.toW(t.pos));
      return { id: t.id, x: sp.x / Screen.dpr, y: sp.y / Screen.dpr, owner: t.owner, troops: Math.floor(t.troops), kind: t.kind };
    });
  }
  testSpeed(k: number) { this.SpeedMultiplier = k; }
  testState() { return { state: this.State, time: this.sim.time, left: this.TimeLeft, ended: this.ended, alive: this.sim.alive, units: this.sim.units.filter((u) => u.alive).length }; }

  private BuildAudio() {
    const S = Sfx;
    this.sendClip = S.make("tc-send", 0.16, (t) => (S.sinP(S.glide(t, 380, 900, 0.12)) * 0.6 + S.triP(S.glide(t, 760, 1800, 0.12)) * 0.2) * S.env(t, 0.004, 0.12) * 0.22);
    this.captureClip = S.make("tc-capture", 0.7, (t) => {
      let v = 0;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < notes.length; i++) { const st = t - i * 0.06; if (st > 0) v += (S.sinP(notes[i] * st) + 0.3 * S.triP(notes[i] * 2 * st)) * S.env(st, 0.004, 0.35); }
      return v * 0.09;
    });
    this.lostClip = S.make("tc-lost", 0.5, (t) => (S.sawP(S.glide(t, 330, 110, 0.45)) * 0.3 + S.sinP(S.glide(t, 165, 60, 0.45)) * 0.6) * S.env(t, 0.004, 0.35) * 0.22);
    this.selectClip = S.make("tc-select", 0.07, (t) => S.sinP(S.glide(t, 900, 1300, 0.05)) * S.env(t, 0.002, 0.05) * 0.18);
    const rng = new SysRandom(9);
    this.thudClip = S.make("tc-thud", 0.08, (t) => (S.sinP(S.glide(t, 220, 90, 0.07)) * 0.7 + (rng.nextDouble() * 2 - 1) * 0.3) * S.env(t, 0.001, 0.05) * 0.16);
    this.clashClip = S.make("tc-clash", 0.06, (t) => (rng.nextDouble() * 2 - 1) * S.env(t, 0.001, 0.03) * 0.12 + S.sqrP(1700 * t) * S.env(t, 0.001, 0.02) * 0.04);
    this.rallyClip = S.make("tc-rally", 0.9, (t) => {
      let v = 0;
      const notes = [392, 523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < notes.length; i++) { const st = t - i * 0.08; if (st > 0) v += S.sqrP(notes[i] * st) * 0.25 * S.env(st, 0.003, 0.25) + S.sinP(notes[i] * st) * S.env(st, 0.003, 0.4); }
      return v * 0.08;
    });
  }

  private BuildHud() {
    const hud = this.UI.Hud, C = UIKit.Center;
    this.timerPill = UIKit.img(hud, "TimerPill", Art.UiRound, new Color(0.06, 0.1, 0.2, 0.78));
    this.timerPill.rectTransform.place(new V2(0.5, 1), new V2(0, -72), new V2(250, 96));
    this.timerText = UIKit.at(UIKit.label(this.timerPill.rectTransform, "2:00", 58, Color.white), C, new V2(0, 2), new V2(240, 90));
    this.barBack = UIKit.img(hud, "Bar", Art.UiRound, new Color(0.06, 0.1, 0.2, 0.7)).rectTransform.place(new V2(0.5, 1), new V2(0, -152), new V2(640, 38));
    for (let i = 0; i < 5; i++) {
      const seg = UIKit.img(this.barBack, "Seg", Art.UiRound, i < 4 ? Colors[i] : NeutralPaint);
      seg.rectTransform.anchorMin = new V2(0, 0.5);
      seg.rectTransform.anchorMax = new V2(0, 0.5);
      seg.rectTransform.pivot = new V2(0, 0.5);
      seg.rectTransform.sizeDelta = new V2(10, 26);
      this.barSegs.push(seg);
    }
    this.levelText = UIKit.at(UIKit.label(hud, "", 34, Color.white, TextAnchor.MiddleLeft), new V2(0, 1), new V2(205, -58), new V2(330, 44));
    UIKit.glow(this.levelText, Ink, 3);
    CasualLook.fit(this.levelText, 20);
    this.subText = UIKit.at(UIKit.label(hud, "", 24, new Color(0.88, 0.95, 1, 0.95), TextAnchor.MiddleLeft), new V2(0, 1), new V2(205, -98), new V2(330, 34));
    UIKit.glow(this.subText, Ink, 2);
    CasualLook.fit(this.subText, 16);
    this.rallyButton = UIKit.buttonAt(hud, "RALLY", new V2(0.5, 0), new V2(-185, 100), new V2(340, 118), false, () => this.OnRally(), 30, Art.Plus);
    this.rallyButton.setAccent(Gold);
    this.sendButton = UIKit.buttonAt(hud, "SEND: ALL", new V2(0.5, 0), new V2(185, 100), new V2(340, 118), false, () => this.ToggleSend(), 30, Art.Chevron);
    this.sendButton.setAccent(Colors[0]);
    this.tutText = UIKit.at(UIKit.wrap(UIKit.label(hud, "", 34, Color.white)), new V2(0.5, 1), new V2(0, -222), new V2(860, 90));
    UIKit.glow(this.tutText, Ink, 4);
  }

  private BuildTitleExtras() {
    if (!this.UI.TitleExtra) return;
    CasualLook.titleCard(this.UI, new Color(0.05, 0.12, 0.25, 0.72));
    const ex = this.UI.TitleExtra, C = UIKit.Center;
    this.modeButton = UIKit.buttonAt(ex, "CAMPAIGN", C, new V2(-235, 8), new V2(450, 104), false, () => this.CycleMode(), 32);
    this.modeButton.setAccent(Colors[0]);
    this.optButton = UIKit.buttonAt(ex, "LEVEL 1", C, new V2(235, 8), new V2(450, 104), false, () => this.OptionPressed(), 32);
    this.optButton.setAccent(Gold);
    this.titleInfo = UIKit.at(UIKit.label(ex, "", 24, new Color(1, 1, 1, 0.82)), C, new V2(0, -66), new V2(960, 34));
    this.RefreshTitle();
  }

  private RefreshTitle() {
    if (!this.modeButton) return;
    const m = this.Data.get("mode", 0) as Mode, d = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    CasualUI_set(this.modeButton.label, "MODE: " + ModeNames[m]);
    let opt = "", info = "";
    if (m === Mode.Campaign) { opt = `LEVEL ${this.Pick}  ★${this.Data.get("s" + this.Pick)}  ▸ MAP`; info = "CONQUER LEVEL BY LEVEL  ·  TAP MAP TO REPLAY FOR STARS"; }
    else if (m === Mode.VsCpu) { opt = "CPU: " + BotNames[d]; info = "ONE RIVAL EMPIRE  ·  MOST TOWERS AT THE BUZZER WINS"; }
    else if (m === Mode.FFA) { opt = "CPUs: " + BotNames[d]; info = "YOU VS THREE EMPIRES  ·  LAST ONE STANDING"; }
    else { opt = "NEW MAP"; info = "BLUE (BOTTOM) VS RED (TOP)  ·  BOTH PLAY AT ONCE ON ONE SCREEN"; }
    CasualUI_set(this.optButton.label, opt);
    this.titleInfo.text = info;
    this.optButton.setAccent(m === Mode.TwoP ? Colors[1] : Gold);
  }

  private CycleMode() {
    this.Data.set("mode", ((this.Data.get("mode", 0) + 1) % 4));
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private OptionPressed() {
    const m = this.Data.get("mode", 0) as Mode;
    if (m === Mode.Campaign) { this.OpenLevelMap(); return; }
    if (m === Mode.TwoP) { this.Data.set("seed2p", this.Data.get("seed2p", 1) + 1); this.UI.Toast("A new battlefield is ready!", 1.6); }
    else this.Data.set("diff", (Mathf.clamp(this.Data.get("diff", 1), 0, 2) + 1) % 3);
    Sfx.play(Snd.Click, 0.6);
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  // ------------------------------------------------------------------ level map

  private BuildLevelMap() {
    this.mapLayer = UIKit.layer("LevelMap", UI.root!);
    UIKit.dim(this.mapLayer.node, 0.8);
    const card = UIKit.card(this.mapLayer.node, new V2(960, 1040), Gold);
    const C = UIKit.Center;
    this.mapTitle = UIKit.at(UIKit.label(card, "CAMPAIGN", 52, Color.white), C, new V2(0, 455), new V2(800, 70));
    this.mapPageText = UIKit.at(UIKit.label(card, "", 28, Gold), C, new V2(0, 400), new V2(800, 40));
    for (let i = 0; i < 16; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      const idx = i;
      const b = UIKit.buttonAt(card, "", C, new V2((col - 1.5) * 222, 275 - row * 196), new V2(204, 180), false, () => this.PickLevel(idx), 30);
      const num = UIKit.at(UIKit.label(b.node, "1", 50, Color.white), C, new V2(0, 26), new V2(200, 60));
      const tag = UIKit.at(UIKit.label(b.node, "", 22, Color.white), C, new V2(0, -16), new V2(200, 30));
      const stars: Image[] = [];
      for (let k = 0; k < 3; k++) {
        const s = UIKit.img(b.node, "Star", Art.Star, Gold);
        s.rectTransform.place(C, new V2((k - 1) * 40, -56), new V2(36, 36));
        stars.push(s);
      }
      this.mapCells.push({ button: b, num, tag, stars });
    }
    UIKit.buttonAt(card, "◀", C, new V2(-330, -440), new V2(150, 100), false, () => this.MapPage(-1), 44).setAccent(Gold);
    UIKit.buttonAt(card, "▶", C, new V2(330, -440), new V2(150, 100), false, () => this.MapPage(1), 44).setAccent(Gold);
    UIKit.buttonAt(card, "CLOSE", C, new V2(0, -440), new V2(320, 100), true, () => this.CloseLevelMap(), 40).setAccent(Gold);
  }

  private OpenLevelMap() {
    this.mapPage = Math.floor((this.Pick - 1) / 16);
    this.RefreshLevelMap();
    const g = this.mapLayer;
    g.node.setActive(true);
    g.node.setAsLastSibling();
    g.alpha = 1;
    g.blocksRaycasts = true;
    g.interactable = true;
    Sfx.play(Snd.Click, 0.6);
  }

  private CloseLevelMap() {
    const g = this.mapLayer;
    g.alpha = 0;
    g.blocksRaycasts = false;
    g.interactable = false;
    g.node.setActive(false);
    this.RefreshTitle();
    this.UI.ShowTitle(this.BestLine(), this.StatsLine());
  }

  private get MapOpen() { return this.mapLayer?.node.activeSelf ?? false; }

  private MapPage(d: number) {
    const pages = Math.floor((this.MaxLevel - 1) / 16) + 1;
    this.mapPage = Mathf.clamp(this.mapPage + d, 0, Math.max(0, pages));
    this.RefreshLevelMap();
  }

  private RefreshLevelMap() {
    this.mapTitle.text = `CAMPAIGN  ·  ★ ${this.TotalStars()}`;
    this.mapPageText.text = `LEVELS ${this.mapPage * 16 + 1}–${this.mapPage * 16 + 16}   ·   ◉ ${Fmt.n(this.Coins)}`;
    for (let i = 0; i < 16; i++) {
      const L = this.mapPage * 16 + i + 1, c = this.mapCells[i];
      const open = L <= this.MaxLevel, sp = campaignSpec(L), st = this.Data.get("s" + L);
      c.num.text = open ? String(L) : "🔒";
      c.num.fontSize = open ? 50 : 40;
      c.tag.text = open ? (sp.play === Play.Solo ? "SOLO" : sp.play === Play.Duel ? "DUEL " + BotNames[sp.diff] : "FFA " + BotNames[sp.diff]) : "LOCKED";
      const acc = !open ? Pal.TextDim : L === this.Pick ? Gold : sp.play === Play.Solo ? Green : sp.play === Play.Duel ? Colors[1] : Colors[3];
      c.button.setAccent(acc);
      c.button.interactable = open;
      for (let k = 0; k < 3; k++) {
        c.stars[k].gameObject.setActive(open && L < this.MaxLevel + 1);
        c.stars[k].color = k < st ? Gold : new Color(1, 1, 1, 0.22);
      }
    }
  }

  private PickLevel(i: number) {
    const L = this.mapPage * 16 + i + 1;
    if (L > this.MaxLevel) return;
    this.Data.set("pick", L);
    this.CloseLevelMap();
    this.UI.Toast(`LEVEL ${L}: ${this.SpecLine(campaignSpec(L))}`, 2);
  }

  // ------------------------------------------------------------------ map visuals

  private toW(m: V2) { return this.rot ? new V2(m.y, -m.x) : m; }
  private toM(w: V2) { return this.rot ? new V2(-w.y, w.x) : w; }

  private LoadMap(spec: LevelSpec, humans: boolean[]) {
    this.spec = spec;
    const def = buildMap(spec);
    this.map = def;
    this.sim = new Sim(def.players);
    for (const t of def.towers) this.sim.addTower(t.pos, t.kind, t.owner, t.troops);
    this.humans = humans;
    this.bots = [];
    for (let p = 0; p < def.players; p++) if (!humans[p]) this.bots.push(new Bot(this.sim, p, spec.diff, new SysRandom(spec.seed * 31 + p + this.rng.next(1000))));
    this.HookEvents();
    this.drags.clear();
    for (const s of this.tapSel) s.length = 0;
    this.BuildMapVisuals();
  }

  private BuildMapVisuals() {
    for (const c of [...this.mapRoot.children]) c.destroy();
    this.views = [];
    this.builtRot = this.rot;
    if (!this.map) return;
    const W = (v: V2) => this.toW(v);
    const hw = MapW / 2, hh = MapH / 2;
    const plate = roundRect(hw + 0.18, hh + 0.18, 0.7).map(W);
    const mk = (pts: V2[], col: Color, order: number, off = V2.zero, shade = 1, edge = 1) => {
      const mr = Art.meshObject(this.mapRoot, "Plate", polyMesh(pts.map((p) => p.add(off)), shade, edge), Art.Flat, order);
      mr.color = col;
      return mr;
    };
    mk(plate, new Color(0.02, 0.1, 0.2, 0.28), -70, new V2(0.25, -0.62));
    mk(plate, PlateSide, -68, new V2(0, -0.34), 0.9, 0.75);
    mk(plate, PlateTop, -66);
    // territories: Voronoi cells clipped to the map, inset so the plate shows through as white borders
    const clip = roundRect(hw, hh, 0.55);
    for (const t of this.sim.towers) {
      let poly = clip;
      for (const o of this.sim.towers) {
        if (o === t) continue;
        const n = o.pos.sub(t.pos);
        poly = clipHalf(poly, V2.lerp(t.pos, o.pos, 0.5), n);
        if (poly.length < 3) break;
      }
      const v = new TowerView(t);
      const cellPoly = inset(poly, 0.05).map(W);
      v.cell = Art.meshObject(this.mapRoot, "Cell", polyMesh(cellPoly, 1, 0.84), Art.Flat, -60);
      v.cellColor = this.CellColor(t.owner);
      v.cell.color = v.cellColor;
      this.views.push(v);
    }
    for (const d of this.map.decor) {
      const p = W(d.pos);
      const sr = Art.spr(this.mapRoot, "Decor", TowerArt.Decor(d.kind), Color.white, d.scale * (d.kind === 0 ? 0.85 : 0.6), -40 + Math.round(-p.y), Art.Flat);
      sr.transform.localPosition = p;
    }
    for (const v of this.views) this.BuildTower(v);
  }

  private BuildTower(v: TowerView) {
    const t = v.t, w = this.toW(t.pos), size = TowerSize[t.kind];
    v.size = size;
    v.root = new GameObject("Tower", this.mapRoot);
    v.root.localPosition = w;
    const order = 10 + Math.round((8 - w.y) * 2);
    v.ring = Art.spr(v.root, "Ring", TowerArt.SelectRing, Color.white, size * 1.45, 6, Art.Flat);
    v.ring.transform.localPosition = new V2(0, -0.2 * size);
    v.ring.gameObject.setActive(false);
    v.target = Art.spr(v.root, "Target", TowerArt.SelectRing, Color.white, size * 1.6, 6, Art.Flat);
    v.target.transform.localPosition = new V2(0, -0.2 * size);
    v.target.gameObject.setActive(false);
    v.stone = Art.spr(v.root, "Stone", TowerArt.Stone(t.kind), Color.white, size, order, Art.Flat);
    v.stone.transform.localPosition = new V2(0, 0.12 * size);
    v.paint = Art.spr(v.root, "Paint", TowerArt.Paint(t.kind), Color.white, size, order + 1, Art.Flat);
    v.paint.transform.localPosition = new V2(0, 0.12 * size);
    v.pill = Art.spr(v.root, "Pill", TowerArt.Pill, Color.white, 0.82, 55, Art.Flat);
    v.pill.transform.localPosition = new V2(0, -0.5 * size - 0.12);
    const tm = new GameObject("Count", v.root).addComponent(new TextMesh());
    tm.fontSize = 40;
    tm.characterSize = 0.078;
    tm.anchor = "MiddleCenter";
    tm.color = Color.white;
    tm.sortingOrder = 56;
    tm.transform.localPosition = new V2(0, -0.5 * size - 0.11);
    v.label = tm;
    v.shownOwner = -2;
    this.RefreshTowerLook(v, true);
  }

  private CellColor(owner: number) { return owner < 0 ? NeutralCell : Color.lerp(Colors[owner], Color.white, 0.58); }

  private RefreshTowerLook(v: TowerView, instant = false) {
    const o = v.t.owner;
    if (v.shownOwner === o) return;
    v.shownOwner = o;
    v.paint.color = o < 0 ? NeutralPaint : Colors[o];
    v.pill.color = o < 0 ? NeutralPill : Color.lerp(Colors[o], Color.black, 0.28);
    if (instant) { v.cellColor = this.CellColor(o); v.cell.color = v.cellColor; }
  }

  // ------------------------------------------------------------------ events

  private HookEvents() {
    const sim = this.sim;
    sim.events = {
      capture: (t, prev, by) => {
        const v = this.views[t.id];
        if (!v) return;
        v.pop = 1;
        const w = this.toW(t.pos);
        this.fx.pop(w, Colors[by], 18, 5, 0.26, 0.6);
        this.fx.sparkle(w.add(new V2(0, 0.3)), Color.lerp(Colors[by], Color.white, 0.4), 6, 0.6, 0.3);
        if (this.State !== Phase.Playing) return;
        const humanBy = this.humans[by], humanLost = prev >= 0 && this.humans[prev];
        if (humanBy) {
          Sfx.playClip(this.captureClip, 0.8, 1 + this.rng.nextDouble() * 0.1);
          this.UI.Float(w.add(new V2(0, 0.7)), t.spec.name + "!", Color.lerp(Colors[by], Color.white, 0.3), 0.9);
          this.Fx.shake(0.08);
        } else if (humanLost) {
          Sfx.playClip(this.lostClip, 0.8);
          this.UI.Float(w.add(new V2(0, 0.7)), "LOST!", hex(0xff7a7a), 0.9);
          this.Fx.shake(0.18);
          Fx.haptic(true);
        } else Sfx.playClip(this.thudClip, 0.5, 0.8);
      },
      hit: (t) => {
        const v = this.views[t.id];
        if (v) v.hit = 1;
        if (this.State === Phase.Playing && Time.unscaledTime > this.sfxGate) { this.sfxGate = Time.unscaledTime + 0.06; Sfx.playClip(this.thudClip, 0.35, 0.9 + this.rng.nextDouble() * 0.3); }
      },
      clash: (pos, a, b) => {
        const w = this.toW(pos);
        this.fx.emit(w, V2.fromAngle(this.rng.nextDouble() * 6.28, 1.5), Colors[a], 0.16, 0.3);
        this.fx.emit(w, V2.fromAngle(this.rng.nextDouble() * 6.28, 1.5), Colors[b], 0.16, 0.3);
        if (this.State === Phase.Playing && Time.unscaledTime > this.clashGate) { this.clashGate = Time.unscaledTime + 0.05; Sfx.playClip(this.clashClip, 0.5, 0.9 + this.rng.nextDouble() * 0.4); }
      },
      send: (_f, _t, owner) => {
        if (this.State === Phase.Playing && this.humans[owner]) Sfx.playClip(this.sendClip, 0.7, 0.95 + this.rng.nextDouble() * 0.15);
      },
      eliminated: (p) => {
        if (this.State !== Phase.Playing || this.map?.players === 1) return;
        if (!this.humans[p] || this.mode === Mode.TwoP) this.UI.Announce(Names[p] + " IS OUT!", Colors[p], 1.3);
        Sfx.play(Snd.Explode, 0.5);
      },
    };
  }

  // ------------------------------------------------------------------ layout

  protected OnLayoutChanged() { this.Layout(); }

  private Layout() {
    this.rot = Screen.width > Screen.height * 1.05;
    const r = this.PlayRect(this.TopBand, this.BottomBand, 0);
    this.Fx.CameraTarget = r.center.neg();
    CasualLook.fitCover(this.cover, this.ViewSize, this.Fx.CameraTarget);
    if (this.builtRot !== null && this.builtRot !== this.rot) {
      this.BuildMapVisuals();
      for (const v of this.views) this.RefreshTowerLook(v, true);
    }
    if (this.rallyButton) {
      if (this.rot) {
        this.rallyButton.node.place(new V2(0, 0), new V2(200, 78), new V2(330, 104));
        this.sendButton.node.place(new V2(1, 0), new V2(-200, 78), new V2(330, 104));
      } else {
        this.rallyButton.node.place(new V2(0.5, 0), new V2(-185, 100), new V2(340, 118));
        this.sendButton.node.place(new V2(0.5, 0), new V2(185, 100), new V2(340, 118));
      }
    }
  }

  // ------------------------------------------------------------------ lifecycle

  protected OnEnterTitle() {
    this.RefreshTitle();
    this.StartAttract();
  }

  private StartAttract() {
    const spec = quickSpec(Play.FFA, 1, this.rng.next(100000));
    spec.time = 999;
    this.LoadMap(spec, [false, false, false, false]);
    this.attractTimer = 75;
    this.ClearUnitsVisual();
  }

  protected BeginRun() {
    this.CloseLevelMapSilently();
    this.mode = this.Data.get("mode", 0) as Mode;
    this.diff = Mathf.clamp(this.Data.get("diff", 1), 0, 2);
    let spec: LevelSpec;
    if (this.mode === Mode.Campaign) { this.playLevel = this.Pick; spec = campaignSpec(this.playLevel); }
    else if (this.mode === Mode.VsCpu) spec = quickSpec(Play.Duel, this.diff, this.rng.next(1 << 30));
    else if (this.mode === Mode.FFA) spec = quickSpec(Play.FFA, this.diff, this.rng.next(1 << 30));
    else { spec = quickSpec(Play.Duel, 1, 9000 + this.Data.get("seed2p", 1) * 101); spec.play = Play.TwoPlayer; }
    const humans = this.mode === Mode.TwoP ? [true, true] : [true, false, false, false];
    this.LoadMap(spec, humans);
    this.timeBonus = 0;
    this.ended = false;
    this.outcome = 0;
    this.winner = -1;
    this.revived = false;
    this.rallyUsed = 0;
    this.humanSent = false;
    this.lastTick = -1;
    this.ClearUnitsVisual();
    this.fx.clear();
    this.Data.add("games", 1);
    Sfx.setIntensity(0.3);
    const two = this.mode === Mode.TwoP;
    this.rallyButton.node.setActive(!two);
    this.sendButton.node.setActive(!two);
    this.tutText.text = "";
    this.levelText.text = this.mode === Mode.Campaign ? `LEVEL ${this.playLevel}` : ModeNames[this.mode];
    this.subText.text = (this.map?.name ?? "") + (this.mode === Mode.Campaign ? "  ·  " + PlayTags[spec.play] : "");
    this.RefreshButtons();
    if (spec.play === Play.Solo) this.UI.Announce("TAKE EVERY TOWER!", Colors[0], 1.5);
    else if (two) this.UI.Announce("BLUE VS RED!", Colors[1], 1.4);
    else this.UI.Announce("CONQUER!", Colors[0], 1.3);
    if (this.mode === Mode.Campaign && this.playLevel === 1) this.tutText.text = "DRAG from your BLUE tower to a grey tower to send troops!";
    else if (this.mode === Mode.Campaign && this.playLevel === 2) this.UI.Toast("Tip: drag THROUGH several of your towers to send from all of them.", 5);
    else if (this.mode === Mode.Campaign && this.playLevel === 3) this.UI.Toast("A rival empire! Protect your towers and take theirs.", 4);
    else if (two) this.UI.Toast("Each player drags from their own towers. Both at once!", 4);
  }

  private CloseLevelMapSilently() {
    if (!this.MapOpen) return;
    this.mapLayer.alpha = 0;
    this.mapLayer.blocksRaycasts = false;
    this.mapLayer.interactable = false;
    this.mapLayer.node.setActive(false);
  }

  private get TimeLeft() { return this.spec.time + this.timeBonus - this.sim.time; }

  protected TickBackground(dt: number) {
    if (this.State === Phase.Title) {
      if (this.MapOpen && Keyboard.escape.wasPressedThisFrame) this.CloseLevelMap();
      this.attractTimer -= dt;
      for (const b of this.bots) b.update(dt);
      this.sim.step(dt);
      if (this.attractTimer <= 0 || this.sim.alive.filter((a) => a).length <= 1) this.StartAttract();
    }
    this.Render(dt);
  }

  protected TickRun(dt: number) {
    if (!this.ended) {
      this.HandleInput();
      for (const b of this.bots) b.update(dt);
      this.sim.step(dt);
      if (Keyboard.letter("h").wasPressedThisFrame) this.ToggleSend();
      if (Keyboard.letter("r").wasPressedThisFrame) this.OnRally();
      this.CheckEnd();
    } else {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && this.State === Phase.Playing) this.End();
    }
    this.UpdateHud();
    this.Render(dt);
  }

  // ------------------------------------------------------------------ input (multi-touch drags)

  private HumanOwns(owner: number) { return owner >= 0 && !!this.humans[owner]; }

  private PickTower(m: V2, slack = 1) {
    let best: Tower | null = null, bd = 1e9;
    for (const t of this.sim.towers) {
      const d = V2.distance(t.pos, m);
      const r = Math.max(t.radius * 1.35, 0.66) * slack;
      if (d < r && d < bd) { bd = d; best = t; }
    }
    return best;
  }

  private ScreenToMap(screen: V2) { return this.toM(this.ScreenToWorld(screen)); }

  private HandleInput() {
    const seen = new Set<number>();
    if (Touchscreen.present) {
      for (const t of Touchscreen.touches) {
        seen.add(t.touchId);
        if (t.press.wasPressedThisFrame) this.PointerDown(t.touchId, t.position);
        if (this.drags.has(t.touchId)) this.PointerMove(t.touchId, t.position);
        if (t.press.wasReleasedThisFrame || !t.press.isPressed) this.PointerUp(t.touchId, t.position);
      }
    }
    if (Mouse.present) {
      const b = Mouse.leftButton;
      seen.add(-1);
      if (b.wasPressedThisFrame) this.PointerDown(-1, Mouse.position);
      if (this.drags.has(-1)) this.PointerMove(-1, Mouse.position);
      if (b.wasReleasedThisFrame || (!b.isPressed && this.drags.has(-1))) this.PointerUp(-1, Mouse.position);
    }
    for (const id of [...this.drags.keys()]) if (!seen.has(id)) this.drags.delete(id);
  }

  private PointerDown(id: number, screen: V2) {
    if (overUI(screen)) return;
    const m = this.ScreenToMap(screen);
    const t = this.PickTower(m);
    if (t && this.HumanOwns(t.owner)) {
      this.drags.set(id, { id, owner: t.owner, sources: [t], m, startScreen: screen, start: t, moved: false, hover: t });
      Sfx.playClip(this.selectClip, 0.5);
      if (this.views[t.id]) this.views[t.id].pop = Math.max(this.views[t.id].pop, 0.4);
      return;
    }
    // tap a target while towers are tap-selected: send from them
    if (t) {
      let owner = -1, bd = 1e9;
      for (let p = 0; p < this.tapSel.length; p++)
        for (const s of this.tapSel[p]) { const d = V2.distance(s.pos, t.pos); if (d < bd) { bd = d; owner = p; } }
      if (owner >= 0) { this.SendFrom(owner, this.tapSel[owner], t); this.tapSel[owner] = []; }
      return;
    }
    for (let p = 0; p < this.tapSel.length; p++) this.tapSel[p] = [];
  }

  private PointerMove(id: number, screen: V2) {
    const d = this.drags.get(id);
    if (!d) return;
    d.m = this.ScreenToMap(screen);
    if (!d.moved && screen.sub(d.startScreen).magnitude > dp(14)) d.moved = true;
    const t = this.PickTower(d.m, 0.9);
    d.hover = t;
    if (t && t.owner === d.owner && !d.sources.includes(t) && d.moved) {
      d.sources.push(t);
      Sfx.playClip(this.selectClip, 0.5, 1 + d.sources.length * 0.08);
      if (this.views[t.id]) this.views[t.id].pop = 0.5;
    }
  }

  private PointerUp(id: number, screen: V2) {
    const d = this.drags.get(id);
    if (!d) return;
    this.drags.delete(id);
    const m = this.ScreenToMap(screen);
    const target = this.PickTower(m, 1.1);
    const sel = this.tapSel[d.owner];
    if (!d.moved && target === d.start) {
      // a tap on your own tower: select / deselect, or send the selection to it
      if (sel.includes(target)) this.tapSel[d.owner] = sel.filter((s) => s !== target);
      else if (sel.length > 0) { this.SendFrom(d.owner, sel, target); this.tapSel[d.owner] = []; }
      else sel.push(target);
      return;
    }
    if (!target) return;
    const sources = d.sources.filter((s) => s !== target && s.owner === d.owner);
    if (sources.length > 0) this.SendFrom(d.owner, sources, target);
    this.tapSel[d.owner] = [];
  }

  private SendFrom(owner: number, sources: Tower[], target: Tower) {
    const src = sources.filter((s) => s.owner === owner && s !== target);
    if (src.length === 0) return;
    const share = this.mode !== Mode.TwoP && this.SendHalf ? 0.5 : 1;
    const n = this.sim.sendShare(src, target, share);
    if (n <= 0) { Sfx.play(Snd.Deny, 0.4); return; }
    if (!this.humanSent && owner === 0) { this.humanSent = true; if (this.mode === Mode.Campaign && this.playLevel === 1) this.tutText.text = "Great! Take every grey tower before time runs out."; }
    const v = this.views[target.id];
    if (v) v.target.gameObject.setActive(false);
  }

  // ------------------------------------------------------------------ boosters

  private OnRally() {
    if (this.State !== Phase.Playing || this.ended || this.mode === Mode.TwoP) return;
    if (this.rallyUsed >= RallyMax) { Sfx.play(Snd.Deny, 0.5); this.UI.Toast("Rally is used up for this battle.", 1.5); return; }
    if (this.sim.towersOf(0) === 0) { Sfx.play(Snd.Deny, 0.5); return; }
    if (this.Rally > 0) { this.Rally = this.Rally - 1; this.DoRally(); return; }
    if (this.Coins >= RallyCost) { this.Coins = this.Coins - RallyCost; this.DoRally(); return; }
    if (!AdService.rewardedAvailable) { Sfx.play(Snd.Deny, 0.5); return; }
    AdService.showRewarded((ok) => { if (ok && this.State === Phase.Playing && !this.ended) this.DoRally(); });
  }

  private DoRally() {
    this.rallyUsed++;
    Sfx.playClip(this.rallyClip, 0.9);
    this.Fx.shake(0.1);
    for (const t of this.sim.towers) {
      if (t.owner !== 0) continue;
      t.troops += RallyAmount;
      const w = this.toW(t.pos);
      this.UI.Float(w.add(new V2(0, 0.6)), "+" + RallyAmount, Gold, 0.85);
      this.Fx.ring(w, Gold, 0.3, 1.8, 0.45);
      this.fx.sparkle(w, Gold, 5, 0.5, 0.28);
      if (this.views[t.id]) this.views[t.id].pop = 1;
    }
    this.UI.Announce("RALLY! +" + RallyAmount, Gold, 1);
    this.RefreshButtons();
  }

  private ToggleSend() {
    if (this.mode === Mode.TwoP) return;
    this.Data.set("half", this.SendHalf ? 0 : 1);
    Sfx.play(Snd.Click, 0.6);
    this.UI.Toast(this.SendHalf ? "Towers now send HALF of their troops." : "Towers now send ALL of their troops.", 1.6);
    this.RefreshButtons();
  }

  private RefreshButtons() {
    CasualUI_set(this.sendButton.label, this.SendHalf ? "SEND: HALF" : "SEND: ALL");
    const left = RallyMax - this.rallyUsed;
    let lab: string;
    if (left <= 0) lab = "RALLY USED";
    else if (this.Rally > 0) lab = `RALLY +${RallyAmount} ×${this.Rally}`;
    else if (this.Coins >= RallyCost) lab = `RALLY  ◉${RallyCost}`;
    else lab = AdService.rewardedAvailable ? "RALLY +AD" : "RALLY";
    CasualUI_set(this.rallyButton.label, lab);
    this.rallyButton.interactable = left > 0 && (this.Rally > 0 || this.Coins >= RallyCost || AdService.rewardedAvailable);
  }

  // ------------------------------------------------------------------ rules: end of battle

  private CheckEnd() {
    const sim = this.sim, solo = this.spec.play === Play.Solo;
    if (solo) {
      if (sim.towers.every((t) => t.owner === 0)) this.EndBattle(1, 0);
      else if (!sim.alive[0]) this.EndBattle(-1, -1);
      else if (this.TimeLeft <= 0) this.EndBattle(-1, -1);
      return;
    }
    if (this.mode === Mode.TwoP) {
      if (!sim.alive[0]) this.EndBattle(1, 1);
      else if (!sim.alive[1]) this.EndBattle(1, 0);
      else if (this.TimeLeft <= 0) { const [lead, tie] = sim.leader(); this.EndBattle(1, tie ? -1 : lead); }
      return;
    }
    if (!sim.alive[0]) { this.EndBattle(-1, sim.leader()[0]); return; }
    let rivals = 0;
    for (let p = 1; p < sim.players; p++) if (sim.alive[p]) rivals++;
    if (rivals === 0) { this.EndBattle(1, 0); return; }
    if (this.TimeLeft <= 0) {
      const [lead, tie] = sim.leader();
      this.EndBattle(lead === 0 && !tie ? 1 : -1, lead);
    }
  }

  private EndBattle(outcome: number, winner: number) {
    this.ended = true;
    this.outcome = outcome;
    this.winner = winner;
    this.endTimer = 1.6;
    this.drags.clear();
    for (const s of this.tapSel) s.length = 0;
    this.UI.Hint(null);
    this.tutText.text = "";
    if (this.mode === Mode.TwoP) {
      if (winner < 0) this.UI.Announce("DRAW!", Color.white, 1.4);
      else { this.UI.Announce(Names[winner] + " WINS!", Colors[winner], 1.4); this.fx.confetti(new V2(0, this.ViewSize.y * 0.3).sub(this.Fx.CameraTarget), 70, 9, [Colors[winner], Gold, Color.white]); }
      Sfx.play(Snd.Win, 0.8);
      return;
    }
    if (outcome > 0) {
      this.UI.Announce(this.spec.play === Play.Solo ? "MAP CONQUERED!" : "VICTORY!", Gold, 1.4);
      Sfx.play(Snd.Win, 0.8);
      this.fx.confetti(new V2(0, this.ViewSize.y * 0.3).sub(this.Fx.CameraTarget), 80, 9, [Colors[0], Gold, Color.white, Green]);
      Fx.haptic(true);
    } else {
      this.UI.Announce(this.TimeLeft <= 0 ? "TIME'S UP!" : "DEFEATED!", hex(0xff8080), 1.4);
      Sfx.play(Snd.Lose, 0.8);
      this.Fx.shake(0.25);
    }
  }

  private End() {
    const sim = this.sim;
    const towers = sim.towersOf(0), total = sim.towers.length;
    if (this.mode === Mode.TwoP) {
      if (this.winner >= 0) this.Data.add("p" + this.winner, 1);
      const head = this.winner < 0 ? "DRAW!" : Names[this.winner] + " WINS!";
      this.Finish(new Result({
        Headline: head,
        HeadlineColor: this.winner < 0 ? Color.white : Colors[this.winner],
        Value: `${sim.towersOf(0)} – ${sim.towersOf(1)}`,
        BestLine: `TOWERS  ·  SERIES BLUE ${this.Data.get("p0")} – ${this.Data.get("p1")} RED`,
        Stats: [["BLUE CAPTURES", String(sim.captured[0])], ["RED CAPTURES", String(sim.captured[1])], ["BLUE SENT", Fmt.n(sim.sent[0])], ["RED SENT", Fmt.n(sim.sent[1])]],
        Primary: "REMATCH",
        Victory: this.winner >= 0,
      }));
      return;
    }
    const won = this.outcome > 0;
    const solo = this.spec.play === Play.Solo;
    let stars = 0;
    if (won) {
      if (solo) stars = this.TimeLeft >= 40 ? 3 : this.TimeLeft >= 18 ? 2 : 1;
      else {
        let second = 0;
        for (let p = 1; p < sim.players; p++) second = Math.max(second, sim.towersOf(p));
        stars = second === 0 && sim.alive.slice(1).every((a) => !a) ? 3 : towers >= second * 2 ? 2 : 1;
      }
    }
    let coins = 0;
    if (won) {
      this.Data.add("streak", 1);
      this.Data.max("streakBest", this.Data.get("streak"));
      coins = 10 + stars * 5 + Math.min(25, (this.Data.get("streak") - 1) * 5);
      this.Coins = this.Coins + coins;
    } else this.Data.set("streak", 0);
    const stats: [string, string][] = [["TOWERS", `${towers} / ${total}`], ["CAPTURED", String(sim.captured[0])], ["TROOPS SENT", Fmt.n(sim.sent[0])], ["COINS", won ? "+" + coins : "◉ " + Fmt.n(this.Coins)]];
    if (this.mode === Mode.Campaign) {
      const L = this.playLevel;
      let newBest = false;
      if (won) {
        newBest = this.Data.max("s" + L, stars);
        if (L >= this.MaxLevel) this.Data.set("level", L + 1);
        this.Data.set("pick", Math.min(L + 1, this.MaxLevel));
      }
      this.Finish(new Result({
        Headline: won ? (solo ? "MAP CONQUERED!" : "VICTORY!") : this.TimeLeft <= 0 ? "TIME'S UP!" : "DEFEATED",
        HeadlineColor: won ? Gold : hex(0xffb0b0),
        Value: won ? "" : `${towers} / ${total} TOWERS`,
        Stars: won ? stars : -1,
        NewBest: won && newBest && stars === 3,
        BestLine: `LEVEL ${L}  ·  ${this.map?.name ?? ""}`,
        Stats: stats,
        Primary: won ? "NEXT LEVEL" : "TRY AGAIN",
        Victory: won,
        Reward: won ? () => this.DoubleCoins(coins) : this.CanRevive() ? () => this.DoRevive() : null,
        RewardLabel: won ? `DOUBLE COINS +${coins} ◉ (AD)` : `CONTINUE +${ReviveTime}s & +${RallyAmount} TROOPS (AD)`,
      }));
      return;
    }
    const d = this.diff;
    if (this.mode === Mode.VsCpu) this.Data.add((won ? "w" : "l") + d, 1);
    else if (won) this.Data.add("f" + d, 1);
    this.Finish(new Result({
      Headline: won ? "VICTORY!" : this.TimeLeft <= 0 ? "TIME'S UP!" : "DEFEATED",
      HeadlineColor: won ? Gold : hex(0xffb0b0),
      Value: won ? "" : `${towers} / ${total} TOWERS`,
      Stars: won ? stars : -1,
      BestLine: this.mode === Mode.VsCpu ? `VS CPU ${BotNames[d]}:  ${this.Data.get("w" + d)} WON  ·  ${this.Data.get("l" + d)} LOST` : `FREE-FOR-ALL ${BotNames[d]}:  ${this.Data.get("f" + d)} WINS`,
      Stats: stats,
      Primary: won ? "PLAY AGAIN" : "REMATCH",
      Victory: won,
      Reward: won ? () => this.DoubleCoins(coins) : this.CanRevive() ? () => this.DoRevive() : null,
      RewardLabel: won ? `DOUBLE COINS +${coins} ◉ (AD)` : `CONTINUE +${ReviveTime}s & +${RallyAmount} TROOPS (AD)`,
    }));
  }

  private CanRevive() { return !this.revived; }

  private DoubleCoins(coins: number) {
    this.Coins = this.Coins + coins;
    this.UI.Toast(`+${coins} COINS!`, 2);
    Sfx.play(Snd.Coin, 0.8);
  }

  /** Rewarded continue: more time, +20 troops in every tower you own (or your home tower back if you lost them all). */
  private DoRevive() {
    this.revived = true;
    this.timeBonus += Math.max(ReviveTime, ReviveTime - this.TimeLeft);
    if (this.sim.towersOf(0) === 0) {
      const home = this.sim.towers.reduce((a, b) => (V2.distance(b.pos, this.map!.towers[0].pos) < V2.distance(a.pos, this.map!.towers[0].pos) ? b : a));
      home.owner = 0;
      home.troops = RallyAmount;
      this.sim.alive[0] = true;
    }
    for (const t of this.sim.towers) if (t.owner === 0) t.troops += RallyAmount;
    this.ended = false;
    this.outcome = 0;
    this.Revive();
    this.UI.Announce("FIGHT ON! +" + ReviveTime + "s", Gold, 1.3);
    Sfx.playClip(this.rallyClip, 0.9);
    this.RefreshButtons();
  }

  // ------------------------------------------------------------------ HUD

  private UpdateHud() {
    const tl = Math.max(0, this.TimeLeft);
    CasualUI_set(this.timerText, Fmt.clock(Math.ceil(tl)));
    const warn = tl <= 10 && !this.ended;
    this.timerText.color = warn ? hex(0xff8a8a) : Color.white;
    const s = warn ? 1 + 0.08 * Math.max(0, Math.sin(Time.time * 10)) : 1;
    this.timerPill.rectTransform.localScale = new V3(s, s, 1);
    const sec = Math.ceil(tl);
    if (warn && sec !== this.lastTick && sec > 0) { this.lastTick = sec; Sfx.play(Snd.Tick, 0.8, 1 + (10 - sec) * 0.04); }
    Sfx.setIntensity(tl < 30 ? 0.85 : 0.35);
    // power bar: tower share per empire (+ neutral)
    const total = Math.max(1, this.sim.towers.length), width = 628;
    let x = 6;
    const counts = [0, 0, 0, 0, 0];
    for (const t of this.sim.towers) counts[t.owner < 0 ? 4 : t.owner]++;
    for (let i = 0; i < 5; i++) {
      const w = (counts[i] / total) * width;
      const seg = this.barSegs[i];
      seg.enabled = w > 1;
      seg.rectTransform.anchoredPosition = new V2(x, 0);
      seg.rectTransform.sizeDelta = new V2(Math.max(0, w - 2), 26);
      x += w;
    }
    if (this.mode === Mode.Campaign && this.spec.play === Play.Solo) CasualUI_set(this.subText, `${counts[4]} NEUTRAL TOWER${counts[4] === 1 ? "" : "S"} LEFT`);
    else if (this.mode === Mode.TwoP) CasualUI_set(this.subText, `BLUE ${counts[0]}  ·  RED ${counts[1]}`);
    else CasualUI_set(this.subText, `YOUR TOWERS: ${counts[0]} / ${total}`);
  }

  // ------------------------------------------------------------------ rendering

  private ClearUnitsVisual() { for (const u of this.unitPool) u.gameObject.setActive(false); }

  private Render(dt: number) {
    const sim = this.sim;
    const pulse = 0.5 + 0.5 * Math.sin(Time.time * 6);
    // towers, cells, garrison counters
    for (const v of this.views) {
      const t = v.t;
      this.RefreshTowerLook(v);
      const target = this.CellColor(t.owner);
      if (!v.cellColor.equals(target)) {
        const k = Math.min(1, dt * 5);
        const c = Color.lerp(v.cellColor, target, k);
        v.cellColor = Math.abs(c.r - target.r) + Math.abs(c.g - target.g) + Math.abs(c.b - target.b) < 0.01 ? target : c;
        v.cell.color = v.cellColor;
      }
      v.pop = Math.max(0, v.pop - dt * 3);
      v.hit = Math.max(0, v.hit - dt * 6);
      const sq = 1 + v.pop * 0.22 * Math.sin(v.pop * 9) + v.hit * 0.06;
      v.stone.transform.localScale = new V2(v.size * (2 - sq), v.size * sq);
      v.paint.transform.localScale = new V2(v.size * (2 - sq), v.size * sq);
      const n = Math.floor(t.troops);
      const txt = String(n);
      if (txt !== v.text) { v.text = txt; v.label.text = txt; }
      const full = t.owner >= 0 && t.troops >= t.spec.cap - 0.01;
      v.label.color = full ? Color.lerp(Color.white, Gold, pulse) : Color.white;
      const ps = 1 + v.hit * 0.15 + v.pop * 0.2;
      v.pill.transform.localScale = new V2(0.82 * ps * (txt.length > 2 ? 1.12 : 1), 0.82 * ps);
      // selection rings
      let selected = false, hoverBy = -1;
      for (const d of this.drags.values()) { if (d.sources.includes(t)) selected = true; if (d.hover === t && d.moved && !d.sources.includes(t)) hoverBy = d.owner; }
      for (let p = 0; p < this.tapSel.length; p++) if (this.tapSel[p].includes(t)) selected = true;
      v.ring.gameObject.setActive(selected);
      if (selected) v.ring.color = Color.white.withAlpha(0.65 + 0.35 * pulse);
      v.target.gameObject.setActive(hoverBy >= 0);
      if (hoverBy >= 0) {
        v.target.color = Color.lerp(Colors[hoverBy], Color.white, 0.25).withAlpha(0.7 + 0.3 * pulse);
        const ts = v.size * (1.5 + 0.12 * pulse);
        v.target.transform.localScale = new V2(ts, ts);
      }
    }
    // marching troops
    let used = 0;
    for (const u of sim.units) {
      if (!u.alive) continue;
      let sr = this.unitPool[used];
      if (!sr) {
        sr = Art.spr(this.world, "Unit", TowerArt.Unit, Color.white, 0.24, 45, Art.Flat);
        this.unitPool.push(sr);
      }
      if (!sr.gameObject.activeSelf) sr.gameObject.setActive(true);
      used++;
      const bob = Math.sin(u.phase * 15) * 0.025;
      const w = this.toW(u.pos.add(u.perp.mul(bob)));
      sr.transform.localPosition = w;
      const s = (u.value > 1 ? 0.3 : 0.24) * (1 + 0.08 * Math.abs(Math.sin(u.phase * 15)));
      sr.transform.localScale = new V2(s, s);
      sr.color = Color.lerp(Colors[u.owner], Color.white, 0.12);
    }
    for (let i = used; i < this.unitPool.length; i++) if (this.unitPool[i].gameObject.activeSelf) this.unitPool[i].gameObject.setActive(false);
    this.RenderDrags();
    this.RenderTutorial();
  }

  private RenderDrags() {
    let li = 0;
    for (const d of this.drags.values()) {
      if (!d.moved && d.sources.length === 1) continue;
      const end = d.hover && !d.sources.includes(d.hover) ? d.hover : null;
      for (const s of d.sources) {
        if (li >= this.lines.length) break;
        if (end === s) continue;
        const a = s.pos, b = end ? end.pos : d.m;
        const dir = b.sub(a), len = dir.magnitude;
        if (len < 0.3) continue;
        const n = dir.div(len);
        const p0 = a.add(n.mul(s.radius * 0.8)), p1 = end ? b.sub(n.mul(end.radius + 0.15)) : b;
        const col = Color.lerp(Colors[d.owner], Color.white, 0.15);
        const l = this.lines[li], sh = this.lineShadows[li], ar = this.arrows[li];
        const w0 = this.toW(p0), w1 = this.toW(p1);
        l.positionCount = 2; l.setPosition(0, w0); l.setPosition(1, w1); l.color = col;
        sh.positionCount = 2; sh.setPosition(0, w0); sh.setPosition(1, w1);
        ar.gameObject.setActive(true);
        ar.transform.localPosition = w1;
        const wd = w1.sub(w0);
        ar.transform.localEulerZ = Math.atan2(wd.y, wd.x) * Mathf.Rad2Deg;
        ar.color = col;
        li++;
      }
    }
    for (let i = li; i < this.lines.length; i++) {
      if (this.lines[i].positionCount === 0) break;
      this.lines[i].positionCount = 0;
      this.lineShadows[i].positionCount = 0;
      this.arrows[i].gameObject.setActive(false);
    }
  }

  /** Level 1: a pulsing arrow from your tower to the nearest grey tower until you send troops. */
  private RenderTutorial() {
    const show = this.State === Phase.Playing && this.mode === Mode.Campaign && this.playLevel <= 1 && !this.humanSent && !this.ended && this.drags.size === 0;
    if (!show) {
      if (this.tutorialLine.positionCount > 0) { this.tutorialLine.positionCount = 0; this.tutorialArrow.gameObject.setActive(false); }
      return;
    }
    const home = this.sim.towers.find((t) => t.owner === 0);
    if (!home) return;
    let tgt: Tower | null = null, bd = 1e9;
    for (const t of this.sim.towers) if (t.owner < 0 && t.troops < home.troops) { const d = V2.distance(t.pos, home.pos); if (d < bd) { bd = d; tgt = t; } }
    if (!tgt) return;
    const k = (Time.time * 0.7) % 1;
    const a = home.pos, b = tgt.pos, n = b.sub(a).normalized;
    const p0 = a.add(n.mul(home.radius)), p1 = b.sub(n.mul(tgt.radius + 0.2));
    const tip = V2.lerp(p0, p1, Mathf.smoothStep(0, 1, k));
    this.tutorialLine.positionCount = 2;
    this.tutorialLine.setPosition(0, this.toW(p0));
    this.tutorialLine.setPosition(1, this.toW(tip));
    this.tutorialLine.color = Color.white.withAlpha(0.85 * (1 - k * 0.5));
    this.tutorialArrow.gameObject.setActive(true);
    this.tutorialArrow.transform.localPosition = this.toW(tip);
    const wd = this.toW(p1).sub(this.toW(p0));
    this.tutorialArrow.transform.localEulerZ = Math.atan2(wd.y, wd.x) * Mathf.Rad2Deg;
  }
}

function CasualUI_set(t: Text | null, s: string) { if (t && t.text !== s) t.text = s; }
