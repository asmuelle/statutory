import { renderCoverageStatement, NOT_LEGAL_ADVICE } from './coverage.js';
import type { Entitlements } from './entitlements.js';
import type { CoverageManifest, Delta } from './types.js';

/**
 * The client-alert artifact (M3) — the billable output. An alert draft can
 * only be generated from a PUBLISHED, gate-verified delta whose every
 * citation carries a verifiedAt stamp (invariant 9: exports carry their
 * evidence; an export without verified citations must be impossible).
 * White-label letterhead is gated to Practice Pro and Small-firm.
 *
 * The template copy we wrap around the attorney-reviewed delta body is
 * scanned for banned promissory language — "guaranteed compliance"-class
 * claims are a malpractice trap and never ship.
 */

export class ClientAlertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientAlertError';
  }
}

export interface ClientAlertFootnote {
  readonly index: number;
  readonly citation: string;
  readonly quoteSpan: string;
  readonly sectionVersionId: string;
  readonly effectiveDate: string;
  readonly verifiedAt: string;
}

export type ClientAlertBranding =
  | { readonly variant: 'standard'; readonly productLine: string }
  | { readonly variant: 'white-label'; readonly firmName: string };

export interface ClientAlertArtifact {
  readonly deltaId: string;
  readonly deltaTitle: string;
  readonly effectiveDate: string;
  readonly bodyMd: string;
  readonly footnotes: readonly ClientAlertFootnote[];
  readonly frame: {
    readonly notLegalAdvice: string;
    readonly coverageStatement: string;
  };
  readonly branding: ClientAlertBranding;
  readonly generatedAt: string;
}

/** Every fixed string the template wraps around the reviewed delta body. */
export const CLIENT_ALERT_TEMPLATE_COPY = {
  headline: 'Client alert',
  intro:
    'A monitored source in your rulebook changed. The summary below was ' +
    'span-verified against the primary source and approved in attorney review ' +
    'before publication.',
  footnoteHeading: 'Citations and verbatim source spans',
  coverageHeading: 'Scope of monitoring',
  closing: 'Review the cited sections with your professional adviser before acting on them.',
  productLine: 'Prepared with Statutory',
} as const;

export interface ClientAlertOptions {
  readonly variant: 'standard' | 'white-label';
  readonly firmName?: string;
}

export interface BuildClientAlertInput {
  readonly delta: Delta;
  readonly manifest: CoverageManifest;
  readonly entitlements: Pick<Entitlements, 'whiteLabelAlerts'>;
  readonly options: ClientAlertOptions;
  readonly generatedAt: string;
}

const assertExportable = (delta: Delta): void => {
  if (delta.publishedAt === null) {
    throw new ClientAlertError(
      `Delta ${delta.id} is not published — client alerts derive only from published deltas.`,
    );
  }
  if (delta.verificationStatus !== 'verified') {
    throw new ClientAlertError(
      `Delta ${delta.id} is not gate-verified ('${delta.verificationStatus}') — no alert may be drafted.`,
    );
  }
  if (delta.citations.length === 0) {
    throw new ClientAlertError(
      `Delta ${delta.id} carries no citations — exports must carry their evidence.`,
    );
  }
  const unverified = delta.citations.filter((c) => c.verifiedAt === null);
  if (unverified.length > 0) {
    throw new ClientAlertError(
      `Delta ${delta.id} has ${unverified.length} unverified citation(s) — export impossible.`,
    );
  }
};

const resolveBranding = (input: BuildClientAlertInput): ClientAlertBranding => {
  if (input.options.variant === 'standard') {
    return { variant: 'standard', productLine: CLIENT_ALERT_TEMPLATE_COPY.productLine };
  }
  if (!input.entitlements.whiteLabelAlerts) {
    throw new ClientAlertError(
      'White-label client alerts are a Practice Pro feature — upgrade to remove Statutory branding.',
    );
  }
  const firmName = input.options.firmName?.trim() ?? '';
  if (firmName.length === 0) {
    throw new ClientAlertError('White-label letterhead needs a firm name — none is configured.');
  }
  return { variant: 'white-label', firmName };
};

