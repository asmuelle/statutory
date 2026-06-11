import { describe, expect, test } from 'vitest';

import { runDolOvertimeScenario } from './scenario.js';

/**
 * M1 acceptance (DESIGN.md): replaying the 2024 DOL exempt-salary-threshold
 * amendment through the pipeline from archived fixtures produces a published,
 * span-verified delta with the correct effective dates; an unchanged re-crawl
 * produces zero LLM calls and zero events.
 */
describe('M1 acceptance: 2024 DOL amendment replay', () => {
  test('produces a published, span-verified delta with the correct effective date', async () => {
    // Act
    const result = await runDolOvertimeScenario();

    // Assert
    expect(result.publishedDelta.publishedAt).not.toBeNull();
    expect(result.publishedDelta.effectiveDate).toBe('2024-07-01');
    expect(result.publishedDelta.verificationStatus).toBe('verified');
    expect(result.publishedDelta.citations.length).toBeGreaterThan(0);
    expect(result.publishedDelta.citations.every((c) => c.verifiedAt !== null)).toBe(true);
    expect(result.gate.ok).toBe(true);
  });

  test('an unchanged re-crawl produces zero LLM calls and zero change events', async () => {
    // Act
    const result = await runDolOvertimeScenario();

    // Assert — the invariant-1 product proof
    expect(result.recrawlReport.changeEvents).toHaveLength(0);
    expect(result.recrawlReport.unchanged).toBe(4);
    expect(result.recrawlLlmCalls).toBe(0);
  });

  test('synthesis ran exactly once for the jurisdiction-topic (author once, fan out)', async () => {
    // Act
    const result = await runDolOvertimeScenario();

    // Assert
    expect(result.modelUsage.synthesisCalls).toBe(1);
    expect(result.modelUsage.triageCalls).toBe(1);
    expect(result.modelUsage.mode).toBe('mock');
  });

  test('deliveries reach exactly the employment profiles, not the tax CPA', async () => {
    // Act
    const result = await runDolOvertimeScenario();
    const deliveredTo = [...new Set(result.deliveries.map((d) => d.profileId))];

    // Assert
    expect(deliveredTo.sort()).toEqual(['profile-demo-ca', 'profile-demo-ny']);
  });

  test('the rulebook section carries full version history with a redline diff', async () => {
    // Act
    const { rulebookSection } = await runDolOvertimeScenario();

    // Assert
    expect(rulebookSection.versions).toHaveLength(2);
    expect(rulebookSection.versions[0]?.normalizedText).toContain('$684 per week');
    expect(rulebookSection.currentVersion.normalizedText).toContain('$844 per week');
    expect(rulebookSection.currentVersion.supersedesVersionId).toBe(rulebookSection.versions[0]?.id);
    expect(rulebookSection.redline.removedParagraphs.length).toBeGreaterThan(0);
    expect(rulebookSection.redline.addedParagraphs.length).toBeGreaterThan(0);
  });

  test('the email alert carries citations, effective date, coverage honesty, and not-legal-advice framing', async () => {
    // Act
    const { emailAlert } = await runDolOvertimeScenario();

    // Assert
    expect(emailAlert.subject).toContain('29 CFR § 541.600');
    expect(emailAlert.body).toContain('Effective date: 2024-07-01');
    expect(emailAlert.body).toContain('span-verified');
    expect(emailAlert.body).toContain('NOT monitored:');
    expect(emailAlert.body).toMatch(/not legal advice/i);
  });

  test('the review trail shows gate pass then attorney approval', async () => {
    // Act
    const { reviewTrail } = await runDolOvertimeScenario();

    // Assert
    expect(reviewTrail.map((r) => [r.reviewerId, r.status])).toEqual([
      ['system-gate', 'pending'],
      ['reviewer-demo-attorney', 'approved'],
    ]);
  });

  test('every quoted span is verbatim text from the stored new version', async () => {
    // Act
    const result = await runDolOvertimeScenario();
    const { publishedDelta, rulebookSection } = result;

    // Assert — citation/span pinning: quote is a substring of the pinned version
    for (const citation of publishedDelta.citations) {
      expect(citation.sectionVersionId).toBe(rulebookSection.currentVersion.id);
      expect(rulebookSection.currentVersion.normalizedText).toContain(citation.quoteSpan);
    }
  });

  test('the scenario is deterministic across runs', async () => {
    // Act
    const a = await runDolOvertimeScenario();
    const b = await runDolOvertimeScenario();

    // Assert
    expect(a.publishedDelta).toEqual(b.publishedDelta);
    expect(a.emailAlert).toEqual(b.emailAlert);
  });
});
