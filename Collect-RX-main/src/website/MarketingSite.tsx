import LandingPage from '../pages/LandingPage'
import { usePublicPortalTheme } from './usePublicPortalTheme'

/** Public marketing shell — theme + landing page driven by URL path. */
export default function MarketingSite() {
  usePublicPortalTheme()
  return <LandingPage />
}
