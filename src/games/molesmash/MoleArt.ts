import { Art, CasualArt, Color, GameObject, Mathf, Pal, Sprite, V2 } from "../../kit";
import { ClipSprite } from "./ClipSprite";

/** Procedural art for MOLE SMASH: moles, holes, mallets, fairground boards and the backdrop. */

const { fill, smooth, sdBox, sdCircle, sdSegment, over, lighten, darken } = CasualArt;

export const Cyan = Pal.hex(0x2ec8ff), Orange = Pal.hex(0xff8a24), Gold = Pal.hex(0xffc93c), Red = Pal.hex(0xff4a5a);
export const Brown = Pal.hex(0x9a6440), Ink = Pal.hex(0x2a160c), Cream = Pal.hex(0xfff3dc), Pink = Pal.hex(0xff8fa8);

/** Mole sprites are 1 unit wide and MoleH tall (the hole line cuts them). */
export const MoleW = 112, MoleHpx = 140, MoleH = MoleHpx / MoleW;

export function clipSpr(parent: GameObject, name: string, sprite: Sprite, color: Color, size: number, order: number) {
  const go = new GameObject(name, parent);
  go.localScale = new V2(size, size);
  const sr = go.addComponent(new ClipSprite());
  sr.sprite = sprite;
  sr.color = color;
  sr.material = Art.Flat;
  sr.sortingOrder = order;
  return sr;
}

const ellipse = (p: V2, c: V2, r: V2) => (Math.hypot((p.x - c.x) / r.x, (p.y - c.y) / r.y) - 1) * Math.min(r.x, r.y);

/** Mole silhouette (head + body) signed distance. */
function moleSd(p: V2) {
  const head = sdCircle(p, new V2(0, 0.42), 0.66);
  const body = sdBox(p.sub(new V2(0, -0.5)), new V2(0.66, 0.9), 0.5);
  return Math.min(head, body);
}

/** The furry body with snout, nose, teeth, cheeks, ears and paws (eyes are a separate overlay). */
export function MoleBody(fur: Color, key: string, shiny = false) {
  return CasualArt.make("ms-mole-" + key, MoleW, MoleHpx, (p) => {
    const px = 2 / MoleW;
    let c = Color.clear;
    // ears behind the head
    for (const sx of [-1, 1]) {
      const ear = sdCircle(p, new V2(sx * 0.5, 0.92), 0.2);
      if (ear < px) {
        let e = darken(fur, 0.12);
        e = Color.lerp(e, Pink, fill(sdCircle(p, new V2(sx * 0.5, 0.9), 0.1), px) * 0.8);
        c = over(c, darken(e, 0.35), fill(ear, px));
        c = over(c, e, fill(ear + 0.03, px));
      }
    }
    const d = moleSd(p);
    if (d < px * 2) {
      // shading: lit from the top-left, darker towards the rim and the bottom
      const lit = smooth(-1.2, 1.1, p.y * 0.8 - p.x * 0.4);
      let f = Color.lerp(darken(fur, 0.28), lighten(fur, 0.12), lit);
      f = Color.lerp(f, darken(fur, 0.4), smooth(-0.14, 0, d) * 0.7);
      // fur tufts on the top of the head
      const tuft = Math.abs(Math.sin(p.x * 22)) * 0.03;
      if (p.y > 0.95 && d > -tuft) f = darken(f, 0.12);
      // belly
      const belly = ellipse(p, new V2(0, -0.55), new V2(0.42, 0.62));
      f = Color.lerp(f, lighten(fur, 0.32), fill(belly, px * 3) * 0.75);
      if (shiny) {
        const band = Math.sin((p.x + p.y) * 7) * 0.5 + 0.5;
        f = Color.lerp(f, Color.white, smooth(0.86, 1, band) * 0.4);
      }
      c = over(c, darken(fur, 0.55), fill(d, px));
      c = over(c, f, fill(d + 0.035, px));
    }
    // cheeks
    for (const sx of [-1, 1]) c = over(c, Pink.withAlpha(0.55), fill(sdCircle(p, new V2(sx * 0.4, 0.2), 0.13), px * 3));
    // snout, teeth, nose, whiskers
    const snout = ellipse(p, new V2(0, 0.2), new V2(0.34, 0.24));
    c = over(c, darken(Cream, 0.25), fill(snout, px));
    c = over(c, Cream, fill(snout + 0.025, px));
    const mouth = sdSegment(p, new V2(-0.1, 0.06), new V2(0.1, 0.06)) - 0.012;
    c = over(c, darken(fur, 0.6), fill(mouth, px));
    for (const sx of [-1, 1]) {
      const tooth = sdBox(p.sub(new V2(sx * 0.052, -0.02)), new V2(0.045, 0.07), 0.015);
      c = over(c, Pal.hex(0xd8d0c0), fill(tooth, px));
      c = over(c, Color.white, fill(tooth + 0.012, px));
      for (const k of [-1, 1]) {
        const w = sdSegment(p, new V2(sx * 0.3, 0.2 + k * 0.03), new V2(sx * 0.62, 0.24 + k * 0.08)) - 0.008;
        c = over(c, darken(fur, 0.6).withAlpha(0.7), fill(w, px));
      }
    }
    const nose = ellipse(p, new V2(0, 0.3), new V2(0.13, 0.1));
    c = over(c, Pal.hex(0x3a1a22), fill(nose, px));
    c = over(c, Pal.hex(0xff6f8e), fill(nose + 0.025, px));
    c = over(c, Color.white.withAlpha(0.85), fill(sdCircle(p, new V2(-0.04, 0.34), 0.03), px));
    // paws gripping the rim
    for (const sx of [-1, 1]) {
      const pc = new V2(sx * 0.42, -0.22);
      const paw = ellipse(p, pc, new V2(0.19, 0.14));
      c = over(c, darken(fur, 0.5), fill(paw, px));
      c = over(c, Color.lerp(lighten(fur, 0.25), Cream, 0.4), fill(paw + 0.025, px));
      for (let k = -1; k <= 1; k++) {
        const claw = sdSegment(p, pc.add(new V2(k * 0.08, 0.02)), pc.add(new V2(k * 0.09, -0.1))) - 0.012;
        c = over(c, darken(fur, 0.45).withAlpha(0.7), fill(claw, px));
      }
    }
    return c;
  });
}

