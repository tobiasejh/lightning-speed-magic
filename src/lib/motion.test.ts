import { describe, expect, it } from "vitest";

import {
  GRID_H,
  GRID_W,
  MotionGrid,
  buildZoneMap,
  calibrationSurface,
  cameraToCanvas,
  countMotion,
  resolveCamera,
} from "./motion";
import {
  defaultBlend,
  upgradeCamera,
  type CameraConfig,
  type OutputScreen,
  type Surface,
} from "./types";
import type { OutlinePt, Pt } from "./warp";

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// two projectors side by side, sharing one show canvas
const outputs: OutputScreen[] = [
  { id: "out1", name: "Left", region: { x: 0, y: 0, w: 0.5, h: 1 }, blend: defaultBlend() },
  { id: "out2", name: "Right", region: { x: 0.5, y: 0, w: 0.5, h: 1 }, blend: defaultBlend() },
];

// the camera sees projector 2's picture filling the middle of its image
const camera = (patch: Partial<CameraConfig> = {}): CameraConfig => ({
  ...upgradeCamera(undefined),
  outputId: "out2",
  corners: rect(0.25, 0.25, 0.75, 0.75),
  ...patch,
});

const surface = (id: string, corners: Pt[], patch: Partial<Surface> = {}): Surface => ({
  id,
  name: id,
  source: "visual:plasma",
  corners,
  opacity: 1,
  hueShift: 0,
  visible: true,
  fit: "cover",
  flipH: false,
  flipV: false,
  rotate: 0,
  audioSource: "mic",
  outputId: "out2",
  renderW: 1280,
  renderH: 720,
  lockAspect: false,
  ...patch,
});

/** The zone of the grid cell under a camera image position (0..1). */
const zoneAt = (zones: Int16Array, x: number, y: number) =>
  zones[Math.floor(y * GRID_H) * GRID_W + Math.floor(x * GRID_W)];

describe("cameraToCanvas", () => {
  it("needs a calibration", () => {
    expect(cameraToCanvas(camera({ corners: null }), outputs)).toBeNull();
  });

  it("puts the calibrated picture onto its projector's part of the show canvas", () => {
    const toCanvas = cameraToCanvas(camera(), outputs)!;
    expect(toCanvas({ x: 0.25, y: 0.25 })).toEqual({ x: 0.5, y: 0 });
    expect(toCanvas({ x: 0.75, y: 0.75 })).toEqual({ x: 1, y: 1 });
    expect(toCanvas({ x: 0.5, y: 0.5 })).toEqual({ x: 0.75, y: 0.5 });
  });

  it("ignores what the camera sees outside the projected picture", () => {
    expect(cameraToCanvas(camera(), outputs)!({ x: 0.1, y: 0.5 })).toBeNull();
  });

  it("falls back to the first projector when the chosen one was removed", () => {
    const toCanvas = cameraToCanvas(camera({ outputId: "gone" }), outputs)!;
    expect(toCanvas({ x: 0.75, y: 0.75 })).toEqual({ x: 0.5, y: 1 });
  });
});

