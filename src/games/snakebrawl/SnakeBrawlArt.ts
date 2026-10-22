import { CasualArt, Color, Mathf, Pal, V2 } from "../../kit";

/**
 * Procedural art for Snake Brawl: shaded body segments (white, tinted per snake), eyes, candy food, the grassy
 * arena tile and the fence. (Port of SnakeBrawlArt.cs.)
 */

const Clear = new Color(1, 1, 1, 0);

export const SnakeBrawlArt = {
  Skins: [
    Pal.hex(0x4cc85c), Pal.hex(0xff5c7a), Pal.hex(0x3f8cff), Pal.hex(0xffc93c), Pal.hex(0xa56bff), Pal.hex(0xff8a30),
    Pal.hex(0x2fc9c2), Pal.hex(0xf06bd0), Pal.hex(0x8bd14a), Pal.hex(0xe84a3c), Pal.hex(0x5a6cff), Pal.hex(0xffe066),
  ],
  SkinNames: ["MINT", "BERRY", "OCEAN", "SUNNY", "GRAPE", "TIGER"],

  get Segment() {
    return CasualArt.make("sb-seg", 64, 64, (p) => {
      const px = 2 / 64;
      let c = CasualArt.ballPixel(p, Color.white, px, 0.94);
      if (c.a <= 0) return c;
      const rim = CasualArt.smooth(0.8, 0.94, p.magnitude);
      c = Color.lerp(c, new Color(0.55, 0.55, 0.55, c.a), rim * 0.5);
      return c;
    });
  },

  get Head() {
    return CasualArt.make("sb-head", 96, 96, (p) => {
      const px = 2 / 96;
      // slightly wider than long, nose pointing +x
      const q = new V2(p.x / 1.0, p.y / 0.95);
      let c = CasualArt.ballPixel(q, Color.white, px, 0.94);
      if (c.a <= 0) return c;
      const nostrils = Math.min(CasualArt.sdCircle(p, new V2(0.72, 0.16), 0.05), CasualArt.sdCircle(p, new V2(0.72, -0.16), 0.05));
      c = Color.lerp(c, new Color(0.35, 0.35, 0.35, c.a), CasualArt.fill(nostrils, px) * 0.8);
      return c;
    });
  },

  get Eye() {
    return CasualArt.make("sb-eye", 48, 48, (p) => {
      const px = 2 / 48;
      let c = Clear;
      c = CasualArt.over(c, new Color(0.2, 0.2, 0.25, 1), CasualArt.fill(p.magnitude - 0.95, px));
      c = CasualArt.over(c, Color.white, CasualArt.fill(p.magnitude - 0.82, px));
      return c;
    });
  },

  get Pupil() {
    return CasualArt.make("sb-pupil", 32, 32, (p) => {
      const px = 2 / 32;
      let c = Clear;
      c = CasualArt.over(c, Pal.hex(0x1c1e2a), CasualArt.fill(p.magnitude - 0.9, px));
      c = CasualArt.over(c, Color.white, CasualArt.fill(CasualArt.sdCircle(p, new V2(-0.3, 0.35), 0.25), px));
      return c;
    });
  },

  get Food() {
    return CasualArt.make("sb-food", 48, 48, (p) => CasualArt.ballPixel(p, Color.white, 2 / 48, 0.9));
  },

  get Halo() { return CasualArt.make("sb-halo", 48, 48, (p) => new Color(1, 1, 1, CasualArt.smooth(1, 0.3, p.magnitude) * 0.5)); },

  /** Grass tile with a soft checker, 1 unit = 8 world units when scaled 8. */
  get Grass() {
    return CasualArt.make("sb-grass", 256, 256, (p) => {
      const u = p.add(V2.one).mul(2); // 0..4 cells
      const check = (Math.trunc(Math.floor(u.x)) + Math.trunc(Math.floor(u.y))) % 2 === 0;
      let c = check ? Pal.hex(0x9bd86a) : Pal.hex(0x8ecf5f);
      const n = Mathf.perlinNoise(p.x * 9 + 4, p.y * 9 + 2);
      c = Color.lerp(c, Pal.hex(0x7cc152), CasualArt.smooth(0.55, 0.8, n) * 0.35);
      // tiny grass blades
      const blades = Math.sin(p.x * 120 + Math.sin(p.y * 60) * 3) * Math.sin(p.y * 140);
      c = Color.lerp(c, Pal.hex(0xb6e58a), CasualArt.smooth(0.85, 0.98, blades) * 0.5);
      // a few flowers
      const f = new V2(Mathf.repeat(u.x * 1.5 + 0.3, 1) - 0.5, Mathf.repeat(u.y * 1.5 + 0.7, 1) - 0.5);
      const hash = Mathf.repeat(Math.sin(Math.floor(u.x * 1.5 + 0.3) * 12.9898 + Math.floor(u.y * 1.5 + 0.7) * 78.233) * 43758.5453, 1);
      if (hash > 0.8) {
        const fl = f.magnitude - 0.05;
        c = Color.lerp(c, hash > 0.9 ? Pal.hex(0xffffff) : Pal.hex(0xffe36a), CasualArt.fill(fl, (2 / 256) * 1.5));
      }
      return c.withAlpha(1);
    });
  },

  get Outside() {
    return CasualArt.make("sb-outside", 64, 64, (p) => Color.lerp(Pal.hex(0x4e8a3a), Pal.hex(0x467f34), Mathf.perlinNoise(p.x * 3, p.y * 3)).withAlpha(1));
  },

  /** Fence post seen from above (round wooden cap). */
  get Post() {
    return CasualArt.make("sb-post", 64, 64, (p) => {
      const px = 2 / 64;
      let c = Clear;
      c = CasualArt.over(c, Pal.hex(0x6e4022), CasualArt.fill(p.magnitude - 0.95, px));
      const top = Color.lerp(Pal.hex(0xc98e58), Pal.hex(0xe0b57f), CasualArt.smooth(0.8, -0.8, p.y - p.x));
      c = CasualArt.over(c, top, CasualArt.fill(p.magnitude - 0.78, px));
      const ring = Math.abs(p.magnitude - 0.4) - 0.04;
      c = Color.lerp(c, Pal.hex(0xa8703f), CasualArt.fill(ring, px) * 0.6);
      return c;
    });
  },
};
