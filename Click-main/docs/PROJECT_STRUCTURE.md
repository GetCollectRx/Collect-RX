# CollectRx Project Structure
**Last Updated:** April 8, 2026

## Directory Organization

```
Click-main/
├── docs/                              # Documentation
│   ├── CREDENTIAL_ROTATION.md         # Phase 4: AWS Parameter Store setup
│   ├── phase3/                        # Phase 3 documentation
│   │   └── PHASE3_ARCHITECTURE.md     # Insurance eligibility rules engine specs
│   ├── financial/                     # Financial documents
│   └── PROJECT_STRUCTURE.md           # This file
│
├── src/
│   ├── server/
│   │   ├── awsConfig.ts               # AWS Parameter Store integration (Phase 4)
│   │   ├── index.ts                   # Main Express app
│   │   ├── rulesEngine.ts             # Existing rules system
│   │   ├── messageTemplates.ts        # Email/SMS templates
│   │   ├── seed.ts                    # Database seeding
│   │   │
│   │   ├── eligibility/               # Phase 3: Insurance eligibility engine
│   │   │   ├── services/              # Core business logic
│   │   │   │   ├── estimateCalculator.ts       # Estimate calculation algorithm
│   │   │   │   ├── reconciliationEngine.ts     # EOB analysis & variance detection
│   │   │   │   └── carrierRulesEngine.ts       # Carrier rule evaluation
│   │   │   │
│   │   │   ├── routes/                # Express API endpoints
│   │   │   │   ├── estimates.ts       # POST /api/estimates
│   │   │   │   └── reconciliations.ts # POST /api/reconciliations
│   │   │   │
│   │   │   └── config/                # Configuration data
│   │   │       ├── cdtCodes.ts        # CDT code library & mappings
│   │   │       └── carrierRules.ts    # All 6 carrier rule definitions
│   │   │
│   │   ├── benefits/                  # Benefits calculation (existing)
│   │   ├── patients/                  # Patient data (existing)
│   │   └── stripe/                    # Stripe integration (existing)
│   │
│   ├── components/                    # React components
│   │   └── EstimateCalculator.tsx     # (To be created in Phase 5)
│   │
│   ├── pages/                         # React pages
│   ├── context/                       # React context
│   ├── hooks/                         # React custom hooks
│   ├── utils/                         # Utility functions
│   └── types.ts                       # TypeScript types
│
├── tests/
│   └── eligibility/                   # Phase 3 tests
│       ├── estimateCalculator.test.ts # 30+ test cases
│       ├── carrierRules.test.ts       # Carrier-specific validation
│       └── reconciliation.test.ts     # EOB reconciliation tests
│
├── prisma/
│   ├── schema.prisma                  # Database schema
│   └── migrations/
│       └── add_phase3_tables.sql       # Phase 3 database tables
│
├── config/                            # Configuration
├── electron/                          # Electron desktop app
├── .env.example                       # Environment template (no secrets)
├── .gitignore                         # Git ignore rules
├── package.json                       # Dependencies
├── tsconfig.json                      # TypeScript config
└── README.md                          # Project overview

```

---

## Phase Organization

### ✅ **Phase 1-2: Completed (Core Platform)**
- Desktop shell (Electron)
- Dashboard & navigation
- Patient AR queue
- Vapi voice integration
- Database (PostgreSQL)
- API routes

### 🔨 **Phase 3: In Progress (Insurance Eligibility)**
- **Location:** `src/server/eligibility/`
- **Docs:** `docs/phase3/PHASE3_ARCHITECTURE.md`
- **Tests:** `tests/eligibility/`
- **Duration:** May 15 - June 15, 2026

**Components:**
- Estimate Calculator (`eligibility/services/estimateCalculator.ts`)
- Reconciliation Engine (`eligibility/services/reconciliationEngine.ts`)
- Carrier Rules Engine (`eligibility/services/carrierRulesEngine.ts`)
- API Routes (`eligibility/routes/`)
- Configuration (`eligibility/config/`)

### 🔜 **Phase 4: Production Packaging**
- Windows .exe installer
- Schema discovery with Dr. Hasan
- Credential rotation (✅ completed via Phase 4 docs)

### 🎨 **Phase 5: UI/UX Redesign**
- Dashboard redesign
- Modern medical SaaS aesthetic
- Responsive components

### 🚀 **Phase 6: Pilot Go-Live**
- Launch with Dr. Hasan
- Validation & metrics

---

## File Naming Conventions

### Services
```
src/server/eligibility/services/
├── estimateCalculator.ts           # Core algorithm
├── reconciliationEngine.ts         # EOB analysis
├── carrierRulesEngine.ts          # Rule evaluation
└── (future) preAuthEngine.ts      # Pre-authorization
```

