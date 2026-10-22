import { GameEvents, type GameEvent } from "../../kit/events";

/**
 * The embed bridge: runs only on #/embed/... pages. Inside an iframe it forwards every GameEvent to the host page and
 * takes a few commands back (see docs/EMBED.md):
 *
 *   game → host   { source: "webgames", version: 1, event: GameEvent | { type: "loaded", ... } }
 *   host → game   { source: "webgames-host", command: "pause" | "resume" | "mute" | "unmute" }
 *
 * Mute works for every game without touching them: before any game creates its AudioContext, the bridge swaps in a
 * subclass whose `destination` is a gain node in front of the real speakers, and mute/unmute sets that gain. Nothing
 * is written to the player's saved sound settings.
 */
export const EMBED_SOURCE = "webgames";
export const HOST_SOURCE = "webgames-host";
export const EMBED_VERSION = 1;

export type EmbedCommand = "pause" | "resume" | "mute" | "unmute";
export type EmbedEvent = GameEvent | { type: "loaded"; view: "game" | "portal"; game: string | null; client: string | null };
export interface EmbedMessage { source: typeof EMBED_SOURCE; version: typeof EMBED_VERSION; event: EmbedEvent }

const outputs = new Set<GainNode>();
let installed = false;
let muted = false;

const framed = () => {
  try { return window.parent !== window; } catch { return true; }
};

/** Read-only state for tests and debugging. */
const state = { get muted() { return muted; }, get installed() { return installed; } };

function post(event: EmbedEvent) {
  if (!framed()) return;
  const msg: EmbedMessage = { source: EMBED_SOURCE, version: EMBED_VERSION, event };
  try { window.parent.postMessage(msg, "*"); } catch { /* host gone */ }
}

export function setMuted(on: boolean) {
  muted = on;
  for (const g of outputs) {
    try { g.gain.value = on ? 0 : 1; } catch { /* closed context */ }
  }
}

function patchAudio() {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const wrap = (Base: typeof AudioContext) =>
    class EmbedAudioContext extends Base {
      private embedOut?: GainNode;
      constructor(options?: AudioContextOptions) {
        super(options);
        const out = super.createGain();
        out.gain.value = muted ? 0 : 1;
        out.connect(super.destination);
        this.embedOut = out;
        outputs.add(out);
      }
      // Games connect to ctx.destination; they get the mute gain instead of the speakers.
      get destination(): AudioDestinationNode {
        return (this.embedOut ?? super.destination) as unknown as AudioDestinationNode;
      }
      close() { if (this.embedOut) outputs.delete(this.embedOut); return super.close(); }
    };
  if (w.AudioContext) w.AudioContext = wrap(w.AudioContext);
  if (w.webkitAudioContext) w.webkitAudioContext = wrap(w.webkitAudioContext);
}

/**
 * The running game's pause/resume, loaded lazily: the engine modules are already in memory once a game runs, and a
 * static import would pull Phaser into the site's first download. Lumiloop runs its own state machine (not
 * ArcadeGame); Arrow Puzzle is a turn-based puzzle with nothing to pause.
 */
async function currentGame(): Promise<{ Pause(): void; Resume(): void } | null> {
  if (!GameEvents.game) return null; // no game has booted yet
  if (GameEvents.game === "lumiloop") return (await import("../../games/lumiloop/LumiloopGame")).LumiloopGame.Instance;
  return (await import("../../kit/arcadegame")).ArcadeGame.Current;
}

export function runCommand(command: EmbedCommand) {
  switch (command) {
    case "mute": setMuted(true); break;
    case "unmute": setMuted(false); break;
    case "pause": void currentGame().then((g) => g?.Pause()); break;
    case "resume": void currentGame().then((g) => g?.Resume()); break;
  }
}

/** Idempotent; call before any game boots (the App does it while rendering an embed route). */
export function installEmbedBridge(opts: { muted: boolean; view: "game" | "portal"; game: string | null; client: string | null }) {
  if (installed) return;
  installed = true;
  muted = opts.muted;
  patchAudio();
  document.documentElement.classList.add("embedded");
  (window as unknown as { __webgamesEmbed?: unknown }).__webgamesEmbed = state;
  GameEvents.on(post);
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window.parent) return; // only the page that embeds us (or ourselves when not framed)
    const d = e.data as { source?: unknown; command?: unknown } | null;
    if (!d || typeof d !== "object" || d.source !== HOST_SOURCE) return;
    if (d.command === "pause" || d.command === "resume" || d.command === "mute" || d.command === "unmute") runCommand(d.command);
  });
  post({ type: "loaded", view: opts.view, game: opts.game, client: opts.client });
}
