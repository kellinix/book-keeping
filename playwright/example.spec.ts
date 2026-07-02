import { test, expect } from '@playwright/test';

test('homepage shows title', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=VoiceLedger')).toBeVisible();
});

// Basic auth flow smoke (UI) - requires a running Supabase; this is a lightweight check
test('navigate to register and login pages', async ({ page }) => {
  await page.goto('/auth/register');
  await expect(page.locator('text=Create an account')).toBeVisible();
  await page.goto('/auth/login');
  await expect(page.locator('text=Sign in')).toBeVisible();
});
