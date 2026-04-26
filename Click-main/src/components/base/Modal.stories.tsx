import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

const meta: Meta<typeof Modal> = {
  title: 'Layout/Modal',
  component: Modal,
  tags: ['autodocs'],
}
export default meta

function Demo({ title, description, size, persistent }: {
  title?: string; description?: string; size?: 'sm'|'md'|'lg'; persistent?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open modal</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        size={size}
        persistent={persistent}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setOpen(false)}>Confirm</Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          This is the modal body. It can contain forms, details, or any other content.
        </p>
      </Modal>
    </>
  )
}

export const Default: StoryObj = { render: () => <Demo title="Confirm action" description="This cannot be undone." /> }
export const Small: StoryObj  = { render: () => <Demo title="Delete claim" size="sm" /> }
export const Large: StoryObj  = { render: () => <Demo title="Claim details" size="lg" /> }
export const Persistent: StoryObj = { render: () => <Demo title="Required step" persistent /> }
