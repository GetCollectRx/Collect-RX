import type { Meta, StoryObj } from '@storybook/react'
import { Checkbox } from './Checkbox'

const meta: Meta<typeof Checkbox> = {
  title: 'Base/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  args: { label: 'Send email notifications' },
}
export default meta
type Story = StoryObj<typeof Checkbox>

export const Default: Story        = {}
export const Checked: Story        = { args: { defaultChecked: true } }
export const Indeterminate: Story  = { args: { indeterminate: true } }
export const WithHint: Story       = { args: { hint: 'You can change this in Settings.' } }
export const WithError: Story      = { args: { error: 'You must accept the terms.' } }
export const Disabled: Story       = { args: { disabled: true } }
export const DisabledChecked: Story = { args: { disabled: true, defaultChecked: true } }
