import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The repository's CSV validator imports zod, which is not installed
      // for the main app in a bare checkout. Tests resolve it from this package.
      zod: fileURLToPath(new URL("./node_modules/zod", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // bin.ts is a three line process wrapper around the tested run() function.
      exclude: ["src/**/bin.ts"],
      reporter: ["text", "text-summary"],
      thresholds: {
        "src/redact/**": { lines: 95 },
        "src/synthetic/**": { lines: 95 },
        "src/retention/**": { lines: 95 },
      },
    },
  },
});
