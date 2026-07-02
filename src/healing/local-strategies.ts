import type { Page } from '@playwright/test';

/**
 * Local (LLM-free) self-healing.
 *
 * Most selector breakage is minor drift — a renamed class, a reordered
 * attribute, a hashed suffix. We can often recover for free by deriving
 * relaxed candidate selectors from the broken one and keeping whichever
 * uniquely matches a single visible element. Only when every candidate fails
 * do we fall back to the (token-costly) LLM healer.
 *
 * @returns A working selector string, or null if no local candidate resolved.
 */
export async function tryLocalHeal(page: Page, failedSelector: string): Promise<string | null> {
  const candidates = deriveCandidates(failedSelector);

  for (const candidate of candidates) {
    if (candidate === failedSelector) continue; // already known broken
    try {
      const locator = page.locator(candidate);
      const count = await locator.count();
      if (count === 1 && (await locator.first().isVisible())) {
        return candidate;
      }
    } catch {
      // Invalid selector syntax for this candidate — skip it.
    }
  }
  return null;
}

/**
 * Produce relaxed candidate selectors from a broken one, ordered most-stable
 * first. Pure string work — no page access, so it's trivially unit-testable.
 */
export function deriveCandidates(selector: string): string[] {
  const candidates: string[] = [];
  const add = (c: string | null | undefined): void => {
    if (c && !candidates.includes(c)) candidates.push(c);
  };

  // 1. Stable attributes — keep as-is, they rarely need relaxing.
  add(matchAttr(selector, 'data-testid'));
  add(matchAttr(selector, 'aria-label'));
  add(matchAttr(selector, 'name'));
  add(matchAttr(selector, 'role'));
  add(matchAttr(selector, 'placeholder'));

  // 2. href — partial match survives query-string / locale changes.
  const href = captureAttrValue(selector, 'href');
  if (href) {
    const lastSegment = href.split('/').filter(Boolean).pop();
    if (lastSegment) add(`[href*="${lastSegment}"]`);
  }

  // 3. id — partial match survives hashed/suffixed ids (e.g. "submit-x7f2").
  const id = selector.match(/#([\w-]+)/)?.[1] ?? captureAttrValue(selector, 'id');
  if (id) {
    add(`#${id}`);
    add(`[id*="${stripHashSuffix(id)}"]`);
  }

  // 4. class — partial match on the first meaningful token survives CSS-module
  //    hashing (e.g. ".hero__title_a1b2" still matches [class*="hero__title"]).
  const cls = selector.match(/\.([\w-]+)/)?.[1];
  if (cls) add(`[class*="${stripHashSuffix(cls)}"]`);

  return candidates;
}

/** Return the full `[attr="value"]` clause if present in the selector. */
function matchAttr(selector: string, attr: string): string | null {
  const value = captureAttrValue(selector, attr);
  return value ? `[${attr}="${value}"]` : null;
}

function captureAttrValue(selector: string, attr: string): string | null {
  const m = selector.match(new RegExp(`\\[${attr}=["']?([^"'\\]]+)`));
  return m ? m[1] : null;
}

/** Drop a trailing hash-like suffix: "hero__title_a1b2" → "hero__title". */
function stripHashSuffix(token: string): string {
  return token.replace(/[-_][a-z0-9]{4,}$/i, '') || token;
}
