/**
 * Maze Muncher simulation: pure game logic (no rendering, no kit imports) so it can be stepped headless.
 * Grid coordinates: x = column (0..W-1, left → right), y = row (0..H-1, top → bottom).
 */

export const W = 19, H = 21;
/** Ghost house: exit tile above the door, door tile, interior row. */
export const ExitX = 9, ExitY = 7, DoorY = 8, HouseY = 9;
export const FruitX = 9, FruitY = 11;

// Left halves (cols 0..8) plus the centre column; mirrored at load. # wall, . dot, o power pellet, ' ' empty path,
// : ghost exit (empty), - door, G house, P hero start. A path on column 0 makes a wrap-around tunnel.
const MazeHalves: string[][] = [
  [
    "##########", "#........#", "#o##.###.#", "#.........", "#.##.#.###", "#....#...#", "####.###.#", "####.#   :", "####.# ##-",
    "    .  #GG", "####.# ###", "####.#    ", "####.# ###", "#........#", "#.##.###.#", "#o.#.....P", "##.#.#.###", "#....#...#",
    "#.######.#", "#.........", "##########",
  ],
  [
    "##########", "#o.......#", "#.###.##.#", "#.........", "###.#.###.", "#...#...#.", "#.#.###.#.", "#.#.##   :", "#...## ##-",
    "###... #GG", "#...## ###", "#.#...    ", "#.#.##.###", "#.........", "#.##.#.##.", "#o.#.#...P", "##.#.#.#.#", "#....#...#",
    "#.##.###.#", "#.........", "##########",
  ],
  [
    "##########", "#........#", "#.##.###.#", "#o#......#", "#.#.##.#.#", "#...#..#..", "###.#.##.#", "###.#    :", "###.## ##-",
    "...... #GG", "###.## ###", "###.#.    ", "###.#.##.#", "#.........", "#.#.##.#.#", "#o#..#.#.P", "#.##.#.###", "#....#...#",
    "#.##.###.#", "#.........", "##########",
  ],
  [
    "##########", "#o...#...#", "#.##.#.#.#", "#.........", "###.#.#.##", "#.....#..#", "#.###.##.#", "#.#      :", "#.#.## ##-",
    " ...## #GG", "###.## ###", "#...#.    ", "#.#.#.###.", "#.#.......", "#.#.#.###.", "#o..#....P", "###.#.#.##", "#.....#..#",
    "#.###.##.#", "#.........", "##########",
  ],
];
export const MazeNames = ["CLASSIC", "ZIGZAG", "CROSSROADS", "TWIN TOWERS"];
export const MazeCount = MazeHalves.length;

export function mazeRows(index: number): string[] {
  return MazeHalves[((index % MazeCount) + MazeCount) % MazeCount].map((h) => {
    const s = h.padEnd(10, " "), left = s.slice(0, 9);
    return left + s[9] + [...left].reverse().join("");
  });
}

export const enum Tile { Wall, Path, Door, House }
export const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];
export const opposite = (d: number) => (d < 0 ? -1 : (d + 2) & 3);

/** Small seeded RNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number) { return Math.floor(this.next() * n); }
}

/** Grid mover: sits on tile (tx, ty) + dir * t. */
export class Mover {
  tx = 0; ty = 0; dir = -1; t = 0; want = -1; face = 1;
  get x() { return this.tx + (this.dir >= 0 ? DX[this.dir] * this.t : 0); }
  get y() { return this.ty + (this.dir >= 0 ? DY[this.dir] * this.t : 0); }
  place(x: number, y: number, dir: number) { this.tx = x; this.ty = y; this.t = 0; this.dir = dir; this.want = -1; if (dir >= 0) this.face = dir; }
}

export const enum GState { House, Leaving, Active, Entering }

