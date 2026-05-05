#!/usr/bin/env node
/**
 * AbelDent / SQL Server schema discovery (run on Windows against the practice SQL instance).
 *
 * Requires: npm install mssql (and ODBC Driver 17 + msnodesqlv8 stack per mssql docs for Windows auth)
 *
 * Usage:
 *   node scripts/discover-schema.cjs --server "localhost\\SQLEXPRESS" --database AbelDent --out schema-discovery.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { server: null, database: null, output: 'schema-discovery.json' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--server' && argv[i + 1]) out.server = argv[++i];
    else if (a === '--database' && argv[i + 1]) out.database = argv[++i];
    else if ((a === '--out' || a === '-o') && argv[i + 1]) out.output = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`discover-schema.cjs — dump INFORMATION_SCHEMA to JSON

  --server    SQL Server instance (required), e.g. "(local)\\\\ABELDENT"
  --database  Database name (required)
  --out       Output file (default: schema-discovery.json)
`);
    process.exit(0);
  }
  if (!args.server || !args.database) {
    console.error('Error: --server and --database are required.');
    process.exit(1);
  }

  let sql;
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    sql = require('mssql');
  } catch {
    console.error('Error: install mssql in this package first:\n  npm install mssql\n');
    process.exit(1);
  }

  const sqlConfig = {
    server: args.server,
    database: args.database,
    driver: 'msnodesqlv8',
    options: {
      trustedConnection: true,
      enableArithAbort: true,
      trustServerCertificate: true,
    },
  };

  const pool = await sql.connect(sqlConfig);
  try {
    const q = `
      SELECT
        c.TABLE_SCHEMA AS table_schema,
        c.TABLE_NAME AS table_name,
        c.COLUMN_NAME AS column_name,
        c.DATA_TYPE AS data_type,
        c.IS_NULLABLE AS is_nullable,
        c.ORDINAL_POSITION AS ordinal_position
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
      ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
    `;
    const result = await pool.request().query(q);
    const rows = result.recordset || [];

    /** @type {Map<string, { schema: string, name: string, columns: object[] }>} */
    const tables = new Map();
    for (const row of rows) {
      const schema = String(row.table_schema);
      const name = String(row.table_name);
      const key = `${schema}.${name}`;
      if (!tables.has(key)) {
        tables.set(key, { schema, name, columns: [] });
      }
      tables.get(key).columns.push({
        name: String(row.column_name),
        dataType: String(row.data_type),
        isNullable: String(row.is_nullable) === 'YES',
        ordinal: Number(row.ordinal_position),
      });
    }

    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      server: args.server,
      database: args.database,
      tables: [...tables.values()],
    };

    const outPath = path.isAbsolute(args.output) ? args.output : path.join(process.cwd(), args.output);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Wrote ${tables.size} tables to ${outPath}`);
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
