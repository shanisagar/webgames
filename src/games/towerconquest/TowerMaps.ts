import { SysRandom, V2 } from "../../kit/math";
import { Kinds, StartTroops } from "./TowerSim";

/**
 * Map generator for Tower Conquest. Maps live in a 9 × 14 portrait field (centre at the origin). Every map is
 * symmetric so it is fair: mirrored left/right for solo maps, point-symmetric for duels and mirrored on both axes for
 * the four-empire free-for-all. Six layout templates (meadow scatter, rings, three lanes, hex field, clusters, spine)
 * give each map a hand-made feel; the campaign mixes solo, duel and free-for-all levels with a rising difficulty.
 */

export const MapW = 9, MapH = 14;
const Margin = new V2(0.85, 0.95);
const MinDist = 1.75;

export enum Play { Solo, Duel, FFA, TwoPlayer }

export interface LevelSpec {
  level: number;
  play: Play;
  diff: number;
  seed: number;
  neutrals: number;
  fortresses: number;
  keepShare: number;
  template: number;
  time: number;
}

export interface MapTower { pos: V2; kind: number; owner: number; troops: number }
export interface Decor { pos: V2; kind: number; scale: number }
export interface MapDef { name: string; template: number; players: number; towers: MapTower[]; decor: Decor[] }

export const TemplateNames = ["MEADOW", "RINGS", "LANES", "HEXFIELD", "CLUSTERS", "SPINE"];
const NamesA = ["EMERALD", "SUNNY", "MISTY", "AMBER", "SILVER", "COPPER", "ROYAL", "WINDY", "GOLDEN", "FROSTY", "MOSSY", "STONY", "CRIMSON", "AZURE", "QUIET", "WILD"];
const NamesB = ["VALE", "FIELDS", "HILLS", "FORDS", "MARCH", "CROSSING", "HEIGHTS", "GLADE", "PLAINS", "RIDGE", "HOLLOW", "BASIN", "DOWNS", "MEADOWS", "PASS", "REACH"];

/** Campaign: solo and duel levels early, a free-for-all every few levels, easy → medium → hard. */
export function campaignSpec(level: number): LevelSpec {
  const L = Math.max(1, level);
  const early: Play[] = [Play.Solo, Play.Solo, Play.Duel, Play.Solo, Play.Duel, Play.Duel, Play.Solo, Play.Duel, Play.Duel, Play.FFA];
  const play = L <= early.length ? early[L - 1] : [Play.Solo, Play.Duel, Play.Duel, Play.FFA][(L - 11) % 4];
  let diff = L < 8 ? 0 : L < 20 ? 1 : 2;
  if (play === Play.FFA) diff = L < 16 ? 0 : L < 28 ? 1 : 2;
  const seed = 1000 + L * 7919;
  const template = L <= 2 ? 0 : (L * 5 + 3) % TemplateNames.length;
  let neutrals: number, fortresses: number;
  if (play === Play.Solo) { neutrals = Math.min(15, 3 + Math.floor(L / 2)); fortresses = L >= 7 ? (L >= 23 ? 2 : 1) : 0; }
  else if (play === Play.Duel) { neutrals = Math.min(16, 6 + Math.floor(L / 3)); fortresses = L >= 5 ? 1 : 0; }
  else { neutrals = Math.min(16, 8 + Math.floor(L / 8) * 4); fortresses = 1; }
  const keepShare = L <= 2 ? 0 : Math.min(0.45, 0.18 + L * 0.012);
  return { level: L, play, diff, seed, neutrals, fortresses, keepShare, template, time: 120 };
}

/** Quick battles from the title screen (random map each time). */
export function quickSpec(play: Play, diff: number, seed: number): LevelSpec {
  const rng = new SysRandom(seed);
  const neutrals = play === Play.FFA ? 12 : 8 + rng.next(4) * 2;
  return { level: 0, play, diff, seed, neutrals, fortresses: 1, keepShare: 0.3, template: rng.next(TemplateNames.length), time: 120 };
}

export function playersOf(play: Play) { return play === Play.Solo ? 1 : play === Play.FFA ? 4 : 2; }

/** Symmetric images of a point for the map's symmetry group (de-duplicated, snapped onto the axes). */
function orbit(p: V2, play: Play): V2[] {
  const snapX = Math.abs(p.x) < 0.7, snapY = Math.abs(p.y) < 0.7;
  const q = new V2(snapX ? 0 : p.x, snapY ? 0 : p.y);
  const pts: V2[] = [q];
  const add = (v: V2) => { if (!pts.some((o) => V2.distance(o, v) < 0.05)) pts.push(v); };
  if (play === Play.Solo) add(new V2(-q.x, q.y));
  else if (play === Play.FFA) { add(new V2(-q.x, q.y)); add(new V2(q.x, -q.y)); add(new V2(-q.x, -q.y)); }
  else add(new V2(-q.x, -q.y));
  return pts;
}

function inBounds(p: V2) { return Math.abs(p.x) <= MapW / 2 - Margin.x && Math.abs(p.y) <= MapH / 2 - Margin.y; }

