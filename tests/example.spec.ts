import { test, expect } from '@playwright/test';
import { GenieAgent } from '../src/agent/ui-agent';
import { DocsHomePage, DocsIntroPage } from '../src/pom';

// The Application Under Test is driven from config/targets.json (selected via
// GENIE_ENV). Page objects navigate with relative paths against `use.baseURL`,
// and the GenieAgent falls back to the same baseURL when a goal names no URL.

/**
 * NexTest Genie — Example Test Suite
 *
 * Demonstrates three core capabilities:
 *  1. SmartLocator — AI self-healing when a selector breaks
 *  2. GenieAgent   — Autonomous browser control via Playwright MCP + Gemini
 *  3. NL Generation — See: npm run genie -- generate "..."
 */

test.describe('SmartLocator — Self-Healing Locators', () => {
  test('navigates to Playwright docs using a smart locator', async ({ page }) => {
    // Selectors live in the page object, not here. Page objects return
    // self-healing handles — if a selector breaks after a site update, Genie
    // asks Gemini for an alternative and retries automatically.
    const home = new DocsHomePage(page);
    await home.open();
    await home.clickGetStarted();

    const intro = new DocsIntroPage(page);
    await expect(page).toHaveURL(/.*\/docs\/intro/);
    await expect(intro.installationHeading).toBeVisible();
  });

  test('reads page title with a smart locator', async ({ page }) => {
    const home = new DocsHomePage(page);
    await home.open();

    const text = await home.heroText();

    expect(text.length).toBeGreaterThan(0);
    console.log(`  Page hero title: "${text}"`);
  });
});

test.describe('GenieAgent — Autonomous UI Navigation', () => {
  /**
   * The agent autonomously navigates the browser using Playwright MCP tools.
   * Gemini AI decides which tool to call at each step (navigate, click, snapshot…).
   *
   * NOTE: This test starts its own headless browser via @playwright/mcp.
   * It does NOT use the `page` fixture — the agent controls the browser directly.
   */
  test('autonomously finds the Playwright changelog page', async () => {
    const agent = new GenieAgent(15);

    // No URL in the goal — the agent starts from the configured baseURL
    // (config/targets.json via GENIE_ENV). Provide a URL to override.
    await agent.achieve(
      'Find the link to the Release Notes or Changelog page, then click it and confirm the page loaded successfully.',
      true, // headless
    );
  });
});
