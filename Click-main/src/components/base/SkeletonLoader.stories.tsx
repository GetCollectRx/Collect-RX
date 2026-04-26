import type { Meta, StoryObj } from '@storybook/react'
import { Skeleton, SkeletonCard, SkeletonListItem, SkeletonTable } from './SkeletonLoader'

const meta: Meta = { title: 'Data/SkeletonLoader', tags: ['autodocs'] }
export default meta

export const TextLines: StoryObj = {
  render: () => (
    <div className="space-y-2 max-w-xs">
      <Skeleton variant="text" />
      <Skeleton variant="text" width="80%" />
      <Skeleton variant="text" width="60%" />
    </div>
  ),
}
export const Avatar: StoryObj = { render: () => <Skeleton variant="avatar" /> }
export const CardPreset: StoryObj = { render: () => <SkeletonCard className="max-w-sm" /> }
export const MultipleCards: StoryObj = {
  render: () => (
    <div className="grid grid-cols-2 gap-3 max-w-lg">
      <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
    </div>
  ),
}
export const ListPreset: StoryObj = {
  render: () => (
    <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
      {[1,2,3,4,5].map(i => <SkeletonListItem key={i} />)}
    </div>
  ),
}
export const TablePreset: StoryObj = { render: () => <SkeletonTable rows={5} cols={4} /> }
