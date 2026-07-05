#!/usr/bin/env node
/**
 * Validate schema-map.json against discover-schema output, and emit SQL used by abeldent-sync.
 *
 * Usage:
 *   node scripts/sync-query-builder.cjs --map schema-map.example.json --emit-queries queries.json
 *   node scripts/sync-query-builder.cjs --discovery schema-discovery.json --map schema-map.example.json --validate
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  mergeMap,
  buildClaimsQuery,
} = require('../desktop/services/abeldentQueryTemplates.cjs');

function parseArgs(argv) {
  const out = {
    map: null,
    discovery: null,
    validate: false,
    emitQueries: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--map' && argv[i + 1]) out.map = argv[++i];
    else if (a === '--discovery' && argv[i + 1]) out.discovery = argv[++i];
    else if (a === '--validate') out.validate = true;
    else if (a === '--emit-queries' && argv[i + 1]) out.emitQueries = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function readJson(p) {
  const resolved = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

/** @param {ReturnType<typeof readJson>} discovery */
/** @param {string} schema @param {string} table @param {string} column */
function columnExists(discovery, schema, table, column) {
  const t = discovery.tables.find(
    (x) => x.schema === schema && x.name === table,
  );
  if (!t) return false;
  return t.columns.some((c) => c.name === column);
}

/** Prefer dbo if present */
function resolveTable(discovery, tableName) {
  const lower = tableName.toLowerCase();
  const hit = discovery.tables.find((x) => x.name.toLowerCase() === lower);
  if (hit) return { schema: hit.schema, table: hit.name };
  return { schema: 'dbo', table: tableName };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`sync-query-builder.cjs

  --map path              Schema map JSON (see schema-map.example.json)
  --discovery path        Output from discover-schema.cjs (for --validate)
  --validate              Ensure mapped tables/columns exist in discovery file
  --emit-queries path     Write claimsSql JSON for inspection / docs
`);
    process.exit(0);
  }
  if (!args.map) {
    console.error('Error: --map is required.');
    process.exit(1);
  }

  const rawMap = readJson(args.map);
  const overrides = rawMap.mappings || rawMap;
  const map = mergeMap(overrides);

  if (args.validate) {
    if (!args.discovery) {
      console.error('Error: --validate requires --discovery schema-discovery.json');
      process.exit(1);
    }
    const discovery = readJson(args.discovery);
    const checks = [];

    function checkLogical(label, tableName, colName) {
      const { schema, table } = resolveTable(discovery, tableName);
      const ok = columnExists(discovery, schema, table, colName);
      checks.push({ ok, label: `${label}: [${schema}].[${table}].[${colName}]` });
    }

    const { claims } = map;
    const ct = resolveTable(discovery, claims.table);
    const pt = resolveTable(discovery, claims.patientTable);
    const claimsOnPatient = new Set(['patientFirstName', 'patientLastName']);
    for (const [k, v] of Object.entries(claims.columns)) {
      const tbl = claimsOnPatient.has(k) ? pt.table : ct.table;
      checkLogical(`claims.${k}`, tbl, v);
    }
    checkLogical('claims.join (ic)', ct.table, claims.joinOn.claims);
    checkLogical('claims.join (p)', pt.table, claims.joinOn.patient);

    const failed = checks.filter((c) => !c.ok);
    for (const c of checks) {
      console.log(c.ok ? `OK  ${c.label}` : `MISS ${c.label}`);
    }
    if (failed.length) {
      console.error(`\nValidation failed: ${failed.length} missing column(s) or table(s).`);
      process.exit(1);
    }
    console.log('\nAll mapped columns found in discovery file.');
  }

  if (args.emitQueries) {
    const out = {
      version: 1,
      generatedAt: new Date().toISOString(),
      claimsSql: buildClaimsQuery(map),
    };
    const outPath = path.isAbsolute(args.emitQueries)
      ? args.emitQueries
      : path.join(process.cwd(), args.emitQueries);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(`Wrote queries to ${outPath}`);
  }

  if (!args.validate && !args.emitQueries) {
    console.log('Nothing to do: pass --validate and/or --emit-queries');
    process.exit(1);
  }
}

main();
