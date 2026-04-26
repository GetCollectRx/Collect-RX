import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { Header, BackButton } from './Header'
import { Button } from './Button'

const meta: Meta<typeof Header> = {
  title: 'Layout/Header',
  component: Header,
  decorators: [Story => <MemoryRouter><Story /></MemoryRouter>],
  tags: ['autodocs'],
  args: { title: 'Dashboard' },
}
export default meta
type Story = StoryObj<typeof Header>

export const Default: Story = {}
export const WithSubtitle: Story = { args: { subtitle: 'Sunshine Dental Practice' } }
export const WithTrailingAction: Story = {
  args: {
    trailing: <Button size="sm" variant="primary">New Claim</Button>,
  },
}
export const WithBackButton: Story = {
  args: {
    title: 'Balance Detail',
    leading: <BackButton onClick={() => alert('Back!')} />,
    trailing: <Button size="sm" variant="ghost">Export</Button>,
  },
}
export const NotSticky: Story = { args: { sticky: false } }
