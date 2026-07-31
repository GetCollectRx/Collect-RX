/** Public marketing site routes — each nav tab is its own page (not in-page scroll). */
export const MARKETING_PATHS = {
  home: '/',
  howItWorks: '/how-it-works',
  roi: '/roi',
  pricing: '/pricing',
  features: '/features',
  carriers: '/carriers',
  compliance: '/compliance',
  about: '/about',
  demo: '/demo',
  product: '/product',
  download: '/download',
  resources: '/resources/',
  login: '/login',
  signup: '/signup',
} as const

export type MarketingPageId =
  | 'home'
  | 'how-it-works'
  | 'roi'
  | 'pricing'
  | 'features'
  | 'carriers'
  | 'compliance'
  | 'about'

export const MARKETING_PAGE_PATHS: MarketingPageId[] = [
  'home',
  'how-it-works',
  'roi',
  'pricing',
  'features',
  'carriers',
  'compliance',
  'about',
]

const PATH_TO_PAGE: Record<string, MarketingPageId> = {
  '/': 'home',
  '/landing': 'home',
  [MARKETING_PATHS.howItWorks]: 'how-it-works',
  [MARKETING_PATHS.roi]: 'roi',
  [MARKETING_PATHS.pricing]: 'pricing',
  [MARKETING_PATHS.features]: 'features',
  [MARKETING_PATHS.carriers]: 'carriers',
  [MARKETING_PATHS.compliance]: 'compliance',
  [MARKETING_PATHS.about]: 'about',
}

/** Resolve the active marketing tab from the current URL path. */
export function marketingPageFromPathname(pathname: string): MarketingPageId {
  const path = pathname.replace(/\/+$/, '') || '/'
  return PATH_TO_PAGE[path] ?? 'home'
}

export const MARKETING_PAGE_TITLES: Record<MarketingPageId, string> = {
  home: 'CollectRx: Dental Insurance AR | Stop Leaving Money on the Table',
  'how-it-works': 'How it Works | CollectRx',
  roi: 'ROI Calculator | CollectRx',
  pricing: 'Pricing | CollectRx',
  features: 'Features | CollectRx',
  carriers: 'Carrier Coverage | CollectRx',
  compliance: 'Compliance | CollectRx',
  about: 'About | CollectRx',
}

/** Nav tabs shown in the marketing header (excludes demo — separate product route). */
export const MARKETING_NAV_TABS: { id: MarketingPageId; label: string; path: string }[] = [
  { id: 'how-it-works', label: 'How it Works', path: MARKETING_PATHS.howItWorks },
  { id: 'features', label: 'Features', path: MARKETING_PATHS.features },
  { id: 'pricing', label: 'Pricing', path: MARKETING_PATHS.pricing },
  { id: 'carriers', label: 'Carriers', path: MARKETING_PATHS.carriers },
]
