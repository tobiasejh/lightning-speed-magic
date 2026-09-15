import type { BlendConfig, BlendEdge } from "./types";

const STEPS = 48;

/** Brightness of the mask at t (0 = at the edge, 1 = end of the fade). */
const brightnessAt = (edge: BlendEdge, t: number) =>
  edge.level + (1 - edge.level) * Math.pow(Math.max(0, Math.min(1, t)), Math.max(0.2, edge.curve));

/**
 * Paints the edge-blend mask over an already drawn frame.
 * Multiply-style darkening so two overlapping projectors add back up to one.
 */
export function paintBlend(ctx: CanvasRenderingContext2D, w: number, h: number, b: BlendConfig) {
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  const strip = (edge: BlendEdge, side: "left" | "right" | "top" | "bottom") => {
    const span = (side === "left" || side === "right" ? w : h) * Math.max(0, edge.width);
    if (span <= 0) return;
    const step = span / STEPS;
    for (let i = 0; i < STEPS; i++) {
      const t = i / STEPS;
      const alpha = 1 - brightnessAt(edge, t);
      if (alpha <= 0.001) continue;
      ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(4)})`;
      const offset = i * step;
      if (side === "left") ctx.fillRect(offset, 0, step + 1, h);
      else if (side === "right") ctx.fillRect(w - offset - step, 0, step + 1, h);
      else if (side === "top") ctx.fillRect(0, offset, w, step + 1);
      else ctx.fillRect(0, h - offset - step, w, step + 1);
    }
  };
  strip(b.left, "left");
  strip(b.right, "right");
  strip(b.top, "top");
  strip(b.bottom, "bottom");
  ctx.restore();
}
