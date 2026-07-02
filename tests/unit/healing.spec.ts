import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deriveCandidates } from '../../src/healing/local-strategies';
import { loadCache, putEntry } from '../../src/healing/heal-cache';

test.describe('local-heal candidate derivation', () => {
  test('strips hash suffix from CSS-module classes', () => {
    expect(deriveCandidates('.hero__title_a1b2')).toContain('[class*="hero__title"]');
  });

  test('uses the last path segment of an href', () => {
    expect(deriveCandidates('a[href="/docs/intro"]')).toContain('[href*="intro"]');
  });

  test('prefers stable attributes first', () => {
    const candidates = deriveCandidates('button#submit-x7f2[data-testid="go"]');
    expect(candidates[0]).toBe('[data-testid="go"]'); // most stable, listed first
    expect(candidates).toContain('#submit-x7f2');
    expect(candidates).toContain('[id*="submit"]');
  });

  test('returns nothing for a selector with no salvageable hints', () => {
    expect(deriveCandidates('div > span:nth-child(3)')).toEqual([]);
  });
});

test.describe('heal-cache', () => {
  test('merges entries without clobbering (atomic re-read + write)', () => {
    const cp = path.join(os.tmpdir(), `genie-cache-${process.pid}.json`);
    fs.rmSync(cp, { force: true });
    try {
      putEntry(cp, 'k1', { original: 'a', healed: 'b', source: 'local', healedAt: 't', url: 'u' });
      putEntry(cp, 'k2', { original: 'c', healed: 'd', source: 'ai', healedAt: 't', url: 'u' });

      const cache = loadCache(cp);
      expect(Object.keys(cache).sort()).toEqual(['k1', 'k2']);
      expect(cache.k2.source).toBe('ai');
    } finally {
      fs.rmSync(cp, { force: true });
    }
  });

  test('returns empty object when cache file is absent', () => {
    expect(loadCache(path.join(os.tmpdir(), 'genie-nope-does-not-exist.json'))).toEqual({});
  });
});
