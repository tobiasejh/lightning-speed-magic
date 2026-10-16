import { ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { OutputScreen } from "@/lib/types";

const EDGES = ["left", "right", "top", "bottom"] as const;

export function ProjectorRow({
  output,
  live,
  canRemove,
  onOpen,
  onRemove,
  onPatch,
}: {
  output: OutputScreen;
  live: boolean;
  canRemove: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onPatch: (next: Partial<OutputScreen>) => void;
}) {
  const [open, setOpen] = useState(false);
  const pct = (value: number) => Math.round(value * 100);
  const region = (key: "x" | "y" | "w" | "h", value: number) =>
    onPatch({ region: { ...output.region, [key]: Math.max(0, Math.min(1, value / 100)) } });
  return (
    <div className="rounded border border-border p-2">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-sm">{output.name}</span>
        <Button size="sm" variant={open ? "default" : "secondary"} onClick={() => setOpen(!open)}>
          Setup
        </Button>
        <Button size="sm" variant={live ? "default" : "secondary"} onClick={onOpen}>
          <ExternalLink />
          {live ? "Live" : "Open"}
        </Button>
        {canRemove && (
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Remove projector"
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-4 gap-1">
            {(["x", "y", "w", "h"] as const).map((key) => (
              <label key={key} className="text-[10px] text-muted-foreground">
                {key === "x"
                  ? "Left %"
                  : key === "y"
                    ? "Top %"
                    : key === "w"
                      ? "Width %"
                      : "Tall %"}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={pct(output.region[key])}
                  onChange={(e) => region(key, Number(e.target.value))}
                  className="mt-0.5 w-full rounded border border-border bg-background px-1 py-0.5 text-xs tabular-nums text-foreground"
                />
              </label>
            ))}
          </div>
          <Button
            size="sm"
            variant={output.blendTest ? "default" : "secondary"}
            className="w-full"
            onClick={() => onPatch({ blendTest: !output.blendTest })}
          >
            Blend test field
          </Button>
          {EDGES.map((edge) => {
            const value = output.blend[edge];
            return (
              <div key={edge} className="flex items-center gap-1 text-[10px]">
                <span className="w-12 capitalize text-muted-foreground">{edge}</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  aria-label={`${edge} fade width percent`}
                  value={Math.round(value.width * 100)}
                  onChange={(e) =>
                    onPatch({
                      blend: {
                        ...output.blend,
                        [edge]: {
                          ...value,
                          width: Math.max(0, Math.min(0.5, Number(e.target.value) / 100)),
                        },
                      },
                    })
                  }
                  className="w-12 rounded border border-border bg-background px-1 py-0.5 tabular-nums"
                />
                <span className="text-muted-foreground">fade %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  aria-label={`${edge} edge brightness percent`}
                  value={Math.round(value.level * 100)}
                  onChange={(e) =>
                    onPatch({
                      blend: {
                        ...output.blend,
                        [edge]: {
                          ...value,
                          level: Math.max(0, Math.min(1, Number(e.target.value) / 100)),
                        },
                      },
                    })
                  }
                  className="w-12 rounded border border-border bg-background px-1 py-0.5 tabular-nums"
                />
                <span className="text-muted-foreground">bright %</span>
                <input
                  type="number"
                  min={0.2}
                  max={4}
                  step={0.1}
                  aria-label={`${edge} fade curve`}
                  value={value.curve}
                  onChange={(e) =>
                    onPatch({
                      blend: {
                        ...output.blend,
                        [edge]: {
                          ...value,
                          curve: Math.max(0.2, Math.min(4, Number(e.target.value))),
                        },
                      },
                    })
                  }
                  className="w-12 rounded border border-border bg-background px-1 py-0.5 tabular-nums"
                />
                <span className="text-muted-foreground">curve</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
