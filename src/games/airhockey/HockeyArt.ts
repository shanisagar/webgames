import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";
import { CornerR, GoalHalf, HL, HW } from "./HockeyPhysics";

/**
 * AIR HOCKEY procedural art: a neon rink (dark air-table surface with a hole grid, glowing lines, creases and goal
 * slots), mallets per player colour, the puck, blocker bars and HUD icons. Rasterized once by CasualArt and cached.
 */

const sm = CasualArt.smooth;
const mix = (a: Color, b: Color, t: number) => Color.lerp(a, b, t);

export const Rail = 0.7;
export const RinkW = (HW + Rail) * 2, RinkH = (HL + Rail) * 2;
export const P1Col = Pal.hex(0x22e6ff), P2Col = Pal.hex(0xff3fb4), PuckCol = Pal.hex(0xffe14a);

/** Signed distance to the rink's inner boundary (negative inside). */
function sdRink(x: number, y: number) { return CasualArt.sdBox(new V2(x, y), new V2(HW, HL), CornerR); }

export const RinkSprite = () => CasualArt.make("ah-rink", 456, 776, (p) => {
  const k = RinkW / 2;
  const x = p.x * k, y = p.y * k;
  const px = RinkW / 456;
  const outer = CasualArt.sdBox(new V2(x, y), new V2(HW + Rail, HL + Rail), CornerR + Rail);
  if (outer > px) return Color.clear;
  const aOut = CasualArt.fill(outer, px);
  const d = sdRink(x, y);
  const inMouth = Math.abs(x) < GoalHalf && Math.abs(y) > HL - 0.1;
  if (d > 0 && !inMouth) {
    // rail: dark glossy rim with a neon strip on the inner edge
    let c = mix(Pal.hex(0x0b0e22), Pal.hex(0x1a2050), sm(Rail, 0, d) * 0.7);
    c = mix(c, Pal.hex(0x3a46a0), sm(0.18, 0.02, Math.abs(d - Rail * 0.5)) * 0.25);
    const half = y < 0 ? P1Col : P2Col;
    c = mix(c, CasualArt.lighten(half, 0.3), CasualArt.fill(d - 0.08, px));
    c = mix(c, half, sm(0.45, 0.08, d) * 0.45);
    return c.withAlpha(aOut);
  }
  if (inMouth && Math.abs(y) > HL) {
    // goal slot: a dark pit with a glowing lip
    const g = mix(Pal.hex(0x010104), Pal.hex(0x0b0c22), sm(HL + Rail, HL, Math.abs(y)));
    const lip = CasualArt.fill(Math.abs(Math.abs(y) - HL) - 0.06, px) * 0.9;
    return mix(g, Color.white, lip * 0.6).withAlpha(aOut);
  }
  // surface: deep blue, faint vignette, air holes, glowing markings
  let c = mix(Pal.hex(0x0a1236), Pal.hex(0x132062), sm(HL * 1.2, 0, Math.hypot(x * 1.6, y)) * 0.8);
  const hx = x / 0.5 - Math.round(x / 0.5), hy = y / 0.5 - Math.round(y / 0.5);
  if (Math.hypot(hx, hy) < 0.16) c = CasualArt.darken(c, 0.35);
  const line = (dist: number, col: Color, w = 0.05, glow = 0.35) => {
    c = mix(c, col, sm(glow, 0, dist) * 0.25);
    c = mix(c, CasualArt.lighten(col, 0.35), CasualArt.fill(dist - w, px));
  };
  const half = y < 0 ? P1Col : P2Col;
  line(Math.abs(y), Pal.hex(0xd9e2ff), 0.05);
  line(Math.abs(Math.hypot(x, y) - 2.2), Pal.hex(0xd9e2ff), 0.05);
  if (Math.hypot(x, y) < 0.22) c = mix(c, Pal.hex(0xd9e2ff), 0.9);
  // goal creases
  const cy = Math.sign(y) * HL;
  const cr = Math.hypot(x, y - cy);
  if (Math.abs(y) > HL - 3) line(Math.abs(cr - 2.6), half, 0.05);
  if (cr < 2.6) c = mix(c, half, 0.1);
  // blue lines
  line(Math.abs(Math.abs(y) - HL * 0.45), half.withAlpha(1), 0.035, 0.25);
  // soft inner shadow by the rail
  c = CasualArt.darken(c, sm(-0.5, 0, d) * 0.3);
  return c.withAlpha(aOut);
});

