/**
 * EMBER & RIPPLE simulation: a deterministic, render-free tile platformer (fixed 1/120 s steps, AABB vs tiles, sliding
 * gates / lifts / moving platforms, pushable blocks, buttons, levers, fans, pools, gems and doors). One world unit
 * is one tile; y is up and the map's bottom-left corner is (0, 0). No kit imports so it runs headless in tests.
 */

export const Phys = {
  Dt: 1 / 120,
  Gravity: 40,
  JumpV: 14.1,
  Run: 6.2,
  GroundAcc: 75,
  GroundDec: 95,
  AirAcc: 46,
  AirDec: 20,
  MaxFall: 17,
  Coyote: 0.1,
  Buffer: 0.13,
  JumpCut: 0.5,
  PushSpeed: 2.7,
  HeroW: 0.62,
  HeroH: 0.9,
  FanAcc: 95,
  FanMax: 7.2,
  FanReach: 7,
  MoverSpeed: 2.6,
};

export enum Tile { Air = 0, Wall = 1, Lava = 2, Water = 3, Goo = 4, Fan = 5 }
export enum Hero { Ember = 0, Ripple = 1 }

export interface MoverDef {
  /** Offset in tiles when the mover is fully active (or the far end of a loop). */
  move: [number, number];
  /** Tiles per second. */
  speed?: number;
  /** Ping-pongs on its own (while its trigger is on, when it has one). */
  loop?: boolean;
  /** Active when its trigger is OFF (a gate that closes while a button is held). */
  invert?: boolean;
  /** Trigger letter, when it is not the mover's own letter in lower case. */
  trigger?: string;
}

export interface LevelDef {
  name: string;
  /** Seconds for the time star. */
  par: number;
  /** Solution hint (rewarded). */
  hint: string;
  /** Short tutorial line shown when the level starts. */
  tip?: string;
  map: string[];
  movers?: Record<string, MoverDef>;
  /** Lower-case trigger letters that are levers (the rest are pressure buttons). */
  levers?: string;
}

export interface HeroInput { left: boolean; right: boolean; jump: boolean }
export const NoInput: HeroInput = { left: false, right: false, jump: false };

export type SimEvent =
  | { type: "jump"; hero: Hero }
  | { type: "land"; hero: Hero; speed: number }
  | { type: "gem"; hero: Hero; x: number; y: number }
  | { type: "die"; hero: Hero; cause: Tile }
  | { type: "trigger"; letter: string; on: boolean; x: number; y: number; lever: boolean }
  | { type: "door"; hero: Hero; inside: boolean }
  | { type: "win" }
  | { type: "blockLand"; x: number; y: number; speed: number };

const EPS = 1e-4;

export class Body {
  x = 0; y = 0; w = 1; h = 1; vx = 0; vy = 0;
  grounded = false;
  /** What the body stands on (carried along by it). */
  support: Body | Mover | null = null;
  readonly isBlock: boolean = false;
  get cx() { return this.x + this.w * 0.5; }
  get cy() { return this.y + this.h * 0.5; }
}

export class HeroBody extends Body {
  alive = true;
  facing = 1;
  coyote = 0;
  buffer = 0;
  jumpHeld = false;
  jumping = false;
  pushing = false;
  inDoor = false;
  airTime = 0;
  inFan = false;
  constructor(readonly kind: Hero, readonly spawnX: number, readonly spawnY: number) {
    super();
    this.w = Phys.HeroW;
    this.h = Phys.HeroH;
    this.x = spawnX - this.w * 0.5;
    this.y = spawnY;
  }
}

export class Block extends Body {
  override readonly isBlock = true;
  /** Horizontal distance pushed this step (for scrape sounds). */
  pushed = 0;
  constructor(readonly spawnX: number, readonly spawnY: number) {
    super();
    this.w = 0.96;
    this.h = 0.96;
    this.x = spawnX + 0.02;
    this.y = spawnY;
  }
}

export class Mover {
  x: number; y: number;
  t = 0; dir = 1; pause = 0;
  active = false;
  /** Movement this step (for sounds / carrying visuals). */
  dx = 0; dy = 0;
  readonly speed: number; readonly loop: boolean; readonly invert: boolean;
  readonly ox: number; readonly oy: number;
  constructor(readonly letter: string, readonly x0: number, readonly y0: number, readonly w: number, readonly h: number,
    def: MoverDef, readonly trigger: string | null) {
    this.x = x0; this.y = y0;
    this.ox = def.move[0]; this.oy = def.move[1];
    this.speed = def.speed ?? (def.loop ? 2 : Phys.MoverSpeed);
    this.loop = !!def.loop;
    this.invert = !!def.invert;
    if (this.invert && !this.loop) { this.t = 1; this.x = x0 + this.ox; this.y = y0 + this.oy; }
  }
}

