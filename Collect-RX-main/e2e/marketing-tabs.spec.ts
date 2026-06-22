import { test, expect } from '@playwright/test';
import { MARKETING_NAV_TABS, MARKETING_PAGE_TITLES } from '../src/website/marketingPaths';

const SECTION_IDS: Record<string, string> = {
  home: 'marketing-home-hero',
  'how-it-works': 'marketing-how-it-works',
  roi: 'marketing-roi',
  features: 'marketing-features',
  carriers: 'marketing-carriers',
  compliance: 'marketing-compliance',
};

const ALL_SECTIONS = Object.values(SECTION_IDS);

test.describe('marketing site tab navigation', () => {
  test('each nav tab navigates to its own URL and shows only that section', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('marketing-home-hero')).toBeVisible();
    for (const id of ALL_SECTIONS.filter(s => s !== 'marketing-home-hero')) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }

    for (const tab of MARKETING_NAV_TABS) {
      await page.getByRole('link', { name: tab.label, exact: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`${tab.path.replace(/\//g, '\\/')}$`));
      await expect(page.getByTestId(SECTION_IDS[tab.id])).toBeVisible();
      for (const other of ALL_SECTIONS.filter(s => s !== SECTION_IDS[tab.id])) {
        await expect(page.getByTestId(other)).toHaveCount(0);
      }
      await expect(page).toHaveTitle(MARKETING_PAGE_TITLES[tab.id]);
    }
  });

  test('legacy hash URLs redirect to dedicated pages', async ({ page }) => {
    await page.goto('/#roi');
    await expect(page).toHaveURL(/\/roi$/);
    await expect(page.getByTestId('marketing-roi')).toBeVisible();
    await expect(page.getByTestId('marketing-home-hero')).toHaveCount(0);
  });

  test('direct URL loads the correct section', async ({ page }) => {
    await page.goto('/carriers');
    await expect(page.getByTestId('marketing-carriers')).toBeVisible();
    await expect(page.getByTestId('marketing-home-hero')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Carriers', exact: true }).first()).toHaveClass(/active/);
  });
});
