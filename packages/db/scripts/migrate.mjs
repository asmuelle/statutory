#!/usr/bin/env node
/**
 * `just migrate` entrypoint. Generates SQL migrations from the schema
 * (offline), then applies them only when DATABASE_URL is reachable. Keeps
 * the recipe runnable on machines without Postgres (M1 needs no live DB).
 */
import { execSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

run('pnpm exec drizzle-kit generate --name baseline');

if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
  console.warn(
    '[migrate] DATABASE_URL not set — generated SQL in packages/db/drizzle, skipped applying. ' +
      'Run `just db-up` and re-run with DATABASE_URL to apply.',
  );
  process.exit(0);
}

try {
  run('pnpm exec drizzle-kit migrate');
} catch (error) {
  console.error('[migrate] Failed to apply migrations:', String(error));
  process.exit(1);
}
