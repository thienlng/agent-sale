# Attack-surface review — 2026-11-12

Companion to the [code audit of the same day](2026-11-12-security-audit.md). That audit looked for
vulnerabilities with high confidence and left out denial of service, cost exhaustion and
infrastructure. This review takes the attacker's view of the whole product: what an outsider, a
customer chatting with a shop's bot, a tenant, or someone holding a leaked CI secret can do. It
includes abuse of money (LLM spend, trials) and of the server.

Findings are grouped into five fix branches, one pull request each. `R*` IDs refer to the
recommendations of the code audit.

| Branch | Findings |
|---|---|
| `fix/security-ip-and-auth-limits` | #1, #9, #14, #16, R6 |
| `fix/security-sessions-and-step-up` | #7, #8, #10, R4 |
| `fix/security-ai-injection` | #4, #5, #6, #12, #13, R2 |
| `fix/security-llm-abuse` | #2, #3, #15, #17, #18, R1 |
| `chore/security-infra-hardening` | #11, #19, #20, #21, #22, #23 |

Status values: **Fixed in `<branch>`** (the change and its tests are in that branch) or **Fix in
progress: `<branch>`**. Each pull request records what it changed and what still needs a human.

## Summary

| ID | Title | Severity | Status |
|---|---|---|---|
| #1 | Client IP spoofable through `trustProxy: true` | High | Fix in progress: `fix/security-ip-and-auth-limits` |
| #2 | Widget denial of wallet: no AI reply cap per site or workspace | High | Fix in progress: `fix/security-llm-abuse` |
| #3 | One shared FIFO inbox queue lets one tenant delay all others | High | Fix in progress: `fix/security-llm-abuse` |
| #4 | Comment replies can call shop API actions and publish other customers' data | High | Fix in progress: `fix/security-ai-injection` |
| #5 | Customer text can close `<customer>` and fake shop data or tool results | Medium-High | Fix in progress: `fix/security-ai-injection` |
| #6 | Figure grounding not run in production | Medium | Fix in progress: `fix/security-ai-injection` |
| #7 | Back office without two-factor authentication | High (impact) | Fix in progress: `fix/security-sessions-and-step-up` |
| #8 | Google sign-in pre-hijack; Google links survive a password reset | Medium | Fix in progress: `fix/security-sessions-and-step-up` |
| #9 | Reset codes guessable slowly; attempts reset on resend | Medium | Fix in progress: `fix/security-ip-and-auth-limits` |
| #10 | Tokens outlive revocation; no step-up for API keys or data export; Google-only users cannot enable 2FA | Medium | Fix in progress: `fix/security-sessions-and-step-up` |
| #11 | No CSP or frame-ancestors; uploads share the app origin | Medium | Fixed in `chore/security-infra-hardening` |
| #12 | Owner-assistant memory poisoning | Medium | Fix in progress: `fix/security-ai-injection` |
| #13 | Bot instruction extraction | Low-Medium | Fix in progress: `fix/security-ai-injection` |
| #14 | Unlimited trials through email aliases | Medium (business) | Fix in progress: `fix/security-ip-and-auth-limits` |
| #15 | Unmetered playground, owner assistant and interrupt reruns | Medium | Fix in progress: `fix/security-llm-abuse` |
| #16 | Email bombing through signup codes | Medium | Fix in progress: `fix/security-ip-and-auth-limits` |
| #17 | Widget uploads never cleaned; in-memory limiter eviction | Medium | Fix in progress: `fix/security-llm-abuse` |
| #18 | No reply cap per conversation; order and hold spam | Low-Medium | Fix in progress: `fix/security-llm-abuse` |
| #19 | Deploy key is root-equivalent; `workflow_dispatch` runs from any branch | Medium-High | Fixed in `chore/security-infra-hardening` |
| #20 | SeaweedFS filer and master, and Redis, without authentication | Medium | Fixed in `chore/security-infra-hardening` |
| #21 | Backups deletable from the server | Medium | Fixed in `chore/security-infra-hardening` (bucket settings: server check) |
| #22 | Unpinned images and actions; gitleaks downloaded without a checksum | Medium | Fixed in `chore/security-infra-hardening` |
| #23 | Public OpenAPI and version; local compose on 0.0.0.0; beta-gate cookie; fat image | Low | Fixed in `chore/security-infra-hardening` |
| R1 | Catalog image downloader SSRF (DNS rebinding, blocklist gaps) | Medium | Fix in progress: `fix/security-llm-abuse` |
| R2 | Assistant SQL role can call `set_config` | Defense in depth | Fix in progress: `fix/security-ai-injection` |
| R4 | Same as #10 (access tokens after logout or reset) | Low | Fix in progress: `fix/security-sessions-and-step-up` |
| R6 | Signup reveals whether an email is registered | Low | Fix in progress: `fix/security-ip-and-auth-limits` |

