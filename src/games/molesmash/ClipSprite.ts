import Phaser from "phaser";
import { Mat, SpriteRenderer } from "../../kit";

/**
 * A SpriteRenderer that only draws the top `visible` fraction of its sprite (kit gap: SpriteRenderer has no crop or
 * mask). Moles rise out of their holes with it: everything below the hole line is cut away.
 */
export class ClipSprite extends SpriteRenderer {
  /** 0..1: fraction of the sprite (from its top edge) that is drawn. */
  visible = 1;
  private lastCrop = -1;
  private lastKey = "";

  protected draw(m: Mat) {
    if (this.visible <= 0.001) return false;
    const ok = super.draw(m);
    const s = this.sprite, img = this.obj as Phaser.GameObjects.Image | null;
    if (!ok || !s || !img) return ok;
    const v = Math.min(1, this.visible);
    if (v !== this.lastCrop || s.key !== this.lastKey) {
      this.lastCrop = v;
      this.lastKey = s.key;
      const tw = s.width * s.texScale, th = s.height * s.texScale;
      if (v >= 0.999) img.setCrop();
      else img.setCrop(0, 0, tw, Math.max(1, th * v));
    }
    return true;
  }
}
