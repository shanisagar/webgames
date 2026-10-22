import { Grid2D, Mathf, SysRandom, V2, V2i } from "../../kit";

/** UnityEngine.RectInt (kit gap: the kit has no integer rect). */
export class RectInt {
  constructor(readonly x: number, readonly y: number, readonly width: number, readonly height: number) {}
  get xMin() { return this.x; }
  get yMin() { return this.y; }
  get xMax() { return this.x + this.width; }
  get yMax() { return this.y + this.height; }
  get center() { return new V2(this.x + this.width / 2, this.y + this.height / 2); }
}

/** Vector2Int.RoundToInt (kit gap). */
const roundToInt = (v: V2) => new V2i(Mathf.roundToInt(v.x), Mathf.roundToInt(v.y));

/**
 * Procedural facility: non-overlapping rooms joined by a minimum spanning tree of two-wide corridors (plus a
 * couple of extra loops so there is always more than one way around a guard), pillars for cover, and
 * objectives placed by path distance so the exit is far from the start.
 */
export class Facility {
  Grid!: Grid2D;
  readonly Rooms: RectInt[] = [];
  Start = V2i.zero;
  Exit = V2i.zero;
  readonly Shards: V2i[] = [];
  readonly Patrols: V2i[][] = [];
  readonly Cameras: { cell: V2i; facing: V2 }[] = [];

