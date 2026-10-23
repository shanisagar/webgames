import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";

/**
 * GOALKEEPER SAVE procedural art: the street court seen from the goal line (sunset city, cage fence, painted
 * asphalt), the goal frame with its side netting, the football, the striker's body parts, keeper gloves, the target
 * marker. Rasterized once by CasualArt and cached.
 */

const sm = CasualArt.smooth;
const mix = (a: Color, b: Color, t: number) => Color.lerp(a, b, t);
const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** Projection of the court: goal plane scale F/d0, camera height, horizon. */
export const F = 13.2, D0 = 4, CamH = 2, HorizonY = 0;
export const GoalHalfW = 2, GoalH = 2.6;
export const PostX = GoalHalfW * F / D0, LineY = HorizonY - CamH * F / D0, BarY = LineY + GoalH * F / D0;

export const P1Col = Pal.hex(0x2ee6ff), P2Col = Pal.hex(0xff4fb8), CpuCol = Pal.hex(0xffa63c);
export const Grass = Pal.hex(0x3a4258);

const BuildCols = [0xf2a65a, 0xe86f68, 0x7cc6c6, 0xf6d06f, 0x9b8fe0, 0x5fb3a3, 0xf08bb3, 0x6fa8f0].map((h) => Pal.hex(h));

/** Sky and city above the horizon (x, y: world units relative to the lane centre). */
function sky(x: number, y: number) {
  const t = Mathf.clamp01((y - HorizonY) / 9);
  let c = t < 0.35 ? mix(Pal.hex(0xffb36b), Pal.hex(0xd9708a), t / 0.35) : mix(Pal.hex(0xd9708a), Pal.hex(0x2b2466), (t - 0.35) / 0.65);
  const sun = Math.hypot((x + 4.5) * 0.8, y - 1.6);
  c = mix(c, Pal.hex(0xfff0b0), sm(1.6, 0.9, sun) * 0.9);
  c = mix(c, Pal.hex(0xffd59a), sm(5, 0, sun) * 0.25);
  // two soft clouds
  for (const [cx, cy, w] of [[3.5, 6.2, 2.4], [-9.5, 7.3, 2.0], [12, 5.6, 2.2], [-2.5, 8.2, 1.6]]) {
    const d = Math.hypot((x - cx) / w, (y - cy) * 2.2);
    const bump = 0.18 * Math.sin((x - cx) * 2.6);
    c = mix(c, Pal.hex(0xffe3d0), CasualArt.fill(d - 1 - bump, 0.05) * 0.55);
  }
  return c;
}

function city(x: number, y: number, c: Color) {
  // far row (hazy, tall) then near row (bright)
  for (let layer = 0; layer < 2; layer++) {
    const w = layer === 0 ? 1.7 : 1.25, base = -0.62, off = layer === 0 ? 0.37 : 0;
    const col = Math.floor((x + 100 + off) / w), h1 = hash(col * 3.1 + layer * 17), h2 = hash(col * 5.7 + layer * 31);
    const top = base + (layer === 0 ? 2.4 + h1 * 4.4 : 1.1 + h1 * 2.6);
    const lx = (x + 100 + off) - col * w;
    if (lx < 0.06 || lx > w - 0.06 || y > top) continue;
    let b = BuildCols[Math.floor(h2 * BuildCols.length)];
    b = layer === 0 ? mix(b, Pal.hex(0xc77a92), 0.55) : CasualArt.darken(b, 0.06);
    // lit edge toward the sun, shade on the other side
    b = mix(b, CasualArt.lighten(b, 0.25), sm(0.25, 0.0, lx - 0.06) * 0.7);
    b = mix(b, CasualArt.darken(b, 0.18), sm(w - 0.4, w - 0.06, lx) * 0.8);
    // roof lip
    if (top - y < 0.1) b = CasualArt.darken(b, 0.25);
    // windows
    const wx = (lx - 0.18) / 0.36, wy = (top - 0.3 - y) / 0.48;
    if (wx > 0 && lx < w - 0.2 && wy > 0) {
      const fx = wx - Math.floor(wx), fy = wy - Math.floor(wy);
      if (fx > 0.25 && fx < 0.8 && fy > 0.2 && fy < 0.75) {
        const lit = hash(Math.floor(wx) * 13 + Math.floor(wy) * 7 + col * 3 + layer) > 0.55;
        b = mix(b, lit ? Pal.hex(0xffe08a) : CasualArt.darken(b, 0.35), layer === 0 ? 0.45 : 0.85);
      }
    }
    return b;
  }
  return c;
}

