import type { Pt } from "./warp";

/** Normalised crop rectangle (0..1) inside the source frame. */
export type Crop = { x: number; y: number; w: number; h: number };

export type MediaItem = {
  id: string;
  name: string;
  kind: "image" | "video";
  url: string;
  /** Which stored file this item plays; clips share their parent's file. */
  blobId: string;
  crop?: Crop | undefined;
  /** seconds; video clips only */
  trimStart?: number | undefined;
  trimEnd?: number | undefined;
  /** full length of the source file in seconds (videos only) */
  duration?: number | undefined;
  /** loudness overview of the file's audio, for drawing a waveform */
  peaks?: number[] | undefined;
  /** video has an audio track we can route */
  hasAudio?: boolean | undefined;
  /** offset in seconds applied to a linked separate audio track */
  syncSoundId?: string | undefined;
  syncOffset?: number | undefined;
};

export type FitMode = "cover" | "stretch" | "fill";

export type Surface = {
  id: string;
  name: string;
  /** "visual:<id>" or "media:<id>" */
  source: string;
  corners: Pt[];
  opacity: number;
  hueShift: number;
  visible: boolean;
  fit: FitMode;
  flipH: boolean;
  flipV: boolean;
  /** 0 | 90 | 180 | 270 */
  rotate: number;
  /** "mic" | "master" | "sound:<id>" */
  audioSource: string;
  /** which projector output window shows this surface */
  outputId: string;
  /** internal render size in pixels */
  renderW: number;
  renderH: number;
  /** keep the mapped shape at the render aspect ratio */
  lockAspect: boolean;
};

/** Share of the shared show canvas a projector displays (0..1). */
export type OutputRegion = { x: number; y: number; w: number; h: number };

/** Edge blend: fade `width` (share of the window), down to `level` brightness. */
export type BlendEdge = { width: number; level: number; curve: number };

export type BlendConfig = {
  left: BlendEdge;
  right: BlendEdge;
  top: BlendEdge;
  bottom: BlendEdge;
};

export type OutputScreen = {
  id: string;
  name: string;
  region: OutputRegion;
  blend: BlendConfig;
  /** flat grey field for lining up the overlap */
  blendTest?: boolean | undefined;
};

export const defaultRegion = (): OutputRegion => ({ x: 0, y: 0, w: 1, h: 1 });

export const noEdge = (): BlendEdge => ({ width: 0, level: 0, curve: 1 });

export const defaultBlend = (): BlendConfig => ({
  left: noEdge(),
  right: noEdge(),
  top: noEdge(),
  bottom: noEdge(),
});

/** Fill in fields older saved projectors may lack. */
export const upgradeOutput = (o: Partial<OutputScreen> & { id: string }): OutputScreen => ({
  name: o.name ?? o.id,
  ...o,
  region: { ...defaultRegion(), ...(o.region ?? {}) },
  blend: {
    left: { ...noEdge(), ...(o.blend?.left ?? {}) },
    right: { ...noEdge(), ...(o.blend?.right ?? {}) },
    top: { ...noEdge(), ...(o.blend?.top ?? {}) },
    bottom: { ...noEdge(), ...(o.blend?.bottom ?? {}) },
  },
});

/** Lay projectors side by side across the canvas with a shared overlap. */
export const splitOutputsEvenly = (
  outputs: OutputScreen[],
  overlap: number,
  rows = 1,
): OutputScreen[] => {
  const columns = Math.max(1, Math.ceil(outputs.length / rows));
  const w = 1 / columns;
  const h = 1 / rows;
  return outputs.map((output, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = Math.max(0, column * w - (column > 0 ? overlap / 2 : 0));
    const y = Math.max(0, row * h - (row > 0 ? overlap / 2 : 0));
    const width = Math.min(1 - x, w + (columns > 1 ? overlap : 0));
    const height = Math.min(1 - y, h + (rows > 1 ? overlap : 0));
    const blend: BlendConfig = {
      left: { ...noEdge(), ...(column > 0 ? { width: overlap } : {}) },
      right: { ...noEdge(), ...(column < columns - 1 ? { width: overlap } : {}) },
      top: { ...noEdge(), ...(row > 0 ? { width: overlap } : {}) },
      bottom: { ...noEdge(), ...(row < rows - 1 ? { width: overlap } : {}) },
    };
    return { ...output, region: { x, y, w: width, h: height }, blend };
  });
};

export type Scene = {
  id: string;
  name: string;
  surfaces: Surface[];
  globals: Globals;
  testPattern: TestPattern;
};

export type TimelineCue = {
  id: string;
  sceneId: string;
  /** seconds from show start */
  start: number;
  transition: "cut" | "fade";
  /** fade length in seconds */
  fade: number;
  /** restart the timeline when it reaches the end */
  loop?: boolean | undefined;
};

export type TimelineTrackKind = "visual" | "audio" | "movement";

