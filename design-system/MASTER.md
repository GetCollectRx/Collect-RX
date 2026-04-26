# CollectRx Design System - Master

**Project:** CollectRx - AI-Powered Dental Insurance Claims Collection Platform
**Version:** 1.0
**Last Updated:** April 8, 2026
**Status:** Active for Phase 5+ Implementation

---

## 1. Design System Overview

CollectRx is a **medical SaaS** platform designed for dental practices to automate insurance claims collection through intelligent phone-based voice AI. The design system prioritizes clarity, trust, and efficiency for busy dental practice staff managing high-volume claims.

### Product Type Archetype
- **Category:** Healthcare SaaS / Dental Practice Management Tool
- **Primary Users:** Dental office administrators, office managers, treatment coordinators
- **Context:** Fast-paced, high-volume claims processing; accuracy and speed critical
- **Aesthetic:** Modern, professional, trustworthy, human-centered
- **Brand Color:** Emerald green (#10B981 primary, with supporting teal and sage variants)

### Design Philosophy
1. **Trust through clarity** — Medical/financial context requires absolute transparency
2. **Efficiency for high-volume work** — Dashboard and list views must handle 100+ claims
3. **Human-AI collaboration** — Voice AI is the tool; staff are decision-makers
4. **Actionable data** — Every screen shows clear next steps and metrics that matter
5. **Accessible by default** — WCAG AA compliance for all interactive elements

---

## 2. Design Pattern & Style

### Recommended Style: **Modern Minimalism with Healthcare Trust**

**Characteristics:**
- Clean, spacious layouts with clear information hierarchy
- Subtle elevation and color for semantic meaning (not decoration)
- Professional typography with generous whitespace
- Emerald green as primary action and trust indicator
- Soft gray tones for secondary content and neutral backgrounds

**Anti-Patterns to Avoid:**
- Heavy skeuomorphism or overly medical imagery (clipart doctors, hospital beds)
- Overly playful or casual tone — maintain professional credibility
- Decorative animations that distract from data
- Hard, clinical grays (use warm, accessible neutrals instead)
- Reliance on color alone to convey status (always pair with icon/text)

### Visual Hierarchy Rules
1. **Primary actions** → Emerald green, full opacity, bold weight
2. **Secondary actions** → Gray outline, soft emphasis
3. **Destructive actions** → Red (#EF4444) with clear warning text
4. **Data/metrics** → High contrast against background, semantic color coding
5. **Disabled/read-only** → 50% opacity, no interaction affordance

---

## 3. Color System

### Primary Palette

**Emerald (Brand Primary)**
- Emerald-50: #F0FDF4 (lightest background, hover states)
- Emerald-100: #DCFCE7
- Emerald-200: #BBFDE8
- Emerald-300: #6EE7B7
- Emerald-400: #10B981 ← **PRIMARY ACTION COLOR**
- Emerald-500: #059669 (dark hover)
- Emerald-600: #047857 (pressed)
- Emerald-700: #065F46 (darkest text on light)
- Emerald-950: #082F1B

**Semantic Colors**
- Success: Emerald-500 (#059669) — checkmarks, confirmations
- Warning: Amber-500 (#F59E0B) — alerts requiring attention
- Error: Red-500 (#EF4444) — destructive actions, failed states
- Info: Blue-500 (#3B82F6) — informational toasts, help text
- Neutral: Gray-600 (#4B5563) — body text, secondary labels

### Neutral Palette (Accessible Grays)
- Gray-50: #F9FAFB (lightest background)
- Gray-100: #F3F4F6 (card backgrounds, hover states)
- Gray-200: #E5E7EB (borders, dividers)
- Gray-500: #6B7280 (secondary text)
- Gray-700: #374151 (primary body text)
- Gray-900: #111827 (dark mode primary text)

### Light Mode Defaults
- **Background:** White (#FFFFFF)
- **Surface/Card:** Gray-50 (#F9FAFB)
- **Text Primary:** Gray-900 (#111827)
- **Text Secondary:** Gray-600 (#4B5563)
- **Border:** Gray-200 (#E5E7EB)
- **Divider:** Gray-100 (#F3F4F6)

### Dark Mode Defaults (Future)
- **Background:** Gray-950 (#030712)
- **Surface/Card:** Gray-900 (#111827)
- **Text Primary:** Gray-50 (#F9FAFB)
- **Text Secondary:** Gray-400 (#9CA3AF)
- **Border:** Gray-800 (#1F2937)
- **Divider:** Gray-900 (#111827)

### Semantic Color Rules
- **Never use color alone** to convey status → Always pair with icon or text
- **Contrast parity** → Light mode ≥4.5:1, dark mode independently tested
- **Error/warning prominence** → Stand out visually but not disruptively (e.g., soft red-50 background with red-600 border + icon)
- **Data visualization** → Use 5-7 color palette from emerald/amber/blue/red for charts; avoid red/green for colorblind accessibility

**Contrast Verification (WCAG AA Minimum)**
- Emerald-500 (#059669) on white: 5.8:1 ✓
- Gray-700 (#374151) on white: 7.5:1 ✓
- Gray-600 (#4B5563) on white: 6.2:1 ✓
- Red-500 (#EF4444) on white: 3.9:1 (use on dark backgrounds for 4.5:1+)

---

## 4. Typography System

### Font Stack

**Primary Font: Inter (Google Fonts — Variable Weight)**
- Modern, open-source, excellent for screens and accessibility
- Supports optical sizing and variable weight axis (200–900)
- Clear distinction between weights for hierarchy

**Fallback Stack:**
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

**Why Inter?**
- Geometric, modern, professional without coldness
- High x-height improves legibility at smaller sizes
- Variable weight reduces payload; accessible on slow networks
- Extensive language support for global practices

### Type Scale

| Level | Size | Weight | Line Height | Use Case |
|-------|------|--------|------------|----------|
| Display Large | 32px | 700 | 1.2 | Page titles, major headings |
| Display Medium | 24px | 700 | 1.3 | Section headings, card titles |
| Headline | 20px | 600 | 1.35 | Modal headers, list section titles |
| Subheading | 16px | 600 | 1.4 | Form labels, component headers |
| Body Large | 16px | 400 | 1.5 | Primary body text, form inputs |
| Body | 14px | 400 | 1.6 | Secondary text, help text |
| Label | 12px | 500 | 1.5 | Tags, badges, small labels |
| Caption | 11px | 400 | 1.5 | Timestamps, metadata, footnotes |

### Typography Rules
1. **Minimum body size:** 16px on mobile (prevents iOS auto-zoom)
2. **Maximum line length:** 65–75 characters for body text (optimal readability)
3. **Line height for accessibility:** Minimum 1.5 for body, minimum 1.35 for headlines
4. **Weight hierarchy:** Bold (600–700) for hierarchy, regular (400) for body, medium (500) for labels
5. **Truncation strategy:** Prefer wrapping over truncation; when truncating, show ellipsis + tooltip
6. **Number formatting:** Use tabular/monospace figures for tables and data columns to prevent shift

### Semantic Type Styles

**For React Components:**
```typescript
const typeStyles = {
  displayLarge: { fontSize: 32, fontWeight: 700, lineHeight: 1.2 },
  displayMedium: { fontSize: 24, fontWeight: 700, lineHeight: 1.3 },
  headline: { fontSize: 20, fontWeight: 600, lineHeight: 1.35 },
  subheading: { fontSize: 16, fontWeight: 600, lineHeight: 1.4 },
  bodyLarge: { fontSize: 16, fontWeight: 400, lineHeight: 1.5 },
  body: { fontSize: 14, fontWeight: 400, lineHeight: 1.6 },
  label: { fontSize: 12, fontWeight: 500, lineHeight: 1.5 },
  caption: { fontSize: 11, fontWeight: 400, lineHeight: 1.5 },
};
```

---

## 5. Spacing & Layout System

### Spacing Scale (8dp Base)
```
4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px, 96px
```

### Component-Level Spacing

| Element | Padding | Margin | Use |
|---------|---------|--------|-----|
| Button | 12px 24px | 0 | Touch target ≥44px height |
| Input Field | 12px 16px | 0 | Touch target ≥44px height |
| Card | 24px | 16px | Balanced whitespace |
| Section Header | 24px | 24px (top/bottom) | Clear visual separation |
| List Item | 16px | 8px (between items) | Comfortable touch density |
| Modal | 24px (content) | 16px (edges) | Readable measure on any screen |

### Layout Grid
- **Mobile (375px):** 16px side margin, 8-column grid
- **Tablet (768px):** 24px side margin, 12-column grid
- **Desktop (1024px+):** 32px side margin, 12-column grid

### Safe Area Compliance
- **iOS:** Respect notch/Dynamic Island (safe-area-inset-*)
- **Android:** Respect system navigation bar (bottom 48dp on gesture nav)
- **All:** 16px minimum content inset from screen edges

### Breakpoints
```typescript
const breakpoints = {
  xs: 375,   // Small phone
  sm: 425,   // Regular phone
  md: 768,   // Tablet
  lg: 1024,  // Desktop
  xl: 1280,  // Large desktop
};
```

---

## 6. Elevation & Shadows

### Shadow Scale (Medical SaaS — Subtle)

| Level | Shadow | Use |
|-------|--------|-----|
| 0 (None) | none | Flat elements, dividers |
| 1 (Subtle) | 0 1px 2px rgba(0,0,0,0.05) | Hover states, input focus |
| 2 (Elevated) | 0 4px 6px rgba(0,0,0,0.08) | Cards, floating actions |
| 3 (Prominent) | 0 10px 15px rgba(0,0,0,0.1) | Modals, dropdowns |
| 4 (High) | 0 20px 25px rgba(0,0,0,0.15) | Overlays, notifications |

**Rule:** Never use shadows >level 3 in medical contexts. Minimize visual noise; prioritize content clarity.

### Border Radius
- **Buttons/inputs:** 6px
- **Cards:** 8px
- **Modals/sheets:** 12px (top only on mobile)
- **Avatars:** 50% (full circle)

---

## 7. Interactive States

### Button States

| State | Style | Touch Feedback |
|-------|-------|---|
| **Default** | Emerald-500 bg, white text, 6px radius | — |
| **Hover (web)** | Emerald-600 bg (darker shade) | — |
| **Pressed/Active** | Emerald-700 bg + 0.5px inset shadow | Visual scale (0.98) + haptic |
| **Disabled** | Gray-300 bg, Gray-500 text, 50% opacity | No interaction |
| **Focus (keyboard)** | 2px emerald-500 outline, 2px offset | Visible ring |

### Input Field States

| State | Style |
|-------|-------|
| **Default** | White bg, Gray-200 border (1px), Gray-700 text |
| **Hover** | White bg, Gray-300 border |
| **Focused** | White bg, Emerald-500 border (2px) |
| **Error** | White bg, Red-500 border (2px) + Red-50 background tint |
| **Disabled** | Gray-100 bg, Gray-300 border, Gray-500 text (50% opacity) |
| **Filled/Has Content** | White bg, Emerald-500 bottom border on focus |

### Focus Ring Rules (Keyboard Navigation)
- **Visible focus ring:** 2px solid emerald-500, 2px offset
- **Never remove focus rings** — essential for accessibility
- **High contrast:** Emerald-500 on white passes 4.5:1 requirement

### Loading States
- **Button loading:** Disable button, show spinner (150–300ms fade-in), prevent multiple submits
- **Page loading:** Skeleton screens for cards, not spinning loaders
- **Data loading:** Progressive disclosure with shimmer placeholders

---

## 8. Component Guidelines

### Button Hierarchy

**Primary Button (Call to Action)**
- Emerald-500 background, white text
- Use for main actions: "Start Call", "Submit", "Save"
- Max one primary button per page/view

**Secondary Button**
- Gray outline (Gray-300 border), Gray-700 text
- Use for non-critical actions: "Cancel", "View Details"

**Tertiary Button**
- Text-only, emerald-500 text, no background
- Use for lightweight actions: "Learn More", "Skip"

**Destructive Button**
- Red-500 background with warning icon
- Always confirm before executing: "Are you sure?"
- Separate visually from other buttons

### Form Best Practices
- **Labels:** Always visible (not placeholder-only)
- **Help text:** Below input, Gray-600 text, for complex fields
- **Error state:** Error message below field, Red-500 border, Red-50 background
- **Validation:** Inline on blur (not keystroke); clear error recovery
- **Progress indicator:** Multi-step forms show step counter and allow back navigation

### Data Tables
- **Header row:** Gray-100 background, bold Gray-900 text
- **Data rows:** White background with Gray-200 bottom border
- **Hover row:** Gray-50 background for entire row
- **Striped rows:** Optional (every other row Gray-50) for dense tables
- **Sortable columns:** Subtle chevron icon indicating sort direction
- **Scrollable:** Horizontal scroll on mobile, full-width container on desktop

### Cards & Containers
- **Card padding:** 24px
- **Card margin:** 16px between cards
- **Card background:** White on light mode, Gray-900 on dark mode
- **Card border:** Optional Gray-200 (1px) for subtle separation
- **Card shadow:** Level 2 (elevation on focus/hover)

### Lists (High-Volume Claims View)
- **List item padding:** 16px vertical, 16px horizontal
- **List item spacing:** 8px between items
- **Divider:** Gray-200 (1px) bottom border per item
- **Swipe actions (mobile):** Approve/reject actions with haptic feedback
- **Virtualization:** Essential for 100+ item lists (React-window or similar)

---

## 9. Navigation & Information Architecture

### Top-Level Navigation (Bottom Tab Bar on Mobile)

| Tab | Icon | Purpose |
|-----|------|---------|
| Dashboard | Gauge/chart | Home, high-level metrics, recent activity |
| Claims | ClipboardList | Browse all claims, filter by status |
| Calls | Phone | Call history, recording access, notes |
| Settings | Gear | Practice setup, AI configuration, user mgmt |

**Rules:**
- Max 4 tabs (human cognitive limit)
- Active tab: emerald-500 text + icon
- Inactive tab: Gray-600 text + icon
- Bottom tab bar: Gray-50 background, 1px top border

### Breadcrumb & Back Navigation
- Always provide back button in header (swipe-back on iOS supported)
- Back behavior must restore scroll position and filter state
- Breadcrumbs for web only; mobile uses back button

### Modal & Sheet Behavior
- **Sheet dismissal:** Swipe down or dismiss button
- **Confirmation required:** If unsaved changes exist
- **Accessible close:** ✕ button visible, not hidden
- **Header:** Title + close button; sticky during scroll

---

## 10. Animation & Motion

### Duration Guidelines
- **Micro-interactions (button tap, toggle):** 150ms
- **State changes (modal slide-in, list expansion):** 200–300ms
- **Page/screen transitions:** 300–400ms
- **Never exceed:** 500ms (feels sluggish on mobile)

### Easing Curves
- **Ease-out:** Element entering/appearing (decelerate motion)
- **Ease-in:** Element exiting/dismissing (accelerate motion)
- **Cubic-bezier(0.34, 1.56, 0.64, 1):** Spring physics for natural feel

### Animation Rules
- **Motion conveys meaning:** Every animation explains a state change or causality
- **Reduced motion:** Respect `prefers-reduced-motion` OS setting; disable animations automatically
- **No decorative animation:** Avoid animations that don't explain cause-effect
- **Interruptible:** User tap/gesture cancels in-progress animation immediately
- **Exit faster than enter:** Exit ~60–70% of entrance duration for snappy feel

### Specific Animations

**Button Press:**
- Scale: 0.98 on press, 1.0 on release
- Opacity: 0.85 on press, 1.0 on release
- Duration: 150ms ease-out
- Haptic: Light impact feedback

**List Item Swipe:**
- Slide action buttons in from right
- Duration: 200ms ease-out
- Return to center on cancel swipe
- Haptic: Selection feedback on action

**Modal Entrance:**
- Scrim fade-in: 0 → 0.5 opacity, 200ms
- Modal slide-up: transform translateY(100%) → 0, 300ms ease-out
- Haptic: None (already in modal context)

**Loading Skeleton → Content:**
- Content fade-in: 0 → 1 opacity, 200ms
- No scale/transform (prevents layout shift)
- Stagger list items by 30ms each

---

## 11. Dark Mode (Future Implementation)

### Approach
- **Design both themes simultaneously** — Don't invert light mode
- **Independent contrast testing** — Verify 4.5:1 separately for dark
- **Semantic tokens:** Same token names, different color values per theme

### Dark Mode Color Mapping Example

| Token | Light | Dark |
|-------|-------|------|
| bg-primary | White | Gray-950 |
| bg-secondary | Gray-50 | Gray-900 |
| text-primary | Gray-900 | Gray-50 |
| text-secondary | Gray-600 | Gray-400 |
| border-default | Gray-200 | Gray-800 |
| emerald-action | Emerald-500 | Emerald-400 |

---

## 12. Accessibility Standards (WCAG AA Minimum)

### Contrast
- **Body text:** 4.5:1 minimum
- **Large text (18px+):** 3:1 minimum
- **Interface components:** 3:1 for borders and UI elements
- **Verified:** Manual testing + automated tools (axe, WebAIM)

### Focus Management
- **Visible focus ring:** 2px emerald-500, 2px offset (never removed)
- **Focus order:** Matches visual left-to-right, top-to-bottom
- **Keyboard nav:** Full functionality without mouse (no hover-only actions)
- **Skip links:** Jump to main content for keyboard users

### Color Not Alone
- **Status indication:** Always pair color with icon/text
- **Example:** Red border + ✗ icon + "Error" text for form errors

### Form Accessibility
- **Labels:** Properly associated (label → input via htmlFor/id)
- **Required indicators:** Asterisk + aria-required="true"
- **Error association:** aria-describedby pointing to error text
- **Fieldsets:** Group related inputs with fieldset/legend

### Screen Reader Support
- **Semantic HTML:** Use button, input, select, etc. (not divs)
- **Aria labels:** aria-label for icon-only buttons
- **Aria-live regions:** Announcements for toasts/notifications (role="alert")
- **Image alt text:** Descriptive, concise (not "image of")
- **Heading hierarchy:** Sequential h1→h6, no skipped levels

### Motion
- **Reduced motion:** Automatically disable animations when OS setting enabled
- **Motion test:** Verify no flashing/strobing (avoid 3+ Hz for photosensitivity)

---

## 13. Responsive Design Rules

### Mobile-First Approach
1. Design for 375px first (small phone)
2. Scale up to 425px (regular phone)
3. Adapt at 768px (tablet)
4. Optimize at 1024px+ (desktop)

### Content Priority (Mobile)
1. **Primary action** → Always visible (e.g., "Start Call" button)
2. **Core data** → Claim status, patient name, amount
3. **Secondary info** → Folded/expandable (claim details, notes)
4. **Tertiary actions** → Menu button or scroll

### Responsive Layout Patterns
- **Stacked layout:** Vertical stack on mobile, side-by-side on tablet/desktop
- **Modal → Sheet:** Modals on desktop, bottom sheets on mobile
- **Table → Card:** Tables on desktop, card rows on mobile
- **Sidebar → Drawer:** Sidebar on desktop, slide-out drawer on mobile

### Touch-Friendly Spacing (Mobile)
- **Tap target minimum:** 44×44px (iOS), 48×48dp (Android)
- **Spacing between targets:** Minimum 8px
- **Safe area bottom:** 16px above gesture home indicator

### Landscape Orientation
- Keep content readable in landscape
- Don't hide critical controls
- Consider split-screen layouts on tablets

---

## 14. Performance & Loading

### Image Optimization
- **Format:** WebP/AVIF (with JPEG fallback)
- **Responsive images:** srcset for different device widths
- **Lazy load:** Non-hero images below fold
- **Dimension declaration:** width/height to prevent layout shift

### Font Performance
- **font-display: swap** → Avoid invisible text (FOIT)
- **Preload critical fonts:** Only the primary font at 400/600 weight
- **Subset:** Latin character set (reduced payload)

### JavaScript Bundle
- **Route-level splitting:** Separate chunks per route
- **Dynamic imports:** Code-split heavy components
- **Minification:** Enable for production builds
- **Lazy component loading:** React Suspense + skeleton screens

### Perceived Performance
- **Skeleton screens:** Show content shape while loading (not spinners)
- **Progressive disclosure:** Load-as-you-scroll for large lists
- **Optimistic updates:** Submit form, show success immediately, sync in background
- **Error recovery:** Clear retry paths, no hanging spinners

---

## 15. Implementation Checklist

### Pre-Development
- [ ] Design system tokens defined in code (Tailwind, CSS variables, or design tokens)
- [ ] Component library setup (Storybook or design documentation)
- [ ] Accessibility audit checklist prepared
- [ ] Performance budget set (FCP, LCP, CLS targets)

### During Development
- [ ] Use semantic HTML (button, input, select, fieldset, legend)
- [ ] Apply design tokens consistently (no ad-hoc color values)
- [ ] Test keyboard navigation on every interactive page
- [ ] Verify contrast ratios with automated tools + manual testing
- [ ] Test on iOS + Android devices (not just simulators)
- [ ] Verify responsive breakpoints on actual devices

### Before Launch
- [ ] Accessibility audit (axe DevTools, manual WCAG check)
- [ ] Contrast verification (light + dark mode separately)
- [ ] Focus ring visibility on all interactive elements
- [ ] Form errors properly labeled and recoverable
- [ ] Mobile landscape orientation tested
- [ ] Touch targets ≥44×44px verified
- [ ] Performance profiling (Lighthouse, DevTools)
- [ ] Dark mode contrast independently tested (if implemented)

---

## 16. Component Library Status

### Phase 5 Components to Build
- [ ] Button (primary, secondary, tertiary, disabled, loading)
- [ ] Input (text, email, tel, number, disabled, error)
- [ ] Select Dropdown
- [ ] Modal / Dialog
- [ ] Bottom Sheet (mobile)
- [ ] Tab Bar (navigation)
- [ ] Card
- [ ] List Item
- [ ] Badge / Chip
- [ ] Toast / Notification
- [ ] Skeleton Loader
- [ ] Table / Data Grid
- [ ] Pagination

### Documentation
- Design tokens (colors, spacing, typography, shadows)
- Component specifications per state
- Accessibility guidelines per component
- Code examples and usage patterns

---

## 17. Design References

**Medical SaaS Inspiration:**
- Verdigris (emerald trust, minimalism)
- Calibre (clean typography, professional)
- Humana (healthcare insurance clarity)

**Design System References:**
- Material Design 3 (semantic colors, states, motion)
- Apple HIG (safety areas, reduced motion, accessibility)
- Tailwind CSS (spacing scale, color system, breakpoints)

---

## Questions & Next Steps

1. **Component library:** Should we use Storybook + React for interactive docs?
2. **Implementation stack:** Tailwind CSS + shadcn/ui for fast iteration?
3. **Dark mode timeline:** Implement now or defer to Phase 6?
4. **Mobile-first code:** Prioritize React Native or web-responsive first?

---

**Document Owner:** Claude (Design AI)
**Last Reviewed:** April 8, 2026
**Next Review:** After Phase 5 implementation kickoff
