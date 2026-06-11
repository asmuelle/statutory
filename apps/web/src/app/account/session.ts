import { randomUUID } from 'node:crypto';

import { cookies } from 'next/headers';

import { createBillingProviderFromEnv } from '../../lib/billing/stripeProvider';
import type { BillingProviderSelection } from '../../lib/billing/stripeProvider';
import { createAccountStore } from '../../lib/accounts/accountStore';
import type { Account, AccountStore } from '../../lib/accounts/accountStore';

/**
 * Account session for the M3 surface: an httpOnly cookie carrying an opaque
 * account id, backed by the in-memory account store and the env-gated
 * billing provider (deterministic mock unless STRIPE_SECRET_KEY is set).
 * Mirrors the M2 review-queue holder pattern so dev reloads and e2e resets
 * behave identically.
 */

export const ACCOUNT_COOKIE = 'statutory_account';

const ACCOUNT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/i;

interface SessionHolder {
  store: AccountStore | null;
  billing: BillingProviderSelection | null;
}

const HOLDER_KEY = Symbol.for('statutory.accountSession.m3');

const holder = (): SessionHolder => {
  const globalRecord = globalThis as unknown as Record<symbol, SessionHolder | undefined>;
  const existing = globalRecord[HOLDER_KEY];
  if (existing !== undefined) {
    return existing;
  }
  const fresh: SessionHolder = { store: null, billing: null };
  globalRecord[HOLDER_KEY] = fresh;
  return fresh;
};

const accountStore = (): AccountStore => {
  const h = holder();
  if (h.store === null) {
    h.store = createAccountStore();
  }
  return h.store;
};

/** The env-gated billing provider (mock without STRIPE_SECRET_KEY). */
export const getBillingSelection = (): BillingProviderSelection => {
  const h = holder();
  if (h.billing === null) {
    h.billing = createBillingProviderFromEnv(process.env as Record<string, string | undefined>);
  }
  return h.billing;
};

/** The signed-in account, or null when no valid session/account exists. */
export const getAccount = async (): Promise<Account | null> => {
  const jar = await cookies();
  const raw = jar.get(ACCOUNT_COOKIE)?.value ?? '';
  if (!ACCOUNT_ID_PATTERN.test(raw)) {
    return null;
  }
  return accountStore().get(raw) ?? null;
};

/**
 * Get or create the session account. Server-action only (sets the cookie).
 * A stale cookie whose account vanished (test reset, dev reload) is re-bound
 * to a fresh account under the same id.
 */
export const ensureAccount = async (): Promise<Account> => {
  const jar = await cookies();
  const raw = jar.get(ACCOUNT_COOKIE)?.value ?? '';
  const id = ACCOUNT_ID_PATTERN.test(raw) ? raw : randomUUID();
  if (id !== raw) {
    jar.set(ACCOUNT_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' });
  }
  return accountStore().create(id, new Date().toISOString());
};

/** Immutable account update through the shared store. */
export const updateAccount = (id: string, updater: (current: Account) => Account): Account =>
  accountStore().update(id, updater);

/** Reset accounts AND the billing provider (test isolation). */
export const resetAccountSession = (): void => {
  const h = holder();
  h.store = null;
  h.billing = null;
};
