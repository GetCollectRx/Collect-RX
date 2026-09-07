import express from 'express';
import { logger } from '../observability/logger.js';

export interface SanitizedError {
  success: false;
  error: string;
  correlationId: string;
  timestamp: string;
}

/**
 * Global error handler middleware that:
 * 1. Logs full error details server-side (with correlation ID for tracing)
 * 2. Sanitizes error messages to prevent leaking database details, API keys, PII/PHI
 * 3. Returns only a generic message to clients (plus correlation ID for support reference)
 * 4. Handles different status codes appropriately
 */
export function globalErrorHandler(
  err: any,
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) {
  // Get or generate correlation ID for tracing
  const correlationId = req.get('x-correlation-id') || req.id || generateCorrelationId();

  // Determine HTTP status code
  let statusCode = err.statusCode || err.status || 500;
  if (statusCode < 400 || statusCode > 599) {
    statusCode = 500;
  }

  // Log the full error server-side (including stack trace)
  logDetailedError(err, req, correlationId, statusCode);

  // Build sanitized response
  const sanitizedResponse: SanitizedError = {
    success: false,
    error: getSanitizedMessage(err, statusCode),
    correlationId,
    timestamp: new Date().toISOString(),
  };

  // Send response
  res.status(statusCode).json(sanitizedResponse);
}

/**
 * Sanitize error message to remove sensitive information before sending to client.
 * Patterns blocked:
 * - Database connection errors (ECONNREFUSED, ENOTFOUND)
 * - SQL/database references (postgres, mysql, sql, query, schema, table, column, constraint)
 * - Secrets/credentials (password, secret, token, api_key, api-key)
 * - Stack traces (function names, file paths with line numbers)
 * - PII/PHI (emails, phone numbers, SSN-like patterns, health card numbers)
 */
function getSanitizedMessage(err: any, statusCode: number): string {
  const message = err?.message || '';

  // List of patterns that indicate sensitive information is being leaked
  const blockedPatterns = [
    // Connection errors
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /ECONNRESET/i,
    /ETIMEDOUT/i,

    // Credentials
    /password/i,
    /secret/i,
    /token/i,
    /api[_-]?key/i,
    /authorization/i,
    /bearer/i,
    /x-api-key/i,

    // Database details
    /database/i,
    /postgres/i,
    /postgresql/i,
    /mysql/i,
    /sql/i,
    /query/i,
    /constraint/i,
    /foreign key/i,
    /unique violation/i,
    /duplicate key/i,

    // Schema information
    /schema/i,
    /table/i,
    /column/i,
    /index/i,
    /syntax error/i,

    // Stack traces
    /at\s+Object\.<anonymous>/,
    /at\s+.*\(.*\.js:\d+:\d+\)/,
    /at\s+.*\(.*\.ts:\d+:\d+\)/,
    /\.ts:\d+:\d+/,
    /\.js:\d+:\d+/,

    // File paths
    /\/app\//i,
    /\/home\//i,
    /\/users\//i,
    /C:\\.*\\/i,

    // AWS/cloud endpoint leaks
    /\.rds\./i,
    /\.database\.windows\.net/i,
    /cloudinary/i,
    /googleapis\.com/i,
  ];

  // Check if error message contains blocked patterns
  for (const pattern of blockedPatterns) {
    if (pattern.test(message)) {
      return getGenericMessage(statusCode);
    }
  }

  // Also block if error contains PII patterns
  if (containsPII(message)) {
    return getGenericMessage(statusCode);
  }

  // Safe to return original message for client-side errors (4xx)
  // For 5xx errors, still return generic message even if content looks "safe"
  if (statusCode >= 500) {
    return getGenericMessage(statusCode);
  }

  return message;
}

/**
 * Detect PII/PHI patterns in error messages.
 * Catches: SSN, credit cards, emails, phone numbers, health card numbers, etc.
 */
function containsPII(text: string): boolean {
  const piiPatterns = [
    /\d{3}-\d{2}-\d{4}/, // SSN (123-45-6789)
    /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/, // Credit card
    /\d{3}-\d{3}-\d{4}/, // Phone number (123-456-7890)
    /\b\d{10}\b/, // 10-digit phone
    /\b\d{6}-\d{3}\b/, // Canadian SIN-like (123456-789)
    /\b[A-Z]{2}\d{6}/, // Ontario health card start
    /\b\d{9}\b/, // SSN without dashes
  ];

  return piiPatterns.some((pattern) => pattern.test(text));
}

/**
 * Return a generic message based on HTTP status code.
 * These are safe to show clients and don't leak implementation details.
 */
function getGenericMessage(statusCode: number): string {
  const messages: Record<number, string> = {
    400: 'Invalid request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not found',
    405: 'Method not allowed',
    409: 'Conflict',
    422: 'Unprocessable entity',
    429: 'Too many requests',
    500: 'An error occurred processing your request',
    502: 'Service unavailable',
    503: 'Service unavailable',
  };

  return messages[statusCode] || 'An error occurred';
}

/**
 * Log detailed error server-side (never sent to client).
 * Includes full stack trace, query params, request body (sanitized), etc.
 */
function logDetailedError(
  err: any,
  req: express.Request,
  correlationId: string,
  statusCode: number,
) {
  const errorContext = {
    correlationId,
    method: req.method,
    path: req.path,
    statusCode,
    userId: (req as any).user?.id,
    practiceId: (req as any).practiceId,
    timestamp: new Date().toISOString(),
    message: err.message,
    stack: err.stack,
    query: req.query,
    body: sanitizeLogBody(req.body),
    headers: sanitizeHeaders(req.headers),
  };

  // Log at appropriate level
  if (statusCode >= 400 && statusCode < 500) {
    logger.warn('[error-handler] Client error', errorContext);
  } else {
    logger.error('[error-handler] Server error', errorContext);
  }
}

/**
 * Remove sensitive fields from logged request body.
 * Prevents accidentally logging passwords, API keys, etc. in the server logs.
 */
function sanitizeLogBody(body: any): any {
  if (!body || typeof body !== 'object') return body;

  const sensitiveFields = [
    'password',
    'secret',
    'token',
    'apiKey',
    'api_key',
    'databaseUrl',
    'database_url',
    'connectionString',
    'connection_string',
    'ssn',
    'healthCardNumber',
    'healthcard_number',
    'creditCard',
    'credit_card',
    'cvv',
  ];

  const sanitized = JSON.parse(JSON.stringify(body));

  const redact = (obj: any) => {
    if (obj === null || typeof obj !== 'object') return;
    for (const key in obj) {
      if (sensitiveFields.some((s) => key.toLowerCase().includes(s))) {
        obj[key] = '***REDACTED***';
      } else if (typeof obj[key] === 'object') {
        redact(obj[key]);
      }
    }
  };

  redact(sanitized);
  return sanitized;
}

/**
 * Sanitize HTTP headers to remove Authorization and other sensitive headers from logs.
 */
function sanitizeHeaders(headers: any): any {
  if (!headers || typeof headers !== 'object') return headers;

  const sensitiveHeaderKeys = [
    'authorization',
    'cookie',
    'x-api-key',
    'x-token',
    'x-secret',
    'x-auth-token',
  ];

  const sanitized = JSON.parse(JSON.stringify(headers));
  for (const key in sanitized) {
    if (sensitiveHeaderKeys.some((s) => key.toLowerCase().includes(s))) {
      sanitized[key] = '***REDACTED***';
    }
  }
  return sanitized;
}

/**
 * Generate unique correlation ID for error tracing.
 * Format: err_<timestamp>_<random>
 */
function generateCorrelationId(): string {
  return `err_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
