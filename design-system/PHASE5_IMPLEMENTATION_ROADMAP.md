# CollectRx Phase 5 - UI/UX Redesign Implementation Roadmap

**Phase:** 5 (UI/UX Redesign Kickoff)
**Duration:** 4–5 weeks
**Status:** Ready for implementation
**Objective:** Redesign CollectRx dashboard and component library with emerald green theme and modern medical SaaS aesthetic

---

## 1. Overview

Phase 5 replaces the existing UI with a cohesive design system based on:
- **Design System:** Emerald green primary color, modern minimalism, healthcare trust
- **Component Library:** 15+ reusable React components with Tailwind CSS
- **Pages Redesigned:** Dashboard (primary), Claims list, Call history, Settings (secondary)
- **Technology:** React + Tailwind CSS + Lucide icons + Recharts
- **Accessibility:** WCAG AA compliance with keyboard nav and screen reader support

---

## 2. Deliverables

### Design Artifacts (Completed)
- ✅ Design System Master (colors, typography, spacing, shadows)
- ✅ Dashboard Page Specification (layout, interactions, responsive)
- ✅ Dashboard React Component (MVP implementation)
- ✅ Implementation Roadmap (this document)

### Phase 5 Implementation Tasks

#### Week 1: Design System Setup & Foundation Components
**Goal:** Establish design tokens, build base components library

**Tasks:**
1. **Tailwind Configuration** (2 hours)
   - Define color tokens (emerald palette, grays, semantic)
   - Define spacing scale (4px–96px)
   - Define typography scale (Inter font)
   - Define breakpoints (xs/sm/md/lg/xl)
   - Export tokens to CSS variables for consistency

2. **Base Components Library** (8 hours)
   - Button (primary, secondary, tertiary, disabled, loading states)
   - Input (text, email, tel, number, disabled, error)
   - Label + form field wrapper
   - Select Dropdown
   - Checkbox + Radio
   - Badge / Chip
   - Toast Notification

   **Storybook Setup** (2 hours)
   - Configure Storybook for React
   - Create story files for each component
   - Document states and props

3. **Documentation** (2 hours)
   - Component usage guidelines
   - Accessibility requirements per component
   - Code examples and best practices

**Deliverables:** `src/frontend/components/base/` with 8+ components, Storybook running locally

#### Week 2: Layout & Container Components
**Goal:** Build page structure and data-display components

**Tasks:**
1. **Layout Components** (6 hours)
   - Header (sticky, with navigation)
   - Footer (if needed)
   - Card container (flexible, with shadow rules)
   - Modal / Dialog
   - Bottom Sheet (mobile)
   - Tab Bar (navigation)

2. **Data Display Components** (6 hours)
   - Table / Data Grid (headers, rows, striped, sortable)
   - List Item (with swipe actions on mobile)
   - Skeleton Loader (shimmer animation)
   - Empty State (illustration + message + CTA)
   - Loading State (spinner alternatives)

3. **Navigation Components** (2 hours)
   - Breadcrumb
   - Navigation tabs
   - Page header with back button

**Deliverables:** `src/frontend/components/layout/` + `src/frontend/components/data/`, all with Storybook stories

#### Week 3: Dashboard Implementation
**Goal:** Build fully-functional dashboard with real data integration

**Tasks:**
1. **Dashboard Layout** (4 hours)
   - Header (sticky)
   - Metrics grid (responsive 2×2 → 4×1)
   - Chart section (Recharts integration)
   - Recent calls section (list)
   - Pending claims section (prioritized list)
   - Quick actions bar

2. **Dashboard Interactivity** (4 hours)
   - Tap/click handlers for list items → detail pages
   - Swipe actions on mobile (mark reviewed, resubmit)
   - Filter/sort for claims (TODO: Phase 6)
   - Notification badges for urgent claims
   - Bottom tab navigation (mobile-only)

3. **Data Integration** (2 hours)
   - Connect to `/api/metrics` for dashboard data
   - Connect to `/api/calls/recent` for recent calls
   - Connect to `/api/claims/pending` for pending claims
   - Error states + loading states + empty states
   - Polling/refresh mechanism (optional: WebSocket for real-time)

4. **Responsive Testing** (2 hours)
   - Test 375px (mobile), 768px (tablet), 1024px+ (desktop)
   - Verify touch targets ≥44px
   - Test landscape orientation
   - Test with actual data (100+ claims)

**Deliverables:** `src/frontend/pages/Dashboard.tsx` (fully functional), API integration complete

#### Week 4: Claims & Calls Pages Redesign
**Goal:** Redesign supporting pages with consistent design system

