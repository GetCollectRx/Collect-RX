/**
 * Full-render smoke test — added 2026-08-09 after the app was found completely
 * blank on every page load (App.tsx used `lazy` from `react` before importing it;
 * src/billing/tiers.ts crashed the browser bundle with `process is not defined`
 * because it's imported directly by the public LandingPage). Both are fixed, but
 * nothing before this file would have caught either — there was no test asserting
 * the app actually mounts something visible. This is that test.
 */
import { test, expect } from '@playwright/test';
import { signInAsE2eUser } from './helpers/signIn';

const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD || 'changeme';

function trackPageErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test('public landing page renders real content, not a blank crashed shell', async ({ page }) => {
  const pageErrors = trackPageErrors(page);
  await page.goto('/');

  // Wait for the lazily-loaded MarketingSite chunk to actually mount before
  // measuring body content — otherwise this can catch the Suspense fallback
  // ("Loading…") instead of a real crash. If the bundle throws, this times
  // out and fails just as loudly.
  await expect(page.getByText(/CollectRx/i).first()).toBeVisible({ timeout: 10_000 });

  // A crashed React root leaves <body> essentially empty. Assert real, specific
  // marketing copy is present.
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.length).toBeGreaterThan(200);

  expect(pageErrors, `Uncaught page errors on landing load: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('pricing page renders tier content without a process.env crash', async ({ page }) => {
  // /pricing specifically exercises src/billing/tiers.ts in the browser bundle (via
  // src/website/pricingContent.ts's paidTierCards()) — the exact module that threw
  // "process is not defined" before the fix.
  const pageErrors = trackPageErrors(page);
  await page.goto('/pricing');
  await expect(page.getByText(/Core|Growth|Scale/).first()).toBeVisible({ timeout: 10_000 });
  expect(pageErrors, `Uncaught page errors rendering pricing content: ${pageErrors.join(' | ')}`).toEqual([]);
});

test('authenticated dashboard also mounts without a pageerror', async ({ page }) => {
  test.skip(!email, 'E2E_USER_EMAIL missing — check DATABASE_URL for e2e auto-seed');
  const pageErrors = trackPageErrors(page);
  await signInAsE2eUser(page, email!, password);
  await expect(page.getByText('Command center', { exact: true })).toBeVisible();
  expect(pageErrors, `Uncaught page errors on dashboard load: ${pageErrors.join(' | ')}`).toEqual([]);
});
