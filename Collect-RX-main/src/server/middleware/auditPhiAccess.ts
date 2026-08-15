/**
 * Middleware to audit PHI access.
 * Logs all requests to sensitive routes for compliance.
 */

import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma.js';
import { logImmutableAuditEntry } from '../audit/immutableAuditLog.js';

// Routes that access PHI
const SENSITIVE_ROUTES = [
  '/api/insurance/claims',
  '/api/calls',
  '/api/patients',
  '/api/recordings',
  '/api/admin/audit',
];

/**
 * Middleware to audit all PHI access.
 * Should be mounted early in the middleware stack.
 */
export function auditPhiAccessMiddleware(req: Request, res: Response, next: NextFunction) {
  // Check if this is a sensitive route
  const isSensitiveRoute = SENSITIVE_ROUTES.some((route) => req.path.startsWith(route));

  if (isSensitiveRoute) {
    // Capture response for audit
    const originalSend = res.send;

    res.send = function (data: any) {
      // Log PHI access after response (only if successful)
      if (res.statusCode < 400 && req.user) {
        logImmutableAuditEntry(prisma, {
          userId: (req.user as any).id,
          action: getActionFromMethod(req.method),
          resourceType: getResourceType(req.path),
          resourceId: extractResourceId(req),
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          result: 'success',
          details: `${req.method} ${req.path}`,
        }).catch((error) => {
          console.error('[audit] Failed to log PHI access', error);
        });
      }

      // Send response
      res.send = originalSend;
      return res.send(data);
    };
  }

  next();
}

function getActionFromMethod(method: string): 'read' | 'write' | 'delete' | 'export' {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'read';
    case 'DELETE':
      return 'delete';
    case 'POST':
    case 'PUT':
    case 'PATCH':
      return 'write';
    default:
      return 'read';
  }
}

function getResourceType(
  path: string
): 'patient' | 'claim' | 'recording' | 'practice_setting' | 'other' {
  if (path.includes('patients')) return 'patient';
  if (path.includes('claims') || path.includes('insurance')) return 'claim';
  if (path.includes('recordings') || path.includes('calls')) return 'recording';
  if (path.includes('admin')) return 'practice_setting';
  return 'other';
}

function extractResourceId(req: Request): string {
  // Try common parameter names
  if (req.params.id) return req.params.id;
  if (req.params.claimId) return req.params.claimId;
  if (req.params.patientId) return req.params.patientId;
  if (req.body?.id) return req.body.id;
  if (req.body?.claimId) return req.body.claimId;

  // Fallback to path segment
  const segments = req.path.split('/');
  return segments[segments.length - 1] || 'unknown';
}
