import { expect, test } from '@playwright/test';

/**
 * The living-rulebook page: published delta, amended section with full
 * provenance (source URL, retrieval time, hash ledger), and the coverage
 * manifest — all rendered from the fixture-replayed pipeline.
 */

test('rulebook page renders the published slice end to end', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Statutory' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rulebook — amended section' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '§ 541.600 Amount of salary required.' }),
  ).toBeVisible();
});

test('every section shows provenance: hash, retrieval time, source URL', async ({ page }) => {
  await page.goto('/');

  const ledger = page.getByRole('list', { name: 'Version history (append-only)' });
  await expect(ledger).toBeVisible();
  await expect(ledger.getByText(/sha256/).first()).toBeVisible();
  await expect(ledger.getByText(/retrieved 2024-04-01/).first()).toBeVisible();
  await expect(ledger.getByText(/ecfr\.gov/).first()).toBeVisible();
});

test('the coverage manifest is honest about what is NOT monitored', async ({ page }) => {
  await page.goto('/');

  const footer = page.locator('footer.coverage-footer');
  await expect(footer.getByRole('heading', { name: 'Coverage manifest' })).toBeVisible();
  await expect(footer.getByRole('heading', { name: 'NOT monitored' })).toBeVisible();
  await expect(footer.getByText('State and local ordinances', { exact: true })).toBeVisible();
  await expect(footer.getByText(/not legal advice/i)).toBeVisible();
});
