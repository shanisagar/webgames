import {
  ArcadeButton, ArcadeGame, Art, Color, Ease, FontStyle, Fmt, Fx, GameInfo, GameObject, Grid2D, howTo, LineRenderer, Mathf, Mesh,
  MeshRenderer, Pal, Phase, Quaternion, Random, Result, Screen, Sfx, Snd, Sprite, SpriteRenderer, Text, TextAnchor, Time, TouchScheme,
  UIKit, UINode, V2, V2i, V3,
} from "../../kit";

/**
 * FIREWALL: tower defense against a learning virus hive.
 * Viruses route to your data core with a weighted flow field. The hive records where its viruses take damage
 * and adds that "threat" to its path costs, so it reroutes around your kill zones. It also reads which towers
 * did the most damage and brings viruses that resist them. (Port of FirewallGame.cs.)
 */

export enum TowerKind { Blaster, Pulse, Cryo, Rail }

export enum Virus { Bit, Worm, Swarm, Shielded, Kernel }

class Tower {
  Kind = TowerKind.Blaster;
  Cell = V2i.zero;
  Pos = V2.zero;
  Level = 0; Invested = 0;
  Cooldown = 0; Angle = 0; Pulse = 0;
  Base!: SpriteRenderer; Head!: SpriteRenderer; Glow!: SpriteRenderer;
}

class Bug {
  Type = Virus.Bit;
  Pos = V2.zero;
  Cell = V2i.zero; Next = V2i.zero;
  Hp = 0; MaxHp = 0; Speed = 0; SlowFactor = 0; SlowTimer = 0; Armor = 0; Age = 0; Flash = 0;
  Reward = 0; CoreDamage = 0;
  Go!: GameObject;
  Body!: SpriteRenderer; Halo!: SpriteRenderer; Bar!: SpriteRenderer; BarBack!: SpriteRenderer;
}

class Bolt {
  Pos = V2.zero;
  Target: Bug | null = null;
  Damage = 0;
  Sr!: SpriteRenderer;
}

class Beam {
  Line!: LineRenderer;
  T = 0;
  Color = Color.white;
}

interface TowerStats { range: number; damage: number; rate: number }

const TowerName = ["BLASTER", "PULSE", "CRYO", "RAIL"];
const TowerCost = [50, 90, 70, 150];
const TowerColor = [Pal.hex(0x4de8ff), Pal.hex(0xffc84a), Pal.hex(0x7fb2ff), Pal.hex(0xe45cff)];
const VirusColor = [Pal.hex(0xff4d6a), Pal.hex(0xff8a3d), Pal.hex(0xff5cc8), Pal.hex(0xa98cff), Pal.hex(0xff2e2e)];
const VirusPlural = ["BITS", "WORMS", "SWARMS", "SHIELDED", "KERNELS"];
const CoreColor = Pal.hex(0x5cffa0);
const MaxLevel = 3;

const sqrMag = (v: V2i) => v.x * v.x + v.y * v.y;
/** C# "0.#" format. */
const fmt1 = (v: number) => String(Math.round(v * 10) / 10);

export class FirewallGame extends ArcadeGame {
  private world!: GameObject;
  private grid: Grid2D | null = null;
  private flow!: Float32Array;
  private learned!: Float32Array;
  private danger!: Float32Array;
  private blocks!: boolean[];
  private towerAt!: (Tower | null)[];
  private entry = V2i.zero; private core = V2i.zero;
  private entryOutside = V2.zero; private entryDir = V2.zero;
  private floor!: MeshRenderer;
  private floorMesh!: Mesh; private threatMesh: Mesh | null = null;
  private coreSprite!: SpriteRenderer; private coreHalo!: SpriteRenderer; private portal!: SpriteRenderer; private hoverRing: SpriteRenderer | null = null;
  private routeLine!: LineRenderer;
  private readonly route: V3[] = [];
  private readonly blockSprites: SpriteRenderer[] = [];

