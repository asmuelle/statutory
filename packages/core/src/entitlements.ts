import type { Jurisdiction, PracticeArea } from './types.js';

/**
 * Plan definitions and limit enforcement (M3). Pricing follows the
 * analyst-corrected structure in README/DESIGN: Core $49/mo (1 jurisdiction
 * bundle, unlimited client-alert drafts), Practice Pro $99/mo
 * (multi-specialty, effective-date history exports, white-labeled client
 * alerts), Small-firm $149/mo (3 seats, shared rulebook); annual billing is
 * the default everywhere; added jurisdictions are $19/mo each on any plan.
 * Pure deterministic logic — no IO, no billing SDK (invariant 6 ethos).
 */

export type PlanId = 'core' | 'practice-pro' | 'small-firm';

export type BillingInterval = 'monthly' | 'annual';

export interface PlanDefinition {
  readonly id: PlanId;
  readonly label: string;
  readonly monthlyPriceCents: number;
  readonly annualPriceCents: number;
  readonly defaultInterval: BillingInterval;
  /** Jurisdiction bundles included before paid add-ons. */
  readonly includedJurisdictions: number;
  readonly seats: number;
  readonly multiSpecialty: boolean;
  readonly whiteLabelAlerts: boolean;
  readonly historyExports: boolean;
  readonly sharedRulebook: boolean;
  readonly unlimitedClientAlertDrafts: boolean;
}

/** $19/mo per added jurisdiction — the NRR engine (README pricing analysis). */
export const JURISDICTION_ADDON_MONTHLY_CENTS = 1900;

const MONTHS_PER_YEAR = 12;

const plan = (
  input: Omit<PlanDefinition, 'annualPriceCents' | 'defaultInterval'>,
): PlanDefinition =>
  Object.freeze({
    ...input,
    annualPriceCents: input.monthlyPriceCents * MONTHS_PER_YEAR,
    defaultInterval: 'annual' as const,
  });

export const PLANS: readonly PlanDefinition[] = Object.freeze([
  plan({
    id: 'core',
    label: 'Core',
    monthlyPriceCents: 4900,
    includedJurisdictions: 1,
    seats: 1,
    multiSpecialty: false,
    whiteLabelAlerts: false,
    historyExports: false,
    sharedRulebook: false,
    unlimitedClientAlertDrafts: true,
  }),
  plan({
    id: 'practice-pro',
    label: 'Practice Pro',
    monthlyPriceCents: 9900,
    includedJurisdictions: 1,
    seats: 1,
    multiSpecialty: true,
    whiteLabelAlerts: true,
    historyExports: true,
    sharedRulebook: false,
    unlimitedClientAlertDrafts: true,
  }),
  plan({
    id: 'small-firm',
    label: 'Small-firm',
    monthlyPriceCents: 14900,
    includedJurisdictions: 1,
    seats: 3,
    multiSpecialty: true,
    whiteLabelAlerts: true,
    historyExports: true,
    sharedRulebook: true,
    unlimitedClientAlertDrafts: true,
  }),
]);

/** Look up a plan definition by id; unknown ids are a programming error. */
export const planById = (id: PlanId): PlanDefinition => {
  const found = PLANS.find((p) => p.id === id);
  if (found === undefined) {
    throw new Error(`Unknown plan id: ${id}`);
  }
  return found;
};

/** A suggested path out of a hit limit, rendered by upgrade prompts. */
export type UpgradeSuggestion =
  | {
      readonly kind: 'jurisdiction_addon';
      readonly message: string;
      readonly addOnMonthlyCents: number;
    }
  | {
      readonly kind: 'plan_upgrade';
      readonly message: string;
      readonly targetPlanId: PlanId;
    }
  | {
      readonly kind: 'contact';
      readonly message: string;
    };

export type LimitCheck =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly limit: number;
      readonly selected: number;
      readonly upgrade: UpgradeSuggestion;
    };

/** Enforce the jurisdiction-bundle count: plan allowance + purchased add-ons. */
export const checkJurisdictionSelection = (
  planId: PlanId,
  addOnJurisdictions: number,
  selection: readonly Jurisdiction[],
): LimitCheck => {
  const limit = planById(planId).includedJurisdictions + Math.max(0, addOnJurisdictions);
  if (selection.length <= limit) {
    return { allowed: true };
  }
  return {
    allowed: false,
    limit,
    selected: selection.length,
    upgrade: {
      kind: 'jurisdiction_addon',
      message: `Your plan covers ${limit} jurisdiction${limit === 1 ? '' : 's'}. Add another jurisdiction bundle for $19/mo.`,
      addOnMonthlyCents: JURISDICTION_ADDON_MONTHLY_CENTS,
    },
  };
};

/** Enforce single-specialty on Core; Pro and Small-firm are multi-specialty. */
export const checkPracticeAreaSelection = (
  planId: PlanId,
  selection: readonly PracticeArea[],
): LimitCheck => {
  const definition = planById(planId);
  if (definition.multiSpecialty || selection.length <= 1) {
    return { allowed: true };
  }
  return {
    allowed: false,
    limit: 1,
    selected: selection.length,
    upgrade: {
      kind: 'plan_upgrade',
      message: 'Multi-specialty coverage is a Practice Pro feature ($99/mo, annual default).',
      targetPlanId: 'practice-pro',
    },
  };
};

/** Enforce the seat limit (Small-firm: 3 seats, shared rulebook). */
export const checkSeatCount = (planId: PlanId, seats: number): LimitCheck => {
  const limit = planById(planId).seats;
  if (seats >= 1 && seats <= limit) {
    return { allowed: true };
  }
  const upgrade: UpgradeSuggestion =
    planId === 'small-firm'
      ? { kind: 'contact', message: 'More than 3 seats needs a firm plan — contact us.' }
      : {
          kind: 'plan_upgrade',
          message: 'Multiple seats with a shared rulebook is the Small-firm plan ($149/mo).',
          targetPlanId: 'small-firm',
        };
  return { allowed: false, limit, selected: seats, upgrade };
};

/** The effective entitlements of an account: plan flags + add-on allowance. */
export interface Entitlements {
  readonly planId: PlanId;
  readonly jurisdictionLimit: number;
  readonly seats: number;
  readonly multiSpecialty: boolean;
  readonly whiteLabelAlerts: boolean;
  readonly historyExports: boolean;
  readonly unlimitedClientAlertDrafts: boolean;
}

/** Derive effective entitlements from a plan and purchased add-ons. */
export const entitlementsFor = (planId: PlanId, addOnJurisdictions: number): Entitlements => {
  if (!Number.isInteger(addOnJurisdictions) || addOnJurisdictions < 0) {
    throw new Error(`Invalid jurisdiction add-on count: ${addOnJurisdictions}`);
  }
  const definition = planById(planId);
  return {
    planId,
    jurisdictionLimit: definition.includedJurisdictions + addOnJurisdictions,
    seats: definition.seats,
    multiSpecialty: definition.multiSpecialty,
    whiteLabelAlerts: definition.whiteLabelAlerts,
    historyExports: definition.historyExports,
    unlimitedClientAlertDrafts: definition.unlimitedClientAlertDrafts,
  };
};
