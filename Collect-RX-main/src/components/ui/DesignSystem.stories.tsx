import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'
import { Badge } from './Badge'
import { Card, CardHeader } from './Card'
import { StatTile } from './StatTile'

const meta: Meta = {
  title: 'Design system / Overview',
  parameters: {
    layout: 'fullscreen',
  },
}

export default meta

type Story = StoryObj

export const TokensAndPrimitives: Story = {
  render: () => (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-crx-50/30 dark:from-gray-950 dark:to-crx-950/20 p-8 font-sans text-gray-900 dark:text-gray-100">
      <div className="max-w-4xl mx-auto space-y-8">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">CollectRx design system</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Source of truth: <code className="text-xs bg-white/80 dark:bg-gray-900/80 px-1 rounded">tailwind.config.ts</code>
            {' · '}Primary <span className="text-crx-600 dark:text-crx-400 font-semibold">#0F6E56</span>
          </p>
        </header>
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile label="Open AR" value="$128k" sub="Insurance" />
          <StatTile label="Calls today" value="12" sub="Vapi" />
          <StatTile label="Resolved" value="5" sub="This week" />
        </section>
        <section className="flex flex-wrap gap-2">
          <Badge color="gray">Default</Badge>
          <Badge color="green">Paid</Badge>
          <Badge color="amber">Pending</Badge>
          <Badge color="red">Blocked</Badge>
        </section>
        <section className="flex gap-2">
          <Button variant="primary" size="sm">Primary</Button>
          <Button variant="secondary" size="sm">Secondary</Button>
        </section>
        <Card>
          <CardHeader title="Card" subtitle="Shadow + radius tokens" />
          <div className="px-4 pb-4 text-sm text-gray-600 dark:text-gray-400">
            Use shared primitives on every screen for a consistent $500/mo SaaS feel.
          </div>
        </Card>
      </div>
    </div>
  ),
}