export class Trigger {
  on = false;
  constructor(readonly letter: string, readonly x: number, readonly y: number, readonly lever: boolean) {}
}

export class Gem {
  taken = false;
  constructor(readonly kind: Hero, readonly x: number, readonly y: number) {}
}

export class Door {
  constructor(readonly kind: Hero, readonly x: number, readonly y: number) {}
}

export class Fan {
  constructor(readonly x: number, readonly y: number, readonly top: number) {}
}

const HeroChars = "12";
const Reserved = "#.12ERrboLWG^ ";

/** Parses a level map (validation lives in validateLevel). */
export function parseLevel(def: LevelDef) {
  const H = def.map.length, W = Math.max(...def.map.map((r) => r.length));
  const at = (cx: number, cy: number) => { const row = def.map[H - 1 - cy]; return row && cx < row.length ? row[cx] : "#"; };
  return { W, H, at };
}

export function isTrigger(ch: string) { return ch >= "a" && ch <= "z" && !"rbo".includes(ch); }
export function isMover(ch: string) { return ch >= "A" && ch <= "Z" && !"ERLWG".includes(ch); }

export class Sim {
  readonly W: number; readonly H: number;
  readonly tiles: Uint8Array;
  readonly heroes: HeroBody[] = [];
  readonly blocks: Block[] = [];
  readonly movers: Mover[] = [];
  readonly triggers: Trigger[] = [];
  readonly gems: Gem[] = [];
  readonly doors: Door[] = [];
  readonly fans: Fan[] = [];
  readonly gemTotal = [0, 0];
  readonly gemTaken = [0, 0];
  events: SimEvent[] = [];
  time = 0;
  steps = 0;
  /** Hero that died (-1 = none); the simulation freezes. */
  dead = -1;
  deathCause = Tile.Air;
  won = false;
  private readonly channel = new Map<string, boolean>();

