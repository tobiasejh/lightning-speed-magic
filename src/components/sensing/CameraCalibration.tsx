import { useState, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { defaultCameraCorners } from "@/lib/motion";
import type { CameraConfig, OutputScreen } from "@/lib/types";
import { clampPoint, type Pt } from "@/lib/warp";

import { CameraView } from "./CameraView";
import type { CameraTracking } from "./useCameraTracking";

type Props = {
  tracking: CameraTracking;
  camera: CameraConfig;
  outputs: OutputScreen[];
  onSave: (corners: Pt[]) => void;
  onCancel: () => void;
};

/**
 * Covers the stage while the projector shows the numbered test pattern: the four handles
 * are dragged onto the corners of the projected picture as the camera sees it.
 */
export function CameraCalibration({ tracking, camera, outputs, onSave, onCancel }: Props) {
  const [corners, setCorners] = useState<Pt[]>(() => camera.corners ?? defaultCameraCorners());
  const output = outputs.find((o) => o.id === camera.outputId) ?? outputs[0];
  const name = output?.name ?? "The projector";

  const drag = (index: number) => (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // the handles sit directly in the camera picture, which is what they are measured against
    const picture = event.currentTarget.parentElement;
    const move = (e: globalThis.PointerEvent) => {
      const rect = picture?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return;
      const point = clampPoint({
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      });
      setCorners((prev) => prev.map((corner, i) => (i === index ? point : corner)));
    };
    const target = event.currentTarget;
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col gap-3 bg-background/95 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-sm font-semibold">Calibrate the camera</h2>
          <p className="text-xs text-muted-foreground">
            {name} now shows a test pattern with a number in each corner. Drag each point onto the
            corner with the same number, as the camera sees it. Open the projector window first if
            the pattern is not showing.
          </p>
          <p className="text-xs text-muted-foreground">
            One camera watches the picture of one projector. Keep the camera still afterwards: if it
            or the projector moves, calibrate again.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(corners)}>
          Save calibration
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center [container-type:size]">
        {tracking.stream ? (
          <CameraView
            tracking={tracking}
            grid={false}
            // as big as fits, whichever of width or height runs out first
            className="w-[min(100cqw,calc(100cqh*var(--camera-aspect)))]"
          >
            <svg
              className="pointer-events-none absolute inset-0 size-full"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
            >
              <polygon
                points={corners.map((c) => `${c.x},${c.y}`).join(" ")}
                className="fill-primary/10 stroke-primary"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {corners.map((c, i) => (
              <div
                key={i}
                onPointerDown={drag(i)}
                className="absolute z-10 grid size-7 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center rounded-full border-2 border-primary bg-primary/30 text-[10px] font-bold text-foreground active:cursor-grabbing"
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
              >
                {i + 1}
              </div>
            ))}
          </CameraView>
        ) : (
          <p className="text-sm text-muted-foreground">
            The camera is off. Turn it on in the Camera section of the menu.
          </p>
        )}
      </div>
    </div>
  );
}
