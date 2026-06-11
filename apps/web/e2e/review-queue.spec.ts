import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Interactive review queue (M2): mocked reviewer session, approve flow,
 * reject-with-reason, and the edit-re-runs-the-gate loop. State lives in a
 * server-side in-memory queue reseeded via POST /api/test/reset.
 */

test.describe.configure({ mode: 'serial' });

const signIn = async (page: Page, reviewerId: string): Promise<void> => {
  await page.goto('/review');
  await page.getByLabel('Reviewer id').fill(reviewerId);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('reviewer-id')).toHaveText(reviewerId);
};

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/test/reset');
  expect(response.ok()).toBe(true);
});

test('the queue demands a reviewer session before showing actions', async ({ page }) => {
  await page.goto('/review');

  await expect(page.getByRole('heading', { name: 'Reviewer sign-in' })).toBeVisible();
  await expect(page.getByTestId('workflow-state')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Approve/ })).toHaveCount(0);
});

test('approve flow: a signed-in reviewer publishes the pending delta', async ({ page }) => {
  await signIn(page, 'attorney-e2e');

  // One gate-passed delta awaits review; one seeded mutation is blocked.
  const pending = page.getByTestId('queue-entry-awaiting_review');
  const blocked = page.getByTestId('queue-entry-gate_blocked');
  await expect(pending).toHaveCount(1);
  await expect(blocked).toHaveCount(1);

  await pending.getByRole('button', { name: 'Approve & publish' }).click();

  // The delta is published; the audit trail names the reviewer.
  const published = page.getByTestId('queue-entry-published');
  await expect(published).toHaveCount(1);
  await expect(published.getByText('attorney-e2e').first()).toBeVisible();
  await expect(published.getByText(/fanned out to \d+ deliveries/)).toBeVisible();
  // The blocked mutation is still blocked — approval has no effect on it.
  await expect(page.getByTestId('queue-entry-gate_blocked')).toHaveCount(1);
});

test('gate-blocked deltas offer no approve action at all', async ({ page }) => {
  await signIn(page, 'attorney-e2e');

  const blocked = page.getByTestId('queue-entry-gate_blocked');
  await expect(blocked).toHaveCount(1);
  await expect(blocked.getByRole('button', { name: 'Approve & publish' })).toHaveCount(0);
  await expect(blocked.getByRole('button', { name: 'Reject' })).toHaveCount(1);
});

test('reject flow: the reason is mandatory and lands in the audit trail', async ({ page }) => {
  await signIn(page, 'attorney-e2e');

  const blocked = page.getByTestId('queue-entry-gate_blocked');
  await blocked
    .getByLabel('Rejection reason (required, recorded)')
    .fill('Corrupted quote span: $884 does not appear in the source.');
  await blocked.getByRole('button', { name: 'Reject' }).click();

  const rejected = page.getByTestId('queue-entry-rejected');
  await expect(rejected).toHaveCount(1);
  await expect(
    rejected.getByText('Corrupted quote span: $884 does not appear in the source.'),
  ).toBeVisible();
});

test('edit flow: fixing the corrupted quote re-runs the gate and unblocks', async ({ page }) => {
  await signIn(page, 'attorney-e2e');

  const blocked = page.getByTestId('queue-entry-gate_blocked');
  const quoteInputs = blocked.locator('textarea[name^="quoteSpan-"]');
  const count = await quoteInputs.count();
  expect(count).toBeGreaterThan(0);

  // Find the corrupted span ($884 never appears in the source) and fix it.
  let fixedCorruptedQuote = false;
  for (let i = 0; i < count; i += 1) {
    const value = await quoteInputs.nth(i).inputValue();
    if (value.includes('$884')) {
      await quoteInputs.nth(i).fill(value.replace('$884', '$844'));
      fixedCorruptedQuote = true;
    }
  }
  expect(fixedCorruptedQuote).toBe(true);
  await blocked.getByRole('button', { name: 'Save edit & re-run gate' }).click();

  // The gate re-ran and passed: nothing is blocked, both deltas await review.
  await expect(page.getByTestId('queue-entry-gate_blocked')).toHaveCount(0);
  await expect(page.getByTestId('queue-entry-awaiting_review')).toHaveCount(2);
});