function ground(x: number, y: number) {
  // screen y below the horizon → distance along the court (Z) and across it (X)
  const zd = CamH * F / Math.max(0.02, HorizonY - y), Z = zd - D0, X = x * zd / F;
  const px = zd / F * 0.035; // one pixel in court metres
  let c = mix(Pal.hex(0x4a5068), Pal.hex(0x2e3448), sm(30, 2, Z));
  // asphalt speckle
  const n = hash(Math.floor(X * 9) * 1.7 + Math.floor(Z * 9) * 3.3);
  c = mix(c, n > 0.5 ? CasualArt.lighten(c, 0.08) : CasualArt.darken(c, 0.08), 0.5 * sm(25, 3, Z));
  // court (inside the sidelines) a touch bluer
  if (Math.abs(X) < 10) c = mix(c, Pal.hex(0x34557a), 0.35);
  const line = (d: number, col: Color, wM = 0.06) => { c = mix(c, col, CasualArt.fill(d - wM, Math.max(px, 0.02)) * 0.92); };
  const W = Pal.hex(0xf4f2e8), Y = Pal.hex(0xffd23f);
  line(Math.abs(Z), W, 0.07);                                        // goal line
  if (Z > -0.1 && Z < 3.1) line(Math.abs(Math.abs(X) - 3.5), W);       // goal area sides
  if (Math.abs(X) < 3.56) line(Math.abs(Z - 3), W);                    // goal area front
  if (Z > -0.1 && Z < 8.1) line(Math.abs(Math.abs(X) - 6.5), Y);       // penalty box sides
  if (Math.abs(X) < 6.56) line(Math.abs(Z - 8), Y);                    // penalty box front
  line(Math.hypot(X, Z - 9.5) - 0.06, W, 0.12);                        // spot
  line(Math.abs(Z - 20), W);                                           // halfway
  line(Math.abs(Math.hypot(X, Z - 20) - 3), W);                        // centre circle
  line(Math.abs(Math.abs(X) - 10), W);                                 // sidelines
  // painted street-court art in the centre circle
  if (Math.hypot(X, Z - 20) < 2.4) c = mix(c, Pal.hex(0xff6b6b), 0.22);
  // haze toward the horizon
  c = mix(c, Pal.hex(0xc9879a), sm(18, 40, Z) * 0.55);
  return c;
}

/** Cage fence along the far end of the court (Z = 36). */
function fence(x: number, y: number, c: Color) {
  const s = F / (36 + D0), base = HorizonY - CamH * s, top = base + 4 * s;
  if (y < base || y > top) return c;
  const X = x / s, Yh = (y - base) / s;
  // posts and rails
  const post = Math.abs(X / 3 - Math.round(X / 3)) * 3;
  if (post < 0.07 || Math.abs(Yh - 4) < 0.08 || Math.abs(Yh - 2) < 0.04) return mix(c, Pal.hex(0x2a2f40), 0.9);
  // chain link diamonds
  const u = (X + Yh) / 0.35, v = (X - Yh) / 0.35;
  const du = Math.abs(u - Math.round(u)), dv = Math.abs(v - Math.round(v));
  const wire = Math.max(1 - du / 0.18, 1 - dv / 0.18, 0);
  c = mix(c, Pal.hex(0x5a6278), wire * 0.55);
  // low boards
  if (Yh < 0.8) c = mix(c, Yh < 0.74 ? Pal.hex(0x1d2236) : Pal.hex(0xffffff), 0.95);
  return c;
}

/** The whole view behind the goal frame, `halfW` world units either side of the lane centre, 18 tall. */
export const SceneSprite = (halfW: number) => CasualArt.make("wk-scene-" + halfW, Math.round(halfW * 2 * 30), 18 * 30, (p) => {
  const x = p.x * halfW, y = p.y * halfW;
  let c: Color;
  if (y > HorizonY - 0.62) { c = city(x, y, sky(x, y)); if (y < HorizonY + 2) c = fence(x, y, c); }
  else c = ground(x, y);
  if (y < HorizonY - 0.62 && y > HorizonY - 1.3) c = fence(x, y, c);
  // vignette toward the lane sides
  c = CasualArt.darken(c, sm(halfW - 2.5, halfW, Math.abs(x)) * 0.25);
  return c.withAlpha(1);
});