**Tasks:**
1. **Claims List Page** (6 hours)
   - Redesign with new color system
   - Add filtering (by status, insurance, amount, date)
   - Add sorting (by date, amount, status)
   - Responsive list → table view
   - Swipe actions for quick approval/reject
   - Pagination or infinite scroll

2. **Call History Page** (6 hours)
   - Redesign call list with emerald theme
   - Add call duration, time, status
   - Add call recording preview (play button)
   - Add AI transcript snippet preview
   - Expand/collapse call details
   - Search by patient name / insurance

3. **Settings Page** (2 hours)
   - Basic layout (tabs or sidebar)
   - Practice settings section
   - AI configuration (CRUD)
   - User management (future)
   - Logout

**Deliverables:** `src/frontend/pages/Claims.tsx`, `src/frontend/pages/CallHistory.tsx`, `src/frontend/pages/Settings.tsx`

#### Week 5: Polish, Testing & Optimization
**Goal:** Final refinement, accessibility audit, performance optimization

**Tasks:**
1. **Accessibility Audit** (4 hours)
   - Keyboard navigation (Tab, Enter, Escape, arrows)
   - Screen reader testing (VoiceOver/NVDA)
   - Contrast verification (WCAG AA)
   - Focus ring visibility
   - ARIA labels + roles
   - Form error handling

2. **Performance Optimization** (2 hours)
   - Code splitting by route
   - Image optimization (WebP/AVIF)
   - Font loading (swap strategy)
   - Lighthouse score ≥80
   - Bundle size analysis

3. **Visual Polish** (2 hours)
   - Animation timing refinement (150–300ms)
   - Hover state consistency
   - Loading state smoothness
   - Dark mode prep (if proceeding)

4. **Testing & QA** (4 hours)
   - Manual regression testing (mobile/tablet/desktop)
   - Functional testing (all user flows)
   - Cross-browser testing (Chrome, Safari, Firefox)
   - Device testing (iPhone, Android, iPad)

5. **Documentation** (2 hours)
   - Component API documentation
   - Accessibility guidelines per page
   - Design system update guide
   - Development setup instructions

**Deliverables:** All pages fully polished, accessibility audit passed, Lighthouse ≥80, documentation complete

---

## 3. Technology Stack

### Frontend Framework
- **React 18** with TypeScript
- **React Router v6** for page navigation
- **Tailwind CSS v3** for styling (no component library dependency)

### UI Libraries
- **Lucide Icons** (SVG, tree-shakeable, 20+ icons needed)
- **Recharts** (React charting library, lightweight)
- **Headless UI** (optional, for accessible modals/dropdowns)

### Styling & Design Tokens
- **Tailwind CSS Config** with custom color palette
- **CSS Variables** for emerald color system (fallback for runtime theming)
- **PostCSS** for processing

### Testing & QA
- **Playwright** or **Cypress** for E2E testing
- **Storybook** for component documentation
- **axe DevTools** or **WAVE** for accessibility testing
- **Lighthouse CI** for performance tracking

### Build & Deployment
- **Vite** for fast development build
- **Bun** or **npm** for dependency management
- **GitHub Actions** for CI/CD

---

## 4. File Structure

```
src/frontend/
├── components/
│   ├── base/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   ├── Checkbox.tsx
│   │   ├── Radio.tsx
│   │   ├── Badge.tsx
│   │   ├── Toast.tsx
│   │   └── Label.tsx
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   ├── BottomSheet.tsx
│   │   ├── TabBar.tsx
│   │   └── Breadcrumb.tsx
│   ├── data/
│   │   ├── Table.tsx
│   │   ├── ListItem.tsx
│   │   ├── SkeletonLoader.tsx
│   │   ├── EmptyState.tsx
│   │   └── LoadingState.tsx
│   └── Dashboard.tsx (Week 3)
├── pages/
│   ├── Dashboard.tsx ✅ (Week 3)
│   ├── Claims.tsx (Week 4)
│   ├── CallHistory.tsx (Week 4)
│   ├── Settings.tsx (Week 4)
│   └── DetailPages/ (modals or full pages)
├── hooks/
│   ├── useFetch.ts (data fetching)
│   ├── useMediaQuery.ts (responsive)
│   └── useLocalStorage.ts (persistence)
├── utils/
│   ├── formatters.ts (currency, dates, phone)
│   ├── api.ts (API endpoints)
│   └── constants.ts (app-wide constants)
├── styles/
│   └── tailwind.css (global styles)
├── App.tsx (main router)
└── main.tsx (Vite entry)

design-system/
├── MASTER.md ✅
├── pages/
│   └── dashboard.md ✅
└── components/
    └── [component specs by page]
```

---

## 5. Component Checklist

