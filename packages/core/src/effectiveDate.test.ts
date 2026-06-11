import { describe, expect, test } from 'vitest';

import {
  crossCheckEffectiveDate,
  extractAllDates,
  extractEffectiveDates,
} from './effectiveDate.js';

describe('extractEffectiveDates', () => {
  test('extracts "effective July 1, 2024" from rule prose', () => {
    // Arrange
    const text = 'DATES: This rule is effective July 1, 2024.';

    // Act / Assert
    expect(extractEffectiveDates(text)).toEqual(['2024-07-01']);
  });

  test('extracts multiple staged effective dates, deduped and sorted', () => {
    // Arrange
    const text =
      'The rule is effective July 1, 2024. The second threshold is effective on January 1, 2025. As noted, it is effective July 1, 2024.';

    // Act / Assert
    expect(extractEffectiveDates(text)).toEqual(['2024-07-01', '2025-01-01']);
  });

  test('ignores dates not tied to an effective construction', () => {
    // Arrange
    const text = 'Published April 26, 2024. This rule is effective July 1, 2024.';

    // Act / Assert
    expect(extractEffectiveDates(text)).toEqual(['2024-07-01']);
  });

  test('returns empty when no effective date is present', () => {
    // Act / Assert
    expect(extractEffectiveDates('No dates here.')).toEqual([]);
  });
});

describe('extractAllDates', () => {
  test('extracts both prose and ISO dates', () => {
    // Arrange
    const text = 'Published April 26, 2024 (see 2024-07-01).';

    // Act / Assert
    expect(extractAllDates(text)).toEqual(['2024-04-26', '2024-07-01']);
  });
});

describe('crossCheckEffectiveDate (invariant 3)', () => {
  test('agrees when model date matches deterministic extraction', () => {
    // Arrange
    const sourceText = 'DATES: This rule is effective July 1, 2024.';

    // Act
    const check = crossCheckEffectiveDate('2024-07-01', sourceText);

    // Assert
    expect(check.agrees).toBe(true);
    expect(check.sourceDates).toContain('2024-07-01');
  });

  test('disagrees when the model claims a date the source does not state', () => {
    // Arrange
    const sourceText = 'DATES: This rule is effective July 1, 2024.';

    // Act
    const check = crossCheckEffectiveDate('2024-08-01', sourceText);

    // Assert
    expect(check.agrees).toBe(false);
    expect(check.modelDate).toBe('2024-08-01');
  });
});
