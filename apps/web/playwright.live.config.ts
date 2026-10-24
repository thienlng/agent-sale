import { defineConfig, devices } from '@playwright/test';

/**
 * Live-backend regression suite (#23): the real API and Postgres behind the built
 * web app, no mocks. Each run signs up a new shop, so runs never share data and
 * need no cleanup. The mocked smoke tests stay in `playwright.config.ts`.
 *
 * Needs a migrated database and the backend env (DATABASE_URL, DATABASE_SYSTEM_URL).
 * Locally, running dev servers are reused; set LIVE_WEB_URL=http://localhost:5173
 * to drive the Vite dev server instead of `vite preview`.
 */
const CI = Boolean(process.env['CI']);
const webUrl = process.env['LIVE_WEB_URL'];

export default defineConfig({
  testDir: './e2e-live',
  // One shop, one story: the steps build on each other.
  workers: 1,
  forbidOnly: CI,
  retries: 0,
  timeout: 60_000,
  reporter: CI ? 'github' : 'list',
  use: { baseURL: webUrl ?? 'http://localhost:4174', trace: 'retain-on-failure' },
  projects: [{ name: 'live', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --dir ../backend start:api',
      url: 'http://localhost:3000/api/v1/health',
      // The cookie refresh endpoint only answers the web app's own origins.
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
        ),
        APP_ORIGINS: 'http://localhost:4174,http://localhost:5173',
      },
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    ...(webUrl
      ? []
      : [
          {
            // `vite preview` proxies /api to the backend like the dev server.
            command: 'pnpm vite preview --port 4174 --strictPort',
            url: 'http://localhost:4174/login',
            reuseExistingServer: !CI,
          },
        ]),
  ],
});
