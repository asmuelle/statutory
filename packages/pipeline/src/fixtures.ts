import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Fixture resolution. M1 runs the entire pipeline against checked-in archives
 * of primary sources (no network egress anywhere in the slice). Sources are
 * public government documents only (invariant 10).
 */

const MAX_WALK_UP = 8;

/** Walk up from a directory to the pnpm workspace root. */
export const findWorkspaceRoot = (startDir: string): string => {
  let dir = startDir;
  for (let i = 0; i < MAX_WALK_UP; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(
    `Could not locate pnpm-workspace.yaml walking up from ${startDir}. ` +
      'Set STATUTORY_FIXTURES_DIR to the fixtures directory explicitly.',
  );
};

/** Resolve the fixtures directory (env override > workspace lookup). */
export const defaultFixturesDir = (): string => {
  const override = process.env['STATUTORY_FIXTURES_DIR'];
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return join(findWorkspaceRoot(process.cwd()), 'packages', 'pipeline', 'fixtures');
};

/** Read a fixture file with an explicit, actionable error on failure. */
export const readFixture = (fixturesDir: string, relativePath: string): string => {
  const fullPath = join(fixturesDir, relativePath);
  try {
    return readFileSync(fullPath, 'utf8');
  } catch (cause) {
    throw new Error(`Failed to read fixture ${fullPath}: ${String(cause)}`);
  }
};
