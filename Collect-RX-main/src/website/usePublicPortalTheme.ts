import { useEffect } from 'react'
import { useTheme } from '../context/ThemeContext'

/** Login and other public Tailwind pages: light card on cream (not dark gray). */
export function usePublicPortalTheme() {
  const { setTheme } = useTheme()
  useEffect(() => {
    setTheme('light')
  }, [setTheme])
}
