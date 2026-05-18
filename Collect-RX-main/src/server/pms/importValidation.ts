export interface ImportValidationInput {
  sourceRecordCount: number;
  importedRecordCount: number;
  sourceBalanceTotal: number;
  importedBalanceTotal: number;
  maxDriftPct?: number;
}

export interface ImportValidationResult {
  passed: boolean;
  driftPct: number;
  recordDriftPct: number;
  messages: string[];
}

const DEFAULT_MAX_DRIFT = 0.01;

export function validateImportTotals(input: ImportValidationInput): ImportValidationResult {
  const maxDrift = input.maxDriftPct ?? DEFAULT_MAX_DRIFT;
  const messages: string[] = [];

  const recordDriftPct =
    input.sourceRecordCount > 0
      ? Math.abs(input.sourceRecordCount - input.importedRecordCount) / input.sourceRecordCount
      : 0;

  if (recordDriftPct > maxDrift) {
    messages.push(
      `Record count drift ${(recordDriftPct * 100).toFixed(2)}% exceeds ${maxDrift * 100}% threshold`,
    );
  }

  const driftPct =
    input.sourceBalanceTotal > 0
      ? Math.abs(input.sourceBalanceTotal - input.importedBalanceTotal) / input.sourceBalanceTotal
      : 0;

  if (driftPct > maxDrift) {
    messages.push(
      `Balance total drift ${(driftPct * 100).toFixed(2)}% exceeds ${maxDrift * 100}% threshold`,
    );
  }

  return {
    passed: messages.length === 0,
    driftPct,
    recordDriftPct,
    messages,
  };
}
