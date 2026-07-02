import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { validateSpec } from '../../src/generator/validate';
import {
  agentSystemPrompt,
  generateTestPrompt,
  healSelectorPrompt,
  reportSummaryPrompt,
} from '../../src/ai/prompts';
import { distillHtml } from '../../src/dom/distiller';
import { createTask } from '../../src/core/registry';
import { createContext } from '../../src/core/task';
import { registerBuiltinTasks } from '../../src/capabilities';

const VALID_SPEC = `import { test, expect } from '@playwright/test';
test('demo', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page.getByRole('heading')).toBeVisible();
});
`;

const BROKEN_SPEC = `import { test, expect } from '@playwright/test';
test('demo', async ({ page }) => {
  const n: number = 'not a number';
  await page.goto('https://example.com');
});
`;

// Write inside the project tree so `@playwright/test` module resolution works
// (TypeScript resolves node_modules by walking up from the file's directory) —
// which mirrors where generated specs actually land.
const TMP_DIR = path.join(process.cwd(), 'tests', `.tmp-${process.pid}`);

test.beforeAll(() => fs.mkdirSync(TMP_DIR, { recursive: true }));
test.afterAll(() => fs.rmSync(TMP_DIR, { recursive: true, force: true }));

function writeTmp(name: string, code: string): string {
  const file = path.join(TMP_DIR, name);
  fs.writeFileSync(file, code, 'utf-8');
  return file;
}

test.describe('spec validation', () => {
  test('passes a well-formed spec', () => {
    const file = writeTmp('valid.spec.ts', VALID_SPEC);
    try {
      expect(validateSpec(file).ok).toBe(true);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  test('flags a spec with a type error', () => {
    const file = writeTmp('broken.spec.ts', BROKEN_SPEC);
    try {
      const result = validateSpec(file);
      expect(result.ok).toBe(false);
      expect(result.errors).toMatch(/not assignable|number/i);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});

test.describe('generate task (fake provider)', () => {
  test('repairs a spec that fails typecheck on first try', async () => {
    registerBuiltinTasks();
    let calls = 0;
    const provider = {
      generate: async () => (++calls === 1 ? BROKEN_SPEC : VALID_SPEC),
      runAgentLoop: async () => '',
    };
    const out = path.join(TMP_DIR, 'out.spec.ts');
    await createTask('generate', createContext({ provider })).run({ intent: 'demo', outputPath: out });
    expect(calls).toBe(2); // initial + one repair
    expect(validateSpec(out).ok).toBe(true);
  });
});

test.describe('generate task (POM-aware, fake provider)', () => {
  test('writes a page object, wires the barrel, and forces the spec path', async () => {
    registerBuiltinTasks();

    const pagePath = path.join(process.cwd(), 'src', 'pom', 'pages', 'gen-fixture.page.ts');
    const barrelPath = path.join(process.cwd(), 'src', 'pom', 'index.ts');
    const barrelBefore = fs.readFileSync(barrelPath, 'utf-8');

    // A faithful multi-file response: one page object + one spec that uses it.
    const MULTI_FILE = [
      '=== FILE: src/pom/pages/gen-fixture.page.ts ===',
      "import { BasePage } from '../base-page';",
      '',
      'export class GenFixturePage extends BasePage {',
      "  readonly path = '/';",
      '  get heading() {',
      "    return this.page.getByRole('heading');",
      '  }',
      '}',
      '=== FILE: tests/wrong-location.spec.ts ===',
      "import { test, expect } from '@playwright/test';",
      "import { GenFixturePage } from '../../src/pom';",
      '',
      "test('generated', async ({ page }) => {",
      '  const home = new GenFixturePage(page);',
      '  await home.open();',
      '  await expect(home.heading).toBeVisible();',
      '});',
    ].join('\n');

    const provider = { generate: async () => MULTI_FILE, runAgentLoop: async () => '' };
    const out = path.join(TMP_DIR, 'gen.spec.ts');

    try {
      await createTask('generate', createContext({ provider })).run({ intent: 'see a heading', outputPath: out });

      // Spec is forced to the caller's outputPath, not the model's path.
      expect(fs.existsSync(out)).toBe(true);
      expect(fs.existsSync(path.join(TMP_DIR, 'wrong-location.spec.ts'))).toBe(false);

      // Page object written under src/pom/pages and re-exported from the barrel.
      expect(fs.existsSync(pagePath)).toBe(true);
      expect(fs.readFileSync(barrelPath, 'utf-8')).toContain("export { GenFixturePage } from './pages/gen-fixture.page';");

      // The whole generated set typechecks.
      expect(validateSpec(out).ok).toBe(true);
      expect(validateSpec(pagePath).ok).toBe(true);
    } finally {
      fs.rmSync(pagePath, { force: true });
      fs.writeFileSync(barrelPath, barrelBefore, 'utf-8'); // restore barrel
    }
  });
});

test.describe('prompts', () => {
  test('generateTestPrompt embeds the intent and required imports', () => {
    const p = generateTestPrompt('log in and see dashboard');
    expect(p).toContain('log in and see dashboard');
    expect(p).toContain('@playwright/test');
  });

  test('healSelectorPrompt embeds selector, digest, and NULL escape hatch', () => {
    const p = healSelectorPrompt('.broken', '<button text="Go">');
    expect(p).toContain('.broken');
    expect(p).toContain('<button text="Go">');
    expect(p).toContain('NULL');
  });

  test('reportSummaryPrompt embeds the status line', () => {
    expect(reportSummaryPrompt('Status: PASSED | Total: 3', '')).toContain('Status: PASSED | Total: 3');
  });

  test('agentSystemPrompt defines the completion contract', () => {
    expect(agentSystemPrompt()).toContain('GOAL_ACHIEVED');
  });
});

test.describe('dom distiller (html fallback)', () => {
  test('strips scripts/styles and keeps interactive markup', () => {
    const html = '<html><head><style>.a{color:red}</style><script>var x=1</script></head>' +
      '<body><button id="go">Go</button></body></html>';
    const digest = distillHtml(html);
    expect(digest).not.toContain('color:red');
    expect(digest).not.toContain('var x');
    expect(digest).toContain('<button id="go">');
  });

  test('truncates oversized html', () => {
    const big = '<div>' + 'x'.repeat(10_000) + '</div>';
    expect(distillHtml(big, 100).length).toBeLessThan(200);
  });
});
