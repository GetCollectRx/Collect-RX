import { expect, type Page } from '@playwright/test';

/**
 * Local login shows "Continue to demo practice" with email/password inside a
 * collapsed <details>. Production shows the form immediately.
 */
export async function signInAsE2eUser(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');

  const cookieOk = page.getByRole('button', { name: 'OK', exact: true });
  if (await cookieOk.isVisible().catch(() => false)) {
    await cookieOk.click();
  }

  await expect(page.getByRole('main', { name: 'Sign in' })).toBeVisible();

  const emailInput = page.getByLabel('Email');
  if (!(await emailInput.isVisible())) {
    await page.locator('details summary', { hasText: 'Sign in with email instead' }).click();
    await expect(emailInput).toBeVisible();
  }

  await emailInput.fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}
