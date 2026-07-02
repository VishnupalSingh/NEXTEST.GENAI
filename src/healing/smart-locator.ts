import type { Page, Locator } from '@playwright/test';
import { healLocator, type HealOptions } from './healer';

/**
 * SmartLocator wraps a Playwright Locator with AI-powered self-healing.
 * When an action fails due to a broken selector, it asks the configured LLM
 * for an alternative selector, updates itself, and retries the action once.
 *
 * Adding a new self-healing action is a one-liner — wrap the Locator call in
 * `withHealing(...)`. No try/catch/retry boilerplate to copy.
 */
export class SmartLocator {
  private page: Page;
  private selector: string;
  private locator: Locator;
  private readonly healOptions: HealOptions;

  constructor(page: Page, selector: string, healOptions: HealOptions = {}) {
    this.page = page;
    this.selector = selector;
    this.locator = page.locator(selector);
    this.healOptions = healOptions;
  }

  /** Click the element, auto-healing the selector on failure. */
  click(options?: Parameters<Locator['click']>[0]): Promise<void> {
    return this.withHealing((loc) => loc.click(options));
  }

  /** Fill the element, auto-healing the selector on failure. */
  fill(value: string, options?: Parameters<Locator['fill']>[1]): Promise<void> {
    return this.withHealing((loc) => loc.fill(value, options));
  }

  /** Get inner text, auto-healing the selector on failure. */
  innerText(options?: Parameters<Locator['innerText']>[0]): Promise<string> {
    return this.withHealing((loc) => loc.innerText(options));
  }

  /** Wait for element visibility, auto-healing the selector on failure. */
  waitFor(options?: Parameters<Locator['waitFor']>[0]): Promise<void> {
    return this.withHealing((loc) => loc.waitFor(options));
  }

  /**
   * Return the raw Playwright Locator (for use with expect() assertions, etc.)
   * If the locator was previously healed, returns the healed version.
   */
  native(): Locator {
    return this.locator;
  }

  /**
   * Run a Locator action; if it throws (e.g. broken selector), heal the selector
   * once and retry. Re-throws the original error if healing finds no alternative.
   * This is the single place the try/heal/retry policy lives.
   */
  private async withHealing<T>(action: (loc: Locator) => Promise<T>): Promise<T> {
    try {
      return await action(this.locator);
    } catch (err) {
      const healed = await this.applyHealing();
      if (healed) {
        return action(healed);
      }
      throw err;
    }
  }

  private async applyHealing(): Promise<Locator | null> {
    const healedSelector = await healLocator(this.page, this.selector, this.healOptions);
    if (healedSelector) {
      this.selector = healedSelector;
      this.locator = this.page.locator(healedSelector);
      return this.locator;
    }
    return null;
  }
}
