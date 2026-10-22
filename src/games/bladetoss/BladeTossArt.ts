import { CasualArt, Color, Mathf, Pal, Sprite, V2 } from "../../kit";

/**
 * Procedural art for Blade Toss: knives in six skins (pointing up), wooden log targets and the boss targets,
 * apples, wood chips and the autumn-forest backdrop. (Port of BladeTossArt.cs.)
 */

const Handle = [Pal.hex(0x7a4a28), Pal.hex(0x3e7a3a), Pal.hex(0xc0203a), Pal.hex(0x2378c8), Pal.hex(0x2a2a30), Pal.hex(0x5b2a86)];
const Accent = [Pal.hex(0xc9a26b), Pal.hex(0xe0c46a), Pal.hex(0xffd4da), Pal.hex(0x9fe2ff), Pal.hex(0xffc93c), Pal.hex(0x50e3a4)];
const Clear = new Color(1, 1, 1, 0);

function KnifePixel(skin: number, p: V2, px: number): Color {
  // p.x -1..1 ; p.y -4..4. Blade from y=-0.4 to 3.8, guard at -0.6, handle -0.8..-3.9
  let c = Clear;
  // blade: one sharp edge on the right, tip at top
  const bladeHalf = 0.55;
  const tipT = Mathf.clamp01((p.y - 2.4) / 1.4);
  const right = bladeHalf * (1 - tipT * tipT);
  const left = -bladeHalf * (1 - tipT);
  const db = Math.max(Math.max(left - p.x, p.x - right), Math.max(-0.5 - p.y, p.y - 3.8));
  let steel = Color.lerp(Pal.hex(0x9aa3b2), Pal.hex(0xe9eef5), CasualArt.smooth(-0.5, 0.4, p.x));
  steel = Color.lerp(steel, Color.white, CasualArt.smooth(0.1, 0, Math.abs(p.x - right + 0.12)) * 0.7);
  if (skin === 4) steel = Color.lerp(steel, Pal.hex(0xffd45a), 0.55);
  if (skin === 5) steel = Color.lerp(steel, Pal.hex(0x7fe8c0), 0.35);
  c = CasualArt.over(c, Pal.hex(0x4a5260), CasualArt.fill(db, px));
  c = CasualArt.over(c, steel, CasualArt.fill(db + 0.06, px));
  // fuller groove
  const groove = CasualArt.sdBox(p.sub(new V2(-0.12, 1.0)), new V2(0.06, 1.2), 0.05);
  c = Color.lerp(c, Pal.hex(0x7c8696), CasualArt.fill(groove, px) * 0.6);
  // guard
  const dg = CasualArt.sdBox(p.sub(new V2(0, -0.62)), new V2(0.92, 0.16), 0.1);
  c = CasualArt.over(c, CasualArt.darken(Accent[skin], 0.45), CasualArt.fill(dg, px));
  c = CasualArt.over(c, Accent[skin], CasualArt.fill(dg + 0.05, px));
  // handle
  const dh = CasualArt.sdBox(p.sub(new V2(0, -2.3)), new V2(0.5, 1.55), 0.42);
  let hc = Color.lerp(CasualArt.darken(Handle[skin], 0.2), CasualArt.lighten(Handle[skin], 0.25), CasualArt.smooth(-0.5, 0.3, -p.x));
  const wraps = Math.sin(p.y * 9);
  hc = Color.lerp(hc, CasualArt.darken(Handle[skin], 0.35), CasualArt.smooth(0.6, 1, wraps) * 0.5);
  c = CasualArt.over(c, CasualArt.darken(Handle[skin], 0.55), CasualArt.fill(dh, px));
  c = CasualArt.over(c, hc, CasualArt.fill(dh + 0.06, px));
  const pommel = CasualArt.sdCircle(p, new V2(0, -3.9), 0.32);
  c = CasualArt.over(c, Accent[skin], CasualArt.fill(pommel, px));
  return c;
}

