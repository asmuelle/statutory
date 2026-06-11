import { defineConfig } from 'vitest/config';

/**
 * DB-backed integration suite (`just test-db`). Separate from the default
 * unit config so `just ci` never needs Postgres: *.dbtest.ts files are only
 * collected here, and the suite itself skips when DATABASE_URL is unset.
 */
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.dbtest.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
