/** Loudness overview of an audio (or video) file, drawn behind automation lanes. */
export type Waveform = { duration: number; peaks: number[] };

const BUCKETS = 480;

/** Decodes a file once and reduces it to a small peak list (0..1). */
export async function decodeWaveform(blob: Blob, buckets = BUCKETS): Promise<Waveform | null> {
  try {
    const Ctx =
      typeof window === "undefined"
        ? undefined
        : (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return null;
    const ctx = new Ctx();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();
    const data = buffer.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / buckets));
    const peaks: number[] = [];
    for (let i = 0; i < buckets; i++) {
      let peak = 0;
      const start = i * size;
      for (let j = start; j < start + size && j < data.length; j++) {
        const value = Math.abs(data[j] ?? 0);
        if (value > peak) peak = value;
      }
      peaks.push(Math.round(peak * 100) / 100);
    }
    return { duration: buffer.duration, peaks };
  } catch {
    return null;
  }
}
