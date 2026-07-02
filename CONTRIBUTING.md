# Contributing to NexTest Genie

Welcome! This guide is written for engineers who are **new to the project**. If you can write basic TypeScript, you can contribute here. Read [README.md](./README.md) first for the big picture, then come back.

The golden rules:

> **1. Never call Gemini directly.** Always go through the `ILLMProvider` interface.
> **2. Never hard-code a setting.** Behaviour goes in `src/core/config.ts`; the app-under-test (URLs, auth) goes in `config/targets.json`.
> **3. Never copy-paste a prompt into code.** Put it in `src/ai/prompts.ts`.
> **4. Never put selectors or URLs in a spec.** Selectors live in Page Objects (`src/pom/pages/`); navigation is `page.open()` against the configured `baseURL`.
> **5. Add a unit test for anything with logic.** The fake-provider seam makes it free (no API key, no browser).

Follow those five and your change will fit the architecture perfectly.

---

## Table of contents

1. [Setup for development](#1-setup-for-development)
2. [The mental model (read this once)](#2-the-mental-model-read-this-once)
3. [Recipe: add a new capability (CLI command)](#3-recipe-add-a-new-capability-cli-command)
4. [Recipe: add a Page Object](#4-recipe-add-a-page-object)
5. [Recipe: add a new environment (target)](#5-recipe-add-a-new-environment-target)
6. [Recipe: add a new self-healing action](#6-recipe-add-a-new-self-healing-action)
7. [Recipe: change or add a prompt](#7-recipe-change-or-add-a-prompt)
8. [Recipe: add a config setting](#8-recipe-add-a-config-setting)
9. [Recipe: support a new AI provider (e.g. OpenAI)](#9-recipe-support-a-new-ai-provider-eg-openai)
10. [Writing tests (with the fake provider)](#10-writing-tests-with-the-fake-provider)
11. [Coding conventions](#11-coding-conventions)
12. [Before you open a PR — checklist](#12-before-you-open-a-pr--checklist)

---

## 1. Setup for development

```bash
npm install
cp .env.example .env        # add your Gemini key (only needed for live runs)
npm run typecheck           # must pass
npm run test:unit           # must be green (offline, no key needed)
```

Day-to-day loop while coding:
```bash
npm run typecheck && npm run test:unit
```

---

## 2. The mental model (read this once)

Three abstractions hold the whole framework together. Understand these and everything else clicks.

### a) `ILLMProvider` (`src/ai/provider.ts`)
The contract for "an AI backend". Two methods: `generate(prompt, options)` and `runAgentLoop(...)`. Your code depends on **this interface**, never on `GeminiClient`. That's why tests can swap in a fake.

### b) `TaskContext` + `BaseTask` (`src/core/task.ts`)
A capability is a class extending `BaseTask`. Its constructor receives a `TaskContext` = `{ provider, config }`. So inside any task you have:
- `this.ctx.provider` — the AI
- `this.ctx.config` — all settings
- `this.generate(prompt)` — a helper that calls the provider **and auto-tags token usage** with your task name

You never reach for globals. That's what makes tasks testable.

### c) The registry (`src/core/registry.ts`)
A list of all capabilities by name. The CLI reads it to know what commands exist. You register your task once; it instantly becomes a CLI command and shows up in `--help`.

```
CLI command  →  registry.createTask(name, ctx)  →  YourTask.run(input)
                                                        │
                                                        └─ uses this.ctx.provider / config
```

### d) Page Objects (`src/pom/`)
Selectors never live in specs. Each page is a class extending `BasePage`, declaring its `path`, a `selectors` map (brittle CSS/XPath → self-healing via `this.el(name)`), and intent methods. Robust role/text locators are plain getters. Tests import page objects from the `src/pom/index.ts` barrel and drive the app through them.

### e) Targets (`config/targets.json` + `src/core/target-config.ts`)
The app-under-test — its `baseURL` and auth shape — is declared per environment in `config/targets.json` (secret-free; credentials referenced by env-var name). `loadTarget()` picks the active one via `GENIE_ENV` and resolves credentials from `.env`. `playwright.config.ts` turns that into `use.baseURL` + `storageState`, so navigation is relative and tests start authenticated.

---

## 3. Recipe: add a new capability (CLI command)

Goal: add a command, e.g. `explain` that takes a URL and asks the AI to describe the page.

### Step 1 — create the task file
`src/capabilities/explain-task.ts`:
```ts
import { BaseTask } from '../core/task';

export interface ExplainInput {
  url: string;
}

export class ExplainTask extends BaseTask<ExplainInput, void> {
  static readonly taskName = 'explain';
  static readonly taskDescription = 'Describe what a web page is for';

  readonly name = ExplainTask.taskName;
  readonly description = ExplainTask.taskDescription;

  async run({ url }: ExplainInput): Promise<void> {
    // `this.generate` auto-tags token usage with the task name ('explain').
    const summary = await this.generate(`In 2 sentences, what is the page at ${url} for?`);
    console.log(summary);
  }
}
```

### Step 2 — register it
In `src/capabilities/index.ts`, add two lines:
```ts
import { ExplainTask } from './explain-task';
// ...inside registerBuiltinTasks():
registerTask(ExplainTask.taskName, ExplainTask.taskDescription, (ctx) => new ExplainTask(ctx));
```

### Step 3 — (if it needs CLI arguments) teach the CLI how to build its input
In `src/generator/cli.ts`, `buildInput` already parses args into `positionals`,
`headed`, and `file` (via `parseArgs`) and resolves the instruction `text`
(inline or from `--file`). Add a `case` that maps them to your input:
```ts
case 'explain':
  return { url: positionals[0] } satisfies ExplainInput;
```

Done. Now this works and shows up in help automatically:
```bash
npm run genie -- explain "https://example.com"
npm run genie            # ← 'explain' is listed
```

> **That's the whole extension story.** You touched the AI provider zero times, dotenv zero times, and got token tracking + a CLI command for free.

---

## 4. Recipe: add a Page Object

Goal: model a new page (say a search page) so tests reference it by intent, not selectors.

### Step 1 — create the page class
`src/pom/pages/search.page.ts`:
```ts
import type { Locator } from '@playwright/test';
import { BasePage } from '../base-page';

// Brittle CSS/XPath ONLY — these self-heal via this.el(name).
const selectors = {
  resultsList: '.search-results',
} as const;

export class SearchPage extends BasePage<typeof selectors> {
  readonly path = '/search';                 // relative — resolved against baseURL
  protected readonly selectors = selectors;

  // Robust locators → plain getters, NOT in the selectors map (no healing needed).
  get searchBox(): Locator {
    return this.page.getByRole('searchbox');
  }

  async search(term: string): Promise<void> {
    await this.searchBox.fill(term);
    await this.searchBox.press('Enter');
    await this.el('resultsList').waitFor();  // self-healing handle
  }
}
```

### Step 2 — export it from the barrel
In `src/pom/index.ts`:
```ts
export { SearchPage } from './pages/search.page';
```

Now any test can `import { SearchPage } from '../src/pom'` and drive it. Rules of thumb:
- **Brittle** CSS/XPath → the `selectors` map + `this.el(name)` (self-healing).
- **Robust** role/label/text → a plain getter returning `this.page.getByRole(...)`.
- Expose **intent methods** (`search(term)`), keep raw locators private.
- `open()` and `path` are relative — never a full URL.

> The `generate` command creates/extends page objects and wires the barrel for you. This recipe is for when you're writing one by hand.

---

## 5. Recipe: add a new environment (target)

Goal: point Genie at another deployment of the app.

### Step 1 — add the environment to `config/targets.json`
```jsonc
"qa": {
  "baseURL": "https://qa.app.example.com",
  "auth": {
    "required": true,
    "type": "form",
    "loginPath": "/login",
    "usernameEnv": "QA_USERNAME",     // NAME of an env var — never the value
    "passwordEnv": "QA_PASSWORD",
    "selectors": { "username": "#user", "password": "#pass", "submit": "button[type=submit]" },
    "successUrl": "/home"
  }
}
```

### Step 2 — put the real credentials in `.env` (and document them in `.env.example`)
```bash
QA_USERNAME=qa.bot@example.com
QA_PASSWORD=••••••
```

### Step 3 — run against it
```bash
GENIE_ENV=qa npm test
```

> **Never commit real passwords.** `config/targets.json` only names the env vars; values live in `.env`/CI secrets and are resolved by `src/core/target-config.ts`, which fails loudly if a required var is missing.

**New auth type (SSO/OAuth/MFA)?** Add the value to `AuthType` in `src/core/target-config.ts` and a matching branch in `tests/global-setup.ts` that performs the flow and calls `context.storageState({ path })`. Everything downstream (`use.storageState`) is unchanged.

---

## 6. Recipe: add a new self-healing action

`SmartLocator` (`src/healing/smart-locator.ts`) already heals `click`, `fill`, `innerText`, `waitFor`. The try/heal/retry logic lives in **one** private method, `withHealing()`. To add a new action (say `hover`), add **one line**:

```ts
/** Hover the element, auto-healing the selector on failure. */
hover(options?: Parameters<Locator['hover']>[0]): Promise<void> {
  return this.withHealing((loc) => loc.hover(options));
}
```

No try/catch, no retry boilerplate — `withHealing` handles it. Add a unit test in `tests/unit/healing.spec.ts` if the action has interesting behavior.

---

## 7. Recipe: change or add a prompt

All prompt text is in `src/ai/prompts.ts` as pure functions. To tune how Genie writes tests, edit `generateTestPrompt`. To add a new prompt for your capability:

```ts
// src/ai/prompts.ts
export function explainPagePrompt(url: string): string {
  return `In 2 sentences, what is the page at ${url} for? Plain text only.`;
}
```

Then use it from your task: `await this.generate(explainPagePrompt(url))`.

**Why this matters:** prompts are pure functions, so you can unit-test them (assert the rendered string contains what it should) without any AI call. See the `prompts` tests in `tests/unit/generation.spec.ts`.

---

## 8. Recipe: add a config setting

Never sprinkle magic numbers in code. To add, say, a "screenshot quality" setting:

### Step 1 — add the field to the `GenieConfig` interface (`src/core/config.ts`)
```ts
healing: {
  domMaxChars: number;
  cachePath: string;
  screenshotQuality: number;   // ← new
};
```

### Step 2 — give it a default + env override in `loadConfig`
```ts
healing: {
  domMaxChars: envInt('GENIE_DOM_MAX_CHARS', 6000),
  cachePath: process.env.GENIE_HEAL_CACHE ?? path.join(reportsDir, 'healed-locators.json'),
  screenshotQuality: envInt('GENIE_SCREENSHOT_QUALITY', 80),   // ← new
},
```

### Step 3 — document it
Add a line to `.env.example` and to the config table in `README.md`.

Now read it anywhere via `config.healing.screenshotQuality`.

---

## 9. Recipe: support a new AI provider (e.g. OpenAI)

This is the payoff of the whole architecture. Two steps:

### Step 1 — implement the interface
`src/ai/openai-client.ts`:
```ts
import type { ILLMProvider, FunctionDeclaration, GenerateOptions } from './provider';

export class OpenAIClient implements ILLMProvider {
  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    // ...call OpenAI, return the text...
  }
  async runAgentLoop(/* ...same signature... */): Promise<string> {
    // ...
  }
}
```

### Step 2 — add it to the factory (`src/ai/factory.ts`)
```ts
switch (config.llm.provider) {
  case 'gemini': return new GeminiClient({ /* ... */ });
  case 'openai': return new OpenAIClient({ /* ... */ });   // ← new
  default: throw new Error(`Unknown LLM provider: "${config.llm.provider}"`);
}
```

(Also add `'openai'` to the provider type in `config.ts`.)

**No other file changes.** Every capability, the healer, the reporter, and the agent now work with the new provider, because they all depend on `ILLMProvider`, not on a concrete class.

---

## 10. Writing tests (with the fake provider)

Unit tests live in `tests/unit/` and run **offline** via `npm run test:unit`. The trick: inject a fake provider so no real AI call happens.

```ts
import { test, expect } from '@playwright/test';
import { createTask } from '../../src/core/registry';
import { createContext } from '../../src/core/task';
import { registerBuiltinTasks } from '../../src/capabilities';

test('my task uses the provider', async () => {
  registerBuiltinTasks();

  // A fake provider — returns canned text, costs nothing, needs no key.
  const fake = {
    generate: async () => 'canned AI response',
    runAgentLoop: async () => 'GOAL_ACHIEVED: done',
  };

  const task = createTask('explain', createContext({ provider: fake }));
  await task.run({ url: 'https://example.com' });
  // ...assert on the side effects...
});
```

Guidelines:
- **Pure logic** (config, prompts, retry, local-heal heuristics, distillation) → test the function directly. No fake needed.
- **Anything that would call AI** → inject a `fake` provider.
- **Files on disk** (cache, generated specs/page objects) → write inside the project tree (e.g. a `tests/.tmp-<pid>/` dir you clean up in `afterAll`), **not** `/tmp` — TypeScript needs to resolve `@playwright/test` relative to the project. If a test writes into shared source (e.g. `src/pom/`), snapshot and restore what you touched in `afterAll` (see the POM-aware generator test in `tests/unit/generation.spec.ts`).

Run them:
```bash
npm run test:unit                                              # all
npx playwright test --config playwright.unit.config.ts -g "my task"   # one
```

---

## 11. Coding conventions

- **TypeScript strict mode** is on. Run `npm run typecheck` — it must pass with zero errors.
- **Match the surrounding style** — comment density, naming, structure. Read the file you're editing first.
- **Logging:** use `createLogger('YourNamespace')`, not `console.log`. Pick the right level (`debug` for chatty diagnostics, `info` for milestones, `warn`/`error` for problems).
- **Token tagging:** when you call the provider, pass a `label` (or use `this.generate` in a task, which sets it for you) so usage shows up correctly in the report.
- **One responsibility per file.** If a file is growing two jobs, split it (look at how `healing/` is broken into `healer` / `local-strategies` / `heal-cache`).
- **Errors:** don't swallow silently. Log them, or let them propagate. Best-effort optimizations (cache writes, telemetry) may swallow — and say so in a comment.

---

## 12. Before you open a PR — checklist

```bash
npm run typecheck     # ✅ zero errors
npm run test:unit     # ✅ all green
```

- [ ] `npm run typecheck` passes.
- [ ] `npm run test:unit` passes.
- [ ] New logic has a unit test (using the fake provider if it touches AI).
- [ ] No direct `GeminiClient` import outside `src/ai/` — you went through `ILLMProvider` / the factory.
- [ ] No hard-coded models/timeouts/paths — they're in `src/core/config.ts`.
- [ ] No hard-coded URLs or credentials — they're in `config/targets.json` / `.env`.
- [ ] No selectors or `page.goto('http…')` in specs — locators are in Page Objects, navigation is `page.open()`.
- [ ] No inline prompt strings — they're in `src/ai/prompts.ts`.
- [ ] New config settings are documented in `.env.example` and the README table.
- [ ] New environments/credentials are documented in `.env.example` (referenced by name in `config/targets.json`).
- [ ] Logs use the namespaced logger, not `console.log`.
- [ ] If you added a capability: it's registered in `capabilities/index.ts` and (if it takes args) wired in `cli.ts`.
- [ ] If you added a page object: it's exported from `src/pom/index.ts`.

Thanks for contributing! 🧞
