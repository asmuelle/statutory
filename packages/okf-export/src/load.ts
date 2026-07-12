import type { CanonicalSection, Delta, SectionVersion } from '@statutory/core';
import type { RuleSectionExport, RulebookExportInput } from './types';

/** The three read methods the export needs from the store (a Pick of MemoryStore). */
export interface RulebookReadStore {
  listSections(): readonly CanonicalSection[];
  getVersion(versionId: string): SectionVersion | undefined;
  listDeltas(): readonly Delta[];
}

/**
 * Load the export input from a store: every canonical section paired with its resolvable current
 * version, and only published deltas (`publishedAt !== null`, which already implies verified +
 * approved). A section whose current version cannot be resolved is skipped rather than shipped half.
 */
export const loadRulebookExport = (
  store: RulebookReadStore,
  name: string,
  baseUrl: string,
): RulebookExportInput => {
  const sections: RuleSectionExport[] = [];
  for (const section of store.listSections()) {
    const currentVersion = store.getVersion(section.currentVersionId);
    if (currentVersion === undefined) continue;
    sections.push({ section, currentVersion });
  }
  const deltas = store.listDeltas().filter((delta) => delta.publishedAt !== null);
  return { name, baseUrl, sections, deltas };
};
