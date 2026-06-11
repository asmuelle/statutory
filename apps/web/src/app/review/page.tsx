import Link from 'next/link';

import { workflowStateOf } from '@statutory/pipeline';

import { CoverageFooter } from '../../components/CoverageFooter';
import { ReviewQueueEntry } from '../../components/review/ReviewQueueEntry';
import { ReviewerBar, SignInPanel } from '../../components/review/ReviewerBar';
import { getReviewQueue } from './queue';
import { getReviewer } from './session';

import { M1_COVERAGE_MANIFEST } from '@statutory/core';

/**
 * Attorney review queue (M2): approve / edit / reject over the live review
 * trail. State is derived through the core review state machine on every
 * render; actions are server actions that share the same enforcement path
 * as the pipeline tests. Requires a (mock) reviewer session.
 */

export const dynamic = 'force-dynamic';

interface ReviewPageProps {
  readonly searchParams: Promise<{ readonly error?: string }>;
}

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const [{ error }, reviewer, queue] = await Promise.all([
    searchParams,
    getReviewer(),
    getReviewQueue(),
  ]);

  const deltas = queue.store.listDeltas();

  return (
    <div className="page">
      <header className="masthead masthead-compact">
        <p className="masthead-kicker">
          <Link href="/">← Rulebook</Link>
        </p>
        <h1 className="masthead-brand">Review queue</h1>
        <p className="masthead-tagline">
          Nothing reaches a user surface without the deterministic gate AND an approval recorded
          below. Edits strip verification stamps and re-run the gate.
        </p>
      </header>

      <main>
        {error !== undefined && error.length > 0 ? (
          <p className="review-error" role="alert">
            {error}
          </p>
        ) : null}

        {reviewer === null ? (
          <SignInPanel />
        ) : (
          <>
            <ReviewerBar reviewer={reviewer} />
            <section className="slice-section" aria-labelledby="queue-heading">
              <h2 id="queue-heading">
                Deltas <span className="queue-count">({deltas.length})</span>
              </h2>
              {deltas.map((delta) => (
                <ReviewQueueEntry
                  key={delta.id}
                  delta={delta}
                  state={workflowStateOf(queue.store, delta.id)}
                  reviewTrail={queue.store.reviewTrail(delta.id)}
                  getVersion={(id) => queue.store.getVersion(id)}
                  deliveries={queue.store.listDeliveries().filter((d) => d.deltaId === delta.id)}
                />
              ))}
            </section>
          </>
        )}
      </main>

      <CoverageFooter manifest={M1_COVERAGE_MANIFEST} />
    </div>
  );
}
