/**
 * Game lifecycle events for the platform (embed postMessage API, analytics). Games emit through the ArcadeGame state
 * machine; games with their own engines (Arrow Puzzle, Lumiloop) call GameEvents.emit themselves.
 */
export type GameEvent =
  | { type: "ready"; game: string }
  | { type: "start"; game: string }
  | { type: "end"; game: string; score: number | null; victory: boolean; stars: number | null; seconds: number }
  | { type: "revive"; game: string }
  | { type: "pause"; game: string }
  | { type: "resume"; game: string }
  | { type: "ad"; game: string; kind: "interstitial" | "rewarded"; outcome: "shown" | "rewarded" | "skipped" | "unavailable" };

type Listener = (e: GameEvent) => void;
const listeners = new Set<Listener>();
let currentGame = "";

export const GameEvents = {
  get game() { return currentGame; },
  setGame(id: string) { currentGame = id; },
  on(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  emit(e: GameEvent) {
    for (const fn of listeners) {
      try { fn(e); } catch (err) { console.error(err); }
    }
  },
};

/** Best-effort numeric score from a result value like "12,830" or "1:05.3" (times count as seconds). */
export function parseScore(value: string, countTo: number): number | null {
  if (countTo >= 0) return countTo;
  const v = value.replace(/,/g, "").trim();
  const t = /^(\d+):(\d+(?:\.\d+)?)$/.exec(v);
  if (t) return Number(t[1]) * 60 + Number(t[2]);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
