import { BillingProviderError, createMockBillingProvider } from '@statutory/core';
import type {
  BillingProvider,
  PlanId,
  SubscriptionRecord,
  SubscriptionStatus,
} from '@statutory/core';
import { z } from 'zod';

/**
 * Stripe adapter skeleton (M3). Config-gated: it is ONLY constructed when
 * STRIPE_SECRET_KEY is present in the environment — no key, no Stripe, and
 * the deterministic mock carries the product surface and every test. Keys
 * are read from env, never hardcoded, and never echoed into errors.
 * Talks to the Stripe REST API directly (form-encoded) so no payment SDK
 * ships in the bundle.
 */

const STRIPE_API_BASE = 'https://api.stripe.com';

const stripeSubscriptionSchema = z.object({
  id: z.string(),
  status: z.string(),
  created: z.number(),
  metadata: z.record(z.string()),
});

const stripeSearchSchema = z.object({
  data: z.array(stripeSubscriptionSchema),
});

export interface StripePriceIds {
  readonly core?: string;
  readonly 'practice-pro'?: string;
  readonly 'small-firm'?: string;
  readonly jurisdictionAddOn?: string;
}

export interface StripeProviderConfig {
  readonly secretKey: string;
  readonly priceIds?: StripePriceIds;
  readonly fetchImpl?: typeof fetch;
  readonly apiBase?: string;
}

const toStatus = (stripeStatus: string): SubscriptionStatus => {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    default:
      return 'incomplete';
  }
};

const toRecord = (
  sub: z.infer<typeof stripeSubscriptionSchema>,
  accountId: string,
): SubscriptionRecord => {
  const planId = sub.metadata['planId'];
  const interval = sub.metadata['interval'];
  return Object.freeze({
    id: sub.id,
    accountId,
    planId: (planId === 'practice-pro' || planId === 'small-firm' ? planId : 'core') as PlanId,
    interval: interval === 'monthly' ? ('monthly' as const) : ('annual' as const),
    status: toStatus(sub.status),
    addOnJurisdictions: Number.parseInt(sub.metadata['addOnJurisdictions'] ?? '0', 10) || 0,
    startedAt: new Date(sub.created * 1000).toISOString(),
  });
};

