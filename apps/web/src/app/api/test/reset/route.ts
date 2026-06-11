import { resetAccountSession } from '../../../account/session';
import { resetReviewQueue } from '../../../review/queue';

/**
 * Test-only reset endpoint: reseeds the in-memory review queue and clears
 * accounts + the mock billing provider so Playwright specs are isolated.
 * Disabled in production unless STATUTORY_TEST_MODE=1 explicitly opts in
 * (never set in any deployed environment).
 */
export async function POST(): Promise<Response> {
  const isProduction = process.env.NODE_ENV === 'production';
  const testModeEnabled = process.env['STATUTORY_TEST_MODE'] === '1';
  if (isProduction && !testModeEnabled) {
    return new Response('Not found', { status: 404 });
  }
  resetReviewQueue();
  resetAccountSession();
  return Response.json({ ok: true });
}
