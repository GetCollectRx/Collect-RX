import { randomUUID } from 'crypto';

export function generateId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function escapeHtml(value: unknown): string {
  if (typeof value !== 'string') return String(value ?? '');
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
