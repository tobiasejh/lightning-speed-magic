export type AudioLevels = { level: number; bass: number; mid: number; high: number };

export const silentLevels: AudioLevels = { level: 0, bass: 0, mid: 0, high: 0 };

/** Something that can answer "how loud is source X right now". */
export type AudioLevelProvider = (source: string) => AudioLevels;

/** Turn byte frequency data into smoothed band levels. */
export function bandLevels(d: Uint8Array, prev: AudioLevels): AudioLevels {
  const band = (from: number, to: number) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += d[i]!;
    return sum / Math.max(1, to - from) / 255;
  };
  const n = d.length;
  const bass = band(1, Math.floor(n * 0.06));
  const mid = band(Math.floor(n * 0.06), Math.floor(n * 0.25));
  const high = band(Math.floor(n * 0.25), Math.floor(n * 0.7));
  const level = bass * 0.6 + mid * 0.3 + high * 0.1;
  const ease = (a: number, b: number) => a + (b - a) * 0.35;
  return {
    bass: ease(prev.bass, bass),
    mid: ease(prev.mid, mid),
    high: ease(prev.high, high),
    level: ease(prev.level, Math.min(1, level * 1.6)),
  };
}


/** Microphone analyser that keeps a smoothed set of band levels up to date. */
export class MicAnalyser {
  levels: AudioLevels = { ...silentLevels };
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private raf = 0;

  get active() {
    return !!this.analyser;
  }

  async start() {
    if (this.analyser) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.7;
    src.connect(analyser);
    this.ctx = ctx;
    this.stream = stream;
    this.analyser = analyser;
    this.data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    const tick = () => {
      this.sample();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private sample() {
    const a = this.analyser;
    const d = this.data;
    if (!a || !d) return;
    a.getByteFrequencyData(d);
    this.levels = bandLevels(d, this.levels);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.data = null;
    this.levels = { ...silentLevels };
  }
}
