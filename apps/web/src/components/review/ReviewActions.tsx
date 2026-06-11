import type { Delta, ReviewAction } from '@statutory/core';

import { approveAction, editAction, rejectAction } from '../../app/review/actions';

interface ReviewActionsProps {
  readonly delta: Delta;
  readonly actions: readonly ReviewAction[];
}

/**
 * The approve / edit / reject forms for one delta. Only the actions the
 * state machine allows are rendered, and the server actions re-check the
 * machine anyway — the UI is a convenience, never the enforcement.
 */
export function ReviewActions({ delta, actions }: ReviewActionsProps) {
  return (
    <div className="review-actions">
      {actions.includes('approve') ? <ApproveForm deltaId={delta.id} /> : null}
      {actions.includes('edit') ? <EditForm delta={delta} /> : null}
      {actions.includes('reject') ? <RejectForm deltaId={delta.id} /> : null}
    </div>
  );
}

function ApproveForm({ deltaId }: { readonly deltaId: string }) {
  return (
    <form action={approveAction} className="review-form">
      <input type="hidden" name="deltaId" value={deltaId} />
      <label htmlFor={`notes-${deltaId}`}>Approval notes</label>
      <input
        id={`notes-${deltaId}`}
        name="notes"
        type="text"
        placeholder="Citations verified against the snapshot."
      />
      <button type="submit" className="btn btn-primary" data-testid={`approve-${deltaId}`}>
        Approve &amp; publish
      </button>
    </form>
  );
}

function EditForm({ delta }: { readonly delta: Delta }) {
  return (
    <form action={editAction} className="review-form">
      <input type="hidden" name="deltaId" value={delta.id} />
      {delta.citations.map((citation, index) => (
        <div key={`${citation.sectionVersionId}-${index}`} className="review-form">
          <label htmlFor={`quote-${delta.id}-${index}`}>
            Quoted span {index + 1} of {delta.citations.length} (edits re-run the gate)
          </label>
          <textarea
            id={`quote-${delta.id}-${index}`}
            name={`quoteSpan-${index}`}
            rows={3}
            defaultValue={citation.quoteSpan}
            data-testid={`quote-input-${delta.id}-${index}`}
          />
        </div>
      ))}
      <label htmlFor={`effective-${delta.id}`}>Effective date (YYYY-MM-DD, blank = keep)</label>
      <input
        id={`effective-${delta.id}`}
        name="effectiveDate"
        type="text"
        inputMode="numeric"
        pattern="\d{4}-\d{2}-\d{2}"
        placeholder={delta.effectiveDate}
      />
      <button type="submit" className="btn" data-testid={`edit-${delta.id}`}>
        Save edit &amp; re-run gate
      </button>
    </form>
  );
}

function RejectForm({ deltaId }: { readonly deltaId: string }) {
  return (
    <form action={rejectAction} className="review-form">
      <input type="hidden" name="deltaId" value={deltaId} />
      <label htmlFor={`reason-${deltaId}`}>Rejection reason (required, recorded)</label>
      <input
        id={`reason-${deltaId}`}
        name="reason"
        type="text"
        required
        placeholder="Why this delta must not publish"
      />
      <button type="submit" className="btn btn-danger" data-testid={`reject-${deltaId}`}>
        Reject
      </button>
    </form>
  );
}
