import { SysRandom } from "../../kit";
import { RawWords } from "./WordList";

/** One word placed on the crossword grid. */
export class PlacedWord {
  Text = "";
  /** Grid column of the first letter (0 = left). */
  X = 0;
  /** Grid row of the first letter (0 = top, increases downward). */
  Y = 0;
  /** true = Across (right, +X), false = Down (down, +Y). */
  Across = false;
  Solved = false;

  constructor(init?: Partial<PlacedWord>) { if (init) Object.assign(this, init); }

  CellAt(index: number): [number, number] { return this.Across ? [this.X + index, this.Y] : [this.X, this.Y + index]; }
}

/** A cell revealed by RevealWord: (x, y, gem). */
export type RevealedCell = [number, number, boolean];

/**
 * Pure crossword board and word-wheel state for WORD WONDER.
 * Grid coordinates use (x = column left-to-right, y = row top-to-bottom). Empty cells hold "".
 */
export class CrosswordPuzzle {
  W = 0; H = 0;
  Wheel: string[] = [];
  readonly Words: PlacedWord[] = [];
  readonly BonusWords = new Set<string>();
  readonly FoundBonus = new Set<string>();

  /** Letter at (x, y), or "" if empty. */
  Grid: string[] = [];
  /** True once the cell at (x, y) has been revealed by solving a word or using a helper. */
  Revealed: boolean[] = [];
  /** True if the cell holds a bonus gem to collect when revealed. */
  HasGem: boolean[] = [];

  Index(x: number, y: number) { return y * this.W + x; }
  InBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }

  get TotalCells() {
    let n = 0;
    for (let i = 0; i < this.Grid.length; i++) if (this.Grid[i] !== "") n++;
    return n;
  }

  get RevealedCells() {
    let n = 0;
    for (let i = 0; i < this.Grid.length; i++) if (this.Grid[i] !== "" && this.Revealed[i]) n++;
    return n;
  }

  get SolvedWordCount() {
    let n = 0;
    for (const w of this.Words) if (w.Solved) n++;
    return n;
  }

  get AllSolved() {
    for (const w of this.Words) if (!w.Solved) return false;
    return true;
  }

  /** Finds a placed word matching `candidate`, or null. */
  FindWord(candidate: string) {
    for (const w of this.Words) if (w.Text === candidate) return w;
    return null;
  }

  /**
   * Marks all cells of `word` revealed and checks whether any intersecting words also became completely revealed
   * as a cascade. Returns the list of newly solved words.
   */
  RevealWord(word: PlacedWord | null, newlyRevealedCells: RevealedCell[] | null) {
    if (newlyRevealedCells) newlyRevealedCells.length = 0;
    const solvedNow: PlacedWord[] = [];
    if (!word) return solvedNow;
    for (let i = 0; i < word.Text.length; i++) {
      const [cx, cy] = word.CellAt(i);
      if (!this.InBounds(cx, cy)) continue;
      const idx = this.Index(cx, cy);
      if (!this.Revealed[idx]) {
        this.Revealed[idx] = true;
        const gem = this.HasGem[idx];
        this.HasGem[idx] = false;
        newlyRevealedCells?.push([cx, cy, gem]);
      }
    }
    if (!word.Solved) {
      word.Solved = true;
      solvedNow.push(word);
    }
    this.SyncCompletedWords(solvedNow);
    return solvedNow;
  }

  /** Reveals a single cell at (x, y) and returns any words that became fully revealed, plus whether a gem was collected. */
  RevealCell(x: number, y: number): [PlacedWord[], boolean] {
    let collectedGem = false;
    const solvedNow: PlacedWord[] = [];
    if (!this.InBounds(x, y)) return [solvedNow, collectedGem];
    const idx = this.Index(x, y);
    if (this.Grid[idx] === "" || this.Revealed[idx]) return [solvedNow, collectedGem];
    this.Revealed[idx] = true;
    if (this.HasGem[idx]) {
      collectedGem = true;
      this.HasGem[idx] = false;
    }
    this.SyncCompletedWords(solvedNow);
    return [solvedNow, collectedGem];
  }

  private SyncCompletedWords(solvedNow: PlacedWord[]) {
    for (const w of this.Words) {
      if (w.Solved) continue;
      let all = true;
      for (let i = 0; i < w.Text.length; i++) {
        const [cx, cy] = w.CellAt(i);
        if (!this.InBounds(cx, cy) || !this.Revealed[this.Index(cx, cy)]) { all = false; break; }
      }
      if (all) {
        w.Solved = true;
        solvedNow.push(w);
      }
    }
  }

  /**
   * Picks the best unrevealed cell for a Hint (prefers intersections of unsolved words, or the start of an unsolved
   * word). Returns (-1, -1) if every cell is already revealed.
   */
  PickHintCell(rng: SysRandom): [number, number] {
    const intersections: [number, number][] = [];
    const starts: [number, number][] = [];
    const others: [number, number][] = [];

    const useCount = new Array<number>(this.W * this.H).fill(0);
    for (const w of this.Words) {
      if (w.Solved) continue;
      for (let i = 0; i < w.Text.length; i++) {
        const [cx, cy] = w.CellAt(i);
        if (this.InBounds(cx, cy)) useCount[this.Index(cx, cy)]++;
      }
    }

    for (const w of this.Words) {
      if (w.Solved) continue;
      const [sx, sy] = w.CellAt(0);
      if (this.InBounds(sx, sy) && !this.Revealed[this.Index(sx, sy)] && !starts.some(([a, b]) => a === sx && b === sy))
        starts.push([sx, sy]);
    }

    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const idx = this.Index(x, y);
        if (this.Grid[idx] === "" || this.Revealed[idx]) continue;
        if (useCount[idx] >= 2) intersections.push([x, y]);
        else others.push([x, y]);
      }

    if (starts.length > 0) return starts[rng.next(starts.length)];
    if (intersections.length > 0) return intersections[rng.next(intersections.length)];
    if (others.length > 0) return others[rng.next(others.length)];
    return [-1, -1];
  }
}

