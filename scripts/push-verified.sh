#!/usr/bin/env bash
# Pushes through the same pre-push gate as `git push`, against an existing verification
# database. Needed when the hook cannot start its own PostgreSQL, for example when the
# session runs as root, because initdb refuses to run as root.
#
# Set DATABASE_URL to a database whose name contains "verify" or "test" (never production),
# for example postgresql://<user>:<password>@127.0.0.1:5432/crx_verify_x?connection_limit=30&pool_timeout=20.
# The connection_limit and pool_timeout values match the CI workflow. Credentials are read from
# the environment only and are never written to this script or to git.
#
# Usage: scripts/push-verified.sh [git push arguments]   e.g. -u origin my-branch
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "push-verified: DATABASE_URL is not set. Export a verification database URL first (see the header)." >&2
  exit 2
fi
dbname="${DATABASE_URL##*/}"; dbname="${dbname%%\?*}"
case "$dbname" in
  *verify*|*test*) ;;
  *) echo "push-verified: database '$dbname' is not named for verification; refusing." >&2; exit 2 ;;
esac

export VERIFY_USE_EXISTING_DB=1
exec git push "$@"
