import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { portalSlugForHost } from "./platform/store";
import { initTelemetry } from "./platform/telemetry";
import { reloadForUpdate } from "./platform/update";

// After a new deploy, a page (or home-screen shortcut) opened earlier still references the previous build's
// chunks, which no longer exist. Reload once to pick up the new build instead of failing.
window.addEventListener("vite:preloadError", (e) => { if (reloadForUpdate()) e.preventDefault(); });

initTelemetry();

// Offline cache (production web only; native apps already ship their files).
const native = (window as unknown as { Capacitor?: { isNativePlatform(): boolean } }).Capacitor?.isNativePlatform();
if (import.meta.env.PROD && !native && "serviceWorker" in navigator) {
  addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => {}); });
}

// A client's custom domain opens their portal (studio hosts resolve instantly without a request).
async function start() {
  if (!location.hash || location.hash === "#/") {
    const slug = await portalSlugForHost(location.hostname);
    if (slug) history.replaceState(null, "", `#/c/${slug}`);
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
