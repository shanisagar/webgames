import { Mathf, V2 } from "../../kit";

/** 2D geometry used by the loop-closing and capture logic (Geo.cs). */
const scratchIndices: number[] = [];

export const Geo = {
  Cross(a: V2, b: V2) { return a.x * b.y - a.y * b.x; },

  /** Intersection of segments p1-p2 and q1-q2 (null when they miss). */
  SegmentIntersect(p1: V2, p2: V2, q1: V2, q2: V2): V2 | null {
    const r = p2.sub(p1), s = q2.sub(q1);
    const d = Geo.Cross(r, s);
    if (Math.abs(d) < 1e-8) return null;
    const qp = q1.sub(p1);
    const t = Geo.Cross(qp, s) / d;
    const u = Geo.Cross(qp, r) / d;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return p1.add(r.mul(t));
  },

  ClosestOnSegment(p: V2, a: V2, b: V2) {
    const ab = b.sub(a);
    const len2 = ab.sqrMagnitude;
    if (len2 < 1e-8) return a;
    const t = Mathf.clamp01(V2.dot(p.sub(a), ab) / len2);
    return a.add(ab.mul(t));
  },

  /** Positive for counter-clockwise polygons. */
  SignedArea(poly: V2[]) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += Geo.Cross(poly[j], poly[i]);
    return a * 0.5;
  },

  /** Even-odd point-in-polygon test. */
  Contains(poly: V2[], p: V2) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  },

  /** Area-weighted centroid; falls back to the vertex average for degenerate shapes. */
  Centroid(poly: V2[]) {
    let area = 0, cx = 0, cy = 0, ax = 0, ay = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const cr = Geo.Cross(poly[j], poly[i]);
      area += cr;
      cx += (poly[j].x + poly[i].x) * cr;
      cy += (poly[j].y + poly[i].y) * cr;
      ax += poly[i].x;
      ay += poly[i].y;
    }
    if (Math.abs(area) < 1e-5) return poly.length > 0 ? new V2(ax / poly.length, ay / poly.length) : V2.zero;
    return new V2(cx / (3 * area), cy / (3 * area));
  },

  Bounds(poly: V2[]): [V2, V2] {
    let minX = Number.MAX_VALUE, minY = Number.MAX_VALUE, maxX = -Number.MAX_VALUE, maxY = -Number.MAX_VALUE;
    for (const p of poly) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    return [new V2(minX, minY), new V2(maxX, maxY)];
  },

  /** Copies src into dst, dropping points closer than minDist. */
  Simplify(src: V2[], dst: V2[], minDist: number) {
    dst.length = 0;
    const min2 = minDist * minDist;
    for (const p of src) if (dst.length === 0 || p.sub(dst[dst.length - 1]).sqrMagnitude >= min2) dst.push(p);
    if (dst.length > 3 && dst[0].sub(dst[dst.length - 1]).sqrMagnitude < min2) dst.pop();
  },

  /** Ear-clipping triangulation of a simple polygon (either winding). */
  Triangulate(poly: V2[], tris: number[]) {
    tris.length = 0;
    const n = poly.length;
    if (n < 3) return false;

    const idx = scratchIndices;
    idx.length = 0;
    const ccw = Geo.SignedArea(poly) > 0;
    for (let i = 0; i < n; i++) idx.push(ccw ? i : n - 1 - i);

    let guard = n * n + 16;
    while (idx.length > 3 && guard-- > 0) {
      let clipped = false;
      const count = idx.length;
      for (let i = 0; i < count; i++) {
        const a = idx[(i + count - 1) % count], b = idx[i], c = idx[(i + 1) % count];
        const A = poly[a], B = poly[b], C = poly[c];
        if (Geo.Cross(B.sub(A), C.sub(B)) <= 1e-7) continue; // reflex or flat corner

        let blocked = false;
        for (let j = 0; j < count; j++) {
          const k = idx[j];
          if (k === a || k === b || k === c) continue;
          if (inTriangle(poly[k], A, B, C)) { blocked = true; break; }
        }
        if (blocked) continue;

        tris.push(a, b, c);
        idx.splice(i, 1);
        clipped = true;
        break;
      }

      if (!clipped) {
        // Only flat/degenerate corners left: drop the flattest one and keep going.
        let flattest = -1, best = Number.MAX_VALUE;
        for (let i = 0; i < count; i++) {
          const A = poly[idx[(i + count - 1) % count]], B = poly[idx[i]], C = poly[idx[(i + 1) % count]];
          const cr = Math.abs(Geo.Cross(B.sub(A), C.sub(B)));
          if (cr < best) { best = cr; flattest = i; }
        }
        if (flattest < 0 || best > 1e-3) break;
        idx.splice(flattest, 1);
      }
    }

    if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
    return tris.length >= 3;
  },
};

function inTriangle(p: V2, a: V2, b: V2, c: V2) {
  return Geo.Cross(b.sub(a), p.sub(a)) >= 0 && Geo.Cross(c.sub(b), p.sub(b)) >= 0 && Geo.Cross(a.sub(c), p.sub(c)) >= 0;
}
