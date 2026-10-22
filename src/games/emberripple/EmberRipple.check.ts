/**
 * Level check for EMBER & RIPPLE (headless, no browser):
 *   npx esbuild src/games/emberripple/EmberRipple.check.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/er-check.mjs --log-level=warning && node node_modules/.cache/er-check.mjs
 * 1. Structure: every map is rectangular with a wall border, exactly one start and one door per spirit on solid
 *    ground, defined movers, triggers that drive something, and every gem / door / trigger in the spawns' air region.
 * 2. Play: each level's solution plan (EmberRipplePlans.ts) is driven through the real simulation with scripted
 *    inputs, both with per-step input and with 4-step input latency (like a real keyboard), and must win with every
 *    gem. 3. Physics sanity: no tunnelling through floors at max fall speed, coyote time, jump buffering, variable
 *    jump height and that the wrong pool kills.
 */
import { LEVELS } from "./EmberRippleLevels";
import { PLANS } from "./EmberRipplePlans";
import { Hero, NoInput, Phys, runPlan, Sim, validateLevel, type HeroInput, type LevelDef } from "./EmberRippleSim";

let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { fails++; console.log("FAIL: " + msg); } };

// ---- 1 + 2: every level
LEVELS.forEach((def, i) => {
  const n = i + 1;
  const errs = validateLevel(def);
  check(errs.length === 0, `level ${n} "${def.name}" structure: ${errs.join("; ")}`);
  const plan = PLANS[i];
  check(!!plan, `level ${n} has a solution plan`);
  if (!plan) return;
  for (const latency of [1, 4]) {
    const { sim, driver } = runPlan(def, plan, { latencySteps: latency });
    const gems = `${sim.gemTaken[0] + sim.gemTaken[1]}/${sim.gemTotal[0] + sim.gemTotal[1]}`;
    check(sim.won, `level ${n} not completed (latency ${latency}): ${driver.failed || (sim.dead >= 0 ? "a spirit died" : "not won")} at ${sim.time.toFixed(1)}s`);
    check(sim.allGems, `level ${n} (latency ${latency}) left gems behind: ${gems}`);
    if (latency === 1) console.log(`level ${String(n).padStart(2)} ${def.name.padEnd(22)} solved in ${sim.time.toFixed(1).padStart(5)}s (par ${def.par}s), gems ${gems}`);
  }
});

// ---- 3: physics
const flat = (rows: string[]): LevelDef => ({ name: "t", par: 10, hint: "t", map: rows });
const box = flat([
  "##########",
  "#        #",
  "#        #",
  "#        #",
  "#        #",
  "#        #",
  "#12    ER#",
  "##WWLLGG##",
]);
const steps = (sim: Sim, n: number, inp: HeroInput[] = [NoInput, NoInput]) => { for (let i = 0; i < n; i++) sim.step(inp); };
{
  // no tunnelling: drop from the top at max fall speed many times
  const s = new Sim(box);
  for (let k = 0; k < 50; k++) {
    s.heroes[0].y = 5.9; s.heroes[0].vy = -Phys.MaxFall;
    steps(s, 60);
    check(s.heroes[0].y >= 1 - 1e-6, `fell through the floor: y=${s.heroes[0].y}`);
  }
}
{
  // variable jump: a tap jumps lower than a held jump
  const peak = (holdSteps: number) => {
    const s = new Sim(box);
    let top = 0;
    for (let i = 0; i < 120; i++) { s.step([{ ...NoInput, jump: i < holdSteps }, NoInput]); top = Math.max(top, s.heroes[0].y); }
    return top - 1;
  };
  const tap = peak(4), full = peak(120);
  check(full > 2.1 && full < 2.6, `full jump height ${full.toFixed(2)} should clear 2 tiles but not 3`);
  check(tap < full * 0.7, `tap jump ${tap.toFixed(2)} should be lower than held jump ${full.toFixed(2)}`);
}
{
  // jump buffering: pressing jump just before landing still jumps
  const s = new Sim(box);
  s.heroes[0].y = 1.6; s.heroes[0].vy = -6;
  let jumped = false;
  for (let i = 0; i < 40; i++) { s.step([{ ...NoInput, jump: i >= 2 }, NoInput]); if (s.events.some((e) => e.type === "jump")) jumped = true; }
  check(jumped, "jump buffering: a press just before landing should jump");
  // coyote time: jumping a few steps after walking off a ledge still works
  const c = new Sim(flat(["#######", "#     #", "#     #", "#12   #", "###   #", "#   ER#", "#######"]));
  const e = c.heroes[0];
  let left = -1, jumpedAfter = -1;
  for (let i = 0; i < 120 && jumpedAfter < 0; i++) {
    const press = left >= 0 && i - left === 6;
    c.step([{ left: false, right: true, jump: press }, NoInput]);
    if (left < 0 && !e.grounded && e.vy <= 0) left = i;
    if (c.events.some((ev) => ev.type === "jump")) jumpedAfter = i;
  }
  check(jumpedAfter > 0, "coyote time: a jump 6 steps after leaving the ledge should still work");
}
{
  // pools: Ember wades lava, dies in water; Ripple the other way round; goo kills both
  const at = (kind: Hero, x: number) => {
    const s = new Sim(box);
    const h = s.heroes[kind];
    h.x = x - h.w / 2; h.y = 1;
    steps(s, 5);
    return s.dead === kind;
  };
  check(!at(Hero.Ember, 4.5) && at(Hero.Ember, 2.5) && at(Hero.Ember, 6.5), "Ember: safe in lava, dies in water and goo");
  check(!at(Hero.Ripple, 2.5) && at(Hero.Ripple, 4.5) && at(Hero.Ripple, 6.5), "Ripple: safe in water, dies in lava and goo");
}

console.log(fails ? `${fails} check(s) failed` : `all ${LEVELS.length} levels valid and solvable with every gem; physics checks passed`);
(globalThis as { process?: { exit(code: number): void } }).process?.exit(fails ? 1 : 0);
