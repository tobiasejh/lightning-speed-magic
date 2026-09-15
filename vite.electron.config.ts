// Separate build used only for the portable Windows/desktop app: a plain
// client-side bundle (no server rendering), served by the Electron main process.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  root: "electron",
  publicDir: "../public",
  plugins: [react(), tailwindcss(), tsConfigPaths({ root: "./" })],
  build: { outDir: "../dist-electron", emptyOutDir: true },
});
