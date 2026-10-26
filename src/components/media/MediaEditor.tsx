import {
  ArrowLeft,
  ArrowRight,
  Crop as CropIcon,
  Pause,
  Play,
  Scissors,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { LabeledRow } from "@/components/common/LabeledRow";
import { formatTimeTenths } from "@/lib/format";
import type { Crop, MediaItem, SoundItem } from "@/lib/types";
import { clamp01 } from "@/lib/warp";

const FRAME_DURATION_SECONDS = 1 / 30;

type Props = {
  media: MediaItem[];
  item: MediaItem | null;
  sounds: SoundItem[];
  onSelect: (id: string) => void;
  onPatch: (id: string, next: Partial<MediaItem>) => void;
  onSaveClip: (id: string, crop: Crop | undefined, inS: number, outS: number) => void;
  onDelete: (id: string) => void;
};

export function MediaEditor(p: Props) {
  const item = p.item;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const vidRef = useRef<HTMLVideoElement | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [duration, setDuration] = useState(0);
  const [inS, setInS] = useState(0);
  const [outS, setOutS] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setCrop(item?.crop ?? null);
    setInS(item?.trimStart ?? 0);
    setOutS(item?.trimEnd ?? 0);
    setDuration(0);
    setPlaying(false);
  }, [item?.id, item?.crop, item?.trimStart, item?.trimEnd]);

  // keep preview inside the in/out range
  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    const onTime = () => {
      setTime(v.currentTime);
      const end = outS || v.duration;
      if (v.currentTime > end || v.currentTime < inS - 0.1) v.currentTime = inS;
    };
    const onMeta = () => {
      setDuration(v.duration || 0);
      if (!outS) setOutS(v.duration || 0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    if (v.readyState >= 1) onMeta();
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [item?.id, inS, outS]);

  const startCrop = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ox = clamp01((e.clientX - rect.left) / rect.width);
    const oy = clamp01((e.clientY - rect.top) / rect.height);
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = clamp01((ev.clientX - rect.left) / rect.width);
      const y = clamp01((ev.clientY - rect.top) / rect.height);
      setCrop({
        x: Math.min(ox, x),
        y: Math.min(oy, y),
        w: Math.max(0.02, Math.abs(x - ox)),
        h: Math.max(0.02, Math.abs(y - oy)),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const applyCrop = () => {
    if (!item) return;
    p.onPatch(item.id, { crop: crop ?? undefined });
  };

  const stepFrame = (direction: -1 | 1) => {
    const video = vidRef.current;
    if (!video) return;
    video.pause();
    setPlaying(false);
    const end = outS || duration || video.duration;
    const nextTime = Math.max(
      inS,
      Math.min(end, video.currentTime + direction * FRAME_DURATION_SECONDS),
    );
    video.currentTime = nextTime;
    setTime(nextTime);
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col gap-3 overflow-y-auto bg-background/95 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={item?.id ?? ""} onValueChange={p.onSelect}>
          <SelectTrigger
            className="h-8 w-56"
            aria-label="Choose media to edit"
            title="Select an image or video to edit"
          >
            <SelectValue placeholder="Choose a photo or video" />
          </SelectTrigger>
          <SelectContent>
            {p.media.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {item && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            title={`Delete ${item.name}`}
            onClick={() => p.onDelete(item.id)}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        )}
        <p className="ml-auto text-xs text-muted-foreground">
          Drag on the picture to choose the part you want projected.
        </p>
      </div>

      {!item ? (
        <p className="text-sm text-muted-foreground">
          Add a photo or video in “My media”, then pick it here to crop, cut and sync it.
        </p>
      ) : (
        <>
          <div
            ref={frameRef}
            onPointerDown={startCrop}
            title="Drag across the image to define the crop area"
            className="relative mx-auto max-h-[46vh] w-full max-w-3xl cursor-crosshair touch-none select-none overflow-hidden rounded-lg border border-border bg-black"
          >
            {item.kind === "video" ? (
              <video
                ref={vidRef}
                data-media-editor-preview
                key={item.id}
                src={item.url}
                muted
                playsInline
                title="Preview video; use the controls below to step frame by frame"
                className="max-h-[46vh] w-full object-contain"
              />
            ) : (
              <img
                key={item.id}
                src={item.url}
                alt={item.name}
                className="max-h-[46vh] w-full object-contain"
              />
            )}
            {crop && (
              <div
                className="pointer-events-none absolute border-2 border-primary bg-primary/10"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`,
                }}
              />
            )}
          </div>

          <div className="mx-auto w-full max-w-3xl space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" title="Apply the selected crop to this media" onClick={applyCrop}>
                <CropIcon className="size-4" /> Use this crop
              </Button>
              <Button
                size="sm"
                variant="secondary"
                title="Clear the crop selection and use the whole frame"
                onClick={() => {
                  setCrop(null);
                  p.onPatch(item.id, { crop: undefined });
                }}
              >
                Whole frame
              </Button>
              {item.kind === "video" && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    title={
                      playing ? "Pause the preview" : "Play between the selected start and end"
                    }
                    onClick={() => {
                      const v = vidRef.current;
                      if (!v) return;
                      if (v.paused) {
                        v.currentTime = Math.max(inS, v.currentTime);
                        void v.play();
                        setPlaying(true);
                      } else {
                        v.pause();
                        setPlaying(false);
                      }
                    }}
                  >
                    {playing ? <Pause className="size-4" /> : <Play className="size-4" />} Preview
                    range
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Previous frame"
                    title="Previous frame (1/30 second)"
                    disabled={time <= inS}
                    onClick={() => stepFrame(-1)}
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Next frame"
                    title="Next frame (1/30 second)"
                    disabled={time >= (outS || duration)}
                    onClick={() => stepFrame(1)}
                  >
                    <ArrowRight className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label="Step one frame backward"
                    title="Step one frame backward"
                    onClick={() => {
                      const v = vidRef.current;
                      if (v) {
                        v.pause();
                        v.currentTime = Math.max(inS, v.currentTime - 1 / 30);
                        setPlaying(false);
                      }
                    }}
                  >
                    <ArrowLeft className="size-4" /> Frame
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label="Step one frame forward"
                    title="Step one frame forward"
                    onClick={() => {
                      const v = vidRef.current;
                      if (v) {
                        v.pause();
                        v.currentTime = Math.min(
                          outS || duration || Infinity,
                          v.currentTime + 1 / 30,
                        );
                        setPlaying(false);
                      }
                    }}
                  >
                    Frame <ArrowRight className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    title="Create a new media item from the selected range"
                    onClick={() => p.onSaveClip(item.id, crop ?? undefined, inS, outS || duration)}
                  >
                    <Scissors className="size-4" /> Save as clip
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    title="Apply the selected start and end times to this media"
                    onClick={() =>
                      p.onPatch(item.id, {
                        trimStart: inS,
                        trimEnd: outS || duration,
                      })
                    }
                  >
                    Trim this one
                  </Button>
                </>
              )}
            </div>

            {item.kind === "video" && duration > 0 && (
              <>
                <LabeledRow label="Start" value={formatTimeTenths(inS)}>
                  <Slider
                    title="Set the in-point of the video trim"
                    value={[inS]}
                    min={0}
                    max={duration}
                    step={FRAME_DURATION_SECONDS}
                    onValueChange={([v = 0]) => setInS(Math.min(v, (outS || duration) - 0.1))}
                  />
                </LabeledRow>
                <LabeledRow label="End" value={formatTimeTenths(outS || duration)}>
                  <Slider
                    title="Set the out-point of the video trim"
                    value={[outS || duration]}
                    min={0}
                    max={duration}
                    step={FRAME_DURATION_SECONDS}
                    onValueChange={([v = 0]) => setOutS(Math.max(v, inS + 0.1))}
                  />
                </LabeledRow>
                <p className="text-xs text-muted-foreground">
                  Playhead {formatTimeTenths(time)} · clip length{" "}
                  {formatTimeTenths(Math.max(0, (outS || duration) - inS))}
                </p>
              </>
            )}

            {item.kind === "video" && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Sync a separate sound
                </p>
                <Select
                  value={item.syncSoundId ?? "none"}
                  onValueChange={(v) =>
                    p.onPatch(item.id, { syncSoundId: v === "none" ? undefined : v })
                  }
                >
                  <SelectTrigger className="h-8" aria-label="Sound to sync">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No linked sound</SelectItem>
                    {p.sounds
                      .filter((s) => s.kind !== "video")
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {item.syncSoundId && (
                  <LabeledRow
                    label="Offset"
                    value={`${Math.round((item.syncOffset ?? 0) * 1000)} ms`}
                  >
                    <Slider
                      value={[item.syncOffset ?? 0]}
                      min={-2}
                      max={2}
                      step={0.01}
                      onValueChange={([v = 0]) => p.onPatch(item.id, { syncOffset: v })}
                    />
                  </LabeledRow>
                )}
                <p className="text-[11px] text-muted-foreground">
                  The linked sound starts and stops with this video, shifted by the offset.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
