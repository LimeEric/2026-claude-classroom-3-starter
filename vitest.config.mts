import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Native replacement for vite-tsconfig-paths; resolves the `@/*` alias.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.{ts,tsx}"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // Builds the CLI and starts the one next dev these files share; it
          // only runs when a selected file belongs to this project.
          globalSetup: ["tests/integration/server.ts"],
          // One file at a time against that server and its SQLite file.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