  constructor(readonly def: LevelDef) {
    const { W, H, at } = parseLevel(def);
    this.W = W; this.H = H;
    this.tiles = new Uint8Array(W * H);
    const seen = new Uint8Array(W * H);
    const spawns: [number, number][] = [[1.5, 1], [2.5, 1]];
    for (let cy = 0; cy < H; cy++)
      for (let cx = 0; cx < W; cx++) {
        const ch = at(cx, cy);
        let t = Tile.Air;
        switch (ch) {
          case "#": t = Tile.Wall; break;
          case "L": t = Tile.Lava; break;
          case "W": t = Tile.Water; break;
          case "G": t = Tile.Goo; break;
          case "^": t = Tile.Fan; break;
          case "1": case "2": spawns[HeroChars.indexOf(ch)] = [cx + 0.5, cy]; break;
          case "E": this.doors.push(new Door(Hero.Ember, cx, cy)); break;
          case "R": this.doors.push(new Door(Hero.Ripple, cx, cy)); break;
          case "r": this.gems.push(new Gem(Hero.Ember, cx + 0.5, cy + 0.5)); break;
          case "b": this.gems.push(new Gem(Hero.Ripple, cx + 0.5, cy + 0.5)); break;
          case "o": this.blocks.push(new Block(cx, cy)); break;
          default:
            if (isTrigger(ch)) this.triggers.push(new Trigger(ch, cx, cy, (def.levers ?? "").includes(ch)));
        }
        this.tiles[cy * W + cx] = t;
      }
    // movers: 4-connected components of the same upper-case letter
    for (let cy = 0; cy < H; cy++)
      for (let cx = 0; cx < W; cx++) {
        const ch = at(cx, cy);
        if (!isMover(ch) || seen[cy * W + cx]) continue;
        let x0 = cx, x1 = cx, y0 = cy, y1 = cy;
        const stack = [[cx, cy]];
        seen[cy * W + cx] = 1;
        while (stack.length) {
          const [x, y] = stack.pop()!;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx] || at(nx, ny) !== ch) continue;
            seen[ny * W + nx] = 1;
            stack.push([nx, ny]);
          }
        }
        const md = def.movers?.[ch] ?? { move: [0, 0] as [number, number] };
        const tl = md.trigger ?? ch.toLowerCase();
        const trig = def.map.some((r) => r.includes(tl)) ? tl : null;
        this.movers.push(new Mover(ch, x0, y0, x1 - x0 + 1, y1 - y0 + 1, md, trig));
      }
    for (const g of this.gems) this.gemTotal[g.kind]++;
    this.heroes.push(new HeroBody(Hero.Ember, spawns[0][0], spawns[0][1]), new HeroBody(Hero.Ripple, spawns[1][0], spawns[1][1]));
    // fans blow up to the first solid tile (at most FanReach tiles)
    for (let cy = 0; cy < H; cy++)
      for (let cx = 0; cx < W; cx++) {
        if (this.tiles[cy * W + cx] !== Tile.Fan) continue;
        let top = cy + 1;
        while (top < H && top - (cy + 1) < Phys.FanReach && this.tiles[top * W + cx] === Tile.Air) top++;
        this.fans.push(new Fan(cx, cy, top));
      }
    this.refreshChannels();
    this.updateSupports();
  }

  // ------------------------------------------------------------------ queries

  tile(cx: number, cy: number) {
    if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return Tile.Wall;
    return this.tiles[cy * this.W + cx] as Tile;
  }

  solidTile(cx: number, cy: number) { return this.tile(cx, cy) !== Tile.Air; }

  isActive(letter: string) { return this.channel.get(letter) ?? false; }

  /** Mover progress (0..1) of the first mover with this letter. */
  moverT(letter: string) { return this.movers.find((m) => m.letter === letter)?.t ?? 0; }

  static deadly(kind: Hero, t: Tile) {
    if (t === Tile.Goo) return true;
    return kind === Hero.Ember ? t === Tile.Water : t === Tile.Lava;
  }

  /** True when the box overlaps nothing solid (tiles, movers, blocks), ignoring the given objects. */
  free(x: number, y: number, w: number, h: number, ignoreA: unknown = null, ignoreB: unknown = null) {
    const x0 = Math.floor(x + EPS), x1 = Math.floor(x + w - EPS), y0 = Math.floor(y + EPS), y1 = Math.floor(y + h - EPS);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (this.solidTile(cx, cy)) return false;
    for (const m of this.movers) if (m !== ignoreA && m !== ignoreB && overlap(x, y, w, h, m.x, m.y, m.w, m.h)) return false;
    for (const b of this.blocks) if (b !== ignoreA && b !== ignoreB && overlap(x, y, w, h, b.x, b.y, b.w, b.h)) return false;
    return true;
  }

  // ------------------------------------------------------------------ movement

  /** Moves a body horizontally, stopping at solids. Heroes push blocks. Returns the distance moved. */
  moveX(b: Body, dx: number, push: boolean, ignore: Mover | null = null): number {
    if (dx === 0) return 0;
    const ox = b.x;
    let nx = b.x + dx;
    const y0 = b.y + EPS, y1 = b.y + b.h - EPS;
    const sx0 = Math.min(b.x, nx), sx1 = Math.max(b.x, nx) + b.w;
    for (let cy = Math.floor(y0); cy <= Math.floor(y1); cy++)
      for (let cx = Math.floor(sx0 + EPS); cx <= Math.floor(sx1 - EPS); cx++) {
        if (!this.solidTile(cx, cy)) continue;
        if (dx > 0 && cx >= b.x + b.w - EPS) nx = Math.min(nx, cx - b.w);
        else if (dx < 0 && cx + 1 <= b.x + EPS) nx = Math.max(nx, cx + 1);
      }
    for (const m of this.movers) {
      if (m === ignore || !(m.y < y1 && m.y + m.h > y0)) continue;
      if (dx > 0 && m.x >= b.x + b.w - EPS && m.x < nx + b.w) nx = Math.min(nx, m.x - b.w);
      else if (dx < 0 && m.x + m.w <= b.x + EPS && m.x + m.w > nx) nx = Math.max(nx, m.x + m.w);
    }
    const ahead = this.blocks.filter((k) => k !== b && k.y < y1 && k.y + k.h > y0 && (dx > 0 ? k.x >= b.x + b.w - EPS && k.x < nx + b.w : k.x + k.w <= b.x + EPS && k.x + k.w > nx));
    ahead.sort((p, q) => (dx > 0 ? p.x - q.x : q.x - p.x));
    for (const k of ahead) {
      if (push && b instanceof HeroBody) {
        const need = dx > 0 ? nx + b.w - k.x : nx - (k.x + k.w);
        k.pushed += this.moveX(k, need, false);
        b.pushing = true;
      }
      if (dx > 0) nx = Math.min(nx, k.x - b.w);
      else nx = Math.max(nx, k.x + k.w);
    }
    if (dx > 0) nx = Math.max(nx, ox); else nx = Math.min(nx, ox);
    b.x = nx;
    return nx - ox;
  }

  /** Moves a body vertically, stopping at solids. Returns the distance moved. */
  moveY(b: Body, dy: number, ignore: Mover | null = null): number {
    if (dy === 0) return 0;
    const oy = b.y;
    let ny = b.y + dy;
    const x0 = b.x + EPS, x1 = b.x + b.w - EPS;
    const sy0 = Math.min(b.y, ny), sy1 = Math.max(b.y, ny) + b.h;
    for (let cy = Math.floor(sy0 + EPS); cy <= Math.floor(sy1 - EPS); cy++)
      for (let cx = Math.floor(x0); cx <= Math.floor(x1); cx++) {
        if (!this.solidTile(cx, cy)) continue;
        if (dy > 0 && cy >= b.y + b.h - EPS) ny = Math.min(ny, cy - b.h);
        else if (dy < 0 && cy + 1 <= b.y + EPS) ny = Math.max(ny, cy + 1);
      }
    for (const m of this.movers) {
      if (m === ignore || !(m.x < x1 && m.x + m.w > x0)) continue;
      if (dy > 0 && m.y >= b.y + b.h - EPS && m.y < ny + b.h) ny = Math.min(ny, m.y - b.h);
      else if (dy < 0 && m.y + m.h <= b.y + EPS && m.y + m.h > ny) ny = Math.max(ny, m.y + m.h);
    }
    for (const k of this.blocks) {
      if (k === b || !(k.x < x1 && k.x + k.w > x0)) continue;
      if (dy > 0 && k.y >= b.y + b.h - EPS && k.y < ny + b.h) ny = Math.min(ny, k.y - b.h);
      else if (dy < 0 && k.y + k.h <= b.y + EPS && k.y + k.h > ny) ny = Math.max(ny, k.y + k.h);
    }
    if (dy > 0) ny = Math.max(ny, oy); else ny = Math.min(ny, oy);
    b.y = ny;
    return ny - oy;
  }

  private bodies(): Body[] { return [...this.heroes.filter((h) => h.alive), ...this.blocks]; }

  /** Moves a body with whatever carries it, and everything standing on it. */
  private carry(b: Body, dx: number, dy: number, by: Mover, depth = 0) {
    const x0 = b.x, y0 = b.y;
    this.moveX(b, dx, false, by);
    this.moveY(b, dy, by);
    if (depth > 3) return;
    const mx = b.x - x0, my = b.y - y0;
    if (mx === 0 && my === 0) return;
    for (const r of this.bodies()) if (r.support === b) this.carry(r, mx, my, by, depth + 1);
  }

  // ------------------------------------------------------------------ step

  step(inputs: HeroInput[]) {
    this.events = [];
    if (this.dead >= 0 || this.won) return;
    const dt = Phys.Dt;
    this.time += dt;
    this.steps++;
    this.updateTriggers();
    this.updateMovers(dt);
    for (const h of this.heroes) this.stepHero(h, inputs[h.kind] ?? NoInput, dt);
    for (const k of this.blocks) this.stepBlock(k, dt);
    this.updateSupports();
    this.checkHeroes();
  }

  /** A channel is on while any of its buttons is pressed, or while an odd number of its levers is thrown (levers work
   * like two-way light switches: every lever flips the channel). */
  private refreshChannels() {
    this.channel.clear();
    const flips = new Map<string, number>();
    for (const t of this.triggers) {
      if (t.lever) { if (t.on) flips.set(t.letter, (flips.get(t.letter) ?? 0) + 1); }
      else if (t.on) this.channel.set(t.letter, true);
    }
    for (const [l, n] of flips) if (n % 2 === 1) this.channel.set(l, true);
    for (const m of this.movers) m.active = m.trigger ? this.isActive(m.trigger) : true;
  }

  private updateTriggers() {
    for (const t of this.triggers) {
      let on = t.on;
      if (t.lever) {
        for (const h of this.heroes) {
          if (!h.alive || !overlap(h.x, h.y, h.w, h.h, t.x + 0.2, t.y, 0.6, 0.9)) continue;
          if (h.vx > 0.6) on = true;
          else if (h.vx < -0.6) on = false;
        }
      } else {
        on = false;
        for (const b of this.bodies()) {
          if (b.y < t.y - 0.05 || b.y > t.y + 0.3) continue;
          const ov = Math.min(b.x + b.w, t.x + 0.9) - Math.max(b.x, t.x + 0.1);
          if (ov > 0.05) { on = true; break; }
        }
      }
      if (on !== t.on) {
        t.on = on;
        this.events.push({ type: "trigger", letter: t.letter, on, x: t.x, y: t.y, lever: t.lever });
      }
    }
    this.refreshChannels();
  }

  private updateMovers(dt: number) {
    for (const m of this.movers) {
      m.dx = m.dy = 0;
      const len = Math.max(0.01, Math.hypot(m.ox, m.oy)), rate = m.speed / len;
      let t = m.t, dir = m.dir, pause = m.pause;
      if (m.loop) {
        if (m.active !== m.invert || !m.trigger) {
          if (pause > 0) pause -= dt;
          else {
            t += dir * rate * dt;
            if (t >= 1) { t = 1; dir = -1; pause = 0.5; }
            else if (t <= 0) { t = 0; dir = 1; pause = 0.5; }
          }
        }
      } else {
        const target = m.active !== m.invert ? 1 : 0;
        t = moveTowards(t, target, rate * dt);
      }
      const nx = m.x0 + m.ox * t, ny = m.y0 + m.oy * t;
      const dx = nx - m.x, dy = ny - m.y;
      if (dx === 0 && dy === 0) { m.t = t; m.dir = dir; m.pause = pause; continue; }
      if (!this.tryMoveMover(m, nx, ny, dx, dy)) {
        // blocked by a body: stay put (loops wait), never crush
        continue;
      }
      m.t = t; m.dir = dir; m.pause = pause;
      m.dx = dx; m.dy = dy;
    }
  }

  private tryMoveMover(m: Mover, nx: number, ny: number, dx: number, dy: number) {
    const riders = this.bodies().filter((b) => b.support === m);
    const pushes: [Body, number, number][] = [];
    for (const b of this.bodies()) {
      if (riders.includes(b) || !overlap(nx, ny, m.w, m.h, b.x, b.y, b.w, b.h)) continue;
      let px = 0, py = 0;
      if (Math.abs(dy) >= Math.abs(dx)) py = dy > 0 ? ny + m.h - b.y : ny - (b.y + b.h);
      else px = dx > 0 ? nx + m.w - b.x : nx - (b.x + b.w);
      if (!this.free(b.x + px, b.y + py, b.w, b.h, m, b)) return false;
      pushes.push([b, px, py]);
    }
    for (const r of riders) {
      // a rider squeezed against the ceiling stops the lift
      if (dy > 0 && !this.free(r.x, r.y + dy, r.w, r.h, m, r)) return false;
    }
    m.x = nx; m.y = ny;
    for (const [b, px, py] of pushes) { b.x += px; b.y += py; if (py > 0) b.vy = Math.max(b.vy, 0); }
    for (const r of riders) this.carry(r, dx, dy, m);
    return true;
  }

  private stepHero(h: HeroBody, inp: HeroInput, dt: number) {
    if (!h.alive) return;
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (dir !== 0) h.facing = dir;
    const target = dir * Phys.Run;
    const acc = h.grounded ? (dir !== 0 ? Phys.GroundAcc : Phys.GroundDec) : (dir !== 0 ? Phys.AirAcc : Phys.AirDec);
    h.vx = moveTowards(h.vx, target, acc * dt);
    if (h.pushing && h.grounded) h.vx = clamp(h.vx, -Phys.PushSpeed, Phys.PushSpeed);

    const pressed = inp.jump && !h.jumpHeld;
    h.jumpHeld = inp.jump;
    if (pressed) h.buffer = Phys.Buffer; else h.buffer -= dt;
    if (h.grounded) h.coyote = Phys.Coyote; else h.coyote -= dt;
    if (h.buffer > 0 && h.coyote > 0) {
      h.vy = Phys.JumpV;
      h.buffer = h.coyote = 0;
      h.jumping = true;
      h.grounded = false;
      h.support = null;
      this.events.push({ type: "jump", hero: h.kind });
    }
    if (h.jumping && !inp.jump && h.vy > 0) { h.vy *= Phys.JumpCut; h.jumping = false; }
    if (h.vy <= 0) h.jumping = false;

    h.vy -= Phys.Gravity * dt;
    h.inFan = false;
    for (const f of this.fans) {
      if (this.fanBlocked(f)) continue;
      if (h.x + h.w > f.x + 0.15 && h.x < f.x + 0.85 && h.y < f.top && h.y + h.h > f.y + 1) {
        h.inFan = true;
        if (h.vy < Phys.FanMax) h.vy = Math.min(Phys.FanMax, h.vy + Phys.FanAcc * dt);
        h.jumping = false;
      }
    }
    h.vy = Math.max(h.vy, -Phys.MaxFall);

    h.pushing = false;
    const wantX = h.vx * dt;
    const mx = this.moveX(h, wantX, true);
    if (Math.abs(mx - wantX) > 1e-6 && !h.pushing) h.vx = 0;
    const wantY = h.vy * dt;
    const my = this.moveY(h, wantY);
    if (Math.abs(my - wantY) > 1e-6) {
      if (h.vy < 0) {
        if (h.airTime > 0.12) this.events.push({ type: "land", hero: h.kind, speed: -h.vy });
      } else h.jumping = false;
      h.vy = 0;
    }
  }

  /** A stone slab (mover or block) lying across a vent column stops its wind. */
  fanBlocked(f: Fan) {
    for (const m of this.movers) if (overlap(f.x + 0.15, f.y + 1, 0.7, f.top - f.y - 1, m.x, m.y, m.w, m.h)) return true;
    for (const k of this.blocks) if (overlap(f.x + 0.15, f.y + 1, 0.7, 0.2, k.x, k.y, k.w, k.h)) return true;
    return false;
  }

  private stepBlock(k: Block, dt: number) {
    k.vy = Math.max(k.vy - Phys.Gravity * dt, -Phys.MaxFall);
    const want = k.vy * dt;
    const my = this.moveY(k, want);
    if (Math.abs(my - want) > 1e-6) {
      if (k.vy < -4) this.events.push({ type: "blockLand", x: k.cx, y: k.y, speed: -k.vy });
      k.vy = 0;
    }
  }

  private supportOf(b: Body): Body | Mover | Tile | null {
    const y = b.y - 0.03, x0 = b.x + EPS, w = b.w - 2 * EPS;
    for (const m of this.movers) if (overlap(x0, y, w, 0.03, m.x, m.y, m.w, m.h) && m.y + m.h <= b.y + 0.02) return m;
    for (const k of this.blocks) if (k !== b && overlap(x0, y, w, 0.03, k.x, k.y, k.w, k.h) && k.y + k.h <= b.y + 0.02) return k;
    const cy = Math.floor(b.y - 0.02);
    if (Math.abs(b.y - Math.round(b.y)) < 0.02)
      for (let cx = Math.floor(x0); cx <= Math.floor(x0 + w); cx++) if (this.solidTile(cx, cy)) return this.tile(cx, cy);
    return null;
  }

  private updateSupports() {
    for (const b of this.bodies()) {
      const s = this.supportOf(b);
      b.grounded = s !== null && b.vy <= 0.001;
      b.support = s instanceof Body || s instanceof Mover ? s : null;
      if (b instanceof HeroBody) b.airTime = b.grounded ? 0 : b.airTime + Phys.Dt;
    }
  }

  private checkHeroes() {
    for (const h of this.heroes) {
      if (!h.alive) continue;
      // pools: standing on liquid of the wrong element
      if (h.grounded && !h.support && Math.abs(h.y - Math.round(h.y)) < 0.02) {
        const cy = Math.round(h.y) - 1;
        for (let cx = Math.floor(h.x); cx <= Math.floor(h.x + h.w - EPS); cx++) {
          const t = this.tile(cx, cy);
          if (t !== Tile.Lava && t !== Tile.Water && t !== Tile.Goo) continue;
          const ov = Math.min(h.x + h.w, cx + 1) - Math.max(h.x, cx);
          if (ov >= 0.2 && Sim.deadly(h.kind, t)) { this.kill(h, t); break; }
        }
      }
      if (!h.alive) break;
      for (const g of this.gems) {
        if (g.taken || g.kind !== h.kind) continue;
        if (overlap(h.x, h.y, h.w, h.h, g.x - 0.32, g.y - 0.32, 0.64, 0.64)) {
          g.taken = true;
          this.gemTaken[h.kind]++;
          this.events.push({ type: "gem", hero: h.kind, x: g.x, y: g.y });
        }
      }
      const door = this.doors.find((d) => d.kind === h.kind);
      const inside = !!door && h.grounded && Math.abs(h.cx - (door.x + 0.5)) < 0.3 && Math.abs(h.y - door.y) < 0.05;
      if (inside !== h.inDoor) { h.inDoor = inside; this.events.push({ type: "door", hero: h.kind, inside }); }
    }
    if (this.dead < 0 && this.heroes.every((h) => h.inDoor)) {
      this.won = true;
      this.events.push({ type: "win" });
    }
  }

  kill(h: HeroBody, cause: Tile) {
    if (!h.alive || this.dead >= 0) return;
    h.alive = false;
    this.dead = h.kind;
    this.deathCause = cause;
    this.events.push({ type: "die", hero: h.kind, cause });
  }

  get allGems() { return this.gemTaken[0] + this.gemTaken[1] >= this.gemTotal[0] + this.gemTotal[1]; }
}

