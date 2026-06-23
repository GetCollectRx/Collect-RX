// ─────────────────────────────────────────────────────────────────────────────
// tierFeatures — single source of truth for what each tier is allowed to do.
//
// Source: collectrx-tiering-strategy.md §6 (feature matrix). Edit this file
// when the strategy changes; consumers (planService, queue dispatcher, API
// gates, frontend) must not duplicate the matrix.
//
// Used by:
//   - planService.canMakeCall   — autonomy + included pools
//   - planService.getFeatures   — UI feature gates (whitelabel, REST API, …)
//   - billing layer (future)    — per-tier overage prices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Autonomy level:
 *   triage      — Basic. AR triage; escalates contentious denials.
 *   negotiation — Professional. Full squad; argues denials; supervisor escalation.
 *   scripted    — Enterprise. Executes the DSO's own per-carrier playbook.
 */

/**
 * Abeldent sync depth:
 *   read_only — Basic
 *   deep      — Professional
 *   writeback — Enterprise (closes the loop, no human touch)
 */

// Included pools and overage rates — override per deployment via env without code changes.
const BASIC_INCLUDED_CLAIMS = (() => {
  const raw = parseInt(process.env.BASIC_INCLUDED_CLAIMS_PER_CYCLE || '', 10);
  return Number.isFinite(raw) && raw >= 10 ? raw : 100;
})();

const PRO_INCLUDED_CLAIMS = (() => {
  const raw = parseInt(process.env.PRO_INCLUDED_CLAIMS_PER_CYCLE || '', 10);
  return Number.isFinite(raw) && raw >= 25 ? raw : 200;
})();

const PRO_OVERAGE_CENTS = (() => {
  const raw = parseInt(process.env.PRO_OVERAGE_CENTS_PER_CLAIM || '', 10);
  return Number.isFinite(raw) && raw >= 500 ? raw : 2200; // default $22 / claim beyond included
})();

const TIER_FEATURES = Object.freeze({
  basic: {
    label: 'Basic — AR Collections',
    autonomy: 'triage',
    abeldentSync: 'read_only',
    multiTenancy: false,
    restApi: false,
    whiteLabel: false,
    customScripts: false,
    crossPracticeBenchmarking: false,
    appealDrafting: false,
    denialPrediction: false,
    fullTranscripts: false,
    auditPortal: 'none',
    // AR metric only — claims CollectRx closes (paid, denied, maxed, resubmit path).
    includedStatusCallsPerCycle: null,
    includedResolvedClaimsPerCycle: BASIC_INCLUDED_CLAIMS,
    valueMetric: 'resolved_claim',
    overageCentsPerClaim: null,
    usageUnitLabel: 'claims resolved',
    allowOverage: false,
  },
  professional: {
    label: 'Professional — AI AR Negotiator',
    autonomy: 'negotiation',
    abeldentSync: 'deep',
    multiTenancy: false,
    restApi: false,
    whiteLabel: false,
    customScripts: false,
    crossPracticeBenchmarking: false,
    appealDrafting: true,
    denialPrediction: true,
    fullTranscripts: true,
    auditPortal: 'limited',
    includedStatusCallsPerCycle: null,
    includedResolvedClaimsPerCycle: PRO_INCLUDED_CLAIMS,
    valueMetric: 'resolved_claim',
    overageCentsPerClaim: PRO_OVERAGE_CENTS,
    usageUnitLabel: 'claims resolved',
    allowOverage: true,
  },
  enterprise: {
    label: 'Enterprise — DSO AR Orchestrator',
    autonomy: 'scripted',
    abeldentSync: 'writeback',
    multiTenancy: true,
    restApi: true,
    whiteLabel: true,
    customScripts: true,
    crossPracticeBenchmarking: true,
    appealDrafting: true,
    denialPrediction: true,
    fullTranscripts: true,
    auditPortal: 'full',
    includedStatusCallsPerCycle: null,
    includedResolvedClaimsPerCycle: null,
    valueMetric: 'recovered_dollars',
    overageCentsPerClaim: null,
    usageUnitLabel: 'recovered dollars',
    allowOverage: true,
  },
});

const TIER_NAMES = Object.freeze(['basic', 'professional', 'enterprise']);

function getFeatures(tier) {
  const features = TIER_FEATURES[tier];
  if (!features) throw new Error(`Unknown plan tier: ${tier}`);
  return features;
}

module.exports = {
  BASIC_INCLUDED_CLAIMS,
  PRO_INCLUDED_CLAIMS,
  PRO_OVERAGE_CENTS,
  TIER_FEATURES,
  TIER_NAMES,
  getFeatures,
};
