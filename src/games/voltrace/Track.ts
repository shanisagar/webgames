import { Color, Mathf, Mesh, Rect, SysRandom, V2, V3 } from "../../kit";

/**
 * A procedurally generated closed circuit: a Catmull-Rom spline through jittered control points, resampled at
 * one-unit spacing, validated so it never overlaps itself. Provides tangents, normals, signed curvature and
 * fast nearest-sample lookups for physics and AI.
 */
export class Track {
  static readonly Width = 6.5;
  static readonly Spacing = 1;

  readonly Center: V2[] = [];
  readonly Tangent: V2[] = [];
  readonly Normal: V2[] = [];
  readonly Curvature: number[] = [];
  readonly BoostPads: number[] = [];
  get Count() { return this.Center.length; }
  Bounds = new Rect();

  static Generate(seed: number, difficulty: number) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const t = new Track();
      if (t.TryBuild(new SysRandom(seed * 31 + attempt), difficulty)) return t;
    }
    const fallback = new Track();
    fallback.TryBuild(new SysRandom(1), 0, true);
    return fallback;
  }

  private TryBuild(rng: SysRandom, difficulty: number, force = false) {
    const n = Mathf.clamp(8 + difficulty, 8, 16);
    const radius = 34 + difficulty * 2.5;
    const jitter = Mathf.lerp(0.25, 0.45, difficulty / 8);
    const control: V2[] = [];
    for (let i = 0; i < n; i++) {
      const a = ((i + (rng.nextDouble() - 0.5) * 0.6) / n) * Math.PI * 2;
      let r = radius * (1 - jitter + rng.nextDouble() * jitter * 1.6);
      if (force) r = radius;
      control.push(new V2(Math.cos(a) * r * 1.35, Math.sin(a) * r));
    }

    // Dense spline samples, then uniform resampling.
    const dense: V2[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = control[(i - 1 + n) % n], p1 = control[i], p2 = control[(i + 1) % n], p3 = control[(i + 2) % n];
      for (let k = 0; k < 24; k++) dense.push(Track.CatmullRom(p0, p1, p2, p3, k / 24));
    }
    const Center = this.Center, Spacing = Track.Spacing;
    Center.length = 0;
    Center.push(dense[0]);
    let carry = 0;
    for (let i = 1; i <= dense.length; i++) {
      let a = dense[i - 1];
      const b = dense[i % dense.length];
      let seg = b.sub(a).magnitude;
      while (carry + seg >= Spacing) {
        const t = (Spacing - carry) / seg;
        a = V2.lerp(a, b, t);
        seg = b.sub(a).magnitude;
        carry = 0;
        Center.push(a);
      }
      carry += seg;
    }
    if (Center[Center.length - 1].sub(Center[0]).magnitude < Spacing * 0.5) Center.pop();

    const m = Center.length;
    if (!force) {
      // Reject tracks that pass too close to themselves.
      const min = Track.Width + 3;
      for (let i = 0; i < m; i += 2)
        for (let j = i + 25; j < m; j += 2) {
          if (m - j + i < 25) continue;
          if (Center[i].sub(Center[j]).sqrMagnitude < min * min) return false;
        }
    }

    this.Tangent.length = 0;
    this.Normal.length = 0;
    this.Curvature.length = 0;
    for (let i = 0; i < m; i++) {
      const t = Center[(i + 1) % m].sub(Center[(i - 1 + m) % m]).normalized;
      this.Tangent.push(t);
      this.Normal.push(new V2(-t.y, t.x));
    }
    for (let i = 0; i < m; i++) {
      const a = this.Tangent[(i - 2 + m) % m], b = this.Tangent[(i + 2) % m];
      const angle = V2.signedAngle(a, b) * Mathf.Deg2Rad;
      this.Curvature.push(angle / (4 * Spacing));
    }

    // Boost pads on the calmest stretches, spread around the lap.
    this.BoostPads.length = 0;
    const pads = 3;
    for (let p = 0; p < pads; p++) {
      const from = Math.trunc(((p + 0.2) * m) / pads), to = Math.trunc(((p + 0.8) * m) / pads);
      let best = from;
      let bestK = Number.MAX_VALUE;
      for (let i = from; i < to; i++) {
        let k = 0;
        for (let d = 0; d < 12; d++) k += Math.abs(this.Curvature[(i + d) % m]);
        if (k < bestK) { bestK = k; best = i; }
      }
      this.BoostPads.push(best);
    }

    let lo = Center[0], hi = Center[0];
    for (const c of Center) { lo = V2.min(lo, c); hi = V2.max(hi, c); }
    this.Bounds = Rect.minMaxRect(lo.x, lo.y, hi.x, hi.y);
    return true;
  }

  private static CatmullRom(p0: V2, p1: V2, p2: V2, p3: V2, t: number) {
    const t2 = t * t, t3 = t2 * t;
    return p1.mul(2)
      .add(p0.neg().add(p2).mul(t))
      .add(p0.mul(2).sub(p1.mul(5)).add(p2.mul(4)).sub(p3).mul(t2))
      .add(p0.neg().add(p1.mul(3)).sub(p2.mul(3)).add(p3).mul(t3))
      .mul(0.5);
  }

  Wrap(i: number) { return ((i % this.Count) + this.Count) % this.Count; }

  /** Nearest sample to `p`, searching a window around a previous index. */
  Nearest(p: V2, hint: number, back = 8, ahead = 20) {
    let best = hint;
    let bestD = Number.MAX_VALUE;
    for (let d = -back; d <= ahead; d++) {
      const i = this.Wrap(hint + d);
      const dist = this.Center[i].sub(p).sqrMagnitude;
      if (dist < bestD) { bestD = dist; best = i; }
    }
    return best;
  }

  NearestGlobal(p: V2) {
    let best = 0;
    let bestD = Number.MAX_VALUE;
    for (let i = 0; i < this.Count; i++) {
      const d = this.Center[i].sub(p).sqrMagnitude;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  Lateral(p: V2, i: number) { return V2.dot(p.sub(this.Center[i]), this.Normal[i]); }

  BuildRoadMesh(edge: Color, middle: Color) {
    const m = this.Count;
    const verts: V3[] = new Array(m * 3);
    const cols: Color[] = new Array(m * 3);
    const tris: number[] = new Array(m * 12);
    for (let i = 0; i < m; i++) {
      const c = this.Center[i], n = this.Normal[i].mul(Track.Width * 0.5);
      verts[i * 3] = c.sub(n).toV3();
      verts[i * 3 + 1] = c.toV3();
      verts[i * 3 + 2] = c.add(n).toV3();
      cols[i * 3] = edge;
      cols[i * 3 + 1] = middle;
      cols[i * 3 + 2] = edge;
      const a = i * 3, b = ((i + 1) % m) * 3, t = i * 12;
      tris[t] = a; tris[t + 1] = b; tris[t + 2] = a + 1;
      tris[t + 3] = a + 1; tris[t + 4] = b; tris[t + 5] = b + 1;
      tris[t + 6] = a + 1; tris[t + 7] = b + 1; tris[t + 8] = a + 2;
      tris[t + 9] = a + 2; tris[t + 10] = b + 1; tris[t + 11] = b + 2;
    }
    const mesh = new Mesh();
    mesh.name = "Road";
    mesh.vertices = verts;
    mesh.colors = cols;
    mesh.triangles = tris;
    mesh.markDirty();
    return mesh;
  }

  EdgePoints(side: number) {
    const pts: V3[] = new Array(this.Count);
    for (let i = 0; i < this.Count; i++) pts[i] = this.Center[i].add(this.Normal[i].mul(Track.Width * 0.5 * side)).toV3();
    return pts;
  }
}
