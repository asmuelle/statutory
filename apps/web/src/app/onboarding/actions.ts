'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  buildPracticeProfile,
  checkJurisdictionSelection,
  checkPracticeAreaSelection,
  planById,
} from '@statutory/core';

import { parseOnboardingForm } from '../../lib/onboarding/schema';
import { ensureAccount, getBillingSelection, updateAccount } from '../account/session';
import { prefillFromFormData, queryFromInput, queryFromPrefill } from './urlState';

/**
 * Server actions for the practice-profile wizard (M3). Every submission is
 * zod-validated at the boundary, then entitlement-checked through the core
 * limit logic; hitting a limit round-trips to the upgrade prompt with the
 * user's selections preserved in the URL. Billing flows through the
 * env-gated provider — the deterministic mock unless STRIPE_SECRET_KEY is
 * configured (no real payment credentials exist here).
 */

const errorMessageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unexpected error.';

const finish = (path: string): never => {
  revalidatePath('/onboarding');
  revalidatePath('/rulebook');
  redirect(path);
};

export async function completeOnboardingAction(formData: FormData): Promise<void> {
  const account = await ensureAccount();

  const parsed = parseOnboardingForm(formData);
  if (!parsed.ok) {
    finish(`/onboarding?error=${encodeURIComponent(parsed.message)}`);
  }
  const value = parsed.ok ? parsed.value : null;
  if (value === null) {
    return; // unreachable; narrows for TS
  }

  const areaCheck = checkPracticeAreaSelection(value.planId, value.selection.practiceAreas);
  if (!areaCheck.allowed) {
    finish(`/onboarding?${queryFromInput(value, { prompt: 'specialty' })}`);
  }

  const jurisdictionCheck = checkJurisdictionSelection(
    value.planId,
    account.addOnJurisdictions,
    value.selection.jurisdictions,
  );
  if (!jurisdictionCheck.allowed) {
    finish(`/onboarding?${queryFromInput(value, { prompt: 'jurisdiction' })}`);
  }

  let errorMessage: string | null = null;
  try {
    const billing = getBillingSelection().provider;
    const subscription = await billing.startSubscription({
      accountId: account.id,
      planId: value.planId,
      interval: planById(value.planId).defaultInterval,
    });
    updateAccount(account.id, (current) => ({
      ...current,
      displayName: value.displayName,
      planId: value.planId,
      firmName: value.firmName,
      subscriptionId: subscription.id,
      profile: buildPracticeProfile({
        id: `profile-${current.id}`,
        name: value.displayName,
        selection: value.selection,
      }),
    }));
  } catch (error: unknown) {
    errorMessage = errorMessageOf(error);
  }
  finish(
    errorMessage === null ? '/rulebook' : `/onboarding?error=${encodeURIComponent(errorMessage)}`,
  );
}

export async function purchaseAddOnAction(formData: FormData): Promise<void> {
  const account = await ensureAccount();
  const prefill = prefillFromFormData(formData);

  let errorMessage: string | null = null;
  try {
    const billing = getBillingSelection().provider;
    const existing = await billing.getSubscription(account.id);
    if (existing === null) {
      await billing.startSubscription({
        accountId: account.id,
        planId: account.planId,
        interval: planById(account.planId).defaultInterval,
      });
    }
    const subscription = await billing.purchaseJurisdictionAddOn({ accountId: account.id });
    updateAccount(account.id, (current) => ({
      ...current,
      addOnJurisdictions: subscription.addOnJurisdictions,
      subscriptionId: subscription.id,
    }));
  } catch (error: unknown) {
    errorMessage = errorMessageOf(error);
  }
  finish(
    errorMessage === null
      ? `/onboarding?${queryFromPrefill(prefill, { notice: 'addon' })}`
      : `/onboarding?error=${encodeURIComponent(errorMessage)}`,
  );
}

export async function upgradeToProAction(formData: FormData): Promise<void> {
  const account = await ensureAccount();
  const prefill = prefillFromFormData(formData);

  let errorMessage: string | null = null;
  try {
    const billing = getBillingSelection().provider;
    const existing = await billing.getSubscription(account.id);
    const subscription =
      existing === null
        ? await billing.startSubscription({
            accountId: account.id,
            planId: 'practice-pro',
            interval: planById('practice-pro').defaultInterval,
          })
        : await billing.changePlan({ accountId: account.id, planId: 'practice-pro' });
    updateAccount(account.id, (current) => ({
      ...current,
      planId: 'practice-pro',
      subscriptionId: subscription.id,
    }));
  } catch (error: unknown) {
    errorMessage = errorMessageOf(error);
  }
  finish(
    errorMessage === null
      ? `/onboarding?${queryFromPrefill({ ...prefill, planId: 'practice-pro' }, { notice: 'upgraded' })}`
      : `/onboarding?error=${encodeURIComponent(errorMessage)}`,
  );
}
