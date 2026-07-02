import * as fs from 'fs';
import * as path from 'path';

export interface HealedEntry {
  original: string;
  healed: string;
  /** How the heal was produced: cheap local heuristic or an LLM call. */
  source: 'local' | 'ai';
  healedAt: string;
  url: string;
}

export type HealCache = Record<string, HealedEntry>;

/** A unique-ish temp suffix without Math.random (pid + monotonic counter). */
let writeCounter = 0;

export function loadCache(cachePath: string): HealCache {
  try {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as HealCache;
    }
  } catch {
    // Cache unreadable — start fresh
  }
  return {};
}

/**
 * Persist a single entry concurrency-safely.
 *
 * Playwright runs tests in separate worker *processes*, so a naive
 * read-modify-write race-clobbers the JSON file. We mitigate that by:
 *   1. Re-reading the latest cache from disk (merge in others' writes)
 *   2. Adding our entry
 *   3. Writing to a unique temp file, then atomically renaming over the target
 *
 * Atomic rename means a concurrent reader never sees a half-written file, and
 * the re-read-before-write means we rarely drop a sibling's entry.
 */
export function putEntry(cachePath: string, key: string, entry: HealedEntry): void {
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const merged = loadCache(cachePath);
    merged[key] = entry;

    const tmp = `${cachePath}.${process.pid}.${writeCounter++}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');
    fs.renameSync(tmp, cachePath);
  } catch {
    // Cache persistence is a best-effort optimization — never fail a test over it.
  }
}
