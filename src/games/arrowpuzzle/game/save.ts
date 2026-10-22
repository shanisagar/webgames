/** localStorage wrapper for progress and settings (same keys and defaults as the Unity PlayerPrefs). */
const store = (() => {
  try {
    const k = "__ap_test";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map<string, string>(); // private mode / blocked storage: keep progress for this visit only
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    } as Pick<Storage, "getItem" | "setItem" | "removeItem">;
  }
})();

const getInt = (k: string, d: number) => {
  const v = parseInt(store.getItem(k) ?? "", 10);
  return Number.isFinite(v) ? v : d;
};
const setInt = (k: string, v: number) => store.setItem(k, String(v));

export const STARTING_HINTS = 2;

export const Save = {
  get currentLevel() { return Math.max(1, getInt("ap_current", 1)); },
  set currentLevel(v: number) { setInt("ap_current", Math.max(1, v)); },
  get unlockedLevel() { return Math.max(1, getInt("ap_unlocked", 1)); },
  get hints() { return getInt("ap_hints", STARTING_HINTS); },
  set hints(v: number) { setInt("ap_hints", Math.max(0, v)); },
  get sound() { return getInt("ap_sound", 1) === 1; },
  set sound(v: boolean) { setInt("ap_sound", v ? 1 : 0); },
  get music() { return getInt("ap_music", 1) === 1; },
  set music(v: boolean) { setInt("ap_music", v ? 1 : 0); },
  get haptics() { return getInt("ap_haptics", 1) === 1; },
  set haptics(v: boolean) { setInt("ap_haptics", v ? 1 : 0); },
  get theme() { return getInt("ap_theme", 0); },
  set theme(v: number) { setInt("ap_theme", v); },
  get totalStars() { return getInt("ap_total_stars", 0); },
  stars: (level: number) => getInt("ap_stars_" + level, 0),

  /** Records a win. Returns true if this was the first time the level was cleared. */
  completeLevel(level: number, stars: number): boolean {
    const previous = Save.stars(level);
    if (stars > previous) {
      setInt("ap_stars_" + level, stars);
      setInt("ap_total_stars", Save.totalStars + stars - previous);
    }
    const first = level >= Save.unlockedLevel;
    if (level + 1 > Save.unlockedLevel) setInt("ap_unlocked", level + 1);
    setInt("ap_current", level + 1);
    return first;
  },

  resetProgress() {
    const unlocked = Save.unlockedLevel;
    for (let i = 1; i <= unlocked + 1; i++) store.removeItem("ap_stars_" + i);
    for (const k of ["ap_current", "ap_unlocked", "ap_hints", "ap_total_stars"]) store.removeItem(k);
  },
};
