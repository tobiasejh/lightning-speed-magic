/**
 * Look-ahead peak limiter on the master output. Every channel shares one gain, so the
 * spatial image does not shift while it works. The signal is delayed a few milliseconds
 * so the gain is already down when a peak arrives, instead of clipping it.
 */
const PROCESSOR = `
class PrismLimiter extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.ceiling = o.ceiling;
    this.size = Math.max(1, Math.round((o.lookaheadMs * sampleRate) / 1000));
    this.attack = Math.exp(-3 / this.size);
    this.release = Math.exp(-1 / ((o.releaseMs * sampleRate) / 1000));
    this.gain = 1;
    this.channels = 0;
  }

  setup(channels) {
    this.channels = channels;
    this.delay = Array.from({ length: channels }, () => new Float32Array(this.size));
    this.wanted = new Float32Array(this.size).fill(1);
    // monotonic queue of indexes into wanted: the smallest wanted gain in the window
    this.queue = new Int32Array(this.size + 1);
    this.head = 0;
    this.tail = 0;
    this.pos = 0;
    this.count = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) return true;
    const channels = Math.min(input.length, output.length);
    if (channels !== this.channels) this.setup(channels);
    const frames = input[0].length;
    const size = this.size;
    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < channels; c++) {
        const x = input[c][i];
        const a = x < 0 ? -x : x;
        if (a > peak) peak = a;
      }
      const need = peak > this.ceiling ? this.ceiling / peak : 1;
      const slot = this.pos;
      // drop the slot that leaves the window, then keep the queue increasing
      if (this.count === size && this.tail !== this.head && this.queue[this.head % (size + 1)] === slot) this.head++;
      this.wanted[slot] = need;
      while (this.tail !== this.head && this.wanted[this.queue[(this.tail - 1) % (size + 1)]] >= need) this.tail--;
      this.queue[this.tail % (size + 1)] = slot;
      this.tail++;
      if (this.count < size) this.count++;
      const target = this.wanted[this.queue[this.head % (size + 1)]];
      this.gain = target < this.gain
        ? target + (this.gain - target) * this.attack
        : target + (this.gain - target) * this.release;
      const g = this.gain;
      for (let c = 0; c < channels; c++) {
        const line = this.delay[c];
        let y = line[slot] * g;
        line[slot] = input[c][i];
        // last resort: never hand the sound card anything it would clip
        if (y > this.ceiling) y = this.ceiling;
        else if (y < -this.ceiling) y = -this.ceiling;
        output[c][i] = y;
      }
      this.pos = slot + 1 === size ? 0 : slot + 1;
    }
    return true;
  }
}
registerProcessor("prism-limiter", PrismLimiter);
`;

let moduleUrl: string | null = null;

/** Puts a limiter between `from` and `to`. Resolves to null when the browser cannot. */
export async function insertLimiter(ctx: AudioContext, from: AudioNode, to: AudioNode) {
  try {
    moduleUrl ??= URL.createObjectURL(new Blob([PROCESSOR], { type: "text/javascript" }));
    await ctx.audioWorklet.addModule(moduleUrl);
    const limiter = new AudioWorkletNode(ctx, "prism-limiter", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCountMode: "max",
      channelInterpretation: "discrete",
      // -1 dBFS, as asked for in the feature list
      processorOptions: { ceiling: 0.89, lookaheadMs: 5, releaseMs: 150 },
    });
    from.connect(limiter);
    limiter.connect(to);
    from.disconnect(to);
    return limiter;
  } catch {
    return null;
  }
}
