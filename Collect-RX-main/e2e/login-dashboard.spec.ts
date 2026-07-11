/**
 * P7-01 — E2E happy path: sign in and land on dashboard.
 * E2E_USER_EMAIL / E2E_USER_PASSWORD are seeded by e2e/globalSetup.ts when unset.
 */
import { test, expect } from '@playwright/test';

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD || 'changeme';

test('sees dashboard after sign-in', async ({ page }) => {
  test.skip(!email, 'E2E_USER_EMAIL missing — check DATABASE_URL for e2e auto-seed');

  await page.goto('/login');

  await expect(page.getByRole('main', { name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect(page.getByText('Command center', { exact: true })).toBeVisible();
});
