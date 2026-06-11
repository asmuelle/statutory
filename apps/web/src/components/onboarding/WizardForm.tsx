import {
  CLIENT_TYPE_OPTIONS,
  JURISDICTION_OPTIONS,
  PLANS,
  PRACTICE_AREA_OPTIONS,
} from '@statutory/core';
import type { PlanDefinition } from '@statutory/core';

import { completeOnboardingAction } from '../../app/onboarding/actions';
import type { OnboardingPrefill } from '../../app/onboarding/urlState';

/**
 * The practice-profile wizard (M3). One server-rendered form, four numbered
 * steps; selections survive upgrade-prompt round trips via URL prefill.
 * Validation runs server-side (zod) — limits are enforced in the action,
 * never trusted to the client.
 */

const planFeatureLine = (plan: PlanDefinition): string => {
  const features = [
    `${plan.includedJurisdictions} jurisdiction bundle${plan.includedJurisdictions === 1 ? '' : 's'}`,
    plan.multiSpecialty ? 'multi-specialty' : 'single specialty',
    `${plan.seats} seat${plan.seats === 1 ? '' : 's'}`,
  ];
  if (plan.whiteLabelAlerts) {
    features.push('white-labeled client alerts');
  }
  if (plan.historyExports) {
    features.push('effective-date history exports');
  }
  if (plan.sharedRulebook) {
    features.push('shared rulebook');
  }
  return features.join(' · ');
};

interface WizardFormProps {
  readonly prefill: OnboardingPrefill;
}

export function WizardForm({ prefill }: WizardFormProps) {
  return (
    <form action={completeOnboardingAction} className="wizard" data-testid="onboarding-wizard">
      <fieldset className="wizard-step">
        <legend>
          <span className="wizard-step-number">Step 1</span> Choose your plan
        </legend>
        <p className="wizard-hint">Annual billing is the default on every plan.</p>
        <div className="plan-grid">
          {PLANS.map((plan) => (
            <label key={plan.id} className="plan-card" htmlFor={`plan-${plan.id}`}>
              <input
                type="radio"
                id={`plan-${plan.id}`}
                name="planId"
                value={plan.id}
                defaultChecked={prefill.planId === plan.id}
                required
              />
              <span className="plan-name">{plan.label}</span>
              <span className="plan-price">
                ${plan.monthlyPriceCents / 100}/mo
                <span className="plan-interval"> · billed annually</span>
              </span>
              <span className="plan-features">{planFeatureLine(plan)}</span>
            </label>
          ))}
        </div>
        <p className="wizard-hint">Added jurisdictions: $19/mo each, on any plan.</p>
      </fieldset>

      <fieldset className="wizard-step">
        <legend>
          <span className="wizard-step-number">Step 2</span> Jurisdictions you practice in
        </legend>
        <div className="option-grid">
          {JURISDICTION_OPTIONS.map((option) => (
            <label key={option.id} className="option-check" htmlFor={`j-${option.id}`}>
              <input
                type="checkbox"
                id={`j-${option.id}`}
                name="jurisdictions"
                value={option.id}
                defaultChecked={prefill.jurisdictions.includes(option.id)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="wizard-step">
        <legend>
          <span className="wizard-step-number">Step 3</span> Practice areas
        </legend>
        <div className="option-grid">
          {PRACTICE_AREA_OPTIONS.map((option) => (
            <label key={option.id} className="option-check" htmlFor={`pa-${option.id}`}>
              <input
                type="checkbox"
                id={`pa-${option.id}`}
                name="practiceAreas"
                value={option.id}
                defaultChecked={prefill.practiceAreas.includes(option.id)}
              />
              {option.label}
            </label>
          ))}
        </div>
        <p className="wizard-hint">Multi-specialty coverage needs Practice Pro or Small-firm.</p>
      </fieldset>

      <fieldset className="wizard-step">
        <legend>
          <span className="wizard-step-number">Step 4</span> Clients and letterhead
        </legend>
        <div className="option-grid">
          {CLIENT_TYPE_OPTIONS.map((option) => (
            <label key={option.id} className="option-check" htmlFor={`ct-${option.id}`}>
              <input
                type="checkbox"
                id={`ct-${option.id}`}
                name="clientTypes"
                value={option.id}
                defaultChecked={prefill.clientTypes.includes(option.id)}
              />
              {option.label}
            </label>
          ))}
        </div>
        <div className="wizard-text-fields">
          <label htmlFor="displayName">Your name</label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            required
            minLength={2}
            maxLength={80}
            defaultValue={prefill.displayName}
            placeholder="e.g. Maren Voss"
            autoComplete="name"
          />
          <label htmlFor="firmName">Firm name (optional)</label>
          <input
            id="firmName"
            name="firmName"
            type="text"
            maxLength={120}
            defaultValue={prefill.firmName}
            placeholder="Used for white-labeled client alerts (Practice Pro)"
          />
        </div>
      </fieldset>

      <button type="submit" className="btn btn-primary wizard-submit">
        Complete onboarding
      </button>
    </form>
  );
}
