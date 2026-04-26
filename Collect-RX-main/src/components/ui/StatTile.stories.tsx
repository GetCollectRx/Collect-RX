import type { Meta, StoryObj } from '@storybook/react'
import { StatTile } from './StatTile'

const meta: Meta<typeof StatTile> = {
  title:     'UI/StatTile',
  component: StatTile,
  tags:      ['autodocs'],
}
export default meta
type Story = StoryObj<typeof StatTile>

export const Default: Story = {
  args: { label: 'Total Open A/R', value: '$48,240', sub: '127 open claims' },
}
export const Green: Story = {
  args: { label: 'Revenue Recovered', value: '$8,420', sub: 'this week', accent: 'green', icon: '📈', trend: { value: '+12%', dir: 'up' } },
}
export const Amber: Story = {
  args: { label: 'Avg Days to Pay', value: '18d', sub: 'from creation', accent: 'amber' },
}
export const Red: Story = {
  args: { label: 'Overdue >60 d', value: '$12,400', sub: '31 claims', accent: 'red' },
}

export const AllAccents: Story = {
  render: () => (
    <div className="grid grid-cols-4 gap-4 p-4">
      <StatTile label="Default"    value="$48k"  sub="127 claims" />
      <StatTile label="Green"      value="$8.4k" sub="this week"   accent="green"  icon="↑" />
      <StatTile label="Amber"      value="18d"   sub="avg"         accent="amber"  icon="⏱" />
      <StatTile label="Red/Urgent" value="31"    sub=">60 days"    accent="red"    icon="🔥" />
    </div>
  ),
}