  private readonly towers: Tower[] = [];
  private readonly bugs: Bug[] = [];
  private readonly bugPool: Bug[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly boltPool: Bolt[] = [];
  private readonly beams: Beam[] = [];
  private readonly queue: Virus[] = [];
  private readonly damageByTower = [0, 0, 0, 0];
  private readonly enemyCells = new Set<number>();

  private credits = 0; private integrity = 0; private wave = 0; private kills = 0; private score = 0; private built = 0;
  private spawnTimer = 0; private buildTimer = 0; private coreHit = 0; private attractTimer = 0;
  private waveActive = false; private rebooted = false;
  private killsReported = 0;
  private selectedBuild = -1;
  private selectedTower: Tower | null = null;

  // HUD
  private creditsText!: Text; private waveText!: Text; private integrityText!: Text; private hiveText!: Text; private panelTitle!: Text; private panelInfo!: Text;
  private readonly buildButtons: ArcadeButton[] = [];
  private startButton!: ArcadeButton; private speedButton!: ArcadeButton; private upgradeButton!: ArcadeButton; private sellButton!: ArcadeButton;
  private panel: UINode | null = null;

  protected Describe() {
    return new GameInfo({
      Id: "firewall",
      Reminders: [
        "Intrusion detected|A new virus strain is probing your core.",
        "The hive rerouted|It found a way around your kill zones. Rebuild.",
        "Core integrity: stable|For now. The next wave is loading.",
      ],
      Title: "FIREWALL",
      Tagline: "DEFEND THE CORE FROM A VIRUS THAT LEARNS",
      Accent: Pal.hex(0x5cffa0),
      Accent2: Pal.hex(0xff4d6a),
      BgTop: Pal.hex(0x061a18),
      BgBottom: Pal.hex(0x02060a),
      ShortSide: 10,
      Touch: TouchScheme.None,
      Music: { bpm: 104, rootHz: 65.41, degrees: [0, 3, 5, 4], seed: 33, energy: 0.6 },
      HowTo: [
        howTo(Art.Hex, CoreColor, "Viruses march on your DATA CORE. Don't let them reach it."),
        howTo(Art.Tri, TowerColor[0], "Pick a tower at the bottom, then tap a free cell to build it."),
        howTo(Art.RoundSquare, Pal.TextDim, "Towers are walls: shape the maze, but never seal the path."),
        howTo(Art.Ring, TowerColor[1], "BLASTER hits one target, PULSE hits all nearby, CRYO slows, RAIL pierces."),
        howTo(Art.Plus, Pal.Warn, "Tap a tower to UPGRADE (3 levels) or SELL it."),
        howTo(Art.Eye, Pal.hex(0xff4d6a), "The HIVE remembers its kill zones and reroutes around them."),
        howTo(Art.Star, VirusColor[3], "It also brings viruses that resist your favourite tower. Mix it up."),
      ],
      Tips: [
        "Watch the red threat map: that's where the hive won't go next wave.",
        "Worms are armoured: Rail and upgraded towers punch through.",
        "Shielded viruses shrug off Pulse and can't be slowed.",
        "Swarms overwhelm single-target towers. Pulse them.",
        "Starting a wave early pays bonus credits.",
      ],
    });
  }

  protected BestLine() {
    const best = this.Data.get("bestWave");
    return best > 0 ? `BEST  WAVE ${best}   ·   ${Fmt.n(this.Data.get("best"))} PTS` : "";
  }

  protected StatsLine() {
    return this.Data.get("runs") > 0 ? `${Fmt.n(this.Data.get("runs"))} RUNS  ·  ${Fmt.n(this.Data.get("kills"))} VIRUSES PURGED` : "TOWER DEFENSE";
  }

  // Fit the whole grid inside the space between the HUD bands, in either orientation.
  protected get ShortSide() {
    const grid = this.grid;
    if (grid == null) return this.Info.ShortSide;
    const top = 230, bottom = 300, margin = 0.8;
    const aspect = Screen.width / Math.max(1, Screen.height);
    if (aspect < 1) {
      const byWidth = grid.W + margin;
      const byHeight = (grid.H + margin) / (1 / aspect - (top + bottom) / 1080);
      return Math.max(byWidth, byHeight);
    }
    const h = (grid.H + margin) / (1 - (top + bottom) / 1080);
    const w = (grid.W + margin) / aspect;
    return Math.max(h, w);
  }

  // ------------------------------------------------------------------ build

  protected Build() {
    this.world = new GameObject("World", this.gameObject);
    this.floorMesh = new Mesh();
    this.threatMesh = new Mesh();
    this.floor = Art.meshObject(this.world, "Floor", this.floorMesh, Art.Flat, 1);
    Art.meshObject(this.world, "Threat Map", this.threatMesh, Art.Flat, 2);
    this.routeLine = Art.line(this.world, "Route", Pal.hex(0xff4d6a).withAlpha(0.35), 0.08, 3);
    this.coreHalo = Art.spr(this.world, "Core Halo", Art.Glow, CoreColor.withAlpha(0.5), 3, 8, Art.Additive);
    this.coreSprite = Art.spr(this.world, "Core", Art.Hex, CoreColor, 0.95, 9);
    this.portal = Art.spr(this.world, "Portal", Art.Ring, VirusColor[0].withAlpha(0.7), 1.1, 8, Art.Additive);
    this.hoverRing = Art.spr(this.world, "Range", Art.ThinRing, Color.white, 1, 40, Art.Additive);
    this.hoverRing.gameObject.setActive(false);
    this.BuildHud();
    this.SetupGrid();
  }

  private BuildHud() {
    const hud = this.UI.Hud;
    this.creditsText = UIKit.at(UIKit.label(hud, "", 46, Pal.Warn, TextAnchor.MiddleLeft), new V2(0, 1), new V2(210, -70), new V2(360, 70));
    this.waveText = UIKit.at(UIKit.label(hud, "", 44, Pal.Text), new V2(0.5, 1), new V2(0, -70), new V2(520, 70));
    this.integrityText = UIKit.at(UIKit.label(hud, "", 40, CoreColor, TextAnchor.MiddleRight), new V2(1, 1), new V2(-330, -70), new V2(300, 70));
    this.hiveText = UIKit.at(UIKit.label(hud, "", 26, this.Info.Accent2), new V2(0.5, 1), new V2(0, -135), new V2(1000, 40));
    this.speedButton = UIKit.buttonAt(hud, "1x", new V2(0, 1), new V2(80, -170), new V2(120, 70), false, () => this.ToggleSpeed(), 32);
    this.speedButton.setAccent(this.Info.Accent);

    const icons: Sprite[] = [Art.Tri, Art.Ring, Art.Star, Art.Diamond];
    for (let i = 0; i < 4; i++) {
      const kind = i;
      const b = UIKit.buttonAt(hud, String(TowerCost[i]), new V2(0.5, 0), new V2(-410 + i * 205, 125), new V2(190, 190), false, () => this.SelectBuild(kind), 32, icons[i]);
      b.setAccent(TowerColor[i]);
      this.buildButtons[i] = b;
    }
    this.startButton = UIKit.buttonAt(hud, "START", new V2(0.5, 0), new V2(410, 125), new V2(190, 190), true, () => this.StartWaveEarly(), 38);
    this.startButton.setAccent(this.Info.Accent);

    const panel = (this.panel = UIKit.card(hud, new V2(780, 170), this.Info.Accent, V2.zero));
    panel.anchorMin = panel.anchorMax = new V2(0.5, 0);
    panel.anchoredPosition = new V2(0, 330);
    this.panelTitle = UIKit.at(UIKit.label(panel, "", 38, Pal.Text, TextAnchor.MiddleLeft), new V2(0, 0.5), new V2(200, 30), new V2(360, 50));
    this.panelInfo = UIKit.at(UIKit.label(panel, "", 24, Pal.TextDim, TextAnchor.MiddleLeft, FontStyle.Normal), new V2(0, 0.5), new V2(200, -28), new V2(360, 40));
    this.upgradeButton = UIKit.buttonAt(panel, "UPGRADE", new V2(1, 0.5), new V2(-280, 0), new V2(200, 120), true, () => this.UpgradeSelected(), 28);
    this.sellButton = UIKit.buttonAt(panel, "SELL", new V2(1, 0.5), new V2(-95, 0), new V2(150, 120), false, () => this.SellSelected(), 28);
    this.sellButton.setAccent(Pal.Danger);
    panel.setActive(false);
  }

  private SetupGrid() {
    const portrait = Screen.height >= Screen.width;
    const w = portrait ? 9 : 17, h = portrait ? 13 : 8;
    const grid = (this.grid = new Grid2D(w, h, new V2(-w * 0.5, -h * 0.5)));
    this.flow = new Float32Array(w * h);
    this.learned = new Float32Array(w * h);
    this.danger = new Float32Array(w * h);
    this.blocks = new Array<boolean>(w * h).fill(false);
    this.towerAt = new Array<Tower | null>(w * h).fill(null);
    if (portrait) {
      this.entry = new V2i(Math.floor(w / 2), h - 1);
      this.core = new V2i(Math.floor(w / 2), 0);
      this.entryDir = V2.down;
    } else {
      this.entry = new V2i(0, Math.floor(h / 2));
      this.core = new V2i(w - 1, Math.floor(h / 2));
      this.entryDir = V2.right;
    }
    this.entryOutside = grid.toWorld(this.entry).sub(this.entryDir.mul(1.2));

    // A few data blocks for variety; never on the spine, and the path must stay open.
    for (const s of this.blockSprites) s.gameObject.destroy();
    this.blockSprites.length = 0;
    let placed = 0;
    for (let attempt = 0; attempt < 60 && placed < (portrait ? 5 : 6); attempt++) {
      const x = Random.rangeInt(0, w), y = Random.rangeInt(1, h - 1);
      const c = new V2i(x, y);
      if (c.equals(this.entry) || c.equals(this.core) || sqrMag(c.sub(this.entry)) < 3 || sqrMag(c.sub(this.core)) < 3) continue;
      if (grid.isSolid(x, y)) continue;
      grid.setSolid(x, y, true);
      if (!grid.reachable(this.entry, this.core)) { grid.setSolid(x, y, false); continue; }
      this.blocks[grid.index(x, y)] = true;
      const sr = Art.spr(this.world, "Block", Art.RoundSquare, Pal.hex(0x25304a), 0.9, 4);
      sr.transform.position = grid.toWorld(x, y);
      this.blockSprites.push(sr);
      placed++;
    }

    this.coreSprite.transform.position = grid.toWorld(this.core);
    this.coreHalo.transform.position = grid.toWorld(this.core);
    this.portal.transform.position = this.entryOutside.add(this.entryDir.mul(0.5));
    this.floor.gameObject.setActive(true);
    this.RebuildFloor();
    this.RecomputeFlow();
    this.CenterCamera();
  }

  private RebuildFloor() {
    const grid = this.grid!;
    grid.buildMesh((x, y) => {
      if (this.blocks[grid.index(x, y)]) return Color.clear;
      const odd = ((x + y) & 1) === 1;
      return odd ? new Color(0.09, 0.16, 0.2, 0.75) : new Color(0.06, 0.12, 0.16, 0.75);
    }, 0.03, this.floorMesh);
  }

  private RebuildThreat() {
    const grid = this.grid!;
    let max = 0.001;
    for (const v of this.learned) max = Math.max(max, v);
    grid.buildMesh((x, y) => {
      const v = this.learned[grid.index(x, y)] / max;
      return v < 0.05 ? Color.clear : new Color(1, 0.2, 0.3, v * 0.3);
    }, 0.08, this.threatMesh);
  }

  private CenterCamera() {
    const r = this.PlayRect(230, 300, 0);
    this.Fx.CameraTarget = r.center.neg();
  }

  protected OnLayoutChanged() { this.CenterCamera(); }

  // ------------------------------------------------------------------ flow field

  private RecomputeFlow() {
    const grid = this.grid!;
    grid.flowField(this.core, this.flow, this.learned);
    this.route.length = 0;
    let c = this.entry;
    for (let guard = 0; guard < 400 && !c.equals(this.core); guard++) {
      this.route.push(grid.toWorld(c).toV3());
      const n = this.NextCell(c);
      if (n.equals(c)) break;
      c = n;
    }
    this.route.push(grid.toWorld(this.core).toV3());
    this.routeLine.positionCount = this.route.length;
    this.routeLine.setPositions(this.route);
  }

  private NextCell(c: V2i) {
    const grid = this.grid!;
    if (!grid.inBounds(c.x, c.y)) return this.entry;
    let best = c;
    let bestD = this.flow[grid.index(c.x, c.y)];
    for (const d of Grid2D.Dirs4) {
      const n = c.add(d);
      if (grid.isSolid(n)) continue;
      const v = this.flow[grid.index(n.x, n.y)];
      if (v < bestD) { bestD = v; best = n; }
    }
    return best;
  }

  // ------------------------------------------------------------------ run lifecycle

  protected OnEnterTitle() {
    this.ClearRun();
    this.SetupGrid();
    this.UI.SetPauseButton(true);
    this.attractTimer = 0;
  }

  protected BeginRun() {
    this.ClearRun();
    this.SetupGrid();
    this.credits = 160;
    this.integrity = 20;
    this.wave = this.kills = this.score = this.built = 0;
    this.rebooted = false;
    this.killsReported = 0;
    this.SpeedMultiplier = 1;
    this.speedButton.label!.text = "1x";
    for (let i = 0; i < 4; i++) this.damageByTower[i] = 0;
    this.EnterBuildPhase(18);
    if (this.Data.get("runs") === 0) this.UI.Hint("Pick a tower below, then tap a free cell to build it.");
  }

  private ClearRun() {
    for (const t of this.towers) t.Base.transform.parent!.destroy();
    this.towers.length = 0;
    for (let i = this.bugs.length - 1; i >= 0; i--) this.RecycleBug(this.bugs[i]);
    this.bugs.length = 0;
    for (const b of this.bolts) { b.Sr.gameObject.setActive(false); this.boltPool.push(b); }
    this.bolts.length = 0;
    this.queue.length = 0;
    this.selectedTower = null;
    this.selectedBuild = -1;
    if (this.panel != null) this.panel.setActive(false);
    if (this.hoverRing != null) this.hoverRing.gameObject.setActive(false);
    if (this.learned != null) for (let i = 0; i < this.learned.length; i++) this.learned[i] = this.danger[i] = 0;
    if (this.threatMesh != null) this.threatMesh.clear();
    this.waveActive = false;
    this.UI.Hint(null);
  }

  private EnterBuildPhase(seconds: number) {
    this.waveActive = false;
    this.buildTimer = seconds;
    this.startButton.gameObject.setActive(true);
    Sfx.setIntensity(0.2);
  }

  private StartWaveEarly() {
    if (this.waveActive || this.State !== Phase.Playing) return;
    const bonus = Mathf.roundToInt(this.buildTimer * 2);
    if (bonus > 0 && this.wave > 0) {
      this.credits += bonus;
      this.UI.Float(this.grid!.toWorld(this.entry), "+" + bonus + " EARLY", Pal.Warn, 0.9);
    }
    this.StartWave();
  }

  private StartWave() {
    this.wave++;
    this.waveActive = true;
    this.startButton.gameObject.setActive(false);
    this.queue.length = 0;
    const insight = this.PlanWave();
    this.spawnTimer = 0.5;
    this.UI.Announce(this.wave % 10 === 0 ? "WAVE " + this.wave + ": KERNEL" : "WAVE " + this.wave, this.wave % 10 === 0 ? VirusColor[4] : this.Info.Accent);
    this.hiveText.text = insight ?? "";
    if (insight != null) Sfx.play(Snd.Alarm, 0.4);
    if (this.wave === 2 && this.Data.get("runs") === 0) this.UI.Hint("The hive learns where its viruses die. The red map shows the zones it avoids.");
    else this.UI.Hint(null);
    for (let i = 0; i < 4; i++) this.damageByTower[i] = 0;
    Sfx.setIntensity(0.45 + Math.min(this.wave * 0.04, 0.55));
  }

  /** The hive's counter-strategy: resist whichever tower type did the most damage last wave. */
  private PlanWave(): string | null {
    const wave = this.wave, damageByTower = this.damageByTower;
    const weight = [1, wave >= 3 ? 0.5 : 0, wave >= 2 ? 0.5 : 0, wave >= 4 ? 0.45 : 0];
    let insight: string | null = null;
    const total = damageByTower[0] + damageByTower[1] + damageByTower[2] + damageByTower[3];
    if (wave > 2 && total > 0) {
      let top = 0;
      for (let i = 1; i < 4; i++) if (damageByTower[i] > damageByTower[top]) top = i;
      const share = damageByTower[top] / total;
      if (share > 0.4) {
        const counter = top === 0 ? Virus.Worm : top === 1 ? Virus.Shielded : top === 2 ? Virus.Shielded : Virus.Swarm;
        if (weight[counter] <= 0) weight[counter] = 0.4;
        weight[counter] *= 1 + share * 2.5;
        insight = `HIVE ANALYSIS: ${Mathf.roundToInt(share * 100)}% OF DAMAGE FROM ${TowerName[top]}  ·  SENDING ${VirusPlural[counter]}`;
      }
    }

    let budget = 8 + wave * 4;
    const sum = weight[0] + weight[1] + weight[2] + weight[3];
    while (budget > 0) {
      let r = Random.value * sum;
      let pick = 0;
      for (let i = 0; i < 4; i++) { r -= weight[i]; if (r <= 0) { pick = i; break; } }
      switch (pick as Virus) {
        case Virus.Swarm: for (let k = 0; k < 4; k++) this.queue.push(Virus.Swarm); budget -= 2; break;
        case Virus.Worm: this.queue.push(Virus.Worm); budget -= 3; break;
        case Virus.Shielded: this.queue.push(Virus.Shielded); budget -= 2; break;
        default: this.queue.push(Virus.Bit); budget -= 1; break;
      }
    }
    if (wave % 10 === 0) this.queue.push(Virus.Kernel);
    return insight;
  }

  private EndWave() {
    // Learn: this wave's damage map becomes next wave's routing cost.
    let max = 0.001;
    for (const v of this.danger) max = Math.max(max, v);
    const strength = Math.min(1.5 + this.wave * 0.6, 7);
    for (let i = 0; i < this.danger.length; i++) {
      this.learned[i] = this.learned[i] * 0.5 + (this.danger[i] / max) * strength;
      this.danger[i] = 0;
    }
    this.RebuildThreat();
    this.RecomputeFlow();

    const bonus = 20 + this.wave * 5;
    this.credits += bonus;
    this.score += this.wave * 200;
    Sfx.play(Snd.Win, 0.6);
    this.UI.Announce("WAVE " + this.wave + " PURGED  +" + bonus, Pal.Good);
    this.hiveText.text = "HIVE REROUTING AROUND YOUR KILL ZONES";
    this.EnterBuildPhase(12);
  }

  // ------------------------------------------------------------------ frame

  protected TickBackground(dt: number) {
    if (this.State !== Phase.Title) return;
    this.attractTimer -= dt;
    if (this.attractTimer <= 0 && this.bugs.length < 10) {
      this.SpawnBug(Random.rangeInt(0, 4) as Virus, 1);
      this.attractTimer = 0.8;
    }
    this.MoveBugs(dt, true);
    this.AnimateScenery(dt);
  }

  protected TickRun(dt: number) {
    this.HandleInput();

    if (!this.waveActive) {
      this.buildTimer -= dt;
      if (this.buildTimer <= 0) this.StartWave();
    } else {
      this.spawnTimer -= dt;
      if (this.queue.length > 0 && this.spawnTimer <= 0) {
        const type = this.queue[0];
        this.queue.splice(0, 1);
        this.SpawnBug(type, Math.pow(1.13, this.wave - 1));
        this.spawnTimer = type === Virus.Swarm ? 0.22 : Mathf.lerp(0.8, 0.4, this.wave / 25);
      }
      if (this.queue.length === 0 && this.bugs.length === 0) this.EndWave();
    }

    this.UpdateTowers(dt);
    this.MoveBugs(dt, false);
    this.UpdateBolts(dt);
    this.AnimateScenery(dt);
    this.UpdateHud();

    if (this.integrity <= 0) this.GameOver();
  }

  private HandleInput() {
    const grid = this.grid!, hoverRing = this.hoverRing!;
    // Mouse hover preview of range for the selected build.
    if (this.selectedBuild >= 0 && !this.Controls.usingTouch) {
      const c = grid.toCell(this.ScreenToWorld(this.Controls.pointerScreen));
      const ok = grid.inBounds(c.x, c.y) && !grid.isSolid(c);
      hoverRing.gameObject.setActive(ok);
      if (ok) this.ShowRange(grid.toWorld(c), FirewallGame.Stats(this.selectedBuild, 0).range, TowerColor[this.selectedBuild]);
    } else if (this.selectedTower == null) hoverRing.gameObject.setActive(false);

    if (!this.Controls.tapped) return;
    const world = this.ScreenToWorld(this.Controls.tapScreen);
    const cell = grid.toCell(world);
    if (!grid.inBounds(cell.x, cell.y)) {
      this.Deselect();
      return;
    }
    const existing = this.towerAt[grid.index(cell.x, cell.y)];
    if (existing != null) {
      this.SelectTower(existing);
      return;
    }
    if (this.selectedBuild >= 0) this.TryBuild(cell, this.selectedBuild);
    else this.Deselect();
  }

  private SelectBuild(kind: number) {
    this.selectedTower = null;
    this.panel!.setActive(false);
    this.selectedBuild = this.selectedBuild === kind ? -1 : kind;
    this.RefreshBuildButtons();
    if (this.selectedBuild >= 0 && this.Controls.usingTouch) this.UI.Hint("Tap a free cell to build a " + TowerName[kind] + ".");
    else if (this.selectedBuild < 0) this.UI.Hint(null);
  }

  private Deselect() {
    this.selectedBuild = -1;
    this.selectedTower = null;
    this.panel!.setActive(false);
    this.hoverRing!.gameObject.setActive(false);
    this.RefreshBuildButtons();
  }

  private RefreshBuildButtons() {
    for (let i = 0; i < 4; i++) {
      this.buildButtons[i].primary = i === this.selectedBuild;
      this.buildButtons[i].setAccent(TowerColor[i]);
    }
  }

  private TryBuild(cell: V2i, kind: number) {
    const grid = this.grid!;
    if (this.credits < TowerCost[kind]) {
      Sfx.play(Snd.Deny);
      this.UI.Float(grid.toWorld(cell), "NEED " + TowerCost[kind], Pal.Danger, 0.8);
      return;
    }
    if (grid.isSolid(cell) || cell.equals(this.core) || !this.PathStaysOpen(cell)) {
      Sfx.play(Snd.Deny);
      this.UI.Float(grid.toWorld(cell), cell.equals(this.core) ? "THAT'S THE CORE" : "BLOCKS THE PATH", Pal.Danger, 0.8);
      return;
    }

    this.credits -= TowerCost[kind];
    this.built++;
    const t = new Tower();
    t.Kind = kind as TowerKind; t.Cell = cell; t.Pos = grid.toWorld(cell); t.Invested = TowerCost[kind];
    const root = new GameObject(TowerName[kind], this.world);
    root.position = t.Pos;
    t.Glow = Art.spr(root, "Glow", Art.Glow, TowerColor[kind].withAlpha(0.3), 1.8, 10, Art.Additive);
    t.Base = Art.spr(root, "Base", Art.RoundSquare, Pal.hex(0x1a2436), 0.86, 11);
    const head = kind === 0 ? Art.Tri : kind === 1 ? Art.Ring : kind === 2 ? Art.Star : Art.Diamond;
    t.Head = Art.spr(root, "Head", head, TowerColor[kind], kind === 3 ? 0.7 : 0.55, 12);
    if (kind === 3) t.Head.transform.localScale = new V3(0.8, 0.4, 1);
    this.towers.push(t);
    this.towerAt[grid.index(cell.x, cell.y)] = t;
    grid.setSolid(cell.x, cell.y, true);
    this.RecomputeFlow();
    Sfx.play(Snd.Build);
    this.Fx.burst(t.Pos, TowerColor[kind], 12, 3);
    this.Fx.ring(t.Pos, TowerColor[kind], 0.3, 1.6, 0.3);
    this.UI.Hint(null);
    if (this.credits < TowerCost[kind]) this.Deselect();
  }

  /** Building on `cell` must leave a route from the entry and from every virus to the core. */
  private PathStaysOpen(cell: V2i) {
    const grid = this.grid!;
    this.enemyCells.clear();
    for (const b of this.bugs) {
      if (b.Cell.equals(cell) || b.Next.equals(cell)) return false;
      if (grid.inBounds(b.Cell.x, b.Cell.y)) this.enemyCells.add(grid.index(b.Cell.x, b.Cell.y));
    }
    grid.setSolid(cell.x, cell.y, true);
    let open = grid.reachable(this.entry, this.core);
    if (open)
      for (const i of this.enemyCells)
        if (!grid.reachable(new V2i(i % grid.W, Math.floor(i / grid.W)), this.core)) { open = false; break; }
    grid.setSolid(cell.x, cell.y, false);
    return open;
  }

  private SelectTower(t: Tower) {
    this.selectedBuild = -1;
    this.RefreshBuildButtons();
    this.selectedTower = t;
    this.UI.Hint(null); // the tower panel sits where the hint bar is
    this.panel!.setActive(true);
    this.RefreshPanel();
    Sfx.play(Snd.Click, 0.6);
  }

  private RefreshPanel() {
    const t = this.selectedTower;
    if (t == null) return;
    const s = FirewallGame.Stats(t.Kind, t.Level);
    this.panelTitle.text = TowerName[t.Kind] + "  LV" + (t.Level + 1);
    this.panelTitle.color = TowerColor[t.Kind];
    this.panelInfo.text = t.Kind === TowerKind.Cryo
      ? `RANGE ${s.range.toFixed(1)}  ·  SLOW ${Mathf.roundToInt(s.damage * 100)}%`
      : `RANGE ${s.range.toFixed(1)}  ·  DMG ${fmt1(s.damage)}`;
    const maxed = t.Level >= MaxLevel - 1;
    this.upgradeButton.label!.text = maxed ? "MAX" : "UP " + this.UpgradeCost(t);
    this.upgradeButton.interactable = !maxed && this.credits >= this.UpgradeCost(t);
    this.sellButton.label!.text = "+" + FirewallGame.SellValue(t);
    this.ShowRange(t.Pos, s.range, TowerColor[t.Kind]);
  }

  private UpgradeCost(t: Tower) { return Mathf.roundToInt(TowerCost[t.Kind] * 0.8 * (t.Level + 1)); }
  private static SellValue(t: Tower) { return Mathf.roundToInt(t.Invested * 0.7); }

  private UpgradeSelected() {
    const t = this.selectedTower;
    if (t == null || t.Level >= MaxLevel - 1 || this.credits < this.UpgradeCost(t)) return;
    const cost = this.UpgradeCost(t);
    this.credits -= cost;
    t.Invested += cost;
    t.Level++;
    const s = 1 + t.Level * 0.15;
    const k = 0.86 * Math.min(s, 1.1);
    t.Base.transform.localScale = new V3(k, k, Math.min(s, 1.1));
    t.Glow.color = TowerColor[t.Kind].withAlpha(0.3 + t.Level * 0.15);
    Sfx.play(Snd.PowerUp, 0.7);
    this.Fx.ring(t.Pos, TowerColor[t.Kind], 0.3, 2.2, 0.35);
    this.RefreshPanel();
  }

  private SellSelected() {
    const t = this.selectedTower;
    if (t == null) return;
    const grid = this.grid!;
    this.credits += FirewallGame.SellValue(t);
    this.towers.splice(this.towers.indexOf(t), 1);
    this.towerAt[grid.index(t.Cell.x, t.Cell.y)] = null;
    grid.setSolid(t.Cell.x, t.Cell.y, false);
    this.Fx.burst(t.Pos, TowerColor[t.Kind], 14, 3);
    t.Base.transform.parent!.destroy();
    Sfx.play(Snd.Coin);
    this.RecomputeFlow();
    this.Deselect();
  }

  private ToggleSpeed() {
    this.SpeedMultiplier = this.SpeedMultiplier > 1 ? 1 : 2;
    this.speedButton.label!.text = this.SpeedMultiplier > 1 ? "2x" : "1x";
  }

  private ShowRange(pos: V2, range: number, c: Color) {
    const hoverRing = this.hoverRing!;
    hoverRing.gameObject.setActive(true);
    hoverRing.transform.position = pos;
    const d = (range * 2) / 0.9;
    hoverRing.transform.localScale = new V3(d, d, 1);
    hoverRing.color = c.withAlpha(0.5);
  }

  // ------------------------------------------------------------------ towers

  private static Stats(kind: number, level: number): TowerStats {
    const mult = Math.pow(1.65, level);
    switch (kind as TowerKind) {
      case TowerKind.Blaster: return { range: 2.6 + 0.3 * level, damage: 4 * mult, rate: 2.6 };
      case TowerKind.Pulse: return { range: 1.7 + 0.2 * level, damage: 3 * mult, rate: 0.9 };
      case TowerKind.Cryo: return { range: 2 + 0.3 * level, damage: 0.4 + 0.1 * level, rate: 2 };
      default: return { range: 5 + 0.5 * level, damage: 22 * mult, rate: 0.45 };
    }
  }

  private UpdateTowers(dt: number) {
    for (const t of this.towers) {
      const s = FirewallGame.Stats(t.Kind, t.Level);
      t.Cooldown -= dt;
      t.Pulse = Mathf.moveTowards(t.Pulse, 0, dt * 4);
      const target = this.FirstInRange(t.Pos, s.range);
      if (target != null && t.Kind !== TowerKind.Pulse && t.Kind !== TowerKind.Cryo) {
        const d = target.Pos.sub(t.Pos);
        t.Angle = Mathf.lerpAngle(t.Angle, Math.atan2(d.y, d.x) * Mathf.Rad2Deg, 1 - Math.exp(-dt * 14));
      }
      if (t.Kind === TowerKind.Cryo) t.Angle += dt * 60;
      t.Head.transform.localRotation = Quaternion.euler(0, 0, t.Angle);
      const ps = 1 + t.Pulse * 0.4;
      t.Glow.transform.localScale = new V3(1.8 * ps, 1.8 * ps, 1);

      if (t.Cooldown > 0 || target == null) continue;
      t.Cooldown = 1 / s.rate;
      t.Pulse = 1;
      switch (t.Kind) {
        case TowerKind.Blaster:
          this.FireBolt(t, target, s.damage);
          Sfx.play(Snd.Shoot, 0.25, 1.2);
          break;
        case TowerKind.Pulse:
          for (let i = this.bugs.length - 1; i >= 0; i--)
            if (this.bugs[i].Pos.sub(t.Pos).sqrMagnitude <= s.range * s.range) this.Hit(this.bugs[i], s.damage, TowerKind.Pulse);
          this.Fx.ring(t.Pos, TowerColor[1], 0.3, s.range * 2.2, 0.3);
          Sfx.play(Snd.Zap, 0.3);
          break;
        case TowerKind.Cryo:
          for (const b of this.bugs) {
            if (b.Pos.sub(t.Pos).sqrMagnitude > s.range * s.range || b.Type === Virus.Shielded || b.Type === Virus.Kernel) continue;
            b.SlowFactor = Math.max(b.SlowFactor, s.damage);
            b.SlowTimer = 1.2;
            this.damageByTower[2] += 1; // count slow applications so the hive can react to cryo-heavy defences
          }
          this.Fx.ring(t.Pos, TowerColor[2], 0.3, s.range * 2.2, 0.4);
          break;
        case TowerKind.Rail:
          this.FireRail(t, target, s);
          break;
      }
    }
  }

  private FirstInRange(pos: V2, range: number) {
    const grid = this.grid!;
    let best: Bug | null = null;
    let bestFlow = Number.MAX_VALUE;
    const r2 = range * range;
    for (const b of this.bugs) {
      if (b.Age < 0.2 || b.Pos.sub(pos).sqrMagnitude > r2) continue;
      const f = grid.inBounds(b.Cell.x, b.Cell.y) ? this.flow[grid.index(b.Cell.x, b.Cell.y)] : 999;
      if (f < bestFlow) { bestFlow = f; best = b; }
    }
    return best;
  }

  private FireBolt(t: Tower, target: Bug, dmg: number) {
    let b = this.boltPool.pop();
    if (!b) { b = new Bolt(); b.Sr = Art.spr(this.world, "Bolt", Art.Disc, TowerColor[0], 0.2, 30, Art.Additive); }
    b.Sr.gameObject.setActive(true);
    b.Pos = t.Pos;
    b.Target = target;
    b.Damage = dmg;
    this.bolts.push(b);
  }

  private FireRail(t: Tower, target: Bug, s: TowerStats) {
    const dir = target.Pos.sub(t.Pos).normalized;
    const end = t.Pos.add(dir.mul(s.range));
    for (let i = this.bugs.length - 1; i >= 0; i--) {
      const b = this.bugs[i];
      const ab = end.sub(t.Pos);
      const k = Mathf.clamp01(V2.dot(b.Pos.sub(t.Pos), ab) / ab.sqrMagnitude);
      if (t.Pos.add(ab.mul(k)).sub(b.Pos).sqrMagnitude < 0.16) this.Hit(b, s.damage, TowerKind.Rail);
    }
    let beam: Beam | null = null;
    for (const x of this.beams) if (!x.Line.gameObject.activeSelf) { beam = x; break; }
    if (beam == null) {
      beam = new Beam();
      beam.Line = Art.line(this.world, "Rail", Color.white, 0.12, 32);
      beam.Line.positionCount = 2;
      this.beams.push(beam);
    }
    beam.Line.gameObject.setActive(true);
    beam.Line.setPosition(0, t.Pos);
    beam.Line.setPosition(1, end);
    beam.T = 0.25;
    beam.Color = TowerColor[3];
    Sfx.play(Snd.Laser, 0.5, 1.3);
    this.Fx.shake(0.08);
  }

  private UpdateBolts(dt: number) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      let gone = b.Target == null || !this.bugs.includes(b.Target);
      if (!gone) {
        const to = b.Target!.Pos.sub(b.Pos);
        const step = 14 * dt;
        if (to.magnitude <= step + 0.1) {
          this.Hit(b.Target!, b.Damage, TowerKind.Blaster);
          gone = true;
        } else b.Pos = b.Pos.add(to.normalized.mul(step));
      }
      if (gone) {
        b.Sr.gameObject.setActive(false);
        this.boltPool.push(b);
        this.bolts.splice(i, 1);
        continue;
      }
      b.Sr.transform.position = b.Pos;
    }
    for (const beam of this.beams) {
      if (!beam.Line.gameObject.activeSelf) continue;
      beam.T -= dt;
      if (beam.T <= 0) { beam.Line.gameObject.setActive(false); continue; }
      beam.Line.startColor = beam.Line.endColor = beam.Color.withAlpha(beam.T / 0.25);
      beam.Line.widthMultiplier = (0.2 * beam.T) / 0.25;
    }
  }

  // ------------------------------------------------------------------ viruses

  private SpawnBug(type: Virus, hpScale: number) {
    const b = this.bugPool.pop() ?? this.CreateBug();
    b.Go.setActive(true);
    b.Type = type;
    b.Pos = this.entryOutside.add(Random.insideUnitCircle.mul(0.2));
    b.Cell = this.entry;
    b.Next = this.entry;
    b.Age = b.Flash = b.SlowTimer = b.SlowFactor = 0;
    let hp: number, size: number, s: Sprite;
    switch (type) {
      case Virus.Worm: hp = 40; b.Speed = 0.95; b.Armor = 2; b.Reward = 10; b.CoreDamage = 2; size = 0.7; s = Art.Octagon; break;
      case Virus.Swarm: hp = 5; b.Speed = 2.3; b.Armor = 0; b.Reward = 2; b.CoreDamage = 1; size = 0.32; s = Art.Disc; break;
      case Virus.Shielded: hp = 24; b.Speed = 1.3; b.Armor = 0; b.Reward = 8; b.CoreDamage = 1; size = 0.55; s = Art.Hex; break;
      case Virus.Kernel: hp = 420; b.Speed = 0.6; b.Armor = 3; b.Reward = 150; b.CoreDamage = 10; size = 0.95; s = Art.Star; break;
      default: hp = 10; b.Speed = 1.8; b.Armor = 0; b.Reward = 4; b.CoreDamage = 1; size = 0.45; s = Art.Diamond; break;
    }
    b.MaxHp = b.Hp = hp * hpScale;
    b.Body.sprite = s;
    b.Body.transform.localScale = new V3(size, size, 1);
    b.Halo.transform.localScale = new V3(size * 2.4, size * 2.4, 1);
    b.Body.color = VirusColor[type];
    b.Halo.color = VirusColor[type].withAlpha(0.35);
    b.BarBack.transform.localPosition = b.Bar.transform.localPosition = new V3(0, size * 0.7 + 0.1, 0);
    this.bugs.push(b);
  }

  private CreateBug() {
    const b = new Bug();
    b.Go = new GameObject("Virus", this.world);
    b.Halo = Art.spr(b.Go, "Halo", Art.Glow, Color.white, 1, 19, Art.Additive);
    b.Body = Art.spr(b.Go, "Body", Art.Diamond, Color.white, 1, 20);
    b.BarBack = Art.spr(b.Go, "HP Back", Art.Square, new Color(0, 0, 0, 0.6), 1, 21);
    b.Bar = Art.spr(b.Go, "HP", Art.Square, Pal.Good, 1, 22);
    return b;
  }

  private RecycleBug(b: Bug) {
    b.Go.setActive(false);
    this.bugPool.push(b);
  }

  private MoveBugs(dt: number, attract: boolean) {
    const grid = this.grid!;
    for (let i = this.bugs.length - 1; i >= 0; i--) {
      const b = this.bugs[i];
      b.Age += dt;
      b.Flash = Math.max(0, b.Flash - dt * 6);
      if (b.SlowTimer > 0) b.SlowTimer -= dt;
      else b.SlowFactor = 0;
      const speed = b.Speed * (1 - b.SlowFactor);

      const target = grid.toWorld(b.Next);
      const to = target.sub(b.Pos);
      const step = speed * dt;
      if (to.magnitude <= step) {
        b.Pos = target;
        b.Cell = b.Next;
        if (b.Cell.equals(this.core)) {
          if (!attract) this.BreachCore(b);
          this.bugs.splice(i, 1);
          this.RecycleBug(b);
          continue;
        }
        b.Next = this.NextCell(b.Cell);
      } else b.Pos = b.Pos.add(to.div(to.magnitude).mul(step));

      b.Go.transform.position = b.Pos;
      const pop = Ease.outBack(Mathf.clamp01(b.Age / 0.3));
      b.Go.transform.localScale = new V3(pop, pop, 1);
      b.Body.transform.localRotation = Quaternion.euler(0, 0, b.Age * (b.Type === Virus.Kernel ? 40 : 120));
      let c = VirusColor[b.Type];
      if (b.SlowTimer > 0) c = Color.lerp(c, TowerColor[2], 0.5);
      b.Body.color = Color.lerp(c, Color.white, b.Flash);
      const frac = Mathf.clamp01(b.Hp / b.MaxHp);
      const showBar = frac < 0.999;
      b.Bar.gameObject.setActive(showBar);
      b.BarBack.gameObject.setActive(showBar);
      if (showBar) {
        b.BarBack.transform.localScale = new V3(0.6, 0.08, 1);
        b.Bar.transform.localScale = new V3(0.6 * frac, 0.08, 1);
        b.Bar.transform.localPosition = new V3(-0.3 * (1 - frac), b.BarBack.transform.localPosition.y, 0);
        b.Bar.color = Color.lerp(Pal.Danger, Pal.Good, frac);
      }
    }
  }

  private Hit(b: Bug, amount: number, from: TowerKind) {
    if (!this.bugs.includes(b)) return;
    const grid = this.grid!;
    let dmg = Math.max(amount * 0.25, amount - b.Armor);
    if (b.Type === Virus.Shielded && from === TowerKind.Pulse) dmg *= 0.3;
    dmg = Math.min(dmg, b.Hp);
    b.Hp -= dmg;
    b.Flash = 1;
    this.damageByTower[from] += dmg;
    if (grid.inBounds(b.Cell.x, b.Cell.y)) this.danger[grid.index(b.Cell.x, b.Cell.y)] += dmg;
    if (b.Hp > 0.001) return;

    this.bugs.splice(this.bugs.indexOf(b), 1);
    this.RecycleBug(b);
    this.kills++;
    this.credits += b.Reward;
    this.score += b.Reward * 10;
    const c = VirusColor[b.Type];
    const big = b.Type === Virus.Kernel;
    this.Fx.burst(b.Pos, c, big ? 70 : 10, big ? 9 : 4, big ? 0.35 : 0.18, big ? 1 : 0.4);
    this.UI.Float(b.Pos, "+" + b.Reward, Pal.Warn, big ? 1.4 : 0.6);
    Sfx.play(big ? Snd.Boom : Snd.Explode, big ? 1 : 0.3, Random.range(0.95, 1.2));
    if (big) {
      this.Fx.shake(0.8);
      this.Fx.kick(2, 0.5);
      this.Hitstop(0.1);
    }
    if (this.selectedTower != null) this.RefreshPanel();
  }

  private BreachCore(b: Bug) {
    const grid = this.grid!;
    this.integrity -= b.CoreDamage;
    this.coreHit = 1;
    this.Fx.shake(0.4);
    this.Fx.kick(0.6, 0.8);
    this.Fx.burst(grid.toWorld(this.core), Pal.Danger, 18, 5);
    this.Back.Flash(Pal.Danger, 0.2);
    Sfx.play(Snd.Hurt, 0.8);
    Fx.haptic(true);
    this.UI.Float(grid.toWorld(this.core), "-" + b.CoreDamage, Pal.Danger, 1);
  }

  private AnimateScenery(dt: number) {
    this.coreHit = Mathf.moveTowards(this.coreHit, 0, dt * 2);
    const t = Time.time;
    const s = 0.95 * (1 + 0.05 * Math.sin(t * 3) + this.coreHit * 0.3);
    this.coreSprite.transform.localScale = new V3(s, s, 1);
    this.coreSprite.color = Color.lerp(CoreColor, Pal.Danger, this.coreHit);
    this.coreHalo.color = Color.lerp(CoreColor, Pal.Danger, this.coreHit).withAlpha(0.4 + 0.2 * Math.sin(t * 2));
    this.portal.transform.localRotation = Quaternion.euler(0, 0, t * 90);
    const ps = 1.1 + 0.1 * Math.sin(t * 5);
    this.portal.transform.localScale = new V3(ps, ps, 1);
    this.routeLine.startColor = this.routeLine.endColor = Pal.hex(0xff4d6a).withAlpha(0.2 + 0.1 * Math.sin(t * 4));
  }

  // ------------------------------------------------------------------ HUD / end

  private UpdateHud() {
    this.creditsText.text = "¢ " + Fmt.n(this.credits);
    this.waveText.text = this.waveActive ? "WAVE " + this.wave : "NEXT WAVE IN " + Mathf.ceilToInt(Math.max(0, this.buildTimer));
    this.integrityText.text = "CORE " + Math.max(0, this.integrity);
    this.integrityText.color = this.integrity <= 5 ? Pal.Danger : CoreColor;
    for (let i = 0; i < 4; i++) this.buildButtons[i].interactable = this.credits >= TowerCost[i];
    if (this.selectedTower != null) this.upgradeButton.interactable = this.selectedTower.Level < MaxLevel - 1 && this.credits >= this.UpgradeCost(this.selectedTower);
    this.Back.setDanger(this.integrity <= 5 ? 0.7 : 0);
  }

  private GameOver() {
    const grid = this.grid!;
    this.Fx.burst(grid.toWorld(this.core), CoreColor, 80, 10, 0.4, 1.2);
    this.Fx.ring(grid.toWorld(this.core), Pal.Danger, 0.5, 14, 0.9);
    this.Fx.shake(1);
    Sfx.play(Snd.Boom);
    Sfx.play(Snd.Lose);
    this.Deselect();
    this.SpeedMultiplier = 1;
    this.speedButton.label!.text = "1x";
    const newBest = this.Data.max("best", this.score);
    this.Data.max("bestWave", this.wave);
    if (!this.rebooted) this.Data.add("runs", 1);
    this.Data.add("kills", this.kills - this.killsReported);
    this.killsReported = this.kills;
    this.Finish(new Result({
      Headline: "FIREWALL BREACHED",
      HeadlineColor: Pal.Danger,
      Value: Fmt.n(this.score),
      CountTo: this.score,
      NewBest: newBest && this.score > 0,
      BestLine: `BEST  ${Fmt.n(this.Data.get("best"))}   ·   WAVE ${this.Data.get("bestWave")}`,
      Stats: [
        ["WAVES SURVIVED", String(Math.max(0, this.wave - 1))],
        ["VIRUSES PURGED", Fmt.n(this.kills)],
        ["TOWERS BUILT", String(this.built)],
        ["TIME", Fmt.clock(this.RunTime)],
      ],
      Reward: this.rebooted ? null : () => this.RebootFromAd(),
      RewardLabel: "REBOOT CORE: WATCH AN AD",
    }));
  }

  /** Rewarded continue (once per run): the core comes back with 10 integrity. */
  private RebootFromAd() {
    const grid = this.grid!;
    this.rebooted = true;
    this.integrity = 10;
    this.coreHit = 0;
    this.Fx.ring(grid.toWorld(this.core), CoreColor, 0.5, 10, 0.7);
    this.Fx.burst(grid.toWorld(this.core), CoreColor, 40, 6);
    Sfx.play(Snd.PowerUp);
    this.Revive();
    this.UI.Announce("CORE REBOOTED", CoreColor);
  }
}
