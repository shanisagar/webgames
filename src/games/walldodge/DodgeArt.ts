import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";

/**
 * DODGEBALL DASH procedural art: a sunny school playground wall (sky, clouds, school building, trees, fence) with a
 * painted floor strip at the bottom, soft foam dodgeballs, a striped beach ball, a foam noodle bar, power-ups, and a
 * cartoon kid avatar in parts (body, head, dizzy head, legs). Rasterized once by CasualArt and cached.
 */

const sm = CasualArt.smooth;
const mix = (a: Color, b: Color, t: number) => Color.lerp(a, b, t);
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** Floor strip: the bottom of the picture, projected on the floor where the players stand. */
export const FloorTop = -6.0, FeetY = -6.2;
export const P1Col = Pal.hex(0x2ec4ff), P2Col = Pal.hex(0xff5ab4), CpuCol = Pal.hex(0xff9a2e), Lime = Pal.hex(0x7dff4a);

/** The playground wall behind one lane (`halfW` world units either side of its centre, 18 tall). */
export const SceneSprite = (halfW: number) => CasualArt.make("wd-scene-" + halfW, Math.round(halfW * 2 * 30), 18 * 30, (p) => {
  const x = p.x * halfW, y = p.y * halfW;
  const px = 1 / 30;
  if (y < FloorTop) {
    // the floor strip: rubber court with lane paint, lighter near the wall
    const t = Mathf.clamp01((FloorTop - y) / 3);
    let c = mix(Pal.hex(0x3a8f6a), Pal.hex(0x2a6e52), t);
    const n = hash(Math.floor(x * 6) * 1.7 + Math.floor(y * 6) * 3.3);
    c = mix(c, n > 0.5 ? CasualArt.lighten(c, 0.05) : CasualArt.darken(c, 0.05), 0.6);
    c = mix(c, Pal.hex(0xffffff), CasualArt.fill(Math.abs(y - (FloorTop - 0.12)) - 0.06, px) * 0.9);
    c = mix(c, Pal.hex(0xffffff), CasualArt.fill(Math.abs(Math.abs(x) - (halfW - 0.5)) - 0.06, px) * 0.8);
    // dashed centre line along the lane
    if (Math.abs(y - (FloorTop - 1.6)) < 0.05 && ((x + 50) % 1.2) < 0.7) c = mix(c, Pal.hex(0xffe066), 0.8);
    return c.withAlpha(1);
  }
  // sky
  const ty = Mathf.clamp01((y - FloorTop) / 15);
  let c = mix(Pal.hex(0xbfe9ff), Pal.hex(0x5ab8f5), ty);
  for (const [cx, cy, w] of [[-4, 6.2, 2.6], [5, 7.4, 2.2], [12, 5.2, 2.4], [-12, 7.8, 2.0], [0.5, 3.6, 1.6]]) {
    const d = Math.hypot((x - cx) / w, (y - cy) * 1.9);
    const bump = 0.22 * Math.sin((x - cx) * 2.4 + cy);
    c = mix(c, Pal.hex(0xffffff), CasualArt.fill(d - 1 - bump, 0.04) * 0.9);
  }
  // distant trees (behind the school)
  const treeLine = -1.4 + 0.9 * Math.abs(Math.sin(x * 1.3)) + 0.5 * Math.sin(x * 0.37 + 1);
  if (y < treeLine) c = mix(Pal.hex(0x4fa35a), Pal.hex(0x3d8a49), sm(-1, 1, y));
  // school building: brick block with windows and a roof
  const bx = x + 2.5, schoolTop = 1.0;
  if (Math.abs(bx) < 9 && y < schoolTop) {
    let b = mix(Pal.hex(0xe9805a), Pal.hex(0xd4694a), sm(schoolTop, -3, y));
    const row = Math.floor((y + 20) / 0.32), off = row % 2 === 0 ? 0 : 0.35;
    const bxm = ((bx + off + 50) % 0.7), bym = ((y + 20) % 0.32);
    if (bxm < 0.04 || bym < 0.035) b = mix(b, Pal.hex(0xf3c2a8), 0.5);
    const wx = ((bx + 50) % 2.2) - 1.1, wy = y + 1.6;
    if (Math.abs(wx) < 0.55 && Math.abs(wy) < 0.7 && Math.abs(bx) < 8) {
      b = mix(Pal.hex(0x9fdcff), Pal.hex(0x6ab8e8), sm(-0.7, 0.7, wy));
      if (Math.abs(wx) < 0.04 || Math.abs(wy) < 0.04) b = Pal.hex(0xffffff);
    }
    if (y > schoolTop - 0.35) b = Pal.hex(0x8c3b3b);
    c = b;
  }
  // chain-link fence in front, then the play wall (painted blocks) up to the floor
  if (y < -1.6) {
    const wallTop = -2.0;
    if (y < wallTop) {
      // painted play wall: big pastel blocks
      const bw = 2.4, col = Math.floor((x + 100) / bw), rowb = Math.floor((y - FloorTop) / 1.35);
      const pal = [0xffd166, 0x7ad3f0, 0xff8fab, 0x9be38f, 0xc8a2ff].map((h) => Pal.hex(h));
      let b = pal[(col + rowb * 2 + 50) % pal.length];
      b = mix(b, Pal.hex(0xffffff), 0.25);
      const ex = ((x + 100) % bw), ey = ((y - FloorTop) % 1.35);
      if (ex < 0.06 || ey < 0.06) b = mix(b, Pal.hex(0xffffff), 0.7);
      b = mix(b, CasualArt.darken(b, 0.2), sm(wallTop - 0.3, wallTop, y) * 0.6);
      c = b;
    } else {
      const u = (x + y) / 0.3, v = (x - y) / 0.3;
      const du = Math.abs(u - Math.round(u)), dv = Math.abs(v - Math.round(v));
      c = mix(c, Pal.hex(0x7c8a99), Math.max(1 - du / 0.15, 1 - dv / 0.15, 0) * 0.6);
    }
  }
  return c.withAlpha(1);
});

