# Runbook — deploy to a single VPS

The whole product runs on one server with Docker Compose: `infra/deploy/`. This is the
Stage 1 single-node setup from docs/10 §2, without Patroni, Sentinel or the LGTM stack yet.

## What runs

| Service | Image | Role |
|---|---|---|
| `edge` | `ghcr.io/<repo>/edge:<sha>` | Caddy on :80/:443. HTTPS certificates are automatic. Serves the dashboard SPA, the marketing site and `widget.js`, and proxies the rest |
| `api`, `agent`, `worker`, `webhook` | `ghcr.io/<repo>/app:<sha>` | Backend processes. One image; the command picks the entry |
| `migrate` | same `app` image | One-shot job. Applies SQL migrations and creates or updates the `rapiz_tenant`/`rapiz_system` logins |
| `postgres`, `redis`, `object-storage` | pgvector pg16, redis 7, SeaweedFS | State. Named Docker volumes |

One public host serves every path, as `scripts/dev-tunnel-proxy.mjs` does in development:

| Path | Destination |
|---|---|
| `/api/*` | `api` |
| `/webhooks/*` | `webhook` |
| `/media/*` | Bucket, GET/HEAD only |
| `/widget.js` | Widget |
| `/`, `/images/*`, `/fonts/*`, `/_astro/*` | Marketing site |
| Anything else | Dashboard |

The images do not depend on the domain. The domain lives only in `/opt/rapiz/.env`.

The hermes-runtime sidecar is not part of this stack. Configure an LLM provider (e.g. an OpenAI API key) in Admin → LLM.

## First install (once per server)

1. **DNS.** Add an `A` record for the host pointing at the server IP. If the zone is on Cloudflare, start with **DNS only** (grey cloud) so Caddy can obtain its certificate. You can switch to proxied later with SSL mode *Full (strict)*.
2. **Bootstrap.** As root on the server, with `infra/deploy/` copied over (e.g. `scp -r infra/deploy root@<ip>:/root/`), run:
   ```bash
   bash /root/deploy/bootstrap.sh <host> <acme-email> /root/ci_deploy.pub
   ```
   - It installs Docker if missing.
   - It enables ufw with only 22, 80 and 443 open.
   - It creates the `deploy` user. CI logs in as this user, using the public key given as the last argument.
   - It writes `/opt/rapiz/.env` with generated secrets (mode 600; an existing file is never overwritten).
   - It installs the daily backup cron.
3. **Meta values.** Fill the Meta values in `/opt/rapiz/.env` if the inbox should connect Pages.
4. **GitHub settings.** Under Settings → Environments → `production` (Settings → Secrets → Actions also works for the secrets):
   - Secret `DEPLOY_HOST`: the server IP.
   - Secret `DEPLOY_USER`: `deploy`.
   - Secret `DEPLOY_SSH_KEY`: the CI private key.
   - Secret `DEPLOY_KNOWN_HOSTS`: the output of `ssh-keyscan <ip>`.
   - Variable `PUBLIC_HOST`: the host. It is only used for the environment link.
   - Variable `DEPLOY_ENABLED`: `true`. Until it is set, the Deploy workflow skips.
5. **First deploy.** Run Actions → Deploy → *Run workflow*, or merge anything into `main`.
6. **First platform admin.** Sign up in the dashboard, then make that account a platform admin:
   `docker compose -f /opt/rapiz/compose.yml exec api node apps/backend/dist/cli/platform-admin.js grant <email>`
7. **LLM provider.** Add one in Admin → LLM. Without it, production answers 503 for bot turns.

## Every change

Merge into `main`. CI runs; when it is green, the **Deploy** workflow does the rest:
1. Builds both images and pushes them to GHCR, tagged with the commit SHA.
2. Copies the `infra/deploy` scripts to `/opt/rapiz`.
3. Runs `./deploy.sh <sha>` on the server:
   - pull;
   - start the stateful services;
   - ensure the bucket exists;
   - run `migrate`;
   - `up --wait`.

If the services do not become healthy, `deploy.sh` restarts the previous tag and the workflow fails.

Migrations only move forward, so they must stay backward compatible (docs/10 §3). The previous release then still works on the migrated schema.

## Operations (as `deploy` in `/opt/rapiz`)

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f --tail 100 api agent webhook` |
| Roll back to the previous release | `./deploy.sh rollback` |
| Deploy a specific commit | `./deploy.sh <sha>` (requires `docker login ghcr.io` with a token that can read packages) |
| Change domain | Point the new domain's DNS at the server, then `./set-host.sh <new-host>`, then update the Meta app's webhook URL, OAuth redirect URIs and app domains |
| Backup now | `./backup.sh` (daily at 03:15 UTC by cron, 14 days kept in `backups/`) |

### Restore

```bash
docker compose stop api agent worker webhook
docker compose exec -T postgres pg_restore -U rapiz_owner -d rapiz --clean --if-exists < backups/<file>.dump
docker compose start api agent worker webhook
```

Backups live on the same disk. Copy `backups/` off the server regularly; off-site backup is not automated yet.

## Security notes

- Only `edge` publishes ports. Postgres, Redis, the S3 API and `/metrics` are not reachable from outside.
- Use SSH keys only. Once key login works, set `PasswordAuthentication no` in `/etc/ssh/sshd_config.d/` and restart `ssh`.
- `.env` holds every secret. Never paste it into chat, logs or tickets. The pulls use the CI job's short-lived `GITHUB_TOKEN`, and the workflow logs out right after.
