import * as fs from 'fs';
import * as path from 'path';
import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import { createProvider } from '../ai/factory';
import { loadConfig } from '../core/config';
import { summarizeUsage, usageByLabel, resetUsage } from '../core/usage';
import { reportSummaryPrompt } from '../ai/prompts';

interface TestEntry {
  title: string;
  status: string;
  duration: number;
  error?: string;
}

/**
 * GenieReporter — Custom Playwright reporter that generates an AI-powered
 * test run summary using Google Gemini at the end of each test suite run.
 *
 * Outputs:
 *   - Console stats summary
 *   - reports/genie-summary.md  (AI narrative + stats table)
 */
class GenieReporter implements Reporter {
  private entries: TestEntry[] = [];
  private runStart = 0;

  onBegin(_config: FullConfig, suite: Suite): void {
    this.runStart = Date.now();
    resetUsage(); // start each run with a clean token ledger
    const total = suite.allTests().length;
    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`║  NexTest Genie — Starting ${total} test(s)  ║`);
    console.log(`╚══════════════════════════════════════╝\n`);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const icon = result.status === 'passed' ? '✓' : result.status === 'skipped' ? '○' : '✗';
    console.log(`  ${icon} ${test.titlePath().slice(1).join(' › ')} (${result.duration}ms)`);

    this.entries.push({
      title: test.titlePath().slice(1).join(' › '),
      status: result.status,
      duration: result.duration,
      error: result.errors?.[0]?.message
        ?.replace(/\x1b\[[0-9;]*m/g, '')  // strip ANSI codes
        .split('\n')[0],
    });
  }

  async onEnd(result: FullResult): Promise<void> {
    const passed  = this.entries.filter((e) => e.status === 'passed').length;
    const failed  = this.entries.filter((e) => e.status === 'failed').length;
    const skipped = this.entries.filter((e) => e.status === 'skipped').length;
    const total   = this.entries.length;
    const durationSec = ((Date.now() - this.runStart) / 1000).toFixed(1);

    const statusLine = `Status: ${result.status.toUpperCase()} | Total: ${total} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped} | Duration: ${durationSec}s`;
    console.log(`\n  ${statusLine}`);

    const failedLines = this.entries
      .filter((e) => e.status === 'failed')
      .map((e) => `- ${e.title}\n  Error: ${e.error ?? 'unknown'}`)
      .join('\n');

    // ── AI Summary ──────────────────────────────────────────────────────────
    let aiSummary = '';
    try {
      const config = loadConfig();
      const ai = createProvider(config);
      const prompt = reportSummaryPrompt(statusLine, failedLines);

      aiSummary = await ai.generate(prompt, { model: config.llm.reportModel, label: 'report' });
    } catch {
      aiSummary = `Test run complete. ${passed} of ${total} tests passed in ${durationSec}s.`;
    }

    console.log(`\n  [Genie AI Summary]\n  ${aiSummary.replace(/\n/g, '\n  ')}\n`);

    // ── Write reports/genie-summary.md ──────────────────────────────────────
    const lines: string[] = [
      '# NexTest Genie — AI Test Run Summary',
      '',
      `**Run Date:** ${new Date().toISOString()}`,
      `**Overall Status:** ${result.status.toUpperCase()}`,
      '',
      '## Run Statistics',
      '',
      '| Metric   | Value |',
      '|----------|-------|',
      `| Total    | ${total} |`,
      `| Passed   | ${passed} |`,
      `| Failed   | ${failed} |`,
      `| Skipped  | ${skipped} |`,
      `| Duration | ${durationSec}s |`,
      '',
      '## AI Summary',
      '',
      aiSummary,
    ];

    if (failedLines) {
      lines.push('', '## Failed Tests', '', failedLines);
    }

    // ── Token usage (cost visibility) ───────────────────────────────────────
    const usage = summarizeUsage();
    if (usage.calls > 0) {
      const byLabel = usageByLabel();
      console.log(
        `  [Genie Tokens] ${usage.calls} call(s), ${usage.totalTokens} tokens ` +
        `(${usage.promptTokens} in / ${usage.outputTokens} out)`,
      );
      lines.push(
        '',
        '## Token Usage',
        '',
        '| Capability | Calls | Prompt | Output | Total |',
        '|------------|-------|--------|--------|-------|',
        ...Object.entries(byLabel).map(
          ([label, u]) => `| ${label} | ${u.calls} | ${u.promptTokens} | ${u.outputTokens} | ${u.totalTokens} |`,
        ),
        `| **Total** | **${usage.calls}** | **${usage.promptTokens}** | **${usage.outputTokens}** | **${usage.totalTokens}** |`,
      );
    }

    lines.push(
      '',
      '## Test Results',
      '',
      '| Test | Status | Duration |',
      '|------|--------|----------|',
      ...this.entries.map(
        (e) => `| ${e.title} | ${e.status} | ${e.duration}ms |`,
      ),
    );

    const reportsDir = loadConfig().paths.reportsDir;
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    const summaryPath = path.join(reportsDir, 'genie-summary.md');
    fs.writeFileSync(summaryPath, lines.join('\n') + '\n', 'utf-8');
    console.log(`  [GenieReporter] AI summary saved to: ${summaryPath}`);
  }
}

export default GenieReporter;
