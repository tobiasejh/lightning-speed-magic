# Prism v2: finish the build

Continues the approved v2 plan. Already in place: the two helper packages, the new data shapes (`src/lib/types.ts`), corner-snapping logic (`src/lib/snap.ts`) and the five test patterns (`src/lib/patterns.ts`). Nothing is wired into the screen yet, and `src/routes/index.tsx` / `SurfaceLayer.tsx` still use the old surface shape, so step 1 also repairs that.

## Steps

1. Wire the new surface fields (fit, flip, rotate, audio source) into `SurfaceLayer` and the surface list, add per-surface Fit / Flip / Rotate controls. Fixes the current type mismatch.
2. Sound tab: add music, mono, stereo and ambisonic (4/9/16 channel) files; rows with play/pause, loop, volume, mute, solo, colour; master Play all / Stop all / master volume. Each surface can pick "Microphone", "Master" or a specific sound as what it reacts to.
3. Spatial audio engine: per-sound gain -> 3rd-order ambisonic encode (order selectable 1-3) -> room reverb (dry/small/large/hall) -> decode to headphones (binaural) or to a speaker layout (stereo, quad, 5.1, 7.1, cube, custom N). Distance falloff and far-source softening. Ambisonic files pass straight into the field with a heading control. Output device picker where the browser allows it; shows the device's available channel count.
4. Room view: a toggle switches the stage to a top-down room. Drag sound icons, the listener and (in custom layout) speakers; a small slider sets each sound's height. Room size, reverb and order controls in the sidebar.
5. Mapping toolbar: Snap on/off (Shift disables while dragging, snapped corner flashes), Test pattern picker (grid, crosshair, colour bars, edge frame, numbered) drawn through every surface's warp; turns off when Play all is pressed.
6. Separate output screen: "Open output window" opens `/output` (visuals only, black, click for fullscreen). Live sync of surfaces, corners, visuals, media, globals and test pattern; media files are shared to the output window. Audio stays in the control window. Button reads "Reopen" if the window is closed.
7. Projects: Save, Save as, Open, Duplicate, Delete, Export/Import `.prism`. Stored on this device including photo/video/sound files; autosave every few seconds; last project reopens on launch.
8. Verify in the browser (mapping, sounds, room, output window, save/reopen) and update the roadmap.

## Technical details

- `src/lib/audio-engine.ts`: Web Audio graph. Sources: `MediaElementAudioSourceNode` for mono/stereo files, `AudioBufferSourceNode` for decoded multichannel B-format. Encoder: ACN/SN3D real spherical harmonics up to order 3 as 16 `GainNode`s into a `ChannelMerger`. Distance: inverse rolloff plus `BiquadFilter` low-pass. Reverb: `ConvolverNode` with generated noise impulse responses per room preset. Decoder: sampling decoder matrix to N virtual/real speakers; headphones mode routes each virtual speaker through a `PannerNode` (HRTF) so no external HRIR files are needed. Speaker mode sets `destination.channelCount = min(N, maxChannelCount)` and folds extra speakers down. Per-source and master `AnalyserNode`s produce `AudioLevels` (reuse band code from `src/lib/audio.ts`). `AudioContext.setSinkId` when available.
- `src/components/SurfaceLayer.tsx` (edit): fit/flip/rotate transforms, `drawPattern` when a test pattern is active, audio levels looked up by `surface.audioSource` from an `AudioLevelProvider` interface (mic analyser or engine).
- `src/components/SoundPanel.tsx`, `src/components/RoomView.tsx`, `src/components/ProjectsMenu.tsx`, `src/components/MappingToolbar.tsx`.
- `src/lib/sync.ts`: `BroadcastChannel("prism")`; control page posts throttled snapshots; output page sends `hello` on load and receives a full snapshot including `File` objects for media (structured clone), creating its own object URLs and media elements.
- `src/routes/output.tsx`: `/output` route with its own `head()`; renders `SurfaceLayer` list only, cursor hidden, click toggles fullscreen.
- `src/lib/store.ts`: `idb` database `prism` with `projects` and `blobs` stores; blobs keyed by media/sound id. Autosave debounced 3 s; `lastProjectId` in localStorage. Export via `jszip` (`project.json` + `blobs/`), import reverses it.
- `src/routes/index.tsx` (edit): state for sounds, room, testPattern, snap, view mode; loads last project on mount; passes everything to the new panels.
