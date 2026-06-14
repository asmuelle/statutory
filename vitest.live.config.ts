import { defineConfig } from 'vitest/config';

/**
 * LIVE smoke suite (`just test-live`). Talks to keyless public government
 * APIs (Federal Register, eCFR) with a handful of polite requests. NEVER part
 * of `just ci` — CI must stay green with no network. Files use the
 * `*.livetest.ts` suffix (mirroring `*.dbtest.ts`) so the unit config never
 * collects them; the suite itself skips gracefully when offline.
 */
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.livetest.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
