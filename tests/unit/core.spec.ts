import { test, expect } from '@playwright/test';
import * as os from 'os';
import * as path from 'path';
import { loadConfig } from '../../src/core/config';
import { recordUsage, summarizeUsage, usageByLabel, resetUsage } from '../../src/core/usage';
import { isRetryable, retryAsync } from '../../src/core/retry';
import { createLogger } from '../../src/core/logger';
import { registerBuiltinTasks } from '../../src/capabilities';
import { createTask, listTasks, registerTask } from '../../src/core/registry';
import { createContext } from '../../src/core/task';
import { goalHasUrl, withStartUrl } from '../../src/agent/ui-agent';

const fakeProvider = { generate: async () => '', runAgentLoop: async () => '' };

test.describe('config', () => {
  test('exposes sane defaults', () => {
    const c = loadConfig();
    expect(c.llm.model).toBe('gemini-1.5-flash');
    expect(c.agent.maxSteps).toBe(20);
    expect(c.generation.maxRepairAttempts).toBe(1);
    expect(c.llm.maxRetries).toBe(3);
  });

  test('honors environment overrides', () => {
    process.env.GENIE_AGENT_MAX_STEPS = '7';
    try {
      expect(loadConfig().agent.maxSteps).toBe(7);
    } finally {
      delete process.env.GENIE_AGENT_MAX_STEPS;
    }
  });

  test('merges explicit overrides without dropping other fields', () => {
    const c = loadConfig({ llm: { temperature: 0.9 } as never });
    expect(c.llm.temperature).toBe(0.9);
    expect(c.llm.model).toBe('gemini-1.5-flash'); // siblings preserved
  });
});

test.describe('usage tracker', () => {
  test('accumulates totals and per-label breakdown, then resets', () => {
    process.env.GENIE_USAGE_FILE = path.join(os.tmpdir(), `genie-usage-${process.pid}.jsonl`);
    try {
      resetUsage();
      recordUsage({ label: 'heal', model: 'm', promptTokens: 100, outputTokens: 10, totalTokens: 110 });
      recordUsage({ label: 'heal', model: 'm', promptTokens: 50, outputTokens: 5, totalTokens: 55 });
      recordUsage({ label: 'generate', model: 'm', promptTokens: 200, outputTokens: 80, totalTokens: 280 });

      expect(summarizeUsage()).toEqual({ calls: 3, promptTokens: 350, outputTokens: 95, totalTokens: 445 });
      expect(usageByLabel().heal.calls).toBe(2);
      expect(usageByLabel().generate.totalTokens).toBe(280);

      resetUsage();
      expect(summarizeUsage().calls).toBe(0);
    } finally {
      delete process.env.GENIE_USAGE_FILE;
    }
  });
});

test.describe('retry', () => {
  test('classifies transient vs deterministic errors', () => {
    expect(isRetryable(new Error('429 Too Many Requests'))).toBe(true);
    expect(isRetryable(new Error('rate limit exceeded'))).toBe(true);
    expect(isRetryable(new Error('ETIMEDOUT'))).toBe(true);
    expect(isRetryable(new Error('400 invalid request'))).toBe(false);
    expect(isRetryable(new Error('invalid api key'))).toBe(false);
  });

  test('retries transient failures then succeeds', async () => {
    let calls = 0;
    const result = await retryAsync(
      async () => {
        calls++;
        if (calls < 3) throw new Error('503 overloaded');
        return 'ok';
      },
      { retries: 5, baseMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  test('does not retry deterministic failures', async () => {
    let calls = 0;
    await expect(
      retryAsync(async () => { calls++; throw new Error('400 bad request'); }, { retries: 5, baseMs: 1 }),
    ).rejects.toThrow('400');
    expect(calls).toBe(1);
  });

  test('gives up after exhausting retries', async () => {
    let calls = 0;
    await expect(
      retryAsync(async () => { calls++; throw new Error('503'); }, { retries: 2, baseMs: 1 }),
    ).rejects.toThrow('503');
    expect(calls).toBe(3); // 1 initial + 2 retries
  });
});

test.describe('logger', () => {
  test('suppresses below-threshold levels', () => {
    const prev = process.env.GENIE_LOG_LEVEL;
    const prevDebug = process.env.GENIE_DEBUG;
    delete process.env.GENIE_DEBUG;
    process.env.GENIE_LOG_LEVEL = 'warn';
    const origLog = console.log;
    const origWarn = console.warn;
    const seen: string[] = [];
    console.log = () => seen.push('log');
    console.warn = () => seen.push('warn');
    try {
      const l = createLogger('Test');
      l.info('hidden');
      l.warn('shown');
      expect(seen).toEqual(['warn']);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      if (prev === undefined) delete process.env.GENIE_LOG_LEVEL; else process.env.GENIE_LOG_LEVEL = prev;
      if (prevDebug !== undefined) process.env.GENIE_DEBUG = prevDebug;
    }
  });
});

test.describe('agent goal URL fallback', () => {
  test('detects an explicit URL in the goal', () => {
    expect(goalHasUrl('open https://playwright.dev and read the heading')).toBe(true);
    expect(goalHasUrl('search for assertions and verify a result')).toBe(false);
  });

  test('keeps a goal that already names a URL untouched', () => {
    const goal = 'go to https://example.com/login and sign in';
    expect(withStartUrl(goal, 'https://fallback.example.com')).toBe(goal);
  });

  test('prepends the configured baseURL when the goal has no URL', () => {
    const result = withStartUrl('search for assertions', 'https://staging.example.com');
    expect(result).toContain('https://staging.example.com');
    expect(result).toContain('search for assertions');
  });
});

test.describe('registry', () => {
  test('lists built-in capabilities and builds them', () => {
    registerBuiltinTasks();
    const names = listTasks().map((t) => t.name);
    expect(names).toContain('generate');
    expect(names).toContain('achieve');

    const task = createTask('generate', createContext({ provider: fakeProvider }));
    expect(task.name).toBe('generate');
  });

  test('throws on unknown task', () => {
    registerBuiltinTasks();
    expect(() => createTask('does-not-exist', createContext({ provider: fakeProvider }))).toThrow(/Unknown task/);
  });

  test('rejects duplicate registration', () => {
    registerBuiltinTasks();
    expect(() => registerTask('generate', 'dup', () => { throw new Error('x'); })).toThrow(/already registered/);
  });
});
