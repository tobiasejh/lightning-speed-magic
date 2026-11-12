import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MotionSensor, buildZoneMap, countMotion } from "@/lib/motion";
import type { CameraConfig, OutputScreen, Surface } from "@/lib/types";

/** Moving grid cells a surface needs before it counts: fewer is a flicker at its edge. */
const MIN_CELLS = 2;
/** A surface stays marked this long after its last movement, so the marking does not flicker. */
const HOLD_MS = 400;
/** How often React hears about it; the analysis itself runs in refs. */
const UI_MS = 80;

export type CameraTracking = {
  on: boolean;
  /** the live camera picture, for <video> elements that show it */
  stream: MediaStream | null;
  error: string | null;
  devices: MediaDeviceInfo[];
  /** the camera in use, which is the system default until one is picked */
  deviceId: string | undefined;
  /** ids of the surfaces with movement in front of them right now */
  activeIds: string[];
  /** the sensor's latest grid, read by the preview on its own clock */
  sensor: { readonly current: MotionSensor | null };
  toggle: () => void;
};

const cameraError = (error: unknown) => {
  const name = error instanceof DOMException ? error.name : "";
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
  const [on, setOn] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [usedDeviceId, setUsedDeviceId] = useState<string | undefined>(undefined);
  const [activeIds, setActiveIds] = useState<string[]>([]);

  const zones = useMemo(() => buildZoneMap(camera, outputs, surfaces), [camera, outputs, surfaces]);
  const latest = useRef({ zones, surfaces, sensitivity: camera.sensitivity });
  latest.current = { zones, surfaces, sensitivity: camera.sensitivity };

  const refreshDevices = useCallback(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === "videoinput" && d.deviceId)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  // start, stop, and switch to another camera while running
  const deviceId = camera.deviceId;
  useEffect(() => {
    if (!on) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot use a camera here.");
      setOn(false);
      return;
    }
    let cancelled = false;
    const next = new MotionSensor();
    next
      .start(deviceId)
      .then(() => {
        if (cancelled) {
          next.stop();
          return;
        }
        sensor.current = next;
        setStream(next.stream);
        setError(null);
        // cameras only get their names once access is granted
        refreshDevices();
        setUsedDeviceId(next.deviceId);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(cameraError(reason));
        setOn(false);
      });
    return () => {
      cancelled = true;
      next.stop();
      if (sensor.current === next) sensor.current = null;
      setStream(null);
      setActiveIds([]);
    };
  }, [on, deviceId, refreshDevices]);

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

  const toggle = useCallback(() => {
    setError(null);
    setOn((current) => !current);
  }, []);

  return { on, stream, error, devices, deviceId: usedDeviceId, activeIds, sensor, toggle };
}