export class Ghost {
  m = new Mover();
  state = GState.House;
  eyes = false;
  fright = false;
  hx = 9; hy = HouseY; homeX = 9;
  release = 0;
  bob = 0;
  /** Random target used by the wanderer. */
  rx = 0; ry = 0; rT = 0;
  constructor(readonly kind: number) {}
  get x() { return this.state === GState.Active ? this.m.x : this.hx; }
  get y() { return this.state === GState.Active ? this.m.y : this.hy; }
  get dangerous() { return this.state === GState.Active && !this.eyes && !this.fright; }
}

export const enum SimState { Ready, Play, Dying, Clear, Over }

export type SimEvent =
  | { k: "dot"; x: number; y: number }
  | { k: "pellet"; x: number; y: number }
  | { k: "ghost"; x: number; y: number; pts: number; kind: number }
  | { k: "fruit"; x: number; y: number; pts: number; kind: number }
  | { k: "fruitShow"; kind: number }
  | { k: "death" }
  | { k: "respawn" }
  | { k: "clear" }
  | { k: "over" }
  | { k: "life" }
  | { k: "frightEnd" }
  | { k: "phase"; scatter: boolean };

export const FruitPoints = [100, 300, 500, 700, 1000, 2000, 3000, 5000];
export const FruitNames = ["CHERRIES", "BERRY", "LEMON", "APPLE", "MELON", "GEM", "CAKE", "CROWN"];
export const GhostNames = ["RUSH", "TRAP", "SWOOP", "WOBBLE"];

export interface SimOptions { lives: number; infiniteLives: boolean; seed: number; extraLifeAt: number; startScore?: number }

/** One maze with its hero, four chasers, dots and fruit. */
export class MazeSim {
  readonly tiles = new Uint8Array(W * H);
  /** 0 none, 1 dot, 2 power pellet. */
  readonly dots = new Uint8Array(W * H);
  readonly rows: string[];
  readonly startX: number; readonly startY: number;
  readonly tunnelRows = new Set<number>();
  dotsTotal = 0; dotsLeft = 0; dotsEaten = 0;
  hero = new Mover();
  ghosts: Ghost[] = [0, 1, 2, 3].map((k) => new Ghost(k));
  state = SimState.Ready;
  stateT = 2;
  score = 0; lives = 3; deaths = 0; ghostsEaten = 0; fruitsEaten = 0;
  frightT = 0; chain = 0;
  phaseIdx = 0; phaseT = 0; scatter = true;
  fruitKind = -1; fruitT = 0; fruitShown = 0;
  heroSpeedMul = 1;
  time = 0;
  events: SimEvent[] = [];
  readonly rng: Rng;
  private nextLifeAt: number;
  /** Seconds of chomp animation (eating keeps the mouth busy). */
  chomp = 0;

