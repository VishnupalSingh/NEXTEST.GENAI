import type { ILLMProvider, GenerateOptions } from '../ai/provider';
import { getDefaultProvider } from '../ai/factory';
import { loadConfig, type GenieConfig } from './config';

/**
 * Everything a capability needs to do its job: the LLM backend and the resolved
 * config. Built once and passed in, so capabilities never reach for globals —
 * which is exactly what makes them unit-testable (inject a fake provider).
 */
export interface TaskContext {
  provider: ILLMProvider;
  config: GenieConfig;
}

/** Build a default context (production), overridable per-field for tests. */
export function createContext(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    provider: overrides.provider ?? getDefaultProvider(),
    config: overrides.config ?? loadConfig(),
  };
}

/**
 * BaseTask — the contract every AI capability implements.
 *
 * To add a capability a junior engineer:
 *   1. Subclass BaseTask, set `name`/`description`, implement `run()`
 *   2. Register it in `src/capabilities/index.ts`
 * …and it's instantly available via the CLI and the registry. The provider,
 * config, and token-tagged `generate()` helper are all provided for free.
 */
export abstract class BaseTask<TInput = unknown, TOutput = unknown> {
  /** CLI command name, e.g. "generate". Must be unique. */
  abstract readonly name: string;
  /** One-line description shown in CLI help. */
  abstract readonly description: string;

  constructor(protected readonly ctx: TaskContext) {}

  /** Do the work. */
  abstract run(input: TInput): Promise<TOutput>;

  /** Convenience wrapper that auto-tags token usage with this task's name. */
  protected generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    return this.ctx.provider.generate(prompt, { label: this.name, ...options });
  }
}
