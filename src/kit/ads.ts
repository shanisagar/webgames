import { PlayerPrefs } from "./prefs";
import { Sfx } from "./sfx";
import { Time } from "./scene";

/**
 * Game-facing ad API shared by every game (AdService.cs), with the Unity project's player-friendly rules:
 * rewarded ads are always opt-in (revive, hints, boosters); interstitials only appear when leaving a result screen,
 * never during play, never in a new player's first runs, at most every N runs and N seconds apart.
 *
 * Web backend: Google H5 Games Ads (AdSense Ad Placement API: adBreak / adConfig), the same provider the Unity WebGL
 * builds used via web-ads.js. AdMob is native-only, so on the web AdSense serves both interstitials and rewarded ads.
 * Display banners live on the website pages, never over a game.
 */

export const AdConfig = {
  /** "h5" = Google H5 Games Ads, "test" = fake ads with a countdown (development), "none" = ads off. */
  provider: (import.meta.env.DEV ? "test" : "h5") as "h5" | "test" | "none",
  client: "ca-pub-2503823450887306",
  /** Google test ads until AdSense approves H5 games ads for the site. Set false after approval. */
  testMode: true,
  frequencyHint: "120s",
  // NeonArcadeAds.asset values
  interstitialEveryRuns: 3,
  minSecondsBetweenAds: 120,
  graceRuns: 3,
};

interface Backend {
  init(done: (ok: boolean) => void): void;
  ready(kind: "interstitial" | "rewarded"): boolean;
  showInterstitial(closed: () => void): void;
  showRewarded(done: (earned: boolean) => void): void;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
    adBreak?: (o: Record<string, unknown>) => void;
    adConfig?: (o: Record<string, unknown>) => void;
  }
}

/** Google H5 Games Ads. adBreakDone is always called, even when no ad was available, so games never get stuck. */
const H5: Backend & { ok: boolean } = {
  ok: false,
  init(done) {
    if (document.querySelector("script[data-na-h5]")) { done(H5.ok); return; }
    window.adsbygoogle = window.adsbygoogle || [];
    window.adBreak = window.adConfig = (o) => { window.adsbygoogle!.push(o); };
    const s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.dataset.naH5 = "1";
    s.setAttribute("data-ad-frequency-hint", AdConfig.frequencyHint);
    if (AdConfig.testMode) s.setAttribute("data-adbreak-test", "on");
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(AdConfig.client);
    s.onload = () => {
      window.adConfig!({ preloadAdBreaks: "on", sound: "on", onReady: () => { H5.ok = true; } });
      H5.ok = true;
      done(true);
    };
    s.onerror = () => done(false); // ad blockers: ads stay off, the game carries on
    document.head.appendChild(s);
  },
  ready: () => H5.ok,
  showInterstitial(closed) {
    window.adBreak!({ type: "next", name: "between_runs", adBreakDone: () => closed() });
  },
  showRewarded(done) {
    let earned = false;
    window.adBreak!({
      type: "reward",
      name: "reward",
      beforeReward: (showAdFn: () => void) => showAdFn(), // the player already opted in with the in-game button
      adViewed: () => { earned = true; },
      adDismissed: () => { earned = false; },
      adBreakDone: () => done(earned),
    });
  },
};

/** Fake ads for development: a dark overlay with a countdown. */
const TestAds: Backend = {
  init: (done) => done(true),
  ready: () => true,
  showInterstitial(closed) { showTest(false, () => closed()); },
  showRewarded(done) { showTest(true, done); },
};

function showTest(rewarded: boolean, done: (earned: boolean) => void) {
  const layer = document.createElement("div");
  layer.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;font:600 18px system-ui,sans-serif;text-align:center";
  let t = rewarded ? 5 : 3, earned = false;
  layer.innerHTML = `<div><div style="font-size:13px;letter-spacing:.12em;opacity:.6">TEST AD</div><div style="font-size:26px;margin:8px 0 18px">${rewarded ? "Rewarded video" : "Interstitial"}</div><div data-c></div><button style="margin-top:18px;padding:10px 22px;border-radius:999px;border:1px solid #fff4;background:#fff1;color:#fff;font:inherit;cursor:pointer">${rewarded ? "Skip (no reward)" : "Close"}</button></div>`;
  document.body.appendChild(layer);
  const count = layer.querySelector("[data-c]")!, btn = layer.querySelector("button")!;
  const label = () => (count.textContent = t > 0 ? (rewarded ? "Reward in " : "Close in ") + t : rewarded ? "Reward earned!" : "");
  label();
  const timer = setInterval(() => { t--; label(); if (t <= 0) { clearInterval(timer); earned = rewarded; btn.textContent = "Close"; } }, 1000);
  btn.onclick = () => { clearInterval(timer); layer.remove(); done(earned); };
}

const RUNS_KEY = "arcade.ads.runs";
let backend: Backend | null = null;
let initStarted = false;
let ready = false;
let runsSinceInterstitial = 0;
let lastFullscreen = -9999;

export const AdService = {
  isShowing: false,
  get active() { return backend !== null; },
  get ready() { return ready; },
  /** True once a game has initialized ads (the provider and publisher can't change without a page reload). */
  get started() { return initStarted; },
  get rewardedAvailable() { return ready && !AdService.isShowing && !!backend && backend.ready("rewarded"); },
  /** The web has no consent form of its own (AdSense shows Google's CMP when the site enables it). */
  privacyOptionsRequired: false,
  bannersEnabled: false,

  /** Safe to call from every game; only the first call does anything. */
  init() {
    if (initStarted) return;
    initStarted = true;
    backend = AdConfig.provider === "h5" ? H5 : AdConfig.provider === "test" ? TestAds : null;
    backend?.init((ok) => { ready = ok; });
  },

  /** Call whenever a run (game, race, match, level) ends. */
  runEnded() {
    runsSinceInterstitial++;
    PlayerPrefs.setInt(RUNS_KEY, PlayerPrefs.getInt(RUNS_KEY, 0) + 1);
  },

  /** Leaving a result screen: shows an interstitial if the frequency rules allow, then runs `proceed`. */
  betweenRuns(proceed: () => void) {
    if (!AdService.canShowInterstitial()) { proceed(); return; }
    runsSinceInterstitial = 0;
    begin();
    backend!.showInterstitial(() => { end(); proceed(); });
  },

  canShowInterstitial() {
    if (!ready || AdService.isShowing || !backend || !backend.ready("interstitial")) return false;
    if (PlayerPrefs.getInt(RUNS_KEY, 0) < AdConfig.graceRuns) return false;
    if (runsSinceInterstitial < AdConfig.interstitialEveryRuns) return false;
    return Time.realtimeSinceStartup - lastFullscreen >= AdConfig.minSecondsBetweenAds;
  },

  /** Opt-in rewarded ad. `done` gets true only if the reward was earned. */
  showRewarded(done: (earned: boolean) => void) {
    if (!AdService.rewardedAvailable) { done(false); return; }
    begin();
    backend!.showRewarded((earned) => { end(); done(earned); });
  },

  setBannerVisible(_visible: boolean) { /* banners live on the website, outside games */ },
  showPrivacyOptions(done?: () => void) { done?.(); },
};

function begin() {
  AdService.isShowing = true;
  Sfx.engine.paused = true;
}

function end() {
  AdService.isShowing = false;
  Sfx.engine.paused = false;
  lastFullscreen = Time.realtimeSinceStartup;
}
