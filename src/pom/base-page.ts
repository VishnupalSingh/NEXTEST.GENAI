import type { Page, Locator } from '@playwright/test';
import { SmartLocator } from '../healing/smart-locator';
import type { HealOptions } from '../healing/healer';

/**
 * BasePage — the foundation every Page Object extends.
 *
 * Design goals for a large app (many pages, many locators):
 *  - Selectors live in ONE place per page (the `selectors` map), never inline
 *    in spec files. Tests reference elements by semantic NAME, not by selector.
 *  - Brittle CSS/XPath selectors are returned as self-healing `SmartLocator`s
 *    via `el(name)`, so the framework's AI healing still kicks in when a site
 *    update breaks them.
 *  - Robust locators (role/text/label) should be exposed as plain getters on
 *    the subclass — they rarely break, so they don't need (or want) healing.
 *  - Navigation is environment-driven: `open()` uses the relative `path`
 *    against the configured `baseURL` (see config/targets.json), so a page
 *    object works unchanged across local/staging/prod.
 *
 * `S` is the page's selector-name → selector-string map. Typing it gives
 * autocomplete and compile-time errors on `el('typoName')`.
 */
export abstract class BasePage<S extends Record<string, string> = Record<string, never>> {
  /** Named brittle selectors for this page. Override in subclasses that need healing. */
  protected readonly selectors: S = {} as S;

  /** Relative path of this page, e.g. '/login'. Used by `open()`. */
  abstract readonly path: string;

  /** Memoize SmartLocators so a heal performed early in a test persists for later actions. */
  private readonly smartCache = new Map<string, SmartLocator>();

  constructor(
    protected readonly page: Page,
    protected readonly healOptions: HealOptions = {},
  ) {}

  /** Navigate to this page using its relative path (resolved against baseURL). */
  async open(): Promise<void> {
    await this.page.goto(this.path);
  }

  /**
   * A self-healing handle to a named element from the `selectors` map.
   * Use for clicks/fills on CSS/XPath selectors that may drift over time.
   */
  protected el(name: keyof S & string): SmartLocator {
    const cached = this.smartCache.get(name);
    if (cached) return cached;

    const selector = this.selectors[name];
    if (!selector) {
      throw new Error(
        `${this.constructor.name}: no selector named "${name}". ` +
          `Declared: ${Object.keys(this.selectors).join(', ') || '(none)'}.`,
      );
    }
    const smart = new SmartLocator(this.page, selector, this.healOptions);
    this.smartCache.set(name, smart);
    return smart;
  }

  /**
   * The raw Playwright Locator for a named (healable) element — for use with
   * expect() assertions. If the element was already healed, returns the healed one.
   */
  protected locatorOf(name: keyof S & string): Locator {
    return this.el(name).native();
  }
}
