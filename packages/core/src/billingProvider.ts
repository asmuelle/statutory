import type { BillingInterval, PlanId } from './entitlements.js';

/**
 * Billing goes behind a provider interface (M3). The deterministic mock
 * below carries every test and the local product surface; real adapters
 * (Stripe) implement the same interface at the web boundary, are config-
 * gated on env keys, and never run in tests. No real payment credentials
 * exist anywhere in this repo.
 */

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete';

export interface SubscriptionRecord {
  readonly id: string;
  readonly accountId: string;
  readonly planId: PlanId;
  readonly interval: BillingInterval;
  readonly status: SubscriptionStatus;
  readonly addOnJurisdictions: number;
  readonly startedAt: string;
}

export interface StartSubscriptionInput {
  readonly accountId: string;
  readonly planId: PlanId;
  readonly interval: BillingInterval;
}

export interface ChangePlanInput {
  readonly accountId: string;
  readonly planId: PlanId;
}

export interface PurchaseAddOnInput {
  readonly accountId: string;
}

export interface BillingProvider {
  readonly kind: 'mock' | 'stripe';
  startSubscription(input: StartSubscriptionInput): Promise<SubscriptionRecord>;
  changePlan(input: ChangePlanInput): Promise<SubscriptionRecord>;
  purchaseJurisdictionAddOn(input: PurchaseAddOnInput): Promise<SubscriptionRecord>;
  getSubscription(accountId: string): Promise<SubscriptionRecord | null>;
}

export class BillingProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingProviderError';
  }
}

export interface MockBillingOptions {
  /** Injectable clock so every test result is byte-for-byte deterministic. */
  readonly clock?: () => string;
}

/** In-memory deterministic billing provider — the test-mode "payment rail". */
export const createMockBillingProvider = (options?: MockBillingOptions): BillingProvider => {
  const clock = options?.clock ?? ((): string => new Date().toISOString());
  const subscriptions = new Map<string, SubscriptionRecord>();
  let sequence = 0;

  const put = (record: SubscriptionRecord): SubscriptionRecord => {
    const frozen = Object.freeze(record);
    subscriptions.set(frozen.accountId, frozen);
    return frozen;
  };

  const require = (accountId: string): SubscriptionRecord => {
    const existing = subscriptions.get(accountId);
    if (existing === undefined) {
      throw new BillingProviderError(`Account ${accountId} has no subscription.`);
    }
    return existing;
  };

  return {
    kind: 'mock',

    startSubscription: (input) => {
      const existing = subscriptions.get(input.accountId);
      if (existing !== undefined) {
        return Promise.resolve(
          put({ ...existing, planId: input.planId, interval: input.interval }),
        );
      }
      sequence += 1;
      return Promise.resolve(
        put({
          id: `sub-mock-${sequence}`,
          accountId: input.accountId,
          planId: input.planId,
          interval: input.interval,
          status: 'active',
          addOnJurisdictions: 0,
          startedAt: clock(),
        }),
      );
    },

    changePlan: (input) => {
      try {
        return Promise.resolve(put({ ...require(input.accountId), planId: input.planId }));
      } catch (error: unknown) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },

    purchaseJurisdictionAddOn: (input) => {
      try {
        const existing = require(input.accountId);
        return Promise.resolve(
          put({ ...existing, addOnJurisdictions: existing.addOnJurisdictions + 1 }),
        );
      } catch (error: unknown) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },

    getSubscription: (accountId) => Promise.resolve(subscriptions.get(accountId) ?? null),
  };
};
