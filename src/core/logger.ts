/**
 * Minimal leveled logger.
 *
 * Replaces scattered `console.log` calls so output can be silenced in CI and
 * verbose diagnostics gated behind a level. Namespaced so every line says where
 * it came from. The threshold is read per-call, so tests can flip the level via
 * env without re-importing.
 *
 * Control with GENIE_LOG_LEVEL=debug|info|warn|error|silent (default: info).
 * GENIE_DEBUG=true forces debug level.
 */

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevelName, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

function threshold(): number {
  if (process.env.GENIE_DEBUG) return ORDER.debug;
  const name = (process.env.GENIE_LOG_LEVEL ?? 'info').toLowerCase() as LogLevelName;
  return ORDER[name] ?? ORDER.info;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(namespace: string): Logger {
  const prefix = `[${namespace}]`;
  const enabled = (level: LogLevelName): boolean => ORDER[level] >= threshold();
  return {
    debug: (...a) => { if (enabled('debug')) console.log(prefix, ...a); },
    info: (...a) => { if (enabled('info')) console.log(prefix, ...a); },
    warn: (...a) => { if (enabled('warn')) console.warn(prefix, ...a); },
    error: (...a) => { if (enabled('error')) console.error(prefix, ...a); },
  };
}
