import { HTMLAttributes } from 'react'

// ── Container ─────────────────────────────────────────────────────────────
export function TableContainer({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden shadow-card ${className}`}>
      <div className="overflow-x-auto">
        {children}
      </div>
    </div>
  )
}

// ── Table ─────────────────────────────────────────────────────────────────
export function Table({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <table className={`w-full text-sm ${className}`} role="table">
      {children}
    </table>
  )
}

// ── Head ──────────────────────────────────────────────────────────────────
export function Thead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-gray-100 dark:border-gray-700">
      {children}
    </thead>
  )
}

// ── Th ────────────────────────────────────────────────────────────────────
interface ThProps extends HTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'center' | 'right'
  sortable?: boolean
  sorted?: 'asc' | 'desc' | null
  onSort?: () => void
}

export function Th({ children, align = 'left', sortable = false, sorted, onSort, className = '', ...props }: ThProps) {
  return (
    <th
      className={[
        'px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap',
        `text-${align}`,
        sortable && 'cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors',
        className,
      ].filter(Boolean).join(' ')}
      onClick={sortable ? onSort : undefined}
      aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
      {...props}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && (
          <span className="text-gray-300 dark:text-gray-600" aria-hidden="true">
            {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}
          </span>
        )}
      </span>
    </th>
  )
}

// ── Tbody ──────────────────────────────────────────────────────────────────
export function Tbody({ children }: { children: React.ReactNode }) {
  return (
    <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
      {children}
    </tbody>
  )
}

// ── Tr ────────────────────────────────────────────────────────────────────
interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  highlight?: boolean
}

export function Tr({ children, highlight, className = '', ...props }: TrProps) {
  return (
    <tr
      className={[
        'hover:bg-gray-50/70 dark:hover:bg-gray-700/30 transition-colors duration-100',
        highlight && 'bg-amber-50/40 dark:bg-amber-900/10 border-l-2 border-l-amber-400',
        className,
      ].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </tr>
  )
}

// ── Td ────────────────────────────────────────────────────────────────────
interface TdProps extends HTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'center' | 'right'
  muted?: boolean
  bold?: boolean
}

export function Td({ children, align = 'left', muted, bold, className = '', ...props }: TdProps) {
  return (
    <td
      className={[
        'px-4 py-3 whitespace-nowrap',
        `text-${align}`,
        muted  ? 'text-gray-500 dark:text-gray-400' : 'text-gray-700 dark:text-gray-200',
        bold   && 'font-semibold',
        className,
      ].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </td>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────
export function TableEmpty({
  message = 'No data found.',
  colSpan = 6,
  action,
}: {
  message?: string
  colSpan?: number
  action?: React.ReactNode
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
        <p>{message}</p>
        {action && <div className="mt-4">{action}</div>}
      </td>
    </tr>
  )
}
