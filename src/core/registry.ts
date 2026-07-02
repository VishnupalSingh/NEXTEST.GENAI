import { BaseTask, createContext, type TaskContext } from './task';

/** A factory that builds a task instance from a context. */
export type TaskFactory = (ctx: TaskContext) => BaseTask;

interface RegistryEntry {
  description: string;
  factory: TaskFactory;
}

const registry = new Map<string, RegistryEntry>();

/**
 * Register a capability under a unique name. Called once per task from
 * `src/capabilities/index.ts`. The single list the CLI and any tooling read.
 */
export function registerTask(name: string, description: string, factory: TaskFactory): void {
  if (registry.has(name)) {
    throw new Error(`Task "${name}" is already registered`);
  }
  registry.set(name, { description, factory });
}

/** Build a registered task instance, or throw if the name is unknown. */
export function createTask(name: string, ctx: TaskContext = createContext()): BaseTask {
  const entry = registry.get(name);
  if (!entry) {
    throw new Error(`Unknown task "${name}". Known tasks: ${listTasks().map((t) => t.name).join(', ') || '(none)'}`);
  }
  return entry.factory(ctx);
}

/** List all registered tasks (for CLI help). */
export function listTasks(): Array<{ name: string; description: string }> {
  return [...registry.entries()].map(([name, e]) => ({ name, description: e.description }));
}
