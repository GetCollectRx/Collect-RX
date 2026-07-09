/**
 * Pre-visit command center — replaces legacy /canadian-2026 route (now /pre-visit).
 */
import { test, expect, type Page } from '@playwright/test';

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD || 'changeme';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test('pre-visit command center renders CDCP modules', async ({ page }) => {
  test.skip(!email, 'Set DATABASE_URL and run db:seed, or set E2E_USER_EMAIL');

  await signIn(page);

  await page.goto('/pre-visit');
  await expect(
    page.getByRole('heading', { name: 'Pre-visit command center' })
  ).toBeVisible({ timeout: 10_000 });

  await expect(page.getByText('Open CDCP cases')).toBeVisible();
  await expect(page.getByText('GREEN verifications')).toBeVisible();

  await page.getByRole('button', { name: 'CDCP deadlines' }).click();
  await expect(page.getByRole('heading', { name: 'CDCP deadline tracker' })).toBeVisible();

  await page.getByRole('button', { name: 'KPIs' }).click();
  await expect(page.getByRole('heading', { name: 'Phase 5 KPIs (30 days)' })).toBeVisible();
});
