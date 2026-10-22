import { Color, V2, V2i, V3 } from "./math";
import { Mesh } from "./render";

const DIRS8 = [new V2i(1, 0), new V2i(-1, 0), new V2i(0, 1), new V2i(0, -1), new V2i(1, 1), new V2i(1, -1), new V2i(-1, 1), new V2i(-1, -1)];

/** Grid world helpers (Grid2D.cs): solid cells, DDA ray casts, circle collision, A*, flow fields, reachability, meshes. */
export class Grid2D {
  static readonly Dirs4 = [new V2i(1, 0), new V2i(-1, 0), new V2i(0, 1), new V2i(0, -1)];
  readonly W: number;
  readonly H: number;
  readonly Solid: boolean[];
  /** World position of cell (0,0)'s lower-left corner. */
  Origin: V2;
  readonly Cell: number;
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Int32Array;
  private heap: Int32Array;
  private heapKey: Float32Array;
  private heapCount = 0;
  private search = 0;

  constructor(w: number, h: number, origin: V2, cell = 1) {
    this.W = w; this.H = h; this.Origin = origin; this.Cell = cell;
    this.Solid = new Array(w * h).fill(false);
    this.g = new Float32Array(w * h);
    this.parent = new Int32Array(w * h);
    this.stamp = new Int32Array(w * h);
    this.heap = new Int32Array(w * h * 8 + 8);
    this.heapKey = new Float32Array(w * h * 8 + 8);
  }

  index(x: number, y: number) { return y * this.W + x; }
  inBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  isSolid(x: number | V2i, y?: number): boolean {
    if (x instanceof V2i) return this.isSolid(x.x, x.y);
    return !this.inBounds(x, y!) || this.Solid[y! * this.W + x];
  }
  setSolid(x: number, y: number, solid: boolean) { if (this.inBounds(x, y)) this.Solid[y * this.W + x] = solid; }
  toCell(world: V2) { const p = world.sub(this.Origin).div(this.Cell); return new V2i(Math.floor(p.x), Math.floor(p.y)); }
  toWorld(x: number | V2i, y?: number): V2 {
    if (x instanceof V2i) return this.toWorld(x.x, x.y);
    return this.Origin.add(new V2((x + 0.5) * this.Cell, (y! + 0.5) * this.Cell));
  }

  raycast(origin: V2, dir: V2, max: number) {
    const p = origin.sub(this.Origin).div(this.Cell);
    const maxCells = max / this.Cell;
    let x = Math.floor(p.x), y = Math.floor(p.y);
    if (this.isSolid(x, y)) return 0;
    const sx = dir.x > 0 ? 1 : -1, sy = dir.y > 0 ? 1 : -1;
    const tdx = Math.abs(dir.x) > 1e-6 ? Math.abs(1 / dir.x) : Infinity;
    const tdy = Math.abs(dir.y) > 1e-6 ? Math.abs(1 / dir.y) : Infinity;
    let tmx = !isFinite(tdx) ? Infinity : (dir.x > 0 ? x + 1 - p.x : p.x - x) * tdx;
    let tmy = !isFinite(tdy) ? Infinity : (dir.y > 0 ? y + 1 - p.y : p.y - y) * tdy;
    for (let guard = 0; guard < 4096; guard++) {
      let t: number;
      if (tmx < tmy) { t = tmx; tmx += tdx; x += sx; } else { t = tmy; tmy += tdy; y += sy; }
      if (t > maxCells) break;
      if (this.isSolid(x, y)) return t * this.Cell;
    }
    return max;
  }

  lineOfSight(a: V2, b: V2) {
    const d = b.sub(a), dist = d.magnitude;
    if (dist < 1e-4) return true;
    return this.raycast(a, d.div(dist), dist) >= dist - 1e-3;
  }

  resolveCircle(pos: V2, radius: number) {
    for (let iter = 0; iter < 2; iter++) {
      const c = this.toCell(pos), reach = Math.ceil(radius / this.Cell) + 1;
      for (let y = c.y - reach; y <= c.y + reach; y++)
        for (let x = c.x - reach; x <= c.x + reach; x++) {
          if (!this.isSolid(x, y)) continue;
          const min = this.Origin.add(new V2(x * this.Cell, y * this.Cell)), max = min.add(new V2(this.Cell, this.Cell));
          const closest = new V2(Math.min(Math.max(pos.x, min.x), max.x), Math.min(Math.max(pos.y, min.y), max.y));
          let d = pos.sub(closest);
          const m = d.magnitude;
          if (m >= radius) continue;
          if (m < 1e-5) {
            const center = min.add(max).mul(0.5), off = pos.sub(center);
            d = Math.abs(off.x) > Math.abs(off.y) ? new V2(Math.sign(off.x) || 1, 0) : new V2(0, Math.sign(off.y) || 1);
            pos = center.add(d.mul(this.Cell * 0.5 + radius));
          } else pos = pos.add(d.div(m).mul(radius - m));
        }
    }
    return pos;
  }

