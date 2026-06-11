import { createHash } from 'node:crypto';

import { canonicalSectionText } from './normalize.js';

/**
 * Stable content hash of canonical section text. The diff engine compares
 * these hashes; an unchanged hash means zero downstream work and zero LLM
 * calls (invariant 1).
 */
export const hashText = (canonicalText: string): string =>
  createHash('sha256').update(canonicalText, 'utf8').digest('hex');

/** Hash a section directly from its raw paragraphs (normalizes first). */
export const hashParagraphs = (paragraphs: readonly string[]): string =>
  hashText(canonicalSectionText(paragraphs));
