# Runbook — deploy to a single VPS

The whole product runs on one server with Docker Compose: `infra/deploy/`. This is the
Stage 1 single-node setup from docs/10 §2, without Patroni, Sentinel or the LGTM stack yet.

## What runs

| Service | Image | Role |
|---|---|---|
| `edge` | `ghcr.io/<repo>/edge:<sha>` | Caddy on plain HTTP :80. Serves the dashboard SPA, the marketing site and `widget.js`, and proxies the rest. The server's Nginx Proxy Manager (NPM) terminates HTTPS and reaches it as `rapiz-edge:80` on the external `proxy` network |
| `api`, `agent`, `worker`, `webhook` | `ghcr.io/<repo>/app:<sha>` | Backend processes. One image; the command picks the entry |
| `migrate` | same `app` image | One-shot job. Applies SQL migrations and creates or updates the `rapiz_tenant`/`rapiz_system` logins |
| `postgres` | `rapiz-postgres:local` (pgvector pg16 + WAL-G, rclone, age), built on the server from `infra/deploy/postgres` | State. Named volume; `backend` network, plus `default` for WAL uploads to the off-site bucket ([backup runbook](backup-and-restore.md)) |
| `redis`, `object-storage` | redis 7, SeaweedFS | State. Named Docker volumes, internal `backend` network only |
| `backup`, `pgdrill` (profile `tools`) | `rapiz-postgres:local` | Off-site media/config copies and restore target; run by the backup scripts only |

One public host serves every path, as `scripts/dev-tunnel-proxy.mjs` does in development:

