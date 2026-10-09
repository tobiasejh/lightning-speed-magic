import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { silentLevels, type AudioLevelProvider } from "@/lib/audio";
import { drawPattern } from "@/lib/patterns";
import {
  mediaElements,
  mediaMeta,
  type Globals,
  type Surface,
  type TestPattern,
} from "@/lib/types";
import { quadMatrix } from "@/lib/warp";
import { visualById } from "@/lib/visuals";

type Props = {
  surface: Surface;
  index: number;
  stage: { w: number; h: number };
  globals: Globals;
  testPattern: TestPattern;
  levels: AudioLevelProvider | null;
};

const isVideoElement = (
  el: HTMLImageElement | HTMLVideoElement | undefined,
): el is HTMLVideoElement =>
  typeof HTMLVideoElement !== "undefined" && el instanceof HTMLVideoElement;

const fitVideo = (
  fit: Surface["fit"],
  crop: { x: number; y: number; w: number; h: number },
  source: { w: number; h: number },
  frame: { w: number; h: number },
): CSSProperties => {
  const safeCrop = {
    x: Math.max(0, Math.min(1, crop.x)),
    y: Math.max(0, Math.min(1, crop.y)),
    w: Math.max(0.01, Math.min(1, crop.w)),
    h: Math.max(0.01, Math.min(1, crop.h)),
  };

  // Tailwind's preflight sets `max-width: 100%` on every <video>. These videos are
  // deliberately sized larger than the frame (cover / crop) and clipped by the frame, so
  // that rule would clamp the width, squash the picture and leave the right-hand side of
  // the surface empty (the frame's grey background showing through).
  const unclamped = { maxWidth: "none", maxHeight: "none" } as const;

  if (fit === "stretch" || fit === "fill" || !source.w || !source.h) {
    return {
      position: "absolute",
      left: `${(-safeCrop.x / safeCrop.w) * 100}%`,
      top: `${(-safeCrop.y / safeCrop.h) * 100}%`,
      width: `${100 / safeCrop.w}%`,
      height: `${100 / safeCrop.h}%`,
      objectFit: "fill",
      ...unclamped,
    };
  }

  const croppedW = source.w * safeCrop.w;
  const croppedH = source.h * safeCrop.h;
  const scale = Math.max(frame.w / croppedW, frame.h / croppedH);
  const width = source.w * scale;
  const height = source.h * scale;

  return {
    position: "absolute",
    left: (frame.w - safeCrop.w * width) / 2 - safeCrop.x * width,
    top: (frame.h - safeCrop.h * height) / 2 - safeCrop.y * height,
    width,
    height,
    objectFit: "fill",
    ...unclamped,
  };
};

