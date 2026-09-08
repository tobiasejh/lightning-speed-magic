# Prism v2: audio, spatial sound, smarter mapping, separate output and saved projects

Eight additions to the existing studio. Everything stays on-device (no login).

## 1. Audio playback and sound library
- New "Sound" tab next to "Visuals" / "My media": add music tracks and mono sound files (MP3, WAV, OGG, FLAC, multichannel WAV).
- Each sound gets a row: play/pause, loop, volume, mute, solo, and a coloured icon.
- A master transport (Play all / Stop all / master volume) so the whole project runs from one button.
- Sound-reactive visuals can now follow any track (or the mic) instead of the microphone only; each surface picks which sound drives it.

## 2. Spatial audio in a virtual room (3rd-order ambisonics)
- The stage doubles as a top-down room view when "Sound" mode is on. Every sound appears as a draggable icon; drag it to place it in the room. A second small control sets height (up/down) so placement is full 3D.
- Distance falloff: sounds get quieter and softer the further they are from the listener (listener icon is also draggable).
- Room settings: room size, wall reflections (dry/small/large/hall) and ambisonic order 1, 2 or 3.
- Output modes:
  - Headphones (binaural decode)
  - Speakers: pick a layout (stereo, quad, 5.1, 7.1, cube, or custom). Custom lets you add N speakers and drag each one to its real position in the room. The decoder maps the ambisonic field onto those speakers.
- Ambisonic files: multichannel files with 4, 9 or 16 channels are detected as B-format (ACN/SN3D) and played straight through the field, rotatable with a heading control.
- Limitation shown in the UI: the number of physical output channels is whatever the browser reports for the selected audio device (typically 2, up to 8 on multichannel interfaces). Extra speaker channels above that are folded down.

## 3. Assets onto objects (already there, made clearer)
- Any photo/video/visual already maps onto a surface. Adds a "Fit to shape" toggle per surface: Cover (fill) vs Stretch, plus flip H/V and rotate 90 degrees so assets sit right on physical objects.

## 4. Corner snapping while mapping
- Dragging a corner near another surface's corner (within ~12 px) snaps to it and shows a short highlight. Also snaps to stage edges and midpoints.
- Hold Shift to disable snapping temporarily. A snap toggle lives next to "Mapping on/off".

## 5. Calibration test pattern
- "Test pattern" button in the stage toolbar. Options: grid, crosshair, colour bars, edge frame, and a numbered version per surface.
- Renders through every surface's warp, so the pattern shows exactly where projection lands. Turns off automatically when you press Play.

## 6. Separate output screen
- "Open output window" button. Opens `/output`, a page that only shows the projected stage (black background, no controls), meant to be dragged onto the projector and set fullscreen.
- The control page keeps all settings; both windows stay in sync live (surfaces, corners, visuals, media, globals, test pattern). Media files are shared to the output window so it can play the same photos/videos.
- Audio plays from the control window (where the sound device is picked); the output window is silent.
- If the output window is closed, the button shows "Reopen".

## 7. Save and reopen projects
- "Projects" menu in the sidebar: Save, Save as, Open, Duplicate, Delete, Export/Import file.
- Saved to the browser on this device, including the actual photo, video and sound files, so a project reopens intact without re-adding files.
- Autosave of the current working project every few seconds; the last project reopens on launch.
- Export produces a single `.prism` file (zip) you can move to another computer and import.

## Out of scope
- Cloud sync / accounts (chosen: device only).
- Capturing tab or system audio.

## Technical details

Files (new unless noted):
- `src/lib/audio-engine.ts`: Web Audio graph. Per-source `MediaElementSource` or `AudioBufferSource` -> gain -> ambisonic encoder (spherical-harmonic gain matrix, ACN/SN3D, order 1-3, 4/9/16 channels via ChannelMerger). Distance model: inverse with configurable rolloff plus low-pass for far sources. Room reflections via ConvolverNode with generated impulse responses per room size. Decoder: binaural via Omnitone (`omnitone` npm, HOA renderer) or speaker mode via a sampling/pseudo-inverse decode matrix to N virtual speakers, then folded to `destination.maxChannelCount`. Multichannel input files decoded with `decodeAudioData`, channel count 4/9/16 routed directly into the field with a rotation matrix. Per-source `AnalyserNode` feeds `AudioLevels` (reuse band logic from `src/lib/audio.ts`). Output device selection via `AudioContext.setSinkId` where supported.
- `src/lib/types.ts` (edit): add `SoundItem` (id, name, kind mono|stereo|ambisonic, position {x,y,z}, gain, loop, mute, solo, color), `RoomConfig` (size, reverb, order, outputMode, speakers[]), `Project` shape, `testPattern`, `audioSource` per surface, fit/flip/rotate per surface.
- `src/lib/snap.ts`: nearest-point snapping against other surfaces' corners, stage edges and midpoints; threshold in px, disabled with Shift.
- `src/lib/patterns.ts`: canvas test pattern renderers; `SurfaceLayer` draws the pattern instead of the source when active.
- `src/components/SurfaceLayer.tsx` (edit): fit mode, flip, rotate, per-surface audio source lookup, test pattern.
- `src/components/RoomView.tsx`: top-down overlay with draggable sound icons, listener icon, speaker icons, height control.
- `src/components/SoundPanel.tsx`, `src/components/ProjectsMenu.tsx`.
- `src/lib/sync.ts`: `BroadcastChannel("prism")` publishing a serialisable project snapshot from the control page; output page subscribes. Media blobs sent as `File` objects through the channel (structured clone) and turned into object URLs on the output side; control window also polls `hello` messages to resend state to a newly opened output.
- `src/routes/output.tsx`: `/output` route rendering only the stage using `SurfaceLayer`, with its own `head()` metadata; hidden cursor, fullscreen on click.
- `src/lib/store.ts`: IndexedDB via `idb` (stores: `projects`, `blobs`). Autosave debounced 3 s. Export/import via `jszip` producing `.prism`.
- `src/routes/index.tsx` (edit): wire tabs, mapping toolbar (snap, test pattern, output window), Projects menu, stage/room mode toggle, per-surface source and audio source pickers.
- Dependencies to add: `omnitone`, `idb`, `jszip`.
