import { describe, it, expect } from 'vitest';
import { awsRegionFromHost, checkDataResidency } from './dataResidency';

describe('dataResidency', () => {
  it('is a no-op when DATA_RESIDENCY_REGION is unset', () => {
    expect(checkDataResidency({ AWS_REGION: 'us-east-1' } as NodeJS.ProcessEnv)).toEqual([]);
  });
  it('passes for ca-central-1 endpoints', () => {
    expect(
      checkDataResidency({
        DATA_RESIDENCY_REGION: 'ca-central-1',
        AWS_REGION: 'ca-central-1',
        DATABASE_URL: 'postgresql://collectrx.abc123.ca-central-1.rds.amazonaws.com:5432/db?sslmode=require',
        REDIS_URL: 'rediss://master.collectrx.xyz.cac1.cache.amazonaws.com:6379',
      } as NodeJS.ProcessEnv),
    ).toEqual([]);
  });
  it('flags a us-east-1 database and wrong AWS_REGION', () => {
    const p = checkDataResidency({
      DATA_RESIDENCY_REGION: 'ca-central-1',
      AWS_REGION: 'us-east-1',
      DATABASE_URL: 'postgresql://x.abc.us-east-1.rds.amazonaws.com:5432/db',
    } as NodeJS.ProcessEnv);
    expect(p.length).toBe(2);
  });
  it('flags an unrecognised elasticache region code instead of trusting it', () => {
    expect(awsRegionFromHost('m.x.use1.cache.amazonaws.com')).toBe('unknown');
  });
  it('ignores non-AWS hosts (they are reviewed outside this check)', () => {
    expect(awsRegionFromHost('db.internal.example.com')).toBeNull();
  });
});
