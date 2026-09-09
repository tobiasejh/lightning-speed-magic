import type { Globals, MediaItem, Surface, TestPattern } from "./types";

export type OutputSnapshot = {
  surfaces: Surface[];
  globals: Globals;
  testPattern: TestPattern;
  media: Omit<MediaItem, "url">[];
};

export type SyncMessage =
  | { type: "hello"; outputId?: string }
  | { type: "state"; snapshot: OutputSnapshot }
  | { type: "media"; items: { meta: Omit<MediaItem, "url">; file: Blob }[] }
  | { type: "drop-media"; ids: string[] }
  | { type: "bye" };

export const CHANNEL = "prism-output";

export function openChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  return new BroadcastChannel(CHANNEL);
}
