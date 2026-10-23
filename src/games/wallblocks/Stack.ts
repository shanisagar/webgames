/**
 * BLOCK DROP WALL rules: an 8-wide, 14-tall well (plus hidden rows above it), the seven four-cell pieces from a
 * shuffled bag, rotation with simple wall kicks, slow gravity set by the game, a short lock delay, line clears with
 * a flash delay and junk rows from the rival. Pure logic (no kit imports) so the computer stacker can be tested
 * headlessly. Steering comes from ball hits: nudge one column, rotate, or slam down.
 */

export const W = 8;
export const H = 14;
/** Rows kept above the visible well (spawn and rotation room). */
export const BUF = 4;
export const HT = H + BUF;

export enum Kind { None = 0, I = 1, O = 2, T = 3, S = 4, Z = 5, J = 6, L = 7, Junk = 8 }

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

/** SHAPES[kind][rot] = 4 cells (dx, dy), y UP, relative to the box's top-left corner. */
export const SHAPES: [number, number][][][] = [];
for (let k = 1; k <= 7; k++) {
  const n = BoxSize(k as Kind);
  const rots: [number, number][][] = [];
  let cells = SpawnCells[k].map(([x, y]) => [x, y] as [number, number]);
  for (let r = 0; r < 4; r++) {
    rots.push(cells.map(([x, y]) => [x, -y] as [number, number]));
    cells = k === Kind.O ? cells : cells.map(([x, y]) => [n - 1 - y, x] as [number, number]);
  }
  SHAPES[k] = rots;
}

const Kicks: [number, number][] = [[0, 0], [-1, 0], [1, 0], [0, 1], [-2, 0], [2, 0], [0, -1]];

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

export interface ClearReport { lines: number; rows: number[]; points: number; junk: number }

export const LinePoints = [0, 100, 300, 500, 800];
/** Junk rows sent for clearing n lines at once (two lines send one). */
export const JunkFor = [0, 0, 1, 2, 3];

export class Well {
  readonly grid = new Uint8Array(W * HT);
  active: Piece | null = null;
  next: Kind = Kind.T;
  private bag: Kind[] = [];
  private rng: Rng;
  private junkRng: Rng;
  over = false;
  lines = 0; score = 0; pieces = 0; slams = 0; best = 0;
  /** Seconds per row (set by the game: pieces fall slowly enough to throw at). */
  gravity = 0.85;
  private fall = 0;
  private lockT = 0;
  private lockResets = 0;
  clearing: number[] = [];
  clearT = 0;
  private spawnT = 0;
  pendingJunk = 0;
  static readonly LockDelay = 0.55;
  static readonly ClearDelay = 0.42;
  static readonly SpawnDelay = 0.25;

  onLock: ((cells: [number, number][], kind: Kind) => void) | null = null;
  onClear: ((r: ClearReport) => void) | null = null;
  onSpawn: (() => void) | null = null;
  onJunk: ((rows: number) => void) | null = null;
  onOver: (() => void) | null = null;

  constructor(seed: number) { this.rng = new Rng(seed); this.junkRng = new Rng(seed ^ 0x9e3779b9); }

  reset(seed: number) {
    this.rng = new Rng(seed);
    this.junkRng = new Rng(seed ^ 0x9e3779b9);
    this.grid.fill(0);
    this.bag = [];
    this.over = false;
    this.lines = this.score = this.pieces = this.slams = this.best = 0;
    this.clearing = [];
    this.pendingJunk = 0;
    this.fall = this.lockT = this.lockResets = 0;
    this.next = this.draw();
    this.spawnT = 0;
    this.spawn();
  }

  private draw(): Kind {
    if (this.bag.length === 0) {
      const b = [1, 2, 3, 4, 5, 6, 7] as Kind[];
      for (let i = b.length - 1; i > 0; i--) { const j = this.rng.int(i + 1); [b[i], b[j]] = [b[j], b[i]]; }
      this.bag = b;
    }
    return this.bag.shift()!;
  }

  get(x: number, y: number) { return x < 0 || x >= W || y < 0 ? 8 : y >= HT ? 0 : this.grid[y * W + x]; }

  static cells(p: Piece): [number, number][] { return SHAPES[p.kind][p.rot].map(([dx, dy]) => [p.x + dx, p.y + dy] as [number, number]); }

