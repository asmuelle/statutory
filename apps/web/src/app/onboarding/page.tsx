import Link from 'next/link';

import {
  M1_COVERAGE_MANIFEST,
  checkJurisdictionSelection,
  checkPracticeAreaSelection,
  entitlementsFor,
  planById,
} from '@statutory/core';
import type { Jurisdiction, PlanId, PracticeArea } from '@statutory/core';

import { CoverageFooter } from '../../components/CoverageFooter';
import { UpgradePrompt } from '../../components/onboarding/UpgradePrompt';
import { WizardForm } from '../../components/onboarding/WizardForm';
import { getAccount } from '../account/session';
import { prefillFromSearchParams } from './urlState';
import type { OnboardingPrefill, OnboardingSearchParams } from './urlState';

/**
 * Practice-profile onboarding (M3): plan choice + jurisdictions + practice
 * areas + client types, validated server-side and entitlement-checked
 * against the chosen tier. Hitting a limit renders the upgrade prompt with
 * the user's selections preserved.
 */

export const dynamic = 'force-dynamic';

const isPlanId = (value: string): value is PlanId =>
  value === 'core' || value === 'practice-pro' || value === 'small-firm';

const promptMessage = (
  kind: 'jurisdiction' | 'specialty',
  prefill: OnboardingPrefill,
  addOnJurisdictions: number,
): string => {
  const planId: PlanId = isPlanId(prefill.planId) ? prefill.planId : 'core';
  if (kind === 'jurisdiction') {
    const check = checkJurisdictionSelection(
      planId,
      addOnJurisdictions,
      prefill.jurisdictions as readonly Jurisdiction[],
    );
    return check.allowed
      ? 'Your plan now covers this selection.'
      : `${planById(planId).label} covers ${check.limit} jurisdiction${check.limit === 1 ? '' : 's'} — you selected ${check.selected}. ${check.upgrade.message}`;
  }
  const check = checkPracticeAreaSelection(
    planId,
    prefill.practiceAreas as readonly PracticeArea[],
  );
  return check.allowed
    ? 'Your plan now covers this selection.'
    : `${planById(planId).label} covers a single specialty — you selected ${check.selected}. ${check.upgrade.message}`;
};

interface OnboardingPageProps {
  readonly searchParams: Promise<OnboardingSearchParams>;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const params = await searchParams;
  const account = await getAccount();
  const prefill = prefillFromSearchParams(params);

  const error = typeof params['error'] === 'string' ? params['error'] : '';
  const notice = typeof params['notice'] === 'string' ? params['notice'] : '';
  const promptParam = params['prompt'];
  const prompt =
    promptParam === 'jurisdiction' || promptParam === 'specialty' ? promptParam : null;

  const addOnJurisdictions = account?.addOnJurisdictions ?? 0;
  const jurisdictionLimit = entitlementsFor(
    isPlanId(prefill.planId) ? prefill.planId : 'core',
    addOnJurisdictions,
  ).jurisdictionLimit;

  return (
    <div className="page">
      <header className="masthead masthead-compact">
        <p className="masthead-kicker">
          <Link href="/">← Pipeline demo</Link>
        </p>
        <h1 className="masthead-brand">Set up your practice profile</h1>
        <p className="masthead-tagline">
          Five minutes of questions scope a living rulebook to exactly the rules you bill
          against — nothing broader than the coverage manifest below.
        </p>
      </header>

      <main>
        {error.length > 0 ? (
          <p className="review-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice === 'addon' ? (
          <p className="wizard-notice" data-testid="addon-notice" role="status">
            Jurisdiction add-on purchased — your plan now covers {jurisdictionLimit}{' '}
            jurisdictions. Complete onboarding below.
          </p>
        ) : null}
        {notice === 'upgraded' ? (
          <p className="wizard-notice" data-testid="upgrade-notice" role="status">
            You are on Practice Pro now. Complete onboarding below.
          </p>
        ) : null}

        {prompt !== null ? (
          <UpgradePrompt
            kind={prompt}
            message={promptMessage(prompt, prefill, addOnJurisdictions)}
            prefill={prefill}
          />
        ) : null}

        <WizardForm prefill={prefill} />
      </main>

      <CoverageFooter manifest={M1_COVERAGE_MANIFEST} />
    </div>
  );
}
