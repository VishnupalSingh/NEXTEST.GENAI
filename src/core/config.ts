import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env exactly once, from the single place every module funnels through.
dotenv.config();

/**
 * GenieConfig — the single source of truth for every tunable value in the
 * framework. Models, token budgets, timeouts, and paths live here so they can
 * be changed without hunting through business logic.
 *
 * Override any value with an environment variable (see `loadConfig`).
 */
export interface GenieConfig {
  llm: {
    /** Which provider implementation the factory should build. */
    provider: 'gemini';
    /** API key for the selected provider. May be empty in unit tests that inject a fake provider. */
    apiKey: string;
    /** Default model used when a call site does not specify one. */
    model: string;
    /** Model for natural-language test generation (favour quality). */
    generationModel: string;
    /** Model for self-healing locators (favour cost — runs often). */
    healingModel: string;
    /** Model that drives the autonomous agent loop (needs function calling). */
    agentModel: string;
    /** Model for the end-of-run report summary. */
    reportModel: string;
    /** Hard cap on output tokens per call (cost control). */
    maxOutputTokens: number;
    /** Sampling temperature. Low = deterministic, better for code/selectors. */
    temperature: number;
    /** Retry attempts for transient (429/503/network) failures. */
    maxRetries: number;
    /** Base backoff delay in ms (grows exponentially). */
    retryBaseMs: number;
  };
  agent: {
    /** Max tool-call iterations before the agent loop bails out. */
    maxSteps: number;
    /** Per-request timeout for MCP JSON-RPC calls. */
    requestTimeoutMs: number;
    /** Grace period after spawning the MCP server before the handshake. */
    startupGraceMs: number;
  };
  healing: {
    /** Max characters of distilled DOM sent to the LLM. */
    domMaxChars: number;
    /** Where healed selectors are cached between runs. */
    cachePath: string;
  };
  generation: {
    /** How many times to ask the LLM to repair a spec that fails typecheck. */
    maxRepairAttempts: number;
  };
  paths: {
    /** Root folder for all generated reports/artifacts. */
    reportsDir: string;
    /** JSONL file where token usage is appended (shared across worker processes). */
    usageFile: string;
  };
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Build the resolved config from defaults + environment overrides.
 * Never throws on a missing API key — provider construction is where that is
 * enforced, so tests can run with an injected fake and no key.
 */
export function loadConfig(overrides: Partial<GenieConfig> = {}): GenieConfig {
  const reportsDir = process.env.GENIE_REPORTS_DIR ?? path.join(process.cwd(), 'reports');

  const base: GenieConfig = {
    llm: {
      provider: 'gemini',
      apiKey: process.env.GEMINI_API_KEY ?? '',
      model: process.env.GENIE_MODEL ?? 'gemini-2.5-flash',
      generationModel: process.env.GENIE_GENERATION_MODEL ?? process.env.GENIE_MODEL ?? 'gemini-2.5-flash',
      healingModel: process.env.GENIE_HEALING_MODEL ?? process.env.GENIE_MODEL ?? 'gemini-2.5-flash',
      agentModel: process.env.GENIE_AGENT_MODEL ?? process.env.GENIE_MODEL ?? 'gemini-2.5-flash',
      reportModel: process.env.GENIE_REPORT_MODEL ?? process.env.GENIE_MODEL ?? 'gemini-2.5-flash',
      maxOutputTokens: envInt('GENIE_MAX_OUTPUT_TOKENS', 2048),
      temperature: envFloat('GENIE_TEMPERATURE', 0.2),
      maxRetries: envInt('GENIE_MAX_RETRIES', 3),
      retryBaseMs: envInt('GENIE_RETRY_BASE_MS', 500),
    },
    agent: {
      maxSteps: envInt('GENIE_AGENT_MAX_STEPS', 20),
      requestTimeoutMs: envInt('GENIE_MCP_TIMEOUT_MS', 30_000),
      startupGraceMs: envInt('GENIE_MCP_STARTUP_MS', 600),
    },
    healing: {
      domMaxChars: envInt('GENIE_DOM_MAX_CHARS', 6000),
      cachePath: process.env.GENIE_HEAL_CACHE ?? path.join(reportsDir, 'healed-locators.json'),
    },
    generation: {
      maxRepairAttempts: envInt('GENIE_MAX_REPAIR_ATTEMPTS', 1),
    },
    paths: {
      reportsDir,
      usageFile: process.env.GENIE_USAGE_FILE ?? path.join(reportsDir, '.token-usage.jsonl'),
    },
  };

  // Shallow-merge per section so partial overrides (e.g. in tests) are ergonomic.
  return {
    llm: { ...base.llm, ...overrides.llm },
    agent: { ...base.agent, ...overrides.agent },
    healing: { ...base.healing, ...overrides.healing },
    generation: { ...base.generation, ...overrides.generation },
    paths: { ...base.paths, ...overrides.paths },
  };
}
