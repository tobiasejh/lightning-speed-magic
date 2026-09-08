export type Pt = { x: number; y: number };

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

export const defaultCorners = (inset = 0.12): Pt[] => [
  { x: inset, y: inset },
  { x: 1 - inset, y: inset },
  { x: 1 - inset, y: 1 - inset },
  { x: inset, y: 1 - inset },
];
