import { useSyncExternalStore } from "react";
import { Difficulty } from "../core/level";

export type Screen = "menu" | "hud" | "win" | "lose";
export type Overlay = "levels" | "settings" | null;

export interface UiState {
  screen: Screen;
  overlay: Overlay;
  levelNumber: number;
  difficulty: Difficulty;
  remaining: number;
  lives: number;
  hints: number;
  themeIndex: number;
  tutorial: string | null;
  toast: { text: string; id: number; duration: number } | null;
  win: { stars: number; time: number; mistakes: number; bonusHint: boolean } | null;
  canContinue: boolean;
  zoomedIn: boolean;
  /** Increments on each mistake so the HUD can replay its heart animation. */
  mistakes: number;
  /** Bumped when saved progress changes so screens re-read it. */
  saveVersion: number;
}

type Listener = () => void;

/** Tiny external store: the game controller writes, React screens read via useUi(). */
class Store {
  private state: UiState;
  private listeners = new Set<Listener>();

  constructor(initial: UiState) {
    this.state = initial;
  }

  get = () => this.state;

  set(patch: Partial<UiState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const ui = new Store({
  screen: "menu",
  overlay: null,
  levelNumber: 1,
  difficulty: Difficulty.Easy,
  remaining: 0,
  lives: 3,
  hints: 0,
  themeIndex: 0,
  tutorial: null,
  toast: null,
  win: null,
  canContinue: true,
  zoomedIn: false,
  mistakes: 0,
  saveVersion: 0,
});

export function useUi(): UiState {
  return useSyncExternalStore(ui.subscribe, ui.get);
}

let toastId = 0;
export function toast(text: string, duration = 2.4) {
  ui.set({ toast: { text, id: ++toastId, duration } });
}
