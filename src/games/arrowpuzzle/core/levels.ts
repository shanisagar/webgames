import { Dir, LevelData } from "./level";
import { generateBest, GeneratorSettings } from "./generator";
import { ShapeType, areaCompensation } from "./shapeMask";
import authored from "./levels.json";

/** Compact JSON exported from the Unity LevelDatabase.asset: each arrow is [dir, ...cells tail → head]. */
interface StoredLevel {
  w: number; h: number; shape: number; seed: number; mask: string; depth: number; difficulty: number;
  arrows: number[][];
}

const SHAPE_CYCLE: ShapeType[] = [
  ShapeType.Rectangle, ShapeType.Circle, ShapeType.Rectangle, ShapeType.Diamond,
  ShapeType.Hexagon, ShapeType.Rectangle, ShapeType.Cross, ShapeType.Blob,
  ShapeType.Rectangle, ShapeType.Ring, ShapeType.Star, ShapeType.Triangle,
];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Maps a 1-based level number to generator settings for endless levels after the authored ones. */
export function settingsFor(level: number): GeneratorSettings {
  level = Math.max(1, level);
  // Board size ramps quickly at first, then slowly.
  const size = level <= 8 ? 5 + Math.floor((level - 1) / 2) : Math.min(9 + Math.floor((level - 8) / 4), 24);
  const shape = level < 4 ? ShapeType.Rectangle : level % 10 === 0 ? ShapeType.Heart : SHAPE_CYCLE[(level * 5) % SHAPE_CYCLE.length];
  const scale = areaCompensation(shape);
  return {
    shape,
    width: Math.round(size * scale),
    height: Math.round(size * 1.3 * scale),
    minLength: 2,
    maxLength: clamp(3 + Math.floor(level / 8), 3, 9),
    turnChance: clamp(0.3 + level * 0.01, 0.3, 0.65),
    fill: level <= 2 ? 0.8 : clamp(0.9 + level * 0.004, 0.9, 1),
    extendTails: level > 1,
    chainBias: clamp(0.45 + level * 0.015, 0.45, 0.95),
  };
}

const seedFor = (level: number) => (level * 7919 + 1013) | 0;
const minDepthFor = (level: number) => clamp(2 + Math.floor(level / 2), 2, 30);
const minArrowsFor = (level: number) => clamp(5 + level * 2, 5, 160);

export const AUTHORED_COUNT = (authored as StoredLevel[]).length;

/** Returns a fresh copy of the authored level, or a deterministic procedural one past the authored set. */
export function getLevel(levelNumber: number): LevelData {
  levelNumber = Math.max(1, levelNumber);
  const stored = (authored as StoredLevel[])[levelNumber - 1];
  if (stored && stored.arrows.length > 0) {
    return {
      width: stored.w, height: stored.h, shape: stored.shape, seed: stored.seed, mask: stored.mask,
      depth: stored.depth, difficulty: stored.difficulty,
      arrows: stored.arrows.map(([dir, ...cells]) => ({ dir: dir as Dir, cells })),
    };
  }
  return generateBest(settingsFor(levelNumber), seedFor(levelNumber), minDepthFor(levelNumber), minArrowsFor(levelNumber), 6);
}
