/** Public marketing site routes — each nav tab is its own page (not in-page scroll). */
export const MARKETING_PATHS = {
  home: '/',
  howItWorks: '/how-it-works',
  roi: '/roi',
  features: '/features',
  carriers: '/carriers',
  compliance: '/compliance',
  demo: '/demo',
  product: '/product',
  resources: '/resources/',
  login: '/login',
} as const

export type MarketingPageId =
  | 'home'
  | 'how-it-works'
  | 'roi'
  | 'features'
  | 'carriers'
  | 'compliance'

export const MARKETING_PAGE_PATHS: MarketingPageId[] = [
  'home',
  'how-it-works',
  'roi',
  'features',
  'carriers',
  'compliance',
]

const PATH_TO_PAGE: Record<string, MarketingPageId> = {
  '/': 'home',
  '/landing': 'home',
  [MARKETING_PATHS.howItWorks]: 'how-it-works',
  [MARKETING_PATHS.roi]: 'roi',
  [MARKETING_PATHS.features]: 'features',
  [MARKETING_PATHS.carriers]: 'carriers',
  [MARKETING_PATHS.compliance]: 'compliance',
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
  features: 'Features | CollectRx',
  carriers: 'Carrier Coverage | CollectRx',
  compliance: 'Compliance | CollectRx',
}

/** Nav tabs shown in the marketing header (excludes demo — separate product route). */
export const MARKETING_NAV_TABS: { id: MarketingPageId; label: string; path: string }[] = [
  { id: 'how-it-works', label: 'How it Works', path: MARKETING_PATHS.howItWorks },
  { id: 'roi', label: 'ROI Calculator', path: MARKETING_PATHS.roi },
  { id: 'features', label: 'Features', path: MARKETING_PATHS.features },
  { id: 'carriers', label: 'Carriers', path: MARKETING_PATHS.carriers },
  { id: 'compliance', label: 'Compliance', path: MARKETING_PATHS.compliance },
]