/** Soft foam dodgeball with a seam. */
export const DodgeBall = (col: Color, key: string) => CasualArt.make("wd-ball-" + key, 128, 128, (p) => {
  const px = 2 / 128;
  let c = CasualArt.ballPixel(p, col, px, 0.9);
  if (c.a <= 0) return c;
  const seam = Math.min(Math.abs(Math.hypot(p.x + 0.9, p.y) - 0.95), Math.abs(Math.hypot(p.x - 0.9, p.y) - 0.95)) - 0.035;
  c = Color.lerp(c, CasualArt.darken(col, 0.4), CasualArt.fill(seam, px) * 0.7);
  return CasualArt.over(c, Pal.hex(0x1d1a2e), CasualArt.fill(Math.abs(p.magnitude - 0.9) - px * 1.6, px) * 0.85);
});

/** Striped beach ball. */
export const BeachBall = () => CasualArt.make("wd-beach", 160, 160, (p) => {
  const px = 2 / 160, r = p.magnitude;
  if (r > 0.95) return Color.clear;
  const a = Math.atan2(p.y, p.x * 1.1) + 0.4;
  const seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 6) % 6;
  const cols = [0xff4d5e, 0xffffff, 0x2ec4ff, 0xffffff, 0xffd23f, 0xffffff].map((h) => Pal.hex(h));
  let c = cols[seg];
  if (r < 0.2) c = Pal.hex(0xffffff);
  const z = Math.sqrt(Math.max(0, 1 - (r / 0.92) ** 2));
  c = c.mul(0.65 + 0.4 * Mathf.clamp01(-p.x * 0.45 + p.y * 0.6 + z * 0.66)).withAlpha(1);
  c = mix(c, Color.white, sm(0.3, 0, Math.hypot(p.x + 0.35, p.y - 0.4)) * 0.6);
  c = c.withAlpha(CasualArt.fill(r - 0.92, px));
  return CasualArt.over(c, Pal.hex(0x1d1a2e), CasualArt.fill(Math.abs(r - 0.92) - px * 1.6, px) * 0.85);
});

/** Foam noodle bar (1 wide, 0.25 tall): stretch x to the bar's length. */
export const NoodleSprite = () => CasualArt.make("wd-noodle", 256, 64, (p) => {
  const px = 2 / 256;
  const d = CasualArt.sdBox(p, new V2(0.97, 0.2), 0.2);
  if (d > px) return Color.clear;
  const stripe = Math.floor((p.x + 2) / 0.12) % 2 === 0;
  let c = stripe ? Pal.hex(0xb06bff) : Pal.hex(0xffd23f);
  c = mix(c, CasualArt.darken(c, 0.35), sm(0, 0.22, -p.y));
  c = mix(c, Color.white, sm(0.06, 0, Math.abs(p.y - 0.09)) * 0.45);
  const col = c.withAlpha(CasualArt.fill(d, px));
  return CasualArt.over(col, Pal.hex(0x1d1a2e), CasualArt.fill(Math.abs(d) - px * 2, px) * 0.85);
});

