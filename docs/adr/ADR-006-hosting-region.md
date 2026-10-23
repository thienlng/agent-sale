# ADR-006: Hosting model and data region

- Status: Partially decided · Date: 2026-10-23

## Decided (owner, 2026-10-23)

**Self-hosted only.** No managed/cloud data or observability services (no cloud PostgreSQL, Redis, object storage, Grafana Cloud, Langfuse Cloud, Sentry SaaS). Every stateful component runs on servers we control: PostgreSQL (Patroni HA + pgBackRest PITR + PgBouncer), Redis (Sentinel), MinIO, Grafana LGTM stack, Sentry, Langfuse v3. Operational load is accepted by the owners and is not a design constraint. The only external dependencies are LLM provider APIs and the channel/payment/carrier APIs the product integrates with.

## Still open — where the servers live

| Option | Pros | Cons |
|---|---|---|
| 1. Vietnamese data center / colocation (own or rented bare metal) | Data in-country (strong for enterprise/government sales and the personal data protection law), lowest latency for VN users, predictable cost at scale | Hardware procurement and replacement, capacity planning, physical/network ops |
| 2. IaaS VMs in Vietnam (Viettel IDC, VNG, FPT, CMC) | Data in-country, elastic VMs, no hardware | Fewer instance types/NVMe options; still self-managed software |
| 3. IaaS VMs in Singapore (AWS/GCP EC2/GCE only, no managed services) | Widest instance selection, mature networking | Data outside VN → cross-border transfer dossier under the Personal Data Protection Law; ~30–40 ms extra latency |

Edge: Cloudflare for CDN/WAF/DDoS on static assets only (no data at rest) is acceptable under the self-host constraint; if the owners want zero third-party edge, nginx/Caddy + CrowdSec + an in-country CDN is the fallback.

## Recommendation

Option 2 for MVP/Beta (fast to provision, in-country), with Terraform/Ansible so a move to Option 1 at GA is a re-provision, not a redesign. Cloud-agnostic by construction: containers, S3 API, standard Postgres.

## Consequences

Infrastructure tasks (T-008 and successors) include Patroni, pgBackRest, Sentinel, MinIO and the LGTM stack from the start; backup/restore drills are part of the GA checklist (`docs/10` §7); the LLM data-transfer dossier is needed regardless, because LLM providers are abroad.
