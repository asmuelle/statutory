import { runDolOvertimeScenario } from '@statutory/pipeline';
import type { ScenarioResult } from '@statutory/pipeline';

/**
 * Shared published workspace for the M3 user surfaces: the fixture-replayed
 * scenario (published, span-verified delta + versioned rulebook sections),
 * cached across requests and dev reloads. Deterministic and read-only —
 * per-profile scoping happens at render time, never by mutating this state.
 */

const WORKSPACE_KEY = Symbol.for('statutory.workspace.m3');

interface WorkspaceHolder {
  promise: Promise<ScenarioResult> | null;
}

const holder = (): WorkspaceHolder => {
  const globalRecord = globalThis as unknown as Record<symbol, WorkspaceHolder | undefined>;
  const existing = globalRecord[WORKSPACE_KEY];
  if (existing !== undefined) {
    return existing;
  }
  const fresh: WorkspaceHolder = { promise: null };
  globalRecord[WORKSPACE_KEY] = fresh;
  return fresh;
};

/** The published workspace, seeded on first access. */
export const getWorkspace = (): Promise<ScenarioResult> => {
  const h = holder();
  if (h.promise === null) {
    h.promise = runDolOvertimeScenario();
  }
  return h.promise;
};
