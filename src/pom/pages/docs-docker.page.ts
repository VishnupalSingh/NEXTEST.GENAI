import type { Locator } from '@playwright/test';
import { BasePage } from '../base-page';

/**
 * The Playwright docs page specifically for Docker.
 * This page object is used to verify navigation and content after a search.
 */
export class DocsDockerPage extends BasePage {
  // The path is defined for completeness, but this page is typically reached via navigation,
  // not directly opened using this.open().
  readonly path = '/docs/docker';

  /**
   * The main heading of the Docker docs page.
   * This is a robust role-based locator.
   */
  get pageHeading(): Locator {
    return this.page.getByRole('heading', { name: 'Docker', level: 1 });
  }
}
