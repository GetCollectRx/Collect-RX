import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'

const meta: Meta<typeof Button> = {
  title: 'Base/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['primary','secondary','danger','success','ghost'] },
    size:    { control: 'select', options: ['sm','md','lg'] },
    loading:   { control: 'boolean' },
    disabled:  { control: 'boolean' },
    fullWidth: { control: 'boolean' },
  },
  args: { children: 'Button' },
}
export default meta
type Story = StoryObj<typeof Button>

export const Primary: Story    = { args: { variant: 'primary' } }
export const Secondary: Story  = { args: { variant: 'secondary' } }
export const Danger: Story     = { args: { variant: 'danger' } }
export const Success: Story    = { args: { variant: 'success' } }
export const Ghost: Story      = { args: { variant: 'ghost' } }
export const Loading: Story    = { args: { variant: 'primary', loading: true } }
export const Disabled: Story   = { args: { variant: 'primary', disabled: true } }
export const Small: Story      = { args: { size: 'sm' } }
export const Large: Story      = { args: { size: 'lg' } }
export const FullWidth: Story  = { args: { fullWidth: true } }

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="success">Success</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="ghost">Ghost</Button>
    </div>
  ),
}

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}
