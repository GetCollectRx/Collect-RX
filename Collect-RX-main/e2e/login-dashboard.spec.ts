/**
 * P7-01 — E2E happy path: sign in and land on dashboard.
 * Set E2E_PRACTICE_ID (e.g. from `npm run e2e:print-id` after `db:seed`); password defaults to `changeme`.
 */
import { test, expect } from '@playwright/test';

const practiceId = process.env.E2E_PRACTICE_ID;
const password = process.env.E2E_PRACTICE_PASSWORD || 'changeme';

test('sees dashboard after sign-in', async ({ page }) => {
  test.skip(!practiceId, 'Set E2E_PRACTICE_ID (db:seed, then npm run e2e:print-id)');

  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Sign in to CollectRx/i })).toBeVisible();

  await page.getByLabel('Practice ID').fill(practiceId!);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
});
