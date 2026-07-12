import {
  buildBundle,
  generateIndex,
  generateLog,
  validateBundle,
  type ConceptDoc,
  type IndexEntry,
  type LintFinding,
  type LogEntry,
} from '@okf/core';
import { deltaDoc, ruleSectionDoc, ruleSectionPath } from './sections';
import type { RulebookBundle, RulebookExportInput } from './types';

/**
 * Project a practice's published rulebook into an OKF bundle: one concept doc per canonical
 * section (current version) under `rules/<jurisdiction>/`, one per published delta under
 * `deltas/`, plus `index.md` and a `log.md` built from delta publications. Pure and
 * byte-deterministic. Any error finding (an unverified citation slipping through) means the caller
 * must not ship the bundle.
 */
export const projectRulebookBundle = (input: RulebookExportInput): RulebookBundle => {
  const docs: ConceptDoc[] = [];
  const findings: LintFinding[] = [];
  const indexEntries: IndexEntry[] = [];

  // Map each current section version id → its rule page path, for delta citation cross-links.
  const rulePathByVersionId = new Map<string, string>();
  for (const exp of input.sections) {
    rulePathByVersionId.set(exp.currentVersion.id, ruleSectionPath(exp));
  }

  const sortedSections = [...input.sections].sort((a, b) =>
    ruleSectionPath(a) < ruleSectionPath(b) ? -1 : 1,
  );
  for (const exp of sortedSections) {
    const doc = ruleSectionDoc(exp, input.baseUrl);
    docs.push(doc);
    indexEntries.push({
      path: doc.path,
      title: doc.frontmatter.title ?? exp.section.citation,
      description: exp.section.heading,
    });
  }

  const sortedDeltas = [...input.deltas].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const delta of sortedDeltas) {
    const result = deltaDoc(delta, input.baseUrl, rulePathByVersionId);
    docs.push(result.doc);
    findings.push(...result.findings);
    indexEntries.push({
      path: result.doc.path,
      title: delta.title,
      description: `Delta · effective ${delta.effectiveDate}`,
    });
  }

  docs.push(
    generateIndex({
      title: `${input.name} — rulebook`,
      description:
        'OKF bundle projected from published, span-verified statute sections and deltas. See log.md for the publication history.',
      entries: indexEntries,
    }),
    generateLog(publicationLog(sortedDeltas)),
  );

  return {
    files: buildBundle(docs),
    findings: [...findings, ...validateBundle(docs)],
  };
};

/** log.md entries from published deltas, ordered by publish time then id (stable, append-only). */
const publicationLog = (deltas: readonly RulebookExportInput['deltas'][number][]): LogEntry[] => {
  const published = deltas.filter((delta) => delta.publishedAt !== null);
  const sorted = [...published].sort((a, b) => {
    const at = a.publishedAt ?? '';
    const bt = b.publishedAt ?? '';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  return sorted.map((delta) => ({
    timestamp: delta.publishedAt ?? '',
    summary: `Published "${delta.title}" (${delta.jurisdiction}/${delta.topic}), effective ${delta.effectiveDate}.`,
    details: [`delta ${delta.id}`, `${delta.citations.length} citation(s)`],
  }));
};
