import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native Android / iOS shells around the web build (dist/). See docs/NATIVE-APPS.md.
 *
 * The bundle id is fixed once the app is published, so set the real one before the first store upload:
 *   CAP_APP_ID=com.yourstudio.games npx cap sync
 * (also change applicationId in android/app/build.gradle and PRODUCT_BUNDLE_IDENTIFIER in Xcode — `cap sync` does
 * not rewrite those after the native projects exist).
 *
 * AdMob: the application ids live in the native projects (android/app/src/main/res/values/strings.xml →
 * admob_app_id, ios/App/App/Info.plist → GADApplicationIdentifier) because the Google Mobile Ads SDK reads them
 * before any JavaScript runs. Ad unit ids are in src/kit/ads.ts (AdConfig.admob).
 */
const config: CapacitorConfig = {
  appId: process.env.CAP_APP_ID || "com.shanisagar.games",
  appName: process.env.CAP_APP_NAME || "Shani Sagar Games",
  webDir: "dist",
  backgroundColor: "#0b0d17",
  // webContentsDebuggingEnabled is left at its default: chrome://inspect / Safari Web Inspector work in debug builds
  // and are off in release builds.
  server: {
    // https://localhost origin = secure context, like the website. Never change it after release: the origin owns
    // localStorage, so a different scheme would orphan every player's saved progress.
    androidScheme: "https",
    iosScheme: "capacitor",
  },
  ios: {
    contentInset: "never",
    backgroundColor: "#0b0d17",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      launchFadeOutDuration: 250,
      backgroundColor: "#0b0d17",
      androidScaleType: "CENTER_INSIDE",
      showSpinner: false,
    },
    // Built into @capacitor/core 8. Edge-to-edge with env(safe-area-inset-*) (index.html has viewport-fit=cover;
    // the game host reads the insets). Bars are hidden by src/platform/native.ts and MainActivity (immersive).
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
      style: "DARK",
      hidden: true,
      animation: "NONE",
    },
  },
};

export default config;
