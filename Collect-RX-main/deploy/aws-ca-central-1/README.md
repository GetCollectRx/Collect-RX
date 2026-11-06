# CollectRx on AWS Canada Central (ca-central-1)

Targets Canadian data residency for the primary data plane. Production today runs on Fly.io
(`yyz`, Toronto); nothing here changes `fly.toml`.

## What is configured

| Item | Where |
|---|---|
| Region guard (app and worker refuse to boot on a wrong region) | `src/server/dataResidency.ts`, wired in `src/server/index.ts` and `src/server/workerEntry.ts`, enabled by `DATA_RESIDENCY_REGION=ca-central-1` |
| Environment template | `.env.aws-ca-central-1.example` |
| Kubernetes manifests (app, worker, config, secrets, network policy) | `k8s/` |
| ECR build and push | `build-and-push.sh` (repository created in ca-central-1, KMS encrypted, scan on push) |

## Infrastructure you still need to provision (not created by this change)

- EKS cluster (or equivalent) in ca-central-1 with nodes in ca-central-1 zones.
- RDS PostgreSQL 16 in ca-central-1, encrypted with a KMS key in ca-central-1, `sslmode=verify-full`.
  Backups, read replicas and cross-region copies must also stay in Canada. Use `ca-west-1` only if you
  need a second Canadian region. Cross-region copy to a US region breaks residency.
- ElastiCache Redis in ca-central-1 with in-transit encryption (`rediss://`).
- Secrets Manager entries in ca-central-1 named as in `k8s/external-secret.yaml`, and an External Secrets
  `ClusterSecretStore` named `aws-secrets-manager-ca-central-1`.
- CloudWatch Logs / S3 buckets in ca-central-1 only. Set `S3_BUCKET_REGION` if a bucket is used.

## Rollout order

1. `npx prisma migrate deploy` against the new RDS instance (applies `20261017120000_carrier_id_other` before `20261017120100_industry_type_polymorphic_claims`).
2. Set the image: `kustomize edit set image collectrx=<account-id>.dkr.ecr.ca-central-1.amazonaws.com/collectrx:<tag>`.
3. `kubectl apply -k deploy/aws-ca-central-1/k8s`.
4. Confirm `/api/health/ready` is 200 and logs show `[dataResidency] region guard passed`.

## Limits of this guard (read before claiming residency)

- It checks only endpoints CollectRx connects to. It does not prove where third parties store or process data:
  the voice platform and its telephony and speech providers, the LLM provider that handles call transcripts,
  SendGrid, Twilio, Stripe and error tracking. Call audio, transcripts and claim details pass through some of these.
  Each needs a documented processing-location answer and a contract position before you describe the system as
  Canadian-resident. The existing `Quebec-Law25-PIA.md` (section 3, data residency) covers Quebec; confirm it against this architecture.
- Only the `rds`, `elasticache` and `amazonaws.com` hostnames are region-checked. A custom DNS alias in front of
  RDS or Redis hides the region from the check.
- Manifests were reviewed as YAML only. They have not been applied to a cluster.
