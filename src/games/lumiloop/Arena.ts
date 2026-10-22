import { Behaviour, Camera, Color, GameObject, Mathf, Rect, Screen, Time, V2 } from "../../kit";
import { Palette } from "./Core";
import { Art, BackdropQuad, GlowLine } from "./LumiArt";

export const ShortSide = 17;
const Margin = 0.45;
const HudBand = 3.1; // matches the ~200px top HUD at 1080 reference width

/**
 * Fits the camera to the screen (the short side always shows the same number of world units, so phones, tablets and
 * desktops play identically), owns the animated backdrop and the play-field border, and exposes the playable bounds,
 * which leave room for the HUD band and the device safe area (Arena.cs).
 */
export class Arena extends Behaviour {
  Bounds = new Rect();
  get AreaScale() { return Mathf.clamp((this.Bounds.width * this.Bounds.height) / 380, 0.65, 1.5); }

  private backdropMat!: BackdropQuad;
  private border!: GlowLine;
  private lastKey = "";
  private danger = 0;
  private targetDanger = 0;
  private flash = 0;
  private borderFlash = 0;
  private flashColor = Color.black;

  Init() {
    this.backdropMat = new GameObject("Backdrop", this.gameObject).addComponent(new BackdropQuad());
    this.backdropMat.Top = Palette.BgTop;
    this.backdropMat.Bottom = Palette.BgBottom;
    this.backdropMat.init();

    this.border = new GameObject("Border", this.gameObject).addComponent(new GlowLine());
    this.border.material = Art.Trail;
    this.border.loop = true;
    this.border.positionCount = 4;
    this.border.widthMultiplier = 0.09;
    this.border.sortingOrder = 2;
    this.border.useWorldSpace = true;

    this.Refresh(true);
  }

  /** Recomputes camera and bounds when the resolution or safe area changes. Returns true if anything changed. */
  Refresh(force = false) {
    const safe = Screen.safeArea;
    const key = `${Screen.width}x${Screen.height}:${safe.x},${safe.y},${safe.width},${safe.height}`;
    if (!force && key === this.lastKey) return false;
    this.lastKey = key;

    const sw = Math.max(1, Screen.width), sh = Math.max(1, Screen.height);
    const aspect = sw / sh;
    Camera.orthographicSize = aspect < 1 ? ShortSide / (2 * aspect) : ShortSide * 0.5;
    const h = Camera.orthographicSize * 2, w = h * aspect;

    const left = (safe.xMin / sw) * w, right = ((sw - safe.xMax) / sw) * w;
    const bottom = (safe.yMin / sh) * h, top = ((sh - safe.yMax) / sh) * h;
    this.Bounds = Rect.minMaxRect(-w * 0.5 + Margin + left, -h * 0.5 + Margin + bottom, w * 0.5 - Margin - right, h * 0.5 - HudBand - top);

    // Oversize the backdrop a little so camera shake never reveals an edge.
    this.backdropMat.Size = new V2(w * 1.12, h * 1.12);

    const b = this.Bounds;
    this.border.setPosition(0, new V2(b.xMin, b.yMin));
    this.border.setPosition(1, new V2(b.xMax, b.yMin));
    this.border.setPosition(2, new V2(b.xMax, b.yMax));
    this.border.setPosition(3, new V2(b.xMin, b.yMax));
    return true;
  }

  /** 0..1 red edge glow for low energy. */
  SetDanger(amount: number) { this.targetDanger = Mathf.clamp01(amount); }

  Flash(color: Color, amount: number) {
    this.flashColor = color;
    this.flash = Math.max(this.flash, amount);
  }

  PulseBorder(amount = 0.6) { this.borderFlash = Math.max(this.borderFlash, amount); }

  update() {
    const dt = Time.unscaledDeltaTime;
    this.danger = Mathf.moveTowards(this.danger, this.targetDanger, dt * 1.5);
    this.flash = Mathf.moveTowards(this.flash, 0, dt * 2.2);
    this.borderFlash = Mathf.moveTowards(this.borderFlash, 0, dt * 2.5);

    this.backdropMat.Danger = this.danger;
    this.backdropMat.Flash = new Color(this.flashColor.r, this.flashColor.g, this.flashColor.b, this.flash);

    const c = Color.lerp(Palette.Comet, Palette.Danger, this.danger).withAlpha(0.16 + this.borderFlash * 0.6 + this.danger * 0.2);
    this.border.startColor = c;
    this.border.endColor = c;
  }
}
