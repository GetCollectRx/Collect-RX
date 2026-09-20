import markColor from '../../assets/collectrx-mark.png'
import markReversed from '../../assets/collectrx-mark-reversed.png'

/**
 * color    — full-colour shield (for light backgrounds)
 * reversed — white knockout (for dark / coloured backgrounds)
 * adaptive — follows the viewer's OS light/dark theme automatically
 */
type MarkVariant = 'color' | 'reversed' | 'adaptive'

type MarkProps = {
  size?: number
  className?: string
  variant?: MarkVariant
}

/** Brand shield mark. */
export function CollectRxLogoMark({ size = 28, className = '', variant = 'color' }: MarkProps) {
  const style = { display: 'block', objectFit: 'contain' as const }

  if (variant === 'adaptive') {
    return (
      <picture className={className}>
        <source srcSet={markReversed} media="(prefers-color-scheme: dark)" />
        <img src={markColor} width={size} height={size} alt="" aria-hidden style={style} />
      </picture>
    )
  }

  return (
    <img
      src={variant === 'reversed' ? markReversed : markColor}
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden
      style={style}
    />
  )
}

type LockupProps = {
  suffix?: string
  markSize?: number
  className?: string
  variant?: MarkVariant
}

/** Sidebar / header lockup: mark + CollectRx wordmark. */
export function CollectRxLogoLockup({ suffix, markSize = 28, className = '', variant = 'color' }: LockupProps) {
  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      <span className="flex-shrink-0" aria-hidden>
        <CollectRxLogoMark size={markSize} variant={variant} />
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
  variant?: MarkVariant
}

export function CollectRxLogoPortal({ size = 48, variant = 'color' }: PortalProps) {
  return (
    <div className="crx-portal-logo-mark" aria-hidden>
      <CollectRxLogoMark size={size} variant={variant} />
    </div>
  )
}
