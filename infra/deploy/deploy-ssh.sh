#!/usr/bin/env bash
# SSH forced command of the CI deploy key (docs/runbooks/deploy-vps.md "Deploy key"). In
# ~deploy/.ssh/authorized_keys:
#   command="/opt/apps/rapiz/deploy-ssh.sh",restrict ssh-ed25519 AAAA… rapiz-ci-deploy
# The key then runs nothing but this script, which accepts two requests (SSH_ORIGINAL_COMMAND):
#   deploy <40-hex commit SHA>   stdin: GHCR user and token, one line each (may be empty). Copies
#                                the server files out of that release's app image, then runs
#                                ./deploy.sh <sha>. Nothing else crosses the connection, so the key
#                                can only ship an image CI already built and pushed.
#   rollback                     ./deploy.sh rollback
# The image repository comes from RAPIZ_IMAGE in .env (default as in compose.yml), not the caller.
set -euo pipefail

main() {
  cd "$(dirname "$(readlink -f "$0")")"
  local request=${SSH_ORIGINAL_COMMAND:-$*}
  local verb sha extra
  [[ $request != *$'\n'* ]] || refuse
  # CI names this script too, so the same request works before authorized_keys forces it.
  read -r verb sha extra <<<"${request#"$0" }" || true
  [[ -z ${extra:-} ]] || refuse
  case $verb in
    deploy) [[ $sha =~ ^[0-9a-f]{40}$ ]] || refuse ;;
    rollback) [[ -z $sha ]] || refuse ;;
    *) refuse ;;
  esac
  if [[ $verb == rollback ]]; then
    exec ./deploy.sh rollback
  fi

  local image user token
  image=$(grep -E '^RAPIZ_IMAGE=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
  image=${image:-ghcr.io/thienlng/agent-sale}
  IFS= read -r user || true
  IFS= read -r token || true
  if [[ -n $token ]]; then
    [[ $user =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]] || refuse
    # The job token can pull the private images until the CI job ends; log out on exit anyway.
    trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
    printf '%s' "$token" | docker login ghcr.io -u "$user" --password-stdin >/dev/null
  fi

  sync_server_files "$image/app:$sha"
  RAPIZ_IMAGE=$image ./deploy.sh "$sha"
}

refuse() {
  echo "deploy-ssh: refused (expected 'deploy <commit sha>' or 'rollback')" >&2
  exit 2
}

# sync_server_files <image>: compose.yml, the scripts and the postgres image context of that
# release, as reviewed on main. Each file is renamed into place, so a running script (this one
# included) keeps reading its old copy. .env and the state folders are never touched.
sync_server_files() {
  local tmp cid f
  tmp=$(mktemp -d)
  docker pull -q "$1" >/dev/null
  cid=$(docker create "$1")
  docker cp "$cid:/repo/infra/deploy/." "$tmp/" >/dev/null
  docker rm "$cid" >/dev/null
  [[ -f $tmp/compose.yml && -f $tmp/deploy.sh && -d $tmp/postgres ]] || {
    echo "deploy-ssh: $1 has no server files" >&2
    rm -rf "$tmp"
    exit 1
  }
  install -m 644 "$tmp/compose.yml" ".compose.yml.new" && mv -f .compose.yml.new compose.yml
  for f in "$tmp"/*.sh; do
    install -m 755 "$f" ".$(basename "$f").new" && mv -f ".$(basename "$f").new" "$(basename "$f")"
  done
  rm -rf .postgres.new && cp -r "$tmp/postgres" .postgres.new
  rm -rf postgres && mv .postgres.new postgres
  rm -rf "$tmp"
}

main "$@"
exit
