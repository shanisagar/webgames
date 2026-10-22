import { Mathf, SysRandom, V2 } from "../../kit";

export enum SpecialType { None = 0, StripedH = 1, StripedV = 2, Wrapped = 3, Nova = 4 }

export enum ObjectiveKind { Score = 0, CollectColor = 1, ClearJelly = 2, BreakFrost = 3 }

export enum ComboKind { None = 0, NovaColor = 1, NovaSpecial = 2, NovaNova = 3, StripedCross = 4, MegaLaser3x3 = 5, MegaBlast5x5 = 6 }

export class ObjectiveSlot {
  Kind = ObjectiveKind.Score;
  TargetColor = 0;
  Target = 0;
  Current = 0;
  constructor(init?: Partial<ObjectiveSlot>) { if (init) Object.assign(this, init); }
  get Completed() { return this.Current >= this.Target; }
  get Remaining() { return Math.max(0, this.Target - this.Current); }
}

export interface ClearedCell { X: number; Y: number; Color: number; Special: SpecialType; BrokeJelly: boolean; BrokeFrost: boolean; Delay: number }
export interface LaserBeamEvent { X: number; Y: number; Horizontal: boolean; Color: number }
export interface LightningArcEvent { FromX: number; FromY: number; ToX: number; ToY: number; Color: number }
export interface SpawnedSpecialEvent { X: number; Y: number; Color: number; Special: SpecialType }
export interface FallMove { X: number; ToY: number; FromY: number; IsNewSpawn: boolean }
export interface RealmInfo { Name: string; Subtitle: string; AccentHex: number; Accent2Hex: number }

const N = 8;
const CellCount = N * N;
const MaxColors = 6;

const Realms: RealmInfo[] = [
  { Name: "SUGAR NEBULA", Subtitle: "CRISTAL CANDY CLUSTER", AccentHex: 0xff4db8, Accent2Hex: 0x4de8ff },
  { Name: "PRISM PULSAR", Subtitle: "GOLDEN JELLY FIELDS", AccentHex: 0xffc83d, Accent2Hex: 0xff5e9e },
  { Name: "CRYO QUASAR", Subtitle: "FROSTED STARLIGHT RING", AccentHex: 0x38e8ff, Accent2Hex: 0x9d6bff },
  { Name: "VELVET ORBIT", Subtitle: "AMETHYST GRAVITY WELL", AccentHex: 0xb45cff, Accent2Hex: 0x28f07a },
  { Name: "SOLAR CORONA", Subtitle: "TANGERINE FLARE BELT", AccentHex: 0xff7b29, Accent2Hex: 0xffe055 },
  { Name: "HYPERNOVA CORE", Subtitle: "RAINBOW SINGULARITY", AccentHex: 0x2ee88a, Accent2Hex: 0xff4db8 },
];

/**
 * Pure match-3 board state, deterministic level generator, special candy rules, special+special combo engine,
 * gravity/refill solver, and move finder for CANDY NOVA. (Port of Match3Board.cs.)
 */
export class Match3Board {
  static readonly N = N;
  static readonly CellCount = CellCount;
  static readonly MaxColors = MaxColors;

  readonly Hole: boolean[] = new Array(CellCount).fill(false);
  readonly Color: number[] = new Array(CellCount).fill(0);
  readonly Special: SpecialType[] = new Array(CellCount).fill(SpecialType.None);
  readonly Jelly: number[] = new Array(CellCount).fill(0);
  readonly Frost: number[] = new Array(CellCount).fill(0);

  Level = 0;
  ActiveColors = 0;
  MovesLimit = 0;
  MovesLeft = 0;
  Score = 0;
  Star1 = 0;
  Star2 = 0;
  Star3 = 0;

  readonly Objectives: ObjectiveSlot[] = [];

  // Reusable step result lists
  readonly StepCleared: ClearedCell[] = [];
  readonly StepLasers: LaserBeamEvent[] = [];
  readonly StepArcs: LightningArcEvent[] = [];
  readonly StepSpawned: SpawnedSpecialEvent[] = [];
  readonly StepFalls: FallMove[] = [];

  StepComboKind = ComboKind.None;
  StepPoints = 0;
  StepMaxMatchLen = 0;

  // Internal scratch buffers
  private readonly markedClear: boolean[] = new Array(CellCount).fill(false);
  private readonly specialTriggered: boolean[] = new Array(CellCount).fill(false);
  private readonly frostHitDirect: boolean[] = new Array(CellCount).fill(false);
  private readonly frostHitAdj: boolean[] = new Array(CellCount).fill(false);
  private readonly clearDelay: number[] = new Array(CellCount).fill(0);
  private readonly hRunLen: number[] = new Array(CellCount).fill(0);
  private readonly vRunLen: number[] = new Array(CellCount).fill(0);
  private readonly groupIds: number[] = new Array(CellCount).fill(0);
  private readonly detonateQueue: number[] = [];
  private readonly groupCells: number[] = [];
  private readonly movableIndices: number[] = [];

  static RealmForLevel(lv: number) {
    const idx = Math.max(0, Math.trunc((lv - 1) / 3)) % Realms.length;
    return Realms[idx];
  }

  static Index(x: number, y: number) { return x + y * N; }
  static InBounds(x: number, y: number) { return x >= 0 && x < N && y >= 0 && y < N; }

  IsPlayableCandy(x: number, y: number) {
    if (!Match3Board.InBounds(x, y)) return false;
    const i = Match3Board.Index(x, y);
    return !this.Hole[i] && this.Frost[i] === 0 && this.Color[i] > 0;
  }

  // ------------------------------------------------------------------ level generation

