import type {
  PathNode,
  PathSegment,
  SoundPath,
  TimelineClip,
  TimelineTrack,
  TimelineTrackKind,
  Vec3,
} from "./types";

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

const uid = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 8)}`;

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/** Converts legacy drawn/recorded sample lists into editable nodes + segments. */
export const upgradePath = (path: SoundPath): SoundPath => {
  if (path.nodes?.length) return { ...path, duration: pathDuration(path) };
  const samples = path.points ?? [];
  const keep = samples.filter(
    (_, index) => index === 0 || index === samples.length - 1 || index % 4 === 0,
  );
  const nodes: PathNode[] = keep.map((sample) => ({ id: uid("n"), position: sample.position }));
  const segments: PathSegment[] = [];
  for (let i = 1; i < nodes.length; i++) {
    segments.push({
      id: uid("s"),
      fromId: nodes[i - 1]!.id,
      toId: nodes[i]!.id,
      durationMs: Math.max(50, Math.round((keep[i]!.time - keep[i - 1]!.time || 0.5) * 1000)),
      curve: 0,
    });
  }
  const next: SoundPath = { ...path, nodes, segments, points: undefined };
  return { ...next, duration: pathDuration(next) };
};

export const emptyPath = (id: string, name: string, soundId: string): SoundPath => ({
  id,
  name,
  soundId,
  duration: 0,
  nodes: [],
  segments: [],
});

export const pathDuration = (path: SoundPath) =>
  (path.segments ?? []).reduce((total, segment) => total + Math.max(0, segment.durationMs), 0) /
  1000;

export const withDuration = (path: SoundPath): SoundPath => ({
  ...path,
  duration: pathDuration(path),
});

const nodeById = (path: SoundPath, id: string) => path.nodes.find((node) => node.id === id) ?? null;

/** Control point of the quadratic curve for a segment. */
export const segmentControl = (a: Vec3, b: Vec3, curve: number): Vec3 => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 0.0001;
  return {
    x: (a.x + b.x) / 2 + (-dy / length) * curve * length,
    y: (a.y + b.y) / 2 + (dx / length) * curve * length,
    z: (a.z + b.z) / 2,
  };
};

export const curveFromControl = (a: Vec3, b: Vec3, control: Vec3) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 0.0001;
  const mx = control.x - (a.x + b.x) / 2;
  const my = control.y - (a.y + b.y) / 2;
  return (mx * -dy + my * dx) / (length * length);
};

const quad = (a: Vec3, c: Vec3, b: Vec3, t: number): Vec3 => {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    z: u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  };
};

export const segmentEnds = (path: SoundPath, segment: PathSegment) => {
  const a = nodeById(path, segment.fromId);
  const b = nodeById(path, segment.toId);
  if (!a || !b) return null;
  return {
    a: a.position,
    b: b.position,
    control: segmentControl(a.position, b.position, segment.curve),
  };
};

export const sampleSegment = (path: SoundPath, segment: PathSegment, t: number): Vec3 | null => {
  const ends = segmentEnds(path, segment);
  if (!ends) return null;
  return quad(ends.a, ends.control, ends.b, Math.max(0, Math.min(1, t)));
};

/** Ordered walk of the path: node ids with their start time in seconds. */
export const pathChain = (path: SoundPath) => {
  const chain: { nodeId: string; time: number }[] = [];
  let time = 0;
  const segments = path.segments ?? [];
  if (!segments.length) return path.nodes.map((node) => ({ nodeId: node.id, time: 0 }));
  chain.push({ nodeId: segments[0]!.fromId, time: 0 });
  for (const segment of segments) {
    time += Math.max(0, segment.durationMs) / 1000;
    chain.push({ nodeId: segment.toId, time });
  }
  return chain;
};

export const positionOnPath = (path: SoundPath, elapsed: number): Vec3 | null => {
  const segments = path.segments ?? [];
  if (!segments.length) return path.nodes[0]?.position ?? null;
  let time = 0;
  for (const segment of segments) {
    const length = Math.max(0, segment.durationMs) / 1000;
    // a 0 ms line is an instant jump: skip straight to its end point
    if (length <= 0) continue;
    if (elapsed <= time + length) return sampleSegment(path, segment, (elapsed - time) / length);
    time += length;
  }
  const last = segments[segments.length - 1]!;
  return sampleSegment(path, last, 1);
};

/** Adds a node on a segment at t, keeping the original curve shape (de Casteljau). */
export const splitSegment = (path: SoundPath, segmentId: string, t: number): SoundPath => {
  const segment = (path.segments ?? []).find((item) => item.id === segmentId);
  const ends = segment ? segmentEnds(path, segment) : null;
  if (!segment || !ends) return path;
  const clamped = Math.max(0.05, Math.min(0.95, t));
  const a1 = lerp(ends.a, ends.control, clamped);
  const b1 = lerp(ends.control, ends.b, clamped);
  const mid = lerp(a1, b1, clamped);
  const node: PathNode = { id: uid("n"), position: mid };
  const first: PathSegment = {
    id: uid("s"),
    fromId: segment.fromId,
    toId: node.id,
    durationMs: Math.max(0, Math.round(segment.durationMs * clamped)),
    curve: curveFromControl(ends.a, mid, a1),
  };
  const second: PathSegment = {
    id: uid("s"),
    fromId: node.id,
    toId: segment.toId,
    durationMs: Math.max(0, Math.round(segment.durationMs * (1 - clamped))),
    curve: curveFromControl(mid, ends.b, b1),
  };
  const index = (path.segments ?? []).findIndex((item) => item.id === segmentId);
  const segments = [...path.segments];
  segments.splice(index, 1, first, second);
  return withDuration({ ...path, nodes: [...path.nodes, node], segments });
};

export const addPathNode = (path: SoundPath, position: Vec3, connect: boolean): SoundPath => {
  const node: PathNode = { id: uid("n"), position };
  const chain = pathChain(path);
  const lastId = chain[chain.length - 1]?.nodeId;
  const segments = [...(path.segments ?? [])];
  if (connect && lastId && path.nodes.length)
    segments.push({ id: uid("s"), fromId: lastId, toId: node.id, durationMs: 1000, curve: 0 });
  return withDuration({ ...path, nodes: [...path.nodes, node], segments });
};

export const connectNodes = (path: SoundPath, fromId: string, toId: string): SoundPath => {
  if (fromId === toId) return path;
  if ((path.segments ?? []).some((s) => s.fromId === fromId && s.toId === toId)) return path;
  return withDuration({
    ...path,
    segments: [
      ...(path.segments ?? []),
      { id: uid("s"), fromId, toId, durationMs: 1000, curve: 0 },
    ],
  });
};

export const removeNode = (path: SoundPath, nodeId: string): SoundPath =>
  withDuration({
    ...path,
    nodes: path.nodes.filter((node) => node.id !== nodeId),
    segments: (path.segments ?? []).filter(
      (segment) => segment.fromId !== nodeId && segment.toId !== nodeId,
    ),
  });

export const removeSegment = (path: SoundPath, segmentId: string): SoundPath =>
  withDuration({
    ...path,
    segments: (path.segments ?? []).filter((segment) => segment.id !== segmentId),
  });

export const patchSegment = (
  path: SoundPath,
  segmentId: string,
  next: Partial<PathSegment>,
): SoundPath =>
  withDuration({
    ...path,
    segments: (path.segments ?? []).map((segment) =>
      segment.id === segmentId ? { ...segment, ...next } : segment,
    ),
  });

export const moveNode = (path: SoundPath, nodeId: string, position: Vec3): SoundPath => ({
  ...path,
  nodes: path.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
});

/** Nearest point on a segment to a room position; returns t and distance. */
export const closestOnSegment = (path: SoundPath, segment: PathSegment, point: Vec3) => {
  let best = { t: 0, distance: Infinity };
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const sample = sampleSegment(path, segment, t);
    if (!sample) continue;
    const distance = Math.hypot(sample.x - point.x, sample.y - point.y);
    if (distance < best.distance) best = { t, distance };
  }
  return best;
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
