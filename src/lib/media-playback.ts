import { mediaElements, type Surface, type TestPattern } from "./types";

/**
 * Every playing video is a running decoder, in every window, whether anyone sees it or not.
 * A video therefore stays parked (paused) until a surface shows it or its sound is needed.
 * Parked is kept apart from a plain pause, so a video the timeline or the Sound tab paused
 * on purpose is not restarted when a surface starts showing it.
 */
const parked = new WeakSet<HTMLVideoElement>();

let holder: HTMLDivElement | null = null;

export function createVideo(url: string) {
  const video = document.createElement("video");
  video.src = url;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  parked.add(video);
  return video;
}

/** Marks a video as running even though nothing has asked for it yet. */
export function unparkVideo(video: HTMLVideoElement) {
  parked.delete(video);
}

/**
 * Takes a video off a surface without pausing it. A video that leaves the document is paused
 * by the browser, which would cut its sound, so it moves to a hidden holder instead.
 */
export function stowVideo(video: HTMLVideoElement) {
  if (!holder) {
    holder = document.createElement("div");
    holder.style.display = "none";
    document.body.appendChild(holder);
  }
  holder.appendChild(video);
}

/** Stops a video for good and frees its decoder. */
export function releaseVideo(video: HTMLVideoElement) {
  video.pause();
  video.remove();
  video.removeAttribute("src");
  video.load();
}

/** Drops every live media element, so a closed show keeps no decoders or file URLs alive. */
export function releaseMediaElements() {
  for (const element of mediaElements.values()) {
    if (element.src.startsWith("blob:")) URL.revokeObjectURL(element.src);
    if (element instanceof HTMLVideoElement) releaseVideo(element);
  }
  mediaElements.clear();
}

/**
 * @param wanted videos that should run: parked ones among them are started
 * @param driven videos someone else controls (timeline clock, audio probe): left as they are
 * Everything else gets parked.
 */
export function updateVideoPlayback(wanted: Set<string>, driven: Set<string>) {
  for (const [id, element] of mediaElements) {
    if (!(element instanceof HTMLVideoElement)) continue;
    if (driven.has(id)) {
      parked.delete(element);
    } else if (wanted.has(id)) {
      if (parked.delete(element)) void element.play().catch(() => undefined);
    } else {
      parked.add(element);
      if (!element.paused) element.pause();
    }
  }
}

/** Media ids the given surfaces show right now. A test pattern covers all of them. */
export function usedVideoIds(surfaces: Surface[], testPattern: TestPattern) {
  const used = new Set<string>();
  if (testPattern !== "off") return used;
  for (const surface of surfaces) {
    if (surface.visible && surface.source.startsWith("media:")) used.add(surface.source.slice(6));
  }
  return used;
}

/**
 * Source -> surface id of the surface that displays the media element itself. Further surfaces
 * showing the same media need a second decoder, so only one per source gets to skip it.
 */
export function videoOwners(surfaces: Surface[]) {
  const owners = new Map<string, string>();
  for (const surface of surfaces) {
    if (surface.visible && !owners.has(surface.source)) owners.set(surface.source, surface.id);
  }
  return owners;
}
