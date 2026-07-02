import type { Logger } from './logger';

/**
 * Retry with exponential backoff + jitter, for transient LLM/network failures.
 *
 * A single 429 (rate limit) or 503 (overloaded) shouldn't fail a whole test run
 * or report. Only *transient* errors are retried; deterministic ones (bad
 * request, auth) throw immediately so we don't waste time or tokens.
 */

export interface RetryOptions {
  /** Max retry attempts after the first try (0 disables retrying). */
  retries: number;
  /** Base delay in ms; grows exponentially per attempt. */
  baseMs: number;
  label?: string;
  logger?: Logger;
}

/** Heuristic: is this error worth retrying? */
export function isRetryable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (/\b(429|500|502|503|504)\b/.test(msg)) return true;
  return /rate limit|resource exhausted|overloaded|unavailable|too many requests|timeout|timed out|econnreset|etimedout|enotfound|socket hang up|fetch failed|network error/.test(
    msg,
  );
}

export async function retryAsync<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > opts.retries || !isRetryable(err)) throw err;
      const backoff = opts.baseMs * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * opts.baseMs);
      const delay = backoff + jitter;
      opts.logger?.warn(
        `${opts.label ?? 'call'} failed (attempt ${attempt}/${opts.retries}), retrying in ${delay}ms: ` +
        (err instanceof Error ? err.message : String(err)),
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