| Path | Destination |
|---|---|
| `/api/*` | `api` |
| `/webhooks/*` | `webhook` |
| `/media/*` | Bucket, GET/HEAD only |
| `/widget.js` | Widget |
| `/`, `/images/*`, `/fonts/*`, `/static/*` and the page folders (`/nganh/*`, `/tinh-nang/*`, `/tich-hop/`, `/bao-mat/`, `/bang-gia/`, `/dat-lich-demo/`, `/ve-rapiz/`) | Marketing site |
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
   It copies the server files to `/opt/apps/rapiz`, writes `.env` with generated secrets (mode 600; an existing file is never overwritten) and installs the backup cron lines. Then switch on off-site backups: [backup-and-restore.md](backup-and-restore.md#switching-it-on-once). Add the Meta values to `.env` if the inbox should connect Pages. Add `RESEND_API_KEY` (a send-only key from Resend, with the `rapiz.io` domain verified there): signup emails a code and cannot finish without it (ADR-023). For device notifications of the installable app (T-190) add a VAPID pair: `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` (`npx web-push generate-vapid-keys`, keep the pair: a new pair invalidates every registered device) and optionally `WEB_PUSH_SUBJECT` (default `mailto:support@rapiz.io`).
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
9. **Plans and trial.** In Admin (`/admin/plans` for the catalog, `/admin/settings` for trial, lifecycle and bank account): check the plan catalog and prices, set the VietQR bank account, then turn the signup trial on (it ships off, so a deploy alone changes nothing for new signups). The `worker` service runs the subscription lifecycle (trial end, past due, suspension) every 5 minutes; keep it running.
10. **Website chat (optional).** Rapiz's own pages show a chat bubble once the edge has a site key. Sign up the owner, then run `docker compose exec api node apps/backend/dist/cli/rapiz-site-bot.js seed --owner <email> --domains <host>,www.<host>` (idempotent; prints `site key: wk_…`), add `RAPIZ_SITE_WIDGET_KEY=wk_…` to `.env` and run `docker compose --env-file .env up -d edge`. Unset, the pages load no widget. Details: [apps/site README](../../apps/site/README.md#website-chat).

## Every change

Merge into `main`. CI runs; when it is green, the **Deploy** workflow does the rest:
1. Builds both images and pushes them to GHCR, tagged with the commit SHA.
2. Copies `compose.yml`, every `infra/deploy/*.sh` and `infra/deploy/postgres/` to `/opt/apps/rapiz`.
3. Runs `./deploy.sh <sha>` on the server:
   - pull, and build the postgres image (cached);
   - start the stateful services;
   - ensure the bucket exists;
   - run `migrate`;
   - `up --wait`;
   - reinstall the backup cron lines.

If the services do not become healthy, `deploy.sh` restarts the previous tag and the workflow fails.

Migrations only move forward, so they must stay backward compatible (docs/10 §3). The previous release then still works on the migrated schema.

## Owner assistant SQL lane (existing installs)

The owner assistant answers number questions through a read-only SQL login (`rapiz_assistant`, member of `app_assistant_sql` only; T-171). `bootstrap.sh` writes `DATABASE_ASSISTANT_SQL_URL` for new installs. On a server whose `.env` predates it, add the line once, as `deploy` in `/opt/apps/rapiz`:

```bash
echo "DATABASE_ASSISTANT_SQL_URL=postgres://rapiz_assistant:$(openssl rand -hex 24)@postgres:5432/rapiz" >> .env
./deploy.sh <sha>
```

The `migrate` service (`--login-roles`) creates the login with that password, and `api` reads the URL from `.env`. Check the login exists:

```bash
docker compose exec postgres psql -U rapiz_owner -d rapiz -c "select rolname from pg_roles where rolname = 'rapiz_assistant'"
```

Without the line, the SQL lane is off: the assistant falls back to the sales overview route for revenue questions.

## Optional: ChatGPT-plan bridge (testing only)

Bots can run on a ChatGPT-plan login through the Hermes bridge (`services/hermes`) instead of a paid API key. It handles one turn at a time and a personal plan is not meant for a hosted product (see `services/hermes/README.md`), so use it for testing only.

1. Build the image on the server. The context is a staging folder with `hermes-agent/` (the Hermes source, without `.git`, `tests`, `website`, `apps`) and `bridge/` (a copy of `services/hermes` without `var/`):
   `docker build -f hermes.Dockerfile -t rapiz-hermes:local <staging folder>`
2. In `.env`: `COMPOSE_PROFILES=hermes`, `HERMES_BRIDGE_KEY=<random, 32+ characters>` and `HERMES_SUBSCRIPTION_LOGIN=true` (shows the sign-in panel in production).
3. `docker compose --env-file .env up -d hermes api agent worker`.
4. Admin → Mô hình AI: add a **Hermes** provider with address `http://hermes:8788` and the bridge key as API key, press "Đăng nhập ChatGPT" and approve the code, then route the tiers to a model from the list.

The login lives in the `hermes` volume. Do not sign the same ChatGPT account in on another bridge (for example a developer machine) with a copied `auth.json`: two processes rotating one refresh token log each other out.

## Operations (as `deploy` in `/opt/apps/rapiz`)

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f --tail 100 api agent webhook` |
| Roll back to the previous release | `./deploy.sh rollback` |
| Deploy a specific commit | `./deploy.sh <sha>` (requires `docker login ghcr.io` with a token that can read packages) |
| Change domain | Point the new domain's DNS at the server, add it to the NPM proxy host with a certificate, run `./set-host.sh <new-host>`, then update the Meta app's webhook URL, OAuth redirect URIs and app domains |
| Put an account on a plan from the shell | `docker compose exec api node apps/backend/dist/cli/workspace-plan.js set <owner-email> <plan> [months]` (audited like an `/admin` change, reason `cli`) |
| Local dump now | `./backup.sh` (daily at 03:15 UTC by cron, 7 days kept in `backups/`) |
| Off-site backup now / restore drill | `./backup-nightly.sh` / `./restore-drill.sh` ([backup runbook](backup-and-restore.md)) |

### Rolling back T-192 (migration 0066)

Migration 0066 turns each lodging gallery into folders. Releases before T-192 read only the flat list and answer 500 on hotel properties and the bot catalog once a row holds folders. Before `./deploy.sh rollback` to a release before T-192 (and after an automatic rollback to one), flatten the galleries back with the reverse SQL. It ships in the T-192 (or later) image, so read it from that tag:

```bash
RAPIZ_TAG=<T-192-or-later sha> docker compose --env-file .env run --rm --no-deps -T migrate \
  cat packages/db/sql/rollback-0066-lodging-media-folders.sql |
  docker compose --env-file .env exec -T postgres psql -U rapiz_owner -d rapiz -v ON_ERROR_STOP=1
```

It keeps image items only, folder order then item order, captions kept; videos, links and folder names are dropped. It changes nothing else and can run again. Before deploying T-192 or later again, let 0066 run again: `docker compose exec postgres psql -U rapiz_owner -d rapiz -c "delete from schema_migrations where name = '0066_lodging_media_folders.sql'"`.

### Rolling back T-193 (migration 0067)

Migration 0067 adds unit details, the `lodging_packages` table and `package_id` on rates and booking units; 0068 adds `package_ids` on bot hold drafts. Releases before T-193 read every weekday rate of a target as its price, so once a target has packages they would see several prices per weekday (or none). Before `./deploy.sh rollback` to a release before T-193 (and after an automatic rollback to one), run the reverse SQL. It reverses **both 0067 and 0068** and ships in the T-193 (or later) image, so read it from that tag:

```bash
RAPIZ_TAG=<T-193-or-later sha> docker compose --env-file .env run --rm --no-deps -T migrate \
  cat packages/db/sql/rollback-0067-lodging-units-packages.sql |
  docker compose --env-file .env exec -T postgres psql -U rapiz_owner -d rapiz -v ON_ERROR_STOP=1
```

It turns each target's full-package rates (most bedrooms; a tie goes to the later sort order) into plain rates and deletes the other package rates, then drops the package columns of rates, booking units and hold drafts, the `lodging_packages` table and the unit detail columns. Unit details, unit galleries and packages are lost; bookings, their units and totals stay. It can run again and does not touch `schema_migrations`. Before deploying T-193 or later again, delete **both** rows so 0067 and 0068 run again: `docker compose exec postgres psql -U rapiz_owner -d rapiz -c "delete from schema_migrations where name in ('0067_lodging_units_packages.sql', '0068_lodging_bot_hold_draft_packages.sql')"`. Rolling back past T-192 as well: run this section first, then the 0066 one.

### Restore a local dump

For point-in-time restores, a lost server or lost pictures use [backup-and-restore.md](backup-and-restore.md). A local dump is the quick way back to the state before a deploy:

```bash
docker compose stop api agent worker webhook
docker compose exec -T postgres pg_restore -U rapiz_owner -d rapiz --clean --if-exists < backups/<file>.dump
docker compose start api agent worker webhook
```

Local dumps live on the same disk; the off-site copies are in [backup-and-restore.md](backup-and-restore.md).

## Private-beta gate

`./beta-gate.sh on [user]` puts the whole host behind a login in Nginx Proxy Manager. It creates or rotates the password and the gate cookie, and writes the credentials to `~/beta-access.txt` (mode 600) for the owner. `./beta-gate.sh off` removes the gate. Rapiz's own sign-in is unchanged behind it.

| Path | Access |
|---|---|
| Pages and static files | HTTP Basic auth. The bcrypt hash (cost 12) lives in `/data/rapiz-beta/htpasswd` in the NPM data volume. Requests that already carry a valid gate cookie skip the bcrypt check, which otherwise costs about 0.25 s of CPU per file and made the dashboard load in ~10 s |
| `/api/*` | Requires the HttpOnly `rapiz_beta` cookie, which a successful Basic login sets (7 days). The dashboard already sends `Authorization: Bearer` to the API, so Basic auth cannot share that header |
| `/webhooks/*` | Public. The webhook app rejects requests without a valid `X-Hub-Signature-256` |
| `/api[/v1]/channels/oauth/<provider>/callback` | Public. The API checks the OAuth `state` |
| `/media/*` | Public, read-only, so Meta can download product pictures. The `Authorization` header is dropped: browsers resend the Basic credentials and the bucket rejects them as a bad S3 signature (broken images) |
| `/widget.js`, `/api/v1/webchat/v1/sites/*` | Public, so the website chat bubble works on customer sites and on Rapiz's own pages. Visitors there carry no gate cookie and the widget sends no credentials. The API checks the site key, the allowed domains and the signed visitor token |

Neither the password nor the gate token is in Git. The token sits in the NPM proxy host's advanced config, which is root-only on the server. NPM must keep *Force SSL* on, so the Basic credentials only travel over HTTPS.

## Security notes

- No container publishes ports. Only `edge` is reachable, and only through NPM. Postgres, Redis and the S3 API sit on an internal network; `/metrics` is not routed.
- Use SSH keys only. Once key login works, set `PasswordAuthentication no` in `/etc/ssh/sshd_config.d/` and restart `ssh`.
- `.env` holds every secret. Never paste it into chat, logs or tickets. The pulls use the CI job's short-lived `GITHUB_TOKEN`, and the workflow logs out right after.
