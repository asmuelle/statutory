import { describe, expect, test } from 'vitest';

import { verifyCitations, verifySpan } from './spanVerify.js';
import type { SectionVersion } from './types.js';

const VERSION: SectionVersion = {
  id: 'ver-2',
  sectionId: 'sec-1',
  citation: '29 CFR § 541.600',
  normalizedParagraphs: [
    '(a) To qualify as exempt, an employee shall be compensated on a salary basis.',
    '(b) Beginning on July 1, 2024, $844 per week.',
  ],
  normalizedText:
    '(a) To qualify as exempt, an employee shall be compensated on a salary basis.\n(b) Beginning on July 1, 2024, $844 per week.',
  contentHash: 'abc',
  retrievedAt: '2024-07-01T06:00:00Z',
  sourceUrl: 'https://www.ecfr.gov/current/title-29/part-541',
  supersedesVersionId: 'ver-1',
};

const lookup = (id: string): SectionVersion | undefined => (id === VERSION.id ? VERSION : undefined);

describe('verifySpan (invariant 2)', () => {
  test('an exact quote from the stored version matches', () => {
    // Act / Assert
    expect(verifySpan('Beginning on July 1, 2024, $844 per week.', VERSION.normalizedText)).toBe(
      true,
    );
  });

  test('a paraphrased quote ("shall" -> "must") fails', () => {
    // Arrange — the classic LLM paraphrase drift
    const paraphrase = 'an employee must be compensated on a salary basis';

    // Act / Assert
    expect(verifySpan(paraphrase, VERSION.normalizedText)).toBe(false);
  });

  test('whitespace and curly-quote churn in the quote still matches after normalization', () => {
    // Arrange
    const churned = 'Beginning  on July 1,   2024, $844 per week.';

    // Act / Assert
    expect(verifySpan(churned, VERSION.normalizedText)).toBe(true);
  });

  test('a quote crossing a paragraph boundary matches the space-joined form', () => {
    // Arrange
    const crossing = 'salary basis. (b) Beginning on July 1, 2024';

    // Act / Assert
    expect(verifySpan(crossing, VERSION.normalizedText)).toBe(true);
  });

  test('an empty quote never matches', () => {
    // Act / Assert
    expect(verifySpan('   ', VERSION.normalizedText)).toBe(false);
  });
});

describe('verifyCitations', () => {
  test('reports match, no_match, empty_quote, and missing_version distinctly', () => {
    // Arrange
    const citations = [
      { citation: '29 CFR § 541.600', sectionVersionId: 'ver-2', quoteSpan: '$844 per week' },
      { citation: '29 CFR § 541.600', sectionVersionId: 'ver-2', quoteSpan: '$884 per week' },
      { citation: '29 CFR § 541.600', sectionVersionId: 'ver-2', quoteSpan: '  ' },
      { citation: '29 CFR § 541.600', sectionVersionId: 'ver-999', quoteSpan: '$844 per week' },
    ];

    // Act
    const checks = verifyCitations(citations, lookup);

    // Assert
    expect(checks.map((c) => c.reason)).toEqual([
      'match',
      'no_match',
      'empty_quote',
      'missing_version',
    ]);
    expect(checks.map((c) => c.ok)).toEqual([true, false, false, false]);
  });
});
