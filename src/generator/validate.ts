import * as path from 'path';
import * as ts from 'typescript';

export interface ValidationResult {
  ok: boolean;
  /** Formatted compiler diagnostics for the validated file (empty when ok). */
  errors: string;
}

/**
 * Typecheck a single generated .spec.ts using the project's tsconfig options.
 *
 * Generating code with an LLM and writing it straight to disk means a junior
 * can get a broken spec with no signal why. This gate compiles the file (the
 * compiler follows its imports, so @playwright/test types resolve) and returns
 * any diagnostics belonging to that file.
 */
export function validateSpec(filePath: string): ValidationResult {
  const absolute = path.resolve(filePath);

  const options = loadCompilerOptions();
  const program = ts.createProgram([absolute], options);
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file && path.resolve(d.file.fileName) === absolute);

  if (diagnostics.length === 0) {
    return { ok: true, errors: '' };
  }

  const errors = ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  });
  return { ok: false, errors };
}

/** Read tsconfig.json from cwd; fall back to sensible defaults if absent. */
function loadCompilerOptions(): ts.CompilerOptions {
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    return { strict: true, noEmit: true, skipLibCheck: true };
  }
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configPath));
  return { ...parsed.options, noEmit: true };
}
