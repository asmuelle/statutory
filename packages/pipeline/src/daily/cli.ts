import { countStructureNodes, createEcfrClient } from '../sources/ecfrClient.js';
import { createFederalRegisterClient } from '../sources/federalRegisterClient.js';
import { formatLedger, runDaily } from './runDaily.js';
import type { DailyRunLedger, LedgerSource } from './runDaily.js';

/**
 * `just daily` entrypoint. Default = deterministic fixture run. `--live`
 * performs a polite, bounded probe of the keyless public sources (eCFR +
 * Federal Register) and reports what came back. `--json` prints the raw
 * ledger. This is the only place real wall-clock time is read; the runDaily
 * core takes injected timestamps.
 */

const nowIso = (): string => new Date().toISOString();

const runLiveProbe = async (startedAt: string): Promise<DailyRunLedger> => {
  const ecfr = createEcfrClient();
  const fr = createFederalRegisterClient();
  const sources: LedgerSource[] = [];
  let sectionsChecked = 0;

  try {
    const structure = await ecfr.fetchTitleStructure('2024-08-01', 29);
    sectionsChecked = countStructureNodes(structure, 'section');
    sources.push({
      name: 'eCFR Versioner (live)',
      status: 'fetched',
      detail: `title 29 structure @2024-08-01, ${sectionsChecked} sections`,
    });
  } catch (cause) {
    sources.push({
      name: 'eCFR Versioner (live)',
      status: 'skipped',
      detail: String(cause).slice(0, 120),
    });
  }

  let changesDetected = 0;
  try {
    const result = await fr.searchDocuments({
      agencySlug: 'wage-and-hour-division',
      publicationDateGte: '2024-04-20',
      publicationDateLte: '2024-04-30',
    });
    changesDetected = result.docs.length;
    sources.push({
      name: 'Federal Register (live)',
      status: 'fetched',
      detail: `${result.docs.length} rule(s) mapped, ${result.skipped.length} skipped, ${result.count} total`,
    });
  } catch (cause) {
    sources.push({
      name: 'Federal Register (live)',
      status: 'skipped',
      detail: String(cause).slice(0, 120),
    });
  }

  return {
    startedAt,
    finishedAt: nowIso(),
    mode: 'live',
    modelMode: process.env['ANTHROPIC_API_KEY'] ? 'anthropic' : 'mock',
    sources,
    sectionsChecked,
    changesDetected,
    deltasSynthesized: 0,
    gate: { ok: true, failures: 0 },
    published: 0,
    deliveries: 0,
    coverageStatement:
      'Live source probe only — synthesis/publish run in the fixture pipeline (just daily).',
  };
};

const main = async (): Promise<void> => {
  const args = new Set(process.argv.slice(2));
  const live = args.has('--live');
  const asJson = args.has('--json');
  const startedAt = nowIso();

  const ledger = live
    ? await runLiveProbe(startedAt)
    : await runDaily({ startedAt, finishedAt: nowIso() });

  process.stdout.write(
    asJson ? `${JSON.stringify(ledger, null, 2)}\n` : `${formatLedger(ledger)}\n`,
  );
  if (!ledger.gate.ok) {
    process.exitCode = 1;
  }
};

main().catch((error: unknown) => {
  process.stderr.write(
    `daily run failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