describe("buildZoneMap", () => {
  it("is empty without a calibration", () => {
    expect(buildZoneMap(camera({ corners: null }), outputs, [])).toBeNull();
  });

  it("finds each surface where the camera sees it", () => {
    // left and right half of projector 2's picture
    const surfaces = [surface("a", rect(0.5, 0, 0.75, 1)), surface("b", rect(0.75, 0, 1, 1))];
    const zones = buildZoneMap(camera(), outputs, surfaces)!;
    expect(zoneAt(zones, 0.3, 0.5)).toBe(0);
    expect(zoneAt(zones, 0.7, 0.5)).toBe(1);
    expect(zoneAt(zones, 0.1, 0.5)).toBe(-1);
  });

  it("skips hidden surfaces and surfaces on a projector the camera does not see", () => {
    const whole = rect(0.5, 0, 1, 1);
    const surfaces = [
      surface("hidden", whole, { visible: false }),
      surface("elsewhere", rect(0, 0, 0.5, 1), { outputId: "out1" }),
      surface("seen", whole),
    ];
    const zones = buildZoneMap(camera(), outputs, surfaces)!;
    expect(zoneAt(zones, 0.5, 0.5)).toBe(2);
  });

  it("gives an overlap to the surface on top, the first in the list", () => {
    const whole = rect(0.5, 0, 1, 1);
    const zones = buildZoneMap(camera(), outputs, [
      surface("top", whole),
      surface("under", whole),
    ])!;
    expect(zoneAt(zones, 0.5, 0.5)).toBe(0);
  });

  it("follows a cut-out outline, not the four warp corners", () => {
    const outline: OutlinePt[] = [
      { u: 0, v: 0, c: 0 },
      { u: 0.5, v: 0 },
      { u: 0.5, v: 0.5 },
      { u: 1, v: 0.5 },
      { u: 1, v: 1, c: 2 },
      { u: 0, v: 1, c: 3 },
    ];
    const zones = buildZoneMap(camera(), outputs, [surface("L", rect(0.5, 0, 1, 1), { outline })])!;
    expect(zoneAt(zones, 0.35, 0.35)).toBe(0);
    expect(zoneAt(zones, 0.65, 0.35)).toBe(-1); // the cut-away top right
    expect(zoneAt(zones, 0.65, 0.65)).toBe(0);
  });
});

describe("countMotion", () => {
  it("counts moving cells per surface and ignores cells outside every surface", () => {
    const zones = new Int16Array([0, 0, 1, -1]);
    const cells = new Uint8Array([1, 1, 0, 1]);
    const counts = new Uint16Array(2);
    countMotion(cells, zones, counts);
    expect([...counts]).toEqual([2, 0]);
  });
});

/** A grey GRID_W x GRID_H picture, as ImageData holds it. */
const frame = (luma = 60) => new Uint8ClampedArray(GRID_W * GRID_H * 4).fill(luma);

const paint = (
  rgba: Uint8ClampedArray,
  x0: number,
  y0: number,
  w: number,
  h: number,
  v: number,
) => {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * GRID_W + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
    }
  }
  return rgba;
};

const lit = (grid: MotionGrid) => grid.cells.reduce((sum, cell) => sum + cell, 0);

describe("MotionGrid", () => {
  it("takes the first frame as the background", () => {
    const grid = new MotionGrid();
    grid.update(paint(frame(), 10, 10, 6, 6, 200), 0.5);
    expect(lit(grid)).toBe(0);
  });

  it("sees nothing in a picture that does not change", () => {
    const grid = new MotionGrid();
    grid.update(frame(), 0.5);
    grid.update(frame(), 0.5);
    expect(lit(grid)).toBe(0);
  });

  it("marks exactly the cells where something appears", () => {
    const grid = new MotionGrid();
    grid.update(frame(), 0.5);
    grid.update(paint(frame(), 10, 20, 6, 4, 200), 0.5);
    expect(lit(grid)).toBe(24);
    expect(grid.cells[22 * GRID_W + 12]).toBe(1);
    expect(grid.cells[5 * GRID_W + 5]).toBe(0);
  });

  it("drops a single changed cell as camera noise", () => {
    const grid = new MotionGrid();
    grid.update(frame(), 0.5);
    grid.update(paint(frame(), 30, 30, 1, 1, 200), 0.5);
    expect(lit(grid)).toBe(0);
  });

  it("reacts to smaller changes the more sensitive it is", () => {
    const faint = () => paint(frame(), 10, 10, 4, 4, 60 + 20);
    const dull = new MotionGrid();
    dull.update(frame(), 0);
    dull.update(faint(), 0);
    const keen = new MotionGrid();
    keen.update(frame(), 1);
    keen.update(faint(), 1);
    expect(lit(dull)).toBe(0);
    expect(lit(keen)).toBe(16);
  });

  it("takes a change of most of the picture as new light, not movement", () => {
    const grid = new MotionGrid();
    grid.update(frame(60), 0.5);
    grid.update(frame(160), 0.5);
    expect(lit(grid)).toBe(0);
    // and the new light is the background from then on
    grid.update(frame(160), 0.5);
    expect(lit(grid)).toBe(0);
  });

  it("lets someone who stands still fade into the background", () => {
    const grid = new MotionGrid();
    grid.update(frame(), 0.5);
    const standing = paint(frame(), 10, 10, 6, 6, 200);
    grid.update(standing, 0.5);
    expect(lit(grid)).toBe(36);
    let frames = 1;
    while (lit(grid) > 0 && frames < 1000) {
      grid.update(standing, 0.5);
      frames++;
    }
    expect(lit(grid)).toBe(0);
    // at 25 analysed frames a second this is a few seconds, not a moment
    expect(frames).toBeGreaterThan(25);
    expect(frames).toBeLessThan(500);
  });
});