/** Eye overlays: 0 = wide awake, 1 = bonked (X X), 2 = sly (bomb carriers), 3 = happy (golden). */
export function MoleEyes(kind: number) {
  return CasualArt.make("ms-eyes" + kind, MoleW, MoleHpx, (p) => {
    const px = 2 / MoleW;
    let c = Color.clear;
    for (const sx of [-1, 1]) {
      const ec = new V2(sx * 0.24, 0.52);
      if (kind === 1) {
        const a = sdSegment(p, ec.add(new V2(-0.09, -0.09)), ec.add(new V2(0.09, 0.09))) - 0.03;
        const b = sdSegment(p, ec.add(new V2(-0.09, 0.09)), ec.add(new V2(0.09, -0.09))) - 0.03;
        c = over(c, Ink, fill(Math.min(a, b), px));
      } else if (kind === 3) {
        // ^ ^
        const a = sdSegment(p, ec.add(new V2(-0.1, -0.03)), ec.add(new V2(0, 0.07))) - 0.03;
        const b = sdSegment(p, ec.add(new V2(0.1, -0.03)), ec.add(new V2(0, 0.07))) - 0.03;
        c = over(c, Ink, fill(Math.min(a, b), px));
      } else {
        const white = ellipse(p, ec, new V2(0.13, 0.16));
        c = over(c, Ink, fill(white - 0.02, px));
        c = over(c, Color.white, fill(white, px));
        const pupil = ellipse(p, ec.add(new V2(sx * 0.02, kind === 2 ? -0.04 : -0.01)), new V2(0.075, 0.095));
        c = over(c, Ink, fill(pupil, px));
        c = over(c, Color.white, fill(sdCircle(p, ec.add(new V2(-0.02 + sx * 0.02, 0.04)), 0.03), px));
        if (kind === 2) {
          // heavy lids + angry brows
          const lid = Math.max(white, -(p.y - (ec.y + 0.02 - sx * (p.x - ec.x) * 0.3)));
          c = over(c, darken(Brown, 0.2), fill(lid, px));
          const brow = sdSegment(p, ec.add(new V2(-sx * 0.15, 0.2)), ec.add(new V2(sx * 0.12, 0.13))) - 0.03;
          c = over(c, Ink, fill(brow, px));
        }
      }
    }
    return c;
  });
}

