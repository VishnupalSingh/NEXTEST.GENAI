import { BaseTask } from '../core/task';
import { GenieAgent } from '../agent/ui-agent';

export interface AgentInput {
  goal: string;
  headless?: boolean;
}

/** Capability: autonomously achieve a plain-English goal in a real browser. */
export class AgentTask extends BaseTask<AgentInput, void> {
  static readonly taskName = 'achieve';
  static readonly taskDescription = 'Autonomously achieve a goal in a real browser via Playwright MCP';

  readonly name = AgentTask.taskName;
  readonly description = AgentTask.taskDescription;

  async run({ goal, headless = true }: AgentInput): Promise<void> {
    const agent = new GenieAgent(undefined, this.ctx.provider, this.ctx.config);
    await agent.achieve(goal, headless);
  }
}