// ------------------------------------------------------------------ helpers

export function overlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw - EPS && ax + aw > bx + EPS && ay < by + bh - EPS && ay + ah > by + EPS;
}
function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
function moveTowards(c: number, t: number, d: number) { return Math.abs(t - c) <= d ? t : c + Math.sign(t - c) * d; }

// ------------------------------------------------------------------ validation

/** Structural checks for a level: returns a list of problems (empty = fine). */
export function validateLevel(def: LevelDef): string[] {
  const errs: string[] = [];
  const { W, H, at } = parseLevel(def);
  if (def.map.some((r) => r.length !== W)) errs.push("rows have different lengths");
  const count = (ch: string) => def.map.join("").split(ch).length - 1;
  for (const ch of "12ER") if (count(ch) !== 1) errs.push(`expected exactly one '${ch}', found ${count(ch)}`);
  for (let cy = 0; cy < H; cy++)
    for (let cx = 0; cx < W; cx++) {
      const ch = at(cx, cy);
      const edge = cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1;
      if (edge && ch !== "#" && !(cy === 0 && "LWG^".includes(ch))) errs.push(`border must be wall at ${cx},${cy}`);
      if (!Reserved.includes(ch) && !isTrigger(ch) && !isMover(ch)) errs.push(`unknown tile '${ch}' at ${cx},${cy}`);
      const below = at(cx, cy - 1);
      const solidBelow = "#LWG^".includes(below);
      if ("12ER".includes(ch) && !solidBelow) errs.push(`'${ch}' at ${cx},${cy} needs solid ground below`);
      if ("ER".includes(ch) && at(cx, cy + 1) !== " " && at(cx, cy + 1) !== ".") errs.push(`door '${ch}' needs air above`);
      if (isTrigger(ch)) {
        if (!solidBelow) errs.push(`trigger '${ch}' at ${cx},${cy} needs solid ground below`);
        const drives = def.map.some((r) => r.includes(ch.toUpperCase())) || Object.values(def.movers ?? {}).some((m) => m.trigger === ch);
        if (!drives) errs.push(`trigger '${ch}' controls nothing`);
      }
      if (isMover(ch) && !def.movers?.[ch]) errs.push(`mover '${ch}' has no definition`);
    }
  if (!(def.par > 0)) errs.push("par time missing");
  if (!def.hint) errs.push("hint missing");
  // reachability: gems, doors and triggers share the air region of the spawns (movers and blocks count as air)
  const open = (cx: number, cy: number) => { const ch = at(cx, cy); return !"#LWG^".includes(ch); };
  const reach = new Uint8Array(W * H);
  const stack: [number, number][] = [];
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) if ("12".includes(at(cx, cy))) { reach[cy * W + cx] = 1; stack.push([cx, cy]); }
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || reach[ny * W + nx] || !open(nx, ny)) continue;
      reach[ny * W + nx] = 1;
      stack.push([nx, ny]);
    }
  }
  for (let cy = 0; cy < H; cy++)
    for (let cx = 0; cx < W; cx++) {
      const ch = at(cx, cy);
      if (("rbER".includes(ch) || isTrigger(ch)) && !reach[cy * W + cx]) errs.push(`'${ch}' at ${cx},${cy} is sealed off from the spawns`);
    }
  return errs;
}

