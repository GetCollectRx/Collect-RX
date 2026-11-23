/**
 * Repeats a short beep until the returned stop function is called.
 *
 * Browsers only allow audio after the person has interacted with the page, so
 * on a screen nobody has touched yet the beep may be refused. That is
 * deliberately swallowed: the banner and the flashing tab title still show.
 */
export function startAlertTone(intervalMs = 2500): () => void {
  const AudioCtor: typeof AudioContext | undefined =
    typeof window !== 'undefined' ? window.AudioContext : undefined
  if (!AudioCtor) return () => undefined

  let context: AudioContext | null = null
  function beep(Ctor: typeof AudioContext) {
    try {
      context = context ?? new Ctor()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 880
      gain.gain.value = 0.2
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.35)
    } catch {
      // Audio refused or unavailable; the visual alert carries on.
    }
  }

  beep(AudioCtor)
  const timer = setInterval(() => beep(AudioCtor), intervalMs)
  return () => {
    clearInterval(timer)
    void context?.close().catch(() => undefined)
  }
}
