import { CasualArt, Color, Mathf, Pal, Sprite, V2 } from "../../kit";

/**
 * Procedural neon art for GALAXY DEFENDERS: original pixel-grid invaders (two animation frames each), the player
 * cannon, saucer, mothership boss, shots, power-up capsules, the space backdrop and the CRT scanline overlay.
 */

const fill = CasualArt.fill, smooth = CasualArt.smooth;

// 11 × 8 pixel invaders (original designs), two frames each
const Pixels: string[][][] = [
  [ // 0 JELLY (bottom rows, 10 pts)
    ["....XXX....", "..XXXXXXX..", ".XXXXXXXXX.", "XX..XXX..XX", "XXXXXXXXXXX", ".X.X.X.X.X.", "X.X.X.X.X.X", "..........."],
    ["....XXX....", "..XXXXXXX..", ".XXXXXXXXX.", "XX..XXX..XX", "XXXXXXXXXXX", "X.X.X.X.X.X", ".X.X.X.X.X.", "..........."],
  ],
  [ // 1 BEETLE (middle rows, 20 pts)
    ["X.........X", ".X..XXX..X.", "..XXXXXXX..", ".XX.XXX.XX.", "..XXXXXXX..", ".X.XXXXX.X.", "X..X...X..X", "..........."],
    ["..X.....X..", "..X.XXX.X..", "..XXXXXXX..", ".XX.XXX.XX.", "X.XXXXXXX.X", "..XXXXXXX..", ".X.X...X.X.", "..........."],
  ],
  [ // 2 SPARK (top row, 30 pts)
    [".....X.....", "....XXX....", "...XXXXX...", "..XX.X.XX..", "..XXXXXXX..", "...X.X.X...", "..X.X.X.X..", "..........."],
    [".....X.....", "....XXX....", "...XXXXX...", "..XX.X.XX..", "..XXXXXXX..", "..X.X.X.X..", "...X...X...", "..........."],
  ],
];

export const AlienColors = [Pal.hex(0x7dff5a), Pal.hex(0x3ae8ff), Pal.hex(0xff4fd8)];
export const ArmorColor = Pal.hex(0xffd25a);
export const AlienPoints = [10, 20, 30];