/** Steel helmet that sits on the head. */
export const HelmetSprite = () => CasualArt.make("ms-helmet", MoleW, MoleHpx, (p) => {
  const px = 2 / MoleW;
  let c = Color.clear;
  const dome = Math.max(sdCircle(p, new V2(0, 0.58), 0.72), -(p.y - 0.62));
  const rim = sdBox(p.sub(new V2(0, 0.64)), new V2(0.8, 0.07), 0.06);
  const metal = (base: number) => {
    const sh = smooth(-0.6, 0.6, p.x * -0.6 + (p.y - 0.9) * 0.6);
    const v = Mathf.lerp(base * 0.55, base * 1.1, sh);
    return new Color(v * 0.95, v, v * 1.05, 1);
  };
  c = over(c, Pal.hex(0x3a4250), fill(dome, px));
  c = over(c, metal(0.82), fill(dome + 0.03, px));
  c = over(c, Color.white.withAlpha(0.7), fill(ellipse(p, new V2(-0.28, 1.0), new V2(0.14, 0.06)), px * 2));
  c = over(c, Pal.hex(0x3a4250), fill(rim, px));
  c = over(c, metal(0.95), fill(rim + 0.025, px));
  for (const x of [-0.5, 0, 0.5]) c = over(c, Pal.hex(0x5a6070), fill(sdCircle(p, new V2(x, 0.64), 0.03), px));
  return c;
});

/** A black round bomb held in both paws (paws drawn on top). */
export const BombSprite = (fur: Color, key: string) => CasualArt.make("ms-bomb-" + key, MoleW, MoleHpx, (p) => {
  const px = 2 / MoleW;
  let c = Color.clear;
  const bc = new V2(0, -0.18);
  const fuse = sdSegment(p, new V2(0.2, 0.18), new V2(0.36, 0.34)) - 0.035;
  c = over(c, Pal.hex(0x6a4a2a), fill(fuse, px));
  const cap = sdBox(p.sub(new V2(0.16, 0.13)), new V2(0.1, 0.07), 0.02);
  const ball = sdCircle(p, bc, 0.42);
  c = over(c, Pal.hex(0x0a0a12), fill(ball, px));
  const sh = smooth(-0.5, 0.6, (p.y - bc.y) * 0.7 - p.x * 0.5);
  c = over(c, Color.lerp(Pal.hex(0x14141e), Pal.hex(0x4a4c60), sh), fill(ball + 0.03, px));
  c = over(c, Color.white.withAlpha(0.75), fill(ellipse(p, bc.add(new V2(-0.17, 0.2)), new V2(0.1, 0.06)), px * 2));
  c = over(c, Pal.hex(0x2a2a34), fill(cap, px));
  c = over(c, Pal.hex(0x5a5c70), fill(cap + 0.02, px));
  for (const sx of [-1, 1]) {
    const pc = new V2(sx * 0.38, -0.16);
    const paw = ellipse(p, pc, new V2(0.16, 0.13));
    c = over(c, darken(fur, 0.5), fill(paw, px));
    c = over(c, Color.lerp(lighten(fur, 0.25), Cream, 0.4), fill(paw + 0.025, px));
  }
  return c;
});

/** Team headband for golden moles in duels (tinted). */
export const BandSprite = () => CasualArt.make("ms-band", MoleW, MoleHpx, (p) => {
  const px = 2 / MoleW;
  const y0 = 0.78 + p.x * p.x * -0.12;
  const band = Math.max(Math.abs(p.y - y0) - 0.08, moleSd(p) + 0.005);
  let a = fill(band, px);
  const knot = Math.min(ellipse(p, new V2(0.6, 0.66), new V2(0.12, 0.07)), ellipse(p, new V2(0.66, 0.54), new V2(0.07, 0.12)));
  a = Math.max(a, fill(knot, px));
  const v = 1 - 0.25 * smooth(0.02, 0.08, Math.abs(p.y - y0));
  return new Color(v, v, v, a);
});

