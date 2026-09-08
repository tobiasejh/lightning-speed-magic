import type { Pt } from "./warp";

export type MediaItem = {
  id: string;
  name: string;
  kind: "image" | "video";
  url: string;
};

export type Surface = {
  id: string;
  name: string;
  /** "visual:<id>" or "media:<id>" */
  source: string;
  corners: Pt[];
  opacity: number;
  hueShift: number;
  visible: boolean;
};

export type Globals = {
  speed: number;
  intensity: number;
  hue: number;
  brightness: number;
  audioReactive: boolean;
  blackout: boolean;
};

/** Live media elements, kept outside React state. */
export const mediaElements = new Map<string, HTMLImageElement | HTMLVideoElement>();
