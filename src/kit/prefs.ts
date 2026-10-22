/** localStorage, or memory when storage is blocked (private mode), so the games never crash on save. */
const store: Pick<Storage, "getItem" | "setItem" | "removeItem"> = (() => {
  try {
    const k = "__na_test";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  }
})();

/** PlayerPrefs. */
export const PlayerPrefs = {
  getInt(key: string, fallback = 0) { const v = parseInt(store.getItem(key) ?? "", 10); return Number.isFinite(v) ? v : fallback; },
  setInt(key: string, v: number) { store.setItem(key, String(Math.trunc(v))); },
  getFloat(key: string, fallback = 0) { const v = parseFloat(store.getItem(key) ?? ""); return Number.isFinite(v) ? v : fallback; },
  setFloat(key: string, v: number) { store.setItem(key, String(v)); },
  getString(key: string, fallback = "") { return store.getItem(key) ?? fallback; },
  setString(key: string, v: string) { store.setItem(key, v); },
  hasKey(key: string) { return store.getItem(key) !== null; },
  deleteKey(key: string) { store.removeItem(key); },
  save() { /* localStorage writes are immediate */ },
};

/**
 * Per-game store with an in-memory cache (Core.cs Prefs). Keys are namespaced "arcade.<id>." exactly like the Unity
 * builds, and tracked so one game's data can be wiped without touching others.
 */
export class Prefs {
  private readonly prefix: string;
  private readonly cache = new Map<string, number>();

  constructor(id: string) { this.prefix = "arcade." + id + "."; }

  get(key: string, fallback = 0) {
    let v = this.cache.get(key);
    if (v === undefined) { v = PlayerPrefs.getInt(this.prefix + key, fallback); this.cache.set(key, v); }
    return v;
  }

  set(key: string, value: number) {
    value = Math.trunc(value);
    this.cache.set(key, value);
    PlayerPrefs.setInt(this.prefix + key, value);
    this.register(key);
  }

  add(key: string, delta: number) { this.set(key, this.get(key) + delta); }

  /** Stores value if it beats the saved one. Returns true on a new record. */
  max(key: string, value: number) {
    if (value <= this.get(key)) return false;
    this.set(key, value);
    return true;
  }

  /** Like max but lower is better (0 = unset). Useful for times in ms. */
  min(key: string, value: number) {
    const current = this.get(key);
    if (value <= 0 || (current > 0 && value >= current)) return false;
    this.set(key, value);
    return true;
  }

  flush() { /* immediate */ }

  resetAll() {
    const list = PlayerPrefs.getString(this.prefix + "__keys", "");
    for (const k of list.split(";")) if (k) PlayerPrefs.deleteKey(this.prefix + k);
    PlayerPrefs.deleteKey(this.prefix + "__keys");
    this.cache.clear();
  }

  private register(key: string) {
    const list = PlayerPrefs.getString(this.prefix + "__keys", "");
    if ((";" + list + ";").includes(";" + key + ";")) return;
    PlayerPrefs.setString(this.prefix + "__keys", list ? list + ";" + key : key);
  }
}

/** Settings shared by every game. */
const settings = new Prefs("settings");
export const Settings = {
  get Sound() { return settings.get("sound", 1) === 1; },
  set Sound(v: boolean) { settings.set("sound", v ? 1 : 0); },
  get Music() { return settings.get("music", 1) === 1; },
  set Music(v: boolean) { settings.set("music", v ? 1 : 0); },
  get Haptics() { return settings.get("haptics", 1) === 1; },
  set Haptics(v: boolean) { settings.set("haptics", v ? 1 : 0); },
  flush() {},
  resetAll() { settings.resetAll(); },
};
