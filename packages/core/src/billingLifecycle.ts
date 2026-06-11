/**
 * Billing degradation state machine (M3): payment failure → dunning →
 * grace window → read-only. The binding product rule: read-only mode NEVER
 * hides already-published rulebook content the professional relies on —
 * it degrades writes and alert dispatch, not the record. That invariant is
 * pinned by tests iterating every standing.
 *
 * Pure reducer over explicit events; event ids make application idempotent
 * (the same webhook delivered twice must not double-transition).
 */

export type BillingStanding = 'active' | 'payment_failed' | 'grace' | 'read_only';

export const BILLING_STANDINGS: readonly BillingStanding[] = [
  'active',
  'payment_failed',
  'grace',
  'read_only',
];

export const GRACE_PERIOD_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface BillingSnapshot {
  readonly standing: BillingStanding;
  readonly graceUntil: string | null;
  readonly lastEventAt: string;
  readonly processedEventIds: readonly string[];
}

export interface BillingEvent {
  readonly id: string;
  readonly kind: 'payment_failed' | 'payment_succeeded';
  readonly at: string;
}

/** A fresh subscription in good standing. */
export const initialBillingSnapshot = (at: string): BillingSnapshot => ({
  standing: 'active',
  graceUntil: null,
  lastEventAt: at,
  processedEventIds: [],
});

const graceDeadline = (at: string): string =>
  new Date(Date.parse(at) + GRACE_PERIOD_DAYS * MS_PER_DAY).toISOString();

const transition = (snapshot: BillingSnapshot, event: BillingEvent): BillingSnapshot => {
  if (event.kind === 'payment_succeeded') {
    return { ...snapshot, standing: 'active', graceUntil: null, lastEventAt: event.at };
  }
  // payment_failed
  switch (snapshot.standing) {
    case 'active':
      return { ...snapshot, standing: 'payment_failed', graceUntil: null, lastEventAt: event.at };
    case 'payment_failed':
      return {
        ...snapshot,
        standing: 'grace',
        graceUntil: graceDeadline(event.at),
        lastEventAt: event.at,
      };
    case 'grace':
    case 'read_only':
      // Already in (or past) the grace window; the deadline does not extend.
      return { ...snapshot, lastEventAt: event.at };
  }
};

/** Apply one billing event, idempotently: replayed event ids are no-ops. */
export const applyBillingEvent = (
  snapshot: BillingSnapshot,
  event: BillingEvent,
): BillingSnapshot => {
  if (snapshot.processedEventIds.includes(event.id)) {
    return snapshot;
  }
  const next = transition(snapshot, event);
  return { ...next, processedEventIds: [...snapshot.processedEventIds, event.id] };
};

/**
 * The standing in effect at `now`: an expired grace window degrades to
 * read_only deterministically, without waiting for another event.
 */
export const effectiveStanding = (snapshot: BillingSnapshot, now: string): BillingStanding => {
  if (
    snapshot.standing === 'grace' &&
    snapshot.graceUntil !== null &&
    Date.parse(now) > Date.parse(snapshot.graceUntil)
  ) {
    return 'read_only';
  }
  return snapshot.standing;
};

export interface BillingCapabilities {
  /** NEVER false — published record access survives every degradation. */
  readonly canReadPublishedRulebook: boolean;
  /** NEVER false — published deltas remain visible in every standing. */
  readonly canViewPublishedDeltas: boolean;
  readonly canReceiveAlerts: boolean;
  readonly canDraftClientAlerts: boolean;
  readonly canEditProfile: boolean;
  readonly canExportHistory: boolean;
}

/** Derive capabilities from a standing. Read access is unconditional. */
export const capabilitiesFor = (standing: BillingStanding): BillingCapabilities => {
  const working = standing !== 'read_only';
  return {
    canReadPublishedRulebook: true,
    canViewPublishedDeltas: true,
    canReceiveAlerts: working,
    canDraftClientAlerts: working,
    canEditProfile: working,
    canExportHistory: working,
  };
};
