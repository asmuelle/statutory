import { runDolOvertimeScenario } from '../scenario.js';

/**
 * The daily runner. It drives the full crawl -> hash-diff -> triage ->
 * synthesize -> gate -> review-queue pipeline and emits a structured run
 * ledger: which sources were attempted/fetched/skipped, how many sections
 * were checked, how many changes were detected, what the gate decided, and
 * which model mode was used. Timestamps are injected so the runner is
 * deterministic and testable; `just ci` runs it in fixture mode (no network).
 * `--live` (see cli.ts) swaps in the live eCFR + Federal Register clients.
 */

export interface LedgerSource {
  readonly name: string;
  readonly status: 'fetched' | 'skipped';
  readonly detail: string;
}

export interface DailyRunLedger {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly mode: 'fixture' | 'live';
  readonly modelMode: string;
  readonly sources: readonly LedgerSource[];
  readonly sectionsChecked: number;
  readonly changesDetected: number;
  readonly deltasSynthesized: number;
  readonly gate: { readonly ok: boolean; readonly failures: number };
  readonly published: number;
  readonly deliveries: number;
  readonly coverageStatement: string;
}

export interface RunDailyOptions {
  /** Injected clock for determinism (ISO strings). */
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly fixturesDir?: string;
}

/**
 * Fixture-mode daily run: deterministic, no network. Replays the archived
 * 2024 DOL overtime amendment through the real pipeline and tallies the
 * ledger from the result.
 */
export const runDaily = async (options: RunDailyOptions): Promise<DailyRunLedger> => {
  const scenario = await runDolOvertimeScenario(
    options.fixturesDir === undefined ? undefined : { fixturesDir: options.fixturesDir },
  );

  const sectionsChecked = scenario.amendmentReport.seeded + scenario.amendmentReport.unchanged;
  const deltasSynthesized = scenario.triageOutcomes.filter((o) => o.routed).length;

  return {
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    mode: 'fixture',
    modelMode: scenario.modelUsage.mode,
    sources: [
      {
        name: 'eCFR Title 29 (fixture snapshot)',
        status: 'fetched',
        detail: `baseline + amendment snapshots; ${scenario.amendmentReport.changeEvents.length} change event(s)`,
      },
      {
        name: 'Federal Register (fixture)',
        status: 'fetched',
        detail: `${scenario.frDoc.citation} — ${scenario.frDoc.document_number}`,
      },
    ],
    sectionsChecked,
    changesDetected: scenario.amendmentReport.changeEvents.length,
    deltasSynthesized,
    gate: { ok: scenario.gate.ok, failures: scenario.gate.failures.length },
    published: scenario.publishedDelta.publishedAt === null ? 0 : 1,
    deliveries: scenario.deliveries.length,
    coverageStatement: scenario.coverageStatement,
  };
};

/** Render the ledger as a compact human-readable report (used by the CLI). */
export const formatLedger = (ledger: DailyRunLedger): string => {
  const lines = [
    `Statutory daily run [${ledger.mode}] ${ledger.startedAt} -> ${ledger.finishedAt}`,
    `  model mode:        ${ledger.modelMode}`,
    `  sections checked:  ${ledger.sectionsChecked}`,
    `  changes detected:  ${ledger.changesDetected}`,
    `  deltas synthesized:${ledger.deltasSynthesized}`,
    `  gate:              ${ledger.gate.ok ? 'PASS' : `FAIL (${ledger.gate.failures})`}`,
    `  published:         ${ledger.published}`,
    `  deliveries:        ${ledger.deliveries}`,
    '  sources:',
    ...ledger.sources.map((s) => `    - [${s.status}] ${s.name}: ${s.detail}`),
    `  coverage:          ${ledger.coverageStatement}`,
  ];
  return lines.join('\n');
};
