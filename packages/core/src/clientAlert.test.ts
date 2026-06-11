import { describe, expect, test } from 'vitest';

import {
  CLIENT_ALERT_TEMPLATE_COPY,
  ClientAlertError,
  buildClientAlert,
  renderClientAlertText,
  scanBannedClaims,
} from './clientAlert.js';
import { M1_COVERAGE_MANIFEST, NOT_LEGAL_ADVICE } from './coverage.js';
import { entitlementsFor } from './entitlements.js';
import type { Citation, Delta } from './types.js';

const VERIFIED_AT = '2024-07-01T06:05:00Z';
const PUBLISHED_AT = '2024-07-01T14:31:00Z';
const GENERATED_AT = '2026-06-10T09:00:00.000Z';

const citation = (overrides?: Partial<Citation>): Citation => ({
  citation: '29 CFR § 541.600',
  sectionVersionId: 'ver-2',
  quoteSpan: 'an amount per week of not less than $844',
  verifiedAt: VERIFIED_AT,
  ...overrides,
});

const publishedDelta = (overrides?: Partial<Delta>): Delta => ({
  id: 'delta-1',
  jurisdiction: 'us-federal',
  topic: 'exempt-status',
  changeEventIds: ['evt-1'],
  title: 'Exempt salary threshold rises to $844/week',
  bodyMd: 'The standard salary level rises.\n**Effective July 1, 2024**',
  effectiveDate: '2024-07-01',
  citations: [citation()],
  verificationStatus: 'verified',
  publishedAt: PUBLISHED_AT,
  ...overrides,
});

const buildInput = (overrides?: {
  readonly delta?: Delta;
  readonly variant?: 'standard' | 'white-label';
  readonly firmName?: string;
  readonly planId?: 'core' | 'practice-pro' | 'small-firm';
}) => ({
  delta: overrides?.delta ?? publishedDelta(),
  manifest: M1_COVERAGE_MANIFEST,
  entitlements: entitlementsFor(overrides?.planId ?? 'core', 0),
  options: {
    variant: overrides?.variant ?? ('standard' as const),
    ...(overrides?.firmName !== undefined ? { firmName: overrides.firmName } : {}),
  },
  generatedAt: GENERATED_AT,
});

describe('buildClientAlert — content derives ONLY from span-verified published deltas', () => {
  test('an unpublished delta can never become a client alert', () => {
    const input = buildInput({ delta: publishedDelta({ publishedAt: null }) });
    expect(() => buildClientAlert(input)).toThrow(ClientAlertError);
    expect(() => buildClientAlert(input)).toThrow(/not published/i);
  });

  test('a delta that is not gate-verified can never become a client alert', () => {
    const input = buildInput({
      delta: publishedDelta({ verificationStatus: 'blocked' }),
    });
    expect(() => buildClientAlert(input)).toThrow(/not gate-verified/i);
  });

  test('any citation without a verifiedAt stamp blocks the artifact (invariant 9)', () => {
    const input = buildInput({
      delta: publishedDelta({ citations: [citation(), citation({ verifiedAt: null })] }),
    });
    expect(() => buildClientAlert(input)).toThrow(/unverified citation/i);
  });

  test('a delta with zero citations blocks — exports carry their evidence', () => {
    const input = buildInput({ delta: publishedDelta({ citations: [] }) });
    expect(() => buildClientAlert(input)).toThrow(/citation/i);
  });

  test('body and footnotes are copied verbatim from the delta — nothing added', () => {
    const delta = publishedDelta();
    const artifact = buildClientAlert(buildInput({ delta }));
    expect(artifact.bodyMd).toBe(delta.bodyMd);
    expect(artifact.deltaTitle).toBe(delta.title);
    expect(artifact.effectiveDate).toBe(delta.effectiveDate);
    expect(artifact.footnotes).toHaveLength(delta.citations.length);
    const note = artifact.footnotes[0];
    expect(note?.citation).toBe('29 CFR § 541.600');
    expect(note?.quoteSpan).toBe(delta.citations[0]?.quoteSpan);
    expect(note?.effectiveDate).toBe(delta.effectiveDate);
    expect(note?.verifiedAt).toBe(VERIFIED_AT);
    expect(note?.index).toBe(1);
  });

  test('the not-legal-advice frame and coverage statement are always embedded', () => {
    const artifact = buildClientAlert(buildInput());
    expect(artifact.frame.notLegalAdvice).toBe(NOT_LEGAL_ADVICE);
    expect(artifact.frame.coverageStatement).toContain('NOT monitored');
  });
});

