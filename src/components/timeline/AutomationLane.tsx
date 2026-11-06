import { useState, type PointerEvent as ReactPointerEvent } from "react";

import {
  axisOutline,
  insertPathPoint,
  moveNode,
  pathChain,
  patchSegment,
  removePathPoint,
  withDuration,
} from "@/lib/timeline";
import type { SoundPath } from "@/lib/types";

type Props = {
  path: SoundPath;
  axis: "x" | "y";
  /** how many seconds the lane covers */
  span: number;
  width: number;
  height?: number;
  /** loudness overview of the linked sound, drawn behind the line */
  peaks?: number[] | undefined;
  /** clicking an empty spot adds a point there, right-clicking a point deletes it */
  editPoints?: boolean;
  onPatchPath: (path: SoundPath) => void;
};

export function AutomationLane({
  path,
  axis,
  span,
  width,
  height = 44,
  peaks,
  editPoints = false,
  onPatchPath,
}: Props) {
  // the side and time under the pointer: where a click would add a point (ghost), or where
  // the point being dragged is now
  const [readout, setReadout] = useState<{ time: number; value: number; ghost: boolean } | null>(
    null,
  );
  const length = Math.max(0.001, span);
  const toX = (time: number) => (Math.max(0, Math.min(length, time)) / length) * width;
  const toY = (value: number) => ((value + 1) / 2) * height;
  const fromY = (py: number) => Math.max(-1, Math.min(1, (py / height) * 2 - 1));
  const fromX = (px: number) => Math.max(0, Math.min(length, (px / width) * length));
  const chain = pathChain(path);
  const radius = height > 90 ? 8 : 5;
  // -1 is the top of the lane: left on the x axis, front on the y axis, as in the room view
  const [negative, positive] = axis === "x" ? ["Left", "Right"] : ["Front", "Back"];
  const sideOf = (value: number) =>
    Math.abs(value) < 0.05
      ? { label: "Center", tone: "fill-foreground" }
      : value < 0
        ? { label: `${negative} ${Math.round(-value * 100)}%`, tone: "fill-sky-400" }
        : { label: `${positive} ${Math.round(value * 100)}%`, tone: "fill-amber-400" };

  const dragHandle =
    (index: number, nodeId: string) => (event: ReactPointerEvent<SVGCircleElement>) => {
      event.stopPropagation();
      // a right-click deletes the point instead, see onContextMenu
      if (event.button !== 0) return;
      event.preventDefault();
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
        const value = fromY(ev.clientY - startY + toY(node.position[axis]));
        latest = moveNode(base, nodeId, { ...node.position, [axis]: value });
        let time = startTime;
        // horizontal drag retimes the two lines around this point, in real seconds
        if (previous) {
          const raw = ((ev.clientX - startX) / width) * length + startTime;
          const upper = nextTime !== undefined ? nextTime : length;
          const wanted = Math.max(prevTime, Math.min(upper, raw));
          time = wanted;
          latest = patchSegment(latest, previous.id, {
            durationMs: Math.max(0, Math.round((wanted - prevTime) * 1000)),
          });
          if (next && nextTime !== undefined)
            latest = patchSegment(latest, next.id, {
              durationMs: Math.max(0, Math.round((nextTime - wanted) * 1000)),
            });
        }
        if (editPoints) setReadout({ time, value, ghost: false });
        onPatchPath(withDuration(latest));
      };
      const up = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        setReadout(null);
        onPatchPath(withDuration(latest));
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
    };

  // points stop their own pointerdown, so this only fires on an empty spot of the lane
  const addPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const time = ((event.clientX - rect.left) / width) * length;
    onPatchPath(insertPathPoint(path, axis, time, fromY(event.clientY - rect.top)));
    setReadout(null);
  };
  /** Shows where a click would add a point, unless the pointer is over an existing one. */
  const trackGhost = (event: ReactPointerEvent<SVGSVGElement>) => {
    // while a point is dragged, its own handler keeps the readout up to date
    if (event.buttons) return;
    if (event.target instanceof SVGCircleElement) {
      setReadout(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setReadout({
      time: fromX(event.clientX - rect.left),
      value: fromY(event.clientY - rect.top),
      ghost: true,
    });
  };
  const readoutSide = readout && sideOf(readout.value);
  const readoutText =
    readout && readoutSide && `${readoutSide.label} · ${readout.time.toFixed(1)}s`;
  const readoutX = readout ? toX(readout.time) : 0;
  const readoutY = readout ? toY(readout.value) : 0;
  const labelWidth = (readoutText?.length ?? 0) * 6.5 + 14;
  // the label sits up and to the right of the point, flipped when that would leave the lane
  const labelX =
    readoutX + radius + 6 + labelWidth > width
      ? readoutX - radius - 6 - labelWidth
      : readoutX + radius + 6;
  const labelY = readoutY - 28 < 0 ? readoutY + radius + 4 : readoutY - 28;

  return (
    <div className="space-y-1">
      <span className="text-[10px] uppercase text-muted-foreground">
        {axis === "x" ? "Position X (left ↔ right)" : "Position Y (front ↔ back)"}
      </span>
      <svg
        width={width}
        height={height}
        className={`rounded border border-border bg-muted/20 ${editPoints ? "cursor-crosshair" : ""}`}
        style={{ touchAction: "none" }}
        onPointerDown={editPoints ? addPoint : undefined}
        onPointerMove={editPoints ? trackGhost : undefined}
        onPointerLeave={editPoints ? () => setReadout((r) => (r?.ghost ? null : r)) : undefined}
      >
        {editPoints && (
          <>
            {/* one color per side of the room, so a point's side reads at a glance */}
            <rect width={width} height={height / 2} className="fill-sky-500/[0.07]" />
            <rect
              y={height / 2}
              width={width}
              height={height / 2}
              className="fill-amber-500/[0.07]"
            />
            {(["start", "end"] as const).map((anchor) => (
              <g
                key={anchor}
                className="pointer-events-none select-none text-[10px] font-semibold uppercase tracking-wider"
                textAnchor={anchor}
              >
                <text x={anchor === "start" ? 8 : width - 8} y={15} className="fill-sky-400/80">
                  {axis === "x" ? "←" : "↑"} {negative}
                </text>
                <text
                  x={anchor === "start" ? 8 : width - 8}
                  y={height - 7}
                  className="fill-amber-400/80"
                >
                  {axis === "x" ? "→" : "↓"} {positive}
                </text>
              </g>
            ))}
          </>
        )}
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
              r={radius}
              className={`cursor-grab ${editPoints ? `${sideOf(node.position[axis]).tone} stroke-background` : "fill-foreground"}`}
              strokeWidth={editPoints ? 2 : undefined}
              onPointerDown={dragHandle(index, entry.nodeId)}
              onContextMenu={
                editPoints
                  ? (event) => {
                      event.preventDefault();
                      onPatchPath(removePathPoint(path, entry.nodeId));
                    }
                  : undefined
              }
            >
              {editPoints && <title>Drag to move · right-click to delete</title>}
            </circle>
          );
        })}
        {readout && readoutSide && (
          <g className="pointer-events-none select-none">
            {readout.ghost && (
              <circle
                cx={readoutX}
                cy={readoutY}
                r={radius}
                className={`${readoutSide.tone} stroke-foreground/70`}
                fillOpacity={0.35}
                strokeDasharray="3 2"
              />
            )}
            <rect
              x={labelX}
              y={labelY}
              width={labelWidth}
              height={22}
              rx={5}
              className="fill-background/90 stroke-border"
            />
            <text
              x={labelX + 7}
              y={labelY + 15}
              className={`${readoutSide.tone} text-[11px] font-semibold tabular-nums`}
            >
              {readoutText}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
