import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveInstructionPath,
  readInstructionText,
  listInstructionFiles,
} from '../../src/generator/instructions';

// A throwaway "default folder" so tests never touch the real test-instructions/.
const DIR = path.join(os.tmpdir(), `genie-instr-${process.pid}`);

test.beforeAll(() => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'login-flow.txt'), 'step one\nstep two\n', 'utf-8');
  fs.writeFileSync(path.join(DIR, 'notes.md'), 'markdown flow', 'utf-8');
  fs.writeFileSync(path.join(DIR, 'blank.txt'), '   \n  ', 'utf-8');
});
test.afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

test.describe('instruction file resolution', () => {
  test('finds a bare name in the default folder, extension optional', () => {
    expect(resolveInstructionPath('login-flow', DIR)).toBe(path.join(DIR, 'login-flow.txt'));
    expect(resolveInstructionPath('login-flow.txt', DIR)).toBe(path.join(DIR, 'login-flow.txt'));
    expect(resolveInstructionPath('notes', DIR)).toBe(path.join(DIR, 'notes.md'));
  });

  test('reads and trims the instruction text', () => {
    const { text, path: p } = readInstructionText('login-flow', DIR);
    expect(text).toBe('step one\nstep two');
    expect(p).toBe(path.join(DIR, 'login-flow.txt'));
  });

  test('reads an explicit path directly from the filesystem', () => {
    const explicit = path.join(DIR, 'login-flow.txt');
    expect(resolveInstructionPath(explicit, DIR)).toBe(explicit);
  });

  test('errors clearly when a bare name is not found (lists available)', () => {
    expect(() => resolveInstructionPath('missing', DIR)).toThrow(/not found/i);
    expect(() => resolveInstructionPath('missing', DIR)).toThrow(/login-flow\.txt/);
  });

  test('errors when an explicit path does not exist', () => {
    expect(() => resolveInstructionPath('./nope/does-not-exist.txt', DIR)).toThrow(/not found/i);
  });

  test('errors on an empty file', () => {
    expect(() => readInstructionText('blank', DIR)).toThrow(/empty/i);
  });

  test('lists only .txt/.md files, sorted', () => {
    expect(listInstructionFiles(DIR)).toEqual(['blank.txt', 'login-flow.txt', 'notes.md']);
  });
});
