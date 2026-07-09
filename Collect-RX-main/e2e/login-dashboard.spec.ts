/**
 * P7-01 — E2E happy path: sign in with email/password and land on dashboard.
 * Credentials come from globalSetup (db:seed user or auto-seeded E2E user).
 */
import { test, expect } from '@playwright/test';

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD || 'changeme';

test('sees dashboard after sign-in', async ({ page }) => {
  test.skip(!email, 'Set DATABASE_URL and run db:seed, or set E2E_USER_EMAIL');

  await page.goto('/login');

  await expect(page.getByRole('heading', { name: /CollectRx/i })).toBeVisible();

  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect(page.locator('h1.crx-h1')).toBeVisible({ timeout: 20_000 });
});
