/**
 * Provider-agnostic interface for LLM backends.
 * Swap Gemini for Groq, OpenAI, or any other provider by implementing
 * ILLMProvider and registering it in `factory.ts`.
 */

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Per-call overrides. Anything omitted falls back to the provider's config. */
export interface GenerateOptions {
  /** Override the model for this call (e.g. a cheaper model for healing). */
  model?: string;
  /** Cap output tokens for this call. */
  maxOutputTokens?: number;
  /** Override sampling temperature for this call. */
  temperature?: number;
  /** Tag for token-usage telemetry, e.g. "heal" / "generate" / "agent" / "report". */
  label?: string;
}

export interface ILLMProvider {
  /** Generate a plain text response from a prompt. */
  generate(prompt: string, options?: GenerateOptions): Promise<string>;

  /**
   * Run an agentic loop: the model selects tools via function calling,
   * your toolExecutor runs them, until the model returns a text response.
   */
  runAgentLoop(
    systemPrompt: string,
    userGoal: string,
    functions: FunctionDeclaration[],
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    options?: GenerateOptions & { maxSteps?: number },
  ): Promise<string>;
}
