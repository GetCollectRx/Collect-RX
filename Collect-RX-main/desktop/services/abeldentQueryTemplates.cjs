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
  patientLedger: {
    table: 'PatientLedger',
    alias: 'pl',
    patientTable: 'Patients',
    patientAlias: 'p',
    joinOn: { ledger: 'PatientID', patient: 'PatientID' },
    columns: {
      patientId: 'PatientID',
      patientFirstName: 'FirstName',
      patientLastName: 'LastName',
      patientEmail: 'Email',
      cellPhone: 'CellPhone',
      homePhone: 'HomePhone',
      procedureCode: 'ProcedureCode',
      procedureDescription: 'ProcedureDescription',
      treatmentDate: 'TreatmentDate',
      adjudicationDate: 'AdjudicationDate',
      fee: 'Fee',
      insurancePaid: 'InsurancePaid',
      patientPaid: 'PatientPaid',
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
    Object.assign(base.claims, o.claims);
    if (o.claims.columns && typeof o.claims.columns === 'object') {
      Object.assign(base.claims.columns, o.claims.columns);
    }
    if (o.claims.joinOn && typeof o.claims.joinOn === 'object') {
      Object.assign(base.claims.joinOn, o.claims.joinOn);
    }
  }
  if (o.patientLedger && typeof o.patientLedger === 'object') {
    Object.assign(base.patientLedger, o.patientLedger);
    if (o.patientLedger.columns && typeof o.patientLedger.columns === 'object') {
      Object.assign(base.patientLedger.columns, o.patientLedger.columns);
    }
    if (o.patientLedger.joinOn && typeof o.patientLedger.joinOn === 'object') {
      Object.assign(base.patientLedger.joinOn, o.patientLedger.joinOn);
    }
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

/**
 * @param {typeof DEFAULT_MAP} map
 * @returns {string}
 */
function buildPatientBalanceQuery(map) {
  const { patientLedger: plm } = map;
  const pl = ident(plm.alias);
  const p = ident(plm.patientAlias);
  const tPl = ident(plm.table);
  const tPt = ident(plm.patientTable);
  const c = plm.columns;
  const jl = ident(plm.joinOn.ledger);
  const jp = ident(plm.joinOn.patient);

  return `
    SELECT
      CAST(${p}.${ident(c.patientId)} AS VARCHAR(20)) AS abeldent_patient_id,
      ${p}.${ident(c.patientFirstName)} AS patient_first_name,
      ${p}.${ident(c.patientLastName)} AS patient_last_name,
      ${p}.${ident(c.patientEmail)} AS patient_email,
      COALESCE(${p}.${ident(c.cellPhone)}, ${p}.${ident(c.homePhone)}) AS patient_phone,
      CAST(${pl}.${ident(c.procedureCode)} AS VARCHAR(20)) AS procedure_code,
      ${pl}.${ident(c.procedureDescription)} AS procedure_description,
      CONVERT(VARCHAR(10), ${pl}.${ident(c.treatmentDate)}, 23) AS treatment_date,
      CONVERT(VARCHAR(10), ${pl}.${ident(c.adjudicationDate)}, 23) AS adjudication_date,
      ${pl}.${ident(c.fee)} AS amount_billed,
      COALESCE(${pl}.${ident(c.insurancePaid)}, 0) AS insurance_paid,
      (${pl}.${ident(c.fee)} - COALESCE(${pl}.${ident(c.insurancePaid)}, 0) - COALESCE(${pl}.${ident(c.patientPaid)}, 0)) AS patient_owes,
      DATEDIFF(day, ${pl}.${ident(c.adjudicationDate)}, GETDATE()) AS days_since_adjudication
    FROM ${tPl} ${pl}
    JOIN ${tPt} ${p} ON ${p}.${jp} = ${pl}.${jl}
    WHERE ${pl}.${ident(c.adjudicationDate)} IS NOT NULL
      AND (${pl}.${ident(c.fee)} - COALESCE(${pl}.${ident(c.insurancePaid)}, 0) - COALESCE(${pl}.${ident(c.patientPaid)}, 0)) > 0
      AND DATEDIFF(day, ${pl}.${ident(c.adjudicationDate)}, GETDATE()) >= @minDaysBalance
    ORDER BY patient_owes DESC
  `.trim();
}

/**
 * MOD-04 — write-back UPDATE templates.
 *
 * The cloud `PmsWritebackLog.payload` provides claim_ref + outcome metadata.
 * We translate `source` to a target column on Insurance_Claims:
 *   - resolution_closer → set status = 'Paid', payment ref column.
 *   - escalation_closer → set status = 'Denied', store denial reason.
 * Practices that use different column names override via schema-map.json.
 *
 * @param {typeof DEFAULT_MAP} map
 * @param {{ source: string; payload?: Record<string, unknown> }} entry
 * @returns {{ sql: string; inputs: Array<{name: string; value: string | number | null }> }}
 */
function buildWritebackStatement(map, entry) {
  const { claims } = map;
  const tIc = ident(claims.table);
  const c = claims.columns;
  const claimIdCol = ident(c.claimId);
  const statusCol = ident(c.claimStatus);

  const payload = entry.payload || {};
  const claimRef =
    /** @type {string} */ (payload.claim_ref || payload.claimRef || '');

  // Use schema-map column overrides where present, else fall back to common AbelDent names.
  const paymentRefCol = ident(
    /** @type {string} */ (
      (claims.columns && claims.columns.paymentRef) || 'PaymentRef'
    )
  );
  const denialReasonCol = ident(
    /** @type {string} */ (
      (claims.columns && claims.columns.denialReason) || 'DenialReason'
    )
  );
  const resolvedAtCol = ident(
    /** @type {string} */ (
      (claims.columns && claims.columns.resolvedAt) || 'ResolvedAt'
    )
  );

  const inputs = /** @type {Array<{name: string; value: string | number | null }>} */ ([
    { name: 'claimRef', value: String(claimRef) },
  ]);

  if (entry.source === 'resolution_closer') {
    const paymentRef =
      payload.payment_ref || payload.paymentRef || payload.payment_reference || null;
    inputs.push({ name: 'paymentRef', value: paymentRef ? String(paymentRef) : null });
    return {
      sql: `UPDATE ${tIc}
              SET ${statusCol} = 'Paid',
                  ${paymentRefCol} = COALESCE(@paymentRef, ${paymentRefCol}),
                  ${resolvedAtCol} = GETDATE()
              WHERE CAST(${claimIdCol} AS VARCHAR(40)) = @claimRef`,
      inputs,
    };
  }

  // Escalation closer: record denial reason; do not flip to 'Rejected' to preserve audit trail.
  const reason =
    payload.denial_reason ||
    payload.reason_code ||
    payload.escalation_reason ||
    null;
  inputs.push({ name: 'denialReason', value: reason ? String(reason).slice(0, 255) : null });
  return {
    sql: `UPDATE ${tIc}
            SET ${denialReasonCol} = COALESCE(@denialReason, ${denialReasonCol}),
                ${resolvedAtCol} = GETDATE()
            WHERE CAST(${claimIdCol} AS VARCHAR(40)) = @claimRef`,
    inputs,
  };
}

module.exports = {
  DEFAULT_MAP,
  mergeMap,
  buildClaimsQuery,
  buildPatientBalanceQuery,
  buildWritebackStatement,
};