/** Build the client-alert draft from a published, span-verified delta. */
export const buildClientAlert = (input: BuildClientAlertInput): ClientAlertArtifact => {
  assertExportable(input.delta);
  const branding = resolveBranding(input);

  return {
    deltaId: input.delta.id,
    deltaTitle: input.delta.title,
    effectiveDate: input.delta.effectiveDate,
    bodyMd: input.delta.bodyMd,
    footnotes: input.delta.citations.map((c, i) => ({
      index: i + 1,
      citation: c.citation,
      quoteSpan: c.quoteSpan,
      sectionVersionId: c.sectionVersionId,
      effectiveDate: input.delta.effectiveDate,
      // assertExportable guarantees the stamp; '' is unreachable.
      verifiedAt: c.verifiedAt ?? '',
    })),
    frame: {
      notLegalAdvice: NOT_LEGAL_ADVICE,
      coverageStatement: renderCoverageStatement(input.manifest),
    },
    branding,
    generatedAt: input.generatedAt,
  };
};

/** Plain-text rendering for copy-to-clipboard and email paste. */
export const renderClientAlertText = (artifact: ClientAlertArtifact): string => {
  const letterhead =
    artifact.branding.variant === 'white-label'
      ? artifact.branding.firmName
      : CLIENT_ALERT_TEMPLATE_COPY.headline.toUpperCase();
  const byline =
    artifact.branding.variant === 'white-label' ? [] : [CLIENT_ALERT_TEMPLATE_COPY.productLine];

  const footnotes = artifact.footnotes.map(
    (f) =>
      `[${f.index}] ${f.citation} — "${f.quoteSpan}" (effective ${f.effectiveDate}; span-verified ${f.verifiedAt})`,
  );

  return [
    letterhead,
    artifact.branding.variant === 'white-label' ? CLIENT_ALERT_TEMPLATE_COPY.headline : '',
    '',
    artifact.deltaTitle,
    `Effective date: ${artifact.effectiveDate}`,
    '',
    CLIENT_ALERT_TEMPLATE_COPY.intro,
    '',
    artifact.bodyMd,
    '',
    `${CLIENT_ALERT_TEMPLATE_COPY.footnoteHeading}:`,
    ...footnotes,
    '',
    `${CLIENT_ALERT_TEMPLATE_COPY.coverageHeading}: ${artifact.frame.coverageStatement}`,
    '',
    CLIENT_ALERT_TEMPLATE_COPY.closing,
    artifact.frame.notLegalAdvice,
    ...byline,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/** Promissory/guarantee language that must never appear in template copy. */
const BANNED_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bguarantee[sd]?\b/i,
  /\bensures?\s+compliance\b/i,
  /\bfully\s+compliant\b/i,
  /\bnever\s+miss\b/i,
  /\ball\s+applicable\s+(?:laws|regulations|rules|changes)\b/i,
  /\bcomprehensive\s+coverage\b/i,
  /\bevery\s+(?:change|law|regulation|update)\b/i,
  /\bno\s+(?:further\s+)?action\s+(?:is\s+)?(?:required|needed)\b/i,
  /\b(?:is|constitutes)\s+legal\s+advice\b/i,
  /\beliminates?\s+(?:all\s+)?risk\b/i,
  /\baudit-proof\b/i,
  /\bcourt-proof\b/i,
];

export interface BannedClaimHit {
  readonly pattern: string;
  readonly match: string;
  readonly index: number;
}

/** Scan text for banned promissory claims; an empty array means clean. */
export const scanBannedClaims = (text: string): readonly BannedClaimHit[] =>
  BANNED_CLAIM_PATTERNS.flatMap((pattern) => {
    const match = pattern.exec(text);
    return match === null
      ? []
      : [{ pattern: pattern.source, match: match[0], index: match.index }];
  });
