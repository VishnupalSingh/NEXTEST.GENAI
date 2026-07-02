import type { Page } from '@playwright/test';

/**
 * DOM distillation — turn a full page into a compact, LLM-friendly digest of
 * just the *interactive* elements (links, buttons, inputs, selects, anything
 * with a role or test id).
 *
 * Raw page HTML is the most token-expensive payload possible: scripts, styles,
 * inline SVG, and base64 dominate it while contributing nothing to locator
 * selection. Distilling typically cuts tokens by 90%+ and improves the model's
 * accuracy by removing noise.
 */

export interface DistillOptions {
  /** Hard cap on the returned string length (characters). */
  maxChars?: number;
}

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[role]',
  '[onclick]',
  '[data-testid]',
  '[aria-label]',
  '[contenteditable="true"]',
].join(',');

/**
 * Extract interactive elements from the live page as a newline-delimited list.
 * Each line describes one element with the attributes most useful for building
 * a stable locator (tag, id, data-testid, role, aria-label, name, type, text).
 */
export async function distillInteractiveElements(
  page: Page,
  options: DistillOptions = {},
): Promise<string> {
  const maxChars = options.maxChars ?? 6000;

  // Runs in the browser context — must be self-contained (no closures over Node).
  const elements = await page.evaluate((selector: string) => {
    const seen = document.querySelectorAll(selector);
    const out: string[] = [];

    const visible = (el: Element): boolean => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(el as HTMLElement);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
    };

    const attrs = ['id', 'data-testid', 'name', 'type', 'role', 'aria-label', 'placeholder', 'href'];

    seen.forEach((el) => {
      if (!visible(el)) return;
      const parts: string[] = [el.tagName.toLowerCase()];
      for (const a of attrs) {
        const v = el.getAttribute(a);
        if (v) parts.push(`${a}="${v.slice(0, 80)}"`);
      }
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (text) parts.push(`text="${text}"`);
      out.push(`<${parts.join(' ')}>`);
    });

    return out;
  }, INTERACTIVE_SELECTOR);

  let digest = elements.join('\n');
  if (digest.length > maxChars) {
    digest = digest.slice(0, maxChars) + '\n<!-- digest truncated -->';
  }
  return digest;
}

/**
 * Fallback distiller for when only raw HTML is available (no live Page).
 * Strips the heaviest non-structural content before truncating.
 */
export function distillHtml(html: string, maxChars = 6000): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped.length > maxChars
    ? stripped.slice(0, maxChars) + ' <!-- truncated -->'
    : stripped;
}
