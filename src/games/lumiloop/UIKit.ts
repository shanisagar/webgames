import { ArcadeButton, UIKit as KitUIKit, UINode, V2 } from "../../kit";
import { Juice } from "./Juice";
import { Palette } from "./Core";
import { Cue, Synth } from "./Synth";

/**
 * UIKit.cs. Node/Place/Stretch/Img/Label/Wrap/Glow/Layer/Dim/Card are the kit's UIKit (built from the same C#), and the
 * kit's ArcadeButton is LumiButton line for line (squash, halo pulse, primary/secondary accents). Only the click
 * feedback differs: Lumiloop's buttons play the Synth click and its own haptics setting.
 */
export const UIKit = {
  ...KitUIKit,

  button(parent: UINode, label: string, size: V2, primary: boolean, onClick: () => void, fontSize = 46): ArcadeButton {
    const b = KitUIKit.button(parent, label, size, primary, () => {
      Synth.Play(Cue.Click);
      Juice.Haptic();
      onClick();
    }, fontSize);
    b.silent = true;
    b.setAccent(Palette.Comet);
    return b;
  },
};