function TargetPixel(kind: number, p: V2, px: number): Color {
  const r = p.magnitude;
  const d = r - 0.96;
  const a = CasualArt.fill(d, px);
  if (a <= 0) return Clear;
  const ang = Math.atan2(p.y, p.x);
  let c: Color;
  switch (kind) {
    case 1: { // cheese wheel with holes
      c = Color.lerp(Pal.hex(0xf5c84b), Pal.hex(0xffe08a), CasualArt.smooth(0.9, 0.2, r));
      for (let i = 0; i < 9; i++) {
        const ha = i * 2.4, hr = 0.25 + (i % 3) * 0.22;
        const hole = CasualArt.sdCircle(p, new V2(Math.cos(ha), Math.sin(ha)).mul(hr), 0.07 + (i % 2) * 0.04);
        c = Color.lerp(c, Pal.hex(0xd9a22e), CasualArt.fill(hole, px));
      }
      c = Color.lerp(c, Pal.hex(0xe8a93a), CasualArt.smooth(0.82, 0.96, r));
      break;
    }
    case 2: { // tire
      c = Color.lerp(Pal.hex(0x2b2d33), Pal.hex(0x3e4149), CasualArt.smooth(0.3, 0.9, r));
      const tread = Math.abs(Math.sin(ang * 18));
      if (r > 0.78) c = Color.lerp(c, Pal.hex(0x1c1d21), CasualArt.smooth(0.6, 1, tread));
      const hub = r - 0.38;
      c = Color.lerp(c, Pal.hex(0xb9bec8), CasualArt.fill(hub, px));
      let bolts = 9;
      for (let i = 0; i < 5; i++) {
        const ba = (i * Math.PI * 2) / 5;
        bolts = Math.min(bolts, CasualArt.sdCircle(p, new V2(Math.cos(ba), Math.sin(ba)).mul(0.24), 0.05));
      }
      c = Color.lerp(c, Pal.hex(0x6a707c), CasualArt.fill(bolts, px));
      break;
    }
    case 3: { // shield
      const q = p.x > 0 === p.y > 0;
      c = q ? Pal.hex(0x2f6fd6) : Pal.hex(0xe8eef5);
      c = Color.lerp(c, Pal.hex(0xc9a23a), CasualArt.smooth(0.8, 0.86, r));
      c = Color.lerp(c, Pal.hex(0xc9a23a), CasualArt.fill(r - 0.2, px));
      for (let i = 0; i < 12; i++) {
        const ra = (i * Math.PI) / 6;
        const rv = CasualArt.sdCircle(p, new V2(Math.cos(ra), Math.sin(ra)).mul(0.9), 0.035);
        c = Color.lerp(c, Pal.hex(0xfff0b0), CasualArt.fill(rv, px));
      }
      break;
    }
    case 4: { // orange slice
      c = Color.lerp(Pal.hex(0xff9a1f), Pal.hex(0xffb84a), CasualArt.smooth(0.9, 0.1, r));
      const seg = Math.abs(Math.sin(ang * 5)) * r;
      if (r < 0.8) c = Color.lerp(Pal.hex(0xfff1d6), c, CasualArt.smooth(0.0, 0.04, seg));
      c = Color.lerp(c, Pal.hex(0xfff1d6), CasualArt.smooth(0.78, 0.82, r) * CasualArt.smooth(0.9, 0.86, r));
      c = Color.lerp(c, Pal.hex(0xf07d10), CasualArt.smooth(0.88, 0.96, r));
      c = Color.lerp(c, Pal.hex(0xfff1d6), CasualArt.fill(r - 0.08, px));
      break;
    }
    case 5: { // stone wheel
      const n = Mathf.perlinNoise(p.x * 5 + 3, p.y * 5 + 1);
      c = Color.lerp(Pal.hex(0x8a8f99), Pal.hex(0xb4b9c2), n);
      const crack = Math.abs(Math.sin(ang * 3 + r * 6)) * r;
      c = Color.lerp(c, Pal.hex(0x5e636c), CasualArt.smooth(0.04, 0, crack) * 0.7);
      c = Color.lerp(c, Pal.hex(0x6a6f78), CasualArt.smooth(0.84, 0.96, r));
      c = Color.lerp(c, Pal.hex(0x4a4e55), CasualArt.fill(r - 0.14, px));
      break;
    }
    default: { // log slice with growth rings and bark
      const wob = Mathf.perlinNoise(Math.cos(ang) * 2 + 5, Math.sin(ang) * 2 + 5) * 0.06;
      const rings = Math.sin((r + wob) * 42);
      c = Color.lerp(Pal.hex(0xe8b97a), Pal.hex(0xf4d29e), CasualArt.smooth(0.85, 0, r));
      c = Color.lerp(c, Pal.hex(0xc98e52), CasualArt.smooth(0.5, 1, rings) * 0.45);
      const crack = Math.abs(ang - 0.7) < 0.03 && r < 0.6 ? 1 : 0;
      c = Color.lerp(c, Pal.hex(0x9a6030), crack * 0.6);
      const bark = CasualArt.smooth(0.82, 0.86, r + Math.sin(ang * 30) * 0.01);
      const barkC = Color.lerp(Pal.hex(0x6e4022), Pal.hex(0x8c5630), Math.abs(Math.sin(ang * 23)));
      c = Color.lerp(c, barkC, bark);
      break;
    }
  }
  // gentle shading (light from top-left) and a dark outline
  const shade = V2.dot(p, new V2(0.5, -0.6)) * 0.12;
  c = CasualArt.darken(c, Math.max(0, shade));
  c = Color.lerp(CasualArt.darken(c, 0.5), c, CasualArt.fill(d + 0.03, px));
  return c.withAlpha(a);
}