/** Goal frame (posts + crossbar) with the side and top netting; 16 wide, centred on the lane, y from -9 to 5. */
export const FrameH = 14;
export const FrameSprite = () => CasualArt.make("wk-frame", 16 * 28, FrameH * 28, (p) => {
  const x = p.x * 8, y = p.y * 8 - 2; // world y relative to the screen centre
  const px = 16 / (16 * 28);
  const pw = 0.28;
  const postD = Math.max(Math.abs(Math.abs(x) - PostX) - pw, y - (BarY + pw), LineY - 0.2 - y);
  const barD = Math.max(Math.abs(y - BarY) - pw, Math.abs(x) - PostX - pw);
  const d = Math.min(postD, barD);
  let col = Color.clear;
  // netting outside the frame (it runs back toward the keeper)
  const outX = Math.abs(x) - PostX - pw, outY = y - BarY - pw;
  if ((outX > 0 && y < BarY + 3) || (outY > 0 && Math.abs(x) < PostX + 3)) {
    const fade = outX > 0 && outY > 0 ? sm(2.6, 0, Math.hypot(outX, outY)) : outX > 0 ? sm(2.6, 0.2, outX) : sm(2.6, 0.2, outY);
    const u = (x + y) / 0.55, v = (x - y) / 0.55;
    const du = Math.abs(u - Math.round(u)), dv = Math.abs(v - Math.round(v));
    const wire = Math.max(1 - du / 0.14, 1 - dv / 0.14, 0);
    col = new Color(1, 1, 1, wire * 0.55 * fade * (y < LineY ? sm(LineY - 2.5, LineY, y) : 1));
  }
  if (d < px * 6) {
    // white post with red bands (street goal), rounded shading
    const along = Math.abs(x) > PostX - pw && y < BarY ? y : x;
    const band = Math.floor((along + 40) / 0.9) % 2 === 0;
    let c = band ? Pal.hex(0xffffff) : Pal.hex(0xff3d4a);
    const across = Math.abs(x) > PostX - pw && y < BarY + pw * 0.5 ? (Math.abs(x) - PostX) / pw : (y - BarY) / pw;
    c = mix(c, CasualArt.darken(c, 0.45), sm(0.1, 1, Math.abs(across + 0.25)) * 0.9);
    c = mix(c, Color.white, sm(0.4, 0, Math.abs(across + 0.35)) * 0.5);
    const a = CasualArt.fill(d, px);
    col = CasualArt.over(col, c.withAlpha(1), a);
    // dark outline
    col = CasualArt.over(col, Pal.hex(0x14182a), CasualArt.fill(Math.abs(d) - px * 1.6, px) * 0.85 * (d > -px * 3 ? 1 : 0));
  }
  return col;
});

/** Classic patched football. */
export const BallSprite = () => CasualArt.make("wk-ball", 128, 128, (p) => {
  const px = 2 / 128, r = p.magnitude;
  const a = CasualArt.fill(r - 0.94, px);
  if (a <= 0) return Color.clear;
  const z = Math.sqrt(Math.max(0, 1 - Math.min(1, (r / 0.94) ** 2)));
  // patches: centre pentagon and five around it, foreshortened toward the rim
  let patch = 0;
  const pent = (q: V2, cx: number, cy: number, rad: number, rot: number) => {
    const dx = q.x - cx, dy = q.y - cy, ang = Math.atan2(dy, dx) - rot, sec = Math.PI * 2 / 5;
    const k = Math.cos(sec / 2) / Math.cos(((ang % sec) + sec) % sec - sec / 2);
    return Math.hypot(dx, dy) - rad * k;
  };
  patch = Math.max(patch, CasualArt.fill(pent(p, 0, 0, 0.27, Math.PI / 2), px));
  for (let i = 0; i < 5; i++) {
    const ang = Math.PI / 2 + Math.PI / 5 + (i * Math.PI * 2) / 5;
    patch = Math.max(patch, CasualArt.fill(pent(p, Math.cos(ang) * 0.78, Math.sin(ang) * 0.78, 0.25, ang + Math.PI / 2), px));
  }
  let c = mix(Pal.hex(0xffffff), Pal.hex(0x1a1d2b), patch);
  // seams
  const seam = Math.abs(Math.sin(Math.atan2(p.y, p.x) * 5 + 1.57)) * (r > 0.35 && r < 0.6 ? 1 : 0);
  c = mix(c, Pal.hex(0x8a90a8), sm(0.08, 0, seam) * 0.5 * (1 - patch));
  // shading + highlight
  const l = Mathf.clamp01((-p.x * 0.45 + p.y * 0.6 + z * 0.66) / 1.0);
  c = c.mul(0.55 + 0.5 * l).withAlpha(1);
  c = mix(c, Color.white, sm(0.32, 0, Math.hypot(p.x + 0.34, p.y - 0.4)) * 0.75);
  c = mix(c, Pal.hex(0x101320), CasualArt.fill(Math.abs(r - 0.92) - 0.025, px) * 0.6);
  return c.withAlpha(a);
});