### Base Components (Week 1)
- [ ] Button (4 variants: primary, secondary, tertiary, destructive)
- [ ] Input (text, email, tel, number, password, disabled, error)
- [ ] Label (with required asterisk)
- [ ] Select/Dropdown
- [ ] Checkbox (standalone + label)
- [ ] Radio (standalone + label)
- [ ] Badge/Chip (multiple sizes, colors)
- [ ] Toast Notification (success, error, info, warning)

### Layout Components (Week 2)
- [ ] Header (sticky, with title + actions)
- [ ] Card (flexible padding, shadow rules)
- [ ] Modal (header, body, footer, close button)
- [ ] Bottom Sheet (mobile-first, swipe-to-dismiss)
- [ ] Tab Bar (navigation, 4 items max)
- [ ] Breadcrumb (with links)

### Data Components (Week 2)
- [ ] Table (headers, rows, striped option, sortable)
- [ ] List Item (card-like, swipe actions on mobile)
- [ ] Skeleton Loader (shimmer animation, configurable shape)
- [ ] Empty State (icon + message + CTA)
- [ ] Loading State (spinner alternative)

### Page Components (Week 3–4)
- [ ] Dashboard (metrics, chart, lists, actions)
- [ ] Claims List (filter, sort, swipe actions)
- [ ] Call History (expandable details, recording preview)
- [ ] Settings (form groups, save/cancel)

---

## 6. Accessibility Checklist

### Color & Contrast
- [ ] All text meets 4.5:1 contrast ratio (WCAG AA)
- [ ] Status never conveyed by color alone (icon + text)
- [ ] Emerald-500 on white: 5.8:1 ✓
- [ ] Gray-700 on white: 7.5:1 ✓

### Keyboard Navigation
- [ ] Tab order matches visual order (left-to-right, top-to-bottom)
- [ ] All interactive elements keyboard-accessible (Enter, Space, Arrow keys)
- [ ] Focus ring visible (2px emerald-500, 2px offset)
- [ ] Escape closes modals/dropdowns
- [ ] No keyboard traps

### Screen Reader Support
- [ ] Semantic HTML (button, input, select, form, fieldset, legend)
- [ ] aria-label for icon-only buttons
- [ ] aria-describedby for form errors and help text
- [ ] aria-live="polite" for toasts/notifications
- [ ] Role="alert" for error messages
- [ ] Image alt text (meaningful, not "image of")
- [ ] Form labels properly associated (htmlFor/id)

### Motion & Animation
- [ ] prefers-reduced-motion respected (disable animations)
- [ ] No flashing or strobing (avoid >3Hz)
- [ ] Animation interruptible (user tap cancels)
- [ ] Loading spinners optional (prefer skeleton screens)

### Touch & Mobile
- [ ] Touch targets ≥44×44px
- [ ] Spacing between targets ≥8px
- [ ] No hover-only interactions
- [ ] Haptic feedback on press (light impact)
- [ ] Swipe actions clearly afforded (chevron, label)

---

## 7. Performance Targets

### Core Web Vitals
- **Largest Contentful Paint (LCP):** <2.5s
- **First Input Delay (FID):** <100ms (FCP in modern metrics)
- **Cumulative Layout Shift (CLS):** <0.1

### Lighthouse Score
- **Target:** ≥80 (Performance, Accessibility, Best Practices, SEO)
- **Performance:** ≥80 (LCP, FID, CLS)
- **Accessibility:** ≥90 (WCAG AA)
- **Best Practices:** ≥85

### Bundle Size
- **Initial JS:** <150KB (gzipped)
- **CSS:** <50KB (gzipped)
- **Total:** <200KB (gzipped, including vendor)

### Runtime Performance
- **Time to Interactive (TTI):** <3.5s
- **Main thread budget:** <16ms per frame (60fps)
- **Re-render time:** <100ms for 100-item list

---

## 8. Testing Strategy

### Unit Testing (Jest + React Testing Library)
- Test each component in isolation
- Coverage target: >80% lines, >75% branches
- Mock API calls for page tests
- Test focus management and keyboard nav

**Example:**
```typescript
// Button.test.tsx
test('Button renders with correct text', () => {
  render(<Button>Click me</Button>);
  expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
});

test('Button is disabled when disabled prop is true', () => {
  render(<Button disabled>Click me</Button>);
  expect(screen.getByRole('button')).toBeDisabled();
});
```

### Integration Testing (Playwright/Cypress)
- Test complete user flows (open → interact → verify)
- Test responsive layouts (mobile/tablet/desktop)
- Test keyboard navigation (Tab, Enter, Escape)
- Test form submission with error/success states

**Example:**
```typescript
// claims.spec.ts
test('User can filter claims by status', async () => {
  await page.goto('/claims');
  await page.click('button[aria-label="Filter"]');
  await page.click('label:has-text("Pending")');
  await expect(page).toHaveURL(/status=pending/);
  // Verify claims list updated
});
```