## Findings

### #1 Client IP spoofable through `trustProxy: true` — High

- **Attacker scenario.** The API trusts every `X-Forwarded-For` hop. An attacker sends a new random
  address in the header with each request, so every limiter keyed by IP (login, signup codes, reset
  codes, public widget) sees a new client each time and never trips.
- **Defense.** Trust only the known proxy chain (NPM, then the edge) and take the client address
  from the hop they append; never from a header the client controls.
- **Fix branch.** `fix/security-ip-and-auth-limits`.

### #2 Widget denial of wallet — High

- **Attacker scenario.** The widget is public by design. A script opens many visitor sessions on a
  shop's site and sends messages; each one runs a paid LLM turn on the platform's or the shop's
  provider key. Per-visitor limits do not bound the total.
- **Defense.** A reply budget per site and per workspace (per minute and per day), with a clear
  "busy" answer when it is spent.
- **Fix branch.** `fix/security-llm-abuse`.

### #3 Shared FIFO inbox queue — High

- **Attacker scenario.** All tenants' inbound messages go through one sequential queue. One tenant
  (or someone flooding one tenant's page or widget) fills it and every other shop's replies wait.
- **Defense.** Per-workspace fairness (grouped or partitioned queue, concurrency per tenant) so one
  tenant's backlog cannot delay others.
- **Fix branch.** `fix/security-llm-abuse`.

### #4 Comment replies with shop API actions — High

- **Attacker scenario.** A public Facebook comment reaches the bot with the same tools as a private
  chat. A commenter asks for "my order" or another customer's details; the bot calls a shop API
  action and posts the result as a public reply.
- **Defense.** Public surfaces (comments) get no data-reading actions and never publish personal or
  order data; such requests move to a private message.
- **Fix branch.** `fix/security-ai-injection`.

### #5 Customer text breaks out of `<customer>` — Medium-High

- **Attacker scenario.** The customer's message is wrapped in `<customer>` tags in the prompt. The
  customer types a closing tag and then fake "shop data" or a fake tool result, and the model treats
  it as trusted.
- **Defense.** Escape or neutralise the delimiters in untrusted text, and keep tool results in the
  provider's structured tool channel only.
- **Fix branch.** `fix/security-ai-injection`.

### #6 Figure grounding not run in production — Medium

- **Attacker scenario.** A customer coaxes the bot into quoting a price, discount or stock figure
  that is not in the catalog. The check that compares figures in a reply with the shop's data exists
  but does not run in production, so the invented figure reaches the customer.
- **Defense.** Run the grounding check on every production reply and block or rewrite unsupported
  figures.
- **Fix branch.** `fix/security-ai-injection`.

### #7 Back office without two-factor authentication — High (impact)

- **Attacker scenario.** A phished or reused password of a platform admin opens `/admin`: every
  tenant, plans, payments, LLM provider keys.
- **Defense.** Mandatory TOTP for platform admins before any `/admin` access.
- **Fix branch.** `fix/security-sessions-and-step-up`.

### #8 Google sign-in pre-hijack — Medium

- **Attacker scenario.** The attacker registers the victim's email with a password before the victim
  first signs in with Google; the accounts are merged and the attacker's password still works. A
  Google link also survives a password reset, so a reset does not lock an intruder out.
- **Defense.** Link Google only to verified accounts (or drop the unverified password on link), and
  remove sessions and review links on reset.
- **Fix branch.** `fix/security-sessions-and-step-up`.

### #9 Reset codes guessable slowly — Medium

- **Attacker scenario.** Requesting a new reset code resets the attempt counter, so an attacker can
  keep guessing six-digit codes indefinitely at a slow rate.
- **Defense.** Attempts counted per account across resends, with a lockout window.
- **Fix branch.** `fix/security-ip-and-auth-limits`.

### #10 Tokens outlive revocation; no step-up — Medium (also R4)

- **Attacker scenario.** A stolen access token keeps working up to 15 minutes after logout or a
  password reset. Creating API keys or exporting all data needs no fresh authentication, and users
  who only sign in with Google cannot turn on 2FA.
- **Defense.** Session revocation checked on use, step-up (password or TOTP) for API keys and data
  export, and 2FA available to Google-only users.
- **Fix branch.** `fix/security-sessions-and-step-up`.

### #11 No CSP or frame-ancestors; shared origin — Medium

- **Attacker scenario.** The dashboard can be framed by any site (clickjacking an owner into
  connecting a channel or changing settings). Any script injection has no CSP to stop it. Uploaded
  files are served from `/media` on the same origin: an uploaded HTML or SVG file opened directly
  would run as a page of the app.
- **Defense.** At the edge (`infra/deploy/Caddyfile`): `X-Frame-Options: DENY` and an enforced
  `frame-ancestors 'none'` everywhere (the widget is a Shadow DOM script, so customer sites still
  load it); an enforced full CSP on the marketing site; the same CSP report-only on the dashboard
  until every flow is verified (its inline boot script moved to `/boot.js` so `script-src 'self'`
  fits); `Permissions-Policy`; HSTS without `includeSubDomains` (not every subdomain is known to
  be HTTPS). `/media` responses carry `Content-Security-Policy: sandbox; default-src 'none'` and
  anything that is not a picture or a video downloads (`Content-Disposition: attachment`).
  `infra/deploy/test/edge-headers.sh` runs `caddy validate` and checks every header in CI.
- **Fix branch.** `chore/security-infra-hardening`. Remaining: switch the dashboard CSP to enforced
  after a review of its reports; serve uploads from a separate origin when one is available.

### #12 Owner-assistant memory poisoning — Medium

- **Attacker scenario.** Text from customers (messages, names, notes) ends up in what the owner
  assistant remembers. A crafted message plants an instruction that the assistant later follows in
  the owner's session.
- **Defense.** Only the owner's own statements become memory; customer-originated text is treated
  as data and never stored as an instruction.
- **Fix branch.** `fix/security-ai-injection`.

### #13 Instruction extraction — Low-Medium

- **Attacker scenario.** A customer asks the bot to repeat its instructions and obtains the shop's
  prompt, internal notes and tool descriptions.
- **Defense.** Prompt-level refusal plus an output check for long verbatim overlaps with the
  instructions.
- **Fix branch.** `fix/security-ai-injection`.

### #14 Unlimited trials through aliases — Medium (business)

- **Attacker scenario.** `name+1@gmail.com`, `n.ame@gmail.com` and similar addresses all reach one
  mailbox; each signup gets a new free trial with LLM credit.
- **Defense.** Normalise addresses for trial eligibility (dots and plus tags for providers that
  ignore them) and limit trials per normalised address.
- **Fix branch.** `fix/security-ip-and-auth-limits`.

### #15 Unmetered playground, assistant and reruns — Medium

- **Attacker scenario.** A tenant (or a trial account) runs the bot playground, the owner assistant
  or interrupt reruns in a loop; these LLM calls are not counted against the plan.
- **Defense.** Meter every LLM call against the workspace's balance or a per-feature quota.
- **Fix branch.** `fix/security-llm-abuse`.

### #16 Email bombing through signup codes — Medium

- **Attacker scenario.** Signup-code requests for a victim's address send mail on each call; with
  #1 the IP limit does not hold. The victim's inbox fills and the sending domain's reputation drops.
- **Defense.** Limits per target address and per sender, with cooldowns, on top of a correct
  client IP.
- **Fix branch.** `fix/security-ip-and-auth-limits`.

### #17 Widget uploads never cleaned; limiter eviction — Medium

- **Attacker scenario.** Visitor uploads stay in the bucket forever, so a script fills the disk.
  The in-memory limiter drops old keys when full, so a flood of new keys resets the limits of real
  attackers.
- **Defense.** Expire unattached uploads; a limiter whose eviction cannot be forced by an attacker
  (shared store or bounded per-key state).
- **Fix branch.** `fix/security-llm-abuse`.

### #18 No reply cap per conversation; order and hold spam — Low-Medium

- **Attacker scenario.** One conversation keeps the bot answering forever, or makes it create many
  draft orders and room holds that block real customers' stock.
- **Defense.** Caps per conversation (replies, orders, holds) with a handover to a human.
- **Fix branch.** `fix/security-llm-abuse`.

### #19 Deploy key root-equivalent; `workflow_dispatch` from any branch — Medium-High

- **Attacker scenario.** The CI key logs in as `deploy`, a member of the `docker` group (root on the
  host). Anyone able to run the Deploy workflow from any branch, or to read the repository secrets
  from any workflow, gets a root shell on the production server. The workflow also copied scripts
  from the branch being deployed and ran them.
- **Defense.** The workflow only deploys `main` (a manual run on another ref fails) and runs as the
  `production` environment; the key is an environment secret, the environment allows `main` only
  and requires a reviewer. On the server the key is pinned with
  `command="/opt/apps/rapiz/deploy-ssh.sh",restrict`. `deploy-ssh.sh` parses `SSH_ORIGINAL_COMMAND`
  strictly: only `deploy <40-hex SHA>` or `rollback`; the registry user and token come on stdin; the
  server files are taken from the release image of that SHA, never from the connection. Tested by
  `infra/deploy/test/deploy-ssh-test.sh` in CI.
- **Fix branch.** `chore/security-infra-hardening`. The `authorized_keys` line and the GitHub
  environment are server and repository settings: see [Verify on the server](#verify-on-the-server).

### #20 SeaweedFS and Redis without authentication — Medium

- **Attacker scenario.** Any container on the backend network (for example after an RCE in a
  dependency of one service) can talk to Redis and to SeaweedFS's master, filer and volume servers
  without credentials: read every object, delete collections, flush queues.
- **Defense.** Redis `requirepass` from `REDIS_PASSWORD` (generated by `bootstrap.sh` for new
  installs and by `deploy.sh` for existing ones; `REDIS_URL` carries it). SeaweedFS listens on
  loopback for the master, volume and filer ports and only S3 (signed requests, read-only anonymous
  identity) is reachable; a `security.toml` with JWT keys from `SEAWEEDFS_JWT_KEY` protects filer
  and volume writes and reads. The SeaweedFS image is pinned by version and digest.
- **Fix branch.** `chore/security-infra-hardening`. Redis and SeaweedFS still run as root inside
  their containers (existing volume ownership).

### #21 Backups deletable from the server — Medium

- **Attacker scenario.** Someone with the server (ransomware, a stolen deploy key before #19) uses
  the off-site key in `.env` to delete every backup, then encrypts or wipes the database. Local dumps
  in `backups/` are plain database copies readable by anyone who copies the folder.
- **Defense.** Local dumps are encrypted with `age` to the recovery kit's public key (`*.dump.age`,
  mode 600). The runbook requires bucket versioning, Object Lock and an append-only server key
  (cannot delete versions or change the bucket's lock, lifecycle or policy), with lifecycle rules
  doing the expiry. `BACKUP_OBJECT_LOCK=1` (off by default) turns the server-side WAL-G retention
  and pruning off for buckets whose key cannot delete at all. Covered by
  `infra/deploy/test/backup-e2e.sh`.
- **Fix branch.** `chore/security-infra-hardening`. The bucket settings live at the provider.

### #22 Unpinned images and actions; gitleaks without checksum — Medium

- **Attacker scenario.** A moved tag on a base image, a GitHub Action or the gitleaks release runs
  attacker code in CI (with the GHCR push token) or ships it to production.
- **Defense.** Base images pinned by `@sha256` digest (Dockerfiles, deploy compose, local compose,
  CI service), actions pinned by commit SHA with the version in a comment, the gitleaks tarball
  checked against the release's checksum, Dependabot for `docker`, `docker-compose` and
  `github-actions`. Least-privilege `permissions` per job (`{}` at the top), `persist-credentials:
  false` on checkouts, no `:latest` tags.
- **Fix branch.** `chore/security-infra-hardening`. The optional Hermes image still installs its
  Python source without hashes (the source is outside this repository and has no lock file).

### #23 Public OpenAPI and version; local compose on 0.0.0.0; beta gate; fat image — Low

- **Attacker scenario.** `/api/v1/openapi.json` listed every internal route and `/api/v1/health` the
  exact build, which helps target known bugs. Local development containers (Postgres, Redis,
  SeaweedFS, Mailpit) listened on every interface of a developer's laptop. The beta-gate admin
  credentials file could be left world-readable. The app image carried the whole repository and dev
  tool chain.
- **Defense.** In production the health response omits the version and OpenAPI serves the public
  subset; readiness answers 404 at the edge. Local compose binds `127.0.0.1`. `beta-gate.sh`
  tightens `~/npm-admin.txt` to 600, validates the user name, and the runbook documents rotation
  (one shared login and cookie; per-tester logins judged not worth it for a short beta). The app
  image installs production dependencies of the backend and webhook only (about 230 MB of
  `node_modules` instead of about 950 MB) with no sources, docs or agent configuration;
  `.dockerignore` excludes `.env*`, `.agents`, `.claude`, `.github` and docs. The edge Caddy runs as
  an unprivileged user.
- **Fix branch.** `chore/security-infra-hardening`.

### R1 Image downloader SSRF — Medium

- **Attacker scenario.** A catalog import points at a host that resolves to a public address at
  check time and to an internal one at fetch time (DNS rebinding), or at an address range the
  blocklist misses.
- **Defense.** Resolve once, check the address, connect to that address; complete private and
  link-local ranges.
- **Fix branch.** `fix/security-llm-abuse`.

### R2 Assistant SQL role and `set_config` — defense in depth

- **Attacker scenario.** If the read-only assistant SQL lane ever let model-written SQL call
  `set_config`, it could change the RLS workspace setting for its transaction.
- **Defense.** Revoke or block `set_config` for the assistant role.
- **Fix branch.** `fix/security-ai-injection`.

### R6 Signup enumeration — Low

- **Attacker scenario.** The signup-code request answers differently for a registered email.
- **Defense.** One answer for every address.
- **Fix branch.** `fix/security-ip-and-auth-limits`.

## Verify on the server

Settings outside the repository. Check each one after the fix branches are merged and tick it in
the deployment log.

- [ ] **NPM admin port.** The Nginx Proxy Manager admin UI (`:81`) is bound to `127.0.0.1` on the
      host (`ss -ltnp | grep ':81 '` shows `127.0.0.1:81`), reached only through an SSH tunnel.
- [ ] **NPM overwrites `X-Forwarded-For`.** NPM sets the header to the real client address instead
      of appending to what the client sent (send a request with a fake `X-Forwarded-For` and check
      the address in the API's logs). #1 relies on it.
- [ ] **Firewall and SSH.** Only 22, 80 and 443 are open (`ufw status` or the provider firewall);
      `PasswordAuthentication no`, `PermitRootLogin no` in `sshd`; unattended security updates on.
- [ ] **Deploy key.** `~deploy/.ssh/authorized_keys` has the CI key only in the form
      `command="/opt/apps/rapiz/deploy-ssh.sh",restrict …`, and `/opt/apps/rapiz/deploy-ssh.sh` is
      installed (owner `deploy`, mode 755).
- [ ] **GitHub branch protection.** `main` requires a pull request with the maintainer's review and
      the CI checks; force pushes and deletion are blocked; administrators are included.
- [ ] **GitHub environment.** `production` allows the `main` branch only, has a required reviewer,
      and holds the `DEPLOY_*` secrets; no repository-level copies of them remain. The repository
      allows only selected or verified actions if the plan supports it.
- [ ] **GHCR package visibility.** The `app` and `edge` packages are private and linked to this
      repository only; old `:latest` tags are deleted.
- [ ] **Off-site bucket policy.** Versioning and Object Lock (default retention ≥ 30 days) are on,
      the server's key cannot delete versions or change versioning, lock, lifecycle or policy, and the
      lifecycle rules expire noncurrent versions (runbook
      [Protect the off-site copy](../runbooks/backup-and-restore.md#protect-the-off-site-copy)).
- [ ] **Secrets present.** `.env` has `REDIS_PASSWORD`, `SEAWEEDFS_JWT_KEY` and
      `BACKUP_AGE_RECIPIENT`, mode 600; `~/npm-admin.txt` and `~/beta-access.txt` are mode 600.
- [ ] **Headers live.** `curl -sI https://<host>/` shows the CSP, `X-Frame-Options: DENY` and
      HSTS; `https://<host>/api/v1/health/ready` answers 404.
