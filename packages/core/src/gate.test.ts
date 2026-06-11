import { describe, expect, test } from 'vitest';

import { runVerificationGate } from './gate.js';
import type { GateInput } from './gate.js';
import type { SectionVersion } from './types.js';

const VERSION: SectionVersion = {
  id: 'ver-2',
  sectionId: 'sec-1',
  citation: '29 CFR § 541.600',
  normalizedParagraphs: ['(b) Beginning on July 1, 2024, $844 per week.'],
  normalizedText: '(b) Beginning on July 1, 2024, $844 per week.',
  contentHash: 'abc',
  retrievedAt: '2024-07-01T06:00:00Z',
  sourceUrl: 'https://www.ecfr.gov/current/title-29/part-541',
  supersedesVersionId: 'ver-1',
};

const baseInput: GateInput = {
  citations: [
    { citation: '29 CFR § 541.600', sectionVersionId: 'ver-2', quoteSpan: '$844 per week' },
  ],
  modelEffectiveDate: '2024-07-01',
  sourceDateText: 'DATES: This rule is effective July 1, 2024.',
  getVersion: (id) => (id === 'ver-2' ? VERSION : undefined),
  now: '2024-07-01T07:00:00Z',
};

describe('runVerificationGate', () => {
  test('passes when every span matches and the effective date cross-checks', () => {
    // Act
    const result = runVerificationGate(baseInput);

    // Assert
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.verifiedCitations[0]?.verifiedAt).toBe('2024-07-01T07:00:00Z');
  });

  test('blocks on a mutated quote span and stamps no verifiedAt', () => {
    // Arrange — seeded mutation: $844 -> $884
    const input: GateInput = {
      ...baseInput,
      citations: [
        { citation: '29 CFR § 541.600', sectionVersionId: 'ver-2', quoteSpan: '$884 per week' },
      ],
    };

    // Act
    const result = runVerificationGate(input);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.kind)).toEqual(['span_mismatch']);
    expect(result.verifiedCitations[0]?.verifiedAt).toBeNull();
  });

  test('blocks on an effective-date disagreement', () => {
    // Arrange
    const input: GateInput = { ...baseInput, modelEffectiveDate: '2024-08-01' };

    // Act
    const result = runVerificationGate(input);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.kind)).toEqual(['effective_date_mismatch']);
  });

  test('blocks when a citation pins a version that does not exist', () => {
    // Arrange
    const input: GateInput = {
      ...baseInput,
      citations: [
        { citation: '29 CFR § 541.600', sectionVersionId: 'ver-404', quoteSpan: '$844 per week' },
      ],
    };

    // Act
    const result = runVerificationGate(input);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.kind)).toEqual(['missing_version']);
  });

  test('collects multiple failures rather than short-circuiting', () => {
    // Arrange
    const input: GateInput = {
      ...baseInput,
      citations: [
        { citation: '29 CFR § 541.600', sectionVersionId: 'ver-2', quoteSpan: '$884 per week' },
        { citation: '29 CFR § 541.600', sectionVersionId: 'ver-2', quoteSpan: '   ' },
      ],
      modelEffectiveDate: '2024-08-01',
    };

    // Act
    const result = runVerificationGate(input);

    // Assert
    expect(result.failures.map((f) => f.kind)).toEqual([
      'span_mismatch',
      'empty_quote',
      'effective_date_mismatch',
    ]);
  });
});
