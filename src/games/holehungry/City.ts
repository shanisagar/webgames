import { SysRandom } from "../../kit";
import { BlockType, Kind, KindDef } from "./HoleArt";

/**
 * City layout for Hole Hungry: an N×N grid of blocks separated by roads, the procedural placement of every object
 * in a round, and a spatial hash (intrusive linked lists in typed arrays: no allocations while playing).
 */

export const N = 5, Block = 18, Road = 6, CellSize = Block + Road;
export const CitySize = N * CellSize + Road, Half = CitySize / 2;
/** Inset of the sidewalk centre line from a block's edge. */
export const WalkInset = 0.65;

/** Centre coordinate of road line k (0..N). */
export const roadC = (k: number) => -Half + Road / 2 + k * CellSize;
/** Centre coordinate of block column/row j (0..N-1). */
export const blockC = (j: number) => -Half + Road + Block / 2 + j * CellSize;

export enum Mover { None, Walker, Car }

/** One object to place (the game turns these into pooled sprites). */
export interface Placement {
  kind: Kind; variant: number; x: number; y: number; vertical: boolean; flip: boolean;
  mover: Mover;
  /** Walker: block centre and perimeter position; Car: axis/dir/road. */
  a: number; b: number; c: number;
}

export class CityPlan {
  blocks: BlockType[] = [];
  items: Placement[] = [];
}

