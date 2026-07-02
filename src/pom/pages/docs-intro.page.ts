import type { Locator } from '@playwright/test';
import { BasePage } from '../base-page';

/**
 * The "Installation" / Getting Started docs page we land on after clicking
 * "Get Started" on the home page.
 *
 * This page exposes only role-based locators: they describe intent ("the
 * Installation heading") rather than DOM structure, so they survive restyles
 * without needing AI healing. No `selectors` map is necessary.
 */
export class DocsIntroPage extends BasePage {
  readonly path = '/docs/intro';

  get installationHeading(): Locator {
    return this.page.getByRole('heading', { name: /installation/i });
  }
}