describe('white-label gating (Practice Pro and Small-firm only)', () => {
  test('core plan cannot generate a white-labeled alert', () => {
    const input = buildInput({ variant: 'white-label', firmName: 'Voss Law', planId: 'core' });
    expect(() => buildClientAlert(input)).toThrow(/white-label.*practice pro/i);
  });

  test('practice-pro produces firm letterhead branding', () => {
    const artifact = buildClientAlert(
      buildInput({ variant: 'white-label', firmName: 'Voss Law', planId: 'practice-pro' }),
    );
    expect(artifact.branding).toEqual({ variant: 'white-label', firmName: 'Voss Law' });
  });

  test('small-firm is also entitled to white-label', () => {
    const artifact = buildClientAlert(
      buildInput({ variant: 'white-label', firmName: 'Calloway CPA', planId: 'small-firm' }),
    );
    expect(artifact.branding.variant).toBe('white-label');
  });

  test('white-label without a firm name fails — letterhead must name the firm', () => {
    const input = buildInput({ variant: 'white-label', planId: 'practice-pro' });
    expect(() => buildClientAlert(input)).toThrow(/firm name/i);
  });

  test('standard variant carries Statutory branding on every plan', () => {
    const artifact = buildClientAlert(buildInput({ planId: 'core' }));
    expect(artifact.branding).toEqual({ variant: 'standard', productLine: 'Prepared with Statutory' });
  });
});

describe('renderClientAlertText (clipboard / plain-text export)', () => {
  test('renders title, body, numbered footnotes with effective dates, and the frame', () => {
    const text = renderClientAlertText(buildClientAlert(buildInput()));
    expect(text).toContain('Exempt salary threshold rises to $844/week');
    expect(text).toContain('[1] 29 CFR § 541.600');
    expect(text).toContain('effective 2024-07-01');
    expect(text).toContain(`span-verified ${VERIFIED_AT}`);
    expect(text).toContain(NOT_LEGAL_ADVICE);
    expect(text).toContain('NOT monitored');
  });

  test('white-label text leads with the firm letterhead, not Statutory', () => {
    const text = renderClientAlertText(
      buildClientAlert(
        buildInput({ variant: 'white-label', firmName: 'Voss Law', planId: 'practice-pro' }),
      ),
    );
    expect(text.startsWith('Voss Law')).toBe(true);
    expect(text).not.toContain('Prepared with Statutory');
  });
});

describe('banned-claims language scan', () => {
  test('the shipped template copy contains zero banned claims', () => {
    for (const [key, copy] of Object.entries(CLIENT_ALERT_TEMPLATE_COPY)) {
      expect(scanBannedClaims(copy), `template copy: ${key}`).toEqual([]);
    }
    expect(scanBannedClaims(NOT_LEGAL_ADVICE)).toEqual([]);
  });

  test('a full rendered artifact passes the scan end to end', () => {
    const text = renderClientAlertText(buildClientAlert(buildInput()));
    // Scan only the template-owned copy: delta body/title are attorney-reviewed
    // upstream; the scan guards the language WE wrap around them.
    expect(scanBannedClaims(text.replace(/\$844/g, ''))).toEqual([]);
  });

  test.each([
    'We guarantee compliance with the new rule.',
    'This update ensures compliance for your business.',
    'You are now fully compliant.',
    'You will never miss a regulatory change again.',
    'This alert covers all applicable laws.',
    'Comprehensive coverage of every change.',
    'No further action is required on your part.',
    'This constitutes legal advice tailored to you.',
    'Our monitoring eliminates risk entirely.',
  ])('flags banned promissory language: %s', (sample) => {
    const hits = scanBannedClaims(sample);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.match.length).toBeGreaterThan(0);
  });

  test('the phrase "not legal advice" is never a false positive', () => {
    expect(scanBannedClaims('This alert is an information service, not legal advice.')).toEqual(
      [],
    );
  });
});
