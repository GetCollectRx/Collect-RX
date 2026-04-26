import type { Meta } from '@storybook/react'
import { Input, Select } from './Input'

export default { title: 'UI/Inputs', tags: ['autodocs'] } satisfies Meta

export const TextInput = () => (
  <div className="p-6 max-w-xs space-y-4">
    <Input label="Patient Token" placeholder="e.g. pt_a1b2c3" />
    <Input label="Amount" type="number" leading="$" placeholder="0.00" />
    <Input label="With error" error="This field is required." placeholder="…" />
    <Input label="With hint" hint="Enter the code from your insurance card." placeholder="e.g. sun_life" />
  </div>
)

export const SelectInput = () => (
  <div className="p-6 max-w-xs space-y-4">
    <Select label="Stage">
      <option value="">All stages</option>
      <option value="NOTIFIED">Notified</option>
      <option value="ESCALATED">Escalated</option>
    </Select>
  </div>
)
