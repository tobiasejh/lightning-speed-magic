# Resizable menu and dedicated Timeline workspace

## Interface changes

- Add a draggable vertical splitter between the left menu and the main workspace on desktop.
- Let the menu resize within practical minimum and maximum widths, with a clear resize cursor and accessible separator behavior.
- Save the chosen width on the device so Prism reopens with the same layout.
- Make menu grids, fields, tabs, labels, and controls respond to the available width instead of forcing horizontal overflow.
- Keep the existing stacked layout on smaller screens, where a vertical splitter would not be useful.

## Timeline workspace

- Add **Timeline** beside Stage, Room, and Editor in the main workspace toolbar.
- Move the complete show timeline out of the left menu and into this dedicated workspace, preserving playback, tracks, clips, automation, projector setup, clip inspection, deletion, and undo behavior.
- Let the timeline use the full main workspace dimensions while keeping intentional horizontal scrolling inside the timeline ruler and tracks.
- Keep the full-screen movement editor available from the Timeline workspace.

## Long names and scrolling

- Truncate long visual, audio, and movement names inside the “Add clip” selectors so they never widen or escape their controls.
- Show the complete name in the opened list and as a tooltip where the closed control truncates it.
- Apply one dark, token-based scrollbar style across the app, including menus, editors, lists, and timeline lanes.
- Eliminate the unwanted horizontal scrollbar at the bottom of the left menu without removing intentional horizontal scrolling from the timeline itself.

## Verification

- Check splitter dragging, saved width, and menu reflow at narrow and wide desktop sizes.
- Check Stage, Room, Editor, and Timeline switching and confirm timeline editing still works.
- Test very long source names in visual, audio, and movement selectors.
- Verify scrollbar styling and confirm the menu has no bottom scrollbar.
- Confirm the current app build remains healthy; connected GitHub sync will receive the resulting project changes automatically.

## Technical notes

- Extend the existing workspace view state with a timeline view and render `ShowPanel` in the main stage area rather than the sidebar.
- Track the sidebar width in `index.tsx`, update it from pointer movement, clamp it, and persist it locally.
- Use responsive/min-width-safe flex and grid rules plus explicit truncation in `ShowPanel` and the shared select control.
- Define standards-based scrollbar colors and WebKit scrollbar parts in the global theme stylesheet using existing semantic colors.
