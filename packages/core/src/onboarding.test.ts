import { describe, expect, test } from 'vitest';

import {
  CLIENT_TYPE_OPTIONS,
  JURISDICTION_OPTIONS,
  PRACTICE_AREA_OPTIONS,
  buildPracticeProfile,
  scopeRulebook,
} from './onboarding.js';
import { matchProfiles } from './profileMatch.js';
import type { CanonicalSection, Delta } from './types.js';

const section = (overrides: Partial<CanonicalSection>): CanonicalSection => ({
  id: 'sec-1',
  citation: '29 CFR § 541.600',
  heading: 'Amount of salary required.',
  jurisdiction: 'us-federal',
  currentVersionId: 'ver-1',
  currentHash: 'hash',
  ...overrides,
});

const delta = (overrides: Partial<Delta>): Delta => ({
  id: 'delta-1',
  jurisdiction: 'us-federal',
  topic: 'exempt-status',
  changeEventIds: ['evt-1'],
  title: 'Exempt salary threshold rises',
  bodyMd: 'body',
  effectiveDate: '2024-07-01',
  citations: [
    {
      citation: '29 CFR § 541.600',
      sectionVersionId: 'ver-2',
      quoteSpan: '$844 per week',
      verifiedAt: '2024-07-01T06:05:00Z',
    },
  ],
  verificationStatus: 'verified',
  publishedAt: '2024-07-01T14:31:00Z',
  ...overrides,
});

describe('wizard option lists', () => {
  test('every option carries an id and a human label', () => {
    for (const option of [...JURISDICTION_OPTIONS, ...PRACTICE_AREA_OPTIONS]) {
      expect(option.id.length).toBeGreaterThan(0);
      expect(option.label.length).toBeGreaterThan(0);
    }
    expect(CLIENT_TYPE_OPTIONS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('buildPracticeProfile', () => {
  test('maps wizard selections onto the pipeline PracticeProfile shape', () => {
    const profile = buildPracticeProfile({
      id: 'profile-1',
      name: 'Maren Voss',
      selection: {
        jurisdictions: ['us-federal', 'us-ca'],
        practiceAreas: ['employment'],
        clientTypes: ['small-business'],
      },
    });
    expect(profile).toEqual({
      id: 'profile-1',
      name: 'Maren Voss',
      jurisdictions: ['us-federal', 'us-ca'],
      practiceAreas: ['employment'],
      clientTypes: ['small-business'],
    });
  });

  test('deduplicates repeated selections deterministically', () => {
    const profile = buildPracticeProfile({
      id: 'p',
      name: 'n',
      selection: {
        jurisdictions: ['us-federal', 'us-federal'],
        practiceAreas: ['tax', 'tax'],
        clientTypes: ['s-corps', 's-corps'],
      },
    });
    expect(profile.jurisdictions).toEqual(['us-federal']);
    expect(profile.practiceAreas).toEqual(['tax']);
    expect(profile.clientTypes).toEqual(['s-corps']);
  });
});

describe('scopeRulebook — completing onboarding scopes rulebook + delta feed', () => {
  const employmentProfile = buildPracticeProfile({
    id: 'p-emp',
    name: 'Employment solo',
    selection: {
      jurisdictions: ['us-federal'],
      practiceAreas: ['employment'],
      clientTypes: ['small-business'],
    },
  });

  test('keeps sections whose jurisdiction AND topic practice area match', () => {
    const sections = [
      section({ id: 'sec-1', citation: '29 CFR § 541.600' }),
      section({ id: 'sec-2', citation: '29 CFR § 778.101' }),
    ];
    const scoped = scopeRulebook(employmentProfile, sections, []);
    expect(scoped.sections.map((s) => s.id)).toEqual(['sec-1', 'sec-2']);
  });

  test('drops sections outside the profile jurisdictions', () => {
    const scoped = scopeRulebook(
      employmentProfile,
      [section({ jurisdiction: 'us-ca' })],
      [],
    );
    expect(scoped.sections).toEqual([]);
  });

  test('drops sections whose topic maps to an unsubscribed practice area', () => {
    const taxProfile = buildPracticeProfile({
      id: 'p-tax',
      name: 'Tax CPA',
      selection: {
        jurisdictions: ['us-federal'],
        practiceAreas: ['tax'],
        clientTypes: ['s-corps'],
      },
    });
    const scoped = scopeRulebook(taxProfile, [section({})], []);
    expect(scoped.sections).toEqual([]);
  });

  test('drops sections with citations outside the taxonomy entirely', () => {
    const scoped = scopeRulebook(
      employmentProfile,
      [section({ citation: '26 CFR § 1.199A-1' })],
      [],
    );
    expect(scoped.sections).toEqual([]);
  });

  test('the delta feed contains ONLY published deltas matched via matchProfiles', () => {
    const published = delta({});
    const unpublished = delta({ id: 'delta-2', publishedAt: null });
    const scoped = scopeRulebook(employmentProfile, [], [published, unpublished]);
    expect(scoped.deltas.map((d) => d.id)).toEqual(['delta-1']);
    // Cross-check against the existing pipeline matcher directly.
    expect(matchProfiles(published.jurisdiction, published.topic, [employmentProfile])).toEqual([
      employmentProfile,
    ]);
  });

  test('a non-matching profile receives an empty feed, never a partial one', () => {
    const taxProfile = buildPracticeProfile({
      id: 'p-tax',
      name: 'Tax CPA',
      selection: {
        jurisdictions: ['us-federal'],
        practiceAreas: ['tax'],
        clientTypes: ['s-corps'],
      },
    });
    const scoped = scopeRulebook(taxProfile, [], [delta({})]);
    expect(scoped.deltas).toEqual([]);
  });
});
