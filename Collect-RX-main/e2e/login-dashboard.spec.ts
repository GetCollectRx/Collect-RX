/**
 * P7-01 — E2E happy path: sign in and land on dashboard.
 * E2E_USER_EMAIL / E2E_USER_PASSWORD are seeded by e2e/globalSetup.ts when unset.
 */
import { test, expect } from '@playwright/test';
import { signInAsE2eUser } from './helpers/signIn';

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD || 'changeme';

test('sees dashboard after sign-in', async ({ page }) => {
  test.skip(!email, 'E2E_USER_EMAIL missing — check DATABASE_URL for e2e auto-seed');

  await signInAsE2eUser(page, email!, password);
  await expect(page.getByText('Command center', { exact: true })).toBeVisible();
});