  static Generate(level: number, seed: number) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const f = new Facility();
      if (f.TryBuild(level, new SysRandom(seed + attempt * 977))) return f;
    }
    const fallback = new Facility();
    fallback.TryBuild(0, new SysRandom(1));
    return fallback;
  }

  private TryBuild(level: number, rng: SysRandom) {
    const w = Math.min(30 + level * 2, 46), h = Math.min(22 + level * 2, 38);
    this.Grid = new Grid2D(w, h, new V2(-w * 0.5, -h * 0.5));
    for (let i = 0; i < this.Grid.Solid.length; i++) this.Grid.Solid[i] = true;
    const Rooms = this.Rooms, Grid = this.Grid;

    const target = Math.min(7 + level, 13);
    for (let attempt = 0; attempt < 200 && Rooms.length < target; attempt++) {
      const rw = rng.next(4, 9), rh = rng.next(4, 8);
      const r = new RectInt(rng.next(1, w - rw - 1), rng.next(1, h - rh - 1), rw, rh);
      let overlaps = false;
      for (const o of Rooms)
        if (r.xMin - 2 < o.xMax && r.xMax + 2 > o.xMin && r.yMin - 2 < o.yMax && r.yMax + 2 > o.yMin) { overlaps = true; break; }
      if (!overlaps) Rooms.push(r);
    }
    if (Rooms.length < 5) return false;
    for (const r of Rooms) this.Carve(r);

    // Minimum spanning tree over room centres (Prim), then a couple of extra loops.
    const connected = [0];
    const edges: [number, number][] = [];
    while (connected.length < Rooms.length) {
      let best = Number.MAX_VALUE;
      let bi = -1, bj = -1;
      for (const i of connected)
        for (let j = 0; j < Rooms.length; j++) {
          if (connected.includes(j)) continue;
          const d = Rooms[i].center.sub(Rooms[j].center).sqrMagnitude;
          if (d < best) { best = d; bi = i; bj = j; }
        }
      connected.push(bj);
      edges.push([bi, bj]);
    }
    for (let k = 0; k < 2; k++) edges.push([rng.next(Rooms.length), rng.next(Rooms.length)]);
    for (const [a, b] of edges) if (a !== b) this.Corridor(Facility.Center(Rooms[a]), Facility.Center(Rooms[b]), rng.next(2) === 0);

    // Cover pillars inside larger rooms.
    for (const r of Rooms) {
      if (r.width * r.height < 30) continue;
      const count = rng.next(1, 3);
      for (let k = 0; k < count; k++) {
        const x = rng.next(r.xMin + 2, r.xMax - 2), y = rng.next(r.yMin + 2, r.yMax - 2);
        const c = Facility.Center(r);
        // Keep the centre and the two-wide corridor lines through it clear.
        if (x === c.x || x === c.x + 1 || y === c.y || y === c.y + 1) continue;
        Grid.setSolid(x, y, true);
      }
    }

    // Objectives by path distance from the start room.
    this.Start = Facility.Center(Rooms[0]);
    if (Grid.isSolid(this.Start)) Grid.setSolid(this.Start.x, this.Start.y, false);
    const dist: number[] = new Array(w * h).fill(0);
    Grid.flowField(this.Start, dist);
    const order: number[] = [];
    for (let i = 1; i < Rooms.length; i++) {
      const c = Facility.Center(Rooms[i]);
      if (Grid.isSolid(c) || dist[Grid.index(c.x, c.y)] === Number.MAX_VALUE) return false;
      order.push(i);
    }
    order.sort((a, b) => this.Dist(dist, Rooms[b]) - this.Dist(dist, Rooms[a]));
    this.Exit = Facility.Center(Rooms[order[0]]);
    for (let i = 1; i < order.length && this.Shards.length < 3; i++) {
      const r = Rooms[order[i]];
      let c = new V2i(rng.next(r.xMin + 1, r.xMax - 1), rng.next(r.yMin + 1, r.yMax - 1));
      if (Grid.isSolid(c)) c = Facility.Center(r);
      if (!Grid.isSolid(c)) this.Shards.push(c);
    }
    if (this.Shards.length < 3) return false;

    // Patrol loops through 2-4 rooms (never the start room).
    const guards = Math.min(2 + level, 10);
    for (let g = 0; g < guards; g++) {
      const route: V2i[] = [];
      const stops = rng.next(2, 5);
      for (let s = 0; s < stops; s++) {
        const r = Rooms[1 + rng.next(Rooms.length - 1)];
        const c = new V2i(rng.next(r.xMin + 1, r.xMax - 1), rng.next(r.yMin + 1, r.yMax - 1));
        if (!Grid.isSolid(c)) route.push(c);
      }
      if (route.length >= 2) this.Patrols.push(route);
    }

    // Wall-mounted cameras looking into rooms.
    const cams = Math.min(Math.trunc(level / 2), 4);
    for (let attempt = 0; attempt < 60 && this.Cameras.length < cams; attempt++) {
      const r = Rooms[1 + rng.next(Rooms.length - 1)];
      const side = rng.next(4);
      let cell: V2i;
      let facing: V2;
      switch (side) {
        case 0: cell = new V2i(r.xMin - 1, rng.next(r.yMin, r.yMax)); facing = V2.right; break;
        case 1: cell = new V2i(r.xMax, rng.next(r.yMin, r.yMax)); facing = V2.left; break;
        case 2: cell = new V2i(rng.next(r.xMin, r.xMax), r.yMin - 1); facing = V2.up; break;
        default: cell = new V2i(rng.next(r.xMin, r.xMax), r.yMax); facing = V2.down; break;
      }
      if (!Grid.isSolid(cell) || Grid.isSolid(cell.add(roundToInt(facing)))) continue;
      this.Cameras.push({ cell, facing });
    }
    return true;
  }

  private Dist(dist: number[], r: RectInt) {
    const c = Facility.Center(r);
    return dist[this.Grid.index(c.x, c.y)];
  }

  static Center(r: RectInt) { return new V2i(r.xMin + Math.trunc(r.width / 2), r.yMin + Math.trunc(r.height / 2)); }

  private Carve(r: RectInt) {
    for (let y = r.yMin; y < r.yMax; y++)
      for (let x = r.xMin; x < r.xMax; x++) this.Grid.setSolid(x, y, false);
  }

  private Corridor(a: V2i, b: V2i, horizontalFirst: boolean) {
    const corner = horizontalFirst ? new V2i(b.x, a.y) : new V2i(a.x, b.y);
    this.Line(a, corner);
    this.Line(corner, b);
  }

  private Line(a: V2i, b: V2i) {
    let x = a.x, y = a.y;
    for (;;) {
      this.Grid.setSolid(x, y, false);
      this.Grid.setSolid(x + 1, y, false);
      this.Grid.setSolid(x, y + 1, false);
      if (x === b.x && y === b.y) break;
      if (x !== b.x) x += b.x > x ? 1 : -1;
      else y += b.y > y ? 1 : -1;
    }
  }
}
