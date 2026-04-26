import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { ListItem } from './ListItem'

const meta: Meta = { title: 'Layout/BottomSheet', tags: ['autodocs'] }
export default meta

function Demo({ title, height }: { title?: string; height?: 'auto'|'half'|'full' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open bottom sheet</Button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={title} height={height}
        footer={<Button fullWidth onClick={() => setOpen(false)}>Done</Button>}
      >
        <div className="space-y-1">
          {['Sun Life', 'Manulife', 'Canada Life', 'Green Shield', 'RBC'].map(name => (
            <ListItem key={name} title={name} subtitle="Insurance carrier" chevron onClick={() => setOpen(false)} />
          ))}
        </div>
      </BottomSheet>
    </>
  )
}

export const Default: StoryObj = { render: () => <Demo title="Select carrier" /> }
export const HalfHeight: StoryObj = { render: () => <Demo title="Actions" height="half" /> }
export const NoTitle: StoryObj = { render: () => <Demo /> }
