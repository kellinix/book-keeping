import { test, expect } from '@playwright/test';

test('homepage shows title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your books/ })).toBeVisible();
});

// Basic auth flow smoke (UI) - requires a running Supabase; this is a lightweight check
test('navigate to register and login pages', async ({ page }) => {
  await page.goto('/auth/register');
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await page.goto('/auth/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('mobile landing page keeps the primary action visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Get started free', exact: true })).toBeVisible();
});
