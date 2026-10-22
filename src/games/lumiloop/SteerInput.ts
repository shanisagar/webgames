import { dp, Gamepad, Keyboard, Mouse, Screen, screenToWorld, Touchscreen, V2 } from "../../kit";

/** Touches that start above this fraction of the screen height belong to the HUD. */
const HudTouchLine = 0.86;

/**
 * Unified steering (SteerInput.cs): a floating thumb-stick on touch screens, cursor-follow with a mouse, WASD / arrow
 * keys, and gamepad stick or d-pad. Produces a desired world-space direction.
 */
export class SteerInput {
  HasDirection = false;
  Direction = V2.zero;
  UsingTouch = false;

  JoystickActive = false;
  JoyOrigin = V2.zero;
  JoyCurrent = V2.zero;

  private mouseSteering = false;
  private lastMouse = V2.zero;

  Init() { this.UsingTouch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches; }

  Reset() {
    this.HasDirection = false;
    this.JoystickActive = false;
  }

  Update(from: V2) {
    this.HasDirection = false;
    if (this.ReadTouch()) return;
    if (this.ReadButtons()) return;
    this.ReadMouse(from);
  }

  private ReadTouch() {
    const touch = Touchscreen.primaryTouch;
    if (!touch) {
      this.JoystickActive = false;
      return false;
    }

    const pos = touch.position;
    if (touch.press.wasPressedThisFrame && pos.y < Screen.height * HudTouchLine) {
      this.JoystickActive = true;
      this.JoyOrigin = pos;
      this.UsingTouch = true;
      this.mouseSteering = false;
    }
    if (!touch.press.isPressed || touch.press.wasReleasedThisFrame) this.JoystickActive = false;
    if (!this.JoystickActive) return false;

    this.JoyCurrent = pos;
    const maxRadius = dp(64);
    let d = pos.sub(this.JoyOrigin);
    if (d.magnitude > maxRadius) {
      this.JoyOrigin = pos.sub(d.normalized.mul(maxRadius)); // the stick base follows the thumb
      d = pos.sub(this.JoyOrigin);
    }
    if (d.magnitude > dp(6)) {
      this.Direction = d.normalized;
      this.HasDirection = true;
    }
    return true;
  }

  private ReadButtons() {
    let kx = 0, ky = 0;
    const K = Keyboard;
    if (K.letter("a").isPressed || K.left.isPressed) kx -= 1;
    if (K.letter("d").isPressed || K.right.isPressed) kx += 1;
    if (K.letter("s").isPressed || K.down.isPressed) ky -= 1;
    if (K.letter("w").isPressed || K.up.isPressed) ky += 1;
    let k = new V2(kx, ky);
    if (Gamepad.connected) {
      const stick = Gamepad.leftStick;
      if (stick.sqrMagnitude > 0.06) k = k.add(stick);
      k = k.add(Gamepad.dpad);
    }
    if (k.sqrMagnitude < 0.01) return false;

    this.Direction = k.normalized;
    this.HasDirection = true;
    this.mouseSteering = false;
    this.UsingTouch = false;
    return true;
  }

  private ReadMouse(from: V2) {
    const mp = Mouse.position;
    if (mp.sub(this.lastMouse).sqrMagnitude > 9 || Mouse.leftButton.wasPressedThisFrame) {
      this.mouseSteering = true;
      this.UsingTouch = false;
    }
    this.lastMouse = mp;
    if (!this.mouseSteering) return;

    const d = screenToWorld(mp).sub(from);
    if (d.sqrMagnitude < 0.25) return;
    this.Direction = d.normalized;
    this.HasDirection = true;
  }
}
