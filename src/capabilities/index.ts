import { registerTask } from '../core/registry';
import { GenerateTask } from './generate-task';
import { AgentTask } from './agent-task';

/**
 * Register all built-in capabilities. Call once before dispatching.
 *
 * ── To add a new capability ──────────────────────────────────────────────────
 *   1. Create `src/capabilities/<your>-task.ts` extending BaseTask
 *   2. Add one `registerTask(...)` line below
 * It is then available from the CLI and the registry automatically.
 */
let registered = false;

export function registerBuiltinTasks(): void {
  if (registered) return;
  registered = true;

  registerTask(GenerateTask.taskName, GenerateTask.taskDescription, (ctx) => new GenerateTask(ctx));
  registerTask(AgentTask.taskName, AgentTask.taskDescription, (ctx) => new AgentTask(ctx));
}
