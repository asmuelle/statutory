import { describe, expect, test } from 'vitest';

import { formatLedger, runDaily } from './runDaily.js';

/**
 * Fixture-mode daily run is deterministic and emits a complete ledger. No
 * network, no database — this is the version `just ci` exercises.
 */

const OPTS = { startedAt: '2024-07-01T06:00:00Z', finishedAt: '2024-07-01T06:00:42Z' };

describe('runDaily (fixture mode)', () => {
  test('drives the full pipeline and reports a structured ledger', async () => {
    const ledger = await runDaily(OPTS);

    expect(ledger.mode).toBe('fixture');
    expect(ledger.startedAt).toBe(OPTS.startedAt);
    expect(ledger.sources).toHaveLength(2);
    expect(ledger.sources.every((s) => s.status === 'fetched')).toBe(true);
    expect(ledger.sectionsChecked).toBeGreaterThan(0);
    expect(ledger.changesDetected).toBeGreaterThanOrEqual(1);
    expect(ledger.deltasSynthesized).toBeGreaterThanOrEqual(1);
    expect(ledger.gate.ok).toBe(true);
    expect(ledger.gate.failures).toBe(0);
    expect(ledger.published).toBe(1);
    expect(ledger.deliveries).toBeGreaterThanOrEqual(1);
    expect(ledger.coverageStatement.length).toBeGreaterThan(0);
  });

  test('is deterministic across runs', async () => {
    const a = await runDaily(OPTS);
    const b = await runDaily(OPTS);
    expect(b).toEqual(a);
  });

  test('formatLedger renders a readable report with the gate verdict', async () => {
    const ledger = await runDaily(OPTS);
    const text = formatLedger(ledger);

    expect(text).toMatch(/Statutory daily run \[fixture\]/);
    expect(text).toMatch(/gate:\s+PASS/);
    expect(text).toMatch(/eCFR Title 29/);
  });
});