  fits(p: Piece) {
    for (const [dx, dy] of SHAPES[p.kind][p.rot]) if (this.get(p.x + dx, p.y + dy) !== 0) return false;
    return true;
  }

  static spawnPiece(kind: Kind): Piece { return { kind, rot: 0, x: Math.floor((W - BoxSize(kind)) / 2), y: H - 1 + (kind === Kind.I ? 1 : 0) }; }

  private spawn() {
    if (this.pendingJunk > 0) { const n = this.pendingJunk; this.pendingJunk = 0; this.addJunk(n); if (this.over) return; }
    const p = Well.spawnPiece(this.next);
    this.next = this.draw();
    if (!this.fits(p)) { this.active = p; this.setOver(); return; }
    this.active = p;
    this.fall = 0;
    this.lockT = 0;
    this.lockResets = 0;
    this.onSpawn?.();
  }

  private setOver() { if (this.over) return; this.over = true; this.onOver?.(); }

  get busy() { return this.over || !this.active || this.clearing.length > 0 || this.spawnT > 0; }

  tick(dt: number) {
    if (this.over) return;
    if (this.clearing.length > 0) {
      this.clearT -= dt;
      if (this.clearT <= 0) this.finishClear();
      return;
    }
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawnT = 0; this.spawn(); }
      return;
    }
    const p = this.active;
    if (!p) return;
    if (this.canMove(0, -1)) {
      this.lockT = 0;
      this.fall += dt;
      while (this.fall >= this.gravity) {
        this.fall -= this.gravity;
        if (!this.step(0, -1)) { this.fall = 0; break; }
      }
    } else {
      this.lockT += dt;
      if (this.lockT >= Well.LockDelay) this.lock();
    }
  }

  canMove(dx: number, dy: number) { const p = this.active; return !!p && this.fits({ ...p, x: p.x + dx, y: p.y + dy }); }

  private step(dx: number, dy: number) {
    const p = this.active!;
    const n = { ...p, x: p.x + dx, y: p.y + dy };
    if (!this.fits(n)) return false;
    this.active = n;
    return true;
  }

  private touched() { if (this.lockT > 0 && this.lockResets < 6) { this.lockT = 0; this.lockResets++; } }

  /** One column left (-1) or right (+1). */
  nudge(dx: number) {
    if (this.busy) return false;
    if (!this.step(dx, 0)) return false;
    this.touched();
    return true;
  }

  /** Clockwise rotation with small kicks. */
  rotate() {
    if (this.busy) return false;
    const p = this.active!;
    if (p.kind === Kind.O) return true;
    const to = (p.rot + 1) % 4;
    for (const [kx, ky] of Kicks) {
      const n = { ...p, rot: to, x: p.x + kx, y: p.y + ky };
      if (this.fits(n)) { this.active = n; this.touched(); return true; }
    }
    return false;
  }

  /** Drops the piece to the floor and locks it. Returns rows dropped (-1 when busy). */
  slam() {
    if (this.busy) return -1;
    let n = 0;
    while (this.canMove(0, -1)) { this.active = { ...this.active!, y: this.active!.y - 1 }; n++; }
    this.slams++;
    this.score += n * 2;
    this.lock();
    return n;
  }

  ghostY() {
    const p = this.active;
    if (!p) return 0;
    let y = p.y;
    while (this.fits({ ...p, y: y - 1 })) y--;
    return y;
  }

  private lock() {
    const p = this.active!;
    const cells = Well.cells(p);
    let above = false;
    for (const [x, y] of cells) {
      if (y >= 0 && y < HT) this.grid[y * W + x] = p.kind;
      if (y >= H) above = true;
    }
    this.active = null;
    this.pieces++;
    this.onLock?.(cells, p.kind);
    const rows: number[] = [];
    for (let y = 0; y < HT; y++) {
      let full = true;
      for (let x = 0; x < W; x++) if (this.grid[y * W + x] === 0) { full = false; break; }
      if (full) rows.push(y);
    }
    if (rows.length > 0) {
      const n = Math.min(4, rows.length);
      this.clearing = rows;
      this.clearT = Well.ClearDelay;
      const points = LinePoints[n];
      this.score += points;
      this.best = Math.max(this.best, n);
      this.onClear?.({ lines: rows.length, rows, points, junk: JunkFor[n] });
      return;
    }
    if (above) { this.setOver(); return; }
    this.spawnT = Well.SpawnDelay;
  }

  private finishClear() {
    const rows = this.clearing;
    const keep: Uint8Array[] = [];
    for (let y = 0; y < HT; y++) if (!rows.includes(y)) keep.push(this.grid.slice(y * W, y * W + W));
    this.grid.fill(0);
    keep.forEach((row, y) => this.grid.set(row, y * W));
    this.lines += rows.length;
    this.clearing = [];
    // a clear can leave cells above the well (rotated in the buffer): those top out
    for (let x = 0; x < W; x++) for (let y = H; y < HT; y++) if (this.grid[y * W + x] !== 0) { this.setOver(); return; }
    this.spawnT = Well.SpawnDelay;
  }

  /** Junk from the rival arrives with this player's next piece. */
  receive(rows: number) { if (rows > 0) this.pendingJunk += rows; }

  /** Pushes n junk rows (one hole each) up from the bottom. */
  addJunk(n: number) {
    for (let y = HT - 1; y >= n; y--) for (let x = 0; x < W; x++) this.grid[y * W + x] = this.grid[(y - n) * W + x];
    for (let y = 0; y < n; y++) {
      const hole = this.junkRng.int(W);
      for (let x = 0; x < W; x++) this.grid[y * W + x] = x === hole ? 0 : Kind.Junk;
    }
    if (this.active) while (!this.fits(this.active) && this.active.y < HT) this.active = { ...this.active, y: this.active.y + 1 };
    this.onJunk?.(n);
    for (let x = 0; x < W; x++) for (let y = H; y < HT; y++) if (this.grid[y * W + x] !== 0) { this.setOver(); return; }
  }

  stackHeight() {
    for (let y = HT - 1; y >= 0; y--) for (let x = 0; x < W; x++) if (this.grid[y * W + x] !== 0) return y + 1;
    return 0;
  }
}

