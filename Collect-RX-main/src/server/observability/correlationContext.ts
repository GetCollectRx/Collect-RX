import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request/job-scoped correlation ID, propagated the same way rlsContext.ts
 * propagates practiceId/bypass — via AsyncLocalStorage rather than having
 * every call site thread an extra parameter through every function. The
 * structured logger (logger.ts) reads this automatically so a correlation
 * ID shows up on every log line for a request or job without each log call
 * having to pass it explicitly.
 */
const storage = new AsyncLocalStorage<string>();

export function getCorrelationId(): string | undefined {
  return storage.getStore();
}

export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run(correlationId, fn);
}