/** Hole: a dark pit with a dirt rim. */
export const HoleBack = () => CasualArt.make("ms-hole-back", 160, 80, (p) => {
  const px = 2 / 160;
  let c = Color.clear;
  const rim = ellipse(p, V2.zero, new V2(0.98, 0.46));
  c = over(c, Pal.hex(0x5a3418), fill(rim, px));
  c = over(c, Pal.hex(0x7a4a26), fill(rim + 0.05, px));
  const pit = ellipse(p, new V2(0, -0.02), new V2(0.84, 0.36));
  const depth = smooth(-0.4, 0.3, p.y);
  c = over(c, Color.lerp(Pal.hex(0x1a0c06), Pal.hex(0x3a2210), depth * 0.6), fill(pit, px));
  return c;
});

/** Front half of the rim (drawn over the mole) with grass tufts. */
export const HoleFront = () => CasualArt.make("ms-hole-front", 160, 80, (p) => {
  const px = 2 / 160;
  let c = Color.clear;
  const outer = ellipse(p, V2.zero, new V2(0.98, 0.46));
  const inner = ellipse(p, new V2(0, -0.02), new V2(0.84, 0.36));
  const lip = Math.max(outer, -inner, p.y - 0.02);
  const sh = smooth(-0.46, -0.1, p.y);
  c = over(c, Pal.hex(0x4a2a12), fill(lip, px));
  c = over(c, Color.lerp(Pal.hex(0x6a3e1e), Pal.hex(0x9a6436), sh), fill(lip + 0.03, px));
  // pebbles
  for (const [x, y, r] of [[-0.6, -0.3, 0.05], [0.1, -0.4, 0.04], [0.55, -0.28, 0.05], [-0.2, -0.38, 0.03]]) c = over(c, Pal.hex(0xc09a70), fill(sdCircle(p, new V2(x, y), r), px));
  // grass tufts on the rim
  for (const gx of [-0.86, -0.7, 0.72, 0.88]) {
    const blade = sdSegment(p, new V2(gx, -0.18), new V2(gx + (gx < 0 ? -0.08 : 0.08), 0.08)) - 0.035;
    c = over(c, Pal.hex(0x3e9a2a), fill(blade, px));
  }
  return c;
});

export const HoleGlow = () => CasualArt.make("ms-hole-glow", 128, 64, (p) => {
  const d = Math.hypot(p.x, p.y * 2);
  return new Color(1, 1, 1, smooth(1, 0.55, d) * 0.9);
});

// ------------------------------------------------------------------ mallets

export interface MalletStyle { name: string; head: Color; band: Color; handle: Color; cost: number; stripes?: boolean; shiny?: boolean }
export const Mallets: MalletStyle[] = [
  { name: "WOODEN MALLET", head: Pal.hex(0xb87842), band: Pal.hex(0x5a3418), handle: Pal.hex(0xe0b07a), cost: 0 },
  { name: "SQUEAKY TOY", head: Pal.hex(0xff4a5a), band: Pal.hex(0xffd23c), handle: Pal.hex(0x3aa0ff), cost: 300 },
  { name: "CANDY HAMMER", head: Pal.hex(0xffffff), band: Pal.hex(0xff4a8a), handle: Pal.hex(0xff9ac0), cost: 700, stripes: true },
  { name: "GOLDEN MALLET", head: Pal.hex(0xffc93c), band: Pal.hex(0xb07a10), handle: Pal.hex(0x6a3a1a), cost: 1500, shiny: true },
];

/** Mallet: head at the top, handle down to the grip at the bottom (pivot = sprite bottom). */
export function MalletSprite(i: number) {
  const m = Mallets[i];
  return CasualArt.make("ms-mallet" + i, 96, 160, (p) => {
    const px = 2 / 96;
    let c = Color.clear;
    const handle = sdBox(p.sub(new V2(0, -0.55)), new V2(0.11, 1.1), 0.1);
    c = over(c, darken(m.handle, 0.45), fill(handle, px));
    c = over(c, Color.lerp(m.handle, lighten(m.handle, 0.3), smooth(0.1, -0.1, p.x)), fill(handle + 0.025, px));
    const grip = sdBox(p.sub(new V2(0, -1.3)), new V2(0.14, 0.3), 0.1);
    c = over(c, darken(m.band, 0.3), fill(grip, px));
    c = over(c, m.band, fill(grip + 0.025, px));
    const head = sdBox(p.sub(new V2(0, 0.92)), new V2(0.92, 0.5), 0.26);
    c = over(c, darken(m.head, 0.5), fill(head, px));
    let hc = Color.lerp(darken(m.head, 0.15), lighten(m.head, 0.2), smooth(0.5, 1.3, p.y));
    if (m.stripes && Math.sin((p.x + p.y) * 9) > 0.2) hc = Color.lerp(hc, m.band, 0.9);
    if (m.shiny) hc = Color.lerp(hc, Color.white, smooth(0.8, 1, Math.sin((p.x - p.y) * 5) * 0.5 + 0.5) * 0.5);
    c = over(c, hc, fill(head + 0.04, px));
    for (const sx of [-1, 1]) {
      const b = sdBox(p.sub(new V2(sx * 0.6, 0.92)), new V2(0.08, 0.5), 0.04);
      c = over(c, m.band, fill(Math.max(b, head + 0.04), px));
    }
    c = over(c, Color.white.withAlpha(0.45), fill(sdBox(p.sub(new V2(-0.1, 1.22)), new V2(0.55, 0.06), 0.06), px * 2));
    return c;
  });
}

