import * as fs from 'fs';
import * as path from 'path';
import { chromium, type FullConfig } from '@playwright/test';
import { loadTarget } from '../src/core/target-config';

/**
 * Global setup — runs once before the whole suite.
 *
 * If the active environment needs authentication, we log in a single time and
 * persist the session to storageState. Every test then starts already
 * authenticated (configured via `use.storageState` in playwright.config.ts),
 * instead of logging in on each test.
 *
 * If the environment does not require auth, this is a no-op.
 */
async function globalSetup(_config: FullConfig): Promise<void> {
  const target = loadTarget();

  if (!target.auth.required) {
    console.log(`[global-setup] env "${target.name}" needs no auth — skipping login.`);
    return;
  }

  const { auth, credentials, baseURL, storageStatePath } = target;
  if (!credentials || !auth.selectors || !auth.loginPath) {
    throw new Error(
      `env "${target.name}" requires auth but is missing credentials/selectors/loginPath in targets.json.`,
    );
  }

  console.log(`[global-setup] authenticating against "${target.name}" (${baseURL})…`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  try {
    await page.goto(auth.loginPath);
    await page.fill(auth.selectors.username, credentials.username);
    await page.fill(auth.selectors.password, credentials.password);
    await page.click(auth.selectors.submit);

    // Confirm the login actually succeeded before we trust the session.
    if (auth.successUrl) {
      await page.waitForURL(`**${auth.successUrl}**`, { timeout: 15_000 });
    } else {
      await page.waitForLoadState('networkidle');
    }

    fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
    await page.context().storageState({ path: storageStatePath });
    console.log(`[global-setup] session saved → ${storageStatePath}`);
  } finally {
    await browser.close();
  }
}

export default globalSetup;
