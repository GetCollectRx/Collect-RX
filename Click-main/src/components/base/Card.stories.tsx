import type { Meta, StoryObj } from '@storybook/react'
import { Card, CardHeader, CardTitle, CardDivider } from './Card'
import { Badge } from './Badge'

const meta: Meta<typeof Card> = {
  title: 'Layout/Card',
  component: Card,
  tags: ['autodocs'],
  args: { children: 'Card content goes here.' },
}
export default meta
type Story = StoryObj<typeof Card>

export const Default: Story   = {}
export const Elevated: Story  = { args: { variant: 'elevated' } }
export const Flat: Story      = { args: { variant: 'flat' } }
export const Outlined: Story  = { args: { variant: 'outlined' } }
export const Interactive: Story = {
  args: {
    interactive: true,
    children: 'Click or press Enter on me.',
    onClick: () => alert('Card clicked!'),
  },
}
export const WithHeader: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Pending Claims</CardTitle>
        <Badge variant="warning" dot>23</Badge>
      </CardHeader>
      <CardDivider />
      <p className="text-sm text-gray-600">Claims that need attention before end of day.</p>
    </Card>
  ),
}
export const StatCard: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
      {[
        { label: 'Claims Processed', value: '142', trend: '+12%' },
        { label: 'Collected ($)', value: '$28,450', trend: '+8%' },
        { label: 'Success Rate', value: '94%', trend: '+2%' },
        { label: 'Pending', value: '23', trend: '-5%' },
      ].map(s => (
        <Card key={s.label} padding="md">
          <p className="text-xs text-gray-500 font-medium">{s.label}</p>
          <p className="text-2xl font-bold text-emerald-900 mt-1">{s.value}</p>
          <p className="text-xs text-emerald-600 mt-1">{s.trend}</p>
        </Card>
      ))}
    </div>
  ),
}