/** Comic impact burst. */
export const BonkSprite = () => CasualArt.make("ms-bonk", 128, 128, (p) => {
  const px = 2 / 128;
  const a = Math.atan2(p.y, p.x), r = p.magnitude;
  const spikes = 0.62 + 0.3 * Math.pow(Math.abs(Math.cos(a * 4.5)), 3);
  const d = r - spikes;
  let c = Color.clear;
  c = over(c, Pal.hex(0xff7a1a), fill(d, px));
  c = over(c, Pal.hex(0xffe14a), fill(d + 0.1, px));
  c = over(c, Color.white, fill(r - 0.25, px * 3));
  return c;
});

export const SparkSprite = () => CasualArt.make("ms-spark", 64, 64, (p) => {
  const a = Math.atan2(p.y, p.x), r = p.magnitude;
  const star = 0.25 + 0.7 * Math.pow(Math.abs(Math.cos(a * 2)), 8);
  return new Color(1, 1, 1, CasualArt.fill(r - star, 2 / 64) * smooth(1, 0.2, r));
});

export const DizzyStar = () => CasualArt.StarShape;

export const CoinSprite = () => CasualArt.make("ms-coin", 64, 64, (p) => {
  const px = 2 / 64;
  let c = Color.clear;
  const r = p.magnitude;
  c = over(c, Pal.hex(0xb07a10), fill(r - 0.92, px));
  c = over(c, Color.lerp(Pal.hex(0xffb020), Pal.hex(0xffe58a), smooth(-0.8, 0.8, p.y - p.x * 0.3)), fill(r - 0.8, px));
  c = over(c, Pal.hex(0xd09018), fill(Math.abs(r - 0.55) - 0.05, px));
  return c;
});

// ------------------------------------------------------------------ boards and backdrop

export interface BoardStyle { name: string; grass: Color; grass2: Color; frame: Color; trim: Color; cost: number; flowers: Color; skyTop: Color; skyBottom: Color; lights: Color }
export const Boards: BoardStyle[] = [
  { name: "FAIRGROUND", grass: Pal.hex(0x5cc23a), grass2: Pal.hex(0x4aae2e), frame: Pal.hex(0xd2453c), trim: Pal.hex(0xffd23c), flowers: Pal.hex(0xffffff), cost: 0,
    skyTop: Pal.hex(0x3a2a8a), skyBottom: Pal.hex(0xff9a5a), lights: Pal.hex(0xffe08a) },
  { name: "SPRING MEADOW", grass: Pal.hex(0x8ad04a), grass2: Pal.hex(0x78c03c), frame: Pal.hex(0x8a5a32), trim: Pal.hex(0xf6e7b0), flowers: Pal.hex(0xff8ac0), cost: 400,
    skyTop: Pal.hex(0x4aa8ff), skyBottom: Pal.hex(0xbfeaff), lights: Pal.hex(0xffffff) },
  { name: "NIGHT FAIR", grass: Pal.hex(0x2f8a5a), grass2: Pal.hex(0x267a4e), frame: Pal.hex(0x3a3aa0), trim: Pal.hex(0x55f2ff), flowers: Pal.hex(0xffe14a), cost: 900,
    skyTop: Pal.hex(0x0a0a2a), skyBottom: Pal.hex(0x3a1a6a), lights: Pal.hex(0xff7ae0) },
  { name: "CANDY LAND", grass: Pal.hex(0xff9ccc), grass2: Pal.hex(0xff8ac0), frame: Pal.hex(0x7a4ad0), trim: Pal.hex(0xffffff), flowers: Pal.hex(0x6ae0ff), cost: 1600,
    skyTop: Pal.hex(0xff7ab0), skyBottom: Pal.hex(0xffe0a0), lights: Pal.hex(0xffffff) },
];

