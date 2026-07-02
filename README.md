# 🧞 NexTest Genie

> An AI-powered UI test automation framework built on **Playwright** + **Google Gemini**.

NexTest Genie does four things, all driven by plain English:

| # | Capability | What it means in plain words |
|---|------------|------------------------------|
| 1 | **Generate tests** | You describe a test in English → Genie writes a runnable Playwright `.spec.ts` **and the Page Objects it needs**. |
| 2 | **Self-healing locators** | When a button/link selector breaks after a UI change, Genie finds a working one automatically — no test edit needed. |
| 3 | **Autonomous agent** | You give a goal ("find the changelog") → Genie drives a real browser by itself to do it. |
| 4 | **AI run reports** | After tests run, Genie writes a human-readable summary of what passed, what failed, and the token cost. |

Two architectural pillars sit under all four:

- **Config-driven targets** — the app-under-test's URLs and credentials live in `config/targets.json` + `.env`, not hard-coded in tests. Switch environments with one variable.
- **Page Object Model** — locators live in page objects (on top of self-healing), never inline in specs.

If you've never seen this project before, **read this file top to bottom once** and you'll be able to install it, run it, and understand every folder.

---

## Table of contents

1. [Quick start (5 minutes)](#1-quick-start-5-minutes)
2. [The big picture — how it all fits together](#2-the-big-picture--how-it-all-fits-together)
3. [Folder-by-folder tour](#3-folder-by-folder-tour)
4. [The four flows, step by step](#4-the-four-flows-step-by-step)
5. [Environments, URLs & credentials](#5-environments-urls--credentials)
6. [Page Objects — where locators live](#6-page-objects--where-locators-live)
7. [Using the CLI](#7-using-the-cli)
8. [Writing tests with page objects & self-healing](#8-writing-tests-with-page-objects--self-healing)
9. [Running tests (single & all)](#9-running-tests-single--all)
10. [Reading the reports](#10-reading-the-reports)
11. [Logs & debugging](#11-logs--debugging)
12. [Configuration reference](#12-configuration-reference)
13. [Token cost — how Genie keeps it low](#13-token-cost--how-genie-keeps-it-low)
14. [FAQ / troubleshooting](#14-faq--troubleshooting)

---

## 1. Quick start (5 minutes)

### Prerequisites
- **Node.js 18+**
- **Google Chrome** installed (the tests use your system Chrome)
- A **free** Gemini API key from <https://aistudio.google.com> (no credit card needed)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your env file and paste your Gemini key into it
cp .env.example .env
#   then edit .env →  GEMINI_API_KEY=your_real_key_here

# 3. Verify everything compiles
npm run typecheck

# 4. Run the offline unit tests (no key/browser needed) — should be all green
npm run test:unit
```

### Point Genie at your app

Open `config/targets.json` and edit (or add) an environment: its `baseURL`, and — if the
app needs login — the auth block. Put real credentials in `.env` (never in the JSON).
Select which environment to use with `GENIE_ENV` (defaults to the file's `defaultEnv`).
See [§5](#5-environments-urls--credentials).

### Your first real action

```bash
# Generate a Playwright test (+ page objects) from plain English
npm run generate -- "on the home page, verify the title contains Playwright"

# Run all browser tests
npm test

# Open the visual HTML report
npm run report
```

That's it. The rest of this document explains *what just happened*.

---

## 2. The big picture — how it all fits together

Everything in Genie is built on **two external engines** and **one core idea**:

- **Playwright** → controls the browser (clicks, types, navigates, asserts).
- **Google Gemini** → the "brain" that writes tests, fixes selectors, and makes decisions.
- **The core idea** → *nothing talks to Gemini directly*. Every feature asks an **`ILLMProvider`** interface for AI, and a single **factory** decides which AI backend that is. This is what makes the framework easy to test (swap in a fake), cheap to run (one place to tune models), and easy to extend.

```
            ┌──────────────────────────────────────────────┐
            │                  YOU                          │
            │   CLI commands  •  test files  •  npm scripts │
            └───────────────┬──────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────────────┐
        │                   │                           │
   ┌────▼─────┐      ┌──────▼───────┐           ┌────────▼────────┐
   │ Generate │      │ Page Objects │           │  GenieAgent     │
   │  a test  │      │  + SmartLoc. │           │ (autonomous)    │
   └────┬─────┘      └──────┬───────┘           └────────┬────────┘
        │                   │                            │
        │                   ▼                            │
        │            ┌─────────────┐                     │
        │            │   Healer    │                     │
        │            └──────┬──────┘                     │
        │                   │                            │
        └───────────┬───────┴──────────┬─────────────────┘
                    ▼                  ▼
            ┌───────────────┐   ┌──────────────┐
            │ ILLMProvider  │   │ Playwright   │
            │  (interface)  │   │ MCP (browser │
            │      ▲        │   │  tool server)│
            │      │        │   └──────────────┘
            │  ┌───┴────┐   │
            │  │Factory │   │  ← the ONLY place that picks the AI backend
            │  └───┬────┘   │
            │      ▼        │
            │ GeminiClient  │  ← retries, token tracking, model selection
            └───────────────┘
```

Two more single-sources-of-truth sit alongside the AI layer:
- **`src/core/config.ts`** — *how the framework behaves* (models, timeouts, budgets).
- **`config/targets.json`** — *what it points at* (environments, base URLs, auth shape).

**Key takeaway:** if you ever want to replace Gemini with OpenAI/Groq/etc., you implement `ILLMProvider` once and add one line to the factory. No other file changes.

---

## 3. Folder-by-folder tour

```
nextest.genie/
├── config/
│   └── targets.json    ← Environments: baseURL + auth shape (NO secrets)
├── src/
│   ├── ai/              ← Everything about talking to the AI model
│   ├── core/            ← Shared plumbing (config, target-config, logging, retries, tasks)
│   ├── dom/             ← Turning a web page into cheap, AI-friendly text
│   ├── healing/         ← Self-healing locators
│   ├── pom/             ← Page Object Model (base class + page objects)
│   ├── generator/       ← Plain-English → Playwright test file (+ page objects)
│   ├── agent/           ← The autonomous browser agent
│   ├── capabilities/    ← The "menu" of things Genie can do (CLI commands)
│   └── reporter/        ← The AI-written test run summary
├── tests/
│   ├── example.spec.ts  ← Demo browser tests (need internet + Chrome)
│   ├── global-setup.ts  ← Logs in once & saves the session (auth environments)
│   └── unit/            ← Fast offline tests of the framework itself
├── test-instructions/   ← Plain-English flow files you can pass with --file
├── reports/             ← All generated output lands here
│   └── .auth/           ← Saved login sessions (gitignored — contains cookies)
├── .env                 ← Your secrets (Gemini key, app credentials) — never committed
├── playwright.config.ts        ← Config for real browser tests (baseURL, storageState, globalSetup)
└── playwright.unit.config.ts   ← Config for fast offline unit tests
```

### `src/ai/` — the AI layer
| File | Plain-English purpose |
|------|------------------------|
| `provider.ts` | The **contract** (`ILLMProvider`) every AI backend must fulfill: "give me text", "run an agent loop". Also defines per-call options (model, token cap, label). |
| `gemini-client.ts` | The real Gemini implementation. Handles model selection, **retries on rate limits**, and **token usage tracking**. |
| `factory.ts` | The single place that builds the AI backend. `createProvider()` (fresh) and `getDefaultProvider()` (shared). Swap providers here. |
| `prompts.ts` | **All prompt text in one file**, as pure functions. The generation prompt encodes the POM + config conventions and a multi-file output contract. |

### `src/core/` — shared plumbing
| File | Plain-English purpose |
|------|------------------------|
| `config.ts` | The **single source of truth** for framework *behaviour* (models, timeouts, token caps, paths). Reads defaults, lets you override with env vars. |
| `target-config.ts` | Loads `config/targets.json`, picks the active environment (`GENIE_ENV`), and resolves credentials from `.env`. The single source of truth for *what app we test*. |
| `logger.ts` | Leveled logging (`debug`/`info`/`warn`/`error`). Keeps CI output clean. |
| `retry.ts` | Retries transient failures (429 rate limits, 503, network blips) with exponential backoff. Doesn't retry real errors like a bad request. |
| `usage.ts` | Tracks **token usage** to a shared file so the report can show cost per capability. |
| `task.ts` | `BaseTask` — the base class every capability extends. Gives it the AI provider, config, and a token-tagged `generate()` helper for free. |
| `registry.ts` | The list of available capabilities. `registerTask` / `createTask` / `listTasks`. The CLI reads from here. |

### `src/dom/` — page distillation
| File | Plain-English purpose |
|------|------------------------|
| `distiller.ts` | Converts a full web page into a tiny list of just the **clickable/typeable elements**. Raw HTML is huge and expensive to send to AI; this cuts ~90% of the tokens. |

### `src/healing/` — self-healing locators
| File | Plain-English purpose |
|------|------------------------|
| `smart-locator.ts` | `SmartLocator` — wraps a Playwright locator. If a click/fill fails because the selector broke, it heals and retries once. |
| `healer.ts` | The heal brain. Tries, in order: **(1)** a cached fix, **(2)** free local heuristics, **(3)** asking the AI. Caches every success. |
| `local-strategies.ts` | The **free, no-AI** heal attempts: relaxes a broken selector (e.g. hashed class names, reordered attributes) and keeps one that uniquely matches. |
| `heal-cache.ts` | Reads/writes the heal cache safely even when multiple test workers run at once (atomic writes). |

### `src/pom/` — Page Object Model
| File | Plain-English purpose |
|------|------------------------|
| `base-page.ts` | `BasePage` — every page object extends it. Provides `open()` (relative nav), `el(name)` (a self-healing `SmartLocator` from the page's selector map), and `locatorOf(name)`. |
| `pages/*.page.ts` | One class per page. Declares its `path`, its brittle CSS/XPath in a `selectors` map, and exposes intent methods (`clickGetStarted()`, `search(term)`). |
| `introspect.ts` | Reads existing page objects so the **generator reuses them** instead of reinventing selectors. |
| `index.ts` | The barrel. Tests import page objects from here. Auto-wired by the generator when it creates a new page. |

### `src/generator/` — test generation
| File | Plain-English purpose |
|------|------------------------|
| `nl-generator.ts` | Turns an English intent into a spec **plus any page objects it needs**. Sandboxes writes to `tests/`/`src/pom/pages/`, auto-wires the barrel, and **typecheck-gates every file** (repairing via AI if it doesn't compile). |
| `instructions.ts` | Resolves `--file` arguments: a bare name is looked up in `test-instructions/`; a path is read directly. Clear errors, no stack traces. |
| `validate.ts` | Compiles a generated file with the project's TypeScript settings to catch errors before you ever run it. |
| `cli.ts` | The command-line entry point. Parses args (incl. `--file`/`-f`, `--headed`) and dispatches `generate` / `achieve` through the registry. |

### `src/agent/` — autonomous agent
| File | Plain-English purpose |
|------|------------------------|
| `ui-agent.ts` | `GenieAgent` — give it a goal, it loops: AI picks a browser action → executes it → repeats until the goal is met or it gives up. Uses a URL in the goal if given, else the configured `baseURL`. |
| `mcp-client.ts` | A tiny client that talks to the **Playwright MCP** server (the thing that exposes browser actions as "tools" the AI can call). |

### `src/capabilities/` — the menu
| File | Plain-English purpose |
|------|------------------------|
| `generate-task.ts` | Wraps test generation as a registered capability (`generate`). |
| `agent-task.ts` | Wraps the autonomous agent as a registered capability (`achieve`). |
| `index.ts` | Registers all built-in capabilities. **This is where you add a new one.** |

### `src/reporter/`
| File | Plain-English purpose |
|------|------------------------|
| `genie-reporter.ts` | A custom Playwright reporter. After a run it prints a summary, asks the AI to write a narrative, totals up token usage, and saves `reports/genie-summary.md`. |

---

## 4. The four flows, step by step

### Flow A — Generate a test (+ page objects) from English
```
You: npm run generate -- "on the home page, search for 'assertions' and verify a result"
  │
  ▼
cli.ts → registry → GenerateTask.run()
  │
  ▼
nl-generator.ts
  ├─ introspect.ts reads existing page objects (so they get REUSED)
  ├─ prompts.ts builds a POM-aware, multi-file prompt
  ├─ provider.generate() → Gemini writes a spec (+ page objects) as FILE blocks
  ├─ sandbox writes to tests/ and src/pom/pages/, then auto-wires src/pom/index.ts
  ├─ validate.ts compiles EVERY file
  │     ├─ compiles? ✓ done
  │     └─ fails?  → ask Gemini to repair (up to N times) → re-check
  └─ writes tests/<name>.spec.ts  +  src/pom/pages/<name>.page.ts
```

### Flow B — A locator self-heals during a test
```
Test runs → home.clickSearch() → el('search') selector no longer matches → throws
  │
  ▼
healer.ts
  ├─ 1. cache hit?            → reuse fix          (0 tokens, instant)
  ├─ 2. local heuristics?     → relaxed selector   (0 tokens)
  └─ 3. ask Gemini            → distilled DOM → new selector (some tokens)
  │
  ▼
SmartLocator retries the action with the healed selector → test continues
```

### Flow C — The autonomous agent achieves a goal
```
You: npm run achieve -- "find the changelog page and confirm it loads"
  │
  ▼
agent-task.ts → GenieAgent.achieve()
  ├─ goal has a URL?  → use it.   No URL?  → start from config baseURL (GENIE_ENV)
  ├─ starts Playwright MCP (a headless browser exposing "tools")
  ├─ lists tools (navigate, click, type, snapshot…)
  └─ loop (up to maxSteps):
        Gemini picks a tool → MCP executes it → result fed back → repeat
        until Gemini replies "GOAL_ACHIEVED:" or "GOAL_FAILED:"
```

### Flow D — Reporting after a run
```
npm test finishes
  │
  ▼
genie-reporter.ts
  ├─ collects pass/fail/duration per test
  ├─ asks Gemini for a 3–5 sentence summary
  ├─ totals token usage (per capability)
  └─ writes reports/genie-summary.md  +  prints to console
```

---

## 5. Environments, URLs & credentials

Tests never hard-code URLs. The app-under-test is described once in **`config/targets.json`**,
and the active one is chosen with the **`GENIE_ENV`** variable.

```jsonc
{
  "defaultEnv": "playwright-docs",
  "environments": {
    "staging": {
      "baseURL": "https://staging.app.example.com",
      "auth": {
        "required": true,
        "type": "form",
        "loginPath": "/login",
        "usernameEnv": "STAGING_USERNAME",   // ← NAME of an env var, not the value
        "passwordEnv": "STAGING_PASSWORD",
        "selectors": { "username": "#username", "password": "#password", "submit": "button[type=submit]" },
        "successUrl": "/dashboard"
      }
    }
  }
}
```

### The golden rule for secrets
> **`config/targets.json` is committed and must never contain real passwords.**
> It references credentials **by env-var name**; the actual values live in `.env`
> (gitignored) or CI secrets and are resolved at runtime by `src/core/target-config.ts`.

```bash
# .env  (gitignored)
STAGING_USERNAME=qa.bot@example.com
STAGING_PASSWORD=••••••
```

### How it wires into a run
- `playwright.config.ts` reads the active target and sets `use.baseURL` (so `page.goto('/')` and `page.open()` are relative) and, for auth environments, `use.storageState`.
- `tests/global-setup.ts` logs in **once** before the suite and saves the session to `reports/.auth/<env>.json` (gitignored). Every test then starts already authenticated — no per-test login.
- If a required credential env var is missing, the run **fails loudly at startup** with a clear message (better than a confusing redirect to a login page mid-test).

### Switching environments
```bash
npm test                                   # uses defaultEnv
GENIE_ENV=staging npm test                 # target staging
GENIE_ENV=staging npm run achieve -- "open the dashboard and check the KPIs"
```

If the app uses SSO/OAuth/MFA rather than a form login, extend `AuthType` and add a branch in `tests/global-setup.ts` — see CONTRIBUTING.md.

---

## 6. Page Objects — where locators live

Selectors do **not** belong in spec files. Each page has a Page Object under
`src/pom/pages/` that declares its locators once; tests reference elements by
intent (`home.clickGetStarted()`), never by selector.

Page objects are built on `BasePage` and integrate the self-healing `SmartLocator`, with a deliberate two-tier split:

| Locator kind | Where it goes | Why |
|--------------|---------------|-----|
| **Brittle** CSS/XPath | the `selectors` map → `this.el('name')` | Returns a self-healing `SmartLocator` — the AI healer fixes it if it drifts. |
| **Robust** role/label/text | a plain getter → `this.page.getByRole(...)` | Already resilient — no healing needed, so no AI cost. |

```ts
// src/pom/pages/docs-home.page.ts
import type { Locator } from '@playwright/test';
import { BasePage } from '../base-page';

const selectors = {
  getStartedLink: 'a[href="/docs/intro"]',   // brittle CSS → healable
  heroTitle: '.hero__title',
} as const;

export class DocsHomePage extends BasePage<typeof selectors> {
  readonly path = '/';                        // relative — resolved against baseURL
  protected readonly selectors = selectors;

  get getStartedButton(): Locator {           // robust → plain locator, not in the map
    return this.page.getByRole('link', { name: /get started/i });
  }

  async clickGetStarted(): Promise<void> {
    await this.el('getStartedLink').click();  // self-healing handle
  }

  async heroText(): Promise<string> {
    return this.el('heroTitle').innerText();
  }
}
```

**`BasePage` gives every page:**
- `open()` — navigate to `path` (relative to the configured `baseURL`).
- `el(name)` — a **memoized, self-healing** `SmartLocator` for a brittle selector (`.click()`, `.fill()`, `.innerText()`, `.waitFor()`, `.native()`).
- `locatorOf(name)` — the raw Playwright `Locator` for `expect()` assertions.

`el('typo')` is a **compile-time error** — the selector names are typed.

Adding a page is mechanical: create `src/pom/pages/<name>.page.ts`, then export it from `src/pom/index.ts`. (The generator does both for you — see [§7](#7-using-the-cli).)

---

## 7. Using the CLI

Every command is available three ways — the shortcut scripts are shortest:

```bash
npm run generate -- "<intent>" [outputPath]     # shortcut for: genie -- generate
npm run achieve  -- "<goal>"   [--headed]        # shortcut for: genie -- achieve
npm run genie    -- <command> "<text>" [options] # the shared entry point
```

*(The `--` passes everything after it to the script instead of to npm.)*
Run `npm run genie` with no arguments to see live help generated from the registry.

### `generate` — create a test (+ page objects)
```bash
# Default output path (tests/generated-<timestamp>.spec.ts)
npm run generate -- "search for 'playwright' and verify a result appears"

# Custom output path
npm run generate -- "add an item to the cart" tests/cart.spec.ts
```
Generation is **POM- and config-aware**: it writes a spec that drives the app
through page objects, creates or extends page objects under `src/pom/pages/`,
auto-wires the barrel, uses relative navigation (no hard-coded URLs), and
typecheck-gates everything.

### `achieve` — let the agent drive the browser
```bash
# Provide a URL → the agent starts there
npm run achieve -- "open https://playwright.dev and find the changelog"

# No URL → the agent starts from the configured baseURL (GENIE_ENV)
npm run achieve -- "find the changelog page and confirm it loads"

# Watch it happen in a visible browser
npm run achieve -- "find the changelog page and confirm it loads" --headed
```

### `--file` / `-f` — pass instructions from a file
For multi-line flows, put the plain-English steps in a file instead of a giant
one-line string. A **bare name** is looked up in `test-instructions/` (the
`.txt`/`.md` extension is optional); a **path** is read directly.

```bash
npm run generate -- --file login-flow tests/login.spec.ts   # from test-instructions/login-flow.txt
npm run achieve  -- -f ./drafts/checkout.txt --headed        # from an explicit path
```

If the file can't be resolved, the CLI logs a clear error (and lists what's
available) then exits — no stack trace, no API key required. See
`test-instructions/README.md` and the `example-search.txt` template.

---

## 8. Writing tests with page objects & self-healing

Drive the app through page objects; keep selectors and URLs out of the spec:

```ts
import { test, expect } from '@playwright/test';
import { DocsHomePage, DocsIntroPage } from '../src/pom';

test('navigates to the docs using page objects', async ({ page }) => {
  const home = new DocsHomePage(page);
  await home.open();              // relative path + configured baseURL
  await home.clickGetStarted();   // self-healing under the hood

  const intro = new DocsIntroPage(page);
  await expect(page).toHaveURL(/.*\/docs\/intro/);
  await expect(intro.installationHeading).toBeVisible();
});
```

- **Navigation** is `page.open()` — never `page.goto('https://…')`. The base URL comes from `config/targets.json`.
- **Locators** live in the page object. Brittle CSS/XPath goes through `el(name)` and self-heals; robust role/text locators are plain getters. See [§6](#6-page-objects--where-locators-live).

`SmartLocator` actions available today: `click`, `fill`, `innerText`, `waitFor`, plus `.native()` for `expect()`. (Adding more is a one-liner — see CONTRIBUTING.md.)

See `tests/example.spec.ts` for full working examples of all three capabilities.

---

## 9. Running tests (single & all)

There are **two test suites**:

| Suite | Command | Needs internet/Chrome/API key? | Speed |
|-------|---------|-------------------------------|-------|
| **Unit** (tests the framework itself) | `npm run test:unit` | ❌ No — fully offline | ~2s |
| **E2E** (real browser tests in `tests/`) | `npm test` | ✅ Yes | slower |

### Run everything
```bash
npm test            # all browser/e2e tests (writes the HTML report to reports/html/)
npm run report      # open that HTML step-by-step report in your browser
npm run test:unit   # all offline unit tests
```

### Run a single test file
```bash
npm test tests/docker-search.spec.ts                 # via the npm script
npx playwright test tests/example.spec.ts            # or call Playwright directly
npx playwright test --config playwright.unit.config.ts tests/unit/healing.spec.ts
```

### Run a single test by name
```bash
# -g matches the test title (regex). Note the `--`: it forwards flags through npm.
npm test -- -g "searching for"
npm test tests/docker-search.spec.ts -- -g "Docker docs page"   # narrow to one file too

# Or call Playwright directly (no `--` needed)
npx playwright test -g "reads page title"
npx playwright test --config playwright.unit.config.ts -g "retries transient failures"
```

> **Why the `--`?** With the npm scripts, `--` tells npm "pass everything after this
> to the underlying command." A bare file path is a positional arg and doesn't need it;
> flags like `-g` do. Calling `npx playwright test` directly avoids the `--` entirely.

### Other useful modes
```bash
npm run test:headed   # watch the browser run
npm run test:ui       # Playwright's interactive UI mode (best for step-by-step debugging)
npm run typecheck     # compile-check the whole project (no tests run)
```

### Two gotchas
- **Don't pass `--reporter=…`** — it *replaces* the reporters in `playwright.config.ts`,
  so `reports/html/` is never written and you're left with only `.last-run.json`.
  Run plain `npm test` to get the HTML report.
- **Behind a corporate TLS proxy**, the end-of-run AI summary (a Gemini call) fails
  unless the CA bundle is set first: `export NODE_EXTRA_CA_CERTS="$HOME/.genie-ca-bundle.pem"`
  (see [§14](#14-faq--troubleshooting)). The tests themselves still run without it.

---

## 10. Reading the reports

Everything lands in the **`reports/`** folder:

| File / folder | What it is | How to view |
|---------------|------------|-------------|
| `reports/genie-summary.md` | **The AI summary** — pass/fail outcome, narrative, failed-test details, and a **token-usage table**. | Open in any Markdown viewer. |
| `reports/html/` | Playwright's rich visual report (timelines, steps, screenshots). | `npm run report` |
| `reports/test-results/` | Raw artifacts: screenshots-on-failure, traces, and videos (only when video recording is enabled — see below). | Open files directly. |
| `reports/healed-locators.json` | Cache of every selector Genie has healed (with `source: local` or `ai`). | Open as JSON. |
| `reports/.auth/` | Saved login sessions (storageState) for authenticated environments. **Gitignored — contains live cookies.** | Not for reading. |

### The HTML report & step-by-step status

```bash
npm test          # run tests using the configured reporters (writes reports/html/)
npm run report    # open the HTML report in your browser
```

Click any test in the report to expand its **step tree** — each `test.step(...)`
appears as its own row with an individual pass/fail status and duration, so you
see exactly which step succeeded or failed, not just the overall result.
Generated tests wrap their actions in `test.step()` automatically. When a test
fails, its **trace** is attached too — open it for a full timeline with
before/after DOM snapshots (set `GENIE_TRACE=on` to trace every run).

> ⚠️ **Gotcha:** passing `--reporter=<x>` on the command line *replaces* the
> reporters in `playwright.config.ts`, so `reports/html/` is **not** written and
> you're left with only `reports/test-results/.last-run.json`. Run plain
> `npm test` (no `--reporter` flag) to get the HTML report.

A `genie-summary.md` looks roughly like:

```markdown
# NexTest Genie — AI Test Run Summary
**Overall Status:** PASSED

## Run Statistics
| Metric | Value |
| Total  | 3     | Passed | 3 | Failed | 0 | Duration | 12.4s |

## AI Summary
All three tests passed. No regressions detected ...

## Token Usage
| Capability | Calls | Prompt | Output | Total |
| heal       | 1     | 420    | 12     | 432   |
| report     | 1     | 180    | 90     | 270   |
| **Total**  | **2** | **600**| **102**| **702**|
```

The **Token Usage** table is how you keep an eye on AI cost — if `heal` is huge, your selectors are breaking a lot.

### Video recording (opt-in)

Video recording is **off by default** — it requires Playwright's `ffmpeg` binary and
slows tests down. Enable it per-run with the `GENIE_VIDEO` env var:

```bash
# One-time: install the ffmpeg binary Playwright uses to encode videos
npx playwright install ffmpeg

# Then record video for a run
GENIE_VIDEO=on npm test                 # record every test
GENIE_VIDEO=retain-on-failure npm test  # keep video only for failing tests
GENIE_VIDEO=on-first-retry npm test     # record only when a test is retried
```

Videos land in `reports/test-results/`. If you enable `GENIE_VIDEO` without
installing ffmpeg first, tests fail with *"Executable doesn't exist … ffmpeg-mac"* —
just run `npx playwright install ffmpeg`.

---

## 11. Logs & debugging

Genie uses a leveled logger. Control verbosity with an env var:

```bash
# See everything (every AI step, cache hit, token line)
GENIE_DEBUG=true npm test

# Or set an explicit level
GENIE_LOG_LEVEL=debug npm test     # debug | info | warn | error | silent
GENIE_LOG_LEVEL=warn npm test      # quiet — only warnings and errors
```

Every log line is **namespaced** so you know its source:
```
[Healer] Local heal (no LLM): ".hero__title_x1" → "[class*=\"hero__title\"]"
[GenieAgent] No URL in goal — starting from configured baseURL for "staging": https://staging.app.example.com
[Gemini generate] failed (attempt 1/3), retrying in 512ms: 429 Too Many Requests
```

To also see the underlying Playwright MCP server logs during agent runs, set `GENIE_DEBUG=true`.

---

## 12. Configuration reference

Genie has **two** configuration surfaces, and you edit neither in code:

**A) Framework behaviour** — environment variables (in `.env` or inline). Defaults live in `src/core/config.ts`.

| Env var | Default | What it controls |
|---------|---------|------------------|
| `GEMINI_API_KEY` | *(required)* | Your Gemini API key. |
| `GENIE_MODEL` | `gemini-2.5-flash` | Default model for all calls. |
| `GENIE_GENERATION_MODEL` | = `GENIE_MODEL` | Model for writing tests (use a stronger one for quality). |
| `GENIE_HEALING_MODEL` | = `GENIE_MODEL` | Model for healing (use a cheap one — runs often). |
| `GENIE_AGENT_MODEL` | = `GENIE_MODEL` | Model for the autonomous agent. |
| `GENIE_REPORT_MODEL` | = `GENIE_MODEL` | Model for the run summary. |
| `GENIE_MAX_OUTPUT_TOKENS` | `2048` | Hard cap on output tokens per call. |
| `GENIE_TEMPERATURE` | `0.2` | Lower = more deterministic (good for code/selectors). |
| `GENIE_DOM_MAX_CHARS` | `6000` | Max distilled-DOM size sent when healing. |
| `GENIE_MAX_REPAIR_ATTEMPTS` | `1` | How many times to ask AI to fix non-compiling generated files. |
| `GENIE_MAX_RETRIES` | `3` | Retries on transient (429/503/network) failures. |
| `GENIE_RETRY_BASE_MS` | `500` | Base backoff delay (grows exponentially). |
| `GENIE_AGENT_MAX_STEPS` | `20` | Max actions the agent takes before giving up. |
| `GENIE_MCP_TIMEOUT_MS` | `30000` | Timeout for each browser tool call. |
| `GENIE_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` / `silent`. |
| `GENIE_DEBUG` | *(unset)* | `true` forces debug logging + MCP server logs. |
| `GENIE_VIDEO` | `off` | Record video: `on` / `off` / `retain-on-failure` / `on-first-retry`. Non-`off` needs `npx playwright install ffmpeg`. |
| `GENIE_TRACE` | `retain-on-failure` | Trace capture: `on` / `off` / `retain-on-failure` / `on-first-retry`. Traces open from the HTML report. |

**B) The app-under-test** — `config/targets.json`, selected/overridden by:

| Env var | Default | What it controls |
|---------|---------|------------------|
| `GENIE_ENV` | file's `defaultEnv` | Which environment in `config/targets.json` to target. |
| `GENIE_TARGETS_FILE` | `config/targets.json` | Path to the targets file (override for a custom location). |
| `<usernameEnv>` / `<passwordEnv>` | *(per env)* | Credentials, referenced **by name** from the env's `auth` block (e.g. `STAGING_USERNAME`, `STAGING_PASSWORD`). |

Full annotated lists: see `.env.example` and `config/targets.json`.

---

## 13. Token cost — how Genie keeps it low

AI calls cost money. Genie minimizes that on **four** fronts:

1. **Heal locally first** — most broken selectors are fixed with zero AI calls (`local-strategies.ts`).
2. **Distill the DOM** — when AI *is* needed for healing, it gets a tiny element list, not raw HTML (~90% fewer tokens).
3. **Cache heals** — a selector is healed once, then reused for free (`healed-locators.json`).
4. **Cap output & pick cheap models per task** — healing can use a cheaper model than generation.

You can *see* the savings: the **Token Usage** table in every report breaks cost down per capability.

---

## 14. FAQ / troubleshooting

**"GEMINI_API_KEY is not set"**
You didn't create `.env` or didn't paste your key. Run `cp .env.example .env` and add your key.

**How do I point Genie at my own app?**
Edit `config/targets.json`: set an environment's `baseURL` (and its `auth` block if login is required), put credentials in `.env`, then run with `GENIE_ENV=<name>`. See [§5](#5-environments-urls--credentials).

**My app needs a login. How do tests authenticate?**
Fill in the environment's `auth` block and put credentials in `.env`. `tests/global-setup.ts` logs in once and saves the session; every test starts authenticated. For SSO/OAuth/MFA, extend the auth handling (see CONTRIBUTING.md).

**"Instruction file … not found"**
You passed `--file` with a name that isn't in `test-instructions/` (or a path that doesn't exist). The error lists what *is* available — check the spelling, or pass an explicit path.

**A generated test doesn't compile.**
Genie warns you (`⚠ Generated but does NOT typecheck`), lists the files, and shows the errors. It also auto-tries to repair once (raise `GENIE_MAX_REPAIR_ATTEMPTS`). Open the file(s) and fix the remaining issue, or re-run generation.

**Unit tests pass but `validateSpec` fails on a file in `/tmp`.**
Generated files must live **inside the project tree** so TypeScript can resolve `@playwright/test`. Generate into `tests/` and `src/pom/pages/` (the defaults), not a system temp dir.

**The agent gives up ("GOAL_FAILED" or hits max steps").**
Increase `GENIE_AGENT_MAX_STEPS`, make the goal more specific, or run `--headed` to watch what it's doing.

**Rate-limited (429).**
Genie already retries with backoff. If it persists, you're hitting Gemini's free-tier limits — wait, or lower how often you run.

**`fetch failed` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` when calling Gemini (corporate proxy).**
Behind a TLS-inspecting proxy (e.g. Zscaler), Node rejects the proxy's certificate because it ships its **own** CA store and ignores the macOS keychain — so every Gemini call (`generate`, `achieve`, healing, reporting) fails with `fetch failed` even though `curl` works. Export the system trust store to a PEM bundle and point Node at it via `NODE_EXTRA_CA_CERTS`:

```bash
# 1. Export the macOS trust store (system roots + admin-added proxy CA) to a bundle
security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain > ~/.genie-ca-bundle.pem
security find-certificate -a -p /Library/Keychains/System.keychain >> ~/.genie-ca-bundle.pem

# 2. Tell Node to trust it. NODE_EXTRA_CA_CERTS must be a real shell env var —
#    it's read at Node startup, so putting it in .env (dotenv) does NOT work.
export NODE_EXTRA_CA_CERTS="$HOME/.genie-ca-bundle.pem"

# 3. Make it permanent for future shells (zsh)
echo 'export NODE_EXTRA_CA_CERTS="$HOME/.genie-ca-bundle.pem"' >> ~/.zshrc
```

Keep the bundle **outside the repo** (e.g. your home dir) — it's machine-specific and should not be committed.

**Where do I add a new feature?**
See [CONTRIBUTING.md](./CONTRIBUTING.md) — adding a capability, a page object, or an environment are each small, recipe-sized tasks.

---

*Built with Playwright + Google Gemini. Happy testing! 🧞*
