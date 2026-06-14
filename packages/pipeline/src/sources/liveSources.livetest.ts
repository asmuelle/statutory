import { describe, expect, test } from 'vitest';

import {
  canonicalSectionText,
  extractEffectiveDates,
  hashText,
  normalizeParagraphs,
} from '@statutory/core';

import { crawlSections } from '../pipeline.js';
import { createMemoryStore } from '../store.js';
import { countStructureNodes, createEcfrClient, findStructureNode } from './ecfrClient.js';
import { createFederalRegisterClient } from './federalRegisterClient.js';

/**
 * LIVE smoke tests (just test-live; NEVER part of just ci). Keyless public
 * government APIs only, a handful of requests, polite User-Agent, graceful
 * skip when offline. Historical point-in-time dates keep assertions stable.
 */

const PROBE_TIMEOUT_MS = 5_000;
const BASELINE_DATE = '2024-05-01'; // pre-amendment: $684 standard salary level
const AMENDED_DATE = '2024-08-01'; // post 89 FR 32842: $844 beginning July 1, 2024

interface LiveObservation {
  readonly url: string;
  readonly status: number;
  readonly bytes: number;
}

const observations: LiveObservation[] = [];

/** Delegating fetch that records status + payload size for the run report. */
const recordingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const clone = response.clone();
  const body = await clone.text();
  observations.push({ url: String(input), status: response.status, bytes: body.length });
  return response;
};

const probeOnline = async (): Promise<boolean> => {
  try {
    const response = await fetch('https://www.ecfr.gov/api/versioner/v1/titles.json', {
      method: 'HEAD',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok || response.status === 405;
  } catch {
    return false;
  }
};

const online = await probeOnline();
if (!online) {
  console.warn('[test-live] Offline or eCFR unreachable — live smoke tests skipped.');
}

describe.runIf(online)('live eCFR Versioner API', () => {
  const client = createEcfrClient({ fetchImpl: recordingFetch });

  test('title 29 structure contains part 541 and section 541.600', async () => {
    // Act
    const root = await client.fetchTitleStructure(AMENDED_DATE, 29);

    // Assert
    expect(root.identifier).toBe('29');
    expect(root.type).toBe('title');
    expect(findStructureNode(root, 'part', '541')).toBeDefined();
    expect(findStructureNode(root, 'section', '541.600')?.label).toMatch(/salary/i);
    expect(countStructureNodes(root, 'section')).toBeGreaterThan(100);
  });

  test('a live-fetched 29 CFR 541.600 diffs as unchanged against itself', async () => {
    // Arrange — ONE live fetch; the re-crawl reuses the same parsed payload.
    const sections = await client.fetchSection({
      date: AMENDED_DATE,
      title: 29,
      part: 541,
      section: '541.600',
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]?.citation).toBe('29 CFR § 541.600');
    expect(sections[0]?.paragraphs.length).toBeGreaterThanOrEqual(5);

    const store = createMemoryStore();
    const seeded = crawlSections(store, sections, {
      jurisdiction: 'us-federal',
      retrievedAt: '2026-06-11T06:00:00Z',
    });

    // Act — identical content crawled again.
    const recrawl = crawlSections(store, sections, {
      jurisdiction: 'us-federal',
      retrievedAt: '2026-06-11T07:00:00Z',
    });

    // Assert — stable hash, zero change events, nothing for any model to see.
    expect(seeded.seeded).toBe(1);
    expect(recrawl).toEqual({ seeded: 0, unchanged: 1, changeEvents: [] });
    const text = canonicalSectionText(normalizeParagraphs(sections[0]?.paragraphs ?? []));
    expect(store.getSectionByCitation('29 CFR § 541.600')?.currentHash).toBe(hashText(text));
  });

  test('the real 2024 salary-threshold amendment is detected across point-in-time dates', async () => {
    // Arrange — pre-amendment snapshot.
    const baseline = await client.fetchSection({
      date: BASELINE_DATE,
      title: 29,
      part: 541,
      section: '541.600',
    });
    const amended = await client.fetchSection({
      date: AMENDED_DATE,
      title: 29,
      part: 541,
      section: '541.600',
    });
    const store = createMemoryStore();
    crawlSections(store, baseline, {
      jurisdiction: 'us-federal',
      retrievedAt: '2024-05-01T06:00:00Z',
    });

    // Act
    const report = crawlSections(store, amended, {
      jurisdiction: 'us-federal',
      retrievedAt: '2024-08-01T06:00:00Z',
    });

    // Assert — the historical $684 → $844 change shows up as a hash diff.
    expect(report.changeEvents).toHaveLength(1);
    const added = report.changeEvents[0]?.diff.addedParagraphs.join(' ') ?? '';
    expect(added).toContain('$844');
  });
});

describe.runIf(online)('live Federal Register API', () => {
  const client = createFederalRegisterClient({ fetchImpl: recordingFetch });

  test('agency/date filtered tiny query returns the 2024 DOL overtime rule, fully mapped', async () => {
    // Act
    const result = await client.searchDocuments({
      agencySlug: 'wage-and-hour-division',
      publicationDateGte: '2024-04-20',
      publicationDateLte: '2024-04-30',
      perPage: 5,
    });

    // Assert
    expect(result.count).toBeGreaterThanOrEqual(1);
    const rule = result.docs.find((d) => d.document_number === '2024-08038');
    if (rule === undefined) {
      throw new Error(`2024-08038 not in mapped docs; skipped: ${JSON.stringify(result.skipped)}`);
    }
    expect(rule.effective_on).toBe('2024-07-01');
    expect(rule.cfr_references).toContainEqual({ title: 29, part: 541 });
    expect(rule.agencies).toContain('Wage and Hour Division');
    // The mapped excerpt must feed the deterministic effective-date gate.
    expect(extractEffectiveDates(rule.body_excerpt)).toContain('2024-07-01');
  });
});

describe.runIf(online)('live observation report', () => {
  test('prints observed statuses and payload sizes', () => {
    for (const o of observations) {
      console.warn(`[test-live] ${o.status} ${o.bytes}B ${o.url}`);
    }
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((o) => o.status === 200)).toBe(true);
  });
});
