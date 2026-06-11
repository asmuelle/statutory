import { normalizeText } from './normalize.js';
import type { Citation, SectionVersion } from './types.js';

/**
 * Span verification (invariant 2): every quoted span must exactly
 * string-match — after canonical normalization — the stored text of the
 * cited section version. A paraphrase ("shall" -> "must") fails.
 */

export interface SpanCheck {
  readonly citation: string;
  readonly sectionVersionId: string;
  readonly quoteSpan: string;
  readonly ok: boolean;
  readonly reason: 'match' | 'no_match' | 'empty_quote' | 'missing_version';
}

export type VersionLookup = (versionId: string) => SectionVersion | undefined;

/** Verify a single quote span against a version's canonical text. */
export const verifySpan = (quoteSpan: string, versionText: string): boolean => {
  const normalizedQuote = normalizeText(quoteSpan);
  if (normalizedQuote.length === 0) {
    return false;
  }
  // Version text is canonical (newline-joined paragraphs); a quote may cross
  // a paragraph boundary in display form, so match against the space-joined
  // form as well.
  return (
    versionText.includes(normalizedQuote) ||
    versionText.replace(/\n/g, ' ').includes(normalizedQuote)
  );
};

/** Verify every citation in a draft against its pinned section version. */
export const verifyCitations = (
  citations: readonly Pick<Citation, 'citation' | 'sectionVersionId' | 'quoteSpan'>[],
  getVersion: VersionLookup,
): readonly SpanCheck[] =>
  citations.map((c) => {
    const version = getVersion(c.sectionVersionId);
    if (version === undefined) {
      return { ...c, ok: false, reason: 'missing_version' as const };
    }
    if (normalizeText(c.quoteSpan).length === 0) {
      return { ...c, ok: false, reason: 'empty_quote' as const };
    }
    const ok = verifySpan(c.quoteSpan, version.normalizedText);
    return { ...c, ok, reason: ok ? ('match' as const) : ('no_match' as const) };
  });
