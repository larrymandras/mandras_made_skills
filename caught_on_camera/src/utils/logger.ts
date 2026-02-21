import { env } from '../config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[env.LOG_LEVEL]) return;
  const ts = new Date().toISOString();
  const out = env.LOG_FORMAT === 'json'
    ? JSON.stringify({ timestamp: ts, level, message, ...meta })
    : meta ? `[${ts}] [${level.toUpperCase()}] ${message} ${JSON.stringify(meta)}`
           : `[${ts}] [${level.toUpperCase()}] ${message}`;
  level === 'error' ? process.stderr.write(out + '\n') : process.stdout.write(out + '\n');
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info:  (msg: string, meta?: Record<string, unknown>) => log('info',  msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => log('warn',  msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
