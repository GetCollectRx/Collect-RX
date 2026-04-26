import type { Meta, StoryObj } from '@storybook/react'
import { ToastProvider, useToast } from './Toast'
import { Button } from './Button'

const meta: Meta = {
  title: 'Base/Toast',
  decorators: [
    Story => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
  tags: ['autodocs'],
}
export default meta

function ToastDemo({ variant }: { variant: 'success' | 'warning' | 'error' | 'info' }) {
  const { toast } = useToast()
  const labels: Record<string, string> = {
    success: 'Claim approved',
    warning: 'Missing information',
    error:   'Submission failed',
    info:    'Sync in progress',
  }
  const descriptions: Record<string, string> = {
    success: 'Balance #1234 has been marked as paid.',
    warning: 'Patient DOB is missing from claim #5678.',
    error:   'Could not connect to Sun Life. Retrying…',
    info:    'Importing 42 claims from AbelDent…',
  }
  return (
    <Button
      variant={variant === 'error' ? 'danger' : variant === 'success' ? 'success' : 'secondary'}
      onClick={() =>
        toast({ variant, title: labels[variant], description: descriptions[variant] })
      }
    >
      Show {variant} toast
    </Button>
  )
}

export const Success: StoryObj = { render: () => <ToastDemo variant="success" /> }
export const Warning: StoryObj = { render: () => <ToastDemo variant="warning" /> }
export const Error:   StoryObj = { render: () => <ToastDemo variant="error" /> }
export const Info:    StoryObj = { render: () => <ToastDemo variant="info" /> }

export const AllToasts: StoryObj = {
  render: () => {
    const { toast } = useToast()
    return (
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="success" onClick={() => toast({ variant: 'success', title: 'Claim approved', description: 'Balance #1234 marked paid.' })}>
          Success
        </Button>
        <Button variant="secondary" onClick={() => toast({ variant: 'warning', title: 'Missing info', description: 'Patient DOB missing.' })}>
          Warning
        </Button>
        <Button variant="danger" onClick={() => toast({ variant: 'error', title: 'Failed', description: 'Could not connect to carrier.' })}>
          Error
        </Button>
        <Button variant="ghost" onClick={() => toast({ variant: 'info', title: 'Syncing', description: 'Importing from AbelDent…' })}>
          Info
        </Button>
        <Button variant="secondary" onClick={() => toast({ variant: 'success', title: 'Sticky toast', duration: 0 })}>
          Sticky (no auto-dismiss)
        </Button>
      </div>
    )
  },
}
