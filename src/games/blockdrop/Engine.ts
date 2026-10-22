/**
 * BLOCK DROP rules engine: a 10-wide well with a hidden buffer above it, the seven four-cell pieces, a 7-bag
 * randomizer, SRS-style rotation with wall kicks, hold, ghost, gravity by level, lock delay with move reset, line
 * clears with a short clear delay, scoring (combos, back-to-back, spins, all clear) and versus garbage.
 * Pure logic with no kit imports, so the bot can be tested headlessly.
 */

export const W = 10;
export const VISIBLE = 20;
export const H = 40;

/** Piece kinds. 0 is empty; 8 is garbage. */
export enum Kind { None = 0, I = 1, O = 2, T = 3, S = 4, Z = 5, J = 6, L = 7, Garbage = 8 }
export const KindNames = ["", "I", "O", "T", "S", "Z", "J", "L", "G"];

/** Cells of each kind in rotation state 0 inside its box, y DOWN from the box top (SRS layout). */
const SpawnCells: Record<number, [number, number][]> = {
  [Kind.I]: [[0, 1], [1, 1], [2, 1], [3, 1]],
  [Kind.O]: [[1, 0], [2, 0], [1, 1], [2, 1]],
  [Kind.T]: [[1, 0], [0, 1], [1, 1], [2, 1]],
  [Kind.S]: [[1, 0], [2, 0], [0, 1], [1, 1]],
  [Kind.Z]: [[0, 0], [1, 0], [1, 1], [2, 1]],
  [Kind.J]: [[0, 0], [0, 1], [1, 1], [2, 1]],
  [Kind.L]: [[2, 0], [0, 1], [1, 1], [2, 1]],
};
const BoxSize = (k: Kind) => (k === Kind.I || k === Kind.O ? 4 : 3);

/** SHAPES[kind][rot] = 4 cells as (dx, dy) with y UP, relative to the box's top-left corner. */
export const SHAPES: [number, number][][][] = [];
for (let k = 1; k <= 7; k++) {
  const n = BoxSize(k as Kind);
  const rots: [number, number][][] = [];
  let cells = SpawnCells[k].map(([x, y]) => [x, y] as [number, number]);
  for (let r = 0; r < 4; r++) {
    rots.push(cells.map(([x, y]) => [x, -y] as [number, number]));
    // clockwise in a y-down box: (x, y) -> (n-1-y, x)
    cells = k === Kind.O ? cells : cells.map(([x, y]) => [n - 1 - y, x] as [number, number]);
  }
  SHAPES[k] = rots;
}

// SRS kick tables (y up), indexed by "from>to".
const KicksJLSTZ: Record<string, [number, number][]> = {
  "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KicksI: Record<string, [number, number][]> = {
  "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

/** Small seeded PRNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number) { return Math.floor(this.next() * n); }
}

export interface Piece { kind: Kind; rot: number; x: number; y: number }

export enum Spin { None, Mini, Full }

/** What happened when a piece locked (for scoring popups, sounds and effects). */
export interface LockReport {
  lines: number;
  rows: number[];
  spin: Spin;
  b2b: boolean;
  combo: number;
  allClear: boolean;
  score: number;
  sent: number;
  label: string;
  cells: [number, number][];
  kind: Kind;
}

/** Seconds per row at a level (guideline curve). */
export function gravityFor(level: number) {
  const l = Math.min(level, 20);
  return Math.pow(0.8 - (l - 1) * 0.007, l - 1);
}

const ComboGarbage = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];

export class Engine {
  /** Row-major, y up: grid[y * W + x]. */
  readonly grid = new Uint8Array(W * H);
  active: Piece | null = null;
  hold: Kind = Kind.None;
  holdUsed = false;
  readonly queue: Kind[] = [];
  private rng: Rng;

  score = 0; lines = 0; level = 1; startLevel = 1;
  combo = -1; b2b = false;
  pieces = 0; quads = 0; spins = 0; maxCombo = 0;
  over = false;
  /** Fixed level (versus modes drive it from the clock instead of lines). */
  levelFromLines = true;

  // timing
  private fall = 0;
  lockTimer = 0;
  lockResets = 0;
  private lowestY = 99;
  softDropping = false;
  /** Rows being cleared (shown flashing) and the time left before they collapse. */
  clearing: number[] = [];
  clearTimer = 0;
  spawnDelay = 0;
  lastRotate = false;
  lastKick = 0;

