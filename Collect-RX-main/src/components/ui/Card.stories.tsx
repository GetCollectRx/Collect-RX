import type { Meta } from '@storybook/react'
import { Card, CardHeader, Divider } from './Card'
import { Button } from './Button'

export default { title: 'UI/Card', tags: ['autodocs'] } satisfies Meta

export const Default = () => (
  <div className="p-6 max-w-sm bg-gray-50">
    <Card>
      <CardHeader title="A/R Aging" subtitle="By days outstanding" action={<Button size="xs" variant="ghost">Export</Button>} />
      <Divider />
      <p className="text-sm text-gray-500 mt-3">Card body content goes here.</p>
    </Card>
  </div>
)

export const DarkMode = () => (
  <div className="dark p-6 max-w-sm bg-gray-950">
    <Card>
      <CardHeader title="A/R Aging" subtitle="Dark mode variant" />
      <p className="text-sm text-gray-400 mt-3">Dark mode card body.</p>
    </Card>
  </div>
)
