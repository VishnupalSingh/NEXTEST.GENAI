import type { Locator } from '@playwright/test';
import { BasePage } from '../base-page';

/**
 * Home page of the Playwright docs site (the example target).
 *
 * Brittle CSS selectors that benefit from self-healing are declared here once.
 * Tests never see these strings — they call methods like `clickGetStarted()`.
 */
const selectors = {
  // CSS selectors are exactly the kind that drift when a site is restyled —
  // good candidates for SmartLocator healing.
  getStartedLink: 'a[href="/docs/intro"]',
  heroTitle: '.hero__title',
} as const;

export class DocsHomePage extends BasePage<typeof selectors> {
  readonly path = '/';
  protected readonly selectors = selectors;

  /** A robust role-based locator — resilient by nature, so not in the heal map. */
  get getStartedButton(): Locator {
    return this.page.getByRole('link', { name: /get started/i });
  }

  /** The search button that opens the search modal. */
  get searchButton(): Locator {
    return this.page.getByRole('button', { name: 'Search' });
  }

  /** The input field inside the search modal. */
  get searchModalInput(): Locator {
    return this.page.getByPlaceholder('Search docs');
  }

  async clickGetStarted(): Promise<void> {
    await this.el('getStartedLink').click();
  }

  async heroText(): Promise<string> {
    return this.el('heroTitle').innerText();
  }

  /** Result rows inside the Algolia DocSearch modal. */
  get searchResults(): Locator {
    return this.page.locator('.DocSearch-Hits a');
  }

  /**
   * Opens the search modal, types the term, and presses Enter.
   *
   * Pressing Enter navigates to the top hit — but only once Algolia has
   * returned results, so we wait for the first result to appear first.
   * Pressing Enter before then is a no-op and leaves the page unchanged.
   * @param term The search query.
   */
  async search(term: string): Promise<void> {
    await this.searchButton.click();
    await this.searchModalInput.fill(term);
    await this.searchResults.first().waitFor({ state: 'visible' });
    await this.searchModalInput.press('Enter');
    // Playwright automatically waits for navigation after pressing Enter.
  }
}
