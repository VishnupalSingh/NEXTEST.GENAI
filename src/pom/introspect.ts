import * as fs from 'fs';
import * as path from 'path';

/**
 * POM introspection — gives the test generator a faithful picture of the Page
 * Objects that already exist, so it REUSES them (and the framework conventions)
 * instead of inventing parallel selectors. The source is fed verbatim because
 * it is the ground truth of each page's class name, path, and public methods.
 */

const PAGES_DIR = path.join(process.cwd(), 'src', 'pom', 'pages');

export interface PomInventory {
  /** Verbatim source of existing page objects, for embedding in the prompt. */
  context: string;
  /** Exported page-object class names currently available from the barrel. */
  classNames: string[];
}

/** Read every existing page object so the LLM can reuse or extend them. */
export function buildPomInventory(maxChars = 6000): PomInventory {
  if (!fs.existsSync(PAGES_DIR)) {
    return { context: '(no page objects exist yet — create the first one)', classNames: [] };
  }

  const files = fs
    .readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith('.page.ts'))
    .sort();

  const classNames: string[] = [];
  const blocks: string[] = [];
  let used = 0;

  for (const file of files) {
    const src = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
    for (const m of src.matchAll(/export class (\w+)/g)) classNames.push(m[1]);

    const rel = path.posix.join('src', 'pom', 'pages', file);
    const block = `--- ${rel} ---\n${src}`;
    // Bound prompt size: once over budget, list the class instead of its body.
    if (used + block.length > maxChars) {
      blocks.push(`--- ${rel} ---\n(source omitted for length)`);
      continue;
    }
    used += block.length;
    blocks.push(block);
  }

  return {
    context: blocks.length ? blocks.join('\n\n') : '(no page objects exist yet — create the first one)',
    classNames,
  };
}
