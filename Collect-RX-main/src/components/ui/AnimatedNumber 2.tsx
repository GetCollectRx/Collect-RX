import { useCountUp } from '../../hooks/useCountUp'

interface AnimatedNumberProps {
  value: number
  /** Formatter applied to each frame's value, e.g. an Intl currency formatter. */
  format?: (n: number) => string
  durationMs?: number
}

/** Counting number that continues from the previously shown value on updates. */
export function AnimatedNumber({ value, format, durationMs = 900 }: AnimatedNumberProps) {
  const v = useCountUp(value, durationMs, true, true)
  return <>{format ? format(v) : v.toLocaleString()}</>
}