  constructor(readonly maze: number, readonly level: number, readonly opts: SimOptions) {
    this.rng = new Rng(opts.seed);
    this.lives = opts.lives;
    this.score = opts.startScore ?? 0;
    this.nextLifeAt = opts.extraLifeAt > 0 ? (Math.floor(this.score / opts.extraLifeAt) + 1) * opts.extraLifeAt : 0;
    this.rows = mazeRows(maze);
    let sx = 9, sy = 15;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.rows[y][x], i = y * W + x;
        this.tiles[i] = c === "#" ? Tile.Wall : c === "-" ? Tile.Door : c === "G" ? Tile.House : Tile.Path;
        if (c === ".") this.dots[i] = 1;
        if (c === "o") this.dots[i] = 2;
        if (c === "P") { sx = x; sy = y; }
      }
    for (let y = 0; y < H; y++) if (this.tiles[y * W] === Tile.Path && this.tiles[y * W + W - 1] === Tile.Path) this.tunnelRows.add(y);
    this.startX = sx; this.startY = sy;
    for (const d of this.dots) if (d > 0) this.dotsTotal++;
    this.dotsLeft = this.dotsTotal;
    this.resetActors(true);
  }

  // ------------------------------------------------------------------ level tuning

  private get L() { return Math.min(this.level, 12); }
  get heroSpeed() { return (6.3 + Math.min(this.L - 1, 7) * 0.22) * this.heroSpeedMul; }
  get ghostSpeed() { return (6.3 + Math.min(this.L - 1, 7) * 0.22) * (0.9 + Math.min(this.L - 1, 7) * 0.016); }
  get frightTime() { return Math.max(1.4, 7 - (this.L - 1) * 0.75); }
  private get phases() {
    return this.L <= 1 ? [7, 20, 7, 20, 5, 20, 5] : this.L <= 4 ? [7, 20, 6, 20, 4, 25, 3] : [5, 20, 5, 20, 3, 30, 2];
  }

  // ------------------------------------------------------------------ grid helpers

  tileAt(x: number, y: number) {
    if (y < 0 || y >= H) return Tile.Wall;
    if (x < 0 || x >= W) return this.tunnelRows.has(y) ? Tile.Path : Tile.Wall;
    return this.tiles[y * W + x];
  }
  open(x: number, y: number) { return this.tileAt(x, y) === Tile.Path; }
  inTunnel(x: number, y: number) { return this.tunnelRows.has(y) && (x <= 2 || x >= W - 3); }
  dotAt(x: number, y: number) { return x >= 0 && x < W && y >= 0 && y < H ? this.dots[y * W + x] : 0; }

  /** Advances a mover by dist cells, calling decide at every tile centre. Returns false when blocked. */
  private advance(m: Mover, dist: number, decide: (m: Mover) => void) {
    let guard = 0;
    while (dist > 1e-9 && guard++ < 8) {
      if (m.t <= 1e-9) {
        m.t = 0;
        decide(m);
        if (m.dir < 0 || !this.open(m.tx + DX[m.dir], m.ty + DY[m.dir])) return false;
      }
      const step = Math.min(dist, 1 - m.t);
      m.t += step;
      dist -= step;
      m.face = m.dir;
      if (m.t >= 1 - 1e-9) {
        m.tx += DX[m.dir];
        m.ty += DY[m.dir];
        m.t = 0;
        // tunnels: off the left edge (-1) re-enters from beyond the right edge (W) and vice versa
        if (m.tx < -1) m.tx = W - 1;
        else if (m.tx > W) m.tx = 0;
        else if (m.tx === -1 && m.dir === 1) m.tx = W;
        else if (m.tx === W && m.dir === 3) m.tx = -1;
        this.onTile(m);
      }
    }
    return true;
  }

  private onTile(m: Mover) {
    if (m !== this.hero) return;
    const x = m.tx, y = m.ty;
    if (x < 0 || x >= W) return;
    const i = y * W + x, d = this.dots[i];
    if (d === 0) return;
    this.dots[i] = 0;
    this.dotsLeft--;
    this.dotsEaten++;
    this.chomp = 0.25;
    if (d === 1) { this.addScore(10); this.events.push({ k: "dot", x, y }); }
    else {
      this.addScore(50);
      this.events.push({ k: "pellet", x, y });
      this.frighten();
    }
    if (this.dotsEaten === 50 || this.dotsEaten === 120) this.spawnFruit();
    if (this.dotsLeft <= 0) {
      this.state = SimState.Clear;
      this.stateT = 2.2;
      this.frightT = 0;
      for (const g of this.ghosts) g.fright = false;
      this.events.push({ k: "clear" });
    }
  }

  addScore(v: number) {
    this.score += v;
    if (this.opts.extraLifeAt > 0 && this.score >= this.nextLifeAt) {
      this.nextLifeAt += this.opts.extraLifeAt;
      if (!this.opts.infiniteLives) { this.lives++; this.events.push({ k: "life" }); }
    }
  }

  private spawnFruit() {
    this.fruitKind = Math.min(this.level - 1, FruitPoints.length - 1);
    if (this.fruitShown === 1 && this.level > 2) this.fruitKind = Math.min(this.fruitKind + 1, FruitPoints.length - 1);
    this.fruitShown++;
    this.fruitT = 9.5;
    this.events.push({ k: "fruitShow", kind: this.fruitKind });
  }

  private frighten() {
    this.frightT = this.frightTime;
    this.chain = 0;
    for (const g of this.ghosts) {
      if (g.eyes) continue;
      g.fright = true;
      if (g.state === GState.Active && g.m.dir >= 0) g.m.want = opposite(g.m.dir);
    }
  }

  // ------------------------------------------------------------------ reset

  resetActors(first: boolean) {
    this.hero.place(this.startX, this.startY, -1);
    this.hero.face = 1;
    this.hero.want = 1;
    this.frightT = 0;
    this.chomp = 0;
    const homes = [9, 9, 8, 10], rel = first ? [0, 0.6, 4, 8] : [0, 0.4, 2.5, 4.5];
    for (const g of this.ghosts) {
      g.eyes = g.fright = false;
      g.homeX = homes[g.kind];
      g.hx = g.homeX;
      g.hy = HouseY;
      g.release = rel[g.kind];
      g.bob = g.kind * 0.7;
      g.rT = 0;
      if (g.kind === 0) { g.state = GState.Active; g.m.place(ExitX, ExitY, 1); }
      else g.state = GState.House;
    }
    this.phaseIdx = 0;
    this.phaseT = 0;
    this.scatter = true;
    this.state = SimState.Ready;
    this.stateT = first ? 2.0 : 1.4;
  }

  /** Puts the hero back after a rewarded continue (keeps dots and score). */
  continueRun(lives: number) {
    this.lives = lives;
    this.resetActors(false);
    this.events.push({ k: "respawn" });
  }

  // ------------------------------------------------------------------ step

  setWant(d: number) { if (d >= 0) this.hero.want = d; }

  step(dt: number) {
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      this.substep(h);
      left -= h;
    }
  }

  private substep(dt: number) {
    this.time += dt;
    if (this.chomp > 0) this.chomp -= dt;
    switch (this.state) {
      case SimState.Ready:
        this.stateT -= dt;
        for (const g of this.ghosts) if (g.state === GState.House) { g.bob += dt * 4; g.hy = HouseY + Math.sin(g.bob) * 0.22; }
        if (this.stateT <= 0) this.state = SimState.Play;
        return;
      case SimState.Dying:
        this.stateT -= dt;
        if (this.stateT <= 0) {
          if (!this.opts.infiniteLives) this.lives--;
          if (!this.opts.infiniteLives && this.lives <= 0) {
            this.lives = 0;
            this.state = SimState.Over;
            this.events.push({ k: "over" });
          } else {
            this.resetActors(false);
            this.events.push({ k: "respawn" });
          }
        }
        return;
      case SimState.Clear:
        this.stateT -= dt;
        return;
      case SimState.Over:
        return;
    }

    // scatter / chase schedule (paused while frightened)
    if (this.frightT > 0) {
      this.frightT -= dt;
      if (this.frightT <= 0) {
        for (const g of this.ghosts) g.fright = false;
        this.events.push({ k: "frightEnd" });
      }
    } else {
      this.phaseT += dt;
      const ph = this.phases;
      if (this.phaseIdx < ph.length && this.phaseT >= ph[this.phaseIdx]) {
        this.phaseT = 0;
        this.phaseIdx++;
        this.scatter = this.phaseIdx % 2 === 0;
        for (const g of this.ghosts) if (g.state === GState.Active && !g.eyes && g.m.dir >= 0) g.m.want = opposite(g.m.dir);
        this.events.push({ k: "phase", scatter: this.scatter });
      }
    }

    if (this.fruitT > 0) { this.fruitT -= dt; if (this.fruitT <= 0) this.fruitKind = -1; }

    // hero
    const hm = this.hero;
    if (hm.want >= 0 && hm.dir >= 0 && hm.want === opposite(hm.dir) && hm.t > 0) {
      hm.tx += DX[hm.dir]; hm.ty += DY[hm.dir];
      hm.t = 1 - hm.t;
      hm.dir = hm.want;
      hm.face = hm.dir;
    }
    this.advance(hm, this.heroSpeed * dt, (m) => {
      if (m.want >= 0 && this.open(m.tx + DX[m.want], m.ty + DY[m.want])) m.dir = m.want;
      else if (m.dir >= 0 && !this.open(m.tx + DX[m.dir], m.ty + DY[m.dir])) m.dir = -1;
      if (m.dir >= 0) m.face = m.dir;
    });

    // fruit
    if (this.fruitKind >= 0 && Math.abs(hm.x - FruitX) < 0.6 && Math.abs(hm.y - FruitY) < 0.6) {
      const pts = FruitPoints[this.fruitKind];
      this.addScore(pts);
      this.fruitsEaten++;
      this.events.push({ k: "fruit", x: FruitX, y: FruitY, pts, kind: this.fruitKind });
      this.fruitKind = -1;
      this.fruitT = 0;
    }

    // ghosts
    for (const g of this.ghosts) this.moveGhost(g, dt);
    this.collide();
  }

  private ghostSpeedOf(g: Ghost) {
    if (g.eyes) return 15;
    const base = this.ghostSpeed;
    if (g.state === GState.Active && this.inTunnel(g.m.tx, g.m.ty)) return base * 0.5;
    if (g.fright) return base * 0.58;
    if (g.kind === 0 && this.dotsLeft <= 20) return base * 1.07;
    return base;
  }

  private moveGhost(g: Ghost, dt: number) {
    const sp = this.ghostSpeedOf(g);
    switch (g.state) {
      case GState.House:
        g.bob += dt * 4;
        g.hy = HouseY + Math.sin(g.bob) * 0.22;
        g.release -= dt;
        if (g.release <= 0) g.state = GState.Leaving;
        return;
      case GState.Leaving: {
        const s = Math.min(sp, 4) * dt;
        if (Math.abs(g.hx - ExitX) > 1e-3) g.hx += Math.sign(ExitX - g.hx) * Math.min(s, Math.abs(ExitX - g.hx));
        else {
          g.hx = ExitX;
          g.hy -= s;
          if (g.hy <= ExitY) {
            g.hy = ExitY;
            g.state = GState.Active;
            g.m.place(ExitX, ExitY, this.rng.next() < 0.5 ? 1 : 3);
          }
        }
        return;
      }
      case GState.Entering: {
        const s = 8 * dt;
        if (g.hy < HouseY - 1e-3) g.hy = Math.min(HouseY, g.hy + s);
        else if (Math.abs(g.hx - g.homeX) > 1e-3) g.hx += Math.sign(g.homeX - g.hx) * Math.min(s, Math.abs(g.homeX - g.hx));
        else { g.eyes = false; g.fright = false; g.state = GState.Leaving; }
        return;
      }
    }
    // active
    const m = g.m;
    if (m.want >= 0 && m.dir >= 0 && m.want === opposite(m.dir)) {
      if (m.t > 0) { m.tx += DX[m.dir]; m.ty += DY[m.dir]; m.t = 1 - m.t; }
      m.dir = m.want;
      m.want = -1;
    }
    this.advance(m, sp * dt, (mv) => {
      if (g.eyes && mv.tx === ExitX && mv.ty === ExitY) {
        g.state = GState.Entering;
        g.hx = ExitX;
        g.hy = ExitY;
        mv.dir = -1;
        return;
      }
      mv.dir = this.chooseDir(g);
    });
  }

  /** Target tile for a chaser in the current mode. */
  target(g: Ghost): [number, number] {
    if (g.eyes) return [ExitX, ExitY];
    const h = this.hero, hx = h.tx, hy = h.ty, f = h.face >= 0 ? h.face : 1;
    if (this.scatter) return [[W - 2, -3], [1, -3], [W - 1, H + 1], [0, H + 1]][g.kind] as [number, number];
    switch (g.kind) {
      case 0: return [hx, hy];
      case 1: return [hx + DX[f] * 4, hy + DY[f] * 4];
      case 2: {
        const r = this.ghosts[0], px = hx + DX[f] * 2, py = hy + DY[f] * 2;
        return [px * 2 - r.m.tx, py * 2 - r.m.ty];
      }
      default: {
        if (this.time > g.rT) { g.rT = this.time + 2 + this.rng.next() * 2; g.rx = this.rng.int(W); g.ry = this.rng.int(H); }
        const d = Math.abs(g.m.tx - hx) + Math.abs(g.m.ty - hy);
        return d < 7 && this.rng.next() < 0.5 ? [hx, hy] : [g.rx, g.ry];
      }
    }
  }

  private chooseDir(g: Ghost) {
    const m = g.m, back = opposite(m.dir);
    const opts: number[] = [];
    for (let d = 0; d < 4; d++) if (d !== back && this.open(m.tx + DX[d], m.ty + DY[d])) opts.push(d);
    if (opts.length === 0) return back;
    if (opts.length === 1) return opts[0];
    if (g.fright && !g.eyes) return opts[this.rng.int(opts.length)];
    if (g.kind === 3 && !g.eyes && !this.scatter && this.rng.next() < 0.3) return opts[this.rng.int(opts.length)];
    const [tx, ty] = this.target(g);
    let best = opts[0], bd = Infinity;
    for (const d of opts) {
      const nx = m.tx + DX[d], ny = m.ty + DY[d];
      const dd = (nx - tx) * (nx - tx) + (ny - ty) * (ny - ty);
      if (dd < bd - 1e-6) { bd = dd; best = d; }
    }
    return best;
  }

  private collide() {
    const h = this.hero;
    for (const g of this.ghosts) {
      if (g.state !== GState.Active || g.eyes) continue;
      let dx = Math.abs(g.m.x - h.x);
      if (dx > W / 2) dx = W + 1 - dx;
      if (dx * dx + (g.m.y - h.y) ** 2 > 0.6 * 0.6) continue;
      if (g.fright) {
        g.fright = false;
        g.eyes = true;
        this.chain++;
        this.ghostsEaten++;
        const pts = 200 * (1 << Math.min(this.chain - 1, 3));
        this.addScore(pts);
        this.events.push({ k: "ghost", x: g.m.x, y: g.m.y, pts, kind: g.kind });
      } else {
        this.state = SimState.Dying;
        this.stateT = 1.7;
        this.deaths++;
        this.fruitKind = -1;
        this.events.push({ k: "death" });
        return;
      }
    }
  }
}