  GenerateLevel(level: number, isDemo = false) {
    this.Level = Math.max(1, level);
    const rng = new SysRandom(this.Level * 48271 + (isDemo ? 919 : 1337));

    this.Hole.fill(false);
    this.Color.fill(0);
    this.Special.fill(SpecialType.None);
    this.Jelly.fill(0);
    this.Frost.fill(0);
    this.Objectives.length = 0;

    this.Score = 0;
    // Smooth difficulty progression: 5 colors for levels 1..5 so cascades are extra frequent, 6 colors later
    this.ActiveColors = this.Level <= 5 ? 5 : (this.Level % 3 === 0 ? 5 : 6);
    this.MovesLimit = Mathf.clamp(22 + (this.Level % 4) * 2 - Math.min(4, Math.trunc(this.Level / 12)), 18, 28);
    this.MovesLeft = this.MovesLimit;

    this.ApplyBoardShape(this.Level, isDemo);

    const baseTarget = 1600 + this.Level * 350;
    this.Star1 = baseTarget;
    this.Star2 = Mathf.roundToInt(baseTarget * 1.55);
    this.Star3 = Mathf.roundToInt(baseTarget * 2.25);

    if (isDemo) {
      this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.Score, Target: this.Star1, Current: 0 }));
      this.PlaceDemoSpecialsAndJelly(rng);
    } else {
      this.SetupLevelObjectivesAndTiles(this.Level, rng);
    }

    this.FillInitialCandies(rng);

    // Place starter specials on early levels so the player immediately experiences explosive combos
    if (!isDemo && this.Level === 1) {
      const centerIdx = Match3Board.Index(3, 4);
      if (!this.Hole[centerIdx] && this.Frost[centerIdx] === 0) this.Special[centerIdx] = SpecialType.StripedH;
    } else if (isDemo) {
      this.Special[Match3Board.Index(3, 3)] = SpecialType.StripedH;
      this.Special[Match3Board.Index(4, 4)] = SpecialType.Wrapped;
    }

    this.EnsureValidMove(rng);
  }

  private ApplyBoardShape(lv: number, isDemo: boolean) {
    if (isDemo || lv <= 2) return;

    const pattern = (lv - 1) % 7;
    switch (pattern) {
      case 1: // Clipped corners (octagon board)
        this.SetHoleSym(0, 0);
        this.SetHoleSym(1, 0);
        this.SetHoleSym(0, 1);
        break;
      case 2: // Diamond ring (small 2x2 center hole + single corners)
        this.SetHoleSym(0, 0);
        this.SetHoleSym(3, 3);
        break;
      case 3: // Side notches (waisted hourglass)
        this.SetHoleSym(0, 3);
        this.SetHoleSym(0, 4);
        break;
      case 4: // Plus / Cross board
        this.SetHoleSym(0, 0);
        this.SetHoleSym(1, 0);
        this.SetHoleSym(0, 1);
        this.SetHoleSym(1, 1);
        break;
      case 5: // Chalice / Heart-like notches
        this.SetHoleSym(0, 0);
        this.SetHoleSym(0, 1);
        this.Hole[Match3Board.Index(3, 7)] = true;
        this.Hole[Match3Board.Index(4, 7)] = true;
        break;
      case 6: // Twin pillars
        this.SetHoleSym(2, 3);
        this.SetHoleSym(2, 4);
        break;
    }
  }

  private SetHoleSym(x: number, y: number) {
    this.Hole[Match3Board.Index(x, y)] = true;
    this.Hole[Match3Board.Index(N - 1 - x, y)] = true;
    this.Hole[Match3Board.Index(x, N - 1 - y)] = true;
    this.Hole[Match3Board.Index(N - 1 - x, N - 1 - y)] = true;
  }

  private PlaceDemoSpecialsAndJelly(_rng: SysRandom) {
    for (let y = 2; y <= 5; y++)
      for (let x = 2; x <= 5; x++) {
        const i = Match3Board.Index(x, y);
        if (!this.Hole[i]) this.Jelly[i] = 1;
      }
  }

  private SetupLevelObjectivesAndTiles(lv: number, rng: SysRandom) {
    if (lv === 1) {
      // Level 1: Collect Ruby Hearts & Sapphire Hexes
      this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.CollectColor, TargetColor: 1, Target: 14 }));
      this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.CollectColor, TargetColor: 2, Target: 14 }));
      return;
    }

    if (lv === 2) {
      // Level 2: Introduce Gold Jelly tiles in the center 4x4
      let jellyTotal = 0;
      for (let y = 2; y <= 5; y++)
        for (let x = 2; x <= 5; x++) {
          const i = Match3Board.Index(x, y);
          if (this.Hole[i]) continue;
          this.Jelly[i] = 1;
          jellyTotal++;
        }
      this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.ClearJelly, Target: jellyTotal }));
      return;
    }

    if (lv === 3) {
      // Level 3: Introduce Frost/Ice blockers + Collect Emerald Stars
      const frostTotal = this.PlaceSymmetricFrost(lv, rng, 6, 1);
      this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.BreakFrost, Target: frostTotal }));
      this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.CollectColor, TargetColor: 3, Target: 15 }));
      return;
    }

    const mode = (lv - 4) % 5;
    switch (mode) {
      case 0: { // Gold Jelly (1-2 layers)
        const jellyLayers = this.PlaceSymmetricJelly(lv, rng, Math.min(24, 12 + lv), lv >= 5);
        this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.ClearJelly, Target: jellyLayers }));
        const col = 1 + (lv % this.ActiveColors);
        this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.CollectColor, TargetColor: col, Target: 14 + Math.min(12, lv) }));
        break;
      }
      case 1: { // Frost Blockers + Jelly
        const frostLayers = this.PlaceSymmetricFrost(lv, rng, Math.min(12, 6 + Math.trunc(lv / 2)), lv >= 7 ? 2 : 1);
        const jellyLayers = this.PlaceSymmetricJelly(lv, rng, Math.min(16, 8 + Math.trunc(lv / 2)), false);
        this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.BreakFrost, Target: frostLayers }));
        this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.ClearJelly, Target: jellyLayers }));
        break;
      }
      case 2: { // Dual Color Collection + Score
        const c1 = 1 + (lv % this.ActiveColors);
        const c2 = 1 + ((lv + 2) % this.ActiveColors);
        const amt = 16 + Math.min(14, lv);
        this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.CollectColor, TargetColor: c1, Target: amt }));
        this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.CollectColor, TargetColor: c2, Target: amt }));
        break;
      }
      case 3: { // Frost + Score
        const frostLayers = this.PlaceSymmetricFrost(lv, rng, Math.min(14, 6 + Math.trunc(lv / 2)), lv >= 8 ? 2 : 1);
        this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.BreakFrost, Target: frostLayers }));
        this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.Score, Target: this.Star1 }));
        break;
      }
      default: { // Rich Gold Jelly + Frost combo
        const jellyLayers = this.PlaceSymmetricJelly(lv, rng, Math.min(22, 12 + Math.trunc(lv / 2)), true);
        this.PlaceSymmetricFrost(lv, rng, Math.min(8, 4 + Math.trunc(lv / 4)), 1);
        this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.ClearJelly, Target: jellyLayers }));
        this.Objectives.push(new ObjectiveSlot({ Kind: ObjectiveKind.Score, Target: this.Star1 }));
        break;
      }
    }
  }

  private PlaceSymmetricJelly(_lv: number, rng: SysRandom, desiredCount: number, allowDouble: boolean) {
    let totalLayers = 0;
    for (let y = 1; y < N - 1 && totalLayers < desiredCount; y++)
      for (let x = 1; x < N / 2 && totalLayers < desiredCount; x++) {
        if (rng.nextDouble() > 0.58) continue;
        const layers = allowDouble && rng.nextDouble() < 0.35 ? 2 : 1;
        const pair = [Match3Board.Index(x, y), Match3Board.Index(N - 1 - x, y)];
        for (const idx of pair) {
          if (this.Hole[idx] || this.Frost[idx] > 0 || this.Jelly[idx] > 0) continue;
          this.Jelly[idx] = layers;
          totalLayers += layers;
        }
      }
    if (totalLayers === 0) {
      for (let y = 2; y <= 5; y++)
        for (let x = 2; x <= 5; x++) {
          const idx = Match3Board.Index(x, y);
          if (this.Hole[idx] || this.Frost[idx] > 0) continue;
          this.Jelly[idx] = 1;
          totalLayers++;
        }
    }
    return totalLayers;
  }

  private PlaceSymmetricFrost(lv: number, rng: SysRandom, desiredCells: number, maxLayers: number) {
    let totalLayers = 0;
    let placedCells = 0;
    // Keep top two rows (y = 6, 7) free of Frost so gravity spawns freely
    for (let y = 1; y <= 5 && placedCells < desiredCells; y++)
      for (let x = 1; x < N / 2 && placedCells < desiredCells; x++) {
        if ((x + y + lv) % 2 !== 0 && rng.nextDouble() > 0.35) continue;
        const layers = maxLayers > 1 && rng.nextDouble() < 0.35 ? 2 : 1;
        const pair = [Match3Board.Index(x, y), Match3Board.Index(N - 1 - x, y)];
        for (const idx of pair) {
          if (this.Hole[idx] || this.Frost[idx] > 0) continue;
          this.Frost[idx] = layers;
          this.Jelly[idx] = 0;
          totalLayers += layers;
          placedCells++;
        }
      }
    if (totalLayers === 0) {
      const fallback = [Match3Board.Index(2, 3), Match3Board.Index(5, 3), Match3Board.Index(2, 4), Match3Board.Index(5, 4)];
      for (const idx of fallback) {
        if (this.Hole[idx]) continue;
        this.Frost[idx] = 1;
        totalLayers++;
      }
    }
    return totalLayers;
  }

  private FillInitialCandies(rng: SysRandom) {
    const C = this.Color;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = Match3Board.Index(x, y);
        if (this.Hole[i] || this.Frost[i] > 0) {
          C[i] = 0;
          continue;
        }

        // Pick a color that does not immediately form a 3-in-a-row horizontally or vertically
        const startC = 1 + rng.next(this.ActiveColors);
        let chosen = startC;
        for (let attempt = 0; attempt < this.ActiveColors; attempt++) {
          const c = 1 + ((startC - 1 + attempt) % this.ActiveColors);
          const hMatch = x >= 2 && C[Match3Board.Index(x - 1, y)] === c && C[Match3Board.Index(x - 2, y)] === c;
          const vMatch = y >= 2 && C[Match3Board.Index(x, y - 1)] === c && C[Match3Board.Index(x, y - 2)] === c;
          if (!hMatch && !vMatch) {
            chosen = c;
            break;
          }
        }
        C[i] = chosen;
      }
  }

  // ------------------------------------------------------------------ move validation & hint finder

  IsValidSwap(x1: number, y1: number, x2: number, y2: number) {
    if (!Match3Board.InBounds(x1, y1) || !Match3Board.InBounds(x2, y2)) return false;
    if (Math.abs(x1 - x2) + Math.abs(y1 - y2) !== 1) return false;

    const C = this.Color, S = this.Special;
    const i1 = Match3Board.Index(x1, y1), i2 = Match3Board.Index(x2, y2);
    if (this.Hole[i1] || this.Hole[i2] || this.Frost[i1] > 0 || this.Frost[i2] > 0) return false;
    if (C[i1] === 0 || C[i2] === 0) return false;

    // Nova bomb can swap with anything playable; two specials can always swap together
    if (S[i1] === SpecialType.Nova || S[i2] === SpecialType.Nova) return true;
    if (S[i1] !== SpecialType.None && S[i2] !== SpecialType.None) return true;
    if (C[i1] === C[i2]) return false;

    // Temporarily swap and check if a 3+ line forms at either endpoint
    [C[i1], C[i2]] = [C[i2], C[i1]];
    const forms = this.FormsMatchAt(x1, y1) || this.FormsMatchAt(x2, y2);
    [C[i1], C[i2]] = [C[i2], C[i1]];
    return forms;
  }

  private FormsMatchAt(x: number, y: number) {
    const c = this.Color[Match3Board.Index(x, y)];
    if (c === 0) return false;

    let h = 1;
    for (let dx = x - 1; dx >= 0 && this.IsColorMatchable(dx, y, c); dx--) h++;
    for (let dx = x + 1; dx < N && this.IsColorMatchable(dx, y, c); dx++) h++;
    if (h >= 3) return true;

    let v = 1;
    for (let dy = y - 1; dy >= 0 && this.IsColorMatchable(x, dy, c); dy--) v++;
    for (let dy = y + 1; dy < N && this.IsColorMatchable(x, dy, c); dy++) v++;
    return v >= 3;
  }

  private IsColorMatchable(x: number, y: number, c: number) {
    const i = Match3Board.Index(x, y);
    return !this.Hole[i] && this.Frost[i] === 0 && this.Special[i] !== SpecialType.Nova && this.Color[i] === c;
  }

  HasValidMove() { return this.FindBestMove() !== null; }

  /** Best swap as [x1, y1, x2, y2], or null (C# out params + bool). */
  FindBestMove(): [number, number, number, number] | null {
    let best: [number, number, number, number] | null = null;
    let bestScore = -1;

    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (x + 1 < N && this.IsValidSwap(x, y, x + 1, y)) {
          const s = this.ScorePotentialSwap(x, y, x + 1, y);
          if (s > bestScore) { bestScore = s; best = [x, y, x + 1, y]; }
        }
        if (y + 1 < N && this.IsValidSwap(x, y, x, y + 1)) {
          const s = this.ScorePotentialSwap(x, y, x, y + 1);
          if (s > bestScore) { bestScore = s; best = [x, y, x, y + 1]; }
        }
      }
    return bestScore >= 0 ? best : null;
  }

  private ScorePotentialSwap(x1: number, y1: number, x2: number, y2: number) {
    const i1 = Match3Board.Index(x1, y1), i2 = Match3Board.Index(x2, y2);
    const S = this.Special;
    if (S[i1] === SpecialType.Nova || S[i2] === SpecialType.Nova) return 100;
    if (S[i1] !== SpecialType.None && S[i2] !== SpecialType.None) return 90;

    let score = 10;
    if (this.Jelly[i1] > 0 || this.Jelly[i2] > 0) score += 20;
    if (S[i1] !== SpecialType.None || S[i2] !== SpecialType.None) score += 25;
    if (this.HasAdjacentFrost(x1, y1) || this.HasAdjacentFrost(x2, y2)) score += 18;
    return score;
  }

  private HasAdjacentFrost(x: number, y: number) {
    const F = this.Frost, I = Match3Board.Index, B = Match3Board.InBounds;
    return (B(x - 1, y) && F[I(x - 1, y)] > 0)
      || (B(x + 1, y) && F[I(x + 1, y)] > 0)
      || (B(x, y - 1) && F[I(x, y - 1)] > 0)
      || (B(x, y + 1) && F[I(x, y + 1)] > 0);
  }

  EnsureValidMove(rng: SysRandom) {
    if (this.HasValidMove() && !this.HasAnyImmediateMatch()) return;
    this.Reshuffle(rng);
  }

  HasAnyImmediateMatch() {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = Match3Board.Index(x, y);
        if (this.Hole[i] || this.Frost[i] > 0 || this.Color[i] === 0 || this.Special[i] === SpecialType.Nova) continue;
        const c = this.Color[i];
        if (x + 2 < N && this.IsColorMatchable(x + 1, y, c) && this.IsColorMatchable(x + 2, y, c)) return true;
        if (y + 2 < N && this.IsColorMatchable(x, y + 1, c) && this.IsColorMatchable(x, y + 2, c)) return true;
      }
    return false;
  }

  Reshuffle(rng: SysRandom) {
    const C = this.Color, M = this.movableIndices;
    M.length = 0;
    for (let i = 0; i < CellCount; i++)
      if (!this.Hole[i] && this.Frost[i] === 0 && C[i] > 0 && this.Special[i] === SpecialType.None) M.push(i);

    for (let attempt = 0; attempt < 36; attempt++) {
      for (let k = M.length - 1; k > 0; k--) {
        const j = rng.next(k + 1);
        const a = M[k], b = M[j];
        [C[a], C[b]] = [C[b], C[a]];
      }
      if (!this.HasAnyImmediateMatch()) {
        for (let k = 0; k < M.length; k++) {
          const idx = M[k];
          const x = idx % N, y = Math.trunc(idx / N);
          const orig = C[idx];
          const h = x >= 2 && C[Match3Board.Index(x - 1, y)] === orig && C[Match3Board.Index(x - 2, y)] === orig;
          const v = y >= 2 && C[Match3Board.Index(x, y - 1)] === orig && C[Match3Board.Index(x, y - 2)] === orig;
          if (h || v) {
            for (let c = 1; c <= this.ActiveColors; c++) {
              C[idx] = c;
              if (!this.FormsMatchAt(x, y)) break;
            }
          }
        }
      }
      if (!this.HasAnyImmediateMatch() && this.HasValidMove()) return;
    }

    // Fallback: re-roll initial candies and plant one guaranteed valid swap
    this.FillInitialCandies(rng);
    this.PlantGuaranteedMove(rng);
  }

  private PlantGuaranteedMove(rng: SysRandom) {
    const C = this.Color, I = Match3Board.Index;
    for (let y = 0; y < N; y++)
      for (let x = 0; x + 3 < N; x++) {
        const i0 = I(x, y), i1 = I(x + 1, y), i2 = I(x + 2, y), i3 = I(x + 3, y);
        if (this.Hole[i0] || this.Hole[i1] || this.Hole[i2] || this.Hole[i3]) continue;
        if (this.Frost[i0] > 0 || this.Frost[i1] > 0 || this.Frost[i2] > 0 || this.Frost[i3] > 0) continue;

        const c = 1 + rng.next(this.ActiveColors);
        const alt = 1 + (c % this.ActiveColors);
        C[i0] = c;
        C[i1] = c;
        C[i2] = alt;
        C[i3] = c;
        // Fix any accidental vertical match created by planting
        for (let dx = 0; dx <= 3; dx++) {
          const cx = x + dx;
          if (y >= 1 && C[I(cx, y - 1)] === C[I(cx, y)]) C[I(cx, y - 1)] = 1 + (C[I(cx, y)] % this.ActiveColors);
          if (y + 1 < N && C[I(cx, y + 1)] === C[I(cx, y)]) C[I(cx, y + 1)] = 1 + (C[I(cx, y)] % this.ActiveColors);
        }
        if (this.HasValidMove()) return;
      }
  }

  // ------------------------------------------------------------------ swapping & resolving

  SwapCells(x1: number, y1: number, x2: number, y2: number) {
    const i1 = Match3Board.Index(x1, y1), i2 = Match3Board.Index(x2, y2);
    const C = this.Color, S = this.Special;
    [C[i1], C[i2]] = [C[i2], C[i1]];
    [S[i1], S[i2]] = [S[i2], S[i1]];
  }

  private ClearStep() {
    this.StepCleared.length = 0;
    this.StepLasers.length = 0;
    this.StepArcs.length = 0;
    this.StepSpawned.length = 0;
    this.StepComboKind = ComboKind.None;
    this.StepPoints = 0;
    this.StepMaxMatchLen = 0;

    this.markedClear.fill(false);
    this.specialTriggered.fill(false);
    this.frostHitDirect.fill(false);
    this.frostHitAdj.fill(false);
    this.clearDelay.fill(0);
    this.detonateQueue.length = 0;
  }

  /**
   * Resolves either a Special+Special swap combo or all 3+ matches on the board.
   * Returns true if any cells or blockers were cleared this step.
   */
  ResolveStep(swapX1: number, swapY1: number, swapX2: number, swapY2: number, isPlayerSwap: boolean, cascadeIndex: number, rng: SysRandom) {
    this.ClearStep();

    if (isPlayerSwap && Match3Board.InBounds(swapX1, swapY1) && Match3Board.InBounds(swapX2, swapY2)) {
      if (this.TryResolveSpecialSwapCombo(swapX1, swapY1, swapX2, swapY2, cascadeIndex, rng)) {
        this.FinalizeClearedCells(cascadeIndex);
        return this.StepCleared.length > 0;
      }
    }

    // Standard match detection across the board
    const hRunLen = this.hRunLen, vRunLen = this.vRunLen, groupIds = this.groupIds, C = this.Color;
    hRunLen.fill(0);
    vRunLen.fill(0);
    groupIds.fill(-1);

    let anyMatch = false;

    // Horizontal runs
    for (let y = 0; y < N; y++) {
      let x = 0;
      while (x < N) {
        const i = Match3Board.Index(x, y);
        const c = C[i];
        if (this.Hole[i] || this.Frost[i] > 0 || c === 0 || this.Special[i] === SpecialType.Nova) {
          x++;
          continue;
        }
        let endX = x + 1;
        while (endX < N && this.IsColorMatchable(endX, y, c)) endX++;
        const len = endX - x;
        if (len >= 3) {
          anyMatch = true;
          for (let k = x; k < endX; k++) hRunLen[Match3Board.Index(k, y)] = len;
        }
        x = endX;
      }
    }

    // Vertical runs
    for (let x = 0; x < N; x++) {
      let y = 0;
      while (y < N) {
        const i = Match3Board.Index(x, y);
        const c = C[i];
        if (this.Hole[i] || this.Frost[i] > 0 || c === 0 || this.Special[i] === SpecialType.Nova) {
          y++;
          continue;
        }
        let endY = y + 1;
        while (endY < N && this.IsColorMatchable(x, endY, c)) endY++;
        const len = endY - y;
        if (len >= 3) {
          anyMatch = true;
          for (let k = y; k < endY; k++) vRunLen[Match3Board.Index(x, k)] = len;
        }
        y = endY;
      }
    }

    if (!anyMatch) return false;

    // Flood-fill connected matched cells of the same color to classify 4-in-a-row, L/T shapes, and 5-in-a-row
    let nextGroup = 0;
    const groupCells = this.groupCells;
    for (let start = 0; start < CellCount; start++) {
      if ((hRunLen[start] === 0 && vRunLen[start] === 0) || groupIds[start] >= 0) continue;

      const groupColor = C[start];
      groupCells.length = 0;
      groupIds[start] = nextGroup;
      groupCells.push(start);

      let head = 0;
      let maxH = 0, maxV = 0;
      let hasH = false, hasV = false;
      while (head < groupCells.length) {
        const cur = groupCells[head++];
        if (hRunLen[cur] > 0) { hasH = true; maxH = Math.max(maxH, hRunLen[cur]); }
        if (vRunLen[cur] > 0) { hasV = true; maxV = Math.max(maxV, vRunLen[cur]); }

        const cx = cur % N, cy = Math.trunc(cur / N);
        this.TryAddGroupNeighbor(cx - 1, cy, groupColor, nextGroup);
        this.TryAddGroupNeighbor(cx + 1, cy, groupColor, nextGroup);
        this.TryAddGroupNeighbor(cx, cy - 1, groupColor, nextGroup);
        this.TryAddGroupNeighbor(cx, cy + 1, groupColor, nextGroup);
      }
      nextGroup++;

      const longestLine = Math.max(maxH, maxV);
      this.StepMaxMatchLen = Math.max(this.StepMaxMatchLen, Math.max(longestLine, groupCells.length));

      let spawnType = SpecialType.None;
      if (longestLine >= 5) spawnType = SpecialType.Nova;
      else if (hasH && hasV) spawnType = SpecialType.Wrapped;
      else if (maxH === 4) spawnType = SpecialType.StripedH;
      else if (maxV === 4) spawnType = SpecialType.StripedV;

      if (spawnType !== SpecialType.None) {
        const spawnIdx = this.PickSpecialSpawnCell(groupCells, swapX1, swapY1, swapX2, swapY2, isPlayerSwap);
        this.StepSpawned.push({ X: spawnIdx % N, Y: Math.trunc(spawnIdx / N), Color: groupColor, Special: spawnType });
      }

      for (let k = 0; k < groupCells.length; k++) this.EnqueueClear(groupCells[k], 0, true);
    }

    this.ProcessDetonationQueue(rng);
    this.FinalizeClearedCells(cascadeIndex);
    return this.StepCleared.length > 0;
  }

  private TryAddGroupNeighbor(nx: number, ny: number, color: number, groupId: number) {
    if (!Match3Board.InBounds(nx, ny)) return;
    const ni = Match3Board.Index(nx, ny);
    if (this.groupIds[ni] >= 0) return;
    if ((this.hRunLen[ni] > 0 || this.vRunLen[ni] > 0) && this.Color[ni] === color) {
      this.groupIds[ni] = groupId;
      this.groupCells.push(ni);
    }
  }

  private PickSpecialSpawnCell(cells: number[], sx1: number, sy1: number, sx2: number, sy2: number, isPlayerSwap: boolean) {
    if (isPlayerSwap) {
      const i2 = Match3Board.Index(sx2, sy2);
      if (cells.includes(i2) && this.Special[i2] === SpecialType.None) return i2;
      const i1 = Match3Board.Index(sx1, sy1);
      if (cells.includes(i1) && this.Special[i1] === SpecialType.None) return i1;
    }
    // Prefer an L/T intersection cell that doesn't already hold a special
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (this.hRunLen[c] > 0 && this.vRunLen[c] > 0 && this.Special[c] === SpecialType.None) return c;
    }
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (this.Special[c] === SpecialType.None) return c;
    }
    return cells[Math.trunc(cells.length / 2)];
  }

  private TryResolveSpecialSwapCombo(x1: number, y1: number, x2: number, y2: number, _cascadeIndex: number, rng: SysRandom) {
    const i1 = Match3Board.Index(x1, y1), i2 = Match3Board.Index(x2, y2);
    const C = this.Color, S = this.Special;
    const s1 = S[i1], s2 = S[i2];
    if (s1 === SpecialType.None && s2 === SpecialType.None) return false;

    // 1. Nova + Nova -> Supernova Board Wipe!
    if (s1 === SpecialType.Nova && s2 === SpecialType.Nova) {
      this.StepComboKind = ComboKind.NovaNova;
      this.StepMaxMatchLen = 8;
      this.specialTriggered[i1] = this.specialTriggered[i2] = true;
      this.StepLasers.push({ X: x2, Y: y2, Horizontal: true, Color: C[i2] });
      this.StepLasers.push({ X: x2, Y: y2, Horizontal: false, Color: C[i1] });

      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const idx = Match3Board.Index(x, y);
          if (this.Hole[idx]) continue;
          const dist = V2.distance(new V2(x, y), new V2(x2, y2)) * 0.03;
          if (this.Frost[idx] > 0) {
            this.frostHitDirect[idx] = true;
            this.clearDelay[idx] = dist;
          } else if (C[idx] > 0) {
            this.EnqueueClear(idx, dist, false);
          }
        }
      this.ProcessDetonationQueue(rng);
      return true;
    }

    // 2. Nova + Any Special or Normal Candy
    if (s1 === SpecialType.Nova || s2 === SpecialType.Nova) {
      const novaIdx = s1 === SpecialType.Nova ? i1 : i2;
      const otherIdx = s1 === SpecialType.Nova ? i2 : i1;
      const nx = novaIdx % N, ny = Math.trunc(novaIdx / N);
      const targetColor = C[otherIdx] > 0 ? C[otherIdx] : this.MostCommonColorOnBoard(1);
      const otherSpec = S[otherIdx];

      this.specialTriggered[novaIdx] = true;
      this.EnqueueClear(novaIdx, 0, true);
      this.EnqueueClear(otherIdx, 0.02, true);

      if (otherSpec !== SpecialType.None) {
        // Nova + Striped/Wrapped -> converts all candies of targetColor into specials & triggers them!
        this.StepComboKind = ComboKind.NovaSpecial;
        this.StepMaxMatchLen = 6;
        for (let i = 0; i < CellCount; i++) {
          if (this.Hole[i] || this.Frost[i] > 0 || C[i] !== targetColor || i === novaIdx) continue;
          if (otherSpec === SpecialType.Wrapped) S[i] = SpecialType.Wrapped;
          else S[i] = i % 2 === 0 ? SpecialType.StripedH : SpecialType.StripedV;

          this.StepArcs.push({ FromX: nx, FromY: ny, ToX: i % N, ToY: Math.trunc(i / N), Color: targetColor });
          this.EnqueueClear(i, 0.08, true);
        }
      } else {
        // Nova + Normal Color -> zaps all candies of targetColor across the board!
        this.StepComboKind = ComboKind.NovaColor;
        this.StepMaxMatchLen = 5;
        for (let i = 0; i < CellCount; i++) {
          if (this.Hole[i] || this.Frost[i] > 0 || C[i] !== targetColor || i === novaIdx) continue;
          this.StepArcs.push({ FromX: nx, FromY: ny, ToX: i % N, ToY: Math.trunc(i / N), Color: targetColor });
          this.EnqueueClear(i, 0.05, true);
        }
      }
      this.ProcessDetonationQueue(rng);
      return true;
    }

    // 3. Special + Special (both non-Nova specials)
    if (s1 !== SpecialType.None && s2 !== SpecialType.None) {
      this.specialTriggered[i1] = this.specialTriggered[i2] = true;
      this.EnqueueClear(i1, 0, true);
      this.EnqueueClear(i2, 0, true);

      if (s1 === SpecialType.Wrapped && s2 === SpecialType.Wrapped) {
        // Wrapped + Wrapped -> 5x5 Mega Blast
        this.StepComboKind = ComboKind.MegaBlast5x5;
        this.StepMaxMatchLen = 6;
        this.BlastArea(x2, y2, 2, 0.02);
      } else if (s1 === SpecialType.Wrapped || s2 === SpecialType.Wrapped) {
        // Striped + Wrapped -> 3-Row & 3-Column Mega Laser
        this.StepComboKind = ComboKind.MegaLaser3x3;
        this.StepMaxMatchLen = 6;
        for (let d = -1; d <= 1; d++) {
          if (Match3Board.InBounds(x2, y2 + d)) this.FireRowLaser(x2, y2 + d, C[i2], 0.02);
          if (Match3Board.InBounds(x2 + d, y2)) this.FireColLaser(x2 + d, y2, C[i1], 0.02);
        }
      } else {
        // Striped + Striped -> Giant Cross Laser (full row + full col)
        this.StepComboKind = ComboKind.StripedCross;
        this.StepMaxMatchLen = 5;
        this.FireRowLaser(x2, y2, C[i1], 0.01);
        this.FireColLaser(x2, y2, C[i2], 0.01);
      }

      this.ProcessDetonationQueue(rng);
      return true;
    }

    return false;
  }

  private EnqueueClear(idx: number, delay: number, isDirectMatch: boolean) {
    if (this.Hole[idx]) return;
    if (this.Frost[idx] > 0) {
      this.frostHitDirect[idx] = true;
      this.clearDelay[idx] = Math.min(this.clearDelay[idx] > 0 ? this.clearDelay[idx] : delay, delay);
      return;
    }
    if (this.Color[idx] === 0) return;

    if (!this.markedClear[idx]) {
      this.markedClear[idx] = true;
      this.clearDelay[idx] = delay;
      this.detonateQueue.push(idx);
    } else if (delay < this.clearDelay[idx]) {
      this.clearDelay[idx] = delay;
    }

    if (isDirectMatch) {
      const x = idx % N, y = Math.trunc(idx / N);
      this.DamageAdjacentFrost(x - 1, y, delay);
      this.DamageAdjacentFrost(x + 1, y, delay);
      this.DamageAdjacentFrost(x, y - 1, delay);
      this.DamageAdjacentFrost(x, y + 1, delay);
    }
  }

  private DamageAdjacentFrost(nx: number, ny: number, delay: number) {
    if (!Match3Board.InBounds(nx, ny)) return;
    const ni = Match3Board.Index(nx, ny);
    if (!this.Hole[ni] && this.Frost[ni] > 0) {
      this.frostHitAdj[ni] = true;
      this.clearDelay[ni] = delay + 0.04;
    }
  }

  private ProcessDetonationQueue(_rng: SysRandom) {
    const q = this.detonateQueue;
    let head = 0;
    while (head < q.length) {
      const idx = q[head++];
      const spec = this.Special[idx];
      if (spec === SpecialType.None || this.specialTriggered[idx]) continue;

      this.specialTriggered[idx] = true;
      const x = idx % N, y = Math.trunc(idx / N);
      const col = this.Color[idx];
      const baseD = this.clearDelay[idx];

      switch (spec) {
        case SpecialType.StripedH:
          this.FireRowLaser(x, y, col, baseD);
          break;
        case SpecialType.StripedV:
          this.FireColLaser(x, y, col, baseD);
          break;
        case SpecialType.Wrapped:
          this.BlastArea(x, y, 1, baseD);
          break;
        case SpecialType.Nova: {
          const zapColor = this.MostCommonColorOnBoard(col);
          for (let i = 0; i < CellCount; i++) {
            if (this.Hole[i] || this.Frost[i] > 0 || this.Color[i] !== zapColor || i === idx) continue;
            this.StepArcs.push({ FromX: x, FromY: y, ToX: i % N, ToY: Math.trunc(i / N), Color: zapColor });
            this.EnqueueClear(i, baseD + 0.05, true);
          }
          break;
        }
      }
    }
    q.length = 0;
  }

  private FireRowLaser(originX: number, rowY: number, color: number, baseDelay: number) {
    this.StepLasers.push({ X: originX, Y: rowY, Horizontal: true, Color: color });
    for (let cx = 0; cx < N; cx++) {
      const i = Match3Board.Index(cx, rowY);
      const d = baseDelay + Math.abs(cx - originX) * 0.02;
      this.EnqueueClear(i, d, false);
    }
  }

  private FireColLaser(colX: number, originY: number, color: number, baseDelay: number) {
    this.StepLasers.push({ X: colX, Y: originY, Horizontal: false, Color: color });
    for (let cy = 0; cy < N; cy++) {
      const i = Match3Board.Index(colX, cy);
      const d = baseDelay + Math.abs(cy - originY) * 0.02;
      this.EnqueueClear(i, d, false);
    }
  }

  private BlastArea(cx: number, cy: number, radius: number, baseDelay: number) {
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (!Match3Board.InBounds(nx, ny)) continue;
        const i = Match3Board.Index(nx, ny);
        const d = baseDelay + (Math.abs(dx) + Math.abs(dy)) * 0.022;
        this.EnqueueClear(i, d, false);
      }
  }

  private MostCommonColorOnBoard(fallback: number) {
    let bestCol = fallback > 0 ? fallback : 1;
    let bestCnt = -1;
    for (let c = 1; c <= this.ActiveColors; c++) {
      let cnt = 0;
      for (let i = 0; i < CellCount; i++) if (!this.Hole[i] && this.Frost[i] === 0 && this.Color[i] === c) cnt++;
      if (cnt > bestCnt) { bestCnt = cnt; bestCol = c; }
    }
    return bestCol;
  }

  private FinalizeClearedCells(cascadeIndex: number) {
    let rawPoints = 0;

    for (let i = 0; i < CellCount; i++) {
      if (this.Hole[i]) continue;
      const x = i % N, y = Math.trunc(i / N);

      if (this.Frost[i] > 0 && (this.frostHitDirect[i] || this.frostHitAdj[i])) {
        this.Frost[i]--;
        rawPoints += 120;
        this.AddObjectiveProgress(ObjectiveKind.BreakFrost, 0, 1);
        this.StepCleared.push({ X: x, Y: y, Color: 0, Special: SpecialType.None, BrokeJelly: false, BrokeFrost: true, Delay: this.clearDelay[i] });
        continue;
      }

      if (!this.markedClear[i]) continue;

      const oldCol = this.Color[i];
      const oldSpec = this.Special[i];
      let brokeJelly = false;
      if (this.Jelly[i] > 0) {
        this.Jelly[i]--;
        brokeJelly = true;
        rawPoints += 100;
        this.AddObjectiveProgress(ObjectiveKind.ClearJelly, 0, 1);
      }

      if (oldCol > 0) this.AddObjectiveProgress(ObjectiveKind.CollectColor, oldCol, 1);

      rawPoints += oldSpec !== SpecialType.None ? 140 : 45;

      this.StepCleared.push({ X: x, Y: y, Color: oldCol, Special: oldSpec, BrokeJelly: brokeJelly, BrokeFrost: false, Delay: this.clearDelay[i] });

      this.Color[i] = 0;
      this.Special[i] = SpecialType.None;
    }

    // Place newly earned specials into their spawn slots
    for (let s = 0; s < this.StepSpawned.length; s++) {
      const sp = this.StepSpawned[s];
      const idx = Match3Board.Index(sp.X, sp.Y);
      if (!this.Hole[idx] && this.Frost[idx] === 0) {
        this.Color[idx] = sp.Color;
        this.Special[idx] = sp.Special;
        rawPoints += 120;
      }
    }

    const mult = 1 + cascadeIndex * 0.45;
    this.StepPoints = Mathf.roundToInt(rawPoints * mult);
    this.Score += this.StepPoints;
    this.SyncScoreObjective();
  }

  // ------------------------------------------------------------------ boosters (Lollipop Hammer & Nova Wand)

  /** Smashes any single cell with the Lollipop Hammer (triggers specials, breaks jelly or frost). */
  ApplyHammer(x: number, y: number, rng: SysRandom) {
    if (!Match3Board.InBounds(x, y)) return false;
    const idx = Match3Board.Index(x, y);
    if (this.Hole[idx]) return false;
    if (this.Frost[idx] === 0 && this.Color[idx] === 0) return false;

    this.ClearStep();
    this.StepMaxMatchLen = 3;

    this.EnqueueClear(idx, 0, true);
    this.ProcessDetonationQueue(rng);
    this.FinalizeClearedCells(0);
    return this.StepCleared.length > 0;
  }

  /** Upgrades a playable candy cell into a Nova Color Bomb. */
  UpgradeToNova(x: number, y: number) {
    if (!this.IsPlayableCandy(x, y)) return false;
    const idx = Match3Board.Index(x, y);
    if (this.Special[idx] === SpecialType.Nova) return false;
    this.Special[idx] = SpecialType.Nova;
    return true;
  }

  // ------------------------------------------------------------------ gravity & refill

  /**
   * Shifts candies down through each column (flowing past Hole and Frost cells) and spawns new candies from above
   * the top of the column. Populates StepFalls.
   */
  ApplyGravityAndRefill(rng: SysRandom) {
    this.StepFalls.length = 0;
    const C = this.Color, S = this.Special;

    for (let x = 0; x < N; x++) {
      let writeY = 0;
      let spawnOffset = 0;

      while (writeY < N) {
        const writeIdx = Match3Board.Index(x, writeY);
        if (this.Hole[writeIdx] || this.Frost[writeIdx] > 0 || C[writeIdx] > 0) {
          writeY++;
          continue;
        }

        // Find the nearest movable candy above writeY in this column
        let readY = writeY + 1;
        while (readY < N) {
          const rIdx = Match3Board.Index(x, readY);
          if (!this.Hole[rIdx] && this.Frost[rIdx] === 0 && C[rIdx] > 0) break;
          readY++;
        }

        if (readY < N) {
          const readIdx = Match3Board.Index(x, readY);
          C[writeIdx] = C[readIdx];
          S[writeIdx] = S[readIdx];
          C[readIdx] = 0;
          S[readIdx] = SpecialType.None;
          this.StepFalls.push({ X: x, ToY: writeY, FromY: readY, IsNewSpawn: false });
        } else {
          // Spawn a new candy from above the top of the board
          const newCol = this.PickRefillColor(x, writeY, rng);
          C[writeIdx] = newCol;
          S[writeIdx] = SpecialType.None;
          const fromY = N + spawnOffset * 0.92;
          spawnOffset++;
          this.StepFalls.push({ X: x, ToY: writeY, FromY: fromY, IsNewSpawn: true });
        }

        writeY++;
      }
    }
  }

  private PickRefillColor(x: number, y: number, rng: SysRandom) {
    // Lightly bias against immediate triple stacks so cascades feel natural (2-3 chain average)
    let c = 1 + rng.next(this.ActiveColors);
    if (y >= 2 && this.Color[Match3Board.Index(x, y - 1)] === c && this.Color[Match3Board.Index(x, y - 2)] === c && rng.nextDouble() < 0.55)
      c = 1 + (c % this.ActiveColors);
    return c;
  }

  // ------------------------------------------------------------------ objectives & win check

  private AddObjectiveProgress(kind: ObjectiveKind, color: number, amount: number) {
    for (const obj of this.Objectives) {
      if (obj.Kind !== kind) continue;
      if (kind === ObjectiveKind.CollectColor && obj.TargetColor !== color) continue;
      obj.Current = Math.min(obj.Target, obj.Current + amount);
    }
  }

  private SyncScoreObjective() {
    for (const obj of this.Objectives) {
      if (obj.Kind !== ObjectiveKind.Score) continue;
      obj.Current = Math.min(obj.Target, this.Score);
    }
  }

  AddBonusScore(points: number) {
    this.Score += points;
    this.SyncScoreObjective();
  }

  get AllObjectivesComplete() {
    if (this.Objectives.length === 0) return this.Score >= this.Star1;
    for (const o of this.Objectives) if (!o.Completed) return false;
    return true;
  }

  get EarnedStars() {
    if (this.Score >= this.Star3) return 3;
    if (this.Score >= this.Star2) return 2;
    return 1;
  }
}
