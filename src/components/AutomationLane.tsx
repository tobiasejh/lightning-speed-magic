import { type PointerEvent as ReactPointerEvent } from "react";

import { moveNode, pathChain, patchSegment, sampleSegment, withDuration } from "@/lib/timeline";
import type { SoundPath } from "@/lib/types";

/** Sampled outline of one axis of a movement path, in lane pixels. */
export const axisOutline = (
  path: SoundPath,
  axis: "x" | "y",
  toX: (time: number) => number,
  toY: (value: number) => number,
) => {
  const points: string[] = [];
  let time = 0;
  for (const segment of path.segments) {
    const length = Math.max(0, segment.durationMs) / 1000;
    for (let i = 0; i <= 8; i++) {
      const sample = sampleSegment(path, segment, i / 8);
      if (!sample) continue;
      points.push(`${toX(time + (i / 8) * length)},${toY(sample[axis])}`);
    }
    time += length;
  }
  return points.join(" ");
};

type Props = {
  path: SoundPath;
  axis: "x" | "y";
  /** how many seconds the lane covers */
  span: number;
  width: number;
  height?: number;
  /** loudness overview of the linked sound, drawn behind the line */
  peaks?: number[] | undefined;
  onPatchPath: (path: SoundPath) => void;
};

export function AutomationLane({
  path,
  axis,
  span,
  width,
  height = 44,
  peaks,
  onPatchPath,
}: Props) {
  const length = Math.max(0.001, span);
  const toX = (time: number) => (Math.max(0, Math.min(length, time)) / length) * width;
  const toY = (value: number) => ((value + 1) / 2) * height;
  const fromY = (py: number) => Math.max(-1, Math.min(1, (py / height) * 2 - 1));
  const chain = pathChain(path);

  const dragHandle =
    (index: number, nodeId: string) => (event: ReactPointerEvent<SVGCircleElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      const svg = target.ownerSVGElement ?? target;
      const rect = svg.getBoundingClientRect();
      target.setPointerCapture(event.pointerId);
      // snapshot: every move recomputes from this, so drags never accumulate
      const base = path;
      const baseChain = pathChain(base);
      const previous = base.segments[index - 1];
      const next = base.segments[index];
      const startTime = baseChain[index]?.time ?? 0;
      const prevTime = baseChain[index - 1]?.time ?? 0;
      const nextTime = baseChain[index + 1]?.time;
      const startX = rect.left + toX(startTime);
      const startY =
        rect.top + toY(base.nodes.find((item) => item.id === nodeId)?.position[axis] ?? 0);
      let latest = base;

      const move = (ev: PointerEvent) => {
        const node = base.nodes.find((item) => item.id === nodeId);
        if (!node) return;
        latest = moveNode(base, nodeId, {
          ...node.position,
          [axis]: fromY(ev.clientY - startY + toY(node.position[axis])),
        });
        // horizontal drag retimes the two lines around this point, in real seconds
        if (previous) {
          const raw = ((ev.clientX - startX) / width) * length + startTime;
          const upper = nextTime !== undefined ? nextTime : length;
          const wanted = Math.max(prevTime, Math.min(upper, raw));
          latest = patchSegment(latest, previous.id, {
            durationMs: Math.max(0, Math.round((wanted - prevTime) * 1000)),
          });
          if (next && nextTime !== undefined)
            latest = patchSegment(latest, next.id, {
              durationMs: Math.max(0, Math.round((nextTime - wanted) * 1000)),
            });
        }
        onPatchPath(withDuration(latest));
      };
      const up = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        onPatchPath(withDuration(latest));
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
    };

  return (
    <div className="space-y-1">
      <span className="text-[10px] uppercase text-muted-foreground">
        {axis === "x" ? "Position X (left ↔ right)" : "Position Y (front ↔ back)"}
      </span>
      <svg
        width={width}
        height={height}
        className="rounded border border-border bg-muted/20"
        style={{ touchAction: "none" }}
      >
        {peaks?.length
          ? peaks.map((peak, index) => {
              const x = (index / peaks.length) * width;
              const half = Math.max(0.5, (peak * height) / 2);
              return (
                <line
                  key={index}
                  x1={x}
                  x2={x}
                  y1={height / 2 - half}
                  y2={height / 2 + half}
                  className="stroke-muted-foreground/40"
                  strokeWidth={Math.max(1, width / peaks.length)}
                />
              );
            })
          : null}
        <line x1={0} x2={width} y1={height / 2} y2={height / 2} className="stroke-border" />
        <polyline
          points={axisOutline(path, axis, toX, toY)}
          className="fill-none stroke-primary"
          strokeWidth={2}
        />
        {chain.map((entry, index) => {
          const node = path.nodes.find((item) => item.id === entry.nodeId);
          if (!node) return null;
          return (
            <circle
              key={`${entry.nodeId}-${index}`}
              cx={toX(entry.time)}
              cy={toY(node.position[axis])}
              r={height > 90 ? 8 : 5}
              className="cursor-grab fill-foreground"
              onPointerDown={dragHandle(index, entry.nodeId)}
            />
          );
        })}
      </svg>
    </div>
  );
}
