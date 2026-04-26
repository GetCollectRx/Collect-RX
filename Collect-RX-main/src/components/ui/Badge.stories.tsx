import type { Meta, StoryObj } from '@storybook/react'
import { Badge, StageBadge } from './Badge'

const meta: Meta<typeof Badge> = {
  title:     'UI/Badge',
  component: Badge,
  tags:      ['autodocs'],
}
export default meta
type Story = StoryObj<typeof Badge>

export const AllColors: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 p-4">
      {(['green','amber','red','blue','purple','indigo','gray'] as const).map(c => (
        <Badge key={c} color={c} dot>{c}</Badge>
      ))}
    </div>
  ),
}

export const Stages: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 p-4">
      {['CREATED','NOTIFIED','REMINDER_1','REMINDER_2','ESCALATED','STAFF_REVIEW','CLOSED'].map(s => (
        <StageBadge key={s} stage={s} />
      ))}
    </div>
  ),
}