export function SurfaceLayer({ surface, index, stage, globals, testPattern, levels }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoFrameRef = useRef<HTMLDivElement | null>(null);
  const [mediaVersion, setMediaVersion] = useState(0);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const latest = useRef({ surface, globals, levels, testPattern, index });
  latest.current = { surface, globals, levels, testPattern, index };

  const mediaId = surface.source.startsWith("media:") ? surface.source.slice(6) : null;
  const media = mediaId ? mediaElements.get(mediaId) : undefined;
  const meta = mediaId ? mediaMeta.get(mediaId) : undefined;
  const directVideo = testPattern === "off" && isVideoElement(media);
  const drawCanvas = !directVideo;

  useEffect(() => {
    if (!mediaId) return;
    let raf = 0;
    let tries = 0;
    const check = () => {
      const el = mediaElements.get(mediaId);
      if (el) {
        setMediaVersion((v) => v + 1);
        return;
      }
      tries += 1;
      if (tries < 120) raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [mediaId]);

  useEffect(() => {
    if (!drawCanvas) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let clock = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const { surface: s, globals: g, levels: lv, testPattern: tp, index: idx } = latest.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt * g.speed;

      const w = canvas.width;
      const h = canvas.height;

      if (tp !== "off") {
        drawPattern(ctx, w, h, tp, String(idx + 1));
        return;
      }

      const audio = g.audioReactive && lv ? lv(s.audioSource) : silentLevels;

      ctx.save();
      // flip / rotate around centre
      ctx.translate(w / 2, h / 2);
      ctx.rotate((s.rotate * Math.PI) / 180);
      ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
      const swap = s.rotate % 180 !== 0;
      const cw = swap ? h : w;
      const chh = swap ? w : h;
      ctx.translate(-cw / 2, -chh / 2);

      if (s.source.startsWith("media:")) {
        const mediaId = s.source.slice(6);
        const el = mediaElements.get(mediaId);
        const meta = mediaMeta.get(mediaId);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, cw, chh);
        if (el && !isVideoElement(el)) {
          const iw = el.naturalWidth;
          const ih = el.naturalHeight;
          if (iw && ih) {
            const crop = meta?.crop;
            const sx = crop ? crop.x * iw : 0;
            const sy = crop ? crop.y * ih : 0;
            const sw = crop ? crop.w * iw : iw;
            const sh = crop ? crop.h * ih : ih;
            const pulse = 1 + audio.bass * 0.08;
            try {
              if (s.fit === "stretch" || s.fit === "fill") {
                const dw = cw * pulse;
                const dh = chh * pulse;
                ctx.drawImage(el, sx, sy, sw, sh, (cw - dw) / 2, (chh - dh) / 2, dw, dh);
              } else {
                const scale = Math.max(cw / sw, chh / sh) * pulse;
                const dw = sw * scale;
                const dh = sh * scale;
                ctx.drawImage(el, sx, sy, sw, sh, (cw - dw) / 2, (chh - dh) / 2, dw, dh);
              }
            } catch {
              /* frame not ready */
            }
          }
        }
      } else {
        visualById(s.source.slice(7)).draw({
          ctx,
          w: cw,
          h: chh,
          t: clock,
          intensity: g.intensity,
          hue: g.hue + s.hueShift,
          audio,
        });
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [drawCanvas]);

  useEffect(() => {
    if (!directVideo || !mediaId) return;
    const video = videoRef.current;
    const source = mediaElements.get(mediaId);
    if (!video || !isVideoElement(source)) return;

    const src = source.currentSrc || source.src;
    if (video.src !== src) video.src = src;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";

    const noteSize = () => {
      if (source.videoWidth && source.videoHeight)
        setVideoSize({ w: source.videoWidth, h: source.videoHeight });
      else if (video.videoWidth && video.videoHeight)
        setVideoSize({ w: video.videoWidth, h: video.videoHeight });
    };

    // The visible <video> is a second decoder that follows the hidden `source` clock.
    // Hard seeks on a playing MP4 are slow (jump to a keyframe, decode forward), so:
    //  - small drift is corrected by nudging playbackRate, not by seeking
    //  - big drift triggers one seek, then a cooldown, and never a seek during a seek
    // Otherwise a seek that takes >100 ms leaves the gap open, the next tick seeks
    // again, and playback stutters in a loop.
    const HARD_SEEK_DRIFT = 0.4; // seconds
    const NUDGE_DRIFT = 0.04; // seconds
    const NUDGE_RATE = 0.05; // +/-5% speed while catching up
    const SEEK_COOLDOWN_MS = 1000;
    let lastSeekAt = 0;

    const setRate = (rate: number) => {
      if (Math.abs(video.playbackRate - rate) > 0.001) video.playbackRate = rate;
    };

    const sync = () => {
      const liveMeta = mediaMeta.get(mediaId);
      const start = liveMeta?.trimStart ?? 0;
      const end = liveMeta?.trimEnd ?? source.duration ?? 0;
      const trimmed = !!(liveMeta?.trimStart || liveMeta?.trimEnd);
      if (
        !source.seeking &&
        end > start &&
        (source.currentTime > end || source.currentTime < start - 0.05)
      )
        source.currentTime = start;

      const baseRate = source.playbackRate || 1;
      const wanted = source.currentTime || start;
      if (Number.isFinite(wanted) && !source.seeking) {
        const drift = wanted - video.currentTime; // > 0: visible video is behind
        const abs = Math.abs(drift);
        const duration = source.duration;
        // both elements loop on their own: right at the wrap they briefly disagree by
        // about one full duration and then converge by themselves, so don't seek for it
        const wrapped =
          !trimmed && Number.isFinite(duration) && duration > 1 && abs > duration - 0.5;
        const now = performance.now();

        if (abs > HARD_SEEK_DRIFT && !wrapped) {
          if (!video.seeking && now - lastSeekAt > SEEK_COOLDOWN_MS) {
            video.currentTime = wanted;
            lastSeekAt = now;
          }
          setRate(baseRate);
        } else if (abs > NUDGE_DRIFT && !wrapped) {
          setRate(baseRate * (drift > 0 ? 1 + NUDGE_RATE : 1 - NUDGE_RATE));
        } else {
          setRate(baseRate);
        }
      } else {
        setRate(baseRate);
      }

      if (source.paused) {
        if (!video.paused) video.pause();
      } else if (video.paused) {
        void video.play().catch(() => undefined);
      }
      noteSize();
    };

    noteSize();
    source.addEventListener("loadedmetadata", noteSize);
    video.addEventListener("loadedmetadata", noteSize);
    sync();
    const timer = window.setInterval(sync, 100);

    return () => {
      window.clearInterval(timer);
      source.removeEventListener("loadedmetadata", noteSize);
      video.removeEventListener("loadedmetadata", noteSize);
      video.pause();
    };
  }, [directVideo, mediaId, mediaVersion]);

  useEffect(() => {
    if (!directVideo) return;
    let raf = 0;
    let lastTransform = "";

    const frame = () => {
      const el = videoFrameRef.current;
      if (el) {
        const { surface: s, globals: g, levels: lv } = latest.current;
        const bass = g.audioReactive && lv ? lv(s.audioSource).bass : silentLevels.bass;
        const pulse = 1 + bass * 0.08;
        const rotation = ((s.rotate % 360) + 360) % 360;
        const transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${(s.flipH ? -1 : 1) * pulse}, ${(s.flipV ? -1 : 1) * pulse})`;
        // only touch the DOM when it changes (in the output window the pulse is always 1),
        // so the compositor isn't invalidated every frame for nothing
        if (transform !== lastTransform) {
          lastTransform = transform;
          el.style.transform = transform;
        }
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [directVideo]);

  const px = surface.corners.map((c) => ({ x: c.x * stage.w, y: c.y * stage.h }));
  const rotate = ((surface.rotate % 360) + 360) % 360;
  const swap = rotate % 180 !== 0;
  const frame = {
    w: Math.max(1, swap ? stage.h : stage.w),
    h: Math.max(1, swap ? stage.w : stage.h),
  };
  const sourceSize = {
    w: isVideoElement(media) ? media.videoWidth || videoSize.w : videoSize.w,
    h: isVideoElement(media) ? media.videoHeight || videoSize.h : videoSize.h,
  };
  const crop = meta?.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const videoStyle = useMemo(
    () => fitVideo(surface.fit, crop, sourceSize, frame),
    [surface.fit, crop.x, crop.y, crop.w, crop.h, sourceSize.w, sourceSize.h, frame.w, frame.h],
  );
  const videoSrc = isVideoElement(media) ? media.currentSrc || media.src : undefined;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: stage.w || 1,
        height: stage.h || 1,
        transformOrigin: "0 0",
        transform: quadMatrix(stage.w || 1, stage.h || 1, px),
        opacity: globals.blackout || !surface.visible ? 0 : surface.opacity,
        filter: `brightness(${globals.brightness})`,
        pointerEvents: "none",
        transition: "opacity 120ms linear",
        clipPath:
          surface.outline && surface.outline.length > 4
            ? `polygon(${surface.outline.map((o) => `${o.u * 100}% ${o.v * 100}%`).join(", ")})`
            : undefined,
      }}
    >
      {drawCanvas ? (
        <canvas
          ref={canvasRef}
          width={Math.max(64, Math.min(3840, Math.round(surface.renderW || 1280)))}
          height={Math.max(64, Math.min(2160, Math.round(surface.renderH || 720)))}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      ) : (
        <div
          ref={videoFrameRef}
          className="absolute overflow-hidden bg-background"
          style={{
            left: "50%",
            top: "50%",
            width: frame.w,
            height: frame.h,
            transformOrigin: "50% 50%",
            transform: `translate(-50%, -50%) rotate(${rotate}deg) scale(${surface.flipH ? -1 : 1}, ${surface.flipV ? -1 : 1})`,
          }}
        >
          <video ref={videoRef} src={videoSrc} muted playsInline loop style={videoStyle} />
        </div>
      )}
    </div>
  );
}
