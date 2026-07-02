import { test, expect } from '@playwright/test';
import { DocsHomePage } from '../src/pom/pages/docs-home.page';
import { DocsDockerPage } from '../src/pom/pages/docs-docker.page';

test.describe('Search functionality on Playwright docs site', () => {
  test('should navigate to Docker docs page after searching for "docker"', async ({ page }) => {
    const home = new DocsHomePage(page);
    const dockerPage = new DocsDockerPage(page);

    // Each test.step() becomes a labelled, individually-statused row in the
    // Playwright HTML report (npm run report) — so you can see exactly which
    // step passed or failed, not just the overall test result.
    await test.step('Open the home page', async () => {
      await home.open();
    });

    await test.step('Search for "docker" and submit', async () => {
      await home.search('docker');
    });

    await test.step('Lands on the Docker docs page (URL /docs/docker)', async () => {
      await expect(page).toHaveURL(/.*\/docs\/docker/);
    });

    await test.step('Page heading is "Docker"', async () => {
      await expect(dockerPage.pageHeading).toBeVisible();
    });
  });
});