export interface WonderInfo {
  Name: string;
  Region: string;
  AccentHex: number;
  Accent2Hex: number;
  BgTopHex: number;
  BgBottomHex: number;
  /** 0=Pyramid, 1=Stonehenge, 2=Parthenon, 3=Colosseum, 4=Petra, 5=MachuPicchu, 6=TajMahal, 7=ChichenItza */
  MonumentType: number;
}

// Curated high-anagram word stems by length so every wheel has plenty of intersecting words.
const Stems3 = [
  "TEN", "ART", "TEA", "TOP", "TAP", "STAR", // level 1 & 2 use 3-letter stems
];

const Stems4 = [
  "STAR", "TEAM", "TIME", "STOP", "EAST", "LATE", "PEAR", "CARE",
  "PART", "TONE", "SALT", "MILE", "DEAL", "RATE", "SAND", "GOLD",
  "WIND", "FIRE", "ROSE", "MOON", "TIDE", "GLOW", "DAWN", "PEAK",
];

const Stems5 = [
  "STONE", "HEART", "PLANT", "SMART", "START", "TRAIN", "LIGHT", "NIGHT",
  "WATER", "EARTH", "DREAM", "SMILE", "TRACE", "SPARE", "CLEAN", "BREAD",
  "CRANE", "SHORE", "FLAME", "CROWN", "PEARL", "STORM", "TRAIL", "SPACE",
  "SOLAR", "MAGIC", "PRISM", "GLADE", "CHARM", "NOBLE", "QUEST", "STEAL",
];

const Stems6 = [
  "PLANET", "STREAM", "MASTER", "GARDEN", "CASTLE", "FOREST", "SILVER", "WONDER",
  "GOLDEN", "TEMPLE", "ISLAND", "SILENT", "SPRING", "BRIGHT", "DESERT", "DRAGON",
  "PALACE", "LEGEND", "WINTER", "SUMMER", "SPIRIT", "BRIDGE", "FLOWER", "ANCHOR",
  "THRONE", "VOYAGE", "MARKET", "CAVERN", "SUNSET", "BEACON", "FALCON", "SHIELD",
];

const Stems7 = [
  "LANTERN", "CRYSTAL", "KINGDOM", "CAPTAIN", "HARVEST", "MONSTER", "THUNDER",
  "DIAMOND", "FORTUNE", "JOURNEY", "ANCIENT", "MIRACLE", "HORIZON", "COMPASS",
  "EMERALD", "PYRAMID", "PAINTER", "GRANITE", "GLACIER", "STARLIT",
];

