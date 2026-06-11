import { describe, expect, test } from 'vitest';

import { computeStructuralDiff, isEmptyDiff } from './diff.js';

describe('computeStructuralDiff', () => {
  test('identical paragraph lists produce an empty diff', () => {
    // Arrange
    const paragraphs = ['(a) Rule one.', '(b) Rule two.'];

    // Act
    const diff = computeStructuralDiff(paragraphs, paragraphs);

    // Assert
    expect(isEmptyDiff(diff)).toBe(true);
  });

  test('an amended paragraph appears as one removed and one added', () => {
    // Arrange
    const before = ['(a) Salary of not less than $684 per week.', '(b) Board and lodging.'];
    const after = ['(a) Salary of not less than $844 per week.', '(b) Board and lodging.'];

    // Act
    const diff = computeStructuralDiff(before, after);

    // Assert
    expect(diff.removedParagraphs).toEqual(['(a) Salary of not less than $684 per week.']);
    expect(diff.addedParagraphs).toEqual(['(a) Salary of not less than $844 per week.']);
  });

  test('a newly inserted paragraph appears only as added', () => {
    // Arrange
    const before = ['(a) Rule.'];
    const after = ['(a) Rule.', '(b) Beginning on January 1, 2025, $1,128 per week.'];

    // Act
    const diff = computeStructuralDiff(before, after);

    // Assert
    expect(diff.removedParagraphs).toEqual([]);
    expect(diff.addedParagraphs).toEqual(['(b) Beginning on January 1, 2025, $1,128 per week.']);
  });

  test('inputs are not mutated', () => {
    // Arrange
    const before = Object.freeze(['(a) Old.']);
    const after = Object.freeze(['(a) New.']);

    // Act
    computeStructuralDiff(before, after);

    // Assert — frozen arrays would throw on mutation; reaching here means none occurred
    expect(before).toEqual(['(a) Old.']);
    expect(after).toEqual(['(a) New.']);
  });
});
