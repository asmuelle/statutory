import { allowedReviewActions } from '@statutory/core';
import type {
  Delivery,
  Delta,
  DeltaWorkflowState,
  ReviewRecord,
  SectionVersion,
} from '@statutory/core';

import { parseDeltaBody } from '../../lib/deltaBody';
import { ReviewActions } from './ReviewActions';

interface ReviewQueueEntryProps {
  readonly delta: Delta;
  readonly state: DeltaWorkflowState;
  readonly reviewTrail: readonly ReviewRecord[];
  readonly getVersion: (versionId: string) => SectionVersion | undefined;
  readonly deliveries: readonly Delivery[];
}

const STATE_LABEL: Readonly<Record<DeltaWorkflowState, string>> = {
  draft: 'draft — gate pending',
  gate_blocked: 'gate blocked',
  awaiting_review: 'awaiting review',
  approved: 'approved',
  published: 'published',
  rejected: 'rejected',
};

const STATE_CLASS: Readonly<Record<DeltaWorkflowState, string>> = {
  draft: 'stamp-pending',
  gate_blocked: 'stamp-superseded',
  awaiting_review: 'stamp-review',
  approved: 'stamp-verified',
  published: 'stamp-verified',
  rejected: 'stamp-superseded',
};

/** One delta in the queue: provenance, gate evidence, actions, audit trail. */
export function ReviewQueueEntry({
  delta,
  state,
  reviewTrail,
  getVersion,
  deliveries,
}: ReviewQueueEntryProps) {
  const actions = allowedReviewActions(state);
  return (
    <article className="delta-entry queue-entry" data-testid={`queue-entry-${state}`}>
      <p className="delta-margin-note">
        <span className={`stamp ${STATE_CLASS[state]}`} data-testid="workflow-state">
          {STATE_LABEL[state]}
        </span>{' '}
        · {delta.jurisdiction} / {delta.topic} · effective {delta.effectiveDate}
        {delta.publishedAt !== null ? <> · published {delta.publishedAt}</> : null}
      </p>
      <h3 className="delta-title">{delta.title}</h3>

      <DeltaBody bodyMd={delta.bodyMd} />
      <CitationEvidence delta={delta} getVersion={getVersion} />

      {actions.length > 0 ? (
        <ReviewActions delta={delta} actions={actions} />
      ) : (
        <p className="queue-terminal-note">
          No review actions available in this state
          {state === 'published' ? ` — fanned out to ${deliveries.length} deliveries.` : '.'}
        </p>
      )}

      <AuditTrail reviewTrail={reviewTrail} />
    </article>
  );
}

function DeltaBody({ bodyMd }: { readonly bodyMd: string }) {
  const blocks = parseDeltaBody(bodyMd);
  return (
    <div className="delta-body">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading':
            return <h4 key={i}>{block.text}</h4>;
          case 'label':
            return (
              <p key={i} className="delta-label">
                {block.text}
              </p>
            );
          case 'removal':
            return (
              <ul key={i} className="redline-list">
                <li>
                  <del>{block.text}</del>
                </li>
              </ul>
            );
          case 'addition':
            return (
              <ul key={i} className="redline-list">
                <li>
                  <ins>{block.text}</ins>
                </li>
              </ul>
            );
          default:
            return <p key={i}>{block.text}</p>;
        }
      })}
    </div>
  );
}

interface CitationEvidenceProps {
  readonly delta: Delta;
  readonly getVersion: (versionId: string) => SectionVersion | undefined;
}

/** Quoted spans with verification stamps and full version provenance. */
function CitationEvidence({ delta, getVersion }: CitationEvidenceProps) {
  return (
    <ul className="citation-list">
      {delta.citations.map((citation) => {
        const version = getVersion(citation.sectionVersionId);
        return (
          <li key={`${citation.sectionVersionId}-${citation.quoteSpan.slice(0, 24)}`}>
            <blockquote className="citation-quote">{citation.quoteSpan}</blockquote>
            <span className="citation-source">
              {citation.citation} · version <code>{citation.sectionVersionId}</code>{' '}
              {citation.verifiedAt === null ? (
                <span className="stamp stamp-pending">unverified</span>
              ) : (
                <span className="stamp stamp-verified">verified {citation.verifiedAt}</span>
              )}
            </span>
            {version !== undefined ? (
              <span className="citation-provenance">
                sha256 {version.contentHash.slice(0, 16)}… · retrieved {version.retrievedAt} ·{' '}
                {version.sourceUrl}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function AuditTrail({ reviewTrail }: { readonly reviewTrail: readonly ReviewRecord[] }) {
  return (
    <details className="audit-trail" open>
      <summary>Audit trail ({reviewTrail.length})</summary>
      <ol className="review-trail">
        {reviewTrail.map((record) => (
          <li key={record.id}>
            <span className="stamp stamp-review">{record.status}</span>
            <code>{record.reviewerId}</code>
            <span>{record.decidedAt ?? 'pending'}</span>
            {record.notes.length > 0 ? <span className="review-notes">{record.notes}</span> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
