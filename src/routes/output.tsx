import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { SurfaceLayer } from "@/components/stage/SurfaceLayer";
import { paintBlend } from "@/lib/blend";
import {
  createVideo,
  releaseMediaElements,
  releaseVideo,
  updateVideoPlayback,
  usedVideoIds,
  videoOwners,
} from "@/lib/media-playback";
import { openChannel, type OutputSnapshot, type SyncMessage } from "@/lib/sync";
import {
  defaultBlend,
  defaultRegion,
  defaultGlobals,
  mediaElements,
  mediaMeta,
  type BlendConfig,
} from "@/lib/types";

const title = "Prism Output — Projector Screen";
const description =
  "The projector-only view of your Prism projection mapping show. Drag this window onto the projector and click for fullscreen.";

export const Route = createFileRoute("/output")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OutputPage,
});

export function OutputPage() {
  const [snap, setSnap] = useState<OutputSnapshot>({
    surfaces: [],
    globals: defaultGlobals(),
    testPattern: "grid",
    media: [],
  });
  const [outputId, setOutputId] = useState("out1");
  const [connected, setConnected] = useState(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setOutputId(new URLSearchParams(window.location.search).get("id") || "out1");
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setStage({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const ch = openChannel();
    if (!ch) return;
    const id = new URLSearchParams(window.location.search).get("id") || "out1";
    let surfaces: OutputSnapshot["surfaces"] = [];
    let testPattern: OutputSnapshot["testPattern"] = "grid";
    let clockVideos = new Set<string>();
    // A local copy: the `connected` state seen by the timer below would stay false forever,
    // and every "hello" makes the editor send all media and state to every window again.
    let linked = false;
    // only what this projector shows runs here, not everything in the show
    const updatePlayback = () =>
      updateVideoPlayback(usedVideoIds(surfaces, testPattern), clockVideos);
    ch.onmessage = (e: MessageEvent<SyncMessage>) => {
      const msg = e.data;
      if (msg.type === "state") {
        setSnap(msg.snapshot);
        for (const m of msg.snapshot.media) mediaMeta.set(m.id, m);
        setConnected(true);
        linked = true;
        surfaces = msg.snapshot.surfaces.filter((s) => (s.outputId || "out1") === id);
        testPattern = msg.snapshot.testPattern;
        updatePlayback();
      } else if (msg.type === "clock") {
        const used = usedVideoIds(surfaces, testPattern);
        clockVideos = new Set();
        // follow the editor timeline instead of looping on our own
        for (const [mediaId, at] of Object.entries(msg.videos)) {
          const el = mediaElements.get(mediaId);
          // a clip on another projector's surface is that window's job
          if (!(el instanceof HTMLVideoElement) || !used.has(mediaId)) continue;
          clockVideos.add(mediaId);
          // Clock messages arrive a few times a second and can be delayed when the editor
          // is busy. Only hard-seek on real drift, and never on top of a seek in flight:
          // every seek here also makes the visible <video> re-seek to follow this clock.
          if (!el.seeking && Math.abs(el.currentTime - at) > 0.5) el.currentTime = at;
          if (msg.playing) {
            if (el.paused) void el.play().catch(() => undefined);
          } else if (!el.paused) {
            el.pause();
          }
        }
        updatePlayback();
      } else if (msg.type === "drop-media") {
        for (const dropped of msg.ids) {
          const el = mediaElements.get(dropped);
          mediaElements.delete(dropped);
          mediaMeta.delete(dropped);
          if (el) URL.revokeObjectURL(el.src);
          if (el instanceof HTMLVideoElement) releaseVideo(el);
        }
      } else if (msg.type === "media") {
        for (const { meta, file } of msg.items) {
          mediaMeta.set(meta.id, meta);
          if (mediaElements.has(meta.id)) continue;
          const url = URL.createObjectURL(file);
          if (meta.kind === "video") {
            mediaElements.set(meta.id, createVideo(url));
          } else {
            const img = new Image();
            img.src = url;
            mediaElements.set(meta.id, img);
          }
        }
        updatePlayback();
      } else if (msg.type === "bye") {
        setConnected(false);
        linked = false;
      }
    };
    ch.postMessage({ type: "hello", outputId: id } satisfies SyncMessage);
    const ping = setInterval(() => {
      if (!linked) ch.postMessage({ type: "hello", outputId: id } satisfies SyncMessage);
    }, 2000);
    return () => {
      clearInterval(ping);
      ch.close();
      releaseMediaElements();
      mediaMeta.clear();
    };
  }, []);

  const output = useMemo(
    () => snap.outputs?.find((o) => o.id === outputId) ?? null,
    [snap.outputs, outputId],
  );
  const region = output?.region ?? defaultRegion();
  // Every snapshot from the editor arrives as a fresh object (and defaultBlend() builds a
  // new one per render), so key the blend by its content. Otherwise the full-screen mask
  // below is resized and repainted on every message, which is heavy on the GPU.
  const blendKey = JSON.stringify(output?.blend ?? null);
  const blend = useMemo<BlendConfig>(
    () => (JSON.parse(blendKey) as BlendConfig | null) ?? defaultBlend(),
    [blendKey],
  );

  // the shared canvas is bigger than this window; we show our slice of it
  const canvas = useMemo(
    () => ({
      w: stage.w / Math.max(0.05, region.w),
      h: stage.h / Math.max(0.05, region.h),
    }),
    [stage.w, stage.h, region.w, region.h],
  );
  // the sound lives in the editor window, so nothing here reacts to it
  const globals = useMemo(() => ({ ...snap.globals, audioReactive: false }), [snap.globals]);

  useEffect(() => {
    const el = maskRef.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const w = Math.max(1, Math.round(stage.w));
    const h = Math.max(1, Math.round(stage.h));
    // assigning width/height reallocates the canvas even when the value is unchanged
    if (el.width !== w) el.width = w;
    if (el.height !== h) el.height = h;
    paintBlend(ctx, w, h, blend);
  }, [stage.w, stage.h, blend]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  const mine = useMemo(
    () => snap.surfaces.filter((s) => (s.outputId || "out1") === outputId),
    [snap.surfaces, outputId],
  );
  const owners = useMemo(() => videoOwners(mine), [mine]);

  return (
    <div
      ref={stageRef}
      onClick={toggleFullscreen}
      className="relative h-screen w-screen cursor-none select-none overflow-hidden bg-black"
    >
      <div
        className="absolute"
        style={{
          left: -region.x * canvas.w,
          top: -region.y * canvas.h,
          width: canvas.w || 1,
          height: canvas.h || 1,
        }}
      >
        {[...mine].reverse().map((s) => (
          <SurfaceLayer
            key={s.id}
            surface={s}
            index={mine.findIndex((surface) => surface.id === s.id)}
            stage={canvas}
            globals={globals}
            testPattern={snap.testPattern}
            levels={null}
            ownsVideo={owners.get(s.source) === s.id}
          />
        ))}
      </div>
      {output?.blendTest && (
        <div className="absolute inset-0" style={{ background: "rgb(128,128,128)" }} />
      )}
      <canvas ref={maskRef} className="pointer-events-none absolute inset-0 size-full" />
      {!connected && (
        <p className="absolute inset-x-0 bottom-6 text-center text-xs text-muted-foreground">
          Waiting for the Prism control window… keep both windows open. Click to go fullscreen.
        </p>
      )}
    </div>
  );
}