/** Lays out a fresh city. */
export function planCity(defs: KindDef[], seed: number): CityPlan {
  const rng = new SysRandom(seed);
  const plan = new CityPlan();
  // block types: downtown in the middle, homes and parks around, a couple of plazas and parking lots
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const centre = Math.max(Math.abs(i - 2), Math.abs(j - 2));
      const r = rng.nextDouble();
      let t: BlockType;
      if (centre === 0) t = BlockType.Plaza;
      else if (centre === 1) t = r < 0.55 ? BlockType.Downtown : r < 0.75 ? BlockType.Parking : r < 0.88 ? BlockType.Plaza : BlockType.Park;
      else t = r < 0.45 ? BlockType.Homes : r < 0.75 ? BlockType.Park : r < 0.88 ? BlockType.Parking : BlockType.Downtown;
      plan.blocks.push(t);
    }

  const boxes: number[] = []; // x0,y0,x1,y1 of everything placed in the current block
  const free = (x: number, y: number, hw: number, hh: number, pad: number) => {
    for (let k = 0; k < boxes.length; k += 4)
      if (x + hw + pad > boxes[k] && x - hw - pad < boxes[k + 2] && y + hh + pad > boxes[k + 1] && y - hh - pad < boxes[k + 3]) return false;
    return true;
  };
  const put = (kind: Kind, x: number, y: number, opts: Partial<Placement> = {}, pad = 0.12, force = false) => {
    const d = defs[kind];
    const vertical = !!opts.vertical;
    const hw = vertical ? d.hh : d.hw, hh = vertical ? d.hw : d.hh;
    if (!force && !free(x, y, hw, hh, pad)) return false;
    boxes.push(x - hw, y - hh, x + hw, y + hh);
    const variants = vertical && d.picsV.length ? d.picsV.length : d.pics.length;
    plan.items.push({
      kind, variant: opts.variant ?? rng.next(variants), x, y, vertical, flip: opts.flip ?? false,
      mover: opts.mover ?? Mover.None, a: opts.a ?? 0, b: opts.b ?? 0, c: opts.c ?? 0,
    });
    return true;
  };
  const scatter = (kind: Kind, count: number, cx: number, cy: number, half: number, pad = 0.15, ok: (x: number, y: number) => boolean = () => true) => {
    let placed = 0;
    for (let t = 0; t < count * 12 && placed < count; t++) {
      const x = cx + (rng.nextDouble() * 2 - 1) * half, y = cy + (rng.nextDouble() * 2 - 1) * half;
      if (ok(x - cx, y - cy) && put(kind, x, y, {}, pad)) placed++;
    }
  };
  const small = [Kind.Hydrant, Kind.Trash, Kind.Mailbox, Kind.Cone, Kind.Trash, Kind.Hydrant];

  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      boxes.length = 0;
      const cx = blockC(i), cy = blockC(j), t = plan.blocks[j * N + i];
      const inner = Block / 2 - 1.3 - 0.2;
      // sidewalk furniture: lamps near the corners, small items between
      const sw = Block / 2 - WalkInset;
      for (let side = 0; side < 4; side++) {
        for (const u of [-6.4, -2.2, 2.2, 6.4]) {
          const corner = Math.abs(u) > 5;
          const x = side < 2 ? cx + u : cx + (side === 2 ? -sw : sw);
          const y = side < 2 ? cy + (side === 0 ? -sw : sw) : cy + u;
          if (corner) { if (rng.nextDouble() < 0.4) put(Kind.Lamp, x, y, {}, 0.05); }
          else if (rng.nextDouble() < 0.45) put(small[rng.next(small.length)], x, y, {}, 0.05);
        }
      }
      // walkers on the sidewalk loop
      const per = 8 * (Block / 2 - WalkInset);
      for (let k = 0; k < 3; k++)
        plan.items.push({ kind: Kind.Person, variant: rng.next(defs[Kind.Person].pics.length), x: cx, y: cy, vertical: false, flip: false,
          mover: Mover.Walker, a: j * N + i, b: rng.nextDouble() * per, c: rng.next(2) === 0 ? 1 : -1 });

      switch (t) {
        case BlockType.Downtown: {
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const r = rng.nextDouble(), x = cx + sx * 3.95, y = cy + sy * 3.75;
            if (r < 0.45) put(Kind.Tower, x, y, {}, 0.1);
            else if (r < 0.85) put(Kind.Shop, x, y, {}, 0.1);
            else { put(Kind.Kiosk, x, y, {}, 0.2); scatter(Kind.Bench, 2, x, y, 2.4); scatter(Kind.Person, 4, x, y, 2.6); }
          }
          scatter(Kind.Person, 6, cx, cy, inner, 0.1);
          scatter(Kind.Cone, 3, cx, cy, inner, 0.1);
          scatter(Kind.Bush, 3, cx, cy, inner, 0.1);
          break;
        }
        case BlockType.Homes: {
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const x = cx + sx * 4.1, y = cy + sy * 3.9;
            put(Kind.House, x, y, {}, 0.1);
            if (sy < 0 && rng.nextDouble() < 0.75) put(Kind.Car, x - 1.4, cy - 6.2, { vertical: true }, 0.02);
            if (sy < 0) put(Kind.Mailbox, x + 1.2, cy - 6.9, {}, 0.02);
          }
          scatter(Kind.Tree, 3, cx, cy, inner, 0.05);
          scatter(Kind.Pine, 2, cx, cy, inner, 0.05);
          scatter(Kind.Bush, 5, cx, cy, inner, 0.05);
          scatter(Kind.Person, 3, cx, cy, inner, 0.1);
          break;
        }
        case BlockType.Park: {
          put(Kind.Fountain, cx, cy, {}, 0.3);
          const onGrass = (x: number, y: number) => {
            const path = Math.min(Math.abs(x - y), Math.abs(x + y)) / Math.SQRT2;
            return path > 1.1 && Math.abs(Math.hypot(x, y) - 3.2) > 1.2;
          };
          scatter(Kind.Tree, 7, cx, cy, inner, 0.1, onGrass);
          scatter(Kind.Pine, 3, cx, cy, inner, 0.1, onGrass);
          scatter(Kind.Bush, 6, cx, cy, inner, 0.05, onGrass);
          for (const [bx, by] of [[0, 3.9], [0, -3.9]]) put(Kind.Bench, cx + bx, cy + by, {}, 0.05);
          for (const [lx, ly] of [[2.3, 2.3], [-2.3, 2.3], [2.3, -2.3], [-2.3, -2.3]]) put(Kind.Lamp, cx + lx, cy + ly, {}, 0.05);
          scatter(Kind.Person, 8, cx, cy, inner, 0.1, (x, y) => !onGrass(x, y));
          break;
        }
        case BlockType.Plaza: {
          put(Kind.Fountain, cx, cy, {}, 0.3);
          for (const [bx, by] of [[0, 4.4], [0, -4.4], [3.1, 4.4], [-3.1, 4.4], [3.1, -4.4], [-3.1, -4.4]]) put(Kind.Bench, cx + bx, cy + by, {}, 0.05);
          for (const [tx, ty] of [[-6.2, -6.2], [6.2, -6.2], [-6.2, 6.2], [6.2, 6.2]]) put(rng.next(3) === 0 ? Kind.Pine : Kind.Tree, cx + tx, cy + ty, {}, 0.05);
          scatter(Kind.Kiosk, 2, cx, cy, inner - 0.8, 0.3);
          scatter(Kind.Lamp, 3, cx, cy, inner, 0.2);
          scatter(Kind.Person, 10, cx, cy, inner, 0.08);
          scatter(Kind.Cone, 2, cx, cy, inner, 0.1);
          break;
        }
        case BlockType.Parking: {
          for (const ry of [4.3, -4.3])
            for (let k = 0; k <= 10; k++)
              if (rng.nextDouble() < 0.72) put(Kind.Car, cx - 7 + k * 1.4, cy + ry, { vertical: true }, 0);
          if (rng.nextDouble() < 0.6) put(Kind.Bus, cx + (rng.nextDouble() * 6 - 3), cy, {}, 0.2);
          scatter(Kind.Cone, 4, cx, cy, inner, 0.1);
          scatter(Kind.Person, 4, cx, cy, inner, 0.1);
          break;
        }
      }
    }

  // traffic: cars and buses on the roads
  for (let n = 0; n < 34; n++) {
    const axis = rng.next(2), road = rng.next(N + 1), dir = rng.next(2) === 0 ? 1 : -1;
    const u = -Half + 4 + rng.nextDouble() * (CitySize - 8);
    const lane = laneOf(axis, road, dir);
    const x = axis === 0 ? u : lane, y = axis === 0 ? lane : u;
    const kind = n < 4 ? Kind.Bus : Kind.Car;
    plan.items.push({ kind, variant: rng.next(defs[kind].pics.length), x, y, vertical: axis === 1, flip: axis === 0 && dir < 0,
      mover: Mover.Car, a: axis, b: road, c: dir });
  }
  return plan;
}

