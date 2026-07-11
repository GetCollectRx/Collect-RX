import { Prisma, PrismaClient } from '@prisma/client';
import { getRlsContext } from '../server/db/rlsContext.js';

/**
 * Wraps every Prisma operation in a transaction that sets PostgreSQL RLS
 * session variables when AsyncLocalStorage carries a practice or bypass context.
 */
export function extendPrismaWithRls(base: PrismaClient) {
  return base.$extends(
    Prisma.defineExtension({
      name: 'collectrx-rls',
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const ctx = getRlsContext();
            if (!ctx?.practiceId && !ctx?.bypass) {
              return query(args);
            }

            const ops: Prisma.PrismaPromise<unknown>[] = [];
            if (ctx.bypass) {
              ops.push(base.$executeRaw`SELECT set_config('app.rls_bypass', 'true', true)`);
            } else if (ctx.practiceId) {
              ops.push(base.$executeRaw`SELECT set_config('app.practice_id', ${ctx.practiceId}, true)`);
            }
            ops.push(query(args));

            const results = await base.$transaction(ops);
            return results[results.length - 1];
          },
        },
      },
    }),
  );
}

export type ExtendedPrismaClient = ReturnType<typeof extendPrismaWithRls>;
