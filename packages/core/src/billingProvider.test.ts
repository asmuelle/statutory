import { describe, expect, test } from 'vitest';

import { createMockBillingProvider } from './billingProvider.js';

const CLOCK = '2026-06-10T12:00:00.000Z';

const provider = () => createMockBillingProvider({ clock: () => CLOCK });

describe('deterministic mock billing provider', () => {
  test('identifies itself as the mock', () => {
    expect(provider().kind).toBe('mock');
  });

  test('startSubscription returns an active annual subscription', async () => {
    const billing = provider();
    const sub = await billing.startSubscription({
      accountId: 'acct-1',
      planId: 'core',
      interval: 'annual',
    });
    expect(sub).toEqual({
      id: 'sub-mock-1',
      accountId: 'acct-1',
      planId: 'core',
      interval: 'annual',
      status: 'active',
      addOnJurisdictions: 0,
      startedAt: CLOCK,
    });
    await expect(billing.getSubscription('acct-1')).resolves.toEqual(sub);
  });

  test('subscription ids are deterministic and sequential', async () => {
    const billing = provider();
    const a = await billing.startSubscription({
      accountId: 'a',
      planId: 'core',
      interval: 'annual',
    });
    const b = await billing.startSubscription({
      accountId: 'b',
      planId: 'practice-pro',
      interval: 'monthly',
    });
    expect(a.id).toBe('sub-mock-1');
    expect(b.id).toBe('sub-mock-2');
  });

  test('starting twice for the same account replaces the plan, not the id', async () => {
    const billing = provider();
    await billing.startSubscription({ accountId: 'a', planId: 'core', interval: 'annual' });
    const changed = await billing.changePlan({ accountId: 'a', planId: 'practice-pro' });
    expect(changed.planId).toBe('practice-pro');
    expect(changed.id).toBe('sub-mock-1');
  });

  test('purchaseJurisdictionAddOn increments the add-on count', async () => {
    const billing = provider();
    await billing.startSubscription({ accountId: 'a', planId: 'core', interval: 'annual' });
    const one = await billing.purchaseJurisdictionAddOn({ accountId: 'a' });
    const two = await billing.purchaseJurisdictionAddOn({ accountId: 'a' });
    expect(one.addOnJurisdictions).toBe(1);
    expect(two.addOnJurisdictions).toBe(2);
  });

  test('add-on purchase without a subscription fails loudly', async () => {
    await expect(provider().purchaseJurisdictionAddOn({ accountId: 'ghost' })).rejects.toThrow(
      /no subscription/i,
    );
  });

  test('changePlan without a subscription fails loudly', async () => {
    await expect(
      provider().changePlan({ accountId: 'ghost', planId: 'small-firm' }),
    ).rejects.toThrow(/no subscription/i);
  });

  test('getSubscription returns null for unknown accounts', async () => {
    await expect(provider().getSubscription('ghost')).resolves.toBeNull();
  });

  test('records returned to callers are frozen snapshots', async () => {
    const billing = provider();
    const sub = await billing.startSubscription({
      accountId: 'a',
      planId: 'core',
      interval: 'annual',
    });
    expect(Object.isFrozen(sub)).toBe(true);
  });
});
