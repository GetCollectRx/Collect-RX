import { ReactNode } from 'react'

export type SortDirection = 'asc' | 'desc' | null

export interface Column<T> {
  key: keyof T | string
  header: ReactNode
  /** Custom cell renderer. Receives the row and returns a ReactNode. */
  render?: (row: T) => ReactNode
  sortable?: boolean
  /** Tailwind width class, e.g. 'w-32' */
  width?: string
  /** Text alignment */
  align?: 'left' | 'center' | 'right'
}

export interface TableProps<T extends { id: string | number }> {
  columns: Column<T>[]
  rows: T[]
  /** Key of the column currently sorted */
  sortKey?: string
  sortDirection?: SortDirection
  onSort?: (key: string, direction: SortDirection) => void
  onRowClick?: (row: T) => void
  emptyMessage?: string
  loading?: boolean
  /** Highlight every other row */
  striped?: boolean
  caption?: string
  className?: string
}

function SortIcon({ direction }: { direction: SortDirection }) {
  return (
    <span className="ml-1 inline-flex flex-col leading-none text-current" aria-hidden="true">
      <svg className={`h-2.5 w-2.5 ${direction === 'asc' ? 'opacity-100' : 'opacity-30'}`} viewBox="0 0 10 6" fill="currentColor">
        <path d="M5 0L10 6H0z" />
      </svg>
      <svg className={`h-2.5 w-2.5 ${direction === 'desc' ? 'opacity-100' : 'opacity-30'}`} viewBox="0 0 10 6" fill="currentColor">
        <path d="M5 6L0 0H10z" />
      </svg>
    </span>
  )
}

export function Table<T extends { id: string | number }>({
  columns,
  rows,
  sortKey,
  sortDirection = null,
  onSort,
  onRowClick,
  emptyMessage = 'No data',
  loading = false,
  striped = true,
  caption,
  className = '',
}: TableProps<T>) {
  const handleSort = (col: Column<T>) => {
    if (!col.sortable || !onSort) return
    const key = String(col.key)
    if (sortKey !== key) return onSort(key, 'asc')
    if (sortDirection === 'asc')  return onSort(key, 'desc')
    onSort(key, null)
  }

  const alignClass = { left: 'text-left', center: 'text-center', right: 'text-right' }

  return (
    <div className={`w-full overflow-x-auto rounded-lg border border-gray-200 ${className}`}>
      <table className="w-full min-w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {columns.map(col => {
              const key = String(col.key)
              const isSorted = sortKey === key
              return (
                <th
                  key={key}
                  scope="col"
                  aria-sort={
                    isSorted
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : sortDirection === 'desc'
                        ? 'descending'
                        : 'none'
                      : undefined
                  }
                  className={[
                    'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500',
                    col.width ?? '',
                    alignClass[col.align ?? 'left'],
                    col.sortable
                      ? 'cursor-pointer select-none hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => handleSort(col)}
                  onKeyDown={col.sortable ? e => { if (e.key === 'Enter') handleSort(col) } : undefined}
                  tabIndex={col.sortable ? 0 : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable && (
                      <SortIcon direction={isSorted ? sortDirection : null} />
                    )}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {columns.map(col => (
                  <td key={String(col.key)} className="px-4 py-3">
                    <div className="h-4 rounded bg-gray-200 animate-pulse w-3/4" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-sm text-gray-400"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIdx) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? e => { if (e.key === 'Enter') onRowClick(row) } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={[
                  striped && rowIdx % 2 === 1 ? 'bg-gray-50' : 'bg-white',
                  onRowClick
                    ? 'cursor-pointer hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500'
                    : '',
                  'transition-colors duration-100',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {columns.map(col => {
                  const key = String(col.key)
                  const value = col.render
                    ? col.render(row)
                    : (row as Record<string, unknown>)[key] as ReactNode

                  return (
                    <td
                      key={key}
                      className={[
                        'px-4 py-3 text-gray-800',
                        alignClass[col.align ?? 'left'],
                      ].join(' ')}
                    >
                      {value}
                    </td>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
