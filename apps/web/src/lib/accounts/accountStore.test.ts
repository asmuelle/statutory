import { describe, expect, test } from 'vitest';

import { createAccountStore } from './accountStore';

const T0 = '2026-06-10T00:00:00.000Z';

describe('account store', () => {
  test('creates a fresh account on the default plan with active billing', () => {
    const store = createAccountStore();
    const account = store.create('acct-1', T0);
    expect(account.planId).toBe('core');
    expect(account.addOnJurisdictions).toBe(0);
    expect(account.profile).toBeNull();
    expect(account.billing.standing).toBe('active');
  });

  test('create is idempotent for an existing id', () => {
    const store = createAccountStore();
    const first = store.create('acct-1', T0);
    const updated = store.update('acct-1', (a) => ({ ...a, displayName: 'Maren' }));
    const second = store.create('acct-1', '2026-07-01T00:00:00.000Z');
    expect(second).toEqual(updated);
    expect(second).not.toEqual({ ...first, displayName: '' });
    expect(second.displayName).toBe('Maren');
  });

  test('update replaces immutably and returns the frozen snapshot', () => {
    const store = createAccountStore();
    const before = store.create('acct-1', T0);
    const after = store.update('acct-1', (a) => ({ ...a, addOnJurisdictions: 2 }));
    expect(before.addOnJurisdictions).toBe(0);
    expect(after.addOnJurisdictions).toBe(2);
    expect(Object.isFrozen(after)).toBe(true);
    expect(store.get('acct-1')).toEqual(after);
  });

  test('update on an unknown account fails loudly', () => {
    expect(() => createAccountStore().update('ghost', (a) => a)).toThrow(/unknown account/i);
  });

  test('updaters may not change the account id', () => {
    const store = createAccountStore();
    store.create('acct-1', T0);
    expect(() => store.update('acct-1', (a) => ({ ...a, id: 'other' }))).toThrow(/immutable/i);
  });

  test('reset clears every account (test isolation)', () => {
    const store = createAccountStore();
    store.create('acct-1', T0);
    store.reset();
    expect(store.get('acct-1')).toBeUndefined();
  });
});
