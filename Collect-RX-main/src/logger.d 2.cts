import type { Logger } from 'winston';

interface AuditLogger extends Logger {
  audit(event: string, context?: Record<string, unknown>): void;
}

declare const logger: AuditLogger;
export default logger;
export { logger };
