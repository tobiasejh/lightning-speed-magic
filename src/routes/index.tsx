import { createFileRoute } from "@tanstack/react-router";
import {
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Image as ImageIcon,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Plus,
  RotateCw,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { MappingToolbar } from "@/components/MappingToolbar";
import { ProjectsMenu } from "@/components/ProjectsMenu";
import { RoomView } from "@/components/RoomView";
import { SoundPanel } from "@/components/SoundPanel";
import { SurfaceLayer } from "@/components/SurfaceLayer";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MicAnalyser, silentLevels, type AudioLevelProvider } from "@/lib/audio";
import { SpatialEngine } from "@/lib/audio-engine";
import { snapCandidates, snapPoint } from "@/lib/snap";
import {
  LAST_KEY,
  deleteProject,
  exportProject,
  importProject,
  listProjects,
  loadProject,
  saveProject,
  type BlobMap,
} from "@/lib/store";
import { openChannel, type OutputSnapshot, type SyncMessage } from "@/lib/sync";
import {
  SOUND_COLORS,
  defaultGlobals,
  defaultRoom,
  mediaElements,
  type Globals,
  type MediaItem,
  type Project,
  type RoomConfig,
  type SoundItem,
  type Surface,
  type TestPattern,
} from "@/lib/types";
import { defaultCorners, type Pt } from "@/lib/warp";
import { visuals } from "@/lib/visuals";

const title = "Prism — Projection Mapping in Your Browser";
const description =
  "Turn any projector into a projection mapping rig. Warp live visuals or your own photos and videos onto real surfaces, place sounds in a 3D room, and send visuals to a second screen — no software to install.";

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
  fit: "cover",
  flipH: false,
  flipV: false,
  rotate: 0,
  audioSource: "mic",
});

/** Fill in fields older saved surfaces may lack. */
const upgradeSurface = (
  s: Partial<Surface> & Pick<Surface, "id" | "corners" | "source">,
): Surface => ({
  ...newSurface(1, s.source),
  ...s,
});

