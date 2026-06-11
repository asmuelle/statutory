import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * M3 onboarding: the practice-profile wizard, the upgrade prompt at the
 * jurisdiction limit (Core covers 1 bundle), the $19/mo add-on purchase
 * through the mock billing provider, and the profile-scoped rulebook +
 * delta feed that completing onboarding unlocks.
 */

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/test/reset');
  expect(response.ok()).toBe(true);
});

const fillCoreWizard = async (
  page: Page,
  options?: { readonly jurisdictions?: readonly string[] },
): Promise<void> => {
  await page.goto('/onboarding');
  await page.locator('#plan-core').check();
  for (const j of options?.jurisdictions ?? ['us-federal']) {
    await page.locator(`#j-${j}`).check();
  }
  await page.locator('#pa-employment').check();
  await page.locator('#ct-small-business').check();
  await page.getByLabel('Your name').fill('Maren Voss');
};

test('server-side validation rejects an empty jurisdiction selection', async ({ page }) => {
  await page.goto('/onboarding');
  await page.locator('#plan-core').check();
  // No jurisdiction checked; fill the rest so zod reaches the jurisdiction rule.
  await page.locator('#pa-employment').check();
  await page.locator('#ct-small-business').check();
  await page.getByLabel('Your name').fill('Maren Voss');
  await page.getByRole('button', { name: 'Complete onboarding' }).click();

  await expect(page.locator('p.review-error')).toHaveText('Select at least one jurisdiction.');
  await expect(page.getByTestId('upgrade-prompt')).toHaveCount(0);
});

test('the upgrade prompt appears at the jurisdiction limit and the add-on unblocks it', async ({
  page,
}) => {
  // Core covers 1 jurisdiction; selecting two must hit the limit.
  await fillCoreWizard(page, { jurisdictions: ['us-federal', 'us-ca'] });
  await page.getByRole('button', { name: 'Complete onboarding' }).click();

  const prompt = page.getByTestId('upgrade-prompt');
  await expect(prompt).toBeVisible();
  await expect(page.getByTestId('upgrade-message')).toContainText(
    'Core covers 1 jurisdiction — you selected 2.',
  );
  await expect(page.getByTestId('upgrade-message')).toContainText('$19/mo');

  // Selections survived the round trip.
  await expect(page.locator('#j-us-ca')).toBeChecked();
  await expect(page.getByLabel('Your name')).toHaveValue('Maren Voss');

  // Buy the add-on through the (mock) billing provider.
  await page.getByTestId('purchase-addon').click();
  await expect(page.getByTestId('addon-notice')).toContainText(
    'your plan now covers 2 jurisdictions',
  );

  // Resubmit with the preserved selections: onboarding completes.
  await page.getByRole('button', { name: 'Complete onboarding' }).click();
  await expect(page).toHaveURL(/\/rulebook$/);
  await expect(page.getByTestId('profile-summary')).toContainText('us-federal, us-ca');
  await expect(page.getByTestId('profile-summary')).toContainText('Core · 2 jurisdictions');
});

test('completing onboarding scopes the rulebook and delta feed to the profile', async ({
  page,
}) => {
  await fillCoreWizard(page);
  await page.getByRole('button', { name: 'Complete onboarding' }).click();
  await expect(page).toHaveURL(/\/rulebook$/);

  // Profile summary reflects the wizard answers.
  const summary = page.getByTestId('profile-summary');
  await expect(summary).toContainText('Maren Voss');
  await expect(summary).toContainText('employment');
  await expect(summary).toContainText('small-business');

  // Scoped sections: the four monitored federal employment sections
  // (§§ 541.600, 541.602, 778.101, 785.1), each with provenance.
  const sections = page.getByTestId('scoped-section');
  await expect(sections).toHaveCount(4);
  await expect(sections.first()).toContainText('29 CFR § 541.600');
  await expect(sections.first()).toContainText('sha256');

  // The published delta reaches this profile's feed.
  const feedEntries = page.getByTestId('delta-feed-entry');
  await expect(feedEntries).toHaveCount(1);
  await expect(feedEntries.first()).toContainText('29 CFR § 541.600 amended');
  await expect(feedEntries.first().getByRole('link', { name: 'Draft client alert →' })).toBeVisible();

  // Coverage manifest stays honest on the scoped surface.
  await expect(
    page.locator('footer.coverage-footer').getByRole('heading', { name: 'NOT monitored' }),
  ).toBeVisible();
});

test('a non-matching profile gets honest empty states, not someone else’s rules', async ({
  page,
}) => {
  await page.goto('/onboarding');
  await page.locator('#plan-core').check();
  await page.locator('#j-us-federal').check();
  await page.locator('#pa-tax').check();
  await page.locator('#ct-s-corps').check();
  await page.getByLabel('Your name').fill('Rita Calloway');
  await page.getByRole('button', { name: 'Complete onboarding' }).click();

  await expect(page).toHaveURL(/\/rulebook$/);
  await expect(page.getByTestId('scoped-section')).toHaveCount(0);
  await expect(page.getByTestId('delta-feed-entry')).toHaveCount(0);
  await expect(page.getByText('No monitored sections map to this profile yet')).toBeVisible();
});

test('the rulebook requires onboarding: fresh sessions are redirected', async ({ page }) => {
  await page.goto('/rulebook');
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByTestId('onboarding-wizard')).toBeVisible();
});
