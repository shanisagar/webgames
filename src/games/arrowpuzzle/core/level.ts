/** Cardinal direction an arrow points in (grid y grows upward, like the Unity version). */
export const enum Dir { Up = 0, Right = 1, Down = 2, Left = 3 }

const VX = [0, 1, 0, -1];
const VY = [1, 0, -1, 0];

export const dirX = (d: Dir) => VX[d];
export const dirY = (d: Dir) => VY[d];
export const opposite = (d: Dir): Dir => ((d + 2) & 3) as Dir;
export const clockwise = (d: Dir): Dir => ((d + 1) & 3) as Dir;
export const counterClockwise = (d: Dir): Dir => ((d + 3) & 3) as Dir;

export function dirFromDelta(dx: number, dy: number): Dir | -1 {
  for (let i = 0; i < 4; i++) if (VX[i] === dx && VY[i] === dy) return i as Dir;
  return -1;
}

export const enum Difficulty { Easy = 0, Normal = 1, Hard = 2, Expert = 3 }
export const DIFFICULTY_NAMES = ["EASY", "NORMAL", "HARD", "EXPERT"];

/** One arrow. `cells` are grid indices (y * width + x) ordered tail → head; it exits along `dir`. */
export interface ArrowData {
  cells: number[];
  dir: Dir;
}

export interface LevelData {
  width: number;
  height: number;
  shape: number;
  seed: number;
  /** Row-major string of '1'/'0'. Empty means every cell is active. */
  mask: string;
  arrows: ArrowData[];
  depth: number;
  difficulty: Difficulty;
}

export const head = (a: ArrowData) => a.cells[a.cells.length - 1];
export const cellCount = (l: LevelData) => l.width * l.height;
export const cellX = (l: LevelData, i: number) => i % l.width;
export const cellY = (l: LevelData, i: number) => Math.floor(i / l.width);
export const inBounds = (l: LevelData, x: number, y: number) => x >= 0 && y >= 0 && x < l.width && y < l.height;

export function isActive(l: LevelData, index: number): boolean {
  if (!l.mask || l.mask.length !== cellCount(l)) return true;
  return l.mask.charCodeAt(index) === 49; // '1'
}

export function occupiedCellCount(l: LevelData): number {
  let n = 0;
  for (const a of l.arrows) n += a.cells.length;
  return n;
}

export function encodeMask(mask: boolean[]): string {
  return mask.every(Boolean) ? "" : mask.map((b) => (b ? "1" : "0")).join("");
}

export function cloneLevel(l: LevelData): LevelData {
  return { ...l, arrows: l.arrows.map((a) => ({ cells: a.cells.slice(), dir: a.dir })) };
}
