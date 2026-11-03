import { shCoefficients } from "./sh";
import type { ReverbConfig } from "./types";

const CH = 16; // 3rd order ACN channel count
const TAPS = 12;
/** time constant for fading a reverb network in or out, seconds */
const FADE = 0.06;
/** how long a replaced network is faded out before it is taken apart, milliseconds */
const RETIRE_MS = 1500;

const orderOf = (acn: number) => Math.floor(Math.sqrt(acn));

/** Diffuse-tail weight per ambisonic order: keeps the late field coherent. */
const tailWeight = [1, 0.6, 0.38, 0.24];

/** Lets the page draw a frame between two heavy steps of a rebuild. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Even-ish directions on a sphere; `spread` opens them up vertically. */
function tapDirection(i: number, spread: number) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const theta = i * golden;
  const zRange = 0.15 + 0.85 * spread;
  const z = ((i / Math.max(1, TAPS - 1)) * 2 - 1) * zRange;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  // room axes: x right, y front/back (screen), z up
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r, z };
}

/** One complete set of taps and convolvers, built for one set of settings. */
type Network = {
  nodes: AudioNode[];
  /** where the shared early/tail inputs enter this network: faded in and out */
  gates: GainNode[];
  /** where this network leaves for the field: faded out before it is taken apart */
  outs: GainNode[];
};

/**
 * Ambisonic reverb bus: early reflections as directional taps plus a decorrelated
 * late tail, both written straight into the 3rd-order field so the project's
 * existing decoder renders them to any speaker layout (5.1, 7.1, cube, binaural).
 */
export class ReverbBus {
  /** Feed per-clip sends into this node. */
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  readonly input: GainNode;
  private ctx: AudioContext;
  private field: ChannelMergerNode;
  private preDelay: DelayNode;
  private earlyIn: GainNode;
  private earlyDamp: BiquadFilterNode;
  private tailIn: GainNode;
  private tailDamp: BiquadFilterNode;
  private current: Network | null = null;
  /** replaced networks still fading out */
  private retiring = new Map<ReturnType<typeof setTimeout>, Network>();
  /** bumped by every build, so a slower, older build never replaces a newer one */
  private buildId = 0;
  private destroyed = false;
  private cfg: ReverbConfig;
  private buildKey = "";
  /** ambisonic order of the room: channels above it are never decoded */
  private order: number;
  /** does any clip send sound here? Without a send the network would only run silence. */
  private needed: boolean;

  constructor(
    ctx: AudioContext,
    field: ChannelMergerNode,
    cfg: ReverbConfig,
    order: number,
    needed: boolean,
  ) {
    this.ctx = ctx;
    this.field = field;
    this.cfg = cfg;
    this.order = order;
    this.needed = needed;
    this.input = ctx.createGain();
    this.preDelay = ctx.createDelay(1);
    this.earlyIn = ctx.createGain();
    this.earlyDamp = ctx.createBiquadFilter();
    this.earlyDamp.type = "lowpass";
    this.tailIn = ctx.createGain();
    this.tailDamp = ctx.createBiquadFilter();
    this.tailDamp.type = "lowpass";
    this.input.connect(this.preDelay);
    this.preDelay.connect(this.earlyDamp);
    this.earlyDamp.connect(this.earlyIn);
    this.preDelay.connect(this.tailDamp);
    this.tailDamp.connect(this.tailIn);
    this.apply(cfg, true);
  }

  setOrder(order: number) {
    this.order = order;
    this.apply(this.cfg);
  }

  setNeeded(needed: boolean) {
    this.needed = needed;
    this.apply(this.cfg);
  }

  /**
   * Only a reverb that can be heard gets its taps and convolvers built. The bus level is
   * left out on purpose: dragging it down to 0 and back must not tear the network down.
   */
  private get active() {
    return this.needed && this.cfg.enabled;
  }

  apply(cfg: ReverbConfig, force = false) {
    if (this.destroyed) return;
    this.cfg = cfg;
    const t = this.ctx.currentTime + 0.02;

    // Cheap parameters: update live, no rebuild needed
    this.input.gain.setTargetAtTime(cfg.enabled ? cfg.level : 0, t, 0.05);
    this.earlyIn.gain.setTargetAtTime(cfg.earlyAmount, t, 0.05);
    this.tailIn.gain.setTargetAtTime(1, t, 0.05);
    const cutoff = 1200 + (1 - cfg.damping) * 16000;
    this.earlyDamp.frequency.setTargetAtTime(Math.min(18000, cutoff * 1.3), t, 0.05);
    this.tailDamp.frequency.setTargetAtTime(Math.min(18000, cutoff), t, 0.05);
    this.preDelay.delayTime.setTargetAtTime(Math.min(0.9, cfg.preDelayMs / 1000), t, 0.05);

    // Expensive parameters: changing these means rebuilding the taps and convolvers
    const key = this.active
      ? JSON.stringify([cfg.roomSize, cfg.decay, cfg.damping, cfg.earlySpread, this.order])
      : "off";

    if (force) {
      // Initial build (constructor): start it immediately
      if (this.rebuildTimer) {
        clearTimeout(this.rebuildTimer);
        this.rebuildTimer = null;
      }
      this.buildKey = key;
      void this.build();
      return;
    }

    if (key !== this.buildKey) {
      this.buildKey = key;
      // Restart the timer on every change, so the rebuild only runs
      // once the slider has been still for 250 ms
      if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(() => {
        this.rebuildTimer = null;
        void this.build();
      }, 250);
    }
  }

