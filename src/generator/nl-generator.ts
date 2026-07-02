import * as fs from 'fs';
import * as path from 'path';
import type { ILLMProvider } from '../ai/provider';
import { getDefaultProvider } from '../ai/factory';
import { loadConfig } from '../core/config';
import { generateTestPrompt, repairTestPrompt, renderFilesForPrompt } from '../ai/prompts';
import { createLogger } from '../core/logger';
import { buildPomInventory } from '../pom/introspect';
import { validateSpec } from './validate';

const log = createLogger('Generator');

interface GenFile {
  /** Project-relative path. */
  path: string;
  content: string;
}

/** Strip markdown code fences if the model wraps a block. */
function stripFences(raw: string): string {
  return raw
    .replace(/^```(?:typescript|ts)?\s*\n/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();
}

/**
 * Parse the model's multi-file response.
 *
 * Modern (POM-aware) responses are a series of `=== FILE: <path> ===` blocks.
 * If no markers are present we treat the whole response as the spec written to
 * `defaultSpecPath` — keeps single-file callers and fixtures working.
 */
function parseFiles(raw: string, defaultSpecPath: string): GenFile[] {
  const cleaned = raw.trim();
  const marker = /^===\s*FILE:\s*(.+?)\s*===\s*$/gm;
  const matches = [...cleaned.matchAll(marker)];

  if (matches.length === 0) {
    return [{ path: defaultSpecPath, content: stripFences(cleaned) }];
  }

  const files: GenFile[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : cleaned.length;
    files.push({
      path: matches[i][1].trim(),
      content: stripFences(cleaned.slice(start, end).trim()),
    });
  }
  return files;
}

/**
 * Sandbox + normalize the model's file list:
 *  - The spec is forced to the caller's outputPath (the model can't relocate it).
 *  - Page objects are only allowed under src/pom/pages/.
 *  - The barrel (src/pom/index.ts) is dropped — we wire it ourselves.
 *  - Anything outside the allowlist is rejected with a warning (write safety).
 */
function normalizeFiles(files: GenFile[], outputPath: string): GenFile[] {
  const cwd = process.cwd();
  const specAbs = path.resolve(outputPath);
  const pagesDir = path.resolve(cwd, 'src', 'pom', 'pages');
  const barrelAbs = path.resolve(cwd, 'src', 'pom', 'index.ts');

  const out: GenFile[] = [];
  for (const f of files) {
    const abs = path.resolve(cwd, f.path);

    if (f.path.endsWith('.spec.ts')) {
      out.push({ path: outputPath, content: f.content }); // force spec location
      continue;
    }
    if (abs === barrelAbs) {
      log.debug('Ignoring model-emitted src/pom/index.ts — barrel is auto-wired.');
      continue;
    }
    if (abs.startsWith(pagesDir + path.sep) && f.path.endsWith('.page.ts')) {
      out.push({ path: path.relative(cwd, abs), content: f.content });
      continue;
    }
    log.warn(`Refusing to write outside the allowed tree: "${f.path}" (skipped).`);
  }

  // De-dupe by path (last block wins) and guarantee the spec ends up at outputPath.
  const byPath = new Map<string, GenFile>();
  for (const f of out) byPath.set(path.resolve(f.path), f);
  if (![...byPath.values()].some((f) => path.resolve(f.path) === specAbs)) {
    log.warn(`Model produced no spec at ${outputPath}; the run may be incomplete.`);
  }
  return [...byPath.values()];
}

/** Ensure every generated page object is re-exported from the POM barrel. */
function wireBarrel(files: GenFile[]): void {
  const pageFiles = files.filter((f) => f.path.replace(/\\/g, '/').includes('src/pom/pages/'));
  if (pageFiles.length === 0) return;

  const barrelPath = path.join(process.cwd(), 'src', 'pom', 'index.ts');
  let barrel = fs.existsSync(barrelPath) ? fs.readFileSync(barrelPath, 'utf8') : '';
  const additions: string[] = [];

  for (const f of pageFiles) {
    const base = path.basename(f.path, '.ts'); // e.g. search.page
    const moduleSpec = `./pages/${base}`;
    for (const m of f.content.matchAll(/export class (\w+)/g)) {
      const line = `export { ${m[1]} } from '${moduleSpec}';`;
      if (!barrel.includes(`from '${moduleSpec}'`) || !barrel.includes(`{ ${m[1]} }`)) {
        if (!barrel.includes(line)) additions.push(line);
      }
    }
  }

  if (additions.length) {
    barrel = barrel.replace(/\s*$/, '\n') + additions.join('\n') + '\n';
    fs.writeFileSync(barrelPath, barrel, 'utf8');
    log.info(`Wired ${additions.length} export(s) into src/pom/index.ts`);
  }
}

/** Write every file to disk (creating directories as needed). */
function writeAll(files: GenFile[]): void {
  for (const f of files) {
    const dir = path.dirname(f.path);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f.path, f.content.endsWith('\n') ? f.content : f.content + '\n', 'utf8');
  }
}

/** Typecheck every generated file; aggregate diagnostics per file. */
function validateAll(files: GenFile[]): { ok: boolean; errors: string } {
  const problems: string[] = [];
  for (const f of files) {
    const result = validateSpec(f.path);
    if (!result.ok) problems.push(`# ${f.path}\n${result.errors}`);
  }
  return { ok: problems.length === 0, errors: problems.join('\n') };
}

/**
 * Generate Playwright test(s) — and any required Page Objects — from a
 * plain-English intent, following the framework's POM + config conventions.
 *
 * The model emits a spec under `tests/` plus optional page objects under
 * `src/pom/pages/`. The barrel is auto-wired and every file is typecheck-gated,
 * with bounded LLM repair on failure. Files are always written so an engineer
 * can inspect them; the log states clearly whether the set compiles.
 *
 * @param intent      Plain English description of the test (steps + validation).
 * @param outputPath  Where the .spec.ts file is written.
 * @param provider    LLM backend (defaults to the configured provider).
 */
export async function generateTest(
  intent: string,
  outputPath: string,
  provider: ILLMProvider = getDefaultProvider(),
): Promise<void> {
  const config = loadConfig();
  const pom = buildPomInventory();

  log.info(`Generating test for: "${intent}"`);

  let files = normalizeFiles(
    parseFiles(
      await provider.generate(generateTestPrompt(intent, outputPath, pom.context), {
        model: config.llm.generationModel,
        label: 'generate',
      }),
      outputPath,
    ),
    outputPath,
  );

  writeAll(files);
  wireBarrel(files);

  let result = validateAll(files);
  let attempt = 0;
  while (!result.ok && attempt < config.generation.maxRepairAttempts) {
    attempt++;
    log.warn(`Generated files failed typecheck — repair attempt ${attempt}/${config.generation.maxRepairAttempts}…`);
    files = normalizeFiles(
      parseFiles(
        await provider.generate(
          repairTestPrompt(intent, renderFilesForPrompt(files), result.errors, outputPath),
          { model: config.llm.generationModel, label: 'generate-repair' },
        ),
        outputPath,
      ),
      outputPath,
    );
    writeAll(files);
    wireBarrel(files);
    result = validateAll(files);
  }

  const fileList = files.map((f) => `  • ${f.path}`).join('\n');
  if (result.ok) {
    log.info(`✓ Generated and typechecks cleanly:\n${fileList}`);
  } else {
    log.warn(
      `⚠ Generated but does NOT typecheck — review and fix manually:\n${fileList}\n\n${result.errors}`,
    );
  }
}