function mountMedia(id: string, kind: MediaItem["kind"], blob: Blob) {
  const url = URL.createObjectURL(blob);
  if (kind === "video") {
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
  return url;
}

function Studio() {
  const [projectId, setProjectId] = useState(() => `p${Date.now()}`);
  const [projectName, setProjectName] = useState("Untitled show");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  const [surfaces, setSurfaces] = useState<Surface[]>(() => [newSurface(1, "visual:plasma")]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [sounds, setSounds] = useState<SoundItem[]>([]);
  const [selectedSoundId, setSelectedSoundId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomConfig>(defaultRoom);
  const [globals, setGlobals] = useState<Globals>(defaultGlobals);
  const [testPattern, setTestPattern] = useState<TestPattern>("off");

  const [mapping, setMapping] = useState(true);
  const [snap, setSnap] = useState(true);
  const [roomView, setRoomView] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [snapFlash, setSnapFlash] = useState<Pt | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("default");
  const [maxChannels, setMaxChannels] = useState(2);
  const [loaded, setLoaded] = useState(false);

  const micRef = useRef<MicAnalyser | null>(null);
  const engineRef = useRef<SpatialEngine | null>(null);
  const blobs = useRef<BlobMap>(new Map());
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const outputWin = useRef<Window | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  const selected = surfaces.find((s) => s.id === selectedId) ?? surfaces[0] ?? null;

  const engine = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = new SpatialEngine(room);
      setMaxChannels(engineRef.current.maxChannels);
    }
    return engineRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const levels = useCallback<AudioLevelProvider>((src) => {
    if (src === "mic") return micRef.current?.levels ?? silentLevels;
    return engineRef.current?.levels(src) ?? silentLevels;
  }, []);

  // ----- lifecycle -----
  useEffect(() => {
    if (!selectedId && surfaces[0]) setSelectedId(surfaces[0].id);
  }, [selectedId, surfaces]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setStage({ w: r.width, h: r.height });
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
      engineRef.current?.destroy();
      mediaElements.clear();
      channelRef.current?.postMessage({ type: "bye" } satisfies SyncMessage);
      channelRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const refresh = () =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((d) =>
          setDevices(d.filter((x) => x.kind === "audiooutput" && x.deviceId !== "default")),
        )
        .catch(() => undefined);
    void refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, []);

  useEffect(() => {
    engineRef.current?.applyRoom(room);
  }, [room]);

  // ----- projects -----
  const applyProject = useCallback(
    async (project: Project, b: BlobMap) => {
      engineRef.current?.destroy();
      engineRef.current = null;
      mediaElements.clear();
      blobs.current = new Map(b);
      setProjectId(project.id);
      setProjectName(project.name);
      setGlobals({ ...defaultGlobals(), ...project.globals });
      setRoom({ ...defaultRoom(), ...project.room });
      setTestPattern(project.testPattern ?? "off");
      setSurfaces(project.surfaces.map(upgradeSurface));
      setSelectedId(project.surfaces[0]?.id ?? null);
      const items: MediaItem[] = [];
      for (const m of project.media) {
        const blob = b.get(m.id);
        if (!blob) continue;
        items.push({ ...m, url: mountMedia(m.id, m.kind, blob) });
      }
      setMedia(items);
      const restored: SoundItem[] = [];
      if (project.sounds.length) {
        const eng = engine();
        for (const s of project.sounds) {
          const blob = b.get(s.id);
          if (!blob) continue;
          restored.push(await eng.addSound({ ...s, playing: false }, blob));
        }
      }
      setSounds(restored);
      setSelectedSoundId(restored[0]?.id ?? null);
      setSavedAt(project.updatedAt);
      localStorage.setItem(LAST_KEY, project.id);
      if (channelRef.current) sendMedia(channelRef.current, items);
    },
    [engine],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setProjects(await listProjects());
        const last = localStorage.getItem(LAST_KEY);
        if (last) {
          const res = await loadProject(last);
          if (res && !cancelled) await applyProject(res.project, res.blobs);
        }
      } catch {
        /* storage unavailable */
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyProject]);

  const buildProject = useCallback(
    (id = projectId, name = projectName): Project => ({
      id,
      name,
      updatedAt: Date.now(),
      surfaces,
      globals,
      media: media.map(({ id: mid, name: n, kind }) => ({ id: mid, name: n, kind })),
      sounds: sounds.map((s) => ({ ...s, playing: false })),
      room,
      testPattern,
    }),
    [projectId, projectName, surfaces, globals, media, sounds, room, testPattern],
  );

  const persist = useCallback(async (p: Project) => {
    try {
      await saveProject(p, blobs.current);
      setSavedAt(p.updatedAt);
      setProjects(await listProjects());
    } catch {
      /* storage unavailable */
    }
  }, []);

  // autosave
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => void persist(buildProject()), 3000);
    return () => clearTimeout(t);
  }, [loaded, buildProject, persist]);

  const openProject = async (id: string) => {
    const res = await loadProject(id);
    if (res) await applyProject(res.project, res.blobs);
  };

  const newProject = () => {
    const p: Project = {
      id: `p${Date.now()}`,
      name: "Untitled show",
      updatedAt: Date.now(),
      surfaces: [newSurface(1, "visual:plasma")],
      globals: defaultGlobals(),
      media: [],
      sounds: [],
      room: defaultRoom(),
      testPattern: "off",
    };
    void applyProject(p, new Map());
    setSavedAt(null);
  };

  // ----- output window -----
  const snapshot = useMemo<OutputSnapshot>(
    () => ({
      surfaces,
      globals,
      testPattern,
      media: media.map(({ id, name, kind }) => ({ id, name, kind })),
    }),
    [surfaces, globals, testPattern, media],
  );

  function sendMedia(ch: BroadcastChannel, items: MediaItem[]) {
    const payload = items
      .map((m) => ({
        meta: { id: m.id, name: m.name, kind: m.kind },
        file: blobs.current.get(m.id),
      }))
      .filter((x): x is { meta: Omit<MediaItem, "url">; file: Blob } => !!x.file);
    if (payload.length) ch.postMessage({ type: "media", items: payload } satisfies SyncMessage);
  }

  useEffect(() => {
    const ch = openChannel();
    if (!ch) return;
    channelRef.current = ch;
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<SyncMessage>) => {
      if (e.data.type === "hello") {
        setOutputOpen(true);
        sendMedia(ch, media);
        ch.postMessage({ type: "state", snapshot } satisfies SyncMessage);
      }
    };
    ch.postMessage({ type: "state", snapshot } satisfies SyncMessage);
  });

  useEffect(() => {
    const t = setInterval(() => {
      if (outputWin.current?.closed) {
        outputWin.current = null;
        setOutputOpen(false);
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const openOutput = () => {
    if (outputWin.current && !outputWin.current.closed) {
      outputWin.current.focus();
      return;
    }
    outputWin.current = window.open("/output", "prism-output", "popup,width=960,height=540");
  };

  // ----- mutators -----
  const patch = useCallback((id: string, next: Partial<Surface>) => {
    setSurfaces((prev) => prev.map((s) => (s.id === id ? { ...s, ...next } : s)));
  }, []);

  const patchRoom = (next: Partial<RoomConfig>) => setRoom((r) => ({ ...r, ...next }));

  const patchSound = (id: string, next: Partial<SoundItem>) => {
    setSounds((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const updated = { ...s, ...next };
        engineRef.current?.updateItem(updated);
        return updated;
      }),
    );
    if (next.solo !== undefined || next.mute !== undefined) {
      // solo affects everyone
      queueMicrotask(() => sounds.forEach((s) => s.id !== id && engineRef.current?.updateItem(s)));
    }
    if (next.playing) setTestPattern("off");
  };

  const removeSound = (id: string) => {
    engineRef.current?.removeSound(id);
    blobs.current.delete(id);
    setSounds((prev) => prev.filter((s) => s.id !== id));
    setSurfaces((prev) =>
      prev.map((s) => (s.audioSource === `sound:${id}` ? { ...s, audioSource: "master" } : s)),
    );
  };

  const addSounds = async (files: FileList | null) => {
    if (!files) return;
    const eng = engine();
    eng.resume();
    const added: SoundItem[] = [];
    let i = sounds.length;
    for (const file of Array.from(files)) {
      const id = `a${Date.now()}${i}`;
      const angle = (i / 6) * Math.PI * 2;
      const item: SoundItem = {
        id,
        name: file.name.replace(/\.[^.]+$/, ""),
        kind: "mono",
        channels: 1,
        position: { x: Math.sin(angle) * 0.5, y: -Math.cos(angle) * 0.5, z: 0 },
        gain: 1,
        loop: true,
        mute: false,
        solo: false,
        playing: false,
        color: SOUND_COLORS[i % SOUND_COLORS.length]!,
        heading: 0,
        duration: 0,
      };
      blobs.current.set(id, file);
      added.push(await eng.addSound(item, file));
      i++;
    }
    if (added.length) {
      setSounds((prev) => [...prev, ...added]);
      setSelectedSoundId(added[0]!.id);
    }
  };

  const playAll = () => {
    engine().resume();
    setTestPattern("off");
    setSounds((prev) =>
      prev.map((s) => {
        const u = { ...s, playing: true };
        engineRef.current?.updateItem(u);
        return u;
      }),
    );
  };
  const stopAll = () => {
    setSounds((prev) =>
      prev.map((s) => {
        const u = { ...s, playing: false };
        engineRef.current?.updateItem(u);
        engineRef.current?.stopSound(s.id);
        return u;
      }),
    );
  };

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
      blobs.current.set(id, file);
      const url = mountMedia(id, isVideo ? "video" : "image", file);
      added.push({ id, name: file.name, kind: isVideo ? "video" : "image", url });
    });
    if (added.length) {
      setMedia((prev) => [...prev, ...added]);
      if (selected && added[0]) patch(selected.id, { source: `media:${added[0].id}` });
      if (channelRef.current) sendMedia(channelRef.current, added);
    }
  };

  const dragCorner = (index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selected) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const candidates = snapCandidates(surfaces, selected.id);
    const move = (ev: PointerEvent) => {
      let p: Pt = {
        x: Math.min(1.4, Math.max(-0.4, (ev.clientX - rect.left) / rect.width)),
        y: Math.min(1.4, Math.max(-0.4, (ev.clientY - rect.top) / rect.height)),
      };
      let flash: Pt | null = null;
      if (snap && !ev.shiftKey) {
        const r = snapPoint(p, candidates, { w: rect.width, h: rect.height });
        p = r.point;
        flash = r.snapped ? r.target : null;
      }
      setSnapFlash(flash);
      setSurfaces((prev) =>
        prev.map((s) =>
          s.id === selected.id
            ? { ...s, corners: s.corners.map((c, i) => (i === index ? p : c)) }
            : s,
        ),
      );
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      setSnapFlash(null);
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
            Projection mapping and spatial sound straight from the browser.
          </p>
        </header>

        <section className="space-y-2">
          <SectionTitle>Project</SectionTitle>
          <ProjectsMenu
            name={projectName}
            savedAt={savedAt}
            projects={projects.filter((p) => p.id !== projectId)}
            onRename={setProjectName}
            onSave={() => void persist(buildProject())}
            onSaveAs={(name) => {
              const id = `p${Date.now()}`;
              setProjectId(id);
              setProjectName(name);
              void persist(buildProject(id, name));
            }}
            onNew={newProject}
            onOpen={(id) => void openProject(id)}
            onDuplicate={() => {
              const id = `p${Date.now()}`;
              const name = `${projectName} copy`;
              setProjectId(id);
              setProjectName(name);
              void persist(buildProject(id, name));
            }}
            onDelete={() => {
              void deleteProject(projectId).then(() => {
                newProject();
                void listProjects().then(setProjects);
              });
            }}
            onExport={() => {
              void exportProject(buildProject(), blobs.current).then((blob) => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${projectName.replace(/[^\w-]+/g, "_")}.prism`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
              });
            }}
            onImport={(file) => {
              void importProject(file)
                .then(({ project, blobs: b }) =>
                  applyProject(project, b).then(() => persist(project)),
                )
                .catch(() => window.alert("That file is not a Prism project."));
            }}
          />
        </section>

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
              Microphone
            </div>
            <Switch checked={micOn} onCheckedChange={() => void toggleMic()} />
          </div>
          <Labeled label="Brightness" value={`${Math.round(globals.brightness * 100)}%`}>
            <Slider
              value={[globals.brightness]}
              min={0.1}
              max={1.5}
              step={0.01}
              onValueChange={([v = 0]) => setGlobals((g) => ({ ...g, brightness: v }))}
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
              onValueChange={([v = 0]) => setGlobals((g) => ({ ...g, speed: v }))}
            />
          </Labeled>
          <Labeled label="Intensity" value={`${Math.round(globals.intensity * 100)}%`}>
            <Slider
              value={[globals.intensity]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={([v = 0]) => setGlobals((g) => ({ ...g, intensity: v }))}
            />
          </Labeled>
          <Labeled label="Colour" value={`${Math.round(globals.hue)}°`}>
            <Slider
              value={[globals.hue]}
              min={0}
              max={360}
              step={1}
              onValueChange={([v = 0]) => setGlobals((g) => ({ ...g, hue: v }))}
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
            {surfaces.map((s, idx) => (
              <li
                key={s.id}
                className={`rounded-lg border p-3 transition-colors ${
                  selected?.id === s.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-accent"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded bg-muted text-[10px] font-semibold tabular-nums">
                    {idx + 1}
                  </span>
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(s.id)}>
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
                        onValueChange={([v = 0]) => patch(s.id, { opacity: v })}
                      />
                    </Labeled>
                    <Labeled label="Colour shift" value={`${s.hueShift}°`}>
                      <Slider
                        value={[s.hueShift]}
                        min={0}
                        max={360}
                        step={1}
                        onValueChange={([v = 0]) => patch(s.id, { hueShift: v })}
                      />
                    </Labeled>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={s.fit === "cover" ? "default" : "secondary"}
                        className="flex-1"
                        onClick={() =>
                          patch(s.id, { fit: s.fit === "cover" ? "stretch" : "cover" })
                        }
                      >
                        {s.fit === "cover" ? "Fill" : "Stretch"}
                      </Button>
                      <Button
                        size="sm"
                        variant={s.flipH ? "default" : "secondary"}
                        aria-label="Flip horizontally"
                        onClick={() => patch(s.id, { flipH: !s.flipH })}
                      >
                        <FlipHorizontal2 className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant={s.flipV ? "default" : "secondary"}
                        aria-label="Flip vertically"
                        onClick={() => patch(s.id, { flipV: !s.flipV })}
                      >
                        <FlipVertical2 className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label="Rotate 90 degrees"
                        onClick={() => patch(s.id, { rotate: (s.rotate + 90) % 360 })}
                      >
                        <RotateCw className="size-4" />
                        <span className="text-[10px] tabular-nums">{s.rotate}°</span>
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="shrink-0 text-muted-foreground">Reacts to</span>
                      <Select
                        value={s.audioSource}
                        onValueChange={(v) => patch(s.id, { audioSource: v })}
                      >
                        <SelectTrigger className="h-8 flex-1" aria-label="Audio source">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mic">Microphone</SelectItem>
                          <SelectItem value="master">All sounds (master)</SelectItem>
                          {sounds.map((snd) => (
                            <SelectItem key={snd.id} value={`sound:${snd.id}`}>
                              {snd.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
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
              <TabsTrigger value="sound" className="flex-1">
                Sound
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
                          onClick={() =>
                            selected && patch(selected.id, { source: `visual:${v.id}` })
                          }
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
                        <ImageIcon className="absolute bottom-1 right-1 size-3 text-foreground/70" />
                      </button>
                    );
                  })}
                </div>
              )}
            </TabsContent>
            <TabsContent value="sound" className="pt-3">
              <SoundPanel
                sounds={sounds}
                selectedId={selectedSoundId}
                onSelect={setSelectedSoundId}
                onAdd={(f) => void addSounds(f)}
                onPatch={patchSound}
                onRemove={removeSound}
                onPlayAll={playAll}
                onStopAll={stopAll}
                room={room}
                onRoom={patchRoom}
                maxChannels={maxChannels}
                devices={devices}
                deviceId={deviceId}
                onDevice={(id) => {
                  setDeviceId(id);
                  void engine()
                    .setOutputDevice(id === "default" ? "" : id)
                    .then(() => setMaxChannels(engine().maxChannels))
                    .catch(() => undefined);
                }}
              />
            </TabsContent>
          </Tabs>
        </section>
      </aside>

      {/* Stage */}
      <main className="relative flex min-h-0 flex-1 flex-col bg-black">
        {!fullscreen && (
          <MappingToolbar
            mapping={mapping}
            onMapping={() => setMapping((m) => !m)}
            snap={snap}
            onSnap={() => setSnap((s) => !s)}
            testPattern={testPattern}
            onTestPattern={setTestPattern}
            roomView={roomView}
            onRoomView={() => setRoomView((r) => !r)}
            outputOpen={outputOpen}
            onOpenOutput={openOutput}
          />
        )}
        <div className="relative min-h-0 flex-1 bg-black" ref={stageRef}>
          {surfaces.map((s, i) => (
            <SurfaceLayer
              key={s.id}
              surface={s}
              index={i}
              stage={stage}
              globals={
                roomView && !fullscreen
                  ? { ...globals, brightness: globals.brightness * 0.35 }
                  : globals
              }
              testPattern={testPattern}
              levels={levels}
            />
          ))}
          {roomView && !fullscreen && (
            <RoomView
              stage={stage}
              sounds={sounds}
              selectedId={selectedSoundId}
              room={room}
              onSelect={setSelectedSoundId}
              onMoveSound={(id, position) => patchSound(id, { position })}
              onMoveListener={(listener) => patchRoom({ listener })}
              onMoveSpeaker={(id, position) =>
                patchRoom({
                  speakers: room.speakers.map((sp) => (sp.id === id ? { ...sp, position } : sp)),
                })
              }
            />
          )}
          {mapping && !fullscreen && !roomView && (
            <>
              {surfaces
                .filter((s) => s.id !== selected?.id && s.visible)
                .map((s) => (
                  <svg key={s.id} className="pointer-events-none absolute inset-0 size-full">
                    <polygon
                      points={s.corners.map((c) => `${c.x * stage.w},${c.y * stage.h}`).join(" ")}
                      className="fill-none stroke-muted-foreground/40"
                      strokeDasharray="4 4"
                    />
                  </svg>
                ))}
              {selected?.corners.map((c, i) => (
                <div
                  key={i}
                  onPointerDown={dragCorner(i)}
                  className="absolute z-10 grid size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center rounded-full border-2 border-primary bg-primary/30 text-[9px] font-bold text-foreground active:cursor-grabbing"
                  style={{ left: c.x * stage.w, top: c.y * stage.h }}
                >
                  {i + 1}
                </div>
              ))}
              {snapFlash && (
                <div
                  className="pointer-events-none absolute z-20 size-9 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-primary"
                  style={{ left: snapFlash.x * stage.w, top: snapFlash.y * stage.h }}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
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
  children: ReactNode;
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
