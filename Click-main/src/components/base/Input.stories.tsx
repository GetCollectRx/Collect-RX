import type { Meta, StoryObj } from '@storybook/react'
import { Input } from './Input'

const meta: Meta<typeof Input> = {
  title: 'Base/Input',
  component: Input,
  tags: ['autodocs'],
  args: { label: 'Label', placeholder: 'Placeholder…' },
}
export default meta
type Story = StoryObj<typeof Input>

export const Default: Story  = {}
export const WithHint: Story = { args: { hint: "We'll never share your email." } }
export const WithError: Story = { args: { label: 'Email', value: 'bad@', error: 'Enter a valid email address.', readOnly: true } }
export const Disabled: Story  = { args: { disabled: true, value: 'Disabled value' } }
export const Required: Story  = { args: { required: true } }
export const Password: Story  = { args: { label: 'Password', type: 'password', placeholder: '••••••••' } }
export const WithLeftAddon: Story = {
  args: {
    label: 'Search',
    leftAddon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
      </svg>
    ),
    placeholder: 'Search claims…',
  },
}
