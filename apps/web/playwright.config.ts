import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e for the M2 review queue + rulebook surfaces. Chromium only
 * (TOOLS.md); a dedicated port avoids collisions with `just dev`. Specs
 * share one in-memory queue, so they run serially and reset state through
 * POST /api/test/reset (dev-only route) before each test.
 */

const PORT = 3902;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
