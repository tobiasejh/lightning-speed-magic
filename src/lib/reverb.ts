import { shCoefficients } from "./sh";
import type { ReverbConfig } from "./types";

const CH = 16; // 3rd order ACN channel count
const TAPS = 12;

const orderOf = (acn: number) => Math.floor(Math.sqrt(acn));

/** Diffuse-tail weight per ambisonic order: keeps the late field coherent. */
const tailWeight = [1, 0.6, 0.38, 0.24];

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

/**
 * Ambisonic reverb bus: early reflections as directional taps plus a decorrelated
 * late tail, both written straight into the 3rd-order field so the project's
 * existing decoder renders them to any speaker layout (5.1, 7.1, cube, binaural).
 */
export class ReverbBus {
  /** Feed per-clip sends into this node. */
  readonly input: GainNode;
  private ctx: AudioContext;
  private field: ChannelMergerNode;
  private preDelay: DelayNode;
  private earlyIn: GainNode;
  private earlyDamp: BiquadFilterNode;
  private tailIn: GainNode;
  private tailDamp: BiquadFilterNode;
  private nodes: AudioNode[] = [];
  private cfg: ReverbConfig;
  private buildKey = "";

  constructor(ctx: AudioContext, field: ChannelMergerNode, cfg: ReverbConfig) {
    this.ctx = ctx;
    this.field = field;
    this.cfg = cfg;
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

  apply(cfg: ReverbConfig, force = false) {
    const prev = this.cfg;
    this.cfg = cfg;
    const t = this.ctx.currentTime + 0.02;
    this.input.gain.setTargetAtTime(cfg.enabled ? cfg.level : 0, t, 0.05);
    this.earlyIn.gain.setTargetAtTime(cfg.earlyAmount, t, 0.05);
    this.tailIn.gain.setTargetAtTime(1, t, 0.05);
    const cutoff = 1200 + (1 - cfg.damping) * 16000;
    this.earlyDamp.frequency.setTargetAtTime(Math.min(18000, cutoff * 1.3), t, 0.05);
    this.tailDamp.frequency.setTargetAtTime(Math.min(18000, cutoff), t, 0.05);
    this.preDelay.delayTime.setTargetAtTime(Math.min(0.9, cfg.preDelayMs / 1000), t, 0.05);
    const key = JSON.stringify([cfg.roomSize, cfg.decay, cfg.damping, cfg.earlySpread]);
    if (force || key !== this.buildKey || prev.roomSize !== cfg.roomSize) {
      this.buildKey = key;
      this.build();
    }
  }

  private build() {
    for (const n of this.nodes) n.disconnect();
    this.nodes = [];
    this.buildEarly();
    this.buildTail();
  }

  private buildEarly() {
    const { roomSize, earlySpread } = this.cfg;
    const base = Math.max(0.004, roomSize / 343);
    for (let i = 0; i < TAPS; i++) {
      const delay = base * (0.25 + (1.5 * i) / TAPS);
      const tap = this.ctx.createDelay(1);
      tap.delayTime.value = Math.min(0.95, delay);
      const level = this.ctx.createGain();
      level.gain.value = 0.55 / (1 + i * 0.6);
      this.earlyIn.connect(tap);
      tap.connect(level);
      this.nodes.push(tap, level);
      const coef = shCoefficients(tapDirection(i, earlySpread));
      for (let c = 0; c < CH; c++) {
        const g = this.ctx.createGain();
        g.gain.value = coef[c]! * tailWeight[orderOf(c)]!;
        level.connect(g);
        g.connect(this.field, 0, c);
        this.nodes.push(g);
      }
    }
  }

  private buildTail() {
    const { decay, roomSize, damping } = this.cfg;
    for (let c = 0; c < CH; c++) {
      const order = orderOf(c);
      const seconds = Math.max(0.05, decay * (order === 0 ? 1 : 0.7));
      const conv = this.ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = this.tailImpulse(seconds, roomSize, damping, c);
      const g = this.ctx.createGain();
      g.gain.value = tailWeight[order]! * 0.7;
      this.tailIn.connect(conv);
      conv.connect(g);
      g.connect(this.field, 0, c);
      this.nodes.push(conv, g);
    }
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
    for (const n of this.nodes) n.disconnect();
    this.nodes = [];
    this.input.disconnect();
    this.preDelay.disconnect();
    this.earlyIn.disconnect();
    this.earlyDamp.disconnect();
    this.tailIn.disconnect();
    this.tailDamp.disconnect();
  }
}
