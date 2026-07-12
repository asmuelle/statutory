import type { CanonicalSection, Delta, SectionVersion } from '@statutory/core';
import { describe, expect, it } from 'vitest';
import { loadRulebookExport, type RulebookReadStore } from './load';

const section = (id: string, currentVersionId: string): CanonicalSection => ({
  id,
  citation: `29 CFR § ${id}`,
  heading: 'H',
  jurisdiction: 'us-federal',
  currentVersionId,
  currentHash: 'h',
});

const version = (id: string): SectionVersion => ({
  id,
  sectionId: 'sec',
  citation: 'c',
  normalizedParagraphs: ['p'],
  normalizedText: 'p',
  contentHash: 'h',
  retrievedAt: '2026-06-01T00:00:00Z',
  sourceUrl: 'https://x',
  supersedesVersionId: null,
});

const delta = (id: string, publishedAt: string | null): Delta => ({
  id,
  jurisdiction: 'us-federal',
  topic: 'overtime',
  changeEventIds: [],
  title: id,
  bodyMd: 'b',
  effectiveDate: '2026-07-01',
  citations: [],
  verificationStatus: publishedAt === null ? 'pending' : 'verified',
  publishedAt,
});

describe('loadRulebookExport', () => {
  it('pairs sections with their current version and keeps only published deltas', () => {
    // Arrange
    const versions = new Map([['v-1', version('v-1')]]);
    const store: RulebookReadStore = {
      listSections: () => [section('541.600', 'v-1'), section('778.100', 'missing')],
      getVersion: (id) => versions.get(id),
      listDeltas: () => [delta('d-pub', '2026-06-09T00:00:00Z'), delta('d-draft', null)],
    };

    // Act
    const input = loadRulebookExport(store, 'Employment', 'https://app.test');

    // Assert — the section with an unresolvable current version is skipped; only the published delta.
    expect(input.sections.map((s) => s.section.id)).toEqual(['541.600']);
    expect(input.sections[0]?.currentVersion.id).toBe('v-1');
    expect(input.deltas.map((d) => d.id)).toEqual(['d-pub']);
    expect(input.name).toBe('Employment');
  });
});
