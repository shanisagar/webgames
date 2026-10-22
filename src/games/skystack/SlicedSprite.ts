import Phaser from "phaser";
import { Art, Color, GameObject, Mat, Mathf, Material, Render, Renderer, Sprite, V2 } from "../../kit";

/**
 * Local kit gap: SpriteRenderer.drawMode = Sliced / Tiled with a `size` in world units (Unity's SpriteDrawMode).
 * Sliced keeps the sprite's border (left, bottom, right, top) unscaled and shrinks it proportionally when the size is
 * smaller than the borders, like Unity. Tiled repeats the sprite at its native size, centred on the pivot.
 */
export enum SpriteDrawMode { Simple, Sliced, Tiled }

export class SlicedSprite extends Renderer {
  sprite: Sprite | null = null;
  color = Color.white;
  material: Material | null = null;
  drawMode = SpriteDrawMode.Sliced;
  /** Size in world units (before the transform's scale). */
  size = V2.one;
  private parts: Phaser.GameObjects.Image[] = [];
  private tile: Phaser.GameObjects.TileSprite | null = null;
  private builtKey = "";

  protected create(scene: Phaser.Scene) { return scene.add.container(0, 0); }

  private static frames(s: Sprite) {
    const tex = Render.scene!.textures.get(s.key);
    if (!tex.has("sl4")) {
      const [l, b, r, t] = s.border;
      const xs = [0, l, s.width - r, s.width], ys = [0, t, s.height - b, s.height];
      for (let ry = 0; ry < 3; ry++)
        for (let cx = 0; cx < 3; cx++) {
          const w = xs[cx + 1] - xs[cx], h = ys[ry + 1] - ys[ry];
          if (w > 0 && h > 0) tex.add("sl" + (ry * 3 + cx), 0, xs[cx], ys[ry], w, h);
        }
    }
    return tex;
  }

  private rebuild(scene: Phaser.Scene, s: Sprite) {
    const c = this.obj as Phaser.GameObjects.Container;
    c.removeAll(true);
    this.parts = [];
    this.tile = null;
    if (this.drawMode === SpriteDrawMode.Tiled) {
      this.tile = scene.add.tileSprite(0, 0, 1, 1, s.key).setOrigin(0.5, 0.5);
      c.add(this.tile);
    } else {
      const tex = SlicedSprite.frames(s);
      for (let i = 0; i < 9; i++) {
        if (!tex.has("sl" + i)) { this.parts.push(null as unknown as Phaser.GameObjects.Image); continue; }
        const img = scene.add.image(0, 0, s.key, "sl" + i).setOrigin(0, 0);
        c.add(img);
        this.parts.push(img);
      }
    }
    this.builtKey = s.key + "|" + this.drawMode;
  }

  protected draw(m: Mat) {
    const s = this.sprite;
    if (!s || this.color.a <= 0.002) return false;
    const scene = Render.scene!;
    const c = this.obj as Phaser.GameObjects.Container;
    if (this.builtKey !== s.key + "|" + this.drawMode) this.rebuild(scene, s);
    // local units = texture pixels (y down); the container maps them to the screen like SpriteRenderer does
    c.setPosition(m.tx, m.ty);
    c.setRotation(Math.atan2(m.b, m.a));
    c.setScale(m.scaleX / s.ppu, (m.scaleY / s.ppu) * -1);
    c.setAlpha(Mathf.clamp01(this.color.a));
    const tint = this.color.scale(this.material?.intensity ?? 1).rgbInt;
    const W = Math.max(0, this.size.x * s.ppu), H = Math.max(0, this.size.y * s.ppu);
    if (this.tile) {
      const t = this.tile;
      t.setSize(W, H);
      t.setDisplaySize(W, H);
      t.tilePositionX = Mathf.repeat(s.width / 2 - W / 2, s.width);
      t.tilePositionY = Mathf.repeat(s.height / 2 - H / 2, s.height);
      t.setTint(tint);
    } else {
      const [l, b, r, tp] = s.border;
      const fx = l + r > W ? W / (l + r) : 1, fy = tp + b > H ? H / (tp + b) : 1;
      const dw = [l * fx, W - (l + r) * fx, r * fx], dh = [tp * fy, H - (tp + b) * fy, b * fy];
      const dx = [-W / 2, -W / 2 + dw[0], W / 2 - dw[2]], dy = [-H / 2, -H / 2 + dh[0], H / 2 - dh[2]];
      for (let ry = 0; ry < 3; ry++)
        for (let cx = 0; cx < 3; cx++) {
          const img = this.parts[ry * 3 + cx];
          if (!img) continue;
          const w = dw[cx], h = dh[ry];
          img.setVisible(w > 0.01 && h > 0.01);
          if (!img.visible) continue;
          img.setPosition(dx[cx], dy[ry]).setDisplaySize(w, h).setTint(tint);
        }
    }
    c.setBlendMode(this.material?.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    return true;
  }
}

/** Art.Spr for a sliced / tiled sprite. */
export function slicedSpr(parent: GameObject | null, name: string, sprite: Sprite, color: Color, size: number, order: number, mat: Material | null = null) {
  const go = new GameObject(name, parent);
  go.localScale = new V2(size, size);
  const sr = go.addComponent(new SlicedSprite());
  sr.sprite = sprite;
  sr.color = color;
  sr.material = mat ?? Art.Solid;
  sr.sortingOrder = order;
  return sr;
}
