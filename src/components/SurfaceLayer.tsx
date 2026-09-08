import { useEffect, useRef } from "react";

import { silentLevels, type AudioLevelProvider } from "@/lib/audio";
import { drawPattern } from "@/lib/patterns";
import { mediaElements, type Globals, type Surface, type TestPattern } from "@/lib/types";
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

export function SurfaceLayer({ surface, index, stage, globals, testPattern, levels }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef({ surface, globals, levels, testPattern, index });
  latest.current = { surface, globals, levels, testPattern, index };

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
        const el = mediaElements.get(s.source.slice(6));
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, cw, chh);
        if (el) {
          const iw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
          const ih = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
          if (iw && ih) {
            const pulse = 1 + audio.bass * 0.08;
            try {
              if (s.fit === "stretch") {
                const dw = cw * pulse;
                const dh = chh * pulse;
                ctx.drawImage(el, (cw - dw) / 2, (chh - dh) / 2, dw, dh);
              } else {
                const scale = Math.max(cw / iw, chh / ih) * pulse;
                const dw = iw * scale;
                const dh = ih * scale;
                ctx.drawImage(el, (cw - dw) / 2, (chh - dh) / 2, dw, dh);
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