function hash(x: number, y: number, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pixelSprite(key: string, rows: string[], armor: boolean) {
  const cols = rows[0].length, n = rows.length;
  const W = cols * 10, Hh = n * 10;
  const hw = Hh / W; // p.y spans [-hw, hw]
  return CasualArt.make(key, W, Hh, (p) => {
    const fx = ((p.x + 1) / 2) * cols, fy = ((hw - p.y) / (2 * hw)) * n;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const on = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < n && rows[y][x] !== ".";
    if (!on(ix, iy)) return Color.clear;
    const lx = fx - ix, ly = fy - iy;
    // bevelled pixel: lighter top-left, darker bottom-right where neighbours are missing
    let v = 0.86;
    if (!on(ix, iy - 1)) v = Mathf.lerp(1.15, v, smooth(0, 0.3, ly));
    if (!on(ix - 1, iy)) v = Math.max(v, Mathf.lerp(1.08, v, smooth(0, 0.3, lx)));
    if (!on(ix, iy + 1)) v *= Mathf.lerp(1, 0.7, smooth(0.65, 1, ly));
    if (!on(ix + 1, iy)) v *= Mathf.lerp(1, 0.8, smooth(0.7, 1, lx));
    let c = new Color(Math.min(1, v), Math.min(1, v), Math.min(1, v), 1);
    if (armor) {
      // riveted plates
      const edge = Math.min(lx, ly, 1 - lx, 1 - ly);
      c = Color.lerp(c, new Color(0.55, 0.55, 0.6, 1), smooth(0.12, 0.02, edge) * 0.8);
      if ((ix + iy) % 3 === 0) c = Color.lerp(c, Color.white, smooth(0.18, 0.05, Math.hypot(lx - 0.5, ly - 0.5)));
    }
    return c;
  });
}

export const GalaxyArt = {
  Alien(kind: number, frame: number, armor = false): Sprite { return pixelSprite(`gd-alien-${kind}-${frame}-${armor ? 1 : 0}`, Pixels[kind][frame], armor); },
  AlienAspect: 8 / 11,

  /** Player cannon (white-ish hull, tint it per player). Width 1 unit, height 0.75. */
  Cannon(): Sprite {
    return CasualArt.make("gd-cannon", 128, 96, (p) => {
      const px = 2 / 128;
      const hull = CasualArt.sdBox(p.sub(new V2(0, -0.42)), new V2(0.92, 0.2), 0.12);
      const body = CasualArt.sdBox(p.sub(new V2(0, -0.12)), new V2(0.58, 0.2), 0.16);
      const barrel = CasualArt.sdBox(p.sub(new V2(0, 0.3)), new V2(0.11, 0.38), 0.06);
      const d = Math.min(hull, body, barrel);
      const a = fill(d, px);
      if (a <= 0) return Color.clear;
      let v = Mathf.lerp(0.62, 1, smooth(-0.62, 0.5, p.y));
      v = Mathf.lerp(v, 1, smooth(0.05, 0, Math.abs(d + 0.05)) * 0.4);
      let c = new Color(v, v, v, 1);
      // cockpit stripe and barrel tip
      c = Color.lerp(c, new Color(0.35, 0.35, 0.4, 1), fill(CasualArt.sdBox(p.sub(new V2(0, -0.12)), new V2(0.34, 0.05), 0.04), px) * 0.9);
      c = Color.lerp(c, Color.white, fill(CasualArt.sdBox(p.sub(new V2(0, 0.64)), new V2(0.09, 0.06), 0.03), px));
      for (const x of [-0.7, -0.35, 0.35, 0.7]) c = Color.lerp(c, new Color(0.3, 0.3, 0.35, 1), fill(new V2(p.x - x, p.y + 0.42).magnitude - 0.06, px));
      return c.withAlpha(a);
    });
  },

  Saucer(): Sprite {
    return CasualArt.make("gd-ufo", 160, 80, (p) => {
      const px = 2 / 160;
      const disc = new V2(p.x / 0.98, (p.y + 0.08) / 0.2).magnitude - 1;
      const dome = new V2(p.x / 0.42, (p.y - 0.12) / 0.3).magnitude - 1;
      const a = Math.max(fill(disc * 0.2, px), fill(dome * 0.3, px) * (p.y > -0.05 ? 1 : 0));
      if (a <= 0) return Color.clear;
      let c: Color;
      if (dome < 0 && p.y > 0.02) {
        c = Color.lerp(Pal.hex(0x9ff6ff), Pal.hex(0x2a5a9a), smooth(0.4, -0.1, p.y - p.x * 0.3));
        c = Color.lerp(c, Color.white, smooth(0.15, 0, Math.hypot(p.x + 0.15, p.y - 0.3)) * 0.8);
      } else {
        const v = Mathf.lerp(0.55, 1, smooth(-0.25, 0.1, p.y));
        c = Color.lerp(Pal.hex(0xff3d6a).mul(v), Pal.hex(0xffffff), smooth(0.03, 0, Math.abs(p.y + 0.02)) * 0.4).withAlpha(1);
        for (let i = -3; i <= 3; i++) c = Color.lerp(c, Pal.hex(0xfff27a), fill(new V2(p.x - i * 0.24, p.y + 0.1).magnitude - 0.05, px));
      }
      return c.withAlpha(a);
    });
  },

  Boss(): Sprite {
    return CasualArt.make("gd-boss", 256, 128, (p) => {
      const px = 2 / 256;
      const body = new V2(p.x / 0.95, (p.y - 0.02) / 0.32).magnitude - 1;
      const wingL = CasualArt.sdSegment(p, new V2(-0.55, -0.1), new V2(-0.95, -0.42)) - 0.09;
      const wingR = CasualArt.sdSegment(p, new V2(0.55, -0.1), new V2(0.95, -0.42)) - 0.09;
      const crown = CasualArt.sdBox(p.sub(new V2(0, 0.3)), new V2(0.32, 0.12), 0.08);
      const d = Math.min(body * 0.3, wingL, wingR, crown);
      const a = fill(d, px);
      if (a <= 0) return Color.clear;
      const v = Mathf.lerp(0.5, 1, smooth(-0.4, 0.35, p.y));
      let c = Color.lerp(Pal.hex(0x6a2aff), Pal.hex(0xc04aff), smooth(-0.2, 0.3, p.y)).mul(v).withAlpha(1);
      // armour plating lines
      const plate = Math.abs(Math.sin(p.x * 18)) < 0.08 && body < -0.15 ? 1 : 0;
      c = Color.lerp(c, Pal.hex(0x2a0f5a), plate * 0.7);
      // glowing core and eyes
      const core = new V2(p.x, p.y + 0.02).magnitude;
      c = Color.lerp(c, Pal.hex(0xff4fd8), fill(core - 0.13, px));
      c = Color.lerp(c, Color.white, fill(core - 0.06, px));
      for (const x of [-0.42, 0.42]) c = Color.lerp(c, Pal.hex(0x3ae8ff), fill(new V2((p.x - x) / 1.6, p.y - 0.06).magnitude - 0.05, px));
      c = Color.lerp(c, Pal.hex(0xffd25a), fill(Math.abs(p.y - 0.3) - 0.025, px) * fill(Math.abs(p.x) - 0.28, px));
      return c.withAlpha(a);
    });
  },

  /** Alien shot styles: 0 plunger, 1 zigzag, 2 twister. Two frames. */
  Shot(kind: number, frame: number): Sprite {
    return CasualArt.make(`gd-shot-${kind}-${frame}`, 32, 96, (p) => {
      const px = 2 / 32;
      let d = 1;
      if (kind === 0) {
        d = Math.min(CasualArt.sdBox(p, new V2(0.18, 2.6), 0.1), CasualArt.sdBox(p.sub(new V2(0, frame === 0 ? 1.4 : -1.4)), new V2(0.7, 0.18), 0.08));
      } else if (kind === 1) {
        for (let i = 0; i < 5; i++) {
          const y0 = -2.6 + i * 1.04, x0 = ((i + frame) % 2 === 0 ? -0.55 : 0.55);
          d = Math.min(d, CasualArt.sdSegment(p, new V2(x0, y0), new V2(-x0, y0 + 1.04)) - 0.2);
        }
      } else {
        const tw = Math.sin(p.y * 2.6 + frame * Math.PI) * 0.5;
        d = Math.min(Math.abs(p.x - tw) - 0.2, Math.abs(p.x + tw) - 0.2);
        d = Math.max(d, Math.abs(p.y) - 2.7);
      }
      return new Color(1, 1, 1, fill(d, px));
    });
  },

  get Bolt(): Sprite {
    return CasualArt.make("gd-bolt", 16, 96, (p) => {
      const w = 0.55 * smooth(3, 1.5, Math.abs(p.y)) + 0.1;
      const a = smooth(0.1, -0.15, Math.abs(p.x) - w) * smooth(3, 2.2, Math.abs(p.y));
      const core = smooth(0.3, 0, Math.abs(p.x));
      return new Color(Mathf.lerp(0.8, 1, core), 1, 1, a);
    });
  },

  /** Power-up capsule with a letter-like glyph: 0 RAPID, 1 SPREAD, 2 SHIELD. */
  Capsule(kind: number): Sprite {
    return CasualArt.make("gd-cap-" + kind, 96, 96, (p) => {
      const px = 2 / 96;
      const shell = CasualArt.sdBox(p, new V2(0.62, 0.82), 0.5);
      const a = fill(shell, px);
      if (a <= 0) return Color.clear;
      const col = [Pal.hex(0xff8a1a), Pal.hex(0x3ae8ff), Pal.hex(0x39ff88)][kind];
      let c = Color.lerp(col.mul(0.55), col, smooth(-0.8, 0.6, p.y)).withAlpha(1);
      c = Color.lerp(c, Color.white, smooth(0.25, 0, Math.hypot((p.x + 0.25) * 1.5, p.y - 0.45)) * 0.7);
      c = Color.lerp(c, Color.white, smooth(0.05, 0, Math.abs(shell + 0.05)) * 0.6);
      let g = 1;
      if (kind === 0) { // double chevron (rapid)
        for (const y of [-0.12, 0.22]) g = Math.min(g, Math.min(CasualArt.sdSegment(p, new V2(-0.3, y - 0.18), new V2(0, y)), CasualArt.sdSegment(p, new V2(0.3, y - 0.18), new V2(0, y))) - 0.07);
      } else if (kind === 1) { // fan of three
        for (const ang of [-0.45, 0, 0.45]) g = Math.min(g, CasualArt.sdSegment(p, new V2(0, -0.35), new V2(Math.sin(ang) * 0.5, -0.35 + Math.cos(ang) * 0.6)) - 0.07);
      } else { // shield arc
        g = Math.abs(new V2(p.x, p.y + 0.15).magnitude - 0.4) - 0.07;
        g = Math.max(g, -(p.y + 0.05));
      }
      c = Color.lerp(c, Pal.hex(0x101030), fill(g, px));
      return c.withAlpha(a);
    });
  },

  get ShieldBubble(): Sprite {
    return CasualArt.make("gd-bubble", 96, 96, (p) => {
      const r = p.magnitude;
      const ring = smooth(0.12, 0, Math.abs(r - 0.85)) + smooth(0.85, 0.2, r) * 0.15;
      return new Color(1, 1, 1, Mathf.clamp01(ring));
    });
  },

  get Spark(): Sprite {
    return CasualArt.make("gd-spark", 32, 32, (p) => {
      const d = Math.min(Math.abs(p.x) + Math.abs(p.y) * 4, Math.abs(p.y) + Math.abs(p.x) * 4);
      return new Color(1, 1, 1, smooth(1, 0.1, d));
    });
  },

  /** Pixel debris square. */
  get Pixel(): Sprite { return CasualArt.make("gd-px", 8, 8, () => Color.white); },

  Space(): Sprite {
    return CasualArt.make("gd-space", 128, 256, (p) => {
      const t = (p.y + 2) / 4;
      let c = Color.lerp(Pal.hex(0x05030f), Pal.hex(0x120a2e), smooth(0, 1, t));
      // nebula
      const n1 = noise(p.x * 2.2 + 3, p.y * 1.6, 2), n2 = noise(p.x * 4.5, p.y * 3.3 + 7, 3);
      const neb = smooth(0.45, 0.9, n1 * 0.7 + n2 * 0.4);
      c = Color.lerp(c, Pal.hex(0x5a1a7a), neb * 0.45);
      c = Color.lerp(c, Pal.hex(0x1a4a8a), smooth(0.5, 0.95, noise(p.x * 1.7 + 11, p.y * 1.2 + 4, 5)) * 0.35);
      // distant stars
      const sx = Math.floor((p.x + 1) * 60), sy = Math.floor((p.y + 2) * 60);
      const h = hash(sx, sy, 9);
      if (h > 0.985) {
        const lx = (p.x + 1) * 60 - sx - 0.5, ly = (p.y + 2) * 60 - sy - 0.5;
        c = Color.lerp(c, Color.white, smooth(0.45, 0, Math.hypot(lx, ly)) * (h - 0.985) * 66);
      }
      // planet glow at the bottom
      const planet = new V2(p.x * 0.6, p.y + 3.6).magnitude - 1.75;
      c = Color.lerp(c, Pal.hex(0x2a8aff), smooth(0.25, 0, Math.abs(planet)) * 0.5);
      c = Color.lerp(c, Pal.hex(0x0a1430), fill(planet, 0.01) * 0.9);
      return c.withAlpha(1);
    });
  },

  /** CRT scanlines + rounded vignette (white/black alpha mask, drawn over everything). */
  Scanlines(): Sprite {
    return CasualArt.make("gd-scan", 8, 768, (p) => {
      const row = Math.floor(((p.y + 96) / 192) * 768);
      const dark = row % 3 === 0 ? 0.5 : 0;
      return new Color(0, 0, 0, dark);
    });
  },
  CrtVignette(): Sprite {
    return CasualArt.make("gd-crtvig", 64, 64, (p) => {
      const e = Math.pow(Math.pow(Math.abs(p.x), 6) + Math.pow(Math.abs(p.y), 6), 1 / 6);
      return new Color(0, 0, 0, smooth(0.75, 1.02, e) * 0.85);
    });
  },
};

function noise(x: number, y: number, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return Mathf.lerp(Mathf.lerp(hash(ix, iy, s), hash(ix + 1, iy, s), u), Mathf.lerp(hash(ix, iy + 1, s), hash(ix + 1, iy + 1, s), u), v);
}

/** Classic arch bunker mask: cols × rows booleans (row 0 = top). */
export function BunkerMask(cols: number, rows: number) {
  const m: boolean[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) / cols * 2 - 1, y = 1 - (r + 0.5) / rows * 2; // y up
      let on = true;
      // bevelled top corners
      if (y > 0.45 && Math.abs(x) > 1 - (y - 0.45) * 1.1 - 0.0) on = Math.abs(x) < 1.45 - y;
      // arch underneath
      if (y < -0.1 && new V2(x / 0.42, (y + 1) / 0.75).magnitude < 1) on = false;
      m.push(on);
    }
  return m;
}
