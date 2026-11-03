import {
  Activity,
  AudioLines,
  Copy,
  Eraser,
  Image as ImageIcon,
  Maximize2,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Ruler,
  Spline,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import {
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { AutomationEditor } from "@/components/timeline/AutomationEditor";
import { AutomationLane } from "@/components/timeline/AutomationLane";
import { ProjectorRow } from "@/components/timeline/ProjectorRow";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { formatTime } from "@/lib/format";
import {
  TRACK_COLORS,
  TRACK_KINDS,
  axisOutline,
  pathChain,
  pathDuration,
  snapTimelineTime,
  timelineLength,
  trackColor,
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
  onPatchOutput: (id: string, next: Partial<OutputScreen>) => void;
  onSplitOutputs: (overlap: number) => void;
  onOpenOutput: (id: string) => void;
  onPatchPath: (path: SoundPath) => void;
};

const kindInfo: Record<TimelineTrackKind, { label: string; Icon: LucideIcon }> = {
  visual: { label: "Visual", Icon: ImageIcon },
  audio: { label: "Audio", Icon: AudioLines },
  movement: { label: "Movement", Icon: Spline },
};

/** Lane geometry in px: padding around the rows, track header width and the gap after it. */
const PAD = 8;
const HEAD = 176;
const GAP = 8;
const LANE_X = PAD + HEAD + GAP;

/** `#rrggbb` plus an alpha channel. */
const tint = (hex: string, alpha: number) =>
  `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
/** A see-through color wash over the card background, so sticky headers stay opaque. */
const wash = (hex: string, alpha: number) => ({
  backgroundImage: `linear-gradient(${tint(hex, alpha)}, ${tint(hex, alpha)})`,
});

export function ShowPanel(p: Props) {
  const [showLanes, setShowLanes] = useState(true);
  const [bigLaneClipId, setBigLaneClipId] = useState<string | null>(null);
  const [chosenSources, setChosenSources] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);
  const [focusedTrackId, setFocusedTrackId] = useState<string | null>(null);

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
    if (clip.kind === "movement") return Infinity;
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
  const colorOf = (clip: TimelineClip) =>
    trackColor(
      p.tracks.find((track) => track.id === clip.trackId),
      clip.kind,
    );

  // a selected clip puts its track in focus, otherwise the track that was clicked last
  const selectedClip = p.clips.find((clip) => clip.id === p.selectedClipId);
  const focusedId = selectedClip?.trackId ?? focusedTrackId;
  /** Focuses a track from its card or header, selecting its first clip so the clip panel opens. */
  const focusTrack = (track: TimelineTrack) => (event: ReactMouseEvent<HTMLDivElement>) => {
    // clicks inside menus and pickers bubble here through their portals; those are not focus clicks
    if (!event.currentTarget.contains(event.target as Node)) return;
    setFocusedTrackId(track.id);
    if (selectedClip?.trackId === track.id) return;
    const first = p.clips
      .filter((clip) => clip.trackId === track.id)
      .sort((a, b) => a.start - b.start)[0];
    p.onSelectClip(first?.id ?? null);
  };
  /** Border, wash and outline of a track card or header; stronger while it is in focus. */
  const trackStyle = (track: TimelineTrack, color: string) =>
    focusedId === track.id
      ? { borderColor: color, ...wash(color, 0.3), boxShadow: `0 0 0 1px ${color}` }
      : { borderColor: tint(color, 0.8), ...wash(color, 0.1) };

  const length = timelineLength(p.clips);
  const pixelsPerSecond = 18 * p.zoom;
  const width = Math.max(640, length * pixelsPerSecond);
  // tracks are grouped by kind, so every visual track sits together, then audio, then movement
  const ordered = TRACK_KINDS.flatMap((kind) => p.tracks.filter((track) => track.kind === kind));
  /** Adds a track of this kind below the last one, so new tracks stack under the main track. */
  const addTrack = (kind: TimelineTrackKind) => {
    const numbers = p.tracks
      .filter((track) => track.kind === kind)
      .map((track) => Number(/(\d+)$/.exec(track.name)?.[1] ?? 0));
    const track: TimelineTrack = {
      id: `tr${Date.now()}`,
      name: `${kindInfo[kind].label} ${Math.max(0, ...numbers) + 1}`,
      kind,
      muted: false,
      solo: false,
    };
    const index = p.tracks.map((item) => item.kind).lastIndexOf(kind);
    p.onTracks([...p.tracks.slice(0, index + 1), track, ...p.tracks.slice(index + 1)]);
  };
  const clearTrack = (track: TimelineTrack) => {
    const selected = p.clips.find((clip) => clip.id === p.selectedClipId);
    if (selected?.trackId === track.id) p.onSelectClip(null);
    p.onClips(p.clips.filter((clip) => clip.trackId !== track.id));
  };
  const deleteTrack = (track: TimelineTrack) => {
    clearTrack(track);
    p.onTracks(p.tracks.filter((item) => item.id !== track.id));
  };
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

  /** Small x-axis overview of a movement path with its points, as in the room editor. */
  const movementPreview = (path: SoundPath, color: string) => {
    const w = 200;
    const h = 64;
    const span = Math.max(0.001, pathDuration(path));
    const toX = (time: number) => 6 + (Math.min(time, span) / span) * (w - 12);
    const toY = (value: number) => 6 + ((value + 1) / 2) * (h - 12);
    return (
      <div className="flex items-center gap-3">
        <svg
          width={w}
          height={h}
          className="shrink-0 rounded-md border border-border bg-background/60"
          aria-label={`Movement of ${path.name}`}
        >
          <polyline
            points={axisOutline(path, "x", toX, toY)}
            fill="none"
            stroke={color}
            strokeWidth={2}
          />
          {pathChain(path).map(({ nodeId, time }, index) => {
            const node = path.nodes.find((item) => item.id === nodeId);
            if (!node) return null;
            return (
              <circle
                key={`${nodeId}-${index}`}
                cx={toX(time)}
                cy={toY(node.position.x)}
                r={4}
                className="fill-foreground"
              />
            );
          })}
        </svg>
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-muted-foreground">Duration</dt>
          <dd className="tabular-nums">{pathDuration(path).toFixed(1)}s</dd>
          <dt className="text-muted-foreground">Points</dt>
          <dd className="tabular-nums">{path.nodes.length}</dd>
        </dl>
      </div>
    );
  };

  const trackCard = (track: TimelineTrack) => {
    const color = trackColor(track, track.kind);
    const { label, Icon } = kindInfo[track.kind];
    const items = sources(track.kind);
    const clipCount = p.clips.filter((clip) => clip.trackId === track.id).length;
    // the first track of each kind is the main one: it adds tracks and can only be emptied
    const isMain = p.tracks.find((item) => item.kind === track.kind)?.id === track.id;
    // the picker only names a file while a clip of it is still on this track
    const picked = chosenSources[track.id];
    const chosen = p.clips.some(
      (clip) =>
        clip.trackId === track.id &&
        (clip.kind === "visual"
          ? clip.mediaId
          : clip.kind === "audio"
            ? clip.soundId
            : clip.pathId) === picked,
    )
      ? picked
      : undefined;
    const chosenPath =
      track.kind === "movement" ? p.paths.find((item) => item.id === chosen) : undefined;
    return (
      <div
        key={`add-${track.id}`}
        className="@container cursor-pointer space-y-2 rounded-lg border bg-card p-2 transition-shadow"
        style={trackStyle(track, color)}
        onClick={focusTrack(track)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-md border"
            style={{ borderColor: tint(color, 0.6), color }}
          >
            <Icon className="size-4" />
          </span>
          {renaming?.id === track.id ? (
            <Input
              autoFocus
              value={renaming.draft}
              aria-label="Track name"
              className="h-7 min-w-0 flex-1"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setRenaming({ id: track.id, draft: e.target.value })}
              onBlur={(e) => {
                const name = e.currentTarget.value.trim();
                if (name && name !== track.name) patchTrack(track.id, { name });
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") e.currentTarget.value = track.name;
                if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
              }}
            />
          ) : (
            <span
              className="min-w-0 shrink truncate text-xs font-semibold"
              title={`Add clip to ${track.name} (double-click to rename)`}
              onDoubleClick={() => setRenaming({ id: track.id, draft: track.name })}
            >
              {/* the track name always shows, the prefix only when the card is wide enough */}
              <span className="hidden @md:inline">Add clip to </span>
              {track.name}
            </span>
          )}
          <Select
            value={chosen ?? ""}
            onValueChange={(id) => {
              setChosenSources((current) => ({ ...current, [track.id]: id }));
              addClip(track, id);
            }}
          >
            <SelectTrigger
              className="h-7 min-w-32 flex-1 bg-background/60"
              title={items.find((item) => item.id === chosen)?.name}
            >
              <SelectValue placeholder={items.length ? "Choose clip" : "No available clips"} />
            </SelectTrigger>
            <SelectContent className="max-w-[min(32rem,calc(100vw-2rem))]">
              {items.map((item) => (
                <SelectItem key={item.id} value={item.id} className="max-w-full">
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isMain ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              aria-label={`Add another ${label} track`}
              title={`Add another ${label} track below`}
              onClick={() => addTrack(track.kind)}
            >
              <Plus />
            </Button>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0 text-destructive hover:text-destructive"
              aria-label={`Delete ${track.name}`}
              title={`Delete ${track.name} and its clips`}
              onClick={(event) => {
                // a deleted track should not take focus from the card's click handler
                event.stopPropagation();
                deleteTrack(track);
              }}
            >
              <Trash2 />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                aria-label={`${track.name} options`}
                title={`Edit ${track.name}: color, name, clear or delete`}
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            {/* keep focus off the trigger on close so the rename field keeps it */}
            <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuLabel className="text-xs">Color</DropdownMenuLabel>
              <div className="grid grid-cols-5 gap-1 px-1 pb-1">
                {TRACK_COLORS.map((swatch) => (
                  <DropdownMenuItem
                    key={swatch.value}
                    aria-label={swatch.name}
                    title={swatch.name}
                    className="grid size-7 place-items-center p-0"
                    onSelect={() => patchTrack(track.id, { color: swatch.value })}
                  >
                    <span
                      className={`size-4 rounded-full ${color === swatch.value ? "ring-2 ring-foreground ring-offset-1 ring-offset-popover" : ""}`}
                      style={{ backgroundColor: swatch.value }}
                    />
                  </DropdownMenuItem>
                ))}
              </div>
              {track.color && (
                <DropdownMenuItem onSelect={() => patchTrack(track.id, { color: undefined })}>
                  <RotateCcw /> Default color
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setRenaming({ id: track.id, draft: track.name })}>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!clipCount} onSelect={() => clearTrack(track)}>
                <Eraser /> Clear clips
              </DropdownMenuItem>
              {!isMain && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => deleteTrack(track)}
                >
                  <Trash2 /> Delete track
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {chosenPath?.segments.length ? movementPreview(chosenPath, color) : null}
      </div>
    );
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          title={p.playing ? "Pause show playback" : "Play show from the current time"}
          onClick={p.playing ? p.onPause : p.onPlay}
          disabled={!p.clips.length}
        >
          {p.playing ? <Pause /> : <Play />}
          {p.playing ? "Pause" : "Play"}
        </Button>
        <Button
          size="icon"
          variant="secondary"
          onClick={p.onStop}
          aria-label="Stop timeline"
          title="Stop playback and return to the beginning"
        >
          <Square />
        </Button>
        <span className="min-w-12 font-mono text-xs tabular-nums">{formatTime(p.time)}</span>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => p.onZoom(Math.max(0.5, p.zoom - 0.25))}
          aria-label="Zoom timeline out"
          title="Zoom timeline out"
        >
          <ZoomOut />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => p.onZoom(Math.min(3, p.zoom + 0.25))}
          aria-label="Zoom timeline in"
          title="Zoom timeline in"
        >
          <ZoomIn />
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-background/50">
        <div className="relative min-w-max space-y-1.5 p-2" style={{ width: width + LANE_X + PAD }}>
          <div className="flex" style={{ gap: GAP }}>
            <div className="sticky left-2 z-30 shrink-0 bg-background" style={{ width: HEAD }} />
            <button
              className="relative h-6 flex-1 cursor-col-resize border-b border-border"
              title="Click or drag to move the timeline playhead"
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
          {ordered.map((track) => {
            const color = trackColor(track, track.kind);
            const { Icon } = kindInfo[track.kind];
            return (
              <div key={track.id} className="flex h-14" style={{ gap: GAP }}>
                <div
                  className="sticky left-2 z-30 flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border bg-card px-2"
                  style={{ width: HEAD, ...trackStyle(track, color) }}
                  onClick={focusTrack(track)}
                >
                  <span
                    className="grid size-8 shrink-0 place-items-center rounded-md border"
                    style={{ borderColor: tint(color, 0.6), color }}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-xs font-semibold"
                    title={track.name}
                  >
                    {track.name}
                  </span>
                  <Button
                    size="icon"
                    variant={track.muted ? "destructive" : "ghost"}
                    className="size-6"
                    onClick={() => patchTrack(track.id, { muted: !track.muted })}
                    aria-label={`Mute ${track.name}`}
                    title={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                  >
                    {track.muted ? <VolumeX /> : <Volume2 />}
                  </Button>
                  <Button
                    size="icon"
                    variant={track.solo ? "default" : "ghost"}
                    className="size-6 text-[9px]"
                    title={track.solo ? `Unsolo ${track.name}` : `Solo ${track.name}`}
                    onClick={() => patchTrack(track.id, { solo: !track.solo })}
                  >
                    S
                  </Button>
                </div>
                <div
                  className={`relative flex-1 rounded-lg bg-muted/20 ${track.muted ? "opacity-50" : ""}`}
                  onDoubleClick={() => {
                    const first = sources(track.kind)[0];
                    if (first) addClip(track, first.id);
                  }}
                >
                  {p.clips
                    .filter((clip) => clip.trackId === track.id)
                    .map((clip) => {
                      const boxWidth = Math.max(30, clip.duration * pixelsPerSecond);
                      const path =
                        clip.kind === "movement"
                          ? p.paths.find((item) => item.id === clip.pathId)
                          : undefined;
                      return (
                        <div
                          key={clip.id}
                          title="Click to select, drag to move, drag an edge to trim, right-click to delete"
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
                          className={`absolute inset-y-1 min-w-8 cursor-grab overflow-hidden rounded-md border-[1.5px] px-2.5 py-1 text-[11px] leading-tight text-white shadow ${p.selectedClipId === clip.id ? "ring-2 ring-foreground" : ""}`}
                          style={{
                            left: clip.start * pixelsPerSecond,
                            width: boxWidth,
                            borderColor: color,
                            backgroundColor: tint(color, 0.45),
                          }}
                        >
                          <div
                            onPointerDown={resizeClip(clip, "start")}
                            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/15 hover:bg-white/40"
                          />
                          <span className="block truncate font-medium">{clip.name}</span>
                          {path?.segments.length ? (
                            <svg
                              className="pointer-events-none absolute inset-x-0 bottom-0.5 h-5 opacity-70"
                              width={boxWidth}
                              height={20}
                            >
                              <polyline
                                points={axisOutline(
                                  path,
                                  "x",
                                  (time) =>
                                    (Math.min(time, clip.duration) /
                                      Math.max(0.001, clip.duration)) *
                                    boxWidth,
                                  (value) => 2 + ((value + 1) / 2) * 16,
                                )}
                                className="fill-none stroke-white"
                                strokeWidth={1.5}
                              />
                            </svg>
                          ) : null}
                          <span className="tabular-nums opacity-80">
                            {clip.duration.toFixed(1)}s
                          </span>
                          <div
                            onPointerDown={resizeClip(clip, "end")}
                            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/15 hover:bg-white/40"
                          />
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })}
          <div
            className="pointer-events-none absolute bottom-2 top-2 z-20 w-0.5 -translate-x-1/2 bg-destructive"
            style={{ left: LANE_X + p.time * pixelsPerSecond }}
          >
            <span className="absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-destructive" />
          </div>
        </div>
      </div>
      {p.selectedClipId &&
        (() => {
          const clip = p.clips.find((item) => item.id === p.selectedClipId);
          if (!clip) return null;
          const movementPath =
            clip.kind === "movement" ? p.paths.find((item) => item.id === clip.pathId) : undefined;
          return (
            <div
              className="space-y-2 rounded-lg border bg-card p-2"
              style={{ borderColor: tint(colorOf(clip), 0.8), ...wash(colorOf(clip), 0.14) }}
            >
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
                {clip.kind === "audio" && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">Reverb send</span>
                    <div className="w-28">
                      <Slider
                        aria-label="Reverb send"
                        value={[clip.reverbSend ?? 0]}
                        min={0}
                        max={1}
                        step={0.01}
                        onValueChange={([v = 0]) => patchClip(clip.id, { reverbSend: v })}
                      />
                    </div>
                    <span className="w-8 text-[10px] text-muted-foreground">
                      {Math.round((clip.reverbSend ?? 0) * 100)}%
                    </span>
                  </div>
                )}
                {maxDuration(clip) !== Infinity && (
                  <Button
                    size="sm"
                    variant="secondary"
                    title="Extend the clip to the full remaining source length"
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
                      variant={clip.loop ? "default" : "secondary"}
                      aria-pressed={!!clip.loop}
                      title="Repeat this movement path for the full timeline clip"
                      onClick={() => patchClip(clip.id, { loop: !clip.loop })}
                    >
                      <Repeat /> {clip.loop ? "Loop on" : "Loop off"}
                    </Button>
                    <Button
                      size="sm"
                      variant={showLanes ? "default" : "secondary"}
                      title="Show or hide the movement automation lanes"
                      onClick={() => setShowLanes(!showLanes)}
                    >
                      <Activity />
                      Automation
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      title="Open the full movement curve editor"
                      onClick={() => setBigLaneClipId(clip.id)}
                    >
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

      <div className="grid items-start gap-2 lg:grid-cols-3">
        {TRACK_KINDS.map((kind) => (
          <div key={kind} className="min-w-0 space-y-2">
            {p.tracks.filter((track) => track.kind === kind).map(trackCard)}
          </div>
        ))}
      </div>
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
