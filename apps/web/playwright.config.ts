import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests against the production build (`vite preview`). The API is mocked
 * per test with page.route, so no backend or database is needed.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/login',
    reuseExistingServer: !process.env['CI'],
  },
});
