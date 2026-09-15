import type { Globals, MediaItem, OutputScreen, Surface, TestPattern } from "./types";

export type OutputSnapshot = {
  surfaces: Surface[];
  globals: Globals;
  testPattern: TestPattern;
  media: Omit<MediaItem, "url">[];
  outputs?: OutputScreen[];
};

/** Show clock, so every projector window plays the same frame. */
export type ClockMessage = {
  type: "clock";
  playing: boolean;
  time: number;
  /** mediaId -> currentTime in seconds for clips the timeline is driving */
  videos: Record<string, number>;
};

export type SyncMessage =
  | { type: "hello"; outputId?: string }
  | { type: "state"; snapshot: OutputSnapshot }
  | { type: "media"; items: { meta: Omit<MediaItem, "url">; file: Blob }[] }
  | { type: "drop-media"; ids: string[] }
  | ClockMessage
  | { type: "bye" };

export const CHANNEL = "prism-output";

export function openChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  return new BroadcastChannel(CHANNEL);
}
