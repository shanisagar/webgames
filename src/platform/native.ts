/**
 * Native app (Capacitor Android / iOS) integration. Call `initNative()` once at app start; on the website it returns
 * immediately and downloads nothing (Capacitor plugins are dynamic imports, and the game engine modules are only
 * imported while a game is mounted, when they are already loaded).
 *
 * - Android back button: in a game → back to its lobby; in a lobby → minimise the app (like the Unity builds).
 * - App sent to the background: pause the running game and its audio (backs up the WebView's own visibilitychange,
 *   which src/kit/host.tsx already handles).
 * - Full screen: status bar hidden (Android navigation bar too, see MainActivity), screen kept awake while a game is
 *   open, normal sleep timeout in the lobby.
 */
// No static imports: this runs at app start on the website too and must not grow its first download.

/** True inside the Capacitor apps (the native bridge injects window.Capacitor before the page loads). */
export const isNativeApp = () =>
  !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

/** Route without the leading "#/", e.g. "", "slide2048", "c/acme", "c/acme/slide2048", "admin". */
const route = () => decodeURIComponent(location.hash.replace(/^#\/?/, "")).replace(/\/$/, "");

/** Where "back" goes from the current page, or null when already on a lobby (then back leaves the app). */
function backTarget(): string | null {
  const parts = route().split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0] === "c") return parts.length > 2 ? `#/c/${parts[1]}` : null;
  return "#/";
}

const gameMounted = () => !!document.querySelector(".na-host");

let started = false;

export async function initNative(): Promise<void> {
  if (started || !isNativeApp()) return;
  started = true;
  document.documentElement.classList.add("na-native");

  const [{ App }, { SystemBars }] = await Promise.all([import("@capacitor/app"), import("@capacitor/core")]);
  const hideBars = () => SystemBars.hide().catch(() => {});
  void hideBars();

  void App.addListener("backButton", () => {
    const target = backTarget();
    if (target) location.hash = target;
    else void App.minimizeApp();
  });

  void App.addListener("appStateChange", async ({ isActive }) => {
    if (isActive) {
      void hideBars();
      void syncWakeLock();
    }
    if (!gameMounted()) return;
    const [{ ArcadeGame }, { Sfx }] = await Promise.all([import("../kit/arcadegame"), import("../kit/sfx")]);
    Sfx.engine.setHidden(!isActive);
    if (!isActive) ArcadeGame.Current?.onFocusLost();
  });

  window.addEventListener("hashchange", () => void syncWakeLock());
  document.addEventListener("visibilitychange", () => void syncWakeLock());
  void syncWakeLock();
}

// Screen Wake Lock API (Android WebView; iOS 18.4+ WKWebView). Where it is missing the system timeout applies.
type WakeLock = { release(): Promise<void>; released: boolean };
let lock: WakeLock | null = null;

async function syncWakeLock() {
  const wl = (navigator as { wakeLock?: { request(type: "screen"): Promise<WakeLock> } }).wakeLock;
  if (!wl) return;
  const want = backTarget() !== null && document.visibilityState === "visible";
  try {
    if (want && (!lock || lock.released)) lock = await wl.request("screen");
    else if (!want && lock) { const l = lock; lock = null; await l.release(); }
  } catch { /* not allowed right now (e.g. page hidden): retried on the next change */ }
}
