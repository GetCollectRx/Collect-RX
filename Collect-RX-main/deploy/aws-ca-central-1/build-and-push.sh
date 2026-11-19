#!/usr/bin/env bash
# Build the CollectRx image and push it to an ECR repository in ca-central-1.
# Usage: ./build-and-push.sh <aws-account-id> <tag>
# Run from anywhere; the build context is the Collect-RX-main directory.
set -euo pipefail

ACCOUNT_ID="${1:?aws account id required}"
TAG="${2:?image tag required}"
REGION="ca-central-1"
REPO="collectrx"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
CONTEXT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

aws ecr describe-repositories --region "$REGION" --repository-names "$REPO" >/dev/null 2>&1 \
  || aws ecr create-repository --region "$REGION" --repository-name "$REPO" \
       --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=KMS >/dev/null

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker build --platform linux/amd64 -t "${REGISTRY}/${REPO}:${TAG}" "$CONTEXT"
docker push "${REGISTRY}/${REPO}:${TAG}"
echo "Pushed ${REGISTRY}/${REPO}:${TAG}"
