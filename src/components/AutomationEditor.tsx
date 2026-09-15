import { X } from "lucide-react";

import { AutomationLane } from "@/components/AutomationLane";
import { Button } from "@/components/ui/button";
import { pathDuration } from "@/lib/timeline";
import type { SoundPath, TimelineClip } from "@/lib/types";

type Props = {
  path: SoundPath;
  clip: TimelineClip;
  /** show time in seconds, for the playhead */
  time: number;
  peaks?: number[] | undefined;
  onPatchPath: (path: SoundPath) => void;
  onClose: () => void;
};

const LANE_HEIGHT = 200;

/** Full-screen version of the movement lanes, with a ruler and the show playhead. */
export function AutomationEditor({ path, clip, time, peaks, onPatchPath, onClose }: Props) {
  const span = Math.max(0.5, clip.duration);
  const pixelsPerSecond = Math.max(80, Math.min(400, 1200 / span));
  const width = Math.round(span * pixelsPerSecond);
  const playhead = Math.max(0, Math.min(span, time - clip.start)) * pixelsPerSecond;
  const ticks = Math.ceil(span * 2) + 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/98 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{path.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {path.nodes.length} points · movement {pathDuration(path).toFixed(2)}s · clip{" "}
            {clip.duration.toFixed(2)}s · drag a point up/down to move the sound, sideways to retime
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={onClose}>
          <X /> Close
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="relative inline-block min-w-full" style={{ width }}>
          <div className="relative mb-1 h-5" style={{ width }}>
            {Array.from({ length: ticks }, (_, index) => (
              <span
                key={index}
                className="absolute top-0 text-[10px] tabular-nums text-muted-foreground"
                style={{ left: index * 0.5 * pixelsPerSecond }}
              >
                {(index * 0.5).toFixed(1)}s
              </span>
            ))}
          </div>
          <div className="space-y-4">
            {(["x", "y"] as const).map((axis) => (
              <AutomationLane
                key={axis}
                axis={axis}
                path={path}
                span={span}
                width={width}
                height={LANE_HEIGHT}
                peaks={peaks}
                onPatchPath={onPatchPath}
              />
            ))}
          </div>
          <div
            className="pointer-events-none absolute bottom-0 top-5 w-px bg-destructive"
            style={{ left: playhead }}
          />
        </div>
      </div>
    </div>
  );
}
