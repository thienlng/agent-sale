# Rule 01 — Language

**English is the working language of this repository.**

Use English for:

- Code: identifiers, types, database tables/columns, API paths, enum values, error codes.
- Comments, docstrings, TODO/FIXME notes in code.
- Commit messages, branch names, PR titles and descriptions, code review comments.
- `TODO.md`, every file in `todo/`, every file in `docs/` (technical documentation, ADRs, specs).
- Tests: names, fixtures, assertion messages.
- Log messages, metrics names, error messages intended for developers.

Vietnamese (or any other language) is allowed only for:

- Conversation with humans in chat (match the human's language).
- **Product strings shown to end users**, which live in i18n resource files (`packages/i18n/`, `apps/*/messages/`), never hard-coded in components or services.
- Test inputs that must be Vietnamese because they reproduce real user input (e.g. AI eval cases, customer messages in fixtures).
- Quoted UI labels of the reference product (Preny) in `docs/reference/`, always with an English gloss.
- Business / marketing material, if any, under `docs/business/` (create only when needed).

Technical terms stay in English even inside Vietnamese chat (deploy, migration, PR, queue, …). Do not translate domain terms that are already established in English in the docs (workspace, contact, conversation, handoff, entitlement, ledger).
