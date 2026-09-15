import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { SurfaceLayer } from "@/components/SurfaceLayer";
import { paintBlend } from "@/lib/blend";
import { openChannel, type OutputSnapshot, type SyncMessage } from "@/lib/sync";
import { defaultBlend, defaultRegion, defaultGlobals, mediaElements, mediaMeta } from "@/lib/types";

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

function OutputPage() {
  const [snap, setSnap] = useState<OutputSnapshot>({
    surfaces: [],
    globals: defaultGlobals(),
    testPattern: "off",
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
    const urls: string[] = [];
    const id = new URLSearchParams(window.location.search).get("id") || "out1";
    ch.onmessage = (e: MessageEvent<SyncMessage>) => {
      const msg = e.data;
      if (msg.type === "state") {
        setSnap(msg.snapshot);
        for (const m of msg.snapshot.media) mediaMeta.set(m.id, m);
        setConnected(true);
      } else if (msg.type === "clock") {
        // follow the editor timeline instead of looping on our own
        for (const [mediaId, at] of Object.entries(msg.videos)) {
          const el = mediaElements.get(mediaId);
          if (!(el instanceof HTMLVideoElement)) continue;
          if (Math.abs(el.currentTime - at) > 0.25) el.currentTime = at;
          if (msg.playing) void el.play().catch(() => undefined);
          else el.pause();
        }
      } else if (msg.type === "drop-media") {
        for (const dropped of msg.ids) {
          const el = mediaElements.get(dropped);
          if (el instanceof HTMLVideoElement) el.pause();
          mediaElements.delete(dropped);
          mediaMeta.delete(dropped);
        }
      } else if (msg.type === "media") {
        for (const { meta, file } of msg.items) {
          mediaMeta.set(meta.id, meta);
          if (mediaElements.has(meta.id)) continue;
          const url = URL.createObjectURL(file);
          urls.push(url);
          if (meta.kind === "video") {
            const v = document.createElement("video");
            v.src = url;
            v.loop = true;
            v.muted = true;
            v.playsInline = true;
            void v.play();
            mediaElements.set(meta.id, v);
          } else {
            const img = new Image();
            img.src = url;
            mediaElements.set(meta.id, img);
          }
        }
      } else if (msg.type === "bye") {
        setConnected(false);
      }
    };
    ch.postMessage({ type: "hello", outputId: id } satisfies SyncMessage);
    const ping = setInterval(() => {
      if (!connected) ch.postMessage({ type: "hello", outputId: id } satisfies SyncMessage);
    }, 2000);
    return () => {
      clearInterval(ping);
      ch.close();
      urls.forEach((u) => URL.revokeObjectURL(u));
      mediaElements.clear();
      mediaMeta.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const output = useMemo(
    () => snap.outputs?.find((o) => o.id === outputId) ?? null,
    [snap.outputs, outputId],
  );
  const region = output?.region ?? defaultRegion();
  const blend = output?.blend ?? defaultBlend();

  // the shared canvas is bigger than this window; we show our slice of it
  const canvas = {
    w: stage.w / Math.max(0.05, region.w),
    h: stage.h / Math.max(0.05, region.h),
  };

  useEffect(() => {
    const el = maskRef.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    el.width = Math.max(1, Math.round(stage.w));
    el.height = Math.max(1, Math.round(stage.h));
    paintBlend(ctx, el.width, el.height, blend);
  }, [stage.w, stage.h, blend]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  const mine = snap.surfaces.filter((s) => (s.outputId || "out1") === outputId);

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
        {mine.map((s, i) => (
          <SurfaceLayer
            key={s.id}
            surface={s}
            index={i}
            stage={canvas}
            globals={{ ...snap.globals, audioReactive: false }}
            testPattern={snap.testPattern}
            levels={null}
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