// ------------------------------------------------------------------ hit zones

export enum HitAction { Miss, Left, Right, Rotate, Slam }

/**
 * What a ball does at well position (fx, fy) in cell units (column / row floats, 0,0 = bottom-left corner):
 * beside or on the side half of the piece = nudge it one column AWAY from the hit, on top = rotate, the empty well
 * under it = slam down.
 */
export function classify(p: Piece, fx: number, fy: number): HitAction {
  const cells = Well.cells(p);
  let c0 = 99, c1 = -99, r0 = 99, r1 = -99;
  for (const [x, y] of cells) { c0 = Math.min(c0, x); c1 = Math.max(c1, x); r0 = Math.min(r0, y); r1 = Math.max(r1, y); }
  const left = c0, right = c1 + 1, bottom = r0, top = r1 + 1, mid = (left + right) / 2;
  if (fx < -1.2 || fx > W + 1.2) return HitAction.Miss;
  // beside the piece
  if ((fx < left && fx >= left - 2.4) || (fx > right && fx <= right + 2.4)) {
    if (fy >= bottom - 0.8 && fy <= top + 1.2) return fx < mid ? HitAction.Right : HitAction.Left;
    return fy < bottom - 0.8 && fy >= -0.6 && (fx >= left - 0.7 && fx <= right + 0.7) ? HitAction.Slam : HitAction.Miss;
  }
  if (fx < left || fx > right) return HitAction.Miss;
  if (fy >= top - 0.45 && fy <= top + 4) return HitAction.Rotate;
  if (fy >= bottom - 0.5 && fy < top - 0.45) return fx < mid ? HitAction.Right : HitAction.Left;
  if (fy < bottom - 0.5 && fy >= -0.8) return HitAction.Slam;
  return HitAction.Miss;
}

/** Where to throw for an action (cell units), the inverse of classify. */
export function aimFor(p: Piece, a: HitAction): [number, number] {
  const cells = Well.cells(p);
  let c0 = 99, c1 = -99, r0 = 99, r1 = -99;
  for (const [x, y] of cells) { c0 = Math.min(c0, x); c1 = Math.max(c1, x); r0 = Math.min(r0, y); r1 = Math.max(r1, y); }
  const midY = (r0 + r1 + 1) / 2, midX = (c0 + c1 + 1) / 2;
  switch (a) {
    case HitAction.Right: return [c0 - 0.9, midY];
    case HitAction.Left: return [c1 + 1.9, midY];
    case HitAction.Rotate: return [midX, r1 + 1.6];
    case HitAction.Slam: return [midX, Math.max(0.3, r0 - 2.2)];
    default: return [midX, midY];
  }
}