// ------------------------------------------------------------------ scripted play (tests, attract mode)

/** What a plan driver needs to see (also sent over from a browser page in end-to-end tests). */
export interface Snap {
  heroes: { x: number; y: number; vx: number; vy: number; grounded: boolean; alive: boolean }[];
  active: Record<string, boolean>;
  movers: Record<string, number>;
  won: boolean;
  dead: number;
}

export function snapshot(sim: Sim): Snap {
  const active: Record<string, boolean> = {}, movers: Record<string, number> = {};
  for (const t of sim.triggers) active[t.letter] = sim.isActive(t.letter);
  for (const m of sim.movers) movers[m.letter] = m.t;
  return {
    heroes: sim.heroes.map((h) => ({ x: h.cx, y: h.y, vx: h.vx, vy: h.vy, grounded: h.grounded, alive: h.alive })),
    active, movers, won: sim.won, dead: sim.dead,
  };
}

interface Act { verb: string; x: number; secs: number; phase: number; t: number; done: boolean }

/**
 * Closed-loop driver for solution plans. A plan is a list of lines; each line runs in order. A line holds
 * actions for Ember ("E ...") and/or Ripple ("R ...") separated by ";" that run in parallel, or a global
 * "wait <s>" / "until <cond>". Actions: go <x> (walk to centre x), jump <x> (jump from the ground, steer to x,
 * done on landing), to <x> (steer to x, also in the air), hold <L|R> <s>, idle <s>. Conditions: on:<a>, off:<a>, mv:<A>>0.9, mv:<A><0.1, won.
 */