let lexicon: Set<string> | null = null;
let allWords: string[] = [];

/** C# string.CompareOrdinal for A-Z strings. */
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Deterministic crossword generator and lexicon for WORD WONDER.
 * Level 1 begins with a classic 3-letter wheel ("TEN" / "NET") just like Words of Wonders, then scales smoothly
 * through 4-, 5-, 6- and 7-letter wheels across world wonders.
 */
export const CrosswordGenerator = {
  Wonders: [
    { Name: "GREAT PYRAMID", Region: "GIZA · EGYPT", AccentHex: 0xffc94d, Accent2Hex: 0xff7a45, BgTopHex: 0x3d1e4f, BgBottomHex: 0x160a24, MonumentType: 0 },
    { Name: "STONEHENGE", Region: "WILTSHIRE · UK", AccentHex: 0x4df0d0, Accent2Hex: 0x7a8cff, BgTopHex: 0x102e4a, BgBottomHex: 0x061020, MonumentType: 1 },
    { Name: "THE PARTHENON", Region: "ATHENS · GREECE", AccentHex: 0x55e6ff, Accent2Hex: 0xffd25a, BgTopHex: 0x162955, BgBottomHex: 0x070e24, MonumentType: 2 },
    { Name: "THE COLOSSEUM", Region: "ROME · ITALY", AccentHex: 0xff8c42, Accent2Hex: 0xffd04d, BgTopHex: 0x42152b, BgBottomHex: 0x140610, MonumentType: 3 },
    { Name: "PETRA TREASURY", Region: "MA'AN · JORDAN", AccentHex: 0xff6b8b, Accent2Hex: 0xffc46b, BgTopHex: 0x3b1434, BgBottomHex: 0x120614, MonumentType: 4 },
    { Name: "MACHU PICCHU", Region: "CUSCO · PERU", AccentHex: 0x5cffa0, Accent2Hex: 0xffe055, BgTopHex: 0x0e3b36, BgBottomHex: 0x041414, MonumentType: 5 },
    { Name: "TAJ MAHAL", Region: "AGRA · INDIA", AccentHex: 0xe07aff, Accent2Hex: 0x63f2ff, BgTopHex: 0x2a124c, BgBottomHex: 0x0b051c, MonumentType: 6 },
    { Name: "CHICHEN ITZA", Region: "YUCATAN · MEXICO", AccentHex: 0xffd84d, Accent2Hex: 0x4dff9a, BgTopHex: 0x1e3318, BgBottomHex: 0x081209, MonumentType: 7 },
  ] as readonly WonderInfo[],

  WonderForLevel(level: number): WonderInfo {
    let idx: number;
    if (level <= 3) idx = 0;
    else if (level <= 7) idx = 1;
    else if (level <= 12) idx = 2;
    else if (level <= 18) idx = 3;
    else if (level <= 25) idx = 4;
    else if (level <= 33) idx = 5;
    else if (level <= 42) idx = 6;
    else if (level <= 52) idx = 7;
    else idx = Math.trunc((level - 53) / 8) % CrosswordGenerator.Wonders.length;
    return CrosswordGenerator.Wonders[idx];
  },

  EnsureLexicon() {
    if (lexicon) return;
    lexicon = new Set<string>();
    allWords = [];
    for (const raw of RawWords) {
      const w = raw.trim().toUpperCase();
      if (w.length >= 3 && w.length <= 7 && IsAlpha(w) && !lexicon.has(w)) { lexicon.add(w); allWords.push(w); }
    }
    for (const arr of [Stems3, Stems4, Stems5, Stems6, Stems7])
      for (const s of arr)
        if (s.length >= 3 && IsAlpha(s) && !lexicon.has(s)) { lexicon.add(s); allWords.push(s); }
  },

  IsValidDictionaryWord(word: string) {
    CrosswordGenerator.EnsureLexicon();
    return lexicon!.has(word);
  },

  /** Builds a deterministic, connected, strict crossword puzzle for `level`. */
  Build(level: number): CrosswordPuzzle {
    CrosswordGenerator.EnsureLexicon();

    // Level 1 is the iconic "TEN" / "NET" tutorial board matching the Words of Wonders screenshot.
    if (level <= 1) return BuildFixedTutorial1();
    if (level === 2) return BuildFixedTutorial2();

    const rng = new SysRandom(level * 4999 + 317);
    const pool = level <= 5 ? Stems4
      : level <= 15 ? Stems5
      : level <= 35 ? Stems6
      : (level % 3 === 0 ? Stems7 : Stems6);

    const targetWordCount = level <= 4 ? 3
      : level <= 8 ? 4
      : level <= 14 ? 5
      : level <= 24 ? 6
      : level <= 40 ? 7
      : 8;

    for (let attempt = 0; attempt < 60; attempt++) {
      const stem = pool[(level - 1 + attempt * 7) % pool.length];
      const candidates = SubWordsOf(stem);
      if (candidates.length < 3) continue;

      const puzzle = TryLayoutCrossword(stem, candidates, targetWordCount, rng, level);
      if (puzzle && puzzle.Words.length >= Math.min(3, candidates.length)) return puzzle;
    }

    return BuildFixedTutorial2();
  },

  ShuffleWheel(wheel: string[], rng: SysRandom) {
    for (let i = wheel.length - 1; i > 0; i--) {
      const j = rng.next(i + 1);
      [wheel[i], wheel[j]] = [wheel[j], wheel[i]];
    }
  },
};

