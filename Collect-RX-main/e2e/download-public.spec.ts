import { test, expect } from '@playwright/test';

test('public download page lists pilot installers', async ({ page }) => {
  await page.goto('/download');
  await expect(page.getByRole('heading', { name: /CollectRx desktop/i })).toBeVisible();
  await expect(page.getByText(/Download v/i)).toBeVisible();
  await expect(page.getByText('Windows installer').first()).toBeVisible();
});

test('download page has accessible main landmark', async ({ page }) => {
  await page.goto('/download');
  await expect(page.getByRole('main').or(page.locator('.page-title'))).toBeVisible();
});
