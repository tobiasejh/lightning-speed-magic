import type {
  Globals,
  OutputScreen,
  RoomConfig,
  SoundPath,
  Surface,
  TimelineClip,
  TimelineTrack,
} from "./types";

/** Everything Ctrl+Z can put back. */
export type ShowSnapshot = {
  surfaces: Surface[];
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  paths: SoundPath[];
  outputs: OutputScreen[];
  room: RoomConfig;
  globals: Globals;
};

const LIMIT = 50;

/** Undo/redo stack of show snapshots. Rapid edits (a drag) collapse into one step. */
export class History {
  private past: ShowSnapshot[] = [];
  private future: ShowSnapshot[] = [];
  private lastAt = 0;

  push(snapshot: ShowSnapshot, coalesceMs = 500) {
    const now = Date.now();
    if (this.past.length && now - this.lastAt < coalesceMs) {
      this.lastAt = now;
      return;
    }
    this.lastAt = now;
    this.past.push(snapshot);
    if (this.past.length > LIMIT) this.past.shift();
    this.future = [];
  }

  undo(current: ShowSnapshot): ShowSnapshot | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    this.lastAt = 0;
    return previous;
  }

  redo(current: ShowSnapshot): ShowSnapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    this.lastAt = 0;
    return next;
  }

  clear() {
    this.past = [];
    this.future = [];
    this.lastAt = 0;
  }
}
