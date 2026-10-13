import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` needs no database. Migrations are applied by
// src/migrate.ts over the direct (non-pooled) connection, as Neon recommends.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
