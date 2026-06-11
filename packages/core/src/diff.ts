import type { StructuralDiff } from './types.js';

/**
 * Paragraph-level structural diff between two canonical versions.
 * Inputs must already be normalized (see normalize.ts); comparison is exact
 * string equality, so whitespace churn upstream can never register here.
 */
export const computeStructuralDiff = (
  oldParagraphs: readonly string[],
  newParagraphs: readonly string[],
): StructuralDiff => {
  const oldSet = new Set(oldParagraphs);
  const newSet = new Set(newParagraphs);
  return {
    removedParagraphs: oldParagraphs.filter((p) => !newSet.has(p)),
    addedParagraphs: newParagraphs.filter((p) => !oldSet.has(p)),
  };
};

/** True when the diff carries no substantive change. */
export const isEmptyDiff = (diff: StructuralDiff): boolean =>
  diff.removedParagraphs.length === 0 && diff.addedParagraphs.length === 0;
