import { Camera, ExternalLink, Play, Plus, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OutputScreen, Scene, TimelineCue } from "@/lib/types";

type Props = {
  scenes: Scene[];
  cues: TimelineCue[];
  outputs: OutputScreen[];
  openOutputs: string[];
  playing: boolean;
  time: number;
  activeSceneId: string | null;
  onSaveScene: () => void;
  onRecall: (id: string) => void;
  onRenameScene: (id: string, name: string) => void;
  onDeleteScene: (id: string) => void;
  onAddCue: (sceneId: string) => void;
  onPatchCue: (id: string, next: Partial<TimelineCue>) => void;
  onRemoveCue: (id: string) => void;
  onPlay: () => void;
  onStop: () => void;
  onAddOutput: () => void;
  onRemoveOutput: (id: string) => void;
  onOpenOutput: (id: string) => void;
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function ShowPanel(p: Props) {
  const sorted = [...p.cues].sort((a, b) => a.start - b.start);
  const length = sorted.length ? Math.max(30, sorted[sorted.length - 1]!.start + 10) : 30;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" className="flex-1" onClick={p.onSaveScene}>
          <Camera className="size-4" /> Save scene
        </Button>
        <Button
          size="sm"
          variant={p.playing ? "destructive" : "default"}
          className="flex-1"
          onClick={p.playing ? p.onStop : p.onPlay}
          disabled={!p.playing && p.cues.length === 0}
        >
          {p.playing ? <Square className="size-4" /> : <Play className="size-4" />}
          {p.playing ? `Stop ${fmt(p.time)}` : "Run show"}
        </Button>
      </div>

      {p.scenes.length > 0 && (
        <ul className="space-y-1.5">
          {p.scenes.map((s) => (
            <li
              key={s.id}
              className={`flex items-center gap-1.5 rounded-lg border p-1.5 ${
                p.activeSceneId === s.id ? "border-primary bg-primary/10" : "border-border"
              }`}
            >
              <Input
                value={s.name}
                onChange={(e) => p.onRenameScene(s.id, e.target.value)}
                className="h-7 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-1"
                aria-label="Scene name"
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-7"
                onClick={() => p.onRecall(s.id)}
              >
                Go
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-1.5"
                aria-label="Add to timeline"
                onClick={() => p.onAddCue(s.id)}
              >
                <Plus className="size-4" />
              </Button>
              <button
                aria-label="Delete scene"
                onClick={() => p.onDeleteScene(s.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {sorted.length > 0 && (
        <div className="space-y-2">
          <div className="relative h-7 overflow-hidden rounded-md border border-border bg-muted/40">
            {sorted.map((c) => (
              <div
                key={c.id}
                title={p.scenes.find((s) => s.id === c.sceneId)?.name}
                className="absolute top-0 h-full w-1 bg-primary"
                style={{ left: `${(c.start / length) * 100}%` }}
              />
            ))}
            {p.playing && (
              <div
                className="absolute top-0 h-full w-0.5 bg-destructive"
                style={{ left: `${Math.min(100, (p.time / length) * 100)}%` }}
              />
            )}
          </div>
          <ul className="space-y-1.5">
            {sorted.map((c) => (
              <li key={c.id} className="flex items-center gap-1.5 text-xs">
                <span className="w-24 shrink-0 truncate">
                  {p.scenes.find((s) => s.id === c.sceneId)?.name ?? "Scene"}
                </span>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={c.start}
                  onChange={(e) => p.onPatchCue(c.id, { start: Number(e.target.value) })}
                  className="h-7 w-16"
                  aria-label="Cue time in seconds"
                />
                <Select
                  value={c.transition}
                  onValueChange={(v) =>
                    p.onPatchCue(c.id, { transition: v as TimelineCue["transition"] })
                  }
                >
                  <SelectTrigger className="h-7 flex-1" aria-label="Transition">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cut">Cut</SelectItem>
                    <SelectItem value="fade">Crossfade</SelectItem>
                  </SelectContent>
                </Select>
                <button
                  aria-label="Remove cue"
                  onClick={() => p.onRemoveCue(c.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1.5 border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Projectors
          </p>
          <Button size="sm" variant="ghost" className="h-7" onClick={p.onAddOutput}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
        <ul className="space-y-1.5">
          {p.outputs.map((o) => (
            <li key={o.id} className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-sm">{o.name}</span>
              <Button
                size="sm"
                variant={p.openOutputs.includes(o.id) ? "default" : "secondary"}
                className="h-7"
                onClick={() => p.onOpenOutput(o.id)}
              >
                <ExternalLink className="size-3.5" />
                {p.openOutputs.includes(o.id) ? "Live" : "Open"}
              </Button>
              {p.outputs.length > 1 && (
                <button
                  aria-label="Remove projector"
                  onClick={() => p.onRemoveOutput(o.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          Open a window per projector, drag it onto that screen and click it for fullscreen.
        </p>
      </div>
    </div>
  );
}