function IsAlpha(s: string) {
  for (let i = 0; i < s.length; i++) if (s[i] < "A" || s[i] > "Z") return false;
  return true;
}

function BuildFixedTutorial1() {
  // Exact '+' layout with TEN (Across) and NET (Down) sharing 'E' in the center!
  const p = new CrosswordPuzzle();
  p.Wheel = ["E", "N", "T"];
  p.Words.push(new PlacedWord({ Text: "TEN", X: 0, Y: 1, Across: true }));
  p.Words.push(new PlacedWord({ Text: "NET", X: 1, Y: 0, Across: false }));
  BakeGrid(p);
  return p;
}

function BuildFixedTutorial2() {
  // Clean 4x4 layout: STAR (Across row 0), TAR (Down col 1), RATS (Down col 3)
  const p = new CrosswordPuzzle();
  p.Wheel = ["S", "T", "A", "R"];
  p.Words.push(new PlacedWord({ Text: "STAR", X: 0, Y: 0, Across: true }));
  p.Words.push(new PlacedWord({ Text: "TAR", X: 1, Y: 0, Across: false }));
  p.Words.push(new PlacedWord({ Text: "RATS", X: 3, Y: 0, Across: false }));
  p.BonusWords.add("ART");
  p.BonusWords.add("RAT");
  p.BonusWords.add("SAT");
  p.BonusWords.add("ARTS");
  p.BonusWords.add("TARS");
  BakeGrid(p);
  if (p.InBounds(3, 3)) p.HasGem[p.Index(3, 3)] = true;
  return p;
}

function SubWordsOf(stem: string) {
  const stemCounts = CountLetters(stem);
  const list: string[] = [];
  for (const w of allWords) {
    if (w.length < 3 || w.length > stem.length) continue;
    if (CanSpell(w, stemCounts)) list.push(w);
  }
  // Sort longer words first so the spine of the crossword is substantial.
  list.sort((a, b) => {
    const cmp = b.length - a.length;
    return cmp !== 0 ? cmp : ordinal(a, b);
  });
  return list;
}

function CountLetters(s: string) {
  const c = new Array<number>(26).fill(0);
  for (let i = 0; i < s.length; i++) {
    const idx = s.charCodeAt(i) - 65;
    if (idx >= 0 && idx < 26) c[idx]++;
  }
  return c;
}

function CanSpell(word: string, available: number[]) {
  const used = new Array<number>(26).fill(0);
  for (let i = 0; i < word.length; i++) {
    const idx = word.charCodeAt(i) - 65;
    if (idx < 0 || idx >= 26) return false;
    if (++used[idx] > available[idx]) return false;
  }
  return true;
}