// ------------------------------------------------------------------ bot

export interface BotLevel { margin: number; slip: number; think: number; hunt: boolean; sight: number; areaCap: number }
export const BotLevels: BotLevel[] = [
  { margin: 0, slip: 0.3, think: 0.35, hunt: false, sight: 4, areaCap: 6 },
  { margin: 0, slip: 0.12, think: 0.15, hunt: false, sight: 7, areaCap: 8 },
  { margin: 0.5, slip: 0, think: 0.05, hunt: true, sight: 10, areaCap: 10 },
];

/** A computer muncher: picks the direction with the closest food it can reach before any chaser. */
export class MunchBot {
  private timer = 0;
  private lastNode = -1;
  private readonly gd = new Float32Array((W + 2) * H);
  private readonly one = new Float32Array((W + 2) * H);
  private readonly hd = new Int16Array((W + 2) * H);
  private readonly queue = new Int32Array((W + 2) * H * 2);
  constructor(readonly lv: BotLevel, private rng: Rng) {}

  private idx(x: number, y: number) { return y * (W + 2) + (x + 1); }

  think(sim: MazeSim, dt: number) {
    if (sim.state !== SimState.Play && sim.state !== SimState.Ready) { this.lastNode = -1; return; }
    const h = sim.hero;
    this.timer -= dt;
    const node = h.t > 0 && h.dir >= 0 ? this.idx(h.tx + DX[h.dir], h.ty + DY[h.dir]) : this.idx(h.tx, h.ty);
    if (this.timer > 0 && node === this.lastNode) return;
    this.timer = this.lv.think;
    this.lastNode = node;
    this.ghostField(sim);
    const ratio = sim.ghostSpeed / sim.heroSpeed;
    if (h.t > 0 && h.dir >= 0) {
      const nx = h.tx + DX[h.dir], ny = h.ty + DY[h.dir];
      const fwd = this.bestFrom(sim, nx, ny, h.tx, h.ty, 1 - h.t, ratio);
      const back = this.bestFrom(sim, h.tx, h.ty, nx, ny, h.t, ratio);
      if (back.score > fwd.score + 150 && back.score > -500) sim.setWant(opposite(h.dir));
      else if (fwd.dir >= 0) sim.setWant(this.slip(sim, nx, ny, opposite(h.dir), fwd.dir));
    } else {
      const b = this.bestFrom(sim, h.tx, h.ty, -99, -99, 0, ratio);
      if (b.dir >= 0) sim.setWant(this.slip(sim, h.tx, h.ty, -1, b.dir));
    }
  }

