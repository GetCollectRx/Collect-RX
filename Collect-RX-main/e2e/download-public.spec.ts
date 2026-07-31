import { test, expect } from '@playwright/test';

async function dismissCookieNotice(page: import('@playwright/test').Page) {
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  if (await ok.isVisible().catch(() => false)) {
    await ok.click();
  }
}

test('public download page lists pilot installers', async ({ page }) => {
  await page.goto('/download');
  await dismissCookieNotice(page);

  // Heading is behind an aria-modal cookie dialog until dismissed; also wait for
  // release fetch to finish (DataState hides children while loading).
  await expect(page.getByRole('heading', { name: /CollectRx desktop/i })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/Download v/i)).toBeVisible();
  await expect(page.getByText('Windows installer').first()).toBeVisible();
});

test('download page has accessible main landmark', async ({ page }) => {
  await page.goto('/download');
  await dismissCookieNotice(page);
  await expect(page.getByRole('heading', { name: /CollectRx desktop/i }).or(page.locator('.page-title'))).toBeVisible({
    timeout: 20_000,
  });
});
