import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { Table, Column, SortDirection } from './Table'
import { Badge } from './Badge'

const meta: Meta = { title: 'Data/Table', tags: ['autodocs'] }
export default meta

interface Claim { id: string; patient: string; amount: string; status: string; days: number }

const rows: Claim[] = [
  { id: '1', patient: 'Patient A01', amount: '$850.00', status: 'Pending', days: 12 },
  { id: '2', patient: 'Patient A02', amount: '$250.00', status: 'Approved', days: 2 },
  { id: '3', patient: 'Patient A03', amount: '$1,500.00', status: 'Overdue', days: 48 },
  { id: '4', patient: 'Patient A04', amount: '$120.00', status: 'Paid', days: 5 },
  { id: '5', patient: 'Patient A05', amount: '$350.00', status: 'In Dispute', days: 30 },
]

const variantMap: Record<string, 'warning'|'success'|'error'|'neutral'|'info'> = {
  Pending: 'warning', Approved: 'success', Overdue: 'error', Paid: 'neutral', 'In Dispute': 'info',
}

const columns: Column<Claim>[] = [
  { key: 'patient', header: 'Patient',  sortable: true },
  { key: 'amount',  header: 'Amount',   sortable: true, align: 'right' },
  { key: 'days',    header: 'Days out', sortable: true, align: 'right' },
  {
    key: 'status', header: 'Status',
    render: row => <Badge variant={variantMap[row.status]}>{row.status}</Badge>,
  },
]

export const Default: StoryObj = { render: () => <Table columns={columns} rows={rows} /> }
export const Loading: StoryObj = { render: () => <Table columns={columns} rows={[]} loading /> }
export const Empty: StoryObj   = { render: () => <Table columns={columns} rows={[]} emptyMessage="No claims found." /> }
export const Clickable: StoryObj = {
  render: () => <Table columns={columns} rows={rows} onRowClick={r => alert(`Clicked: ${r.patient}`)} />,
}
export const Sortable: StoryObj = {
  render: () => {
    const [sortKey, setSortKey] = useState<string>('patient')
    const [sortDir, setSortDir] = useState<SortDirection>('asc')
    const sorted = [...rows].sort((a, b) => {
      if (!sortDir) return 0
      const v = String((a as any)[sortKey]).localeCompare(String((b as any)[sortKey]))
      return sortDir === 'asc' ? v : -v
    })
    return (
      <Table
        columns={columns}
        rows={sorted}
        sortKey={sortKey}
        sortDirection={sortDir}
        onSort={(k, d) => { setSortKey(k); setSortDir(d) }}
      />
    )
  },
}
