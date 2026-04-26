import type { Meta, StoryObj } from '@storybook/react'
import { EmptyState, NoClaims, NoResults } from './EmptyState'
import { Button } from './Button'

const meta: Meta<typeof EmptyState> = {
  title: 'Data/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
}
export default meta

const FileIcon = () => (
  <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
)

export const Default: StoryObj = {
  render: () => (
    <EmptyState
      icon={<FileIcon />}
      title="No claims yet"
      description="Claims imported from AbelDent will appear here."
      action={<Button variant="primary">Import claims</Button>}
      secondaryAction={<Button variant="ghost">Learn more</Button>}
    />
  ),
}
export const Compact: StoryObj = {
  render: () => (
    <EmptyState
      icon={<FileIcon />}
      title="No results"
      description="Try a different filter."
      compact
    />
  ),
}
export const NoIcon: StoryObj = {
  render: () => (
    <EmptyState title="No activity" description="Nothing happened in this period." />
  ),
}
export const PrebuiltNoClaims: StoryObj = {
  render: () => <NoClaims onImport={() => alert('Import!')} />,
}
export const PrebuiltNoResults: StoryObj = {
  render: () => <NoResults onReset={() => alert('Reset!')} />,
}