export class PlanDriver {
  line = 0;
  private acts: (Act | null)[] = [null, null];
  private cond = "";
  private wait = 0;
  private lineTime = 0;
  failed = "";
  /** Tolerance for "go" (the browser driver has a few frames of latency). */
  tol = 0.12;
  constructor(readonly plan: string[], readonly timeout = 12) { this.load(); }

  get done() { return this.line >= this.plan.length; }

  private load() {
    this.acts = [null, null];
    this.cond = "";
    this.wait = 0;
    this.lineTime = 0;
    if (this.done) return;
    const src = this.plan[this.line].trim();
    if (src.startsWith("wait ")) { this.wait = parseFloat(src.slice(5)); return; }
    if (src.startsWith("until ")) { this.cond = src.slice(6).trim(); return; }
    for (const part of src.split(";")) {
      const tok = part.trim().split(/\s+/);
      const who = tok[0] === "E" ? 0 : tok[0] === "R" ? 1 : -1;
      if (who < 0) { this.failed = `bad plan line "${src}"`; return; }
      const verb = tok[1];
      const a: Act = { verb, x: 0, secs: 0, phase: 0, t: 0, done: false };
      if (verb === "go" || verb === "jump" || verb === "to") a.x = parseFloat(tok[2]);
      else if (verb === "hold") { a.x = tok[2] === "L" ? -1 : 1; a.secs = parseFloat(tok[3]); }
      else if (verb === "idle") a.secs = parseFloat(tok[2] ?? "0");
      else { this.failed = `bad verb "${verb}"`; return; }
      this.acts[who] = a;
    }
  }

