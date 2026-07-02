import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import { loadTarget } from './src/core/target-config';

dotenv.config();

// Resolve the Application Under Test from config/targets.json + GENIE_ENV.
// This drives baseURL (so tests use relative page.goto('/')) and, when the
// environment needs auth, the pre-authenticated storageState produced by
// tests/global-setup.ts.
const target = loadTarget();

// Video recording is opt-in: it needs the Playwright ffmpeg binary
// (`npx playwright install ffmpeg`) and slows tests down. Enable per-run with
// GENIE_VIDEO=on (or 'retain-on-failure' / 'on-first-retry'). Off by default.
const video = (process.env.GENIE_VIDEO ?? 'off') as
  | 'on'
  | 'off'
  | 'retain-on-failure'
  | 'on-first-retry';

export default defineConfig({
  testDir: './tests',
  // Unit tests run via playwright.unit.config.ts (offline, no browser).
  testIgnore: '**/unit/**',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // Log in once before the suite when the active environment requires auth.
  globalSetup: require.resolve('./tests/global-setup'),
  reporter: [
    ['html', { outputFolder: './reports/html', open: 'never' }],
    ['./src/reporter/genie-reporter.ts'],
  ],
  use: {
    // Target base URL — tests navigate with relative paths, e.g. page.goto('/').
    baseURL: target.baseURL,
    // Reuse the authenticated session saved by global-setup (auth envs only).
    storageState: target.auth.required ? target.storageStatePath : undefined,
    // Video recording is opt-in (see GENIE_VIDEO above); off by default so no
    // ffmpeg binary is required. When on, videos are stored under outputDir per test.
    video,
    // Capture screenshot only on failure
    screenshot: 'only-on-failure',
    // Keep a full trace (step-by-step timeline + before/after DOM snapshots,
    // viewable from the HTML report) whenever a test fails. Override with
    // GENIE_TRACE, e.g. GENIE_TRACE=on to trace every run.
    trace: (process.env.GENIE_TRACE ?? 'retain-on-failure') as
      | 'on'
      | 'off'
      | 'retain-on-failure'
      | 'on-first-retry',
  },
  // All test artifacts (videos, screenshots, traces) go here
  outputDir: './reports/test-results',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use system Google Chrome so a separate browser download is not required
        channel: 'chrome',
      },
    },
  ],
});
