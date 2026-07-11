import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/**
 * Animates toward `target` on a cubic ease-out.
 * `fromPrevious` continues from the last shown value when the target changes
 * (right for live-updating metrics); otherwise each change re-counts from 0
 * (right for one-shot reveal tiles).
 */
export function useCountUp(
  target: number,
  durationMs = 1400,
  enabled = true,
  fromPrevious = false,
): number {
  const reduced = usePrefersReducedMotion()
  const [value, setValue] = useState(reduced ? target : 0)
  const shownRef = useRef(0)

  useEffect(() => {
    if (!enabled) return
    if (reduced) {
      shownRef.current = target
      setValue(target)
      return
    }
    const from = fromPrevious ? shownRef.current : 0
    if (from === target) {
      setValue(target)
      return
    }
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - (1 - t) ** 3
      const v = Math.round(from + (target - from) * eased)
      shownRef.current = v
      setValue(v)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs, reduced, enabled, fromPrevious])

  return value
}