/** Shirt + shorts block for the striker (one unit wide, 1.6 tall). */
export const TorsoSprite = (shirt: Color, key: string) => CasualArt.make("wk-torso-" + key, 64, 102, (p) => {
  const px = 2 / 64;
  const shorts = CasualArt.sdBox(new V2(p.x, p.y + 1.05), new V2(0.66, 0.36), 0.12);
  const body = CasualArt.sdBox(new V2(p.x, p.y + 0.12), new V2(0.74 - Math.max(0, -p.y - 0.3) * 0.12, 0.82), 0.3);
  let col = Color.clear;
  if (shorts < px) col = CasualArt.over(col, mix(Pal.hex(0x1d2340), Pal.hex(0x343d6a), sm(0.6, -0.6, p.x)), CasualArt.fill(shorts, px));
  if (body < px) {
    let c = mix(CasualArt.darken(shirt, 0.25), CasualArt.lighten(shirt, 0.15), sm(0.7, -0.7, p.x));
    if (Math.abs(p.x) < 0.16) c = mix(c, Color.white, 0.75);              // centre stripe
    if (p.y > 0.52 && Math.abs(p.x) < 0.3) c = mix(c, Pal.hex(0x1d2340), 0.8); // collar
    col = CasualArt.over(col, c.withAlpha(1), CasualArt.fill(body, px));
  }
  col = CasualArt.over(col, Pal.hex(0x0e1222), CasualArt.fill(Math.abs(Math.min(body, shorts)) - px * 1.4, px) * 0.8);
  return col;
});

export const HeadSprite = (skin: Color, hair: Color, key: string) => CasualArt.make("wk-head-" + key, 64, 64, (p) => {
  const px = 2 / 64, r = p.magnitude;
  if (r > 0.98) return Color.clear;
  let c = mix(CasualArt.darken(skin, 0.2), CasualArt.lighten(skin, 0.15), sm(0.8, -0.8, p.x - p.y * 0.3));
  const hairD = Math.max(r - 0.92, -(p.y - 0.1 + p.x * 0.15));
  c = mix(c, hair, CasualArt.fill(hairD, px));
  // eyes looking at the ball (toward the viewer)
  for (const ex of [-0.3, 0.3]) c = mix(c, Pal.hex(0x14182a), CasualArt.fill(Math.hypot(p.x - ex, p.y + 0.05) - 0.1, px));
  c = mix(c, Pal.hex(0x8a3a3a), CasualArt.fill(Math.hypot((p.x) / 1.6, p.y + 0.45) - 0.12, px) * 0.6);
  const a = CasualArt.fill(r - 0.9, px);
  return CasualArt.over(c.withAlpha(a), Pal.hex(0x0e1222), CasualArt.fill(Math.abs(r - 0.9) - px * 1.4, px) * 0.8);
});

/** Leg with a sneaker, pivot at the top (1 wide, 4 tall). */
export const LegSprite = (skin: Color, sock: Color, key: string) => CasualArt.make("wk-leg-" + key, 32, 128, (p) => {
  const px = 2 / 32;
  const leg = CasualArt.sdSegment(p, new V2(0, 3.6), new V2(0, -2.8)) - 0.5;
  const shoe = CasualArt.sdBox(new V2(p.x - 0.25, p.y + 3.4), new V2(0.85, 0.42), 0.35);
  let col = Color.clear;
  if (leg < px) {
    let c = p.y > 0.9 ? Pal.hex(0x2a3360) : p.y > -1.4 ? skin : sock;
    c = mix(c, CasualArt.darken(c, 0.3), sm(-0.2, 0.6, p.x));
    col = CasualArt.over(col, c.withAlpha(1), CasualArt.fill(leg, px));
  }
  if (shoe < px) col = CasualArt.over(col, mix(Pal.hex(0xffffff), Pal.hex(0xff3d4a), p.y < -3.55 ? 0.9 : 0), CasualArt.fill(shoe, px));
  col = CasualArt.over(col, Pal.hex(0x0e1222), CasualArt.fill(Math.abs(Math.min(leg, shoe)) - px * 1.4, px) * 0.8);
  return col;
});

