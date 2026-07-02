import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Funnel through dotenv here too, so the loader works whether it is imported by
// playwright.config.ts (test run) or a standalone script.
dotenv.config();

/**
 * TargetConfig — the Application(s) Under Test.
 *
 * Where `GenieConfig` (src/core/config.ts) owns *how the framework behaves*
 * (models, timeouts, budgets), this owns *what we point the browser at*: the
 * environments, their base URLs, and how to authenticate.
 *
 * Non-secret structure lives in config/targets.json (committed). Secrets
 * (usernames/passwords/tokens) are NEVER in that file — the JSON names the
 * environment variable that holds each secret, and we resolve it here at
 * runtime from .env / CI secrets.
 */

export type AuthType = 'form';

export interface AuthShape {
  required: boolean;
  type?: AuthType;
  /** Path (relative to baseURL) of the login page. */
  loginPath?: string;
  /** Name of the env var holding the username. */
  usernameEnv?: string;
  /** Name of the env var holding the password. */
  passwordEnv?: string;
  /** Selectors for the login form. */
  selectors?: {
    username: string;
    password: string;
    submit: string;
  };
  /** Path we expect to land on after a successful login (used to confirm auth). */
  successUrl?: string;
}

/** A single environment block as it appears in targets.json (secret-free). */
export interface TargetEnvironment {
  baseURL: string;
  description?: string;
  auth: AuthShape;
}

/** The raw shape of config/targets.json. */
interface TargetsFile {
  defaultEnv: string;
  environments: Record<string, TargetEnvironment>;
}

/** Credentials resolved from environment variables (kept out of the JSON). */
export interface ResolvedCredentials {
  username: string;
  password: string;
}

/** The fully-resolved target the framework should drive this run. */
export interface ResolvedTarget {
  /** Active environment name, e.g. "staging". */
  name: string;
  baseURL: string;
  description?: string;
  auth: AuthShape;
  /**
   * Credentials, present only when auth.required is true. Resolved from the
   * env vars named in auth.usernameEnv / auth.passwordEnv.
   */
  credentials?: ResolvedCredentials;
  /** Absolute path to the storageState file Playwright should reuse for this env. */
  storageStatePath: string;
}

const DEFAULT_TARGETS_PATH = path.join(process.cwd(), 'config', 'targets.json');

function readTargetsFile(filePath: string): TargetsFile {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Targets config not found at ${filePath}. Copy config/targets.json and set GENIE_ENV, ` +
        `or point GENIE_TARGETS_FILE at your file.`,
    );
  }
  let parsed: TargetsFile;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as TargetsFile;
  } catch (err) {
    throw new Error(`Failed to parse targets config ${filePath}: ${(err as Error).message}`);
  }
  if (!parsed.environments || typeof parsed.environments !== 'object') {
    throw new Error(`Targets config ${filePath} is missing an "environments" object.`);
  }
  return parsed;
}

/**
 * Resolve the active target.
 *
 * Environment is selected by (in order): the `env` argument, GENIE_ENV,
 * then the file's `defaultEnv`.
 *
 * Throws if the chosen environment is unknown, or if auth is required but the
 * referenced credential env vars are unset — failing loud at startup beats a
 * confusing mid-test redirect to a login page.
 */
export function loadTarget(env?: string): ResolvedTarget {
  const filePath = process.env.GENIE_TARGETS_FILE ?? DEFAULT_TARGETS_PATH;
  const file = readTargetsFile(filePath);

  const name = env ?? process.env.GENIE_ENV ?? file.defaultEnv;
  if (!name) {
    throw new Error(`No environment selected. Set GENIE_ENV or "defaultEnv" in ${filePath}.`);
  }

  const envBlock = file.environments[name];
  if (!envBlock) {
    const available = Object.keys(file.environments).join(', ');
    throw new Error(`Unknown environment "${name}". Available: ${available}.`);
  }
  if (!envBlock.baseURL) {
    throw new Error(`Environment "${name}" in ${filePath} is missing "baseURL".`);
  }

  const reportsDir = process.env.GENIE_REPORTS_DIR ?? path.join(process.cwd(), 'reports');
  const storageStatePath = path.join(reportsDir, '.auth', `${name}.json`);

  const target: ResolvedTarget = {
    name,
    baseURL: envBlock.baseURL,
    description: envBlock.description,
    auth: envBlock.auth ?? { required: false },
    storageStatePath,
  };

  if (target.auth.required) {
    target.credentials = resolveCredentials(name, target.auth);
  }

  return target;
}

/** Pull credentials from the env vars named in the auth block; throw if missing. */
function resolveCredentials(envName: string, auth: AuthShape): ResolvedCredentials {
  const { usernameEnv, passwordEnv } = auth;
  if (!usernameEnv || !passwordEnv) {
    throw new Error(
      `Environment "${envName}" requires auth but does not declare usernameEnv/passwordEnv in targets.json.`,
    );
  }
  const username = process.env[usernameEnv];
  const password = process.env[passwordEnv];
  const missing = [
    !username ? usernameEnv : null,
    !password ? passwordEnv : null,
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Environment "${envName}" requires auth but these env vars are unset: ${missing.join(', ')}. ` +
        `Set them in .env (locally) or as CI secrets.`,
    );
  }
  return { username: username!, password: password! };
}
