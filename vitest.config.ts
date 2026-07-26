import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Generous because the RLS suite's afterAll tears a whole tenant down against a REMOTE
    // Supabase project: ~26 ordered child-table deletes plus an auth admin delete per user, each a
    // separate network round trip. 30s was enough only while cleanup was silently failing and
    // doing almost nothing; a teardown that times out half-way leaks fixtures exactly the way the
    // old swallowed error did.
    hookTimeout: 120000,
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
