import { test, expect } from '@playwright/test';

async function dismissCookieNotice(page: import('@playwright/test').Page) {
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  if (await ok.isVisible().catch(() => false)) {
    await ok.click();
  }
}

// The desktop connector download surface is gated off (src/pages/DesktopDownload.tsx —
// `desktopConnectorAvailable = false`, since d156b36, 2026-09-20): the current pilot
// intake is CSV-only, and installers stay hidden until product/security/deployment/
// support explicitly re-enables this surface. These specs assert that gated state.
test('public download page explains desktop connector is unavailable', async ({ page }) => {
  await page.goto('/download');
  await dismissCookieNotice(page);

  await expect(
    page.getByRole('heading', { name: /Desktop connector unavailable/i }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Current supported intake: CSV only/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Import a reviewed CSV export/i })).toBeVisible();
});

test('download page has accessible main landmark', async ({ page }) => {
  await page.goto('/download');
  await dismissCookieNotice(page);
  await expect(
    page.getByRole('heading', { name: /Desktop connector unavailable/i }).or(page.locator('.page-title')),
  ).toBeVisible({ timeout: 20_000 });
});
