# Fix reverb memory leak when changing settings

## What is actually happening
`destroy()` is called — when the sound engine shuts down (`SpatialEngine.destroy()` calls `this.reverb.destroy()`). The leak comes from the **rebuild** that runs every time room size, decay, damping or reflection spread changes:

- `build()` calls `disconnect()` on the old taps, convolvers and gains. That only cuts their *outputs*.
- The shared inputs `earlyIn` and `tailIn` are still connected *to* the old taps and convolvers, so they are never cut loose.
- Each rebuild leaves 12 delay taps, ~200 gains and 16 convolvers (each holding up to 12 s of audio) still attached and processing. Memory and CPU grow with every adjustment until the app crashes.

## Fix (src/lib/reverb.ts)
1. At the start of `build()`, call `earlyIn.disconnect()` and `tailIn.disconnect()` before disconnecting the old nodes, so no connection keeps them alive.
2. Clear old convolver buffers (`conv.buffer = null`) before dropping them, so the large impulse buffers are released right away.
3. Build the new network off to the side first, then switch the gains over, so there is no click or gap while you drag.
4. Add a `destroyed` flag: `destroy()` sets it, and a pending rebuild timer or `apply()` call after destroy does nothing (stops a rebuild recreating nodes on a dead engine).
5. Keep the existing 250 ms wait so rebuilds only happen after the slider stops.

## Check
- In the browser, move Room size and Decay back and forth ~50 times and confirm memory stays flat and the sound keeps working.
- Confirm the reverb still comes out through the chosen speaker setup and the build passes.
