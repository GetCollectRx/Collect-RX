# Phase 3: Insurance Eligibility Rules Engine
## Architecture & Implementation Plan

**Date:** April 8, 2026
**Phase:** 3 (Insurance Eligibility Rules Engine)
**Duration:** ~4 weeks (May 15 - June 15, 2026)
**Target:** Production-ready estimate calculator + reconciliation engine

---

## 🎯 **Phase 3 Goals**

### Primary Objectives
1. **Pre-Treatment Estimate Calculator** — Real-time patient cost estimates before treatment
2. **Post-Insurance Reconciliation Engine** — Automated EOB analysis and variance detection
3. **Canadian Carrier Rule Engine** — Support 6 Canadian insurers with accurate benefit calculations

### Business Impact
- Patients know out-of-pocket costs upfront → Reduces disputes
- Catch billing errors automatically → Improves cash flow
- Accelerates collections process → Revenue impact

---

## 📊 **System Architecture**

```
┌─────────────────────────────────────────────────────────────────┐
│                      CollectRx Frontend                          │
│  (React Component: EstimateCalculator + ReconciliationDashboard) │
└────────────────────┬────────────────────────────────────────────┘
                     │ POST /api/estimates
                     │ POST /api/reconciliations
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express API Routes                            │
│  /api/estimates (CDT code + plan → estimate)                    │
│  /api/reconciliations (EOB data → variance analysis)            │
└────────────────────┬────────────────────────────────────────────┘
                     │
            ┌────────┴────────┐
            ▼                 ▼
    ┌───────────────┐  ┌──────────────────┐
    │ Rules Engine  │  │ Estimate Engine  │
    │ (Carrier      │  │ (Cost logic)     │
    │  configs)     │  │                  │
    └───────┬───────┘  └────────┬─────────┘
            │                   │
            ▼                   ▼
    ┌───────────────────────────────────┐
    │    PostgreSQL Database            │
    │  Tables:                          │
    │  - carrier_rules                  │
    │  - cdt_code_mapping               │
    │  - estimate_history               │
    │  - reconciliation_record          │
    └───────────────────────────────────┘
```

---

## 🏗️ **Core Data Models**

### **1. CDT Code Mapping**
```typescript
interface CDTCodeMapping {
  cdtCode: string;                    // e.g., "D1110" (Prophylaxis - Adult)
  description: string;                // "Adult Cleaning"
  category: string;                   // "Basic" | "Major" | "Ortho" | "Specialty"
  typicalCost: number;                // $100-150
  allowedAmountRange: {
    min: number;
    max: number;
  };
  frequencyLimitPerYear: number;      // e.g., 2 for cleanings
  requiresPreAuth: boolean;
  notes: string;
}

// Common CDT codes by category:
// Basic (Preventive):
//   D1110 - Adult prophy (cleaning)
//   D1120 - Prophylaxis - child
//   D1200 - Intraoral - periodic oral evaluation
//   D1206 - Intraoral - Periodic oral evaluation
// Major (Restorative):
//   D2391 - Resin-based composite crown
//   D2394 - Resin-based composite crown - four or more surfaces
// Endodontics (Major):
//   D3110 - Pulpal debridement, permanent tooth
//   D3310 - Endodontic therapy, treatment of root canal obstruction
// Orthodontics:
//   D8050 - Comprehensive orthodontic treatment
```