/** Lane centre (the fixed coordinate) for traffic on road `road` along `axis` driving `dir` (right-hand traffic). */
export function laneOf(axis: number, road: number, dir: number) {
  const c = roadC(road);
  return axis === 0 ? c - dir * 1.5 : c + dir * 1.5;
}

/** Walker position along a block's sidewalk loop (perimeter parameter s). Writes into out[0..1]. */
export function walkerPos(block: number, s: number, out: Float64Array) {
  const i = block % N, j = Math.floor(block / N), cx = blockC(i), cy = blockC(j);
  const a = Block / 2 - WalkInset, side = 2 * a, per = 4 * side;
  s = ((s % per) + per) % per;
  if (s < side) { out[0] = cx - a + s; out[1] = cy - a; }
  else if (s < 2 * side) { out[0] = cx + a; out[1] = cy - a + (s - side); }
  else if (s < 3 * side) { out[0] = cx + a - (s - 2 * side); out[1] = cy + a; }
  else { out[0] = cx - a; out[1] = cy + a - (s - 3 * side); }
}

// ------------------------------------------------------------------ spatial hash

/** Uniform grid of intrusive doubly linked lists over the city. */
export class SpatialHash {
  readonly dim: number;
  readonly head: Int32Array;
  next: Int32Array; prev: Int32Array; cellOf: Int32Array;

  constructor(capacity: number, readonly cell = 4, readonly origin = -Half - 8) {
    this.dim = Math.ceil((CitySize + 16) / cell);
    this.head = new Int32Array(this.dim * this.dim).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
    this.prev = new Int32Array(capacity).fill(-1);
    this.cellOf = new Int32Array(capacity).fill(-1);
  }

  ensure(capacity: number) {
    if (capacity <= this.next.length) return;
    const grow = (a: Int32Array) => { const b = new Int32Array(capacity).fill(-1); b.set(a); return b; };
    this.next = grow(this.next); this.prev = grow(this.prev); this.cellOf = grow(this.cellOf);
  }

  coord(v: number) { const c = Math.floor((v - this.origin) / this.cell); return c < 0 ? 0 : c >= this.dim ? this.dim - 1 : c; }
  index(x: number, y: number) { return this.coord(y) * this.dim + this.coord(x); }

  clear() { this.head.fill(-1); this.next.fill(-1); this.prev.fill(-1); this.cellOf.fill(-1); }

  insert(id: number, x: number, y: number) {
    const c = this.index(x, y), h = this.head[c];
    this.cellOf[id] = c;
    this.prev[id] = -1;
    this.next[id] = h;
    if (h >= 0) this.prev[h] = id;
    this.head[c] = id;
  }

  remove(id: number) {
    const c = this.cellOf[id];
    if (c < 0) return;
    const p = this.prev[id], n = this.next[id];
    if (p >= 0) this.next[p] = n; else this.head[c] = n;
    if (n >= 0) this.prev[n] = p;
    this.cellOf[id] = this.prev[id] = this.next[id] = -1;
  }

  move(id: number, x: number, y: number) {
    const c = this.index(x, y);
    if (c === this.cellOf[id]) return;
    this.remove(id);
    this.insert(id, x, y);
  }
}
