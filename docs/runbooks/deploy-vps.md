# Runbook — deploy to a single VPS

The whole product runs on one server with Docker Compose: `infra/deploy/`. This is the
Stage 1 single-node setup from docs/10 §2, without Patroni, Sentinel or the LGTM stack yet.

## What runs

| Service | Image | Role |
|---|---|---|
| `edge` | `ghcr.io/<repo>/edge:<sha>` | Caddy on plain HTTP :80. Serves the dashboard SPA, the marketing site and `widget.js`, and proxies the rest. The server's Nginx Proxy Manager (NPM) terminates HTTPS and reaches it as `rapiz-edge:80` on the external `proxy` network |
| `api`, `agent`, `worker`, `webhook` | `ghcr.io/<repo>/app:<sha>` | Backend processes. One image; the command picks the entry |
| `migrate` | same `app` image | One-shot job. Applies SQL migrations and creates or updates the `rapiz_tenant`/`rapiz_system` logins |
| `postgres`, `redis`, `object-storage` | pgvector pg16, redis 7, SeaweedFS | State. Named Docker volumes, internal `backend` network only |

One public host serves every path, as `scripts/dev-tunnel-proxy.mjs` does in development:

| Path | Destination |
|---|---|
| `/api/*` | `api` |
| `/webhooks/*` | `webhook` |
| `/media/*` | Bucket, GET/HEAD only |
| `/widget.js` | Widget |
| `/`, `/images/*`, `/fonts/*`, `/_astro/*` | Marketing site |
| Anything else | Dashboard |

The images do not depend on the domain. The domain lives only in `/opt/apps/rapiz/.env`.

The hermes-runtime sidecar is not part of this stack. Configure an LLM provider (e.g. an OpenAI API key) in Admin → LLM.

## First install (once per server)

The server follows `/opt/infra/README.md` on the host: apps live in `/opt/apps/<app>`, only the web container joins the NPM `proxy` network, and nothing publishes ports.

1. **Admin prerequisites (sudo, once).**
   ```bash
   sudo usermod -aG docker deploy
   sudo install -d -o deploy -g deploy -m 750 /opt/apps/rapiz
   ```
   The `proxy` network comes with NPM. Note that the docker group is root-equivalent, like the deploy user's sudo.
2. **DNS.** Add an `A` record for the host pointing at the server IP. On Cloudflare, use **DNS only** (grey cloud) so NPM can obtain the Let's Encrypt certificate.
3. **Bootstrap (as `deploy`).** Copy `infra/deploy/` to the server and run:
   ```bash
   bash deploy/bootstrap.sh <host>
   ```
   It copies the server files to `/opt/apps/rapiz`, writes `.env` with generated secrets (mode 600; an existing file is never overwritten) and adds the daily backup to deploy's crontab. Add the Meta values to `.env` if the inbox should connect Pages.
4. **First deploy.** Run `./deploy.sh <sha>` on the server after `docker login ghcr.io`, or use the workflow (step 6).
5. **NPM proxy host.** In the NPM admin UI (`ssh -N -L 8181:127.0.0.1:81 deploy@<ip>`, then http://127.0.0.1:8181), add a proxy host:
   - Domain: `<host>`.
   - Forward: scheme `http`, host `rapiz-edge`, port `80`.
   - Turn on *Websockets support* and *Block common exploits*.
   - SSL tab: request a Let's Encrypt certificate, then turn on *Force SSL* and *HTTP/2*.
6. **GitHub (repo admin).** Under Settings → Environments → `production` (or Actions secrets/variables), set:
   - Secret `DEPLOY_HOST`: the server IP.
   - Secret `DEPLOY_USER`: `deploy`.
   - Secret `DEPLOY_SSH_KEY`: a private key whose public half is in deploy's `authorized_keys`.
   - Secret `DEPLOY_KNOWN_HOSTS`: the output of `ssh-keyscan <ip>`.
   - Variable `PUBLIC_HOST`: the host. It is only used for the environment link.
   - Variable `DEPLOY_ENABLED`: `true`. Until it is set, the Deploy workflow skips.
7. **First platform admin.** Sign up in the dashboard, then make that account a platform admin:
   `docker compose exec api node apps/backend/dist/cli/platform-admin.js grant <email>`
8. **LLM provider.** Add one in Admin → LLM. Without it, production answers 503 for bot turns.

## Every change

Merge into `main`. CI runs; when it is green, the **Deploy** workflow does the rest:
1. Builds both images and pushes them to GHCR, tagged with the commit SHA.
2. Copies the `infra/deploy` scripts to `/opt/apps/rapiz`.
3. Runs `./deploy.sh <sha>` on the server:
   - pull;
   - start the stateful services;
   - ensure the bucket exists;
   - run `migrate`;
   - `up --wait`.

If the services do not become healthy, `deploy.sh` restarts the previous tag and the workflow fails.

Migrations only move forward, so they must stay backward compatible (docs/10 §3). The previous release then still works on the migrated schema.

## Operations (as `deploy` in `/opt/apps/rapiz`)

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f --tail 100 api agent webhook` |
| Roll back to the previous release | `./deploy.sh rollback` |
| Deploy a specific commit | `./deploy.sh <sha>` (requires `docker login ghcr.io` with a token that can read packages) |
| Change domain | Point the new domain's DNS at the server, add it to the NPM proxy host with a certificate, run `./set-host.sh <new-host>`, then update the Meta app's webhook URL, OAuth redirect URIs and app domains |
| Backup now | `./backup.sh` (daily at 03:15 UTC by cron, 14 days kept in `backups/`) |

### Restore

```bash
docker compose stop api agent worker webhook
docker compose exec -T postgres pg_restore -U rapiz_owner -d rapiz --clean --if-exists < backups/<file>.dump
docker compose start api agent worker webhook
```

Backups live on the same disk. Copy `backups/` off the server regularly; off-site backup is not automated yet.

## Security notes

- No container publishes ports. Only `edge` is reachable, and only through NPM. Postgres, Redis and the S3 API sit on an internal network; `/metrics` is not routed.
- Use SSH keys only. Once key login works, set `PasswordAuthentication no` in `/etc/ssh/sshd_config.d/` and restart `ssh`.
- `.env` holds every secret. Never paste it into chat, logs or tickets. The pulls use the CI job's short-lived `GITHUB_TOKEN`, and the workflow logs out right after.
