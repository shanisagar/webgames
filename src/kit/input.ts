import { Rect, V2 } from "./math";
import { Camera } from "./render";
import { Time } from "./scene";

/**
 * Raw device state with Unity Input System semantics (isPressed / wasPressedThisFrame / wasReleasedThisFrame).
 * Screen coordinates follow Unity: device pixels with y up from the bottom of the game area.
 */

/** UnityEngine.Screen for the game area. */
export const Screen = {
  width: 1,
  height: 1,
  /** Device pixels per CSS pixel. */
  dpr: 1,
  /** Unity reports ~160 dpi per "dp"; browsers use 96 CSS px per inch. */
  get dpi() { return 96 * this.dpr; },
  /** Safe area in device pixels, y up (notches, home indicator). */
  safeArea: new Rect(0, 0, 1, 1),
  /** The element the game lives in (for CSS → screen conversion). */
  el: null as HTMLElement | null,
};

class ButtonState {
  isPressed = false;
  wasPressedThisFrame = false;
  wasReleasedThisFrame = false;
  private down = false;
  private pendingDown = false;
  private pendingUp = false;
  set(down: boolean) {
    if (down && !this.down) this.pendingDown = true;
    if (!down && this.down) this.pendingUp = true;
    this.down = down;
  }
  frame() {
    this.wasPressedThisFrame = this.pendingDown;
    this.wasReleasedThisFrame = this.pendingUp;
    this.isPressed = this.down || this.pendingDown;
    this.pendingDown = this.pendingUp = false;
  }
}

export class TouchState {
  readonly press = new ButtonState();
  position = V2.zero;
  startPosition = V2.zero;
  constructor(readonly touchId: number) {}
}

const keys = new Map<string, ButtonState>();
const key = (code: string) => {
  let k = keys.get(code);
  if (!k) { k = new ButtonState(); keys.set(code, k); }
  return k;
};

/** Keyboard.current: Keyboard.key("KeyA").isPressed, Keyboard.space.wasPressedThisFrame, ... */
export const Keyboard = {
  key,
  get space() { return key("Space"); },
  get enter() { return key("Enter"); },
  get numpadEnter() { return key("NumpadEnter"); },
  get escape() { return key("Escape"); },
  get left() { return key("ArrowLeft"); },
  get right() { return key("ArrowRight"); },
  get up() { return key("ArrowUp"); },
  get down() { return key("ArrowDown"); },
  get leftShift() { return key("ShiftLeft"); },
  get rightShift() { return key("ShiftRight"); },
  get backspace() { return key("Backspace"); },
  /** Letters: Keyboard.letter("a"). */
  letter(ch: string) { return key("Key" + ch.toUpperCase()); },
  digit(n: number) { return key("Digit" + n); },
  /** Characters typed this frame (word games). */
  typed: [] as string[],
  anyKeyPressed: false,
};

export const Mouse = {
  position: V2.zero,
  leftButton: new ButtonState(),
  rightButton: new ButtonState(),
  /** Wheel delta this frame (positive = scroll up, like Unity). */
  scroll: 0,
  present: false,
};

const touchMap = new Map<number, TouchState>();
export const Touchscreen = {
  touches: [] as TouchState[],
  get primaryTouch(): TouchState | null { return this.touches[0] ?? null; },
  present: false,
};

export const Gamepad = {
  connected: false,
  leftStick: V2.zero,
  rightStick: V2.zero,
  dpad: V2.zero,
  buttonSouth: new ButtonState(),
  buttonWest: new ButtonState(),
  buttonEast: new ButtonState(),
  buttonNorth: new ButtonState(),
  start: new ButtonState(),
  leftShoulder: new ButtonState(),
  rightShoulder: new ButtonState(),
  leftTrigger: new ButtonState(),
  rightTrigger: new ButtonState(),
};

let wheelAccum = 0;
let typedAccum: string[] = [];

/** CSS client point → Unity screen point (device px, y up) inside the game element. */
export function clientToScreen(cx: number, cy: number) {
  const r = Screen.el?.getBoundingClientRect();
  const x = cx - (r?.left ?? 0), y = cy - (r?.top ?? 0);
  return new V2(x * Screen.dpr, Screen.height - y * Screen.dpr);
}

