import { useEffect, useRef } from "react";

import { silentLevels, type MicAnalyser } from "@/lib/audio";
import { mediaElements, type Globals, type Surface } from "@/lib/types";
import { quadMatrix } from "@/lib/warp";
import { visualById } from "@/lib/visuals";

type Props = {
  surface: Surface;
  stage: { w: number; h: number };
  globals: Globals;
  mic: MicAnalyser | null;
};

export function SurfaceLayer({ surface, stage, globals, mic }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef({ surface, globals, mic });
  latest.current = { surface, globals, mic };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let clock = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const { surface: s, globals: g, mic: m } = latest.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt * g.speed;

      const w = canvas.width;
      const h = canvas.height;
      const audio = g.audioReactive && m?.active ? m.levels : silentLevels;

      if (s.source.startsWith("media:")) {
        const el = mediaElements.get(s.source.slice(6));
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        if (el) {
          const iw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
          const ih = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
          if (iw && ih) {
            const scale = Math.max(w / iw, h / ih) * (1 + audio.bass * 0.08);
            const dw = iw * scale;
            const dh = ih * scale;
            try {
              ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
            } catch {
              /* frame not ready */
            }
          }
        }
      } else {
        visualById(s.source.slice(7)).draw({
          ctx,
          w,
          h,
          t: clock,
          intensity: g.intensity,
          hue: g.hue + s.hueShift,
          audio,
        });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const px = surface.corners.map((c) => ({ x: c.x * stage.w, y: c.y * stage.h }));


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
      }}
    >
      <canvas
        ref={canvasRef}
        width={640}
        height={360}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
