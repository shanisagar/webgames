export interface Theme {
  name: string;
  bgTop: string;
  bgBottom: string;
  /** rgb + alpha of the background grid */
  grid: [number, number, number, number];
  dot: [number, number, number, number];
  arrows: string[];
  accent: string;
  accent2: string;
  danger: string;
  success: string;
  text: string;
  textDim: string;
  panel: string;
}

export const THEMES: Theme[] = [
  {
    name: "CYBER", bgTop: "#140a33", bgBottom: "#02030b", grid: [0.25, 0.85, 1, 0.09], dot: [0.45, 0.6, 0.95, 0.28],
    arrows: ["#00e5ff", "#ff2bd6", "#7c4dff", "#2effa0", "#ffd12e"],
    accent: "#00e5ff", accent2: "#ff2bd6", danger: "#ff3b5c", success: "#2effa0",
    text: "#e8f6ff", textDim: "rgba(153,184,230,0.8)", panel: "rgba(8,10,31,0.92)",
  },
  {
    name: "SYNTHWAVE", bgTop: "#2b0a3d", bgBottom: "#090012", grid: [1, 0.3, 0.75, 0.1], dot: [0.95, 0.5, 0.85, 0.25],
    arrows: ["#ff4fd8", "#ff9e2c", "#36e2ff", "#b967ff", "#fffb96"],
    accent: "#ff4fd8", accent2: "#36e2ff", danger: "#ff3355", success: "#fffb96",
    text: "#fff0fb", textDim: "rgba(230,166,217,0.8)", panel: "rgba(26,5,36,0.92)",
  },
  {
    name: "MATRIX", bgTop: "#03140a", bgBottom: "#000302", grid: [0.2, 1, 0.45, 0.08], dot: [0.3, 0.9, 0.45, 0.25],
    arrows: ["#39ff88", "#b6ff3b", "#00ffd0", "#7dffb0"],
    accent: "#39ff88", accent2: "#00ffd0", danger: "#ff4040", success: "#b6ff3b",
    text: "#e6ffee", textDim: "rgba(140,217,153,0.8)", panel: "rgba(3,18,8,0.93)",
  },
  {
    name: "SOLAR", bgTop: "#2a1203", bgBottom: "#070200", grid: [1, 0.6, 0.2, 0.09], dot: [1, 0.7, 0.4, 0.25],
    arrows: ["#ffb300", "#ff6a00", "#ffe066", "#ff3d7f", "#00d9ff"],
    accent: "#ffb300", accent2: "#ff3d7f", danger: "#ff2e2e", success: "#ffe066",
    text: "#fff5e6", textDim: "rgba(242,191,140,0.8)", panel: "rgba(26,10,3,0.93)",
  },
  {
    name: "GLACIER", bgTop: "#0b2236", bgBottom: "#01060d", grid: [0.6, 0.9, 1, 0.09], dot: [0.7, 0.85, 1, 0.28],
    arrows: ["#9be7ff", "#ffffff", "#5ab0ff", "#b0a4ff", "#7affe1"],
    accent: "#9be7ff", accent2: "#b0a4ff", danger: "#ff5470", success: "#7affe1",
    text: "#f0faff", textDim: "rgba(166,204,235,0.8)", panel: "rgba(5,18,31,0.93)",
  },
];

export const getTheme = (index: number) => THEMES[((index % THEMES.length) + THEMES.length) % THEMES.length];

/** Same hash as the Unity version so each level keeps its arrow colours. */
export function arrowColor(theme: Theme, arrowIndex: number, seed: number): string {
  let h = (Math.imul(arrowIndex, 2654435761) ^ seed) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return theme.arrows[h % theme.arrows.length];
}

export const hexToInt = (hex: string) => parseInt(hex.slice(1), 16);

export function hexToRgb(hex: string): [number, number, number] {
  const v = hexToInt(hex);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Linear blend of two 0xRRGGBB colours. */
export function lerpColor(a: number, b: number, t: number): number {
  t = Math.min(Math.max(t, 0), 1);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
