import { describe, expect, test } from 'vitest';

import {
  JURISDICTION_ADDON_MONTHLY_CENTS,
  PLANS,
  checkJurisdictionSelection,
  checkPracticeAreaSelection,
  checkSeatCount,
  entitlementsFor,
  planById,
} from './entitlements.js';

describe('plan definitions (analyst-corrected pricing)', () => {
  test('defines exactly the three tiers at $49 / $99 / $149 per month', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['core', 'practice-pro', 'small-firm']);
    expect(planById('core').monthlyPriceCents).toBe(4900);
    expect(planById('practice-pro').monthlyPriceCents).toBe(9900);
    expect(planById('small-firm').monthlyPriceCents).toBe(14900);
  });

  test('annual billing is the default interval on every plan', () => {
    for (const plan of PLANS) {
      expect(plan.defaultInterval).toBe('annual');
      expect(plan.annualPriceCents).toBe(plan.monthlyPriceCents * 12);
    }
  });

  test('jurisdiction add-ons cost $19/mo and are available on every plan', () => {
    expect(JURISDICTION_ADDON_MONTHLY_CENTS).toBe(1900);
  });

  test('core: 1 jurisdiction bundle, 1 seat, single specialty, unlimited drafts', () => {
    const core = planById('core');
    expect(core.includedJurisdictions).toBe(1);
    expect(core.seats).toBe(1);
    expect(core.multiSpecialty).toBe(false);
    expect(core.whiteLabelAlerts).toBe(false);
    expect(core.historyExports).toBe(false);
    expect(core.unlimitedClientAlertDrafts).toBe(true);
  });

  test('practice-pro: multi-specialty, history exports, white-labeled alerts', () => {
    const pro = planById('practice-pro');
    expect(pro.multiSpecialty).toBe(true);
    expect(pro.whiteLabelAlerts).toBe(true);
    expect(pro.historyExports).toBe(true);
    expect(pro.seats).toBe(1);
  });

  test('small-firm: 3 seats and a shared rulebook', () => {
    const firm = planById('small-firm');
    expect(firm.seats).toBe(3);
    expect(firm.sharedRulebook).toBe(true);
    expect(firm.multiSpecialty).toBe(true);
  });
});

describe('jurisdiction-bundle limit enforcement', () => {
  test('core allows exactly one jurisdiction without add-ons', () => {
    const result = checkJurisdictionSelection('core', 0, ['us-federal']);
    expect(result.allowed).toBe(true);
  });

  test('a second jurisdiction on core exceeds the limit and suggests the add-on', () => {
    const result = checkJurisdictionSelection('core', 0, ['us-federal', 'us-ca']);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.limit).toBe(1);
      expect(result.selected).toBe(2);
      expect(result.upgrade.kind).toBe('jurisdiction_addon');
      expect(result.upgrade.message).toMatch(/\$19\/mo/);
    }
  });

  test('purchased add-ons raise the limit', () => {
    const result = checkJurisdictionSelection('core', 1, ['us-federal', 'us-ca']);
    expect(result.allowed).toBe(true);
  });

  test('limits never mutate the selection input', () => {
    const selection = Object.freeze(['us-federal', 'us-ca'] as const);
    expect(() => checkJurisdictionSelection('core', 0, selection)).not.toThrow();
  });
});

describe('multi-specialty limit enforcement', () => {
  test('core allows a single practice area', () => {
    expect(checkPracticeAreaSelection('core', ['employment']).allowed).toBe(true);
  });

  test('two practice areas on core suggests upgrading to Practice Pro', () => {
    const result = checkPracticeAreaSelection('core', ['employment', 'tax']);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.upgrade.kind).toBe('plan_upgrade');
      if (result.upgrade.kind === 'plan_upgrade') {
        expect(result.upgrade.targetPlanId).toBe('practice-pro');
      }
    }
  });

  test('practice-pro and small-firm allow multiple practice areas', () => {
    expect(checkPracticeAreaSelection('practice-pro', ['employment', 'tax']).allowed).toBe(true);
    expect(
      checkPracticeAreaSelection('small-firm', ['employment', 'tax', 'real-estate']).allowed,
    ).toBe(true);
  });
});

describe('seat limit enforcement', () => {
  test('core and practice-pro are single-seat', () => {
    expect(checkSeatCount('core', 1).allowed).toBe(true);
    expect(checkSeatCount('core', 2).allowed).toBe(false);
    expect(checkSeatCount('practice-pro', 2).allowed).toBe(false);
  });

  test('small-firm allows up to 3 seats; a 4th suggests contacting sales', () => {
    expect(checkSeatCount('small-firm', 3).allowed).toBe(true);
    const result = checkSeatCount('small-firm', 4);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.limit).toBe(3);
    }
  });

  test('a non-positive seat count is rejected', () => {
    expect(checkSeatCount('core', 0).allowed).toBe(false);
  });
});

describe('entitlementsFor', () => {
  test('derives flags and effective jurisdiction limit from plan + add-ons', () => {
    const e = entitlementsFor('core', 2);
    expect(e.jurisdictionLimit).toBe(3);
    expect(e.whiteLabelAlerts).toBe(false);
    expect(e.historyExports).toBe(false);
    expect(e.seats).toBe(1);

    const pro = entitlementsFor('practice-pro', 0);
    expect(pro.whiteLabelAlerts).toBe(true);
    expect(pro.historyExports).toBe(true);
  });

  test('negative add-on counts are rejected at the boundary', () => {
    expect(() => entitlementsFor('core', -1)).toThrow(/add-on/i);
  });
});
