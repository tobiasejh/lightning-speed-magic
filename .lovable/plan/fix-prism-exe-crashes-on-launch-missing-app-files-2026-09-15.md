# Fix: Prism.exe crashes on launch (missing app files)

The Windows app starts, but its own screen files were left out of the package, so it stops with an "index.html not found" error. The fix is to package from a clean staging folder and verify the contents before handing you a new zip.

## What I'll do

1. Rebuild the desktop screens fresh, and confirm the built folder actually contains `index.html` plus its scripts and styles.
2. Package from a small dedicated folder that contains only what the app needs (the built screens, the startup file, a minimal package description). This removes any chance of the build output being skipped by ignore rules.
3. Inspect the packaged bundle after packaging and confirm the screens are inside it. No zip is delivered unless that check passes.
4. Make the app fail readably instead of crashing: if the screens are ever missing, show a plain message window naming the missing folder rather than a stack trace.
5. Deliver a new zip (`Prism-windows-x64-v2.zip`) with the same "unzip and run Prism.exe" behaviour, plus a short readme.

## Technical notes

- Cause to confirm first: `electron-packager .` bundles the whole project root into `app.asar`, and `dist-electron` is not surviving that step (either an ignore rule or a stale/absent build at package time). Verification: run `npx asar list` (or unpack) on the produced `app.asar` and grep for `dist-electron/index.html`.
- New `scripts/package-desktop.mjs`: build with `vite build --config vite.electron.config.ts`, assert `dist-electron/index.html` exists, stage `/tmp/prism-app/` with `dist-electron/`, `electron/main.cjs`, and a generated minimal `package.json` (`main: "electron/main.cjs"`, name/version only, no deps), then run `@electron/packager` on that staging dir with `--platform=win32 --arch=x64 --asar`.
- `package.json`: replace `package:win` with `node scripts/package-desktop.mjs`; keep `build:desktop` and `main` as they are.
- `electron/main.cjs`: keep the local HTTP server approach (needed for saved shows and projector windows); add an existence check for `dist-electron/index.html` at startup that loads a data-URL error page instead of throwing, and keep the 404 fallback for client-side routes.
- No app-code, backend or timeline changes.