export type TimelineTrack = {
  id: string;
  name: string;
  kind: TimelineTrackKind;
  muted: boolean;
  solo: boolean;
};

export type TimelineClip = {
  id: string;
  trackId: string;
  kind: TimelineTrackKind;
  name: string;
  start: number;
  duration: number;
  inPoint: number;
  mediaId?: string | undefined;
  soundId?: string | undefined;
  surfaceId?: string | undefined;
  pathId?: string | undefined;
  /** how much of this clip is sent to the reverb bus, 0..1 */
  reverbSend?: number | undefined;
};

export type SoundPathPoint = { time: number; position: Vec3 };

/** An automation point placed in the room editor. */
export type PathNode = { id: string; position: Vec3 };

/** A line between two automation points. `curve` bends it (0 = straight). */
export type PathSegment = {
  id: string;
  fromId: string;
  toId: string;
  durationMs: number;
  curve: number;
};

export type SoundPath = {
  id: string;
  name: string;
  soundId: string;
  /** total length in seconds, derived from segment durations */
  duration: number;
  nodes: PathNode[];
  segments: PathSegment[];
  /** legacy drawn/recorded samples, kept so old projects still load */
  points?: SoundPathPoint[] | undefined;
};

export type Globals = {
  speed: number;
  intensity: number;
  hue: number;
  brightness: number;
  audioReactive: boolean;
  blackout: boolean;
};

export type TestPattern = "off" | "grid" | "crosshair" | "bars" | "frame" | "numbered";

export type Vec3 = { x: number; y: number; z: number };

export type SoundKind = "mono" | "stereo" | "ambisonic" | "video";

export type SoundItem = {
  id: string;
  name: string;
  kind: SoundKind;
  channels: number;
  /** Room position, -1..1 on x/y (top-down), z = height -1..1 */
  position: Vec3;
  gain: number;
  loop: boolean;
  mute: boolean;
  solo: boolean;
  playing: boolean;
  color: string;
  /** heading (degrees) for ambisonic files */
  heading: number;
  duration: number;
  /** loudness overview of the file, for drawing a waveform */
  peaks?: number[] | undefined;
  /** for kind "video": the media item whose element feeds this track */
  mediaId?: string;
};

export type Speaker = { id: string; name: string; position: Vec3 };

export type OutputMode = "headphones" | "speakers";

export type RoomConfig = {
  /** metres from left to right */
  width: number;
  /** metres from front to back */
  length: number;
  order: 1 | 2 | 3;
  outputMode: OutputMode;
  layout: string;
  speakers: Speaker[];
  listener: Vec3;
  masterGain: number;
};

/** Ambisonic reverb bus settings (Audio Effects tab). */
export type ReverbConfig = {
  enabled: boolean;
  /** output level of the whole bus, 0..1 */
  level: number;
  /** reverberant room size in metres */
  roomSize: number;
  /** tail length in seconds */
  decay: number;
  /** early reflection amount, 0..1 */
  earlyAmount: number;
  /** how wide the first bounces arrive, 0..1 */
  earlySpread: number;
  /** delay before the reverb starts, milliseconds */
  preDelayMs: number;
  /** high-frequency absorption, 0..1 */
  damping: number;
};

export const defaultReverb = (): ReverbConfig => ({
  enabled: true,
  level: 0.8,
  roomSize: 12,
  decay: 1.8,
  earlyAmount: 0.6,
  earlySpread: 0.5,
  preDelayMs: 20,
  damping: 0.35,
});

/** Map older projects (dry/small/large/hall room echo) onto the reverb bus. */
export const upgradeReverb = (
  reverb?: Partial<ReverbConfig> | undefined,
  legacy?: string | undefined,
): ReverbConfig => {
  const defaults = defaultReverb();
  if (reverb && typeof reverb.decay === "number") return { ...defaults, ...reverb };
  const presets: Record<string, Partial<ReverbConfig>> = {
    dry: { enabled: false, roomSize: 6, decay: 0.3, level: 0.4 },
    small: { roomSize: 8, decay: 0.8, level: 0.6 },
    large: { roomSize: 18, decay: 1.8, level: 0.8 },
    hall: { roomSize: 30, decay: 3, level: 0.9 },
  };
  return { ...defaults, ...(legacy ? presets[legacy] : undefined), ...(reverb ?? {}) };
};

export type Project = {
  version?: number;
  id: string;
  name: string;
  updatedAt: number;
  surfaces: Surface[];
  globals: Globals;
  media: Omit<MediaItem, "url">[];
  sounds: SoundItem[];
  room: RoomConfig;
  reverb?: ReverbConfig;
  testPattern: TestPattern;
  outputs?: OutputScreen[];
  scenes?: Scene[];
  timeline?: TimelineCue[];
  timelineTracks?: TimelineTrack[];
  timelineClips?: TimelineClip[];
  soundPaths?: SoundPath[];
  /** which clip was selected in the timeline when the show was saved */
  selectedClipId?: string | null;
  activePathId?: string | null;
};

