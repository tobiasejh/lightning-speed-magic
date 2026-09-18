import {
  Activity,
  Copy,
  ExternalLink,
  Maximize2,
  Pause,
  Play,
  Plus,
  Ruler,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { AutomationEditor } from "@/components/AutomationEditor";
import { AutomationLane, axisOutline } from "@/components/AutomationLane";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pathDuration, snapTimelineTime, timelineLength } from "@/lib/timeline";
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
  onPatchOutput: (id: string, next: Partial<OutputScreen>) => void;
  onSplitOutputs: (overlap: number) => void;
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

export function ShowPanel(p: Props) {
  const [showLanes, setShowLanes] = useState(true);
  const [bigLaneClipId, setBigLaneClipId] = useState<string | null>(null);
  const [chosenSources, setChosenSources] = useState<Record<string, string>>({});

  /** How much material a clip has, in seconds, or null when it has no fixed length. */
  const sourceLength = (clip: TimelineClip): number | null => {
    const media = clip.mediaId ? p.media.find((item) => item.id === clip.mediaId) : undefined;
    if (media) {
      if (media.kind === "image") return null;
      const end = media.trimEnd ?? media.duration;
      return end ? end : null;
    }
    const sound = clip.soundId ? p.sounds.find((item) => item.id === clip.soundId) : undefined;
    if (sound?.duration) return sound.duration;
    return null;
  };
  const maxDuration = (clip: TimelineClip, inPoint = clip.inPoint) => {
    const total = sourceLength(clip);
    return total === null ? Infinity : Math.max(0.25, total - inPoint);
  };
  /** Loudness overview of whatever sound a clip is tied to, for the waveform. */
  const clipPeaks = (clip: TimelineClip) => {
    const sound = clip.soundId ? p.sounds.find((item) => item.id === clip.soundId) : undefined;
    if (sound?.peaks?.length) return sound.peaks;
    const media = clip.mediaId ? p.media.find((item) => item.id === clip.mediaId) : undefined;
    return media?.peaks?.length ? media.peaks : undefined;
  };

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
    // a new clip is as long as the file it came from
    const mediaLength = media
      ? (media.trimEnd ?? media.duration ?? (media.kind === "image" ? 10 : 0)) -
        (media.trimStart ?? 0)
      : 0;
    const duration = Math.max(0.5, path?.duration ?? sound?.duration ?? mediaLength);
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
          patchClip(clip.id, {
            // never longer than the material that is left in the file
            duration: Math.min(
              maxDuration(clip, original.inPoint),
              Math.max(0.25, original.duration + delta),
            ),
          });
        else {
          const earliest = original.start - original.inPoint;
          const nextStart = Math.max(
            Math.max(0, earliest),
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
    <div className="min-w-0 space-y-3">
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
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        p.onClips(p.clips.filter((item) => item.id !== clip.id));
                        if (p.selectedClipId === clip.id) p.onSelectClip(null);
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
                      {clip.kind === "movement" &&
                        (() => {
                          const path = p.paths.find((item) => item.id === clip.pathId);
                          if (!path?.segments.length) return null;
                          const boxWidth = Math.max(30, clip.duration * pixelsPerSecond);
                          return (
                            <svg
                              className="pointer-events-none absolute inset-x-0 bottom-0 h-4 opacity-80"
                              width={boxWidth}
                              height={16}
                            >
                              <polyline
                                points={axisOutline(
                                  path,
                                  "x",
                                  (time) =>
                                    (Math.min(time, clip.duration) /
                                      Math.max(0.001, clip.duration)) *
                                    boxWidth,
                                  (value) => ((value + 1) / 2) * 16,
                                )}
                                className="fill-none stroke-foreground"
                                strokeWidth={1.5}
                              />
                            </svg>
                          );
                        })()}
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
          const movementPath =
            clip.kind === "movement" ? p.paths.find((item) => item.id === clip.pathId) : undefined;
          return (
            <div className="space-y-2 rounded-md border border-border p-2">
              <div className="flex flex-wrap items-center gap-2">
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
                {maxDuration(clip) !== Infinity && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => patchClip(clip.id, { duration: maxDuration(clip) })}
                  >
                    <Ruler />
                    Fit to clip
                  </Button>
                )}
                {movementPath && (
                  <>
                    <Button
                      size="sm"
                      variant={showLanes ? "default" : "secondary"}
                      onClick={() => setShowLanes(!showLanes)}
                    >
                      <Activity />
                      Automation
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setBigLaneClipId(clip.id)}>
                      <Maximize2 />
                      Edit movement
                    </Button>
                  </>
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
              {movementPath && showLanes && (
                <div className="space-y-2 overflow-x-auto">
                  <p className="text-[10px] text-muted-foreground">
                    Drag a point up/down to move the sound, sideways to retime it. Edits also update
                    the room editor. Movement length {pathDuration(movementPath).toFixed(2)}s.
                  </p>
                  {(["x", "y"] as const).map((axis) => (
                    <AutomationLane
                      key={axis}
                      axis={axis}
                      path={movementPath}
                      span={clip.duration}
                      width={Math.max(320, clip.duration * pixelsPerSecond)}
                      peaks={clipPeaks(clip)}
                      onPatchPath={p.onPatchPath}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })()}

      {bigLaneClipId &&
        (() => {
          const clip = p.clips.find((item) => item.id === bigLaneClipId);
          const path = clip?.pathId ? p.paths.find((item) => item.id === clip.pathId) : undefined;
          if (!clip || !path) return null;
          return (
            <AutomationEditor
              path={path}
              clip={clip}
              time={p.time}
              peaks={clipPeaks(clip)}
              onPatchPath={p.onPatchPath}
              onClose={() => setBigLaneClipId(null)}
            />
          );
        })()}

      {p.tracks.map((track) => (
        <div key={`add-${track.id}`} className="flex min-w-0 items-center gap-2">
          <span className="w-28 truncate text-[10px] text-muted-foreground">
            + Add clip to {track.name}
          </span>
          <Select
            value={chosenSources[track.id]}
            onValueChange={(id) => {
              setChosenSources((current) => ({ ...current, [track.id]: id }));
              addClip(track, id);
            }}
          >
            <SelectTrigger
              className="h-7 min-w-0 flex-1"
              title={sources(track.kind).find((item) => item.id === chosenSources[track.id])?.name}
            >
              <Plus />
              <SelectValue
                placeholder={sources(track.kind).length ? "Choose clip" : "No available clips"}
              />
            </SelectTrigger>
            <SelectContent className="max-w-[min(32rem,calc(100vw-2rem))]">
              {sources(track.kind).map((item) => (
                <SelectItem key={item.id} value={item.id} className="max-w-full">
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
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => p.onSplitOutputs(0.12)}>
              Split evenly
            </Button>
            <Button size="sm" variant="ghost" onClick={p.onAddOutput}>
              <Plus /> Add
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Every projector shows a slice of one shared picture. Split evenly gives each one a piece
          with a 12% overlap, then soften the overlapping edges below.
        </p>
        <div
          className="relative h-16 w-full overflow-hidden rounded border border-border bg-muted/30"
          aria-label="Projector layout map"
        >
          {p.outputs.map((output, index) => (
            <div
              key={output.id}
              className="absolute border border-primary/70 bg-primary/10 text-[9px] text-foreground"
              style={{
                left: `${output.region.x * 100}%`,
                top: `${output.region.y * 100}%`,
                width: `${output.region.w * 100}%`,
                height: `${output.region.h * 100}%`,
              }}
            >
              <span className="px-1">{index + 1}</span>
            </div>
          ))}
        </div>
        {p.outputs.map((output) => (
          <ProjectorRow
            key={output.id}
            output={output}
            live={p.openOutputs.includes(output.id)}
            canRemove={p.outputs.length > 1}
            onOpen={() => p.onOpenOutput(output.id)}
            onRemove={() => p.onRemoveOutput(output.id)}
            onPatch={(next) => p.onPatchOutput(output.id, next)}
          />
        ))}
      </div>
    </div>
  );
}

const EDGES = ["left", "right", "top", "bottom"] as const;

function ProjectorRow({
  output,
  live,
  canRemove,
  onOpen,
  onRemove,
  onPatch,
}: {
  output: OutputScreen;
  live: boolean;
  canRemove: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onPatch: (next: Partial<OutputScreen>) => void;
}) {
  const [open, setOpen] = useState(false);
  const pct = (value: number) => Math.round(value * 100);
  const region = (key: "x" | "y" | "w" | "h", value: number) =>
    onPatch({ region: { ...output.region, [key]: Math.max(0, Math.min(1, value / 100)) } });
  return (
    <div className="rounded border border-border p-2">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-sm">{output.name}</span>
        <Button size="sm" variant={open ? "default" : "secondary"} onClick={() => setOpen(!open)}>
          Setup
        </Button>
        <Button size="sm" variant={live ? "default" : "secondary"} onClick={onOpen}>
          <ExternalLink />
          {live ? "Live" : "Open"}
        </Button>
        {canRemove && (
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Remove projector"
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-4 gap-1">
            {(["x", "y", "w", "h"] as const).map((key) => (
              <label key={key} className="text-[10px] text-muted-foreground">
                {key === "x"
                  ? "Left %"
                  : key === "y"
                    ? "Top %"
                    : key === "w"
                      ? "Width %"
                      : "Tall %"}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={pct(output.region[key])}
                  onChange={(e) => region(key, Number(e.target.value))}
                  className="mt-0.5 w-full rounded border border-border bg-background px-1 py-0.5 text-xs tabular-nums text-foreground"
                />
              </label>
            ))}
          </div>
          <Button
            size="sm"
            variant={output.blendTest ? "default" : "secondary"}
            className="w-full"
            onClick={() => onPatch({ blendTest: !output.blendTest })}
          >
            Blend test field
          </Button>
          {EDGES.map((edge) => {
            const value = output.blend[edge];
            return (
              <div key={edge} className="flex items-center gap-1 text-[10px]">
                <span className="w-12 capitalize text-muted-foreground">{edge}</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  aria-label={`${edge} fade width percent`}
                  value={Math.round(value.width * 100)}
                  onChange={(e) =>
                    onPatch({
                      blend: {
                        ...output.blend,
                        [edge]: {
                          ...value,
                          width: Math.max(0, Math.min(0.5, Number(e.target.value) / 100)),
                        },
                      },
                    })
                  }
                  className="w-12 rounded border border-border bg-background px-1 py-0.5 tabular-nums"
                />
                <span className="text-muted-foreground">fade %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  aria-label={`${edge} edge brightness percent`}
                  value={Math.round(value.level * 100)}
                  onChange={(e) =>
                    onPatch({
                      blend: {
                        ...output.blend,
                        [edge]: {
                          ...value,
                          level: Math.max(0, Math.min(1, Number(e.target.value) / 100)),
                        },
                      },
                    })
                  }
                  className="w-12 rounded border border-border bg-background px-1 py-0.5 tabular-nums"
                />
                <span className="text-muted-foreground">bright %</span>
                <input
                  type="number"
                  min={0.2}
                  max={4}
                  step={0.1}
                  aria-label={`${edge} fade curve`}
                  value={value.curve}
                  onChange={(e) =>
                    onPatch({
                      blend: {
                        ...output.blend,
                        [edge]: {
                          ...value,
                          curve: Math.max(0.2, Math.min(4, Number(e.target.value))),
                        },
                      },
                    })
                  }
                  className="w-12 rounded border border-border bg-background px-1 py-0.5 tabular-nums"
                />
                <span className="text-muted-foreground">curve</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
