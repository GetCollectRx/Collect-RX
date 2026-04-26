export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(date)
  );
}

export function formatTime(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(date)
  );
}

export type AgeClass = 'current' | 'warning' | 'overdue';

export function getAgeClass(days: number): AgeClass {
  if (days >= 60) return 'overdue';
  if (days >= 30) return 'warning';
  return 'current';
}
