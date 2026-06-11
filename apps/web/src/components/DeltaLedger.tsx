import type { Delta, GateResult, ReviewRecord } from '@statutory/core';

import { parseDeltaBody } from '../lib/deltaBody';

interface DeltaLedgerProps {
  readonly delta: Delta;
  readonly gate: GateResult;
}

/**
 * Ledger-style published delta: left rule, effective-date margin note,
 * redline body, and every quoted span with its verification stamp.
 */
export function DeltaLedger({ delta, gate }: DeltaLedgerProps) {
  const blocks = parseDeltaBody(delta.bodyMd);
  return (
    <section className="slice-section" aria-labelledby="delta-heading">
      <h2 id="delta-heading">
        Published delta — {delta.jurisdiction} / {delta.topic}
      </h2>
      <article className="delta-entry">
        <p className="delta-margin-note">
          Effective {delta.effectiveDate} · published {delta.publishedAt ?? '—'} ·{' '}
          <span className="stamp stamp-verified">
            span-verified {gate.ok ? `${gate.spanChecks.length}/${gate.spanChecks.length}` : ''}
          </span>{' '}
          <span className="stamp stamp-review">attorney-approved</span>
        </p>
        <h3 className="delta-title">{delta.title}</h3>

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

        <ul className="citation-list">
          {delta.citations.map((citation) => (
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
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}

interface ReviewTrailProps {
  readonly reviewTrail: readonly ReviewRecord[];
}

/** Attorney review trail: publication required the approved record below. */
export function ReviewTrail({ reviewTrail }: ReviewTrailProps) {
  return (
    <section className="slice-section" aria-labelledby="review-heading">
      <h2 id="review-heading">Review trail — approval gates publication</h2>
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
    </section>
  );
}
