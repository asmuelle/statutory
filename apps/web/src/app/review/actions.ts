'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { approveAndPublish, editDelta, rejectDelta } from '@statutory/pipeline';

import { getReviewQueue } from './queue';
import { REVIEWER_COOKIE, getReviewer, parseReviewerId } from './session';

/**
 * Server actions for the attorney review queue. Each action re-derives the
 * delta's workflow state and goes through the shared state-machine-enforced
 * pipeline operations — the UI can never publish, edit, or reject outside
 * the rules the tests pin down (drafts cannot publish unreviewed; edits
 * re-run the gate; rejections must record a reason).
 */

const errorMessageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unexpected error.';

const finishReviewAction = (errorMessage: string | null): never => {
  revalidatePath('/review');
  redirect(errorMessage === null ? '/review' : `/review?error=${encodeURIComponent(errorMessage)}`);
};

const fieldOf = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export async function signInAction(formData: FormData): Promise<void> {
  const reviewerId = parseReviewerId(fieldOf(formData, 'reviewerId'));
  if (reviewerId === null) {
    finishReviewAction('Reviewer id must be 2–64 letters, digits, or hyphens.');
  }
  const jar = await cookies();
  jar.set(REVIEWER_COOKIE, reviewerId ?? '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  finishReviewAction(null);
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(REVIEWER_COOKIE);
  finishReviewAction(null);
}

export async function approveAction(formData: FormData): Promise<void> {
  const reviewer = await getReviewer();
  if (reviewer === null) {
    finishReviewAction('Sign in as a reviewer before approving.');
  }
  let errorMessage: string | null = null;
  try {
    const queue = await getReviewQueue();
    approveAndPublish(queue.store, {
      deltaId: fieldOf(formData, 'deltaId'),
      reviewerId: reviewer ?? 'unknown',
      notes: fieldOf(formData, 'notes').trim() || 'Approved via review queue.',
      decidedAt: new Date().toISOString(),
      profiles: queue.profiles,
    });
  } catch (error: unknown) {
    errorMessage = errorMessageOf(error);
  }
  finishReviewAction(errorMessage);
}

export async function rejectAction(formData: FormData): Promise<void> {
  const reviewer = await getReviewer();
  if (reviewer === null) {
    finishReviewAction('Sign in as a reviewer before rejecting.');
  }
  let errorMessage: string | null = null;
  try {
    const queue = await getReviewQueue();
    rejectDelta(queue.store, {
      deltaId: fieldOf(formData, 'deltaId'),
      reviewerId: reviewer ?? 'unknown',
      reason: fieldOf(formData, 'reason'),
      decidedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    errorMessage = errorMessageOf(error);
  }
  finishReviewAction(errorMessage);
}

export async function editAction(formData: FormData): Promise<void> {
  const reviewer = await getReviewer();
  if (reviewer === null) {
    finishReviewAction('Sign in as a reviewer before editing.');
  }
  let errorMessage: string | null = null;
  try {
    const queue = await getReviewQueue();
    const deltaId = fieldOf(formData, 'deltaId');
    const delta = queue.store.getDelta(deltaId);
    if (delta === undefined) {
      throw new Error(`Unknown delta: ${deltaId}`);
    }
    const effectiveDate = fieldOf(formData, 'effectiveDate').trim();
    // One field per quoted span; blank fields keep the existing quote.
    const citations = delta.citations.map((c, i) => {
      const provided = fieldOf(formData, `quoteSpan-${i}`).trim();
      return {
        citation: c.citation,
        sectionVersionId: c.sectionVersionId,
        quoteSpan: provided.length > 0 ? provided : c.quoteSpan,
      };
    });
    editDelta(
      queue.store,
      {
        deltaId,
        editorId: reviewer ?? 'unknown',
        patch: {
          citations,
          ...(effectiveDate.length > 0 ? { effectiveDate } : {}),
        },
        editedAt: new Date().toISOString(),
      },
      queue.frDoc,
    );
  } catch (error: unknown) {
    errorMessage = errorMessageOf(error);
  }
  finishReviewAction(errorMessage);
}
