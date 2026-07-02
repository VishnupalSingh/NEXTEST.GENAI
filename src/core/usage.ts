import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from './config';
import { createLogger } from './logger';

const log = createLogger('Usage');

/**
 * Token usage telemetry — makes the cost of every LLM call visible.
 *
 * Backed by a JSONL file rather than an in-memory array because Playwright runs
 * tests in separate worker *processes*: heals and agent calls happen in workers
 * while the reporter (which prints the totals) runs in the main process. A file
 * is the only thing all of them share. Appends of single short lines are atomic
 * on POSIX, so concurrent workers never tear each other's records.
 */

export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageRecord extends TokenUsage {
  /** What the call was for, e.g. "heal", "generate", "agent", "report". */
  label: string;
  model: string;
}

function usageFile(): string {
  return loadConfig().paths.usageFile;
}

/**
 * Record a single LLM call's token usage. Appends one JSON line to the shared
 * usage file and (under GENIE_DEBUG) logs a concise summary.
 */
export function recordUsage(entry: UsageRecord): void {
  log.debug(
    `${entry.model} ${entry.label}: ` +
    `${entry.promptTokens} in / ${entry.outputTokens} out (${entry.totalTokens} total)`,
  );
  try {
    const file = usageFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Telemetry is best-effort — never fail a run over it.
  }
}

function readRecords(): UsageRecord[] {
  try {
    const raw = fs.readFileSync(usageFile(), 'utf-8');
    return raw
      .split('\n')
      .filter((l) => l.trim().startsWith('{'))
      .map((l) => JSON.parse(l) as UsageRecord);
  } catch {
    return [];
  }
}

/** Aggregate totals across every recorded call this run. */
export function summarizeUsage(): TokenUsage & { calls: number } {
  return readRecords().reduce(
    (acc, r) => ({
      calls: acc.calls + 1,
      promptTokens: acc.promptTokens + r.promptTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      totalTokens: acc.totalTokens + r.totalTokens,
    }),
    { calls: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
}

/** Per-label breakdown, useful for spotting which capability dominates cost. */
export function usageByLabel(): Record<string, TokenUsage & { calls: number }> {
  const out: Record<string, TokenUsage & { calls: number }> = {};
  for (const r of readRecords()) {
    const bucket = out[r.label] ?? { calls: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0 };
    bucket.calls += 1;
    bucket.promptTokens += r.promptTokens;
    bucket.outputTokens += r.outputTokens;
    bucket.totalTokens += r.totalTokens;
    out[r.label] = bucket;
  }
  return out;
}

/** Clear accumulated usage — called by the reporter at run start, and by tests. */
export function resetUsage(): void {
  try {
    fs.rmSync(usageFile(), { force: true });
  } catch {
    // ignore
  }
}
