import {
  Clock3,
  Film,
  Grid3x3,
  Magnet,
  Monitor,
  Move,
  Smartphone,
  Volume2,
  Waves,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TestPattern } from "@/lib/types";

export type StageView = "stage" | "room" | "editor" | "timeline" | "effects";

type Props = {
  mapping: boolean;
  onMapping: () => void;
  snap: boolean;
  onSnap: () => void;
  testPattern: TestPattern;
  onTestPattern: (p: TestPattern) => void;
  view: StageView;
  onView: (v: StageView) => void;
  onPair: () => void;
  paired: boolean;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
};

const patterns: { value: TestPattern; label: string }[] = [
  { value: "off", label: "Pattern off" },
  { value: "grid", label: "Grid" },
  { value: "crosshair", label: "Crosshair" },
  { value: "bars", label: "Colour bars" },
  { value: "frame", label: "Edge frame" },
  { value: "numbered", label: "Numbered" },
];

export function MappingToolbar(p: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/60 px-3 py-2">
      <p className="mr-auto hidden text-xs text-muted-foreground xl:block">
        {p.view === "room"
          ? "Drag sound icons, the listener and speakers to place them in the room."
          : p.view === "editor"
            ? "Crop, cut and sync your photos and videos before projecting them."
            : p.view === "timeline"
              ? "Arrange visual, audio and movement clips across the show."
              : p.view === "effects"
                ? "Shape the reverb and choose how much of each sound is sent into it."
                : "Drag the corner dots so each shape lines up with the real surface. Hold Shift to skip snapping."}
      </p>
      <Button
        size="sm"
        variant={p.view === "stage" ? "default" : "secondary"}
        title="Open the projection-mapping stage"
        onClick={() => p.onView("stage")}
      >
        <Monitor className="size-4" /> Stage
      </Button>
      <Button
        size="sm"
        variant={p.view === "room" ? "default" : "secondary"}
        title="Position sounds, speakers, and listener in the room"
        onClick={() => p.onView("room")}
      >
        <Volume2 className="size-4" /> Room
      </Button>
      <Button
        size="sm"
        variant={p.view === "editor" ? "default" : "secondary"}
        title="Crop, trim, and sync your media"
        onClick={() => p.onView("editor")}
      >
        <Film className="size-4" /> Editor
      </Button>
      <Button
        size="sm"
        variant={p.view === "timeline" ? "default" : "secondary"}
        title="Arrange visual, audio, and movement clips"
        onClick={() => p.onView("timeline")}
      >
        <Clock3 className="size-4" /> Timeline
      </Button>
      <Button
        size="sm"
        variant={p.view === "effects" ? "default" : "secondary"}
        title="Adjust reverb and audio effects"
        onClick={() => p.onView("effects")}
      >
        <Waves className="size-4" /> Audio Effects
      </Button>
      <Button
        size="sm"
        variant={p.mapping ? "default" : "secondary"}
        title="Toggle surface mapping handles"
        onClick={p.onMapping}
      >
        <Move className="size-4" /> {p.mapping ? "Mapping on" : "Mapping off"}
      </Button>
      <Button
        size="sm"
        variant={p.snap ? "default" : "secondary"}
        title="Toggle snapping while moving surface points"
        onClick={p.onSnap}
        aria-pressed={p.snap}
      >
        <Magnet className="size-4" /> Snap
      </Button>
      {p.view === "stage" && (
        <div className="flex items-center gap-1" aria-label="Stage zoom controls">
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8"
            onClick={p.onZoomOut}
            disabled={p.zoom <= 1}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <ZoomOut />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="w-14 tabular-nums"
            onClick={p.onZoomReset}
            aria-label="Reset stage zoom"
            title="Reset zoom (middle-drag to pan)"
          >
            {Math.round(p.zoom * 100)}%
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8"
            onClick={p.onZoomIn}
            disabled={p.zoom >= 4}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <ZoomIn />
          </Button>
        </div>
      )}
      <Select value={p.testPattern} onValueChange={(v) => p.onTestPattern(v as TestPattern)}>
        <SelectTrigger
          className="h-8 w-[9.5rem] gap-1"
          aria-label="Test pattern"
          title="Choose a stage alignment test pattern"
        >
          <Grid3x3 className="size-4" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {patterns.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant={p.paired ? "default" : "outline"}
        title={p.paired ? "Stop tablet pairing" : "Pair a tablet or remote device"}
        onClick={p.onPair}
      >
        <Smartphone className="size-4" /> {p.paired ? "Tablet linked" : "Pair a device"}
      </Button>
    </div>
  );
}
