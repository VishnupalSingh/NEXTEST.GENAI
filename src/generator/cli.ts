import * as path from 'path';
import { registerBuiltinTasks } from '../capabilities';
import { createTask, listTasks } from '../core/registry';
import type { GenerateInput } from '../capabilities/generate-task';
import type { AgentInput } from '../capabilities/agent-task';
import { readInstructionText } from './instructions';

registerBuiltinTasks();

function printUsage(): void {
  const tasks = listTasks()
    .map((t) => `  ${t.name.padEnd(10)} ${t.description}`)
    .join('\n');

  console.log(`
NexTest Genie CLI — Agentic UI Automation Framework

Usage:
  npm run genie -- <command> "<text>" [options]
  npm run generate -- "<intent>" [outputPath]      # shortcut for: genie -- generate
  npm run achieve  -- "<goal>" [--headed]           # shortcut for: genie -- achieve

Provide the instruction inline (as "<text>") OR from a file with --file/-f:
  --file, -f <name|path>   Read the instruction from a file. A bare name is
                           looked up in test-instructions/; a path is read as-is.
                           Ideal for multi-line flows with several steps.

Commands:
${tasks}

Examples:
  npm run generate -- "login and verify the dashboard loads"
  npm run generate -- --file login-flow.txt tests/login.spec.ts
  npm run achieve  -- "open playwright.dev and find the changelog page"
  npm run achieve  -- -f ./flows/checkout.txt --headed

Note: 'generate' follows the framework conventions automatically — it writes a
spec under tests/ that drives the app through Page Objects (src/pom/pages/),
creating or extending page objects as needed, and never hardcodes URLs.
`);
}

interface ParsedArgs {
  positionals: string[];
  headed: boolean;
  /** Value of --file / -f, if provided. */
  file?: string;
}

/** Split raw args into positionals, flags, and the --file value. */
function parseArgs(rest: string[]): ParsedArgs {
  const positionals: string[] = [];
  let headed = false;
  let file: string | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--file' || arg === '-f') {
      file = rest[++i];
      if (!file || file.startsWith('-')) {
        throw new Error('--file requires a filename or path (e.g. --file login-flow.txt).');
      }
    } else if (arg === '--headed') {
      headed = true;
    } else if (!arg.startsWith('-')) {
      positionals.push(arg);
    }
    // Unknown flags are ignored for forward-compatibility.
  }

  return { positionals, headed, file };
}

/**
 * Map raw CLI args to the input object the named task expects.
 * The instruction text comes from --file when given, else the first positional.
 */
function buildInput(command: string, rest: string[]): unknown {
  const { positionals, headed, file } = parseArgs(rest);

  let text: string | undefined;
  if (file) {
    const loaded = readInstructionText(file);
    text = loaded.text;
    console.log(`[Genie CLI] Using instructions from: ${path.relative(process.cwd(), loaded.path)}`);
  } else {
    text = positionals[0];
  }

  if (!text) {
    throw new Error(
      'No instruction text provided. Pass it inline (as "<text>") or use --file <name> ' +
        '(a bare name is searched in test-instructions/).',
    );
  }

  switch (command) {
    case 'generate': {
      // With --file, the (only) positional is the output path; inline it's the second.
      const outputPath =
        (file ? positionals[0] : positionals[1]) ??
        path.join('tests', `generated-${Date.now()}.spec.ts`);
      return { intent: text, outputPath } satisfies GenerateInput;
    }
    case 'achieve': {
      return { goal: text, headless: !headed } satisfies AgentInput;
    }
    default:
      return {};
  }
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const known = listTasks().map((t) => t.name);

  if (!command || !known.includes(command) || rest.length === 0) {
    printUsage();
    process.exit(1);
  }

  try {
    // Build input first so file-resolution errors surface before provider setup
    // (which needs an API key) — a missing instruction file shouldn't require one.
    const input = buildInput(command, rest);
    const task = createTask(command);
    await task.run(input);
  } catch (error) {
    console.error(
      '\n[Genie CLI] Error:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

main();
