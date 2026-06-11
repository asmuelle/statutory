import { cookies } from 'next/headers';

/**
 * Mock reviewer session for the M2 review queue: an httpOnly cookie carrying
 * a validated reviewer id. Real authentication arrives with billing (M3);
 * every review action still refuses to run without a session, so the
 * audit trail always names a reviewer.
 */

export const REVIEWER_COOKIE = 'statutory_reviewer';

const REVIEWER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/i;

/** Validate a reviewer id (slug-shaped, 2–64 chars); null when invalid. */
export const parseReviewerId = (raw: unknown): string | null => {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return REVIEWER_ID_PATTERN.test(trimmed) ? trimmed : null;
};

/** The signed-in reviewer id, or null when no valid session exists. */
export const getReviewer = async (): Promise<string | null> => {
  const jar = await cookies();
  return parseReviewerId(jar.get(REVIEWER_COOKIE)?.value);
};
