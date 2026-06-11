import { describe, expect, test } from 'vitest';

import { canonicalSectionText, normalizeParagraphs, normalizeText } from './normalize.js';

describe('normalizeText', () => {
  test('collapses whitespace runs to single spaces and trims', () => {
    // Arrange
    const messy = '  An employee   must be\tcompensated \n on a salary basis. ';

    // Act
    const result = normalizeText(messy);

    // Assert
    expect(result).toBe('An employee must be compensated on a salary basis.');
  });

  test('normalizes curly quotes and long dashes to ASCII', () => {
    // Arrange
    const fancy = '“salary basis” — the employee’s rate';

    // Act
    const result = normalizeText(fancy);

    // Assert
    expect(result).toBe('"salary basis" - the employee\'s rate');
  });

  test('normalizes non-breaking spaces', () => {
    // Arrange
    const withNbsp = '$844 per week';

    // Act
    const result = normalizeText(withNbsp);

    // Assert
    expect(result).toBe('$844 per week');
  });

  test('is idempotent', () => {
    // Arrange
    const input = '  “Effective   July 1, 2024” — § 541.600  ';

    // Act
    const once = normalizeText(input);
    const twice = normalizeText(once);

    // Assert
    expect(twice).toBe(once);
  });
});

describe('normalizeParagraphs', () => {
  test('drops paragraphs that normalize to empty', () => {
    // Arrange
    const paragraphs = ['First.', '   ', '\n\t', 'Second.'];

    // Act
    const result = normalizeParagraphs(paragraphs);

    // Assert
    expect(result).toEqual(['First.', 'Second.']);
  });
});

describe('canonicalSectionText', () => {
  test('joins normalized paragraphs with single newlines', () => {
    // Arrange
    const paragraphs = ['(a)  General   rule.', '(b) Exceptions. '];

    // Act
    const result = canonicalSectionText(paragraphs);

    // Assert
    expect(result).toBe('(a) General rule.\n(b) Exceptions.');
  });
});
