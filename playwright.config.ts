import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'playwright',
  timeout: 30_000,
  expect: { timeout: 5000 },
  webServer: { command: 'npm.cmd run dev', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120_000 },
  use: { headless: true, baseURL: 'http://localhost:3000' }
});