function TryLayoutCrossword(stem: string, allValidSubwords: string[], maxWords: number, rng: SysRandom, level: number) {
  const Cap = 24;
  const Mid = Cap / 2;
  // [x][y] scratch boards, like the C# char[,] (x first)
  const board: string[][] = Array.from({ length: Cap }, () => new Array<string>(Cap).fill(""));
  const hasAcross: boolean[][] = Array.from({ length: Cap }, () => new Array<boolean>(Cap).fill(false));
  const hasDown: boolean[][] = Array.from({ length: Cap }, () => new Array<boolean>(Cap).fill(false));

  const placed: PlacedWord[] = [];
  const usedWords = new Set<string>();

  // Shuffle candidates and prefer longer words first with deterministic tie-breaking.
  const scored: [string, number][] = [];
  for (const w of allValidSubwords) {
    if (w === stem) continue;
    scored.push([w, w.length * 100 + rng.next(100)]);
  }
  scored.sort((a, b) => {
    const cmp = b[1] - a[1];
    return cmp !== 0 ? cmp : ordinal(a[0], b[0]);
  });
  const pool = [stem];
  for (let i = 0; i < scored.length; i++) pool.push(scored[i][0]);

  // Place the stem word in the middle.
  const firstAcross = rng.next(2) === 0;
  const startX = firstAcross ? Mid - Math.trunc(stem.length / 2) : Mid;
  const startY = firstAcross ? Mid : Mid - Math.trunc(stem.length / 2);
  PlaceOnScratch(board, hasAcross, hasDown, stem, startX, startY, firstAcross);
  placed.push(new PlacedWord({ Text: stem, X: startX, Y: startY, Across: firstAcross }));
  usedWords.add(stem);

  // Iteratively place intersecting words.
  for (let pass = 0; pass < 3 && placed.length < maxWords; pass++) {
    for (const w of pool) {
      if (placed.length >= maxWords) break;
      if (usedWords.has(w)) continue;

      // Find all valid intersection placements and pick the most compact one.
      let bestX = -1, bestY = -1;
      let bestAcross = false;
      let bestScore = Number.MAX_SAFE_INTEGER;

      for (const pw of placed) {
        const dir = !pw.Across; // must cross perpendicular to pw
        for (let i = 0; i < w.length; i++) {
          const c = w[i];
          for (let j = 0; j < pw.Text.length; j++) {
            if (pw.Text[j] !== c) continue;
            const [ix, iy] = pw.CellAt(j);
            const candX = dir ? ix - i : ix;
            const candY = dir ? iy : iy - i;
            if (!CanPlaceOnScratch(board, hasAcross, hasDown, Cap, w, candX, candY, dir)) continue;

            // Score by bounding-box compactness so the board stays tight and readable.
            const area = EstimateArea(placed, w, candX, candY, dir);
            if (area < bestScore) {
              bestScore = area;
              bestX = candX;
              bestY = candY;
              bestAcross = dir;
            }
          }
        }
      }

      if (bestX >= 0) {
        PlaceOnScratch(board, hasAcross, hasDown, w, bestX, bestY, bestAcross);
        placed.push(new PlacedWord({ Text: w, X: bestX, Y: bestY, Across: bestAcross }));
        usedWords.add(w);
      }
    }
  }

  if (placed.length < 2) return null;

  // Compute bounding box and normalize coordinates to (0..W-1, 0..H-1).
  let minX = Cap, minY = Cap, maxX = 0, maxY = 0;
  for (const pw of placed)
    for (let i = 0; i < pw.Text.length; i++) {
      const [cx, cy] = pw.CellAt(i);
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
    }

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (bw > 11 || bh > 11) return null; // keep grid cells large and legible on mobile & web

  for (const pw of placed) {
    pw.X -= minX;
    pw.Y -= minY;
  }

  // Prepare wheel letters (shuffled).
  const wheel = stem.split("");
  CrosswordGenerator.ShuffleWheel(wheel, rng);

  const puzzle = new CrosswordPuzzle();
  puzzle.W = bw;
  puzzle.H = bh;
  puzzle.Wheel = wheel;
  puzzle.Grid = new Array<string>(bw * bh).fill("");
  puzzle.Revealed = new Array<boolean>(bw * bh).fill(false);
  puzzle.HasGem = new Array<boolean>(bw * bh).fill(false);
  puzzle.Words.push(...placed);
  for (const sub of allValidSubwords) if (!usedWords.has(sub)) puzzle.BonusWords.add(sub);

  BakeGrid(puzzle);

  // Sprinkle 1..2 gem tiles on unrevealed non-intersection cells from level 3 onwards.
  if (level >= 3 && puzzle.Words.length > 0) {
    const gemsToPlace = level >= 12 ? 2 : 1;
    for (let g = 0; g < gemsToPlace; g++) {
      const pw = puzzle.Words[(level + g * 3) % puzzle.Words.length];
      const charIdx = pw.Text.length - 1;
      const [gx, gy] = pw.CellAt(charIdx);
      if (puzzle.InBounds(gx, gy)) puzzle.HasGem[puzzle.Index(gx, gy)] = true;
    }
  }

  return puzzle;
}