/** Unity screen point → CSS client point (for elementFromPoint). */
export function screenToClient(p: V2) {
  const r = Screen.el?.getBoundingClientRect();
  return { x: p.x / Screen.dpr + (r?.left ?? 0), y: (Screen.height - p.y) / Screen.dpr + (r?.top ?? 0) };
}

/** True when a UI raycast target (button, panel) is under the screen point. */
export function overUI(screen: V2) {
  const c = screenToClient(screen);
  const el = document.elementFromPoint(c.x, c.y);
  return !!el?.closest?.(".na-hit");
}

export function screenToWorld(screen: V2) {
  return Camera.screenToWorld(screen.x, Screen.height - screen.y);
}

const listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];
const on = (t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
  t.addEventListener(type, fn, opts);
  listeners.push([t, type, fn, opts]);
};

export const InputSystem = {
  attach(el: HTMLElement) {
    Screen.el = el;
    on(window, "keydown", ((e: KeyboardEvent) => {
      if (e.repeat) return;
      key(e.code).set(true);
      if (e.key.length === 1) typedAccum.push(e.key);
      else if (e.key === "Backspace" || e.key === "Enter") typedAccum.push(e.key);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code) && !(e.target as HTMLElement)?.closest?.("input,textarea")) e.preventDefault();
    }) as EventListener);
    on(window, "keyup", ((e: KeyboardEvent) => key(e.code).set(false)) as EventListener);
    on(window, "blur", () => { for (const k of keys.values()) k.set(false); Mouse.leftButton.set(false); Mouse.rightButton.set(false); });

    on(el, "pointerdown", ((e: PointerEvent) => {
      const p = clientToScreen(e.clientX, e.clientY);
      if (e.pointerType === "touch" || e.pointerType === "pen") {
        Touchscreen.present = true;
        const t = new TouchState(e.pointerId);
        t.position = t.startPosition = p;
        t.press.set(true);
        touchMap.set(e.pointerId, t);
      } else {
        Mouse.present = true;
        Mouse.position = p;
        if (e.button === 0) Mouse.leftButton.set(true);
        if (e.button === 2) Mouse.rightButton.set(true);
      }
    }) as EventListener);
    const move = ((e: PointerEvent) => {
      const p = clientToScreen(e.clientX, e.clientY);
      const t = touchMap.get(e.pointerId);
      if (t) t.position = p;
      else if (e.pointerType === "mouse") Mouse.position = p;
    }) as EventListener;
    on(window, "pointermove", move);
    const up = ((e: PointerEvent) => {
      const t = touchMap.get(e.pointerId);
      if (t) { t.position = clientToScreen(e.clientX, e.clientY); t.press.set(false); }
      else if (e.pointerType === "mouse") {
        if (e.button === 0) Mouse.leftButton.set(false);
        if (e.button === 2) Mouse.rightButton.set(false);
      }
    }) as EventListener;
    on(window, "pointerup", up);
    on(window, "pointercancel", up);
    on(el, "wheel", ((e: WheelEvent) => { wheelAccum -= e.deltaY; e.preventDefault(); }) as EventListener, { passive: false });
    on(el, "contextmenu", (e) => e.preventDefault());
  },

  detach() {
    for (const [t, type, fn, opts] of listeners) t.removeEventListener(type, fn, opts);
    listeners.length = 0;
    keys.clear();
    touchMap.clear();
  },

  /** Called once per frame before the game updates. */
  beginFrame() {
    for (const k of keys.values()) k.frame();
    Keyboard.typed = typedAccum;
    typedAccum = [];
    Keyboard.anyKeyPressed = Keyboard.typed.length > 0;
    Mouse.leftButton.frame();
    Mouse.rightButton.frame();
    Mouse.scroll = wheelAccum;
    wheelAccum = 0;
    for (const t of touchMap.values()) t.press.frame();
    Touchscreen.touches = [...touchMap.values()];
    // forget touches released last frame
    for (const [id, t] of touchMap) if (!t.press.isPressed && !t.press.wasReleasedThisFrame) touchMap.delete(id);
    pollGamepad();
  },
};

