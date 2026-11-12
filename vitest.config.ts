import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Kept apart from vite.config.ts: the app config pulls in TanStack Start and the Lovable
// plugins, which the plain logic in src/lib does not need.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/lib/**/*.test.ts"],
    environment: "node",
  },
});