function CanPlaceOnScratch(board: string[][], hasAcross: boolean[][], hasDown: boolean[][], cap: number, word: string, x: number, y: number, across: boolean) {
  const dx = across ? 1 : 0;
  const dy = across ? 0 : 1;
  const endX = x + dx * (word.length - 1);
  const endY = y + dy * (word.length - 1);
  if (x < 1 || y < 1 || endX >= cap - 1 || endY >= cap - 1) return false;

  // Cell immediately before the start and after the end must be empty.
  if (board[x - dx][y - dy] !== "") return false;
  if (board[endX + dx][endY + dy] !== "") return false;

  let intersections = 0;
  for (let i = 0; i < word.length; i++) {
    const cx = x + dx * i;
    const cy = y + dy * i;
    const existing = board[cx][cy];

    if (existing !== "") {
      if (existing !== word[i]) return false;
      // Cannot overlap another word in the same direction.
      if (across && hasAcross[cx][cy]) return false;
      if (!across && hasDown[cx][cy]) return false;
      intersections++;
    } else {
      // Perpendicular neighbors must be empty so we don't create accidental 2-letter words.
      const px = dy, py = dx;
      if (board[cx - px][cy - py] !== "" || board[cx + px][cy + py] !== "") return false;
    }
  }
  return intersections > 0;
}

function PlaceOnScratch(board: string[][], hasAcross: boolean[][], hasDown: boolean[][], word: string, x: number, y: number, across: boolean) {
  const dx = across ? 1 : 0;
  const dy = across ? 0 : 1;
  for (let i = 0; i < word.length; i++) {
    const cx = x + dx * i;
    const cy = y + dy * i;
    board[cx][cy] = word[i];
    if (across) hasAcross[cx][cy] = true;
    else hasDown[cx][cy] = true;
  }
}

function EstimateArea(placed: PlacedWord[], w: string, x: number, y: number, across: boolean) {
  let minX = x, minY = y;
  let maxX = across ? x + w.length - 1 : x;
  let maxY = across ? y : y + w.length - 1;
  for (const pw of placed) {
    if (pw.X < minX) minX = pw.X;
    if (pw.Y < minY) minY = pw.Y;
    const ex = pw.Across ? pw.X + pw.Text.length - 1 : pw.X;
    const ey = pw.Across ? pw.Y : pw.Y + pw.Text.length - 1;
    if (ex > maxX) maxX = ex;
    if (ey > maxY) maxY = ey;
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  return width * height + Math.abs(width - height) * 3;
}

function BakeGrid(p: CrosswordPuzzle) {
  if (p.Words.length === 0) {
    p.W = p.H = 1;
    p.Grid = [""];
    p.Revealed = [false];
    p.HasGem = [false];
    return;
  }

  let minX = Number.MAX_SAFE_INTEGER, minY = Number.MAX_SAFE_INTEGER;
  let maxX = Number.MIN_SAFE_INTEGER, maxY = Number.MIN_SAFE_INTEGER;
  for (const w of p.Words)
    for (let i = 0; i < w.Text.length; i++) {
      const [cx, cy] = w.CellAt(i);
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
    }

  if (minX !== 0 || minY !== 0) {
    for (const w of p.Words) {
      w.X -= minX;
      w.Y -= minY;
    }
    maxX -= minX;
    maxY -= minY;
  }

  p.W = Math.max(1, maxX + 1);
  p.H = Math.max(1, maxY + 1);
  const total = p.W * p.H;
  p.Grid = new Array<string>(total).fill("");
  p.Revealed = new Array<boolean>(total).fill(false);
  p.HasGem = new Array<boolean>(total).fill(false);

  for (const w of p.Words)
    for (let i = 0; i < w.Text.length; i++) {
      const [cx, cy] = w.CellAt(i);
      if (p.InBounds(cx, cy)) p.Grid[p.Index(cx, cy)] = w.Text[i];
    }
}
