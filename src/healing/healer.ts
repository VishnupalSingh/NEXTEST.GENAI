import type { Page } from '@playwright/test';
import type { ILLMProvider } from '../ai/provider';
import { getDefaultProvider } from '../ai/factory';
import { loadConfig, type GenieConfig } from '../core/config';
import { distillInteractiveElements } from '../dom/distiller';
import { healSelectorPrompt } from '../ai/prompts';
import { createLogger } from '../core/logger';
import { loadCache, putEntry, type HealedEntry } from './heal-cache';
import { tryLocalHeal } from './local-strategies';

const log = createLogger('Healer');

/**
 * Normalize a URL for use as a cache key: drop query string and hash so that
 * session ids / tracking params don't bust the cache on every run.
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/** Optional dependencies — injectable for testing, defaulted for production. */
export interface HealOptions {
  provider?: ILLMProvider;
  config?: GenieConfig;
}

/**
 * Attempt to heal a broken CSS/XPath selector. Resolution order, cheapest first:
 *   1. Cache       — a previous heal for this page+selector (zero cost)
 *   2. Local       — relaxed-candidate heuristics (zero tokens)
 *   3. LLM         — distilled-DOM prompt to the configured model (token cost)
 *
 * Every successful heal is cached, tagged with its source.
 *
 * @returns The healed selector string, or null if no alternative was found.
 */
export async function healLocator(
  page: Page,
  failedSelector: string,
  options: HealOptions = {},
): Promise<string | null> {
  const config = options.config ?? loadConfig();
  const cachePath = config.healing.cachePath;

  const url = page.url();
  const cacheKey = `${normalizeUrl(url)}::${failedSelector}`;

  // ── 1. Cache ──────────────────────────────────────────────────────────────
  const cache = loadCache(cachePath);
  if (cache[cacheKey]) {
    log.debug(`Cache hit: "${failedSelector}" → "${cache[cacheKey].healed}"`);
    return cache[cacheKey].healed;
  }

  log.info(`Healing broken selector: "${failedSelector}"`);

  // ── 2. Local heuristics (free) ──────────────────────────────────────────────
  const local = await tryLocalHeal(page, failedSelector);
  if (local) {
    log.info(`Local heal (no LLM): "${failedSelector}" → "${local}"`);
    persist(cachePath, cacheKey, failedSelector, local, 'local', url);
    return local;
  }

  // ── 3. LLM fallback (token cost) ────────────────────────────────────────────
  const provider = options.provider ?? getDefaultProvider();
  const digest = await distillInteractiveElements(page, { maxChars: config.healing.domMaxChars });
  const prompt = healSelectorPrompt(failedSelector, digest);

  try {
    const suggestion = (
      await provider.generate(prompt, { model: config.llm.healingModel, label: 'heal' })
    ).trim();

    if (!suggestion || suggestion === 'NULL') {
      log.info(`No alternative found for "${failedSelector}"`);
      return null;
    }

    log.info(`AI heal: "${failedSelector}" → "${suggestion}"`);
    persist(cachePath, cacheKey, failedSelector, suggestion, 'ai', url);
    return suggestion;
  } catch (error) {
    log.error("AI call failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

function persist(
  cachePath: string,
  key: string,
  original: string,
  healed: string,
  source: HealedEntry['source'],
  url: string,
): void {
  putEntry(cachePath, key, {
    original,
    healed,
    source,
    healedAt: new Date().toISOString(),
    url,
  });
}