  /** A* with diagonal moves and no corner cutting. Fills `path` (from → to); false if unreachable. */
  findPath(from: V2i, to: V2i, path: V2i[], maxExpansions = 20000) {
    path.length = 0;
    if (this.isSolid(from) || this.isSolid(to)) return false;
    if (from.equals(to)) { path.push(to); return true; }
    this.search++;
    this.heapCount = 0;
    const start = this.index(from.x, from.y), goal = this.index(to.x, to.y);
    this.g[start] = 0;
    this.parent[start] = -1;
    this.stamp[start] = this.search;
    this.push(start, Grid2D.heuristic(from.x, from.y, to));
    let expansions = 0;
    while (this.heapCount > 0 && expansions++ < maxExpansions) {
      const cur = this.pop();
      if (cur === goal) {
        for (let n = goal; n >= 0; n = this.parent[n]) path.push(new V2i(n % this.W, Math.floor(n / this.W)));
        path.reverse();
        return true;
      }
      const cx = cur % this.W, cy = Math.floor(cur / this.W);
      for (let i = 0; i < 8; i++) {
        const d = DIRS8[i], nx = cx + d.x, ny = cy + d.y;
        if (this.isSolid(nx, ny)) continue;
        if (i >= 4 && (this.isSolid(cx + d.x, cy) || this.isSolid(cx, cy + d.y))) continue;
        const ni = this.index(nx, ny), cost = this.g[cur] + (i >= 4 ? 1.4142 : 1);
        if (this.stamp[ni] === this.search && cost >= this.g[ni]) continue;
        this.stamp[ni] = this.search;
        this.g[ni] = cost;
        this.parent[ni] = cur;
        this.push(ni, cost + Grid2D.heuristic(nx, ny, to));
      }
    }
    return false;
  }

  private static heuristic(ax: number, ay: number, b: V2i) {
    const dx = Math.abs(ax - b.x), dy = Math.abs(ay - b.y);
    return dx + dy + (1.4142 - 2) * Math.min(dx, dy);
  }

  private push(node: number, key: number) {
    if (this.heapCount >= this.heap.length) return;
    let i = this.heapCount++;
    this.heap[i] = node;
    this.heapKey[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heapKey[p] <= this.heapKey[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  private pop() {
    const top = this.heap[0];
    this.heapCount--;
    this.heap[0] = this.heap[this.heapCount];
    this.heapKey[0] = this.heapKey[this.heapCount];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < this.heapCount && this.heapKey[l] < this.heapKey[m]) m = l;
      if (r < this.heapCount && this.heapKey[r] < this.heapKey[m]) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.heap[a], this.heap[b]] = [this.heap[b], this.heap[a]];
    [this.heapKey[a], this.heapKey[b]] = [this.heapKey[b], this.heapKey[a]];
  }

  /** Dijkstra distances to `target` over 4-neighbours (with optional extra cost per cell). */
  flowField(target: V2i, dist: Float32Array | number[], extraCost: ArrayLike<number> | null = null, blocked: ((x: number, y: number) => boolean) | null = null) {
    for (let i = 0; i < dist.length; i++) dist[i] = Number.MAX_VALUE;
    if (!this.inBounds(target.x, target.y)) return;
    this.search++;
    this.heapCount = 0;
    const t = this.index(target.x, target.y);
    dist[t] = 0;
    this.push(t, 0);
    while (this.heapCount > 0) {
      const key = this.heapKey[0], cur = this.pop();
      if (key > dist[cur]) continue;
      const cx = cur % this.W, cy = Math.floor(cur / this.W);
      for (const d of Grid2D.Dirs4) {
        const nx = cx + d.x, ny = cy + d.y;
        if (this.isSolid(nx, ny) || (blocked && blocked(nx, ny))) continue;
        const ni = this.index(nx, ny), cost = dist[cur] + 1 + (extraCost ? extraCost[ni] : 0);
        if (cost >= dist[ni]) continue;
        dist[ni] = cost;
        this.push(ni, cost);
      }
    }
  }

  reachable(from: V2i, to: V2i, blocked: ((x: number, y: number) => boolean) | null = null) {
    if (this.isSolid(from) || this.isSolid(to)) return false;
    this.search++;
    const queue: number[] = [];
    const s = this.index(from.x, from.y), goal = this.index(to.x, to.y);
    this.stamp[s] = this.search;
    queue.push(s);
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      if (cur === goal) return true;
      const cx = cur % this.W, cy = Math.floor(cur / this.W);
      for (const d of Grid2D.Dirs4) {
        const nx = cx + d.x, ny = cy + d.y;
        if (this.isSolid(nx, ny) || (blocked && blocked(nx, ny))) continue;
        const ni = this.index(nx, ny);
        if (this.stamp[ni] === this.search) continue;
        this.stamp[ni] = this.search;
        queue.push(ni);
      }
    }
    return false;
  }

  /** One quad per cell whose colour has alpha > 0. */
  buildMesh(include: (x: number, y: number) => Color, inset = 0, mesh: Mesh | null = null) {
    const verts: V3[] = [], cols: Color[] = [], tris: number[] = [];
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const c = include(x, y);
        if (c.a <= 0) continue;
        const min = this.Origin.add(new V2(x * this.Cell + inset, y * this.Cell + inset));
        const max = this.Origin.add(new V2((x + 1) * this.Cell - inset, (y + 1) * this.Cell - inset));
        const i = verts.length;
        verts.push(new V3(min.x, min.y), new V3(min.x, max.y), new V3(max.x, max.y), new V3(max.x, min.y));
        cols.push(c, c, c, c);
        tris.push(i, i + 1, i + 2, i, i + 2, i + 3);
      }
    mesh ??= new Mesh();
    mesh.vertices = verts;
    mesh.colors = cols;
    mesh.triangles = tris;
    mesh.markDirty();
    return mesh;
  }
}
