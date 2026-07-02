import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ILLMProvider, FunctionDeclaration, GenerateOptions } from './provider';
import { recordUsage } from '../core/usage';
import { retryAsync } from '../core/retry';
import { createLogger } from '../core/logger';

const log = createLogger('Gemini');

/** Construction options for the Gemini provider. Supplied by the factory. */
export interface GeminiClientOptions {
  apiKey: string;
  /** Default model when a call does not override it. */
  model: string;
  maxOutputTokens: number;
  temperature: number;
  maxRetries: number;
  retryBaseMs: number;
}

/**
 * GeminiClient — concrete ILLMProvider backed by Google Generative AI.
 *
 * No longer a singleton: build it through `createProvider()` in factory.ts.
 * That indirection is what lets every module depend on the ILLMProvider
 * interface (and lets tests inject a fake provider with no API key).
 */
export class GeminiClient implements ILLMProvider {
  private readonly genAI: GoogleGenerativeAI;
  private readonly defaults: Omit<GeminiClientOptions, 'apiKey'>;

  constructor(options: GeminiClientOptions) {
    if (!options.apiKey) {
      throw new Error(
        'GEMINI_API_KEY is not set.\n' +
        'Get your free key at: https://aistudio.google.com\n' +
        'Then copy .env.example to .env and paste your key.',
      );
    }
    this.genAI = new GoogleGenerativeAI(options.apiKey);
    this.defaults = {
      model: options.model,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      maxRetries: options.maxRetries,
      retryBaseMs: options.retryBaseMs,
    };
  }

  /** Run an LLM call with transient-failure retry/backoff. */
  private retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    return retryAsync(fn, {
      retries: this.defaults.maxRetries,
      baseMs: this.defaults.retryBaseMs,
      label: `Gemini ${label}`,
      logger: log,
    });
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: options.model ?? this.defaults.model,
      generationConfig: {
        maxOutputTokens: options.maxOutputTokens ?? this.defaults.maxOutputTokens,
        temperature: options.temperature ?? this.defaults.temperature,
      },
    });
    const label = options.label ?? 'generate';
    const result = await this.retry(label, () => model.generateContent(prompt));
    this.track(result.response, options.model ?? this.defaults.model, label);
    return result.response.text();
  }

  /** Record token usage from a Gemini response (no-op if metadata absent). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private track(response: any, model: string, label: string): void {
    const m = response?.usageMetadata;
    if (!m) return;
    recordUsage({
      label,
      model,
      promptTokens: m.promptTokenCount ?? 0,
      outputTokens: m.candidatesTokenCount ?? 0,
      totalTokens: m.totalTokenCount ?? 0,
    });
  }

  async runAgentLoop(
    systemPrompt: string,
    userGoal: string,
    functions: FunctionDeclaration[],
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    options: GenerateOptions & { maxSteps?: number } = {},
  ): Promise<string> {
    const maxSteps = options.maxSteps ?? 20;

    const functionDeclarations = functions.map((f) => ({
      name: f.name,
      description: f.description,
      parameters: f.parameters,
    }));

    const model = this.genAI.getGenerativeModel({
      model: options.model ?? this.defaults.model,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ functionDeclarations }] as any,
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: options.maxOutputTokens ?? this.defaults.maxOutputTokens,
        temperature: options.temperature ?? this.defaults.temperature,
      },
    });

    const agentModel = options.model ?? this.defaults.model;
    const label = options.label ?? 'agent';

    const chat = model.startChat();
    let result = await this.retry(label, () => chat.sendMessage(userGoal));
    this.track(result.response, agentModel, label);

    for (let step = 0; step < maxSteps; step++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parts: any[] = result.response.candidates?.[0]?.content?.parts ?? [];
      const fcPart = parts.find((p: Record<string, unknown>) => p.functionCall);

      if (!fcPart?.functionCall) {
        // Model returned a text response — loop complete
        return result.response.text();
      }

      const { name, args } = fcPart.functionCall as { name: string; args: Record<string, unknown> };
      log.debug(`Step ${step + 1}: → ${name}(${JSON.stringify(args)})`);

      const toolResult = await toolExecutor(name, args ?? {});

      // Send function response back so the model can continue
      result = await this.retry(label, () =>
        chat.sendMessage([
          {
            functionResponse: {
              name,
              response: { result: toolResult },
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ]),
      );
      this.track(result.response, agentModel, label);
    }

    return `Agent loop reached max steps (${maxSteps}). Final response: ${result.response.text()}`;
  }
}
