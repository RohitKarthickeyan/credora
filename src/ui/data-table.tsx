import type { ReactNode } from 'react'
import { cn } from './cn'

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => ReactNode
  align?: 'start' | 'end'
  hideOnPhone?: boolean
}

// One table, two shapes: below sm each row is restyled into a stacked label/value card, at sm
// and above it is a real table. The markup stays table markup either way.
export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowKey,
  empty,
}: {
  caption: string
  columns: ReadonlyArray<Column<T>>
  rows: readonly T[]
  getRowKey: (row: T) => string
  empty?: ReactNode
}) {
  return (
    <div>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden sm:table-header-group">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'border-b border-border bg-surface-sunken px-3 py-2 font-medium text-ink-muted',
                  column.align === 'end' ? 'text-end' : 'text-start',
                  column.hideOnPhone ? 'hidden sm:table-cell' : undefined,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block sm:table-row-group">
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              className="mb-3 block rounded-card border border-border bg-surface sm:mb-0 sm:table-row sm:rounded-none sm:border-0"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-label={column.header}
                  className={cn(
                    'items-baseline justify-between gap-3 px-4 py-2 text-ink before:text-xs before:font-medium before:text-ink-muted before:content-[attr(data-label)] sm:table-cell sm:border-b sm:border-border sm:px-3 sm:py-2 sm:before:content-none',
                    column.hideOnPhone ? 'hidden' : 'flex',
                    column.align === 'end' ? 'sm:text-end' : 'sm:text-start',
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && empty !== undefined ? <div className="py-6">{empty}</div> : null}
    </div>
  )
}