/** Power-up token: a glossy coin with an icon (0 star, 1 heart, 2 shield, 3 slow-mo). */
export const PowerSprite = (kind: number) => CasualArt.make("wd-power-" + kind, 128, 128, (p) => {
  const px = 2 / 128, r = p.magnitude;
  if (r > 0.95) return Color.clear;
  const base = [Pal.hex(0xffc93c), Pal.hex(0xff4d6d), Pal.hex(0x3aa8ff), Pal.hex(0x9b6bff)][kind];
  let c = CasualArt.ballPixel(p, base, px, 0.92);
  let icon = 0;
  if (kind === 0) icon = CasualArt.fill(CasualArt.sdStar(p.mul(1.7).add(new V2(0, 0.08)), 0.92, 0.45), px * 1.7);
  if (kind === 1) {
    const q = new V2(Math.abs(p.x), p.y);
    const lobes = Math.hypot(q.x - 0.27, q.y - 0.12) - 0.3;
    const tri = Math.max(q.x * 1.15 - (q.y + 0.6), q.y - 0.12) / 1.5;
    icon = CasualArt.fill(Math.min(lobes, tri), px);
  }
  if (kind === 2) {
    const d = Math.max(CasualArt.sdBox(new V2(p.x, p.y - 0.08), new V2(0.36, 0.3), 0.08), -(p.y + 0.48 - Math.abs(p.x) * 0.9));
    icon = CasualArt.fill(Math.min(d, CasualArt.sdSegment(p, new V2(0, 0.25), new V2(0, -0.42)) - 0.0), px);
    icon = Math.max(icon, CasualArt.fill(Math.hypot(Math.abs(p.x) - 0.0, p.y + 0.3) - 0.2, px) * (p.y < 0 ? 1 : 0));
  }
  if (kind === 3) {
    // hourglass
    const q = new V2(Math.abs(p.x), Math.abs(p.y));
    const d = Math.max(q.y - 0.5, q.x - (0.08 + q.y * 0.65));
    icon = Math.max(CasualArt.fill(d, px), CasualArt.fill(Math.abs(q.y - 0.52) - 0.05, px) * (q.x < 0.42 ? 1 : 0));
  }
  c = mix(c, Color.white, icon);
  return CasualArt.over(c, Pal.hex(0x1d1a2e), CasualArt.fill(Math.abs(r - 0.92) - px * 1.6, px) * 0.85);
});

/** Kid avatar body (shirt + shorts), 1 wide, 1.3 tall. */
export const BodySprite = (shirt: Color, key: string) => CasualArt.make("wd-body-" + key, 96, 124, (p) => {
  const px = 2 / 96;
  const torso = CasualArt.sdBox(new V2(p.x, p.y - 0.22), new V2(0.62 - Math.max(0, p.y - 0.6) * 0.3, 0.72), 0.32);
  const shorts = CasualArt.sdBox(new V2(p.x, p.y + 0.82), new V2(0.58, 0.3), 0.12);
  const arms = Math.min(CasualArt.sdSegment(p, new V2(-0.62, 0.7), new V2(-0.86, 0.0)), CasualArt.sdSegment(p, new V2(0.62, 0.7), new V2(0.86, 0.0))) - 0.16;
  let col = Color.clear;
  if (arms < px) col = CasualArt.over(col, mix(Pal.hex(0xf0c29a), Pal.hex(0xd9a27a), sm(0.4, 0.0, p.y)), CasualArt.fill(arms, px));
  if (shorts < px) col = CasualArt.over(col, Pal.hex(0x2b3270), CasualArt.fill(shorts, px));
  if (torso < px) {
    let c = mix(CasualArt.lighten(shirt, 0.15), CasualArt.darken(shirt, 0.2), sm(-0.6, 0.6, p.x));
    if (Math.abs(p.y - 0.35) < 0.07) c = mix(c, Color.white, 0.85);
    col = CasualArt.over(col, c.withAlpha(1), CasualArt.fill(torso, px));
  }
  const edge = Math.min(torso, shorts, arms);
  return CasualArt.over(col, Pal.hex(0x1d1a2e), CasualArt.fill(Math.abs(edge) - px * 1.6, px) * 0.9);
});

