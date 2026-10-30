import { LEVEL_SAMPLE_MS, bandLevels, silentLevels, type AudioLevels } from "./audio";
import { ReverbBus } from "./reverb";
import { shCoefficients } from "./sh";
import { waveformOf } from "./waveform";
import {
  defaultReverb,
  type ReverbConfig,
  type RoomConfig,
  type SoundItem,
  type Speaker,
  type Vec3,
} from "./types";

const CH = 16; // 3rd order ACN channel count

const orderOf = (acn: number) => Math.floor(Math.sqrt(acn));

type SourceGraph = {
  item: SoundItem;
  el: HTMLAudioElement | null;
  buffer: AudioBuffer | null;
  bufSrc: AudioBufferSourceNode | null;
  input: GainNode; // volume
  distance: GainNode;
  lowpass: BiquadFilterNode;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
  levels: AudioLevels;
  sampledAt: number;
  encoder: GainNode[]; // 16 gains into field
  ambiRot: GainNode[] | null; // 2 per channel for ambisonic files
  splitter: ChannelSplitterNode | null;
  /** W channel of an ambisonic file, feeding the analyser and the reverb send */
  ambiW: GainNode | null;
  /** the room order the ambisonic routing is wired for */
  ambiOrder: number;
  /** the gains currently set on the ambisonic routing */
  ambiKey: string;
  /** how much of this source goes to the reverb bus */
  send: GainNode;
  sendAmount: number;
  startedAt: number;
  offset: number;
};

export class SpatialEngine {
  ctx: AudioContext;
  private field: ChannelMergerNode;
  private fieldSplit: ChannelSplitterNode;
  private reverb: ReverbBus;
  private master: GainNode;
  private masterAnalyser: AnalyserNode;
  private masterData: Uint8Array<ArrayBuffer>;
  masterLevels: AudioLevels = { ...silentLevels };
  private masterSampledAt = 0;
  private sources = new Map<string, SourceGraph>();
  private decoderNodes: AudioNode[] = [];
  private decoderKey = "";
  private room: RoomConfig;
  maxChannels: number;

