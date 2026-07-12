import type { CanonicalSection, Delta, SectionVersion } from '@statutory/core';
import type { LintFinding } from '@okf/core';

/** One rule section paired with its current (head) version — the projector's unit. */
export interface RuleSectionExport {
  readonly section: CanonicalSection;
  readonly currentVersion: SectionVersion;
}

export interface RulebookExportInput {
  /** Bundle title, e.g. the practice name or "Employment rulebook". */
  readonly name: string;
  /** App origin for `resource:` deep links, no trailing slash. */
  readonly baseUrl: string;
  readonly sections: readonly RuleSectionExport[];
  /** Published deltas only (publishedAt !== null). */
  readonly deltas: readonly Delta[];
}

/**
 * The projection result. Any `severity: 'error'` finding (e.g. a published delta carrying an
 * unverified citation) means the bundle MUST NOT ship — the projection-only rule; the render layer
 * already refuses unverified, so this guards the guard.
 */
export interface RulebookBundle {
  readonly files: ReadonlyMap<string, string>;
  readonly findings: readonly LintFinding[];
}
