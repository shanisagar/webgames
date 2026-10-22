import { Art, Behaviour, Color, LineRenderer, Material, Time, V2, V3 } from "../../kit";

/**
 * TrailRenderer (kit gap: the kit has no trail). Records the owner's world position over time and draws it with a
 * LineRenderer: head = startColor, tail = endColor, points older than `time` drop off. Attach with
 * `go.addComponent(new TrailRenderer())`; settings are applied on the first LateUpdate.
 */
export class TrailRenderer extends Behaviour {
  time = 5;
  widthMultiplier = 1;
  startColor = Color.white;
  endColor = Color.white;
  sortingOrder = 0;
  minVertexDistance = 0.1;
  emitting = true;
  sharedMaterial: Material = Art.LineMat;
  private line: LineRenderer | null = null;
  private points: { p: V2; t: number }[] = [];

  clear() { this.points = []; }

  lateUpdate() {
    if (!this.line) this.line = Art.line(this.gameObject, "Trail", this.startColor, this.widthMultiplier, this.sortingOrder, false, true, this.sharedMaterial);
    const lr = this.line;
    lr.startColor = this.startColor;
    lr.endColor = this.endColor;
    lr.widthMultiplier = this.widthMultiplier;
    lr.sortingOrder = this.sortingOrder;
    const now = Time.time, head = this.gameObject.position.xy;
    while (this.points.length && now - this.points[0].t > this.time) this.points.shift();
    if (this.emitting) {
      const last = this.points[this.points.length - 1];
      if (!last || V2.distance(last.p, head) >= this.minVertexDistance) this.points.push({ p: head, t: now });
    }
    const n = this.points.length;
    if (n < 1) { lr.positionCount = 0; return; }
    const pts: V3[] = [head.toV3()];
    for (let i = n - 1; i >= 0; i--) pts.push(this.points[i].p.toV3());
    lr.positionCount = pts.length;
    lr.setPositions(pts);
  }
}
