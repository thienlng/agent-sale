# Independent QA — Meta Inbox BA specification

Date: 2026-10-27. Task: T-095. Reviewer: fresh agent `/root/qa_meta_inbox_spec`, inheriting the primary agent's model. Scope: read-only BA/document review; no browser interactions, application changes or live-provider tests.

## Initial findings and resolution

| Severity | Finding | Resolution |
|---|---|---|
| Major | Lifecycle did not specify suppression of automation in Spam/deleted states or queued sends. | Added a lifecycle policy table and INB-STA-08: separate inbound/read/waiting/notification/manual/automated-send rules; recheck queued sends; deletion retention remains an implementation gate. |
| Major | Customer-profile notes appeared to be an existing capability, whereas baseline notes are conversation-scoped. | INB-CRM-08 defaults to the existing conversation-note source in the panel; a distinct customer-level note store is explicitly new and requires a decision. |
| Medium | Queue-count semantics were incomplete. | INB-FLT-10 preserves filters except active queue tab and includes a 10/3/2 count example. |
| Medium | Local requirement IDs could collide with global PRD IDs. | Namespaced all requirement and acceptance IDs with INB; global PRD mapping remains separate. |

## Final verdict

Approved as a BA specification draft for product-owner review, with no remaining blocking findings within that scope. The reviewer confirmed the four fixes and resolving relative links in the business specification and English handoff.

This verdict does not certify complete Meta product parity, API availability, implementation readiness of conditional sections or shipped application behavior. Calling, payments, lead-manager internals, custom automation builder and unverified provider behavior remain explicit discovery gates. Repository-wide gate results are recorded separately in the task log by the primary agent.
