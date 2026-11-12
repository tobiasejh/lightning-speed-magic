import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { GRID_H, GRID_W } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { CameraTracking } from "./useCameraTracking";

/** The grid is drawn a little bigger than one pixel per cell, so the cells keep sharp edges. */
const CELL = 4;
/** The overlay is for the eye; it does not need the camera's frame rate. */
const DRAW_MS = 80;

type Props = {
  tracking: CameraTracking;
  /** draw the cells with movement over the picture */
  grid?: boolean;
  className?: string;
  /** drawn over the picture, positioned in percent of it */
  children?: ReactNode;
};

/** The live camera picture at its own shape, with the movement grid on top. */
export function CameraView({ tracking, grid = true, className, children }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const gridRef = useRef<HTMLCanvasElement | null>(null);
  const [aspect, setAspect] = useState(4 / 3);
  const { stream, sensor } = tracking;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const canvas = gridRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !stream || !grid) return;
    let raf = 0;
    let drawnAt = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      // a closed menu section keeps this mounted but hidden: nothing to draw for
      if (now - drawnAt < DRAW_MS || canvas.offsetParent === null) return;
      drawnAt = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cells = sensor.current?.cells;
      if (!cells) return;
      ctx.fillStyle = "rgba(77, 216, 255, 0.55)";
      for (let i = 0; i < cells.length; i++) {
        if (cells[i]) {
          ctx.fillRect((i % GRID_W) * CELL, Math.floor(i / GRID_W) * CELL, CELL - 1, CELL - 1);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [stream, sensor, grid]);

  return (
    <div
      className={cn("relative overflow-hidden rounded bg-black", className)}
      // the variable lets a parent size the picture to fit a box in both directions
      style={{ aspectRatio: aspect, "--camera-aspect": aspect } as CSSProperties}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        className="absolute inset-0 size-full"
        onLoadedMetadata={(event) => {
          const { videoWidth, videoHeight } = event.currentTarget;
          if (videoWidth && videoHeight) setAspect(videoWidth / videoHeight);
        }}
      />
      <canvas
        ref={gridRef}
        width={GRID_W * CELL}
        height={GRID_H * CELL}
        className="pointer-events-none absolute inset-0 size-full"
        style={{ imageRendering: "pixelated" }}
      />
      {children}
    </div>
  );
}
