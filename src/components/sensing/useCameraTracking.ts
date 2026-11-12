import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MotionSensor, buildZoneMap, countMotion, resolveCamera } from "@/lib/motion";
import type { CameraConfig, OutputScreen, Surface } from "@/lib/types";

/** Moving grid cells a surface needs before it counts: fewer is a flicker at its edge. */
const MIN_CELLS = 2;
/** A surface stays marked this long after its last movement, so the marking does not flicker. */
const HOLD_MS = 400;
/** How often React hears about it; the analysis itself runs in refs. */
const UI_MS = 80;

export type CameraTracking = {
  /** on, or being turned on */
  on: boolean;
  /** the live camera picture, for <video> elements that show it */
  stream: MediaStream | null;
  error: string | null;
  /**
   * The show's calibrated camera is not plugged in. Holds its name, or "" when the show was
   * saved without one. The camera then stays off rather than guess another one.
   */
  missing: string | null;
  devices: MediaDeviceInfo[];
  /** the camera in use */
  deviceId: string | undefined;
  deviceLabel: string | undefined;
  /** ids of the surfaces with movement in front of them right now */
  activeIds: string[];
  /** the sensor's latest grid, read by the preview on its own clock */
  sensor: { readonly current: MotionSensor | null };
  /** turns on the show's own camera; pass the config of a show that is still being opened */
  start: (config?: CameraConfig) => Promise<void>;
  /** turns on this camera, or the system default without an id */
  startWith: (deviceId: string | undefined) => Promise<void>;
  stop: () => void;
  toggle: () => void;
};

const errorName = (error: unknown) =>
  typeof error === "object" && error && "name" in error ? String(error.name) : "";

const cameraError = (error: unknown) => {
  const name = errorName(error);
  if (name === "NotAllowedError") return "Camera access was denied. Allow it and try again.";
  if (name === "NotFoundError") return "No camera found. Plug one in and try again.";
  if (name === "NotReadableError") return "The camera is in use by another program.";
  return "Could not start the camera.";
};

/**
 * Runs the camera and works out which surfaces have movement in front of them. It keeps
 * running whatever the editor shows (show mode, other views): the show is when it matters.
 */
export function useCameraTracking(
  camera: CameraConfig,
  outputs: OutputScreen[],
  surfaces: Surface[],
): CameraTracking {
  const sensor = useRef<MotionSensor | null>(null);
  // every start or stop bumps this, so a camera that finishes opening late is closed again
  const generation = useRef(0);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeIds, setActiveIds] = useState<string[]>([]);

  const zones = useMemo(() => buildZoneMap(camera, outputs, surfaces), [camera, outputs, surfaces]);
  const latest = useRef({ zones, surfaces, sensitivity: camera.sensitivity });
  latest.current = { zones, surfaces, sensitivity: camera.sensitivity };

  const listCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "videoinput",
      );
      setDevices(cameras.filter((device) => device.deviceId));
      return cameras;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    const refresh = () => void listCameras();
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, [listCameras]);

  const stop = useCallback(() => {
    generation.current++;
    sensor.current?.stop();
    sensor.current = null;
    setStream(null);
    setStarting(false);
    setActiveIds([]);
  }, []);

  useEffect(
    () => () => {
      generation.current++;
      sensor.current?.stop();
    },
    [],
  );

  /** Opens exactly this camera. `wanted` names the show's camera, for the message if it fails. */
  const open = useCallback(
    async (deviceId: string | undefined, wanted?: string) => {
      stop();
      const gen = generation.current;
      setError(null);
      setMissing(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot use a camera here.");
        return;
      }
      setStarting(true);
      const next = new MotionSensor();
      try {
        await next.start(deviceId);
      } catch (reason) {
        if (gen !== generation.current) return;
        setStarting(false);
        const name = errorName(reason);
        // asking for one particular camera fails like this when it is not plugged in
        if (wanted !== undefined && (name === "OverconstrainedError" || name === "NotFoundError"))
          setMissing(wanted);
        else setError(cameraError(reason));
        void listCameras();
        return;
      }
      if (gen !== generation.current) {
        next.stop();
        return;
      }
      sensor.current = next;
      setStream(next.stream);
      setStarting(false);
      // cameras only get their names once access is granted
      void listCameras();
    },
    [listCameras, stop],
  );

  const start = useCallback(
    async (config: CameraConfig = cameraRef.current) => {
      if (!config.deviceId && !config.deviceLabel) return open(undefined);
      const wanted = config.deviceLabel ?? "";
      const choice = resolveCamera(await listCameras(), config);
      if (choice && "missing" in choice) {
        stop();
        setError(null);
        setMissing(wanted);
        return;
      }
      // without access yet the list cannot tell; asking for the id finds out
      return open(choice ? choice.deviceId : config.deviceId, wanted);
    },
    [listCameras, open, stop],
  );

  const startWith = useCallback((deviceId: string | undefined) => open(deviceId), [open]);

  const on = !!stream || starting;
  const toggle = useCallback(() => {
    if (on) {
      stop();
      setError(null);
      setMissing(null);
    } else void start();
  }, [on, start, stop]);

  useEffect(() => {
    if (!stream) return;
    let raf = 0;
    let uiAt = 0;
    let shown = "";
    let counts = new Uint16Array(0);
    const seenAt = new Map<string, number>();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const { zones: map, surfaces: list, sensitivity } = latest.current;
      if (!sensor.current?.sample(now, sensitivity)) return;
      if (map) {
        if (counts.length !== list.length) counts = new Uint16Array(list.length);
        countMotion(sensor.current.cells, map, counts);
        list.forEach((surface, i) => {
          if (counts[i]! >= MIN_CELLS) seenAt.set(surface.id, now);
        });
      } else {
        seenAt.clear();
      }
      if (now - uiAt < UI_MS) return;
      uiAt = now;
      for (const [id, at] of seenAt) if (now - at > HOLD_MS) seenAt.delete(id);
      // only a change of the set is worth a render
      const ids = [...seenAt.keys()].sort();
      const key = ids.join("|");
      if (key === shown) return;
      shown = key;
      setActiveIds(ids);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stream]);

  return {
    on,
    stream,
    error,
    missing,
    devices,
    deviceId: stream ? sensor.current?.deviceId : undefined,
    deviceLabel: stream ? sensor.current?.deviceLabel : undefined,
    activeIds,
    sensor,
    start,
    startWith,
    stop,
    toggle,
  };
}
