# Android and iOS apps

The Play Store and App Store apps are the same web build (`dist/`) wrapped with [Capacitor 8](https://capacitorjs.com).
Everything runs offline from files inside the app, with no web server. In the apps, ads come from **AdMob**, like the
original Unity builds. The website keeps using AdSense H5 Games Ads.

| Piece | Where |
| --- | --- |
| App id, name, splash, system bars | `capacitor.config.ts` |
| Android Studio project | `android/` (commit it; build output is git-ignored) |
| Xcode project (Swift Package Manager, no CocoaPods) | `ios/` |
| Ads (AdMob backend, unit ids) | `src/kit/ads.ts` → `AdConfig.admob` |
| Back button, pause on background, keep-awake | `src/platform/native.ts` → `initNative()` |
| Android CI (APK / AAB) | `.github/workflows/android.yml` |
| iOS simulator compile check (manual) | `.github/workflows/ios.yml` |

## How the web/native split works

- Capacitor injects `window.Capacitor` into the app's WebView before the page loads. `nativePlatform()` in
  `src/kit/ads.ts` and `isNativeApp()` in `src/platform/native.ts` read it, so the website never loads any Capacitor code.
- `AdService.init()` picks the backend: inside the app it always uses **AdMob** (unless `provider` is `"none"`). On the
  web it uses `h5` (AdSense), `test` (fake ads in `npm run dev`) or `none`, as before.
- The AdMob plugin (`@capacitor-community/admob`) and the other Capacitor plugins load with `import()`, so they are
  separate chunks that the website never downloads.
- The game-facing API is unchanged: `AdService.betweenRuns`, `showRewarded` and the frequency rules (grace runs,
  every N runs, minimum seconds between ads) work the same way on every platform.

AdMob flow (same as Unity's `AdMobBackend.cs`):
1. Google UMP consent (`requestConsentInfo`, then the consent form when required in the EEA/UK).
2. `initialize`.
3. Preload one interstitial and one rewarded ad. Failed loads retry with backoff (4 s doubling up to 64 s).
4. After each ad closes, the next one is loaded. A reward counts only if the SDK's reward event fired.
5. `AdService.privacyOptionsRequired` / `showPrivacyOptions()` open UMP's privacy options form. A settings screen should
   offer this when the flag is true.

## What the owner must provide

| Item | Cost | Needed for |
| --- | --- | --- |
| Google AdMob account (same Google account as AdSense `pub-2503823450887306`) | free | ad revenue |
| AdMob **apps** (one Android, one iOS) and their ad units (1 interstitial + 1 rewarded each) | free | real ads |
| Google Play developer account | US$25 once | Play Store |
| Apple Developer Program | US$99 / year | App Store, TestFlight, running on your own iPhone for more than 7 days |
| A Mac with a current Xcode | — | iOS builds and uploads |
| Android upload keystore (you create it, see below) | free | signed Play uploads |
| Privacy policy URL (mention AdMob / advertising ID) | — | both stores require one |
| Final bundle id, e.g. `com.yourstudio.games` | — | cannot change after the first upload |

## Current AdMob ids

| | Android | iOS |
| --- | --- | --- |
| App id | `ca-app-pub-2503823450887306~9616402008`: **real**, from the Unity project's `NeonArcadeAds.asset` | `ca-app-pub-3940256099942544~1458002511`: Google **test** id (Unity had no iOS app) |
| Interstitial | `ca-app-pub-3940256099942544/1033173712` (test) | `ca-app-pub-3940256099942544/4411468910` (test) |
| Rewarded | `ca-app-pub-3940256099942544/5224354917` (test) | `ca-app-pub-3940256099942544/1712485313` (test) |

The Unity project also shipped Google's sample units for interstitial and rewarded ads. Its one real unit was a
banner, which these apps do not use. `AdConfig.testMode` (currently `true`) also forces test ads. The plugin then uses
Google's sample units whatever ids are configured. Set `AdConfig.admob.testMode` to override that for the apps only.

### Switching to real ads

1. In AdMob, open **Apps**. Use the existing Android app (`~9616402008`) or add one. Add an iOS app.
   Link each app to its store listing once it is published.
2. For each app, create an **Interstitial** and a **Rewarded** ad unit.
3. Paste the unit ids into `src/kit/ads.ts` → `AdConfig.admob.android` / `.ios`.
4. Paste the iOS **app id** into `ios/App/App/Info.plist` → `GADApplicationIdentifier`. If the Android app id changes,
   update `android/app/src/main/res/values/strings.xml` → `admob_app_id`. App ids are read by the native SDK at
   launch, so changing them in `ads.ts` alone does nothing.
5. Set `AdConfig.admob.testMode = false` (or `AdConfig.testMode = false`), then rebuild and sync.
6. Keep your own phone as a test device: add its id (printed in logcat / the Xcode console on the first ad request) to
   `AdConfig.admob.testDeviceIds`. **Never click live ads on your own device.**
7. iOS: append Google's full SKAdNetwork list to `SKAdNetworkItems` in `Info.plist` (see the AdMob iOS quick-start).
8. In AdMob → Privacy & messaging, create a **GDPR** message (and a US state message if wanted), or UMP shows nothing.
9. Publish an `app-ads.txt` on the developer website listed in the store:
   `google.com, pub-2503823450887306, DIRECT, f08c47fec0942fa0`.

## Building locally

Requirements: Node 22. Android: Android Studio (it bundles JDK 21 and the SDK). iOS: macOS with Xcode.

```bash
npm ci
npm run build          # web build → dist/
npx cap sync           # copies dist/ + plugin config into android/ and ios/
npx cap open android   # Android Studio: Run ▶ on a device/emulator
npx cap open ios       # Xcode: pick a simulator or your iPhone, Run ▶
```

Run `npm run build && npx cap sync` after every web change. Command-line Android build:

```bash
cd android && ./gradlew assembleDebug    # → android/app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Debug builds allow `chrome://inspect` (Android) and Safari → Develop (iOS) to inspect the WebView.

### App id and name

`capacitor.config.ts` defaults to `com.shanisagar.games` / "Shani Sagar Games". After the native projects exist,
`cap sync` does **not** rename them. To change the id, edit:
- `capacitor.config.ts` → `appId`
- `android/app/build.gradle` → `namespace`, `applicationId`; move `MainActivity.java` to the matching package folder
- `android/app/src/main/res/values/strings.xml` → `app_name`, `package_name`
- Xcode → target App → Signing & Capabilities → Bundle Identifier; Info.plist → `CFBundleDisplayName`

### Icons and splash

They were generated from `public/icon-512.png`: Android `mipmap-*` launcher icons (legacy, round and adaptive foreground
on `#0B0D17`), `drawable*/splash.png`, and iOS `AppIcon` (1024, opaque) and `Splash`. To regenerate from a new
1024×1024 icon, use Android Studio → New → Image Asset, or `npx @capacitor/assets generate`
(put `assets/icon.png` and `assets/splash.png` first).

### Native behaviour

- Orientation unlocked on both platforms. Each game lays itself out for portrait or landscape.
- Full screen: Android immersive mode (`MainActivity`: bars hidden, a swipe shows them briefly). The iOS status bar is
  hidden. The safe areas (notch, home indicator) reach the games through `env(safe-area-inset-*)`.
- Android back button: in a game it goes back to the game list (or the client portal). On the list it minimises the app.
- App in the background: the game pauses and audio stops (Capacitor `appStateChange` plus the WebView's own
  `visibilitychange`).
- The screen stays awake while a game is open (Screen Wake Lock: Android WebView, iOS 18.4+). The lobby uses the
  normal sleep timeout.

## Android release (Google Play)

### 1. Create the upload keystore (once, keep it safe)

```bash
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Use **Play App Signing** (the default). Google holds the app signing key and you sign uploads with this key. If the
upload key is lost, Play support can reset it.

Local signed builds: create `android/keystore.properties` (git-ignored, as are `*.jks`):

```properties
storeFile=/absolute/path/to/upload.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

Then run `cd android && ./gradlew bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`.

### 2. CI signing

In GitHub → Settings → Secrets and variables → Actions, add:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 upload.jks` (macOS: `base64 -i upload.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | key password |

`android.yml` runs on pushes to `main` that touch the app, and on demand (Actions → Android app → Run workflow).
- Without the secrets it uploads `app-debug-apk` and `app-release-unsigned`.
- With the secrets it uploads `app-release-signed`, which holds the `.aab` for Play.
- `versionCode` is the workflow run number and `versionName` is `1.0.<run>`. Local builds use 1 / 1.0 unless
  `APP_VERSION_CODE` / `APP_VERSION_NAME` are set.

### 3. Play Console

1. Create the app (free game, contains ads = **Yes**).
2. App content:
   - privacy policy URL
   - Ads declaration
   - Data safety: AdMob collects the device advertising ID, approximate location and app interactions for advertising
     and analytics, and shares them with Google
   - target audience: not primarily children, unless you set `childDirected`
   - content rating questionnaire
3. Store listing: icon 512×512 (`public/icon-512.png`), feature graphic 1024×500, at least 2 phone screenshots.
4. Testing → Internal testing → upload the signed `.aab` → add testers. New personal developer accounts must run a
   closed test with 12 testers for 14 days before Production is unlocked.
5. Production → release.
6. Link the Play listing to the AdMob Android app.

## iOS release (App Store)

1. Join the Apple Developer Program. On a Mac: `npm ci && npm run build && npx cap sync ios && npx cap open ios`.
2. Xcode → target **App** → Signing & Capabilities: choose your Team and set the Bundle Identifier. Set the version and
   build number in General.
3. Product → Archive → Distribute App → App Store Connect → Upload.
4. App Store Connect: create the app, privacy policy URL, App Privacy ("Identifiers → Device ID" and "Usage data" used
   for third-party advertising, from the AdMob SDK), age rating, screenshots (6.9" iPhone and 13" iPad), then submit
   the build for review. Test with TestFlight first.
5. Personalised ads on iOS need App Tracking Transparency. The app does not ask (no `NSUserTrackingUsageDescription`),
   so iOS serves non-personalised ads, with lower revenue. To ask: add `NSUserTrackingUsageDescription` to
   `Info.plist`, call `AdMob.requestTrackingAuthorization()` before `initialize` in `src/kit/ads.ts`, and declare
   tracking in App Privacy.

The `ios.yml` workflow (manual) only proves the project compiles for the Simulator on a macOS runner. Signing and
uploading need your Apple account, in Xcode or a later fastlane setup.

## Versions

Pinned exactly in `package.json`:
- `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` and `@capacitor/ios` 8.5.3
- `@capacitor/app` 8.1.2
- `@capacitor/splash-screen` 8.0.2
- `@capacitor-community/admob` 8.2.1 (Google Mobile Ads SDK 25.4.x on Android, 13.11.0 on iOS; UMP)

Status bar and navigation bar control comes from `SystemBars`, which is built into `@capacitor/core` 8.

Android settings:
- minSdk 24 (Android 7)
- target/compile SDK 36
- Android Gradle Plugin 8.13, Gradle 8.14.3
- Java 21

iOS: 15 or later.

To upgrade, bump all `@capacitor/*` packages together, then run `npx cap sync`. Read the plugin's migration notes
before a new AdMob plugin major version.
