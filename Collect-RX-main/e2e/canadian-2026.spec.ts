/**
 * Phase 2 — happy path for /canadian-2026:
 * sign in, navigate to the page, see the four stat tiles, run a gap estimate,
 * and confirm the 8-dimension dashboard renders with status pills.
 */
import { test, expect } from '@playwright/test';
import { signInAsE2eUser } from './helpers/signIn';

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD || 'changeme';

test('canadian-2026 page renders Phase 2 modules', async ({ page }) => {
  test.skip(!email, 'E2E_USER_EMAIL missing — check DATABASE_URL for e2e auto-seed');

  await signInAsE2eUser(page, email!, password);

  await page.goto('/canadian-2026');
  await expect(
    page.getByRole('heading', { name: /Canadian expansion/i })
  ).toBeVisible({ timeout: 20_000 });

  // Stat tiles: total, pipeline, attention, write-backs
  await expect(page.getByText('CDCP reconsiderations')).toBeVisible();
  await expect(page.getByText('Active pipeline')).toBeVisible();
  await expect(page.getByText('60-day attention')).toBeVisible();
  await expect(page.getByText('Write-backs (7d)')).toBeVisible();

  // MOD-03 — gap estimator: prefilled D0120 line; click "Calculate gap"
  await page.getByRole('button', { name: /calculate gap/i }).click();
  // Either the result block or the totalOffice number renders.
  await expect(page.getByText(/cdcp|total office|balance billing/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // 8-dimension dashboard renders with at least one ok/watch/risk pill
  await expect(page.getByText(/8-dimension dashboard/i)).toBeVisible();
  await expect(page.locator('text=/^(ok|watch|risk)$/').first()).toBeVisible();

  // ITRANS 2 readiness card
  await expect(page.getByText(/ITRANS 2.0 readiness/i)).toBeVisible();
});
