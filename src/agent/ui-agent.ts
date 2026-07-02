import { PlaywrightMCPClient } from './mcp-client';
import type { FunctionDeclaration, ILLMProvider } from '../ai/provider';
import { getDefaultProvider } from '../ai/factory';
import { agentSystemPrompt } from '../ai/prompts';
import { loadConfig, type GenieConfig } from '../core/config';
import { loadTarget } from '../core/target-config';
import { createLogger } from '../core/logger';

const log = createLogger('GenieAgent');

/** True if the goal already names an explicit http(s) URL to start from. */
export function goalHasUrl(goal: string): boolean {
  return /\bhttps?:\/\/\S+/i.test(goal);
}

/**
 * Resolve the goal the agent should actually pursue: if the user already named
 * a URL we respect it; otherwise we prepend a navigation step to the configured
 * baseURL so the agent has a defined starting point.
 */
export function withStartUrl(goal: string, baseURL: string): string {
  if (goalHasUrl(goal)) return goal;
  return `First, navigate to ${baseURL}. Then: ${goal}`;
}

/**
 * GenieAgent — Autonomous UI testing agent.
 *
 * Uses Playwright MCP as the browser tool executor and Gemini AI (function calling)
 * as the decision engine. Given a plain-English goal, the agent:
 *   1. Starts the Playwright MCP server (headless browser)
 *   2. Fetches available browser tools (click, type, navigate, snapshot…)
 *   3. Passes them to Gemini as function declarations
 *   4. Loops: Gemini picks a tool → MCP executes it → repeat until goal met
 */
export class GenieAgent {
  private readonly ai: ILLMProvider;
  private readonly config: GenieConfig;
  private readonly maxSteps: number;

  /**
   * @param maxSteps  Max tool-call iterations (defaults to config value).
   * @param provider  LLM backend (defaults to the configured provider; inject a fake in tests).
   * @param config    Resolved framework config.
   */
  constructor(
    maxSteps?: number,
    provider: ILLMProvider = getDefaultProvider(),
    config: GenieConfig = loadConfig(),
  ) {
    this.ai = provider;
    this.config = config;
    this.maxSteps = maxSteps ?? config.agent.maxSteps;
  }

  /**
   * Autonomously achieve a natural-language goal in a real browser.
   *
   * @param goal     Plain English description of what to accomplish.
   * @param headless Run the browser headlessly (default: true).
   */
  async achieve(goal: string, headless = true): Promise<void> {
    // Use a URL the user named; otherwise fall back to the configured baseURL.
    let effectiveGoal = goal;
    if (!goalHasUrl(goal)) {
      const target = loadTarget();
      effectiveGoal = withStartUrl(goal, target.baseURL);
      log.info(`No URL in goal — starting from configured baseURL for "${target.name}": ${target.baseURL}`);
    }

    const mcp = new PlaywrightMCPClient({
      requestTimeoutMs: this.config.agent.requestTimeoutMs,
      startupGraceMs: this.config.agent.startupGraceMs,
    });

    log.info(`Goal: "${effectiveGoal}"`);
    log.info('Starting Playwright MCP server…');

    await mcp.connect(headless);

    try {
      const mcpTools = await mcp.listTools();
      log.debug(`Tools available: ${mcpTools.map((t) => t.name).join(', ')}`);

      const functionDeclarations: FunctionDeclaration[] = mcpTools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? tool.name,
        parameters: {
          type: tool.inputSchema.type || 'object',
          properties: tool.inputSchema.properties ?? {},
          required: tool.inputSchema.required ?? [],
        },
      }));

      const systemPrompt = agentSystemPrompt();

      const finalResponse = await this.ai.runAgentLoop(
        systemPrompt,
        effectiveGoal,
        functionDeclarations,
        async (name, args) => {
          log.debug(`${name}(${JSON.stringify(args)})`);
          return mcp.callTool(name, args);
        },
        { maxSteps: this.maxSteps, model: this.config.llm.agentModel },
      );

      if (finalResponse.startsWith('GOAL_ACHIEVED')) {
        log.info(`✓ ${finalResponse}`);
      } else if (finalResponse.startsWith('GOAL_FAILED')) {
        throw new Error(`[GenieAgent] Agent could not complete goal: ${finalResponse}`);
      } else {
        log.info(`Finished: ${finalResponse}`);
      }
    } finally {
      await mcp.close();
    }
  }
}
