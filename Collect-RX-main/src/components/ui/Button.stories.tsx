import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'

const meta: Meta<typeof Button> = {
  title:     'UI/Button',
  component: Button,
  tags:      ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['primary','secondary','ghost','danger','success'] },
    size:    { control: 'select', options: ['xs','sm','md','lg'] },
    loading: { control: 'boolean' },
  },
}
export default meta
type Story = StoryObj<typeof Button>

export const Primary:   Story = { args: { children: 'Run Call Batch', variant: 'primary' } }
export const Secondary: Story = { args: { children: 'Export CSV', variant: 'secondary' } }
export const Ghost:     Story = { args: { children: 'Clear filters', variant: 'ghost' } }
export const Danger:    Story = { args: { children: 'Delete', variant: 'danger' } }
export const Loading:   Story = { args: { children: 'Saving…', variant: 'primary', loading: true } }
export const Small:     Story = { args: { children: 'View', variant: 'secondary', size: 'xs' } }
