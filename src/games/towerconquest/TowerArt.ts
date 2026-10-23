import { CasualArt, Color, Mathf, Pal, Sprite } from "../../kit";

/**
 * Procedural art for Tower Conquest: three castle towers (outpost, keep, fortress), each baked as a stone layer and a
 * white "paint" layer (roofs, banners, flags) that is tinted with the owner's colour, plus marching troop dots,
 * meadow decor (trees, bushes, rocks, flowers), the garrison pill and a few HUD icons.
 */

const clamp01 = Mathf.clamp01;
const fill = (d: number, px: number) => clamp01(0.5 - d / px);
const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const sdBox = (x: number, y: number, hw: number, hh: number, r: number) => {
  const qx = Math.abs(x) - hw + r, qy = Math.abs(y) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const sdCirc = (x: number, y: number, r: number) => Math.hypot(x, y) - r;
const sdSeg = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = clamp01((pax * bax + pay * bay) / Math.max(1e-9, bax * bax + bay * bay));
  return Math.hypot(pax - bax * h, pay - bay * h);
};
/** Signed distance to a triangle (negative inside). */
function sdTri(x: number, y: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const d = Math.min(sdSeg(x, y, ax, ay, bx, by), sdSeg(x, y, bx, by, cx, cy), sdSeg(x, y, cx, cy, ax, ay));
  const s1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const s2 = (cx - bx) * (y - by) - (cy - by) * (x - bx);
  const s3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  const inside = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  return inside ? -d : d;
}
const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

class Px {
  r = 0; g = 0; b = 0; a = 0;
  reset() { this.r = this.g = this.b = this.a = 0; return this; }
  over(c: Color, a = 1) {
    const sa = c.a * clamp01(a);
    if (sa <= 0) return this;
    const oa = sa + this.a * (1 - sa);
    this.r = (c.r * sa + this.r * this.a * (1 - sa)) / oa;
    this.g = (c.g * sa + this.g * this.a * (1 - sa)) / oa;
    this.b = (c.b * sa + this.b * this.a * (1 - sa)) / oa;
    this.a = oa;
    return this;
  }
  get color() { return new Color(this.r, this.g, this.b, this.a); }
}
const P = new Px();

const Ink = Pal.hex(0x4a3a2c);
const StoneHi = Pal.hex(0xf3ead8), StoneLo = Pal.hex(0xa89272);
const Wood = Pal.hex(0x6b4426), WoodDark = Pal.hex(0x3e2715);
const W = 200, H = 240, PX = 2 / W, OL = 0.035;

/** A stone part: fill + outline + vertical light, cylinder shading and brick rows. */
function stone(px: Px, d: number, x: number, y: number, cx: number, hw: number, round: boolean, tone = 1) {
  if (d > OL + PX) return;
  const u = Mathf.clamp((x - cx) / hw, -1, 1);
  let k = round ? 1 - 0.32 * u * u + 0.1 * -u : 0.95 + 0.06 * -Math.sign(u) * smooth(0.7, 1, Math.abs(u));
  k *= 0.92 + 0.08 * smooth(-1, 0.5, y);
  const row = Math.floor((y + 3) / 0.17), off = row % 2 ? 0.11 : 0;
  const bx = ((x - cx + off + 4) % 0.22) / 0.22, by = ((y + 3) % 0.17) / 0.17;
  const mortar = Math.min(bx, 1 - bx) * 0.22 < 0.012 || Math.min(by, 1 - by) * 0.17 < 0.012 ? 1 : 0;
  let c = Color.lerp(StoneLo, StoneHi, clamp01(k * tone - 0.15 + hash(row, Math.floor((x - cx + off + 4) / 0.22)) * 0.12));
  c = Color.lerp(c, StoneLo, mortar * 0.45);
  px.over(Ink, fill(d, PX));
  px.over(c, fill(d + OL, PX));
}

/** A painted part (white, shaded in grey so the owner's tint keeps light and shadow). */
function paint(px: Px, d: number, shade: number) {
  if (d > OL + PX) return;
  px.over(new Color(0.25, 0.25, 0.28, 1), fill(d, PX));
  const v = clamp01(shade);
  px.over(new Color(v, v, v, 1), fill(d + OL, PX));
}

function dark(px: Px, d: number, c: Color) { px.over(c, fill(d, PX)); }

