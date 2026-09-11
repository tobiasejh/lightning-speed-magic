import { Circle, Ear, PenLine, Speaker, Square, Trash2 } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/button";
import type { RoomConfig, SoundItem, SoundPath, SoundPathPoint, Vec3 } from "@/lib/types";

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

type CaptureMode = "draw" | "record" | null;

export function RoomView(p: Props) {
  const { w, h } = p.stage;
  const size = Math.min(w, h) * 0.9;
  const ox = (w - size) / 2;
  const oy = (h - size) / 2;
  const [mode, setMode] = useState<CaptureMode>(null);
  const [draft, setDraft] = useState<SoundPathPoint[]>([]);
  const draftRef = useRef<SoundPathPoint[]>([]);
  const captureStart = useRef(0);
  const selectedSound = p.sounds.find((sound) => sound.id === p.selectedId) ?? null;
  const selectedPath = p.paths.find((path) => path.id === p.activePathId) ?? null;
  const shownPath = draft.length ? draft : (selectedPath?.points ?? []);
  const toPx = (v: Vec3) => ({
    left: ox + ((v.x + 1) / 2) * size,
    top: oy + ((v.y + 1) / 2) * size,
  });
  const toPoint = (clientX: number, clientY: number, rect: DOMRect): Vec3 => ({
    x: Math.max(-1, Math.min(1, ((clientX - rect.left - ox) / size) * 2 - 1)),
    y: Math.max(-1, Math.min(1, ((clientY - rect.top - oy) / size) * 2 - 1)),
    z: selectedSound?.position.z ?? 0,
  });

  const finishCapture = () => {
    const captured = draftRef.current;
    if (!selectedSound || captured.length < 2) {
      draftRef.current = [];
      setDraft([]);
      setMode(null);
      return;
    }
    const rawDuration = captured[captured.length - 1]?.time ?? 0;
    const duration =
      mode === "draw" ? Math.max(2, captured.length * 0.12) : Math.max(0.25, rawDuration);
    const points = captured.map((point, index) => ({
      ...point,
      time:
        mode === "draw"
          ? (index / Math.max(1, captured.length - 1)) * duration
          : Math.min(duration, point.time),
    }));
    const existing = p.paths.find((path) => path.soundId === selectedSound.id);
    const path: SoundPath = {
      id: existing?.id ?? `path${Date.now()}`,
      name: `${selectedSound.name} movement`,
      soundId: selectedSound.id,
      duration,
      points,
    };
    p.onSavePath(path);
    p.onSelectPath(path.id);
    draftRef.current = [];
    setDraft([]);
    setMode(null);
  };

  const startCapture = (nextMode: Exclude<CaptureMode, null>) => {
    if (!selectedSound) return;
    const initial = [{ time: 0, position: selectedSound.position }];
    draftRef.current = initial;
    setDraft(initial);
    captureStart.current = performance.now();
    setMode(nextMode);
  };

  const capture = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!mode || !selectedSound) return;
    e.preventDefault();
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    target.setPointerCapture(e.pointerId);
    const add = (ev: PointerEvent) => {
      const position = toPoint(ev.clientX, ev.clientY, rect);
      p.onMoveSound(selectedSound.id, position);
      setDraft((current) => {
        const last = current[current.length - 1];
        if (last && Math.hypot(last.position.x - position.x, last.position.y - position.y) < 0.012)
          return current;
        const next = [
          ...current,
          { time: (performance.now() - captureStart.current) / 1000, position },
        ];
        draftRef.current = next;
        return next;
      });
    };
    const up = () => {
      target.removeEventListener("pointermove", add);
      target.removeEventListener("pointerup", up);
      setTimeout(finishCapture, 0);
    };
    add(e.nativeEvent);
    target.addEventListener("pointermove", add);
    target.addEventListener("pointerup", up);
  };

  const drag =
    (cb: (pos: { x: number; y: number }) => void) => (e: ReactPointerEvent<HTMLElement>) => {
      if (mode) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget;
      const parent = target.parentElement?.getBoundingClientRect();
      if (!parent) return;
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
    <div className="absolute inset-0 select-none" onPointerDown={capture}>
      <div
        className={`absolute overflow-hidden rounded-lg border border-border/70 bg-card/30 ${mode ? "cursor-crosshair touch-none" : ""}`}
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

      <div className="absolute left-3 top-3 z-50 flex items-center gap-1 rounded-md border border-border bg-background/90 p-1 shadow-lg">
        <Button
          size="sm"
          variant={mode === "draw" ? "default" : "ghost"}
          disabled={!selectedSound}
          onClick={(event) => {
            event.stopPropagation();
            startCapture("draw");
          }}
        >
          <PenLine /> Draw
        </Button>
        <Button
          size="sm"
          variant={mode === "record" ? "destructive" : "ghost"}
          disabled={!selectedSound}
          onClick={(event) => {
            event.stopPropagation();
            startCapture("record");
          }}
        >
          {mode === "record" ? <Square /> : <Circle />} Record
        </Button>
        {selectedPath && !mode && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Delete movement path"
            onClick={(event) => {
              event.stopPropagation();
              p.onDeletePath(selectedPath.id);
            }}
          >
            <Trash2 />
          </Button>
        )}
      </div>

      {shownPath.length > 1 && (
        <svg className="pointer-events-none absolute inset-0 size-full">
          <polyline
            points={shownPath
              .map((point) => {
                const px = toPx(point.position);
                return `${px.left},${px.top}`;
              })
              .join(" ")}
            className="fill-none stroke-primary"
            strokeWidth="3"
            strokeDasharray={mode ? "5 5" : undefined}
          />
          {shownPath.map((point, index) => {
            const px = toPx(point.position);
            return (
              <circle
                key={`${point.time}-${index}`}
                cx={px.left}
                cy={px.top}
                r={index === 0 || index === shownPath.length - 1 ? 5 : 2}
                className="fill-primary"
              />
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
