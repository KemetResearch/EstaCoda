import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    setupFiles: ["src/test/vitest-setup.ts"],
    reporters: ["verbose"],
  },
  resolve: {
    alias: {
      "^(.+)\\.js$": "$1"
    }
  }
});