/** Create the Stripe-backed provider. Caller guarantees a secret key exists. */
export const createStripeBillingProvider = (config: StripeProviderConfig): BillingProvider => {
  if (config.secretKey.length === 0) {
    throw new BillingProviderError('Stripe provider requires a non-empty secret key.');
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const apiBase = config.apiBase ?? STRIPE_API_BASE;

  const request = async (
    method: 'GET' | 'POST',
    path: string,
    params?: Readonly<Record<string, string>>,
  ): Promise<unknown> => {
    const body = params === undefined ? undefined : new URLSearchParams(params).toString();
    const url = method === 'GET' && body !== undefined ? `${apiBase}${path}?${body}` : `${apiBase}${path}`;
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(method === 'POST' && body !== undefined ? { body } : {}),
    });
    const json: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        typeof json === 'object' && json !== null && 'error' in json
          ? JSON.stringify((json as { error: unknown }).error).slice(0, 200)
          : 'no error body';
      throw new BillingProviderError(`Stripe ${method} ${path} failed (${response.status}): ${detail}`);
    }
    return json;
  };

  const priceFor = (planId: PlanId): string => {
    const price = config.priceIds?.[planId];
    if (price === undefined || price.length === 0) {
      throw new BillingProviderError(
        `No Stripe price configured for plan '${planId}' — set STRIPE_PRICE_${planId.toUpperCase().replace(/-/g, '_')}.`,
      );
    }
    return price;
  };

  const findByAccount = async (accountId: string) => {
    const raw = await request('GET', '/v1/subscriptions/search', {
      query: `metadata['accountId']:'${accountId}'`,
      limit: '1',
    });
    const parsed = stripeSearchSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BillingProviderError('Stripe returned an unexpected subscription search shape.');
    }
    return parsed.data.data[0] ?? null;
  };

  const requireByAccount = async (accountId: string) => {
    const sub = await findByAccount(accountId);
    if (sub === null) {
      throw new BillingProviderError(`Account ${accountId} has no subscription.`);
    }
    return sub;
  };

  const parseSubscription = (raw: unknown) => {
    const parsed = stripeSubscriptionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BillingProviderError('Stripe returned an unexpected subscription shape.');
    }
    return parsed.data;
  };

  return {
    kind: 'stripe',

    startSubscription: async (input) => {
      const raw = await request('POST', '/v1/subscriptions', {
        'items[0][price]': priceFor(input.planId),
        'metadata[accountId]': input.accountId,
        'metadata[planId]': input.planId,
        'metadata[interval]': input.interval,
        'metadata[addOnJurisdictions]': '0',
      });
      return toRecord(parseSubscription(raw), input.accountId);
    },

    changePlan: async (input) => {
      const existing = await requireByAccount(input.accountId);
      const raw = await request('POST', `/v1/subscriptions/${existing.id}`, {
        'items[0][price]': priceFor(input.planId),
        'metadata[planId]': input.planId,
      });
      return toRecord(parseSubscription(raw), input.accountId);
    },

    purchaseJurisdictionAddOn: async (input) => {
      const existing = await requireByAccount(input.accountId);
      const current = Number.parseInt(existing.metadata['addOnJurisdictions'] ?? '0', 10) || 0;
      const raw = await request('POST', `/v1/subscriptions/${existing.id}`, {
        'metadata[addOnJurisdictions]': String(current + 1),
      });
      return toRecord(parseSubscription(raw), input.accountId);
    },

    getSubscription: async (accountId) => {
      const sub = await findByAccount(accountId);
      return sub === null ? null : toRecord(sub, accountId);
    },
  };
};

export interface BillingProviderSelection {
  readonly provider: BillingProvider;
  readonly mode: 'mock' | 'stripe';
  readonly reason: string;
}

/**
 * Config gate: Stripe only when STRIPE_SECRET_KEY is present; otherwise the
 * deterministic mock. Never throws — missing keys degrade gracefully.
 */
export const createBillingProviderFromEnv = (
  env: Readonly<Record<string, string | undefined>>,
  options?: { readonly fetchImpl?: typeof fetch; readonly clock?: () => string },
): BillingProviderSelection => {
  const secretKey = env['STRIPE_SECRET_KEY'] ?? '';
  if (secretKey.length === 0) {
    return {
      provider: createMockBillingProvider(
        options?.clock !== undefined ? { clock: options.clock } : {},
      ),
      mode: 'mock',
      reason: 'No STRIPE_SECRET_KEY in the environment; using the deterministic mock provider.',
    };
  }
  return {
    provider: createStripeBillingProvider({
      secretKey,
      priceIds: {
        ...(env['STRIPE_PRICE_CORE'] !== undefined ? { core: env['STRIPE_PRICE_CORE'] } : {}),
        ...(env['STRIPE_PRICE_PRACTICE_PRO'] !== undefined
          ? { 'practice-pro': env['STRIPE_PRICE_PRACTICE_PRO'] }
          : {}),
        ...(env['STRIPE_PRICE_SMALL_FIRM'] !== undefined
          ? { 'small-firm': env['STRIPE_PRICE_SMALL_FIRM'] }
          : {}),
        ...(env['STRIPE_PRICE_JURISDICTION_ADDON'] !== undefined
          ? { jurisdictionAddOn: env['STRIPE_PRICE_JURISDICTION_ADDON'] }
          : {}),
      },
      ...(options?.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    }),
    mode: 'stripe',
    reason: 'STRIPE_SECRET_KEY present; using the Stripe adapter.',
  };
};