  private test(s: Snap) {
    const c = this.cond;
    if (c === "won") return s.won;
    if (c.startsWith("on:")) return !!s.active[c.slice(3)];
    if (c.startsWith("off:")) return !s.active[c.slice(4)];
    const m = /^mv:(\w)([<>])([\d.]+)$/.exec(c);
    if (m) { const v = s.movers[m[1]] ?? 0; return m[2] === ">" ? v > parseFloat(m[3]) : v < parseFloat(m[3]); }
    this.failed = `bad condition "${c}"`;
    return true;
  }

  /** Returns the inputs for both heroes for the next dt seconds. */
  update(s: Snap, dt: number): HeroInput[] {
    const out: HeroInput[] = [{ ...NoInput }, { ...NoInput }];
    if (this.done || this.failed) return out;
    this.lineTime += dt;
    if (this.lineTime > this.timeout) { this.failed = `timeout on line ${this.line + 1}: "${this.plan[this.line]}"`; return out; }
    let finished: boolean;
    if (this.wait > 0 || this.plan[this.line].startsWith("wait")) finished = this.lineTime >= this.wait;
    else if (this.cond) finished = this.test(s);
    else {
      finished = true;
      for (let k = 0; k < 2; k++) {
        const a = this.acts[k];
        if (!a || a.done) continue;
        out[k] = this.act(a, s.heroes[k], dt);
        if (!a.done) finished = false;
      }
    }
    if (finished) { this.line++; this.load(); }
    return out;
  }

