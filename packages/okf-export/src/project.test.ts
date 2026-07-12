import type { CanonicalSection, Citation, Delta, SectionVersion } from '@statutory/core';
import { describe, expect, it } from 'vitest';
import { projectRulebookBundle } from './project';
import type { RuleSectionExport, RulebookExportInput } from './types';

const section: CanonicalSection = {
  id: 'sec-541-600',
  citation: '29 CFR § 541.600',
  heading: 'Amount of salary required',
  jurisdiction: 'us-federal',
  currentVersionId: 'ver-2',
  currentHash: 'hash-v2',
};

const currentVersion: SectionVersion = {
  id: 'ver-2',
  sectionId: 'sec-541-600',
  citation: '29 CFR § 541.600',
  normalizedParagraphs: ['To qualify, an employee must be paid $1,128 per week.'],
  normalizedText: 'To qualify, an employee must be paid $1,128 per week.',
  contentHash: 'hash-v2',
  retrievedAt: '2026-06-01T00:00:00Z',
  sourceUrl: 'https://www.ecfr.gov/current/title-29/section-541.600',
  supersedesVersionId: 'ver-1',
};

const verifiedCitation: Citation = {
  citation: '29 CFR § 541.600',
  sectionVersionId: 'ver-2',
  quoteSpan: 'must be paid $1,128 per week',
  verifiedAt: '2026-06-08T00:00:00Z',
};

const delta = (over: Partial<Delta> = {}): Delta => ({
  id: 'delta-salary-2026',
  jurisdiction: 'us-federal',
  topic: 'exempt-status',
  changeEventIds: ['evt-1'],
  title: 'Salary threshold raised to $1,128/week',
  bodyMd: '# What changed\n\nThe weekly salary threshold rose.',
  effectiveDate: '2026-07-01',
  citations: [verifiedCitation],
  verificationStatus: 'verified',
  publishedAt: '2026-06-09T00:00:00Z',
  ...over,
});

const exp: RuleSectionExport = { section, currentVersion };

const inputOf = (over: Partial<RulebookExportInput> = {}): RulebookExportInput => ({
  name: 'Employment',
  baseUrl: 'https://app.statutory.test',
  sections: [exp],
  deltas: [delta()],
  ...over,
});

describe('projectRulebookBundle', () => {
  it('renders the rule section as a golden concept doc', () => {
    // Act
    const { files, findings } = projectRulebookBundle(inputOf());

    // Assert
    expect(files.get('rules/us-federal/29-cfr-541-600.md')).toBe(
      [
        '---',
        'type: Rule Section',
        'title: 29 CFR § 541.600 — Amount of salary required',
        'resource: https://app.statutory.test/rulebook',
        'tags: [us-federal, exempt-status]',
        'citation: 29 CFR § 541.600',
        'contentHash: hash-v2',
        'jurisdiction: us-federal',
        'versionId: ver-2',
        '---',
        '',
        'To qualify, an employee must be paid $1,128 per week.',
        '',
        '[Source](https://www.ecfr.gov/current/title-29/section-541.600) · [← Rulebook](../../index.md)',
        '',
      ].join('\n'),
    );
    expect(findings).toEqual([]);
  });

  it('bundles rule pages, delta docs, index and log, path-sorted', () => {
    // Act
    const { files } = projectRulebookBundle(inputOf());

    // Assert
    expect([...files.keys()]).toEqual([
      'deltas/delta-salary-2026.md',
      'index.md',
      'log.md',
      'rules/us-federal/29-cfr-541-600.md',
    ]);
  });

  it('cross-links a delta citation to the rule page and lists it under Citations', () => {
    // Act
    const { files } = projectRulebookBundle(inputOf());
    const deltaMd = files.get('deltas/delta-salary-2026.md') ?? '';

    // Assert — relative link from deltas/ up into rules/.
    expect(deltaMd).toContain('## Citations');
    expect(deltaMd).toContain('[29 CFR § 541.600](../rules/us-federal/29-cfr-541-600.md)');
    expect(deltaMd).toContain('verified 2026-06-08T00:00:00Z');
  });

  it('writes the publication into log.md', () => {
    // Act
    const { files } = projectRulebookBundle(inputOf());

    // Assert
    expect(files.get('log.md')).toContain(
      'Published "Salary threshold raised to $1,128/week" (us-federal/exempt-status), effective 2026-07-01.',
    );
  });

  it('is byte-deterministic under shuffled input order', () => {
    // Arrange — a second section + delta, supplied in reverse.
    const section2: CanonicalSection = { ...section, id: 'sec-778', citation: '29 CFR § 778.100', currentVersionId: 'ver-b', currentHash: 'hb', heading: 'Overtime' };
    const version2: SectionVersion = { ...currentVersion, id: 'ver-b', sectionId: 'sec-778', citation: '29 CFR § 778.100' };
    const delta2 = delta({ id: 'delta-b', title: 'Other', citations: [{ ...verifiedCitation, sectionVersionId: 'ver-b' }] });
    const forward = inputOf({ sections: [exp, { section: section2, currentVersion: version2 }], deltas: [delta(), delta2] });
    const reversed = inputOf({ sections: [{ section: section2, currentVersion: version2 }, exp], deltas: [delta2, delta()] });

    // Act
    const a = projectRulebookBundle(forward);
    const b = projectRulebookBundle(reversed);

    // Assert
    expect([...a.files.entries()]).toEqual([...b.files.entries()]);
  });

  it('gates an unverified citation in a published delta out of the bundle as an error finding', () => {
    // Arrange — a published delta whose citation somehow lacks verifiedAt.
    const bad = delta({ citations: [{ ...verifiedCitation, verifiedAt: null }] });

    // Act
    const { files, findings } = projectRulebookBundle(inputOf({ deltas: [bad] }));

    // Assert — no Citations block, an error finding recorded.
    expect(files.get('deltas/delta-salary-2026.md')).not.toContain('## Citations');
    expect(findings).toContainEqual(
      expect.objectContaining({ check: 'UNVERIFIED_CITATION', severity: 'error' }),
    );
  });

  it('skips a citation whose section version is not a current rule page (no cross-link, still listed)', () => {
    // Arrange — citation points at a superseded version id.
    const oldCite = delta({ citations: [{ ...verifiedCitation, sectionVersionId: 'ver-1' }] });

    // Act
    const deltaMd = projectRulebookBundle(inputOf({ deltas: [oldCite] })).files.get(
      'deltas/delta-salary-2026.md',
    ) ?? '';

    // Assert — the citation is listed but as plain text, not a link.
    expect(deltaMd).toContain('## Citations');
    expect(deltaMd).not.toContain('](../rules/');
  });
});

