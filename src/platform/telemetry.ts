import { GameEvents, type GameEvent } from "../kit/events";
import { currentClient } from "../kit/theme";

/**
 * Analytics (PostHog) and error reporting (Sentry). Both are off unless their keys are set at build time:
 *   VITE_POSTHOG_KEY (+ optional VITE_POSTHOG_HOST, default EU cloud), VITE_SENTRY_DSN.
 * PostHog is called over its plain HTTP API (no SDK, no cookies); Sentry's SDK only downloads when a DSN is set.
 */
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = ((import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://eu.i.posthog.com").replace(/\/$/, "");
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const RELEASE = (import.meta.env.VITE_RELEASE as string | undefined) ?? "dev";

type Props = Record<string, string | number | boolean | null | undefined>;

function playerId() {
  try {
    let id = localStorage.getItem("site.player");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("site.player", id); }
    return id;
  } catch { return "anonymous"; }
}

function platform() {
  const cap = (window as unknown as { Capacitor?: { getPlatform(): string } }).Capacitor;
  if (cap && cap.getPlatform() !== "web") return cap.getPlatform();
  if (window.parent !== window) return "embed";
  if (matchMedia("(display-mode: standalone)").matches) return "installed";
  return "web";
}

let queue: object[] = [];
let timer = 0;

function flush() {
  timer = 0;
  if (!queue.length || !POSTHOG_KEY) return;
  const body = JSON.stringify({ api_key: POSTHOG_KEY, batch: queue });
  queue = [];
  const url = `${POSTHOG_HOST}/batch/`;
  if (!navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain" }))) {
    fetch(url, { method: "POST", body, keepalive: true }).catch(() => {});
  }
}

/** Records an analytics event (no-op without a PostHog key). */
export function track(event: string, props: Props = {}) {
  if (!POSTHOG_KEY) return;
  queue.push({
    event,
    timestamp: new Date().toISOString(),
    properties: {
      distinct_id: playerId(), $process_person_profile: false, $current_url: location.href, $host: location.host,
      platform: platform(), client: currentClient()?.slug ?? "studio", release: RELEASE, ...props,
    },
  });
  if (queue.length >= 20) flush();
  else if (!timer) timer = window.setTimeout(flush, 4000);
}

function onGameEvent(e: GameEvent) {
  switch (e.type) {
    case "ready": track("game_open", { game: e.game }); break;
    case "start": track("game_start", { game: e.game }); break;
    case "end": track("game_end", { game: e.game, score: e.score, victory: e.victory, stars: e.stars, seconds: e.seconds }); break;
    case "revive": track("game_revive", { game: e.game }); break;
    case "ad": track("ad", { game: e.game, kind: e.kind, outcome: e.outcome }); break;
  }
}

async function startSentry() {
  const errors: unknown[] = [];
  const early = (e: ErrorEvent | PromiseRejectionEvent) => errors.push("reason" in e ? e.reason : e.error);
  addEventListener("error", early);
  addEventListener("unhandledrejection", early);
  const Sentry = await import("@sentry/browser");
  Sentry.init({ dsn: SENTRY_DSN, release: RELEASE, environment: import.meta.env.MODE, sampleRate: 1, tracesSampleRate: 0 });
  Sentry.setTag("platform", platform());
  removeEventListener("error", early);
  removeEventListener("unhandledrejection", early);
  for (const err of errors) Sentry.captureException(err);
  GameEvents.on((e) => { if (e.type === "ready") Sentry.setTag("game", e.game); });
}

export function initTelemetry() {
  if (POSTHOG_KEY) {
    GameEvents.on(onGameEvent);
    let last = "";
    const page = () => {
      const route = location.hash.replace(/\?.*$/, "") || "#/";
      if (route !== last) { last = route; track("$pageview", { route }); }
    };
    page();
    addEventListener("hashchange", page);
    addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  }
  if (SENTRY_DSN) void startSentry();
}