  private act(a: Act, h: Snap["heroes"][0], dt: number): HeroInput {
    const inp: HeroInput = { ...NoInput };
    a.t += dt;
    const steer = (x: number, air: boolean) => {
      const d = x - h.x;
      const dec = air ? Phys.AirAcc : Phys.GroundDec;
      const stop = (h.vx * h.vx) / (2 * dec) + Math.abs(h.vx) * 0.03;
      if (Math.abs(d) <= this.tol) { if (air && Math.abs(h.vx) > 1) { inp.left = h.vx > 0; inp.right = h.vx < 0; } return true; }
      if (Math.sign(d) === Math.sign(h.vx) && Math.abs(d) <= stop) { if (air) { inp.left = h.vx > 0; inp.right = h.vx < 0; } return false; }
      inp.right = d > 0; inp.left = d < 0;
      return false;
    };
    switch (a.verb) {
      case "go": {
        const at = steer(a.x, !h.grounded);
        if (at && Math.abs(h.vx) < 0.8 && h.grounded) a.done = true;
        break;
      }
      case "to":
        if (steer(a.x, !h.grounded)) a.done = true;
        break;
      case "jump": {
        if (a.phase === 0) {
          if (h.grounded) { inp.jump = true; a.phase = 1; a.t = 0; steer(a.x, false); }
          break;
        }
        inp.jump = h.vy > 0 || a.t < 0.05;
        steer(a.x, !h.grounded);
        if (a.t > 0.12 && h.grounded && Math.abs(h.vx) < 1.2) a.done = true;
        break;
      }
      case "hold":
        inp.right = a.x > 0; inp.left = a.x < 0;
        if (a.t >= a.secs) a.done = true;
        break;
      case "idle":
        if (a.t >= a.secs) a.done = true;
        break;
    }
    if (!h.alive) a.done = true;
    return inp;
  }
}

/** Runs a plan headless. Returns the finished simulation (check won / dead / gems). */
export function runPlan(def: LevelDef, plan: string[], opts: { latencySteps?: number; maxTime?: number; log?: (s: string) => void } = {}) {
  const sim = new Sim(def);
  const drv = new PlanDriver(plan);
  const lat = Math.max(1, opts.latencySteps ?? 1);
  let inputs: HeroInput[] = [{ ...NoInput }, { ...NoInput }];
  const maxSteps = Math.round((opts.maxTime ?? 120) / Phys.Dt);
  let lastLine = -1, idle = 0;
  for (let i = 0; i < maxSteps && !sim.won && sim.dead < 0 && !drv.failed; i++) {
    if (drv.done && (idle += Phys.Dt) > 3) { drv.failed = "plan finished but the level is not won"; break; }
    if (i % lat === 0) inputs = drv.update(snapshot(sim), Phys.Dt * lat);
    if (opts.log && drv.line !== lastLine) {
      lastLine = drv.line;
      const [e, r] = sim.heroes;
      opts.log(`t=${sim.time.toFixed(2)} line ${drv.line + 1}: E(${e.cx.toFixed(2)},${e.y.toFixed(2)}) R(${r.cx.toFixed(2)},${r.y.toFixed(2)})`);
    }
    sim.step(inputs);
  }
  return { sim, driver: drv };
}
