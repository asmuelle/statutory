import { describe, expect, test } from 'vitest';

import { approveAndPublish, workflowStateOf } from './review.js';
import { createReviewQueueFixture } from './reviewQueueFixture.js';

describe('createReviewQueueFixture', () => {
  test('seeds one awaiting_review delta and one gate_blocked seeded mutation', async () => {
    // Act
    const fixture = await createReviewQueueFixture();

    // Assert
    expect(workflowStateOf(fixture.store, fixture.pendingDeltaId)).toBe('awaiting_review');
    expect(workflowStateOf(fixture.store, fixture.blockedDeltaId)).toBe('gate_blocked');
  });

  test('the blocked delta carries the corrupted $884 quote and a gate audit entry', async () => {
    // Act
    const fixture = await createReviewQueueFixture();

    // Assert
    const blocked = fixture.store.getDelta(fixture.blockedDeltaId);
    expect(blocked?.citations.some((c) => c.quoteSpan.includes('$884'))).toBe(true);
    expect(blocked?.verificationStatus).toBe('blocked');
    const trail = fixture.store.reviewTrail(fixture.blockedDeltaId);
    expect(trail.at(-1)?.reviewerId).toBe('system-gate');
    expect(trail.at(-1)?.status).toBe('needs_edit');
  });

  test('the pending delta is approvable end to end (the e2e flow in miniature)', async () => {
    // Arrange
    const fixture = await createReviewQueueFixture();

    // Act
    const outcome = approveAndPublish(fixture.store, {
      deltaId: fixture.pendingDeltaId,
      reviewerId: 'reviewer-e2e',
      notes: 'Looks right.',
      decidedAt: '2024-07-01T15:00:00Z',
      profiles: fixture.profiles,
    });

    // Assert
    expect(outcome.delta.publishedAt).toBe('2024-07-01T15:00:00Z');
    expect(workflowStateOf(fixture.store, fixture.pendingDeltaId)).toBe('published');
  });
});
