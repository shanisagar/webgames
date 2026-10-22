import { AdService } from "./ads";
import { Art } from "./art";
import { Fx } from "./fx";
import { Color, Pal, V2, V3 } from "./math";
import { Prefs } from "./prefs";
import { Sprite, SpriteRenderer } from "./render";
import { GameObject } from "./scene";
import { Sfx, Snd } from "./sfx";
import { Shell } from "./shell";
import { ArcadeButton, Image, Text, UIKit, WrapMode } from "./ui";

/** Look helpers for casual games (CasualKit.cs CasualLook). */
export const CasualLook = {
  /** Tones the shared neon post-processing down: bloom only on the brightest pixels, no colour fringing. */
  calm(_root: unknown, bloomThreshold = 1.15, vignette = 0.18) { Fx.I?.setCalm(bloomThreshold, vignette); },

  /** A sprite that covers the shared backdrop (order -900 keeps it under all gameplay). */
  cover(parent: GameObject | null, sprite: Sprite, order = -900) { return Art.spr(parent, "Background", sprite, Color.white, 1, order, Art.Flat); },

  /** Stretches a cover sprite so it fills `view` (world units) with a small margin. */
  fitCover(sr: SpriteRenderer | null, view: V2, center = V2.zero) {
    if (!sr || !sr.sprite) return;
    const aspect = sr.sprite.height / Math.max(1, sr.sprite.width);
    sr.transform.localPosition = new V3(center.x, center.y, 0);
    sr.transform.localScale = new V3(view.x * 1.15 + 1, (view.y * 1.15 + 1) / aspect, 1);
  },

  /** A rounded card behind the shared title screen (its text is white) for light backgrounds. */
  titleCard(ui: Shell | null, color: Color, size: V2 | null = null, y = -20): Image | null {
    if (!ui || !ui.TitleExtra || !ui.TitleExtra.parent) return null;
    const card = UIKit.img(ui.TitleExtra.parent, "TitleCard", Art.UiRound, color);
    card.rectTransform.place(UIKit.Center, new V2(0, y), size ?? new V2(1060, 1080));
    card.rectTransform.setAsFirstSibling();
    return card;
  },

  /** Shrinks a label's font to fit its rect instead of overflowing. */
  fit(t: Text | null, minSize = 16) {
    if (!t) return t;
    t.resizeTextMaxSize = t.fontSize;
    t.resizeTextMinSize = Math.min(minSize, t.fontSize);
    t.resizeTextForBestFit = true;
    t.horizontalOverflow = WrapMode.Wrap;
    t.relayout();
    return t;
  },
};

/** Opt-in UI helpers for casual games (CasualUI.cs). */
export const CasualUI = {
  setText(t: Text | null, s: string) { if (t && t.text !== s) t.text = s; },

  /** "NAME ×3", "NAME +AD" or "NAME"; interactable when there are charges or an ad is ready. */
  booster(b: ArcadeButton | null, name: string, count: number, usable = true, activeLabel: string | null = null) {
    if (!b) return;
    const s = activeLabel ?? (count > 0 ? name + " ×" + count : AdService.rewardedAvailable ? name + " +AD" : name);
    if (b.label) CasualUI.setText(b.label, s);
    b.interactable = usable && (activeLabel !== null || count > 0 || AdService.rewardedAvailable);
  },

  /** Uses one charge, or (when there are none) offers a rewarded ad that adds one. True when a charge was used now. */
  useOrEarn(get: () => number, set: (v: number) => void, ui: Shell | null, toast: string) {
    if (get() > 0) { set(get() - 1); return true; }
    if (!AdService.rewardedAvailable) return false;
    AdService.showRewarded((ok) => {
      if (!ok) return;
      set(get() + 1);
      ui?.Toast(toast, 2);
      Sfx.play(Snd.PowerUp, 0.7);
    });
    return false;
  },
};

/** A path of five level nodes (with earned stars) for a title screen's extra area. */
export class LevelPath {
  private nodes: Image[] = [];
  private labels: Text[] = [];
  private stars: Image[][] = [];
  private now: Text[] = [];
  private static readonly Gold = Pal.hex(0xffc93c);

  constructor(ui: Shell | null, private nowColor: Color, private doneColor: Color, private ink: Color) {
    if (!ui || !ui.TitleExtra) return;
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 180;
      if (i < 4) UIKit.img(ui.TitleExtra, "Path", Art.UiRound, new Color(1, 1, 1, 0.32)).rectTransform.place(UIKit.Center, new V2(x + 90, 8), new V2(110, 12));
      const node = UIKit.img(ui.TitleExtra, "Node", Art.UiCircle, Color.white);
      node.rectTransform.place(UIKit.Center, new V2(x, 8), new V2(80, 80));
      this.nodes.push(node);
      this.labels.push(UIKit.at(UIKit.label(node.rectTransform, "1", 34, ink), UIKit.Center, V2.zero, new V2(80, 80)));
      const st: Image[] = [];
      for (let k = 0; k < 3; k++) {
        st.push(UIKit.img(ui.TitleExtra, "Star", Art.Star, LevelPath.Gold));
        st[k].rectTransform.place(UIKit.Center, new V2(x + (k - 1) * 28, -50), new V2(26, 26));
      }
      this.stars.push(st);
      this.now.push(UIKit.at(UIKit.label(ui.TitleExtra, "", 24, LevelPath.Gold), UIKit.Center, new V2(x, -52), new V2(160, 30)));
    }
  }

  /** Shows levels around `current`; stars come from Data "s<level>". */
  refresh(data: Prefs, current: number) {
    const first = Math.max(1, current - 2);
    for (let i = 0; i < this.nodes.length; i++) {
      const l = first + i, done = l < current, isNow = l === current;
      this.labels[i].text = String(l);
      this.nodes[i].color = isNow ? this.nowColor : done ? this.doneColor : new Color(1, 1, 1, 0.85);
      this.labels[i].color = isNow || done ? Color.white : this.ink;
      this.nodes[i].rectTransform.localScale = isNow ? new V3(1.25, 1.25, 1) : V3.one;
      const st = data.get("s" + l);
      for (let k = 0; k < 3; k++) {
        this.stars[i][k].gameObject.setActive(done);
        this.stars[i][k].color = k < st ? LevelPath.Gold : new Color(1, 1, 1, 0.3);
      }
      this.now[i].text = isNow ? "PLAY!" : "";
    }
  }
}
