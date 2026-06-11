import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * M3 client-alert artifact: open a published delta from the scoped rulebook,
 * verify the print-ready draft (citation footnotes with effective dates,
 * not-legal-advice frame), copy-to-clipboard, and the white-label gate
 * (locked on Core, letterhead on Practice Pro).
 */

test.describe.configure({ mode: 'serial' });
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/test/reset');
  expect(response.ok()).toBe(true);
});

const completeOnboarding = async (
  page: Page,
  options: { readonly plan: 'core' | 'practice-pro'; readonly firmName?: string },
): Promise<void> => {
  await page.goto('/onboarding');
  await page.locator(`#plan-${options.plan}`).check();
  await page.locator('#j-us-federal').check();
  await page.locator('#pa-employment').check();
  await page.locator('#ct-small-business').check();
  await page.getByLabel('Your name').fill('Maren Voss');
  if (options.firmName !== undefined) {
    await page.getByLabel('Firm name (optional)').fill(options.firmName);
  }
  await page.getByRole('button', { name: 'Complete onboarding' }).click();
  await expect(page).toHaveURL(/\/rulebook$/);
};

const openAlertFromFeed = async (page: Page): Promise<void> => {
  await page.getByRole('link', { name: 'Draft client alert →' }).click();
  await expect(page.getByTestId('client-alert')).toBeVisible();
};

test('opening a published delta renders the verified client-alert draft', async ({ page }) => {
  await completeOnboarding(page, { plan: 'core' });
  await openAlertFromFeed(page);

  const sheet = page.getByTestId('client-alert');
  await expect(sheet.getByRole('heading', { level: 1 })).toContainText(
    '29 CFR § 541.600 amended',
  );
  await expect(sheet.getByText('Effective date:')).toBeVisible();

  // Citation footnotes: verbatim span, effective date, verification stamp.
  const footnotes = page.getByTestId('alert-footnotes');
  await expect(footnotes.locator('li')).toHaveCount(2);
  await expect(footnotes.getByText('29 CFR § 541.600 · effective 2024-07-01').first()).toBeVisible();
  await expect(footnotes.getByText(/span-verified 2024-07-01/).first()).toBeVisible();

  // The not-legal-advice frame is part of the artifact, not optional chrome.
  await expect(page.getByTestId('not-legal-advice')).toContainText('not legal advice');
  await expect(sheet.getByText(/NOT monitored/)).toBeVisible();
});

test('copy-to-clipboard captures the full plain-text artifact', async ({ page }) => {
  await completeOnboarding(page, { plan: 'core' });
  await openAlertFromFeed(page);

  await page.getByTestId('copy-alert').click();
  await expect(page.getByTestId('copy-alert')).toHaveText('Copied');

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain('29 CFR § 541.600 amended');
  expect(clipboard).toContain('[1] 29 CFR § 541.600');
  expect(clipboard).toContain('effective 2024-07-01');
  expect(clipboard).toContain('not legal advice');
});

test('white-label is locked on Core with an upgrade pointer', async ({ page }) => {
  await completeOnboarding(page, { plan: 'core', firmName: 'Voss Employment Law' });
  await openAlertFromFeed(page);

  await expect(page.getByTestId('white-label-locked')).toContainText('Practice Pro');
  await expect(page.getByTestId('white-label-link')).toHaveCount(0);
  // Standard branding renders the product line, no firm letterhead.
  await expect(page.getByTestId('alert-byline')).toHaveText('Prepared with Statutory');
  await expect(page.getByTestId('alert-firm')).toHaveCount(0);
});

test('Practice Pro renders the white-label letterhead with the firm name', async ({ page }) => {
  await completeOnboarding(page, { plan: 'practice-pro', firmName: 'Voss Employment Law' });
  await openAlertFromFeed(page);

  await page.getByTestId('white-label-link').click();
  await expect(page.getByTestId('alert-firm')).toHaveText('Voss Employment Law');
  await expect(page.getByTestId('alert-byline')).toHaveCount(0);

  // The white-labeled clipboard text leads with the firm, not Statutory.
  await page.getByTestId('copy-alert').click();
  await expect(page.getByTestId('copy-alert')).toHaveText('Copied');
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard.startsWith('Voss Employment Law')).toBe(true);
  expect(clipboard).not.toContain('Prepared with Statutory');
});

test('unknown or unpublished deltas 404 instead of leaking drafts', async ({ page }) => {
  await completeOnboarding(page, { plan: 'core' });
  const response = await page.goto('/alerts/delta-999');
  expect(response?.status()).toBe(404);
});
