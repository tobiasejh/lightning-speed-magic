import type { Vec3 } from "./types";

/** Real spherical harmonics, ACN ordering, SN3D normalisation, up to order 3. */
export function shCoefficients(dir: Vec3): number[] {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  // ambix axes: x forward, y left, z up. Our room: x right, y down(screen)/back, z up.
  const x = -dir.y / len; // forward = towards top of screen (negative y)
  const y = -dir.x / len; // left = negative screen x
  const z = dir.z / len;
  const s3 = Math.sqrt(3);
  return [
    1,
    y,
    z,
    x,
    s3 * x * y,
    s3 * y * z,
    (3 * z * z - 1) / 2,
    s3 * x * z,
    (s3 / 2) * (x * x - y * y),
    Math.sqrt(5 / 8) * y * (3 * x * x - y * y),
    Math.sqrt(15) * x * y * z,
    Math.sqrt(3 / 8) * y * (5 * z * z - 1),
    (z * (5 * z * z - 3)) / 2,
    Math.sqrt(3 / 8) * x * (5 * z * z - 1),
    (Math.sqrt(15) / 2) * z * (x * x - y * y),
    Math.sqrt(5 / 8) * x * (x * x - 3 * y * y),
  ];
}