function pollGamepad() {
  const pads = navigator.getGamepads?.() ?? [];
  const pad = [...pads].find((p) => p && p.connected);
  Gamepad.connected = !!pad;
  if (!pad) return;
  const ax = (i: number) => (Math.abs(pad.axes[i] ?? 0) > 0.15 ? pad.axes[i] : 0);
  const b = (i: number) => !!pad.buttons[i]?.pressed;
  Gamepad.leftStick = new V2(ax(0), -ax(1));
  Gamepad.rightStick = new V2(ax(2), -ax(3));
  Gamepad.dpad = new V2((b(15) ? 1 : 0) - (b(14) ? 1 : 0), (b(12) ? 1 : 0) - (b(13) ? 1 : 0));
  const map: [ButtonState, number][] = [[Gamepad.buttonSouth, 0], [Gamepad.buttonEast, 1], [Gamepad.buttonWest, 2], [Gamepad.buttonNorth, 3],
    [Gamepad.leftShoulder, 4], [Gamepad.rightShoulder, 5], [Gamepad.leftTrigger, 6], [Gamepad.rightTrigger, 7], [Gamepad.start, 9]];
  for (const [s, i] of map) { s.set(b(i)); s.frame(); }
}

/** Unity's dp → pixels (Screen.dpi / 160). */
export const dp = (v: number) => v * (Screen.dpi > 1 ? Screen.dpi / 160 : 1.5);

// ------------------------------------------------------------------ ArcadeInput

/** How touches map to controls. */
export enum TouchScheme {
  /** Touches are taps only (board and strategy games). */
  None,
  /** A floating stick anywhere on screen drives Move. */
  Stick,
  /** Left half = move stick, right half = aim/fire stick. */
  TwinStick,
  /** Holding the left / right half steers; both halves = brake. */
  Halves,
}

export class VirtualStick {
  active = false;
  touchId = -1;
  origin = V2.zero;
  current = V2.zero;
  value = V2.zero;
}

const HUD_BAND = 0.12;

/**
 * One input model for every game and device: keyboard, mouse, gamepad and multi-touch. Touches that start on UI
 * are ignored so on-screen buttons never double as game input (ArcadeInput.cs).
 */
export class ArcadeInput {
  scheme = TouchScheme.None;
  readonly left = new VirtualStick();
  readonly right = new VirtualStick();
  move = V2.zero;
  aim = V2.zero;
  aimActive = false;
  fire = false;
  steer = 0;
  brake = false;
  sprint = false;
  actionPressed = false;
  action2Pressed = false;
  tapped = false;
  tapScreen = V2.zero;
  pointerScreen = V2.zero;
  usingTouch = false;
  private mouseAim = false;
  private lastMouse = V2.zero;
  private pressPos = V2.zero;
  private pressTime = 0;
  private pressValid = false;
  private tapTouchId = -1;

  init() { this.usingTouch = matchMedia?.("(pointer: coarse)").matches ?? false; }

  reset() {
    for (const s of [this.left, this.right]) { s.active = false; s.touchId = -1; s.value = V2.zero; }
    this.move = this.aim = V2.zero;
    this.aimActive = this.fire = this.brake = this.sprint = this.actionPressed = this.action2Pressed = this.tapped = false;
    this.steer = 0;
    this.pressValid = false;
    this.tapTouchId = -1;
  }

  update(aimOrigin: V2) {
    this.move = this.aim = V2.zero;
    this.aimActive = this.fire = this.brake = this.sprint = this.actionPressed = this.action2Pressed = this.tapped = false;
    this.steer = 0;
    this.readTouch();
    this.readKeyboard();
    this.readGamepad();
    this.readMouse(aimOrigin);
    if (this.move.sqrMagnitude > 1) this.move = this.move.normalized;
    this.steer = Math.max(-1, Math.min(1, this.steer));
  }

