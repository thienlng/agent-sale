# Runbook — deploy to a single VPS

The whole product runs on one server with Docker Compose: `infra/deploy/`. This is the
Stage 1 single-node setup from docs/10 §2, without Patroni, Sentinel or the LGTM stack yet.

## What runs

| Service | Image | Role |
|---|---|---|
| `edge` | `ghcr.io/<repo>/edge:<sha>` | Caddy on plain HTTP :80, unprivileged and stateless. Sets the security headers (docs/09 §6). Serves the dashboard SPA, the marketing site and `widget.js`, and proxies the rest. The server's Nginx Proxy Manager (NPM) terminates HTTPS and reaches it as `rapiz-edge:80` on the external `proxy` network |
| `api`, `agent`, `worker`, `webhook` | `ghcr.io/<repo>/app:<sha>` | Backend processes. One image; the command picks the entry |
| `migrate` | same `app` image | One-shot job. Applies SQL migrations and creates or updates the `rapiz_tenant`/`rapiz_system` logins |
| `postgres` | `rapiz-postgres:local` (pgvector pg16 + WAL-G, rclone, age), built on the server from `infra/deploy/postgres` | State. Named volume; `backend` network, plus `default` for WAL uploads to the off-site bucket ([backup runbook](backup-and-restore.md)) |
| `redis`, `object-storage` | redis 7, SeaweedFS (pinned by digest) | State. Named Docker volumes, internal `backend` network only. Redis requires `REDIS_PASSWORD`; SeaweedFS exposes only its S3 port, and its filer and volume servers require a JWT signed with `SEAWEEDFS_JWT_KEY` |
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
   It copies the server files to `/opt/apps/rapiz` (including `deploy-ssh.sh`, the deploy key's forced command), writes `.env` with generated secrets (mode 600; an existing file is never overwritten; among them `REDIS_PASSWORD`, `REDIS_URL` with it, and `SEAWEEDFS_JWT_KEY`) and installs the backup cron lines. Then switch on off-site backups: [backup-and-restore.md](backup-and-restore.md#switching-it-on-once). Add the Meta values to `.env` if the inbox should connect Pages. Add `RESEND_API_KEY` (a send-only key from Resend, with the `rapiz.io` domain verified there): signup emails a code and cannot finish without it (ADR-023). For "Continue with Google" add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from a Google Cloud OAuth web client whose authorized redirect URI is `https://rapiz.io/api/v1/auth/google/callback` (the first `APP_ORIGINS` entry + `/api/v1/auth/google/callback`; override with `GOOGLE_REDIRECT_URI`). For device notifications of the installable app (T-190) add a VAPID pair: `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` (`npx web-push generate-vapid-keys`, keep the pair: a new pair invalidates every registered device) and optionally `WEB_PUSH_SUBJECT` (default `mailto:support@rapiz.io`).
4. **First deploy.** Run `./deploy.sh <sha>` on the server after `docker login ghcr.io`, or use the workflow (step 6).
5. **NPM proxy host.** In the NPM admin UI (`ssh -N -L 8181:127.0.0.1:81 deploy@<ip>`, then http://127.0.0.1:8181), add a proxy host:
   - Domain: `<host>`.
   - Forward: scheme `http`, host `rapiz-edge`, port `80`.
   - Turn on *Websockets support* and *Block common exploits*.
   - SSL tab: request a Let's Encrypt certificate, then turn on *Force SSL* and *HTTP/2*.
6. **GitHub (repo admin).** Create the environment Settings → Environments → `production`:
   - *Deployment branches and tags*: selected branches, `main` only.
   - *Required reviewers*: the maintainer (each deploy then waits for an approval), and *Prevent self-review* off only if the maintainer is the sole reviewer.
   - Environment secrets (not repository or organization secrets, so only a job of this environment on `main` can read them): `DEPLOY_HOST` (the server IP), `DEPLOY_USER` (`deploy`), `DEPLOY_SSH_KEY` (see [Deploy key](#deploy-key)), `DEPLOY_KNOWN_HOSTS` (the output of `ssh-keyscan <ip>`, checked against the server's own host key fingerprint).
   - Variable `PUBLIC_HOST`: the host. It is only used for the environment link.
   - Repository variable `DEPLOY_ENABLED`: `true`. Until it is set, the Deploy workflow skips.
   - Branch protection on `main` (required PR review and CI): the environment trusts whatever reaches `main`.
7. **First platform admin.** Sign up in the dashboard, then make that account a platform admin:
   `RAPIZ_TAG=$(cat .deployed-tag) docker compose exec api node apps/backend/dist/cli/platform-admin.js grant <email>`
8. **LLM provider.** Add one in Admin → LLM. Without it, production answers 503 for bot turns.
9. **Plans and trial.** In Admin (`/admin/plans` for the catalog, `/admin/settings` for trial, lifecycle and bank account): check the plan catalog and prices, set the VietQR bank account, then turn the signup trial on (it ships off, so a deploy alone changes nothing for new signups). The `worker` service runs the subscription lifecycle (trial end, past due, suspension) every 5 minutes; keep it running.
10. **Website chat (optional).** Rapiz's own pages show a chat bubble once the edge has a site key. Sign up the owner, then run `RAPIZ_TAG=$(cat .deployed-tag) docker compose exec api node apps/backend/dist/cli/rapiz-site-bot.js seed --owner <email> --domains <host>,www.<host>` (idempotent; also puts the plans in the bot's catalog with pictures fetched from the live site, so behind the beta gate add `--site http://edge`; prints `site key: wk_…`), add `RAPIZ_SITE_WIDGET_KEY=wk_…` to `.env` and run `RAPIZ_TAG=$(cat .deployed-tag) docker compose --env-file .env up -d edge`. Unset, the pages load no widget. Details: [apps/site README](../../apps/site/README.md#website-chat).

## Deploy key

The CI key reaches a user in the `docker` group, which is root-equivalent. The server therefore pins it to one command. Generate a dedicated key (`ssh-keygen -t ed25519 -N '' -C rapiz-ci-deploy -f rapiz-ci-deploy`), store the private half as the `DEPLOY_SSH_KEY` environment secret, delete the local copy, and put the public half in `~deploy/.ssh/authorized_keys` as:

```
command="/opt/apps/rapiz/deploy-ssh.sh",restrict ssh-ed25519 AAAA… rapiz-ci-deploy
```

`restrict` turns off port, agent and X11 forwarding, the PTY and `~/.ssh/rc` (it implies `no-port-forwarding,no-pty`). `deploy-ssh.sh` reads the request from `SSH_ORIGINAL_COMMAND` and accepts only:

| Request | Does |
|---|---|
| `deploy <40-hex commit SHA>` | Reads the GHCR user and token from stdin (one line each), logs in, takes `compose.yml`, the scripts and `postgres/` out of `<RAPIZ_IMAGE>/app:<sha>` (the files of that reviewed commit), runs `./deploy.sh <sha>`, logs out |
| `rollback` | `./deploy.sh rollback` |

Anything else is refused. The image repository comes from `RAPIZ_IMAGE` in `.env` (default `ghcr.io/thienlng/agent-sale`), never from the caller, so a stolen key cannot pick another registry or run other commands. It can still deploy any image CI ever built from `main`, including an older release with known bugs (its `compose.yml` and scripts come with it), and run `rollback`; migrations only move forward, so an old release runs on the newer schema. Treat a leaked key as an incident: remove its line from `authorized_keys`, put a new key in the environment secret, and redeploy the current `main`. Keep your own login key separate and unrestricted. Do not reuse the CI key anywhere else.

The workflow only runs on `main` (a manual run on another ref is refused) and only as the `production` environment. Images are tagged with the commit SHA only; there is no `:latest`.

## Every change

Merge into `main`. CI runs; when it is green (and the environment reviewer approves), the **Deploy** workflow does the rest:
1. Builds both images and pushes them to GHCR, tagged with the commit SHA.
2. Runs `deploy-ssh.sh deploy <sha>` over the deploy key. It copies `compose.yml`, every `infra/deploy/*.sh` and `infra/deploy/postgres/` out of the new app image into `/opt/apps/rapiz`.
3. Runs `./deploy.sh <sha>` on the server:
   - add secrets missing from an older `.env` (`REDIS_PASSWORD`, `SEAWEEDFS_JWT_KEY`; see below);
   - pull, and build the postgres image (cached);
   - start the stateful services;
   - ensure the bucket exists;
   - run `migrate`;
   - `up --wait`;
   - reinstall the backup cron lines.

If the services do not become healthy, `deploy.sh` restarts the previous tag and the workflow fails.

Migrations only move forward, so they must stay backward compatible (docs/10 §3). The previous release then still works on the migrated schema.

## Security hardening (existing installs, once)

The release that adds `deploy-ssh.sh` changes how CI reaches the server. Before merging it (or the first deploy fails at "deploy-ssh.sh: not found"):

1. As `deploy`, copy `infra/deploy/deploy-ssh.sh` from that release to `/opt/apps/rapiz/deploy-ssh.sh` (`chmod 755`).
2. Replace the CI key's line in `~/.ssh/authorized_keys` with the forced-command form in [Deploy key](#deploy-key), ideally with a new key.
3. Move the `DEPLOY_*` secrets from repository secrets to the `production` environment and set its branch rule and reviewer (first install, step 6). Delete the repository-level copies.
4. Check the NPM admin login file: `chmod 600 ~/npm-admin.txt` (`beta-gate.sh` also tightens it).
5. Check the SeaweedFS version the server runs. `compose.yml` used to say `chrislusf/seaweedfs:latest` and now pins `4.53`; a server that pulled a newer `latest` would be downgraded, and SeaweedFS does not promise that older versions read newer metadata. Run
   `docker image inspect -f '{{.Created}} {{index .RepoDigests 0}}' "$(docker inspect -f '{{.Image}}' rapiz-object-storage-1)"` and
   `docker exec rapiz-object-storage-1 weed version`. If it reports a version above 4.53, raise the pin in `infra/deploy/compose.yml` (and `infra/deploy/test/compose.override.yml`) to that version and its digest before merging.
6. Make sure `/opt/apps/rapiz/.deployed-tag` holds the running commit SHA (`deploy.sh` writes it). `compose.yml` no longer falls back to `:latest`, so every manual `docker compose` command needs `RAPIZ_TAG=$(cat .deployed-tag)`, as below.

The first deploy of that release then, without any manual step:

- adds `REDIS_PASSWORD` and `SEAWEEDFS_JWT_KEY` to `.env` (random, generated once, never changed) and rewrites `REDIS_URL=redis://redis:6379` to carry the password. A custom `REDIS_URL` is left alone: add the password to it yourself. Redis keeps no state the app needs (queues and caches only).
- restarts SeaweedFS listening on loopback for its master, volume and filer ports, with only S3 (8333) reachable from the other containers. Existing data stays readable (tested on a copy of the volume).
- runs the edge without the old `caddydata`/`caddyconfig` volumes (no certificates live there: NPM terminates HTTPS). Remove them afterwards with `docker volume rm rapiz_caddydata rapiz_caddyconfig`.

Rolling back to an older release keeps the new `compose.yml` and `.env`, so Redis and SeaweedFS stay protected.

## Owner assistant SQL lane (existing installs)

The owner assistant answers number questions through a read-only SQL login (`rapiz_assistant`, member of `app_assistant_sql` only; T-171). `bootstrap.sh` writes `DATABASE_ASSISTANT_SQL_URL` for new installs. On a server whose `.env` predates it, add the line once, as `deploy` in `/opt/apps/rapiz`:

```bash
echo "DATABASE_ASSISTANT_SQL_URL=postgres://rapiz_assistant:$(openssl rand -hex 24)@postgres:5432/rapiz" >> .env
./deploy.sh <sha>
```

The `migrate` service (`--login-roles`) creates the login with that password, and `api` reads the URL from `.env`. Check the login exists:

```bash
RAPIZ_TAG=$(cat .deployed-tag) docker compose exec postgres psql -U rapiz_owner -d rapiz -c "select rolname from pg_roles where rolname = 'rapiz_assistant'"
```

Without the line, the SQL lane is off: the assistant falls back to the sales overview route for revenue questions.

## Optional: ChatGPT-plan bridge (testing only)

Bots can run on a ChatGPT-plan login through the Hermes bridge (`services/hermes`) instead of a paid API key. It handles one turn at a time and a personal plan is not meant for a hosted product (see `services/hermes/README.md`), so use it for testing only.

1. Build the image on the server. The context is a staging folder with `hermes-agent/` (the Hermes source, without `.git`, `tests`, `website`, `apps`) and `bridge/` (a copy of `services/hermes` without `var/`):
   `docker build -f hermes.Dockerfile -t rapiz-hermes:local <staging folder>`
2. In `.env`: `COMPOSE_PROFILES=hermes`, `HERMES_BRIDGE_KEY=<random, 32+ characters>` and `HERMES_SUBSCRIPTION_LOGIN=true` (shows the sign-in panel in production).
3. `RAPIZ_TAG=$(cat .deployed-tag) docker compose --env-file .env up -d hermes api agent worker`.
4. Admin → Mô hình AI: add a **Hermes** provider with address `http://hermes:8788` and the bridge key as API key, press "Đăng nhập ChatGPT" and approve the code, then route the tiers to a model from the list.

The login lives in the `hermes` volume. Do not sign the same ChatGPT account in on another bridge (for example a developer machine) with a copied `auth.json`: two processes rotating one refresh token log each other out.

## Operations (as `deploy` in `/opt/apps/rapiz`)

`compose.yml` requires the image tag (`RAPIZ_TAG`, no default): `deploy.sh` sets it, the backup scripts read `.deployed-tag`, and a manual `docker compose` command needs the `RAPIZ_TAG=$(cat .deployed-tag)` prefix shown here (or `export RAPIZ_TAG=$(cat .deployed-tag)` once per shell). Without it compose stops with "required variable RAPIZ_TAG is missing a value".

| Task | Command |
|---|---|
| Status | `RAPIZ_TAG=$(cat .deployed-tag) docker compose ps` |
| Logs | `RAPIZ_TAG=$(cat .deployed-tag) docker compose logs -f --tail 100 api agent webhook` |
| Roll back to the previous release | `./deploy.sh rollback` |
| Deploy a specific commit | `./deploy-ssh.sh deploy <sha>` (takes that commit's server files too) or `./deploy.sh <sha>` (requires `docker login ghcr.io` with a token that can read packages; `./deploy-ssh.sh` reads the user and token from stdin) |
| Change domain | Point the new domain's DNS at the server, add it to the NPM proxy host with a certificate, run `./set-host.sh <new-host>`, then update the Meta app's webhook URL, OAuth redirect URIs and app domains |
| Put an account on a plan from the shell | `RAPIZ_TAG=$(cat .deployed-tag) docker compose exec api node apps/backend/dist/cli/workspace-plan.js set <owner-email> <plan> [months]` (audited like an `/admin` change, reason `cli`) |
| Local dump now | `./backup.sh` (daily at 03:15 UTC by cron, 7 days kept in `backups/`; encrypted to `BACKUP_AGE_RECIPIENT` once off-site backups are on) |
| Off-site backup now / restore drill | `./backup-nightly.sh` / `./restore-drill.sh` ([backup runbook](backup-and-restore.md)) |

### Rolling back T-192 (migration 0066)

Migration 0066 turns each lodging gallery into folders. Releases before T-192 read only the flat list and answer 500 on hotel properties and the bot catalog once a row holds folders. Before `./deploy.sh rollback` to a release before T-192 (and after an automatic rollback to one), flatten the galleries back with the reverse SQL. It ships in the T-192 (or later) image, so read it from that tag:

```bash
RAPIZ_TAG=<T-192-or-later sha> docker compose --env-file .env run --rm --no-deps -T migrate \
  cat packages/db/sql/rollback-0066-lodging-media-folders.sql |
  RAPIZ_TAG=$(cat .deployed-tag) docker compose --env-file .env exec -T postgres psql -U rapiz_owner -d rapiz -v ON_ERROR_STOP=1
```

It keeps image items only, folder order then item order, captions kept; videos, links and folder names are dropped. It changes nothing else and can run again. Before deploying T-192 or later again, let 0066 run again: `RAPIZ_TAG=$(cat .deployed-tag) docker compose exec postgres psql -U rapiz_owner -d rapiz -c "delete from schema_migrations where name = '0066_lodging_media_folders.sql'"`.

### Rolling back T-193 (migration 0067)

Migration 0067 adds unit details, the `lodging_packages` table and `package_id` on rates and booking units; 0068 adds `package_ids` on bot hold drafts. Releases before T-193 read every weekday rate of a target as its price, so once a target has packages they would see several prices per weekday (or none). Before `./deploy.sh rollback` to a release before T-193 (and after an automatic rollback to one), run the reverse SQL. It reverses **both 0067 and 0068** and ships in the T-193 (or later) image, so read it from that tag:

```bash
RAPIZ_TAG=<T-193-or-later sha> docker compose --env-file .env run --rm --no-deps -T migrate \
  cat packages/db/sql/rollback-0067-lodging-units-packages.sql |
  RAPIZ_TAG=$(cat .deployed-tag) docker compose --env-file .env exec -T postgres psql -U rapiz_owner -d rapiz -v ON_ERROR_STOP=1
```

It turns each target's full-package rates (most bedrooms; a tie goes to the later sort order) into plain rates and deletes the other package rates, then drops the package columns of rates, booking units and hold drafts, the `lodging_packages` table and the unit detail columns. Unit details, unit galleries and packages are lost; bookings, their units and totals stay. It can run again and does not touch `schema_migrations`. Before deploying T-193 or later again, delete **both** rows so 0067 and 0068 run again: `RAPIZ_TAG=$(cat .deployed-tag) docker compose exec postgres psql -U rapiz_owner -d rapiz -c "delete from schema_migrations where name in ('0067_lodging_units_packages.sql', '0068_lodging_bot_hold_draft_packages.sql')"`. Rolling back past T-192 as well: run this section first, then the 0066 one.

### Restore a local dump

For point-in-time restores, a lost server or lost pictures use [backup-and-restore.md](backup-and-restore.md). A local dump is the quick way back to the state before a deploy:

```bash
RAPIZ_TAG=$(cat .deployed-tag) docker compose stop api agent worker webhook
# Encrypted dump (rapiz-*.dump.age): the age private key is only in the break-glass kit. Put it in a
# private file for the restore and remove it right after.
(umask 077 && cat > /tmp/age-key.txt)   # paste the AGE-SECRET-KEY-… line, then Ctrl-D
docker run --rm -i --entrypoint age -v /tmp/age-key.txt:/k:ro rapiz-postgres:local -d -i /k < backups/<file>.dump.age |
  RAPIZ_TAG=$(cat .deployed-tag) docker compose exec -T postgres pg_restore -U rapiz_owner -d rapiz --clean --if-exists
shred -u /tmp/age-key.txt
# A plain dump (rapiz-*.dump, written while BACKUP_AGE_RECIPIENT was unset):
RAPIZ_TAG=$(cat .deployed-tag) docker compose exec -T postgres pg_restore -U rapiz_owner -d rapiz --clean --if-exists < backups/<file>.dump
RAPIZ_TAG=$(cat .deployed-tag) docker compose start api agent worker webhook
```

Local dumps live on the same disk; the off-site copies are in [backup-and-restore.md](backup-and-restore.md).

## Private-beta gate

`./beta-gate.sh on [user]` puts the whole host behind a login in Nginx Proxy Manager. It creates or rotates the password and the gate cookie, and writes the credentials to `~/beta-access.txt` (mode 600) for the owner. `./beta-gate.sh off` removes the gate. Rapiz's own sign-in is unchanged behind it. It reads the NPM admin login from `~/npm-admin.txt` and tightens that file to mode 600.

Every tester shares one login and one gate cookie. **Rotate** (`./beta-gate.sh on` again) whenever a tester leaves or the password may have spread, and at least monthly: it replaces the password and ends every gate cookie at once. Per-tester logins would need one htpasswd line and one gate token per person; not worth it for a short beta, so the gate is a speed bump and Rapiz's own sign-in stays the real access control.

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

- No container publishes ports. Only `edge` is reachable, and only through NPM. Postgres, Redis and the S3 API sit on an internal network; `/metrics` is not routed and `/api/v1/health/ready` answers 404 at the edge (compose healthchecks call it inside the network). In production `/api/v1/health` carries no build version and `/api/v1/openapi.json` lists the public API only.
- Redis requires a password and SeaweedFS's filer, master and volume servers are not reachable from the other containers (only S3 is), so a compromised neighbour container cannot read or wipe them without the keys.
- Headers (docs/09 §6): HSTS is `max-age=31536000` without `includeSubDomains`, because not every subdomain of the public host is known to serve HTTPS. Add it (and consider preload) only after checking every subdomain. The dashboard CSP is report-only until checked in every flow; frame-ancestors is enforced everywhere. The report-only policy has no reporting endpoint, so the check is manual: sign in on the live host with the browser's developer tools open, walk every flow (inbox with pictures and videos, product and lodging editors with uploads and YouTube or Drive videos, settings, billing, admin, notifications, the installed app) and look for `[Report Only] Refused to …` lines in the console; or let a Playwright crawl of the same pages collect `console` messages containing `Content-Security-Policy`. Widen the policy in `infra/deploy/Caddyfile` for each legitimate violation, then switch the header to `Content-Security-Policy` once a full pass is clean.
- The marketing site's enforced CSP allows scripts and connections from the same origin only. Its chat bubble must stay same-origin (`/widget.js`, `/api`): the edge passes `RAPIZ_SITE_WIDGET_KEY` only, never a widget source or API on another host ([apps/site README](../../apps/site/README.md#website-chat)).
- Images are pinned by digest and actions by commit SHA; Dependabot (`docker`, `docker-compose`, `github-actions`) proposes updates.
- Use SSH keys only. Once key login works, set `PasswordAuthentication no` in `/etc/ssh/sshd_config.d/` and restart `ssh`.
- `.env` holds every secret. Never paste it into chat, logs or tickets. The pulls use the CI job's short-lived `GITHUB_TOKEN`, and `deploy-ssh.sh` logs out right after.
- Server-side checks that no file in this repository can enforce are listed in [the attack-surface review](../security/2026-11-12-attack-surface.md#verify-on-the-server).
