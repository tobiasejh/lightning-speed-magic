import { createFileRoute } from "@tanstack/react-router";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Plus,
  RotateCw,
  Scissors,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { MappingToolbar, type StageView } from "@/components/MappingToolbar";
import { MediaEditor } from "@/components/MediaEditor";
import { PairBanner } from "@/components/PairBanner";
import { ProjectsMenu } from "@/components/ProjectsMenu";
import { RoomView } from "@/components/RoomView";
import { ShowPanel } from "@/components/ShowPanel";
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
import { supabase } from "@/integrations/supabase/client";
import { MicAnalyser, silentLevels, type AudioLevelProvider } from "@/lib/audio";
import { SpatialEngine } from "@/lib/audio-engine";
import { History, type ShowSnapshot } from "@/lib/history";
import { snapCandidates, snapPoint } from "@/lib/snap";
import { activeClipsAt, positionOnPath, timelineLength, upgradePath } from "@/lib/timeline";
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
  defaultBlend,
  defaultOutputs,
  defaultRegion,
  defaultRoom,
  splitOutputsEvenly,
  upgradeOutput,
  mediaElements,
  mediaMeta,
  type Crop,
  type Globals,
  type MediaItem,
  type OutputScreen,
  type Project,
  type RoomConfig,
  type Scene,
  type SoundPath,
  type SoundItem,
  type Surface,
  type TestPattern,
  type TimelineCue,
  type TimelineClip,
  type TimelineTrack,
  type Vec3,
} from "@/lib/types";
import { clampCorners, clampPoint, defaultCorners, lockRectAspect, type Pt } from "@/lib/warp";
import { visuals } from "@/lib/visuals";
import { decodeWaveform } from "@/lib/waveform";

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
  outputId: "out1",
  renderW: 1280,
  renderH: 720,
  lockAspect: false,
});

const RESOLUTION_PRESETS = [
  { label: "1920×1080", w: 1920, h: 1080 },
  { label: "1280×800", w: 1280, h: 800 },
  { label: "1024×768", w: 1024, h: 768 },
  { label: "800×600", w: 800, h: 600 },
];

/** Fill in fields older saved surfaces may lack. */
const upgradeSurface = (
  s: Partial<Surface> & Pick<Surface, "id" | "corners" | "source">,
): Surface => ({
  ...newSurface(1, s.source),
  ...s,
  corners: clampCorners(s.corners),
});

const defaultTimelineTracks = (): TimelineTrack[] => [
  { id: "track-visual-1", name: "Visual 1", kind: "visual", muted: false, solo: false },
  { id: "track-audio-1", name: "Audio 1", kind: "audio", muted: false, solo: false },
  { id: "track-movement-1", name: "Movement 1", kind: "movement", muted: false, solo: false },
];

function mountMedia(meta: Omit<MediaItem, "url">, blob: Blob) {
  const url = URL.createObjectURL(blob);
  if (meta.kind === "video") {
    const v = document.createElement("video");
    v.src = url;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    if (meta.trimStart) v.currentTime = meta.trimStart;
    void v.play();
    mediaElements.set(meta.id, v);
  } else {
    const img = new Image();
    img.src = url;
    mediaElements.set(meta.id, img);
  }
  mediaMeta.set(meta.id, meta);
  return url;
}

/** Best-effort check for an audio track in a video file. */
function videoHasAudio(v: HTMLVideoElement) {
  const a = v as unknown as {
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
    audioTracks?: { length: number };
  };
  if (a.audioTracks) return a.audioTracks.length > 0;
  if (typeof a.mozHasAudio === "boolean") return a.mozHasAudio;
  if (typeof a.webkitAudioDecodedByteCount === "number") return a.webkitAudioDecodedByteCount > 0;
  return true;
}

const videoSoundId = (mediaId: string) => `vs-${mediaId}`;

