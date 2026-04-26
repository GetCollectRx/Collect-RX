import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { RadioGroup } from './Radio'

const meta: Meta<typeof RadioGroup> = {
  title: 'Base/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
}
export default meta
type Story = StoryObj<typeof RadioGroup>

const channels = [
  { value: 'email', label: 'Email',  hint: 'Sent to the address on file' },
  { value: 'sms',   label: 'SMS',    hint: 'Sent to the mobile number on file' },
  { value: 'mail',  label: 'Mail',   hint: 'Physical statement mailed out' },
]

export const Default: Story = {
  args: {
    legend: 'Preferred outreach channel',
    name: 'channel',
    options: channels,
  },
}

export const WithError: Story = {
  args: {
    legend: 'Preferred outreach channel',
    name: 'channel-err',
    options: channels,
    error: 'Please select a channel.',
  },
}

export const Disabled: Story = {
  args: {
    legend: 'Preferred outreach channel',
    name: 'channel-dis',
    options: channels,
    disabled: true,
    value: 'email',
  },
}

export const Controlled: Story = {
  render: () => {
    const [val, setVal] = useState('email')
    return (
      <div>
        <RadioGroup
          legend="Preferred channel"
          name="channel-ctrl"
          options={channels}
          value={val}
          onChange={setVal}
        />
        <p style={{ marginTop: 12, fontSize: 13, color: '#5C6B63' }}>Selected: {val}</p>
      </div>
    )
  },
}
