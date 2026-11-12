import type { Surface } from "@/lib/types";
import { outlineStagePoints } from "@/lib/warp";

type Props = {
  surfaces: Surface[];
  /** ids of the surfaces with movement in front of them */
  activeIds: string[];
  stage: { w: number; h: number };
};

/** Marks the surfaces the camera sees movement on. It shows the detection and changes nothing. */
export function MotionHighlights({ surfaces, activeIds, stage }: Props) {
  const active = surfaces.filter((surface) => activeIds.includes(surface.id));
  if (!active.length) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 z-30 size-full">
      {active.map((surface) => {
        const points = outlineStagePoints(surface.corners, surface.outline);
        const top = points.reduce((a, b) => (b.y < a.y ? b : a));
        return (
          <g key={surface.id}>
            <polygon
              points={points.map((p) => `${p.x * stage.w},${p.y * stage.h}`).join(" ")}
              className="fill-chart-2/20 stroke-chart-2"
              strokeWidth={3}
            />
            <text
              x={top.x * stage.w + 8}
              y={top.y * stage.h + 18}
              className="fill-chart-2 text-xs font-semibold"
            >
              Movement
            </text>
          </g>
        );
      })}
    </svg>
  );
}
