import { Waves } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { ReverbConfig, RoomConfig, SoundItem, TimelineClip } from "@/lib/types";

type Props = {
  reverb: ReverbConfig;
  onReverb: (next: Partial<ReverbConfig>) => void;
  clips: TimelineClip[];
  sounds: SoundItem[];
  room: RoomConfig;
  onClips: (clips: TimelineClip[]) => void;
};

const layoutName: Record<string, string> = {
  stereo: "Stereo",
  quad: "Quad",
  "5.1": "5.1 surround",
  "7.1": "7.1 surround",
  cube: "8-speaker cube",
};

export function AudioEffectsPanel(p: Props) {
  const audioClips = p.clips.filter((clip) => clip.kind === "audio");
  const setSend = (id: string, value: number) =>
    p.onClips(p.clips.map((clip) => (clip.id === id ? { ...clip, reverbSend: value } : clip)));
  const output =
    p.room.outputMode === "headphones"
      ? "headphones (3D binaural)"
      : `${layoutName[p.room.layout] ?? "custom speakers"} (${p.room.speakers.length} speakers)`;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Waves className="size-4" /> Audio Effects
        </h2>
        <p className="text-xs text-muted-foreground">
          Reverb is built in full 3D sound (
          {p.room.order === 3 ? "3rd" : `${p.room.order}${p.room.order === 1 ? "st" : "nd"}`} order)
          and played out through {output}.
        </p>
      </header>

      <section className="space-y-3 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reverb bus
          </h3>
          <Button
            size="sm"
            variant={p.reverb.enabled ? "default" : "secondary"}
            aria-pressed={p.reverb.enabled}
            onClick={() => p.onReverb({ enabled: !p.reverb.enabled })}
          >
            {p.reverb.enabled ? "On" : "Off"}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Bus level" value={`${Math.round(p.reverb.level * 100)}%`}>
            <Slider
              value={[p.reverb.level]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={([v = 0.8]) => p.onReverb({ level: v })}
            />
          </Row>
          <Row
            label="Room size"
            value={`${p.reverb.roomSize} m`}
            hint="Bigger rooms space the first bounces further apart."
          >
            <Slider
              value={[p.reverb.roomSize]}
              min={2}
              max={60}
              step={1}
              onValueChange={([v = 12]) => p.onReverb({ roomSize: v })}
            />
          </Row>
          <Row
            label="Decay"
            value={`${p.reverb.decay.toFixed(1)} s`}
            hint="How long the echo keeps ringing."
          >
            <Slider
              value={[p.reverb.decay]}
              min={0.1}
              max={12}
              step={0.1}
              onValueChange={([v = 1.8]) => p.onReverb({ decay: v })}
            />
          </Row>
          <Row label="Pre-delay" value={`${Math.round(p.reverb.preDelayMs)} ms`}>
            <Slider
              value={[p.reverb.preDelayMs]}
              min={0}
              max={250}
              step={1}
              onValueChange={([v = 20]) => p.onReverb({ preDelayMs: v })}
            />
          </Row>
          <Row label="Early reflections" value={`${Math.round(p.reverb.earlyAmount * 100)}%`}>
            <Slider
              value={[p.reverb.earlyAmount]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={([v = 0.6]) => p.onReverb({ earlyAmount: v })}
            />
          </Row>
          <Row label="Reflection spread" value={`${Math.round(p.reverb.earlySpread * 100)}%`}>
            <Slider
              value={[p.reverb.earlySpread]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={([v = 0.5]) => p.onReverb({ earlySpread: v })}
            />
          </Row>
          <Row label="Damping" value={`${Math.round(p.reverb.damping * 100)}%`}>
            <Slider
              value={[p.reverb.damping]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={([v = 0.35]) => p.onReverb({ damping: v })}
            />
          </Row>
        </div>
      </section>

      <section className="space-y-2 rounded-md border border-border p-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Sends from timeline clips
        </h3>
        <p className="text-xs text-muted-foreground">
          0% keeps a clip completely dry, 100% sends its whole signal into the reverb.
        </p>
        {audioClips.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Add a sound to an audio track on the timeline and it will show up here.
          </p>
        )}
        <div className="space-y-2">
          {audioClips.map((clip) => {
            const sound = p.sounds.find((s) => s.id === clip.soundId);
            const send = clip.reverbSend ?? 0;
            return (
              <div key={clip.id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-xs" title={sound?.name ?? clip.name}>
                  {clip.name}
                </span>
                <div className="w-40 shrink-0">
                  <Slider
                    aria-label={`Reverb send for ${clip.name}`}
                    value={[send]}
                    min={0}
                    max={1}
                    step={0.01}
                    onValueChange={([v = 0]) => setSend(clip.id, v)}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-[10px] text-muted-foreground">
                  {Math.round(send * 100)}%
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span>{value}</span>
      </div>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
