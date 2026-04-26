import type { Meta, StoryObj } from '@storybook/react'
import { ListItem } from './ListItem'
import { Badge } from './Badge'

const meta: Meta<typeof ListItem> = {
  title: 'Data/ListItem',
  component: ListItem,
  tags: ['autodocs'],
  args: { title: 'Patient A01', subtitle: 'Sun Life · $850.00' },
}
export default meta
type Story = StoryObj<typeof ListItem>

export const Default: Story = {}
export const WithChevron: Story = { args: { chevron: true, onClick: () => {} } }
export const WithLeading: Story = {
  args: {
    leading: (
      <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 text-sm font-bold">
        A1
      </div>
    ),
    chevron: true,
    onClick: () => {},
  },
}
export const WithTrailing: Story = {
  args: {
    trailing: <Badge variant="warning">Pending</Badge>,
    chevron: true,
    onClick: () => {},
  },
}
export const UrgentBorder: Story = { args: { urgency: 'urgent', chevron: true, subtitle: '48 days overdue · $1,500' } }
export const WarningBorder: Story = { args: { urgency: 'warning', chevron: true, subtitle: '12 days · $850' } }
export const Disabled: Story = { args: { disabled: true } }

export const ListGroup: Story = {
  render: () => (
    <div className="rounded-lg border border-gray-200 overflow-hidden divide-y divide-gray-100">
      <ListItem title="Patient A01" subtitle="Sun Life · $850.00" urgency="urgent" chevron onClick={() => {}} trailing={<Badge variant="error">48d</Badge>} />
      <ListItem title="Patient A02" subtitle="Manulife · $250.00" urgency="warning" chevron onClick={() => {}} trailing={<Badge variant="warning">12d</Badge>} />
      <ListItem title="Patient A03" subtitle="Canada Life · $120.00" chevron onClick={() => {}} trailing={<Badge variant="success">Paid</Badge>} />
    </div>
  ),
}
