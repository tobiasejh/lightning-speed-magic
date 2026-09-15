export type Pt = { x: number; y: number };

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export const clampPoint = (point: Pt): Pt => ({
  x: clamp01(Number.isFinite(point.x) ? point.x : 0),
  y: clamp01(Number.isFinite(point.y) ? point.y : 0),
});

export const clampCorners = (corners: Pt[]): Pt[] => corners.map(clampPoint);

/** Solve A·x = b for an n×n system with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    }
    if (Math.abs(M[piv]![col]!) < 1e-10) return null;
    const tmp = M[col]!;
    M[col] = M[piv]!;
    M[piv] = tmp;
    const pivotRow = M[col]!;
    const pivotVal = pivotRow[col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const row = M[r]!;
      const f = row[col]! / pivotVal;
      for (let c = col; c <= n; c++) {
        row[c] = row[c]! - f * pivotRow[c]!;
      }
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}

/**
 * CSS matrix3d that maps the rectangle (0,0)-(w,h) onto four destination
 * points (top-left, top-right, bottom-right, bottom-left).
 */
export function quadMatrix(w: number, h: number, dst: Pt[]): string {
  const identity = "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)";
  if (dst.length < 4) return identity;
  const src: Pt[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const s = src[i]!;
    const d = dst[i]!;
    A.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y]);
    b.push(d.x);
    A.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y]);
    b.push(d.y);
  }
  const s = solve(A, b);
  if (!s) return identity;
  const [a, b1, c, d, e, f, g, hh] = s as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const m: number[] = [a, d, 0, g, b1, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1];
  if (m.some((n) => !Number.isFinite(n))) return identity;
  return `matrix3d(${m.map((n) => (Math.abs(n) < 1e-8 ? 0 : Number(n.toFixed(6)))).join(",")})`;
}

/**
 * Rebuilds the quad as an upright rectangle of the given pixel aspect ratio,
 * anchored on the corner opposite the one being dragged.
 * Corner order is top-left, top-right, bottom-right, bottom-left.
 */
export function lockRectAspect(
  corners: Pt[],
  index: number,
  aspect: number,
  stage: { w: number; h: number },
): Pt[] {
  const fixed = corners[(index + 2) % 4];
  const moved = corners[index];
  if (!fixed || !moved || !Number.isFinite(aspect) || aspect <= 0) return corners;
  const sx = stage.w || 1;
  const sy = stage.h || 1;
  const dx = (moved.x - fixed.x) * sx;
  const dy = (moved.y - fixed.y) * sy;
  const width = Math.max(24, Math.abs(dx), Math.abs(dy) * aspect);
  const height = width / aspect;
  const x2 = fixed.x + ((dx < 0 ? -width : width) / sx || 0);
  const y2 = fixed.y + ((dy < 0 ? -height : height) / sy || 0);
  const left = clamp01(Math.min(fixed.x, x2));
  const right = clamp01(Math.max(fixed.x, x2));
  const top = clamp01(Math.min(fixed.y, y2));
  const bottom = clamp01(Math.max(fixed.y, y2));
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

export const defaultCorners = (inset = 0.12): Pt[] => [
  { x: inset, y: inset },
  { x: 1 - inset, y: inset },
  { x: 1 - inset, y: 1 - inset },
  { x: inset, y: 1 - inset },
];
