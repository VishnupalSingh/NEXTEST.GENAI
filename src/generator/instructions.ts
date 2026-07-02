import * as fs from 'fs';
import * as path from 'path';

/**
 * Plain-English instruction files.
 *
 * Multi-line flows are awkward to pass on the command line, so `generate` and
 * `achieve` also accept `--file <name>`:
 *   - A path (absolute, or containing a separator, or starting with '.') is read
 *     directly from the filesystem.
 *   - A bare name (e.g. "login-flow" or "login-flow.txt") is looked up in the
 *     default folder below.
 * Every failure throws a clear, actionable Error — the CLI logs it and exits
 * without a stack trace.
 */

/** Default folder searched when only a bare file name is given. */
export const INSTRUCTIONS_DIR = path.join(process.cwd(), 'test-instructions');

const TEXT_EXTS = ['.txt', '.md'];

function isFile(p: string): boolean {
  return fs.existsSync(p) && fs.statSync(p).isFile();
}

function hasKnownExt(name: string): boolean {
  return TEXT_EXTS.includes(path.extname(name).toLowerCase());
}

/** List the instruction files available in the default folder (for error hints). */
export function listInstructionFiles(dir: string = INSTRUCTIONS_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => TEXT_EXTS.includes(path.extname(f).toLowerCase()))
    .sort();
}

/**
 * Resolve a `--file` argument to an absolute path, or throw a clear error.
 * `dir` is overridable for testing.
 */
export function resolveInstructionPath(arg: string, dir: string = INSTRUCTIONS_DIR): string {
  const name = arg.trim();
  if (!name) throw new Error('No instruction file name provided.');

  const looksLikePath =
    path.isAbsolute(name) || name.includes('/') || name.includes('\\') || name.startsWith('.');

  // Explicit path: use exactly what was given.
  if (looksLikePath) {
    const resolved = path.resolve(process.cwd(), name);
    if (!isFile(resolved)) {
      throw new Error(`Instruction file not found: ${resolved}`);
    }
    return resolved;
  }

  // Bare name: search the default folder (exact, then with known extensions).
  const candidates = [name, ...(hasKnownExt(name) ? [] : TEXT_EXTS.map((e) => name + e))];
  for (const candidate of candidates) {
    const p = path.join(dir, candidate);
    if (isFile(p)) return p;
  }

  const available = listInstructionFiles(dir);
  const rel = path.relative(process.cwd(), dir) || dir;
  throw new Error(
    `Instruction file "${arg}" not found in ${rel}/. ` +
      (available.length
        ? `Available: ${available.join(', ')}.`
        : `The folder has no .txt/.md files yet — add one, or pass an explicit path.`),
  );
}

/** Read and return the trimmed instruction text (and its resolved path). */
export function readInstructionText(
  arg: string,
  dir: string = INSTRUCTIONS_DIR,
): { text: string; path: string } {
  const resolved = resolveInstructionPath(arg, dir);
  const text = fs.readFileSync(resolved, 'utf8').trim();
  if (!text) throw new Error(`Instruction file is empty: ${resolved}`);
  return { text, path: resolved };
}