  /**
   * Builds the new network next to the old one, then crossfades: swapping them in one go
   * cut the old tail off mid-sound, which was heard as a click.
   */
  private async build() {
    if (this.destroyed) return;
    const id = ++this.buildId;
    const next = this.active ? await this.buildNetwork(id) : null;
    if (id !== this.buildId || this.destroyed) {
      if (next) this.release(next);
      return;
    }
    const t = this.ctx.currentTime;
    if (next) for (const gate of next.gates) gate.gain.setTargetAtTime(1, t, FADE);
    const old = this.current;
    this.current = next;
    if (old) this.retire(old);
  }

  private retire(network: Network) {
    const t = this.ctx.currentTime;
    for (const gate of network.gates) gate.gain.setTargetAtTime(0, t, FADE);
    // let what is already in the tail die away instead of cutting it
    for (const out of network.outs) out.gain.setTargetAtTime(0, t + 0.2, RETIRE_MS / 4000);
    const timer = setTimeout(() => {
      this.retiring.delete(timer);
      this.release(network);
    }, RETIRE_MS);
    this.retiring.set(timer, network);
  }

  private release(network: Network) {
    for (const gate of network.gates) {
      try {
        this.earlyIn.disconnect(gate);
      } catch {
        /* not fed from here */
      }
      try {
        this.tailIn.disconnect(gate);
      } catch {
        /* not fed from here */
      }
    }
    for (const n of network.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
      if (n instanceof ConvolverNode) n.buffer = null;
    }
  }

  /** Null when a newer build started while this one was still working. */
  private async buildNetwork(id: number): Promise<Network | null> {
    const network: Network = { nodes: [], gates: [], outs: [] };
    const earlyGate = this.ctx.createGain();
    const tailGate = this.ctx.createGain();
    earlyGate.gain.value = 0;
    tailGate.gain.value = 0;
    network.gates.push(earlyGate, tailGate);
    network.nodes.push(earlyGate, tailGate);
    this.buildEarly(network, earlyGate);
    const done = await this.buildTail(network, tailGate, id);
    if (!done) {
      this.release(network);
      return null;
    }
    // connect the inputs last, so nothing flows into a half-built network
    this.earlyIn.connect(earlyGate);
    this.tailIn.connect(tailGate);
    return network;
  }

  private buildEarly(network: Network, gate: GainNode) {
    const { roomSize, earlySpread } = this.cfg;
    const base = Math.max(0.004, roomSize / 343);
    for (let i = 0; i < TAPS; i++) {
      const delay = base * (0.25 + (1.5 * i) / TAPS);
      const tap = this.ctx.createDelay(1);
      tap.delayTime.value = Math.min(0.95, delay);
      const level = this.ctx.createGain();
      level.gain.value = 0.55 / (1 + i * 0.6);
      gate.connect(tap);
      tap.connect(level);
      network.nodes.push(tap, level);
      const coef = shCoefficients(tapDirection(i, earlySpread));
      for (let c = 0; c < CH; c++) {
        if (orderOf(c) > this.order) continue;
        const g = this.ctx.createGain();
        g.gain.value = coef[c]! * tailWeight[orderOf(c)]!;
        level.connect(g);
        g.connect(this.field, 0, c);
        network.nodes.push(g);
        network.outs.push(g);
      }
    }
  }

  /** False when the build was overtaken by a newer one. */
  private async buildTail(network: Network, gate: GainNode, id: number) {
    const { decay, roomSize, damping } = this.cfg;
    // The impulses are scaled so the omni (W) tail has unit energy. Raw, it amplified the
    // send about 32x (+30 dB) at 1.8 s decay and 85x at 12 s, so the reverb alone pushed
    // the output far past full scale, and more so the longer the decay.
    let scale = 0;
    for (let c = 0; c < CH; c++) {
      const order = orderOf(c);
      if (order > this.order) continue;
      // one convolver per step, so the page can draw in between
      await breathe();
      if (id !== this.buildId || this.destroyed) return false;
      const seconds = Math.max(0.05, decay * (order === 0 ? 1 : 0.7));
      const buffer = this.tailImpulse(seconds, roomSize, damping, c);
      const data = buffer.getChannelData(0);
      if (c === 0) {
        let energy = 0;
        for (let i = 0; i < data.length; i++) energy += data[i]! * data[i]!;
        scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
      }
      for (let i = 0; i < data.length; i++) data[i] = data[i]! * scale;
      const conv = this.ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = buffer;
      const g = this.ctx.createGain();
      g.gain.value = tailWeight[order]! * 0.7;
      gate.connect(conv);
      conv.connect(g);
      g.connect(this.field, 0, c);
      network.nodes.push(conv, g);
      network.outs.push(g);
    }
    return true;
  }

  /** Decorrelated exponentially decaying noise, one independent tail per channel. */
  private tailImpulse(seconds: number, roomSize: number, damping: number, channel: number) {
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    const build = Math.floor(rate * Math.min(0.2, roomSize / 343));
    const smooth = 0.02 + damping * 0.55;
    let state = 0;
    let seed = 1337 + channel * 7919;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const attack = build > 0 ? Math.min(1, i / build) : 1;
      state += (rnd() - state) * (1 - smooth);
      d[i] = state * Math.pow(1 - t, 2.6) * attack * 0.6;
    }
    return buf;
  }

  destroy() {
    this.destroyed = true;
    this.buildId++;
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    for (const [timer, network] of this.retiring) {
      clearTimeout(timer);
      this.release(network);
    }
    this.retiring.clear();
    if (this.current) this.release(this.current);
    this.current = null;
    this.input.disconnect();
    this.preDelay.disconnect();
    this.earlyIn.disconnect();
    this.earlyDamp.disconnect();
    this.tailIn.disconnect();
    this.tailDamp.disconnect();
  }
}
