import type { Pt } from "./warp";

export type MediaItem = {
  id: string;
  name: string;
  kind: "image" | "video";
  url: string;
};

export type FitMode = "cover" | "stretch";

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

export type SoundKind = "mono" | "stereo" | "ambisonic";

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
};

export type Speaker = { id: string; name: string; position: Vec3 };

export type OutputMode = "headphones" | "speakers";

export type RoomConfig = {
  /** metres across */
  size: number;
  reverb: "dry" | "small" | "large" | "hall";
  order: 1 | 2 | 3;
  outputMode: OutputMode;
  layout: string;
  speakers: Speaker[];
  listener: Vec3;
  masterGain: number;
};

export type Project = {
  id: string;
  name: string;
  updatedAt: number;
  surfaces: Surface[];
  globals: Globals;
  media: Omit<MediaItem, "url">[];
  sounds: SoundItem[];
  room: RoomConfig;
  testPattern: TestPattern;
};

/** Live media elements, kept outside React state. */
export const mediaElements = new Map<string, HTMLImageElement | HTMLVideoElement>();

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
  size: 8,
  reverb: "small",
  order: 3,
  outputMode: "headphones",
  layout: "stereo",
  speakers: SPEAKER_LAYOUTS["stereo"]!.map((s) => ({ ...s })),
  listener: { x: 0, y: 0, z: 0 },
  masterGain: 0.9,
});

export const defaultGlobals = (): Globals => ({
  speed: 1,
  intensity: 0.5,
  hue: 190,
  brightness: 1,
  audioReactive: true,
  blackout: false,
});

export const SOUND_COLORS = ["#ff5f7e", "#ffb347", "#ffe95f", "#6cf28a", "#4dd8ff", "#8f7bff", "#ff7bf2"];