/** A mallet seen from above: coloured base disc, raised handle knob, glossy highlight. */
export const MalletSprite = (col: Color, key: string) => CasualArt.make("ah-mallet-" + key, 128, 128, (p) => {
  const r = p.magnitude, px = 2 / 128;
  const a = CasualArt.fill(r - 0.95, px);
  if (a <= 0) return Color.clear;
  let c = mix(CasualArt.darken(col, 0.45), col, sm(0.95, 0.6, r));
  c = mix(c, CasualArt.lighten(col, 0.6), CasualArt.fill(Math.abs(r - 0.9) - 0.03, px) * 0.8);
  // handle
  const kr = Math.hypot(p.x + 0.04, p.y - 0.05);
  if (kr < 0.48) {
    const shade = sm(0.48, 0, kr);
    let k = mix(CasualArt.darken(col, 0.25), CasualArt.lighten(col, 0.25), shade);
    k = mix(k, Color.white, sm(0.22, 0, Math.hypot(p.x + 0.18, p.y - 0.2)) * 0.8);
    c = mix(c, k, CasualArt.fill(kr - 0.46, px));
  }
  c = mix(c, Pal.hex(0x05060f), CasualArt.fill(Math.abs(kr - 0.5) - 0.025, px) * 0.6);
  return c.withAlpha(a);
});

export const PuckSprite = () => CasualArt.make("ah-puck", 112, 112, (p) => {
  const r = p.magnitude, px = 2 / 112;
  const a = CasualArt.fill(r - 0.95, px);
  if (a <= 0) return Color.clear;
  let c = mix(Pal.hex(0x14161e), Pal.hex(0x2a2e3e), sm(0.9, 0.2, Math.hypot(p.x + 0.2, p.y - 0.25)));
  c = mix(c, PuckCol, CasualArt.fill(Math.abs(r - 0.8) - 0.07, px));
  c = mix(c, CasualArt.lighten(PuckCol, 0.5), CasualArt.fill(Math.abs(r - 0.8) - 0.025, px) * 0.6);
  c = mix(c, PuckCol, CasualArt.fill(r - 0.16, px) * 0.8);
  return c.withAlpha(a);
});

/** Neon capsule bar (solo blockers), 1 unit wide, aspect 4:1. */
export const BlockerSprite = () => CasualArt.make("ah-blocker", 256, 64, (p) => {
  const d = CasualArt.sdBox(p, new V2(0.96, 0.21), 0.21), px = 2 / 256;
  const glow = sm(0.03, -0.0, d);
  if (d > 0.03) return Color.clear;
  let c = mix(Pal.hex(0xff7a1a), Pal.hex(0xffd36a), sm(0.21, -0.1, Math.abs(p.y)));
  c = mix(c, Color.white, CasualArt.fill(Math.abs(p.y + 0.02) - 0.03, px) * 0.6 * CasualArt.fill(Math.abs(p.x) - 0.8, px));
  return c.withAlpha(Math.max(CasualArt.fill(d, px), glow * 0.3));
});

export const HoleGlow = () => CasualArt.make("ah-goal-glow", 128, 64, (p) => {
  const a = Math.exp(-(p.x * p.x * 3 + p.y * p.y * 18));
  return new Color(1, 1, 1, Mathf.clamp01(a));
});

export const GoldCoin = () => CasualArt.make("ah-gold", 96, 96, (p) => {
  const c = CasualArt.ballPixel(p, Pal.hex(0xffc93c), 2 / 96, 0.92);
  if (c.a <= 0) return c;
  return mix(c, Pal.hex(0xd08a10), CasualArt.fill(Math.abs(p.magnitude - 0.6) - 0.06, 2 / 96) * 0.7);
});