describe("resolveCamera", () => {
  const devices = [
    { deviceId: "a1", label: "Logitech C920" },
    { deviceId: "b2", label: "Integrated Camera" },
  ];

  it("uses the default camera for a show never calibrated with one", () => {
    expect(resolveCamera(devices, {})).toEqual({ deviceId: undefined });
  });

  it("finds the saved camera by id", () => {
    expect(resolveCamera(devices, { deviceId: "b2", deviceLabel: "x" })).toEqual({
      deviceId: "b2",
    });
  });

  it("finds it by name when its id changed", () => {
    expect(resolveCamera(devices, { deviceId: "old", deviceLabel: "Logitech C920" })).toEqual({
      deviceId: "a1",
    });
  });

  it("reports it missing rather than picking another", () => {
    expect(resolveCamera(devices, { deviceId: "old", deviceLabel: "Brio" })).toEqual({
      missing: true,
    });
  });

  it("cannot tell before camera access hides the ids", () => {
    expect(resolveCamera([{ deviceId: "", label: "" }], { deviceId: "a1" })).toBeNull();
  });
});

describe("upgradeCamera", () => {
  it("gives a show saved before the camera existed the defaults, with auto start off", () => {
    expect(upgradeCamera(undefined)).toEqual({
      autoStart: false,
      outputId: "out1",
      corners: null,
      sensitivity: 0.5,
    });
  });

  it("only starts a camera on its own when that was chosen", () => {
    expect(upgradeCamera({ autoStart: true }).autoStart).toBe(true);
    expect(upgradeCamera({ autoStart: "yes" as unknown as boolean }).autoStart).toBe(false);
  });

  it("drops a broken calibration and clamps values", () => {
    const camera = upgradeCamera({ corners: [{ x: 2, y: -1 }], sensitivity: 9 });
    expect(camera.corners).toBeNull();
    expect(camera.sensitivity).toBe(1);
    const clamped = upgradeCamera({ corners: rect(-0.5, 0, 1.5, 1) });
    expect(clamped.corners![0]).toEqual({ x: 0, y: 0 });
    expect(clamped.corners![1]).toEqual({ x: 1, y: 0 });
  });

  it("keeps the saved camera", () => {
    const camera = upgradeCamera({ deviceId: "a1", deviceLabel: "Logitech C920" });
    expect(camera.deviceId).toBe("a1");
    expect(camera.deviceLabel).toBe("Logitech C920");
  });
});

describe("calibrationSurface", () => {
  it("covers exactly the picture of the projector the camera sees", () => {
    const layer = calibrationSurface(camera(), outputs);
    expect(layer.corners).toEqual(rect(0.5, 0, 1, 1));
    expect(layer.outputId).toBe("out2");
  });
});
