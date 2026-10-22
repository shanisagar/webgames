import { GameEvents } from "./events";
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
 *
 * Native backend: inside the Capacitor Android / iOS apps (docs/NATIVE-APPS.md) AdMob is used automatically, like the
 * Unity mobile builds (AdMobBackend.cs): UMP consent first, interstitial + rewarded preloaded and reloaded after every
 * show. The plugin is loaded with a dynamic import, so the website never downloads it.
 */

/** Google's sample AdMob units: always fill with test ads, safe to click. */
const ADMOB_TEST = {
  androidInterstitial: "ca-app-pub-3940256099942544/1033173712",
  androidRewarded: "ca-app-pub-3940256099942544/5224354917",
  iosInterstitial: "ca-app-pub-3940256099942544/4411468910",
  iosRewarded: "ca-app-pub-3940256099942544/1712485313",
};

export const AdConfig = {
  /**
   * "h5" = Google H5 Games Ads, "test" = fake ads with a countdown (development), "none" = ads off.
   * In the native apps any value except "none" means AdMob ("admob" can also be set explicitly; on the web it is off).
   */
  provider: (import.meta.env.DEV ? "test" : "h5") as "h5" | "test" | "admob" | "none",
  client: "ca-pub-2503823450887306",
  /** Google test ads until AdSense approves H5 games ads for the site. Set false after approval. */
  testMode: true,
  frequencyHint: "120s",
  // NeonArcadeAds.asset values
  interstitialEveryRuns: 3,
  minSecondsBetweenAds: 120,
  graceRuns: 3,
  /**
   * AdMob (native apps only), from the Unity project's NeonArcadeAds.asset. The *application* ids are compiled into
   * the native projects (android strings.xml admob_app_id, iOS Info.plist GADApplicationIdentifier) and are listed
   * here for reference only. The Unity build shipped Google's sample interstitial/rewarded units: create real units
   * in AdMob and paste them here.
   */
  admob: {
    android: {
      appId: "ca-app-pub-2503823450887306~9616402008",
      interstitial: ADMOB_TEST.androidInterstitial,
      rewarded: ADMOB_TEST.androidRewarded,
    },
    ios: {
      appId: "ca-app-pub-3940256099942544~1458002511", // Google's test app id: no iOS app in AdMob yet
      interstitial: ADMOB_TEST.iosInterstitial,
      rewarded: ADMOB_TEST.iosRewarded,
    },
    /** Test ads (the plugin swaps in Google's sample units). null = follow `testMode` above. */
    testMode: null as boolean | null,
    /** Devices that always get test ads (id printed in logcat / Xcode console on first ad request). */
    testDeviceIds: ["3C503CFA003B6B174807825C47CE711F"],
    childDirected: false,
    underAgeOfConsent: false,
  },
};

/** "android" / "ios" inside the Capacitor apps, null on the web. Reads the bridge Capacitor injects before the page
 * loads, so the web bundle needs no Capacitor code. */
export function nativePlatform(): "android" | "ios" | null {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const p = cap.getPlatform?.();
  return p === "android" || p === "ios" ? p : null;
}

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

/**
 * Google AdMob via @capacitor-community/admob (native apps). Mirrors AdMobBackend.cs: UMP consent, then the SDK;
 * one interstitial and one rewarded ad are kept loaded, reloaded after every show, failed loads retry with backoff.
 * `closed` / `done` are always called, so games never get stuck.
 */