  private readTouch() {
    if (!Touchscreen.present) return;
    let leftHalf = false, rightHalf = false;
    for (const t of Touchscreen.touches) {
      const id = t.touchId, pressed = t.press.isPressed, pos = t.position;
      if (t.press.wasPressedThisFrame) {
        this.usingTouch = true;
        if (!(pos.y > Screen.height * (1 - HUD_BAND) || overUI(pos))) {
          const isLeft = pos.x < Screen.width * 0.5;
          switch (this.scheme) {
            case TouchScheme.Stick: if (!this.left.active) this.begin(this.left, id, pos); break;
            case TouchScheme.TwinStick:
              if (isLeft && !this.left.active) this.begin(this.left, id, pos);
              else if (!isLeft && !this.right.active) this.begin(this.right, id, pos);
              break;
            case TouchScheme.None:
              if (this.tapTouchId < 0) { this.tapTouchId = id; this.pressPos = pos; this.pressTime = Time.unscaledTime; }
              break;
          }
        }
      }
      if (this.scheme === TouchScheme.Halves && pressed && pos.y < Screen.height * (1 - HUD_BAND) && !overUI(pos)) {
        if (pos.x < Screen.width * 0.5) leftHalf = true;
        else rightHalf = true;
      }
      if (id === this.tapTouchId) {
        this.pointerScreen = pos;
        if (t.press.wasReleasedThisFrame || !pressed) {
          if (pos.sub(this.pressPos).magnitude < dp(18) && Time.unscaledTime - this.pressTime < 0.5) { this.tapped = true; this.tapScreen = pos; }
          this.tapTouchId = -1;
        }
      }
      this.updateStick(this.left, id, pressed, pos);
      this.updateStick(this.right, id, pressed, pos);
    }
    if (this.scheme === TouchScheme.Halves) {
      if (leftHalf && rightHalf) this.brake = true;
      else if (leftHalf) this.steer -= 1;
      else if (rightHalf) this.steer += 1;
    }
    if (this.left.active) { this.move = this.move.add(this.left.value); this.sprint ||= this.left.value.magnitude > 0.9; }
    if (this.right.active && this.right.value.sqrMagnitude > 0.01) { this.aim = this.right.value.normalized; this.aimActive = true; this.fire = true; }
  }

  private begin(s: VirtualStick, id: number, pos: V2) { s.active = true; s.touchId = id; s.origin = s.current = pos; s.value = V2.zero; }

  private updateStick(s: VirtualStick, id: number, pressed: boolean, pos: V2) {
    if (!s.active || s.touchId !== id) return;
    if (!pressed) { s.active = false; s.touchId = -1; s.value = V2.zero; return; }
    const max = dp(60);
    let d = pos.sub(s.origin);
    if (d.magnitude > max) { s.origin = pos.sub(d.normalized.mul(max)); d = pos.sub(s.origin); }
    s.current = pos;
    s.value = d.magnitude < dp(6) ? V2.zero : d.div(max);
  }

  private readKeyboard() {
    const K = Keyboard;
    let kx = 0, ky = 0;
    if (K.letter("a").isPressed || K.left.isPressed) kx -= 1;
    if (K.letter("d").isPressed || K.right.isPressed) kx += 1;
    if (K.letter("s").isPressed || K.down.isPressed) ky -= 1;
    if (K.letter("w").isPressed || K.up.isPressed) ky += 1;
    if (kx || ky) { this.usingTouch = false; this.move = this.move.add(new V2(kx, ky)); this.steer += kx; }
    if (K.letter("s").isPressed || K.down.isPressed) this.brake = true;
    if (K.leftShift.isPressed || K.rightShift.isPressed) this.sprint = true;
    if (K.space.wasPressedThisFrame || K.letter("e").wasPressedThisFrame) this.actionPressed = true;
    if (K.letter("q").wasPressedThisFrame || K.letter("f").wasPressedThisFrame) this.action2Pressed = true;
  }