  /** Weaker bots sometimes take a random turn at a junction. */
  private slip(sim: MazeSim, x: number, y: number, back: number, d: number) {
    if (this.lv.slip <= 0 || this.rng.next() >= this.lv.slip) return d;
    const opts: number[] = [];
    for (let k = 0; k < 4; k++) if (k !== back && sim.open(x + DX[k], y + DY[k])) opts.push(k);
    return opts.length > 1 ? opts[this.rng.int(opts.length)] : d;
  }

  /** Distance (in cells) from the nearest dangerous chaser to every tile; chasers cannot turn back. */
  private ghostField(sim: MazeSim) {
    const gd = this.gd, q = this.queue, one = this.one;
    gd.fill(1e6);
    const hx = sim.hero.tx, hy = sim.hero.ty;
    const frightEnding = sim.frightT > 0 && sim.frightT < 1.3;
    for (const g of sim.ghosts) {
      let gx: number, gy: number, bx = -99, by = -99, d0 = 0;
      if (g.state === GState.Active) {
        if (g.eyes || (g.fright && !frightEnding)) continue;
        gx = g.m.tx; gy = g.m.ty;
        if (g.m.dir >= 0) {
          if (g.m.t > 0.01) { bx = gx; by = gy; gx += DX[g.m.dir]; gy += DY[g.m.dir]; d0 = 1 - g.m.t; }
          else { bx = gx - DX[g.m.dir]; by = gy - DY[g.m.dir]; }
        }
      } else if (g.state === GState.Leaving || (g.state === GState.House && g.release < 1.5)) {
        if (g.fright && !frightEnding) continue;
        gx = ExitX; gy = ExitY; d0 = g.state === GState.Leaving ? Math.abs(g.hy - ExitY) + Math.abs(g.hx - ExitX) : 2;
      } else continue;
      if (gx < -1 || gx > W || Math.abs(gx - hx) + Math.abs(gy - hy) > this.lv.sight) continue;
      one.fill(1e6);
      let qh = 0, qt = 0;
      one[this.idx(gx, gy)] = d0;
      q[qt++] = gx; q[qt++] = gy;
      while (qh < qt) {
        const x = q[qh++], y = q[qh++], d = one[this.idx(x, y)];
        for (let k = 0; k < 4; k++) {
          let nx = x + DX[k];
          const ny = y + DY[k];
          if (nx < -1) nx = W; else if (nx > W) nx = -1;
          if (!sim.open(nx, ny) || (nx === bx && ny === by && d === d0)) continue;
          const j = this.idx(nx, ny);
          if (one[j] <= d + 1) continue;
          one[j] = d + 1;
          q[qt++] = nx; q[qt++] = ny;
        }
      }
      for (let i = 0; i < gd.length; i++) if (one[i] < gd[i]) gd[i] = one[i];
    }
  }

