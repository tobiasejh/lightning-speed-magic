import {
  Copy,
  ExternalLink,
  Pause,
  Play,
  Plus,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  moveNode,
  pathChain,
  pathDuration,
  patchSegment,
  sampleSegment,
  snapTimelineTime,
  timelineLength,
  withDuration,
} from "@/lib/timeline";
import type {
  MediaItem,
  OutputScreen,
  SoundItem,
  SoundPath,
  Surface,
  TimelineClip,
  TimelineTrack,
  TimelineTrackKind,
} from "@/lib/types";


type Props = {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  media: MediaItem[];
  sounds: SoundItem[];
  paths: SoundPath[];
  surfaces: Surface[];
  outputs: OutputScreen[];
  openOutputs: string[];
  playing: boolean;
  time: number;
  zoom: number;
  selectedClipId: string | null;
  onTracks: (tracks: TimelineTrack[]) => void;
  onClips: (clips: TimelineClip[]) => void;
  onSelectClip: (id: string | null) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onZoom: (zoom: number) => void;
  onAddOutput: () => void;
  onRemoveOutput: (id: string) => void;
  onOpenOutput: (id: string) => void;
  onPatchPath: (path: SoundPath) => void;
};


const fmt = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const colors: Record<TimelineTrackKind, string> = {
  visual: "bg-chart-1/70",
  audio: "bg-chart-3/70",
  movement: "bg-chart-2/70",
};

const LANE_HEIGHT = 44;

/** Sampled outline of one axis of a movement path, in lane pixels. */
const axisOutline = (
  path: SoundPath,
  axis: "x" | "y",
  toX: (time: number) => number,
  toY: (value: number) => number,
) => {
  const points: string[] = [];
  let time = 0;
  for (const segment of path.segments) {
    const length = Math.max(1, segment.durationMs) / 1000;
    for (let i = 0; i <= 8; i++) {
      const sample = sampleSegment(path, segment, i / 8);
      if (!sample) continue;
      points.push(`${toX(time + (i / 8) * length)},${toY(sample[axis])}`);
    }
    time += length;
  }
  return points.join(" ");
};

function AutomationLane(props: {
  path: SoundPath;
  clip: TimelineClip;
  axis: "x" | "y";
  pixelsPerSecond: number;
  onPatchPath: (path: SoundPath) => void;
}) {
  const { path, clip, axis } = props;
  const width = Math.max(140, clip.duration * props.pixelsPerSecond);
  const span = Math.max(0.001, clip.duration);
  const toX = (time: number) => (Math.max(0, Math.min(span, time)) / span) * width;
  const toY = (value: number) => ((value + 1) / 2) * LANE_HEIGHT;
  const fromY = (py: number) => Math.max(-1, Math.min(1, (py / LANE_HEIGHT) * 2 - 1));
  const chain = pathChain(path);

  const dragHandle =
    (index: number, nodeId: string) => (event: ReactPointerEvent<SVGCircleElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      const rect = (target.ownerSVGElement ?? target).getBoundingClientRect();
      target.setPointerCapture(event.pointerId);
      let latest = path;
      const move = (ev: PointerEvent) => {
        const node = latest.nodes.find((item) => item.id === nodeId);
        if (!node) return;
        const value = fromY(ev.clientY - rect.top);
        latest = moveNode(latest, nodeId, { ...node.position, [axis]: value });
        // horizontal drag retimes the lines around this point
        const wanted = ((ev.clientX - rect.left) / width) * span;
        const previous = latest.segments[index - 1];
        const next = latest.segments[index];
        const delta = wanted - (chain[index]?.time ?? 0);
        if (previous && Math.abs(delta) > 0.005) {
          const durationMs = Math.max(20, previous.durationMs + delta * 1000);
          latest = patchSegment(latest, previous.id, { durationMs });
          if (next)
            latest = patchSegment(latest, next.id, {
              durationMs: Math.max(20, next.durationMs - (durationMs - previous.durationMs)),
            });
        }
        props.onPatchPath(latest);
      };
      const up = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        props.onPatchPath(withDuration(latest));
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
        height={LANE_HEIGHT}
        className="rounded border border-border bg-muted/20"
        style={{ touchAction: "none" }}
      >
        <line
          x1={0}
          x2={width}
          y1={LANE_HEIGHT / 2}
          y2={LANE_HEIGHT / 2}
          className="stroke-border"
        />
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
              r={5}
              className="cursor-grab fill-foreground"
              onPointerDown={dragHandle(index, entry.nodeId)}
            />
          );
        })}
      </svg>
    </div>
  );
}

