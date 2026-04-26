import { Request, Response, NextFunction } from 'express';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { PrismaClient } from '@prisma/client';
type AnyPrisma = any;

export interface AuditLogEntry {
  userId?    : string;
  practiceId?: string;
  action     : string;
  resource   : string;
  resourceId?: string;
  ipAddress? : string;
  userAgent? : string;
  metadata?  : string;
}

// ── Direct log function (use inside route handlers) ───────────────────────────

export async function logAudit(prisma: PrismaClient, entry: AuditLogEntry): Promise<void> {
  try {
    await (prisma as AnyPrisma).auditLog.create({ data: entry });
  } catch (err) {
    // Audit logging must never crash the app
    console.error('[AUDIT] Failed to write audit log:', err);
  }
}

// ── PHI_ACTIONS: actions that constitute PHI access ──────────────────────────

const PHI_READ_PATTERNS: Array<{ method: string; pathPattern: RegExp; action: string; resource: string }> = [
  { method: 'GET',  pathPattern: /^\/api\/balances/,                action: 'READ_BALANCE',      resource: 'Balance'     },
  { method: 'GET',  pathPattern: /^\/api\/analytics/,               action: 'READ_ANALYTICS',    resource: 'Analytics'   },
  { method: 'GET',  pathPattern: /^\/api\/outreach/,                 action: 'READ_OUTREACH',     resource: 'Outreach'    },
  { method: 'POST', pathPattern: /^\/api\/outreach\/[^/]+\/respond/, action: 'RESPOND_OUTREACH',  resource: 'Outreach'    },
  { method: 'POST', pathPattern: /^\/api\/pay/,                      action: 'PROCESS_PAYMENT',   resource: 'Payment'     },
  { method: 'GET',  pathPattern: /^\/api\/dashboard/,                action: 'READ_DASHBOARD',    resource: 'Dashboard'   },
  { method: 'GET',  pathPattern: /^\/api\/estimates/,                action: 'READ_ESTIMATE',     resource: 'Estimate'    },
  { method: 'POST', pathPattern: /^\/api\/estimates/,                action: 'CREATE_ESTIMATE',   resource: 'Estimate'    },
  { method: 'POST', pathPattern: /^\/api\/reconciliations/,          action: 'CREATE_RECONCILE',  resource: 'Reconcile'   },
];

// ── Express middleware: auto-log PHI access ───────────────────────────────────

export function auditMiddleware(prisma: PrismaClient) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const match = PHI_READ_PATTERNS.find(
      p => p.method === req.method && p.pathPattern.test(req.path)
    );

    if (match && req.user) {
      // Fire-and-forget — don't await to avoid latency on every request
      logAudit(prisma, {
        userId    : req.user.userId,
        practiceId: req.user.practiceId,
        action    : match.action,
        resource  : match.resource,
        resourceId: req.params.id,
        ipAddress : req.ip,
        userAgent : req.headers['user-agent'],
        metadata  : JSON.stringify({
          path   : req.path,
          query  : req.query,
          method : req.method,
        }),
      }).catch(() => {}); // already handled inside logAudit
    }

    next();
  };
}
