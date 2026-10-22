import Phaser from "phaser";
import { GameObject, Mat, Renderer } from "../../kit";

/**
 * Immediate-mode batch of flat-coloured quads/triangles in world units (kit gap: MeshRenderer allocates a Color per
 * triangle corner and only suits meshes that rarely change). The pseudo-3D track rebuilds its ground, buildings and
 * train bodies every frame, so this renderer stores plain numbers and replays them into one Phaser Graphics.
 */
export class Polys extends Renderer {
  private buf = new Float64Array(10 * 256);
  private n = 0;
  additive = false;

  static create(parent: GameObject | null, name: string, order: number) {
    const go = new GameObject(name, parent);
    const p = go.addComponent(new Polys());
    p.sortingOrder = order;
    return p;
  }

  get count() { return this.n / 10; }

  begin() { this.n = 0; }

  private grow() {
    const b = new Float64Array(this.buf.length * 2);
    b.set(this.buf);
    this.buf = b;
  }

  /** Convex quad a-b-c-d (any winding). */
  quad(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number, rgb: number, alpha = 1) {
    if (alpha <= 0.003) return;
    if (this.n + 10 > this.buf.length) this.grow();
    const b = this.buf, i = this.n;
    b[i] = ax; b[i + 1] = ay; b[i + 2] = bx; b[i + 3] = by; b[i + 4] = cx; b[i + 5] = cy; b[i + 6] = dx; b[i + 7] = dy;
    b[i + 8] = rgb; b[i + 9] = alpha;
    this.n += 10;
  }

  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, rgb: number, alpha = 1) {
    this.quad(ax, ay, bx, by, cx, cy, cx, cy, rgb, alpha);
  }

  protected create(scene: Phaser.Scene) { return scene.add.graphics(); }

  protected draw(m: Mat) {
    const g = this.obj as Phaser.GameObjects.Graphics;
    g.clear();
    if (this.n === 0) return false;
    const b = this.buf;
    let lastC = -1, lastA = -1;
    for (let i = 0; i < this.n; i += 10) {
      const c = b[i + 8], a = b[i + 9];
      if (c !== lastC || a !== lastA) { g.fillStyle(c, a); lastC = c; lastA = a; }
      g.fillTriangle(b[i], b[i + 1], b[i + 2], b[i + 3], b[i + 4], b[i + 5]);
      if (b[i + 6] !== b[i + 4] || b[i + 7] !== b[i + 5]) g.fillTriangle(b[i], b[i + 1], b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    }
    g.setPosition(m.tx, m.ty);
    g.setRotation(Math.atan2(m.b, m.a));
    g.setScale(m.scaleX, m.scaleY);
    g.setBlendMode(this.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    return true;
  }
}

/** Packs rgb (0..1) into 0xRRGGBB. */
export const rgbOf = (r: number, g: number, b: number) =>
  ((Math.max(0, Math.min(255, Math.round(r * 255))) << 16) | (Math.max(0, Math.min(255, Math.round(g * 255))) << 8) | Math.max(0, Math.min(255, Math.round(b * 255))));

/** Linear blend of two 0xRRGGBB colours. */
export function mixRgb(a: number, b: number, t: number) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/** Multiplies a 0xRRGGBB colour's brightness by k. */
export function shadeRgb(c: number, k: number) {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k)), g = Math.min(255, Math.round(((c >> 8) & 255) * k)), b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}