  private readGamepad() {
    if (!Gamepad.connected) return;
    const ls = Gamepad.leftStick;
    if (ls.sqrMagnitude > 0.04) { this.move = this.move.add(ls); this.steer += ls.x; this.usingTouch = false; }
    this.move = this.move.add(Gamepad.dpad);
    this.steer += Gamepad.dpad.x;
    const rs = Gamepad.rightStick;
    if (rs.sqrMagnitude > 0.09) { this.aim = rs.normalized; this.aimActive = true; this.fire = true; this.mouseAim = false; }
    if (Gamepad.rightTrigger.isPressed) this.fire = true;
    if (Gamepad.leftTrigger.isPressed) { this.brake = true; this.sprint = true; }
    if (Gamepad.buttonSouth.wasPressedThisFrame || Gamepad.rightShoulder.wasPressedThisFrame) this.actionPressed = true;
    if (Gamepad.buttonWest.wasPressedThisFrame || Gamepad.leftShoulder.wasPressedThisFrame) this.action2Pressed = true;
  }

  private readMouse(aimOrigin: V2) {
    if (!Mouse.present || (this.usingTouch && Touchscreen.present)) return;
    const mp = Mouse.position;
    if (mp.sub(this.lastMouse).sqrMagnitude > 4 || Mouse.leftButton.wasPressedThisFrame) this.mouseAim = true;
    this.lastMouse = mp;
    this.pointerScreen = mp;
    if (Mouse.leftButton.wasPressedThisFrame) { this.pressValid = !overUI(mp); this.pressPos = mp; this.pressTime = Time.unscaledTime; }
    if (Mouse.leftButton.wasReleasedThisFrame && this.pressValid) {
      if (mp.sub(this.pressPos).magnitude < 12 && Time.unscaledTime - this.pressTime < 0.6) { this.tapped = true; this.tapScreen = mp; }
      this.pressValid = false;
    }
    if (!this.aimActive && this.mouseAim) {
      const d = screenToWorld(mp).sub(aimOrigin);
      if (d.sqrMagnitude > 0.04) { this.aim = d.normalized; this.aimActive = true; }
    }
    if (Mouse.leftButton.isPressed && this.pressValid) this.fire = true;
    if (Mouse.rightButton.wasPressedThisFrame) this.actionPressed = true;
  }
}

// ------------------------------------------------------------------ TapPointer

/**
 * Reads one pointer (primary touch, else mouse) for tap / drag games. Presses that start on UI or in the top HUD
 * band are ignored (CasualKit.cs TapPointer).
 */
export class TapPointer {
  /** Fraction of the screen height at the top that never starts a press (HUD). */
  topBand = 0.1;
  down = false;
  held = false;
  up = false;
  screen = V2.zero;
  startScreen = V2.zero;
  heldTime = 0;
  usingTouch = false;
  private valid = false;

  reset() { this.down = this.held = this.up = this.valid = false; this.heldTime = 0; }

  update(dt: number) {
    this.down = this.up = false;
    let pressed = false, pressedNow = false, releasedNow = false, pos = this.screen, got = false;
    const t = Touchscreen.primaryTouch;
    if (t && (t.press.isPressed || t.press.wasPressedThisFrame || t.press.wasReleasedThisFrame)) {
      pressed = t.press.isPressed && !t.press.wasReleasedThisFrame;
      pressedNow = t.press.wasPressedThisFrame;
      releasedNow = t.press.wasReleasedThisFrame;
      pos = t.position;
      got = true;
      this.usingTouch = true;
    }
    if (!got && !(this.usingTouch && this.valid) && Mouse.present) {
      pressed = Mouse.leftButton.isPressed;
      pressedNow = Mouse.leftButton.wasPressedThisFrame;
      releasedNow = Mouse.leftButton.wasReleasedThisFrame;
      pos = Mouse.position;
      if (pressedNow) this.usingTouch = false;
    }
    if (pressedNow) {
      this.valid = pos.y < Screen.height * (1 - this.topBand) && !overUI(pos);
      this.startScreen = pos;
      this.heldTime = 0;
      if (this.valid) { this.down = true; this.held = true; }
    } else if (pressed && this.valid) {
      this.held = true;
      this.heldTime += dt;
    }
    if ((releasedNow || !pressed) && this.valid) {
      if (this.held || this.down) this.up = true;
      this.held = false;
      this.valid = false;
    }
    this.screen = pos;
  }

  /** True on release when the pointer barely moved (a tap rather than a drag). */
  get tap() { return this.up && this.screen.sub(this.startScreen).magnitude < dp(16) && this.heldTime < 0.6; }

  static dp = dp;
}
