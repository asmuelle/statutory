import { NOT_LEGAL_ADVICE, renderCoverageStatement } from '@statutory/core';
import type { CoverageManifest, Delta, PracticeProfile } from '@statutory/core';

/**
 * Email alert rendering. Alerts carry their evidence: exact citations with
 * verification stamps, the effective date, the honest coverage statement,
 * and the not-legal-advice framing (invariants 8, 9). Rendering an alert for
 * an unpublished or unverified delta is impossible by construction.
 */

export interface EmailAlert {
  readonly subject: string;
  readonly body: string;
}

export class AlertRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertRenderError';
  }
}

export const renderEmailAlert = (
  delta: Delta,
  manifest: CoverageManifest,
  profile: PracticeProfile,
): EmailAlert => {
  if (delta.publishedAt === null) {
    throw new AlertRenderError(`Delta ${delta.id} is not published — no alert may be rendered.`);
  }
  if (delta.citations.length === 0 || delta.citations.some((c) => c.verifiedAt === null)) {
    throw new AlertRenderError(
      `Delta ${delta.id} has unverified citations — no alert may be rendered.`,
    );
  }

  const citationLines = delta.citations.map(
    (c) => `> "${c.quoteSpan}"\n  — ${c.citation} (span-verified ${c.verifiedAt})`,
  );

  const body = [
    `Hello ${profile.name},`,
    '',
    `${delta.title}`,
    `Effective date: ${delta.effectiveDate}`,
    '',
    delta.bodyMd,
    '',
    'Verbatim source spans:',
    ...citationLines,
    '',
    `Coverage: ${renderCoverageStatement(manifest)}`,
    '',
    NOT_LEGAL_ADVICE,
  ].join('\n');

  return {
    subject: `[Statutory] ${delta.title}`,
    body,
  };
};
