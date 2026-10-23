import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";
import { CornerR, GoalHalf, HH, HW } from "./RinkPhysics";

/**
 * AIR HOCKEY WALL procedural art: a neon arcade rink laid across the whole wall (dark air surface with a hole grid,
 * glowing centre line and circle, team-coloured creases and rails, goal slots), the puck, goalie paddle, blockers,
 * a bumper for the closed solo end and the throw-zone hand marker. Rasterized once by CasualArt and cached.
 */

const sm = CasualArt.smooth;
const mix = (a: Color, b: Color, t: number) => Color.lerp(a, b, t);

export const Rail = 0.75;
export const RinkW = (HW + Rail) * 2, RinkH = (HH + Rail) * 2;
export const P1Col = Pal.hex(0x22e6ff), P2Col = Pal.hex(0xff3fb4), PuckCol = Pal.hex(0xffe14a), CpuCol = Pal.hex(0xff9a2e);

function sdRink(x: number, y: number) { return CasualArt.sdBox(new V2(x, y), new V2(HW, HH), CornerR); }

export const RinkSprite = () => CasualArt.make("wh-rink", 1000, Math.round(1000 * RinkH / RinkW), (p) => {
  const k = RinkW / 2;
  const x = p.x * k, y = p.y * k;
  const px = RinkW / 1000;
  const outer = CasualArt.sdBox(new V2(x, y), new V2(HW + Rail, HH + Rail), CornerR + Rail);
  if (outer > px) return Color.clear;
  const aOut = CasualArt.fill(outer, px);
  const d = sdRink(x, y);
  const inMouth = Math.abs(y) < GoalHalf && Math.abs(x) > HW - 0.1;
  const half = x < 0 ? P1Col : P2Col;
  if (d > 0 && !inMouth) {
    // rail: dark glossy rim with a neon strip on the inner edge
    let c = mix(Pal.hex(0x0b0e22), Pal.hex(0x1a2050), sm(Rail, 0, d) * 0.7);
    c = mix(c, CasualArt.lighten(half, 0.35), CasualArt.fill(d - 0.1, px));
    c = mix(c, half, sm(0.5, 0.1, d) * 0.5);
    c = mix(c, Pal.hex(0x3a46a0), sm(0.12, 0.02, Math.abs(d - Rail * 0.62)) * 0.4);
    return c.withAlpha(aOut);
  }
  if (inMouth && Math.abs(x) > HW) {
    const g = mix(Pal.hex(0x010104), Pal.hex(0x0b0c22), sm(HW + Rail, HW, Math.abs(x)));
    const lip = CasualArt.fill(Math.abs(Math.abs(x) - HW) - 0.07, px) * 0.9;
    return mix(g, mix(Color.white, half, 0.4), lip * 0.8).withAlpha(aOut);
  }
  // surface: deep blue, vignette, air holes, glowing markings
  let c = mix(Pal.hex(0x0a1236), Pal.hex(0x142266), sm(HW * 1.1, 0, Math.hypot(x, y * 1.8)) * 0.8);
  const hx = x / 0.66 - Math.round(x / 0.66), hy = y / 0.66 - Math.round(y / 0.66);
  if (Math.hypot(hx, hy) < 0.15) c = CasualArt.darken(c, 0.4);
  const line = (dist: number, col: Color, w = 0.07, glow = 0.45) => {
    c = mix(c, col, sm(glow, 0, dist) * 0.28);
    c = mix(c, CasualArt.lighten(col, 0.35), CasualArt.fill(dist - w, px));
  };
  line(Math.abs(x), Pal.hex(0xd9e2ff), 0.08);
  line(Math.abs(Math.hypot(x, y) - 3.0), Pal.hex(0xd9e2ff), 0.07);
  if (Math.hypot(x, y) < 3.0) c = mix(c, Pal.hex(0x1d2c80), 0.5);
  const gx = Math.sign(x) * HW, cr = Math.hypot(x - gx, y);
  if (Math.abs(x) > HW - 4) line(Math.abs(cr - 3.6), half, 0.07);
  if (cr < 3.6) c = mix(c, half, 0.1);
  line(Math.abs(Math.abs(x) - HW * 0.45), half, 0.05, 0.3);
  // face-off spots
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) if (Math.hypot(x - sx * HW * 0.62, y - sy * HH * 0.5) < 0.22) c = mix(c, half, 0.9);
  c = CasualArt.darken(c, sm(-0.6, 0, d) * 0.3);
  return c.withAlpha(aOut);
});

export const PuckSprite = () => CasualArt.make("wh-puck", 128, 128, (p) => {
  const r = p.magnitude, px = 2 / 128;
  const a = CasualArt.fill(r - 0.95, px);
  if (a <= 0) return Color.clear;
  let c = mix(Pal.hex(0x14161e), Pal.hex(0x30344a), sm(0.9, 0.2, Math.hypot(p.x + 0.2, p.y - 0.25)));
  c = mix(c, PuckCol, CasualArt.fill(Math.abs(r - 0.78) - 0.09, px));
  c = mix(c, CasualArt.lighten(PuckCol, 0.6), CasualArt.fill(Math.abs(r - 0.78) - 0.03, px) * 0.7);
  c = mix(c, PuckCol, CasualArt.fill(r - 0.2, px) * 0.85);
  c = mix(c, Color.white, CasualArt.fill(r - 0.08, px) * 0.6);
  return c.withAlpha(a);
});

/** Vertical neon capsule (goalie / blocker), 1 wide, 4 tall: scale y to its length. */
export const PaddleSprite = (col: Color, key: string) => CasualArt.make("wh-paddle-" + key, 48, 192, (p) => {
  const px = 2 / 48;
  const d = CasualArt.sdBox(p, new V2(0.8, 3.85), 0.8);
  if (d > 0.15) return Color.clear;
  let c = mix(CasualArt.darken(col, 0.3), CasualArt.lighten(col, 0.35), sm(-0.8, 0.5, -p.x));
  c = mix(c, Color.white, CasualArt.fill(Math.abs(p.x + 0.25) - 0.1, px) * 0.5 * sm(3.6, 2.5, Math.abs(p.y)));
  return c.withAlpha(Math.max(CasualArt.fill(d, px), sm(0.15, 0, d) * 0.35));
});

/** Closed end for solo (a glowing bumper across the left slot), 1 wide, 6 tall. */
export const BumperSprite = () => CasualArt.make("wh-bumper", 32, 192, (p) => {
  const px = 2 / 32;
  const d = CasualArt.sdBox(p, new V2(0.55, 5.7), 0.5);
  if (d > 0.3) return Color.clear;
  const stripe = Math.floor((p.y + 10) / 0.9) % 2 === 0;
  const c = stripe ? Pal.hex(0xffc93c) : Pal.hex(0x1a1d2b);
  return c.withAlpha(Math.max(CasualArt.fill(d, px), sm(0.3, 0, d) * 0.4));
});

/** Throw-zone hint: a big hand + ball silhouette, white (tinted per player). */
export const ZoneSprite = () => CasualArt.make("wh-zone", 128, 128, (p) => {
  const px = 2 / 128;
  const ball = CasualArt.fill(Math.hypot(p.x - 0.35, p.y - 0.35) - 0.38, px);
  const ring = CasualArt.fill(Math.abs(p.magnitude - 0.88) - 0.05, px);
  return new Color(1, 1, 1, Math.max(ball, ring) * 0.9);
});

export const GlowDisc = () => CasualArt.make("wh-glow", 64, 64, (p) => { const d = p.magnitude; return new Color(1, 1, 1, Mathf.clamp01(1 - d) ** 2); });
