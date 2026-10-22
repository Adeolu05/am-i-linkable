import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: root },
      // "server-only" throws outside a React Server Components build; tests run plain Node.
      { find: /^server-only$/, replacement: `${root}test/empty.ts` },
    ],
  },
  test: { include: ["**/*.test.ts"], exclude: ["node_modules/**", ".next/**"] },
});
