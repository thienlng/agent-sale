# ADR-006: Infrastructure & data region — TO BE FINALIZED

- Status: To be finalized · Date: 2026-10-23

## Options
1. **International cloud, Singapore region** (AWS/GCP): full managed services, fast to MVP; data outside VN → requires a data transfer dossier under the personal data protection (BVDLCN) law, i.e. the Personal Data Protection Law (Luật Bảo vệ dữ liệu cá nhân).
2. **Vietnamese cloud** (Viettel IDC/VNG/FPT/CMC): data stays in-country, an advantage when selling to large enterprises/government; more limited managed services → self-operate Postgres/Redis on K8s or use the provider's DBaaS offering.
3. Hybrid: primary data in VN, calling international LLMs via a gateway with PII masking.

## Interim recommendation
Option 3 if the organization already has VN infrastructure; otherwise, option 1 for the MVP with a cloud-agnostic design (containers, S3-compatible storage, standard Postgres) to allow migration.
