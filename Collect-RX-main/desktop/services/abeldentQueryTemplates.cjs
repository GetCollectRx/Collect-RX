/**
 * AbelDent SQL templates — shared by abeldent-sync.js and scripts/sync-query-builder.cjs
 * Table/column names are parameterized; only [A-Za-z0-9_] allowed (SQL Server identifiers).
 */

'use strict';

/** @param {string} name */
function ident(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return name;
}

/** Default map matches typical AbelDent Local Plus naming (verify per site via discover-schema). */
const DEFAULT_MAP = {
  claims: {
    table: 'Insurance_Claims',
    alias: 'ic',
    patientTable: 'Patients',
    patientAlias: 'p',
    joinOn: { claims: 'PatientID', patient: 'PatientID' },
    columns: {
      claimId: 'ClaimID',
      patientFirstName: 'FirstName',
      patientLastName: 'LastName',
      carrierName: 'InsurancePlanName',
      policyNumber: 'GroupNumber',
      procedureCode: 'ProcedureCode',
      procedureDescription: 'ProcedureDescription',
      treatmentDate: 'DateOfService',
      submissionDate: 'SubmissionDate',
      amountBilled: 'AmountBilled',
      amountOutstanding: 'AmountOutstanding',
      claimStatus: 'ClaimStatus',
    },
  },
};

/**
 * @param {unknown} overrides
 * @returns {typeof DEFAULT_MAP}
 */
function mergeMap(overrides) {
  const base = JSON.parse(JSON.stringify(DEFAULT_MAP));
  if (!overrides || typeof overrides !== 'object') return base;
  const o = /** @type {Record<string, unknown>} */ (overrides);
  if (o.claims && typeof o.claims === 'object') {
    const claimsOverride = /** @type {Record<string, unknown>} */ (o.claims);
    // Merge nested `columns`/`joinOn` against the *defaults* before the shallow
    // Object.assign below overwrites base.claims.columns/joinOn with the override's
    // (possibly partial) object by reference — otherwise a caller overriding a single
    // column silently drops every other default column/join key.
    const mergedColumns =
      claimsOverride.columns && typeof claimsOverride.columns === 'object'
        ? Object.assign({}, base.claims.columns, claimsOverride.columns)
        : base.claims.columns;
    const mergedJoinOn =
      claimsOverride.joinOn && typeof claimsOverride.joinOn === 'object'
        ? Object.assign({}, base.claims.joinOn, claimsOverride.joinOn)
        : base.claims.joinOn;
    Object.assign(base.claims, claimsOverride);
    base.claims.columns = mergedColumns;
    base.claims.joinOn = mergedJoinOn;
  }
  return base;
}

/**
 * @param {typeof DEFAULT_MAP} map
 * @returns {string}
 */
function buildClaimsQuery(map) {
  const { claims } = map;
  const ic = ident(claims.alias);
  const pt = ident(claims.patientAlias);
  const tIc = ident(claims.table);
  const tPt = ident(claims.patientTable);
  const c = claims.columns;
  const jc = ident(claims.joinOn.claims);
  const jp = ident(claims.joinOn.patient);

  return `
  SELECT
    CAST(${ic}.${ident(c.claimId)} AS VARCHAR(20)) AS id,
    ${pt}.${ident(c.patientFirstName)} AS patient_first_name,
    ${pt}.${ident(c.patientLastName)} AS patient_last_name,
    ${ic}.${ident(c.carrierName)} AS carrier_name,
    ${ic}.${ident(c.policyNumber)} AS policy_number,
    CAST(${ic}.${ident(c.procedureCode)} AS VARCHAR(20)) AS procedure_code,
    ${ic}.${ident(c.procedureDescription)} AS procedure_description,
    CONVERT(VARCHAR(10), ${ic}.${ident(c.treatmentDate)}, 23) AS treatment_date,
    CONVERT(VARCHAR(10), ${ic}.${ident(c.submissionDate)}, 23) AS submission_date,
    ${ic}.${ident(c.amountBilled)} AS amount_billed,
    ${ic}.${ident(c.amountOutstanding)} AS amount_outstanding,
    DATEDIFF(day, ${ic}.${ident(c.submissionDate)}, GETDATE()) AS days_outstanding
  FROM ${tIc} ${ic}
  JOIN ${tPt} ${pt} ON ${pt}.${jp} = ${ic}.${jc}
  WHERE ${ic}.${ident(c.amountOutstanding)} > 0
    AND ${ic}.${ident(c.claimStatus)} NOT IN ('Paid', 'Void', 'Rejected')
    AND DATEDIFF(day, ${ic}.${ident(c.submissionDate)}, GETDATE()) >= @minDays
  ORDER BY ${ic}.${ident(c.amountOutstanding)} DESC
`.trim();
}

module.exports = {
  DEFAULT_MAP,
  mergeMap,
  buildClaimsQuery,
};
