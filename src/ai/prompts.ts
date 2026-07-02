/**
 * Centralized prompt templates.
 *
 * Every prompt the framework sends lives here as a pure function — no business
 * logic, no I/O. Tuning a prompt means editing one file, not hunting through
 * the healer / generator / reporter / agent. Pure functions are also trivially
 * unit-testable (assert the rendered string), which keeps prompt changes safe.
 */

/** System instruction for the autonomous browser agent. */
export function agentSystemPrompt(): string {
  return [
    'You are Genie, an autonomous UI testing agent controlling a real web browser.',
    'Use the browser tools step by step to achieve the goal provided by the user.',
    'After each action, verify the result with browser_snapshot or browser_screenshot.',
    'When you have fully achieved the goal, respond with text starting with "GOAL_ACHIEVED:".',
    'If you cannot complete the goal after several attempts, respond with "GOAL_FAILED: <reason>".',
  ].join('\n');
}

const TEST_AUTHOR_CONTEXT = `You are an expert Playwright + TypeScript test author working inside the "NexTest Genie" framework.
You MUST follow these framework conventions — they are not optional:

1. PAGE OBJECT MODEL. Specs contain NO selectors and NO absolute URLs.
   - The spec imports { test, expect } from '@playwright/test' and imports page objects from the '../src/pom' barrel.
   - The spec drives the app ONLY through page-object methods (e.g. await home.open(); await home.search('foo')).

2. PAGE OBJECTS extend BasePage (src/pom/base-page.ts). Its contract:
   - readonly path: the page's RELATIVE path for open(), e.g. '/' or '/search'. Never a full URL — open() resolves it against the configured baseURL.
   - protected readonly selectors = { name: 'cssOrXpath' } as const;  // ONLY for brittle CSS/XPath that benefits from self-healing.
   - this.el('name'): returns a self-healing SmartLocator with .click(opts), .fill(value, opts), .innerText(), .waitFor(), .native().
   - For ROBUST locators (role/label/text), expose a getter returning this.page.getByRole(...) / getByLabel(...) / getByText(...). Do NOT put these in the selectors map — they don't need healing.
   - Expose intent-revealing methods (open(), search(term), resultLinks()); keep raw locators private.

3. NAVIGATION is environment-driven: call await somePage.open(). Never call page.goto with a hardcoded URL.

4. REUSE existing page objects when they already cover the page. Only CREATE a new page object, or ADD a method/selector to an existing one, when the current ones don't suffice.`;

/**
 * The multi-file output contract. The generator parses these blocks, sandboxes
 * the paths, and typecheck-gates every file. The barrel (src/pom/index.ts) is
 * wired automatically by the generator — do NOT emit it.
 */
function outputContract(specPath: string): string {
  return `OUTPUT FORMAT — emit one or more files. Begin each file with a line EXACTLY of the form:
=== FILE: <relative/path/from/repo/root> ===
followed by that file's COMPLETE contents (all imports included).

Rules:
- Emit the spec at EXACTLY this path: ${specPath}
- If you create or modify a page object, emit it at src/pom/pages/<kebab-name>.page.ts with its full contents. Do NOT emit src/pom/index.ts — it is wired automatically.
- Output ONLY file blocks. No markdown, no code fences, no prose before/between/after the blocks.`;
}

/**
 * Prompt to generate a Playwright spec (plus any needed page objects) from a
 * natural-language intent, following the framework's POM + config conventions.
 *
 * @param pomContext  Verbatim source of existing page objects (see buildPomInventory).
 */
export function generateTestPrompt(
  intent: string,
  specPath = 'tests/example.spec.ts',
  pomContext = '',
): string {
  return `${TEST_AUTHOR_CONTEXT}

EXISTING PAGE OBJECTS (reuse or extend these where possible):
${pomContext || '(none yet)'}

Generate the test(s) for the following intent:
"${intent}"

Requirements:
- A descriptive test.describe block and test name.
- At least one meaningful expect() assertion driven through a page object.
- Robust role/label/text locators in the page object; reserve the selectors map for genuinely brittle CSS/XPath.
- Wrap each logical action or assertion in an \`await test.step('<clear label>', async () => { ... })\` call, so every step shows up individually (with its own pass/fail status) in the Playwright HTML report. Group related calls under one step; keep step labels short and human-readable.

${outputContract(specPath)}`;
}

/** Render generated files back into the multi-file format for the repair prompt. */
export function renderFilesForPrompt(files: Array<{ path: string; content: string }>): string {
  return files.map((f) => `=== FILE: ${f.path} ===\n${f.content}`).join('\n\n');
}

/** Prompt to repair generated files that failed typecheck. */
export function repairTestPrompt(
  intent: string,
  filesBlock: string,
  errors: string,
  specPath = 'tests/example.spec.ts',
): string {
  return `${TEST_AUTHOR_CONTEXT}

The following file(s), generated for the intent "${intent}", fail TypeScript compilation.

Compiler errors:
${errors}

Current files:
${filesBlock}

Return corrected FULL contents for every file that needs changing, still fulfilling the intent and obeying the conventions above.

${outputContract(specPath)}`;
}

/** Prompt to heal a broken selector given a distilled DOM digest. */
export function healSelectorPrompt(failedSelector: string, digest: string): string {
  return `You are an expert in HTML, CSS selectors, and Playwright locators.
A Playwright test is failing because this selector no longer matches any element: "${failedSelector}"

Interactive elements currently on the page:
${digest}

Find the most likely intended element and return the best alternative CSS selector or XPath to locate it.
Rules:
- Prefer stable attributes (data-testid, aria-label, role, name) over structural selectors
- Respond with ONLY the selector string — no explanation, no code blocks, no punctuation
- If no suitable element exists, respond with exactly: NULL`;
}

/** Prompt for the end-of-run QA summary. */
export function reportSummaryPrompt(statusLine: string, failedLines: string): string {
  return `You are a senior QA engineer writing a concise test run report for the development team.

Run stats: ${statusLine}
${failedLines ? `\nFailed tests:\n${failedLines}` : '\nAll tests passed.'}

Write a 3-5 sentence professional summary. Cover:
1. Overall pass/fail outcome
2. Any patterns or notable issues in failures (if any)
3. A brief recommendation or next step

Plain text only. No markdown headers or bullet points.`;
}