### Routes
```
src/server/eligibility/routes/
├── estimates.ts                    # GET/POST /api/estimates
├── reconciliations.ts              # GET/POST /api/reconciliations
└── (future) preAuth.ts            # /api/preauth
```

### Configuration
```
src/server/eligibility/config/
├── cdtCodes.ts                     # CDT code library
├── carrierRules.ts                 # Carrier configurations
└── (future) cdtPricingTables.ts   # Regional pricing
```

### Tests
```
tests/eligibility/
├── estimateCalculator.test.ts      # 30+ test cases
├── carrierRules.test.ts            # 18 carrier tests
└── reconciliation.test.ts          # EOB matching tests
```

---

## Database Tables (Phase 3)

```
PostgreSQL Schema:
├── cdt_codes
│   ├── id (UUID)
│   ├── code (VARCHAR)              # D1110, D2391, etc.
│   ├── description
│   ├── category                    # Basic, Major, Ortho
│   └── frequency_limit_per_year
│
├── carrier_rules (versioned)
│   ├── id (UUID)
│   ├── carrier_id                  # sun_life, manulife, etc.
│   ├── effective_date
│   ├── deductible_individual_cents
│   ├── annual_maximum_cents
│   ├── coverage_* (preventive, basic, major)
│   ├── config_json (JSONB)         # Complex rules
│   └── version
│
├── estimate_records
│   ├── id (UUID)
│   ├── practice_id
│   ├── patient_id
│   ├── plan_id
│   ├── procedures_json (JSONB)
│   ├── calculation_json (JSONB)
│   ├── insurance_pays_cents
│   ├── patient_pays_cents
│   └── created_at
│
└── reconciliation_records
    ├── id (UUID)
    ├── estimate_id
    ├── eob_date
    ├── eob_json (JSONB)
    ├── variance_json (JSONB)
    ├── discrepancies_json (JSONB)
    └── audit_trail_json (JSONB)
```

---

## Key Files by Responsibility

| Component | Main File | Tests | Config |
|-----------|-----------|-------|--------|
| Estimate Calculation | `services/estimateCalculator.ts` | `tests/eligibility/estimateCalculator.test.ts` | `config/cdtCodes.ts` |
| Carrier Rules | `services/carrierRulesEngine.ts` | `tests/eligibility/carrierRules.test.ts` | `config/carrierRules.ts` |
| EOB Reconciliation | `services/reconciliationEngine.ts` | `tests/eligibility/reconciliation.test.ts` | N/A |
| API Endpoints | `routes/estimates.ts`, `routes/reconciliations.ts` | Integration tests | N/A |

---

## Development Workflow

### Adding a New Feature (Example: Pre-Authorization)

```
1. Create service: src/server/eligibility/services/preAuthEngine.ts
2. Create route:   src/server/eligibility/routes/preAuth.ts
3. Add config:     src/server/eligibility/config/preAuthRules.ts
4. Add tests:      tests/eligibility/preAuth.test.ts
5. Update docs:    docs/phase3/PREAUTH.md
```

### Adding a New Carrier

```
1. Add rules:      src/server/eligibility/config/carrierRules.ts
2. Add tests:      tests/eligibility/carrierRules.test.ts (new test suite)
3. Update schema:  prisma/migrations/*.sql
4. Update docs:    docs/phase3/CARRIERS.md
```

---

## Import Paths

All imports are relative to project root:

```typescript
// Services
import { estimateCalculator } from '@/server/eligibility/services/estimateCalculator'

// Routes
import { estimatesRouter } from '@/server/eligibility/routes/estimates'

// Config
import { carrierRules } from '@/server/eligibility/config/carrierRules'

// Types
import type { EstimateRecord } from '@/types'
```

---

## Documentation Structure

```
docs/
├── PROJECT_STRUCTURE.md              # This file
├── CREDENTIAL_ROTATION.md            # Phase 4 secrets management
├── phase3/
│   ├── PHASE3_ARCHITECTURE.md        # Full Phase 3 specification
│   ├── CARRIERS.md                   # (Future) Detailed carrier rules
│   ├── CDT_CODES.md                  # (Future) CDT code reference
│   └── TEST_PLAN.md                  # (Future) Detailed test strategy
├── financial/                        # Existing financial docs
└── (existing docs)
```

---

## Next Steps

1. ✅ **Organize folder structure** (DONE - April 8)
2. 🔄 **Create Phase 3 database migrations** (Week 1)
3. 🔄 **Seed CDT code library** (Week 1)
4. 🔄 **Implement estimate calculator** (Week 2)
5. 🔄 **Build API routes** (Week 2)
6. 🔄 **Write test suite** (Week 3-4)

---

**Principle:** Keep related code together. Don't dump files in the root. Use the designated folder structure to keep the codebase organized and maintainable as it grows.

