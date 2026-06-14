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