### Accessibility Testing (axe, Manual WAVE Scanning)
- Automated: axe-core in Playwright tests
- Manual: WAVE browser extension for every page
- Screen reader testing: VoiceOver (Mac) + NVDA (Windows)
- Keyboard navigation: Tab through every page without mouse

### Performance Testing (Lighthouse CI, DevTools)
- Local: `npm run build && npm run serve`
- CI: Lighthouse CI in GitHub Actions
- DevTools: Performance profiler for jank analysis
- Monitors: Real-time monitoring with real user metrics (future)

---

## 9. Rollout & Risk Mitigation

### Phased Rollout
1. **Week 1–2:** Internal testing (team only)
2. **Week 3:** Beta group (10% of practices)
3. **Week 4:** Ramp-up (50% of practices)
4. **Week 5:** Full rollout (100% of practices)

### Feature Flags
- Enable/disable dashboard redesign per practice
- Fallback to old UI if critical bugs detected
- Allow rollback within 24 hours

### Monitoring
- **Error tracking:** Sentry for JS errors
- **Performance:** DataDog RUM for real user metrics
- **Accessibility:** Manual testing per page
- **User feedback:** In-app feedback widget

### Rollback Plan
- If critical accessibility issue: revert to previous UI
- If performance regression: investigate + fix + redeploy
- If user-blocking bug: hotfix + immediate release

---

## 10. Post-Phase 5 Work (Phase 6+)

### Phase 6: Advanced Features (Optional)
- [ ] Dark mode implementation
- [ ] Real-time dashboard updates (WebSocket)
- [ ] Call recording playback + transcript viewer
- [ ] Advanced filtering & saved filters
- [ ] Customizable dashboard widgets
- [ ] PDF export of reports

### Phase 7: Mobile App (Optional)
- [ ] React Native app using same design system
- [ ] Native platform features (push notifications, contacts integration)
- [ ] Offline support

### Phase 8: Analytics & Insights
- [ ] Dashboard analytics (trends, forecasts)
- [ ] Predictive next-best-action recommendations
- [ ] Custom reporting
- [ ] Export to Excel/PDF

---

## 11. Timeline Summary

| Week | Focus | Deliverables | Owner |
|------|-------|--------------|-------|
| 1 | Design system, base components | Tailwind config, 8+ components, Storybook | Claude |
| 2 | Layout & data components | 7+ layout components, 5+ data components | Claude |
| 3 | Dashboard implementation | Fully functional dashboard with API | Claude |
| 4 | Claims & Calls pages | Redesigned pages with interactions | Claude |
| 5 | Polish & testing | Accessibility audit, performance ≥80, docs | Claude |
| **Total** | **5 weeks** | **15+ components, 4 pages, design system** | **Claude** |

---

## 12. Success Criteria

### Design System
- ✅ All colors defined (emerald palette, grays, semantic)
- ✅ Typography scale documented (8 levels)
- ✅ Spacing system implemented (4–96px grid)
- ✅ Component library complete (15+ components)

### Accessibility
- ✅ WCAG AA compliance on all pages
- ✅ Keyboard navigation fully functional
- ✅ Screen reader support working
- ✅ No accessibility audit failures

### Performance
- ✅ Lighthouse ≥80 (all sections)
- ✅ LCP <2.5s, CLS <0.1
- ✅ Initial JS <150KB (gzipped)
- ✅ TTI <3.5s

### User Experience
- ✅ Dashboard loads in <2s
- ✅ 100+ claims render smoothly (no jank)
- ✅ Mobile touch targets ≥44px
- ✅ Landscape orientation supported

### Code Quality
- ✅ TypeScript strict mode
- ✅ Component test coverage >80%
- ✅ No console warnings/errors
- ✅ ESLint + Prettier passing

---

## 13. Questions & Decisions Pending

1. **Should we implement dark mode in Phase 5 or defer to Phase 6?**
   - Recommendation: Defer to Phase 6 (focus on light mode polish first)

2. **Storybook or custom component docs?**
   - Recommendation: Storybook (industry standard, interactive)

3. **Tailwind CSS or CSS-in-JS (styled-components)?**
   - Recommendation: Tailwind CSS (faster development, consistent)

4. **Real-time updates (WebSocket) for dashboard?**
   - Recommendation: Defer to Phase 6 (polling is sufficient for MVP)

5. **React Native mobile app in Phase 7?**
   - Recommendation: Assess after Phase 5 (depends on adoption)

---

**Document Owner:** Claude (Design AI)
**Last Updated:** April 8, 2026
**Status:** Ready for implementation
**Next Step:** Kick off Week 1 (Tailwind setup + base components)
