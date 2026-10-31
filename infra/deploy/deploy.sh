#!/usr/bin/env bash
# Deploys one image tag (a git commit SHA built by CI), run as `deploy` in /opt/apps/rapiz:
#   ./deploy.sh <tag>        pull, migrate, restart; rolls back on a failed health check
#   ./deploy.sh rollback     restart the previous tag (no migrations; they only move forward)
set -euo pipefail
cd "$(dirname "$0")"

arg=${1:?usage: deploy.sh <tag>|rollback}
current=$(cat .deployed-tag 2>/dev/null || true)
compose() { docker compose --env-file .env "$@"; }

start() {
  RAPIZ_TAG=$1 compose up -d --remove-orphans --wait --wait-timeout 180
}

if [[ $arg == rollback ]]; then
  prev=$(cat .previous-tag 2>/dev/null || true)
  [[ -n $prev ]] || { echo "no previous tag recorded" >&2; exit 1; }
  echo "rolling back $current -> $prev"
  start "$prev"
  echo "$prev" > .deployed-tag
  echo "$current" > .previous-tag
  exit 0
fi

tag=$arg
export RAPIZ_TAG=$tag
echo "deploying $tag (current: ${current:-none})"
compose pull --quiet
compose up -d --wait postgres redis object-storage

# The bucket must exist before the first upload; creating an existing one is harmless.
bucket=$(grep -E '^S3_BUCKET=' .env | cut -d= -f2)
compose exec -T object-storage sh -c "echo 's3.bucket.list' | weed shell" 2>/dev/null | grep -qw "$bucket" ||
  compose exec -T object-storage sh -c "echo 's3.bucket.create -name $bucket' | weed shell" >/dev/null

compose run --rm migrate

if ! start "$tag"; then
  echo "health check failed for $tag" >&2
  compose ps
  compose logs --tail 80 api agent webhook edge >&2 || true
  if [[ -n $current && $current != "$tag" ]]; then
    echo "rolling back to $current" >&2
    start "$current" || true
  fi
  exit 1
fi

if [[ $current != "$tag" ]]; then
  echo "$current" > .previous-tag
fi
echo "$tag" > .deployed-tag
docker image prune -f --filter until=168h >/dev/null
echo "deployed $tag"
