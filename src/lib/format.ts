/** Seconds as "m:ss". */
export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** Seconds as "m:ss.t" (with tenths). */
export const formatTimeTenths = (seconds: number) =>
  `${formatTime(seconds)}.${String(Math.floor((seconds % 1) * 10))}`;
