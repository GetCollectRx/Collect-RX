import type { Meta, StoryObj } from '@storybook/react'
import { Select } from './Select'

const carriers = [
  { value: 'sun_life',   label: 'Sun Life' },
  { value: 'manulife',   label: 'Manulife' },
  { value: 'canada_life', label: 'Canada Life' },
  { value: 'green_shield', label: 'Green Shield' },
  { value: 'rbc',        label: 'RBC Insurance' },
  { value: 'telus',      label: 'TELUS Adjudicare' },
]

const meta: Meta<typeof Select> = {
  title: 'Base/Select',
  component: Select,
  tags: ['autodocs'],
  args: { label: 'Carrier', options: carriers, placeholder: 'Select a carrier…' },
}
export default meta
type Story = StoryObj<typeof Select>

export const Default: Story   = {}
export const WithError: Story = { args: { error: 'Please select a carrier.' } }
export const WithHint: Story  = { args: { hint: 'Choose the primary insurance carrier.' } }
export const Disabled: Story  = { args: { disabled: true } }
export const Required: Story  = { args: { required: true } }