  /** Best first step from (sx, sy) not stepping onto (bx, by): safe area and distance to food. */
  private bestFrom(sim: MazeSim, sx: number, sy: number, bx: number, by: number, extra: number, ratio: number) {
    let bestDir = -1, best = -1e9;
    const frightLeft = sim.frightT;
    for (let d = 0; d < 4; d++) {
      const nx0 = sx + DX[d], ny0 = sy + DY[d];
      if (!sim.open(nx0, ny0) || (nx0 === bx && ny0 === by)) continue;
      const s = this.scoreDir(sim, sx, sy, nx0, ny0, extra, ratio, frightLeft);
      const jitter = this.rng.next() * 0.5;
      if (s + jitter > best) { best = s + jitter; bestDir = d; }
    }
    return { dir: bestDir, score: best };
  }

  private scoreDir(sim: MazeSim, sx: number, sy: number, fx: number, fy: number, extra: number, ratio: number, frightLeft: number) {
    const hd = this.hd, gd = this.gd, q = this.queue;
    hd.fill(-1);
    let qh = 0, qt = 0;
    hd[this.idx(sx, sy)] = 0;
    const start = this.idx(fx, fy);
    const margin = this.lv.margin;
    const safe = (i: number, dist: number) => (dist + extra) * ratio + margin < gd[i];
    if (!safe(start, 1)) return -2000 + gd[start] * 10;
    hd[start] = 1;
    q[qt++] = fx; q[qt++] = fy;
    let area = 0, food = 1e6, pelletD = 1e6, preyD = 1e6;
    const heroSp = sim.heroSpeed;
    while (qh < qt) {
      const x = q[qh++], y = q[qh++], dist = hd[this.idx(x, y)];
      area++;
      const dot = sim.dotAt(x, y);
      if (dot === 1 && dist < food) food = dist;
      if (dot === 2 && dist < pelletD) pelletD = dist;
      if (sim.fruitKind >= 0 && x === FruitX && y === FruitY && dist < food) food = Math.max(1, dist - 6);
      if (this.lv.hunt && frightLeft > 0) {
        for (const g of sim.ghosts)
          if (g.state === GState.Active && g.fright && !g.eyes && g.m.tx === x && g.m.ty === y && (dist + 2) / heroSp < frightLeft - 0.6)
            preyD = Math.min(preyD, dist);
      }
      if (dist >= 40) continue;
      for (let k = 0; k < 4; k++) {
        let nx = x + DX[k];
        const ny = y + DY[k];
        if (nx < -1) nx = W; else if (nx > W) nx = -1;
        if (!sim.open(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (hd[j] >= 0) continue;
        if (!safe(j, dist + 1)) { hd[j] = 9999; continue; }
        hd[j] = dist + 1;
        q[qt++] = nx; q[qt++] = ny;
      }
    }
    let s = 0;
    s += Math.min(area, this.lv.areaCap) * 10;
    // close threats make power pellets very attractive
    const threat = gd[start];
    const pelletWeight = threat < 8 ? 2.2 : sim.frightT > 0 ? 0.2 : 0.6;
    const foodScore = Math.max(0, 120 - food * 4);
    const pelletScore = Math.max(0, 120 - pelletD * 4) * pelletWeight;
    const preyScore = preyD < 5 ? Math.max(0, 200 - preyD * 12) : 0;
    s += Math.max(foodScore, pelletScore, preyScore);
    s += Math.min(threat, 12) * 2;
    return s;
  }
}
