import type { Delta } from '@statutory/core';
import { topicForCitation } from '@statutory/core';
import { markdownLink, slugify, type ConceptDoc, type LintFinding } from '@okf/core';
import type { RuleSectionExport } from './types';

/** Rule-page path for a section: `rules/<jurisdiction>/<citation-slug>.md` (citation is unique). */
export const ruleSectionPath = (exp: RuleSectionExport): string =>
  `rules/${slugify(exp.section.jurisdiction)}/${slugify(exp.section.citation)}.md`;

const sectionBody = (paragraphs: readonly string[], fallback: string): string => {
  const joined = paragraphs.map((p) => p.trim()).filter((p) => p !== '').join('\n\n');
  return joined === '' ? fallback.trim() : joined;
};

/** Project one rule section's current version into a concept doc. */
export const ruleSectionDoc = (exp: RuleSectionExport, baseUrl: string): ConceptDoc => {
  const { section, currentVersion } = exp;
  const path = ruleSectionPath(exp);
  const topic = topicForCitation(section.citation);
  const body = [
    sectionBody(currentVersion.normalizedParagraphs, currentVersion.normalizedText),
    `[Source](${currentVersion.sourceUrl}) · ${markdownLink('← Rulebook', path, 'index.md')}`,
  ].join('\n\n');

  return {
    path,
    frontmatter: {
      type: 'Rule Section',
      title: `${section.citation} — ${section.heading}`,
      resource: `${baseUrl}/rulebook`,
      tags: [section.jurisdiction, ...(topic === undefined ? [] : [topic.id])],
      extra: {
        citation: section.citation,
        jurisdiction: section.jurisdiction,
        contentHash: section.currentHash,
        versionId: currentVersion.id,
      },
    },
    body,
  };
};

export interface DeltaDocResult {
  readonly doc: ConceptDoc;
  readonly findings: readonly LintFinding[];
}

/**
 * Project one published delta into a concept doc. Publication already implies every citation is
 * span-verified (`verifiedAt !== null`); we re-assert it — an unverified citation yields an
 * UNVERIFIED_CITATION error finding and is kept out of the Sources block (projection-only rule).
 * Citations whose pinned section version is a current rule page cross-link into the bundle.
 */
export const deltaDoc = (
  delta: Delta,
  baseUrl: string,
  rulePathByVersionId: ReadonlyMap<string, string>,
): DeltaDocResult => {
  const path = `deltas/${slugify(delta.id)}.md`;
  const findings: LintFinding[] = [];
  const sourceLines: string[] = [];

  for (const citation of delta.citations) {
    if (citation.verifiedAt === null) {
      findings.push({
        check: 'UNVERIFIED_CITATION',
        severity: 'error',
        path,
        message: `citation ${citation.citation} is unverified in a published delta`,
      });
      continue;
    }
    const rulePath = rulePathByVersionId.get(citation.sectionVersionId);
    const label =
      rulePath === undefined
        ? citation.citation
        : markdownLink(citation.citation, path, rulePath);
    sourceLines.push(`- "${citation.quoteSpan.trim()}" — ${label} (verified ${citation.verifiedAt})`);
  }

  const body = [
    delta.bodyMd.trim(),
    ...(sourceLines.length > 0 ? [`## Citations\n\n${sourceLines.join('\n')}`] : []),
    markdownLink('← Rulebook', path, 'index.md'),
  ].join('\n\n');

  return {
    doc: {
      path,
      frontmatter: {
        type: 'Statute Delta',
        title: delta.title,
        resource: `${baseUrl}/alerts/${delta.id}`,
        tags: [delta.jurisdiction, delta.topic],
        ...(delta.publishedAt !== null && { timestamp: delta.publishedAt }),
        extra: {
          jurisdiction: delta.jurisdiction,
          topic: delta.topic,
          effectiveDate: delta.effectiveDate,
        },
      },
      body,
    },
    findings,
  };
};
