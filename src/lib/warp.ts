export type Pt = { x: number; y: number };

/** Solve A·x = b for an n×n system with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M: number[][] = A.map((row, i) => [...row, b[i] as number]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      const rowR = M[r] as number[];
      const rowP = M[piv] as number[];
      if (Math.abs(rowR[col] as number) > Math.abs(rowP[col] as number)) piv = r;
    }
    if (Math.abs((M[piv] as number[])[col] as number) < 1e-10) return null;
    const tmp = M[col] as number[];
    M[col] = M[piv] as number[];
    M[piv] = tmp;
    const pivotRow = M[col] as number[];
    const pivotVal = pivotRow[col] as number;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const row = M[r] as number[];
      const f = (row[col] as number) / pivotVal;
      for (let c = col; c <= n; c++) {
        row[c] = (row[c] as number) - f * (pivotRow[c] as number);
      }
    }
  }
  return M.map((row, i) => (row[n] as number) / (row[i] as number));
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
    const s = src[i] as Pt;
    const d = dst[i] as Pt;
    A.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y]);
    b.push(d.x);
    A.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y]);
    b.push(d.y);
  }
  const s = solve(A, b);
  if (!s) return identity;
  const [a, b1, c, d, e, f, g, hh] = s as number[];
  const m = [a, d, 0, g, b1, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1] as number[];
  if (m.some((n) => !Number.isFinite(n))) return identity;
  return `matrix3d(${m.map((n) => (Math.abs(n) < 1e-8 ? 0 : Number(n.toFixed(6)))).join(",")})`;
}

export const defaultCorners = (inset = 0.12): Pt[] => [
  { x: inset, y: inset },
  { x: 1 - inset, y: inset },
  { x: 1 - inset, y: 1 - inset },
  { x: inset, y: 1 - inset },
];
