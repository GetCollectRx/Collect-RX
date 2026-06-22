type MarkProps = {
  size?: number
  className?: string
  /** When true, fills the container (sidebar mark uses currentColor on green tile). */
  inheritColor?: boolean
}

/** Icon-only mark: green circle + C arc (+ optional Rx at larger sizes). */
export function CollectRxLogoMark({ size = 28, className = '', inheritColor = false }: MarkProps) {
  const showRx = size >= 40
  const fill = inheritColor ? 'currentColor' : '#0f9d58'
  const arcStroke = inheritColor ? '#fcfcfa' : '#ffffff'
  const ringStroke = inheritColor ? 'rgba(252,252,250,0.45)' : '#12c96d'

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <circle cx="100" cy="100" r="90" fill={fill} />
      <circle cx="100" cy="100" r="78" fill="none" stroke={ringStroke} strokeWidth="2" opacity="0.55" />
      <path
        d="M100 38 A62 62 0 1 0 100 162"
        fill="none"
        stroke={arcStroke}
        strokeWidth="10"
        strokeLinecap="round"
      />
      {showRx && (
        <text
          x="85"
          y="116"
          fontFamily="Georgia, 'Source Serif 4', serif"
          fontSize="54"
          fontWeight="700"
          fill={arcStroke}
          letterSpacing="-2"
        >
          Rx
        </text>
      )}
    </svg>
  )
}

type LockupProps = {
  suffix?: string
  markSize?: number
  className?: string
}

/** Sidebar / header lockup: mark + CollectRx wordmark. */
export function CollectRxLogoLockup({ suffix, markSize = 28, className = '' }: LockupProps) {
  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      <span className="flex-shrink-0" aria-hidden>
        <CollectRxLogoMark size={markSize} inheritColor />
      </span>
      <span className="crx-sidebar-logo">
        Collect<span>Rx</span>
        {suffix ? <span className="crx-sidebar-logo-suffix">{suffix}</span> : null}
      </span>
    </span>
  )
}

type PortalProps = {
  size?: number
}

export function CollectRxLogoPortal({ size = 48 }: PortalProps) {
  return (
    <div className="crx-portal-logo-mark" aria-hidden>
      <CollectRxLogoMark size={size} />
    </div>
  )
}
