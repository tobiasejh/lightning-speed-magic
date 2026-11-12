import {
  BLANK_SOURCE,
  defaultRegion,
  type CameraConfig,
  type OutputScreen,
  type Surface,
} from "./types";
import { outlineStagePoints, pointInPolygon, quadToUnit, type Pt } from "./warp";

/**
 * The camera image is analysed as a coarse grid. Movement in front of a projection is big,
 * so more cells would only cost CPU on the laptop that also runs the show.
 */
export const GRID_W = 64;
export const GRID_H = 48;

/** A camera delivers 25-30 frames a second; analysing more often finds nothing new. */
export const MOTION_SAMPLE_MS = 40;

/** The pattern projected while calibrating: it numbers its corners like the handles. */
export const CALIBRATION_PATTERN = "numbered" as const;

/** Where the handles start before the first calibration. */
export const defaultCameraCorners = (): Pt[] => [
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.8, y: 0.8 },
  { x: 0.2, y: 0.8 },
];

const cameraOutput = (camera: CameraConfig, outputs: OutputScreen[]) =>
  outputs.find((output) => output.id === camera.outputId) ?? outputs[0];

/** Watches a camera and marks the grid cells where the picture is changing. */
export class MotionSensor {
  /** 1 for every grid cell with movement in the last analysed frame */
  readonly cells = new Uint8Array(GRID_W * GRID_H);
  stream: MediaStream | null = null;

  private video: HTMLVideoElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private background = new Float32Array(GRID_W * GRID_H);
  private raw = new Uint8Array(GRID_W * GRID_H);
  private primed = false;
  private sampledAt = 0;

  get active() {
    return !!this.stream;
  }

  async start(deviceId?: string) {
    if (this.stream) return;
    const size = { width: { ideal: 640 }, height: { ideal: 480 } };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { ...size, deviceId: { exact: deviceId } } : size,
      });
    } catch (error) {
      // a show saved on another computer names a camera this one does not have
      if (!deviceId || !(error instanceof DOMException) || error.name !== "OverconstrainedError")
        throw error;
      stream = await navigator.mediaDevices.getUserMedia({ video: size });
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    const canvas = document.createElement("canvas");
    canvas.width = GRID_W;
    canvas.height = GRID_H;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true });
    this.video = video;
    this.stream = stream;
    this.primed = false;
  }

  /** The id of the camera actually in use, which may differ from the one asked for. */
  get deviceId() {
    return this.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  }

  /**
   * Analyses the current camera frame. Returns false when it is too soon for a new frame,
   * so callers on requestAnimationFrame do no work on most ticks.
   */
  sample(now: number, sensitivity: number) {
    const { video, ctx } = this;
    if (!video || !ctx || video.readyState < 2) return false;
    if (now - this.sampledAt < MOTION_SAMPLE_MS) return false;
    this.sampledAt = now;

    ctx.drawImage(video, 0, 0, GRID_W, GRID_H);
    const { data } = ctx.getImageData(0, 0, GRID_W, GRID_H);
    const { background, raw, cells } = this;
    const count = GRID_W * GRID_H;

    if (!this.primed) {
      for (let i = 0; i < count; i++) {
        background[i] = data[i * 4]! * 0.299 + data[i * 4 + 1]! * 0.587 + data[i * 4 + 2]! * 0.114;
      }
      this.primed = true;
      cells.fill(0);
      return true;
    }

    // brightness steps of 0..255: 40 only reacts to strong changes, 6 to nearly everything
    const threshold = 40 - 34 * Math.max(0, Math.min(1, sensitivity));
    let changed = 0;
    for (let i = 0; i < count; i++) {
      const luma = data[i * 4]! * 0.299 + data[i * 4 + 1]! * 0.587 + data[i * 4 + 2]! * 0.114;
      const moving = Math.abs(luma - background[i]!) > threshold;
      raw[i] = moving ? 1 : 0;
      if (moving) changed++;
      // Still parts follow the light quickly. Moving parts are taken up slowly, so someone
      // who stops in front of a surface fades into the background after a few seconds.
      background[i] = background[i]! + (luma - background[i]!) * (moving ? 0.02 : 0.1);
    }

    // Most of the picture changing at once is the light (a new projected image, the camera
    // adjusting its exposure), not a person. Take it as the new background.
    if (changed > count * 0.6) {
      this.primed = false;
      cells.fill(0);
      return true;
    }

    // a single cell on its own is camera noise
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const i = y * GRID_W + x;
        cells[i] =
          raw[i] &&
          ((x > 0 && raw[i - 1]) ||
            (x < GRID_W - 1 && raw[i + 1]) ||
            (y > 0 && raw[i - GRID_W]) ||
            (y < GRID_H - 1 && raw[i + GRID_W]))
            ? 1
            : 0;
      }
    }
    return true;
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.ctx = null;
    this.stream = null;
    this.primed = false;
    this.cells.fill(0);
  }
}

