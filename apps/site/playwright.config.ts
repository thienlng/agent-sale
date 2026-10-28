import { defineConfig, devices } from '@playwright/test';

/** Browser checks against the static build (`astro preview`); no backend needed. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4322', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm astro preview --port 4322 --ignore-lock',
    url: 'http://localhost:4322/',
    reuseExistingServer: !process.env['CI'],
  },
});
