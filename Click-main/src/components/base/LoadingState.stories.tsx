import type { Meta, StoryObj } from '@storybook/react'
import { LoadingState } from './LoadingState'

const meta: Meta<typeof LoadingState> = {
  title: 'Data/LoadingState',
  component: LoadingState,
  tags: ['autodocs'],
  args: { message: 'Loading…' },
}
export default meta
type Story = StoryObj<typeof LoadingState>

export const Default: Story  = {}
export const CustomMessage: Story = { args: { message: 'Importing claims from AbelDent…' } }
export const Section: Story  = { args: { variant: 'section', message: 'Fetching balances…' } }
