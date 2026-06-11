import type { OnboardingInput } from '../../lib/onboarding/schema';

/**
 * The wizard keeps in-flight selections in the URL across upgrade-prompt
 * round trips (blocked submit → prompt → add-on purchase → resubmit), so a
 * hit limit never throws the user's answers away. Values here are display
 * state only — every action re-validates through zod before acting.
 */

export type OnboardingSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export interface OnboardingPrefill {
  readonly displayName: string;
  readonly planId: string;
  readonly jurisdictions: readonly string[];
  readonly practiceAreas: readonly string[];
  readonly clientTypes: readonly string[];
  readonly firmName: string;
}

const single = (value: string | readonly string[] | undefined): string =>
  typeof value === 'string' ? value : '';

const list = (value: string | readonly string[] | undefined): readonly string[] => {
  if (value === undefined) {
    return [];
  }
  return typeof value === 'string' ? [value] : value;
};

export const prefillFromSearchParams = (params: OnboardingSearchParams): OnboardingPrefill => ({
  displayName: single(params['name']),
  planId: single(params['plan']) || 'core',
  jurisdictions: list(params['j']),
  practiceAreas: list(params['pa']),
  clientTypes: list(params['ct']),
  firmName: single(params['firm']),
});

/** Re-read prompt-form hidden fields (same names as the wizard inputs). */
export const prefillFromFormData = (formData: FormData): OnboardingPrefill => {
  const strings = (name: string): readonly string[] =>
    formData.getAll(name).filter((v): v is string => typeof v === 'string');
  return {
    displayName: strings('displayName')[0] ?? '',
    planId: strings('planId')[0] ?? 'core',
    jurisdictions: strings('jurisdictions'),
    practiceAreas: strings('practiceAreas'),
    clientTypes: strings('clientTypes'),
    firmName: strings('firmName')[0] ?? '',
  };
};

export const queryFromPrefill = (
  prefill: OnboardingPrefill,
  extra?: Readonly<Record<string, string>>,
): string => {
  const query = new URLSearchParams();
  query.set('name', prefill.displayName);
  query.set('plan', prefill.planId);
  for (const j of prefill.jurisdictions) {
    query.append('j', j);
  }
  for (const pa of prefill.practiceAreas) {
    query.append('pa', pa);
  }
  for (const ct of prefill.clientTypes) {
    query.append('ct', ct);
  }
  if (prefill.firmName.length > 0) {
    query.set('firm', prefill.firmName);
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    query.set(key, value);
  }
  return query.toString();
};

export const queryFromInput = (
  value: OnboardingInput,
  extra?: Readonly<Record<string, string>>,
): string =>
  queryFromPrefill(
    {
      displayName: value.displayName,
      planId: value.planId,
      jurisdictions: value.selection.jurisdictions,
      practiceAreas: value.selection.practiceAreas,
      clientTypes: value.selection.clientTypes,
      firmName: value.firmName,
    },
    extra,
  );
