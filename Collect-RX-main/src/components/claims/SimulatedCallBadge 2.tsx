import { isDemoVapiCall } from '../../lib/recoveryDisplay'

export { isDemoVapiCall }

/** Shown when a call attempt uses a demo VAPI id (seed / walkthrough data). */
export function SimulatedCallBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border border-dashed border-gray-400/60 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 dark:border-gray-500 dark:bg-gray-800/60 dark:text-gray-300 ${className}`.trim()}
      title="This call is simulated demo data. Connect VAPI for live carrier calls."
    >
      Simulated call
    </span>
  )
}