function door(px: Px, x: number, y: number, cx: number, by: number, w: number, h: number) {
  const d = Math.min(sdBox(x - cx, y - (by + h * 0.4), w, h * 0.4, 0.01), sdCirc(x - cx, y - (by + h * 0.8), w));
  if (d > PX * 2) return;
  px.over(WoodDark, fill(d, PX));
  const plank = Math.abs(((x - cx + w) / (w * 2 / 3)) % 1 - 0.5) > 0.42 ? 0.6 : 1;
  px.over(Color.lerp(WoodDark, Wood, plank * smooth(by, by + h, y) * 0.9 + 0.1), fill(d + 0.025, PX));
}

function windowSlit(px: Px, x: number, y: number, cx: number, cy: number, w = 0.05, h = 0.12) {
  const d = Math.min(sdBox(x - cx, y - cy, w, h, w * 0.9), sdCirc(x - cx, y - cy - h, w));
  dark(px, d, Pal.hex(0x3a2c22));
}

function groundShadow(px: Px, x: number, y: number, rx: number) {
  const e = Math.hypot(x / rx, (y + 1.02) / 0.16);
  px.over(new Color(0.05, 0.1, 0.05, 0.3), smooth(1, 0.55, e));
}

function cone(px: Px, x: number, y: number, cx: number, baseY: number, hw: number, topY: number) {
  const d = sdTri(x, y, cx - hw, baseY, cx + hw, baseY, cx, topY) - 0.02;
  const u = (x - cx) / hw;
  const stripe = Math.abs(((u + 4) * 2.5) % 1 - 0.5) < 0.08 ? 0.86 : 1;
  paint(px, d, (0.98 - 0.32 * smooth(-0.7, 1, u)) * stripe * (0.92 + 0.08 * smooth(baseY, topY, y)));
}

function flag(px: Px, x: number, y: number, cx: number, poleY: number, len: number, size: number) {
  dark(px, sdSeg(x, y, cx, poleY, cx, poleY + len) - 0.025, Ink);
  const fy = poleY + len - size * 0.5;
  const wave = Math.sin((x - cx) * 9) * 0.03;
  const d = sdBox(x - cx - size * 0.62, y - fy - wave, size * 0.62, size * 0.36, 0.02);
  paint(px, d, 0.95 - (x - cx) * 0.5 + wave * 3);
}

function merlons(px: Px, x: number, y: number, xs: number[], cy: number, hw: number) {
  for (const mx of xs) stone(px, sdBox(x - mx, y - cy, hw, 0.09, 0.02), x, y, mx, hw, false, 1.05);
}

