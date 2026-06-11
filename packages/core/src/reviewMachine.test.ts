import { describe, expect, test } from 'vitest';

import {
  ReviewTransitionError,
  allowedReviewActions,
  assertReviewActionAllowed,
  deriveWorkflowState,
  validateReviewDecision,
} from './reviewMachine.js';

describe('deriveWorkflowState', () => {
  test('a freshly synthesized draft (gate not yet run) is in draft state', () => {
    // Act
    const state = deriveWorkflowState({
      verificationStatus: 'pending',
      publishedAt: null,
      latestReviewStatus: null,
    });

    // Assert
    expect(state).toBe('draft');
  });

  test('a gate-failed delta is gate_blocked even if a needs_edit record exists', () => {
    // Act
    const state = deriveWorkflowState({
      verificationStatus: 'blocked',
      publishedAt: null,
      latestReviewStatus: 'needs_edit',
    });

    // Assert
    expect(state).toBe('gate_blocked');
  });

  test('a gate-passed delta with a pending review awaits human review', () => {
    // Act
    const state = deriveWorkflowState({
      verificationStatus: 'verified',
      publishedAt: null,
      latestReviewStatus: 'pending',
    });

    // Assert
    expect(state).toBe('awaiting_review');
  });

  test('an approved but not yet published delta is approved', () => {
    // Act
    const state = deriveWorkflowState({
      verificationStatus: 'verified',
      publishedAt: null,
      latestReviewStatus: 'approved',
    });

    // Assert
    expect(state).toBe('approved');
  });

  test('publishedAt set means published, regardless of trailing records', () => {
    // Act
    const state = deriveWorkflowState({
      verificationStatus: 'verified',
      publishedAt: '2024-07-01T14:31:00Z',
      latestReviewStatus: 'approved',
    });

    // Assert
    expect(state).toBe('published');
  });

  test('a rejected latest review puts the delta in rejected state', () => {
    // Act
    const state = deriveWorkflowState({
      verificationStatus: 'verified',
      publishedAt: null,
      latestReviewStatus: 'rejected',
    });

    // Assert
    expect(state).toBe('rejected');
  });
});

describe('allowedReviewActions (the state machine)', () => {
  test('drafts cannot be approved, edited, or rejected before the gate runs', () => {
    // Act / Assert
    expect(allowedReviewActions('draft')).toEqual([]);
  });

  test('gate-blocked deltas can be edited or rejected — never approved', () => {
    // Act
    const actions = allowedReviewActions('gate_blocked');

    // Assert
    expect(actions).toContain('edit');
    expect(actions).toContain('reject');
    expect(actions).not.toContain('approve');
  });

  test('awaiting_review allows approve, edit, and reject', () => {
    // Act / Assert
    expect(allowedReviewActions('awaiting_review')).toEqual(['approve', 'edit', 'reject']);
  });

  test('published, approved, and rejected deltas are terminal for review actions', () => {
    // Act / Assert
    expect(allowedReviewActions('published')).toEqual([]);
    expect(allowedReviewActions('approved')).toEqual([]);
    expect(allowedReviewActions('rejected')).toEqual([]);
  });
});

describe('assertReviewActionAllowed', () => {
  test('approving a gate-blocked delta throws ReviewTransitionError', () => {
    // Act / Assert
    expect(() => assertReviewActionAllowed('gate_blocked', 'approve')).toThrow(
      ReviewTransitionError,
    );
    expect(() => assertReviewActionAllowed('gate_blocked', 'approve')).toThrow(
      /approve.*gate_blocked/,
    );
  });

  test('approving an awaiting_review delta is allowed', () => {
    // Act / Assert
    expect(() => assertReviewActionAllowed('awaiting_review', 'approve')).not.toThrow();
  });

  test('editing a published delta throws — published content is immutable', () => {
    // Act / Assert
    expect(() => assertReviewActionAllowed('published', 'edit')).toThrow(ReviewTransitionError);
  });
});

describe('validateReviewDecision', () => {
  test('rejections without a reason are invalid', () => {
    // Act / Assert
    expect(() => validateReviewDecision({ action: 'reject', reason: '' })).toThrow(
      /reason/i,
    );
    expect(() => validateReviewDecision({ action: 'reject', reason: '   ' })).toThrow(
      /reason/i,
    );
  });

  test('rejections with a reason pass and return the trimmed reason', () => {
    // Act
    const decision = validateReviewDecision({
      action: 'reject',
      reason: '  Effective date applies only to territories.  ',
    });

    // Assert
    expect(decision.reason).toBe('Effective date applies only to territories.');
  });

  test('approvals do not require a reason', () => {
    // Act / Assert
    expect(() => validateReviewDecision({ action: 'approve', reason: '' })).not.toThrow();
  });
});
