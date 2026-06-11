import type { ReviewStatus, VerificationStatus } from './types.js';

/**
 * The attorney review state machine (invariant 4). The workflow state of a
 * delta is DERIVED from durable facts — verification status, publication
 * stamp, latest review record — never stored separately, so it cannot drift.
 * Every interactive review surface (server actions, API routes, repositories)
 * must consult this machine before acting; illegal transitions throw.
 */

export type DeltaWorkflowState =
  | 'draft' // synthesized; deterministic gate has not run yet
  | 'gate_blocked' // span/effective-date gate failed — approval impossible
  | 'awaiting_review' // gate passed; waiting on a human decision
  | 'approved' // approved, publication pending
  | 'published' // user-visible; terminal and immutable
  | 'rejected'; // rejected with a recorded reason; terminal

export type ReviewAction = 'approve' | 'edit' | 'reject';

export class ReviewTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewTransitionError';
  }
}

export interface WorkflowFacts {
  readonly verificationStatus: VerificationStatus;
  readonly publishedAt: string | null;
  readonly latestReviewStatus: ReviewStatus | null;
}

/** Derive the workflow state from durable delta + review facts. */
export const deriveWorkflowState = (facts: WorkflowFacts): DeltaWorkflowState => {
  if (facts.publishedAt !== null) {
    return 'published';
  }
  if (facts.latestReviewStatus === 'rejected') {
    return 'rejected';
  }
  if (facts.verificationStatus === 'blocked') {
    return 'gate_blocked';
  }
  if (facts.verificationStatus === 'pending') {
    return 'draft';
  }
  // verificationStatus === 'verified'
  return facts.latestReviewStatus === 'approved' ? 'approved' : 'awaiting_review';
};

const ACTION_TABLE: Readonly<Record<DeltaWorkflowState, readonly ReviewAction[]>> = {
  draft: [],
  gate_blocked: ['edit', 'reject'],
  awaiting_review: ['approve', 'edit', 'reject'],
  approved: [],
  published: [],
  rejected: [],
};

/** The review actions legal in a given workflow state. */
export const allowedReviewActions = (state: DeltaWorkflowState): readonly ReviewAction[] =>
  ACTION_TABLE[state];

/** Throw unless `action` is legal in `state`. No caller may bypass this. */
export const assertReviewActionAllowed = (
  state: DeltaWorkflowState,
  action: ReviewAction,
): void => {
  if (!ACTION_TABLE[state].includes(action)) {
    throw new ReviewTransitionError(
      `Illegal review transition: cannot '${action}' a delta in state '${state}' ` +
        `(allowed: ${ACTION_TABLE[state].join(', ') || 'none'}).`,
    );
  }
};

export interface ReviewDecisionInput {
  readonly action: ReviewAction;
  readonly reason: string;
}

export interface ReviewDecision {
  readonly action: ReviewAction;
  readonly reason: string;
}

/** Validate a human decision: rejections MUST record a non-empty reason. */
export const validateReviewDecision = (input: ReviewDecisionInput): ReviewDecision => {
  const reason = input.reason.trim();
  if (input.action === 'reject' && reason.length === 0) {
    throw new ReviewTransitionError('A rejection must record a reason — none was provided.');
  }
  return { action: input.action, reason };
};
