import { defineConfig } from "vitest/config";

export default defineConfig({
  // PGlite-backed tests start a whole Postgres in-process; give them room when
  // every workspace runs its tests at the same time.
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
