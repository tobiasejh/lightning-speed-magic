# Audio Effects tab with an ambisonic reverb bus

Adds a new **Audio Effects** tab next to Stage, Room, Editor and Timeline. Its first effect is a reverb bus that individual audio clips can be sent into, live. The bus is fully surround: it builds its echo in 3rd-order ambisonics and is decoded through whatever speaker setup is selected (headphones, stereo, quad, 5.1, 7.1, cube, custom), the same as the rest of Prism's sound.

The old simple room echo picker (dry / small / large / hall) in Sound settings is removed — all reverb now comes from this bus.

## What you get

**Audio Effects tab**

- Reverb bus card with:
  - On/off and an output level for the whole bus.
  - Room size in metres (small booth up to large hall).
  - Decay length in seconds (how long the tail rings out).
  - Early reflections: amount, spread (how wide the first bounces arrive), and pre-delay in milliseconds.
  - Tail damping, so big rooms sound natural rather than bright.
- A list of every audio clip on the timeline with a 0–100% send slider each. 100% sends the clip's full signal into the reverb; 0% is fully dry. The dry sound always keeps playing as before.
- Room size and decay show a short plain-language hint of what they do.

**In the Timeline tab**

- A selected audio clip gains a "Reverb send" slider in the clip inspector, so sends can be set without leaving the timeline.
- Clip send amounts are saved with the project and take effect the moment the clip plays. If the same sound is used by two clips, the amount of the clip currently playing is used.

## Technical details

- `src/lib/types.ts`
  - New `ReverbConfig`: `enabled`, `level`, `roomSize` (m), `decay` (s), `earlyAmount`, `earlySpread`, `preDelayMs`, `damping`. Default: on, 12 m, 1.8 s, moderate early reflections, 20 ms pre-delay.
  - `RoomConfig.reverb` (the `"dry" | "small" | "large" | "hall"` string) is dropped from the active type; `upgradeRoom()` maps old values onto sensible `ReverbConfig` defaults so existing projects keep a comparable sound.
  - `TimelineClip.reverbSend?: number` (0..1).
  - Project data version bumped; loader fills `reverb` when absent.
- `src/lib/reverb.ts` (new)
  - `buildEarlyReflections(ctx, cfg)`: generates discrete taps from image-source style delays derived from `roomSize`, each tap given a direction; directions are turned into 16 SH gains via existing `shCoefficients` so early reflections arrive from distinct points in the field.
  - `buildTailImpulse(ctx, cfg)`: generates a 4-channel (first-order style) decorrelated noise tail, exponentially decayed over `decay`, low-passed by `damping`, with pre-delay; upmixed into the 16-channel field with order-dependent weights so the tail stays coherent at 3rd order without needing 16 independent convolvers.
- `src/lib/audio-engine.ts`
  - Replace `reverbIn`/`convolver`/`reverbOut` with a `ReverbBus` class instance: input gain → pre-delay → split into early tap network and tail convolver → per-channel gains → the existing 16-channel `field` merger. Because it feeds the field, the existing sampling decoder already renders it to the chosen speaker layout (e.g. 3rd order → 5.1).
  - Per-source sends: each `SourceGraph` gets a `send: GainNode` fed from `distance` (or the ambisonic W path) into the bus input, replacing the current fixed `reverbIn` connection. `setReverbSend(soundId, amount)` ramps it.
  - `applyReverb(cfg)` rebuilds impulses only when `roomSize`, `decay`, `damping` or `preDelayMs` change; level and early amount are live gain changes.
  - `applyRoom()` no longer touches reverb; `buildImpulse()` removed.
- `src/components/AudioEffectsPanel.tsx` (new): the tab body; controls bound to `ReverbConfig` plus per-clip send sliders, using existing slider/switch/card components and design tokens.
- `src/components/MappingToolbar.tsx`: `StageView` gains `"effects"`, with an Audio Effects button and its own hint line.
- `src/routes/index.tsx`: `reverb` state alongside `room`, persisted and autosaved; renders `AudioEffectsPanel` when the view is `effects`; when the timeline scheduler starts/stops an audio clip it calls `engine.setReverbSend(clip.soundId, clip.reverbSend ?? 0)` and returns it to 0 on clip end; undo history covers reverb and send edits.
- `src/components/ShowPanel.tsx`: reverb-send slider in the selected-clip inspector for audio clips.
- `src/components/SoundPanel.tsx`: remove the old reverb select; add a line pointing to the Audio Effects tab.
- `src/routes/output.tsx` / `src/lib/sync.ts`: reverb config travels in the snapshot for completeness; projector windows stay silent, so no audio change there.
- Verify in the browser: send a clip at 100%, confirm audible tail and that changing room size/decay alters it, check 5.1 speaker mode still decodes, and confirm reload restores sends.
