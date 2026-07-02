import type { ILLMProvider } from './provider';
import { GeminiClient } from './gemini-client';
import { loadConfig, type GenieConfig } from '../core/config';

/**
 * The ONE place that decides which concrete LLM backend to build.
 *
 * Every module depends on the ILLMProvider interface and receives an instance
 * (injected in tests, defaulted in production via `getDefaultProvider`). To add
 * a new backend, implement ILLMProvider and add a case below — nothing else in
 * the codebase needs to change.
 */
export function createProvider(config: GenieConfig = loadConfig()): ILLMProvider {
  switch (config.llm.provider) {
    case 'gemini':
      return new GeminiClient({
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        maxOutputTokens: config.llm.maxOutputTokens,
        temperature: config.llm.temperature,
        maxRetries: config.llm.maxRetries,
        retryBaseMs: config.llm.retryBaseMs,
      });
    default:
      throw new Error(`Unknown LLM provider: "${config.llm.provider}"`);
  }
}

let defaultProvider: ILLMProvider | null = null;

/**
 * Lazily-built, process-wide default provider. Production call sites use this
 * so they don't each construct (and re-handshake) their own client. Tests pass
 * an explicit provider instead and never touch this.
 */
export function getDefaultProvider(): ILLMProvider {
  if (!defaultProvider) {
    defaultProvider = createProvider();
  }
  return defaultProvider;
}

/** Reset the memoized default — used by tests to swap in a fake. */
export function setDefaultProvider(provider: ILLMProvider | null): void {
  defaultProvider = provider;
}