export const ArmSprite = (shirt: Color, skin: Color, key: string) => CasualArt.make("wk-arm-" + key, 24, 96, (p) => {
  const px = 2 / 24;
  const d = CasualArt.sdSegment(p, new V2(0, 3.4), new V2(0, -3.3)) - 0.6;
  if (d > px) return Color.clear;
  let c = p.y > 1.2 ? shirt : skin;
  c = mix(c, CasualArt.darken(c, 0.3), sm(-0.3, 0.7, p.x));
  const col = c.withAlpha(CasualArt.fill(d, px));
  return CasualArt.over(col, Pal.hex(0x0e1222), CasualArt.fill(Math.abs(d) - px * 1.4, px) * 0.8);
});

/** A pair of keeper gloves (the SAVE! graphic), 1 wide, 0.75 tall. */
export const GlovesSprite = () => CasualArt.make("wk-gloves", 256, 192, (p) => {
  const px = 2 / 256;
  let col = Color.clear;
  for (const side of [-1, 1]) {
    const q0 = new V2((p.x - side * 0.44) * side, p.y + 0.05);
    const a = side * -0.18, cs = Math.cos(a), sn = Math.sin(a);
    const q = new V2(q0.x * cs - q0.y * sn, q0.x * sn + q0.y * cs);
    let d = CasualArt.sdBox(new V2(q.x, q.y + 0.08), new V2(0.3, 0.27), 0.14);
    for (let f = 0; f < 4; f++) {
      const fx = -0.2 + f * 0.135, len = [0.2, 0.26, 0.25, 0.19][f];
      d = Math.min(d, CasualArt.sdSegment(q, new V2(fx, 0.12), new V2(fx + 0.01, 0.12 + len)) - 0.068);
    }
    d = Math.min(d, CasualArt.sdSegment(q, new V2(0.24, -0.05), new V2(0.4, 0.14)) - 0.075);
    const cuff = CasualArt.sdBox(new V2(q.x, q.y + 0.42), new V2(0.27, 0.12), 0.05);
    let c = mix(Pal.hex(0x6cff4a), Pal.hex(0xb6ff6a), sm(-0.3, 0.4, q.y));
    if (Math.abs(q.y + 0.1) < 0.05) c = mix(c, Pal.hex(0x14182a), 0.75);
    c = mix(c, Color.white, sm(0.14, 0, Math.hypot(q.x + 0.12, q.y - 0.1)) * 0.5);
    if (d < px) col = CasualArt.over(col, c.withAlpha(1), CasualArt.fill(d, px));
    if (cuff < px) col = CasualArt.over(col, mix(Pal.hex(0xffffff), Pal.hex(0x1d2340), Math.abs(q.y + 0.42) < 0.03 ? 1 : 0), CasualArt.fill(cuff, px));
    const outline = Math.min(d, cuff);
    col = CasualArt.over(col, Pal.hex(0x0e1222), CasualArt.fill(Math.abs(outline) - px * 2.2, px) * 0.9);
  }
  return col;
});

/** Aim marker where a shot will cross the line (white, tint per lane). */
export const TargetSprite = () => CasualArt.make("wk-target", 128, 128, (p) => {
  const px = 2 / 128, r = p.magnitude;
  let a = CasualArt.fill(Math.abs(r - 0.8) - 0.07, px);
  a = Math.max(a, CasualArt.fill(Math.abs(r - 0.42) - 0.05, px) * 0.8);
  const tick = Math.min(Math.abs(p.x), Math.abs(p.y));
  if (r > 0.55 && r < 0.98) a = Math.max(a, CasualArt.fill(tick - 0.05, px));
  a = Math.max(a, CasualArt.fill(r - 0.12, px));
  return new Color(1, 1, 1, a);
});

/** Ground shadow (soft ellipse). */
export const ShadowSprite = () => CasualArt.make("wk-shadow", 64, 32, (p) => new Color(0, 0, 0, sm(1, 0.2, Math.hypot(p.x, p.y * 2)) * 0.6));

/** A dotted-trail dot. */
export const DotSprite = () => CasualArt.make("wk-dot", 32, 32, (p) => new Color(1, 1, 1, CasualArt.fill(p.magnitude - 0.8, 2 / 32)));

/** Billboard frame for the brand word (text is drawn over it). */
export const BillboardSprite = () => CasualArt.make("wk-billboard", 192, 64, (p) => {
  const px = 2 / 192;
  const d = CasualArt.sdBox(p, new V2(0.97, 0.3), 0.04);
  if (d > px) return Color.clear;
  let c = mix(Pal.hex(0x161a2e), Pal.hex(0x232a48), sm(-0.3, 0.3, p.y));
  c = mix(c, Color.white, CasualArt.fill(Math.abs(d + 0.02) - 0.008, px) * 0.8);
  return c.withAlpha(CasualArt.fill(d, px));
});
