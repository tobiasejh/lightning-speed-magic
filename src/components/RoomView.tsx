import { Ear, Speaker } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { RoomConfig, SoundItem, Vec3 } from "@/lib/types";

type Props = {
  stage: { w: number; h: number };
  sounds: SoundItem[];
  selectedId: string | null;
  room: RoomConfig;
  onSelect: (id: string) => void;
  onMoveSound: (id: string, pos: Vec3) => void;
  onMoveListener: (pos: Vec3) => void;
  onMoveSpeaker: (id: string, pos: Vec3) => void;
};

/** Top-down room: x right, y down = towards the back. -1..1 in both axes. */
export function RoomView(p: Props) {
  const { w, h } = p.stage;
  const size = Math.min(w, h) * 0.9;
  const ox = (w - size) / 2;
  const oy = (h - size) / 2;
  const toPx = (v: Vec3) => ({ left: ox + ((v.x + 1) / 2) * size, top: oy + ((v.y + 1) / 2) * size });

  const drag =
    (cb: (pos: { x: number; y: number }) => void) => (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget;
      const parent = target.parentElement?.getBoundingClientRect();
      if (!parent) return;
      target.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const x = Math.max(-1, Math.min(1, ((ev.clientX - parent.left - ox) / size) * 2 - 1));
        const y = Math.max(-1, Math.min(1, ((ev.clientY - parent.top - oy) / size) * 2 - 1));
        cb({ x, y });
      };
      const up = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
    };

  const metres = (v: Vec3) => `${(Math.hypot(v.x - p.room.listener.x, v.y - p.room.listener.y) * (p.room.size / 2)).toFixed(1)} m`;

  return (
    <div className="absolute inset-0 select-none">
      {/* room floor */}
      <div
        className="absolute rounded-lg border border-border/70 bg-card/30"
        style={{
          left: ox,
          top: oy,
          width: size,
          height: size,
          backgroundImage:
            "linear-gradient(to right, hsl(var(--border) / 0.35) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.35) 1px, transparent 1px)",
          backgroundSize: `${size / 8}px ${size / 8}px`,
        }}
      >
        <span className="absolute left-2 top-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          Front
        </span>
        <span className="absolute bottom-1 left-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Back · {p.room.size} m
        </span>
      </div>

      {/* speakers */}
      {p.room.outputMode === "speakers" &&
        p.room.speakers.map((sp) => (
          <div
            key={sp.id}
            onPointerDown={
              p.room.layout === "custom"
                ? drag((pos) => p.onMoveSpeaker(sp.id, { ...sp.position, ...pos }))
                : undefined
            }
            className={`absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-muted-foreground ${
              p.room.layout === "custom" ? "cursor-grab touch-none active:cursor-grabbing" : ""
            }`}
            style={toPx(sp.position)}
            title={sp.name}
          >
            <Speaker className="size-5" />
            <span className="text-[10px]">{sp.name}</span>
          </div>
        ))}

      {/* listener */}
      <div
        onPointerDown={drag((pos) => p.onMoveListener({ ...p.room.listener, ...pos }))}
        className="absolute z-20 grid size-9 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center rounded-full border-2 border-foreground bg-background/80 active:cursor-grabbing"
        style={toPx(p.room.listener)}
        aria-label="Listener"
      >
        <Ear className="size-4" />
      </div>

      {/* sounds */}
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
              className="absolute z-30 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none active:cursor-grabbing"
              style={toPx(s.position)}
            >
              <div
                className={`grid place-items-center rounded-full text-[11px] font-bold text-background shadow-lg transition-transform ${
                  active ? "ring-2 ring-foreground" : ""
                } ${s.playing ? "animate-pulse" : "opacity-70"}`}
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