export const BladeTossArt = {
  Skins: 6,
  SkinNames: ["CLASSIC", "RANGER", "RUBY", "OCEAN", "GOLDEN", "DRAGON"],
  SkinCost: [0, 60, 150, 300, 500, 800],

  Targets: 6, // 0 = log, 1..5 bosses
  TargetNames: ["LOG", "CHEESE WHEEL", "OLD TIRE", "KNIGHT'S SHIELD", "ORANGE", "STONE WHEEL"],

  /** Knife sprite, 1 unit wide x 4 tall in sprite space (tip up). Total length ≈ 1.3 world units at scale 0.33. */
  Knife(skin: number): Sprite { return CasualArt.make("bt-knife-" + skin, 64, 256, (p) => KnifePixel(skin, p, 2 / 64)); },

  Target(kind: number): Sprite { return CasualArt.make("bt-target-" + kind, 256, 256, (p) => TargetPixel(kind, p, 2 / 256)); },

  get Apple(): Sprite {
    return CasualArt.make("bt-apple", 96, 96, (p) => {
      const px = 2 / 96;
      let body = Math.min(CasualArt.sdCircle(p, new V2(-0.22, -0.1), 0.6), CasualArt.sdCircle(p, new V2(0.22, -0.1), 0.6));
      body = Math.max(body, -CasualArt.sdCircle(p, new V2(0, 0.6), 0.16));
      let c = Clear;
      const stem = CasualArt.sdSegment(p, new V2(0, 0.45), new V2(0.08, 0.85)) - 0.05;
      c = CasualArt.over(c, Pal.hex(0x6e4022), CasualArt.fill(stem, px));
      let skin = Color.lerp(Pal.hex(0xc8102e), Pal.hex(0xff4a4a), CasualArt.smooth(0.5, -0.6, p.x - p.y * 0.5));
      skin = Color.lerp(skin, Color.white, CasualArt.smooth(0.25, 0, p.sub(new V2(-0.3, 0.15)).magnitude) * 0.6);
      c = CasualArt.over(c, Pal.hex(0x7a0a1e), CasualArt.fill(body, px));
      c = CasualArt.over(c, skin, CasualArt.fill(body + 0.05, px));
      const lq = p.sub(new V2(0.28, 0.72));
      const leaf = new V2((lq.x * 0.8 + lq.y * 0.6) / 0.26, (-lq.x * 0.6 + lq.y * 0.8) / 0.11).magnitude - 1;
      c = CasualArt.over(c, Pal.hex(0x3db54a), CasualArt.fill(leaf * 0.1, px));
      return c;
    });
  },

  get Chip(): Sprite {
    return CasualArt.make("bt-chip", 32, 16, (p) => new Color(1, 1, 1, CasualArt.fill(CasualArt.sdBox(p, new V2(0.85, 0.35), 0.1), 2 / 32)));
  },

  /** Autumn forest backdrop: dusk sky, layered pine silhouettes, mist. */
  get Forest(): Sprite {
    return CasualArt.make("bt-forest", 256, 512, (p) => {
      const y = p.y; // -2..2
      let c = Color.lerp(Pal.hex(0xf6b26b), Pal.hex(0x5b4b8a), CasualArt.smooth(-0.6, 1.9, y));
      c = Color.lerp(c, Pal.hex(0xffd9a0), CasualArt.smooth(0.6, 0, p.sub(new V2(-0.35, -0.15)).magnitude) * 0.6);
      for (let layer = 0; layer < 3; layer++) {
        const baseY = -0.55 - layer * 0.45;
        const freq = 9 + layer * 4;
        const saw = Math.abs(Mathf.repeat(p.x * freq * 0.5 + layer * 0.37, 1) - 0.5) * 2; // 0 at peaks
        const h = baseY + (1 - saw) * (0.32 - layer * 0.05) + Math.sin(p.x * 3 + layer) * 0.05;
        const tree = layer === 0 ? Pal.hex(0x7a5a8a) : layer === 1 ? Pal.hex(0x4e3d6a) : Pal.hex(0x2e2545);
        if (y < h) c = Color.lerp(c, tree, 0.92);
        const mist = CasualArt.smooth(0.18, 0, Math.abs(y - baseY + 0.05));
        c = Color.lerp(c, Pal.hex(0xf2c9b0), mist * 0.25 * (1 - layer * 0.3));
      }
      return c.withAlpha(1);
    });
  },
};
