import { bandLevels, silentLevels, type AudioLevels } from "./audio";
import { ReverbBus } from "./reverb";
import { shCoefficients } from "./sh";
import { defaultReverb, type ReverbConfig, type RoomConfig, type SoundItem, type Speaker, type Vec3 } from "./types";

const CH = 16; // 3rd order ACN channel count

export { shCoefficients };

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
  encoder: GainNode[]; // 16 gains into field
  ambiRot: GainNode[] | null; // 2 per channel for ambisonic files
  splitter: ChannelSplitterNode | null;
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
  private sources = new Map<string, SourceGraph>();
  private decoderNodes: AudioNode[] = [];
  private decoderKey = "";
  private room: RoomConfig;
  private raf = 0;
  maxChannels: number;

  constructor(room: RoomConfig) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.room = room;
    this.maxChannels = this.ctx.destination.maxChannelCount || 2;
    this.field = this.ctx.createChannelMerger(CH);
    this.fieldSplit = this.ctx.createChannelSplitter(CH);
    this.field.connect(this.fieldSplit);
    this.reverbIn = this.ctx.createGain();
    this.convolver = this.ctx.createConvolver();
    this.reverbOut = this.ctx.createGain();
    this.reverbIn.connect(this.convolver);
    this.convolver.connect(this.reverbOut);
    this.reverbOut.connect(this.field, 0, 0); // omni reverb into W
    this.master = this.ctx.createGain();
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 1024;
    this.masterAnalyser.smoothingTimeConstant = 0.7;
    this.masterData = new Uint8Array(new ArrayBuffer(this.masterAnalyser.frequencyBinCount));
    this.master.connect(this.masterAnalyser);
    this.master.connect(this.ctx.destination);
    this.applyRoom(room, true);
    const tick = () => {
      this.sample();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private sample() {
    this.masterAnalyser.getByteFrequencyData(this.masterData);
    this.masterLevels = bandLevels(this.masterData, this.masterLevels);
    for (const s of this.sources.values()) {
      s.analyser.getByteFrequencyData(s.data);
      s.levels = bandLevels(s.data, s.levels);
    }
  }

  levels(source: string): AudioLevels {
    if (source === "master") return this.masterLevels;
    if (source.startsWith("sound:"))
      return this.sources.get(source.slice(6))?.levels ?? silentLevels;
    return silentLevels;
  }

  resume() {
    if (this.ctx.state === "suspended") void this.ctx.resume();
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
    this.reverbOut.gain.value = { dry: 0, small: 0.18, large: 0.32, hall: 0.45 }[room.reverb];
    if (
      force ||
      prev.reverb !== room.reverb ||
      prev.width !== room.width ||
      prev.length !== room.length
    )
      this.buildImpulse();
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

  private buildImpulse() {
    const { reverb, width, length } = this.room;
    const characteristicSize = (width + length) / 2;
    const seconds =
      { dry: 0.05, small: 0.6, large: 1.4, hall: 2.6 }[reverb] * (0.6 + characteristicSize / 12);
    const rate = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    const predelay = Math.floor(rate * (characteristicSize / 343) * 0.5);
    for (let i = predelay; i < len; i++) {
      const t = (i - predelay) / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) * 0.5;
    }
    this.convolver.buffer = buf;
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
      const outCh = Math.max(1, Math.min(n, this.maxChannels));
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
        sum.connect(merger, 0, k % merger.numberOfInputs); // fold extra speakers down
      }
    });
  }

  // ---------- sources ----------

  async addSound(item: SoundItem, file: Blob): Promise<SoundItem> {
    const url = URL.createObjectURL(file);
    // Probe channel count by decoding a copy; fall back to element playback for 1–2 ch.
    let buffer: AudioBuffer | null = null;
    try {
      const probe = await this.ctx.decodeAudioData(await file.slice(0).arrayBuffer());
      if (probe.numberOfChannels >= 4) buffer = probe;
      item = {
        ...item,
        channels: probe.numberOfChannels,
        duration: probe.duration,
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
      encoder,
      ambiRot: null,
      splitter: null,
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
      const wGain = this.ctx.createGain();
      g.splitter.connect(wGain, 0);
      wGain.connect(analyser);
      wGain.connect(this.reverbIn);
      // input gain node used for master-volume scaling of whole ambisonic source via each rot gain
      this.updateAmbiRotation(g);
    } else {
      const el = new Audio(url);
      el.loop = item.loop;
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      g.el = el;
      const src = this.ctx.createMediaElementSource(el);
      src.connect(input);
      input.connect(lowpass);
      lowpass.connect(distance);
      distance.connect(analyser);
      distance.connect(this.reverbIn);
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
      encoder,
      ambiRot: null,
      splitter: null,
      startedAt: 0,
      offset: 0,
    };
    const src = this.ctx.createMediaElementSource(el);
    src.connect(input);
    input.connect(lowpass);
    lowpass.connect(distance);
    distance.connect(analyser);
    distance.connect(this.reverbIn);
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

  has(id: string) {
    return this.sources.has(id);
  }

  removeSound(id: string) {
    const g = this.sources.get(id);
    if (!g) return;
    this.stopSound(id);
    if (g.item.kind !== "video") {
      g.el?.pause();
      if (g.el) g.el.src = "";
    }
    [g.input, g.distance, g.lowpass, g.analyser, ...g.encoder, ...(g.ambiRot ?? [])].forEach((n) =>
      n.disconnect(),
    );
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
    if (g.ambiRot) {
      this.updateAmbiRotation(g, vol);
    } else {
      g.input.gain.setTargetAtTime(vol, t, 0.03);
      g.distance.gain.setTargetAtTime(dist, t, 0.03);
      const coef = shCoefficients(rel);
      g.encoder.forEach((e, i) => {
        e.gain.setTargetAtTime(orderOf(i) > order ? 0 : coef[i]!, t, 0.03);
      });
    }
  }

  private updateAmbiRotation(g: SourceGraph, vol = g.item.gain) {
    if (!g.ambiRot || !g.splitter) return;
    const th = (g.item.heading * Math.PI) / 180;
    const chans = g.buffer?.numberOfChannels ?? 0;
    const t = this.ctx.currentTime + 0.03;
    // disconnect old routing
    g.splitter.disconnect();
    const wGain = this.ctx.createGain();
    g.splitter.connect(wGain, 0);
    wGain.connect(g.analyser);
    wGain.connect(this.reverbIn);
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
        g.splitter.connect(a, i);
        a.gain.setTargetAtTime(vol, t, 0.03);
        b.gain.setTargetAtTime(0, t, 0.03);
      } else {
        const partner = n * n + n - m;
        const c = Math.cos(m * th);
        const s = Math.sin(m * th);
        g.splitter.connect(a, i);
        g.splitter.connect(b, partner);
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
      void g.el.play();
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
    if (g.el) g.el.pause();
    else if (g.bufSrc) {
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

  progress(id: string) {
    const g = this.sources.get(id);
    if (!g) return 0;
    const dur = g.item.duration || g.el?.duration || 0;
    if (!dur) return 0;
    const pos = g.el
      ? g.el.currentTime
      : g.bufSrc
        ? (this.ctx.currentTime - g.startedAt) % dur
        : g.offset;
    return Math.min(1, pos / dur);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const id of [...this.sources.keys()]) this.removeSound(id);
    void this.ctx.close();
  }
}
