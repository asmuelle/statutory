/**
 * Canonical text normalization. Applied identically before hashing, diffing,
 * and span verification so that formatting/whitespace churn in a source feed
 * never produces a change event or a false span mismatch (invariants 1, 2, 6).
 *
 * Deterministic, pure, no IO.
 */

const CURLY_SINGLE_QUOTES = /[‘’‚‛]/g;
const CURLY_DOUBLE_QUOTES = /[“”„‟]/g;
const DASHES = /[‒–—]/g;
const NBSP_AND_FRIENDS = /[\u00a0\u2007\u202f]/g;
const WHITESPACE_RUNS = /\s+/g;

/** Normalize a single run of prose to canonical single-line form. */
export const normalizeText = (text: string): string =>
  text
    .normalize('NFC')
    .replace(NBSP_AND_FRIENDS, ' ')
    .replace(CURLY_SINGLE_QUOTES, "'")
    .replace(CURLY_DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(WHITESPACE_RUNS, ' ')
    .trim();

/** Normalize each paragraph and drop paragraphs that normalize to empty. */
export const normalizeParagraphs = (paragraphs: readonly string[]): readonly string[] =>
  paragraphs.map(normalizeText).filter((p) => p.length > 0);

/** Canonical full-section text: normalized paragraphs joined by single newlines. */
export const canonicalSectionText = (paragraphs: readonly string[]): string =>
  normalizeParagraphs(paragraphs).join('\n');
