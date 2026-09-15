// Separate build used only for the portable Windows/desktop app: a plain
// client-side bundle (no server rendering), served by the Electron main process.
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "electron",
  publicDir: "../public",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { outDir: "../dist-electron", emptyOutDir: true },
});
