import type { SoundPath, TimelineClip, TimelineTrack, TimelineTrackKind, Vec3 } from "./types";

export const timelineLength = (clips: TimelineClip[]) =>
  Math.max(30, ...clips.map((clip) => clip.start + clip.duration));

export const activeClipsAt = (tracks: TimelineTrack[], clips: TimelineClip[], time: number) => {
  const soloKinds = new Set<TimelineTrackKind>(
    tracks.filter((track) => track.solo).map((t) => t.kind),
  );
  const enabled = new Set(
    tracks
      .filter((track) => !track.muted && (!soloKinds.has(track.kind) || track.solo))
      .map((track) => track.id),
  );
  return clips.filter(
    (clip) => enabled.has(clip.trackId) && time >= clip.start && time < clip.start + clip.duration,
  );
};

export const positionOnPath = (path: SoundPath, elapsed: number): Vec3 | null => {
  const points = path.points;
  if (!points.length) return null;
  if (points.length === 1 || elapsed <= points[0]!.time) return points[0]!.position;
  const last = points[points.length - 1]!;
  if (elapsed >= last.time) return last.position;
  const nextIndex = points.findIndex((point) => point.time >= elapsed);
  const b = points[Math.max(1, nextIndex)]!;
  const a = points[Math.max(0, nextIndex - 1)]!;
  const span = Math.max(0.001, b.time - a.time);
  const t = Math.max(0, Math.min(1, (elapsed - a.time) / span));
  return {
    x: a.position.x + (b.position.x - a.position.x) * t,
    y: a.position.y + (b.position.y - a.position.y) * t,
    z: a.position.z + (b.position.z - a.position.z) * t,
  };
};

export const snapTimelineTime = (time: number, clips: TimelineClip[], ignoreId?: string) => {
  const candidates = [
    0,
    ...clips.flatMap((clip) =>
      clip.id === ignoreId ? [] : [clip.start, clip.start + clip.duration],
    ),
  ];
  let result = Math.max(0, time);
  let distance = 0.16;
  for (const candidate of candidates) {
    const nextDistance = Math.abs(candidate - time);
    if (nextDistance < distance) {
      result = candidate;
      distance = nextDistance;
    }
  }
  return result;
};
