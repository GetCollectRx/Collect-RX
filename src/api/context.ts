import { AsyncLocalStorage } from 'async_hooks';
import type { UserRole } from '../types';

interface RequestContext {
  practiceId: string;
  userId: string;
  role: UserRole;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run(ctx: RequestContext, fn: () => void): void {
    storage.run(ctx, fn);
  },
  get(): RequestContext {
    const ctx = storage.getStore();
    if (!ctx) throw new Error('requestContext accessed outside an authenticated request');
    return ctx;
  },
  practiceId(): string {
    return requestContext.get().practiceId;
  },
  userId(): string {
    return requestContext.get().userId;
  },
  role(): UserRole {
    return requestContext.get().role;
  },
};
