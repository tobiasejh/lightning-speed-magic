# Version 6 — Node-based sound automation

Movement in the room editor becomes a proper automation path: you place points, connect them with straight lines, bend those lines into curves, and give each line its own duration. The timeline then shows and edits the same movement as X/Y automation lanes, like automation in Ableton.

## Room editor

- Click on empty room space places a point for the selected sound. Points are numbered in creation order.
- Points are draggable at any time; every line touching a point redraws instantly (curve bend is preserved).
- Ctrl + click two points connects them with a perfectly straight line.
- Shift + drag on a line bends it into a curve; how far you drag sets how strongly it curves, either side of the line.
- Alt + click on a line inserts a point on the line, splitting it into two lines that keep the original curve shape until either is shift-dragged again. The original line's duration splits proportionally at the click position.
- Each line shows an editable duration field in milliseconds (default 1000 ms). Selecting a line highlights it and shows its duration plus a delete action.
- Right-click (or a delete button on selection) removes a point and its lines, or removes a single line.
- The old Draw and Record modes are removed, as agreed. Movement paths saved by earlier versions still play; they are converted to points and straight lines on load so they can be edited with the new tools.
- Sound icon still drags freely; placing points does not move the sound until playback runs the path.

## Timeline

- A movement clip can be expanded to reveal two automation lanes, X and Y, drawn across the clip width from the path's points.
- Each point appears as a draggable handle: drag vertically to change position, horizontally to change timing (which rewrites the affected line durations). Double-click a lane adds a point; handles snap to the playhead and neighbouring points.
- Curved lines render as curved lane segments, so the lane shape matches the room editor.
- Collapsed movement clips show a small preview of the room path shape, so you can see the movement at a glance next to the video and audio clips.
- Edits in a lane write straight back to the shared movement path, so the room editor stays in sync (and vice versa).
- Clip length stays independent of the path's total duration, as agreed: a path shorter than its clip holds the last position, and a clip can be resized without rescaling line durations.

## Technical notes

- `src/lib/types.ts`: `SoundPath` gains `nodes: PathNode[]` (id + position) and `segments: PathSegment[]` (id, fromId, toId, durationMs, curve). `points` stays optional for legacy projects; project `version` bumps to 6 with a one-way migration in `src/lib/store.ts` / project load that samples legacy `points` into nodes/segments.
- `src/lib/timeline.ts`: `positionOnPath` reworked to walk segments by accumulated `durationMs`, evaluating each segment as a quadratic Bézier whose control point is the segment midpoint offset perpendicular by `curve * length`. Straight lines are `curve === 0`. Add helpers: `pathDuration`, `sampleSegment`, `splitSegment` (de Casteljau split so both halves follow the original curve), and `pathPolyline` for rendering.
- `src/components/RoomView.tsx`: replaces capture-mode state with node/segment interaction — pointerdown hit-testing on nodes, segments, and empty space; modifier handling for ctrl/shift/alt; SVG rendering of quadratic paths, handles, and a selected-line badge with a millisecond input.
- `src/components/ShowPanel.tsx`: adds an expandable movement-clip row with X/Y lane SVGs plus handle drag logic reusing `pixelsPerSecond`, calling a new `onPatchPath(path)` prop; collapsed clips render a mini path thumbnail.
- `src/routes/index.tsx`: owns `soundPaths` state already — pass an update callback to both `RoomView` and `ShowPanel`, keep autosave/persistence and `/output` sync unchanged; scheduler continues to feed `SpatialEngine.setPosition` from `positionOnPath`.
- Positions stay clamped to the room bounds; no backend changes.