### **2. Carrier Rules Configuration**
```typescript
interface CarrierRuleConfig {
  carrierId: string;                  // "sun_life", "manulife", etc.
  carrierName: string;
  effectiveDate: Date;
  expiryDate?: Date;                  // null = current/ongoing

  // Basic plan parameters
  deductible: {
    individual: number;               // $50, $100, $250
    family?: number;
    applied_to: string[];             // ["Basic", "Major", "Ortho"]
  };

  annualMaximum: number;              // $1000, $1500, $2000

  // Coverage by category
  coverage: {
    preventive: number;               // 100% → 1.0
    basic: number;                    // 80% → 0.8
    major: number;                    // 50% → 0.5
    orthodontics: number;             // 50% → 0.5
    implants?: number;
    specialty?: number;
  };

  // Frequency limitations
  frequencyLimits: {
    cleaning: number;                 // cleanings per year: 2
    exams: number;                    // exams per year: 2
    xrays: number;                    // full mouth x-rays per 3 years: 1
    fluoride: number;                 // fluoride per year: 1
  };

  // Alternative benefits (e.g., bridge vs implant)
  alternativeBenefits: {
    rule: string;                     // "choose_lower_benefit"
    examples: {
      implant: "1.5x natural tooth cost max"
    }
  };

  // Missing tooth clause (waiting periods)
  missingToothClause?: {
    waitingPeriodMonths: number;      // 12
    excludeTeeth: string[];           // specific tooth numbers
  };

  // Plan-specific rules
  specialRules: {
    key: string;
    value: string;
  }[];
}

// Example: Sun Life Plan
{
  "carrierId": "sun_life",
  "deductible": { "individual": 50 },
  "annualMaximum": 1200,
  "coverage": {
    "preventive": 1.0,      // 100% coverage, no deductible
    "basic": 0.8,           // 80% after deductible
    "major": 0.5            // 50% after deductible
  },
  "frequencyLimits": {
    "cleaning": 2,
    "exams": 2,
    "xrays": 1              // per 3 years
  }
}
```

### **3. Estimate Record**
```typescript
interface EstimateRecord {
  id: string;                         // UUID
  practiceId: string;
  patientId: string;
  planId: string;

  // Input
  procedures: {
    cdtCode: string;
    description: string;
    cost: number;                     // provider's fee
  }[];

  // Calculation breakdown
  calculation: {
    subtotal: number;
    deductibleApplicable: number;
    deductibleApplied: number;
    deductibleRemaining: number;

    benefitBreakdown: {
      cdtCode: string;
      providerFee: number;
      allowedAmount: number;
      coInsurance: number;            // patient pays
      patientResponsibility: number;
    }[];

    totalBenefitAmount: number;       // insurance pays
    patientResponsibility: number;    // patient pays (after insurance)
    annualMaximumApplied: number;
    annualMaximumRemaining: number;
  };

  // Output
  estimate: {
    insurancePays: number;
    patientPays: number;
    accuracy: number;                 // 0.0-1.0 (confidence score)
  };

  // Metadata
  createdAt: Date;
  validUntil: Date;                   // 30 days default
  assumptions: string[];              // ["Deductible not yet met", "No frequency limit hit"]
  warnings: string[];                 // ["Requires pre-auth", "Missing tooth clause applies"]
}
```

### **4. Reconciliation Record**
```typescript
interface ReconciliationRecord {
  id: string;
  estimateId: string;
  eobDate: Date;

  // EOB Data (from insurance)
  eob: {
    allowedAmount: number;
    deductibleApplied: number;
    coInsuranceAmount: number;
    paidAmount: number;
    denialReason?: string;
  };

  // Variance Analysis
  variance: {
    estimatedVsActual: {
      fieldName: string;
      estimated: number;
      actual: number;
      difference: number;             // negative = less paid than expected
      percentVar: number;
    }[];
  };

  // Flags
  discrepancies: {
    severity: "INFO" | "WARNING" | "ERROR";
    type: string;                     // "coverage_mismatch", "frequency_limit_applied", etc.
    description: string;
  }[];

  // Audit
  auditTrail: {
    timestamp: Date;
    action: string;
    actor: string;
  }[];
}
```

---

## 💡 **Estimate Calculation Algorithm**