type AdMobModule = typeof import("@capacitor-community/admob");
const AdMobAds: Backend & { showPrivacyOptions(done?: () => void): void } = (() => {
  let m: AdMobModule | null = null;
  let started = false;
  const loaded = { interstitial: false, rewarded: false };
  const loading = { interstitial: false, rewarded: false };
  const failures = { interstitial: 0, rewarded: 0 };
  let finish: ((earned: boolean) => void) | null = null; // the full-screen ad being shown
  let earned = false;
  let opened = false; // the SDK reported the ad on screen

  const units = () => (nativePlatform() === "ios" ? AdConfig.admob.ios : AdConfig.admob.android);
  const testing = () => AdConfig.admob.testMode ?? AdConfig.testMode;
  const backoff = (n: number) => Math.min(64, 2 ** (n + 1)) * 1000; // 4 s, 8 s ... 64 s
  const warn = (...a: unknown[]) => console.warn("[Ads]", ...a);

  function load(kind: "interstitial" | "rewarded") {
    if (!m || loaded[kind] || loading[kind]) return;
    loading[kind] = true;
    const opts = { adId: units()[kind], isTesting: testing(), immersiveMode: true };
    (kind === "interstitial" ? m.AdMob.prepareInterstitial(opts) : m.AdMob.prepareRewardVideoAd(opts)).then(
      () => { loading[kind] = false; loaded[kind] = true; failures[kind] = 0; },
      (e) => {
        loading[kind] = false;
        warn(kind, "failed to load:", e?.message ?? e);
        setTimeout(() => load(kind), backoff(failures[kind]++));
      },
    );
  }

  function closeShown() {
    const f = finish;
    finish = null;
    f?.(earned);
  }

  async function start(done: (ok: boolean) => void) {
    if (started) return;
    started = true;
    const { AdMob, InterstitialAdPluginEvents: I, RewardAdPluginEvents: R, MaxAdContentRating } = m!;
    const cfg = AdConfig.admob;
    await AdMob.initialize({
      testingDevices: cfg.testDeviceIds,
      initializeForTesting: cfg.testDeviceIds.length > 0,
      tagForChildDirectedTreatment: cfg.childDirected,
      tagForUnderAgeOfConsent: cfg.underAgeOfConsent,
      maxAdContentRating: cfg.childDirected ? MaxAdContentRating.General : undefined,
    });
    void AdMob.addListener(I.Dismissed, closeShown);
    void AdMob.addListener(I.FailedToShow, closeShown);
    void AdMob.addListener(I.Showed, () => { opened = true; });
    void AdMob.addListener(R.Showed, () => { opened = true; });
    void AdMob.addListener(R.Rewarded, () => { earned = true; });
    // The reward callback can land just after the dismissal: give it a moment before reporting the result.
    void AdMob.addListener(R.Dismissed, () => setTimeout(closeShown, 250));
    void AdMob.addListener(R.FailedToShow, closeShown);
    load("interstitial");
    load("rewarded");
    done(true);
  }

  async function consentThenStart(done: (ok: boolean) => void, attempt = 0) {
    const { AdMob, AdmobConsentStatus } = m!;
    try {
      let info = await AdMob.requestConsentInfo({
        tagForUnderAgeOfConsent: AdConfig.admob.underAgeOfConsent,
        testDeviceIdentifiers: AdConfig.admob.testDeviceIds,
      });
      if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) info = await AdMob.showConsentForm();
      AdService.privacyOptionsRequired = String(info.privacyOptionsRequirementStatus) === "REQUIRED";
      if (!info.canRequestAds) { warn("consent not given: no ads will be requested"); done(false); return; }
      await start(done);
    } catch (e) {
      // Usually offline at launch: ads stay off and consent is asked again a little later.
      warn("consent / init failed:", (e as Error)?.message ?? e);
      done(false);
      if (attempt < 5) setTimeout(() => void consentThenStart(done, attempt + 1), backoff(attempt + 2));
    }
  }

  function show(kind: "interstitial" | "rewarded", cb: (earned: boolean) => void) {
    if (!m || !loaded[kind]) { cb(false); load(kind); return; }
    loaded[kind] = false;
    earned = opened = false;
    const f = (finish = (e) => { cb(kind === "rewarded" && e); load(kind); });
    const shown = kind === "interstitial" ? m.AdMob.showInterstitial() : m.AdMob.showRewardVideoAd();
    shown.catch((e) => { warn(kind, "failed to show:", e?.message ?? e); closeShown(); });
    // Never leave the game waiting if the ad silently fails to appear.
    setTimeout(() => { if (finish === f && !opened) closeShown(); }, 8000);
  }

  return {
    init(done) {
      import("@capacitor-community/admob").then(
        (mod) => { m = mod; void consentThenStart(done); },
        (e) => { warn("AdMob plugin missing:", e); done(false); },
      );
    },
    ready: (kind) => loaded[kind],
    showInterstitial(closed) { show("interstitial", () => closed()); },
    showRewarded(done) { show("rewarded", done); },
    showPrivacyOptions(done) {
      if (!m) { done?.(); return; }
      m.AdMob.showPrivacyOptionsForm().catch((e) => warn("privacy options:", e)).finally(() => done?.());
    },
  };
})();

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
  /** The web has no consent form of its own (AdSense shows Google's CMP when the site enables it). In the apps, true
   * when AdMob's UMP says the player must be offered a "Privacy options" entry (EEA/UK): call showPrivacyOptions. */
  privacyOptionsRequired: false,
  bannersEnabled: false,

  /** Safe to call from every game; only the first call does anything. */
  init() {
    if (initStarted) return;
    initStarted = true;
    const p = AdConfig.provider;
    backend = p === "none" ? null : nativePlatform() ? AdMobAds : p === "h5" ? H5 : p === "test" ? TestAds : null;
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
    GameEvents.emit({ type: "ad", game: GameEvents.game, kind: "interstitial", outcome: "shown" });
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
    if (!AdService.rewardedAvailable) {
      GameEvents.emit({ type: "ad", game: GameEvents.game, kind: "rewarded", outcome: "unavailable" });
      done(false);
      return;
    }
    begin();
    backend!.showRewarded((earned) => {
      end();
      GameEvents.emit({ type: "ad", game: GameEvents.game, kind: "rewarded", outcome: earned ? "rewarded" : "skipped" });
      done(earned);
    });
  },

  setBannerVisible(_visible: boolean) { /* banners live on the website, outside games */ },
  showPrivacyOptions(done?: () => void) {
    if (backend === AdMobAds) AdMobAds.showPrivacyOptions(done);
    else done?.();
  },
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
