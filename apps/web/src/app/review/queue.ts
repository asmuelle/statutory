import { createReviewQueueFixture } from '@statutory/pipeline';
import type { ReviewQueueFixture } from '@statutory/pipeline';

/**
 * Server-side review queue state. M2 runs the queue over the in-memory
 * repository seeded from archived fixtures (the DB-backed repository is
 * exercised by `just test-db`); a globalThis cache keeps one queue alive
 * across requests and dev-mode module reloads.
 */

const QUEUE_KEY = Symbol.for('statutory.reviewQueue.m2');

interface QueueHolder {
  promise: Promise<ReviewQueueFixture> | null;
}

const holder = (): QueueHolder => {
  const globalRecord = globalThis as unknown as Record<symbol, QueueHolder | undefined>;
  const existing = globalRecord[QUEUE_KEY];
  if (existing !== undefined) {
    return existing;
  }
  const fresh: QueueHolder = { promise: null };
  globalRecord[QUEUE_KEY] = fresh;
  return fresh;
};

/** The shared review queue, seeded on first access. */
export const getReviewQueue = (): Promise<ReviewQueueFixture> => {
  const h = holder();
  if (h.promise === null) {
    h.promise = createReviewQueueFixture();
  }
  return h.promise;
};

/** Reset to a freshly seeded queue (test isolation; see /api/test/reset). */
export const resetReviewQueue = (): void => {
  holder().promise = null;
};
