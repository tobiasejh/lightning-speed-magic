/** Stage-only viewport transform. Coordinates in the project remain normalized 0..1. */
export type StageTransform = { scale: number; x: number; y: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Keep the viewport within the stage bounds and zoom between 100% and 400%. */
export const clampStageTransform = (
  transform: StageTransform,
  width: number,
  height: number,
): StageTransform => {
  const scale = clamp(transform.scale, 1, 4);
  return {
    scale,
    x: clamp(transform.x, width * (1 - scale), 0),
    y: clamp(transform.y, height * (1 - scale), 0),
  };
};

/** Zoom around a pointer/viewport anchor so the point under the anchor stays fixed. */
export const zoomStageTransformAt = (
  current: StageTransform,
  requestedScale: number,
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
): StageTransform => {
  const scale = clamp(requestedScale, 1, 4);
  const ratio = scale / current.scale;
  return clampStageTransform(
    {
      scale,
      x: anchorX - (anchorX - current.x) * ratio,
      y: anchorY - (anchorY - current.y) * ratio,
    },
    width,
    height,
  );
};

/** Pan by a requested offset while keeping at least the viewport covered. */
export const panStageTransform = (
  current: StageTransform,
  x: number,
  y: number,
  width: number,
  height: number,
): StageTransform => clampStageTransform({ ...current, x, y }, width, height);

/** Convert screen pixels back into normalized coordinates before editing a surface. */
export const stagePointFromClient = (
  clientX: number,
  clientY: number,
  rectLeft: number,
  rectTop: number,
  rectWidth: number,
  rectHeight: number,
  transform: StageTransform,
) => ({
  x: (clientX - rectLeft - transform.x) / transform.scale / rectWidth,
  y: (clientY - rectTop - transform.y) / transform.scale / rectHeight,
});