/** Live media elements, kept outside React state. */
export const mediaElements = new Map<string, HTMLImageElement | HTMLVideoElement>();

/** Metadata (crop/trim) for live media, mirrored in both windows. */
export const mediaMeta = new Map<string, Omit<MediaItem, "url">>();

export const defaultOutputs = (): OutputScreen[] => [
  { id: "out1", name: "Projector 1", region: defaultRegion(), blend: defaultBlend() },
];

export const SPEAKER_LAYOUTS: Record<string, Speaker[]> = {
  stereo: [
    { id: "L", name: "L", position: { x: -0.5, y: -0.87, z: 0 } },
    { id: "R", name: "R", position: { x: 0.5, y: -0.87, z: 0 } },
  ],
  quad: [
    { id: "FL", name: "FL", position: { x: -0.7, y: -0.7, z: 0 } },
    { id: "FR", name: "FR", position: { x: 0.7, y: -0.7, z: 0 } },
    { id: "BL", name: "BL", position: { x: -0.7, y: 0.7, z: 0 } },
    { id: "BR", name: "BR", position: { x: 0.7, y: 0.7, z: 0 } },
  ],
  "5.1": [
    { id: "L", name: "L", position: { x: -0.5, y: -0.87, z: 0 } },
    { id: "R", name: "R", position: { x: 0.5, y: -0.87, z: 0 } },
    { id: "C", name: "C", position: { x: 0, y: -1, z: 0 } },
    { id: "LFE", name: "LFE", position: { x: 0, y: -0.6, z: -0.3 } },
    { id: "SL", name: "SL", position: { x: -0.87, y: 0.5, z: 0 } },
    { id: "SR", name: "SR", position: { x: 0.87, y: 0.5, z: 0 } },
  ],
  "7.1": [
    { id: "L", name: "L", position: { x: -0.5, y: -0.87, z: 0 } },
    { id: "R", name: "R", position: { x: 0.5, y: -0.87, z: 0 } },
    { id: "C", name: "C", position: { x: 0, y: -1, z: 0 } },
    { id: "LFE", name: "LFE", position: { x: 0, y: -0.6, z: -0.3 } },
    { id: "SL", name: "SL", position: { x: -1, y: 0, z: 0 } },
    { id: "SR", name: "SR", position: { x: 1, y: 0, z: 0 } },
    { id: "BL", name: "BL", position: { x: -0.6, y: 0.8, z: 0 } },
    { id: "BR", name: "BR", position: { x: 0.6, y: 0.8, z: 0 } },
  ],
  cube: [
    { id: "FLD", name: "FL↓", position: { x: -0.6, y: -0.6, z: -0.6 } },
    { id: "FRD", name: "FR↓", position: { x: 0.6, y: -0.6, z: -0.6 } },
    { id: "BLD", name: "BL↓", position: { x: -0.6, y: 0.6, z: -0.6 } },
    { id: "BRD", name: "BR↓", position: { x: 0.6, y: 0.6, z: -0.6 } },
    { id: "FLU", name: "FL↑", position: { x: -0.6, y: -0.6, z: 0.6 } },
    { id: "FRU", name: "FR↑", position: { x: 0.6, y: -0.6, z: 0.6 } },
    { id: "BLU", name: "BL↑", position: { x: -0.6, y: 0.6, z: 0.6 } },
    { id: "BRU", name: "BR↑", position: { x: 0.6, y: 0.6, z: 0.6 } },
  ],
};

export const defaultRoom = (): RoomConfig => ({
  width: 8,
  length: 8,
  order: 3,
  outputMode: "headphones",
  layout: "stereo",
  speakers: SPEAKER_LAYOUTS["stereo"]!.map((s) => ({ ...s })),
  listener: { x: 0, y: 0, z: 0 },
  masterGain: 0.9,
});

/** Fill in rectangular dimensions when opening projects saved with one square room size. */
export const upgradeRoom = (
  room?: Partial<RoomConfig> & { size?: number | undefined; reverb?: string | undefined },
): RoomConfig => {
  const defaults = defaultRoom();
  const legacySize = room?.size;
  const { size: _size, reverb: _reverb, ...rest } = room ?? {};
  return {
    ...defaults,
    ...rest,
    width: room?.width ?? legacySize ?? defaults.width,
    length: room?.length ?? legacySize ?? defaults.length,
  };
};

export const defaultGlobals = (): Globals => ({
  speed: 1,
  intensity: 0.5,
  hue: 190,
  brightness: 1,
  audioReactive: true,
  blackout: false,
});

export const SOUND_COLORS = [
  "#ff5f7e",
  "#ffb347",
  "#ffe95f",
  "#6cf28a",
  "#4dd8ff",
  "#8f7bff",
  "#ff7bf2",
];