  // versus
  pendingGarbage: number[] = []; // batches of rows waiting to rise
  garbageRng: Rng;
  onLock: ((r: LockReport) => void) | null = null;
  onSpawn: (() => void) | null = null;
  onGarbage: ((rows: number) => void) | null = null;

  static readonly LockDelay = 0.5;
  static readonly MaxResets = 15;
  static readonly ClearDelay = 0.32;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.garbageRng = new Rng(seed ^ 0x5bd1e995);
  }

  reset(startLevel = 1) {
    this.grid.fill(0);
    this.queue.length = 0;
    this.hold = Kind.None;
    this.holdUsed = false;
    this.score = this.lines = this.pieces = this.quads = this.spins = this.maxCombo = 0;
    this.level = this.startLevel = startLevel;
    this.combo = -1;
    this.b2b = false;
    this.over = false;
    this.clearing = [];
    this.clearTimer = 0;
    this.pendingGarbage = [];
    this.fillQueue();
    this.spawn();
  }

  private fillQueue() {
    while (this.queue.length < 7) {
      const bag = [1, 2, 3, 4, 5, 6, 7];
      for (let i = bag.length - 1; i > 0; i--) { const j = this.rng.int(i + 1); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      this.queue.push(...(bag as Kind[]));
    }
  }

  get(x: number, y: number) { return x < 0 || x >= W || y < 0 ? 8 : y >= H ? 0 : this.grid[y * W + x]; }

  /** Cells of a piece in board coordinates. */
  static cells(p: Piece): [number, number][] {
    return SHAPES[p.kind][p.rot].map(([dx, dy]) => [p.x + dx, p.y + dy] as [number, number]);
  }

  fits(p: Piece) {
    for (const [dx, dy] of SHAPES[p.kind][p.rot]) if (this.get(p.x + dx, p.y + dy) !== 0) return false;
    return true;
  }

  static spawnPiece(kind: Kind): Piece {
    // box top at row 21 so the piece shows in the top two visible rows after its first step down
    return { kind, rot: 0, x: kind === Kind.O ? 3 : 3, y: VISIBLE + 1 };
  }

  private spawn(kind?: Kind) {
    const k = kind ?? this.queue.shift()!;
    this.fillQueue();
    const p = Engine.spawnPiece(k);
    // drop one row right away if possible (guideline), like spawning in rows 20-21
    if (!this.fits(p)) { this.active = p; this.over = true; return; }
    const down = { ...p, y: p.y - 1 };
    if (this.fits(down)) p.y--;
    this.active = p;
    this.fall = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestY = p.y;
    this.lastRotate = false;
    this.onSpawn?.();
  }

  get gravity() { return gravityFor(this.level); }

  /** Advances time. softDrop: the soft drop key is held. */
  tick(dt: number) {
    if (this.over) return;
    if (this.clearing.length > 0) {
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) this.finishClear();
      return;
    }
    if (this.spawnDelay > 0) {
      this.spawnDelay -= dt;
      if (this.spawnDelay <= 0) this.spawnNext();
      return;
    }
    const p = this.active;
    if (!p) return;
    let g = this.gravity;
    if (this.softDropping) g = Math.min(g / 20, 0.035);
    this.fall += dt;
    let guard = 0;
    while (this.fall >= g && guard++ < 40) {
      this.fall -= g;
      if (!this.step(0, -1)) { this.fall = 0; break; }
      if (this.softDropping) this.score += 1;
    }
    if (!this.canMove(0, -1)) {
      this.lockTimer += dt;
      if (this.lockTimer >= Engine.LockDelay || this.lockResets >= Engine.MaxResets) this.lock();
    }
  }

  canMove(dx: number, dy: number) {
    const p = this.active;
    return !!p && this.fits({ ...p, x: p.x + dx, y: p.y + dy });
  }

  private step(dx: number, dy: number) {
    const p = this.active!;
    const n = { ...p, x: p.x + dx, y: p.y + dy };
    if (!this.fits(n)) return false;
    this.active = n;
    if (n.y < this.lowestY) { this.lowestY = n.y; this.lockResets = 0; this.lockTimer = 0; }
    return true;
  }

  private moveReset() {
    if (!this.canMove(0, -1) || this.lockTimer > 0) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  get busy() { return this.over || !this.active || this.clearing.length > 0 || this.spawnDelay > 0; }

  move(dx: number) {
    if (this.busy) return false;
    if (!this.step(dx, 0)) return false;
    this.lastRotate = false;
    this.moveReset();
    return true;
  }

  rotate(dir: 1 | -1) {
    if (this.busy) return false;
    const p = this.active!;
    if (p.kind === Kind.O) return false;
    const to = (p.rot + (dir > 0 ? 1 : 3)) % 4;
    const table = p.kind === Kind.I ? KicksI : KicksJLSTZ;
    const kicks = table[`${p.rot}>${to}`];
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      const n = { ...p, rot: to, x: p.x + kx, y: p.y + ky };
      if (this.fits(n)) {
        this.active = n;
        if (n.y < this.lowestY) { this.lowestY = n.y; this.lockResets = 0; }
        this.lastRotate = true;
        this.lastKick = i;
        this.moveReset();
        return true;
      }
    }
    return false;
  }

  /** Hard drop: returns rows dropped. */
  hardDrop() {
    if (this.busy) return 0;
    let n = 0;
    while (this.canMove(0, -1)) { this.active = { ...this.active!, y: this.active!.y - 1 }; n++; }
    if (n > 0) this.lastRotate = false;
    this.score += n * 2;
    this.lock();
    return n;
  }

  /** One row down from a soft drop gesture. */
  softStep() {
    if (this.busy) return false;
    if (!this.step(0, -1)) return false;
    this.lastRotate = false;
    this.score += 1;
    this.fall = 0;
    return true;
  }

  holdPiece() {
    if (this.busy || this.holdUsed) return false;
    const cur = this.active!.kind;
    const swap = this.hold;
    this.hold = cur;
    this.holdUsed = true;
    if (swap === Kind.None) this.spawn();
    else this.spawn(swap);
    this.holdUsed = true;
    return true;
  }

  ghostY() {
    const p = this.active;
    if (!p) return 0;
    let y = p.y;
    while (this.fits({ ...p, y: y - 1 })) y--;
    return y;
  }

  private spinCheck(p: Piece): Spin {
    if (p.kind !== Kind.T || !this.lastRotate) return Spin.None;
    // T box centre is (x+1, y-1); check the four diagonal corners
    const cx = p.x + 1, cy = p.y - 1;
    const corners = [[cx - 1, cy + 1], [cx + 1, cy + 1], [cx + 1, cy - 1], [cx - 1, cy - 1]].map(([x, y]) => this.get(x, y) !== 0);
    const filled = corners.filter(Boolean).length;
    if (filled < 3) return Spin.None;
    // front corners depend on the pointing direction: rot 0 up, 1 right, 2 down, 3 left
    const front = [[0, 1], [1, 2], [2, 3], [3, 0]][p.rot];
    const frontFilled = (corners[front[0]] ? 1 : 0) + (corners[front[1]] ? 1 : 0);
    if (frontFilled === 2 || this.lastKick === 4) return Spin.Full;
    return Spin.Mini;
  }

  private lock() {
    const p = this.active!;
    const spin = this.spinCheck(p);
    const cells = Engine.cells(p);
    let above = true;
    for (const [x, y] of cells) {
      if (y >= 0 && y < H) this.grid[y * W + x] = p.kind;
      if (y < VISIBLE) above = false;
    }
    this.active = null;
    this.pieces++;
    const rows: number[] = [];
    for (let y = 0; y < H; y++) {
      let full = true;
      for (let x = 0; x < W; x++) if (this.grid[y * W + x] === 0) { full = false; break; }
      if (full) rows.push(y);
    }
    const lines = rows.length;
    let base = 0, label = "", sent = 0;
    if (spin === Spin.Full) {
      base = [400, 800, 1200, 1600][lines];
      label = ["SPIN!", "SPIN SINGLE", "SPIN DOUBLE", "SPIN TRIPLE"][lines];
      sent = [0, 2, 4, 6][lines];
    } else if (spin === Spin.Mini) {
      base = [100, 200, 400, 400][lines];
      label = lines > 0 ? "MINI SPIN" : "";
      sent = [0, 0, 1, 1][lines];
    } else {
      base = [0, 100, 300, 500, 800][lines];
      label = ["", "", "DOUBLE", "TRIPLE", "QUAD!"][lines];
      sent = [0, 0, 1, 2, 4][lines];
    }
    const difficult = lines === 4 || (spin !== Spin.None && lines > 0);
    let b2bBonus = false;
    if (lines > 0) {
      if (difficult && this.b2b) { base = Math.floor(base * 1.5); sent += 1; b2bBonus = true; }
      this.b2b = difficult;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      if (this.combo > 0) { base += 50 * this.combo; sent += ComboGarbage[Math.min(this.combo, ComboGarbage.length - 1)]; }
    } else this.combo = -1;
    if (spin !== Spin.None && lines > 0) this.spins++;
    if (lines === 4) this.quads++;
    let allClear = false;
    if (lines > 0) {
      allClear = true;
      for (let i = 0; i < W * H; i++) {
        const y = Math.floor(i / W);
        if (this.grid[i] !== 0 && !rows.includes(y)) { allClear = false; break; }
      }
      if (allClear) { base += [0, 800, 1200, 1800, 2000][lines]; sent += 10; label = "ALL CLEAR!"; }
    }
    const gained = base * this.level;
    this.score += gained;
    // outgoing garbage cancels incoming first
    while (sent > 0 && this.pendingGarbage.length > 0) {
      const take = Math.min(sent, this.pendingGarbage[0]);
      this.pendingGarbage[0] -= take;
      sent -= take;
      if (this.pendingGarbage[0] <= 0) this.pendingGarbage.shift();
    }
    const report: LockReport = { lines, rows, spin, b2b: b2bBonus, combo: this.combo, allClear, score: gained, sent, label, cells, kind: p.kind };
    if (lines > 0) {
      this.clearing = rows;
      this.clearTimer = Engine.ClearDelay;
    } else {
      this.riseGarbage();
      if (above && this.over === false && cells.every(([, y]) => y >= VISIBLE)) this.over = true; // lock out
      this.spawnDelay = 0.0001;
    }
    this.onLock?.(report);
  }

  private finishClear() {
    const rows = this.clearing;
    const keep: Uint8Array[] = [];
    for (let y = 0; y < H; y++) if (!rows.includes(y)) keep.push(this.grid.slice(y * W, y * W + W));
    this.grid.fill(0);
    keep.forEach((row, y) => this.grid.set(row, y * W));
    this.lines += rows.length;
    if (this.levelFromLines) this.level = Math.max(this.startLevel, 1 + Math.floor(this.lines / 10));
    this.clearing = [];
    this.spawnNext();
  }

  private spawnNext() {
    this.spawnDelay = 0;
    this.holdUsed = false;
    if (!this.over) this.spawn();
  }

  /** Queues garbage rows sent by the opponent (they rise after this player's next lock without a clear). */
  receive(rows: number) { if (rows > 0) this.pendingGarbage.push(rows); }

  get incoming() { return this.pendingGarbage.reduce((a, b) => a + b, 0); }

  private riseGarbage() {
    let total = 0;
    while (this.pendingGarbage.length > 0 && total < 8) {
      const n = Math.min(this.pendingGarbage[0], 8 - total);
      this.addGarbage(n);
      total += n;
      this.pendingGarbage[0] -= n;
      if (this.pendingGarbage[0] <= 0) this.pendingGarbage.shift();
    }
    if (total > 0) this.onGarbage?.(total);
  }

  /** Pushes n garbage rows (one shared hole) up from the bottom. */
  addGarbage(n: number) {
    const hole = this.garbageRng.int(W);
    for (let y = H - 1; y >= n; y--) for (let x = 0; x < W; x++) this.grid[y * W + x] = this.grid[(y - n) * W + x];
    for (let y = 0; y < n; y++) for (let x = 0; x < W; x++) this.grid[y * W + x] = x === hole ? 0 : Kind.Garbage;
    // stack pushed into the active piece: nudge it up
    if (this.active) while (!this.fits(this.active) && this.active.y < H) this.active = { ...this.active, y: this.active.y + 1 };
    // anything pushed past the top tops out
    for (let x = 0; x < W; x++) if (this.grid[(H - 1) * W + x] !== 0) this.over = true;
  }

  /** Rewarded continue: removes the bottom rows and lets the stack fall. */
  clearBottom(n: number) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) this.grid[y * W + x] = y + n < H ? this.grid[(y + n) * W + x] : 0;
    this.pendingGarbage = [];
    this.over = false;
    this.clearing = [];
    this.active = null;
    // make room at the top if the stack still reaches the spawn rows
    let top = this.stackHeight();
    while (top > VISIBLE - 4) { this.clearBottom2(); top = this.stackHeight(); }
    this.holdUsed = false;
    this.spawn();
  }

  private clearBottom2() {
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x++) this.grid[y * W + x] = this.grid[(y + 1) * W + x];
    for (let x = 0; x < W; x++) this.grid[(H - 1) * W + x] = 0;
  }

  stackHeight() {
    for (let y = H - 1; y >= 0; y--) for (let x = 0; x < W; x++) if (this.grid[y * W + x] !== 0) return y + 1;
    return 0;
  }
}
