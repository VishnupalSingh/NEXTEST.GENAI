import { BaseTask } from '../core/task';
import { generateTest } from '../generator/nl-generator';

export interface GenerateInput {
  intent: string;
  outputPath: string;
}

/** Capability: turn a natural-language intent into a Playwright spec file. */
export class GenerateTask extends BaseTask<GenerateInput, void> {
  static readonly taskName = 'generate';
  static readonly taskDescription = 'Generate a Playwright spec from a natural-language intent';

  readonly name = GenerateTask.taskName;
  readonly description = GenerateTask.taskDescription;

  async run({ intent, outputPath }: GenerateInput): Promise<void> {
    await generateTest(intent, outputPath, this.ctx.provider);
  }
}
