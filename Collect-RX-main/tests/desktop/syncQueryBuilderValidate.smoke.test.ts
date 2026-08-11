import { describe, expect, it, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

/**
 * CI-runnable smoke test for `scripts/sync-query-builder.cjs --validate`: confirms a broken
 * AbelDent schema map (one referencing a column that does not exist in the practice's SQL
 * Server) is caught before a practice site ever runs it, and that the shipped
 * `schema-map.example.json` validates cleanly against a matching discovery fixture.
 */

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const scriptPath = path.join(packageRoot, 'scripts', 'sync-query-builder.cjs');
const examplaMapPath = path.join(packageRoot, 'schema-map.example.json');

interface DiscoveryColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  ordinal: number;
}

interface DiscoveryTable {
  schema: string;
  name: string;
  columns: DiscoveryColumn[];
}

function col(name: string, ordinal: number): DiscoveryColumn {
  return { name, dataType: 'nvarchar', isNullable: true, ordinal };
}

/** Discovery fixture matching every table/column referenced by schema-map.example.json's `claims` mapping. */
function buildValidDiscovery(): { version: number; generatedAt: string; server: string; database: string; tables: DiscoveryTable[] } {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    server: 'fixture-server',
    database: 'fixture-db',
    tables: [
      {
        schema: 'dbo',
        name: 'Insurance_Claims',
        columns: [
          col('ClaimID', 1),
          col('PatientID', 2),
          col('InsurancePlanName', 3),
          col('GroupNumber', 4),
          col('ProcedureCode', 5),
          col('ProcedureDescription', 6),
          col('DateOfService', 7),
          col('SubmissionDate', 8),
          col('AmountBilled', 9),
          col('AmountOutstanding', 10),
          col('ClaimStatus', 11),
        ],
      },
      {
        schema: 'dbo',
        name: 'Patients',
        columns: [col('PatientID', 1), col('FirstName', 2), col('LastName', 3)],
      },
    ],
  };
}

const tmpFiles: string[] = [];

function writeTempJson(payload: unknown): string {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'collectrx-schema-discovery-')),
    'schema-discovery.json',
  );
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  tmpFiles.push(file);
  return file;
}

function runValidate(discoveryPath: string, mapPath = examplaMapPath) {
  return spawnSync(
    process.execPath,
    [scriptPath, '--discovery', discoveryPath, '--map', mapPath, '--validate'],
    { cwd: packageRoot, encoding: 'utf8' },
  );
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    fs.rmSync(path.dirname(f), { recursive: true, force: true });
  }
});

describe('sync-query-builder.cjs --validate', () => {
  it('succeeds against schema-map.example.json and a matching discovery file', () => {
    const discoveryPath = writeTempJson(buildValidDiscovery());
    const result = runValidate(discoveryPath);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('All mapped columns found in discovery file.');
    expect(result.stdout).not.toContain('MISS');
  });

  it('fails when the schema map references a column absent from the discovery file', () => {
    const broken = buildValidDiscovery();
    const claimsTable = broken.tables.find((t) => t.name === 'Insurance_Claims');
    if (!claimsTable) throw new Error('fixture setup error: Insurance_Claims table missing');
    // Drop AmountOutstanding — referenced by schema-map.example.json's claims.columns.amountOutstanding.
    claimsTable.columns = claimsTable.columns.filter((c) => c.name !== 'AmountOutstanding');

    const discoveryPath = writeTempJson(broken);
    const result = runValidate(discoveryPath);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('MISS');
    expect(result.stdout).toContain('AmountOutstanding');
    expect(result.stderr).toContain('Validation failed');
  });

  it('fails when the schema map references a table absent from the discovery file', () => {
    const broken = buildValidDiscovery();
    broken.tables = broken.tables.filter((t) => t.name !== 'Patients');

    const discoveryPath = writeTempJson(broken);
    const result = runValidate(discoveryPath);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('MISS');
    expect(result.stderr).toContain('Validation failed');
  });
});
