import {
  assertReviewActionAllowed,
  deriveWorkflowState,
  validateReviewDecision,
} from '@statutory/core';
import type { DeltaWorkflowState, GateResult, PracticeProfile, ReviewRecord } from '@statutory/core';

import { publishAndFanOut, verifyDelta } from './pipeline.js';
import type { PublishOutcome } from './pipeline.js';
import type { FederalRegisterDoc } from './sources/federalRegister.js';
import type { DeltaDraftPatch, MemoryStore } from './store.js';

/**
 * Interactive review-queue operations (M2). Every operation derives the
 * delta's workflow state from durable facts and consults the core state
 * machine BEFORE acting — server actions, API routes, and tests all share
 * this single enforcement path:
 *  - drafts cannot publish unreviewed;
 *  - edits reset verification and re-run the span/effective-date gate;
 *  - rejections must record a reason in the append-only audit trail.
 */

const requireDelta = (store: MemoryStore, deltaId: string) => {
  const delta = store.getDelta(deltaId);
  if (delta === undefined) {
    throw new Error(`Unknown delta: ${deltaId}`);
  }
  return delta;
};

/** Derive the workflow state of a stored delta (single source of truth). */
export const workflowStateOf = (store: MemoryStore, deltaId: string): DeltaWorkflowState => {
  const delta = requireDelta(store, deltaId);
  return deriveWorkflowState({
    verificationStatus: delta.verificationStatus,
    publishedAt: delta.publishedAt,
    latestReviewStatus: store.latestReview(deltaId)?.status ?? null,
  });
};

export interface ApproveInput {
  readonly deltaId: string;
  readonly reviewerId: string;
  readonly notes: string;
  readonly decidedAt: string;
  readonly profiles: readonly PracticeProfile[];
}

/** Approve an awaiting_review delta: record the decision, publish, fan out. */
export const approveAndPublish = (store: MemoryStore, input: ApproveInput): PublishOutcome => {
  assertReviewActionAllowed(workflowStateOf(store, input.deltaId), 'approve');
  store.recordReview({
    deltaId: input.deltaId,
    reviewerId: input.reviewerId,
    status: 'approved',
    notes: input.notes,
    decidedAt: input.decidedAt,
  });
  return publishAndFanOut(store, input.deltaId, input.profiles, input.decidedAt);
};

export interface RejectInput {
  readonly deltaId: string;
  readonly reviewerId: string;
  readonly reason: string;
  readonly decidedAt: string;
}

/** Reject a delta. The reason is mandatory and lands in the audit trail. */
export const rejectDelta = (store: MemoryStore, input: RejectInput): ReviewRecord => {
  assertReviewActionAllowed(workflowStateOf(store, input.deltaId), 'reject');
  const decision = validateReviewDecision({ action: 'reject', reason: input.reason });
  const record = store.recordReview({
    deltaId: input.deltaId,
    reviewerId: input.reviewerId,
    status: 'rejected',
    notes: decision.reason,
    decidedAt: input.decidedAt,
  });
  const delta = requireDelta(store, input.deltaId);
  for (const eventId of delta.changeEventIds) {
    store.updateChangeEventStatus(eventId, 'rejected');
  }
  return record;
};

export interface EditInput {
  readonly deltaId: string;
  readonly editorId: string;
  readonly patch: DeltaDraftPatch;
  readonly editedAt: string;
}

const describePatch = (patch: DeltaDraftPatch): string => {
  const fields = (
    [
      ['title', patch.title],
      ['bodyMd', patch.bodyMd],
      ['effectiveDate', patch.effectiveDate],
      ['citations', patch.citations],
    ] as const
  )
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name);
  return fields.length > 0 ? fields.join(', ') : 'nothing';
};

/**
 * Apply a reviewer edit to an unpublished delta. The edit strips every
 * verification stamp, records an audit entry, and IMMEDIATELY re-runs the
 * deterministic gate — there is no path from an edit to publication that
 * skips re-verification.
 */
export const editDelta = (
  store: MemoryStore,
  input: EditInput,
  frDoc: FederalRegisterDoc,
): GateResult => {
  assertReviewActionAllowed(workflowStateOf(store, input.deltaId), 'edit');
  store.updateDeltaDraft(input.deltaId, input.patch);
  store.recordReview({
    deltaId: input.deltaId,
    reviewerId: input.editorId,
    status: 'needs_edit',
    notes: `Edited fields: ${describePatch(input.patch)}. Verification stamps stripped; gate re-running.`,
    decidedAt: input.editedAt,
  });
  return verifyDelta(store, input.deltaId, frDoc, input.editedAt);
};
