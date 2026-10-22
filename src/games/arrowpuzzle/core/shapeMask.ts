import { Rng } from "./rng";

export const enum ShapeType { Rectangle, Circle, Heart, Diamond, Hexagon, Cross, Ring, Star, Triangle, Blob, Random }

const SHAPE_COUNT = ShapeType.Random;

export function resolveShape(shape: ShapeType, seed: number): ShapeType {
  if (shape !== ShapeType.Random) return shape;
  return new Rng(seed ^ 0x5f3759df).next(0, SHAPE_COUNT) as ShapeType;
}

/** Builds the active-cell mask for a board silhouette. */
export function buildMask(shape: ShapeType, width: number, height: number, seed: number): boolean[] {
  shape = resolveShape(shape, seed);
  const rng = new Rng(seed);
  const p1 = rng.nextDouble() * Math.PI * 2;
  const p2 = rng.nextDouble() * Math.PI * 2;

  const mask: boolean[] = new Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // Normalized cell-center coordinates in [-1, 1].
      const u = ((x + 0.5) / width) * 2 - 1;
      const v = ((y + 0.5) / height) * 2 - 1;
      mask[y * width + x] = inside(shape, u, v, p1, p2);
    }

  // Guarantee a usable board even with odd sizes.
  if (mask.filter(Boolean).length < 4) mask.fill(true);
  return mask;
}

function inside(shape: ShapeType, u: number, v: number, p1: number, p2: number): boolean {
  const r = Math.sqrt(u * u + v * v);
  const a = Math.atan2(v, u);
  switch (shape) {
    case ShapeType.Rectangle: return true;
    case ShapeType.Circle: return r <= 1.04;
    case ShapeType.Diamond: return Math.abs(u) + Math.abs(v) <= 1.08;
    case ShapeType.Cross: return Math.abs(u) < 0.4 || Math.abs(v) < 0.4;
    case ShapeType.Ring: return r <= 1.04 && r >= 0.42;
    case ShapeType.Hexagon: return Math.abs(u) <= 0.92 && Math.abs(v) + 0.55 * Math.abs(u) <= 1.05;
    case ShapeType.Triangle: return Math.abs(u) <= (1.05 - v) * 0.5 + 0.02;
    case ShapeType.Star: return r <= 0.66 + 0.38 * Math.cos(5 * (a - Math.PI * 0.5));
    case ShapeType.Blob: return r <= 0.8 + 0.13 * Math.sin(3 * a + p1) + 0.08 * Math.sin(5 * a + p2);
    case ShapeType.Heart: {
      // Classic implicit heart: (x²+y²-1)³ - x²y³ <= 0.
      const hx = u * 1.16, hy = v * 1.16 + 0.14;
      const s = hx * hx + hy * hy - 1;
      return s * s * s - hx * hx * hy * hy * hy <= 0;
    }
    default: return true;
  }
}

/** Shapes lose area, so scale their grids up to keep a similar arrow count. */
export function areaCompensation(shape: ShapeType): number {
  switch (shape) {
    case ShapeType.Rectangle: return 1;
    case ShapeType.Cross: return 1.35;
    case ShapeType.Ring: return 1.3;
    case ShapeType.Diamond:
    case ShapeType.Triangle:
    case ShapeType.Star: return 1.35;
    default: return 1.15;
  }
}
