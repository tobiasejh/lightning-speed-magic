# Version 7 — Multi-projector canvas, edge blending, surface resolution, project reload fix

## 1. One show, split across projectors

Today every projector window shows the surfaces assigned to it, on its own full screen. V7 turns the show into a single wide canvas that projectors share.

- Each projector gets a **region** of the show canvas: left, top, width, height (as a share of the whole canvas, so it stays right at any screen size).
- Regions may overlap — the overlap is what gets blended.
- New "Canvas" controls in the Projectors panel: overall canvas shape (e.g. 2 or 3 projectors side by side), plus a one-click "Split evenly" that lays regions out with a chosen overlap.
- A small map in the panel shows the regions over the stage so you can see the cut-off lines.
- The main stage view still shows the whole canvas with dashed region outlines, so you always know where a projector's edge falls.
- Each projector window renders the whole canvas and crops to its region, so a surface can cross the cut-off between two projectors and still line up.
- Projectors stay in sync with the timeline: the control window sends the show clock (play state, time, per-clip video positions) to every projector window, and each one seeks its videos to match instead of looping on its own.

## 2. Edge blending

Per projector, per side (left / right / top / bottom):

- **Fade width** — how far in from that edge the image fades out.
- **Brightness** — the level the fade drops to (so overlapping projectors add up to a flat image).
- **Curve** — softness of the fade, from linear to strongly eased.
- A blend mask is drawn over the projector's image; the same masks appear faintly on the stage preview so you can tune without walking to the wall.
- A "Blend test" mode shows a flat grey field so you can match the overlap by eye.

## 3. Manual surface resolution

- Surface settings get a resolution field pair, e.g. 1080 x 842, with a "match source" button and common presets.
- The surface renders internally at exactly that pixel size, so its sharpness is under your control.
- The mapped shape is locked to that aspect ratio: dragging a corner keeps the quad's ratio, and there is a toggle to unlock it if you want free warping.

## 4. Reopening a project — bug fix

Confirmed cause of what the screenshot shows: when a project is opened, the app restores the tracks and clips but never restores **which clip was selected**, and the same for the active movement path. With nothing selected, the clip inspector and the X/Y automation lanes are hidden, so the show looks empty even though the clips are saved.

Fixes:

- On open, reselect the first clip (and the movement path it uses) so the inspector and automation lanes come straight back, and remember the last selected clip in the project file.
- The "Add to Visual 1 / Choose clip" row is an *add* control, not a display of the current clip — it always reads "Choose clip". It will be relabelled to "+ Add clip to Visual 1" so it no longer looks like an empty selection.
- Video-backed sound tracks and clips whose media is still loading are re-linked after media mounts, so their clips keep their source.
- Saving currently hides failures silently. Save errors will surface as a visible warning, and a save will be forced before opening another project, so nothing gets lost between sessions.
- Verify by saving a show with clips, automation and video, reloading, and checking clips, selection, automation lanes and playback all come back.

## Technical notes

- `OutputScreen` gains `region: {x,y,w,h}` and `blend: {left,right,top,bottom: {width,level,curve}}`; `Project` gains `canvas: {aspect}` and `selectedClipId`. Project version bumps to 7 with defaults filled in for older saves (full-screen region, no blend), so existing projects keep working.
- `/output` renders the full canvas in a transformed wrapper scaled/offset by its region, then paints blend gradients in an overlay canvas above the surfaces.
- `SyncMessage` gains a `clock` message (`playing`, `time`, per-media `currentTime`) broadcast on the existing BroadcastChannel from the show scheduler; the output window applies it with a small tolerance so it does not fight normal playback.
- `Surface` gains `renderW`/`renderH` and `lockAspect`; `SurfaceLayer`'s canvas uses those instead of the fixed 640x360, and corner dragging in the stage and remote views respects the locked ratio while keeping the existing in-bounds clamping.
- `applyProject` restores `selectedClipId`/`activePathId`; `persist` reports errors instead of swallowing them.
- No backend changes; everything stays on the device.
