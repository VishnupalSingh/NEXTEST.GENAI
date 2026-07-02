import { defineConfig } from '@playwright/test';

/**
 * Unit-test config — fast, offline, no browser, no AI reporter.
 * Exercises the framework's own logic (config, healing heuristics, registry,
 * retry, validation, prompts) using the injectable fake-provider seam.
 *
 * Run with: npm run test:unit
 */
export default defineConfig({
  testDir: './tests/unit',
  fullyParallel: true,
  reporter: 'list',
  // Keep all artifacts under reports/ — without this, Playwright defaults to a
  // stray ./test-results/ at the repo root, duplicating reports/test-results/.
  outputDir: './reports/test-results',
});
