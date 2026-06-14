/** Marketing-site logo mark. Owned by the website track (not the practice app shell). */

type Props = {
  size?: number
  className?: string
}

export function WebsiteLogoMark({ size = 28, className = '' }: Props) {
  const showRx = size >= 40

  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={className} aria-hidden>
      <circle cx="100" cy="100" r="90" fill="#0f9d58" />
      <circle cx="100" cy="100" r="78" fill="none" stroke="#12c96d" strokeWidth="2" opacity="0.55" />
      <path
        d="M100 38 A62 62 0 1 0 100 162"
        fill="none"
        stroke="#ffffff"
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
          fill="#ffffff"
          letterSpacing="-2"
        >
          Rx
        </text>
      )}
    </svg>
  )
}
