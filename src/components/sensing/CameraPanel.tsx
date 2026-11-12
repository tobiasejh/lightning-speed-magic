import { Crosshair, Video, VideoOff } from "lucide-react";

import { LabeledRow } from "@/components/common/LabeledRow";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { CameraConfig, OutputScreen, Surface } from "@/lib/types";

import { CameraView } from "./CameraView";
import type { CameraTracking } from "./useCameraTracking";

type Props = {
  tracking: CameraTracking;
  camera: CameraConfig;
  onCamera: (patch: Partial<CameraConfig>) => void;
  outputs: OutputScreen[];
  surfaces: Surface[];
  onCalibrate: () => void;
};

/** Menu panel for the camera that watches the projection. */
export function CameraPanel({ tracking, camera, onCamera, outputs, surfaces, onCalibrate }: Props) {
  const { on, devices, activeIds, error } = tracking;
  const output = outputs.find((o) => o.id === camera.outputId) ?? outputs[0];
  const deviceId = tracking.deviceId ?? camera.deviceId;
  const moving = surfaces.filter((surface) => activeIds.includes(surface.id));

  return (
    <>
      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div className="flex items-center gap-2 text-sm">
          {on ? (
            <Video className="size-4 text-primary" />
          ) : (
            <VideoOff className="size-4 text-muted-foreground" />
          )}
          Camera
        </div>
        <Switch
          checked={on}
          onCheckedChange={tracking.toggle}
          aria-label="Toggle camera input"
          title="Turn the camera that watches the projection on or off"
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {on && (
        <>
          {devices.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="shrink-0 text-muted-foreground">Device</span>
              <Select
                // an empty value shows the placeholder
                value={devices.find((d) => d.deviceId === deviceId)?.deviceId ?? ""}
                onValueChange={(v) => onCamera({ deviceId: v })}
              >
                <SelectTrigger className="h-8 min-w-0 flex-1" aria-label="Camera device">
                  <SelectValue placeholder="Choose a camera" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((d, i) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${i + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <CameraView tracking={tracking} className="w-full">
            {camera.corners && (
              <svg
                className="pointer-events-none absolute inset-0 size-full"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
              >
                <polygon
                  points={camera.corners.map((c) => `${c.x},${c.y}`).join(" ")}
                  className="fill-none stroke-primary"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </CameraView>
          <p className="text-[10px] text-muted-foreground">
            Blue cells are where the camera sees movement.
            {camera.corners ? " The outline is the projected picture." : ""}
          </p>

          <LabeledRow
            className="space-y-2"
            valueClassName="text-foreground"
            label="Sensitivity"
            value={`${Math.round(camera.sensitivity * 100)}%`}
          >
            <Slider
              title="Set how small a change in the camera picture counts as movement"
              value={[camera.sensitivity]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={([v = 0]) => onCamera({ sensitivity: v })}
            />
          </LabeledRow>
        </>
      )}

      <div className="space-y-2 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Calibration</span>
          <span className={camera.corners ? "text-foreground" : "text-muted-foreground"}>
            {camera.corners ? `Set for ${output?.name ?? "the projector"}` : "Not set"}
          </span>
        </div>
        {outputs.length > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="shrink-0 text-muted-foreground">Camera sees</span>
            <Select
              value={output?.id ?? camera.outputId}
              // the old corners marked another projector's picture
              onValueChange={(v) => onCamera({ outputId: v, corners: null })}
            >
              <SelectTrigger className="h-8 flex-1" aria-label="Projector the camera sees">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {outputs.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          One camera watches the picture of one projector
          {outputs.length > 1 ? ". Surfaces on the other projectors are not tracked." : "."}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            disabled={!on}
            title={
              on
                ? "Mark where the projected picture is in the camera image"
                : "Turn the camera on to calibrate"
            }
            onClick={onCalibrate}
          >
            <Crosshair className="size-4" />
            {camera.corners ? "Recalibrate" : "Calibrate"}
          </Button>
          {camera.corners && (
            <Button
              size="sm"
              variant="ghost"
              title="Forget where the projected picture is"
              onClick={() => onCamera({ corners: null })}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {on && camera.corners && (
        <p className="text-xs text-muted-foreground">
          {moving.length ? (
            <>
              Movement on{" "}
              <span className="text-foreground">{moving.map((s) => s.name).join(", ")}</span>
            </>
          ) : (
            "No movement on a surface."
          )}
        </p>
      )}
    </>
  );
}
