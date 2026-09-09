import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SurfaceLayer } from "@/components/SurfaceLayer";
import { openChannel, type OutputSnapshot, type SyncMessage } from "@/lib/sync";
import { defaultGlobals, mediaElements, mediaMeta } from "@/lib/types";

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
      {mine.map((s, i) => (
        <SurfaceLayer
          key={s.id}
          surface={s}
          index={i}
          stage={stage}
          globals={{ ...snap.globals, audioReactive: false }}
          testPattern={snap.testPattern}
          levels={null}
        />
      ))}
      {!connected && (
        <p className="absolute inset-x-0 bottom-6 text-center text-xs text-muted-foreground">
          Waiting for the Prism control window… keep both windows open. Click to go fullscreen.
        </p>
      )}
    </div>
  );
}
