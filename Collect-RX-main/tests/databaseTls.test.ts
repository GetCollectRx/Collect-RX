import { describe, expect, it } from 'vitest';
import {
  isFlyPrivateNetworkHost,
  isPostgresConnectionString,
  postgresUrlUsesStrictSsl,
  withPostgresTlsDefault,
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

  it('withPostgresTlsDefault appends sslmode=require when missing', () => {
    const base = 'postgresql://u:p@switchyard.proxy.rlwy.net:57765/railway';
    expect(withPostgresTlsDefault(base)).toBe(`${base}?sslmode=require`);
    expect(withPostgresTlsDefault(`${base}?sslmode=require`)).toBe(`${base}?sslmode=require`);
  });

  it('withPostgresTlsDefault overrides an explicit weak sslmode instead of appending a duplicate key', () => {
    // Regression: URLSearchParams.get() returns the first match on a repeated
    // key, so appending "&sslmode=require" after an existing "sslmode=disable"
    // left the connection non-TLS forever — the guard would loop and still
    // reject the URL as non-strict. Must replace, not append.
    const base = 'postgres://u:p@some-public-host:5432/collect_rx';
    const result = withPostgresTlsDefault(`${base}?sslmode=disable`);
    expect(result).toBe(`${base}?sslmode=require`);
    expect(postgresUrlUsesStrictSsl(result)).toBe(true);
  });

  it('isFlyPrivateNetworkHost recognizes .flycast and .internal, not public hosts', () => {
    expect(isFlyPrivateNetworkHost('postgres://u:p@collect-rx-db.flycast:5432/db')).toBe(true);
    expect(isFlyPrivateNetworkHost('postgres://u:p@collect-rx-db.internal:5432/db')).toBe(true);
    expect(isFlyPrivateNetworkHost('postgres://u:p@switchyard.proxy.rlwy.net:5432/db')).toBe(false);
  });

  it('withPostgresTlsDefault leaves Fly private-network URLs untouched even without sslmode', () => {
    // Fly Postgres does not enable SSL on .flycast by default, and that hop is
    // already encrypted by Fly's WireGuard mesh — forcing sslmode=require here
    // breaks the connection ("server does not support SSL") for no security gain.
    const url = 'postgres://collect_rx:pw@collect-rx-db.flycast:5432/collect_rx?sslmode=disable';
    expect(withPostgresTlsDefault(url)).toBe(url);
  });
});