/**
 * Camera image position (0..1) to the shared show canvas (0..1, the space of
 * `Surface.corners`). Returns null for points outside the projected picture, and no mapper
 * at all until the camera is calibrated.
 */
export const cameraToCanvas = (
  camera: CameraConfig,
  outputs: OutputScreen[],
): ((p: Pt) => Pt | null) | null => {
  const unit = camera.corners && quadToUnit(camera.corners);
  if (!unit) return null;
  // the corners mark one projector's picture, which is only a slice of the show canvas
  const region = cameraOutput(camera, outputs)?.region ?? defaultRegion();
  return (p) => {
    const { x: u, y: v } = unit(p);
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
    return { x: region.x + u * region.w, y: region.y + v * region.h };
  };
};

/**
 * For every grid cell, the position in `surfaces` of the surface the camera sees there
 * (-1 for none). Built once per change of mapping, so each frame only has to count cells.
 */
export const buildZoneMap = (
  camera: CameraConfig,
  outputs: OutputScreen[],
  surfaces: Surface[],
): Int16Array | null => {
  const toCanvas = cameraToCanvas(camera, outputs);
  if (!toCanvas) return null;
  const outputId = cameraOutput(camera, outputs)?.id ?? "out1";
  // the camera only sees what its projector shows; the first surface in the list is on top
  const polygons = surfaces.map((surface) =>
    surface.visible && (surface.outputId || "out1") === outputId
      ? outlineStagePoints(surface.corners, surface.outline)
      : null,
  );
  const zones = new Int16Array(GRID_W * GRID_H).fill(-1);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const point = toCanvas({ x: (x + 0.5) / GRID_W, y: (y + 0.5) / GRID_H });
      if (!point) continue;
      zones[y * GRID_W + x] = polygons.findIndex(
        (polygon) => polygon && pointInPolygon(point, polygon),
      );
    }
  }
  return zones;
};

/** Counts the moving cells of one frame into `counts`, one entry per surface. */
export const countMotion = (cells: Uint8Array, zones: Int16Array, counts: Uint16Array) => {
  counts.fill(0);
  for (let i = 0; i < cells.length; i++) {
    const zone = zones[i]!;
    if (cells[i] && zone >= 0 && zone < counts.length) counts[zone]!++;
  }
};

/**
 * A surface that fills one projector's whole picture, shown on top while calibrating so the
 * camera sees the corners of that picture. It only ever exists in the output snapshot.
 */
export const calibrationSurface = (camera: CameraConfig, outputs: OutputScreen[]): Surface => {
  const output = cameraOutput(camera, outputs);
  const { x, y, w, h } = output?.region ?? defaultRegion();
  return {
    id: "camera-calibration",
    name: "Camera calibration",
    source: BLANK_SOURCE,
    corners: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    opacity: 1,
    hueShift: 0,
    visible: true,
    fit: "stretch",
    flipH: false,
    flipV: false,
    rotate: 0,
    audioSource: "master",
    outputId: output?.id ?? "out1",
    renderW: 1280,
    renderH: 720,
    lockAspect: false,
  };
};
