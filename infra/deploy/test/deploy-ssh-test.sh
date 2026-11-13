#!/usr/bin/env bash
# Unit test of deploy-ssh.sh (the deploy key's forced command) with stub docker and deploy.sh.
# No Docker or network needed. Usage: bash infra/deploy/test/deploy-ssh-test.sh
set -euo pipefail
src=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
app=$work/app
image=$work/image/repo/infra/deploy
mkdir -p "$app" "$work/bin" "$image/postgres"
install -m 755 "$src/deploy-ssh.sh" "$app/deploy-ssh.sh"
printf 'RAPIZ_IMAGE=ghcr.io/acme/rapiz\n' > "$app/.env"
printf '#!/usr/bin/env bash\necho "old deploy $*"\n' > "$app/deploy.sh"
chmod 755 "$app/deploy.sh"

# The release image holds new server files; its deploy.sh records how it was called.
printf 'services: {}\n' > "$image/compose.yml"
printf '#!/usr/bin/env bash\necho "deploy.sh $* image=$RAPIZ_IMAGE"\n' > "$image/deploy.sh"
printf 'FROM scratch\n' > "$image/postgres/Dockerfile"
export STUB_IMAGE_ROOT=$work/image STUB_LOG=$work/docker.log
cat > "$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_LOG"
case $1 in
  create) echo cid123 ;;
  cp) cp -r "$STUB_IMAGE_ROOT/repo/infra/deploy/." "$3" ;;
  login) cat > /dev/null ;;
esac
STUB
chmod 755 "$work/bin/docker"
export PATH=$work/bin:$PATH

fail() {
  echo "FAIL - $*" >&2
  exit 1
}
ok() { echo "ok - $*"; }
sha=0123456789abcdef0123456789abcdef01234567
run() { SSH_ORIGINAL_COMMAND=$1 "$app/deploy-ssh.sh" 2>&1 <<<"${2:-}"; }

for bad in '' 'bash' 'deploy' 'deploy main' "deploy $sha; id" "deploy $sha extra" "rollback $sha" \
  "deploy ${sha^^}" "deploy $sha"$'\n'"id" 'ls -la'; do
  if out=$(run "$bad"); then fail "accepted: $bad"; fi
  grep -q refused <<<"$out" || fail "no refusal message for: $bad ($out)"
done
ok "refuses anything but deploy <sha> and rollback"

out=$(run "deploy $sha" $'octocat\nghs_token')
grep -q "deploy.sh $sha image=ghcr.io/acme/rapiz" <<<"$out" || fail "deploy not run: $out"
grep -q "docker login ghcr.io -u octocat --password-stdin" "$STUB_LOG" || fail "no registry login"
grep -q "docker create ghcr.io/acme/rapiz/app:$sha" "$STUB_LOG" || fail "files not taken from the release image"
grep -q "docker logout ghcr.io" "$STUB_LOG" || fail "no logout"
[[ -f $app/compose.yml && -f $app/postgres/Dockerfile ]] || fail "server files not installed"
grep -q 'RAPIZ_IMAGE' "$app/.env" || fail ".env changed"
ok "deploy <sha> installs the release's server files and runs its deploy.sh"

out=$(run "$app/deploy-ssh.sh deploy $sha")
grep -q "deploy.sh $sha" <<<"$out" || fail "request naming the script refused: $out"
out=$(SSH_ORIGINAL_COMMAND='' "$app/deploy-ssh.sh" deploy "$sha" < /dev/null 2>&1)
grep -q "deploy.sh $sha" <<<"$out" || fail "plain arguments refused: $out"
ok "accepts the request with the script path and as plain arguments"

if run "deploy $sha" $'bad user;\ntoken' > /dev/null; then fail "accepted a malformed registry user"; fi
ok "refuses a malformed registry user"

out=$(run rollback)
grep -q "deploy.sh rollback" <<<"$out" || fail "rollback not run: $out"
ok "rollback"