  constructor(room: RoomConfig, reverb: ReverbConfig = defaultReverb(), reverbNeeded = false) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // Larger audio buffers mean far fewer wake-ups of the audio thread. A show has no live
    // instrument to keep up with, so the extra few tens of milliseconds cost nothing.
    this.ctx = new Ctx({ latencyHint: "playback" });
    this.room = room;
    this.maxChannels = this.ctx.destination.maxChannelCount || 2;
    this.field = this.ctx.createChannelMerger(CH);
    this.fieldSplit = this.ctx.createChannelSplitter(CH);
    this.field.connect(this.fieldSplit);
    this.reverb = new ReverbBus(this.ctx, this.field, reverb, room.order, reverbNeeded);
    this.master = this.ctx.createGain();
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 1024;
    this.masterAnalyser.smoothingTimeConstant = 0.7;
    this.masterData = new Uint8Array(new ArrayBuffer(this.masterAnalyser.frequencyBinCount));
    this.master.connect(this.masterAnalyser);
    this.master.connect(this.ctx.destination);
    this.applyRoom(room, true);
  }

  /** Levels are analysed when asked for, so a source nothing reacts to costs no analysis. */
  levels(source: string): AudioLevels {
    const now = performance.now();
    if (source === "master") {
      if (now - this.masterSampledAt >= LEVEL_SAMPLE_MS) {
        this.masterSampledAt = now;
        this.masterAnalyser.getByteFrequencyData(this.masterData);
        this.masterLevels = bandLevels(this.masterData, this.masterLevels);
      }
      return this.masterLevels;
    }
    if (source.startsWith("sound:")) {
      const s = this.sources.get(source.slice(6));
      if (!s) return silentLevels;
      if (now - s.sampledAt >= LEVEL_SAMPLE_MS) {
        s.sampledAt = now;
        s.analyser.getByteFrequencyData(s.data);
        s.levels = bandLevels(s.data, s.levels);
      }
      return s.levels;
    }
    return silentLevels;
  }

  /** Re-read how many outputs the device offers and rebuild routing if it changed. */
  refreshChannels() {
    const max = this.ctx.destination.maxChannelCount || 2;
    if (max !== this.maxChannels) {
      this.maxChannels = max;
      this.decoderKey = "";
      this.applyRoom(this.room, true);
    }
    return this.maxChannels;
  }

  resume() {
    if (this.ctx.state === "suspended") void this.ctx.resume().then(() => this.refreshChannels());
  }

  async setOutputDevice(deviceId: string) {
    const c = this.ctx as unknown as { setSinkId?: (id: string) => Promise<void> };
    if (c.setSinkId) {
      await c.setSinkId(deviceId);
      this.maxChannels = this.ctx.destination.maxChannelCount || 2;
      this.decoderKey = "";
      this.applyRoom(this.room, true);
    }
  }

  // ---------- room / decoder ----------

  applyRoom(room: RoomConfig, force = false) {
    const prev = this.room;
    this.room = room;
    this.master.gain.value = room.masterGain;
    if (prev.order !== room.order) this.reverb.setOrder(room.order);
    const key = JSON.stringify([
      room.outputMode,
      room.speakers,
      room.order,
      room.width,
      room.length,
    ]);
    if (force || key !== this.decoderKey) {
      this.decoderKey = key;
      this.buildDecoder();
    }
    if (
      force ||
      prev.order !== room.order ||
      prev.listener !== room.listener ||
      prev.width !== room.width ||
      prev.length !== room.length
    ) {
      for (const s of this.sources.values()) this.updateSource(s);
    }
  }

  /** Apply Audio Effects reverb bus settings. */
  applyReverb(cfg: ReverbConfig) {
    this.reverb.apply(cfg);
  }

  /** Whether any clip sends sound to the reverb; without one its network is not built. */
  setReverbNeeded(needed: boolean) {
    this.reverb.setNeeded(needed);
  }

  /** Amount of a source sent into the reverb bus, 0..1. Called every frame while playing. */
  setReverbSend(id: string, amount: number) {
    const g = this.sources.get(id);
    if (!g) return;
    const next = Math.max(0, Math.min(1, amount));
    if (next === g.sendAmount) return;
    g.sendAmount = next;
    g.send.gain.setTargetAtTime(next, this.ctx.currentTime + 0.02, 0.03);
  }

  private buildDecoder() {
    for (const n of this.decoderNodes) n.disconnect();
    this.decoderNodes = [];
    const { outputMode, speakers, order } = this.room;
    const spk: Speaker[] =
      outputMode === "headphones"
        ? [
            { id: "v0", name: "", position: { x: -0.6, y: -0.6, z: -0.5 } },
            { id: "v1", name: "", position: { x: 0.6, y: -0.6, z: -0.5 } },
            { id: "v2", name: "", position: { x: -0.6, y: 0.6, z: -0.5 } },
            { id: "v3", name: "", position: { x: 0.6, y: 0.6, z: -0.5 } },
            { id: "v4", name: "", position: { x: -0.6, y: -0.6, z: 0.5 } },
            { id: "v5", name: "", position: { x: 0.6, y: -0.6, z: 0.5 } },
            { id: "v6", name: "", position: { x: -0.6, y: 0.6, z: 0.5 } },
            { id: "v7", name: "", position: { x: 0.6, y: 0.6, z: 0.5 } },
            { id: "v8", name: "", position: { x: 0, y: -1, z: 0 } },
            { id: "v9", name: "", position: { x: 0, y: 1, z: 0 } },
            { id: "v10", name: "", position: { x: -1, y: 0, z: 0 } },
            { id: "v11", name: "", position: { x: 1, y: 0, z: 0 } },
          ]
        : speakers;
    const n = Math.max(1, spk.length);
    let merger: ChannelMergerNode | null = null;
    if (outputMode === "speakers") {
      const wanted = Math.max(n, ...speakers.map((sp, k) => (sp.channel ?? k) + 1));
      const outCh = Math.max(1, Math.min(wanted, this.maxChannels));
      merger = this.ctx.createChannelMerger(outCh);
      try {
        this.ctx.destination.channelCount = outCh;
        this.ctx.destination.channelCountMode = "explicit";
        this.ctx.destination.channelInterpretation = "discrete";
      } catch {
        /* device refuses */
      }
      merger.connect(this.master);
      this.decoderNodes.push(merger);
    }
    spk.forEach((sp, k) => {
      const sum = this.ctx.createGain();
      const coef = shCoefficients(sp.position);
      for (let i = 0; i < CH; i++) {
        const o = orderOf(i);
        if (o > order) continue;
        // sampling decoder with max-rE style weights
        const w = [1, 0.775, 0.4, 0.105][o]! * (2 * o + 1);
        const g = this.ctx.createGain();
        g.gain.value = (coef[i]! * w) / n;
        this.fieldSplit.connect(g, i);
        g.connect(sum);
        this.decoderNodes.push(g);
      }
      this.decoderNodes.push(sum);
      if (outputMode === "headphones") {
        const p = this.ctx.createPanner();
        p.panningModel = "HRTF";
        p.distanceModel = "linear";
        p.refDistance = 1;
        p.maxDistance = 10;
        p.rolloffFactor = 0;
        p.positionX.value = sp.position.x;
        p.positionY.value = sp.position.z;
        p.positionZ.value = sp.position.y;
        sum.connect(p);
        p.connect(this.master);
        this.decoderNodes.push(p);
      } else if (merger) {
        sum.connect(merger, 0, (sp.channel ?? k) % merger.numberOfInputs); // fold extra speakers down
      }
    });
  }

  // ---------- sources ----------

  async addSound(item: SoundItem, file: Blob): Promise<SoundItem> {
    // Probe channel count by decoding a copy; fall back to element playback for 1–2 ch.
    // A saved sound that plays through an element already knows all of this, so opening a
    // show does not have to decode every file in full.
    let buffer: AudioBuffer | null = null;
    const known = item.duration > 0 && item.channels < 4 && !!item.peaks;
    if (!known) {
      try {
        const probe = await this.ctx.decodeAudioData(await file.slice(0).arrayBuffer());
        if (probe.numberOfChannels >= 4) buffer = probe;
        item = {
          ...item,
          channels: probe.numberOfChannels,
          duration: probe.duration,
          peaks: item.peaks ?? waveformOf(probe).peaks,
          kind:
            probe.numberOfChannels >= 4
              ? "ambisonic"
              : probe.numberOfChannels === 1
                ? "mono"
                : "stereo",
        };
      } catch {
        /* browser cannot decode fully; still try element playback */
      }
    }
    const input = this.ctx.createGain();
    input.channelCount = 1;
    input.channelCountMode = "explicit";
    const distance = this.ctx.createGain();
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    const encoder: GainNode[] = [];
    const send = this.ctx.createGain();
    send.gain.value = 0;
    send.connect(this.reverb.input);
    const g: SourceGraph = {
      item,
      el: null,
      buffer,
      bufSrc: null,
      input,
      distance,
      lowpass,
      analyser,
      data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
      levels: { ...silentLevels },
      sampledAt: 0,
      encoder,
      ambiRot: null,
      splitter: null,
      ambiW: null,
      ambiOrder: -1,
      ambiKey: "",
      send,
      sendAmount: 0,
      startedAt: 0,
      offset: 0,
    };
    if (buffer) {
      // Ambisonic: rotate about vertical, feed straight into field. Reverb from W.
      g.splitter = this.ctx.createChannelSplitter(CH);
      g.ambiRot = [];
      for (let i = 0; i < CH; i++) {
        const a = this.ctx.createGain();
        const b = this.ctx.createGain();
        g.ambiRot.push(a, b);
        a.connect(this.field, 0, i);
        b.connect(this.field, 0, i);
      }
      g.ambiW = this.ctx.createGain();
      g.ambiW.connect(analyser);
      g.ambiW.connect(send);
      // input gain node used for master-volume scaling of whole ambisonic source via each rot gain
      this.updateAmbiRotation(g);
    } else {
      const el = new Audio(URL.createObjectURL(file));
      el.loop = item.loop;
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      g.el = el;
      const src = this.ctx.createMediaElementSource(el);
      src.connect(input);
      input.connect(lowpass);
      lowpass.connect(distance);
      distance.connect(analyser);
      distance.connect(send);
      for (let i = 0; i < CH; i++) {
        const e = this.ctx.createGain();
        e.gain.value = 0;
        distance.connect(e);
        e.connect(this.field, 0, i);
        encoder.push(e);
      }
      if (!item.duration) {
        el.addEventListener("loadedmetadata", () => {
          g.item = { ...g.item, duration: el.duration };
        });
      }
    }
    this.sources.set(item.id, g);
    this.updateSource(g);
    return item;
  }

  /**
   * Route an existing media element (e.g. a video already on the stage) into the
   * spatial field. Playback stays owned by that element, so picture and sound
   * can never drift apart.
   */
  addElementSound(item: SoundItem, el: HTMLMediaElement): SoundItem {
    if (this.sources.has(item.id)) return item;
    const input = this.ctx.createGain();
    const distance = this.ctx.createGain();
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    const encoder: GainNode[] = [];
    const send = this.ctx.createGain();
    send.gain.value = 0;
    send.connect(this.reverb.input);
    el.muted = false;
    const g: SourceGraph = {
      item,
      el: el as HTMLAudioElement,
      buffer: null,
      bufSrc: null,
      input,
      distance,
      lowpass,
      analyser,
      data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
      levels: { ...silentLevels },
      sampledAt: 0,
      encoder,
      ambiRot: null,
      splitter: null,
      ambiW: null,
      ambiOrder: -1,
      ambiKey: "",
      send,
      sendAmount: 0,
      startedAt: 0,
      offset: 0,
    };
    const src = this.ctx.createMediaElementSource(el);
    src.connect(input);
    input.connect(lowpass);
    lowpass.connect(distance);
    distance.connect(analyser);
    distance.connect(send);
    for (let i = 0; i < CH; i++) {
      const e = this.ctx.createGain();
      e.gain.value = 0;
      distance.connect(e);
      e.connect(this.field, 0, i);
      encoder.push(e);
    }
    this.sources.set(item.id, g);
    this.updateSource(g);
    return { ...item, duration: el.duration || item.duration };
  }

  removeSound(id: string) {
    const g = this.sources.get(id);
    if (!g) return;
    this.stopSound(id);
    if (g.item.kind !== "video") {
      g.el?.pause();
      if (g.el) {
        URL.revokeObjectURL(g.el.src);
        g.el.src = "";
      }
    }
    [
      g.input,
      g.distance,
      g.lowpass,
      g.analyser,
      g.send,
      ...g.encoder,
      ...(g.ambiRot ?? []),
      ...(g.ambiW ? [g.ambiW] : []),
    ].forEach((n) => n.disconnect());
    g.splitter?.disconnect();
    this.sources.delete(id);
  }

  updateItem(item: SoundItem) {
    const g = this.sources.get(item.id);
    if (!g) return;
    const wasPlaying = g.item.playing;
    g.item = item;
    if (g.el) g.el.loop = item.loop;
    this.updateSource(g);
    if (item.playing && !wasPlaying) this.playSound(item.id);
    else if (!item.playing && wasPlaying) this.pauseSound(item.id);
  }

  setPosition(id: string, position: Vec3) {
    const g = this.sources.get(id);
    if (!g) return;
    g.item = { ...g.item, position };
    this.updateSource(g);
  }

  private anySolo() {
    for (const s of this.sources.values()) if (s.item.solo) return true;
    return false;
  }

  updateSource(g: SourceGraph) {
    const { item } = g;
    const solo = this.anySolo();
    const audible = !item.mute && (!solo || item.solo);
    const vol = audible ? item.gain : 0;
    if (g.ambiRot) {
      // an ambisonic file only turns with its heading: its position does not change the sound
      this.updateAmbiRotation(g, vol);
      return;
    }
    const { listener, width, length, order } = this.room;
    const verticalScale = (width + length) / 4;
    const rel = {
      x: (item.position.x - listener.x) * (width / 2),
      y: (item.position.y - listener.y) * (length / 2),
      z: (item.position.z - listener.z) * verticalScale,
    };
    const metres = Math.hypot(rel.x, rel.y, rel.z);
    const dist = 1 / Math.max(1, metres);
    const t = this.ctx.currentTime + 0.03;
    g.lowpass.frequency.setTargetAtTime(Math.max(800, 18000 / (1 + metres * 0.35)), t, 0.03);
    g.input.gain.setTargetAtTime(vol, t, 0.03);
    g.distance.gain.setTargetAtTime(dist, t, 0.03);
    const coef = shCoefficients(rel);
    g.encoder.forEach((e, i) => {
      e.gain.setTargetAtTime(orderOf(i) > order ? 0 : coef[i]!, t, 0.03);
    });
  }

  private updateAmbiRotation(g: SourceGraph, vol = g.item.gain) {
    if (!g.ambiRot || !g.splitter) return;
    const { order } = this.room;
    const key = `${vol}|${g.item.heading}|${order}`;
    if (key === g.ambiKey) return;
    g.ambiKey = key;
    const th = (g.item.heading * Math.PI) / 180;
    const chans = g.buffer?.numberOfChannels ?? 0;
    const t = this.ctx.currentTime + 0.03;
    // the routing depends on the order alone; heading and volume only move the gains
    const rewire = g.ambiOrder !== order;
    if (rewire) {
      g.ambiOrder = order;
      g.splitter.disconnect();
      if (g.ambiW) g.splitter.connect(g.ambiW, 0);
    }
    for (let i = 0; i < CH; i++) {
      const a = g.ambiRot[i * 2]!;
      const b = g.ambiRot[i * 2 + 1]!;
      const n = orderOf(i);
      const m = i - n * n - n;
      const usable = i < chans && n <= this.room.order;
      if (!usable) {
        a.gain.setTargetAtTime(0, t, 0.03);
        b.gain.setTargetAtTime(0, t, 0.03);
        continue;
      }
      if (m === 0) {
        if (rewire) g.splitter.connect(a, i);
        a.gain.setTargetAtTime(vol, t, 0.03);
        b.gain.setTargetAtTime(0, t, 0.03);
      } else {
        const partner = n * n + n - m;
        const c = Math.cos(m * th);
        const s = Math.sin(m * th);
        if (rewire) {
          g.splitter.connect(a, i);
          g.splitter.connect(b, partner);
        }
        a.gain.setTargetAtTime(vol * c, t, 0.03);
        b.gain.setTargetAtTime(vol * (m > 0 ? -s : s), t, 0.03);
      }
    }
  }

  playSound(id: string) {
    const g = this.sources.get(id);
    if (!g) return;
    this.resume();
    if (g.el) {
      // this runs every frame while the timeline plays
      if (g.el.paused) void g.el.play().catch(() => undefined);
    } else if (g.buffer && g.splitter) {
      if (g.bufSrc) return;
      const src = this.ctx.createBufferSource();
      src.buffer = g.buffer;
      src.loop = g.item.loop;
      src.connect(g.splitter);
      src.start(0, g.offset % g.buffer.duration);
      g.startedAt = this.ctx.currentTime - g.offset;
      g.bufSrc = src;
      src.onended = () => {
        if (g.bufSrc === src && !g.item.loop) g.offset = 0;
      };
    }
  }

  pauseSound(id: string) {
    const g = this.sources.get(id);
    if (!g) return;
    if (g.el) {
      if (!g.el.paused) g.el.pause();
    } else if (g.bufSrc) {
      g.offset = this.ctx.currentTime - g.startedAt;
      g.bufSrc.stop();
      g.bufSrc = null;
    }
  }

  stopSound(id: string) {
    const g = this.sources.get(id);
    if (!g) return;
    this.pauseSound(id);
    if (g.el) g.el.currentTime = 0;
    g.offset = 0;
  }

  /** Jump a source to a position in seconds (used to line sound up with video). */
  seek(id: string, seconds: number) {
    const g = this.sources.get(id);
    if (!g) return;
    const at = Math.max(0, seconds);
    if (g.el) g.el.currentTime = at;
    else {
      g.offset = at;
      if (g.bufSrc) {
        g.bufSrc.stop();
        g.bufSrc = null;
        if (g.item.playing) this.playSound(id);
      }
    }
  }

  destroy() {
    for (const id of [...this.sources.keys()]) this.removeSound(id);
    this.reverb.destroy();
    void this.ctx.close();
  }
}
