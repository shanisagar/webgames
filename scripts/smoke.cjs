// Smoke test for one game folder against the dev server (npx vite --port 5173).
// Usage: [SMOKE_URL=http://localhost:5173] NODE_PATH=$(npm root -g) node scripts/smoke.cjs <folder> <outDir> [seconds]
// Opens #/dev/<folder> on a phone and a desktop viewport, presses PLAY, plays with random input,
// saves screenshots and prints page errors. Exit code 1 on any page error.
const { chromium, devices } = require("playwright");

const [folder, outDir = ".", secondsArg = "8"] = process.argv.slice(2);
if (!folder) { console.error("usage: smoke.cjs <folder> <outDir> [seconds]"); process.exit(2); }
const seconds = Number(secondsArg);
/** Dev server to test against (SMOKE_URL=http://localhost:5181 for a private server). */
const BASE = (process.env.SMOKE_URL || "http://localhost:5173").replace(/\/$/, "");

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const errors = [];
  for (const [name, opts] of [["phone", devices["Pixel 7"]], ["desktop", { viewport: { width: 1280, height: 800 } }]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`[${name}] ${e.message}\n${(e.stack || "").split("\n").slice(1, 5).join("\n")}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`[${name}] console: ${m.text().slice(0, 300)}`); });
    await page.goto(`${BASE}/?smoke=${Date.now()}#/dev/${folder}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${outDir}/${folder}-${name}-1-title.png` });
    // press the title screen's primary button (PLAY or the game's PlayLabel)
    const play = await page.evaluate(() => {
      const t = [...document.querySelectorAll('[data-n="Title"] .na-txt span')].find((s) => s.offsetParent && s.closest(".na-button") && /PLAY|START|GO|RACE|BEGIN|INFILTRATE/i.test(s.textContent || "") && !/HOW TO/i.test(s.textContent || ""));
      if (!t) return null;
      const r = t.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: t.textContent };
    });
    if (play) await page.mouse.click(play.x, play.y);
    else errors.push(`[${name}] could not find a PLAY button on the title screen`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${outDir}/${folder}-${name}-2-play.png` });
    const vp = page.viewportSize();
    const end = Date.now() + seconds * 1000;
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "KeyA", "KeyD", "KeyW", "KeyS"];
    let shot = 0;
    while (Date.now() < end) {
      const x = vp.width * (0.15 + Math.random() * 0.7), y = vp.height * (0.25 + Math.random() * 0.6);
      const r = Math.random();
      if (r < 0.45) await page.mouse.click(x, y);
      else if (r < 0.75) {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + (Math.random() - 0.5) * 300, y + (Math.random() - 0.5) * 300, { steps: 6 });
        await page.mouse.up();
      } else await page.keyboard.press(keys[Math.floor(Math.random() * keys.length)]);
      await page.waitForTimeout(150);
      if (Date.now() > end - seconds * 500 && shot === 0) { shot = 1; await page.screenshot({ path: `${outDir}/${folder}-${name}-3-mid.png` }); }
    }
    await page.screenshot({ path: `${outDir}/${folder}-${name}-4-end.png` });
    await ctx.close();
  }
  await browser.close();
  const real = errors.filter((e) => !/GL Driver|GPU stall|willReadFrequently/.test(e));
  if (real.length) { console.log("ERRORS:\n" + real.join("\n")); process.exit(1); }
  console.log(`smoke ok: ${folder} (screenshots in ${outDir})`);
})();
