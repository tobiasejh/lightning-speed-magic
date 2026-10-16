import {
  Headphones,
  Pause,
  Play,
  Plus,
  Repeat,
  Speaker,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { SPEAKER_LAYOUTS, type RoomConfig, type SoundItem } from "@/lib/types";

type Props = {
  sounds: SoundItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (files: FileList | null) => void;
  onPatch: (id: string, next: Partial<SoundItem>) => void;
  onRemove: (id: string) => void;
  onPlayAll: () => void;
  onStopAll: () => void;
  room: RoomConfig;
  onRoom: (next: Partial<RoomConfig>) => void;
  maxChannels: number;
  onRefreshChannels: () => void;
  devices: MediaDeviceInfo[];
  deviceId: string;
  onDevice: (id: string) => void;
};

export function SoundPanel(p: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const anyPlaying = p.sounds.some((s) => s.playing);

  return (
    <div className="space-y-4">
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.wav,.flac,.ogg,.mp3,.m4a,.amb"
        multiple
        className="hidden"
        onChange={(e) => {
          p.onAdd(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={anyPlaying ? p.onStopAll : p.onPlayAll}>
          {anyPlaying ? <Square className="size-4" /> : <Play className="size-4" />}
          {anyPlaying ? "Stop all" : "Play all"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
          <Plus className="size-4" /> Add sound
        </Button>
      </div>
      <Row label="Master volume" value={`${Math.round(p.room.masterGain * 100)}%`}>
        <Slider
          value={[p.room.masterGain]}
          min={0}
          max={1.5}
          step={0.01}
          onValueChange={([v = 0]) => p.onRoom({ masterGain: v })}
        />
      </Row>

      {p.sounds.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No sounds yet. Add music, mono clips or ambisonic (4/9/16‑channel) files. They stay on
          this device.
        </p>
      ) : (
        <ul className="space-y-2">
          {p.sounds.map((s) => {
            const active = s.id === p.selectedId;
            return (
              <li
                key={s.id}
                className={`rounded-lg border p-2 ${active ? "border-primary bg-primary/10" : "border-border"}`}
              >
                <div className="flex items-center gap-2">
                  <button
                    aria-label={s.playing ? "Pause" : "Play"}
                    onClick={() => p.onPatch(s.id, { playing: !s.playing })}
                    className="grid size-7 shrink-0 place-items-center rounded-full text-background"
                    style={{ background: s.color }}
                  >
                    {s.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                  </button>
                  <button className="min-w-0 flex-1 text-left" onClick={() => p.onSelect(s.id)}>
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {s.kind === "ambisonic"
                        ? `Ambisonic · ${s.channels} ch`
                        : s.kind === "stereo"
                          ? "Stereo → mono"
                          : "Mono"}
                      {s.duration ? ` · ${fmt(s.duration)}` : ""}
                    </span>
                  </button>
                  <Tog on={s.loop} label="Loop" onClick={() => p.onPatch(s.id, { loop: !s.loop })}>
                    <Repeat className="size-3.5" />
                  </Tog>
                  <Tog on={s.mute} label="Mute" onClick={() => p.onPatch(s.id, { mute: !s.mute })}>
                    {s.mute ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                  </Tog>
                  <Tog on={s.solo} label="Solo" onClick={() => p.onPatch(s.id, { solo: !s.solo })}>
                    <span className="text-[10px] font-bold">S</span>
                  </Tog>
                  <button
                    aria-label="Remove sound"
                    onClick={() => p.onRemove(s.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {active && (
                  <div className="mt-2 space-y-2">
                    <Row label="Volume" value={`${Math.round(s.gain * 100)}%`}>
                      <Slider
                        value={[s.gain]}
                        min={0}
                        max={1.5}
                        step={0.01}
                        onValueChange={([v = 0]) => p.onPatch(s.id, { gain: v })}
                      />
                    </Row>
                    {s.kind === "ambisonic" ? (
                      <Row label="Heading" value={`${Math.round(s.heading)}°`}>
                        <Slider
                          value={[s.heading]}
                          min={-180}
                          max={180}
                          step={1}
                          onValueChange={([v = 0]) => p.onPatch(s.id, { heading: v })}
                        />
                      </Row>
                    ) : (
                      <Row label="Height" value={`${s.position.z.toFixed(2)}`}>
                        <Slider
                          value={[s.position.z]}
                          min={-1}
                          max={1}
                          step={0.01}
                          onValueChange={([v = 0]) =>
                            p.onPatch(s.id, { position: { ...s.position, z: v } })
                          }
                        />
                      </Row>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-3 border-t border-border pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Room
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant={p.room.outputMode === "headphones" ? "default" : "secondary"}
            onClick={() => p.onRoom({ outputMode: "headphones" })}
          >
            <Headphones className="size-4" /> Headphones
          </Button>
          <Button
            size="sm"
            variant={p.room.outputMode === "speakers" ? "default" : "secondary"}
            onClick={() => p.onRoom({ outputMode: "speakers" })}
          >
            <Speaker className="size-4" /> Speakers
          </Button>
        </div>
        {p.room.outputMode === "speakers" && (
          <>
            <Select
              value={p.room.layout}
              onValueChange={(layout) =>
                p.onRoom({
                  layout,
                  speakers:
                    layout === "custom"
                      ? p.room.speakers.map((s) => ({ ...s }))
                      : (SPEAKER_LAYOUTS[layout] ?? []).map((s) => ({ ...s })),
                })
              }
            >
              <SelectTrigger className="h-8" aria-label="Speaker layout">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(SPEAKER_LAYOUTS).map((k) => (
                  <SelectItem key={k} value={k}>
                    {k} ({SPEAKER_LAYOUTS[k]!.length} speakers)
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom ({p.room.speakers.length})</SelectItem>
              </SelectContent>
            </Select>
            {p.room.layout === "custom" && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    const n = p.room.speakers.length + 1;
                    const a = (n / 8) * Math.PI * 2;
                    p.onRoom({
                      speakers: [
                        ...p.room.speakers,
                        {
                          id: `sp${Date.now()}`,
                          name: `S${n}`,
                          position: { x: Math.sin(a) * 0.8, y: -Math.cos(a) * 0.8, z: 0 },
                        },
                      ],
                    });
                  }}
                >
                  <Plus className="size-4" /> Speaker
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  disabled={p.room.speakers.length <= 1}
                  onClick={() => p.onRoom({ speakers: p.room.speakers.slice(0, -1) })}
                >
                  Remove last
                </Button>
              </div>
            )}
            <div className="space-y-1">
              {p.room.speakers.map((sp, k) => (
                <div key={sp.id} className="flex items-center gap-2 text-xs">
                  <span className="w-14 truncate" title={sp.name}>
                    {sp.name || `S${k + 1}`}
                  </span>
                  <Select
                    value={String(sp.channel ?? k)}
                    onValueChange={(v) =>
                      p.onRoom({
                        speakers: p.room.speakers.map((o) =>
                          o.id === sp.id ? { ...o, channel: Number(v) } : o,
                        ),
                      })
                    }
                  >
                    <SelectTrigger
                      className="h-7 flex-1"
                      aria-label={`Output channel for ${sp.name}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from(
                        { length: Math.max(p.maxChannels, (sp.channel ?? k) + 1) },
                        (_, c) => (
                          <SelectItem key={c} value={String(c)} disabled={c >= p.maxChannels}>
                            Output {c + 1}
                            {c >= p.maxChannels ? " (not available)" : ""}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Your audio device reports {p.maxChannels} output channel
              {p.maxChannels === 1 ? "" : "s"}.
              {p.room.speakers.length > p.maxChannels
                ? ` Speakers beyond ${p.maxChannels} are folded down onto the available channels.`
                : ""}
              {p.maxChannels <= 2
                ? " To use more, set your sound card to 5.1, 7.1 or more channels in your computer's sound settings (Windows: Sound > your device > Configure / Properties > Advanced), then press Re-check."
                : ""}
            </p>
            <Button size="sm" variant="secondary" className="w-full" onClick={p.onRefreshChannels}>
              Re-check output channels
            </Button>
          </>
        )}
        {p.devices.length > 0 && (
          <Select value={p.deviceId || "default"} onValueChange={p.onDevice}>
            <SelectTrigger className="h-8" aria-label="Output device">
              <SelectValue placeholder="Output device" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default output</SelectItem>
              {p.devices.map((d) => (
                <SelectItem key={d.deviceId} value={d.deviceId}>
                  {d.label || "Audio output"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Row label="Width" value={`${p.room.width} m`}>
            <Slider
              value={[p.room.width]}
              min={2}
              max={100}
              step={1}
              onValueChange={([v = 8]) => p.onRoom({ width: v })}
            />
          </Row>
          <Row label="Length" value={`${p.room.length} m`}>
            <Slider
              value={[p.room.length]}
              min={2}
              max={100}
              step={1}
              onValueChange={([v = 8]) => p.onRoom({ length: v })}
            />
          </Row>
        </div>
        <Select
          value={String(p.room.order)}
          onValueChange={(v) => p.onRoom({ order: Number(v) as RoomConfig["order"] })}
        >
          <SelectTrigger className="h-8" aria-label="Ambisonic order">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1st order</SelectItem>
            <SelectItem value="2">2nd order</SelectItem>
            <SelectItem value="3">3rd order</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          Reverb now lives in the Audio Effects tab, where each clip gets its own send.
        </p>
      </div>
    </div>
  );
}

function Tog({
  on,
  label,
  onClick,
  children,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={`grid size-6 place-items-center rounded ${
        on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      {children}
    </div>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