/** Kid head with cap (dizzy = spiral eyes after a hit). */
export const KidHead = (cap: Color, key: string, dizzy: boolean) => CasualArt.make("wd-head-" + key + (dizzy ? "-d" : ""), 96, 96, (p) => {
  const px = 2 / 96, r = Math.hypot(p.x, p.y + 0.08);
  let col = Color.clear;
  const skin = Pal.hex(0xf0c29a);
  if (r < 0.75 + px) {
    let c = mix(CasualArt.lighten(skin, 0.1), CasualArt.darken(skin, 0.15), sm(-0.6, 0.7, p.x - p.y * 0.4));
    for (const ex of [-0.27, 0.27]) {
      if (dizzy) {
        const q = new V2(p.x - ex, p.y + 0.02), a = Math.atan2(q.y, q.x), rr = q.magnitude;
        const spiral = Math.abs(((rr * 22 - a * 1.2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) < 1.1 && rr < 0.15;
        if (spiral) c = Pal.hex(0x1d1a2e);
      } else {
        c = mix(c, Color.white, CasualArt.fill(Math.hypot(p.x - ex, (p.y + 0.02) * 0.8) - 0.13, px));
        c = mix(c, Pal.hex(0x1d1a2e), CasualArt.fill(Math.hypot(p.x - ex * 0.95, p.y + 0.03) - 0.07, px));
      }
    }
    const mouth = dizzy ? Math.abs(Math.hypot(p.x, p.y + 0.55) - 0.12) - 0.03 : Math.max(Math.abs(Math.hypot(p.x, p.y + 0.18) - 0.22) - 0.035, p.y + 0.22);
    c = mix(c, Pal.hex(0x8a2b3a), CasualArt.fill(mouth, px));
    col = c.withAlpha(CasualArt.fill(r - 0.75, px));
  }
  // cap: dome + brim
  const dome = Math.max(Math.hypot(p.x, p.y - 0.05) - 0.8, -(p.y - 0.3));
  const brim = CasualArt.sdBox(new V2(p.x - 0.42, p.y - 0.3), new V2(0.48, 0.07), 0.06);
  const capD = Math.min(dome, brim);
  if (capD < px) col = CasualArt.over(col, mix(cap, CasualArt.darken(cap, 0.3), sm(0.3, 0.9, p.y - p.x * 0.2)).withAlpha(1), CasualArt.fill(capD, px));
  const outline = Math.min(r - 0.75, capD);
  return CasualArt.over(col, Pal.hex(0x1d1a2e), CasualArt.fill(Math.abs(outline) - px * 1.6, px) * 0.9);
});

/** Leg with a sneaker (1 wide, 3 tall), pivot at the top. */
export const KidLeg = () => CasualArt.make("wd-leg", 32, 96, (p) => {
  const px = 2 / 32;
  const leg = CasualArt.sdSegment(p, new V2(0, 2.6), new V2(0, -1.9)) - 0.42;
  const shoe = CasualArt.sdBox(new V2(p.x - 0.22, p.y + 2.45), new V2(0.8, 0.4), 0.32);
  let col = Color.clear;
  if (leg < px) col = CasualArt.over(col, (p.y > -1.2 ? Pal.hex(0xf0c29a) : Pal.hex(0xffffff)).withAlpha(1), CasualArt.fill(leg, px));
  if (shoe < px) col = CasualArt.over(col, p.y < -2.6 ? Pal.hex(0xffffff) : Pal.hex(0xff4d5e), CasualArt.fill(shoe, px));
  return CasualArt.over(col, Pal.hex(0x1d1a2e), CasualArt.fill(Math.abs(Math.min(leg, shoe)) - px * 1.6, px) * 0.9);
});

/** Warning chevron at the top edge before something drops. */
export const WarnSprite = () => CasualArt.make("wd-warn", 96, 96, (p) => {
  const px = 2 / 96;
  const tri = Math.max(-p.y - 0.75, Math.abs(p.x) * 1.6 + p.y - 0.85);
  let a = CasualArt.fill(tri, px);
  const bang = Math.min(CasualArt.sdSegment(p, new V2(0, 0.35), new V2(0, -0.2)) - 0.09, Math.hypot(p.x, p.y + 0.45) - 0.1);
  const c = mix(Pal.hex(0xffd23f), Pal.hex(0x1d1a2e), CasualArt.fill(bang, px));
  a = Math.max(a, 0);
  return c.withAlpha(a);
});

/** Shield bubble around the avatar. */
export const BubbleSprite = () => CasualArt.make("wd-bubble", 128, 128, (p) => {
  const r = p.magnitude, px = 2 / 128;
  if (r > 0.97) return Color.clear;
  let a = sm(0.55, 0.92, r) * 0.45 + CasualArt.fill(Math.abs(r - 0.9) - 0.04, px) * 0.6;
  a = Math.max(a, sm(0.18, 0, Math.hypot(p.x + 0.38, p.y - 0.42)) * 0.8);
  return new Color(1, 1, 1, a);
});

/** Foot spot on the floor strip (white ring, tinted per player). */
export const FootSprite = () => CasualArt.make("wd-foot", 128, 64, (p) => {
  const px = 2 / 128;
  const e = Math.hypot(p.x, p.y * 2);
  const a = Math.max(CasualArt.fill(Math.abs(e - 0.85) - 0.07, px), sm(0.85, 0, e) * 0.35);
  return new Color(1, 1, 1, a);
});

/** Bonk stars that circle the head after a hit. */
export const BonkSprite = () => CasualArt.make("wd-bonk", 64, 64, (p) => new Color(1, 1, 1, CasualArt.fill(CasualArt.sdStar(p.add(new V2(0, 0.06)), 0.92, 0.45), 2 / 64)));
