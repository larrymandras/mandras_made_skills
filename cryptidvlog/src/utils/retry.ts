import { logger } from './logger.js';

export class NonRetryableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

interface RetryOptions {
  maxAttempts: number;
  baseDelayMs?: number;
  backoffFactor?: number;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown) => void;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const { maxAttempts, baseDelayMs = 1_000, backoffFactor = 2,
    isRetryable = (e) => !(e instanceof NonRetryableError), onRetry } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(backoffFactor, attempt - 1);
      logger.warn(`Retry ${attempt}/${maxAttempts} in ${delay}ms`, { error: String(err) });
      onRetry?.(attempt, err);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
