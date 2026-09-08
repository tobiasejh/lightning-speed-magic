import { ExternalLink, Grid3x3, Magnet, Move, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TestPattern } from "@/lib/types";

type Props = {
  mapping: boolean;
  onMapping: () => void;
  snap: boolean;
  onSnap: () => void;
  testPattern: TestPattern;
  onTestPattern: (p: TestPattern) => void;
  roomView: boolean;
  onRoomView: () => void;
  outputOpen: boolean;
  onOpenOutput: () => void;
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
        {p.roomView
          ? "Drag sound icons, the listener and speakers to place them in the room."
          : "Drag the corner dots so each shape lines up with the real surface. Hold Shift to skip snapping."}
      </p>
      <Button size="sm" variant={p.roomView ? "default" : "secondary"} onClick={p.onRoomView}>
        <Volume2 className="size-4" /> {p.roomView ? "Room view" : "Stage view"}
      </Button>
      <Button size="sm" variant={p.mapping ? "default" : "secondary"} onClick={p.onMapping}>
        <Move className="size-4" /> {p.mapping ? "Mapping on" : "Mapping off"}
      </Button>
      <Button
        size="sm"
        variant={p.snap ? "default" : "secondary"}
        onClick={p.onSnap}
        aria-pressed={p.snap}
      >
        <Magnet className="size-4" /> Snap
      </Button>
      <Select value={p.testPattern} onValueChange={(v) => p.onTestPattern(v as TestPattern)}>
        <SelectTrigger className="h-8 w-[9.5rem] gap-1" aria-label="Test pattern">
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
      <Button size="sm" variant="outline" onClick={p.onOpenOutput}>
        <ExternalLink className="size-4" /> {p.outputOpen ? "Output live" : "Open output window"}
      </Button>
    </div>
  );
}
