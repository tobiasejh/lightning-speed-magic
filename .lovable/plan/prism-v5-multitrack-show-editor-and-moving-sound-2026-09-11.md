# Prism v5 — Multitrack show editor and moving sound

## Goal

Turn the current scene-cue show controls into a video-editor-style timeline where visuals, audio, and spatial sound movement can be arranged together. Keep every mapped surface inside its projector display.

## What will change

### 1. Keep mapped surfaces inside the display

- Constrain every corner to the visible 0–100% stage area while dragging on desktop and a paired device.
- Apply the constraint after snapping, so edge and corner snapping still feels precise.
- Sanitize older saved projects, recalled data, and paired-device updates so previously out-of-range corners cannot return.
- Keep corners draggable along the exact display edge rather than letting handles disappear outside it.

### 2. Draw and record moving sound paths

- Add a path-editing mode to the Room editor for the selected sound.
- Support two creation methods:
  - **Draw path:** trace a route directly in the room.
  - **Record movement:** drag the sound icon in real time while Prism captures its position and timing.
- Display the route, direction, start/end points, and the sound’s live position in the Room editor.
- Allow recorded points to be adjusted, simplified, cleared, and re-recorded.
- Store height with the path, while the top-down editor controls horizontal movement.
- Save paths inside projects and exported Prism files.

### 3. Replace scene cues with a multitrack timeline

- Replace the existing scene-cue strip with scrollable visual, audio, and sound-movement tracks.
- Add draggable clip blocks with trim handles, start time, duration, and a shared playhead.
- Support multiple visual and audio tracks, overlapping visual clips, and audio clips arranged sequentially or concurrently.
- Add timeline zoom, horizontal scrolling, time ruler, clip-edge snapping, selection, delete, duplicate, and track mute/solo controls.
- Let visual clips target a mapped surface; that surface’s existing projector assignment decides where the clip appears.
- Let audio clips reference uploaded sounds or MP4 audio and retain their volume, mute, solo, loop, and spatial settings.
- Let movement clips reference a recorded/drawn sound path and choose which sound follows it.

### 4. Unified playback and editing

- Add play, pause, stop, seek, and playhead scrubbing without restarting from zero.
- At any timeline time, show the correct video frame, start each audio clip at its correct local offset, and interpolate each active movement path.
- Keep MP4 picture and embedded audio locked together; retain support for separately uploaded audio with an offset.
- Stop clips cleanly when the playhead leaves their range and restore the expected state when scrubbing backward.
- Keep projector windows synchronized with timeline playback and surface assignments.

### 5. Migration and project safety

- Add versioned timeline data to the on-device project format.
- Preserve existing media, sounds, surfaces, outputs, crops, trims, and spatial settings.
- Remove the old scene-cue editor from the working interface. Existing scenes may remain in older project data for compatibility, but they will not drive v5 playback.
- Autosave timeline tracks, clips, sound paths, and playhead-independent project edits.

## Interface outline

```text
┌──────────────────── Stage / Room editor ────────────────────┐
│ Map visuals, select surfaces, draw or record sound paths    │
└──────────────────────────────────────────────────────────────┘
┌──────────────────── Multitrack timeline ────────────────────┐
│ Visual 1   [ Forest clip ][       Logo clip       ]         │
│ Visual 2          [ Texture clip ]                          │
│ Audio 1    [ Intro.wav ][ Speech.wav ][ Outro.wav ]         │
│ MP4 audio  [======= linked to Forest clip =======]          │
│ Movement   [ Sound A: left-to-right path ]                  │
│                         │ playhead                           │
└──────────────────────────────────────────────────────────────┘
```

## Technical details

- Introduce project-level track, clip, sound-path, and timed path-point types rather than extending the current scene cue shape.
- Build one timeline clock and scheduler that resolves active clips at time `t`, seeks media/audio sources, and interpolates sound positions.
- Use request-animation-frame updates for the visible playhead and moving sound position, while avoiding unnecessary project saves on every frame.
- Reuse the existing audio engine, media elements, projector output channel, spatial room model, and project storage.
- Share the same point-clamping helper between desktop mapping, paired-device mapping, incoming remote updates, and project loading.

## Validation

- Verify surface corners cannot cross any stage edge on desktop or paired touch controls, with snapping on and off.
- Verify sequential and overlapping audio clips, trimmed videos, MP4 audio mute, separate synced audio, seeking, pause/resume, and stop.
- Verify drawn and recorded paths play at the right timeline time and move the audible source smoothly.
- Verify multiple visual tracks target the expected mapped surfaces and projector windows.
- Save, reload, export, and import a v5 project and confirm its timeline and paths are preserved.
- Check desktop and tablet layouts, runtime errors, and the final build.

## Not included

- Desktop packaging; Prism remains browser-based for this version.
- Automatic projector detection or automatic mapping.
- Cloud storage of projects or uploaded media; pairing remains control-data only.