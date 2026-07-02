import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'playwright',
  timeout: 30_000,
  expect: { timeout: 5000 },
  use: { headless: true, baseURL: 'http://localhost:3000' }
});