### **Core Logic**
```
FUNCTION CalculateEstimate(procedures, plan, patient):

  1. VALIDATE INPUTS
     - cdtCode exists
     - plan is active
     - patient eligibility valid

  2. APPLY DEDUCTIBLE
     deductibleRemaining = plan.deductible
     FOR each procedure:
       IF deductibleRemaining > 0:
         deductibleApplied += MIN(procedure.cost, deductibleRemaining)
         deductibleRemaining -= deductibleApplied

  3. CALCULATE BENEFITS
     FOR each procedure:
       coverageCategory = getCoverageCategory(procedure.cdtCode)
       coInsuranceRate = plan.coverage[coverageCategory]

       benefitAmount = (procedure.cost - deductibleApplied) * coInsuranceRate
       patientResponsibility += procedure.cost - benefitAmount
       totalBenefitAmount += benefitAmount

  4. APPLY ANNUAL MAXIMUM
     IF totalBenefitAmount > plan.annualMaximum:
       overage = totalBenefitAmount - plan.annualMaximum
       totalBenefitAmount = plan.annualMaximum
       patientResponsibility += overage

  5. APPLY FREQUENCY LIMITS
     FOR each procedure:
       IF frequencyLimit exceeded:
         DENY benefit for this procedure
         patientResponsibility += procedure.cost

  6. RETURN ESTIMATE
     {
       insurancePays: totalBenefitAmount,
       patientPays: patientResponsibility,
       breakdown: detailedLineItems
     }
```

---

## 📈 **Database Schema**

### **New Tables**
```sql
-- CDT Code Library
CREATE TABLE cdt_codes (
  id UUID PRIMARY KEY,
  code VARCHAR(10) UNIQUE,
  description TEXT,
  category VARCHAR(50),          -- Basic, Major, Ortho, Specialty
  typical_cost_cents INT,
  frequency_limit_per_year INT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Carrier Rule Sets (versioned)
CREATE TABLE carrier_rules (
  id UUID PRIMARY KEY,
  carrier_id VARCHAR(50),         -- "sun_life", "manulife", etc.
  carrier_name VARCHAR(100),
  effective_date DATE,
  expiry_date DATE,
  deductible_individual_cents INT,
  deductible_family_cents INT,
  annual_maximum_cents INT,
  coverage_preventive DECIMAL(3,2),
  coverage_basic DECIMAL(3,2),
  coverage_major DECIMAL(3,2),
  coverage_ortho DECIMAL(3,2),
  config_json JSONB,              -- Flexible for complex rules
  version INT,
  created_by VARCHAR(100),
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(carrier_id, effective_date)
);

-- Estimate History
CREATE TABLE estimate_records (
  id UUID PRIMARY KEY,
  practice_id UUID REFERENCES practice(id),
  patient_id UUID REFERENCES patient(id),
  plan_id VARCHAR(100),
  procedures_json JSONB,          -- Array of { cdtCode, cost }
  calculation_json JSONB,         -- Full breakdown
  insurance_pays_cents INT,
  patient_pays_cents INT,
  accuracy_score DECIMAL(3,2),
  created_at TIMESTAMP,
  valid_until TIMESTAMP,
  INDEX(practice_id, created_at)
);

-- Reconciliation History
CREATE TABLE reconciliation_records (
  id UUID PRIMARY KEY,
  estimate_id UUID REFERENCES estimate_records(id),
  eob_date DATE,
  eob_json JSONB,                 -- EOB data from insurance
  variance_json JSONB,            -- Variance analysis
  discrepancies_json JSONB,       -- Flags and warnings
  audit_trail_json JSONB,
  created_at TIMESTAMP,
  INDEX(estimate_id, eob_date)
);
```

---

## ✅ **Test Cases (30+)**

### **Category: Basic Estimates**
```
Test 1: Single cleaning (Basic coverage, no deductible)
  Input: D1110 @ $100, Sun Life plan (100% preventive)
  Expected: Insurance pays $100, patient pays $0

Test 2: Cleaning + Exam + Xray (preventive bundle)
  Input: D1110 + D1200 + D0150 @ $100 each, plan covers all 100%
  Expected: Insurance pays $300, patient pays $0

Test 3: Filling with deductible
  Input: D2391 @ $150, Sun Life plan (deductible $50, 80% basic)
  Expected: Insurance pays $80, patient pays $70

Test 4: Multiple procedures crossing categories
  Input: Cleaning ($100) + Filling ($150) + Crown ($800)
  Expected: Correct coverage applied per category
```

