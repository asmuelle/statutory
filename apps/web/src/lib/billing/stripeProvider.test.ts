import { BillingProviderError } from '@statutory/core';
import { describe, expect, test } from 'vitest';

import { createBillingProviderFromEnv, createStripeBillingProvider } from './stripeProvider';

/**
 * The Stripe adapter never sees a real key or the network in tests: every
 * call goes through an injected fetch stub that records requests and serves
 * canned Stripe-shaped JSON. The deterministic mock carries everything else.
 */

const TEST_KEY = 'sk_test_stub_key_for_unit_tests_only';

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

const stripeSub = (overrides?: Record<string, unknown>) => ({
  id: 'sub_stripe_1',
  status: 'active',
  created: 1_760_000_000,
  metadata: {
    accountId: 'acct-1',
    planId: 'core',
    interval: 'annual',
    addOnJurisdictions: '0',
  },
  ...overrides,
});

const stubFetch = (
  responses: readonly { readonly status: number; readonly json: unknown }[],
): { fetchImpl: typeof fetch; requests: RecordedRequest[] } => {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : null,
    });
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (response === undefined) {
      throw new Error('Stub fetch exhausted.');
    }
    return Promise.resolve(
      new Response(JSON.stringify(response.json), { status: response.status }),
    );
  }) as typeof fetch;
  return { fetchImpl, requests };
};

const provider = (responses: readonly { status: number; json: unknown }[]) => {
  const { fetchImpl, requests } = stubFetch(responses);
  return {
    requests,
    billing: createStripeBillingProvider({
      secretKey: TEST_KEY,
      priceIds: { core: 'price_core_test', 'practice-pro': 'price_pro_test' },
      fetchImpl,
    }),
  };
};

describe('config gating (createBillingProviderFromEnv)', () => {
  test('without STRIPE_SECRET_KEY the deterministic mock is selected', () => {
    const selection = createBillingProviderFromEnv({});
    expect(selection.mode).toBe('mock');
    expect(selection.provider.kind).toBe('mock');
    expect(selection.reason).toMatch(/no stripe_secret_key/i);
  });

  test('with a key the Stripe adapter is selected — and never invents one', () => {
    const selection = createBillingProviderFromEnv({ STRIPE_SECRET_KEY: TEST_KEY });
    expect(selection.mode).toBe('stripe');
    expect(selection.provider.kind).toBe('stripe');
  });

  test('the factory never throws on missing config (graceful degrade)', () => {
    expect(() => createBillingProviderFromEnv({ STRIPE_SECRET_KEY: undefined })).not.toThrow();
  });
});

describe('stripe adapter skeleton', () => {
  test('startSubscription posts form-encoded params with the bearer key', async () => {
    const { billing, requests } = provider([{ status: 200, json: stripeSub() }]);
    const record = await billing.startSubscription({
      accountId: 'acct-1',
      planId: 'core',
      interval: 'annual',
    });

    const request = requests[0];
    expect(request?.url).toBe('https://api.stripe.com/v1/subscriptions');
    expect(request?.method).toBe('POST');
    expect(request?.headers['Authorization']).toBe(`Bearer ${TEST_KEY}`);
    expect(request?.body).toContain('items%5B0%5D%5Bprice%5D=price_core_test');
    expect(request?.body).toContain('metadata%5BaccountId%5D=acct-1');

    expect(record.id).toBe('sub_stripe_1');
    expect(record.planId).toBe('core');
    expect(record.status).toBe('active');
    expect(record.interval).toBe('annual');
  });

  test('a missing price id fails loudly with the env var to set', async () => {
    const { billing } = provider([{ status: 200, json: stripeSub() }]);
    await expect(
      billing.startSubscription({ accountId: 'a', planId: 'small-firm', interval: 'annual' }),
    ).rejects.toThrow(/STRIPE_PRICE_SMALL_FIRM/);
  });

  test('non-2xx responses raise BillingProviderError without echoing the key', async () => {
    const { billing } = provider([
      { status: 402, json: { error: { message: 'Your card was declined.' } } },
    ]);
    const failure = billing.startSubscription({
      accountId: 'a',
      planId: 'core',
      interval: 'annual',
    });
    await expect(failure).rejects.toThrow(BillingProviderError);
    await failure.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      expect(message).toContain('402');
      expect(message).not.toContain(TEST_KEY);
    });
  });

  test('getSubscription searches by account metadata and maps the result', async () => {
    const { billing, requests } = provider([{ status: 200, json: { data: [stripeSub()] } }]);
    const record = await billing.getSubscription('acct-1');
    expect(requests[0]?.url).toContain('/v1/subscriptions/search?');
    expect(requests[0]?.url).toContain('acct-1');
    expect(record?.accountId).toBe('acct-1');
  });

  test('getSubscription returns null when Stripe has no match', async () => {
    const { billing } = provider([{ status: 200, json: { data: [] } }]);
    await expect(billing.getSubscription('ghost')).resolves.toBeNull();
  });

  test('purchaseJurisdictionAddOn increments the metadata counter', async () => {
    const { billing, requests } = provider([
      { status: 200, json: { data: [stripeSub()] } },
      { status: 200, json: stripeSub({ metadata: { accountId: 'acct-1', planId: 'core', interval: 'annual', addOnJurisdictions: '1' } }) },
    ]);
    const record = await billing.purchaseJurisdictionAddOn({ accountId: 'acct-1' });
    expect(requests[1]?.body).toContain('metadata%5BaddOnJurisdictions%5D=1');
    expect(record.addOnJurisdictions).toBe(1);
  });

  test('changePlan without an existing subscription fails loudly', async () => {
    const { billing } = provider([{ status: 200, json: { data: [] } }]);
    await expect(billing.changePlan({ accountId: 'ghost', planId: 'core' })).rejects.toThrow(
      /no subscription/i,
    );
  });

  test('unexpected response shapes are rejected at the boundary', async () => {
    const { billing } = provider([{ status: 200, json: { nope: true } }]);
    await expect(billing.getSubscription('acct-1')).rejects.toThrow(/unexpected/i);
  });

  test('an empty secret key is a constructor-time error', () => {
    expect(() => createStripeBillingProvider({ secretKey: '' })).toThrow(/secret key/i);
  });

  test('past_due and unknown stripe statuses map conservatively', async () => {
    const { billing } = provider([
      { status: 200, json: { data: [stripeSub({ status: 'past_due' })] } },
    ]);
    const record = await billing.getSubscription('acct-1');
    expect(record?.status).toBe('past_due');
  });
});
