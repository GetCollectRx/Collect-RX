/**
 * Canadian data-residency startup guard.
 *
 * Opt-in: set DATA_RESIDENCY_REGION=ca-central-1 (done by the AWS Canada Central
 * manifests in deploy/aws-ca-central-1/). When unset this is a no-op, so the
 * current Fly.io (yyz) deployment is unaffected.
 *
 * When set, the process refuses to boot if the configured AWS region, or an
 * AWS-hosted database / Redis / bucket endpoint, points outside that region.
 *
 * SCOPE: this checks only endpoints that CollectRx itself connects to. It cannot
 * see where third-party processors (voice platform, LLM provider, email, SMS,
 * payments) store or process data. Those need their own vendor review; see
 * deploy/aws-ca-central-1/README.md.
 */

import { logger } from './observability/logger.js';

export const REQUIRED_RESIDENCY_REGION_DEFAULT = 'ca-central-1';

export class DataResidencyError extends Error {
  constructor(readonly problems: string[]) {
    super(`[dataResidency] Refusing to start: ${problems.join('; ')}`);
    this.name = 'DataResidencyError';
  }
}

/** Region embedded in an AWS service hostname, or null if the host is not an AWS endpoint. */
export function awsRegionFromHost(host: string): string | null {
  const h = host.toLowerCase();
  // db.xxxx.ca-central-1.rds.amazonaws.com, xxx.cache.amazonaws.com (region-qualified)
  const m = /\.([a-z]{2}(?:-[a-z]+)+-\d)\.(?:rds|cache|es|amazonaws)\./.exec(h) ?? /\.([a-z]{2}(?:-[a-z]+)+-\d)\.amazonaws\.com$/.exec(h);
  if (m) return m[1]!;
  // elasticache style: name.xxxxxx.0001.cac1.cache.amazonaws.com (short region code)
  if (h.endsWith('.cache.amazonaws.com')) {
    return /\.cac1\.cache\.amazonaws\.com$/.test(h) ? 'ca-central-1' : 'unknown';
  }
  return null;
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function checkDataResidency(env: NodeJS.ProcessEnv = process.env): string[] {
  const required = (env.DATA_RESIDENCY_REGION ?? '').trim();
  if (!required) return [];
  const problems: string[] = [];

  const awsRegion = (env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? '').trim();
  if (awsRegion !== required) {
    problems.push(`AWS_REGION is "${awsRegion || 'unset'}", expected "${required}"`);
  }

  for (const name of ['DATABASE_URL', 'REDIS_URL'] as const) {
    const host = hostOf(env[name]);
    if (!host) continue;
    const region = awsRegionFromHost(host);
    if (region && region !== required) {
      problems.push(`${name} host is in "${region}", expected "${required}"`);
    }
  }

  const bucketRegion = (env.S3_BUCKET_REGION ?? '').trim();
  if (bucketRegion && bucketRegion !== required) {
    problems.push(`S3_BUCKET_REGION is "${bucketRegion}", expected "${required}"`);
  }
  return problems;
}

export function assertDataResidencyAtStartup(env: NodeJS.ProcessEnv = process.env): void {
  const problems = checkDataResidency(env);
  if (problems.length > 0) {
    logger.error('[dataResidency] misconfiguration', { problems });
    throw new DataResidencyError(problems);
  }
  if ((env.DATA_RESIDENCY_REGION ?? '').trim()) {
    logger.info('[dataResidency] region guard passed', { region: env.DATA_RESIDENCY_REGION });
  }
}