### **Category: Edge Cases**
```
Test 5: Deductible not fully met
  Input: Small filling $75, plan deductible $100
  Expected: Deductible reduced by $75, benefit = $0

Test 6: Annual maximum hit
  Input: Multiple expensive procedures totaling $3000 with $1200 max
  Expected: Benefits capped at annual maximum

Test 7: Frequency limit exceeded (2nd cleaning in month)
  Input: 2 cleanings in 30 days, plan allows 2/year
  Expected: 1st covered, 2nd denied

Test 8: Missing tooth clause (12-month waiting period)
  Input: Implant requested within 12 months of plan start
  Expected: Denied or alternative benefit offered

Test 9: Alternative benefit (bridge vs implant)
  Input: Implant requested, plan covers bridge alternative
  Expected: Benefit calculated on lower bridge cost
```

### **Category: Carrier-Specific**
```
Test 10-15: Sun Life rules verification
Test 16-21: Manulife rules verification
Test 22-27: Canada Life / Green Shield / RBC / TELUS
Test 28-30: Cross-carrier comparisons (same procedure, different plans)
```

### **Category: Reconciliation**
```
Test: EOB matches estimate within 2%
  Input: Estimated $100 benefit, actual $99
  Expected: Reconciliation passes

Test: EOB lower than estimate (coverage change)
  Input: Estimated $100 benefit, actual $75
  Expected: Variance flagged, reason documented

Test: Denial not in estimate
  Input: No denial expected, EOB shows denial
  Expected: Critical flag
```

---

## 🛠️ **Implementation Roadmap (Week-by-Week)**

### **Week 1 (May 15-19): Foundation**
- [ ] Database schema creation and migrations
- [ ] CDT code library seeding (all codes)
- [ ] Carrier rule configs for all 6 carriers
- [ ] Begin estimate calculator service

### **Week 2 (May 22-26): Core Logic**
- [ ] Complete estimate calculator algorithm
- [ ] Implement `/api/estimates` route
- [ ] Build UI form (CDT picker, plan selector)
- [ ] Test with basic cases (Tests 1-5)

### **Week 3 (May 29-Jun 2): Edge Cases**
- [ ] Implement edge case handling (deductible, max, frequency)
- [ ] Build reconciliation engine
- [ ] Implement `/api/reconciliations` route
- [ ] Test edge cases (Tests 6-9)

### **Week 4 (Jun 5-9): Refinement & Testing**
- [ ] Carrier-specific rule validation (Tests 10-27)
- [ ] Performance optimization (<200ms target)
- [ ] Dashboard widget for estimates
- [ ] Full integration testing

### **Week 5 (Jun 12-15): Pre-Pilot**
- [ ] Dry-run with Dr. Hasan's real claims
- [ ] Fix any carrier rule mismatches
- [ ] Documentation and staff training
- [ ] Ready for Phase 4 integration

---

## 🚀 **Success Criteria**

### **Acceptance Criteria**
- ✅ Estimate accuracy: 99%+ match to manual calculations
- ✅ Response time: <200ms for `/api/estimates`
- ✅ Edge cases: Deductible, annual max, frequency limits all handled
- ✅ Carrier coverage: All 6 carriers with documented rules
- ✅ Test coverage: 95%+ code coverage
- ✅ Reconciliation: Catch 95%+ of discrepancies >$100

### **Quality Gates**
- All tests passing in CI/CD
- Performance benchmarks met
- Real data validation with Dr. Hasan
- Zero production bugs in pilot week 1

---

## 📚 **Carrier Reference (Quick Lookup)**

| Carrier | Deductible | Annual Max | Preventive | Basic | Major |
|---------|-----------|-----------|-----------|-------|-------|
| Sun Life | $50 | $1200 | 100% | 80% | 50% |
| Manulife | $50/$100 | $1500 | 100% | 80% | 50% |
| Canada Life | $25/$50 | $1000 | 100% | 70% | 50% |
| Green Shield | $0 | $1200 | 100% | 80% | 50% |
| RBC | $50 | $1200 | 100% | 80% | 50% |
| TELUS | $0 | $1500 | 100% | 90% | 60% |

---

## 🔗 **Related Documentation**

- `/CREDENTIAL_ROTATION.md` — Secrets management (completed)
- `/QUICKSTART.md` — General project setup
- `/vapi-eligibility-config.json` — Voice agent configuration
- `src/server/rulesEngine.ts` — Existing rules system (to integrate with)

---

**Ready to begin implementation!** 🚀

