import type { Meta } from '@storybook/react'
import { BarChart, LineChart, Donut, ProgressBar, Sparkline } from './Chart'

export default { title: 'UI/Charts', tags: ['autodocs'] } satisfies Meta

const agingData = [
  { label: '0–30 d', value: 24000, color: '#0F6E56' },
  { label: '31–60 d', value: 14200, color: '#f59e0b' },
  { label: '> 60 d', value: 9800,  color: '#ef4444' },
]

const weeklyData = [
  { label: 'Apr 1',  value: 3200 },
  { label: 'Apr 8',  value: 5100 },
  { label: 'Apr 15', value: 4400 },
  { label: 'Apr 22', value: 6800 },
  { label: 'Apr 29', value: 7200 },
  { label: 'May 6',  value: 8400 },
]

export const Bars = () => (
  <div className="p-6 bg-white rounded-xl max-w-lg">
    <h3 className="text-sm font-semibold mb-4">A/R by Aging Bucket</h3>
    <BarChart data={agingData} height={140} valueFormatter={v => `$${(v/1000).toFixed(0)}k`} />
  </div>
)

export const Line = () => (
  <div className="p-6 bg-white rounded-xl max-w-lg">
    <h3 className="text-sm font-semibold mb-4">Weekly Revenue Recovered</h3>
    <LineChart data={weeklyData} height={120} valueFormatter={v => `$${(v/1000).toFixed(1)}k`} />
  </div>
)

export const Ring = () => (
  <div className="flex gap-6 p-6">
    <Donut value={78} label="Collection Rate" />
    <Donut value={92} label="Data Confidence" color="#0284c7" />
    <Donut value={45} label="Annual Max Used" color="#f59e0b" />
  </div>
)

export const Bars2 = () => (
  <div className="p-6 bg-white rounded-xl max-w-sm space-y-4">
    <ProgressBar label="0–30 days"  amount="$24,000 (50%)" value={50}  color="#0F6E56" />
    <ProgressBar label="31–60 days" amount="$14,200 (30%)" value={30}  color="#f59e0b" />
    <ProgressBar label="> 60 days"  amount="$9,800 (20%)"  value={20}  color="#ef4444" />
  </div>
)

export const Spark = () => (
  <div className="p-6 flex gap-8">
    <Sparkline data={[3, 5, 2, 8, 6, 9, 7]} />
    <Sparkline data={[9, 7, 5, 3, 4, 2, 1]} color="#ef4444" />
  </div>
)
