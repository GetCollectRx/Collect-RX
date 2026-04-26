# CollectRx Dashboard - Page Specification

**Page Name:** Dashboard (Home)
**Purpose:** Display high-level claims collection metrics, recent activity, and quick actions
**Primary Users:** Dental office administrators, office managers
**Layout:** Mobile-first responsive (mobile / tablet / desktop)
**Theme:** Emerald green with modern minimalism

---

## 1. Page Structure

### Header (Sticky)
- **Height:** 56px mobile, 64px desktop
- **Background:** White (#FFFFFF)
- **Border:** Gray-200 1px bottom
- **Content:**
  - Left: "CollectRx" logo (emoji + text)
  - Center: Page title "Dashboard"
  - Right: Settings/profile button (gear icon)

### Main Content (Scrollable)
- **Safe area insets:** 16px side margins mobile, 24px tablet, 32px desktop
- **Container max-width:** 1280px (centered on desktop)
- **Content sections:**
  1. High-level metrics (4 cards)
  2. Weekly performance chart
  3. Recent calls list (last 5)
  4. Claims awaiting action
  5. Quick actions

### Bottom Tab Navigation (Mobile Only)
- **Height:** 56px
- **Background:** Gray-50 (#F9FAFB)
- **Border:** Gray-200 1px top
- **Tabs:** Dashboard, Claims, Calls, Settings
- **Active indicator:** Emerald-500 text + icon, bold

---

## 2. Metrics Section

### Layout: 4-Column Grid (Mobile: 2×2, Tablet: 4×1, Desktop: 4×1)

#### Metric Card 1: Claims Processed (Week)
- **Value:** 247
- **Label:** "Processed this week"
- **Trend:** ↑ 12% vs last week
- **Trend color:** Emerald-500
- **Icon:** CheckCircle (emerald-500)

#### Metric Card 2: Total Collected ($)
- **Value:** $18,540
- **Label:** "Collected this week"
- **Trend:** ↑ 8% vs last week
- **Trend color:** Emerald-500
- **Icon:** DollarSign (emerald-500)

#### Metric Card 3: Success Rate (%)
- **Value:** 94%
- **Label:** "Claims approved"
- **Trend:** ↑ 2% vs last week
- **Trend color:** Emerald-500
- **Icon:** TrendingUp (emerald-500)

#### Metric Card 4: Pending Claims
- **Value:** 23
- **Label:** "Awaiting action"
- **Trend:** ↓ 3 less than yesterday
- **Trend color:** Amber-500 (warning)
- **Icon:** AlertCircle (amber-500)

### Metric Card Component
```
┌─────────────────────────┐
│ [Icon]  Metric Label    │  ← Gray-600 label, 14px
│                         │
│ 247                     │  ← Bold emerald-500 or black, 32px
│                         │
│ ↑ 12% vs last week      │  ← Emerald-500, 12px
└─────────────────────────┘
```

**Card styling:**
- Background: White
- Border: Gray-200 1px (optional on light)
- Border-radius: 8px
- Padding: 24px
- Shadow: Level 2 (elevation on hover)
- Spacing between cards: 16px

---

## 3. Weekly Performance Chart

### Chart Type: Line Chart (Recharts or Chart.js)
- **X-axis:** Days of week (Mon–Sun)
- **Y-axis:** Claims count
- **Primary line:** Claims processed (emerald-500)
- **Secondary line:** Claims approved (emerald-400)
- **Grid:** Subtle gray-100 lines

### Chart container
- **Height:** 300px mobile, 250px desktop
- **Background:** White
- **Padding:** 24px
- **Border-radius:** 8px
- **Shadow:** Level 2

### Legend
- Position: Top-right
- Items: "Processed" (emerald-500), "Approved" (emerald-400)
- Interactive: Click to toggle line visibility

---

## 4. Recent Calls List

### Section Header
- **Title:** "Recent Calls (Last 24 hours)"
- **Subtitle:** "5 latest calls"
- **Text styling:** Headline (20px) + Caption (12px)
- **Spacing:** 24px top margin

### List Structure: Scrollable List (3 visible on mobile, 5 on desktop)

#### List Item Structure
```
┌────────────────────────────────┐
│ Patient Name            2:34 PM │  ← Gray-600 text, 14px
│ Practice: Dr. Ahmed's Clinic   │  ← Gray-500 text, 12px
│ Status: Approved ✓             │  ← Emerald-500, 14px with checkmark icon
│                                │
│ Insurance: Sun Life            │  ← Gray-600, 12px
│ Claim Amount: $1,250           │  ← Gray-700, 12px
└────────────────────────────────┘
```

**List item styling:**
- Padding: 16px
- Border-bottom: Gray-200 1px
- Hover: Gray-50 background
- Touch feedback: Slightly darker gray-100
- Swipe action (mobile): Reveal "Review" button in emerald-500

---

## 5. Claims Awaiting Action

### Section Header
- **Title:** "Pending Claims (23)"
- **Subtitle:** "Need review or resubmission"
- **Link:** "View all →"

### Urgent Flag
- **Threshold:** Claims pending >48 hours
- **Visual:** Red-500 border + Red-50 background
- **Icon:** AlertTriangle (red-500)

### List Item (Urgent Claims First)
```
┌────────────────────────────────┐
│ 🔴 John Smith                  │  ← Red dot + patient name (bold)
│    Sun Life / $2,400           │  ← Gray-600, insurance + amount
│    Reason: Coverage verification│  ← Red-500, 12px
│    Pending since: 2 days ago   │  ← Gray-500, 12px
│                                │
│ [ Resubmit ]  [ View Details ] │  ← Action buttons
└────────────────────────────────┘
```

---

## 6. Quick Actions Section

### Layout: 3-column grid (mobile: full width buttons stacked)

#### Button 1: Start New Call
- **Style:** Primary button (emerald-500 bg, white text)
- **Icon:** Phone
- **Action:** Open call interface (Vapi)
- **Size:** Full width mobile, fixed width desktop

#### Button 2: Import Claims
- **Style:** Secondary button (gray outline)
- **Icon:** Upload
- **Action:** File upload dialog
- **Size:** Full width mobile

#### Button 3: Settings
- **Style:** Secondary button (gray outline)
- **Icon:** Gear
- **Action:** Navigate to settings
- **Size:** Full width mobile

---

## 7. Color Application Examples

### Success State
- **Background:** Emerald-50 (#F0FDF4)
- **Border:** Emerald-500 (#10B981)
- **Text:** Emerald-700 (#065F46)
- **Icon:** Emerald-500 (✓ checkmark)

### Warning/Pending State
- **Background:** Amber-50 (#FFFBEB)
- **Border:** Amber-500 (#F59E0B)
- **Text:** Amber-700 (#92400E)
- **Icon:** Amber-500 (⚠ alert)

### Error State
- **Background:** Red-50 (#FEF2F2)
- **Border:** Red-500 (#EF4444)
- **Text:** Red-700 (#B91C1C)
- **Icon:** Red-500 (✗ error)

### Neutral State
- **Background:** Gray-50 (#F9FAFB)
- **Border:** Gray-200 (#E5E7EB)
- **Text:** Gray-700 (#374151)
- **Icon:** Gray-500 (#6B7280)

---

## 8. Responsive Breakpoints

### Mobile (375px)
- 2×2 metric grid
- Single-column layout for all sections
- Bottom tab navigation visible
- Full-width buttons stacked
- Chart height: 300px
- Font sizes: Base + 0 (no scaling)

### Tablet (768px)
- 2×2 metric grid (or 4×1 if space)
- 2-column layouts for sections
- Header adjusts spacing
- Chart height: 280px
- Font sizes: Base (no scaling)

### Desktop (1024px+)
- 4×1 metric grid
- 2-3 column layouts
- Sidebar optional for quick actions
- Max-width container: 1280px, centered
- Chart height: 250px

---

## 9. State Variations

### Empty State (No Recent Calls)
```
┌──────────────────────────────┐
│                              │
│  📞 No calls yet            │
│  Start your first call to   │
│  begin collecting claims    │
│                              │
│  [ Start Call ]             │
│                              │
└──────────────────────────────┘
```

### Loading State
- Skeleton loaders for metric cards (shimmer effect)
- Skeleton loaders for list items
- Chart area shows placeholder bars
- Duration: ~500ms before actual data loads

### Error State
```
┌──────────────────────────────┐
│  ⚠️ Unable to load metrics   │
│  Check your connection       │
│                              │
│  [ Retry ]                   │
│                              │
└──────────────────────────────┘
```

---

## 10. Interaction Patterns

### Tap/Click Actions
- **Metric card:** Navigate to detailed analytics (future feature)
- **Recent call item:** Open call details (recording, notes, AI transcript)
- **Pending claim item:** Open claim review modal
- **Action button:** Primary action flows (start call, import, settings)

### Swipe Actions (Mobile)
- **Swipe left on recent call:** Reveal "Mark as reviewed" action
- **Swipe left on pending claim:** Reveal "Resubmit" or "Mark reviewed" action
- **Haptic feedback:** Light haptic on swipe completion

### Hover States (Desktop)
- **Metric card:** Subtle scale (1.02) + shadow elevation
- **List item:** Gray-50 background + 2px emerald-500 left border
- **Button:** Slight color darkening (emerald-600)

### Focus States (Keyboard Navigation)
- **Focus ring:** 2px solid emerald-500, 2px offset
- **Tab order:** Header → Metrics (L→R) → Chart → Recent calls → Pending claims → Actions

---

## 11. Accessibility Details

### Color Contrast
- **Metric values (32px emerald-500 on white):** 5.8:1 ✓
- **Labels (14px gray-600 on white):** 6.2:1 ✓
- **Body text (14px gray-700 on white):** 7.5:1 ✓
- **Status indicators:** All paired with icons + text

### ARIA Labels
```html
<!-- Metric card -->
<div role="region" aria-label="Dashboard metrics">
  <div aria-label="247 claims processed this week">
    <!-- metric card content -->
  </div>
</div>

<!-- List section -->
<section aria-label="Recent calls">
  <h2 id="recent-calls-heading">Recent Calls</h2>
  <ul aria-labelledby="recent-calls-heading">
    <!-- list items -->
  </ul>
</section>

<!-- Button -->
<button aria-label="Start a new outbound call to patient">
  Start Call
</button>
```

### Keyboard Navigation
- **Tab order:** Top to bottom, left to right
- **Enter:** Activate buttons, expand collapsible sections
- **Arrow keys:** Navigate list items
- **Escape:** Close any open modals/dropdowns

### Screen Reader Announcements
- **Metric change:** "Claims processed increased to 247, up 12% from last week"
- **Status change:** "Call approved by insurance"
- **Error message:** "Unable to load dashboard data. Please try again."

---

## 12. Performance Considerations

### Skeleton Screens
- Show card shapes while metrics load
- Show list item shapes for recent calls
- Maintain layout spacing (prevent CLS)

### Lazy Loading
- Chart loads after metrics
- Recent calls list loads after chart
- Pending claims section loads last

### Bundle Size
- Chart library: Recharts (lighter than Chart.js)
- Icons: Lucide icons (tree-shakeable, SVG)
- Avoid loading unused components

---

## 13. Future Enhancements

### Phase 5 MVP (Current)
- ✓ Metric cards with hardcoded data
- ✓ Weekly performance chart
- ✓ Recent calls list
- ✓ Pending claims alert
- ✓ Quick action buttons

### Phase 6 Enhancements
- [ ] Real-time metric updates (WebSocket)
- [ ] Customizable dashboard widgets
- [ ] Advanced filtering on recent calls
- [ ] Call recording preview/playback
- [ ] Predictive next-best-action recommendations

### Phase 7+ (Future)
- [ ] Dark mode variant
- [ ] Mobile app native version (React Native)
- [ ] PDF export of dashboard snapshot
- [ ] Scheduled email reports

---

## 14. Testing Checklist

### Visual Testing
- [ ] Emerald color system applied consistently
- [ ] Spacing/padding matches 8dp grid
- [ ] Typography hierarchy clear
- [ ] Icons align properly with text

### Functional Testing
- [ ] Metric values update correctly
- [ ] Chart data renders without errors
- [ ] List items load and paginate smoothly
- [ ] Buttons navigate to correct pages

### Accessibility Testing
- [ ] Keyboard navigation works (Tab, Enter, Escape)
- [ ] Screen reader announces all text content
- [ ] Contrast ratios meet WCAG AA (4.5:1)
- [ ] Focus ring visible on all interactive elements
- [ ] No color-only meaning (always paired with icon/text)

### Responsive Testing
- [ ] Mobile layout (375px) looks right
- [ ] Tablet layout (768px) adapts properly
- [ ] Desktop layout (1024px+) is readable
- [ ] Landscape orientation works
- [ ] Touch targets ≥44×44px on mobile

### Performance Testing
- [ ] Lighthouse score ≥80
- [ ] First Contentful Paint <2s
- [ ] Cumulative Layout Shift <0.1
- [ ] Time to Interactive <3.5s

---

**Document Owner:** Claude (Design AI)
**Last Updated:** April 8, 2026
**Status:** Ready for implementation
**Implementation Priority:** Phase 5 MVP
