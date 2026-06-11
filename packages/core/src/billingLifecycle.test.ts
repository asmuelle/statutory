import { describe, expect, test } from 'vitest';

import {
  BILLING_STANDINGS,
  GRACE_PERIOD_DAYS,
  applyBillingEvent,
  capabilitiesFor,
  effectiveStanding,
  initialBillingSnapshot,
} from './billingLifecycle.js';

const T0 = '2026-06-01T00:00:00.000Z';
const T1 = '2026-06-02T00:00:00.000Z';
const T2 = '2026-06-03T00:00:00.000Z';
const AFTER_GRACE = '2026-06-20T00:00:00.000Z';

describe('billing degradation state machine', () => {
  test('starts active', () => {
    const snapshot = initialBillingSnapshot(T0);
    expect(snapshot.standing).toBe('active');
  });

  test('first payment failure moves active -> payment_failed (dunning)', () => {
    const snapshot = applyBillingEvent(initialBillingSnapshot(T0), {
      id: 'evt-1',
      kind: 'payment_failed',
      at: T1,
    });
    expect(snapshot.standing).toBe('payment_failed');
    expect(snapshot.graceUntil).toBeNull();
  });

  test('a second failure opens the grace window', () => {
    let snapshot = initialBillingSnapshot(T0);
    snapshot = applyBillingEvent(snapshot, { id: 'evt-1', kind: 'payment_failed', at: T1 });
    snapshot = applyBillingEvent(snapshot, { id: 'evt-2', kind: 'payment_failed', at: T2 });
    expect(snapshot.standing).toBe('grace');
    expect(snapshot.graceUntil).toBe('2026-06-17T00:00:00.000Z'); // T2 + 14 days
  });

  test('grace expiry degrades to read_only without needing an event', () => {
    let snapshot = initialBillingSnapshot(T0);
    snapshot = applyBillingEvent(snapshot, { id: 'evt-1', kind: 'payment_failed', at: T1 });
    snapshot = applyBillingEvent(snapshot, { id: 'evt-2', kind: 'payment_failed', at: T2 });
    expect(effectiveStanding(snapshot, T2)).toBe('grace');
    expect(effectiveStanding(snapshot, AFTER_GRACE)).toBe('read_only');
  });

  test('payment success restores active from every degraded state', () => {
    let snapshot = initialBillingSnapshot(T0);
    snapshot = applyBillingEvent(snapshot, { id: 'evt-1', kind: 'payment_failed', at: T1 });
    snapshot = applyBillingEvent(snapshot, { id: 'evt-2', kind: 'payment_failed', at: T2 });
    const restored = applyBillingEvent(snapshot, {
      id: 'evt-3',
      kind: 'payment_succeeded',
      at: AFTER_GRACE,
    });
    expect(restored.standing).toBe('active');
    expect(restored.graceUntil).toBeNull();
    expect(effectiveStanding(restored, AFTER_GRACE)).toBe('active');
  });

  test('events are idempotent: replaying the same event id is a no-op', () => {
    const first = applyBillingEvent(initialBillingSnapshot(T0), {
      id: 'evt-1',
      kind: 'payment_failed',
      at: T1,
    });
    const replay = applyBillingEvent(first, { id: 'evt-1', kind: 'payment_failed', at: T2 });
    expect(replay).toEqual(first);
    expect(replay.standing).toBe('payment_failed');
  });

  test('applyBillingEvent never mutates its input snapshot', () => {
    const snapshot = initialBillingSnapshot(T0);
    applyBillingEvent(snapshot, { id: 'evt-1', kind: 'payment_failed', at: T1 });
    expect(snapshot.standing).toBe('active');
    expect(snapshot.processedEventIds).toEqual([]);
  });

  test('grace period constant is 14 days', () => {
    expect(GRACE_PERIOD_DAYS).toBe(14);
  });
});

describe('capability degradation (the tested invariant)', () => {
  test('INVARIANT: published rulebook + published deltas stay readable in EVERY standing', () => {
    for (const standing of BILLING_STANDINGS) {
      const caps = capabilitiesFor(standing);
      expect(caps.canReadPublishedRulebook, `standing=${standing}`).toBe(true);
      expect(caps.canViewPublishedDeltas, `standing=${standing}`).toBe(true);
    }
  });

  test('read_only degrades writes and alerts, not the record', () => {
    const caps = capabilitiesFor('read_only');
    expect(caps.canDraftClientAlerts).toBe(false);
    expect(caps.canReceiveAlerts).toBe(false);
    expect(caps.canEditProfile).toBe(false);
    expect(caps.canExportHistory).toBe(false);
  });

  test('payment_failed and grace keep full working capabilities (dunning, not punishment)', () => {
    for (const standing of ['payment_failed', 'grace'] as const) {
      const caps = capabilitiesFor(standing);
      expect(caps.canDraftClientAlerts, `standing=${standing}`).toBe(true);
      expect(caps.canReceiveAlerts, `standing=${standing}`).toBe(true);
      expect(caps.canEditProfile, `standing=${standing}`).toBe(true);
    }
  });

  test('active has every capability', () => {
    const caps = capabilitiesFor('active');
    expect(Object.values(caps).every((v) => v === true)).toBe(true);
  });
});
