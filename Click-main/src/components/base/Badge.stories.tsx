import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from './Badge'

const meta: Meta<typeof Badge> = {
  title: 'Base/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['success','warning','error','info','neutral'] },
    size:    { control: 'select', options: ['sm','md'] },
    dot:     { control: 'boolean' },
  },
  args: { children: 'Badge' },
}
export default meta
type Story = StoryObj<typeof Badge>

export const Success: Story = { args: { variant: 'success' } }
export const Warning: Story = { args: { variant: 'warning' } }
export const Error: Story   = { args: { variant: 'error' } }
export const Info: Story    = { args: { variant: 'info' } }
export const Neutral: Story = { args: { variant: 'neutral' } }
export const WithDot: Story = { args: { variant: 'success', dot: true, children: 'Active' } }
export const Small: Story   = { args: { size: 'sm' } }

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <Badge variant="success" dot>Approved</Badge>
      <Badge variant="warning" dot>Pending</Badge>
      <Badge variant="error"   dot>Denied</Badge>
      <Badge variant="info"    dot>In Review</Badge>
      <Badge variant="neutral" dot>Draft</Badge>
    </div>
  ),
}

export const ClaimStatuses: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Badge variant="success">Paid</Badge>
      <Badge variant="warning">Pending</Badge>
      <Badge variant="error">Overdue</Badge>
      <Badge variant="neutral">Draft</Badge>
      <Badge variant="info">In Dispute</Badge>
    </div>
  ),
}
