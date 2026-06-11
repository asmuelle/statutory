import { crossCheckEffectiveDate } from './effectiveDate.js';
import { verifyCitations } from './spanVerify.js';
import type { SpanCheck, VersionLookup } from './spanVerify.js';
import type { Citation } from './types.js';

/**
 * The deterministic verification gate (invariants 2 + 3). Synthesis output
 * may not reach review — let alone publication — unless every quoted span
 * string-matches its pinned version AND the model's effective date agrees
 * with regex extraction from the primary source. No code path may bypass a
 * failed gate; failures route to the review queue as `needs_edit`.
 */

export interface GateFailure {
  readonly kind: 'span_mismatch' | 'missing_version' | 'empty_quote' | 'effective_date_mismatch';
  readonly detail: string;
}

export interface GateInput {
  readonly citations: readonly Pick<Citation, 'citation' | 'sectionVersionId' | 'quoteSpan'>[];
  readonly modelEffectiveDate: string;
  readonly sourceDateText: string;
  readonly getVersion: VersionLookup;
  readonly now: string;
}

export interface GateResult {
  readonly ok: boolean;
  readonly failures: readonly GateFailure[];
  readonly spanChecks: readonly SpanCheck[];
  /** Citations stamped with verifiedAt when (and only when) the gate passes. */
  readonly verifiedCitations: readonly Citation[];
}

const spanFailure = (check: SpanCheck): GateFailure => {
  const kind =
    check.reason === 'missing_version'
      ? ('missing_version' as const)
      : check.reason === 'empty_quote'
        ? ('empty_quote' as const)
        : ('span_mismatch' as const);
  return {
    kind,
    detail: `${check.citation} [version ${check.sectionVersionId}]: quote "${check.quoteSpan.slice(0, 80)}" — ${check.reason}`,
  };
};

export const runVerificationGate = (input: GateInput): GateResult => {
  const spanChecks = verifyCitations(input.citations, input.getVersion);
  const spanFailures = spanChecks.filter((c) => !c.ok).map(spanFailure);

  const dateCheck = crossCheckEffectiveDate(input.modelEffectiveDate, input.sourceDateText);
  const dateFailures: readonly GateFailure[] = dateCheck.agrees
    ? []
    : [
        {
          kind: 'effective_date_mismatch',
          detail: `model claimed ${dateCheck.modelDate}; source text yields [${dateCheck.sourceDates.join(', ')}]`,
        },
      ];

  const failures = [...spanFailures, ...dateFailures];
  const ok = failures.length === 0;

  return {
    ok,
    failures,
    spanChecks,
    verifiedCitations: input.citations.map((c) => ({
      ...c,
      verifiedAt: ok ? input.now : null,
    })),
  };
};
