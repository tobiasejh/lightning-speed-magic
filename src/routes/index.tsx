import { createFileRoute } from "@tanstack/react-router";
import {
  Eye,
  EyeOff,
  Image as ImageIcon,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Move,
  Plus,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SurfaceLayer } from "@/components/SurfaceLayer";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MicAnalyser } from "@/lib/audio";
import { mediaElements, type Globals, type MediaItem, type Surface } from "@/lib/types";
import { defaultCorners } from "@/lib/warp";
import { visuals } from "@/lib/visuals";

const title = "Prism — Projection Mapping in Your Browser";
const description =
  "Turn any projector into a projection mapping rig. Warp live visuals or your own photos and videos onto real surfaces, react to the music, and go fullscreen — no computer software to install.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

const newSurface = (n: number, source: string): Surface => ({
  id: `s${Date.now()}${n}`,
  name: `Surface ${n}`,
  source,
  corners: defaultCorners(0.1 + (n % 3) * 0.04),
  opacity: 1,
  hueShift: (n - 1) * 40,
  visible: true,
});

function Studio() {
  const [surfaces, setSurfaces] = useState<Surface[]>(() => [newSurface(1, "visual:plasma")]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mapping, setMapping] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [globals, setGlobals] = useState<Globals>({
    speed: 1,
    intensity: 0.5,
    hue: 190,
    brightness: 1,
    audioReactive: true,
    blackout: false,
  });

  const micRef = useRef<MicAnalyser | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  const selected = surfaces.find((s) => s.id === selectedId) ?? surfaces[0] ?? null;

  useEffect(() => {
    if (!selectedId && surfaces[0]) setSelectedId(surfaces[0].id);
  }, [selectedId, surfaces]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setStage({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    return () => {
      micRef.current?.stop();
      mediaElements.clear();
    };
  }, []);

  const patch = useCallback((id: string, next: Partial<Surface>) => {
    setSurfaces((prev) => prev.map((s) => (s.id === id ? { ...s, ...next } : s)));
  }, []);

  const toggleMic = async () => {
    if (micOn) {
      micRef.current?.stop();
      micRef.current = null;
      setMicOn(false);
      return;
    }
    const mic = new MicAnalyser();
    try {
      await mic.start();
      micRef.current = mic;
      setMicOn(true);
    } catch {
      setMicOn(false);
    }
  };

  const goFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.parentElement?.requestFullscreen();
  };

  const addMedia = (files: FileList | null) => {
    if (!files) return;
    const added: MediaItem[] = [];
    Array.from(files).forEach((file, i) => {
      const isVideo = file.type.startsWith("video");
      if (!isVideo && !file.type.startsWith("image")) return;
      const id = `m${Date.now()}${i}`;
      const url = URL.createObjectURL(file);
      if (isVideo) {
        const v = document.createElement("video");
        v.src = url;
        v.loop = true;
        v.muted = true;
        v.playsInline = true;
        void v.play();
        mediaElements.set(id, v);
      } else {
        const img = new Image();
        img.src = url;
        mediaElements.set(id, img);
      }
      added.push({ id, name: file.name, kind: isVideo ? "video" : "image", url });
    });
    if (added.length) {
      setMedia((prev) => [...prev, ...added]);
      if (selected) patch(selected.id, { source: `media:${added[0].id}` });
    }
  };

  const dragCorner = (index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selected) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (ev: PointerEvent) => {
      const x = Math.min(1.4, Math.max(-0.4, (ev.clientX - rect.left) / rect.width));
      const y = Math.min(1.4, Math.max(-0.4, (ev.clientY - rect.top) / rect.height));
      setSurfaces((prev) =>
        prev.map((s) =>
          s.id === selected.id
            ? { ...s, corners: s.corners.map((c, i) => (i === index ? { x, y } : c)) }
            : s,
        ),
      );
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const groups = useMemo(() => {
    const map = new Map<string, typeof visuals>();
    visuals.forEach((v) => map.set(v.group, [...(map.get(v.group) ?? []), v]));
    return [...map.entries()];
  }, []);

  const sourceLabel = (source: string) => {
    if (source.startsWith("media:")) {
      return media.find((m) => m.id === source.slice(6))?.name ?? "Media";
    }
    return visuals.find((v) => v.id === source.slice(7))?.name ?? "Visual";
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground lg:flex-row">
      <aside
        className={`flex w-full shrink-0 flex-col gap-5 overflow-y-auto border-b border-border bg-card/60 p-4 lg:h-full lg:w-[22rem] lg:border-b-0 lg:border-r ${
          fullscreen ? "hidden" : ""
        }`}
      >
        <header>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Zap className="size-5 text-primary" />
            Prism
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Projection mapping straight from the browser. Point a projector at a wall, warp each
            shape to fit, and play.
          </p>
        </header>

        {/* Output */}
        <section className="space-y-3">
          <SectionTitle>Output</SectionTitle>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={goFullscreen}>
              {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              {fullscreen ? "Exit" : "Fullscreen"}
            </Button>
            <Button
              size="sm"
              variant={globals.blackout ? "destructive" : "secondary"}
              className="flex-1"
              onClick={() => setGlobals((g) => ({ ...g, blackout: !g.blackout }))}
            >
              Blackout
            </Button>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-sm">
              {micOn ? (
                <Mic className="size-4 text-primary" />
              ) : (
                <MicOff className="size-4 text-muted-foreground" />
              )}
              Sound reactive
            </div>
            <Switch checked={micOn} onCheckedChange={() => void toggleMic()} />
          </div>
          <Labeled label="Brightness" value={`${Math.round(globals.brightness * 100)}%`}>
            <Slider
              value={[globals.brightness]}
              min={0.1}
              max={1.5}
              step={0.01}
              onValueChange={([v]) => setGlobals((g) => ({ ...g, brightness: v }))}
            />
          </Labeled>
        </section>

        {/* Look */}
        <section className="space-y-3">
          <SectionTitle>Look</SectionTitle>
          <Labeled label="Speed" value={`${globals.speed.toFixed(2)}x`}>
            <Slider
              value={[globals.speed]}
              min={0}
              max={3}
              step={0.01}
              onValueChange={([v]) => setGlobals((g) => ({ ...g, speed: v }))}
            />
          </Labeled>
          <Labeled label="Intensity" value={`${Math.round(globals.intensity * 100)}%`}>
            <Slider
              value={[globals.intensity]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={([v]) => setGlobals((g) => ({ ...g, intensity: v }))}
            />
          </Labeled>
          <Labeled label="Colour" value={`${Math.round(globals.hue)}°`}>
            <Slider
              value={[globals.hue]}
              min={0}
              max={360}
              step={1}
              onValueChange={([v]) => setGlobals((g) => ({ ...g, hue: v }))}
            />
          </Labeled>
        </section>

        {/* Surfaces */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <SectionTitle>Surfaces</SectionTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setSurfaces((prev) => {
                  const s = newSurface(prev.length + 1, "visual:tunnel");
                  setSelectedId(s.id);
                  return [...prev, s];
                })
              }
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
          <ul className="space-y-2">
            {surfaces.map((s) => (
              <li
                key={s.id}
                className={`rounded-lg border p-3 transition-colors ${
                  selected?.id === s.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-accent"
                }`}
              >
                <div className="flex items-center gap-2">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setSelectedId(s.id)}
                  >
                    <span className="block truncate text-sm font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {sourceLabel(s.source)}
                    </span>
                  </button>
                  <button
                    aria-label={s.visible ? "Hide surface" : "Show surface"}
                    onClick={() => patch(s.id, { visible: !s.visible })}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {s.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  </button>
                  <button
                    aria-label="Delete surface"
                    onClick={() => setSurfaces((prev) => prev.filter((x) => x.id !== s.id))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {selected?.id === s.id && (
                  <div className="mt-3 space-y-2">
                    <Labeled label="Opacity" value={`${Math.round(s.opacity * 100)}%`}>
                      <Slider
                        value={[s.opacity]}
                        min={0}
                        max={1}
                        step={0.01}
                        onValueChange={([v]) => patch(s.id, { opacity: v })}
                      />
                    </Labeled>
                    <Labeled label="Colour shift" value={`${s.hueShift}°`}>
                      <Slider
                        value={[s.hueShift]}
                        min={0}
                        max={360}
                        step={1}
                        onValueChange={([v]) => patch(s.id, { hueShift: v })}
                      />
                    </Labeled>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      onClick={() => patch(s.id, { corners: defaultCorners(0.05) })}
                    >
                      Reset shape
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Sources */}
        <section className="space-y-2 pb-4">
          <SectionTitle>Source for {selected?.name ?? "surface"}</SectionTitle>
          <Tabs defaultValue="visuals">
            <TabsList className="w-full">
              <TabsTrigger value="visuals" className="flex-1">
                Visuals
              </TabsTrigger>
              <TabsTrigger value="media" className="flex-1">
                My media
              </TabsTrigger>
            </TabsList>
            <TabsContent value="visuals" className="space-y-3 pt-3">
              {groups.map(([group, items]) => (
                <div key={group} className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {group}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {items.map((v) => {
                      const active = selected?.source === `visual:${v.id}`;
                      return (
                        <button
                          key={v.id}
                          onClick={() => selected && patch(selected.id, { source: `visual:${v.id}` })}
                          className={`rounded-md border px-2 py-2 text-xs transition-colors ${
                            active
                              ? "border-primary bg-primary/15 text-foreground"
                              : "border-border hover:bg-accent"
                          }`}
                        >
                          {v.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </TabsContent>
            <TabsContent value="media" className="space-y-2 pt-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addMedia(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="size-4" /> Add photos or videos
              </Button>
              {media.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing added yet. Your files stay on this device.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {media.map((m) => {
                    const active = selected?.source === `media:${m.id}`;
                    return (
                      <button
                        key={m.id}
                        title={m.name}
                        onClick={() => selected && patch(selected.id, { source: `media:${m.id}` })}
                        className={`relative aspect-square overflow-hidden rounded-md border ${
                          active ? "border-primary" : "border-border"
                        }`}
                      >
                        {m.kind === "image" ? (
                          <img src={m.url} alt={m.name} className="size-full object-cover" />
                        ) : (
                          <video
                            src={m.url}
                            muted
                            loop
                            playsInline
                            autoPlay
                            className="size-full object-cover"
                          />
                        )}
                        <ImageIcon className="absolute bottom-1 right-1 size-3 text-white/70" />
                      </button>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </section>
      </aside>

      {/* Stage */}
      <main className="relative flex min-h-0 flex-1 flex-col bg-black">
        {!fullscreen && (
          <div className="flex items-center justify-between gap-2 border-b border-border bg-card/60 px-4 py-2">
            <p className="text-xs text-muted-foreground">
              Drag the corner dots so each shape lines up with the real surface.
            </p>
            <Button
              size="sm"
              variant={mapping ? "default" : "secondary"}
              onClick={() => setMapping((m) => !m)}
            >
              <Move className="size-4" /> {mapping ? "Mapping on" : "Mapping off"}
            </Button>
          </div>
        )}
        <div className="relative min-h-0 flex-1 bg-black" ref={stageRef}>
          {surfaces.map((s) => (
            <SurfaceLayer
              key={s.id}
              surface={s}
              stage={stage}
              globals={globals}
              mic={micRef.current}
            />
          ))}
          {mapping &&
            !fullscreen &&
            selected?.corners.map((c, i) => (
              <div
                key={i}
                onPointerDown={dragCorner(i)}
                className="absolute z-10 size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-primary bg-primary/30 active:cursor-grabbing"
                style={{ left: c.x * stage.w, top: c.y * stage.h }}
              />
            ))}
        </div>
      </main>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </h2>
  );
}

function Labeled({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground">{value}</span>
      </div>
      {children}
    </div>
  );
}
