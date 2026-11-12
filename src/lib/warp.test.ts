import { describe, expect, it } from "vitest";

import { outlineStagePoints, pointInPolygon, quadToUnit, stageToUv, type Pt } from "./warp";

// a camera looking at a wall at an angle: no two sides parallel
const perspective: Pt[] = [
  { x: 0.17, y: 0.17 },
  { x: 0.84, y: 0.12 },
  { x: 0.89, y: 0.85 },
  { x: 0.14, y: 0.81 },
];

/** Where the two diagonals of a quad cross. */
const diagonalsCross = ([a, b, c, d]: Pt[]): Pt => {
  const r = { x: c!.x - a!.x, y: c!.y - a!.y };
  const s = { x: d!.x - b!.x, y: d!.y - b!.y };
  const t = ((b!.x - a!.x) * s.y - (b!.y - a!.y) * s.x) / (r.x * s.y - r.y * s.x);
  return { x: a!.x + t * r.x, y: a!.y + t * r.y };
};

describe("quadToUnit", () => {
  it("maps the four corners onto the corners of the unit square", () => {
    const unit = quadToUnit(perspective)!;
    const expected = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    perspective.forEach((corner, i) => {
      expect(unit(corner).x).toBeCloseTo(expected[i]!.x, 9);
      expect(unit(corner).y).toBeCloseTo(expected[i]!.y, 9);
    });
  });

  it("maps where the diagonals cross onto the centre, as a perspective view must", () => {
    const centre = quadToUnit(perspective)!(diagonalsCross(perspective));
    expect(centre.x).toBeCloseTo(0.5, 9);
    expect(centre.y).toBeCloseTo(0.5, 9);
  });

  it("keeps points outside the quad outside, so they can be told apart", () => {
    const left = quadToUnit(perspective)!({ x: 0.02, y: 0.5 });
    expect(left.x).toBeLessThan(0);
  });

  it("gives no mapping for a quad with no area", () => {
    const flat = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
      { x: 0.25, y: 0.25 },
    ];
    expect(quadToUnit(flat)).toBeNull();
  });
});

describe("stageToUv", () => {
  it("still clamps, as the surface editor relies on", () => {
    expect(stageToUv(perspective, { x: 0.02, y: 0.5 }).u).toBe(0);
  });
});

describe("pointInPolygon with a surface outline", () => {
  const corners: Pt[] = [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.1 },
    { x: 0.5, y: 0.5 },
    { x: 0.1, y: 0.5 },
  ];
  // an L shape: the top-right quarter is cut away
  const outline = [
    { u: 0, v: 0, c: 0 },
    { u: 0.5, v: 0 },
    { u: 0.5, v: 0.5 },
    { u: 1, v: 0.5 },
    { u: 1, v: 1, c: 2 },
    { u: 0, v: 1, c: 3 },
  ];
  const polygon = outlineStagePoints(corners, outline);

  it("hits the parts of the shape that are there", () => {
    expect(pointInPolygon({ x: 0.2, y: 0.2 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 0.4, y: 0.4 }, polygon)).toBe(true);
  });

  it("misses the cut-away corner, though it lies inside the four warp corners", () => {
    expect(pointInPolygon({ x: 0.4, y: 0.2 }, corners)).toBe(true);
    expect(pointInPolygon({ x: 0.4, y: 0.2 }, polygon)).toBe(false);
  });
});
