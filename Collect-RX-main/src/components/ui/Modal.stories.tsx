import { useState } from 'react'
import type { Meta } from '@storybook/react'
import { Modal } from './Modal'
import { Button } from './Button'

export default { title: 'UI/Modal', tags: ['autodocs'] } satisfies Meta

export const Default = () => {
  const [open, setOpen] = useState(false)
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Open modal</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Escalate Claim"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setOpen(false)}>Escalate</Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          This claim will be escalated to a human agent immediately. The AI calling queue will be skipped.
        </p>
      </Modal>
    </div>
  )
}
