#!/usr/bin/env node
/**
 * `just migrate` entrypoint. Applies the checked-in migrations in
 * packages/db/drizzle when DATABASE_URL is set; otherwise it explains and
 * exits 0 so the recipe stays runnable on machines without Postgres.
 *
 * Migrations are GENERATED at development time (never at migrate time) via
 * `pnpm --filter @statutory/db generate` after a schema change.
 */
import { execSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';

if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
  console.warn(
    '[migrate] DATABASE_URL not set — skipped applying packages/db/drizzle. ' +
      'Run `just db-up` and re-run with DATABASE_URL to apply.',
  );
  process.exit(0);
}

try {
  execSync('pnpm exec drizzle-kit migrate', { stdio: 'inherit' });
} catch (error) {
  console.error('[migrate] Failed to apply migrations:', String(error));
  process.exit(1);
}