const newVideoSound = (m: Omit<MediaItem, "url">, i: number, playing: boolean): SoundItem => ({
  id: videoSoundId(m.id),
  name: `${m.name} (video)`,
  kind: "video",
  channels: 2,
  position: { x: 0, y: -0.3, z: 0 },
  gain: 1,
  loop: true,
  mute: false,
  solo: false,
  playing,
  color: SOUND_COLORS[i % SOUND_COLORS.length]!,
  heading: 0,
  duration: 0,
  mediaId: m.id,
});

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

  const [outputs, setOutputs] = useState<OutputScreen[]>(defaultOutputs);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [cues, setCues] = useState<TimelineCue[]>([]);
  const [timelineTracks, setTimelineTracks] = useState<TimelineTrack[]>(defaultTimelineTracks);
  const [timelineClips, setTimelineClips] = useState<TimelineClip[]>([]);
  const [soundPaths, setSoundPaths] = useState<SoundPath[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [activePathId, setActivePathId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [movementPositions, setMovementPositions] = useState<Record<string, Vec3>>({});
  const [showPlaying, setShowPlaying] = useState(false);
  const [showTime, setShowTime] = useState(0);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);

  const [mapping, setMapping] = useState(true);
  const [snap, setSnap] = useState(true);
  const [view, setView] = useState<StageView>("stage");
  const [editMediaId, setEditMediaId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [snapFlash, setSnapFlash] = useState<Pt | null>(null);
  const [openOutputs, setOpenOutputs] = useState<string[]>([]);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [remoteConnected, setRemoteConnected] = useState(false);
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
  const outputWins = useRef(new Map<string, Window>());
  const showStart = useRef(0);
  const activeTimelineClips = useRef(new Set<string>());
  const surfacesRef = useRef(surfaces);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  useEffect(() => {
    surfacesRef.current = surfaces;
  }, [surfaces]);

  const selected = surfaces.find((s) => s.id === selectedId) ?? surfaces[0] ?? null;

  // ----- undo / redo -----
  const history = useRef(new History());
  const restoring = useRef(false);
  const snapshot = useMemo<ShowSnapshot>(
    () => ({
      surfaces,
      tracks: timelineTracks,
      clips: timelineClips,
      paths: soundPaths,
      outputs,
      room,
      globals,
    }),
    [surfaces, timelineTracks, timelineClips, soundPaths, outputs, room, globals],
  );
  const snapRef = useRef(snapshot);
  useEffect(() => {
    if (restoring.current) restoring.current = false;
    else if (loaded) history.current.push(snapRef.current);
    snapRef.current = snapshot;
  }, [snapshot, loaded]);

  const applySnapshot = useCallback((s: ShowSnapshot) => {
    restoring.current = true;
    setSurfaces(s.surfaces);
    setTimelineTracks(s.tracks);
    setTimelineClips(s.clips);
    setSoundPaths(s.paths);
    setOutputs(s.outputs);
    setRoom(s.room);
    setGlobals(s.globals);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      // let people type (and use the browser's own undo) inside fields
      if (el && (el.closest("input, textarea, [contenteditable='true']") || el.isContentEditable))
        return;
      const undoKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z";
      const redoKey =
        (event.metaKey || event.ctrlKey) &&
        (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"));
      if (redoKey) {
        const next = history.current.redo(snapRef.current);
        if (next) applySnapshot(next);
        event.preventDefault();
        return;
      }
      if (undoKey) {
        const previous = history.current.undo(snapRef.current);
        if (previous) applySnapshot(previous);
        event.preventDefault();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedClipId) {
        setTimelineClips((prev) => prev.filter((clip) => clip.id !== selectedClipId));
        setSelectedClipId(null);
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applySnapshot, selectedClipId]);

  const timelineSurfaceSources = useMemo(() => {
    const result = new Map<string, string>();
    for (const clip of activeClipsAt(timelineTracks, timelineClips, showTime)) {
      if (clip.kind === "visual" && clip.surfaceId && clip.mediaId) {
        result.set(clip.surfaceId, `media:${clip.mediaId}`);
      }
    }
    return result;
  }, [showTime, timelineClips, timelineTracks]);

  const displaySurfaces = useMemo(
    () =>
      surfaces.map((surface) => {
        const source = timelineSurfaceSources.get(surface.id);
        return source ? { ...surface, source } : surface;
      }),
    [surfaces, timelineSurfaceSources],
  );

  const displaySounds = useMemo(
    () =>
      sounds.map((sound) => {
        const position = movementPositions[sound.id];
        return position ? { ...sound, position } : sound;
      }),
    [movementPositions, sounds],
  );

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
      setOutputs(project.outputs?.length ? project.outputs.map(upgradeOutput) : defaultOutputs());
      setScenes(project.scenes ?? []);
      setCues(project.timeline ?? []);
      setTimelineTracks(
        project.timelineTracks?.length ? project.timelineTracks : defaultTimelineTracks(),
      );
      setTimelineClips(project.timelineClips ?? []);
      const paths = (project.soundPaths ?? []).map(upgradePath);
      setSoundPaths(paths);
      // bring back what was selected so the clip inspector and lanes reappear
      const clips = project.timelineClips ?? [];
      const savedClip = clips.find((clip) => clip.id === project.selectedClipId);
      setSelectedClipId(savedClip?.id ?? clips[0]?.id ?? null);
      setActivePathId(
        paths.find((path) => path.id === project.activePathId)?.id ?? paths[0]?.id ?? null,
      );
      setShowPlaying(false);
      setShowTime(0);
      mediaMeta.clear();
      const items: MediaItem[] = [];
      for (const m of project.media) {
        const meta = { ...m, blobId: m.blobId || m.id };
        const blob = b.get(meta.blobId);
        if (!blob) continue;
        items.push({ ...meta, url: mountMedia(meta, blob) });
      }
      setMedia(items);
      setEditMediaId(items[0]?.id ?? null);
      const restored: SoundItem[] = [];
      if (project.sounds.length) {
        const eng = engine();
        for (const s of project.sounds) {
          if (s.kind === "video") {
            const el = s.mediaId ? mediaElements.get(s.mediaId) : null;
            if (el instanceof HTMLVideoElement) restored.push(eng.addElementSound(s, el));
            continue;
          }
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
      version: 8,
      id,
      name,
      updatedAt: Date.now(),
      surfaces,
      globals,
      media: media.map(({ url: _url, ...rest }) => rest),
      sounds: sounds.map((s) => ({ ...s, playing: false })),
      room,
      testPattern,
      outputs,
      scenes,
      timeline: cues,
      timelineTracks,
      timelineClips,
      soundPaths,
      selectedClipId,
      activePathId,
    }),
    [
      selectedClipId,
      activePathId,
      projectId,
      projectName,
      surfaces,
      globals,
      media,
      sounds,
      room,
      testPattern,
      outputs,
      scenes,
      cues,
      timelineTracks,
      timelineClips,
      soundPaths,
    ],
  );

  const persist = useCallback(async (p: Project) => {
    try {
      await saveProject(p, blobs.current);
      setSavedAt(p.updatedAt);
      setSaveError(null);
      setProjects(await listProjects());
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? `Could not save this show: ${error.message}`
          : "Could not save this show on this device.",
      );
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
      outputs: defaultOutputs(),
      scenes: [],
      timeline: [],
      timelineTracks: defaultTimelineTracks(),
      timelineClips: [],
      soundPaths: [],
    };
    void applyProject(p, new Map());
    setSavedAt(null);
  };

  // ----- output windows -----
  const snapshot = useMemo<OutputSnapshot>(
    () => ({
      surfaces: displaySurfaces,
      globals,
      testPattern,
      media: media.map(({ url: _url, ...rest }) => rest),
      outputs,
    }),
    [displaySurfaces, globals, testPattern, media, outputs],
  );

  function sendMedia(ch: BroadcastChannel, items: MediaItem[]) {
    const payload = items
      .map((m) => ({
        meta: { ...m, url: undefined } as unknown as Omit<MediaItem, "url">,
        file: blobs.current.get(m.blobId),
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
        const id = e.data.outputId ?? "out1";
        setOpenOutputs((prev) => (prev.includes(id) ? prev : [...prev, id]));
        sendMedia(ch, media);
        ch.postMessage({ type: "state", snapshot } satisfies SyncMessage);
      }
    };
    ch.postMessage({ type: "state", snapshot } satisfies SyncMessage);
  });

  useEffect(() => {
    const t = setInterval(() => {
      let changed = false;
      for (const [id, win] of [...outputWins.current]) {
        if (win.closed) {
          outputWins.current.delete(id);
          changed = true;
        }
      }
      if (changed) setOpenOutputs([...outputWins.current.keys()]);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // share the show clock so every projector window plays the same frame
  const clockState = useRef({
    playing: showPlaying,
    time: showTime,
    clips: timelineClips,
    tracks: timelineTracks,
  });
  clockState.current = {
    playing: showPlaying,
    time: showTime,
    clips: timelineClips,
    tracks: timelineTracks,
  };

  useEffect(() => {
    const t = setInterval(() => {
      const ch = channelRef.current;
      if (!ch) return;
      const { playing, time, clips, tracks } = clockState.current;
      const videos: Record<string, number> = {};
      for (const clip of activeClipsAt(tracks, clips, time)) {
        if (clip.kind !== "visual" || !clip.mediaId) continue;
        videos[clip.mediaId] = clip.inPoint + Math.max(0, time - clip.start);
      }
      ch.postMessage({ type: "clock", playing, time, videos } satisfies SyncMessage);
    }, 250);
    return () => clearInterval(t);
  }, []);

  const openOutput = (id: string) => {
    const existing = outputWins.current.get(id);
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    const win = window.open(
      `/output?id=${encodeURIComponent(id)}`,
      `prism-${id}`,
      "popup,width=960,height=540",
    );
    if (win) {
      outputWins.current.set(id, win);
      setOpenOutputs([...outputWins.current.keys()]);
    }
  };

  // ----- mutators -----
  const patch = useCallback((id: string, next: Partial<Surface>) => {
    setSurfaces((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        return { ...s, ...next, corners: next.corners ? clampCorners(next.corners) : s.corners };
      }),
    );
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
    // keep a separately uploaded soundtrack lined up with its video
    if (next.playing !== undefined) {
      const src = sounds.find((x) => x.id === id);
      const item = src?.mediaId ? media.find((m) => m.id === src.mediaId) : null;
      const linkId = item?.syncSoundId;
      if (linkId) {
        const el = src?.mediaId ? mediaElements.get(src.mediaId) : null;
        const at = el instanceof HTMLVideoElement ? el.currentTime : 0;
        engineRef.current?.seek(linkId, at + (item?.syncOffset ?? 0));
        setSounds((prev) =>
          prev.map((s) => {
            if (s.id !== linkId) return s;
            const u = { ...s, playing: !!next.playing };
            engineRef.current?.updateItem(u);
            return u;
          }),
        );
      }
    }
  };

  const removeSound = (id: string) => {
    engineRef.current?.removeSound(id);
    blobs.current.delete(id);
    setSounds((prev) => prev.filter((s) => s.id !== id));
    setSoundPaths((prev) => prev.filter((path) => path.soundId !== id));
    setTimelineClips((prev) => prev.filter((clip) => clip.soundId !== id));
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
      const wave = await decodeWaveform(file);
      added.push(await eng.addSound({ ...item, peaks: wave?.peaks }, file));
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

  /** Give a video's own audio track a row in the Sound tab. */
  const registerVideoSound = (item: MediaItem) => {
    const el = mediaElements.get(item.id);
    if (!(el instanceof HTMLVideoElement)) return;
    const eng = engine();
    eng.resume();
    const i = sounds.length;
    const angle = (i / 6) * Math.PI * 2;
    const sound: SoundItem = {
      id: `v${item.id}`,
      name: `${item.name} (video sound)`,
      kind: "video",
      channels: 2,
      position: { x: Math.sin(angle) * 0.4, y: -Math.cos(angle) * 0.4, z: 0 },
      gain: 1,
      loop: true,
      mute: false,
      solo: false,
      playing: true,
      color: SOUND_COLORS[i % SOUND_COLORS.length]!,
      heading: 0,
      duration: el.duration || 0,
      mediaId: item.id,
    };
    const added = eng.addElementSound(sound, el);
    setSounds((prev) => (prev.some((s) => s.id === added.id) ? prev : [...prev, added]));
  };

  const addMedia = (files: FileList | null) => {
    if (!files) return;
    const added: MediaItem[] = [];
    Array.from(files).forEach((file, i) => {
      const isVideo = file.type.startsWith("video");
      if (!isVideo && !file.type.startsWith("image")) return;
      const id = `m${Date.now()}${i}`;
      blobs.current.set(id, file);
      const meta: Omit<MediaItem, "url"> = {
        id,
        blobId: id,
        name: file.name.replace(/\.[^.]+$/, ""),
        kind: isVideo ? "video" : "image",
        hasAudio: isVideo,
      };
      added.push({ ...meta, url: mountMedia(meta, file) });
    });
    if (!added.length) return;
    setMedia((prev) => [...prev, ...added]);
    setEditMediaId(added[0]!.id);
    if (selected && added[0]) patch(selected.id, { source: `media:${added[0].id}` });
    if (channelRef.current) sendMedia(channelRef.current, added);
    for (const item of added) {
      if (item.kind !== "video") continue;
      const el = mediaElements.get(item.id);
      if (!(el instanceof HTMLVideoElement)) continue;
      const check = () => {
        const has = videoHasAudio(el);
        setMedia((prev) => prev.map((m) => (m.id === item.id ? { ...m, hasAudio: has } : m)));
        if (has) registerVideoSound(item);
      };
      if (el.readyState >= 1) setTimeout(check, 300);
      else el.addEventListener("loadeddata", () => setTimeout(check, 300), { once: true });
      // remember the real length so dropped clips match the file, and its loudness overview
      const noteLength = () =>
        setMedia((prev) =>
          prev.map((m) => (m.id === item.id ? { ...m, duration: el.duration || undefined } : m)),
        );
      if (Number.isFinite(el.duration) && el.duration) noteLength();
      else el.addEventListener("loadedmetadata", noteLength, { once: true });
      const file = blobs.current.get(item.blobId);
      if (file)
        void decodeWaveform(file).then((wave) => {
          if (!wave) return;
          setMedia((prev) =>
            prev.map((m) =>
              m.id === item.id
                ? { ...m, peaks: wave.peaks, duration: m.duration ?? wave.duration }
                : m,
            ),
          );
        });
    }
  };

  const patchMedia = (id: string, next: Partial<MediaItem>) => {
    setMedia((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const u = { ...m, ...next };
        const { url: _url, ...meta } = u;
        mediaMeta.set(id, meta);
        const el = mediaElements.get(id);
        if (el instanceof HTMLVideoElement && next.trimStart !== undefined)
          el.currentTime = next.trimStart;
        return u;
      }),
    );
  };

  const removeMedia = (id: string) => {
    const item = media.find((m) => m.id === id);
    for (const s of sounds.filter((s) => s.mediaId === id)) removeSound(s.id);
    const el = mediaElements.get(id);
    if (el instanceof HTMLVideoElement) el.pause();
    mediaElements.delete(id);
    mediaMeta.delete(id);
    if (item) URL.revokeObjectURL(item.url);
    const rest = media.filter((m) => m.id !== id);
    if (item && !rest.some((m) => m.blobId === item.blobId)) blobs.current.delete(item.blobId);
    setMedia(rest);
    setTimelineClips((prev) => prev.filter((clip) => clip.mediaId !== id));
    setEditMediaId((cur) => (cur === id ? (rest[0]?.id ?? null) : cur));
    setSurfaces((prev) =>
      prev.map((s) => (s.source === `media:${id}` ? { ...s, source: "visual:plasma" } : s)),
    );
    channelRef.current?.postMessage({ type: "drop-media", ids: [id] } satisfies SyncMessage);
  };

  /** Save a cropped / trimmed piece of an existing item as its own clip. */
  const saveClip = (from: MediaItem, changes: Partial<MediaItem>, name: string) => {
    const blob = blobs.current.get(from.blobId);
    if (!blob) return;
    const id = `m${Date.now()}`;
    const meta: Omit<MediaItem, "url"> = {
      ...from,
      ...changes,
      id,
      blobId: from.blobId,
      name,
      syncSoundId: undefined,
    };
    const item: MediaItem = { ...meta, url: mountMedia(meta, blob) };
    setMedia((prev) => [...prev, item]);
    setEditMediaId(id);
    if (channelRef.current) sendMedia(channelRef.current, [item]);
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
      p = clampPoint(p);
      setSnapFlash(flash);
      setSurfaces((prev) =>
        prev.map((s) => {
          if (s.id !== selected.id) return s;
          const moved = s.corners.map((c, i) => (i === index ? p : c));
          return {
            ...s,
            corners: s.lockAspect
              ? lockRectAspect(moved, index, (s.renderW || 16) / (s.renderH || 9), {
                  w: rect.width,
                  h: rect.height,
                })
              : moved,
          };
        }),
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

  // ----- legacy scenes and v5 timeline -----
  const saveScene = () => {
    const scene: Scene = {
      id: `sc${Date.now()}`,
      name: `Scene ${scenes.length + 1}`,
      surfaces: surfaces.map((s) => ({ ...s, corners: s.corners.map((c) => ({ ...c })) })),
      globals: { ...globals },
      testPattern,
    };
    setScenes((prev) => [...prev, scene]);
    setActiveSceneId(scene.id);
  };

  const recallScene = useCallback(
    (id: string) => {
      const sc = scenes.find((s) => s.id === id);
      if (!sc) return;
      setSurfaces(sc.surfaces.map(upgradeSurface));
      setGlobals((g) => ({ ...g, ...sc.globals, blackout: g.blackout }));
      setTestPattern(sc.testPattern ?? "off");
      setActiveSceneId(id);
    },
    [scenes],
  );

  const applyTimelineAt = useCallback(
    (time: number, playing: boolean) => {
      const active = activeClipsAt(timelineTracks, timelineClips, time);
      const nextIds = new Set(active.map((clip) => clip.id));
      const activeSoundIds = new Set(
        active
          .filter((clip) => clip.kind === "audio")
          .map((clip) => clip.soundId)
          .filter((id): id is string => !!id),
      );
      const activeVideoIds = new Set(
        active
          .filter((clip) => clip.kind === "visual")
          .map((clip) => clip.mediaId)
          .filter((id): id is string => !!id),
      );

      for (const clip of active) {
        const localTime = clip.inPoint + Math.max(0, time - clip.start);
        if (clip.kind === "visual" && clip.mediaId) {
          const element = mediaElements.get(clip.mediaId);
          if (element instanceof HTMLVideoElement) {
            if (
              !playing ||
              !activeTimelineClips.current.has(clip.id) ||
              Math.abs(element.currentTime - localTime) > 0.3
            )
              element.currentTime = localTime;
            if (playing) void element.play().catch(() => undefined);
            else element.pause();
          }
        } else if (clip.kind === "audio" && clip.soundId) {
          if (!activeTimelineClips.current.has(clip.id) || !playing)
            engineRef.current?.seek(clip.soundId, localTime);
          if (playing) engineRef.current?.playSound(clip.soundId);
          else engineRef.current?.pauseSound(clip.soundId);
        } else if (clip.kind === "movement" && clip.pathId && clip.soundId) {
          const path = soundPaths.find((item) => item.id === clip.pathId);
          if (!path) continue;
          const position = positionOnPath(path, Math.max(0, time - clip.start));
          if (position) {
            engineRef.current?.setPosition(clip.soundId, position);
            setMovementPositions((current) => {
              const previous = current[clip.soundId!];
              if (
                previous &&
                Math.abs(previous.x - position.x) < 0.002 &&
                Math.abs(previous.y - position.y) < 0.002
              )
                return current;
              return { ...current, [clip.soundId!]: position };
            });
          }
        }
      }
      for (const clip of timelineClips) {
        if (nextIds.has(clip.id)) continue;
        if (clip.kind === "audio" && clip.soundId && !activeSoundIds.has(clip.soundId))
          engineRef.current?.pauseSound(clip.soundId);
        if (clip.kind === "visual" && clip.mediaId && !activeVideoIds.has(clip.mediaId)) {
          const element = mediaElements.get(clip.mediaId);
          if (element instanceof HTMLVideoElement) element.pause();
        }
      }
      activeTimelineClips.current = nextIds;
    },
    [soundPaths, timelineClips, timelineTracks],
  );

  const runShow = () => {
    if (!timelineClips.length) return;
    engine().resume();
    showStart.current = performance.now() - showTime * 1000;
    setShowPlaying(true);
  };

  const pauseShow = () => {
    setShowPlaying(false);
    applyTimelineAt(showTime, false);
  };

  const stopShow = () => {
    setShowPlaying(false);
    setShowTime(0);
    setMovementPositions({});
    activeTimelineClips.current.clear();
    applyTimelineAt(0, false);
  };

  const seekShow = (time: number) => {
    const next = Math.max(0, Math.min(timelineLength(timelineClips), time));
    setShowTime(next);
    if (showPlaying) showStart.current = performance.now() - next * 1000;
    applyTimelineAt(next, showPlaying);
  };

  useEffect(() => {
    if (!showPlaying) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = (performance.now() - showStart.current) / 1000;
      setShowTime(t);
      applyTimelineAt(t, true);
      if (t >= timelineLength(timelineClips)) {
        setShowPlaying(false);
        applyTimelineAt(t, false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showPlaying, timelineClips, applyTimelineAt]);

  // ----- tablet pairing (relay only, files stay here) -----
  const remoteRef = useRef<RealtimeChannel | null>(null);
  const startPairing = () => {
    if (pairCode) {
      setPairCode(null);
      remoteRef.current?.unsubscribe();
      remoteRef.current = null;
      setRemoteConnected(false);
      return;
    }
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    setPairCode(code);
  };

  useEffect(() => {
    if (!pairCode) return;
    const ch = supabase.channel(`prism-${pairCode}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "join" }, () => {
      setRemoteConnected(true);
      ch.send({ type: "broadcast", event: "state", payload: { surfaces: surfacesRef.current } });
    })
      .on("broadcast", { event: "corners" }, ({ payload }) => {
        const { id, corners } = payload as { id: string; corners: Pt[] };
        setSurfaces((prev) =>
          prev.map((s) => (s.id === id ? { ...s, corners: clampCorners(corners) } : s)),
        );
      })
      .on("broadcast", { event: "select" }, ({ payload }) => {
        setSelectedId((payload as { id: string }).id);
      })
      .subscribe();
    remoteRef.current = ch;
    return () => {
      void ch.unsubscribe();
      remoteRef.current = null;
    };
  }, [pairCode]);

  useEffect(() => {
    if (!remoteConnected) return;
    remoteRef.current?.send({ type: "broadcast", event: "state", payload: { surfaces } });
  }, [surfaces, remoteConnected]);

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

        {/* Show */}
        <section className="space-y-3">
          <SectionTitle>Show</SectionTitle>
          {saveError && (
            <p
              role="alert"
              className="rounded border border-destructive/60 p-2 text-xs text-destructive"
            >
              {saveError}
            </p>
          )}
          <ShowPanel
            tracks={timelineTracks}
            clips={timelineClips}
            media={media}
            sounds={sounds}
            paths={soundPaths}
            surfaces={surfaces}
            outputs={outputs}
            openOutputs={openOutputs}
            playing={showPlaying}
            time={showTime}
            zoom={timelineZoom}
            selectedClipId={selectedClipId}
            onTracks={setTimelineTracks}
            onClips={setTimelineClips}
            onSelectClip={setSelectedClipId}
            onPlay={runShow}
            onPause={pauseShow}
            onStop={stopShow}
            onSeek={seekShow}
            onZoom={setTimelineZoom}
            onAddOutput={() =>
              setOutputs((prev) => [
                ...prev,
                {
                  id: `out${prev.length + 1}`,
                  name: `Projector ${prev.length + 1}`,
                  region: defaultRegion(),
                  blend: defaultBlend(),
                },
              ])
            }
            onRemoveOutput={(id) => {
              setOutputs((prev) => prev.filter((o) => o.id !== id));
              setSurfaces((prev) =>
                prev.map((s) => (s.outputId === id ? { ...s, outputId: "out1" } : s)),
              );
            }}
            onPatchOutput={(id, next) =>
              setOutputs((prev) => prev.map((o) => (o.id === id ? { ...o, ...next } : o)))
            }
            onSplitOutputs={(overlap) => setOutputs((prev) => splitOutputsEvenly(prev, overlap))}
            onOpenOutput={openOutput}
            onPatchPath={(path) =>
              setSoundPaths((prev) =>
                prev.some((item) => item.id === path.id)
                  ? prev.map((item) => (item.id === path.id ? path : item))
                  : [...prev, path],
              )
            }
          />
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
                    {outputs.length > 1 && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="shrink-0 text-muted-foreground">Projector</span>
                        <Select
                          value={s.outputId}
                          onValueChange={(v) => patch(s.id, { outputId: v })}
                        >
                          <SelectTrigger className="h-8 flex-1" aria-label="Projector">
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
                    <div className="space-y-1.5 rounded border border-border p-2">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Resolution
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={64}
                          max={3840}
                          aria-label="Surface width in pixels"
                          value={s.renderW}
                          onChange={(e) =>
                            patch(s.id, {
                              renderW: Math.max(64, Math.min(3840, Number(e.target.value) || 64)),
                            })
                          }
                          className="w-20 rounded border border-border bg-background px-1 py-0.5 text-xs tabular-nums"
                        />
                        <span className="text-xs text-muted-foreground">×</span>
                        <input
                          type="number"
                          min={64}
                          max={2160}
                          aria-label="Surface height in pixels"
                          value={s.renderH}
                          onChange={(e) =>
                            patch(s.id, {
                              renderH: Math.max(64, Math.min(2160, Number(e.target.value) || 64)),
                            })
                          }
                          className="w-20 rounded border border-border bg-background px-1 py-0.5 text-xs tabular-nums"
                        />
                        <Button
                          size="sm"
                          variant={s.lockAspect ? "default" : "secondary"}
                          onClick={() => patch(s.id, { lockAspect: !s.lockAspect })}
                        >
                          {s.lockAspect ? "Shape locked" : "Lock shape"}
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {RESOLUTION_PRESETS.map((preset) => (
                          <Button
                            key={preset.label}
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-[10px]"
                            onClick={() => patch(s.id, { renderW: preset.w, renderH: preset.h })}
                          >
                            {preset.label}
                          </Button>
                        ))}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[10px]"
                          onClick={() => {
                            const el = s.source.startsWith("media:")
                              ? mediaElements.get(s.source.slice(6))
                              : null;
                            if (!el) return;
                            const w =
                              el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
                            const h =
                              el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
                            if (w && h) patch(s.id, { renderW: w, renderH: h });
                          }}
                        >
                          Match source
                        </Button>
                      </div>
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
                      <div
                        key={m.id}
                        className={`relative aspect-square overflow-hidden rounded-md border ${
                          active ? "border-primary" : "border-border"
                        }`}
                      >
                        <button
                          title={m.name}
                          onClick={() =>
                            selected && patch(selected.id, { source: `media:${m.id}` })
                          }
                          className="size-full"
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
                        </button>
                        <button
                          aria-label={`Edit ${m.name}`}
                          onClick={() => {
                            setEditMediaId(m.id);
                            setView("editor");
                          }}
                          className="absolute bottom-0.5 left-0.5 rounded bg-background/80 p-0.5 text-foreground/80 hover:text-primary"
                        >
                          <Scissors className="size-3" />
                        </button>
                        <button
                          aria-label={`Delete ${m.name}`}
                          onClick={() => removeMedia(m.id)}
                          className="absolute right-0.5 top-0.5 rounded bg-background/80 p-0.5 text-foreground/80 hover:text-destructive"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
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
            view={view}
            onView={setView}
            onPair={startPairing}
            paired={remoteConnected}
          />
        )}
        {pairCode && !fullscreen && (
          <PairBanner code={pairCode} connected={remoteConnected} onStop={startPairing} />
        )}
        <div className="relative min-h-0 flex-1 bg-black" ref={stageRef}>
          {displaySurfaces.map((s, i) => (
            <SurfaceLayer
              key={s.id}
              surface={s}
              index={i}
              stage={stage}
              globals={
                view !== "stage" && !fullscreen
                  ? { ...globals, brightness: globals.brightness * 0.35 }
                  : globals
              }
              testPattern={testPattern}
              levels={levels}
            />
          ))}
          {view === "room" && !fullscreen && (
            <RoomView
              stage={stage}
              sounds={displaySounds}
              selectedId={selectedSoundId}
              room={room}
              paths={soundPaths}
              activePathId={activePathId}
              onSelect={setSelectedSoundId}
              onMoveSound={(id, position) => patchSound(id, { position })}
              onMoveListener={(listener) => patchRoom({ listener })}
              onMoveSpeaker={(id, position) =>
                patchRoom({
                  speakers: room.speakers.map((sp) => (sp.id === id ? { ...sp, position } : sp)),
                })
              }
              onSavePath={(path) =>
                setSoundPaths((prev) =>
                  prev.some((item) => item.id === path.id)
                    ? prev.map((item) => (item.id === path.id ? path : item))
                    : [...prev, path],
                )
              }
              onDeletePath={(id) => {
                setSoundPaths((prev) => prev.filter((path) => path.id !== id));
                setTimelineClips((prev) => prev.filter((clip) => clip.pathId !== id));
                setActivePathId(null);
              }}
              onSelectPath={setActivePathId}
            />
          )}
          {view === "editor" && !fullscreen && (
            <MediaEditor
              media={media}
              item={media.find((m) => m.id === editMediaId) ?? media[0] ?? null}
              sounds={sounds}
              onSelect={setEditMediaId}
              onPatch={patchMedia}
              onSaveClip={(id, crop, inS, outS) => {
                const from = media.find((m) => m.id === id);
                if (!from) return;
                saveClip(
                  from,
                  { crop, trimStart: inS, trimEnd: outS },
                  `${from.name} clip ${inS.toFixed(1)}-${outS.toFixed(1)}s`,
                );
              }}
              onDelete={removeMedia}
            />
          )}
          {!fullscreen && view === "stage" && (
            <svg className="pointer-events-none absolute inset-0 size-full">
              {outputs.length > 1 &&
                outputs.map((output, i) => (
                  <g key={`region-${output.id}`}>
                    <rect
                      x={output.region.x * stage.w}
                      y={output.region.y * stage.h}
                      width={output.region.w * stage.w}
                      height={output.region.h * stage.h}
                      className="fill-none stroke-chart-2/60"
                      strokeDasharray="8 6"
                    />
                    <text
                      x={output.region.x * stage.w + 6}
                      y={output.region.y * stage.h + 14}
                      className="fill-chart-2/80 text-[10px]"
                    >
                      {output.name || `Projector ${i + 1}`}
                    </text>
                  </g>
                ))}
              {surfaces
                .filter((s) => s.visible)
                .map((s) => (
                  <polygon
                    key={s.id}
                    points={s.corners.map((c) => `${c.x * stage.w},${c.y * stage.h}`).join(" ")}
                    onPointerDown={() => setSelectedId(s.id)}
                    className={`pointer-events-auto cursor-pointer stroke-primary/70 ${
                      s.id === selected?.id
                        ? "fill-transparent"
                        : "fill-transparent hover:fill-primary/10"
                    }`}
                    strokeWidth={s.id === selected?.id ? 2 : 0}
                  />
                ))}
            </svg>
          )}
          {mapping && !fullscreen && view === "stage" && (
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
