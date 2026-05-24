import { describe, expect, it } from 'vitest';
import {
  isPostgresConnectionString,
  postgresUrlUsesStrictSsl,
} from '../src/server/databaseTls';

describe('databaseTls', () => {
  it('detects postgres URLs', () => {
    expect(isPostgresConnectionString('postgresql://u:p@h/db')).toBe(true);
    expect(isPostgresConnectionString('postgres://u:p@h/db')).toBe(true);
    expect(isPostgresConnectionString('file:./dev.db')).toBe(false);
  });

  it('accepts sslmode=require and verify variants', () => {
    expect(
      postgresUrlUsesStrictSsl('postgresql://u:p@h:5432/db?sslmode=require'),
    ).toBe(true);
    expect(
      postgresUrlUsesStrictSsl('postgresql://u:p@h/db?sslmode=verify-full'),
    ).toBe(true);
    expect(
      postgresUrlUsesStrictSsl('postgresql://u:p@h/db?sslmode=verify-ca'),
    ).toBe(true);
  });

  it('accepts ssl=true', () => {
    expect(postgresUrlUsesStrictSsl('postgresql://u:p@h/db?ssl=true')).toBe(true);
  });

  it('rejects missing query, disable, prefer, allow', () => {
    expect(postgresUrlUsesStrictSsl('postgresql://u:p@h/db')).toBe(false);
    expect(
      postgresUrlUsesStrictSsl('postgresql://u:p@h/db?sslmode=disable'),
    ).toBe(false);
    expect(
      postgresUrlUsesStrictSsl('postgresql://u:p@h/db?sslmode=prefer'),
    ).toBe(false);
    expect(
      postgresUrlUsesStrictSsl('postgresql://u:p@h/db?sslmode=allow'),
    ).toBe(false);
  });

  it('treats non-postgres URLs as vacuously OK for ssl helper', () => {
    expect(postgresUrlUsesStrictSsl('file:./dev.db')).toBe(true);
  });
});
