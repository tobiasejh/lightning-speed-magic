import type { Pt } from "./warp";
import type { Surface } from "./types";

export type SnapResult = { point: Pt; snapped: boolean; target: Pt | null };

/** Candidate points (normalised) a dragged corner may snap to. */
export function snapCandidates(surfaces: Surface[], excludeId: string): Pt[] {
  const pts: Pt[] = [];
  for (const s of surfaces) {
    if (s.id === excludeId) continue;
    for (const c of s.corners) pts.push(c);
    // edge midpoints
    for (let i = 0; i < s.corners.length; i++) {
      const a = s.corners[i]!;
      const b = s.corners[(i + 1) % s.corners.length]!;
      pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }
  // stage corners and midpoints
  for (const x of [0, 0.5, 1])
    for (const y of [0, 0.5, 1]) if (x !== 0.5 || y !== 0.5) pts.push({ x, y });
  return pts;
}

export function snapPoint(
  p: Pt,
  candidates: Pt[],
  stage: { w: number; h: number },
  thresholdPx = 12,
): SnapResult {
  let best: Pt | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const dx = (c.x - p.x) * stage.w;
    const dy = (c.y - p.y) * stage.h;
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best && bestD <= thresholdPx) return { point: { ...best }, snapped: true, target: best };
  // axis snap to stage edges
  const out = { ...p };
  let snapped = false;
  for (const e of [0, 1]) {
    if (Math.abs(p.x - e) * stage.w <= thresholdPx) {
      out.x = e;
      snapped = true;
    }
    if (Math.abs(p.y - e) * stage.h <= thresholdPx) {
      out.y = e;
      snapped = true;
    }
  }
  return { point: out, snapped, target: snapped ? out : null };
}
