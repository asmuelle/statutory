import { describe, expect, test } from 'vitest';

import { hashParagraphs, hashText } from './hash.js';

describe('hashText', () => {
  test('same canonical text produces the same hash', () => {
    // Arrange
    const text = '(a) The standard salary level is $844 per week.';

    // Act / Assert
    expect(hashText(text)).toBe(hashText(text));
  });

  test('different text produces a different hash', () => {
    // Arrange
    const a = '(a) The standard salary level is $844 per week.';
    const b = '(a) The standard salary level is $684 per week.';

    // Act / Assert
    expect(hashText(a)).not.toBe(hashText(b));
  });

  test('produces 64-char lowercase hex', () => {
    // Act
    const hash = hashText('any text');

    // Assert
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashParagraphs (diff determinism, invariant 1)', () => {
  test('whitespace and quote-style churn does NOT change the hash', () => {
    // Arrange — same legal text, different formatting from a re-crawl
    const original = ['(a) An employee must be paid on a “salary basis”.'];
    const churned = ['  (a)  An employee   must be paid\n on a "salary basis". '];

    // Act / Assert
    expect(hashParagraphs(churned)).toBe(hashParagraphs(original));
  });

  test('a substantive amendment DOES change the hash', () => {
    // Arrange
    const before = ['(a) ... not less than $684 per week.'];
    const after = ['(a) ... not less than $844 per week.'];

    // Act / Assert
    expect(hashParagraphs(after)).not.toBe(hashParagraphs(before));
  });
});
