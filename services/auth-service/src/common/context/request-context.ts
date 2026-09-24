import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  correlationId: string;
}

/**
 * Carries the per-request `X-Correlation-Id` (docs/CONTRACTS.md §2) across
 * async boundaries without threading it through every function signature, so
 * the logger can enrich every log line for a request without extra plumbing.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getCorrelationId(): string | undefined {
  return requestContextStorage.getStore()?.correlationId;
}
