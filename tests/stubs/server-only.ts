// server-only's real implementation throws unconditionally outside Next.js's RSC bundler (it
// checks for a global Next sets during the build). Vitest runs in plain Node, so it would throw
// on every import. This stub is aliased in vitest.config.ts test-only, so the guard still runs
// for real during `next build`.
export {};