const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

/** The board: lawn stripes inside a painted wooden frame with bulbs. cols×rows of hole cells. */
export function BoardSprite(style: number, bw: number, bh: number) {
  const b = Boards[style];
  const W = bw >= bh ? 380 : Math.round(380 * bw / bh), H = bw >= bh ? Math.round(380 * bh / bw) : 380;
  const hx = 1, hy = H / W;
  return CasualArt.make(`ms-board${style}-${W}x${H}`, W, H, (p) => {
    const px = 2 / W;
    let c = Color.clear;
    const outer = sdBox(p, new V2(hx - 0.01, hy - 0.01), 0.12);
    const inner = sdBox(p, new V2(hx - 0.09, hy - 0.09), 0.07);
    c = over(c, darken(b.frame, 0.5), fill(outer, px));
    const fr = Color.lerp(darken(b.frame, 0.12), lighten(b.frame, 0.12), smooth(-hy, hy, p.y));
    c = over(c, fr, fill(outer + 0.012, px));
    // trim stripe around the frame
    const trim = Math.abs(sdBox(p, new V2(hx - 0.05, hy - 0.05), 0.09)) - 0.008;
    c = over(c, b.trim.withAlpha(0.9), fill(trim, px));
    // bulbs on the frame
    const per = 2 * (hx + hy);
    const n = Math.round(per / 0.16);
    const ex = hx - 0.05, ey = hy - 0.05;
    if (Math.abs(inner) < 0.1 || inner > 0) {
      for (let i = 0; i < n; i++) {
        let t = (i / n) * per, bx: number, by: number;
        if (t < 2 * ex) { bx = -ex + t; by = ey; } else if ((t -= 2 * ex) < 2 * ey) { bx = ex; by = ey - t; } else if ((t -= 2 * ey) < 2 * ex) { bx = ex - t; by = -ey; } else { t -= 2 * ex; bx = -ex; by = -ey + t; }
        const dd = Math.hypot(p.x - bx, p.y - by);
        if (dd < 0.05) {
          c = over(c, Color.white, fill(dd - 0.022, px));
          c = over(c, b.lights.withAlpha(0.5), smooth(0.05, 0.02, dd) * 0.6);
        }
      }
    }
    if (inner < px) {
      // lawn: soft diagonal mowing stripes, checker cells around holes
      const stripe = Math.floor((p.x * 0.6 + p.y) * 4.5) % 2 === 0;
      let g = stripe ? b.grass : b.grass2;
      g = Color.lerp(g, darken(g, 0.18), smooth(0, -0.08, inner));
      const n2 = hash(Math.floor(p.x * 60), Math.floor(p.y * 60));
      g = Color.lerp(g, lighten(g, 0.1), n2 * 0.25);
      // little flowers
      const fxp = Math.floor(p.x * 9), fyp = Math.floor(p.y * 9);
      if (hash(fxp, fyp) > 0.86) {
        const cx = (fxp + 0.5) / 9, cy = (fyp + 0.5) / 9;
        const fd = Math.hypot(p.x - cx, p.y - cy);
        g = over(g, b.flowers, fill(fd - 0.018, px));
        g = over(g, Gold, fill(fd - 0.007, px));
      }
      c = over(c, darken(b.frame, 0.45), fill(inner, px));
      c = over(c, g, fill(inner + 0.01, px));
    }
    return c;
  });
}

