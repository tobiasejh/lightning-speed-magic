import { Ear, Link2, Speaker, Trash2 } from "lucide-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addPathNode,
  closestOnSegment,
  connectNodes,
  curveFromControl,
  emptyPath,
  moveNode,
  patchSegment,
  removeNode,
  removeSegment,
  segmentEnds,
  splitSegment,
  withDuration,
} from "@/lib/timeline";
import type { RoomConfig, SoundItem, SoundPath, Vec3 } from "@/lib/types";

type Props = {
  stage: { w: number; h: number };
  sounds: SoundItem[];
  selectedId: string | null;
  room: RoomConfig;
  paths: SoundPath[];
  activePathId: string | null;
  onSelect: (id: string) => void;
  onMoveSound: (id: string, pos: Vec3) => void;
  onMoveListener: (pos: Vec3) => void;
  onMoveSpeaker: (id: string, pos: Vec3) => void;
  onSavePath: (path: SoundPath) => void;
  onDeletePath: (id: string) => void;
  onSelectPath: (id: string | null) => void;
};

export function RoomView(p: Props) {
  const { w, h } = p.stage;
  const size = Math.min(w, h) * 0.9;
  const ox = (w - size) / 2;
  const oy = (h - size) / 2;
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [linkFromId, setLinkFromId] = useState<string | null>(null);
  const selectedSound = p.sounds.find((sound) => sound.id === p.selectedId) ?? null;
  const path = selectedSound
    ? (p.paths.find((item) => item.soundId === selectedSound.id) ?? null)
    : null;
  const selectedSegment = path?.segments.find((s) => s.id === selectedSegmentId) ?? null;

  const toPx = (v: Vec3) => ({
    left: ox + ((v.x + 1) / 2) * size,
    top: oy + ((v.y + 1) / 2) * size,
  });
  const toPoint = (clientX: number, clientY: number, rect: DOMRect): Vec3 => ({
    x: Math.max(-1, Math.min(1, ((clientX - rect.left - ox) / size) * 2 - 1)),
    y: Math.max(-1, Math.min(1, ((clientY - rect.top - oy) / size) * 2 - 1)),
    z: selectedSound?.position.z ?? 0,
  });
  const rootRect = (el: HTMLElement) =>
    (el.closest("[data-room-root]") ?? el).getBoundingClientRect();

  const save = (next: SoundPath) => {
    p.onSavePath(withDuration(next));
    p.onSelectPath(next.id);
  };

  const ensurePath = (): SoundPath | null => {
    if (!selectedSound) return null;
    return (
      path ?? emptyPath(`path${Date.now()}`, `${selectedSound.name} movement`, selectedSound.id)
    );
  };

  /** Click on empty room space: place a new automation point. */
  const placePoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    const base = ensurePath();
    if (!base) return;
    const position = toPoint(event.clientX, event.clientY, rootRect(event.currentTarget));
    save(addPathNode(base, position, true));
    setLinkFromId(null);
  };

  const dragNode = (nodeId: string) => (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!path) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      if (linkFromId && linkFromId !== nodeId) {
        save(connectNodes(path, linkFromId, nodeId));
        setLinkFromId(null);
      } else setLinkFromId(nodeId);
      return;
    }
    const target = event.currentTarget;
    const rect = rootRect(target as unknown as HTMLElement);
    target.setPointerCapture(event.pointerId);
    let latest = path;
    const move = (ev: PointerEvent) => {
      latest = moveNode(latest, nodeId, toPoint(ev.clientX, ev.clientY, rect));
      p.onSavePath(latest);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      p.onSavePath(withDuration(latest));
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const segmentPointerDown = (segmentId: string) => (event: ReactPointerEvent<SVGPathElement>) => {
    if (!path) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = rootRect(event.currentTarget as unknown as HTMLElement);
    const point = toPoint(event.clientX, event.clientY, rect);
    const segment = path.segments.find((s) => s.id === segmentId);
    if (!segment) return;
    if (event.altKey) {
      const { t } = closestOnSegment(path, segment, point);
      save(splitSegment(path, segmentId, t));
      return;
    }
    setSelectedSegmentId(segmentId);
    p.onSelectPath(path.id);
    if (!event.shiftKey) return;
    // shift + drag bends the line
    const ends = segmentEnds(path, segment);
    if (!ends) return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent) => {
      const dragged = toPoint(ev.clientX, ev.clientY, rect);
      // the curve passes through the dragged point at its midpoint
      const control = {
        x: 2 * dragged.x - (ends.a.x + ends.b.x) / 2,
        y: 2 * dragged.y - (ends.a.y + ends.b.y) / 2,
        z: dragged.z,
      };

      p.onSavePath(
        patchSegment(path, segmentId, {
          curve: Math.max(-2, Math.min(2, curveFromControl(ends.a, ends.b, control))),
        }),
      );
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const drag =
    (cb: (pos: { x: number; y: number }) => void) => (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget;
      const parent = rootRect(target);
      target.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => cb(toPoint(ev.clientX, ev.clientY, parent));
      const up = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
    };

  const metres = (v: Vec3) =>
    `${(Math.hypot(v.x - p.room.listener.x, v.y - p.room.listener.y) * (p.room.size / 2)).toFixed(1)} m`;

  return (
    <div className="absolute inset-0 select-none" data-room-root>
      <div
        onPointerDown={placePoint}
        className="absolute overflow-hidden rounded-lg border border-border/70 bg-card/30 touch-none"
        style={{
          left: ox,
          top: oy,
          width: size,
          height: size,
          backgroundImage:
            "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
          backgroundSize: `${size / 8}px ${size / 8}px`,
        }}
      >
        <span className="absolute left-2 top-1 text-[10px] uppercase text-muted-foreground">
          Front
        </span>
        <span className="absolute bottom-1 left-2 text-[10px] uppercase text-muted-foreground">
          Back · {p.room.size} m
        </span>
      </div>

      <div className="absolute left-3 top-3 z-50 max-w-[22rem] space-y-1 rounded-md border border-border bg-background/90 p-2 text-[11px] shadow-lg">
        <p className="font-semibold uppercase text-muted-foreground">
          {selectedSound ? `${selectedSound.name} automation` : "Select a sound"}
        </p>
        <p className="text-muted-foreground">
          Click to add a point · Ctrl+click two points to link · Shift+drag a line to curve ·
          Alt+click a line to split
        </p>
        {linkFromId && (
          <p className="flex items-center gap-1 text-primary">
            <Link2 className="size-3" /> Ctrl+click another point to connect
          </p>
        )}
        {selectedSegment && (
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-muted-foreground">Line</span>
            <Input
              type="number"
              min={0}
              step={50}
              className="h-7 w-24"
              value={Math.round(selectedSegment.durationMs)}
              onChange={(event) =>
                path &&
                p.onSavePath(
                  withDuration(
                    patchSegment(path, selectedSegment.id, {
                      durationMs: Math.max(0, Number(event.target.value) || 0),
                    }),
                  ),
                )
              }
            />
            <span className="text-muted-foreground">ms</span>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Delete automation line"
              onClick={() => {
                if (!path) return;
                p.onSavePath(removeSegment(path, selectedSegment.id));
                setSelectedSegmentId(null);
              }}
            >
              <Trash2 />
            </Button>
          </div>
        )}
        {path && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-muted-foreground tabular-nums">
              {path.nodes.length} points · {path.duration.toFixed(2)}s
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2"
              onClick={() => {
                p.onDeletePath(path.id);
                setSelectedSegmentId(null);
                setLinkFromId(null);
              }}
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      {path && (
        <svg className="absolute inset-0 size-full" style={{ pointerEvents: "none" }}>
          {path.segments.map((segment) => {
            const ends = segmentEnds(path, segment);
            if (!ends) return null;
            const a = toPx(ends.a);
            const b = toPx(ends.b);
            const c = toPx(ends.control);
            const d = `M ${a.left} ${a.top} Q ${c.left} ${c.top} ${b.left} ${b.top}`;
            return (
              <g key={segment.id} style={{ pointerEvents: "stroke" }}>
                <path
                  d={d}
                  stroke="transparent"
                  strokeWidth={14}
                  fill="none"
                  className="cursor-pointer"
                  onPointerDown={segmentPointerDown(segment.id)}
                />
                <path
                  d={d}
                  fill="none"
                  strokeWidth={selectedSegmentId === segment.id ? 4 : 2.5}
                  className={
                    selectedSegmentId === segment.id ? "stroke-foreground" : "stroke-primary"
                  }
                  style={{ pointerEvents: "none" }}
                />
              </g>
            );
          })}
          {path.nodes.map((node, index) => {
            const px = toPx(node.position);
            return (
              <g key={node.id} style={{ pointerEvents: "all" }}>
                <circle
                  cx={px.left}
                  cy={px.top}
                  r={7}
                  className={`cursor-grab ${linkFromId === node.id ? "fill-foreground" : "fill-primary"}`}
                  onPointerDown={dragNode(node.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    p.onSavePath(removeNode(path, node.id));
                  }}
                />
                <text
                  x={px.left}
                  y={px.top - 10}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9px]"
                  style={{ pointerEvents: "none" }}
                >
                  {index + 1}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {p.room.outputMode === "speakers" &&
        p.room.speakers.map((sp) => (
          <div
            key={sp.id}
            onPointerDown={
              p.room.layout === "custom"
                ? drag((pos) => p.onMoveSpeaker(sp.id, { ...sp.position, ...pos }))
                : undefined
            }
            className={`absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-muted-foreground ${p.room.layout === "custom" ? "cursor-grab touch-none" : ""}`}
            style={toPx(sp.position)}
            title={sp.name}
          >
            <Speaker className="size-5" />
            <span className="text-[10px]">{sp.name}</span>
          </div>
        ))}

      <div
        onPointerDown={drag((pos) => p.onMoveListener({ ...p.room.listener, ...pos }))}
        className="absolute z-20 grid size-9 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center rounded-full border-2 border-foreground bg-background/80"
        style={toPx(p.room.listener)}
        aria-label="Listener"
      >
        <Ear className="size-4" />
      </div>

      {p.sounds
        .filter((s) => s.kind !== "ambisonic")
        .map((s) => {
          const active = s.id === p.selectedId;
          const scale = 0.7 + ((s.position.z + 1) / 2) * 0.6;
          return (
            <div
              key={s.id}
              onPointerDown={(e) => {
                p.onSelect(s.id);
                drag((pos) => p.onMoveSound(s.id, { ...s.position, ...pos }))(e);
              }}
              className="absolute z-30 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none"
              style={toPx(s.position)}
            >
              <div
                className={`grid place-items-center rounded-full text-[11px] font-bold text-background shadow-lg ${active ? "ring-2 ring-foreground" : ""} ${s.playing ? "animate-pulse" : "opacity-70"}`}
                style={{ background: s.color, width: 32 * scale, height: 32 * scale }}
              >
                {s.name.slice(0, 2).toUpperCase()}
              </div>
              <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground">
                {s.name.length > 16 ? `${s.name.slice(0, 16)}…` : s.name} · {metres(s.position)}
              </span>
            </div>
          );
        })}
    </div>
  );
}
