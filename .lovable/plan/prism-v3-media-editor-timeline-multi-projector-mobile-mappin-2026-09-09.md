# Prism v3 — Media editor, timeline, multi-projector, mobile mapping

## My take

The list splits into three tiers. Tier 1 (delete media, mp4 audio, crop/split editor) is straightforward and fixes the biggest day-to-day pain, including the distortion you saw. Tier 2 (timeline + multiple projectors) is the heart of a real show tool and should be built as one feature: a timeline drives *what plays on which output when*. Tier 3 (iPad mapping) needs the first bit of cloud in the project — only as a live relay for touch commands; files and projects still never leave your PC.

Staying in the browser is the right call for now. Everything here is built so the same code can later be wrapped as a desktop app (Tauri/Electron), where multi-projector detection and always-on outputs get easier.

## Order of work

### 1. Media housekeeping (quick wins)
- Delete button on every My Media tile (with confirm). Surfaces using the deleted item fall back to a visual; the file is removed from the saved project and the output window(s).
- Rename media inline.

### 2. Video audio in the Sound tab
- When a video with an audio track is added, a linked track appears automatically in the Sound tab: "Forest.mp4 (video)" with mute, volume, solo and a position in the room like any other sound.
- Video and its audio play as one thing: a play/pause/loop control on the media tile; the sound row stays locked to the video's time.
- Silent mp4s show no sound row.

### 3. Editor page (new "Editor" tab on the stage)
Opens for any video (or image) from My Media:
- **Crop**: drag a rectangle over the frame (or a free polygon mask). The cropped region becomes the mapped content, so the clip's shape matches the object instead of stretching the whole frame — this fixes the distortion you noticed. Also add a per-surface "Fit: crop to shape" option.
- **Split into clips**: set in/out points on a scrubber and "Save as clip"; each clip becomes its own media item (same file, different time range + crop) with a thumbnail.
- **Sync audio to video**: pick a sound from the library, nudge its offset (+/- ms) against the video, preview together. Linked pairs start/stop together everywhere.
- Playback in the editor is shared with the stage, so what you see is what projects.

### 4. Timeline and scenes (show automation)
- **Scenes**: a snapshot of surfaces, sources, opacity, globals and which output each surface goes to. Save/rename/recall.
- **Timeline**: a horizontal track under the stage. Place scenes and media/sound clips at times; press Play to run the show; scenes switch and clips start automatically. Loop the whole timeline or a section. Scrub to preview.
- Transitions between scenes: cut or crossfade (duration slider).

### 5. Multiple projectors
- Add "Outputs" in the toolbar: Output 1, 2, 3… each opens its own window; drag each onto a projector and click for fullscreen. Where the browser allows it (Chrome's multi-screen permission), one click places each output on a chosen display directly.
- Every surface picks an output. Each output window renders only its surfaces; test patterns show the output number.
- Timeline scenes include output assignments, so content can move between projectors over time.

### 6. Mobile mapping via pairing code
- "Pair a device" shows a QR code / 6-character code. Open it on an iPad/phone: a touch-first mapping screen with a big view of the current output, fat corner handles, pinch-zoom, nudge arrows, surface picker and snap toggle.
- Only mapping commands (corner moves, select surface, test pattern) travel through a Lovable Cloud realtime channel. No accounts; the code expires when the PC session closes; media never uploads.
- The PC remains the source of truth and keeps saving locally.

### 7. Verify and document
- Browser checks for each tier (Playwright), roadmap and README updated.

## Notes and trade-offs
- Timeline sync between control window and outputs uses the existing message channel with a shared clock, so all outputs stay frame-aligned.
- Browser limits: outputs must be opened from the control window once per session (a desktop app can automate this later). Chrome supports placing windows on specific screens; other browsers need manual drag.
- Pairing uses Lovable Cloud for the relay only. Projects, files and audio stay on-device, matching the current privacy rule.

## Technical details
- Types: `MediaItem` gains `crop`, `trimStart/trimEnd`, `sourceMediaId` (for split clips), `audioTrackId`, `outputId`; new `Scene`, `TimelineClip`, `Output` types on `Project`.
- Editor: canvas preview with crop/polygon overlay; `SurfaceLayer` applies crop + time range when drawing; polygon crop via `ctx.clip()`.
- Video audio: `createMediaElementSource` on the existing video element wired into `SpatialEngine` as a `SoundItem` of kind `"video"`; the engine never owns its playback, only routing.
- Timeline: a `ShowClock` (audio-context time based) drives scene changes and clip starts; `sync.ts` gains `clock` and `outputs` messages and each output window filters by `outputId`; use `window.getScreenDetails()` where available.
- Pairing: enable Lovable Cloud; a `pair_sessions` table (code, expiry) plus Realtime broadcast channel `pair:<code>`; anon RLS scoped to the code; mobile route `/remote/$code`.
- Persistence: schema version bump in IndexedDB with migration of older projects; `.prism` export includes new fields.
