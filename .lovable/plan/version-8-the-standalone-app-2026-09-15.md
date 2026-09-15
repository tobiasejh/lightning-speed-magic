# Version 8: The standalone app

Editing polish for the show and room editors, plus a Windows download of Prism.

## 1. Bigger automation editor

- A new "Edit movement" button on a movement clip opens a full-screen panel inside the app.
- The panel shows the X and Y movement lanes at full width and height, with a time ruler, the playhead, and the same drag behaviour as today (drag a point sideways to retime, up/down to move it in the room).
- Behind the lanes, a waveform of the sound linked to that movement is drawn, so points can be placed on beats and hits.
- Closing the panel returns to the timeline; edits go straight into the shared movement path, so the room editor stays in step.

## 2. Waveforms

- Sound files get a small stored overview of their loudness when they are added, computed once and saved with the show.
- That overview is drawn behind the automation lanes (large panel and inline lanes).
- Videos with sound get the same treatment where their audio is available.

## 3. Deleting things

- Audio clips (and every other clip) can be removed: click a clip to select it, then press Delete/Backspace, or use a small delete button in the clip inspector. Right-click a clip gives the same option.
- Movement/automation clips delete the same way; deleting a clip does not delete the source sound or the room path unless asked.
- Room editor: right-click a line deletes that line. Right-click a point deletes the point and the lines touching it.

## 4. Line duration down to zero

- The milliseconds box for a line can be emptied and set all the way to 0 (was forced to at least 20).
- A 0 ms line becomes an instant jump; movement playback and the automation lanes handle zero-length lines without dividing by zero, and dragging a point can push a neighbouring line to 0 instead of stopping at 20 ms.

## 5. Undo (Ctrl+Z)

- Ctrl+Z steps back through show edits; Ctrl+Shift+Z (and Ctrl+Y) steps forward again.
- Covered: adding/deleting/moving/resizing clips, tracks, surfaces, room points and lines, movement edits, media and sound removal, and projector changes.
- Not covered: playback position, and loading or deleting a whole project.
- Typing in a text box keeps the browser's own undo.

## 6. Clip length matches the imported file

- Each media item stores its real length when it is added.
- Dropping a visual on the timeline gives a clip as long as that file (minus any trim), instead of a flat 10 seconds.
- A clip can no longer be stretched past the length of its file: dragging the right edge stops at the end of the material, and dragging the left edge stops at its start. Sound clips get the same limit.
- Older shows with 10-second placeholder clips are left as they are, but a "Fit to clip" button in the inspector snaps one to its true length.

## 7. Windows desktop app

- Prism gets packaged as a portable Windows app: unzip the folder and run `Prism.exe`, no installer and no admin rights needed.
- The app runs the whole studio offline; shows, media and sounds stay on the machine as they do today.
- Projector windows open as extra app windows that can be dragged to each projector and set full-screen.
- Delivered as a `.zip` in your files, together with a short readme on unzipping and running it.

## Technical notes

- `MediaItem` and `SoundItem` gain `duration` and a `peaks: number[]` overview (decoded with an OfflineAudioContext / video element metadata at import); `Project` version bumps to 8 with defaults for older saves.
- New `src/components/AutomationEditor.tsx` full-screen dialog reusing the lane maths from `ShowPanel.tsx`; lane rendering (`axisOutline`, `dragHandle`) moves into a shared `src/components/AutomationLane.tsx` so both sizes share one implementation, with a `peaks` prop for the waveform layer.
- `src/lib/timeline.ts`: relax the `Math.max(1, durationMs)` and `Math.max(20, ...)` floors to 0 with guarded division in `pathChain`, `positionOnPath`, `pathDuration`, `splitSegment`, and the lane drag; `removeSegment`/`removeNode` wired to context-menu handlers in `RoomView.tsx`.
- New `src/lib/history.ts`: a bounded (50 entry) undo stack of show snapshots (surfaces, clips, tracks, paths, outputs, media/sound lists) held in `src/routes/index.tsx`, pushed on committed edits, with a keydown listener that ignores inputs/textareas.
- `addClip` in `ShowPanel.tsx` uses `media.duration - trimStart`; `resizeClip` clamps `duration` and `inPoint` to the source length.
- Electron packaging: `vite.config.ts` gets `base: './'`, a new `electron/main.cjs` (contextIsolation on, nodeIntegration off) loads the built `dist/index.html` and opens projector windows, `package.json` gains `main` plus electron dev deps, and `@electron/packager` cross-builds `--platform=win32 --arch=x64` into a zip. No backend changes.
