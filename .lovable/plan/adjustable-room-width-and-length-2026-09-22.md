# Adjustable room width and length

## Changes

1. Replace the single square room size with independent width and length values, defaulting to 8 × 8 metres.
2. Add separate Width and Length controls in the Sound panel.
3. Draw the room at its real rectangular proportion while fitting it inside the available workspace.
4. Use width for horizontal distance and length for vertical distance in sound-distance calculations and labels.
5. Upgrade older saved projects automatically by using their existing room size for both dimensions.
6. Verify room resizing, saved-project compatibility, and build health.

## Technical details

- Extend `RoomConfig` with `width` and `length`, retaining optional legacy `size` loading support.
- Rebuild room reverb when either dimension changes, using the room's characteristic average dimension.
- Update coordinate conversion in `RoomView` so draggable sounds, listener, speakers, and automation remain normalized while the rendered room changes aspect ratio.
