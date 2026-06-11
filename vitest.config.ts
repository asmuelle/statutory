import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/web/src/lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/web/src/lib/**/*.ts'],
      // repository.ts is the DB publish path: covered by the integration
      // suite in vitest.db.config.ts (just test-db), which needs Postgres.
      exclude: ['**/*.test.ts', '**/*.dbtest.ts', '**/index.ts', 'packages/db/src/repository.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