/** Fairground backdrop: dusk sky, string lights, striped tents and bunting. */
export function BackdropSprite(style: number) {
  const b = Boards[style];
  return CasualArt.make("ms-back" + style, 128, 256, (p) => {
    const px = 2 / 128;
    const t = (p.y + 2) / 4;
    let c = Color.lerp(b.skyBottom, b.skyTop, smooth(0.15, 0.95, t));
    // sun glow
    c = Color.lerp(c, lighten(b.skyBottom, 0.4), smooth(0.9, 0, Math.hypot(p.x * 0.8, (p.y + 0.4) * 1.2)) * 0.35);
    // stars on dark skies
    if (style === 2 && hash(Math.floor(p.x * 40), Math.floor(p.y * 40)) > 0.97) c = Color.lerp(c, Color.white, 0.8);
    // ferris wheel silhouette
    const fw = new V2(0.5, 0.15);
    const fr = Math.hypot(p.x - fw.x, p.y - fw.y);
    const sil = darken(b.skyTop, 0.35).withAlpha(0.55);
    if (Math.abs(fr - 0.55) < 0.02) c = over(c, sil, 1);
    const ang = Math.atan2(p.y - fw.y, p.x - fw.x);
    if (fr < 0.55 && Math.abs(Math.sin(ang * 4)) * fr < 0.012) c = over(c, sil, 1);
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      if (Math.hypot(p.x - fw.x - Math.cos(a) * 0.55, p.y - fw.y - Math.sin(a) * 0.55) < 0.05) c = over(c, sil, 1);
    }
    if (sdSegment(p, fw, new V2(0.2, -0.8)) < 0.018 || sdSegment(p, fw, new V2(0.8, -0.8)) < 0.018) c = over(c, sil, 1);
    // tents along the bottom
    for (const [cx, w, h] of [[-0.75, 0.42, 0.55], [0.05, 0.5, 0.7], [0.85, 0.4, 0.5]]) {
      const base = -1.15;
      const roofY = base + h;
      const inRoof = p.y < roofY + 0.25 - Math.abs(p.x - cx) * 0.6 && p.y > roofY - 0.05 && Math.abs(p.x - cx) < w;
      const inWall = Math.abs(p.x - cx) < w * 0.85 && p.y < roofY && p.y > base - 1;
      if (inWall) {
        const st = Math.floor((p.x - cx) * 10) % 2 === 0;
        c = st ? Pal.hex(0xff5a5a) : Pal.hex(0xfff0e0);
        c = darken(c, 0.25 + 0.2 * smooth(roofY, base - 0.6, p.y));
      }
      if (inRoof) {
        const st = Math.floor(Math.atan2(p.x - cx, roofY + 0.25 - p.y) * 8) % 2 === 0;
        c = st ? Pal.hex(0xff4a4a) : Pal.hex(0xfff6ea);
        c = darken(c, 0.1);
      }
      if (Math.abs(p.x - cx) < 0.012 && p.y > roofY + 0.2 && p.y < roofY + 0.4) c = Pal.hex(0x4a3a3a);
      const flag = p.x - cx > 0 && p.x - cx < 0.12 && p.y > roofY + 0.33 - (p.x - cx) * 0.4 && p.y < roofY + 0.4;
      if (flag) c = Gold;
    }
    // ground
    if (p.y < -1.2) c = Color.lerp(darken(b.grass, 0.25), darken(b.grass, 0.45), smooth(-1.2, -2, p.y));
    // string lights (two catenaries)
    for (const [y0, sag] of [[1.4, 0.3], [0.9, 0.25]]) {
      const ly = y0 - sag * (1 - p.x * p.x);
      if (Math.abs(p.y - ly) < 0.008) c = Color.lerp(c, Pal.hex(0x2a1a1a), 0.7);
      const k = Math.round(p.x * 6) / 6;
      const by = y0 - sag * (1 - k * k) - 0.03;
      const dd = Math.hypot(p.x - k, p.y - by);
      if (dd < 0.08) {
        c = Color.lerp(c, b.lights, smooth(0.08, 0.02, dd) * 0.45);
        c = Color.lerp(c, Color.white, fill(dd - 0.022, px));
      }
      // bunting
      const fk = Math.floor(p.x * 6 + 0.5) / 6 + 1 / 12;
      const fy = y0 - sag * (1 - fk * fk);
      const fx = p.x - fk;
      if (Math.abs(fx) < 0.05 && p.y < fy && p.y > fy - 0.1 + Math.abs(fx) * 2) {
        const cols = [Pal.hex(0xff4a5a), Gold, Pal.hex(0x3ac0ff), Pal.hex(0x6ae06a)];
        c = cols[Math.abs(Math.floor(p.x * 6 + 0.5 + y0 * 3)) % 4];
      }
    }
    return c.withAlpha(1);
  });
}

export const RoundPanel = () => CasualArt.make("ms-panel", 96, 96, (p) => new Color(1, 1, 1, fill(sdBox(p, new V2(0.96, 0.96), 0.4), 2 / 96)), 36, 100);
