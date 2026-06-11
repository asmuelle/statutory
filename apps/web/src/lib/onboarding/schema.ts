import { JURISDICTION_OPTIONS, PLANS, PRACTICE_AREA_OPTIONS } from '@statutory/core';
import type { Jurisdiction, PlanId, PracticeArea, WizardSelection } from '@statutory/core';
import { z } from 'zod';

/**
 * Boundary validation for the practice-profile wizard (M3). FormData from
 * the server action is parsed with zod before ANY entitlement check or
 * profile build runs — external input is never trusted (AGENTS.md).
 */

const jurisdictionIds = JURISDICTION_OPTIONS.map((o) => o.id);
const practiceAreaIds = PRACTICE_AREA_OPTIONS.map((o) => o.id);
const planIds = PLANS.map((p) => p.id);

const isJurisdiction = (value: string): value is Jurisdiction =>
  (jurisdictionIds as readonly string[]).includes(value);
const isPracticeArea = (value: string): value is PracticeArea =>
  (practiceAreaIds as readonly string[]).includes(value);
const isPlanId = (value: string): value is PlanId =>
  (planIds as readonly string[]).includes(value);

const onboardingSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'Tell us your name (at least 2 characters).')
    .max(80, 'Name is limited to 80 characters.'),
  planId: z.string().refine(isPlanId, 'Choose one of the three plans.'),
  jurisdictions: z
    .array(z.string().refine(isJurisdiction, 'Unknown jurisdiction.'))
    .min(1, 'Select at least one jurisdiction.'),
  practiceAreas: z
    .array(z.string().refine(isPracticeArea, 'Unknown practice area.'))
    .min(1, 'Select at least one practice area.'),
  clientTypes: z
    .array(z.string().trim().min(1).max(40))
    .min(1, 'Select at least one client type.'),
  firmName: z.string().trim().max(120, 'Firm name is limited to 120 characters.'),
});

export interface OnboardingInput {
  readonly displayName: string;
  readonly planId: PlanId;
  readonly selection: WizardSelection;
  readonly firmName: string;
}

export type OnboardingParseResult =
  | { readonly ok: true; readonly value: OnboardingInput }
  | { readonly ok: false; readonly message: string };

/** Parse + validate the wizard form. Never throws; failures carry a message. */
export const parseOnboardingForm = (formData: FormData): OnboardingParseResult => {
  const stringField = (name: string): string => {
    const value = formData.get(name);
    return typeof value === 'string' ? value : '';
  };
  const stringList = (name: string): readonly string[] =>
    formData.getAll(name).filter((v): v is string => typeof v === 'string');

  const parsed = onboardingSchema.safeParse({
    displayName: stringField('displayName'),
    planId: stringField('planId'),
    jurisdictions: stringList('jurisdictions'),
    practiceAreas: stringList('practiceAreas'),
    clientTypes: stringList('clientTypes'),
    firmName: stringField('firmName'),
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, message: first?.message ?? 'Invalid onboarding input.' };
  }

  // The refinements above guarantee these narrowings.
  const jurisdictions = parsed.data.jurisdictions.filter(isJurisdiction);
  const practiceAreas = parsed.data.practiceAreas.filter(isPracticeArea);
  const planId = parsed.data.planId;
  if (!isPlanId(planId)) {
    return { ok: false, message: 'Choose one of the three plans.' };
  }

  return {
    ok: true,
    value: {
      displayName: parsed.data.displayName,
      planId,
      selection: {
        jurisdictions,
        practiceAreas,
        clientTypes: parsed.data.clientTypes,
      },
      firmName: parsed.data.firmName,
    },
  };
};
