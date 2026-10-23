import { V2 } from "./math";
import { clientToScreen, overUI, Screen, screenToWorld } from "./input";

/**
 * LiDAR wall input for activation games (a projected wall that players hit with soft balls).
 *
 * LiDAR wall sensors report each ball impact as a short touch on the projected screen (multi-touch HID / TUIO through
 * the sensor's touch driver), so a hit arrives here as a pointer press. A mouse click or a finger on a touch screen
 * works the same, which is how the games are tested and demoed without the kit.
 *
 * A ball can report a burst of touches as it squashes and bounces; presses close in time and space are merged into
 * one hit. Hits on UI (title and result buttons) are left to the UI.
 */
export interface WallHit {
  /** Unity screen point: device px, y up. */
  screen: V2;
  /** World point under the hit (the game camera's coordinates). */
  world: V2;
  /** 0 = left half of the wall, 1 = right half (split-wall games: player 1 left, player 2 right). */
  side: 0 | 1;
  /** Horizontal and vertical position as 0..1 of the wall (0,0 = bottom left). */
  u: number;
  v: number;
  /** performance.now() of the impact. */
  time: number;
}

/** Presses within this many ms and this share of the wall width count as one ball. */
const MERGE_MS = 160;
const MERGE_DIST = 0.06;

let installed = false;
const pending: WallHit[] = [];
const recent: WallHit[] = [];
let lastHitAt = performance.now();

function install() {
  if (installed) return;
  installed = true;
  window.addEventListener("pointerdown", (e) => {
    const el = Screen.el;
    if (!el || !(e.target instanceof Node) || !el.contains(e.target)) return;
    const screen = clientToScreen(e.clientX, e.clientY);
    if (overUI(screen)) return;
    const now = performance.now();
    const u = screen.x / Math.max(1, Screen.width), v = screen.y / Math.max(1, Screen.height);
    while (recent.length && now - recent[0].time > MERGE_MS) recent.shift();
    if (recent.some((h) => Math.hypot(h.u - u, (h.v - v) * Screen.height / Math.max(1, Screen.width)) < MERGE_DIST)) return;
    const hit: WallHit = { screen, world: screenToWorld(screen), side: u < 0.5 ? 0 : 1, u, v, time: now };
    recent.push(hit);
    pending.push(hit);
    lastHitAt = now;
  }, { capture: true });
}

export const WallHits = {
  /** Hits since the last call (call once per frame from Update). */
  take(): WallHit[] {
    install();
    return pending.splice(0, pending.length);
  },
  /** Drop hits that arrived while nothing was listening (for example during a countdown). */
  clear() { install(); pending.length = 0; },
  /** Seconds since the last ball hit: use it to fall back to an attract loop when the wall is left alone. */
  get idleSeconds() { install(); return (performance.now() - lastHitAt) / 1000; },
  /** Test helper: inject a hit at a 0..1 wall position (0,0 = bottom left) as if a ball landed there. */
  simulate(u: number, v: number) {
    install();
    const screen = new V2(u * Screen.width, v * Screen.height);
    const hit: WallHit = { screen, world: screenToWorld(screen), side: u < 0.5 ? 0 : 1, u, v, time: performance.now() };
    pending.push(hit);
    lastHitAt = hit.time;
  },
};

export interface BoardEntry { score: number; label: string; at: number }

/**
 * Event leaderboard: today's best scores for one wall game on this machine (an activation runs on one PC all day).
 * Kept in localStorage per game and per day; shown on the title and result screens.
 */
export const WallBoard = {
  key(game: string) {
    const d = new Date();
    return `wall.${game}.${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  },
  list(game: string, size = 10): BoardEntry[] {
    try { return (JSON.parse(localStorage.getItem(this.key(game)) ?? "[]") as BoardEntry[]).slice(0, size); } catch { return []; }
  },
  /** Adds a score and returns its rank (1 = best today), or 0 when it did not make the board. */
  add(game: string, score: number, label: string, size = 10): number {
    const list = this.list(game, 100);
    const entry = { score, label, at: Date.now() };
    list.push(entry);
    list.sort((a, b) => b.score - a.score || a.at - b.at);
    const rank = list.indexOf(entry) + 1;
    try { localStorage.setItem(this.key(game), JSON.stringify(list.slice(0, size))); } catch { /* storage blocked */ }
    return rank <= size ? rank : 0;
  },
};