function candidates(template: number, rng: SysRandom): V2[] {
  const out: V2[] = [];
  const hx = MapW / 2 - Margin.x, hy = MapH / 2 - Margin.y;
  const jitter = (v: V2, a: number) => v.add(new V2((rng.nextDouble() - 0.5) * a, (rng.nextDouble() - 0.5) * a));
  switch (template) {
    case 1: { // rings
      const ph = rng.nextDouble() * Math.PI;
      out.push(V2.zero);
      for (const [r, n] of [[2.1, 6], [3.9, 10], [5.4, 12]] as [number, number][])
        for (let i = 0; i < n; i++) {
          const a = ph + (i * Math.PI * 2) / n;
          out.push(jitter(new V2(Math.cos(a) * r * 0.72, Math.sin(a) * r * 1.12), 0.3));
        }
      break;
    }
    case 2: // three lanes
      out.push(V2.zero);
      for (let y = -5.6; y <= 5.6; y += 1.9)
        for (const x of [-2.9, 0, 2.9]) out.push(jitter(new V2(x, y + (x === 0 ? 0.95 : 0)), 0.5));
      break;
    case 3: { // hex field
      const s = 2.15, ox = rng.nextDouble() * s, oy = rng.nextDouble() * s;
      for (let j = -5; j <= 5; j++)
        for (let i = -4; i <= 4; i++) out.push(jitter(new V2(i * s + (j & 1 ? s / 2 : 0) + ox - s, j * s * 0.87 + oy - s), 0.25));
      break;
    }
    case 4: { // clusters
      out.push(V2.zero);
      for (let c = 0; c < 6; c++) {
        const cc = new V2((rng.nextDouble() * 2 - 1) * hx * 0.85, (rng.nextDouble() * 2 - 1) * hy * 0.85);
        for (let k = 0; k < 4; k++) out.push(cc.add(V2.fromAngle(rng.nextDouble() * Math.PI * 2, 1.8 + rng.nextDouble() * 0.5)));
        out.push(cc);
      }
      break;
    }
    case 5: // spine with branches
      for (let y = -5.5; y <= 5.5; y += 1.85) {
        out.push(jitter(new V2(0, y), 0.3));
        out.push(jitter(new V2(2.6 + rng.nextDouble() * 0.8, y + 0.9), 0.4));
      }
      break;
    default: break;
  }
  for (let i = 0; i < 160; i++) out.push(new V2((rng.nextDouble() * 2 - 1) * hx, (rng.nextDouble() * 2 - 1) * hy));
  // keep the template's structure first but vary which of its points are used
  const head = out.slice(0, out.length - 160), tail = out.slice(out.length - 160);
  for (let i = head.length - 1; i > 0; i--) { const j = rng.next(i + 1); [head[i], head[j]] = [head[j], head[i]]; }
  if (template !== 0) head.sort((a, b) => (a.magnitude < 0.3 ? -1 : b.magnitude < 0.3 ? 1 : 0));
  return head.concat(tail);
}

export function buildMap(spec: LevelSpec): MapDef {
  const rng = new SysRandom(spec.seed);
  const play = spec.play === Play.TwoPlayer ? Play.Duel : spec.play;
  const players = playersOf(play);
  const starts: V2[] = [];
  if (play === Play.Solo) starts.push(new V2(0, -5.4));
  else if (play === Play.Duel) { const sx = (rng.nextDouble() * 2 - 1) * 2.4; starts.push(new V2(sx, -5.5), new V2(-sx, 5.5)); }
  else starts.push(new V2(-2.6, -5.4), new V2(2.6, 5.4), new V2(-2.6, 5.4), new V2(2.6, -5.4));

  const towers: MapTower[] = starts.map((p, i) => ({ pos: p, kind: 1, owner: i, troops: StartTroops }));
  const orbits: V2[][] = [];
  const placed: V2[] = [...starts];
  let count = 0;
  for (const c of candidates(spec.template, rng)) {
    if (count >= spec.neutrals) break;
    const o = orbit(c, play);
    if (!o.every(inBounds)) continue;
    if (o.length > 1 && o.some((a, i) => o.some((b, j) => j > i && V2.distance(a, b) < MinDist))) continue;
    if (!o.every((p) => placed.every((q) => V2.distance(p, q) >= (starts.includes(q) ? 2.1 : MinDist)))) continue;
    if (count + o.length > spec.neutrals + (play === Play.FFA ? 3 : 1)) continue;
    orbits.push(o);
    placed.push(...o);
    count += o.length;
  }
  // kinds: fortresses nearest the middle, keeps at mid range, outposts elsewhere
  const order = orbits.map((o, i) => ({ i, d: o[0].magnitude })).sort((a, b) => a.d - b.d);
  const kinds = new Array<number>(orbits.length).fill(0);
  let fort = spec.fortresses;
  for (const { i } of order) {
    if (fort <= 0) break;
    if (orbits[i].length > 2 && fort < orbits[i].length) continue;
    kinds[i] = 2;
    fort -= orbits[i].length;
  }
  const keepTarget = Math.round(count * spec.keepShare);
  let keeps = 0;
  const mid = order.filter(({ i }) => kinds[i] === 0).sort(() => rng.nextDouble() - 0.5);
  for (const { i } of mid) {
    if (keeps >= keepTarget) break;
    kinds[i] = 1;
    keeps += orbits[i].length;
  }
  orbits.forEach((o, i) => { for (const p of o) towers.push({ pos: p, kind: kinds[i], owner: -1, troops: Kinds[kinds[i]].neutral }); });

  const decor: Decor[] = [];
  for (let tries = 0; tries < 400 && decor.length < 22; tries++) {
    const p = new V2((rng.nextDouble() * 2 - 1) * (MapW / 2 - 0.4), (rng.nextDouble() * 2 - 1) * (MapH / 2 - 0.4));
    if (towers.some((t) => V2.distance(t.pos, p) < 1.05) || decor.some((d) => V2.distance(d.pos, p) < 0.7)) continue;
    decor.push({ pos: p, kind: rng.next(4), scale: 0.7 + rng.nextDouble() * 0.5 });
  }
  const name = NamesA[(spec.seed >>> 3) % NamesA.length] + " " + NamesB[(spec.seed >>> 7) % NamesB.length];
  return { name, template: spec.template, players, towers, decor };
}