export const TowerArt = {
  /** Stone layer of a tower kind (0 outpost, 1 keep, 2 fortress). */
  Stone(kind: number): Sprite {
    return CasualArt.make("tc-stone" + kind, W, H, (p) => {
      const x = p.x, y = p.y;
      P.reset();
      if (kind === 0) {
        groundShadow(P, x, y, 0.62);
        stone(P, sdBox(x, y + 0.4, 0.42, 0.58, 0.05), x, y, 0, 0.42, true);
        stone(P, sdBox(x, y - 0.2, 0.5, 0.07, 0.03), x, y, 0, 0.5, true, 1.08);
        door(P, x, y, 0, -0.98, 0.13, 0.36);
        windowSlit(P, x, y, 0, -0.25);
      } else if (kind === 1) {
        groundShadow(P, x, y, 0.82);
        stone(P, sdBox(x, y + 0.42, 0.62, 0.56, 0.04), x, y, 0, 0.62, false);
        stone(P, sdBox(x, y - 0.18, 0.7, 0.08, 0.03), x, y, 0, 0.7, false, 1.08);
        merlons(P, x, y, [-0.57, -0.19, 0.19, 0.57], 0.35, 0.12);
        door(P, x, y, 0, -0.98, 0.16, 0.42);
        windowSlit(P, x, y, -0.38, -0.2);
        windowSlit(P, x, y, 0.38, -0.2);
        dark(P, sdSeg(x, y, 0, 0.42, 0, 1.12) - 0.025, Ink);
      } else {
        groundShadow(P, x, y, 0.95);
        // wall with battlements between two round towers, a tall keep behind
        stone(P, sdBox(x, y + 0.05, 0.36, 0.7, 0.04), x, y, 0, 0.36, false, 0.95);
        stone(P, sdBox(x, y - 0.72, 0.4, 0.07, 0.03), x, y, 0, 0.4, false, 1.05);
        merlons(P, x, y, [-0.28, 0, 0.28], 0.86, 0.09);
        windowSlit(P, x, y, 0, 0.25, 0.06, 0.14);
        dark(P, sdSeg(x, y, 0, 0.93, 0, 1.2) - 0.022, Ink);
        stone(P, sdBox(x, y + 0.65, 0.72, 0.34, 0.04), x, y, 0, 0.72, false, 1.0);
        merlons(P, x, y, [-0.5, -0.17, 0.17, 0.5], -0.22, 0.1);
        for (const sx of [-0.74, 0.74]) {
          stone(P, sdBox(x - sx, y + 0.5, 0.24, 0.52, 0.04), x, y, sx, 0.24, true);
          stone(P, sdBox(x - sx, y - 0.04, 0.29, 0.06, 0.03), x, y, sx, 0.29, true, 1.08);
          windowSlit(P, x, y, sx, -0.45, 0.04, 0.09);
        }
        door(P, x, y, 0, -0.99, 0.17, 0.45);
      }
      return P.color;
    });
  },

  /** White paint layer (roofs, banners, flags) of a tower kind: tint it with the owner's colour. */
  Paint(kind: number): Sprite {
    return CasualArt.make("tc-paint" + kind, W, H, (p) => {
      const x = p.x, y = p.y;
      P.reset();
      if (kind === 0) {
        cone(P, x, y, 0, -0.16, 0.6, 0.86);
        flag(P, x, y, 0, 0.8, 0.36, 0.3);
      } else if (kind === 1) {
        const d = Math.max(sdBox(x, y + 0.5, 0.2, 0.26, 0.02), -sdTri(x, y, -0.2, -0.77, 0.2, -0.77, 0, -0.66));
        paint(P, d, 0.92 - x * 0.4);
        paint(P, sdCirc(x, y + 0.45, 0.09), 0.65);
        flag(P, x, y, 0, 0.42, 0.7, 0.42);
      } else {
        for (const sx of [-0.74, 0.74]) {
          cone(P, x, y, sx, 0.0, 0.34, 0.62);
        }
        const d = Math.max(sdBox(x, y - 0.4, 0.17, 0.24, 0.02), -sdTri(x, y, -0.17, 0.15, 0.17, 0.15, 0, 0.25));
        paint(P, d, 0.92 - x * 0.4);
        paint(P, sdCirc(x, y - 0.46, 0.08), 0.65);
        flag(P, x, y, 0, 0.93, 0.28, 0.4);
      }
      return P.color;
    });
  },

  /** A marching troop: round body with a dark rim and a shine (tint per owner). */
  get Unit() {
    return CasualArt.make("tc-unit", 48, 48, (p) => {
      const r = p.magnitude, px = 2 / 48;
      P.reset();
      P.over(new Color(0.22, 0.22, 0.26, 1), fill(r - 0.92, px));
      const v = 0.82 + 0.18 * smooth(0.6, -0.6, p.y + p.x * 0.3);
      P.over(new Color(v, v, v, 1), fill(r - 0.68, px));
      P.over(Color.white, fill(Math.hypot(p.x + 0.22, p.y - 0.26) - 0.2, px) * 0.85);
      return P.color;
    });
  },

  /** Rounded pill behind a garrison number. */
  get Pill() {
    return CasualArt.make("tc-pill", 112, 56, (p) => {
      const px = 2 / 112;
      const d = sdBox(p.x, p.y, 0.96, 0.44, 0.44);
      P.reset();
      P.over(new Color(1, 1, 1, 1), fill(d, px));
      P.over(new Color(0.84, 0.84, 0.84, 1), fill(d + 0.07, px) * smooth(0.1, -0.4, p.y));
      return P.color;
    });
  },

  /** Selection / target ring: a soft white ring with a brighter rim. */
  get SelectRing() {
    return CasualArt.make("tc-ring", 128, 128, (p) => {
      const r = p.magnitude, px = 2 / 128;
      const a = fill(Math.abs(r - 0.8) - 0.11, px) + smooth(0.95, 0.7, r) * 0.25 * smooth(0.5, 0.7, r);
      return new Color(1, 1, 1, clamp01(a));
    });
  },

  /** Arrow head for drag lines (points +x). */
  get Arrow() {
    return CasualArt.make("tc-arrow", 64, 64, (p) => {
      const d = sdTri(p.x, p.y, 0.9, 0, -0.7, 0.72, -0.7, -0.72) - 0.06;
      P.reset();
      P.over(new Color(0.2, 0.2, 0.24, 1), fill(d, 2 / 64));
      P.over(Color.white, fill(d + 0.14, 2 / 64));
      return P.color;
    });
  },

  /** Meadow decor: 0 tree, 1 bush, 2 rock, 3 flowers. */
  Decor(kind: number): Sprite {
    return CasualArt.make("tc-decor" + kind, 96, 96, (p) => {
      const x = p.x, y = p.y, px = 2 / 96;
      P.reset();
      if (kind === 0) {
        P.over(new Color(0.05, 0.15, 0.05, 0.28), smooth(1, 0.5, Math.hypot(x / 0.6, (y + 0.78) / 0.16)));
        P.over(WoodDark, fill(sdBox(x, y + 0.55, 0.09, 0.26, 0.03), px));
        P.over(Wood, fill(sdBox(x, y + 0.55, 0.05, 0.24, 0.03), px));
        const d = Math.min(sdCirc(x, y - 0.18, 0.46), sdCirc(x + 0.32, y + 0.08, 0.34), sdCirc(x - 0.32, y + 0.08, 0.34));
        P.over(Pal.hex(0x2f7a32), fill(d, px));
        const v = smooth(-0.3, 0.6, y + x * 0.3);
        P.over(Color.lerp(Pal.hex(0x48a83d), Pal.hex(0x8fdc5a), v), fill(d + 0.06, px));
        P.over(Pal.hex(0xc4f08a), fill(Math.hypot(x + 0.15, y - 0.35) - 0.12, px) * 0.6);
      } else if (kind === 1) {
        P.over(new Color(0.05, 0.15, 0.05, 0.25), smooth(1, 0.5, Math.hypot(x / 0.7, (y + 0.42) / 0.16)));
        const d = Math.min(sdCirc(x, y + 0.05, 0.36), sdCirc(x + 0.36, y + 0.2, 0.26), sdCirc(x - 0.36, y + 0.2, 0.26));
        P.over(Pal.hex(0x2f7a32), fill(d, px));
        P.over(Color.lerp(Pal.hex(0x4fae42), Pal.hex(0x95e060), smooth(-0.4, 0.3, y)), fill(d + 0.06, px));
        for (const [bx, by] of [[-0.15, 0.1], [0.25, -0.05], [-0.38, -0.15]]) P.over(Pal.hex(0xff7a8a), fill(Math.hypot(x - bx, y - by) - 0.06, px));
      } else if (kind === 2) {
        P.over(new Color(0.05, 0.12, 0.05, 0.25), smooth(1, 0.5, Math.hypot(x / 0.62, (y + 0.36) / 0.14)));
        const d = Math.min(sdBox(x + 0.1, y + 0.1, 0.42, 0.26, 0.2), sdBox(x - 0.32, y + 0.2, 0.22, 0.16, 0.14));
        P.over(Pal.hex(0x5f6670), fill(d, px));
        P.over(Color.lerp(Pal.hex(0x9aa3ad), Pal.hex(0xd5dbe1), smooth(-0.3, 0.2, y)), fill(d + 0.06, px));
      } else {
        for (let i = 0; i < 6; i++) {
          const a = i * 1.7, r = 0.18 + (i % 3) * 0.17;
          const fx = Math.cos(a) * r, fy = Math.sin(a) * r * 0.7;
          P.over(Pal.hex(0x3f8f3a), fill(sdSeg(x, y, fx, fy, fx, fy - 0.16) - 0.025, px));
          const col = [Pal.hex(0xffffff), Pal.hex(0xffd84a), Pal.hex(0xff8fb1)][i % 3];
          P.over(col, fill(Math.hypot(x - fx, y - fy) - 0.09, px));
          P.over(Pal.hex(0xffb020), fill(Math.hypot(x - fx, y - fy) - 0.035, px));
        }
      }
      return P.color;
    });
  },

  /** Ocean behind the map: deep teal with light ripples (cover sprite). */
  get Water() {
    return CasualArt.make("tc-water", 160, 288, (p) => {
      const t = (p.y + 1.8) / 3.6;
      let c = Color.lerp(Pal.hex(0x1d5f8f), Pal.hex(0x3fa6c8), smooth(0, 1, t));
      const g = Math.exp(-(p.x * p.x * 0.8 + (p.y - 0.2) * (p.y - 0.2) * 0.5));
      c = Color.lerp(c, Pal.hex(0x6fd3e0), g * 0.35);
      const w = Math.sin(p.x * 14 + Math.sin(p.y * 9) * 2) * Math.sin(p.y * 22 + p.x * 3);
      c = Color.lerp(c, Pal.hex(0xbff3f7), smooth(0.86, 0.98, w) * 0.22);
      return c.withAlpha(1);
    });
  },
};
