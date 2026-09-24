export interface RetryOptions {
  /** Total attempts, including the first — e.g. 3 = 1 try + up to 2 retries. */
  attempts: number;
  baseDelayMs: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Bounded exponential backoff for a single async operation. Used to retry
 * the SNS publish call itself against transient AWS errors (throttling,
 * network blips) — NOT to retry the whole consume-and-process operation,
 * which has its own separate failure path via SQS redelivery/DLQ.
 *
 * Delay sequence for the default baseDelayMs: attempt 1 fails -> wait
 * baseDelayMs, attempt 2 fails -> wait 2*baseDelayMs, then attempt 3 is the
 * last try (no further wait). Throws the last error if every attempt fails.
 */
export async function retryWithBackoff<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts) {
        break;
      }
      options.onRetry?.(attempt, error);
      const delayMs = options.baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