export function ShowPanel(p: Props) {
  const [showLanes, setShowLanes] = useState(true);

  const length = timelineLength(p.clips);
  const pixelsPerSecond = 18 * p.zoom;
  const width = Math.max(640, length * pixelsPerSecond);
  const addTrack = (kind: TimelineTrackKind) =>
    p.onTracks([
      ...p.tracks,
      {
        id: `tr${Date.now()}`,
        name: `${kind[0]!.toUpperCase()}${kind.slice(1)} ${p.tracks.filter((track) => track.kind === kind).length + 1}`,
        kind,
        muted: false,
        solo: false,
      },
    ]);
  const addClip = (track: TimelineTrack, sourceId: string) => {
    const end = Math.max(
      0,
      ...p.clips
        .filter((clip) => clip.trackId === track.id)
        .map((clip) => clip.start + clip.duration),
    );
    const media = p.media.find((item) => item.id === sourceId);
    const sound = p.sounds.find((item) => item.id === sourceId);
    const path = p.paths.find((item) => item.id === sourceId);
    const duration = Math.max(
      0.5,
      path?.duration ?? sound?.duration ?? (media?.trimEnd ?? 10) - (media?.trimStart ?? 0),
    );
    const clip: TimelineClip = {
      id: `clip${Date.now()}`,
      trackId: track.id,
      kind: track.kind,
      name: media?.name ?? sound?.name ?? path?.name ?? "Clip",
      start: end,
      duration,
      inPoint: media?.trimStart ?? 0,
      mediaId: media?.id,
      soundId: sound?.id ?? path?.soundId,
      pathId: path?.id,
      surfaceId: track.kind === "visual" ? p.surfaces[0]?.id : undefined,
    };
    p.onClips([...p.clips, clip]);
    p.onSelectClip(clip.id);
  };
  const patchTrack = (id: string, next: Partial<TimelineTrack>) =>
    p.onTracks(p.tracks.map((track) => (track.id === id ? { ...track, ...next } : track)));
  const patchClip = (id: string, next: Partial<TimelineClip>) =>
    p.onClips(p.clips.map((clip) => (clip.id === id ? { ...clip, ...next } : clip)));
  const dragClip = (clip: TimelineClip) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const startX = event.clientX;
    const initial = clip.start;
    target.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent) =>
      patchClip(clip.id, {
        start: snapTimelineTime(
          initial + (ev.clientX - startX) / pixelsPerSecond,
          p.clips,
          clip.id,
        ),
      });
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };
  const resizeClip =
    (clip: TimelineClip, side: "start" | "end") => (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      const startX = event.clientX;
      const original = { start: clip.start, duration: clip.duration, inPoint: clip.inPoint };
      target.setPointerCapture(event.pointerId);
      const move = (ev: PointerEvent) => {
        const delta = (ev.clientX - startX) / pixelsPerSecond;
        if (side === "end")
          patchClip(clip.id, { duration: Math.max(0.25, original.duration + delta) });
        else {
          const nextStart = Math.max(
            0,
            Math.min(original.start + original.duration - 0.25, original.start + delta),
          );
          const change = nextStart - original.start;
          patchClip(clip.id, {
            start: nextStart,
            duration: original.duration - change,
            inPoint: Math.max(0, original.inPoint + change),
          });
        }
      };
      const up = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
    };
  const sources = (kind: TimelineTrackKind) =>
    kind === "visual" ? p.media : kind === "audio" ? p.sounds : p.paths;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={p.playing ? p.onPause : p.onPlay} disabled={!p.clips.length}>
          {p.playing ? <Pause /> : <Play />}
          {p.playing ? "Pause" : "Play"}
        </Button>
        <Button size="icon" variant="secondary" onClick={p.onStop} aria-label="Stop timeline">
          <Square />
        </Button>
        <span className="min-w-12 font-mono text-xs tabular-nums">{fmt(p.time)}</span>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => p.onZoom(Math.max(0.5, p.zoom - 0.25))}
          aria-label="Zoom timeline out"
        >
          <ZoomOut />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => p.onZoom(Math.min(3, p.zoom + 0.25))}
          aria-label="Zoom timeline in"
        >
          <ZoomIn />
        </Button>
        <Select onValueChange={(value) => addTrack(value as TimelineTrackKind)}>
          <SelectTrigger className="ml-auto h-8 w-28">
            <Plus />
            <SelectValue placeholder="Track" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="visual">Visual</SelectItem>
            <SelectItem value="audio">Audio</SelectItem>
            <SelectItem value="movement">Movement</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto rounded-md border border-border bg-background/50">
        <div className="flex min-w-max" style={{ width: width + 116 }}>
          <div className="w-28 shrink-0 border-r border-border bg-card/80" />
          <button
            className="relative h-7 flex-1 cursor-col-resize border-b border-border"
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              p.onSeek((event.clientX - rect.left) / pixelsPerSecond);
            }}
          >
            {Array.from({ length: Math.ceil(length / 5) + 1 }, (_, index) => (
              <span
                key={index}
                className="absolute top-1 text-[9px] text-muted-foreground"
                style={{ left: index * 5 * pixelsPerSecond }}
              >
                {index * 5}s
              </span>
            ))}
          </button>
        </div>
        <div className="relative min-w-max" style={{ width: width + 116 }}>
          {p.tracks.map((track) => (
            <div key={track.id} className="flex h-12 border-b border-border last:border-b-0">
              <div className="flex w-28 shrink-0 items-center gap-1 border-r border-border bg-card/80 px-1.5">
                <span className="min-w-0 flex-1 truncate text-[10px] font-medium">
                  {track.name}
                </span>
                <Button
                  size="icon"
                  variant={track.muted ? "destructive" : "ghost"}
                  className="size-6"
                  onClick={() => patchTrack(track.id, { muted: !track.muted })}
                  aria-label={`Mute ${track.name}`}
                >
                  {track.muted ? <VolumeX /> : <Volume2 />}
                </Button>
                <Button
                  size="icon"
                  variant={track.solo ? "default" : "ghost"}
                  className="size-6 text-[9px]"
                  onClick={() => patchTrack(track.id, { solo: !track.solo })}
                >
                  S
                </Button>
              </div>
              <div
                className="relative flex-1 bg-muted/20"
                onDoubleClick={() => {
                  const items = sources(track.kind);
                  const first = items[0];
                  if (first) addClip(track, first.id);
                }}
              >
                {p.clips
                  .filter((clip) => clip.trackId === track.id)
                  .map((clip) => (
                    <div
                      key={clip.id}
                      onPointerDown={dragClip(clip)}
                      onClick={(event) => {
                        event.stopPropagation();
                        p.onSelectClip(clip.id);
                      }}
                      className={`absolute top-1 h-10 min-w-8 cursor-grab overflow-hidden rounded border px-2 py-1 text-[10px] shadow ${colors[clip.kind]} ${p.selectedClipId === clip.id ? "border-foreground ring-1 ring-foreground" : "border-border"}`}
                      style={{
                        left: clip.start * pixelsPerSecond,
                        width: Math.max(30, clip.duration * pixelsPerSecond),
                      }}
                    >
                      <div
                        onPointerDown={resizeClip(clip, "start")}
                        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-foreground/30"
                      />
                      <span className="block truncate font-medium">{clip.name}</span>
                      <span className="tabular-nums opacity-70">{clip.duration.toFixed(1)}s</span>
                      <div
                        onPointerDown={resizeClip(clip, "end")}
                        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-foreground/30"
                      />
                    </div>
                  ))}
                <div
                  className="pointer-events-none absolute inset-y-0 z-20 w-px bg-destructive"
                  style={{ left: p.time * pixelsPerSecond }}
                />
              </div>
            </div>
          ))}
          {!p.tracks.length && (
            <p className="p-4 text-xs text-muted-foreground">
              Add a visual, audio, or movement track.
            </p>
          )}
        </div>
      </div>
      {p.selectedClipId &&
        (() => {
          const clip = p.clips.find((item) => item.id === p.selectedClipId);
          if (!clip) return null;
          return (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
              <span className="min-w-0 flex-1 truncate text-xs">{clip.name}</span>
              {clip.kind === "visual" && (
                <Select
                  value={clip.surfaceId ?? ""}
                  onValueChange={(surfaceId) => patchClip(clip.id, { surfaceId })}
                >
                  <SelectTrigger className="h-7 w-32">
                    <SelectValue placeholder="Surface" />
                  </SelectTrigger>
                  <SelectContent>
                    {p.surfaces.map((surface) => (
                      <SelectItem key={surface.id} value={surface.id}>
                        {surface.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label="Duplicate clip"
                onClick={() =>
                  p.onClips([
                    ...p.clips,
                    { ...clip, id: `clip${Date.now()}`, start: clip.start + clip.duration },
                  ])
                }
              >
                <Copy />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Delete clip"
                onClick={() => {
                  p.onClips(p.clips.filter((item) => item.id !== clip.id));
                  p.onSelectClip(null);
                }}
              >
                <Trash2 />
              </Button>
            </div>
          );
        })()}
      {p.tracks.map((track) => (
        <div key={`add-${track.id}`} className="flex items-center gap-2">
          <span className="w-28 truncate text-[10px] text-muted-foreground">
            Add to {track.name}
          </span>
          <Select onValueChange={(id) => addClip(track, id)}>
            <SelectTrigger className="h-7 flex-1">
              <Plus />
              <SelectValue
                placeholder={sources(track.kind).length ? "Choose clip" : "No available clips"}
              />
            </SelectTrigger>
            <SelectContent>
              {sources(track.kind).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={`Delete ${track.name}`}
            onClick={() => {
              p.onTracks(p.tracks.filter((item) => item.id !== track.id));
              p.onClips(p.clips.filter((clip) => clip.trackId !== track.id));
            }}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="space-y-1.5 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">Projectors</p>
          <Button size="sm" variant="ghost" onClick={p.onAddOutput}>
            <Plus /> Add
          </Button>
        </div>
        {p.outputs.map((output) => (
          <div key={output.id} className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm">{output.name}</span>
            <Button
              size="sm"
              variant={p.openOutputs.includes(output.id) ? "default" : "secondary"}
              onClick={() => p.onOpenOutput(output.id)}
            >
              <ExternalLink />
              {p.openOutputs.includes(output.id) ? "Live" : "Open"}
            </Button>
            {p.outputs.length > 1 && (
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label="Remove projector"
                onClick={() => p.onRemoveOutput(output.id)}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
