import { initialBillingSnapshot } from '@statutory/core';
import type { BillingSnapshot, PlanId, PracticeProfile } from '@statutory/core';

/**
 * Server-side account state for the M3 surface: plan, purchased add-ons,
 * billing snapshot, and the completed practice profile. In-memory like the
 * M2 review queue (the DB-backed user/subscription tables arrive with real
 * auth); all updates are immutable replacements.
 */

export interface Account {
  readonly id: string;
  readonly displayName: string;
  readonly planId: PlanId;
  readonly addOnJurisdictions: number;
  readonly billing: BillingSnapshot;
  readonly profile: PracticeProfile | null;
  readonly firmName: string;
  readonly subscriptionId: string | null;
}

export interface AccountStore {
  create(id: string, at: string): Account;
  get(id: string): Account | undefined;
  /** Replace an account through a pure updater; returns the new snapshot. */
  update(id: string, updater: (current: Account) => Account): Account;
  reset(): void;
}

export const createAccountStore = (): AccountStore => {
  const accounts = new Map<string, Account>();

  const put = (account: Account): Account => {
    const frozen = Object.freeze(account);
    accounts.set(frozen.id, frozen);
    return frozen;
  };

  return {
    create: (id, at) => {
      const existing = accounts.get(id);
      if (existing !== undefined) {
        return existing;
      }
      return put({
        id,
        displayName: '',
        planId: 'core',
        addOnJurisdictions: 0,
        billing: initialBillingSnapshot(at),
        profile: null,
        firmName: '',
        subscriptionId: null,
      });
    },

    get: (id) => accounts.get(id),

    update: (id, updater) => {
      const current = accounts.get(id);
      if (current === undefined) {
        throw new Error(`Unknown account: ${id}`);
      }
      const next = updater(current);
      if (next.id !== current.id) {
        throw new Error('Account ids are immutable.');
      }
      return put(next);
    },

    reset: () => {
      accounts.clear();
    },
  };
};
