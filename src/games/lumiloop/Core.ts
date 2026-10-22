import { Color, Mathf, Pal, PlayerPrefs } from "../../kit";

/** Basics.cs: entity kinds, palette, scoring rules, easing and save data. */

export enum EntityKind { Mote, Hunter, Cutter, Prism }

const Hex = (rgb: number, a = 1) => new Color(((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, a);

/** Mutable (unlike the C# readonly fields) so a client theme can recolour it at boot. */
export const Palette = {
  BgTop: Hex(0x140a2e),
  BgBottom: Hex(0x03050f),
  Comet: Hex(0x55f2ff),
  CometHot: Hex(0xffc84a),
  Mote: Hex(0xffe27a),
  Hunter: Hex(0xff3b5c),
  Cutter: Hex(0xe45cff),
  Prism: Hex(0x8cffb4),
  Text: Hex(0xeaf6ff),
  TextDim: new Color(0.72, 0.8, 0.95, 0.7),
  Panel: new Color(0.05, 0.04, 0.12, 0.94),
  Danger: Hex(0xff4d6a),
  Hex,
  Rainbow: (t: number) => Color.HSVToRGB(Mathf.repeat(t, 1), 0.5, 1),
};

/** Kit Pal stays in step so the kit UI pieces (cards, buttons) match the theme. */
export function syncPal() {
  Palette.Text = Pal.Text;
  Palette.TextDim = Pal.TextDim;
  Palette.Panel = Pal.Panel;
}

/** Scoring and tuning values per entity type — the game's balance sheet. */
export const Rules = {
  Points(k: EntityKind) {
    switch (k) {
      case EntityKind.Mote: return 10;
      case EntityKind.Hunter: return 60;
      case EntityKind.Cutter: return 90;
      default: return 150;
    }
  },
  Energy(k: EntityKind) {
    switch (k) {
      case EntityKind.Mote: return 7;
      case EntityKind.Hunter: return 4;
      case EntityKind.Cutter: return 6;
      default: return 30;
    }
  },
  ColorOf(k: EntityKind) {
    switch (k) {
      case EntityKind.Mote: return Palette.Mote;
      case EntityKind.Hunter: return Palette.Hunter;
      case EntityKind.Cutter: return Palette.Cutter;
      default: return Palette.Prism;
    }
  },
};

/** PlayerPrefs-backed persistence, cached in memory because several values are read every frame. */
const P = "lumiloop.";

class IntPref {
  private readonly key: string;
  private value = 0;
  private loaded = false;
  constructor(key: string, private readonly fallback: number) { this.key = P + key; }
  get Value() {
    if (!this.loaded) { this.value = PlayerPrefs.getInt(this.key, this.fallback); this.loaded = true; }
    return this.value;
  }
  set Value(v: number) {
    this.value = v;
    this.loaded = true;
    PlayerPrefs.setInt(this.key, v);
  }
  Forget() { this.loaded = false; PlayerPrefs.deleteKey(this.key); }
}

const best = new IntPref("best", 0), games = new IntPref("games", 0), loops = new IntPref("loops", 0),
  combo = new IntPref("combo", 0), sound = new IntPref("sound", 1), music = new IntPref("music", 1),
  haptics = new IntPref("haptics", 1), tutorial = new IntPref("tutorial", 0);

export const Save = {
  get Best() { return best.Value; }, set Best(v: number) { best.Value = v; },
  get GamesPlayed() { return games.Value; }, set GamesPlayed(v: number) { games.Value = v; },
  get TotalLoops() { return loops.Value; }, set TotalLoops(v: number) { loops.Value = v; },
  get BestCombo() { return combo.Value; }, set BestCombo(v: number) { combo.Value = v; },
  get Sound() { return sound.Value === 1; }, set Sound(v: boolean) { sound.Value = v ? 1 : 0; },
  get Music() { return music.Value === 1; }, set Music(v: boolean) { music.Value = v ? 1 : 0; },
  get Haptics() { return haptics.Value === 1; }, set Haptics(v: boolean) { haptics.Value = v ? 1 : 0; },
  get TutorialDone() { return tutorial.Value === 1; }, set TutorialDone(v: boolean) { tutorial.Value = v ? 1 : 0; },
  Flush() { PlayerPrefs.save(); },
  ResetAll() {
    for (const pref of [best, games, loops, combo, sound, music, haptics, tutorial]) pref.Forget();
    PlayerPrefs.save();
  },
};
