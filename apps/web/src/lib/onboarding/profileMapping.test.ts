import { buildPracticeProfile, scopeRulebook } from '@statutory/core';
import { runDolOvertimeScenario } from '@statutory/pipeline';
import { describe, expect, test } from 'vitest';

import { parseOnboardingForm } from './schema';

/**
 * Profile-to-rule-mapping integration: a wizard submission flows through
 * zod validation -> buildPracticeProfile -> the EXISTING profile-matching
 * pipeline, scoping the fixture-replayed rulebook and published delta feed.
 */

const wizardForm = (practiceArea: string): FormData => {
  const data = new FormData();
  data.append('displayName', 'Integration Tester');
  data.append('planId', 'core');
  data.append('jurisdictions', 'us-federal');
  data.append('practiceAreas', practiceArea);
  data.append('clientTypes', 'small-business');
  data.append('firmName', '');
  return data;
};

describe('onboarding -> existing profile-matching pipeline', () => {
  test('a federal employment profile is scoped to the amended rulebook and receives the delta', async () => {
    const parsed = parseOnboardingForm(wizardForm('employment'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const profile = buildPracticeProfile({
      id: 'profile-int-1',
      name: parsed.value.displayName,
      selection: parsed.value.selection,
    });

    const scenario = await runDolOvertimeScenario();
    const scoped = scopeRulebook(
      profile,
      scenario.rulebookSection.section !== undefined ? [scenario.rulebookSection.section] : [],
      [scenario.publishedDelta],
    );

    expect(scoped.sections.map((s) => s.citation)).toEqual(['29 CFR § 541.600']);
    expect(scoped.deltas.map((d) => d.id)).toEqual([scenario.publishedDelta.id]);
    expect(scoped.deltas[0]?.publishedAt).not.toBeNull();
  });

  test('a tax-only profile sees an empty scoped rulebook — never a partial leak', async () => {
    const parsed = parseOnboardingForm(wizardForm('tax'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const profile = buildPracticeProfile({
      id: 'profile-int-2',
      name: parsed.value.displayName,
      selection: parsed.value.selection,
    });

    const scenario = await runDolOvertimeScenario();
    const scoped = scopeRulebook(
      profile,
      [scenario.rulebookSection.section],
      [scenario.publishedDelta],
    );

    expect(scoped.sections).toEqual([]);
    expect(scoped.deltas).toEqual([]);
  });
});
