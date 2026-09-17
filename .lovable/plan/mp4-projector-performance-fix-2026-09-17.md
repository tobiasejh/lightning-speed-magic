# MP4 projector performance fix

## Goal

Reduce projector load when the same MP4 is shown on more than one projector by rendering videos as real browser video elements instead of repainting every frame into canvas.

## What will change

- Keep the existing canvas renderer for built-in procedural visuals and non-video canvas drawing.
- When a surface uses an MP4/video source, mount the actual `<video>` element inside the mapped surface instead of drawing it with `canvas.drawImage`.
- Position the video with CSS so it fills the mapped surface: absolute positioning, full inset, and the matching fit mode.
- Preserve the existing surface controls: opacity, visibility, brightness, crop, trim, flip, rotate, projector assignment, shared-canvas cropping, and edge blending.
- Keep timeline sync as the authority: projector windows still follow the editor clock and seek/pause/play videos from the existing clock messages.

## Validation

- Open the studio with a video surface and two projector windows.
- Confirm the built-in visual mode still uses canvas and behaves as before.
- Confirm video mode shows a real video element in the projector output, not a canvas-drawn video frame.
- Confirm timeline play, pause, seek, trim, crop, projector region cropping, and edge blending still work.

## Technical notes

- `SurfaceLayer` will branch by media kind: video sources render a DOM video path; procedural visuals stay on canvas.
- The projector media setup already creates and stores `HTMLVideoElement` instances, so the change can reuse those elements rather than creating independent decoders.
- Crop can be represented with an overflow-hidden wrapper and CSS sizing/offsets; fit and flip/rotate can be represented with CSS transforms.
- If a browser refuses to move the same video node between multiple mounted places, the fallback is to keep one real video element per projector surface while synchronizing all of them from the same timeline clock.
