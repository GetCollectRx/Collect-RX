import { AsyncLocalStorage } from 'node:async_hooks';

/** Request/job-scoped PostgreSQL RLS session variables (via set_config). */
export interface RlsContext {
  /** Tenant scope — maps to app.practice_id for RLS policies. */
  practiceId?: string;
  /** Platform jobs (rules tick, learning cycle) that legitimately cross tenants. */
  bypass?: boolean;
}

const storage = new AsyncLocalStorage<RlsContext>();

export function getRlsContext(): RlsContext | undefined {
  return storage.getStore();
}

export function runWithRlsContext<T>(ctx: RlsContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export async function runWithRlsBypass<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ bypass: true }, fn);
}

export async function runWithPracticeRls<T>(practiceId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ practiceId }, fn);
}
