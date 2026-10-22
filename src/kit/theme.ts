import { AdConfig } from "./ads";
import { Pal } from "./math";
import type { GameInfo } from "./shell";

/**
 * Per-client (operator) customization, loaded by the portal before a game starts. Everything is optional: a client
 * without a theme gets each game's own colours. Values come from the back office (Supabase) or a local fallback.
 */
export interface ClientTheme {
  /** UI chrome colours (#rrggbb). */
  accent?: string;
  accent2?: string;
  panel?: string;
  text?: string;
  /** Repaint every game's accent colours with the client's (keeps each game's own backgrounds). */
  recolorGames?: boolean;
  /** Also replace game backgrounds with these. */
  bgTop?: string;
  bgBottom?: string;
  /** Google Fonts family for all game UI, e.g. "Poppins". */
  font?: string;
  logoUrl?: string;
}

export interface ClientAds {
  provider?: "h5" | "test" | "none";
  /** The client's own AdSense publisher id (ca-pub-...), so ad revenue goes to them. */
  publisherId?: string;
  testMode?: boolean;
  interstitialEveryRuns?: number;
  minSecondsBetweenAds?: number;
  graceRuns?: number;
}

/** Portal copy shown around the games. */
export interface ClientSite {
  headline?: string;
  tagline?: string;
  footer?: string;
  /** Where the logo / "back" link points, e.g. the operator's own site. */
  homeUrl?: string;
}

export interface ClientConfig {
  slug: string;
  name: string;
  theme: ClientTheme;
  ads: ClientAds;
  site?: ClientSite;
  /** Enabled game ids in display order (null = all games). */
  games: string[] | null;
}

let current: ClientConfig | null = null;
// Studio defaults, restored when the portal switches clients (or leaves client mode) without a page reload.
const defaultAds = { ...AdConfig };
const defaultPal = { Panel: Pal.Panel, Text: Pal.Text, TextDim: Pal.TextDim };

const col = (hex: string | undefined) => (hex && /^#[0-9a-f]{6}$/i.test(hex) ? Pal.hex(parseInt(hex.slice(1), 16)) : null);

/** Sets the active client (portal) before games boot. */
export function setClient(c: ClientConfig | null) {
  current = c;
  Object.assign(AdConfig, defaultAds);
  Object.assign(Pal, defaultPal);
  const a = c?.ads;
  if (a) {
    if (a.provider) AdConfig.provider = a.provider;
    if (a.publisherId) AdConfig.client = a.publisherId;
    if (a.testMode !== undefined) AdConfig.testMode = a.testMode;
    if (a.interstitialEveryRuns) AdConfig.interstitialEveryRuns = a.interstitialEveryRuns;
    if (a.minSecondsBetweenAds !== undefined) AdConfig.minSecondsBetweenAds = a.minSecondsBetweenAds;
    if (a.graceRuns !== undefined) AdConfig.graceRuns = a.graceRuns;
  }
  const t = c?.theme;
  const panel = col(t?.panel), text = col(t?.text);
  if (panel) Pal.Panel = panel.withAlpha(0.94);
  if (text) { Pal.Text = text; Pal.TextDim = text.withAlpha(0.7); }
  if (t?.font) loadFont(t.font);
}

export const currentClient = () => current;

/** Applied to every game's GameInfo at boot. */
export function applyClientTheme(info: GameInfo): GameInfo {
  const t = current?.theme;
  if (!t) return info;
  const a = col(t.accent), a2 = col(t.accent2);
  if (t.recolorGames) {
    if (a) info.Accent = a;
    if (a2) info.Accent2 = a2;
    const top = col(t.bgTop), bottom = col(t.bgBottom);
    if (top) info.BgTop = top;
    if (bottom) info.BgBottom = bottom;
  }
  return info;
}

/** CSS font stack for game UI. */
export function uiFont() {
  const f = current?.theme.font;
  return f ? `"${f}", "Arial", sans-serif` : `"Arial Rounded MT Bold", "Arial", "Helvetica Neue", Helvetica, sans-serif`;
}

function loadFont(family: string) {
  if (!/^[\w ]+$/.test(family) || document.querySelector(`link[data-na-font="${family}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.dataset.naFont = family;
  l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`;
  document.head.appendChild(l);
}
